const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { test } = require("node:test");

const root = join(__dirname, "..");
const read = (file) => readFileSync(join(root, file), "utf8");
const migration = read("supabase/migrations/20260825160000_bound_market_radar_catalog_projection_v1.sql");
const checkpointMigration = read("supabase/migrations/20260825193000_checkpoint_market_radar_parent_persistence_v1.sql");
const checkpointV5 = checkpointMigration.match(
  /create or replace function public\.list_market_radar_candidates_v5[\s\S]*?\$function\$;/,
)?.[0] ?? "";
const edge = read("supabase/functions/market-radar/index.ts");
const shared = read("supabase/functions/_shared/market-radar.mjs");
const admin = read("admin-markets.js");
const styles = read("styles.css");
const html = read("admin-markets.html");

test("la proyección ligera ocurre en SQL antes de cruzar PostgREST", () => {
  assert.match(migration, /market_radar_catalog_candidate_payload_v1/);
  assert.match(migration, /list_market_radar_candidates_v5/);
  assert.match(migration, /list_market_radar_rejections_v3/);
  assert.match(migration, /list_market_radar_parent_reconciliations_v3/);
  assert.match(migration, /jsonb_object_agg\(field\.key,field\.value\)/);
  assert.match(migration, /resolution_source_evidence/);
  assert.doesNotMatch(migration, /\b(?:insert\s+into|update|delete\s+from)\b/i);
  assert.match(migration, /revoke all on function private\.market_radar_catalog_candidate_payload_v1[\s\S]+from public,anon,authenticated,service_role/);
});

test("la página acotada se proyecta antes de materializar el expediente completo", () => {
  assert.match(checkpointMigration, /market_radar_catalog_candidate_row_payload_v1/);
  assert.match(checkpointMigration, /select candidate\.id,candidate\.provider,candidate\.external_id/);
  assert.match(checkpointMigration, /market_radar_catalog_candidate_row_payload_v1\([\s\S]*candidate_row,item\.parent_rank/);
  assert.doesNotMatch(checkpointV5, /public\.list_market_radar_candidates_v4\(/);
  assert.match(checkpointMigration, /RADAR_PARENT_CHECKPOINT_SELECTION_INVALID/);
  assert.match(checkpointMigration, /'complete',checkpoint_complete_value/);
  assert.match(checkpointMigration, /reconciled_child_count/);
});

test("la Edge consume únicamente las RPC acotadas y conserva el filtro de frescura", () => {
  assert.match(edge, /list_market_radar_candidates_v5/);
  assert.match(edge, /list_market_radar_rejections_v3/);
  assert.match(edge, /list_market_radar_parent_reconciliations_v3/);
  assert.doesNotMatch(edge, /rpc\(environment, "list_market_radar_candidates_v4"/);
  assert.match(shared, /fetched_at:\s*100/);
  assert.match(shared, /resolved_result_child_count/);
});

test("la auditoría de padres no se presenta como lista de oportunidades", () => {
  assert.match(admin, /Auditoría de integridad/);
  assert.match(admin, /Esta sección también conserva eventos ya resueltos/);
  assert.match(admin, /Oportunidades actuales/);
  assert.match(admin, /resolved_result_child_count/);
  assert.match(admin, /Sin oportunidades activas/);
  assert.match(admin, /Los resultados públicos, opciones inactivas y padres incompletos nunca aparecen aquí/);
});

test("la cuadrícula de eventos evita comprimir una única familia", () => {
  assert.match(styles, /\.radar-candidate-grid\s*\{[\s\S]*?repeat\(auto-fit,\s*minmax\(min\(100%,\s*520px\),\s*1fr\)\)/);
  assert.match(styles, /\.radar-reconciliation-catalog-summary\[data-catalog-status="no-opportunity"\]/);
  assert.match(html, /20260825-radar-provider-checkpoint1/);
});

test("la puerta terminal general cubre contratos factuales y rechaza especulación", async () => {
  const radar = await import("../supabase/functions/_shared/market-radar.mjs");
  const evidence = (supports) => ({
    source_type: "official",
    url: "https://official.example/result",
    retrieval_status: "verified_content",
    evidence_basis: "retrieved_content",
    parser_version: "atinara-official-content-v1",
    claim_verifiable: true,
    content_sha256: "a".repeat(64),
    retrieved_at: "2026-08-25T12:00:00Z",
    title: "Official result",
    supports,
    direct_claim: true,
    claim_status: "direct",
  });
  const cases = [
    ["announcement", "The studio has officially announced Project Orion."],
    ["release", "Project Orion is available now worldwide."],
    ["milestone", "The official trailer was released today."],
    ["award", "Project Orion wins Game of the Year."],
    ["review", "Project Orion Metacritic score 89 published."],
    ["other", "The organization selected Project Orion."],
  ];
  for (const [kind, supports] of cases) {
    assert.equal(radar.evidenceHasPotentialTerminalClaim(
      evidence(supports), kind, "2026-08-25T12:00:00Z",
    ), true, kind);
  }
  assert.equal(radar.evidenceHasPotentialTerminalClaim(
    evidence("Fans predict Project Orion will be the winner."),
    "award",
    "2026-08-25T12:00:00Z",
  ), false);
});
