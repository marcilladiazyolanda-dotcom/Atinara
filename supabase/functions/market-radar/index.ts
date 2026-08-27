import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  RADAR_API_HOSTS,
  RADAR_CANDIDATE_PROVIDERS,
  RADAR_CATEGORIES,
  RADAR_ENRICHMENT_CAPABILITIES,
  RADAR_DISCOVERY_RESPONSE_BUDGET_BYTES,
  RADAR_ELIGIBILITY_POLICY_VERSION,
  RADAR_FACT_POLICY_VERSION,
  RADAR_CHILD_PROJECTION_VERSION,
  RADAR_NORMALIZER_VERSION,
  RADAR_PARENT_RECONCILIATION_VERSION,
  RADAR_PROVIDER_ROLE_VERSION,
  RADAR_PROVIDER_DISCOVERY_CHECKPOINT_V2,
  KALSHI_RADAR_CATALOG_ENTITY_POLICY_VERSION,
  RADAR_PROVIDERS,
  RADAR_REASON_CODES,
  adaptKalshiResponse,
  adaptPolymarketResponse,
  applyDeterministicRadarEligibility,
  applyEligibilityDecision,
  bindRadarCandidatesToReconciledChildren,
  advanceProviderDiscoveryCheckpointV2,
  buildKalshiRadarCatalogEntityTermsV2,
  buildProviderDiscoveryCheckpointV1,
  buildProviderDiscoveryCheckpointV2,
  buildCacheKey,
  buildRadarPersistenceBatches,
  buildCoverResolutionSignals,
  buildDraftPrefill,
  buildResolutionAuthorityEvidence,
  canReuseRadarVerification,
  candidateResolutionSubject,
  cleanText,
  classifyKalshiRadarSeriesCatalogV2,
  collapseLegacyChildRepresentations,
  collectProviderCursorPages,
  constrainRadarDiscoveryPayload,
  detectOfficialCoverEventResolution,
  detectOfficialCoverSelectionHold,
  deriveDeterministicUnresolvedProof,
  evidenceHasPotentialTerminalClaim,
  evaluateGamingDomain,
  evaluateProviderEligibility,
  extractRadarOptionChild,
  extractOfficialHtmlText,
  extractOfficialRelatedUrls,
  groupCandidates,
  hasDeterministicOfficialResearchCoverage,
  hasSpeculativeEvidenceLanguage,
  inferAtinaraCategory,
  isAdaptedIdeaComplete,
  isBlockingDuplicateMatch,
  isCanonicalRadarChildProjectionValid,
  isProviderPlaceholderLabel,
  isRadarParentComplete,
  isRecord,
  isResolutionAuthorityEvidence,
  isVerifiedOfficialEvidence,
  isVerifiedTerminalEvidence,
  normalizeProviderResult,
  normalizeComparableText,
  normalizeRadarCandidatePresentation,
  localizeRadarProviderLabel,
  mergeProviderParentSelections,
  mergeProviderTaxonomySeriesV1,
  paginateMergedRadarParents,
  officialEvidenceSegmentsForSubject,
  officialSelectionEditionCoverage,
  providerResolutionSourceUrls,
  providerResultLabel,
  projectRadarDiscoveryView,
  projectProviderDiscoveryCheckpointV2,
  projectRadarParentReconciliation,
  projectRadarDomainReview,
  prioritizeProviderChildEvidenceAliases,
  publicProviderError,
  providerDiscoveryCheckpointV2State,
  radarOperationalErrorCode,
  radarDomainFingerprintV1,
  reconcileProviderParent,
  safeIsoDate,
  safeNumber,
  safePublicUrl,
  scoreCandidates,
  selectRadarDomainReviewFingerprintV1,
  selectWholeProviderParents,
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
const MAX_PROVIDER_PAGES = 50;
const MAX_NORMALIZED_PER_PROVIDER = 480;
const RADAR_PERSISTENCE_BATCH_SIZE = 24;
const MAX_PERSISTENCE_RPC_CALLS_PER_PROVIDER = 64;
const PERSISTENCE_ISOLATION_BUDGET_MS = 20_000;
const PERSISTENCE_RPC_START_MARGIN_MS = 750;
const RADAR_REFRESH_REQUEST_VERSION = "atinara-radar-refresh-request-v1";
const RADAR_CANDIDATE_FINGERPRINT_PATTERN = /^(?:[a-f0-9]{64}|r[0-9a-f]{8}|r1-[0-9a-f]{16})$/;
const MAX_VISIBLE_GROUPS = 60;
const MAX_AI_ENRICHMENT_GROUPS = 30;
const MAX_AI_ENRICHMENT_CANDIDATES = 180;
const AI_ENRICHMENT_BATCH_SIZE = 9;
const TAVILY_CONCURRENCY = 4;
const MAX_KALSHI_SERIES = 2_000;
const MAX_PROVIDER_INDEX_PARENTS = 2_000;
const MAX_PROVIDER_ENUMERATION_PARENTS = 32;
const MAX_PROVIDER_MATERIALIZED_PARENTS = 24;
const MAX_PROVIDER_MATERIALIZED_CHILDREN = 240;
const PROVIDER_DISCOVERY_CHECKPOINT_VERSION = "atinara-provider-discovery-checkpoint-v1";
const MAX_PROVIDER_DISCOVERY_SERIES_BATCH = 48;
const MAX_PROVIDER_DISCOVERY_SERIES_ATTEMPTS = 4;
const PROVIDER_DISCOVERY_BATCH_BUDGET_MS = 40_000;
const MAX_KALSHI_CATALOG_RESPONSE_BYTES = 24_000_000;
// Kalshi aplica 429 con ráfagas pequeñas en producción. Dos workers conservan
// el presupuesto del refresh y reducen retries sin sacrificar paginación.
const KALSHI_CONCURRENCY = 2;
const MAX_REJECTED_OUTCOME_RECONCILIATIONS = 16;
const MAX_CANONICAL_EVENT_CHILDREN = 480;
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
const RADAR_ENRICHMENT_BUDGET_MS = 12_000;
const MAX_PROVIDER_RETRY_DELAY_MS = 8_000;
const PROVIDER_RETRY_JITTER_MS = 250;
const MAX_PROVIDER_RATE_LIMIT_ATTEMPTS = 4;

const KALSHI_API_ROOT = "https://external-api.kalshi.com/trade-api/v2";
const POLYMARKET_GAMMA_ROOT = "https://gamma-api.polymarket.com";
const POLYMARKET_CLOB_ROOT = "https://clob.polymarket.com";

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

function radarDiscoveryResponse(body: JsonRecord): Response {
  const constrained = constrainRadarDiscoveryPayload({
    ...body,
    response_budget_bytes: RADAR_DISCOVERY_RESPONSE_BUDGET_BYTES,
    response_payload_bytes: RADAR_DISCOVERY_RESPONSE_BUDGET_BYTES,
  });
  if (!constrained.fits) {
    return jsonResponse({
      error: "RADAR_RESPONSE_BUDGET_EXCEEDED",
      message: "La página completa supera el límite seguro. Acota los filtros o abre la siguiente página de eventos.",
      state_preserved: true,
      retryable: true,
      next_action: "narrow_radar_filters",
      refresh_request_id: cleanText(body.refresh_request_id, 80) || null,
      response_payload_bytes: constrained.bytes,
      response_budget_bytes: RADAR_DISCOVERY_RESPONSE_BUDGET_BYTES,
    }, 503);
  }
  return jsonResponse({
    ...constrained.payload,
    response_payload_bytes: constrained.bytes,
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
  maxAttempts?: number;
  maxResponseBytes?: number;
};

type RpcOptions = {
  signal?: AbortSignal;
  timeoutPolicyMs?: number;
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

async function fetchInternal(
  environment: Environment,
  input: string,
  init: RequestInit,
  timeoutPolicyMs = 30_000,
): Promise<Response> {
  return fetchWithinDeadline(input, init, environment.execution, {
    timeoutPolicyMs,
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
  }, options.timeoutPolicyMs ?? 30_000);
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

function isTransientRadarReadFailure(error: unknown): boolean {
  return error instanceof RadarRpcError
    && (error.databaseCode === "57014" || error.status === 500 || error.status === 504);
}

async function rpcReadWithRetry(
  environment: Environment,
  name: string,
  args: JsonRecord,
  authorization: string,
): Promise<unknown> {
  try {
    return await rpc(environment, name, args, authorization);
  } catch (error) {
    if (!isTransientRadarReadFailure(error)) throw error;
    await deadlineSleep(500, environment.execution, FINALIZATION_RESERVE_MS);
    return rpc(environment, name, args, authorization);
  }
}

function validUuid(value: unknown): value is string {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    .test(cleanText(value, 80));
}

function deterministicRadarIssueId(fingerprint: unknown): string {
  const value=cleanText(fingerprint,64).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(value)) throw new Error("MARKET_WORKFLOW_ISSUE_FINGERPRINT_INVALID");
  return `${value.slice(0,8)}-${value.slice(8,12)}-4${value.slice(13,16)}-8${value.slice(17,20)}-${value.slice(20,32)}`;
}

async function createRadarWorkflowIssue(
  input: Parameters<typeof createMarketWorkflowIssue>[0],
): Promise<JsonRecord> {
  const issue=await createMarketWorkflowIssue(input) as JsonRecord;
  return {...issue,issue_id:deterministicRadarIssueId(issue.fingerprint)};
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
  return createRadarWorkflowIssue({
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

function parentReconciliationIssueCode(reconciliation: JsonRecord): string {
  const status = cleanText(reconciliation.reconciliation_status, 80);
  if (status === "inconsistent_provider_count") return RADAR_REASON_CODES.PROVIDER_PARENT_COUNT_INCONSISTENT;
  if (Number(reconciliation.provider_unresolved_child_count) > 0) {
    return RADAR_REASON_CODES.PROVIDER_CHILD_IDENTITY_RESOLUTION_REQUIRED;
  }
  return RADAR_REASON_CODES.RADAR_PARENT_RECONCILIATION_INCOMPLETE;
}

async function recordParentReconciliations(
  environment: Environment,
  intent: RadarRefreshIntent,
  reconciliations: JsonRecord[],
): Promise<void> {
  if (!intent.leaseToken) throw new Error("RADAR_PARENT_MANIFEST_REQUIRED");
  const payloads: JsonRecord[] = await Promise.all(reconciliations.map(async (reconciliation) => {
    const reconciliationStatus = cleanText(reconciliation.reconciliation_status, 80);
    const complete = reconciliationStatus === "complete";
    const terminalCorruption = reconciliationStatus === "terminal_provider_corruption";
    const issue = complete ? null : await createRadarWorkflowIssue({
      issueCode: parentReconciliationIssueCode(reconciliation),
      detectedBy: "radar",
      ownerStage: terminalCorruption ? "provider" : "radar",
      severity: "blocking",
      repairability: terminalCorruption ? "terminal" : "auto_recoverable",
      blockingScope: terminalCorruption ? "terminal" : "approval",
      affectedFields: ["provider_parent", "provider_children", "canonical_child_identity"],
      evidenceRefs: toRecordArray(reconciliation.source_refs).slice(0, 12).map((reference) => {
        const { checked_at: _checkedAt, content_sha256: _contentSha256, ...material } = reference;
        return material;
      }),
      currentValue: {
        provider: reconciliation.provider,
        provider_parent_id: reconciliation.provider_parent_id,
        declared: reconciliation.provider_declared_child_count,
        discovered: reconciliation.provider_discovered_child_count,
        accounted: reconciliation.provider_accounted_child_count,
        identified: reconciliation.provider_identified_child_count,
        unresolved: reconciliation.provider_unresolved_child_count,
        pagination_exhausted: reconciliation.provider_pagination_exhausted,
        reconciliation_status: reconciliation.reconciliation_status,
      },
      proposedValue: {
        provider_declared_child_count: reconciliation.provider_declared_child_count,
        provider_accounted_child_count: reconciliation.provider_declared_child_count,
        provider_unresolved_child_count: 0,
        reconciliation_status: "complete",
      },
      confidence: 100,
      policyVersion: RADAR_PARENT_RECONCILIATION_VERSION,
      retryable: !terminalCorruption,
      nextAction: terminalCorruption ? "inspect_provider_data_conflict" : "retry_provider_refresh",
    });
    return { ...reconciliation, issue } as JsonRecord;
  }));
  payloads.sort((left, right) => {
    const leftId = cleanText(left.provider_parent_id, 220);
    const rightId = cleanText(right.provider_parent_id, 220);
    return leftId < rightId ? -1 : leftId > rightId ? 1 : 0;
  });
  const checkpoints = payloads.length ? payloads.map((payload) => [payload]) : [[]];
  let checkpoint: JsonRecord | null = null;
  for (const reconciliationBatch of checkpoints) {
    await renewRadarRefreshLease(environment, intent);
    checkpoint = toRecord(await rpc(
      environment,
      "record_market_radar_parent_reconciliations_v1",
      {
        request_id_input: intent.requestId,
        provider_input: intent.provider,
        capability_input: intent.capability,
        lease_token_input: intent.leaseToken,
        reconciliations_input: reconciliationBatch,
      },
      undefined,
      true,
    ));
  }
  if (checkpoint?.complete !== true
      || !/^[a-f0-9]{64}$/.test(cleanText(checkpoint.parent_manifest_hash, 64))) {
    throw new Error("RADAR_PARENT_MANIFEST_REQUIRED");
  }
}

const RADAR_TERMINAL_WORKFLOW_CODES = new Set<string>([
  RADAR_REASON_CODES.EVENT_ALREADY_RESOLVED,
  RADAR_REASON_CODES.EVENT_OUTSIDE_CONTRACT,
  RADAR_REASON_CODES.DUPLICATE_MARKET,
  RADAR_REASON_CODES.OUTSIDE_GAMING_DOMAIN,
]);
const RADAR_PROVIDER_AVAILABILITY_WORKFLOW_CODES = new Set<string>([
  RADAR_REASON_CODES.PROVIDER_NOT_OPEN,RADAR_REASON_CODES.PROVIDER_OPTION_INACTIVE,
  RADAR_REASON_CODES.PROVIDER_EVENT_NOT_FOUND,RADAR_REASON_CODES.PROVIDER_CHILD_NOT_FOUND,
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
const RADAR_PARENT_MANAGED_WORKFLOW_CODES = new Set<string>([
  RADAR_REASON_CODES.PROVIDER_CHILD_IDENTITY_RESOLUTION_REQUIRED,
  RADAR_REASON_CODES.RADAR_PARENT_RECONCILIATION_INCOMPLETE,
  RADAR_REASON_CODES.PROVIDER_PARENT_COUNT_INCONSISTENT,
]);

async function candidateDecisionWorkflowIssue(candidate: JsonRecord, code: string) {
  const terminal = RADAR_TERMINAL_WORKFLOW_CODES.has(code);
  const gamingReview = code === RADAR_REASON_CODES.GAMING_DOMAIN_REVIEW_REQUIRED;
  const placeholder = code === RADAR_REASON_CODES.PROVIDER_PLACEHOLDER
    || code === RADAR_REASON_CODES.PROVIDER_CHILD_IDENTITY_RESOLUTION_REQUIRED;
  const parentIncomplete = code === RADAR_REASON_CODES.RADAR_PARENT_RECONCILIATION_INCOMPLETE
    || code === RADAR_REASON_CODES.PROVIDER_PARENT_COUNT_INCONSISTENT;
  const sourceContract = RADAR_SOURCE_CONTRACT_WORKFLOW_CODES.has(code);
  const technicalHold = RADAR_TECHNICAL_HOLD_WORKFLOW_CODES.has(code);
  const providerAvailability = RADAR_PROVIDER_AVAILABILITY_WORKFLOW_CODES.has(code);
  const ownerStage = terminal ? "radar" : gamingReview ? "human_review"
    : sourceContract ? "editor" : technicalHold || providerAvailability ? "provider" : "radar";
  const repairability = terminal ? "terminal" : gamingReview ? "human_editable"
    : sourceContract ? "waiting_authoritative_source" : "auto_recoverable";
  const blockingScope = terminal ? "terminal" : gamingReview || sourceContract || placeholder || parentIncomplete
    || providerAvailability || RADAR_ELIGIBILITY_RECOVERY_WORKFLOW_CODES.has(code)
    ? "approval" : "none";
  const nextAction = terminal ? "archive_terminal_candidate"
    : gamingReview ? "review_gaming_domain_manually"
    : sourceContract ? "repair_temporal_or_source_contract"
    : placeholder ? "recheck_provider_identity"
    : parentIncomplete || providerAvailability ? "retry_provider_refresh"
    : technicalHold ? "retry_source_enrichment" : "refresh_draft_eligibility";
  return createRadarWorkflowIssue({
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

async function loadRadarProviderDiscoveryCheckpoint(
  environment: Environment,
  intent: RadarRefreshIntent,
): Promise<JsonRecord | null> {
  if (!intent.leaseToken || intent.capability !== "candidate_feed") return null;
  const input = {
    request_id_input: intent.requestId,
    provider_input: intent.provider,
    capability_input: intent.capability,
    lease_token_input: intent.leaseToken,
  };
  const v2 = toRecord(await rpc(
    environment,
    "get_market_radar_provider_discovery_checkpoint_v2",
    input,
    undefined,
    true,
  ));
  if (v2) return v2;
  return toRecord(await rpc(
    environment,
    "get_market_radar_provider_discovery_checkpoint_v1",
    input,
    undefined,
    true,
  ));
}

async function checkpointRadarProviderDiscovery(
  environment: Environment,
  intent: RadarRefreshIntent,
  checkpoint: JsonRecord,
): Promise<JsonRecord> {
  if (!intent.leaseToken || intent.capability !== "candidate_feed") {
    throw new Error("RADAR_REFRESH_LEASE_REQUIRED");
  }
  const schemaVersion = cleanText(checkpoint.schema_version, 100);
  const operation = schemaVersion === RADAR_PROVIDER_DISCOVERY_CHECKPOINT_V2
    ? "checkpoint_market_radar_provider_discovery_v2"
    : "checkpoint_market_radar_provider_discovery_v1";
  const result = toRecord(await rpc(
    environment,
    operation,
    {
      request_id_input: intent.requestId,
      provider_input: intent.provider,
      capability_input: intent.capability,
      lease_token_input: intent.leaseToken,
      checkpoint_input: checkpoint,
    },
    undefined,
    true,
  )) ?? {};
  intent.phase = "fetching";
  intent.inProgress = true;
  intent.leaseToken = null;
  return result;
}

async function deferRadarProviderDiscovery(
  environment: Environment,
  intent: RadarRefreshIntent,
  failure: ReturnType<typeof publicProviderError> & JsonRecord,
): Promise<JsonRecord> {
  if (!intent.leaseToken || intent.capability !== "candidate_feed") {
    throw new Error("RADAR_REFRESH_LEASE_REQUIRED");
  }
  const code = cleanText(failure.code, 100);
  const result = toRecord(await rpc(
    environment,
    "defer_market_radar_provider_discovery_v2",
    {
      request_id_input: intent.requestId,
      provider_input: intent.provider,
      capability_input: intent.capability,
      lease_token_input: intent.leaseToken,
      issue_code_input: code,
      retry_after_at_input: safeIsoDate(failure.retry_after_at),
    },
    undefined,
    true,
  )) ?? {};
  if (result.outcome !== "in_progress" || result.retryable !== true
      || result.next_action !== "resume_provider_discovery") {
    throw new Error("RADAR_PROVIDER_DISCOVERY_DEFERRAL_INVALID");
  }
  intent.phase = "fetching";
  intent.inProgress = true;
  intent.leaseToken = null;
  return result;
}

async function renewRadarRefreshLeases(
  environment: Environment,
  intents: RadarRefreshIntent[],
): Promise<void> {
  for (const intent of intents) {
    if (intent.terminal || intent.inProgress || !intent.leaseToken) continue;
    await renewRadarRefreshLease(environment, intent);
  }
}

async function withRadarRefreshLeaseHeartbeat<T>(
  environment: Environment,
  intents: RadarRefreshIntent[],
  operation: () => Promise<T>,
): Promise<T> {
  const renewable = intents.filter((intent) =>
    !intent.terminal && !intent.inProgress && Boolean(intent.leaseToken));
  if (!renewable.length) return operation();
  await renewRadarRefreshLeases(environment, renewable);
  const completed = Promise.resolve().then(operation).then(
    (value) => ({ done: true as const, value }),
    (error) => ({ done: true as const, error }),
  );
  while (true) {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const heartbeat = new Promise<{ done: false }>((resolve) => {
      timer = setTimeout(() => resolve({ done: false }), 15_000);
    });
    const outcome = await Promise.race([completed, heartbeat]);
    if (outcome.done) {
      if (timer !== null) clearTimeout(timer);
      if ("error" in outcome) throw outcome.error;
      return outcome.value;
    }
    await renewRadarRefreshLeases(environment, renewable);
  }
}

async function withRadarEnrichmentBudget<T>(
  environment: Environment,
  operation: (boundedEnvironment: Environment) => Promise<T>,
): Promise<T> {
  const remaining = Math.max(
    1_000,
    environment.execution.absoluteDeadlineAt - Date.now() - FINALIZATION_RESERVE_MS,
  );
  const scoped = createAbsoluteExecutionContext({
    durationMs: Math.min(RADAR_ENRICHMENT_BUDGET_MS, remaining),
    invocationId: environment.execution.invocationId,
    agentRunId: environment.execution.agentRunId,
    parentSignal: environment.execution.signal,
  });
  try {
    return await operation({ ...environment, execution: scoped.context });
  } finally {
    scoped.cleanup();
  }
}

async function withRadarProviderDiscoveryBudget<T>(
  environment: Environment,
  operation: (boundedEnvironment: Environment) => Promise<T>,
): Promise<T> {
  const remaining = Math.max(
    1_000,
    environment.execution.absoluteDeadlineAt - Date.now() - FINALIZATION_RESERVE_MS,
  );
  const scoped = createAbsoluteExecutionContext({
    durationMs: Math.min(PROVIDER_DISCOVERY_BATCH_BUDGET_MS, remaining),
    invocationId: environment.execution.invocationId,
    agentRunId: environment.execution.agentRunId,
    parentSignal: environment.execution.signal,
  });
  try {
    return await operation({ ...environment, execution: scoped.context });
  } finally {
    scoped.cleanup();
  }
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

async function readProviderResponseText(response: Response, maxBytes: number): Promise<string> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new Error("PROVIDER_RESPONSE_TOO_LARGE");
  }
  if (!response.body) {
    const buffer = new Uint8Array(await response.arrayBuffer());
    if (buffer.byteLength > maxBytes) throw new Error("PROVIDER_RESPONSE_TOO_LARGE");
    return new TextDecoder().decode(buffer);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel("PROVIDER_RESPONSE_TOO_LARGE").catch(() => undefined);
        throw new Error("PROVIDER_RESPONSE_TOO_LARGE");
      }
      chunks.push(decoder.decode(value, { stream: true }));
    }
    chunks.push(decoder.decode());
    return chunks.join("");
  } finally {
    reader.releaseLock();
  }
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
  const maxAttempts = Math.max(1, Math.min(
    MAX_PROVIDER_RATE_LIMIT_ATTEMPTS,
    Math.floor(Number(options.maxAttempts) || MAX_PROVIDER_RATE_LIMIT_ATTEMPTS),
  ));
  const maxResponseBytes = Math.max(64_000, Math.min(
    MAX_KALSHI_CATALOG_RESPONSE_BYTES,
    Math.floor(Number(options.maxResponseBytes) || 3_000_000),
  ));
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const child = createChildAbort(execution, timeoutMs, FINALIZATION_RESERVE_MS);
    try {
      const response = await fetch(url, { ...init, signal: child.signal });
      if (response.ok) {
        const text = await readProviderResponseText(response, maxResponseBytes);
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
        if (attempt < maxAttempts - 1
            && delayMs <= MAX_PROVIDER_RETRY_DELAY_MS) {
          await deadlineSleep(delayMs, execution, FINALIZATION_RESERVE_MS);
          continue;
        }
        throw rateLimitError;
      }
      if (response.status >= 500) {
        if (attempt === 0 && maxAttempts > 1) {
          await deadlineSleep(providerRetryDelay(attempt), execution, FINALIZATION_RESERVE_MS);
          continue;
        }
        throw new ProviderRequestError(`PROVIDER_HTTP_${response.status}`, response.status);
      }
      throw new ProviderRequestError(`PROVIDER_HTTP_${response.status}`, response.status);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") throw new Error("PROVIDER_TIMEOUT");
      if (error instanceof ProviderRequestError
        || attempt >= Math.min(1, maxAttempts - 1)
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
  const internalFailure = internalRadarOperationalFailure(error, provider);
  if (internalFailure) return internalFailure;
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

function internalRadarOperationalFailure(
  error: unknown,
  provider: string,
): (ReturnType<typeof publicProviderError> & JsonRecord) | null {
  if (error instanceof RadarRpcError) return internalRadarRpcFailure(error, provider);
  const fallback = "RADAR_INTERNAL_OPERATION_FAILED";
  const code = radarOperationalErrorCode(error, fallback);
  if (code === fallback || code.startsWith("PROVIDER_")) return null;
  const timedOut = code.includes("TIMEOUT") || code.includes("DEADLINE_EXCEEDED");
  return {
    ...publicProviderError(provider, code, timedOut ? 503 : 409),
    retryable: timedOut || [
      "RADAR_REFRESH_LEASE_INVALID",
      "RADAR_REFRESH_LEASE_LOST",
      "RADAR_PERSISTENCE_ISOLATION_DEFERRED",
    ].includes(code),
    database_code: null,
  };
}

function internalRadarRpcFailure(
  error: unknown,
  provider: string,
): (ReturnType<typeof publicProviderError> & JsonRecord) | null {
  if (!(error instanceof RadarRpcError)) return null;
  const timedOut = error.databaseCode === "57014" || error.status === 504
    || error.databaseMessage.includes("TIMEOUT");
  const code = timedOut ? "RADAR_PERSISTENCE_TIMEOUT"
    : error.databaseMessage || "RADAR_PERSISTENCE_FAILED";
  const retryable = timedOut || code === "RADAR_PERSISTENCE_FAILED" || [
    "RADAR_REFRESH_LEASE_INVALID",
    "RADAR_REFRESH_LEASE_LOST",
    "RADAR_PERSISTENCE_ISOLATION_DEFERRED",
  ].includes(code);
  return {
    ...publicProviderError(
      provider,
      code,
      timedOut ? 503 : code === "RADAR_PERSISTENCE_FAILED" ? 502 : 409,
    ),
    retryable,
    database_code: error.databaseCode || null,
  };
}

function persistenceFailure(
  error: unknown,
  provider: string,
): ReturnType<typeof publicProviderError> & JsonRecord {
  const internalFailure = internalRadarOperationalFailure(error, provider);
  if (internalFailure) return internalFailure;
  const deferred = error instanceof Error
    && error.message === "RADAR_PERSISTENCE_ISOLATION_DEFERRED";
  const timedOut = error instanceof RadarRpcError
    ? error.databaseCode === "57014" || error.status === 504
    : error instanceof Error && /TIMEOUT|ABORT/i.test(error.message);
  return {
    ...publicProviderError(
      provider,
      deferred ? "RADAR_PERSISTENCE_ISOLATION_DEFERRED"
        : timedOut ? "RADAR_PERSISTENCE_TIMEOUT" : "RADAR_PERSISTENCE_FAILED",
      timedOut ? 503 : 502,
    ),
    retryable: true,
  };
}

const RADAR_DEFERRABLE_PERSISTENCE_CODES = new Set<string>([
  "RADAR_PERSISTENCE_TIMEOUT",
  "RADAR_PERSISTENCE_ISOLATION_DEFERRED",
  "RADAR_PERSISTENCE_FAILED",
]);

async function deferRadarRefreshPersistence(
  environment: Environment,
  intent: RadarRefreshIntent,
  failure: ReturnType<typeof publicProviderError> & JsonRecord,
): Promise<JsonRecord | null> {
  const leaseToken = intent.leaseToken;
  const code = cleanText(failure.code, 100);
  if (!leaseToken || failure.retryable !== true
      || !RADAR_DEFERRABLE_PERSISTENCE_CODES.has(code)) return null;
  const deferral = toRecord(await rpc(environment, "defer_market_radar_refresh_v1", {
    request_id_input: intent.requestId,
    provider_input: intent.provider,
    capability_input: intent.capability,
    lease_token_input: leaseToken,
    issue_code_input: code,
  }, undefined, true));
  if (deferral?.outcome !== "in_progress" || deferral.retryable !== true
      || deferral.next_action !== "resume_persistence_intent"
      || deferral.request_id !== intent.requestId) {
    throw new Error("RADAR_REFRESH_DEFERRAL_INVALID");
  }
  return deferral;
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
    reconciliation_offset: Math.max(0, Math.min(10_000, Math.floor(Number(body.reconciliation_offset) || 0))),
  };
}

function radarRefreshIdentityFilters(filters: ReturnType<typeof safeFilters>) {
  return {
    provider: filters.provider,
    category: filters.category,
    quality: filters.quality,
    order: filters.order,
    horizon: filters.horizon,
    query: filters.query,
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
    condition_id: cleanText(market.conditionId, 220) || null,
    market_slug: cleanText(market.slug, 400) || null,
    raw_provider_child_label: cleanText(market.raw_provider_child_label ?? market.groupItemTitle, 240) || null,
    canonical_child_label: cleanText(market.canonical_child_label, 240) || null,
    question: cleanText(market.question, 700),
    status: market.closed === true || market.archived === true || market.active === false || market.acceptingOrders === false ? "closed" : "open",
    result: normalizeProviderResult(market.result ?? market.resolutionResult ?? market.winningOutcome),
    settled_at: safeIsoDate(market.resolvedAt ?? market.resolutionDate),
    close_at: safeIsoDate(market.endDate ?? event.endDate),
  } : {
    market_id: cleanText(market.ticker ?? market.market_ticker, 220),
    market_slug: cleanText(market.slug, 400) || null,
    raw_provider_child_label: cleanText(market.raw_provider_child_label ?? market.yes_sub_title, 240) || null,
    canonical_child_label: cleanText(market.canonical_child_label, 240) || null,
    question: cleanText(market.title ?? market.yes_sub_title, 700),
    yes_sub_title: cleanText(market.yes_sub_title, 500) || null,
    no_sub_title: cleanText(market.no_sub_title, 500) || null,
    status: cleanText(market.status, 80).toLowerCase(),
    result: normalizeProviderResult(market.result),
    settled_at: safeIsoDate(market.settlement_ts ?? market.determined_at),
    close_at: safeIsoDate(market.close_time ?? market.expected_expiration_time),
  }).sort((left, right) => compareUtf16Text(left.market_id, right.market_id));
}

type ProviderDiscoveryResult = {
  candidates: JsonRecord[];
  reconciliations: JsonRecord[];
  selection?: JsonRecord;
};

function providerChildLabel(record: JsonRecord): string | null {
  const option = extractRadarOptionChild({
    source_question: record.question ?? record.title,
    canonical_child_label: record.canonical_child_label,
    provider_payload: {
      canonical_child_label: record.canonical_child_label,
      yes_sub_title: record.groupItemTitle ?? record.yes_sub_title,
    },
  });
  return option && !option.placeholder ? cleanText(option.label, 240) : null;
}

async function providerIdentityEvidence(
  url: URL,
  identifierType: string,
  identifier: string,
  record: JsonRecord | null,
  result: string,
  checkedAt: string,
): Promise<JsonRecord> {
  const marketProjection = (value: JsonRecord) => ({
    id: cleanText(value.id ?? value.market_id ?? value.ticker ?? value.market_ticker, 220) || null,
    condition_id: cleanText(value.conditionId ?? value.condition_id, 220) || null,
    event_id: cleanText(value.event_id ?? value.eventId ?? value.event_ticker, 220) || null,
    slug: cleanText(value.slug, 400) || null,
    question: cleanText(value.question ?? value.title, 700) || null,
    child_label: cleanText(value.groupItemTitle ?? value.yes_sub_title, 500) || null,
    status: cleanText(value.status, 80) || null,
    active: typeof value.active === "boolean" ? value.active : null,
    closed: typeof value.closed === "boolean" ? value.closed : null,
    archived: typeof value.archived === "boolean" ? value.archived : null,
    accepting_orders: typeof value.acceptingOrders === "boolean" ? value.acceptingOrders : null,
    result: normalizeProviderResult(value.result ?? value.resolutionResult ?? value.winningOutcome),
    closes_at: safeIsoDate(value.endDate ?? value.close_time ?? value.latest_expiration_time),
    resolution_rules: cleanText(
      value.source_resolution_rules ?? value.rules_primary ?? value.rules_secondary
        ?? value.resolution_rules ?? value.resolutionRules ?? value.resolutionCriteria,
      5_000,
    ) || null,
    resolution_source_url: safePublicUrl(
      value.source_resolution_url ?? value.resolution_source_url
        ?? value.resolutionSource ?? value.resolution_source,
    ),
    token_ids: providerTokenIds(value.clobTokenIds ?? value.token_ids)
      .concat(toRecordArray(value.tokens).map((token) => cleanText(token.token_id ?? token.id, 220)).filter(Boolean))
      .filter((token, index, values) => values.indexOf(token) === index).toSorted(compareUtf16Text),
  });
  const root = record ? toRecord(record.event) ?? toRecord(record.market) ?? record : null;
  const observedMarkets = root ? [
    ...toRecordArray(root.markets ?? record?.markets),
    ...(cleanText(root.id ?? root.ticker ?? root.market_ticker, 220)
      && !Array.isArray(root.markets) ? [root] : []),
  ] : [];
  // Conserva primero una clave primaria de CADA hija. Ordenar y truncar todas
  // las aliases juntas podía dejar sin evidencia a las últimas hijas de un
  // padre grande aunque el endpoint hubiese devuelto las 480.
  const observedChildIds = prioritizeProviderChildEvidenceAliases(observedMarkets, 1_920);
  const observedParentIds = root ? [...new Set([
    ...toRecordArray(root.events),
    ...toRecordArray(root.markets).flatMap((market) => toRecordArray(market.events)),
  ].map((event) => cleanText(event.id ?? event.event_ticker, 220)).filter(Boolean))].slice(0, 8) : [];
  const identityProjection = root ? {
    id: cleanText(root.id ?? root.event_ticker ?? root.ticker, 220) || null,
    slug: cleanText(root.slug, 400) || null,
    title: cleanText(root.title ?? root.sub_title, 700) || null,
    category: cleanText(root.category, 120) || null,
    markets: toRecordArray(root.markets ?? record?.markets)
      .map(marketProjection)
      .toSorted((left, right) => compareUtf16Text(
        `${left.id}:${left.condition_id}`,
        `${right.id}:${right.condition_id}`,
      )),
    market: marketProjection(root),
  } : null;
  return {
    url: url.toString(),
    endpoint: url.pathname,
    identifier_type: identifierType,
    identifier,
    result,
    content_sha256: record ? await sha256Hex(record) : null,
    identity_sha256: identityProjection ? await sha256Hex(identityProjection) : null,
    observed_parent_ids: observedParentIds,
    observed_child_ids: observedChildIds,
    checked_at: checkedAt,
  };
}

function polymarketMarketId(record: JsonRecord | null): string {
  return cleanText(record?.id ?? record?.market_id, 220);
}

function polymarketConditionId(record: JsonRecord | null): string {
  return cleanText(record?.conditionId ?? record?.condition_id, 220);
}

function providerTokenIds(value: unknown): string[] {
  let values: unknown[] = [];
  if (Array.isArray(value)) values = value;
  else if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) values = parsed;
    } catch {
      return [];
    }
  }
  return [...new Set(values.map((item) => cleanText(item, 220)).filter(Boolean))].slice(0, 20);
}

function polymarketMarketBelongsToParent(record: JsonRecord, parentId: string): boolean {
  const explicitParent = cleanText(record.event_id ?? record.eventId, 220);
  if (explicitParent) return explicitParent === parentId;
  const events = toRecordArray(record.events);
  return events.length > 0 && events.some((event) => cleanText(event.id, 220) === parentId);
}

function polymarketParentRelation(record: JsonRecord, parentId: string): "match" | "conflict" | "unknown" {
  const explicitParent = cleanText(record.event_id ?? record.eventId, 220);
  if (explicitParent) return explicitParent === parentId ? "match" : "conflict";
  const events = toRecordArray(record.events).map((event) => cleanText(event.id, 220)).filter(Boolean);
  if (!events.length) return "unknown";
  return events.includes(parentId) ? "match" : "conflict";
}

function polymarketGammaIdentifiersMatch(direct: JsonRecord, market: JsonRecord): boolean {
  const expectedMarketId = cleanText(market.id ?? market.external_market_id ?? market.market_id, 220);
  const expectedConditionId = cleanText(market.conditionId ?? market.condition_id, 220);
  return Boolean(expectedMarketId && polymarketMarketId(direct) === expectedMarketId
    && (!expectedConditionId || polymarketConditionId(direct) === expectedConditionId));
}

function polymarketDirectChildMatches(
  surface: "gamma" | "clob",
  direct: JsonRecord,
  market: JsonRecord,
  parentId: string,
): boolean {
  const expectedConditionId = cleanText(market.conditionId ?? market.condition_id, 220);
  if (surface === "gamma") {
    return polymarketGammaIdentifiersMatch(direct, market)
      && polymarketMarketBelongsToParent(direct, parentId);
  }
  if (!expectedConditionId || polymarketConditionId(direct) !== expectedConditionId) return false;
  const expectedTokens = new Set(providerTokenIds(market.clobTokenIds ?? market.token_ids));
  const directTokens = new Set(toRecordArray(direct.tokens)
    .map((token) => cleanText(token.token_id ?? token.id, 220)).filter(Boolean));
  return expectedTokens.size === 0
    || (expectedTokens.size === directTokens.size
      && [...expectedTokens].every((token) => directTokens.has(token)));
}

async function fetchPolymarketKeysetMarket(
  environment: Environment,
  marketId: string,
  checkedAt: string,
  expectedParentId: string,
): Promise<{ record: JsonRecord | null; evidence: JsonRecord }> {
  const url = new URL(`${POLYMARKET_GAMMA_ROOT}/markets/keyset`);
  url.searchParams.set("limit", "10");
  url.searchParams.set("id", marketId);
  try {
    const payload = await fetchJson(url, {}, PROVIDER_TIMEOUT_MS, { execution: environment.execution });
    const root = toRecord(payload);
    const records = Array.isArray(payload) ? toRecordArray(payload)
      : toRecordArray(root?.data ?? root?.markets);
    const record = records.find((item) => polymarketMarketId(item) === marketId) ?? null;
    return {
      record,
      evidence: await providerIdentityEvidence(
        url, "external_market_id", marketId, record ? { markets: records } : root,
        record ? polymarketParentRelation(record, expectedParentId) === "match"
          ? "parent_binding_checked" : polymarketParentRelation(record, expectedParentId) === "conflict"
            ? "parent_binding_conflict" : "parent_binding_unknown" : "provider_not_found", checkedAt,
      ),
    };
  } catch (error) {
    return {
      record: null,
      evidence: await providerIdentityEvidence(
        url, "external_market_id", marketId, null, cleanText((error as Error)?.message, 80), checkedAt,
      ),
    };
  }
}

async function resolvePolymarketChildIdentity(
  environment: Environment,
  market: JsonRecord,
  parentId: string,
  checkedAt: string,
): Promise<JsonRecord> {
  const rawLabel = cleanText(market.groupItemTitle, 240)
    || cleanText(extractRadarOptionChild({ source_question: market.question })?.label, 240);
  if (rawLabel && !isProviderPlaceholderLabel(rawLabel)) return market;
  const marketId = cleanText(market.id, 220);
  const conditionId = cleanText(market.conditionId, 220);
  const evidence: JsonRecord[] = [];
  let identityEndpointSucceeded = false;
  let identityConflict = false;
  let identitySurfaceUnavailable = false;
  let parentBindingVerified = true;
  if (marketId) {
    const directUrl = new URL(`${POLYMARKET_GAMMA_ROOT}/markets/${encodeURIComponent(marketId)}`);
    try {
      const direct = toRecord(await fetchJson(directUrl, {}, PROVIDER_TIMEOUT_MS, { execution: environment.execution }));
      identityEndpointSucceeded = Boolean(direct);
      const relation = direct ? polymarketParentRelation(direct, parentId) : "unknown";
      const bindingValid = Boolean(direct && polymarketGammaIdentifiersMatch(direct, market)
        && relation !== "conflict");
      if (direct && (!polymarketGammaIdentifiersMatch(direct, market) || relation === "conflict")) {
        identityConflict = true;
        parentBindingVerified = false;
      }
      const label = bindingValid && direct ? providerChildLabel(direct) : null;
      evidence.push(await providerIdentityEvidence(
        directUrl, "external_market_id", marketId, direct,
        !bindingValid ? "provider_data_conflict" : label ? "identity_resolved" : "placeholder_confirmed", checkedAt,
      ));
      if (direct && label && !identityConflict && parentBindingVerified) return {
        ...market,
        ...direct,
        _atinara_identity_resolution: true,
        raw_provider_child_label: rawLabel || null,
        canonical_child_label: label,
        identity_source: "polymarket_gamma_market_by_id",
        identity_evidence: evidence,
      };
    } catch (error) {
      if (!providerHttpNotFound(error)) identitySurfaceUnavailable = true;
      evidence.push(await providerIdentityEvidence(
        directUrl, "external_market_id", marketId, null,
        error instanceof Error ? cleanText(error.message, 80) : "provider_unavailable", checkedAt,
      ));
    }
  }
  if (marketId) {
    const keyset = await fetchPolymarketKeysetMarket(environment, marketId, checkedAt, parentId);
    evidence.push(keyset.evidence);
    if (keyset.record) {
      identityEndpointSucceeded = true;
      const relation = polymarketParentRelation(keyset.record, parentId);
      const bindingValid = polymarketGammaIdentifiersMatch(keyset.record, market)
        && relation !== "conflict";
      if (!bindingValid) {
        identityConflict = true;
        if (relation === "conflict") parentBindingVerified = false;
      }
      const label = bindingValid ? providerChildLabel(keyset.record) : null;
      if (label && !identityConflict && parentBindingVerified) return {
        ...market,
        ...keyset.record,
        _atinara_identity_resolution: true,
        raw_provider_child_label: rawLabel || null,
        canonical_child_label: label,
        identity_source: "polymarket_gamma_keyset_by_market_id",
        identity_evidence: evidence,
      };
    } else if (!["provider_not_found", "parent_binding_unknown"].includes(
      cleanText(keyset.evidence.result, 80),
    )) identitySurfaceUnavailable = true;
  }
  if (conditionId) {
    const clobUrl = new URL(`${POLYMARKET_CLOB_ROOT}/markets/${encodeURIComponent(conditionId)}`);
    try {
      const direct = toRecord(await fetchJson(clobUrl, {}, PROVIDER_TIMEOUT_MS, { execution: environment.execution }));
      identityEndpointSucceeded = Boolean(direct) || identityEndpointSucceeded;
      const bindingValid = Boolean(direct && polymarketDirectChildMatches("clob", direct, market, parentId));
      if (direct && !bindingValid) identityConflict = true;
      const label = bindingValid && direct ? providerChildLabel(direct) : null;
      evidence.push(await providerIdentityEvidence(
        clobUrl, "condition_id", conditionId, direct,
        !bindingValid ? "provider_data_conflict" : label ? "identity_resolved" : "placeholder_confirmed", checkedAt,
      ));
      if (direct && label && !identityConflict && parentBindingVerified) return {
        ...market,
        _atinara_identity_resolution: true,
        raw_provider_child_label: rawLabel || null,
        canonical_child_label: label,
        identity_source: "polymarket_clob_market_by_condition_id",
        identity_evidence: evidence,
      };
    } catch (error) {
      if (!providerHttpNotFound(error)) identitySurfaceUnavailable = true;
      evidence.push(await providerIdentityEvidence(
        clobUrl, "condition_id", conditionId, null,
        error instanceof Error ? cleanText(error.message, 80) : "provider_unavailable", checkedAt,
      ));
    }
  }
  return {
    ...market,
    _atinara_identity_resolution: true,
    raw_provider_child_label: rawLabel || null,
    canonical_child_label: null,
    identity_source: null,
    identity_evidence: evidence,
    identity_resolution_unavailable: identitySurfaceUnavailable || (evidence.length > 0 && !identityEndpointSucceeded),
    identity_resolution_conflict: identityConflict,
  };
}

async function resolvePolymarketEventIdentities(
  environment: Environment,
  event: JsonRecord,
  checkedAt: string,
): Promise<JsonRecord> {
  const markets = toRecordArray(event.markets);
  const parentId = cleanText(event.id ?? event.slug, 220);
  const resolved = await mapWithConcurrency(markets, KALSHI_CONCURRENCY, async (market) =>
    isProviderPlaceholderLabel(cleanText(market.groupItemTitle, 240)
      || cleanText(extractRadarOptionChild({ source_question: market.question })?.label, 240))
      ? resolvePolymarketChildIdentity(environment, market, parentId, checkedAt)
      : market);
  return {
    ...event,
    markets: resolved.map((result, index) => result.status === "fulfilled" ? result.value : {
      ...markets[index],
      _atinara_identity_resolution: true,
      identity_resolution_unavailable: true,
      identity_evidence: [{
        identifier_type: "external_market_id",
        identifier: cleanText(markets[index]?.id, 220),
        result: "provider_unavailable",
        checked_at: checkedAt,
      }],
    }),
  };
}

async function resolveKalshiChildIdentity(
  environment: Environment,
  market: JsonRecord,
  parentId: string,
  checkedAt: string,
): Promise<JsonRecord> {
  const ticker = cleanText(market.ticker ?? market.market_ticker, 220);
  const rawLabel = cleanText(market.yes_sub_title, 240)
    || cleanText(extractRadarOptionChild({ source_question: market.title })?.label, 240);
  if (!isProviderPlaceholderLabel(rawLabel) || !ticker) return market;
  const evidence: JsonRecord[] = [];
  let identityEndpointSucceeded = false;
  let identityConflict = false;
  let identitySurfaceUnavailable = false;
  for (const historical of [false, true]) {
    const url = new URL(`${KALSHI_API_ROOT}/${historical ? "historical/" : ""}markets/${encodeURIComponent(ticker)}`);
    try {
      const payload = toRecord(await fetchJson(url, {}, PROVIDER_TIMEOUT_MS, { execution: environment.execution })) ?? {};
      const direct = toRecord(payload.market) ?? payload;
      identityEndpointSucceeded = true;
      const bindingValid = cleanText(direct.ticker ?? direct.market_ticker, 220) === ticker
        && cleanText(direct.event_ticker, 220) === parentId;
      if (!bindingValid) identityConflict = true;
      const label = bindingValid ? providerChildLabel(direct) : null;
      evidence.push(await providerIdentityEvidence(
        url, "market_ticker", ticker, direct,
        !bindingValid ? "provider_data_conflict" : label ? "identity_resolved" : "placeholder_confirmed", checkedAt,
      ));
      if (bindingValid && label) return {
        ...market,
        ...(historical ? {} : direct),
        _atinara_identity_resolution: true,
        raw_provider_child_label: rawLabel || null,
        canonical_child_label: label,
        identity_source: historical ? "kalshi_historical_market_by_ticker" : "kalshi_market_by_ticker",
        identity_evidence: evidence,
      };
    } catch (error) {
      evidence.push(await providerIdentityEvidence(
        url, "market_ticker", ticker, null,
        providerHttpNotFound(error) ? "provider_not_found" : cleanText((error as Error)?.message, 80), checkedAt,
      ));
      if (!providerHttpNotFound(error)) identitySurfaceUnavailable = true;
    }
  }
  const metadataUrl = new URL(`${KALSHI_API_ROOT}/events/${encodeURIComponent(parentId)}/metadata`);
  try {
    const metadata = toRecord(await fetchJson(
      metadataUrl, {}, PROVIDER_TIMEOUT_MS, { execution: environment.execution },
    ));
    const metadataCandidates = [
      ...toRecordArray(metadata?.markets),
      ...toRecordArray(metadata?.market_metadata),
      ...toRecordArray(metadata?.children),
      ...toRecordArray(toRecord(metadata?.event)?.markets),
    ];
    const exact = metadataCandidates.find((item) =>
      cleanText(item.ticker ?? item.market_ticker, 220) === ticker);
    const exactParent = cleanText(exact?.event_ticker, 220);
    const bindingValid = Boolean(exact && (!exactParent || exactParent === parentId));
    if (exact && !bindingValid) identityConflict = true;
    const label = bindingValid && exact ? providerChildLabel(exact) : null;
    evidence.push(await providerIdentityEvidence(
      metadataUrl, "market_ticker", ticker, metadata,
      !bindingValid && exact ? "provider_data_conflict"
        : label ? "identity_resolved" : "metadata_checked_no_identity", checkedAt,
    ));
    if (label && !identityConflict) return {
      ...market,
      _atinara_identity_resolution: true,
      raw_provider_child_label: rawLabel || null,
      canonical_child_label: label,
      identity_source: "kalshi_event_metadata_by_ticker",
      identity_evidence: evidence,
    };
  } catch (error) {
    evidence.push(await providerIdentityEvidence(
      metadataUrl, "event_ticker", parentId, null, cleanText((error as Error)?.message, 80), checkedAt,
    ));
    if (!providerHttpNotFound(error)) identitySurfaceUnavailable = true;
  }
  return {
    ...market,
    _atinara_identity_resolution: true,
    raw_provider_child_label: rawLabel || null,
    canonical_child_label: null,
    identity_source: null,
    identity_evidence: evidence,
    identity_resolution_unavailable: identitySurfaceUnavailable || !identityEndpointSucceeded,
    identity_resolution_conflict: identityConflict,
  };
}

async function resolveKalshiEventIdentities(
  environment: Environment,
  event: JsonRecord,
  checkedAt: string,
): Promise<JsonRecord> {
  const parentId = cleanText(event.event_ticker ?? event.ticker, 220);
  const markets = toRecordArray(event.markets);
  const resolved = await mapWithConcurrency(markets, KALSHI_CONCURRENCY, async (market) =>
    isProviderPlaceholderLabel(cleanText(market.yes_sub_title, 240)
      || cleanText(extractRadarOptionChild({ source_question: market.title })?.label, 240))
      ? resolveKalshiChildIdentity(environment, market, parentId, checkedAt)
      : market);
  return {
    ...event,
    markets: resolved.map((result, index) => result.status === "fulfilled" ? result.value : {
      ...markets[index],
      _atinara_identity_resolution: true,
      identity_resolution_unavailable: true,
      identity_evidence: [{
        identifier_type: "market_ticker",
        identifier: cleanText(markets[index]?.ticker ?? markets[index]?.market_ticker, 220),
        result: "provider_unavailable",
        checked_at: checkedAt,
      }],
    }),
  };
}

async function loadPreviousParentChildren(
  environment: Environment,
  provider: "polymarket" | "kalshi",
  events: JsonRecord[],
  requestId: string | null,
): Promise<Map<string, JsonRecord[]>> {
  const parentIds = events.map((event) => provider === "polymarket"
    ? cleanText(event.id ?? event.slug, 220)
    : cleanText(event.event_ticker ?? event.ticker, 220)).filter(Boolean);
  if (!parentIds.length) return new Map();
  const currentChildParents = new Map<string, Set<string>>();
  const externalMarketIds = new Set<string>();
  const conditionIds = new Set<string>();
  const tokenIds = new Set<string>();
  const childSlugs = new Set<string>();
  const childIdentityKeys = new Set<string>();
  const fallbackSlugs = new Map<string, { parentId: string; count: number }>();
  for (const event of events) {
    const parentId = provider === "polymarket"
      ? cleanText(event.id ?? event.slug, 220)
      : cleanText(event.event_ticker ?? event.ticker, 220);
    if (!parentId) continue;
    for (const market of toRecordArray(event.markets)) {
      const externalId = providerMarketStableId(provider, market);
      const conditionId = cleanText(market.conditionId ?? market.condition_id, 220);
      const marketTokens = providerTokenIds(market.clobTokenIds ?? market.token_ids)
        .concat(toRecordArray(market.tokens).map((token) => cleanText(token.token_id ?? token.id, 220)))
        .filter((value, index, values) => Boolean(value) && values.indexOf(value) === index)
        .toSorted(compareUtf16Text).slice(0, 20);
      const childSlug = cleanText(market.child_slug ?? market.slug, 400);
      const providerIdentityKey = cleanText(market.provider_child_identity_key, 500);
      const explicitIdentityStrong = providerIdentityKey
        && !providerIdentityKey.startsWith(`${provider}:slug:`);
      const strongIdentities = [
        externalId ? `market:${externalId}` : "",
        conditionId ? `condition:${conditionId}` : "",
        ...marketTokens.map((token) => `token:${token}`),
        explicitIdentityStrong ? `identity:${providerIdentityKey}` : "",
      ].filter(Boolean);
      for (const identity of strongIdentities) {
        if (!currentChildParents.has(identity)) currentChildParents.set(identity, new Set());
        currentChildParents.get(identity)?.add(parentId);
      }
      if (externalId) externalMarketIds.add(externalId);
      if (conditionId) conditionIds.add(conditionId);
      marketTokens.forEach((token) => tokenIds.add(token));
      if (!strongIdentities.length && childSlug) {
        const prior = fallbackSlugs.get(childSlug);
        fallbackSlugs.set(childSlug, {
          parentId: prior?.parentId ?? parentId,
          count: (prior?.count ?? 0) + 1,
        });
      }
      const primaryIdentityKey = explicitIdentityStrong ? providerIdentityKey
        || (externalId ? `${provider}:market:${externalId}` : "")
        || (conditionId ? `${provider}:condition:${conditionId}` : "")
        || (marketTokens[0] ? `${provider}:token:${marketTokens[0]}` : "")
        : (externalId ? `${provider}:market:${externalId}` : "")
          || (conditionId ? `${provider}:condition:${conditionId}` : "")
          || (marketTokens[0] ? `${provider}:token:${marketTokens[0]}` : "");
      if (primaryIdentityKey) childIdentityKeys.add(primaryIdentityKey);
    }
  }
  for (const [slug, fallback] of fallbackSlugs) {
    if (fallback.count !== 1) continue;
    currentChildParents.set(`slug:${slug}`,new Set([fallback.parentId]));
    childSlugs.add(slug);
    childIdentityKeys.add(`${provider}:slug:${slug}`);
  }
  const rows = collapseLegacyChildRepresentations(provider, toRecordArray(await rpc(
    environment, "get_market_radar_children_for_reconciliation_v3", {
    provider_input: provider,
    parent_ids_input: [...new Set(parentIds)],
    external_market_ids_input: [...externalMarketIds],
    condition_ids_input: [...conditionIds],
    token_ids_input: [...tokenIds],
    child_slugs_input: [...childSlugs],
    child_identity_keys_input: [...childIdentityKeys],
    current_request_id_input: validUuid(requestId) ? requestId : null,
    }, undefined, true)));
  const result = new Map<string, JsonRecord[]>(parentIds.map((parentId) => [parentId, []]));
  const seen = new Map<string, Set<string>>(parentIds.map((parentId) => [parentId, new Set()]));
  for (const row of rows) {
    const historicalParent = cleanText(row.provider_parent_id, 220);
    const targets = new Set<string>();
    if (result.has(historicalParent)) targets.add(historicalParent);
    const externalId = cleanText(row.external_market_id, 220);
    const conditionId = cleanText(row.condition_id, 220);
    const rowTokens = providerTokenIds(row.token_ids);
    const rowSlug = cleanText(row.child_slug, 400);
    const rowIdentityKey = cleanText(row.provider_child_identity_key, 500);
    const rowIdentityStrong = rowIdentityKey
      && !rowIdentityKey.startsWith(`${provider}:slug:`);
    const strongRowIdentities = [
      externalId ? `market:${externalId}` : "",
      conditionId ? `condition:${conditionId}` : "",
      ...rowTokens.map((token) => `token:${token}`),
      rowIdentityStrong ? `identity:${rowIdentityKey}` : "",
    ].filter(Boolean);
    const rowIdentities = strongRowIdentities.length
      ? strongRowIdentities : rowSlug ? [`slug:${rowSlug}`] : [];
    for (const identity of rowIdentities) {
      for (const parentId of currentChildParents.get(identity) ?? []) targets.add(parentId);
    }
    const rowOccurrenceIdentity = cleanText(row.child_occurrence_key ?? row.id ?? row.child_fingerprint
      ?? `${historicalParent}:${externalId}:${conditionId}`, 500);
    for (const target of targets) {
      if (seen.get(target)?.has(rowOccurrenceIdentity)) continue;
      seen.get(target)?.add(rowOccurrenceIdentity);
      result.get(target)?.push(row);
    }
  }
  return result;
}

function providerHttpNotFound(error: unknown): boolean {
  return error instanceof Error && /(?:HTTP_404|\b404\b)/.test(error.message);
}

async function verifyMissingHistoricalChild(
  environment: Environment,
  provider: "polymarket" | "kalshi",
  parentId: string,
  previous: JsonRecord,
  checkedAt: string,
): Promise<JsonRecord> {
  const existingEvidence = toRecordArray(previous.identity_evidence ?? previous.source_refs);
  const externalId = cleanText(previous.external_market_id, 220);
  const conditionId = cleanText(previous.condition_id, 220);
  if (!externalId && provider === "polymarket" && conditionId) {
    const clobUrl = new URL(`${POLYMARKET_CLOB_ROOT}/markets/${encodeURIComponent(conditionId)}`);
    try {
      const record = toRecord(await fetchJson(clobUrl, {}, PROVIDER_TIMEOUT_MS, { execution: environment.execution }));
      const bindingValid = Boolean(record && polymarketConditionId(record) === conditionId);
      const closed = Boolean(record && (record.closed === true || record.active === false
        || ["closed", "settled", "finalized"].includes(cleanText(record.status, 80).toLowerCase())));
      const evidence = await providerIdentityEvidence(
        clobUrl, "condition_id", conditionId, record,
        bindingValid && closed ? "provider_closed_child" : "provider_data_conflict", checkedAt,
      );
      return {
        ...previous,
        closed_verified: bindingValid && closed,
        identity_evidence: [...existingEvidence, evidence],
      };
    } catch (error) {
      const removed = providerHttpNotFound(error);
      const evidence = await providerIdentityEvidence(
        clobUrl, "condition_id", conditionId, null,
        removed ? "provider_removed_child" : cleanText((error as Error)?.message, 80), checkedAt,
      );
      return {
        ...previous,
        removed_verified: removed,
        historical_verification_unavailable: !removed,
        identity_evidence: [...existingEvidence, evidence],
      };
    }
  }
  if (!externalId) return previous;
  if (provider === "polymarket") {
    const gammaUrl = new URL(`${POLYMARKET_GAMMA_ROOT}/markets/${encodeURIComponent(externalId)}`);
    try {
      const record = toRecord(await fetchJson(gammaUrl, {}, PROVIDER_TIMEOUT_MS, { execution: environment.execution }));
      let bindingValid = Boolean(record && polymarketDirectChildMatches("gamma", record, previous, parentId));
      const bindingEvidence: JsonRecord[] = [];
      let bindingUnavailable = false;
      if (record && polymarketGammaIdentifiersMatch(record, previous)
        && !polymarketMarketBelongsToParent(record, parentId)) {
        const keyset = await fetchPolymarketKeysetMarket(environment, externalId, checkedAt, parentId);
        bindingEvidence.push(keyset.evidence);
        bindingValid = Boolean(keyset.record
          && polymarketGammaIdentifiersMatch(keyset.record, previous)
          && polymarketMarketBelongsToParent(keyset.record, parentId));
        bindingUnavailable = !["parent_binding_checked", "parent_binding_conflict", "parent_binding_unknown", "provider_not_found"]
          .includes(cleanText(keyset.evidence.result, 80));
      }
      const closed = Boolean(record && (record.closed === true || record.archived === true
        || record.active === false || record.acceptingOrders === false));
      const evidence = await providerIdentityEvidence(
        gammaUrl, "external_market_id", externalId, record,
        bindingValid && closed ? "provider_closed_child" : "provider_data_conflict", checkedAt,
      );
      return {
        ...previous,
        closed_verified: bindingValid && closed,
        historical_verification_unavailable: bindingUnavailable,
        identity_evidence: [...existingEvidence, evidence, ...bindingEvidence],
      };
    } catch (error) {
      const gammaEvidence = await providerIdentityEvidence(
        gammaUrl, "external_market_id", externalId, null,
        providerHttpNotFound(error) ? "provider_removed_child" : cleanText((error as Error)?.message, 80), checkedAt,
      );
      if (!providerHttpNotFound(error)) return {
        ...previous,
        historical_verification_unavailable: true,
        identity_evidence: [...existingEvidence, gammaEvidence],
      };
      if (!conditionId) return {
        ...previous,
        removed_verified: true,
        identity_evidence: [...existingEvidence, gammaEvidence],
      };
      const clobUrl = new URL(`${POLYMARKET_CLOB_ROOT}/markets/${encodeURIComponent(conditionId)}`);
      try {
        const record = toRecord(await fetchJson(clobUrl, {}, PROVIDER_TIMEOUT_MS, { execution: environment.execution }));
        const evidence = await providerIdentityEvidence(
          clobUrl, "condition_id", conditionId, record, "provider_data_conflict", checkedAt,
        );
        return { ...previous, identity_evidence: [...existingEvidence, gammaEvidence, evidence] };
      } catch (clobError) {
        const removed = providerHttpNotFound(clobError);
        const evidence = await providerIdentityEvidence(
          clobUrl, "condition_id", conditionId, null,
          removed ? "provider_removed_child" : cleanText((clobError as Error)?.message, 80), checkedAt,
        );
        return {
          ...previous,
          removed_verified: removed,
          historical_verification_unavailable: !removed,
          identity_evidence: [...existingEvidence, gammaEvidence, evidence],
        };
      }
    }
  }
  const liveUrl = new URL(`${KALSHI_API_ROOT}/markets/${encodeURIComponent(externalId)}`);
  try {
    const payload = toRecord(await fetchJson(liveUrl, {}, PROVIDER_TIMEOUT_MS, { execution: environment.execution })) ?? {};
    const record = toRecord(payload.market) ?? payload;
    const closed = ["closed", "settled", "finalized", "determined"].includes(cleanText(record.status, 80).toLowerCase());
    const sameParent = cleanText(record.event_ticker, 220) === parentId;
    const evidence = await providerIdentityEvidence(
      liveUrl, "market_ticker", externalId, record,
      sameParent && closed ? "provider_closed_child" : "provider_data_conflict", checkedAt,
    );
    return {
      ...previous,
      closed_verified: sameParent && closed,
      identity_evidence: [...existingEvidence, evidence],
    };
  } catch (error) {
    if (!providerHttpNotFound(error)) return {
      ...previous,
      historical_verification_unavailable: true,
      identity_evidence: [...existingEvidence, await providerIdentityEvidence(
        liveUrl, "market_ticker", externalId, null, cleanText((error as Error)?.message, 80), checkedAt,
      )],
    };
  }
  const historicalUrl = new URL(`${KALSHI_API_ROOT}/historical/markets/${encodeURIComponent(externalId)}`);
  try {
    const payload = toRecord(await fetchJson(historicalUrl, {}, PROVIDER_TIMEOUT_MS, { execution: environment.execution })) ?? {};
    const record = toRecord(payload.market) ?? payload;
    const sameParent = cleanText(record.event_ticker, 220) === parentId;
    const evidence = await providerIdentityEvidence(
      historicalUrl, "market_ticker", externalId, record,
      sameParent ? "provider_closed_child" : "provider_data_conflict", checkedAt,
    );
    return { ...previous, closed_verified: sameParent, identity_evidence: [...existingEvidence, evidence] };
  } catch (error) {
    const removed = providerHttpNotFound(error);
    const evidence = await providerIdentityEvidence(
      historicalUrl, "market_ticker", externalId, null,
      removed ? "provider_removed_child" : cleanText((error as Error)?.message, 80), checkedAt,
    );
    return {
      ...previous,
      removed_verified: removed,
      historical_verification_unavailable: !removed,
      identity_evidence: [...existingEvidence, evidence],
    };
  }
}

async function verifyMissingHistoricalChildren(
  environment: Environment,
  provider: "polymarket" | "kalshi",
  parentId: string,
  currentChildren: JsonRecord[],
  previousChildren: JsonRecord[],
  checkedAt: string,
): Promise<JsonRecord[]> {
  const currentExternal = new Set(currentChildren.map((child) => cleanText(child.external_market_id, 220)).filter(Boolean));
  const currentConditions = new Set(currentChildren.map((child) => cleanText(child.condition_id, 220)).filter(Boolean));
  const results = await mapWithConcurrency(previousChildren, KALSHI_CONCURRENCY, async (previous) => {
    const sameExternal = currentExternal.has(cleanText(previous.external_market_id, 220));
    const sameCondition = currentConditions.has(cleanText(previous.condition_id, 220));
    if (sameExternal || sameCondition
      || ["provider_removed_child", "provider_closed_child"].includes(cleanText(previous.identity_classification, 100))) {
      return previous;
    }
    return verifyMissingHistoricalChild(environment, provider, parentId, previous, checkedAt);
  });
  return results.map((result, index) => result.status === "fulfilled" ? result.value : {
    ...previousChildren[index], historical_verification_unavailable: true,
  });
}

function reconciliationParentLabel(event: JsonRecord): string | null {
  const raw = cleanText(event.title ?? event.sub_title, 500);
  if (!raw) return null;
  const presentation = normalizeRadarCandidatePresentation({ source_title: raw }) as JsonRecord;
  return cleanText(presentation.atinara_group_title, 500)
    || localizeRadarProviderLabel(raw).label;
}

async function reconcileCanonicalEvents(
  environment: Environment,
  provider: "polymarket" | "kalshi",
  events: JsonRecord[],
  candidates: JsonRecord[],
  checkedAt: string,
  requestId: string | null = null,
): Promise<ProviderDiscoveryResult> {
  const parentIds = events.map((event) => provider === "polymarket"
    ? cleanText(event.id ?? event.slug, 220)
    : cleanText(event.event_ticker ?? event.ticker, 220)).filter(Boolean);
  const previous = await loadPreviousParentChildren(environment, provider, events, requestId);
  const reconciliations: JsonRecord[] = [];
  for (const event of events) {
    const parentId = provider === "polymarket"
      ? cleanText(event.id ?? event.slug, 220)
      : cleanText(event.event_ticker ?? event.ticker, 220);
    if (!parentId) continue;
    const eventMarkets = toRecordArray(event.markets);
    const parentCandidates = candidates.filter((candidate) =>
      cleanText(candidate.external_event_id ?? candidate.external_event_slug, 220) === parentId);
    const categoricalParent = event.mutually_exclusive === true || event.negRisk === true
      || event.enableNegRisk === true;
    const currentChildren = eventMarkets.map((market) => {
      const marketId = provider === "polymarket"
        ? cleanText(market.id ?? market.conditionId ?? market.slug, 220)
        : cleanText(market.ticker ?? market.market_ticker, 220);
      const conditionId = cleanText(market.conditionId ?? market.condition_id, 220);
      const matchingCandidates = parentCandidates.filter((candidate) => {
        const payload = toRecord(candidate.provider_payload) ?? {};
        return [candidate.external_market_id,candidate.external_id,payload.id,payload.market_id,
          payload.ticker,payload.market_ticker].map((value) => cleanText(value,220))
          .filter(Boolean).includes(marketId)
          || Boolean(conditionId && cleanText(payload.condition_id ?? payload.conditionId,220) === conditionId);
      });
      const adapted = matchingCandidates.length === 1 ? matchingCandidates[0] : null;
      return {
      ...market,
      categorical_parent: categoricalParent,
      provider_parent_id: parentId,
      event_id: parentId,
      external_event_id: parentId,
      external_market_id: marketId,
      condition_id: conditionId || null,
      market_slug: cleanText(market.slug, 400) || null,
      raw_provider_child_label: market._atinara_identity_resolution === true
        ? cleanText(market.raw_provider_child_label ?? market.groupItemTitle ?? market.yes_sub_title, 240) || null
        : cleanText(market.groupItemTitle ?? market.yes_sub_title, 240) || null,
      canonical_child_label: market._atinara_identity_resolution === true
        ? cleanText(market.canonical_child_label, 240) || null : null,
      identity_source: market._atinara_identity_resolution === true
        ? cleanText(market.identity_source, 120) || null : null,
      identity_evidence: market._atinara_identity_resolution === true
        ? toRecordArray(market.identity_evidence) : [],
      identity_resolution_unavailable: market._atinara_identity_resolution === true
        && market.identity_resolution_unavailable === true,
      identity_resolution_conflict: market._atinara_identity_resolution === true
        && market.identity_resolution_conflict === true,
      status: provider === "polymarket"
        ? (market.closed === true || market.archived === true ? "closed"
          : market.active === false || market.acceptingOrders === false ? "inactive" : "open")
        : cleanText(market.status, 80),
      ...(adapted ? {
        source_title: adapted.source_title,
        source_question: adapted.source_question,
        source_description: adapted.source_description,
        source_resolution_rules: adapted.source_resolution_rules,
        source_resolution_url: adapted.source_resolution_url,
        source_close_at: adapted.source_close_at,
        source_resolution_deadline: adapted.source_resolution_deadline,
        source_status: adapted.source_status,
        source_result: adapted.source_result,
        external_event_slug: adapted.external_event_slug,
        external_market_slug: adapted.external_market_slug,
        external_event_url: adapted.external_event_url,
        external_market_url: adapted.external_market_url,
      } : {}),
    };
    });
    const declaredValue = Number(event.provider_declared_child_count);
    const declaredCount = Number.isSafeInteger(declaredValue) && declaredValue >= 0 ? declaredValue : null;
    const atinaraCategory = cleanText(parentCandidates.find((candidate) => candidate.atinara_category)?.atinara_category, 120);
    const horizonAt = parentCandidates.map((candidate) => safeIsoDate(candidate.source_close_at)).filter(Boolean)
      .toSorted(compareUtf16Text)[0] ?? safeIsoDate(event.endDate ?? event.close_time ?? event.latest_expiration_time);
    const sourceRefs = event._atinara_parent_enumeration === true
      ? toRecordArray(event.parent_reconciliation_source_refs) : [];
    const previousChildren = await verifyMissingHistoricalChildren(
      environment, provider, parentId, currentChildren, previous.get(parentId) ?? [], checkedAt,
    );
    const reconciliation = await reconcileProviderParent({
      provider,
      provider_parent_id: parentId,
      raw_provider_parent_label: cleanText(event.title ?? event.sub_title, 500),
      canonical_parent_label: reconciliationParentLabel(event),
      category: atinaraCategory || null,
      raw_provider_category: cleanText(event.category, 120) || null,
      atinara_category: atinaraCategory || null,
      external_parent_url: safePublicUrl(event.external_event_url
        ?? (provider === "polymarket" && event.slug ? `https://polymarket.com/event/${event.slug}` : null)),
      horizon_at: horizonAt,
      provider_declared_child_count: declaredCount,
      provider_pagination_exhausted: event.provider_pagination_exhausted === true,
      provider_unavailable: event.provider_parent_unavailable === true
        || currentChildren.some((child) => child.identity_resolution_unavailable === true)
        || previousChildren.some((child) => child.historical_verification_unavailable === true),
      children: currentChildren,
      previous_children: previousChildren,
      checked_at: checkedAt,
      source_refs: sourceRefs,
    }) as JsonRecord;
    reconciliations.push(reconciliation);
  }
  const byParent = new Map(reconciliations.map((reconciliation) => [
    cleanText(reconciliation.provider_parent_id, 220), reconciliation,
  ]));
  const attachedChildren = new Map<JsonRecord, JsonRecord>();
  for (const reconciliation of reconciliations) {
    const parentId = cleanText(reconciliation.provider_parent_id, 220);
    const parentCandidates = candidates.filter((candidate) =>
      cleanText(candidate.external_event_id ?? candidate.external_event_slug, 220) === parentId);
    const currentChildren = toRecordArray(reconciliation.children)
      .filter((value) => value.present_in_current_snapshot === true);
    const bindings = bindRadarCandidatesToReconciledChildren(parentCandidates, currentChildren);
    parentCandidates.forEach((candidate, index) => {
      const child = toRecord(bindings[index]);
      if (child) attachedChildren.set(candidate, child);
    });
  }
  const attached = candidates.map((candidate) => {
    const parentId = cleanText(candidate.external_event_id ?? candidate.external_event_slug, 220);
    const reconciliation = byParent.get(parentId);
    const child = attachedChildren.get(candidate);
    if (!reconciliation || !child) return {
      ...candidate,
      parent_reconciliation_status: "inconsistent_provider_count",
      parent_reconciliation_version: RADAR_PARENT_RECONCILIATION_VERSION,
      canonical_projection_version: RADAR_CHILD_PROJECTION_VERSION,
      identity_status: "conflict",
      identity_classification: "provider_data_conflict",
    };
    const parentSummary = { ...reconciliation };
    delete parentSummary.children;
    return {
      ...candidate,
      raw_provider_child_label: child.raw_provider_child_label,
      canonical_child_label: child.canonical_child_label,
      canonical_child_key: child.canonical_child_key,
      identity_kind: child.identity_kind,
      identity_classification: child.identity_classification,
      identity_status: child.identity_status,
      identity_source: child.identity_source,
      identity_confidence: child.identity_confidence,
      identity_evidence: child.identity_evidence,
      availability_status: child.availability_status,
      parent_child_occurrence_key: child.child_occurrence_key,
      parent_child_identity_key: child.provider_child_identity_key,
      parent_child_fingerprint: child.child_fingerprint,
      provider_child_contract: child.provider_contract,
      provider_child_contract_hash: child.provider_contract_hash,
      canonical_projection_version: child.projection_version,
      parent_reconciliation_status: reconciliation.reconciliation_status,
      parent_reconciliation_version: reconciliation.reconciliation_version,
      parent_reconciliation_fingerprint: reconciliation.reconciliation_fingerprint,
      provider_declared_child_count: reconciliation.provider_declared_child_count,
      provider_discovered_child_count: reconciliation.provider_discovered_child_count,
      provider_accounted_child_count: reconciliation.provider_accounted_child_count,
      provider_identified_child_count: reconciliation.provider_identified_child_count,
      provider_unresolved_child_count: reconciliation.provider_unresolved_child_count,
      provider_removed_child_count: reconciliation.provider_removed_child_count,
      provider_closed_child_count: reconciliation.provider_closed_child_count,
      provider_duplicate_child_count: reconciliation.provider_duplicate_child_count,
      provider_conflict_child_count: reconciliation.provider_conflict_child_count,
      provider_pagination_exhausted: reconciliation.provider_pagination_exhausted,
      parent_reconciliation: parentSummary,
      provider_payload: {
        ...(toRecord(candidate.provider_payload) ?? {}),
        raw_provider_child_label: child.raw_provider_child_label,
        canonical_child_label: child.canonical_child_label,
        identity_kind: child.identity_kind,
        identity_classification: child.identity_classification,
        identity_status: child.identity_status,
        parent_child_occurrence_key: child.child_occurrence_key,
        parent_child_identity_key: child.provider_child_identity_key,
        parent_child_fingerprint: child.child_fingerprint,
        provider_child_contract: child.provider_contract,
        provider_child_contract_hash: child.provider_contract_hash,
        parent_reconciliation_fingerprint: reconciliation.reconciliation_fingerprint,
      },
    };
  }).filter((candidate) => !["provider_duplicate_child", "provider_data_conflict"]
    .includes(cleanText(candidate.identity_classification, 100)));
  return { candidates: attached, reconciliations };
}

async function attachCanonicalFactContext(
  candidates: JsonRecord[],
  events: JsonRecord[],
  provider: "polymarket" | "kalshi",
): Promise<JsonRecord[]> {
  const contexts = new Map<string, {
    children: JsonRecord[];
    declaredCount: number | null;
    paginationExhausted: boolean;
  }>();
  for (const event of events) {
    const key = provider === "polymarket"
      ? cleanText(event.id ?? event.slug, 220)
      : cleanText(event.event_ticker ?? event.ticker, 220);
    const children = canonicalEventProjection(event, provider);
    if (!key || !children.length || children.length > MAX_CANONICAL_EVENT_CHILDREN) continue;
    const declaredValue = Number(event.provider_declared_child_count);
    contexts.set(key, {
      children,
      declaredCount: Number.isSafeInteger(declaredValue) && declaredValue >= 0 ? declaredValue : null,
      paginationExhausted: event.provider_pagination_exhausted === true,
    });
  }
  const attached: JsonRecord[] = [];
  for (const candidate of candidates) {
    const key = cleanText(candidate.external_event_id ?? candidate.external_event_slug, 220);
    const context = contexts.get(key);
    if (!context) continue;
    const { children, declaredCount, paginationExhausted } = context;
    const providerPayload = toRecord(candidate.provider_payload) ?? {};
    const withContext = {
      ...candidate,
      provider_payload: {
        ...providerPayload,
        fact_context_schema_version: "atinara-radar-fact-context-v2",
        canonical_event_children: children,
        canonical_event_children_total: declaredCount,
        canonical_event_children_complete: paginationExhausted
          && declaredCount !== null && children.length === declaredCount,
        provider_pagination_exhausted: paginationExhausted,
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

function providerMarketStableId(provider: "polymarket" | "kalshi", market: JsonRecord): string {
  return provider === "polymarket"
    ? cleanText(market.id ?? market.conditionId ?? market.condition_id ?? market.slug, 220)
    : cleanText(market.ticker ?? market.market_ticker, 220);
}

function mergeProviderMarketSurfaces(
  provider: "polymarket" | "kalshi",
  surfaces: JsonRecord[][],
): { markets: JsonRecord[]; duplicateConflict: boolean; missingStableIdentity: boolean } {
  const groupedSurfaces: Map<string, JsonRecord[]>[] = [];
  let duplicateConflict = false;
  let missingStableIdentity = false;
  for (const surface of surfaces) {
    const grouped = new Map<string, JsonRecord[]>();
    for (const market of surface) {
      const identity = providerMarketStableId(provider, market);
      if (!identity) {
        missingStableIdentity = true;
        const anonymous = `__unidentified__:${grouped.size}`;
        grouped.set(anonymous, [...(grouped.get(anonymous) ?? []), market]);
        continue;
      }
      grouped.set(identity, [...(grouped.get(identity) ?? []), market]);
    }
    groupedSurfaces.push(grouped);
  }
  const identities = [...new Set(groupedSurfaces.flatMap((surface) => [...surface.keys()]))]
    .toSorted(compareUtf16Text);
  const markets: JsonRecord[] = [];
  for (const identity of identities) {
    const occurrenceCount = Math.max(...groupedSurfaces.map((surface) => surface.get(identity)?.length ?? 0));
    for (let occurrence = 0; occurrence < occurrenceCount; occurrence += 1) {
      const records = groupedSurfaces.flatMap((surface) => {
        const record = surface.get(identity)?.[occurrence];
        return record ? [record] : [];
      });
      const conditions = new Set(records.map((record) => cleanText(record.conditionId ?? record.condition_id, 220)).filter(Boolean));
      const parents = new Set(records.map((record) => cleanText(
        record.event_ticker ?? record.event_id ?? record.eventId, 220,
      )).filter(Boolean));
      const contractualQuestions = new Set(records.map((record) => normalizeComparableText(
        cleanText(record.question ?? record.title, 700),
      )).filter(Boolean));
      const structuredLabels = new Set(records.map((record) => normalizeComparableText(
        cleanText(record.groupItemTitle ?? record.yes_sub_title, 240),
      )).filter(Boolean));
      const slugs = new Set(records.map((record) => cleanText(record.slug, 400)).filter(Boolean));
      const availabilityStates = new Set(records.map((record) => {
        const status = cleanText(record.status, 80).toLowerCase();
        if (record.closed === true || record.archived === true || record.active === false
          || record.acceptingOrders === false
          || ["closed", "settled", "finalized", "determined", "inactive"].includes(status)) return "closed";
        if (record.active === true || record.acceptingOrders === true
          || ["open", "active", "trading", "initialized"].includes(status)) return "open";
        return "";
      }).filter(Boolean));
      const results = new Set(records.map((record) => normalizeProviderResult(
        record.result ?? record.resolutionResult ?? record.winningOutcome,
      )).filter(Boolean));
      const contractualDates = new Set(records.map((record) => safeIsoDate(
        record.endDate ?? record.close_time ?? record.latest_expiration_time,
      )).filter(Boolean));
      const tokenSets = new Set(records.map((record) => providerTokenIds(
        record.clobTokenIds ?? record.token_ids,
      ).toSorted(compareUtf16Text).join("|")));
      const optionSemantics = new Set(records.map((record) => canonicalJson({
        neg_risk_other: typeof record.negRiskOther === "boolean" ? record.negRiskOther : null,
        is_other: typeof record.is_other === "boolean" ? record.is_other : null,
        is_tie: typeof record.is_tie === "boolean" ? record.is_tie : null,
        is_no_winner: typeof record.is_no_winner === "boolean" ? record.is_no_winner : null,
        option_type: cleanText(record.option_type, 80) || null,
      })));
      if (conditions.size > 1 || parents.size > 1 || contractualQuestions.size > 1
        || structuredLabels.size > 1 || slugs.size > 1 || availabilityStates.size > 1
        || results.size > 1 || contractualDates.size > 1 || tokenSets.size > 1
        || optionSemantics.size > 1) duplicateConflict = true;
      markets.push(Object.assign({}, ...records));
    }
  }
  return {
    markets,
    duplicateConflict,
    missingStableIdentity,
  };
}

function sameProviderMarketIdentitySet(
  provider: "polymarket" | "kalshi",
  left: JsonRecord[],
  right: JsonRecord[],
): boolean {
  const identities = (values: JsonRecord[]) => values
    .map((market) => providerMarketStableId(provider, market)).filter(Boolean).toSorted(compareUtf16Text);
  const leftIds = identities(left);
  const rightIds = identities(right);
  return leftIds.length === left.length && rightIds.length === right.length
    && leftIds.length === rightIds.length && leftIds.every((value, index) => value === rightIds[index]);
}

function polymarketParentContractProjection(event: JsonRecord): JsonRecord {
  const nullableBoolean = (value: unknown) => typeof value === "boolean" ? value : null;
  return {
    id: cleanText(event.id, 220) || null,
    slug: cleanText(event.slug, 400) || null,
    title: cleanText(event.title, 700) || null,
    category: cleanText(event.category, 120) || null,
    subcategory: cleanText(event.subcategory, 120) || null,
    resolution_source: safePublicUrl(event.resolutionSource ?? event.resolution_source),
    end_at: safeIsoDate(event.endDate ?? event.end_date),
    active: nullableBoolean(event.active),
    closed: nullableBoolean(event.closed),
    archived: nullableBoolean(event.archived),
    neg_risk: nullableBoolean(event.negRisk),
    enable_neg_risk: nullableBoolean(event.enableNegRisk),
    show_all_outcomes: nullableBoolean(event.showAllOutcomes),
    automatically_active: nullableBoolean(event.automaticallyActive),
    series_slug: cleanText(event.seriesSlug, 220) || null,
    parent_event: cleanText(event.parentEvent, 220) || null,
  };
}

async function enumeratePolymarketEventChildren(
  environment: Environment,
  searchEvent: JsonRecord,
  checkedAt: string,
): Promise<JsonRecord> {
  const parentId = cleanText(searchEvent.id, 220);
  const slug = cleanText(searchEvent.slug, 400);
  if (!parentId || !slug) throw new Error("PROVIDER_PARENT_IDENTITY_INVALID");
  const bySlugUrl = new URL(`${POLYMARKET_GAMMA_ROOT}/events/slug/${encodeURIComponent(slug)}`);
  const byIdUrl = new URL(`${POLYMARKET_GAMMA_ROOT}/events/${encodeURIComponent(parentId)}`);
  const refs: JsonRecord[] = [];
  let bySlug: JsonRecord | null = null;
  let byId: JsonRecord | null = null;
  try {
    bySlug = toRecord(await fetchJson(bySlugUrl, {}, PROVIDER_TIMEOUT_MS, { execution: environment.execution }));
    refs.push(await providerIdentityEvidence(
      bySlugUrl, "event_slug", slug, bySlug,
      bySlug ? "parent_children_enumerated" : "provider_invalid_response", checkedAt,
    ));
  } catch (error) {
    refs.push(await providerIdentityEvidence(
      bySlugUrl, "event_slug", slug, null,
      error instanceof Error ? cleanText(error.message, 80) : "provider_unavailable", checkedAt,
    ));
  }
  try {
    byId = toRecord(await fetchJson(byIdUrl, {}, PROVIDER_TIMEOUT_MS, { execution: environment.execution }));
    refs.push(await providerIdentityEvidence(
      byIdUrl, "event_id", parentId, byId,
      byId ? "parent_children_enumerated" : "provider_invalid_response", checkedAt,
    ));
  } catch (error) {
    refs.push(await providerIdentityEvidence(
      byIdUrl, "event_id", parentId, null,
      error instanceof Error ? cleanText(error.message, 80) : "provider_unavailable", checkedAt,
    ));
  }
  const slugIdentityValid = Boolean(bySlug
    && cleanText(bySlug.id, 220) === parentId && cleanText(bySlug.slug, 400) === slug);
  const idIdentityValid = Boolean(byId
    && cleanText(byId.id, 220) === parentId && cleanText(byId.slug, 400) === slug);
  const slugMarkets = slugIdentityValid ? toRecordArray(bySlug?.markets) : [];
  const idMarkets = idIdentityValid ? toRecordArray(byId?.markets) : [];
  const merged = mergeProviderMarketSurfaces("polymarket", [slugMarkets, idMarkets]);
  const parentContractAgreement = slugIdentityValid && idIdentityValid
    && canonicalJson(polymarketParentContractProjection(bySlug ?? {}))
      === canonicalJson(polymarketParentContractProjection(byId ?? {}));
  const exactAgreement = slugIdentityValid && idIdentityValid
    && sameProviderMarketIdentitySet("polymarket", slugMarkets, idMarkets)
    && parentContractAgreement && !merged.duplicateConflict && !merged.missingStableIdentity;
  if (slugIdentityValid && idIdentityValid && !parentContractAgreement) {
    refs.push(await providerIdentityEvidence(
      byIdUrl, "event_id", parentId, byId,
      "parent_metadata_conflict", checkedAt,
    ));
  }
  const publicUrl = await verifyPublicUrl(
    `https://polymarket.com/event/${slug}`, "polymarket.com", environment.execution,
  );
  return {
    ...(byId ?? bySlug ?? searchEvent),
    id: parentId,
    slug,
    markets: merged.markets,
    external_event_url: publicUrl,
    canonical_url_verified: Boolean(publicUrl),
    provider_declared_child_count: exactAgreement ? merged.markets.length : null,
    provider_pagination_exhausted: exactAgreement,
    provider_parent_unavailable: !bySlug || !byId,
    parent_reconciliation_source_refs: refs,
    _atinara_parent_enumeration: true,
  };
}

function providerParentIdentity(event: JsonRecord): string {
  return cleanText(event.id ?? event.event_ticker ?? event.ticker ?? event.slug, 220);
}

function mergeIndexedProviderSelection(
  indexedSelection: JsonRecord,
  materializedSelection: JsonRecord,
  failedParentIds: string[] = [],
): JsonRecord {
  const selectedIds = new Set(
    Array.isArray(materializedSelection.selected_parent_ids)
      ? materializedSelection.selected_parent_ids.map((value) => cleanText(value, 220)).filter(Boolean)
      : [],
  );
  const deferredIds = new Set<string>([
    ...(Array.isArray(materializedSelection.deferred_parent_ids)
      ? materializedSelection.deferred_parent_ids : []),
    ...failedParentIds,
  ].map((value) => cleanText(value, 220)).filter(Boolean));
  for (const identity of Array.isArray(indexedSelection.selected_parent_ids)
    ? indexedSelection.selected_parent_ids : []) {
    const normalized = cleanText(identity, 220);
    if (normalized && !selectedIds.has(normalized)) deferredIds.add(normalized);
  }
  const materialized = {
    ...materializedSelection,
    total_parent_count: selectedIds.size + deferredIds.size,
    selected_parent_count: selectedIds.size,
    deferred_parent_count: deferredIds.size,
    no_parent_truncated: true,
    selected_parent_ids: [...selectedIds],
    deferred_parent_ids: [...deferredIds],
  };
  return mergeProviderParentSelections(indexedSelection, materialized);
}

function projectProviderSelectionForResponse(value: JsonRecord): JsonRecord {
  const selectedIds = Array.isArray(value.selected_parent_ids)
    ? value.selected_parent_ids.map((identity) => cleanText(identity, 220)).filter(Boolean) : [];
  const deferredIds = Array.isArray(value.deferred_parent_ids)
    ? value.deferred_parent_ids.map((identity) => cleanText(identity, 220)).filter(Boolean) : [];
  const projected = { ...value };
  delete projected.selected_parent_ids;
  delete projected.deferred_parent_ids;
  return {
    ...projected,
    provider_selection_ledger_complete: selectedIds.length === Number(value.selected_parent_count)
      && deferredIds.length === Number(value.deferred_parent_count),
    parent_identity_sample_limit: 8,
    selected_parent_id_sample: selectedIds.slice(0, 8),
    deferred_parent_id_sample: deferredIds.slice(0, 8),
  };
}

const POLYMARKET_CATEGORY_QUERIES: Readonly<Record<string, string>> = Object.freeze({
  Lanzamientos: "video game release delay",
  Eventos: "gaming event game awards",
  Industria: "video game studio publisher",
  Streamers: "gaming streamer Twitch",
  "Reviews/Premios": "video game Metacritic Game Awards",
  YouTubers: "gaming YouTube creator",
});

function polymarketDiscoveryQueries(filters: ReturnType<typeof safeFilters>): JsonRecord[] {
  if (filters.query) return [{ category: filters.category || null, query: filters.query }];
  if (filters.category) return [{ category: filters.category, query: POLYMARKET_CATEGORY_QUERIES[filters.category] }];
  return RADAR_CATEGORIES.map((category) => ({
    category,
    query: POLYMARKET_CATEGORY_QUERIES[category],
  }));
}

async function searchPolymarketParents(
  environment: Environment,
  query: string,
): Promise<JsonRecord[]> {
  const searchUrl = new URL(`${POLYMARKET_GAMMA_ROOT}/public-search`);
  searchUrl.searchParams.set("q", query);
  searchUrl.searchParams.set("events_status", "active");
  searchUrl.searchParams.set("limit_per_type", "80");
  searchUrl.searchParams.set("keep_closed_markets", "0");
  searchUrl.searchParams.set("search_profiles", "false");
  const rawEvents: JsonRecord[] = [];
  const seenEventIds = new Set<string>();
  for (let page = 1; page <= MAX_PROVIDER_PAGES; page += 1) {
    const pageUrl = new URL(searchUrl);
    pageUrl.searchParams.set("page", String(page));
    const payload = toRecord(await fetchJson(
      pageUrl, {}, PROVIDER_TIMEOUT_MS, { execution: environment.execution },
    )) ?? {};
    const pageEvents = toRecordArray(payload.events);
    const pagination = toRecord(payload.pagination) ?? {};
    const totalValue = Number(
      pagination.totalResults ?? pagination.total_results
        ?? payload.total ?? payload.total_events ?? payload.events_count,
    );
    const hasMoreValue = pagination.hasMore ?? pagination.has_more
      ?? payload.has_more ?? payload.hasMore;
    if (!pageEvents.length) {
      if (hasMoreValue === true
        || (Number.isSafeInteger(totalValue) && totalValue > rawEvents.length)) {
        throw new Error("PROVIDER_PAGE_LOST");
      }
      break;
    }
    let newEventCount = 0;
    for (const event of pageEvents) {
      const identity = providerParentIdentity(event);
      if (!identity || seenEventIds.has(identity)) continue;
      seenEventIds.add(identity);
      rawEvents.push(event);
      newEventCount += 1;
    }
    if (!newEventCount) throw new Error("PROVIDER_CURSOR_REPEATED");
    const totalKnown = Number.isSafeInteger(totalValue) && totalValue >= 0;
    const totalReached = totalKnown && rawEvents.length === totalValue;
    const explicitTerminalPage = (Object.hasOwn(payload, "next_page") && payload.next_page === null)
      || (Object.hasOwn(payload, "nextPage") && payload.nextPage === null);
    if ((totalKnown && rawEvents.length > totalValue)
      || (hasMoreValue === true && (totalReached || explicitTerminalPage))
      || (hasMoreValue === false && totalKnown && !totalReached)
      || (explicitTerminalPage && totalKnown && !totalReached)) {
      throw new Error("PROVIDER_DATA_CONFLICT");
    }
    const paginationMetadataPresent = Object.keys(pagination).length > 0
      || hasMoreValue !== undefined || totalKnown;
    if ((hasMoreValue === false || explicitTerminalPage || totalReached)
      || (!paginationMetadataPresent && pageEvents.length < 80)) break;
    if (page === MAX_PROVIDER_PAGES) throw new Error("PROVIDER_PAGINATION_INCOMPLETE");
  }
  return rawEvents;
}

async function discoverPolymarket(
  environment: Environment,
  now: string,
  filters: ReturnType<typeof safeFilters>,
  requestId: string,
) {
  const searches = polymarketDiscoveryQueries(filters);
  const searchResults = await mapWithConcurrency(
    searches,
    KALSHI_CONCURRENCY,
    async (descriptor) => ({
      descriptor,
      events: await searchPolymarketParents(environment, cleanText(descriptor.query, 200)),
    }),
  );
  const eventsByIdentity = new Map<string, JsonRecord>();
  const failedSearchCategories: string[] = [];
  for (let index = 0; index < searchResults.length; index += 1) {
    const result = searchResults[index];
    if (result.status === "rejected") {
      failedSearchCategories.push(cleanText(searches[index].category, 80) || "query");
      continue;
    }
    const category = cleanText(result.value.descriptor.category, 80);
    for (const event of result.value.events) {
      const identity = providerParentIdentity(event);
      if (!identity) continue;
      const current = eventsByIdentity.get(identity);
      const categories = new Set([
        ...(Array.isArray(current?._atinara_search_categories)
          ? current._atinara_search_categories : []),
        category,
      ].map((value) => cleanText(value, 80)).filter(Boolean));
      eventsByIdentity.set(identity, {
        ...(current ?? event),
        _atinara_search_categories: [...categories],
      });
    }
  }
  const rawEvents = [...eventsByIdentity.values()];
  if (!rawEvents.length && failedSearchCategories.length) throw new Error("PROVIDER_UNAVAILABLE");
  const indexedScope = selectWholeProviderParents(rawEvents, {
    maxChildren: MAX_PROVIDER_MATERIALIZED_CHILDREN,
    maxParents: MAX_PROVIDER_ENUMERATION_PARENTS,
    maxTotalParents: MAX_PROVIDER_INDEX_PARENTS,
    countChildren: false,
  });
  const validationResults = await mapWithConcurrency(
    indexedScope.selected, KALSHI_CONCURRENCY,
    async (searchEvent): Promise<JsonRecord> => enumeratePolymarketEventChildren(environment, searchEvent, now),
  );
  const validatedEvents: JsonRecord[] = [];
  const failedParentIds: string[] = [];
  for (let index = 0; index < validationResults.length; index += 1) {
    const result = validationResults[index];
    if (result.status === "rejected") {
      failedParentIds.push(providerParentIdentity(indexedScope.selected[index]));
      continue;
    }
    if (result.status === "fulfilled" && result.value) validatedEvents.push(result.value);
  }
  const childScope = selectWholeProviderParents(
    validatedEvents, {
      maxChildren: MAX_PROVIDER_MATERIALIZED_CHILDREN,
      maxParents: MAX_PROVIDER_MATERIALIZED_PARENTS,
      maxTotalParents: MAX_PROVIDER_ENUMERATION_PARENTS,
    },
  );
  const identityResults = await mapWithConcurrency(
    childScope.selected,
    KALSHI_CONCURRENCY,
    async (event): Promise<JsonRecord> => resolvePolymarketEventIdentities(environment, event, now),
  );
  const resolvedEvents: JsonRecord[] = [];
  for (let index = 0; index < identityResults.length; index += 1) {
    const result = identityResults[index];
    if (result.status === "rejected") {
      failedParentIds.push(providerParentIdentity(childScope.selected[index]));
      continue;
    }
    resolvedEvents.push(result.value);
  }
  if (!resolvedEvents.length && indexedScope.selected.length) throw new Error("PROVIDER_UNAVAILABLE");
  const materializedScope = selectWholeProviderParents(resolvedEvents, {
    maxChildren: MAX_PROVIDER_MATERIALIZED_CHILDREN,
    maxParents: MAX_PROVIDER_MATERIALIZED_PARENTS,
    maxTotalParents: MAX_PROVIDER_ENUMERATION_PARENTS,
  });
  const selection = mergeIndexedProviderSelection(
    indexedScope.selection,
    materializedScope.selection,
    failedParentIds,
  );
  const adapted = adaptPolymarketResponse(
    { events: materializedScope.selected }, { now, cacheMinutes: 20 },
  ) as JsonRecord[];
  const contextual = await attachCanonicalFactContext(adapted, materializedScope.selected, "polymarket");
  const reconciled = await reconcileCanonicalEvents(
    environment, "polymarket", materializedScope.selected, contextual, now, requestId,
  );
  return {
    ...reconciled,
    selection: {
      ...selection,
      total_search_count: searches.length,
      completed_search_count: searches.length - failedSearchCategories.length,
      failed_search_count: failedSearchCategories.length,
      failed_search_categories: failedSearchCategories,
      provider_scope_partial: failedSearchCategories.length > 0 || failedParentIds.length > 0,
      failed_parent_count: failedParentIds.length,
      failed_parent_ids: [...new Set(failedParentIds)],
    },
  };
}

type KalshiTaxonomyScope = { category: string; tag: string };

const KALSHI_TAXONOMY_SCOPES: ReadonlyArray<KalshiTaxonomyScope> = Object.freeze([
  Object.freeze({ category: "Entertainment", tag: "Video games" }),
  Object.freeze({ category: "Sports", tag: "Esports" }),
]);

function taxonomyValues(payload: unknown): KalshiTaxonomyScope[] {
  const root = toRecord(payload) ?? {};
  const mapping = toRecord(root.tags_by_categories);
  const discovered: KalshiTaxonomyScope[] = [];
  if (mapping) {
    for (const [category, rawTags] of Object.entries(mapping)) {
      const tags = Array.isArray(rawTags) ? rawTags : [];
      for (const rawTag of tags) {
        const tag = cleanText(rawTag, 160);
        if ((category.toLowerCase() === "entertainment" && /^video games?$/i.test(tag))
          || (category.toLowerCase() === "sports" && /^esports?$/i.test(tag))) {
          discovered.push({ category, tag });
        }
      }
    }
  }
  const categories = toRecordArray(root.categories ?? root.data);
  for (const categoryItem of categories) {
    const category = cleanText(categoryItem.name ?? categoryItem.category, 160);
    const tags = Array.isArray(categoryItem.tags) ? categoryItem.tags : [];
    for (const tagItem of tags) {
      const tag = cleanText(isRecord(tagItem) ? tagItem.name ?? tagItem.tag : tagItem, 160);
      if ((category.toLowerCase() === "entertainment" && /^video games?$/i.test(tag))
        || (category.toLowerCase() === "sports" && /^esports?$/i.test(tag))) {
        discovered.push({ category, tag });
      }
    }
  }
  const byIdentity = new Map(discovered.map((scope) => [
    `${scope.category.toLowerCase()}:${scope.tag.toLowerCase()}`,
    scope,
  ]));
  return [...byIdentity.values()];
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

async function kalshiTaxonomy(environment: Environment): Promise<KalshiTaxonomyScope[]> {
  const taxonomyUrl = new URL(`${KALSHI_API_ROOT}/search/tags_by_categories`);
  try {
    const scopes = taxonomyValues(await fetchJson(
      taxonomyUrl, {}, PROVIDER_TIMEOUT_MS, { execution: environment.execution },
    ));
    return scopes.length ? scopes : [...KALSHI_TAXONOMY_SCOPES];
  } catch {
    return [...KALSHI_TAXONOMY_SCOPES];
  }
}

function compactKalshiSeriesCheckpoint(
  series: JsonRecord,
  scopes: KalshiTaxonomyScope[],
  classification: ReturnType<typeof classifyKalshiRadarSeriesCatalogV2> | null = null,
): JsonRecord {
  const title = cleanText(series.title ?? series.name, 400);
  return {
    ticker: cleanText(series.ticker, 120),
    title,
    category: cleanText(series.category, 160),
    tags: Array.isArray(series.tags)
      ? series.tags.map((tag) => cleanText(tag, 100)).filter(Boolean).slice(0, 30) : [],
    taxonomy_scopes: scopes.map((scope) => ({ category: scope.category, tag: scope.tag })),
    catalog_signals: classification?.signals ?? [],
    catalog_entity_matches: classification?.catalog_entity_matches ?? [],
    radar_themes: classification?.radar_themes ?? [],
    inferred_atinara_category: classification?.inferred_atinara_category
      ?? inferAtinaraCategory(title, series.tags),
    series_slug: slugify(title),
    settlement_sources: toRecordArray(series.settlement_sources).map((source) => ({
      name: cleanText(source.name, 200) || null,
      url: safePublicUrl(source.url),
    })).filter((source) => source.url),
    volume_fp: cleanText(series.volume_fp ?? series.volume, 80) || null,
    last_updated_ts: safeIsoDate(series.last_updated_ts),
  };
}

function compactKalshiEventCheckpoint(event: JsonRecord): JsonRecord | null {
  const eventTicker = cleanText(event.event_ticker ?? event.ticker, 160);
  const seriesTicker = cleanText(event.series_ticker, 120);
  if (!eventTicker || !seriesTicker) return null;
  return {
    event_ticker: eventTicker,
    series_ticker: seriesTicker,
    title: cleanText(event.title, 500),
    sub_title: cleanText(event.sub_title ?? event.subtitle, 500) || null,
    category: cleanText(event.category, 160) || null,
    strike_date: safeIsoDate(event.strike_date),
    strike_period: cleanText(event.strike_period, 160) || null,
    mutually_exclusive: event.mutually_exclusive === true,
    available_on_brokers: event.available_on_brokers === true,
    last_updated_ts: safeIsoDate(event.last_updated_ts),
  };
}

async function fetchOpenKalshiSeriesEvents(
  environment: Environment,
  ticker: string,
  options: { maxAttempts?: number } = {},
): Promise<JsonRecord[]> {
  const minimumClose = Math.floor(Date.now() / 1000);
  const eventCollection = await collectProviderCursorPages(async (cursor) => {
    const eventsUrl = new URL(`${KALSHI_API_ROOT}/events`);
    eventsUrl.searchParams.set("series_ticker", ticker);
    eventsUrl.searchParams.set("status", "open");
    eventsUrl.searchParams.set("with_nested_markets", "false");
    eventsUrl.searchParams.set("min_close_ts", String(minimumClose));
    eventsUrl.searchParams.set("limit", "200");
    if (cursor) eventsUrl.searchParams.set("cursor", cursor);
    return toRecord(await fetchJson(
      eventsUrl,
      {},
      PROVIDER_TIMEOUT_MS,
      { execution: environment.execution, maxAttempts: options.maxAttempts },
    )) ?? {};
  }, { itemsField: "events", cursorField: "cursor", maxPages: MAX_PROVIDER_PAGES });
  return eventCollection.items.map(compactKalshiEventCheckpoint).filter(Boolean) as JsonRecord[];
}

async function fetchKalshiTaxonomyScopeSeries(
  environment: Environment,
  scope: KalshiTaxonomyScope,
): Promise<{ scope: KalshiTaxonomyScope; series: JsonRecord[] }> {
  const seriesUrl = new URL(`${KALSHI_API_ROOT}/series`);
  seriesUrl.searchParams.set("category", scope.category);
  seriesUrl.searchParams.set("tags", scope.tag);
  seriesUrl.searchParams.set("include_volume", "true");
  seriesUrl.searchParams.set("include_product_metadata", "true");
  seriesUrl.searchParams.set("limit", "200");
  const collection = await collectProviderCursorPages(async (cursor) => {
    const pageUrl = new URL(seriesUrl);
    if (cursor) pageUrl.searchParams.set("cursor", cursor);
    return toRecord(await fetchJson(
      pageUrl, {}, PROVIDER_TIMEOUT_MS, { execution: environment.execution },
    )) ?? {};
  }, { itemsField: "series", cursorField: "cursor", maxPages: MAX_PROVIDER_PAGES });
  return { scope, series: collection.items };
}

async function buildKalshiProviderDiscoveryCheckpoint(
  environment: Environment,
  now: string,
): Promise<JsonRecord> {
  const scopes = await kalshiTaxonomy(environment);
  const scopedSeriesResults = await mapWithConcurrency(
    scopes,
    KALSHI_CONCURRENCY,
    async (scope) => fetchKalshiTaxonomyScopeSeries(environment, scope),
  );
  const taxonomyMerge = mergeProviderTaxonomySeriesV1(scopedSeriesResults, scopes) as {
    entries: Array<{ source: JsonRecord; scopes: KalshiTaxonomyScope[] }>;
    failed_scopes: KalshiTaxonomyScope[];
  };
  const mergedSeries = taxonomyMerge.entries;
  if (!mergedSeries.length && !taxonomyMerge.failed_scopes.length) {
    throw new Error("PROVIDER_INVALID_RESPONSE");
  }
  const orderedSeries = mergedSeries
    .sort((left, right) => seriesPriority(right.source) - seriesPriority(left.source));
  if (orderedSeries.length > MAX_KALSHI_SERIES) throw new Error("PROVIDER_SERIES_SCOPE_LIMIT_EXCEEDED");
  const series = orderedSeries.map(({ source, scopes: itemScopes }) =>
    compactKalshiSeriesCheckpoint(source, itemScopes));
  const eventResults = await mapWithConcurrency(
    series,
    KALSHI_CONCURRENCY,
    async (seriesItem) => fetchOpenKalshiSeriesEvents(
      environment,
      cleanText(seriesItem.ticker, 120),
    ),
  );
  return buildProviderDiscoveryCheckpointV1({
    schema_version: PROVIDER_DISCOVERY_CHECKPOINT_VERSION,
    checked_at: now,
    taxonomy_scopes: scopes,
    failed_taxonomy_scopes: taxonomyMerge.failed_scopes,
    series,
    event_results: eventResults,
    max_series: MAX_KALSHI_SERIES,
    max_parents: MAX_PROVIDER_INDEX_PARENTS,
    max_bytes: 2_000_000,
  }) as JsonRecord;
}

function kalshiCatalogFingerprintProjection(series: JsonRecord): JsonRecord {
  const productMetadata = toRecord(series.product_metadata);
  const importantInfo = toRecord(productMetadata?.important_info);
  const settlementSources = toRecordArray(series.settlement_sources).map((source) => ({
    name: cleanText(source.name, 200) || null,
    url: cleanText(source.url, 2_048) || null,
  })).filter((source) => source.url).sort((left, right) => {
    const leftIdentity = `${left.url}\u0000${left.name ?? ""}`;
    const rightIdentity = `${right.url}\u0000${right.name ?? ""}`;
    return leftIdentity < rightIdentity ? -1 : leftIdentity > rightIdentity ? 1 : 0;
  });
  return {
    ticker: cleanText(series.ticker, 120),
    title: cleanText(series.title ?? series.name, 400),
    category: cleanText(series.category, 160),
    tags: (Array.isArray(series.tags) ? series.tags : [])
      .map((tag) => cleanText(tag, 100)).filter(Boolean).sort(),
    product_scope: cleanText(productMetadata?.scope, 1_000) || null,
    product_important_info: importantInfo ? {
      title: cleanText(importantInfo.title, 500) || null,
      message: cleanText(importantInfo.message, 2_000) || null,
      markdown: cleanText(importantInfo.markdown, 4_000) || null,
    } : null,
    settlement_sources: settlementSources,
    volume_fp: cleanText(series.volume_fp ?? series.volume, 80) || null,
    last_updated_ts: safeIsoDate(series.last_updated_ts),
  };
}

async function buildKalshiProviderDiscoveryCheckpointV2(
  environment: Environment,
  now: string,
): Promise<JsonRecord> {
  const seriesUrl = new URL(`${KALSHI_API_ROOT}/series`);
  seriesUrl.searchParams.set("include_product_metadata", "true");
  seriesUrl.searchParams.set("include_volume", "true");
  const payload = toRecord(await fetchJson(
    seriesUrl,
    {},
    PROVIDER_TIMEOUT_MS,
    {
      execution: environment.execution,
      maxResponseBytes: MAX_KALSHI_CATALOG_RESPONSE_BYTES,
    },
  )) ?? {};
  const rawSeries = toRecordArray(payload.series);
  const providerCursor = cleanText(payload.cursor, 500);
  if (!rawSeries.length) throw new Error("PROVIDER_INVALID_RESPONSE");
  if (providerCursor) throw new Error("PROVIDER_PAGINATION_INCOMPLETE");
  if (rawSeries.length > 100_000) throw new Error("PROVIDER_SERIES_SCOPE_LIMIT_EXCEEDED");
  const projectionByTicker = new Map<string, JsonRecord>();
  const catalogEntityTerms = buildKalshiRadarCatalogEntityTermsV2(rawSeries);
  const entityTermsHash = await sha256Hex({
    policy_version: KALSHI_RADAR_CATALOG_ENTITY_POLICY_VERSION,
    terms: catalogEntityTerms,
  });
  const selected: Array<{
    source: JsonRecord;
    scopes: KalshiTaxonomyScope[];
    classification: ReturnType<typeof classifyKalshiRadarSeriesCatalogV2>;
  }> = [];
  for (const source of rawSeries) {
    const projection = kalshiCatalogFingerprintProjection(source);
    const ticker = cleanText(projection.ticker, 120);
    if (!ticker || projectionByTicker.has(ticker)) {
      throw new Error("PROVIDER_DISCOVERY_SERIES_IDENTITY_INVALID");
    }
    projectionByTicker.set(ticker, projection);
    const classification = classifyKalshiRadarSeriesCatalogV2(source, {
      catalog_entity_terms: catalogEntityTerms,
    });
    if (!classification.selected) continue;
    const category = cleanText(source.category, 160);
    const scopes = (Array.isArray(source.tags) ? source.tags : [])
      .map((tag) => cleanText(tag, 160))
      .filter((tag) => /^(?:video games?|esports?)$/i.test(tag))
      .map((tag) => ({ category, tag }));
    selected.push({ source, scopes, classification });
  }
  selected.sort((left, right) => {
    const priority = seriesPriority(right.source) - seriesPriority(left.source);
    if (priority) return priority;
    const leftTicker = cleanText(left.source.ticker, 120);
    const rightTicker = cleanText(right.source.ticker, 120);
    return leftTicker < rightTicker ? -1 : leftTicker > rightTicker ? 1 : 0;
  });
  if (!selected.length) throw new Error("PROVIDER_INVALID_RESPONSE");
  if (selected.length > MAX_KALSHI_SERIES) throw new Error("PROVIDER_SERIES_SCOPE_LIMIT_EXCEEDED");
  const catalogProjection = [...projectionByTicker.values()]
    .sort((left, right) => cleanText(left.ticker, 120) < cleanText(right.ticker, 120) ? -1
      : cleanText(left.ticker, 120) > cleanText(right.ticker, 120) ? 1 : 0);
  const providerCatalogHash = await sha256Hex({
    projection_version: "atinara-kalshi-series-catalog-projection-v1",
    entity_policy_version: KALSHI_RADAR_CATALOG_ENTITY_POLICY_VERSION,
    entity_terms_hash: entityTermsHash,
    series: catalogProjection,
  });
  const compactSeries = selected.map(({ source, scopes, classification }) =>
    compactKalshiSeriesCheckpoint(source, scopes, classification));
  return buildProviderDiscoveryCheckpointV2({
    checked_at: now,
    catalog: {
      provider_catalog_hash: providerCatalogHash,
      entity_terms_hash: entityTermsHash,
      entity_term_count: catalogEntityTerms.length,
      total_provider_series_count: rawSeries.length,
      provider_pagination_exhausted: true,
      provider_cursor: null,
    },
    series: compactSeries,
    max_series: MAX_KALSHI_SERIES,
    max_parents: MAX_PROVIDER_INDEX_PARENTS,
    max_attempts: MAX_PROVIDER_DISCOVERY_SERIES_ATTEMPTS,
    max_bytes: 4_000_000,
  }) as JsonRecord;
}

function validatedKalshiDiscoveryCheckpointV2(value: unknown): {
  checkpoint: JsonRecord;
  checkpointHash: string;
  state: ReturnType<typeof providerDiscoveryCheckpointV2State>;
} | null {
  const wrapper = toRecord(value);
  const checkpoint = toRecord(wrapper?.checkpoint);
  const checkpointHash = cleanText(wrapper?.checkpoint_hash, 80);
  if (!checkpoint
      || cleanText(checkpoint.schema_version, 100) !== RADAR_PROVIDER_DISCOVERY_CHECKPOINT_V2
      || !/^[a-f0-9]{64}$/.test(checkpointHash)) return null;
  try {
    const state = providerDiscoveryCheckpointV2State(checkpoint, {
      max_series: MAX_KALSHI_SERIES,
      max_parents: MAX_PROVIDER_INDEX_PARENTS,
      max_attempts: MAX_PROVIDER_DISCOVERY_SERIES_ATTEMPTS,
      max_bytes: 4_000_000,
    });
    if (Number(wrapper?.sequence) !== state.sequence) return null;
    return { checkpoint, checkpointHash, state };
  } catch {
    return null;
  }
}

async function collectKalshiProviderDiscoveryBatch(
  environment: Environment,
  durable: NonNullable<ReturnType<typeof validatedKalshiDiscoveryCheckpointV2>>,
): Promise<{ batchResults: JsonRecord[]; retryAfterAt: string | null }> {
  const resultBySeries = new Map(durable.state.results.map((result) => [
    cleanText(result.series_ticker, 120),
    result,
  ]));
  const pendingSeriesIds = durable.state.pending_series_ids
    .map((ticker: unknown) => cleanText(ticker, 120)).filter(Boolean);
  const retryableFailedSeriesIds = durable.state.retryable_failed_series_ids
    .map((ticker: unknown) => cleanText(ticker, 120)).filter(Boolean);
  const nowMs = Date.now();
  const retryableNow = retryableFailedSeriesIds.filter((ticker: string) => {
    const retryAfterAt = Date.parse(cleanText(resultBySeries.get(ticker)?.retry_after_at, 100));
    return !Number.isFinite(retryAfterAt) || retryAfterAt <= nowMs;
  });
  const targets = [
    ...pendingSeriesIds,
    ...retryableNow,
  ].slice(0, MAX_PROVIDER_DISCOVERY_SERIES_BATCH);
  if (!targets.length) {
    const retryAfterValues = retryableFailedSeriesIds
      .map((ticker: string) => Date.parse(cleanText(resultBySeries.get(ticker)?.retry_after_at, 100)))
      .filter((value: number) => Number.isFinite(value) && value > nowMs);
    return {
      batchResults: [],
      retryAfterAt: retryAfterValues.length
        ? new Date(Math.min(...retryAfterValues)).toISOString() : null,
    };
  }
  return withRadarProviderDiscoveryBudget(environment, async (boundedEnvironment) => {
    const output: Array<{ index: number; result: JsonRecord }> = [];
    let cursor = 0;
    async function run() {
      while (true) {
        if (Date.now() >= boundedEnvironment.execution.absoluteDeadlineAt
            - FINALIZATION_RESERVE_MS - 1_000) return;
        const index = cursor;
        if (index >= targets.length) return;
        cursor += 1;
        const seriesTicker = targets[index];
        try {
          const events = await fetchOpenKalshiSeriesEvents(
            boundedEnvironment,
            seriesTicker,
            { maxAttempts: 1 },
          );
          output.push({
            index,
            result: {
              series_ticker: seriesTicker,
              status: "fulfilled",
              checked_at: new Date().toISOString(),
              events,
            },
          });
        } catch (error) {
          // El deadline del lote no es un fallo de esta serie. La identidad
          // queda pendiente y la siguiente invocación retoma exactamente aquí,
          // sin consumir un intento artificial ni degradar el alcance sano.
          if (boundedEnvironment.execution.signal.aborted
              || Date.now() >= boundedEnvironment.execution.absoluteDeadlineAt
                - FINALIZATION_RESERVE_MS - 1_000) return;
          const failure = providerFailure(error, "kalshi");
          output.push({
            index,
            result: {
              series_ticker: seriesTicker,
              status: "rejected",
              checked_at: new Date().toISOString(),
              error_code: cleanText(failure.code, 100) || "PROVIDER_UNAVAILABLE",
              retry_after_at: safeIsoDate(failure.retry_after_at),
              events: [],
            },
          });
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(KALSHI_CONCURRENCY, targets.length) }, run));
    return {
      batchResults: output.sort((left, right) => left.index - right.index).map(({ result }) => result),
      retryAfterAt: null,
    };
  });
}

function validatedKalshiDiscoveryCheckpoint(value: unknown): JsonRecord | null {
  const wrapper = toRecord(value);
  const checkpoint = toRecord(wrapper?.checkpoint);
  if (!checkpoint
    || cleanText(checkpoint.schema_version, 100) !== PROVIDER_DISCOVERY_CHECKPOINT_VERSION
    || !Array.isArray(checkpoint.series)
    || !Array.isArray(checkpoint.events)
    || !Array.isArray(checkpoint.failed_series_ids)
    || !Array.isArray(checkpoint.taxonomy_scopes)
    || !Array.isArray(checkpoint.failed_taxonomy_scopes)
    || Number(checkpoint.total_taxonomy_scope_count) !== checkpoint.taxonomy_scopes.length
    || Number(checkpoint.failed_taxonomy_scope_count) !== checkpoint.failed_taxonomy_scopes.length
    || Number(checkpoint.total_series_count) !== checkpoint.series.length
    || Number(checkpoint.total_parent_count) !== checkpoint.events.length) return null;
  return checkpoint;
}

function kalshiCheckpointSeriesContext(series: JsonRecord): JsonRecord {
  const taxonomyScopes = toRecordArray(series.taxonomy_scopes);
  return {
    category: cleanText(series.category, 120),
    tags: [...new Set([
      ...(Array.isArray(series.tags) ? series.tags : []),
      ...taxonomyScopes.map((scope) => cleanText(scope.tag, 100)),
    ].map((tag) => cleanText(tag, 100)).filter(Boolean))],
    taxonomy_scopes: taxonomyScopes,
    series_ticker: cleanText(series.ticker, 120),
    series_title: cleanText(series.title, 400),
    series_slug: cleanText(series.series_slug, 220),
    settlement_sources: toRecordArray(series.settlement_sources)
      .map((source) => safePublicUrl(source.url)).filter(Boolean),
    raw_settlement_sources: toRecordArray(series.settlement_sources),
  };
}

function kalshiCheckpointEventCategory(event: JsonRecord, series: JsonRecord): string {
  const scopes = toRecordArray(series.taxonomy_scopes);
  if (scopes.some((scope) => /^esports?$/i.test(cleanText(scope.tag, 100)))) return "Eventos";
  return inferAtinaraCategory(
    event.title,
    event.sub_title,
    series.title,
    series.tags,
  );
}

function kalshiCheckpointEventMatchesFilters(
  event: JsonRecord,
  series: JsonRecord,
  filters: ReturnType<typeof safeFilters>,
  nowMs = Date.now(),
): boolean {
  const category = kalshiCheckpointEventCategory(event, series);
  if (filters.category && category !== filters.category) return false;
  if (filters.query) {
    const haystack = normalizeComparableText([
      event.title, event.sub_title, series.title, series.tags,
    ].flat().filter(Boolean).join(" "));
    const tokens = normalizeComparableText(filters.query).split(/\s+/).filter(Boolean);
    if (!tokens.length || !tokens.every((token) => haystack.includes(token))) return false;
  }
  const strikeAt = Date.parse(cleanText(event.strike_date, 100));
  const horizonDays = Math.max(30, Number.parseInt(filters.horizon, 10) || 180);
  return !Number.isFinite(strikeAt) || strikeAt <= nowMs + horizonDays * 86_400_000;
}

function prioritizeKalshiCheckpointEvents(
  events: JsonRecord[],
  seriesByTicker: ReadonlyMap<string, JsonRecord>,
  filters: ReturnType<typeof safeFilters>,
): JsonRecord[] {
  const ranked = events
    .filter((event) => {
      const series = seriesByTicker.get(cleanText(event.series_ticker, 120));
      return Boolean(series && kalshiCheckpointEventMatchesFilters(event, series, filters));
    })
    .sort((left, right) => {
      const leftSeries = seriesByTicker.get(cleanText(left.series_ticker, 120)) ?? {};
      const rightSeries = seriesByTicker.get(cleanText(right.series_ticker, 120)) ?? {};
      const priority = seriesPriority(rightSeries) - seriesPriority(leftSeries);
      if (priority) return priority;
      const leftId = providerParentIdentity(left);
      const rightId = providerParentIdentity(right);
      return leftId < rightId ? -1 : leftId > rightId ? 1 : 0;
    });
  if (filters.category || filters.query) return ranked;
  const buckets = new Map(RADAR_CATEGORIES.map((category) => [category, [] as JsonRecord[]]));
  for (const event of ranked) {
    const series = seriesByTicker.get(cleanText(event.series_ticker, 120)) ?? {};
    const category = kalshiCheckpointEventCategory(event, series);
    (buckets.get(category) ?? buckets.get("Industria"))?.push(event);
  }
  const balanced: JsonRecord[] = [];
  for (let index = 0; balanced.length < ranked.length; index += 1) {
    let added = false;
    for (const category of RADAR_CATEGORIES) {
      const event = buckets.get(category)?.[index];
      if (event) {
        balanced.push(event);
        added = true;
      }
    }
    if (!added) break;
  }
  return balanced;
}

async function enumerateKalshiEventChildren(
  environment: Environment,
  listedEvent: JsonRecord,
  checkedAt: string,
): Promise<JsonRecord> {
  const eventTicker = cleanText(listedEvent.event_ticker ?? listedEvent.ticker, 160);
  if (!eventTicker) throw new Error("PROVIDER_PARENT_IDENTITY_INVALID");
  const refs: JsonRecord[] = [];
  const eventUrl = new URL(`${KALSHI_API_ROOT}/events/${encodeURIComponent(eventTicker)}`);
  eventUrl.searchParams.set("with_nested_markets", "true");
  let event: JsonRecord | null = null;
  try {
    const payload = toRecord(await fetchJson(eventUrl, {}, PROVIDER_TIMEOUT_MS, { execution: environment.execution })) ?? {};
    event = toRecord(payload.event) ?? payload;
    refs.push(await providerIdentityEvidence(
      eventUrl, "event_ticker", eventTicker, payload,
      event ? "parent_children_enumerated" : "provider_invalid_response", checkedAt,
    ));
  } catch (error) {
    refs.push(await providerIdentityEvidence(
      eventUrl, "event_ticker", eventTicker, null,
      error instanceof Error ? cleanText(error.message, 80) : "provider_unavailable", checkedAt,
    ));
  }
  const nestedMarkets = event ? toRecordArray(event.markets) : [];
  const collectSurface = async (historical: boolean) => {
    const base = new URL(`${KALSHI_API_ROOT}/${historical ? "historical/" : ""}markets`);
    base.searchParams.set("event_ticker", eventTicker);
    base.searchParams.set("limit", "1000");
    try {
      const collection = await collectProviderCursorPages(async (cursor) => {
        const pageUrl = new URL(base);
        if (cursor) pageUrl.searchParams.set("cursor", cursor);
        const payload = toRecord(await fetchJson(
          pageUrl, {}, PROVIDER_TIMEOUT_MS, { execution: environment.execution },
        )) ?? {};
        refs.push(await providerIdentityEvidence(
          pageUrl, "event_ticker", eventTicker, payload,
          historical ? "historical_child_page_enumerated" : "current_child_page_enumerated", checkedAt,
        ));
        return payload;
      }, { itemsField: "markets", cursorField: "cursor", maxPages: MAX_PROVIDER_PAGES });
      return { markets: collection.items, exhausted: collection.provider_pagination_exhausted };
    } catch (error) {
      refs.push(await providerIdentityEvidence(
        base, "event_ticker", eventTicker, null,
        error instanceof Error ? cleanText(error.message, 80) : "provider_unavailable", checkedAt,
      ));
      return { markets: [] as JsonRecord[], exhausted: false };
    }
  };
  const [current, historical] = await Promise.all([collectSurface(false), collectSurface(true)]);
  const listed = mergeProviderMarketSurfaces("kalshi", [current.markets, historical.markets]);
  const identityCounts = (markets: JsonRecord[]) => {
    const counts = new Map<string, number>();
    for (const market of markets) {
      const identity = providerMarketStableId("kalshi", market);
      if (identity) counts.set(identity, (counts.get(identity) ?? 0) + 1);
    }
    return counts;
  };
  const listedCounts = identityCounts(listed.markets);
  const nestedCounts = identityCounts(nestedMarkets);
  const nestedAccounted = nestedCounts.size > 0 && nestedMarkets.length === [...nestedCounts.values()]
    .reduce((total, value) => total + value, 0)
    && [...nestedCounts].every(([identity, count]) => (listedCounts.get(identity) ?? 0) >= count);
  const enumerationComplete = Boolean(event)
    && cleanText(event?.event_ticker ?? event?.ticker, 160) === eventTicker
    && current.exhausted && historical.exhausted && nestedAccounted
    && listed.markets.every((market) => cleanText(market.event_ticker, 160) === eventTicker)
    && !listed.duplicateConflict && !listed.missingStableIdentity;
  const fallback = mergeProviderMarketSurfaces("kalshi", [listed.markets, nestedMarkets]);
  return {
    ...(event ?? listedEvent),
    event_ticker: eventTicker,
    markets: fallback.markets,
    provider_declared_child_count: enumerationComplete ? listed.markets.length : null,
    provider_pagination_exhausted: enumerationComplete && !fallback.duplicateConflict,
    provider_parent_unavailable: !event || !current.exhausted || !historical.exhausted,
    parent_reconciliation_source_refs: refs,
    _atinara_parent_enumeration: true,
  };
}

async function discoverKalshi(
  environment: Environment,
  now: string,
  filters: ReturnType<typeof safeFilters>,
  requestId: string,
  intent: RadarRefreshIntent,
  storedCheckpoint: JsonRecord | null,
) {
  const durableV2 = validatedKalshiDiscoveryCheckpointV2(storedCheckpoint);
  let checkpoint = validatedKalshiDiscoveryCheckpoint(storedCheckpoint);
  const storedPayload = toRecord(toRecord(storedCheckpoint)?.checkpoint);
  if (storedPayload && !durableV2 && !checkpoint) {
    throw new Error("PROVIDER_DISCOVERY_CHECKPOINT_INVALID");
  }
  if (durableV2 && !durableV2.state.ready) {
    const collected = await collectKalshiProviderDiscoveryBatch(environment, durableV2);
    if (!collected.batchResults.length) {
      const code = collected.retryAfterAt ? "PROVIDER_RATE_LIMITED" : "PROVIDER_TIMEOUT";
      const failure = {
        ...publicProviderError("kalshi", code, collected.retryAfterAt ? 429 : 503),
        retry_after_at: collected.retryAfterAt,
        retryable: true,
      } as ReturnType<typeof publicProviderError> & JsonRecord;
      const deferred = await deferRadarProviderDiscovery(environment, intent, failure);
      return {
        discovery_in_progress: true,
        discovery_checkpoint: deferred,
        discovery_progress: {
          stage: "series_events",
          cause_code: code,
          retry_after_at: collected.retryAfterAt,
          total_series_count: durableV2.state.series.length,
          completed_series_count: durableV2.state.completed_series_ids.length,
          failed_series_count: durableV2.state.failed_series_ids.length,
          pending_series_count: durableV2.state.pending_series_ids.length,
        },
        candidates: [] as JsonRecord[],
        reconciliations: [] as JsonRecord[],
      };
    }
    const nextCheckpoint = advanceProviderDiscoveryCheckpointV2(
      durableV2.checkpoint,
      collected.batchResults,
      {
        previous_checkpoint_hash: durableV2.checkpointHash,
        max_batch: MAX_PROVIDER_DISCOVERY_SERIES_BATCH,
        max_series: MAX_KALSHI_SERIES,
        max_parents: MAX_PROVIDER_INDEX_PARENTS,
        max_attempts: MAX_PROVIDER_DISCOVERY_SERIES_ATTEMPTS,
        max_bytes: 4_000_000,
      },
    ) as JsonRecord;
    const nextState = providerDiscoveryCheckpointV2State(nextCheckpoint, {
      max_series: MAX_KALSHI_SERIES,
      max_parents: MAX_PROVIDER_INDEX_PARENTS,
      max_attempts: MAX_PROVIDER_DISCOVERY_SERIES_ATTEMPTS,
      max_bytes: 4_000_000,
    });
    const durable = await checkpointRadarProviderDiscovery(environment, intent, nextCheckpoint);
    return {
      discovery_in_progress: true,
      discovery_checkpoint: durable,
      discovery_progress: {
        stage: "series_events",
        sequence: nextState.sequence,
        total_series_count: nextState.series.length,
        completed_series_count: nextState.completed_series_ids.length,
        failed_series_count: nextState.failed_series_ids.length,
        pending_series_count: nextState.pending_series_ids.length,
        retryable_failed_series_count: nextState.retryable_failed_series_ids.length,
        exhausted_failed_series_count: nextState.exhausted_failed_series_ids.length,
        total_parent_count: nextState.events.length,
      },
      candidates: [] as JsonRecord[],
      reconciliations: [] as JsonRecord[],
    };
  }
  if (durableV2) {
    checkpoint = projectProviderDiscoveryCheckpointV2(durableV2.checkpoint, {
      max_series: MAX_KALSHI_SERIES,
      max_parents: MAX_PROVIDER_INDEX_PARENTS,
      max_attempts: MAX_PROVIDER_DISCOVERY_SERIES_ATTEMPTS,
      max_bytes: 4_000_000,
    }) as JsonRecord;
  }
  if (!checkpoint) {
    let freshCheckpoint: JsonRecord;
    try {
      freshCheckpoint = await buildKalshiProviderDiscoveryCheckpointV2(environment, now);
    } catch (error) {
      const observed = providerFailure(error, "kalshi");
      const failure = {
        ...observed,
        retryable: true,
      } as ReturnType<typeof publicProviderError> & JsonRecord;
      const deferred = await deferRadarProviderDiscovery(environment, intent, failure);
      return {
        discovery_in_progress: true,
        discovery_checkpoint: deferred,
        discovery_progress: {
          stage: "catalog_fetch",
          cause_code: cleanText(failure.code, 100),
          retry_after_at: safeIsoDate(failure.retry_after_at),
        },
        candidates: [] as JsonRecord[],
        reconciliations: [] as JsonRecord[],
      };
    }
    // El sellado queda fuera del catch del proveedor. Si el transporte de la
    // RPC es ambiguo, la siguiente lectura recupera la misma secuencia; nunca
    // intentamos diferir con un lease que pudo haberse consumido al persistir.
    const durable = await checkpointRadarProviderDiscovery(environment, intent, freshCheckpoint);
    return {
      discovery_in_progress: true,
      discovery_checkpoint: durable,
      discovery_progress: {
        stage: "catalog_sealed",
        total_series_count: Number(freshCheckpoint.total_series_count) || 0,
        completed_series_count: 0,
        failed_series_count: 0,
        pending_series_count: Number(freshCheckpoint.pending_series_count) || 0,
        total_parent_count: 0,
        catalog_evidence: freshCheckpoint.catalog,
      },
      candidates: [] as JsonRecord[],
      reconciliations: [] as JsonRecord[],
    };
  }
  const legacyCheckpoint = cleanText(checkpoint.schema_version, 100)
    === PROVIDER_DISCOVERY_CHECKPOINT_VERSION;
  const checkpointSeries = toRecordArray(checkpoint.series);
  const checkpointFailedTaxonomyScopes = toRecordArray(checkpoint.failed_taxonomy_scopes)
    .map((scope) => ({
      category: cleanText(scope.category, 160),
      tag: cleanText(scope.tag, 160),
    })).filter((scope) => scope.category && scope.tag);
  const taxonomyRetryResults = await mapWithConcurrency(
    checkpointFailedTaxonomyScopes,
    KALSHI_CONCURRENCY,
    async (scope) => fetchKalshiTaxonomyScopeSeries(environment, scope),
  );
  const taxonomyRetryMerge = mergeProviderTaxonomySeriesV1(
    taxonomyRetryResults,
    checkpointFailedTaxonomyScopes,
  ) as {
    entries: Array<{ source: JsonRecord; scopes: KalshiTaxonomyScope[] }>;
    failed_scopes: KalshiTaxonomyScope[];
  };
  const failedTaxonomyScopes = taxonomyRetryMerge.failed_scopes;
  const seriesByTicker = new Map<string, JsonRecord>(checkpointSeries.map((series) => [
    cleanText(series.ticker, 120), series,
  ]));
  const recoveredSeriesIds: string[] = [];
  for (const { source, scopes: recoveredScopes } of taxonomyRetryMerge.entries) {
    const recovered = compactKalshiSeriesCheckpoint(source, recoveredScopes);
    const ticker = cleanText(recovered.ticker, 120);
    if (!ticker) continue;
    const current = seriesByTicker.get(ticker);
    const scopeMap = new Map([
      ...toRecordArray(current?.taxonomy_scopes),
      ...toRecordArray(recovered.taxonomy_scopes),
    ].map((scope) => [
      `${cleanText(scope.category, 160)}\u0000${cleanText(scope.tag, 160)}`,
      { category: cleanText(scope.category, 160), tag: cleanText(scope.tag, 160) },
    ]));
    if (!current) recoveredSeriesIds.push(ticker);
    seriesByTicker.set(ticker, {
      ...(current ?? recovered),
      taxonomy_scopes: [...scopeMap.values()],
    });
  }
  const checkpointFailedSeriesIds = legacyCheckpoint && Array.isArray(checkpoint.failed_series_ids)
    ? checkpoint.failed_series_ids.map((value) => cleanText(value, 120)).filter(Boolean) : [];
  const retrySeriesIds = [...new Set([
    ...checkpointFailedSeriesIds,
    ...recoveredSeriesIds,
  ])];
  const failedSeriesRetryResults = await mapWithConcurrency(
    retrySeriesIds,
    KALSHI_CONCURRENCY,
    async (ticker) => fetchOpenKalshiSeriesEvents(environment, ticker),
  );
  const failedSeriesIds: string[] = legacyCheckpoint || !Array.isArray(checkpoint.failed_series_ids)
    ? [] : checkpoint.failed_series_ids.map((value) => cleanText(value, 120)).filter(Boolean);
  const recoveredEvents: JsonRecord[] = [];
  for (let index = 0; index < failedSeriesRetryResults.length; index += 1) {
    const result = failedSeriesRetryResults[index];
    if (result.status === "rejected") failedSeriesIds.push(retrySeriesIds[index]);
    else recoveredEvents.push(...result.value);
  }
  const indexedEventsByIdentity = new Map<string, JsonRecord>();
  for (const event of [...toRecordArray(checkpoint.events), ...recoveredEvents]) {
    const identity = providerParentIdentity(event);
    if (!identity) continue;
    const current = indexedEventsByIdentity.get(identity);
    if (current && canonicalJson(current) !== canonicalJson(event)) {
      throw new Error("PROVIDER_DISCOVERY_PARENT_IDENTITY_CONFLICT");
    }
    if (!current) indexedEventsByIdentity.set(identity, event);
  }
  const indexedEvents = prioritizeKalshiCheckpointEvents(
    [...indexedEventsByIdentity.values()],
    seriesByTicker,
    filters,
  ).map((event) => ({
    ...event,
    _atinara_series_context: kalshiCheckpointSeriesContext(
      seriesByTicker.get(cleanText(event.series_ticker, 120)) ?? {},
    ),
  }));
  const indexedScope = selectWholeProviderParents(indexedEvents, {
    maxChildren: MAX_PROVIDER_MATERIALIZED_CHILDREN,
    maxParents: MAX_PROVIDER_ENUMERATION_PARENTS,
    maxTotalParents: MAX_PROVIDER_INDEX_PARENTS,
    countChildren: false,
  });
  const enumerated = await mapWithConcurrency(
    indexedScope.selected,
    KALSHI_CONCURRENCY,
    async (indexedEvent): Promise<JsonRecord> => {
      const context = toRecord(indexedEvent._atinara_series_context) ?? {};
      const listedEvent = { ...indexedEvent };
      delete listedEvent._atinara_series_context;
      const listedTicker = cleanText(listedEvent.event_ticker ?? listedEvent.ticker, 160);
      const event = await enumerateKalshiEventChildren(environment, listedEvent, now);
      const eventTicker = cleanText(event.event_ticker ?? event.ticker, 160);
      const canonicalMarkets = toRecordArray(event.markets);
      if (!eventTicker || eventTicker !== listedTicker) throw new Error("PROVIDER_PARENT_IDENTITY_INVALID");
      if (canonicalMarkets.length > MAX_CANONICAL_EVENT_CHILDREN) {
        throw new Error("PROVIDER_PARENT_CHILD_LIMIT_EXCEEDED");
      }
      const ticker = cleanText(context.series_ticker, 120);
      const guessed = `https://kalshi.com/markets/${ticker.toLowerCase()}/${cleanText(context.series_slug, 220)}/${eventTicker.toLowerCase()}`;
      const canonicalUrl = safePublicUrl(guessed, ["kalshi.com"]);
      if (!canonicalUrl) throw new Error("PROVIDER_CANONICAL_URL_INVALID");
      const settlementSources = Array.isArray(context.settlement_sources)
        ? context.settlement_sources.map((url) => safePublicUrl(url)).filter(Boolean) : [];
      return {
        ...event,
        category: cleanText(context.category, 120),
        tags: Array.isArray(context.tags) ? context.tags : [],
        series_ticker: ticker,
        series_title: cleanText(context.series_title, 400),
        settlement_sources: toRecordArray(event.settlement_sources).length
          ? event.settlement_sources : settlementSources.map((url) => ({ url })),
        external_event_url: canonicalUrl,
        canonical_url_verified: true,
        markets: canonicalMarkets.map((market) => ({
          ...market,
          series_ticker: ticker,
          external_event_url: canonicalUrl,
          external_market_url: canonicalUrl,
          canonical_url_verified: true,
          settlement_sources: toRecordArray(market.settlement_sources).length
            ? market.settlement_sources
            : event.settlement_sources ?? context.raw_settlement_sources,
        })),
      };
    },
  );
  const failedParentIds: string[] = [];
  const events: JsonRecord[] = [];
  for (let index = 0; index < enumerated.length; index += 1) {
    const result = enumerated[index];
    if (result.status === "rejected") {
      failedParentIds.push(providerParentIdentity(indexedScope.selected[index]));
      continue;
    }
    events.push(result.value);
  }
  const childScope = selectWholeProviderParents(events, {
    maxChildren: MAX_PROVIDER_MATERIALIZED_CHILDREN,
    maxParents: MAX_PROVIDER_MATERIALIZED_PARENTS,
    maxTotalParents: MAX_PROVIDER_ENUMERATION_PARENTS,
  });
  const identityResults = await mapWithConcurrency(
    childScope.selected,
    KALSHI_CONCURRENCY,
    async (event): Promise<JsonRecord> => resolveKalshiEventIdentities(environment, event, now),
  );
  const resolvedEvents: JsonRecord[] = [];
  for (let index = 0; index < identityResults.length; index += 1) {
    const result = identityResults[index];
    if (result.status === "rejected") {
      failedParentIds.push(providerParentIdentity(childScope.selected[index]));
      continue;
    }
    resolvedEvents.push(result.value);
  }
  if (!resolvedEvents.length && indexedScope.selected.length) throw new Error("PROVIDER_UNAVAILABLE");
  const materializedScope = selectWholeProviderParents(resolvedEvents, {
    maxChildren: MAX_PROVIDER_MATERIALIZED_CHILDREN,
    maxParents: MAX_PROVIDER_MATERIALIZED_PARENTS,
    maxTotalParents: MAX_PROVIDER_ENUMERATION_PARENTS,
  });
  const parentSelection = mergeIndexedProviderSelection(
    indexedScope.selection,
    materializedScope.selection,
    failedParentIds,
  );
  const adapted = adaptKalshiResponse(
    { events: materializedScope.selected },
    { now, category: filters.category || "Video Games", cacheMinutes: 20 },
  ) as JsonRecord[];
  const contextual = await attachCanonicalFactContext(adapted, materializedScope.selected, "kalshi");
  const reconciled = await reconcileCanonicalEvents(
    environment, "kalshi", materializedScope.selected, contextual, now, requestId,
  );
  const catalogEvidence = toRecord(checkpoint.catalog_evidence);
  const storedWrapper = toRecord(storedCheckpoint);
  return {
    ...reconciled,
    selection: {
      ...parentSelection,
      catalog_total_parent_count: indexedEventsByIdentity.size,
      total_taxonomy_scope_count: Math.max(
        0,
        Number(checkpoint.total_taxonomy_scope_count) || toRecordArray(checkpoint.taxonomy_scopes).length,
      ),
      selected_taxonomy_scope_count: Math.max(
        0,
        toRecordArray(checkpoint.taxonomy_scopes).length - failedTaxonomyScopes.length,
      ),
      failed_taxonomy_scope_count: failedTaxonomyScopes.length,
      failed_taxonomy_scopes: failedTaxonomyScopes,
      total_series_count: seriesByTicker.size,
      selected_series_count: Math.max(0, seriesByTicker.size - failedSeriesIds.length),
      deferred_series_count: 0,
      failed_series_count: failedSeriesIds.length,
      failed_series_ids: failedSeriesIds,
      failed_parent_count: failedParentIds.length,
      failed_parent_ids: [...new Set(failedParentIds)],
      provider_scope_partial: failedTaxonomyScopes.length > 0
        || failedSeriesIds.length > 0 || failedParentIds.length > 0,
      provider_catalog_total_series_count: catalogEvidence
        ? Number(catalogEvidence.total_provider_series_count) || 0 : null,
      provider_catalog_selected_series_count: catalogEvidence
        ? Number(catalogEvidence.selected_series_count) || 0 : null,
      provider_catalog_hash: catalogEvidence
        ? cleanText(catalogEvidence.provider_catalog_hash, 80) : null,
      provider_catalog_pagination_exhausted: catalogEvidence
        ? catalogEvidence.provider_pagination_exhausted === true : null,
      provider_catalog_selection_policy_version: catalogEvidence
        ? cleanText(catalogEvidence.selection_policy_version, 120) : null,
      discovery_checkpoint_version: cleanText(checkpoint.schema_version, 100)
        || PROVIDER_DISCOVERY_CHECKPOINT_VERSION,
      discovery_checkpoint_sequence: durableV2?.state.sequence ?? null,
      discovery_checkpoint_hash: durableV2?.checkpointHash
        ?? (cleanText(storedWrapper?.checkpoint_hash, 80) || null),
      discovery_checkpoint_replayed: true,
    },
  };
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
  let deterministicFutureFallbackGroups = 0;
  const coverageCheckedAt = new Date().toISOString();
  for (const group of groups) {
    const groupKey = cleanText(group.event_group_key, 240);
    if (!incompleteGroupKeys.has(groupKey)) continue;
    const groupEvidence = evidence.get(groupKey) ?? [];
    const authorityCandidateIds = new Set(groupEvidence
      .filter((item) => isResolutionAuthorityEvidence(item))
      .map((item) => cleanText(item.candidate_external_id, 220))
      .filter(Boolean));
    const groupCandidates = toRecordArray(group.candidates);
    if (groupCandidates.length > 0 && groupCandidates.every((candidate) =>
      authorityCandidateIds.has(cleanText(candidate.external_id, 220)))) {
      incompleteGroupKeys.delete(groupKey);
      directAuthorityFallbackGroups += 1;
      continue;
    }
    if (hasDeterministicOfficialResearchCoverage(groupCandidates, groupEvidence, coverageCheckedAt)) {
      incompleteGroupKeys.delete(groupKey);
      deterministicFutureFallbackGroups += 1;
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
    summary: {
      count: authorityCount,
      groups: groups.length,
      direct_contract_fallback_groups: directAuthorityFallbackGroups,
      deterministic_future_fallback_groups: deterministicFutureFallbackGroups,
    },
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
  _environment: Environment,
  _provider: string,
  _cacheKey: string,
  _entries: AuthoritativePersistenceEntry[],
  _deadlineAt: number,
): Promise<AuthoritativePersistenceBatchResult> {
  // Compatibilidad de símbolos para pruebas históricas: la ruta V1 queda
  // inutilizable por código además de no tener EXECUTE. El único writer activo
  // es el manifiesto durable + complete_market_radar_candidate_refresh_v1.
  throw new Error("LEGACY_RADAR_WRITER_DISABLED");
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
    const providerPayload = { ...(toRecord(candidate.provider_payload) ?? {}) };
    delete providerPayload.canonical_event_children;
    providerPayload.canonical_event_children_fingerprint = cleanText(
      candidate.parent_reconciliation_fingerprint, 80,
    ) || null;
    const persistedCandidate = { ...candidate, provider_payload: providerPayload, cache_key: cacheKey };
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
      const persistenceBatches = buildRadarPersistenceBatches(entries, {
        maxItems: RADAR_PERSISTENCE_BATCH_SIZE,
        maxBytes: 700_000,
      });
      for (let ordinal = 0; ordinal < persistenceBatches.length; ordinal += 1) {
        await renewRadarRefreshLease(environment, intent);
        await rpc(environment, "stage_market_radar_refresh_batch_v1", {
          request_id_input: intent.requestId,
          provider_input: intent.provider,
          capability_input: intent.capability,
          lease_token_input: intent.leaseToken,
          batch_ordinal_input: ordinal,
          items_input: persistenceBatches[ordinal],
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

  let processedBatchCount = 0;
  while (true) {
    if (processedBatchCount >= 512) throw new Error("RADAR_ATOMIC_CANDIDATE_COMMIT_LIMIT");
    await renewRadarRefreshLease(environment, intent);
    const batchResult = toRecord(await rpc(environment, "process_market_radar_refresh_batch_v4", {
      request_id_input: intent.requestId,
      provider_input: intent.provider,
      capability_input: intent.capability,
      lease_token_input: intent.leaseToken,
    }, undefined, true, { timeoutPolicyMs: 30_000 }));
    rpcCalls += 2;
    if (batchResult?.ok !== true) {
      const batchCode = cleanText(batchResult?.code, 100) || "RADAR_PERSISTENCE_FAILED";
      const timeoutBatchId = cleanText(batchResult?.batch_id, 80).toLowerCase();
      const timeoutItemCount = Number(batchResult?.item_count);
      if (batchCode === "RADAR_PERSISTENCE_TIMEOUT"
          && batchResult?.retryable === true
          && validUuid(timeoutBatchId)
          && Number.isInteger(timeoutItemCount)
          && timeoutItemCount > 1
          && timeoutItemCount <= MAX_NORMALIZED_PER_PROVIDER) {
        await renewRadarRefreshLease(environment, intent);
        const splitResult = toRecord(await rpc(
          environment,
          "split_market_radar_refresh_batch_v1",
          {
            request_id_input: intent.requestId,
            provider_input: intent.provider,
            capability_input: intent.capability,
            lease_token_input: intent.leaseToken,
            batch_id_input: timeoutBatchId,
          },
          undefined,
          true,
        ));
        rpcCalls += 2;
        const splitReplayed = splitResult?.replayed === true;
        const splitParentId = cleanText(splitResult?.parent_batch_id, 80).toLowerCase();
        const leftCount = Number(splitResult?.left_count);
        const rightCount = Number(splitResult?.right_count);
        const newSplitValid = splitReplayed || (
          validUuid(splitResult?.left_batch_id)
          && validUuid(splitResult?.right_batch_id)
          && Number.isInteger(leftCount)
          && Number.isInteger(rightCount)
          && leftCount > 0
          && rightCount > 0
          && leftCount + rightCount === timeoutItemCount
        );
        if (splitResult?.ok !== true
            || splitParentId !== timeoutBatchId
            || !newSplitValid) {
          throw new Error("RADAR_REFRESH_BATCH_SPLIT_INVALID");
        }
        processedBatchCount += 1;
        if (Date.now() + PERSISTENCE_ISOLATION_BUDGET_MS
            >= environment.execution.absoluteDeadlineAt - FINALIZATION_RESERVE_MS) {
          throw new Error("RADAR_PERSISTENCE_TIMEOUT");
        }
        continue;
      }
      throw new Error(batchCode);
    }
    const remainingBatchCount = Math.max(0, Number(batchResult.remaining_batches) || 0);
    if (batchResult.processed === true) processedBatchCount += 1;
    if (remainingBatchCount === 0) break;
    if (batchResult.processed !== true) {
      throw new Error("RADAR_PERSISTENCE_ISOLATION_DEFERRED");
    }
    if (Date.now() + PERSISTENCE_ISOLATION_BUDGET_MS
        >= environment.execution.absoluteDeadlineAt - FINALIZATION_RESERVE_MS) {
      throw new Error("RADAR_PERSISTENCE_TIMEOUT");
    }
  }

  await renewRadarRefreshLease(environment, intent);
  const finalized = toRecord(await rpc(environment, "complete_market_radar_candidate_refresh_v2", {
    request_id_input: intent.requestId,
    provider_input: intent.provider,
    capability_input: intent.capability,
    lease_token_input: intent.leaseToken,
    status_input: "available",
    error_code_input: null,
    failure_stage_input: null,
    retry_after_seconds_input: null,
  }, undefined, true, { timeoutPolicyMs: 90_000 }));
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
  return toRecord(await rpc(environment, "finalize_market_radar_refresh_v5", {
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
  return toRecord(await rpc(environment, "finalize_market_radar_refresh_v5", {
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
  const [candidatesPayload, rejectedPayload, providers, parentReconciliationsPayload] = await Promise.all([
    rpcReadWithRetry(environment, "list_market_radar_candidates_v5", {
      provider_filter: filters.provider === "all" ? null : filters.provider,
      category_filter: filters.category || null,
      quality_filter: filters.quality,
      query_filter: filters.query || null,
      order_key: filters.order,
      horizon_filter: filters.horizon,
      parent_limit_count: MAX_VISIBLE_GROUPS,
      parent_offset_count: filters.parent_offset,
    }, authorization),
    rpc(environment, "list_market_radar_rejections_v3", {
      provider_filter: filters.provider === "all" ? null : filters.provider,
      category_filter: filters.category || null,
      limit_count: 100,
      offset_count: 0,
    }, authorization).catch(() => []),
    rpc(environment, "get_market_radar_provider_status", {}, authorization),
    rpc(environment, "list_market_radar_parent_reconciliations_v3", {
      provider_filter: filters.provider === "all" ? null : filters.provider,
      category_filter: filters.category || null,
      query_filter: filters.query || null,
      horizon_filter: filters.horizon,
      limit_count: 20,
      offset_count: filters.reconciliation_offset,
    }, authorization),
  ]);
  const checkedAt = Date.now();
  const minimumCheckedAt = minimumDiscoveryCheckedAt ? Date.parse(minimumDiscoveryCheckedAt) : Number.NaN;
  const candidatePage = toRecord(candidatesPayload) ?? {};
  const reconciliationPage = toRecord(parentReconciliationsPayload) ?? {};
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
    parent_reconciliations: toRecordArray(reconciliationPage.items)
      .map((value) => projectRadarParentReconciliation(value)).filter(Boolean),
    reconciliation_page: {
      total: Math.max(0, Number(reconciliationPage.total) || 0),
      offset: Math.max(0, Number(reconciliationPage.offset) || 0),
      limit: Math.max(1, Number(reconciliationPage.limit) || 20),
      previous_offset: reconciliationPage.previous_offset !== null
        && reconciliationPage.previous_offset !== undefined
        && Number.isInteger(Number(reconciliationPage.previous_offset))
        ? Number(reconciliationPage.previous_offset) : null,
      next_offset: reconciliationPage.next_offset !== null
        && reconciliationPage.next_offset !== undefined
        && Number.isInteger(Number(reconciliationPage.next_offset))
        ? Number(reconciliationPage.next_offset) : null,
      snapshot_available: reconciliationPage.snapshot_available === true,
    },
    page: {
      parent_count: Math.max(0, Number(candidatePage.parent_count) || 0),
      parent_offset: Math.max(0, Number(candidatePage.parent_offset) || 0),
      parent_limit: Math.max(1, Number(candidatePage.parent_limit) || MAX_VISIBLE_GROUPS),
      previous_parent_offset: candidatePage.previous_parent_offset !== null
        && candidatePage.previous_parent_offset !== undefined
        && Number.isInteger(Number(candidatePage.previous_parent_offset))
        ? Number(candidatePage.previous_parent_offset) : null,
      next_parent_offset: candidatePage.next_parent_offset !== null
        && candidatePage.next_parent_offset !== undefined
        && Number.isInteger(Number(candidatePage.next_parent_offset))
        ? Number(candidatePage.next_parent_offset) : null,
    },
  };
}

async function runDiscovery(environment: Environment, authorization: string, body: JsonRecord) {
  const filters = safeFilters(body);
  // La paginación solo proyecta un snapshot; no forma parte de la identidad de
  // red ni puede ocultar una UUID activa al navegar entre páginas.
  const refreshFilters = radarRefreshIdentityFilters(filters);
  const cacheKey = buildCacheKey(refreshFilters);
  const requestedRefresh = body.refresh === true;
  const refreshRequestHash = await sha256Hex({
    request_version: RADAR_REFRESH_REQUEST_VERSION,
    provider_role_version: RADAR_PROVIDER_ROLE_VERSION,
    filters: refreshFilters,
  });
  const activeRefresh = toRecord(await rpc(
    environment,
    "get_active_market_radar_refresh_v1",
    { request_hash_input: refreshRequestHash, cache_key_input: cacheKey },
    authorization,
  ));
  const activeRefreshId = cleanText(activeRefresh?.request_id, 80);
  const activeRefreshInProgress = validUuid(activeRefreshId);
  const current = await loadRadarView(environment, authorization, filters);
  const latest = current.providers
    .filter((provider) => RADAR_CANDIDATE_PROVIDERS.includes(cleanText(provider.provider, 40)))
    .map((provider) => Date.parse(cleanText(provider.fetched_at, 100)))
    .filter(Number.isFinite).sort((a, b) => b - a)[0] || 0;
  const cooldownRemaining = Math.max(0, REFRESH_COOLDOWN_MS - (Date.now() - latest));
  if (!requestedRefresh || (cooldownRemaining > 0 && !activeRefreshInProgress)) {
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
    const responseView = projectRadarDiscoveryView({
      ...current,
      providers: candidateProviders,
    });
    return radarDiscoveryResponse({
      ok: true,
      ...responseView,
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
      refresh_request_id: activeRefreshInProgress ? activeRefreshId : null,
      refresh_in_progress: activeRefreshInProgress,
      cooldown_seconds: Math.ceil(cooldownRemaining / 1000),
      cooldown_until: new Date(Date.now() + cooldownRemaining).toISOString(),
      limits: { max_pages: MAX_PROVIDER_PAGES, max_kalshi_series: MAX_KALSHI_SERIES, max_visible_groups: MAX_VISIBLE_GROUPS },
    });
  }

  const now = new Date().toISOString();
  const requestedRefreshId = cleanText(body.refresh_request_id, 80);
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
  const protectedCandidateIdentities = new Set(toRecordArray(await rpc(
    environment,
    "get_market_radar_protected_candidate_identities_v1",
    { provider_filter: filters.provider === "all" ? null : filters.provider },
    undefined,
    true,
  )).map((candidate) => `${cleanText(candidate.provider, 40)}:${cleanText(candidate.external_id, 220)}`));
  const candidateProviderErrors: JsonRecord[] = [];
  const providerIssues: JsonRecord[] = [];
  const enrichmentIssues: JsonRecord[] = [];
  const providerSelections: JsonRecord[] = [];
  const providerIntents = new Map<string, RadarRefreshIntent>();
  for (const provider of requestedProviders) {
    const intent = await beginRadarRefreshIntent(
      environment, authorization, refresh, provider, "candidate_feed", cacheKey,
    );
    providerIntents.set(provider, intent);
    const issue = toRecord(intent.responseSummary?.issue);
    if (issue) providerIssues.push(issue);
    const replayedSelection = toRecord(intent.responseSummary?.provider_selection);
    if (replayedSelection) providerSelections.push({
      provider,
      ...projectProviderSelectionForResponse(replayedSelection),
    });
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
  // V3 nunca mezcla una fila legacy rechazada con el manifest actual. Los
  // hechos Kalshi se vuelven a observar dentro de su padre exhaustivamente
  // reconciliado; una identidad diferida permanece histórica, no candidata.
  const reconciledCandidates: JsonRecord[] = [];
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
  const discoveryResults = await withRadarRefreshLeaseHeartbeat(
    environment,
    [...providerIntents.values(),tavilyIntent],
    () => mapWithConcurrency(providers, Math.max(1, providers.length), async (provider): Promise<JsonRecord> => {
      const intent = providerIntents.get(provider);
      if (!intent) throw new Error("RADAR_REFRESH_INTENT_REQUIRED");
      const discovery = provider === "polymarket"
        ? await discoverPolymarket(environment, now, filters, refresh.requestId)
        : await discoverKalshi(
          environment,
          now,
          filters,
          refresh.requestId,
          intent,
          await loadRadarProviderDiscoveryCheckpoint(environment, intent),
        );
      return { provider, ...discovery };
    }),
  );
  for (let index = 0; index < discoveryResults.length; index += 1) {
    const result = discoveryResults[index];
    const provider = providers[index];
    if (result.status === "fulfilled") {
      const intent = providerIntents.get(provider);
      try {
        if (!intent) throw new Error("RADAR_REFRESH_INTENT_REQUIRED");
        const discovery = result.value;
        if (discovery.discovery_in_progress === true) {
          const discoveryProgress = toRecord(discovery.discovery_progress) ?? {};
          const discoveryStage = cleanText(discoveryProgress.stage, 80);
          const progressMessage = discoveryStage === "catalog_sealed"
            ? "Atinara selló el catálogo global completo de Kalshi. Continúa la misma actualización para indexar sus series por tramos durables."
            : discoveryStage === "catalog_fetch"
              ? "Kalshi no permitió completar el catálogo global. La intención sigue protegida y puede reanudarse sin abrir otra actualización."
              : "Atinara guardó el tramo de series ya procesado. Continúa la misma actualización; solo se consultará lo pendiente o recuperable.";
          candidateProviderErrors.push({
            provider,
            code: "RADAR_PROVIDER_DISCOVERY_CHECKPOINTED",
            status: 202,
            message: progressMessage,
            retryable: true,
            state_preserved: true,
            next_action: "resume_provider_discovery",
            discovery_checkpoint: discovery.discovery_checkpoint,
            discovery_progress: discoveryProgress,
          });
          continue;
        }
        const selection = toRecord(discovery.selection);
        if (selection) await rpc(
          environment, "record_market_radar_provider_selection_v2", {
            request_id_input: intent.requestId,
            provider_input: intent.provider,
            capability_input: intent.capability,
            lease_token_input: intent.leaseToken,
            selection_input: selection,
          }, undefined, true,
        );
        await recordParentReconciliations(environment, intent, toRecordArray(discovery.reconciliations));
        const discoveredProvider = cleanText(discovery.provider, 40);
        discoveredByProvider.set(discoveredProvider, toRecordArray(discovery.candidates));
        if (selection) providerSelections.push({
          provider: discoveredProvider,
          ...projectProviderSelectionForResponse(selection),
        });
        continue;
      } catch (error) {
        const failure = persistenceFailure(error, provider);
        const deferral = intent
          ? await deferRadarRefreshPersistence(environment, intent, failure)
          : null;
        const deferred = Boolean(deferral);
        const finalization = deferral ?? (intent
          ? await finalizeRadarRefreshFailureV2(environment, intent, failure, "persistence")
          : {});
        const issue = toRecord(finalization.issue) ?? await radarRefreshIssue({
          requestId: refresh.requestId, provider, capability: "candidate_feed",
          code: cleanText(failure.code, 100) || "RADAR_PARENT_RECONCILIATION_PERSISTENCE_FAILED",
          failureStage: "persistence",
        });
        providerIssues.push(issue);
        candidateProviderErrors.push({
          ...failure,
          status: deferred ? 202 : failure.status,
          issue,
          state_preserved: true,
          refresh_request_id: intent?.requestId ?? refresh.requestId,
          next_action: deferred ? "resume_persistence_intent" : failure.next_action,
        });
        continue;
      }
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
  for (const selection of providerSelections) {
    const deferredParents = Math.max(0, Number(selection.deferred_parent_count) || 0);
    const deferredSeries = Math.max(0, Number(selection.deferred_series_count) || 0);
    const failedTaxonomyScopes = Math.max(0, Number(selection.failed_taxonomy_scope_count) || 0);
    const failedSeries = Math.max(0, Number(selection.failed_series_count) || 0);
    const failedParents = Math.max(0, Number(selection.failed_parent_count) || 0);
    const failedSearches = Math.max(0, Number(selection.failed_search_count) || 0);
    if (!deferredParents && !deferredSeries && !failedTaxonomyScopes
      && !failedSeries && !failedParents && !failedSearches) continue;
    const failures = [
      failedTaxonomyScopes
        ? `${failedTaxonomyScopes} taxonomía${failedTaxonomyScopes === 1 ? "" : "s"}` : "",
      failedSeries ? `${failedSeries} serie${failedSeries === 1 ? "" : "s"}` : "",
      failedParents ? `${failedParents} padre${failedParents === 1 ? "" : "s"}` : "",
      failedSearches ? `${failedSearches} búsqueda${failedSearches === 1 ? "" : "s"} temática${failedSearches === 1 ? "" : "s"}` : "",
    ].filter(Boolean).join(", ");
    const failureCopy = failures
      ? ` No respondieron: ${failures}; se reintentarán sin descartar las familias sanas.`
      : "";
    qualityNotices.push({
      provider: selection.provider,
      code: failures ? "RADAR_PROVIDER_SERIES_PARTIAL" : "RADAR_PROVIDER_SCOPE_DEFERRED",
      quarantined_count: 0,
      degrades_provider: false,
      selection,
      message: `La consulta conservó padres completos dentro del presupuesto: ${selection.selected_parent_count ?? 0} padres representados, ${deferredParents} padres y ${deferredSeries} series fuera de este alcance.${failureCopy} Ningún padre representado fue truncado.`,
    });
  }
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
      const researchIntents = [
        ...[...discoveredByProvider.keys()].map((provider) => providerIntents.get(provider)),
        tavilyIntent,
      ].filter((intent): intent is RadarRefreshIntent => Boolean(intent));
      const research = await withRadarRefreshLeaseHeartbeat(
        environment,
        researchIntents,
        () => withRadarEnrichmentBudget(environment, (boundedEnvironment) =>
          researchGroupsWithTavily(
            boundedEnvironment, boundedEnvironment.tavilyKey, scanCandidates, authoritativeDomains,
          )
        ),
      );
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
    if (decisionCode && !workflowCodes.has(decisionCode)
        && !RADAR_PARENT_MANAGED_WORKFLOW_CODES.has(decisionCode)) {
      workflowIssues.push(await candidateDecisionWorkflowIssue(candidate, decisionCode));
      workflowCodes.add(decisionCode);
    }
    for (const temporalCode of Array.isArray(temporalContract.anomaly_codes)
      ? temporalContract.anomaly_codes.map((value) => cleanText(value, 100))
        .filter((value) => value.startsWith("TEMPORAL_")) : []) {
      if (workflowCodes.has(temporalCode)) continue;
      workflowIssues.push(await createRadarWorkflowIssue({
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
    const resumableState = Number(failure.status) === 202
      ? cleanText(failure.code, 100) === "RADAR_PROVIDER_DISCOVERY_CHECKPOINTED"
        ? "discovery_resumable"
        : "persistence_resumable"
      : "provider_degraded";
    for (const candidate of current.candidates.filter((item) => item.provider === failedProvider)) {
      const identity = `${cleanText(candidate.provider, 40)}:${cleanText(candidate.external_id, 220)}`;
      preservedCandidatesByIdentity.set(identity, {
        ...candidate,
        eligibility_state_preserved: true,
        provider_refresh_checked_at: now,
        provider_refresh_state: resumableState,
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
      const identity = `${cleanText(candidate.provider, 40)}:${cleanText(candidate.external_id, 220)}`;
      const lastKnownGood = currentCandidatesByIdentity.get(identity);
      if (protectedCandidateIdentities.has(identity)
        || (cleanText(lastKnownGood?.state, 40) === "prepared"
          && validUuid(cleanText(lastKnownGood?.prepared_draft_id, 80)))) {
        if (lastKnownGood) preservedCandidatesByIdentity.set(identity, {
          ...lastKnownGood,
          provider_refresh_checked_at: now,
          provider_refresh_state: "legacy_prepared_preserved",
        });
        return false;
      }
      if (cleanText(candidate.eligibility_status, 40) !== "technical_hold"
        || !new Set<string>([
          RADAR_REASON_CODES.RESOLUTION_SOURCE_AUTHORITY_PENDING,
          RADAR_REASON_CODES.OFFICIAL_TERMINAL_SCAN_UNAVAILABLE,
        ]).has(cleanText(candidate.eligibility_reason_code, 100))) {
        return true;
      }
      if (!lastKnownGood) return true;
      preservedCandidatesByIdentity.set(identity, {
        ...lastKnownGood,
        eligibility_state_preserved: true,
        provider_refresh_checked_at: now,
        provider_refresh_state: "source_enrichment_degraded",
        // El padre vigente ya se ha reconciliado en esta ejecución, pero esta
        // candidata no se promovió con él. Se conserva como LKG visible y se
        // deshabilita expresamente para no simular una proyección corriente.
        parent_reconciliation_status: "refresh_required",
        provider_pagination_exhausted: false,
        current_reconciliation_ready: false,
        requires_provider_reconciliation: true,
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
      const deferral = intent
        ? await deferRadarRefreshPersistence(environment, intent, failure)
        : null;
      const finalization = deferral ?? (intent
        ? await finalizeRadarRefreshFailureV2(environment, intent, failure, "persistence")
        : {});
      const issue = toRecord(finalization.issue) ?? await radarRefreshIssue({
        requestId: refresh.requestId, provider, capability: "candidate_feed",
        code: cleanText(failure.code, 100) || "RADAR_PERSISTENCE_FAILED",
        failureStage: "persistence",
      });
      providerIssues.push(issue);
      candidateProviderErrors.push({
        ...failure,
        status: deferral ? 202 : failure.status,
        retryable: deferral ? true : failure.retryable === true,
        issue,
        state_preserved: true,
        refresh_request_id: intent?.requestId ?? refresh.requestId,
        next_action: deferral ? "resume_persistence_intent" : failure.next_action,
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
  const catalogPreservedCandidates = preservedCandidates.filter((candidate) =>
    cleanText(candidate.normalizer_version, 80) === RADAR_NORMALIZER_VERSION
      && isRadarParentComplete(candidate)
      && isCanonicalRadarChildProjectionValid(candidate));
  const withheldPreservedCount = preservedCandidates.length - catalogPreservedCandidates.length;
  if (withheldPreservedCount>0) qualityNotices.push({
    code: "RADAR_PRESERVED_CANDIDATE_REFRESH_REQUIRED",
    count: withheldPreservedCount,
    message: `${withheldPreservedCount} expediente${withheldPreservedCount===1 ? " conservado queda" : "s conservados quedan"} fuera del catálogo hasta enlazarse con el snapshot padre vigente.`,
  });
  const mergedCandidates = [...freshView.candidates, ...catalogPreservedCandidates];
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
  const responseView = projectRadarDiscoveryView(view);
  return radarDiscoveryResponse({
    ok: true,
    ...responseView,
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
    provider_selections: providerSelections,
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
  if (!isRadarParentComplete(candidate)) return {
    ok: false,
    error: "RADAR_PARENT_RECONCILIATION_INCOMPLETE",
    message: "El proveedor todavía no ha permitido reconciliar todas las hijas del evento.",
  };
  if (!isCanonicalRadarChildProjectionValid(candidate)) return {
    ok: false,
    error: "CANONICAL_CHILD_PROJECTION_INVALID",
    message: "La identidad canónica de la opción no cumple el contrato vigente.",
  };
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
  const state = cleanText(candidate.state, 40);
  const legacyPrepared = cleanText(candidate.normalizer_version, 80) === "atinara-radar-v2"
    && ["prepared","rejected"].includes(state) && Boolean(candidate.prepared_draft_id)
    && cleanText(candidate.eligibility_status,40) !== "terminal";
  if (cleanText(candidate.normalizer_version, 80) !== RADAR_NORMALIZER_VERSION && !legacyPrepared) return { ok: false, error: "NORMALIZER_OUTDATED", message: "La candidata debe actualizarse con el normalizador vigente." };
  if (!legacyPrepared && (!isRadarParentComplete(candidate) || !isCanonicalRadarChildProjectionValid(candidate))) {
    return { ok: false, error: "RADAR_PARENT_RECONCILIATION_INCOMPLETE", message: "El expediente actual del proveedor no acredita todavía todas las identidades hijas." };
  }
  if (cleanText(candidate.eligibility_policy_version, 80) !== RADAR_ELIGIBILITY_POLICY_VERSION) return { ok: false, error: "ELIGIBILITY_POLICY_OUTDATED", message: "La candidata debe revisarse con el criterio predictivo vigente." };
  const selfDuplicateRepair = state === "rejected"
    && cleanText(candidate.verification_status, 80) === "rejected_duplicate"
    && Boolean(candidate.prepared_draft_id||candidate.has_active_radar_draft);
  const repairablePrepared = (state === "prepared" || legacyPrepared || (
    state === "rejected" && Boolean(candidate.prepared_draft_id||candidate.has_active_radar_draft)
      && RADAR_PROVIDER_AVAILABILITY_WORKFLOW_CODES.has(cleanText(
        candidate.eligibility_reason_code ?? candidate.verification_reason_code,100,
      ))
  ))
    && Boolean(candidate.prepared_draft_id||candidate.has_active_radar_draft)
    && cleanText(candidate.eligibility_status, 40) !== "terminal"
    && !toRecordArray(candidate.duplicate_matches).some((match) => isBlockingDuplicateMatch(match));
  if (!["available", "needs_review", "prepared"].includes(state)
    && !selfDuplicateRepair && !repairablePrepared) return { ok: false, error: "CANDIDATE_NOT_REVALIDATABLE", message: "La candidata ya no admite una comprobación de elegibilidad." };
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
  persistedCandidate: JsonRecord,
): Promise<JsonRecord> {
  const domainFingerprint = await selectRadarDomainReviewFingerprintV1(
    candidate,
    persistedCandidate,
  );
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
  const eventId = cleanText(candidate.external_event_id, 220);
  const marketId = cleanText(candidate.external_market_id, 220);
  if (!eventSlug || !eventId || !marketId) return null;
  const checkedAt = new Date().toISOString();
  const enumerated = await enumeratePolymarketEventChildren(
    environment, { id: eventId, slug: eventSlug }, checkedAt,
  );
  if (toRecordArray(enumerated.markets).length > MAX_CANONICAL_EVENT_CHILDREN) return null;
  const canonicalEvent = await resolvePolymarketEventIdentities(environment, enumerated, checkedAt);
  const contextual = await attachCanonicalFactContext(
    adaptPolymarketResponse({ events: [canonicalEvent] }, { now: checkedAt, cacheMinutes: 20 }) as JsonRecord[],
    [canonicalEvent],
    "polymarket",
  );
  const reconciled = await reconcileCanonicalEvents(
    environment, "polymarket", [canonicalEvent], contextual, checkedAt,
  );
  const current = reconciled.candidates.find((item) => cleanText(item.external_market_id, 220) === marketId);
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
  const checkedAt = new Date().toISOString();
  const enumeratedEvent = await enumerateKalshiEventChildren(environment, { event_ticker: eventTicker }, checkedAt);
  const event = await resolveKalshiEventIdentities(environment, enumeratedEvent, checkedAt);
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
  const contextual = await attachCanonicalFactContext(
    adaptKalshiResponse({ events: [canonicalEvent] }, { now: checkedAt, cacheMinutes: 20 }) as JsonRecord[],
    [canonicalEvent],
    "kalshi",
  );
  const reconciled = await reconcileCanonicalEvents(
    environment, "kalshi", [canonicalEvent], contextual, checkedAt,
  );
  const current = reconciled.candidates.find((item) => cleanText(item.external_market_id, 220) === marketTicker);
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
    ? await revalidateCurrentCandidateDomain(environment, providerCandidate, candidate) : null;
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

  const revalidationManagedCodes = new Set<string>([
    ...RADAR_TERMINAL_WORKFLOW_CODES,
    ...RADAR_SOURCE_CONTRACT_WORKFLOW_CODES,
    ...RADAR_TECHNICAL_HOLD_WORKFLOW_CODES,
    ...RADAR_ELIGIBILITY_RECOVERY_WORKFLOW_CODES,
    ...RADAR_PROVIDER_AVAILABILITY_WORKFLOW_CODES,
    RADAR_REASON_CODES.GAMING_DOMAIN_REVIEW_REQUIRED,
    RADAR_REASON_CODES.PROVIDER_PLACEHOLDER,
    "RADAR_CANDIDATE_IDENTITY_STALE",
  ]);
  const revalidationWorkflowIssues = toRecordArray(candidate.workflow_issues)
    .filter((issue) => !revalidationManagedCodes.has(cleanText(issue.issue_code,100)));
  const revalidationDecisionCode = cleanText(
    eligibility.eligibility_reason_code ?? eligibility.domain_reason_code,100,
  );
  if (cleanText(eligibility.eligibility_status,40) !== "eligible" && revalidationDecisionCode) {
    revalidationWorkflowIssues.push(await candidateDecisionWorkflowIssue(
      { ...candidate,...eligibility },revalidationDecisionCode,
    ));
  }
  eligibility={...eligibility,workflow_issues:revalidationWorkflowIssues.slice(0,40)};

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
  const legacyPrepared = cleanText(candidate.normalizer_version, 100) === "atinara-radar-v2"
    && ["prepared","rejected"].includes(cleanText(candidate.state, 40))
    && Boolean(cleanText(candidate.prepared_draft_id, 80))
    && cleanText(candidate.eligibility_status,40) !== "terminal";
  const identitySnapshot = legacyPrepared ? {
    contract_version: "atinara-radar-prepared-legacy-identity-v1",
    provider: cleanText(candidate.provider, 40),
    external_id: cleanText(candidate.external_id, 220),
    normalizer_version: cleanText(candidate.normalizer_version, 100),
    family_version: cleanText(candidate.family_version, 100) || null,
    family_key: cleanText(candidate.family_key, 300) || null,
    family_type: cleanText(candidate.family_type, 80) || null,
    family_child_key: cleanText(candidate.family_child_key, 260) || null,
    family_child_label: cleanText(candidate.family_child_label, 240) || null,
    prepared_draft_id: cleanText(candidate.prepared_draft_id, 80),
    current_external_event_id: cleanText(eligibility.external_event_id,220),
    current_external_market_id: cleanText(eligibility.external_market_id,220) || null,
    current_source_question: cleanText(eligibility.source_question,700),
    current_source_resolution_rules: cleanText(eligibility.source_resolution_rules,5_000) || null,
    current_source_close_at: safeIsoDate(eligibility.source_close_at),
    current_parent_reconciliation_version: cleanText(eligibility.parent_reconciliation_version,100),
    current_parent_reconciliation_fingerprint: cleanText(eligibility.parent_reconciliation_fingerprint,80),
    current_parent_child_occurrence_key: cleanText(eligibility.parent_child_occurrence_key,500),
    current_parent_child_identity_key: cleanText(eligibility.parent_child_identity_key,500) || null,
    current_parent_child_fingerprint: cleanText(eligibility.parent_child_fingerprint,80),
    current_provider_child_contract_hash: cleanText(eligibility.provider_child_contract_hash,80),
    current_canonical_child_key: cleanText(eligibility.canonical_child_key,260) || null,
    current_canonical_child_label: cleanText(eligibility.canonical_child_label,240) || null,
    current_identity_status: cleanText(eligibility.identity_status,80),
    current_identity_classification: cleanText(eligibility.identity_classification,100),
  } : {
    contract_version: "atinara-radar-preparation-identity-v1",
    provider: cleanText(eligibility.provider, 40),
    external_id: cleanText(eligibility.external_id, 220),
    external_event_id: cleanText(eligibility.external_event_id, 220),
    external_market_id: cleanText(eligibility.external_market_id, 220) || null,
    normalizer_version: cleanText(eligibility.normalizer_version, 100),
    family_version: cleanText(eligibility.family_version, 100),
    family_key: cleanText(eligibility.family_key, 300),
    family_type: cleanText(eligibility.family_type, 80),
    family_child_key: cleanText(eligibility.family_child_key, 260),
    family_child_label: cleanText(eligibility.family_child_label, 240),
    canonical_projection_version: cleanText(eligibility.canonical_projection_version, 100),
    canonical_child_key: cleanText(eligibility.canonical_child_key, 260) || null,
    canonical_child_label: cleanText(eligibility.canonical_child_label, 240) || null,
    parent_reconciliation_version: cleanText(eligibility.parent_reconciliation_version, 100),
    parent_reconciliation_fingerprint: cleanText(eligibility.parent_reconciliation_fingerprint, 80),
    parent_reconciliation_integrity_hash: cleanText(
      eligibility.parent_reconciliation_integrity_hash,80,
    ),
    parent_child_occurrence_key: cleanText(eligibility.parent_child_occurrence_key, 500),
    parent_child_identity_key: cleanText(eligibility.parent_child_identity_key, 500) || null,
    parent_child_fingerprint: cleanText(eligibility.parent_child_fingerprint, 80),
    parent_child_integrity_hash: cleanText(eligibility.parent_child_integrity_hash,80),
    provider_child_contract_hash: cleanText(eligibility.provider_child_contract_hash, 80),
    identity_status: cleanText(eligibility.identity_status, 80),
    identity_classification: cleanText(eligibility.identity_classification, 100),
  };
  const applied = toRecord(await rpc(environment, "apply_market_radar_prepare_eligibility_v4", {
    candidate_id_input: cleanText(candidate.id, 80),
    expected_preparation_revision_input: Number.isSafeInteger(expectedRevision) ? expectedRevision : null,
    normalizer_version_input: legacyPrepared ? "atinara-radar-v2" : RADAR_NORMALIZER_VERSION,
    eligibility_checked_at_input: checkedAt,
    eligibility_input: eligibility,
    eligibility_check_input: eligibilityCheck,
    identity_snapshot_input: identitySnapshot,
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
  const errorCode = radarOperationalErrorCode(error);
  const phase = ["PROVIDER_UNAVAILABLE", "RADAR_CANDIDATE_IDENTITY_STALE",
    "RADAR_PARENT_RECONCILIATION_INCOMPLETE"].includes(errorCode)
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
      retryable_input: ["PROVIDER_UNAVAILABLE", "ELIGIBILITY_SCAN_UNAVAILABLE",
        "RADAR_CANDIDATE_IDENTITY_STALE", "RADAR_PARENT_RECONCILIATION_INCOMPLETE"].includes(errorCode),
    }, undefined, true);
  } catch (auditError) {
    console.warn("Radar eligibility attempt audit unavailable", auditError instanceof Error ? auditError.message : "AUDIT_UNAVAILABLE");
  }
}

function eligibilityFailureResponse(error: unknown, operationId: string): Response {
  const code = radarOperationalErrorCode(error, "RADAR_ELIGIBILITY_REQUIRED");
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
    RADAR_PARENT_RECONCILIATION_INCOMPLETE: { status: 409, message: "El proveedor todavía no ha permitido reconciliar todas las opciones del evento." },
    RADAR_CANDIDATE_IDENTITY_STALE: { status: 409, message: "El proveedor cambió datos materiales de identidad o contrato. Actualiza el Radar antes de volver a preparar esta candidata." },
    CANONICAL_CHILD_PROJECTION_INVALID: { status: 409, message: "La identidad canónica de la opción no cumple el contrato vigente." },
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
      || ["RADAR_CANDIDATE_IDENTITY_STALE", "RADAR_PARENT_RECONCILIATION_INCOMPLETE"].includes(code)
      || failure.status === 429 || failure.status >= 500,
    next_action: code === "RADAR_CANDIDATE_IDENTITY_STALE"
      ? "refresh_radar_sources"
      : code === "RADAR_PARENT_RECONCILIATION_INCOMPLETE"
        ? "retry_provider_refresh" : null,
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
  if (action === "reconciliation-details") {
    const reconciliationId = cleanText(body.reconciliation_id, 80);
    if (!validUuid(reconciliationId)) {
      return jsonResponse({ error: "INVALID_RECONCILIATION", message: "La reconciliación solicitada no es válida." }, 400);
    }
    const detail = toRecord(await rpc(environment, "get_market_radar_parent_reconciliation_v1", {
      reconciliation_id_input: reconciliationId,
    }, authorization));
    if (!detail) return jsonResponse({ error: "RECONCILIATION_NOT_FOUND", message: "No se encontró la reconciliación." }, 404);
    return jsonResponse({ ok: true, reconciliation: detail });
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
          || !RADAR_CANDIDATE_FINGERPRINT_PATTERN.test(expectedFingerprint)
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
    const eligibilityCheckpoint = toRecord(await rpc(
      environment,
      "get_market_radar_eligibility_attempt_checkpoint_v1",
      { candidate_id_input:candidateId,attempt_id_input:operationId },
      undefined,true,
    ));
    if (eligibilityCheckpoint?.found===true) {
      if (eligibilityCheckpoint.replayed!==true) {
        return eligibilityFailureResponse(
          new Error(cleanText(eligibilityCheckpoint.error,100)
            || "RADAR_ELIGIBILITY_CHECKPOINT_SUPERSEDED"),
          operationId,
        );
      }
      try {
        const recovery = toRecord(await rpc(environment, "recover_market_draft_radar_eligibility_v1", {
          draft_id_input:draftId,expected_version_input:draftVersion,
          expected_fingerprint_input:draftFingerprint,candidate_id_input:candidateId,
          actor_id_input:adminId,attempt_id_input:operationId,
        },undefined,true));
        return jsonResponse({
          ok:true,status:"eligibility_recovered",
          candidate:toRecord(eligibilityCheckpoint.candidate) ?? {},recovery,
          owner_stage:"validator",next_action:"request_market_validation",
          state_preserved:true,eligibility_checkpoint_replay:true,
          provider_calls_replayed:0,
        });
      } catch (error) {
        return eligibilityFailureResponse(error,operationId);
      }
    }
    const candidateResult = toRecord(await rpc(
      environment,
      "get_market_radar_candidate_for_draft_revalidation_v3",
      {
        candidate_id_input: candidateId,
        draft_id_input: draftId,
        expected_version_input: draftVersion,
        expected_fingerprint_input: draftFingerprint,
      },
      undefined,
      true,
    ));
    const candidate=candidateResult
      ? {...candidateResult,has_active_radar_draft:true}:candidateResult;
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
        ? "get_market_radar_candidate_for_draft_revalidation_v3"
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
