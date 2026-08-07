export const RADAR_NORMALIZER_VERSION = "atinara-radar-v2";

export const RADAR_CATEGORIES = Object.freeze([
  "Lanzamientos",
  "Eventos",
  "Industria",
  "Streamers",
  "Reviews/Premios",
  "YouTubers",
]);

export const RADAR_PROVIDERS = Object.freeze(["polymarket", "kalshi", "tavily"]);
export const RADAR_API_HOSTS = Object.freeze([
  "gamma-api.polymarket.com",
  "external-api.kalshi.com",
  "api.elections.kalshi.com",
  "api.tavily.com",
  "generativelanguage.googleapis.com",
]);

export const RADAR_VERIFICATION_STATUSES = Object.freeze([
  "pending",
  "verified_open",
  "needs_review",
  "rejected_resolved",
  "rejected_stale",
  "rejected_ineligible",
  "rejected_unannounced",
  "rejected_incoherent",
  "rejected_invalid_source",
  "rejected_duplicate",
]);

export const RADAR_REJECTED_STATUSES = Object.freeze(
  RADAR_VERIFICATION_STATUSES.filter((status) => status.startsWith("rejected_")),
);

export const RADAR_REASON_CODES = Object.freeze({
  EVENT_ALREADY_RESOLVED: "EVENT_ALREADY_RESOLVED",
  SOURCE_STALE: "SOURCE_STALE",
  EVENT_OUTSIDE_CONTRACT: "EVENT_OUTSIDE_CONTRACT",
  SUBJECT_NOT_ANNOUNCED: "SUBJECT_NOT_ANNOUNCED",
  TEMPORAL_INCOHERENCE: "TEMPORAL_INCOHERENCE",
  INVALID_OR_UNVERIFIED_SOURCE: "INVALID_OR_UNVERIFIED_SOURCE",
  DUPLICATE_MARKET: "DUPLICATE_MARKET",
  PROVIDER_NOT_OPEN: "PROVIDER_NOT_OPEN",
  PROVIDER_EVENT_NOT_FOUND: "PROVIDER_EVENT_NOT_FOUND",
  PROVIDER_CHILD_NOT_FOUND: "PROVIDER_CHILD_NOT_FOUND",
  VERIFICATION_REQUIRED: "VERIFICATION_REQUIRED",
  VERIFICATION_EXPIRED: "VERIFICATION_EXPIRED",
});

const PROVIDER_PUBLIC_HOSTS = Object.freeze({
  polymarket: ["polymarket.com", "www.polymarket.com"],
  kalshi: ["kalshi.com", "www.kalshi.com"],
});

const GAMING_TERMS = [
  "game", "gaming", "video game", "videojuego", "playstation", "xbox", "nintendo", "steam",
  "metacritic", "game awards", "goty", "esports", "twitch", "streamer", "youtube", "youtuber",
  "gta", "grand theft auto", "fable", "half-life", "ea sports", "fc 27", "fortnite", "valorant",
  "league of legends", "resident evil", "silksong", "switch", "console", "consola", "lanzamiento",
];

const BLOCKED_TERMS = [
  "murder", "assassination", "terrorist", "terrorism", "suicide", "death of", "muere", "asesinato",
  "atentado", "apuesta", "casino", "criptomoneda", "bitcoin price", "stock price", "share price",
];

const SUBJECTIVE_TERMS = [
  "mejor juego", "best game", "éxito", "exito", "popular", "will be good", "será bueno", "sera bueno",
];

const CATEGORY_TERMS = Object.freeze({
  Lanzamientos: ["release", "launch", "lanzamiento", "fecha", "delay", "retras", "trailer", "announce", "anunci"],
  Eventos: ["event", "evento", "showcase", "direct", "gamescom", "e3", "conference", "torneo", "esports"],
  Industria: ["studio", "estudio", "acquisition", "adquis", "publisher", "industr", "layoff", "ventas", "units"],
  Streamers: ["streamer", "twitch", "viewers", "espectadores", "ibai"],
  "Reviews/Premios": ["metacritic", "review", "score", "nominee", "nominated", "goty", "game awards", "reseña", "nominado"],
  YouTubers: ["youtube", "youtuber", "subscriber", "suscriptor", "creator", "creador"],
});

const REASON_COPY = Object.freeze({
  EVENT_ALREADY_RESOLVED: "El hecho ya es público o el evento ya está resuelto.",
  SOURCE_STALE: "La evidencia disponible está caducada o ya no representa el estado actual.",
  EVENT_OUTSIDE_CONTRACT: "El hecho ocurrirá fuera del periodo que plantea el mercado.",
  SUBJECT_NOT_ANNOUNCED: "La premisa presupone un producto o evento que no ha sido anunciado oficialmente.",
  TEMPORAL_INCOHERENCE: "Las fechas o el periodo del mercado son incompatibles con la evidencia verificada.",
  INVALID_OR_UNVERIFIED_SOURCE: "No se pudo validar una fuente pública suficiente para preparar el mercado.",
  DUPLICATE_MARKET: "Ya existe un mercado o borrador equivalente en Atinara.",
  PROVIDER_NOT_OPEN: "El mercado de origen ya no admite participación.",
  PROVIDER_EVENT_NOT_FOUND: "El evento de origen ya no existe o no se pudo verificar.",
  PROVIDER_CHILD_NOT_FOUND: "La opción de mercado ya no pertenece al evento verificado.",
  VERIFICATION_REQUIRED: "La candidata necesita revisión factual antes de preparar un borrador.",
  VERIFICATION_EXPIRED: "La verificación factual ha caducado y debe repetirse.",
});

export function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function cleanText(value, maxLength = 4000) {
  if (value === null || value === undefined) return "";
  return String(value).replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

export function safeNumber(value) {
  const number = typeof value === "number" ? value : Number(String(value ?? "").replace(",", "."));
  return Number.isFinite(number) ? number : null;
}

export function safeProbability(value) {
  const number = safeNumber(value);
  if (number === null) return null;
  const percent = number > 0 && number <= 1 ? number * 100 : number;
  return percent >= 0 && percent <= 100 ? percent : null;
}

export function safeIsoDate(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

export function safeStringArray(value, maxItems = 30) {
  const source = Array.isArray(value) ? value : value ? [value] : [];
  return [...new Set(source.map((item) => cleanText(item, 1000)).filter(Boolean))].slice(0, maxItems);
}

export function safePublicUrl(value, allowedHosts = null) {
  const candidate = cleanText(value, 2048);
  if (!candidate) return null;
  try {
    const url = new URL(candidate);
    if (url.protocol !== "https:") return null;
    const hostname = url.hostname.toLowerCase();
    if (hostname === "localhost" || hostname.endsWith(".local") || hostname === "127.0.0.1" || hostname === "::1") return null;
    if (Array.isArray(allowedHosts) && !allowedHosts.some((host) => hostname === host || hostname.endsWith(`.${host}`))) return null;
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

export function normalizeComparableText(value) {
  return cleanText(value, 4000)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function stableFingerprint(...values) {
  const input = normalizeComparableText(values.flat().filter(Boolean).join(" | "));
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `r${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

export function inferAtinaraCategory(...values) {
  const text = normalizeComparableText(values.flat().filter(Boolean).join(" "));
  let selected = "Industria";
  let matches = 0;
  for (const [category, terms] of Object.entries(CATEGORY_TERMS)) {
    const current = terms.filter((term) => text.includes(normalizeComparableText(term))).length;
    if (current > matches) {
      selected = category;
      matches = current;
    }
  }
  return selected;
}

export function isGamingRelated(...values) {
  const text = normalizeComparableText(values.flat().filter(Boolean).join(" "));
  return GAMING_TERMS.some((term) => text.includes(normalizeComparableText(term)));
}

export function containsBlockedTopic(...values) {
  const text = normalizeComparableText(values.flat().filter(Boolean).join(" "));
  return BLOCKED_TERMS.some((term) => text.includes(normalizeComparableText(term)));
}

export function midpointProbability(bid, ask, last) {
  const bidValue = safeProbability(bid);
  const askValue = safeProbability(ask);
  const lastValue = safeProbability(last);
  if (bidValue !== null && askValue !== null) return (bidValue + askValue) / 2;
  return lastValue ?? bidValue ?? askValue;
}

function parseJsonArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parsePolymarketOutcomes(record) {
  const outcomes = parseJsonArray(record.outcomes);
  const prices = parseJsonArray(record.outcomePrices).map(safeProbability);
  const yesIndex = outcomes.findIndex((item) => /^yes$|^sí$/i.test(cleanText(item, 40)));
  const probability = yesIndex >= 0 ? prices[yesIndex] : prices[0];
  return { outcomes: outcomes.map((item) => cleanText(item, 80)).filter(Boolean), probability: probability ?? null };
}

function verificationExpiry(now, minutes = 360) {
  return new Date(new Date(now).getTime() + Math.max(5, minutes) * 60_000).toISOString();
}

function baseCandidate(provider, externalId, input, now, cacheMinutes) {
  const title = cleanText(input.title ?? input.question, 500);
  const description = cleanText(input.description, 3000);
  const category = inferAtinaraCategory(title, description, input.category, input.tags);
  const warnings = [];
  if (!title) warnings.push("Falta una pregunta legible.");
  if (!isGamingRelated(title, description, input.category, input.tags)) warnings.push("No se ha confirmado relación suficiente con videojuegos.");
  if (containsBlockedTopic(title, description)) warnings.push("El tema no es apto para el catálogo de Atinara.");
  if (SUBJECTIVE_TERMS.some((term) => normalizeComparableText(title).includes(normalizeComparableText(term)))) warnings.push("La formulación puede ser subjetiva y necesita una métrica explícita.");

  const closeAt = safeIsoDate(input.close_at ?? input.end_date);
  const originalUrl = safePublicUrl(input.external_market_url ?? input.external_url, PROVIDER_PUBLIC_HOSTS[provider] ?? null);
  const eventUrl = safePublicUrl(input.external_event_url, PROVIDER_PUBLIC_HOSTS[provider] ?? null);
  const resolutionUrl = safePublicUrl(input.resolution_url);
  const eventKey = cleanText(input.event_group_key, 240) || `${provider}:${cleanText(input.external_event_id ?? externalId, 180)}`;
  const probability = safeProbability(input.probability);
  if (probability !== null && (probability <= 1.5 || probability >= 98.5)) warnings.push("Probabilidad extrema: confirma que el mercado sigue siendo útil y abierto.");

  const expiresAt = verificationExpiry(now, cacheMinutes);
  return {
    provider,
    external_id: cleanText(externalId, 220),
    external_event_id: cleanText(input.external_event_id ?? externalId, 220) || null,
    external_market_id: cleanText(input.external_market_id ?? externalId, 220) || null,
    external_event_slug: cleanText(input.external_event_slug, 400) || null,
    external_market_slug: cleanText(input.external_market_slug, 400) || null,
    event_group_key: eventKey,
    source_title: title,
    source_question: cleanText(input.question ?? title, 700),
    source_description: description || null,
    source_category: cleanText(input.category, 160) || null,
    source_tags: safeStringArray(input.tags, 30),
    source_close_at: closeAt,
    source_resolution_deadline: safeIsoDate(input.resolution_deadline),
    source_probability: probability,
    source_probability_yes: probability,
    source_volume: safeNumber(input.volume),
    source_volume_total: safeNumber(input.volume),
    source_liquidity: safeNumber(input.liquidity),
    source_status: cleanText(input.status, 80).toLowerCase() || null,
    source_resolution_rules: cleanText(input.resolution_rules, 5000) || null,
    source_resolution_url: resolutionUrl,
    external_url: originalUrl || eventUrl,
    external_event_url: eventUrl,
    external_market_url: originalUrl,
    provider_payload: isRecord(input.provider_payload) ? input.provider_payload : {},
    atinara_question: cleanText(input.atinara_question ?? input.question ?? title, 700),
    atinara_category: RADAR_CATEGORIES.includes(input.atinara_category) ? input.atinara_category : category,
    atinara_resolution_criteria: cleanText(input.atinara_resolution_criteria ?? input.resolution_rules, 5000) || null,
    atinara_resolution_source_url: resolutionUrl,
    warnings,
    hard_reject_reasons: [],
    duplicate_matches: [],
    verification_status: "pending",
    verification_reason_code: RADAR_REASON_CODES.VERIFICATION_REQUIRED,
    verification_reason: REASON_COPY.VERIFICATION_REQUIRED,
    verified_at: null,
    verification_expires_at: null,
    verification_evidence: [],
    verification_confidence: 0,
    quality_score: 0,
    quality_status: "needs_review",
    score_breakdown: {},
    state: "needs_review",
    fingerprint: stableFingerprint(provider, eventKey, title, input.question),
    fetched_at: now,
    first_seen_at: now,
    last_seen_at: now,
    expires_at: expiresAt,
    cache_expires_at: expiresAt,
    normalizer_version: RADAR_NORMALIZER_VERSION,
  };
}

function providerIsOpen(status) {
  return ["open", "active", "trading", "initialized"].includes(cleanText(status, 80).toLowerCase());
}

export function adaptPolymarketResponse(payload, options = {}) {
  const now = options.now ?? new Date().toISOString();
  const cacheMinutes = options.cacheMinutes ?? 360;
  const events = Array.isArray(payload) ? payload : Array.isArray(payload?.events) ? payload.events : [];
  const output = [];
  for (const eventValue of events) {
    if (!isRecord(eventValue)) continue;
    const event = eventValue;
    const markets = Array.isArray(event.markets) ? event.markets : [event];
    const eventId = cleanText(event.id ?? event.eventId ?? event.slug, 220);
    const eventSlug = cleanText(event.slug, 400);
    const eventUrl = eventSlug ? safePublicUrl(`https://polymarket.com/event/${encodeURIComponent(eventSlug)}`, PROVIDER_PUBLIC_HOSTS.polymarket) : null;
    const eventValidated = event.canonical_url_verified === true || options.canonicalUrlVerified === true;
    for (const marketValue of markets) {
      if (!isRecord(marketValue)) continue;
      const market = marketValue;
      const marketId = cleanText(market.id ?? market.conditionId ?? market.slug, 220);
      if (!marketId) continue;
      const marketSlug = cleanText(market.slug, 400);
      const parsed = parsePolymarketOutcomes(market);
      const providerClosed = market.closed === true
        || event.closed === true
        || market.archived === true
        || event.archived === true
        || market.acceptingOrders === false
        || event.acceptingOrders === false;
      const status = providerClosed ? "closed" : market.active === false || event.active === false ? "inactive" : "open";
      const candidate = baseCandidate("polymarket", `polymarket:${marketId}`, {
        title: event.title ?? market.question,
        question: market.question ?? event.title,
        description: market.description ?? event.description,
        category: event.category ?? market.category,
        tags: [event.category, market.category, ...(Array.isArray(event.tags) ? event.tags.map((tag) => tag?.label ?? tag) : [])],
        close_at: market.endDate ?? event.endDate,
        probability: parsed.probability,
        volume: market.volumeNum ?? market.volume ?? event.volume,
        liquidity: market.liquidityNum ?? market.liquidity ?? event.liquidity,
        status,
        resolution_rules: market.description ?? event.description,
        resolution_url: market.resolutionSource ?? event.resolutionSource,
        external_event_id: eventId,
        external_market_id: marketId,
        external_event_slug: eventSlug,
        external_market_slug: marketSlug,
        event_group_key: `polymarket:${eventId || eventSlug}`,
        external_event_url: eventValidated ? eventUrl : null,
        external_market_url: eventValidated ? eventUrl : null,
        provider_payload: {
          event_id: eventId,
          event_slug: eventSlug,
          market_id: marketId,
          market_slug: marketSlug,
          condition_id: cleanText(market.conditionId, 220) || null,
          outcomes: parsed.outcomes,
          canonical_url_verified: eventValidated,
        },
      }, now, cacheMinutes);
      const closeMs = Date.parse(candidate.source_close_at ?? "");
      const nowMs = Date.parse(now);
      if (!providerIsOpen(status) || (Number.isFinite(closeMs) && Number.isFinite(nowMs) && closeMs <= nowMs)) {
        candidate.hard_reject_reasons.push(RADAR_REASON_CODES.PROVIDER_NOT_OPEN);
      }
      if (!eventValidated || !eventUrl) candidate.hard_reject_reasons.push(RADAR_REASON_CODES.INVALID_OR_UNVERIFIED_SOURCE);
      output.push(candidate);
    }
  }
  return output;
}

function kalshiProbability(market) {
  const yesBid = safeNumber(market.yes_bid_dollars ?? market.yes_bid);
  const yesAsk = safeNumber(market.yes_ask_dollars ?? market.yes_ask);
  const last = safeNumber(market.last_price_dollars ?? market.last_price);
  return midpointProbability(yesBid, yesAsk, last);
}

export function adaptKalshiResponse(payload, options = {}) {
  const now = options.now ?? new Date().toISOString();
  const cacheMinutes = options.cacheMinutes ?? 360;
  const events = Array.isArray(payload?.events) ? payload.events : [];
  const flatMarkets = Array.isArray(payload?.markets) ? payload.markets : [];
  const records = events.length
    ? events.flatMap((event) => (Array.isArray(event?.markets) ? event.markets : []).map((market) => ({ event, market })))
    : flatMarkets.map((market) => ({ event: market?._event ?? market?.event ?? {}, market }));
  const output = [];

  for (const item of records) {
    if (!isRecord(item.market)) continue;
    const market = item.market;
    const event = isRecord(item.event) ? item.event : {};
    const ticker = cleanText(market.ticker ?? market.market_ticker, 220);
    if (!ticker) continue;
    const eventTicker = cleanText(event.event_ticker ?? event.ticker ?? market.event_ticker ?? market.series_ticker, 220);
    const eventUrl = safePublicUrl(event.external_event_url ?? market.external_event_url, PROVIDER_PUBLIC_HOSTS.kalshi);
    const marketUrl = safePublicUrl(market.external_market_url ?? event.external_market_url, PROVIDER_PUBLIC_HOSTS.kalshi);
    const urlVerified = event.canonical_url_verified === true || market.canonical_url_verified === true;
    const status = cleanText(market.status ?? event.status, 80).toLowerCase();
    const rules = cleanText(market.rules_primary ?? market.rules_summary ?? event.rules_primary ?? event.sub_title, 5000);
    const rawResolutionSources = Array.isArray(market.settlement_sources)
      ? market.settlement_sources
      : Array.isArray(event.settlement_sources) ? event.settlement_sources : [];
    const resolutionSources = [...new Set(rawResolutionSources
      .map((source) => safePublicUrl(isRecord(source) ? source.url : source))
      .filter(Boolean))].slice(0, 10);
    const candidate = baseCandidate("kalshi", `kalshi:${ticker}`, {
      title: event.title ?? market.title,
      question: market.title ?? event.title,
      description: market.subtitle ?? event.sub_title ?? event.title,
      category: event.category ?? market.category ?? options.category,
      tags: [event.category, event.series_ticker, market.series_ticker, ...(Array.isArray(event.tags) ? event.tags : [])],
      close_at: market.close_time ?? market.expected_expiration_time ?? event.expected_expiration_time,
      resolution_deadline: market.expiration_time ?? market.latest_expiration_time,
      probability: kalshiProbability(market),
      volume: market.volume_fp ?? market.volume ?? event.volume_fp ?? event.volume,
      liquidity: market.liquidity_dollars ?? market.liquidity ?? event.liquidity,
      status,
      resolution_rules: rules,
      resolution_url: resolutionSources[0] ?? market.rules_url ?? event.rules_url,
      external_event_id: eventTicker,
      external_market_id: ticker,
      external_event_slug: cleanText(event.slug, 400),
      external_market_slug: cleanText(market.slug, 400),
      event_group_key: `kalshi:${eventTicker || ticker}`,
      external_event_url: urlVerified ? eventUrl : null,
      external_market_url: urlVerified ? (marketUrl ?? eventUrl) : null,
      provider_payload: {
        event_ticker: eventTicker,
        market_ticker: ticker,
        series_ticker: cleanText(event.series_ticker ?? market.series_ticker, 220) || null,
        market_type: cleanText(market.market_type, 80) || null,
        yes_sub_title: cleanText(market.yes_sub_title, 500) || null,
        no_sub_title: cleanText(market.no_sub_title, 500) || null,
        settlement_sources: resolutionSources,
        canonical_url_verified: urlVerified,
      },
    }, now, cacheMinutes);
    const marketType = cleanText(market.market_type, 80).toLowerCase();
    if (marketType && !["binary", "yes_no"].includes(marketType)) candidate.hard_reject_reasons.push(RADAR_REASON_CODES.EVENT_OUTSIDE_CONTRACT);
    const closeMs = Date.parse(candidate.source_close_at ?? "");
    const nowMs = Date.parse(now);
    if (!providerIsOpen(status) || (Number.isFinite(closeMs) && Number.isFinite(nowMs) && closeMs <= nowMs)) {
      candidate.hard_reject_reasons.push(RADAR_REASON_CODES.PROVIDER_NOT_OPEN);
    }
    if (!urlVerified || !(marketUrl || eventUrl)) candidate.hard_reject_reasons.push(RADAR_REASON_CODES.INVALID_OR_UNVERIFIED_SOURCE);
    output.push(candidate);
  }
  return output;
}

export function adaptTavilyResults(payload, options = {}) {
  const now = options.now ?? new Date().toISOString();
  const results = Array.isArray(payload?.results) ? payload.results : [];
  return results.filter(isRecord).map((result, index) => baseCandidate("tavily", `tavily:${stableFingerprint(result.url, result.title, index)}`, {
    title: result.title,
    question: result.title,
    description: result.content,
    category: options.category,
    tags: [options.query, options.category],
    close_at: result.published_date,
    probability: null,
    volume: null,
    liquidity: safeNumber(result.score),
    status: "research",
    resolution_url: result.url,
    external_market_url: result.url,
    external_event_url: result.url,
    external_event_id: stableFingerprint(result.url),
    event_group_key: `tavily:${stableFingerprint(result.url)}`,
    provider_payload: { score: safeNumber(result.score), published_date: safeIsoDate(result.published_date) },
  }, now, options.cacheMinutes ?? 180));
}

export function detectDuplicates(candidate, existing = []) {
  const source = normalizeComparableText(candidate.atinara_question ?? candidate.source_question);
  if (!source) return [];
  const tokens = new Set(source.split(" ").filter((token) => token.length > 2));
  const matches = [];
  for (const item of existing) {
    const target = normalizeComparableText(item.question ?? item.title ?? item.atinara_question);
    if (!target) continue;
    const targetTokens = new Set(target.split(" ").filter((token) => token.length > 2));
    const intersection = [...tokens].filter((token) => targetTokens.has(token)).length;
    const union = new Set([...tokens, ...targetTokens]).size || 1;
    const similarity = intersection / union;
    if (source === target || similarity >= 0.72) {
      matches.push({ id: cleanText(item.id, 220) || null, question: cleanText(item.question ?? item.title, 500), similarity: Number(similarity.toFixed(3)) });
    }
  }
  return matches.slice(0, 5);
}

function popularityMetric(candidate) {
  const volume = Math.max(0, safeNumber(candidate.source_volume) ?? 0);
  const liquidity = Math.max(0, safeNumber(candidate.source_liquidity) ?? 0);
  return Math.min(20, Math.round((Math.log10(volume + 1) * 3.2) + (Math.log10(liquidity + 1) * 2.2)));
}

function relevanceScore(candidate) {
  return isGamingRelated(candidate.source_title, candidate.source_question, candidate.source_description, candidate.source_category, candidate.source_tags) ? 20 : 0;
}

function clarityScore(candidate) {
  let score = 4;
  if (candidate.source_question?.includes("?")) score += 3;
  if (candidate.source_close_at) score += 4;
  if (candidate.source_resolution_rules) score += 5;
  if (candidate.source_resolution_url || candidate.atinara_resolution_source_url) score += 4;
  if (!candidate.warnings?.some((warning) => /subjetiv|binari|resolv/i.test(warning))) score += 2;
  return Math.min(20, score);
}

function recencyScore(candidate, now) {
  const closeMs = Date.parse(candidate.source_close_at ?? "");
  const nowMs = Date.parse(now);
  if (!Number.isFinite(closeMs) || !Number.isFinite(nowMs)) return 1;
  const days = (closeMs - nowMs) / 86_400_000;
  return days < 0 ? 0 : days <= 180 ? 10 : days <= 365 ? 7 : 4;
}

function uncertaintyScore(candidate) {
  const probability = safeProbability(candidate.source_probability);
  if (probability === null) return 2;
  return Math.max(0, Math.round(10 - (Math.abs(50 - probability) / 5)));
}

export function scoreCandidates(candidates, existing = [], now = new Date().toISOString()) {
  return candidates.map((candidate) => {
    const duplicateMatches = detectDuplicates(candidate, existing);
    const popularity = popularityMetric(candidate);
    const relevance = relevanceScore(candidate);
    const clarity = clarityScore(candidate);
    const recency = recencyScore(candidate, now);
    const uncertainty = uncertaintyScore(candidate);
    const novelty = duplicateMatches.length ? 0 : 20;
    const verification = Math.max(0, Math.min(100, safeNumber(candidate.verification_confidence) ?? 0));
    const total = popularity + relevance + clarity + recency + uncertainty + novelty;
    const hardReasons = [...new Set([...(candidate.hard_reject_reasons ?? []), ...(duplicateMatches.length ? [RADAR_REASON_CODES.DUPLICATE_MARKET] : [])])];
    return {
      ...candidate,
      duplicate_matches: duplicateMatches,
      hard_reject_reasons: hardReasons,
      quality_score: total,
      score_breakdown: { popularity, relevance, clarity, recency, uncertainty, novelty, verification },
    };
  }).sort((left, right) => right.quality_score - left.quality_score);
}

export function reasonCopy(code) {
  return REASON_COPY[cleanText(code, 100)] ?? "La candidata no cumple todavía las condiciones para preparar un borrador.";
}

export function evaluateDeterministicEligibility(candidate, facts = {}, now = new Date().toISOString()) {
  const question = normalizeComparableText(candidate.atinara_question ?? candidate.source_question ?? candidate.source_title);
  const nowMs = Date.parse(now);
  const closeMs = Date.parse(candidate.source_close_at ?? "");
  const resolvedMs = Date.parse(facts.event_resolved_at ?? facts.official_reveal_at ?? "");
  const releaseMs = Date.parse(facts.release_at ?? "");
  const asksAnnouncement = /\bannounce|\banunci|\breveal|\bpresent/.test(question);
  const assumesProduct = /release|launch|lanz|review|metacritic|game of the year|goty|win|ganar|cover|portada/.test(question);
  if (Number.isFinite(resolvedMs) && Number.isFinite(nowMs) && resolvedMs <= nowMs) {
    return { eligible: false, conclusive: true, reason_code: RADAR_REASON_CODES.EVENT_ALREADY_RESOLVED, reason: reasonCopy(RADAR_REASON_CODES.EVENT_ALREADY_RESOLVED), confidence: 100 };
  }
  if (Number.isFinite(releaseMs) && Number.isFinite(closeMs) && releaseMs > closeMs && /review|metacritic|award|premio|game of the year|goty|win|ganar/.test(question)) {
    return { eligible: false, conclusive: true, reason_code: RADAR_REASON_CODES.EVENT_OUTSIDE_CONTRACT, reason: reasonCopy(RADAR_REASON_CODES.EVENT_OUTSIDE_CONTRACT), confidence: 100 };
  }
  if (facts.subject_announced === false && assumesProduct && !asksAnnouncement) {
    return { eligible: false, conclusive: true, reason_code: RADAR_REASON_CODES.SUBJECT_NOT_ANNOUNCED, reason: reasonCopy(RADAR_REASON_CODES.SUBJECT_NOT_ANNOUNCED), confidence: 100 };
  }
  if (facts.temporal_coherence === false) {
    return { eligible: false, conclusive: true, reason_code: RADAR_REASON_CODES.TEMPORAL_INCOHERENCE, reason: reasonCopy(RADAR_REASON_CODES.TEMPORAL_INCOHERENCE), confidence: 100 };
  }
  return null;
}

export function applyEligibilityDecision(candidate, decision = {}, now = new Date().toISOString()) {
  const hardReasons = [...new Set(candidate.hard_reject_reasons ?? [])];
  const requestedFactualCode = cleanText(decision.reason_code, 100);
  const factualCode = Object.values(RADAR_REASON_CODES).includes(requestedFactualCode)
    ? requestedFactualCode
    : RADAR_REASON_CODES.VERIFICATION_REQUIRED;
  const conclusiveFactualRejection = decision.eligible === false
    && decision.conclusive === true
    && factualCode !== RADAR_REASON_CODES.VERIFICATION_REQUIRED;
  if (conclusiveFactualRejection) hardReasons.push(factualCode);
  const duplicate = hardReasons.includes(RADAR_REASON_CODES.DUPLICATE_MARKET);
  const mappedStatus = hardReasons.includes(RADAR_REASON_CODES.EVENT_ALREADY_RESOLVED) ? "rejected_resolved"
    : hardReasons.includes(RADAR_REASON_CODES.SOURCE_STALE) ? "rejected_stale"
    : hardReasons.includes(RADAR_REASON_CODES.SUBJECT_NOT_ANNOUNCED) ? "rejected_unannounced"
    : hardReasons.includes(RADAR_REASON_CODES.TEMPORAL_INCOHERENCE) ? "rejected_incoherent"
    : hardReasons.includes(RADAR_REASON_CODES.INVALID_OR_UNVERIFIED_SOURCE) || hardReasons.includes(RADAR_REASON_CODES.PROVIDER_EVENT_NOT_FOUND) || hardReasons.includes(RADAR_REASON_CODES.PROVIDER_CHILD_NOT_FOUND) ? "rejected_invalid_source"
    : duplicate ? "rejected_duplicate"
    : hardReasons.length ? "rejected_ineligible"
    : decision.eligible === true && decision.conclusive === true ? "verified_open"
    : "needs_review";
  const primaryCode = mappedStatus === "verified_open" ? null
    : mappedStatus === "needs_review" ? RADAR_REASON_CODES.VERIFICATION_REQUIRED
      : mappedStatus === "rejected_resolved" ? RADAR_REASON_CODES.EVENT_ALREADY_RESOLVED
        : mappedStatus === "rejected_stale" ? RADAR_REASON_CODES.SOURCE_STALE
          : mappedStatus === "rejected_unannounced" ? RADAR_REASON_CODES.SUBJECT_NOT_ANNOUNCED
            : mappedStatus === "rejected_incoherent" ? RADAR_REASON_CODES.TEMPORAL_INCOHERENCE
              : mappedStatus === "rejected_invalid_source" ? RADAR_REASON_CODES.INVALID_OR_UNVERIFIED_SOURCE
                : mappedStatus === "rejected_duplicate" ? RADAR_REASON_CODES.DUPLICATE_MARKET
                  : conclusiveFactualRejection ? factualCode
                    : hardReasons[0] ?? RADAR_REASON_CODES.VERIFICATION_REQUIRED;
  const evidence = Array.isArray(decision.evidence) ? decision.evidence.filter(isRecord).slice(0, 20).map((item) => ({
    title: cleanText(item.title, 300),
    url: safePublicUrl(item.url),
    published_at: safeIsoDate(item.published_at),
    source_type: cleanText(item.source_type, 80) || "secondary",
    supports: cleanText(item.supports, 500),
  })).filter((item) => item.url) : [];
  return {
    ...candidate,
    hard_reject_reasons: [...new Set(hardReasons)],
    verification_status: mappedStatus,
    verification_reason_code: primaryCode,
    verification_reason: cleanText(decision.reason, 1000) || (primaryCode ? reasonCopy(primaryCode) : "Verificación factual superada."),
    verified_at: now,
    verification_expires_at: verificationExpiry(now, safeNumber(decision.ttl_minutes) ?? 360),
    verification_evidence: evidence,
    verification_confidence: Math.max(0, Math.min(100, safeNumber(decision.confidence) ?? (mappedStatus === "verified_open" ? 85 : 0))),
    quality_status: mappedStatus === "verified_open" ? "fit" : mappedStatus === "needs_review" ? "needs_review" : "rejected",
    state: mappedStatus === "verified_open" ? "available" : mappedStatus === "needs_review" ? "needs_review" : "rejected",
  };
}

export function groupCandidates(candidates = []) {
  const groups = new Map();
  for (const candidate of candidates) {
    const key = cleanText(candidate.event_group_key, 240) || `${candidate.provider}:${candidate.external_event_id ?? candidate.external_id}`;
    if (!groups.has(key)) groups.set(key, { event_group_key: key, provider: candidate.provider, candidates: [] });
    groups.get(key).candidates.push(candidate);
  }
  return [...groups.values()].map((group) => {
    const sorted = group.candidates.sort((a, b) => (b.quality_score ?? 0) - (a.quality_score ?? 0));
    const lead = sorted[0];
    return {
      ...group,
      external_event_id: lead?.external_event_id ?? null,
      external_event_slug: lead?.external_event_slug ?? null,
      external_event_url: lead?.external_event_url ?? lead?.external_url ?? null,
      title: lead?.source_title ?? lead?.source_question ?? "Evento externo",
      category: lead?.atinara_category ?? lead?.source_category ?? "Industria",
      verification_status: sorted.some((item) => item.verification_status === "verified_open") ? "verified_open" : lead?.verification_status ?? "needs_review",
      quality_score: Math.max(...sorted.map((item) => safeNumber(item.quality_score) ?? 0), 0),
      child_count: sorted.length,
      candidates: sorted,
      top_candidates: sorted.filter((item) => !RADAR_REJECTED_STATUSES.includes(item.verification_status)).slice(0, 3),
    };
  }).sort((a, b) => b.quality_score - a.quality_score);
}

export function buildGeminiCandidateBatches(candidates = [], options = {}) {
  const maxGroups = Math.max(1, Math.floor(safeNumber(options.maxGroups) ?? 20));
  const maxCandidates = Math.max(1, Math.floor(safeNumber(options.maxCandidates) ?? 126));
  const batchSize = Math.max(1, Math.floor(safeNumber(options.batchSize) ?? 14));
  const selected = groupCandidates(candidates)
    .slice(0, maxGroups)
    .flatMap((group) => group.candidates)
    .slice(0, maxCandidates);
  const selectedSet = new Set(selected);
  const byProvider = new Map();
  for (const candidate of selected) {
    const provider = cleanText(candidate.provider, 40) || "radar";
    if (!byProvider.has(provider)) byProvider.set(provider, []);
    byProvider.get(provider).push(candidate);
  }
  const batches = [];
  for (const providerCandidates of byProvider.values()) {
    for (let start = 0; start < providerCandidates.length; start += batchSize) {
      batches.push(providerCandidates.slice(start, start + batchSize));
    }
  }
  return {
    batches,
    deferred: candidates.filter((candidate) => !selectedSet.has(candidate)),
  };
}

export function diversifyGroups(groups = [], limit = 60) {
  const providerCounts = new Map();
  const categoryCounts = new Map();
  return [...groups]
    .sort((a, b) => {
      const penaltyA = (providerCounts.get(a.provider) ?? 0) * 2 + (categoryCounts.get(a.category) ?? 0);
      const penaltyB = (providerCounts.get(b.provider) ?? 0) * 2 + (categoryCounts.get(b.category) ?? 0);
      return (b.quality_score - penaltyB) - (a.quality_score - penaltyA);
    })
    .slice(0, limit)
    .map((group) => {
      providerCounts.set(group.provider, (providerCounts.get(group.provider) ?? 0) + 1);
      categoryCounts.set(group.category, (categoryCounts.get(group.category) ?? 0) + 1);
      return group;
    });
}

export function summarizeRejections(candidates = []) {
  const counts = {};
  const items = candidates.filter((item) => RADAR_REJECTED_STATUSES.includes(item.verification_status));
  for (const item of items) {
    const code = item.verification_reason_code ?? "UNKNOWN";
    counts[code] = (counts[code] ?? 0) + 1;
  }
  return { total: items.length, counts, items };
}

export function compactGeminiCandidate(candidate) {
  if (!isRecord(candidate)) return null;
  return {
    external_id: cleanText(candidate.external_id, 220),
    event_group_key: cleanText(candidate.event_group_key, 240),
    provider: cleanText(candidate.provider, 40),
    title: cleanText(candidate.source_title, 500),
    question: cleanText(candidate.source_question, 700),
    description: cleanText(candidate.source_description, 700),
    close_at: safeIsoDate(candidate.source_close_at),
    category: cleanText(candidate.source_category, 160),
    probability: safeProbability(candidate.source_probability),
    resolution_rules: cleanText(candidate.source_resolution_rules, 1000),
    resolution_source_url: safePublicUrl(candidate.source_resolution_url),
    external_event_url: safePublicUrl(candidate.external_event_url),
    external_market_url: safePublicUrl(candidate.external_market_url),
    deterministic_reasons: safeStringArray(candidate.hard_reject_reasons, 20),
  };
}

export function compactGeminiDefinition(item) {
  if (!isRecord(item)) return null;
  return { id: cleanText(item.id, 220), question: cleanText(item.question ?? item.title, 700), category: cleanText(item.category, 120), close_at: safeIsoDate(item.close_at) };
}

export function parseGeminiAdaptations(payload) {
  const direct = Array.isArray(payload?.candidates) ? payload.candidates : Array.isArray(payload) ? payload : [];
  if (direct.length && direct.every((item) => isRecord(item) && !(item.content?.parts))) return direct.filter(isRecord);
  const parts = Array.isArray(payload?.candidates?.[0]?.content?.parts) ? payload.candidates[0].content.parts : [];
  const text = parts.length
    ? parts.filter((part) => isRecord(part) && part.thought !== true).map((part) => cleanText(part.text, 100_000)).join("")
    : payload?.text;
  if (typeof text !== "string") return [];
  try {
    const parsed = JSON.parse(text.replace(/^```json\s*|\s*```$/g, ""));
    return (Array.isArray(parsed) ? parsed : parsed?.candidates ?? []).filter(isRecord);
  } catch {
    return [];
  }
}

export function indexGeminiDecisions(decisions = [], candidateCount = 0) {
  const limit = Math.max(0, Math.floor(safeNumber(candidateCount) ?? 0));
  const indexed = new Map();
  for (const decision of Array.isArray(decisions) ? decisions : []) {
    if (!isRecord(decision)) continue;
    const candidateIndex = decision.candidate_index;
    if (!Number.isInteger(candidateIndex) || candidateIndex < 0 || candidateIndex >= limit || indexed.has(candidateIndex)) continue;
    indexed.set(candidateIndex, decision);
  }
  return indexed;
}

export function canReuseRadarVerification(cached, candidate, now = new Date().toISOString()) {
  if (!isRecord(cached) || !isRecord(candidate)) return false;
  if (cleanText(cached.normalizer_version, 80) !== RADAR_NORMALIZER_VERSION) return false;
  if (cleanText(cached.fingerprint, 120) !== cleanText(candidate.fingerprint, 120)) return false;
  if (cleanText(cached.verification_status, 80) === "needs_review") return false;
  if (cleanText(cached.verification_reason_code, 100) === RADAR_REASON_CODES.VERIFICATION_REQUIRED) return false;
  if (cleanText(cached.verification_status, 80) === "verified_open" && !isAdaptedIdeaComplete(cached)) return false;
  const expiresAt = Date.parse(cleanText(cached.verification_expires_at, 100));
  const nowMs = Date.parse(now);
  return Number.isFinite(expiresAt) && Number.isFinite(nowMs) && expiresAt > nowMs;
}

export function selectVerifiedResolutionUrl(candidate, evidence = []) {
  const existing = safePublicUrl(candidate?.atinara_resolution_source_url ?? candidate?.source_resolution_url);
  if (existing) return existing;
  const official = (Array.isArray(evidence) ? evidence : [])
    .find((item) => isRecord(item) && cleanText(item.source_type, 80) === "official" && safePublicUrl(item.url));
  return safePublicUrl(official?.url);
}

export function detectOfficialCoverEventResolution(candidates = [], evidence = []) {
  const source = Array.isArray(candidates) ? candidates : [];
  const parsed = source.map((candidate) => {
    const question = normalizeComparableText(candidate?.source_question ?? candidate?.atinara_question);
    const match = question.match(/^will (.+?) be (?:on )?the cover of (.+)$/);
    return match ? { name: match[1], subject: match[2] } : null;
  });
  if (source.length < 2 || parsed.some((item) => !item)) return null;
  const subjects = new Set(parsed.map((item) => item.subject));
  if (subjects.size !== 1) return null;
  const subject = parsed[0].subject;
  const matchedNames = new Map();
  const relevantEvidence = [];
  for (const item of Array.isArray(evidence) ? evidence : []) {
    if (!isRecord(item) || cleanText(item.source_type, 80) !== "official" || !safePublicUrl(item.url)) continue;
    const text = normalizeComparableText(`${item.title ?? ""} ${item.supports ?? ""}`);
    if (!text.includes(subject)) continue;
    const windows = [];
    let coverIndex = text.indexOf("cover");
    while (coverIndex >= 0) {
      windows.push(text.slice(Math.max(0, coverIndex - 180), coverIndex + 220));
      coverIndex = text.indexOf("cover", coverIndex + 5);
    }
    for (const candidate of parsed) {
      if (windows.some((window) => window.includes(subject) && window.includes(candidate.name))) {
        matchedNames.set(candidate.name, candidate.name);
        if (!relevantEvidence.includes(item)) relevantEvidence.push(item);
      }
    }
  }
  if (matchedNames.size !== 1 || !relevantEvidence.length) return null;
  return {
    winner_name: [...matchedNames.values()][0].split(" ").map((part) => part ? part[0].toUpperCase() + part.slice(1) : part).join(" "),
    evidence: relevantEvidence.slice(0, 6),
  };
}

export function buildCoverResolutionSignals(candidates = [], now = new Date().toISOString()) {
  const signals = [];
  for (const group of groupCandidates(candidates)) {
    const title = normalizeComparableText(group.title);
    if (!/\bcover\b|\bportada\b/.test(title) || group.candidates.length < 2) continue;
    const resolved = group.candidates.filter((candidate) => candidate.verification_status === "rejected_resolved"
      && (safeNumber(candidate.verification_confidence) ?? 0) >= 85
      && Array.isArray(candidate.verification_evidence)
      && candidate.verification_evidence.some((item) => isRecord(item) && cleanText(item.source_type, 80) === "official" && safePublicUrl(item.url)));
    if (resolved.length < 2 || resolved.length / group.candidates.length < 0.75) continue;
    const evidenceByUrl = new Map();
    for (const candidate of resolved) {
      for (const item of candidate.verification_evidence) {
        const url = isRecord(item) ? safePublicUrl(item.url) : null;
        if (url && cleanText(item.source_type, 80) === "official" && !evidenceByUrl.has(url)) evidenceByUrl.set(url, item);
      }
    }
    const evidence = [...evidenceByUrl.values()].slice(0, 6);
    if (!evidence.length) continue;
    const strongest = [...resolved].sort((left, right) => (safeNumber(right.verification_confidence) ?? 0) - (safeNumber(left.verification_confidence) ?? 0))[0];
    for (const candidate of group.candidates) {
      signals.push({
        event_group_key: group.event_group_key,
        candidate_identity: `${cleanText(candidate.provider, 40)}:${cleanText(candidate.external_id, 220)}`,
        resolved_at: now,
        reason: cleanText(strongest.verification_reason, 1000) || reasonCopy(RADAR_REASON_CODES.EVENT_ALREADY_RESOLVED),
        confidence: safeNumber(strongest.verification_confidence) ?? 100,
        ttl_minutes: 360,
        evidence,
      });
    }
  }
  return signals;
}

export function applyAdaptation(candidate, adaptation) {
  if (!isRecord(adaptation)) return candidate;
  const category = RADAR_CATEGORIES.includes(cleanText(adaptation.atinara_category, 80)) ? cleanText(adaptation.atinara_category, 80) : candidate.atinara_category;
  const resolutionSourceUrl = safePublicUrl(adaptation.atinara_resolution_source_url) ?? safePublicUrl(candidate.atinara_resolution_source_url ?? candidate.source_resolution_url);
  return {
    ...candidate,
    atinara_question: cleanText(adaptation.atinara_question, 700) || candidate.atinara_question,
    atinara_category: category,
    atinara_resolution_criteria: cleanText(adaptation.atinara_resolution_criteria, 5000) || candidate.atinara_resolution_criteria,
    atinara_resolution_source_url: resolutionSourceUrl,
    warnings: [...new Set([...(candidate.warnings ?? []), ...safeStringArray(adaptation.warnings, 20)])],
  };
}

export function propagateResolvedEventGroups(candidates = [], resolutions = [], now = new Date().toISOString()) {
  const groupSizes = new Map();
  for (const candidate of Array.isArray(candidates) ? candidates : []) {
    const eventGroupKey = cleanText(candidate?.event_group_key, 240);
    if (eventGroupKey) groupSizes.set(eventGroupKey, (groupSizes.get(eventGroupKey) ?? 0) + 1);
  }
  const signalsByGroup = new Map();
  for (const resolution of Array.isArray(resolutions) ? resolutions : []) {
    if (!isRecord(resolution)) continue;
    const eventGroupKey = cleanText(resolution.event_group_key, 240);
    const candidateIdentity = cleanText(resolution.candidate_identity, 300);
    const evidence = Array.isArray(resolution.evidence) ? resolution.evidence.filter(isRecord) : [];
    const confidence = Math.max(0, Math.min(100, safeNumber(resolution.confidence) ?? 0));
    if (!eventGroupKey || !candidateIdentity || !safeIsoDate(resolution.resolved_at) || !evidence.length || confidence < 85) continue;
    if (!signalsByGroup.has(eventGroupKey)) signalsByGroup.set(eventGroupKey, new Map());
    const signals = signalsByGroup.get(eventGroupKey);
    const current = signals.get(candidateIdentity);
    if (!current || confidence > current.confidence) signals.set(candidateIdentity, { ...resolution, evidence, confidence });
  }
  const resolvedGroups = new Map();
  for (const [eventGroupKey, signals] of signalsByGroup.entries()) {
    const groupSize = groupSizes.get(eventGroupKey) ?? 0;
    if (signals.size < 2 || groupSize < 2 || signals.size / groupSize < 0.75) continue;
    const strongest = [...signals.values()].sort((left, right) => right.confidence - left.confidence)[0];
    resolvedGroups.set(eventGroupKey, strongest);
  }
  return (Array.isArray(candidates) ? candidates : []).map((candidate) => {
    const resolution = resolvedGroups.get(cleanText(candidate?.event_group_key, 240));
    if (!resolution) return candidate;
    return applyEligibilityDecision(candidate, {
      eligible: false,
      conclusive: true,
      reason_code: RADAR_REASON_CODES.EVENT_ALREADY_RESOLVED,
      reason: cleanText(resolution.reason, 1000) || reasonCopy(RADAR_REASON_CODES.EVENT_ALREADY_RESOLVED),
      confidence: resolution.confidence,
      ttl_minutes: safeNumber(resolution.ttl_minutes) ?? 360,
      evidence: resolution.evidence,
    }, now);
  });
}

export function isAdaptedIdeaComplete(candidate) {
  return Boolean(cleanText(candidate.atinara_question, 700) && RADAR_CATEGORIES.includes(candidate.atinara_category) && cleanText(candidate.atinara_resolution_criteria, 5000) && safePublicUrl(candidate.atinara_resolution_source_url ?? candidate.source_resolution_url));
}

export function buildDraftPrefill(candidate) {
  const sourceUrl = safePublicUrl(candidate.atinara_resolution_source_url ?? candidate.source_resolution_url);
  const question = cleanText(candidate.atinara_question ?? candidate.source_question, 700);
  const criteria = cleanText(candidate.atinara_resolution_criteria, 5000);
  const closeAt = safeIsoDate(candidate.source_close_at);
  const slugBase = normalizeComparableText(question).split(" ").slice(0, 10).join("-").replace(/[^a-z0-9-]/g, "").slice(0, 90);
  const fields = {
    market_slug: slugBase,
    category: RADAR_CATEGORIES.includes(candidate.atinara_category) ? candidate.atinara_category : "",
    subject: "",
    question,
    yes_option: "Sí",
    no_option: "No",
    description: cleanText(candidate.source_description, 3000),
    evaluation_period_label: "",
    evaluation_ends_at: closeAt || "",
    timezone: closeAt ? "Europe/Madrid" : "",
    resolution_deadline: safeIsoDate(candidate.source_resolution_deadline) || "",
    yes_criteria: criteria,
    no_criteria: criteria ? `No se cumple el criterio de Sí: ${criteria}` : "",
    edge_cases: "",
    public_criteria: criteria,
    primary_source_url: sourceUrl || "",
    alternative_sources: "",
    delay_treatment: "",
    cancellation_treatment: "",
    leak_treatment: "",
    rename_treatment: "",
    assumptions: "",
  };
  const origins = {};
  for (const [name, value] of Object.entries(fields)) {
    origins[name] = !value ? "missing" : ["question", "description", "yes_criteria", "no_criteria", "public_criteria", "category"].includes(name) ? "adapted" : "source";
  }
  for (const name of ["subject", "evaluation_period_label", "edge_cases", "resolution_deadline"]) {
    if (!fields[name]) origins[name] = "review";
  }
  return {
    candidate_id: cleanText(candidate.id, 220) || null,
    fields,
    origins,
    warnings: [...new Set(candidate.warnings ?? [])],
    missing_fields: Object.entries(origins).filter(([, origin]) => origin === "missing" || origin === "review").map(([name]) => name),
    auto_saved: false,
    published: false,
    approved: false,
    scheduled: false,
    provenance: {
      provider: cleanText(candidate.provider, 40),
      external_id: cleanText(candidate.external_id, 220),
      external_event_id: cleanText(candidate.external_event_id, 220),
      external_market_id: cleanText(candidate.external_market_id, 220),
      external_event_url: safePublicUrl(candidate.external_event_url),
      external_market_url: safePublicUrl(candidate.external_market_url),
      normalizer_version: candidate.normalizer_version,
      verification_status: candidate.verification_status,
      verification_reason_code: candidate.verification_reason_code,
      verified_at: candidate.verified_at,
    },
  };
}

export function buildCacheKey(filters = {}) {
  const provider = RADAR_PROVIDERS.includes(filters.provider) ? filters.provider : "all";
  const category = RADAR_CATEGORIES.includes(filters.category) ? filters.category : "all";
  const query = normalizeComparableText(filters.query ?? "").slice(0, 80) || "all";
  const horizon = cleanText(filters.horizon, 40) || "all";
  return `${RADAR_NORMALIZER_VERSION}:${provider}:${category}:${query}:${horizon}`;
}

export function publicProviderError(provider, code, status = 502) {
  const safeProvider = RADAR_PROVIDERS.includes(provider) || provider === "gemini" ? provider : "radar";
  const safeCode = cleanText(code, 100) || "PROVIDER_FAILED";
  const messages = {
    PROVIDER_NOT_CONFIGURED: "El proveedor no está configurado. El resto del Radar continúa disponible.",
    PROVIDER_RATE_LIMITED: "El proveedor ha limitado temporalmente las consultas.",
    PROVIDER_INVALID_RESPONSE: "El proveedor devolvió una respuesta que no se pudo validar.",
    PROVIDER_TIMEOUT: "El proveedor tardó demasiado en responder.",
  };
  return { provider: safeProvider, code: safeCode, status, message: messages[safeCode] ?? "No se pudo actualizar este proveedor. Puedes reintentarlo más tarde." };
}
