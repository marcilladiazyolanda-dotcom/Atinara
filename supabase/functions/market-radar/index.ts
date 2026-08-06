import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  RADAR_API_HOSTS,
  RADAR_CATEGORIES,
  RADAR_NORMALIZER_VERSION,
  RADAR_PROVIDERS,
  RADAR_REASON_CODES,
  adaptKalshiResponse,
  adaptPolymarketResponse,
  applyAdaptation,
  applyEligibilityDecision,
  buildCacheKey,
  buildDraftPrefill,
  cleanText,
  compactGeminiCandidate,
  compactGeminiDefinition,
  diversifyGroups,
  evaluateDeterministicEligibility,
  groupCandidates,
  isRecord,
  parseGeminiAdaptations,
  publicProviderError,
  safeIsoDate,
  safeNumber,
  safePublicUrl,
  scoreCandidates,
  summarizeRejections,
} from "../_shared/market-radar.mjs";

type JsonRecord = Record<string, unknown>;
type Environment = NonNullable<ReturnType<typeof getEnvironment>>;

const MAX_REQUEST_BYTES = 8_192;
const PROVIDER_TIMEOUT_MS = 14_000;
const GEMINI_TIMEOUT_MS = 35_000;
const GEMINI_MODEL = "gemini-3-flash-preview";
const MAX_PROVIDER_PAGES = 3;
const MAX_NORMALIZED_PER_PROVIDER = 240;
const MAX_VISIBLE_GROUPS = 60;
const MAX_GEMINI_GROUPS = 20;
const MAX_KALSHI_SERIES = 25;
const KALSHI_CONCURRENCY = 4;
const REFRESH_COOLDOWN_MS = 60_000;
const VERIFICATION_TTL_MINUTES = 360;

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

async function rpc(environment: Environment, name: string, args: JsonRecord, authorization?: string, service = false): Promise<unknown> {
  const key = service ? environment.secretKey : environment.publishableKey;
  const response = await fetch(`${environment.supabaseUrl}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: restHeaders(key, service ? undefined : authorization),
    body: JSON.stringify(args),
  });
  const payload = await response.json().catch(() => ({})) as unknown;
  if (!response.ok) {
    console.error("Radar RPC failed", JSON.stringify({ name, status: response.status }));
    throw new Error(`RPC_${response.status}`);
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

async function fetchJson(url: URL, init: RequestInit = {}, timeoutMs = PROVIDER_TIMEOUT_MS): Promise<unknown> {
  if (!validateApiUrl(url)) throw new Error("PROVIDER_HOST_NOT_ALLOWED");
  let lastStatus = 0;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { ...init, signal: controller.signal });
      lastStatus = response.status;
      if (response.ok) {
        const text = await response.text();
        if (text.length > 3_000_000) throw new Error("PROVIDER_RESPONSE_TOO_LARGE");
        try {
          return JSON.parse(text);
        } catch {
          throw new Error("PROVIDER_INVALID_RESPONSE");
        }
      }
      if (response.status !== 429 && response.status < 500) throw new Error(`PROVIDER_HTTP_${response.status}`);
      if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 500));
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") throw new Error("PROVIDER_TIMEOUT");
      if (attempt === 1 || (error instanceof Error && /INVALID|NOT_ALLOWED|TOO_LARGE|HTTP_4(?!29)/.test(error.message))) throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
  throw new Error(lastStatus === 429 ? "PROVIDER_RATE_LIMITED" : "PROVIDER_UNAVAILABLE");
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
  return publicProviderError(provider, code, code === "PROVIDER_RATE_LIMITED" ? 429 : 502);
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
      const canonicalMarkets = toRecordArray(canonical.markets);
      const searchMarketIds = new Set(toRecordArray(searchEvent.markets).map((market) => cleanText(market.id ?? market.conditionId, 220)));
      const markets = canonicalMarkets.filter((market) => searchMarketIds.size === 0 || searchMarketIds.has(cleanText(market.id ?? market.conditionId, 220)));
      if (!markets.length) continue;
      const canonicalUrl = await verifyPublicUrl(`https://polymarket.com/event/${slug}`, "polymarket.com");
      if (!canonicalUrl) continue;
      validatedEvents.push({ ...canonical, markets, canonical_url_verified: true });
    } catch {
      // Un evento inválido no invalida el resto del proveedor.
    }
  }
  return adaptPolymarketResponse({ events: validatedEvents }, { now, cacheMinutes: 20, canonicalUrlVerified: true })
    .slice(0, MAX_NORMALIZED_PER_PROVIDER);
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
    for (const event of events) {
      const eventTicker = cleanText(event.event_ticker ?? event.ticker, 160);
      if (!eventTicker) continue;
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
        markets: toRecordArray(event.markets).map((market) => ({
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
  return adaptKalshiResponse({ events }, { now, category, cacheMinutes: 20 }).slice(0, MAX_NORMALIZED_PER_PROVIDER);
}

async function researchGroupsWithTavily(apiKey: string, candidates: JsonRecord[]) {
  if (!apiKey) throw new Error("PROVIDER_NOT_CONFIGURED");
  const groups = groupCandidates(candidates).slice(0, MAX_GEMINI_GROUPS);
  const evidence = new Map<string, JsonRecord[]>();
  for (const group of groups) {
    const url = new URL("https://api.tavily.com/search");
    const payload = toRecord(await fetchJson(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: apiKey,
        query: `${cleanText(group.title, 500)} official announcement release date result eligibility`,
        search_depth: "basic",
        max_results: 6,
        include_answer: false,
        include_raw_content: false,
        include_domains: ["playstation.com", "xbox.com", "nintendo.com", "ea.com", "thegameawards.com", "metacritic.com", "store.steampowered.com", "gamespress.com"],
      }),
    })) ?? {};
    evidence.set(group.event_group_key, toRecordArray(payload.results).map((result) => ({
      title: cleanText(result.title, 300),
      url: safePublicUrl(result.url),
      published_at: safeIsoDate(result.published_date),
      source_type: "public",
      supports: cleanText(result.content, 500),
    })).filter((item) => item.url));
  }
  return evidence;
}

async function verifyAndAdaptWithGemini(apiKey: string, candidates: JsonRecord[], existing: JsonRecord[], evidenceByGroup: Map<string, JsonRecord[]>, now: string) {
  if (!apiKey) throw new Error("PROVIDER_NOT_CONFIGURED");
  const groups = groupCandidates(candidates).slice(0, MAX_GEMINI_GROUPS);
  if (!groups.length) return candidates;
  const safeGroups = groups.map((group) => ({
    event_group_key: group.event_group_key,
    title: group.title,
    candidates: group.candidates.map(compactGeminiCandidate).filter(isRecord),
    evidence: evidenceByGroup.get(group.event_group_key) ?? [],
  }));
  const safeExisting = existing.slice(0, 100).map(compactGeminiDefinition).filter(isRecord);
  const prompt = `Actúa como validador factual cerrado del Radar privado de Atinara. Solo puedes usar los datos de proveedor y evidencias incluidas. No inventes hechos, URLs, fechas, nombres, estados ni condiciones. Devuelve JSON con {candidates:[...]}, exactamente un elemento por external_id. Para cada uno: external_id, event_group_key, eligible boolean, conclusive boolean, reason_code, reason en español, confidence 0-100, ttl_minutes, evidence (solo URLs recibidas), facts {event_resolved_at, official_reveal_at, release_at, subject_announced, temporal_coherence}, atinara_question, atinara_category y atinara_resolution_criteria. Códigos permitidos: EVENT_ALREADY_RESOLVED, SOURCE_STALE, EVENT_OUTSIDE_CONTRACT, SUBJECT_NOT_ANNOUNCED, TEMPORAL_INCOHERENCE, INVALID_OR_UNVERIFIED_SOURCE, VERIFICATION_REQUIRED. Un hecho ya anunciado no puede formularse como anuncio futuro. Un lanzamiento o premio posterior al periodo es ineligible. Half-Life 3 no puede tratarse como anunciado si no hay evidencia oficial. Si la evidencia falta, contradice o no concluye: eligible=false, conclusive=false, reason_code=VERIFICATION_REQUIRED. Las comprobaciones deterministas recibidas tienen prioridad. Categorías permitidas: ${RADAR_CATEGORIES.join(", ")}. Grupos:\n${JSON.stringify(safeGroups)}\nDefiniciones existentes sin datos personales:\n${JSON.stringify(safeExisting)}`;
  const url = new URL(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`);
  const payload = toRecord(await fetchJson(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: "application/json", temperature: 0.05, maxOutputTokens: 16_384, thinkingConfig: { thinkingLevel: "minimal" } },
    }),
  }, GEMINI_TIMEOUT_MS)) ?? {};
  const decisions = parseGeminiAdaptations(payload) as JsonRecord[];
  if (!decisions.length) throw new Error("PROVIDER_INVALID_RESPONSE");
  const byId = new Map(decisions.map((item) => [cleanText(item.external_id, 220), item]));
  return candidates.map((candidate) => {
    const decision = byId.get(cleanText(candidate.external_id, 220)) ?? { eligible: false, conclusive: false, reason_code: RADAR_REASON_CODES.VERIFICATION_REQUIRED };
    const adapted = applyAdaptation(candidate, decision);
    const deterministic = evaluateDeterministicEligibility(adapted, toRecord(decision.facts) ?? {}, now);
    return applyEligibilityDecision(adapted, { ...(deterministic ?? decision), evidence: evidenceByGroup.get(cleanText(candidate.event_group_key, 240)) ?? [] }, now);
  });
}

function failClosedCandidates(candidates: JsonRecord[], now: string, reason: string) {
  return candidates.map((candidate) => applyEligibilityDecision(candidate, {
    eligible: false,
    conclusive: false,
    reason_code: RADAR_REASON_CODES.VERIFICATION_REQUIRED,
    reason,
    confidence: 0,
    ttl_minutes: 60,
    evidence: [],
  }, now));
}

async function persistProviderResult(environment: Environment, provider: string, cacheKey: string, candidates: JsonRecord[]) {
  await rpc(environment, "upsert_market_radar_batch_v2", {
    provider_input: provider,
    cache_key_input: cacheKey,
    normalizer_version_input: RADAR_NORMALIZER_VERSION,
    candidates_input: candidates,
    provider_status_input: { status: "available", is_cached: false },
  }, undefined, true);
}

async function persistProviderFailure(environment: Environment, provider: string, cacheKey: string, failure: ReturnType<typeof providerFailure>) {
  await rpc(environment, "record_market_radar_provider_failure", {
    provider_input: provider,
    cache_key_input: cacheKey,
    status_input: failure.code === "PROVIDER_RATE_LIMITED" ? "rate_limited" : "unavailable",
    error_code_input: failure.code,
    error_message_input: failure.message,
  }, undefined, true).catch(() => null);
}

async function loadRadarView(environment: Environment, authorization: string, filters: ReturnType<typeof safeFilters>) {
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
  const candidates = toRecordArray(candidatesPayload);
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
    return jsonResponse({ ok: true, ...current, filters, cache_key: cacheKey, cached: true, cooldown_seconds: Math.ceil(cooldownRemaining / 1000), limits: { max_pages: MAX_PROVIDER_PAGES, max_kalshi_series: MAX_KALSHI_SERIES, max_visible_groups: MAX_VISIBLE_GROUPS } });
  }

  const now = new Date().toISOString();
  const existing = await loadExistingDefinitions(environment, authorization);
  const providers = filters.provider === "all" ? ["polymarket", "kalshi"] : filters.provider === "tavily" ? [] : [filters.provider];
  const errors: JsonRecord[] = [];
  const discoveredByProvider = new Map<string, JsonRecord[]>();
  for (const provider of providers) {
    try {
      const result = provider === "polymarket" ? await discoverPolymarket(now, filters) : await discoverKalshi(now);
      discoveredByProvider.set(provider, result as JsonRecord[]);
    } catch (error) {
      const failure = providerFailure(error, provider);
      errors.push(failure);
      await persistProviderFailure(environment, provider, cacheKey, failure);
    }
  }

  let candidates = [...discoveredByProvider.values()].flat();
  const scoredFirst = scoreCandidates(candidates, existing, now) as JsonRecord[];
  const cachedVerification = new Map(
    [...current.candidates, ...toRecordArray(current.rejected?.items)]
      .filter((item) => Date.parse(cleanText(item.verification_expires_at, 100)) > Date.now())
      .map((item) => [cleanText(item.external_id, 220), item]),
  );
  const reusable: JsonRecord[] = [];
  const needsVerification: JsonRecord[] = [];
  for (const candidate of scoredFirst) {
    const cached = cachedVerification.get(cleanText(candidate.external_id, 220));
    if (cached && cleanText(cached.fingerprint, 120) === cleanText(candidate.fingerprint, 120)) {
      reusable.push({
        ...candidate,
        atinara_question: cached.atinara_question ?? candidate.atinara_question,
        atinara_category: cached.atinara_category ?? candidate.atinara_category,
        atinara_resolution_criteria: cached.atinara_resolution_criteria ?? candidate.atinara_resolution_criteria,
        verification_status: cached.verification_status,
        verification_reason_code: cached.verification_reason_code,
        verification_reason: cached.verification_reason,
        verified_at: cached.verified_at,
        verification_expires_at: cached.verification_expires_at,
        verification_evidence: cached.verification_evidence,
        verification_confidence: cached.verification_confidence,
        quality_status: cached.quality_status,
        state: cached.state === "prepared" || cached.state === "dismissed" ? cached.state : candidate.state,
      });
    } else {
      needsVerification.push(candidate);
    }
  }
  let evidenceByGroup = new Map<string, JsonRecord[]>();
  let newlyVerified: JsonRecord[] = [];
  if (needsVerification.length) {
    try {
      evidenceByGroup = await researchGroupsWithTavily(environment.tavilyKey, needsVerification);
    } catch (error) {
      const failure = error instanceof Error && error.message === "PROVIDER_NOT_CONFIGURED"
        ? publicProviderError("tavily", "PROVIDER_NOT_CONFIGURED", 503)
        : providerFailure(error, "tavily");
      errors.push(failure);
      await persistProviderFailure(environment, "tavily", cacheKey, failure);
    }
    try {
      newlyVerified = await verifyAndAdaptWithGemini(environment.geminiKey, needsVerification, existing, evidenceByGroup, now);
    } catch (error) {
      const failure = error instanceof Error && error.message === "PROVIDER_NOT_CONFIGURED"
        ? publicProviderError("gemini", "PROVIDER_NOT_CONFIGURED", 503)
        : providerFailure(error, "gemini");
      errors.push(failure);
      await persistProviderFailure(environment, "gemini", cacheKey, failure);
      newlyVerified = failClosedCandidates(needsVerification, now, "La verificación automática no está disponible; el evento permanece bloqueado para preparación.");
    }
  }

  candidates = [...reusable, ...newlyVerified];

  const scored = scoreCandidates(candidates, existing, now) as JsonRecord[];
  for (const provider of discoveredByProvider.keys()) {
    await persistProviderResult(environment, provider, cacheKey, scored.filter((candidate) => candidate.provider === provider).slice(0, MAX_NORMALIZED_PER_PROVIDER));
  }
  const view = await loadRadarView(environment, authorization, filters);
  return jsonResponse({
    ok: true,
    ...view,
    filters,
    cache_key: cacheKey,
    cached: false,
    partial: errors.length > 0,
    errors,
    cooldown_seconds: Math.ceil(REFRESH_COOLDOWN_MS / 1000),
    limits: { max_pages: MAX_PROVIDER_PAGES, max_kalshi_series: MAX_KALSHI_SERIES, max_visible_groups: MAX_VISIBLE_GROUPS, max_gemini_groups: MAX_GEMINI_GROUPS },
  });
}

function candidateReady(candidate: JsonRecord): { ok: true } | { ok: false; error: string; message: string } {
  if (cleanText(candidate.normalizer_version, 80) !== RADAR_NORMALIZER_VERSION) return { ok: false, error: "NORMALIZER_OUTDATED", message: "La candidata debe actualizarse con el normalizador vigente." };
  if (cleanText(candidate.verification_status, 80) !== "verified_open") return { ok: false, error: "VERIFICATION_REQUIRED", message: "La candidata no tiene una verificación factual vigente." };
  const expiresAt = Date.parse(cleanText(candidate.verification_expires_at, 100));
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return { ok: false, error: "VERIFICATION_EXPIRED", message: "La verificación factual ha caducado. Actualiza el Radar." };
  if (cleanText(candidate.state, 40) !== "available") return { ok: false, error: "CANDIDATE_NOT_PREPARABLE", message: "La candidata ya no está disponible para preparar." };
  if (toRecordArray(candidate.duplicate_matches).length) return { ok: false, error: "CONFIRMED_DUPLICATE", message: "La candidata coincide con un mercado o borrador existente." };
  return { ok: true };
}

async function revalidatePolymarketCandidate(candidate: JsonRecord): Promise<boolean> {
  const eventSlug = cleanText(candidate.external_event_slug, 400);
  const marketId = cleanText(candidate.external_market_id, 220);
  if (!eventSlug || !marketId) return false;
  const event = toRecord(await fetchJson(new URL(`${POLYMARKET_GAMMA_ROOT}/events/slug/${encodeURIComponent(eventSlug)}`)));
  if (!event || event.closed === true || event.archived === true || event.active === false || event.acceptingOrders === false) return false;
  const market = toRecordArray(event.markets).find((item) => cleanText(item.id ?? item.conditionId, 220) === marketId);
  if (!market || market.closed === true || market.archived === true || market.active === false || market.acceptingOrders === false) return false;
  const closeAt = Date.parse(cleanText(market.endDate ?? event.endDate, 100));
  return !Number.isFinite(closeAt) || closeAt > Date.now();
}

async function revalidateKalshiCandidate(candidate: JsonRecord): Promise<boolean> {
  const eventTicker = cleanText(candidate.external_event_id, 220);
  const marketTicker = cleanText(candidate.external_market_id, 220);
  if (!eventTicker || !marketTicker) return false;
  const url = new URL(`${KALSHI_API_ROOT}/events/${encodeURIComponent(eventTicker)}`);
  url.searchParams.set("with_nested_markets", "true");
  const payload = toRecord(await fetchJson(url)) ?? {};
  const event = toRecord(payload.event) ?? payload;
  const market = toRecordArray(event.markets).find((item) => cleanText(item.ticker, 220) === marketTicker);
  if (!market || !["open", "active", "trading", "initialized"].includes(cleanText(market.status, 80).toLowerCase())) return false;
  const closeAt = Date.parse(cleanText(market.close_time ?? market.expected_expiration_time, 100));
  return !Number.isFinite(closeAt) || closeAt > Date.now();
}

async function revalidateCriticalEligibility(environment: Environment, authorization: string, candidate: JsonRecord): Promise<JsonRecord> {
  const evidenceByGroup = await researchGroupsWithTavily(environment.tavilyKey, [candidate]);
  const existing = await loadExistingDefinitions(environment, authorization);
  const checked = await verifyAndAdaptWithGemini(environment.geminiKey, [candidate], existing, evidenceByGroup, new Date().toISOString());
  return checked[0] ?? failClosedCandidates([candidate], new Date().toISOString(), "La verificación factual no pudo concluir antes de preparar el borrador.")[0];
}

function prepareRevalidationError(candidate: JsonRecord): { error: string; message: string } | null {
  const status = cleanText(candidate.verification_status, 80);
  if (status === "verified_open") return null;
  if (status === "rejected_resolved") return { error: "RADAR_CANDIDATE_RESOLVED", message: "El resultado ya es público y la candidata no puede prepararse." };
  if (status === "rejected_unannounced") return { error: "RADAR_CANDIDATE_UNANNOUNCED", message: "La candidata presupone un producto o acontecimiento no anunciado oficialmente." };
  if (["rejected_ineligible", "rejected_incoherent"].includes(status)) return { error: "RADAR_CANDIDATE_INELIGIBLE", message: "La candidata no es temporal o factualmente compatible con el contrato." };
  if (status === "rejected_invalid_source") return { error: "RADAR_CANONICAL_URL_INVALID", message: "No se pudo validar la fuente o el enlace canónico de la candidata." };
  if (status === "rejected_duplicate") return { error: "RADAR_CONFIRMED_DUPLICATE", message: "La candidata coincide con un mercado o borrador existente." };
  return { error: "RADAR_REVALIDATION_REQUIRED", message: "La verificación factual no ha concluido. La candidata permanece bloqueada." };
}

async function handleAction(environment: Environment, authorization: string, body: JsonRecord) {
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
  if (action === "prepare") {
    const candidate = toRecord(await rpc(environment, "get_market_radar_candidate", { candidate_id_input: candidateId }, authorization));
    if (!candidate) return jsonResponse({ error: "CANDIDATE_NOT_FOUND", message: "No se encontró la candidata." }, 404);
    const readiness = candidateReady(candidate);
    if (!readiness.ok) return jsonResponse({ error: readiness.error, message: readiness.message }, 409);
    let providerOpen = false;
    try {
      providerOpen = candidate.provider === "polymarket"
        ? await revalidatePolymarketCandidate(candidate)
        : candidate.provider === "kalshi" ? await revalidateKalshiCandidate(candidate) : false;
    } catch {
      return jsonResponse({ error: "PROVIDER_REVALIDATION_FAILED", message: "No se pudo confirmar el estado actual del mercado de origen. No se ha preparado ningún borrador." }, 503);
    }
    if (!providerOpen) return jsonResponse({ error: "PROVIDER_NOT_OPEN", message: "El mercado de origen ya no está abierto o no conserva la opción verificada." }, 409);
    let factuallyRevalidated: JsonRecord;
    try {
      factuallyRevalidated = await revalidateCriticalEligibility(environment, authorization, candidate);
      await persistProviderResult(
        environment,
        cleanText(candidate.provider, 40),
        `prepare:${cleanText(candidate.external_id, 140)}`,
        [factuallyRevalidated],
      );
    } catch {
      return jsonResponse({ error: "RADAR_REVALIDATION_REQUIRED", message: "No se pudo repetir la verificación factual. La candidata permanece bloqueada y no se ha preparado ningún borrador." }, 503);
    }
    const factualError = prepareRevalidationError(factuallyRevalidated);
    if (factualError) return jsonResponse(factualError, 409);
    const reserved = toRecord(await rpc(environment, "reserve_market_radar_candidate_for_prepare", {
      candidate_id_input: candidateId,
      normalizer_version_input: RADAR_NORMALIZER_VERSION,
      verification_checked_at_input: new Date().toISOString(),
    }, authorization));
    if (!reserved?.ok) return jsonResponse({ error: cleanText(reserved?.error, 100) || "PREPARE_REJECTED", message: cleanText(reserved?.message, 500) || "La candidata ya no cumple las condiciones de preparación." }, 409);
    return jsonResponse({ ok: true, candidate: factuallyRevalidated, prefill: buildDraftPrefill(factuallyRevalidated) });
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
    return await handleAction(environment, authorization, parsedBody);
  } catch (error) {
    console.error("Market Radar request failed", error instanceof Error ? error.name : "UnknownError");
    return jsonResponse({ error: "RADAR_FAILED", message: "No se pudo completar la operación del Radar." }, 500);
  }
});
