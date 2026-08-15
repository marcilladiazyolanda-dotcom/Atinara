import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  INTELLIGENCE_LIMITS,
  MARKET_INTELLIGENCE_POLICY_VERSION,
  PROVIDER_ADAPTER_VERSIONS,
  SOURCE_CONTRACT_SCHEMA_VERSION,
  normalizeIgdbGame,
  normalizeTwitchGame,
  normalizeTwitchStream,
  normalizeYouTubeChannel,
  normalizeYouTubeVideo,
  publicErrorCode,
  youtubeProposalPolicy,
} from "../_shared/market-intelligence/index.mjs";
import {
  ATINARA_OFFICIAL_OPPORTUNITY_DISCOVERY_VERSION,
  buildOfficialOpportunitySignals,
  normalizeOfficialOpportunityRequest,
  officialOpportunityErrorCode,
  officialOpportunityOutcome,
  officialOpportunityRequestFingerprint,
  officialOpportunityRunInput,
  readBoundedUtf8Response,
} from "../_shared/market-intelligence/official-opportunity-discovery.mjs";
import {
  normalizePrimarySourceRegistry,
  primarySourceRegistryEntry,
  safePublicUrl,
} from "../_shared/market-draft-repair.mjs";
import { sha256Hex } from "../_shared/ai/contracts.mjs";
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

const MAX_RESULTS = 100;
const IGDB_ROOT = "https://api.igdb.com/v4";
const TWITCH_ROOT = "https://api.twitch.tv/helix";
const YOUTUBE_ROOT = "https://www.googleapis.com/youtube/v3";
const TAVILY_SEARCH_URL = "https://api.tavily.com/search";
const OFFICIAL_PAGE_MAX_BYTES = 600_000;
const OFFICIAL_PAGE_TIMEOUT_MS = 10_000;

let twitchTokenCache: { token: string; expiresAt: number } | null = null;

function text(value: unknown, max = 500): string { return String(value ?? "").trim().slice(0, max); }
function records(value: unknown): JsonRecord[] { return Array.isArray(value) ? value.filter((item) => item && typeof item === "object" && !Array.isArray(item)) as JsonRecord[] : []; }

async function fingerprint(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function credentials() {
  return {
    twitchClientId: Deno.env.get("TWITCH_CLIENT_ID") ?? "",
    twitchClientSecret: Deno.env.get("TWITCH_CLIENT_SECRET") ?? "",
    youtubeKey: Deno.env.get("YOUTUBE_API_KEY") ?? "",
    tavilyConfigured: Boolean(Deno.env.get("TAVILY_API_KEY")),
  };
}

async function twitchToken(force = false): Promise<string> {
  const config = credentials();
  if (!config.twitchClientId || !config.twitchClientSecret) throw new Error("TWITCH_NOT_CONFIGURED");
  if (!force && twitchTokenCache && twitchTokenCache.expiresAt > Date.now() + 120000) return twitchTokenCache.token;
  const url = new URL("https://id.twitch.tv/oauth2/token");
  url.searchParams.set("client_id", config.twitchClientId);
  url.searchParams.set("client_secret", config.twitchClientSecret);
  url.searchParams.set("grant_type", "client_credentials");
  const response = await fetchProviderJson("twitch", url, { method: "POST" }, { timeoutMs: 10000, retries: 0 });
  const payload = response.data as JsonRecord;
  const token = text(payload.access_token, 2048);
  const expiresIn = Number(payload.expires_in);
  if (!token || !Number.isFinite(expiresIn)) throw new Error("TWITCH_TOKEN_INVALID");
  twitchTokenCache = { token, expiresAt: Date.now() + Math.max(expiresIn, 60) * 1000 };
  return token;
}

async function twitchHeaders(force = false): Promise<Record<string, string>> {
  return { "Client-Id": credentials().twitchClientId, Authorization: `Bearer ${await twitchToken(force)}` };
}

async function twitchGet(path: string, params: Record<string, string | string[]> = {}) {
  const url = new URL(`${TWITCH_ROOT}/${path}`);
  for (const [name, raw] of Object.entries(params)) for (const value of Array.isArray(raw) ? raw : [raw]) url.searchParams.append(name, value);
  try {
    return await fetchProviderJson("twitch", url, { headers: await twitchHeaders() }, { timeoutMs: 12000 });
  } catch (error) {
    if (error instanceof Error && error.message === "PROVIDER_UNAUTHORIZED") {
      twitchTokenCache = null;
      return fetchProviderJson("twitch", url, { headers: await twitchHeaders(true) }, { timeoutMs: 12000, retries: 0 });
    }
    throw error;
  }
}

async function igdbPost(endpoint: string, query: string) {
  const headers = await twitchHeaders();
  return fetchProviderJson("igdb", `${IGDB_ROOT}/${endpoint}`, { method: "POST", headers: { ...headers, Accept: "application/json", "Content-Type": "text/plain" }, body: query }, { timeoutMs: 14000 });
}

async function youtubeGet(endpoint: string, params: Record<string, string>) {
  const key = credentials().youtubeKey;
  if (!key) throw new Error("YOUTUBE_NOT_CONFIGURED");
  const url = new URL(`${YOUTUBE_ROOT}/${endpoint}`);
  Object.entries({ ...params, key }).forEach(([name, value]) => url.searchParams.set(name, value));
  return fetchProviderJson("youtube", url, {}, { timeoutMs: 12000 });
}

function providerStatusPayload() {
  const config = credentials();
  return [
    { provider: "igdb", configured: Boolean(config.twitchClientId && config.twitchClientSecret), status: config.twitchClientId && config.twitchClientSecret ? "configured" : "not_configured", adapter_version: PROVIDER_ADAPTER_VERSIONS.igdb, credential_source: "Twitch app credentials" },
    { provider: "twitch", configured: Boolean(config.twitchClientId && config.twitchClientSecret), status: config.twitchClientId && config.twitchClientSecret ? "configured" : "not_configured", adapter_version: PROVIDER_ADAPTER_VERSIONS.twitch, credential_source: "Twitch app credentials" },
    { provider: "youtube", configured: Boolean(config.youtubeKey), status: config.youtubeKey ? "configured" : "not_configured", adapter_version: PROVIDER_ADAPTER_VERSIONS.youtube, retention_mode: "conservative_30_days" },
    { provider: "market-expert", configured: true, status: "managed_by_ai_gateway", provider_availability: "server_side_not_disclosed", policy_version: MARKET_INTELLIGENCE_POLICY_VERSION },
    { provider: "source-monitor", configured: true, status: "scheduler_disabled", contract_schema_version: SOURCE_CONTRACT_SCHEMA_VERSION },
    { provider: "tavily-context", configured: config.tavilyConfigured, status: config.tavilyConfigured ? "configured_limited" : "not_configured" },
    { provider: "official_web", configured: config.tavilyConfigured, status: config.tavilyConfigured ? "configured_limited" : "not_configured", adapter_version: ATINARA_OFFICIAL_OPPORTUNITY_DISCOVERY_VERSION, source_scope: "registered_primary_only" },
  ];
}

function normalizedCategory(value: unknown): string {
  return text(value, 100).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function registryForCategory(registry: JsonRecord[], category: string): JsonRecord[] {
  const requested = normalizedCategory(category);
  return normalizePrimarySourceRegistry(registry).filter((entry) => (
    entry.categories.length === 0 || entry.categories.includes(requested)
  ));
}

async function searchRegisteredOfficialPages(request: ReturnType<typeof normalizeOfficialOpportunityRequest>, registry: JsonRecord[]) {
  const apiKey = Deno.env.get("TAVILY_API_KEY") ?? "";
  if (!apiKey) throw new Error("TAVILY_NOT_CONFIGURED");
  const allowedRegistry = registryForCategory(registry, request.category);
  const includeDomains = [...new Set(allowedRegistry.map((entry) => entry.canonical_domain))].slice(0, 20);
  if (!includeDomains.length) throw new Error("OFFICIAL_DISCOVERY_REGISTRY_EMPTY");
  const horizonAt = new Date(Date.now() + request.horizonDays * 86_400_000).toISOString().slice(0, 10);
  const query = `${request.query} fecha calendario lanzamiento evento oficial antes de ${horizonAt}`.slice(0, 500);
  const response = await fetchProviderJson("tavily", TAVILY_SEARCH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: apiKey,
      query,
      include_domains: includeDomains,
      max_results: Math.min(request.maxResults * 2, 8),
      search_depth: "advanced",
      include_answer: false,
      include_raw_content: false,
      include_images: false,
    }),
  }, { timeoutMs: 15_000, retries: 0, maxBytes: 500_000 });
  const urls = [] as string[];
  for (const result of records((response.data as JsonRecord).results)) {
    const url = safePublicUrl(result.url);
    if (!url || !primarySourceRegistryEntry(url, allowedRegistry, request.category) || urls.includes(url)) continue;
    urls.push(url);
    if (urls.length >= 8) break;
  }
  return { urls, rate: response.rate, queryFingerprint: await sha256Hex(query) };
}

async function fetchRegisteredOfficialPage(urlInput: string, registry: JsonRecord[], category: string) {
  let current = safePublicUrl(urlInput);
  for (let redirects = 0; redirects <= 3; redirects += 1) {
    if (!current || !primarySourceRegistryEntry(current, registry, category)) {
      throw new Error("OFFICIAL_SOURCE_NOT_REGISTERED");
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), OFFICIAL_PAGE_TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch(current, {
        method: "GET",
        headers: { Accept: "text/html,application/xhtml+xml;q=0.9" },
        redirect: "manual",
        credentials: "omit",
        referrerPolicy: "no-referrer",
        signal: controller.signal,
      });
    } catch (error) {
      clearTimeout(timeout);
      if (error instanceof DOMException && error.name === "AbortError") throw new Error("OFFICIAL_SOURCE_TIMEOUT");
      throw new Error("OFFICIAL_SOURCE_NETWORK_ERROR");
    }
    try {
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get("location");
        if (!location || redirects === 3) throw new Error("OFFICIAL_SOURCE_REDIRECT_INVALID");
        await response.body?.cancel().catch(() => undefined);
        current = safePublicUrl(new URL(location, current).toString());
        continue;
      }
      if (!response.ok) throw new Error(`OFFICIAL_SOURCE_HTTP_${response.status}`);
      const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
      if (!contentType.includes("text/html") && !contentType.includes("application/xhtml+xml")) {
        throw new Error("OFFICIAL_SOURCE_CONTENT_TYPE_INVALID");
      }
      const html = await readBoundedUtf8Response(response, OFFICIAL_PAGE_MAX_BYTES);
      return { url: current, html, contentSha256: await sha256Hex(html) };
    } catch (error) {
      await response.body?.cancel().catch(() => undefined);
      if (error instanceof DOMException && error.name === "AbortError") throw new Error("OFFICIAL_SOURCE_TIMEOUT");
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
  throw new Error("OFFICIAL_SOURCE_REDIRECT_INVALID");
}

async function loadExistingDefinitions(environment: NonNullable<ReturnType<typeof getSupabaseEnvironment>>, authorization: string) {
  const definitions = await rpc(environment, "get_admin_market_family_definitions", {}, { authorization }).catch(() => null);
  if (!Array.isArray(definitions)) throw new Error("OFFICIAL_DISCOVERY_DUPLICATE_CHECK_UNAVAILABLE");
  return records(definitions);
}

function countOfficialError(target: JsonRecord, error: unknown): void {
  if (totalOfficialErrors(target) >= 8) return;
  const code = officialOpportunityErrorCode(error);
  target[code] = (Number(target[code]) || 0) + 1;
}

function totalOfficialErrors(target: JsonRecord): number {
  return Object.values(target).reduce<number>((sum, value) => sum + (Number(value) || 0), 0);
}

async function officialDiscoveryResponse(
  environment: NonNullable<ReturnType<typeof getSupabaseEnvironment>>,
  authorization: string,
  requestId: string,
  record: JsonRecord,
  replayed: boolean,
) {
  const summary = record.result_summary && typeof record.result_summary === "object"
    ? record.result_summary as JsonRecord : {};
  const outcome = text(summary.outcome || record.outcome, 40) || "technical_failure";
  const dashboard = await rpc(
    environment,
    "get_data_observatory_dashboard",
    { filters_input: { limit: 100 } },
    { authorization },
  ).catch(() => null);
  return jsonResponse({
    ok: outcome !== "technical_failure",
    version: ATINARA_OFFICIAL_OPPORTUNITY_DISCOVERY_VERSION,
    request_id: requestId,
    provider_run_id: record.provider_run_id || null,
    replayed,
    outcome,
    saved: Number(summary.saved) || 0,
    inspected_documents: Number(summary.inspected_documents) || 0,
    structured_candidates: Number(summary.structured_candidates) || 0,
    rejected_candidates: Number(summary.rejected_candidates) || 0,
    search_results: Number(summary.search_results) || 0,
    source_error_count: Number(summary.source_error_count) || 0,
    source_error_codes: summary.source_error_codes || {},
    duplicate_signals: Number(summary.duplicate_signals) || 0,
    error_code: text(summary.error_code, 100) || null,
    partial: outcome === "partial",
    dashboard,
    creates_draft: false,
    invokes_model: false,
    publishes: false,
  });
}

async function discoverOfficialOpportunities(
  environment: NonNullable<ReturnType<typeof getSupabaseEnvironment>>,
  authorization: string,
  adminId: string,
  body: JsonRecord,
) {
  const request = normalizeOfficialOpportunityRequest(body);
  const requestFingerprint = await officialOpportunityRequestFingerprint(request);
  const claim = await rpc(environment, "begin_official_opportunity_discovery_v2", {
    request_id_input: request.requestId,
    request_fingerprint_input: requestFingerprint,
    requested_by_input: adminId,
  }, { service: true, safeErrorPrefix: "OFFICIAL_DISCOVERY_" }) as JsonRecord;
  if (claim.state === "in_progress") {
    return jsonResponse({
      ok: true,
      version: ATINARA_OFFICIAL_OPPORTUNITY_DISCOVERY_VERSION,
      request_id: request.requestId,
      provider_run_id: claim.provider_run_id || null,
      outcome: "in_progress",
      replayed: true,
      retryable: true,
      creates_draft: false,
      invokes_model: false,
      publishes: false,
    }, 202);
  }
  if (claim.state === "terminal") {
    return officialDiscoveryResponse(environment, authorization, request.requestId, claim, true);
  }
  if (claim.state !== "started") throw new Error("OFFICIAL_DISCOVERY_REQUEST_STATE_INVALID");

  let search: Awaited<ReturnType<typeof searchRegisteredOfficialPages>> | null = null;
  let inspectedDocuments = 0;
  let structuredCandidates = 0;
  let rejectedCandidates = 0;
  const sourceErrorCodes: JsonRecord = {};
  try {
    const registryValue = await rpc(environment, "list_market_authoritative_source_registry_admin_v1", {}, { authorization });
    const registry = records(registryValue);
    const allowedRegistry = registryForCategory(registry, request.category);
    if (!allowedRegistry.length) throw new Error("OFFICIAL_DISCOVERY_REGISTRY_EMPTY");
    search = await searchRegisteredOfficialPages(request, allowedRegistry);
    const documents = [] as JsonRecord[];
    for (const url of search.urls) {
      try {
        documents.push(await fetchRegisteredOfficialPage(url, allowedRegistry, request.category));
      } catch (error) {
        countOfficialError(sourceErrorCodes, error);
      }
    }
    const existingDefinitions = await loadExistingDefinitions(environment, authorization);
    const discovery = await buildOfficialOpportunitySignals({
      documents,
      registry: allowedRegistry,
      request,
      existingDefinitions,
      now: new Date(),
    });
    inspectedDocuments = discovery.inspectedDocuments;
    structuredCandidates = discovery.structuredCandidates;
    rejectedCandidates = discovery.rejections.length;
    const sourceErrorCount = totalOfficialErrors(sourceErrorCodes);
    const requestedOutcome = officialOpportunityOutcome({
      saved: discovery.signals.length,
      sourceErrorCount,
    });
    const completed = await rpc(environment, "finish_official_opportunity_discovery_v2", {
      request_id_input: request.requestId,
      request_fingerprint_input: requestFingerprint,
      requested_by_input: adminId,
      signals_input: discovery.signals,
      run_input: officialOpportunityRunInput({
        outcome: requestedOutcome,
        errorCode: null,
        queryFingerprint: search.queryFingerprint,
        searchResults: search.urls.length,
        inspectedDocuments,
        structuredCandidates,
        rejectedCandidates,
        sourceErrorCount,
        sourceErrorCodes,
        providerRate: search.rate,
      }),
    }, { service: true, safeErrorPrefix: "OFFICIAL_DISCOVERY_" }) as JsonRecord;
    return officialDiscoveryResponse(environment, authorization, request.requestId, completed, completed.replayed === true);
  } catch (error) {
    const errorCode = officialOpportunityErrorCode(error);
    countOfficialError(sourceErrorCodes, error);
    const sourceErrorCount = totalOfficialErrors(sourceErrorCodes);
    const completed = await rpc(environment, "finish_official_opportunity_discovery_v2", {
      request_id_input: request.requestId,
      request_fingerprint_input: requestFingerprint,
      requested_by_input: adminId,
      signals_input: [],
      run_input: officialOpportunityRunInput({
        outcome: "technical_failure",
        errorCode,
        queryFingerprint: search?.queryFingerprint || null,
        searchResults: search?.urls.length || 0,
        inspectedDocuments,
        structuredCandidates,
        rejectedCandidates,
        sourceErrorCount,
        sourceErrorCodes,
        providerRate: search?.rate,
      }),
    }, { service: true, safeErrorPrefix: "OFFICIAL_DISCOVERY_" }) as JsonRecord;
    return officialDiscoveryResponse(environment, authorization, request.requestId, completed, completed.replayed === true);
  }
}

async function searchProvider(provider: string, query: string) {
  if (query.length < 2) throw new Error("SEARCH_QUERY_REQUIRED");
  if (provider === "igdb") {
    const response = await igdbPost("games", `search "${query.replace(/[";\\]/g, " ")}"; fields id,name,slug,url,summary,updated_at,websites.url,websites.category,websites.trusted,release_dates.date,release_dates.human; limit 20;`);
    return { items: records(response.data).map((item) => ({ provider, entity_type: "game", external_id: text(item.id, 100), label: text(item.name, 300), canonical_url: text(item.url, 2048), raw: item })), quota: response.rate };
  }
  if (provider === "twitch") {
    const response = await twitchGet("search/channels", { query, first: "20", live_only: "false" });
    return { items: records((response.data as JsonRecord).data).map((item) => ({ provider, entity_type: "user", external_id: text(item.id, 100), label: text(item.display_name, 300), canonical_url: item.broadcaster_login ? `https://www.twitch.tv/${encodeURIComponent(text(item.broadcaster_login, 100))}` : "", raw: item })), quota: response.rate };
  }
  if (provider === "youtube") {
    const response = await youtubeGet("search", { part: "snippet", type: "channel", q: query, maxResults: "20", safeSearch: "strict" });
    return { items: records((response.data as JsonRecord).items).map((item) => ({ provider, entity_type: "channel", external_id: text((item.id as JsonRecord)?.channelId, 100), label: text((item.snippet as JsonRecord)?.title, 300), canonical_url: `https://www.youtube.com/channel/${encodeURIComponent(text((item.id as JsonRecord)?.channelId, 100))}`, raw: { id: item.id, snippet: item.snippet } })), quota: { estimated_units: 100, manual_search_only: true } };
  }
  throw new Error("OBSERVATORY_PROVIDER_INVALID");
}

async function twitchTopGames() {
  const response = await twitchGet("games/top", { first: "20" });
  return {
    items: records((response.data as JsonRecord).data).map((item, index) => ({
      provider: "twitch",
      entity_type: "game",
      external_id: text(item.id, 100),
      label: text(item.name, 300),
      canonical_url: item.name ? `https://www.twitch.tv/search?term=${encodeURIComponent(text(item.name, 200))}` : "https://www.twitch.tv/directory",
      observed_rank: index + 1,
      raw: { id: item.id, name: item.name },
    })),
    quota: response.rate,
  };
}

async function discoverIgdb(entities: JsonRecord[]) {
  if (!entities.length) return { signals: [], quota: {} };
  const ids = entities.slice(0, MAX_RESULTS).map((item) => Number(item.external_id)).filter(Number.isFinite);
  const response = await igdbPost("games", `fields id,name,slug,url,summary,first_release_date,updated_at,status,websites.url,websites.category,websites.trusted,release_dates.date,release_dates.human,release_dates.platform; where id = (${ids.join(",")}); limit ${Math.min(ids.length, MAX_RESULTS)};`);
  return { signals: records(response.data).map((game) => normalizeIgdbGame(game)), quota: response.rate };
}

async function discoverTwitch(entities: JsonRecord[]) {
  if (!entities.length) return { signals: [], quota: {} };
  const users = entities.filter((item) => item.entity_type !== "game").slice(0, 100);
  const games = entities.filter((item) => item.entity_type === "game").slice(0, 100);
  const signals: JsonRecord[] = [];
  const quota: JsonRecord = {};
  if (users.length) {
    const response = await twitchGet("streams", { user_id: users.map((item) => text(item.external_id, 100)), first: "100" });
    signals.push(...records((response.data as JsonRecord).data).map((stream) => normalizeTwitchStream(stream)));
    Object.assign(quota, response.rate);
  }
  if (games.length) {
    const response = await twitchGet("games/top", { first: "100" });
    const followed = new Set(games.map((item) => text(item.external_id, 100)));
    records((response.data as JsonRecord).data).forEach((game, index) => {
      if (followed.has(text(game.id, 100))) signals.push(normalizeTwitchGame(game, index + 1));
    });
    Object.assign(quota, response.rate);
  }
  return { signals, quota };
}

async function discoverYouTube(entities: JsonRecord[]) {
  if (!entities.length) return { signals: [], quota: {} };
  const ids = entities.slice(0, 50).map((item) => text(item.external_id, 100)).join(",");
  const channelResponse = await youtubeGet("channels", { part: "snippet,contentDetails,statistics,status", id: ids, maxResults: "50" });
  const channels = records((channelResponse.data as JsonRecord).items);
  const videoIds: string[] = [];
  let estimatedUnits = 1;
  for (const channel of channels) {
    const uploads = text((((channel.contentDetails as JsonRecord)?.relatedPlaylists as JsonRecord)?.uploads), 200);
    if (!uploads) continue;
    const playlist = await youtubeGet("playlistItems", { part: "snippet,contentDetails,status", playlistId: uploads, maxResults: "10" });
    estimatedUnits += 1;
    for (const item of records((playlist.data as JsonRecord).items)) {
      const videoId = text((item.contentDetails as JsonRecord)?.videoId || ((item.snippet as JsonRecord)?.resourceId as JsonRecord)?.videoId, 100);
      if (videoId && !videoIds.includes(videoId)) videoIds.push(videoId);
    }
  }
  const videos: JsonRecord[] = [];
  for (let offset = 0; offset < videoIds.length; offset += 50) {
    const response = await youtubeGet("videos", { part: "snippet,contentDetails,statistics,status,liveStreamingDetails", id: videoIds.slice(offset, offset + 50).join(","), maxResults: "50" });
    videos.push(...records((response.data as JsonRecord).items));
    estimatedUnits += 1;
  }
  return {
    signals: [...channels.map((channel) => normalizeYouTubeChannel(channel)), ...videos.map((video) => normalizeYouTubeVideo(video))],
    quota: { estimated_units: estimatedUnits, manual_search_units: 0 },
  };
}

async function finishSignals(provider: string, signals: JsonRecord[]) {
  const output: JsonRecord[] = [];
  for (const signal of signals) {
    const sourceFingerprint = await fingerprint({ provider, entity_id: signal.entity_id, signal_type: signal.signal_type, observed_at: signal.observed_at, metric_value: signal.metric_value, event_start_at: signal.event_start_at });
    const policyIssues = provider === "youtube" ? youtubeProposalPolicy(signal) : [];
    output.push({
      ...signal,
      source_fingerprint: sourceFingerprint,
      source_payload_excerpt: { adapter_version: signal.adapter_version, observed_fields: ["entity_id", "signal_type", "metric_name", "metric_value", "event_start_at"] },
      marketability_status: policyIssues.length ? "policy_blocked" : signal.marketability_status || (signal.metric_name && signal.metric_value === null ? "insufficient_history" : "pending"),
      marketability_reason_codes: policyIssues,
      resolution_readiness: signal.metric_name ? "needs_monitoring" : "manual_secondary_source",
    });
  }
  return output;
}

async function runDiscovery(environment: NonNullable<ReturnType<typeof getSupabaseEnvironment>>, authorization: string, body: JsonRecord) {
  const dashboard = await rpc(environment, "get_data_observatory_dashboard", { filters_input: { limit: 1 } }, { authorization }) as JsonRecord;
  const providers = body.provider && body.provider !== "all" ? [text(body.provider, 30)] : ["igdb", "twitch", "youtube"];
  const allEntities = records(dashboard.entities);
  const errors: JsonRecord[] = [];
  let saved = 0;
  for (const provider of providers) {
    const entities = allEntities.filter((entity) => entity.provider === provider).slice(0, INTELLIGENCE_LIMITS.maxResultsPerRefresh);
    if (!entities.length) continue;
    try {
      const discovered = provider === "igdb" ? await discoverIgdb(entities) : provider === "twitch" ? await discoverTwitch(entities) : await discoverYouTube(entities);
      const signals = await finishSignals(provider, discovered.signals as JsonRecord[]);
      const result = await rpc(environment, "upsert_data_observatory_batch", { provider_input: provider, signals_input: signals, run_input: { action: "discover", status: "available", quota_state: discovered.quota, trigger_type: "manual" } }, { service: true }) as JsonRecord;
      saved += Number(result.saved) || 0;
    } catch (error) {
      const errorCode = error instanceof Error ? error.message : "PROVIDER_UNAVAILABLE";
      errors.push({ provider, error_code: errorCode, message: "La fuente no está disponible temporalmente; los demás proveedores continúan." });
      await rpc(environment, "record_data_provider_run", { provider_input: provider, action_input: "discover", status_input: errorCode.includes("NOT_CONFIGURED") ? "not_configured" : errorCode.includes("RATE") ? "rate_limited" : "failed", result_count_input: 0, detail_input: { error_code: errorCode, trigger_type: "manual" } }, { service: true }).catch(() => null);
    }
  }
  const updated = await rpc(environment, "get_data_observatory_dashboard", { filters_input: { limit: 100 } }, { authorization });
  return jsonResponse({ ok: true, saved, partial: errors.length > 0, errors, dashboard: updated });
}

async function invokeExpert(environment: NonNullable<ReturnType<typeof getSupabaseEnvironment>>, authorization: string, action: string, payload: JsonRecord) {
  const response = await fetch(`${environment.supabaseUrl}/functions/v1/market-expert`, { method: "POST", headers: { Authorization: authorization, apikey: environment.publishableKey, "Content-Type": "application/json" }, body: JSON.stringify({ action, ...payload }) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error("MARKET_EXPERT_UNAVAILABLE");
  return data as JsonRecord;
}

function proposalPrefill(detail: JsonRecord, draftPackage: JsonRecord) {
  const signal = detail.signal as JsonRecord || {};
  const verdict = draftPackage.verdict as JsonRecord || {};
  const proposal = draftPackage.fields as JsonRecord || verdict.proposal as JsonRecord || {};
  const contract = draftPackage.contract as JsonRecord || verdict.resolution_contract as JsonRecord || signal.suggested_resolution_contract as JsonRecord || {};
  const packageOrigin = draftPackage.origin as JsonRecord || {};
  const run = draftPackage.run as JsonRecord || {};
  const sources = records(contract.sources);
  return {
    origin: { type: "observatory_signal", id: packageOrigin.id || signal.id, expert_run_id: run.id },
    fields: {
      market_slug: text(proposal.market_slug, 120),
      question: text(proposal.question || signal.suggested_question, 500),
      subject: text(proposal.subject || signal.title, 300),
      category: text(proposal.category || signal.atinara_category, 100),
      yes_option: text(proposal.yes_option || "Sí", 80),
      no_option: text(proposal.no_option || "No", 80),
      evaluation_period_label: text(proposal.evaluation_period_label, 1000),
      evaluation_ends_at: proposal.evaluation_ends_at || contract.evaluation_at || contract.window_end || "",
      timezone: text(contract.timezone || "Europe/Madrid", 100),
      resolution_deadline: proposal.resolution_deadline || "",
      yes_criteria: text(proposal.yes_criteria || signal.suggested_yes_criteria, 4000),
      no_criteria: text(proposal.no_criteria || signal.suggested_no_criteria, 4000),
      edge_cases: text(proposal.edge_cases || signal.suggested_edge_cases, 4000),
      delay_treatment: text(proposal.delay_treatment, 4000),
      cancellation_treatment: text(proposal.cancellation_treatment, 4000),
      leak_treatment: text(proposal.leak_treatment, 4000),
      rename_treatment: text(proposal.rename_treatment, 4000),
      assumptions: text(proposal.assumptions, 4000),
      public_criteria: text(proposal.public_criteria, 4000),
      description: text(proposal.description || signal.description, 4000),
      primary_source_url: text(sources.find((source) => source.role === "PRIMARY_RESOLUTION")?.url || signal.canonical_url, 2048),
      alternative_sources: sources.filter((source) => source.role !== "PRIMARY_RESOLUTION").map((source) => text(source.url, 2048)).filter(Boolean).join("\n"),
    },
    contract,
    sources,
    expert: verdict,
  };
}

async function handleAction(environment: NonNullable<ReturnType<typeof getSupabaseEnvironment>>, authorization: string, adminId: string, body: JsonRecord) {
  const action = text(body.action, 80);
  if (action === "provider-status") return jsonResponse({ ok: true, providers: providerStatusPayload(), policy_version: MARKET_INTELLIGENCE_POLICY_VERSION });
  if (action === "dashboard" || action === "list-watchlist") {
    const dashboard = await rpc(environment, "get_data_observatory_dashboard", { filters_input: body.filters || {} }, { authorization });
    return jsonResponse({ ok: true, dashboard });
  }
  if (action === "search") {
    const provider = text(body.provider, 30);
    const result = await searchProvider(provider, text(body.query, 200));
    return jsonResponse({ ok: true, provider, ...result, warning: provider === "youtube" ? "La búsqueda manual de YouTube consume cuota; no se usa en actualizaciones automáticas." : null });
  }
  if (action === "twitch-top-games") return jsonResponse({ ok: true, provider: "twitch", ...(await twitchTopGames()) });
  if (action === "add-watch") {
    const entity = body.entity && typeof body.entity === "object" ? body.entity as JsonRecord : {};
    const saved = await rpc(environment, "save_data_observatory_entity", { entity_input: entity }, { authorization });
    return jsonResponse({ ok: true, entity: saved });
  }
  if (action === "remove-watch") {
    const result = await rpc(environment, "remove_data_observatory_entity", { entity_id_input: text(body.entity_id, 80) }, { authorization });
    return jsonResponse({ ok: true, result });
  }
  if (action === "discover") return runDiscovery(environment, authorization, body);
  if (action === "discover-official-opportunities") return discoverOfficialOpportunities(environment, authorization, adminId, body);
  if (action === "details") {
    const detail = await rpc(environment, "get_data_observatory_signal", { signal_id_input: text(body.signal_id, 80) }, { authorization });
    return jsonResponse({ ok: true, detail });
  }
  if (["request-expert-analysis", "revalidate-signal", "generate-proposal"].includes(action)) {
    const result = await invokeExpert(environment, authorization, "analyze-origin", { origin_type: "observatory_signal", origin_id: text(body.signal_id, 80), force: action === "revalidate-signal" });
    return jsonResponse({ ok: true, expert: result });
  }
  if (["discover-context", "refresh-context", "scan-watchlist-opportunities"].includes(action)) {
    const result = await invokeExpert(environment, authorization, "discover-opportunities", { origin_type: body.origin_type || "observatory_signal", origin_id: text(body.signal_id || body.origin_id, 80), force_context: action === "refresh-context", trigger_type: "manual" });
    return jsonResponse({ ok: true, discovery: result });
  }
  if (action === "run-context-discovery-due") {
    const due = await rpc(environment, "get_due_context_discovery_entities", { limit_count: Math.min(Math.max(Number(body.limit) || 5, 1), INTELLIGENCE_LIMITS.maxContextScansPerRun) }, { service: true }) as JsonRecord;
    if (due.enabled !== true) return jsonResponse({ ok: true, enabled: false, processed: [], message: "La programación editorial permanece desactivada." });
    const processed = [];
    for (const entity of records(due.entities)) {
      const signalId = text(entity.signal_id, 80);
      if (!signalId) continue;
      try {
        const result = await invokeExpert(environment, authorization, "discover-opportunities", { origin_type: "observatory_signal", origin_id: signalId, trigger_type: "scheduled" });
        processed.push({ entity_id: entity.id, signal_id: signalId, ok: true, hypotheses: records((result as JsonRecord).hypotheses).length });
      } catch {
        processed.push({ entity_id: entity.id, signal_id: signalId, ok: false, error: "CONTEXT_DISCOVERY_FAILED" });
      }
    }
    return jsonResponse({ ok: true, enabled: true, processed, creates_draft: false, publishes: false, resolves: false });
  }
  if (action === "prepare-draft") {
    const signalId = text(body.signal_id, 80);
    const packageResponse = await invokeExpert(environment, authorization, "get-draft-package", {
      origin_type: "observatory_signal",
      origin_id: signalId,
    });
    const draftPackage = packageResponse.package && typeof packageResponse.package === "object"
      ? packageResponse.package as JsonRecord : {};
    const packageRun = draftPackage.run && typeof draftPackage.run === "object" ? draftPackage.run as JsonRecord : {};
    if (draftPackage.available !== true || !packageRun.id) {
      throw new Error(packageResponse.stale === true ? "MARKET_EXPERT_ANALYSIS_STALE" : "MARKET_EXPERT_ANALYSIS_REQUIRED");
    }
    const detail = await rpc(environment, "get_data_observatory_signal", { signal_id_input: signalId }, { authorization }) as JsonRecord;
    const signal = detail.signal && typeof detail.signal === "object" ? detail.signal as JsonRecord : {};
    const analysis = detail.expert_analysis && typeof detail.expert_analysis === "object" ? detail.expert_analysis as JsonRecord : {};
    if (signal.expert_analysis_status !== "completed" || analysis.id !== packageRun.id
      || analysis.analysis_fingerprint !== packageRun.analysis_fingerprint) {
      throw new Error("MARKET_EXPERT_ANALYSIS_STALE");
    }
    const prefill = proposalPrefill(detail, draftPackage);
    return jsonResponse({ ok: true, prefill, message: "La propuesta solo pre-rellena el formulario; no guarda, aprueba, programa ni publica." });
  }
  if (action === "dismiss-signal") {
    const result = await rpc(environment, "dismiss_data_observatory_signal", { signal_id_input: text(body.signal_id, 80) }, { authorization });
    return jsonResponse({ ok: true, result });
  }
  throw new Error("OBSERVATORY_ACTION_INVALID");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "METHOD_NOT_ALLOWED", message: "Utiliza POST." }, 405);
  const environment = getSupabaseEnvironment();
  if (!environment) return jsonResponse({ error: "SERVICE_NOT_CONFIGURED", message: "El Observatorio no puede conectar con Supabase." }, 503);
  const authorization = req.headers.get("authorization") ?? "";
  try {
    const body = await readJsonBody(req);
    const auth = await authenticateAdminOrService(environment, authorization, body.action === "run-context-discovery-due");
    if (auth instanceof Response) return auth;
    return await handleAction(environment, authorization, auth.adminId, body);
  } catch (error) {
    console.error("Data observatory request failed", JSON.stringify({ code: publicErrorCode(error) }));
    return handleEdgeError(error, "No se ha podido completar esta operación. Los demás proveedores y la creación manual siguen disponibles.");
  }
});
