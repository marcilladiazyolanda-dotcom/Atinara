export const AUTONOMOUS_REPAIR_VERSION = "atinara-draft-repair-v12";
export const AUTONOMOUS_REPAIR_MAX_ROUNDS = 3;
export const PRIMARY_SOURCE_REGISTRY_ROLE = "primary_resolution";
export const PRIMARY_SOURCE_VALIDATION_VERSION = "atinara-primary-source-validation-v1";
export const PUBLIC_ACCOUNT_SOURCE_PARSER_VERSION = "atinara-public-account-source-v1";
export const PUBLIC_ACCOUNT_IDENTITY_SCOPE = "public_account_path_v1";
export const RESOLUTION_DEADLINE_POLICY = Object.freeze({
  version: "atinara-resolution-deadline-policy-v1",
  source_availability_delay_seconds: 300,
  human_review_margin_seconds: 86_400,
  maximum_margin_seconds: 604_800,
});
export const METRIC_OBSERVATION_POLICY = Object.freeze({
  version: "atinara-metric-observation-policy-v1",
  capture_window_seconds: 300,
});
const REUSABLE_BOUND_REPAIR_VERSIONS = new Set([
  "atinara-draft-repair-v9",
  "atinara-draft-repair-v10",
  "atinara-draft-repair-v11",
  "atinara-draft-repair-v12",
]);

const MONTHS = Object.freeze({
  enero: 1, ene: 1, january: 1, jan: 1, janeiro: 1,
  febrero: 2, feb: 2, february: 2, fevereiro: 2, fev: 2,
  marzo: 3, mar: 3, march: 3, marco: 3,
  abril: 4, abr: 4, april: 4, apr: 4,
  mayo: 5, may: 5, maio: 5, mai: 5,
  junio: 6, jun: 6, june: 6, junho: 6,
  julio: 7, jul: 7, july: 7, julho: 7,
  agosto: 8, ago: 8, august: 8, aug: 8,
  septiembre: 9, setiembre: 9, september: 9, sep: 9, sept: 9, setembro: 9, set: 9,
  octubre: 10, oct: 10, october: 10, outubro: 10, out: 10,
  noviembre: 11, nov: 11, november: 11, novembro: 11,
  diciembre: 12, dic: 12, december: 12, dec: 12, dezembro: 12, dez: 12,
});

export const REPAIR_ARCHETYPES = Object.freeze([
  "official_announcement",
  "product_release",
  "content_release",
  "metric_threshold",
  "milestone_threshold",
  "award_winner",
  "event_presence",
  "deadline_ladder_child",
  "platform_variant",
  "generic_binary_event",
]);

export const VALIDATOR_CONTENT_ISSUE_CODES = Object.freeze([
  "AMBIGUOUS_CRITERIA",
  "AMBIGUOUS_SUBJECT",
  "AUTOMATIC_REVIEW_INCONCLUSIVE",
  "CONTRADICTORY_CRITERIA",
  "CANCELLATION_TREATMENT_REQUIRED",
  "DELAY_TREATMENT_REQUIRED",
  "DESCRIPTION_REQUIRED",
  "INSUFFICIENT_EVIDENCE",
  "INVALID_MARKET_SLUG",
  "INVALID_METRIC",
  "INVALID_QUESTION",
  "INVALID_TIMEZONE",
  "MISSING_EDGE_CASES",
  "MISSING_NO_CRITERIA",
  "MISSING_PUBLIC_CRITERIA",
  "MISSING_RESOLUTION_SOURCE",
  "NON_BINARY_OPTIONS",
  "LEAK_TREATMENT_REQUIRED",
  "RENAME_TREATMENT_REQUIRED",
  "ASSUMPTIONS_REQUIRED",
  "TEMPORAL_INCOHERENCE",
  "UNRESOLVABLE_CONTRACT",
]);

export function enforceReviewIssueEvidence(resultValue, issuesValue) {
  const result = cleanText(resultValue, 40).toLowerCase();
  const issues = Array.isArray(issuesValue) ? [...issuesValue] : [];
  if (!["rejected", "inconclusive"].includes(result) || issues.length > 0) {
    return { result, issues };
  }
  return {
    result: "inconclusive",
    issues: [{
      code: "AUTOMATIC_REVIEW_INCONCLUSIVE",
      field: "automatic_review",
      message: "La revisión automática no aportó incidencias verificables y no puede aprobar ni rechazar el mercado.",
    }],
  };
}

export const REPAIRABLE_ISSUE_CODES = Object.freeze([
  ...VALIDATOR_CONTENT_ISSUE_CODES.filter((code) => code !== "AUTOMATIC_REVIEW_INCONCLUSIVE"),
  "QUESTION_REQUIRED",
  "QUESTION_AMBIGUOUS_TERM",
  "SUBJECT_REQUIRED",
  "CATEGORY_REQUIRED",
  "OPTIONS_NOT_BINARY",
  "PERIOD_REQUIRED",
  "TEMPORAL_CONTRADICTION",
  "TIMEZONE_INVALID",
  "RESOLUTION_DEADLINE_INVALID",
  "YES_CRITERIA_REQUIRED",
  "NO_CRITERIA_REQUIRED",
  "OPTIONS_OVERLAP",
  "EDGE_CASES_REQUIRED",
  "PRIMARY_SOURCE_INVALID",
  "ALTERNATIVE_SOURCE_REQUIRED",
  "ALTERNATIVE_SOURCE_INVALID",
  "PUBLIC_CRITERIA_REQUIRED",
]);

export const REPAIR_ARCHETYPE_CAPABILITIES = Object.freeze(Object.fromEntries(
  REPAIR_ARCHETYPES.map((archetype) => [archetype, Object.freeze({
    criteria_handler: archetype,
    deterministic: true,
    fail_closed_without_subject_or_period: true,
  })]),
));

export const REPAIR_ISSUE_CAPABILITIES = Object.freeze({
  ...Object.fromEntries(REPAIRABLE_ISSUE_CODES.map((code) => [code, Object.freeze({
    severity: "blocking",
    repairability: "auto_repair",
    disposition: ["AMBIGUOUS_SUBJECT", "CONTRADICTORY_CRITERIA", "UNRESOLVABLE_CONTRACT"].includes(code)
      ? "repair_or_specific_escalation"
      : ["MISSING_RESOLUTION_SOURCE", "PRIMARY_SOURCE_INVALID", "ALTERNATIVE_SOURCE_REQUIRED", "ALTERNATIVE_SOURCE_INVALID", "INSUFFICIENT_EVIDENCE"].includes(code)
        ? "research_then_repair_or_specific_escalation"
        : "deterministic_repair_or_specific_escalation",
    invariants: ["preserve_contract_meaning", "preserve_private_state", "never_confirm_or_publish"],
    expected_result: "new_version_then_compatible_review",
  })])),
  AUTOMATIC_REVIEW_INCONCLUSIVE: Object.freeze({
    severity: "warning",
    repairability: "validator_retry_only",
    disposition: "retry_validator_or_human_review",
    invariants: ["preserve_contract_meaning", "preserve_private_state", "never_confirm_or_publish"],
    expected_result: "new_validator_attempt_without_draft_write",
  }),
});

export function repairIssuePlan(context) {
  const issues = Array.isArray(context?.repairable_content_issues)
    ? context.repairable_content_issues.filter(isRecord)
    : [];
  const codes = [...new Set(issues
    .map((issue) => cleanText(issue.code, 100).toUpperCase())
    .filter(Boolean))].sort((left, right) => left.localeCompare(right));
  const repairableCodes = new Set(REPAIRABLE_ISSUE_CODES);
  const unsupported = codes.filter((code) => !repairableCodes.has(code));
  return {
    codes,
    unsupported,
    dispositions: Object.fromEntries(codes
      .filter((code) => REPAIR_ISSUE_CAPABILITIES[code])
      .map((code) => [code, REPAIR_ISSUE_CAPABILITIES[code].disposition])),
  };
}

/** @param {unknown} value @returns {value is Record<string, unknown>} */
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

const SEMANTIC_REPAIR_DRAFT_FIELDS = Object.freeze([
  "question", "subject", "category", "evaluation_period_label", "evaluation_ends_at", "timezone",
  "resolution_deadline", "yes_criteria", "no_criteria", "edge_cases", "public_criteria", "description",
  "delay_treatment", "cancellation_treatment", "leak_treatment", "rename_treatment", "assumptions",
]);

const SEMANTIC_REPAIR_SOURCE_CONTRACT_FIELDS = Object.freeze([
  "source_question", "source_title", "source_resolution_rules", "source_resolution_deadline",
  "source_close_at", "atinara_resolution_criteria", "atinara_resolution_source_url",
]);

const SEMANTIC_REPAIR_PATCH_FIELDS = Object.freeze([
  "market_slug", "question", "subject", "category", "yes_option", "no_option",
  "evaluation_period_label", "evaluation_ends_at", "closes_at", "timezone", "resolution_deadline",
  "yes_criteria", "no_criteria", "edge_cases", "primary_source", "alternative_sources",
  "delay_treatment", "cancellation_treatment", "leak_treatment", "rename_treatment",
  "assumptions", "public_criteria", "description",
]);

function semanticRepairFields(value, fields) {
  const source = isRecord(value) ? value : {};
  return Object.fromEntries(fields.map((field) => [field, cleanText(source[field], 4_000)]));
}

/**
 * Proyecta exclusivamente texto semantico acotado para el modelo del Corrector.
 * Los campos ausentes se representan como cadenas vacias: nunca se envia
 * `undefined`, metadatos internos de fuentes ni objetos de workflow profundos.
 */
export function minimalSemanticRepairContext(context) {
  const draft = isRecord(context?.draft) ? context.draft : {};
  const candidate = isRecord(context?.radar_candidate) ? context.radar_candidate : {};
  const review = isRecord(context?.latest_review) ? context.latest_review : {};
  const rawIssues = Array.isArray(review.blocking_reasons) ? review.blocking_reasons
    : Array.isArray(review.semantic_issues) ? review.semantic_issues : [];
  const blockingReasons = rawIssues.slice(0, 30).filter(isRecord).map((issue) => ({
    code: cleanText(issue.code, 100),
    field: cleanText(issue.field, 100),
    message: cleanText(issue.message, 800),
  })).filter((issue) => issue.code || issue.field || issue.message);
  return {
    draft: semanticRepairFields(draft, SEMANTIC_REPAIR_DRAFT_FIELDS),
    source_contract: semanticRepairFields(candidate, SEMANTIC_REPAIR_SOURCE_CONTRACT_FIELDS),
    blocking_reasons: blockingReasons,
  };
}

function semanticRepairSource(value) {
  if (!isRecord(value)) return {};
  const url = safePublicUrl(value.url);
  const name = cleanText(value.name ?? value.title, 500);
  const role = cleanText(value.role ?? value.registry_role, 120);
  return {
    ...(url ? { url } : {}),
    ...(name ? { name } : {}),
    ...(role ? { role } : {}),
  };
}

/**
 * Reduce la propuesta determinista al contrato editorial que el modelo puede
 * revisar. La escritura sigue dependiendo del registro y del servidor; esta
 * proyeccion no transporta atestaciones, extractos, UUID ni banderas internas.
 */
export function minimalSemanticRepairProposal(deterministic) {
  const source = isRecord(deterministic) ? deterministic : {};
  const sourcePatch = isRecord(source.patch) ? source.patch : {};
  const patch = {};
  for (const field of SEMANTIC_REPAIR_PATCH_FIELDS) {
    if (!Object.hasOwn(sourcePatch, field)) continue;
    if (field === "primary_source") patch[field] = semanticRepairSource(sourcePatch[field]);
    else if (field === "alternative_sources") {
      patch[field] = Array.isArray(sourcePatch[field])
        ? sourcePatch[field].map(semanticRepairSource).filter((item) => item.url).slice(0, 8) : [];
    } else patch[field] = cleanText(sourcePatch[field], 4_000);
  }
  const issuePlan = isRecord(source.issue_plan) ? source.issue_plan : {};
  const dispositions = isRecord(issuePlan.dispositions) ? issuePlan.dispositions : {};
  const issues = (Array.isArray(issuePlan.codes) ? issuePlan.codes : []).map((value) => {
    const code = cleanText(value, 100).toUpperCase();
    return { code, disposition: cleanText(dispositions[code], 120) };
  }).filter((issue) => issue.code);
  const explanations = (Array.isArray(source.explanations) ? source.explanations : [])
    .filter(isRecord).map((item) => ({
      field: cleanText(item.field, 80),
      reason: cleanText(item.reason, 800),
    })).filter((item) => item.field && item.reason).slice(0, 30);
  return {
    archetype: cleanText(source.archetype, 100),
    patch,
    issues,
    explanations,
  };
}

function blockedIpv4Literal(host) {
  const parts = host.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part) || Number(part) > 255)) return false;
  const [first, second] = parts.map(Number);
  return first === 0
    || first === 10
    || first === 127
    || (first === 100 && second >= 64 && second <= 127)
    || (first === 169 && second === 254)
    || (first === 172 && second >= 16 && second <= 31)
    || (first === 192 && second === 168)
    || (first === 198 && (second === 18 || second === 19))
    || first >= 224;
}

function expandIpv6(host) {
  const value = host.toLowerCase();
  if (!value.includes(":")) return null;
  const halves = value.split("::");
  if (halves.length > 2) return null;
  const parseHalf = (half) => half ? half.split(":").filter(Boolean) : [];
  const left = parseHalf(halves[0]);
  const right = parseHalf(halves[1] ?? "");
  const normalizePart = (part) => /^[0-9a-f]{1,4}$/.test(part) ? Number.parseInt(part, 16) : null;
  const parsedLeft = left.map(normalizePart);
  const parsedRight = right.map(normalizePart);
  if ([...parsedLeft, ...parsedRight].some((part) => part === null)) return null;
  const missing = 8 - parsedLeft.length - parsedRight.length;
  if ((halves.length === 1 && missing !== 0) || (halves.length === 2 && missing < 1)) return null;
  return [...parsedLeft, ...Array(Math.max(0, missing)).fill(0), ...parsedRight];
}

function blockedIpv6Literal(host) {
  const parts = expandIpv6(host);
  if (!parts) return false;
  if (parts.every((part) => part === 0)) return true;
  if (parts.slice(0, 7).every((part) => part === 0) && parts[7] === 1) return true;
  if ((parts[0] & 0xfe00) === 0xfc00
    || (parts[0] & 0xffc0) === 0xfe80
    || (parts[0] & 0xffc0) === 0xfec0
    || (parts[0] & 0xff00) === 0xff00) return true;
  if (parts.slice(0, 6).every((part) => part === 0)) {
    const compatible = `${parts[6] >> 8}.${parts[6] & 255}.${parts[7] >> 8}.${parts[7] & 255}`;
    if (blockedIpv4Literal(compatible)) return true;
  }
  if (parts.slice(0, 5).every((part) => part === 0) && parts[5] === 0xffff) {
    const mapped = `${parts[6] >> 8}.${parts[6] & 255}.${parts[7] >> 8}.${parts[7] & 255}`;
    return blockedIpv4Literal(mapped);
  }
  return false;
}

export function safePublicUrl(value) {
  try {
    const url = new URL(cleanText(value, 2_048));
    const host = url.hostname.toLowerCase().replace(/\.$/, "");
    const literalHost = host.replace(/^\[|\]$/g, "");
    if (url.protocol !== "https:" || !host
      || url.username || url.password || url.port
      || host === "localhost" || host.endsWith(".localhost")
      || (!literalHost.includes(".") && !literalHost.includes(":"))
      || host.endsWith(".local") || host.endsWith(".internal")
      || host.endsWith(".lan") || host.endsWith(".home")
      || host.endsWith(".home.arpa")) return null;
    if (blockedIpv4Literal(literalHost) || blockedIpv6Literal(literalHost)) return null;
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function primaryRegistryDomain(value) {
  const domain = cleanText(value, 255).toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
  if (!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain)) return null;
  return safePublicUrl(`https://${domain}/`) ? domain : null;
}

export function normalizePrimarySourceRegistry(values) {
  const seen = new Set();
  const result = [];
  for (const value of Array.isArray(values) ? values : []) {
    if (!isRecord(value) || value.active !== true || cleanText(value.authority_tier, 40).toLowerCase() !== "primary") continue;
    const allowedRoles = Array.isArray(value.allowed_roles)
      ? value.allowed_roles.map((role) => cleanText(role, 80).toLowerCase()).filter(Boolean)
      : [];
    const categories = Array.isArray(value.categories)
      ? [...new Set(value.categories.map((category) => normalize(cleanText(category, 120))).filter(Boolean))]
      : [];
    if (!allowedRoles.includes(PRIMARY_SOURCE_REGISTRY_ROLE)) continue;
    const id = cleanText(value.id, 80).toLowerCase();
    const canonicalDomain = primaryRegistryDomain(value.canonical_domain);
    const parserVersion = cleanText(value.parser_version, 120);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)
      || !canonicalDomain || !parserVersion || seen.has(id)) continue;
    seen.add(id);
    result.push({
      id,
      provider: cleanText(value.provider, 120),
      source_name: cleanText(value.source_name, 240) || canonicalDomain,
      canonical_domain: canonicalDomain,
      allowed_roles: [...new Set(allowedRoles)],
      authority_tier: "primary",
      categories,
      parser_version: parserVersion,
      registry_contract_version: cleanText(value.registry_contract_version, 120) || "atinara-primary-source-registry-v1",
      active: true,
    });
  }
  return result.sort((left, right) => right.canonical_domain.length - left.canonical_domain.length
    || left.canonical_domain.localeCompare(right.canonical_domain));
}

export function primarySourceRegistryEntry(value, registry, category = /** @type {string | null} */ (null)) {
  const url = safePublicUrl(value);
  if (!url) return null;
  const hostname = new URL(url).hostname.toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
  const normalizedCategory = normalize(cleanText(category, 120));
  const matches = normalizePrimarySourceRegistry(registry)
    .filter((entry) => (hostname === entry.canonical_domain || hostname.endsWith(`.${entry.canonical_domain}`))
      && (entry.categories.length === 0 || (normalizedCategory && entry.categories.includes(normalizedCategory))));
  // Un dominio con un parser de cuenta pública no puede caer en un parser web
  // genérico: así un post, una búsqueda o una ruta interna no se convierte en
  // fuente primaria por compartir host con el perfil oficial.
  return matches.find((entry) => entry.parser_version === PUBLIC_ACCOUNT_SOURCE_PARSER_VERSION)
    ?? matches[0]
    ?? null;
}

export function primarySourceCandidates(context) {
  const draft = isRecord(context?.draft) ? context.draft : {};
  const candidate = isRecord(context?.radar_candidate) ? context.radar_candidate : {};
  const bindingSources = Array.isArray(context?.binding_sources)
    ? context.binding_sources.filter(isRecord).sort((left, right) => Number(left.precedence) - Number(right.precedence))
    : [];
  const evidence = [
    ...(Array.isArray(candidate.verification_evidence) ? candidate.verification_evidence : []),
    ...(isRecord(candidate.normalized_payload) && Array.isArray(candidate.normalized_payload.verification_evidence)
      ? candidate.normalized_payload.verification_evidence : []),
  ].filter(isRecord);
  const values = [
    ...bindingSources.filter((source) => cleanText(source.role, 80).toUpperCase() === "PRIMARY_RESOLUTION")
      .map((source) => ({ ...source, origin: "binding" })),
    { url: candidate.atinara_resolution_source_url, name: candidate.source_title, origin: "candidate_canonical" },
    { url: candidate.source_resolution_url, name: candidate.source_title, origin: "candidate_canonical" },
    ...evidence.filter((source) => cleanText(source.role, 80).toUpperCase() === "PRIMARY_RESOLUTION")
      .map((source) => ({ ...source, origin: "candidate_evidence" })),
    { ...(isRecord(draft.primary_source) ? draft.primary_source : {}), origin: "draft_inherited" },
  ];
  const seen = new Set();
  const result = [];
  for (const value of values) {
    const url = safePublicUrl(value.url);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    // Solo se conserva procedencia declarativa. Ninguna bandera heredada
    // atraviesa esta frontera ni puede autocertificar autoridad o reachability.
    result.push({
      url,
      name: cleanText(value.name ?? value.title, 240),
      publisher: cleanText(value.publisher, 240),
      origin: cleanText(value.origin, 80),
    });
  }
  return result.slice(0, 12);
}

function primaryIdentityTokens(value) {
  return normalize(value).split(" ").filter((token) => token.length >= 2 && ![
    "the", "and", "will", "with", "from", "that", "this", "before", "after", "official", "oficial",
    "source", "fuente", "market", "mercado", "event", "evento", "game", "video", "release", "result",
    "results", "news", "press", "para", "por", "una", "uno", "del", "las", "los", "nuevo", "nueva",
    "sports", "project", "proyecto", "product", "producto", "website", "site", "latest",
  ].includes(token));
}

const ROMAN_SUFFIX = Object.freeze({
  "1": "i", "2": "ii", "3": "iii", "4": "iv", "5": "v", "6": "vi",
  "7": "vii", "8": "viii", "9": "ix", "10": "x", "11": "xi", "12": "xii",
});
const ROMAN_VALUES = new Set(Object.values(ROMAN_SUFFIX));

function acronymRomanIdentity(value) {
  const tokens = normalize(value).split(" ").filter(Boolean);
  const suffix = ROMAN_SUFFIX[tokens.at(-1)] || tokens.at(-1);
  if (tokens.length < 2 || !ROMAN_VALUES.has(suffix)) return null;
  const core = tokens.slice(0, -1);
  const acronymValue = core.length === 1
    ? (/^[a-z]{2,8}$/.test(core[0]) ? core[0] : "")
    : core.map((token) => token[0]).join("");
  return acronymValue.length >= 2 ? `${acronymValue}${suffix}` : null;
}

function acronymRomanExpansions(text, identityKey) {
  if (!identityKey) return [];
  const tokens = normalize(text).split(" ").filter(Boolean);
  const expansions = new Set();
  for (let suffixIndex = 1; suffixIndex < tokens.length; suffixIndex += 1) {
    const suffix = ROMAN_SUFFIX[tokens[suffixIndex]] || tokens[suffixIndex];
    if (!ROMAN_VALUES.has(suffix)) continue;
    for (let coreWidth = 2; coreWidth <= 6 && coreWidth <= suffixIndex; coreWidth += 1) {
      const candidate = [...tokens.slice(suffixIndex - coreWidth, suffixIndex), suffix].join(" ");
      if (acronymRomanIdentity(candidate) === identityKey) expansions.add(candidate);
    }
  }
  return [...expansions];
}

function primaryIdentityEvidence(identity, text) {
  const identityTokens = primaryIdentityTokens(identity);
  const textTokens = new Set(normalize(text).split(" ").filter(Boolean));
  const compactText = normalize(text).replace(/\s+/g, "");
  const matchedTokens = [...new Set(identityTokens.filter((token) => textTokens.has(token)
    || (/[a-z]/.test(token) && /\d/.test(token) && compactText.includes(token))))];
  const romanIdentity = acronymRomanIdentity(identity);
  const romanExpansions = acronymRomanExpansions(text, romanIdentity);
  if (romanExpansions.length > 1) return { accepted: false, matched_tokens: matchedTokens.slice(0, 8) };
  if (romanExpansions.length === 1) {
    return {
      accepted: true,
      matched_tokens: [...new Set([...matchedTokens, romanIdentity])].filter(Boolean).slice(0, 8),
    };
  }
  const digitCompounds = [];
  for (let index = 0; index < identityTokens.length; index += 1) {
    for (let width = 2; width <= 3 && index + width <= identityTokens.length; width += 1) {
      const parts = identityTokens.slice(index, index + width);
      if (parts.some((token) => /\d/.test(token)) && parts.some((token) => /[a-z]/.test(token))) {
        digitCompounds.push(parts.join(""));
      }
    }
  }
  const explicitDigitTokens = identityTokens.filter((token) => /[a-z]/.test(token) && /\d/.test(token));
  const digitIdentityDeclared = identityTokens.some((token) => /^\d+$/.test(token)) || explicitDigitTokens.length > 0;
  const matchedCompound = [...new Set([...explicitDigitTokens, ...digitCompounds])]
    .find((compound) => compound.length >= 3 && compactText.includes(compound));
  if (digitIdentityDeclared) {
    return {
      accepted: Boolean(matchedCompound),
      matched_tokens: matchedCompound ? [...new Set([...matchedTokens, matchedCompound])].slice(0, 8) : matchedTokens.slice(0, 8),
    };
  }
  const distinctive = identityTokens.filter((token) => /^[a-z][a-z0-9]*$/.test(token));
  const matchedDistinctive = distinctive.filter((token) => textTokens.has(token));
  const required = distinctive.length >= 2 ? 2 : distinctive.some((token) => token.length >= 5) ? 1 : 2;
  return { accepted: matchedDistinctive.length >= required, matched_tokens: matchedDistinctive.slice(0, 8) };
}

/** @param {unknown} value @param {unknown} context @param {string|null} [subject] @param {string|null} [archetype] */
export function primarySourceRelevance(value, context, subject = null, archetype = null) {
  context = repairInferenceContext(context);
  subject = cleanText(subject, 500) || inferSubject(context);
  archetype = cleanText(archetype, 80) || inferArchetype(context);
  const url = safePublicUrl(value?.url);
  if (!url || !cleanText(subject, 500)) return { accepted: false, basis: null, matched_tokens: [] };
  if (cleanText(value?.parser_version ?? value?.registry_parser_version, 120)
      === PUBLIC_ACCOUNT_SOURCE_PARSER_VERSION) {
    const accountHandle = publicAccountProfileHandle(url);
    const declaredHandles = [...cleanText(subject, 500).matchAll(/@([A-Za-z0-9_]{1,15})\b/g)]
      .map((match) => match[1].toLowerCase());
    const excerpt = cleanText(value?.excerpt, 4_000);
    const escapedHandle = accountHandle?.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") ?? "";
    const handleInContent = Boolean(accountHandle)
      && new RegExp(`@${escapedHandle}\\b`, "i").test(excerpt);
    const identityEvidence = primaryIdentityEvidence(subject, excerpt);
    const accepted = Boolean(accountHandle)
      && declaredHandles.includes(accountHandle)
      && handleInContent
      && identityEvidence.accepted;
    return {
      accepted,
      basis: accepted ? "fetched_content_and_canonical_url_v1" : null,
      matched_tokens: accepted
        ? [...new Set([accountHandle, ...identityEvidence.matched_tokens])].slice(0, 8)
        : identityEvidence.matched_tokens,
      account_handle: accepted ? accountHandle : null,
      identity_scope: accepted ? PUBLIC_ACCOUNT_IDENTITY_SCOPE : null,
    };
  }
  const parsed = new URL(url);
  // La query es controlable, mutable y no forma parte de la ruta canónica que
  // identifica el recurso; nunca aporta relevancia material.
  const urlText = normalize(`${parsed.hostname} ${parsed.pathname}`);
  const contentText = normalize(value?.excerpt);
  const contentEntityEvidence = primaryIdentityEvidence(subject, contentText);
  const contentEntityMatch = contentEntityEvidence.accepted;
  const metric = archetype === "metric_threshold" ? metricThresholdContract(context) : null;
  const metricDomainMatch = !metric || parsed.hostname === metric.source_domain || parsed.hostname.endsWith(`.${metric.source_domain}`);
  const generalSourceArchetype = ["award_winner", "event_presence"].includes(archetype);
  const generalIdentity = archetype === "award_winner" ? awardName(context)
    : archetype === "event_presence" ? presenceEvent(context) : null;
  const contentGeneralIdentityEvidence = primaryIdentityEvidence(generalIdentity, contentText);
  const contentGeneralIdentityMatch = contentGeneralIdentityEvidence.accepted;
  const predicateMatch = archetype === "award_winner"
    ? /\b(award|awards|premio|premios|winner|winners|ganador|ganadores|nominee|nominees|nominado|nominados)\b/.test(contentText)
    : archetype === "event_presence"
      ? /\b(event|events|evento|eventos|feria|conference|conferencia|festival|summit|expo|agenda|schedule|lineup|participant|participants|speaker|exhibitor)\b/.test(contentText)
      : archetype === "official_announcement"
        ? /\b(announce|announces|announced|announcement|anuncia|anuncio|presenta|reveal|reveals|revealed)\b/.test(contentText)
        : archetype === "product_release"
          ? /\b(release|released|launch|launched|available|availability|coming|lanzamiento|lanza|lanzado|disponible|fecha)\b/.test(contentText)
          : archetype === "content_release"
            ? /\b(trailer|teaser|avance)\b/.test(contentText)
            : archetype === "metric_threshold"
              ? /\b(score|scores|metascore|rating|ratings|puntuacion|calificacion|metacritic|user score)\b/.test(contentText)
              : archetype === "milestone_threshold"
                ? /\b(subscriber|subscribers|suscriptor|suscriptores|follower|followers|seguidores|viewer|viewers|ventas|sales|units|unidades|downloads|descargas)\b/.test(contentText)
                : archetype === "platform_variant"
                  ? /\b(platform|plataforma|version|edition|edicion|playstation|xbox|nintendo|switch|steam|pc)\b/.test(contentText)
                  : /\b(release|launch|announce|announcement|trailer|teaser|award|winner|score|rating|event|schedule|available|cover|athlete|portada|atleta|lanzamiento|anuncio|premio|ganador|puntuacion|evento|disponible)\b/.test(contentText);
  // La ruta de un host oficial puede ser arbitraria (SPA/catch-all). Nunca
  // prueba por sí sola identidad ni predicado: el cuerpo/meta descargado debe
  // contener la identidad material y la señal contractual del arquetipo.
  const accepted = predicateMatch && metricDomainMatch && (contentEntityMatch
    || (generalSourceArchetype && contentGeneralIdentityMatch));
  const urlEntityMatch = primaryIdentityEvidence(subject, urlText).accepted;
  const urlIdentityMatch = primaryIdentityEvidence(generalIdentity, urlText).accepted;
  const basis = !accepted ? null
    : urlEntityMatch || urlIdentityMatch
      ? "fetched_content_and_canonical_url_v1"
      : "fetched_content_v1";
  return {
    accepted,
    basis,
    matched_tokens: [...new Set([
      ...contentEntityEvidence.matched_tokens,
      ...contentGeneralIdentityEvidence.matched_tokens,
    ])].slice(0, 8),
  };
}

export async function readLimitedSourceExcerpt(response, maxBytes = 32_768, maxChars = 4_000) {
  const contentType = cleanText(response?.headers?.get?.("content-type"), 160).toLowerCase();
  if (contentType && !/(?:text|html|json|xml|javascript)/.test(contentType)) {
    try { await response?.body?.cancel?.(); } catch { /* El cuerpo no se reutiliza. */ }
    return "";
  }
  const reader = response?.body?.getReader?.();
  if (!reader) return "";
  const chunks = [];
  let total = 0;
  try {
    while (total < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      const remaining = maxBytes - total;
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
  return cleanText(raw, maxChars);
}

async function sha256Text(value) {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return null;
  const digest = await subtle.digest("SHA-256", new TextEncoder().encode(String(value ?? "")));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function primaryValidationFailure(candidate, code, checkedAt, redirectChain, registryEntry = null, detail = {}) {
  return {
    source: null,
    evidence: {
      kind: "primary_resolution",
      requested_url: safePublicUrl(candidate?.url),
      final_url: redirectChain.at(-1) ?? safePublicUrl(candidate?.url),
      candidate_origin: cleanText(candidate?.origin, 80),
      accepted: false,
      code,
      checked_at: checkedAt,
      redirect_count: Math.max(0, redirectChain.length - 1),
      redirect_chain: redirectChain.slice(0, 5),
      registry_source_id: registryEntry?.id ?? null,
      registry_parser_version: registryEntry?.parser_version ?? null,
      registry_role: registryEntry ? PRIMARY_SOURCE_REGISTRY_ROLE : null,
      registry_categories: registryEntry?.categories ?? [],
      authority: "private_source_registry_primary_resolution_v1",
      validation_version: PRIMARY_SOURCE_VALIDATION_VERSION,
      ...detail,
    },
  };
}

export async function validateRegisteredPrimarySource(
  candidate,
  context,
  registry,
  fetcher = globalThis.fetch,
  options = {},
) {
  const clock = typeof options.clock === "function" ? options.clock : Date.now;
  const deadlineAt = Number(options.deadline_at);
  const budgetExhausted = () => Number.isFinite(deadlineAt) && clock() >= deadlineAt;
  const checkedAt = new Date(options.now ?? clock()).toISOString();
  const timeoutMs = Number.isSafeInteger(options.timeout_ms) && options.timeout_ms > 0 ? options.timeout_ms : 8_000;
  const maxRedirects = Number.isSafeInteger(options.max_redirects) && options.max_redirects >= 0
    ? Math.min(options.max_redirects, 3) : 3;
  const draftCategory = cleanText(context?.source_validation_category, 120)
    || (isRecord(context?.draft) ? context.draft.category : null);
  let current = safePublicUrl(candidate?.url);
  const redirectChain = current ? [current] : [];
  let registryEntry = current ? primarySourceRegistryEntry(current, registry, draftCategory) : null;
  if (budgetExhausted()) {
    return primaryValidationFailure(candidate, "SOURCE_VALIDATION_BUDGET_EXHAUSTED", checkedAt, redirectChain, registryEntry);
  }
  if (!current) return primaryValidationFailure(candidate, "PRIMARY_SOURCE_URL_UNSAFE", checkedAt, redirectChain);
  if (!registryEntry) return primaryValidationFailure(candidate, "PRIMARY_SOURCE_NOT_REGISTERED", checkedAt, redirectChain);
  if (typeof fetcher !== "function") {
    return primaryValidationFailure(candidate, "PRIMARY_SOURCE_VALIDATOR_UNAVAILABLE", checkedAt, redirectChain, registryEntry);
  }

  for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
    if (budgetExhausted()) {
      return primaryValidationFailure(candidate, "SOURCE_VALIDATION_BUDGET_EXHAUSTED", checkedAt, redirectChain, registryEntry);
    }
    const controller = new AbortController();
    const remainingBudget = Number.isFinite(deadlineAt) ? Math.max(1, deadlineAt - clock()) : timeoutMs;
    const timeout = setTimeout(() => controller.abort(), Math.min(timeoutMs, remainingBudget));
    const signal = options.signal && typeof AbortSignal.any === "function"
      ? AbortSignal.any([controller.signal, options.signal]) : controller.signal;
    try {
      const response = await fetcher(current, {
        method: "GET",
        redirect: "manual",
        headers: { Range: "bytes=0-32767", "User-Agent": "Atinara-Primary-Source-Validator/1.0" },
        signal,
      });
      const location = response?.headers?.get?.("location");
      if (Number(response?.status) >= 300 && Number(response?.status) < 400) {
        try { await response?.body?.cancel?.(); } catch { /* El cuerpo no se reutiliza. */ }
        if (!location) return primaryValidationFailure(candidate, "PRIMARY_SOURCE_REDIRECT_INVALID", checkedAt, redirectChain, registryEntry);
        if (redirectCount >= maxRedirects) return primaryValidationFailure(candidate, "PRIMARY_SOURCE_REDIRECT_LIMIT", checkedAt, redirectChain, registryEntry);
        const next = safePublicUrl(new URL(location, current).toString());
        if (!next) return primaryValidationFailure(candidate, "PRIMARY_SOURCE_REDIRECT_UNSAFE", checkedAt, redirectChain, registryEntry);
        const nextRegistryEntry = primarySourceRegistryEntry(next, registry, draftCategory);
        redirectChain.push(next);
        if (!nextRegistryEntry) {
          return primaryValidationFailure(candidate, "PRIMARY_SOURCE_REDIRECT_NOT_AUTHORIZED", checkedAt, redirectChain, registryEntry);
        }
        current = next;
        registryEntry = nextRegistryEntry;
        continue;
      }
      if (!response?.ok) {
        try { await response?.body?.cancel?.(); } catch { /* El cuerpo no se reutiliza. */ }
        return primaryValidationFailure(candidate, "PRIMARY_SOURCE_UNREACHABLE", checkedAt, redirectChain, registryEntry, {
          http_status: Number(response?.status) || null,
        });
      }
      const excerpt = await readLimitedSourceExcerpt(response);
      const relevance = primarySourceRelevance({
        url: current,
        excerpt,
        parser_version: registryEntry.parser_version,
      }, context);
      const excerptSha256 = await sha256Text(excerpt);
      if (!relevance.accepted) {
        return primaryValidationFailure(candidate, "PRIMARY_SOURCE_IRRELEVANT", checkedAt, redirectChain, registryEntry, {
          http_status: Number(response.status),
          excerpt_sha256: excerptSha256,
          excerpt_chars: excerpt.length,
        });
      }
      const evidence = {
        kind: "primary_resolution",
        requested_url: redirectChain[0],
        final_url: current,
        candidate_origin: cleanText(candidate?.origin, 80),
        accepted: true,
        code: "PRIMARY_SOURCE_VERIFIED",
        checked_at: checkedAt,
        redirect_count: redirectChain.length - 1,
        redirect_chain: redirectChain.slice(0, 5),
        registry_source_id: registryEntry.id,
        registry_domain: registryEntry.canonical_domain,
        registry_parser_version: registryEntry.parser_version,
        parser_version: registryEntry.parser_version,
        registry_categories: registryEntry.categories,
        draft_category: cleanText(draftCategory, 120),
        registry_role: PRIMARY_SOURCE_REGISTRY_ROLE,
        registry_role_verified: true,
        authority: "private_source_registry_primary_resolution_v1",
        relevance_basis: relevance.basis,
        matched_tokens: relevance.matched_tokens,
        ...(relevance.identity_scope ? {
          identity_scope: relevance.identity_scope,
          account_handle: relevance.account_handle,
        } : {}),
        http_status: Number(response.status),
        excerpt_sha256: excerptSha256,
        excerpt_chars: excerpt.length,
        validated_reachable: true,
        authority_verified: true,
        relevance_verified: true,
        validation_version: PRIMARY_SOURCE_VALIDATION_VERSION,
      };
      return {
        source: {
          url: current,
          // El nombre/publisher de una URL heredada no está atestado. La fila
          // activa del registro es la única identidad editorial autorizada.
          name: registryEntry.source_name,
          publisher: registryEntry.source_name,
          role: "PRIMARY_RESOLUTION",
          excerpt,
          validated_reachable: true,
          authority_verified: true,
          relevance_verified: true,
          registry_role_verified: true,
          registry_source_id: registryEntry.id,
          registry_domain: registryEntry.canonical_domain,
          registry_parser_version: registryEntry.parser_version,
          registry_role: PRIMARY_SOURCE_REGISTRY_ROLE,
          registry_categories: registryEntry.categories,
          draft_category: cleanText(draftCategory, 120),
          authority_basis: "private_source_registry_primary_resolution_v1",
          relevance_basis: relevance.basis,
          ...(relevance.identity_scope ? {
            identity_scope: relevance.identity_scope,
            account_handle: relevance.account_handle,
          } : {}),
          validation_version: PRIMARY_SOURCE_VALIDATION_VERSION,
        },
        evidence,
      };
    } catch (error) {
      const code = budgetExhausted() || (options.signal?.aborted && Number.isFinite(deadlineAt))
        ? "SOURCE_VALIDATION_BUDGET_EXHAUSTED"
        : error instanceof DOMException && ["AbortError", "TimeoutError"].includes(error.name)
          ? "PRIMARY_SOURCE_TIMEOUT" : "PRIMARY_SOURCE_UNREACHABLE";
      return primaryValidationFailure(candidate, code, checkedAt, redirectChain, registryEntry);
    } finally {
      clearTimeout(timeout);
    }
  }
  return primaryValidationFailure(candidate, "PRIMARY_SOURCE_REDIRECT_LIMIT", checkedAt, redirectChain, registryEntry);
}

/** @param {unknown} registry @param {string|null} [category] */
export function primarySourceRegistryDomains(registry, category = null) {
  const normalizedCategory = normalize(cleanText(category, 120));
  return [...new Set(normalizePrimarySourceRegistry(registry)
    .filter((entry) => entry.categories.length === 0
      || (normalizedCategory && entry.categories.includes(normalizedCategory)))
    .map((entry) => entry.canonical_domain))].sort((left, right) => left.localeCompare(right));
}

export async function discoverRegisteredPrimarySource(context, registry, options = {}) {
  const category = cleanText(context?.source_validation_category, 120)
    || cleanText(context?.proposed_category, 120)
    || (isRecord(context?.draft) ? cleanText(context.draft.category, 120) : "");
  const maxDeclaredCandidates = Number.isSafeInteger(options.max_declared_candidates)
    ? Math.max(1, Math.min(options.max_declared_candidates, 8)) : 8;
  const maxSearchCandidates = Number.isSafeInteger(options.max_search_candidates)
    ? Math.max(1, Math.min(options.max_search_candidates, 6)) : 6;
  const candidates = (Array.isArray(options.candidates) ? options.candidates : primarySourceCandidates(context))
    .slice(0, maxDeclaredCandidates);
  const fetcher = options.fetcher ?? globalThis.fetch;
  const validationOptions = isRecord(options.validation_options) ? options.validation_options : {};
  const evidenceChecked = [];
  const warnings = [];
  const seen = new Set();

  const validateCandidate = async (candidate) => {
    const url = safePublicUrl(candidate?.url);
    if (!url || seen.has(url)) return null;
    seen.add(url);
    const validation = await validateRegisteredPrimarySource(
      { ...candidate, url },
      { ...context, source_validation_category: category },
      registry,
      fetcher,
      validationOptions,
    );
    const evidence = isRecord(validation?.evidence) ? validation.evidence : {};
    evidenceChecked.push(evidence);
    if (evidence.code === "SOURCE_VALIDATION_BUDGET_EXHAUSTED") {
      if (!warnings.includes("SOURCE_VALIDATION_BUDGET_EXHAUSTED")) warnings.push("SOURCE_VALIDATION_BUDGET_EXHAUSTED");
      return { budgetExhausted: true };
    }
    return isRecord(validation?.source) && evidence.accepted === true
      ? { source: validation.source, checkSnapshot: evidence }
      : null;
  };

  for (const candidate of candidates) {
    const accepted = await validateCandidate(candidate);
    if (accepted?.budgetExhausted) {
      return { source: null, checkSnapshot: null, evidenceChecked, warnings };
    }
    if (accepted) return { ...accepted, evidenceChecked, warnings };
  }

  const domains = primarySourceRegistryDomains(registry, category);
  if (!domains.length) {
    warnings.push("PRIMARY_SOURCE_REGISTRY_CATEGORY_EMPTY");
    return { source: null, checkSnapshot: null, evidenceChecked, warnings };
  }
  if (typeof options.searcher !== "function") {
    warnings.push("PRIMARY_SOURCE_DISCOVERY_NOT_CONFIGURED");
    return { source: null, checkSnapshot: null, evidenceChecked, warnings };
  }

  const archetype = inferArchetype(context);
  const subject = inferSubject(context, archetype);
  let searchResult;
  try {
    searchResult = await options.searcher({
      subject,
      archetype,
      domains,
      deadline_at: validationOptions.deadline_at,
      signal: validationOptions.signal,
    });
  } catch {
    warnings.push("PRIMARY_SOURCE_DISCOVERY_FAILED");
    return { source: null, checkSnapshot: null, evidenceChecked, warnings };
  }
  if (cleanText(searchResult?.warning, 120)) warnings.push(cleanText(searchResult.warning, 120));
  const searchCandidates = Array.isArray(searchResult?.sources) ? searchResult.sources.filter(isRecord) : [];
  for (const candidate of searchCandidates.slice(0, maxSearchCandidates)) {
    // El snippet del buscador no cruza la frontera de confianza: solo conserva
    // la URL y una etiqueta; la relevancia procede siempre del GET posterior.
    const accepted = await validateCandidate({
      url: candidate.url,
      name: cleanText(candidate.title ?? candidate.name, 240),
      publisher: "",
      origin: "registry_search",
    });
    if (accepted?.budgetExhausted) {
      return { source: null, checkSnapshot: null, evidenceChecked, warnings };
    }
    if (accepted) return { ...accepted, evidenceChecked, warnings };
  }
  return { source: null, checkSnapshot: null, evidenceChecked, warnings };
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
    let match = normalized.match(/on or before\s+([a-z]+)\s+(\d{1,2})\s+(20\d{2})/i);
    if (match && MONTHS[match[1].toLowerCase()]) {
      return deadlineResult(Number(match[3]), MONTHS[match[1].toLowerCase()], Number(match[2]), false);
    }
    match = normalized.match(/(?:antes del|antes de|before)\s+(\d{1,2})\s+(?:de\s+)?([a-z]+)\s+(?:de\s+)?(20\d{2})/i);
    if (match) {
      const month = MONTHS[match[2].toLowerCase()];
      const day = Number(match[1]);
      const year = Number(match[3]);
      if (month) return deadlineResult(year, month, day, true);
    }
    match = normalized.match(/(?:(before)\s+)?([a-z]+)\s+(\d{1,2})\s+(20\d{2})/i);
    if (match && MONTHS[match[2].toLowerCase()]) {
      const month = MONTHS[match[2].toLowerCase()];
      const day = Number(match[3]);
      const year = Number(match[4]);
      return deadlineResult(year, month, day, Boolean(match[1]));
    }
    match = normalized.match(/(?:antes de|before)\s+([a-z]+)\s+(?:de\s+)?(20\d{2})/i);
    if (match && MONTHS[match[1].toLowerCase()]) {
      return deadlineResult(Number(match[2]), MONTHS[match[1].toLowerCase()], 1, true);
    }
    match = normalized.match(/(?:antes de|before)\s+(20\d{2})\b/i);
    if (match) return deadlineResult(Number(match[1]), 1, 1, true);
    match = normalized.match(/(?:(before|antes de|antes del)\s+)?\b(20\d{2})[ -](\d{2})[ -](\d{2})\b/);
    if (match) return deadlineResult(Number(match[2]), Number(match[3]), Number(match[4]), Boolean(match[1]));
  }
  return null;
}

function exactDeadline(value, source) {
  const parsed = new Date(cleanText(value, 100));
  if (!Number.isFinite(parsed.getTime())) return null;
  return {
    year: parsed.getUTCFullYear(),
    month: parsed.getUTCMonth() + 1,
    day: parsed.getUTCDate(),
    iso: parsed.toISOString(),
    exact: true,
    source,
  };
}

const RELATIVE_DAY_NUMBERS = Object.freeze({
  one: 1, uno: 1, una: 1,
  two: 2, dos: 2,
  three: 3, tres: 3,
  four: 4, cuatro: 4,
  five: 5, cinco: 5,
  six: 6, seis: 6,
  seven: 7, siete: 7,
  eight: 8, ocho: 8,
  nine: 9, nueve: 9,
  ten: 10, diez: 10,
  fourteen: 14, catorce: 14,
  thirty: 30, treinta: 30,
});

function temporalContractText(context) {
  const draft = isRecord(context?.draft) ? context.draft : context ?? {};
  const candidate = isRecord(context?.radar_candidate) ? context.radar_candidate : {};
  return [
    draft.question,
    draft.yes_criteria,
    draft.evaluation_period_label,
    candidate.source_question,
    candidate.source_description,
    candidate.source_resolution_rules,
    candidate.atinara_resolution_criteria,
  ].map((value) => cleanText(value, 5_000)).filter(Boolean).join(" ");
}

export function inferRelativeTemporalContract(context) {
  context = repairInferenceContext(context);
  const normalized = normalize(temporalContractText(context));
  const match = normalized.match(/\b(\d{1,3}|one|uno|una|two|dos|three|tres|four|cuatro|five|cinco|six|seis|seven|siete|eight|ocho|nine|nueve|ten|diez|fourteen|catorce|thirty|treinta)\s+(?:calendar\s+)?(?:day|days|dia|dias)\s+(?:after|despues de)\b.{0,80}\b(release|launch|lanzamiento|estreno|announcement|anuncio|reveal|revelacion)\b/);
  if (!match) return null;
  const offsetDays = /^\d+$/.test(match[1]) ? Number(match[1]) : RELATIVE_DAY_NUMBERS[match[1]];
  if (!Number.isSafeInteger(offsetDays) || offsetDays < 1 || offsetDays > 365) return null;
  const time = normalized.match(/\b(\d{1,2})(?:\s+(\d{2}))?\s*(am|pm)\s*(et|est|edt|eastern time|eastern standard time|eastern daylight time|utc|gmt)\b/);
  if (!time) return { offset_days: offsetDays, anchor_type: match[2], observation_time: null, timezone: null };
  let hour = Number(time[1]);
  const minute = Number(time[2] || 0);
  if (hour < 1 || hour > 12 || minute < 0 || minute > 59) return null;
  if (time[3] === "pm" && hour < 12) hour += 12;
  if (time[3] === "am" && hour === 12) hour = 0;
  const timezoneToken = time[4];
  const timezone = ["utc", "gmt"].includes(timezoneToken) ? "UTC"
    : ["est", "eastern standard time"].includes(timezoneToken) ? "Etc/GMT+5"
      : ["edt", "eastern daylight time"].includes(timezoneToken) ? "Etc/GMT+4"
        : "America/New_York";
  return {
    offset_days: offsetDays,
    anchor_type: match[2],
    observation_time: { hour, minute },
    timezone,
    timezone_basis: timezoneToken === "et" || timezoneToken === "eastern time"
      ? "iana_eastern_time_with_dst"
      : ["est", "eastern standard time"].includes(timezoneToken)
        ? "fixed_utc_minus_05"
        : ["edt", "eastern daylight time"].includes(timezoneToken)
          ? "fixed_utc_minus_04"
          : "fixed_utc",
  };
}

function evidenceMentionsSubject(value, subject) {
  const evidence = normalize(value);
  const normalizedSubject = normalize(subject);
  const tokens = [...new Set(normalizedSubject.split(" ").filter((token) => token.length >= 4 && ![
    "game", "juego", "project", "proyecto", "official", "oficial",
  ].includes(token)))];
  if (!tokens.length) return false;
  // Una coincidencia parcial como «Marvel» no puede atribuir a Fighting Souls
  // la fecha de otro producto. La frase completa o dos tokens distintivos son
  // el mínimo; para nombres de una sola palabra se exige un token largo exacto.
  if (normalizedSubject.length >= 8 && evidence.includes(normalizedSubject)) return true;
  const matched = tokens.filter((token) => new RegExp(`\\b${token}\\b`).test(evidence));
  return tokens.length === 1 ? tokens[0].length >= 8 && matched.length === 1 : matched.length >= 2;
}

function anchorDateFromText(value) {
  const normalized = normalize(value);
  const cue = "(?:release|released|releases|launch|launched|launches|arrives|available|lanzamiento|lanzara|lanza|estreno|announcement|announced|anuncio|reveal|revealed|revelacion|lancamento|lancado|lancada|lancara|chega|disponivel)";
  const monthNames = Object.keys(MONTHS).sort((left, right) => right.length - left.length).join("|");
  const englishDate = `(${monthNames})\\s+(\\d{1,2})\\s+(20\\d{2})`;
  const spanishDate = `(\\d{1,2})\\s+(?:de\\s+)?(${monthNames})\\s+(?:de\\s+)?(20\\d{2})`;
  const patterns = [
    new RegExp(`${cue}.{0,80}?\\b${englishDate}\\b`),
    new RegExp(`\\b${englishDate}\\b.{0,80}?${cue}`),
    new RegExp(`${cue}.{0,80}?\\b${spanishDate}\\b`),
    new RegExp(`\\b${spanishDate}\\b.{0,80}?${cue}`),
  ];
  for (let index = 0; index < patterns.length; index += 1) {
    const match = normalized.match(patterns[index]);
    if (!match) continue;
    const english = index < 2;
    const month = MONTHS[(english ? match[1] : match[2]).toLowerCase()];
    const day = Number(english ? match[2] : match[1]);
    const year = Number(match[3]);
    if (month && validDateParts(year, month, day)) return { year, month, day };
  }
  const iso = normalized.match(new RegExp(`${cue}.{0,80}?(20\\d{2})[ -](\\d{2})[ -](\\d{2})`))
    ?? normalized.match(new RegExp(`(20\\d{2})[ -](\\d{2})[ -](\\d{2}).{0,80}?${cue}`));
  if (iso && validDateParts(Number(iso[1]), Number(iso[2]), Number(iso[3]))) {
    return { year: Number(iso[1]), month: Number(iso[2]), day: Number(iso[3]) };
  }
  return null;
}

// Superficie pura y acotada para que el orquestador investigue por claim. Una
// fuente relacionada con la entidad no satisface el slot temporal hasta que el
// contenido recuperado contenga una fecha de ancla inequívoca.
export function extractTemporalAnchorDate(value, subject = "") {
  const anchor = anchorDateFromText(value);
  if (!anchor || (subject && !evidenceMentionsSubject(value, subject))) return null;
  return {
    year: anchor.year,
    month: anchor.month,
    day: anchor.day,
    iso_date: `${anchor.year}-${String(anchor.month).padStart(2, "0")}-${String(anchor.day).padStart(2, "0")}`,
  };
}

function zonedDateTimeIso(year, month, day, hour, minute, timezone) {
  const requestedUtc = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  try {
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
    // Los offsets IANA contemporáneos son múltiplos de 15 minutos. Probar
    // todo el rango UTC evita elegir silenciosamente uno de los dos instantes
    // de una hora repetida por DST y también detecta horas inexistentes.
    for (let offsetMinutes = -14 * 60; offsetMinutes <= 14 * 60; offsetMinutes += 15) {
      const candidate = new Date(requestedUtc - offsetMinutes * 60_000);
      const represented = Object.fromEntries(formatter.formatToParts(candidate).map((part) => [part.type, part.value]));
      if (Number(represented.year) === year && Number(represented.month) === month
        && Number(represented.day) === day && Number(represented.hour) === hour
        && Number(represented.minute) === minute && Number(represented.second) === 0) {
        candidates.push(candidate.toISOString());
      }
    }
    const unique = [...new Set(candidates)];
    return unique.length === 1 ? unique[0] : null;
  } catch {
    return null;
  }
}

/**
 * Extrae únicamente perfiles públicos canónicos de X. Las rutas de posts,
 * búsquedas, mensajes o navegación nunca son una cuenta primaria.
 */
export function publicAccountProfileHandle(value) {
  const url = safePublicUrl(value);
  if (!url) return null;
  const parsed = new URL(url);
  const hostname = parsed.hostname.toLowerCase().replace(/^www\./, "");
  if (hostname !== "x.com" || parsed.search) return null;
  const match = parsed.pathname.match(/^\/([A-Za-z0-9_]{1,15})\/?$/);
  const handle = match?.[1]?.toLowerCase() ?? "";
  if (!handle || new Set([
    "home", "explore", "search", "notifications", "messages", "compose",
    "settings", "login", "signup", "tos", "privacy", "i",
  ]).has(handle)) return null;
  return handle;
}

function versionedBoundRelativeDeadline(context, relative) {
  const draft = isRecord(context?.draft) ? context.draft : {};
  const binding = isRecord(context?.binding) ? context.binding : {};
  const contract = isRecord(binding.resolution_contract) ? binding.resolution_contract : {};
  const anchor = isRecord(contract.relative_anchor) ? contract.relative_anchor : {};
  const issueCodes = repairIssueCodeSet(context);
  const objectedFields = new Set((Array.isArray(context?.repairable_content_issues)
    ? context.repairable_content_issues.filter(isRecord) : [])
    .map((issue) => normalizedIssueField(issue.field)).filter(Boolean));
  if ([
    "CONTRADICTORY_CRITERIA", "INVALID_TIMEZONE", "PERIOD_REQUIRED",
    "TEMPORAL_CONTRADICTION", "TEMPORAL_INCOHERENCE", "TIMEZONE_INVALID",
  ].some((code) => issueCodes.has(code)) || [
    "closes_at", "evaluation_ends_at", "evaluation_period", "evaluation_period_label",
    "relative_time_anchor", "timezone",
  ].some((field) => objectedFields.has(field))) return null;
  if (binding.status !== "draft" || binding.market_id != null || binding.locked_at != null
    || cleanText(binding.draft_id, 80) !== cleanText(draft.id, 80)
    || Number(binding.plan_version) !== Number(draft.content_version)
    || !REUSABLE_BOUND_REPAIR_VERSIONS.has(cleanText(binding.adapter_version, 100))
    || cleanText(contract.temporal_basis, 80) !== "verified_relative_anchor") return null;
  const anchorDate = cleanText(anchor.anchor_date, 10);
  const anchorMatch = anchorDate.match(/^(20\d{2})-(\d{2})-(\d{2})$/);
  const offsetDays = Number(anchor.offset_days);
  const observation = cleanText(anchor.observation_time, 5).match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  const timezone = cleanText(anchor.timezone, 100);
  const sourceUrl = safePublicUrl(anchor.source_url);
  if (!anchorMatch || !observation || !sourceUrl || !validIanaTimezone(timezone)
    || !Number.isSafeInteger(offsetDays) || offsetDays < 1 || offsetDays > 365
    || offsetDays !== relative.offset_days) return null;
  const year = Number(anchorMatch[1]);
  const month = Number(anchorMatch[2]);
  const day = Number(anchorMatch[3]);
  if (!validDateParts(year, month, day)) return null;
  const contractSource = (Array.isArray(contract.sources) ? contract.sources.filter(isRecord) : [])
    .find((source) => safePublicUrl(source.url) === sourceUrl
      && cleanText(source.role, 80) === "CONTEXT_SOURCE" && source.required === true);
  const currentAttestedSource = (Array.isArray(draft.alternative_sources)
    ? draft.alternative_sources.filter(isRecord) : [])
    .find((source) => safePublicUrl(source.url) === sourceUrl
      && cleanText(source.role, 80) === "CONTEXT_SOURCE" && source.required === true
      && source.authority_verified === true && source.relevance_verified === true
      && source.validated_reachable === true);
  const history = isRecord(context?.bound_context_attestation)
    ? context.bound_context_attestation : {};
  const historySource = isRecord(history.source) ? history.source : null;
  const historyAnchor = isRecord(history.relative_anchor) ? history.relative_anchor : {};
  const draftVersion = Number(draft.content_version);
  const historicalAttestationMatches = history.verified === true
    && Number(history.current_version) === draftVersion
    && Number(history.previous_version) === draftVersion - 1
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      .test(cleanText(draft.id, 80))
    && /^[0-9a-f]{64}$/.test(cleanText(draft.content_fingerprint, 64))
    && cleanText(history.draft_id, 80) === cleanText(draft.id, 80)
    && cleanText(history.current_fingerprint, 64) === cleanText(draft.content_fingerprint, 64)
    && safePublicUrl(history.source_url) === sourceUrl
    && cleanText(historyAnchor.anchor_type, 80) === cleanText(anchor.anchor_type, 80)
    && cleanText(historyAnchor.anchor_date, 10) === anchorDate
    && Number(historyAnchor.offset_days) === offsetDays
    && cleanText(historyAnchor.observation_time, 5) === observation[0]
    && cleanText(historyAnchor.timezone, 100) === timezone
    && historySource !== null
    && safePublicUrl(historySource.url) === sourceUrl
    && cleanText(historySource.role, 80) === "CONTEXT_SOURCE"
    && historySource.required === true
    && historySource.authority_verified === true
    && historySource.relevance_verified === true
    && historySource.validated_reachable === true;
  const attestedSource = contractSource && currentAttestedSource
    ? currentAttestedSource
    : historicalAttestationMatches ? historySource : null;
  if (!attestedSource) return null;
  const target = new Date(Date.UTC(year, month - 1, day + offsetDays));
  const iso = zonedDateTimeIso(
    target.getUTCFullYear(), target.getUTCMonth() + 1, target.getUTCDate(),
    Number(observation[1]), Number(observation[2]), timezone,
  );
  const draftEvaluation = exactDeadline(draft.evaluation_ends_at, "draft_evaluation_ends_at");
  if (!iso || !draftEvaluation || new Date(iso).getTime() !== new Date(draftEvaluation.iso).getTime()) return null;
  const parsed = new Date(iso);
  return {
    year: parsed.getUTCFullYear(),
    month: parsed.getUTCMonth() + 1,
    day: parsed.getUTCDate(),
    iso,
    exact: true,
    source: "versioned_bound_relative_anchor",
    relative_anchor: {
      anchor_type: cleanText(anchor.anchor_type, 80) || relative.anchor_type,
      anchor_date: anchorDate,
      offset_days: offsetDays,
      observation_time: observation[0],
      timezone,
      timezone_basis: cleanText(anchor.timezone_basis, 100) || "versioned_bound_contract",
      source_url: sourceUrl,
      evidence_basis: "versioned_bound_required_context_source",
    },
    // Esta fuente ya supero las comprobaciones de binding, version,
    // temporalidad y evidencia anteriores. Conservarla como dato tipado evita
    // degradar CONTEXT_SOURCE a corroboracion durante una reparacion ajena al
    // tiempo y permite que la ronda siguiente vuelva a verificar el binding.
    bound_context_source: {
      ...attestedSource,
      url: sourceUrl,
      role: "CONTEXT_SOURCE",
      required: true,
      claim_slots: [...new Set([
        ...(Array.isArray(attestedSource.claim_slots) ? attestedSource.claim_slots : []),
        "TEMPORAL_ANCHOR",
      ])],
    },
  };
}

function verifiedRelativeDeadline(context, discoveredSources) {
  const relative = inferRelativeTemporalContract(context);
  if (!relative?.observation_time || !relative.timezone) return null;
  const subject = inferSubject(context, inferArchetype(context));
  for (const source of Array.isArray(discoveredSources) ? discoveredSources.filter(isRecord) : []) {
    if (source.validated_reachable !== true || source.authority_verified !== true || source.relevance_verified !== true) continue;
    const url = safePublicUrl(source.url);
    // Una URL fechada o un título editorial no prueban por sí solos el hecho
    // ancla. Solo se aceptan extractos de contenido efectivamente recuperado.
    const evidenceText = [source.excerpt, source.content, source.supports, source.snippet, source.raw_content]
      .map((value) => cleanText(value, 8_000)).filter(Boolean).join(" ");
    if (!url || !evidenceMentionsSubject(evidenceText, subject)) continue;
    const anchor = anchorDateFromText(evidenceText);
    if (!anchor) continue;
    const target = new Date(Date.UTC(anchor.year, anchor.month - 1, anchor.day + relative.offset_days));
    const iso = zonedDateTimeIso(
      target.getUTCFullYear(), target.getUTCMonth() + 1, target.getUTCDate(),
      relative.observation_time.hour, relative.observation_time.minute, relative.timezone,
    );
    if (!iso) continue;
    const parsed = new Date(iso);
    return {
      year: parsed.getUTCFullYear(),
      month: parsed.getUTCMonth() + 1,
      day: parsed.getUTCDate(),
      iso,
      exact: true,
      source: "verified_relative_anchor",
      relative_anchor: {
        anchor_type: relative.anchor_type,
        anchor_date: `${anchor.year}-${String(anchor.month).padStart(2, "0")}-${String(anchor.day).padStart(2, "0")}`,
        offset_days: relative.offset_days,
        observation_time: `${String(relative.observation_time.hour).padStart(2, "0")}:${String(relative.observation_time.minute).padStart(2, "0")}`,
        timezone: relative.timezone,
        timezone_basis: relative.timezone_basis,
        source_url: url,
      },
    };
  }
  return versionedBoundRelativeDeadline(context, relative);
}

function repairIssueCodeSet(context) {
  return new Set((Array.isArray(context?.repairable_content_issues) ? context.repairable_content_issues : [])
    .filter(isRecord)
    .map((issue) => cleanText(issue.code, 100).toUpperCase())
    .filter(Boolean));
}

const REPAIR_INFERENCE_CONTEXT = Symbol("repair-inference-context");
const INFERENCE_DRAFT_FIELDS = new Set([
  "market_slug", "question", "subject", "category", "yes_option", "no_option",
  "yes_criteria", "no_criteria", "edge_cases", "public_criteria", "description",
  "primary_source", "alternative_sources", "evaluation_period_label",
  "evaluation_ends_at", "closes_at", "resolution_deadline", "timezone", "metric",
]);

function normalizedIssueField(value) {
  return cleanText(value, 100).toLowerCase().replace(/[^a-z0-9_]/g, "_");
}

/**
 * Crea la única vista permitida para volver a inferir un contrato. Un campo que
 * el validador acaba de objetar no puede convertirse en evidencia de su propia
 * reparación. La procedencia/candidata y el resto de campos no objetados se
 * conservan; no se borra información por el mero código de la incidencia.
 */
export function repairInferenceContext(context) {
  if (!isRecord(context) || context[REPAIR_INFERENCE_CONTEXT] === true) return context;
  const issues = Array.isArray(context.repairable_content_issues)
    ? context.repairable_content_issues.filter(isRecord) : [];
  const objectedFields = new Set(issues.map((issue) => normalizedIssueField(issue.field)).filter(Boolean));
  const sourceDraft = isRecord(context.draft) ? context.draft : context;
  const draft = { ...sourceDraft };
  for (const field of objectedFields) {
    const target = field === "evaluation_period" ? "evaluation_period_label" : field;
    if (!INFERENCE_DRAFT_FIELDS.has(target)) continue;
    if (target === "primary_source") {
      // La URL introducida por la administradora sigue siendo una candidata a
      // investigar, pero se eliminan nombre, autoridad, reachability y demás
      // banderas heredadas para impedir que se autocertifique.
      const url = safePublicUrl(isRecord(sourceDraft.primary_source) ? sourceDraft.primary_source.url : null);
      draft.primary_source = url ? { url } : null;
      continue;
    }
    if (target === "alternative_sources") {
      draft.alternative_sources = mergeAlternativeSources(sourceDraft.alternative_sources)
        .map((source) => ({ url: source.url }));
      continue;
    }
    draft[target] = null;
  }
  const output = isRecord(context.draft) ? { ...context, draft } : draft;
  Object.defineProperty(output, REPAIR_INFERENCE_CONTEXT, { value: true, enumerable: false });
  return output;
}

function temporalObjectionFields(context) {
  return new Set((Array.isArray(context?.repairable_content_issues) ? context.repairable_content_issues : [])
    .filter((issue) => isRecord(issue) && ["TEMPORAL_INCOHERENCE", "TEMPORAL_CONTRADICTION"]
      .includes(cleanText(issue.code, 100).toUpperCase()))
    .map((issue) => cleanText(issue.field, 100).toLowerCase().replace(/[^a-z0-9_]/g, "_"))
    .filter(Boolean));
}

export function inferEvaluationDeadline(context, discoveredSources = []) {
  context = repairInferenceContext(context);
  const draft = isRecord(context?.draft) ? context.draft : context ?? {};
  const candidate = isRecord(context?.radar_candidate) ? context.radar_candidate : {};
  const relative = inferRelativeTemporalContract(context);
  if (relative) return verifiedRelativeDeadline(context, discoveredSources);
  const issueCodes = repairIssueCodeSet(context);
  const objectedFields = temporalObjectionFields(context);
  const temporalFieldsObjected = issueCodes.has("TEMPORAL_INCOHERENCE")
    || issueCodes.has("TEMPORAL_CONTRADICTION")
    || issueCodes.has("CONTRADICTORY_CRITERIA");
  // El límite de resolución no es el instante de observación. Solo se conservan
  // los campos que modelan explícitamente el final evaluado. Una revisión que
  // objeta la coherencia temporal invalida ambos campos derivados del borrador:
  // reescribir la pregunta para ajustarla al dato objetado cambiaría el contrato.
  if (!temporalFieldsObjected) {
    for (const [value, source] of [
      [draft.evaluation_ends_at, "draft_evaluation_ends_at"],
      [draft.closes_at, "draft_close_at"],
    ]) {
      const deadline = exactDeadline(value, source);
      if (deadline) return deadline;
    }
  }
  const inferred = inferInclusiveDeadline(
    objectedFields.has("question") ? null : draft.question,
    candidate.source_question,
    candidate.source_description,
    candidate.source_resolution_rules,
    objectedFields.has("yes_criteria") ? null : draft.yes_criteria,
    objectedFields.has("evaluation_period") || objectedFields.has("evaluation_period_label")
      ? null : draft.evaluation_period_label,
  );
  if (inferred) return { ...inferred, exact: false, source: "absolute_contract_text" };
  // El cierre del proveedor es último recurso: puede modelar el fin de trading
  // y no la observación. Nunca prevalece sobre una fecha escrita en el contrato.
  const providerClose = exactDeadline(candidate.source_close_at, "provider_close_at");
  return providerClose;
}

function dateLabel(deadline) {
  return new Intl.DateTimeFormat("es-ES", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(deadline.iso));
}

function deadlineLabel(deadline, timezone = "UTC") {
  const parsed = new Date(deadline.iso);
  if (!deadline.exact) return `las 23:59:59 UTC del ${dateLabel(deadline)}`;
  const local = new Intl.DateTimeFormat("es-ES", {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: timezone,
  }).format(parsed);
  // El instante autoritativo ya se conserva como ISO UTC en los campos
  // temporales. Repetir aquí una segunda zona dentro del texto contractual
  // hace que el clasificador de familias interprete dos representaciones del
  // mismo instante como zonas alternativas y bloquee una reparación segura.
  // La UI puede mostrar la conversión UTC como información derivada.
  return `${local} (${timezone})`;
}

export function validIanaTimezone(value) {
  const timezone = cleanText(value, 100);
  if (!timezone) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(new Date(0));
    return true;
  } catch {
    return false;
  }
}

function criteriaTimezone(context, deadline) {
  context = repairInferenceContext(context);
  const draft = isRecord(context?.draft) ? context.draft : context ?? {};
  const issueCodes = repairIssueCodeSet(context);
  const timezoneObjected = issueCodes.has("TIMEZONE_INVALID") || issueCodes.has("INVALID_TIMEZONE");
  const declared = cleanText(draft.timezone, 100);
  const declaredAlias = normalize(declared);
  const mappedDeclared = declaredAlias === "est" ? "Etc/GMT+5"
    : declaredAlias === "edt" ? "Etc/GMT+4"
      : declaredAlias === "et" ? "America/New_York" : declared;
  const anchored = cleanText(deadline?.relative_anchor?.timezone, 100);
  const temporalText = normalize(temporalContractText(context));
  const derived = new Set();
  if (anchored && validIanaTimezone(anchored)) derived.add(anchored);
  const tokenPattern = /\b(?:\d{1,2}(?:\s+\d{2})?\s*(?:am|pm)\s*|time(?:zone)?\s+)(et|est|edt|eastern time|eastern standard time|eastern daylight time|utc|gmt)\b/g;
  for (const match of temporalText.matchAll(tokenPattern)) {
    const token = match[1];
    derived.add(["est", "eastern standard time"].includes(token) ? "Etc/GMT+5"
      : ["edt", "eastern daylight time"].includes(token) ? "Etc/GMT+4"
        : ["et", "eastern time"].includes(token) ? "America/New_York" : "UTC");
  }
  if (timezoneObjected) return derived.size === 1 ? [...derived][0] : null;
  if (mappedDeclared && !validIanaTimezone(mappedDeclared)) return null;
  if (anchored) return validIanaTimezone(anchored) ? anchored : null;
  if (mappedDeclared) return mappedDeclared;
  if (derived.size === 1) return [...derived][0];
  if (derived.size > 1) return null;
  return "UTC";
}

function titleCaseSubject(value) {
  const source = cleanText(value, 300).replace(/^[¿?]+|[¿?]+$/g, "").trim();
  return source.replace(/\b(vi|vii|viii|ix|xi|xii)\b/gi, (part) => part.toUpperCase());
}

function subjectIdentityKey(value) {
  const translations = {
    proyecto: "project", canal: "channel", estudio: "studio", evento: "event",
    obra: "work", juego: "game", pelicula: "film", película: "film",
  };
  return normalize(value).split(/\s+/).filter(Boolean)
    .filter((token, index) => index > 0 || !["el", "la", "un", "una", "the", "a", "an"].includes(token))
    .map((token) => translations[token] || token).join(" ");
}

function structuredSubject(context, archetype) {
  const draft = isRecord(context?.draft) ? context.draft : context ?? {};
  const candidate = isRecord(context?.radar_candidate) ? context.radar_candidate : {};
  const values = [draft.question, candidate.source_question, draft.yes_criteria]
    .map((value) => cleanText(value, 1_500).replace(/^[¿?]+|[¿?]+$/g, "").trim())
    .filter(Boolean);
  const patterns = {
    official_announcement: [
      /^(?:se\s+)?(?:anunciará|anunciara|presentará|presentara|revelará|revelara)(?:\s+oficialmente)?\s+(.+?)(?=\s+(?:antes|después|despues|el|para|hasta)\b|$)/i,
      /^will\s+(.+?)\s+(?:be\s+)?(?:announced|revealed|presented)\b/i,
      { pattern: /^(.+?)\s+(?:será|sera|fue)\s+(?:anunciado|anunciada|presentado|presentada|revelado|revelada)\b/i, preserveLeadingArticle: true },
      { pattern: /^(.+?)\s+se\s+(?:anunciará|anunciara|presentará|presentara|revelará|revelara)\b/i, preserveLeadingArticle: true },
      { pattern: /^(.+?)\s+will\s+be\s+(?:announced|revealed|presented)\b/i, preserveLeadingArticle: true },
    ],
    product_release: [
      /^(?:se\s+)?(?:lanzará|lanzara|publicará|publicara|saldrá|saldra|debutará|debutara)(?:\s+comercialmente)?\s+(.+?)(?=\s+(?:antes|después|despues|el|para|hasta)\b|$)/i,
      /^will\s+(.+?)\s+(?:be\s+)?(?:release|released|launch|launched|debut|come out)\b/i,
      { pattern: /^(.+?)\s+(?:será|sera|fue)\s+(?:lanzado|lanzada|publicado|publicada|estrenado|estrenada|debutado|debutada)\b/i, preserveLeadingArticle: true },
      { pattern: /^(.+?)\s+se\s+(?:lanzará|lanzara|publicará|publicara|estrenará|estrenara|debutará|debutara)\b/i, preserveLeadingArticle: true },
      { pattern: /^(.+?)\s+will\s+be\s+(?:released|launched|published|debuted)\b/i, preserveLeadingArticle: true },
    ],
    content_release: [
      /^(?:se\s+)?(?:publicará|publicara|lanzará|lanzara|estrenará|estrenara|subirá|subira)(?:\s+oficialmente)?\s+(?:un|una)?\s*(?:nuevo|nueva)?\s*(?:tráiler|trailer|teaser|avance|clip)\s+(?:de|para)\s+(.+?)(?=\s+(?:antes|después|despues|el|para|hasta)\b|$)/i,
      /^will\s+(?:a\s+)?(?:new\s+)?(?:trailer|teaser|clip)\s+(?:for|of)\s+(.+?)\s+(?:be\s+)?(?:released|published|posted|uploaded)\b/i,
      /^will\s+(?:another|a\s+new|new)\s+(.+?)\s+(?:trailer|teaser|clip)\s+(?:come\s+out|be\s+(?:released|published|posted|uploaded))\b/i,
      /^will\s+(.+?)\s+(?:have|get|receive)\s+(?:a\s+)?(?:new\s+)?(?:trailer|teaser|clip)\b/i,
      { pattern: /^(.+?)\s+(?:tendrá|tendra|recibirá|recibira)\s+(?:un|una)\s+(?:nuevo|nueva)?\s*(?:tráiler|trailer|teaser|avance|clip)\b/i, preserveLeadingArticle: true },
      { pattern: /^(.+?)\s+will\s+(?:have|get|receive)\s+(?:a\s+)?(?:new\s+)?(?:trailer|teaser|clip)\b/i, preserveLeadingArticle: true },
    ],
    metric_threshold: [
      { pattern: /^(.+?)\s+(?:tendrá|tendra|obtendrá|obtendra|registrará|registrara|alcanzará|alcanzara|superará|superara)\s+(?:(?:una|un|la|el)\s+)?(?:(?:puntuación|puntuacion|valor|rating)\s+(?:de\s+)?)?(?:(?:metacritic|opencritic)\s+)?(?:user\s+score|critic\s+score|metascore|score|puntuación|puntuacion)\b/i, preserveLeadingArticle: true },
      { pattern: /^(.+?)\s+will\s+(?:have|get|receive|reach|exceed)\s+(?:(?:a|an|the)\s+)?(?:(?:metacritic|opencritic)\s+)?(?:user\s+score|critic\s+score|metascore|score|rating)\b/i, preserveLeadingArticle: true },
    ],
    milestone_threshold: [
      /^(?:superará|superara|alcanzará|alcanzara|excederá|excedera|llegará|llegara)\s+(.+?)\s+(?:(?:los|las|el|la)\s+)?(?=\d)/i,
      /^will\s+(.+?)\s+(?:reach|exceed|surpass|pass)\b/i,
      { pattern: /^(.+?)\s+(?:superará|superara|alcanzará|alcanzara|excederá|excedera|llegará|llegara)(?:\s+a)?\s+(?:(?:los|las|el|la)\s+)?\d/i, preserveLeadingArticle: true },
      { pattern: /^(.+?)\s+will\s+(?:reach|exceed|surpass|pass)\s+\d/i, preserveLeadingArticle: true },
    ],
    award_winner: [
      /^(?:ganará|ganara|obtendrá|obtendra|recibirá|recibira)\s+(.+?)\s+(?:(?:el|la)\s+)?(?:premio|galardón|galardon|award|goty)\b/i,
      /^will\s+(.+?)\s+(?:win|receive)\b/i,
      { pattern: /^(.+?)\s+(?:ganará|ganara|obtendrá|obtendra|recibirá|recibira)\s+(?:(?:el|la)\s+)?(?:premio|galardón|galardon|award|goty)\b/i, preserveLeadingArticle: true },
      { pattern: /^(.+?)\s+will\s+(?:win|receive)\s+(?:(?:the|a|an)\s+)?(?:award|prize)\b/i, preserveLeadingArticle: true },
    ],
    event_presence: [
      /^(?:aparecerá|aparecera|participará|participara|asistirá|asistira)\s+(.+?)\s+(?:en|a)\s+/i,
      /^will\s+(.+?)\s+(?:appear|attend|participate|feature)\b/i,
      { pattern: /^(.+?)\s+(?:aparecerá|aparecera|participará|participara|asistirá|asistira)\s+(?:en|a)\s+/i, preserveLeadingArticle: true },
      { pattern: /^(.+?)\s+will\s+(?:appear|attend|participate|feature)\b/i, preserveLeadingArticle: true },
    ],
    platform_variant: [
      /^(?:tendrá|tendra|recibirá|recibira)\s+(.+?)\s+(?:una|un)\s+(?:versión|version|variante)\b/i,
      /^will\s+(.+?)\s+(?:have|get|receive)\s+(?:a|an)\s+(?:(?:native|official)\s+)?(?:version|variant)\b/i,
      { pattern: /^(.+?)\s+(?:tendrá|tendra|recibirá|recibira)\s+(?:una|un)\s+(?:(?:oficial|nativa|nativo)\s+)*(?:versión|version|variante)\b/i, preserveLeadingArticle: true },
      { pattern: /^(.+?)\s+will\s+(?:have|get|receive)\s+(?:a|an)\s+(?:(?:native|official)\s+)*(?:version|variant)\b/i, preserveLeadingArticle: true },
    ],
    deadline_ladder_child: [
      /^(?:ocurrirá|ocurrira|sucederá|sucedera|pasará|pasara)\s+(.+?)(?=\s+(?:antes|para|hasta)\b|$)/i,
      /^will\s+(.+?)\s+(?:happen|occur|take place)\b/i,
      { pattern: /^(.+?)\s+(?:ocurrirá|ocurrira|sucederá|sucedera|pasará|pasara|se\s+celebrará|se\s+celebrara|tendrá\s+lugar|tendra\s+lugar)(?=\s|$|[.,;:!?])/i, preserveLeadingArticle: true },
      { pattern: /^(.+?)\s+will\s+(?:happen|occur|take place)\b/i, preserveLeadingArticle: true },
      { pattern: /^(.+?)\s+(?:firmará|firmara|adquirirá|adquirira|aprobará|aprobara|autorizará|autorizara|certificará|certificara|registrará|registrara|abrirá|abrira|cerrará|cerrara|comenzará|comenzara|iniciará|iniciara|terminará|terminara|completará|completara|cancelará|cancelara|recibirá|recibira|obtendrá|obtendra)(?=\s|$|[.,;:!?])/i, preserveLeadingArticle: true },
      { pattern: /^(.+?)\s+will\s+(?:sign|acquire|approve|authorize|certify|register|open|close|start|begin|end|complete|cancel|receive|obtain)\b/i, preserveLeadingArticle: true },
    ],
    generic_binary_event: [
      /^(?:será|sera)\s+(?:verdadero|cierto)\s+(?:el\s+)?(?:estado\s+oficial\s+)?(?:de\s+)?(.+?)$/i,
      /^will\s+(.+?)\s+(?:be|become|remain)\b/i,
      { pattern: /^(.+?)\s+(?:será|sera|seguirá|seguira|permanecerá|permanecera|estará|estara)\s+(?:verdadero|verdadera|cierto|cierta|activo|activa|vigente|confirmado|confirmada)\b/i, preserveLeadingArticle: true },
      { pattern: /^(.+?)\s+will\s+(?:be|become|remain)\b/i, preserveLeadingArticle: true },
    ],
  };
  const inferred = new Map();
  for (const value of values) {
    for (const entry of patterns[archetype] ?? []) {
      const pattern = entry instanceof RegExp ? entry : entry.pattern;
      const match = value.match(pattern);
      const subject = titleCaseSubject(match?.[1]);
      if (subject.length >= 2) {
        const materialSubject = entry?.preserveLeadingArticle
          ? subject
          : subject.replace(/^(?:la|el|un|una|the|a|an)\s+/i, "").trim();
        const identity = subjectIdentityKey(materialSubject);
        if (identity && !inferred.has(identity)) inferred.set(identity, materialSubject);
        break;
      }
    }
  }
  return inferred.size === 1 ? [...inferred.values()][0] : "";
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
  if (archetype === "metric_threshold") {
    source = source
      .replace(/\s*:\s*(?:(?:metacritic|opencritic)\s+)?(?:(?:user|critic|top\s+critic)\s+)?(?:meta)?score.*$/i, "")
      .replace(/\s+(?:(?:will|podra|podrá)\s+)?(?:have|has|had|get|gets|got|score|scores|tendra|tendrá|obtendra|obtendrá)\s+(?:a|an|una)?\s*(?:(?:metacritic|opencritic)\s+)?(?:(?:user|critic|top\s+critic|de\s+usuarios?|de\s+crítica)\s+)?(?:puntuacion|puntuación|score|metascore).*$/i, "")
      .replace(/\s+(?:(?:metacritic|opencritic)\s+)?(?:(?:user|critic|top\s+critic)\s+)?(?:meta)?score\s*\??$/i, "");
  }
  if (archetype === "platform_variant") {
    source = source
      .replace(/\s+(?:(?:will|tendra|tendrá|recibira|recibirá)\s+)?(?:have|get|receive|tener)\s+(?:a|an|una)?\s*(?:native|nativa|official|oficial)?\s*(?:version|versión|variant|variante).*$/i, "")
      .replace(/\s+(?:for|para|on|en)\s+(?:playstation|ps[45]|xbox|nintendo|switch|steam|windows|pc|macos|ios|android).*$/i, "");
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
  context = repairInferenceContext(context);
  const draft = isRecord(context?.draft) ? context.draft : context ?? {};
  const candidate = isRecord(context?.radar_candidate) ? context.radar_candidate : {};
  const source = normalize([
    draft.question,
    draft.yes_criteria,
    candidate.source_question,
    candidate.source_title,
    candidate.source_resolution_rules,
  ].join(" "));
  // La métrica es la proposición primaria; "después del lanzamiento" solo es
  // su ancla temporal y nunca debe convertirla en un mercado de lanzamiento.
  const rawSource = [
    draft.question,
    draft.yes_criteria,
    candidate.source_question,
    candidate.source_title,
    candidate.source_resolution_rules,
  ].map((value) => cleanText(value, 5_000)).join(" ");
  if (/\b(metacritic|metascore|opencritic|critic score|user score|review score|puntuacion|score)\b/.test(source)
      && (/\b(above|over|greater than|more than|below|under|less than|at least|at most|superior|inferior|mas de|menos de)\b/.test(source)
        || /(?:>=|<=|>|<)\s*\d/.test(rawSource))) return "metric_threshold";
  // "Video game" describe el dominio de muchos premios; nunca convierte por
  // sí solo una proposición de ganador en una publicación audiovisual.
  if (/\b(award|premio|galardon|goty|winner|ganador|ganara|win)\b/.test(source)) return "award_winner";
  if (/\b(trailer|teaser|avance|clip)\b/.test(source)
    || (/\bvideo\b/.test(source) && /\b(publish|release|post|upload|publicar|lanzar|subir)\w*\b/.test(source))) return "content_release";
  if (/\b(announce|announc\w*|anunci\w*|reveal\w*|presentar|presentacion)\b/.test(source)) return "official_announcement";
  if (/\b(release|released|launch\w*|lanz\w*|saldr\w*|debut)\b/.test(source)) return "product_release";
  if (/\b(platform|plataforma|playstation|xbox|switch|steam)\b/.test(source) && /\b(version|variant|variante)\b/.test(source)) return "platform_variant";
  if (/\b(at least|al menos|more than|mas de|más de|threshold|umbral|score|puntuacion|puntuación|reach\w*|alcanz\w*|exceed\w*|super\w*)\b/.test(source)) return "milestone_threshold";
  if (/\b(appear\w*|attend\w*|presence|particip\w*|aparec\w*|asist\w*)\b/.test(source)) return "event_presence";
  return inferInclusiveDeadline(source) ? "deadline_ladder_child" : "generic_binary_event";
}

/** @param {unknown} context @param {string|null} [archetype] */
export function inferRepairCategory(context, archetype = null) {
  context = repairInferenceContext(context);
  archetype = cleanText(archetype, 80) || inferArchetype(context);
  const draft = isRecord(context?.draft) ? context.draft : {};
  const candidate = isRecord(context?.radar_candidate) ? context.radar_candidate : {};
  const declared = cleanText(context?.proposed_category || draft.category || candidate.atinara_category, 100);
  if (declared) return declared;
  const source = normalize(contractText(context));
  if (/\b(youtube|youtuber|subscriber|subscribers|suscriptor|suscriptores)\b/.test(source)) return "YouTubers";
  if (/\b(twitch|streamer|viewers|espectadores)\b/.test(source)) return "Streamers";
  if (/\b(metacritic|metascore|opencritic|review|reviews|score|rating|goty|award|premio|ganador|nominee|nominado)\b/.test(source)) {
    return "Reviews/Premios";
  }
  if (/\b(gamescom|conference|conferencia|festival|summit|expo|torneo|esports|showcase|evento)\b/.test(source)) return "Eventos";
  if (/\b(acquisition|adquisicion|studio|estudio|publisher|industria|layoff|despido|sales|ventas|units|unidades)\b/.test(source)) return "Industria";
  if (/\b(release|launch|lanzamiento|trailer|teaser|avance|cover|portada|delay|retraso|announce|announcement|anuncio|reveal)\b/.test(source)) {
    return "Lanzamientos";
  }
  if (["product_release", "content_release", "official_announcement", "platform_variant"].includes(archetype)) return "Lanzamientos";
  if (["metric_threshold", "award_winner"].includes(archetype)) return "Reviews/Premios";
  if (archetype === "event_presence") return "Eventos";
  if (archetype === "milestone_threshold") return "Industria";
  return null;
}

function foldContractText(value) {
  return cleanText(value, 30_000)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function metricComparison(raw) {
  const folded = foldContractText(raw);
  const comparisons = [];
  let invalidNumber = false;
  const wordPattern = /\b(above|over|greater\s+than|more\s+than|superior\s+a|mas\s+de|below|under|less\s+than|inferior\s+a|menos\s+de|at\s+least|al\s+menos|at\s+most|como\s+maximo)\s+(\d+(?:[.,]\d+)*)\b/g;
  for (const match of folded.matchAll(wordPattern)) {
    const cue = match[1].replace(/\s+/g, " ");
    const operator = ["above", "over", "greater than", "more than", "superior a", "mas de"].includes(cue) ? ">"
      : ["below", "under", "less than", "inferior a", "menos de"].includes(cue) ? "<"
        : ["at least", "al menos"].includes(cue) ? ">=" : "<=";
    const parsed = parseLocalizedContractNumber(match[2]);
    if (!parsed) invalidNumber = true;
    else comparisons.push({ operator, threshold: parsed.value, decimal_places: parsed.decimal_places });
  }
  const symbolPattern = /(?:^|[\s(:;,])((?:>=|<=|>|<))\s*(\d+(?:[.,]\d+)*)(?=\s|[).,;:!?]|$)/g;
  for (const match of folded.matchAll(symbolPattern)) {
    const parsed = parseLocalizedContractNumber(match[2]);
    if (!parsed) invalidNumber = true;
    else comparisons.push({ operator: match[1], threshold: parsed.value, decimal_places: parsed.decimal_places });
  }
  if (invalidNumber) return null;
  const byValue = new Map();
  for (const item of comparisons.filter((candidate) => Number.isFinite(candidate.threshold))) {
    const key = `${item.operator}:${item.threshold}`;
    const existing = byValue.get(key);
    byValue.set(key, existing
      ? { ...item, decimal_places: Math.max(existing.decimal_places, item.decimal_places) }
      : item);
  }
  const unique = [...byValue.values()];
  return unique.length === 1 ? unique[0] : null;
}

function metricPlatformScope(value) {
  const raw = cleanText(value, 20_000);
  const platform = "(PlayStation\\s*[45]|PS[45]|Xbox\\s+Series\\s+[XS]|Xbox\\s+One|Nintendo\\s+Switch(?:\\s*2)?|Steam|Windows|PC|macOS|iOS|Android)";
  const scoped = raw.match(new RegExp(`(?:for|on|para|en|de)\\s+(?:la\\s+|el\\s+|the\\s+)?${platform}\\b`, "i"))
    ?? raw.match(new RegExp(`\\b${platform}\\s+(?:user\\s+score|metascore|critic\\s+score|puntuación|puntuacion)\\b`, "i"));
  return cleanText(scoped?.[1], 120) || null;
}

function metricDimensionAggregation(targetRaw, ruleRaw) {
  const raw = `${targetRaw} ${ruleRaw}`.trim();
  const normalized = normalize(raw);
  const candidates = [];
  if (/\b(highest|maximum|maximo|mayor|mas alto|any platform|cualquier plataforma|at least one platform|al menos una plataforma)\b/.test(normalized)) {
    candidates.push("maximum");
  }
  if (/\b(lowest|minimum|minimo|menor|mas bajo)\b/.test(normalized)) candidates.push("minimum");
  if (/\b(average across|average of|mean of|promedio de|media de|promediar)\b/.test(normalized)) candidates.push("arithmetic_mean");
  const platform = metricPlatformScope(targetRaw) || metricPlatformScope(ruleRaw);
  if (platform) candidates.push("single_platform");
  // «a/una puntuación» expresa existencia: basta que una de las fichas
  // elegibles del mismo producto/edición cumpla el umbral. Eso equivale a
  // comparar el máximo, sin inventar una plataforma preferente.
  const existentialScore = /\b(?:a|an|any|one|una|un|cualquier|alguna|algun)\s+(?:metacritic\s+|opencritic\s+)?(?:user\s+score|metascore|critic\s+score|review\s+score|score|puntuacion(?:\s+(?:en|de)\s+(?:metacritic|opencritic))?)\b/.test(normalize(targetRaw));
  if (existentialScore && !platform) candidates.push("maximum");
  const unique = [...new Set(candidates)];
  if (unique.length > 1) return null;
  return unique.length === 1 ? { aggregation: unique[0], platform } : null;
}

function metricThresholdAnalysis(context) {
  const draft = isRecord(context?.draft) ? context.draft : {};
  const candidate = isRecord(context?.radar_candidate) ? context.radar_candidate : {};
  const targetRaw = [
    draft.question,
    candidate.source_question,
    candidate?.provider_payload?.yes_sub_title,
  ].map((value) => cleanText(value, 5_000)).filter(Boolean).join(" ");
  const ruleRaw = [
    draft.yes_criteria,
    candidate.source_resolution_rules,
    candidate.atinara_resolution_criteria,
  ].map((value) => cleanText(value, 5_000)).filter(Boolean).join(" ");
  const raw = `${targetRaw} ${ruleRaw}`.trim();
  const comparison = metricComparison(raw);
  if (!comparison) return { contract: null, error_code: "METRIC_NOT_INFERABLE" };
  const { operator, threshold, decimal_places: decimalPlaces } = comparison;

  const target = normalize(targetRaw);
  const rules = normalize(ruleRaw);
  const all = normalize(raw);
  const urls = [
    draft?.primary_source?.url,
    candidate.source_resolution_url,
    candidate.atinara_resolution_source_url,
  ].map((value) => safePublicUrl(value)).filter(Boolean);
  const metacritic = /\b(metacritic|metascore)\b/.test(all)
    || urls.some((value) => /(^|\.)metacritic\.com$/.test(new URL(value).hostname.replace(/^www\./, "")));
  const opencritic = /\bopencritic\b/.test(all)
    || urls.some((value) => /(^|\.)opencritic\.com$/.test(new URL(value).hostname.replace(/^www\./, "")));
  if (metacritic === opencritic) return { contract: null, error_code: "METRIC_NOT_INFERABLE" };

  const userPattern = /\b(user score|users score|audience score|puntuacion de usuarios?|valoracion de usuarios?)\b/;
  const criticPattern = /\b(metascore|critic score|critics score|top critic average|puntuacion de critica|nota de critica)\b/;
  const targetUser = userPattern.test(target);
  const targetCritic = criticPattern.test(target);
  if (targetUser && targetCritic) return { contract: null, error_code: "METRIC_NOT_INFERABLE" };
  const rulesUser = userPattern.test(rules);
  const rulesCritic = criticPattern.test(rules);
  const metricKind = targetUser || (!targetCritic && rulesUser && !rulesCritic)
    ? "user"
    : "critic";
  if (opencritic && metricKind === "user") return { contract: null, error_code: "METRIC_NOT_INFERABLE" };

  const scale = metricKind === "user" ? { min: 0, max: 10, precision: 1 } : { min: 0, max: 100, precision: 0 };
  if (threshold < scale.min || threshold > scale.max || decimalPlaces > scale.precision) {
    return { contract: null, error_code: "METRIC_NOT_INFERABLE" };
  }
  const dimension = metricDimensionAggregation(targetRaw, ruleRaw);
  if (!dimension) return { contract: null, error_code: "METRIC_DIMENSION_NOT_INFERABLE" };

  const comparison_text = operator === ">" ? `superior a ${threshold}`
    : operator === "<" ? `inferior a ${threshold}`
      : operator === ">=" ? `igual o superior a ${threshold}` : `igual o inferior a ${threshold}`;
  const sourceName = metacritic ? "Metacritic" : "OpenCritic";
  const sourceDomain = metacritic ? "metacritic.com" : "opencritic.com";
  const metric = metricKind === "user" ? "User Score de Metacritic"
    : metacritic ? "Metascore de crítica de Metacritic" : "Top Critic Average de OpenCritic";
  const excludedMetric = metricKind === "user" ? "Metascore de crítica"
    : metacritic ? "User Score" : "puntuaciones de usuarios y reseñas individuales";
  const aggregateDescription = dimension.aggregation === "maximum" ? `el mayor ${metric} entre las plataformas elegibles`
    : dimension.aggregation === "minimum" ? `el menor ${metric} entre las plataformas elegibles`
      : dimension.aggregation === "arithmetic_mean" ? `la media aritmética del ${metric} de las plataformas elegibles`
        : `el ${metric} de ${dimension.platform}`;
  const observationPolicy = dimension.aggregation === "maximum"
    ? `En el instante contractual se inicia una única sesión de captura de la página canónica, que debe completarse en ${METRIC_OBSERVATION_POLICY.capture_window_seconds} segundos. La primera respuesta válida de esa sesión congela el conjunto de plataformas elegibles y, para cada ficha, se conserva el primer valor devuelto dentro de la misma sesión. No se mezclan respuestas de sesiones o ciclos de actualización distintos; los cambios posteriores quedan fuera. Si la captura completa no puede cerrarse dentro de la ventana, el resultado se detiene para revisión humana específica con la evidencia fechada disponible.`
    : `En el instante contractual se inicia una única sesión de captura, que debe completarse en ${METRIC_OBSERVATION_POLICY.capture_window_seconds} segundos. Se conserva la primera respuesta válida de la fuente para la dimensión contratada; los cambios posteriores y las respuestas de otra sesión quedan fuera. Si la captura no puede completarse dentro de la ventana, el resultado se detiene para revisión humana específica con la evidencia fechada disponible.`;
  const platformPolicy = dimension.aggregation === "maximum"
    ? `El conjunto elegible comprende exclusivamente las fichas de plataforma que ${sourceName} agrupa bajo la página canónica del mismo producto y edición objeto de la pregunta en el instante de observación. Se excluyen expansiones, remasterizaciones, relanzamientos y ediciones con una página canónica distinta. Se toma el máximo numérico del conjunto: no existe jerarquía entre plataformas, los empates no alteran el resultado y nunca se promedian ni mezclan ediciones. ${observationPolicy}`
    : dimension.aggregation === "minimum"
      ? `Se usa el menor ${metric} entre las plataformas elegibles expresamente comprendidas por el contrato; no se promedian valores.`
      : dimension.aggregation === "arithmetic_mean"
        ? `Se calcula la media aritmética sin ponderar de todos los ${metric} elegibles expresamente comprendidos por el contrato, conservando la precisión publicada.`
        : `Solo se usa la ficha oficial de ${dimension.platform}; los valores de otras plataformas quedan fuera del contrato.`;
  const missingDataTreatment = dimension.aggregation === "maximum"
    ? `Cada ficha del conjunto elegible sin ${metric}, con «tbd» o sin dato queda fuera del máximo y no aporta ningún valor. Solo se cumple Sí cuando al menos una ficha del conjunto muestra una puntuación que supera el umbral; si ninguna aporta un valor, la condición de Sí no se cumple. Una ausencia no se transforma en cero ni en otra métrica.`
    : `Si en el instante de observación ${sourceName} no muestra el ${metric} exigido y solo aparece «tbd» o no hay dato, la condición de Sí no se cumple. La ausencia no se transforma en cero ni en otra métrica.`;
  return { contract: {
    metric,
    source_name: sourceName,
    source_domain: sourceDomain,
    metric_kind: metricKind,
    operator,
    threshold,
    comparison_text,
    unit: "points",
    scale_min: scale.min,
    scale_max: scale.max,
    precision: scale.precision,
    aggregation: dimension.aggregation,
    dimension_aggregation: dimension.aggregation,
    platform: dimension.platform || null,
    aggregate_description: aggregateDescription,
    excluded_metric: excludedMetric,
    platform_policy: platformPolicy,
    observation_policy: observationPolicy,
    observation_policy_version: METRIC_OBSERVATION_POLICY.version,
    capture_window_seconds: METRIC_OBSERVATION_POLICY.capture_window_seconds,
    missing_data_treatment: missingDataTreatment,
  }, error_code: null };
}

function metricThresholdContract(context) {
  return metricThresholdAnalysis(context).contract;
}

export function inferMetricContract(context) {
  return metricThresholdContract(repairInferenceContext(context));
}

function contractText(context) {
  const draft = isRecord(context?.draft) ? context.draft : {};
  const candidate = isRecord(context?.radar_candidate) ? context.radar_candidate : {};
  return [
    draft.question,
    draft.yes_criteria,
    candidate.source_question,
    candidate.source_title,
    candidate.source_resolution_rules,
    candidate.atinara_resolution_criteria,
    candidate?.provider_payload?.yes_sub_title,
  ].map((value) => cleanText(value, 5_000)).filter(Boolean).join(" ");
}

function parseLocalizedContractNumber(value) {
  const raw = cleanText(value, 80);
  if (!/^\d+(?:[.,]\d+)*$/.test(raw)) return null;
  if (!/[.,]/.test(raw)) {
    const integer = Number(raw);
    return Number.isSafeInteger(integer) ? { value: integer, decimal_places: 0, grouped: false } : null;
  }
  const dotCount = (raw.match(/\./g) || []).length;
  const commaCount = (raw.match(/,/g) || []).length;
  if (dotCount && commaCount) {
    const decimalSeparator = raw.lastIndexOf(".") > raw.lastIndexOf(",") ? "." : ",";
    const groupingSeparator = decimalSeparator === "." ? "," : ".";
    const [integerPart, fractionalPart, ...rest] = raw.split(decimalSeparator);
    if (rest.length || !/^\d{1,3}(?:[.,]\d{3})+$/.test(integerPart)
      || integerPart.includes(decimalSeparator) || !/^\d{1,2}$/.test(fractionalPart)) return null;
    const parsed = Number(`${integerPart.replaceAll(groupingSeparator, "")}.${fractionalPart}`);
    return Number.isFinite(parsed)
      ? { value: parsed, decimal_places: fractionalPart.length, grouped: true }
      : null;
  }
  const separator = dotCount ? "." : ",";
  const groups = raw.split(separator);
  if (groups.length > 2) {
    if (groups[0].length < 1 || groups[0].length > 3 || groups.slice(1).some((group) => group.length !== 3)) return null;
    const parsed = Number(groups.join(""));
    return Number.isSafeInteger(parsed) ? { value: parsed, decimal_places: 0, grouped: true } : null;
  }
  const fractionalDigits = groups[1].length;
  if (fractionalDigits === 3) {
    if (groups[0].length > 3) return null;
    const parsed = Number(groups.join(""));
    return Number.isSafeInteger(parsed) ? { value: parsed, decimal_places: 0, grouped: true } : null;
  }
  if (fractionalDigits < 1 || fractionalDigits > 2) return null;
  const parsed = Number(`${groups[0]}.${groups[1]}`);
  return Number.isFinite(parsed)
    ? { value: parsed, decimal_places: fractionalDigits, grouped: false }
    : null;
}

function parseMilestoneNumber(value, unit) {
  const parsed = parseLocalizedContractNumber(value);
  if (!parsed) return null;
  if (parsed.grouped && !/^(?:subscribers?|suscriptores?|followers?|seguidores?|viewers?|espectadores?|units?|unidades?|sales?|ventas?|downloads?|descargas?|copies?|copias?|votes?|votos?|seconds?|segundos?|minutes?|minutos?|hours?|horas?|usd|eur|dollars?|euros?)$/i.test(cleanText(unit, 40))) {
    return null;
  }
  return parsed.value;
}

function milestoneContract(context) {
  // Conserva `.` y `,` hasta que el parser locale decida si son agrupación o
  // decimal; normalize() los convertiría en espacios y reduciría 1,000,000 a 1.
  const source = foldContractText(contractText(context));
  const direct = source.match(/\b(above|over|greater than|more than|superior a|mas de|below|under|less than|inferior a|menos de|at least|al menos|at most|como maximo)\s+(\d+(?:[.,]\d+)*)(?:\s+([a-z%]+))?/)
    ?? source.match(/\b(reach\w*|alcanz\w*|exceed\w*|super\w*)\s+.*?\b(\d+(?:[.,]\d+)*)(?:\s+([a-z%]+))?/);
  if (!direct) return null;
  const cue = direct[1];
  const operator = ["above", "over", "greater than", "more than", "superior a", "mas de", "exceed", "exceeds", "exceeding", "superara", "superará"].includes(cue)
    || cue.startsWith("exceed") || cue.startsWith("super") ? ">"
    : ["below", "under", "less than", "inferior a", "menos de"].includes(cue) ? "<"
      : ["at most", "como maximo"].includes(cue) ? "<=" : ">=";
  const capturedUnit = /^(?:before|by|on|after|antes|para|hasta|el|la)$/i.test(cleanText(direct[3], 40))
    ? "" : cleanText(direct[3], 40);
  const unit = capturedUnit || "unidades";
  const threshold = parseMilestoneNumber(direct[2], capturedUnit);
  if (!Number.isFinite(threshold)) return null;
  const comparison_text = operator === ">" ? `más de ${threshold} ${unit}`
    : operator === "<" ? `menos de ${threshold} ${unit}`
      : operator === ">=" ? `al menos ${threshold} ${unit}` : `como máximo ${threshold} ${unit}`;
  return { operator, threshold, unit, comparison_text };
}

function awardName(context) {
  const raw = contractText(context);
  const named = raw.match(/(?:premio|galardón|galardon|award)\s+(?:de\s+|for\s+)?(.+?)(?=\s+(?:before|antes\s+(?:de|del|de la)|by|on)\b|[?.]|$)/i);
  const afterVerb = raw.match(/\b(?:win|receive)\s+(?:the\s+)?(.+?)(?=\s+(?:before|by|on)\b|[?.]|$)/i);
  return cleanText(afterVerb?.[1] ?? named?.[1], 300) || null;
}

function presenceEvent(context) {
  const raw = contractText(context);
  const match = raw.match(/\b(?:at|in|en|a)\s+(?:el\s+|la\s+|the\s+)?(.+?)(?=\s+(?:before|antes\s+(?:de|del|de la)|by|on)\b|[?.]|$)/i);
  return cleanText(match?.[1], 300) || null;
}

function platformName(context) {
  const raw = contractText(context);
  const match = raw.match(/\b(PlayStation\s*[45]|PS[45]|Xbox\s+Series\s+[XS]|Xbox\s+One|Nintendo\s+Switch(?:\s*2)?|Steam|Windows|PC|macOS|iOS|Android)\b/i);
  return cleanText(match?.[1], 120) || null;
}

function originalQuestion(context) {
  const draft = isRecord(context?.draft) ? context.draft : {};
  const candidate = isRecord(context?.radar_candidate) ? context.radar_candidate : {};
  const value = cleanText(draft.question || candidate.source_question, 700);
  if (value.length < 20 || /\b(?:exito|importante|grande|pronto|el proximo|el ultimo|este evento)\b/.test(normalize(value))) return "";
  return value.startsWith("¿") || value.endsWith("?") ? value : `¿${value}?`;
}

function coverContract(context) {
  const draft = isRecord(context?.draft) ? context.draft : {};
  const candidate = isRecord(context?.radar_candidate) ? context.radar_candidate : {};
  const values = [draft.question, candidate.source_question, draft.yes_criteria, candidate.source_resolution_rules]
    .map((value) => cleanText(value, 1_500).replace(/^[¿?]+|[¿?]+$/g, "").trim())
    .filter(Boolean);
  const patterns = [
    /^(?:estará|estara)\s+(.+?)\s+en\s+la\s+portada\s+de\s+(.+?)(?=\s+(?:antes|para|hasta)\b|[?.,]|$)/i,
    /^(.+?)\s+(?:estará|estara)\s+en\s+la\s+portada\s+de\s+(.+?)(?=\s+(?:antes|para|hasta)\b|[?.,]|$)/i,
    /^(?:será|sera)\s+(.+?)\s+(?:el|la)\s+(?:atleta|deportista)\s+de\s+portada\s+de\s+(.+?)(?=\s+(?:antes|para|hasta)\b|[?.,]|$)/i,
    /^will\s+(.+?)\s+be\s+(?:the\s+)?(.+?)\s+cover\s+athlete(?=\s+(?:before|by|on)\b|[?.,]|$)/i,
    /^will\s+(.+?)\s+be\s+(?:the\s+)?cover\s+athlete\s+(?:of|for)\s+(.+?)(?=\s+(?:before|by|on)\b|[?.,]|$)/i,
    /^will\s+(.+?)\s+be\s+on\s+(?:the\s+)?cover\s+(?:of|for)\s+(.+?)(?=\s+(?:before|by|on)\b|[?.,]|$)/i,
  ];
  const contracts = new Map();
  for (const value of values) {
    for (const pattern of patterns) {
      const match = value.match(pattern);
      const participant = titleCaseSubject(match?.[1]);
      const product = titleCaseSubject(match?.[2]);
      if (!participant || !product) continue;
      const key = `${subjectIdentityKey(participant)}::${subjectIdentityKey(product)}`;
      if (!contracts.has(key)) contracts.set(key, { participant, product });
      break;
    }
  }
  if (contracts.size > 1) {
    return {
      participant: "",
      product: "",
      ambiguous: true,
      alternatives: [...contracts.values()].flatMap((item) => [item.participant, item.product]),
    };
  }
  if (contracts.size !== 1) return null;
  const contract = [...contracts.values()][0];
  return identityAlternatives(contract.participant).length || identityAlternatives(contract.product).length
    ? { ...contract, ambiguous: true }
    : { ...contract, ambiguous: false };
}

/** @param {unknown} context @param {string|null} [archetype] */
export function inferSubject(context, archetype = null) {
  context = repairInferenceContext(context);
  archetype = cleanText(archetype, 80) || inferArchetype(context);
  const draft = isRecord(context?.draft) ? context.draft : context ?? {};
  const candidate = isRecord(context?.radar_candidate) ? context.radar_candidate : {};
  const cover = coverContract(context);
  if (cover && !cover.ambiguous) return cover.product;
  const structured = structuredSubject(context, archetype);
  const familySemantics = isRecord(candidate.family_semantics) ? candidate.family_semantics : {};
  const familyEntity = titleCaseSubject(isRecord(candidate.family_semantics)
    ? candidate.family_semantics.entity_label : "");
  const familyIdentityTrusted = ["atinara-market-family-v4", "atinara-market-family-v5"].includes(candidate.family_version)
    && familySemantics.identity_ambiguous !== true
    && familyEntity.length >= 2
    && (!structured || evidenceMentionsSubject(structured, familyEntity));
  if (familyIdentityTrusted) return familyEntity;
  // En contratos métricos, la proposición estructurada es más autoritativa que
  // un subject editorial que pudo guardar el sufijo «: Metacritic score».
  if (archetype === "metric_threshold" && structured) return structured;
  const explicit = titleCaseSubject(archetype === "metric_threshold"
    ? subjectCandidate(draft.subject, archetype)
    : draft.subject);
  if (explicit.length >= 2 && !/^(?:se|will|será|sera|tendrá|tendra|ganará|ganara|superará|superara|aparecerá|aparecera)\b/i.test(explicit)) {
    return explicit;
  }
  if (structured) {
    const compactStructured = normalize(structured).replace(/\s+/g, "");
    if (/^[a-z]{2,8}\d{1,3}$/.test(compactStructured)) {
      const rawContext = [draft.question, draft.yes_criteria, candidate.source_question, candidate.source_title, candidate.source_resolution_rules]
        .map((value) => cleanText(value, 1_500)).join(" ");
      const expanded = rawContext.match(/\b(?:[A-Z][A-Za-zÀ-ÿ]*[A-Z][A-Za-zÀ-ÿ]*|[A-Z][a-zÀ-ÿ]+)(?:\s+[A-Z][A-Za-zÀ-ÿ]+){0,3}\s+\d{1,3}\b/g)
        ?.find((value) => acronym(value) === compactStructured);
      if (expanded && normalize(expanded) !== normalize(structured)) return `${expanded} / ${structured}`;
    }
    return structured;
  }
  if ([
    "product_release", "milestone_threshold", "award_winner", "event_presence",
    "platform_variant", "deadline_ladder_child", "generic_binary_event",
  ].includes(archetype)) return "";
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

function durationSeconds(context) {
  return durationContract(context).seconds;
}

function durationContract(context) {
  const draft = isRecord(context?.draft) ? context.draft : {};
  const candidate = isRecord(context?.radar_candidate) ? context.radar_candidate : {};
  const source = foldContractText([draft.question, draft.yes_criteria, candidate.source_question, candidate.source_resolution_rules, candidate.atinara_resolution_criteria].join(" "));
  const match = source.match(/(?:at least|al menos|minimo|minimo de)\s+(\d+(?:[.,]\d+)*)\s+(seconds?|segundos?)/);
  if (!match) return { declared: false, seconds: null };
  const value = parseMilestoneNumber(match[1], match[2]);
  return {
    declared: true,
    seconds: Number.isSafeInteger(value) && value > 0 && value <= 3_600 ? value : null,
  };
}

function addDay(iso, days) {
  return new Date(new Date(iso).getTime() + days * 86_400_000).toISOString();
}

export function deriveResolutionDeadline(
  evaluationEndsAt,
  existingValues = [],
  policy = RESOLUTION_DEADLINE_POLICY,
) {
  const evaluation = new Date(cleanText(evaluationEndsAt, 100));
  if (!Number.isFinite(evaluation.getTime())) return null;
  for (const value of Array.isArray(existingValues) ? existingValues : [existingValues]) {
    const existing = new Date(cleanText(value, 100));
    if (Number.isFinite(existing.getTime()) && existing > evaluation) return existing.toISOString();
  }
  const sourceDelay = Math.max(0, Math.min(
    Number(policy?.source_availability_delay_seconds) || 0,
    Number(policy?.maximum_margin_seconds) || RESOLUTION_DEADLINE_POLICY.maximum_margin_seconds,
  ));
  const reviewMargin = Math.max(0, Math.min(
    Number(policy?.human_review_margin_seconds) || 0,
    Number(policy?.maximum_margin_seconds) || RESOLUTION_DEADLINE_POLICY.maximum_margin_seconds,
  ));
  const deadline = evaluation.getTime() + (sourceDelay + reviewMargin) * 1_000;
  return deadline > evaluation.getTime() ? new Date(deadline).toISOString() : addDay(evaluation.toISOString(), 1);
}

function sourceObject(value) {
  if (!isRecord(value)) return null;
  const url = safePublicUrl(value.url);
  if (!url) return null;
  const excerpt = cleanText(value.excerpt ?? value.content ?? value.supports ?? value.snippet, 2_000);
  const role = cleanText(value.role, 80) || "Fuente oficial alternativa";
  const claimSlots = Array.isArray(value.claim_slots)
    ? [...new Set(value.claim_slots.map((slot) => cleanText(slot, 80).toUpperCase()).filter(Boolean))].slice(0, 12)
    : [];
  return {
    url,
    name: cleanText(value.name ?? value.title ?? new URL(url).hostname, 240),
    publisher: cleanText(value.publisher ?? new URL(url).hostname, 240),
    role,
    ...(excerpt ? { excerpt } : {}),
    ...(value.validated_reachable === true ? { validated_reachable: true } : {}),
    ...(value.authority_verified === true ? { authority_verified: true } : {}),
    ...(value.relevance_verified === true ? { relevance_verified: true } : {}),
    ...(cleanText(value.authority_basis, 120) ? { authority_basis: cleanText(value.authority_basis, 120) } : {}),
    ...(cleanText(value.relevance_basis, 120) ? { relevance_basis: cleanText(value.relevance_basis, 120) } : {}),
    ...(value.registry_role_verified === true ? { registry_role_verified: true } : {}),
    ...(/^[0-9a-f-]{36}$/i.test(cleanText(value.registry_source_id, 80))
      ? { registry_source_id: cleanText(value.registry_source_id, 80).toLowerCase() } : {}),
    ...(cleanText(value.registry_parser_version, 120)
      ? { registry_parser_version: cleanText(value.registry_parser_version, 120) } : {}),
    ...(cleanText(value.registry_domain, 255)
      ? { registry_domain: cleanText(value.registry_domain, 255).toLowerCase() } : {}),
    ...(cleanText(value.registry_role, 80) ? { registry_role: cleanText(value.registry_role, 80) } : {}),
    ...(Array.isArray(value.registry_categories)
      ? { registry_categories: value.registry_categories.map((category) => cleanText(category, 120)).filter(Boolean).slice(0, 20) } : {}),
    ...(cleanText(value.draft_category, 120) ? { draft_category: cleanText(value.draft_category, 120) } : {}),
    ...(cleanText(value.validation_version, 120) ? { validation_version: cleanText(value.validation_version, 120) } : {}),
    ...(claimSlots.length ? { claim_slots: claimSlots } : {}),
    ...(value.required === true && role.toUpperCase() === "CONTEXT_SOURCE"
      && claimSlots.includes("TEMPORAL_ANCHOR") ? { required: true } : {}),
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

export function mergeVerifiedAlternativeSources(...collections) {
  return mergeAlternativeSources(...collections).filter((source) => source.validated_reachable === true
    && source.authority_verified === true
    && source.relevance_verified === true
    && cleanText(source.role, 80).toUpperCase() !== "PRIMARY_RESOLUTION");
}

/** @param {unknown} value @param {string|null} [category] */
export function isVerifiedPrimarySource(value, category = null) {
  if (!isRecord(value)) return false;
  const url = safePublicUrl(value.url);
  const registryDomain = primaryRegistryDomain(value.registry_domain);
  const hostname = url ? new URL(url).hostname.toLowerCase().replace(/^www\./, "").replace(/\.$/, "") : "";
  const attestedCategory = cleanText(value.draft_category, 120);
  const expectedCategory = cleanText(category, 120);
  const registryCategories = Array.isArray(value.registry_categories)
    ? value.registry_categories.map((item) => normalize(cleanText(item, 120))).filter(Boolean) : null;
  const parserVersion = cleanText(value.registry_parser_version, 120);
  const accountHandle = publicAccountProfileHandle(url);
  const accountScoped = parserVersion === PUBLIC_ACCOUNT_SOURCE_PARSER_VERSION;
  const accountIdentityMatches = !accountScoped || Boolean(
    accountHandle
    && cleanText(value.account_handle, 20).toLowerCase() === accountHandle
    && cleanText(value.identity_scope, 80) === PUBLIC_ACCOUNT_IDENTITY_SCOPE
  );
  const categoryMatches = Boolean(attestedCategory)
    && (!expectedCategory || normalize(expectedCategory) === normalize(attestedCategory))
    && Array.isArray(registryCategories)
    && (registryCategories.length === 0 || registryCategories.includes(normalize(attestedCategory)));
  return Boolean(
    url
    && registryDomain
    && (hostname === registryDomain || hostname.endsWith(`.${registryDomain}`))
    && categoryMatches
    && cleanText(value.role, 80).toUpperCase() === "PRIMARY_RESOLUTION"
    && value.validated_reachable === true
    && value.authority_verified === true
    && value.relevance_verified === true
    && value.registry_role_verified === true
    && cleanText(value.authority_basis, 120) === "private_source_registry_primary_resolution_v1"
    && cleanText(value.validation_version, 120) === PRIMARY_SOURCE_VALIDATION_VERSION
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(cleanText(value.registry_source_id, 80))
    && cleanText(value.registry_role, 80) === PRIMARY_SOURCE_REGISTRY_ROLE
    && parserVersion
    && accountIdentityMatches
    && ["fetched_content_v1", "fetched_content_and_canonical_url_v1"]
      .includes(cleanText(value.relevance_basis, 120)));
}

export function hasCurrentPrimarySourceAttestation(draft, nowMs = Date.now()) {
  if (!isRecord(draft) || !isRecord(draft.primary_source)
    || !isRecord(draft._primary_source_attestation)) return false;
  const source = draft.primary_source;
  const attestation = draft._primary_source_attestation;
  const sourceUrl = safePublicUrl(source.url);
  const finalUrl = safePublicUrl(attestation.final_url);
  const checkedAt = new Date(cleanText(attestation.checked_at, 100)).getTime();
  const expiresAt = new Date(cleanText(attestation.expires_at, 100)).getTime();
  const version = Number(draft.content_version);
  const attestedVersion = Number(attestation.draft_version);
  const fingerprint = cleanText(draft.content_fingerprint, 64).toLowerCase();
  const attestedFingerprint = cleanText(attestation.content_fingerprint, 64).toLowerCase();
  const draftId = cleanText(draft.id, 80).toLowerCase();
  const attestedDraftId = cleanText(attestation.draft_id, 80).toLowerCase();
  const registrySourceId = cleanText(source.registry_source_id, 80).toLowerCase();
  const attestedRegistrySourceId = cleanText(attestation.registry_source_id, 80).toLowerCase();
  return attestation.verified === true
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      .test(cleanText(attestation.check_id, 80))
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(draftId)
    && attestedDraftId === draftId
    && Number.isSafeInteger(version) && version > 0 && attestedVersion === version
    && /^[0-9a-f]{64}$/.test(fingerprint) && attestedFingerprint === fingerprint
    && sourceUrl !== null && finalUrl === sourceUrl
    && registrySourceId !== "" && attestedRegistrySourceId === registrySourceId
    && cleanText(attestation.validation_version, 120) === PRIMARY_SOURCE_VALIDATION_VERSION
    && cleanText(source.validation_version, 120) === PRIMARY_SOURCE_VALIDATION_VERSION
    && source.registry_role_verified === true
    && source.authority_verified === true
    && source.relevance_verified === true
    && source.validated_reachable === true
    && Number.isFinite(checkedAt) && checkedAt <= nowMs + 60_000
    && Number.isFinite(expiresAt) && expiresAt > nowMs && expiresAt > checkedAt;
}

export function attestedPrimarySourceRefutesIssue(issue, draft, nowMs = Date.now()) {
  if (!isRecord(issue)
    || cleanText(issue.code, 80).toUpperCase() !== "INSUFFICIENT_EVIDENCE"
    || cleanText(issue.field, 80).toLowerCase() !== "primary_source"
    || !hasCurrentPrimarySourceAttestation(draft, nowMs)) return false;
  const message = normalize(issue.message);
  // La atestacion de red puede refutar existencia, acceso, registro o encaje
  // del producto. No refuta objeciones contractuales genuinas como retencion,
  // granularidad historica o disponibilidad futura del valor.
  return /\b(?:inexistente|inaccesible|inalcanzable|nonexistent|unreachable)\b/.test(message)
    || /\bno (?:existe|contiene|incluye) (?:el |la )?(?:producto|sujeto|juego|pagina|product|subject|game|page)\b/.test(message)
    || /\bdoes not (?:exist|contain|include) (?:the )?(?:product|subject|game|page)\b/.test(message)
    || /\b(?:url|fuente|source)\b.{0,80}\b(?:invalida|invalid|no valida|not valid)\b/.test(message);
}

export function inferPrimarySource(context, subject = null, archetype = null, discoveredSources = []) {
  context = repairInferenceContext(context);
  subject = cleanText(subject, 500) || inferSubject(context);
  archetype = cleanText(archetype, 80) || inferArchetype(context);
  void subject;
  void archetype;
  const draft = isRecord(context?.draft) ? context.draft : {};
  const candidate = isRecord(context?.radar_candidate) ? context.radar_candidate : {};
  const category = cleanText(context?.proposed_category || draft.category || candidate.atinara_category, 120);
  for (const value of Array.isArray(discoveredSources) ? discoveredSources : []) {
    if (!isVerifiedPrimarySource(value, category)) continue;
    const url = safePublicUrl(value?.url);
    if (!url) continue;
    return {
      url,
      name: cleanText(value.name ?? value.publisher, 240) || new URL(url).hostname,
      publisher: cleanText(value.publisher ?? value.name, 240),
      role: "PRIMARY_RESOLUTION",
      validated_reachable: true,
      authority_verified: true,
      relevance_verified: true,
      registry_role_verified: true,
      registry_source_id: cleanText(value.registry_source_id, 80).toLowerCase(),
      registry_domain: cleanText(value.registry_domain, 255).toLowerCase(),
      registry_parser_version: cleanText(value.registry_parser_version, 120),
      registry_role: PRIMARY_SOURCE_REGISTRY_ROLE,
      registry_categories: Array.isArray(value.registry_categories)
        ? value.registry_categories.map((category) => cleanText(category, 120)).filter(Boolean).slice(0, 20) : [],
      draft_category: cleanText(value.draft_category, 120),
      authority_basis: "private_source_registry_primary_resolution_v1",
      relevance_basis: cleanText(value.relevance_basis, 120),
      ...(cleanText(value.identity_scope, 80) ? {
        identity_scope: cleanText(value.identity_scope, 80),
        account_handle: cleanText(value.account_handle, 20).toLowerCase(),
      } : {}),
      validation_version: cleanText(value.validation_version, 120),
    };
  }
  return null;
}

function requiredArchetypeSlots(context, archetype, subject, publisher, duration) {
  const slots = {
    subject,
    publisher,
    metric: archetype === "metric_threshold" ? metricThresholdContract(context) : null,
    milestone: archetype === "milestone_threshold" ? milestoneContract(context) : null,
    award: archetype === "award_winner" ? awardName(context) : null,
    event: archetype === "event_presence" ? presenceEvent(context) : null,
    platform: archetype === "platform_variant" ? platformName(context) : null,
    canonical_question: ["deadline_ladder_child", "generic_binary_event"].includes(archetype) ? originalQuestion(context) : null,
    duration,
  };
  const required = {
    official_announcement: ["subject", "publisher"],
    product_release: ["subject"],
    content_release: ["subject", "publisher"],
    // Métrica/hito tienen una escalada tipada propia después de esta puerta.
    metric_threshold: ["subject"],
    milestone_threshold: ["subject"],
    award_winner: ["subject", "award"],
    event_presence: ["subject", "event"],
    platform_variant: ["subject", "platform"],
    // La pregunta original puede estar precisamente objetada. Con sujeto y
    // periodo inequívocos el constructor genera una pregunta canónica nueva.
    deadline_ladder_child: ["subject"],
    generic_binary_event: ["subject"],
  }[archetype] ?? ["subject"];
  const missing = required.filter((slot) => !slots[slot]);
  const durationDeclared = durationContract(context).declared;
  if (archetype === "content_release" && durationDeclared && !duration) missing.push("duration");
  return { slots, missing: [...new Set(missing)] };
}

function safeMarketSlug(value, subject, archetype, deadline) {
  const current = cleanText(value, 120).toLowerCase();
  if (/^[a-z0-9][a-z0-9-]{2,119}$/.test(current)) return current;
  const base = cleanText(`${subject}-${archetype}-${deadline?.iso?.slice(0, 10) ?? "market"}`, 240)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 119)
    .replace(/-+$/g, "");
  return /^[a-z0-9][a-z0-9-]{2,119}$/.test(base) ? base : "market-definition-repair";
}

function commonTreatments(archetype, timezone) {
  const content = archetype === "content_release";
  const effectiveTimezone = validIanaTimezone(timezone) ? cleanText(timezone, 100) : "la zona horaria contractual";
  return {
    delay_treatment: "Los retrasos o anuncios de calendario no resuelven anticipadamente el mercado; se comprueba el hecho definido al finalizar el periodo.",
    cancellation_treatment: "Una cancelación oficial no equivale por sí sola al hecho afirmado. Si el periodo termina sin la evidencia exigida, el resultado es No.",
    leak_treatment: content
      ? "Filtraciones, copias no autorizadas y publicaciones de terceros no cuentan. Solo cuenta una publicación oficial y pública de la entidad responsable."
      : "Rumores, filtraciones, patentes, registros y material no autorizado no cuentan como anuncio o lanzamiento oficial.",
    rename_treatment: "Un cambio de nombre conserva la identidad únicamente cuando la fuente oficial confirma de forma inequívoca la continuidad del mismo producto o acontecimiento.",
    assumptions: `Todas las horas se interpretan en ${effectiveTimezone}, conforme a los instantes persistidos del contrato. Una fuente retirada requiere evidencia fechada conservada y corroboración; un conflicto material entre fuentes primarias detiene la resolución para revisión humana específica.`,
  };
}

function archetypeCriteria(archetype, subject, publisher, deadline, duration, context, timezone) {
  const label = dateLabel(deadline);
  const metric = archetype === "metric_threshold" ? metricThresholdContract(context) : null;
  const limit = deadlineLabel(deadline, timezone);
  if (archetype === "metric_threshold" && metric) {
    const comparison = metric.comparison_text;
    const relative = isRecord(deadline.relative_anchor) ? deadline.relative_anchor : null;
    const relativeClause = relative
      ? ` Este instante corresponde a ${relative.offset_days} días después del ${relative.anchor_type} contractual fechado el ${relative.anchor_date}. La fecha-ancla queda fijada por la evidencia oficial fechada conservada durante la preparación; cambios posteriores de la página no desplazan el instante contractual.`
      : "";
    return {
      timezone,
      question: `¿Será ${comparison} ${metric.aggregate_description} de ${subject} en el instante de observación ${limit}${relative ? `, ${relative.offset_days} días después del ${relative.anchor_type} contractual` : ""}?`,
      yes_criteria: `Se resuelve a Sí si, exactamente en ${limit}, ${metric.source_name} muestra para ${subject} el dato exigido y ${metric.aggregate_description} es ${comparison} (${metric.operator} ${metric.threshold}) en su escala contractual de ${metric.scale_min} a ${metric.scale_max}.${relativeClause} ${metric.platform_policy}`,
      no_criteria: `Se resuelve a No si, exactamente en ${limit}, ${metric.aggregate_description} no es ${comparison} (${metric.operator} ${metric.threshold}), o se aplica el tratamiento de dato ausente.${relativeClause} ${metric.missing_data_treatment}`,
      edge_cases: `La métrica contratada es exclusivamente ${metric.metric}, con escala de ${metric.scale_min} a ${metric.scale_max} y precisión publicada de ${metric.precision} decimal(es); ${metric.excluded_metric} queda excluido. ${metric.platform_policy} Se conserva la evidencia fechada de la única sesión de observación y los cambios posteriores no alteran el resultado. Una retirada de la página o un conflicto material entre fuentes detiene la resolución para revisión humana específica, sin inventar, sustituir ni redondear datos.`,
      public_criteria: `Atinara iniciará en ${limit} una única sesión de observación de ${metric.aggregate_description} de ${subject}, con una ventana máxima de ${metric.capture_window_seconds} segundos.${relativeClause} El resultado será Sí exactamente cuando el valor congelado cumpla ${metric.operator} ${metric.threshold}; ${metric.excluded_metric} no sustituye la métrica contratada y «tbd» no cuenta como puntuación.`,
      metric,
    };
  }
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
  if (archetype === "milestone_threshold") {
    const milestone = milestoneContract(context);
    if (milestone) {
      return {
        timezone,
        question: `¿Alcanzará ${subject} ${milestone.comparison_text} no más tarde de ${limit}?`,
        yes_criteria: `Se resuelve a Sí si una fuente primaria pública y autorizada registra para ${subject} un valor que cumpla ${milestone.operator} ${milestone.threshold} ${milestone.unit} en cualquier instante no posterior a ${limit}.`,
        no_criteria: `Se resuelve a No si al llegar ${limit} ninguna observación válida de la fuente primaria ha cumplido ${milestone.operator} ${milestone.threshold} ${milestone.unit}.`,
        edge_cases: "Se aplica el operador de forma literal, sin redondear ni convertir unidades después de observar el resultado. Correcciones posteriores solo cuentan si la fuente las fecha dentro del periodo. Datos estimados, capturas sin procedencia, valores de terceros y picos no verificables quedan excluidos; un conflicto de fuente detiene la resolución.",
        public_criteria: `Atinara verificará hasta ${limit} si la métrica oficial de ${subject} cumple ${milestone.operator} ${milestone.threshold} ${milestone.unit}; el operador y la unidad no se reinterpretan.`,
        milestone,
      };
    }
  }
  if (archetype === "award_winner") {
    const award = awardName(context);
    return {
      timezone,
      question: `¿Ganará ${subject} ${award} no más tarde de ${limit}?`,
      yes_criteria: `Se resuelve a Sí si la organización oficial del premio declara públicamente a ${subject} ganador de ${award} no más tarde de ${limit}.`,
      no_criteria: `Se resuelve a No cuando la organización oficial publique un ganador distinto para ${award}, o si al llegar ${limit} no existe una declaración oficial que cumpla el criterio de Sí.`,
      edge_cases: "Una nominación, preselección, premio de votación distinto, categoría homónima o mención honorífica no equivale a ganar la categoría contratada. En un empate oficial cuentan todos los ganadores únicamente si las reglas publicadas lo reconocen como resultado final. Rectificaciones oficiales se evalúan por su fecha y un conflicto material detiene la resolución.",
      public_criteria: `Atinara usará el resultado final publicado por la organización de ${award}; nominaciones, encuestas y predicciones no cuentan como victoria.`,
    };
  }
  if (archetype === "event_presence") {
    const event = presenceEvent(context);
    return {
      timezone,
      question: `¿Participará ${subject} en ${event} no más tarde de ${limit}?`,
      yes_criteria: `Se resuelve a Sí si existe evidencia primaria pública y fechada de que ${subject} participa o aparece efectivamente en ${event} dentro del periodo que termina en ${limit}.`,
      no_criteria: `Se resuelve a No si ${event} concluye sin la participación o aparición efectiva definida en el criterio de Sí, o si al llegar ${limit} no existe esa evidencia primaria.`,
      edge_cases: "Un anuncio de asistencia, inclusión en una agenda preliminar, representación por terceros o material pregrabado solo cuenta cuando el contrato de origen lo equipara expresamente a participación. Cancelaciones y sustituciones no cuentan; cambios de nombre requieren continuidad oficial inequívoca y los conflictos de evidencia detienen la resolución.",
      public_criteria: `Atinara comprobará evidencia oficial de la participación efectiva de ${subject} en ${event} hasta ${limit}; una invitación o agenda provisional por sí sola no basta.`,
    };
  }
  if (archetype === "platform_variant") {
    const platform = platformName(context);
    return {
      timezone,
      question: `¿Tendrá ${subject} una versión oficial y nativa para ${platform} no más tarde de ${limit}?`,
      yes_criteria: `Se resuelve a Sí si el editor o titular autorizado publica comercialmente una versión oficial y nativa de ${subject} para ${platform} no más tarde de ${limit}.`,
      no_criteria: `Se resuelve a No si al llegar ${limit} no existe la versión oficial y nativa definida en el criterio de Sí.`,
      edge_cases: "La retrocompatibilidad, juego remoto, emulación, streaming, un port no publicado, una ficha de tienda sin disponibilidad y una versión para otra plataforma no cuentan. Ediciones del mismo juego base cuentan solo si ejecutan una versión nativa oficialmente identificada para la plataforma contratada.",
      public_criteria: `Atinara comprobará una versión comercial oficial y nativa de ${subject} para ${platform} hasta ${limit}; compatibilidad y streaming no equivalen a una versión.`,
    };
  }
  const cover = coverContract(context);
  if (["deadline_ladder_child", "generic_binary_event"].includes(archetype) && cover && !cover.ambiguous) {
    const canonical = originalQuestion(context)
      || `¿Estará ${cover.participant} en la portada oficial de ${cover.product} no más tarde de ${limit}?`;
    return {
      timezone,
      question: canonical,
      yes_criteria: `Se resuelve a Sí si el editor o titular oficial de ${cover.product} identifica públicamente a ${cover.participant} como atleta o figura de una portada oficial comprendida por el contrato no más tarde de ${limit}.`,
      no_criteria: `Se resuelve a No si al llegar ${limit} ninguna portada oficial comprendida por el contrato identifica a ${cover.participant}, o la fuente primaria publica como resultado final únicamente otra persona o composición.`,
      edge_cases: `Una candidatura, rumor, filtración, montaje de terceros o voto no cuenta. Una portada regional, edición especial o portada compartida solo cuenta si está comprendida literalmente por la pregunta original; el Corrector no declara por sí mismo qué variantes cuentan. Una rectificación oficial se evalúa por su fecha y evidencia primaria contradictoria detiene la resolución.`,
      public_criteria: `Atinara comprobará en la fuente oficial de ${cover.product} si ${cover.participant} figura en una portada oficial comprendida por la pregunta hasta ${limit}; no inferirá el resultado de cuotas, rumores ni ausencia en una lista provisional.`,
    };
  }
  if (archetype === "deadline_ladder_child" || archetype === "generic_binary_event") {
    const canonical = originalQuestion(context) || (archetype === "deadline_ladder_child"
      ? `¿Ocurrirá ${subject} no más tarde de ${limit}?`
      : `¿Se cumplirá el hecho verificable relativo a ${subject} no más tarde de ${limit}?`);
    const statement = canonical.replace(/^[¿?]+|[¿?]+$/g, "").trim();
    return {
      timezone,
      question: canonical,
      yes_criteria: `Se resuelve a Sí si una fuente primaria pública y autorizada confirma de forma inequívoca, no más tarde de ${limit}, la proposición contractual exacta «${statement}».`,
      no_criteria: `Se resuelve a No si al finalizar el periodo en ${limit} la fuente primaria confirma que la proposición contractual exacta «${statement}» es falsa, o no existe evidencia que cumpla íntegramente el criterio de Sí.`,
      edge_cases: "No cuentan rumores, inferencias, publicaciones de terceros ni evidencia sin fecha. Los términos de la pregunta se interpretan literalmente y no se amplían después de conocer el resultado. Cambios de identidad requieren continuidad oficial; evidencia primaria contradictoria detiene la resolución para revisión humana específica.",
      public_criteria: `Atinara comprobará literalmente la proposición «${statement}» con evidencia primaria fechada hasta ${limit}, sin reinterpretar el contrato después de conocer el resultado.`,
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

function identityAlternatives(value) {
  const disjunction = cleanText(value, 500).replace(/^(?:either|ya\s+sea)\s+/i, "");
  let inferredAlternatives = disjunction.split(/\s+(?:o|u|or)\s+/i).map((item) => cleanText(item, 300)).filter(Boolean);
  if (inferredAlternatives.length < 2 && /\s*\/\s*/.test(disjunction)) {
    const slashAlternatives = disjunction.split(/\s*\/\s*/).map((value) => cleanText(value, 300)).filter(Boolean);
    if (slashAlternatives.length >= 2) {
      const [left, right] = slashAlternatives;
      const leftCompact = normalize(left).replace(/\s+/g, "");
      const rightCompact = normalize(right).replace(/\s+/g, "");
      const aliases = leftCompact === rightCompact
        || acronym(left) === rightCompact
        || acronym(right) === leftCompact;
      if (!aliases) inferredAlternatives = slashAlternatives;
    }
  }
  return inferredAlternatives.length >= 2 ? inferredAlternatives : [];
}

function verifiedPrimaryPublisher(primarySource) {
  const publisher = cleanText(primarySource?.publisher, 240);
  return publisher && identityAlternatives(publisher).length < 2 ? publisher : null;
}

export function detectIrreducibleAmbiguity(context) {
  const conflicts = Array.isArray(context?.primary_source_conflicts) ? context.primary_source_conflicts.filter(isRecord) : [];
  const declaredAlternatives = Array.isArray(context?.subject_alternatives)
    ? context.subject_alternatives.map((value) => cleanText(value, 300)).filter(Boolean) : [];
  const inferredAlternatives = identityAlternatives(inferSubject(context));
  const cover = coverContract(context);
  const coverAlternatives = cover?.ambiguous === true
    ? (Array.isArray(cover.alternatives) ? cover.alternatives : identityAlternatives(cover.participant)) : [];
  const alternatives = [...new Set([...declaredAlternatives, ...inferredAlternatives, ...coverAlternatives])];
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

function hasObjectiveEventPredicate(context) {
  // Solo la proposición que se conservaría en el mercado puede aportar el
  // predicado. «Una fuente publica/confirma que ocurrió» describe evidencia,
  // no define el acontecimiento y nunca repara un contrato tautológico.
  const cover = coverContract(context);
  if (cover && !cover.ambiguous) return true;
  const source = normalize(originalQuestion(context));
  return /\b(?:sign\w*|acquir\w*|approv\w*|authoriz\w*|register\w*|open\w*|clos\w*|start\w*|begin\w*|end(?:s|ed|ing)?|complet\w*|cancel\w*|merg\w*|qualif\w*|elect\w*|appoint\w*|resign\w*|ship\w*|receiv\w*|obtain\w*|firm\w*|adquir\w*|aprob\w*|autoriz\w*|registr\w*|abrir\w*|cerr\w*|comenz\w*|inici\w*|termin\w*|complet\w*|cancel\w*|fusion\w*|clasific\w*|eleg\w*|nombr\w*|dimit\w*|recib\w*|obtendr\w*)\b/.test(source);
}

function contradictoryContractConflict(context) {
  if (!repairIssueCodeSet(context).has("CONTRADICTORY_CRITERIA")) return null;
  const draft = isRecord(context?.draft) ? context.draft : {};
  const candidate = isRecord(context?.radar_candidate) ? context.radar_candidate : {};
  const signals = [
    draft.question,
    draft.yes_criteria,
    candidate.source_question,
    candidate.source_resolution_rules,
    candidate.atinara_resolution_criteria,
  ].map((value) => cleanText(value, 5_000)).filter(Boolean);
  const deadlines = new Map();
  const predicates = new Map();
  for (const signal of signals) {
    const deadline = inferInclusiveDeadline(signal);
    if (deadline) deadlines.set(deadline.iso, signal);
    const predicate = inferArchetype({ draft: { question: signal } });
    if (predicate && predicate !== "generic_binary_event") predicates.set(predicate, signal);
  }
  if (deadlines.size <= 1 && predicates.size <= 1) return null;
  return {
    code: "CONTRACT_CONFLICT",
    field: deadlines.size > 1 ? "evaluation_period" : "market_definition",
    evidence: [...new Set([...deadlines.values(), ...predicates.values()])].slice(0, 8),
    alternatives: [
      ...[...deadlines.keys()].map((value) => ({ kind: "deadline", value })),
      ...[...predicates.keys()].map((value) => ({ kind: "predicate", value })),
    ],
    reason: "Las señales contractuales no objetadas conservan fechas o predicados materiales incompatibles; no existe una precedencia autoritativa que permita elegir uno sin cambiar el mercado.",
  };
}

export function buildDeterministicRepair(context, discoveredSources = []) {
  context = repairInferenceContext(context);
  const draft = isRecord(context?.draft) ? context.draft : {};
  const candidate = isRecord(context?.radar_candidate) ? context.radar_candidate : {};
  const archetype = inferArchetype(context);
  const issuePlan = repairIssuePlan(context);
  if (issuePlan.unsupported.length) {
    return {
      archetype,
      patch: {},
      explanations: [],
      issue_plan: issuePlan,
      unresolved: {
        code: "UNSUPPORTED_REPAIR_ISSUE_CODE",
        field: "automatic_review",
        evidence: issuePlan.unsupported,
        alternatives: [],
        reason: "La revisión contiene códigos fuera de la taxonomía cerrada y no se aplicará una reparación aproximada.",
      },
    };
  }
  const ambiguity = detectIrreducibleAmbiguity(context);
  if (ambiguity) {
    return {
      archetype,
      patch: {},
      explanations: [],
      issue_plan: issuePlan,
      unresolved: ambiguity,
    };
  }
  const contractConflict = contradictoryContractConflict(context);
  if (contractConflict) {
    return {
      archetype,
      patch: {},
      explanations: [],
      issue_plan: issuePlan,
      unresolved: contractConflict,
    };
  }
  if (repairIssueCodeSet(context).has("UNRESOLVABLE_CONTRACT")
      && ["deadline_ladder_child", "generic_binary_event"].includes(archetype)
      && !hasObjectiveEventPredicate(context)) {
    return {
      archetype,
      patch: {},
      explanations: [],
      issue_plan: issuePlan,
      unresolved: {
        code: "CONTRACT_PREDICATE_NOT_INFERABLE",
        field: "market_definition",
        evidence: [cleanText(draft.question, 700), cleanText(candidate.source_question, 700), cleanText(candidate.source_resolution_rules, 1_000)].filter(Boolean),
        alternatives: [],
        reason: "El contrato solo afirma que algo ocurrirá, sin definir un hecho objetivo verificable; el Corrector no puede convertir esa tautología en criterio de resolución.",
      },
    };
  }
  if (!REPAIR_ARCHETYPE_CAPABILITIES[archetype]) {
    return {
      archetype,
      patch: {},
      explanations: [],
      issue_plan: issuePlan,
      unresolved: {
        code: "ARCHETYPE_NOT_SUPPORTED",
        field: "market_definition",
        evidence: [],
        alternatives: REPAIR_ARCHETYPES,
        reason: "La proposición no tiene un constructor determinista versionado y no puede repararse por aproximación.",
      },
    };
  }
  const proposedCategory = inferRepairCategory(context, archetype);
  if (!proposedCategory) {
    return {
      archetype,
      patch: {},
      explanations: [],
      issue_plan: issuePlan,
      unresolved: {
        code: "CATEGORY_NOT_INFERABLE",
        field: "category",
        evidence: [cleanText(draft.question, 700), cleanText(candidate.source_question, 700)].filter(Boolean),
        alternatives: [],
        reason: "La taxonomía y el arquetipo no permiten derivar una categoría única; el Corrector no aplicará una categoría genérica por defecto.",
      },
    };
  }
  const subject = inferSubject(context, archetype);
  if (!subject) {
    return {
      archetype,
      patch: {},
      explanations: [],
      issue_plan: issuePlan,
      unresolved: {
        code: "SUBJECT_NOT_INFERABLE",
        field: "subject",
        evidence: [cleanText(draft.question, 700), cleanText(candidate.source_question, 700)].filter(Boolean),
        alternatives: [],
        reason: "La procedencia no identifica un único sujeto sin inventarlo.",
      },
    };
  }
  const primarySource = inferPrimarySource(context, subject, archetype, discoveredSources);
  if (!primarySource) {
    return {
      archetype,
      patch: {},
      explanations: [],
      issue_plan: issuePlan,
      unresolved: {
        code: "PRIMARY_RESOLUTION_SOURCE_UNVERIFIED",
        field: "primary_source",
        evidence: primarySourceCandidates(context).map((source) => source.url),
        alternatives: [],
        reason: "Ninguna candidata primaria fue atestada en esta ronda como activa, autorizada para primary_resolution, alcanzable y materialmente relevante; el Corrector no reutiliza banderas heredadas ni inventa una fuente.",
      },
    };
  }
  const publisher = verifiedPrimaryPublisher(primarySource);
  const duration = durationSeconds(context);
  const slotContract = requiredArchetypeSlots(context, archetype, subject, publisher, duration);
  if (slotContract.missing.length) {
    const subjectMissing = slotContract.missing[0] === "subject";
    return {
      archetype,
      patch: {},
      explanations: [],
      issue_plan: issuePlan,
      unresolved: {
        code: subjectMissing ? "SUBJECT_NOT_INFERABLE" : "ARCHETYPE_SLOT_NOT_INFERABLE",
        field: slotContract.missing[0],
        evidence: [cleanText(draft.question, 700), cleanText(candidate.source_question, 700)].filter(Boolean),
        alternatives: slotContract.missing,
        reason: `Faltan slots obligatorios del arquetipo ${archetype}; el Corrector no insertará marcadores ni duplicará el predicado.`,
      },
    };
  }
  const deadline = inferEvaluationDeadline(context, discoveredSources);
  if (!deadline) {
    const relativeUnverified = Boolean(inferRelativeTemporalContract(context)) && !deadline;
    return {
      archetype,
      patch: {},
      explanations: [],
      issue_plan: issuePlan,
      unresolved: {
        code: relativeUnverified ? "RELATIVE_TIME_ANCHOR_UNVERIFIED" : "PERIOD_NOT_INFERABLE",
        field: relativeUnverified ? "relative_time_anchor" : "evaluation_period",
        evidence: [cleanText(draft.question, 700), cleanText(candidate.source_question, 700)].filter(Boolean),
        alternatives: [],
        reason: relativeUnverified
            ? "La regla usa un periodo relativo, pero ninguna fuente oficial recuperada demuestra la fecha del hecho ancla y su relación con el sujeto."
            : "La pregunta y la procedencia no contienen un límite temporal convertible de forma objetiva.",
      },
    };
  }
  const timezone = criteriaTimezone(context, deadline);
  if (!timezone) {
    const timezoneObjected = issuePlan.codes.includes("TIMEZONE_INVALID")
      || issuePlan.codes.includes("INVALID_TIMEZONE");
    return {
      archetype,
      patch: {},
      explanations: [],
      issue_plan: issuePlan,
      unresolved: {
        code: timezoneObjected ? "TIMEZONE_NOT_INFERABLE" : "TIMEZONE_INVALID",
        field: "timezone",
        evidence: [cleanText(draft.timezone, 100)].filter(Boolean),
        alternatives: [],
        reason: timezoneObjected
          ? "La zona guardada fue objetada y el contrato no contiene un único token horario fiable; el Corrector no sustituirá la zona por UTC de forma implícita."
          : "La zona horaria declarada no es una zona IANA válida; el Corrector no ejecutará Intl con ese valor.",
      },
    };
  }
  const metricAnalysis = archetype === "metric_threshold" ? metricThresholdAnalysis(context) : null;
  const metric = metricAnalysis?.contract ?? slotContract.slots.metric;
  const milestone = slotContract.slots.milestone;
  if ((archetype === "metric_threshold" && !metric) || (archetype === "milestone_threshold" && !milestone)) {
    const metricError = archetype === "metric_threshold"
      ? metricAnalysis?.error_code || "METRIC_NOT_INFERABLE"
      : "METRIC_NOT_INFERABLE";
    return {
      archetype,
      patch: {},
      explanations: [],
      issue_plan: issuePlan,
      unresolved: {
        code: metricError,
        field: metricError === "METRIC_DIMENSION_NOT_INFERABLE" ? "metric_dimension" : "metric_contract",
        evidence: [cleanText(draft.question, 700), cleanText(candidate.source_resolution_rules, 1_000)].filter(Boolean),
        alternatives: [],
        reason: metricError === "METRIC_DIMENSION_NOT_INFERABLE"
          ? "La procedencia no fija una plataforma ni una política de agregación y tampoco expresa una condición existencial; el Corrector no elegirá una ficha canónica por defecto."
          : "La procedencia no permite fijar de forma objetiva operador, umbral, escala, precisión y unidad.",
      },
    };
  }
  const criteria = archetypeCriteria(archetype, subject, publisher, deadline, duration, context, timezone);
  // Las alternativas heredadas nunca se autocertifican. El único origen
  // admisible aquí es la colección revalidada en esta ejecución por el fixer.
  const boundContextSources = isRecord(deadline.bound_context_source)
    ? [deadline.bound_context_source] : [];
  const alternatives = mergeVerifiedAlternativeSources(boundContextSources, discoveredSources)
    .filter((source) => source.url !== primarySource.url);
  const patch = {
    market_slug: safeMarketSlug(draft.market_slug, subject, archetype, deadline),
    subject,
    category: proposedCategory,
    yes_option: "Sí",
    no_option: "No",
    question: criteria.question,
    evaluation_period_label: archetype === "metric_threshold"
      ? `Observación exacta: ${deadlineLabel(deadline, criteria.timezone || timezone)}`
      : deadline.exact
        ? `Hasta ${deadlineLabel(deadline, criteria.timezone || timezone)}, inclusive`
        : `Hasta el ${dateLabel(deadline)} a las 23:59:59 UTC, inclusive`,
    evaluation_ends_at: deadline.iso,
    closes_at: deadline.iso,
    timezone: criteria.timezone || timezone,
    resolution_deadline: (() => {
      const existingContract = isRecord(context?.binding?.resolution_contract)
        ? context.binding.resolution_contract : {};
      const sourceDelay = Number(existingContract.finality_delay_seconds);
      return deriveResolutionDeadline(
        deadline.iso,
        [draft.resolution_deadline, candidate.source_resolution_deadline],
        {
          ...RESOLUTION_DEADLINE_POLICY,
          source_availability_delay_seconds: Number.isFinite(sourceDelay) && sourceDelay >= 0
            ? sourceDelay
            : RESOLUTION_DEADLINE_POLICY.source_availability_delay_seconds,
        },
      );
    })(),
    yes_criteria: criteria.yes_criteria,
    no_criteria: criteria.no_criteria,
    edge_cases: criteria.edge_cases,
    public_criteria: criteria.public_criteria,
    description: (() => {
      const current = cleanText(draft.description, 3_000);
      return current.length >= 80 ? current : criteria.public_criteria;
    })(),
    primary_source: primarySource,
    alternative_sources: alternatives,
    ...commonTreatments(archetype, criteria.timezone || timezone),
  };
  return {
    archetype,
    patch,
    issue_plan: issuePlan,
    temporal_contract: {
      ...(deadline.relative_anchor ?? {}),
      resolution_deadline_policy_version: RESOLUTION_DEADLINE_POLICY.version,
      source_availability_delay_seconds: RESOLUTION_DEADLINE_POLICY.source_availability_delay_seconds,
      human_review_margin_seconds: RESOLUTION_DEADLINE_POLICY.human_review_margin_seconds,
    },
    explanations: Object.keys(patch).map((field) => ({
      field,
      reason: `Campo deducido mediante el arquetipo ${archetype}, la procedencia autorizada y las incidencias ${issuePlan.codes.join(", ") || "estructurales"}.`,
    })),
    unresolved: alternatives.length ? null : {
      code: "ALTERNATIVE_SOURCE_UNAVAILABLE",
      field: "alternative_sources",
      evidence: [primarySource.url],
      alternatives: [],
      reason: "No se encontró una fuente alternativa pública, HTTPS y materialmente relacionada después de validar la procedencia y la búsqueda controlada.",
    },
  };
}

const REQUIRED_TEXT_FIELDS = [
  "market_slug", "question", "subject", "category", "evaluation_period_label", "timezone",
  "yes_criteria", "no_criteria", "edge_cases", "public_criteria", "description",
  "delay_treatment", "cancellation_treatment", "leak_treatment", "rename_treatment", "assumptions",
];

export function validateRepairDraft(draft) {
  const issues = [];
  for (const field of REQUIRED_TEXT_FIELDS) if (!cleanText(draft?.[field])) issues.push(`MISSING_${field.toUpperCase()}`);
  const question = cleanText(draft?.question, 700);
  if (!/^[a-z0-9][a-z0-9-]{2,119}$/.test(cleanText(draft?.market_slug, 120))) issues.push("INVALID_MARKET_SLUG");
  if (question.length < 20) issues.push("QUESTION_REQUIRED");
  if (/\b(?:exito|importante|grande|pronto|el proximo|el ultimo|este evento)\b/.test(normalize(question))) {
    issues.push("QUESTION_AMBIGUOUS_TERM");
  }
  const evaluation = new Date(cleanText(draft?.evaluation_ends_at, 100));
  const closes = new Date(cleanText(draft?.closes_at, 100));
  const resolution = new Date(cleanText(draft?.resolution_deadline, 100));
  if (!Number.isFinite(evaluation.getTime())) issues.push("INVALID_EVALUATION_END");
  if (!Number.isFinite(closes.getTime())) issues.push("PERIOD_REQUIRED");
  if (Number.isFinite(evaluation.getTime()) && Number.isFinite(closes.getTime())
    && evaluation.getTime() !== closes.getTime()) issues.push("TEMPORAL_CONTRADICTION");
  if (!Number.isFinite(resolution.getTime())) issues.push("INVALID_RESOLUTION_DEADLINE");
  if (Number.isFinite(evaluation.getTime()) && Number.isFinite(resolution.getTime()) && resolution <= evaluation) issues.push("RESOLUTION_DEADLINE_NOT_AFTER_EVALUATION");
  if (!validIanaTimezone(draft?.timezone)) issues.push("TIMEZONE_INVALID");
  if (!isVerifiedPrimarySource(draft?.primary_source, draft?.category)) issues.push("PRIMARY_SOURCE_UNVERIFIED");
  if (!mergeVerifiedAlternativeSources(draft?.alternative_sources).length) issues.push("ALTERNATIVE_SOURCE_REQUIRED");
  if (cleanText(draft?.description, 3_000).length < 30) issues.push("DESCRIPTION_REQUIRED");
  for (const field of ["delay_treatment", "cancellation_treatment", "leak_treatment", "rename_treatment"]) {
    if (cleanText(draft?.[field], 4_000).length < 30) issues.push(`${field.toUpperCase()}_REQUIRED`);
  }
  if (cleanText(draft?.assumptions, 4_000).length < 20) issues.push("ASSUMPTIONS_REQUIRED");
  return [...new Set(issues)];
}

/**
 * Reduce una propuesta determinista al alcance que el registro de estrategias
 * autoriza para las incidencias exactas de la ronda. El borrador completo se
 * valida después de aplicar esta proyección, pero ningún campo sano se reescribe.
 */
export function projectDeterministicRepair(deterministic, allowedFields) {
  const allowed = new Set((Array.isArray(allowedFields) ? allowedFields : [])
    .map((field) => cleanText(field, 80)).filter(Boolean));
  const patch = Object.fromEntries(Object.entries(isRecord(deterministic?.patch) ? deterministic.patch : {})
    .filter(([field]) => allowed.has(field)));
  const explanations = (Array.isArray(deterministic?.explanations) ? deterministic.explanations : [])
    .filter((item) => isRecord(item) && allowed.has(cleanText(item.field, 80)));
  return { ...deterministic, patch, explanations };
}

export function applyRepairPatch(draft, deterministic, modelPatch = {}) {
  // El modelo puede detectar una ambigüedad, pero nunca redacta ni sustituye
  // campos contractuales persistidos. Todas las reglas salen del constructor
  // determinista versionado para que draft y Plan no puedan divergir.
  void modelPatch;
  const output = { ...draft };
  for (const [field, value] of Object.entries(deterministic?.patch ?? {})) output[field] = value;
  output.market_slug = cleanText(output.market_slug, 120);
  output.yes_option = cleanText(output.yes_option || "Sí", 100);
  output.no_option = cleanText(output.no_option || "No", 100);
  output.primary_source = isRecord(output.primary_source) && safePublicUrl(output.primary_source.url)
    ? { ...output.primary_source, url: safePublicUrl(output.primary_source.url) }
    : {};
  output.alternative_sources = mergeAlternativeSources(output.alternative_sources);
  output._timestamp_precision = "milliseconds-v1";
  return output;
}

export function changedRepairFields(before, after) {
  const fields = [
    "market_slug", "question", "subject", "category", "yes_option", "no_option", "evaluation_period_label", "evaluation_ends_at", "closes_at", "timezone",
    "resolution_deadline", "yes_criteria", "no_criteria", "edge_cases", "public_criteria", "description",
    "delay_treatment", "cancellation_treatment", "leak_treatment", "rename_treatment", "assumptions",
    "primary_source", "alternative_sources",
  ];
  return fields.filter((field) => JSON.stringify(before?.[field] ?? null) !== JSON.stringify(after?.[field] ?? null));
}

export function buildResolutionPlan(context, draft, sources, archetype) {
  const existing = isRecord(context?.binding?.resolution_contract) ? context.binding.resolution_contract : {};
  const metric = archetype === "metric_threshold" ? metricThresholdContract({ ...context, draft }) : null;
  const milestone = archetype === "milestone_threshold" ? milestoneContract({ ...context, draft }) : null;
  const temporalContract = isRecord(context?.repair_temporal_contract) ? context.repair_temporal_contract : null;
  const relativeAnchor = temporalContract?.anchor_type && temporalContract?.anchor_date
    ? temporalContract : null;
  const plan = {
    plan_version: Number(existing.plan_version) || 1,
    contract_schema_version: cleanText(existing.contract_schema_version || "atinara-resolution-contract-v1", 100),
    policy_version: cleanText(existing.policy_version || "atinara-market-constitution-v1", 100),
    canonical_statement: cleanText(draft.question, 700),
    archetype,
    official_event_url: safePublicUrl(sources.find((source) => source.role === "PRIMARY_RESOLUTION")?.url),
    canonical_url: safePublicUrl(sources.find((source) => source.role === "PRIMARY_RESOLUTION")?.url),
    provider: "official_web",
    provider_adapter_version: AUTONOMOUS_REPAIR_VERSION,
    opportunity_type: archetype,
    timezone: cleanText(draft.timezone, 100),
    window_end: new Date(draft.evaluation_ends_at).toISOString(),
    evaluation_at: new Date(draft.evaluation_ends_at).toISOString(),
    resolution_deadline: new Date(draft.resolution_deadline).toISOString(),
    temporal_basis: relativeAnchor ? "verified_relative_anchor" : "absolute_contract_time",
    ...(relativeAnchor ? { relative_anchor: relativeAnchor } : {}),
    resolution_deadline_policy_version: cleanText(
      temporalContract?.resolution_deadline_policy_version || RESOLUTION_DEADLINE_POLICY.version,
      100,
    ),
    yes_criteria: cleanText(draft.yes_criteria),
    no_criteria: cleanText(draft.no_criteria),
    edge_cases: cleanText(draft.edge_cases),
    capture_strategy: "manual_official_source",
    evidence_mode: "human_review_of_official_source",
    manual_review_instructions: "Comparar las fuentes oficiales por precedencia con los criterios aprobados, conservar evidencia fechada y exigir confirmación humana para el resultado.",
    missing_data_treatment: "manual_review_no_assumption",
    aggregation: "exact_state",
    source_conflict_treatment: relativeAnchor
      ? "La evidencia oficial contextual fechada fija la fecha-ancla durante la preparación. Un conflicto material previo a la confirmación invalida la revisión; cambios posteriores no desplazan el instante contractual."
      : "pause_and_specific_human_review",
    postponement_treatment: "preserve_approved_period",
    cancellation_treatment: "evaluate_at_deadline_unless_identity_conflict",
    sources,
  };
  if (milestone) {
    return {
      ...plan,
      opportunity_type: "milestone_threshold",
      metric: "official_milestone_value",
      operator: milestone.operator,
      threshold: milestone.threshold,
      unit: milestone.unit,
      aggregation: "maximum_observed_before_deadline",
      manual_review_instructions: `Capturar el valor de la fuente primaria con fecha no posterior al cierre, conservar la unidad ${milestone.unit} y aplicar literalmente ${milestone.operator} ${milestone.threshold} sin redondear ni reinterpretar separadores.`,
    };
  }
  if (!metric) return plan;
  return {
    ...plan,
    opportunity_type: "metric_threshold",
    metric: metric.metric,
    operator: metric.operator,
    threshold: metric.threshold,
    unit: metric.unit,
    source_name: metric.source_name,
    source_domain: metric.source_domain,
    metric_kind: metric.metric_kind,
    scale_min: metric.scale_min,
    scale_max: metric.scale_max,
    precision: metric.precision,
    aggregation: metric.aggregation,
    dimension_aggregation: metric.dimension_aggregation,
    metric_platform: metric.platform,
    platform_policy: metric.platform_policy,
    observation_policy: metric.observation_policy,
    observation_policy_version: metric.observation_policy_version,
    capture_window_seconds: metric.capture_window_seconds,
    metric_missing_data_treatment: metric.missing_data_treatment,
    observation_at: new Date(draft.evaluation_ends_at).toISOString(),
    observation_timezone: cleanText(draft.timezone, 100),
    manual_review_instructions: `Iniciar una única sesión de captura de la página canónica de ${metric.source_name} en el instante aprobado y completarla en ${metric.capture_window_seconds} segundos; congelar el conjunto y el primer valor de cada dimensión en esa sesión, comprobar la escala ${metric.scale_min}-${metric.scale_max}, aplicar ${metric.aggregation} y después ${metric.operator} ${metric.threshold} al ${metric.metric}; excluir ${metric.excluded_metric} y no mezclar ciclos de actualización.`,
  };
}
