import "jsr:@supabase/functions-js/edge-runtime.d.ts";

import {
  RESOLUTION_DEADLINE_POLICY,
  deriveResolutionDeadline,
  inferMetricContract,
} from "../_shared/market-draft-repair.mjs";
import { agentToolSummary } from "../_shared/atinara-agent-runtime.mjs";
import { createAtinaraAgentRunV2 } from "../_shared/atinara-agent-runtime-v2.mjs";
import {
  ATINARA_AGENT_REGISTRY_VERSION,
  assertAgentRegistrySnapshot,
} from "../_shared/atinara-agent-registries-v2.mjs";
import { createAiGateway } from "../_shared/ai/gateway.mjs";
import { createAbsoluteExecutionContext, createChildAbort, deadlineSleep, fetchWithinDeadline } from "../_shared/ai/deadline.mjs";
import { AI_TASK_CONTRACTS } from "../_shared/ai/task-policy.mjs";
import { createAiPersistence } from "../_shared/ai/persistence.mjs";
import { persistAgentTelemetry } from "../_shared/ai/telemetry.mjs";

type JsonRecord = Record<string, unknown>;

type SupabaseEnvironment = {
  supabaseUrl: string;
  publishableKey: string;
  secretKey: string;
  execution: { invocationId: string; agentRunId: string | null; absoluteDeadlineAt: number; signal: AbortSignal };
};

const MARKET_INTELLIGENCE_POLICY_VERSION = "atinara-market-constitution-v1";
const MARKET_EXPERT_SCHEMA_VERSION = "atinara-market-expert-v1";
const SOURCE_CONTRACT_SCHEMA_VERSION = "atinara-resolution-contract-v1";
const MARKET_EXPERT_IMPLEMENTATION_VERSION = "radar-intelligence-bridge-v5";
const RADAR_NORMALIZER_VERSION = "atinara-radar-v2";
const RADAR_ELIGIBILITY_POLICY_VERSION = "atinara-prediction-policy-v5";
const MAX_REQUEST_BYTES = 12_288;
const OPERATION_TIMEOUT_MS = 110_000;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const ALLOWED_PROVIDER_HOSTS: Record<string, readonly string[]> = {
  tavily: ["api.tavily.com"],
};

const EXPERT_DECISIONS = new Set([
  "create",
  "create_with_edits",
  "reject",
  "stale",
  "merge_duplicate",
  "escalate",
]);
const INTEGRITY_STATUSES = new Set(["pass", "needs_edit", "fail"]);
const FORECASTABILITY_STATUSES = new Set([
  "forecastable",
  "valid_low_probability",
  "valid_very_unlikely",
  "already_determined",
  "stale",
  "unknown",
]);
const SOURCE_READINESS_STATUSES = new Set([
  "ready",
  "ready_with_warnings",
  "needs_official_source",
  "needs_monitoring",
  "not_resolvable",
]);
const CAPTURE_STRATEGIES = new Set([
  "current_at_resolution",
  "snapshot_at_deadline",
  "poll_during_window",
  "event_presence",
  "static_revalidation",
  "manual_official_source",
]);
const AGGREGATIONS = new Set([
  "final",
  "maximum",
  "minimum",
  "any_true",
  "all_true",
  "count",
  "exact_state",
]);
const SOURCE_ROLES = new Set([
  "DISCOVERY_SIGNAL",
  "PROBABILITY_SIGNAL",
  "CONTEXT_SOURCE",
  "PRIMARY_RESOLUTION",
  "FALLBACK_RESOLUTION",
  "CORROBORATION",
  "PROHIBITED_FOR_RESOLUTION",
]);
const HARD_REASON_CODES = new Set([
  "DETERMINISTIC_GATE_BLOCKED",
  "EVENT_ALREADY_RESOLVED",
  "TEMPORAL_WINDOW_ALREADY_ENDED",
  "TEMPORAL_INCOHERENCE",
  "DUPLICATE_MARKET",
  "CONFIRMED_DUPLICATE",
  "SOURCE_ALREADY_RESOLVED",
  "SOURCE_NOT_RESOLVABLE",
  "RADAR_ELIGIBILITY_REQUIRED",
  "RADAR_CANDIDATE_NOT_PREPARABLE",
  "RADAR_NORMALIZER_OUTDATED",
  "RADAR_ELIGIBILITY_POLICY_OUTDATED",
  "RADAR_RESOLUTION_SOURCE_REQUIRED",
  "MARKET_EXPERT_ANALYSIS_STALE",
]);
const DERIVED_REASON_CODES = new Set([
  "RADAR_CANDIDATE_NOT_PREPARABLE",
  "DETERMINISTIC_GATE_BLOCKED",
  "INTEGRITY_FAILED",
  "FORECASTABILITY_CLOSED",
  "EXPERT_DECISION_BLOCKED",
]);
const TERMINAL_REASON_CODES = new Set([
  "EVENT_ALREADY_RESOLVED",
  "TEMPORAL_WINDOW_ALREADY_ENDED",
  "DUPLICATE_MARKET",
  "CONFIRMED_DUPLICATE",
  "SOURCE_ALREADY_RESOLVED",
  "SOURCE_NOT_RESOLVABLE",
]);
const REPAIR_MATERIALIZATION_REASON_CODES = new Set([
  "RADAR_RESOLUTION_SOURCE_REQUIRED",
  "TEMPORAL_INCOHERENCE",
]);

function text(value: unknown, max = 4_000): string {
  return String(value ?? "").trim().slice(0, max);
}

function records(value: unknown): JsonRecord[] {
  return Array.isArray(value)
    ? value.filter((item) => item && typeof item === "object" && !Array.isArray(item)) as JsonRecord[]
    : [];
}

function record(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : null;
}

class MarketExpertRpcError extends Error {
  readonly status: number;
  readonly databaseCode: string;
  readonly detail: string;

  constructor(code: string, status: number, databaseCode = "", detail = "") {
    super(code);
    this.name = "MarketExpertRpcError";
    this.status = status;
    this.databaseCode = databaseCode;
    this.detail = detail;
  }
}

function uniqueStrings(values: unknown[]): string[] {
  return [...new Set(values.map((value) => text(value, 200)).filter(Boolean))];
}

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

function configuredKey(variable: string, legacy: string): string {
  const configured = Deno.env.get(variable);
  if (configured) {
    try {
      const parsed = JSON.parse(configured) as Record<string, string>;
      if (parsed.default) return parsed.default;
    } catch {
      // Compatibilidad con secretos anteriores de Supabase.
    }
  }
  return Deno.env.get(legacy) ?? "";
}

function getSupabaseEnvironment(execution: SupabaseEnvironment["execution"]): SupabaseEnvironment | null {
  const value = {
    supabaseUrl: Deno.env.get("SUPABASE_URL") ?? "",
    publishableKey: configuredKey("SUPABASE_PUBLISHABLE_KEYS", "SUPABASE_ANON_KEY"),
    secretKey: configuredKey("SUPABASE_SECRET_KEYS", "SUPABASE_SERVICE_ROLE_KEY"),
    execution,
  };
  return value.supabaseUrl && value.publishableKey && value.secretKey ? value : null;
}

function restHeaders(key: string, authorization?: string): Record<string, string> {
  const headers: Record<string, string> = {
    apikey: key,
    "Content-Type": "application/json",
  };
  if (authorization) headers.Authorization = authorization;
  else if (!key.startsWith("sb_secret_")) headers.Authorization = `Bearer ${key}`;
  return headers;
}

function fetchInternal(
  environment: SupabaseEnvironment,
  input: string,
  init: RequestInit,
  timeoutPolicyMs = 30_000,
): Promise<Response> {
  return fetchWithinDeadline(input, init, environment.execution, {
    timeoutPolicyMs,
    finalizationReserveMs: 15_000,
  });
}

async function rpc(
  environment: SupabaseEnvironment,
  name: string,
  args: JsonRecord,
  options: { authorization?: string; service?: boolean } = {},
): Promise<unknown> {
  const key = options.service ? environment.secretKey : environment.publishableKey;
  const response = await fetchInternal(environment, `${environment.supabaseUrl}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: restHeaders(key, options.service ? undefined : options.authorization),
    body: JSON.stringify(args),
    signal: environment.execution.signal,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const errorPayload = record(payload);
    const domainCode = text(errorPayload?.message, 120);
    const databaseCode = text(errorPayload?.code, 40);
    const detail = text(errorPayload?.details, 300);
    const safeCode = /^[A-Z][A-Z0-9_]{2,100}$/.test(domainCode) ? domainCode : `RPC_${response.status}`;
    console.error("Market expert RPC failed", JSON.stringify({ name, status: response.status, code: databaseCode || null }));
    throw new MarketExpertRpcError(safeCode, response.status, databaseCode, detail);
  }
  return payload;
}

async function authenticateAdmin(
  environment: SupabaseEnvironment,
  authorization: string,
): Promise<{ adminId: string } | Response> {
  if (!authorization.startsWith("Bearer ")) {
    return jsonResponse({ error: "AUTH_REQUIRED", message: "Inicia sesión para usar esta herramienta administrativa." }, 401);
  }
  const response = await fetchInternal(environment, `${environment.supabaseUrl}/auth/v1/user`, {
    headers: { Authorization: authorization, apikey: environment.publishableKey },
    signal: environment.execution.signal,
  }, 20_000);
  if (!response.ok) {
    return jsonResponse({ error: "AUTH_REQUIRED", message: "La sesión ha caducado." }, 401);
  }
  const user = await response.json() as JsonRecord;
  const metadata = user.app_metadata && typeof user.app_metadata === "object"
    ? user.app_metadata as JsonRecord
    : {};
  if (metadata.oraklo_admin !== true) {
    return jsonResponse({ error: "ADMIN_REQUIRED", message: "Esta herramienta es privada para administración." }, 403);
  }
  return { adminId: text(user.id, 80) };
}

async function secureTokenMatch(candidate: string, expected: string): Promise<boolean> {
  if (!candidate || !expected) return false;
  const encode = (value: string) => new TextEncoder().encode(value);
  const [left, right] = await Promise.all([
    crypto.subtle.digest("SHA-256", encode(candidate)),
    crypto.subtle.digest("SHA-256", encode(expected)),
  ]);
  const leftBytes = new Uint8Array(left);
  const rightBytes = new Uint8Array(right);
  let difference = leftBytes.length ^ rightBytes.length;
  for (let index = 0; index < Math.min(leftBytes.length, rightBytes.length); index += 1) {
    difference |= leftBytes[index] ^ rightBytes[index];
  }
  return difference === 0;
}

async function authenticateAdminOrService(
  environment: SupabaseEnvironment,
  authorization: string,
  allowService = false,
): Promise<{ adminId: string; isService?: boolean } | Response> {
  if (allowService && authorization.startsWith("Bearer ")) {
    const candidate = authorization.slice(7);
    const legacyServiceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    if (
      await secureTokenMatch(candidate, environment.secretKey) ||
      await secureTokenMatch(candidate, legacyServiceRole)
    ) {
      return { adminId: "scheduled-service", isService: true };
    }
  }
  return authenticateAdmin(environment, authorization);
}

async function readJsonBody(req: Request): Promise<JsonRecord> {
  const length = Number(req.headers.get("content-length") || 0);
  if (length > MAX_REQUEST_BYTES) throw new Error("REQUEST_TOO_LARGE");
  const raw = await req.text();
  if (new TextEncoder().encode(raw).byteLength > MAX_REQUEST_BYTES) throw new Error("REQUEST_TOO_LARGE");
  const parsed = raw ? JSON.parse(raw) : {};
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("INVALID_REQUEST");
  return parsed as JsonRecord;
}

async function fetchProviderJson(
  provider: keyof typeof ALLOWED_PROVIDER_HOSTS,
  urlInput: URL,
  init: RequestInit,
  options: {
    timeoutMs?: number;
    maxBytes?: number;
    retries?: number;
    execution?: SupabaseEnvironment["execution"];
  } = {},
) {
  if (
    urlInput.protocol !== "https:" ||
    !ALLOWED_PROVIDER_HOSTS[provider]?.includes(urlInput.hostname.toLowerCase())
  ) {
    throw new Error("PROVIDER_HOST_NOT_ALLOWED");
  }
  const timeoutMs = Math.min(Math.max(options.timeoutMs ?? 12_000, 1_000), 35_000);
  const maxBytes = Math.min(Math.max(options.maxBytes ?? 1_000_000, 1_000), 3_000_000);
  const retries = Math.min(Math.max(options.retries ?? 0, 0), 1);
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const execution = options.execution;
    if (!execution) throw new Error("ABSOLUTE_DEADLINE_REQUIRED");
    const child = createChildAbort(execution, timeoutMs, 15_000);
    try {
      const response = await fetch(urlInput, { ...init, redirect: "error", signal: child.signal });
      if (!response.ok) {
        if ((response.status === 429 || response.status >= 500) && attempt < retries) {
          await deadlineSleep(500 * (attempt + 1), execution, 15_000);
          continue;
        }
        if (response.status === 429) throw new Error("PROVIDER_RATE_LIMITED");
        if (response.status === 401 || response.status === 403) throw new Error("PROVIDER_UNAUTHORIZED");
        throw new Error(`PROVIDER_HTTP_${response.status}`);
      }
      const raw = await response.text();
      if (raw.length > maxBytes) throw new Error("PROVIDER_RESPONSE_TOO_LARGE");
      try {
        return { data: JSON.parse(raw), headers: response.headers };
      } catch {
        throw new Error("PROVIDER_INVALID_RESPONSE");
      }
    } catch (error) {
      if (error instanceof DOMException && ["AbortError", "TimeoutError"].includes(error.name)) throw new Error("PROVIDER_TIMEOUT");
      if (attempt >= retries) throw error;
    } finally {
      child.cleanup();
    }
  }
  throw new Error("PROVIDER_UNAVAILABLE");
}

function publicErrorCode(error: unknown, fallback = "SERVICE_UNAVAILABLE"): string {
  const message = error instanceof Error ? error.message : String(error || "");
  return /^[A-Z][A-Z0-9_]{2,100}$/.test(message) ? message : fallback;
}

function handleEdgeError(error: unknown, fallbackMessage: string): Response {
  const code = publicErrorCode(error);
  const upstreamStatus = error instanceof MarketExpertRpcError ? error.status : 0;
  const status = [400, 401, 403, 404, 409, 422, 429, 503, 504].includes(upstreamStatus)
    ? upstreamStatus
    : ["REQUEST_TOO_LARGE", "INVALID_REQUEST", "INTELLIGENCE_ORIGIN_INVALID"].includes(code)
    ? 400
    : code.includes("AUTH") ? 401
      : code.includes("ADMIN") ? 403
        : ["PREPARATION_REVISION_MISMATCH", "MARKET_EXPERT_ANALYSIS_STALE", "RADAR_ELIGIBILITY_REQUIRED"].includes(code) ? 409
          : code === "INTELLIGENCE_ORIGIN_NOT_FOUND" ? 404 : 503;
  const message = code === "PREPARATION_REVISION_MISMATCH"
    ? "La candidata cambió durante el análisis. Vuelve a aplicar para usar su revisión vigente."
    : fallbackMessage;
  return jsonResponse({
    error: code,
    message,
    classification: status === 429 || status >= 500 ? "technical" : "domain",
    retryable: status === 429 || status >= 500,
    state_preserved: true,
    publishes: false,
    confirms: false,
  }, status);
}

async function sha256(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function safeDate(value: unknown): Date | null {
  const date = value ? new Date(String(value)) : null;
  return date && Number.isFinite(date.getTime()) ? date : null;
}

function safeHttpsUrl(value: unknown): string {
  try {
    const url = new URL(text(value, 2_048));
    return url.protocol === "https:" ? url.toString() : "";
  } catch {
    return "";
  }
}

function safeHostname(value: unknown): string | null {
  const url = safeHttpsUrl(value);
  return url ? new URL(url).hostname.toLowerCase() : null;
}

function hasOfficialResolutionSourceProof(origin: JsonRecord): boolean {
  const sourceUrl = safeHttpsUrl(origin.atinara_resolution_source_url || origin.source_resolution_url);
  if (!sourceUrl) return false;
  const evidence = [
    ...records(origin.resolution_source_evidence),
    ...records(origin.eligibility_evidence),
    ...records(origin.verification_evidence),
  ];
  return evidence.some((item) => safeHttpsUrl(item.url) === sourceUrl
    && item.source_type === "official"
    && item.retrieval_status === "verified_content"
    && item.evidence_basis === "retrieved_content"
    && item.claim_status === "direct"
    && item.direct_claim === true);
}

function slugify(value: unknown): string {
  const slug = text(value, 500)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 110);
  return slug.length >= 3 ? slug : `mercado-${Date.now()}`;
}

function normalizeProbability(value: unknown): number | null {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  if (number > 1 && number <= 100) return number / 100;
  return number >= 0 && number <= 1 ? number : null;
}

const INJECTION_PATTERNS = [
  /ignore (?:all|any|the) previous/i,
  /system prompt/i,
  /developer message/i,
  /reveal (?:your|the) (?:instructions|secrets|token)/i,
  /execute (?:sql|javascript|code|command)/i,
  /act as (?:an?|the) (?:system|administrator)/i,
  /<\/?(?:system|assistant|tool)>/i,
];

function sanitizeExternalText(value: unknown, maxLength = 4_000): string {
  return String(value ?? "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function inspectPromptInjection(value: unknown) {
  const safeText = sanitizeExternalText(value, 12_000);
  const suspicious = INJECTION_PATTERNS.some((pattern) => pattern.test(safeText));
  return {
    safe_text: safeText,
    suspicious,
    reason_codes: suspicious ? ["EXTERNAL_INSTRUCTION_IGNORED"] : [],
  };
}

function safeOrigin(origin: JsonRecord): JsonRecord {
  const allowed = [
    "id", "state", "provider", "warnings", "expires_at", "fetched_at", "external_id", "external_url",
    "source_title", "source_category", "source_close_at", "source_question", "source_description",
    "source_probability", "source_probability_yes", "source_resolution_url", "source_resolution_rules",
    "source_resolution_deadline", "source_status", "source_result", "source_volume", "source_volume_total",
    "source_liquidity", "quality_score", "quality_status", "event_group_key", "duplicate_matches",
    "external_event_id", "external_event_url", "external_market_id", "external_market_url",
    "atinara_category", "atinara_question", "atinara_closes_at", "atinara_resolution_criteria",
    "atinara_resolution_source_url", "resolution_source_evidence", "provider_payload", "verification_status", "verification_reason",
    "verification_reason_code", "verification_evidence", "verification_confidence", "verification_expires_at",
    "normalizer_version", "eligibility_policy_version", "eligibility_status", "eligibility_reason_code",
    "eligibility_reason", "eligibility_evidence", "eligibility_checked_at", "eligibility_expires_at",
    "current_eligibility_check_id", "fingerprint", "preparation_revision",
    "verified_at", "cache_expires_at", "quality_updated_at", "family_key", "family_title",
    "family_type", "family_child_key", "family_child_label", "family_relationship", "family_matches",
    "family_version", "family_semantics", "family_source_event_key", "family_sort_at",
    "signal_type", "entity_type", "entity_id", "parent_entity_id", "canonical_url", "title", "subtitle",
    "description", "observed_at", "source_updated_at", "valid_until", "signal_origin", "opportunity_type",
    "context_type", "catalyst_type", "milestone_metric", "milestone_value", "milestone_unit",
    "milestone_distance", "event_start_at", "event_end_at", "factual_basis", "contextual_basis",
    "inference_summary", "market_thesis", "why_now", "unresolved_question", "suggested_market_type",
    "metric_name", "metric_value", "metric_unit", "metric_precision", "metric_is_rounded", "previous_value",
    "change_value", "time_window_start", "time_window_end", "marketability_status",
    "marketability_reason_codes", "resolution_readiness", "suggested_question", "suggested_yes_criteria",
    "suggested_no_criteria", "suggested_edge_cases", "suggested_resolution_contract", "provider_policy_flags",
    "watch_entity_id", "recent_context", "official_event_url", "content_criterion", "viable_horizons_days",
  ];
  const output: JsonRecord = {};
  for (const key of allowed) {
    if (origin[key] !== undefined) output[key] = origin[key];
  }
  const textFields = [
    "source_title", "source_question", "source_description", "source_resolution_rules", "atinara_question",
    "atinara_resolution_criteria", "title", "subtitle", "description", "factual_basis", "contextual_basis",
    "inference_summary", "market_thesis", "why_now", "unresolved_question", "suggested_question",
    "suggested_yes_criteria", "suggested_no_criteria", "suggested_edge_cases", "content_criterion",
  ];
  for (const key of textFields) {
    if (typeof output[key] === "string") output[key] = inspectPromptInjection(output[key]).safe_text;
  }
  return output;
}

function analysisOriginSnapshot(origin: JsonRecord, originType: string): JsonRecord {
  if (originType !== "radar_candidate") return origin;
  const snapshot = { ...origin };
  // Son datos de lease/caché, no hechos del mercado ni del contrato. Excluirlos
  // mantiene la huella alineada con preparation_revision y evita invalidar un
  // dictamen únicamente porque el Radar renovó su caché.
  for (const key of [
    "fetched_at", "expires_at", "cache_expires_at", "is_stale", "cache_key", "updated_at",
    "eligibility_checked_at", "eligibility_expires_at", "current_eligibility_check_id",
  ]) {
    delete snapshot[key];
  }
  return snapshot;
}

function getOfficialResolutionUrl(origin: JsonRecord): string {
  const direct = [
    origin.atinara_resolution_source_url,
    origin.source_resolution_url,
    origin.official_event_url,
    origin.canonical_url,
  ].map(safeHttpsUrl).find(Boolean);
  if (direct) return direct;
  const officialEvidence = records(origin.verification_evidence)
    .find((item) => text(item.source_type, 40).toLowerCase() === "official");
  return safeHttpsUrl(officialEvidence?.url);
}

function buildSources(origin: JsonRecord, suppliedSources: unknown): JsonRecord[] {
  const supplied = records(suppliedSources);
  if (supplied.length) {
    return supplied.slice(0, 12).map((source, index) => ({
      url: safeHttpsUrl(source.url),
      role: SOURCE_ROLES.has(text(source.role, 60)) ? text(source.role, 60) : "CONTEXT_SOURCE",
      precedence: index + 1,
      required: source.required === true,
      fallback_condition: text(source.fallback_condition, 500) || null,
    })).filter((source) => source.url);
  }

  const output: JsonRecord[] = [];
  const seen = new Set<string>();
  const add = (urlValue: unknown, role: string, required = false) => {
    const url = safeHttpsUrl(urlValue);
    if (!url || seen.has(url)) return;
    seen.add(url);
    output.push({
      url,
      role,
      precedence: output.length + 1,
      required,
      fallback_condition: null,
    });
  };

  const primary = getOfficialResolutionUrl(origin);
  add(primary, "PRIMARY_RESOLUTION", true);

  const provider = text(origin.provider, 40).toLowerCase();
  if (["youtube", "twitch"].includes(provider) && !primary) {
    add(origin.canonical_url, "PRIMARY_RESOLUTION", true);
  } else if (provider === "igdb") {
    add(origin.canonical_url, "CORROBORATION", false);
  }

  add(origin.external_market_url || origin.external_event_url || origin.external_url, "DISCOVERY_SIGNAL", false);

  for (const evidence of records(origin.verification_evidence)) {
    const role = text(evidence.source_type, 40).toLowerCase() === "official"
      ? "CORROBORATION"
      : "CONTEXT_SOURCE";
    add(evidence.url, role, false);
    if (output.length >= 8) break;
  }

  return output;
}

function chooseMilestoneHorizon(origin: JsonRecord): string | null {
  const allowed = [14, 30, 60, 90];
  const viable = Array.isArray(origin.viable_horizons_days)
    ? new Set((origin.viable_horizons_days as unknown[]).map(Number))
    : new Set<number>();
  const days = allowed.find((candidate) => viable.size === 0 || viable.has(candidate));
  return days ? new Date(Date.now() + days * 86_400_000).toISOString() : null;
}

function detectStoryPattern(origin: JsonRecord): string | null {
  const context = `${text(origin.context_type)} ${text(origin.catalyst_type)} ${text(origin.opportunity_type)}`.toLowerCase();
  if (origin.milestone_metric && origin.milestone_value && text(origin.contextual_basis)) {
    return "MILESTONE_WITH_NARRATIVE";
  }
  if (
    origin.event_start_at &&
    origin.content_confirmed !== true &&
    /reveal|showcase|premiere|presentaci|estreno|scheduled/.test(context)
  ) {
    return "SCHEDULED_REVEAL_WITH_UNKNOWN_CONTENT";
  }
  if (/announcement|anuncio/.test(context) && origin.outcome_known !== true) {
    return "OFFICIAL_ANNOUNCEMENT_WITH_OPEN_CONSEQUENCE";
  }
  if (/release|platform|lanzamiento|plataforma/.test(context)) return "RELEASE_OR_PLATFORM_WINDOW";
  if (/live|stream|directo/.test(context) && origin.metric_name) return "LIVE_EVENT_THRESHOLD";
  if (/commitment|compromiso/.test(context) && origin.official_status === "official") return "CREATOR_COMMITMENT";
  return null;
}

function generateHypotheses(origin: JsonRecord): JsonRecord[] {
  if (origin.outcome_known === true || origin.marketability_status === "already_resolved") return [];
  if (
    origin.provider === "youtube" &&
    (origin.head_to_head === true || origin.mixed_provider_metric === true || origin.metric_hidden === true)
  ) {
    return [];
  }
  const pattern = detectStoryPattern(origin);
  if (!pattern) return [];
  const entity = text(origin.entity_label || origin.title || origin.source_title || "la entidad", 300);
  const base = {
    opportunity_type: text(origin.opportunity_type || "other_reviewed", 100),
    pattern,
    hypothesis_status: "generated",
    why_now: text(origin.why_now || "Existe un disparador factual reciente y una cuestión todavía abierta.", 2_000),
    market_thesis: text(
      origin.market_thesis ||
        "La señal puede convertirse en una pregunta binaria si conserva incertidumbre y una vía de resolución verificable.",
      4_000,
    ),
    factual_basis: text(origin.factual_basis, 4_000),
    contextual_basis: text(origin.contextual_basis, 4_000),
    unresolved_question: text(origin.unresolved_question, 2_000),
    rejection_reason_codes: [],
  };

  if (pattern === "MILESTONE_WITH_NARRATIVE") {
    const threshold = Number(origin.milestone_value);
    const evaluationAt = chooseMilestoneHorizon(origin);
    if (!Number.isFinite(threshold) || !origin.milestone_metric || !evaluationAt) return [];
    const formatted = new Intl.NumberFormat("es-ES", { maximumFractionDigits: 0 }).format(threshold);
    return [{
      ...base,
      proposed_question: `¿Alcanzará ${entity} al menos ${formatted} ${text(origin.milestone_unit || "", 100)} antes del ${new Intl.DateTimeFormat("es-ES", { dateStyle: "long", timeZone: "Europe/Madrid" }).format(new Date(evaluationAt))}?`,
      unresolved_question: text(
        origin.unresolved_question || `Si la métrica pública alcanzará ${formatted} dentro del horizonte seleccionado.`,
        2_000,
      ),
      resolution_path: {
        provider: origin.provider,
        metric: origin.milestone_metric,
        threshold,
        evaluation_at: evaluationAt,
        capture_strategy: "snapshot_at_deadline",
      },
    }];
  }

  if (pattern === "SCHEDULED_REVEAL_WITH_UNKNOWN_CONTENT") {
    if (!origin.event_start_at || !origin.official_event_url || !origin.content_criterion) return [];
    return [{
      ...base,
      proposed_question: `¿Mostrará ${entity} ${text(origin.content_criterion, 1_000)} durante el evento anunciado?`,
      unresolved_question: text(
        origin.unresolved_question || `Si el contenido oficial incluirá ${text(origin.content_criterion, 1_000)}.`,
        2_000,
      ),
      resolution_path: {
        provider: origin.provider,
        event_url: origin.official_event_url,
        evaluation_at: origin.event_start_at,
        capture_strategy: "manual_official_source",
        metric: "content_occurrence",
      },
    }];
  }

  if (origin.suggested_question && origin.resolution_path) {
    return [{ ...base, proposed_question: text(origin.suggested_question, 500), resolution_path: origin.resolution_path }];
  }
  return [];
}

function contractFromOrigin(origin: JsonRecord, hypothesis: JsonRecord | null, originType: string): JsonRecord {
  const supplied = origin.suggested_resolution_contract && typeof origin.suggested_resolution_contract === "object"
    ? origin.suggested_resolution_contract as JsonRecord
    : {};
  const path = hypothesis?.resolution_path && typeof hypothesis.resolution_path === "object"
    ? hypothesis.resolution_path as JsonRecord
    : {};

  const question = text(
    hypothesis?.proposed_question ||
      origin.atinara_question ||
      origin.suggested_question ||
      origin.source_question ||
      origin.title ||
      origin.source_title,
    500,
  );
  const evaluationAt = text(
    supplied.evaluation_at ||
      supplied.window_end ||
      path.evaluation_at ||
      origin.atinara_closes_at ||
      origin.source_close_at ||
      origin.time_window_end ||
      origin.event_start_at,
    120,
  ) || null;
  const primaryUrl = getOfficialResolutionUrl(origin);
  const captureStrategy = text(
    supplied.capture_strategy ||
      path.capture_strategy ||
      (originType === "radar_candidate"
        ? "manual_official_source"
        : origin.metric_name ? "snapshot_at_deadline" : "manual_official_source"),
    80,
  );
  const provider = originType === "radar_candidate"
    ? "official_web"
    : text(supplied.provider || path.provider || origin.provider, 40);
  const familySemantics = record(origin.family_semantics) || {};
  const familyThreshold = record(familySemantics.threshold) || {};
  const inferredMetric = inferMetricContract({
    draft: {
      question,
      yes_criteria: origin.atinara_resolution_criteria || origin.source_resolution_rules,
      primary_source: { url: primaryUrl },
    },
    radar_candidate: origin,
  });
  const operatorAliases: Record<string, string> = {
    gt: ">", gte: ">=", ge: ">=", lt: "<", lte: "<=", le: "<=",
  };
  const familyOperator = operatorAliases[text(familyThreshold.operator, 20).toLowerCase()]
    || text(familyThreshold.operator, 20);
  const resolutionDeadline = deriveResolutionDeadline(
    evaluationAt,
    [supplied.resolution_deadline, origin.source_resolution_deadline, origin.resolution_deadline],
    RESOLUTION_DEADLINE_POLICY,
  );

  const contract: JsonRecord = {
    plan_version: 1,
    contract_schema_version: SOURCE_CONTRACT_SCHEMA_VERSION,
    policy_version: MARKET_INTELLIGENCE_POLICY_VERSION,
    canonical_statement: question,
    origin_type: originType,
    origin_id: text(origin.id, 100),
    opportunity_type: text(hypothesis?.opportunity_type || origin.opportunity_type || "other_reviewed", 100),
    event_name: text(origin.title || origin.source_title, 300),
    official_event_url: primaryUrl || safeHttpsUrl(path.event_url),
    factual_basis_refs: [],
    contextual_basis_refs: [],
    content_criterion: text(origin.content_criterion, 1_000) || null,
    expected_boolean_state: null,
    evidence_mode: captureStrategy === "manual_official_source"
      ? "human_review_of_official_source"
      : "structured_provider_data",
    manual_review_instructions: captureStrategy === "manual_official_source"
      ? "Abrir la fuente oficial, comprobar el hecho contra los criterios aprobados y confirmar humanamente."
      : null,
    provider,
    provider_adapter_version: text(origin.adapter_version || origin.normalizer_version || "unknown", 100),
    entity_type: text(origin.entity_type, 80),
    entity_id: text(origin.entity_id || origin.external_id, 300),
    canonical_url: primaryUrl || safeHttpsUrl(origin.canonical_url),
    metric: text(supplied.metric || path.metric || inferredMetric?.metric || origin.metric_name, 200) || null,
    operator: text(supplied.operator || familyOperator || inferredMetric?.operator || (path.threshold !== undefined ? ">=" : "exact_state"), 20),
    threshold: supplied.threshold ?? familyThreshold.value ?? inferredMetric?.threshold ?? path.threshold ?? origin.milestone_value ?? null,
    unit: text(supplied.unit || familyThreshold.unit || inferredMetric?.unit || origin.metric_unit, 100) || null,
    precision: supplied.precision ?? inferredMetric?.precision ?? (text(origin.metric_precision, 200) || null),
    rounding_behavior: origin.metric_is_rounded
      ? "provider_rounded_down_three_significant_figures"
      : "provider_value",
    window_start: supplied.window_start || origin.time_window_start || new Date().toISOString(),
    window_end: evaluationAt,
    evaluation_at: evaluationAt,
    resolution_deadline: resolutionDeadline,
    resolution_deadline_policy_version: RESOLUTION_DEADLINE_POLICY.version,
    timezone: text(supplied.timezone || "Europe/Madrid", 100),
    finality_delay_seconds: Number(supplied.finality_delay_seconds) || 300,
    capture_strategy: captureStrategy,
    sampling_interval_seconds: Number(supplied.sampling_interval_seconds) ||
      (captureStrategy === "poll_during_window" ? 300 : 0),
    required_samples: Number(supplied.required_samples) || 1,
    aggregation: text(
      supplied.aggregation || inferredMetric?.aggregation ||
        (captureStrategy === "poll_during_window"
          ? "maximum"
          : captureStrategy === "manual_official_source" ? "exact_state" : "final"),
      40,
    ),
    maximum_monitor_duration_seconds: Number(supplied.maximum_monitor_duration_seconds) ||
      (captureStrategy === "poll_during_window" ? 21_600 : 0),
    missing_data_treatment: "manual_review_no_assumption",
    deleted_entity_treatment: "manual_review_or_annulment",
    hidden_metric_treatment: "not_resolvable",
    cancellation_treatment: "manual_review",
    postponement_treatment: "preserve_approved_period",
    source_conflict_treatment: "pause_and_human_review",
    provider_policy_flags: Array.isArray(origin.provider_policy_flags) ? origin.provider_policy_flags : [],
    explicit_void_conditions: [
      "La fuente primaria deja de ser pública sin fallback aprobado.",
      "La métrica o el hecho acordado deja de existir y el contrato no define tratamiento.",
    ],
  };
  contract.sources = buildSources(origin, supplied.sources);
  return contract;
}

function validationIssues(contract: JsonRecord, now = new Date()): JsonRecord[] {
  const issues: JsonRecord[] = [];
  if (contract.contract_schema_version !== SOURCE_CONTRACT_SCHEMA_VERSION) {
    issues.push({ code: "RESOLUTION_SCHEMA_VERSION_UNKNOWN", field: "contract_schema_version" });
  }
  if (contract.policy_version !== MARKET_INTELLIGENCE_POLICY_VERSION) {
    issues.push({ code: "RESOLUTION_POLICY_VERSION_UNKNOWN", field: "policy_version" });
  }
  if (!text(contract.canonical_statement, 500)) {
    issues.push({ code: "CANONICAL_STATEMENT_REQUIRED", field: "canonical_statement" });
  }
  if (!CAPTURE_STRATEGIES.has(text(contract.capture_strategy, 80))) {
    issues.push({ code: "SOURCE_METRIC_UNSUPPORTED", field: "capture_strategy" });
  }
  if (!AGGREGATIONS.has(text(contract.aggregation, 40))) {
    issues.push({ code: "AGGREGATION_UNSUPPORTED", field: "aggregation" });
  }
  const end = safeDate(contract.window_end || contract.evaluation_at);
  if (!end) issues.push({ code: "TEMPORAL_END_REQUIRED", field: "window_end" });
  else if (end <= now) issues.push({ code: "TEMPORAL_WINDOW_ALREADY_ENDED", field: "window_end" });
  const start = safeDate(contract.window_start);
  if (start && end && start >= end) issues.push({ code: "TEMPORAL_INCOHERENCE", field: "window_start" });
  if (!text(contract.timezone, 100).includes("/")) issues.push({ code: "TIMEZONE_REQUIRED", field: "timezone" });

  const sources = records(contract.sources);
  const seenPrecedence = new Set<number>();
  let primaryCount = 0;
  sources.forEach((source, index) => {
    const role = text(source.role, 60);
    const precedence = Number(source.precedence);
    if (!SOURCE_ROLES.has(role)) issues.push({ code: "SOURCE_ROLE_REQUIRED", field: `sources.${index}.role` });
    if (!safeHttpsUrl(source.url)) issues.push({ code: "INVALID_OR_UNVERIFIED_SOURCE", field: `sources.${index}.url` });
    if (!Number.isInteger(precedence) || precedence < 1 || seenPrecedence.has(precedence)) {
      issues.push({ code: "SOURCE_PRECEDENCE_INVALID", field: `sources.${index}.precedence` });
    }
    seenPrecedence.add(precedence);
    if (role === "PRIMARY_RESOLUTION") primaryCount += 1;
    if (role === "FALLBACK_RESOLUTION" && !text(source.fallback_condition, 500)) {
      issues.push({ code: "SOURCE_FALLBACK_CONDITION_REQUIRED", field: `sources.${index}.fallback_condition` });
    }
  });
  if (primaryCount === 0) issues.push({ code: "RESOLUTION_PRIMARY_SOURCE_REQUIRED", field: "sources" });
  if (primaryCount > 1) issues.push({ code: "RESOLUTION_PRIMARY_SOURCE_MULTIPLE", field: "sources" });

  if (contract.opportunity_type === "metric_threshold") {
    for (const field of ["metric", "operator", "threshold", "precision"]) {
      if (contract[field] === null || contract[field] === undefined || contract[field] === "") {
        issues.push({ code: "METRIC_CONTRACT_INCOMPLETE", field });
      }
    }
  }
  if (contract.capture_strategy === "poll_during_window" && Number(contract.sampling_interval_seconds) < 60) {
    issues.push({ code: "MONITOR_INTERVAL_UNSAFE", field: "sampling_interval_seconds" });
  }
  if (contract.provider === "youtube" && Number(contract.maximum_monitor_duration_seconds) > 30 * 86_400) {
    issues.push({ code: "SOURCE_RETENTION_INCOMPATIBLE", field: "maximum_monitor_duration_seconds" });
  }
  return issues;
}

function proposalFromOrigin(origin: JsonRecord, hypothesis: JsonRecord | null, contract: JsonRecord): JsonRecord {
  const question = text(
    hypothesis?.proposed_question ||
      origin.atinara_question ||
      origin.suggested_question ||
      origin.source_question,
    500,
  );
  const subject = text(origin.title || origin.source_title || origin.subtitle, 300);
  const primary = records(contract.sources).find((source) => source.role === "PRIMARY_RESOLUTION");
  const alternatives = records(contract.sources)
    .filter((source) => source.role !== "PRIMARY_RESOLUTION")
    .map((source) => safeHttpsUrl(source.url))
    .filter(Boolean)
    .join("\n");
  const evaluationAt = text(contract.evaluation_at || contract.window_end, 120);
  const yesCriteria = text(
    origin.suggested_yes_criteria ||
      origin.atinara_resolution_criteria ||
      (question
        ? `Sí si la fuente primaria demuestra objetivamente que ${question.replace(/^¿|\?$/g, "").toLowerCase()}.`
        : ""),
    4_000,
  );
  return {
    market_slug: slugify(`${subject}-${question}`),
    question,
    subject,
    category: text(origin.atinara_category || origin.source_category || "Industria", 100),
    evaluation_period_label: evaluationAt
      ? `Hasta ${new Intl.DateTimeFormat("es-ES", { dateStyle: "long", timeStyle: "short", timeZone: "Europe/Madrid" }).format(new Date(evaluationAt))}`
      : "",
    evaluation_ends_at: evaluationAt || null,
    timezone: text(contract.timezone || "Europe/Madrid", 100),
    resolution_deadline: text(contract.resolution_deadline, 120) || null,
    yes_criteria: yesCriteria,
    no_criteria: text(
      origin.suggested_no_criteria ||
        "No si, al finalizar el periodo aprobado, la condición objetiva de Sí no se ha cumplido según la fuente primaria.",
      4_000,
    ),
    edge_cases: text(
      origin.suggested_edge_cases ||
        "Un dato ausente no equivale a cero ni a No. Los conflictos de fuente exigen revisión humana. Un anuncio no equivale al hecho realizado salvo que las reglas lo indiquen.",
      4_000,
    ),
    delay_treatment: "La fecha límite aprobada no se desplaza automáticamente por retrasos posteriores.",
    cancellation_treatment: "Una cancelación o imposibilidad material se revisa humanamente conforme al contrato.",
    leak_treatment: "Las filtraciones pueden aportar contexto, pero no resuelven el mercado.",
    rename_treatment: "Un cambio de nombre no altera la identidad del sujeto si la continuidad oficial es inequívoca.",
    assumptions: "Toda fuente externa se trata como dato no confiable hasta ser validada.",
    public_criteria: text(
      origin.atinara_resolution_criteria || origin.source_resolution_rules ||
        "La resolución aplica las fuentes y el periodo aprobados; Atinara conserva confirmación humana.",
      4_000,
    ),
    description: text(
      origin.source_description || origin.description ||
        "Mercado preparado a partir de una oportunidad externa y adaptado al contrato de Atinara.",
      4_000,
    ),
    primary_source_url: safeHttpsUrl(primary?.url),
    alternative_sources: alternatives,
  };
}

function hasBlockingDuplicate(value: unknown): boolean {
  return records(value).some((match) => {
    const relationship = text(match.relationship, 80);
    return match.blocking !== false && ["exact_duplicate", "semantic_duplicate"].includes(relationship);
  });
}

function deterministicAssessment(origin: JsonRecord, originType: string) {
  const structuralIssues: string[] = [];
  if (origin.marketability_status === "incoherent") structuralIssues.push("ORIGIN_INCOHERENT");
  if (origin.marketability_status === "duplicate" || hasBlockingDuplicate(origin.duplicate_matches)) {
    structuralIssues.push("DUPLICATE_MARKET");
  }
  const resultKnown = origin.marketability_status === "already_resolved"
    || origin.eligibility_status === "terminal"
    || origin.verification_reason_code === "EVENT_ALREADY_RESOLVED";
  const now = new Date();
  const eligibilityExpiry = safeDate(origin.eligibility_expires_at);
  const eligibilityExpired = !eligibilityExpiry || eligibilityExpiry <= now;
  const stale = origin.marketability_status === "rejected" ||
    (origin.eligibility_status && origin.eligibility_status !== "eligible" && !resultKnown);

  if (originType === "radar_candidate") {
    const candidateExpiry = safeDate(origin.expires_at);
    if (!resultKnown && (text(origin.state, 40) !== "available" || !candidateExpiry || candidateExpiry <= now)) {
      structuralIssues.push("RADAR_CANDIDATE_NOT_PREPARABLE");
    }
    if (text(origin.normalizer_version, 80) !== RADAR_NORMALIZER_VERSION) {
      structuralIssues.push("RADAR_NORMALIZER_OUTDATED");
    }
    if (text(origin.eligibility_policy_version, 80) !== RADAR_ELIGIBILITY_POLICY_VERSION) {
      structuralIssues.push("RADAR_ELIGIBILITY_POLICY_OUTDATED");
    }
    if (!resultKnown && (text(origin.eligibility_status, 80) !== "eligible"
      || !origin.current_eligibility_check_id
      || eligibilityExpired)) {
      structuralIssues.push("RADAR_ELIGIBILITY_REQUIRED");
    }
    if (!text(origin.atinara_question, 700)
      || !text(origin.atinara_resolution_criteria, 5_000)
      || !hasOfficialResolutionSourceProof(origin)) {
      structuralIssues.push("RADAR_RESOLUTION_SOURCE_REQUIRED");
    }
  }

  if (resultKnown) {
    structuralIssues.push("EVENT_ALREADY_RESOLVED");
    return { integrity_status: "fail", forecastability_status: "already_determined", structuralIssues };
  }
  const nonRepairableStructuralIssues = structuralIssues.filter(
    (code) => !REPAIR_MATERIALIZATION_REASON_CODES.has(code),
  );
  if (stale || (originType === "radar_candidate" && nonRepairableStructuralIssues.length)) {
    return { integrity_status: "fail", forecastability_status: "stale", structuralIssues };
  }
  const probability = normalizeProbability(origin.source_probability_yes ?? origin.source_probability);
  const forecastability = probability !== null && probability <= 0.05
    ? "valid_very_unlikely"
    : probability !== null && probability <= 0.2 ? "valid_low_probability" : "forecastable";
  if (structuralIssues.length) {
    return { integrity_status: "needs_edit", forecastability_status: forecastability, structuralIssues };
  }
  return { integrity_status: "pass", forecastability_status: forecastability, structuralIssues };
}

function createDeterministicVerdict(origin: JsonRecord, originType: string): JsonRecord {
  const hypotheses = originType === "observatory_signal" || originType === "context_story_arc"
    ? generateHypotheses(origin)
    : [];
  const hypothesis = hypotheses[0] || null;
  const assessment = deterministicAssessment(origin, originType);
  const contract = contractFromOrigin(origin, hypothesis, originType);
  const issues = validationIssues(contract);
  const proposal = proposalFromOrigin(origin, hypothesis, contract);
  const hardReject = assessment.integrity_status === "fail" || origin.marketability_status === "policy_blocked";
  const issueCodes = issues.map((issue) => text(issue.code, 100));
  const sourceReadiness = issues.some((issue) => issue.code === "RESOLUTION_PRIMARY_SOURCE_REQUIRED")
    ? "needs_official_source"
    : issues.length ? "ready_with_warnings" : "ready";
  const evidence: JsonRecord[] = [{
    role: "DISCOVERY_SIGNAL",
    provider: origin.provider || null,
    url: safeHttpsUrl(origin.external_market_url || origin.external_event_url || origin.canonical_url),
    factual_basis: text(origin.factual_basis || origin.verification_reason || origin.source_description, 2_000),
  }];
  const primary = records(contract.sources).find((source) => source.role === "PRIMARY_RESOLUTION");
  if (primary) {
    evidence.push({
      role: "PRIMARY_RESOLUTION",
      provider: text(contract.provider, 80) || null,
      url: safeHttpsUrl(primary.url),
      factual_basis: "Fuente primaria propuesta para el contrato de resolución.",
    });
  }
  return {
    decision: hardReject ? "reject" : issues.length ? "create_with_edits" : "create",
    integrity_status: assessment.integrity_status,
    forecastability_status: assessment.forecastability_status,
    source_readiness: sourceReadiness,
    confidence: hardReject ? 90 : issues.length ? 65 : 80,
    human_review_required: true,
    reason_codes: uniqueStrings([
      ...records(origin.marketability_reason_codes).map((item) => item.code || item),
      ...issueCodes,
      ...assessment.structuralIssues,
      ...(hardReject ? ["DETERMINISTIC_GATE_BLOCKED"] : []),
    ]),
    summary: hardReject
      ? "La puerta determinista bloquea esta propuesta."
      : issues.length
        ? "La oportunidad es utilizable, pero el Plan de Resolución necesita ajustes antes de guardarse como vinculante."
        : "La oportunidad es estructuralmente válida y dispone de un Plan de Resolución utilizable para un borrador privado.",
    evidence,
    suggested_changes: issues.map((issue) => ({
      field: issue.field,
      code: issue.code,
      suggestion: issue.code === "TEMPORAL_END_REQUIRED"
        ? "Definir la fecha final de evaluación."
        : issue.code === "RESOLUTION_PRIMARY_SOURCE_REQUIRED"
          ? "Añadir una fuente primaria oficial."
          : "Corregir el campo indicado antes de validar el contrato.",
    })),
    uncertainties: issues.length
      ? ["El Plan de Resolución debe revisarse antes de bloquearse."]
      : [],
    proposal,
    resolution_contract: contract,
    hypotheses,
    origin_preparation_revision: origin.preparation_revision ?? null,
    policy_version: MARKET_INTELLIGENCE_POLICY_VERSION,
    schema_version: MARKET_EXPERT_SCHEMA_VERSION,
  };
}

function validateExpertVerdict(value: JsonRecord): { valid: boolean; issues: string[] } {
  const issues: string[] = [];
  if (!EXPERT_DECISIONS.has(text(value.decision, 40))) issues.push("INVALID_EXPERT_DECISION");
  if (!INTEGRITY_STATUSES.has(text(value.integrity_status, 40))) issues.push("INVALID_INTEGRITY_STATUS");
  if (!FORECASTABILITY_STATUSES.has(text(value.forecastability_status, 60))) {
    issues.push("INVALID_FORECASTABILITY_STATUS");
  }
  if (!SOURCE_READINESS_STATUSES.has(text(value.source_readiness, 60))) {
    issues.push("INVALID_SOURCE_READINESS");
  }
  const confidence = Number(value.confidence);
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 100) issues.push("INVALID_CONFIDENCE");
  for (const key of ["reason_codes", "evidence", "suggested_changes", "uncertainties"]) {
    if (!Array.isArray(value[key])) issues.push(`INVALID_${key.toUpperCase()}`);
  }
  if (!value.proposal || typeof value.proposal !== "object" || Array.isArray(value.proposal)) {
    issues.push("INVALID_PROPOSAL");
  }
  if (!value.resolution_contract || typeof value.resolution_contract !== "object" || Array.isArray(value.resolution_contract)) {
    issues.push("INVALID_RESOLUTION_CONTRACT");
  }
  if (value.policy_version !== MARKET_INTELLIGENCE_POLICY_VERSION) issues.push("POLICY_VERSION_MISMATCH");
  if (value.schema_version !== MARKET_EXPERT_SCHEMA_VERSION) issues.push("SCHEMA_VERSION_MISMATCH");
  return { valid: issues.length === 0, issues };
}

async function requestEditorialEnrichment(
  environment: SupabaseEnvironment,
  origin: JsonRecord,
  deterministic: JsonRecord,
  agentRunId: string,
) {
  const gateway = createAiGateway({
    supabaseUrl: environment.supabaseUrl,
    supabaseSecretKey: environment.secretKey,
  });
  const result = await gateway.generateStructured({
    taskType: "market_expert_reasoning",
    ...AI_TASK_CONTRACTS.market_expert_reasoning,
    input: { origin: modelSafeOrigin(origin), deterministic: modelSafeDeterministic(deterministic) },
  }, {
    ...environment.execution,
    invocationId: crypto.randomUUID(),
    agentRunId,
  });
  return {
    value: result.value as JsonRecord,
    telemetryStatus: result.telemetryStatus,
    warnings: result.warnings,
    transportMode: result.metadata.transportMode,
  };
}

function modelSafeOrigin(origin: JsonRecord): JsonRecord {
  // El payload crudo, IDs internos y estado de caché no aportan autoridad
  // editorial. El Gateway volverá a aplicar su allowlist recursiva.
  const excluded = new Set([
    "id", "external_id", "external_event_id", "external_market_id", "entity_id",
    "parent_entity_id", "watch_entity_id", "current_eligibility_check_id",
    "provider_payload", "recent_context", "provider_policy_flags",
  ]);
  const stripIdentifiers = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(stripIdentifiers);
    if (!value || typeof value !== "object") return value;
    return Object.fromEntries(
      Object.entries(value as JsonRecord)
        .filter(([key]) => key !== "id" && !key.endsWith("_id") && !excluded.has(key))
        .map(([key, item]) => [key, stripIdentifiers(item)]),
    );
  };
  return stripIdentifiers(origin) as JsonRecord;
}

function modelSafeDeterministic(value: JsonRecord): JsonRecord {
  const allowed = new Set([
    "decision", "integrity_status", "forecastability_status", "source_readiness",
    "confidence", "human_review_required", "reason_codes", "summary", "evidence",
    "suggested_changes", "uncertainties", "proposal", "resolution_contract",
    "origin_preparation_revision", "policy_version", "schema_version",
  ]);
  const output = Object.fromEntries(Object.entries(value).filter(([key]) => allowed.has(key)));
  if (output.resolution_contract && typeof output.resolution_contract === "object" && !Array.isArray(output.resolution_contract)) {
    const contract = { ...(output.resolution_contract as JsonRecord) };
    delete contract.origin_id;
    delete contract.entity_id;
    output.resolution_contract = contract;
  }
  return output;
}

function mergeProposal(base: JsonRecord, patchValue: unknown, origin: JsonRecord): JsonRecord {
  const patch = patchValue && typeof patchValue === "object" && !Array.isArray(patchValue)
    ? patchValue as JsonRecord
    : {};
  const output = { ...base };
  for (const key of [
    "question", "subject", "category", "yes_criteria", "no_criteria",
    "edge_cases", "public_criteria", "description",
  ]) {
    const value = text(patch[key], 4_000);
    if (value) output[key] = value;
  }
  // Los campos autoritativos no se aceptan del modelo.
  output.category = text(origin.atinara_category || output.category, 100);
  output.evaluation_ends_at = base.evaluation_ends_at;
  output.evaluation_period_label = base.evaluation_period_label;
  output.resolution_deadline = base.resolution_deadline;
  output.timezone = base.timezone;
  output.primary_source_url = base.primary_source_url;
  output.alternative_sources = base.alternative_sources;
  output.market_slug = slugify(`${output.subject}-${output.question}`);
  return output;
}

function mergeExpertVerdict(deterministic: JsonRecord, expert: JsonRecord, origin: JsonRecord): JsonRecord {
  const deterministicHard = deterministic.integrity_status === "fail" ||
    ["already_determined", "stale"].includes(text(deterministic.forecastability_status, 60));
  const contract = { ...(deterministic.resolution_contract as JsonRecord) };
  const proposal = mergeProposal(deterministic.proposal as JsonRecord, expert.proposal_patch, origin);
  contract.canonical_statement = proposal.question;
  const currentIssues = validationIssues(contract);
  const currentIssueCodes = new Set(currentIssues.map((issue) => text(issue.code, 100)));

  let forecastability = text(expert.forecastability_status, 60);
  if (!["forecastable", "valid_low_probability", "valid_very_unlikely"].includes(forecastability)) {
    forecastability = text(deterministic.forecastability_status, 60);
  }
  let integrity = text(expert.integrity_status, 40);
  if (!["pass", "needs_edit"].includes(integrity)) integrity = text(deterministic.integrity_status, 40);
  let decision = text(expert.decision, 40);
  if (!["create", "create_with_edits", "escalate"].includes(decision)) {
    decision = text(deterministic.decision, 40);
  }
  if (deterministicHard) {
    decision = text(deterministic.decision, 40);
    integrity = text(deterministic.integrity_status, 40);
    forecastability = text(deterministic.forecastability_status, 60);
  }

  const modelChanges = Array.isArray(expert.suggested_changes)
    ? expert.suggested_changes.map((item) => ({ field: "editorial", code: "EXPERT_EDITORIAL_SUGGESTION", suggestion: text(item, 1_000) }))
    : [];
  const sourceReadiness = currentIssues.some((issue) => issue.code === "RESOLUTION_PRIMARY_SOURCE_REQUIRED")
    ? "needs_official_source"
    : currentIssues.length ? "ready_with_warnings" : "ready";
  const reasonCodes = uniqueStrings([
    ...((deterministic.reason_codes as unknown[]) || []).filter((code) => currentIssueCodes.has(text(code, 100)) || HARD_REASON_CODES.has(text(code, 100))),
    // Gemini puede proponer advertencias editoriales, pero nunca fabricar una
    // causa dura capaz de contradecir el snapshot autoritativo del Radar.
    ...((expert.reason_codes as unknown[]) || []).filter((code) => !HARD_REASON_CODES.has(text(code, 100))),
    ...currentIssues.map((issue) => issue.code),
  ]);

  return {
    ...deterministic,
    decision,
    integrity_status: integrity,
    forecastability_status: forecastability,
    source_readiness: sourceReadiness,
    confidence: Math.min(Math.max(Number(expert.confidence) || Number(deterministic.confidence) || 0, 0), 100),
    human_review_required: true,
    reason_codes: reasonCodes,
    summary: text(expert.summary, 2_000) || deterministic.summary,
    suggested_changes: [
      ...currentIssues.map((issue) => ({ field: issue.field, code: issue.code, suggestion: "Corregir antes de validar el contrato." })),
      ...modelChanges,
    ],
    uncertainties: uniqueStrings([
      ...((deterministic.uncertainties as unknown[]) || []),
      ...((expert.uncertainties as unknown[]) || []),
    ]),
    proposal,
    resolution_contract: contract,
    policy_version: MARKET_INTELLIGENCE_POLICY_VERSION,
    schema_version: MARKET_EXPERT_SCHEMA_VERSION,
  };
}

function buildDraftGate(verdict: JsonRecord): JsonRecord {
  const reasonCodes = Array.isArray(verdict.reason_codes) ? verdict.reason_codes.map((code) => text(code, 100)) : [];
  const rawHardBlocks = uniqueStrings([
    ...reasonCodes.filter((code) => HARD_REASON_CODES.has(code) && !DERIVED_REASON_CODES.has(code)),
    ...(verdict.integrity_status === "fail" ? ["INTEGRITY_FAILED"] : []),
    ...(["already_determined", "stale"].includes(text(verdict.forecastability_status, 60))
      ? ["FORECASTABILITY_CLOSED"]
      : []),
    ...(["reject", "stale", "merge_duplicate", "escalate"].includes(text(verdict.decision, 40))
      ? ["EXPERT_DECISION_BLOCKED"]
      : []),
    ...(verdict.source_readiness === "not_resolvable" ? ["SOURCE_NOT_RESOLVABLE"] : []),
  ]);
  const terminalRoots = rawHardBlocks.filter((code) => TERMINAL_REASON_CODES.has(code));
  let hardBlocks = terminalRoots.length ? terminalRoots : rawHardBlocks.filter((code) => !DERIVED_REASON_CODES.has(code));
  if (hardBlocks.includes("RADAR_ELIGIBILITY_REQUIRED")) {
    hardBlocks = hardBlocks.filter((code) => code !== "RADAR_CANDIDATE_NOT_PREPARABLE");
  }
  if (!hardBlocks.length) {
    hardBlocks = rawHardBlocks.filter((code) => DERIVED_REASON_CODES.has(code)).slice(0, 1);
  }
  hardBlocks = uniqueStrings(hardBlocks);
  const derivedDiagnostics = uniqueStrings(rawHardBlocks.filter((code) => DERIVED_REASON_CODES.has(code)));
  const contract = verdict.resolution_contract as JsonRecord || {};
  const proposal = verdict.proposal as JsonRecord || {};
  const sources = records(contract.sources);
  const primaryReady = sources.some((source) => source.role === "PRIMARY_RESOLUTION" && safeHttpsUrl(source.url));
  const temporalReady = Boolean(safeDate(contract.evaluation_at || contract.window_end));
  const questionReady = Boolean(text(proposal.question || contract.canonical_statement, 500));
  const canPrefill = hardBlocks.length === 0 && ["create", "create_with_edits"].includes(text(verdict.decision, 40));
  const nonRepairableBlocks = hardBlocks.filter((code) => !REPAIR_MATERIALIZATION_REASON_CODES.has(code));
  const canMaterializePrivateRepairDraft = terminalRoots.length === 0
    && nonRepairableBlocks.length === 0
    && ["create", "create_with_edits"].includes(text(verdict.decision, 40))
    && questionReady;
  const canSavePrivateDraft = canPrefill && primaryReady && temporalReady && questionReady;
  const warnings = uniqueStrings(reasonCodes.filter((code) => !HARD_REASON_CODES.has(code)));
  return {
    status: hardBlocks.length
      ? canMaterializePrivateRepairDraft ? "repairable" : "blocked"
      : warnings.length || verdict.source_readiness === "ready_with_warnings" ? "warning" : "validated",
    can_prefill: canPrefill,
    can_save_private_draft: canSavePrivateDraft,
    can_materialize_private_repair_draft: canMaterializePrivateRepairDraft,
    can_bind: canSavePrivateDraft,
    can_publish: false,
    hard_blocks: hardBlocks,
    causal_roots: hardBlocks,
    derived_diagnostics: derivedDiagnostics,
    warnings,
    automatic_recovery: null,
    human_confirmation_required: true,
  };
}

function decorateVerdict(verdict: JsonRecord): JsonRecord {
  const gate = buildDraftGate(verdict);
  return {
    ...verdict,
    draft_gate: gate,
    prefill: gate.can_prefill || gate.can_materialize_private_repair_draft ? verdict.proposal : {},
  };
}

function reconcileSavedVerdict(savedValue: unknown, deterministic: JsonRecord, origin: JsonRecord): JsonRecord {
  const saved = savedValue && typeof savedValue === "object" && !Array.isArray(savedValue)
    ? savedValue as JsonRecord
    : {};
  const savedProposal = saved.proposal && typeof saved.proposal === "object" && !Array.isArray(saved.proposal)
    ? saved.proposal as JsonRecord
    : {};
  const deterministicProposal = deterministic.proposal as JsonRecord;
  const originalQuestion = text(origin.source_question, 500);
  const savedQuestion = text(savedProposal.question, 500);
  const useSavedQuestion = savedQuestion && savedQuestion !== originalQuestion && /^¿/.test(savedQuestion);
  const proposal: JsonRecord = {
    ...deterministicProposal,
    ...savedProposal,
    question: useSavedQuestion ? savedQuestion : deterministicProposal.question,
    category: deterministicProposal.category,
    evaluation_period_label: deterministicProposal.evaluation_period_label,
    evaluation_ends_at: deterministicProposal.evaluation_ends_at,
    timezone: deterministicProposal.timezone,
    resolution_deadline: deterministicProposal.resolution_deadline,
    primary_source_url: deterministicProposal.primary_source_url,
    alternative_sources: deterministicProposal.alternative_sources,
  };
  proposal.market_slug = slugify(`${proposal.subject}-${proposal.question}`);
  const contract = { ...(deterministic.resolution_contract as JsonRecord), canonical_statement: proposal.question };
  const issues = validationIssues(contract);
  const activeIssueCodes = new Set(issues.map((issue) => text(issue.code, 100)));
  const retainedCodes = Array.isArray(saved.reason_codes)
    ? saved.reason_codes.map((code) => text(code, 100)).filter((code) => activeIssueCodes.has(code))
    : [];
  const sourceReadiness = issues.some((issue) => issue.code === "RESOLUTION_PRIMARY_SOURCE_REQUIRED")
    ? "needs_official_source"
    : issues.length ? "ready_with_warnings" : "ready";
  const deterministicReasonCodes = Array.isArray(deterministic.reason_codes)
    ? deterministic.reason_codes.map((code) => text(code, 100))
    : [];
  const deterministicBlocks = deterministic.integrity_status === "fail"
    || ["already_determined", "stale"].includes(text(deterministic.forecastability_status, 60))
    || deterministicReasonCodes.some((code) => HARD_REASON_CODES.has(code));
  return decorateVerdict({
    ...deterministic,
    decision: !deterministicBlocks && EXPERT_DECISIONS.has(text(saved.decision, 40)) ? saved.decision : deterministic.decision,
    integrity_status: !deterministicBlocks && INTEGRITY_STATUSES.has(text(saved.integrity_status, 40)) ? saved.integrity_status : deterministic.integrity_status,
    forecastability_status: !deterministicBlocks && FORECASTABILITY_STATUSES.has(text(saved.forecastability_status, 60))
      ? saved.forecastability_status
      : deterministic.forecastability_status,
    source_readiness: sourceReadiness,
    confidence: Number.isFinite(Number(saved.confidence)) ? saved.confidence : deterministic.confidence,
    human_review_required: true,
    reason_codes: uniqueStrings([
      ...deterministicReasonCodes.filter((code) => HARD_REASON_CODES.has(code)),
      ...retainedCodes,
      ...issues.map((issue) => issue.code),
    ]),
    summary: text(saved.summary, 2_000) || deterministic.summary,
    evidence: Array.isArray(saved.evidence) && saved.evidence.length ? saved.evidence : deterministic.evidence,
    suggested_changes: issues.map((issue) => ({ field: issue.field, code: issue.code, suggestion: "Corregir antes de validar el contrato." })),
    uncertainties: issues.length
      ? ["El Plan de Resolución conserva advertencias pendientes."]
      : Array.isArray(saved.uncertainties) ? saved.uncertainties : [],
    proposal,
    resolution_contract: contract,
    origin_preparation_revision: origin.preparation_revision ?? deterministic.origin_preparation_revision ?? null,
    policy_version: MARKET_INTELLIGENCE_POLICY_VERSION,
    schema_version: MARKET_EXPERT_SCHEMA_VERSION,
  });
}

function safeToolSummary(tools: JsonRecord[]): JsonRecord[] {
  return tools.slice(0, 12).map((tool) => ({
    tool: text(tool.tool, 80),
    status: text(tool.status, 40),
    count: Number.isFinite(Number(tool.count)) ? Number(tool.count) : null,
  }));
}

async function storeRun(
  environment: SupabaseEnvironment,
  originType: string,
  originId: string,
  origin: JsonRecord,
  analysisFingerprint: string,
  verdict: JsonRecord,
  options: {
    status?: string;
    errorCode?: string | null;
    analysisMode?: string;
    triggerType?: string;
    modelVersion?: string;
  } = {},
) {
  return rpc(environment, "record_market_expert_run", {
    run_input: {
      agent_type: "market_editor",
      origin_type: originType,
      origin_id: originId,
      provider: origin.provider || null,
      origin_fingerprint: await sha256(analysisOriginSnapshot(origin, originType)),
      analysis_fingerprint: analysisFingerprint,
      policy_version: MARKET_INTELLIGENCE_POLICY_VERSION,
      schema_version: MARKET_EXPERT_SCHEMA_VERSION,
      model_version: options.modelVersion || "deterministic_only",
      status: options.status || "completed",
      decision: verdict.decision || null,
      integrity_status: verdict.integrity_status || null,
      forecastability_status: verdict.forecastability_status || null,
      source_readiness: verdict.source_readiness || null,
      confidence: verdict.confidence ?? null,
      human_review_required: verdict.human_review_required !== false,
      result_json: verdict,
      tool_summary: agentToolSummary(verdict.agent_execution).length
        ? agentToolSummary(verdict.agent_execution)
        : safeToolSummary([
          { tool: "get_normalized_origin", status: "completed", count: 1 },
          { tool: "validate_resolution_contract", status: "completed", count: 1 },
          { tool: "build_draft_gate", status: "completed", count: 1 },
        ]),
      analysis_mode: options.analysisMode || "validate",
      trigger_type: options.triggerType || "manual",
      error_code: options.errorCode || null,
    },
  }, { service: true });
}

function providerErrorMayDegrade(error: unknown): boolean {
  const code = publicErrorCode(error, "EXPERT_FAILED");
  return code.startsWith("AI_") || code.startsWith("PROVIDER_") || code === "EXPERT_INVALID_RESPONSE";
}

async function loadOrigin(
  environment: SupabaseEnvironment,
  authorization: string,
  originType: string,
  originId: string,
): Promise<JsonRecord> {
  const raw = await rpc(environment, "get_market_intelligence_origin", {
    origin_type_input: originType,
    origin_id_input: originId,
  }, { authorization });
  return safeOrigin(raw as JsonRecord);
}

type EditorAgentV2 = ReturnType<typeof createAtinaraAgentRunV2>;

async function persistEditorAgentExecution(environment: SupabaseEnvironment, execution: JsonRecord) {
  return persistAgentTelemetry({
    persistence: createAiPersistence({
      supabaseUrl: environment.supabaseUrl,
      secretKey: environment.secretKey,
    }),
    context: environment.execution,
    execution,
  });
}

async function createEditorAgentV2(
  environment: SupabaseEnvironment,
  authorization: string,
  originType: string,
  originId: string,
): Promise<EditorAgentV2> {
  const registry = record(await rpc(
    environment,
    "get_market_agent_registry_v2",
    {},
    { authorization },
  ));
  if (!registry || registry.version !== ATINARA_AGENT_REGISTRY_VERSION
    || !/^[0-9a-f]{64}$/i.test(text(registry.hash, 64))) {
    throw new Error("AGENT_REGISTRY_IDENTITY_MISMATCH");
  }
  assertAgentRegistrySnapshot(registry);
  const executeTool = async (input: JsonRecord) => {
    if (typeof input.execute !== "function") throw new Error("AGENT_TOOL_HANDLER_INVALID");
    const value = await (input.execute as () => Promise<unknown> | unknown)();
    const summary = typeof input.summarize === "function"
      ? (input.summarize as (value: unknown) => JsonRecord)(value)
      : record(input.summary) ?? {};
    return {
      value,
      status: ["completed", "degraded", "failed", "no_op"].includes(text(input.status, 20))
        ? text(input.status, 20)
        : "completed",
      summary,
    };
  };
  const handlers = Object.fromEntries([
    "load_authoritative_origin", "run_deterministic_gate", "request_editorial_enrichment",
    "validate_resolution_contract", "build_private_draft_gate", "persist_editor_run",
  ].map((tool) => [tool, executeTool]));
  const initialSnapshotFingerprint = await sha256({ origin_type: originType, origin_id: originId });
  return createAtinaraAgentRunV2({
    agentType: "market_editor_agent",
    registryVersion: registry.version,
    registryHash: registry.hash,
    snapshotFingerprint: initialSnapshotFingerprint,
    handlers,
    runId: environment.execution.invocationId,
    maxSteps: 8,
    maxRepeatedActions: 2,
    finalizationReserveMs: 15_000,
    executionContext: environment.execution,
  });
}

async function dispatchEditorTool<T>(
  agent: EditorAgentV2,
  tool: string,
  execute: () => Promise<T> | T,
  options: {
    actionKey: string;
    progressFingerprint: string;
    status?: string;
    summary?: JsonRecord;
    summarize?: (value: T) => JsonRecord;
  },
): Promise<T> {
  const result = await agent.dispatch(tool, {
    execute,
    status: options.status ?? "completed",
    summary: options.summary ?? {},
    summarize: options.summarize,
  }, {
    actionKey: options.actionKey,
    progressFingerprint: options.progressFingerprint,
  });
  return result.value as T;
}

async function analyzeOrigin(
  environment: SupabaseEnvironment,
  authorization: string,
  body: JsonRecord,
): Promise<Response> {
  const originType = text(body.origin_type, 40);
  const originId = text(body.origin_id, 100);
  if (!["radar_candidate", "observatory_signal", "context_story_arc"].includes(originType) || !originId) {
    throw new Error("INTELLIGENCE_ORIGIN_INVALID");
  }
  const agent = await createEditorAgentV2(environment, authorization, originType, originId);
  const origin = await dispatchEditorTool(agent, "load_authoritative_origin", () =>
    loadOrigin(environment, authorization, originType, originId), {
    actionKey: `${originType}:${originId}`,
    progressFingerprint: `origin:${originType}:${originId}`,
    summarize: (loaded) => ({
      origin_type: originType,
      preparation_revision: text(loaded.preparation_revision, 80),
    }),
  });
  if (originType === "radar_candidate" && body.preparation_revision !== undefined
    && text(body.preparation_revision, 80) !== text(origin.preparation_revision, 80)) {
    throw new Error("PREPARATION_REVISION_MISMATCH");
  }
  const analysisFingerprint = await sha256({
    origin: analysisOriginSnapshot(origin, originType),
    policy: MARKET_INTELLIGENCE_POLICY_VERSION,
    schema: MARKET_EXPERT_SCHEMA_VERSION,
    implementation: MARKET_EXPERT_IMPLEMENTATION_VERSION,
  });
  if (body.force !== true) {
    const cached = record(await rpc(environment, "get_market_expert_analysis", {
      origin_type_input: originType,
      origin_id_input: originId,
    }, { authorization }));
    if (cached?.status === "completed" && cached.analysis_fingerprint === analysisFingerprint) {
      const deterministic = await dispatchEditorTool(
        agent,
        "run_deterministic_gate",
        () => createDeterministicVerdict(origin, originType),
        {
        actionKey: "deterministic-gate",
        progressFingerprint: `deterministic:${analysisFingerprint}`,
        summarize: (value) => ({ decision: value.decision, cached: true }),
      });
      await dispatchEditorTool(agent, "request_editorial_enrichment", () => null, {
        status: "no_op",
        actionKey: "editorial-cache",
        progressFingerprint: `editorial-cache:${analysisFingerprint}`,
        summary: { cached: true },
      });
      await dispatchEditorTool(agent, "validate_resolution_contract", () => true, {
        actionKey: "contract-validation",
        progressFingerprint: `contract-cache:${analysisFingerprint}`,
        summary: { cached: true },
      });
      await dispatchEditorTool(agent, "build_private_draft_gate", () => cached.result_json, {
        actionKey: "draft-gate",
        progressFingerprint: `draft-gate-cache:${analysisFingerprint}`,
        summary: { cached: true },
      });
      await dispatchEditorTool(agent, "persist_editor_run", () => cached, {
        status: "no_op",
        actionKey: "persist-cache",
        progressFingerprint: `persist-cache:${analysisFingerprint}`,
        summary: { cached: true },
      });
      const agentExecution = agent.complete("completed", "CACHE_HIT");
      const agentTelemetry = await persistEditorAgentExecution(environment, agentExecution);
      const reconciled = {
        ...reconcileSavedVerdict(cached.result_json, deterministic, origin),
        agent_execution: agentExecution,
      };
      return jsonResponse({
        ok: true,
        cached: true,
        run: cached,
        verdict: reconciled,
        agent_telemetry_status: agentTelemetry.status,
        warnings: agentTelemetry.warnings,
        draft_package: packageFromRun(cached, reconciled, originType, originId, origin),
      });
    }
  }

  const deterministic = await dispatchEditorTool(
    agent,
    "run_deterministic_gate",
    () => createDeterministicVerdict(origin, originType),
    {
    actionKey: "deterministic-gate",
    progressFingerprint: `deterministic:${analysisFingerprint}`,
    summarize: (value) => ({ decision: value.decision, reason_codes: value.reason_codes }),
  });
  let verdict = deterministic;
  let degraded = false;
  let warningCode: string | null = null;
  let aiTransportMode = "legacy_direct";
  let telemetryStatus = "not_attempted";
  let aiWarnings: readonly string[] = [];
  try {
    const editorial = await dispatchEditorTool(
      agent,
      "request_editorial_enrichment",
      () => requestEditorialEnrichment(environment, origin, deterministic, agent.snapshot().run_id),
      {
        actionKey: "editorial-enrichment",
        progressFingerprint: `editorial:${analysisFingerprint}:completed`,
        summarize: (value) => ({
          configured: true,
          transport_mode: value.transportMode,
          telemetry_status: value.telemetryStatus,
          warning_codes: value.warnings,
        }),
      },
    );
    aiTransportMode = editorial.transportMode;
    telemetryStatus = editorial.telemetryStatus;
    aiWarnings = editorial.warnings;
    verdict = mergeExpertVerdict(deterministic, editorial.value, origin);
  } catch (error) {
    if (!providerErrorMayDegrade(error)) throw error;
    degraded = true;
    warningCode = publicErrorCode(error, "EXPERT_PROVIDER_DEGRADED");
    verdict = {
      ...deterministic,
      reason_codes: uniqueStrings([...(deterministic.reason_codes as unknown[]), "EXPERT_PROVIDER_DEGRADED"]),
      uncertainties: uniqueStrings([
        ...((deterministic.uncertainties as unknown[]) || []),
        `El análisis editorial completo no estuvo disponible (${warningCode}).`,
      ]),
      summary: `${text(deterministic.summary, 1_500)} Se muestra una evaluación determinista segura mientras el servicio editorial se recupera.`,
    };
    await dispatchEditorTool(agent, "request_editorial_enrichment", () => null, {
      status: "degraded",
      actionKey: "editorial-enrichment-degraded",
      progressFingerprint: `editorial:${analysisFingerprint}:degraded`,
      summary: { configured: true, warning_code: warningCode },
    });
  }

  verdict = decorateVerdict(verdict);
  const validation = await dispatchEditorTool(
    agent,
    "validate_resolution_contract",
    () => validateExpertVerdict(verdict),
    {
      actionKey: "contract-validation",
      progressFingerprint: `contract:${analysisFingerprint}:${text(verdict.source_readiness, 80)}`,
      summarize: (value) => ({ valid: value.valid, source_readiness: verdict.source_readiness }),
    },
  );
  if (!validation.valid) throw new Error("EXPERT_INVALID_RESPONSE");
  await dispatchEditorTool(agent, "build_private_draft_gate", () => verdict.draft_gate, {
    actionKey: "draft-gate",
    progressFingerprint: `draft-gate:${analysisFingerprint}:${text((verdict.draft_gate as JsonRecord)?.can_prepare, 20)}`,
    summary: { can_prepare: (verdict.draft_gate as JsonRecord)?.can_prepare === true },
  });
  // La inferencia puede tardar lo suficiente para que Radar publique una revisión factual nueva.
  // Never let a late response become the newest run for a snapshot it did not analyse.
  const authoritativeOrigin = await dispatchEditorTool(
    agent,
    "load_authoritative_origin",
    () => loadOrigin(environment, authorization, originType, originId),
    {
      actionKey: `reload:${originType}:${originId}`,
      progressFingerprint: `origin-reload:${analysisFingerprint}`,
      summarize: (loaded) => ({
        origin_type: originType,
        preparation_revision: text(loaded.preparation_revision, 80),
      }),
    },
  );
  const authoritativeFingerprint = await sha256({
    origin: analysisOriginSnapshot(authoritativeOrigin, originType),
    policy: MARKET_INTELLIGENCE_POLICY_VERSION,
    schema: MARKET_EXPERT_SCHEMA_VERSION,
    implementation: MARKET_EXPERT_IMPLEMENTATION_VERSION,
  });
  if (authoritativeFingerprint !== analysisFingerprint
    || (originType === "radar_candidate"
      && text(authoritativeOrigin.preparation_revision, 80) !== text(origin.preparation_revision, 80))) {
    throw new Error("PREPARATION_REVISION_MISMATCH");
  }
  const storedVerdict = { ...verdict, agent_execution: agent.snapshot() };
  const run = await dispatchEditorTool(
    agent,
    "persist_editor_run",
    () => storeRun(environment, originType, originId, authoritativeOrigin, analysisFingerprint, storedVerdict, {
      errorCode: warningCode,
      modelVersion: degraded ? `ai_gateway:${aiTransportMode}:degraded` : `ai_gateway:${aiTransportMode}`,
    }) as Promise<JsonRecord>,
    {
      actionKey: "persist-editor-run",
      progressFingerprint: `persist:${analysisFingerprint}`,
      summary: { origin_type: originType, decision: verdict.decision },
    },
  );
  const agentExecution = agent.complete(degraded ? "degraded" : "completed");
  const agentTelemetry = await persistEditorAgentExecution(environment, agentExecution);
  const combinedWarnings = [...new Set([...aiWarnings, ...agentTelemetry.warnings])];
  verdict = {
    ...verdict,
    agent_execution: agentExecution,
    ai_telemetry_status: telemetryStatus,
    agent_telemetry_status: agentTelemetry.status,
    warnings: combinedWarnings,
  };
  let finalizedRun = run;
  try {
    finalizedRun = await storeRun(environment, originType, originId, authoritativeOrigin, analysisFingerprint, verdict, {
      errorCode: warningCode,
      modelVersion: degraded ? `ai_gateway:${aiTransportMode}:degraded` : `ai_gateway:${aiTransportMode}`,
    }) as JsonRecord;
  } catch {
    // El dictamen ya quedó guardado. Un fallo al enriquecer su traza no altera
    // la decisión de dominio ni provoca una segunda inferencia.
    combinedWarnings.push("AI_TELEMETRY_WRITE_FAILED");
    verdict = { ...verdict, warnings: [...new Set(combinedWarnings)] };
  }
  if (Array.isArray(verdict.hypotheses) && originType !== "radar_candidate") {
    await rpc(environment, "save_market_opportunity_hypotheses", {
      origin_type_input: originType,
      origin_id_input: originId,
      hypotheses_input: (verdict.hypotheses as unknown[]).slice(0, 3),
    }, { service: true });
  }
  return jsonResponse({
    ok: true,
    cached: false,
    degraded,
    warning_code: warningCode,
    telemetry_status: telemetryStatus,
    agent_telemetry_status: agentTelemetry.status,
    warnings: [...new Set(combinedWarnings)],
    run: finalizedRun,
    verdict,
    draft_package: packageFromRun(finalizedRun, verdict, originType, originId, authoritativeOrigin),
  });
}

function packageFromRun(
  run: JsonRecord,
  verdict: JsonRecord,
  originType: string,
  originId: string,
  origin: JsonRecord = {},
): JsonRecord {
  const contract = verdict.resolution_contract as JsonRecord || {};
  const sources = records(contract.sources);
  const gate = verdict.draft_gate && typeof verdict.draft_gate === "object"
    ? verdict.draft_gate as JsonRecord
    : buildDraftGate(verdict);
  return {
    available: run.status === "completed",
    origin: {
      type: originType,
      id: originId,
      preparation_revision: origin.preparation_revision ?? verdict.origin_preparation_revision ?? null,
      fingerprint: origin.fingerprint ?? run.origin_fingerprint ?? null,
    },
    run: {
      id: run.id || null,
      model_version: run.model_version || null,
      status: run.status || null,
      completed_at: run.completed_at || null,
      error_code: run.error_code || null,
      origin_fingerprint: run.origin_fingerprint || null,
      analysis_fingerprint: run.analysis_fingerprint || null,
      policy_version: run.policy_version || null,
      schema_version: run.schema_version || null,
    },
    verdict,
    fields: verdict.proposal || {},
    contract,
    sources,
    gate,
    creates_draft: false,
    publishes: false,
    resolves: false,
  };
}

async function getDraftPackage(
  environment: SupabaseEnvironment,
  authorization: string,
  body: JsonRecord,
): Promise<Response> {
  const originType = text(body.origin_type || "radar_candidate", 40);
  const originId = text(body.origin_id, 100);
  if (!["radar_candidate", "observatory_signal", "context_story_arc"].includes(originType) || !originId) {
    throw new Error("INTELLIGENCE_ORIGIN_INVALID");
  }
  const [origin, rawRun] = await Promise.all([
    loadOrigin(environment, authorization, originType, originId),
    rpc(environment, "get_market_expert_analysis", {
      origin_type_input: originType,
      origin_id_input: originId,
    }, { authorization }),
  ]);
  const run = record(rawRun);
  if (run?.status !== "completed" || !run.id) {
    return jsonResponse({
      ok: true,
      package: {
        available: false,
        origin: { type: originType, id: originId },
        gate: { status: "blocked", can_prefill: false, can_save_private_draft: false, hard_blocks: ["MARKET_EXPERT_ANALYSIS_REQUIRED"], warnings: [] },
      },
    });
  }
  const currentAnalysisFingerprint = await sha256({
    origin: analysisOriginSnapshot(origin, originType),
    policy: MARKET_INTELLIGENCE_POLICY_VERSION,
    schema: MARKET_EXPERT_SCHEMA_VERSION,
    implementation: MARKET_EXPERT_IMPLEMENTATION_VERSION,
  });
  const runResult = run.result_json && typeof run.result_json === "object" && !Array.isArray(run.result_json)
    ? run.result_json as JsonRecord
    : {};
  const currentRevision = Number(origin.preparation_revision);
  const runRevision = Number(runResult.origin_preparation_revision);
  const revisionMatches = originType !== "radar_candidate"
    || (Number.isSafeInteger(currentRevision) && Number.isSafeInteger(runRevision) && currentRevision === runRevision);
  const runIsCurrent = run.analysis_fingerprint === currentAnalysisFingerprint
    && run.policy_version === MARKET_INTELLIGENCE_POLICY_VERSION
    && run.schema_version === MARKET_EXPERT_SCHEMA_VERSION
    && revisionMatches;
  if (!runIsCurrent) {
    return jsonResponse({
      ok: true,
      stale: true,
      package: {
        available: false,
        origin: {
          type: originType,
          id: originId,
          preparation_revision: origin.preparation_revision ?? null,
          fingerprint: origin.fingerprint ?? null,
        },
        run: {
          id: run.id,
          status: run.status,
          origin_fingerprint: run.origin_fingerprint || null,
          analysis_fingerprint: run.analysis_fingerprint || null,
          policy_version: run.policy_version || null,
          schema_version: run.schema_version || null,
        },
        gate: {
          status: "blocked",
          can_prefill: false,
          can_save_private_draft: false,
          hard_blocks: ["MARKET_EXPERT_ANALYSIS_STALE"],
          warnings: [],
        },
      },
    });
  }
  const deterministic = createDeterministicVerdict(origin, originType);
  const verdict = reconcileSavedVerdict(run.result_json, deterministic, origin);
  return jsonResponse({ ok: true, package: packageFromRun(run, verdict, originType, originId, origin) });
}

async function discoverOfficialContext(
  environment: SupabaseEnvironment,
  originType: string,
  originId: string,
  origin: JsonRecord,
  triggerType: string,
) {
  const apiKey = Deno.env.get("TAVILY_API_KEY") ?? "";
  if (!apiKey) return { configured: false, items: [] as JsonRecord[], code: "TAVILY_NOT_CONFIGURED", cached: false };
  const title = inspectPromptInjection(origin.title || origin.source_title).safe_text;
  if (!title) return { configured: true, items: [] as JsonRecord[], code: "CONTEXT_QUERY_EMPTY", cached: false };
  const recent = records(origin.recent_context);
  if (recent.length && triggerType !== "manual_force") {
    return { configured: true, items: recent, cached: true, code: "CONTEXT_CACHE_HIT" };
  }
  const officialDomain = safeHostname(origin.official_event_url || origin.canonical_url || origin.atinara_resolution_source_url);
  const query = `fuente oficial anuncio fecha reglas ${title}`.slice(0, 500);
  const url = new URL("https://api.tavily.com/search");
  const response = await fetchProviderJson("tavily", url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: apiKey,
      query,
      topic: "news",
      days: 30,
      search_depth: "basic",
      max_results: 3,
      include_answer: false,
      include_raw_content: false,
      ...(officialDomain ? { include_domains: [officialDomain] } : {}),
    }),
  }, { timeoutMs: 12_000, maxBytes: 500_000, retries: 0, execution: environment.execution });

  const now = new Date();
  const items: JsonRecord[] = [];
  for (const result of records((response.data as JsonRecord).results).slice(0, 3)) {
    const sourceUrl = safeHttpsUrl(result.url);
    if (!sourceUrl) continue;
    const sourceFingerprint = await sha256({ source_url: sourceUrl, published_at: result.published_date, title: result.title });
    items.push({
      provider: "tavily",
      source_url: sourceUrl,
      source_role: "CONTEXT_SOURCE",
      source_type: "public_web",
      official_status: officialDomain && safeHostname(sourceUrl) === officialDomain ? "official" : "secondary",
      title: inspectPromptInjection(text(result.title, 500)).safe_text,
      excerpt: inspectPromptInjection(text(result.content, 2_000)).safe_text,
      published_at: result.published_date || null,
      observed_at: now.toISOString(),
      source_fingerprint: sourceFingerprint,
      retention_expires_at: new Date(now.getTime() + 30 * 86_400_000).toISOString(),
      policy_flags: ["CONTEXT_ONLY", "NEVER_RESOLUTION_SOURCE"],
    });
  }

  await rpc(environment, "save_data_observatory_context_batch", {
    origin_type_input: originType,
    origin_id_input: originId,
    entity_id_input: origin.watch_entity_id || null,
    items_input: items,
    story_arc_input: items.length && origin.watch_entity_id ? {
      arc_type: "documented_context",
      title: `Contexto reciente de ${title}`,
      factual_summary: items.map((item) => item.title).join(" · ").slice(0, 4_000),
      contextual_summary: "Fuentes contextuales pendientes de revisión editorial; no resuelven mercados.",
      evidence_refs: items.map((item) => item.source_fingerprint),
    } : {},
  }, { service: true });
  await rpc(environment, "record_data_provider_run", {
    provider_input: "tavily",
    action_input: "discover_official_context",
    status_input: "available",
    result_count_input: items.length,
    detail_input: {
      quota_state: { queries: 1, query_redacted: query, query_fingerprint: await sha256(query) },
      trigger_type: triggerType,
    },
  }, { service: true });
  return { configured: true, items, cached: false, code: items.length ? "CONTEXT_FOUND" : "CONTEXT_EMPTY" };
}

async function discoverOpportunities(
  environment: SupabaseEnvironment,
  authorization: string,
  body: JsonRecord,
): Promise<Response> {
  const originType = text(body.origin_type, 40);
  const originId = text(body.origin_id, 100);
  const origin = await loadOrigin(environment, authorization, originType, originId);
  let context = {
    configured: Boolean(Deno.env.get("TAVILY_API_KEY")),
    items: records(origin.recent_context),
    cached: true,
    code: "CONTEXT_CACHE_HIT",
  };
  if (!context.items.length || body.force_context === true) {
    context = await discoverOfficialContext(
      environment,
      originType,
      originId,
      origin,
      body.trigger_type === "scheduled" ? "scheduled" : body.force_context === true ? "manual_force" : "manual",
    );
  }
  const enriched = context.items.length ? {
    ...origin,
    contextual_basis: text(
      origin.contextual_basis || context.items.map((item) => item.excerpt || item.title).join(" "),
      4_000,
    ),
    recent_context: context.items,
  } : origin;
  const hypotheses = generateHypotheses(enriched).slice(0, 3);
  if (hypotheses.length) {
    await rpc(environment, "save_market_opportunity_hypotheses", {
      origin_type_input: originType,
      origin_id_input: originId,
      hypotheses_input: hypotheses,
    }, { service: true });
  }
  return jsonResponse({
    ok: true,
    hypotheses,
    context: {
      configured: context.configured,
      cached: context.cached === true,
      count: context.items.length,
      code: context.code,
    },
    zero_proposals: hypotheses.length === 0,
    message: hypotheses.length
      ? "Hipótesis privadas preparadas para revisión de Yol."
      : "No existe una oportunidad suficientemente sólida; no se ha fabricado una pregunta.",
    creates_draft: false,
    publishes: false,
    resolves: false,
  });
}

async function handleAction(
  environment: SupabaseEnvironment,
  authorization: string,
  body: JsonRecord,
): Promise<Response> {
  const action = text(body.action, 80);
  if (["analyze-origin", "revalidate-analysis", "prepare-recommendation"].includes(action)) {
    return analyzeOrigin(environment, authorization, {
      ...body,
      force: action === "revalidate-analysis" || body.force === true,
    });
  }
  if (action === "get-draft-package") return getDraftPackage(environment, authorization, body);
  if (["discover-opportunities", "analyze-story-arc", "generate-market-hypotheses", "expand-origin-context"].includes(action)) {
    return discoverOpportunities(environment, authorization, body);
  }
  if (action === "get-analysis") {
    const run = record(await rpc(environment, "get_market_expert_analysis", {
      origin_type_input: text(body.origin_type, 40),
      origin_id_input: text(body.origin_id, 100),
    }, { authorization }));
    return jsonResponse({ ok: true, run });
  }
  if (action === "get-applicable-precedents") {
    const precedents = await rpc(environment, "list_applicable_market_precedents", {
      category_input: body.category || null,
      problem_type_input: body.problem_type || null,
    }, { authorization });
    return jsonResponse({ ok: true, precedents });
  }
  if (action === "record-feedback") {
    const feedback = await rpc(environment, "record_market_expert_feedback", {
      run_id_input: text(body.run_id, 100),
      final_decision_input: text(body.final_decision, 40),
      changed_fields_input: body.changed_fields || [],
      reason_input: body.reason || null,
      promote_input: false,
    }, { authorization });
    return jsonResponse({ ok: true, feedback, policy_changed: false });
  }
  if (action === "promote-precedent") {
    const precedent = await rpc(environment, "promote_market_expert_precedent", {
      feedback_id_input: text(body.feedback_id, 100),
      precedent_input: body.precedent && typeof body.precedent === "object" && !Array.isArray(body.precedent)
        ? body.precedent
        : {},
    }, { authorization });
    return jsonResponse({ ok: true, precedent, promoted_explicitly: true, policy_changed: false });
  }
  throw new Error("MARKET_EXPERT_ACTION_INVALID");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "METHOD_NOT_ALLOWED", message: "Utiliza POST." }, 405);
  const operation = createAbsoluteExecutionContext({
    durationMs: OPERATION_TIMEOUT_MS,
    parentSignal: req.signal,
  });
  const environment = getSupabaseEnvironment(operation.context);
  if (!environment) {
    operation.cleanup();
    return jsonResponse({ error: "SERVICE_NOT_CONFIGURED", message: "El Agente Editor no puede conectar con Supabase." }, 503);
  }
  const authorization = req.headers.get("authorization") ?? "";
  try {
    const body = await readJsonBody(req);
    const auth = await authenticateAdminOrService(environment, authorization, body.trigger_type === "scheduled");
    if (auth instanceof Response) return auth;
    return await handleAction(environment, authorization, body);
  } catch (error) {
    console.error("Market expert request failed", JSON.stringify({ code: publicErrorCode(error, "UNKNOWN") }));
    return handleEdgeError(error, "El análisis experto no se ha aplicado. Los datos deterministas y el Radar siguen disponibles.");
  } finally {
    operation.cleanup();
  }
});
