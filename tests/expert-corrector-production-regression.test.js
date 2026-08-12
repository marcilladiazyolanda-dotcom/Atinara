const assert = require("node:assert/strict");
const { readFileSync, readdirSync } = require("node:fs");
const { join } = require("node:path");
const { pathToFileURL } = require("node:url");
const { before, test } = require("node:test");

const root = join(__dirname, "..");
const repairPath = join(root, "supabase/functions/_shared/market-draft-repair.mjs");
const fixerEdge = readFileSync(
  join(root, "supabase/functions/market-draft-fixer/index.ts"),
  "utf8",
);
const validatorEdge = readFileSync(
  join(root, "supabase/functions/validate-market-draft/index.ts"),
  "utf8",
);
const aiTaskPolicy = readFileSync(
  join(root, "supabase/functions/_shared/ai/task-policy.mjs"),
  "utf8",
);
const migrationsDirectory = join(root, "supabase/migrations");
const expertCycleMigration = readdirSync(migrationsDirectory)
  .filter((name) => /harden_expert_market_cycle/i.test(name))
  .sort()
  .map((name) => readFileSync(join(migrationsDirectory, name), "utf8"))
  .filter((sql) => sql.trim())
  .join("\n");

let repair;

before(async () => {
  repair = await import(pathToFileURL(repairPath).href);
});

function scrubbedMarvelFixture() {
  return {
    draft: {
      market_slug: "marvel-tokon-fighting-souls-metacritic-score",
      question: "¿Marvel Tokon: Fighting Souls tendrá una puntuación en Metacritic superior a 95 siete días después de su lanzamiento?",
      subject: "Marvel Tokon: Fighting Souls: Metacritic score",
      category: "Reviews/Premios",
      yes_option: "Sí",
      no_option: "No",
      evaluation_period_label: "Siete días después del lanzamiento a las 10:00 AM ET",
      evaluation_ends_at: "2026-08-13T14:00:00Z",
      closes_at: "2026-08-13T14:00:00Z",
      timezone: "Europe/Madrid",
      // Reproducción del defecto productivo: no existe ventana de resolución.
      resolution_deadline: "2026-08-13T14:00:00Z",
      yes_criteria: "Se resolverá como Sí si la puntuación en Metacritic de Marvel Tokon: Fighting Souls es superior a 95 siete días después de su lanzamiento a las 10:00 AM ET.",
      no_criteria: "Se resolverá como No si en ese instante ninguna puntuación elegible de Metacritic es superior a 95.",
      edge_cases: "Las fichas sin puntuación no se convierten en cero y las ediciones distintas no se mezclan.",
      public_criteria: "Atinara observará la puntuación de Metacritic exactamente siete días después del lanzamiento contractual.",
      primary_source: {
        url: "https://www.metacritic.com/game/marvel-tokon-fighting-souls/",
      },
      alternative_sources: [],
    },
    radar_candidate: {
      source_question: "Marvel Tokon: Fighting Souls Metacritic score?",
      source_title: "Marvel Tokon: Fighting Souls: Metacritic score",
      source_resolution_rules: "If the Metascore for Marvel Tokon: Fighting Souls is Above 95 seven days after release at 10:00 AM ET, then the market resolves to Yes.",
      source_resolution_url: "https://www.metacritic.com/game/marvel-tokon-fighting-souls/",
      source_close_at: "2026-08-13T14:00:00Z",
      source_resolution_deadline: "2026-08-13T14:00:00Z",
      atinara_category: "Reviews/Premios",
      provider_payload: { yes_sub_title: "Above 95" },
      family_semantics: {
        entity_label: "marvel tokon fighting souls",
        threshold: { operator: "gt", value: "95", unit: "points" },
      },
    },
    // El informe se conserva como historia, pero no como instrucciones de
    // reparación porque pertenece a otra política y otro esquema.
    latest_review: {
      id: 31,
      validator_version: "atinara-market-gate-v2",
      policy_version: "atinara-market-review-policy-v2",
      schema_version: "atinara-market-draft-schema-v2",
      semantic_issues: [
        {
          code: "AMBIGUOUS_CRITERIA",
          field: "yes_criteria",
          message: "La fecha fija no demuestra el lanzamiento.",
        },
        {
          code: "INVALID_METRIC",
          field: "question",
          message: "Una puntuación superior a 95 es extremadamente atípica.",
        },
      ],
    },
    review_compatible: false,
    review_refresh_required: true,
    repairable_content_issues: [],
  };
}

function verifiedPrimary(context) {
  const url = context.draft.primary_source.url;
  return {
    url,
    excerpt: "Marvel Tokon Fighting Souls official Metacritic Metascore page.",
    name: "Metacritic",
    publisher: "Metacritic",
    role: "PRIMARY_RESOLUTION",
    validated_reachable: true,
    authority_verified: true,
    relevance_verified: true,
    registry_role_verified: true,
    registry_source_id: "11111111-1111-4111-8111-111111111111",
    registry_domain: "metacritic.com",
    registry_parser_version: "fixture-metacritic-v1",
    registry_role: "primary_resolution",
    registry_categories: [],
    draft_category: context.draft.category,
    authority_basis: "private_source_registry_primary_resolution_v1",
    relevance_basis: "fetched_content_v1",
    validation_version: "atinara-primary-source-validation-v1",
  };
}

function verifiedAnchor(excerpt) {
  return {
    url: "https://www.playstation.com/games/marvel-tokon-fighting-souls",
    excerpt,
    validated_reachable: true,
    authority_verified: true,
    relevance_verified: true,
    authority_basis: "private_source_registry_v1",
    relevance_basis: "fetched_content_v1",
    claim_slots: ["TEMPORAL_ANCHOR"],
  };
}

test("Corrector experto · un review v2 obsoleto nunca guía la reparación v3", () => {
  const fixture = scrubbedMarvelFixture();
  assert.equal(fixture.latest_review.policy_version, "atinara-market-review-policy-v2");
  assert.deepEqual(repair.repairIssuePlan(fixture).codes, []);

  const preflightStart = fixerEdge.indexOf("const initialContext = await rpc");
  const repairLoopStart = fixerEdge.indexOf(
    "for (let round = 1; round <= AUTONOMOUS_REPAIR_MAX_ROUNDS; round += 1)",
  );
  assert.ok(preflightStart >= 0, "el fixer debe cargar un contexto de compatibilidad antes de reparar");
  assert.ok(repairLoopStart > preflightStart, "la revisión compatible debe preceder a toda ronda de reparación");
  const preflight = fixerEdge.slice(preflightStart, repairLoopStart);
  assert.match(preflight, /initialContext\.review_refresh_required === true/);
  assert.match(preflight, /initialContext\.review_compatible !== true/);
  assert.match(preflight, /const compatibleReview = await revalidate/);
  assert.match(preflight, /no se reutilizó el rechazo obsoleto/);
  assert.match(validatorEdge, /POLICY_VERSION = "atinara-market-review-policy-v3"/);
  assert.match(validatorEdge, /SCHEMA_VERSION = "atinara-market-draft-schema-v3"/);

  // Mientras la migración esté pendiente, el preflight anterior es fail-safe:
  // un flag ausente también fuerza review. Si ya existe SQL, debe exponer el
  // contrato de compatibilidad de forma explícita.
  if (expertCycleMigration) {
    assert.match(expertCycleMigration, /review_compatible/i);
    assert.match(expertCycleMigration, /review_refresh_required/i);
    assert.match(expertCycleMigration, /atinara-market-review-policy-v3/i);
    assert.match(expertCycleMigration, /repairable_content_issues/i);
  }
});

test("Corrector experto · >95 es raro pero válido en la escala crítica 0–100", () => {
  const fixture = scrubbedMarvelFixture();
  const metric = repair.inferMetricContract(fixture);

  assert.ok(metric);
  assert.equal(metric.metric_kind, "critic");
  assert.equal(metric.operator, ">");
  assert.equal(metric.threshold, 95);
  assert.equal(metric.scale_min, 0);
  assert.equal(metric.scale_max, 100);
  assert.equal(metric.precision, 0);
  assert.equal(metric.aggregation, "maximum");

  assert.match(validatorEdge, /if \(code === "INVALID_METRIC"\)/);
  assert.match(validatorEdge, /if \(inferMetricContract\(\{ draft \}\)\) return true/);
  assert.match(validatorEdge, /everyIssueSafelyDismissed/);
  assert.match(aiTaskPolicy, /La rareza o baja probabilidad nunca hacen inv.lida una m.trica/);
});

test("Corrector experto · normaliza anclas EN abreviadas, PT e ISO sin perder el sujeto", () => {
  const fixture = scrubbedMarvelFixture();
  const subject = "Marvel Tokon Fighting Souls";
  const excerpts = [
    "MARVEL Tokon: Fighting Souls Released 6 Aug, 2026.",
    "Marvel Tokon: Fighting Souls Released On: Aug 6, 2026.",
    "MARVEL Tokon: Fighting Souls será lançado em 6 de agosto de 2026 para PS5 e PC.",
    "Marvel Tokon: Fighting Souls was released 2026-08-06 for PS5 and PC.",
  ];

  for (const excerpt of excerpts) {
    assert.deepEqual(
      repair.extractTemporalAnchorDate(excerpt, subject),
      { year: 2026, month: 8, day: 6, iso_date: "2026-08-06" },
      excerpt,
    );
    const result = repair.buildDeterministicRepair(fixture, [
      verifiedPrimary(fixture),
      verifiedAnchor(excerpt),
    ]);
    assert.equal(result.unresolved, null, excerpt);
    assert.equal(result.temporal_contract.anchor_date, "2026-08-06", excerpt);
    assert.equal(result.patch.evaluation_ends_at, "2026-08-13T14:00:00.000Z", excerpt);
  }
});

test("Corrector experto · limpia el subject editorial y rechaza un deadline igual al cierre", () => {
  const fixture = scrubbedMarvelFixture();
  const result = repair.buildDeterministicRepair(fixture, [
    verifiedPrimary(fixture),
    verifiedAnchor("Marvel Tokon: Fighting Souls Released On: Aug 6, 2026."),
  ]);

  assert.equal(result.unresolved, null);
  assert.doesNotMatch(result.patch.subject, /metacritic|score/i);
  assert.equal(
    result.patch.subject.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(),
    "marvel tokon fighting souls",
  );
  assert.ok(
    new Date(result.patch.resolution_deadline) > new Date(result.patch.evaluation_ends_at),
    "la reparación debe crear una ventana de resolución posterior",
  );

  const equalDeadline = {
    ...repair.applyRepairPatch(fixture.draft, result),
    resolution_deadline: result.patch.evaluation_ends_at,
  };
  assert.ok(
    repair.validateRepairDraft(equalDeadline).includes("RESOLUTION_DEADLINE_NOT_AFTER_EVALUATION"),
  );
});
