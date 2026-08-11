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
const sqlTest = readFileSync(
  join(root, "supabase/tests/radar_refresh_timeout_transaction.sql"),
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

test("cada proveedor se persiste en lotes pequeños y finaliza con un total exacto", () => {
  assert.match(edge, /RADAR_PERSISTENCE_BATCH_SIZE = 24/);
  assert.match(edge, /for \(let offset = 0; offset < candidates\.length; offset \+= RADAR_PERSISTENCE_BATCH_SIZE\)/);
  assert.match(edge, /candidates\.slice\(offset, offset \+ RADAR_PERSISTENCE_BATCH_SIZE\)/);
  assert.match(edge, /upsert_market_radar_batch_with_fact_checks_v1/);
  assert.match(edge, /finalize_market_radar_provider_refresh_v2/);
  assert.match(edge, /const providerCandidateCount = Math\.max\(persistedCount, successfulProviderCandidateCount\)/);
  assert.match(edge, /"available", providerCandidateCount/);
  assert.match(edge, /persistedCount > 0 \? "partial_error" : "unavailable"/);
  assert.match(cycleV2Migration, /result_count_input > 240/);
  assert.match(cycleV2Migration, /grant execute on function public\.finalize_market_radar_provider_refresh_v2[\s\S]*to service_role/);
  assert.match(cycleV2Migration, /revoke all on function public\.finalize_market_radar_provider_refresh_v2[\s\S]*from public, anon, authenticated, service_role/);
});

test("un fallo de escritura queda aislado al proveedor y no derriba todo el Radar", () => {
  assert.match(edge, /databaseCode === "57014"/);
  assert.match(edge, /RADAR_PERSISTENCE_TIMEOUT/);
  assert.match(edge, /for \(const provider of discoveredByProvider\.keys\(\)\) \{[\s\S]*try \{[\s\S]*errors\.push\(failure\)/);
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
});
