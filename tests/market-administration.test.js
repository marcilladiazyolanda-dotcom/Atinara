const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { test } = require("node:test");

const root = join(__dirname, "..");
const migration = readFileSync(join(root, "supabase/migrations/20260803143000_add_market_administration_gate.sql"), "utf8");
const memoryMigration = readFileSync(join(root, "supabase/migrations/20260808120000_add_authoritative_draft_versions_and_review_attempts.sql"), "utf8");
const saveActorFix = readFileSync(join(root, "supabase/migrations/20260808131500_fix_save_market_draft_actor_ambiguity.sql"), "utf8");
const whitespaceFix = readFileSync(join(root, "supabase/migrations/20260808132500_fix_market_text_normalization.sql"), "utf8");
const bindingAliasFix = readFileSync(join(root, "supabase/migrations/20260808133500_fix_binding_source_alias_ambiguity.sql"), "utf8");
const validator = readFileSync(join(root, "supabase/functions/validate-market-draft/index.ts"), "utf8");
const aiTaskPolicy = readFileSync(join(root, "supabase/functions/_shared/ai/task-policy.mjs"), "utf8");
const geminiLegacyAdapter = readFileSync(join(root, "supabase/functions/_shared/ai/providers/gemini-legacy.mjs"), "utf8");
const aiModelCatalog = readFileSync(join(root, "supabase/functions/_shared/ai/model-catalog.mjs"), "utf8");
const fixer = readFileSync(join(root, "supabase/functions/market-draft-fixer/index.ts"), "utf8");
const fixerUi = readFileSync(join(root, "market-draft-fixer.js"), "utf8");
const definition = readFileSync(join(root, "supabase/functions/_shared/market-definition.ts"), "utf8");
const adminUi = readFileSync(join(root, "admin-markets.js"), "utf8");
const adminHtml = readFileSync(join(root, "admin-markets.html"), "utf8");
const adminAgentBridge = readFileSync(join(root, "admin-agent-engine.js"), "utf8");
const styles = readFileSync(join(root, "styles.css"), "utf8");
const adminHelpers = require("../market-admin-validation.js");

test("1 · rechaza éxito sin métrica como concepto subjetivo", () => {
  assert.match(migration, /exito\|éxito/);
  assert.match(migration, /QUESTION_AMBIGUOUS_TERM/);
});

test("2 · rechaza pronto sin periodo exacto", () => {
  assert.match(migration, /importante\|grande\|pronto/);
  assert.match(migration, /QUESTION_AMBIGUOUS_TERM/);
  assert.match(migration, /PERIOD_REQUIRED/);
});

test("3 · bloquea una definición de todo julio que termine el día 28", () => {
  assert.match(definition, /EVALUATION_PERIOD_NOT_FULL_MONTH/);
  assert.match(definition, /lastDayOfMonth/);
  assert.match(definition, /evaluation_timezone/);
  assert.match(migration, /evaluation_ends_at = closes_at/);
  assert.match(migration, /add column if not exists evaluation_timezone text/);
});

test("4 · exige fuentes públicas HTTPS principal y alternativa", () => {
  assert.match(migration, /PRIMARY_SOURCE_INVALID/);
  assert.match(migration, /ALTERNATIVE_SOURCE_REQUIRED/);
  assert.match(migration, /ALTERNATIVE_SOURCE_INVALID/);
});

test("5 · detecta opciones o criterios solapados", () => {
  assert.match(migration, /OPTIONS_NOT_BINARY/);
  assert.match(migration, /OPTIONS_OVERLAP/);
  assert.match(aiTaskPolicy, /opciones solapadas/);
});

test("6 · una revisión aprobada aún exige confirmación humana", () => {
  assert.match(migration, /when 'approved' then 'review_approved'/);
  assert.match(migration, /confirm_market_draft_review/);
  assert.match(migration, /human_confirmed_at is null/);
  assert.match(adminUi, /Confirmar humanamente/);
});

test("7 · caída, cuota o respuesta inválida fallan de forma cerrada", () => {
  assert.match(validator, /provider_unavailable/);
  assert.match(validator, /provider_rate_limited/);
  assert.match(validator, /provider_timeout/);
  assert.match(validator, /invalid_response/);
  assert.match(validator, /El mercado continúa privado/);
  assert.match(memoryMigration, /REVIEW_TECHNICAL_FAILURE_EFFECTIVE_PRESERVED/);
});

test("8 · editar un campo esencial invalida la aprobación anterior", () => {
  assert.match(memoryMigration, /DRAFT_SAVED_REVIEW_INVALIDATED/);
  assert.match(memoryMigration, /if previous_fingerprint = next_fingerprint then/);
  assert.match(memoryMigration, /reviewed_version = null/);
  assert.match(memoryMigration, /human_confirmed_at = null/);
});

test("9 · una usuaria normal o llamada directa no puede publicar ni falsear una revisión", () => {
  assert.match(migration, /private\.require_current_admin\(\)/);
  assert.match(migration, /raw_app_meta_data/);
  assert.match(migration, /revoke all on function public\.publish_market_draft/);
  assert.match(migration, /record_market_draft_review[\s\S]+to service_role/);
});

test("10 · borradores e informes privados no forman parte de las RPC públicas", () => {
  assert.match(migration, /create table if not exists private\.market_drafts/);
  assert.match(migration, /create table if not exists private\.market_review_reports/);
  assert.match(migration, /revoke all on schema private from public, anon, authenticated/);
  assert.doesNotMatch(
    readFileSync(join(root, "supabase/migrations/20260801172543_add_live_prediction_market_model.sql"), "utf8"),
    /market_drafts|market_review_reports/
  );
});

test("la publicación vuelve a comprobar versión, huella, rol y aprobación dentro de Supabase", () => {
  assert.match(memoryMigration, /content_version <> expected_version_input|content_version <> expected_version_input|content_version <> expected_version_input/);
  assert.match(memoryMigration, /reviewed_fingerprint is distinct from draft_row\.content_fingerprint/);
  assert.match(memoryMigration, /actor_id uuid := private\.require_current_admin\(\)/);
  assert.match(memoryMigration, /actor_id_input is null or not exists[\s\S]+raw_app_meta_data/);
  assert.match(memoryMigration, /review_status <> 'approved'/);
});

test("la publicación programada v2 exige el secreto exclusivo de Cron y no expone borradores", () => {
  const scheduler = readFileSync(
    join(root, "supabase/functions/publish-scheduled-markets/index.ts"),
    "utf8"
  );
  assert.match(scheduler, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(scheduler, /x-atinara-cron-secret/);
  assert.match(scheduler, /verify_market_publish_cron_secret/);
  assert.match(scheduler, /cronSecret\.length < 32/);
  assert.match(scheduler, /publish_due_market_drafts/);
  assert.match(scheduler, /published_count/);
  assert.doesNotMatch(scheduler, /JSON\.stringify\(data\)/);
});

test("la administración no ofrece omitir rechazo ni aceptar el riesgo", () => {
  assert.match(adminUi, /No existe una acción para omitir un rechazo/);
  assert.doesNotMatch(adminUi, /data-(?:skip|bypass|accept-risk)/i);
});

test("las fechas locales se interpretan con la zona IANA elegida", () => {
  assert.equal(
    adminHelpers.toIsoOrEmpty("2026-07-31T23:59", "Europe/Madrid"),
    "2026-07-31T21:59:00.000Z"
  );
  assert.equal(adminHelpers.toIsoOrEmpty("fecha no válida", "Europe/Madrid"), "");
  assert.equal(
    adminHelpers.toIsoOrEmpty("2026-08-31T23:59:59.123", "UTC"),
    "2026-08-31T23:59:59.123Z"
  );
  assert.equal(
    adminHelpers.toIsoOrEmpty("2026-08-31T23:59:59.123", "Europe/Madrid"),
    "2026-08-31T21:59:59.123Z"
  );
  assert.equal(
    adminHelpers.toIsoOrEmpty("2026-03-29T02:30:00.000", "Europe/Madrid"),
    "",
    "una hora local inexistente por cambio DST debe fallar cerrada"
  );
  assert.equal(
    adminHelpers.timestampFromForm(
      "2026-10-25T02:30:00",
      "Europe/Madrid",
      "2026-10-25T01:30:00.000Z",
      "Europe/Madrid"
    ),
    "2026-10-25T01:30:00.000Z",
    "un round-trip debe preservar cuál de las dos horas ambiguas era la original"
  );
});

test("Paso 13.5.2 · el guardado canónico no-op conserva versión, revisión y confirmación", () => {
  assert.match(memoryMigration, /'changed', false/);
  assert.match(memoryMigration, /'review_preserved', true/);
  assert.match(memoryMigration, /'version_unchanged', true/);
  assert.match(memoryMigration, /'human_confirmation_preserved', draft_row\.human_confirmed_at is not null/);
  assert.match(memoryMigration, /DRAFT_SAVE_NOOP_REVIEW_PRESERVED/);
  assert.match(memoryMigration, /IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD/);
  assert.match(memoryMigration, /unique \(actor_id, operation, request_key\)/);
  assert.match(memoryMigration, /'draft_id', draft_id_input[\s\S]+expected_version_input/);
  assert.match(whitespaceFix, /trim\(regexp_replace\([\s\S]+\[\[:space:\]\]\+/);
  assert.match(saveActorFix, /actor_id_value uuid := private\.require_current_admin\(\)/);
  assert.match(saveActorFix, /on conflict \(actor_id, operation, request_key\) do nothing/);
  assert.match(bindingAliasFix, /source_item jsonb/);
  assert.match(bindingAliasFix, /for source_item in select value from jsonb_array_elements\(sources_input\)/);
});

test("Paso 13.5.2 · las versiones materiales son inmutables y restaurar crea otra versión", () => {
  assert.match(memoryMigration, /create table if not exists private\.market_draft_versions/);
  assert.match(memoryMigration, /prevent_market_draft_version_update/);
  assert.match(memoryMigration, /MARKET_DRAFT_VERSION_IMMUTABLE/);
  assert.match(memoryMigration, /create or replace function public\.restore_market_draft_version/);
  assert.match(memoryMigration, /content_version = content_version \+ 1/);
  assert.match(memoryMigration, /restored_from_version_id/);
});

test("Paso 13.5.2 · la revisión efectiva y el último intento son memorias separadas", () => {
  assert.match(memoryMigration, /create table if not exists private\.market_effective_reviews/);
  assert.match(memoryMigration, /create table if not exists private\.market_review_attempts/);
  assert.match(memoryMigration, /effective_review_id bigint/);
  assert.match(memoryMigration, /last_review_attempt_id uuid/);
  assert.match(memoryMigration, /classification_value = 'technical'[\s\S]+effective_review_id = current_effective_id/);
  assert.match(memoryMigration, /when current_effective_id is not null then 'review_approved'/);
  assert.match(adminUi, /Revisión efectiva:/);
  assert.match(adminUi, /Último intento:/);
  assert.match(adminUi, /Incidencia temporal del servicio/);
});

test("Paso 13.5.2 · una aprobación solo se reutiliza con política y esquema compatibles", () => {
  assert.match(memoryMigration, /market_review_policy_compatibility/);
  assert.match(memoryMigration, /compatibility\.reusable/);
  assert.match(memoryMigration, /compatibility\.invalidated_at is null/);
  assert.match(memoryMigration, /exact_canonical_fingerprint_and_policy_reuse/);
  assert.match(memoryMigration, /one_off_precision_recovery_verified_by_legacy_fingerprint_binding_and_field_diff/);
});

test("Paso 13.5.2 · el round-trip conserva milisegundos, zona y metadatos de fuentes", () => {
  const elements = new Map(Object.entries({
    market_slug: { value: "gta-vi" },
    question: { value: "¿Grand Theft Auto VI será lanzado el 31 de agosto de 2026 o antes?" },
    subject: { value: "Grand Theft Auto VI" },
    category: { value: "Lanzamientos" },
    evaluation_period_label: { value: "Hasta el 31 de agosto de 2026" },
    evaluation_ends_at: { value: "2026-08-31T23:59:59.123" },
    timezone: { value: "UTC" },
    resolution_deadline: { value: "2026-09-01T14:00:00.456" },
    yes_criteria: { value: "Criterio Sí suficientemente objetivo." },
    no_criteria: { value: "Criterio No suficientemente objetivo." },
    edge_cases: { value: "Casos límite definidos." },
    primary_source_url: { value: "https://example.com/official" },
    alternative_sources: { value: "https://example.com/b\nhttps://example.com/a" },
    delay_treatment: { value: "Tratamiento del retraso." },
    cancellation_treatment: { value: "Tratamiento de cancelación." },
    leak_treatment: { value: "Tratamiento de filtraciones." },
    rename_treatment: { value: "Tratamiento de cambios de nombre." },
    assumptions: { value: "Supuestos explícitos." },
    public_criteria: { value: "Criterios públicos." },
    description: { value: "Descripción pública." }
  }));
  const form = { elements: { namedItem: (name) => elements.get(name) || null } };
  const base = {
    primary_source: { url: "https://example.com/official", role: "official", label: "Rockstar" },
    alternative_sources: [
      { url: "https://example.com/a", role: "corroboration", precedence: 7 },
      { url: "https://example.com/b", role: "fallback", precedence: 4 }
    ]
  };
  const payload = adminHelpers.collectDraftPayload(form, base);
  assert.equal(payload.evaluation_ends_at, "2026-08-31T23:59:59.123Z");
  assert.equal(payload.resolution_deadline, "2026-09-01T14:00:00.456Z");
  assert.equal(payload._timestamp_precision, "milliseconds-v1");
  assert.equal(payload.primary_source.label, "Rockstar");
  assert.deepEqual(payload.alternative_sources.map((source) => source.url), [
    "https://example.com/a", "https://example.com/b"
  ]);
  assert.deepEqual(payload.alternative_sources.map((source) => source.precedence), [7, 4]);
  assert.match(adminUi, /step: "0\.001"/);
  assert.match(adminAgentBridge, /_timestamp_precision = "milliseconds-v1"/);
  assert.match(adminAgentBridge, /return helpers\.toIsoOrEmpty\(raw, timeZone\)/);
});

test("Paso 13.5.2 · el orden no semántico de fuentes y espacios equivalentes no cambia el payload", () => {
  const base = {
    market_slug: "market-one",
    question: "¿Una   pregunta con espacios suficientes?",
    evaluation_ends_at: "2026-08-31T23:59:59.000Z",
    closes_at: "2026-08-31T23:59:59Z",
    timezone: "UTC",
    alternative_sources: [
      { url: "https://example.com/b", role: "fallback", precedence: 2 },
      { url: "https://example.com/a", role: "corroboration", precedence: 3 }
    ]
  };
  const reordered = {
    ...base,
    question: "  ¿Una pregunta\r\ncon espacios suficientes?  ",
    alternative_sources: [...base.alternative_sources].reverse()
  };
  assert.equal(adminHelpers.draftPayloadsEqual(base, reordered), true);
  const changedPrecedence = structuredClone(reordered);
  changedPrecedence.alternative_sources[0].precedence = 9;
  assert.equal(adminHelpers.draftPayloadsEqual(base, changedPrecedence), false);
  const duplicateUrl = {
    ...base,
    alternative_sources: [
      { url: "https://example.com/a", role: "z" },
      { url: "https://example.com/a", role: "a" },
      { url: "https://example.com/b", role: "fallback", precedence: 2 }
    ]
  };
  assert.equal(adminHelpers.canonicalizeDraftPayload(duplicateUrl).alternative_sources.length, 2);
});

test("Paso 13.5.2 · validate-market-draft usa Gateway Gemini vigente y un solo retry inválido", () => {
  assert.doesNotMatch(validator, /gemini-3\.1-flash-lite|x-goog-api-key|generativelanguage\.googleapis\.com/);
  assert.match(validator, /AI_TASK_CONTRACTS\.market_draft_validation/);
  assert.match(aiModelCatalog, /gemini-3\.1-flash-lite/);
  assert.match(aiTaskPolicy, /responseMimeType: "application\/json"/);
  assert.match(aiTaskPolicy, /responseJsonSchema/);
  assert.match(aiTaskPolicy, /thinkingConfig: \{ thinkingLevel: "minimal" \}/);
  assert.doesNotMatch(aiTaskPolicy, /temperature:/);
  assert.match(aiTaskPolicy, /invalidOutputRetries: 1/);
  assert.match(geminiLegacyAdapter, /parseOutput/);
  assert.match(validator, /safe_provider_metadata_input/);
  assert.match(validator, /beginning\.idempotency_replay === true && beginning\.completed === true/);
  assert.match(validator, /export const validatorTestSurface/);
  assert.doesNotMatch(validator, /console\.(?:log|error)\([^\n]*(?:authorization|geminiKey|secretKey)/i);
});

test("Paso 13.5.2 · el Corrector separa incidencias técnicas y corrige contenido real", () => {
  assert.match(fixerUi, /latestAttemptClassification === "technical"/);
  assert.match(fixer, /AUTONOMOUS_REPAIR_MAX_ROUNDS/);
  assert.match(fixer, /technical_incident/);
  assert.match(fixer, /error: "AUTOMATIC_REVIEW_TECHNICAL_INCOMPLETE"/);
  assert.match(fixer, /repair_saved: allChanged\.size > 0/);
  assert.match(fixer, /borrador continúa privado y sin aprobación/);
  assert.doesNotMatch(fixer, /TECHNICAL_REVIEW_FAILURE_NOT_REPAIRABLE/);
  assert.match(fixer, /functions\/v1\/validate-market-draft/);
  assert.doesNotMatch(fixer, /record_market_draft_review/);
});

test("Paso 13.5.2 · UI bloquea no-op, doble envío y salida con cambios", () => {
  assert.match(adminUi, /Sin cambios pendientes/);
  assert.match(adminUi, /Cambios sin guardar/);
  assert.match(adminUi, /draftPayloadsEqual/);
  assert.match(adminUi, /beforeunload/);
  assert.match(adminUi, /state\.busy/);
  assert.match(adminUi, /crypto\.randomUUID\(\)/);
  assert.match(adminUi, /get_admin_market_draft/);
});

test("Paso 13.5.2 · los códigos largos de auditoría no desbordan el editor", () => {
  assert.match(styles, /\.admin-audit-trail li > \*\s*\{[^}]*min-width:\s*0;[^}]*overflow-wrap:\s*anywhere;/);
  assert.match(styles, /\.admin-draft-editor fieldset,[\s\S]*?\.admin-publish-controls\s*\{[^}]*min-width:\s*0;[^}]*max-width:\s*100%;/);
  assert.match(styles, /\.admin-market-page input,[\s\S]*?\.admin-market-page select\s*\{[^}]*width:\s*100%;[^}]*min-width:\s*0;[^}]*max-width:\s*100%;/);
});

test("Paso 13.5.2 · seguridad y publicación permanecen fail-closed", () => {
  assert.match(memoryMigration, /set search_path = ''/);
  assert.match(memoryMigration, /force row level security/);
  assert.match(memoryMigration, /revoke all on table private\.market_draft_versions from public, anon, authenticated/);
  assert.match(memoryMigration, /grant execute on function public\.record_market_draft_review_v2[\s\S]+to service_role/);
  assert.match(memoryMigration, /CURRENT_APPROVAL_AND_CONFIRMATION_REQUIRED/);
  assert.match(memoryMigration, /human_confirmed_review_id is distinct from effective_review_id_value/);
  assert.match(memoryMigration, /CURRENT_BINDING_COMPATIBILITY_REQUIRED/);
});
