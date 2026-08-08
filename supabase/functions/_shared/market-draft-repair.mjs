export const AUTONOMOUS_REPAIR_VERSION = "atinara-draft-repair-v3";
export const AUTONOMOUS_REPAIR_MAX_ROUNDS = 3;

const MONTHS = Object.freeze({
  enero: 1, january: 1,
  febrero: 2, february: 2,
  marzo: 3, march: 3,
  abril: 4, april: 4,
  mayo: 5, may: 5,
  junio: 6, june: 6,
  julio: 7, july: 7,
  agosto: 8, august: 8,
  septiembre: 9, setiembre: 9, september: 9,
  octubre: 10, october: 10,
  noviembre: 11, november: 11,
  diciembre: 12, december: 12,
});

export const REPAIR_ARCHETYPES = Object.freeze([
  "official_announcement",
  "product_release",
  "content_release",
  "milestone_threshold",
  "award_winner",
  "event_presence",
  "deadline_ladder_child",
  "platform_variant",
  "generic_binary_event",
]);

export function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function cleanText(value, max = 4_000) {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

export function safePublicUrl(value) {
  try {
    const url = new URL(cleanText(value, 2_048));
    const host = url.hostname.toLowerCase().replace(/\.$/, "");
    if (url.protocol !== "https:" || !host || host === "localhost" || host.endsWith(".local")) return null;
    if (/^(?:127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(host)) return null;
    const private172 = host.match(/^172\.(\d{1,3})\./);
    if (private172 && Number(private172[1]) >= 16 && Number(private172[1]) <= 31) return null;
    if (host === "::1" || host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80:")) return null;
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function normalize(value) {
  return cleanText(value, 8_000)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function validDateParts(year, month, day) {
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function deadlineResult(year, month, day, exclusiveBoundary = false) {
  if (!validDateParts(year, month, day)) return null;
  const boundary = Date.UTC(year, month - 1, day, 23, 59, 59);
  const timestamp = exclusiveBoundary
    ? new Date(Date.UTC(year, month - 1, day) - 1_000)
    : new Date(boundary);
  return {
    year: timestamp.getUTCFullYear(),
    month: timestamp.getUTCMonth() + 1,
    day: timestamp.getUTCDate(),
    iso: timestamp.toISOString(),
  };
}

export function inferInclusiveDeadline(...values) {
  for (const value of values) {
    const raw = cleanText(value, 8_000);
    const normalized = normalize(raw);
    let match = normalized.match(/(?:antes del|antes de|before)\s+(\d{1,2})\s+(?:de\s+)?([a-z]+)\s+(?:de\s+)?(20\d{2})/i);
    if (match) {
      const month = MONTHS[match[2].toLowerCase()];
      const day = Number(match[1]);
      const year = Number(match[3]);
      if (month) return deadlineResult(year, month, day, day === 1);
    }
    match = normalized.match(/(?:before\s+)?([a-z]+)\s+(\d{1,2})\s+(20\d{2})/i);
    if (match && MONTHS[match[1].toLowerCase()]) {
      const month = MONTHS[match[1].toLowerCase()];
      const day = Number(match[2]);
      const year = Number(match[3]);
      return deadlineResult(year, month, day, /\bbefore\b/.test(normalized) && day === 1);
    }
    match = normalized.match(/(?:antes de|before)\s+([a-z]+)\s+(?:de\s+)?(20\d{2})/i);
    if (match && MONTHS[match[1].toLowerCase()]) {
      return deadlineResult(Number(match[2]), MONTHS[match[1].toLowerCase()], 1, true);
    }
    match = normalized.match(/(?:antes de|before)\s+(20\d{2})\b/i);
    if (match) return deadlineResult(Number(match[1]), 1, 1, true);
    match = normalized.match(/\b(20\d{2})[ -](\d{2})[ -](\d{2})\b/);
    if (match) return deadlineResult(Number(match[1]), Number(match[2]), Number(match[3]));
  }
  return null;
}

function dateLabel(deadline) {
  return new Intl.DateTimeFormat("es-ES", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(deadline.iso));
}

function titleCaseSubject(value) {
  const source = cleanText(value, 300).replace(/^[¿?]+|[¿?]+$/g, "").trim();
  return source.replace(/\b(vi|vii|viii|ix|xi|xii)\b/gi, (part) => part.toUpperCase());
}

function subjectCandidate(value, archetype) {
  let source = cleanText(value, 700).replace(/[¿?]/g, " ").replace(/\s+/g, " ").trim();
  source = source
    .replace(/^se\s+(?:anunciara|anunciará)\s+(?:la|el|un|una)?\s*/i, "")
    .replace(/^se\s+(?:lanzara|lanzará|publicara|publicará)\s+(?:la|el|un|una)?\s*/i, "")
    .replace(/^(?:will|whether|se|sera|será|anunciara|anunciará|lanzara|lanzará)\s+/i, "")
    .replace(/^(?:a|an|la|el|un|una)\s+/i, "");
  if (archetype === "content_release") {
    source = source
      .replace(/^(?:another|new|nuevo|nueva)\s+/i, "")
      .replace(/^(?:trailer|tráiler|teaser|avance|clip)\s+(?:of|de)\s+/i, "")
      .replace(/^(?:a|un)\s+(?:new|nuevo)\s+(?:trailer|tráiler|teaser|avance|clip)\s+(?:of|de)\s+/i, "")
      .replace(/\s*:\s*(?:new|nuevo)\s+(?:trailer|tráiler|teaser|avance|clip).*$/i, "")
      .replace(/\s+(?:trailer|tráiler)\s+(?:release date|fecha de lanzamiento).*$/i, "");
  }
  source = source.replace(/\s+(?:is|was|will be)?\s*(?:announced|anunciado|anunciada)\b.*$/i, "");
  source = source.split(/\s+(?:will|be|sera|será|se|antes|before|by|para|oficialmente|officially|come out|saldrá|saldra|lanzará|lanzara|anunciará|anunciara|publicará|publicara)\b/i)[0];
  return titleCaseSubject(source.replace(/^(?:la|el|un|una)\s+/i, "").trim());
}

function acronym(value) {
  const raw = cleanText(value, 300);
  const camel = raw.replace(/[^A-Z0-9]/g, "");
  if (camel.length >= 2) return camel.toLowerCase();
  return raw.split(/\s+/).map((word) => word[0] || "").join("").replace(/[^a-z0-9]/gi, "").toLowerCase();
}

export function inferArchetype(context) {
  const draft = isRecord(context?.draft) ? context.draft : context ?? {};
  const candidate = isRecord(context?.radar_candidate) ? context.radar_candidate : {};
  const source = normalize([
    draft.question,
    draft.yes_criteria,
    candidate.source_question,
    candidate.source_title,
    candidate.source_resolution_rules,
  ].join(" "));
  if (/\b(trailer|teaser|avance|clip|video)\b/.test(source)) return "content_release";
  if (/\b(announce|announc\w*|anunci\w*|reveal\w*|presentar|presentacion)\b/.test(source)) return "official_announcement";
  if (/\b(release|released|launch\w*|lanz\w*|saldr\w*|debut)\b/.test(source)) return "product_release";
  if (/\b(award|premio|goty|winner|ganador|ganara|ganará)\b/.test(source)) return "award_winner";
  if (/\b(platform|plataforma|playstation|xbox|switch|steam)\b/.test(source) && /\b(version|variant|variante)\b/.test(source)) return "platform_variant";
  if (/\b(at least|al menos|more than|mas de|más de|threshold|umbral|score|puntuacion|puntuación)\b/.test(source)) return "milestone_threshold";
  if (/\b(appear|attend|presence|particip|aparec|asist)\b/.test(source)) return "event_presence";
  return inferInclusiveDeadline(source) ? "deadline_ladder_child" : "generic_binary_event";
}

export function inferSubject(context, archetype = inferArchetype(context)) {
  const draft = isRecord(context?.draft) ? context.draft : context ?? {};
  const candidate = isRecord(context?.radar_candidate) ? context.radar_candidate : {};
  const candidates = [
    draft.subject,
    candidate.source_question,
    candidate.source_title,
    draft.question,
  ].map((value) => subjectCandidate(value, archetype)).filter((value) => value.length >= 2);
  if (!candidates.length) return "";
  candidates.sort((left, right) => right.length - left.length);
  let longest = candidates[0];
  const compactSubject = normalize(longest).replace(/\s+/g, "");
  if (/^[a-z]{2,8}\d{0,3}$/.test(compactSubject)) {
    const rawContext = [draft.question, draft.yes_criteria, candidate.source_question, candidate.source_title, candidate.source_resolution_rules]
      .map((value) => cleanText(value, 1_500)).join(" ");
    const expanded = rawContext.match(/\b(?:[A-Z][A-Za-zÀ-ÿ]*[A-Z][A-Za-zÀ-ÿ]*|[A-Z][a-zÀ-ÿ]+)(?:\s+[A-Z][A-Za-zÀ-ÿ]+){0,3}\s+\d{1,3}\b/g)
      ?.find((value) => acronym(value) === compactSubject);
    if (expanded) longest = `${expanded} / ${longest}`;
  }
  const alias = candidates.find((value) => value !== longest && (
    acronym(longest) === normalize(value).replace(/\s+/g, "") ||
    acronym(value) === normalize(longest).replace(/\s+/g, "")
  ));
  return alias ? `${longest} / ${alias}` : longest;
}

function primaryPublisher(draft, candidate) {
  const named = cleanText(draft?.primary_source?.name ?? draft?.primary_source?.title, 180);
  if (named) return named;
  const rules = cleanText(`${candidate?.source_resolution_rules ?? ""} ${draft?.yes_criteria ?? ""}`, 2_000);
  const match = rules.match(/\b([A-Z][A-Za-zÀ-ÿ]+(?:\s+(?:Interactive|Entertainment|Games|Studios|Corporation|Company|Inc\.?|LLC))?)\s+(?:announces?|anuncia|publica|publishes?|releases?|lanza)/);
  return cleanText(match?.[1], 180) || "la entidad responsable";
}

function durationSeconds(context) {
  const draft = isRecord(context?.draft) ? context.draft : {};
  const candidate = isRecord(context?.radar_candidate) ? context.radar_candidate : {};
  const source = normalize([draft.yes_criteria, candidate.source_resolution_rules, candidate.atinara_resolution_criteria].join(" "));
  const match = source.match(/(?:at least|al menos|minimo|minimo de)\s+(\d{1,4})\s+(?:second|segundo)/);
  const value = Number(match?.[1]);
  return Number.isSafeInteger(value) && value > 0 && value <= 3_600 ? value : null;
}

function addDay(iso, days) {
  return new Date(new Date(iso).getTime() + days * 86_400_000).toISOString();
}

function sourceObject(value) {
  if (!isRecord(value)) return null;
  const url = safePublicUrl(value.url);
  if (!url) return null;
  return {
    url,
    name: cleanText(value.name ?? value.title ?? new URL(url).hostname, 240),
    publisher: cleanText(value.publisher ?? new URL(url).hostname, 240),
    role: cleanText(value.role, 80) || "Fuente oficial alternativa",
  };
}

export function mergeAlternativeSources(...collections) {
  const seen = new Set();
  const result = [];
  for (const collection of collections) {
    for (const value of Array.isArray(collection) ? collection : []) {
      const source = sourceObject(value);
      if (!source || seen.has(source.url)) continue;
      seen.add(source.url);
      result.push(source);
    }
  }
  return result.slice(0, 8);
}

function commonTreatments(archetype) {
  const content = archetype === "content_release";
  return {
    delay_treatment: "Los retrasos o anuncios de calendario no resuelven anticipadamente el mercado; se comprueba el hecho definido al finalizar el periodo.",
    cancellation_treatment: "Una cancelación oficial no equivale por sí sola al hecho afirmado. Si el periodo termina sin la evidencia exigida, el resultado es No.",
    leak_treatment: content
      ? "Filtraciones, copias no autorizadas y publicaciones de terceros no cuentan. Solo cuenta una publicación oficial y pública de la entidad responsable."
      : "Rumores, filtraciones, patentes, registros y material no autorizado no cuentan como anuncio o lanzamiento oficial.",
    rename_treatment: "Un cambio de nombre conserva la identidad únicamente cuando la fuente oficial confirma de forma inequívoca la continuidad del mismo producto o acontecimiento.",
    assumptions: "Todas las horas se comparan en UTC. Una fuente retirada requiere evidencia fechada conservada y corroboración; un conflicto material entre fuentes primarias detiene la resolución para revisión humana específica.",
  };
}

function archetypeCriteria(archetype, subject, publisher, deadline, duration) {
  const label = dateLabel(deadline);
  const limit = `las 23:59:59 UTC del ${label}`;
  if (archetype === "official_announcement") {
    return {
      question: `¿Anunciará oficialmente ${publisher} ${subject} el ${label} o antes?`,
      yes_criteria: `Se resuelve a Sí si, no más tarde de ${limit}, existe un anuncio oficial y público de ${publisher} que identifica inequívocamente ${subject} como el producto o acontecimiento descrito. Un teaser solo cuenta cuando esa identidad es inequívoca.`,
      no_criteria: `Se resuelve a No si, al finalizar el periodo en ${limit}, no existe el anuncio oficial y público definido en el criterio de Sí.`,
      edge_cases: "No cuentan rumores, filtraciones, patentes, marcas registradas ni declaraciones vagas sobre productos futuros. Una página publicada por error necesita corroboración oficial. Si se retira una publicación, debe existir evidencia fechada conservada y corroboración. Un conflicto entre fuentes primarias bloquea la resolución para revisión humana específica.",
      public_criteria: `Atinara comprobará si la fuente oficial publicó un anuncio inequívoco de ${subject} hasta ${limit}, inclusive; rumores y documentación registral aislada no cuentan.`,
    };
  }
  if (archetype === "content_release") {
    const durationText = duration ? ` de al menos ${duration} segundos` : "";
    return {
      question: `¿Publicará oficialmente ${publisher} un nuevo tráiler de ${subject}${durationText} el ${label} o antes?`,
      yes_criteria: `Se resuelve a Sí si ${publisher} publica de forma oficial, pública y accesible un tráiler nuevo de ${subject}${durationText} no más tarde de ${limit}. Debe ser una pieza audiovisual sustancial presentada como tráiler oficial y no una mera reutilización.`,
      no_criteria: `Se resuelve a No si, al llegar ${limit}, no existe una publicación oficial que cumpla íntegramente el criterio de Sí.`,
      edge_cases: `No cuentan teasers, clips breves, anuncios de fecha sin pieza audiovisual, montajes de terceros, filtraciones ni reediciones sin material sustancialmente nuevo.${duration ? ` Una pieza de menos de ${duration} segundos no cuenta.` : ""} Una versión localizada o republicación cuenta solo si corresponde al mismo estreno nuevo y no duplica material ya publicado. Una publicación retirada exige evidencia fechada conservada y corroboración oficial; un conflicto de fuentes primarias detiene la resolución.`,
      public_criteria: `Atinara comprobará una publicación oficial de un tráiler nuevo de ${subject}${durationText} hasta ${limit}, inclusive, excluyendo teasers, clips, reediciones, filtraciones y publicaciones de terceros.`,
    };
  }
  if (archetype === "product_release") {
    return {
      question: `¿Tendrá ${subject} un lanzamiento comercial general y oficial el ${label} o antes?`,
      yes_criteria: `Se resuelve a Sí si ${subject} está disponible comercialmente como producto final, de forma general y oficialmente autorizada, no más tarde de ${limit}.`,
      no_criteria: `Se resuelve a No si, al llegar ${limit}, no se ha producido el lanzamiento comercial general definido en el criterio de Sí.`,
      edge_cases: "No cuentan reservas, predescargas, copias de prensa, demos, betas, pruebas limitadas, filtraciones ni acceso anticipado. Un desbloqueo regional cuenta desde la primera disponibilidad comercial general oficialmente autorizada, registrada en UTC. Un conflicto real de identidad o fuente se escala de forma específica.",
      public_criteria: `Atinara comprobará la disponibilidad comercial general del producto final hasta ${limit}, inclusive; anuncios, reservas y accesos limitados no cuentan.`,
    };
  }
  return {
    question: cleanText(subject, 500).endsWith("?") ? subject : `¿Se cumplirá el hecho verificable relativo a ${subject} el ${label} o antes?`,
    yes_criteria: `Se resuelve a Sí si una fuente primaria pública y autorizada confirma de forma inequívoca el hecho descrito para ${subject} no más tarde de ${limit}.`,
    no_criteria: `Se resuelve a No si, al finalizar el periodo en ${limit}, no existe la confirmación exigida por el criterio de Sí.`,
    edge_cases: "No cuentan rumores, inferencias, publicaciones de terceros ni evidencia sin fecha. Los cambios de identidad requieren continuidad oficial; fuentes primarias contradictorias detienen la resolución para revisión humana específica.",
    public_criteria: `Atinara aplicará los criterios binarios publicados a evidencia oficial disponible hasta ${limit}, inclusive.`,
  };
}

export function detectIrreducibleAmbiguity(context) {
  const conflicts = Array.isArray(context?.primary_source_conflicts) ? context.primary_source_conflicts.filter(isRecord) : [];
  const alternatives = Array.isArray(context?.subject_alternatives) ? context.subject_alternatives.map((value) => cleanText(value, 300)).filter(Boolean) : [];
  if (conflicts.length >= 2) {
    return {
      code: "CONFLICTING_PRIMARY_SOURCES",
      field: "primary_source",
      evidence: conflicts.map((item) => ({ url: safePublicUrl(item.url), statement: cleanText(item.statement, 800) })),
      alternatives: conflicts.map((item) => cleanText(item.statement, 800)).filter(Boolean),
      reason: "Dos fuentes primarias autorizadas sostienen reglas incompatibles y no existe una precedencia objetiva en el contrato.",
    };
  }
  if (alternatives.length >= 2) {
    return {
      code: "AMBIGUOUS_SUBJECT_IDENTITY",
      field: "subject",
      evidence: Array.isArray(context?.subject_evidence) ? context.subject_evidence : [],
      alternatives,
      reason: "Hay dos identidades plausibles y la evidencia disponible no permite elegir una sin decisión editorial.",
    };
  }
  return null;
}

export function buildDeterministicRepair(context, discoveredSources = []) {
  const draft = isRecord(context?.draft) ? context.draft : {};
  const candidate = isRecord(context?.radar_candidate) ? context.radar_candidate : {};
  const archetype = inferArchetype(context);
  const subject = inferSubject(context, archetype);
  const deadline = inferInclusiveDeadline(
    draft.question,
    candidate.source_question,
    candidate.source_description,
    candidate.source_resolution_rules,
    draft.yes_criteria,
    draft.evaluation_period_label,
  );
  if (!subject || !deadline) {
    return {
      archetype,
      patch: {},
      explanations: [],
      unresolved: {
        code: !subject ? "SUBJECT_NOT_INFERABLE" : "PERIOD_NOT_INFERABLE",
        field: !subject ? "subject" : "evaluation_period",
        evidence: [cleanText(draft.question, 700), cleanText(candidate.source_question, 700)].filter(Boolean),
        alternatives: [],
        reason: !subject
          ? "La procedencia no identifica un único sujeto sin inventarlo."
          : "La pregunta y la procedencia no contienen un límite temporal convertible de forma objetiva.",
      },
    };
  }
  const publisher = primaryPublisher(draft, candidate);
  const duration = durationSeconds(context);
  const criteria = archetypeCriteria(archetype, subject, publisher, deadline, duration);
  const alternatives = mergeAlternativeSources(draft.alternative_sources, discoveredSources)
    .filter((source) => source.url !== safePublicUrl(draft?.primary_source?.url));
  const patch = {
    subject,
    category: cleanText(draft.category || candidate.atinara_category, 100) || "Eventos",
    question: criteria.question,
    evaluation_period_label: `Hasta el ${dateLabel(deadline)} a las 23:59:59 UTC, inclusive`,
    evaluation_ends_at: deadline.iso,
    timezone: "UTC",
    resolution_deadline: (() => {
      const existing = new Date(cleanText(draft.resolution_deadline, 100));
      return Number.isFinite(existing.getTime()) && existing > new Date(deadline.iso)
        ? existing.toISOString()
        : addDay(deadline.iso, 1);
    })(),
    yes_criteria: criteria.yes_criteria,
    no_criteria: criteria.no_criteria,
    edge_cases: criteria.edge_cases,
    public_criteria: criteria.public_criteria,
    description: (() => {
      const current = cleanText(draft.description, 3_000);
      return current.length >= 80 ? current : criteria.public_criteria;
    })(),
    alternative_sources: alternatives,
    ...commonTreatments(archetype),
  };
  return {
    archetype,
    patch,
    explanations: Object.keys(patch).map((field) => ({ field, reason: `Campo deducido mediante el arquetipo ${archetype} y la procedencia autorizada.` })),
    unresolved: alternatives.length ? null : {
      code: "ALTERNATIVE_SOURCE_UNAVAILABLE",
      field: "alternative_sources",
      evidence: [safePublicUrl(draft?.primary_source?.url)].filter(Boolean),
      alternatives: [],
      reason: "No se encontró una segunda fuente oficial, pública, HTTPS y relevante después de validar la procedencia y la búsqueda controlada.",
    },
  };
}

const REQUIRED_TEXT_FIELDS = [
  "market_slug", "question", "subject", "category", "evaluation_period_label", "timezone",
  "yes_criteria", "no_criteria", "edge_cases", "public_criteria",
];

export function validateRepairDraft(draft) {
  const issues = [];
  for (const field of REQUIRED_TEXT_FIELDS) if (!cleanText(draft?.[field])) issues.push(`MISSING_${field.toUpperCase()}`);
  const evaluation = new Date(cleanText(draft?.evaluation_ends_at, 100));
  const resolution = new Date(cleanText(draft?.resolution_deadline, 100));
  if (!Number.isFinite(evaluation.getTime())) issues.push("INVALID_EVALUATION_END");
  if (!Number.isFinite(resolution.getTime())) issues.push("INVALID_RESOLUTION_DEADLINE");
  if (Number.isFinite(evaluation.getTime()) && Number.isFinite(resolution.getTime()) && resolution <= evaluation) issues.push("RESOLUTION_DEADLINE_NOT_AFTER_EVALUATION");
  if (!safePublicUrl(draft?.primary_source?.url)) issues.push("PRIMARY_SOURCE_REQUIRED");
  if (!mergeAlternativeSources(draft?.alternative_sources).length) issues.push("ALTERNATIVE_SOURCE_REQUIRED");
  return [...new Set(issues)];
}

export function applyRepairPatch(draft, deterministic, modelPatch = {}) {
  const output = { ...draft };
  const safeModel = isRecord(modelPatch) ? modelPatch : {};
  const modelTextFields = ["description", "assumptions", "delay_treatment", "cancellation_treatment", "leak_treatment", "rename_treatment"];
  for (const field of modelTextFields) {
    const value = cleanText(safeModel[field]);
    if (value) output[field] = value;
  }
  for (const [field, value] of Object.entries(deterministic?.patch ?? {})) output[field] = value;
  output.market_slug = cleanText(draft?.market_slug, 120);
  output.yes_option = cleanText(draft?.yes_option || "Sí", 100);
  output.no_option = cleanText(draft?.no_option || "No", 100);
  output.primary_source = isRecord(draft?.primary_source) ? draft.primary_source : {};
  output.alternative_sources = mergeAlternativeSources(output.alternative_sources);
  output._timestamp_precision = "milliseconds-v1";
  return output;
}

export function changedRepairFields(before, after) {
  const fields = [
    "question", "subject", "category", "evaluation_period_label", "evaluation_ends_at", "timezone",
    "resolution_deadline", "yes_criteria", "no_criteria", "edge_cases", "public_criteria", "description",
    "delay_treatment", "cancellation_treatment", "leak_treatment", "rename_treatment", "assumptions",
    "alternative_sources",
  ];
  return fields.filter((field) => JSON.stringify(before?.[field] ?? null) !== JSON.stringify(after?.[field] ?? null));
}

export function buildResolutionPlan(context, draft, sources, archetype) {
  const existing = isRecord(context?.binding?.resolution_contract) ? context.binding.resolution_contract : {};
  return {
    ...existing,
    plan_version: Number(existing.plan_version) || 1,
    contract_schema_version: cleanText(existing.contract_schema_version || "atinara-resolution-contract-v1", 100),
    policy_version: cleanText(existing.policy_version || "atinara-market-constitution-v1", 100),
    canonical_statement: cleanText(draft.question, 700),
    archetype,
    official_event_url: safePublicUrl(sources.find((source) => source.role === "PRIMARY_RESOLUTION")?.url),
    canonical_url: safePublicUrl(sources.find((source) => source.role === "PRIMARY_RESOLUTION")?.url),
    provider: "official_web",
    provider_adapter_version: AUTONOMOUS_REPAIR_VERSION,
    timezone: cleanText(draft.timezone, 100),
    window_end: new Date(draft.evaluation_ends_at).toISOString(),
    evaluation_at: new Date(draft.evaluation_ends_at).toISOString(),
    resolution_deadline: new Date(draft.resolution_deadline).toISOString(),
    yes_criteria: cleanText(draft.yes_criteria),
    no_criteria: cleanText(draft.no_criteria),
    edge_cases: cleanText(draft.edge_cases),
    capture_strategy: "manual_official_source",
    evidence_mode: "human_review_of_official_source",
    manual_review_instructions: "Comparar las fuentes oficiales por precedencia con los criterios aprobados, conservar evidencia fechada y exigir confirmación humana para el resultado.",
    missing_data_treatment: "manual_review_no_assumption",
    source_conflict_treatment: "pause_and_specific_human_review",
    postponement_treatment: "preserve_approved_period",
    cancellation_treatment: "evaluate_at_deadline_unless_identity_conflict",
    sources,
  };
}
