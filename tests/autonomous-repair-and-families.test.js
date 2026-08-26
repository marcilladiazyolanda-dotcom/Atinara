const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { pathToFileURL } = require("node:url");
const { test, before } = require("node:test");

const root = join(__dirname, "..");
const repairPath = join(root, "supabase/functions/_shared/market-draft-repair.mjs");
const radarPath = join(root, "supabase/functions/_shared/market-radar.mjs");
const fixerEdge = readFileSync(join(root, "supabase/functions/market-draft-fixer/index.ts"), "utf8");
const radarEdge = readFileSync(join(root, "supabase/functions/market-radar/index.ts"), "utf8");
const validatorEdge = readFileSync(join(root, "supabase/functions/validate-market-draft/index.ts"), "utf8");
const aiTaskPolicy = readFileSync(join(root, "supabase/functions/_shared/ai/task-policy.mjs"), "utf8");
const migration = readFileSync(join(root, "supabase/migrations/20260808180729_add_autonomous_repair_and_market_families_v2.sql"), "utf8");
const familyDerivationMigration = readFileSync(join(root, "supabase/migrations/20260808182940_strengthen_generic_market_family_derivation.sql"), "utf8");
const candidateDuplicateMigration = readFileSync(join(root, "supabase/migrations/20260808183415_enforce_exact_candidate_family_duplicates.sql"), "utf8");
const familyMatchDeduplicationMigration = readFileSync(join(root, "supabase/migrations/20260808185135_deduplicate_market_family_matches.sql"), "utf8");
const radarIdentityMigration = readFileSync(join(root, "supabase/migrations/20260808204159_fix_radar_prepare_identity_and_blocking_duplicates.sql"), "utf8");
const terminalFactAndFamilyV3Migration = readFileSync(join(root, "supabase/migrations/20260809120000_harden_terminal_fact_gate_and_family_identity_v3.sql"), "utf8");
const explorer = require(join(root, "market-family-explorer.js"));
const landing = readFileSync(join(root, "market-publication-landing.js"), "utf8");
const home = readFileSync(join(root, "script.js"), "utf8");
const styles = readFileSync(join(root, "styles.css"), "utf8");
let repair;
let radar;

before(async () => {
  repair = await import(pathToFileURL(repairPath).href);
  radar = await import(pathToFileURL(radarPath).href);
});

function verifiedRepairSource(url, excerpt) {
  return {
    url,
    excerpt,
    validated_reachable: true,
    authority_verified: true,
    relevance_verified: true,
    authority_basis: "private_source_registry_v1",
    relevance_basis: "fetched_content_v1",
  };
}

function verifiedPrimaryRepairSource(context, excerpt = "Fuente primaria oficial y relevante para el sujeto contractual.") {
  const url = context?.radar_candidate?.atinara_resolution_source_url
    || context?.radar_candidate?.source_resolution_url
    || context?.draft?.primary_source?.url;
  return {
    url,
    excerpt,
    name: new URL(url).hostname,
    publisher: new URL(url).hostname,
    role: "PRIMARY_RESOLUTION",
    validated_reachable: true,
    authority_verified: true,
    relevance_verified: true,
    registry_role_verified: true,
    registry_source_id: "44444444-4444-4444-8444-444444444444",
    registry_domain: new URL(url).hostname.toLowerCase().replace(/^www\./, ""),
    registry_parser_version: "fixture-primary-parser-v1",
    registry_role: "primary_resolution",
    registry_categories: [],
    draft_category: context?.proposed_category || context?.draft?.category || context?.radar_candidate?.atinara_category,
    authority_basis: "private_source_registry_primary_resolution_v1",
    relevance_basis: "fetched_content_v1",
    validation_version: "atinara-primary-source-validation-v1",
  };
}

function ps6Context() {
  return {
    draft: {
      market_slug: "ps6-anuncio-2026",
      question: "¿Se anunciará la PS6 antes del 1 de enero de 2027?",
      subject: "",
      category: "Lanzamientos",
      yes_option: "Sí",
      no_option: "No",
      yes_criteria: "Sony anuncia oficialmente la consola PlayStation 6 antes del 1 de enero de 2027.",
      primary_source: { url: "https://sonyinteractive.com/en/news/press-releases/" },
      alternative_sources: [],
      evaluation_ends_at: "2026-12-31T23:59:59Z",
      closes_at: "2026-12-31T23:59:59Z",
      resolution_deadline: "2027-01-01T15:00:00Z",
    },
    radar_candidate: {
      source_question: "PS6 announced by 2026?",
      source_title: "PS6 announced this year?",
      source_resolution_rules: "If Sony announces the PS6 before 2027, the market resolves Yes.",
      atinara_category: "Lanzamientos",
    },
  };
}

function trailerContext() {
  return {
    draft: {
      market_slug: "gta-vi-trailer-2026",
      question: "¿Se lanzará un nuevo tráiler de Grand Theft Auto VI antes de octubre de 2026?",
      subject: "",
      category: "Lanzamientos",
      yes_option: "Sí",
      no_option: "No",
      yes_criteria: "Rockstar Games publica un tráiler de Grand Theft Auto VI de al menos 30 segundos antes del 1 de octubre de 2026.",
      primary_source: { url: "https://www.rockstargames.com/" },
      alternative_sources: [],
      evaluation_ends_at: "2026-09-30T23:59:59Z",
      closes_at: "2026-09-30T23:59:59Z",
      resolution_deadline: "2026-10-08T14:00:00Z",
    },
    radar_candidate: {
      source_question: "Will another GTA VI trailer come out before Oct 2026?",
      source_title: "Grand Theft Auto VI: New trailer release date",
      source_resolution_rules: "If a new (at least 30 second) GTA VI trailer is released before Oct 1, 2026, this resolves Yes.",
      atinara_category: "Lanzamientos",
    },
  };
}

test("Corrector · PS6 usa official_announcement, fecha inclusiva UTC y criterios completos", () => {
  const context = ps6Context();
  const result = repair.buildDeterministicRepair(context, [
    verifiedPrimaryRepairSource(context, "Sony Interactive Entertainment official press releases for PlayStation 6 / PS6."),
    verifiedRepairSource(
      "https://sonyinteractive.com/en/news/",
      "Sony Interactive Entertainment official news about PlayStation 6 / PS6.",
    ),
  ]);
  assert.equal(repair.AUTONOMOUS_REPAIR_VERSION, "atinara-draft-repair-v12");
  assert.equal(result.archetype, "official_announcement");
  assert.match(result.patch.subject, /PlayStation 6 \/ PS6/);
  assert.equal(result.patch.evaluation_ends_at, "2026-12-31T23:59:59.000Z");
  assert.equal(result.patch.timezone, "UTC");
  assert.match(result.patch.yes_criteria, /anuncio oficial y público/);
  assert.match(result.patch.description, /PlayStation 6 \/ PS6/);
  assert.match(result.patch.edge_cases, /patentes/);
  assert.match(result.patch.edge_cases, /fuentes primarias/);
  assert.equal(result.patch.alternative_sources.length, 1);
  assert.equal(repair.validateRepairDraft(repair.applyRepairPatch(context.draft, result)).length, 0);
});

test("Corrector · tráiler usa content_release, conserva 30 segundos y cubre casos límite", () => {
  const context = trailerContext();
  const result = repair.buildDeterministicRepair(context, [
    verifiedPrimaryRepairSource(context, "Rockstar Games official Grand Theft Auto VI trailer source."),
    verifiedRepairSource(
      "https://www.rockstargames.com/newswire/article/example/grand-theft-auto-vi-watch-trailer-2-now",
      "Rockstar Games officially publishes the new Grand Theft Auto VI trailer.",
    ),
  ]);
  assert.equal(result.archetype, "content_release");
  assert.equal(result.patch.subject, "Grand Theft Auto VI");
  assert.equal(result.patch.evaluation_ends_at, "2026-09-30T23:59:59.000Z");
  assert.match(result.patch.yes_criteria, /al menos 30 segundos/);
  assert.match(result.patch.description, /tráiler nuevo de Grand Theft Auto VI/);
  for (const term of ["teasers", "clips", "reediciones", "versión localizada", "filtraciones", "retirada"]) {
    assert.match(result.patch.edge_cases, new RegExp(term));
  }
});

test("Corrector · Marvel conserva el instante contractual y convierte Metacritic en una métrica inequívoca", () => {
  const context = {
    draft: {
      market_slug: "marvel-tokon-fighting-souls-metacritic-score",
      question: "¿Marvel Tokon: Fighting Souls tendrá una puntuación en Metacritic superior a 95 siete días después de su lanzamiento?",
      subject: "",
      category: "Reviews/Premios",
      yes_option: "Sí",
      no_option: "No",
      yes_criteria: "La puntuación de Metacritic será superior a 95 siete días después del lanzamiento.",
      primary_source: { url: "https://www.metacritic.com/game/marvel-tokon-fighting-souls/" },
      alternative_sources: [],
      evaluation_ends_at: "2026-08-13T14:00:00Z",
      closes_at: "2026-08-13T14:00:00Z",
      resolution_deadline: "2026-08-20T14:00:00Z",
    },
    radar_candidate: {
      source_question: "Will Marvel Tokon: Fighting Souls have a Metacritic score above 95 seven days after release?",
      source_title: "Marvel Tokon: Fighting Souls: Metacritic score",
      source_resolution_rules: "Resolves from Metacritic at 10:00 AM ET seven days after the general contractual release.",
      source_resolution_deadline: "2026-08-20T14:00:00Z",
      source_close_at: "2026-08-13T14:00:00Z",
      atinara_category: "Reviews/Premios",
    },
  };
  const result = repair.buildDeterministicRepair(context, [
    verifiedPrimaryRepairSource(context, "Marvel Tokon: Fighting Souls official Metacritic game page."),
    verifiedRepairSource(
      "https://blog.playstation.com/2026/02/12/marvel-tokon-fighting-souls-arrives-on-ps5-pc-august-6/",
      "Marvel Tōkon: Fighting Souls launches on PlayStation 5 and PC on August 6, 2026. It launches in Australia, New Zealand, Japan and South Korea on August 7, 2026.",
    ),
  ]);
  const repaired = repair.applyRepairPatch(context.draft, result);
  const plan = repair.buildResolutionPlan({ ...context, repair_temporal_contract: result.temporal_contract }, repaired, [], result.archetype);

  assert.equal(result.unresolved, null);
  assert.equal(result.archetype, "metric_threshold");
  assert.equal(result.patch.subject, "Marvel Tokon: Fighting Souls");
  assert.equal(result.patch.evaluation_ends_at, "2026-08-13T14:00:00.000Z");
  assert.equal(result.patch.resolution_deadline, "2026-08-20T14:00:00.000Z");
  assert.equal(result.patch.timezone, "America/New_York");
  assert.match(result.patch.question, /superior a 95/);
  assert.match(result.patch.question, /7 días después del lanzamiento contractual/);
  assert.match(result.patch.yes_criteria, /Metascore de crítica/);
  assert.match(result.patch.yes_criteria, /> 95/);
  assert.match(result.patch.yes_criteria, /mayor Metascore/);
  assert.match(result.patch.no_criteria, /«tbd»/);
  assert.match(result.patch.edge_cases, /User Score/);
  assert.match(result.patch.public_criteria, /Metascore de crítica/);
  assert.deepEqual(repair.validateRepairDraft(repaired), []);
  assert.equal(plan.opportunity_type, "metric_threshold");
  assert.equal(plan.operator, ">");
  assert.equal(plan.threshold, 95);
  assert.equal(plan.capture_strategy, "manual_official_source");
  assert.equal(plan.evidence_mode, "human_review_of_official_source");
  assert.equal(plan.missing_data_treatment, "manual_review_no_assumption");
  assert.equal(plan.metric, "Metascore de crítica de Metacritic");
  assert.equal(plan.metric_kind, "critic");
  assert.equal(plan.scale_max, 100);
  assert.equal(plan.aggregation, "maximum");
  assert.equal(plan.observation_at, "2026-08-13T14:00:00.000Z");
  assert.equal(plan.resolution_deadline, "2026-08-20T14:00:00.000Z");
  assert.equal(plan.temporal_basis, "verified_relative_anchor");
  assert.equal(plan.relative_anchor.anchor_date, "2026-08-06");
  assert.equal(plan.relative_anchor.source_url, "https://blog.playstation.com/2026/02/12/marvel-tokon-fighting-souls-arrives-on-ps5-pc-august-6/");
  assert.equal(repaired.alternative_sources.length, 1);
  assert.match(repaired.alternative_sources[0].excerpt, /August 6, 2026/);
});

test("Corrector · una fecha relativa sin cuerpo oficial que pruebe el ancla falla cerrada", () => {
  const context = {
    draft: {
      market_slug: "marvel-relative-unverified",
      question: "¿Marvel Tokon: Fighting Souls tendrá una puntuación en Metacritic superior a 95 siete días después de su lanzamiento?",
      category: "Reviews/Premios",
      yes_criteria: "Metacritic superior a 95 siete días después del lanzamiento.",
      primary_source: { url: "https://www.metacritic.com/game/marvel-tokon-fighting-souls/" },
      alternative_sources: [],
      evaluation_ends_at: "2026-08-13T14:00:00Z",
      resolution_deadline: "2026-08-20T14:00:00Z",
    },
    radar_candidate: {
      source_question: "Will Marvel Tokon: Fighting Souls have a Metacritic score above 95 seven days after release?",
      source_resolution_rules: "At 10:00 AM ET seven days after release.",
      source_close_at: "2026-08-13T14:00:00Z",
    },
  };
  const result = repair.buildDeterministicRepair(context, [
    verifiedPrimaryRepairSource(context, "Marvel Tokon: Fighting Souls official Metacritic game page."),
    {
      url: "https://blog.playstation.com/2026/02/12/marvel-tokon-fighting-souls-arrives-on-ps5-pc-august-6/",
      title: "Marvel Tōkon: Fighting Souls arrives August 6",
    },
  ]);
  assert.equal(result.unresolved.code, "RELATIVE_TIME_ANCHOR_UNVERIFIED");
  assert.equal(result.unresolved.field, "relative_time_anchor");
  assert.deepEqual(result.patch, {});
});

function typedRepairContext(question, sourceTitle = question, rules = question) {
  return {
    draft: {
      market_slug: "typed-market-repair",
      question,
      subject: "",
      category: "Eventos",
      yes_option: "Sí",
      no_option: "No",
      yes_criteria: rules,
      primary_source: { url: "https://official.example.com/results" },
      alternative_sources: [{ url: "https://official.example.com/corroboration", title: "Fuente oficial alternativa" }],
      evaluation_ends_at: "2026-12-31T23:59:59Z",
      closes_at: "2026-12-31T23:59:59Z",
      resolution_deadline: "2027-01-01T23:59:59Z",
      timezone: "UTC",
    },
    radar_candidate: {
      source_question: question,
      source_title: sourceTitle,
      source_resolution_rules: rules,
      source_resolution_url: "https://official.example.com/results",
      atinara_category: "Eventos",
    },
  };
}

function typedVerifiedSource(context) {
  return verifiedRepairSource(
    "https://official.example.com/corroboration",
    `Corroboración oficial y vigente del contrato: ${context.radar_candidate.source_question}`,
  );
}

test("Corrector · todos los arquetipos declarados tienen un constructor explícito y validable", () => {
  assert.deepEqual(Object.keys(repair.REPAIR_ARCHETYPE_CAPABILITIES).sort(), [...repair.REPAIR_ARCHETYPES].sort());
  const fixtures = [
    ["product_release", "Proyecto Aurora", /^¿Tendrá Proyecto Aurora un lanzamiento comercial/, typedRepairContext("¿Se lanzará comercialmente Proyecto Aurora antes del 1 de enero de 2027?")],
    ["milestone_threshold", "Canal Aurora", /^¿Alcanzará Canal Aurora más de 1000000 suscriptores/, typedRepairContext("¿Superará Canal Aurora los 1000000 suscriptores antes del 1 de enero de 2027?")],
    ["award_winner", "Obra Cobalto", /^¿Ganará Obra Cobalto Juego del Año 2026 no más tarde/, typedRepairContext("¿Ganará Obra Cobalto el premio Juego del Año 2026 antes del 1 de enero de 2027?")],
    ["event_presence", "Estudio Épsilon", /^¿Participará Estudio Épsilon en Feria Boreal no más tarde/, typedRepairContext("¿Aparecerá Estudio Épsilon en la Feria Boreal antes del 1 de enero de 2027?")],
    ["platform_variant", "Proyecto Aurora", /^¿Tendrá Proyecto Aurora una versión oficial y nativa para PlayStation 5/, typedRepairContext("¿Tendrá Proyecto Aurora una versión oficial para PlayStation 5 antes del 1 de enero de 2027?")],
    ["deadline_ladder_child", "evento Aurora", /^¿Ocurrirá el evento Aurora antes del 1 de enero de 2027\?$/, typedRepairContext("¿Ocurrirá el evento Aurora antes del 1 de enero de 2027?")],
    ["generic_binary_event", "Proyecto Aurora", /^¿Será verdadero el estado oficial de Proyecto Aurora\?$/, typedRepairContext("¿Será verdadero el estado oficial de Proyecto Aurora?")],
  ];
  for (const [expectedArchetype, expectedSubject, expectedQuestion, context] of fixtures) {
    const result = repair.buildDeterministicRepair(context, [
      verifiedPrimaryRepairSource(context, `Fuente primaria oficial para ${context.radar_candidate.source_question}`),
      typedVerifiedSource(context),
    ]);
    assert.equal(result.archetype, expectedArchetype);
    assert.equal(result.unresolved, null);
    assert.equal(result.patch.subject, expectedSubject);
    assert.match(result.patch.question, expectedQuestion);
    assert.doesNotMatch(result.patch.question, /(?:Ganará Ganará|Participará Aparecerá|Tendrá Tendrá|Alcanzará Superará|null|undefined)/);
    const repaired = repair.applyRepairPatch(context.draft, result);
    assert.deepEqual(repair.validateRepairDraft(repaired), []);
    assert.ok(repaired.yes_criteria.length >= 80);
    assert.ok(repaired.no_criteria.length >= 80);
    assert.ok(repaired.edge_cases.length >= 80);
    const plan = repair.buildResolutionPlan(context, repaired, [{
      url: repaired.primary_source.url,
      role: "PRIMARY_RESOLUTION",
      precedence: 1,
      required: true,
      fallback_condition: null,
    }], result.archetype);
    assert.equal(plan.opportunity_type, expectedArchetype);
    assert.equal(plan.capture_strategy, "manual_official_source");
    assert.equal(plan.aggregation, expectedArchetype === "milestone_threshold"
      ? "maximum_observed_before_deadline" : "exact_state");
  }
});

test("Corrector · un slot obligatorio ausente no genera placeholders", () => {
  const context = typedRepairContext("¿Ganará Obra Cobalto antes del 1 de enero de 2027?", "Award winner", "The award result will be official.");
  const result = repair.buildDeterministicRepair(context, []);
  assert.equal(result.archetype, "award_winner");
  assert.equal(result.unresolved.code, "SUBJECT_NOT_INFERABLE");
  assert.deepEqual(result.patch, {});
});

test("Corrector · el plan de incidencias se consume y rechaza códigos fuera de taxonomía", () => {
  const valid = typedRepairContext("¿Ocurrirá el evento Aurora antes del 1 de enero de 2027?");
  valid.repairable_content_issues = [{ code: "INVALID_QUESTION", field: "question", message: "Pregunta inválida." }];
  const repaired = repair.buildDeterministicRepair(valid, []);
  assert.deepEqual(repaired.issue_plan.codes, ["INVALID_QUESTION"]);
  assert.equal(repaired.issue_plan.dispositions.INVALID_QUESTION, "deterministic_repair_or_specific_escalation");

  const unknown = structuredClone(valid);
  unknown.repairable_content_issues = [{ code: "MODEL_INVENTED_CODE", field: "question", message: "Fuera de contrato." }];
  const blocked = repair.buildDeterministicRepair(unknown, []);
  assert.equal(blocked.unresolved.code, "UNSUPPORTED_REPAIR_ISSUE_CODE");
  assert.deepEqual(blocked.patch, {});
});

test("Corrector · sustituye una fuente HTTPS irrelevante por la canónica de procedencia", () => {
  const context = typedRepairContext("¿Será verdadero el estado oficial de Proyecto Aurora?");
  context.draft.primary_source = { url: "https://example.com/unrelated" };
  context.radar_candidate.source_resolution_url = "https://official.example.com/results";
  const result = repair.buildDeterministicRepair(context, [
    verifiedPrimaryRepairSource(context),
    typedVerifiedSource(context),
  ]);
  assert.equal(result.unresolved, null);
  assert.equal(result.patch.primary_source.url, "https://official.example.com/results");
  assert.notEqual(result.patch.primary_source.url, context.draft.primary_source.url);
});

test("Corrector · una candidata canónica permite investigar aunque el draft no tenga primary", () => {
  const context = typedRepairContext("¿Será verdadero el estado oficial de Proyecto Aurora?");
  context.draft.primary_source = {};
  const primary = verifiedPrimaryRepairSource(context);
  const result = repair.buildDeterministicRepair(context, [primary, typedVerifiedSource(context)]);
  assert.equal(result.unresolved, null);
  assert.equal(result.patch.primary_source.url, "https://official.example.com/results");
  assert.equal(repair.inferPrimarySource(context, undefined, undefined, [primary]).url, "https://official.example.com/results");
  assert.match(fixerEdge, /discoverOfficialPrimary\(\s*env, repairContext, sourceValidationDeadlineAt, sourceValidationSignal/);
});

test("Corrector · una fuente genérica no permite declarar completada la reparación", () => {
  const context = typedRepairContext("¿Ocurrirá el evento Aurora antes del 1 de enero de 2027?");
  context.draft.alternative_sources = [];
  const result = repair.buildDeterministicRepair(context, [verifiedPrimaryRepairSource(context)]);
  assert.equal(result.unresolved.code, "ALTERNATIVE_SOURCE_UNAVAILABLE");
  const repaired = repair.applyRepairPatch(context.draft, result);
  assert.ok(repair.validateRepairDraft(repaired).includes("ALTERNATIVE_SOURCE_REQUIRED"));
  assert.match(fixerEdge, /loadPrimarySourceRegistry\(env\)/);
  assert.match(fixerEdge, /return propositionMatch && entityMatch/);
});

test("Corrector · la taxonomía cerrada da una disposición a cada incidencia detectable", () => {
  for (const code of repair.VALIDATOR_CONTENT_ISSUE_CODES) {
    assert.ok(repair.REPAIR_ISSUE_CAPABILITIES[code], `Falta disposición para ${code}`);
  }
  for (const code of repair.REPAIRABLE_ISSUE_CODES) {
    assert.ok(repair.REPAIR_ISSUE_CAPABILITIES[code], `Falta capacidad para ${code}`);
  }
  assert.match(aiTaskPolicy, /code: \{ type: "string", enum: VALIDATOR_CODES \}/);
  assert.match(validatorEdge, /VALIDATOR_CONTENT_ISSUE_CODE_SET\.has\(code\)/);
  assert.match(aiTaskPolicy, /Usa exclusivamente estos códigos cerrados/);
  assert.match(fixerEdge, /blocking_reasons/);
  assert.match(fixerEdge, /semantic_issues/);
  assert.match(aiTaskPolicy, /unresolved_issues/);
  assert.match(fixerEdge, /semanticUnresolvedEscalation/);
  assert.match(fixerEdge, /REPAIR_ROUND_REPEATED/);
  assert.match(fixerEdge, /seenRoundSignatures/);
});

test("Corrector · Gemini no sobrescribe el contrato determinista y unresolved bloquea antes de aplicar", () => {
  const deterministic = {
    patch: {
      market_slug: "semantic-patch-test",
      assumptions: "Supuesto determinista.",
      primary_source: { url: "https://official.example.com/results" },
      alternative_sources: [{ url: "https://official.example.com/corroboration" }],
    },
  };
  const repaired = repair.applyRepairPatch({}, deterministic, { assumptions: "Supuesto semántico auditado." });
  assert.equal(repaired.assumptions, "Supuesto determinista.");
  assert.match(
    fixerEdge,
    /const semanticEscalation = semanticUnresolvedEscalation\(semantic\.value,\s*repairContext,\s*deterministic\)/,
  );
  assert.ok(fixerEdge.indexOf("semanticUnresolvedEscalation(semantic.value)") < fixerEdge.indexOf("applyRepairPatch(draft, deterministic)"));
});

test("Corrector · la investigación web conserva solo un excerpt acotado", () => {
  assert.match(fixerEdge, /MAX_SOURCE_EXCERPT_BYTES = 32_768/);
  assert.match(fixerEdge, /readLimitedExcerpt/);
  assert.match(fixerEdge, /reader\.cancel\(\)/);
  assert.match(fixerEdge, /excerpt: validated\.excerpt/);
  assert.match(fixerEdge, /const isTemporalAnchor = Boolean\(temporalAnchorSource && source\.url === temporalAnchorSource\)/);
  assert.match(fixerEdge, /isTemporalAnchor \? "CONTEXT_SOURCE"/);
  assert.match(fixerEdge, /required: isTemporalAnchor/);
});

test("Corrector · proveedor limitado degrada sin veto técnico ni falsa revisión humana", () => {
  assert.match(fixerEdge, /createAiGateway/);
  assert.match(fixerEdge, /code\.startsWith\("AI_"\)/);
  assert.match(fixerEdge, /AI_PROVIDER_INVALID_RESPONSE/);
  assert.doesNotMatch(fixerEdge, /GEMINI_RATE_LIMITED|GEMINI_TIMEOUT|GEMINI_INVALID_RESPONSE/);
  assert.match(fixerEdge, /repair_applied: allChanged\.size > 0/);
  assert.match(fixerEdge, /technical_incident/);
  assert.match(fixerEdge, /ok: false,\s+error: "AUTOMATIC_REVIEW_TECHNICAL_INCOMPLETE"/);
  assert.match(fixerEdge, /review_completed: false/);
  assert.match(fixerEdge, /review_approved: false/);
  assert.match(fixerEdge, /la revisión automática no se completó por un fallo técnico/);
  assert.doesNotMatch(fixerEdge, /TECHNICAL_REVIEW_FAILURE_NOT_REPAIRABLE/);
  assert.match(fixerEdge, /AUTONOMOUS_REPAIR_MAX_ROUNDS/);
});

test("Corrector · cada ronda envía un plan y un contrato temporal mínimos para auditoría", () => {
  assert.match(fixerEdge, /issue_plan: repairAuditIssuePlan\(deterministic\.issue_plan\)/);
  assert.match(fixerEdge, /temporal_contract: repairAuditTemporalContract\(deterministic\.temporal_contract\)/);
  assert.match(fixerEdge, /codes,\s+dispositions:/);
  assert.match(fixerEdge, /anchor_date: anchorDate/);
  assert.match(fixerEdge, /offset_days: offsetDays/);
  assert.match(fixerEdge, /source_url: sourceUrl/);
  const temporalAuditHelper = fixerEdge.slice(
    fixerEdge.indexOf("function repairAuditTemporalContract"),
    fixerEdge.indexOf("function compactPrimarySourceCheck"),
  );
  assert.doesNotMatch(temporalAuditHelper, /excerpt|content|snippet|raw_content/);
});

test("Corrector · ambigüedad irreducible informa código, campo, evidencia y alternativas", () => {
  const result = repair.detectIrreducibleAmbiguity({
    primary_source_conflicts: [
      { url: "https://official.example/a", statement: "La regla usa UTC." },
      { url: "https://official.example/b", statement: "La regla usa hora local." },
    ],
  });
  assert.equal(result.code, "CONFLICTING_PRIMARY_SOURCES");
  assert.equal(result.field, "primary_source");
  assert.equal(result.evidence.length, 2);
  assert.equal(result.alternatives.length, 2);
  assert.match(fixerEdge, /draft_private: true/);
});

function gtaRelease(question, overrides = {}) {
  return {
    id: overrides.id,
    provider: overrides.provider || "kalshi",
    external_id: overrides.external_id,
    source_title: "Grand Theft Auto VI release date",
    source_question: question,
    atinara_question: question,
    hard_reject_reasons: overrides.hard_reject_reasons || [],
    source_close_at: overrides.source_close_at,
  };
}

const publishedAugust = {
  id: "gta-vi-august",
  question: "¿Grand Theft Auto VI será lanzado el 31 de agosto de 2026 o antes?",
};

test("Familias · misma fecha es exact_duplicate y bloquea", () => {
  const candidate = gtaRelease("Will Grand Theft Auto VI be released before September 1, 2026?");
  const relation = radar.classifyMarketRelations(candidate, [publishedAugust]);
  assert.equal(relation.duplicates[0].relationship, "exact_duplicate");
  assert.equal(relation.duplicates[0].blocking, true);
  assert.equal(relation.siblings.length, 0);
});

test("Familias · fecha distinta es sibling, comparte familia y recupera novedad", () => {
  const candidate = gtaRelease("Will Grand Theft Auto VI be released before October 31, 2026?", {
    hard_reject_reasons: ["DUPLICATE_MARKET"],
  });
  const relation = radar.classifyMarketRelations(candidate, [publishedAugust]);
  assert.equal(relation.siblings[0].relationship, "sibling");
  assert.equal(relation.family.family_key, radar.deriveMarketFamily(publishedAugust).family_key);
  assert.notEqual(relation.family.family_child_key, radar.deriveMarketFamily(publishedAugust).family_child_key);
  assert.equal(radar.scoreCandidates([candidate], [publishedAugust])[0].hard_reject_reasons.includes("DUPLICATE_MARKET"), false);
  assert.equal(relation.family.family_semantics.cumulative, true);
  assert.equal(relation.family.family_semantics.mutually_exclusive, false);
  assert.equal(relation.family.family_semantics.parent_is_market, false);
  assert.equal(relation.family.family_semantics.aggregate_probability, false);
  assert.equal(relation.family.family_semantics.economic_independence, true);
  assert.equal(relation.family.family_semantics.entity_label, "grand theft auto vi");
  assert.equal(relation.family.family_semantics.temporal_boundary.canonical_operator, "lt");
});

test("Familias · una candidata nunca puede bloquearse al reencontrarse a sí misma", () => {
  const candidate = gtaRelease("Will Grand Theft Auto VI be released before December 31, 2026?", {
    id: "candidate-uuid",
    external_id: "kalshi:KXGTA6-26-DEC31",
  });
  const cachedOccurrence = {
    ...candidate,
    id: "cached-copy-with-another-row-shape",
    question: candidate.atinara_question,
  };
  const relation = radar.classifyMarketRelations(candidate, [candidate, cachedOccurrence]);
  assert.equal(relation.duplicates.length, 0);
  assert.equal(relation.siblings.length, 0);
  const scored = radar.scoreCandidates([candidate, cachedOccurrence]);
  assert.ok(scored.every((item) => !item.hard_reject_reasons.includes("DUPLICATE_MARKET")));
  assert.ok(scored.every((item) => item.score_breakdown.novelty === 20));
});

test("Familias · identidad distinta y mismo hijo continúa siendo un duplicado real", () => {
  const first = gtaRelease("Will Grand Theft Auto VI be released before December 31, 2026?", {
    id: "first",
    external_id: "kalshi:KXGTA6-26-DEC31-A",
  });
  const second = {
    ...first,
    id: "second",
    external_id: "kalshi:KXGTA6-26-DEC31-B",
    question: first.atinara_question,
  };
  const relation = radar.classifyMarketRelations(second, [first]);
  assert.equal(relation.duplicates.length, 1);
  assert.equal(radar.isBlockingDuplicateMatch(relation.duplicates[0]), true);
  assert.equal(radar.isBlockingDuplicateMatch({ relationship: "sibling", blocking: false }), false);
});

test("Familias · tráiler y lanzamiento son proposiciones distintas", () => {
  const trailer = gtaRelease("Will another Grand Theft Auto VI trailer come out before October 2026?");
  const releaseFamily = radar.deriveMarketFamily(publishedAugust);
  const trailerFamily = radar.deriveMarketFamily(trailer);
  assert.notEqual(trailerFamily.family_key, releaseFamily.family_key);
  assert.equal(trailerFamily.family_type, "deadline_ladder");
  assert.equal(radar.classifyMarketRelations(trailer, [publishedAugust]).duplicates.length, 0);
});

function gtaTrailerDeadline(month, id = month.toLowerCase()) {
  const question = `Will another GTA VI trailer come out before ${month} 2026?`;
  return {
    id,
    provider: "kalshi",
    external_id: `kalshi:KXGTATRAILER-${month.toUpperCase()}`,
    source_title: "Grand Theft Auto VI - New trailer release date",
    source_question: question,
    atinara_question: question,
    source_resolution_rules: "Resolves Yes if a new, at least 30 second, Grand Theft Auto VI trailer is released before the cutoff.",
    provider_payload: { yes_sub_title: `Before ${month} 2026` },
    hard_reject_reasons: [],
  };
}

test("Familias · los meses de tráiler GTA son hijos distintos y 30 segundos es un invariante común", () => {
  const september = gtaTrailerDeadline("Sep", "september");
  const october = gtaTrailerDeadline("Oct", "october");
  const septemberFamily = radar.deriveMarketFamily(september);
  const octoberFamily = radar.deriveMarketFamily(october);

  assert.equal(septemberFamily.family_version, "atinara-market-family-v5");
  assert.equal(septemberFamily.family_type, "deadline_ladder");
  assert.equal(septemberFamily.family_key, octoberFamily.family_key);
  assert.match(septemberFamily.family_key, /official_content:trailer:duration-gte-30-seconds$/);
  assert.notEqual(septemberFamily.family_child_key, octoberFamily.family_child_key);
  assert.equal(septemberFamily.family_semantics.duration_contract.value, "30");
  assert.equal(septemberFamily.family_semantics.duration_contract.operator, "gte");
  assert.equal(septemberFamily.family_semantics.duration_contract.unit, "seconds");
  const relations = radar.classifyMarketRelations(october, [{
    ...september,
    ...septemberFamily,
    question: september.atinara_question,
  }]);
  assert.deepEqual(relations.duplicates, []);
  assert.equal(relations.siblings[0].relationship, "sibling");
  assert.equal(relations.siblings[0].blocking, false);
});

test("Familias · una identidad v2 errónea se recalcula y la similitud léxica sola no bloquea", () => {
  const september = gtaTrailerDeadline("Sep", "september-v2");
  const october = gtaTrailerDeadline("Oct", "october-v3");
  const staleSeptember = {
    ...september,
    question: september.atinara_question,
    family_version: "atinara-market-family-v2",
    family_key: "atinara:v1:grand-theft-auto-vi-new-trailer-release-date:threshold",
    family_child_key: "threshold:above:30",
  };
  const relations = radar.classifyMarketRelations(october, [staleSeptember]);
  assert.deepEqual(relations.duplicates, []);
  assert.equal(relations.siblings[0].relationship, "sibling");

  const teaser = {
    ...october,
    id: "teaser-october",
    external_id: "kalshi:KXGTATEASER-OCT",
    source_question: "Will another GTA VI teaser come out before Oct 2026?",
    atinara_question: "Will another GTA VI teaser come out before Oct 2026?",
  };
  assert.deepEqual(radar.classifyMarketRelations(october, [{
    ...teaser,
    question: teaser.atinara_question,
  }]).duplicates, []);
});

test("Familias · cross-provider usa proposición e hijo, no el proveedor", () => {
  const kalshi = gtaRelease("Will Grand Theft Auto VI be released before October 31, 2026?", { provider: "kalshi" });
  const polymarketSame = { ...kalshi, id: "poly-same", provider: "polymarket", question: kalshi.atinara_question };
  const polymarketSibling = gtaRelease("Will Grand Theft Auto VI be released before November 30, 2026?", { provider: "polymarket", id: "poly-sibling" });
  assert.equal(radar.classifyMarketRelations(kalshi, [polymarketSame]).duplicates[0].relationship, "exact_duplicate");
  assert.equal(radar.classifyMarketRelations(kalshi, [polymarketSibling]).siblings[0].relationship, "sibling");
});

test("Familias · un mismo lote conserva el primer exacto, bloquea el repetido y permite el hermano", () => {
  const first = gtaRelease("Will Grand Theft Auto VI be released before October 31, 2026?", { provider: "kalshi", id: "first" });
  const duplicate = { ...first, id: "duplicate", external_id: "duplicate", provider: "polymarket" };
  const sibling = gtaRelease("Will Grand Theft Auto VI be released before November 30, 2026?", { provider: "polymarket", id: "sibling" });
  const scored = radar.scoreCandidates([first, duplicate, sibling]);
  const byId = new Map(scored.map((item) => [item.id, item]));
  assert.equal(byId.get("first").hard_reject_reasons.includes("DUPLICATE_MARKET"), false);
  assert.equal(byId.get("duplicate").hard_reject_reasons.includes("DUPLICATE_MARKET"), true);
  assert.equal(byId.get("duplicate").duplicate_matches[0].relationship, "exact_duplicate");
  assert.equal(byId.get("sibling").hard_reject_reasons.includes("DUPLICATE_MARKET"), false);
  assert.equal(byId.get("sibling").family_relationship, "sibling");
});

test("Familias · la taxonomía genérica cubre anuncios, contenido, premios, presencia y umbrales", () => {
  const fixtures = [
    ["Dispositivo Aurora", "¿Se anunciará oficialmente Dispositivo Aurora antes del 1 de enero de 2027?", "deadline_ladder", "announcement_date"],
    ["Saga Boreal", "¿Se publicará un nuevo tráiler oficial de Saga Boreal antes de octubre de 2026?", "deadline_ladder", "official_content"],
    ["Obra Cobalto", "¿Será Obra Cobalto nominada a Juego del Año 2026?", "categorical_outcomes", "outcome"],
    ["Estudio Épsilon", "¿Aparecerá Estudio Épsilon en la Feria Boreal 2026?", "participant_options", "participant"],
    ["Activo Delta", "¿Superará Activo Delta los 100 puntos antes de 2027?", "milestone_thresholds", "threshold"],
  ];
  for (const [subject, question, expectedType, dimension] of fixtures) {
    const family = radar.deriveMarketFamily({ subject, atinara_question: question });
    assert.equal(family.family_type, expectedType);
    assert.match(family.family_key, new RegExp(`:${dimension}(?::|$)`));
    assert.equal(family.family_semantics.economic_independence, true);
    assert.equal(family.family_semantics.aggregate_probability, false);
  }
  const threshold = radar.deriveMarketFamily({ subject: fixtures[4][0], atinara_question: fixtures[4][1] });
  assert.equal(threshold.family_child_key, "threshold:gt:100:points");
  assert.equal(threshold.family_semantics.cumulative, true);
  assert.equal(threshold.family_semantics.mutually_exclusive, false);
});

test("Backend · metadatos atraviesan candidata, borrador, publicación y RPC pública segura", () => {
  for (const column of [
    "family_key", "family_title", "family_type", "family_child_key", "family_child_label",
    "family_sort_at", "family_relationship", "family_semantics", "family_source_event_key", "family_version",
  ]) assert.match(migration, new RegExp(`add column if not exists ${column}`));
  assert.match(migration, /assign_and_classify_market_candidate_family/);
  assert.match(migration, /assign_market_draft_family/);
  assert.match(migration, /assign_public_market_family/);
  assert.match(migration, /get_public_market_family_catalog/);
  assert.match(migration, /grant execute on function public\.get_public_market_family_catalog\(\) to anon, authenticated/);
  assert.match(migration, /set search_path = ''/);
  assert.match(migration, /markets_family_child_uidx/);
  assert.match(familyDerivationMigration, /market_family_threshold_key/);
  assert.match(familyDerivationMigration, /market_family_entity/);
  assert.match(familyDerivationMigration, /milestone_thresholds/);
  assert.doesNotMatch(familyDerivationMigration, /PlayStation 6|PS6|Grand Theft Auto|GTA VI/i);
  assert.match(candidateDuplicateMigration, /family_child_key = new\.family_child_key/);
  assert.match(candidateDuplicateMigration, /'relationship', 'exact_duplicate'/);
  assert.match(candidateDuplicateMigration, /'DUPLICATE_MARKET'/);
  assert.match(familyMatchDeduplicationMigration, /market_family_unique_jsonb_array/);
  assert.match(familyMatchDeduplicationMigration, /group by element\.item/);
  assert.match(familyMatchDeduplicationMigration, /zzz_deduplicate_market_candidate_family_arrays_before_write/);
  assert.doesNotMatch(familyMatchDeduplicationMigration, /public\.(markets|predictions|profiles)\s+(?:set|values)/i);
  assert.match(radarIdentityMigration, /market_candidate_blocking_duplicates/);
  assert.match(radarIdentityMigration, /element\.item ->> 'id' is distinct from self_id_input::text/);
  assert.match(radarIdentityMigration, /relationship' in \('exact_duplicate', 'semantic_duplicate'\)/);
  assert.match(radarIdentityMigration, /relationship' = 'sibling'/);
  assert.match(radarIdentityMigration, /reserve_market_radar_candidate_for_prepare/);
  assert.doesNotMatch(radarIdentityMigration, /(?:insert|update|delete)\s+(?:into\s+|from\s+)?public\.(?:markets|predictions|profiles)/i);
  assert.match(terminalFactAndFamilyV3Migration, /create table if not exists private\.market_radar_fact_checks/);
  assert.match(terminalFactAndFamilyV3Migration, /record_market_radar_fact_checks/);
  assert.match(terminalFactAndFamilyV3Migration, /fact_context_fingerprint/);
  assert.match(terminalFactAndFamilyV3Migration, /fact_policy_version/);
  assert.match(terminalFactAndFamilyV3Migration, /decision_hash/);
  assert.match(terminalFactAndFamilyV3Migration, /candidate\.state = 'rejected'/);
  assert.match(terminalFactAndFamilyV3Migration, /family_version', 'atinara-market-family-v3'/);
  assert.match(terminalFactAndFamilyV3Migration, /minimum_duration_seconds/);
  assert.match(terminalFactAndFamilyV3Migration, /auth\.role\(\) <> 'service_role'/);
  assert.doesNotMatch(terminalFactAndFamilyV3Migration, /(?:insert|update|delete)\s+(?:into\s+|from\s+)?public\.(?:markets|predictions|profiles)/i);
  assert.match(radarEdge, /get_admin_market_family_definitions/);
  assert.doesNotMatch(migration, /insert into public\.predictions|update public\.predictions|publish_market_draft\(/i);
});

function child(id, familyKey = null, sort = null) {
  return {
    id,
    pregunta: `Pregunta ${id}`,
    familyKey,
    familyTitle: familyKey ? "Fecha de lanzamiento · Juego" : "",
    familyType: familyKey ? "deadline_ladder" : "",
    familyChildKey: `deadline:${sort || id}`,
    familySortAt: sort,
    familySemantics: { economic_independence: true },
  };
}

test("Explorar · un hijo queda normal y dos hijos crean un padre sin probabilidad agregada", () => {
  assert.equal(explorer.groupMarkets([child("one", "family")])[0].kind, "market");
  const grouped = explorer.groupMarkets([
    child("late", "family", "2026-10-31T23:59:59Z"),
    child("early", "family", "2026-09-30T23:59:59Z"),
  ]);
  assert.equal(grouped[0].kind, "family");
  assert.deepEqual(grouped[0].children.map((item) => item.id), ["early", "late"]);
  assert.match(explorer.familySemanticsLabel(grouped[0]), /acumulativos y no exclusivos/);
  assert.doesNotMatch(home, /probabilidad agregada/i);
});

test("Explorar · búsqueda, llegada y publicación instantánea expanden y resaltan el hijo", () => {
  assert.match(home, /familyKeysMatchingQuery/);
  assert.match(home, /Boolean\(activeFilters\.query\.trim\(\)\)/);
  assert.match(landing, /familyChildren\.hidden = false/);
  assert.match(landing, /published-market-highlight/);
  assert.match(landing, /BroadcastChannel/);
  assert.match(landing, /initializeMarkets/);
});

test("Explorar · familia es responsive, accesible y no desborda", () => {
  assert.match(home, /aria-expanded/);
  assert.match(home, /aria-controls/);
  assert.match(home, /event\.key === "Escape"/);
  assert.match(styles, /\.market-family-card\s*\{[^}]*min-width:\s*0;[^}]*max-width:\s*100%;[^}]*overflow:\s*hidden;/s);
  assert.match(styles, /@media \(max-width: 380px\)/);
  assert.match(styles, /grid-template-columns:\s*minmax\(0, 1fr\)/);
});
