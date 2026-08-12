const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { pathToFileURL } = require("node:url");
const { before, test } = require("node:test");

const root = join(__dirname, "..");
const read = (path) => readFileSync(join(root, path), "utf8");
const radarSharedPath = join(root, "supabase/functions/_shared/market-radar.mjs");
const agentRuntimePath = join(root, "supabase/functions/_shared/atinara-agent-runtime.mjs");
const radarEdge = read("supabase/functions/market-radar/index.ts");
const editorEdge = read("supabase/functions/market-expert/index.ts");
const correctorEdge = read("supabase/functions/market-draft-fixer/index.ts");
const admin = read("admin-markets.js");
const migration = read("supabase/migrations/20260811221546_close_agent_engine_confirmation_and_source_authority_v8.sql");

let radar;
let runtime;

before(async () => {
  radar = await import(pathToFileURL(radarSharedPath).href);
  runtime = await import(pathToFileURL(agentRuntimePath).href);
});

test("el protocolo común limita herramientas, pasos y repetición sin publicar", () => {
  const agent = runtime.createAtinaraAgentRun({
    agentType: "radar_source_agent",
    objective: "Comprobar una fuente",
    policyVersion: "policy-test",
    runId: "run-test",
    maxSteps: 3,
  });
  assert.equal(agent.record("read_provider_contract", {
    actionKey: "contract",
    progressFingerprint: "contract:v1",
    summary: {
      count: 1,
      secret: { must_not_leak: true },
      authorization: "Bearer must-not-leak",
      note: "eyJaaaaaaaaaaaa.bbbbbbbbbbbb.cccccccc",
    },
  }).accepted, true);
  assert.throws(() => agent.record("publish_market", {}), /AGENT_TOOL_NOT_ALLOWED/);
  const repeated = agent.record("search_official_sources", {
    actionKey: "search-2",
    progressFingerprint: "contract:v1",
  });
  assert.equal(repeated.accepted, false);
  assert.equal(repeated.stop_reason, "AGENT_NO_PROGRESS");
  const snapshot = agent.complete("blocked");
  assert.equal(snapshot.human_confirmation_required, true);
  assert.equal(snapshot.publishes, false);
  assert.equal(snapshot.resolves, false);
  assert.deepEqual(snapshot.tools[0].summary, { count: 1, note: "[redacted]" });
});

test("una autoridad resolutiva futura registrada no se convierte en resultado terminal", () => {
  const candidate = {
    provider: "kalshi",
    external_id: "kalshi:project-aurora",
    normalizer_version: radar.RADAR_NORMALIZER_VERSION,
    source_question: "Will Project Aurora release this year?",
    family_child_label: "Project Aurora",
    source_resolution_rules: "This market resolves Yes if Project Aurora is released during 2026, otherwise it resolves No.",
    source_resolution_url: "https://store.steampowered.com/app/123/project-aurora/",
    source_resolution_provenance: {
      provider: "kalshi",
      source_url: "https://store.steampowered.com/app/123/project-aurora/",
      upstream_field: "market.settlement_sources",
      adapter_version: radar.RADAR_NORMALIZER_VERSION,
      declared_by_provider: true,
    },
    atinara_category: "Lanzamientos",
  };
  const domains = new Set(["store.steampowered.com"]);
  const page = {
    url: "https://store.steampowered.com/app/123/project-aurora/",
    title: "Project Aurora",
    content: "Project Aurora official product page.",
    contentSha256: createHash("sha256").update("official endpoint").digest("hex"),
    contentType: "text/html",
  };
  const evidence = radar.buildResolutionAuthorityEvidence(
    candidate,
    page,
    "2026-08-12T10:00:00.000Z",
    domains,
  );
  assert.ok(evidence);
  assert.equal(radar.isResolutionAuthorityEvidence(evidence), true);
  assert.equal(radar.isVerifiedTerminalEvidence(evidence), false);
  assert.equal(radar.selectVerifiedResolutionUrl(candidate, [evidence], domains), page.url);
  assert.deepEqual(radar.providerResolutionSourceUrls({
    ...candidate,
    source_resolution_provenance: null,
    provider_payload: { settlement_sources: [page.url] },
  }, domains), []);
});

test("el borrador propio se excluye, pero otro borrador equivalente sigue bloqueando", () => {
  const candidate = {
    id: "candidate-1",
    prepared_draft_id: "draft-own",
    provider: "kalshi",
    external_id: "kalshi:PROJECT-AURORA",
    atinara_question: "¿Se lanzará Project Aurora durante 2026?",
    source_question: "Will Project Aurora release during 2026?",
    family_key: "release:project-aurora",
    family_child_key: "during-2026",
    hard_reject_reasons: [],
    soft_review_reasons: [],
    missing_fields: [],
  };
  const ownDraft = {
    id: "draft-own",
    kind: "draft",
    radar_candidate_id: candidate.id,
    question: candidate.atinara_question,
    family_key: candidate.family_key,
    family_child_key: candidate.family_child_key,
  };
  const otherDraft = { ...ownDraft, id: "draft-other", radar_candidate_id: "candidate-other" };
  assert.deepEqual(radar.classifyMarketRelations(candidate, [ownDraft]).duplicates, []);
  const relations = radar.classifyMarketRelations(candidate, [ownDraft, otherDraft]);
  assert.equal(relations.duplicates.length, 1);
  assert.equal(relations.duplicates[0].id, "draft-other");
  assert.equal(radar.isBlockingDuplicateMatch(relations.duplicates[0]), true);
});

test("confirmación humana y publicación tienen puertas separadas y fail-closed", () => {
  assert.match(migration, /create table if not exists private\.market_draft_eligibility_bindings/);
  assert.match(migration, /draft_version[\s\S]*draft_fingerprint[\s\S]*preparation_revision[\s\S]*eligibility_check_id/);
  assert.match(migration, /create or replace function public\.bind_market_radar_draft_eligibility_v2/);
  assert.match(migration, /auth\.role\(\) <> 'service_role'/);
  assert.match(migration, /raw_app_meta_data ->> 'oraklo_admin'/);
  assert.match(migration, /pg_catalog\.pg_advisory_xact_lock/);
  assert.match(migration, /RADAR_DRAFT_ELIGIBILITY_BINDING_REQUIRED/);
  const confirmBody = migration.match(/create or replace function public\.confirm_market_draft_review[\s\S]*?\$function\$;/)?.[0] || "";
  assert.match(confirmBody, /ensure_market_source_confirmation_ready_v1/);
  assert.doesNotMatch(confirmBody, /ensure_market_source_publication_ready/);
  assert.match(migration, /create or replace function private\.ensure_market_source_publication_ready[\s\S]*assert_market_source_publication_ready/);
  assert.match(migration, /if new\.workflow_status in \('scheduled', 'published'\)/);
  assert.doesNotMatch(migration, /if new\.workflow_status in \('human_confirmed', 'scheduled', 'published'\)/);
});

test("el frontend confirma sin Radar y publica solo después de revalidar y ligar", () => {
  const confirmBody = admin.match(/async function confirmReview\(\)[\s\S]*?\n  async function publishDraft/)?.[0] || "";
  const publishBody = admin.match(/async function publishDraft\(\)[\s\S]*?\n  function radarRequestPayload/)?.[0] || "";
  assert.doesNotMatch(confirmBody, /ensureRadarDraftEligibility/);
  assert.match(confirmBody, /confirm_market_draft_review/);
  assert.match(publishBody, /ensureRadarDraftEligibility/);
  assert.match(publishBody, /publish_market_draft/);
  assert.match(radarEdge, /get_market_radar_candidate_for_draft_revalidation_v2/);
  assert.match(radarEdge, /bind_market_radar_draft_eligibility_v2/);
});

test("Radar, Editor y Corrector comparten el runtime y exponen trazas sanitizadas", () => {
  assert.match(radarEdge, /createAtinaraAgentRun/);
  assert.match(editorEdge, /agentType:\s*"market_editor_agent"/);
  assert.match(correctorEdge, /agentType:\s*"market_corrector_agent"/);
  assert.match(correctorEdge, /dispatchCorrectorTool\(agent, "build_typed_patch"/);
  assert.match(correctorEdge, /dispatchCorrectorTool\(agent, "persist_single_version"/);
  assert.match(correctorEdge, /dispatchCorrectorTool\(agent, "revalidate_draft"/);
  assert.match(admin, /Agente de fuentes/);
  assert.match(admin, /nunca confirma, publica ni resuelve mercados/);
});

test("una caída de búsqueda terminal nunca crea una candidata fresca aparentemente elegible", () => {
  assert.match(radarEdge, /incompleteOfficialResearchGroups = new Set\(research\.incompleteGroupKeys\)/);
  assert.match(radarEdge, /groupResearchComplete = !incompleteOfficialResearchGroups\.has/);
  assert.match(radarEdge, /OFFICIAL_TERMINAL_SCAN_UNAVAILABLE/);
  assert.match(radarEdge, /eligibility_state_preserved:\s*true/);
  assert.match(radarEdge, /source_enrichment_degraded/);
});

test("un escaneo oficial no disponible es espera técnica y nunca un bloqueo terminal", () => {
  const candidate = radar.applyDeterministicRadarEligibility({ state: "prepared" }, {
    eligible: false,
    conclusive: false,
    reason_code: radar.RADAR_REASON_CODES.OFFICIAL_TERMINAL_SCAN_UNAVAILABLE,
    reason: "La comprobación oficial no terminó.",
    ttl_minutes: 5,
    evidence: [],
  }, "2026-08-12T00:00:00.000Z");
  assert.equal(candidate.eligibility_status, "technical_hold");
  assert.equal(candidate.verification_status, "needs_review");
  assert.equal(candidate.quality_status, "needs_review");
});

test("los contratos de producción permanecen generalizados", () => {
  const production = `${radarEdge}\n${editorEdge}\n${correctorEdge}\n${migration}`;
  assert.doesNotMatch(production, /Marvel|Madden|Half[- ]Life|Big Walk|Grand Theft Auto|GTA VI/i);
});
