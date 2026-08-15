import "jsr:@supabase/functions-js/edge-runtime.d.ts";

import {
  attestedPrimarySourceRefutesIssue,
  enforceReviewIssueEvidence,
  hasCurrentPrimarySourceAttestation,
  inferMetricContract,
  VALIDATOR_CONTENT_ISSUE_CODES,
} from "../_shared/market-draft-repair.mjs";
import { createAiGateway } from "../_shared/ai/gateway.mjs";
import { AI_ERROR_CODES, asAiGatewayError } from "../_shared/ai/errors.mjs";
import { createAbsoluteExecutionContext, fetchWithinDeadline } from "../_shared/ai/deadline.mjs";
import { AI_TASK_CONTRACTS } from "../_shared/ai/task-policy.mjs";
import {
  AI_EXECUTION_PROFILE_SINGLE_INFERENCE_SMOKE_V1,
  AI_EXECUTION_PROFILE_STANDARD,
} from "../_shared/ai/execution-profile.mjs";

type JsonRecord = Record<string, unknown>;

const VALIDATOR_VERSION = "atinara-market-gate-v3";
const POLICY_VERSION = "atinara-market-review-policy-v3";
const SCHEMA_VERSION = "atinara-market-draft-schema-v3";
const MAX_REQUEST_BYTES = 4_096;
const OPERATION_TIMEOUT_MS = 75_000;
const FINALIZATION_RESERVE_MS = 10_000;
const VALIDATOR_CONTENT_ISSUE_CODE_SET = new Set(VALIDATOR_CONTENT_ISSUE_CODES);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: JsonRecord, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function text(value: unknown, max = 4_000): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function configuredKey(variable: string, legacy: string): string {
  const configured = Deno.env.get(variable);
  if (configured) {
    try {
      const parsed = JSON.parse(configured) as Record<string, string>;
      if (parsed.default) return parsed.default;
    } catch {
      // Compatibilidad con el formato anterior de secretos de Supabase.
    }
  }
  return Deno.env.get(legacy) ?? "";
}

type Environment = {
  supabaseUrl: string;
  publishableKey: string;
  secretKey: string;
  execution: { invocationId: string; agentRunId: string | null; absoluteDeadlineAt: number; signal: AbortSignal };
};

function environment(execution: Environment["execution"]): Environment | null {
  const value = {
    supabaseUrl: Deno.env.get("SUPABASE_URL") ?? "",
    publishableKey: configuredKey("SUPABASE_PUBLISHABLE_KEYS", "SUPABASE_ANON_KEY"),
    secretKey: configuredKey("SUPABASE_SECRET_KEYS", "SUPABASE_SERVICE_ROLE_KEY"),
    execution,
  };
  return value.supabaseUrl && value.publishableKey && value.secretKey ? value : null;
}

function restHeaders(key: string, authorization?: string): Record<string, string> {
  const headers: Record<string, string> = { apikey: key, "Content-Type": "application/json" };
  if (authorization) headers.Authorization = authorization;
  else if (!key.startsWith("sb_secret_")) headers.Authorization = `Bearer ${key}`;
  return headers;
}

async function fetchInternal(env: Environment, input: string, init: RequestInit): Promise<Response> {
  return fetchWithinDeadline(input, init, env.execution, {
    timeoutPolicyMs: 30_000,
    finalizationReserveMs: FINALIZATION_RESERVE_MS,
  });
}

class MarketReviewRpcError extends Error {
  readonly status: number;

  constructor(code: string, status: number) {
    super(code);
    this.name = "MarketReviewRpcError";
    this.status = status;
  }
}

async function rpc(
  env: Environment,
  name: string,
  args: JsonRecord,
  options: { authorization?: string; service?: boolean } = {},
): Promise<JsonRecord> {
  const key = options.service ? env.secretKey : env.publishableKey;
  const response = await fetchInternal(env, `${env.supabaseUrl}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: restHeaders(key, options.service ? undefined : options.authorization),
    body: JSON.stringify(args),
    signal: env.execution.signal,
  });
  const payload = await response.json().catch(() => ({})) as JsonRecord;
  if (!response.ok) {
    console.error("market validation rpc", JSON.stringify({ name, status: response.status }));
    const message = text(payload.message, 200) || text(payload.code, 100) || `RPC_${response.status}`;
    throw new MarketReviewRpcError(message, response.status);
  }
  return payload;
}

async function authenticateDraftAdmin(
  env: Environment,
  authorization: string,
): Promise<{ id: string } | Response> {
  if (!authorization.startsWith("Bearer ")) {
    return jsonResponse({ error: "AUTH_REQUIRED", message: "Inicia sesión para continuar." }, 401);
  }
  const response = await fetchInternal(env, `${env.supabaseUrl}/auth/v1/user`, {
    headers: restHeaders(env.publishableKey, authorization),
    signal: env.execution.signal,
  });
  const user = await response.json().catch(() => ({})) as JsonRecord;
  if (!response.ok || !text(user.id, 80)) {
    return jsonResponse({ error: "AUTH_REQUIRED", message: "Tu sesión no es válida." }, 401);
  }
  const appMetadata = isRecord(user.app_metadata) ? user.app_metadata : {};
  const isAdmin = appMetadata.oraklo_admin === true;
  if (!isAdmin) {
    return jsonResponse({ error: "ADMIN_REQUIRED", message: "Esta herramienta es solo para administración." }, 403);
  }
  return { id: text(user.id, 80) };
}

function validUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

type ReviewRequest = {
  draftId: string;
  expectedVersion: number;
  attemptId: string;
  forceReview: boolean;
  executionProfile: string;
};

function parseReviewRequest(value: JsonRecord): ReviewRequest | null {
  const draftId = text(value.draft_id, 80);
  const expectedVersion = Number(value.expected_version);
  const requestedAttemptId = text(value.attempt_id, 80);
  const attemptId = requestedAttemptId || crypto.randomUUID();
  const executionProfile = text(value.execution_profile, 80) || AI_EXECUTION_PROFILE_STANDARD;
  const singleInferenceSmoke = executionProfile === AI_EXECUTION_PROFILE_SINGLE_INFERENCE_SMOKE_V1;
  if (!validUuid(draftId) || !validUuid(attemptId)
      || !Number.isSafeInteger(expectedVersion) || expectedVersion < 1
      || ![AI_EXECUTION_PROFILE_STANDARD, AI_EXECUTION_PROFILE_SINGLE_INFERENCE_SMOKE_V1].includes(executionProfile)
      || (singleInferenceSmoke && (!requestedAttemptId || value.force_review !== true))) return null;
  return {
    draftId,
    expectedVersion,
    attemptId,
    forceReview: value.force_review === true,
    executionProfile,
  };
}

async function beginDraftReview(
  env: Environment,
  authorization: string,
  request: ReviewRequest,
): Promise<JsonRecord> {
  return rpc(env, "begin_market_draft_review_v2", {
    draft_id_input: request.draftId,
    expected_version_input: request.expectedVersion,
    request_key_input: request.attemptId,
    validator_version_input: VALIDATOR_VERSION,
    policy_version_input: POLICY_VERSION,
    schema_version_input: SCHEMA_VERSION,
    force_review_input: request.forceReview,
  }, { authorization });
}

const ISSUE_FIELD_CONTRACT: Readonly<Record<string, ReadonlySet<string>>> = Object.freeze({
  AMBIGUOUS_CRITERIA: new Set(["question", "yes_criteria", "no_criteria", "public_criteria", "edge_cases", "evaluation_period"]),
  AMBIGUOUS_SUBJECT: new Set(["question", "subject", "yes_criteria"]),
  CONTRADICTORY_CRITERIA: new Set(["question", "yes_criteria", "no_criteria", "public_criteria", "evaluation_period"]),
  INVALID_METRIC: new Set(["question", "yes_criteria", "metric"]),
  INVALID_QUESTION: new Set(["question"]),
  INVALID_TIMEZONE: new Set(["timezone", "evaluation_period"]),
  INSUFFICIENT_EVIDENCE: new Set(["primary_source", "alternative_sources", "market_definition"]),
  MISSING_EDGE_CASES: new Set(["edge_cases"]),
  MISSING_NO_CRITERIA: new Set(["no_criteria"]),
  MISSING_PUBLIC_CRITERIA: new Set(["public_criteria"]),
  MISSING_RESOLUTION_SOURCE: new Set(["primary_source", "alternative_sources"]),
  NON_BINARY_OPTIONS: new Set(["options", "yes_option", "no_option"]),
  TEMPORAL_INCOHERENCE: new Set(["question", "yes_criteria", "evaluation_period", "evaluation_ends_at", "closes_at", "resolution_deadline", "timezone"]),
  UNRESOLVABLE_CONTRACT: new Set(["question", "market_definition", "yes_criteria", "no_criteria", "primary_source"]),
});

function normalizedIssueIdentity(value: unknown): JsonRecord | null {
  if (!isRecord(value)) return null;
  const code = text(value.code, 80).toUpperCase().replace(/[^A-Z0-9_]/g, "_");
  const field = text(value.field, 80).toLowerCase().replace(/[^a-z0-9_]/g, "_");
  const message = text(value.message, 500);
  const allowedFields = ISSUE_FIELD_CONTRACT[code];
  if (!VALIDATOR_CONTENT_ISSUE_CODE_SET.has(code) || !field || message.length < 8
    || (allowedFields && !allowedFields.has(field))) return null;
  return { code, field, message };
}

function safelyDismissedReviewIssue(issue: JsonRecord, draft: JsonRecord): boolean {
  const code = text(issue.code, 80);
  const message = text(issue.message, 500);
  if (code === "INVALID_METRIC") {
    // Rareza o baja probabilidad no son defectos de contrato. Si operador,
    // escala, precisión, fuente y dimensión se infieren de forma determinista,
    // el modelo no puede convertir un umbral extremo en una métrica inválida.
    if (inferMetricContract({ draft })) return true;
    if (/\b(?:at[ií]pic|improbable|unlikely|rare|rar[oa]|extremad|muy\s+(?:alto|bajo))\b/i.test(message)) return true;
  }
  if (code === "TEMPORAL_INCOHERENCE"
    && representationOnlyTemporalIssue(issue, draft)) return true;
  if (code === "INSUFFICIENT_EVIDENCE"
    && attestedPrimarySourceRefutesIssue(issue, draft)) return true;
  return false;
}

function safeIssue(value: unknown, draft: JsonRecord = {}): JsonRecord | null {
  const issue = normalizedIssueIdentity(value);
  if (!issue || safelyDismissedReviewIssue(issue, draft)) return null;
  return issue;
}

const SPANISH_MONTHS = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

function normalizedEvidenceText(value: unknown): string {
  return text(value, 20_000).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function representationOnlyTemporalIssue(issue: JsonRecord, draft: JsonRecord): boolean {
  const field = text(issue.field, 80);
  if (!new Set(["evaluation_ends_at", "timezone"]).has(field)) return false;
  const message = normalizedEvidenceText(issue.message);
  if (!message.includes("utc")
    || !/(?:equival|desfase|offset|zona horaria|horario de verano|hora local)/.test(message)) return false;

  const evaluation = new Date(text(draft.evaluation_ends_at, 100));
  const timezone = text(draft.timezone, 100);
  if (!Number.isFinite(evaluation.getTime()) || !timezone) return false;
  try {
    const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }).formatToParts(evaluation).map((part) => [part.type, part.value]));
    const month = SPANISH_MONTHS[Number(parts.month) - 1];
    const localTime = `${parts.hour}:${parts.minute}`;
    const contractText = normalizedEvidenceText([
      draft.yes_criteria,
      draft.no_criteria,
      draft.public_criteria,
      draft.edge_cases,
      draft.evaluation_period_label,
    ].join(" "));
    const dateMentioned = Boolean(month)
      && contractText.includes(String(Number(parts.day)))
      && contractText.includes(month)
      && contractText.includes(parts.year);
    return dateMentioned && contractText.includes(localTime)
      && contractText.includes(normalizedEvidenceText(timezone));
  } catch {
    return false;
  }
}

function semanticDraft(draft: JsonRecord): JsonRecord {
  return {
    question: text(draft.question),
    subject: text(draft.subject),
    category: text(draft.category),
    yes_option: text(draft.yes_option),
    no_option: text(draft.no_option),
    evaluation_period_label: text(draft.evaluation_period_label),
    evaluation_ends_at: text(draft.evaluation_ends_at),
    closes_at: text(draft.closes_at),
    timezone: text(draft.timezone),
    resolution_deadline: text(draft.resolution_deadline),
    yes_criteria: text(draft.yes_criteria),
    no_criteria: text(draft.no_criteria),
    edge_cases: text(draft.edge_cases),
    primary_source: draft.primary_source,
    alternative_sources: draft.alternative_sources,
    delay_treatment: text(draft.delay_treatment),
    cancellation_treatment: text(draft.cancellation_treatment),
    leak_treatment: text(draft.leak_treatment),
    rename_treatment: text(draft.rename_treatment),
    assumptions: text(draft.assumptions),
    public_criteria: text(draft.public_criteria),
    description: text(draft.description),
  };
}

type NormalizedReview = { result: string; issues: JsonRecord[]; notes: string[] };

function normalizeReview(parsed: JsonRecord, draft: JsonRecord = {}): NormalizedReview | null {
  const result = text(parsed?.result, 40).toLowerCase();
  if (!["approved", "rejected"].includes(result)) return null;
  if (!Array.isArray(parsed.issues)) return null;
  const rawNotes = Array.isArray(parsed.editorial_notes) ? parsed.editorial_notes : [];
  const issues = parsed.issues.map((issue) => safeIssue(issue, draft)).filter((item): item is JsonRecord => Boolean(item)).slice(0, 30);
  if (result === "approved" && parsed.issues.length > 0) return null;
  let normalizedResult = result;
  if (result === "rejected" && issues.length === 0) {
    const everyIssueSafelyDismissed = parsed.issues.length > 0
      && parsed.issues.every((value) => {
        const issue = normalizedIssueIdentity(value);
        return Boolean(issue && safelyDismissedReviewIssue(issue, draft));
      });
    if (!everyIssueSafelyDismissed) return null;
    normalizedResult = "approved";
  }
  const notes = rawNotes.map((item) => text(item, 500)).filter(Boolean).slice(0, 20);
  if (notes.length !== rawNotes.length) return null;
  const evidenced = enforceReviewIssueEvidence(normalizedResult, issues);
  return { result: evidenced.result, issues: evidenced.issues, notes };
}

type ProviderResult = {
  review: NormalizedReview | null;
  technicalStatus: string | null;
  technicalCode: string | null;
  metadata: JsonRecord;
};

function gatewayTechnicalStatus(code: string): string {
  if (code === AI_ERROR_CODES.PROVIDER_RATE_LIMITED || code === AI_ERROR_CODES.BUDGET_EXHAUSTED) return "provider_rate_limited";
  if (new Set<string>([AI_ERROR_CODES.PROVIDER_TIMEOUT, AI_ERROR_CODES.DEADLINE_EXCEEDED]).has(code)) return "provider_timeout";
  if (new Set<string>([
    AI_ERROR_CODES.PROVIDER_INVALID_RESPONSE,
    AI_ERROR_CODES.PROVIDER_RESPONSE_TOO_LARGE,
    AI_ERROR_CODES.OUTPUT_CONTRACT_INVALID,
    AI_ERROR_CODES.OUTPUT_DOMAIN_INVALID,
    AI_ERROR_CODES.OUTPUT_POLICY_INVALID,
  ]).has(code)) return "invalid_response";
  if (code === AI_ERROR_CODES.PROVIDER_AUTH_ERROR) return "provider_auth_error";
  return "provider_unavailable";
}

async function providerReview(
  env: Environment,
  draft: JsonRecord,
  attemptId = env.execution.invocationId,
  executionProfile = AI_EXECUTION_PROFILE_STANDARD,
): Promise<ProviderResult> {
  const gateway = createAiGateway({
    supabaseUrl: env.supabaseUrl,
    supabaseSecretKey: env.secretKey,
  });
  try {
    const result = await gateway.generateStructured({
      taskType: "market_draft_validation",
      ...AI_TASK_CONTRACTS.market_draft_validation,
      input: {
        draft: semanticDraft(draft),
        primarySourceAttested: hasCurrentPrimarySourceAttestation(draft),
      },
    }, { ...env.execution, invocationId: attemptId, executionProfile });
    const review = normalizeReview(result.value as JsonRecord, draft);
    if (!review) throw new Error(AI_ERROR_CODES.OUTPUT_DOMAIN_INVALID);
    return {
      review,
      technicalStatus: null,
      technicalCode: null,
      metadata: {
        gateway_invocation_id: result.metadata.invocationId,
        transport_mode: result.metadata.transportMode,
        execution_profile: result.metadata.executionProfile,
        provider_request_limit: result.metadata.providerRequestLimit,
        input_fingerprint: result.metadata.inputFingerprint,
        output_fingerprint: result.metadata.outputFingerprint,
        telemetry_status: result.telemetryStatus,
        warnings: result.warnings,
      },
    };
  } catch (error) {
    const gatewayError = asAiGatewayError(error);
    return {
      review: null,
      technicalStatus: gatewayTechnicalStatus(gatewayError.code),
      technicalCode: gatewayError.code,
      metadata: {
        gateway_invocation_id: attemptId,
        execution_profile: executionProfile,
        provider_request_limit: executionProfile === AI_EXECUTION_PROFILE_SINGLE_INFERENCE_SMOKE_V1 ? 1 : null,
        telemetry_status: gatewayError.telemetryStatus ?? "unknown",
        warnings: gatewayError.warnings ?? [],
        error_code: gatewayError.code,
      },
    };
  }
}

async function finalizeAutomaticReview(
  env: Environment,
  attemptId: string,
  adminId: string,
  outcome: ProviderResult,
): Promise<JsonRecord> {
  const result = outcome.review?.result || outcome.technicalStatus || "internal_error";
  return rpc(env, "record_market_draft_review_v2", {
    attempt_id_input: attemptId,
    result_input: result,
    semantic_issues_input: outcome.review?.issues || [],
    editorial_notes_input: outcome.review?.notes || [],
    reviewed_by_input: adminId,
    technical_code_input: outcome.technicalCode,
    safe_provider_metadata_input: outcome.metadata,
  }, { service: true });
}

function technicalHttpStatus(status: string): number {
  if (status === "provider_rate_limited") return 429;
  if (status === "provider_timeout") return 504;
  if (status === "invalid_response") return 502;
  if (status === "stale") return 409;
  return 503;
}

async function validateDraft(request: Request, env: Environment, authorization: string): Promise<Response> {
  const admin = await authenticateDraftAdmin(env, authorization);
  if (admin instanceof Response) return admin;

  const rawBody = await request.text();
  if (new TextEncoder().encode(rawBody).byteLength > MAX_REQUEST_BYTES) {
    return jsonResponse({ error: "REQUEST_TOO_LARGE", message: "La petición es demasiado grande." }, 413);
  }
  let body: JsonRecord = {};
  try {
    const parsed = rawBody ? JSON.parse(rawBody) as unknown : {};
    if (isRecord(parsed)) body = parsed;
  } catch {
    return jsonResponse({ error: "INVALID_REVIEW_REQUEST", message: "La petición no contiene JSON válido." }, 400);
  }
  const reviewRequest = parseReviewRequest(body);
  if (!reviewRequest) {
    return jsonResponse({ error: "INVALID_REVIEW_REQUEST", message: "El borrador, la versión o el intento no son válidos." }, 400);
  }

  const beginning = await beginDraftReview(env, authorization, reviewRequest);

  const beginStatus = text(beginning.status, 80);
  if (beginning.idempotency_replay === true && beginning.completed === true) {
    const classification = text(beginning.classification, 40);
    if (classification === "technical") {
      return jsonResponse({
        ok: false,
        status: beginStatus,
        classification: "technical",
        technical_code: beginning.technical_code,
        effective_review_preserved: beginning.effective_review_preserved === true,
        effective_review_id: beginning.effective_review_id,
        attempt_id: beginning.attempt_id,
        idempotency_replay: true,
        message: beginning.effective_review_preserved === true
          ? "La incidencia técnica ya estaba registrada y la aprobación efectiva continúa vigente."
          : "La incidencia técnica ya estaba registrada. El borrador continúa listo para reintentar.",
      }, technicalHttpStatus(beginStatus));
    }
    return jsonResponse({
      ok: beginStatus === "approved",
      status: beginStatus,
      classification: "content",
      blocking_reasons: Array.isArray(beginning.blocking_reasons) ? beginning.blocking_reasons : [],
      editorial_notes: Array.isArray(beginning.editorial_notes) ? beginning.editorial_notes : [],
      attempt_id: beginning.attempt_id,
      effective_review_id: beginning.effective_review_id,
      idempotency_replay: true,
      message: beginStatus === "approved"
        ? "La aprobación de este intento ya estaba registrada."
        : "El resultado de contenido de este intento ya estaba registrado.",
    });
  }
  if (beginStatus === "rejected") {
    return jsonResponse({
      ok: false,
      status: "rejected",
      classification: "content",
      blocking_reasons: Array.isArray(beginning.blocking_reasons) ? beginning.blocking_reasons : [],
      message: "La revisión determinista encontró errores reales de contenido.",
    });
  }
  if (beginStatus === "approved_cached") {
    return jsonResponse({
      ok: true,
      status: "approved",
      cached: true,
      effective_review_id: beginning.effective_review_id,
      message: text(beginning.message) || "La versión ya tiene una aprobación efectiva compatible.",
    });
  }
  if (beginStatus === "already_in_progress" || (beginning.idempotency_replay === true && !isRecord(beginning.draft))) {
    return jsonResponse({
      ok: true,
      status: beginStatus,
      attempt_id: beginning.attempt_id,
      message: text(beginning.message) || "La revisión ya está registrada o continúa en curso.",
    }, beginStatus === "already_in_progress" ? 202 : 200);
  }
  const draft = isRecord(beginning.draft) ? beginning.draft : null;
  const attemptId = text(beginning.attempt_id, 80);
  if (!draft || !validUuid(attemptId)) throw new Error("INVALID_BEGIN_REVIEW_RESPONSE");

  const primarySourceAttestation = await rpc(env, "get_market_draft_primary_source_attestation_v1", {
    draft_id_input: reviewRequest.draftId,
    expected_version_input: reviewRequest.expectedVersion,
  }, { service: true });
  const reviewDraft = { ...draft, _primary_source_attestation: primarySourceAttestation };
  const outcome = await providerReview(env, reviewDraft, attemptId, reviewRequest.executionProfile);
  const recorded = await finalizeAutomaticReview(env, attemptId, admin.id, outcome);
  if (!outcome.review) {
    return jsonResponse({
      ok: false,
      status: outcome.technicalStatus,
      classification: "technical",
      technical_code: outcome.technicalCode,
      effective_review_preserved: recorded.effective_review_preserved === true,
      effective_review_id: recorded.effective_review_id,
      attempt_id: attemptId,
      retryable: true,
      retry_after_seconds: outcome.metadata.retry_after_seconds ?? null,
      retry_after_at: outcome.metadata.retry_after_at ?? null,
      telemetry_status: outcome.metadata.telemetry_status ?? "unknown",
      warnings: outcome.metadata.warnings ?? [],
      state_preserved: true,
      message: text(recorded.message) || "La incidencia técnica quedó registrada. El mercado continúa privado.",
    }, technicalHttpStatus(outcome.technicalStatus || "internal_error"));
  }

  return jsonResponse({
    ok: outcome.review.result === "approved",
    status: outcome.review.result,
    classification: "content",
    blocking_reasons: outcome.review.issues,
    editorial_notes: outcome.review.notes,
    attempt_id: attemptId,
    effective_review_id: recorded.effective_review_id,
    telemetry_status: outcome.metadata.telemetry_status ?? "unknown",
    warnings: outcome.metadata.warnings ?? [],
    message: text(recorded.message) || "La revisión de contenido terminó.",
  });
}

// Superficie pura para la matriz local. El runtime HTTP no la utiliza y no
// contiene configuración, credenciales ni estado de producción.
export const validatorTestSurface = Object.freeze({
  semanticDraft,
  representationOnlyTemporalIssue,
  normalizeReview,
  providerReview,
  technicalHttpStatus,
});

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (request.method !== "POST") {
    return jsonResponse({ error: "METHOD_NOT_ALLOWED", message: "Usa una petición POST." }, 405);
  }
  const operation = createAbsoluteExecutionContext({
    durationMs: OPERATION_TIMEOUT_MS,
    parentSignal: request.signal,
  });
  const env = environment(operation.context);
  if (!env) {
    operation.cleanup();
    console.error("market validation missing Supabase configuration");
    return jsonResponse({ error: "SERVER_NOT_CONFIGURED", message: "La revisión segura no está configurada." }, 503);
  }
  try {
    return await validateDraft(request, env, request.headers.get("authorization") ?? "");
  } catch (error) {
    const code = text(error instanceof Error ? error.message : error, 120);
    console.error("market validation failed", JSON.stringify({ code: /^[A-Z0-9_]+$/.test(code) ? code : "INTERNAL" }));
    const conflict = /VERSION|MOVED|IN_PROGRESS|STALE/.test(code);
    const upstreamStatus = error instanceof MarketReviewRpcError ? error.status : 0;
    const status = [400, 401, 403, 404, 409, 422, 429, 503, 504].includes(upstreamStatus)
      ? upstreamStatus
      : conflict ? 409 : 500;
    const retryable = status === 429 || status >= 500;
    return jsonResponse({
      error: conflict ? "REVIEW_VERSION_MOVED"
        : /^[A-Z][A-Z0-9_]{2,119}$/.test(code) ? code : "REVIEW_FAILED_CLOSED",
      message: conflict
        ? "El borrador cambió o ya tiene una revisión en curso. Recárgalo antes de reintentar."
        : "La revisión no pudo completarse. El mercado continúa privado.",
      classification: retryable ? "technical" : "domain",
      retryable,
      state_preserved: true,
    }, status);
  } finally {
    operation.cleanup();
  }
});
