const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { test } = require("node:test");

const root = join(__dirname, "..");
const adminJs = readFileSync(join(root, "admin-markets.js"), "utf8");
const adminHtml = readFileSync(join(root, "admin-markets.html"), "utf8");
const radarEdge = readFileSync(join(root, "supabase/functions/market-radar/index.ts"), "utf8");
const expertEdge = readFileSync(join(root, "supabase/functions/market-expert/index.ts"), "utf8");
const migration = readFileSync(join(root, "supabase/migrations/20260809190000_harden_expert_market_cycle_v1.sql"), "utf8");

function between(source, start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `No se encontró el contrato ${start}`);
  return source.slice(from, to);
}

test("Agente Editor · analizar es de solo lectura y no prepara ni revalida Radar", () => {
  const flow = between(adminJs, "  async function analyzeRadarCandidate", "  async function runBindingAction");
  assert.match(flow, /refreshRadarExpertAnalysis\(candidateId, \{ force: true \}\)/);
  assert.doesNotMatch(flow, /revalidateRadarCandidate|prepareRadarCandidate|invokeRadar/);
  assert.match(flow, /sin preparar, guardar ni publicar/);
});

test("Agente Editor · un expediente bloqueado sigue siendo legible y solo ofrece Analizar", () => {
  const blocked = between(adminHtml, "      function blockedDossierMarkup", "      function dossierMarkup");
  assert.match(blocked, /Estado tipado/);
  assert.match(blocked, /data-radar-expert/);
  assert.doesNotMatch(blocked, /data-expert-apply/);
  const applyFlow = between(adminHtml, "        if (target) {", "        const analyzeButton");
  const packageIndex = applyFlow.indexOf("await loadPackage(candidateId, true)");
  const gateIndex = applyFlow.indexOf("packageCanApply(currentPackage, candidateId)");
  const prepareIndex = applyFlow.indexOf("await bridge.prepareRadarCandidate(candidateId");
  assert.ok(packageIndex >= 0 && gateIndex > packageIndex && prepareIndex > gateIndex);
});

test("Agente Editor · ausencia real de run se representa como null", () => {
  assert.match(expertEdge, /const run = record\(await rpc\([\s\S]*?return jsonResponse\(\{ ok: true, run \}\)/);
  assert.match(migration, /create or replace function public\.get_market_expert_analysis[\s\S]*?return \([\s\S]*?limit 1[\s\S]*?\);/i);
  assert.doesNotMatch(migration, /get_market_expert_analysis[\s\S]{0,1800}coalesce\([\s\S]*?'\{\}'::jsonb/i);
});

test("Radar · un fallo de datos se aísla hasta una fila y conserva las sanas", () => {
  const isolation = between(radarEdge, "async function persistBatchWithDataIsolation", "function quarantinedProviderFailure");
  assert.match(isolation, /entries\.slice\(0, middle\)/);
  assert.match(isolation, /entries\.slice\(middle\)/);
  assert.match(isolation, /outcome\.persistedCount \+= entries\.length/);
  assert.match(isolation, /outcome\.quarantined\.push/);
  assert.match(radarEdge, /RADAR_CANDIDATES_QUARANTINED/);
});

test("Radar · un prepare fallido se audita sin sustituir el puntero vigente", () => {
  assert.match(radarEdge, /record_market_radar_prepare_attempt_v1/);
  assert.match(migration, /authoritative_pointer_unchanged', true/);
  assert.match(migration, /'authoritative_fact_check_id', candidate\.current_fact_check_id/);
  const attemptRpc = between(
    migration,
    "create or replace function public.record_market_radar_prepare_attempt_v1",
    "create or replace function private.market_draft_deterministic_issues",
  );
  assert.doesNotMatch(attemptRpc, /update private\.external_market_candidates/i);
});

test("Corrector · solo consume revisión v3 exacta y exige deadline posterior", () => {
  const contextRpc = between(
    migration,
    "create or replace function public.get_market_draft_expert_repair_context",
    "create or replace function public.record_market_radar_prepare_attempt_v1",
  );
  assert.match(contextRpc, /atinara-market-gate-v3/);
  assert.match(contextRpc, /atinara-market-review-policy-v3/);
  assert.match(contextRpc, /atinara-market-draft-schema-v3/);
  assert.match(contextRpc, /review_refresh_required/);
  assert.match(migration, /resolution_deadline <= draft\.evaluation_ends_at/);
});

test("Observabilidad · cada final de proveedor deja historial append-only y Gemini conserva el recuento", () => {
  assert.match(migration, /create table if not exists private\.market_radar_provider_run_history/);
  assert.match(migration, /RADAR_PROVIDER_HISTORY_APPEND_ONLY/);
  assert.match(radarEdge, /finalizeProviderRefresh\([\s\S]*?"gemini"[\s\S]*?processedDecisions/);
  assert.doesNotMatch(radarEdge, /record_market_radar_provider_failure/);
});
