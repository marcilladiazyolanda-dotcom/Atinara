const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { test } = require("node:test");
const { pathToFileURL } = require("node:url");
const vm = require("node:vm");

const root = join(__dirname, "..");
const read = (path) => readFileSync(join(root, path), "utf8");
const sharedUrl = pathToFileURL(join(root, "supabase/functions/_shared/market-radar.mjs")).href;
const issuesUrl = pathToFileURL(join(root, "supabase/functions/_shared/market-workflow-issues.mjs")).href;
const edge = read("supabase/functions/market-radar/index.ts");
const migration = read("supabase/migrations/20260820163014_harden_radar_provider_resumability_v1.sql");
const admin = read("admin-markets.js");
const html = read("admin-markets.html");
const styles = read("styles.css");

test("roles versionados separan proveedores de candidatas y enriquecimiento", async () => {
  const radar = await import(`${sharedUrl}?roles=${Date.now()}`);
  assert.equal(radar.RADAR_PROVIDER_ROLE_VERSION, "atinara-radar-provider-roles-v1");
  assert.deepEqual(radar.RADAR_CANDIDATE_PROVIDERS, ["polymarket", "kalshi"]);
  assert.deepEqual(radar.RADAR_ENRICHMENT_CAPABILITIES, ["tavily"]);
  assert.equal(radar.RADAR_PROVIDER_ROLES.tavily.affectsCatalogHealth, false);
  assert.deepEqual(radar.RADAR_PROVIDERS, ["polymarket", "kalshi", "tavily"]);
});

test("null, undefined y cadena vacía continúan siendo ausencia numérica", async () => {
  const radar = await import(`${sharedUrl}?numbers=${Date.now()}`);
  assert.equal(radar.safeNumber(null), null);
  assert.equal(radar.safeNumber(undefined), null);
  assert.equal(radar.safeNumber(""), null);
  assert.equal(radar.safeNumber("   "), null);
  assert.equal(radar.safeNumber("0"), 0);
  assert.equal(radar.safeNumber("12,5"), 12.5);
  for (const value of [false,true,[],[1],{},1n]) assert.equal(radar.safeNumber(value),null);
});

test("fresh y last-known-good se paginan juntos sin superar sesenta padres", async () => {
  const radar = await import(`${sharedUrl}?pagination=${Date.now()}`);
  const groups = Array.from({ length:120 },(_,index)=>({ event_group_key:`g-${index}` }));
  const page = radar.paginateMergedRadarParents(groups,{
    parentOffset:0,parentLimit:60,authoritativeParentCount:120,
  });
  assert.equal(page.groups.length,60);
  assert.equal(page.page.parent_count,120);
  assert.equal(page.page.next_parent_offset,60);
  const second = radar.paginateMergedRadarParents(groups.slice(60),{
    parentOffset:60,parentLimit:60,authoritativeParentCount:120,
  });
  assert.equal(second.groups.length,60);
  assert.equal(second.page.next_parent_offset,null);
});

test("puerta gaming combina evidencia positiva, negativa y placeholders", async () => {
  const radar = await import(`${sharedUrl}?domain=${Date.now()}`);
  assert.equal(radar.evaluateGamingDomain({
    source_title: "Sports Illustrated cover athlete",
    source_question: "Will a footballer appear on the cover?",
    source_category: "Sports",
  }).status, "review_required");
  for (const source_title of [
    "Will Football Manager 2027 include the Premier League?",
    "Will NBA 2K27 feature the official NBA season?",
  ]) assert.equal(radar.evaluateGamingDomain({ source_title }).status,"review_required");
  assert.equal(radar.evaluateGamingDomain({
    source_title: "Madden NFL 27 video game",
    source_question: "Will Ada Player be the cover athlete?",
    source_description: "Official PlayStation and Xbox edition",
    source_tags: ["Video games"],
  }).status, "in_domain");
  assert.equal(radar.evaluateGamingDomain({
    source_title: "Will Alex Player win?",
    source_tags: ["Video games"],
  }).status, "in_domain");
  assert.equal(radar.evaluateGamingDomain({
    family_child_label: "Game A",
    source_title: "The Game Awards 2026",
  }).status, "placeholder");
  assert.equal(radar.evaluateGamingDomain({
    source_title: "GTA VI",
    source_question: "Will GTA VI release before 2027?",
    source_category: "Video Games",
  }).status, "in_domain");
  assert.equal(radar.evaluateGamingDomain({
    source_title: "Sports Illustrated cover athlete",
    source_question: "Will a footballer appear on the cover?",
    source_category: "Video Games",
  }).status, "review_required");
});

test("la huella de dominio ignora precio y cambia con identidad o texto relevante", async () => {
  const radar = await import(`${sharedUrl}?domainFingerprint=${Date.now()}`);
  const base = {
    provider: "kalshi", external_id: "KX-TGA-AURORA", external_event_id: "KX-TGA",
    event_group_key: "kalshi:KX-TGA", source_title: "The Game Awards 2026",
    source_question: "Will Aurora win Best Multiplayer?", source_description: "Official gaming award",
    source_category: "Video Games", source_tags: ["Awards", "Gaming"],
    family_key: "atinara:v4:tga:outcome", family_child_key: "option:aurora",
    family_child_label: "Aurora", source_probability_yes: 42,
  };
  const first = await radar.radarDomainFingerprintV1(base);
  const priceOnly = await radar.radarDomainFingerprintV1({ ...base, source_probability_yes: 73 });
  const changedText = await radar.radarDomainFingerprintV1({ ...base, source_question: "Will Borealis win Best Multiplayer?" });
  const changedProviderEvidence = await radar.radarDomainFingerprintV1({
    ...base, provider_payload: { category: "Traditional sports" },
  });
  const changedContext = await radar.radarDomainFingerprintV1({ ...base, context: "Non gaming awards category" });
  assert.match(first, /^[a-f0-9]{64}$/);
  assert.equal(priceOnly, first);
  assert.notEqual(changedText, first);
  assert.notEqual(changedProviderEvidence, first);
  assert.notEqual(changedContext, first);
});

test("la revalidación solo reutiliza una decisión humana ligada a la huella de dominio actual", async () => {
  const radar = await import(`${sharedUrl}?domainProjection=${Date.now()}`);
  const base = {
    provider: "kalshi",external_id: "KX-ELECTION-GAME",external_event_id: "ELECTION-GAME",
    event_group_key: "kalshi:election-game",source_title: "The Election Game for PC",
    source_question: "Will The Election Game launch on PC?",
    source_description: "Official PC video game release.",source_close_at: "2028-11-01T00:00:00.000Z",
    hard_reject_reasons: [],
  };
  const fingerprint = await radar.radarDomainFingerprintV1(base);
  const review = {
    provider:base.provider,external_id:base.external_id,domain_fingerprint:fingerprint,
    decision:"in_domain",policy_version:"atinara-gaming-domain-v2",
    request_id:"11111111-1111-4111-8111-111111111111",evidence_refs:[],
  };
  const reviewed = radar.projectRadarDomainReview({ ...base,domain_review_fingerprint:fingerprint },review);
  assert.equal(reviewed.domain_status,"in_domain");
  const changed = {
    ...base,source_title:"Presidential election 2028",
    source_question:"Will the president win the election?",
    source_description:"Official election market.",
  };
  const changedFingerprint = await radar.radarDomainFingerprintV1(changed);
  const reclassified = radar.projectRadarDomainReview({
    ...changed,domain_review_fingerprint:changedFingerprint,
  },review);
  assert.notEqual(changedFingerprint,fingerprint);
  assert.equal(reclassified.domain_status,"review_required");
  const decision = radar.evaluateProviderEligibility(reclassified,"2026-08-22T12:00:00.000Z");
  const projected = radar.applyDeterministicRadarEligibility(
    reclassified,decision,"2026-08-22T12:00:00.000Z",
  );
  assert.equal(projected.eligibility_status,"technical_hold");
  assert.equal(projected.eligibility_reason_code,"GAMING_DOMAIN_REVIEW_REQUIRED");
  const legacy = radar.projectRadarDomainReview({ ...changed,domain_review_fingerprint:changedFingerprint },null);
  assert.equal(legacy.domain_status,"review_required");
  const domainGateCall = edge.indexOf("const currentProviderCandidate = providerCandidate");
  const eligibilityProjection = edge.indexOf("let eligibility = applyDeterministicRadarEligibility",domainGateCall);
  const eligibilityWrite = edge.indexOf('apply_market_radar_prepare_eligibility_v4',eligibilityProjection);
  assert.ok(domainGateCall>=0 && domainGateCall<eligibilityProjection && eligibilityProjection<eligibilityWrite);
});

test("contrato de incidencias V6 es completo, estable y no altera Registry V2.1", async () => {
  const issues = await import(`${issuesUrl}?contract=${Date.now()}`);
  const options = {
    createId: () => "11111111-1111-4111-8111-111111111111",
    now: () => "2026-08-20T12:00:00.000Z",
  };
  const input = {
    issueCode: "RADAR_PERSISTENCE_TIMEOUT",
    detectedBy: "radar",
    ownerStage: "internal_platform",
    severity: "warning",
    repairability: "auto_recoverable",
    blockingScope: "none",
    affectedFields: [],
    evidenceRefs: [{ request_id: "22222222-2222-4222-8222-222222222222" }],
    currentValue: { provider: "kalshi", failure_stage: "persistence" },
    proposedValue: null,
    confidence: 100,
    policyVersion: "atinara-radar-provider-resilience-v1",
    retryable: true,
    nextAction: "resume_persistence_intent",
  };
  const first = await issues.createMarketWorkflowIssue(input, options);
  const second = await issues.createMarketWorkflowIssue(input, options);
  assert.equal(first.fingerprint, second.fingerprint);
  assert.equal(first.schema_version, "atinara-market-issue-v1");
  assert.equal(first.blocking_scope, "none");
  assert.equal(issues.validateMarketWorkflowIssue(first), true);
  assert.throws(
    () => issues.validateMarketWorkflowIssue({ extra_field: true, ...first }),
    /MARKET_ISSUE_KEYS_INVALID/,
  );
  assert.doesNotMatch(read("supabase/functions/_shared/atinara-agent-registries-v2.mjs"), /atinara-market-issue-v1/);
  await assert.rejects(
    issues.createMarketWorkflowIssue({ ...input, repairability: "terminal" }, options),
    /MARKET_ISSUE_TERMINAL_SCOPE_INVALID/,
  );
});

test("coordinador Radar colapsa doble clic y reutiliza UUID tras transporte ambiguo", async () => {
  const source = read("radar-refresh-request.js");
  const context = { globalThis: {}, Promise };
  context.globalThis.globalThis = context.globalThis;
  vm.runInNewContext(source, context);
  let calls = 0;
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  const coordinator = context.globalThis.atinaraRadarRefreshRequests.createCoordinator({
    createRequestId: () => "33333333-3333-4333-8333-333333333333",
  });
  const payload = { provider: "all", category: "", query: "", horizon: "180d", quality: "review", order: "recommended", refresh: true };
  const execute = async (request) => { calls += 1; await pending; return { refresh_in_progress: true, request }; };
  const first = coordinator.run(payload, execute);
  const second = coordinator.run(payload, execute);
  assert.equal(first, second);
  release();
  const result = await first;
  assert.equal(calls, 1);
  assert.equal(result.request.refresh_request_id, "33333333-3333-4333-8333-333333333333");
  const retry = await coordinator.run(payload, async (request) => request);
  assert.equal(retry.refresh_request_id, "33333333-3333-4333-8333-333333333333");
});

test("Edge reclama antes de red, persiste por cursor y finaliza una vez", () => {
  const runStart = edge.indexOf("async function runDiscovery(");
  const runEnd = edge.indexOf("function candidatePreflight(", runStart);
  const productionFlow = edge.slice(runStart, runEnd);
  const activeIndex = productionFlow.indexOf('"get_active_market_radar_refresh_v1"');
  const beginIndex = productionFlow.indexOf("await beginRadarRefreshIntent(");
  const discoverIndex = productionFlow.indexOf("await discoverPolymarket(environment");
  assert.ok(runStart >= 0 && runEnd > runStart && activeIndex >= 0
    && beginIndex > activeIndex && discoverIndex > beginIndex);
  assert.match(edge, /stage_market_radar_refresh_batch_v1/);
  assert.match(edge, /complete_market_radar_candidate_refresh_v1/);
  assert.doesNotMatch(edge, /process_market_radar_refresh_batch_v2|split_market_radar_refresh_batch_v1/);
  assert.match(edge, /defer_market_radar_refresh_v1/);
  assert.match(edge, /finalize_market_radar_refresh_v5/);
  assert.match(edge, /partial:\s*candidateProviderErrors\.length > 0/);
  assert.match(edge, /enrichment_issues:\s*enrichmentIssues/);
});

test("SQL conserva v1, impone lease, replay, cuarentena única y finalización única", () => {
  assert.match(migration, /create table private\.market_radar_refresh_intents_v1/);
  assert.match(migration, /market_radar_refresh_active_provider_uidx/);
  assert.match(migration, /market_radar_quarantine_refresh_item_uidx/);
  assert.match(migration, /RADAR_REFRESH_IDEMPOTENCY_CONFLICT/);
  assert.match(migration, /RADAR_REFRESH_BATCH_IDEMPOTENCY_CONFLICT/);
  assert.match(migration, /RADAR_REFRESH_FINALIZATION_CONFLICT/);
  assert.match(migration, /for update skip locked/);
  assert.match(migration, /RADAR_REFRESH_EVENT_APPEND_ONLY/);
  assert.match(migration, /get_active_market_radar_refresh_v1/);
  assert.match(migration, /probe_lease_token_input/);
  assert.match(migration, /TEMPORAL_CONTRACT_INVALID/);
  assert.match(migration, /MARKET_WORKFLOW_ISSUE_INVALID/);
  assert.doesNotMatch(migration, /drop function public\.upsert_market_radar_batch_with_eligibility_v1/);
});

test("UI elimina Tavily de tarjetas rojas y usa un único resumen expandible", () => {
  assert.match(admin, /const providers = \["polymarket", "kalshi"\]/);
  assert.match(admin, /radar-operational-summary/);
  assert.match(admin, /Continuar actualización/);
  assert.doesNotMatch(admin, /class="radar-partial-error"/);
  assert.match(styles, /\.radar-operational-summary/);
  assert.match(html, /radar-refresh-request\.js\?v=20260823-v6-parent-reconciliation2/);
});
