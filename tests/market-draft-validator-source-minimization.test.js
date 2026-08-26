const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { pathToFileURL } = require("node:url");
const { before, test } = require("node:test");

const root = join(__dirname, "..");
const sourceProjectionPath = join(
  root,
  "supabase/functions/_shared/market-draft-validation.mjs",
);
const sanitizerPath = join(root, "supabase/functions/_shared/ai/sanitize.mjs");
const taskPolicyPath = join(root, "supabase/functions/_shared/ai/task-policy.mjs");
const validatorEdge = readFileSync(
  join(root, "supabase/functions/validate-market-draft/index.ts"),
  "utf8",
);

let projection;
let sanitizer;
let taskPolicy;

before(async () => {
  [projection, sanitizer, taskPolicy] = await Promise.all([
    import(pathToFileURL(sourceProjectionPath).href),
    import(pathToFileURL(sanitizerPath).href),
    import(pathToFileURL(taskPolicyPath).href),
  ]);
});

function richSource(url, overrides = {}) {
  return {
    url,
    name: "Cuenta pública oficial",
    role: "PRIMARY_RESOLUTION",
    publisher: "Publicador que no debe duplicarse",
    excerpt: "Contenido remoto no confiable que no necesita el Validator. ".repeat(100),
    registry_source_id: "11111111-1111-4111-8111-111111111111",
    registry_domain: "x.com",
    registry_parser_version: "atinara-public-account-source-v1",
    registry_role: "primary_resolution",
    registry_categories: [],
    account_handle: "cuenta_publica",
    draft_category: "Eventos",
    identity_scope: "public_account_path_v1",
    authority_basis: "private_source_registry_primary_resolution_v1",
    relevance_basis: "fetched_content_and_canonical_url_v1",
    authority_verified: true,
    relevance_verified: true,
    validated_reachable: true,
    registry_role_verified: true,
    validation_version: "atinara-primary-source-validation-v1",
    ...overrides,
  };
}

function completeDraft(overrides = {}) {
  return {
    market_slug: "cuenta-publica-confirma-evento-2026",
    question: "¿Confirmará públicamente la cuenta que ocurrió el evento antes del cierre?",
    subject: "Cuenta pública (@cuenta_publica)",
    category: "Eventos",
    yes_option: "Sí",
    no_option: "No",
    evaluation_period_label: "Desde la publicación hasta el 30 de septiembre de 2026.",
    evaluation_ends_at: "2026-10-01T06:59:59.000Z",
    closes_at: "2026-10-01T06:59:59.000Z",
    timezone: "America/Los_Angeles",
    resolution_deadline: "2026-10-03T06:59:59.000Z",
    yes_criteria: "Resolver Sí cuando exista una confirmación pública inequívoca.",
    no_criteria: "Resolver No cuando termine el periodo sin confirmación válida.",
    edge_cases: "Una fotografía o una afirmación de terceros no bastan por sí solas.",
    primary_source: richSource("https://x.com/cuenta_publica"),
    alternative_sources: [richSource("https://x.com/cuenta_publica/status/123", {
      name: "",
      publisher: "X",
      role: "Fuente oficial alternativa",
    })],
    delay_treatment: "Una indisponibilidad temporal no amplía el periodo evaluado.",
    cancellation_treatment: "La ausencia de publicación resuelve No y no anula el mercado.",
    leak_treatment: "Las filtraciones de terceros no resuelven el mercado.",
    rename_treatment: "Un cambio de handle exige continuidad pública verificable.",
    assumptions: "La confirmación debe describir una acción ya realizada.",
    public_criteria: "Sí con confirmación pública válida dentro del periodo; de lo contrario, No.",
    description: "Mercado binario sobre una confirmación pública verificable.",
    ...overrides,
  };
}

test("Validator · reproduce el rechazo del Gateway con una fuente enriquecida sin minimizar", () => {
  const draft = completeDraft();
  assert.throws(
    () => sanitizer.sanitizeTaskInput(
      { draft, primarySourceAttested: true },
      taskPolicy.AI_TASK_POLICY_CATALOG.market_draft_validation.inputProjection,
    ),
    (error) => error?.code === "AI_INPUT_FIELD_NOT_ALLOWED"
      && error?.details?.phase === "input.draft.primary_source.publisher",
  );
});

test("Validator · minimiza fuentes enriquecidas y conserva los 23 campos rellenables", () => {
  const draft = completeDraft();
  const minimized = projection.semanticDraft(draft);
  const expectedFields = [
    "market_slug", "question", "subject", "category", "yes_option", "no_option",
    "evaluation_period_label", "evaluation_ends_at", "closes_at", "timezone",
    "resolution_deadline", "yes_criteria", "no_criteria", "edge_cases",
    "primary_source", "alternative_sources", "delay_treatment", "cancellation_treatment",
    "leak_treatment", "rename_treatment", "assumptions", "public_criteria", "description",
  ];

  assert.deepEqual(Object.keys(minimized), expectedFields);
  assert.deepEqual(minimized.primary_source, {
    url: "https://x.com/cuenta_publica",
    name: "Cuenta pública oficial",
    role: "PRIMARY_RESOLUTION",
  });
  assert.deepEqual(minimized.alternative_sources, [{
    url: "https://x.com/cuenta_publica/status/123",
    name: "X",
    role: "Fuente oficial alternativa",
  }]);
  assert.doesNotMatch(JSON.stringify(minimized), /excerpt|registry_source_id|account_handle|identity_scope/);
  assert.ok(JSON.stringify(minimized).length < JSON.stringify(draft).length / 2);

  const sanitized = sanitizer.sanitizeTaskInput(
    { draft: minimized, primarySourceAttested: true },
    taskPolicy.AI_TASK_POLICY_CATALOG.market_draft_validation.inputProjection,
  );
  assert.deepEqual(sanitized.draft, minimized);
  assert.equal(sanitized.primarySourceAttested, true);
});

test("Validator · la procedencia manual o Radar no cambia la proyección semántica", () => {
  const manual = completeDraft({ radar_candidate_id: null, origin_type: "manual" });
  const radar = completeDraft({
    radar_candidate_id: "22222222-2222-4222-8222-222222222222",
    origin_type: "radar",
  });
  assert.deepEqual(projection.semanticDraft(manual), projection.semanticDraft(radar));
  assert.match(validatorEdge, /import \{ semanticDraft \} from "\.\.\/_shared\/market-draft-validation\.mjs"/);
  assert.match(validatorEdge, /error_phase: errorPhase/);
  assert.doesNotMatch(validatorEdge, /primary_source:\s*draft\.primary_source/);
  assert.doesNotMatch(validatorEdge, /alternative_sources:\s*draft\.alternative_sources/);
});
