import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  RADAR_API_HOSTS,
  RADAR_CATEGORIES,
  RADAR_NORMALIZER_VERSION,
  RADAR_PROVIDERS,
  adaptKalshiResponse,
  adaptPolymarketResponse,
  adaptTavilyResults,
  applyAdaptation,
  buildCacheKey,
  buildDraftPrefill,
  cleanText,
  compactGeminiCandidate,
  compactGeminiDefinition,
  detectDuplicates,
  isRecord,
  isAdaptedIdeaComplete,
  parseGeminiAdaptations,
  publicProviderError,
  scoreCandidates,
} from "../_shared/market-radar.mjs";

type JsonRecord = Record<string, unknown>;

function toRecord(value: unknown): JsonRecord | null {
  return isRecord(value) ? value as JsonRecord : null;
}

function toRecordArray(value: unknown): JsonRecord[] {
  return Array.isArray(value)
    ? value.filter(isRecord).map((item) => item as JsonRecord)
    : [];
}

const MAX_REQUEST_BYTES = 8_192;
const PROVIDER_TIMEOUT_MS = 12_000;
const GEMINI_TIMEOUT_MS = 35_000;
const GEMINI_MAX_OUTPUT_TOKENS = 8_192;
const GEMINI_MODEL = "gemini-3-flash-preview";
const MAX_PROVIDER_PAGES = 1;
const MAX_NORMALIZED_PER_PROVIDER = 120;
const MAX_VISIBLE = 60;
const MAX_GEMINI_BATCH = 12;
const MAX_KALSHI_SERIES = 4;
const REFRESH_COOLDOWN_MS = 60_000;

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

function getPublishableKey(): string {
  const configured = Deno.env.get("SUPABASE_PUBLISHABLE_KEYS");
  if (configured) {
    try {
      const parsed = JSON.parse(configured) as Record<string, string>;
      if (parsed.default) return parsed.default;
    } catch {
      // Compatibilidad con el nombre anterior durante la activación manual.
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
      // Compatibilidad con service role durante la activación manual.
    }
  }
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
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

function getEnvironment() {
  const environment = {
    supabaseUrl: Deno.env.get("SUPABASE_URL") ?? "",
    publishableKey: getPublishableKey(),
    secretKey: getSecretKey(),
    tavilyKey: Deno.env.get("TAVILY_API_KEY") ?? "",
    geminiKey: Deno.env.get("GEMINI_API_KEY") ?? "",
  };
  return environment.supabaseUrl && environment.publishableKey && environment.secretKey
    ? environment
    : null;
}

async function rpc(
  environment: NonNullable<ReturnType<typeof getEnvironment>>,
  name: string,
  args: JsonRecord,
  authorization?: string,
  service = false,
): Promise<unknown> {
  const key = service ? environment.secretKey : environment.publishableKey;
  const response = await fetch(`${environment.supabaseUrl}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: restHeaders(key, service ? undefined : authorization),
    body: JSON.stringify(args),
  });
  const payload = await response.json().catch(() => ({})) as unknown;
  if (!response.ok) {
    console.error("Radar RPC failed", name, response.status);
    throw new Error(`RPC_${response.status}`);
  }
  return payload;
}

async function authenticateAdmin(
  environment: NonNullable<ReturnType<typeof getEnvironment>>,
  authorization: string,
): Promise<{ adminId: string } | Response> {
  const response = await fetch(`${environment.supabaseUrl}/auth/v1/user`, {
    headers: {
      Authorization: authorization,
      apikey: environment.publishableKey,
    },
  });
  if (!response.ok) {
    return jsonResponse({ error: "AUTH_REQUIRED", message: "Inicia sesión para usar el Radar." }, 401);
  }
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
        if (text.length > 2_000_000) throw new Error("PROVIDER_RESPONSE_TOO_LARGE");
        try { return JSON.parse(text); } catch { throw new Error("PROVIDER_INVALID_RESPONSE"); }
      }
      console.warn("Market Radar provider request failed", JSON.stringify({
        host: url.hostname,
        http_status: response.status,
      }));
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

function providerFailure(error: unknown, provider: string) {
  const raw = error instanceof Error ? error.message : "PROVIDER_UNAVAILABLE";
  const code = raw.includes("TIMEOUT") ? "PROVIDER_TIMEOUT"
    : raw.includes("RATE_LIMITED") || raw.includes("429") ? "PROVIDER_RATE_LIMITED"
      : raw.includes("INVALID") || raw.includes("TOO_LARGE") || raw.includes("HTTP_400")
        ? "PROVIDER_INVALID_RESPONSE"
        : "PROVIDER_UNAVAILABLE";
  return publicProviderError(provider, code, code === "PROVIDER_RATE_LIMITED" ? 429 : 502);
}

function safeFilters(body: JsonRecord) {
  const requestedProvider = cleanText(body.provider, 40);
  const requestedCategory = cleanText(body.category, 80);
  const requestedQuality = cleanText(body.quality, 40);
  const requestedOrder = cleanText(body.order, 40);
  const requestedHorizon = cleanText(body.horizon, 40);
  const provider = RADAR_PROVIDERS.includes(requestedProvider) ? requestedProvider : "all";
  const category = RADAR_CATEGORIES.includes(requestedCategory) ? requestedCategory : "";
  const quality = ["fit", "review", "all"].includes(requestedQuality) ? requestedQuality : "review";
  const order = ["recommended", "popularity", "closing", "recent"].includes(requestedOrder) ? requestedOrder : "recommended";
  const horizon = ["30d", "90d", "180d", "365d"].includes(requestedHorizon) ? requestedHorizon : "180d";
  return {
    provider,
    category,
    quality,
    order,
    horizon,
    query: cleanText(body.query, 120),
  };
}

async function loadExistingDefinitions(
  environment: NonNullable<ReturnType<typeof getEnvironment>>,
  authorization: string,
) {
  const [catalog, drafts] = await Promise.all([
    rpc(environment, "get_admin_market_catalog", {}, authorization).catch(() => []),
    rpc(environment, "list_admin_market_drafts", {
      status_filter: null,
      query_filter: null,
      limit_count: 100,
      offset_count: 0,
    }, authorization).catch(() => []),
  ]);
  return [
    ...(Array.isArray(catalog) ? catalog.map((item) => ({ ...(isRecord(item) ? item : {}), kind: "market" })) : []),
    ...(Array.isArray(drafts) ? drafts.map((item) => ({ ...(isRecord(item) ? item : {}), kind: "draft" })) : []),
  ];
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
  const url = new URL("https://gamma-api.polymarket.com/public-search");
  url.searchParams.set("q", filters.query || categoryQueries[filters.category] || "video game gaming");
  url.searchParams.set("events_status", "active");
  url.searchParams.set("limit_per_type", "60");
  url.searchParams.set("page", "1");
  url.searchParams.set("keep_closed_markets", "0");
  url.searchParams.set("search_profiles", "false");
  const payload = await fetchJson(url);
  return adaptPolymarketResponse(payload, {
    now,
    maxCandidates: MAX_NORMALIZED_PER_PROVIDER,
    maxRecords: 500,
    cacheMinutes: 20,
  });
}

async function discoverKalshi(now: string) {
  const seriesUrl = new URL("https://external-api.kalshi.com/trade-api/v2/series");
  seriesUrl.searchParams.set("category", "Entertainment");
  seriesUrl.searchParams.set("tags", "Video games");
  seriesUrl.searchParams.set("include_volume", "true");
  const seriesPayload = await fetchJson(seriesUrl);
  const seriesPayloadRecord = toRecord(seriesPayload);
  const series = toRecordArray(seriesPayloadRecord?.series).slice(0, MAX_KALSHI_SERIES);
  if (!series.length) return { candidates: [], rejected: [], cursor: null };
  const marketRequests = series.map(async (item) => {
    const ticker = cleanText(item.ticker, 120);
    if (!ticker) return [];
    const url = new URL("https://external-api.kalshi.com/trade-api/v2/markets");
    url.searchParams.set("status", "open");
    url.searchParams.set("series_ticker", ticker);
    url.searchParams.set("mve_filter", "exclude");
    url.searchParams.set("limit", "100");
    const payload = await fetchJson(url);
    const payloadRecord = toRecord(payload);
    const markets = toRecordArray(payloadRecord?.markets);
    const settlementSources = Array.isArray(item.settlement_sources) ? item.settlement_sources.filter(isRecord) : [];
    const resolutionUrl = cleanText(settlementSources[0]?.url, 1200);
    return markets.map((market) => ({
      ...market,
      category: cleanText(item.category, 160),
      tags: Array.isArray(item.tags) ? item.tags : [],
      rules_primary_url: resolutionUrl,
    }));
  });
  const settled = await Promise.allSettled(marketRequests);
  const markets = settled.flatMap((result) => result.status === "fulfilled" ? result.value : []);
  if (!markets.length && settled.some((result) => result.status === "rejected")) {
    throw new Error("PROVIDER_UNAVAILABLE");
  }
  return adaptKalshiResponse({ markets }, {
    now,
    maxCandidates: MAX_NORMALIZED_PER_PROVIDER,
    maxRecords: 500,
    cacheMinutes: 20,
  });
}

async function discoverTavily(
  apiKey: string,
  filters: ReturnType<typeof safeFilters>,
  now: string,
) {
  if (!apiKey) throw new Error("PROVIDER_NOT_CONFIGURED");
  const category = filters.category || "mercados y anuncios de videojuegos";
  const url = new URL("https://api.tavily.com/search");
  const payload = await fetchJson(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: apiKey,
      query: `${category} gaming official announcement objective date`,
      search_depth: "basic",
      max_results: 6,
      include_answer: false,
      include_raw_content: false,
    }),
  });
  return adaptTavilyResults(payload, {
    now,
    maxCandidates: 6,
    cacheMinutes: 720,
    tags: [category],
  });
}

async function adaptWithGemini(
  apiKey: string,
  candidates: JsonRecord[],
  existing: JsonRecord[],
): Promise<{ candidates: JsonRecord[]; processedCount: number }> {
  if (!apiKey || !candidates.length) return { candidates, processedCount: 0 };
  const selected = candidates
    .filter((candidate) => !detectDuplicates(candidate, existing).some((match: JsonRecord) => match.status === "confirmed"))
    .sort((left, right) => Number(right.provider === "tavily") - Number(left.provider === "tavily"))
    .slice(0, MAX_GEMINI_BATCH);
  if (!selected.length) return { candidates, processedCount: 0 };
  const safeInput = selected.map(compactGeminiCandidate).filter(isRecord);
  const safeExisting = existing.slice(0, 50).map(compactGeminiDefinition).filter(isRecord);
  const prompt = `Adapta estos candidatos gaming a borradores privados de Atinara en español. Devuelve exactamente un elemento por external_id y no inventes hechos, URLs, fechas, nombres, cifras ni condiciones. Conserva el significado y deja null cualquier dato no demostrado. La categoría debe ser una de ${RADAR_CATEGORIES.join(", ")}. Compara semánticamente con las definiciones existentes solo para señalar posibles coincidencias; nunca confirmes ni descartes una candidata. Candidatas:\n${JSON.stringify(safeInput)}\nDefiniciones existentes sin datos personales:\n${JSON.stringify(safeExisting)}`;
  const url = new URL(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`);
  const startedAt = Date.now();
  const payload = await fetchJson(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: "application/json",
        temperature: 0.1,
        maxOutputTokens: GEMINI_MAX_OUTPUT_TOKENS,
        thinkingConfig: { thinkingLevel: "minimal" },
      },
    }),
  }, GEMINI_TIMEOUT_MS);
  const adaptations = parseGeminiAdaptations(toRecord(payload) ?? {}) as JsonRecord[];
  if (!adaptations.length) throw new Error("PROVIDER_INVALID_RESPONSE");
  const byId = new Map(adaptations.map((item) => [cleanText(item.external_id, 220), item]));
  const adaptedCandidates = candidates.map((candidate) => {
    const adaptation = byId.get(cleanText(candidate.external_id, 220)) ?? null;
    const adapted = applyAdaptation(candidate, adaptation);
    const semanticDuplicate = toRecord(adaptation?.semantic_duplicate);
    const matchedId = semanticDuplicate ? cleanText(semanticDuplicate.matched_id, 220) : "";
    if (!matchedId) return adapted;
    return {
      ...adapted,
      duplicate_matches: [
        ...(Array.isArray(adapted.duplicate_matches) ? adapted.duplicate_matches : []),
        {
          status: "possible",
          reason: cleanText(semanticDuplicate?.reason, 500) || "Posible coincidencia semántica; requiere revisión humana.",
          kind: cleanText(semanticDuplicate?.kind, 60) || "existing",
          id: matchedId,
        },
      ],
      warnings: [...new Set([...(Array.isArray(adapted.warnings) ? adapted.warnings : []), "Posible duplicado semántico: revisa la coincidencia antes de preparar el borrador."])],
    };
  });
  console.info("Market Radar Gemini completed", JSON.stringify({
    elapsed_ms: Date.now() - startedAt,
    requested: safeInput.length,
    returned: adaptations.length,
  }));
  return { candidates: adaptedCandidates, processedCount: adaptations.length };
}

async function persistProviderResult(
  environment: NonNullable<ReturnType<typeof getEnvironment>>,
  provider: string,
  cacheKey: string,
  candidates: JsonRecord[],
) {
  await rpc(environment, "upsert_market_radar_batch", {
    provider_input: provider,
    cache_key_input: cacheKey,
    normalizer_version_input: RADAR_NORMALIZER_VERSION,
    candidates_input: candidates,
    provider_status_input: { status: "available", is_cached: false },
  }, undefined, true);
}

async function persistProviderFailure(
  environment: NonNullable<ReturnType<typeof getEnvironment>>,
  provider: string,
  cacheKey: string,
  failure: ReturnType<typeof providerFailure>,
) {
  await rpc(environment, "record_market_radar_provider_failure", {
    provider_input: provider,
    cache_key_input: cacheKey,
    status_input: failure.code === "PROVIDER_RATE_LIMITED" ? "rate_limited" : "unavailable",
    error_code_input: failure.code,
    error_message_input: failure.message,
  }, undefined, true).catch(() => null);
}

async function persistProcessingSuccess(
  environment: NonNullable<ReturnType<typeof getEnvironment>>,
  provider: string,
  cacheKey: string,
  resultCount: number,
) {
  await rpc(environment, "record_market_radar_provider_success", {
    provider_input: provider,
    cache_key_input: cacheKey,
    result_count_input: resultCount,
  }, undefined, true);
}

async function loadRadarView(
  environment: NonNullable<ReturnType<typeof getEnvironment>>,
  authorization: string,
  filters: ReturnType<typeof safeFilters>,
) {
  const [candidates, providers] = await Promise.all([
    rpc(environment, "list_market_radar_candidates", {
      provider_filter: filters.provider === "all" ? null : filters.provider,
      category_filter: filters.category || null,
      quality_filter: filters.quality,
      query_filter: filters.query || null,
      order_key: filters.order,
      horizon_filter: filters.horizon,
      limit_count: MAX_VISIBLE,
      offset_count: 0,
    }, authorization),
    rpc(environment, "get_market_radar_provider_status", {}, authorization),
  ]);
  return {
    candidates: Array.isArray(candidates) ? candidates : [],
    providers: Array.isArray(providers) ? providers : [],
  };
}

async function runDiscovery(
  environment: NonNullable<ReturnType<typeof getEnvironment>>,
  authorization: string,
  body: JsonRecord,
) {
  const filters = safeFilters(body);
  const cacheKey = buildCacheKey(filters);
  const current = await loadRadarView(environment, authorization, filters);
  const requestedRefresh = body.refresh === true;
  const latest = current.providers
    .map((provider) => Date.parse(cleanText((provider as JsonRecord).fetched_at, 100)))
    .filter(Number.isFinite)
    .sort((a, b) => b - a)[0] || 0;
  const cooldownRemaining = Math.max(0, REFRESH_COOLDOWN_MS - (Date.now() - latest));
  if (!requestedRefresh || cooldownRemaining > 0) {
    return jsonResponse({
      ok: true,
      ...current,
      filters,
      cache_key: cacheKey,
      cached: true,
      cooldown_seconds: Math.ceil(cooldownRemaining / 1000),
      limits: { max_pages: MAX_PROVIDER_PAGES, max_kalshi_series: MAX_KALSHI_SERIES, max_visible: MAX_VISIBLE, max_gemini_batch: MAX_GEMINI_BATCH },
    });
  }

  const now = new Date().toISOString();
  const existing = await loadExistingDefinitions(environment, authorization);
  const providers = filters.provider === "all" ? RADAR_PROVIDERS : [filters.provider];
  const errors: JsonRecord[] = [];
  const discoveredByProvider = new Map<string, JsonRecord[]>();
  for (const provider of providers) {
    try {
      let result;
      if (provider === "polymarket") result = await discoverPolymarket(now, filters);
      else if (provider === "kalshi") result = await discoverKalshi(now);
      else result = await discoverTavily(environment.tavilyKey, filters, now);
      discoveredByProvider.set(provider, result.candidates as JsonRecord[]);
    } catch (error) {
      const failure = error instanceof Error && error.message === "PROVIDER_NOT_CONFIGURED"
        ? publicProviderError(provider, "PROVIDER_NOT_CONFIGURED", 503)
        : providerFailure(error, provider);
      errors.push(failure);
      await persistProviderFailure(environment, provider, cacheKey, failure);
    }
  }

  let candidates = [...discoveredByProvider.values()].flat();
  if (environment.geminiKey && candidates.length) {
    const geminiStartedAt = Date.now();
    try {
      const adaptation = await adaptWithGemini(environment.geminiKey, candidates, existing);
      candidates = adaptation.candidates;
      await persistProcessingSuccess(environment, "gemini", cacheKey, adaptation.processedCount);
    } catch (error) {
      const failure = providerFailure(error, "gemini");
      console.warn("Market Radar provider degraded", JSON.stringify({
        provider: "gemini",
        code: failure.code,
        elapsed_ms: Date.now() - geminiStartedAt,
      }));
      errors.push(failure);
      await persistProviderFailure(environment, "gemini", cacheKey, failure);
    }
  } else if (!environment.geminiKey && candidates.length) {
    const failure = publicProviderError("gemini", "PROVIDER_NOT_CONFIGURED", 503);
    errors.push(failure);
    await persistProviderFailure(environment, "gemini", cacheKey, failure);
  }
  candidates = candidates.map((candidate) => isAdaptedIdeaComplete(candidate)
    ? candidate
    : {
      ...candidate,
      quality_status: "rejected",
      warnings: [...new Set([...(Array.isArray(candidate.warnings) ? candidate.warnings : []), "La idea externa no demuestra todavía pregunta, fecha, fuente y criterios resolubles."])],
    });
  const scored = scoreCandidates(candidates, existing, now)
    .filter((candidate: JsonRecord) => candidate.quality_status !== "rejected");
  for (const provider of discoveredByProvider.keys()) {
    await persistProviderResult(
      environment,
      provider,
      cacheKey,
      scored.filter((candidate: JsonRecord) => candidate.provider === provider).slice(0, MAX_NORMALIZED_PER_PROVIDER),
    );
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
    limits: { max_pages: MAX_PROVIDER_PAGES, max_kalshi_series: MAX_KALSHI_SERIES, max_visible: MAX_VISIBLE, max_gemini_batch: MAX_GEMINI_BATCH },
  });
}

async function handleAction(
  environment: NonNullable<ReturnType<typeof getEnvironment>>,
  authorization: string,
  body: JsonRecord,
) {
  const action = cleanText(body.action, 40);
  if (action === "discover") return runDiscovery(environment, authorization, body);
  if (action === "provider-status") {
    const providers = await rpc(environment, "get_market_radar_provider_status", {}, authorization);
    return jsonResponse({ ok: true, providers: Array.isArray(providers) ? providers : [] });
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
    const duplicates = Array.isArray(candidate.duplicate_matches) ? candidate.duplicate_matches : [];
    if (duplicates.some((match) => toRecord(match)?.status === "confirmed")) {
      return jsonResponse({ error: "CONFIRMED_DUPLICATE", message: "La candidata coincide con un mercado o borrador existente." }, 409);
    }
    if (!["available", "needs_review"].includes(cleanText(candidate.state, 40))) {
      return jsonResponse({ error: "CANDIDATE_NOT_PREPARABLE", message: "La candidata ya fue preparada o descartada." }, 409);
    }
    return jsonResponse({ ok: true, candidate, prefill: buildDraftPrefill(candidate) });
  }
  if (action === "dismiss") {
    const result = await rpc(environment, "dismiss_market_radar_candidate", { candidate_id_input: candidateId }, authorization);
    return jsonResponse({ ok: true, result: isRecord(result) ? result : {} });
  }
  return jsonResponse({ error: "INVALID_ACTION", message: "La acción del Radar no es válida." }, 400);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "METHOD_NOT_ALLOWED", message: "Usa una petición POST." }, 405);
  if (Number(req.headers.get("content-length") ?? 0) > MAX_REQUEST_BYTES) {
    return jsonResponse({ error: "REQUEST_TOO_LARGE", message: "La petición es demasiado grande." }, 413);
  }
  const authorization = req.headers.get("authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) {
    return jsonResponse({ error: "AUTH_REQUIRED", message: "Inicia sesión para usar el Radar." }, 401);
  }
  const environment = getEnvironment();
  if (!environment) {
    console.error("Market Radar missing Supabase environment variables.");
    return jsonResponse({ error: "SERVER_NOT_CONFIGURED", message: "El Radar no está configurado en el servidor." }, 503);
  }
  const auth = await authenticateAdmin(environment, authorization);
  if (auth instanceof Response) return auth;
  try {
    const rawBody = await req.text();
    if (new TextEncoder().encode(rawBody).byteLength > MAX_REQUEST_BYTES) {
      return jsonResponse({ error: "REQUEST_TOO_LARGE", message: "La petición es demasiado grande." }, 413);
    }
    let parsedBody: unknown;
    try {
      parsedBody = JSON.parse(rawBody);
    } catch {
      return jsonResponse({ error: "INVALID_REQUEST", message: "La petición no es válida." }, 400);
    }
    const body = toRecord(parsedBody);
    if (!body) return jsonResponse({ error: "INVALID_REQUEST", message: "La petición no es válida." }, 400);
    return await handleAction(environment, authorization, body);
  } catch (error) {
    const errorName = error instanceof Error ? error.name : "UnknownError";
    console.error("Market Radar request failed", errorName);
    return jsonResponse({ error: "RADAR_FAILED", message: "No se pudo completar la operación del Radar." }, 500);
  }
});
