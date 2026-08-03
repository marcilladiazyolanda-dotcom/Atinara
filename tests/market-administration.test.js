const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { test } = require("node:test");

const root = join(__dirname, "..");
const migration = readFileSync(join(root, "supabase/migrations/20260803143000_add_market_administration_gate.sql"), "utf8");
const validator = readFileSync(join(root, "supabase/functions/validate-market-draft/index.ts"), "utf8");
const definition = readFileSync(join(root, "supabase/functions/_shared/market-definition.ts"), "utf8");
const adminUi = readFileSync(join(root, "admin-markets.js"), "utf8");
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
  assert.match(validator, /opciones solapadas/);
});

test("6 · una revisión aprobada aún exige confirmación humana", () => {
  assert.match(migration, /when 'approved' then 'review_approved'/);
  assert.match(migration, /confirm_market_draft_review/);
  assert.match(migration, /human_confirmed_at is null/);
  assert.match(adminUi, /Confirmar humanamente/);
});

test("7 · caída, cuota o respuesta inválida fallan de forma cerrada", () => {
  assert.match(validator, /service_unavailable/);
  assert.match(validator, /quota_exhausted/);
  assert.match(validator, /invalid_response/);
  assert.match(validator, /El mercado continúa privado/);
});

test("8 · editar un campo esencial invalida la aprobación anterior", () => {
  assert.match(migration, /DRAFT_SAVED_REVIEW_INVALIDATED/);
  assert.match(migration, /previous_fingerprint is distinct from next_fingerprint/);
  assert.match(migration, /reviewed_version = case[\s\S]+then null/);
  assert.match(migration, /human_confirmed_at = case[\s\S]+then null/);
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
  assert.match(migration, /content_version <> expected_version_input/);
  assert.match(migration, /reviewed_fingerprint is distinct from private\.market_draft_fingerprint/);
  assert.match(migration, /actor_id uuid := private\.require_current_admin\(\)/);
  assert.match(migration, /actor_id_input is null or not exists[\s\S]+raw_app_meta_data/);
  assert.match(migration, /review_status <> 'approved'/);
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
});
