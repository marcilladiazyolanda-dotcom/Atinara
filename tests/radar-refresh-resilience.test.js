const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { test } = require("node:test");

const root = join(__dirname, "..");
const edge = readFileSync(join(root, "supabase/functions/market-radar/index.ts"), "utf8");
const shared = readFileSync(join(root, "supabase/functions/_shared/market-radar.mjs"), "utf8");
const migration = readFileSync(
  join(root, "supabase/migrations/20260809180000_fix_radar_refresh_timeout.sql"),
  "utf8",
);
const cycleV2Migration = readFileSync(
  join(root, "supabase/migrations/20260809204739_close_expert_market_cycle_v2.sql"),
  "utf8",
);
const resumabilityMigration = readFileSync(
  join(root, "supabase/migrations/20260820163014_harden_radar_provider_resumability_v1.sql"),
  "utf8",
);
const batchResumeMigration = readFileSync(
  join(root, "supabase/migrations/20260824190000_harden_radar_batch_resume_visibility_v1.sql"),
  "utf8",
);
const sqlTest = readFileSync(
  join(root, "supabase/tests/radar_refresh_timeout_transaction.sql"),
  "utf8",
);
const resumabilitySqlTest = readFileSync(
  join(root, "supabase/tests/radar_provider_resumability_v1_transaction.sql"),
  "utf8",
);

test("el parser horario ignora barras ordinarias y valida IANA sin recorrer el catálogo", () => {
  assert.match(migration, /iana_pattern constant text/);
  assert.match(migration, /Africa\|America[\s\S]*Europe[\s\S]*Pacific\|US/);
  assert.match(migration, /pg_catalog\.timezone\(raw_value, timestamp/);
  assert.doesNotMatch(migration, /pg_catalog\.pg_timezone_names/);
  assert.doesNotMatch(migration, /\[A-Za-z_\]\+\/\[A-Za-z_\]\+/);
  assert.match(sqlTest, /Xbox Series X\/S and\/or PlayStation/);
  assert.match(sqlTest, /America\/New_York/);
  assert.match(sqlTest, /Europe\/Madrid/);
  assert.match(sqlTest, /for iteration in 1\.\.160 loop/);
});

test("la segunda escritura factual reutiliza la identidad familiar si sus entradas no cambian", () => {
  assert.match(migration, /old\.family_version = 'atinara-market-family-v4'/);
  assert.match(migration, /row\([\s\S]*\) is not distinct from row\(/);
  assert.match(migration, /new\.family_semantics := old\.family_semantics/);
  assert.match(migration, /return new;[\s\S]*metadata_value := private\.market_family_metadata_v4/);
  assert.match(migration, /update of normalized_payload, duplicate_matches, family_key, family_child_key, external_event_id/);
});

test("cada proveedor usa una intención durable, lotes reanudables y una sola finalización", () => {
  assert.match(edge, /RADAR_PERSISTENCE_BATCH_SIZE = 24/);
  assert.match(edge, /begin_market_radar_refresh_v2/);
  assert.match(edge, /stage_market_radar_refresh_batch_v1/);
  assert.match(edge, /seal_market_radar_refresh_v1/);
  assert.match(edge, /process_market_radar_refresh_batch_v3/);
  assert.match(edge, /complete_market_radar_candidate_refresh_v2/);
  assert.doesNotMatch(edge, /"process_market_radar_refresh_batch_v2"|"complete_market_radar_candidate_refresh_v1"|split_market_radar_refresh_batch_v1/);
  assert.match(edge, /finalize_market_radar_refresh_v5/);
  assert.match(resumabilityMigration, /unique \(request_id, provider, capability, batch_ordinal, split_path\)/);
  assert.match(resumabilityMigration, /market_radar_provider_history_refresh_uidx/);
  assert.match(cycleV2Migration, /result_count_input > 240/);
  assert.match(cycleV2Migration, /grant execute on function public\.finalize_market_radar_provider_refresh_v2[\s\S]*to service_role/);
  assert.match(cycleV2Migration, /revoke all on function public\.finalize_market_radar_provider_refresh_v2[\s\S]*from public, anon, authenticated, service_role/);
  assert.match(batchResumeMigration, /candidate_visibility','deferred_until_provider_terminal/);
  assert.match(batchResumeMigration, /RADAR_REFRESH_BATCHES_REMAIN/);
});

test("un fallo de escritura queda aislado al proveedor y no derriba todo el Radar", () => {
  assert.match(edge, /databaseCode === "57014"/);
  assert.match(edge, /RADAR_PERSISTENCE_TIMEOUT/);
  assert.match(edge, /candidateProviderErrors\.push/);
  assert.match(edge, /defer_market_radar_refresh_v1/);
  assert.match(edge, /eligibility_state_preserved:\s*true/);
  assert.match(edge, /legacy_prepared_preserved/);
  assert.match(resumabilityMigration, /on conflict \(refresh_request_id,provider,refresh_batch_id,refresh_item_ordinal\)/);
  assert.match(shared, /RADAR_PERSISTENCE_TIMEOUT:[\s\S]*Los demás proveedores y los lotes ya validados siguen disponibles/);
  assert.match(shared, /RADAR_PERSISTENCE_FAILED:[\s\S]*Los demás proveedores y los lotes ya validados siguen disponibles/);
});

test("la corrección es transaccional, mantiene privilegios mínimos y no toca la economía", () => {
  assert.match(migration, /^--[^]*?\nbegin;/);
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /commit;\s*$/);
  assert.doesNotMatch(
    migration,
    /(?:insert|update|delete)\s+(?:into\s+|from\s+)?public\.(?:markets|predictions|profiles|wallets|transactions|bets)/i,
  );
  assert.match(sqlTest, /^--[^]*?\nbegin;/);
  assert.match(sqlTest, /set local statement_timeout = '8s'/);
  assert.match(sqlTest, /rollback;\s*$/);
  assert.match(resumabilityMigration, /^--[^]*?\nbegin;/);
  assert.match(resumabilityMigration, /force row level security/);
  assert.match(resumabilityMigration, /commit;\s*$/);
  assert.match(resumabilitySqlTest, /^--[^]*?\nbegin;/);
  assert.match(resumabilitySqlTest, /rollback;\s*$/);
});
