import { assertAiExecutionContext } from "./contracts.mjs";
import { AI_ERROR_CODES, asAiGatewayError } from "./errors.mjs";
import { createAiGateway } from "./gateway.mjs";
import { resolveRoute } from "./model-catalog.mjs";
import { resolveTaskPolicy } from "./task-policy.mjs";

export const AI_GROUND_TRUTH_STATES = Object.freeze([
  "draft", "reviewed_once", "disputed", "approved",
]);

function record(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function text(value, max = 160) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export function assertBenchmarkCase(value) {
  if (!record(value)) throw new Error("BENCHMARK_CASE_INVALID");
  const caseId = text(value.caseId, 120);
  const state = text(value.groundTruthState, 40);
  if (!/^[a-z0-9][a-z0-9._:-]{2,119}$/i.test(caseId)
    || !AI_GROUND_TRUTH_STATES.includes(state)
    || !record(value.request)
    || !record(value.technicalExpectedOutput)) throw new Error("BENCHMARK_CASE_INVALID");
  const reviews = Array.isArray(value.reviews) ? value.reviews.filter(record) : [];
  const decisions = reviews.map((review) => text(review.decision, 80)).filter(Boolean);
  const compatibleReviews = reviews.length >= 2 && new Set(decisions).size === 1;
  const adjudicated = record(value.adjudication) && text(value.adjudication.decision, 80).length > 0;
  if (state === "reviewed_once" && reviews.length < 1) throw new Error("GROUND_TRUTH_REVIEW_REQUIRED");
  if (state === "disputed" && (reviews.length < 2 || new Set(decisions).size < 2)) throw new Error("GROUND_TRUTH_DISPUTE_REQUIRED");
  if (state === "approved" && !compatibleReviews && !adjudicated) throw new Error("GROUND_TRUTH_APPROVAL_REQUIRED");
  if (value.holdout === true && state !== "approved") throw new Error("GROUND_TRUTH_HOLDOUT_REQUIRES_APPROVAL");
  return Object.freeze({ ...value, caseId, groundTruthState: state, reviews: Object.freeze(reviews) });
}

function runtimeForRoute(route) {
  return Object.freeze({
    task_type: null,
    transport_mode: "gateway_routing",
    primary_route_id: route.routeId,
    fallback_route_id: null,
    openrouter_enabled: route.providerId === "openrouter",
    nvidia_nim_enabled: route.providerId === "nvidia_nim",
  });
}

function offlineCapability(route) {
  const exactModelId = route.providerId === "openrouter"
    ? route.model.exactDiscoveryId
    : route.providerId === "nvidia_nim"
    ? route.model.exactDiscoveryNames[0]
    : route.model.modelId;
  return Object.freeze({
    available: true,
    exactModelId,
    endpointUrl: route.provider.inferenceUrl ?? null,
    structuredOutput: true,
    dataClasses: ["public_market"],
    discoveredAt: new Date().toISOString(),
  });
}

function deepEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export async function runBenchmarkCase(
  { caseId, routeId },
  executionContext,
  {
    corpusStore,
    fetchImpl,
    telemetrySink = [],
    budgetSink = [],
    liveAuthorized = false,
    persistence: livePersistence,
    secretReader: liveSecretReader,
    capabilityReader: liveCapabilityReader,
  } = {},
) {
  const context = assertAiExecutionContext(executionContext);
  if (!corpusStore || typeof corpusStore.loadCase !== "function") throw new Error("BENCHMARK_CORPUS_STORE_REQUIRED");
  if (typeof fetchImpl !== "function") throw new Error("BENCHMARK_OFFLINE_TRANSPORT_REQUIRED");
  const benchmarkCase = assertBenchmarkCase(await corpusStore.loadCase(caseId));
  const route = resolveRoute(text(routeId, 160));
  const policy = resolveTaskPolicy(
    benchmarkCase.request.taskType,
    benchmarkCase.request.contractVersion,
    benchmarkCase.request.policyVersion,
  );
  if (liveAuthorized && (!livePersistence || typeof liveSecretReader !== "function"
    || typeof liveCapabilityReader !== "function")) throw new Error("LIVE_BENCHMARK_DEPENDENCIES_REQUIRED");
  const offlinePersistence = {
    readTaskRuntime: async () => runtimeForRoute(route),
    reserveBudget: async (reservation) => {
      budgetSink.push({ ...reservation, offline: true });
      return { status: "reserved", reserved: true, requested_units: reservation.requestedUnits, used_units: reservation.requestedUnits, limit_units: reservation.requestedUnits };
    },
    recordInvocation: async (attempt) => {
      telemetrySink.push({ ...attempt, benchmark: true });
      return { id: telemetrySink.length, idempotent: false };
    },
  };
  const gateway = createAiGateway({
    fetchImpl,
    offlineTransport: liveAuthorized !== true,
    externalAiDisabled: liveAuthorized !== true,
    secretReader: liveAuthorized ? liveSecretReader : async () => "offline-benchmark-secret",
    runtimeReader: async () => runtimeForRoute(route),
    capabilityReader: liveAuthorized ? liveCapabilityReader : async () => offlineCapability(route),
    persistence: liveAuthorized ? livePersistence : offlinePersistence,
    logger: { error() {} },
  });

  try {
    const result = await gateway.generateStructured(benchmarkCase.request, context);
    const technicalContractPassed = deepEqual(result.value, benchmarkCase.technicalExpectedOutput);
    return Object.freeze({
      caseId: benchmarkCase.caseId,
      routeId: route.routeId,
      taskType: policy.taskType,
      status: technicalContractPassed ? "technical_pass" : "technical_mismatch",
      technicalContractPassed,
      groundTruthState: benchmarkCase.groundTruthState,
      holdoutEligible: benchmarkCase.groundTruthState === "approved" && benchmarkCase.holdout === true,
      authoritativeMetricsEligible: benchmarkCase.groundTruthState === "approved"
        && benchmarkCase.holdout === true && result.metadata.metricsEligible === true,
      telemetryStatus: result.telemetryStatus,
      warnings: result.warnings,
    });
  } catch (error) {
    const ai = asAiGatewayError(error);
    return Object.freeze({
      caseId: benchmarkCase.caseId,
      routeId: route.routeId,
      taskType: policy.taskType,
      status: [AI_ERROR_CODES.MODEL_NOT_AVAILABLE, AI_ERROR_CODES.DATA_CLASS_PROHIBITED].includes(ai.code)
        ? "route_unavailable"
        : "technical_failure",
      errorCode: ai.code,
      technicalContractPassed: false,
      groundTruthState: benchmarkCase.groundTruthState,
      holdoutEligible: false,
      authoritativeMetricsEligible: false,
      telemetryStatus: ai.telemetryStatus,
      warnings: ai.warnings,
    });
  }
}
