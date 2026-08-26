const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { pathToFileURL } = require("node:url");
const { before, test } = require("node:test");

const root = join(__dirname, "..");
const repairPath = join(root, "supabase/functions/_shared/market-draft-repair.mjs");
const registryPath = join(root, "supabase/functions/_shared/atinara-agent-registries-v2.mjs");
const outputValidationPath = join(root, "supabase/functions/_shared/ai/task-output-validation.mjs");
const fixerEdge = readFileSync(join(root, "supabase/functions/market-draft-fixer/index.ts"), "utf8");
const taskPolicy = readFileSync(join(root, "supabase/functions/_shared/ai/task-policy.mjs"), "utf8");
const initialRegistryMigration = readFileSync(
  join(root, "supabase/migrations/20260812141515_add_agent_engine_v2_v1.sql"),
  "utf8",
);
const issueRegistryMigration = readFileSync(
  join(root, "supabase/migrations/20260809204739_close_expert_market_cycle_v2.sql"),
  "utf8",
);
const fieldScopeMigration = readFileSync(
  join(root, "supabase/migrations/20260826190000_fix_market_draft_corrector_field_scope_v1.sql"),
  "utf8",
);

let repair;
let registries;
let outputValidation;

before(async () => {
  repair = await import(pathToFileURL(repairPath).href);
  registries = await import(pathToFileURL(registryPath).href);
  outputValidation = await import(pathToFileURL(outputValidationPath).href);
});

function sourceRegistry(
  parserVersion = "fixture-generic-v1",
  id = "11111111-1111-4111-8111-111111111111",
  canonicalDomain = null,
) {
  return {
    id,
    provider: "fixture",
    source_name: parserVersion === "atinara-public-account-source-v1"
      ? "Cuenta pública oficial en X" : "Fuente oficial fixture",
    canonical_domain: canonicalDomain
      ?? (parserVersion === "atinara-public-account-source-v1" ? "x.com" : "official.example.com"),
    allowed_roles: ["primary_resolution"],
    authority_tier: "primary",
    categories: [],
    parser_version: parserVersion,
    active: true,
  };
}

function socialPrimary(category = "Eventos") {
  return {
    url: "https://x.com/thsottiaux",
    name: "Cuenta pública oficial en X",
    publisher: "Cuenta pública oficial en X",
    role: "PRIMARY_RESOLUTION",
    validated_reachable: true,
    authority_verified: true,
    relevance_verified: true,
    registry_role_verified: true,
    registry_source_id: "22222222-2222-4222-8222-222222222222",
    registry_domain: "x.com",
    registry_parser_version: "atinara-public-account-source-v1",
    registry_role: "primary_resolution",
    registry_categories: [],
    draft_category: category,
    authority_basis: "private_source_registry_primary_resolution_v1",
    relevance_basis: "fetched_content_and_canonical_url_v1",
    identity_scope: "public_account_path_v1",
    account_handle: "thsottiaux",
    validation_version: "atinara-primary-source-validation-v1",
  };
}

function verifiedAlternative(url) {
  return {
    url,
    validated_reachable: true,
    authority_verified: true,
    relevance_verified: true,
    authority_basis: "private_source_registry_v1",
    relevance_basis: "fetched_content_v1",
  };
}

function tiboDraft() {
  return {
    market_slug: "tibo-sottiaux-confirma-corte-pelo-septiembre-2026",
    question: "¿Confirmará públicamente Tibo (@thsottiaux) antes del 30 de septiembre de 2026 que se ha cortado el pelo después de su encuesta del 25 de agosto?",
    subject: "Thibault “Tibo” Sottiaux (@thsottiaux)",
    category: "Eventos",
    yes_option: "Sí",
    no_option: "No",
    evaluation_period_label: "Desde la publicación del mercado hasta el 29 de septiembre de 2026 a las 23:59:59, hora de California (America/Los_Angeles).",
    evaluation_ends_at: "2026-09-30T06:59:59.000Z",
    closes_at: "2026-09-30T06:59:59.000Z",
    timezone: "America/Los_Angeles",
    resolution_deadline: "2026-10-03T06:59:59.000Z",
    yes_criteria: "Resolver Sí si Tibo publica desde @thsottiaux una declaración inequívoca de que se cortó el pelo de la cabeza después de la encuesta del 25 de agosto de 2026 y dentro del periodo.",
    no_criteria: "Resolver No si termina el periodo sin una confirmación pública válida; fotografías, rumores, terceros e intenciones futuras no bastan.",
    edge_cases: "Solo cuenta el pelo de la cabeza. Barba, bigote, cejas, peinados, tintes, pelucas, filtros, fotografías aisladas y cortes anteriores a la encuesta no cuentan.",
    public_criteria: "Se resolverá Sí si Tibo confirma públicamente dentro del periodo que se cortó el pelo después de la encuesta; sin confirmación válida se resolverá No.",
    description: "Después de preguntar en X si necesitaba un corte de pelo, la pregunta es si Tibo confirmará que finalmente se lo ha cortado antes de terminar septiembre.",
    delay_treatment: "Una indisponibilidad temporal de X no amplía el periodo y solo permite reintentar la verificación hasta la fecha límite de resolución.",
    cancellation_treatment: "No se anula por falta de publicación; solo una imposibilidad material extraordinaria de aplicar los criterios permite considerar la anulación.",
    leak_treatment: "Una fotografía, mensaje o afirmación de un tercero no resuelve el mercado sin confirmación pública válida de Tibo dentro del periodo.",
    rename_treatment: "Un cambio de nombre o handle conserva el sujeto únicamente si existe continuidad pública y verificable con @thsottiaux.",
    assumptions: "Cortarse el pelo incluye corte, recorte o rapado del pelo de la cabeza y exige una confirmación pública explícita en cualquier idioma.",
    primary_source: {
      url: "https://x.com/thsottiaux",
      authority_verified: true,
      relevance_verified: true,
      registry_source_id: "forged-inherited-id",
    },
    alternative_sources: [
      { url: "https://x.com/thsottiaux/status/2092315945700381084", authority_verified: true },
      { url: "https://x.com/thsottiaux/status/2092359619075314102", relevance_verified: true },
    ],
  };
}

function sourceRepairRegistry() {
  return {
    strategies: [{
      strategy_key: "apply_registered_sources",
      can_write: true,
      write_fields: ["primary_source", "alternative_sources"],
    }],
    bindings: [{
      issue_code: "INSUFFICIENT_EVIDENCE",
      strategy_key: "apply_registered_sources",
    }],
  };
}

function buildScopedTiboRepair(context) {
  const complete = repair.buildDeterministicRepair(context, [
    socialPrimary(),
    verifiedAlternative("https://x.com/thsottiaux/status/2092315945700381084"),
    verifiedAlternative("https://x.com/thsottiaux/status/2092359619075314102"),
  ]);
  assert.equal(complete.unresolved, null);
  const scope = registries.resolveAgentRepairWriteScope(
    sourceRepairRegistry(),
    complete.issue_plan.codes,
  );
  return {
    complete,
    scope,
    scoped: repair.projectDeterministicRepair(complete, scope.allowedFields),
  };
}

test("Corrector por campos · una fuente objetada conserva solo sus URL como candidatas", () => {
  const draft = tiboDraft();
  const context = repair.repairInferenceContext({
    draft,
    repairable_content_issues: [
      { code: "INSUFFICIENT_EVIDENCE", field: "primary_source" },
      { code: "ALTERNATIVE_SOURCE_INVALID", field: "alternative_sources" },
    ],
  });
  assert.deepEqual(context.draft.primary_source, { url: "https://x.com/thsottiaux" });
  assert.deepEqual(context.draft.alternative_sources, [
    { url: "https://x.com/thsottiaux/status/2092315945700381084" },
    { url: "https://x.com/thsottiaux/status/2092359619075314102" },
  ]);
  assert.equal(context.draft.primary_source.authority_verified, undefined);
  assert.equal(context.draft.alternative_sources[0].authority_verified, undefined);
});

test("Corrector por campos · el parser de cuenta acepta el perfil exacto y rechaza posts o handles ajenos", async () => {
  const registry = [
    sourceRegistry("fixture-generic-v1", "11111111-1111-4111-8111-111111111111", "x.com"),
    sourceRegistry("atinara-public-account-source-v1", "22222222-2222-4222-8222-222222222222"),
  ];
  const html = '<html><head><title>Tibo (@thsottiaux) / X</title><meta property="og:title" content="Tibo (@thsottiaux) / X"></head><body></body></html>';
  const fetcher = async () => new Response(html, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
  const context = { draft: { subject: "Thibault “Tibo” Sottiaux (@thsottiaux)", category: "Eventos" } };
  const accepted = await repair.validateRegisteredPrimarySource(
    { url: "https://x.com/thsottiaux", origin: "draft_inherited" },
    context,
    registry,
    fetcher,
  );
  assert.equal(accepted.evidence.accepted, true);
  assert.equal(accepted.evidence.registry_parser_version, "atinara-public-account-source-v1");
  assert.equal(accepted.evidence.identity_scope, "public_account_path_v1");
  assert.equal(accepted.evidence.account_handle, "thsottiaux");
  assert.equal(repair.isVerifiedPrimarySource(accepted.source, "Eventos"), true);

  const status = await repair.validateRegisteredPrimarySource(
    { url: "https://x.com/thsottiaux/status/2092315945700381084" },
    context,
    registry,
    fetcher,
  );
  assert.equal(status.source, null);
  assert.equal(status.evidence.code, "PRIMARY_SOURCE_IRRELEVANT");

  const mismatched = await repair.validateRegisteredPrimarySource(
    { url: "https://x.com/another_handle" },
    context,
    registry,
    fetcher,
  );
  assert.equal(mismatched.source, null);
  assert.equal(mismatched.evidence.code, "PRIMARY_SOURCE_IRRELEVANT");
});

test("Corrector por campos · el borrador manual de Tibo cambia solo fuentes", () => {
  const draft = tiboDraft();
  const context = {
    draft,
    repairable_content_issues: [{
      code: "INSUFFICIENT_EVIDENCE",
      field: "primary_source",
      message: "La fuente primaria no conserva una atestación oficial vigente para esta versión.",
    }],
  };
  const { complete, scope, scoped } = buildScopedTiboRepair(context);
  assert.ok(Object.keys(complete.patch).length > 2, "la propuesta completa puede razonar sobre el contrato entero");
  assert.deepEqual(Object.keys(scoped.patch).sort(), ["alternative_sources", "primary_source"]);
  const repaired = repair.applyRepairPatch(draft, scoped);
  registries.assertAgentRepairFieldsAllowed(scope, repair.changedRepairFields(draft, repaired));
  assert.deepEqual(repair.changedRepairFields(draft, repaired).sort(), ["alternative_sources", "primary_source"]);
  for (const field of registries.MARKET_WRITER_FIELD_ALLOWLIST.filter((field) =>
    !["primary_source", "alternative_sources"].includes(field))) {
    assert.deepEqual(repaired[field], draft[field], field);
  }
  assert.deepEqual(repair.validateRepairDraft(repaired), []);
});

test("Corrector por campos · la misma proyección conserva un borrador procedente de Radar", () => {
  const draft = tiboDraft();
  const context = {
    draft,
    radar_candidate: {
      id: "33333333-3333-4333-8333-333333333333",
      source_question: draft.question,
      source_title: draft.subject,
      source_resolution_rules: draft.yes_criteria,
      source_resolution_url: "https://x.com/thsottiaux",
      atinara_category: "Eventos",
    },
    repairable_content_issues: [{ code: "INSUFFICIENT_EVIDENCE", field: "primary_source" }],
  };
  const { scoped } = buildScopedTiboRepair(context);
  const repaired = repair.applyRepairPatch(draft, scoped);
  assert.deepEqual(repair.changedRepairFields(draft, repaired).sort(), ["alternative_sources", "primary_source"]);
  assert.equal(repaired.question, draft.question);
  assert.equal(repaired.yes_criteria, draft.yes_criteria);
  assert.equal(repaired.resolution_deadline, draft.resolution_deadline);
});

test("Corrector por campos · cada campo persistible tiene una estrategia de escritura", () => {
  const capabilities = [
    ["INVALID_MARKET_SLUG", "normalize_market_slug", ["market_slug"]],
    ["INVALID_QUESTION", "rebuild_binary_question", ["question"]],
    ["SUBJECT_REQUIRED", "infer_canonical_subject", ["subject"]],
    ["CATEGORY_REQUIRED", "infer_category", ["category"]],
    ["OPTIONS_NOT_BINARY", "normalize_binary_options", ["yes_option", "no_option"]],
    ["PERIOD_REQUIRED", "derive_evaluation_period", ["evaluation_period_label", "evaluation_ends_at", "closes_at"]],
    ["TIMEZONE_INVALID", "normalize_iana_timezone", ["timezone"]],
    ["RESOLUTION_DEADLINE_INVALID", "derive_resolution_deadline", ["resolution_deadline"]],
    ["YES_CRITERIA_REQUIRED", "rebuild_resolution_criteria", ["yes_criteria", "no_criteria"]],
    ["EDGE_CASES_REQUIRED", "derive_edge_cases", ["edge_cases"]],
    ["PUBLIC_CRITERIA_REQUIRED", "derive_public_criteria", ["public_criteria"]],
    ["DESCRIPTION_REQUIRED", "derive_description", ["description"]],
    ["DELAY_TREATMENT_REQUIRED", "derive_delay_treatment", ["delay_treatment"]],
    ["CANCELLATION_TREATMENT_REQUIRED", "derive_cancellation_treatment", ["cancellation_treatment"]],
    ["LEAK_TREATMENT_REQUIRED", "derive_leak_treatment", ["leak_treatment"]],
    ["RENAME_TREATMENT_REQUIRED", "derive_rename_treatment", ["rename_treatment"]],
    ["ASSUMPTIONS_REQUIRED", "derive_assumptions", ["assumptions"]],
    ["INSUFFICIENT_EVIDENCE", "apply_registered_sources", ["primary_source", "alternative_sources"]],
  ];
  const snapshot = {
    strategies: capabilities.map(([, strategy, fields]) => ({
      strategy_key: strategy,
      can_write: true,
      write_fields: fields,
    })),
    bindings: capabilities.map(([issue, strategy]) => ({ issue_code: issue, strategy_key: strategy })),
  };
  const covered = new Set();
  assert.equal(new Set(repair.REPAIRABLE_ISSUE_CODES).size, repair.REPAIRABLE_ISSUE_CODES.length);
  for (const [issue] of capabilities) {
    const scope = registries.resolveAgentRepairWriteScope(snapshot, [issue]);
    scope.allowedFields.forEach((field) => covered.add(field));
  }
  assert.deepEqual([...covered].sort(), [...registries.MARKET_WRITER_FIELD_ALLOWLIST].sort());
  const sql = `${issueRegistryMigration}\n${initialRegistryMigration}\n${fieldScopeMigration}`;
  for (const [issue, strategy, fields] of capabilities) {
    assert.match(sql, new RegExp(issue));
    assert.match(sql, new RegExp(strategy));
    for (const field of fields) assert.match(sql, new RegExp(`['\"]${field}['\"]`));
  }
});

test("Corrector por campos · Validator y editor semántico aceptan los códigos de todos los campos nuevos", () => {
  const codes = [
    ["INVALID_MARKET_SLUG", "market_slug"],
    ["DESCRIPTION_REQUIRED", "description"],
    ["DELAY_TREATMENT_REQUIRED", "delay_treatment"],
    ["CANCELLATION_TREATMENT_REQUIRED", "cancellation_treatment"],
    ["LEAK_TREATMENT_REQUIRED", "leak_treatment"],
    ["RENAME_TREATMENT_REQUIRED", "rename_treatment"],
    ["ASSUMPTIONS_REQUIRED", "assumptions"],
  ];
  for (const [code, field] of codes) {
    assert.ok(repair.VALIDATOR_CONTENT_ISSUE_CODES.includes(code), code);
    assert.match(taskPolicy, new RegExp(`\\b${code}\\b`));
    const issue = { code, field, message: `Defecto contractual verificable en ${field}.` };
    assert.deepEqual(
      outputValidation.validateTaskOutput("market_draft_validation", {
        result: "rejected",
        issues: [issue],
        editorial_notes: [],
      }),
      { result: "rejected", issues: [issue], editorial_notes: [] },
    );
    assert.doesNotThrow(() => outputValidation.validateTaskOutput("market_draft_repair", {
      patch: {
        description: "",
        assumptions: "",
        delay_treatment: "",
        cancellation_treatment: "",
        leak_treatment: "",
        rename_treatment: "",
      },
      explanations: [],
      unresolved_issues: [{ code, field, reason: `No se puede reparar ${field} sin inventar.` }],
    }));
  }
});

test("Corrector por campos · X no amplía la autoridad factual de Radar ni las puertas humanas", () => {
  assert.match(fieldScopeMigration, /'public_social_account'[\s\S]*?'\["primary_resolution"\]'::jsonb/);
  const socialInsert = fieldScopeMigration.slice(
    fieldScopeMigration.indexOf("insert into private.market_source_registry"),
    fieldScopeMigration.indexOf("create or replace function private.enforce_market_draft_public_account_check_v1"),
  );
  assert.doesNotMatch(socialInsert, /radar_fact_evidence/);
  assert.match(fieldScopeMigration, /PUBLIC_ACCOUNT_IDENTITY_MISMATCH/);
  assert.match(fieldScopeMigration, /never_confirm_or_publish/);
  assert.doesNotMatch(fieldScopeMigration, /update private\.market_(?:issue|repair_strategy|issue_strategy)/i);
  assert.doesNotMatch(fieldScopeMigration, /insert into public\.(?:markets|predictions)/i);
  assert.match(fixerEdge, /projectDeterministicRepair[\s\S]*applyRepairPatch/);
  assert.match(fixerEdge, /get_market_draft_authoritative_source_registry_v1/);
  assert.doesNotMatch(fixerEdge, /get_market_radar_authoritative_source_domains_v1/);
});
