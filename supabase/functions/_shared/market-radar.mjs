export const RADAR_NORMALIZER_VERSION = "atinara-radar-v1";
export const RADAR_CATEGORIES = Object.freeze([
  "Lanzamientos",
  "Eventos",
  "Industria",
  "Streamers",
  "Reviews/Premios",
  "YouTubers"
]);
export const RADAR_PROVIDERS = Object.freeze(["polymarket", "kalshi", "tavily"]);
export const RADAR_API_HOSTS = Object.freeze([
  "gamma-api.polymarket.com",
  "external-api.kalshi.com",
  "api.tavily.com",
  "generativelanguage.googleapis.com"
]);

const PROVIDER_PUBLIC_HOSTS = Object.freeze({
  polymarket: ["polymarket.com", "www.polymarket.com"],
  kalshi: ["kalshi.com", "www.kalshi.com"],
  tavily: []
});
const GAMING_TERMS = [
  "video game", "videogame", "gaming", "game awards", "gamescom", "e3",
  "playstation", "xbox", "nintendo", "steam", "epic games", "riot games",
  "valorant", "league of legends", "counter-strike", "cs2", "esports",
  "twitch", "youtube gaming", "streamer", "metacritic", "game of the year",
  "goty", "developer", "publisher", "studio", "console", "dlc", "sequel",
  "videojuego", "videojuegos", "lanzamiento", "desarrolladora", "estudio",
  "creador de contenido", "youtuber", "premios", "industria gaming"
];
const BLOCKED_TERMS = [
  "bitcoin", "ethereum", "crypto", "cryptocurrency", "memecoin", "token price",
  "interest rate", "federal reserve", "stock price", "s&p 500", "nasdaq",
  "president", "election", "congress", "senate", "prime minister", "parliament",
  "war", "ceasefire", "invasion", "missile", "conflict", "combat deaths",
  "nba", "nfl", "mlb", "nhl", "premier league", "champions league", "tennis"
];
const SUBJECTIVE_TERMS = [
  "best game", "worst game", "most beautiful", "will be good", "will be bad",
  "mejor juego", "peor juego", "será bueno", "sera bueno", "más bonito", "mas bonito"
];
const CATEGORY_TERMS = Object.freeze({
  Lanzamientos: ["release", "launch", "delay", "dlc", "sequel", "lanzamiento", "retras", "saldrá", "saldra"],
  Eventos: ["awards", "gamescom", "showcase", "direct", "expo", "tournament", "event", "premios", "evento", "final"],
  Industria: ["studio", "publisher", "acquisition", "layoff", "sales", "console", "industria", "estudio", "adquisición", "adquisicion"],
  Streamers: ["streamer", "twitch", "viewers", "spectators", "streaming", "espectadores"],
  "Reviews/Premios": ["metacritic", "review", "score", "nominee", "nominated", "goty", "reseña", "resena", "nominado"],
  YouTubers: ["youtube", "youtuber", "subscribers", "creator", "suscriptores", "creador"]
});

export function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function cleanText(value, maxLength = 4000) {
  return typeof value === "string"
    ? value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, maxLength)
    : "";
}

export function safeNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(/[$,%]/g, "").replaceAll(",", "");
  if (!normalized || !/^-?\d+(?:\.\d+)?$/.test(normalized)) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

export function safeProbability(value) {
  const parsed = safeNumber(value);
  if (parsed === null) return null;
  const probability = parsed > 1 && parsed <= 100 ? parsed / 100 : parsed;
  return probability >= 0 && probability <= 1 ? Math.round(probability * 10000) / 10000 : null;
}

export function safeIsoDate(value) {
  const text = cleanText(value, 100);
  if (!text) return null;
  const milliseconds = Date.parse(text);
  return Number.isFinite(milliseconds) ? new Date(milliseconds).toISOString() : null;
}

export function safeStringArray(value, maxItems = 30) {
  let candidate = value;
  if (typeof value === "string") {
    try {
      candidate = JSON.parse(value);
    } catch {
      candidate = value.includes(",") ? value.split(",") : [value];
    }
  }
  if (!Array.isArray(candidate)) return [];
  return candidate.map((item) => cleanText(item, 160)).filter(Boolean).slice(0, maxItems);
}

export function safePublicUrl(value, allowedHosts = null) {
  const text = cleanText(value, 1200);
  if (!text) return null;
  try {
    const url = new URL(text);
    const host = url.hostname.toLowerCase();
    if (url.protocol !== "https:" || url.username || url.password) return null;
    if (host === "localhost" || host.endsWith(".local") || host === "0.0.0.0" || host === "127.0.0.1" || host === "::1" || host === "[::1]") return null;
    if (/^\[(?:fc|fd|fe8|fe9|fea|feb)/i.test(host)) return null;
    if (/^(10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host)) return null;
    if (Array.isArray(allowedHosts) && !allowedHosts.includes(host)) return null;
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

export function normalizeComparableText(value) {
  return cleanText(value, 1000)
    .toLocaleLowerCase("es")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\b(el|la|los|las|un|una|unos|unas|the|a|an|si|sí|no)\b/g, " ")
    .replace(/\b(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b/g, "$1 $2 $3")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function stableFingerprint(...values) {
  const input = normalizeComparableText(values.filter(Boolean).join(" | "));
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < input.length; index += 1) {
    const code = input.charCodeAt(index);
    first ^= code;
    first = Math.imul(first, 0x01000193) >>> 0;
    second ^= code + index;
    second = Math.imul(second, 0x85ebca6b) >>> 0;
  }
  return `r1-${first.toString(16).padStart(8, "0")}${second.toString(16).padStart(8, "0")}`;
}

export function inferAtinaraCategory(...values) {
  const haystack = normalizeComparableText(values.join(" "));
  let best = null;
  let bestHits = 0;
  Object.entries(CATEGORY_TERMS).forEach(([category, terms]) => {
    const hits = terms.reduce((count, term) => count + (haystack.includes(normalizeComparableText(term)) ? 1 : 0), 0);
    if (hits > bestHits) {
      best = category;
      bestHits = hits;
    }
  });
  return bestHits ? best : null;
}

export function isGamingRelated(...values) {
  const haystack = normalizeComparableText(values.join(" "));
  return GAMING_TERMS.some((term) => haystack.includes(normalizeComparableText(term)));
}

export function containsBlockedTopic(...values) {
  const haystack = ` ${normalizeComparableText(values.join(" "))} `;
  return BLOCKED_TERMS.some((term) => haystack.includes(` ${normalizeComparableText(term)} `));
}

export function midpointProbability(bid, ask, last) {
  const safeBid = safeProbability(bid);
  const safeAsk = safeProbability(ask);
  if (safeBid !== null && safeAsk !== null && safeBid <= safeAsk) {
    return Math.round(((safeBid + safeAsk) / 2) * 10000) / 10000;
  }
  return safeProbability(last);
}

function parsePolymarketOutcomes(record) {
  const outcomes = safeStringArray(record.outcomes);
  let prices = record.outcomePrices;
  if (typeof prices === "string") {
    try { prices = JSON.parse(prices); } catch { prices = []; }
  }
  if (!Array.isArray(prices) || outcomes.length !== prices.length || outcomes.length !== 2) return null;
  const normalized = outcomes.map((outcome) => cleanText(outcome, 20).toLocaleLowerCase("es").normalize("NFD").replace(/[\u0300-\u036f]/g, ""));
  const yesIndex = normalized.findIndex((outcome) => ["yes", "si"].includes(outcome));
  const noIndex = normalized.findIndex((outcome) => outcome === "no");
  if (yesIndex < 0 || noIndex < 0 || yesIndex === noIndex) return null;
  const yes = safeProbability(prices[yesIndex]);
  const no = safeProbability(prices[noIndex]);
  if (yes === null || no === null || Math.abs(yes + no - 1) > 0.08) return null;
  return { yes, no };
}

function baseCandidate(provider, externalId, input, now, cacheMinutes) {
  const sourceTitle = cleanText(input.source_title || input.source_question, 500);
  const sourceQuestion = cleanText(input.source_question || input.source_title, 500);
  const sourceDescription = cleanText(input.source_description, 4000);
  const sourceRules = cleanText(input.source_resolution_rules, 6000);
  const sourceTags = safeStringArray(input.source_tags);
  const category = inferAtinaraCategory(sourceTitle, sourceQuestion, sourceDescription, sourceTags.join(" "));
  const warnings = safeStringArray(input.warnings, 20);
  const missingFields = safeStringArray(input.missing_fields, 20);
  const closeAt = safeIsoDate(input.source_close_at);
  const probability = safeProbability(input.source_probability_yes);
  const nowMs = Date.parse(now);
  const closeMs = closeAt ? Date.parse(closeAt) : Number.NaN;
  const haystack = `${sourceTitle} ${sourceQuestion} ${sourceDescription} ${sourceRules} ${sourceTags.join(" ")}`;
  const hardRejectReasons = [];
  if (!sourceTitle || !sourceQuestion) hardRejectReasons.push("Respuesta externa sin título o pregunta utilizable.");
  if (!isGamingRelated(haystack)) hardRejectReasons.push("No existe una relación gaming suficientemente clara.");
  if (containsBlockedTopic(haystack)) hardRejectReasons.push("El tema pertenece a una categoría excluida del Radar.");
  if (!category) hardRejectReasons.push("No puede clasificarse en la taxonomía de Atinara.");
  if (!closeAt) hardRejectReasons.push("No existe una fecha objetiva de cierre.");
  if (Number.isFinite(closeMs) && closeMs <= nowMs) hardRejectReasons.push("El mercado ya está cerrado o ha sucedido.");
  if (SUBJECTIVE_TERMS.some((term) => normalizeComparableText(haystack).includes(normalizeComparableText(term)))) {
    hardRejectReasons.push("La pregunta depende de una opinión subjetiva.");
  }
  if (probability !== null && (probability <= 0.015 || probability >= 0.985)) {
    hardRejectReasons.push("El resultado externo parece prácticamente decidido.");
  }
  if (!sourceRules) missingFields.push("atinara_resolution_criteria_es");
  if (!safePublicUrl(input.source_resolution_url)) missingFields.push("atinara_resolution_source_url");
  if (!cleanText(input.atinara_question_es)) missingFields.push("atinara_question_es");

  const fetchedAt = safeIsoDate(input.fetched_at) || now;
  const cacheExpiresAt = new Date(Date.parse(fetchedAt) + cacheMinutes * 60_000).toISOString();
  const externalUrl = safePublicUrl(input.external_url, PROVIDER_PUBLIC_HOSTS[provider] || null);
  const candidate = {
    provider,
    external_id: cleanText(externalId, 220),
    external_url: externalUrl,
    external_event_id: cleanText(input.external_event_id, 220) || null,
    source_title: sourceTitle,
    source_question: sourceQuestion,
    source_description: sourceDescription || null,
    source_resolution_rules: sourceRules || null,
    source_resolution_url: safePublicUrl(input.source_resolution_url),
    source_category: cleanText(input.source_category, 160) || null,
    source_tags: sourceTags,
    source_status: cleanText(input.source_status, 80) || null,
    source_created_at: safeIsoDate(input.source_created_at),
    source_updated_at: safeIsoDate(input.source_updated_at),
    source_start_at: safeIsoDate(input.source_start_at),
    source_close_at: closeAt,
    source_probability_yes: probability,
    source_volume_24h: safeNumber(input.source_volume_24h),
    source_volume_total: safeNumber(input.source_volume_total),
    source_liquidity: safeNumber(input.source_liquidity),
    source_open_interest: safeNumber(input.source_open_interest),
    source_image_url: safePublicUrl(input.source_image_url),
    atinara_category: category,
    atinara_question_es: cleanText(input.atinara_question_es, 500) || null,
    atinara_context_es: cleanText(input.atinara_context_es, 3000) || null,
    atinara_resolution_criteria_es: cleanText(input.atinara_resolution_criteria_es, 5000) || null,
    atinara_resolution_source_url: safePublicUrl(input.atinara_resolution_source_url || input.source_resolution_url),
    atinara_closes_at: safeIsoDate(input.atinara_closes_at || closeAt),
    atinara_resolves_at: safeIsoDate(input.atinara_resolves_at),
    yes_label: "Sí",
    no_label: "No",
    quality_status: hardRejectReasons.length ? "rejected" : "needs_review",
    quality_score: 0,
    score_breakdown: {},
    warnings: [...new Set([...warnings, ...hardRejectReasons])],
    missing_fields: [...new Set(missingFields)],
    duplicate_matches: [],
    fingerprint: stableFingerprint(provider, externalId, sourceQuestion, closeAt),
    fetched_at: fetchedAt,
    cache_expires_at: cacheExpiresAt,
    normalizer_version: RADAR_NORMALIZER_VERSION
  };
  return candidate;
}

export function adaptPolymarketResponse(payload, options = {}) {
  const now = safeIsoDate(options.now) || new Date().toISOString();
  const eventMarkets = Array.isArray(payload?.events)
    ? payload.events.flatMap((event) => isRecord(event) && Array.isArray(event.markets)
      ? event.markets.filter(isRecord).map((market) => ({ ...market, events: [event] }))
      : [])
    : [];
  const records = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.data)
      ? payload.data
      : Array.isArray(payload?.markets)
        ? payload.markets
        : eventMarkets;
  const candidates = [];
  const rejected = [];
  records.slice(0, options.maxRecords || 500).forEach((record) => {
    if (!isRecord(record)) return;
    const externalId = cleanText(record.id || record.conditionId || record.slug, 220);
    if (!externalId) return;
    const outcomes = parsePolymarketOutcomes(record);
    const closed = record.closed === true || record.active === false || record.acceptingOrders === false;
    const event = Array.isArray(record.events) && isRecord(record.events[0]) ? record.events[0] : {};
    const slug = cleanText(record.slug || event.slug, 300);
    const input = {
      external_url: slug ? `https://polymarket.com/event/${encodeURIComponent(slug)}` : null,
      external_event_id: cleanText(record.event_id || event.id, 220),
      source_title: cleanText(event.title || record.question, 500),
      source_question: cleanText(record.question || record.title, 500),
      source_description: cleanText(record.description || event.description, 4000),
      source_resolution_rules: cleanText(record.rules || record.description, 6000),
      source_resolution_url: safePublicUrl(record.resolutionSource || record.resolution_source),
      source_category: cleanText(record.category || event.category, 160),
      source_tags: [
        ...safeStringArray(record.tags),
        ...(Array.isArray(event.tags) ? event.tags.map((tag) => isRecord(tag) ? tag.label || tag.name : tag) : [])
      ],
      source_status: closed ? "closed" : "open",
      source_created_at: record.createdAt || record.created_at,
      source_updated_at: record.updatedAt || record.updated_at,
      source_start_at: record.startDate || record.start_date,
      source_close_at: record.endDate || record.end_date || event.endDate,
      source_probability_yes: outcomes?.yes,
      source_volume_24h: record.volume24hr || record.volume24h || record.volume_24h,
      source_volume_total: record.volumeNum || record.volume,
      source_liquidity: record.liquidityNum || record.liquidity,
      source_open_interest: record.openInterest || record.open_interest,
      source_image_url: record.image || event.image,
      fetched_at: now,
      warnings: outcomes ? [] : ["Outcomes binarios Sí/No ausentes o malformados."],
      missing_fields: outcomes ? [] : ["source_probability_yes"]
    };
    const candidate = baseCandidate("polymarket", externalId, input, now, options.cacheMinutes || 20);
    if (!outcomes || closed) {
      candidate.quality_status = "rejected";
      candidate.warnings.push(closed ? "El mercado externo está cerrado." : "El mercado externo no es binario Sí/No.");
    }
    (candidate.quality_status === "rejected" ? rejected : candidates).push(candidate);
  });
  return {
    candidates: candidates.slice(0, options.maxCandidates || 120),
    rejected: rejected.slice(0, options.maxRejected || 120),
    cursor: cleanText(payload?.after_cursor || payload?.next_cursor || payload?.cursor, 300) || null
  };
}

export function adaptKalshiResponse(payload, options = {}) {
  const now = safeIsoDate(options.now) || new Date().toISOString();
  const records = Array.isArray(payload) ? payload : Array.isArray(payload?.markets) ? payload.markets : [];
  const candidates = [];
  const rejected = [];
  records.slice(0, options.maxRecords || 500).forEach((record) => {
    if (!isRecord(record)) return;
    const ticker = cleanText(record.ticker, 220);
    if (!ticker) return;
    const status = cleanText(record.status, 80).toLowerCase();
    const closed = status && status !== "open";
    const rules = [cleanText(record.rules_primary, 4000), cleanText(record.rules_secondary, 4000)].filter(Boolean).join("\n\n");
    const probability = midpointProbability(record.yes_bid_dollars, record.yes_ask_dollars, record.last_price_dollars);
    const input = {
      external_url: `https://kalshi.com/markets/${encodeURIComponent(ticker.toLowerCase())}`,
      external_event_id: cleanText(record.event_ticker, 220),
      source_title: cleanText(record.title, 500),
      source_question: cleanText(record.title, 500),
      source_description: cleanText(record.subtitle || record.yes_sub_title || record.no_sub_title, 4000),
      source_resolution_rules: rules,
      source_resolution_url: safePublicUrl(record.rules_primary_url || record.settlement_source_url),
      source_category: cleanText(record.category, 160),
      source_tags: safeStringArray(record.tags),
      source_status: status || null,
      source_created_at: record.created_time,
      source_updated_at: record.updated_time,
      source_start_at: record.open_time,
      source_close_at: record.close_time || record.expiration_time,
      source_probability_yes: probability,
      source_volume_24h: record.volume_24h_fp,
      source_volume_total: record.volume_fp,
      source_liquidity: record.liquidity_dollars,
      source_open_interest: record.open_interest_fp,
      fetched_at: now,
      warnings: probability === null ? ["Kalshi no ofrece bid/ask ni último precio utilizable."] : [],
      missing_fields: probability === null ? ["source_probability_yes"] : []
    };
    const candidate = baseCandidate("kalshi", ticker, input, now, options.cacheMinutes || 20);
    if (closed) {
      candidate.quality_status = "rejected";
      candidate.warnings.push("El mercado externo no está abierto.");
    }
    (candidate.quality_status === "rejected" ? rejected : candidates).push(candidate);
  });
  return {
    candidates: candidates.slice(0, options.maxCandidates || 120),
    rejected: rejected.slice(0, options.maxRejected || 120),
    cursor: cleanText(payload?.cursor, 300) || null
  };
}

export function adaptTavilyResults(payload, options = {}) {
  const now = safeIsoDate(options.now) || new Date().toISOString();
  const results = Array.isArray(payload?.results) ? payload.results : [];
  const candidates = [];
  const rejected = [];
  results.slice(0, options.maxCandidates || 8).forEach((record, index) => {
    if (!isRecord(record)) return;
    const url = safePublicUrl(record.url);
    const title = cleanText(record.title, 500);
    if (!url || !title) return;
    const input = {
      external_url: url,
      source_title: title,
      source_question: title,
      source_description: cleanText(record.content, 3000),
      source_resolution_url: url,
      source_tags: safeStringArray(options.tags),
      source_status: "idea",
      source_updated_at: record.published_date,
      source_close_at: options.closeAt,
      fetched_at: now,
      warnings: ["Idea obtenida de una fuente pública: requiere confirmar pregunta, fecha y criterios."],
      missing_fields: ["atinara_question_es", "atinara_resolution_criteria_es"]
    };
    const candidate = baseCandidate("tavily", stableFingerprint(url, index), input, now, options.cacheMinutes || 720);
    const ideaText = `${candidate.source_title} ${candidate.source_description || ""} ${(candidate.source_tags || []).join(" ")}`;
    candidate.quality_status = isGamingRelated(ideaText) && !containsBlockedTopic(ideaText) && candidate.atinara_category
      ? "needs_review"
      : "rejected";
    (candidate.quality_status === "rejected" ? rejected : candidates).push(candidate);
  });
  return { candidates, rejected, cursor: null };
}

export function detectDuplicates(candidate, existing = []) {
  const candidateText = normalizeComparableText(candidate.atinara_question_es || candidate.source_question || candidate.source_title);
  const matches = [];
  existing.forEach((item) => {
    if (!isRecord(item)) return;
    const itemProvider = cleanText(item.provider, 40);
    const itemExternalId = cleanText(item.external_id, 220);
    const itemUrl = safePublicUrl(item.external_url || item.source_url);
    const itemText = normalizeComparableText(item.question || item.atinara_question_es || item.source_question || item.title);
    let status = null;
    let reason = null;
    if (itemProvider && itemProvider === candidate.provider && itemExternalId === candidate.external_id) {
      status = "confirmed";
      reason = "Mismo proveedor e identificador externo.";
    } else if (itemUrl && candidate.external_url && itemUrl === candidate.external_url) {
      status = "confirmed";
      reason = "Misma URL externa.";
    } else if (itemText && candidateText && itemText === candidateText) {
      status = "confirmed";
      reason = "Pregunta normalizada idéntica.";
    } else if (itemText && candidateText) {
      const candidateTokens = new Set(candidateText.split(" "));
      const itemTokens = new Set(itemText.split(" "));
      const intersection = [...candidateTokens].filter((token) => itemTokens.has(token)).length;
      const union = new Set([...candidateTokens, ...itemTokens]).size;
      if (union >= 5 && intersection / union >= 0.72) {
        status = "possible";
        reason = "Coincidencia textual alta; requiere comparación humana o semántica.";
      }
    }
    if (status) matches.push({
      status,
      reason,
      kind: cleanText(item.kind || item.state || "existing", 60),
      id: cleanText(item.id || item.market_id || item.market_slug, 220)
    });
  });
  return matches.slice(0, 10);
}

function popularityMetric(candidate) {
  return [
    candidate.source_volume_24h,
    candidate.source_volume_total,
    candidate.source_liquidity,
    candidate.source_open_interest
  ].reduce((sum, value) => sum + Math.log1p(Math.max(0, safeNumber(value) || 0)), 0);
}

function relevanceScore(candidate) {
  const text = `${candidate.source_title} ${candidate.source_question} ${candidate.source_description || ""} ${(candidate.source_tags || []).join(" ")}`;
  if (!isGamingRelated(text) || !candidate.atinara_category) return 0;
  const termHits = GAMING_TERMS.reduce((count, term) => count + (normalizeComparableText(text).includes(normalizeComparableText(term)) ? 1 : 0), 0);
  return Math.min(25, 15 + termHits * 2);
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
  const nowMs = Date.parse(now);
  const closeMs = Date.parse(candidate.source_close_at || "");
  const updatedMs = Date.parse(candidate.source_updated_at || candidate.fetched_at || "");
  if (!Number.isFinite(closeMs) || closeMs <= nowMs) return 0;
  const days = (closeMs - nowMs) / 86_400_000;
  let score = days < 1 ? 2 : days <= 180 ? 8 : days <= 365 ? 6 : 3;
  if (Number.isFinite(updatedMs) && nowMs - updatedMs <= 30 * 86_400_000) score += 2;
  return Math.min(10, score);
}

function uncertaintyScore(candidate) {
  const probability = safeProbability(candidate.source_probability_yes);
  if (probability === null) return 4;
  const distance = Math.abs(probability - 0.5) * 2;
  return Math.max(0, Math.round((1 - distance) * 10));
}

export function scoreCandidates(candidates, existing = [], now = new Date().toISOString()) {
  const providerMax = new Map();
  candidates.forEach((candidate) => {
    const metric = popularityMetric(candidate);
    providerMax.set(candidate.provider, Math.max(providerMax.get(candidate.provider) || 0, metric));
  });
  return candidates.map((candidate) => {
    const duplicates = [...detectDuplicates(candidate, existing)];
    (Array.isArray(candidate.duplicate_matches) ? candidate.duplicate_matches : []).forEach((match) => {
      if (!isRecord(match) || !["confirmed", "possible"].includes(match.status)) return;
      const id = cleanText(match.id, 220);
      const reason = cleanText(match.reason, 500);
      if (!id || duplicates.some((existingMatch) => existingMatch.id === id && existingMatch.status === match.status)) return;
      duplicates.push({
        status: match.status,
        reason: reason || "Posible coincidencia semántica; requiere revisión humana.",
        kind: cleanText(match.kind, 60) || "existing",
        id
      });
    });
    const max = providerMax.get(candidate.provider) || 0;
    const metric = popularityMetric(candidate);
    const popularity = max ? Math.round((metric / max) * 30) : 0;
    const relevance = relevanceScore(candidate);
    const clarity = clarityScore(candidate);
    const recency = recencyScore(candidate, now);
    const uncertainty = uncertaintyScore(candidate);
    const novelty = duplicates.some((match) => match.status === "confirmed") ? 0 : duplicates.length ? 2 : 5;
    const total = Math.max(0, Math.min(100, popularity + relevance + clarity + recency + uncertainty + novelty));
    const confirmedDuplicate = duplicates.some((match) => match.status === "confirmed");
    const missingFields = [...new Set(candidate.missing_fields || [])];
    const hasObjectiveDate = Boolean(safeIsoDate(candidate.atinara_closes_at || candidate.source_close_at));
    const candidateText = `${candidate.source_title || ""} ${candidate.source_question || ""} ${candidate.source_description || ""} ${(candidate.source_tags || []).join(" ")}`;
    const deterministicallyRejected = candidate.quality_status === "rejected"
      || !hasObjectiveDate
      || !candidate.atinara_category
      || !isGamingRelated(candidateText)
      || containsBlockedTopic(candidateText);
    const qualityStatus = deterministicallyRejected || confirmedDuplicate
      ? "rejected"
      : missingFields.length || duplicates.length || total < 65
        ? "needs_review"
        : "fit";
    return {
      ...candidate,
      quality_status: qualityStatus,
      quality_score: total,
      score_breakdown: { popularity, relevance, clarity, recency, uncertainty, novelty },
      duplicate_matches: duplicates,
      warnings: confirmedDuplicate
        ? [...new Set([...(candidate.warnings || []), "Duplicado confirmado: no puede prepararse automáticamente."])]
        : candidate.warnings || []
    };
  });
}

export function compactGeminiCandidate(candidate) {
  if (!isRecord(candidate)) return null;
  const externalId = cleanText(candidate.external_id, 220);
  if (!externalId) return null;
  return {
    provider: cleanText(candidate.provider, 40) || null,
    external_id: externalId,
    source_title: cleanText(candidate.source_title, 300) || null,
    source_question: cleanText(candidate.source_question, 300) || null,
    source_description: cleanText(candidate.source_description, 900) || null,
    source_resolution_rules: cleanText(candidate.source_resolution_rules, 1800) || null,
    source_resolution_url: safePublicUrl(candidate.source_resolution_url),
    source_close_at: safeIsoDate(candidate.source_close_at),
    source_tags: safeStringArray(candidate.source_tags, 12)
      .map((tag) => cleanText(tag, 80))
      .filter(Boolean)
  };
}

export function compactGeminiDefinition(item) {
  if (!isRecord(item)) return null;
  const id = cleanText(item.id || item.market_id || item.market_slug, 220);
  const question = cleanText(item.question || item.title, 350);
  if (!id || !question) return null;
  return {
    id,
    kind: cleanText(item.kind || item.state || "existing", 60),
    question
  };
}

export function parseGeminiAdaptations(payload) {
  if (!isRecord(payload)) return [];
  const candidates = Array.isArray(payload.candidates) ? payload.candidates : [];
  const first = isRecord(candidates[0]) ? candidates[0] : null;
  const content = first && isRecord(first.content) ? first.content : null;
  const parts = content && Array.isArray(content.parts) ? content.parts : [];
  const text = parts
    .filter((part) => isRecord(part) && part.thought !== true)
    .map((part) => typeof part.text === "string" ? part.text : "")
    .filter(Boolean)
    .join("")
    .slice(0, 80_000)
    .trim();
  if (!text) return [];
  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed.filter(isRecord) : [];
  } catch {
    return [];
  }
}

export function applyAdaptation(candidate, adaptation) {
  if (!isRecord(adaptation) || cleanText(adaptation.external_id, 220) !== candidate.external_id) return candidate;
  const closeAt = safeIsoDate(adaptation.atinara_closes_at) || candidate.atinara_closes_at;
  const resolvesAt = safeIsoDate(adaptation.atinara_resolves_at) || candidate.atinara_resolves_at;
  const category = RADAR_CATEGORIES.includes(cleanText(adaptation.atinara_category, 80))
    ? cleanText(adaptation.atinara_category, 80)
    : candidate.atinara_category;
  const adapted = {
    ...candidate,
    atinara_category: category,
    atinara_question_es: cleanText(adaptation.atinara_question_es, 500) || candidate.atinara_question_es,
    atinara_context_es: cleanText(adaptation.atinara_context_es, 3000) || candidate.atinara_context_es,
    atinara_resolution_criteria_es: cleanText(adaptation.atinara_resolution_criteria_es, 5000) || candidate.atinara_resolution_criteria_es,
    atinara_resolution_source_url: safePublicUrl(adaptation.atinara_resolution_source_url) || candidate.atinara_resolution_source_url,
    atinara_closes_at: closeAt,
    atinara_resolves_at: resolvesAt,
    warnings: [...new Set([...(candidate.warnings || []), ...safeStringArray(adaptation.warnings, 10)])]
  };
  adapted.missing_fields = (candidate.missing_fields || []).filter((field) => {
    if (field === "atinara_question_es") return !adapted.atinara_question_es;
    if (field === "atinara_resolution_criteria_es") return !adapted.atinara_resolution_criteria_es;
    if (field === "atinara_resolution_source_url") return !adapted.atinara_resolution_source_url;
    return true;
  });
  return adapted;
}

export function isAdaptedIdeaComplete(candidate) {
  if (!isRecord(candidate) || candidate.provider !== "tavily") return true;
  return Boolean(
    RADAR_CATEGORIES.includes(candidate.atinara_category)
    && cleanText(candidate.atinara_question_es, 500)
    && cleanText(candidate.atinara_resolution_criteria_es, 5000)
    && safePublicUrl(candidate.atinara_resolution_source_url)
    && safeIsoDate(candidate.atinara_closes_at)
  );
}

export function buildDraftPrefill(candidate) {
  const criteria = cleanText(candidate.atinara_resolution_criteria_es, 5000);
  const closeAt = safeIsoDate(candidate.atinara_closes_at || candidate.source_close_at);
  const resolvesAt = safeIsoDate(candidate.atinara_resolves_at);
  const sourceUrl = safePublicUrl(candidate.atinara_resolution_source_url || candidate.source_resolution_url || candidate.external_url);
  const slugBase = normalizeComparableText(candidate.atinara_question_es || candidate.source_question)
    .split(" ").slice(0, 10).join("-").replace(/[^a-z0-9-]/g, "").slice(0, 90);
  const fields = {
    market_slug: slugBase || "",
    category: RADAR_CATEGORIES.includes(candidate.atinara_category) ? candidate.atinara_category : "",
    subject: "",
    question: cleanText(candidate.atinara_question_es, 500),
    yes_option: "Sí",
    no_option: "No",
    description: cleanText(candidate.atinara_context_es, 3000),
    evaluation_period_label: "",
    evaluation_ends_at: closeAt || "",
    timezone: closeAt ? "Europe/Madrid" : "",
    resolution_deadline: resolvesAt || "",
    yes_criteria: criteria,
    no_criteria: "",
    edge_cases: "",
    public_criteria: criteria,
    primary_source_url: sourceUrl || "",
    alternative_sources: candidate.external_url && candidate.external_url !== sourceUrl ? candidate.external_url : "",
    delay_treatment: "",
    cancellation_treatment: "",
    leak_treatment: "",
    rename_treatment: "",
    assumptions: ""
  };
  const origins = {};
  Object.entries(fields).forEach(([name, value]) => {
    if (!value) origins[name] = "missing";
    else if (["question", "description", "yes_criteria", "public_criteria", "category"].includes(name)) origins[name] = "adapted";
    else origins[name] = "source";
  });
  ["subject", "evaluation_period_label", "no_criteria", "edge_cases", "resolution_deadline"].forEach((name) => {
    if (!fields[name]) origins[name] = "review";
  });
  return {
    candidate_id: candidate.id || null,
    fields,
    origins,
    warnings: [...new Set(candidate.warnings || [])],
    missing_fields: Object.entries(origins).filter(([, origin]) => origin === "missing" || origin === "review").map(([name]) => name),
    auto_saved: false,
    published: false,
    approved: false,
    scheduled: false
  };
}

export function buildCacheKey(filters = {}) {
  const provider = RADAR_PROVIDERS.includes(filters.provider) ? filters.provider : "all";
  const category = RADAR_CATEGORIES.includes(filters.category) ? filters.category : "all";
  const query = normalizeComparableText(filters.query || "").slice(0, 80) || "all";
  const horizon = ["30d", "90d", "180d", "365d"].includes(filters.horizon) ? filters.horizon : "180d";
  return `${RADAR_NORMALIZER_VERSION}:${provider}:${category}:${query}:${horizon}`;
}

export function publicProviderError(provider, code, status = 502) {
  const messages = {
    PROVIDER_TIMEOUT: "La fuente ha tardado demasiado. Se mantienen los datos en caché si existen.",
    PROVIDER_RATE_LIMITED: "La fuente ha alcanzado temporalmente su límite. Inténtalo más tarde.",
    PROVIDER_INVALID_RESPONSE: "La fuente devolvió una respuesta no válida.",
    PROVIDER_UNAVAILABLE: "La fuente no está disponible en este momento.",
    PROVIDER_NOT_CONFIGURED: "Esta fuente opcional no está configurada."
  };
  return {
    provider,
    code,
    message: messages[code] || messages.PROVIDER_UNAVAILABLE,
    status
  };
}
