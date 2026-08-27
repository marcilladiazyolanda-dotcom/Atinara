import { nullableFiniteNumber } from "./nullable-number.mjs";
import { canonicalJson, sha256Hex } from "./ai/contracts.mjs";

export const RADAR_NORMALIZER_VERSION = "atinara-radar-v3";
export const RADAR_ELIGIBILITY_POLICY_VERSION = "atinara-prediction-policy-v5";
export const RADAR_FAMILY_VERSION = "atinara-market-family-v5";
export const RADAR_FACT_POLICY_VERSION = "atinara-terminal-fact-gate-v2";
export const RADAR_DOMAIN_POLICY_VERSION = "atinara-gaming-domain-v2";
export const RADAR_DOMAIN_FINGERPRINT_VERSION = "atinara-radar-domain-fingerprint-v2";
export const RADAR_PARENT_RECONCILIATION_VERSION = "atinara-radar-parent-reconciliation-v1";
export const RADAR_CHILD_PROJECTION_VERSION = "atinara-radar-child-projection-v1";
export const RADAR_PROVIDER_CHILD_CONTRACT_VERSION = "atinara-radar-provider-child-contract-v1";
export const RADAR_PROVIDER_LABEL_CATALOG_VERSION = "atinara-radar-provider-labels-es-v1";
export const RADAR_PROVIDER_DISCOVERY_CHECKPOINT_V2 = "atinara-provider-discovery-checkpoint-v2";
export const KALSHI_RADAR_SERIES_CATALOG_POLICY_VERSION = "atinara-kalshi-radar-series-catalog-v2";
export const KALSHI_RADAR_CATALOG_ENTITY_POLICY_VERSION = "atinara-kalshi-catalog-entities-v1";

export const RADAR_CATEGORIES = Object.freeze([
  "Lanzamientos",
  "Eventos",
  "Industria",
  "Streamers",
  "Reviews/Premios",
  "YouTubers",
]);

export const RADAR_PROVIDER_ROLE_VERSION = "atinara-radar-provider-roles-v1";
export const RADAR_CANDIDATE_PROVIDERS = Object.freeze(["polymarket", "kalshi"]);
export const RADAR_ENRICHMENT_CAPABILITIES = Object.freeze(["tavily"]);
export const RADAR_PROVIDER_ROLES = Object.freeze({
  polymarket: Object.freeze({ role: "candidate_feed", affectsCatalogHealth: true }),
  kalshi: Object.freeze({ role: "candidate_feed", affectsCatalogHealth: true }),
  tavily: Object.freeze({ role: "source_enrichment", affectsCatalogHealth: false }),
});

export function radarOperationalErrorCode(error, fallback = "RADAR_ELIGIBILITY_TECHNICAL_FAILURE") {
  const source = error && typeof error === "object" ? error : {};
  for (const value of [source.databaseMessage, source.code, source.message]) {
    const code = String(value ?? "").trim();
    if (/^[A-Z][A-Z0-9_]{2,100}$/.test(code)) return code;
  }
  const safeFallback = String(fallback ?? "").trim();
  return /^[A-Z][A-Z0-9_]{2,100}$/.test(safeFallback)
    ? safeFallback
    : "RADAR_ELIGIBILITY_TECHNICAL_FAILURE";
}
// Unión conservada para adaptadores, URLs y respuestas legacy. La salud del
// catálogo usa RADAR_CANDIDATE_PROVIDERS, nunca esta unión.
export const RADAR_PROVIDERS = Object.freeze([
  ...RADAR_CANDIDATE_PROVIDERS,
  ...RADAR_ENRICHMENT_CAPABILITIES,
]);
export const RADAR_API_HOSTS = Object.freeze([
  "gamma-api.polymarket.com",
  "clob.polymarket.com",
  "external-api.kalshi.com",
  "api.elections.kalshi.com",
  "api.tavily.com",
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
  PROVIDER_OPTION_INACTIVE: "PROVIDER_OPTION_INACTIVE",
  PROVIDER_EVENT_NOT_FOUND: "PROVIDER_EVENT_NOT_FOUND",
  PROVIDER_CHILD_NOT_FOUND: "PROVIDER_CHILD_NOT_FOUND",
  PROVIDER_CHILD_IDENTITY_RESOLUTION_REQUIRED: "PROVIDER_CHILD_IDENTITY_RESOLUTION_REQUIRED",
  RADAR_PARENT_RECONCILIATION_INCOMPLETE: "RADAR_PARENT_RECONCILIATION_INCOMPLETE",
  PROVIDER_PARENT_COUNT_INCONSISTENT: "PROVIDER_PARENT_COUNT_INCONSISTENT",
  RESOLUTION_SOURCE_AUTHORITY_PENDING: "RESOLUTION_SOURCE_AUTHORITY_PENDING",
  OFFICIAL_TERMINAL_SCAN_UNAVAILABLE: "OFFICIAL_TERMINAL_SCAN_UNAVAILABLE",
  OFFICIAL_SELECTION_RECHECK_REQUIRED: "OFFICIAL_SELECTION_RECHECK_REQUIRED",
  VERIFICATION_REQUIRED: "VERIFICATION_REQUIRED",
  VERIFICATION_EXPIRED: "VERIFICATION_EXPIRED",
  GAMING_DOMAIN_REVIEW_REQUIRED: "GAMING_DOMAIN_REVIEW_REQUIRED",
  OUTSIDE_GAMING_DOMAIN: "OUTSIDE_GAMING_DOMAIN",
  PROVIDER_PLACEHOLDER: "PROVIDER_PLACEHOLDER",
});

const PROVIDER_PUBLIC_HOSTS = Object.freeze({
  polymarket: ["polymarket.com", "www.polymarket.com"],
  kalshi: ["kalshi.com", "www.kalshi.com"],
});

const GAMING_TERMS = [
  "game", "gaming", "video game", "videojuego", "playstation", "xbox", "nintendo", "steam",
  "metacritic", "game awards", "goty", "esports", "twitch", "streamer", "youtube", "youtuber",
  "switch", "console", "consola", "pc", "developer", "publisher", "studio", "dlc", "expansion",
  "gameplay", "multiplayer", "single-player", "release date", "review score", "trailer", "lanzamiento",
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
  SUBJECT_NOT_ANNOUNCED: "La predicción depende de un producto no anunciado para un resultado posterior, como un premio o una reseña.",
  TEMPORAL_INCOHERENCE: "Las fechas o el periodo del mercado son incompatibles con la evidencia verificada.",
  INVALID_OR_UNVERIFIED_SOURCE: "No se pudo validar una fuente pública suficiente para preparar el mercado.",
  DUPLICATE_MARKET: "Ya existe un mercado o borrador equivalente en Atinara.",
  PROVIDER_NOT_OPEN: "El mercado de origen ya no admite participación.",
  PROVIDER_OPTION_INACTIVE: "La opción no está negociable, pero el evento padre puede seguir abierto.",
  PROVIDER_EVENT_NOT_FOUND: "El evento de origen ya no existe o no se pudo verificar.",
  PROVIDER_CHILD_NOT_FOUND: "La opción de mercado ya no pertenece al evento verificado.",
  PROVIDER_CHILD_IDENTITY_RESOLUTION_REQUIRED: "La identidad de esta hija todavía no está demostrada por el proveedor.",
  RADAR_PARENT_RECONCILIATION_INCOMPLETE: "El padre no puede proyectarse hasta contabilizar y reconciliar todas sus hijas.",
  PROVIDER_PARENT_COUNT_INCONSISTENT: "El total declarado por el proveedor no coincide con las hijas observadas.",
  RESOLUTION_SOURCE_AUTHORITY_PENDING: "Atinara todavía no ha recuperado una fuente resolutiva oficial y exacta para esta opción.",
  OFFICIAL_TERMINAL_SCAN_UNAVAILABLE: "La comprobación oficial de resultados conocidos no terminó; Atinara conserva el último expediente válido y reintentará.",
  OFFICIAL_SELECTION_RECHECK_REQUIRED: "Una fuente oficial apunta a una selección ya publicada, pero Atinara debe completar su comprobación antes de volver a mostrar el evento.",
  VERIFICATION_REQUIRED: "La candidata necesita completar una comprobación automática antes de preparar un borrador.",
  VERIFICATION_EXPIRED: "La comprobación automática ha caducado y debe repetirse.",
  GAMING_DOMAIN_REVIEW_REQUIRED: "La relación con videojuegos necesita una revisión específica.",
  OUTSIDE_GAMING_DOMAIN: "La proposición está fuera del dominio gaming de este Radar.",
  PROVIDER_PLACEHOLDER: "El proveedor todavía no identifica una opción real y concreta.",
});

export function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function cleanText(value, maxLength = 4000) {
  if (value === null || value === undefined) return "";
  return String(value).replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function decodeOfficialHtmlEntities(value) {
  const named = {
    amp: "&", apos: "'", gt: ">", lt: "<", nbsp: " ", quot: '"', ndash: "-", mdash: "-",
  };
  return String(value ?? "").replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (match, entity) => {
    if (entity[0] !== "#") return named[entity.toLowerCase()] ?? match;
    const radix = entity[1]?.toLowerCase() === "x" ? 16 : 10;
    const digits = radix === 16 ? entity.slice(2) : entity.slice(1);
    const codePoint = Number.parseInt(digits, radix);
    try { return Number.isInteger(codePoint) && codePoint > 0 ? String.fromCodePoint(codePoint) : " "; }
    catch { return " "; }
  });
}

function officialHtmlAttribute(tag, attribute) {
  const match = String(tag ?? "").match(new RegExp(`\\b${attribute}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
  return decodeOfficialHtmlEntities(match?.[1] ?? match?.[2] ?? match?.[3] ?? "").trim();
}

function decodeOfficialJsonString(value) {
  try {
    return cleanText(decodeOfficialHtmlEntities(JSON.parse(`"${String(value ?? "")}"`)), 1_000);
  } catch {
    return "";
  }
}

// El texto alternativo y las descripciones Open Graph forman parte del
// contenido editorial visible de muchas páginas oficiales. Conservarlos evita
// que un anuncio publicado únicamente como arte de portada parezca ausente.
export function extractOfficialHtmlText(raw) {
  const source = String(raw ?? "");
  const imageText = (source.match(/<[a-z][^>]*(?:\balt|\bimage-tooltip|\bimage-alt|\blogo-alt)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)[^>]*>/gi) ?? [])
    .flatMap((tag) => ["alt", "image-tooltip", "image-alt", "logo-alt"]
      .map((attribute) => officialHtmlAttribute(tag, attribute)))
    .filter((value, index, values) => Boolean(value) && values.indexOf(value) === index)
    .join(". ");
  // Algunos portales oficiales hidratan el selector de ediciones en JSON y no
  // renderizan sus textos alternativos como atributos HTML. Extraemos solo
  // campos de accesibilidad de imagen con nombre permitido; nunca incorporamos
  // scripts completos, snippets del buscador ni valores de claves arbitrarias.
  const structuredImageText = [...source.matchAll(/"(?:alternateText|altText|imageAlt|imageDescription)"\s*:\s*"((?:\\.|[^"\\])*)"/gi)]
    .map((match) => {
      const imageDescription = decodeOfficialJsonString(match[1]);
      if (!imageDescription || !Number.isSafeInteger(match.index)) return imageDescription;
      const preceding = source.slice(Math.max(0, match.index - 800), match.index);
      const editionMatches = [...preceding.matchAll(/"editionName"\s*:\s*"((?:\\.|[^"\\])*)"/gi)];
      const editionName = decodeOfficialJsonString(editionMatches.at(-1)?.[1]);
      return editionName && !normalizeComparableText(imageDescription).includes(normalizeComparableText(editionName))
        ? `${editionName}: ${imageDescription}`
        : imageDescription;
    })
    .filter((value, index, values) => Boolean(value) && values.indexOf(value) === index)
    .slice(0, 64)
    .join(". ");
  const metadataText = (source.match(/<meta\b[^>]*>/gi) ?? [])
    .filter((tag) => {
      const key = (officialHtmlAttribute(tag, "property") || officialHtmlAttribute(tag, "name")).toLowerCase();
      return ["description", "og:description", "twitter:description", "og:title", "twitter:title"].includes(key);
    })
    .map((tag) => officialHtmlAttribute(tag, "content"))
    .filter(Boolean)
    .join(". ");
  const bodyText = source
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(?:script|style|noscript|svg|iframe|object|template)\b[\s\S]*?<\/(?:script|style|noscript|svg|iframe|object|template)>/gi, " ")
    .replace(/<(?:br|\/p|\/div|\/li|\/h[1-6]|\/section|\/article)\b[^>]*>/gi, ". ")
    .replace(/<[^>]+>/g, " ");
  return cleanText(decodeOfficialHtmlEntities(`${metadataText}. ${imageText}. ${structuredImageText}. ${bodyText}`), 300_000);
}

// Descubre únicamente documentos editoriales enlazados desde la propia fuente
// oficial. La lista queda limitada, sin fragmentos, credenciales, puertos ni
// saltos a dominios ajenos; después la Edge vuelve a descargar y verificar cada
// URL con sus límites de tamaño, tiempo y redirecciones.
export function extractOfficialRelatedUrls(raw, baseUrl, allowedHosts = [], limit = 24) {
  const base = safePublicUrl(baseUrl, Array.isArray(allowedHosts) ? allowedHosts : []);
  if (!base || !Number.isSafeInteger(limit) || limit < 1) return [];
  let baseParsed;
  try { baseParsed = new URL(base); }
  catch { return []; }
  const ranked = new Map();
  for (const match of String(raw ?? "").matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const tag = `<a${match[1] ?? ""}>`;
    const href = officialHtmlAttribute(tag, "href");
    if (!href || /^(?:#|javascript:|mailto:|tel:)/i.test(href)) continue;
    let absolute;
    try { absolute = new URL(href, baseParsed); }
    catch { continue; }
    absolute.hash = "";
    const url = safePublicUrl(absolute.toString(), allowedHosts);
    if (!url) continue;
    let parsed;
    try { parsed = new URL(url); }
    catch { continue; }
    if (parsed.username || parsed.password || (parsed.port && parsed.port !== "443")) continue;
    const authorityDomain = (hostname) => [...allowedHosts]
      .map((host) => cleanText(host, 240).toLowerCase())
      .filter(Boolean)
      .sort((left, right) => right.length - left.length)
      .find((host) => hostname === host || hostname.endsWith(`.${host}`)) ?? null;
    if (authorityDomain(parsed.hostname.toLowerCase()) !== authorityDomain(baseParsed.hostname.toLowerCase())) continue;
    if (/\/(?:checkout|cart|account|login|sign-?in|register)(?:\/|$)/i.test(parsed.pathname)) continue;
    if (/\.(?:avif|gif|jpe?g|png|svg|webp|pdf|zip)(?:$|\?)/i.test(parsed.pathname)) continue;
    const label = cleanText(decodeOfficialHtmlEntities(String(match[2] ?? "").replace(/<[^>]+>/g, " ")), 500);
    const comparable = normalizeComparableText(`${parsed.pathname} ${label}`);
    const editorial = /\b(?:cover|portada|edition|edicion|reveal|announcement|anuncio|lineup|selection|features?|news|release|lanzamiento|buy|comprar)\b/.test(comparable);
    if (!editorial) continue;
    const score = (/\b(?:cover|portada)\b/.test(comparable) ? 100 : 0)
      + (/\b(?:edition|edicion)\b/.test(comparable) ? 70 : 0)
      + (/\b(?:reveal|announcement|anuncio|lineup|selection)\b/.test(comparable) ? 55 : 0)
      + (/\b(?:release|lanzamiento)\b/.test(comparable) ? 35 : 0)
      + (/\b(?:features?|news)\b/.test(comparable) ? 20 : 0)
      + (/\b(?:buy|comprar)\b/.test(comparable) ? 45 : 0);
    const canonical = parsed.toString();
    ranked.set(canonical, Math.max(ranked.get(canonical) ?? 0, score));
  }
  return [...ranked.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, limit)
    .map(([url]) => url);
}

function compactOfficialIdentity(value) {
  return cleanText(value, 300_000).normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "");
}

// Devuelve únicamente segmentos que pertenecen de forma verificable al sujeto
// contractual. Para métricas se exige que título o ruta canónica identifiquen
// el producto; una mención cruzada dentro de otra ficha no es evidencia.
export function officialEvidenceSegmentsForSubject(page, subject, mode = "generic") {
  const identity = compactOfficialIdentity(subject);
  if (identity.length < 5 || !isRecord(page)) return [];
  let path = "";
  try { path = new URL(cleanText(page.url, 2_000)).pathname; }
  catch { path = ""; }
  const canonicalPage = compactOfficialIdentity(`${page.title ?? ""} ${path}`).includes(identity);
  if (mode === "metric" && !canonicalPage) return [];
  const segments = cleanText(page.content, 300_000)
    .split(/(?<=[.!?])\s+|\s*[|•]\s*/)
    .map((segment) => cleanText(segment, 2_100))
    .filter(Boolean);
  if (canonicalPage || mode === "generic") return segments;
  return segments.filter((segment) => {
    const normalized = normalizeComparableText(segment);
    return compactOfficialIdentity(segment).includes(identity)
      && (mode !== "selection" || /\b(?:cover|portada|key art|cover athlete|cover star)\b/.test(normalized));
  });
}

export function officialSelectionEditionCoverage(page, segments, subject) {
  const identity = compactOfficialIdentity(subject);
  const editions = new Set();
  if (!identity || !isRecord(page)) return [];
  for (const segment of Array.isArray(segments) ? segments : []) {
    const normalized = normalizeComparableText(segment);
    if (!compactOfficialIdentity(segment).includes(identity) || !/\b(?:cover|portada|key art)\b/.test(normalized)) continue;
    const explicit = [];
    if (/\b(?:standard edition|edicion estandar)\b/.test(normalized)) explicit.push("standard");
    if (/\b(?:ultimate plus edition|edicion ultimate plus)\b/.test(normalized)) explicit.push("ultimate_plus");
    if (/\b(?:ultimate edition|edicion ultimate)\b/.test(normalized.replace(/\bultimate plus edition\b/g, " "))) explicit.push("ultimate");
    if (/\b(?:deluxe edition|edicion deluxe)\b/.test(normalized)) explicit.push("deluxe");
    if (explicit.length) {
      explicit.forEach((edition) => editions.add(edition));
      continue;
    }
    const content = String(page.content ?? "");
    const index = content.indexOf(segment);
    if (index < 0) continue;
    const following = normalizeComparableText(content.slice(index + segment.length, index + segment.length + 900));
    const nearby = [
      { edition: "standard", pattern: /\b(?:standard edition|edicion estandar)\b/ },
      { edition: "ultimate_plus", pattern: /\b(?:ultimate plus edition|edicion ultimate plus)\b/ },
      { edition: "ultimate", pattern: /\b(?:ultimate edition|edicion ultimate)\b/ },
      { edition: "deluxe", pattern: /\b(?:deluxe edition|edicion deluxe)\b/ },
    ].map((item) => ({ ...item, index: following.search(item.pattern) }))
      .filter((item) => item.index >= 0)
      .sort((left, right) => left.index - right.index)[0];
    if (nearby) editions.add(nearby.edition);
  }
  return [...editions];
}

export function safeNumber(value) {
  return nullableFiniteNumber(value);
}

export function paginateMergedRadarParents(groups, {
  parentOffset = 0,
  parentLimit = 60,
  authoritativeParentCount = 0,
} = {}) {
  const normalizedGroups = Array.isArray(groups) ? groups : [];
  const offset = Math.max(0,Math.floor(Number(parentOffset)||0));
  const limit = Math.max(1,Math.min(60,Math.floor(Number(parentLimit)||60)));
  const parentCount = Math.max(
    Math.max(0,Math.floor(Number(authoritativeParentCount)||0)),
    offset+normalizedGroups.length,
  );
  return {
    groups:normalizedGroups.slice(0,limit),
    page:{
      parent_count:parentCount,parent_offset:offset,parent_limit:limit,
      next_parent_offset:offset+limit<parentCount ? offset+limit : null,
    },
  };
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

/**
 * @param {unknown} value
 * @param {string[] | null} allowedHosts
 * @returns {string | null}
 */
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

function compareUtf16Binary(leftValue, rightValue) {
  const left = String(leftValue ?? "");
  const right = String(rightValue ?? "");
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const difference = left.charCodeAt(index) - right.charCodeAt(index);
    if (difference) return difference;
  }
  return left.length - right.length;
}

export async function radarDomainFingerprintV1(candidate) {
  const providerPayload = isRecord(candidate?.provider_payload) ? candidate.provider_payload : {};
  const tags = safeStringArray(candidate?.source_tags, 30)
    .map((tag) => normalizeComparableText(tag)).filter(Boolean).sort(compareUtf16Binary);
  return sha256Hex({
    version: RADAR_DOMAIN_FINGERPRINT_VERSION,
    provider: cleanText(candidate?.provider, 40),
    external_id: cleanText(candidate?.external_id, 220),
    external_event_id: cleanText(candidate?.external_event_id, 220),
    event_group_key: cleanText(candidate?.event_group_key, 240),
    source_title: normalizeComparableText(candidate?.source_title),
    source_question: normalizeComparableText(candidate?.source_question),
    source_description: normalizeComparableText(candidate?.source_description),
    source_category: normalizeComparableText(candidate?.source_category),
    source_tags: tags,
    yes_sub_title: normalizeComparableText(candidate?.yes_sub_title),
    provider_yes_sub_title: normalizeComparableText(providerPayload.yes_sub_title),
    provider_title: normalizeComparableText(providerPayload.title),
    provider_subtitle: normalizeComparableText(providerPayload.subtitle),
    provider_category: normalizeComparableText(providerPayload.category),
    provider_series_ticker: normalizeComparableText(providerPayload.series_ticker),
    provider_event_ticker: normalizeComparableText(providerPayload.event_ticker),
    context: normalizeComparableText(candidate?.context),
    family_key: cleanText(candidate?.family_key, 240),
    family_child_key: cleanText(candidate?.family_child_key, 240),
    family_child_label: normalizeComparableText(candidate?.family_child_label),
    canonical_child_key: cleanText(candidate?.canonical_child_key, 240),
    canonical_child_label: normalizeComparableText(candidate?.canonical_child_label),
    identity_status: cleanText(candidate?.identity_status, 80),
    identity_classification: cleanText(candidate?.identity_classification, 100),
    identity_source: cleanText(candidate?.identity_source, 120),
    parent_reconciliation_fingerprint: cleanText(candidate?.parent_reconciliation_fingerprint, 80),
  });
}

/**
 * Conserva una atestación humana ya persistida únicamente cuando la candidata
 * revalidada mantiene exactamente el mismo material de dominio. La
 * reconciliación del padre tiene una puerta autoritativa propia y puede cambiar
 * de huella al volver a observar disponibilidad o contratos de sus hermanas;
 * ese cambio no altera por sí solo si el sujeto pertenece a gaming.
 *
 * @param {Record<string, any>} currentCandidate
 * @param {Record<string, any>} persistedCandidate
 */
export async function selectRadarDomainReviewFingerprintV1(
  currentCandidate = {},
  persistedCandidate = {},
) {
  const persistedReviewFingerprint = cleanText(
    persistedCandidate?.domain_review_fingerprint,
    80,
  );
  if (!/^[a-f0-9]{64}$/.test(persistedReviewFingerprint)) {
    return radarDomainFingerprintV1(currentCandidate);
  }
  const continuityProjection = (candidate) => ({
    ...candidate,
    parent_reconciliation_fingerprint: null,
  });
  const [currentContinuity, persistedContinuity] = await Promise.all([
    radarDomainFingerprintV1(continuityProjection(currentCandidate)),
    radarDomainFingerprintV1(continuityProjection(persistedCandidate)),
  ]);
  if (currentContinuity === persistedContinuity) return persistedReviewFingerprint;
  return radarDomainFingerprintV1(currentCandidate);
}

const GAMING_DOMAIN_STRONG_PATTERNS = Object.freeze([
  /\bvideo ?games?\b/, /\bvideojuegos?\b/, /\bplaystation\b/, /\bxbox\b/,
  /\bnintendo\b/, /\bsteam\b/, /\bmetacritic\b/, /\bgame awards\b/,
  /\bgoty\b/, /\besports?\b/, /\btwitch\b/, /\bgameplay\b/,
  /\b(?:dlc|expansion pack|game expansion|multiplayer|single player|console)\b/,
  /\b(?:game developer|game publisher|gaming studio)\b/,
]);

const GAMING_DOMAIN_NEGATIVE_PATTERNS = Object.freeze([
  /\bsports illustrated\b/, /\b(?:footballer|futbolista)\b/,
  /\b(?:premier league|la liga|champions league|nba|nfl|mlb|nhl)\b/,
  /\b(?:election|president|senate|congress|parliament|politics?|political|eleccion)\b/,
  /\b(?:stock price|share price|bitcoin|cryptocurrency|criptomoneda)\b/,
  /\b(?:movie|film|box office|actor|actress|musician|album)\b/,
  /\b(?:music|songs?|singer|band|podcasts?|television|tv shows?)\b/,
]);

const KALSHI_RADAR_CATALOG_EXPLICIT_PATTERNS = Object.freeze([
  /\b(?:video games?|videojuegos?|gaming|esports?)\b/,
  /\b(?:playstation|xbox|nintendo|steam|metacritic|game awards|goty)\b/,
  /\b(?:gameplay|dlc|multiplayer|single player|console)\b/,
]);

const KALSHI_RADAR_CATALOG_ENTITY_PATTERNS = Object.freeze([
  /\b(?:rockstar games|riot games|epic games|electronic arts|ubisoft|activision|blizzard|bethesda)\b/,
  /\b(?:take two|valve|supercell|bandai namco|square enix|capcom|sega|konami|cd projekt)\b/,
  /\b(?:roblox|minecraft|fortnite|league of legends|valorant|counter strike|cs2)\b/,
  /\b(?:call of duty|overwatch|rocket league|dota|warcraft|zelda|pokemon)\b/,
]);

const KALSHI_RADAR_CATALOG_INDUSTRY_PATTERNS = Object.freeze([
  /\b(?:game developers?|game publishers?|gaming studios?)\b/,
  /\b(?:video game companies|video game company|video game industry|games industry)\b/,
]);

const KALSHI_RADAR_CATALOG_CREATOR_METADATA_PATTERNS = Object.freeze([
  /\b(?:twitch|youtube|youtuber|streamers?|content creators?)\b/,
]);

const KALSHI_RADAR_CATALOG_CREATOR_TICKER_PATTERN = /^(?:kx)+(?:twitch|ytube|youtube|streamer)/;

const KALSHI_RADAR_CATALOG_OFFICIAL_HOSTS = Object.freeze([
  "rockstargames.com", "riotgames.com", "lolesports.com", "epicgames.com", "ea.com",
  "ubisoft.com", "activision.com", "blizzard.com", "bethesda.net", "take2games.com",
  "steampowered.com", "valvesoftware.com", "supercell.com", "bandainamcoent.com",
  "square-enix-games.com", "capcom.com", "sega.com", "konami.com", "cdprojektred.com",
  "roblox.com", "minecraft.net", "fortnite.com", "playstation.com", "xbox.com", "nintendo.com",
]);

const KALSHI_RADAR_CATALOG_EDITORIAL_HOSTS = Object.freeze([
  "metacritic.com", "thegameawards.com", "ign.com", "gamespot.com",
  "pcgamer.com", "kotaku.com", "polygon.com",
]);

const KALSHI_RADAR_CATALOG_CREATOR_HOSTS = Object.freeze(["twitch.tv", "youtube.com"]);

const KALSHI_RADAR_CATALOG_OFFICIAL_HOST_SET = new Set(KALSHI_RADAR_CATALOG_OFFICIAL_HOSTS);
const KALSHI_RADAR_CATALOG_EDITORIAL_HOST_SET = new Set(KALSHI_RADAR_CATALOG_EDITORIAL_HOSTS);
const KALSHI_RADAR_CATALOG_CREATOR_HOST_SET = new Set(KALSHI_RADAR_CATALOG_CREATOR_HOSTS);

const KALSHI_RADAR_CATALOG_ENTITY_SEED_SIGNALS = new Set([
  "registered_gaming_taxonomy",
  "explicit_gaming_metadata",
  "gaming_entity_metadata",
  "gaming_industry_metadata",
  "official_gaming_source",
  "gaming_editorial_source",
]);

const KALSHI_RADAR_CATALOG_SIGNAL_ORDER = Object.freeze([
  "registered_gaming_taxonomy",
  "explicit_gaming_metadata",
  "gaming_entity_metadata",
  "gaming_industry_metadata",
  "creator_theme_metadata",
  "official_gaming_source",
  "gaming_editorial_source",
  "creator_theme_source",
]);

const KALSHI_RADAR_CATALOG_SIGNAL_BITS = Object.freeze(Object.fromEntries(
  KALSHI_RADAR_CATALOG_SIGNAL_ORDER.map((signal, index) => [signal, 1 << index]),
));

const KALSHI_RADAR_CATALOG_ENTITY_SEED_MASK = [...KALSHI_RADAR_CATALOG_ENTITY_SEED_SIGNALS]
  .reduce((mask, signal) => mask | KALSHI_RADAR_CATALOG_SIGNAL_BITS[signal], 0);

const KALSHI_RADAR_CATALOG_ENTITY_STOPWORDS = new Set([
  "will", "would", "when", "what", "which", "who", "where", "how", "many", "much",
  "before", "after", "between", "over", "under", "than", "with", "without", "from",
  "the", "and", "for", "that", "this", "into", "onto", "come", "comes", "coming",
  "first", "last", "next", "more", "most", "less", "least", "certain", "official",
  "new", "total", "point", "win", "winner", "team", "teams", "season", "sports",
  "league", "cup", "pro", "project", "person", "people", "appear", "annual", "kpi",
  "movie", "movies", "ranking", "rank", "voice", "artist", "performance", "two",
  "rotten", "tomatoes", "meta",
  "game", "games", "gaming", "video", "esports", "event", "events", "award", "awards",
  "best", "top", "score", "review", "reviews", "release", "launch", "date", "year",
  "month", "week", "day", "time", "stream", "streamer", "youtube", "twitch", "subs",
  "subscriber", "subscribers", "announcement", "announced", "company", "market", "price",
  "juego", "juegos", "videojuego", "videojuegos", "evento", "premio", "premios", "mejor",
  "lanzamiento", "fecha", "antes", "despues", "cuando", "cuantos", "oficial",
]);

function kalshiCatalogEntityTokens(series, preparedTitle = null, preparedNormalizedTitle = null) {
  const rawTitle = preparedTitle === null
    ? cleanText(series?.title ?? series?.name, 400) : preparedTitle;
  const normalizedTitle = preparedNormalizedTitle === null
    ? normalizeComparableText(rawTitle) : preparedNormalizedTitle;
  const normalizedTokens = normalizedTitle.split(/\s+/).filter((token) =>
    /^[a-z][a-z0-9]{2,39}$/.test(token)
      && !KALSHI_RADAR_CATALOG_ENTITY_STOPWORDS.has(token));
  const uppercaseAcronyms = new Set((rawTitle.match(/\b[A-Z][A-Z0-9]{2,7}\b/g) ?? [])
    .map((token) => normalizeComparableText(token))
    .filter((token) => token && !KALSHI_RADAR_CATALOG_ENTITY_STOPWORDS.has(token)));
  return { tokens: [...new Set(normalizedTokens)], uppercase_acronyms: uppercaseAcronyms };
}

function kalshiCatalogSeriesMetadata(series) {
  const ticker = cleanText(series?.ticker, 120);
  const title = cleanText(series?.title ?? series?.name, 400);
  const category = cleanText(series?.category, 160);
  const tags = safeStringArray(series?.tags, 30);
  const productMetadata = isRecord(series?.product_metadata) ? series.product_metadata : {};
  const importantInfo = isRecord(productMetadata.important_info) ? productMetadata.important_info : {};
  const normalizedTitle = normalizeComparableText(title);
  const metadataRest = normalizeComparableText([
    category, ...tags, productMetadata.scope,
    importantInfo.title, importantInfo.message, importantInfo.markdown,
  ].filter(Boolean).join(" "));
  const metadataText = [normalizedTitle, metadataRest].filter(Boolean).join(" ");
  const normalizedTicker = normalizeComparableText(ticker).replace(/\s+/g, "");
  const sources = Array.isArray(series?.settlement_sources)
    ? series.settlement_sources.filter(isRecord).slice(0, 40) : [];
  const sourceHosts = sources.map(providerSourceHostname).filter(Boolean);
  return {
    ticker, title, category, tags, productMetadata, metadataText, normalizedTitle,
    normalizedTicker, sources, sourceHosts,
  };
}

function kalshiCatalogSeriesSignalMask(metadata) {
  let mask = 0;
  if (metadata.tags.some((tag) => /^(?:video games?|esports?)$/.test(normalizeComparableText(tag)))) {
    mask |= KALSHI_RADAR_CATALOG_SIGNAL_BITS.registered_gaming_taxonomy;
  }
  if (KALSHI_RADAR_CATALOG_EXPLICIT_PATTERNS.some((pattern) => pattern.test(metadata.metadataText))) {
    mask |= KALSHI_RADAR_CATALOG_SIGNAL_BITS.explicit_gaming_metadata;
  }
  if (KALSHI_RADAR_CATALOG_ENTITY_PATTERNS.some((pattern) => pattern.test(metadata.metadataText))) {
    mask |= KALSHI_RADAR_CATALOG_SIGNAL_BITS.gaming_entity_metadata;
  }
  if (KALSHI_RADAR_CATALOG_INDUSTRY_PATTERNS.some((pattern) => pattern.test(metadata.metadataText))) {
    mask |= KALSHI_RADAR_CATALOG_SIGNAL_BITS.gaming_industry_metadata;
  }
  if (KALSHI_RADAR_CATALOG_CREATOR_METADATA_PATTERNS.some((pattern) => pattern.test(metadata.metadataText))
      || KALSHI_RADAR_CATALOG_CREATOR_TICKER_PATTERN.test(metadata.normalizedTicker)) {
    mask |= KALSHI_RADAR_CATALOG_SIGNAL_BITS.creator_theme_metadata;
  }
  if (metadata.sourceHosts.some((host) => providerHostMatches(host, KALSHI_RADAR_CATALOG_OFFICIAL_HOST_SET))) {
    mask |= KALSHI_RADAR_CATALOG_SIGNAL_BITS.official_gaming_source;
  }
  if (metadata.sources.length <= 6
      && metadata.sourceHosts.some((host) => providerHostMatches(host, KALSHI_RADAR_CATALOG_EDITORIAL_HOST_SET))) {
    mask |= KALSHI_RADAR_CATALOG_SIGNAL_BITS.gaming_editorial_source;
  }
  if (metadata.sources.length <= 3
      && metadata.sourceHosts.some((host) => providerHostMatches(host, KALSHI_RADAR_CATALOG_CREATOR_HOST_SET))) {
    mask |= KALSHI_RADAR_CATALOG_SIGNAL_BITS.creator_theme_source;
  }
  return mask;
}

function kalshiCatalogSignalsFromMask(mask) {
  return KALSHI_RADAR_CATALOG_SIGNAL_ORDER
    .filter((signal) => (mask & KALSHI_RADAR_CATALOG_SIGNAL_BITS[signal]) !== 0);
}

function kalshiCatalogSeriesSignals(metadata) {
  return kalshiCatalogSignalsFromMask(kalshiCatalogSeriesSignalMask(metadata));
}

function normalizeKalshiCatalogEntityTerms(terms) {
  return safeStringArray(terms, 1_000)
    .map((term) => normalizeComparableText(term)).filter(Boolean);
}

function kalshiCatalogEntityMatches(metadataText, entityTerms) {
  return kalshiCatalogEntityMatchesFromSet(metadataText, new Set(entityTerms));
}

function kalshiCatalogEntityMatchesFromSet(metadataText, entityTermSet) {
  if (!entityTermSet.size) return [];
  const matches = [];
  const seen = new Set();
  for (const token of metadataText.split(" ")) {
    if (!token || !entityTermSet.has(token) || seen.has(token)) continue;
    seen.add(token);
    matches.push(token);
    if (matches.length >= 20) break;
  }
  return matches;
}

function finalizeKalshiCatalogClassification(metadata, baseSignals, catalogEntityMatches) {
  const signals = catalogEntityMatches.length
    ? [...baseSignals, "catalog_gaming_entity_match"] : [...baseSignals];
  const themeText = normalizeComparableText(`${metadata.title} ${metadata.tags.join(" ")}`);
  const radarThemes = Object.entries(CATEGORY_TERMS)
    .filter(([, terms]) => terms.some((term) => themeText.includes(normalizeComparableText(term))))
    .map(([radarCategory]) => radarCategory);
  return {
    selected: signals.length > 0,
    policy_version: KALSHI_RADAR_SERIES_CATALOG_POLICY_VERSION,
    signals: [...new Set(signals)],
    catalog_entity_matches: catalogEntityMatches,
    radar_themes: radarThemes,
    inferred_atinara_category: inferAtinaraCategory(
      metadata.title, metadata.tags, metadata.productMetadata.scope,
    ),
  };
}

function scanKalshiRadarCatalogV2(seriesRows, { preserveAnalysis = false } = {}) {
  if (!Array.isArray(seriesRows)) throw new TypeError("PROVIDER_DISCOVERY_CATALOG_INVALID");
  const rows = seriesRows.filter(isRecord);
  const globalFrequency = new Map();
  const trustedFrequency = new Map();
  const trustedAcronyms = new Set();
  const preparedMetadataTexts = preserveAnalysis ? new Array(rows.length) : null;
  const preparedSignalMasks = preserveAnalysis ? new Uint16Array(rows.length) : null;
  for (let index = 0; index < rows.length; index += 1) {
    const series = rows[index];
    const metadata = kalshiCatalogSeriesMetadata(series);
    const extracted = kalshiCatalogEntityTokens(
      series, metadata.title, metadata.normalizedTitle,
    );
    for (const token of extracted.tokens) {
      globalFrequency.set(token, (globalFrequency.get(token) ?? 0) + 1);
    }
    const signalMask = kalshiCatalogSeriesSignalMask(metadata);
    if (preparedMetadataTexts && preparedSignalMasks) {
      preparedMetadataTexts[index] = metadata.metadataText;
      preparedSignalMasks[index] = signalMask;
    }
    if ((signalMask & KALSHI_RADAR_CATALOG_ENTITY_SEED_MASK) === 0) continue;
    for (const token of extracted.tokens) {
      trustedFrequency.set(token, (trustedFrequency.get(token) ?? 0) + 1);
    }
    for (const token of extracted.uppercase_acronyms) trustedAcronyms.add(token);
  }
  const entityTerms = [...trustedFrequency.entries()]
    .filter(([token, trustedCount]) => {
      const globalCount = globalFrequency.get(token) ?? 0;
      return globalCount > 0 && globalCount <= 40
        && trustedCount / globalCount >= 0.5
        && (trustedCount >= 2 || trustedAcronyms.has(token));
    })
    .sort((left, right) => right[1] - left[1]
      || (left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0))
    .slice(0, 1_000)
    .map(([token]) => token);
  return { rows, entityTerms, preparedMetadataTexts, preparedSignalMasks };
}

/**
 * Deriva un vocabulario efímero desde series que el propio catálogo ya acredita
 * por taxonomía, metadatos o autoridad. Permite descubrir series hermanas que
 * solo nombran la entidad, sin incorporar una lista cerrada de títulos o IDs.
 */
export function buildKalshiRadarCatalogEntityTermsV2(seriesRows = []) {
  return scanKalshiRadarCatalogV2(seriesRows).entityTerms;
}

/**
 * Analiza el catálogo completo sin clasificar dos veces las filas descartadas.
 * Conserva las mismas señales y términos que la ruta unitaria, pero solo
 * materializa clasificaciones para las series finalmente seleccionadas.
 */
export function analyzeKalshiRadarSeriesCatalogV2(seriesRows = []) {
  const { rows, entityTerms, preparedMetadataTexts, preparedSignalMasks } = scanKalshiRadarCatalogV2(
    seriesRows, { preserveAnalysis: true },
  );
  const entityTermSet = new Set(entityTerms);
  const selected = [];
  for (let index = 0; index < rows.length; index += 1) {
    const signalMask = preparedSignalMasks?.[index] ?? 0;
    const catalogEntityMatches = kalshiCatalogEntityMatchesFromSet(
      preparedMetadataTexts?.[index] ?? "", entityTermSet,
    );
    if (!signalMask && !catalogEntityMatches.length) continue;
    const source = rows[index];
    const metadata = kalshiCatalogSeriesMetadata(source);
    selected.push({
      source,
      classification: finalizeKalshiCatalogClassification(
        metadata, kalshiCatalogSignalsFromMask(signalMask), catalogEntityMatches,
      ),
    });
  }
  return { entity_terms: entityTerms, selected };
}

function providerSourceHostname(source) {
  const value = cleanText(source?.url, 2048);
  const commonHttpHost = /^https?:\/\/([a-z0-9.-]+)(?::\d+)?(?:[/?#]|$)/i.exec(value)?.[1];
  if (commonHttpHost) return commonHttpHost.toLowerCase();
  try { return new URL(value).hostname.toLowerCase(); }
  catch { return ""; }
}

function providerHostMatches(hostname, allowedHosts) {
  if (!hostname) return false;
  let candidate = hostname;
  while (candidate) {
    if (allowedHosts.has(candidate)) return true;
    const separator = candidate.indexOf(".");
    if (separator < 0) return false;
    candidate = candidate.slice(separator + 1);
  }
  return false;
}

/**
 * Clasifica una serie del catálogo global de Kalshi con reglas de dominio y
 * temática. Las señales son categorías, metadatos, entidades y autoridades;
 * nunca tickers concretos de mercados ni excepciones por evento observado.
 */
export function classifyKalshiRadarSeriesCatalogV2(series = {}, options = {}) {
  const metadata = kalshiCatalogSeriesMetadata(series);
  const signals = kalshiCatalogSeriesSignals(metadata);
  const entityTerms = normalizeKalshiCatalogEntityTerms(options.catalog_entity_terms);
  const catalogEntityMatches = kalshiCatalogEntityMatches(metadata.metadataText, entityTerms);
  return finalizeKalshiCatalogClassification(metadata, signals, catalogEntityMatches);
}

const PROVIDER_PLACEHOLDER_PATTERNS = Object.freeze([
  /^(?:game|juego)\s+[a-z0-9]$/,
  /^(?:game|juego)\s+[a-z]\s*[-–]\s*[a-z]$/,
  /^(?:another|other|otro)\s+(?:game|juego)$/,
  /^(?:tbd|to be determined|por determinar|placeholder|unknown option)$/,
]);

export const RADAR_PARENT_RECONCILIATION_STATUSES = Object.freeze([
  "complete",
  "incomplete_provider_metadata",
  "inconsistent_provider_count",
  "refresh_required",
  "provider_unavailable",
  "historical_mapping_required",
  "terminal_provider_corruption",
]);

export const RADAR_PROVIDER_CHILD_CLASSIFICATIONS = Object.freeze([
  "identified_real_option",
  "provider_placeholder_pending_resolution",
  "aggregate_other_option",
  "tie_option",
  "no_winner_option",
  "provider_removed_child",
  "provider_closed_child",
  "provider_duplicate_child",
  "provider_data_conflict",
]);

/**
 * Consume un cursor oficial hasta agotarlo. Una página perdida, un cursor
 * repetido o alcanzar el límite con `next_cursor` pendiente falla cerrado.
 * @param {(cursor:string,page:number)=>Promise<any>} fetchPage
 * @param {{itemsField?:string,cursorField?:string,maxPages?:number}} options
 */
export async function collectProviderCursorPages(fetchPage, options = {}) {
  if (typeof fetchPage !== "function") throw new TypeError("PROVIDER_PAGE_FETCH_REQUIRED");
  const itemsField = cleanText(options.itemsField, 80) || "items";
  const cursorField = cleanText(options.cursorField, 80) || "cursor";
  const maxPages = Math.max(1, Math.min(100, Math.floor(Number(options.maxPages) || 50)));
  const items = [];
  const seenCursors = new Set();
  let cursor = "";
  for (let page = 0; page < maxPages; page += 1) {
    const payload = await fetchPage(cursor, page);
    if (!isRecord(payload) || !Array.isArray(payload[itemsField])) {
      throw new TypeError("PROVIDER_INVALID_RESPONSE");
    }
    items.push(...payload[itemsField].filter(isRecord));
    const nextCursor = cleanText(payload[cursorField], 500);
    if (!nextCursor) return { items, provider_pagination_exhausted: true, page_count: page + 1 };
    if (seenCursors.has(nextCursor)) throw new TypeError("PROVIDER_CURSOR_REPEATED");
    seenCursors.add(nextCursor);
    cursor = nextCursor;
  }
  throw new TypeError("PROVIDER_PAGINATION_INCOMPLETE");
}

/**
 * Construye el checkpoint pre-manifest a partir del resultado real de cada
 * serie. Cada padre debe pertenecer a la serie consultada y una identidad
 * repetida con contenido distinto falla cerrada.
 */
export function buildProviderDiscoveryCheckpointV1(input = {}) {
  const schemaVersion = cleanText(input.schema_version, 100);
  const checkedAt = cleanText(input.checked_at, 100);
  const checkedAtMs = Date.parse(checkedAt);
  const taxonomyScopes = Array.isArray(input.taxonomy_scopes) ? input.taxonomy_scopes : [];
  const failedTaxonomyScopes = Array.isArray(input.failed_taxonomy_scopes)
    ? input.failed_taxonomy_scopes : [];
  const series = Array.isArray(input.series) ? input.series : [];
  const eventResults = Array.isArray(input.event_results) ? input.event_results : [];
  const maxSeries = Math.max(1, Math.min(10_000, Math.floor(Number(input.max_series) || 2_000)));
  const maxParents = Math.max(1, Math.min(10_000, Math.floor(Number(input.max_parents) || 2_000)));
  const maxBytes = Math.max(1_024, Math.min(10_000_000, Math.floor(Number(input.max_bytes) || 2_000_000)));
  if (schemaVersion !== "atinara-provider-discovery-checkpoint-v1"
    || !Number.isFinite(checkedAtMs)
    || series.length > maxSeries
    || eventResults.length !== series.length) {
    throw new TypeError("PROVIDER_DISCOVERY_CHECKPOINT_INVALID");
  }

  const normalizeScope = (scope) => ({
    category: cleanText(scope?.category, 160),
    tag: cleanText(scope?.tag, 160),
  });
  const normalizedTaxonomyScopes = taxonomyScopes.map(normalizeScope);
  const normalizedFailedTaxonomyScopes = failedTaxonomyScopes.map(normalizeScope);
  const taxonomyScopeIdentity = (scope) => `${scope.category}\u0000${scope.tag}`;
  const taxonomyScopeIds = normalizedTaxonomyScopes.map(taxonomyScopeIdentity);
  const taxonomyScopeIdSet = new Set(taxonomyScopeIds);
  const failedTaxonomyScopeIds = normalizedFailedTaxonomyScopes.map(taxonomyScopeIdentity);
  if (normalizedTaxonomyScopes.some((scope) => !scope.category || !scope.tag)
    || normalizedFailedTaxonomyScopes.some((scope) => !scope.category || !scope.tag)
    || taxonomyScopeIdSet.size !== taxonomyScopeIds.length
    || new Set(failedTaxonomyScopeIds).size !== failedTaxonomyScopeIds.length
    || failedTaxonomyScopeIds.some((identity) => !taxonomyScopeIdSet.has(identity))) {
    throw new TypeError("PROVIDER_DISCOVERY_TAXONOMY_SCOPE_INVALID");
  }

  const seriesIds = series.map((item) => cleanText(item?.ticker, 120));
  if (seriesIds.some((identity) => !identity)
    || new Set(seriesIds).size !== seriesIds.length) {
    throw new TypeError("PROVIDER_DISCOVERY_SERIES_IDENTITY_INVALID");
  }
  const seriesIdSet = new Set(seriesIds);
  const failedSeriesIds = [];
  const eventsByIdentity = new Map();
  for (let index = 0; index < eventResults.length; index += 1) {
    const result = eventResults[index];
    const expectedSeriesId = seriesIds[index];
    if (result?.status === "rejected") {
      failedSeriesIds.push(expectedSeriesId);
      continue;
    }
    if (result?.status !== "fulfilled" || !Array.isArray(result.value)) {
      throw new TypeError("PROVIDER_DISCOVERY_SERIES_RESULT_INVALID");
    }
    for (const event of result.value) {
      const eventId = cleanText(event?.event_ticker ?? event?.ticker, 160);
      const eventSeriesId = cleanText(event?.series_ticker, 120);
      if (!eventId || eventSeriesId !== expectedSeriesId || !seriesIdSet.has(eventSeriesId)) {
        throw new TypeError("PROVIDER_DISCOVERY_PARENT_MEMBERSHIP_INVALID");
      }
      const current = eventsByIdentity.get(eventId);
      if (current && canonicalJson(current) !== canonicalJson(event)) {
        throw new TypeError("PROVIDER_DISCOVERY_PARENT_IDENTITY_CONFLICT");
      }
      if (!current) eventsByIdentity.set(eventId, event);
    }
  }
  const events = [...eventsByIdentity.values()];
  if (events.length > maxParents) {
    throw new TypeError("PROVIDER_PARENT_SCOPE_LIMIT_EXCEEDED");
  }
  const checkpoint = {
    schema_version: schemaVersion,
    checked_at: new Date(checkedAtMs).toISOString(),
    taxonomy_scopes: normalizedTaxonomyScopes,
    total_taxonomy_scope_count: normalizedTaxonomyScopes.length,
    completed_taxonomy_scope_count:
      normalizedTaxonomyScopes.length - normalizedFailedTaxonomyScopes.length,
    failed_taxonomy_scope_count: normalizedFailedTaxonomyScopes.length,
    failed_taxonomy_scopes: normalizedFailedTaxonomyScopes,
    total_series_count: series.length,
    completed_series_count: series.length - failedSeriesIds.length,
    failed_series_count: failedSeriesIds.length,
    failed_series_ids: failedSeriesIds,
    total_parent_count: events.length,
    series,
    events,
  };
  if (new TextEncoder().encode(JSON.stringify(checkpoint)).byteLength > maxBytes) {
    throw new TypeError("PROVIDER_DISCOVERY_CHECKPOINT_TOO_LARGE");
  }
  return checkpoint;
}

function normalizeProviderDiscoverySeriesV2(item) {
  if (!isRecord(item)) throw new TypeError("PROVIDER_DISCOVERY_SERIES_INVALID");
  const ticker = cleanText(item.ticker, 120);
  if (!ticker) throw new TypeError("PROVIDER_DISCOVERY_SERIES_IDENTITY_INVALID");
  return {
    ...item,
    ticker,
    title: cleanText(item.title ?? item.name, 400),
    category: cleanText(item.category, 160),
    tags: safeStringArray(item.tags, 30),
    catalog_signals: safeStringArray(item.catalog_signals, 20),
    catalog_entity_matches: safeStringArray(item.catalog_entity_matches, 20),
    radar_themes: safeStringArray(item.radar_themes, 6)
      .filter((category) => RADAR_CATEGORIES.includes(category)),
    inferred_atinara_category: RADAR_CATEGORIES.includes(item.inferred_atinara_category)
      ? item.inferred_atinara_category : inferAtinaraCategory(item.title, item.tags),
  };
}

function normalizeProviderDiscoveryEventV2(event, expectedSeriesId) {
  if (!isRecord(event)) throw new TypeError("PROVIDER_DISCOVERY_PARENT_INVALID");
  const eventTicker = cleanText(event.event_ticker ?? event.ticker, 160);
  const seriesTicker = cleanText(event.series_ticker, 120);
  if (!eventTicker || seriesTicker !== expectedSeriesId) {
    throw new TypeError("PROVIDER_DISCOVERY_PARENT_MEMBERSHIP_INVALID");
  }
  return { ...event, event_ticker: eventTicker, series_ticker: seriesTicker };
}

/**
 * Valida un snapshot V2 y deriva el trabajo pendiente sin confiar en sus
 * contadores declarados. Cada resultado representa el último estado durable de
 * una serie; un padre solo puede pertenecer a una serie completada.
 */
export function providerDiscoveryCheckpointV2State(checkpoint = {}, options = {}) {
  const maxSeries = Math.max(1, Math.min(10_000, Math.floor(Number(options.max_series) || 2_000)));
  const maxParents = Math.max(1, Math.min(10_000, Math.floor(Number(options.max_parents) || 2_000)));
  const maxAttempts = Math.max(1, Math.min(10, Math.floor(Number(options.max_attempts) || 4)));
  const maxBytes = Math.max(64_000, Math.min(10_000_000,
    Math.floor(Number(options.max_bytes) || 4_000_000)));
  if (!isRecord(checkpoint)
      || cleanText(checkpoint.schema_version, 100) !== RADAR_PROVIDER_DISCOVERY_CHECKPOINT_V2
      || !Number.isSafeInteger(Number(checkpoint.sequence))
      || Number(checkpoint.sequence) < 1
      || Number(checkpoint.sequence) > 1_000
      || !Number.isFinite(Date.parse(cleanText(checkpoint.checked_at, 100)))
      || !Array.isArray(checkpoint.series)
      || !Array.isArray(checkpoint.series_results)
      || checkpoint.series.length < 1
      || checkpoint.series.length > maxSeries
      || checkpoint.series_results.length > checkpoint.series.length) {
    throw new TypeError("PROVIDER_DISCOVERY_CHECKPOINT_V2_INVALID");
  }
  const sequence = Number(checkpoint.sequence);
  const previousHash = cleanText(checkpoint.previous_checkpoint_hash, 80);
  if ((sequence === 1 && previousHash)
      || (sequence > 1 && !/^[a-f0-9]{64}$/.test(previousHash))) {
    throw new TypeError("PROVIDER_DISCOVERY_CHECKPOINT_CHAIN_INVALID");
  }
  const catalog = isRecord(checkpoint.catalog) ? checkpoint.catalog : null;
  const providerCatalogHash = cleanText(catalog?.provider_catalog_hash, 80);
  const totalProviderSeriesCount = Number(catalog?.total_provider_series_count);
  if (!catalog
      || cleanText(catalog.catalog_version, 100) !== "atinara-kalshi-series-catalog-evidence-v2"
      || cleanText(catalog.source_endpoint, 120) !== "/trade-api/v2/series"
      || cleanText(catalog.query_contract, 160)
        !== "include_product_metadata=true&include_volume=true"
      || cleanText(catalog.selection_policy_version, 120)
        !== KALSHI_RADAR_SERIES_CATALOG_POLICY_VERSION
      || cleanText(catalog.entity_policy_version, 120)
        !== KALSHI_RADAR_CATALOG_ENTITY_POLICY_VERSION
      || !/^[a-f0-9]{64}$/.test(cleanText(catalog.entity_terms_hash, 80))
      || !Number.isSafeInteger(Number(catalog.entity_term_count))
      || Number(catalog.entity_term_count) < 0
      || Number(catalog.entity_term_count) > 1_000
      || cleanText(catalog.projection_version, 120)
        !== "atinara-kalshi-series-catalog-projection-v1"
      || catalog.provider_pagination_exhausted !== true
      || catalog.provider_cursor !== null
      || !/^[a-f0-9]{64}$/.test(providerCatalogHash)
      || !Number.isSafeInteger(totalProviderSeriesCount)
      || totalProviderSeriesCount < checkpoint.series.length
      || totalProviderSeriesCount > 100_000
      || Number(catalog.selected_series_count) !== checkpoint.series.length
      || !Number.isFinite(Date.parse(cleanText(catalog.checked_at, 100)))) {
    throw new TypeError("PROVIDER_DISCOVERY_CATALOG_EVIDENCE_INVALID");
  }
  const series = checkpoint.series.map(normalizeProviderDiscoverySeriesV2);
  const seriesIds = series.map((item) => item.ticker);
  if (new Set(seriesIds).size !== seriesIds.length
      || series.some((item) => item.catalog_signals.length === 0)) {
    throw new TypeError("PROVIDER_DISCOVERY_SERIES_IDENTITY_INVALID");
  }
  const seriesIdSet = new Set(seriesIds);
  const results = [];
  const resultIds = new Set();
  const parentByIdentity = new Map();
  for (const rawResult of checkpoint.series_results) {
    if (!isRecord(rawResult)) throw new TypeError("PROVIDER_DISCOVERY_SERIES_RESULT_INVALID");
    const seriesTicker = cleanText(rawResult.series_ticker, 120);
    const status = cleanText(rawResult.status, 40);
    const attemptCount = Number(rawResult.attempt_count);
    const resultCheckedAt = cleanText(rawResult.checked_at, 100);
    if (!seriesIdSet.has(seriesTicker) || resultIds.has(seriesTicker)
        || !["fulfilled", "rejected"].includes(status)
        || !Number.isSafeInteger(attemptCount) || attemptCount < 1 || attemptCount > maxAttempts
        || !Number.isFinite(Date.parse(resultCheckedAt))) {
      throw new TypeError("PROVIDER_DISCOVERY_SERIES_RESULT_INVALID");
    }
    resultIds.add(seriesTicker);
    if (status === "rejected") {
      const errorCode = cleanText(rawResult.error_code, 100);
      const retryAfterAt = cleanText(rawResult.retry_after_at, 100);
      if (!/^[A-Z][A-Z0-9_]{2,100}$/.test(errorCode)
          || (retryAfterAt && !Number.isFinite(Date.parse(retryAfterAt)))
          || (Array.isArray(rawResult.events) && rawResult.events.length)) {
        throw new TypeError("PROVIDER_DISCOVERY_SERIES_RESULT_INVALID");
      }
      results.push({
        series_ticker: seriesTicker,
        status,
        attempt_count: attemptCount,
        checked_at: new Date(Date.parse(resultCheckedAt)).toISOString(),
        error_code: errorCode,
        retry_after_at: retryAfterAt ? new Date(Date.parse(retryAfterAt)).toISOString() : null,
        events: [],
      });
      continue;
    }
    if (!Array.isArray(rawResult.events) || rawResult.error_code) {
      throw new TypeError("PROVIDER_DISCOVERY_SERIES_RESULT_INVALID");
    }
    const events = rawResult.events.map((event) =>
      normalizeProviderDiscoveryEventV2(event, seriesTicker));
    for (const event of events) {
      const identity = cleanText(event.event_ticker, 160);
      const existing = parentByIdentity.get(identity);
      if (existing && canonicalJson(existing) !== canonicalJson(event)) {
        throw new TypeError("PROVIDER_DISCOVERY_PARENT_IDENTITY_CONFLICT");
      }
      if (existing) throw new TypeError("PROVIDER_DISCOVERY_PARENT_IDENTITY_CONFLICT");
      parentByIdentity.set(identity, event);
    }
    results.push({
      series_ticker: seriesTicker,
      status,
      attempt_count: attemptCount,
      checked_at: new Date(Date.parse(resultCheckedAt)).toISOString(),
      error_code: null,
      retry_after_at: null,
      events,
    });
  }
  if (parentByIdentity.size > maxParents) {
    throw new TypeError("PROVIDER_PARENT_SCOPE_LIMIT_EXCEEDED");
  }
  const resultBySeries = new Map(results.map((result) => [result.series_ticker, result]));
  const completedSeriesIds = seriesIds.filter((ticker) => resultBySeries.get(ticker)?.status === "fulfilled");
  const failedSeriesIds = seriesIds.filter((ticker) => resultBySeries.get(ticker)?.status === "rejected");
  const pendingSeriesIds = seriesIds.filter((ticker) => !resultBySeries.has(ticker));
  const retryableFailedSeriesIds = failedSeriesIds.filter((ticker) =>
    Number(resultBySeries.get(ticker)?.attempt_count) < maxAttempts);
  const exhaustedFailedSeriesIds = failedSeriesIds.filter((ticker) =>
    Number(resultBySeries.get(ticker)?.attempt_count) >= maxAttempts);
  if (Number(checkpoint.total_series_count) !== series.length
      || Number(checkpoint.completed_series_count) !== completedSeriesIds.length
      || Number(checkpoint.failed_series_count) !== failedSeriesIds.length
      || Number(checkpoint.pending_series_count) !== pendingSeriesIds.length
      || Number(checkpoint.retryable_failed_series_count) !== retryableFailedSeriesIds.length
      || Number(checkpoint.exhausted_failed_series_count) !== exhaustedFailedSeriesIds.length
      || Number(checkpoint.total_parent_count) !== parentByIdentity.size) {
    throw new TypeError("PROVIDER_DISCOVERY_CHECKPOINT_V2_COUNT_INVALID");
  }
  if (new TextEncoder().encode(JSON.stringify(checkpoint)).byteLength > maxBytes) {
    throw new TypeError("PROVIDER_DISCOVERY_CHECKPOINT_TOO_LARGE");
  }
  return {
    sequence,
    catalog,
    series,
    results,
    events: [...parentByIdentity.values()],
    completed_series_ids: completedSeriesIds,
    failed_series_ids: failedSeriesIds,
    pending_series_ids: pendingSeriesIds,
    retryable_failed_series_ids: retryableFailedSeriesIds,
    exhausted_failed_series_ids: exhaustedFailedSeriesIds,
    ready: pendingSeriesIds.length === 0 && retryableFailedSeriesIds.length === 0,
  };
}

export function buildProviderDiscoveryCheckpointV2(input = {}) {
  const checkedAtMs = Date.parse(cleanText(input.checked_at, 100));
  const series = Array.isArray(input.series)
    ? input.series.map(normalizeProviderDiscoverySeriesV2) : [];
  const catalogInput = isRecord(input.catalog) ? input.catalog : {};
  if (!Number.isFinite(checkedAtMs)) throw new TypeError("PROVIDER_DISCOVERY_CHECKPOINT_V2_INVALID");
  const checkedAt = new Date(checkedAtMs).toISOString();
  const checkpoint = {
    schema_version: RADAR_PROVIDER_DISCOVERY_CHECKPOINT_V2,
    sequence: 1,
    previous_checkpoint_hash: null,
    checked_at: checkedAt,
    last_batch_checked_at: null,
    catalog: {
      catalog_version: "atinara-kalshi-series-catalog-evidence-v2",
      source_endpoint: "/trade-api/v2/series",
      query_contract: "include_product_metadata=true&include_volume=true",
      selection_policy_version: KALSHI_RADAR_SERIES_CATALOG_POLICY_VERSION,
      entity_policy_version: KALSHI_RADAR_CATALOG_ENTITY_POLICY_VERSION,
      entity_terms_hash: cleanText(catalogInput.entity_terms_hash, 80),
      entity_term_count: Number(catalogInput.entity_term_count),
      projection_version: "atinara-kalshi-series-catalog-projection-v1",
      checked_at: checkedAt,
      provider_catalog_hash: cleanText(catalogInput.provider_catalog_hash, 80),
      total_provider_series_count: Number(catalogInput.total_provider_series_count),
      selected_series_count: series.length,
      provider_pagination_exhausted: catalogInput.provider_pagination_exhausted === true,
      provider_cursor: catalogInput.provider_cursor ?? null,
    },
    total_series_count: series.length,
    completed_series_count: 0,
    failed_series_count: 0,
    pending_series_count: series.length,
    retryable_failed_series_count: 0,
    exhausted_failed_series_count: 0,
    total_parent_count: 0,
    series,
    series_results: [],
  };
  providerDiscoveryCheckpointV2State(checkpoint, input);
  return checkpoint;
}

export function advanceProviderDiscoveryCheckpointV2(checkpoint = {}, batchResults = [], options = {}) {
  const maxBatch = Math.max(1, Math.min(120, Math.floor(Number(options.max_batch) || 48)));
  const previousHash = cleanText(options.previous_checkpoint_hash, 80);
  const state = providerDiscoveryCheckpointV2State(checkpoint, options);
  if (!Array.isArray(batchResults) || !batchResults.length || batchResults.length > maxBatch
      || !/^[a-f0-9]{64}$/.test(previousHash)) {
    throw new TypeError("PROVIDER_DISCOVERY_BATCH_INVALID");
  }
  const incomingIds = batchResults.map((result) => cleanText(result?.series_ticker, 120));
  if (incomingIds.some((ticker) => !ticker) || new Set(incomingIds).size !== incomingIds.length) {
    throw new TypeError("PROVIDER_DISCOVERY_BATCH_INVALID");
  }
  const seriesIdSet = new Set(state.series.map((series) => series.ticker));
  const currentBySeries = new Map(state.results.map((result) => [result.series_ticker, result]));
  const maxAttempts = Math.max(1, Math.min(10, Math.floor(Number(options.max_attempts) || 4)));
  let lastBatchCheckedAt = "";
  for (const incoming of batchResults) {
    if (!isRecord(incoming)) throw new TypeError("PROVIDER_DISCOVERY_BATCH_INVALID");
    const seriesTicker = cleanText(incoming.series_ticker, 120);
    const status = cleanText(incoming.status, 40);
    const checkedAtMs = Date.parse(cleanText(incoming.checked_at, 100));
    const current = currentBySeries.get(seriesTicker);
    if (!seriesIdSet.has(seriesTicker) || !["fulfilled", "rejected"].includes(status)
        || !Number.isFinite(checkedAtMs) || current?.status === "fulfilled"
        || Number(current?.attempt_count ?? 0) >= maxAttempts) {
      throw new TypeError("PROVIDER_DISCOVERY_BATCH_TRANSITION_INVALID");
    }
    const checkedAt = new Date(checkedAtMs).toISOString();
    if (!lastBatchCheckedAt || checkedAt > lastBatchCheckedAt) lastBatchCheckedAt = checkedAt;
    const attemptCount = Number(current?.attempt_count ?? 0) + 1;
    if (status === "fulfilled") {
      const events = Array.isArray(incoming.events)
        ? incoming.events.map((event) => normalizeProviderDiscoveryEventV2(event, seriesTicker)) : null;
      if (!events) throw new TypeError("PROVIDER_DISCOVERY_BATCH_INVALID");
      currentBySeries.set(seriesTicker, {
        series_ticker: seriesTicker,
        status,
        attempt_count: attemptCount,
        checked_at: checkedAt,
        error_code: null,
        retry_after_at: null,
        events,
      });
      continue;
    }
    const errorCode = cleanText(incoming.error_code, 100);
    const retryAfterAtMs = incoming.retry_after_at
      ? Date.parse(cleanText(incoming.retry_after_at, 100)) : NaN;
    if (!/^[A-Z][A-Z0-9_]{2,100}$/.test(errorCode)
        || (incoming.retry_after_at && !Number.isFinite(retryAfterAtMs))) {
      throw new TypeError("PROVIDER_DISCOVERY_BATCH_INVALID");
    }
    currentBySeries.set(seriesTicker, {
      series_ticker: seriesTicker,
      status,
      attempt_count: attemptCount,
      checked_at: checkedAt,
      error_code: errorCode,
      retry_after_at: Number.isFinite(retryAfterAtMs)
        ? new Date(retryAfterAtMs).toISOString() : null,
      events: [],
    });
  }
  const seriesResults = state.series.map((series) => currentBySeries.get(series.ticker)).filter(Boolean);
  const completed = seriesResults.filter((result) => result.status === "fulfilled");
  const failed = seriesResults.filter((result) => result.status === "rejected");
  const retryableFailed = failed.filter((result) => result.attempt_count < maxAttempts);
  const totalParents = completed.reduce((total, result) => total + result.events.length, 0);
  const next = {
    ...checkpoint,
    sequence: state.sequence + 1,
    previous_checkpoint_hash: previousHash,
    last_batch_checked_at: lastBatchCheckedAt,
    completed_series_count: completed.length,
    failed_series_count: failed.length,
    pending_series_count: state.series.length - seriesResults.length,
    retryable_failed_series_count: retryableFailed.length,
    exhausted_failed_series_count: failed.length - retryableFailed.length,
    total_parent_count: totalParents,
    series: state.series,
    series_results: seriesResults,
  };
  providerDiscoveryCheckpointV2State(next, options);
  return next;
}

export function projectProviderDiscoveryCheckpointV2(checkpoint = {}, options = {}) {
  const state = providerDiscoveryCheckpointV2State(checkpoint, options);
  if (!state.ready) throw new TypeError("PROVIDER_DISCOVERY_CHECKPOINT_V2_NOT_READY");
  return {
    schema_version: RADAR_PROVIDER_DISCOVERY_CHECKPOINT_V2,
    checked_at: new Date(Date.parse(cleanText(checkpoint.checked_at, 100))).toISOString(),
    taxonomy_scopes: [],
    total_taxonomy_scope_count: 0,
    completed_taxonomy_scope_count: 0,
    failed_taxonomy_scope_count: 0,
    failed_taxonomy_scopes: [],
    total_series_count: state.series.length,
    completed_series_count: state.completed_series_ids.length,
    failed_series_count: state.exhausted_failed_series_ids.length,
    failed_series_ids: state.exhausted_failed_series_ids,
    total_parent_count: state.events.length,
    series: state.series,
    events: state.events,
    catalog_evidence: state.catalog,
  };
}

/**
 * Une las series devueltas por varias taxonomías sin perder la pertenencia a
 * ninguna de ellas. Conserva la primera representación de proveedor y suma
 * scopes por identidad categórica exacta.
 */
export function mergeProviderTaxonomySeriesV1(scopedResults = [], expectedScopes = []) {
  if (!Array.isArray(scopedResults) || !Array.isArray(expectedScopes)
    || (expectedScopes.length && expectedScopes.length !== scopedResults.length)) {
    throw new TypeError("PROVIDER_TAXONOMY_RESULTS_INVALID");
  }
  const sourceByTicker = new Map();
  const failedScopes = [];
  const scopeIdentity = (scope) => `${scope.category}\u0000${scope.tag}`;
  for (let index = 0; index < scopedResults.length; index += 1) {
    const result = scopedResults[index];
    const fallbackScope = expectedScopes[index];
    const fallbackCategory = cleanText(fallbackScope?.category, 160);
    const fallbackTag = cleanText(fallbackScope?.tag, 160);
    if (result?.status === "rejected") {
      if (!fallbackCategory || !fallbackTag) {
        throw new TypeError("PROVIDER_TAXONOMY_SCOPE_INVALID");
      }
      failedScopes.push({ category: fallbackCategory, tag: fallbackTag });
      continue;
    }
    const value = result?.status === "fulfilled" && isRecord(result.value) ? result.value : null;
    const scope = isRecord(value?.scope) ? value.scope : null;
    const sourceSeries = Array.isArray(value?.series) ? value.series : null;
    const category = cleanText(scope?.category, 160);
    const tag = cleanText(scope?.tag, 160);
    if (!scope || !sourceSeries || !category || !tag) {
      throw new TypeError("PROVIDER_TAXONOMY_SCOPE_INVALID");
    }
    const normalizedScope = { category, tag };
    if ((fallbackCategory || fallbackTag)
      && scopeIdentity(normalizedScope) !== scopeIdentity({
        category: fallbackCategory,
        tag: fallbackTag,
      })) {
      throw new TypeError("PROVIDER_TAXONOMY_SCOPE_MEMBERSHIP_INVALID");
    }
    for (const source of sourceSeries) {
      const ticker = cleanText(source?.ticker, 120);
      if (!ticker) continue;
      const current = sourceByTicker.get(ticker);
      const scopeMap = new Map([
        ...(current?.scopes ?? []),
        normalizedScope,
      ].map((item) => [`${item.category}\u0000${item.tag}`, item]));
      sourceByTicker.set(ticker, {
        source: current?.source ?? source,
        scopes: [...scopeMap.values()],
      });
    }
  }
  return {
    entries: [...sourceByTicker.values()],
    failed_scopes: failedScopes,
  };
}

export function buildRadarPersistenceBatches(entries = [], options = {}) {
  const maxItems = Math.max(1, Math.min(24, Math.floor(Number(options.maxItems) || 24)));
  const maxBytes = Math.max(64_000, Math.min(1_000_000, Math.floor(Number(options.maxBytes) || 700_000)));
  const source = Array.isArray(entries) ? entries : [];
  const batches = [];
  let current = [];
  const bytes = (value) => new TextEncoder().encode(JSON.stringify(value)).byteLength;
  for (const entry of source) {
    if (!isRecord(entry)) throw new TypeError("RADAR_PERSISTENCE_ENTRY_INVALID");
    if (bytes([entry]) > maxBytes) throw new TypeError("RADAR_PERSISTENCE_ENTRY_TOO_LARGE");
    const candidate = [...current, entry];
    if (current.length && (candidate.length > maxItems || bytes(candidate) > maxBytes)) {
      batches.push(current);
      current = [entry];
    } else current = candidate;
  }
  if (current.length) batches.push(current);
  return batches;
}

export function selectWholeProviderParents(events = [], options = {}) {
  const source = Array.isArray(events) ? events.filter(isRecord) : [];
  const maxChildren = Math.max(1, Math.min(480, Math.floor(Number(options.maxChildren) || 480)));
  const maxParents = Math.max(1, Math.min(120, Math.floor(Number(options.maxParents) || 120)));
  const maxTotalParents = Math.max(maxParents, Math.min(2000,
    Math.floor(Number(options.maxTotalParents) || 2000)));
  const countChildren = options.countChildren !== false;
  if (source.length > maxTotalParents) throw new TypeError("PROVIDER_PARENT_SCOPE_LIMIT_EXCEEDED");
  const parentId = (event) => cleanText(
    event.id ?? event.event_ticker ?? event.ticker ?? event.slug, 220,
  );
  const parentIds = source.map(parentId);
  if (parentIds.some((identity) => !identity)
    || new Set(parentIds).size !== parentIds.length) {
    throw new TypeError("PROVIDER_PARENT_IDENTITY_CONFLICT");
  }
  const selected = [];
  const deferred = [];
  let selectedChildren = 0;
  for (const event of source) {
    const childCount = countChildren && Array.isArray(event.markets)
      ? event.markets.filter(isRecord).length : 0;
    if (childCount > maxChildren) throw new TypeError("PROVIDER_PARENT_CHILD_LIMIT_EXCEEDED");
    if (selected.length < maxParents && selectedChildren + childCount <= maxChildren) {
      selected.push(event);
      selectedChildren += childCount;
    } else deferred.push(event);
  }
  return {
    selected,
    selection: {
      policy_version: "atinara-radar-parent-selection-v1",
      total_parent_count: source.length,
      selected_parent_count: selected.length,
      deferred_parent_count: deferred.length,
      selected_child_count: selectedChildren,
      no_parent_truncated: true,
      selected_parent_ids: selected.map(parentId),
      deferred_parent_ids: deferred.map(parentId),
    },
  };
}

export function mergeProviderParentSelections(indexSelection = {}, childSelection = {}) {
  const total = Math.max(0, Math.floor(Number(indexSelection.total_parent_count) || 0));
  const selectedIds = Array.isArray(childSelection.selected_parent_ids)
    ? childSelection.selected_parent_ids.map((value) => cleanText(value, 220)).filter(Boolean) : [];
  const deferredIds = [...new Set([
    ...(Array.isArray(childSelection.deferred_parent_ids) ? childSelection.deferred_parent_ids : []),
    ...(Array.isArray(indexSelection.deferred_parent_ids) ? indexSelection.deferred_parent_ids : []),
  ].map((value) => cleanText(value, 220)).filter(Boolean))];
  if (selectedIds.length > 120 || total > 2000 || deferredIds.length > 2000
    || total !== selectedIds.length + deferredIds.length
    || selectedIds.some((identity) => deferredIds.includes(identity))) {
    throw new TypeError("PROVIDER_PARENT_SELECTION_INCONSISTENT");
  }
  return {
    policy_version: "atinara-radar-parent-selection-v1",
    total_parent_count: total,
    selected_parent_count: selectedIds.length,
    deferred_parent_count: deferredIds.length,
    selected_child_count: Math.max(0, Math.floor(Number(childSelection.selected_child_count) || 0)),
    no_parent_truncated: indexSelection.no_parent_truncated === true
      && childSelection.no_parent_truncated === true,
    selected_parent_ids: selectedIds,
    deferred_parent_ids: deferredIds,
  };
}

const PROVIDER_OTHER_OPTION_PATTERNS = Object.freeze([
  /^(?:other|all other|any other|otro|otra|todos los demas|todas las demas)(?: option| selection| opcion)?$/,
]);
const PROVIDER_TIE_OPTION_PATTERNS = Object.freeze([/^(?:tie|draw|empate)$/]);
const PROVIDER_NO_WINNER_PATTERNS = Object.freeze([
  /^(?:no winner|none|nobody|sin ganador|sin ganadora|ningun ganador|ninguna ganadora)$/,
]);

export function isProviderPlaceholderLabel(value) {
  const label = normalizeComparableText(value);
  return Boolean(label) && PROVIDER_PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(label));
}

function radarSlugHash(value) {
  let hash = 0x811c9dc5;
  const signature = String(value ?? "").normalize("NFC").toLowerCase()
    .replace(/[\u2018\u2019\u02bc\uff07]/g, "'")
    .replace(/[\u2010-\u2015\u2212\ufe58\ufe63\uff0d]/g, "-");
  for (const byte of new TextEncoder().encode(signature)) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

// Una opción puede mezclar escritura latina y no latina. Los caracteres que la
// forma legible pierde (acentos, apóstrofes, guiones, signos o Unicode) añaden
// una huella NFC. Así se conserva `marathon`, pero permutaciones o etiquetas
// distintas nunca colisionan solo por folding tipográfico.
export function radarOptionSlug(value, maxLength = 120) {
  const bounded = Math.max(1, Math.min(240, Math.floor(Number(maxLength) || 120)));
  const raw = cleanText(value, 500);
  if (!raw) return "";
  const folded = raw.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const ascii = folded.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const encoded = [...raw.normalize("NFC").toLowerCase()]
    .filter((character) => {
      if (!/[\p{L}\p{N}]/u.test(character) || /[a-z0-9]/.test(character)) return false;
      const latinFold = character.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      return !/^[a-z0-9]$/i.test(latinFold);
    })
    .map((character) => character.codePointAt(0).toString(16))
    .join("-");
  let slug = ascii && encoded ? `${ascii}-u-${encoded}` : ascii || (encoded ? `u-${encoded}` : "");
  const suffix = radarSlugHash(raw);
  if (/[^A-Za-z0-9\s]/u.test(raw.normalize("NFC"))) slug = `${slug || "u"}-u-${suffix}`;
  if (!slug || slug.length <= bounded) return slug;
  if (bounded <= suffix.length) return suffix.slice(0, bounded);
  slug = `${slug.slice(0, Math.max(1, bounded - suffix.length - 1)).replace(/-+$/g, "")}-${suffix}`;
  return slug.slice(0, bounded);
}

function providerSemanticClassification(label) {
  const normalized = normalizeComparableText(label);
  if (!normalized) return null;
  if (PROVIDER_OTHER_OPTION_PATTERNS.some((pattern) => pattern.test(normalized))) return "aggregate_other_option";
  if (PROVIDER_TIE_OPTION_PATTERNS.some((pattern) => pattern.test(normalized))) return "tie_option";
  if (PROVIDER_NO_WINNER_PATTERNS.some((pattern) => pattern.test(normalized))) return "no_winner_option";
  return null;
}

function providerStructuredSemanticIdentity(child = {}) {
  const type = normalizeComparableText(child.option_type ?? child.outcome_type ?? child.selection_type);
  if (child.negRiskOther === true || child.is_other === true || type === "other") return "Other";
  if (child.is_tie === true || child.is_draw === true || ["tie", "draw"].includes(type)) return "Tie";
  if (child.is_no_winner === true || ["no winner", "none"].includes(type)) return "No winner";
  return null;
}

function providerChildIdentifiers(child = {}) {
  const tokenArray = (value) => {
    if (Array.isArray(value)) return value;
    if (typeof value !== "string" || !value.trim()) return [];
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  };
  const tokenValues = [
    ...tokenArray(child.token_ids),
    ...tokenArray(child.clobTokenIds),
    ...(Array.isArray(child.tokens) ? child.tokens.map((token) => isRecord(token) ? token.token_id ?? token.id : token) : []),
  ].map((value) => cleanText(value, 220)).filter(Boolean);
  return {
    external_market_id: cleanText(child.external_market_id ?? child.market_id ?? child.id ?? child.ticker ?? child.market_ticker, 220) || null,
    condition_id: cleanText(child.condition_id ?? child.conditionId, 220) || null,
    child_slug: cleanText(child.child_slug ?? child.market_slug ?? child.slug, 400) || null,
    event_id: cleanText(child.event_id ?? child.external_event_id ?? child.event_ticker, 220) || null,
    event_slug: cleanText(child.event_slug ?? child.external_event_slug, 400) || null,
    token_ids: [...new Set(tokenValues)].sort(compareUtf16Binary).slice(0, 20),
  };
}

// Contrato material y estable de una hija tal como lo expone el proveedor.
// Se mantiene separado de la identidad: cambiar reglas, fuente o cierre debe
// invalidar una preparación aunque market_id y option label sigan iguales.
export function providerChildContractProjection(providerInput, child = {}) {
  const provider = cleanText(providerInput, 40).toLowerCase();
  if (isRecord(child.provider_contract)
      && cleanText(child.provider_contract.contract_version, 100)
        === RADAR_PROVIDER_CHILD_CONTRACT_VERSION
      && cleanText(child.provider_contract.provider, 40).toLowerCase() === provider) {
    return {
      ...child.provider_contract,
      provider,
      provider_parent_id: cleanText(
        child.provider_parent_id ?? child.provider_contract.provider_parent_id,
        220,
      ) || null,
    };
  }
  const identifiers = providerChildIdentifiers(child);
  const event = (Array.isArray(child.events) ? child.events.find(isRecord) : null)
    ?? (isRecord(child.event) ? child.event : {});
  const rules = [
    child.source_resolution_rules,
    child.rules_primary,
    child.rules_secondary,
    child.resolution_rules,
    child.resolutionRules,
    child.resolution_criteria,
    child.resolutionCriteria,
  ].map((value) => cleanText(value, 5_000)).filter(Boolean);
  return {
    contract_version: RADAR_PROVIDER_CHILD_CONTRACT_VERSION,
    provider,
    provider_parent_id: cleanText(
      child.provider_parent_id ?? child.external_event_id ?? child.event_id
        ?? child.event_ticker ?? event.id ?? event.event_ticker,
      220,
    ) || null,
    external_market_id: identifiers.external_market_id,
    condition_id: identifiers.condition_id,
    token_ids: identifiers.token_ids,
    child_slug: identifiers.child_slug,
    event_slug: identifiers.event_slug || cleanText(event.slug, 400) || null,
    external_event_url: safePublicUrl(
      child.external_event_url ?? child.event_url ?? event.external_event_url ?? event.url,
    ),
    external_market_url: safePublicUrl(
      child.external_market_url ?? child.market_url ?? child.external_url ?? child.url,
    ),
    source_title: cleanText(child.source_title ?? child.title ?? child.sub_title, 700) || null,
    source_question: cleanText(child.source_question ?? child.question ?? child.title, 1_000) || null,
    source_description: cleanText(child.source_description ?? child.description, 5_000) || null,
    // El contrato firmado usa la misma representación canónica que su hash.
    // El payload fuente conserva el texto original; aquí solo se eliminan
    // diferencias de control/espaciado que no cambian su significado.
    source_resolution_rules: cleanText([...new Set(rules)].join("\n\n"), 10_000) || null,
    source_resolution_url: safePublicUrl(
      child.source_resolution_url ?? child.resolution_source_url ?? child.resolutionSource
        ?? child.resolution_source,
    ),
    source_close_at: safeIsoDate(
      child.source_close_at ?? child.endDate ?? child.close_time
        ?? child.latest_expiration_time ?? child.expected_expiration_time
        ?? child.expiration_time,
    ),
    source_resolution_deadline: safeIsoDate(
      child.source_resolution_deadline ?? child.resolution_deadline
        ?? child.expected_settlement_time ?? child.settlement_time,
    ),
    source_status: cleanText(child.source_status ?? child.status, 80).toLowerCase() || null,
    source_result: normalizeProviderResult(
      child.source_result ?? child.result ?? child.resolutionResult ?? child.winningOutcome,
    ),
    raw_provider_child_label: providerChildRawLabel(child) || null,
  };
}

// Solo los términos que pueden cambiar el significado resolutivo del contrato
// invalidan una preparación. IDs, slugs, URLs de navegación, etiquetas raw y
// estado operativo siguen auditados en provider_contract, pero pertenecen a
// identidad/provenance/availability y no al hash editorial.
export function providerChildMaterialContractProjection(contract = {}) {
  return {
    contract_version: cleanText(contract.contract_version, 100) || null,
    provider: cleanText(contract.provider, 40).toLowerCase() || null,
    source_question: cleanText(contract.source_question, 1_000) || null,
    source_description: cleanText(contract.source_description, 5_000) || null,
    source_resolution_rules: cleanText(contract.source_resolution_rules, 10_000) || null,
    source_resolution_url: safePublicUrl(contract.source_resolution_url),
    source_close_at: safeIsoDate(contract.source_close_at),
    source_resolution_deadline: safeIsoDate(contract.source_resolution_deadline),
  };
}

export function prioritizeProviderChildEvidenceAliases(children, limit = 1_920) {
  const rows = (Array.isArray(children) ? children : []).filter(isRecord);
  const aliases = rows.map((child) => {
    const ids = providerChildIdentifiers(child);
    const primary = ids.external_market_id ?? ids.condition_id ?? ids.token_ids[0] ?? ids.child_slug;
    return {
      primary,
      all: [ids.external_market_id, ids.condition_id, ids.child_slug, ...ids.token_ids].filter(Boolean),
    };
  });
  const bounded = Math.max(rows.length, Math.min(1_920, Math.max(0, Number(limit) || 0)));
  return [...new Set([
    ...aliases.map((item) => item.primary).filter(Boolean),
    ...aliases.flatMap((item) => item.all).toSorted(compareUtf16Binary),
  ])].slice(0, bounded);
}

function providerChildStableAliases(provider, child = {}) {
  const ids = providerChildIdentifiers(child);
  return [...new Set([
    ids.external_market_id ? `${provider}:market:${ids.external_market_id}` : null,
    ids.condition_id ? `${provider}:condition:${ids.condition_id}` : null,
    ...ids.token_ids.map((value) => `${provider}:token:${value}`),
    ids.child_slug ? `${provider}:slug:${ids.child_slug}` : null,
  ].filter(Boolean))];
}

function providerChildIdentityKey(provider, child = {}) {
  return providerChildStableAliases(provider, child)[0] ?? null;
}

function normalizedLegacyMarketId(provider, value) {
  const raw = cleanText(value, 220);
  if (!raw) return null;
  const lowered = raw.toLowerCase();
  const marketPrefix = `${provider}:market:`;
  if (lowered.startsWith(marketPrefix)) return raw.slice(marketPrefix.length) || null;
  const providerPrefix = `${provider}:`;
  if (lowered.startsWith(providerPrefix)) return raw.slice(providerPrefix.length) || null;
  return raw;
}

function legacyLogicalIdentityKey(provider, child = {}) {
  const explicit = cleanText(child.provider_child_identity_key, 500);
  if (explicit && ["market", "condition", "token"].some((kind) =>
    explicit.toLowerCase().startsWith(`${provider}:${kind}:`))) return explicit.toLowerCase();
  const ids = providerChildIdentifiers(child);
  const marketId = normalizedLegacyMarketId(provider, ids.external_market_id);
  if (marketId) return `${provider}:market:${marketId}`.toLowerCase();
  if (ids.condition_id) return `${provider}:condition:${ids.condition_id}`.toLowerCase();
  if (ids.token_ids[0]) return `${provider}:token:${ids.token_ids[0]}`.toLowerCase();
  if (explicit) return explicit.toLowerCase();
  return ids.child_slug ? `${provider}:slug:${ids.child_slug}`.toLowerCase() : null;
}

function legacyRepresentationScore(child = {}) {
  const ids = providerChildIdentifiers(child);
  const contract = isRecord(child.provider_contract) ? child.provider_contract : {};
  return [
    ids.external_market_id, ids.condition_id, ids.child_slug, ...ids.token_ids,
    child.provider_child_identity_key, child.canonical_child_label,
    contract.source_question, contract.source_resolution_rules,
    child.provider_contract_hash, child.child_fingerprint,
  ].filter((value) => cleanText(value, 10_000)).length;
}

/**
 * Convierte varias filas históricas del mismo identificador estable en una
 * sola hija lógica. No borra ni reescribe historia: conserva las referencias
 * de todas las representaciones y marca como conflicto cualquier desacuerdo
 * entre condition/token IDs fuertes. Las ocurrencias de un ledger V6 nunca se
 * colapsan; solo las proyecciones `legacy:<candidate_id>`.
 */
export function collapseLegacyChildRepresentations(providerInput, rows = []) {
  const provider = cleanText(providerInput, 40).toLowerCase();
  if (!RADAR_CANDIDATE_PROVIDERS.includes(provider)) throw new TypeError("RADAR_PROVIDER_INVALID");
  const groups = new Map();
  (Array.isArray(rows) ? rows : []).filter(isRecord).forEach((row, index) => {
    const occurrence = cleanText(row.child_occurrence_key, 500);
    const parentId = cleanText(row.provider_parent_id ?? row.event_id ?? row.external_event_id, 220);
    const identity = legacyLogicalIdentityKey(provider, row);
    const collapsible = occurrence.startsWith("legacy:") && parentId && identity;
    const key = collapsible ? `${parentId}\u0000${identity}` : `occurrence\u0000${index}\u0000${occurrence}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  });
  const collapsed = [];
  for (const values of groups.values()) {
    const ranked = [...values].sort((left, right) => {
      const score = legacyRepresentationScore(right) - legacyRepresentationScore(left);
      if (score) return score;
      const checked = compareUtf16Binary(
        cleanText(right.checked_at, 80), cleanText(left.checked_at, 80),
      );
      if (checked) return checked;
      return compareUtf16Binary(cleanText(left.child_occurrence_key, 500), cleanText(right.child_occurrence_key, 500));
    });
    if (ranked.length === 1 || !cleanText(ranked[0].child_occurrence_key, 500).startsWith("legacy:")) {
      collapsed.push(ranked[0]);
      continue;
    }
    const representative = { ...ranked[0] };
    const firstValue = (field) => ranked.map((row) => row[field]).find((value) =>
      Array.isArray(value) ? value.length > 0 : isRecord(value) ? Object.keys(value).length > 0 : Boolean(cleanText(value, 10_000)));
    for (const field of [
      "provider_child_identity_key", "external_market_id", "condition_id", "token_ids",
      "child_slug", "event_id", "event_slug", "raw_provider_child_label",
      "canonical_child_label", "canonical_child_key", "identity_source", "identity_evidence",
      "provider_contract", "provider_contract_hash", "child_fingerprint", "checked_at",
    ]) {
      const value = firstValue(field);
      if (value !== undefined) representative[field] = value;
    }
    const marketId = normalizedLegacyMarketId(provider, representative.external_market_id);
    if (marketId) {
      representative.external_market_id = marketId;
      representative.provider_child_identity_key = `${provider}:market:${marketId}`;
    }
    const conditionIds = new Set(ranked.map((row) => providerChildIdentifiers(row).condition_id).filter(Boolean));
    const tokenSets = new Set(ranked.map((row) => providerChildIdentifiers(row).token_ids.join("\u0000")).filter(Boolean));
    representative.legacy_identity_conflict = conditionIds.size > 1 || tokenSets.size > 1;
    representative.legacy_representation_count = ranked.length;
    representative.legacy_representation_refs = ranked.slice(0, 24).map((row) => ({
      child_occurrence_key: cleanText(row.child_occurrence_key, 500) || null,
      child_fingerprint: cleanText(row.child_fingerprint, 80) || null,
      checked_at: safeIsoDate(row.checked_at),
    }));
    representative.child_occurrence_key = `legacy:logical:${legacyLogicalIdentityKey(provider, representative)}`.slice(0, 500);
    collapsed.push(representative);
  }
  return collapsed.sort((left, right) => compareUtf16Binary(
    `${cleanText(left.provider_parent_id, 220)}\u0000${providerChildSortKey(provider, left)}`,
    `${cleanText(right.provider_parent_id, 220)}\u0000${providerChildSortKey(provider, right)}`,
  ));
}

function isGenericBinaryProviderLabel(value) {
  return /^(?:yes|no|true|false|si|sí)$/i.test(normalizeComparableText(value));
}

function providerChildRawLabel(child = {}) {
  const selection = isRecord(child.selection) ? child.selection : {};
  const participant = isRecord(child.participant) ? child.participant : {};
  const outcome = isRecord(child.outcome) ? child.outcome : {};
  const explicit = cleanText(
    child.raw_provider_child_label
      ?? child.groupItemTitle
      ?? child.yes_sub_title
      ?? child.yes_subtitle
      ?? selection.label ?? selection.name
      ?? participant.label ?? participant.name
      ?? outcome.label ?? outcome.name,
    240,
  );
  const contractualQuestion = cleanText(child.question ?? child.title, 700);
  const detectedDimension = familyDimension(contractualQuestion).dimension;
  const parsed = optionLabelFromQuestion(
    contractualQuestion,
    ["outcome", "participant", "platform"].includes(detectedDimension) ? detectedDimension : "outcome",
  );
  if (parsed && /^(?:will|can|could|ganara|sera|¿)/i.test(explicit)) return parsed;
  if (explicit && !isGenericBinaryProviderLabel(explicit)) return explicit;
  return parsed;
}

function providerChildCanonicalIdentity(child = {}) {
  const structuredSemantic = providerStructuredSemanticIdentity(child);
  if (structuredSemantic) return {
    label: structuredSemantic,
    source: "provider_structured_semantic_option",
    confidence: 100,
  };
  const explicit = cleanText(child.canonical_child_label, 240);
  if (explicit && !isProviderPlaceholderLabel(explicit)) {
    return {
      label: explicit,
      source: cleanText(child.identity_source, 120) || "provider_canonical_child",
      confidence: 100,
    };
  }
  const rawLabel = providerChildRawLabel(child);
  if (rawLabel && !isProviderPlaceholderLabel(rawLabel)) {
    return {
      label: rawLabel,
      source: cleanText(child.identity_source, 120) || (child.groupItemTitle || child.yes_sub_title
        ? "provider_structured_child" : "provider_contract_question"),
      confidence: 100,
    };
  }
  const question = child.question ?? child.title;
  const detectedDimension = familyDimension(question).dimension;
  const questionLabel = optionLabelFromQuestion(
    question,
    ["outcome", "participant", "platform"].includes(detectedDimension) ? detectedDimension : "outcome",
  );
  if (questionLabel && !isProviderPlaceholderLabel(questionLabel)) {
    return { label: questionLabel, source: "provider_contract_question", confidence: 100 };
  }
  return { label: null, source: null, confidence: 0 };
}

function providerAvailabilityStatus(child = {}) {
  const status = cleanText(child.availability_status ?? child.status, 80).toLowerCase();
  if (child.removed === true || status === "removed") return "removed";
  if (child.closed === true || child.archived === true || child.active === false
      || child.acceptingOrders === false || ["closed", "inactive", "settled", "determined", "finalized"].includes(status)) {
    return status === "inactive" ? "inactive" : "closed";
  }
  if (["open", "active", "trading", "initialized"].includes(status)) return "open";
  if (["unopened", "paused"].includes(status)) return status;
  return "unknown";
}

function safeReconciliationEvidence(values) {
  return (Array.isArray(values) ? values : []).filter(isRecord).map((value) => ({
    url: safePublicUrl(value.url),
    endpoint: cleanText(value.endpoint, 120) || null,
    identifier_type: cleanText(value.identifier_type, 80) || null,
    identifier: cleanText(value.identifier, 220) || null,
    result: cleanText(value.result, 80) || null,
    content_sha256: /^[a-f0-9]{64}$/.test(cleanText(value.content_sha256, 80))
      ? cleanText(value.content_sha256, 80) : null,
    identity_sha256: /^[a-f0-9]{64}$/.test(cleanText(value.identity_sha256, 80))
      ? cleanText(value.identity_sha256, 80) : null,
    observed_parent_ids: safeStringArray(value.observed_parent_ids, 8)
      .map((item) => cleanText(item, 220)).filter(Boolean).toSorted(compareUtf16Binary),
    observed_child_ids: safeStringArray(value.observed_child_ids, 1_920)
      .map((item) => cleanText(item, 220)).filter(Boolean).toSorted(compareUtf16Binary),
    checked_at: safeIsoDate(value.checked_at),
  })).filter((value) => value.url || value.identifier || value.result)
    .sort((left, right) => compareUtf16Binary(
      [left.url, left.endpoint, left.identifier_type, left.identifier, left.result,
        left.identity_sha256, left.content_sha256, left.observed_parent_ids.join("|"),
        left.observed_child_ids.join("|")].join("\u0000"),
      [right.url, right.endpoint, right.identifier_type, right.identifier, right.result,
        right.identity_sha256, right.content_sha256, right.observed_parent_ids.join("|"),
        right.observed_child_ids.join("|")].join("\u0000"),
    )).slice(0, 24);
}

function authoritativeIdentityEvidence(values) {
  const allowedResults = new Set([
    "identity_resolved", "child_identity_observed_in_parent",
    "provider_removed_child", "provider_closed_child",
  ]);
  return safeReconciliationEvidence(values).some((value) => Boolean(
    value.url && value.identifier && (value.identity_sha256 || value.content_sha256)
      && allowedResults.has(value.result ?? ""),
  ));
}

function mergeReconciliationEvidence(...collections) {
  const unique = new Map();
  for (const value of collections.flatMap((items) => safeReconciliationEvidence(items))) {
    const key = [value.url, value.endpoint, value.identifier_type, value.identifier,
      value.result, value.identity_sha256, value.content_sha256,
      value.observed_child_ids.join("|")].join("\u0000");
    if (!unique.has(key)) unique.set(key, value);
  }
  return safeReconciliationEvidence([...unique.values()]);
}

function reconciliationEvidenceFingerprint(values) {
  return safeReconciliationEvidence(values).map((value) => ({
    url: value.url,
    endpoint: value.endpoint,
    identifier_type: value.identifier_type,
    identifier: value.identifier,
    result: value.result,
    identity_sha256: value.identity_sha256 ?? value.content_sha256,
    observed_parent_ids: value.observed_parent_ids,
    observed_child_ids: value.observed_child_ids,
  }));
}

function providerChildSortKey(provider, child = {}) {
  return [
    providerChildStableAliases(provider, child).join("|"),
    normalizeComparableText(providerChildRawLabel(child)),
    normalizeComparableText(child.canonical_child_label),
    cleanText(child.question ?? child.title, 700),
  ].join("\u0000");
}

function providerChildrenShareStableIdentity(provider, left = {}, right = {}) {
  const rightAliases = new Set(providerChildStableAliases(provider, right));
  return providerChildStableAliases(provider, left).some((value) => rightAliases.has(value));
}

function reconciliationBindingAliases(value = {}) {
  const payload = isRecord(value.provider_payload) ? value.provider_payload : {};
  const identifiers = providerChildIdentifiers({
    ...payload,
    ...value,
    external_market_id: value.external_market_id ?? payload.external_market_id ?? payload.id,
    condition_id: value.condition_id ?? payload.condition_id ?? payload.conditionId,
    token_ids: value.token_ids ?? payload.token_ids ?? payload.clobTokenIds,
    child_slug: value.child_slug ?? value.external_market_slug ?? payload.child_slug ?? payload.slug,
  });
  const strong = [
    cleanText(value.parent_child_occurrence_key ?? value.child_occurrence_key, 500)
      ? `occurrence:${cleanText(value.parent_child_occurrence_key ?? value.child_occurrence_key, 500)}` : "",
    cleanText(value.parent_child_identity_key ?? value.provider_child_identity_key, 500)
      ? `identity:${cleanText(value.parent_child_identity_key ?? value.provider_child_identity_key, 500)}` : "",
    identifiers.external_market_id ? `market:${identifiers.external_market_id}` : "",
    identifiers.condition_id ? `condition:${identifiers.condition_id}` : "",
    ...identifiers.token_ids.map((token) => `token:${token}`),
  ].filter(Boolean);
  return new Set(strong.length ? strong
    : identifiers.child_slug ? [`slug:${identifiers.child_slug}`] : []);
}

export function bindRadarCandidatesToReconciledChildren(candidates = [], children = []) {
  const candidateList = Array.isArray(candidates) ? candidates.filter(isRecord) : [];
  const childList = Array.isArray(children) ? children.filter(isRecord) : [];
  const remaining = new Set(childList.map((_, index) => index));
  return candidateList.map((candidate) => {
    const aliases = reconciliationBindingAliases(candidate);
    if (!aliases.size) return null;
    const matches = [...remaining].filter((index) => {
      const childAliases = reconciliationBindingAliases(childList[index]);
      return [...aliases].some((alias) => childAliases.has(alias));
    });
    if (matches.length !== 1) return null;
    remaining.delete(matches[0]);
    return childList[matches[0]];
  });
}

/**
 * Contrato puro y provider-agnostic de reconciliación de un padre. No infiere
 * identidades por orden, probabilidad o similitud: solo consume etiquetas e
 * identificadores que la capa de proveedor ya acreditó.
 */
export async function reconcileProviderParent(input = {}) {
  const provider = cleanText(input.provider, 40).toLowerCase();
  const providerParentId = cleanText(input.provider_parent_id, 220);
  if (!RADAR_CANDIDATE_PROVIDERS.includes(provider) || !providerParentId) {
    throw new TypeError("RADAR_PARENT_IDENTITY_INVALID");
  }
  const checkedAt = safeIsoDate(input.checked_at) ?? new Date().toISOString();
  const currentChildren = (Array.isArray(input.children) ? input.children : []).filter(isRecord)
    .sort((left, right) => compareUtf16Binary(providerChildSortKey(provider, left), providerChildSortKey(provider, right)));
  const previousChildren = (Array.isArray(input.previous_children) ? input.previous_children : []).filter(isRecord)
    .sort((left, right) => compareUtf16Binary(providerChildSortKey(provider, left), providerChildSortKey(provider, right)));
  const declaredValue = Number(input.provider_declared_child_count);
  const declaredCount = Number.isSafeInteger(declaredValue) && declaredValue >= 0 ? declaredValue : null;
  const paginationExhausted = input.provider_pagination_exhausted === true;
  const parentEvidence = safeReconciliationEvidence(input.source_refs);
  const seenAliases = new Map();
  const seenCanonicalKeys = new Map();
  const children = [];
  let historicalMappingConflict = false;
  let recoverableMetadataConflict = false;
  let terminalProviderConflict = false;
  const legacyAccounted = new Set();

  for (let ordinal = 0; ordinal < currentChildren.length; ordinal += 1) {
    const child = currentChildren[ordinal];
    const ids = providerChildIdentifiers(child);
    const stableAliases = providerChildStableAliases(provider, child);
    const identityKey = providerChildIdentityKey(provider, child);
    const rawLabel = providerChildRawLabel(child) || null;
    const canonical = providerChildCanonicalIdentity(child);
    const identityDimension = familyDimension(child.question ?? child.title).dimension;
    const optionIdentityRequired = child.categorical_parent === true
      || ["outcome", "participant", "platform"].includes(identityDimension)
      || isProviderPlaceholderLabel(rawLabel);
    const canonicalLabel = optionIdentityRequired ? canonical.label : null;
    const availability = providerAvailabilityStatus(child);
    const previousIndex = previousChildren.findIndex((value, index) =>
      !legacyAccounted.has(index) && stableAliases.length > 0
        && providerChildrenShareStableIdentity(provider, child, value));
    const previous = previousIndex >= 0 ? previousChildren[previousIndex] : null;
    if (previousIndex >= 0) legacyAccounted.add(previousIndex);
    const previousParentId = cleanText(previous?.provider_parent_id ?? previous?.event_id ?? previous?.external_event_id, 220);
    const previousIds = providerChildIdentifiers(previous ?? {});
    const tokenSetsDiffer = ids.token_ids.length > 0 && previousIds.token_ids.length > 0
      && (ids.token_ids.length !== previousIds.token_ids.length
        || ids.token_ids.some((value) => !previousIds.token_ids.includes(value)));
    const stableIdentifierConflict = Boolean(previous && (
      previous.legacy_identity_conflict === true
      || (ids.external_market_id && previousIds.external_market_id
        && ids.external_market_id !== previousIds.external_market_id)
      || (ids.condition_id && previousIds.condition_id && ids.condition_id !== previousIds.condition_id)
      || tokenSetsDiffer
    ));
    const canonicalSlug = canonicalLabel ? radarOptionSlug(canonicalLabel, 120) : null;
    const canonicalKey = canonicalSlug ? `option:${canonicalSlug}` : null;
    const duplicateByStableAlias = stableAliases.map((alias) => seenAliases.get(alias)).find(Boolean);
    const canonicalCollision = canonicalKey ? seenCanonicalKeys.get(canonicalKey) : null;
    // Una key textual igual no demuestra que el proveedor haya duplicado una
    // hija. Solo una alias estable compartida permite esa clasificación; IDs
    // fuertes distintos con la misma etiqueta son conflicto, nunca similitud.
    const duplicate = duplicateByStableAlias;
    const duplicateIds = providerChildIdentifiers(duplicate ?? {});
    const duplicateTokenConflict = ids.token_ids.length > 0 && duplicateIds.token_ids.length > 0
      && (ids.token_ids.length !== duplicateIds.token_ids.length
        || ids.token_ids.some((value) => !duplicateIds.token_ids.includes(value)));
    const duplicateIdentifierConflict = Boolean(duplicateByStableAlias && (
      (ids.external_market_id && duplicateIds.external_market_id
        && ids.external_market_id !== duplicateIds.external_market_id)
      || (ids.condition_id && duplicateIds.condition_id && ids.condition_id !== duplicateIds.condition_id)
      || duplicateTokenConflict
    ));
    const labelsConflict = duplicate?.canonical_child_label && canonicalLabel
      && normalizeComparableText(duplicate.canonical_child_label) !== normalizeComparableText(canonicalLabel);
    const movedParent = Boolean(previousParentId && previousParentId !== providerParentId);
    const evidenceAliases = new Set([
      ids.external_market_id,ids.condition_id,...ids.token_ids,ids.child_slug,
    ].filter(Boolean));
    const inheritedEvidence = parentEvidence.filter((value) => value.url && value.content_sha256
      && value.observed_child_ids.some((identity) => evidenceAliases.has(identity))).map((value) => ({
      ...value,
      observed_child_ids: value.observed_child_ids.filter((identity) => evidenceAliases.has(identity)),
      identifier_type: ids.external_market_id ? "external_market_id"
        : ids.condition_id ? "condition_id" : ids.token_ids.length ? "token_id" : "child_slug",
      identifier: ids.external_market_id ?? ids.condition_id ?? ids.token_ids[0] ?? ids.child_slug,
      result: canonicalLabel || !optionIdentityRequired ? "child_identity_observed_in_parent" : value.result,
    })).filter((value) => value.identifier);
    const unidentifiedParentEvidence = evidenceAliases.size ? [] : parentEvidence
      .filter((value) => value.url && (value.identity_sha256 || value.content_sha256))
      .map((value) => ({
        ...value,
        identifier_type: "provider_parent_id",
        identifier: providerParentId,
        result: "provider_child_without_stable_identifier",
        observed_child_ids: [],
      }));
    let evidence = mergeReconciliationEvidence(
      child.identity_evidence ?? child.source_refs,
      inheritedEvidence,
      unidentifiedParentEvidence,
    );
    if (availability === "removed"
        && !evidence.some((value) => value.result === "provider_removed_child")) {
      const removalSource = evidence.find((value) => value.url
        && (value.identity_sha256 || value.content_sha256));
      if (removalSource) {
        evidence = mergeReconciliationEvidence(evidence, [{
          ...removalSource,
          result: "provider_removed_child",
          identifier_type: ids.external_market_id ? "external_market_id"
            : ids.condition_id ? "condition_id" : ids.token_ids.length ? "token_id" : "child_slug",
          identifier: ids.external_market_id ?? ids.condition_id ?? ids.token_ids[0] ?? ids.child_slug,
        }]);
      }
    }
    const identityProven = Boolean(identityKey)
      && authoritativeIdentityEvidence(evidence)
      && (!optionIdentityRequired || Boolean(canonicalLabel));
    const removalProven = availability === "removed" && Boolean(identityKey)
      && evidence.some((value) => value.url && value.result === "provider_removed_child");
    let classification = child.identity_resolution_conflict === true
      ? "provider_data_conflict"
      : !identityKey
      ? "provider_data_conflict"
      : removalProven
      ? "provider_removed_child"
      : optionIdentityRequired && isProviderPlaceholderLabel(rawLabel) && !canonicalLabel
      ? "provider_placeholder_pending_resolution"
      : !identityProven
        ? "provider_data_conflict"
        : availability === "removed"
            ? "provider_removed_child"
          : (optionIdentityRequired ? providerSemanticClassification(canonicalLabel ?? rawLabel) : null)
        ?? (availability === "closed" ? "provider_closed_child" : "identified_real_option");
    if (canonicalCollision && !duplicateByStableAlias) classification = "provider_data_conflict";
    if (duplicate) classification = labelsConflict || duplicateIdentifierConflict
      ? "provider_data_conflict" : "provider_duplicate_child";
    if (movedParent) {
      classification = "provider_data_conflict";
      historicalMappingConflict = true;
    }
    if (stableIdentifierConflict) classification = "provider_data_conflict";
    if (child.identity_resolution_conflict === true || stableIdentifierConflict
      || (canonicalCollision && !duplicateByStableAlias)
      || duplicateIdentifierConflict || (duplicate && labelsConflict)) terminalProviderConflict = true;
    if (!identityKey || (!identityProven && ![
      "provider_duplicate_child", "provider_removed_child",
    ].includes(classification))) {
      recoverableMetadataConflict = true;
    }
    const identityStatus = classification === "provider_placeholder_pending_resolution" ? "unresolved_placeholder"
      : classification === "provider_data_conflict" ? "conflict"
        : classification === "provider_duplicate_child" ? "duplicate"
          : classification === "provider_removed_child" ? "removed"
            : "resolved";
    const duplicateOrdinal = duplicate
      ? children.filter((value) => value.provider_child_identity_key === duplicate.provider_child_identity_key
        || (canonicalKey && value.canonical_child_key === canonicalKey)).length
      : 0;
    const occurrenceSeed = identityKey
      ? `${identityKey}:${duplicateOrdinal}`
      : `${provider}:unidentified:${await sha256Hex({ ids, rawLabel, question: cleanText(child.question ?? child.title, 700) })}`;
    const identitySource = classification === "provider_removed_child"
      ? "provider_removed_child_verification"
      : classification === "provider_duplicate_child" ? "provider_stable_alias_duplicate"
      : optionIdentityRequired ? canonical.source : "provider_contract_identity";
    const identityConfidence = identityProven || [
      "provider_duplicate_child", "provider_removed_child",
    ].includes(classification) ? 100 : 0;
    const presentInLegacySnapshot = Boolean(previous);
    const transition = movedParent ? "moved_parent"
      : !previous ? "new"
        : previous && (
          (canonicalLabel && normalizeComparableText(previous.canonical_child_label ?? previous.raw_provider_child_label)
            !== normalizeComparableText(canonicalLabel))
          || (ids.child_slug && cleanText(previous.child_slug ?? previous.market_slug ?? previous.slug, 400)
            && ids.child_slug !== cleanText(previous.child_slug ?? previous.market_slug ?? previous.slug, 400))
        ) ? "renamed" : "same";
    const duplicateOfChildIdentityKey = classification === "provider_duplicate_child"
      ? duplicate?.provider_child_identity_key ?? null : null;
    const providerContract = providerChildContractProjection(provider, {
      ...child,
      provider_parent_id: providerParentId,
    });
    const providerContractMaterial = providerChildMaterialContractProjection(providerContract);
    const providerContractCanonicalJson = canonicalJson(providerContractMaterial);
    const providerContractHash = await sha256Hex(providerContractCanonicalJson);
    const childFingerprintMaterial = {
      version: RADAR_CHILD_PROJECTION_VERSION,
      provider,
      provider_parent_id: providerParentId,
      occurrence_key: occurrenceSeed,
      identity_key: identityKey,
      identity_kind: optionIdentityRequired ? "option" : "contract",
      identifiers: ids,
      raw_provider_child_label: rawLabel,
      canonical_child_label: canonicalLabel,
      canonical_child_slug: canonicalSlug,
      identity_classification: classification,
      identity_status: identityStatus,
      availability_status: availability,
      identity_source: identitySource,
      identity_confidence: identityConfidence,
      present_in_current_snapshot: true,
      present_in_legacy_snapshot: presentInLegacySnapshot,
      transition,
      duplicate_of_child_identity_key: duplicateOfChildIdentityKey,
      provider_contract_hash: providerContractHash,
      provider_state: {
        source_status: providerContract.source_status,
        source_result: providerContract.source_result,
      },
      evidence: reconciliationEvidenceFingerprint(evidence),
    };
    const reconciled = {
      child_occurrence_key: occurrenceSeed,
      provider_child_identity_key: identityKey,
      identity_kind: optionIdentityRequired ? "option" : "contract",
      ...ids,
      raw_provider_child_label: rawLabel,
      canonical_child_label: canonicalLabel,
      canonical_child_slug: canonicalSlug,
      canonical_child_key: canonicalKey,
      identity_classification: classification,
      identity_status: identityStatus,
      availability_status: availability,
      identity_source: identitySource,
      identity_confidence: identityConfidence,
      identity_evidence: evidence,
      present_in_current_snapshot: true,
      present_in_legacy_snapshot: presentInLegacySnapshot,
      transition,
      duplicate_of_child_identity_key: duplicateOfChildIdentityKey,
      legacy_representation_count: previous
        ? Math.max(1, Number(previous.legacy_representation_count) || 1) : 0,
      legacy_representation_refs: previous && Array.isArray(previous.legacy_representation_refs)
        ? previous.legacy_representation_refs.slice(0, 24) : [],
      provider_contract: providerContract,
      provider_contract_canonical_json: providerContractCanonicalJson,
      provider_contract_hash: providerContractHash,
      projection_version: RADAR_CHILD_PROJECTION_VERSION,
      child_fingerprint: await sha256Hex(childFingerprintMaterial),
      checked_at: checkedAt,
    };
    children.push(reconciled);
    if (!duplicate) {
      for (const alias of stableAliases) seenAliases.set(alias, reconciled);
      if (canonicalKey) seenCanonicalKeys.set(canonicalKey, reconciled);
    }
  }

  for (let ordinal = 0; ordinal < previousChildren.length; ordinal += 1) {
    const previous = previousChildren[ordinal];
    const identityKey = providerChildIdentityKey(provider, previous);
    if (legacyAccounted.has(ordinal)) continue;
    const ids = providerChildIdentifiers(previous);
    const rawLabel = providerChildRawLabel(previous) || null;
    const canonical = providerChildCanonicalIdentity(previous);
    const previousDimension = familyDimension(previous.question ?? previous.title).dimension;
    const previousIdentityKind = cleanText(previous.identity_kind, 40)
      || (["outcome", "participant", "platform"].includes(previousDimension) ? "option" : "contract");
    const previousCanonicalLabel = previousIdentityKind === "option" ? canonical.label : null;
    const evidence = mergeReconciliationEvidence(previous.identity_evidence ?? previous.source_refs);
    const removedVerified = (previous.removed_verified === true
      || cleanText(previous.identity_classification, 100) === "provider_removed_child")
      && evidence.some((value) => value.url && value.result === "provider_removed_child");
    const closedVerified = (previous.closed_verified === true
      || cleanText(previous.identity_classification, 100) === "provider_closed_child")
      && evidence.some((value) => value.url && value.result === "provider_closed_child");
    const canonicalIdentityProven = previousIdentityKind !== "option"
      || Boolean(previousCanonicalLabel && canonical.source);
    const classification = removedVerified ? "provider_removed_child"
      : closedVerified && canonicalIdentityProven ? "provider_closed_child"
        : closedVerified ? "provider_placeholder_pending_resolution"
          : "provider_data_conflict";
    const identityStatus = removedVerified ? "removed"
      : closedVerified && canonicalIdentityProven ? "resolved"
        : closedVerified ? "unresolved_placeholder" : "conflict";
    if (removedVerified || (closedVerified && canonicalIdentityProven)) legacyAccounted.add(ordinal);
    else historicalMappingConflict = true;
    const previousOccurrence = cleanText(previous.child_occurrence_key, 500) || String(ordinal);
    const occurrenceSeed = identityKey
      ? `${identityKey}:${removedVerified ? "removed" : closedVerified ? "closed" : "missing"}:${previousOccurrence}`
      : `${provider}:unidentified-legacy:${await sha256Hex({ ids, rawLabel, ordinal })}`;
    const missingAvailability = removedVerified ? "removed" : closedVerified ? "closed" : "unknown";
    const missingIdentitySource = removedVerified
      ? "provider_removed_child_verification"
      : canonicalIdentityProven
        ? (previousIdentityKind === "option" ? canonical.source : "provider_contract_identity")
        : null;
    const missingIdentityConfidence = removedVerified
      || (closedVerified && canonicalIdentityProven) ? 100 : 0;
    const missingTransition = removedVerified || closedVerified ? "removed" : "same";
    const providerContract = providerChildContractProjection(provider, {
      ...previous,
      provider_parent_id: providerParentId,
    });
    const providerContractMaterial = providerChildMaterialContractProjection(providerContract);
    const providerContractCanonicalJson = canonicalJson(providerContractMaterial);
    const providerContractHash = await sha256Hex(providerContractCanonicalJson);
    const material = {
      version: RADAR_CHILD_PROJECTION_VERSION,
      provider,
      provider_parent_id: providerParentId,
      identity_key: identityKey,
      identity_kind: previousIdentityKind,
      identifiers: ids,
      raw_provider_child_label: rawLabel,
      canonical_child_label: previousCanonicalLabel,
      identity_classification: classification,
      identity_status: identityStatus,
      availability_status: missingAvailability,
      identity_source: missingIdentitySource,
      identity_confidence: missingIdentityConfidence,
      present_in_current_snapshot: false,
      present_in_legacy_snapshot: true,
      transition: missingTransition,
      duplicate_of_child_identity_key: null,
      provider_contract_hash: providerContractHash,
      provider_state: {
        source_status: providerContract.source_status,
        source_result: providerContract.source_result,
      },
      evidence: reconciliationEvidenceFingerprint(evidence),
    };
    children.push({
      child_occurrence_key: occurrenceSeed,
      provider_child_identity_key: identityKey,
      identity_kind: previousIdentityKind,
      ...ids,
      raw_provider_child_label: rawLabel,
      canonical_child_label: previousCanonicalLabel,
      canonical_child_slug: previousCanonicalLabel ? radarOptionSlug(previousCanonicalLabel, 120) : null,
      canonical_child_key: previousCanonicalLabel ? `option:${radarOptionSlug(previousCanonicalLabel, 120)}` : null,
      identity_classification: classification,
      identity_status: identityStatus,
      availability_status: missingAvailability,
      identity_source: missingIdentitySource,
      identity_confidence: missingIdentityConfidence,
      identity_evidence: evidence,
      present_in_current_snapshot: false,
      present_in_legacy_snapshot: true,
      transition: missingTransition,
      duplicate_of_child_identity_key: null,
      legacy_representation_count: Math.max(1, Number(previous.legacy_representation_count) || 1),
      legacy_representation_refs: Array.isArray(previous.legacy_representation_refs)
        ? previous.legacy_representation_refs.slice(0, 24) : [],
      provider_contract: providerContract,
      provider_contract_canonical_json: providerContractCanonicalJson,
      provider_contract_hash: providerContractHash,
      projection_version: RADAR_CHILD_PROJECTION_VERSION,
      child_fingerprint: await sha256Hex(material),
      checked_at: checkedAt,
    });
  }

  const current = children.filter((child) => child.present_in_current_snapshot);
  const unresolvedCount = current.filter((child) => ["unresolved_placeholder", "conflict"].includes(child.identity_status)).length;
  const identifiedCount = current.filter((child) => child.identity_status === "resolved").length;
  const removedCount = children.filter((child) => child.identity_classification === "provider_removed_child").length;
  const duplicateCount = current.filter((child) => child.identity_classification === "provider_duplicate_child").length;
  const conflictCount = current.filter((child) => child.identity_classification === "provider_data_conflict").length;
  const closedCount = current.filter((child) => child.availability_status === "closed").length;
  const sourceRefs = safeReconciliationEvidence(input.source_refs);
  let status = "complete";
  if (input.provider_unavailable === true) status = "provider_unavailable";
  else if (!paginationExhausted) status = "refresh_required";
  else if (declaredCount === null) status = "incomplete_provider_metadata";
  else if (declaredCount !== current.length) status = "inconsistent_provider_count";
  else if (historicalMappingConflict) status = "historical_mapping_required";
  else if (terminalProviderConflict) status = "terminal_provider_corruption";
  else if (recoverableMetadataConflict) status = "incomplete_provider_metadata";
  else if (conflictCount > 0) status = "terminal_provider_corruption";
  else if (unresolvedCount > 0) status = "incomplete_provider_metadata";
  const nextRetryAt = ["complete", "terminal_provider_corruption"].includes(status)
    ? null
    : safeIsoDate(input.next_retry_at)
      ?? new Date(Date.parse(checkedAt) + 60 * 60_000).toISOString();
  const summary = {
    provider,
    provider_parent_id: providerParentId,
    raw_provider_parent_label: cleanText(input.raw_provider_parent_label, 500) || null,
    canonical_parent_label: cleanText(input.canonical_parent_label, 500) || null,
    raw_provider_category: cleanText(input.raw_provider_category, 120) || null,
    atinara_category: cleanText(input.atinara_category ?? input.category, 120) || null,
    category: cleanText(input.atinara_category ?? input.category, 120) || null,
    external_parent_url: safePublicUrl(input.external_parent_url),
    horizon_at: safeIsoDate(input.horizon_at),
    provider_declared_child_count: declaredCount,
    provider_discovered_child_count: current.length,
    provider_accounted_child_count: current.length,
    provider_identified_child_count: identifiedCount,
    provider_unresolved_child_count: unresolvedCount,
    provider_removed_child_count: removedCount,
    provider_closed_child_count: closedCount,
    provider_duplicate_child_count: duplicateCount,
    provider_conflict_child_count: conflictCount,
    legacy_expected_child_count: previousChildren.length || null,
    legacy_accounted_child_count: previousChildren.length ? legacyAccounted.size : null,
    new_child_count: current.filter((child) => child.transition === "new").length,
    provider_pagination_exhausted: paginationExhausted,
    reconciliation_status: status,
    reconciliation_version: RADAR_PARENT_RECONCILIATION_VERSION,
    normalizer_version: RADAR_NORMALIZER_VERSION,
    family_version: RADAR_FAMILY_VERSION,
    checked_at: checkedAt,
    next_retry_at: nextRetryAt,
    source_refs: sourceRefs,
  };
  const reconciliationFingerprint = await sha256Hex({
    ...summary,
    checked_at: null,
    next_retry_at: null,
    source_refs: reconciliationEvidenceFingerprint(sourceRefs),
    children: children.map((child) => child.child_fingerprint).sort(compareUtf16Binary),
  });
  return {
    ...summary,
    reconciliation_fingerprint: reconciliationFingerprint,
    children,
  };
}

function optionLabelFromQuestion(value, dimension = "outcome") {
  const question = cleanText(value, 1000).replace(/^¿\s*/, "");
  if (!question) return "";
  const patterns = dimension === "participant"
      ? [
        /^(?:will|can|could)\s+(.+?)\s+(?:attend|appear|participate|compete)\b/i,
        /^(?:will|can|could)\s+(.+?)\s+be\s+(?:(?:featured|shown)\s+)?on\s+(?:the\s+)?cover\b/i,
        /^(?:asistir[aá]|aparecer[aá]|participar[aá]|competir[aá])\s+(.+?)\b/i,
      ]
    : dimension === "platform"
      ? [
          /^(?:will|can|could)\s+(.+?)\s+(?:release|launch|appear|be available)\b/i,
          /^(?:se lanzar[aá]|aparecer[aá]|estar[aá] disponible)\s+(.+?)\b/i,
        ]
      : [
          /^(?:will|can|could)\s+(.+?)\s+(?:win|be named|be chosen|be awarded|receive|take home)\b/i,
          /^(?:ganar[aá]|ser[aá] nombrado|ser[aá] nombrada|ser[aá] elegido|ser[aá] elegida|recibir[aá])\s+(.+?)\b/i,
          /^(?:will|can|could)\s+(.+?)\s+be\s+(?:the\s+)?(?:winner|game of the year)\b/i,
          /^(?:ser[aá])\s+(.+?)\s+(?:el|la)\s+(?:ganador|ganadora)\b/i,
        ];
  for (const pattern of patterns) {
    const match = question.match(pattern);
    const label = cleanText(match?.[1], 240);
    if (label && label.split(/\s+/).length <= 18) return label;
  }
  return "";
}

/**
 * @param {Record<string, any>} candidate
 * @param {"outcome"|"participant"|"platform"|null} dimension
 */
export function extractRadarOptionChild(candidate = {}, dimension = null) {
  const detectedDimension = dimension ?? familyDimension(
    candidate?.atinara_question ?? candidate?.question ?? candidate?.source_question ?? candidate?.title,
  ).dimension;
  if (!["outcome", "participant", "platform"].includes(detectedDimension)) return null;
  if (["unresolved_placeholder", "conflict", "removed", "duplicate"].includes(
    cleanText(candidate?.identity_status, 80),
  )) return null;
  const payload = familyProviderPayload(candidate);
  const structured = cleanText(
    candidate?.canonical_child_label
      ?? payload.canonical_child_label
      ?? payload.yes_sub_title
      ?? candidate?.yes_sub_title
      ?? candidate?.family_child_label,
    500,
  );
  const normalizedStructured = normalizeComparableText(structured);
  const ordinaryStructured = normalizedStructured
    && !/^(?:yes|si|true|no)$/.test(normalizedStructured);
  const questionLabel = optionLabelFromQuestion(
    candidate?.source_question ?? candidate?.atinara_question ?? candidate?.question,
    detectedDimension,
  );
  const structuredIsPlaceholder = ordinaryStructured && isProviderPlaceholderLabel(structured);
  const questionResolvesPlaceholder = questionLabel && !isProviderPlaceholderLabel(questionLabel);
  const sourceField = ordinaryStructured && (!structuredIsPlaceholder || !questionResolvesPlaceholder)
    ? (candidate?.canonical_child_label ? "canonical_child_label"
      : payload.canonical_child_label ? "provider_payload.canonical_child_label"
        : payload.yes_sub_title ? "provider_payload.yes_sub_title"
          : candidate?.yes_sub_title ? "yes_sub_title" : "family_child_label")
    : "source_question";
  const rawLabel = ordinaryStructured && (!structuredIsPlaceholder || !questionResolvesPlaceholder)
    ? structured : questionLabel;
  const label = cleanText(rawLabel, 240);
  const normalizedLabel = normalizeComparableText(label);
  const slug = radarOptionSlug(label, 120);
  if (!label || !slug) return null;
  return {
    dimension: detectedDimension,
    label,
    slug,
    source_field: sourceField,
    confidence: sourceField === "source_question" ? 92 : 100,
    placeholder: isProviderPlaceholderLabel(normalizedLabel),
  };
}

export function evaluateGamingDomain(candidate = {}) {
  const child = extractRadarOptionChild(candidate);
  const label = normalizeComparableText(child?.label
    ?? candidate.family_child_label
    ?? candidate.yes_sub_title
    ?? candidate.provider_payload?.yes_sub_title
    ?? candidate.source_title
    ?? candidate.title);
  const evidenceFields = [
    ["source_title", candidate.source_title],
    ["source_question", candidate.source_question],
    ["source_description", candidate.source_description],
    ["provider_title", candidate.provider_payload?.title],
    ["provider_subtitle", candidate.provider_payload?.subtitle],
    ["provider_category", candidate.provider_payload?.category],
    ["provider_series", candidate.provider_payload?.series_ticker],
    ["provider_event", candidate.provider_payload?.event_ticker],
    ["context", candidate.context],
  ].map(([field, value]) => [field, normalizeComparableText(value)]).filter(([, value]) => value);
  const collectSignals = (patterns, prefix) => evidenceFields.flatMap(([field, value]) =>
    patterns.filter((pattern) => pattern.test(value))
      .filter((pattern) => !(prefix === "NON_GAMING"
        && /premier league|la liga|champions league|nba|nfl|mlb|nhl|music|songs?|singer|band|podcasts?|television|tv shows?/.test(pattern.source)
        && /\b(?:video ?games?|videojuegos?|gaming|gameplay|playstation|xbox|nintendo|steam)\b/.test(value)))
      .map((pattern) => ({
      code: `${prefix}_${stableFingerprint(pattern.source).slice(1).toUpperCase()}`,
      field,
    })),
  );
  const positiveSignals = collectSignals(GAMING_DOMAIN_STRONG_PATTERNS, "GAMING");
  const negativeSignals = collectSignals(GAMING_DOMAIN_NEGATIVE_PATTERNS, "NON_GAMING");
  const taxonomyGaming = /\b(?:video ?games?|videojuegos?|gaming|esports?)\b/.test(
    normalizeComparableText(`${candidate.source_category ?? ""} ${(candidate.source_tags ?? []).join?.(" ") ?? ""}`),
  );
  if (taxonomyGaming) {
    positiveSignals.push({ code: "GAMING_REGISTERED_TAXONOMY", field: "source_category" });
  }
  if (child?.placeholder || PROVIDER_PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(label))) {
    return {
      status: "placeholder",
      conclusive: true,
      reason_code: RADAR_REASON_CODES.PROVIDER_PLACEHOLDER,
      positive_signals: positiveSignals,
      negative_signals: negativeSignals,
      policy_version: RADAR_DOMAIN_POLICY_VERSION,
    };
  }
  if (!positiveSignals.length && negativeSignals.length) {
    return {
      status: "review_required",
      conclusive: false,
      reason_code: RADAR_REASON_CODES.GAMING_DOMAIN_REVIEW_REQUIRED,
      positive_signals: [],
      negative_signals: negativeSignals,
      policy_version: RADAR_DOMAIN_POLICY_VERSION,
    };
  }
  if (positiveSignals.length >= 1 && !negativeSignals.length) {
    return {
      status: "in_domain",
      conclusive: true,
      reason_code: null,
      positive_signals: positiveSignals,
      negative_signals: negativeSignals,
      policy_version: RADAR_DOMAIN_POLICY_VERSION,
    };
  }
  return {
    status: "review_required",
    conclusive: false,
    reason_code: RADAR_REASON_CODES.GAMING_DOMAIN_REVIEW_REQUIRED,
    positive_signals: positiveSignals,
    negative_signals: negativeSignals,
    policy_version: RADAR_DOMAIN_POLICY_VERSION,
  };
}

/**
 * @param {Record<string, any>} candidate
 * @param {Record<string, any> | null | undefined} humanReview
 */
export function projectRadarDomainReview(candidate = {}, humanReview = null) {
  const automaticDomain = evaluateGamingDomain(candidate);
  const candidateDomainFingerprint = cleanText(candidate?.domain_review_fingerprint, 80);
  const exactReview = isRecord(humanReview)
    && cleanText(humanReview.provider, 40) === cleanText(candidate?.provider, 40)
    && cleanText(humanReview.external_id, 220) === cleanText(candidate?.external_id, 220)
    && /^[a-f0-9]{64}$/.test(candidateDomainFingerprint)
    && cleanText(humanReview.domain_fingerprint, 80) === candidateDomainFingerprint
    && cleanText(humanReview.policy_version, 100) === automaticDomain.policy_version
    ? humanReview : null;
  const humanDecision = cleanText(exactReview?.decision, 40);
  const humanDomainReview = exactReview ? {
    request_id: cleanText(exactReview.request_id, 80),
    decision: humanDecision,
    rationale: cleanText(exactReview.rationale, 1_000),
    evidence_refs: (Array.isArray(exactReview.evidence_refs)
      ? exactReview.evidence_refs.slice(0, 8) : []).filter(isRecord).map((reference) => ({
      url: safePublicUrl(reference.url),
      role: cleanText(reference.role, 80),
    })).filter((reference) => reference.url && reference.role),
    candidate_fingerprint: cleanText(exactReview.candidate_fingerprint, 80),
    domain_fingerprint: cleanText(exactReview.domain_fingerprint, 80),
    policy_version: cleanText(exactReview.policy_version, 100),
    supersedes_request_id: cleanText(exactReview.supersedes_request_id, 80) || null,
    created_at: cleanText(exactReview.created_at, 80),
  } : null;
  const domain = exactReview && ["in_domain", "out_of_domain"].includes(humanDecision)
    ? {
      status: humanDecision,
      conclusive: true,
      reason_code: humanDecision === "out_of_domain" ? RADAR_REASON_CODES.OUTSIDE_GAMING_DOMAIN : null,
      positive_signals: humanDecision === "in_domain"
        ? [...automaticDomain.positive_signals, { code: "GAMING_HUMAN_REVIEW", field: "domain_review" }]
        : automaticDomain.positive_signals,
      negative_signals: automaticDomain.negative_signals,
      policy_version: automaticDomain.policy_version,
      human_review_request_id: exactReview.request_id,
    } : automaticDomain;
  return {
    ...candidate,
    domain_status: domain.status,
    domain_reason_code: domain.reason_code,
    domain_positive_signals: domain.positive_signals,
    domain_negative_signals: domain.negative_signals,
    domain_policy_version: domain.policy_version,
    human_domain_review: humanDomainReview,
  };
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

export function normalizeProviderResult(value) {
  const result = normalizeComparableText(value);
  if (["yes", "si", "true", "1"].includes(result)) return "yes";
  if (["no", "false", "0"].includes(result)) return "no";
  if (result === "scalar") return "scalar";
  return null;
}

export function providerResultLabel(value) {
  const result = normalizeProviderResult(value);
  if (result === "yes") return "Sí";
  if (result === "no") return "No";
  if (result === "scalar") return "Resultado numérico";
  return "Resultado publicado";
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
  const rawResolutionProvenance = isRecord(input.resolution_source_provenance)
    ? input.resolution_source_provenance : {};
  const resolutionSourceProvenance = resolutionUrl
    && cleanText(rawResolutionProvenance.provider, 40) === provider
    && safePublicUrl(rawResolutionProvenance.source_url) === resolutionUrl
    && cleanText(rawResolutionProvenance.adapter_version, 100) === RADAR_NORMALIZER_VERSION
    && [
      "market.resolutionSource",
      "event.resolutionSource",
      "market.settlement_sources",
      "event.settlement_sources",
      "market.rules_url",
      "event.rules_url",
    ].includes(cleanText(rawResolutionProvenance.upstream_field, 100))
    ? {
      provider,
      source_url: resolutionUrl,
      upstream_field: cleanText(rawResolutionProvenance.upstream_field, 100),
      adapter_version: RADAR_NORMALIZER_VERSION,
      declared_by_provider: true,
    }
    : null;
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
    source_market_open_at: safeIsoDate(input.market_open_at),
    source_event_at: safeIsoDate(input.event_at),
    source_event_start_at: safeIsoDate(input.event_start_at),
    source_event_end_at: safeIsoDate(input.event_end_at),
    source_settlement_at: safeIsoDate(input.settlement_at ?? input.settled_at),
    source_series_expiry_at: safeIsoDate(input.series_expiry_at),
    source_last_trade_at: safeIsoDate(input.last_trade_at),
    source_resolution_deadline: safeIsoDate(input.resolution_deadline),
    source_probability: probability,
    source_probability_yes: probability,
    source_volume: safeNumber(input.volume),
    source_volume_total: safeNumber(input.volume),
    source_liquidity: safeNumber(input.liquidity),
    source_status: cleanText(input.status, 80).toLowerCase() || null,
    source_result: normalizeProviderResult(input.result),
    source_settled_at: safeIsoDate(input.settled_at),
    source_resolution_rules: cleanText(input.resolution_rules, 5000) || null,
    source_resolution_url: resolutionUrl,
    source_resolution_provenance: resolutionSourceProvenance,
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
    fact_context_fingerprint: cleanText(input.fact_context_fingerprint, 120) || null,
    fingerprint: stableFingerprint(provider, eventKey, title, input.question, input.fact_context_fingerprint, RADAR_ELIGIBILITY_POLICY_VERSION),
    fetched_at: now,
    first_seen_at: now,
    last_seen_at: now,
    expires_at: expiresAt,
    cache_expires_at: expiresAt,
    normalizer_version: RADAR_NORMALIZER_VERSION,
    eligibility_policy_version: RADAR_ELIGIBILITY_POLICY_VERSION,
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
    // Las candidatas tradables y el contexto factual son conceptos distintos.
    // Cada hija conserva una proyección acotada de TODAS las hijas canónicas,
    // incluidas las cerradas, para no perder un resultado ya publicado.
    const canonicalMarkets = markets.filter(isRecord);
    const declaredChildCountValue = Number(
      event.provider_declared_child_count ?? event.market_count ?? event.markets_count,
    );
    const providerPaginationExhausted = event.provider_pagination_exhausted === true;
    const declaredChildCount = Number.isSafeInteger(declaredChildCountValue) && declaredChildCountValue >= 0
      ? declaredChildCountValue : providerPaginationExhausted ? canonicalMarkets.length : null;
    const canonicalEventChildren = canonicalMarkets.map((item) => {
      const outcome = parsePolymarketOutcomes(item);
      const closed = item.closed === true || item.archived === true || item.acceptingOrders === false || item.active === false;
      const rawLabel = providerChildRawLabel(item) || null;
      return {
        market_id: cleanText(item.id ?? item.conditionId ?? item.slug, 220),
        condition_id: cleanText(item.conditionId, 220) || null,
        market_slug: cleanText(item.slug, 400) || null,
        token_ids: providerChildIdentifiers(item).token_ids,
        raw_provider_child_label: rawLabel,
        question: cleanText(item.question, 700),
        status: closed ? "closed" : "open",
        result: normalizeProviderResult(item.result ?? item.resolutionResult ?? item.winningOutcome),
        probability_yes: outcome.probability,
        settled_at: safeIsoDate(item.resolvedAt ?? item.resolutionDate),
      };
    });
    // En eventos con varias opciones, un `result` del contenedor no describe
    // necesariamente a cada hija. Solo se propaga si el proveedor marca el
    // evento completo como resuelto (o si realmente es un evento de una opción).
    const eventResolved = event.resolved === true || (
      canonicalMarkets.length === 1
      && Boolean(normalizeProviderResult(event.result ?? event.resolutionResult ?? event.winningOutcome))
    );
    const eventUnavailable = event.closed === true
      || event.archived === true
      || event.active === false
      || event.acceptingOrders === false;
    const eventHasOpenChild = canonicalMarkets.some((item) => {
      const childResult = normalizeProviderResult(item.result ?? item.resolutionResult ?? item.winningOutcome);
      return !childResult
        && item.resolved !== true
        && item.closed !== true
        && item.archived !== true
        && item.active !== false
        && item.acceptingOrders !== false;
    });
    const factContextFingerprint = stableFingerprint(JSON.stringify(canonicalEventChildren));
    for (const marketValue of markets) {
      if (!isRecord(marketValue)) continue;
      const market = marketValue;
      const marketId = cleanText(market.id ?? market.conditionId ?? market.slug, 220);
      if (!marketId) continue;
      const marketSlug = cleanText(market.slug, 400);
      const marketResolutionUrl = safePublicUrl(market.resolutionSource);
      const eventResolutionUrl = safePublicUrl(event.resolutionSource);
      const resolutionUrl = marketResolutionUrl ?? eventResolutionUrl;
      const resolutionUpstreamField = marketResolutionUrl
        ? "market.resolutionSource" : eventResolutionUrl ? "event.resolutionSource" : null;
      const parsed = parsePolymarketOutcomes(market);
      const rawProviderChildLabel = providerChildRawLabel(market) || null;
      const canonicalIdentity = providerChildCanonicalIdentity(market);
      const identityDimension = familyDimension(market.question ?? event.title).dimension;
      const optionIdentityRequired = event.negRisk === true || event.enableNegRisk === true
        || ["outcome", "participant", "platform"].includes(identityDimension)
        || isProviderPlaceholderLabel(rawProviderChildLabel);
      const canonicalChildLabel = optionIdentityRequired ? canonicalIdentity.label : null;
      const childUnavailable = market.closed === true
        || market.archived === true
        || market.active === false
        || market.acceptingOrders === false;
      const status = eventResolved || eventUnavailable
        ? "closed"
        : childUnavailable
          ? "inactive"
          : "open";
      const candidate = baseCandidate("polymarket", `polymarket:${marketId}`, {
        title: event.title ?? market.question,
        question: market.question ?? event.title,
        description: market.description ?? event.description,
        category: event.category ?? market.category,
        tags: [event.category, market.category, ...(Array.isArray(event.tags) ? event.tags.map((tag) => tag?.label ?? tag) : [])],
        close_at: market.endDate ?? event.endDate,
        market_open_at: market.startDate ?? event.startDate,
        event_at: market.gameStartTime ?? event.gameStartTime,
        event_end_at: event.endDate,
        settlement_at: market.resolvedAt ?? market.resolutionDate ?? event.resolvedAt ?? event.resolutionDate,
        probability: parsed.probability,
        volume: market.volumeNum ?? market.volume ?? event.volume,
        liquidity: market.liquidityNum ?? market.liquidity ?? event.liquidity,
        status,
        result: market.result ?? market.resolutionResult ?? market.winningOutcome,
        settled_at: market.resolvedAt ?? market.resolutionDate ?? event.resolvedAt ?? event.resolutionDate,
        resolution_rules: market.description ?? event.description,
        resolution_url: resolutionUrl,
        resolution_source_provenance: resolutionUrl && resolutionUpstreamField ? {
          provider: "polymarket",
          source_url: resolutionUrl,
          upstream_field: resolutionUpstreamField,
          adapter_version: RADAR_NORMALIZER_VERSION,
        } : null,
        external_event_id: eventId,
        external_market_id: marketId,
        external_event_slug: eventSlug,
        external_market_slug: marketSlug,
        event_group_key: `polymarket:${eventId || eventSlug}`,
        fact_context_fingerprint: factContextFingerprint,
        external_event_url: eventValidated ? eventUrl : null,
        external_market_url: eventValidated ? eventUrl : null,
        provider_payload: {
          event_id: eventId,
          event_slug: eventSlug,
          market_id: marketId,
          market_slug: marketSlug,
          condition_id: cleanText(market.conditionId, 220) || null,
          outcomes: parsed.outcomes,
          result: normalizeProviderResult(market.result ?? market.resolutionResult ?? market.winningOutcome),
          canonical_event_children: canonicalEventChildren,
          canonical_event_children_total: canonicalMarkets.length,
          canonical_event_children_complete: canonicalMarkets.length > 0 && canonicalEventChildren.length === canonicalMarkets.length,
          fact_context_fingerprint: factContextFingerprint,
          canonical_url_verified: eventValidated,
          startDate: market.startDate ?? event.startDate ?? null,
          endDate: market.endDate ?? event.endDate ?? null,
          closedTime: market.closedTime ?? event.closedTime ?? null,
          gameStartTime: market.gameStartTime ?? event.gameStartTime ?? null,
          umaEndDate: market.umaEndDate ?? event.umaEndDate ?? null,
        },
      }, now, cacheMinutes);
      candidate.raw_provider_child_label = rawProviderChildLabel;
      candidate.identity_kind = optionIdentityRequired ? "option" : "contract";
      candidate.canonical_child_label = canonicalChildLabel;
      candidate.canonical_child_key = canonicalChildLabel
        ? `option:${radarOptionSlug(canonicalChildLabel, 120)}` : null;
      candidate.identity_status = !optionIdentityRequired || canonicalChildLabel ? "resolved" : "unresolved_placeholder";
      candidate.identity_classification = !optionIdentityRequired || canonicalChildLabel
        ? (optionIdentityRequired ? providerSemanticClassification(canonicalChildLabel) : null)
          ?? (childUnavailable ? "provider_closed_child" : "identified_real_option")
        : "provider_placeholder_pending_resolution";
      candidate.identity_source = optionIdentityRequired ? canonicalIdentity.source : "provider_contract_identity";
      candidate.identity_confidence = optionIdentityRequired ? canonicalIdentity.confidence : 100;
      candidate.canonical_projection_version = RADAR_CHILD_PROJECTION_VERSION;
      candidate.provider_payload = {
        ...candidate.provider_payload,
        raw_provider_child_label: rawProviderChildLabel,
        identity_kind: candidate.identity_kind,
        canonical_child_label: canonicalChildLabel,
        identity_status: candidate.identity_status,
        identity_classification: candidate.identity_classification,
        canonical_event_children_total: declaredChildCount,
        canonical_event_children_complete: providerPaginationExhausted
          && declaredChildCount !== null && canonicalEventChildren.length === declaredChildCount,
        provider_pagination_exhausted: providerPaginationExhausted,
      };
      const closeMs = Date.parse(candidate.source_close_at ?? "");
      const nowMs = Date.parse(now);
      if (candidate.source_result || market.resolved === true || eventResolved) {
        candidate.hard_reject_reasons.push(RADAR_REASON_CODES.EVENT_ALREADY_RESOLVED);
      }
      if (childUnavailable && eventHasOpenChild && !eventResolved && !eventUnavailable
          && (!Number.isFinite(closeMs) || !Number.isFinite(nowMs) || closeMs > nowMs)) {
        candidate.hard_reject_reasons.push(RADAR_REASON_CODES.PROVIDER_OPTION_INACTIVE);
      } else if (!providerIsOpen(status) || (Number.isFinite(closeMs) && Number.isFinite(nowMs) && closeMs <= nowMs)) {
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
    const marketRulesUrl = safePublicUrl(market.rules_url);
    const eventRulesUrl = safePublicUrl(event.rules_url);
    const resolutionUrl = resolutionSources[0] ?? marketRulesUrl ?? eventRulesUrl;
    const resolutionUpstreamField = resolutionSources.length
      ? (Array.isArray(market.settlement_sources) ? "market.settlement_sources" : "event.settlement_sources")
      : marketRulesUrl ? "market.rules_url" : eventRulesUrl ? "event.rules_url" : null;
    const candidate = baseCandidate("kalshi", `kalshi:${ticker}`, {
      title: event.title ?? market.title,
      question: market.title ?? event.title,
      description: market.subtitle ?? event.sub_title ?? event.title,
      category: event.category ?? market.category ?? options.category,
      tags: [event.category, event.series_ticker, market.series_ticker, ...(Array.isArray(event.tags) ? event.tags : [])],
      close_at: market.close_time,
      market_open_at: market.open_time,
      event_at: market.occurrence_datetime ?? event.occurrence_datetime,
      settlement_at: market.settlement_ts ?? market.determined_at ?? event.settlement_ts,
      last_trade_at: market.close_time,
      series_expiry_at: event.latest_expiration_time,
      resolution_deadline: market.latest_expiration_time ?? event.latest_expiration_time,
      probability: kalshiProbability(market),
      volume: market.volume_fp ?? market.volume ?? event.volume_fp ?? event.volume,
      liquidity: market.liquidity_dollars ?? market.liquidity ?? event.liquidity,
      status,
      result: market.result,
      settled_at: market.settlement_ts ?? market.determined_at ?? event.settlement_ts,
      resolution_rules: rules,
      resolution_url: resolutionUrl,
      resolution_source_provenance: resolutionUrl && resolutionUpstreamField ? {
        provider: "kalshi",
        source_url: resolutionUrl,
        upstream_field: resolutionUpstreamField,
        adapter_version: RADAR_NORMALIZER_VERSION,
      } : null,
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
        strike_type: cleanText(market.strike_type, 80) || null,
        floor_strike: safeNumber(market.floor_strike),
        cap_strike: safeNumber(market.cap_strike),
        functional_strike: cleanText(market.functional_strike, 500) || null,
        yes_sub_title: cleanText(market.yes_sub_title, 500) || null,
        no_sub_title: cleanText(market.no_sub_title, 500) || null,
        settlement_sources: resolutionSources,
        result: normalizeProviderResult(market.result),
        settlement_ts: safeIsoDate(market.settlement_ts ?? market.determined_at ?? event.settlement_ts),
        canonical_url_verified: urlVerified,
        open_time: market.open_time ?? null,
        close_time: market.close_time ?? null,
        expected_expiration_time: market.expected_expiration_time ?? event.expected_expiration_time ?? null,
        latest_expiration_time: market.latest_expiration_time ?? event.latest_expiration_time ?? null,
        expiration_time: market.expiration_time ?? null,
        occurrence_datetime: market.occurrence_datetime ?? event.occurrence_datetime ?? null,
      },
    }, now, cacheMinutes);
    const rawProviderChildLabel = providerChildRawLabel(market) || null;
    const canonicalIdentity = providerChildCanonicalIdentity(market);
    const marketUnavailable = !providerIsOpen(status);
    const identityDimension = familyDimension(market.title ?? event.title).dimension;
    const optionIdentityRequired = event.mutually_exclusive === true
      || ["outcome", "participant", "platform"].includes(identityDimension)
      || isProviderPlaceholderLabel(rawProviderChildLabel);
    const canonicalChildLabel = optionIdentityRequired ? canonicalIdentity.label : null;
    candidate.raw_provider_child_label = rawProviderChildLabel;
    candidate.identity_kind = optionIdentityRequired ? "option" : "contract";
    candidate.canonical_child_label = canonicalChildLabel;
    candidate.canonical_child_key = canonicalChildLabel
      ? `option:${radarOptionSlug(canonicalChildLabel, 120)}` : null;
    candidate.identity_status = !optionIdentityRequired || canonicalChildLabel ? "resolved" : "unresolved_placeholder";
    candidate.identity_classification = !optionIdentityRequired || canonicalChildLabel
      ? (optionIdentityRequired ? providerSemanticClassification(canonicalChildLabel) : null)
        ?? (marketUnavailable ? "provider_closed_child" : "identified_real_option")
      : "provider_placeholder_pending_resolution";
    candidate.identity_source = optionIdentityRequired ? canonicalIdentity.source : "provider_contract_identity";
    candidate.identity_confidence = optionIdentityRequired ? canonicalIdentity.confidence : 100;
    candidate.canonical_projection_version = RADAR_CHILD_PROJECTION_VERSION;
    candidate.provider_payload = {
      ...candidate.provider_payload,
      raw_provider_child_label: rawProviderChildLabel,
      identity_kind: candidate.identity_kind,
      canonical_child_label: canonicalChildLabel,
      identity_status: candidate.identity_status,
      identity_classification: candidate.identity_classification,
    };
    const marketType = cleanText(market.market_type, 80).toLowerCase();
    if (marketType && !["binary", "yes_no"].includes(marketType)) candidate.hard_reject_reasons.push(RADAR_REASON_CODES.EVENT_OUTSIDE_CONTRACT);
    if (candidate.source_result || ["determined", "finalized", "settled"].includes(status)) {
      candidate.hard_reject_reasons.push(RADAR_REASON_CODES.EVENT_ALREADY_RESOLVED);
    }
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

const FAMILY_MONTHS = Object.freeze({
  january: 1, jan: 1, enero: 1, ene: 1,
  february: 2, feb: 2, febrero: 2,
  march: 3, mar: 3, marzo: 3,
  april: 4, apr: 4, abril: 4, abr: 4,
  may: 5, mayo: 5,
  june: 6, jun: 6, junio: 6,
  july: 7, jul: 7, julio: 7,
  august: 8, aug: 8, agosto: 8, ago: 8,
  september: 9, sept: 9, sep: 9, septiembre: 9, setiembre: 9,
  october: 10, oct: 10, octubre: 10,
  november: 11, nov: 11, noviembre: 11,
  december: 12, dec: 12, diciembre: 12, dic: 12,
});

const FAMILY_TIMEZONE_ALIASES = Object.freeze({
  utc: { id: "UTC", mode: "fixed_offset", offset_minutes: 0, label: "UTC" },
  gmt: { id: "UTC", mode: "fixed_offset", offset_minutes: 0, label: "GMT" },
  et: { id: "America/New_York", mode: "iana", offset_minutes: null, label: "ET" },
  pt: { id: "America/Los_Angeles", mode: "iana", offset_minutes: null, label: "PT" },
  mt: { id: "America/Denver", mode: "iana", offset_minutes: null, label: "MT" },
  ct: { id: "America/Chicago", mode: "iana", offset_minutes: null, label: "CT" },
  est: { id: "UTC-05:00", mode: "fixed_offset", offset_minutes: -300, label: "EST" },
  edt: { id: "UTC-04:00", mode: "fixed_offset", offset_minutes: -240, label: "EDT" },
  pst: { id: "UTC-08:00", mode: "fixed_offset", offset_minutes: -480, label: "PST" },
  pdt: { id: "UTC-07:00", mode: "fixed_offset", offset_minutes: -420, label: "PDT" },
  mst: { id: "UTC-07:00", mode: "fixed_offset", offset_minutes: -420, label: "MST" },
  mdt: { id: "UTC-06:00", mode: "fixed_offset", offset_minutes: -360, label: "MDT" },
  akst: { id: "UTC-09:00", mode: "fixed_offset", offset_minutes: -540, label: "AKST" },
  akdt: { id: "UTC-08:00", mode: "fixed_offset", offset_minutes: -480, label: "AKDT" },
  hst: { id: "UTC-10:00", mode: "fixed_offset", offset_minutes: -600, label: "HST" },
  cet: { id: "UTC+01:00", mode: "fixed_offset", offset_minutes: 60, label: "CET" },
  cest: { id: "UTC+02:00", mode: "fixed_offset", offset_minutes: 120, label: "CEST" },
  eet: { id: "UTC+02:00", mode: "fixed_offset", offset_minutes: 120, label: "EET" },
  eest: { id: "UTC+03:00", mode: "fixed_offset", offset_minutes: 180, label: "EEST" },
  wet: { id: "UTC", mode: "fixed_offset", offset_minutes: 0, label: "WET" },
  west: { id: "UTC+01:00", mode: "fixed_offset", offset_minutes: 60, label: "WEST" },
  cst: { id: "AMBIGUOUS:CST", mode: "ambiguous", offset_minutes: null, label: "CST", ambiguous: true },
  cdt: { id: "AMBIGUOUS:CDT", mode: "ambiguous", offset_minutes: null, label: "CDT", ambiguous: true },
  ist: { id: "AMBIGUOUS:IST", mode: "ambiguous", offset_minutes: null, label: "IST", ambiguous: true },
  bst: { id: "AMBIGUOUS:BST", mode: "ambiguous", offset_minutes: null, label: "BST", ambiguous: true },
  ast: { id: "AMBIGUOUS:AST", mode: "ambiguous", offset_minutes: null, label: "AST", ambiguous: true },
});

const FAMILY_UNIT_ALIASES = Object.freeze({
  "%": "percent", percent: "percent", percentage: "percent", porcentaje: "percent",
  point: "points", points: "points", pt: "points", pts: "points", punto: "points", puntos: "points",
  second: "seconds", seconds: "seconds", sec: "seconds", secs: "seconds", segundo: "seconds", segundos: "seconds",
  minute: "minutes", minutes: "minutes", minuto: "minutes", minutos: "minutes",
  hour: "hours", hours: "hours", hora: "hours", horas: "hours",
  view: "views", views: "views", viewer: "views", viewers: "views", visualizacion: "views", visualizaciones: "views",
  copy: "copies", copies: "copies", copia: "copies", copias: "copies",
  game: "copies", games: "copies", juego: "copies", juegos: "copies", unit: "copies", units: "copies", unidades: "copies",
  dollar: "usd", dollars: "usd", dolar: "usd", dolares: "usd", usd: "usd",
  subscriber: "subscribers", subscribers: "subscribers", suscriptor: "subscribers", suscriptores: "subscribers",
});

function familySlug(value, maxLength = 120) {
  const bounded = Math.max(1, Math.min(240, Math.floor(Number(maxLength) || 120)));
  const raw = cleanText(value, 500);
  if (!raw) return "";
  const folded = raw.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const ascii = folded.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const encoded = [...raw.normalize("NFC").toLowerCase()]
    .filter((character) => {
      if (!/[\p{L}\p{N}]/u.test(character) || /[a-z0-9]/.test(character)) return false;
      const latinFold = character.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      return !/^[a-z0-9]$/i.test(latinFold);
    })
    .map((character) => character.codePointAt(0).toString(16)).join("-");
  let slug = ascii && encoded ? `${ascii}-u-${encoded}` : ascii || (encoded ? `u-${encoded}` : "");
  if (!slug || slug.length <= bounded) return slug;
  const suffix = radarSlugHash(raw);
  if (bounded <= suffix.length) return suffix.slice(0, bounded);
  slug = `${slug.slice(0,Math.max(1,bounded-suffix.length-1)).replace(/-+$/g,"")}-${suffix}`;
  return slug.slice(0,bounded);
}

function familyFoldText(value) {
  return cleanText(value, 4000)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function familyCanonicalTimezone(value) {
  const raw = cleanText(value, 100);
  if (!raw) return null;
  const alias = FAMILY_TIMEZONE_ALIASES[normalizeComparableText(raw).replace(/\s+/g, "")];
  if (alias) return { ...alias };
  const compact = raw.replace(/\s+/g, "");
  const offset = compact.match(/^(?:UTC|GMT)?([+-])(\d{1,2})(?::?(\d{2}))?$/i);
  if (offset) {
    const hours = Number(offset[2]);
    const minutes = Number(offset[3] ?? 0);
    if (hours <= 14 && minutes < 60 && !(hours === 14 && minutes !== 0)) {
      const direction = offset[1] === "+" ? 1 : -1;
      const offsetMinutes = direction * ((hours * 60) + minutes);
      const sign = offsetMinutes < 0 ? "-" : "+";
      const absolute = Math.abs(offsetMinutes);
      return {
        id: offsetMinutes === 0 ? "UTC" : `UTC${sign}${String(Math.floor(absolute / 60)).padStart(2, "0")}:${String(absolute % 60).padStart(2, "0")}`,
        mode: "fixed_offset",
        offset_minutes: offsetMinutes,
        label: raw.toUpperCase(),
      };
    }
  }
  try {
    const id = new Intl.DateTimeFormat("en-US", { timeZone: raw }).resolvedOptions().timeZone;
    return { id, mode: id === "UTC" ? "fixed_offset" : "iana", offset_minutes: id === "UTC" ? 0 : null, label: raw };
  } catch {
    return {
      id: `AMBIGUOUS:${familySlug(raw, 40).toUpperCase() || "TIMEZONE"}`,
      mode: "ambiguous",
      offset_minutes: null,
      label: raw,
      ambiguous: true,
    };
  }
}

function familyTimezone(candidate, source) {
  const contextContracts = [];
  let remaining = cleanText(source, 4000);
  remaining = remaining.replace(/\b(?:UTC|GMT)\s*[+-]\s*\d{1,2}(?::?\d{2})?\b/gi, (value) => {
    contextContracts.push(familyCanonicalTimezone(value));
    return " ".repeat(value.length);
  });
  remaining = remaining.replace(/\b[A-Za-z_]+\/[A-Za-z_]+(?:\/[A-Za-z_]+)?\b/g, (value) => {
    contextContracts.push(familyCanonicalTimezone(value));
    return " ".repeat(value.length);
  });
  const abbreviations = /\b(UTC|GMT|ET|EST|EDT|PT|PST|PDT|MT|MST|MDT|CT|CST|CDT|AKST|AKDT|HST|CET|CEST|EET|EEST|WET|WEST|IST|BST|AST)\b/gi;
  for (const match of remaining.matchAll(abbreviations)) contextContracts.push(familyCanonicalTimezone(match[1]));
  const uniqueContext = [...new Map(contextContracts.filter(Boolean).map((contract) => [contract.id, contract])).values()];
  if (uniqueContext.length === 1) return uniqueContext[0];
  if (uniqueContext.length > 1) {
    const labels = uniqueContext.map((contract) => contract.label).sort((left, right) => left.localeCompare(right));
    return {
      id: `AMBIGUOUS:${labels.join("|")}`,
      mode: "ambiguous",
      offset_minutes: null,
      label: labels.join(" / "),
      ambiguous: true,
    };
  }
  const explicit = [
    candidate?.evaluation_timezone,
    candidate?.timezone,
    candidate?.source_timezone,
    candidate?.provider_payload?.timezone,
    candidate?.normalized_payload?.timezone,
  ].filter((value) => cleanText(value, 100)).map(familyCanonicalTimezone).filter(Boolean);
  const uniqueExplicit = [...new Map(explicit.map((contract) => [contract.id, contract])).values()];
  if (uniqueExplicit.length === 1) return uniqueExplicit[0];
  if (uniqueExplicit.length > 1) {
    const labels = uniqueExplicit.map((contract) => contract.label).sort((left, right) => left.localeCompare(right));
    return {
      id: `AMBIGUOUS:${labels.join("|")}`,
      mode: "ambiguous",
      offset_minutes: null,
      label: labels.join(" / "),
      ambiguous: true,
    };
  }
  return { ...FAMILY_TIMEZONE_ALIASES.utc };
}

function familyLocalInstant(parts, timezoneContract) {
  const target = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  if (timezoneContract.mode === "fixed_offset") {
    return { instant: new Date(target - (timezoneContract.offset_minutes * 60_000)).toISOString(), ambiguous: false, candidates: [] };
  }
  if (timezoneContract.mode !== "iana") return { instant: null, ambiguous: true, reason: "ambiguous_timezone", candidates: [] };
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezoneContract.id,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hourCycle: "h23",
  });
  const view = (instantMs) => Object.fromEntries(
    formatter.formatToParts(new Date(instantMs)).map((part) => [part.type, part.value]),
  );
  const offsets = new Set();
  for (let deltaHours = -48; deltaHours <= 48; deltaHours += 6) {
    const sample = target + (deltaHours * 3_600_000);
    const viewed = view(sample);
    offsets.add(Date.UTC(
      Number(viewed.year), Number(viewed.month) - 1, Number(viewed.day),
      Number(viewed.hour), Number(viewed.minute), Number(viewed.second),
    ) - sample);
  }
  const candidates = [...offsets].map((offset) => target - offset).filter((candidate) => {
    const viewed = view(candidate);
    return Number(viewed.year) === parts.year
      && Number(viewed.month) === parts.month
      && Number(viewed.day) === parts.day
      && Number(viewed.hour) === parts.hour
      && Number(viewed.minute) === parts.minute
      && Number(viewed.second) === parts.second;
  }).filter((value, index, values) => values.indexOf(value) === index).sort((left, right) => left - right);
  if (candidates.length !== 1) {
    return {
      instant: null,
      ambiguous: true,
      reason: candidates.length === 0 ? "nonexistent_local_time" : "repeated_local_time",
      candidates: candidates.map((value) => new Date(value).toISOString()),
    };
  }
  return { instant: new Date(candidates[0]).toISOString(), ambiguous: false, candidates: [] };
}

function familyTemporalOperator(source) {
  if (/\b(on or before|no later than|at or before|by|hasta(?: el)?|a mas tardar|o antes)\b/.test(source)) return "lte";
  if (/\b(before|prior to|earlier than|antes de|antes del|previo a)\b/.test(source)) return "lt";
  if (/\b(on or after|no earlier than|at or after|desde|a partir de|o despues)\b/.test(source)) return "gte";
  if (/\b(after|later than|despues de|posterior a)\b/.test(source)) return "gt";
  if (/\b(exactly on|on exactly|exactamente el|el dia)\b/.test(source)) return "eq";
  return "lte";
}

function familyClock(source) {
  let match = source.match(/\b([01]?\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?\s*(am|pm)?\b/i);
  const hasColon = Boolean(match);
  if (!match) match = source.match(/\b(1[0-2]|0?\d)\s*(am|pm)\b/i);
  if (!match) return null;
  let hour = Number(match[1]);
  const meridiem = ((hasColon ? match[4] : match[2]) ?? "").toLowerCase();
  const minute = hasColon ? Number(match[2]) : 0;
  const second = hasColon ? Number(match[3] ?? 0) : 0;
  if (meridiem === "pm" && hour < 12) hour += 12;
  if (meridiem === "am" && hour === 12) hour = 0;
  return { hour, minute, second, granularity: second ? "second" : "minute" };
}

function familyTemporalBoundary(candidate, question) {
  const folded = familyFoldText(question);
  const source = normalizeComparableText(question);
  const timezoneContract = familyTimezone(candidate, `${question} ${candidate?.source_resolution_rules ?? ""}`);
  const operator = familyTemporalOperator(source);
  const clock = familyClock(folded);
  let match;
  let year;
  let month;
  let day;
  let granularity;

  match = folded.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  if (match) {
    [, year, month, day] = match.map(Number);
    granularity = "day";
  }
  if (!granularity) {
    match = source.match(/\b(\d{1,2})\s+(?:de\s+)?([a-z]+)\s+(?:de\s+)?(20\d{2})\b/);
    if (match && FAMILY_MONTHS[match[2]]) {
      day = Number(match[1]); month = FAMILY_MONTHS[match[2]]; year = Number(match[3]); granularity = "day";
    }
  }
  if (!granularity) {
    match = source.match(/\b([a-z]+)\s+(\d{1,2})(?:\s+de)?\s+(20\d{2})\b/);
    if (match && FAMILY_MONTHS[match[1]]) {
      month = FAMILY_MONTHS[match[1]]; day = Number(match[2]); year = Number(match[3]); granularity = "day";
    }
  }
  if (!granularity) {
    match = source.match(/\b([a-z]+)\s+(?:de\s+)?(20\d{2})\b/);
    if (match && FAMILY_MONTHS[match[1]]) {
      month = FAMILY_MONTHS[match[1]]; year = Number(match[2]); granularity = "month";
    }
  }
  if (!granularity) {
    match = source.match(/\b(20\d{2})\b/);
    if (match) {
      year = Number(match[1]); granularity = "year";
    }
  }

  const authoritativeCutoff = safeIsoDate(candidate?.evaluation_ends_at ?? candidate?.family_cutoff_at);
  if (!granularity && !authoritativeCutoff) return null;
  if (!granularity) granularity = "second";
  const dateGranularity = granularity;
  if (clock && ["day", "month", "year"].includes(granularity)) granularity = clock.granularity;

  let instant = authoritativeCutoff;
  let localInstant = null;
  let localResolution = null;
  if (!instant) {
    if (dateGranularity === "year") {
      month = ["lte", "gt"].includes(operator) ? 12 : 1;
      day = ["lte", "gt"].includes(operator) ? 31 : 1;
    } else if (dateGranularity === "month") {
      day = ["lte", "gt"].includes(operator) ? new Date(Date.UTC(year, month, 0)).getUTCDate() : 1;
    }
    const calendarProbe = new Date(Date.UTC(year, month - 1, day));
    if (calendarProbe.getUTCFullYear() !== year
        || calendarProbe.getUTCMonth() + 1 !== month
        || calendarProbe.getUTCDate() !== day) return null;
    const atEnd = !clock && ["lte", "gt"].includes(operator);
    const localParts = {
      year, month, day,
      hour: clock?.hour ?? (atEnd ? 23 : 0),
      minute: clock?.minute ?? (atEnd ? 59 : 0),
      second: clock?.second ?? (atEnd ? 59 : 0),
    };
    localInstant = `${String(localParts.year).padStart(4, "0")}-${String(localParts.month).padStart(2, "0")}-${String(localParts.day).padStart(2, "0")}T${String(localParts.hour).padStart(2, "0")}:${String(localParts.minute).padStart(2, "0")}:${String(localParts.second).padStart(2, "0")}`;
    localResolution = familyLocalInstant(localParts, timezoneContract);
    instant = localResolution.instant;
  }
  let canonicalOperator = operator;
  if (!clock && ["day", "month", "year"].includes(dateGranularity)
      && ["lte", "gt"].includes(operator)) {
    canonicalOperator = operator === "lte" ? "lt" : "gte";
  }
  if (timezoneContract.ambiguous || localResolution?.ambiguous) {
    const originalLocal = localInstant ?? authoritativeCutoff;
    const canonicalLocal = originalLocal && canonicalOperator !== operator
      ? new Date(Date.parse(`${originalLocal.replace(/Z$/, "")}Z`) + 1_000).toISOString().replace(/\.000Z$/, "")
      : originalLocal;
    return {
      operator,
      instant: null,
      canonical_operator: canonicalOperator,
      canonical_instant: null,
      local_instant: originalLocal,
      canonical_local_instant: canonicalLocal,
      timezone: timezoneContract.id,
      timezone_label: timezoneContract.label,
      timezone_mode: timezoneContract.mode,
      offset_minutes: null,
      timezone_ambiguous: true,
      ambiguity_reason: localResolution?.reason ?? "ambiguous_timezone",
      candidate_instants: localResolution?.candidates ?? [],
      identity_ambiguous: true,
      granularity,
    };
  }
  if (!safeIsoDate(instant)) return null;
  let canonicalInstant = safeIsoDate(instant);
  if (!clock && ["day", "month", "year"].includes(dateGranularity)
      && ["lte", "gt"].includes(operator)) {
    canonicalInstant = new Date(Date.parse(canonicalInstant) + 1_000).toISOString();
  }
  return {
    operator,
    instant: safeIsoDate(instant),
    canonical_operator: canonicalOperator,
    canonical_instant: canonicalInstant,
    timezone: timezoneContract.id,
    timezone_label: timezoneContract.label,
    timezone_mode: timezoneContract.mode,
    offset_minutes: timezoneContract.offset_minutes,
    timezone_ambiguous: false,
    granularity,
  };
}

function familyCanonicalNumber(value, scale) {
  const rawValue = String(value).trim();
  const separators = [...rawValue.matchAll(/[.,]/g)].map((match) => ({ value: match[0], index: match.index }));
  let normalizedValue = rawValue;
  if (separators.length === 1) {
    const decimalLength = rawValue.length - separators[0].index - 1;
    if (decimalLength === 3) return { value: null, ambiguous: true, raw_value: rawValue };
    normalizedValue = rawValue.replace(separators[0].value, ".");
  } else if (separators.length > 1) {
    const last = separators.at(-1);
    const decimalLength = rawValue.length - last.index - 1;
    const prior = separators.slice(0, -1);
    const priorSeparator = prior[0]?.value;
    const groupedIntegerParts = rawValue.slice(0, last.index).split(priorSeparator);
    const groupingValid = prior.every((separator) => separator.value === priorSeparator)
      && groupedIntegerParts[0].length >= 1 && groupedIntegerParts[0].length <= 3
      && groupedIntegerParts.slice(1).every((group) => group.length === 3);
    if (last.value === priorSeparator && decimalLength === 3 && groupingValid) {
      normalizedValue = rawValue.split(last.value).join("");
    } else if (last.value !== priorSeparator && decimalLength !== 3 && groupingValid) {
      normalizedValue = `${rawValue.slice(0, last.index).split(priorSeparator).join("")}.${rawValue.slice(last.index + 1)}`;
    } else {
      return { value: null, ambiguous: true, raw_value: rawValue };
    }
  }
  const parsed = Number(normalizedValue);
  if (!Number.isFinite(parsed)) return null;
  const multiplier = /^(?:thousand|mil)$/.test(scale) ? 1_000
    : /^(?:million|millions|millon|millones)$/.test(scale) ? 1_000_000
      : /^(?:billion|billions|billon|billones)$/.test(scale) ? 1_000_000_000 : 1;
  const scaled = parsed * multiplier;
  if (!Number.isFinite(scaled)) return null;
  return {
    value: Number.isInteger(scaled) ? String(scaled) : scaled.toFixed(8).replace(/0+$/, "").replace(/\.$/, ""),
    ambiguous: false,
    raw_value: rawValue,
  };
}

function familyCanonicalUnit(percentSign, rawUnit) {
  if (percentSign) return "percent";
  return FAMILY_UNIT_ALIASES[normalizeComparableText(rawUnit).replace(/\s+/g, "")] ?? "count";
}

function familyMetricUnit(value) {
  const source = normalizeComparableText(value);
  if (/\b(metacritic|score|scores|puntuacion|puntuaciones|points|puntos)\b/.test(source)) return "points";
  if (/\b(view|views|viewer|viewers|visualizacion|visualizaciones)\b/.test(source)) return "views";
  if (/\b(copy|copies|copia|copias|sales|ventas|units|unidades|games|juegos)\b/.test(source)) return "copies";
  if (/\b(subscriber|subscribers|suscriptor|suscriptores)\b/.test(source)) return "subscribers";
  return "count";
}

function familyThreshold(value) {
  const source = familyFoldText(value).replace(/[^a-z0-9%.,<>=]+/g, " ").trim();
  if (!source) return null;
  const amount = "(\\d+(?:[.,]\\d+)*)\\s*(%)?";
  const quantifiedAmount = `(?:[a-z]+\\s+){0,12}${amount}`;
  const patterns = [
    ["lte", `<=\\s*${quantifiedAmount}`],
    ["gte", `>=\\s*${quantifiedAmount}`],
    ["gt", `>(?!=)\\s*${quantifiedAmount}`],
    ["lt", `<(?!=)\\s*${quantifiedAmount}`],
    ["lte", `\\b(?:at most|no more than|como maximo|a lo sumo)\\s+${quantifiedAmount}`],
    ["gte", `\\b(?:at least|no less than|minimum(?: of)?|al menos|minimo(?: de)?|como minimo)\\s+${quantifiedAmount}`],
    ["gt", `\\b(?:above|over|more than|greater than|exceed\\w*|superior a|super\\w*|mas de)\\s+${quantifiedAmount}`],
    ["lt", `\\b(?:below|under|less than|fewer than|inferior a|menos de)\\s+${quantifiedAmount}`],
    ["eq", `\\b(?:exactly|equal to|exactamente|igual a)\\s+${quantifiedAmount}`],
    ["gte", `\\b(?:reach\\w*|alcanz\\w*)\\s+${quantifiedAmount}`],
  ];
  for (const [operator, pattern] of patterns) {
    const match = source.match(new RegExp(pattern));
    if (!match) continue;
    let remainder = source.slice((match.index ?? 0) + match[0].length);
    const scaleMatch = remainder.match(/^\s*(thousand|million|millions|billion|billions|mil|millon|millones|billon|billones)\b/);
    if (scaleMatch) remainder = remainder.slice(scaleMatch[0].length);
    remainder = remainder.replace(/^\s*(?:of|de)\b/, "");
    const unitMatch = remainder.match(/^\s*(percent|percentage|porcentaje|point|points|pt|pts|punto|puntos|second|seconds|sec|secs|segundo|segundos|minute|minutes|minuto|minutos|hour|hours|hora|horas|view|views|viewer|viewers|visualizacion|visualizaciones|copy|copies|copia|copias|game|games|juego|juegos|unit|units|unidades|dollar|dollars|dolar|dolares|usd|subscriber|subscribers|suscriptor|suscriptores)\b/);
    const number = familyCanonicalNumber(match[1], scaleMatch?.[1]);
    if (!number) return null;
    const explicitUnit = familyCanonicalUnit(match[2], unitMatch?.[1]);
    return {
      operator,
      value: number.value,
      unit: explicitUnit === "count" ? familyMetricUnit(source) : explicitUnit,
      ambiguous: number.ambiguous,
      raw_value: number.raw_value,
    };
  }
  return null;
}

function familyDimension(question) {
  const source = normalizeComparableText(question);
  // La dimensión la gobierna el predicado cuantificado de la pregunta. Un
  // sustantivo como "tráiler" no convierte un umbral de visualizaciones en
  // contenido oficial, y los números de las reglas nunca entran aquí.
  if (familyThreshold(question)) return { dimension: "threshold", type: "milestone_thresholds" };
  if (/\b(trailer|teaser|avance|clip|gameplay video)\b/.test(source)) return { dimension: "official_content", type: "event_content_options" };
  if (/\b(announce|announc\w*|anunci\w*|reveal\w*|present\w*)\b/.test(source)) return { dimension: "announcement_date", type: "deadline_ladder" };
  if (/\b(releas\w*|launch\w*|lanz\w*|saldr\w*|debut|come out)\b/.test(source)) return { dimension: "release_date", type: "deadline_ladder" };
  if (/\b(cover|portada|participant|candidato|athlete|atleta|appear\w*|attend\w*|presence|aparec\w*|asist\w*)\b/.test(source)) return { dimension: "participant", type: "participant_options" };
  if (/\b(platform|plataforma|playstation|xbox|switch|steam)\b/.test(source) && /\b(version|variant|variante)\b/.test(source)) return { dimension: "platform", type: "platform_variants" };
  if (/\b(score|puntuacion|threshold|umbral|views|visualizaciones|copies|copias|ventas|sales)\b/.test(source)) return { dimension: "threshold", type: "milestone_thresholds" };
  if (/\b(win|wins|ganar\w*|winner|ganador|award|premio|goty|which|cual|nominee|nominat\w*|nominad\w*|game of the year|juego del ano)\b/.test(source)) return { dimension: "outcome", type: "categorical_outcomes" };
  return { dimension: "related", type: "generic_related" };
}

function familyCanonicalAlias(value) {
  return normalizeComparableText(value).replace(/\s+/g, " ").trim();
}

function familyCanonicalAliasTokens(value) {
  const tokens = familyCanonicalAlias(value).split(" ").filter(Boolean);
  const suffix = tokens.at(-1);
  const roman = ({ "1": "i", "2": "ii", "3": "iii", "4": "iv", "5": "v", "6": "vi", "7": "vii", "8": "viii", "9": "ix", "10": "x", "11": "xi", "12": "xii" })[suffix];
  return roman ? [...tokens.slice(0, -1), roman] : tokens;
}

function familyEntityIdentity(value) {
  const canonical = familyCanonicalAlias(value);
  const tokens = canonical.split(" ").filter(Boolean);
  const rawSuffix = tokens.at(-1);
  if (tokens.length < 2 || !/^(?:i|ii|iii|iv|v|vi|vii|viii|ix|x|xi|xii|[1-9]|1[0-2])$/.test(rawSuffix)) {
    return familySlug(canonical, 100);
  }
  const suffix = ({ "1": "i", "2": "ii", "3": "iii", "4": "iv", "5": "v", "6": "vi", "7": "vii", "8": "viii", "9": "ix", "10": "x", "11": "xi", "12": "xii" })[rawSuffix] ?? rawSuffix;
  const core = tokens.slice(0, -1);
  const acronym = core.length === 1
    ? (/^[a-z]{2,8}$/.test(core[0]) ? core[0] : "")
    : core.map((token) => token[0]).join("");
  return acronym.length >= 2 ? `${acronym}${suffix}`.slice(0, 100) : familySlug(canonical, 100);
}

function familyAliasesEquivalent(left, right) {
  const leftValue = familyCanonicalAlias(left);
  const rightValue = familyCanonicalAlias(right);
  if (!leftValue || !rightValue) return false;
  if (leftValue === rightValue || leftValue.replace(/\s/g, "") === rightValue.replace(/\s/g, "")) return true;
  if (familyEntityIdentity(leftValue) !== familyEntityIdentity(rightValue)) return false;
  const [shortValue, longValue] = leftValue.length <= rightValue.length
    ? [leftValue, rightValue] : [rightValue, leftValue];
  const shortTokens = familyCanonicalAliasTokens(shortValue);
  const longTokens = familyCanonicalAliasTokens(longValue);
  if (shortTokens.join(" ") === longTokens.join(" ")) return true;
  const sharedSuffix = shortTokens.length > 1 && shortTokens.at(-1) === longTokens.at(-1) ? shortTokens.at(-1) : null;
  const shortCore = sharedSuffix ? shortTokens.slice(0, -1) : shortTokens;
  const longCore = sharedSuffix ? longTokens.slice(0, -1) : longTokens;
  return shortCore.length === 1 && longCore.length > 1
    && longCore.map((token) => token[0]).join("") === shortCore[0];
}

function familyTitleEntity(value) {
  const firstSegment = cleanText(value, 500).split(/\s+(?:-|–|—|\|)\s+/)[0];
  return familyCanonicalAlias(firstSegment)
    .replace(/\b(?:new|next|another|nuevo|nueva|proximo|proxima)?\s*(?:trailer|teaser|avance|clip)(?:\s+(?:release date|fecha de lanzamiento))?\b.*$/, " ")
    .replace(/\b(?:release date|fecha de lanzamiento|cover athlete|atleta de portada|metacritic score|puntuacion de metacritic)\b.*$/, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const SPECULATIVE_EVIDENCE_PATTERN = /\b(?:rumou?r(?:s|ed)?|reportedly|allegedly|leak(?:s|ed)?|speculat(?:e|ion|ive)|predict(?:s|ed|ion|ions)?|forecast(?:s|ed)?|might|may|could|would|possibly|potential(?:ly)?|likely|unlikely|hope(?:s|d)?|wish(?:es|ed)?|vote|voting|poll|fan favou?rite|concept|mockup|guess|opinion|rumor(?:es)?|se rumorea|filtracion|filtrado|prediccion(?:es)?|pronostico|podria|podrian|puede que|quiza|quizas|tal vez|posible|probable|votacion|encuesta|favorito de (?:los )?fans|concepto)\b/;
const FACTUAL_RELEASE_TERMINAL_PATTERN = /\b(?:(?:is|are|was|were|became)\s+(?:already\s+|now\s+)?(?:available|playable|on\s+sale|in\s+stores)|(?:available|playable|out|officially\s+out)\s+now|(?:has|have|had)\s+(?:already\s+|now\s+)?(?:been\s+)?(?:released|launched|shipped|published|debuted|dropped)|(?:has|have|had)\s+(?:already\s+)?(?:hit\s+stores|gone\s+on\s+sale|gone\s+live)|(?:hit\s+stores|went\s+on\s+sale|went\s+live|arrived\s+in\s+stores)|(?:released|launched|shipped|published|debuted|dropped)\s+(?:today|yesterday|already|worldwide|globally)|(?:now\s+playable|playable\s+now|available\s+to\s+(?:buy|purchase|play|download)|(?:players?|customers?|users?|you)\s+can\s+now\s+(?:buy|purchase|play|download)|can\s+now\s+be\s+(?:bought|purchased|played|downloaded))|(?:ya\s+)?(?:esta|estan)\s+(?:ya\s+)?(?:disponible|disponibles|a\s+la\s+venta|en\s+tiendas)|(?:ya\s+)?(?:salio|salieron|ha\s+salido|han\s+salido)\s+a\s+la\s+venta|(?:se\s+puso|se\s+pusieron)\s+a\s+la\s+venta|(?:ya\s+)?se\s+(?:puede|pueden)\s+(?:ya\s+)?(?:comprar|jugar|descargar)|(?:llego|llegaron|ha\s+llegado|han\s+llegado)\s+a\s+(?:las\s+)?tiendas|(?:ha|han|fue|fueron)\s+(?:sido\s+)?(?:lanzado|lanzados|publicado|publicados|distribuido|distribuidos)|(?:fue\s+lanzado|se\s+lanzo|ya\s+disponible))\b/;
const FACTUAL_RELEASE_MATERIAL_PATTERN = /\b(?:release|released|launch|launched|availability|available|playable|played|shipping|shipped|rollout|debut|sale|stores?|live|lanzamiento|lanzado|disponibilidad|disponible|jugable|estreno|estrenado|venta|tiendas?|salida|publicado|distribuido)\b/;
const FACTUAL_TERMINAL_STATE_PATTERN = /\b(?:today|yesterday|now|currently|already|complete|completed|finished|concluded|took\s+place|has\s+occurred|is\s+live|went\s+live|hoy|ayer|ahora|actualmente|ya|completo|completado|finalizado|concluido|tuvo\s+lugar|se\s+produjo|se\s+estreno)\b/;

export function hasSpeculativeEvidenceLanguage(value) {
  return SPECULATIVE_EVIDENCE_PATTERN.test(normalizeComparableText(value));
}

export function isVerifiedOfficialEvidence(item, requireDirect = true) {
  if (!isRecord(item)
      || cleanText(item.source_type, 80) !== "official"
      || !safePublicUrl(item.url)
      || cleanText(item.retrieval_status, 80) !== "verified_content"
      || cleanText(item.evidence_basis, 80) !== "retrieved_content"
      || cleanText(item.parser_version, 100) !== "atinara-official-content-v1"
      || item.claim_verifiable !== true
      || !/^[0-9a-f]{64}$/.test(cleanText(item.content_sha256, 80))
      || !safeIsoDate(item.retrieved_at)
      || !cleanText(item.supports, 500)) return false;
  if (!requireDirect) return true;
  return item.direct_claim === true
    && cleanText(item.claim_status, 40) === "direct"
    && !hasSpeculativeEvidenceLanguage(`${item.title ?? ""} ${item.supports ?? ""}`);
}

export function isVerifiedProviderFactEvidence(item) {
  return isRecord(item)
    && cleanText(item.source_type, 80) === "provider"
    && Boolean(safePublicUrl(item.url))
    && cleanText(item.retrieval_status, 80) === "verified_provider_api"
    && cleanText(item.evidence_basis, 80) === "provider_api"
    && item.direct_claim === true
    && cleanText(item.claim_status, 40) === "direct"
    && item.claim_verifiable === true
    && Boolean(cleanText(item.supports, 500));
}

export function isVerifiedTerminalEvidence(item) {
  return isVerifiedOfficialEvidence(item, true) || isVerifiedProviderFactEvidence(item);
}

export function evidenceSupportsReasonCode(item, reasonCode) {
  if (!isVerifiedTerminalEvidence(item)) return false;
  return Array.isArray(item.supported_reason_codes)
    && item.supported_reason_codes.some((code) => cleanText(code, 100) === cleanText(reasonCode, 100));
}

/**
 * @param {Record<string, unknown>} item
 * @param {Record<string, unknown> | string} candidateOrKind
 * @param {string} now
 * @returns {boolean}
 */
export function evidenceHasPotentialTerminalClaim(item, candidateOrKind = "other", now = new Date().toISOString()) {
  if (!isVerifiedOfficialEvidence(item, true)) return false;
  const contractKind = typeof candidateOrKind === "string"
    ? candidateOrKind
    : predictionContractKind(candidateOrKind);
  const rawText = cleanText(`${item.title ?? ""}. ${item.supports ?? ""}`, 4_000)
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const text = normalizeComparableText(rawText);
  const sentences = rawText.split(/(?<=[.!?])\s+/).map(normalizeComparableText).filter(Boolean);
  if (contractKind === "announcement") {
    if (/\b(?:has|have|was|were|is now)\s+(?:officially\s+)?(?:announced|revealed|unveiled|presented)\b|\b(?:announced|revealed|unveiled|presented)\s+(?:today|yesterday)\b|\b(?:ha sido|fue|ya fue)\s+(?:anunciado|revelado|presentado)\b/.test(text)) return true;
    const scheduledWording = /\b(?:will\s+(?:be\s+)?(?:officially\s+)?(?:announced|revealed|unveiled|presented)|(?:announcement|reveal)\s+(?:is\s+)?(?:scheduled|set|planned|due)|se\s+(?:anunciara|revelara|presentara))\b/.test(text);
    return scheduledWording && !(typeof candidateOrKind === "object"
      && isDeterministicUnresolvedEvidence(item, candidateOrKind, now));
  }
  if (contractKind === "release") {
    const requiredPlatforms = typeof candidateOrKind === "object"
      ? factualCandidatePlatformScope(candidateOrKind)
      : [];
    if (sentences.some((sentence) =>
      factualTerminalClaim("release", sentence)
      && factualTerminalMatchesPlatformScope(sentence, requiredPlatforms)
    )) return true;
    const datedOrAmbiguousWording = /\b(?:launches|releases|arrives|becomes available|goes on sale|available worldwide from|launching|releasing|lanzara|estara disponible|saldra a la venta|llegara)\b/.test(text);
    return datedOrAmbiguousWording && !(typeof candidateOrKind === "object"
      && isDeterministicUnresolvedEvidence(item, candidateOrKind, now));
  }
  if (contractKind === "milestone") {
    const scopedCandidates = typeof candidateOrKind === "object" ? [candidateOrKind] : [];
    if (factualTerminalClaim("milestone", text, scopedCandidates)) return true;
    const scheduledWording = factualContractPredicate("milestone", text, scopedCandidates);
    return scheduledWording && !(typeof candidateOrKind === "object"
      && isDeterministicUnresolvedEvidence(item, candidateOrKind, now));
  }
  if (contractKind === "award") {
    return /\b(?:wins?|winner|awarded|award goes to|named .{0,60} winner|gana|ganador|premiado|el premio es para)\b/.test(text);
  }
  if (contractKind === "review") {
    return /\b(?:metacritic|opencritic|review score|critic score|puntuacion|nota)\b.{0,80}\b(?:[0-9]{1,3}(?:\.[0-9]+)?|published|publicada)\b/.test(text);
  }
  return /\b(?:occurred|completed|concluded|finished|participated|signed|executed|published|released|launched|available|arrived|opened|closed|won|winner|selected|announced|revealed|held|took place|sucedio|ocurrio|completo|finalizo|participo|firmo|publicado|lanzado|disponible|gano|ganador|seleccionado|anunciado|revelado|se celebro|tuvo lugar)\b/.test(text)
    || /\b(?:complete|full|entire|all)\b.{0,90}\b(?:cover|portada|lineup|selection|seleccion)\b/.test(text);
}

export function isDeterministicUnresolvedEvidence(item, candidate, now = new Date().toISOString()) {
  if (!isVerifiedOfficialEvidence(item, true)
      || item.unresolved_proof !== true
      || cleanText(item.unresolved_proof_basis, 100) !== "official_future_date_v1"
      || !cleanText(item.unresolved_proof_excerpt, 700)
      || !/^[0-9a-f]{64}$/.test(cleanText(item.unresolved_proof_excerpt_sha256, 80))
      || !normalizeComparableText(item.supports).includes(normalizeComparableText(item.unresolved_proof_excerpt))
      || !Array.isArray(item.supported_fact_statuses)
      || !item.supported_fact_statuses.includes("unresolved")
      || !Array.isArray(item.supported_contract_kinds)
      || !item.supported_contract_kinds.includes(predictionContractKind(candidate))) return false;
  const unresolvedUntil = Date.parse(cleanText(item.unresolved_until, 100));
  const checkedAt = Date.parse(now);
  return Number.isFinite(unresolvedUntil) && Number.isFinite(checkedAt) && unresolvedUntil > checkedAt;
}

const FACT_SOURCE_MONTHS = Object.freeze({
  january: 1, jan: 1, enero: 1,
  february: 2, feb: 2, febrero: 2,
  march: 3, mar: 3, marzo: 3,
  april: 4, apr: 4, abril: 4,
  may: 5, mayo: 5,
  june: 6, jun: 6, junio: 6,
  july: 7, jul: 7, julio: 7,
  august: 8, aug: 8, agosto: 8,
  september: 9, sept: 9, sep: 9, septiembre: 9, setiembre: 9,
  october: 10, oct: 10, octubre: 10,
  november: 11, nov: 11, noviembre: 11,
  december: 12, dec: 12, diciembre: 12,
});
const FACT_IDENTITY_STOPWORDS = new Set([
  "about", "above", "after", "announce", "announced", "anuncio", "antes", "athlete", "before",
  "below", "between", "candidate", "como", "complete", "con", "cover", "deadline", "del", "desde",
  "does", "during", "edition", "edicion", "event", "evento", "fecha", "for", "game", "games", "ganador",
  "happen", "happened", "happens", "hasta", "juego", "juegos", "launch", "lanzamiento", "las", "lineup",
  "los", "market", "milestone", "month", "months", "oficial", "official", "para", "player", "players",
  "portada", "release", "result", "resultado", "score", "scored", "scoring", "season", "selection", "sera",
  "sobre", "the", "threshold", "una", "will", "winner", "with", "year", "yes",
  "january", "february", "march", "april", "may", "june", "july", "august", "september", "october",
  "november", "december", "enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto",
  "septiembre", "setiembre", "octubre", "noviembre", "diciembre",
]);

function factualIdentityTokens(value) {
  return [...new Set(cleanText(value, 3_000).normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().match(/[a-z0-9]{2,}/g) ?? [])]
    .filter((token) => !FACT_IDENTITY_STOPWORDS.has(token))
    .filter((token) => !/^20[0-9]{2}$/.test(token) && !/^[0-9]+$/.test(token))
    .filter((token) => !/^(?:announc|anunci|reveal|present|releas|launch|lanz|debut|arriv|public|occur|happen)/.test(token))
    .slice(0, 8);
}

function factualIdentityTokenSets(group) {
  const sets = [];
  const seen = new Set();
  const push = (value) => {
    const tokens = factualIdentityTokens(value);
    if (!tokens.length) return;
    const key = [...tokens].sort((left, right) => left.localeCompare(right)).join(":");
    if (seen.has(key)) return;
    seen.add(key);
    sets.push(tokens);
  };
  for (const candidate of (Array.isArray(group?.candidates) ? group.candidates : []).filter(isRecord)) {
    push(deriveMarketFamily(candidate)?.family_semantics?.entity_label);
    push(candidate.subject ?? candidate.atinara_subject);
    push(candidate.source_title);
    push(candidate.atinara_question ?? candidate.source_question);
  }
  push(group?.title);
  return sets.slice(0, 24);
}

function factualPlatformScopeFromText(valueInput) {
  const value = normalizeComparableText(valueInput);
  const platforms = [];
  const add = (platform) => { if (!platforms.includes(platform)) platforms.push(platform); };
  if (/\bsteam\b/.test(value)) add("steam");
  else if (/\bepic\s+games?\s+store\b/.test(value)) add("epic");
  else if (/\b(?:pc|windows(?:\s+pc)?)\b/.test(value)) add("pc");
  if (/\b(?:playstation\s*5|ps5)\b/.test(value)) add("ps5");
  else if (/\b(?:playstation\s*4|ps4)\b/.test(value)) add("ps4");
  else if (/\bplaystation\b/.test(value)) add("playstation");
  if (/\bxbox\s+series\s+[xs](?:\s*\/\s*[xs])?\b/.test(value)) add("xbox-series");
  else if (/\bxbox\b/.test(value)) add("xbox");
  if (/\b(?:nintendo\s+)?switch\s*2\b/.test(value)) add("switch-2");
  else if (/\b(?:nintendo\s+)?switch\b/.test(value)) add("switch");
  if (/\b(?:ios|iphone|ipad)\b/.test(value)) add("ios");
  if (/\bandroid\b/.test(value)) add("android");
  if (/\b(?:macos|mac)\b/.test(value)) add("macos");
  if (/\blinux\b/.test(value)) add("linux");
  if (!platforms.length && /\b(?:console|consoles)\b/.test(value)) add("console");
  if (!platforms.length && /\bmobile\b/.test(value)) add("mobile");
  return platforms.sort((left, right) => left.localeCompare(right));
}

function factualCandidatePlatformScope(candidate) {
  return factualPlatformScopeFromText([
    candidate?.source_question,
    candidate?.atinara_question,
    candidate?.source_resolution_rules,
    candidate?.atinara_resolution_criteria,
  ].filter(Boolean).join(" "));
}

function factualGroupPlatformScope(group) {
  const scopes = (Array.isArray(group?.candidates) ? group.candidates : []).filter(isRecord)
    .map(factualCandidatePlatformScope);
  const unique = new Map(scopes.map((platforms) => [platforms.join(":"), platforms]));
  if (unique.size > 1) return { ambiguous: true, platforms: [] };
  return { ambiguous: false, platforms: unique.values().next().value ?? [] };
}

function factualWindowMatchesPlatformScope(window, requiredPlatforms) {
  if (!Array.isArray(requiredPlatforms) || !requiredPlatforms.length) return true;
  const patterns = {
    steam: /\bsteam\b/,
    epic: /\bepic\s+games?\s+store\b/,
    pc: /\b(?:pc|windows(?:\s+pc)?|computer)\b/,
    ps5: /\b(?:playstation\s*5|ps5)\b/,
    ps4: /\b(?:playstation\s*4|ps4)\b/,
    playstation: /\b(?:playstation|ps[45])\b/,
    "xbox-series": /\bxbox\s+series\s+[xs](?:\s*\/\s*[xs])?\b/,
    xbox: /\bxbox\b/,
    "switch-2": /\b(?:nintendo\s+)?switch\s*2\b/,
    switch: /\b(?:nintendo\s+)?switch\b/,
    ios: /\b(?:ios|iphone|ipad)\b/,
    android: /\bandroid\b/,
    macos: /\b(?:macos|mac)\b/,
    linux: /\blinux\b/,
    console: /\b(?:console|consoles|playstation|ps[45]|xbox|switch)\b/,
    mobile: /\b(?:mobile|ios|iphone|ipad|android)\b/,
  };
  return requiredPlatforms.every((platform) => patterns[platform]?.test(window) === true);
}

function factualTerminalMatchesPlatformScope(window, requiredPlatforms) {
  if (!Array.isArray(requiredPlatforms) || !requiredPlatforms.length) return true;
  if (factualWindowMatchesPlatformScope(window, requiredPlatforms)) return true;
  // Un claim terminal sin plataforma es materialmente genérico: no demuestra
  // una edición distinta y por tanto prevalece. Solo se excluye si el propio
  // claim identifica de forma positiva otra plataforma contractual.
  const terminalPlatforms = factualPlatformScopeFromText(window);
  if (!terminalPlatforms.length) return true;
  const ancestors = {
    steam: ["steam", "pc"],
    epic: ["epic", "pc"],
    pc: ["pc"],
    ps5: ["ps5", "playstation", "console"],
    ps4: ["ps4", "playstation", "console"],
    playstation: ["playstation", "console"],
    "xbox-series": ["xbox-series", "xbox", "console"],
    xbox: ["xbox", "console"],
    "switch-2": ["switch-2", "switch", "console"],
    switch: ["switch", "console"],
    console: ["console"],
    ios: ["ios", "mobile"],
    android: ["android", "mobile"],
    mobile: ["mobile"],
    macos: ["macos"],
    linux: ["linux"],
  };
  return requiredPlatforms.some((required) => terminalPlatforms.some((terminal) =>
    (ancestors[required] ?? [required]).includes(terminal)
    || (ancestors[terminal] ?? [terminal]).includes(required)
  ));
}

function factualWindowMatchesIdentity(window, identitySets) {
  const tokens = new Set(window.match(/[a-z0-9]{2,}/g) ?? []);
  return identitySets.some((identity) => {
    const matches = identity.filter((token) => tokens.has(token)).length;
    if (identity.length === 1) return identity[0].length >= 5 && matches === 1;
    if (identity.length <= 4) return matches === identity.length;
    return matches >= Math.max(3, Math.ceil(identity.length * 0.6));
  });
}

function factualOfficialContentKind(candidates) {
  const kinds = new Set((Array.isArray(candidates) ? candidates : [])
    .filter(isRecord)
    .map((candidate) => cleanText(deriveMarketFamily(candidate)?.family_semantics?.content_kind, 40))
    .filter(Boolean));
  return kinds.size === 1 ? [...kinds][0] : null;
}

function factualOfficialContentLabel(window, candidates) {
  const normalized = normalizeComparableText(window);
  const audiovisualDistribution = /\b(?:video|watch|youtube|netflix|stream|premiere|debut|channel|canal)\b/.test(normalized);
  const kind = factualOfficialContentKind(candidates);
  if (kind === "teaser") {
    return /\bteaser\b/.test(normalized)
      || (audiovisualDistribution && /\b(?:first look|primer vistazo)\b/.test(normalized));
  }
  if (kind === "clip") return /\b(?:clip|gameplay video|gameplay footage|video de gameplay)\b/.test(normalized);
  if (kind === "trailer") {
    return /\btrailer\b/.test(normalized)
      || (audiovisualDistribution
        && /\b(?:gameplay video|gameplay reveal|gameplay showcase|gameplay overview|gameplay deep dive|extended look|extended preview|in depth look|deep dive|vistazo extendido|avance extendido)\b/.test(normalized));
  }
  return /\b(?:trailer|teaser|avance)\b/.test(normalized);
}

function factualContractPredicate(kind, window, candidates = []) {
  if (kind === "announcement") {
    return /\b(?:will\s+(?:be\s+)?(?:officially\s+)?(?:announced|revealed|unveiled|presented)|(?:announcement|reveal)\s+(?:is\s+)?(?:scheduled|set|planned|due)|se\s+(?:anunciara|revelara|presentara))\b/.test(window);
  }
  if (kind === "release") {
    return /\b(?:will\s+(?:be\s+)?(?:released|launched|available)|will\s+(?:release|launch)|(?:releases|launches|arrives|becomes available|goes on sale)\b|(?:release|launch)\s+(?:is\s+)?(?:scheduled|set|planned|due)|se\s+lanzara|estara\s+disponible|saldra\s+a\s+la\s+venta|llegara)\b/.test(window);
  }
  if (kind === "milestone") {
    return factualOfficialContentLabel(window, candidates)
      && /\b(?:will\s+(?:(?:be\s+)?(?:released|premiered|debuted|published|shown|streamed)|release|premiere|debut|publish|show|stream|launch)|releases|premieres|debuts|launches|se\s+publicara|se\s+estrenara|se\s+presentara)\b/.test(window);
  }
  return false;
}

function factualTerminalClaim(kind, window, candidates = []) {
  if (kind === "announcement") {
    return /\b(?:has|have|was|were|is now)\s+(?:officially\s+)?(?:announced|revealed|unveiled|presented)\b|\b(?:announced|revealed|unveiled|presented)\s+(?:today|yesterday)\b|\b(?:ha sido|fue|ya fue)\s+(?:anunciado|revelado|presentado)\b/.test(window);
  }
  if (kind === "release") {
    if (FACTUAL_RELEASE_TERMINAL_PATTERN.test(window)) return true;
    if (/\bshipped\b/.test(window)
        && !/\b(?:will|scheduled|expected|due|set|planned)\b.{0,40}\bshipped\b/.test(window)) return true;
    return FACTUAL_RELEASE_MATERIAL_PATTERN.test(window)
      && FACTUAL_TERMINAL_STATE_PATTERN.test(window);
  }
  if (kind === "milestone") {
    return factualOfficialContentLabel(window, candidates)
      && /\b(?:is\s+out|is\s+available|has\s+(?:been\s+)?released|was\s+released|premiered|debuted|published|watch\s+now|available\s+now|out\s+now|ya\s+disponible|fue\s+publicado|se\s+estreno)\b/.test(window);
  }
  return false;
}

function factualObservationDays(candidate) {
  const contract = cleanText([
    candidate.source_question,
    candidate.atinara_question,
    candidate.source_resolution_rules,
    candidate.atinara_resolution_criteria,
  ].filter(Boolean).join(" "), 4_000).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const words = {
    one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
    un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10,
  };
  const match = contract.match(/\b([0-9]{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|un|uno|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)\s+(?:calendar\s+)?d(?:ay|ia)s?\s+(?:after|despues\s+de)\s+(?:the\s+|su\s+|el\s+)?(?:release|launch|lanzamiento)\b/);
  if (!match) return null;
  const days = /^[0-9]+$/.test(match[1]) ? Number(match[1]) : words[match[1]];
  return Number.isSafeInteger(days) && days >= 1 && days <= 30 ? days : null;
}

function factualSourceDate(year, month, day) {
  const date = new Date(Date.UTC(year, month - 1, day, 12));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? date : null;
}

export function deriveDeterministicUnresolvedProof(content, group, retrievedAt) {
  const allCandidates = (Array.isArray(group?.candidates) ? group.candidates : []).filter(isRecord);
  const contractKinds = [...new Set(allCandidates
    .map((candidate) => predictionContractKind(candidate))
    .filter((kind) => ["announcement", "release", "milestone", "review"].includes(kind)))];
  if (!contractKinds.length) return null;
  const directKinds = contractKinds.filter((kind) => kind !== "review");
  const identitySets = factualIdentityTokenSets(group);
  if (!identitySets.length) return null;
  const groupPlatformScope = factualGroupPlatformScope(group);
  if (directKinds.length && groupPlatformScope.ambiguous) return null;
  const checkedAt = Date.parse(retrievedAt);
  if (!Number.isFinite(checkedAt)) return null;
  const normalized = cleanText(content, 300_000).normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const dates = [];
  const add = (yearValue, monthValue, dayValue, index) => {
    const year = Number(yearValue);
    const month = typeof monthValue === "number" ? monthValue : FACT_SOURCE_MONTHS[String(monthValue).toLowerCase()];
    const day = Number(dayValue);
    const date = factualSourceDate(year, month, day);
    if (date && date.getTime() >= checkedAt - (10 * 365 * 86_400_000)
        && date.getTime() <= checkedAt + (10 * 365 * 86_400_000)) dates.push({ date, index });
  };
  for (const match of normalized.matchAll(/\b(20[0-9]{2})-(0?[1-9]|1[0-2])-(0?[1-9]|[12][0-9]|3[01])\b/g)) {
    add(match[1], Number(match[2]), match[3], match.index ?? 0);
  }
  const monthNames = Object.keys(FACT_SOURCE_MONTHS).join("|");
  for (const match of normalized.matchAll(new RegExp(`\\b(${monthNames})\\s+([0-3]?[0-9])(?:st|nd|rd|th)?(?:,|\\s)+\\s*(20[0-9]{2})\\b`, "g"))) {
    add(match[3], match[1], match[2], match.index ?? 0);
  }
  for (const match of normalized.matchAll(new RegExp(`\\b([0-3]?[0-9])(?:st|nd|rd|th)?\\s+(?:de\\s+)?(${monthNames})(?:\\s+de|,)?\\s+(20[0-9]{2})\\b`, "g"))) {
    add(match[3], match[2], match[1], match.index ?? 0);
  }
  const inferYearlessDate = (monthValue, dayValue, index) => {
    const reference = new Date(checkedAt);
    let year = reference.getUTCFullYear();
    const currentYearDate = factualSourceDate(
      year,
      FACT_SOURCE_MONTHS[String(monthValue).toLowerCase()],
      Number(dayValue),
    );
    if (currentYearDate && currentYearDate.getTime() < checkedAt - (180 * 86_400_000)) year += 1;
    add(year, monthValue, dayValue, index);
  };
  for (const match of normalized.matchAll(new RegExp(
    `\\b(${monthNames})\\s+([0-3]?[0-9])(?:st|nd|rd|th)?\\b(?!(?:,|\\s)+\\s*20[0-9]{2}\\b)`,
    "g",
  ))) {
    inferYearlessDate(match[1], match[2], match.index ?? 0);
  }
  for (const match of normalized.matchAll(new RegExp(
    `\\b([0-3]?[0-9])(?:st|nd|rd|th)?\\s+(?:de\\s+)?(${monthNames})\\b(?!(?:\\s+de|,|\\s)+\\s*20[0-9]{2}\\b)`,
    "g",
  ))) {
    inferYearlessDate(match[2], match[1], match.index ?? 0);
  }
  const claimWindow = (index) => {
    const prior = Math.max(normalized.lastIndexOf(".", index), normalized.lastIndexOf("!", index), normalized.lastIndexOf("?", index));
    const following = [normalized.indexOf(".", index), normalized.indexOf("!", index), normalized.indexOf("?", index)]
      .filter((value) => value >= 0).sort((left, right) => left - right)[0] ?? normalized.length;
    return cleanText(normalized.slice(Math.max(prior + 1, index - 320), Math.min(following + 1, index + 380)), 400);
  };
  const boundClaims = dates.map((dated) => {
    const window = claimWindow(dated.index);
    const kinds = directKinds.filter((kind) => factualContractPredicate(kind, window, allCandidates));
    return {
      ...dated,
      window,
      kinds,
      identity: factualWindowMatchesIdentity(window, identitySets),
      platform: factualWindowMatchesPlatformScope(window, groupPlatformScope.platforms),
    };
  }).filter((dated) => dated.identity && dated.platform && dated.kinds.length && !hasSpeculativeEvidenceLanguage(dated.window));
  const terminalSentences = normalized.split(/(?<=[.!?])\s+/).filter(Boolean);
  const milestoneTerminalConflict = directKinds.includes("milestone") && terminalSentences.some((sentence, index) => {
    const window = cleanText(terminalSentences.slice(Math.max(0, index - 1), index + 2).join(" "), 1_200);
    return factualWindowMatchesIdentity(window, identitySets)
      && factualTerminalMatchesPlatformScope(window, groupPlatformScope.platforms)
      && factualTerminalClaim("milestone", window, allCandidates);
  });
  const terminalConflict = boundClaims.some((dated) =>
    dated.date.getTime() <= checkedAt + 60_000
    || dated.kinds.some((kind) => factualTerminalClaim(kind, dated.window, allCandidates))
  ) || milestoneTerminalConflict || terminalSentences.some((sentence) =>
    factualTerminalMatchesPlatformScope(sentence, groupPlatformScope.platforms)
    && directKinds.some((kind) => factualTerminalClaim(kind, sentence, allCandidates))
  );
  if (terminalConflict && directKinds.length) return null;
  const supported = boundClaims.filter((dated) => dated.date.getTime() > checkedAt + 60_000)
    .sort((left, right) => left.date.getTime() - right.date.getTime());
  if (supported.length) {
    return { until: supported[0].date.toISOString(), contractKinds: supported[0].kinds, excerpt: supported[0].window };
  }

  const reviewProofs = [];
  for (const candidate of allCandidates.filter((item) => predictionContractKind(item) === "review")) {
    const candidatePlatformScope = factualCandidatePlatformScope(candidate);
    const observationAt = safeIsoDate(candidate.evaluation_ends_at ?? candidate.source_close_at);
    const resolutionDeadline = safeIsoDate(candidate.source_resolution_deadline ?? candidate.resolution_deadline ?? observationAt);
    const observationMs = Date.parse(observationAt ?? "");
    const deadlineMs = Date.parse(resolutionDeadline ?? "");
    const offsetDays = factualObservationDays(candidate);
    if (!observationAt || !Number.isFinite(observationMs) || observationMs <= checkedAt + 60_000
        || !Number.isFinite(deadlineMs) || deadlineMs < observationMs - 60_000 || !offsetDays) continue;
    const anchors = dates.map((dated) => ({ ...dated, window: claimWindow(dated.index) }))
      .filter((dated) => factualWindowMatchesIdentity(dated.window, identitySets)
        && factualWindowMatchesPlatformScope(dated.window, candidatePlatformScope)
        && (factualContractPredicate("release", dated.window) || factualTerminalClaim("release", dated.window))
        && !hasSpeculativeEvidenceLanguage(dated.window)
        && dated.date.getTime() <= observationMs);
    const anchor = anchors.find((dated) =>
      Math.abs((dated.date.getTime() + (offsetDays * 86_400_000)) - observationMs) <= 18 * 60 * 60 * 1_000
    );
    if (anchor) reviewProofs.push({ until: observationAt, excerpt: anchor.window });
  }
  if (!reviewProofs.length) return null;
  reviewProofs.sort((left, right) => Date.parse(left.until) - Date.parse(right.until));
  return { until: reviewProofs[0].until, contractKinds: ["review"], excerpt: reviewProofs[0].excerpt };
}

function familyQuestionEntity(normalizedQuestion, dimension) {
  let value = normalizedQuestion
    .replace(/^(?:will|whether|can|could|is|are|sera|seran|se)\s+/, "")
    .replace(/^(?:another|proximo|proxima|next|otro|otra|una|la|el|un|an|a)\s+/, "");
  value = value
    .replace(/^(?:announce\w*|anunci\w*|reveal\w*|present\w*|release\w*|launch\w*|lanz\w*|public\w*|reach\w*|alcanz\w*|exceed\w*|super\w*)\s+(?:officially|oficialmente)?\s*(?:(?:another|the|los|las|una|la|el|un|an|a)\b\s*)?/, "")
    .replace(/^(?:officially|oficialmente)\s+/, "");
  if (dimension === "official_content") {
    const contentOf = value.match(/(?:new|nuevo|nueva|another)?\s*(?:trailer|teaser|avance|clip)(?:\s+official|\s+oficial)?\s+(?:of|de)\s+(.+?)(?:\s+(?:before|antes de|antes del|by)\b|$)/);
    if (contentOf?.[1]) value = contentOf[1];
    else value = value
      .replace(/\b(?:new|nuevo|nueva|another|next|official|oficial|proximo|proxima)\b/g, " ")
      .replace(/\b(?:trailer|teaser|avance|clip)\b/g, " ")
      .replace(/^\s*(?:of|de)\s+/, "");
  }
  value = value.split(/\s+(?:will|be|is|sera|seran|se|before|antes|by|hasta|para|release\w*|launch\w*|lanz\w*|announce\w*|anunci\w*|public\w*|come out|nominat\w*|nominad\w*|win\w*|gan\w*|reach\w*|alcanz\w*|score\w*|puntuar\w*|exceed\w*|super\w*|appear\w*|aparec\w*|attend\w*|asist\w*)\b/)[0];
  if (dimension === "threshold") {
    value = value.replace(/\s+(?:the|los|las|un|una)?\s*(?:at least|at most|more than|less than|above|below|over|under|al menos|como maximo|mas de|menos de)?\s*\d+(?:[.,]\d+)*(?:\s*(?:%|percent\w*|porcentaje|point\w*|punto\w*|view\w*|visualizacion\w*|cop\w*|venta\w*|subscriber\w*|suscriptor\w*))?.*$/, " ");
  }
  value = value
    .replace(/\b(?:release date|fecha de lanzamiento|official content|contenido oficial|metacritic score|puntuacion de metacritic)\b/g, " ")
    .replace(/\b(?:next|another|nuevo|nueva|proximo|proxima)\b/g, " ")
    .replace(/^\s*(?:trailer|teaser|avance|clip)\s+(?:of|de)\s+/, "")
    .replace(/\b(?:trailer|teaser|avance|clip)\s*$/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return familyCanonicalAlias(value);
}

function familyEntity(candidate, normalizedQuestion, dimension) {
  const questionEntity = familyQuestionEntity(normalizedQuestion, dimension);
  const structuredSubject = familyCanonicalAlias(candidate.subject ?? candidate.atinara_subject);
  const titleEntity = familyTitleEntity(candidate.source_title ?? candidate.title);
  const sourceTitle = normalizeComparableText(candidate.source_title ?? candidate.title);
  const stableTitle = /^(?:will|whether|can|could|is|are|sera|seran|se)\b/.test(sourceTitle) ? "" : titleEntity;
  let value = structuredSubject
    || (["threshold", "outcome"].includes(dimension) ? stableTitle : "")
    || questionEntity
    || titleEntity;
  for (const alias of [questionEntity, titleEntity, structuredSubject]) {
    if (alias && familyAliasesEquivalent(value, alias) && alias.length > value.length) value = alias;
  }
  return familyCanonicalAlias(value).slice(0, 120);
}

function familySemantics(type, modifiers = {}) {
  if (type === "deadline_ladder" || type === "milestone_thresholds") {
    return { cumulative: true, mutually_exclusive: false, parent_is_market: false, aggregate_probability: false, economic_independence: true, ...modifiers };
  }
  return { cumulative: false, mutually_exclusive: type === "categorical_outcomes", parent_is_market: false, aggregate_probability: false, economic_independence: true, ...modifiers };
}

function officialContentContract(candidate, question) {
  const durationThreshold = familyThreshold(`${question} ${candidate?.source_resolution_rules ?? ""}`);
  const duration = durationThreshold?.unit === "seconds" ? Number(durationThreshold.value) : null;
  const durationContract = Number.isSafeInteger(duration) && duration > 0 && duration <= 3_600
    ? durationThreshold : null;
  const kind = /\bteaser\b/.test(question) ? "teaser" : /\b(?:clip|avance)\b/.test(question) ? "clip" : "trailer";
  return { kind, duration: durationContract };
}

function familyProviderPayload(candidate) {
  if (isRecord(candidate?.provider_payload)) return candidate.provider_payload;
  if (isRecord(candidate?.normalized_payload?.provider_payload)) return candidate.normalized_payload.provider_payload;
  return {};
}

function familyStructuredChild(candidate, dimension) {
  const payload = familyProviderPayload(candidate);
  const identityKind = cleanText(candidate?.identity_kind ?? payload.identity_kind, 40);
  const effectiveDimension = identityKind === "option" && !["outcome", "participant", "platform"].includes(dimension)
    ? "outcome" : dimension;
  const optionDimension = identityKind === "option"
    || ["outcome", "participant", "platform"].includes(effectiveDimension);
  const identityStatus = cleanText(candidate?.identity_status ?? payload.identity_status, 80);
  const identityClassification = cleanText(
    candidate?.identity_classification ?? payload.identity_classification,
    100,
  );
  const rawYesLabel = cleanText(payload.yes_sub_title, 500);
  let threshold = identityKind !== "option" && effectiveDimension === "threshold" && rawYesLabel
    ? familyThreshold(rawYesLabel)
    : null;
  if (threshold?.unit === "count") {
    threshold = {
      ...threshold,
      unit: familyMetricUnit(`${candidate?.source_title ?? ""} ${candidate?.source_question ?? ""} ${candidate?.atinara_question ?? ""} ${candidate?.source_resolution_rules ?? ""}`),
    };
  }
  if (threshold) {
    const thresholdChild = threshold.ambiguous
      ? `threshold:ambiguous:${familySlug(threshold.raw_value, 80)}:${threshold.unit}`
      : `threshold:${threshold.operator}:${threshold.value}:${threshold.unit}`;
    return {
      dimension: "threshold",
      type: "milestone_thresholds",
      child_key: thresholdChild,
      child_label: rawYesLabel || `Umbral ${threshold.operator} ${threshold.value} ${threshold.unit}`,
      threshold,
    };
  }
  if (optionDimension && (["unresolved_placeholder", "conflict", "removed", "duplicate"].includes(identityStatus)
      || identityClassification === "provider_placeholder_pending_resolution")) {
    return {
       dimension: effectiveDimension,
       type: effectiveDimension === "outcome" ? "categorical_outcomes"
         : effectiveDimension === "participant" ? "participant_options" : "platform_variants",
      child_key: null,
      child_label: null,
      option_source_field: null,
      option_confidence: 0,
      option_placeholder: identityStatus === "unresolved_placeholder",
    };
  }
  if (!optionDimension) return null;
  const option = extractRadarOptionChild(candidate, effectiveDimension);
  if (option) {
    return {
      dimension: effectiveDimension,
      type: effectiveDimension === "outcome" ? "categorical_outcomes"
        : effectiveDimension === "participant" ? "participant_options" : "platform_variants",
      child_key: `option:${option.slug}`,
      child_label: option.label,
      option_source_field: option.source_field,
      option_confidence: option.confidence,
      option_placeholder: option.placeholder,
    };
  }
  return null;
}

export function deriveMarketFamily(candidate) {
  const rawQuestion = candidate?.atinara_question ?? candidate?.question ?? candidate?.source_question ?? candidate?.title;
  const normalizedQuestion = normalizeComparableText(rawQuestion);
  if (!normalizedQuestion) return null;
  const detected = familyDimension(rawQuestion);
  const structuredChild = familyStructuredChild(candidate ?? {}, detected.dimension);
  const dimension = structuredChild?.dimension ?? detected.dimension;
  const boundary = familyTemporalBoundary(candidate ?? {}, candidate?.atinara_question ?? candidate?.question ?? candidate?.source_question ?? candidate?.title);
  const contentContract = dimension === "official_content" ? officialContentContract(candidate ?? {}, normalizedQuestion) : null;
  const type = structuredChild?.type ?? (dimension === "official_content" && boundary ? "deadline_ladder" : detected.type);
  const entity = familyEntity(candidate ?? {}, normalizedQuestion, dimension);
  if (!entity) return null;
  const threshold = dimension === "threshold" ? structuredChild?.threshold ?? familyThreshold(rawQuestion) : null;
  const contentInvariant = contentContract
    ? `:${contentContract.kind}${contentContract.duration ? `:duration-${contentContract.duration.operator}-${contentContract.duration.value}-${contentContract.duration.unit}` : ""}`
    : "";
  const familyKey = `atinara:v5:${familyEntityIdentity(entity)}:${dimension}${contentInvariant}`;
  const temporalChild = boundary
    ? (boundary.identity_ambiguous
      ? `deadline:ambiguous-timezone:${familySlug(boundary.timezone, 80)}:${familySlug(boundary.ambiguity_reason, 40)}:${boundary.canonical_operator}:${familySlug(boundary.canonical_local_instant ?? boundary.local_instant, 80)}:${boundary.granularity}`
      : `deadline:${boundary.canonical_operator}:${boundary.canonical_instant}:${boundary.granularity}`)
    : null;
  let childKey = structuredChild && Object.hasOwn(structuredChild, "child_key")
    ? structuredChild.child_key
    : (threshold ? threshold.ambiguous
      ? `threshold:ambiguous:${familySlug(threshold.raw_value, 80)}:${threshold.unit}`
      : `threshold:${threshold.operator}:${threshold.value}:${threshold.unit}`
      : temporalChild ?? `option:${familySlug(normalizedQuestion, 120)}`);
  if (dimension === "official_content") {
    const contentKind = contentContract?.kind ?? "trailer";
    childKey = `content:${contentKind}:${temporalChild ?? `option:${familySlug(normalizedQuestion, 120)}`}`;
  }
  const childLabel = structuredChild && Object.hasOwn(structuredChild, "child_label")
    ? structuredChild.child_label
    : (threshold
    ? (threshold.ambiguous
      ? `Umbral ambiguo ${threshold.raw_value} ${threshold.unit}`
      : `Umbral ${threshold.operator} ${threshold.value} ${threshold.unit}`)
    : boundary
    ? `${boundary.operator} ${boundary.instant ?? boundary.local_instant} (${boundary.timezone_label ?? boundary.timezone}, ${boundary.granularity})`
    : cleanText(candidate?.atinara_question ?? candidate?.question ?? candidate?.source_question, 180));
  const titlePrefix = dimension === "official_content" ? "Contenido oficial"
    : type === "deadline_ladder"
    ? (dimension === "announcement_date" ? "Anuncio oficial" : "Fecha de lanzamiento")
      : dimension === "threshold" ? "Hitos"
        : "Opciones";
  return {
    family_key: familyKey,
    family_title: `${titlePrefix} · ${entity.replace(/\b(vi|vii|viii|ix|xi|xii)\b/gi, (part) => part.toUpperCase())}`,
    family_type: type,
    family_child_key: childKey,
    family_child_label: childLabel,
    family_sort_at: boundary?.canonical_instant ?? safeIsoDate(candidate?.source_close_at),
    family_relationship: "standalone",
    family_semantics: familySemantics(type, contentContract ? {
      entity_label: entity,
      content_kind: contentContract.kind,
      duration_contract: contentContract.duration,
      temporal_boundary: boundary,
      ...(boundary?.identity_ambiguous ? { identity_ambiguous: true } : {}),
    } : threshold ? {
      entity_label: entity,
      threshold,
      ...(boundary ? { temporal_boundary: boundary } : {}),
      ...(threshold.ambiguous || boundary?.identity_ambiguous ? { identity_ambiguous: true } : {}),
    }
      : boundary ? {
        entity_label: entity,
        temporal_boundary: boundary,
        ...(boundary.identity_ambiguous ? { identity_ambiguous: true } : {}),
      } : { entity_label: entity }),
    family_source_event_key: cleanText(candidate?.event_group_key ?? candidate?.external_event_id, 240) || null,
    family_version: RADAR_FAMILY_VERSION,
  };
}

function matchFamily(item) {
  if (cleanText(item?.family_version, 100) === RADAR_FAMILY_VERSION
      && cleanText(item?.family_key, 240) && cleanText(item?.family_child_key, 240)) {
    return {
      family_key: cleanText(item.family_key, 240),
      family_child_key: cleanText(item.family_child_key, 240),
      family_title: cleanText(item.family_title, 300),
      entity_label: cleanText(item?.family_semantics?.entity_label, 120),
      identity_ambiguous: item?.family_semantics?.identity_ambiguous === true,
    };
  }
  return deriveMarketFamily(item);
}

function sameCandidateIdentity(candidate, item) {
  const candidateId = cleanText(candidate?.id, 220);
  const itemId = cleanText(item?.id, 220);
  if (candidateId && itemId && candidateId === itemId) return true;
  const preparedDraftId = cleanText(candidate?.prepared_draft_id, 220);
  const itemRadarCandidateId = cleanText(item?.radar_candidate_id, 220);
  if ((preparedDraftId && itemId === preparedDraftId)
      || (candidateId && itemRadarCandidateId === candidateId)) return true;
  const candidateProvider = cleanText(candidate?.provider, 80).toLowerCase();
  const itemProvider = cleanText(item?.provider, 80).toLowerCase();
  const candidateExternalId = cleanText(candidate?.external_id, 300);
  const itemExternalId = cleanText(item?.external_id, 300);
  return Boolean(
    candidateProvider
    && itemProvider === candidateProvider
    && candidateExternalId
    && itemExternalId === candidateExternalId
  );
}

export function isBlockingDuplicateMatch(match) {
  if (!isRecord(match)) return false;
  const relationship = cleanText(match.relationship, 80);
  return match.blocking !== false
    && relationship === "exact_duplicate"
    && cleanText(match.family_version, 100) === RADAR_FAMILY_VERSION;
}

export function classifyMarketRelations(candidate, existing = []) {
  const source = normalizeComparableText(candidate?.atinara_question ?? candidate?.question ?? candidate?.source_question ?? candidate?.title);
  const candidateFamily = deriveMarketFamily(candidate);
  if (!source || !candidateFamily) return { family: candidateFamily, duplicates: [], siblings: [], ambiguous: [] };
  const tokens = new Set(source.split(" ").filter((token) => token.length > 2));
  const duplicates = [];
  const siblings = [];
  const ambiguous = [];
  const candidateIdentityAmbiguous = candidateFamily.family_semantics?.identity_ambiguous === true;
  const expansionLabels = new Set();
  const rememberExpansion = (value) => {
    const tokens = familyCanonicalAliasTokens(value);
    if (tokens.length > 2) expansionLabels.add(tokens.join(" "));
  };
  rememberExpansion(candidateFamily.family_semantics?.entity_label);
  for (const item of existing) {
    if (sameCandidateIdentity(candidate, item)) continue;
    const existingFamily = matchFamily(item);
    if (!existingFamily) continue;
    const target = normalizeComparableText(item.question ?? item.title ?? item.atinara_question ?? item.source_question);
    const targetTokens = new Set(target.split(" ").filter((token) => token.length > 2));
    const intersection = [...tokens].filter((token) => targetTokens.has(token)).length;
    const union = new Set([...tokens, ...targetTokens]).size || 1;
    const similarity = intersection / union;
    const base = {
      id: cleanText(item.id, 220) || null,
      question: cleanText(item.question ?? item.title ?? item.atinara_question ?? item.source_question, 500),
      similarity: Number(similarity.toFixed(3)),
      family_key: candidateFamily.family_key,
      family_child_key: existingFamily?.family_child_key ?? null,
      family_title: candidateFamily.family_title,
      family_version: RADAR_FAMILY_VERSION,
    };
    if (existingFamily?.family_key === candidateFamily.family_key) {
      const candidateEntity = candidateFamily.family_semantics?.entity_label;
      const existingEntity = existingFamily.entity_label
        || deriveMarketFamily(item)?.family_semantics?.entity_label;
      rememberExpansion(existingEntity);
      const targetIdentityAmbiguous = existingFamily.identity_ambiguous === true
        || deriveMarketFamily(item)?.family_semantics?.identity_ambiguous === true;
      if (candidateIdentityAmbiguous || targetIdentityAmbiguous
          || !familyAliasesEquivalent(candidateEntity, existingEntity)) {
        ambiguous.push({ ...base, relationship: "identity_ambiguous", blocking: false });
      } else if (existingFamily.family_child_key === candidateFamily.family_child_key) {
        duplicates.push({ ...base, relationship: "exact_duplicate", blocking: true });
      } else {
        siblings.push({ ...base, relationship: "sibling", blocking: false });
      }
    }
  }
  if (expansionLabels.size > 1) {
    ambiguous.push(...duplicates.splice(0).map((match) => ({ ...match, relationship: "identity_ambiguous", blocking: false })));
    ambiguous.push(...siblings.splice(0).map((match) => ({ ...match, relationship: "identity_ambiguous", blocking: false })));
  }
  const deterministic = (left, right) => `${left.id ?? ""}:${left.family_child_key ?? ""}`.localeCompare(`${right.id ?? ""}:${right.family_child_key ?? ""}`);
  return {
    family: candidateFamily,
    duplicates: duplicates.sort(deterministic).slice(0, 5),
    siblings: siblings.sort(deterministic).slice(0, 12),
    ambiguous: ambiguous.sort(deterministic).slice(0, 12),
  };
}

export function detectDuplicates(candidate, existing = []) {
  return classifyMarketRelations(candidate, existing).duplicates;
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
  const seenDefinitions = [...existing];
  return candidates.map((candidate) => {
    const relations = classifyMarketRelations(candidate, seenDefinitions);
    const duplicateMatches = relations.duplicates;
    const popularity = popularityMetric(candidate);
    const relevance = relevanceScore(candidate);
    const clarity = clarityScore(candidate);
    const recency = recencyScore(candidate, now);
    const uncertainty = uncertaintyScore(candidate);
    const novelty = duplicateMatches.length ? 0 : 20;
    const verification = Math.max(0, Math.min(100, safeNumber(candidate.verification_confidence) ?? 0));
    const total = popularity + relevance + clarity + recency + uncertainty + novelty;
    const priorHardReasons = (candidate.hard_reject_reasons ?? []).filter((reason) => reason !== RADAR_REASON_CODES.DUPLICATE_MARKET);
    const hardReasons = [...new Set([...priorHardReasons, ...(duplicateMatches.length ? [RADAR_REASON_CODES.DUPLICATE_MARKET] : [])])];
    const scored = {
      ...candidate,
      ...(relations.family ?? {}),
      duplicate_matches: duplicateMatches,
      family_matches: relations.siblings,
      family_relationship: relations.siblings.length ? "sibling" : relations.family?.family_relationship,
      hard_reject_reasons: hardReasons,
      quality_score: total,
      score_breakdown: { popularity, relevance, clarity, recency, uncertainty, novelty, verification },
    };
    seenDefinitions.push({
      ...candidate,
      ...(relations.family ?? {}),
      id: candidate.id ?? candidate.external_id,
      question: candidate.atinara_question ?? candidate.source_question,
    });
    return scored;
  }).sort((left, right) => right.quality_score - left.quality_score);
}

export function reasonCopy(code) {
  return REASON_COPY[cleanText(code, 100)] ?? "La candidata no cumple todavía las condiciones para preparar un borrador.";
}

export function predictionContractKind(candidate) {
  const question = normalizeComparableText(candidate?.atinara_question ?? candidate?.source_question ?? candidate?.source_title);
  // Las palabras "release/lanzamiento" pueden ser solo el ancla temporal de
  // una métrica, un premio o un hito. Clasifica primero el predicado que
  // realmente resuelve el contrato para no convertir esos mercados en una
  // predicción de lanzamiento distinta.
  if (/(?:\bmetacritic|\breview|\bresena|\bscore|\bpuntuacion)/.test(question)) return "review";
  if (/(?:\bgame of the year|\bgoty|\baward|\bpremio|\bnomina|\bwin\b|\bganar|\bgana)/.test(question)) return "award";
  if (/(?:\btrailer|\bteaser|\bavance|\bclip\b|\bgameplay video|\bdelay|\bretras)/.test(question)) return "milestone";
  if (/(?:\bannounc|\banunci|\breveal|\bpresent)/.test(question)) return "announcement";
  if (/(?:\breleas|\blaunch|\blanz|\bsaldr|\bdebut)/.test(question)) return "release";
  return "other";
}

function isNamedAwardCandidate(question) {
  return /(?:^(?:will .+ win\b|ganara .+ (?:premio|goty)\b)|(?:\bwin game of the year\b|\bganar el premio\b))/.test(question);
}

function providerEvidence(candidate) {
  const url = safePublicUrl(candidate?.external_market_url)
    ?? safePublicUrl(candidate?.external_event_url);
  if (!url) return [];
  const result = cleanText(candidate?.source_result, 40);
  const hardReasons = new Set(candidate?.hard_reject_reasons ?? []);
  const supportedReasonCodes = [];
  if (normalizeProviderResult(candidate?.source_result)) supportedReasonCodes.push(RADAR_REASON_CODES.EVENT_ALREADY_RESOLVED);
  for (const reason of [
    RADAR_REASON_CODES.PROVIDER_NOT_OPEN,
    RADAR_REASON_CODES.EVENT_OUTSIDE_CONTRACT,
    RADAR_REASON_CODES.INVALID_OR_UNVERIFIED_SOURCE,
  ]) {
    if (hardReasons.has(reason)) supportedReasonCodes.push(reason);
  }
  return [{
    title: result ? "Resultado publicado por el proveedor original" : "Estado canónico del proveedor original",
    url,
    published_at: safeIsoDate(candidate?.source_settled_at),
    source_type: "provider",
    retrieved_at: safeIsoDate(candidate?.fetched_at ?? candidate?.verified_at ?? candidate?.source_settled_at),
    retrieval_status: "verified_provider_api",
    evidence_basis: "provider_api",
    parser_version: cleanText(candidate?.normalizer_version, 100) || RADAR_NORMALIZER_VERSION,
    content_type: "application/json",
    direct_claim: true,
    claim_status: "direct",
    claim_verifiable: true,
    supported_reason_codes: supportedReasonCodes,
    supported_fact_statuses: result
      ? ["fully_resolved"]
      : supportedReasonCodes.includes(RADAR_REASON_CODES.PROVIDER_NOT_OPEN) ? ["unresolved"] : [],
    supported_contract_kinds: [],
    unresolved_proof: false,
    supports: result
      ? `Resultado: ${providerResultLabel(candidate.source_result)}`
      : `Estado oficial del mercado de origen: ${cleanText(candidate?.source_status, 80) || "no abierto"}.`,
  }];
}

export function evaluateProviderEligibility(candidate, now = new Date().toISOString()) {
  const hardReasons = new Set(candidate?.hard_reject_reasons ?? []);
  const identityStatus = cleanText(candidate?.identity_status, 80);
  const identityClassification = cleanText(candidate?.identity_classification, 100);
  if (identityStatus === "unresolved_placeholder"
      || identityClassification === "provider_placeholder_pending_resolution") {
    return {
      eligible: false,
      conclusive: false,
      reason_code: RADAR_REASON_CODES.PROVIDER_CHILD_IDENTITY_RESOLUTION_REQUIRED,
      reason: reasonCopy(RADAR_REASON_CODES.PROVIDER_CHILD_IDENTITY_RESOLUTION_REQUIRED),
      confidence: 100,
      ttl_minutes: 60,
      evidence: [],
    };
  }
  const reconciliationStatus = cleanText(candidate?.parent_reconciliation_status, 80);
  if (reconciliationStatus && reconciliationStatus !== "complete") {
    return {
      eligible: false,
      conclusive: false,
      reason_code: reconciliationStatus === "inconsistent_provider_count"
        ? RADAR_REASON_CODES.PROVIDER_PARENT_COUNT_INCONSISTENT
        : RADAR_REASON_CODES.RADAR_PARENT_RECONCILIATION_INCOMPLETE,
      reason: reasonCopy(reconciliationStatus === "inconsistent_provider_count"
        ? RADAR_REASON_CODES.PROVIDER_PARENT_COUNT_INCONSISTENT
        : RADAR_REASON_CODES.RADAR_PARENT_RECONCILIATION_INCOMPLETE),
      confidence: 100,
      ttl_minutes: 60,
      evidence: [],
    };
  }
  const sourceResult = normalizeProviderResult(candidate?.source_result);
  if (sourceResult || hardReasons.has(RADAR_REASON_CODES.EVENT_ALREADY_RESOLVED)) {
    const resultCopy = sourceResult ? ` como «${providerResultLabel(sourceResult)}»` : "";
    return {
      eligible: false,
      conclusive: true,
      reason_code: RADAR_REASON_CODES.EVENT_ALREADY_RESOLVED,
      reason: `El proveedor original ya ha publicado el resultado${resultCopy}; no es una predicción futura.`,
      confidence: 100,
      ttl_minutes: 1_440,
      evidence: providerEvidence(candidate),
    };
  }
  if (hardReasons.has(RADAR_REASON_CODES.PROVIDER_NOT_OPEN)) {
    return {
      eligible: false,
      conclusive: true,
      reason_code: RADAR_REASON_CODES.PROVIDER_NOT_OPEN,
      reason: "El mercado de origen ya está cerrado y no ofrece una opción futura abierta para importar.",
      confidence: 100,
      ttl_minutes: 360,
      evidence: providerEvidence(candidate),
    };
  }
  if (hardReasons.has(RADAR_REASON_CODES.PROVIDER_OPTION_INACTIVE)) {
    return {
      eligible: false,
      conclusive: true,
      reason_code: RADAR_REASON_CODES.PROVIDER_OPTION_INACTIVE,
      reason: "Esta opción no está negociable en el proveedor, aunque el evento padre conserva otras opciones abiertas.",
      confidence: 100,
      ttl_minutes: 360,
      evidence: providerEvidence(candidate),
    };
  }
  if (hardReasons.has(RADAR_REASON_CODES.INVALID_OR_UNVERIFIED_SOURCE)) {
    return {
      eligible: false,
      conclusive: true,
      reason_code: RADAR_REASON_CODES.INVALID_OR_UNVERIFIED_SOURCE,
      reason: reasonCopy(RADAR_REASON_CODES.INVALID_OR_UNVERIFIED_SOURCE),
      confidence: 100,
      ttl_minutes: 60,
      evidence: [],
    };
  }
  if (hardReasons.has(RADAR_REASON_CODES.EVENT_OUTSIDE_CONTRACT)) {
    return {
      eligible: false,
      conclusive: true,
      reason_code: RADAR_REASON_CODES.EVENT_OUTSIDE_CONTRACT,
      reason: "El contrato de origen no es una opción binaria compatible con Atinara.",
      confidence: 100,
      ttl_minutes: 360,
      evidence: providerEvidence(candidate),
    };
  }
  if (hardReasons.has(RADAR_REASON_CODES.DUPLICATE_MARKET)) {
    return {
      eligible: false,
      conclusive: true,
      reason_code: RADAR_REASON_CODES.DUPLICATE_MARKET,
      reason: reasonCopy(RADAR_REASON_CODES.DUPLICATE_MARKET),
      confidence: 100,
      ttl_minutes: 360,
      evidence: [],
    };
  }
  const domainStatus = candidate?.domain_policy_version === RADAR_DOMAIN_POLICY_VERSION
    ? cleanText(candidate?.domain_status, 40) : "";
  if (domainStatus === "out_of_domain") {
    return {
      eligible: false,
      conclusive: true,
      reason_code: RADAR_REASON_CODES.OUTSIDE_GAMING_DOMAIN,
      reason: reasonCopy(RADAR_REASON_CODES.OUTSIDE_GAMING_DOMAIN),
      confidence: 100,
      ttl_minutes: 1_440,
      evidence: [],
    };
  }
  if (domainStatus === "placeholder") {
    return {
      eligible: false,
      conclusive: false,
      reason_code: RADAR_REASON_CODES.PROVIDER_CHILD_IDENTITY_RESOLUTION_REQUIRED,
      reason: reasonCopy(RADAR_REASON_CODES.PROVIDER_CHILD_IDENTITY_RESOLUTION_REQUIRED),
      confidence: 100,
      ttl_minutes: 60,
      evidence: [],
    };
  }
  if (domainStatus === "review_required") {
    return {
      eligible: false,
      conclusive: false,
      reason_code: RADAR_REASON_CODES.GAMING_DOMAIN_REVIEW_REQUIRED,
      reason: reasonCopy(RADAR_REASON_CODES.GAMING_DOMAIN_REVIEW_REQUIRED),
      confidence: 0,
      ttl_minutes: 60,
      evidence: [],
    };
  }
  const closeMs = Date.parse(candidate?.source_close_at ?? "");
  const nowMs = Date.parse(now);
  if (Number.isFinite(closeMs) && Number.isFinite(nowMs) && closeMs <= nowMs) {
    return {
      eligible: false,
      conclusive: true,
      reason_code: RADAR_REASON_CODES.PROVIDER_NOT_OPEN,
      reason: "El periodo de participación del mercado de origen ya ha terminado.",
      confidence: 100,
      ttl_minutes: 360,
      evidence: providerEvidence(candidate),
    };
  }
  return null;
}

export function evaluateDeterministicEligibility(candidate, facts = {}, now = new Date().toISOString()) {
  const question = normalizeComparableText(candidate.atinara_question ?? candidate.source_question ?? candidate.source_title);
  const nowMs = Date.parse(now);
  const closeMs = Date.parse(candidate.source_close_at ?? "");
  const resolvedMs = Date.parse(facts.event_resolved_at ?? facts.official_reveal_at ?? "");
  const releaseMs = Date.parse(facts.release_at ?? "");
  const contractKind = predictionContractKind(candidate);
  const directPrediction = ["announcement", "release", "milestone"].includes(contractKind);
  const dependentPrediction = ["award", "review"].includes(contractKind);
  if (Number.isFinite(resolvedMs) && Number.isFinite(nowMs) && resolvedMs <= nowMs) {
    return { eligible: false, conclusive: true, reason_code: RADAR_REASON_CODES.EVENT_ALREADY_RESOLVED, reason: reasonCopy(RADAR_REASON_CODES.EVENT_ALREADY_RESOLVED), confidence: 100 };
  }
  if (Number.isFinite(releaseMs) && Number.isFinite(closeMs) && releaseMs > closeMs && dependentPrediction) {
    return { eligible: false, conclusive: true, reason_code: RADAR_REASON_CODES.EVENT_OUTSIDE_CONTRACT, reason: reasonCopy(RADAR_REASON_CODES.EVENT_OUTSIDE_CONTRACT), confidence: 100 };
  }
  if (facts.subject_announced === false && (contractKind === "review" || (contractKind === "award" && isNamedAwardCandidate(question)))) {
    return { eligible: false, conclusive: true, reason_code: RADAR_REASON_CODES.SUBJECT_NOT_ANNOUNCED, reason: reasonCopy(RADAR_REASON_CODES.SUBJECT_NOT_ANNOUNCED), confidence: 100 };
  }
  if (facts.temporal_coherence === false && !directPrediction && contractKind === "other") {
    return { eligible: false, conclusive: true, reason_code: RADAR_REASON_CODES.TEMPORAL_INCOHERENCE, reason: reasonCopy(RADAR_REASON_CODES.TEMPORAL_INCOHERENCE), confidence: 100 };
  }
  return null;
}

export function evaluatePredictiveEligibility(candidate, facts = {}, now = new Date().toISOString()) {
  if (evaluateProviderEligibility(candidate, now) || !isAdaptedIdeaComplete(candidate)) return null;
  const closeMs = Date.parse(candidate.source_close_at ?? "");
  const nowMs = Date.parse(now);
  if (!Number.isFinite(closeMs) || !Number.isFinite(nowMs) || closeMs <= nowMs) return null;
  const kind = predictionContractKind(candidate);
  const question = normalizeComparableText(candidate.atinara_question ?? candidate.source_question ?? candidate.source_title);
  if (["announcement", "release", "milestone"].includes(kind)) {
    return {
      eligible: true,
      conclusive: true,
      reason_code: RADAR_REASON_CODES.VERIFICATION_REQUIRED,
      reason: "Mercado futuro, binario y resoluble. Que el resultado todavía no esté confirmado es la incertidumbre que se predice.",
      confidence: 95,
      ttl_minutes: 360,
    };
  }
  if (kind === "award" && (!isNamedAwardCandidate(question) || facts.subject_announced === true)) {
    return {
      eligible: true,
      conclusive: true,
      reason_code: RADAR_REASON_CODES.VERIFICATION_REQUIRED,
      reason: "Mercado de premio futuro y resoluble. Las nominaciones o el resultado no necesitan haberse publicado todavía.",
      confidence: 90,
      ttl_minutes: 360,
    };
  }
  if (kind === "review" && facts.subject_announced === true) {
    return {
      eligible: true,
      conclusive: true,
      reason_code: RADAR_REASON_CODES.VERIFICATION_REQUIRED,
      reason: "Mercado de valoración futura con un producto anunciado y una fuente objetiva de resolución.",
      confidence: 90,
      ttl_minutes: 360,
    };
  }
  return null;
}

export function canApplyPredictivePolicyOverride(candidate, decision = {}, now = new Date().toISOString()) {
  const kind = predictionContractKind(candidate);
  const reasonCode = cleanText(decision?.reason_code, 100);
  if (!["announcement", "release", "milestone"].includes(kind)) return false;
  if (![
      RADAR_REASON_CODES.EVENT_OUTSIDE_CONTRACT,
      RADAR_REASON_CODES.SUBJECT_NOT_ANNOUNCED,
      RADAR_REASON_CODES.TEMPORAL_INCOHERENCE,
      RADAR_REASON_CODES.VERIFICATION_REQUIRED,
    ].includes(reasonCode)) return false;
  // La falta de confirmación del resultado es precisamente la incertidumbre de
  // una predicción futura directa. Solo se permite el override si las puertas
  // objetivas ya están completas y el proveedor/fuente no presenta un bloqueo.
  return isAdaptedIdeaComplete(candidate)
    && evaluateProviderEligibility(candidate, now) === null;
}

export function applyEligibilityDecision(candidate, decision = {}, now = new Date().toISOString()) {
  const initialHardReasons = [...new Set(candidate.hard_reject_reasons ?? [])];
  let hardReasons = [...initialHardReasons];
  const evidence = Array.isArray(decision.evidence) ? decision.evidence.filter(isRecord).slice(0, 20).map((item) => ({
    title: cleanText(item.title, 300),
    url: safePublicUrl(item.url),
    published_at: safeIsoDate(item.published_at),
    source_type: cleanText(item.source_type, 80) || "secondary",
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
  })).filter((item) => item.url) : [];
  const requestedFactStatus = cleanText(decision.fact_status, 40);
  const factStatusBlocksApproval = ["partially_resolved", "conflicting", "unknown", "fully_resolved"].includes(requestedFactStatus);
  // Una salida del modelo no es una comprobacion factual por si sola. Para abrir
  // la puerta debe ser concluyente y estar respaldada por al menos una fuente
  // publica conservada en el snapshot. Los estados parciales o contradictorios
  // permanecen siempre en revision.
  const evidencedApproval = decision.eligible === true
    && decision.conclusive === true
    && evidence.some((item) => isDeterministicUnresolvedEvidence(item, candidate, now))
    && !evidence.some((item) => evidenceHasPotentialTerminalClaim(item, candidate, now))
    && !factStatusBlocksApproval;
  const requestedFactualCode = cleanText(decision.reason_code, 100);
  const factualCode = Object.values(RADAR_REASON_CODES).includes(requestedFactualCode)
    ? requestedFactualCode
    : RADAR_REASON_CODES.VERIFICATION_REQUIRED;
  const terminalEvidenceRequired = new Set([
    RADAR_REASON_CODES.EVENT_ALREADY_RESOLVED,
    RADAR_REASON_CODES.SOURCE_STALE,
    RADAR_REASON_CODES.EVENT_OUTSIDE_CONTRACT,
    RADAR_REASON_CODES.SUBJECT_NOT_ANNOUNCED,
    RADAR_REASON_CODES.TEMPORAL_INCOHERENCE,
    RADAR_REASON_CODES.INVALID_OR_UNVERIFIED_SOURCE,
  ]);
  const providerFactUrl = safePublicUrl(candidate?.external_market_url)
    ?? safePublicUrl(candidate?.external_event_url);
  const providerResultBound = Boolean(normalizeProviderResult(candidate?.source_result))
    && Boolean(providerFactUrl)
    && evidence.some((item) => isVerifiedProviderFactEvidence(item) && safePublicUrl(item.url) === providerFactUrl);
  const deterministicSelectionComplete = evidence.some((item) =>
    isVerifiedOfficialEvidence(item, true) && item.selection_complete === true
  );
  const structurallyBound = (reason) => initialHardReasons.includes(reason)
    && [
      RADAR_REASON_CODES.INVALID_OR_UNVERIFIED_SOURCE,
      RADAR_REASON_CODES.EVENT_OUTSIDE_CONTRACT,
      RADAR_REASON_CODES.TEMPORAL_INCOHERENCE,
    ].includes(reason);
  const evidenceSupportsReason = (reason) => reason === RADAR_REASON_CODES.EVENT_ALREADY_RESOLVED
    ? providerResultBound || deterministicSelectionComplete
    : structurallyBound(reason) || evidence.some((item) => evidenceSupportsReasonCode(item, reason));
  hardReasons = hardReasons.filter((reason) =>
    !terminalEvidenceRequired.has(reason) || evidenceSupportsReason(reason)
  );
  const conclusiveFactualRejection = decision.eligible === false
    && decision.conclusive === true
    && factualCode !== RADAR_REASON_CODES.VERIFICATION_REQUIRED
    && (!terminalEvidenceRequired.has(factualCode) || evidenceSupportsReason(factualCode));
  if (conclusiveFactualRejection) hardReasons.push(factualCode);
  const duplicate = hardReasons.includes(RADAR_REASON_CODES.DUPLICATE_MARKET);
  const mappedStatus = hardReasons.includes(RADAR_REASON_CODES.EVENT_ALREADY_RESOLVED) ? "rejected_resolved"
    : hardReasons.includes(RADAR_REASON_CODES.SOURCE_STALE) ? "rejected_stale"
    : hardReasons.includes(RADAR_REASON_CODES.SUBJECT_NOT_ANNOUNCED) ? "rejected_unannounced"
    : hardReasons.includes(RADAR_REASON_CODES.TEMPORAL_INCOHERENCE) ? "rejected_incoherent"
    : hardReasons.includes(RADAR_REASON_CODES.INVALID_OR_UNVERIFIED_SOURCE) || hardReasons.includes(RADAR_REASON_CODES.PROVIDER_EVENT_NOT_FOUND) || hardReasons.includes(RADAR_REASON_CODES.PROVIDER_CHILD_NOT_FOUND) ? "rejected_invalid_source"
    : duplicate ? "rejected_duplicate"
    : hardReasons.length ? "rejected_ineligible"
    : evidencedApproval ? "verified_open"
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
  const factStatus = mappedStatus === "rejected_resolved" ? "fully_resolved"
    : ["partially_resolved", "conflicting"].includes(requestedFactStatus) ? requestedFactStatus
    : requestedFactStatus === "fully_resolved" ? "unknown"
    : requestedFactStatus === "unknown" ? "unknown"
    : primaryCode === RADAR_REASON_CODES.PROVIDER_NOT_OPEN && requestedFactStatus === "unresolved" ? "unresolved"
    : mappedStatus === "verified_open" ? "unresolved"
      : mappedStatus === "needs_review" ? "unknown"
        : cleanText(candidate.fact_status, 40) || "unknown";
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
    fact_status: factStatus,
    fact_checked_at: now,
    fact_policy_version: RADAR_FACT_POLICY_VERSION,
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
      title: lead?.atinara_group_title ?? lead?.source_title ?? lead?.source_question ?? "Evento externo",
      category: lead?.atinara_category ?? lead?.source_category ?? "Industria",
      verification_status: sorted.some((item) => item.verification_status === "verified_open") ? "verified_open" : lead?.verification_status ?? "needs_review",
      quality_score: Math.max(...sorted.map((item) => safeNumber(item.quality_score) ?? 0), 0),
      child_count: Number.isSafeInteger(Number(lead?.provider_declared_child_count))
        ? Number(lead.provider_declared_child_count) : sorted.length,
      provider_declared_child_count: safeNumber(lead?.provider_declared_child_count),
      provider_accounted_child_count: safeNumber(lead?.provider_accounted_child_count),
      provider_identified_child_count: safeNumber(lead?.provider_identified_child_count),
      provider_unresolved_child_count: safeNumber(lead?.provider_unresolved_child_count),
      provider_pagination_exhausted: lead?.provider_pagination_exhausted === true,
      parent_reconciliation_status: cleanText(lead?.parent_reconciliation_status, 80) || null,
      parent_reconciliation_version: cleanText(lead?.parent_reconciliation_version, 100) || null,
      parent_reconciliation_fingerprint: cleanText(lead?.parent_reconciliation_fingerprint, 80) || null,
      candidates: sorted,
      top_candidates: sorted.filter((item) => !RADAR_REJECTED_STATUSES.includes(item.verification_status)).slice(0, 3),
    };
  }).sort((a, b) => b.quality_score - a.quality_score);
}

export const RADAR_DISCOVERY_RESPONSE_BUDGET_BYTES = 900_000;

const RADAR_LIST_TEXT_FIELDS = Object.freeze({
  id: 80,
  provider: 40,
  external_id: 220,
  external_event_id: 220,
  external_event_slug: 400,
  external_event_url: 2_000,
  external_market_id: 220,
  external_market_slug: 400,
  external_market_url: 2_000,
  external_url: 2_000,
  event_group_key: 240,
  family_key: 240,
  family_title: 300,
  family_type: 80,
  family_child_key: 240,
  family_child_label: 300,
  family_version: 100,
  family_sort_at: 100,
  source_title: 700,
  source_question: 700,
  source_category: 120,
  source_close_at: 100,
  source_status: 80,
  source_result: 120,
  source_resolution_url: 2_000,
  atinara_category: 120,
  atinara_group_title: 700,
  atinara_question: 700,
  atinara_resolution_source_url: 2_000,
  state: 80,
  normalizer_version: 100,
  quality_status: 80,
  verification_status: 80,
  verification_reason_code: 100,
  verification_reason: 1_000,
  fetched_at: 100,
  verified_at: 100,
  verification_expires_at: 100,
  eligibility_status: 80,
  eligibility_reason_code: 100,
  eligibility_reason: 1_000,
  eligibility_policy_version: 100,
  eligibility_checked_at: 100,
  eligibility_expires_at: 100,
  domain_reason_code: 100,
  display_reason_code: 100,
  display_reason: 1_000,
  prepared_draft_id: 80,
  provider_refresh_checked_at: 100,
  provider_refresh_state: 80,
  raw_provider_child_label: 300,
  canonical_child_label: 300,
  canonical_child_key: 240,
  identity_kind: 40,
  identity_classification: 100,
  identity_status: 80,
  identity_source: 120,
  availability_status: 80,
  parent_child_occurrence_key: 500,
  parent_child_identity_key: 500,
  parent_child_fingerprint: 80,
  canonical_projection_version: 100,
  parent_reconciliation_id: 80,
  parent_reconciliation_status: 80,
  parent_reconciliation_version: 100,
  parent_reconciliation_fingerprint: 80,
});

const RADAR_LIST_NUMBER_FIELDS = Object.freeze([
  "source_probability",
  "source_probability_yes",
  "quality_score",
  "parent_rank",
  "preparation_revision",
  "current_eligibility_check_id",
  "identity_confidence",
  "provider_declared_child_count",
  "provider_discovered_child_count",
  "provider_accounted_child_count",
  "provider_identified_child_count",
  "provider_unresolved_child_count",
  "provider_removed_child_count",
  "provider_closed_child_count",
  "provider_duplicate_child_count",
  "provider_conflict_child_count",
]);

const RADAR_LIST_BOOLEAN_FIELDS = Object.freeze([
  "is_stale",
  "eligibility_state_preserved",
  "provider_pagination_exhausted",
]);

const INVALID_CATEGORICAL_CHILD_LABEL = /(?:^\s*deadline:|\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,6})?)?(?:Z|[+-]\d{2}:?\d{2})|^\s*(?:lt|lte|gt|gte)\s+\d|^\s*(?:ET|year)\s*$|^\s*(?:before|after|by|on\s+or\s+before|on\s+or\s+after|during|in|antes\s+de|despu[eé]s\s+de|hasta|durante|en)\s+\d{4}(?:\s|$)|^\s*\d{4}(?:\s*\((?:ET|year)\))?\s*$)/i;

export function isCanonicalRadarChildProjectionValid(candidate = {}) {
  if (cleanText(candidate?.canonical_projection_version, 100) !== RADAR_CHILD_PROJECTION_VERSION) return false;
  if (!["categorical_outcomes", "participant_options", "platform_variants"]
    .includes(cleanText(candidate?.family_type, 80))) return true;
  const classification = cleanText(candidate?.identity_classification, 100);
  const familyKey = cleanText(candidate?.family_child_key, 240);
  const canonicalKey = cleanText(candidate?.canonical_child_key, 240);
  const familyLabel = cleanText(candidate?.family_child_label, 300);
  const canonicalLabel = cleanText(candidate?.canonical_child_label, 300);
  const expectedKey = canonicalLabel ? `option:${radarOptionSlug(canonicalLabel, 120)}` : "";
  return [
    "identified_real_option", "aggregate_other_option", "tie_option",
    "no_winner_option", "provider_closed_child",
  ].includes(classification)
    && cleanText(candidate?.identity_status, 80) === "resolved"
    && /^option:[a-z0-9][a-z0-9-]{0,237}$/.test(canonicalKey)
    && familyKey === canonicalKey
    && canonicalKey === expectedKey
    && Boolean(canonicalLabel)
    && normalizeComparableText(familyLabel) === normalizeComparableText(canonicalLabel)
    && !INVALID_CATEGORICAL_CHILD_LABEL.test(canonicalLabel);
}

export function isRadarParentComplete(candidate = {}) {
  const declared = safeNumber(candidate?.provider_declared_child_count);
  const discovered = safeNumber(candidate?.provider_discovered_child_count);
  const accounted = safeNumber(candidate?.provider_accounted_child_count);
  return cleanText(candidate?.parent_reconciliation_status, 80) === "complete"
    && cleanText(candidate?.parent_reconciliation_version, 100) === RADAR_PARENT_RECONCILIATION_VERSION
    && /^[a-f0-9]{64}$/.test(cleanText(candidate?.parent_reconciliation_fingerprint, 80))
    && Boolean(cleanText(candidate?.external_event_id ?? candidate?.provider_parent_id, 220))
    && candidate?.provider_pagination_exhausted === true
    && Number.isInteger(declared) && declared >= 0
    && Number.isInteger(discovered) && discovered === declared
    && Number.isInteger(accounted) && accounted === declared
    && safeNumber(candidate?.provider_unresolved_child_count) === 0
    && safeNumber(candidate?.provider_conflict_child_count) === 0;
}

function projectRadarListEvidenceLink(value) {
  if (!isRecord(value)) return null;
  const url = cleanText(value.url, 2_000);
  if (!safePublicUrl(url)) return null;
  return {
    url,
    title: cleanText(value.title, 240) || null,
    role: cleanText(value.role, 100) || null,
  };
}

function radarListResolutionSourceProof(candidate) {
  const sourceUrl = safePublicUrl(
    candidate?.atinara_resolution_source_url ?? candidate?.source_resolution_url,
  );
  if (!sourceUrl) return null;
  const evidence = [
    ...(Array.isArray(candidate?.resolution_source_evidence) ? candidate.resolution_source_evidence : []),
    ...(Array.isArray(candidate?.eligibility_evidence) ? candidate.eligibility_evidence : []),
    ...(Array.isArray(candidate?.verification_evidence) ? candidate.verification_evidence : []),
  ];
  const proof = evidence.find((item) => isRecord(item)
    && safePublicUrl(item.url) === sourceUrl
    && cleanText(item.source_type, 80) === "official"
    && cleanText(item.retrieval_status, 80) === "verified_content"
    && cleanText(item.evidence_basis, 80) === "retrieved_content"
    && cleanText(item.claim_status, 40) === "direct"
    && item.direct_claim === true);
  if (!isRecord(proof)) return null;
  return {
    url: sourceUrl,
    source_type: "official",
    retrieval_status: "verified_content",
    evidence_basis: "retrieved_content",
    claim_status: "direct",
    direct_claim: true,
  };
}

function projectRadarListDuplicate(value) {
  if (!isRecord(value)) return null;
  return {
    id: cleanText(value.id ?? value.market_id ?? value.draft_id, 80) || null,
    question: cleanText(value.question, 700) || null,
    relationship: cleanText(value.relationship, 80) || null,
    blocking: value.blocking !== false,
  };
}

function projectRadarListWorkflowIssue(value) {
  if (!isRecord(value)) return null;
  return {
    issue_id: cleanText(value.issue_id, 80) || null,
    issue_code: cleanText(value.issue_code, 100) || null,
    detected_by: cleanText(value.detected_by, 80) || null,
    severity: cleanText(value.severity, 40) || null,
    blocking_scope: cleanText(value.blocking_scope, 40) || null,
    repairability: cleanText(value.repairability, 80) || null,
    status: cleanText(value.status, 40) || "open",
    owner_stage: cleanText(value.owner_stage, 80) || null,
    next_action: cleanText(value.next_action, 100) || null,
    retryable: value.retryable === true,
  };
}

export function projectRadarListCandidate(candidate = {}, options = {}) {
  if (!isRecord(candidate)) return {};
  const projected = {};
  for (const [field, limit] of Object.entries(RADAR_LIST_TEXT_FIELDS)) {
    if (!Object.hasOwn(candidate, field)) continue;
    projected[field] = candidate[field] === null ? null : cleanText(candidate[field], limit);
  }
  for (const field of RADAR_LIST_NUMBER_FIELDS) {
    if (!Object.hasOwn(candidate, field)) continue;
    projected[field] = nullableFiniteNumber(candidate[field]);
  }
  for (const field of RADAR_LIST_BOOLEAN_FIELDS) {
    if (!Object.hasOwn(candidate, field)) continue;
    projected[field] = candidate[field] === true;
  }
  const resolutionSourceProof = radarListResolutionSourceProof(candidate);
  projected.resolution_source_proven = Boolean(resolutionSourceProof);
  projected.resolution_source_evidence = resolutionSourceProof ? [resolutionSourceProof] : [];
  projected.duplicate_matches = (Array.isArray(candidate.duplicate_matches)
    ? candidate.duplicate_matches : [])
    .map(projectRadarListDuplicate).filter(Boolean).slice(0, 20);
  projected.workflow_issues = (Array.isArray(candidate.workflow_issues)
    ? candidate.workflow_issues : [])
    .map(projectRadarListWorkflowIssue).filter(Boolean).slice(0, 40);
  projected.hard_reject_reasons = (Array.isArray(candidate.hard_reject_reasons)
    ? candidate.hard_reject_reasons : [])
    .map((value) => cleanText(value, 100)).filter(Boolean).slice(0, 20);
  if (options.rejection === true) {
    projected.verification_evidence = (Array.isArray(candidate.verification_evidence)
      ? candidate.verification_evidence : [])
      .map(projectRadarListEvidenceLink).filter(Boolean).slice(0, 2);
  }
  return projected;
}

function projectRadarListGroup(group) {
  if (!isRecord(group)) return null;
  const candidates = (Array.isArray(group.candidates) ? group.candidates : [])
    .filter(isRecord).map((candidate) => projectRadarListCandidate(candidate));
  if (!candidates.length) return null;
  return {
    event_group_key: cleanText(group.event_group_key, 240),
    provider: cleanText(group.provider, 40),
    external_event_id: cleanText(group.external_event_id, 220) || null,
    external_event_slug: cleanText(group.external_event_slug, 400) || null,
    external_event_url: safePublicUrl(group.external_event_url),
    title: cleanText(group.title, 700) || "Evento externo",
    category: cleanText(group.category, 120) || "Industria",
    verification_status: cleanText(group.verification_status, 80) || "needs_review",
    quality_score: nullableFiniteNumber(group.quality_score) ?? 0,
    child_count: Math.max(candidates.length, Math.floor(nullableFiniteNumber(group.provider_declared_child_count) ?? 0)),
    provider_declared_child_count: nullableFiniteNumber(group.provider_declared_child_count),
    provider_accounted_child_count: nullableFiniteNumber(group.provider_accounted_child_count),
    provider_identified_child_count: nullableFiniteNumber(group.provider_identified_child_count),
    provider_unresolved_child_count: nullableFiniteNumber(group.provider_unresolved_child_count),
    provider_pagination_exhausted: group.provider_pagination_exhausted === true,
    parent_reconciliation_status: cleanText(group.parent_reconciliation_status, 80) || null,
    parent_reconciliation_version: cleanText(group.parent_reconciliation_version, 100) || null,
    parent_reconciliation_fingerprint: cleanText(group.parent_reconciliation_fingerprint, 80) || null,
    candidates,
  };
}

export function projectRadarParentReconciliation(value = {}) {
  if (!isRecord(value)) return null;
  const number = (field) => {
    const result = nullableFiniteNumber(value[field]);
    return result === null ? null : Math.max(0, Math.floor(result));
  };
  return {
    id: cleanText(value.id, 80) || null,
    provider: cleanText(value.provider, 40),
    provider_parent_id: cleanText(value.provider_parent_id, 220),
    raw_provider_parent_label: cleanText(value.raw_provider_parent_label, 500) || null,
    canonical_parent_label: cleanText(value.canonical_parent_label, 500) || null,
    raw_provider_category: cleanText(value.raw_provider_category, 120) || null,
    atinara_category: cleanText(value.atinara_category, 120) || null,
    category: cleanText(value.category, 120) || null,
    external_parent_url: safePublicUrl(value.external_parent_url),
    horizon_at: safeIsoDate(value.horizon_at),
    provider_declared_child_count: number("provider_declared_child_count"),
    provider_discovered_child_count: number("provider_discovered_child_count"),
    provider_accounted_child_count: number("provider_accounted_child_count"),
    provider_identified_child_count: number("provider_identified_child_count"),
    provider_unresolved_child_count: number("provider_unresolved_child_count"),
    provider_removed_child_count: number("provider_removed_child_count"),
    provider_closed_child_count: number("provider_closed_child_count"),
    provider_duplicate_child_count: number("provider_duplicate_child_count"),
    provider_conflict_child_count: number("provider_conflict_child_count"),
    catalog_candidate_count: number("catalog_candidate_count"),
    preparable_child_count: number("preparable_child_count"),
    eligible_child_count: number("eligible_child_count"),
    technical_hold_child_count: number("technical_hold_child_count"),
    terminal_child_count: number("terminal_child_count"),
    resolved_result_child_count: number("resolved_result_child_count"),
    inactive_child_count: number("inactive_child_count"),
    duplicate_candidate_child_count: number("duplicate_candidate_child_count"),
    invalid_child_count: number("invalid_child_count"),
    legacy_expected_child_count: number("legacy_expected_child_count"),
    legacy_accounted_child_count: number("legacy_accounted_child_count"),
    new_child_count: number("new_child_count"),
    provider_pagination_exhausted: value.provider_pagination_exhausted === true,
    reconciliation_status: cleanText(value.reconciliation_status, 80),
    reconciliation_version: cleanText(value.reconciliation_version, 100),
    normalizer_version: cleanText(value.normalizer_version, 100),
    family_version: cleanText(value.family_version, 100),
    reconciliation_fingerprint: cleanText(value.reconciliation_fingerprint, 80),
    checked_at: safeIsoDate(value.checked_at),
    next_retry_at: safeIsoDate(value.next_retry_at),
    source_refs: safeReconciliationEvidence(value.source_refs).slice(0, 12),
    issue: isRecord(value.issue) ? projectRadarListWorkflowIssue(value.issue) : null,
  };
}

function projectRadarRejectionSummary(value) {
  const summary = isRecord(value) ? value : {};
  const items = (Array.isArray(summary.items) ? summary.items : [])
    .filter(isRecord).map((candidate) => projectRadarListCandidate(candidate, { rejection: true }));
  const counts = {};
  if (isRecord(summary.counts)) {
    for (const [code, count] of Object.entries(summary.counts)) {
      if (!/^[A-Z][A-Z0-9_]{2,99}$/.test(code)) continue;
      const numeric = nullableFiniteNumber(count);
      if (numeric !== null && numeric >= 0) counts[code] = Math.floor(numeric);
    }
  }
  return {
    total: Math.max(items.length, Math.floor(nullableFiniteNumber(summary.total) ?? 0)),
    counts,
    items,
  };
}

function radarCandidateFlatProjection(groups) {
  return groups.flatMap((group) => group.candidates)
    .filter((candidate) => cleanText(candidate.id, 80));
}

export function projectRadarDiscoveryView(view = {}) {
  const source = isRecord(view) ? view : {};
  const groups = (Array.isArray(source.groups) ? source.groups : [])
    .map(projectRadarListGroup).filter(Boolean);
  const candidates = radarCandidateFlatProjection(groups);
  const parentReconciliations = (Array.isArray(source.parent_reconciliations)
    ? source.parent_reconciliations : [])
    .map(projectRadarParentReconciliation).filter(Boolean);
  const page = isRecord(source.page) ? source.page : {};
  const reconciliationPage = isRecord(source.reconciliation_page) ? source.reconciliation_page : {};
  return {
    groups,
    candidates,
    candidate_count: candidates.length,
    parent_reconciliations: parentReconciliations,
    reconciliation_page: {
      total: Math.max(parentReconciliations.length, Math.floor(nullableFiniteNumber(reconciliationPage.total) ?? 0)),
      offset: Math.max(0, Math.floor(nullableFiniteNumber(reconciliationPage.offset) ?? 0)),
      limit: Math.max(1, Math.floor(nullableFiniteNumber(reconciliationPage.limit) ?? 20)),
      previous_offset: reconciliationPage.previous_offset === null
        ? null : nullableFiniteNumber(reconciliationPage.previous_offset),
      next_offset: reconciliationPage.next_offset === null
        ? null : nullableFiniteNumber(reconciliationPage.next_offset),
      snapshot_available: reconciliationPage.snapshot_available === true,
    },
    rejected: projectRadarRejectionSummary(source.rejected),
    providers: Array.isArray(source.providers) ? source.providers.filter(isRecord) : [],
    page: {
      parent_count: Math.max(groups.length, Math.floor(nullableFiniteNumber(page.parent_count) ?? 0)),
      parent_offset: Math.max(0, Math.floor(nullableFiniteNumber(page.parent_offset) ?? 0)),
      parent_limit: Math.max(1, Math.floor(nullableFiniteNumber(page.parent_limit) ?? Math.max(groups.length, 1))),
      previous_parent_offset: nullableFiniteNumber(page.previous_parent_offset),
      next_parent_offset: nullableFiniteNumber(page.next_parent_offset),
    },
  };
}

function radarDiscoveryPayloadBytes(value) {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

export function constrainRadarDiscoveryPayload(
  payload,
  maxBytes = RADAR_DISCOVERY_RESPONSE_BUDGET_BYTES,
) {
  if (!isRecord(payload) || !Array.isArray(payload.groups)) {
    return { fits: false, bytes: 0, payload: {} };
  }
  const budget = Math.max(64_000, Math.floor(nullableFiniteNumber(maxBytes) ?? 0));
  const originalGroups = payload.groups.filter(isRecord);
  let groups = originalGroups;
  let candidate = { ...payload };
  let bytes = radarDiscoveryPayloadBytes(candidate);
  while (bytes > budget && groups.length > 1) {
    groups = groups.slice(0, -1);
    const candidates = radarCandidateFlatProjection(groups);
    const parentOffset = Math.max(0, Math.floor(nullableFiniteNumber(payload.page?.parent_offset) ?? 0));
    candidate = {
      ...payload,
      groups,
      candidates,
      candidate_count: candidates.length,
      response_budget_limited: true,
      page: {
        ...(isRecord(payload.page) ? payload.page : {}),
        parent_limit: groups.length,
        next_parent_offset: parentOffset + groups.length,
      },
    };
    bytes = radarDiscoveryPayloadBytes(candidate);
  }
  return {
    fits: bytes <= budget,
    bytes,
    payload: candidate,
    omitted_parent_count: originalGroups.length - groups.length,
  };
}

export function buildAiCandidateBatches(candidates = [], options = {}) {
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

function rejectionPresentation(candidate, nowMs = Date.now()) {
  const recordedCode = cleanText(candidate?.verification_reason_code, 100);
  if (recordedCode !== RADAR_REASON_CODES.PROVIDER_NOT_OPEN
      || cleanText(candidate?.eligibility_status, 40) !== "inactive_option"
      || normalizeProviderResult(candidate?.source_result)) {
    return candidate;
  }
  const payload = isRecord(candidate?.provider_payload) ? candidate.provider_payload : {};
  const children = Array.isArray(payload.canonical_event_children)
    ? payload.canonical_event_children.filter(isRecord)
    : [];
  const total = safeNumber(payload.canonical_event_children_total);
  const currentMarketId = cleanText(candidate?.external_market_id, 220);
  const complete = payload.canonical_url_verified === true
    && payload.canonical_event_children_complete === true
    && Number.isInteger(total)
    && total > 1
    && children.length === total;
  if (!complete || !currentMarketId) return candidate;

  const futureOrUndated = (value) => {
    const closeMs = Date.parse(cleanText(value, 100));
    return !Number.isFinite(closeMs) || closeMs > nowMs;
  };
  const currentChild = children.find((child) => cleanText(child.market_id, 220) === currentMarketId);
  const currentIsInactive = currentChild
    && !normalizeProviderResult(currentChild.result)
    && !providerIsOpen(currentChild.status)
    && futureOrUndated(currentChild.close_at ?? candidate?.source_close_at);
  const hasOpenSibling = children.some((child) => cleanText(child.market_id, 220) !== currentMarketId
    && !normalizeProviderResult(child.result)
    && providerIsOpen(child.status)
    && futureOrUndated(child.close_at));
  if (!currentIsInactive || !hasOpenSibling) return candidate;

  const reason = reasonCopy(RADAR_REASON_CODES.PROVIDER_OPTION_INACTIVE);
  return {
    ...candidate,
    recorded_verification_reason_code: recordedCode,
    recorded_verification_reason: candidate.verification_reason ?? null,
    display_reason_code: RADAR_REASON_CODES.PROVIDER_OPTION_INACTIVE,
    display_reason: reason,
    verification_reason_code: RADAR_REASON_CODES.PROVIDER_OPTION_INACTIVE,
    verification_reason: reason,
  };
}

export function summarizeRejections(candidates = []) {
  const counts = {};
  const items = candidates
    .filter((item) => RADAR_REJECTED_STATUSES.includes(item.verification_status)
      && cleanText(item.normalizer_version, 100) === RADAR_NORMALIZER_VERSION
      && cleanText(item.identity_status, 80) === "resolved"
      && cleanText(item.parent_reconciliation_status, 80) === "complete")
    .map((item) => rejectionPresentation(item));
  for (const item of items) {
    const code = item.verification_reason_code ?? "UNKNOWN";
    counts[code] = (counts[code] ?? 0) + 1;
  }
  return { total: items.length, counts, items };
}

export function canReuseRadarVerification(cached, candidate, now = new Date().toISOString()) {
  if (!isRecord(cached) || !isRecord(candidate)) return false;
  if (cleanText(cached.normalizer_version, 80) !== RADAR_NORMALIZER_VERSION) return false;
  if (cleanText(cached.eligibility_policy_version, 80) !== RADAR_ELIGIBILITY_POLICY_VERSION) return false;
  if (cleanText(candidate.eligibility_policy_version, 80) !== RADAR_ELIGIBILITY_POLICY_VERSION) return false;
  if (cleanText(cached.fingerprint, 120) !== cleanText(candidate.fingerprint, 120)) return false;
  if (cleanText(cached.verification_status, 80) === "needs_review") return false;
  if (cleanText(cached.verification_reason_code, 100) === RADAR_REASON_CODES.VERIFICATION_REQUIRED) return false;
  // Un estado abierto nunca es terminal: antes de cada descubrimiento explícito
  // y de cada preparación se vuelve a comprobar el hecho externo.
  if (cleanText(cached.verification_status, 80) === "verified_open") return false;
  if (cleanText(cached.fact_policy_version, 100) !== RADAR_FACT_POLICY_VERSION) return false;
  if (!cleanText(cached.fact_context_fingerprint, 120)
      || cleanText(cached.fact_context_fingerprint, 120) !== cleanText(candidate.fact_context_fingerprint, 120)) return false;
  const expiresAt = Date.parse(cleanText(cached.verification_expires_at, 100));
  const nowMs = Date.parse(now);
  return Number.isFinite(expiresAt) && Number.isFinite(nowMs) && expiresAt > nowMs;
}

function canonicalAuthorityDomains(authoritativeDomains) {
  const values = authoritativeDomains instanceof Set
    ? [...authoritativeDomains]
    : Array.isArray(authoritativeDomains) ? authoritativeDomains : [];
  return [...new Set(values
    .map((value) => cleanText(value, 255).toLowerCase().replace(/^www\./, ""))
    .filter((value) => /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(value)))];
}

function registeredAuthorityDomain(urlValue, authoritativeDomains) {
  const url = safePublicUrl(urlValue);
  if (!url) return null;
  const host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  return canonicalAuthorityDomains(authoritativeDomains)
    .find((domain) => host === domain || host.endsWith(`.${domain}`)) ?? null;
}

/** @param {ReadonlySet<string>|Set<string>|string[]} authoritativeDomains */
export function providerResolutionSourceUrls(candidate, authoritativeDomains = new Set()) {
  const provenance = isRecord(candidate?.source_resolution_provenance)
    ? candidate.source_resolution_provenance : {};
  const url = safePublicUrl(candidate?.source_resolution_url);
  const provider = cleanText(candidate?.provider, 40);
  const upstreamField = cleanText(provenance.upstream_field, 100);
  const trustedFields = [
    "market.resolutionSource",
    "event.resolutionSource",
    "market.settlement_sources",
    "event.settlement_sources",
    "market.rules_url",
    "event.rules_url",
  ];
  if (!url
      || !registeredAuthorityDomain(url, authoritativeDomains)
      || cleanText(provenance.provider, 40) !== provider
      || safePublicUrl(provenance.source_url) !== url
      || provenance.declared_by_provider !== true
      || cleanText(provenance.adapter_version, 100) !== cleanText(candidate?.normalizer_version, 100)
      || cleanText(candidate?.normalizer_version, 100) !== RADAR_NORMALIZER_VERSION
      || !trustedFields.includes(upstreamField)) return [];
  return [url];
}

function resolutionContractIdentity(candidate) {
  const payload = isRecord(candidate?.provider_payload) ? candidate.provider_payload : {};
  return cleanText(
    candidateResolutionSubject(candidate)
      || candidate?.family_child_label
      || payload?.yes_sub_title
      || payload?.no_sub_title,
    240,
  );
}

const RESOLUTION_AUTHORITY_IDENTITY_STOPWORDS = new Set([
  "after", "antes", "como", "con", "del", "desde", "during", "este", "esta", "game",
  "juego", "para", "release", "released", "sera", "será", "sobre", "the", "will", "year",
]);

function resolutionAuthorityIdentityTokens(value) {
  return normalizeComparableText(value).split(" ")
    .filter((token) => token.length >= 3 && !RESOLUTION_AUTHORITY_IDENTITY_STOPWORDS.has(token));
}

function resolutionAuthorityIdentityMatches(value, material) {
  const identity = normalizeComparableText(value);
  const comparableMaterial = normalizeComparableText(material);
  const tokens = resolutionAuthorityIdentityTokens(value);
  if (!identity || !comparableMaterial || !tokens.length) return false;
  if (comparableMaterial.includes(identity)) return true;
  const materialTokens = new Set(comparableMaterial.split(" "));
  return tokens.every((token) => materialTokens.has(token));
}

function resolutionAuthorityEndpointIdentity(candidate, contract, page) {
  const finalUrl = safePublicUrl(page?.url);
  if (!finalUrl) return null;
  const parsed = new URL(finalUrl);
  const headerMaterial = `${parsed.pathname} ${cleanText(page?.title, 300)}`;
  if (resolutionAuthorityIdentityMatches(contract.identity, headerMaterial)) {
    return "subject_header";
  }
  const familyIdentity = cleanText(candidate?.family_title ?? candidate?.source_title, 500);
  if (resolutionAuthorityIdentityMatches(familyIdentity, headerMaterial)
      && resolutionAuthorityIdentityMatches(contract.identity, cleanText(page?.content, 300_000))) {
    return "family_header_child_content";
  }
  return null;
}

export function resolutionAuthorityContract(candidate, urlValue, authoritativeDomains = new Set()) {
  const url = safePublicUrl(urlValue);
  const domain = registeredAuthorityDomain(url, authoritativeDomains);
  const providerUrls = providerResolutionSourceUrls(candidate, authoritativeDomains);
  if (!url || !domain || !providerUrls.includes(url)) return null;
  const rules = cleanText(candidate?.source_resolution_rules, 4_000);
  const identity = resolutionContractIdentity(candidate);
  const normalizedRules = normalizeComparableText(rules);
  const identityTokens = normalizeComparableText(identity).split(" ").filter((token) => token.length > 2);
  const hasIdentity = identityTokens.length > 0 && identityTokens.every((token) => normalizedRules.includes(token));
  const hasResolutionPredicate = /\b(?:resolv(?:e|es|ed|er|era|erá)|settle[sd]?|determined|determina(?:do|r|rá))\b/i.test(rules);
  const hasOutcome = /\b(?:yes|no|si|sí|true|false)\b/i.test(rules);
  if (rules.length < 24 || !hasIdentity || !hasResolutionPredicate || !hasOutcome) return null;
  return {
    url,
    canonical_domain: domain,
    identity,
    contract_sha_material: `${domain}|${url}|${identity}|${rules}`,
    authority_role: "PRIMARY_RESOLUTION",
    policy_version: "atinara-resolution-authority-v3",
    provider: cleanText(candidate?.provider, 40),
    provider_contract_field: cleanText(candidate?.source_resolution_provenance?.upstream_field, 100),
    adapter_version: cleanText(candidate?.normalizer_version, 100),
  };
}

/** @param {ReadonlySet<string>|Set<string>|string[]} authoritativeDomains */
export function buildResolutionAuthorityEvidence(candidate, page, retrievedAt, authoritativeDomains = new Set()) {
  const finalUrl = safePublicUrl(page?.url);
  const providerUrls = providerResolutionSourceUrls(candidate, authoritativeDomains);
  const contractUrl = providerUrls.find((candidateUrl) => {
    try {
      const candidateHost = new URL(candidateUrl).hostname.toLowerCase().replace(/^www\./, "");
      const finalHost = finalUrl ? new URL(finalUrl).hostname.toLowerCase().replace(/^www\./, "") : "";
      return candidateUrl === finalUrl || candidateHost === finalHost;
    } catch {
      return false;
    }
  });
  const contract = resolutionAuthorityContract(candidate, contractUrl, authoritativeDomains);
  const endpointIdentityBasis = contract
    ? resolutionAuthorityEndpointIdentity(candidate, contract, page)
    : null;
  if (!contract || !finalUrl || !registeredAuthorityDomain(finalUrl, authoritativeDomains)
      || !endpointIdentityBasis
      || !/^[0-9a-f]{64}$/i.test(cleanText(page?.contentSha256, 80))) return null;
  return {
    title: cleanText(page?.title, 300) || contract.canonical_domain,
    url: finalUrl,
    contract_url: contract.url,
    provider: contract.provider,
    provider_contract_field: contract.provider_contract_field,
    adapter_version: contract.adapter_version,
    published_at: null,
    source_type: "official",
    supports: "El endpoint resolutivo declarado por el proveedor coincide con la identidad contractual y responde en un dominio oficial registrado.",
    retrieved_at: safeIsoDate(retrievedAt),
    retrieval_status: "verified_authority_endpoint",
    evidence_basis: "provider_resolution_contract",
    parser_version: "atinara-resolution-authority-v3",
    content_sha256: cleanText(page.contentSha256, 80).toLowerCase(),
    content_type: cleanText(page?.contentType, 100),
    claim_status: "resolution_authority",
    direct_claim: false,
    claim_verifiable: true,
    authority_role: contract.authority_role,
    resolution_contract_specific: true,
    candidate_external_id: cleanText(candidate?.external_id, 220),
    contract_identity: contract.identity,
    endpoint_identity_verified: true,
    endpoint_identity_basis: endpointIdentityBasis,
    canonical_domain: contract.canonical_domain,
    contract_policy_version: contract.policy_version,
    relevance_score: 100,
    supported_reason_codes: [],
    supported_fact_statuses: [],
    supported_contract_kinds: [],
    unresolved_proof: false,
  };
}

export function isResolutionAuthorityEvidence(item) {
  return isRecord(item)
    && item.source_type === "official"
    && item.retrieval_status === "verified_authority_endpoint"
    && item.evidence_basis === "provider_resolution_contract"
    && item.parser_version === "atinara-resolution-authority-v3"
    && item.claim_status === "resolution_authority"
    && item.direct_claim === false
    && item.claim_verifiable === true
    && item.authority_role === "PRIMARY_RESOLUTION"
    && item.resolution_contract_specific === true
    && Boolean(cleanText(item.candidate_external_id, 220))
    && Boolean(cleanText(item.contract_identity, 240))
    && item.endpoint_identity_verified === true
    && ["subject_header", "family_header_child_content"].includes(cleanText(item.endpoint_identity_basis, 80))
    && Boolean(cleanText(item.provider, 40))
    && Boolean(cleanText(item.provider_contract_field, 100))
    && Boolean(cleanText(item.adapter_version, 100))
    && /^[0-9a-f]{64}$/i.test(cleanText(item.content_sha256, 80))
    && Boolean(safePublicUrl(item.url));
}

function exactResolutionEvidence(candidate, item) {
  if (!isVerifiedOfficialEvidence(item, true)) return false;
  const subject = candidateResolutionSubject(candidate);
  const comparableSubject = normalizeComparableText(subject);
  const subjectTokens = comparableSubject.split(" ").filter((token) => token.length > 2);
  const url = safePublicUrl(item?.url);
  if (!url || comparableSubject.length < 3 || subjectTokens.length < 1) return false;
  const parsed = new URL(url);
  const material = normalizeComparableText(`${parsed.pathname} ${item.title ?? ""} ${item.supports ?? ""}`);
  return material.includes(comparableSubject)
    || subjectTokens.every((token) => material.includes(token));
}

export function hasDeterministicOfficialResearchCoverage(candidates, evidence, now = new Date().toISOString()) {
  const scopedCandidates = (Array.isArray(candidates) ? candidates : []).filter(isRecord);
  const scopedEvidence = (Array.isArray(evidence) ? evidence : []).filter(isRecord);
  return scopedCandidates.length > 0 && scopedCandidates.every((candidate) =>
    scopedEvidence.some((item) => {
      if (!exactResolutionEvidence(candidate, item)
          || !isDeterministicUnresolvedEvidence(item, candidate, now)) return false;
      const family = deriveMarketFamily(candidate);
      const boundary = safeIsoDate(
        family?.family_semantics?.temporal_boundary?.canonical_instant
          ?? candidate?.evaluation_ends_at
          ?? candidate?.source_close_at,
      );
      const unresolvedUntil = Date.parse(cleanText(item.unresolved_until, 100));
      return Boolean(boundary)
        && unresolvedUntil <= Date.parse(boundary) + 60_000;
    }),
  );
}

export function selectVerifiedResolutionUrl(candidate, evidence = [], authoritativeDomains = new Set()) {
  const subject = candidateResolutionSubject(candidate);
  const comparableSubject = normalizeComparableText(subject);
  const subjectTokens = comparableSubject.split(" ").filter((token) => token.length > 2);
  const contract = normalizeComparableText([
    candidate?.source_title,
    candidate?.source_question,
    candidate?.source_description,
    candidate?.source_resolution_rules,
    ...(Array.isArray(candidate?.source_tags) ? candidate.source_tags : []),
  ].filter(Boolean).join(" "));
  const preferredPlatform = /\b(?:playstation|ps[45])\b/.test(contract) ? "playstation"
    : /\b(?:nintendo|switch|e-?shop)\b/.test(contract) ? "nintendo"
      : /\bxbox\b/.test(contract) ? "xbox"
        : /\b(?:steam|pc)\b/.test(contract) ? "steam"
          : null;
  const sources = [];
  const verifiedEvidence = (Array.isArray(evidence) ? evidence : [])
    .filter((item) => exactResolutionEvidence(candidate, item))
    .filter((item) => Boolean(registeredAuthorityDomain(item.url, authoritativeDomains)));
  const authorityEvidence = (Array.isArray(evidence) ? evidence : [])
    .filter((item) => isResolutionAuthorityEvidence(item))
    .filter((item) => cleanText(item.candidate_external_id, 220) === cleanText(candidate?.external_id, 220))
    .filter((item) => normalizeComparableText(item.contract_identity)
      === normalizeComparableText(resolutionContractIdentity(candidate)))
    .filter((item) => Boolean(registeredAuthorityDomain(item.url, authoritativeDomains)))
    .filter((item) => Boolean(resolutionAuthorityContract(
      candidate,
      item.contract_url ?? item.url,
      authoritativeDomains,
    )));
  const remember = (urlValue, item = {}, authorityOnly = false) => {
    const url = safePublicUrl(urlValue);
    if (!url || !registeredAuthorityDomain(url, authoritativeDomains)) return;
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
    const material = normalizeComparableText(`${parsed.pathname} ${item.title ?? ""} ${item.supports ?? ""}`);
    const exactSubject = comparableSubject.length >= 3 && (
      material.includes(comparableSubject)
      || (subjectTokens.length >= 1 && subjectTokens.every((token) => material.split(" ").includes(token)))
    );
    if (!exactSubject && !authorityOnly) return;
    let score = authorityOnly ? 140 : 200;
    const platform = host.endsWith("playstation.com") ? "playstation"
      : host.endsWith("nintendo.com") ? "nintendo"
        : host.endsWith("xbox.com") ? "xbox"
          : host === "store.steampowered.com" ? "steam"
            : "publisher";
    if (platform !== "publisher") score += 25;
    if (/\b(?:store|games?|product|software|app)\b/.test(normalizeComparableText(parsed.pathname))) score += 15;
    if (preferredPlatform && platform === preferredPlatform) score += 40;
    if (preferredPlatform && platform !== preferredPlatform && platform !== "publisher") score -= 35;
    sources.push({ url, score });
  };
  for (const item of verifiedEvidence) remember(item.url, item);
  for (const item of authorityEvidence) remember(item.url, item, true);
  const existingUrl = safePublicUrl(candidate?.atinara_resolution_source_url ?? candidate?.source_resolution_url);
  const existingProof = verifiedEvidence.find((item) => safePublicUrl(item.url) === existingUrl);
  const existingAuthority = authorityEvidence.find((item) => safePublicUrl(item.url) === existingUrl
    || safePublicUrl(item.contract_url) === existingUrl);
  if (existingProof) remember(existingUrl, existingProof);
  else if (existingAuthority) remember(existingAuthority.url, existingAuthority, true);
  sources.sort((left, right) => right.score - left.score || left.url.localeCompare(right.url));
  return sources[0]?.url ?? null;
}

export function candidateResolutionSubject(candidate) {
  const selection = selectionPresentation(candidate?.source_question ?? candidate?.atinara_question);
  if (selection?.subject) return selection.subject;
  const metric = thresholdSubject(candidate);
  if (metric) return metric;
  const family = deriveMarketFamily(candidate);
  const familySemantics = isRecord(family?.family_semantics) ? family.family_semantics : {};
  const officialContentEntity = cleanText(
    familySemantics.content_kind ? familySemantics.entity_label : null,
    240,
  );
  if (officialContentEntity) return officialContentEntity;
  const question = cleanText(candidate?.source_question ?? candidate?.atinara_question ?? candidate?.source_title, 700)
    .replace(/^[¿\s]+|[?\s]+$/g, "");
  const patterns = [
    /^will\s+(.+?)\s+(?:be\s+)?(?:released?|launch|come out)\b/i,
    /^will\s+(.+?)\s+(?:win|be nominated|appear|feature|have|reach|sell)\b/i,
    /^(?:se\s+)?(?:lanzará|publicará|saldrá)\s+(.+?)\s+(?:este|antes|durante|en)\b/i,
    /^(.+?)\s+(?:se\s+lanzará|ganará|será\s+nominad|tendrá|alcanzará)\b/i,
  ];
  for (const pattern of patterns) {
    const match = question.match(pattern);
    const value = cleanText(match?.[1], 240);
    if (value) return value;
  }
  return cleanText(candidate?.source_title, 240).replace(/\s*:\s*(?:release|launch|score|metacritic|cover).*$/i, "");
}

function selectionQuestion(value) {
  const question = normalizeComparableText(value).replace(/\?$/, "");
  const patterns = [
    /^will (.+?) be (?:on )?the cover of (.+)$/,
    /^will (.+?) (?:appear|feature) (?:on|in) the cover of (.+)$/,
    /^(?:estara|estará) (.+?) en la portada de (.+)$/,
    /^sera (.+?) (?:el|la) (?:atleta|protagonista) de portada de (.+)$/,
  ];
  for (const pattern of patterns) {
    const match = question.match(pattern);
    if (match) return { name: match[1], subject: match[2] };
  }
  return null;
}

function selectionPresentation(value) {
  const question = cleanText(value, 700).replace(/[?¿]+$/g, "").replace(/^¿/, "").trim();
  const patterns = [
    /^will\s+(.+?)\s+be\s+(?:on\s+)?the\s+cover\s+of\s+(.+)$/i,
    /^will\s+(.+?)\s+(?:appear|feature)\s+(?:on|in)\s+the\s+cover\s+of\s+(.+)$/i,
    /^(?:estará|estara|aparecerá|aparecera)\s+(.+?)\s+en\s+la\s+portada\s+de\s+(.+)$/i,
    /^será\s+(.+?)\s+(?:el|la)\s+(?:atleta|protagonista)\s+de\s+portada\s+de\s+(.+)$/i,
  ];
  for (const pattern of patterns) {
    const match = question.match(pattern);
    if (match?.[1] && match?.[2]) {
      return { name: cleanText(match[1], 180), subject: cleanText(match[2], 240) };
    }
  }
  return null;
}

function thresholdOperatorCopy(operator) {
  return ({
    gt: "superior a",
    gte: "igual o superior a",
    lt: "inferior a",
    lte: "igual o inferior a",
    eq: "exactamente",
  })[operator] ?? null;
}

function thresholdMetricCopy(candidate) {
  const contract = normalizeComparableText([
    candidate?.source_title,
    candidate?.source_question,
    candidate?.source_resolution_rules,
  ].filter(Boolean).join(" "));
  if (/\buser score\b|\bpuntuacion de usuarios\b/.test(contract)) return "una puntuación de usuarios en Metacritic";
  if (/\bmetascore\b|\bmetacritic\b/.test(contract)) return "una puntuación en Metacritic";
  if (/\bopencritic\b/.test(contract)) return "una puntuación en OpenCritic";
  if (/\bcritic score\b|\bpuntuacion de la critica\b/.test(contract)) return "una puntuación de la crítica";
  if (/\bscore\b|\bpuntuacion\b/.test(contract)) return "una puntuación";
  return null;
}

function thresholdSubject(candidate) {
  const title = cleanText(candidate?.source_title, 500).replace(/[?¿]+$/g, "");
  const byMetricSuffix = title.replace(/\s*:\s*(?:metacritic|metascore|opencritic|user\s+score|critic\s+score|score|puntuaci[oó]n).*$/i, "").trim();
  if (byMetricSuffix && byMetricSuffix !== title) return byMetricSuffix;
  const rules = cleanText(candidate?.source_resolution_rules, 5000);
  const byRule = rules.match(/(?:metascore|metacritic\s+score|opencritic\s+score|user\s+score|critic\s+score|score)\s+(?:for|of)\s+(.+?)\s+is\s+(?:above|over|greater\s+than|below|under|less\s+than|at\s+least|at\s+most|equal\s+to)\b/i);
  return cleanText(byRule?.[1], 240);
}

function metricThresholdPresentation(candidate) {
  const payload = familyProviderPayload(candidate);
  const labelThreshold = familyThreshold(payload.yes_sub_title);
  if (!labelThreshold || labelThreshold.ambiguous) return null;
  const structuredFloor = safeNumber(payload.floor_strike);
  if (structuredFloor !== null && Number(labelThreshold.value) !== structuredFloor) return null;
  const operator = thresholdOperatorCopy(labelThreshold.operator);
  const metric = thresholdMetricCopy(candidate);
  const subject = thresholdSubject(candidate);
  if (!operator || !metric || !subject) return null;
  const days = factualObservationDays(candidate);
  const observation = days
    ? ` ${days === 1 ? "un día" : `${days} días`} después de su lanzamiento`
    : "";
  return `¿Tendrá ${subject} ${metric} ${operator} ${labelThreshold.value}${observation}?`;
}

function releaseDeadlinePresentation(candidate) {
  const question = cleanText(candidate?.source_question ?? candidate?.atinara_question, 700)
    .replace(/^[¿\s]+|[?\s]+$/g, "");
  const english = question.match(/^will\s+(.+?)\s+(?:be\s+)?(?:release(?:d)?|launch(?:ed)?|come\s+out)\s+(.+)$/i);
  if (!english) return null;
  const subject = cleanText(english[1], 240);
  const rawPeriod = cleanText(english[2], 240);
  const period = normalizeComparableText(rawPeriod);
  if (!subject || !period) return null;
  let temporalCopy = null;
  if (period === "this year") temporalCopy = "este año";
  else if (period === "next year") temporalCopy = "el año que viene";
  else if (/^in\s+20\d{2}$/.test(period)) temporalCopy = `en ${period.slice(3)}`;
  else if (/^(?:by|before|on or before)\s+/.test(period)) {
    temporalCopy = `antes de ${rawPeriod.replace(/^(?:by|before|on or before)\s+/i, "")}`;
  } else if (/^during\s+/.test(period)) {
    temporalCopy = `durante ${rawPeriod.replace(/^during\s+/i, "")}`;
  }
  return temporalCopy ? `¿Se lanzará ${subject} ${temporalCopy}?` : null;
}

const RADAR_PROVIDER_LABELS_ES = Object.freeze({
  "best multiplayer": "Mejor multijugador",
});

export function localizeRadarProviderLabel(value) {
  const original = cleanText(value, 300);
  const translated = RADAR_PROVIDER_LABELS_ES[normalizeComparableText(original)] ?? null;
  return {
    original,
    label: translated ?? original,
    translated: Boolean(translated),
    catalog_version: RADAR_PROVIDER_LABEL_CATALOG_VERSION,
  };
}

function awardOutcomePresentation(candidate) {
  const question = cleanText(candidate?.source_question ?? candidate?.atinara_question, 700)
    .replace(/^[¿\s]+|[?\s]+$/g, "");
  const match = question.match(/^will\s+(.+?)\s+win\s+(.+)$/i);
  if (!match || !/\b(?:award|awards|best|prize|premio)\b/i.test(match[2])) return null;
  const subject = cleanText(match[1], 240);
  const rawAward = cleanText(match[2], 300);
  const gameAwards = rawAward.match(/^(.+?)\s+at\s+the\s+(?:(20\d{2})\s+)?game\s+awards$/i);
  const localizedCategory = gameAwards ? localizeRadarProviderLabel(gameAwards[1]).label : null;
  const award = gameAwards
    ? `${localizedCategory} en The Game Awards${gameAwards[2] ? ` ${gameAwards[2]}` : ""}`
    : localizeRadarProviderLabel(rawAward).label;
  return subject && award ? `¿Ganará ${subject} el premio ${award}?` : null;
}

function radarGroupTitlePresentation(value) {
  const title = cleanText(value, 500);
  if (!title) return null;
  if (/^video\s+games?\s+released\s+this\s+year$/i.test(title)) {
    return "Videojuegos que se lanzarán este año";
  }
  const metric = title.match(/^(.+?)\s*:\s*(metacritic|metascore|opencritic|critic\s+score)\s*(?:score)?$/i);
  if (metric) return `${cleanText(metric[1], 300)} · Puntuación en ${/^opencritic$/i.test(metric[2]) ? "OpenCritic" : "Metacritic"}`;
  const cover = title.match(/^(.+?)\s*:\s*(?:cover\s+athlete|cover\s+star)$/i);
  if (cover) return `${cleanText(cover[1], 300)} · Atleta de portada`;
  const award = title.match(/^(the\s+game\s+awards)\s*:\s*(.+)$/i);
  if (award) return `The Game Awards · ${localizeRadarProviderLabel(award[2]).label}`;
  return null;
}

const RADAR_PRESENTATION_STRATEGIES = Object.freeze([
  (candidate) => {
    const selection = selectionPresentation(candidate?.source_question ?? candidate?.atinara_question);
    return selection ? `¿Aparecerá ${selection.name} en la portada de ${selection.subject}?` : null;
  },
  metricThresholdPresentation,
  releaseDeadlinePresentation,
  awardOutcomePresentation,
]);

// Normaliza únicamente arquetipos cuyo significado está explícito en el
// contrato del proveedor. Si falta una pieza, conserva la pregunta original.
export function normalizeRadarCandidatePresentation(candidate) {
  if (!isRecord(candidate)) return candidate;
  let question = null;
  for (const strategy of RADAR_PRESENTATION_STRATEGIES) {
    question = cleanText(strategy(candidate), 700);
    if (question) break;
  }
  const groupTitle = radarGroupTitlePresentation(candidate.source_title);
  return question || groupTitle
    ? {
      ...candidate,
      ...(question ? { atinara_question: question } : {}),
      ...(groupTitle ? { atinara_group_title: groupTitle } : {}),
      presentation_localization_version: RADAR_PROVIDER_LABEL_CATALOG_VERSION,
    }
    : candidate;
}

function selectionEntries(candidates) {
  const values = [];
  for (const candidate of Array.isArray(candidates) ? candidates : []) {
    values.push(candidate);
    const payload = familyProviderPayload(candidate);
    for (const child of Array.isArray(payload.canonical_event_children) ? payload.canonical_event_children : []) {
      if (isRecord(child)) values.push({ source_question: child.question });
    }
  }
  const seen = new Set();
  return values.map((candidate) => selectionQuestion(candidate?.source_question ?? candidate?.atinara_question))
    .filter(Boolean)
    .filter((item) => {
      const key = `${item.subject}:${item.name}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function inspectOfficialCoverEventResolution(candidates = [], evidence = []) {
  const parsed = selectionEntries(candidates);
  if (parsed.length < 2) return { selection_detected: false, selection_complete: false, evidence: [] };
  const subjectCounts = new Map();
  for (const item of parsed) subjectCounts.set(item.subject, (subjectCounts.get(item.subject) ?? 0) + 1);
  const subject = [...subjectCounts.entries()].sort((left, right) => right[1] - left[1])[0]?.[0];
  if (!subject || (subjectCounts.get(subject) ?? 0) < 2) return { selection_detected: false, selection_complete: false, evidence: [] };
  const subjectEntries = parsed.filter((item) => item.subject === subject);
  const contextComplete = (Array.isArray(candidates) ? candidates : []).some((candidate) => {
    const payload = familyProviderPayload(candidate);
    const children = Array.isArray(payload.canonical_event_children) ? payload.canonical_event_children : [];
    const total = safeNumber(payload.canonical_event_children_total);
    return payload.canonical_event_children_complete === true
      && Number.isInteger(total)
      && total > 0
      && children.length === total;
  });
  if (!contextComplete) return { selection_detected: false, selection_complete: false, evidence: [] };
  const platformScope = factualGroupPlatformScope({ candidates });
  if (platformScope.ambiguous) return { selection_detected: false, selection_complete: false, evidence: [] };
  const matchedNames = new Map();
  const relevantEvidence = [];
  const editionCoverage = new Set();
  let exhaustiveEvidence = false;
  let singularDesignation = false;
  for (const item of Array.isArray(evidence) ? evidence : []) {
    if (!isVerifiedOfficialEvidence(item, true)) continue;
    const text = normalizeComparableText(`${item.title ?? ""} ${item.supports ?? ""}`);
    const compactText = text.replace(/\s+/g, "");
    const compactSubject = subject.replace(/\s+/g, "");
    if (!text.includes(subject) && !compactText.includes(compactSubject)) continue;
    const definitive = /\b(cover star|cover stars|cover athlete|cover athletes|cover lineup|official cover|cover art|on the cover|portada oficial|atleta de portada|protagonista de portada)\b/.test(text)
      || /\b(?:standard|ultimate(?: plus)?|deluxe) edition key art\b/.test(text)
      || /\b(announce\w*|reveal\w*|present\w*|welcome\w*|anunci\w*|revel\w*|present\w*)\b.{0,180}\b(cover|portada)\b/.test(text)
      || /\b(cover|portada)\b.{0,180}\b(show\w*|feature\w*|star\w*|present\w*|muestra|incluye)\b/.test(text);
    if (!definitive) continue;
    const continuationCue = /\b(?:more|additional|other|remaining|regional|select markets?|later|coming soon|to be (?:announced|revealed)|mas adelante|más adelante|otras? portadas?|regional)\b/.test(text);
    const standardCoverScope = /\bstandard(?: edition)?\b.{0,100}\b(?:cover|portada)s?\b/.test(text)
      || /\b(?:cover|portada)s?\b.{0,100}\bstandard(?: edition)?\b/.test(text);
    const ultimatePlusCoverScope = /\bultimate plus(?: edition)?\b.{0,100}\b(?:cover|portada)s?\b/.test(text)
      || /\b(?:cover|portada)s?\b.{0,100}\bultimate plus(?: edition)?\b/.test(text);
    const ultimateCoverScope = /\bultimate edition\b.{0,100}\b(?:cover|portada)s?\b/.test(text)
      || /\b(?:cover|portada)s?\b.{0,100}\bultimate edition\b/.test(text);
    const completeEditionScope = standardCoverScope && ultimateCoverScope && ultimatePlusCoverScope;
    if (/\bstandard edition\b/.test(text) || standardCoverScope) editionCoverage.add("standard");
    if (/\bultimate plus edition\b/.test(text) || ultimatePlusCoverScope) editionCoverage.add("ultimate_plus");
    if (/\bultimate edition\b/.test(text.replace(/\bultimate plus edition\b/g, " "))) editionCoverage.add("ultimate");
    if (ultimateCoverScope) editionCoverage.add("ultimate");
    if (/\bdeluxe edition\b/.test(text)) editionCoverage.add("deluxe");
    for (const edition of Array.isArray(item.selection_editions) ? item.selection_editions : []) {
      if (["standard", "ultimate", "ultimate_plus", "deluxe"].includes(edition)) editionCoverage.add(edition);
    }
    const exhaustive = !continuationCue && (
      /\b(?:complete|full|entire|all)\b.{0,90}\b(?:cover|portada|lineup|selection|seleccion)\b/.test(text)
      || /\b(?:cover|portada|lineup|selection|seleccion)\b.{0,90}\b(?:complete|full|entire|all)\b/.test(text)
      || completeEditionScope
    );
    const sentenceWindows = cleanText(`${item.title ?? ""}. ${item.supports ?? ""}`, 4_000)
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
      .split(/(?<=[.!?])\s+/).map(normalizeComparableText).filter(Boolean);
    const windows = [text, ...sentenceWindows];
    for (const term of ["cover", "portada", "key art", "welcome", "announc", "reveal"]) {
      let index = text.indexOf(term);
      while (index >= 0) {
        windows.push(text.slice(Math.max(0, index - 240), index + 280));
        index = text.indexOf(term, index + term.length);
      }
    }
    for (const candidate of subjectEntries) {
      const matchedWindows = windows.filter((window) =>
        (window.includes(subject) || window.replace(/\s+/g, "").includes(compactSubject))
        && window.includes(candidate.name)
        && factualTerminalMatchesPlatformScope(window, platformScope.platforms));
      if (matchedWindows.length) {
        matchedNames.set(candidate.name, candidate.name);
        exhaustiveEvidence ||= exhaustive;
        singularDesignation ||= !continuationCue && matchedWindows.some((window) =>
          /\b(?:named|announced|revealed|presented|featuring|features|with|has|is)\b.{0,120}\b(?:official )?cover athlete\b/.test(window)
          || /\b(?:official )?cover athlete\b.{0,120}\b(?:named|announced|revealed|presented|featured|is)\b/.test(window)
          || /\b(?:featuring|features|with)\b.{0,80}\b(?:cover|portada)\b/.test(window));
        if (!relevantEvidence.some((evidenceItem) => evidenceItem.url === item.url)) {
          relevantEvidence.push({
            ...item,
            supported_reason_codes: [RADAR_REASON_CODES.EVENT_ALREADY_RESOLVED],
            supported_fact_statuses: ["fully_resolved"],
          });
        }
      }
    }
  }
  // Una designación oficial del rol ("named cover athlete") satisface por sí
  // misma un contrato que admite anuncio o aparición. La mera imagen de una
  // edición sigue necesitando cobertura completa de las ediciones aplicables.
  exhaustiveEvidence ||= singularDesignation
    || (["standard", "ultimate", "ultimate_plus"].every((edition) => editionCoverage.has(edition)))
    || (["standard", "deluxe"].every((edition) => editionCoverage.has(edition)));
  const selectionDetected = matchedNames.size >= 1 && relevantEvidence.length > 0;
  if (!selectionDetected || !exhaustiveEvidence) {
    return {
      selection_detected: selectionDetected,
      selection_complete: false,
      evidence: relevantEvidence.slice(0, 6),
    };
  }
  const outcomeNames = [...matchedNames.values()].map((name) => name.split(" ").map((part) => part ? part[0].toUpperCase() + part.slice(1) : part).join(" "));
  return {
    selection_detected: true,
    winner_name: outcomeNames[0],
    outcome_names: outcomeNames,
    selection_complete: true,
    fact_status: "fully_resolved",
    evidence: relevantEvidence.slice(0, 6).map((item) => ({ ...item, selection_complete: true })),
  };
}

export function detectOfficialCoverEventResolution(candidates = [], evidence = []) {
  const inspection = inspectOfficialCoverEventResolution(candidates, evidence);
  return inspection.selection_complete === true ? inspection : null;
}

export function detectOfficialCoverSelectionHold(candidates = [], evidence = []) {
  const inspection = inspectOfficialCoverEventResolution(candidates, evidence);
  return inspection.selection_detected === true && inspection.selection_complete !== true
    ? inspection
    : null;
}

export function buildCoverResolutionSignals(candidates = [], now = new Date().toISOString()) {
  const signals = [];
  for (const group of groupCandidates(candidates)) {
    const title = normalizeComparableText(group.title);
    if (!/\bcover\b|\bportada\b/.test(title) || group.candidates.length < 2) continue;
    const resolved = group.candidates.filter((candidate) => candidate.verification_status === "rejected_resolved"
      && (safeNumber(candidate.verification_confidence) ?? 0) >= 85
      && Array.isArray(candidate.verification_evidence)
      && candidate.verification_evidence.some((item) => isVerifiedOfficialEvidence(item, true) && item.selection_complete === true));
    if (!resolved.length) continue;
    const evidenceByUrl = new Map();
    for (const candidate of resolved) {
      for (const item of candidate.verification_evidence) {
        const url = isRecord(item) ? safePublicUrl(item.url) : null;
        if (url && isVerifiedOfficialEvidence(item, true) && item.selection_complete === true && !evidenceByUrl.has(url)) evidenceByUrl.set(url, item);
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
        selection_complete: true,
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

// Puerta operativa vigente: un mercado futuro y abierto no necesita demostrar
// que su resultado sigue siendo desconocido. Solo una señal canónica o una
// evidencia oficial terminal puede cerrarlo.
/**
 * @param {Record<string, any>} candidate
 * @param {Record<string, any> | null} [decision]
 * @param {string} [now]
 */
export function applyDeterministicRadarEligibility(candidate, decision = null, now = new Date().toISOString()) {
  const code = cleanText(decision?.reason_code, 100) || null;
  const eligible = !decision || decision.eligible !== false;
  const retryableHold = code === RADAR_REASON_CODES.RESOLUTION_SOURCE_AUTHORITY_PENDING
    || code === RADAR_REASON_CODES.OFFICIAL_TERMINAL_SCAN_UNAVAILABLE
    || code === RADAR_REASON_CODES.OFFICIAL_SELECTION_RECHECK_REQUIRED
    || code === RADAR_REASON_CODES.VERIFICATION_REQUIRED
    || code === RADAR_REASON_CODES.VERIFICATION_EXPIRED
    || code === RADAR_REASON_CODES.GAMING_DOMAIN_REVIEW_REQUIRED
    || code === RADAR_REASON_CODES.PROVIDER_PLACEHOLDER
    || code === RADAR_REASON_CODES.PROVIDER_CHILD_IDENTITY_RESOLUTION_REQUIRED
    || code === RADAR_REASON_CODES.RADAR_PARENT_RECONCILIATION_INCOMPLETE
    || code === RADAR_REASON_CODES.PROVIDER_PARENT_COUNT_INCONSISTENT;
  const status = eligible ? "verified_open"
    : code === RADAR_REASON_CODES.EVENT_ALREADY_RESOLVED ? "rejected_resolved"
      : code === RADAR_REASON_CODES.DUPLICATE_MARKET ? "rejected_duplicate"
        : [RADAR_REASON_CODES.INVALID_OR_UNVERIFIED_SOURCE, RADAR_REASON_CODES.PROVIDER_EVENT_NOT_FOUND, RADAR_REASON_CODES.PROVIDER_CHILD_NOT_FOUND].includes(code) ? "rejected_invalid_source"
          : retryableHold ? "needs_review"
            : "rejected_ineligible";
  const eligibilityStatus = eligible ? "eligible"
    : code === RADAR_REASON_CODES.EVENT_ALREADY_RESOLVED ? "terminal"
      : code === RADAR_REASON_CODES.DUPLICATE_MARKET ? "duplicate"
        : code === RADAR_REASON_CODES.PROVIDER_OPTION_INACTIVE || code === RADAR_REASON_CODES.PROVIDER_NOT_OPEN ? "inactive_option"
          : [RADAR_REASON_CODES.INVALID_OR_UNVERIFIED_SOURCE, RADAR_REASON_CODES.PROVIDER_EVENT_NOT_FOUND, RADAR_REASON_CODES.PROVIDER_CHILD_NOT_FOUND].includes(code) ? "invalid"
            : retryableHold ? "technical_hold"
              : "terminal";
  const evidence = Array.isArray(decision?.evidence)
    ? decision.evidence.filter(isRecord).slice(0, 12)
    : [];
  const reason = eligible
    ? "Mercado futuro, abierto y sin bloqueo terminal determinista."
    : cleanText(decision?.reason, 1_000) || (code ? reasonCopy(code) : "La candidata no es elegible.");
  return {
    ...candidate,
    verification_status: status,
    verification_reason_code: eligible ? null : code,
    verification_reason: reason,
    verified_at: now,
    verification_expires_at: verificationExpiry(now, safeNumber(decision?.ttl_minutes) ?? 360),
    verification_evidence: evidence,
    verification_confidence: eligible ? 100 : Math.max(0, Math.min(100, safeNumber(decision?.confidence) ?? 100)),
    quality_status: eligible ? "fit" : retryableHold ? "needs_review" : "rejected",
    state: candidate?.state === "dismissed"
      ? "dismissed"
      : retryableHold ? "needs_review"
        : eligible && candidate?.state === "prepared"
          ? "prepared"
          : eligible ? "available" : "rejected",
    eligibility_status: eligibilityStatus,
    eligibility_reason_code: eligible ? null : code,
    eligibility_reason: reason,
    eligibility_checked_at: now,
    eligibility_expires_at: verificationExpiry(now, safeNumber(decision?.ttl_minutes) ?? 360),
    eligibility_policy_version: RADAR_ELIGIBILITY_POLICY_VERSION,
    eligibility_evidence: evidence,
    fact_status: null,
    fact_checked_at: null,
    fact_check_expires_at: null,
    fact_check_purpose: null,
    current_fact_check_id: null,
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
    const evidence = Array.isArray(resolution.evidence)
      ? resolution.evidence.filter((item) => isRecord(item) && isVerifiedTerminalEvidence(item))
      : [];
    const confidence = Math.max(0, Math.min(100, safeNumber(resolution.confidence) ?? 0));
    if (!eventGroupKey || !candidateIdentity || !safeIsoDate(resolution.resolved_at)
        || resolution.selection_complete !== true || !evidence.length || confidence < 85) continue;
    if (!signalsByGroup.has(eventGroupKey)) signalsByGroup.set(eventGroupKey, new Map());
    const signals = signalsByGroup.get(eventGroupKey);
    const current = signals.get(candidateIdentity);
    if (!current || confidence > current.confidence) signals.set(candidateIdentity, { ...resolution, evidence, confidence });
  }
  const resolvedGroups = new Map();
  for (const [eventGroupKey, signals] of signalsByGroup.entries()) {
    const groupSize = groupSizes.get(eventGroupKey) ?? 0;
    const selectionComplete = [...signals.values()].some((signal) => signal.selection_complete === true);
    if (!selectionComplete || groupSize < 1) continue;
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

export function buildRadarFactCheck(candidate) {
  if (!isRecord(candidate) || !cleanText(candidate.provider, 40) || !cleanText(candidate.external_id, 220)) return null;
  const evidence = Array.isArray(candidate.verification_evidence) ? candidate.verification_evidence.filter(isRecord).slice(0, 20) : [];
  const factStatus = cleanText(candidate.fact_status, 40) || "unknown";
  return {
    provider: cleanText(candidate.provider, 40),
    external_id: cleanText(candidate.external_id, 220),
    event_group_key: cleanText(candidate.event_group_key, 240) || null,
    fact_context_fingerprint: cleanText(candidate.fact_context_fingerprint, 120) || cleanText(candidate.fingerprint, 120),
    fact_policy_version: cleanText(candidate.fact_policy_version, 100) || RADAR_FACT_POLICY_VERSION,
    fact_status: factStatus,
    verification_status: cleanText(candidate.verification_status, 80),
    reason_code: cleanText(candidate.verification_reason_code, 100) || null,
    reason: cleanText(candidate.verification_reason, 1_000) || null,
    confidence: Math.max(0, Math.min(100, safeNumber(candidate.verification_confidence) ?? 0)),
    evidence,
    checked_at: safeIsoDate(candidate.fact_checked_at ?? candidate.verified_at) ?? new Date().toISOString(),
    decision_hash: stableFingerprint(
      RADAR_FACT_POLICY_VERSION,
      factStatus,
      candidate.verification_status,
      candidate.verification_reason_code,
      JSON.stringify(evidence),
    ),
  };
}

export function isAdaptedIdeaComplete(candidate) {
  const sourceUrl = safePublicUrl(candidate.atinara_resolution_source_url ?? candidate.source_resolution_url);
  const evidence = [
    ...(Array.isArray(candidate.resolution_source_evidence) ? candidate.resolution_source_evidence : []),
    ...(Array.isArray(candidate.eligibility_evidence) ? candidate.eligibility_evidence : []),
    ...(Array.isArray(candidate.verification_evidence) ? candidate.verification_evidence : []),
  ];
  const sourceProven = Boolean(sourceUrl && evidence.some((item) => (
    safePublicUrl(item?.url) === sourceUrl && exactResolutionEvidence(candidate, item)
  )));
  return Boolean(cleanText(candidate.atinara_question, 700)
    && RADAR_CATEGORIES.includes(candidate.atinara_category)
    && cleanText(candidate.atinara_resolution_criteria, 5000)
    && sourceProven);
}

export function buildDraftPrefill(candidate) {
  const family = deriveMarketFamily(candidate);
  const temporal = isRecord(candidate?.temporal_contract) ? candidate.temporal_contract : {};
  const sourceUrl = safePublicUrl(candidate.atinara_resolution_source_url ?? candidate.source_resolution_url);
  const question = cleanText(candidate.atinara_question ?? candidate.source_question, 700);
  const criteria = cleanText(candidate.atinara_resolution_criteria, 5000);
  const evaluationEndsAt = safeIsoDate(temporal.evaluation_ends_at);
  const resolutionDeadline = safeIsoDate(temporal.resolution_deadline);
  const timezone = cleanText(temporal.timezone, 100);
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
    evaluation_ends_at: evaluationEndsAt || "",
    timezone,
    resolution_deadline: resolutionDeadline || "",
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
    family,
    fields,
    origins,
    warnings: [...new Set([
      ...(candidate.warnings ?? []),
      ...(Array.isArray(temporal.anomaly_codes) ? temporal.anomaly_codes : []),
    ])],
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
      eligibility_policy_version: candidate.eligibility_policy_version,
      eligibility_status: candidate.eligibility_status,
      eligibility_check_id: candidate.current_eligibility_check_id,
      eligibility_checked_at: candidate.eligibility_checked_at,
      eligibility_expires_at: candidate.eligibility_expires_at,
      verification_status: candidate.verification_status,
      verification_reason_code: candidate.verification_reason_code,
      verified_at: candidate.verified_at,
      family_key: family?.family_key ?? null,
      family_child_key: family?.family_child_key ?? null,
      family_relationship: candidate.family_relationship ?? family?.family_relationship ?? "standalone",
      family_version: family?.family_version ?? RADAR_FAMILY_VERSION,
      temporal_contract: isRecord(candidate.temporal_contract) ? candidate.temporal_contract : null,
      workflow_issues: Array.isArray(candidate.workflow_issues) ? candidate.workflow_issues : [],
    },
  };
}

export function buildCacheKey(filters = {}) {
  const provider = RADAR_PROVIDERS.includes(filters.provider) ? filters.provider : "all";
  const category = RADAR_CATEGORIES.includes(filters.category) ? filters.category : "all";
  const query = normalizeComparableText(filters.query ?? "").slice(0, 80) || "all";
  const horizon = cleanText(filters.horizon, 40) || "all";
  return `${RADAR_NORMALIZER_VERSION}:${RADAR_ELIGIBILITY_POLICY_VERSION}:${provider}:${category}:${query}:${horizon}`;
}

export function publicProviderError(provider, code, status = 502) {
  const safeProvider = RADAR_PROVIDERS.includes(provider) ? provider : "radar";
  const safeCode = cleanText(code, 100) || "PROVIDER_FAILED";
  const messages = {
    PROVIDER_NOT_CONFIGURED: "El proveedor no está configurado. El resto del Radar continúa disponible.",
    PROVIDER_RATE_LIMITED: "El proveedor ha limitado temporalmente las consultas.",
    PROVIDER_INVALID_RESPONSE: "El proveedor devolvió una respuesta que no se pudo validar.",
    PROVIDER_TIMEOUT: "El proveedor tardó demasiado en responder.",
    RADAR_PERSISTENCE_TIMEOUT: "La escritura de este proveedor superó el tiempo disponible. Los demás proveedores y los lotes ya validados siguen disponibles.",
    RADAR_PERSISTENCE_FAILED: "No se pudo guardar este proveedor. Los demás proveedores y los lotes ya validados siguen disponibles.",
    RADAR_CANDIDATES_QUARANTINED: "Algunas candidatas no superaron la validación autoritativa. Las filas sanas siguen disponibles.",
    RADAR_PERSISTENCE_ISOLATION_DEFERRED: "El aislamiento alcanzó su límite seguro. Los lotes confirmados siguen disponibles y el resto queda diferido.",
  };
  return { provider: safeProvider, code: safeCode, status, message: messages[safeCode] ?? "No se pudo actualizar este proveedor. Puedes reintentarlo más tarde." };
}
