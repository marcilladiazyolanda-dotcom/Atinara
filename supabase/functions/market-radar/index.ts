import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  RADAR_API_HOSTS,
  RADAR_CANDIDATE_PROVIDERS,
  RADAR_CATEGORIES,
  RADAR_ENRICHMENT_CAPABILITIES,
  RADAR_ELIGIBILITY_POLICY_VERSION,
  RADAR_FACT_POLICY_VERSION,
  RADAR_NORMALIZER_VERSION,
  RADAR_PROVIDER_ROLE_VERSION,
  RADAR_PROVIDERS,
  RADAR_REASON_CODES,
  adaptKalshiResponse,
  adaptPolymarketResponse,
  applyDeterministicRadarEligibility,
  applyEligibilityDecision,
  buildCacheKey,
  buildCoverResolutionSignals,
  buildDraftPrefill,
  buildResolutionAuthorityEvidence,
  canReuseRadarVerification,
  candidateResolutionSubject,
  cleanText,
  detectOfficialCoverEventResolution,
  detectOfficialCoverSelectionHold,
  deriveDeterministicUnresolvedProof,
  evidenceHasPotentialTerminalClaim,
  evaluateGamingDomain,
  evaluateProviderEligibility,
  extractOfficialHtmlText,
  extractOfficialRelatedUrls,
  groupCandidates,
  hasSpeculativeEvidenceLanguage,
  isAdaptedIdeaComplete,
  isBlockingDuplicateMatch,
  isRecord,
  isResolutionAuthorityEvidence,
  isVerifiedOfficialEvidence,
  isVerifiedTerminalEvidence,
  normalizeProviderResult,
  normalizeRadarCandidatePresentation,
  paginateMergedRadarParents,
  officialEvidenceSegmentsForSubject,
  officialSelectionEditionCoverage,
  providerResolutionSourceUrls,
  providerResultLabel,
  projectRadarDomainReview,
  publicProviderError,
  radarDomainFingerprintV1,
  safeIsoDate,
  safeNumber,
  safePublicUrl,
  scoreCandidates,
  selectVerifiedResolutionUrl,
  summarizeRejections,
} from "../_shared/market-radar.mjs";
import {
  createMarketWorkflowIssue,
  publicMarketWorkflowIssue,
} from "../_shared/market-workflow-issues.mjs";
import {
  createAtinaraTemporalContract,
} from "../_shared/market-temporal-contract.mjs";
import { createAbsoluteExecutionContext, createChildAbort, deadlineSleep, fetchWithinDeadline } from "../_shared/ai/deadline.mjs";
import { createAiPersistence } from "../_shared/ai/persistence.mjs";
import { persistAgentTelemetry } from "../_shared/ai/telemetry.mjs";
import { canonicalJson, sha256Hex } from "../_shared/ai/contracts.mjs";
import { ATINARA_AGENT_REGISTRY_VERSION, assertAgentRegistrySnapshot } from "../_shared/atinara-agent-registries-v2.mjs";
import { createAtinaraAgentRunV2 } from "../_shared/atinara-agent-runtime-v2.mjs";

type JsonRecord = Record<string, unknown>;
type Environment = NonNullable<ReturnType<typeof getEnvironment>>;

const MAX_REQUEST_BYTES = 8_192;
const OPERATION_TIMEOUT_MS = 135_000;
const FINALIZATION_RESERVE_MS = 15_000;
const PROVIDER_TIMEOUT_MS = 14_000;
const MAX_PROVIDER_PAGES = 3;
const MAX_NORMALIZED_PER_PROVIDER = 240;
const RADAR_PERSISTENCE_BATCH_SIZE = 24;
const MAX_PERSISTENCE_RPC_CALLS_PER_PROVIDER = 64;
const PERSISTENCE_ISOLATION_BUDGET_MS = 20_000;
const PERSISTENCE_RPC_START_MARGIN_MS = 750;
const RADAR_REFRESH_REQUEST_VERSION = "atinara-radar-refresh-request-v1";
const RADAR_REFRESH_MAX_PROCESS_CALLS = 24;
const MAX_VISIBLE_GROUPS = 60;
const MAX_AI_ENRICHMENT_GROUPS = 30;
const MAX_AI_ENRICHMENT_CANDIDATES = 180;
const AI_ENRICHMENT_BATCH_SIZE = 9;
const TAVILY_CONCURRENCY = 4;
const MAX_KALSHI_SERIES = 25;
const KALSHI_CONCURRENCY = 4;
const MAX_REJECTED_OUTCOME_RECONCILIATIONS = 16;
const MAX_CANONICAL_EVENT_CHILDREN = 240;
const REFRESH_COOLDOWN_MS = 60_000;
const VERIFICATION_TTL_MINUTES = 360;
const FACT_CHECK_TTL_MINUTES = 20;
const MAX_OFFICIAL_SOURCE_URLS = 30;
const MAX_OFFICIAL_SOURCE_REDIRECTS = 2;
const MAX_OFFICIAL_SOURCE_BYTES = 750_000;
const OFFICIAL_SOURCE_FETCH_TIMEOUT_MS = 5_000;
const OFFICIAL_SOURCE_BUDGET_MS = 10_000;
const OFFICIAL_SOURCE_CONCURRENCY = 4;
const MAX_RELATED_OFFICIAL_SOURCE_URLS = 18;
const MAX_RELATED_OFFICIAL_SOURCE_URLS_PER_GROUP = 3;
const OFFICIAL_RELATED_SOURCE_BUDGET_MS = 10_000;
const MAX_SELECTION_FOLLOWUP_GROUPS = 4;
const MAX_SELECTION_FOLLOWUP_URLS_PER_GROUP = 6;
const TAVILY_SELECTION_FOLLOWUP_CONCURRENCY = 4;
const TAVILY_SELECTION_FOLLOWUP_TIMEOUT_MS = 5_000;
const OFFICIAL_SELECTION_FOLLOWUP_BUDGET_MS = 12_000;
const MAX_PROVIDER_RETRY_DELAY_MS = 8_000;
const PROVIDER_RETRY_JITTER_MS = 250;

const KALSHI_API_ROOT = "https://api.elections.kalshi.com/trade-api/v2";
const POLYMARKET_GAMMA_ROOT = "https://gamma-api.polymarket.com";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function toRecord(value: unknown): JsonRecord | null {
  return isRecord(value) ? value as JsonRecord : null;
}

function toRecordArray(value: unknown): JsonRecord[] {
  return Array.isArray(value) ? value.filter(isRecord).map((item) => item as JsonRecord) : [];
}

function jsonResponse(body: JsonRecord, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

type RadarCandidateQuarantine = {
  provider: string;
  external_id: string;
  fingerprint: string | null;
  stage: "authoritative_persistence";
  code: string;
  database_code: string | null;
  operation: string;
};

type RadarPersistenceDeferredBatch = {
  provider: string;
  external_ids: string[];
  candidate_count: number;
  stage: "authoritative_persistence";
  code: "RADAR_PERSISTENCE_ISOLATION_DEFERRED";
};

type PersistenceIsolationBudget = {
  deadlineAt: number;
  remainingRpcCalls: number;
  usedRpcCalls: number;
};

type ProviderPersistenceOutcome = {
  persistedCount: number;
  quarantined: RadarCandidateQuarantine[];
  deferred: RadarPersistenceDeferredBatch[];
  persistenceRpcCalls: number;
  failure: ReturnType<typeof publicProviderError> | null;
};

type RadarRefreshIntent = {
  requestId: string;
  provider: string;
  capability: "candidate_feed" | "source_enrichment";
  leaseToken: string | null;
  phase: string;
  terminal: boolean;
  replayed: boolean;
  inProgress: boolean;
  responseSummary: JsonRecord | null;
  expectedCount: number | null;
  stagedCount: number;
};

type RadarRefreshContext = {
  requestId: string;
  requestHash: string;
  leaseOwner: string;
  intents: Map<string, RadarRefreshIntent>;
};

type FetchJsonOptions = {
  onRateLimit?: (error: ProviderRequestError) => void;
  execution?: Environment["execution"];
};

type RpcOptions = {
  signal?: AbortSignal;
};

class ProviderRequestError extends Error {
  readonly code: string;
  readonly status: number;
  readonly retryAfterMs: number | null;

  constructor(code: string, status: number, retryAfterMs: number | null = null) {
    super(code);
    this.name = "ProviderRequestError";
    this.code = code;
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

class RadarRpcError extends Error {
  readonly operation: string;
  readonly status: number;
  readonly databaseCode: string;
  readonly databaseMessage: string;

  constructor(operation: string, status: number, databaseCode: string, databaseMessage: string) {
    super(`RADAR_RPC_${status}`);
    this.name = "RadarRpcError";
    this.operation = operation;
    this.status = status;
    this.databaseCode = databaseCode;
    this.databaseMessage = databaseMessage;
  }
}

class RadarPersistenceError extends Error {
  readonly failure: ReturnType<typeof publicProviderError>;
  readonly outcome: ProviderPersistenceOutcome;

  constructor(failure: ReturnType<typeof publicProviderError>, outcome: ProviderPersistenceOutcome) {
    super(failure.code);
    this.name = "RadarPersistenceError";
    this.failure = failure;
    this.outcome = outcome;
  }
}

class RadarRevalidationOutcomeError extends Error {
  readonly code: string;
  readonly candidate: JsonRecord;

  constructor(code: string, candidate: JsonRecord) {
    const safeCode = /^[A-Z][A-Z0-9_]{2,100}$/.test(code) ? code : "RADAR_REVALIDATION_REQUIRED";
    super(safeCode);
    this.name = "RadarRevalidationOutcomeError";
    this.code = safeCode;
    this.candidate = candidate;
  }
}

function getPublishableKey(): string {
  const configured = Deno.env.get("SUPABASE_PUBLISHABLE_KEYS");
  if (configured) {
    try {
      const parsed = JSON.parse(configured) as Record<string, string>;
      if (parsed.default) return parsed.default;
    } catch {
      // Compatibilidad con la configuración anterior.
    }
  }
  return Deno.env.get("SUPABASE_ANON_KEY") ?? "";
}

function getSecretKey(): string {
  const configured = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (configured) {
    try {
      const parsed = JSON.parse(configured) as Record<string, string>;
      if (parsed.default) return parsed.default;
    } catch {
      // Compatibilidad temporal con service_role.
    }
  }
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
}

function getEnvironment(execution: {
  invocationId: string;
  agentRunId: string | null;
  absoluteDeadlineAt: number;
  signal: AbortSignal;
}) {
  const environment = {
    supabaseUrl: Deno.env.get("SUPABASE_URL") ?? "",
    publishableKey: getPublishableKey(),
    secretKey: getSecretKey(),
    tavilyKey: Deno.env.get("TAVILY_API_KEY") ?? "",
    execution,
  };
  return environment.supabaseUrl && environment.publishableKey && environment.secretKey ? environment : null;
}

function restHeaders(key: string, authorization?: string): Record<string, string> {
  const headers: Record<string, string> = { apikey: key, "Content-Type": "application/json" };
  if (authorization) headers.Authorization = authorization;
  else if (!key.startsWith("sb_secret_")) headers.Authorization = `Bearer ${key}`;
  return headers;
}

async function fetchInternal(environment: Environment, input: string, init: RequestInit): Promise<Response> {
  return fetchWithinDeadline(input, init, environment.execution, {
    timeoutPolicyMs: 30_000,
    finalizationReserveMs: FINALIZATION_RESERVE_MS,
  });
}

async function rpc(
  environment: Environment,
  name: string,
  args: JsonRecord,
  authorization?: string,
  service = false,
  options: RpcOptions = {},
): Promise<unknown> {
  const key = service ? environment.secretKey : environment.publishableKey;
  const response = await fetchInternal(environment, `${environment.supabaseUrl}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: restHeaders(key, service ? undefined : authorization),
    body: JSON.stringify(args),
    signal: options.signal ?? environment.execution.signal,
  });
  const payload = await response.json().catch(() => ({})) as unknown;
  if (!response.ok) {
    const errorPayload = toRecord(payload);
    const databaseCode = cleanText(errorPayload?.code, 40);
    const rawMessage = cleanText(errorPayload?.message, 120);
    const databaseMessage = /^[A-Z][A-Z0-9_]{2,100}$/.test(rawMessage) ? rawMessage : "";
    console.error("Radar RPC failed", JSON.stringify({
      name,
      status: response.status,
      code: databaseCode || null,
      rule: databaseMessage || null,
    }));
    throw new RadarRpcError(name, response.status, databaseCode, databaseMessage);
  }
  return payload;
}

function validUuid(value: unknown): value is string {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    .test(cleanText(value, 80));
}

function refreshIntentKey(provider: string, capability: string): string {
  return `${cleanText(provider, 40)}:${cleanText(capability, 40)}`;
}

async function radarRefreshIssue({
  requestId,
  provider,
  capability,
  code,
  failureStage,
  lastSuccessAt = null,
  lastSuccessCount = 0,
}: {
  requestId: string;
  provider: string;
  capability: "candidate_feed" | "source_enrichment";
  code: string;
  failureStage: "fetch" | "persistence" | "enrichment";
  lastSuccessAt?: unknown;
  lastSuccessCount?: unknown;
}) {
  const ownerStage = failureStage === "persistence" ? "internal_platform" : "provider";
  const nextAction = failureStage === "persistence"
    ? "resume_persistence_intent"
    : capability === "source_enrichment" ? "retry_source_enrichment" : "retry_provider_refresh";
  return createMarketWorkflowIssue({
    issueCode: code,
    detectedBy: "radar",
    ownerStage,
    severity: "warning",
    repairability: "auto_recoverable",
    blockingScope: "none",
    affectedFields: [],
    evidenceRefs: [{ request_id: requestId, provider, capability }],
    currentValue: {
      provider,
      capability,
      failure_stage: failureStage,
      last_success_at: safeIsoDate(lastSuccessAt),
      last_success_count: Math.max(0, Number(lastSuccessCount) || 0),
    },
    proposedValue: null,
    confidence: 100,
    policyVersion: "atinara-radar-provider-resilience-v1",
    retryable: true,
    nextAction,
  });
}

const RADAR_TERMINAL_WORKFLOW_CODES = new Set<string>([
  RADAR_REASON_CODES.EVENT_ALREADY_RESOLVED,
  RADAR_REASON_CODES.EVENT_OUTSIDE_CONTRACT,
  RADAR_REASON_CODES.DUPLICATE_MARKET,
  RADAR_REASON_CODES.OUTSIDE_GAMING_DOMAIN,
  RADAR_REASON_CODES.PROVIDER_NOT_OPEN,
  RADAR_REASON_CODES.PROVIDER_OPTION_INACTIVE,
  RADAR_REASON_CODES.PROVIDER_EVENT_NOT_FOUND,
  RADAR_REASON_CODES.PROVIDER_CHILD_NOT_FOUND,
]);
const RADAR_SOURCE_CONTRACT_WORKFLOW_CODES = new Set<string>([
  RADAR_REASON_CODES.INVALID_OR_UNVERIFIED_SOURCE,
  RADAR_REASON_CODES.RESOLUTION_SOURCE_AUTHORITY_PENDING,
  RADAR_REASON_CODES.TEMPORAL_INCOHERENCE,
]);
const RADAR_TECHNICAL_HOLD_WORKFLOW_CODES = new Set<string>([
  RADAR_REASON_CODES.SOURCE_STALE,
  RADAR_REASON_CODES.SUBJECT_NOT_ANNOUNCED,
  RADAR_REASON_CODES.OFFICIAL_TERMINAL_SCAN_UNAVAILABLE,
  RADAR_REASON_CODES.OFFICIAL_SELECTION_RECHECK_REQUIRED,
]);
const RADAR_ELIGIBILITY_RECOVERY_WORKFLOW_CODES = new Set<string>([
  RADAR_REASON_CODES.VERIFICATION_REQUIRED,
  RADAR_REASON_CODES.VERIFICATION_EXPIRED,
]);

async function candidateDecisionWorkflowIssue(candidate: JsonRecord, code: string) {
  const terminal = RADAR_TERMINAL_WORKFLOW_CODES.has(code);
  const gamingReview = code === RADAR_REASON_CODES.GAMING_DOMAIN_REVIEW_REQUIRED;
  const placeholder = code === RADAR_REASON_CODES.PROVIDER_PLACEHOLDER;
  const sourceContract = RADAR_SOURCE_CONTRACT_WORKFLOW_CODES.has(code);
  const technicalHold = RADAR_TECHNICAL_HOLD_WORKFLOW_CODES.has(code);
  const ownerStage = terminal ? "radar" : gamingReview ? "human_review"
    : sourceContract ? "editor" : technicalHold || placeholder ? "provider" : "radar";
  const repairability = terminal ? "terminal" : gamingReview ? "human_editable"
    : sourceContract ? "waiting_authoritative_source" : "auto_recoverable";
  const blockingScope = terminal ? "terminal" : gamingReview || sourceContract
    || RADAR_ELIGIBILITY_RECOVERY_WORKFLOW_CODES.has(code)
    ? "approval" : "none";
  const nextAction = terminal ? "archive_terminal_candidate"
    : gamingReview ? "review_gaming_domain_manually"
    : sourceContract ? "repair_temporal_or_source_contract"
    : placeholder ? "recheck_provider_identity"
    : technicalHold ? "retry_source_enrichment" : "refresh_draft_eligibility";
  return createMarketWorkflowIssue({
    issueCode: code,
    detectedBy: "radar",
    ownerStage,
    severity: terminal || blockingScope !== "none" ? "blocking" : "warning",
    repairability,
    blockingScope,
    affectedFields: code === RADAR_REASON_CODES.EVENT_ALREADY_RESOLVED
      ? ["source_status", "source_result"] : ["eligibility_status", "domain_status", "resolution_source"],
    evidenceRefs: [{
      provider: cleanText(candidate.provider, 40),
      external_id: cleanText(candidate.external_id, 220),
      eligibility_check_id: candidate.current_eligibility_check_id ?? null,
    }],
    currentValue: {
      eligibility_status: candidate.eligibility_status ?? null,
      eligibility_reason_code: candidate.eligibility_reason_code ?? null,
      domain_status: candidate.domain_status ?? null,
    },
    proposedValue: null,
    confidence: terminal ? 100 : Number(candidate.eligibility_confidence) || 0,
    policyVersion: cleanText(
      gamingReview ? candidate.domain_policy_version : candidate.eligibility_policy_version,
      100,
    ) || RADAR_ELIGIBILITY_POLICY_VERSION,
    retryable: !terminal,
    nextAction,
  }) as Promise<JsonRecord>;
}

async function beginRadarRefreshIntent(
  environment: Environment,
  authorization: string,
  refresh: RadarRefreshContext,
  provider: string,
  capability: "candidate_feed" | "source_enrichment",
  cacheKey: string,
): Promise<RadarRefreshIntent> {
  const probe = toRecord(await rpc(environment, "claim_market_radar_provider_probe_v1", {
    provider_input: provider,
    capability_input: capability,
    request_id_input: refresh.requestId,
  }, authorization));
  if (probe?.allowed !== true) {
    const issue = await radarRefreshIssue({
      requestId: refresh.requestId,
      provider,
      capability,
      code: "PROVIDER_CIRCUIT_OPEN",
      failureStage: capability === "source_enrichment" ? "enrichment" : "fetch",
      lastSuccessAt: probe?.last_success_at,
      lastSuccessCount: probe?.last_success_count,
    });
    const blocked: RadarRefreshIntent = {
      requestId: refresh.requestId,
      provider,
      capability,
      leaseToken: null,
      phase: cleanText(probe?.state, 40) || "open",
      terminal: false,
      replayed: false,
      inProgress: true,
      responseSummary: { issue, retry_after_at: probe?.retry_after_at ?? null },
      expectedCount: null,
      stagedCount: 0,
    };
    refresh.intents.set(refreshIntentKey(provider, capability), blocked);
    return blocked;
  }
  const started = toRecord(await rpc(environment, "begin_market_radar_refresh_v2", {
    request_id_input: refresh.requestId,
    provider_input: provider,
    capability_input: capability,
    request_hash_input: refresh.requestHash,
    cache_key_input: cacheKey,
    normalizer_version_input: RADAR_NORMALIZER_VERSION,
    policy_version_input: RADAR_ELIGIBILITY_POLICY_VERSION,
    lease_owner_input: refresh.leaseOwner,
    probe_lease_token_input: validUuid(probe?.probe_lease_token)
      ? cleanText(probe?.probe_lease_token, 80) : null,
  }, authorization));
  const canonicalRequestId = cleanText(started?.request_id,80);
  if (started?.in_progress === true && validUuid(canonicalRequestId)) {
    refresh.requestId = canonicalRequestId;
  }
  const status = cleanText(started?.status, 40) || "in_progress";
  const intent: RadarRefreshIntent = {
    requestId: validUuid(canonicalRequestId) ? canonicalRequestId : refresh.requestId,
    provider,
    capability,
    leaseToken: validUuid(started?.lease_token) ? cleanText(started?.lease_token, 80) : null,
    phase: cleanText(started?.phase, 40) || "claimed",
    terminal: status !== "in_progress",
    replayed: started?.replayed === true,
    inProgress: started?.in_progress === true,
    responseSummary: toRecord(started?.response_summary),
    expectedCount: Number.isSafeInteger(Number(started?.expected_count))
      ? Number(started?.expected_count) : null,
    stagedCount: Math.max(0, Number(started?.staged_count) || 0),
  };
  refresh.intents.set(refreshIntentKey(provider, capability), intent);
  return intent;
}

async function renewRadarRefreshLease(environment: Environment, intent: RadarRefreshIntent) {
  if (!intent.leaseToken) throw new Error("RADAR_REFRESH_LEASE_REQUIRED");
  return rpc(environment, "renew_market_radar_refresh_lease_v1", {
    request_id_input: intent.requestId,
    provider_input: intent.provider,
    capability_input: intent.capability,
    lease_token_input: intent.leaseToken,
  }, undefined, true);
}

async function authenticateAdmin(environment: Environment, authorization: string): Promise<{ adminId: string } | Response> {
  const response = await fetchInternal(environment, `${environment.supabaseUrl}/auth/v1/user`, {
    headers: { Authorization: authorization, apikey: environment.publishableKey },
    signal: environment.execution.signal,
  });
  if (!response.ok) return jsonResponse({ error: "AUTH_REQUIRED", message: "Inicia sesión para usar el Radar." }, 401);
  const user = await response.json() as JsonRecord;
  const appMetadata = toRecord(user.app_metadata) ?? {};
  if (appMetadata.oraklo_admin !== true) {
    return jsonResponse({ error: "ADMIN_REQUIRED", message: "El Radar es una herramienta administrativa privada." }, 403);
  }
  return { adminId: cleanText(user.id, 80) };
}

function validateApiUrl(url: URL): boolean {
  return url.protocol === "https:" && RADAR_API_HOSTS.includes(url.hostname.toLowerCase());
}

function retryAfterMilliseconds(headers: Headers, nowMs = Date.now()): number | null {
  const value = cleanText(headers.get("retry-after"), 100);
  if (!value) return null;
  if (/^[0-9]+(?:\.[0-9]+)?$/.test(value)) {
    return Math.max(0, Math.ceil(Number(value) * 1_000));
  }
  const dateValue = Date.parse(value);
  return Number.isFinite(dateValue) ? Math.max(0, dateValue - nowMs) : null;
}

function providerRetryDelay(attempt: number): number {
  const entropy = crypto.getRandomValues(new Uint32Array(1))[0];
  const jitter = entropy % (PROVIDER_RETRY_JITTER_MS + 1);
  return Math.min(MAX_PROVIDER_RETRY_DELAY_MS, (500 * (2 ** attempt)) + jitter);
}

function isProviderRateLimit(error: unknown): error is ProviderRequestError {
  return error instanceof ProviderRequestError
    ? error.code === "PROVIDER_RATE_LIMITED" || error.status === 429
    : error instanceof Error && /PROVIDER_RATE_LIMITED|HTTP_429/.test(error.message);
}

async function fetchJson(
  url: URL,
  init: RequestInit = {},
  timeoutMs = PROVIDER_TIMEOUT_MS,
  options: FetchJsonOptions = {},
): Promise<unknown> {
  if (!validateApiUrl(url)) throw new Error("PROVIDER_HOST_NOT_ALLOWED");
  const execution = options.execution;
  if (!execution) throw new Error("ABSOLUTE_DEADLINE_REQUIRED");
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const child = createChildAbort(execution, timeoutMs, FINALIZATION_RESERVE_MS);
    try {
      const response = await fetch(url, { ...init, signal: child.signal });
      if (response.ok) {
        const text = await response.text();
        if (text.length > 3_000_000) throw new Error("PROVIDER_RESPONSE_TOO_LARGE");
        try {
          return JSON.parse(text);
        } catch {
          throw new Error("PROVIDER_INVALID_RESPONSE");
        }
      }
      if (response.status === 429) {
        const retryAfterMs = retryAfterMilliseconds(response.headers);
        const rateLimitError = new ProviderRequestError("PROVIDER_RATE_LIMITED", 429, retryAfterMs);
        options.onRateLimit?.(rateLimitError);
        const delayMs = retryAfterMs ?? providerRetryDelay(attempt);
        if (attempt === 0 && delayMs <= MAX_PROVIDER_RETRY_DELAY_MS) {
          await deadlineSleep(delayMs, execution, FINALIZATION_RESERVE_MS);
          continue;
        }
        throw rateLimitError;
      }
      if (response.status >= 500) {
        if (attempt === 0) {
          await deadlineSleep(providerRetryDelay(attempt), execution, FINALIZATION_RESERVE_MS);
          continue;
        }
        throw new ProviderRequestError(`PROVIDER_HTTP_${response.status}`, response.status);
      }
      throw new ProviderRequestError(`PROVIDER_HTTP_${response.status}`, response.status);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") throw new Error("PROVIDER_TIMEOUT");
      if (error instanceof ProviderRequestError
        || attempt === 1
        || (error instanceof Error && /INVALID|NOT_ALLOWED|TOO_LARGE|HTTP_4(?!29)/.test(error.message))) throw error;
      await deadlineSleep(providerRetryDelay(attempt), execution, FINALIZATION_RESERVE_MS);
    } finally {
      child.cleanup();
    }
  }
  throw new Error("PROVIDER_UNAVAILABLE");
}

async function verifyPublicUrl(
  value: string,
  allowedHost: string,
  execution: Environment["execution"],
): Promise<string | null> {
  const initial = safePublicUrl(value, [allowedHost]);
  if (!initial) return null;
  const child = createChildAbort(execution, PROVIDER_TIMEOUT_MS, FINALIZATION_RESERVE_MS);
  try {
    const response = await fetch(initial, { method: "GET", redirect: "follow", signal: child.signal, headers: { Accept: "text/html" } });
    if (!response.ok) return null;
    return safePublicUrl(response.url, [allowedHost]);
  } catch {
    return null;
  } finally {
    child.cleanup();
  }
}

function providerFailure(error: unknown, provider: string) {
  const raw = error instanceof Error ? error.message : "PROVIDER_UNAVAILABLE";
  const code = raw.includes("TIMEOUT") ? "PROVIDER_TIMEOUT"
    : raw.includes("RATE_LIMITED") || raw.includes("429") ? "PROVIDER_RATE_LIMITED"
      : raw.includes("INVALID") || raw.includes("TOO_LARGE") || raw.includes("HTTP_400") ? "PROVIDER_INVALID_RESPONSE"
        : "PROVIDER_UNAVAILABLE";
  const publicError = publicProviderError(provider, code, code === "PROVIDER_RATE_LIMITED" ? 429 : 502);
  const retryAfterMs = error instanceof ProviderRequestError ? error.retryAfterMs : null;
  return {
    ...publicError,
    retry_after_seconds: retryAfterMs === null ? null : Math.max(0, Math.ceil(retryAfterMs / 1_000)),
    retry_after_at: retryAfterMs === null ? null : new Date(Date.now() + retryAfterMs).toISOString(),
    retryable: ["PROVIDER_RATE_LIMITED", "PROVIDER_TIMEOUT", "PROVIDER_UNAVAILABLE", "PROVIDER_HTTP_5XX"].includes(code),
  };
}

function persistenceFailure(error: unknown, provider: string) {
  const timedOut = error instanceof RadarRpcError
    ? error.databaseCode === "57014" || error.status === 504
    : error instanceof Error && /TIMEOUT|ABORT/i.test(error.message);
  return publicProviderError(
    provider,
    timedOut ? "RADAR_PERSISTENCE_TIMEOUT" : "RADAR_PERSISTENCE_FAILED",
    timedOut ? 503 : 502,
  );
}

const QUARANTINABLE_PERSISTENCE_RULES = new Set([
  "INVALID_RADAR_CANDIDATE",
  "INCOMPLETE_RADAR_VERIFICATION",
  "RADAR_BATCH_TOO_LARGE",
  "INVALID_RADAR_FACT_CHECK_V2",
  "INVALID_RADAR_FACT_SNAPSHOT_V2",
  "INVALID_RADAR_FACT_CHECK_DATE",
  "RADAR_FACT_EVIDENCE_REQUIRED",
  "RADAR_FACT_STATUS_CONFLICT",
  "RADAR_PROVIDER_FACT_REQUIRED",
  "TEMPORAL_CONTRACT_INVALID",
  "MARKET_WORKFLOW_ISSUES_INVALID",
  "MARKET_WORKFLOW_ISSUE_INVALID",
  "MARKET_WORKFLOW_SUBJECT_INVALID",
  "MARKET_WORKFLOW_ISSUE_ID_REUSED",
  "MARKET_WORKFLOW_SUBJECT_FINGERPRINT_CONFLICT",
  "MARKET_WORKFLOW_REPAIR_BINDING_REQUIRED",
]);

function isQuarantinablePersistenceError(error: unknown): error is RadarRpcError {
  if (!(error instanceof RadarRpcError)
    || ![
      "upsert_market_radar_batch_with_fact_checks_v1",
      "upsert_market_radar_batch_with_fact_checks_v2",
    ].includes(error.operation)
    || error.databaseCode === "57014"
    || error.status === 504) return false;
  if (error.status === 413) return true;
  if (error.databaseMessage) return QUARANTINABLE_PERSISTENCE_RULES.has(error.databaseMessage);
  return [
    "22001",
    "22003",
    "22007",
    "22008",
    "22P02",
    "23502",
    "23503",
    "23514",
  ].includes(error.databaseCode);
}

function quarantineFromPersistenceError(
  provider: string,
  candidate: JsonRecord,
  error: RadarRpcError,
): RadarCandidateQuarantine {
  return {
    provider: cleanText(provider, 40),
    external_id: cleanText(candidate.external_id, 220),
    fingerprint: /^[a-f0-9]{64}$/i.test(cleanText(candidate.fingerprint, 80))
      ? cleanText(candidate.fingerprint, 80)
      : null,
    stage: "authoritative_persistence",
    code: error.databaseMessage || "RADAR_CANDIDATE_DATA_INVALID",
    database_code: error.databaseCode || null,
    operation: error.operation,
  };
}

function safeFilters(body: JsonRecord) {
  const requestedProvider = cleanText(body.provider, 40);
  const requestedCategory = cleanText(body.category, 80);
  const requestedQuality = cleanText(body.quality, 40);
  const requestedOrder = cleanText(body.order, 40);
  const requestedHorizon = cleanText(body.horizon, 40);
  return {
    provider: RADAR_PROVIDERS.includes(requestedProvider) ? requestedProvider : "all",
    category: RADAR_CATEGORIES.includes(requestedCategory) ? requestedCategory : "",
    quality: ["fit", "review", "rejected", "all"].includes(requestedQuality) ? requestedQuality : "review",
    order: ["recommended", "popularity", "closing", "recent"].includes(requestedOrder) ? requestedOrder : "recommended",
    horizon: ["30d", "90d", "180d", "365d"].includes(requestedHorizon) ? requestedHorizon : "180d",
    query: cleanText(body.query, 120),
    parent_offset: Math.max(0, Math.min(10_000, Math.floor(Number(body.parent_offset) || 0))),
  };
}

async function loadExistingDefinitions(environment: Environment, authorization: string) {
  const familyDefinitions = await rpc(environment, "get_admin_market_family_definitions", {}, authorization).catch(() => null);
  if (Array.isArray(familyDefinitions)) return toRecordArray(familyDefinitions);
  const [catalog, drafts] = await Promise.all([
    rpc(environment, "get_admin_market_catalog", {}, authorization).catch(() => []),
    rpc(environment, "list_admin_market_drafts", { status_filter: null, query_filter: null, limit_count: 150, offset_count: 0 }, authorization).catch(() => []),
  ]);
  return [
    ...toRecordArray(catalog).map((item) => ({ ...item, kind: "market" })),
    ...toRecordArray(drafts).map((item) => ({ ...item, kind: "draft" })),
  ];
}

function slugify(value: unknown): string {
  return cleanText(value, 400).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function isOfficialEvidenceUrl(value: unknown, authoritativeDomains: ReadonlySet<string>): boolean {
  const url = safePublicUrl(value);
  if (!url) return false;
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase();
    return !parsed.username && !parsed.password && (!parsed.port || parsed.port === "443")
      && [...authoritativeDomains].some((host) => hostname === host || hostname.endsWith(`.${host}`));
  } catch {
    return false;
  }
}

type VerifiedOfficialPage = {
  url: string;
  title: string;
  publishedAt: string | null;
  contentType: string;
  content: string;
  contentSha256: string;
  relatedUrls: string[];
};

const SOURCE_TOKEN_STOPWORDS = new Set([
  "about", "after", "antes", "como", "con", "del", "desde", "does", "edition", "edicion",
  "for", "game", "games", "juego", "juegos", "las", "los", "oficial", "official", "para",
  "sera", "será", "sobre", "the", "una", "will", "with", "yes",
]);
const SOURCE_GENERIC_ANCHORS = new Set([
  "announce", "announced", "cover", "complete", "event", "launch", "lineup", "market", "release",
  "result", "winner", "anuncio", "evento", "ganador", "lanzamiento", "portada", "resultado",
]);

function decodeHtmlEntities(value: string): string {
  const named: Record<string, string> = {
    amp: "&", apos: "'", gt: ">", lt: "<", nbsp: " ", quot: '"', ndash: "-", mdash: "-",
  };
  return value.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (match, entity: string) => {
    if (entity[0] !== "#") return named[entity.toLowerCase()] ?? match;
    const radix = entity[1]?.toLowerCase() === "x" ? 16 : 10;
    const digits = radix === 16 ? entity.slice(2) : entity.slice(1);
    const codePoint = Number.parseInt(digits, radix);
    try { return Number.isInteger(codePoint) && codePoint > 0 ? String.fromCodePoint(codePoint) : " "; }
    catch { return " "; }
  });
}

function htmlAttribute(tag: string, attribute: string): string {
  const match = tag.match(new RegExp(`\\b${attribute}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
  return decodeHtmlEntities(match?.[1] ?? match?.[2] ?? match?.[3] ?? "").trim();
}

function officialPageMetadata(raw: string, contentType: string): { title: string; publishedAt: string | null; content: string } {
  if (contentType === "text/plain") {
    return { title: "", publishedAt: null, content: cleanText(raw.replace(/\s+/g, " "), 300_000) };
  }
  const title = decodeHtmlEntities(raw.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "")
    .replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  let publishedAt: string | null = null;
  for (const tag of raw.match(/<meta\b[^>]*>/gi) ?? []) {
    const key = (htmlAttribute(tag, "property") || htmlAttribute(tag, "name")).toLowerCase();
    if (!["article:published_time", "date", "datepublished", "publishdate", "pub_date"].includes(key)) continue;
    publishedAt = safeIsoDate(htmlAttribute(tag, "content"));
    if (publishedAt) break;
  }
  const content = extractOfficialHtmlText(raw);
  return { title: cleanText(title, 300), publishedAt, content };
}

async function boundedResponseText(response: Response): Promise<string> {
  const declaredLength = Number(response.headers.get("content-length") ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_OFFICIAL_SOURCE_BYTES) {
    throw new Error("OFFICIAL_SOURCE_TOO_LARGE");
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let output = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_OFFICIAL_SOURCE_BYTES) throw new Error("OFFICIAL_SOURCE_TOO_LARGE");
      output += decoder.decode(value, { stream: true });
    }
    return output + decoder.decode();
  } finally {
    if (total > MAX_OFFICIAL_SOURCE_BYTES) await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

async function fetchVerifiedOfficialPage(
  value: unknown,
  authoritativeDomains: ReadonlySet<string>,
  deadlineAt: number,
  requestSignal: AbortSignal,
): Promise<VerifiedOfficialPage | null> {
  let current = safePublicUrl(value);
  if (!current || !isOfficialEvidenceUrl(current, authoritativeDomains)) return null;
  for (let redirects = 0; redirects <= MAX_OFFICIAL_SOURCE_REDIRECTS; redirects += 1) {
    const remaining = deadlineAt - Date.now();
    if (remaining <= 0 || requestSignal.aborted) return null;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Math.min(OFFICIAL_SOURCE_FETCH_TIMEOUT_MS, remaining));
    try {
      const response = await fetch(current, {
        method: "GET",
        redirect: "manual",
        cache: "no-store",
        signal: AbortSignal.any([controller.signal, requestSignal]),
        headers: { Accept: "text/html, application/xhtml+xml, text/plain;q=0.8" },
      });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        if (redirects >= MAX_OFFICIAL_SOURCE_REDIRECTS) return null;
        const location = response.headers.get("location");
        if (!location) return null;
        const redirected = safePublicUrl(new URL(location, current).toString());
        if (!redirected || !isOfficialEvidenceUrl(redirected, authoritativeDomains)) return null;
        current = redirected;
        continue;
      }
      if (!response.ok || !isOfficialEvidenceUrl(response.url || current, authoritativeDomains)) return null;
      if (/attachment/i.test(response.headers.get("content-disposition") ?? "")) return null;
      const contentType = cleanText((response.headers.get("content-type") ?? "").split(";", 1)[0].toLowerCase(), 100);
      if (!["text/html", "application/xhtml+xml", "text/plain"].includes(contentType)) return null;
      const raw = await boundedResponseText(response);
      const metadata = officialPageMetadata(raw, contentType);
      if (metadata.content.length < 80) return null;
      const finalUrl = safePublicUrl(response.url || current) ?? current;
      return {
        url: finalUrl,
        title: metadata.title,
        publishedAt: metadata.publishedAt,
        contentType,
        content: metadata.content,
        contentSha256: await sha256Hex(metadata.content),
        relatedUrls: contentType === "text/html" || contentType === "application/xhtml+xml"
          ? extractOfficialRelatedUrls(raw, finalUrl, [...authoritativeDomains], 24)
          : [],
      };
    } catch {
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }
  return null;
}

function sourceTokens(value: unknown): string[] {
  return [...new Set(cleanText(value, 8_000).normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().match(/[a-z0-9]{3,}/g) ?? [])]
    .filter((token) => !SOURCE_TOKEN_STOPWORDS.has(token));
}

function compactSourceIdentity(value: unknown): string {
  return cleanText(value, 8_000).normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function selectionGroupSubject(group: JsonRecord): string {
  const counts = new Map<string, { value: string; count: number }>();
  for (const candidate of toRecordArray(group.candidates)) {
    const question = cleanText(candidate.source_question ?? candidate.atinara_question, 700).replace(/[?¿]+$/g, "");
    const match = question.match(/(?:the\s+cover\s+of|la\s+portada\s+de|portada\s+de)\s+(.+)$/i);
    const subject = cleanText(match?.[1], 240);
    const key = compactSourceIdentity(subject);
    if (!subject || key.length < 5) continue;
    const current = counts.get(key);
    counts.set(key, { value: subject, count: (current?.count ?? 0) + 1 });
  }
  return [...counts.values()].sort((left, right) => right.count - left.count)[0]?.value ?? "";
}

function metricGroupSubject(group: JsonRecord): string {
  const counts = new Map<string, { value: string; count: number }>();
  for (const candidate of toRecordArray(group.candidates)) {
    const title = cleanText(candidate.source_title, 500).replace(/[?¿]+$/g, "");
    if (!/\b(?:metacritic|metascore|opencritic|user\s+score|critic\s+score)\b/i.test(title)) continue;
    const subject = cleanText(title.replace(/\s*:\s*(?:metacritic|metascore|opencritic|user\s+score|critic\s+score|score).*$/i, ""), 240);
    const key = compactSourceIdentity(subject);
    if (!subject || key.length < 5 || subject === title) continue;
    const current = counts.get(key);
    counts.set(key, { value: subject, count: (current?.count ?? 0) + 1 });
  }
  return [...counts.values()].sort((left, right) => right.count - left.count)[0]?.value ?? "";
}

async function relevantVerifiedEvidence(page: VerifiedOfficialPage, group: JsonRecord, retrievedAt: string): Promise<JsonRecord | null> {
  const selectionSubject = selectionGroupSubject(group);
  const metricSubject = metricGroupSubject(group);
  const candidateSubjects = [...new Set(toRecordArray(group.candidates)
    .map((candidate) => cleanText(candidateResolutionSubject(candidate), 240))
    .filter(Boolean))];
  const exactSubject = selectionSubject || metricSubject || (candidateSubjects.length === 1 ? candidateSubjects[0] : "");
  const candidateQuestions = toRecordArray(group.candidates)
    .map((candidate) => cleanText(candidate.source_question ?? candidate.atinara_question, 500)).join(" ");
  const tokens = sourceTokens(exactSubject || `${group.title ?? ""} ${candidateQuestions}`).slice(0, 60);
  const anchors = new Set(tokens.filter((token) => !SOURCE_GENERIC_ANCHORS.has(token)));
  if (!tokens.length || !anchors.size) return null;
  const rawSegments = exactSubject
    ? officialEvidenceSegmentsForSubject(page, exactSubject, selectionSubject ? "selection" : metricSubject ? "metric" : "generic")
      : page.content.split(/(?<=[.!?])\s+|\s*[|•]\s*/).filter(Boolean);
  if (!rawSegments.length) return null;
  const segments = rawSegments.flatMap((segment) => {
    const clean = cleanText(segment, 2_100);
    if (clean.length <= 700) return [clean];
    return [clean.slice(0, 700), clean.slice(700, 1_400), clean.slice(1_400, 2_100)].filter(Boolean);
  });
  const scored = segments.map((segment) => {
    const segmentTokens = new Set(sourceTokens(segment));
    const matches = tokens.filter((token) => segmentTokens.has(token));
    const anchorMatches = matches.filter((token) => anchors.has(token));
    const terminalBonus = /\b(?:announc|reveal|selected|winner|launch|release|cover|anunci|revel|seleccion|ganador|lanz|portada)\w*\b/i.test(segment) ? 3 : 0;
    return { segment, matches: matches.length, anchors: anchorMatches.length, score: matches.length + (anchorMatches.length * 2) + terminalBonus };
  }).filter((item) => item.matches >= 2 && item.anchors >= 1)
    .sort((left, right) => right.score - left.score || right.segment.length - left.segment.length);
  if (!scored.length) return null;
  let futureClaim = deriveDeterministicUnresolvedProof(page.content, group, retrievedAt);
  const supports = cleanText([
    futureClaim?.excerpt,
    ...scored.slice(0, 3).map((item) => item.segment),
  ].filter(Boolean).join(" "), 500);
  if (!supports) return null;
  const speculative = hasSpeculativeEvidenceLanguage(`${page.title} ${supports}`);
  if (speculative) futureClaim = null;
  const selectionEditions = selectionSubject ? officialSelectionEditionCoverage(page, rawSegments, selectionSubject) : [];
  return {
    title: page.title || new URL(page.url).hostname,
    url: page.url,
    published_at: page.publishedAt,
    source_type: "official",
    supports,
    retrieved_at: retrievedAt,
    retrieval_status: "verified_content",
    evidence_basis: "retrieved_content",
    parser_version: "atinara-official-content-v1",
    content_sha256: page.contentSha256,
    content_type: page.contentType,
    claim_status: speculative ? "speculative" : "direct",
    direct_claim: !speculative,
    claim_verifiable: true,
    relevance_score: Math.min(100, scored[0].score * 8),
    supported_reason_codes: [],
    supported_fact_statuses: futureClaim ? ["unresolved"] : [],
    supported_contract_kinds: futureClaim?.contractKinds ?? [],
    unresolved_proof: Boolean(futureClaim),
    selection_editions: selectionEditions,
    unresolved_proof_basis: futureClaim ? "official_future_date_v1" : null,
    unresolved_until: futureClaim?.until ?? null,
    unresolved_proof_excerpt: futureClaim?.excerpt ?? null,
    unresolved_proof_excerpt_sha256: futureClaim ? await sha256Hex(futureClaim.excerpt) : null,
  };
}

async function loadAuthoritativeSourceDomains(environment: Environment): Promise<Set<string>> {
  const payload = await rpc(environment, "get_market_radar_authoritative_source_domains_v1", {}, undefined, true);
  const domains = toRecordArray(payload)
    .map((item) => cleanText(item.canonical_domain, 255).toLowerCase())
    .filter((domain) => /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain));
  return new Set(domains);
}

function compareUtf16Text(leftValue: unknown, rightValue: unknown): number {
  const left = cleanText(leftValue, 2_000);
  const right = cleanText(rightValue, 2_000);
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const difference = left.charCodeAt(index) - right.charCodeAt(index);
    if (difference !== 0) return difference;
  }
  return left.length - right.length;
}

function canonicalEventProjection(event: JsonRecord, provider: "polymarket" | "kalshi"): JsonRecord[] {
  return toRecordArray(event.markets).map((market) => provider === "polymarket" ? {
    market_id: cleanText(market.id ?? market.conditionId ?? market.slug, 220),
    question: cleanText(market.question, 700),
    status: market.closed === true || market.archived === true || market.active === false || market.acceptingOrders === false ? "closed" : "open",
    result: normalizeProviderResult(market.result ?? market.resolutionResult ?? market.winningOutcome),
    settled_at: safeIsoDate(market.resolvedAt ?? market.resolutionDate),
    close_at: safeIsoDate(market.endDate ?? event.endDate),
  } : {
    market_id: cleanText(market.ticker ?? market.market_ticker, 220),
    question: cleanText(market.title ?? market.yes_sub_title, 700),
    yes_sub_title: cleanText(market.yes_sub_title, 500) || null,
    no_sub_title: cleanText(market.no_sub_title, 500) || null,
    status: cleanText(market.status, 80).toLowerCase(),
    result: normalizeProviderResult(market.result),
    settled_at: safeIsoDate(market.settlement_ts ?? market.determined_at),
    close_at: safeIsoDate(market.close_time ?? market.expected_expiration_time),
  }).sort((left, right) => compareUtf16Text(left.market_id, right.market_id));
}

async function attachCanonicalFactContext(
  candidates: JsonRecord[],
  events: JsonRecord[],
  provider: "polymarket" | "kalshi",
): Promise<JsonRecord[]> {
  const contexts = new Map<string, JsonRecord[]>();
  for (const event of events) {
    const key = provider === "polymarket"
      ? cleanText(event.id ?? event.slug, 220)
      : cleanText(event.event_ticker ?? event.ticker, 220);
    const children = canonicalEventProjection(event, provider);
    if (!key || !children.length || children.length > MAX_CANONICAL_EVENT_CHILDREN) continue;
    contexts.set(key, children);
  }
  const attached: JsonRecord[] = [];
  for (const candidate of candidates) {
    const key = cleanText(candidate.external_event_id ?? candidate.external_event_slug, 220);
    const children = contexts.get(key);
    if (!children) continue;
    const providerPayload = toRecord(candidate.provider_payload) ?? {};
    const withContext = {
      ...candidate,
      provider_payload: {
        ...providerPayload,
        fact_context_schema_version: "atinara-radar-fact-context-v2",
        canonical_event_children: children,
        canonical_event_children_total: children.length,
        canonical_event_children_complete: true,
      },
    };
    const fingerprint = await sha256Hex(factContextSnapshot(withContext));
    attached.push({
      ...withContext,
      fact_context_fingerprint: fingerprint,
      provider_payload: { ...withContext.provider_payload, fact_context_fingerprint: fingerprint },
    });
  }
  return attached;
}

function factContextSnapshot(candidate: JsonRecord): JsonRecord {
  const providerPayload = toRecord(candidate.provider_payload) ?? {};
  return {
    fact_context_schema_version: "atinara-radar-fact-context-v2",
    provider: cleanText(candidate.provider, 40),
    external_id: cleanText(candidate.external_id, 220),
    external_event_id: cleanText(candidate.external_event_id, 220) || null,
    external_market_id: cleanText(candidate.external_market_id, 220) || null,
    event_group_key: cleanText(candidate.event_group_key, 240) || null,
    source_status: cleanText(candidate.source_status, 80) || null,
    source_result: normalizeProviderResult(candidate.source_result),
    source_settled_at: safeIsoDate(candidate.source_settled_at),
    canonical_event_children: toRecordArray(providerPayload.canonical_event_children),
    canonical_event_children_total: safeNumber(providerPayload.canonical_event_children_total),
    canonical_event_children_complete: providerPayload.canonical_event_children_complete === true,
  };
}

async function buildAuthoritativeFactCheck(
  candidate: JsonRecord,
  purpose: "discovery" | "prepare" | "revalidate",
  checkedAt = new Date().toISOString(),
  attemptId: string = crypto.randomUUID(),
): Promise<JsonRecord> {
  const contextSnapshot = factContextSnapshot(candidate);
  const sourceSnapshot = toRecordArray(candidate.verification_evidence).slice(0, 20).map((item) => ({
    title: cleanText(item.title, 300),
    url: safePublicUrl(item.url),
    published_at: safeIsoDate(item.published_at),
    source_type: cleanText(item.source_type, 80) || "public",
    supports: cleanText(item.supports, 500),
    retrieved_at: safeIsoDate(item.retrieved_at),
    retrieval_status: cleanText(item.retrieval_status, 80) || null,
    evidence_basis: cleanText(item.evidence_basis, 80) || null,
    parser_version: cleanText(item.parser_version, 100) || null,
    content_sha256: cleanText(item.content_sha256, 80) || null,
    content_type: cleanText(item.content_type, 100) || null,
    claim_status: cleanText(item.claim_status, 40) || null,
    direct_claim: item.direct_claim === true,
    claim_verifiable: item.claim_verifiable === true,
    relevance_score: safeNumber(item.relevance_score),
    selection_complete: item.selection_complete === true,
    selection_editions: Array.isArray(item.selection_editions)
      ? item.selection_editions.map((edition) => cleanText(edition, 40))
        .filter((edition) => ["standard", "ultimate", "ultimate_plus", "deluxe"].includes(edition))
        .slice(0, 4)
      : [],
    supported_reason_codes: Array.isArray(item.supported_reason_codes)
      ? item.supported_reason_codes.map((code) => cleanText(code, 100)).filter(Boolean).slice(0, 12)
      : [],
    supported_fact_statuses: Array.isArray(item.supported_fact_statuses)
      ? item.supported_fact_statuses.map((status) => cleanText(status, 40)).filter(Boolean).slice(0, 6)
      : [],
    supported_contract_kinds: Array.isArray(item.supported_contract_kinds)
      ? item.supported_contract_kinds.map((kind) => cleanText(kind, 40)).filter(Boolean).slice(0, 6)
      : [],
    unresolved_proof: item.unresolved_proof === true,
    unresolved_proof_basis: cleanText(item.unresolved_proof_basis, 100) || null,
    unresolved_until: safeIsoDate(item.unresolved_until),
    unresolved_proof_excerpt: cleanText(item.unresolved_proof_excerpt, 700) || null,
    unresolved_proof_excerpt_sha256: cleanText(item.unresolved_proof_excerpt_sha256, 80) || null,
  })).filter((item) => item.url);
  const providerFactUrl = safePublicUrl(candidate.external_market_url)
    ?? safePublicUrl(candidate.external_event_url);
  const providerResult = normalizeProviderResult(candidate.source_result);
  const providerNotOpen = cleanText(candidate.verification_reason_code, 100) === RADAR_REASON_CODES.PROVIDER_NOT_OPEN;
  if (providerFactUrl
    && (providerResult || providerNotOpen)
    && !sourceSnapshot.some((item) => item.url === providerFactUrl && item.source_type === "provider")) {
    const providerStatus = cleanText(candidate.source_status, 80) || "no abierto";
    const supportedReasonCodes = [
      ...(providerResult ? [RADAR_REASON_CODES.EVENT_ALREADY_RESOLVED] : []),
      ...(providerNotOpen ? [RADAR_REASON_CODES.PROVIDER_NOT_OPEN] : []),
    ];
    sourceSnapshot.push({
      title: providerResult ? "Resultado canónico del proveedor" : "Estado canónico del proveedor",
      url: providerFactUrl,
      published_at: safeIsoDate(candidate.source_settled_at),
      source_type: "provider",
      retrieved_at: checkedAt,
      retrieval_status: "verified_provider_api",
      evidence_basis: "provider_api",
      parser_version: RADAR_NORMALIZER_VERSION,
      content_sha256: null,
      content_type: "application/json",
      claim_status: "direct",
      direct_claim: true,
      claim_verifiable: true,
      relevance_score: 100,
      selection_complete: false,
      selection_editions: [],
      supported_reason_codes: supportedReasonCodes,
      supported_fact_statuses: providerResult ? ["fully_resolved"] : ["unresolved"],
      supported_contract_kinds: [],
      unresolved_proof: false,
      unresolved_proof_basis: null,
      unresolved_until: null,
      unresolved_proof_excerpt: null,
      unresolved_proof_excerpt_sha256: null,
      supports: providerResult
        ? `Resultado: ${providerResult}. Estado del mercado de origen: ${providerStatus}.`
        : `Estado del mercado de origen: ${providerStatus}. El proveedor ya no admite esta opción.`,
    });
  }
  const contextSha256 = await sha256Hex(contextSnapshot);
  const sourceSha256 = await sha256Hex(sourceSnapshot);
  const expiresAt = new Date(Date.parse(checkedAt) + FACT_CHECK_TTL_MINUTES * 60_000).toISOString();
  const factStatus = cleanText(candidate.fact_status, 40) || "unknown";
  const decision = {
    attempt_id: attemptId,
    purpose,
    checked_at: checkedAt,
    fact_policy_version: RADAR_FACT_POLICY_VERSION,
    fact_status: factStatus,
    verification_status: cleanText(candidate.verification_status, 80) || "needs_review",
    reason_code: cleanText(candidate.verification_reason_code, 100) || null,
    confidence: Math.max(0, Math.min(100, safeNumber(candidate.verification_confidence) ?? 0)),
    context_sha256: contextSha256,
    source_sha256: sourceSha256,
  };
  return {
    ...decision,
    provider: cleanText(candidate.provider, 40),
    external_id: cleanText(candidate.external_id, 220),
    event_group_key: cleanText(candidate.event_group_key, 240) || null,
    fact_context_fingerprint: contextSha256,
    reason: cleanText(candidate.verification_reason, 1_000) || null,
    evidence: sourceSnapshot,
    context_snapshot: contextSnapshot,
    context_sha256: contextSha256,
    source_snapshot: sourceSnapshot,
    source_sha256: sourceSha256,
    expires_at: expiresAt,
    decision_hash: await sha256Hex(decision),
  };
}

async function discoverPolymarket(environment: Environment, now: string, filters: ReturnType<typeof safeFilters>) {
  const categoryQueries: Record<string, string> = {
    Lanzamientos: "video game release delay",
    Eventos: "gaming event game awards",
    Industria: "video game studio publisher",
    Streamers: "gaming streamer Twitch",
    "Reviews/Premios": "video game Metacritic Game Awards",
    YouTubers: "gaming YouTube creator",
  };
  const url = new URL(`${POLYMARKET_GAMMA_ROOT}/public-search`);
  url.searchParams.set("q", filters.query || categoryQueries[filters.category] || "video game gaming");
  url.searchParams.set("events_status", "active");
  url.searchParams.set("limit_per_type", "80");
  url.searchParams.set("page", "1");
  url.searchParams.set("keep_closed_markets", "0");
  url.searchParams.set("search_profiles", "false");
  const payload = toRecord(await fetchJson(url, {}, PROVIDER_TIMEOUT_MS, { execution: environment.execution })) ?? {};
  const rawEvents = toRecordArray(payload.events);
  const validatedEvents: JsonRecord[] = [];
  for (const searchEvent of rawEvents.slice(0, 60)) {
    const slug = cleanText(searchEvent.slug, 400);
    if (!slug) continue;
    try {
      const canonical = toRecord(await fetchJson(new URL(`${POLYMARKET_GAMMA_ROOT}/events/slug/${encodeURIComponent(slug)}`), {}, PROVIDER_TIMEOUT_MS, { execution: environment.execution }));
      if (!canonical || cleanText(canonical.id, 220) !== cleanText(searchEvent.id, 220)) continue;
      const markets = toRecordArray(canonical.markets);
      if (!markets.length || markets.length > MAX_CANONICAL_EVENT_CHILDREN) continue;
      const canonicalUrl = await verifyPublicUrl(`https://polymarket.com/event/${slug}`, "polymarket.com", environment.execution);
      if (!canonicalUrl) continue;
      validatedEvents.push({ ...canonical, markets, canonical_url_verified: true });
    } catch {
      // Un evento inválido no invalida el resto del proveedor.
    }
  }
  const adapted = adaptPolymarketResponse({ events: validatedEvents }, { now, cacheMinutes: 20, canonicalUrlVerified: true })
    .slice(0, MAX_NORMALIZED_PER_PROVIDER) as JsonRecord[];
  return attachCanonicalFactContext(adapted, validatedEvents, "polymarket");
}

function taxonomyValues(payload: unknown): { category: string; tag: string } | null {
  const root = toRecord(payload) ?? {};
  const mapping = toRecord(root.tags_by_categories);
  if (mapping) {
    for (const [category, rawTags] of Object.entries(mapping)) {
      const tags = Array.isArray(rawTags) ? rawTags : [];
      const exactTag = tags.map((tag) => cleanText(tag, 160)).find((tag) => /^video games?$/i.test(tag));
      if (category.toLowerCase() === "entertainment" && exactTag) return { category, tag: exactTag };
    }
  }
  const categories = toRecordArray(root.categories ?? root.data);
  for (const categoryItem of categories) {
    const category = cleanText(categoryItem.name ?? categoryItem.category, 160);
    const tags = Array.isArray(categoryItem.tags) ? categoryItem.tags : [];
    if (category.toLowerCase() !== "entertainment") continue;
    for (const tagItem of tags) {
      const tag = cleanText(isRecord(tagItem) ? tagItem.name ?? tagItem.tag : tagItem, 160);
      if (/^video games?$/i.test(tag)) return { category, tag };
    }
  }
  return null;
}

function seriesPriority(series: JsonRecord): number {
  const title = cleanText(series.title ?? series.name, 400).toLowerCase();
  const tags = Array.isArray(series.tags) ? series.tags.map((tag) => cleanText(tag, 100).toLowerCase()) : [];
  const volume = Math.max(0, safeNumber(series.volume_fp ?? series.volume) ?? 0);
  const updated = Date.parse(cleanText(series.last_updated_ts, 100));
  const recency = Number.isFinite(updated) ? Math.max(0, 20 - ((Date.now() - updated) / 86_400_000 / 30)) : 0;
  const relevance = /video|game|gaming|playstation|xbox|nintendo|metacritic|award|gta|release/.test(`${title} ${tags.join(" ")}`) ? 80 : 0;
  return relevance + Math.log10(volume + 1) * 6 + recency;
}

async function mapWithConcurrency<T, U>(items: T[], concurrency: number, worker: (item: T) => Promise<U>): Promise<PromiseSettledResult<U>[]> {
  const results: PromiseSettledResult<U>[] = new Array(items.length);
  let cursor = 0;
  async function run() {
    while (cursor < items.length) {
      const index = cursor++;
      try {
        results[index] = { status: "fulfilled", value: await worker(items[index]) };
      } catch (reason) {
        results[index] = { status: "rejected", reason };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, run));
  return results;
}

async function kalshiTaxonomy(environment: Environment) {
  const taxonomyUrl = new URL(`${KALSHI_API_ROOT}/search/tags_by_categories`);
  try {
    return taxonomyValues(await fetchJson(taxonomyUrl, {}, PROVIDER_TIMEOUT_MS, { execution: environment.execution }));
  } catch {
    return null;
  }
}

async function discoverKalshi(environment: Environment, now: string) {
  const exact = await kalshiTaxonomy(environment);
  const category = exact?.category ?? "Entertainment";
  const tag = exact?.tag ?? "Video games";
  const seriesUrl = new URL(`${KALSHI_API_ROOT}/series`);
  seriesUrl.searchParams.set("category", category);
  seriesUrl.searchParams.set("tags", tag);
  seriesUrl.searchParams.set("include_volume", "true");
  seriesUrl.searchParams.set("include_product_metadata", "true");
  const seriesPayload = toRecord(await fetchJson(seriesUrl, {}, PROVIDER_TIMEOUT_MS, { execution: environment.execution })) ?? {};
  const series = toRecordArray(seriesPayload.series)
    .sort((left, right) => seriesPriority(right) - seriesPriority(left))
    .slice(0, MAX_KALSHI_SERIES);
  if (!series.length) throw new Error("PROVIDER_INVALID_RESPONSE");

  const minimumClose = Math.floor(Date.now() / 1000);
  const settled = await mapWithConcurrency(series, KALSHI_CONCURRENCY, async (seriesItem) => {
    const ticker = cleanText(seriesItem.ticker, 120);
    if (!ticker) return [];
    const events: JsonRecord[] = [];
    let cursor = "";
    for (let page = 0; page < MAX_PROVIDER_PAGES; page += 1) {
      const eventsUrl = new URL(`${KALSHI_API_ROOT}/events`);
      eventsUrl.searchParams.set("series_ticker", ticker);
      eventsUrl.searchParams.set("status", "open");
      eventsUrl.searchParams.set("with_nested_markets", "true");
      eventsUrl.searchParams.set("min_close_ts", String(minimumClose));
      eventsUrl.searchParams.set("limit", "200");
      if (cursor) eventsUrl.searchParams.set("cursor", cursor);
      const pagePayload = toRecord(await fetchJson(eventsUrl, {}, PROVIDER_TIMEOUT_MS, { execution: environment.execution })) ?? {};
      events.push(...toRecordArray(pagePayload.events));
      cursor = cleanText(pagePayload.cursor, 500);
      if (!cursor) break;
    }
    const seriesTitle = cleanText(seriesItem.title ?? seriesItem.name, 400);
    const seriesSlug = slugify(seriesTitle);
    const settlementSources = toRecordArray(seriesItem.settlement_sources).map((source) => safePublicUrl(source.url)).filter(Boolean);
    const enriched: JsonRecord[] = [];
    for (const listedEvent of events.slice(0, Math.ceil(MAX_NORMALIZED_PER_PROVIDER / MAX_KALSHI_SERIES))) {
      const listedTicker = cleanText(listedEvent.event_ticker ?? listedEvent.ticker, 160);
      if (!listedTicker) continue;
      let event: JsonRecord;
      try {
        const canonicalUrl = new URL(`${KALSHI_API_ROOT}/events/${encodeURIComponent(listedTicker)}`);
        canonicalUrl.searchParams.set("with_nested_markets", "true");
        const canonicalPayload = toRecord(await fetchJson(canonicalUrl, {}, PROVIDER_TIMEOUT_MS, { execution: environment.execution })) ?? {};
        event = toRecord(canonicalPayload.event) ?? canonicalPayload;
      } catch {
        continue;
      }
      const eventTicker = cleanText(event.event_ticker ?? event.ticker, 160);
      const canonicalMarkets = toRecordArray(event.markets);
      if (!eventTicker || eventTicker !== listedTicker || !canonicalMarkets.length
        || canonicalMarkets.length > MAX_CANONICAL_EVENT_CHILDREN) continue;
      const guessed = `https://kalshi.com/markets/${ticker.toLowerCase()}/${seriesSlug}/${eventTicker.toLowerCase()}`;
      // La existencia y pertenencia se validan en la API oficial de eventos. No se
      // sondea una página HTML por evento: Kalshi limita esas peticiones y no debe
      // convertir un 429 del sitio público en un catálogo vacío.
      const canonicalUrl = safePublicUrl(guessed, ["kalshi.com"]);
      if (!canonicalUrl) continue;
      enriched.push({
        ...event,
        category,
        tags: Array.isArray(seriesItem.tags) ? seriesItem.tags : [tag],
        series_ticker: ticker,
        series_title: seriesTitle,
        settlement_sources: toRecordArray(event.settlement_sources).length ? event.settlement_sources : settlementSources.map((url) => ({ url })),
        external_event_url: canonicalUrl,
        canonical_url_verified: true,
        markets: canonicalMarkets.map((market) => ({
          ...market,
          series_ticker: ticker,
          external_event_url: canonicalUrl,
          external_market_url: canonicalUrl,
          canonical_url_verified: true,
          settlement_sources: toRecordArray(market.settlement_sources).length ? market.settlement_sources : event.settlement_sources ?? seriesItem.settlement_sources,
        })),
      });
    }
    return enriched;
  });
  const events = settled.flatMap((result) => result.status === "fulfilled" ? result.value : []);
  if (!events.length && settled.some((result) => result.status === "rejected")) throw new Error("PROVIDER_UNAVAILABLE");
  const adapted = adaptKalshiResponse({ events }, { now, category, cacheMinutes: 20 }).slice(0, MAX_NORMALIZED_PER_PROVIDER) as JsonRecord[];
  return attachCanonicalFactContext(adapted, events, "kalshi");
}

async function fetchKalshiMarketRecord(environment: Environment, ticker: string): Promise<JsonRecord | null> {
  try {
    const payload = toRecord(await fetchJson(new URL(`${KALSHI_API_ROOT}/markets/${encodeURIComponent(ticker)}`), {}, PROVIDER_TIMEOUT_MS, { execution: environment.execution })) ?? {};
    return toRecord(payload.market) ?? payload;
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes("HTTP_404")) throw error;
    const payload = toRecord(await fetchJson(new URL(`${KALSHI_API_ROOT}/historical/markets/${encodeURIComponent(ticker)}`), {}, PROVIDER_TIMEOUT_MS, { execution: environment.execution })) ?? {};
    return toRecord(payload.market) ?? payload;
  }
}

async function reconcileRejectedKalshiOutcomes(
  environment: Environment,
  rejected: JsonRecord[],
  now: string,
): Promise<JsonRecord[]> {
  const pending = rejected
    .filter((candidate) => cleanText(candidate.provider, 40) === "kalshi"
      && cleanText(candidate.verification_reason_code, 100) === RADAR_REASON_CODES.PROVIDER_NOT_OPEN
      && !normalizeProviderResult(candidate.source_result)
      && cleanText(candidate.external_market_id, 220))
    .slice(0, MAX_REJECTED_OUTCOME_RECONCILIATIONS);
  if (!pending.length) return [];
  const checked = await mapWithConcurrency(pending, KALSHI_CONCURRENCY, async (candidate) => {
    const market = await fetchKalshiMarketRecord(environment, cleanText(candidate.external_market_id, 220));
    const result = normalizeProviderResult(market?.result);
    if (!market || !result) return null;
    const sourceUrl = safePublicUrl(candidate.external_market_url ?? candidate.external_event_url);
    return applyEligibilityDecision({
      ...candidate,
      source_status: cleanText(market.status, 80).toLowerCase() || candidate.source_status,
      source_result: result,
      source_settled_at: safeIsoDate(market.settlement_ts ?? market.determined_at),
      eligibility_policy_version: RADAR_ELIGIBILITY_POLICY_VERSION,
      hard_reject_reasons: [...new Set([
        ...(Array.isArray(candidate.hard_reject_reasons)
          ? candidate.hard_reject_reasons.map((reason) => cleanText(reason, 100)).filter(Boolean)
          : []),
        RADAR_REASON_CODES.EVENT_ALREADY_RESOLVED,
      ])],
    }, {
      eligible: false,
      conclusive: true,
      reason_code: RADAR_REASON_CODES.EVENT_ALREADY_RESOLVED,
      reason: `Kalshi ya ha determinado esta opción como «${providerResultLabel(result)}».`,
      confidence: 100,
      ttl_minutes: 1_440,
      evidence: sourceUrl ? [{
        title: "Resultado oficial en Kalshi",
        url: sourceUrl,
        published_at: safeIsoDate(market.settlement_ts ?? market.determined_at),
        source_type: "provider",
        retrieved_at: new Date().toISOString(),
        retrieval_status: "verified_provider_api",
        evidence_basis: "provider_api",
        parser_version: RADAR_NORMALIZER_VERSION,
        content_type: "application/json",
        claim_status: "direct",
        direct_claim: true,
        claim_verifiable: true,
        supported_reason_codes: [RADAR_REASON_CODES.EVENT_ALREADY_RESOLVED],
        supports: `Resultado: ${providerResultLabel(result)}`,
      }] : [],
    }, now) as JsonRecord;
  });
  const reconciled = checked.flatMap((item) => item.status === "fulfilled" && item.value ? [item.value] : []);
  return reconciled;
}

type OfficialResearchOutcome = {
  evidenceByGroup: Map<string, JsonRecord[]>;
  enrichmentError: unknown | null;
  incompleteGroupKeys: string[];
  agentExecution: JsonRecord;
};

type RadarAgentV2 = ReturnType<typeof createAtinaraAgentRunV2>;

async function createRadarAgentV2(environment: Environment, candidates: JsonRecord[]): Promise<RadarAgentV2> {
  const registry = toRecord(await rpc(environment, "get_market_agent_registry_v2", {}, undefined, true));
  if (!registry || registry.version !== ATINARA_AGENT_REGISTRY_VERSION
    || !/^[0-9a-f]{64}$/i.test(cleanText(registry.hash, 64))) {
    throw new Error("AGENT_REGISTRY_IDENTITY_MISMATCH");
  }
  assertAgentRegistrySnapshot(registry);
  const executeTool = async (input: JsonRecord) => {
    if (typeof input.execute !== "function") throw new Error("AGENT_TOOL_HANDLER_INVALID");
    const value = await (input.execute as () => Promise<unknown> | unknown)();
    return {
      value,
      status: ["completed", "degraded", "failed", "no_op"].includes(cleanText(input.status, 20))
        ? cleanText(input.status, 20)
        : "completed",
      summary: toRecord(input.summary) ?? {},
    };
  };
  const handlers = Object.fromEntries([
    "read_provider_contract", "search_official_sources", "fetch_official_source",
    "classify_terminal_evidence", "select_resolution_authority",
  ].map((tool) => [tool, executeTool]));
  return createAtinaraAgentRunV2({
    agentType: "radar_source_agent",
    registryVersion: registry.version,
    registryHash: registry.hash,
    snapshotFingerprint: await sha256Hex(candidates.map((candidate) => ({
      provider: candidate.provider,
      external_id: candidate.external_id,
      fingerprint: candidate.fingerprint,
    }))),
    handlers,
    runId: environment.execution.invocationId,
    maxSteps: 8,
    maxRepeatedActions: 2,
    finalizationReserveMs: FINALIZATION_RESERVE_MS,
    executionContext: environment.execution,
  });
}

async function dispatchRadarTool<T>(
  agent: RadarAgentV2,
  tool: string,
  execute: () => Promise<T> | T,
  options: { actionKey: string; progressFingerprint: string; status?: string; summary?: JsonRecord },
): Promise<T> {
  const result = await agent.dispatch(tool, { execute, status: options.status, summary: options.summary }, {
    actionKey: options.actionKey,
    progressFingerprint: options.progressFingerprint,
  });
  return result.value as T;
}

async function researchGroupsWithTavily(
  environment: Environment,
  apiKey: string,
  candidates: JsonRecord[],
  authoritativeDomains: ReadonlySet<string>,
): Promise<OfficialResearchOutcome> {
  if (!authoritativeDomains.size) throw new Error("SOURCE_REGISTRY_UNAVAILABLE");
  const groups = groupCandidates(candidates).slice(0, MAX_AI_ENRICHMENT_GROUPS);
  const evidence = new Map<string, JsonRecord[]>();
  const incompleteGroupKeys = new Set<string>();
  const agent = await createRadarAgentV2(environment, candidates);
  const contractRead = await dispatchRadarTool(agent, "read_provider_contract", () => {
    const discoveredByGroup = new Map<string, string[]>();
    let directContractCount = 0;
    for (const group of groups) {
      const urls = [...new Set(toRecordArray(group.candidates)
        .flatMap((candidate) => providerResolutionSourceUrls(candidate, authoritativeDomains)))]
        .slice(0, 8);
      directContractCount += urls.length;
      discoveredByGroup.set(cleanText(group.event_group_key, 240), urls);
    }
    return { discoveredByGroup, directContractCount };
  }, {
    actionKey: "provider-contracts",
    progressFingerprint: `provider-contracts:${groups.length}`,
    summary: { groups: groups.length },
  });
  const discoveredByGroup = contractRead.discoveredByGroup;
  const directContractCount = contractRead.directContractCount;

  const settled = apiKey ? await mapWithConcurrency(groups, TAVILY_CONCURRENCY, async (group) => {
    const url = new URL("https://api.tavily.com/search");
    const childQuestions = group.candidates
      .slice(0, 8)
      .map((candidate: JsonRecord) => cleanText(candidate.source_question ?? candidate.atinara_question, 180))
      .filter(Boolean)
      .join(" | ");
    const groupText = cleanText(`${group.title} ${childQuestions}`, 1_500).toLowerCase();
    const selectionSubject = selectionGroupSubject(group);
    const metricSubject = metricGroupSubject(group);
    const factTerms = /\b(cover|portada|athlete|atleta|winner|ganador|nominee|nominado|participant|participante)\b/.test(groupText)
      ? "official announced revealed selected winner result complete lineup"
      : /\b(score|puntuaci|metacritic|opencritic|threshold|umbral)\b/.test(groupText)
        ? "official metric result score observation"
        : "official announcement release date result eligibility";
    const payload = toRecord(await fetchJson(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: apiKey,
        query: cleanText(selectionSubject
          ? `official ${selectionSubject} cover reveal cover stars standard ultimate deluxe complete lineup`
          : metricSubject
            ? `official "${metricSubject}" ${/opencritic/.test(groupText) ? "OpenCritic" : "Metacritic"} score release date review`
            : `${factTerms} ${group.title} ${childQuestions}`, 1_200),
        search_depth: "basic",
        max_results: 6,
        include_answer: false,
        include_raw_content: false,
        include_domains: [...authoritativeDomains],
      }),
    }, PROVIDER_TIMEOUT_MS, { execution: environment.execution })) ?? {};
    return {
      eventGroupKey: group.event_group_key,
      urls: toRecordArray(payload.results)
        .map((result) => safePublicUrl(result.url))
        .filter((item): item is string => Boolean(item && isOfficialEvidenceUrl(item, authoritativeDomains)))
        .slice(0, 6),
    };
  }) : [];
  let firstFailure: unknown = apiKey ? null : new Error("PROVIDER_NOT_CONFIGURED");
  if (!apiKey) groups.forEach((group) => incompleteGroupKeys.add(cleanText(group.event_group_key, 240)));
  let tavilyUrlCount = 0;
  for (const [index, result] of settled.entries()) {
    if (result.status === "fulfilled") {
      const direct = discoveredByGroup.get(result.value.eventGroupKey) ?? [];
      const merged = [...new Set([...direct, ...result.value.urls])].slice(0, 10);
      tavilyUrlCount += result.value.urls.length;
      discoveredByGroup.set(result.value.eventGroupKey, merged);
    }
    else {
      incompleteGroupKeys.add(cleanText(groups[index]?.event_group_key, 240));
      if (!firstFailure) firstFailure = result.reason;
    }
  }
  await dispatchRadarTool(agent, "search_official_sources", () => ({ count: tavilyUrlCount }), {
    status: firstFailure ? (tavilyUrlCount || directContractCount ? "degraded" : "failed") : "completed",
    actionKey: "official-search",
    progressFingerprint: `official-search:${tavilyUrlCount}:${firstFailure ? "degraded" : "complete"}`,
    summary: { count: tavilyUrlCount, configured: Boolean(apiKey), direct_contracts_preserved: directContractCount },
  });
  const usableGroups = [...discoveredByGroup.values()].filter((urls) => urls.length > 0).length;
  if (!usableGroups && firstFailure) throw firstFailure;

  // Tavily descubre URLs, pero sus títulos y snippets nunca entran en modelos ni
  // en un snapshot factual. Se recupera el documento oficial con GET acotado y
  // solo se conserva un extracto relevante derivado del contenido recibido.
  const targets: Array<{ eventGroupKey: string; url: string }> = [];
  const targetKeys = new Set<string>();
  for (let rank = 0; rank < 6 && targets.length < MAX_OFFICIAL_SOURCE_URLS; rank += 1) {
    for (const group of groups) {
      const url = discoveredByGroup.get(group.event_group_key)?.[rank];
      const key = url ? `${group.event_group_key}:${url}` : "";
      if (!url || targetKeys.has(key)) continue;
      targetKeys.add(key);
      targets.push({ eventGroupKey: group.event_group_key, url });
      if (targets.length >= MAX_OFFICIAL_SOURCE_URLS) break;
    }
  }
  for (const group of groups) evidence.set(group.event_group_key, []);
  const deadlineAt = Math.min(
    environment.execution.absoluteDeadlineAt - FINALIZATION_RESERVE_MS,
    Date.now() + OFFICIAL_SOURCE_BUDGET_MS,
  );
  const pagePromises = new Map<string, Promise<VerifiedOfficialPage | null>>();
  const verifiedPagesByGroup = new Map<string, VerifiedOfficialPage[]>();
  const verified = await mapWithConcurrency(targets, OFFICIAL_SOURCE_CONCURRENCY, async (target) => {
    if (!pagePromises.has(target.url)) {
      pagePromises.set(target.url, fetchVerifiedOfficialPage(
        target.url,
        authoritativeDomains,
        deadlineAt,
        environment.execution.signal,
      ));
    }
    const page = await pagePromises.get(target.url)!;
    const group = groups.find((item) => item.event_group_key === target.eventGroupKey);
    const retrievedAt = new Date().toISOString();
    const authorityItems: JsonRecord[] = page && group
      ? toRecordArray(group.candidates).flatMap((candidate) => {
        const item = buildResolutionAuthorityEvidence(candidate, page, retrievedAt, authoritativeDomains);
        return item ? [item as JsonRecord] : [];
      })
      : [];
    return page && group ? {
      eventGroupKey: target.eventGroupKey,
      page,
      item: await relevantVerifiedEvidence(page, group, retrievedAt),
      authorityItems,
    } : null;
  });
  let verifiedPageCount = 0;
  let authorityEvidenceCount = 0;
  for (const [index, result] of verified.entries()) {
    if (result.status !== "fulfilled" || !result.value) {
      incompleteGroupKeys.add(cleanText(targets[index]?.eventGroupKey, 240));
      if (!firstFailure) firstFailure = result.status === "rejected"
        ? result.reason : new Error("OFFICIAL_SOURCE_FETCH_INCOMPLETE");
      continue;
    }
    verifiedPageCount += 1;
    const pages = verifiedPagesByGroup.get(result.value.eventGroupKey) ?? [];
    if (!pages.some((page) => page.url === result.value?.page.url)) pages.push(result.value.page);
    verifiedPagesByGroup.set(result.value.eventGroupKey, pages);
    if (result.value.item) {
      const items = evidence.get(result.value.eventGroupKey) ?? [];
      if (!items.some((item) => item.url === result.value?.item?.url)) items.push(result.value.item);
      evidence.set(result.value.eventGroupKey, items.slice(0, MAX_CANONICAL_EVENT_CHILDREN + 8));
    }
    for (const authorityItem of result.value.authorityItems) {
      const items = evidence.get(result.value.eventGroupKey) ?? [];
      const authorityKey = `${authorityItem.candidate_external_id}:${authorityItem.url}:${authorityItem.contract_url}`;
      if (!items.some((item) => `${item.candidate_external_id ?? ""}:${item.url}:${item.contract_url ?? ""}` === authorityKey)) {
        items.unshift(authorityItem);
        authorityEvidenceCount += 1;
      }
      evidence.set(result.value.eventGroupKey, items.slice(0, MAX_CANONICAL_EVENT_CHILDREN + 8));
    }
  }
  await dispatchRadarTool(agent, "fetch_official_source", () => ({ count: verifiedPageCount }), {
    actionKey: "official-fetch",
    progressFingerprint: `official-fetch:${targets.length}:${verifiedPageCount}`,
    status: verifiedPageCount ? "completed" : "degraded",
    summary: { count: verifiedPageCount, requested: targets.length, authority_contracts: authorityEvidenceCount },
  });

  // Para contratos de selección (portadas, ganadores o alineaciones), una
  // búsqueda puede devolver la portada general aunque el anuncio exhaustivo
  // esté enlazado como «cover», «editions» o «release». Seguimos como máximo
  // tres documentos del mismo host oficial y volvemos a verificar su contenido.
  const relatedTargets: Array<{ eventGroupKey: string; url: string }> = [];
  const relatedKeys = new Set<string>();
  for (const group of groups) {
    const subject = selectionGroupSubject(group);
    if (!subject) continue;
    const coveredEditions = new Set((evidence.get(group.event_group_key) ?? [])
      .flatMap((item) => Array.isArray(item.selection_editions) ? item.selection_editions : []));
    if (["standard", "ultimate", "ultimate_plus"].every((edition) => coveredEditions.has(edition))) continue;
    const subjectTokens = sourceTokens(subject);
    const ranked = (verifiedPagesByGroup.get(group.event_group_key) ?? [])
      .flatMap((page) => page.relatedUrls)
      .filter((url) => !targets.some((target) => target.eventGroupKey === group.event_group_key && target.url === url))
      .map((url) => {
        const comparable = cleanText(url, 2_000).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
        const identityScore = subjectTokens.filter((token) => comparable.includes(token)).length * 20;
        const editorialScore = /cover|portada/.test(comparable) ? 100
          : /edition|edicion/.test(comparable) ? 70
          : /reveal|announcement|lineup|selection/.test(comparable) ? 55
          : /release|lanzamiento/.test(comparable) ? 35
          : /buy|comprar/.test(comparable) ? 45
          : /feature|news/.test(comparable) ? 20 : 5;
        return { url, score: identityScore + editorialScore };
      })
      .sort((left, right) => right.score - left.score || compareUtf16Text(left.url, right.url));
    for (const item of ranked.slice(0, MAX_RELATED_OFFICIAL_SOURCE_URLS_PER_GROUP)) {
      const key = `${group.event_group_key}:${item.url}`;
      if (relatedKeys.has(key)) continue;
      relatedKeys.add(key);
      relatedTargets.push({ eventGroupKey: group.event_group_key, url: item.url });
      if (relatedTargets.length >= MAX_RELATED_OFFICIAL_SOURCE_URLS) break;
    }
    if (relatedTargets.length >= MAX_RELATED_OFFICIAL_SOURCE_URLS) break;
  }
  if (relatedTargets.length) {
    const relatedDeadlineAt = Math.min(
      environment.execution.absoluteDeadlineAt - FINALIZATION_RESERVE_MS,
      Date.now() + OFFICIAL_RELATED_SOURCE_BUDGET_MS,
    );
    const related = await mapWithConcurrency(relatedTargets, OFFICIAL_SOURCE_CONCURRENCY, async (target) => {
      if (!pagePromises.has(target.url)) {
        pagePromises.set(target.url, fetchVerifiedOfficialPage(
          target.url,
          authoritativeDomains,
          relatedDeadlineAt,
          environment.execution.signal,
        ));
      }
      const page = await pagePromises.get(target.url)!;
      const group = groups.find((item) => item.event_group_key === target.eventGroupKey);
      return page && group
        ? { eventGroupKey: target.eventGroupKey, page, item: await relevantVerifiedEvidence(page, group, new Date().toISOString()) }
        : null;
    });
    for (const result of related) {
      if (result.status !== "fulfilled" || !result.value) continue;
      const pages = verifiedPagesByGroup.get(result.value.eventGroupKey) ?? [];
      if (!pages.some((page) => page.url === result.value?.page.url)) pages.push(result.value.page);
      verifiedPagesByGroup.set(result.value.eventGroupKey, pages);
      if (result.value.item) {
        const items = evidence.get(result.value.eventGroupKey) ?? [];
        if (!items.some((item) => item.url === result.value?.item?.url)) items.push(result.value.item);
        evidence.set(result.value.eventGroupKey, items.slice(0, MAX_CANONICAL_EVENT_CHILDREN + 8));
      }
    }
  }

  // Si una selección multiedición no está completa o una métrica relativa al
  // lanzamiento carece del ancla temporal oficial, hacemos una única búsqueda
  // más específica. Tavily solo descubre URLs: nunca confiamos en sus snippets
  // ni hacemos fallar el proveedor principal si esta mejora opcional se agota.
  const incompleteSelectionGroups = groups.filter((group) => {
    if (!selectionGroupSubject(group)) return false;
    return !detectOfficialCoverEventResolution(
      toRecordArray(group.candidates),
      evidence.get(group.event_group_key) ?? [],
    );
  });
  const incompleteMetricGroups = groups.filter((group) => {
    if (!metricGroupSubject(group)) return false;
    return !(evidence.get(group.event_group_key) ?? []).some((item) =>
      item.unresolved_proof === true
      && Array.isArray(item.supported_contract_kinds)
      && item.supported_contract_kinds.includes("review")
    );
  });
  const factualFollowupGroups: Array<{ group: JsonRecord; query: string; domains: string[] }> = [];
  for (let rank = 0; factualFollowupGroups.length < MAX_SELECTION_FOLLOWUP_GROUPS; rank += 1) {
    const selectionGroup = incompleteSelectionGroups[rank];
    const metricGroup = incompleteMetricGroups[rank];
    if (!selectionGroup && !metricGroup) break;
    if (selectionGroup) {
      const subject = selectionGroupSubject(selectionGroup);
      const domains = [...new Set((evidence.get(cleanText(selectionGroup.event_group_key, 240)) ?? [])
        .map((item) => {
          const url = safePublicUrl(item.url);
          if (!url) return null;
          const hostname = new URL(url).hostname.toLowerCase();
          return [...authoritativeDomains]
            .sort((left, right) => right.length - left.length)
            .find((domain) => hostname === domain || hostname.endsWith(`.${domain}`)) ?? null;
        })
        .filter((domain): domain is string => Boolean(domain)))];
      factualFollowupGroups.push({
        group: selectionGroup,
        query: `${domains[0] ? `site:${domains[0]} ` : ""}official press release "${subject}" named announced cover athlete cover star complete selection all editions`,
        domains,
      });
    }
    if (metricGroup && factualFollowupGroups.length < MAX_SELECTION_FOLLOWUP_GROUPS) {
      const subject = metricGroupSubject(metricGroup);
      factualFollowupGroups.push({
        group: metricGroup,
        query: `official "${subject}" release date launch date`,
        domains: [],
      });
    }
  }
  if (apiKey && factualFollowupGroups.length) {
    const followupSearches = await mapWithConcurrency(
      factualFollowupGroups,
      TAVILY_SELECTION_FOLLOWUP_CONCURRENCY,
      async ({ group, query, domains }) => {
        try {
          const payload = toRecord(await fetchJson(new URL("https://api.tavily.com/search"), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              api_key: apiKey,
              query: cleanText(query, 1_200),
              search_depth: "advanced",
              max_results: MAX_SELECTION_FOLLOWUP_URLS_PER_GROUP,
              include_answer: false,
              include_raw_content: false,
              include_domains: domains.length ? domains : [...authoritativeDomains],
            }),
          }, TAVILY_SELECTION_FOLLOWUP_TIMEOUT_MS, { execution: environment.execution })) ?? {};
          return {
            eventGroupKey: cleanText(group.event_group_key, 240),
            urls: [...new Set(toRecordArray(payload.results)
              .map((result) => safePublicUrl(result.url))
              .filter((item): item is string => Boolean(item && isOfficialEvidenceUrl(item, authoritativeDomains))))]
              .slice(0, MAX_SELECTION_FOLLOWUP_URLS_PER_GROUP),
          };
        } catch {
          return { eventGroupKey: cleanText(group.event_group_key, 240), urls: [] as string[] };
        }
      },
    );
    const followupTargets: Array<{ eventGroupKey: string; url: string }> = [];
    const followupKeys = new Set<string>();
    for (const result of followupSearches) {
      if (result.status !== "fulfilled") continue;
      for (const url of result.value.urls) {
        const key = `${result.value.eventGroupKey}:${url}`;
        if (followupKeys.has(key)) continue;
        followupKeys.add(key);
        followupTargets.push({ eventGroupKey: result.value.eventGroupKey, url });
      }
    }
    if (followupTargets.length) {
      const followupDeadlineAt = Math.min(
        environment.execution.absoluteDeadlineAt - FINALIZATION_RESERVE_MS,
        Date.now() + OFFICIAL_SELECTION_FOLLOWUP_BUDGET_MS,
      );
      const followed = await mapWithConcurrency(followupTargets, OFFICIAL_SOURCE_CONCURRENCY, async (target) => {
        if (!pagePromises.has(target.url)) {
          pagePromises.set(target.url, fetchVerifiedOfficialPage(
            target.url,
            authoritativeDomains,
            followupDeadlineAt,
            environment.execution.signal,
          ));
        }
        const page = await pagePromises.get(target.url)!;
        const group = groups.find((item) => item.event_group_key === target.eventGroupKey);
        return page && group
          ? { eventGroupKey: target.eventGroupKey, page, item: await relevantVerifiedEvidence(page, group, new Date().toISOString()) }
          : null;
      });
      for (const result of followed) {
        if (result.status !== "fulfilled" || !result.value) continue;
        const pages = verifiedPagesByGroup.get(result.value.eventGroupKey) ?? [];
        if (!pages.some((page) => page.url === result.value?.page.url)) pages.push(result.value.page);
        verifiedPagesByGroup.set(result.value.eventGroupKey, pages);
        if (result.value.item) {
          const items = evidence.get(result.value.eventGroupKey) ?? [];
          if (!items.some((item) => item.url === result.value?.item?.url)) items.push(result.value.item);
          evidence.set(result.value.eventGroupKey, items.slice(0, MAX_CANONICAL_EVENT_CHILDREN + 8));
        }
      }
    }
  }
  // Tavily es enriquecimiento, no autoridad única. Si el contrato del proveedor
  // aportó un endpoint oficial exacto para cada hija y ese contenido se recuperó,
  // el escaneo terminal de la familia está completo aunque la búsqueda auxiliar
  // haya fallado. Una fuente genérica o evidencia cruzada nunca satisface esto.
  let directAuthorityFallbackGroups = 0;
  for (const group of groups) {
    const groupKey = cleanText(group.event_group_key, 240);
    if (!incompleteGroupKeys.has(groupKey)) continue;
    const authorityCandidateIds = new Set((evidence.get(groupKey) ?? [])
      .filter((item) => isResolutionAuthorityEvidence(item))
      .map((item) => cleanText(item.candidate_external_id, 220))
      .filter(Boolean));
    const groupCandidates = toRecordArray(group.candidates);
    if (groupCandidates.length > 0 && groupCandidates.every((candidate) =>
      authorityCandidateIds.has(cleanText(candidate.external_id, 220)))) {
      incompleteGroupKeys.delete(groupKey);
      directAuthorityFallbackGroups += 1;
    }
  }
  const evidenceItems = [...evidence.values()].flat();
  const terminalEvidenceCount = evidenceItems.filter((item) => item.direct_claim === true).length;
  const authorityCount = evidenceItems.filter((item) => isResolutionAuthorityEvidence(item)).length;
  await dispatchRadarTool(agent, "classify_terminal_evidence", () => ({ count: terminalEvidenceCount }), {
    actionKey: "terminal-classification",
    progressFingerprint: `terminal-classification:${terminalEvidenceCount}:${evidenceItems.length}`,
    summary: { count: terminalEvidenceCount, evidence_items: evidenceItems.length },
  });
  await dispatchRadarTool(agent, "select_resolution_authority", () => ({ count: authorityCount }), {
    actionKey: "authority-selection",
    progressFingerprint: `authority-selection:${authorityCount}:${groups.length}`,
    status: authorityCount ? "completed" : "no_op",
    summary: { count: authorityCount, groups: groups.length, direct_contract_fallback_groups: directAuthorityFallbackGroups },
  });
  const agentExecution = agent.complete(firstFailure ? "degraded" : "completed") as JsonRecord;
  const agentTelemetry = await persistAgentTelemetry({
    persistence: createAiPersistence({
      supabaseUrl: environment.supabaseUrl,
      secretKey: environment.secretKey,
    }),
    context: environment.execution,
    execution: agentExecution,
  });
  return {
    evidenceByGroup: evidence,
    enrichmentError: firstFailure,
    incompleteGroupKeys: [...incompleteGroupKeys].filter(Boolean),
    agentExecution: {
      ...agentExecution,
      telemetry_status: agentTelemetry.status,
      telemetry_warnings: agentTelemetry.warnings,
    },
  };
}

function officialEventResolutionSignals(
  candidates: JsonRecord[],
  evidenceByGroup: Map<string, JsonRecord[]>,
  now: string,
): JsonRecord[] {
  const signals: JsonRecord[] = [];
  for (const group of groupCandidates(candidates)) {
    const officialResolution = detectOfficialCoverEventResolution(
      group.candidates,
      evidenceByGroup.get(group.event_group_key) ?? [],
    );
    if (!officialResolution) continue;
    const outcomes = Array.isArray(officialResolution.outcome_names)
      ? officialResolution.outcome_names.join(" y ")
      : officialResolution.winner_name;
    for (const candidate of group.candidates) {
      signals.push({
        event_group_key: group.event_group_key,
        candidate_identity: `${cleanText(candidate.provider, 40)}:${cleanText(candidate.external_id, 220)}`,
        resolved_at: now,
        reason: `Las fuentes oficiales publicaron ya la selecci\u00f3n completa (${outcomes}); el hecho del evento padre est\u00e1 resuelto aunque el proveedor conserve opciones abiertas.`,
        confidence: 100,
        ttl_minutes: 360,
        evidence: officialResolution.evidence,
        selection_complete: officialResolution.selection_complete === true,
      });
    }
  }
  return signals;
}

async function finalizeProviderRefresh(
  environment: Environment,
  provider: string,
  cacheKey: string,
  status: "available" | "partial_error" | "unavailable" | "rate_limited",
  resultCount: number,
  failure?: JsonRecord,
  metrics: {
    accepted?: number;
    discarded?: number;
    quarantined?: number;
    failed?: number;
  } = {},
) {
  await rpc(environment, "finalize_market_radar_provider_refresh_v2", {
    provider_input: provider,
    cache_key_input: cacheKey,
    status_input: status,
    result_count_input: resultCount,
    accepted_count_input: Math.max(0, Number(metrics.accepted) || 0),
    discarded_count_input: Math.max(0, Number(metrics.discarded) || 0),
    quarantined_count_input: Math.max(0, Number(metrics.quarantined) || 0),
    failed_count_input: Math.max(0, Number(metrics.failed) || 0),
    error_code_input: failure?.code ?? null,
    error_message_input: failure?.message ?? null,
    retry_after_seconds_input: Number.isFinite(Number(failure?.retry_after_seconds))
      ? Math.max(0, Math.floor(Number(failure?.retry_after_seconds)))
      : null,
  }, undefined, true);
}

type AuthoritativePersistenceEntry = {
  candidate: JsonRecord;
  eligibilityCheck: JsonRecord;
};

type AuthoritativePersistenceBatchResult = {
  acceptedCount: number;
  quarantined: RadarCandidateQuarantine[];
};

async function writeAuthoritativePersistenceBatch(
  environment: Environment,
  provider: string,
  cacheKey: string,
  entries: AuthoritativePersistenceEntry[],
  deadlineAt: number,
): Promise<AuthoritativePersistenceBatchResult> {
  const remainingMs = Math.max(1, deadlineAt - Date.now());
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), remainingMs);
  try {
    const rawResult = await rpc(environment, "upsert_market_radar_batch_with_eligibility_v1", {
      provider_input: provider,
      cache_key_input: cacheKey,
      normalizer_version_input: RADAR_NORMALIZER_VERSION,
      candidates_input: entries.map(({ candidate }) => candidate),
      eligibility_checks_input: entries.map(({ eligibilityCheck }) => eligibilityCheck),
      eligibility_policy_version_input: RADAR_ELIGIBILITY_POLICY_VERSION,
      provider_status_input: {
        status: "partial_error",
        is_cached: false,
        error_code: "RADAR_REFRESH_IN_PROGRESS",
        error_message: "La actualización del proveedor todavía no ha finalizado.",
      },
    }, undefined, true, {
      signal: AbortSignal.any([controller.signal, environment.execution.signal]),
    });
    const result = toRecord(rawResult);
    const acceptedCount = Math.max(0, Number(result?.accepted_count) || 0);
    const quarantined = toRecordArray(result?.quarantined).map((item) => ({
      provider: cleanText(item.provider, 40) || cleanText(provider, 40),
      external_id: cleanText(item.external_id, 220),
      fingerprint: /^[a-f0-9]{64}$/i.test(cleanText(item.fingerprint, 80))
        ? cleanText(item.fingerprint, 80).toLowerCase()
        : null,
      stage: "authoritative_persistence" as const,
      code: cleanText(item.code, 100) || "RADAR_CANDIDATE_DATA_INVALID",
      database_code: /^[0-9A-Z]{5}$/.test(cleanText(item.database_code, 10))
        ? cleanText(item.database_code, 10)
        : null,
      operation: "upsert_market_radar_batch_with_eligibility_v1",
    }));
    if (result?.ok !== true || acceptedCount + quarantined.length !== entries.length) {
      throw new Error("RADAR_PERSISTENCE_RESULT_INVALID");
    }
    return { acceptedCount, quarantined };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("RADAR_PERSISTENCE_TIMEOUT");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function persistenceIsolationBudgetAvailable(budget: PersistenceIsolationBudget): boolean {
  return budget.remainingRpcCalls > 0
    && Date.now() + PERSISTENCE_RPC_START_MARGIN_MS < budget.deadlineAt;
}

function deferPersistenceBatch(
  provider: string,
  entries: AuthoritativePersistenceEntry[],
  outcome: ProviderPersistenceOutcome,
) {
  const deferral: RadarPersistenceDeferredBatch = {
    provider: cleanText(provider, 40),
    external_ids: entries.map(({ candidate }) => cleanText(candidate.external_id, 220)).filter(Boolean),
    candidate_count: entries.length,
    stage: "authoritative_persistence",
    code: "RADAR_PERSISTENCE_ISOLATION_DEFERRED",
  };
  outcome.deferred.push(deferral);
  console.warn("Radar persistence batch deferred", JSON.stringify(deferral));
}

async function persistBatchWithDataIsolation(
  environment: Environment,
  provider: string,
  cacheKey: string,
  entries: AuthoritativePersistenceEntry[],
  outcome: ProviderPersistenceOutcome,
  budget: PersistenceIsolationBudget,
): Promise<void> {
  if (!entries.length) return;
  if (!persistenceIsolationBudgetAvailable(budget)) {
    deferPersistenceBatch(provider, entries, outcome);
    return;
  }
  budget.remainingRpcCalls -= 1;
  budget.usedRpcCalls += 1;
  outcome.persistenceRpcCalls = budget.usedRpcCalls;
  try {
    const batchResult = await writeAuthoritativePersistenceBatch(
      environment, provider, cacheKey, entries, budget.deadlineAt,
    );
    outcome.persistedCount += batchResult.acceptedCount;
    outcome.quarantined.push(...batchResult.quarantined);
  } catch (error) {
    if (!isQuarantinablePersistenceError(error)) throw error;
    if (entries.length > 1) {
      const middle = Math.ceil(entries.length / 2);
      await persistBatchWithDataIsolation(environment, provider, cacheKey, entries.slice(0, middle), outcome, budget);
      await persistBatchWithDataIsolation(environment, provider, cacheKey, entries.slice(middle), outcome, budget);
      return;
    }
    const quarantine = quarantineFromPersistenceError(provider, entries[0].candidate, error);
    outcome.quarantined.push(quarantine);
    console.warn("Radar candidate quarantined", JSON.stringify(quarantine));
  }
}

function quarantinedProviderNotice(provider: string, count: number) {
  return {
    ...publicProviderError(provider, "RADAR_CANDIDATES_QUARANTINED", 206),
    classification: "quality",
    degrades_provider: false,
    message: `${count} candidata${count === 1 ? "" : "s"} no superaron la validación autoritativa. Las filas sanas sí se conservaron.`,
  };
}

function deferredPersistenceCandidateCount(outcome: ProviderPersistenceOutcome): number {
  return outcome.deferred.reduce((total, batch) => total + batch.candidate_count, 0);
}

function partialPersistenceFailure(provider: string, outcome: ProviderPersistenceOutcome) {
  const deferredCount = deferredPersistenceCandidateCount(outcome);
  return {
    ...publicProviderError(provider, "RADAR_PERSISTENCE_ISOLATION_DEFERRED", 206),
    message: `${deferredCount} candidata${deferredCount === 1 ? " quedó" : "s quedaron"} diferida${deferredCount === 1 ? "" : "s"} al agotarse el presupuesto de aislamiento. Las ${outcome.persistedCount} filas confirmadas se conservaron.`,
  };
}

async function persistProviderResult(
  environment: Environment,
  provider: string,
  cacheKey: string,
  candidates: JsonRecord[],
  successfulProviderCandidateCount = candidates.length,
): Promise<ProviderPersistenceOutcome> {
  const outcome: ProviderPersistenceOutcome = {
    persistedCount: 0,
    quarantined: [],
    deferred: [],
    persistenceRpcCalls: 0,
    failure: null,
  };
  const isolationBudget: PersistenceIsolationBudget = {
    deadlineAt: Date.now() + PERSISTENCE_ISOLATION_BUDGET_MS,
    remainingRpcCalls: MAX_PERSISTENCE_RPC_CALLS_PER_PROVIDER,
    usedRpcCalls: 0,
  };
  try {
    for (let offset = 0; offset < candidates.length; offset += RADAR_PERSISTENCE_BATCH_SIZE) {
      const batch = candidates.slice(offset, offset + RADAR_PERSISTENCE_BATCH_SIZE);
      const entries = await Promise.all(batch.map(async (candidate) => {
        const checkedAt = safeIsoDate(candidate.eligibility_checked_at ?? candidate.verified_at) ?? new Date().toISOString();
        const expiresAt = safeIsoDate(candidate.eligibility_expires_at ?? candidate.verification_expires_at)
          ?? new Date(Date.parse(checkedAt) + VERIFICATION_TTL_MINUTES * 60_000).toISOString();
        const evidence = toRecordArray(candidate.eligibility_evidence ?? candidate.verification_evidence).slice(0, 12);
        return {
          candidate,
          eligibilityCheck: {
            attempt_id: crypto.randomUUID(),
            provider: cleanText(candidate.provider, 40),
            external_id: cleanText(candidate.external_id, 220),
            event_group_key: cleanText(candidate.event_group_key, 240) || null,
            policy_version: RADAR_ELIGIBILITY_POLICY_VERSION,
            status: cleanText(candidate.eligibility_status, 40) || "technical_hold",
            reason_code: cleanText(candidate.eligibility_reason_code, 100) || null,
            reason: cleanText(candidate.eligibility_reason, 1_000) || null,
            evidence,
            checked_at: checkedAt,
            expires_at: expiresAt,
            decision_hash: await sha256Hex({
              provider: candidate.provider,
              external_id: candidate.external_id,
              status: candidate.eligibility_status,
              reason_code: candidate.eligibility_reason_code,
              evidence,
              checked_at: checkedAt,
            }),
          },
        };
      }));
      await persistBatchWithDataIsolation(environment, provider, cacheKey, entries, outcome, isolationBudget);
    }
    if (outcome.deferred.length) {
      outcome.failure = partialPersistenceFailure(provider, outcome);
      await finalizeProviderRefresh(
        environment,
        provider,
        cacheKey,
        outcome.persistedCount > 0 ? "partial_error" : "unavailable",
        outcome.persistedCount,
        outcome.failure,
        {
          accepted: outcome.persistedCount,
          quarantined: outcome.quarantined.length,
          failed: deferredPersistenceCandidateCount(outcome),
        },
      );
    } else {
      const persistedCount = outcome.persistedCount;
      const providerCandidateCount = Math.max(persistedCount, successfulProviderCandidateCount);
      await finalizeProviderRefresh(environment, provider, cacheKey, "available", providerCandidateCount, undefined, {
        accepted: persistedCount,
        discarded: outcome.quarantined.length,
        quarantined: outcome.quarantined.length,
      });
    }
    return outcome;
  } catch (error) {
    const failure = persistenceFailure(error, provider);
    outcome.failure = failure;
    await finalizeProviderRefresh(
      environment,
      provider,
      cacheKey,
      outcome.persistedCount > 0 ? "partial_error" : "unavailable",
      outcome.persistedCount,
      failure,
      {
        accepted: outcome.persistedCount,
        quarantined: outcome.quarantined.length,
        failed: Math.max(1, deferredPersistenceCandidateCount(outcome)),
      },
    ).catch(() => null);
    throw new RadarPersistenceError(failure, outcome);
  }
}

type RadarProviderRefreshOutcomeV2 = ProviderPersistenceOutcome & {
  issues: JsonRecord[];
  inProgress: boolean;
  terminal: boolean;
  quarantinedCount: number;
};

function refreshOutcomeFromSummary(provider: string, summary: JsonRecord | null): RadarProviderRefreshOutcomeV2 {
  const issue = toRecord(summary?.issue);
  const status = cleanText(summary?.status, 40);
  const failure = issue
    ? publicProviderError(provider, cleanText(issue.issue_code, 100) || "PROVIDER_UNAVAILABLE", 503)
    : status && status !== "available" ? publicProviderError(provider, "PROVIDER_UNAVAILABLE", 503) : null;
  return {
    persistedCount: Math.max(0, Number(summary?.accepted_count) || 0),
    quarantined: [],
    deferred: [],
    persistenceRpcCalls: 0,
    failure,
    issues: issue ? [issue] : [],
    inProgress: false,
    terminal: true,
    quarantinedCount: Math.max(0, Number(summary?.quarantined_count) || 0),
  };
}

async function radarPersistenceEntries(
  candidates: JsonRecord[],
  cacheKey: string,
): Promise<JsonRecord[]> {
  return Promise.all(candidates.map(async (candidate) => {
    const checkedAt = safeIsoDate(candidate.eligibility_checked_at ?? candidate.verified_at)
      ?? new Date().toISOString();
    const expiresAt = safeIsoDate(candidate.eligibility_expires_at ?? candidate.verification_expires_at)
      ?? new Date(Date.parse(checkedAt) + VERIFICATION_TTL_MINUTES * 60_000).toISOString();
    const evidence = toRecordArray(candidate.eligibility_evidence ?? candidate.verification_evidence).slice(0, 12);
    const persistedCandidate = { ...candidate, cache_key: cacheKey };
    return {
      candidate: persistedCandidate,
      eligibility_check: {
        provider: cleanText(candidate.provider, 40),
        external_id: cleanText(candidate.external_id, 220),
        event_group_key: cleanText(candidate.event_group_key, 240) || null,
        policy_version: RADAR_ELIGIBILITY_POLICY_VERSION,
        status: cleanText(candidate.eligibility_status, 40) || "technical_hold",
        reason_code: cleanText(candidate.eligibility_reason_code, 100) || null,
        reason: cleanText(candidate.eligibility_reason, 1_000) || null,
        evidence,
        checked_at: checkedAt,
        expires_at: expiresAt,
        decision_hash: await sha256Hex({
          provider: candidate.provider,
          external_id: candidate.external_id,
          status: candidate.eligibility_status,
          reason_code: candidate.eligibility_reason_code,
          evidence,
          checked_at: checkedAt,
        }),
      },
    };
  }));
}

async function persistProviderResultV2(
  environment: Environment,
  intent: RadarRefreshIntent,
  cacheKey: string,
  candidates: JsonRecord[] | null,
): Promise<RadarProviderRefreshOutcomeV2> {
  if (intent.terminal) return refreshOutcomeFromSummary(intent.provider, intent.responseSummary);
  if (intent.inProgress || !intent.leaseToken) {
    const issue = toRecord(intent.responseSummary?.issue) ?? await radarRefreshIssue({
      requestId: intent.requestId,
      provider: intent.provider,
      capability: intent.capability,
      code: "RADAR_REFRESH_ALREADY_RUNNING",
      failureStage: "persistence",
    });
    return {
      persistedCount: 0, quarantined: [], deferred: [], persistenceRpcCalls: 0,
      failure: publicProviderError(intent.provider, "RADAR_REFRESH_ALREADY_RUNNING", 202),
      issues: [issue], inProgress: true, terminal: false,
      quarantinedCount: 0,
    };
  }

  let rpcCalls = 0;
  let phase = intent.phase;
  if (["claimed", "fetching", "staged"].includes(phase)) {
    const stagedComplete = phase === "staged" && intent.expectedCount !== null
      && intent.stagedCount === intent.expectedCount;
    let expectedCount = intent.expectedCount;
    if (!stagedComplete) {
      if (!Array.isArray(candidates)) throw new Error("RADAR_REFRESH_STAGING_INPUT_REQUIRED");
      const entries = await radarPersistenceEntries(candidates, cacheKey);
      expectedCount = entries.length;
      await renewRadarRefreshLease(environment, intent);
      await rpc(environment, "declare_market_radar_refresh_manifest_v1", {
        request_id_input: intent.requestId,
        provider_input: intent.provider,
        capability_input: intent.capability,
        lease_token_input: intent.leaseToken,
        expected_count_input: entries.length,
      }, undefined, true);
      rpcCalls += 1;
      for (let offset = 0, ordinal = 0; offset < entries.length; offset += RADAR_PERSISTENCE_BATCH_SIZE, ordinal += 1) {
        await renewRadarRefreshLease(environment, intent);
        await rpc(environment, "stage_market_radar_refresh_batch_v1", {
          request_id_input: intent.requestId,
          provider_input: intent.provider,
          capability_input: intent.capability,
          lease_token_input: intent.leaseToken,
          batch_ordinal_input: ordinal,
          items_input: entries.slice(offset, offset + RADAR_PERSISTENCE_BATCH_SIZE),
        }, undefined, true);
        rpcCalls += 1;
      }
    }
    if (expectedCount === null) throw new Error("RADAR_REFRESH_MANIFEST_REQUIRED");
    await renewRadarRefreshLease(environment, intent);
    await rpc(environment, "seal_market_radar_refresh_v1", {
      request_id_input: intent.requestId,
      provider_input: intent.provider,
      capability_input: intent.capability,
      lease_token_input: intent.leaseToken,
      expected_count_input: expectedCount,
    }, undefined, true);
    rpcCalls += 1;
    phase = "persisting";
  }

  const persistenceDeadline = Math.min(
    Date.now() + PERSISTENCE_ISOLATION_BUDGET_MS,
    environment.execution.absoluteDeadlineAt - FINALIZATION_RESERVE_MS,
  );
  let lastResult: JsonRecord | null = null;
  for (let call = 0; call < RADAR_REFRESH_MAX_PROCESS_CALLS; call += 1) {
    if (Date.now() + PERSISTENCE_RPC_START_MARGIN_MS >= persistenceDeadline) break;
    await renewRadarRefreshLease(environment, intent);
    lastResult = toRecord(await rpc(environment, "process_market_radar_refresh_batch_v1", {
      request_id_input: intent.requestId,
      provider_input: intent.provider,
      capability_input: intent.capability,
      lease_token_input: intent.leaseToken,
    }, undefined, true));
    rpcCalls += 1;
    if (lastResult?.ok === false) {
      const batchId = cleanText(lastResult.batch_id, 80);
      const itemCount = Math.max(0, Number(lastResult.item_count) || 0);
      if (validUuid(batchId) && itemCount > 1) {
        await renewRadarRefreshLease(environment, intent);
        await rpc(environment, "split_market_radar_refresh_batch_v1", {
          request_id_input: intent.requestId,
          provider_input: intent.provider,
          capability_input: intent.capability,
          lease_token_input: intent.leaseToken,
          batch_id_input: batchId,
        }, undefined, true);
        rpcCalls += 1;
        continue;
      }
      break;
    }
    if (Math.max(0, Number(lastResult?.remaining_batches) || 0) === 0) break;
  }

  if (!lastResult || lastResult.ok === false || Math.max(0, Number(lastResult.remaining_batches) || 0) > 0) {
    const code = cleanText(lastResult?.code, 100) || "RADAR_PERSISTENCE_ISOLATION_DEFERRED";
    const deferred = toRecord(await rpc(environment, "defer_market_radar_refresh_v1", {
      request_id_input: intent.requestId,
      provider_input: intent.provider,
      capability_input: intent.capability,
      lease_token_input: intent.leaseToken,
      issue_code_input: code,
    }, undefined, true));
    const issue = toRecord(deferred?.issue) ?? await radarRefreshIssue({
      requestId: intent.requestId,
      provider: intent.provider,
      capability: intent.capability,
      code,
      failureStage: "persistence",
    });
    return {
      persistedCount: Math.max(0, Number(deferred?.processed_count) || 0),
      quarantined: [], deferred: [], persistenceRpcCalls: rpcCalls + 1,
      failure: publicProviderError(intent.provider, code, 202), issues: [issue],
      inProgress: true, terminal: false,
      quarantinedCount: Math.max(0, Number(deferred?.quarantined_count) || 0),
    };
  }

  await renewRadarRefreshLease(environment, intent);
  const finalized = toRecord(await rpc(environment, "finalize_market_radar_refresh_v3", {
    request_id_input: intent.requestId,
    provider_input: intent.provider,
    capability_input: intent.capability,
    lease_token_input: intent.leaseToken,
    status_input: "available",
    error_code_input: null,
    failure_stage_input: null,
    retry_after_seconds_input: null,
  }, undefined, true));
  const issue = toRecord(finalized?.issue);
  return {
    persistedCount: Math.max(0, Number(finalized?.accepted_count) || 0),
    quarantined: [], deferred: [], persistenceRpcCalls: rpcCalls + 2,
    failure: null, issues: issue ? [issue] : [], inProgress: false, terminal: true,
    quarantinedCount: Math.max(0, Number(finalized?.quarantined_count) || 0),
  };
}

async function finalizeRadarRefreshFailureV2(
  environment: Environment,
  intent: RadarRefreshIntent,
  failure: JsonRecord,
  failureStage: "fetch" | "persistence" | "enrichment",
): Promise<JsonRecord> {
  if (intent.terminal) return intent.responseSummary ?? {};
  if (intent.inProgress || !intent.leaseToken) {
    return {
      outcome: "in_progress",
      issue: intent.responseSummary?.issue ?? await radarRefreshIssue({
        requestId: intent.requestId,
        provider: intent.provider,
        capability: intent.capability,
        code: "RADAR_REFRESH_ALREADY_RUNNING",
        failureStage,
      }),
    };
  }
  await renewRadarRefreshLease(environment, intent);
  return toRecord(await rpc(environment, "finalize_market_radar_refresh_v3", {
    request_id_input: intent.requestId,
    provider_input: intent.provider,
    capability_input: intent.capability,
    lease_token_input: intent.leaseToken,
    status_input: cleanText(failure.code, 100) === "PROVIDER_RATE_LIMITED" ? "rate_limited" : "unavailable",
    error_code_input: cleanText(failure.code, 100) || "PROVIDER_UNAVAILABLE",
    failure_stage_input: failureStage,
    retry_after_seconds_input: Number.isFinite(Number(failure.retry_after_seconds))
      ? Math.max(0, Math.floor(Number(failure.retry_after_seconds)))
      : null,
  }, undefined, true)) ?? {};
}

async function finalizeRadarEnrichmentSuccessV2(
  environment: Environment,
  intent: RadarRefreshIntent,
): Promise<JsonRecord> {
  if (intent.terminal) return intent.responseSummary ?? {};
  if (intent.inProgress || !intent.leaseToken) return { outcome: "in_progress" };
  await renewRadarRefreshLease(environment, intent);
  return toRecord(await rpc(environment, "finalize_market_radar_refresh_v3", {
    request_id_input: intent.requestId,
    provider_input: intent.provider,
    capability_input: intent.capability,
    lease_token_input: intent.leaseToken,
    status_input: "available",
    error_code_input: null,
    failure_stage_input: null,
    retry_after_seconds_input: null,
  }, undefined, true)) ?? {};
}

async function persistProviderFailure(environment: Environment, provider: string, cacheKey: string, failure: JsonRecord) {
  await finalizeProviderRefresh(
    environment,
    provider,
    cacheKey,
    failure.code === "PROVIDER_RATE_LIMITED" ? "rate_limited" : "unavailable",
    0,
    failure,
    { failed: 1 },
  ).catch(() => null);
}

function hasCurrentEligibility(candidate: JsonRecord, checkedAt = Date.now()): boolean {
  const eligibilityCheckedAt = Date.parse(cleanText(candidate.eligibility_checked_at, 100));
  const eligibilityExpiresAt = Date.parse(cleanText(candidate.eligibility_expires_at, 100));
  return cleanText(candidate.eligibility_status, 40) === "eligible"
    && cleanText(candidate.eligibility_policy_version, 100) === RADAR_ELIGIBILITY_POLICY_VERSION
    && Boolean(candidate.current_eligibility_check_id)
    && Number.isFinite(eligibilityCheckedAt)
    && eligibilityCheckedAt <= checkedAt + 60_000
    && Number.isFinite(eligibilityExpiresAt)
    && eligibilityExpiresAt > checkedAt;
}

function activeProviderCircuit(providerRuns: JsonRecord[], provider: string, nowMs = Date.now()): JsonRecord | null {
  const latest = providerRuns
    .filter((item) => cleanText(item.provider, 40) === provider)
    .sort((left, right) => Date.parse(cleanText(right.fetched_at, 100)) - Date.parse(cleanText(left.fetched_at, 100)))[0];
  if (!latest || cleanText(latest.circuit_state, 40) !== "open") return null;
  const retryAfterAt = Date.parse(cleanText(latest.retry_after_at, 100));
  if (!Number.isFinite(retryAfterAt) || retryAfterAt <= nowMs) return null;
  return {
    provider,
    code: "PROVIDER_RATE_LIMITED",
    status: 429,
    message: "El proveedor mantiene un límite temporal. Atinara conserva el último resultado válido y reintentará cuando termine el plazo indicado.",
    retry_after_seconds: Math.max(1, Math.ceil((retryAfterAt - nowMs) / 1_000)),
    retry_after_at: new Date(retryAfterAt).toISOString(),
    retryable: true,
    last_known_good_count: Number(latest.last_success_count) || 0,
    last_known_good_at: latest.last_success_at || null,
    state_preserved: true,
  };
}

async function loadRadarView(
  environment: Environment,
  authorization: string,
  filters: ReturnType<typeof safeFilters>,
  minimumDiscoveryCheckedAt: string | null = null,
) {
  const [candidatesPayload, rejectedPayload, providers] = await Promise.all([
    rpc(environment, "list_market_radar_candidates_v3", {
      provider_filter: filters.provider === "all" ? null : filters.provider,
      category_filter: filters.category || null,
      quality_filter: filters.quality,
      query_filter: filters.query || null,
      order_key: filters.order,
      horizon_filter: filters.horizon,
      parent_limit_count: MAX_VISIBLE_GROUPS,
      parent_offset_count: filters.parent_offset,
    }, authorization),
    rpc(environment, "list_market_radar_rejections", {
      provider_filter: filters.provider === "all" ? null : filters.provider,
      category_filter: filters.category || null,
      limit_count: 100,
      offset_count: 0,
    }, authorization).catch(() => []),
    rpc(environment, "get_market_radar_provider_status", {}, authorization),
  ]);
  const checkedAt = Date.now();
  const minimumCheckedAt = minimumDiscoveryCheckedAt ? Date.parse(minimumDiscoveryCheckedAt) : Number.NaN;
  const candidatePage = toRecord(candidatesPayload) ?? {};
  const candidates = toRecordArray(candidatePage.items)
    .filter((candidate) => cleanText(candidate.eligibility_policy_version, 80) === RADAR_ELIGIBILITY_POLICY_VERSION)
    .filter((candidate) => filters.quality !== "fit" || hasCurrentEligibility(candidate, checkedAt))
    .filter((candidate) => !Number.isFinite(minimumCheckedAt)
      || Date.parse(cleanText(candidate.fetched_at, 100)) >= minimumCheckedAt);
  const rejected = toRecordArray(rejectedPayload);
  const groups = groupCandidates(candidates).sort((left, right) => {
    const leftRank = Math.min(...left.candidates.map((candidate: JsonRecord) => Number(candidate.parent_rank) || Number.MAX_SAFE_INTEGER));
    const rightRank = Math.min(...right.candidates.map((candidate: JsonRecord) => Number(candidate.parent_rank) || Number.MAX_SAFE_INTEGER));
    return leftRank - rightRank;
  });
  return {
    candidates,
    groups,
    rejected: summarizeRejections(rejected),
    providers: toRecordArray(providers),
    page: {
      parent_count: Math.max(0, Number(candidatePage.parent_count) || 0),
      parent_offset: Math.max(0, Number(candidatePage.parent_offset) || 0),
      parent_limit: Math.max(1, Number(candidatePage.parent_limit) || MAX_VISIBLE_GROUPS),
      next_parent_offset: Number.isInteger(Number(candidatePage.next_parent_offset))
        ? Number(candidatePage.next_parent_offset) : null,
    },
  };
}

async function runDiscovery(environment: Environment, authorization: string, body: JsonRecord) {
  const filters = safeFilters(body);
  const cacheKey = buildCacheKey(filters);
  const current = await loadRadarView(environment, authorization, filters);
  const requestedRefresh = body.refresh === true;
  const latest = current.providers
    .filter((provider) => RADAR_CANDIDATE_PROVIDERS.includes(cleanText(provider.provider, 40)))
    .map((provider) => Date.parse(cleanText(provider.fetched_at, 100)))
    .filter(Number.isFinite).sort((a, b) => b - a)[0] || 0;
  const cooldownRemaining = Math.max(0, REFRESH_COOLDOWN_MS - (Date.now() - latest));
  if (!requestedRefresh || cooldownRemaining > 0) {
    // loadRadarView ya excluye snapshots caducados, hechos no discovery y
    // duplicados ocupados. Conservar ese último expediente vigente permite
    // explorar y filtrar durante el cooldown o una degradación técnica sin
    // presentarlo como una verificación fresca ni habilitar Preparar en la UI.
    const requestedProviderNames = filters.provider === "all"
      ? new Set(["polymarket", "kalshi"])
      : new Set([filters.provider]);
    const providerCoverageCurrent = current.providers.some((provider) => {
      if (!requestedProviderNames.has(cleanText(provider.provider, 40))) return false;
      const expiresAt = Date.parse(cleanText(provider.expires_at, 100));
      if (Number.isFinite(expiresAt)) return expiresAt > Date.now();
      const fetchedAt = Date.parse(cleanText(provider.fetched_at, 100));
      return Number.isFinite(fetchedAt)
        && fetchedAt + (FACT_CHECK_TTL_MINUTES * 60_000) > Date.now();
    });
    const cachedAuthoritative = current.candidates.length > 0 || providerCoverageCurrent;
    const candidateProviders = current.providers.filter((provider) =>
      RADAR_CANDIDATE_PROVIDERS.includes(cleanText(provider.provider, 40)));
    const enrichmentCapabilities = current.providers
      .filter((provider) => RADAR_ENRICHMENT_CAPABILITIES.includes(cleanText(provider.provider, 40)))
      .map((provider) => ({ ...provider, role: "source_enrichment", affects_catalog_health: false }));
    return jsonResponse({
      ok: true,
      ...current,
      providers: candidateProviders,
      candidate_providers: candidateProviders,
      enrichment_capabilities: enrichmentCapabilities,
      provider_role_version: RADAR_PROVIDER_ROLE_VERSION,
      provider_issues: [],
      enrichment_issues: [],
      cached_candidate_count: current.candidates.length,
      filters,
      cache_key: cacheKey,
      cached: true,
      cached_authoritative: cachedAuthoritative,
      requires_eligibility_refresh: !cachedAuthoritative,
      cooldown_seconds: Math.ceil(cooldownRemaining / 1000),
      cooldown_until: new Date(Date.now() + cooldownRemaining).toISOString(),
      limits: { max_pages: MAX_PROVIDER_PAGES, max_kalshi_series: MAX_KALSHI_SERIES, max_visible_groups: MAX_VISIBLE_GROUPS },
    });
  }

  const now = new Date().toISOString();
  const refreshRequestHash = await sha256Hex({
    request_version: RADAR_REFRESH_REQUEST_VERSION,
    provider_role_version: RADAR_PROVIDER_ROLE_VERSION,
    filters,
  });
  const requestedRefreshId = cleanText(body.refresh_request_id, 80);
  const activeRefresh = toRecord(await rpc(
    environment,
    "get_active_market_radar_refresh_v1",
    { request_hash_input: refreshRequestHash, cache_key_input: cacheKey },
    authorization,
  ));
  const activeRefreshId = cleanText(activeRefresh?.request_id, 80);
  const refreshRequestId = validUuid(activeRefreshId) ? activeRefreshId
    : validUuid(requestedRefreshId) ? requestedRefreshId : crypto.randomUUID();
  const refresh: RadarRefreshContext = {
    requestId: refreshRequestId,
    requestHash: refreshRequestHash,
    leaseOwner: environment.execution.invocationId,
    intents: new Map(),
  };
  const requestedProviders = filters.provider === "all"
    ? [...RADAR_CANDIDATE_PROVIDERS]
    : RADAR_CANDIDATE_PROVIDERS.includes(filters.provider) ? [filters.provider] : [];
  const candidateProviderErrors: JsonRecord[] = [];
  const providerIssues: JsonRecord[] = [];
  const enrichmentIssues: JsonRecord[] = [];
  const providerIntents = new Map<string, RadarRefreshIntent>();
  for (const provider of requestedProviders) {
    const intent = await beginRadarRefreshIntent(
      environment, authorization, refresh, provider, "candidate_feed", cacheKey,
    );
    providerIntents.set(provider, intent);
    const issue = toRecord(intent.responseSummary?.issue);
    if (issue) providerIssues.push(issue);
    if (intent.inProgress) {
      candidateProviderErrors.push({
        ...publicProviderError(provider, "RADAR_REFRESH_ALREADY_RUNNING", 202),
        retryable: true,
        state_preserved: true,
        issue,
      });
    }
  }
  const tavilyIntent = await beginRadarRefreshIntent(
    environment, authorization, refresh, "tavily", "source_enrichment", cacheKey,
  );
  const initialTavilyIssue = toRecord(tavilyIntent.responseSummary?.issue);
  if (initialTavilyIssue) enrichmentIssues.push(initialTavilyIssue);

  const authoritativeDomains = await loadAuthoritativeSourceDomains(environment).catch(() => new Set<string>());
  const kalshiIntent = providerIntents.get("kalshi");
  const reconciledCandidates = kalshiIntent && !kalshiIntent.terminal && !kalshiIntent.inProgress
    ? await reconcileRejectedKalshiOutcomes(
      environment,
      toRecordArray(current.rejected?.items),
      now,
    ).catch(() => [])
    : [];
  const reconciledProviderResults = reconciledCandidates.length;
  const existing = await loadExistingDefinitions(environment, authorization);
  const providers = requestedProviders.filter((provider) => {
    const intent = providerIntents.get(provider);
    return Boolean(intent && !intent.terminal && !intent.inProgress
      && !["persisting", "finalizing"].includes(intent.phase)
      && !(intent.phase === "staged" && intent.expectedCount !== null
        && intent.stagedCount === intent.expectedCount));
  });
  const discoveredByProvider = new Map<string, JsonRecord[]>();
  const discoveryResults = await mapWithConcurrency(providers, Math.max(1, providers.length), async (provider) => ({
    provider,
    candidates: provider === "polymarket"
      ? await discoverPolymarket(environment, now, filters)
      : await discoverKalshi(environment, now),
  }));
  for (let index = 0; index < discoveryResults.length; index += 1) {
    const result = discoveryResults[index];
    const provider = providers[index];
    if (result.status === "fulfilled") {
      discoveredByProvider.set(result.value.provider, result.value.candidates as JsonRecord[]);
      continue;
    }
    const failure = providerFailure(result.reason, provider);
    const intent = providerIntents.get(provider);
    const finalization = intent
      ? await finalizeRadarRefreshFailureV2(environment, intent, failure, "fetch")
      : {};
    const issue = toRecord(finalization.issue) ?? await radarRefreshIssue({
      requestId: refresh.requestId, provider, capability: "candidate_feed",
      code: cleanText(failure.code, 100) || "PROVIDER_UNAVAILABLE", failureStage: "fetch",
    });
    providerIssues.push(issue);
    candidateProviderErrors.push({ ...failure, issue, state_preserved: true });
  }
  if (reconciledCandidates.length) {
    const currentKalshi = discoveredByProvider.get("kalshi") ?? [];
    const byIdentity = new Map(currentKalshi.map((candidate) => [
      cleanText(candidate.external_id, 220), candidate,
    ]));
    for (const candidate of reconciledCandidates) {
      byIdentity.set(cleanText(candidate.external_id, 220), candidate);
    }
    discoveredByProvider.set("kalshi", [...byIdentity.values()]);
  }

  const qualityNotices: JsonRecord[] = [];
  const domainScopedCandidates: JsonRecord[] = await Promise.all(
    [...discoveredByProvider.values()].flat().map(async (candidate: JsonRecord): Promise<JsonRecord> => ({
      ...candidate,
      domain_review_fingerprint: await radarDomainFingerprintV1(candidate),
    })),
  );
  const domainReviewScopeMap = new Map<string, JsonRecord>();
  for (const candidate of domainScopedCandidates) {
    const scope: JsonRecord = {
      provider: cleanText(candidate.provider, 40),
      external_id: cleanText(candidate.external_id, 220),
      domain_fingerprint: cleanText(candidate.domain_review_fingerprint, 80),
    };
    if (scope.provider && scope.external_id && /^[a-f0-9]{64}$/.test(String(scope.domain_fingerprint))) {
      domainReviewScopeMap.set(`${scope.provider}\u0000${scope.external_id}\u0000${scope.domain_fingerprint}`, scope);
    }
  }
  const domainReviewScopes = [...domainReviewScopeMap.values()]
    .slice(0, MAX_NORMALIZED_PER_PROVIDER * RADAR_CANDIDATE_PROVIDERS.length);
  const domainReviewRows: JsonRecord[] = [];
  let domainReviewStateAvailable = true;
  for (let offset = 0; offset < domainReviewScopes.length; offset += 240) {
    try {
      domainReviewRows.push(...toRecordArray(await rpc(environment, "get_market_radar_domain_reviews_v1", {
        fingerprints_input: domainReviewScopes.slice(offset, offset + 240),
      }, undefined, true)));
    } catch {
      domainReviewStateAvailable = false;
      domainReviewRows.length = 0;
      break;
    }
  }
  if (!domainReviewStateAvailable) qualityNotices.push({
    provider: "radar", code: "RADAR_DOMAIN_REVIEW_STATE_UNAVAILABLE", quarantined_count: 0,
    message: "Las decisiones humanas de dominio no pudieron proyectarse. Las candidatas ambiguas permanecen bloqueadas.",
  });
  const domainReviews = new Map(domainReviewRows.map((review) => [
    `${cleanText(review.provider, 40)}\u0000${cleanText(review.external_id, 220)}\u0000${cleanText(review.domain_fingerprint, 80)}`,
    review,
  ]));

  // La elegibilidad no depende de que un modelo demuestre la ausencia de un
  // resultado. El proveedor abre la candidata; Atinara solo la cierra por una
  // señal canónica o una prueba oficial terminal exacta para su sujeto.
  let candidates = domainScopedCandidates.map((candidate) => {
    const humanReview = domainReviews.get(
      `${cleanText(candidate.provider, 40)}\u0000${cleanText(candidate.external_id, 220)}\u0000${cleanText(candidate.domain_review_fingerprint, 80)}`,
    );
    const classifiedCandidate = projectRadarDomainReview(candidate, humanReview);
    const providerDecision = domainReviewStateAvailable
      ? evaluateProviderEligibility(classifiedCandidate, now) as JsonRecord | null
      : {
        eligible: false,
        conclusive: false,
        reason_code: "RADAR_DOMAIN_REVIEW_STATE_UNAVAILABLE",
        reason: "Las atestaciones humanas de dominio no pudieron comprobarse; el snapshot permanece bloqueado.",
        confidence: 0,
        ttl_minutes: 5,
        evidence: [],
      };
    return applyDeterministicRadarEligibility(classifiedCandidate, providerDecision, now) as JsonRecord;
  });
  candidates = candidates.map((candidate) => ({ ...candidate, workflow_issues: [] }));
  let evidenceByGroup = new Map<string, JsonRecord[]>();
  let deferredVerificationCount = 0;
  let processedVerificationCount = 0;
  let failedVerificationBatches = 0;
  let incompleteOfficialResearchGroups = new Set<string>();
  let sourceAgentExecution: JsonRecord | null = null;
  const scanCandidates = candidates.filter((candidate) => candidate.eligibility_status === "eligible");
  if (!authoritativeDomains.size) {
    const failure = {
      ...publicProviderError("tavily", "SOURCE_AUTHORITY_REGISTRY_UNAVAILABLE", 503),
      classification: "enrichment",
      degrades_provider: false,
      message: "El registro de fuentes oficiales no estuvo disponible. Las candidatas de proveedor se conservan, pero preparar seguirá cerrado hasta recuperarlo.",
    };
    const finalization = await finalizeRadarRefreshFailureV2(environment, tavilyIntent, failure, "enrichment");
    const issue = toRecord(finalization.issue) ?? await radarRefreshIssue({
      requestId: refresh.requestId, provider: "tavily", capability: "source_enrichment",
      code: "SOURCE_AUTHORITY_REGISTRY_UNAVAILABLE", failureStage: "enrichment",
    });
    enrichmentIssues.push(issue);
  }
  if (scanCandidates.length && authoritativeDomains.size
      && !tavilyIntent.terminal && !tavilyIntent.inProgress) {
    try {
      const research = await researchGroupsWithTavily(environment, environment.tavilyKey, scanCandidates, authoritativeDomains);
      evidenceByGroup = research.evidenceByGroup;
      sourceAgentExecution = research.agentExecution;
      incompleteOfficialResearchGroups = new Set(research.incompleteGroupKeys);
      if (research.enrichmentError) {
        const failure = research.enrichmentError instanceof Error
          && research.enrichmentError.message === "PROVIDER_NOT_CONFIGURED"
          ? publicProviderError("tavily", "PROVIDER_NOT_CONFIGURED", 503)
          : providerFailure(research.enrichmentError, "tavily");
        const finalization = await finalizeRadarRefreshFailureV2(environment, tavilyIntent, failure, "enrichment");
        const issue = toRecord(finalization.issue) ?? await radarRefreshIssue({
          requestId: refresh.requestId, provider: "tavily", capability: "source_enrichment",
          code: cleanText(failure.code, 100) || "PROVIDER_UNAVAILABLE", failureStage: "enrichment",
        });
        enrichmentIssues.push(issue);
      } else {
        await finalizeRadarEnrichmentSuccessV2(environment, tavilyIntent);
      }
    } catch (error) {
      incompleteOfficialResearchGroups = new Set(scanCandidates.map((candidate) => cleanText(candidate.event_group_key, 240)).filter(Boolean));
      const failure = error instanceof Error && error.message === "PROVIDER_NOT_CONFIGURED"
        ? publicProviderError("tavily", "PROVIDER_NOT_CONFIGURED", 503)
        : providerFailure(error, "tavily");
      // Tavily es un enriquecedor sustituible. Su caída no convierte a
      // Polymarket o Kalshi en proveedores con incidencia.
      const finalization = await finalizeRadarRefreshFailureV2(environment, tavilyIntent, failure, "enrichment");
      const issue = toRecord(finalization.issue) ?? await radarRefreshIssue({
        requestId: refresh.requestId, provider: "tavily", capability: "source_enrichment",
        code: cleanText(failure.code, 100) || "PROVIDER_UNAVAILABLE", failureStage: "enrichment",
      });
      enrichmentIssues.push(issue);
    }
  } else if (!scanCandidates.length && authoritativeDomains.size
      && !tavilyIntent.terminal && !tavilyIntent.inProgress) {
    await finalizeRadarEnrichmentSuccessV2(environment, tavilyIntent);
  }

  const groupResolutions = new Map(officialEventResolutionSignals(candidates, evidenceByGroup, now)
    .map((signal) => [cleanText(signal.event_group_key, 240), signal]));
  const groupSelectionHolds = new Map<string, JsonRecord>();
  for (const group of groupCandidates(candidates)) {
    const groupKey = cleanText(group.event_group_key, 240);
    const hold = detectOfficialCoverSelectionHold(
      group.candidates,
      evidenceByGroup.get(group.event_group_key) ?? [],
    ) as JsonRecord | null;
    if (groupKey && hold) groupSelectionHolds.set(groupKey, hold);
  }
  candidates = candidates.map((candidate) => {
    if (candidate.eligibility_status !== "eligible") return sourceAgentExecution
      ? { ...candidate, source_agent_execution: sourceAgentExecution }
      : candidate;
    const groupEvidence = evidenceByGroup.get(cleanText(candidate.event_group_key, 240)) ?? [];
    const groupResearchComplete = !incompleteOfficialResearchGroups.has(cleanText(candidate.event_group_key, 240));
    const subject = cleanText(candidateResolutionSubject(candidate), 240);
    const subjectTokens = sourceTokens(subject).filter((token) => !SOURCE_GENERIC_ANCHORS.has(token));
    const exactEvidence = groupEvidence.filter((item) => {
      const materialTokens = new Set(sourceTokens(`${item.title ?? ""} ${item.supports ?? ""}`));
      return isResolutionAuthorityEvidence(item)
        || (subjectTokens.length >= 1 && subjectTokens.every((token) => materialTokens.has(token)));
    });
    const groupResolution = groupResolutions.get(cleanText(candidate.event_group_key, 240));
    const groupSelectionHold = groupSelectionHolds.get(cleanText(candidate.event_group_key, 240));
    const terminalEvidence = exactEvidence.filter((item) => evidenceHasPotentialTerminalClaim(item, candidate, now));
    if (groupResolution || terminalEvidence.length) {
      return applyDeterministicRadarEligibility({ ...candidate, source_agent_execution: sourceAgentExecution }, {
        eligible: false,
        conclusive: true,
        reason_code: RADAR_REASON_CODES.EVENT_ALREADY_RESOLVED,
        reason: cleanText(groupResolution?.reason, 1_000)
          || "Una fuente oficial exacta para esta opción ya publicó el resultado.",
        confidence: 100,
        ttl_minutes: 1_440,
        evidence: groupResolution?.evidence ?? terminalEvidence,
      }, now) as JsonRecord;
    }
    if (groupSelectionHold) {
      return applyDeterministicRadarEligibility({ ...candidate, source_agent_execution: sourceAgentExecution }, {
        eligible: false,
        conclusive: false,
        reason_code: RADAR_REASON_CODES.OFFICIAL_SELECTION_RECHECK_REQUIRED,
        reason: "Una fuente oficial apunta a una selección ya publicada, pero la comprobación automática debe completar su alcance. El evento permanece oculto y se reintentará.",
        confidence: 0,
        ttl_minutes: 5,
        evidence: groupSelectionHold.evidence ?? [],
      }, now) as JsonRecord;
    }
    if (!groupResearchComplete) {
      return applyDeterministicRadarEligibility({ ...candidate, source_agent_execution: sourceAgentExecution }, {
        eligible: false,
        conclusive: false,
        reason_code: RADAR_REASON_CODES.OFFICIAL_TERMINAL_SCAN_UNAVAILABLE,
        reason: "La comprobación oficial de resultados conocidos no terminó. Atinara conserva el último expediente válido y volverá a intentarlo.",
        confidence: 0,
        ttl_minutes: 5,
        evidence: [],
      }, now) as JsonRecord;
    }
    const resolutionSourceUrl = selectVerifiedResolutionUrl(candidate, exactEvidence, authoritativeDomains);
    if (!resolutionSourceUrl) {
      return applyDeterministicRadarEligibility({ ...candidate, source_agent_execution: sourceAgentExecution }, {
        eligible: false,
        conclusive: false,
        reason_code: RADAR_REASON_CODES.RESOLUTION_SOURCE_AUTHORITY_PENDING,
        reason: groupResearchComplete
          ? "Atinara no encontró todavía una fuente resolutiva oficial y exacta para esta opción. La volverá a comprobar automáticamente."
          : "La búsqueda de fuentes oficiales no terminó. Se conserva el último expediente válido y Atinara volverá a intentarlo automáticamente.",
        confidence: 0,
        ttl_minutes: 5,
        evidence: [],
      }, now) as JsonRecord;
    }
    const sourceEvidence = resolutionSourceUrl
      ? exactEvidence.filter((item) => safePublicUrl(item.url) === resolutionSourceUrl
        && (item.evidence_basis !== "provider_resolution_contract"
          || cleanText(item.candidate_external_id, 220) === cleanText(candidate.external_id, 220))).slice(0, 6)
      : [];
    return {
      ...candidate,
      ...(sourceAgentExecution ? { source_agent_execution: sourceAgentExecution } : {}),
      atinara_resolution_source_url: resolutionSourceUrl,
      resolution_source_evidence: sourceEvidence,
      eligibility_evidence: sourceEvidence,
      verification_evidence: sourceEvidence,
    };
  });

  candidates = candidates.map((candidate) => normalizeRadarCandidatePresentation(candidate) as JsonRecord);
  let scored = (scoreCandidates(candidates, existing, now) as JsonRecord[]).map((candidate) => {
    const duplicate = toRecordArray(candidate.duplicate_matches).some((match) => isBlockingDuplicateMatch(match));
    return duplicate && candidate.eligibility_status === "eligible"
      ? applyDeterministicRadarEligibility(candidate, {
        eligible: false,
        conclusive: true,
        reason_code: RADAR_REASON_CODES.DUPLICATE_MARKET,
        reason: "Ya existe un mercado o borrador equivalente en Atinara.",
        confidence: 100,
        ttl_minutes: 1_440,
        evidence: [],
      }, now) as JsonRecord
      : candidate;
  });
  scored = await Promise.all(scored.map(async (candidate) => {
    const temporalContract = await createAtinaraTemporalContract(candidate, now) as JsonRecord;
    const workflowIssues = toRecordArray(candidate.workflow_issues);
    const workflowCodes = new Set(workflowIssues.map((issue) => cleanText(issue.issue_code, 100)));
    const decisionCode = cleanText(candidate.eligibility_reason_code || candidate.domain_reason_code, 100);
    if (decisionCode && !workflowCodes.has(decisionCode)) {
      workflowIssues.push(await candidateDecisionWorkflowIssue(candidate, decisionCode));
      workflowCodes.add(decisionCode);
    }
    for (const temporalCode of Array.isArray(temporalContract.anomaly_codes)
      ? temporalContract.anomaly_codes.map((value) => cleanText(value, 100))
        .filter((value) => value.startsWith("TEMPORAL_")) : []) {
      if (workflowCodes.has(temporalCode)) continue;
      workflowIssues.push(await createMarketWorkflowIssue({
        issueCode: temporalCode,detectedBy: "radar",ownerStage: "editor",
        severity: "blocking",repairability: "waiting_authoritative_source",blockingScope: "approval",
        affectedFields: ["evaluation_ends_at", "closes_at", "resolution_deadline", "timezone"],
        evidenceRefs: [{
          provider: cleanText(candidate.provider, 40),external_id: cleanText(candidate.external_id, 220),
          temporal_decision_hash: cleanText(temporalContract.decision_hash, 80),
        }],
        currentValue: {
          raw_source_dates: temporalContract.raw_source_dates,
          evaluation_ends_at: temporalContract.evaluation_ends_at,timezone: temporalContract.timezone,
        },
        proposedValue: null,confidence: Number(temporalContract.confidence) || 0,
        policyVersion: cleanText(temporalContract.policy_version, 100),retryable: true,
        nextAction: "resolve_temporal_contract",
      }) as JsonRecord);
      workflowCodes.add(temporalCode);
    }
    return { ...candidate,temporal_contract: temporalContract,workflow_issues: workflowIssues };
  }));
  const quarantinedCandidates: RadarCandidateQuarantine[] = [];
  const deferredPersistenceBatches: RadarPersistenceDeferredBatch[] = [];
  const currentCandidatesByIdentity = new Map(current.candidates.map((candidate) => [
    `${cleanText(candidate.provider, 40)}:${cleanText(candidate.external_id, 220)}`,
    candidate,
  ]));
  const preservedCandidatesByIdentity = new Map<string, JsonRecord>();
  for (const failure of candidateProviderErrors) {
    const failedProvider = cleanText(failure.provider, 40);
    for (const candidate of current.candidates.filter((item) => item.provider === failedProvider)) {
      const identity = `${cleanText(candidate.provider, 40)}:${cleanText(candidate.external_id, 220)}`;
      preservedCandidatesByIdentity.set(identity, {
        ...candidate,
        eligibility_state_preserved: true,
        provider_refresh_checked_at: now,
        provider_refresh_state: "provider_degraded",
      });
    }
  }
  const providersToPersist = new Set<string>([
    ...discoveredByProvider.keys(),
    ...requestedProviders.filter((provider) => {
      const intent = providerIntents.get(provider);
      return Boolean(intent && !intent.inProgress && (
        ["persisting", "finalizing"].includes(intent.phase)
        || (intent.phase === "staged" && intent.expectedCount !== null
          && intent.stagedCount === intent.expectedCount)
      ));
    }),
  ]);
  for (const provider of providersToPersist) {
    const providerCandidates = scored
      .filter((candidate) => candidate.provider === provider)
      .slice(0, MAX_NORMALIZED_PER_PROVIDER);
    const persistableCandidates = providerCandidates.filter((candidate) => {
      if (cleanText(candidate.eligibility_status, 40) !== "technical_hold"
        || !new Set<string>([
          RADAR_REASON_CODES.RESOLUTION_SOURCE_AUTHORITY_PENDING,
          RADAR_REASON_CODES.OFFICIAL_TERMINAL_SCAN_UNAVAILABLE,
        ]).has(cleanText(candidate.eligibility_reason_code, 100))) {
        return true;
      }
      const identity = `${cleanText(candidate.provider, 40)}:${cleanText(candidate.external_id, 220)}`;
      const lastKnownGood = currentCandidatesByIdentity.get(identity);
      if (!lastKnownGood) return true;
      preservedCandidatesByIdentity.set(identity, {
        ...lastKnownGood,
        eligibility_state_preserved: true,
        provider_refresh_checked_at: now,
        provider_refresh_state: "source_enrichment_degraded",
      });
      return false;
    });
    try {
      const intent = providerIntents.get(provider);
      if (!intent) throw new Error("RADAR_REFRESH_INTENT_REQUIRED");
      const outcome = await persistProviderResultV2(
        environment, intent, cacheKey,
        discoveredByProvider.has(provider) ? persistableCandidates : null,
      );
      quarantinedCandidates.push(...outcome.quarantined);
      if (outcome.quarantinedCount) {
        qualityNotices.push({
          ...quarantinedProviderNotice(provider, outcome.quarantinedCount),
          quarantined_count: outcome.quarantinedCount,
          quarantined: outcome.quarantined,
          persisted_count: outcome.persistedCount,
        });
      }
      providerIssues.push(...outcome.issues);
      deferredPersistenceBatches.push(...outcome.deferred);
      if (outcome.failure) {
        candidateProviderErrors.push({
          ...outcome.failure,
          quarantined_count: outcome.quarantinedCount,
          quarantined: outcome.quarantined,
          deferred_count: deferredPersistenceCandidateCount(outcome),
          deferred_batches: outcome.deferred,
          persisted_count: outcome.persistedCount,
          persistence_rpc_count: outcome.persistenceRpcCalls,
          issue: outcome.issues[0] ?? null,
          state_preserved: true,
        });
        for (const candidate of current.candidates.filter((item) => item.provider === provider)) {
          const identity = `${cleanText(candidate.provider, 40)}:${cleanText(candidate.external_id, 220)}`;
          preservedCandidatesByIdentity.set(identity, {
            ...candidate,
            eligibility_state_preserved: true,
            provider_refresh_checked_at: now,
            provider_refresh_state: outcome.inProgress ? "persistence_resumable" : "provider_degraded",
          });
        }
      }
    } catch (error) {
      const failure = persistenceFailure(error, provider);
      const intent = providerIntents.get(provider);
      const deferred = intent?.leaseToken ? toRecord(await rpc(
        environment,
        "defer_market_radar_refresh_v1",
        {
          request_id_input: intent.requestId,
          provider_input: intent.provider,
          capability_input: intent.capability,
          lease_token_input: intent.leaseToken,
          issue_code_input: cleanText(failure.code, 100) || "RADAR_PERSISTENCE_FAILED",
        },
        undefined,
        true,
      ).catch(() => null)) : null;
      const issue = toRecord(deferred?.issue) ?? await radarRefreshIssue({
        requestId: refresh.requestId, provider, capability: "candidate_feed",
        code: cleanText(failure.code, 100) || "RADAR_PERSISTENCE_FAILED",
        failureStage: "persistence",
      });
      providerIssues.push(issue);
      candidateProviderErrors.push({
        ...failure,
        status: intent ? 202 : failure.status,
        retryable: true,
        issue,
        state_preserved: true,
        refresh_request_id: intent?.requestId ?? refresh.requestId,
        next_action: "resume_persistence_intent",
      });
      for (const candidate of current.candidates.filter((item) => item.provider === provider)) {
        const identity = `${cleanText(candidate.provider, 40)}:${cleanText(candidate.external_id, 220)}`;
        preservedCandidatesByIdentity.set(identity, {
          ...candidate,
          eligibility_state_preserved: true,
          provider_refresh_checked_at: now,
          provider_refresh_state: "persistence_degraded",
        });
      }
    }
  }
  // Una respuesta marcada como fresca solo puede contener snapshots creados por
  // esta ejecución. Si un proveedor falló, su antigua caché no reaparece como
  // una propuesta recién verificada.
  const freshView = await loadRadarView(environment, authorization, filters, now);
  const freshIdentities = new Set(freshView.candidates.map((candidate) => (
    `${cleanText(candidate.provider, 40)}:${cleanText(candidate.external_id, 220)}`
  )));
  const preservedCandidates = [...preservedCandidatesByIdentity.entries()]
    .filter(([identity]) => !freshIdentities.has(identity))
    .map(([, candidate]) => candidate);
  const mergedCandidates = [...freshView.candidates, ...preservedCandidates];
  const mergedGroups = groupCandidates(mergedCandidates).sort((left, right) => {
    const leftRank = Math.min(...left.candidates.map((candidate: JsonRecord) => Number(candidate.parent_rank) || Number.MAX_SAFE_INTEGER));
    const rightRank = Math.min(...right.candidates.map((candidate: JsonRecord) => Number(candidate.parent_rank) || Number.MAX_SAFE_INTEGER));
    return leftRank - rightRank;
  });
  const mergedPage = paginateMergedRadarParents(mergedGroups,{
    parentOffset:Number(freshView.page.parent_offset)||0,
    parentLimit:Number(freshView.page.parent_limit)||MAX_VISIBLE_GROUPS,
    authoritativeParentCount:Math.max(
      Number(freshView.page.parent_count)||0,Number(current.page.parent_count)||0,
    ),
  });
  const responseGroups = mergedPage.groups as JsonRecord[];
  const responseCandidates = responseGroups.flatMap((group) => toRecordArray(group.candidates));
  const view = {
    ...freshView,
    providers: freshView.providers.filter((provider) =>
      RADAR_CANDIDATE_PROVIDERS.includes(cleanText(provider.provider, 40))),
    candidates: responseCandidates,
    groups: responseGroups,
    page: {
      ...freshView.page,
      ...mergedPage.page,
    },
  };
  const enrichmentCapabilities = freshView.providers
    .filter((provider) => RADAR_ENRICHMENT_CAPABILITIES.includes(cleanText(provider.provider, 40)))
    .map((provider) => ({
      ...provider,
      role: "source_enrichment",
      affects_catalog_health: false,
    }));
  return jsonResponse({
    ok: true,
    ...view,
    filters,
    cache_key: cacheKey,
    cached: false,
    cached_authoritative: responseCandidates.some((candidate) =>
      candidate.eligibility_state_preserved===true),
    requires_eligibility_refresh: responseCandidates.length === 0
      && scored.some((candidate) => cleanText(candidate.eligibility_reason_code, 100)
        === RADAR_REASON_CODES.RESOLUTION_SOURCE_AUTHORITY_PENDING),
    partial: candidateProviderErrors.length > 0,
    errors: candidateProviderErrors,
    provider_role_version: RADAR_PROVIDER_ROLE_VERSION,
    candidate_providers: view.providers,
    enrichment_capabilities: enrichmentCapabilities,
    provider_issues: providerIssues,
    enrichment_issues: enrichmentIssues,
    refresh_request_id: refresh.requestId,
    refresh_in_progress: candidateProviderErrors.some((error) => Number(error.status) === 202),
    deferred_verification_count: deferredVerificationCount,
    processed_verification_count: processedVerificationCount,
    failed_verification_batches: failedVerificationBatches,
    quality_notices: qualityNotices,
    quarantined_candidate_count: quarantinedCandidates.length,
    quarantined_candidates: quarantinedCandidates,
    deferred_persistence_candidate_count: deferredPersistenceBatches.reduce(
      (total, batch) => total + batch.candidate_count,
      0,
    ),
    deferred_persistence_batches: deferredPersistenceBatches,
    reconciled_provider_results: reconciledProviderResults,
    cooldown_seconds: Math.ceil(REFRESH_COOLDOWN_MS / 1000),
    cooldown_until: new Date(Date.now() + REFRESH_COOLDOWN_MS).toISOString(),
    limits: {
      max_pages: MAX_PROVIDER_PAGES,
      max_kalshi_series: MAX_KALSHI_SERIES,
      max_visible_groups: MAX_VISIBLE_GROUPS,
      max_ai_enrichment_groups: MAX_AI_ENRICHMENT_GROUPS,
      max_ai_enrichment_candidates: MAX_AI_ENRICHMENT_CANDIDATES,
      ai_enrichment_batch_size: AI_ENRICHMENT_BATCH_SIZE,
      max_rejected_outcome_reconciliations: MAX_REJECTED_OUTCOME_RECONCILIATIONS,
    },
  });
}

function candidatePreflight(candidate: JsonRecord): { ok: true } | { ok: false; error: string; message: string } {
  if (cleanText(candidate.normalizer_version, 80) !== RADAR_NORMALIZER_VERSION) return { ok: false, error: "NORMALIZER_OUTDATED", message: "La candidata debe actualizarse con el normalizador vigente." };
  if (cleanText(candidate.eligibility_policy_version, 80) !== RADAR_ELIGIBILITY_POLICY_VERSION) return { ok: false, error: "ELIGIBILITY_POLICY_OUTDATED", message: "La candidata debe revisarse con el criterio predictivo vigente. Actualiza el Radar." };
  const state = cleanText(candidate.state, 40);
  const terminalCodes = new Set([
    RADAR_REASON_CODES.OUTSIDE_GAMING_DOMAIN, RADAR_REASON_CODES.EVENT_ALREADY_RESOLVED,
    "EVENT_OUTSIDE_CONTRACT", RADAR_REASON_CODES.DUPLICATE_MARKET, "PROVIDER_NOT_OPEN",
    "PROVIDER_OPTION_INACTIVE", "PROVIDER_EVENT_NOT_FOUND", "PROVIDER_CHILD_NOT_FOUND",
  ]);
  const terminalWorkflow = toRecordArray(candidate.workflow_issues).some((issue) =>
    (cleanText(issue.blocking_scope, 40) === "terminal" || cleanText(issue.repairability, 40) === "terminal")
      && !["resolved", "superseded"].includes(cleanText(issue.status, 40) || "open"));
  if (cleanText(candidate.eligibility_status, 40) === "terminal"
    || cleanText(candidate.domain_status, 40) === "out_of_domain"
    || [candidate.domain_reason_code, candidate.eligibility_reason_code]
      .some((value) => terminalCodes.has(cleanText(value, 100)))
    || terminalWorkflow) {
    return { ok: false, error: "RADAR_CANDIDATE_TERMINAL", message: "La candidata conserva una condición terminal y no admite preparación." };
  }
  if (["prepared", "dismissed", "expired"].includes(state)) return { ok: false, error: "CANDIDATE_NOT_PREPARABLE", message: "La candidata ya no está disponible para preparar." };
  if ([candidate.domain_reason_code, candidate.eligibility_reason_code]
    .some((value) => cleanText(value, 100) === RADAR_REASON_CODES.PROVIDER_PLACEHOLDER)) {
    return { ok: false, error: "PROVIDER_PLACEHOLDER", message: "El proveedor todavía no identifica una opción real y concreta." };
  }
  if (toRecordArray(candidate.duplicate_matches).some((match) => isBlockingDuplicateMatch(match))) return { ok: false, error: "CONFIRMED_DUPLICATE", message: "La candidata coincide con un mercado o borrador existente." };
  const verificationStatus = cleanText(candidate.verification_status, 80);
  if (verificationStatus.startsWith("rejected_")) {
    const rejection = prepareRevalidationError(candidate);
    return { ok: false, error: rejection?.error ?? "RADAR_CANDIDATE_INELIGIBLE", message: rejection?.message ?? "La candidata no cumple las condiciones para preparar." };
  }
  return { ok: true };
}

function candidateRevalidationPreflight(candidate: JsonRecord): { ok: true } | { ok: false; error: string; message: string } {
  if (cleanText(candidate.normalizer_version, 80) !== RADAR_NORMALIZER_VERSION) return { ok: false, error: "NORMALIZER_OUTDATED", message: "La candidata debe actualizarse con el normalizador vigente." };
  if (cleanText(candidate.eligibility_policy_version, 80) !== RADAR_ELIGIBILITY_POLICY_VERSION) return { ok: false, error: "ELIGIBILITY_POLICY_OUTDATED", message: "La candidata debe revisarse con el criterio predictivo vigente." };
  const state = cleanText(candidate.state, 40);
  const selfDuplicateRepair = state === "rejected"
    && cleanText(candidate.verification_status, 80) === "rejected_duplicate"
    && Boolean(candidate.prepared_draft_id)
    && !toRecordArray(candidate.duplicate_matches).some((match) => isBlockingDuplicateMatch(match));
  const repairablePrepared = state === "prepared"
    && Boolean(candidate.prepared_draft_id)
    && cleanText(candidate.eligibility_status, 40) !== "terminal"
    && !toRecordArray(candidate.duplicate_matches).some((match) => isBlockingDuplicateMatch(match));
  if (!["available", "needs_review", "prepared"].includes(state) && !selfDuplicateRepair) return { ok: false, error: "CANDIDATE_NOT_REVALIDATABLE", message: "La candidata ya no admite una comprobación de elegibilidad." };
  const verificationStatus = cleanText(candidate.verification_status, 80);
  if (verificationStatus.startsWith("rejected_") && !selfDuplicateRepair && !repairablePrepared) {
    const rejection = prepareRevalidationError(candidate);
    return { ok: false, error: rejection?.error ?? "RADAR_CANDIDATE_INELIGIBLE", message: rejection?.message ?? "La candidata ya no es elegible." };
  }
  return { ok: true };
}

function candidateReady(candidate: JsonRecord): { ok: true } | { ok: false; error: string; message: string } {
  const preflight = candidatePreflight(candidate);
  if (!preflight.ok) return preflight;
  if (cleanText(candidate.verification_status, 80) !== "verified_open"
    || cleanText(candidate.eligibility_status, 40) !== "eligible"
    || cleanText(candidate.eligibility_policy_version, 100) !== RADAR_ELIGIBILITY_POLICY_VERSION
    || !candidate.current_eligibility_check_id) {
    return { ok: false, error: "ELIGIBILITY_REQUIRED", message: "La candidata no conserva una decisión de elegibilidad vigente." };
  }
  if (!isAdaptedIdeaComplete(candidate)) return { ok: false, error: "RESOLUTION_SOURCE_REQUIRED", message: "La candidata no conserva una pregunta, criterios y fuente de resolución verificables." };
  const checkedAt = Date.parse(cleanText(candidate.eligibility_checked_at, 100));
  const expiresAt = Date.parse(cleanText(candidate.eligibility_expires_at, 100));
  if (!Number.isFinite(checkedAt) || checkedAt > Date.now() + 60_000
    || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    return { ok: false, error: "ELIGIBILITY_EXPIRED", message: "La elegibilidad ha caducado. Actualiza el Radar." };
  }
  if (cleanText(candidate.state, 40) !== "available") return { ok: false, error: "CANDIDATE_NOT_PREPARABLE", message: "La candidata ya no está disponible para preparar." };
  return { ok: true };
}

function refreshCandidateCacheLease(candidate: JsonRecord, checkedAt: string): JsonRecord {
  return {
    ...candidate,
    fetched_at: checkedAt,
    cache_expires_at: new Date(Date.parse(checkedAt) + (20 * 60_000)).toISOString(),
  };
}

async function revalidateCurrentCandidateDomain(
  environment: Environment,
  candidate: JsonRecord,
): Promise<JsonRecord> {
  const domainFingerprint = await radarDomainFingerprintV1(candidate);
  const scopedCandidate: JsonRecord = { ...candidate, domain_review_fingerprint: domainFingerprint };
  let reviews: JsonRecord[];
  try {
    reviews = toRecordArray(await rpc(environment, "get_market_radar_domain_reviews_v1", {
      fingerprints_input: [{
        provider: cleanText(scopedCandidate.provider, 40),
        external_id: cleanText(scopedCandidate.external_id, 220),
        domain_fingerprint: domainFingerprint,
      }],
    }, undefined, true));
  } catch {
    // Una caída del ledger humano nunca equivale a ausencia de atestación.
    throw new Error("ELIGIBILITY_SCAN_UNAVAILABLE");
  }
  const exactReview = reviews.find((review) =>
    cleanText(review.provider, 40) === cleanText(scopedCandidate.provider, 40)
      && cleanText(review.external_id, 220) === cleanText(scopedCandidate.external_id, 220)
      && cleanText(review.domain_fingerprint, 80) === domainFingerprint);
  return projectRadarDomainReview(scopedCandidate, exactReview);
}

async function revalidatePolymarketCandidate(environment: Environment, candidate: JsonRecord): Promise<JsonRecord | null> {
  const eventSlug = cleanText(candidate.external_event_slug, 400);
  const marketId = cleanText(candidate.external_market_id, 220);
  if (!eventSlug || !marketId) return null;
  const event = toRecord(await fetchJson(
    new URL(`${POLYMARKET_GAMMA_ROOT}/events/slug/${encodeURIComponent(eventSlug)}`),
    {},
    PROVIDER_TIMEOUT_MS,
    { execution: environment.execution },
  ));
  const markets = toRecordArray(event?.markets);
  if (!event || !markets.length || markets.length > MAX_CANONICAL_EVENT_CHILDREN) return null;
  const canonicalEvent = { ...event, markets, canonical_url_verified: true };
  const adapted = await attachCanonicalFactContext(
    adaptPolymarketResponse({ events: [canonicalEvent] }, { now: new Date().toISOString(), cacheMinutes: 20, canonicalUrlVerified: true }) as JsonRecord[],
    [canonicalEvent],
    "polymarket",
  );
  const current = adapted.find((item) => cleanText(item.external_market_id, 220) === marketId);
  return current ? {
    ...candidate,
    ...current,
    id: candidate.id,
    state: candidate.state,
    prepared_draft_id: candidate.prepared_draft_id,
    preparation_revision: candidate.preparation_revision,
  } : null;
}

async function revalidateKalshiCandidate(environment: Environment, candidate: JsonRecord): Promise<JsonRecord | null> {
  const eventTicker = cleanText(candidate.external_event_id, 220);
  const marketTicker = cleanText(candidate.external_market_id, 220);
  if (!eventTicker || !marketTicker) return null;
  const url = new URL(`${KALSHI_API_ROOT}/events/${encodeURIComponent(eventTicker)}`);
  url.searchParams.set("with_nested_markets", "true");
  const payload = toRecord(await fetchJson(url, {}, PROVIDER_TIMEOUT_MS, { execution: environment.execution })) ?? {};
  const event = toRecord(payload.event) ?? payload;
  const markets = toRecordArray(event.markets);
  if (cleanText(event.event_ticker ?? event.ticker, 220) !== eventTicker
    || !markets.length || markets.length > MAX_CANONICAL_EVENT_CHILDREN) return null;
  const externalEventUrl = safePublicUrl(candidate.external_event_url, ["kalshi.com"]);
  const canonicalEvent = {
    ...event,
    external_event_url: externalEventUrl,
    canonical_url_verified: Boolean(externalEventUrl),
    markets: markets.map((market) => ({
      ...market,
      external_event_url: externalEventUrl,
      external_market_url: externalEventUrl,
      canonical_url_verified: Boolean(externalEventUrl),
    })),
  };
  const adapted = await attachCanonicalFactContext(
    adaptKalshiResponse({ events: [canonicalEvent] }, { now: new Date().toISOString(), cacheMinutes: 20 }) as JsonRecord[],
    [canonicalEvent],
    "kalshi",
  );
  const current = adapted.find((item) => cleanText(item.external_market_id, 220) === marketTicker);
  return current ? {
    ...candidate,
    ...current,
    id: candidate.id,
    state: candidate.state,
    prepared_draft_id: candidate.prepared_draft_id,
    preparation_revision: candidate.preparation_revision,
  } : null;
}

async function revalidateCandidateForPreparation(
  environment: Environment,
  authorization: string,
  candidate: JsonRecord,
  purpose: "prepare" | "revalidate" = "prepare",
  attemptId: string = crypto.randomUUID(),
): Promise<{ candidate: JsonRecord; checkedAt: string; reservation: JsonRecord }> {
  let providerCandidate: JsonRecord | null = null;
  try {
    providerCandidate = candidate.provider === "polymarket"
      ? await revalidatePolymarketCandidate(environment, candidate)
      : candidate.provider === "kalshi" ? await revalidateKalshiCandidate(environment, candidate) : null;
  } catch {
    // Un fallo técnico nunca cambia la última decisión autoritativa.
    throw new Error("PROVIDER_UNAVAILABLE");
  }
  const checkedAt = new Date().toISOString();
  const currentProviderCandidate = providerCandidate
    ? await revalidateCurrentCandidateDomain(environment, providerCandidate) : null;
  let eligibility = applyDeterministicRadarEligibility(
    currentProviderCandidate ?? candidate,
    currentProviderCandidate
      ? evaluateProviderEligibility(currentProviderCandidate, checkedAt)
      : {
        eligible: false,
        conclusive: true,
        reason_code: RADAR_REASON_CODES.PROVIDER_CHILD_NOT_FOUND,
        reason: "La opción ya no pertenece al evento canónico del proveedor.",
        confidence: 100,
        ttl_minutes: 360,
        evidence: [],
      },
    checkedAt,
  ) as JsonRecord;

  if (eligibility.eligibility_status === "eligible") {
    let authoritativeDomains: Set<string>;
    try {
      authoritativeDomains = await loadAuthoritativeSourceDomains(environment);
      if (!authoritativeDomains.size) throw new Error("SOURCE_AUTHORITY_REGISTRY_EMPTY");
    } catch {
      throw new Error("ELIGIBILITY_SCAN_UNAVAILABLE");
    }
    let evidence: JsonRecord[] = [];
    let sourceAgentExecution: JsonRecord | null = null;
    try {
      const research = await researchGroupsWithTavily(
        environment,
        environment.tavilyKey,
        [eligibility],
        authoritativeDomains,
      );
      evidence = research.evidenceByGroup.get(cleanText(eligibility.event_group_key, 240)) ?? [];
      sourceAgentExecution = research.agentExecution;
      if (research.incompleteGroupKeys.includes(cleanText(eligibility.event_group_key, 240))) {
        throw research.enrichmentError ?? new Error("OFFICIAL_SOURCE_FETCH_INCOMPLETE");
      }
    } catch {
      // La exploración puede conservar el último estado válido durante una
      // degradación. Preparar, confirmar o publicar falla cerrado cuando no se
      // pudo descartar de forma exacta un resultado oficial ya conocido.
      throw new Error("ELIGIBILITY_SCAN_UNAVAILABLE");
    }
    const subjectTokens = sourceTokens(candidateResolutionSubject(eligibility))
      .filter((token) => !SOURCE_GENERIC_ANCHORS.has(token));
    const exactEvidence = evidence.filter((item) => {
      const materialTokens = new Set(sourceTokens(`${item.title ?? ""} ${item.supports ?? ""}`));
      return isResolutionAuthorityEvidence(item)
        || (subjectTokens.length >= 1 && subjectTokens.every((token) => materialTokens.has(token)));
    });
    const coverResolution = detectOfficialCoverEventResolution([eligibility], exactEvidence);
    const coverSelectionHold = detectOfficialCoverSelectionHold([eligibility], exactEvidence);
    const terminalEvidence = exactEvidence.filter((item) => evidenceHasPotentialTerminalClaim(item, eligibility, checkedAt));
    if (coverResolution || terminalEvidence.length) {
      eligibility = applyDeterministicRadarEligibility({ ...eligibility, source_agent_execution: sourceAgentExecution }, {
        eligible: false,
        conclusive: true,
        reason_code: RADAR_REASON_CODES.EVENT_ALREADY_RESOLVED,
        reason: "Una fuente oficial exacta para esta opción ya publicó el resultado.",
        confidence: 100,
        ttl_minutes: 1_440,
        evidence: coverResolution?.evidence ?? terminalEvidence,
      }, checkedAt) as JsonRecord;
    } else if (coverSelectionHold) {
      eligibility = applyDeterministicRadarEligibility({ ...eligibility, source_agent_execution: sourceAgentExecution }, {
        eligible: false,
        conclusive: false,
        reason_code: RADAR_REASON_CODES.OFFICIAL_SELECTION_RECHECK_REQUIRED,
        reason: "Una fuente oficial apunta a una selección ya publicada, pero la comprobación automática debe completar su alcance. El evento permanece oculto y se reintentará.",
        confidence: 0,
        ttl_minutes: 5,
        evidence: coverSelectionHold.evidence ?? [],
      }, checkedAt) as JsonRecord;
    } else {
      const resolutionSourceUrl = selectVerifiedResolutionUrl(eligibility, exactEvidence, authoritativeDomains);
      if (!resolutionSourceUrl) {
        eligibility = applyDeterministicRadarEligibility({ ...eligibility, source_agent_execution: sourceAgentExecution }, {
          eligible: false,
          conclusive: false,
          reason_code: RADAR_REASON_CODES.RESOLUTION_SOURCE_AUTHORITY_PENDING,
          reason: "Atinara no encontró todavía una fuente resolutiva oficial y exacta para esta opción. La volverá a comprobar automáticamente.",
          confidence: 0,
          ttl_minutes: 5,
          evidence: [],
        }, checkedAt) as JsonRecord;
      } else {
        const sourceEvidence = exactEvidence
          .filter((item) => safePublicUrl(item.url) === resolutionSourceUrl
            && (item.evidence_basis !== "provider_resolution_contract"
              || cleanText(item.candidate_external_id, 220) === cleanText(eligibility.external_id, 220)))
          .slice(0, 6);
        eligibility = normalizeRadarCandidatePresentation({
          ...eligibility,
          ...(sourceAgentExecution ? { source_agent_execution: sourceAgentExecution } : {}),
          atinara_resolution_source_url: resolutionSourceUrl,
          resolution_source_evidence: sourceEvidence,
          eligibility_evidence: sourceEvidence,
          verification_evidence: sourceEvidence,
        }) as JsonRecord;
      }
    }
  }

  const expectedRevision = Number(candidate.preparation_revision);
  const eligibilityEvidence = toRecordArray(eligibility.eligibility_evidence ?? eligibility.verification_evidence).slice(0, 12);
  const eligibilityCheck = {
    attempt_id: attemptId,
    provider: cleanText(eligibility.provider, 40),
    external_id: cleanText(eligibility.external_id, 220),
    event_group_key: cleanText(eligibility.event_group_key, 240) || null,
    policy_version: RADAR_ELIGIBILITY_POLICY_VERSION,
    status: cleanText(eligibility.eligibility_status, 40),
    reason_code: cleanText(eligibility.eligibility_reason_code, 100) || null,
    reason: cleanText(eligibility.eligibility_reason, 1_000) || null,
    evidence: eligibilityEvidence,
    checked_at: checkedAt,
    expires_at: cleanText(eligibility.eligibility_expires_at, 100),
    decision_hash: await sha256Hex({
      provider: eligibility.provider,
      external_id: eligibility.external_id,
      status: eligibility.eligibility_status,
      reason_code: eligibility.eligibility_reason_code,
      evidence: eligibilityEvidence,
      checked_at: checkedAt,
    }),
  };
  const applied = toRecord(await rpc(environment, "apply_market_radar_prepare_eligibility_v1", {
    candidate_id_input: cleanText(candidate.id, 80),
    expected_preparation_revision_input: Number.isSafeInteger(expectedRevision) ? expectedRevision : null,
    normalizer_version_input: RADAR_NORMALIZER_VERSION,
    eligibility_checked_at_input: checkedAt,
    eligibility_input: eligibility,
    eligibility_check_input: eligibilityCheck,
    reserve_for_prepare_input: purpose === "prepare",
  }, undefined, true));
  if (!applied?.ok) {
    const blockedCandidate = toRecord(applied?.candidate);
    const code = cleanText(applied?.error, 100) || "PREPARE_REJECTED";
    if (blockedCandidate) throw new RadarRevalidationOutcomeError(code, blockedCandidate);
    throw new Error(code);
  }
  const authoritativeCandidate = toRecord(applied.candidate);
  if (!authoritativeCandidate) throw new Error("CANDIDATE_NOT_FOUND");
  if (purpose === "prepare") {
    const readiness = candidateReady(authoritativeCandidate);
    if (!readiness.ok) throw new Error(readiness.error);
  } else if (cleanText(authoritativeCandidate.eligibility_status, 40) !== "eligible") {
    const outcome = prepareRevalidationError(authoritativeCandidate);
    throw new RadarRevalidationOutcomeError(outcome?.error ?? "RADAR_ELIGIBILITY_REQUIRED", authoritativeCandidate);
  }
  return {
    candidate: authoritativeCandidate,
    checkedAt,
    reservation: toRecord(applied.reservation) ?? {},
  };
}

function prepareRevalidationError(candidate: JsonRecord): { error: string; message: string } | null {
  if (cleanText(candidate.eligibility_reason_code, 100) === RADAR_REASON_CODES.RESOLUTION_SOURCE_AUTHORITY_PENDING) {
    return {
      error: RADAR_REASON_CODES.RESOLUTION_SOURCE_AUTHORITY_PENDING,
      message: "Atinara todavía no encontró una fuente resolutiva oficial y exacta. La candidata sigue privada y puede volver a comprobarse.",
    };
  }
  const status = cleanText(candidate.verification_status, 80);
  if (status === "verified_open") return null;
  if (status === "rejected_resolved") return { error: "RADAR_CANDIDATE_RESOLVED", message: "El resultado ya es público y la candidata no puede prepararse." };
  if (status === "rejected_unannounced") return { error: "RADAR_CANDIDATE_UNANNOUNCED", message: "La candidata depende de un producto no anunciado para un resultado posterior, como un premio o una reseña." };
  if (["rejected_ineligible", "rejected_incoherent"].includes(status)) return { error: "RADAR_CANDIDATE_INELIGIBLE", message: "La candidata no es compatible con el contrato o ya no está disponible en el proveedor." };
  if (status === "rejected_invalid_source") return { error: "RADAR_CANONICAL_URL_INVALID", message: "No se pudo validar la fuente o el enlace canónico de la candidata." };
  if (status === "rejected_duplicate") return { error: "RADAR_CONFIRMED_DUPLICATE", message: "La candidata coincide con un mercado o borrador existente." };
  return { error: "RADAR_ELIGIBILITY_REQUIRED", message: "La comprobación de elegibilidad no ha concluido. La candidata permanece bloqueada." };
}

async function recordTechnicalEligibilityAttempt(
  environment: Environment,
  candidate: JsonRecord,
  purpose: "prepare" | "revalidate",
  operationId: string,
  error: unknown,
): Promise<void> {
  if (error instanceof RadarRevalidationOutcomeError) return;
  const rawCode = error instanceof Error ? cleanText(error.message, 100) : "RADAR_ELIGIBILITY_TECHNICAL_FAILURE";
  const errorCode = /^[A-Z][A-Z0-9_]{2,100}$/.test(rawCode)
    ? rawCode
    : "RADAR_ELIGIBILITY_TECHNICAL_FAILURE";
  const phase = errorCode === "PROVIDER_UNAVAILABLE"
    ? "provider_revalidation"
    : errorCode === "ELIGIBILITY_SCAN_UNAVAILABLE"
      ? "official_terminal_scan"
      : "eligibility_persistence";
  const revision = Number(candidate.preparation_revision);
  if (!Number.isSafeInteger(revision) || revision < 1) return;
  try {
    await rpc(environment, "record_market_radar_eligibility_attempt_v1", {
      candidate_id_input: cleanText(candidate.id, 80),
      expected_preparation_revision_input: revision,
      purpose_input: purpose,
      attempt_id_input: operationId,
      phase_input: phase,
      error_code_input: errorCode,
      retryable_input: ["PROVIDER_UNAVAILABLE", "ELIGIBILITY_SCAN_UNAVAILABLE"].includes(errorCode),
    }, undefined, true);
  } catch (auditError) {
    console.warn("Radar eligibility attempt audit unavailable", auditError instanceof Error ? auditError.message : "AUDIT_UNAVAILABLE");
  }
}

function eligibilityFailureResponse(error: unknown, operationId: string): Response {
  const code = error instanceof Error ? cleanText(error.message, 100) : "RADAR_ELIGIBILITY_REQUIRED";
  const errors: Record<string, { status: number; message: string }> = {
    PROVIDER_NOT_OPEN: { status: 409, message: "El mercado de origen ya no está abierto o no conserva la opción verificada." },
    PROVIDER_UNAVAILABLE: { status: 503, message: "El proveedor no respondió. Se conserva el último estado y puedes reintentar sin duplicar cambios." },
    ELIGIBILITY_SCAN_UNAVAILABLE: { status: 503, message: "No se pudo descartar de forma segura un resultado oficial ya conocido. El estado anterior se conserva y puedes reintentar." },
    RESOLUTION_SOURCE_AUTHORITY_PENDING: { status: 409, message: "Atinara todavía no encontró una fuente resolutiva oficial y exacta. La candidata sigue privada y puede volver a comprobarse." },
    ELIGIBILITY_REQUIRED: { status: 409, message: "La decisión de elegibilidad actual no permite continuar con esta candidata." },
    RADAR_ELIGIBILITY_REQUIRED: { status: 409, message: "La decisión de elegibilidad actual no permite continuar con esta candidata." },
    RADAR_ELIGIBILITY_EXPIRED: { status: 409, message: "La elegibilidad ha caducado y debe actualizarse antes de continuar." },
    RADAR_CANDIDATE_RESOLVED: { status: 409, message: "El resultado ya es público y la candidata permanece bloqueada." },
    RADAR_CANDIDATE_UNANNOUNCED: { status: 409, message: "La candidata depende de un producto no anunciado para un resultado posterior." },
    RADAR_CANDIDATE_INELIGIBLE: { status: 409, message: "La candidata no es compatible con el contrato o ya no está disponible." },
    RADAR_CANONICAL_URL_INVALID: { status: 409, message: "No se pudo validar la fuente o el enlace canónico de la candidata." },
    RADAR_CONFIRMED_DUPLICATE: { status: 409, message: "La candidata coincide con un mercado o borrador existente." },
    ELIGIBILITY_EXPIRED: { status: 409, message: "La elegibilidad ha caducado. Actualiza el Radar y vuelve a intentarlo." },
    RESOLUTION_SOURCE_REQUIRED: { status: 409, message: "Faltan la pregunta, los criterios o una fuente de resolución verificable." },
    PREPARATION_REVISION_MISMATCH: { status: 409, message: "La candidata cambió durante la comprobación. Recarga su versión actual." },
    CANDIDATE_NOT_REVALIDATABLE: { status: 409, message: "La candidata ya no admite una comprobación de elegibilidad." },
    CONFIRMED_DUPLICATE: { status: 409, message: "La candidata coincide con un mercado o borrador existente." },
  };
  if (error instanceof RadarRevalidationOutcomeError) {
    const failure = errors[error.code] ?? {
      status: 409,
      message: "La decisión de elegibilidad quedó registrada y la candidata permanece bloqueada.",
    };
    return jsonResponse({
      error: error.code,
      message: failure.message,
      attempt_id: operationId,
      phase: "eligibility_check",
      retryable: error.code === RADAR_REASON_CODES.RESOLUTION_SOURCE_AUTHORITY_PENDING,
      candidate: error.candidate,
      eligibility_check_id: error.candidate.current_eligibility_check_id ?? null,
      preparation_revision: error.candidate.preparation_revision ?? null,
      authoritative_state_updated: true,
      state_preserved: true,
    }, failure.status);
  }
  const failure = errors[code] ?? {
    status: 503,
    message: "No se pudo completar la comprobación de elegibilidad. El estado anterior se conserva.",
  };
  return jsonResponse({
    error: code,
    message: failure.message,
    attempt_id: operationId,
    phase: "eligibility_check",
    retryable: code === RADAR_REASON_CODES.RESOLUTION_SOURCE_AUTHORITY_PENDING
      || failure.status === 429 || failure.status >= 500,
    state_preserved: true,
  }, failure.status);
}

async function handleAction(
  environment: Environment,
  authorization: string,
  adminId: string,
  body: JsonRecord,
) {
  const requestedAction = cleanText(body.action, 40);
  // Compatibilidad de despliegue: Pages puede conservar brevemente el cliente
  // anterior. El alias no restaura la puerta factual ni persiste sus campos;
  // ejecuta exactamente la comprobación de elegibilidad v5.
  const action = requestedAction === "revalidate" ? "check-eligibility" : requestedAction;
  if (action === "discover") return runDiscovery(environment, authorization, body);
  if (action === "provider-status") {
    const providers = await rpc(environment, "get_market_radar_provider_status", {}, authorization);
    return jsonResponse({ ok: true, providers: toRecordArray(providers) });
  }
  const candidateId = cleanText(body.candidate_id, 80);
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(candidateId)) {
        return jsonResponse({ error: "INVALID_CANDIDATE", message: "La candidata solicitada no es válida." }, 400);
      }
      if (action === "review-domain") {
        const expectedRevision = Number(body.expected_revision);
        const expectedFingerprint = cleanText(body.expected_fingerprint, 80).toLowerCase();
        const decision = cleanText(body.decision, 40);
        const rationale = cleanText(body.rationale, 1_000);
        const requestedOperationId = cleanText(body.operation_id, 80);
        const operationId = validUuid(requestedOperationId) ? requestedOperationId : crypto.randomUUID();
        const requestedSupersedesId = cleanText(body.supersedes_request_id, 80);
        const supersedesRequestId = requestedSupersedesId ? requestedSupersedesId : null;
        const evidenceRefs = toRecordArray(body.evidence_refs).slice(0, 8).map((item) => ({
          url: safePublicUrl(item.url),
          role: cleanText(item.role, 80) || "DOMAIN_REVIEW",
        })).filter((item) => item.url);
        if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0
          || !/^[a-f0-9]{64}$/.test(expectedFingerprint)
          || !["in_domain", "out_of_domain"].includes(decision)
          || rationale.length < 20
          || (supersedesRequestId !== null && !validUuid(supersedesRequestId))
          || (decision === "out_of_domain" && evidenceRefs.length === 0)) {
          return jsonResponse({
            error: "RADAR_DOMAIN_REVIEW_INVALID",
            message: "La decisión de dominio necesita versión, huella y una justificación suficiente.",
          }, 400);
        }
        const result = await rpc(environment, "review_market_radar_domain_v1", {
          candidate_id_input: candidateId,
          expected_revision_input: expectedRevision,
          expected_fingerprint_input: expectedFingerprint,
          decision_input: decision,
          rationale_input: rationale,
          evidence_refs_input: evidenceRefs,
          request_id_input: operationId,
          supersedes_request_id_input: supersedesRequestId,
        }, authorization);
        return jsonResponse({
          ok: true,
          status: "domain_review_recorded",
          review: toRecord(result) ?? {},
          next_action: "refresh_draft_eligibility",
          publishes: false,
        });
      }
      if (action === "details") {
    const candidate = toRecord(await rpc(environment, "get_market_radar_candidate", { candidate_id_input: candidateId }, authorization));
    if (!candidate) return jsonResponse({ error: "CANDIDATE_NOT_FOUND", message: "No se encontró la candidata." }, 404);
    let detailedCandidate = candidate;
    try {
      const authoritativeDomains = await loadAuthoritativeSourceDomains(environment);
      const research = await researchGroupsWithTavily(environment, environment.tavilyKey, [candidate], authoritativeDomains);
      const evidence = research.evidenceByGroup.get(cleanText(candidate.event_group_key, 240)) ?? [];
      const sourceUrl = selectVerifiedResolutionUrl(candidate, evidence, authoritativeDomains);
      const sourceEvidence = sourceUrl
        ? evidence.filter((item) => safePublicUrl(item.url) === sourceUrl
          && (item.evidence_basis !== "provider_resolution_contract"
            || cleanText(item.candidate_external_id, 220) === cleanText(candidate.external_id, 220))).slice(0, 6)
        : [];
      detailedCandidate = {
        ...candidate,
        source_agent_execution: research.agentExecution,
        atinara_resolution_source_url: sourceUrl,
        resolution_source_evidence: sourceEvidence,
      };
    } catch {
      // El detalle sigue siendo una lectura válida con el último estado guardado.
    }
    return jsonResponse({ ok: true, candidate: detailedCandidate });
  }
  if (action === "recover-draft-eligibility") {
    const draftId = cleanText(body.draft_id, 80);
    const draftVersion = Number(body.draft_version);
    const draftFingerprint = cleanText(body.draft_fingerprint, 80).toLowerCase();
    const requestedOperationId = cleanText(body.operation_id, 80);
    const operationId = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestedOperationId)
      ? requestedOperationId : crypto.randomUUID();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(draftId)
      || !Number.isSafeInteger(draftVersion) || draftVersion<1
      || !/^[a-f0-9]{64}$/.test(draftFingerprint)) {
      return jsonResponse({ error: "INVALID_DRAFT_ELIGIBILITY_SCOPE", message: "La versión privada no es válida." }, 400);
    }
    const replay = toRecord(await rpc(
      environment,
      "get_market_draft_eligibility_recovery_replay_v1",
      {
        attempt_id_input:operationId,draft_id_input:draftId,
        expected_version_input:draftVersion,expected_fingerprint_input:draftFingerprint,
        candidate_id_input:candidateId,
      },undefined,true,
    ));
    if (replay?.replayed===true) {
      return jsonResponse({
        ...replay,message:"La recuperación ya estaba registrada; no se repitió ninguna consulta externa.",
      });
    }
    const candidate = toRecord(await rpc(
      environment,
      "get_market_radar_candidate_for_draft_revalidation_v2",
      {
        candidate_id_input: candidateId,
        draft_id_input: draftId,
        expected_version_input: draftVersion,
        expected_fingerprint_input: draftFingerprint,
      },
      undefined,
      true,
    ));
    if (!candidate) return jsonResponse({ error: "CANDIDATE_NOT_FOUND", message: "No se encontró la candidata." }, 404);
    const preflight = candidateRevalidationPreflight(candidate);
    if (!preflight.ok) return jsonResponse({ error: preflight.error, message: preflight.message }, 409);
    try {
      const result = await revalidateCandidateForPreparation(
        environment,authorization,candidate,"revalidate",operationId,
      );
      const recovery = toRecord(await rpc(environment, "recover_market_draft_radar_eligibility_v1", {
        draft_id_input: draftId,expected_version_input: draftVersion,
        expected_fingerprint_input: draftFingerprint,candidate_id_input: candidateId,
        actor_id_input: adminId,attempt_id_input: operationId,
      }, undefined, true));
      return jsonResponse({
        ok: true,status: "eligibility_recovered",candidate: result.candidate,
        recovery,owner_stage: "validator",next_action: "request_market_validation",
        state_preserved: true,
      });
    } catch (error) {
      await recordTechnicalEligibilityAttempt(environment,candidate,"revalidate",operationId,error);
      return eligibilityFailureResponse(error,operationId);
    }
  }
  if (action === "check-eligibility") {
    const draftId = cleanText(body.draft_id, 80);
    const draftVersion = Number(body.draft_version);
    const draftFingerprint = cleanText(body.draft_fingerprint, 80).toLowerCase();
    const draftScoped = Boolean(draftId || body.draft_version !== undefined || draftFingerprint);
    if (draftScoped && (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(draftId)
      || !Number.isSafeInteger(draftVersion) || draftVersion < 1
      || !/^[0-9a-f]{64}$/.test(draftFingerprint)
    )) {
      return jsonResponse({
        error: "INVALID_DRAFT_ELIGIBILITY_SCOPE",
        message: "La versión privada que se desea comprobar no es válida. Recarga el borrador antes de reintentar.",
      }, 400);
    }
    const candidate = toRecord(await rpc(
      environment,
      draftScoped
        ? "get_market_radar_candidate_for_draft_revalidation_v2"
        : "get_market_radar_candidate_for_revalidation_v1",
      draftScoped ? {
        candidate_id_input: candidateId,
        draft_id_input: draftId,
        expected_version_input: draftVersion,
        expected_fingerprint_input: draftFingerprint,
      } : { candidate_id_input: candidateId },
      undefined,
      true,
    ));
    if (!candidate) return jsonResponse({ error: "CANDIDATE_NOT_FOUND", message: "No se encontró la candidata." }, 404);
    const preflight = candidateRevalidationPreflight(candidate);
    if (!preflight.ok) return jsonResponse({ error: preflight.error, message: preflight.message }, 409);
    const requestedOperationId = cleanText(body.operation_id, 80);
    const operationId = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestedOperationId)
      ? requestedOperationId
      : crypto.randomUUID();
    try {
      const result = await revalidateCandidateForPreparation(
        environment,
        authorization,
        candidate,
        "revalidate",
        operationId,
      );
      const compatibilityCandidate = requestedAction === "revalidate"
        ? {
          ...result.candidate,
          fact_check_purpose: "revalidate",
          fact_status: "unresolved",
          fact_checked_at: result.candidate.eligibility_checked_at,
          fact_check_expires_at: result.candidate.eligibility_expires_at,
          current_fact_check_id: result.candidate.current_eligibility_check_id,
        }
        : result.candidate;
      const eligibilityBinding = draftScoped
        ? toRecord(await rpc(environment, "bind_market_radar_draft_eligibility_v2", {
          candidate_id_input: candidateId,
          draft_id_input: draftId,
          expected_version_input: draftVersion,
          expected_fingerprint_input: draftFingerprint,
          expected_preparation_revision_input: Number(result.candidate.preparation_revision),
          eligibility_check_id_input: Number(result.candidate.current_eligibility_check_id),
          actor_id_input: adminId,
          attempt_id_input: operationId,
        }, undefined, true))
        : null;
      return jsonResponse({
        ok: true,
        candidate: compatibilityCandidate,
        eligibility_check_id: result.candidate.current_eligibility_check_id,
        eligibility_checked_at: result.candidate.eligibility_checked_at,
        eligibility_expires_at: result.candidate.eligibility_expires_at,
        revalidated: true,
        prepared: false,
        ...(eligibilityBinding ? { draft_eligibility_binding: eligibilityBinding } : {}),
        ...(requestedAction === "revalidate" ? {
          legacy_fact_attestation: {
            ok: true,
            compatibility_only: true,
            eligibility_check_id: result.candidate.current_eligibility_check_id,
          },
        } : {}),
      });
    } catch (error) {
      await recordTechnicalEligibilityAttempt(environment, candidate, "revalidate", operationId, error);
      return eligibilityFailureResponse(error, operationId);
    }
  }
  if (action === "prepare") {
    const candidate = toRecord(await rpc(environment, "get_market_radar_candidate_for_revalidation_v1", { candidate_id_input: candidateId }, undefined, true));
    if (!candidate) return jsonResponse({ error: "CANDIDATE_NOT_FOUND", message: "No se encontró la candidata." }, 404);
    const preflight = candidatePreflight(candidate);
    if (!preflight.ok) return jsonResponse({ error: preflight.error, message: preflight.message }, 409);
    let result: { candidate: JsonRecord; checkedAt: string; reservation: JsonRecord };
    const requestedOperationId = cleanText(body.operation_id, 80);
    const operationId = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestedOperationId)
      ? requestedOperationId
      : crypto.randomUUID();
    try {
      result = await revalidateCandidateForPreparation(
        environment,
        authorization,
        candidate,
        "prepare",
        operationId,
      );
    } catch (error) {
      await recordTechnicalEligibilityAttempt(environment, candidate, "prepare", operationId, error);
      return eligibilityFailureResponse(error, operationId);
    }
    return jsonResponse({
      ok: true,
      candidate: result.candidate,
      preparation_revision: result.candidate.preparation_revision,
      eligibility_check_id: result.candidate.current_eligibility_check_id,
      reservation: result.reservation,
      prefill: buildDraftPrefill(result.candidate),
      revalidated: true,
      prepared: true,
    });
  }
  if (action === "dismiss") {
    const result = await rpc(environment, "dismiss_market_radar_candidate", { candidate_id_input: candidateId }, authorization);
    return jsonResponse({ ok: true, result: isRecord(result) ? result as JsonRecord : {} });
  }
  return jsonResponse({ error: "INVALID_ACTION", message: "La acción del Radar no es válida." }, 400);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "METHOD_NOT_ALLOWED", message: "Usa una petición POST." }, 405);
  if (Number(req.headers.get("content-length") ?? 0) > MAX_REQUEST_BYTES) return jsonResponse({ error: "REQUEST_TOO_LARGE", message: "La petición es demasiado grande." }, 413);
  const authorization = req.headers.get("authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) return jsonResponse({ error: "AUTH_REQUIRED", message: "Inicia sesión para usar el Radar." }, 401);
  const operation = createAbsoluteExecutionContext({ durationMs: OPERATION_TIMEOUT_MS, parentSignal: req.signal });
  const environment = getEnvironment(operation.context);
  if (!environment) {
    operation.cleanup();
    return jsonResponse({ error: "SERVER_NOT_CONFIGURED", message: "El Radar no está configurado en el servidor." }, 503);
  }
  try {
    const auth = await authenticateAdmin(environment, authorization);
    if (auth instanceof Response) return auth;
    const rawBody = await req.text();
    if (new TextEncoder().encode(rawBody).byteLength > MAX_REQUEST_BYTES) return jsonResponse({ error: "REQUEST_TOO_LARGE", message: "La petición es demasiado grande." }, 413);
    const parsedBody = toRecord(JSON.parse(rawBody));
    if (!parsedBody) return jsonResponse({ error: "INVALID_REQUEST", message: "La petición no es válida." }, 400);
    return await handleAction(environment, authorization, auth.adminId, parsedBody);
  } catch (error) {
    console.error("Market Radar request failed", error instanceof Error ? error.name : "UnknownError");
    return jsonResponse({ error: "RADAR_FAILED", message: "No se pudo completar la operación del Radar." }, 500);
  } finally {
    operation.cleanup();
  }
});
