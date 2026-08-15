import { canonicalJson, sha256Hex } from "../ai/contracts.mjs";
import {
  normalizePrimarySourceRegistry,
  primarySourceRegistryEntry,
  safePublicUrl,
} from "../market-draft-repair.mjs";
import { classifyMarketRelations } from "../market-radar.mjs";
import {
  MARKET_INTELLIGENCE_POLICY_VERSION,
  SOURCE_CONTRACT_SCHEMA_VERSION,
} from "./constitution.mjs";
import { inspectPromptInjection, sanitizeExternalText } from "./prompt-safety.mjs";
import { validateResolutionContract } from "./resolution-contract.mjs";

export const ATINARA_OFFICIAL_OPPORTUNITY_DISCOVERY_VERSION = "atinara-official-opportunity-discovery-v1";
export const OFFICIAL_OPPORTUNITY_PROVIDER = "official_web";
export const OFFICIAL_OPPORTUNITY_CATEGORIES = Object.freeze([
  "Lanzamientos",
  "Eventos",
  "Industria",
  "Streamers",
  "Reviews/Premios",
  "YouTubers",
]);
export const OFFICIAL_OPPORTUNITY_HORIZONS = Object.freeze([30, 90, 180, 365]);

const MAX_DOCUMENTS = 8;
export const OFFICIAL_OPPORTUNITY_MAX_STRUCTURED_NODES_PER_DOCUMENT = 128;
const MIN_LEAD_TIME_MS = 48 * 60 * 60 * 1_000;
const SENSITIVE_QUERY = /(?:\b(?:api[_-]?key|authorization|bearer|password|secret|service[_-]?role|token)\b|\beyJ[a-zA-Z0-9_-]{12,}\.[a-zA-Z0-9_-]{8,}\.|\b(?:sk|sb_secret)_[a-zA-Z0-9_-]{12,}\b|[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})/i;
const STOP_WORDS = new Set([
  "antes", "despues", "desde", "evento", "eventos", "fecha", "fechas", "futuro", "futuros",
  "juego", "juegos", "oficial", "oficiales", "para", "sobre", "hasta", "the", "and", "with",
]);

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function cleanText(value, max = 4_000) {
  return sanitizeExternalText(value, max);
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function compareUtf16(left, right) {
  const commonLength = Math.min(left.length, right.length);
  for (let index = 0; index < commonLength; index += 1) {
    const difference = left.charCodeAt(index) - right.charCodeAt(index);
    if (difference !== 0) return difference;
  }
  return left.length - right.length;
}

function comparable(value) {
  return cleanText(value, 500)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function relevantTokens(value) {
  return comparable(value).split(/\s+/).filter((token) => token.length > 2 && !STOP_WORDS.has(token));
}

function assertTimezone(timezone) {
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(new Date(0));
    return timezone;
  } catch {
    throw new Error("OFFICIAL_DISCOVERY_TIMEZONE_INVALID");
  }
}

export async function readBoundedUtf8Response(response, maxBytes) {
  const limit = Number(maxBytes);
  if (!Number.isSafeInteger(limit) || limit < 1) throw new Error("OFFICIAL_SOURCE_RESPONSE_LIMIT_INVALID");
  const announcedLength = Number(response.headers.get("content-length") || 0);
  if (Number.isFinite(announcedLength) && announcedLength > limit) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error("OFFICIAL_SOURCE_RESPONSE_TOO_LARGE");
  }
  if (!response.body) return "";

  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) {
        await reader.cancel("OFFICIAL_SOURCE_RESPONSE_TOO_LARGE").catch(() => undefined);
        throw new Error("OFFICIAL_SOURCE_RESPONSE_TOO_LARGE");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

export function normalizeOfficialOpportunityRequest(value) {
  if (!isRecord(value)) throw new Error("OFFICIAL_DISCOVERY_REQUEST_INVALID");
  const inspected = inspectPromptInjection(value.query);
  const query = inspected.safe_text.slice(0, 200);
  if (query.length < 3) throw new Error("OFFICIAL_DISCOVERY_QUERY_REQUIRED");
  if (inspected.suspicious) throw new Error("OFFICIAL_DISCOVERY_QUERY_UNSAFE");
  if (SENSITIVE_QUERY.test(query)) throw new Error("OFFICIAL_DISCOVERY_QUERY_SENSITIVE");
  const category = cleanText(value.category, 100);
  if (!OFFICIAL_OPPORTUNITY_CATEGORIES.includes(category)) {
    throw new Error("OFFICIAL_DISCOVERY_CATEGORY_INVALID");
  }
  const horizonDays = Number(value.horizon_days ?? value.horizonDays ?? 180);
  if (!OFFICIAL_OPPORTUNITY_HORIZONS.includes(horizonDays)) {
    throw new Error("OFFICIAL_DISCOVERY_HORIZON_INVALID");
  }
  const timezone = assertTimezone(cleanText(value.timezone, 100) || "Europe/Madrid");
  const maxResults = Math.min(Math.max(Number(value.max_results ?? value.maxResults) || 5, 1), MAX_DOCUMENTS);
  return Object.freeze({ query, category, horizonDays, timezone, maxResults });
}

function zonedDateTimeIso(year, month, day, hour, minute, second, timezone) {
  const requestedUtc = Date.UTC(year, month - 1, day, hour, minute, second, 0);
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const candidates = [];
  for (let offsetMinutes = -14 * 60; offsetMinutes <= 14 * 60; offsetMinutes += 15) {
    const candidate = new Date(requestedUtc - offsetMinutes * 60_000);
    const represented = Object.fromEntries(formatter.formatToParts(candidate).map((part) => [part.type, part.value]));
    if (Number(represented.year) === year && Number(represented.month) === month
      && Number(represented.day) === day && Number(represented.hour) === hour
      && Number(represented.minute) === minute && Number(represented.second) === second) {
      candidates.push(candidate.toISOString());
    }
  }
  const exact = unique(candidates);
  return exact.length === 1 ? exact[0] : null;
}

function parseFutureDate(value, timezone) {
  const raw = cleanText(value, 120);
  const dateOnly = raw.match(/^(20\d{2})-(\d{2})-(\d{2})$/);
  if (dateOnly) {
    const iso = zonedDateTimeIso(Number(dateOnly[1]), Number(dateOnly[2]), Number(dateOnly[3]), 23, 59, 59, timezone);
    return iso ? { iso, granularity: "day", raw } : null;
  }
  const local = raw.match(/^(20\d{2})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (local) {
    const iso = zonedDateTimeIso(
      Number(local[1]), Number(local[2]), Number(local[3]),
      Number(local[4]), Number(local[5]), Number(local[6] || 0), timezone,
    );
    return iso ? { iso, granularity: "instant", raw } : null;
  }
  const instant = raw && /(?:Z|[+-]\d{2}:?\d{2})$/i.test(raw) ? new Date(raw) : null;
  return instant && Number.isFinite(instant.getTime())
    ? { iso: instant.toISOString(), granularity: "instant", raw }
    : null;
}

function jsonLdValues(html) {
  const values = [];
  const pattern = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
  for (const match of String(html || "").matchAll(pattern)) {
    if (!/\btype\s*=\s*["']application\/ld\+json["']/i.test(match[1])) continue;
    const source = match[2].trim();
    if (!source || source.length > 250_000) continue;
    try {
      values.push(JSON.parse(source));
    } catch {
      // Un bloque JSON-LD roto no degrada otros bloques válidos de la página.
    }
    if (values.length >= 32) break;
  }
  return values;
}

function flattenJsonLd(value, output = [], depth = 0) {
  if (depth > 8 || output.length >= 128) return output;
  if (Array.isArray(value)) {
    for (const item of value) flattenJsonLd(item, output, depth + 1);
    return output;
  }
  if (!isRecord(value)) return output;
  output.push(value);
  if (Array.isArray(value["@graph"])) flattenJsonLd(value["@graph"], output, depth + 1);
  return output;
}

function structuredKind(value) {
  const types = (Array.isArray(value?.["@type"]) ? value["@type"] : [value?.["@type"]])
    .map((type) => cleanText(type, 80).toLowerCase())
    .filter(Boolean);
  if (types.some((type) => type === "event" || type.endsWith("event"))) return "event";
  if (types.some((type) => ["product", "videogame", "softwareapplication"].includes(type))) return "release";
  return null;
}

function queryMatchesSubject(query, subject) {
  const queryTokens = relevantTokens(query);
  if (!queryTokens.length) return true;
  const subjectTokens = new Set(relevantTokens(subject));
  return queryTokens.some((token) => subjectTokens.has(token));
}

function rejectedStatus(value) {
  const status = cleanText(value, 160).toLowerCase();
  return /(?:cancelled|canceled|postponed|rescheduled)/.test(status);
}

export function extractStructuredOfficialOpportunities({ html, sourceUrl, contentSha256 = null, registry, request, now = new Date() }) {
  const safeUrl = safePublicUrl(sourceUrl);
  const entry = safeUrl ? primarySourceRegistryEntry(safeUrl, registry, request.category) : null;
  if (!safeUrl || !entry) {
    return { candidates: [], rejections: [{ code: "OFFICIAL_SOURCE_NOT_REGISTERED", source_url: safeUrl }] };
  }
  const horizonAt = now.getTime() + request.horizonDays * 86_400_000;
  const candidates = [];
  const rejections = [];
  const structuredValues = [];
  for (const item of jsonLdValues(html)) {
    flattenJsonLd(item, structuredValues);
    if (structuredValues.length >= OFFICIAL_OPPORTUNITY_MAX_STRUCTURED_NODES_PER_DOCUMENT) break;
  }
  for (const value of structuredValues) {
    const kind = structuredKind(value);
    if (!kind) continue;
    const subjectInspection = inspectPromptInjection(value.name || value.headline);
    const subject = subjectInspection.safe_text.slice(0, 300);
    const dateValue = kind === "event" ? value.startDate : value.releaseDate;
    const deadline = parseFutureDate(dateValue, request.timezone);
    let rejectionCode = null;
    if (!subject || subjectInspection.suspicious) rejectionCode = "OFFICIAL_EVENT_SUBJECT_INVALID";
    else if (!queryMatchesSubject(request.query, subject)) rejectionCode = "OFFICIAL_EVENT_QUERY_MISMATCH";
    else if (rejectedStatus(value.eventStatus)) rejectionCode = "OFFICIAL_EVENT_NOT_SCHEDULED";
    else if (!deadline) rejectionCode = "OFFICIAL_EVENT_DATE_INVALID";
    else if (new Date(deadline.iso).getTime() < now.getTime() + MIN_LEAD_TIME_MS) rejectionCode = "OFFICIAL_EVENT_TOO_CLOSE_OR_RESOLVED";
    else if (new Date(deadline.iso).getTime() > horizonAt) rejectionCode = "OFFICIAL_EVENT_OUTSIDE_HORIZON";
    if (rejectionCode) {
      rejections.push({ code: rejectionCode, source_url: safeUrl });
      continue;
    }
    const descriptionInspection = inspectPromptInjection(value.description);
    candidates.push({
      kind,
      subject,
      description: descriptionInspection.suspicious ? "" : descriptionInspection.safe_text.slice(0, 4_000),
      deadline: deadline.iso,
      dateGranularity: deadline.granularity,
      rawDate: deadline.raw,
      sourceUrl: safeUrl,
      registryEntry: entry,
      contentSha256,
      policyFlags: descriptionInspection.reason_codes,
    });
  }
  return { candidates, rejections };
}

function spanishDeadline(value, timezone, granularity) {
  const options = granularity === "day"
    ? { dateStyle: "long", timeZone: timezone }
    : { dateStyle: "long", timeStyle: "short", timeZone: timezone };
  return new Intl.DateTimeFormat("es-ES", options).format(new Date(value));
}

function opportunityCopy(kind, subject, deadlineLabel, timezone) {
  if (kind === "release") {
    return {
      question: `¿Se lanzará oficialmente ${subject} no más tarde del ${deadlineLabel} (${timezone})?`,
      yes: `Sí si la fuente principal oficial confirma que ${subject} quedó disponible públicamente como lanzamiento oficial no más tarde del final exacto del periodo indicado. Una reserva, preventa, anuncio o acceso no público no cuentan como lanzamiento.`,
      no: `No si al finalizar el periodo indicado ${subject} no se ha lanzado oficialmente y de forma pública según la fuente principal, incluida una cancelación definitiva o un aplazamiento más allá del corte.`,
      edge: `Un acceso anticipado solo cuenta si la fuente oficial lo denomina lanzamiento público del producto evaluado. Betas, demos, filtraciones, preventas y anuncios no cuentan. Un cambio de nombre cuenta únicamente si la continuidad oficial del mismo producto es inequívoca.`,
      opportunityType: "official_release_deadline",
      signalType: "official_future_release",
      entityType: "official_product",
    };
  }
  return {
    question: `¿Comenzará oficialmente ${subject} no más tarde del ${deadlineLabel} (${timezone})?`,
    yes: `Sí si la fuente principal oficial confirma que ${subject} comenzó efectivamente no más tarde del instante exacto indicado. El horario anunciado por sí solo no demuestra que el evento haya comenzado.`,
    no: `No si al vencer el instante indicado no existe confirmación oficial de que ${subject} haya comenzado, o si fue cancelado definitivamente o aplazado más allá del corte.`,
    edge: `Un retraso solo conserva el Sí si el comienzo efectivo ocurre antes o en el corte. Una retransmisión previa, cuenta atrás, filtración o anuncio no equivale al comienzo. Un cambio de nombre cuenta si la organización oficial confirma continuidad inequívoca del mismo evento.`,
    opportunityType: "official_event_deadline",
    signalType: "official_future_event",
    entityType: "official_event",
  };
}

function relationMatches(relations) {
  return [...relations.duplicates, ...relations.siblings, ...relations.ambiguous].slice(0, 20);
}

function eventGroupKey(candidate) {
  return `${candidate.kind}:${comparable(candidate.subject)}:${candidate.deadline}`;
}

async function buildSignal(group, request, existingDefinitions, now) {
  const sources = [...group]
    .sort((left, right) => compareUtf16(left.sourceUrl, right.sourceUrl))
    .filter((item, index, values) => values.findIndex((candidate) => (
      candidate.registryEntry.id || `${candidate.registryEntry.provider}:${candidate.registryEntry.canonical_domain}`
    ) === (
      item.registryEntry.id || `${item.registryEntry.provider}:${item.registryEntry.canonical_domain}`
    )) === index);
  const primary = sources[0];
  const deadlineLabel = spanishDeadline(primary.deadline, request.timezone, primary.dateGranularity);
  const copy = opportunityCopy(primary.kind, primary.subject, deadlineLabel, request.timezone);
  const fingerprintPayload = {
    version: ATINARA_OFFICIAL_OPPORTUNITY_DISCOVERY_VERSION,
    kind: primary.kind,
    subject: comparable(primary.subject),
    deadline: primary.deadline,
  };
  const sourceFingerprint = await sha256Hex(canonicalJson(fingerprintPayload));
  const resolutionDeadline = new Date(new Date(primary.deadline).getTime() + 72 * 60 * 60 * 1_000).toISOString();
  const contractSources = sources.slice(0, 8).map((source, index) => ({
    provider: source.registryEntry.provider || OFFICIAL_OPPORTUNITY_PROVIDER,
    url: source.sourceUrl,
    role: index === 0 ? "PRIMARY_RESOLUTION" : "CORROBORATION",
    precedence: index + 1,
    required: index === 0,
    registry_source_id: source.registryEntry.id,
    parser_version: source.registryEntry.parser_version,
  }));
  const contract = {
    version: ATINARA_OFFICIAL_OPPORTUNITY_DISCOVERY_VERSION,
    contract_schema_version: SOURCE_CONTRACT_SCHEMA_VERSION,
    policy_version: MARKET_INTELLIGENCE_POLICY_VERSION,
    canonical_statement: copy.question,
    opportunity_type: copy.opportunityType,
    event_name: primary.subject,
    official_event_url: primary.sourceUrl,
    provider: OFFICIAL_OPPORTUNITY_PROVIDER,
    provider_adapter_version: ATINARA_OFFICIAL_OPPORTUNITY_DISCOVERY_VERSION,
    entity_type: copy.entityType,
    entity_id: sourceFingerprint,
    canonical_url: primary.sourceUrl,
    metric: null,
    operator: "exact_state",
    threshold: null,
    unit: null,
    precision: primary.dateGranularity,
    window_start: now.toISOString(),
    window_end: primary.deadline,
    evaluation_at: primary.deadline,
    resolution_deadline: resolutionDeadline,
    timezone: request.timezone,
    finality_delay_seconds: 300,
    capture_strategy: "manual_official_source",
    sampling_interval_seconds: 0,
    required_samples: 1,
    aggregation: "exact_state",
    maximum_monitor_duration_seconds: 0,
    missing_data_treatment: "manual_review_no_assumption",
    cancellation_treatment: "resolve_no_if_definitive_before_cutoff",
    postponement_treatment: "preserve_approved_period",
    source_conflict_treatment: "pause_and_human_review",
    sources: contractSources,
  };
  const relations = classifyMarketRelations({
    provider: OFFICIAL_OPPORTUNITY_PROVIDER,
    external_id: sourceFingerprint,
    question: copy.question,
    atinara_question: copy.question,
    source_question: copy.question,
    source_close_at: primary.deadline,
    title: primary.subject,
    yes_option: "Sí",
  }, existingDefinitions);
  const duplicateMatches = relationMatches(relations);
  const reasonCodes = validateResolutionContract(contract, now).map((issue) => issue.code);
  if (sources.length < 2) reasonCodes.push("ALTERNATIVE_OFFICIAL_SOURCE_REQUIRED");
  if (relations.duplicates.length) reasonCodes.push("DUPLICATE_MARKET");
  if (relations.ambiguous.length) reasonCodes.push("FAMILY_IDENTITY_AMBIGUOUS");
  const finalReasons = unique(reasonCodes);
  const marketabilityStatus = relations.duplicates.length
    ? "duplicate"
    : finalReasons.length ? "needs_review" : "useful";
  return {
    provider: OFFICIAL_OPPORTUNITY_PROVIDER,
    signal_type: copy.signalType,
    entity_type: copy.entityType,
    entity_id: sourceFingerprint,
    canonical_url: primary.sourceUrl,
    title: primary.subject,
    subtitle: `Fuente oficial registrada · ${deadlineLabel}`,
    description: primary.description || `Acontecimiento futuro estructurado publicado por ${primary.registryEntry.source_name}.`,
    atinara_category: request.category,
    observed_at: now.toISOString(),
    valid_until: new Date(new Date(primary.deadline).getTime() + 7 * 86_400_000).toISOString(),
    signal_origin: "registered_official_source",
    opportunity_type: copy.opportunityType,
    context_type: "official_structured_event",
    catalyst_type: primary.kind === "release" ? "official_release_date" : "official_event_date",
    factual_basis: `${primary.registryEntry.source_name} declara ${primary.subject} para ${deadlineLabel} (${request.timezone}). La fecha publicada es un dato oficial programado, no la prueba anticipada de que el hecho ocurrirá.`,
    contextual_basis: sources.length > 1
      ? `${sources.length - 1} fuente(s) oficial(es) registrada(s) adicional(es) publican el mismo sujeto y corte.`
      : "No se ha localizado todavía una segunda fuente oficial registrada para corroboración.",
    inference_summary: "Atinara construyó de forma determinista un contrato binario editable; no utilizó una inferencia de modelo ni creó un borrador.",
    market_thesis: "El hecho permanece futuro y su cumplimiento puede comprobarse contra un corte exacto y fuentes declaradas antes del resultado.",
    why_now: `La fuente oficial publica un acontecimiento dentro del horizonte administrativo de ${request.horizonDays} días.`,
    unresolved_question: copy.question,
    suggested_market_type: "binary_official_deadline",
    time_window_start: now.toISOString(),
    time_window_end: primary.deadline,
    source_payload_excerpt: {
      version: ATINARA_OFFICIAL_OPPORTUNITY_DISCOVERY_VERSION,
      registry_source_id: primary.registryEntry.id,
      registry_domain: primary.registryEntry.canonical_domain,
      parser_version: primary.registryEntry.parser_version,
      content_sha256: primary.contentSha256,
      kind: primary.kind,
      raw_value: primary.rawDate,
    },
    source_fingerprint: sourceFingerprint,
    marketability_status: marketabilityStatus,
    marketability_reason_codes: finalReasons,
    resolution_readiness: "manual_secondary_source",
    suggested_question: copy.question,
    suggested_yes_criteria: copy.yes,
    suggested_no_criteria: copy.no,
    suggested_edge_cases: copy.edge,
    suggested_resolution_contract: contract,
    duplicate_matches: duplicateMatches,
    provider_policy_flags: unique([
      "EXTERNAL_CONTENT_UNTRUSTED",
      "HUMAN_REVIEW_AND_SAVE_REQUIRED",
      ...sources.flatMap((source) => source.policyFlags || []),
    ]),
    retention_expires_at: new Date(new Date(resolutionDeadline).getTime() + 90 * 86_400_000).toISOString(),
  };
}

export async function buildOfficialOpportunitySignals({ documents, registry, request, existingDefinitions = [], now = new Date() }) {
  const normalizedRegistry = normalizePrimarySourceRegistry(registry);
  if (!normalizedRegistry.length) throw new Error("OFFICIAL_DISCOVERY_REGISTRY_EMPTY");
  const candidates = [];
  const rejections = [];
  for (const document of Array.isArray(documents) ? documents.slice(0, MAX_DOCUMENTS) : []) {
    const contentSha256 = typeof document?.contentSha256 === "string" && /^[0-9a-f]{64}$/i.test(document.contentSha256)
      ? document.contentSha256.toLowerCase()
      : await sha256Hex(String(document?.html || ""));
    const extracted = extractStructuredOfficialOpportunities({
      html: document?.html,
      sourceUrl: document?.url,
      contentSha256,
      registry: normalizedRegistry,
      request,
      now,
    });
    candidates.push(...extracted.candidates);
    rejections.push(...extracted.rejections);
  }
  const grouped = new Map();
  for (const candidate of candidates) {
    const key = eventGroupKey(candidate);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(candidate);
  }
  const signals = [];
  for (const key of [...grouped.keys()].sort(compareUtf16).slice(0, request.maxResults)) {
    signals.push(await buildSignal(grouped.get(key), request, existingDefinitions, now));
  }
  return Object.freeze({
    version: ATINARA_OFFICIAL_OPPORTUNITY_DISCOVERY_VERSION,
    signals,
    rejections,
    inspectedDocuments: Math.min(Array.isArray(documents) ? documents.length : 0, MAX_DOCUMENTS),
    structuredCandidates: candidates.length,
  });
}
