const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

const originalExpertMigration = read(
  "supabase/migrations/20260807201435_add_save_market_draft_from_radar_intelligence.sql",
);
const revisionGuardMigration = read(
  "supabase/migrations/20260808221745_fix_radar_editor_atomic_preparation.sql",
);
const factGateMigration = read(
  "supabase/migrations/20260809140000_authoritative_radar_fact_gate_v1.sql",
);
const eligibilityMigration = read(
  "supabase/migrations/20260811163339_replace_radar_fact_gate_with_eligibility_v7.sql",
);
const repairMigration = read(
  "supabase/migrations/20260815172317_fix_radar_expert_save_wrapper_v1.sql",
);

function functionBody(source, signature) {
  const start = source.indexOf(signature);
  assert.notEqual(start, -1, `No se encontró ${signature}`);
  const end = source.indexOf("$function$;", start);
  assert.notEqual(end, -1, `No se cerró ${signature}`);
  return source.slice(start, end + "$function$;".length);
}

test("la regresión demuestra el rebinding histórico que reintroducía el guard consumido", () => {
  const originalBody = functionBody(
    originalExpertMigration,
    "create or replace function public.save_market_draft_from_radar_intelligence(",
  );
  const eligibilityBody = functionBody(
    eligibilityMigration,
    "create or replace function public.save_market_draft_from_radar(",
  );

  assert.match(originalBody, /save_result := public\.save_market_draft_from_radar\(/);
  assert.match(
    revisionGuardMigration,
    /rename to save_market_draft_from_radar_intelligence_without_revision_guard/,
  );
  assert.match(
    factGateMigration,
    /rename to save_market_draft_from_radar_without_authoritative_fact_gate_v1/,
  );
  assert.match(
    factGateMigration,
    /rename to save_market_draft_from_radar_intelligence_without_authoritative_fact_gate_v1/,
  );
  assert.match(
    eligibilityBody,
    /draft_input ->> '_radar_preparation_revision'[\s\S]*RADAR_PREPARATION_REVISION_MISMATCH/,
  );
});

test("el helper experto llama al writer estable y conserva contrato, fuentes y binding", () => {
  const body = functionBody(
    repairMigration,
    "create or replace function public.save_market_draft_from_radar_intelligence_without_revision_guard(",
  );

  assert.match(
    body,
    /save_result := public\.save_market_draft_from_radar_without_authoritative_fact_gate_v1\(/,
  );
  assert.doesNotMatch(body, /save_result := public\.save_market_draft_from_radar\(/);
  assert.ok(
    body.indexOf("save_market_draft_from_radar_without_authoritative_fact_gate_v1")
      < body.indexOf("bind_market_draft_intelligence"),
  );
  assert.match(
    body,
    /if coalesce\(\(save_result ->> 'idempotency_replay'\)::boolean, false\) then[\s\S]*active_binding\.resolution_contract is distinct from expected_binding_contract[\s\S]*persisted_sources is distinct from sources_input[\s\S]*RADAR_PREPARATION_REVISION_MISMATCH[\s\S]*else[\s\S]*bind_market_draft_intelligence/,
  );
  for (const guard of [
    "MARKET_EXPERT_ANALYSIS_REQUIRED",
    "MARKET_EXPERT_DECISION_BLOCKED",
    "RESOLUTION_PLAN_VERSION_MISMATCH",
    "RESOLUTION_PLAN_DRAFT_MISMATCH",
    "RESOLUTION_PRIMARY_SOURCE_REQUIRED",
    "RESOLUTION_SOURCE_ASSIGNMENT_INVALID",
  ]) assert.match(body, new RegExp(guard));
  assert.match(body, /'published', false/);
  assert.match(body, /'resolved', false/);
});

test("los wrappers públicos admiten solo el replay preparado que valida el writer inferior", () => {
  const radarBody = functionBody(
    repairMigration,
    "create or replace function public.save_market_draft_from_radar(",
  );
  const expertBody = functionBody(
    repairMigration,
    "create or replace function public.save_market_draft_from_radar_intelligence(",
  );

  for (const body of [radarBody, expertBody]) {
    assert.match(
      body,
      /from private\.external_market_candidates candidate_alias[\s\S]*where candidate_alias\.id = candidate_id_input[\s\S]*for update/,
    );
    assert.match(body, /candidate\.state = 'prepared'/);
    assert.match(body, /candidate\.preparation_revision = submitted_revision \+ 1/);
    assert.match(body, /candidate\.prepared_draft_id is not null/);
    assert.match(body, /draft_id_input is null/);
    assert.match(
      body,
      /if not prepared_replay then[\s\S]*private\.assert_market_radar_candidate_eligible_v1/,
    );
    assert.match(
      body,
      /if saved_draft_id is not null and not prepared_replay then/,
    );
  }
  assert.match(
    radarBody,
    /save_market_draft_from_radar_without_authoritative_fact_gate_v1/,
  );
  assert.match(
    expertBody,
    /save_market_draft_from_radar_intelligence_without_authoritative_fact_gate_v1/,
  );
  assert.match(
    expertBody,
    /prepared_replay[\s\S]*save_result #>> '\{intelligence_binding,changed\}'[\s\S]*RADAR_PREPARATION_REVISION_MISMATCH/,
  );
});

test("la migración es aditiva, falla cerrada y reimpone ownership y ACL mínimos", () => {
  assert.match(repairMigration, /^begin;\s*$/m);
  assert.match(repairMigration, /^commit;\s*$/m);
  assert.match(repairMigration, /set local lock_timeout = '5s'/);
  assert.match(repairMigration, /set local statement_timeout = '120s'/);
  assert.match(repairMigration, /RADAR_EXPERT_SAVE_WRAPPER_PREFLIGHT_FAILED/);
  assert.match(repairMigration, /RADAR_EXPERT_SAVE_WRAPPER_DRIFT/);
  assert.match(repairMigration, /RADAR_EXPERT_SAVE_WRAPPER_POSTFLIGHT_FAILED/);
  assert.match(repairMigration, /owner to postgres/g);
  assert.match(repairMigration, /security definer/g);
  assert.match(repairMigration, /set search_path = ''/g);
  assert.match(
    repairMigration,
    /save_market_draft_from_radar_intelligence_without_revision_guard\([\s\S]*from public, anon, authenticated, service_role/,
  );
  assert.match(
    repairMigration,
    /grant execute on function public\.save_market_draft_from_radar\([\s\S]*to authenticated/,
  );
  assert.match(
    repairMigration,
    /grant execute on function public\.save_market_draft_from_radar_intelligence\([\s\S]*to authenticated/,
  );
  assert.doesNotMatch(repairMigration, /alter table|create table|drop table|truncate table/i);
});
