import "jsr:@supabase/functions-js/edge-runtime.d.ts";

import {
  AUTONOMOUS_REPAIR_MAX_ROUNDS,
  AUTONOMOUS_REPAIR_VERSION,
  REPAIRABLE_ISSUE_CODES,
  VALIDATOR_CONTENT_ISSUE_CODES,
  applyRepairPatch,
  buildDeterministicRepair,
  buildResolutionPlan,
  changedRepairFields,
  cleanText,
  detectIrreducibleAmbiguity,
  discoverRegisteredPrimarySource,
  extractTemporalAnchorDate,
  inferArchetype,
  inferRepairCategory,
  inferRelativeTemporalContract,
  inferSubject,
  isRecord,
  mergeAlternativeSources,
  normalizePrimarySourceRegistry,
  primarySourceCandidates,
  repairInferenceContext,
  safePublicUrl,
  validateRepairDraft,
} from "../_shared/market-draft-repair.mjs";
import { createAtinaraAgentRunV2 } from "../_shared/atinara-agent-runtime-v2.mjs";
import {
  ATINARA_AGENT_REGISTRY_VERSION,
  assertAgentRegistrySnapshot,
} from "../_shared/atinara-agent-registries-v2.mjs";
import { createAiGateway } from "../_shared/ai/gateway.mjs";
import { AI_TASK_CONTRACTS } from "../_shared/ai/task-policy.mjs";
import { createAbsoluteExecutionContext, fetchWithinDeadline } from "../_shared/ai/deadline.mjs";
import { createAiPersistence } from "../_shared/ai/persistence.mjs";
import { persistAgentTelemetry } from "../_shared/ai/telemetry.mjs";

type JsonRecord = Record<string, unknown>;

const MAX_REQUEST_BYTES = 4_096;
const PROVIDER_TIMEOUT_MS = 35_000;
const SOURCE_TIMEOUT_MS = 6_000;
const SOURCE_VALIDATION_BUDGET_MS = 75_000;
const MIN_POST_WRITE_BUDGET_MS = 12_000;
const MAX_SOURCE_EXCERPT_BYTES = 32_768;
const MAX_SOURCE_EXCERPT_CHARS = 4_000;
const VALIDATOR_CONTENT_ISSUE_CODE_SET = new Set(VALIDATOR_CONTENT_ISSUE_CODES);
const REPAIRABLE_ISSUE_CODE_SET = new Set(REPAIRABLE_ISSUE_CODES);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: JsonRecord, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
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
  tavilyKey: string;
  execution: { invocationId: string; agentRunId: string | null; absoluteDeadlineAt: number; signal: AbortSignal };
};

function environment(execution: Environment["execution"]): Environment | null {
  const value = {
    supabaseUrl: Deno.env.get("SUPABASE_URL") ?? "",
    publishableKey: configuredKey("SUPABASE_PUBLISHABLE_KEYS", "SUPABASE_ANON_KEY"),
    secretKey: configuredKey("SUPABASE_SECRET_KEYS", "SUPABASE_SERVICE_ROLE_KEY"),
    tavilyKey: Deno.env.get("TAVILY_API_KEY") ?? "",
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
    finalizationReserveMs: MIN_POST_WRITE_BUDGET_MS,
  });
}

class DraftFixerRpcError extends Error {
  readonly status: number;

  constructor(code: string, status: number) {
    super(code);
    this.name = "DraftFixerRpcError";
    this.status = status;
  }
}

async function rpc(
  env: Environment,
  name: string,
  args: JsonRecord,
  authorization: string,
): Promise<JsonRecord> {
  const response = await fetchInternal(env, `${env.supabaseUrl}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: restHeaders(env.publishableKey, authorization),
    body: JSON.stringify(args),
    signal: env.execution.signal,
  });
  const payload = await response.json().catch(() => ({})) as JsonRecord;
  if (!response.ok) {
    console.error("draft fixer rpc", JSON.stringify({ name, status: response.status }));
    throw new DraftFixerRpcError(
      cleanText(payload.message ?? payload.code, 120) || `RPC_${response.status}`,
      response.status,
    );
  }
  return payload;
}

async function serviceRpc(env: Environment, name: string, args: JsonRecord): Promise<JsonRecord> {
  const response = await fetchInternal(env, `${env.supabaseUrl}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: restHeaders(env.secretKey),
    body: JSON.stringify(args),
    signal: env.execution.signal,
  });
  const payload = await response.json().catch(() => ({})) as JsonRecord;
  if (!response.ok) {
    console.error("draft fixer service rpc", JSON.stringify({ name, status: response.status }));
    throw new DraftFixerRpcError(
      cleanText(payload.message ?? payload.code, 120) || `RPC_${response.status}`,
      response.status,
    );
  }
  return payload;
}

async function authenticateAdmin(env: Environment, authorization: string): Promise<{ id: string } | Response> {
  if (!authorization.startsWith("Bearer ")) {
    return jsonResponse({ error: "AUTH_REQUIRED", message: "Inicia sesión para continuar." }, 401);
  }
  const response = await fetchInternal(env, `${env.supabaseUrl}/auth/v1/user`, {
    headers: restHeaders(env.publishableKey, authorization),
    signal: env.execution.signal,
  });
  const user = await response.json().catch(() => ({})) as JsonRecord;
  if (!response.ok || !cleanText(user.id, 80)) {
    return jsonResponse({ error: "AUTH_REQUIRED", message: "La sesión ha caducado." }, 401);
  }
  const metadata = isRecord(user.app_metadata) ? user.app_metadata : {};
  if (metadata.oraklo_admin !== true) {
    return jsonResponse({ error: "ADMIN_REQUIRED", message: "Solo administración puede corregir borradores." }, 403);
  }
  return { id: cleanText(user.id, 80) };
}

function normalize(value: unknown): string {
  return cleanText(value, 8_000)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function hostnameTokens(url: string | null): string[] {
  if (!url) return [];
  try {
    return new URL(url).hostname.toLowerCase().split(".").filter((part) => part.length >= 4 && !["www", "news", "blog", "games"].includes(part));
  } catch {
    return [];
  }
}

function subjectTokens(value: string): string[] {
  return normalize(value).split(" ").filter((token) => token.length >= 3 && ![
    "the", "auto", "game", "official", "oficial", "nuevo", "nueva", "trailer", "release",
  ].includes(token));
}

function authoritativeHost(url: string, authoritativeDomains: ReadonlySet<string>): boolean {
  try {
    const hostname = new URL(url).hostname.toLowerCase().replace(/\.$/, "");
    return [...authoritativeDomains].some((domain) => hostname === domain || hostname.endsWith(`.${domain}`));
  } catch {
    return false;
  }
}

async function loadPrimarySourceRegistry(env: Environment): Promise<JsonRecord[]> {
  const response = await fetchInternal(env, `${env.supabaseUrl}/rest/v1/rpc/get_market_draft_authoritative_source_registry_v1`, {
    method: "POST",
    headers: restHeaders(env.secretKey),
    body: JSON.stringify({ role_input: "primary_resolution" }),
    signal: env.execution.signal,
  });
  const payload = await response.json().catch(() => []) as unknown;
  if (!response.ok || !Array.isArray(payload)) throw new Error("PRIMARY_SOURCE_REGISTRY_UNAVAILABLE");
  const registry = normalizePrimarySourceRegistry(payload) as JsonRecord[];
  if (!registry.length) throw new Error("PRIMARY_SOURCE_REGISTRY_EMPTY");
  return registry;
}

async function loadAuthoritativeSourceDomains(env: Environment): Promise<Set<string>> {
  const response = await fetchInternal(env, `${env.supabaseUrl}/rest/v1/rpc/get_market_radar_authoritative_source_domains_v1`, {
    method: "POST",
    headers: restHeaders(env.secretKey),
    body: "{}",
    signal: env.execution.signal,
  });
  const payload = await response.json().catch(() => []) as unknown;
  if (!response.ok || !Array.isArray(payload)) throw new Error("SOURCE_AUTHORITY_REGISTRY_UNAVAILABLE");
  const domains = payload.filter(isRecord)
    .map((item) => cleanText(item.canonical_domain, 255).toLowerCase())
    .filter((domain) => /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain));
  if (!domains.length) throw new Error("SOURCE_AUTHORITY_REGISTRY_EMPTY");
  return new Set(domains);
}

function candidateSources(context: JsonRecord): JsonRecord[] {
  const candidate = isRecord(context.radar_candidate) ? context.radar_candidate : {};
  const evidence = Array.isArray(candidate.verification_evidence) ? candidate.verification_evidence : [];
  const payloadEvidence = Array.isArray(candidate.normalized_payload)
    ? candidate.normalized_payload
    : isRecord(candidate.normalized_payload) && Array.isArray(candidate.normalized_payload.verification_evidence)
      ? candidate.normalized_payload.verification_evidence
      : [];
  return [...evidence, ...payloadEvidence].filter(isRecord);
}

function sourceIsRelevant(
  value: JsonRecord,
  subject: string,
  archetype: string,
  primaryUrl: string,
  authoritativeDomains: ReadonlySet<string>,
  includeDeclaredText = true,
): boolean {
  const url = safePublicUrl(value.url);
  if (!url || url === primaryUrl || !authoritativeHost(url, authoritativeDomains)) return false;
  const parsed = new URL(url);
  const declared = includeDeclaredText ? `${value.title ?? value.name ?? ""} ${value.supports ?? ""} ${value.content ?? value.snippet ?? ""}` : "";
  const titleAndExcerpt = normalize(includeDeclaredText
    ? `${declared} ${value.excerpt ?? ""} ${parsed.pathname}`
    : `${value.excerpt ?? ""}`);
  const entityTokens = subjectTokens(subject);
  const matches = entityTokens.filter((token) => titleAndExcerpt.includes(token));
  const requiredMatches = entityTokens.some((token) => /\d/.test(token)) ? 1 : Math.min(2, entityTokens.length);
  const entityMatch = requiredMatches > 0 && matches.length >= requiredMatches;
  const propositionMatch = archetype !== "content_release" || /\b(trailer|teaser|avance)\b/.test(titleAndExcerpt);
  return propositionMatch && entityMatch;
}

function verifiedClaimSlots(context: JsonRecord, subject: string, excerpt: string): string[] {
  const slots: string[] = [];
  if (inferRelativeTemporalContract(context) && extractTemporalAnchorDate(excerpt, subject)) {
    slots.push("TEMPORAL_ANCHOR");
  }
  return slots;
}

async function readLimitedExcerpt(response: Response): Promise<string> {
  const contentType = cleanText(response.headers.get("content-type"), 160).toLowerCase();
  if (contentType && !/(?:text|html|json|xml|javascript)/.test(contentType)) {
    try { await response.body?.cancel(); } catch { /* No se reutiliza el cuerpo. */ }
    return "";
  }
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (total < MAX_SOURCE_EXCERPT_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      const remaining = MAX_SOURCE_EXCERPT_BYTES - total;
      const chunk = value.byteLength > remaining ? value.slice(0, remaining) : value;
      chunks.push(chunk);
      total += chunk.byteLength;
      if (chunk.byteLength < value.byteLength) break;
    }
  } finally {
    try { await reader.cancel(); } catch { /* El límite ya quedó aplicado. */ }
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const decoded = new TextDecoder().decode(bytes);
  const metadata = [...decoded.matchAll(/<meta\b[^>]*\bcontent=["']([^"']{1,2000})["'][^>]*>/gi)]
    .map((match) => match[1]);
  const raw = `${metadata.join(" ")} ${decoded}`
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(?:nbsp|amp|quot|apos|lt|gt);/gi, " ");
  return cleanText(raw, MAX_SOURCE_EXCERPT_CHARS);
}

async function validateOfficialUrl(
  value: unknown,
  primaryUrl: string,
  authoritativeDomains: ReadonlySet<string>,
  deadlineAt: number,
  requestSignal: AbortSignal,
): Promise<{ url: string; excerpt: string } | null> {
  let current = safePublicUrl(value);
  if (!current || current === primaryUrl || !authoritativeHost(current, authoritativeDomains)) return null;
  for (let redirect = 0; redirect <= 3; redirect += 1) {
    if (Date.now() >= deadlineAt || requestSignal.aborted) return null;
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      Math.min(SOURCE_TIMEOUT_MS, Math.max(1, deadlineAt - Date.now())),
    );
    try {
      const response = await fetch(current, {
        method: "GET",
        redirect: "manual",
        headers: { Range: `bytes=0-${MAX_SOURCE_EXCERPT_BYTES - 1}`, "User-Agent": "Atinara-Source-Validator/1.0" },
        signal: AbortSignal.any([controller.signal, requestSignal]),
      });
      const location = response.headers.get("location");
      if (response.status >= 300 && response.status < 400 && location) {
        current = safePublicUrl(new URL(location, current).toString());
        if (!current || !authoritativeHost(current, authoritativeDomains)) return null;
        continue;
      }
      if (!response.ok) {
        try { await response.body?.cancel(); } catch { /* No se reutiliza el cuerpo. */ }
        return null;
      }
      const excerpt = await readLimitedExcerpt(response);
      return { url: current, excerpt };
    } catch {
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }
  return null;
}

function parentUrlCandidates(primaryUrl: string): JsonRecord[] {
  try {
    const url = new URL(primaryUrl);
    const parts = url.pathname.split("/").filter(Boolean);
    const candidates: JsonRecord[] = [];
    while (parts.length > 0) {
      parts.pop();
      const parent = new URL(`/${parts.join("/")}${parts.length ? "/" : ""}`, url.origin).toString();
      if (parent !== primaryUrl && parent !== `${url.origin}/`) {
        candidates.push({ url: parent, title: `Sección oficial de ${url.hostname}` });
      }
    }
    return candidates.slice(0, 3);
  } catch {
    return [];
  }
}

async function searchTavily(
  env: Environment,
  subject: string,
  archetype: string,
  authoritativeDomains: ReadonlySet<string>,
  deadlineAt: number,
  requestSignal: AbortSignal,
): Promise<{ sources: JsonRecord[]; warning: string | null }> {
  if (!env.tavilyKey) return { sources: [], warning: "TAVILY_NOT_CONFIGURED" };
  if (Date.now() >= deadlineAt || requestSignal.aborted) {
    return { sources: [], warning: "SOURCE_VALIDATION_BUDGET_EXHAUSTED" };
  }
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    Math.min(PROVIDER_TIMEOUT_MS, Math.max(1, deadlineAt - Date.now())),
  );
  try {
    const response = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.tavilyKey}` },
      body: JSON.stringify({
        query: archetype === "metric_threshold"
          ? `${subject} Metacritic Metascore official release date platforms`
          : `${subject} ${archetype.replaceAll("_", " ")} official newsroom press release`,
        search_depth: "basic",
        max_results: 8,
        include_answer: false,
        include_raw_content: false,
        include_domains: [...authoritativeDomains],
      }),
      signal: AbortSignal.any([controller.signal, requestSignal]),
    });
    if (!response.ok) return { sources: [], warning: response.status === 429 ? "TAVILY_RATE_LIMITED" : `TAVILY_HTTP_${response.status}` };
    const payload = await response.json().catch(() => ({})) as JsonRecord;
    const results = Array.isArray(payload.results) ? payload.results.filter(isRecord) : [];
    return { sources: results, warning: null };
  } catch (error) {
    return { sources: [], warning: Date.now() >= deadlineAt || requestSignal.aborted
      ? "SOURCE_VALIDATION_BUDGET_EXHAUSTED"
      : error instanceof DOMException && error.name === "AbortError" ? "TAVILY_TIMEOUT" : "TAVILY_INVALID_RESPONSE" };
  } finally {
    clearTimeout(timeout);
  }
}

async function discoverOfficialPrimary(
  env: Environment,
  context: JsonRecord,
  deadlineAt: number,
  requestSignal: AbortSignal,
): Promise<{
  source: JsonRecord | null;
  evidenceChecked: JsonRecord[];
  checkSnapshot: JsonRecord | null;
  warnings: string[];
}> {
  // El registro se carga antes de seleccionar: binding, candidata y draft son
  // únicamente URLs a investigar y no aportan autoridad por sí mismos.
  const registry = await loadPrimarySourceRegistry(env);
  const draft = isRecord(context.draft) ? context.draft : {};
  const candidateContext = isRecord(context.radar_candidate) ? context.radar_candidate : {};
  const validationContext = {
    ...context,
    source_validation_category: cleanText(
      context.proposed_category || draft.category || candidateContext.atinara_category,
      120,
    ),
  };
  return await discoverRegisteredPrimarySource(validationContext, registry, {
    candidates: primarySourceCandidates(context).slice(0, 8),
    fetcher: fetch,
    max_declared_candidates: 8,
    max_search_candidates: 6,
    validation_options: {
      timeout_ms: SOURCE_TIMEOUT_MS,
      max_redirects: 3,
      deadline_at: deadlineAt,
      signal: requestSignal,
    },
    searcher: ({ subject, archetype, domains }: { subject: string; archetype: string; domains: string[] }) => searchTavily(
      env, subject, archetype, new Set(domains), deadlineAt, requestSignal,
    ),
  }) as {
    source: JsonRecord | null;
    evidenceChecked: JsonRecord[];
    checkSnapshot: JsonRecord | null;
    warnings: string[];
  };
}

async function discoverOfficialAlternatives(
  env: Environment,
  context: JsonRecord,
  primarySource: JsonRecord,
  deadlineAt: number,
  requestSignal: AbortSignal,
): Promise<{ sources: JsonRecord[]; warnings: string[]; evidenceChecked: JsonRecord[] }> {
  const draft = isRecord(context.draft) ? context.draft : {};
  const archetype = inferArchetype(context);
  const subject = inferSubject(context, archetype);
  const primaryUrl = safePublicUrl(primarySource.url);
  if (!primaryUrl) return { sources: [], warnings: ["PRIMARY_SOURCE_NOT_AUTHORITATIVE"], evidenceChecked: [] };
  let authoritativeDomains: Set<string>;
  try {
    authoritativeDomains = await loadAuthoritativeSourceDomains(env);
  } catch (error) {
    return {
      sources: [],
      warnings: [cleanText(error instanceof Error ? error.message : error, 120) || "SOURCE_AUTHORITY_REGISTRY_UNAVAILABLE"],
      evidenceChecked: [],
    };
  }
  const existing = Array.isArray(draft.alternative_sources) ? draft.alternative_sources.filter(isRecord) : [];
  const candidates = [...existing, ...candidateSources(context), ...parentUrlCandidates(primaryUrl)]
    .filter((item) => sourceIsRelevant(item, subject, archetype, primaryUrl, authoritativeDomains));
  const warnings: string[] = [];
  const accepted: JsonRecord[] = [];
  const evidenceChecked: JsonRecord[] = [];

  for (const candidate of candidates.slice(0, 6)) {
    if (Date.now() >= deadlineAt || requestSignal.aborted) {
      warnings.push("SOURCE_VALIDATION_BUDGET_EXHAUSTED");
      break;
    }
    const validated = await validateOfficialUrl(
      candidate.url, primaryUrl, authoritativeDomains, deadlineAt, requestSignal,
    );
    const relevant = Boolean(validated && sourceIsRelevant(
      { url: validated.url, excerpt: validated.excerpt }, subject, archetype, primaryUrl, authoritativeDomains, false,
    ));
    evidenceChecked.push({
      url: safePublicUrl(candidate.url),
      accepted: relevant,
      source: "provenance",
      authority: "private_source_registry_v1",
      claim_slots: validated && relevant ? verifiedClaimSlots(context, subject, validated.excerpt) : [],
    });
    if (validated && relevant) accepted.push({
      url: validated.url,
      title: cleanText(candidate.title ?? candidate.name, 240),
      publisher: new URL(validated.url).hostname,
      excerpt: validated.excerpt,
      validated_reachable: true,
      authority_verified: true,
      relevance_verified: true,
      authority_basis: "private_source_registry_v1",
      relevance_basis: "fetched_content_v1",
      claim_slots: verifiedClaimSlots(context, subject, validated.excerpt),
    });
    if (accepted.length >= 3 && (!inferRelativeTemporalContract(context)
      || accepted.some((source) => Array.isArray(source.claim_slots)
        && source.claim_slots.includes("TEMPORAL_ANCHOR")))) break;
  }

  const temporalAnchorRequired = Boolean(inferRelativeTemporalContract(context));
  const temporalAnchorVerified = () => accepted.some((source) => Array.isArray(source.claim_slots)
    && source.claim_slots.includes("TEMPORAL_ANCHOR"));
  // La investigación es dirigida por slots: una página puede ser oficial y
  // relevante para la entidad sin demostrar todavía la fecha del hecho ancla.
  if (!accepted.length || (temporalAnchorRequired && !temporalAnchorVerified())) {
    const search = await searchTavily(
      env, subject, archetype, authoritativeDomains, deadlineAt, requestSignal,
    );
    if (search.warning) warnings.push(search.warning);
    for (const candidate of search.sources.filter((item) => sourceIsRelevant(
      item, subject, archetype, primaryUrl, authoritativeDomains,
    )).slice(0, 4)) {
      if (Date.now() >= deadlineAt || requestSignal.aborted) {
        warnings.push("SOURCE_VALIDATION_BUDGET_EXHAUSTED");
        break;
      }
      const validated = await validateOfficialUrl(
        candidate.url, primaryUrl, authoritativeDomains, deadlineAt, requestSignal,
      );
      const relevant = Boolean(validated && sourceIsRelevant(
        { url: validated.url, excerpt: validated.excerpt }, subject, archetype, primaryUrl, authoritativeDomains, false,
      ));
      evidenceChecked.push({
        url: safePublicUrl(candidate.url),
        accepted: relevant,
        source: "tavily",
        authority: "private_source_registry_v1",
        claim_slots: validated && relevant ? verifiedClaimSlots(context, subject, validated.excerpt) : [],
      });
      if (validated && relevant) accepted.push({
        url: validated.url,
        title: cleanText(candidate.title ?? candidate.name, 240),
        publisher: new URL(validated.url).hostname,
        excerpt: validated.excerpt,
        validated_reachable: true,
        authority_verified: true,
        relevance_verified: true,
        authority_basis: "private_source_registry_v1",
        relevance_basis: "fetched_content_v1",
        claim_slots: verifiedClaimSlots(context, subject, validated.excerpt),
      });
      if (accepted.length >= 3 && (!temporalAnchorRequired || temporalAnchorVerified())) break;
    }
  }

  return { sources: mergeAlternativeSources(accepted), warnings, evidenceChecked };
}

function minimalSemanticContext(context: JsonRecord): JsonRecord {
  const draft = isRecord(context.draft) ? context.draft : {};
  const candidate = isRecord(context.radar_candidate) ? context.radar_candidate : {};
  const review = isRecord(context.latest_review) ? context.latest_review : {};
  return {
    draft: Object.fromEntries([
      "question", "subject", "category", "evaluation_period_label", "evaluation_ends_at", "timezone",
      "resolution_deadline", "yes_criteria", "no_criteria", "edge_cases", "public_criteria", "description",
      "delay_treatment", "cancellation_treatment", "leak_treatment", "rename_treatment", "assumptions",
    ].map((field) => [field, draft[field]])),
    source_contract: Object.fromEntries([
      "source_question", "source_title", "source_resolution_rules", "source_resolution_deadline",
      "source_close_at", "atinara_resolution_criteria", "atinara_resolution_source_url",
    ].map((field) => [field, candidate[field]])),
    blocking_reasons: Array.isArray(review.blocking_reasons) ? review.blocking_reasons
      : Array.isArray(review.semantic_issues) ? review.semantic_issues : [],
  };
}

async function semanticEdit(
  env: Environment,
  context: JsonRecord,
  deterministic: JsonRecord,
  invocationId: string,
): Promise<{ value: JsonRecord | null; warning: string | null; telemetryStatus: string; warnings: readonly string[] }> {
  try {
    const gateway = createAiGateway({ supabaseUrl: env.supabaseUrl, supabaseSecretKey: env.secretKey });
    const result = await gateway.generateStructured({
      taskType: "market_draft_repair",
      ...AI_TASK_CONTRACTS.market_draft_repair,
      input: { context: minimalSemanticContext(context), deterministic },
    }, { ...env.execution, invocationId });
    return {
      value: result.value as JsonRecord,
      warning: null,
      telemetryStatus: result.telemetryStatus,
      warnings: result.warnings,
    };
  } catch (error) {
    const code = cleanText(error instanceof Error ? error.message : error, 120);
    return { value: null, warning: code.startsWith("AI_") ? code : "AI_PROVIDER_INVALID_RESPONSE", telemetryStatus: "unknown", warnings: [] };
  }
}

function semanticUnresolvedEscalation(value: JsonRecord | null): JsonRecord | null {
  if (!value || !Array.isArray(value.unresolved_issues) || value.unresolved_issues.length === 0) return null;
  const normalized: JsonRecord[] = [];
  for (const raw of value.unresolved_issues.slice(0, 8)) {
    if (!isRecord(raw)) {
      return {
        code: "SEMANTIC_EDITOR_RESPONSE_INVALID",
        field: "automatic_review",
        evidence: [],
        alternatives: [],
        reason: "El editor semántico devolvió una incidencia sin estructura válida.",
      };
    }
    const code = cleanText(raw.code, 100).toUpperCase();
    const field = cleanText(raw.field, 100).toLowerCase().replace(/[^a-z0-9_]/g, "_");
    const reason = cleanText(raw.reason, 800);
    if (!VALIDATOR_CONTENT_ISSUE_CODE_SET.has(code) || !field || reason.length < 8) {
      return {
        code: "SEMANTIC_EDITOR_RESPONSE_INVALID",
        field: "automatic_review",
        evidence: [],
        alternatives: [],
        reason: "El editor semántico usó un código fuera de la taxonomía cerrada o una explicación incompleta.",
      };
    }
    normalized.push({ code, field, reason });
  }
  const first = normalized[0];
  return {
    code: first.code,
    field: first.field,
    evidence: [],
    alternatives: normalized.map((issue) => cleanText(issue.reason, 800)),
    reason: cleanText(first.reason, 800),
  };
}

function repairRoundSignature(deterministic: JsonRecord, repaired: JsonRecord): string {
  const issuePlan = isRecord(deterministic.issue_plan) ? deterministic.issue_plan : {};
  const codes = Array.isArray(issuePlan.codes)
    ? issuePlan.codes.map((value) => cleanText(value, 100)).sort((left, right) => left.localeCompare(right))
    : [];
  const fields = [
    "question", "subject", "evaluation_ends_at", "timezone", "resolution_deadline",
    "yes_criteria", "no_criteria", "edge_cases", "public_criteria", "description",
    "delay_treatment", "cancellation_treatment", "leak_treatment", "rename_treatment", "assumptions",
  ];
  return JSON.stringify({
    archetype: cleanText(deterministic.archetype, 100),
    codes,
    patch: Object.fromEntries(fields.map((field) => [field, repaired[field] ?? null])),
    primary_source_url: safePublicUrl(isRecord(repaired.primary_source) ? repaired.primary_source.url : null),
  });
}

async function sha256Hex(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(typeof value === "string" ? value : JSON.stringify(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function deterministicRequestUuid(requestKey: string, label: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${requestKey}:${label}`),
  )).slice(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function repairAuditIssuePlan(value: unknown): JsonRecord {
  const plan = isRecord(value) ? value : {};
  const rawDispositions = isRecord(plan.dispositions) ? plan.dispositions : {};
  const codes = Array.isArray(plan.codes)
    ? [...new Set(plan.codes
      .map((code) => cleanText(code, 100).toUpperCase())
      .filter((code) => REPAIRABLE_ISSUE_CODE_SET.has(code)))]
      .sort((left, right) => left.localeCompare(right))
      .slice(0, REPAIRABLE_ISSUE_CODES.length)
    : [];
  return {
    codes,
    dispositions: Object.fromEntries(codes.map((code) => [
      code,
      cleanText(rawDispositions[code], 100),
    ]).filter(([, disposition]) => Boolean(disposition))),
  };
}

function repairAuditTemporalContract(value: unknown): JsonRecord | null {
  if (!isRecord(value)) return null;
  const anchorDate = cleanText(value.anchor_date, 10);
  const offsetDays = Number(value.offset_days);
  const sourceUrl = safePublicUrl(value.source_url);
  if (!/^20\d{2}-\d{2}-\d{2}$/.test(anchorDate)
    || !Number.isSafeInteger(offsetDays) || offsetDays < 0 || offsetDays > 3_650
    || !sourceUrl) return null;
  return {
    anchor_type: cleanText(value.anchor_type, 40),
    anchor_date: anchorDate,
    offset_days: offsetDays,
    observation_time: cleanText(value.observation_time, 5),
    timezone: cleanText(value.timezone, 100),
    source_url: sourceUrl,
  };
}

function compactPrimarySourceCheck(value: unknown): JsonRecord | null {
  if (!isRecord(value) || value.accepted !== true) return null;
  const requestedUrl = safePublicUrl(value.requested_url);
  const finalUrl = safePublicUrl(value.final_url);
  const registrySourceId = cleanText(value.registry_source_id, 80).toLowerCase();
  const checkedAt = cleanText(value.checked_at, 100);
  const draftCategory = cleanText(value.draft_category, 120);
  const parserVersion = cleanText(value.registry_parser_version ?? value.parser_version, 120);
  const validationVersion = cleanText(value.validation_version, 120);
  const registryDomain = cleanText(value.registry_domain, 255).toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
  const registryCategories = Array.isArray(value.registry_categories)
    ? value.registry_categories.map((category) => normalize(category)).filter(Boolean).slice(0, 20) : null;
  const relevanceBasis = cleanText(value.relevance_basis, 120);
  const matchedTokens = Array.isArray(value.matched_tokens)
    ? value.matched_tokens.map((token) => cleanText(token, 80)).filter(Boolean).slice(0, 8) : [];
  const httpStatus = Number(value.http_status);
  const excerptSha256 = cleanText(value.excerpt_sha256, 64).toLowerCase();
  const excerptChars = Number(value.excerpt_chars);
  const redirectChain = Array.isArray(value.redirect_chain)
    ? value.redirect_chain.map((url) => safePublicUrl(url)).filter(Boolean).slice(0, 5)
    : [];
  if (!requestedUrl || !finalUrl
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(registrySourceId)
    || !Number.isFinite(new Date(checkedAt).getTime())
    || !draftCategory || !parserVersion
    || !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(registryDomain)
    || !finalUrl || !(new URL(finalUrl).hostname === registryDomain
      || new URL(finalUrl).hostname.endsWith(`.${registryDomain}`))
    || !Array.isArray(registryCategories)
    || (registryCategories.length > 0 && !registryCategories.includes(normalize(draftCategory)))
    || value.registry_role_verified !== true
    || cleanText(value.registry_role, 80) !== "primary_resolution"
    || cleanText(value.authority, 120) !== "private_source_registry_primary_resolution_v1"
    || !["fetched_content_v1", "fetched_content_and_canonical_url_v1"].includes(relevanceBasis)
    || matchedTokens.length === 0
    || !Number.isInteger(httpStatus) || httpStatus < 200 || httpStatus > 299
    || !/^[0-9a-f]{64}$/.test(excerptSha256)
    || !Number.isInteger(excerptChars) || excerptChars < 1 || excerptChars > MAX_SOURCE_EXCERPT_CHARS
    || validationVersion !== "atinara-primary-source-validation-v1"
    || redirectChain[0] !== requestedUrl || redirectChain.at(-1) !== finalUrl) return null;
  return {
    kind: "primary_resolution",
    requested_url: requestedUrl,
    final_url: finalUrl,
    candidate_origin: cleanText(value.candidate_origin, 80),
    accepted: true,
    code: "PRIMARY_SOURCE_VERIFIED",
    checked_at: checkedAt,
    redirect_count: redirectChain.length - 1,
    redirect_chain: redirectChain,
    registry_source_id: registrySourceId,
    registry_domain: registryDomain,
    registry_parser_version: parserVersion,
    parser_version: parserVersion,
    registry_categories: registryCategories,
    draft_category: draftCategory,
    registry_role: "primary_resolution",
    registry_role_verified: true,
    authority: "private_source_registry_primary_resolution_v1",
    relevance_basis: relevanceBasis,
    matched_tokens: matchedTokens,
    http_status: httpStatus,
    excerpt_sha256: excerptSha256,
    excerpt_chars: excerptChars,
    validated_reachable: true,
    authority_verified: true,
    relevance_verified: true,
    validation_version: validationVersion,
  };
}

async function recordPrimarySourceCheck(
  env: Environment,
  draftId: string,
  draftVersion: number,
  checkSnapshot: JsonRecord,
): Promise<string> {
  const snapshot = compactPrimarySourceCheck(checkSnapshot);
  if (!snapshot) throw new Error("PRIMARY_SOURCE_CHECK_INVALID");
  const recorded = await serviceRpc(env, "record_market_draft_primary_source_check_v1", {
    draft_id_input: draftId,
    draft_version_input: draftVersion,
    registry_source_id_input: snapshot.registry_source_id,
    requested_url_input: snapshot.requested_url,
    final_url_input: snapshot.final_url,
    category_input: snapshot.draft_category,
    validation_version_input: snapshot.validation_version,
    evidence_snapshot_input: snapshot,
  });
  const checkId = cleanText(recorded.id, 80).toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(checkId)) {
    throw new Error("PRIMARY_SOURCE_CHECK_RECORD_INVALID");
  }
  return checkId;
}

function resolutionSources(context: JsonRecord, draft: JsonRecord, temporalContract: JsonRecord | null = null): JsonRecord[] {
  const primary = safePublicUrl(isRecord(draft.primary_source) ? draft.primary_source.url : null);
  if (!primary) return [];
  const temporalAnchorSource = safePublicUrl(temporalContract?.source_url);
  const existing = new Map<string, JsonRecord>();
  for (const source of Array.isArray(context.binding_sources) ? context.binding_sources.filter(isRecord) : []) {
    const url = safePublicUrl(source.url);
    if (url) existing.set(url, source);
  }
  const result: JsonRecord[] = [{ url: primary, role: "PRIMARY_RESOLUTION", precedence: 1, required: true, fallback_condition: null }];
  let precedence = 2;
  for (const source of mergeAlternativeSources(draft.alternative_sources)) {
    if (source.url === primary) continue;
    const previous = existing.get(source.url);
    const isTemporalAnchor = Boolean(temporalAnchorSource && source.url === temporalAnchorSource);
    const previousRole = cleanText(previous?.role, 80).toUpperCase();
    const role = isTemporalAnchor ? "CONTEXT_SOURCE"
      : previousRole === "FALLBACK_RESOLUTION" ? "FALLBACK_RESOLUTION"
        : previousRole === "CONTEXT_SOURCE" ? "CONTEXT_SOURCE"
          : "CORROBORATION";
    result.push({
      url: source.url,
      role,
      precedence,
      required: isTemporalAnchor,
      fallback_condition: role === "FALLBACK_RESOLUTION"
        ? cleanText(previous?.fallback_condition, 800) || "Usar solo cuando la fuente primaria no esté disponible."
        : isTemporalAnchor
          ? "Fuente oficial requerida exclusivamente para fijar la fecha-ancla del periodo relativo; no sustituye la métrica de resolución."
          : cleanText(previous?.fallback_condition, 800) || "Usar para corroborar; no sustituye la fuente primaria de resolución.",
    });
    precedence += 1;
  }
  return result.slice(0, 12);
}

async function revalidate(
  env: Environment,
  authorization: string,
  draftId: string,
  version: number,
  attemptId: string,
): Promise<JsonRecord> {
  const response = await fetchInternal(env, `${env.supabaseUrl}/functions/v1/validate-market-draft`, {
    method: "POST",
    headers: restHeaders(env.publishableKey, authorization),
    body: JSON.stringify({ draft_id: draftId, expected_version: version, attempt_id: attemptId, force_review: true }),
    signal: env.execution.signal,
  });
  const payload = await response.json().catch(() => ({})) as JsonRecord;
  if (!response.ok && payload.classification !== "technical") {
    throw new Error(cleanText(payload.error, 100) || "REVALIDATION_FAILED");
  }
  return payload;
}

function exactEscalation(review: JsonRecord, evidenceChecked: JsonRecord[]): JsonRecord {
  const issues = (Array.isArray(review.blocking_reasons) ? review.blocking_reasons
    : Array.isArray(review.semantic_issues) ? review.semantic_issues
      : Array.isArray(review.issues) ? review.issues : []).filter(isRecord);
  const first = issues[0] ?? {};
  return {
    code: cleanText(first.code, 100) || "REPAIRABLE_REVIEW_ISSUES_EXHAUSTED",
    field: cleanText(first.field, 100) || "market_definition",
    evidence: evidenceChecked,
    alternatives: issues.map((issue) => cleanText(issue.message, 500)).filter(Boolean),
    reason: cleanText(first.message, 800) || "Tres rondas controladas no produjeron una definición aprobable sin inventar hechos.",
  };
}

type CorrectorAgentV2 = ReturnType<typeof createAtinaraAgentRunV2>;

async function persistCorrectorAgentExecution(env: Environment, execution: JsonRecord) {
  return persistAgentTelemetry({
    persistence: createAiPersistence({
      supabaseUrl: env.supabaseUrl,
      secretKey: env.secretKey,
    }),
    context: env.execution,
    execution,
  });
}

async function createCorrectorAgentV2(
  env: Environment,
  authorization: string,
  draftId: string,
  expectedVersion: number,
  runId: string,
): Promise<{ agent: CorrectorAgentV2; registry: JsonRecord }> {
  const registry = await rpc(env, "get_market_agent_registry_v2", {}, authorization);
  if (!isRecord(registry)
    || registry.version !== ATINARA_AGENT_REGISTRY_VERSION
    || !/^[0-9a-f]{64}$/i.test(cleanText(registry.hash, 64))) {
    throw new Error("AGENT_REGISTRY_IDENTITY_MISMATCH");
  }
  assertAgentRegistrySnapshot(registry);
  const executeTool = async (input: JsonRecord) => {
    if (typeof input.execute !== "function") throw new Error("AGENT_TOOL_HANDLER_INVALID");
    const value = await (input.execute as () => Promise<unknown> | unknown)();
    const summary = typeof input.summarize === "function"
      ? (input.summarize as (value: unknown) => JsonRecord)(value)
      : isRecord(input.summary) ? input.summary : {};
    const snapshotFingerprint = typeof input.snapshotFingerprint === "function"
      ? await (input.snapshotFingerprint as (value: unknown) => Promise<string> | string)(value)
      : undefined;
    return {
      value,
      status: ["completed", "degraded", "failed", "no_op"].includes(cleanText(input.status, 20))
        ? cleanText(input.status, 20)
        : "completed",
      summary,
      ...(snapshotFingerprint ? { snapshotFingerprint } : {}),
    };
  };
  const handlers = Object.fromEntries([
    "load_authoritative_draft", "classify_repair_issues", "discover_official_sources",
    "build_typed_patch", "validate_typed_patch", "persist_single_version", "revalidate_draft",
  ].map((tool) => [tool, executeTool]));
  return {
    registry,
    agent: createAtinaraAgentRunV2({
      agentType: "market_corrector_agent",
      registryVersion: registry.version,
      registryHash: registry.hash,
      snapshotFingerprint: await sha256Hex({ draft_id: draftId, version: expectedVersion }),
      handlers,
      runId,
      maxSteps: 24,
      maxRepeatedActions: 3,
      maxReplans: 2,
      finalizationReserveMs: MIN_POST_WRITE_BUDGET_MS,
      executionContext: env.execution,
    }),
  };
}

async function dispatchCorrectorTool<T>(
  agent: CorrectorAgentV2,
  tool: string,
  execute: () => Promise<T> | T,
  options: {
    round?: number;
    actionKey: string;
    progressFingerprint: string;
    status?: string;
    summary?: JsonRecord;
    summarize?: (value: T) => JsonRecord;
    strategyKey?: string;
    snapshotFingerprint?: (value: T) => Promise<string> | string;
  },
): Promise<T> {
  const result = await agent.dispatch(tool, {
    execute,
    status: options.status ?? "completed",
    summary: options.summary ?? {},
    summarize: options.summarize,
    strategyKey: options.strategyKey,
    snapshotFingerprint: options.snapshotFingerprint,
  }, {
    round: options.round ?? 1,
    actionKey: options.actionKey,
    progressFingerprint: options.progressFingerprint,
    expectedSnapshotFingerprint: agent.snapshot().snapshot_fingerprint,
  });
  return result.value as T;
}

function selectCorrectorWriteStrategy(
  registry: JsonRecord,
  issueCodes: unknown,
  changedFields: string[],
): { strategyKey: string; strategyKeys: string[] } {
  const codes = new Set(Array.isArray(issueCodes)
    ? issueCodes.map((value) => cleanText(value, 100).toUpperCase()).filter(Boolean)
    : []);
  const strategies = new Map((Array.isArray(registry.strategies) ? registry.strategies : [])
    .filter(isRecord)
    .map((strategy) => [cleanText(strategy.strategy_key, 100), strategy]));
  const strategyKeys = [...new Set((Array.isArray(registry.bindings) ? registry.bindings : [])
    .filter(isRecord)
    .filter((binding) => codes.has(cleanText(binding.issue_code, 100).toUpperCase()))
    .map((binding) => cleanText(binding.strategy_key, 100))
    .filter((key) => strategies.get(key)?.can_write === true))];
  if (!strategyKeys.length) throw new Error("AGENT_STRATEGY_WRITE_FORBIDDEN");
  const allowedFields = new Set(strategyKeys.flatMap((key) => {
    const strategy = strategies.get(key);
    return Array.isArray(strategy?.write_fields)
      ? strategy.write_fields.map((field) => cleanText(field, 80)).filter(Boolean)
      : [];
  }));
  if (changedFields.some((field) => !allowedFields.has(field))) {
    throw new Error("AGENT_STRATEGY_FIELD_NOT_ALLOWED");
  }
  return { strategyKey: strategyKeys[0], strategyKeys };
}

async function executeRepairAndRevalidate(
  env: Environment,
  authorization: string,
  body: JsonRecord,
): Promise<Response> {
  const draftId = cleanText(body.draft_id, 100);
  let expectedVersion = Number(body.expected_version);
  const agent = body.__agent as CorrectorAgentV2;
  const registry = body.__registry as JsonRecord;
  if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(draftId) || !Number.isSafeInteger(expectedVersion) || expectedVersion < 1) {
    return jsonResponse({ error: "INVALID_REPAIR_REQUEST", message: "El identificador o la versión no son válidos." }, 400);
  }

  const allChanged = new Set<string>();
  const allExplanations: JsonRecord[] = [];
  const providerWarnings = new Set<string>();
  let evidenceChecked: JsonRecord[] = [];
  let previousVersion = expectedVersion;
  let lastReview: JsonRecord = {};
  let archetype = "generic_binary_event";
  const workflowRequestKey = cleanText(body.attempt_id, 80) || crypto.randomUUID();
  const repairRequestIds = await Promise.all(Array.from(
    { length: AUTONOMOUS_REPAIR_MAX_ROUNDS },
    (_, index) => deterministicRequestUuid(workflowRequestKey, `repair:${index + 1}`),
  ));
  const reviewAttemptIds = await Promise.all(Array.from(
    { length: AUTONOMOUS_REPAIR_MAX_ROUNDS },
    (_, index) => deterministicRequestUuid(workflowRequestKey, `review:${index + 1}`),
  ));
  const compatibilityReviewAttemptId = await deterministicRequestUuid(workflowRequestKey, "compatibility-review");
  const seenRoundSignatures = new Set<string>();
  const sourceValidationDeadlineAt = Math.min(
    env.execution.absoluteDeadlineAt,
    Date.now() + SOURCE_VALIDATION_BUDGET_MS,
  );
  const sourceValidationSignal = env.execution.signal;
  const budgetResponse = () => {
    const repairSaved = allChanged.size > 0;
    return jsonResponse({
      ok: false,
      error: "SOURCE_VALIDATION_BUDGET_EXHAUSTED",
      classification: "technical",
      repair_applied: repairSaved,
      repair_saved: repairSaved,
      changed_fields: [...allChanged],
      provider_warnings: [...providerWarnings, "SOURCE_VALIDATION_BUDGET_EXHAUSTED"],
      draft_id: draftId,
      previous_version: previousVersion,
      new_version: expectedVersion,
      review_completed: false,
      review_approved: false,
      message: repairSaved
        ? "La última corrección completa quedó guardada, pero se agotó el presupuesto de fuentes antes de otra ronda. Recarga el borrador; continúa privado y sin aprobación."
        : "Se agotó el presupuesto acotado de validación de fuentes. No se inició ninguna escritura y el borrador continúa privado.",
      draft_private: true,
      publishes: false,
      confirms: false,
      resolves: false,
    }, repairSaved ? 200 : 503);
  };

  // Nunca se compila una reparación desde un rechazo de otra política o
  // esquema. Primero se obtiene una revisión v3 sobre la versión exacta; solo
  // sus incidencias compatibles pueden alimentar el plan de corrección.
  const initialContext = await rpc(env, "get_market_draft_expert_repair_context", { draft_id_input: draftId }, authorization);
  const initialDraft = isRecord(initialContext.draft) ? initialContext.draft : null;
  if (!initialDraft) throw new Error("DRAFT_NOT_FOUND");
  if (Number(initialDraft.content_version) !== expectedVersion) throw new Error("DRAFT_VERSION_MOVED");
  await dispatchCorrectorTool(agent, "load_authoritative_draft", () => initialDraft, {
    actionKey: `load:${expectedVersion}`,
    progressFingerprint: `draft:${draftId}:${expectedVersion}:${cleanText(initialDraft.content_fingerprint, 80)}`,
    summary: { draft_version: expectedVersion, review_status: initialDraft.review_status },
  });
  await dispatchCorrectorTool(agent, "classify_repair_issues", () => initialContext, {
    actionKey: `classify:${expectedVersion}`,
    progressFingerprint: `issues:${expectedVersion}:${JSON.stringify(initialContext.repairable_issue_codes ?? initialContext.issue_codes ?? [])}`,
    summary: {
      repair_applicable: initialContext.repair_applicable === true,
      issue_codes: Array.isArray(initialContext.repairable_issue_codes)
        ? initialContext.repairable_issue_codes
        : Array.isArray(initialContext.issue_codes) ? initialContext.issue_codes : [],
    },
  });
  if (initialContext.review_refresh_required === true || initialContext.review_compatible !== true) {
    const compatibleReview = await revalidate(
      env, authorization, draftId, expectedVersion, compatibilityReviewAttemptId,
    );
    if (compatibleReview.classification === "technical") {
      return jsonResponse({
        ok: false,
        error: "COMPATIBLE_REVIEW_REQUIRED",
        classification: "technical",
        technical_code: compatibleReview.technical_code || null,
        review: compatibleReview,
        repair_applied: false,
        review_completed: false,
        review_approved: false,
        message: "La revisión vigente no pudo completarse; no se reutilizó el rechazo obsoleto y no se escribió ninguna corrección.",
        draft_private: true,
        publishes: false,
        confirms: false,
        resolves: false,
      }, 503);
    }
    if (compatibleReview.status === "approved") {
      return jsonResponse({
        ok: true,
        repair_applied: false,
        rounds: 0,
        changed_fields: [],
        review_completed: true,
        review_approved: true,
        review: compatibleReview,
        message: "La versión ya supera la revisión vigente; no había errores compatibles que corregir.",
        draft_private: true,
        publishes: false,
        confirms: false,
        resolves: false,
      });
    }
    if (["already_in_progress", "started"].includes(cleanText(compatibleReview.status, 80))) {
      return jsonResponse({
        ok: false,
        error: "COMPATIBLE_REVIEW_IN_PROGRESS",
        review: compatibleReview,
        repair_applied: false,
        draft_private: true,
        publishes: false,
        confirms: false,
        resolves: false,
      }, 202);
    }
  }

  for (let round = 1; round <= AUTONOMOUS_REPAIR_MAX_ROUNDS; round += 1) {
    if (Date.now() >= sourceValidationDeadlineAt || sourceValidationSignal.aborted) return budgetResponse();
    const context = await rpc(env, "get_market_draft_expert_repair_context", { draft_id_input: draftId }, authorization);
    const draft = isRecord(context.draft) ? context.draft : null;
    if (!draft) throw new Error("DRAFT_NOT_FOUND");
    if (Number(draft.content_version) !== expectedVersion) throw new Error("DRAFT_VERSION_MOVED");
    if (context.repair_applicable !== true && round === 1) throw new Error("DRAFT_REPAIR_NOT_APPLICABLE");

    const boundContextAttestation = await serviceRpc(
      env,
      "get_market_draft_bound_context_attestation_v1",
      { draft_id_input: draftId, expected_version_input: expectedVersion },
    );
    const inferenceContext = repairInferenceContext({
      ...context,
      bound_context_attestation: boundContextAttestation,
    });
    const proposedCategory = inferRepairCategory(inferenceContext);
    if (!proposedCategory) {
      const escalation = {
        code: "CATEGORY_NOT_INFERABLE",
        field: "category",
        evidence: [],
        alternatives: [],
        reason: "La taxonomía y el arquetipo no permiten derivar una categoría única sin una decisión editorial.",
      };
      return jsonResponse({
        ok: false,
        error: escalation.code,
        escalation,
        draft_private: true,
        publishes: false,
        confirms: false,
        resolves: false,
      }, 409);
    }
    const repairContext = repairInferenceContext({ ...inferenceContext, proposed_category: proposedCategory });

    const irreducible = detectIrreducibleAmbiguity(repairContext);
    if (irreducible) {
      return jsonResponse({ ok: false, error: irreducible.code, escalation: irreducible, draft_private: true, publishes: false, confirms: false, resolves: false }, 409);
    }

    const primaryDiscovery = await discoverOfficialPrimary(
      env, repairContext, sourceValidationDeadlineAt, sourceValidationSignal,
    );
    primaryDiscovery.warnings.forEach((warning) => providerWarnings.add(warning));
    evidenceChecked = [...evidenceChecked, ...primaryDiscovery.evidenceChecked].slice(-30);
    if (primaryDiscovery.warnings.includes("SOURCE_VALIDATION_BUDGET_EXHAUSTED")) return budgetResponse();
    const discovery = primaryDiscovery.source
      ? await discoverOfficialAlternatives(
        env, repairContext, primaryDiscovery.source, sourceValidationDeadlineAt, sourceValidationSignal,
      )
      : { sources: [], warnings: [], evidenceChecked: [] };
    await dispatchCorrectorTool(agent, "discover_official_sources", () => ({ primaryDiscovery, discovery }), {
      round,
      status: primaryDiscovery.warnings.length || discovery.warnings.length ? "degraded" : "completed",
      actionKey: `sources:${round}`,
      progressFingerprint: `sources:${round}:${primaryDiscovery.source?.url || "none"}:${discovery.sources.map((source) => source.url).join("|")}`,
      summary: {
        round,
        count: (primaryDiscovery.source ? 1 : 0) + discovery.sources.length,
        warnings: [...primaryDiscovery.warnings, ...discovery.warnings],
      },
    });
    discovery.warnings.forEach((warning) => providerWarnings.add(warning));
    evidenceChecked = [...evidenceChecked, ...discovery.evidenceChecked].slice(-30);
    if (discovery.warnings.includes("SOURCE_VALIDATION_BUDGET_EXHAUSTED")) return budgetResponse();
    const deterministic = buildDeterministicRepair(
      repairContext,
      [...(primaryDiscovery.source ? [primaryDiscovery.source] : []), ...discovery.sources],
    );
    archetype = deterministic.archetype;
    if (deterministic.unresolved) {
      return jsonResponse({
        ok: false,
        error: deterministic.unresolved.code,
        escalation: { ...deterministic.unresolved, evidence: [...(deterministic.unresolved.evidence ?? []), ...evidenceChecked] },
        provider_warnings: [...providerWarnings],
        draft_private: true,
        publishes: false,
        confirms: false,
        resolves: false,
      }, 409);
    }

    const semanticInvocationId = await deterministicRequestUuid(workflowRequestKey, `semantic:${round}`);
    const semantic = await semanticEdit(env, repairContext, deterministic, semanticInvocationId);
    if (semantic.warning) providerWarnings.add(semantic.warning);
    semantic.warnings.forEach((warning) => providerWarnings.add(warning));
    const semanticEscalation = semanticUnresolvedEscalation(semantic.value);
    if (semanticEscalation) {
      return jsonResponse({
        ok: false,
        error: semanticEscalation.code,
        escalation: { ...semanticEscalation, evidence: evidenceChecked },
        provider_warnings: [...providerWarnings],
        draft_private: true,
        publishes: false,
        confirms: false,
        resolves: false,
      }, 409);
    }
    const repaired = applyRepairPatch(draft, deterministic) as JsonRecord;
    const localIssues = validateRepairDraft(repaired);
    if (localIssues.length) {
      return jsonResponse({
        ok: false,
        error: "SAFE_REPAIR_VALIDATION_FAILED",
        escalation: { code: localIssues[0], field: localIssues[0].replace(/^MISSING_/, "").toLowerCase(), evidence: evidenceChecked, alternatives: localIssues, reason: "La propuesta no supera las reglas deterministas del servidor." },
        draft_private: true,
        publishes: false,
        confirms: false,
        resolves: false,
      }, 409);
    }

    const roundSignature = repairRoundSignature(deterministic, repaired);
    if (seenRoundSignatures.has(roundSignature)) {
      return jsonResponse({
        ok: false,
        error: "REPAIR_ROUND_REPEATED",
        escalation: {
          code: "REPAIR_ROUND_REPEATED",
          field: "market_definition",
          evidence: evidenceChecked,
          alternatives: Array.isArray((deterministic.issue_plan as JsonRecord)?.codes)
            ? (deterministic.issue_plan as JsonRecord).codes : [],
          reason: "La siguiente ronda produciría exactamente la misma definición para las mismas incidencias; se detiene sin repetir escrituras ni revisiones.",
        },
        rounds: round,
        draft_private: true,
        publishes: false,
        confirms: false,
        resolves: false,
      }, 409);
    }
    await dispatchCorrectorTool(agent, "build_typed_patch", () => repaired, {
      round,
      actionKey: `patch:${round}`,
      progressFingerprint: `patch:${round}:${roundSignature}`,
      summary: {
        round,
        issue_codes: Array.isArray((deterministic.issue_plan as JsonRecord)?.codes)
          ? (deterministic.issue_plan as JsonRecord).codes : [],
      },
    });
    seenRoundSignatures.add(roundSignature);

    const changed = changedRepairFields(draft, repaired);
    await dispatchCorrectorTool(agent, "validate_typed_patch", () => true, {
      round,
      actionKey: `validate:${round}`,
      progressFingerprint: `validated:${round}:${roundSignature}:${changed.join("|")}`,
      summary: { round, valid: true, changed_fields: changed },
    });
    if (sourceValidationSignal.aborted
      || Date.now() + MIN_POST_WRITE_BUDGET_MS >= sourceValidationDeadlineAt) return budgetResponse();
    if (!primaryDiscovery.checkSnapshot) throw new Error("PRIMARY_SOURCE_CHECK_REQUIRED");
    // La comprobacion autoritativa tambien se registra en rondas no-op: el
    // Validador necesita una atestacion fresca de la version exacta que revisa.
    const primarySourceCheckId = await recordPrimarySourceCheck(
      env,
      draftId,
      expectedVersion,
      primaryDiscovery.checkSnapshot,
    );
    evidenceChecked = evidenceChecked.map((item) => item === primaryDiscovery.checkSnapshot
      ? { ...item, snapshot_id: primarySourceCheckId } : item);
    if (changed.length) {
      const issueCodes = isRecord(deterministic.issue_plan) ? deterministic.issue_plan.codes : [];
      const writeStrategy = selectCorrectorWriteStrategy(registry, issueCodes, changed);
      const sources = resolutionSources(context, repaired, isRecord(deterministic.temporal_contract)
        ? deterministic.temporal_contract : null);
      const contract = buildResolutionPlan({
        ...repairContext,
        repair_temporal_contract: deterministic.temporal_contract,
      }, repaired, sources, archetype);
      const applied = await dispatchCorrectorTool(agent, "persist_single_version", () =>
        rpc(env, "apply_market_draft_expert_repair_v2", {
          draft_id_input: draftId,
          expected_version_input: expectedVersion,
          draft_input: { ...repaired, _idempotency_key: repairRequestIds[round - 1] },
          contract_input: contract,
          sources_input: sources,
          primary_source_check_id_input: primarySourceCheckId,
          repair_meta_input: {
            idempotency_key: repairRequestIds[round - 1],
            changed_fields: changed,
            repair_policy: AUTONOMOUS_REPAIR_VERSION,
            repair_mode: "autonomous_archetype_with_deterministic_guardrails",
            repair_round: round,
            archetype,
            degraded: Boolean(semantic.warning),
            provider_warnings: [...providerWarnings],
            explanations: deterministic.explanations,
            issue_plan: repairAuditIssuePlan(deterministic.issue_plan),
            temporal_contract: repairAuditTemporalContract(deterministic.temporal_contract),
            primary_source_check_id: primarySourceCheckId,
            registry_version: registry.version,
            registry_hash: registry.hash,
            strategy_keys: writeStrategy.strategyKeys,
          },
        }, authorization), {
          round,
          strategyKey: writeStrategy.strategyKey,
          actionKey: `persist:${round}`,
          progressFingerprint: `persist:${round}:${expectedVersion}:${roundSignature}`,
          summarize: (value) => ({
            round,
            draft_version: Number((isRecord(value.draft) ? value.draft.content_version : null) ?? value.new_version),
            changed_field_count: changed.length,
            strategy_key: writeStrategy.strategyKey,
          }),
          snapshotFingerprint: async (value) => sha256Hex({
            draft_id: draftId,
            version: Number((isRecord(value.draft) ? value.draft.content_version : null) ?? value.new_version),
          }),
        });
      expectedVersion = Number((isRecord(applied.draft) ? applied.draft.content_version : null) ?? applied.new_version);
      if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) throw new Error("REPAIR_VERSION_INVALID");
      // apply_market_draft_expert_repair_v2 consume la atestacion de la version
      // anterior. Se enlaza la misma lectura fresca a la nueva version para que
      // la revalidacion posterior pueda comprobarla sin confiar en flags viejos.
      await recordPrimarySourceCheck(
        env,
        draftId,
        expectedVersion,
        primaryDiscovery.checkSnapshot,
      );
      changed.forEach((field) => allChanged.add(field));
      deterministic.explanations.forEach((item: JsonRecord) => allExplanations.push(item));
    }

    lastReview = await revalidate(env, authorization, draftId, expectedVersion, reviewAttemptIds[round - 1]);
    await dispatchCorrectorTool(agent, "revalidate_draft", () => lastReview, {
      round,
      status: lastReview.classification === "technical" ? "degraded" : "completed",
      actionKey: `revalidate:${round}`,
      progressFingerprint: `review:${round}:${expectedVersion}:${cleanText(lastReview.status, 80)}:${cleanText(lastReview.technical_code, 100)}`,
      summary: { round, draft_version: expectedVersion, review_status: lastReview.status },
    });
    if (lastReview.status === "approved") {
      return jsonResponse({
        ok: true,
        repair_applied: allChanged.size > 0,
        archetype,
        rounds: round,
        changed_fields: [...allChanged],
        explanations: allExplanations,
        degraded: providerWarnings.size > 0,
        provider_warnings: [...providerWarnings],
        evidence_checked: evidenceChecked,
        draft_id: draftId,
        previous_version: previousVersion,
        new_version: expectedVersion,
        review_completed: true,
        review_approved: true,
        review: lastReview,
        message: "Correcciones autónomas aplicadas y revisión automática aprobada. La confirmación humana sigue siendo obligatoria antes de publicar.",
        publishes: false,
        confirms: false,
        resolves: false,
      });
    }
    if (lastReview.classification === "technical") {
      return jsonResponse({
        ok: false,
        error: "AUTOMATIC_REVIEW_TECHNICAL_INCOMPLETE",
        repair_applied: allChanged.size > 0,
        repair_saved: allChanged.size > 0,
        archetype,
        rounds: round,
        changed_fields: [...allChanged],
        explanations: allExplanations,
        degraded: true,
        provider_warnings: [...providerWarnings, cleanText(lastReview.technical_code, 100)].filter(Boolean),
        technical_incident: lastReview,
        draft_id: draftId,
        previous_version: previousVersion,
        new_version: expectedVersion,
        review_completed: false,
        review_approved: false,
        review: lastReview,
        message: "La corrección determinista quedó guardada, pero la revisión automática no se completó por un fallo técnico. El incidente se registró por separado y el borrador continúa privado y sin aprobación.",
        publishes: false,
        confirms: false,
        resolves: false,
      });
    }
    if (!changed.length) break;
  }

  const escalation = exactEscalation(lastReview, evidenceChecked);
  return jsonResponse({
    ok: false,
    error: escalation.code,
    escalation,
    archetype,
    rounds: AUTONOMOUS_REPAIR_MAX_ROUNDS,
    changed_fields: [...allChanged],
    provider_warnings: [...providerWarnings],
    draft_id: draftId,
    previous_version: previousVersion,
    new_version: expectedVersion,
    review: lastReview,
    draft_private: true,
    publishes: false,
    confirms: false,
    resolves: false,
  }, 409);
}

function repairFailurePhase(code: string): string {
  if (/SOURCE|PROVIDER|RESEARCH/.test(code)) return "research";
  if (/REVIEW|REVALIDAT|COMPATIBLE/.test(code)) return "revalidation";
  if (/PATCH|VALIDATION|INFERABLE|ARCHETYPE|CATEGORY|METRIC|TEMPORAL/.test(code)) return "patch_validation";
  if (/VERSION|PERSIST|PRIMARY_SOURCE_CHECK|REPAIR_VERSION/.test(code)) return "persistence";
  return "preflight";
}

function repairFailureMessage(code: string, retryable: boolean): string {
  const messages: Record<string, string> = {
    DRAFT_VERSION_MOVED: "El borrador cambió mientras se preparaba la corrección. Recárgalo antes de reintentar.",
    DRAFT_REPAIR_NOT_APPLICABLE: "Atinara clasificó una incidencia como reparable, pero no encontró una estrategia compatible. El defecto interno quedó registrado.",
    SAFE_REPAIR_VALIDATION_FAILED: "El parche propuesto no superó la validación previa y no se guardó.",
    COMPATIBLE_REVIEW_REQUIRED: "La revisión compatible no pudo completarse; se conservó el último estado autoritativo.",
    SOURCE_VALIDATION_BUDGET_EXHAUSTED: "Se agotó el tiempo seguro de comprobación de fuentes. El estado ya guardado se conserva.",
    PROVIDER_RATE_LIMITED: "El proveedor ha limitado temporalmente la operación. Atinara respetará el plazo de reintento.",
  };
  return messages[code] || (retryable
      ? "La fase técnica no pudo completarse. El borrador continúa privado y puede reintentarse con seguridad."
      : "La corrección se detuvo con una causa tipada. El borrador continúa privado y sin confirmación.");
}

async function repairAndRevalidate(
  env: Environment,
  authorization: string,
  body: JsonRecord,
): Promise<Response> {
  const draftId = cleanText(body.draft_id, 100);
  const expectedVersion = Number(body.expected_version);
  const requestKey = cleanText(body.attempt_id, 80) || crypto.randomUUID();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestKey)) {
    return jsonResponse({
      error: "INVALID_REPAIR_REQUEST",
      message: "El identificador de intento no es válido.",
      failure_phase: "preflight",
      retryable: false,
      state_preserved: true,
      draft_private: true,
      publishes: false,
      confirms: false,
      resolves: false,
    }, 400);
  }

  const beginning = await rpc(env, "begin_market_draft_repair_attempt_v1", {
    draft_id_input: draftId,
    expected_version_input: expectedVersion,
    request_key_input: requestKey,
  }, authorization);
  const attemptId = cleanText(beginning.attempt_id, 80);
  if (beginning.idempotency_replay === true) {
    const replayStatus = Number(beginning.http_status) || (beginning.status === "already_in_progress" ? 202 : 200);
    return jsonResponse({ ...beginning, attempt_id: attemptId, state_preserved: beginning.state_preserved !== false }, replayStatus);
  }
  const { agent, registry } = await createCorrectorAgentV2(
    env,
    authorization,
    draftId,
    expectedVersion,
    attemptId || requestKey,
  );

  const complete = async (payloadValue: JsonRecord, httpStatus: number): Promise<Response> => {
    const errorCode = cleanText(payloadValue.error, 120);
    const retryable = payloadValue.retryable === true
      || payloadValue.classification === "technical"
      || isRecord(payloadValue.technical_incident)
      || httpStatus === 429
      || httpStatus >= 500;
    const internalDefect = ["DRAFT_REPAIR_NOT_APPLICABLE", "SAFE_REPAIR_VALIDATION_FAILED", "REPAIR_VERSION_INVALID"].includes(errorCode);
    const succeeded = httpStatus >= 200 && httpStatus < 300
      && payloadValue.ok === true && payloadValue.review_approved === true;
    const status = succeeded
      ? payloadValue.repair_applied === true ? "succeeded" : "no_op"
      : internalDefect ? "internal_defect"
        : retryable ? "technical_failed" : "blocked";
    const classification = internalDefect ? "internal" : retryable ? "technical" : "content";
    const phase = succeeded ? "complete" : repairFailurePhase(errorCode);
    let resultingFingerprint = "";
    if (Number(payloadValue.new_version) >= expectedVersion) {
      const context = await rpc(env, "get_market_draft_expert_repair_context", {
        draft_id_input: draftId,
      }, authorization).catch(() => ({} as JsonRecord));
      resultingFingerprint = cleanText(isRecord(context.draft) ? context.draft.content_fingerprint : null, 80);
    }
    const patchFingerprint = payloadValue.repair_applied === true
      ? await sha256Hex({
        draft_id: draftId,
        previous_version: payloadValue.previous_version ?? expectedVersion,
        new_version: payloadValue.new_version ?? expectedVersion,
        changed_fields: payloadValue.changed_fields ?? [],
        policy: AUTONOMOUS_REPAIR_VERSION,
      })
      : "";
    const agentTelemetry = isRecord(payloadValue.agent_execution)
      ? await persistCorrectorAgentExecution(env, payloadValue.agent_execution)
      : { status: "not_attempted", warnings: [] as string[] };
    const responsePayload = {
      ...payloadValue,
      attempt_id: attemptId,
      failure_phase: phase,
      retryable,
      state_preserved: true,
      http_status: httpStatus,
      message: cleanText(payloadValue.message, 1_000) || repairFailureMessage(errorCode, retryable),
      agent_telemetry_status: agentTelemetry.status,
      warnings: [...new Set([
        ...(Array.isArray(payloadValue.warnings) ? payloadValue.warnings.map((value) => cleanText(value, 120)) : []),
        ...agentTelemetry.warnings,
      ])],
      draft_private: true,
      publishes: false,
      confirms: false,
      resolves: false,
    };
    const recorded = await serviceRpc(env, "complete_market_draft_repair_attempt_v1", {
      attempt_id_input: attemptId,
      status_input: status,
      phase_input: phase,
      classification_input: classification,
      retryable_input: retryable,
      error_code_input: errorCode || null,
      patch_fingerprint_input: patchFingerprint || null,
      resulting_version_input: Number(payloadValue.new_version) || expectedVersion,
      resulting_fingerprint_input: resultingFingerprint || null,
      response_payload_input: responsePayload,
    });
    return jsonResponse(recorded, httpStatus);
  };

  try {
    const response = await executeRepairAndRevalidate(env, authorization, {
      ...body,
      attempt_id: requestKey,
      __agent: agent,
      __registry: registry,
    });
    const payload = await response.clone().json().catch(() => ({})) as JsonRecord;
    const agentStatus = response.ok && payload.ok === true
      ? "completed"
      : payload.classification === "technical" ? "degraded" : "blocked";
    return await complete({
      ...payload,
      agent_execution: agent.complete(agentStatus, cleanText(payload.error, 100) || null),
    }, response.status);
  } catch (error) {
    const code = safeErrorCode(error);
    const retryable = /TIMEOUT|RATE_LIMIT|HTTP_5|NETWORK|BUDGET/.test(code);
    const conflict = /VERSION|CONFLICT|AMBIGUOUS/.test(code);
    const internalDefect = ["DRAFT_REPAIR_NOT_APPLICABLE", "SAFE_REPAIR_VALIDATION_FAILED", "REPAIR_VERSION_INVALID"].includes(code);
    const status = internalDefect ? 500 : conflict ? 409 : retryable ? 503 : 422;
    console.error("draft fixer attempt", JSON.stringify({ attempt_id: attemptId, code, phase: repairFailurePhase(code) }));
    return await complete({
      ok: false,
      error: code,
      classification: internalDefect ? "internal" : retryable ? "technical" : "content",
      retryable,
      message: repairFailureMessage(code, retryable),
      previous_version: expectedVersion,
      new_version: expectedVersion,
      repair_applied: false,
      agent_execution: agent.complete(retryable ? "degraded" : "failed", code),
    }, status);
  }
}

function safeErrorCode(error: unknown): string {
  const code = cleanText(error instanceof Error ? error.message : error, 120);
  return /^[A-Z][A-Z0-9_]{2,119}$/.test(code) ? code : "DRAFT_FIXER_FAILED";
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (request.method !== "POST") return jsonResponse({ error: "METHOD_NOT_ALLOWED", message: "Utiliza POST." }, 405);
  const operation = createAbsoluteExecutionContext({
    durationMs: SOURCE_VALIDATION_BUDGET_MS + MIN_POST_WRITE_BUDGET_MS,
    parentSignal: request.signal,
  });
  const env = environment(operation.context);
  if (!env) {
    operation.cleanup();
    return jsonResponse({ error: "SERVICE_NOT_CONFIGURED", message: "El Corrector Autónomo no puede conectar con Supabase." }, 503);
  }
  const authorization = request.headers.get("authorization") ?? "";
  try {
    const authenticated = await authenticateAdmin(env, authorization);
    if (authenticated instanceof Response) return authenticated;
    const raw = await request.text();
    if (new TextEncoder().encode(raw).length > MAX_REQUEST_BYTES) {
      return jsonResponse({ error: "REQUEST_TOO_LARGE", message: "La solicitud supera el límite permitido." }, 413);
    }
    const body = raw ? JSON.parse(raw) as JsonRecord : {};
    if (!isRecord(body) || cleanText(body.action, 80) !== "repair-and-revalidate") {
      return jsonResponse({ error: "DRAFT_FIXER_ACTION_INVALID", message: "La acción solicitada no existe." }, 400);
    }
    return await repairAndRevalidate(env, authorization, body);
  } catch (error) {
    const code = safeErrorCode(error);
    const upstreamStatus = error instanceof DraftFixerRpcError ? error.status : 0;
    const status = [400, 401, 403, 404, 409, 422, 429, 503, 504].includes(upstreamStatus)
      ? upstreamStatus
      : /INVALID|REQUEST|NOT_APPLICABLE/.test(code) ? 400
      : /VERSION|CONFLICT|AMBIGUOUS/.test(code) ? 409
      : /AUTH/.test(code) ? 401
      : /ADMIN/.test(code) ? 403
      : 503;
    console.error("draft fixer", JSON.stringify({ code }));
    return jsonResponse({
      error: code,
      message: repairFailureMessage(code, status === 429 || status >= 500),
      failure_phase: "preflight",
      retryable: status === 429 || status >= 500,
      state_preserved: true,
      draft_private: true,
      publishes: false,
      confirms: false,
      resolves: false,
    }, status);
  } finally {
    operation.cleanup();
  }
});
