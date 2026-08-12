import { assertAiExecutionContext, assertAiTaskRequest, canonicalJson, sha256Hex } from "./contracts.mjs";
import { reserveProviderBudget } from "./budget.mjs";
import { assertDeadlineBudget, createChildAbort } from "./deadline.mjs";
import {
  AI_ERROR_CODES,
  aiError,
  asAiGatewayError,
  isTechnicalFallbackEligible,
} from "./errors.mjs";
import { resolveRoute } from "./model-catalog.mjs";
import { createAiPersistence } from "./persistence.mjs";
import { assertDataClassAllowed, sanitizeTaskInput } from "./sanitize.mjs";
import {
  parseAndValidateTaskOutput,
  resolveTaskPolicy,
} from "./task-policy.mjs";
import { validateTaskOutput } from "./task-output-validation.mjs";
import { routeCapabilityAvailable } from "./capability-discovery.mjs";
import { persistAiTelemetry } from "./telemetry.mjs";
import { invokeGeminiLegacy } from "./providers/gemini-legacy.mjs";
import { invokeGemini } from "./providers/gemini.mjs";
import { invokeOpenRouter } from "./providers/openrouter.mjs";
import { invokeNvidiaNim } from "./providers/nvidia-nim.mjs";

function environmentValue(name) {
  try {
    return globalThis.Deno?.env?.get?.(name) ?? "";
  } catch {
    return "";
  }
}

function configuredKey(variable, legacy) {
  const configured = environmentValue(variable);
  if (configured) {
    try {
      const parsed = JSON.parse(configured);
      if (typeof parsed?.default === "string" && parsed.default) return parsed.default;
    } catch {
      // Compatibilidad con el formato de secreto simple.
    }
  }
  return environmentValue(legacy);
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function runtimeMode(value, policy) {
  if (!isRecord(value)) {
    return Object.freeze({
      transportMode: "legacy_direct",
      routeIds: Object.freeze([policy.legacyRouteId]),
      openrouterEnabled: false,
      nvidiaNimEnabled: false,
    });
  }
  const transportMode = value.transport_mode;
  if (transportMode === "legacy_direct") {
    return Object.freeze({ transportMode, routeIds: Object.freeze([policy.legacyRouteId]), openrouterEnabled: false, nvidiaNimEnabled: false });
  }
  if (transportMode === "gateway_gemini_parity") {
    return Object.freeze({ transportMode, routeIds: Object.freeze([policy.parityRouteId]), openrouterEnabled: false, nvidiaNimEnabled: false });
  }
  if (transportMode !== "gateway_routing") {
    throw aiError(AI_ERROR_CODES.ROUTE_NOT_AVAILABLE, { details: { taskType: value.task_type, phase: "transport_mode" } });
  }
  const routeIds = [value.primary_route_id, value.fallback_route_id]
    .filter((item, index, all) => typeof item === "string" && item && all.indexOf(item) === index);
  if (!routeIds.length) throw aiError(AI_ERROR_CODES.ROUTE_NOT_AVAILABLE, { details: { phase: "routing_registry" } });
  return Object.freeze({
    transportMode,
    routeIds: Object.freeze(routeIds),
    openrouterEnabled: value.openrouter_enabled === true,
    nvidiaNimEnabled: value.nvidia_nim_enabled === true,
  });
}

function routeEnabled(route, runtime) {
  if (!route.provider.experimental) return route.enabled === true;
  if (route.providerId === "openrouter") return runtime.openrouterEnabled;
  if (route.providerId === "nvidia_nim") return runtime.nvidiaNimEnabled;
  return false;
}

function secretName(route) {
  return route.provider.secretName;
}

function usageNumbers(metadata) {
  const usage = isRecord(metadata?.usage) ? metadata.usage : {};
  const input = Number(usage.promptTokenCount ?? usage.prompt_tokens ?? usage.input_tokens ?? 0);
  const output = Number(usage.candidatesTokenCount ?? usage.completion_tokens ?? usage.output_tokens ?? 0);
  return {
    inputTokens: Number.isSafeInteger(input) && input >= 0 ? input : null,
    outputTokens: Number.isSafeInteger(output) && output >= 0 ? output : null,
  };
}

async function invokeRoute({ route, taskType, input, policy, apiKey, context, fetchImpl, capability }) {
  const base = { taskType, input, policy, route, apiKey, context, fetchImpl, capability };
  if (route.adapter === "gemini_legacy") {
    return invokeGeminiLegacy({
      ...base,
      parseOutput: (payload, endpoint) => parseAndValidateTaskOutput(taskType, payload, endpoint, input),
    });
  }
  if (route.adapter === "gemini") {
    return invokeGemini({
      ...base,
      parseOutput: (payload, endpoint) => parseAndValidateTaskOutput(taskType, payload, endpoint, input),
    });
  }
  let result;
  if (route.adapter === "openrouter") result = await invokeOpenRouter(base);
  else if (route.adapter === "nvidia_nim") result = await invokeNvidiaNim(base);
  else throw aiError(AI_ERROR_CODES.ROUTE_NOT_AVAILABLE, { details: { routeId: route.routeId } });
  return { ...result, value: validateTaskOutput(taskType, result.value, input) };
}

function canRetryInvalidOutput(error, attempt, policy) {
  const ai = asAiGatewayError(error);
  return attempt < policy.invalidOutputRetries && [
    AI_ERROR_CODES.PROVIDER_INVALID_RESPONSE,
    AI_ERROR_CODES.OUTPUT_CONTRACT_INVALID,
  ].includes(ai.code);
}

async function invokeWithOutputRetry(options) {
  let lastError;
  for (let attempt = 0; attempt <= options.policy.invalidOutputRetries; attempt += 1) {
    try {
      const result = await invokeRoute(options);
      return { ...result, metadata: { ...result.metadata, outputRetryCount: attempt } };
    } catch (error) {
      lastError = asAiGatewayError(error);
      if (!canRetryInvalidOutput(lastError, attempt, options.policy)) throw lastError;
      assertDeadlineBudget(options.context, options.policy.finalizationReserveMs);
    }
  }
  throw lastError;
}

async function safeTelemetry(options) {
  return persistAiTelemetry(options);
}

export function createAiGateway(options = {}) {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const persistence = options.persistence ?? createAiPersistence({
    supabaseUrl: options.supabaseUrl ?? environmentValue("SUPABASE_URL"),
    secretKey: options.supabaseSecretKey ?? configuredKey("SUPABASE_SECRET_KEYS", "SUPABASE_SERVICE_ROLE_KEY"),
    fetchImpl,
  });
  const secretReader = options.secretReader ?? environmentValue;
  const runtimeReader = options.runtimeReader ?? ((taskType, signal) => persistence.readTaskRuntime(taskType, signal));
  const capabilityReader = options.capabilityReader ?? (async () => null);
  const logger = options.logger ?? console;
  const externalAiDisabled = options.externalAiDisabled ?? environmentValue("ATINARA_EXTERNAL_AI_DISABLED") === "1";
  const offlineTransport = options.offlineTransport === true;

  async function generateStructured(rawRequest, rawContext) {
    const request = assertAiTaskRequest(rawRequest);
    const context = assertAiExecutionContext(rawContext);
    const policy = resolveTaskPolicy(request.taskType, request.contractVersion, request.policyVersion);
    const timeline = { created: Date.now() };
    const sanitizedInput = sanitizeTaskInput(request.input, policy.inputProjection);
    timeline.sanitized = Date.now();
    const inputFingerprint = await sha256Hex(canonicalJson(sanitizedInput));
    assertDeadlineBudget(context, policy.finalizationReserveMs);
    const runtimeChild = createChildAbort(context, 5_000, policy.finalizationReserveMs);
    let runtimeValue;
    try {
      runtimeValue = await runtimeReader(request.taskType, runtimeChild.signal);
    } finally {
      runtimeChild.cleanup();
    }
    const runtime = runtimeMode(runtimeValue, policy);
    timeline.routed = Date.now();
    const gatewayWarnings = [];
    let lastError = null;

    for (let routeIndex = 0; routeIndex < runtime.routeIds.length; routeIndex += 1) {
      const route = resolveRoute(runtime.routeIds[routeIndex]);
      if (!routeEnabled(route, runtime)) {
        lastError = aiError(AI_ERROR_CODES.ROUTE_NOT_AVAILABLE, { details: { routeId: route.routeId, providerId: route.providerId } });
        if (routeIndex + 1 < runtime.routeIds.length) continue;
        throw lastError;
      }
      assertDataClassAllowed(policy.dataClass, route.providerId);
      const apiKey = await secretReader(secretName(route));
      if (typeof apiKey !== "string" || !apiKey) {
        lastError = aiError(AI_ERROR_CODES.PROVIDER_NOT_CONFIGURED, { details: { routeId: route.routeId, providerId: route.providerId } });
        if (runtime.transportMode === "gateway_routing" && routeIndex + 1 < runtime.routeIds.length) continue;
        throw lastError;
      }
      if (externalAiDisabled && !offlineTransport) {
        throw aiError(AI_ERROR_CODES.EXTERNAL_AI_DISABLED, { details: { routeId: route.routeId, providerId: route.providerId } });
      }
      const capability = route.provider.experimental ? await capabilityReader(route.routeId, context) : null;
      if (route.provider.experimental && !routeCapabilityAvailable(route, capability, policy.dataClass)) {
        lastError = aiError(AI_ERROR_CODES.MODEL_NOT_AVAILABLE, { details: { routeId: route.routeId, providerId: route.providerId } });
        if (routeIndex + 1 < runtime.routeIds.length) continue;
        throw lastError;
      }

      const budgetMode = runtime.transportMode === "legacy_direct" ? "baseline_existing" : "metered";
      const budgetChild = createChildAbort(context, 5_000, policy.finalizationReserveMs);
      try {
        await reserveProviderBudget({
          persistence,
          invocationId: context.invocationId,
          providerId: route.providerId,
          taskType: request.taskType,
          requestedUnits: policy.budgetUnits,
          budgetMode,
          signal: budgetChild.signal,
        });
      } catch (error) {
        const budgetError = asAiGatewayError(error, AI_ERROR_CODES.BUDGET_RESERVATION_FAILED);
        if (budgetMode !== "baseline_existing") throw budgetError;
        gatewayWarnings.push(budgetError.code);
        logger?.error?.("AI baseline budget reservation failed", JSON.stringify({
          code: budgetError.code,
          invocationId: context.invocationId,
          taskType: request.taskType,
          routeId: route.routeId,
        }));
      } finally {
        budgetChild.cleanup();
      }

      const startedAt = Date.now();
      timeline.requested = startedAt;
      try {
        const response = await invokeWithOutputRetry({
          route,
          taskType: request.taskType,
          input: sanitizedInput,
          policy,
          apiKey,
          context,
          fetchImpl,
          capability,
        });
        timeline.parsed = Date.now();
        timeline.schema_validated = timeline.parsed;
        timeline.domain_validated = timeline.parsed;
        timeline.accepted = Date.now();
        timeline.completed = timeline.accepted;
        const outputFingerprint = await sha256Hex(canonicalJson(response.value));
        const usage = usageNumbers(response.metadata);
        const telemetry = await safeTelemetry({
          persistence,
          context,
          policy,
          timeline,
          logger,
          record: {
            invocationId: context.invocationId,
            agentRunId: context.agentRunId,
            taskType: request.taskType,
            contractVersion: request.contractVersion,
            policyVersion: request.policyVersion,
            transportMode: runtime.transportMode,
            routeId: route.routeId,
            providerId: route.providerId,
            modelId: response.metadata?.resolvedModelId ?? route.model.modelId,
            dataClass: policy.dataClass,
            inputFingerprint,
            outputFingerprint,
            outcome: "accepted",
            errorCode: null,
            retryCount: Number(response.metadata?.retryCount ?? 0) + Number(response.metadata?.outputRetryCount ?? 0),
            responseBytes: Number(response.metadata?.responseBytes ?? 0),
            durationMs: Date.now() - startedAt,
            providerRequestId: response.metadata?.requestId ?? null,
            schemaFallback: response.metadata?.schemaFallback === true,
            metricsEligible: true,
            ...usage,
          },
        });
        return Object.freeze({
          value: response.value,
          telemetryStatus: telemetry.status,
          warnings: Object.freeze([...new Set([...gatewayWarnings, ...telemetry.warnings])]),
          metadata: Object.freeze({
            invocationId: context.invocationId,
            taskType: request.taskType,
            transportMode: runtime.transportMode,
            inputFingerprint,
            outputFingerprint,
            metricsEligible: telemetry.status === "persisted",
          }),
        });
      } catch (error) {
        lastError = asAiGatewayError(error);
        timeline.completed = Date.now();
        const telemetry = await safeTelemetry({
          persistence,
          context,
          policy,
          timeline,
          logger,
          record: {
            invocationId: context.invocationId,
            agentRunId: context.agentRunId,
            taskType: request.taskType,
            contractVersion: request.contractVersion,
            policyVersion: request.policyVersion,
            transportMode: runtime.transportMode,
            routeId: route.routeId,
            providerId: route.providerId,
            modelId: route.model.modelId,
            dataClass: policy.dataClass,
            inputFingerprint,
            outputFingerprint: null,
            outcome: "technical_failure",
            errorCode: lastError.code,
            retryCount: 0,
            responseBytes: 0,
            durationMs: Date.now() - startedAt,
            providerRequestId: null,
            schemaFallback: false,
            metricsEligible: false,
          },
        });
        lastError.telemetryStatus = telemetry.status;
        lastError.warnings = Object.freeze([...new Set([...gatewayWarnings, ...telemetry.warnings])]);
        const canFallback = runtime.transportMode === "gateway_routing"
          && routeIndex + 1 < runtime.routeIds.length
          && isTechnicalFallbackEligible(lastError);
        if (!canFallback) throw lastError;
      }
    }
    throw lastError ?? aiError(AI_ERROR_CODES.ROUTE_NOT_AVAILABLE);
  }

  return Object.freeze({ generateStructured });
}

export const defaultAiGateway = createAiGateway();

export function generateStructured(request, executionContext) {
  return defaultAiGateway.generateStructured(request, executionContext);
}
