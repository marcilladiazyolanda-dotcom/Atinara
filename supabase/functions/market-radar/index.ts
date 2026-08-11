import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  RADAR_API_HOSTS,
  RADAR_CATEGORIES,
  RADAR_ELIGIBILITY_POLICY_VERSION,
  RADAR_FACT_POLICY_VERSION,
  RADAR_NORMALIZER_VERSION,
  RADAR_PROVIDERS,
  RADAR_REASON_CODES,
  adaptKalshiResponse,
  adaptPolymarketResponse,
  applyAdaptation,
  applyEligibilityDecision,
  buildCacheKey,
  buildCoverResolutionSignals,
  buildDraftPrefill,
  buildGeminiCandidateBatches,
  canApplyPredictivePolicyOverride,
  canReuseRadarVerification,
  cleanText,
  compactGeminiCandidate,
  compactGeminiDefinition,
  diversifyGroups,
  detectOfficialCoverEventResolution,
  deriveDeterministicUnresolvedProof,
  evidenceHasPotentialTerminalClaim,
  evidenceSupportsReasonCode,
  evaluateDeterministicEligibility,
  evaluatePredictiveEligibility,
  evaluateProviderEligibility,
  extractOfficialHtmlText,
  extractOfficialRelatedUrls,
  groupCandidates,
  hasSpeculativeEvidenceLanguage,
  indexGeminiDecisions,
  isAdaptedIdeaComplete,
  isBlockingDuplicateMatch,
  isDeterministicUnresolvedEvidence,
  isRecord,
  isVerifiedOfficialEvidence,
  isVerifiedTerminalEvidence,
  normalizeProviderResult,
  normalizeRadarCandidatePresentation,
  officialEvidenceSegmentsForSubject,
  officialSelectionEditionCoverage,
  parseGeminiAdaptations,
  providerResultLabel,
  propagateResolvedEventGroups,
  publicProviderError,
  safeIsoDate,
  safeNumber,
  safePublicUrl,
  scoreCandidates,
  selectVerifiedResolutionUrl,
  summarizeRejections,
} from "../_shared/market-radar.mjs";

type JsonRecord = Record<string, unknown>;
type Environment = NonNullable<ReturnType<typeof getEnvironment>>;

const MAX_REQUEST_BYTES = 8_192;
const PROVIDER_TIMEOUT_MS = 14_000;
const GEMINI_TIMEOUT_MS = 20_000;
const GEMINI_MODEL = "gemini-3.1-flash-lite";
const MAX_PROVIDER_PAGES = 3;
const MAX_NORMALIZED_PER_PROVIDER = 240;
const RADAR_PERSISTENCE_BATCH_SIZE = 24;
const MAX_PERSISTENCE_RPC_CALLS_PER_PROVIDER = 64;
const PERSISTENCE_ISOLATION_BUDGET_MS = 20_000;
const PERSISTENCE_RPC_START_MARGIN_MS = 750;
const MAX_VISIBLE_GROUPS = 60;
const MAX_GEMINI_GROUPS = 30;
const MAX_GEMINI_CANDIDATES = 180;
const GEMINI_BATCH_SIZE = 9;
const GEMINI_CONCURRENCY = 2;
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
const MAX_SELECTION_FOLLOWUP_URLS_PER_GROUP = 4;
const TAVILY_SELECTION_FOLLOWUP_CONCURRENCY = 4;
const TAVILY_SELECTION_FOLLOWUP_TIMEOUT_MS = 5_000;
const OFFICIAL_SELECTION_FOLLOWUP_BUDGET_MS = 12_000;
const MAX_PROVIDER_RETRY_DELAY_MS = 8_000;
const PROVIDER_RETRY_JITTER_MS = 250;

// Algunos modelos aceptan JSON mode pero rechazan el subconjunto de JSON
// Schema del proveedor con INVALID_ARGUMENT. Una vez observado en la misma
// instancia, las demás tandas evitan repetir ese 400 y mantienen la validación
// estricta en la capa de aplicación.
let geminiProviderSchemaSupported = true;

const KALSHI_API_ROOT = "https://api.elections.kalshi.com/trade-api/v2";
const POLYMARKET_GAMMA_ROOT = "https://gamma-api.polymarket.com";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const GEMINI_REASON_CODES = [
  RADAR_REASON_CODES.EVENT_ALREADY_RESOLVED,
  RADAR_REASON_CODES.SOURCE_STALE,
  RADAR_REASON_CODES.EVENT_OUTSIDE_CONTRACT,
  RADAR_REASON_CODES.SUBJECT_NOT_ANNOUNCED,
  RADAR_REASON_CODES.TEMPORAL_INCOHERENCE,
  RADAR_REASON_CODES.INVALID_OR_UNVERIFIED_SOURCE,
  RADAR_REASON_CODES.VERIFICATION_REQUIRED,
] as const;

function geminiResponseJsonSchema(candidateCount: number): JsonRecord {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      candidates: {
        type: "array",
        minItems: candidateCount,
        maxItems: candidateCount,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            candidate_index: { type: "integer", minimum: 0, maximum: Math.max(0, candidateCount - 1) },
            eligible: { type: "boolean" },
            conclusive: { type: "boolean" },
            reason_code: { type: "string", enum: [...GEMINI_REASON_CODES] },
            reason: { type: "string" },
            confidence: { type: "integer", minimum: 0, maximum: 100 },
            ttl_minutes: { type: "integer", minimum: 5, maximum: 1_440 },
            facts: {
              type: "object",
              additionalProperties: false,
              properties: {
                event_resolved_at: { type: ["string", "null"] },
                official_reveal_at: { type: ["string", "null"] },
                release_at: { type: ["string", "null"] },
                subject_announced: { type: ["boolean", "null"] },
                temporal_coherence: { type: ["boolean", "null"] },
              },
              required: ["event_resolved_at", "official_reveal_at", "release_at", "subject_announced", "temporal_coherence"],
            },
            atinara_question: { type: "string" },
            atinara_category: { type: "string", enum: [...RADAR_CATEGORIES] },
            atinara_resolution_criteria: { type: "string" },
          },
          required: [
            "candidate_index", "eligible", "conclusive", "reason_code",
            "reason", "confidence", "ttl_minutes", "facts", "atinara_question",
            "atinara_category", "atinara_resolution_criteria",
          ],
        },
      },
    },
    required: ["candidates"],
  };
}

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

type RadarPreparationBlockedDiagnostics = {
  candidate: JsonRecord | null;
  attempt_fact_check_id: number | null;
  authoritative_fact_check_id: number | null;
  preparation_revision: number | null;
  persisted: boolean;
  authoritative_pointer_unchanged: boolean;
};

type FetchJsonOptions = {
  onRateLimit?: (error: ProviderRequestError) => void;
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

class RadarPreparationBlockedError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  readonly diagnostics: RadarPreparationBlockedDiagnostics;

  constructor(code: string, recordedAttempt: JsonRecord) {
    const safeCode = /^[A-Z][A-Z0-9_]{2,100}$/.test(code) ? code : "RADAR_REVALIDATION_REQUIRED";
    super(safeCode);
    this.name = "RadarPreparationBlockedError";
    this.code = safeCode;
    this.retryable = !new Set([
      "RADAR_CANDIDATE_RESOLVED",
      "RADAR_CANDIDATE_INELIGIBLE",
      "RADAR_CONFIRMED_DUPLICATE",
      "CANDIDATE_NOT_PREPARABLE",
    ]).has(safeCode);
    const attemptFactCheckId = Number(recordedAttempt.attempt_fact_check_id);
    const authoritativeFactCheckId = Number(recordedAttempt.authoritative_fact_check_id);
    const preparationRevision = Number(recordedAttempt.preparation_revision);
    this.diagnostics = {
      candidate: toRecord(recordedAttempt.candidate),
      attempt_fact_check_id: Number.isSafeInteger(attemptFactCheckId) && attemptFactCheckId > 0 ? attemptFactCheckId : null,
      authoritative_fact_check_id: Number.isSafeInteger(authoritativeFactCheckId) && authoritativeFactCheckId > 0
        ? authoritativeFactCheckId
        : null,
      preparation_revision: Number.isSafeInteger(preparationRevision) && preparationRevision >= 0 ? preparationRevision : null,
      persisted: recordedAttempt.persisted === true,
      authoritative_pointer_unchanged: recordedAttempt.authoritative_pointer_unchanged === true
        || recordedAttempt.idempotency_replay === true,
    };
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

function getEnvironment() {
  const environment = {
    supabaseUrl: Deno.env.get("SUPABASE_URL") ?? "",
    publishableKey: getPublishableKey(),
    secretKey: getSecretKey(),
    tavilyKey: Deno.env.get("TAVILY_API_KEY") ?? "",
    geminiKey: Deno.env.get("GEMINI_API_KEY") ?? "",
  };
  return environment.supabaseUrl && environment.publishableKey && environment.secretKey ? environment : null;
}

function restHeaders(key: string, authorization?: string): Record<string, string> {
  const headers: Record<string, string> = { apikey: key, "Content-Type": "application/json" };
  if (authorization) headers.Authorization = authorization;
  else if (!key.startsWith("sb_secret_")) headers.Authorization = `Bearer ${key}`;
  return headers;
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
  const response = await fetch(`${environment.supabaseUrl}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: restHeaders(key, service ? undefined : authorization),
    body: JSON.stringify(args),
    signal: options.signal,
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

async function authenticateAdmin(environment: Environment, authorization: string): Promise<{ adminId: string } | Response> {
  const response = await fetch(`${environment.supabaseUrl}/auth/v1/user`, {
    headers: { Authorization: authorization, apikey: environment.publishableKey },
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
  const jitter = Math.floor(Math.random() * (PROVIDER_RETRY_JITTER_MS + 1));
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
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { ...init, signal: controller.signal });
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
          await new Promise((resolve) => setTimeout(resolve, delayMs));
          continue;
        }
        throw rateLimitError;
      }
      if (response.status >= 500) {
        if (attempt === 0) {
          await new Promise((resolve) => setTimeout(resolve, providerRetryDelay(attempt)));
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
      await new Promise((resolve) => setTimeout(resolve, providerRetryDelay(attempt)));
    } finally {
      clearTimeout(timeout);
    }
  }
  throw new Error("PROVIDER_UNAVAILABLE");
}

async function verifyPublicUrl(value: string, allowedHost: string): Promise<string | null> {
  const initial = safePublicUrl(value, [allowedHost]);
  if (!initial) return null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);
  try {
    const response = await fetch(initial, { method: "GET", redirect: "follow", signal: controller.signal, headers: { Accept: "text/html" } });
    if (!response.ok) return null;
    return safePublicUrl(response.url, [allowedHost]);
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
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
): Promise<VerifiedOfficialPage | null> {
  let current = safePublicUrl(value);
  if (!current || !isOfficialEvidenceUrl(current, authoritativeDomains)) return null;
  for (let redirects = 0; redirects <= MAX_OFFICIAL_SOURCE_REDIRECTS; redirects += 1) {
    const remaining = deadlineAt - Date.now();
    if (remaining <= 0) return null;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Math.min(OFFICIAL_SOURCE_FETCH_TIMEOUT_MS, remaining));
    try {
      const response = await fetch(current, {
        method: "GET",
        redirect: "manual",
        cache: "no-store",
        signal: controller.signal,
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
  const candidateQuestions = toRecordArray(group.candidates)
    .map((candidate) => cleanText(candidate.source_question ?? candidate.atinara_question, 500)).join(" ");
  const tokens = sourceTokens(`${group.title ?? ""} ${candidateQuestions}`).slice(0, 60);
  const anchors = new Set(tokens.filter((token) => !SOURCE_GENERIC_ANCHORS.has(token)));
  if (!tokens.length || !anchors.size) return null;
  const rawSegments = selectionSubject
    ? officialEvidenceSegmentsForSubject(page, selectionSubject, "selection")
    : metricSubject
      ? officialEvidenceSegmentsForSubject(page, metricSubject, "metric")
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

function canonicalJson(value: unknown): string {
  const normalize = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(normalize);
    if (!isRecord(item)) return item ?? null;
    const record = item as JsonRecord;
    return Object.fromEntries(Object.keys(record).sort().map((key) => [key, normalize(record[key])]));
  };
  return JSON.stringify(normalize(value));
}

async function sha256Hex(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(typeof value === "string" ? value : canonicalJson(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
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
  }).sort((left, right) => cleanText(left.market_id, 220).localeCompare(cleanText(right.market_id, 220)));
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

async function discoverPolymarket(now: string, filters: ReturnType<typeof safeFilters>) {
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
  const payload = toRecord(await fetchJson(url)) ?? {};
  const rawEvents = toRecordArray(payload.events);
  const validatedEvents: JsonRecord[] = [];
  for (const searchEvent of rawEvents.slice(0, 60)) {
    const slug = cleanText(searchEvent.slug, 400);
    if (!slug) continue;
    try {
      const canonical = toRecord(await fetchJson(new URL(`${POLYMARKET_GAMMA_ROOT}/events/slug/${encodeURIComponent(slug)}`)));
      if (!canonical || cleanText(canonical.id, 220) !== cleanText(searchEvent.id, 220)) continue;
      const markets = toRecordArray(canonical.markets);
      if (!markets.length || markets.length > MAX_CANONICAL_EVENT_CHILDREN) continue;
      const canonicalUrl = await verifyPublicUrl(`https://polymarket.com/event/${slug}`, "polymarket.com");
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

async function kalshiTaxonomy() {
  const taxonomyUrl = new URL(`${KALSHI_API_ROOT}/search/tags_by_categories`);
  try {
    return taxonomyValues(await fetchJson(taxonomyUrl));
  } catch {
    return null;
  }
}

async function discoverKalshi(now: string) {
  const exact = await kalshiTaxonomy();
  const category = exact?.category ?? "Entertainment";
  const tag = exact?.tag ?? "Video games";
  const seriesUrl = new URL(`${KALSHI_API_ROOT}/series`);
  seriesUrl.searchParams.set("category", category);
  seriesUrl.searchParams.set("tags", tag);
  seriesUrl.searchParams.set("include_volume", "true");
  seriesUrl.searchParams.set("include_product_metadata", "true");
  const seriesPayload = toRecord(await fetchJson(seriesUrl)) ?? {};
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
      const pagePayload = toRecord(await fetchJson(eventsUrl)) ?? {};
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
        const canonicalPayload = toRecord(await fetchJson(canonicalUrl)) ?? {};
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

async function fetchKalshiMarketRecord(ticker: string): Promise<JsonRecord | null> {
  try {
    const payload = toRecord(await fetchJson(new URL(`${KALSHI_API_ROOT}/markets/${encodeURIComponent(ticker)}`))) ?? {};
    return toRecord(payload.market) ?? payload;
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes("HTTP_404")) throw error;
    const payload = toRecord(await fetchJson(new URL(`${KALSHI_API_ROOT}/historical/markets/${encodeURIComponent(ticker)}`))) ?? {};
    return toRecord(payload.market) ?? payload;
  }
}

async function reconcileRejectedKalshiOutcomes(
  environment: Environment,
  rejected: JsonRecord[],
  cacheKey: string,
  now: string,
): Promise<number> {
  const pending = rejected
    .filter((candidate) => cleanText(candidate.provider, 40) === "kalshi"
      && cleanText(candidate.verification_reason_code, 100) === RADAR_REASON_CODES.PROVIDER_NOT_OPEN
      && !normalizeProviderResult(candidate.source_result)
      && cleanText(candidate.external_market_id, 220))
    .slice(0, MAX_REJECTED_OUTCOME_RECONCILIATIONS);
  if (!pending.length) return 0;
  const checked = await mapWithConcurrency(pending, KALSHI_CONCURRENCY, async (candidate) => {
    const market = await fetchKalshiMarketRecord(cleanText(candidate.external_market_id, 220));
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
  if (!reconciled.length) return 0;
  const outcome = await persistProviderResult(environment, "kalshi", `${cacheKey}:resultados`, reconciled);
  return outcome.persistedCount;
}

async function researchGroupsWithTavily(apiKey: string, candidates: JsonRecord[], authoritativeDomains: ReadonlySet<string>) {
  if (!apiKey) throw new Error("PROVIDER_NOT_CONFIGURED");
  if (!authoritativeDomains.size) throw new Error("SOURCE_REGISTRY_UNAVAILABLE");
  const groups = groupCandidates(candidates).slice(0, MAX_GEMINI_GROUPS);
  const evidence = new Map<string, JsonRecord[]>();
  const settled = await mapWithConcurrency(groups, TAVILY_CONCURRENCY, async (group) => {
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
    })) ?? {};
    return {
      eventGroupKey: group.event_group_key,
      urls: toRecordArray(payload.results)
        .map((result) => safePublicUrl(result.url))
        .filter((item): item is string => Boolean(item && isOfficialEvidenceUrl(item, authoritativeDomains)))
        .slice(0, 6),
    };
  });
  let firstFailure: unknown = null;
  const discoveredByGroup = new Map<string, string[]>();
  for (const result of settled) {
    if (result.status === "fulfilled") discoveredByGroup.set(result.value.eventGroupKey, result.value.urls);
    else if (!firstFailure) firstFailure = result.reason;
  }
  if (!discoveredByGroup.size && firstFailure) throw firstFailure;

  // Tavily descubre URLs, pero sus títulos y snippets nunca entran en Gemini ni
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
  const deadlineAt = Date.now() + OFFICIAL_SOURCE_BUDGET_MS;
  const pagePromises = new Map<string, Promise<VerifiedOfficialPage | null>>();
  const verifiedPagesByGroup = new Map<string, VerifiedOfficialPage[]>();
  const verified = await mapWithConcurrency(targets, OFFICIAL_SOURCE_CONCURRENCY, async (target) => {
    if (!pagePromises.has(target.url)) {
      pagePromises.set(target.url, fetchVerifiedOfficialPage(target.url, authoritativeDomains, deadlineAt));
    }
    const page = await pagePromises.get(target.url)!;
    const group = groups.find((item) => item.event_group_key === target.eventGroupKey);
    const retrievedAt = new Date().toISOString();
    return page && group ? { eventGroupKey: target.eventGroupKey, page, item: await relevantVerifiedEvidence(page, group, retrievedAt) } : null;
  });
  for (const result of verified) {
    if (result.status !== "fulfilled" || !result.value) continue;
    const pages = verifiedPagesByGroup.get(result.value.eventGroupKey) ?? [];
    if (!pages.some((page) => page.url === result.value?.page.url)) pages.push(result.value.page);
    verifiedPagesByGroup.set(result.value.eventGroupKey, pages);
    if (result.value.item) {
      const items = evidence.get(result.value.eventGroupKey) ?? [];
      if (!items.some((item) => item.url === result.value?.item?.url)) items.push(result.value.item);
      evidence.set(result.value.eventGroupKey, items.slice(0, 6));
    }
  }

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
      .sort((left, right) => right.score - left.score || left.url.localeCompare(right.url));
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
    const relatedDeadlineAt = Date.now() + OFFICIAL_RELATED_SOURCE_BUDGET_MS;
    const related = await mapWithConcurrency(relatedTargets, OFFICIAL_SOURCE_CONCURRENCY, async (target) => {
      if (!pagePromises.has(target.url)) {
        pagePromises.set(target.url, fetchVerifiedOfficialPage(target.url, authoritativeDomains, relatedDeadlineAt));
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
        evidence.set(result.value.eventGroupKey, items.slice(0, 6));
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
  const factualFollowupGroups: Array<{ group: JsonRecord; query: string }> = [];
  for (let rank = 0; factualFollowupGroups.length < MAX_SELECTION_FOLLOWUP_GROUPS; rank += 1) {
    const selectionGroup = incompleteSelectionGroups[rank];
    const metricGroup = incompleteMetricGroups[rank];
    if (!selectionGroup && !metricGroup) break;
    if (selectionGroup) {
      const subject = selectionGroupSubject(selectionGroup);
      factualFollowupGroups.push({
        group: selectionGroup,
        query: `official "${subject}" cover stars all editions Standard Edition Ultimate Edition Ultimate Plus Edition complete cover lineup`,
      });
    }
    if (metricGroup && factualFollowupGroups.length < MAX_SELECTION_FOLLOWUP_GROUPS) {
      const subject = metricGroupSubject(metricGroup);
      factualFollowupGroups.push({
        group: metricGroup,
        query: `official "${subject}" release date launch date`,
      });
    }
  }
  if (factualFollowupGroups.length) {
    const followupSearches = await mapWithConcurrency(
      factualFollowupGroups,
      TAVILY_SELECTION_FOLLOWUP_CONCURRENCY,
      async ({ group, query }) => {
        try {
          const payload = toRecord(await fetchJson(new URL("https://api.tavily.com/search"), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              api_key: apiKey,
              query: cleanText(query, 1_200),
              search_depth: "basic",
              max_results: MAX_SELECTION_FOLLOWUP_URLS_PER_GROUP,
              include_answer: false,
              include_raw_content: false,
              include_domains: [...authoritativeDomains],
            }),
          }, TAVILY_SELECTION_FOLLOWUP_TIMEOUT_MS)) ?? {};
          return {
            eventGroupKey: group.event_group_key,
            urls: [...new Set(toRecordArray(payload.results)
              .map((result) => safePublicUrl(result.url))
              .filter((item): item is string => Boolean(item && isOfficialEvidenceUrl(item, authoritativeDomains))))]
              .slice(0, MAX_SELECTION_FOLLOWUP_URLS_PER_GROUP),
          };
        } catch {
          return { eventGroupKey: group.event_group_key, urls: [] as string[] };
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
      const followupDeadlineAt = Date.now() + OFFICIAL_SELECTION_FOLLOWUP_BUDGET_MS;
      const followed = await mapWithConcurrency(followupTargets, OFFICIAL_SOURCE_CONCURRENCY, async (target) => {
        if (!pagePromises.has(target.url)) {
          pagePromises.set(target.url, fetchVerifiedOfficialPage(target.url, authoritativeDomains, followupDeadlineAt));
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
          evidence.set(result.value.eventGroupKey, items.slice(0, 6));
        }
      }
    }
  }
  return evidence;
}

type GeminiBatchResult = {
  candidates: JsonRecord[];
  decisionCount: number;
  incompleteCount: number;
  eventResolutions: JsonRecord[];
};

type GeminiVerificationOutcome = {
  candidates: JsonRecord[];
  processedDecisions: number;
  failedBatches: number;
  incompleteCandidates: number;
  deferredCandidates: number;
  firstError: unknown | null;
};

type GeminiQuotaCircuit = {
  stopped: boolean;
  firstRateLimit: ProviderRequestError | null;
};

function candidateIdentity(candidate: JsonRecord): string {
  return `${cleanText(candidate.provider, 40)}:${cleanText(candidate.external_id, 220)}`;
}

function withoutDeferredProviderClosure(candidate: JsonRecord): JsonRecord {
  return {
    ...candidate,
    hard_reject_reasons: (Array.isArray(candidate.hard_reject_reasons) ? candidate.hard_reject_reasons : [])
      .filter((reason) => cleanText(reason, 100) !== RADAR_REASON_CODES.PROVIDER_NOT_OPEN),
  };
}

function providerDecisionFactStatus(candidate: JsonRecord, decision: JsonRecord): string {
  const current = cleanText(candidate.fact_status, 40) || "unknown";
  if (cleanText(decision.reason_code, 100) !== RADAR_REASON_CODES.PROVIDER_NOT_OPEN) return current;
  const payload = toRecord(candidate.provider_payload) ?? {};
  const children = toRecordArray(payload.canonical_event_children);
  const total = safeNumber(payload.canonical_event_children_total);
  const completeCanonicalEvent = payload.canonical_event_children_complete === true
    && typeof total === "number"
    && Number.isInteger(total)
    && total > 0
    && children.length === total;
  const canonicalProviderUrl = safePublicUrl(candidate.external_market_url)
    ?? safePublicUrl(candidate.external_event_url);
  // Cerrado no significa resuelto: conserva fact_status=unresolved, pero solo
  // cuando el evento completo y el estado del proveedor fueron recuperados.
  // Una ausencia, timeout o contexto parcial sigue siendo unknown/needs_review.
  return completeCanonicalEvent && canonicalProviderUrl ? "unresolved" : "unknown";
}

function officialEventResolutionSignals(candidates: JsonRecord[], evidenceByGroup: Map<string, JsonRecord[]>, now: string): JsonRecord[] {
  const signals: JsonRecord[] = [];
  for (const group of groupCandidates(candidates)) {
    const officialResolution = detectOfficialCoverEventResolution(
      group.candidates,
      evidenceByGroup.get(group.event_group_key) ?? [],
    );
    if (!officialResolution) continue;
    const outcomes = Array.isArray(officialResolution.outcome_names) ? officialResolution.outcome_names.join(" y ") : officialResolution.winner_name;
    for (const candidate of group.candidates) {
      signals.push({
        event_group_key: group.event_group_key,
        candidate_identity: candidateIdentity(candidate),
        resolved_at: now,
        reason: `Las fuentes oficiales publicaron ya la selección completa (${outcomes}); el hecho del evento padre está resuelto aunque el proveedor conserve opciones abiertas.`,
        confidence: 100,
        ttl_minutes: 360,
        evidence: officialResolution.evidence,
        selection_complete: officialResolution.selection_complete === true,
      });
    }
  }
  return signals;
}

async function verifyGeminiBatch(
  apiKey: string,
  candidates: JsonRecord[],
  existing: JsonRecord[],
  evidenceByGroup: Map<string, JsonRecord[]>,
  now: string,
  quotaCircuit: GeminiQuotaCircuit,
): Promise<GeminiBatchResult> {
  const candidateIndexes = new Map(candidates.map((candidate, index) => [candidateIdentity(candidate), index]));
  const groups = groupCandidates(candidates);
  const safeGroups = groups.map((group) => ({
    event_group_key: group.event_group_key,
    title: group.title,
    candidates: group.candidates.map((candidate: JsonRecord) => {
      const compact = compactGeminiCandidate(candidate);
      const candidateIndex = candidateIndexes.get(candidateIdentity(candidate));
      return compact && Number.isInteger(candidateIndex) ? { candidate_index: candidateIndex, ...compact } : null;
    }).filter(isRecord),
    evidence: evidenceByGroup.get(group.event_group_key) ?? [],
  }));
  const safeExisting = existing.slice(0, 50).map((item) => compactGeminiDefinition(item)).filter(isRecord);
  const prompt = `Actúa como editor experto de mercados predictivos para el Radar privado de Atinara. Evalúas si la pregunta constituye una predicción futura, binaria, objetiva y resoluble; no evalúas si crees que el resultado Sí ocurrirá. Solo puedes usar los datos del proveedor y las evidencias incluidas. No inventes hechos, URLs, fechas, nombres, estados ni condiciones. Las evidencias proceden exclusivamente de contenido recuperado por el servidor: si claim_status no es direct, direct_claim no es true o el texto contiene rumor, predicción, posibilidad, votación o preferencia de fans, no permite ninguna conclusión terminal. Tú no puedes crear ni conceder selection_complete, direct_claim, evidence_basis o content_sha256. Escribe reason y atinara_resolution_criteria en español claro, sin códigos técnicos en el texto. Devuelve exactamente un elemento por candidate_index, conserva cada índice entero sin cambiarlo y cumple el esquema JSON. Si un valor factual no está demostrado, usa null. event_resolved_at y official_reveal_at solo pueden indicar que toda la familia del evento padre ya tiene resultado; nunca representan el vencimiento aislado de una opción hija. Una fecha oficial prevista es información para estimar probabilidad, no invalida una opción futura anterior o posterior: una fecha umbral solo es incoherente si el plazo ya venció o existe imposibilidad objetiva demostrada. Que todavía no exista anuncio, nominación, ganador o resultado es incertidumbre válida. Una pregunta directa sobre anuncio, lanzamiento, retraso o tráiler puede ser válida aunque el producto no esté anunciado. En cambio, un premio o una reseña de un producto no anunciado depende de un requisito previo y no es apto. Un juego anunciado puede ser candidato a un premio futuro aunque aún no haya nominaciones. Sin una fuente pública suficiente para resolver el contrato, usa eligible=false, conclusive=false y reason_code=VERIFICATION_REQUIRED. Marca EVENT_ALREADY_RESOLVED solo cuando el resultado de la pregunta ya sea público, nunca porque el pronóstico actual parezca muy probable o improbable. Si la evidencia falta para una afirmación factual bloqueante, usa eligible=false, conclusive=false y reason_code=VERIFICATION_REQUIRED. Las comprobaciones deterministas recibidas tienen prioridad. Códigos permitidos: ${GEMINI_REASON_CODES.join(", ")}. Categorías permitidas: ${RADAR_CATEGORIES.join(", ")}. Grupos:\n${JSON.stringify(safeGroups)}\nDefiniciones existentes sin datos personales:\n${JSON.stringify(safeExisting)}`;
  const url = new URL(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`);
  const requestBody = (providerSchema: boolean) => ({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: "application/json",
        ...(providerSchema ? { responseJsonSchema: geminiResponseJsonSchema(candidates.length) } : {}),
        maxOutputTokens: 8_192,
        ...(providerSchema ? { thinkingConfig: { thinkingLevel: "minimal" } } : {}),
      },
    });
  const requestOptions: FetchJsonOptions = {
    onRateLimit: (error) => {
      quotaCircuit.stopped = true;
      quotaCircuit.firstRateLimit ??= error;
    },
  };
  const send = (providerSchema: boolean) => fetchJson(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify(requestBody(providerSchema)),
  }, GEMINI_TIMEOUT_MS, requestOptions);
  let providerPayload: unknown;
  if (geminiProviderSchemaSupported) {
    try {
      providerPayload = await send(true);
    } catch (error) {
      if (!(error instanceof ProviderRequestError) || error.status !== 400) throw error;
      geminiProviderSchemaSupported = false;
      providerPayload = await send(false);
    }
  } else {
    providerPayload = await send(false);
  }
  const payload = toRecord(providerPayload) ?? {};
  const decisions = parseGeminiAdaptations(payload) as JsonRecord[];
  if (!decisions.length) throw new Error("PROVIDER_INVALID_RESPONSE");
  const byIndex = indexGeminiDecisions(decisions, candidates.length) as Map<number, JsonRecord>;
  const eventResolutions: JsonRecord[] = [];
  const verified = candidates.map((candidate, candidateIndex) => {
    const decision = byIndex.get(candidateIndex) ?? {
      eligible: false,
      conclusive: false,
      reason_code: RADAR_REASON_CODES.VERIFICATION_REQUIRED,
      reason: "La verificación automática no devolvió una decisión para esta candidata.",
      confidence: 0,
      ttl_minutes: 5,
    };
    const evidence = evidenceByGroup.get(cleanText(candidate.event_group_key, 240)) ?? [];
    const resolutionSourceUrl = selectVerifiedResolutionUrl(candidate, evidence);
    const sanitizedDecision = { ...decision, atinara_resolution_source_url: resolutionSourceUrl };
    const adapted = applyAdaptation(candidate, sanitizedDecision);
    const facts = toRecord(decision.facts) ?? {};
    const inferredDeterministic = evaluateDeterministicEligibility(adapted, facts, now);
    const deterministic = inferredDeterministic
      && evidence.some((item) => evidenceSupportsReasonCode(item, inferredDeterministic.reason_code))
      ? inferredDeterministic
      : null;
    const deterministicOpen = !deterministic
      && isAdaptedIdeaComplete(adapted)
      && evaluateProviderEligibility(adapted, now) === null
      && evidence.some((item) => isDeterministicUnresolvedEvidence(item, adapted, now))
      && !evidence.some((item) => evidenceHasPotentialTerminalClaim(item, adapted, now));
    const deterministicOpenDecision = deterministicOpen ? {
      eligible: true,
      conclusive: true,
      reason_code: RADAR_REASON_CODES.VERIFICATION_REQUIRED,
      reason: "La fuente primaria recuperada demuestra que el instante contractual sigue abierto y permite una resolución objetiva.",
      confidence: 100,
      ttl_minutes: 360,
    } : null;
    const predictive = !deterministic && !deterministicOpen && canApplyPredictivePolicyOverride(adapted, decision, now)
      ? evaluatePredictiveEligibility(adapted, facts, now)
      : null;
    let eligibilityDecision = deterministic ?? deterministicOpenDecision ?? predictive ?? decision;
    const unsupportedModelFact = Boolean(inferredDeterministic) && !deterministic;
    const rawModelTerminal = !deterministic && !deterministicOpen && !predictive
      && decision.eligible === false
      && decision.conclusive === true
      && cleanText(decision.reason_code, 100) !== RADAR_REASON_CODES.VERIFICATION_REQUIRED;
    if ((rawModelTerminal || unsupportedModelFact) && !deterministicOpen) {
      eligibilityDecision = {
        eligible: false,
        conclusive: false,
        reason_code: RADAR_REASON_CODES.VERIFICATION_REQUIRED,
        reason: "El modelo señaló un posible bloqueo, pero ninguna regla determinista confirmó esa conclusión con el contenido recuperado.",
        confidence: 0,
        ttl_minutes: 5,
      };
    }
    const aiConclusionPresent = decision.conclusive === true
      && isRecord(decision.facts)
      && Object.values(facts).some((value) => value !== null && value !== "");
    const verifiedDirectEvidence = evidence.some((item) => isVerifiedOfficialEvidence(item, true));
    if (eligibilityDecision.eligible === true && eligibilityDecision.conclusive === true
      && (!isAdaptedIdeaComplete(adapted) || !verifiedDirectEvidence || (!deterministicOpen && !aiConclusionPresent))) {
      eligibilityDecision = {
        eligible: false,
        conclusive: false,
        reason_code: RADAR_REASON_CODES.VERIFICATION_REQUIRED,
        reason: !verifiedDirectEvidence || !aiConclusionPresent
          ? "La verificación automática no aportó contenido oficial recuperado y una conclusión factual completas."
          : "La candidata no conserva una pregunta, criterios y fuente de resolución verificables.",
        confidence: 0,
        ttl_minutes: 5,
      };
    }
    const decisionCandidate = predictive
      ? {
        ...adapted,
        hard_reject_reasons: (adapted.hard_reject_reasons ?? []).filter((reason: unknown) => !new Set<string>([
          RADAR_REASON_CODES.EVENT_OUTSIDE_CONTRACT,
          RADAR_REASON_CODES.SUBJECT_NOT_ANNOUNCED,
          RADAR_REASON_CODES.TEMPORAL_INCOHERENCE,
        ]).has(cleanText(reason, 100))),
      }
      : adapted;
    const result = applyEligibilityDecision(decisionCandidate, {
      ...eligibilityDecision,
      fact_status: deterministic?.reason_code === RADAR_REASON_CODES.EVENT_ALREADY_RESOLVED ? "fully_resolved"
        : eligibilityDecision.eligible === true && eligibilityDecision.conclusive === true ? "unresolved"
          : "unknown",
      evidence,
    }, now);
    const parentResolvedAt = safeIsoDate(facts.event_resolved_at ?? facts.official_reveal_at);
    if (parentResolvedAt
      && result.verification_reason_code === RADAR_REASON_CODES.EVENT_ALREADY_RESOLVED
      && evidence.length
      && (safeNumber(result.verification_confidence) ?? 0) >= 85) {
      eventResolutions.push({
        event_group_key: cleanText(candidate.event_group_key, 240),
        candidate_identity: candidateIdentity(candidate),
        resolved_at: parentResolvedAt,
        reason: result.verification_reason,
        confidence: result.verification_confidence,
        ttl_minutes: safeNumber(decision.ttl_minutes) ?? 360,
        evidence,
      });
    }
    return result;
  });
  return {
    candidates: verified,
    decisionCount: byIndex.size,
    incompleteCount: Math.max(0, candidates.length - byIndex.size),
    eventResolutions,
  };
}

async function verifyAndAdaptWithGemini(apiKey: string, candidates: JsonRecord[], existing: JsonRecord[], evidenceByGroup: Map<string, JsonRecord[]>, now: string): Promise<GeminiVerificationOutcome> {
  if (!apiKey) throw new Error("PROVIDER_NOT_CONFIGURED");
  const plan = buildGeminiCandidateBatches(candidates, {
    maxGroups: MAX_GEMINI_GROUPS,
    maxCandidates: MAX_GEMINI_CANDIDATES,
    batchSize: GEMINI_BATCH_SIZE,
  }) as { batches: JsonRecord[][]; deferred: JsonRecord[] };
  if (!plan.batches.length) {
    return {
      candidates,
      processedDecisions: 0,
      failedBatches: 0,
      incompleteCandidates: plan.deferred.length,
      deferredCandidates: plan.deferred.length,
      firstError: null,
    };
  }
  const quotaCircuit: GeminiQuotaCircuit = { stopped: false, firstRateLimit: null };
  const settled: Array<PromiseSettledResult<GeminiBatchResult> | undefined> = new Array(plan.batches.length);
  let batchCursor = 0;
  async function runGeminiWorker() {
    while (!quotaCircuit.stopped) {
      const index = batchCursor++;
      if (index >= plan.batches.length) return;
      try {
        settled[index] = {
          status: "fulfilled",
          value: await verifyGeminiBatch(apiKey, plan.batches[index], existing, evidenceByGroup, now, quotaCircuit),
        };
      } catch (reason) {
        settled[index] = { status: "rejected", reason };
        if (isProviderRateLimit(reason)) {
          quotaCircuit.stopped = true;
          if (reason instanceof ProviderRequestError) quotaCircuit.firstRateLimit ??= reason;
        }
      }
    }
  }
  await Promise.all(Array.from(
    { length: Math.min(GEMINI_CONCURRENCY, plan.batches.length) },
    runGeminiWorker,
  ));
  const verifiedByIdentity = new Map<string, JsonRecord>();
  const eventResolutions: JsonRecord[] = [];
  let processedDecisions = 0;
  let failedBatches = 0;
  let incompleteCandidates = 0;
  let quotaDeferredCandidates = 0;
  let firstError: unknown | null = null;
  for (let index = 0; index < settled.length; index += 1) {
    const result = settled[index];
    const batch = plan.batches[index];
    if (!result) {
      quotaDeferredCandidates += batch.length;
      incompleteCandidates += batch.length;
      for (const candidate of failClosedCandidates(
        batch,
        now,
        "La cuota del proveedor se agotó; la candidata queda diferida y permanece en revisión.",
        5,
      )) {
        verifiedByIdentity.set(candidateIdentity(candidate), candidate);
      }
      continue;
    }
    if (result.status === "fulfilled") {
      processedDecisions += result.value.decisionCount;
      incompleteCandidates += result.value.incompleteCount;
      eventResolutions.push(...result.value.eventResolutions);
      for (const candidate of result.value.candidates) verifiedByIdentity.set(candidateIdentity(candidate), candidate);
      continue;
    }
    failedBatches += 1;
    incompleteCandidates += batch.length;
    if (!firstError) firstError = result.reason;
    for (const candidate of failClosedCandidates(batch, now, "La verificación automática de este lote no concluyó; la candidata permanece en revisión.", 5)) {
      verifiedByIdentity.set(candidateIdentity(candidate), candidate);
    }
  }
  for (const candidate of failClosedCandidates(plan.deferred, now, "La candidata queda en revisión para el siguiente lote automático.", 5)) {
    verifiedByIdentity.set(candidateIdentity(candidate), candidate);
  }
  const verified = candidates.map((candidate) => verifiedByIdentity.get(candidateIdentity(candidate))
    ?? failClosedCandidates([candidate], now, "La verificación automática no devolvió una decisión concluyente.", 5)[0]);
  eventResolutions.push(...officialEventResolutionSignals(candidates, evidenceByGroup, now));
  return {
    candidates: propagateResolvedEventGroups(verified, eventResolutions, now),
    processedDecisions,
    failedBatches,
    incompleteCandidates: incompleteCandidates + plan.deferred.length,
    deferredCandidates: plan.deferred.length + quotaDeferredCandidates,
    firstError: quotaCircuit.firstRateLimit ?? firstError,
  };
}

function failClosedCandidates(candidates: JsonRecord[], now: string, reason: string, ttlMinutes = 10) {
  return candidates.map((candidate) => applyEligibilityDecision(candidate, {
    eligible: false,
    conclusive: false,
    reason_code: RADAR_REASON_CODES.VERIFICATION_REQUIRED,
    reason,
    confidence: 0,
    ttl_minutes: ttlMinutes,
    evidence: [],
  }, now));
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
  factCheck: JsonRecord;
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
    const rawResult = await rpc(environment, "upsert_market_radar_batch_with_fact_checks_v2", {
      provider_input: provider,
      cache_key_input: cacheKey,
      normalizer_version_input: RADAR_NORMALIZER_VERSION,
      candidates_input: entries.map(({ candidate, factCheck }) => ({
        ...candidate,
        fact_context_fingerprint: factCheck.context_sha256,
        fact_policy_version: RADAR_FACT_POLICY_VERSION,
      })),
      fact_checks_input: entries.map(({ factCheck }) => factCheck),
      fact_policy_version_input: RADAR_FACT_POLICY_VERSION,
      provider_status_input: {
        status: "partial_error",
        is_cached: false,
        error_code: "RADAR_REFRESH_IN_PROGRESS",
        error_message: "La actualización del proveedor todavía no ha finalizado.",
      },
    }, undefined, true, { signal: controller.signal });
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
      operation: "upsert_market_radar_batch_with_fact_checks_v2",
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
      const entries = await Promise.all(batch.map(async (candidate) => ({
        candidate,
        factCheck: await buildAuthoritativeFactCheck(
          candidate,
          "discovery",
          safeIsoDate(candidate.fact_checked_at ?? candidate.verified_at) ?? new Date().toISOString(),
        ),
      })));
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
      await finalizeProviderRefresh(environment, provider, cacheKey, "available", persistedCount, undefined, {
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

async function persistProcessorSuccess(environment: Environment, cacheKey: string, resultCount: number) {
  await finalizeProviderRefresh(
    environment,
    "gemini",
    cacheKey,
    "available",
    Math.min(Math.max(resultCount, 0), MAX_GEMINI_CANDIDATES),
    undefined,
    { accepted: Math.min(Math.max(resultCount, 0), MAX_GEMINI_CANDIDATES) },
  ).catch(() => null);
}

async function persistProcessorPartialFailure(environment: Environment, cacheKey: string, failure: JsonRecord, processedDecisions: number) {
  const message = `${cleanText(failure.message, 220) || "La verificación automática quedó incompleta."} Decisiones válidas: ${Math.max(processedDecisions, 0)}.`;
  const status = cleanText(failure.code, 80) === "PROVIDER_RATE_LIMITED"
    ? "rate_limited"
    : processedDecisions === 0 ? "unavailable" : "partial_error";
  await finalizeProviderRefresh(
    environment,
    "gemini",
    cacheKey,
    status,
    Math.min(Math.max(processedDecisions, 0), MAX_GEMINI_CANDIDATES),
    {
      provider: "gemini",
      code: cleanText(failure.code, 80) || "PROCESSING_INCOMPLETE",
      status: Number(failure.status) || 206,
      message,
      retry_after_seconds: Number(failure.retry_after_seconds) || null,
    },
    {
      accepted: Math.min(Math.max(processedDecisions, 0), MAX_GEMINI_CANDIDATES),
      failed: 1,
    },
  ).catch(() => null);
}

function hasCurrentDiscoveryFact(candidate: JsonRecord, checkedAt = Date.now()): boolean {
  const factCheckedAt = Date.parse(cleanText(candidate.fact_checked_at, 100));
  const factExpiresAt = Date.parse(cleanText(candidate.fact_check_expires_at, 100));
  const verificationExpiresAt = Date.parse(cleanText(candidate.verification_expires_at, 100));
  const verificationStatus = cleanText(candidate.verification_status, 80);
  return cleanText(candidate.fact_check_purpose, 40) === "discovery"
    && cleanText(candidate.fact_policy_version, 100) === RADAR_FACT_POLICY_VERSION
    && Boolean(candidate.current_fact_check_id)
    && /^[a-f0-9]{64}$/i.test(cleanText(candidate.fact_context_fingerprint, 80))
    && Number.isFinite(factCheckedAt)
    && factCheckedAt <= checkedAt + 60_000
    && Number.isFinite(factExpiresAt)
    && factExpiresAt > checkedAt
    && (verificationStatus !== "verified_open"
      || (cleanText(candidate.fact_status, 40) === "unresolved"
        && Number.isFinite(verificationExpiresAt)
        && verificationExpiresAt > checkedAt));
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
    rpc(environment, "list_market_radar_candidates_v2", {
      provider_filter: filters.provider === "all" ? null : filters.provider,
      category_filter: filters.category || null,
      quality_filter: filters.quality,
      query_filter: filters.query || null,
      order_key: filters.order,
      horizon_filter: filters.horizon,
      limit_count: 240,
      offset_count: 0,
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
  const candidates = toRecordArray(candidatesPayload)
    .filter((candidate) => cleanText(candidate.eligibility_policy_version, 80) === RADAR_ELIGIBILITY_POLICY_VERSION)
    .filter((candidate) => hasCurrentDiscoveryFact(candidate, checkedAt))
    .filter((candidate) => !Number.isFinite(minimumCheckedAt)
      || Date.parse(cleanText(candidate.fact_checked_at, 100)) >= minimumCheckedAt);
  const rejected = toRecordArray(rejectedPayload);
  const groups = diversifyGroups(groupCandidates(candidates), MAX_VISIBLE_GROUPS);
  return {
    candidates,
    groups,
    rejected: summarizeRejections(rejected),
    providers: toRecordArray(providers),
  };
}

async function runDiscovery(environment: Environment, authorization: string, body: JsonRecord) {
  const filters = safeFilters(body);
  const cacheKey = buildCacheKey(filters);
  const current = await loadRadarView(environment, authorization, filters);
  const requestedRefresh = body.refresh === true;
  const latest = current.providers.map((provider) => Date.parse(cleanText(provider.fetched_at, 100))).filter(Number.isFinite).sort((a, b) => b - a)[0] || 0;
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
    // Si todavía no existe cobertura autoritativa, la UI debe conservar la
    // recuperación pendiente incluso durante el cooldown. Así puede programar
    // una única actualización para el instante en que venza, en vez de dejar
    // un estado vacío que solo se recupera con otra acción manual.
    const requiresFactualRefresh = !cachedAuthoritative;
    return jsonResponse({
      ok: true,
      ...current,
      cached_candidate_count: current.candidates.length,
      filters,
      cache_key: cacheKey,
      cached: true,
      cached_authoritative: cachedAuthoritative,
      requires_factual_refresh: requiresFactualRefresh,
      cooldown_seconds: Math.ceil(cooldownRemaining / 1000),
      limits: { max_pages: MAX_PROVIDER_PAGES, max_kalshi_series: MAX_KALSHI_SERIES, max_visible_groups: MAX_VISIBLE_GROUPS },
    });
  }

  const now = new Date().toISOString();
  const authoritativeDomains = await loadAuthoritativeSourceDomains(environment).catch(() => new Set<string>());
  const reconciledProviderResults = await reconcileRejectedKalshiOutcomes(
    environment,
    toRecordArray(current.rejected?.items),
    cacheKey,
    now,
  ).catch(() => 0);
  const existing = await loadExistingDefinitions(environment, authorization);
  const requestedProviders = filters.provider === "all" ? ["polymarket", "kalshi"] : filters.provider === "tavily" ? [] : [filters.provider];
  const errors: JsonRecord[] = [];
  const providers = requestedProviders.filter((provider) => {
    const circuit = activeProviderCircuit(current.providers, provider);
    if (!circuit) return true;
    errors.push(circuit);
    return false;
  });
  const discoveredByProvider = new Map<string, JsonRecord[]>();
  const discoveryResults = await mapWithConcurrency(providers, Math.max(1, providers.length), async (provider) => ({
    provider,
    candidates: provider === "polymarket" ? await discoverPolymarket(now, filters) : await discoverKalshi(now),
  }));
  for (let index = 0; index < discoveryResults.length; index += 1) {
    const result = discoveryResults[index];
    const provider = providers[index];
    if (result.status === "fulfilled") {
      discoveredByProvider.set(result.value.provider, result.value.candidates as JsonRecord[]);
      continue;
    }
    const failure = providerFailure(result.reason, provider);
    errors.push(failure);
    await persistProviderFailure(environment, provider, cacheKey, failure);
  }

  // La puerta factual se ejecuta sobre el evento canónico completo antes de que
  // la puntuación o las relaciones de duplicidad puedan clasificar la candidata.
  let candidates = [...discoveredByProvider.values()].flat();
  const cachedVerification = new Map(
    [...current.candidates, ...toRecordArray(current.rejected?.items)]
      .map((item) => [candidateIdentity(item), item]),
  );
  const reusable: JsonRecord[] = [];
  const needsVerification: JsonRecord[] = [];
  const deterministicRejections: JsonRecord[] = [];
  const deferredProviderDecisions = new Map<string, JsonRecord>();
  for (const candidate of candidates) {
    const providerDecision = evaluateProviderEligibility(candidate, now);
    if (providerDecision
      && cleanText(providerDecision.reason_code, 100) === RADAR_REASON_CODES.EVENT_ALREADY_RESOLVED
      && Boolean(normalizeProviderResult(candidate.source_result))) {
      deterministicRejections.push(applyEligibilityDecision(candidate, providerDecision, now) as JsonRecord);
      continue;
    }
    if (providerDecision) deferredProviderDecisions.set(candidateIdentity(candidate), providerDecision as JsonRecord);
    const cached = cachedVerification.get(candidateIdentity(candidate));
    if (cached && canReuseRadarVerification(cached, candidate, now)) {
      reusable.push({
        ...candidate,
        atinara_question: cached.atinara_question ?? candidate.atinara_question,
        atinara_category: cached.atinara_category ?? candidate.atinara_category,
        atinara_resolution_criteria: cached.atinara_resolution_criteria ?? candidate.atinara_resolution_criteria,
        atinara_resolution_source_url: cached.atinara_resolution_source_url ?? cached.source_resolution_url ?? candidate.atinara_resolution_source_url ?? candidate.source_resolution_url,
        verification_status: cached.verification_status,
        verification_reason_code: cached.verification_reason_code,
        verification_reason: cached.verification_reason,
        verified_at: cached.verified_at,
        verification_expires_at: cached.verification_expires_at,
        verification_evidence: cached.verification_evidence,
        verification_confidence: cached.verification_confidence,
        fact_status: cached.fact_status,
        fact_checked_at: cached.fact_checked_at,
        fact_policy_version: cached.fact_policy_version,
        fact_context_fingerprint: cached.fact_context_fingerprint,
        quality_status: cached.quality_status,
        state: cached.state ?? candidate.state,
      });
    } else {
      needsVerification.push(providerDecision ? withoutDeferredProviderClosure(candidate) : candidate);
    }
  }
  let evidenceByGroup = new Map<string, JsonRecord[]>();
  let newlyVerified: JsonRecord[] = [];
  let deferredVerificationCount = 0;
  let processedVerificationCount = 0;
  let failedVerificationBatches = 0;
  if (needsVerification.length) {
    try {
      evidenceByGroup = await researchGroupsWithTavily(environment.tavilyKey, needsVerification, authoritativeDomains);
      await persistProviderResult(environment, "tavily", cacheKey, []);
    } catch (error) {
      const failure = error instanceof Error && error.message === "PROVIDER_NOT_CONFIGURED"
        ? publicProviderError("tavily", "PROVIDER_NOT_CONFIGURED", 503)
        : providerFailure(error, "tavily");
      errors.push(failure);
      await persistProviderFailure(environment, "tavily", cacheKey, failure);
    }
    try {
      const circuit = activeProviderCircuit(current.providers, "gemini");
      if (circuit) {
        throw new ProviderRequestError(
          "PROVIDER_RATE_LIMITED",
          429,
          Math.max(1, Number(circuit.retry_after_seconds) || 60) * 1_000,
        );
      }
      const outcome = await verifyAndAdaptWithGemini(environment.geminiKey, needsVerification, existing, evidenceByGroup, now);
      newlyVerified = outcome.candidates;
      deferredVerificationCount = outcome.deferredCandidates;
      processedVerificationCount = outcome.processedDecisions;
      failedVerificationBatches = outcome.failedBatches;
      if (outcome.failedBatches > 0 || outcome.incompleteCandidates > 0) {
        const failure = outcome.firstError
          ? providerFailure(outcome.firstError, "gemini")
          : { provider: "gemini", code: "PROCESSING_INCOMPLETE", status: 206, message: "Una parte de las candidatas queda en revisión para el siguiente lote automático." };
        errors.push(failure);
        await persistProcessorPartialFailure(environment, cacheKey, failure, outcome.processedDecisions);
      } else {
        await persistProcessorSuccess(environment, cacheKey, outcome.processedDecisions);
      }
    } catch (error) {
      const failure = error instanceof Error && error.message === "PROVIDER_NOT_CONFIGURED"
        ? publicProviderError("gemini", "PROVIDER_NOT_CONFIGURED", 503)
        : providerFailure(error, "gemini");
      errors.push(failure);
      await persistProcessorPartialFailure(environment, cacheKey, failure, 0);
      newlyVerified = failClosedCandidates(needsVerification, now, "La verificación automática no está disponible; el evento permanece bloqueado para preparación.", 60);
    }
  }

  candidates = [...deterministicRejections, ...reusable, ...newlyVerified];
  candidates = propagateResolvedEventGroups(
    candidates,
    [
      ...officialEventResolutionSignals(candidates, evidenceByGroup, now),
      ...buildCoverResolutionSignals(candidates, now),
    ],
    now,
  );
  candidates = candidates.map((candidate) => {
    if (cleanText(candidate.fact_status, 40) === "fully_resolved"
      || cleanText(candidate.verification_status, 80) === "rejected_resolved") return candidate;
    const providerDecision = deferredProviderDecisions.get(candidateIdentity(candidate));
    return providerDecision ? applyEligibilityDecision(candidate, {
      ...providerDecision,
      fact_status: providerDecisionFactStatus(candidate, providerDecision),
    }, now) as JsonRecord : candidate;
  });

  candidates = candidates.map((candidate) => normalizeRadarCandidatePresentation(candidate) as JsonRecord);
  const scored = scoreCandidates(candidates, existing, now) as JsonRecord[];
  const quarantinedCandidates: RadarCandidateQuarantine[] = [];
  const qualityNotices: JsonRecord[] = [];
  const deferredPersistenceBatches: RadarPersistenceDeferredBatch[] = [];
  for (const provider of discoveredByProvider.keys()) {
    try {
      const outcome = await persistProviderResult(
        environment,
        provider,
        cacheKey,
        scored.filter((candidate) => candidate.provider === provider).slice(0, MAX_NORMALIZED_PER_PROVIDER),
      );
      quarantinedCandidates.push(...outcome.quarantined);
      if (outcome.quarantined.length) {
        qualityNotices.push({
          ...quarantinedProviderNotice(provider, outcome.quarantined.length),
          quarantined_count: outcome.quarantined.length,
          quarantined: outcome.quarantined,
          persisted_count: outcome.persistedCount,
        });
      }
      deferredPersistenceBatches.push(...outcome.deferred);
      if (outcome.failure) {
        errors.push({
          ...outcome.failure,
          quarantined_count: outcome.quarantined.length,
          quarantined: outcome.quarantined,
          deferred_count: deferredPersistenceCandidateCount(outcome),
          deferred_batches: outcome.deferred,
          persisted_count: outcome.persistedCount,
          persistence_rpc_count: outcome.persistenceRpcCalls,
        });
      }
    } catch (error) {
      const failure = error instanceof RadarPersistenceError
        ? error.failure
        : persistenceFailure(error, provider);
      if (error instanceof RadarPersistenceError) {
        quarantinedCandidates.push(...error.outcome.quarantined);
        if (error.outcome.quarantined.length) {
          qualityNotices.push({
            ...quarantinedProviderNotice(provider, error.outcome.quarantined.length),
            quarantined_count: error.outcome.quarantined.length,
            quarantined: error.outcome.quarantined,
            persisted_count: error.outcome.persistedCount,
          });
        }
        deferredPersistenceBatches.push(...error.outcome.deferred);
        Object.assign(failure, {
          quarantined_count: error.outcome.quarantined.length,
          quarantined: error.outcome.quarantined,
          deferred_count: deferredPersistenceCandidateCount(error.outcome),
          deferred_batches: error.outcome.deferred,
          persisted_count: error.outcome.persistedCount,
          persistence_rpc_count: error.outcome.persistenceRpcCalls,
        });
      }
      errors.push(failure);
    }
  }
  // Una respuesta marcada como fresca solo puede contener snapshots creados por
  // esta ejecución. Si un proveedor falló, su antigua caché no reaparece como
  // una propuesta recién verificada.
  const view = await loadRadarView(environment, authorization, filters, now);
  return jsonResponse({
    ok: true,
    ...view,
    filters,
    cache_key: cacheKey,
    cached: false,
    cached_authoritative: false,
    requires_factual_refresh: false,
    partial: errors.length > 0,
    errors,
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
    limits: {
      max_pages: MAX_PROVIDER_PAGES,
      max_kalshi_series: MAX_KALSHI_SERIES,
      max_visible_groups: MAX_VISIBLE_GROUPS,
      max_gemini_groups: MAX_GEMINI_GROUPS,
      max_gemini_candidates: MAX_GEMINI_CANDIDATES,
      gemini_batch_size: GEMINI_BATCH_SIZE,
      max_rejected_outcome_reconciliations: MAX_REJECTED_OUTCOME_RECONCILIATIONS,
    },
  });
}

function candidatePreflight(candidate: JsonRecord): { ok: true } | { ok: false; error: string; message: string } {
  if (cleanText(candidate.normalizer_version, 80) !== RADAR_NORMALIZER_VERSION) return { ok: false, error: "NORMALIZER_OUTDATED", message: "La candidata debe actualizarse con el normalizador vigente." };
  if (cleanText(candidate.eligibility_policy_version, 80) !== RADAR_ELIGIBILITY_POLICY_VERSION) return { ok: false, error: "ELIGIBILITY_POLICY_OUTDATED", message: "La candidata debe revisarse con el criterio predictivo vigente. Actualiza el Radar." };
  const state = cleanText(candidate.state, 40);
  if (["prepared", "dismissed", "expired"].includes(state)) return { ok: false, error: "CANDIDATE_NOT_PREPARABLE", message: "La candidata ya no está disponible para preparar." };
  if (toRecordArray(candidate.duplicate_matches).some(isBlockingDuplicateMatch)) return { ok: false, error: "CONFIRMED_DUPLICATE", message: "La candidata coincide con un mercado o borrador existente." };
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
  if (!["available", "needs_review", "prepared"].includes(state)) return { ok: false, error: "CANDIDATE_NOT_REVALIDATABLE", message: "La candidata ya no admite una comprobación factual de publicación." };
  const verificationStatus = cleanText(candidate.verification_status, 80);
  if (verificationStatus.startsWith("rejected_")) {
    const rejection = prepareRevalidationError(candidate);
    return { ok: false, error: rejection?.error ?? "RADAR_CANDIDATE_INELIGIBLE", message: rejection?.message ?? "La candidata ya no es elegible." };
  }
  return { ok: true };
}

function candidateReady(candidate: JsonRecord): { ok: true } | { ok: false; error: string; message: string } {
  const preflight = candidatePreflight(candidate);
  if (!preflight.ok) return preflight;
  if (cleanText(candidate.verification_status, 80) !== "verified_open") return { ok: false, error: "VERIFICATION_REQUIRED", message: "La candidata no tiene una verificación factual vigente." };
  if (cleanText(candidate.fact_status, 40) !== "unresolved"
    || cleanText(candidate.fact_policy_version, 100) !== RADAR_FACT_POLICY_VERSION
    || cleanText(candidate.fact_check_purpose, 40) !== "prepare"
    || !candidate.current_fact_check_id
    || !/^[a-f0-9]{64}$/i.test(cleanText(candidate.fact_context_fingerprint, 80))) {
    return { ok: false, error: "FACT_CHECK_REQUIRED", message: "La candidata no conserva un snapshot factual autoritativo para esta preparación." };
  }
  if (!isAdaptedIdeaComplete(candidate)) return { ok: false, error: "RESOLUTION_SOURCE_REQUIRED", message: "La candidata no conserva una pregunta, criterios y fuente de resolución verificables." };
  const expiresAt = Date.parse(cleanText(candidate.verification_expires_at, 100));
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return { ok: false, error: "VERIFICATION_EXPIRED", message: "La verificación factual ha caducado. Actualiza el Radar." };
  const factCheckedAt = Date.parse(cleanText(candidate.fact_checked_at, 100));
  const factExpiresAt = Date.parse(cleanText(candidate.fact_check_expires_at, 100));
  if (!Number.isFinite(factCheckedAt) || !Number.isFinite(factExpiresAt)
    || factCheckedAt > Date.now() + 60_000 || factExpiresAt <= Date.now()) {
    return { ok: false, error: "FACT_CHECK_EXPIRED", message: "El snapshot factual ha caducado y debe repetirse." };
  }
  if (cleanText(candidate.state, 40) !== "available") return { ok: false, error: "CANDIDATE_NOT_PREPARABLE", message: "La candidata ya no está disponible para preparar." };
  return { ok: true };
}

function evidenceDomainAllowed(item: JsonRecord, authoritativeDomains: ReadonlySet<string>): boolean {
  const publicUrl = safePublicUrl(item.url);
  if (!publicUrl) return false;
  try {
    const hostname = new URL(publicUrl).hostname.toLowerCase();
    return [...authoritativeDomains].some((domain) => hostname === domain || hostname.endsWith(`.${domain}`));
  } catch {
    return false;
  }
}

async function candidateReadyForPrepareAttempt(
  candidate: JsonRecord,
  factCheck: JsonRecord,
  checkedAt: string,
  authoritativeDomains: ReadonlySet<string>,
): Promise<{ ok: true } | { ok: false; error: string; message: string }> {
  if (cleanText(candidate.verification_status, 80) !== "verified_open") {
    return { ok: false, error: "VERIFICATION_REQUIRED", message: "La comprobación factual no permite preparar esta candidata." };
  }
  if (cleanText(candidate.fact_status, 40) !== "unresolved"
    || cleanText(factCheck.fact_status, 40) !== "unresolved"
    || cleanText(factCheck.fact_policy_version, 100) !== RADAR_FACT_POLICY_VERSION
    || cleanText(factCheck.purpose, 40) !== "prepare") {
    return { ok: false, error: "FACT_CHECK_REQUIRED", message: "La preparación no conserva un snapshot factual no resuelto y autoritativo." };
  }
  if (!isAdaptedIdeaComplete(candidate)) {
    return { ok: false, error: "RESOLUTION_SOURCE_REQUIRED", message: "Faltan la pregunta, los criterios o una fuente de resolución verificable." };
  }
  const verificationExpiresAt = Date.parse(cleanText(candidate.verification_expires_at, 100));
  if (!Number.isFinite(verificationExpiresAt) || verificationExpiresAt <= Date.parse(checkedAt)) {
    return { ok: false, error: "VERIFICATION_EXPIRED", message: "La verificación factual ha caducado." };
  }
  const factExpiresAt = Date.parse(cleanText(factCheck.expires_at, 100));
  if (!Number.isFinite(factExpiresAt) || factExpiresAt <= Date.parse(checkedAt)) {
    return { ok: false, error: "FACT_CHECK_EXPIRED", message: "El snapshot factual de preparación ha caducado." };
  }
  const evidence = toRecordArray(factCheck.source_snapshot);
  const checkedAtMs = Date.parse(checkedAt);
  let hasCurrentProof = false;
  for (const item of evidence) {
    if (!evidenceDomainAllowed(item, authoritativeDomains)
      || evidenceHasPotentialTerminalClaim(item, candidate, checkedAt)) {
      return { ok: false, error: "RADAR_FACT_EVIDENCE_REQUIRED", message: "La evidencia primaria ya no supera la validación autoritativa." };
    }
    if (!isDeterministicUnresolvedEvidence(item, candidate, checkedAt)) continue;
    const retrievedAt = Date.parse(cleanText(item.retrieved_at, 100));
    const unresolvedUntil = Date.parse(cleanText(item.unresolved_until, 100));
    const excerpt = cleanText(item.unresolved_proof_excerpt, 700);
    const excerptHash = cleanText(item.unresolved_proof_excerpt_sha256, 80);
    if (Number.isFinite(checkedAtMs)
      && Number.isFinite(retrievedAt)
      && retrievedAt >= checkedAtMs - (10 * 60_000)
      && retrievedAt <= checkedAtMs + 60_000
      && Number.isFinite(unresolvedUntil)
      && unresolvedUntil > checkedAtMs + 60_000
      && unresolvedUntil <= checkedAtMs + (10 * 365.25 * 24 * 60 * 60_000)
      && await sha256Hex(excerpt) === excerptHash) {
      hasCurrentProof = true;
    }
  }
  if (!hasCurrentProof) {
    return { ok: false, error: "RADAR_FACT_EVIDENCE_REQUIRED", message: "No existe evidencia primaria vigente que demuestre que el contrato continúa sin resolver." };
  }
  return { ok: true };
}

function refreshCandidateCacheLease(candidate: JsonRecord, checkedAt: string): JsonRecord {
  return {
    ...candidate,
    fetched_at: checkedAt,
    cache_expires_at: new Date(Date.parse(checkedAt) + (20 * 60_000)).toISOString(),
  };
}

async function revalidatePolymarketCandidate(candidate: JsonRecord): Promise<JsonRecord | null> {
  const eventSlug = cleanText(candidate.external_event_slug, 400);
  const marketId = cleanText(candidate.external_market_id, 220);
  if (!eventSlug || !marketId) return null;
  const event = toRecord(await fetchJson(new URL(`${POLYMARKET_GAMMA_ROOT}/events/slug/${encodeURIComponent(eventSlug)}`)));
  const markets = toRecordArray(event?.markets);
  if (!event || !markets.length || markets.length > MAX_CANONICAL_EVENT_CHILDREN) return null;
  const canonicalEvent = { ...event, markets, canonical_url_verified: true };
  const adapted = await attachCanonicalFactContext(
    adaptPolymarketResponse({ events: [canonicalEvent] }, { now: new Date().toISOString(), cacheMinutes: 20, canonicalUrlVerified: true }) as JsonRecord[],
    [canonicalEvent],
    "polymarket",
  );
  const current = adapted.find((item) => cleanText(item.external_market_id, 220) === marketId);
  return current ? { ...candidate, ...current, id: candidate.id, preparation_revision: candidate.preparation_revision } : null;
}

async function revalidateKalshiCandidate(candidate: JsonRecord): Promise<JsonRecord | null> {
  const eventTicker = cleanText(candidate.external_event_id, 220);
  const marketTicker = cleanText(candidate.external_market_id, 220);
  if (!eventTicker || !marketTicker) return null;
  const url = new URL(`${KALSHI_API_ROOT}/events/${encodeURIComponent(eventTicker)}`);
  url.searchParams.set("with_nested_markets", "true");
  const payload = toRecord(await fetchJson(url)) ?? {};
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
  return current ? { ...candidate, ...current, id: candidate.id, preparation_revision: candidate.preparation_revision } : null;
}

async function revalidateCriticalEligibility(environment: Environment, authorization: string, candidate: JsonRecord): Promise<JsonRecord> {
  const authoritativeDomains = await loadAuthoritativeSourceDomains(environment).catch(() => new Set<string>());
  const evidenceByGroup = await researchGroupsWithTavily(environment.tavilyKey, [candidate], authoritativeDomains);
  const existing = await loadExistingDefinitions(environment, authorization);
  const checked = await verifyAndAdaptWithGemini(environment.geminiKey, [candidate], existing, evidenceByGroup, new Date().toISOString());
  if (checked.failedBatches > 0 || checked.incompleteCandidates > 0 || checked.processedDecisions !== 1) {
    throw new Error("PROVIDER_INVALID_RESPONSE");
  }
  return normalizeRadarCandidatePresentation(
    checked.candidates[0] ?? failClosedCandidates([candidate], new Date().toISOString(), "La verificación factual no pudo concluir antes de preparar el borrador.")[0],
  ) as JsonRecord;
}

async function revalidateCandidateForPreparation(
  environment: Environment,
  authorization: string,
  candidate: JsonRecord,
  purpose: "prepare" | "revalidate" = "prepare",
  attemptId: string = crypto.randomUUID(),
): Promise<{ candidate: JsonRecord; checkedAt: string; reservation: JsonRecord }> {
  let providerCandidate: JsonRecord | null = null;
  let providerUnavailable = false;
  try {
    providerCandidate = candidate.provider === "polymarket"
      ? await revalidatePolymarketCandidate(candidate)
      : candidate.provider === "kalshi" ? await revalidateKalshiCandidate(candidate) : null;
  } catch {
    // El intento fallido se convierte en una decisión negativa y se persiste con
    // su snapshot mediante la RPC atómica antes de devolver el error al cliente.
    providerCandidate = null;
    providerUnavailable = true;
  }

  let checkedAt = new Date().toISOString();
  const providerDecision = providerCandidate ? evaluateProviderEligibility(providerCandidate, checkedAt) as JsonRecord | null : null;
  let factuallyRevalidated = !providerCandidate
    ? refreshCandidateCacheLease(applyEligibilityDecision(candidate, {
      eligible: false,
      conclusive: !providerUnavailable,
      reason_code: providerUnavailable ? RADAR_REASON_CODES.VERIFICATION_REQUIRED : RADAR_REASON_CODES.PROVIDER_CHILD_NOT_FOUND,
      reason: providerUnavailable
        ? "La revalidación del proveedor no estuvo disponible; no se infiere que el mercado esté cerrado."
        : "El evento canónico ya no conserva la opción verificada.",
      confidence: providerUnavailable ? 0 : 100,
      ttl_minutes: 5,
      fact_status: "unknown",
      evidence: [],
    }, checkedAt) as JsonRecord, checkedAt)
    : refreshCandidateCacheLease(withoutDeferredProviderClosure(providerCandidate), checkedAt);
  if (providerCandidate && !canReuseRadarVerification(candidate, providerCandidate, checkedAt)) {
    try {
      factuallyRevalidated = refreshCandidateCacheLease(
        await revalidateCriticalEligibility(environment, authorization, providerCandidate),
        checkedAt,
      );
    } catch {
      factuallyRevalidated = refreshCandidateCacheLease(
        failClosedCandidates(
          [providerCandidate],
          checkedAt,
          "La fuente factual no devolvió una comprobación utilizable antes de preparar.",
          5,
        )[0],
        checkedAt,
      );
    }
  }
  if (providerDecision
    && cleanText(factuallyRevalidated.fact_status, 40) !== "fully_resolved"
    && cleanText(factuallyRevalidated.verification_status, 80) !== "rejected_resolved") {
    factuallyRevalidated = refreshCandidateCacheLease(applyEligibilityDecision(factuallyRevalidated, {
      ...providerDecision,
      fact_status: providerDecisionFactStatus(factuallyRevalidated, providerDecision),
    }, checkedAt) as JsonRecord, checkedAt);
  }

  // Una fila conocida no vuelve a pasar por el UPSERT de descubrimiento. Prepare
  // reserva una sola vez; revalidate agrega un snapshot post-preparación sin
  // reservar ni revisar el borrador ligado.
  checkedAt = new Date().toISOString();
  factuallyRevalidated = refreshCandidateCacheLease(factuallyRevalidated, checkedAt);
  const expectedRevision = Number(candidate.preparation_revision);
  const factCheck = await buildAuthoritativeFactCheck(
    factuallyRevalidated,
    purpose,
    checkedAt,
    purpose === "prepare" ? attemptId : crypto.randomUUID(),
  );
  const authoritativeVerification = {
    ...factuallyRevalidated,
    fact_context_fingerprint: factCheck.context_sha256,
    fact_policy_version: RADAR_FACT_POLICY_VERSION,
  };
  if (purpose === "prepare") {
    const authoritativeDomains = await loadAuthoritativeSourceDomains(environment).catch(() => new Set<string>());
    const readiness = await candidateReadyForPrepareAttempt(
      authoritativeVerification,
      factCheck,
      checkedAt,
      authoritativeDomains,
    );
    if (!readiness.ok) {
      const blockedVerification = {
        ...authoritativeVerification,
        verification_status: "needs_review",
        verification_reason_code: RADAR_REASON_CODES.VERIFICATION_REQUIRED,
        verification_reason: readiness.message,
        verification_confidence: 0,
        verification_expires_at: null,
        fact_status: "unknown",
      };
      const blockedFactCheck = await buildAuthoritativeFactCheck(
        blockedVerification,
        "prepare",
        checkedAt,
        attemptId,
      );
      const recordedAttempt = toRecord(await rpc(
        environment,
        "record_market_radar_prepare_attempt_v1",
        {
          candidate_id_input: cleanText(candidate.id, 80),
          expected_preparation_revision_input: Number.isSafeInteger(expectedRevision) ? expectedRevision : null,
          normalizer_version_input: RADAR_NORMALIZER_VERSION,
          verification_checked_at_input: checkedAt,
          verification_input: blockedVerification,
          fact_check_input: blockedFactCheck,
          attempt_id_input: attemptId,
        },
        undefined,
        true,
      ));
      if (recordedAttempt?.persisted !== true) throw new Error("RADAR_PREPARE_ATTEMPT_NOT_RECORDED");
      throw new RadarPreparationBlockedError(
        cleanText(recordedAttempt.error, 100) || readiness.error,
        recordedAttempt,
      );
    }
  }
  const rpcName = purpose === "prepare"
    ? "apply_market_radar_prepare_fact_verification_v1"
    : "apply_market_radar_revalidation_fact_v1";
  const applied = toRecord(await rpc(environment, rpcName, {
    candidate_id_input: cleanText(candidate.id, 80),
    expected_preparation_revision_input: Number.isSafeInteger(expectedRevision) ? expectedRevision : null,
    normalizer_version_input: RADAR_NORMALIZER_VERSION,
    verification_checked_at_input: checkedAt,
    verification_input: authoritativeVerification,
    fact_check_input: factCheck,
  }, undefined, true));
  if (!applied?.ok) {
    throw new Error(cleanText(applied?.error, 100) || "PREPARE_REJECTED");
  }
  const authoritativeCandidate = toRecord(applied.candidate);
  if (!authoritativeCandidate) throw new Error("CANDIDATE_NOT_FOUND");
  if (purpose === "prepare") {
    const factualReadiness = candidateReady(authoritativeCandidate);
    if (!factualReadiness.ok) throw new Error(factualReadiness.error);
  } else if (cleanText(authoritativeCandidate.fact_check_purpose, 40) !== "revalidate"
    || cleanText(authoritativeCandidate.fact_status, 40) !== "unresolved"
    || cleanText(authoritativeCandidate.verification_status, 80) !== "verified_open") {
    const outcome = prepareRevalidationError(authoritativeCandidate);
    throw new RadarRevalidationOutcomeError(outcome?.error ?? "RADAR_REVALIDATION_REQUIRED", authoritativeCandidate);
  }
  return {
    candidate: authoritativeCandidate,
    checkedAt,
    reservation: toRecord(applied.reservation) ?? {},
  };
}

function prepareRevalidationError(candidate: JsonRecord): { error: string; message: string } | null {
  const status = cleanText(candidate.verification_status, 80);
  if (status === "verified_open") return null;
  if (status === "rejected_resolved") return { error: "RADAR_CANDIDATE_RESOLVED", message: "El resultado ya es público y la candidata no puede prepararse." };
  if (status === "rejected_unannounced") return { error: "RADAR_CANDIDATE_UNANNOUNCED", message: "La candidata depende de un producto no anunciado para un resultado posterior, como un premio o una reseña." };
  if (["rejected_ineligible", "rejected_incoherent"].includes(status)) return { error: "RADAR_CANDIDATE_INELIGIBLE", message: "La candidata no es temporal o factualmente compatible con el contrato." };
  if (status === "rejected_invalid_source") return { error: "RADAR_CANONICAL_URL_INVALID", message: "No se pudo validar la fuente o el enlace canónico de la candidata." };
  if (status === "rejected_duplicate") return { error: "RADAR_CONFIRMED_DUPLICATE", message: "La candidata coincide con un mercado o borrador existente." };
  return { error: "RADAR_REVALIDATION_REQUIRED", message: "La verificación factual no ha concluido. La candidata permanece bloqueada." };
}

async function handleAction(
  environment: Environment,
  authorization: string,
  adminId: string,
  body: JsonRecord,
) {
  const action = cleanText(body.action, 40);
  if (action === "discover") return runDiscovery(environment, authorization, body);
  if (action === "provider-status") {
    const providers = await rpc(environment, "get_market_radar_provider_status", {}, authorization);
    return jsonResponse({ ok: true, providers: toRecordArray(providers) });
  }
  const candidateId = cleanText(body.candidate_id, 80);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(candidateId)) {
    return jsonResponse({ error: "INVALID_CANDIDATE", message: "La candidata solicitada no es válida." }, 400);
  }
  if (action === "details") {
    const candidate = toRecord(await rpc(environment, "get_market_radar_candidate", { candidate_id_input: candidateId }, authorization));
    return jsonResponse({ ok: true, candidate: candidate ?? {} });
  }
  if (["prepare", "revalidate"].includes(action)) {
    // La lectura de preparación es service-only y degrada cualquier snapshot no
    // vigente a needs_review. El endpoint administrativo directo nunca entrega
    // esa fila como verified_open, pero la Edge aún puede revalidarla de cero.
    const candidate = toRecord(await rpc(environment, "get_market_radar_candidate_for_revalidation_v1", { candidate_id_input: candidateId }, undefined, true));
    if (!candidate) return jsonResponse({ error: "CANDIDATE_NOT_FOUND", message: "No se encontró la candidata." }, 404);
    const preflight = action === "prepare"
      ? candidatePreflight(candidate)
      : candidateRevalidationPreflight(candidate);
    if (!preflight.ok) return jsonResponse({ error: preflight.error, message: preflight.message }, 409);
    const legacyDraftId = action === "revalidate" ? cleanText(body.draft_id, 80) : "";
    const legacyDraftVersion = Number(body.draft_version);
    const legacyDraftFingerprint = action === "revalidate" ? cleanText(body.draft_fingerprint, 80) : "";
    if (legacyDraftId && (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(legacyDraftId)
      || !Number.isSafeInteger(legacyDraftVersion)
      || legacyDraftVersion < 1
      || !/^[0-9a-f]{64}$/.test(legacyDraftFingerprint)
    )) {
      return jsonResponse({
        error: "RADAR_LEGACY_ATTESTATION_INPUT_INVALID",
        message: "El vínculo del borrador cambió o no contiene una huella autoritativa.",
      }, 400);
    }
    let result: { candidate: JsonRecord; checkedAt: string; reservation: JsonRecord };
    let legacyAttestation: JsonRecord | null = null;
    const requestedOperationId = cleanText(body.operation_id, 80);
    const operationId = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestedOperationId)
      ? requestedOperationId
      : crypto.randomUUID();
    try {
      result = await revalidateCandidateForPreparation(
        environment,
        authorization,
        candidate,
        action === "prepare" ? "prepare" : "revalidate",
        operationId,
      );
      if (legacyDraftId) {
        const candidateRevision = Number(result.candidate.preparation_revision);
        const revalidationFactId = Number(result.candidate.current_fact_check_id);
        if (!Number.isSafeInteger(candidateRevision) || candidateRevision < 1
          || !Number.isSafeInteger(revalidationFactId) || revalidationFactId < 1) {
          throw new Error("RADAR_FACTUAL_REFRESH_REQUIRED");
        }
        legacyAttestation = toRecord(await rpc(
          environment,
          "attest_legacy_market_radar_draft_fact_v1",
          {
            draft_id_input: legacyDraftId,
            candidate_id_input: candidateId,
            expected_draft_version_input: legacyDraftVersion,
            expected_draft_fingerprint_input: legacyDraftFingerprint,
            expected_candidate_revision_input: candidateRevision,
            expected_revalidation_fact_check_id_input: revalidationFactId,
            actor_id_input: adminId,
          },
          undefined,
          true,
        ));
        if (!legacyAttestation?.ok) {
          throw new Error(cleanText(legacyAttestation?.error, 100) || "RADAR_LEGACY_ATTESTATION_FAILED");
        }
      }
    } catch (error) {
      const code = error instanceof Error ? cleanText(error.message, 100) : "RADAR_REVALIDATION_REQUIRED";
      const errors: Record<string, { status: number; message: string }> = {
        PROVIDER_NOT_OPEN: { status: 409, message: "El mercado de origen ya no está abierto o no conserva la opción verificada." },
        PROVIDER_INVALID_RESPONSE: { status: 503, message: "La fuente factual no devolvió una comprobación utilizable. La candidata permanece bloqueada." },
        VERIFICATION_REQUIRED: { status: 409, message: "La comprobación factual actual no permite preparar esta candidata." },
        RADAR_REVALIDATION_REQUIRED: { status: 409, message: "La comprobación factual actual no permite preparar esta candidata." },
        RADAR_CANDIDATE_RESOLVED: { status: 409, message: "El resultado ya es público y la candidata no puede prepararse." },
        RADAR_CANDIDATE_UNANNOUNCED: { status: 409, message: "La candidata depende de un producto no anunciado para un resultado posterior." },
        RADAR_CANDIDATE_INELIGIBLE: { status: 409, message: "La candidata no es temporal o factualmente compatible con el contrato." },
        RADAR_CANONICAL_URL_INVALID: { status: 409, message: "No se pudo validar la fuente o el enlace canónico de la candidata." },
        RADAR_CONFIRMED_DUPLICATE: { status: 409, message: "La candidata coincide con un mercado o borrador existente." },
        VERIFICATION_EXPIRED: { status: 409, message: "La comprobación factual ha caducado y debe repetirse." },
        FACT_CHECK_REQUIRED: { status: 409, message: "Falta el snapshot factual autoritativo de esta preparación." },
        FACT_CHECK_EXPIRED: { status: 409, message: "El snapshot factual ha caducado y debe repetirse." },
        RADAR_FACT_EVIDENCE_REQUIRED: { status: 409, message: "No existe evidencia primaria vigente de que el contrato continúe sin resolver." },
        RESOLUTION_SOURCE_REQUIRED: { status: 409, message: "Faltan la pregunta, los criterios o una fuente de resolución verificable." },
        PREPARATION_REVISION_MISMATCH: { status: 409, message: "La candidata cambió durante la comprobación. Vuelve a aplicar para usar su versión actual." },
        CANDIDATE_NOT_REVALIDATABLE: { status: 409, message: "La candidata ya no admite una comprobación factual de publicación." },
        CONFIRMED_DUPLICATE: { status: 409, message: "La candidata coincide con un mercado o borrador existente." },
        DRAFT_VERSION_MOVED: { status: 409, message: "El borrador cambió durante la comprobación factual. Vuelve a abrirlo." },
        DRAFT_FINGERPRINT_MOVED: { status: 409, message: "La huella del borrador cambió durante la comprobación factual. Vuelve a abrirlo." },
        RADAR_DRAFT_CANDIDATE_MISMATCH: { status: 409, message: "El borrador ya no está ligado a esta candidata Radar." },
        RADAR_LEGACY_DRAFT_NOT_ELIGIBLE: { status: 409, message: "El borrador heredado no cumple las condiciones de recuperación factual segura." },
        RADAR_LEGACY_ATTESTATION_REJECTED: { status: 409, message: "La atestación factual heredada no coincide con el borrador actual." },
        RADAR_LEGACY_ATTESTATION_FAILED: { status: 409, message: "No se pudo atestar de forma atómica el origen factual heredado." },
      };
      if (error instanceof RadarPreparationBlockedError) {
        const failure = errors[error.code] ?? {
          status: 409,
          message: "La comprobación factual quedó registrada, pero no permite preparar esta candidata.",
        };
        return jsonResponse({
          error: error.code,
          message: failure.message,
          attempt_id: operationId,
          phase: "factual_revalidation",
          retryable: error.retryable,
          candidate: error.diagnostics.candidate,
          attempt_fact_check_id: error.diagnostics.attempt_fact_check_id,
          authoritative_fact_check_id: error.diagnostics.authoritative_fact_check_id,
          preparation_revision: error.diagnostics.preparation_revision,
          persisted: error.diagnostics.persisted,
          authoritative_pointer_unchanged: error.diagnostics.authoritative_pointer_unchanged,
          state_preserved: error.diagnostics.authoritative_pointer_unchanged !== false,
        }, 409);
      }
      if (error instanceof RadarRevalidationOutcomeError) {
        const failure = errors[error.code] ?? {
          status: 409,
          message: "La comprobación factual quedó registrada y la candidata permanece bloqueada.",
        };
        return jsonResponse({
          error: error.code,
          message: failure.message,
          attempt_id: operationId,
          phase: "factual_revalidation",
          retryable: false,
          candidate: error.candidate,
          fact_check_id: error.candidate.current_fact_check_id ?? null,
          preparation_revision: error.candidate.preparation_revision ?? null,
          authoritative_state_updated: true,
          state_preserved: true,
        }, 409);
      }
      const failure = errors[code] ?? { status: 503, message: "No se pudo repetir la comprobación factual. La candidata permanece bloqueada y no se ha preparado ningún borrador." };
      return jsonResponse({
        error: code,
        message: failure.message,
        attempt_id: operationId,
        phase: "factual_revalidation",
        retryable: failure.status === 429 || failure.status >= 500,
        state_preserved: true,
      }, failure.status);
    }
    return jsonResponse({
      ok: true,
      candidate: result.candidate,
      preparation_revision: result.candidate.preparation_revision,
      fact_check_id: result.candidate.current_fact_check_id,
      reservation: result.reservation,
      prefill: buildDraftPrefill(result.candidate),
      revalidated: true,
      prepared: action === "prepare",
      legacy_fact_attestation: legacyAttestation,
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
  const environment = getEnvironment();
  if (!environment) return jsonResponse({ error: "SERVER_NOT_CONFIGURED", message: "El Radar no está configurado en el servidor." }, 503);
  const auth = await authenticateAdmin(environment, authorization);
  if (auth instanceof Response) return auth;
  try {
    const rawBody = await req.text();
    if (new TextEncoder().encode(rawBody).byteLength > MAX_REQUEST_BYTES) return jsonResponse({ error: "REQUEST_TOO_LARGE", message: "La petición es demasiado grande." }, 413);
    const parsedBody = toRecord(JSON.parse(rawBody));
    if (!parsedBody) return jsonResponse({ error: "INVALID_REQUEST", message: "La petición no es válida." }, 400);
    return await handleAction(environment, authorization, auth.adminId, parsedBody);
  } catch (error) {
    console.error("Market Radar request failed", error instanceof Error ? error.name : "UnknownError");
    return jsonResponse({ error: "RADAR_FAILED", message: "No se pudo completar la operación del Radar." }, 500);
  }
});
