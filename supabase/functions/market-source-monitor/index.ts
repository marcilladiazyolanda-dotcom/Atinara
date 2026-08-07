import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  PROVIDER_ADAPTER_VERSIONS,
  SOURCE_CONTRACT_SCHEMA_VERSION,
  aggregateSnapshots,
  evidenceNeverAutoResolves,
} from "../_shared/market-intelligence/index.mjs";
import {
  authenticateAdminOrService,
  corsHeaders,
  fetchProviderJson,
  getSupabaseEnvironment,
  handleEdgeError,
  jsonResponse,
  readJsonBody,
  rpc,
  type JsonRecord,
} from "../_shared/market-intelligence/edge-runtime.ts";

const IGDB_ROOT = "https://api.igdb.com/v4";
const TWITCH_ROOT = "https://api.twitch.tv/helix";
const YOUTUBE_ROOT = "https://www.googleapis.com/youtube/v3";
let tokenCache: { token: string; expiresAt: number } | null = null;

function text(value: unknown, max = 500): string { return String(value ?? "").trim().slice(0, max); }
function records(value: unknown): JsonRecord[] { return Array.isArray(value) ? value.filter((item) => item && typeof item === "object" && !Array.isArray(item)) as JsonRecord[] : []; }

async function twitchToken(force = false) {
  const clientId = Deno.env.get("TWITCH_CLIENT_ID") ?? "";
  const secret = Deno.env.get("TWITCH_CLIENT_SECRET") ?? "";
  if (!clientId || !secret) throw new Error("TWITCH_NOT_CONFIGURED");
  if (!force && tokenCache && tokenCache.expiresAt > Date.now() + 120000) return tokenCache.token;
  const url = new URL("https://id.twitch.tv/oauth2/token");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("client_secret", secret);
  url.searchParams.set("grant_type", "client_credentials");
  const response = await fetchProviderJson("twitch", url, { method: "POST" }, { timeoutMs: 10000, retries: 0 });
  const payload = response.data as JsonRecord;
  const token = text(payload.access_token, 2048);
  if (!token) throw new Error("TWITCH_TOKEN_INVALID");
  tokenCache = { token, expiresAt: Date.now() + Math.max(Number(payload.expires_in) || 60, 60) * 1000 };
  return token;
}

async function twitchRequest(path: string, params: Record<string, string>) {
  const clientId = Deno.env.get("TWITCH_CLIENT_ID") ?? "";
  const url = new URL(`${TWITCH_ROOT}/${path}`);
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
  const call = async (force = false) => fetchProviderJson("twitch", url, { headers: { "Client-Id": clientId, Authorization: `Bearer ${await twitchToken(force)}` } }, { retries: 0 });
  try { return await call(false); } catch (error) {
    if (error instanceof Error && error.message === "PROVIDER_UNAUTHORIZED") { tokenCache = null; return call(true); }
    throw error;
  }
}

async function captureBinding(bindingPayload: JsonRecord) {
  const binding = bindingPayload.binding as JsonRecord || {};
  const contract = binding.resolution_contract as JsonRecord || {};
  const provider = text(binding.provider, 40);
  const entityId = text(contract.entity_id, 300);
  const entityType = text(contract.entity_type, 80);
  const metric = text(contract.metric, 200);
  const observedAt = new Date().toISOString();
  let value: unknown = null;
  let providerTimestamp: string | null = null;
  let excerpt: JsonRecord = {};
  let rate: JsonRecord = {};
  let errorCode: string | null = null;

  if (provider === "igdb") {
    const headers = { "Client-Id": Deno.env.get("TWITCH_CLIENT_ID") ?? "", Authorization: `Bearer ${await twitchToken()}`, "Content-Type": "text/plain" };
    const response = await fetchProviderJson("igdb", `${IGDB_ROOT}/${entityType === "event" ? "events" : "games"}`, { method: "POST", headers, body: `fields id,name,updated_at,status,first_release_date,release_dates.date,release_dates.human; where id = ${Number(entityId)}; limit 1;` });
    const item = records(response.data)[0];
    if (!item) errorCode = "SOURCE_ENTITY_MISSING";
    else {
      value = metric === "first_release_date" ? item.first_release_date ?? null : item[metric] ?? null;
      providerTimestamp = item.updated_at ? new Date(Number(item.updated_at) * 1000).toISOString() : null;
      excerpt = { id: item.id, metric, value };
      rate = response.rate as JsonRecord;
    }
  } else if (provider === "twitch") {
    const response = await twitchRequest(entityType === "game" ? "games" : "streams", entityType === "game" ? { id: entityId } : { user_id: entityId, first: "1" });
    const item = records((response.data as JsonRecord).data)[0];
    if (!item) errorCode = metric === "viewer_count" ? "STREAM_OFFLINE_METRIC_MISSING" : "SOURCE_ENTITY_MISSING";
    else {
      value = item[metric] ?? null;
      providerTimestamp = text(item.started_at, 80) || null;
      excerpt = { id: item.id, metric, value };
      rate = response.rate as JsonRecord;
    }
  } else if (provider === "youtube") {
    const apiKey = Deno.env.get("YOUTUBE_API_KEY") ?? "";
    if (!apiKey) throw new Error("YOUTUBE_NOT_CONFIGURED");
    const endpoint = entityType === "video" ? "videos" : "channels";
    const url = new URL(`${YOUTUBE_ROOT}/${endpoint}`);
    url.searchParams.set("part", entityType === "video" ? "statistics,liveStreamingDetails,status" : "statistics,status");
    url.searchParams.set("id", entityId);
    url.searchParams.set("key", apiKey);
    const response = await fetchProviderJson("youtube", url);
    const item = records((response.data as JsonRecord).items)[0];
    if (!item) errorCode = "SOURCE_ENTITY_MISSING";
    else if (metric === "subscriberCount" && (item.statistics as JsonRecord)?.hiddenSubscriberCount === true) errorCode = "SOURCE_METRIC_HIDDEN";
    else if (metric === "concurrentViewers" && !(item.liveStreamingDetails as JsonRecord)?.concurrentViewers) errorCode = (item.liveStreamingDetails as JsonRecord)?.actualEndTime ? "CONCURRENT_VIEWERS_ABSENT_AFTER_END" : "SOURCE_DATA_MISSING";
    else {
      const source = metric === "concurrentViewers" ? item.liveStreamingDetails as JsonRecord : item.statistics as JsonRecord;
      value = source?.[metric] ?? null;
      excerpt = { id: item.id, metric, value, metric_is_rounded: metric === "subscriberCount" };
      rate = { estimated_units: 1 };
    }
  } else {
    throw new Error("SOURCE_PROVIDER_UNSUPPORTED");
  }

  if (value === null || value === undefined) errorCode ||= "SOURCE_DATA_MISSING";
  const retentionExpiresAt = provider === "youtube" ? new Date(Date.now() + 30 * 86400000).toISOString() : null;
  return {
    snapshot: {
      provider, metric: metric || null, value: value ?? null, unit: contract.unit || null,
      observed_at: observedAt, provider_timestamp: providerTimestamp,
      quality: errorCode ? "missing" : "complete", response_excerpt: excerpt,
      retention_expires_at: retentionExpiresAt, error_code: errorCode,
    },
    monitor: {
      status: errorCode ? "partial" : "completed", error_code: errorCode,
      next_capture_at: nextCapture(contract), rate_limit_state: rate,
      adapter_version: PROVIDER_ADAPTER_VERSIONS[provider] || "unknown",
    },
  };
}

function nextCapture(contract: JsonRecord) {
  if (contract.capture_strategy !== "poll_during_window") return null;
  const seconds = Math.max(Number(contract.sampling_interval_seconds) || 300, 60);
  const next = new Date(Date.now() + seconds * 1000);
  const end = contract.window_end ? new Date(String(contract.window_end)) : null;
  return end && Number.isFinite(end.getTime()) && next > end ? null : next.toISOString();
}

async function captureNow(environment: NonNullable<ReturnType<typeof getSupabaseEnvironment>>, bindingId: string) {
  const bindingPayload = await rpc(environment, "get_market_source_binding_for_capture", { binding_id_input: bindingId }, { service: true }) as JsonRecord;
  if (!bindingPayload.binding) throw new Error("SOURCE_BINDING_NOT_FOUND");
  let capture;
  try {
    capture = await captureBinding(bindingPayload);
  } catch (error) {
    const code = error instanceof Error ? error.message : "SOURCE_CAPTURE_FAILED";
    capture = { snapshot: { provider: (bindingPayload.binding as JsonRecord).provider, metric: null, value: null, observed_at: new Date().toISOString(), quality: "missing", response_excerpt: {}, error_code: code }, monitor: { status: code.includes("RATE") ? "rate_limited" : "failed", error_code: code, next_capture_at: null, rate_limit_state: {}, adapter_version: "unknown" } };
  }
  const snapshot = await rpc(environment, "record_market_source_snapshot", { binding_id_input: bindingId, snapshot_input: capture.snapshot }, { service: true });
  const run = await rpc(environment, "record_market_source_monitor_result", { binding_id_input: bindingId, result_input: capture.monitor }, { service: true });
  return { snapshot, run, applies_resolution: false };
}

function providerConfigured(provider: string): boolean {
  if (provider === "igdb" || provider === "twitch") {
    return Boolean(Deno.env.get("TWITCH_CLIENT_ID") && Deno.env.get("TWITCH_CLIENT_SECRET"));
  }
  if (provider === "youtube") return Boolean(Deno.env.get("YOUTUBE_API_KEY"));
  return false;
}

async function verifyBinding(environment: NonNullable<ReturnType<typeof getSupabaseEnvironment>>, authorization: string, bindingId: string) {
  const payload = await rpc(environment, "get_market_source_binding_for_capture", { binding_id_input: bindingId }, { service: true }) as JsonRecord;
  const provider = text((payload.binding as JsonRecord)?.provider, 40);
  await rpc(environment, "set_market_intelligence_provider_status", { provider_input: provider, configured_input: providerConfigured(provider) }, { service: true });
  return rpc(environment, "verify_market_source_binding", { binding_id_input: bindingId }, { authorization });
}

function compare(value: unknown, operator: string, threshold: unknown): boolean | null {
  const left = Number(value); const right = Number(threshold);
  if (!Number.isFinite(left) || !Number.isFinite(right)) return null;
  if (operator === ">=") return left >= right;
  if (operator === ">") return left > right;
  if (operator === "<=") return left <= right;
  if (operator === "<") return left < right;
  if (operator === "=") return left === right;
  return null;
}

async function buildEvidence(environment: NonNullable<ReturnType<typeof getSupabaseEnvironment>>, authorization: string, marketId: string) {
  const evidence = await rpc(environment, "get_market_source_evidence", { market_id_input: marketId }, { authorization }) as JsonRecord;
  if (evidence.available !== true) return evidence;
  const binding = evidence.binding as JsonRecord || {};
  const contract = binding.resolution_contract as JsonRecord || {};
  const snapshots = records(evidence.snapshots).map((snapshot) => ({ ...snapshot, value: (snapshot.value as JsonRecord)?.value ?? snapshot.value }));
  const aggregate = evidenceNeverAutoResolves(aggregateSnapshots(snapshots, text(contract.aggregation, 40) || "final"));
  const outcome = aggregate.value === null ? null : compare(aggregate.value, text(contract.operator, 10), contract.threshold);
  const packagePayload = {
    status: aggregate.quality === "insufficient" ? "insufficient" : "ready_to_resolve",
    recommended_outcome: outcome === null ? null : outcome ? "Sí" : "No",
    confidence: aggregate.quality === "complete" ? 90 : aggregate.quality === "partial" ? 60 : 0,
    evidence: { aggregate, snapshot_ids: records(evidence.snapshots).map((snapshot) => snapshot.id), aggregation: contract.aggregation, applies_resolution: false },
    conflicts: binding.status === "source_conflict" ? ["SOURCE_CONFLICT"] : [],
    warnings: aggregate.reason_code ? [aggregate.reason_code] : [],
  };
  const packageResult = await rpc(environment, "build_market_resolution_evidence_package", { binding_id_input: text(binding.id, 100), summary_input: packagePayload }, { service: true });
  return { ...evidence, aggregate, evidence_package: packageResult, applies_resolution: false, human_confirmation_required: true };
}

async function handleAction(environment: NonNullable<ReturnType<typeof getSupabaseEnvironment>>, authorization: string, body: JsonRecord) {
  const action = text(body.action, 80);
  if (action === "provider-status") return jsonResponse({ ok: true, contract_schema_version: SOURCE_CONTRACT_SCHEMA_VERSION, scheduler_enabled: false, providers: [
    { provider: "igdb", configured: Boolean(Deno.env.get("TWITCH_CLIENT_ID") && Deno.env.get("TWITCH_CLIENT_SECRET")) },
    { provider: "twitch", configured: Boolean(Deno.env.get("TWITCH_CLIENT_ID") && Deno.env.get("TWITCH_CLIENT_SECRET")) },
    { provider: "youtube", configured: Boolean(Deno.env.get("YOUTUBE_API_KEY")) },
  ] });
  if (action === "verify-binding") return jsonResponse({ ok: true, binding: await verifyBinding(environment, authorization, text(body.binding_id, 100)) });
  if (action === "arm-binding") return jsonResponse({ ok: true, binding: await rpc(environment, "arm_market_source_binding", { binding_id_input: text(body.binding_id, 100) }, { authorization }) });
  if (action === "pause-binding") return jsonResponse({ ok: true, binding: await rpc(environment, "pause_market_source_binding", { binding_id_input: text(body.binding_id, 100) }, { authorization }) });
  if (action === "capture-now" || action === "refresh-static-source" || action === "retry-failed-capture") return jsonResponse({ ok: true, ...(await captureNow(environment, text(body.binding_id, 100))) });
  if (action === "capture-due") {
    const due = await rpc(environment, "get_due_market_source_bindings", { limit_count: Math.min(Math.max(Number(body.limit) || 20, 1), 50) }, { service: true }) as JsonRecord;
    if (due.enabled !== true) return jsonResponse({ ok: true, enabled: false, captured: [], message: "La programación de capturas permanece desactivada." });
    const captured = [];
    for (const item of records(due.bindings)) captured.push(await captureNow(environment, text((item.binding as JsonRecord)?.id, 100)));
    return jsonResponse({ ok: true, enabled: true, captured, applies_resolution: false });
  }
  if (action === "get-evidence") return jsonResponse({ ok: true, evidence: await rpc(environment, "get_market_source_evidence", { market_id_input: text(body.market_id, 200) }, { authorization }) });
  if (action === "get-evidence-package") return jsonResponse({ ok: true, evidence: await buildEvidence(environment, authorization, text(body.market_id, 200)), applies_resolution: false });
  if (action === "purge-expired-provider-data") return jsonResponse({ ok: true, purged: await rpc(environment, "purge_expired_observatory_provider_data", { limit_count: Math.min(Math.max(Number(body.limit) || 500, 1), 2000) }, { service: true }) });
  throw new Error("SOURCE_MONITOR_ACTION_INVALID");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "METHOD_NOT_ALLOWED", message: "Utiliza POST." }, 405);
  const environment = getSupabaseEnvironment();
  if (!environment) return jsonResponse({ error: "SERVICE_NOT_CONFIGURED", message: "El Centinela no puede conectar con Supabase." }, 503);
  const authorization = req.headers.get("authorization") ?? "";
  try {
    const body = await readJsonBody(req);
    const auth = await authenticateAdminOrService(environment, authorization, ["capture-due", "purge-expired-provider-data"].includes(String(body.action || "")));
    if (auth instanceof Response) return auth;
    return await handleAction(environment, authorization, body);
  } catch (error) {
    console.error("Source monitor request failed", JSON.stringify({ code: error instanceof Error ? error.message.slice(0, 100) : "UNKNOWN" }));
    return handleEdgeError(error, "La captura no se ha podido completar. No se ha aplicado ningún resultado.");
  }
});
