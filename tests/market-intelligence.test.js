const assert = require("node:assert/strict");
const { readFileSync, readdirSync } = require("node:fs");
const { join } = require("node:path");
const { pathToFileURL } = require("node:url");
const { test, before } = require("node:test");

const root = join(__dirname, "..");
const corePath = join(root, "supabase/functions/_shared/market-intelligence/index.mjs");
const fixturePath = join(root, "tests/fixtures/market-intelligence");
const migration = readFileSync(join(root, "supabase/migrations/20260807163000_add_data_observatory_and_market_intelligence.sql"), "utf8");
const observatoryEdge = readFileSync(join(root, "supabase/functions/data-observatory/index.ts"), "utf8");
const expertEdge = readFileSync(join(root, "supabase/functions/market-expert/index.ts"), "utf8");
const monitorEdge = readFileSync(join(root, "supabase/functions/market-source-monitor/index.ts"), "utf8");
const radarCore = readFileSync(join(root, "supabase/functions/_shared/market-radar.mjs"), "utf8");
const adminUi = readFileSync(join(root, "admin-markets.js"), "utf8");
const resolutionUi = readFileSync(join(root, "admin-resolution.js"), "utf8");
let intelligence;

function fixture(name) {
  return JSON.parse(readFileSync(join(fixturePath, name), "utf8"));
}

before(async () => {
  intelligence = await import(pathToFileURL(corePath).href);
});

test("la Constitución, los esquemas y adaptadores tienen una única versión canónica", () => {
  assert.equal(intelligence.MARKET_INTELLIGENCE_POLICY_VERSION, "atinara-market-constitution-v1");
  assert.equal(intelligence.MARKET_EXPERT_SCHEMA_VERSION, "atinara-market-expert-v1");
  assert.equal(intelligence.SOURCE_CONTRACT_SCHEMA_VERSION, "atinara-resolution-contract-v1");
  assert.equal(intelligence.PROVIDER_ADAPTER_VERSIONS.youtube, "atinara-youtube-data-v1");
  assert.ok(intelligence.MARKET_CONSTITUTION.length >= 10);
});

test("el Observatorio, Radar y monitor conservan almacenamientos y responsabilidades separados", () => {
  assert.match(migration, /private\.data_observatory_signals/);
  assert.match(migration, /private\.market_source_snapshots/);
  assert.doesNotMatch(migration, /alter table private\.external_market_candidates/);
  assert.match(radarCore, /RADAR_NORMALIZER_VERSION = "atinara-radar-v2"/);
  assert.match(radarCore, /RADAR_ELIGIBILITY_POLICY_VERSION = "atinara-prediction-policy-v5"/);
  assert.match(radarCore, /RADAR_FACT_POLICY_VERSION = "atinara-terminal-fact-gate-v2"/);
  assert.match(expertEdge, /RADAR_ELIGIBILITY_POLICY_VERSION = "atinara-prediction-policy-v5"/);
  assert.match(adminUi, /RADAR_POLICY_VERSION = "atinara-prediction-policy-v5"/);
});

test("las tres Edge Functions exigen administración y aíslan los fallos de proveedor", () => {
  for (const source of [observatoryEdge, expertEdge, monitorEdge]) {
    assert.match(source, /authenticateAdmin/);
    assert.match(source, /handleEdgeError/);
    assert.doesNotMatch(source, /access_token\s*:/i);
  }
  assert.match(observatoryEdge, /partial: errors\.length > 0/);
  assert.match(observatoryEdge, /for \(const provider of providers\)[\s\S]+catch/);
});

test("las credenciales solo se leen desde secretos y el token Twitch vive en memoria", () => {
  assert.match(observatoryEdge, /Deno\.env\.get\("TWITCH_CLIENT_ID"\)/);
  assert.match(observatoryEdge, /Deno\.env\.get\("TWITCH_CLIENT_SECRET"\)/);
  assert.match(observatoryEdge, /Deno\.env\.get\("YOUTUBE_API_KEY"\)/);
  assert.match(observatoryEdge, /let twitchTokenCache/);
  assert.doesNotMatch(migration, /TWITCH_CLIENT_SECRET|YOUTUBE_API_KEY|access_token/i);
});

test("un recuento oculto o ausente nunca se convierte en cero", () => {
  const signal = intelligence.normalizeYouTubeChannel({ id: "canal", snippet: { title: "Canal" }, statistics: { hiddenSubscriberCount: true } }, "2026-08-07T12:00:00.000Z");
  assert.equal(signal.metric_value, null);
  assert.equal(signal.metric_is_rounded, false);
  assert.equal(signal.metric_precision, null);
  assert.ok(signal.provider_policy_flags.includes("MISSING_METRIC_NOT_ZERO"));
  assert.ok(intelligence.youtubeProposalPolicy(signal).includes("YOUTUBE_METRIC_UNAVAILABLE"));
});

test("YouTube conserva redondeo y retención conservadora de treinta días", () => {
  const now = "2026-08-07T12:00:00.000Z";
  const signal = intelligence.normalizeYouTubeChannel({ id: "canal", snippet: { title: "Canal" }, statistics: { subscriberCount: "123000", hiddenSubscriberCount: false } }, now);
  assert.equal(signal.metric_is_rounded, true);
  assert.equal(signal.metric_precision, "three_significant_figures_rounded_down");
  assert.equal(new Date(signal.retention_expires_at) - new Date(now), 30 * 86400000);
});

test("YouTube bloquea comparativas, métricas mezcladas y ventanas incompatibles", () => {
  assert.ok(intelligence.youtubeProposalPolicy({ head_to_head: true, metric_value: 1 }).includes("YOUTUBE_HEAD_TO_HEAD_PROHIBITED"));
  assert.ok(intelligence.youtubeProposalPolicy({ mixed_provider_metric: true, metric_value: 1 }).includes("YOUTUBE_PROVIDER_MIX_PROHIBITED"));
  assert.deepEqual(intelligence.generateHypotheses({ provider: "youtube", head_to_head: true }), []);
});

test("Twitch distingue un valor ausente de cero", () => {
  const signal = intelligence.normalizeTwitchStream({ user_id: "u", user_name: "Canal", user_login: "canal", viewer_count: null });
  assert.equal(signal.metric_value, null);
  assert.ok(signal.provider_policy_flags.includes("MISSING_METRIC_NOT_ZERO"));
  const trulyMissing = intelligence.normalizeTwitchStream({ user_id: "u", user_name: "Canal", user_login: "canal" });
  assert.equal(trulyMissing.metric_value, null);
  assert.ok(trulyMissing.provider_policy_flags.includes("MISSING_METRIC_NOT_ZERO"));
});

test("Twitch expone juegos destacados solo como señal de descubrimiento con historial pendiente", () => {
  const signal = intelligence.normalizeTwitchGame({ id: "game-1", name: "Juego público" }, 3, "2026-08-07T12:00:00.000Z");
  assert.equal(signal.signal_type, "top_game");
  assert.equal(signal.metric_name, "top_category_rank");
  assert.equal(signal.metric_value, 3);
  assert.equal(signal.marketability_status, "insufficient_history");
  assert.ok(signal.provider_policy_flags.includes("HISTORY_REQUIRED_FOR_THRESHOLD"));
});

test("el Observatorio implementa top games de Twitch y el recorrido channels, uploads y videos de YouTube", () => {
  assert.match(observatoryEdge, /twitchGet\("games\/top"/);
  assert.match(observatoryEdge, /action === "twitch-top-games"/);
  assert.match(observatoryEdge, /youtubeGet\("channels"/);
  assert.match(observatoryEdge, /relatedPlaylists as JsonRecord\)\?\.uploads/);
  assert.match(observatoryEdge, /youtubeGet\("playlistItems"/);
  assert.match(observatoryEdge, /youtubeGet\("videos"/);
  assert.match(observatoryEdge, /normalizeYouTubeVideo/);
  assert.match(adminUi, /data-observatory-top-games/);
});

test("un directo de YouTube finalizado no reutiliza concurrentViewers como cero", () => {
  const signal = intelligence.normalizeYouTubeVideo({
    id: "video",
    snippet: { title: "Directo concluido" },
    liveStreamingDetails: {
      scheduledStartTime: "2026-08-07T10:00:00.000Z",
      actualStartTime: "2026-08-07T10:02:00.000Z",
      actualEndTime: "2026-08-07T11:00:00.000Z"
    }
  }, "2026-08-07T12:00:00.000Z");
  assert.equal(signal.signal_type, "live_completed");
  assert.equal(signal.metric_value, null);
  assert.ok(signal.provider_policy_flags.includes("SNAPSHOTS_REQUIRED"));
});

test("IGDB se conserva como fuente secundaria y no fabrica una métrica", () => {
  const signal = intelligence.normalizeIgdbGame({
    id: 42,
    name: "Juego de prueba",
    updated_at: 1786096800,
    release_dates: [{ date: 1798761600 }],
    websites: [{ category: 1, trusted: true, url: "https://example.com/game" }]
  }, "2026-08-07T12:00:00.000Z");
  assert.equal(signal.signal_type, "upcoming_release");
  assert.equal(signal.metric_value, null);
  assert.ok(signal.provider_policy_flags.includes("IGDB_SECONDARY_SOURCE"));
});

test("la validez estructural se evalúa aparte de una probabilidad muy baja", () => {
  const assessment = intelligence.evaluateValiditySeparately({ structuralIssues: [], probability: 0.001, resultKnown: false, stale: false });
  assert.equal(assessment.integrity_status, "pass");
  assert.equal(assessment.forecastability_status, "valid_very_unlikely");
});

test("el dictamen rechaza campos de cadena de pensamiento y exige revisión humana", () => {
  const verdict = intelligence.createDeterministicVerdict({
    decision: "create_with_edits",
    integrity_status: "pass",
    forecastability_status: "forecastable",
    source_readiness: "ready_with_warnings",
    confidence: 70,
    human_review_required: true,
    reason_codes: [],
    summary: "Dictamen resumido.",
    evidence: [],
    suggested_changes: [],
    uncertainties: [],
    proposal: {},
    resolution_contract: {}
  });
  assert.equal(intelligence.validateExpertVerdict(verdict).valid, true);
  assert.equal(intelligence.validateExpertVerdict({ ...verdict, chain_of_thought: "secreto" }).valid, false);
});

test("la entrada externa se trata como no confiable y no obtiene fetch o SQL arbitrarios", () => {
  const unsafe = fixture("prompt-injection.json");
  const inspected = intelligence.inspectPromptInjection(`${unsafe.title} ${unsafe.description}`);
  assert.equal(inspected.suspicious, true);
  assert.ok(intelligence.EXPERT_TOOLS.every((tool) => !/sql|fetch_url|http/i.test(tool)));
  assert.throws(() => intelligence.routeExpertTool("fetch_arbitrary_url", {}, {}), /EXPERT_TOOL_NOT_ALLOWED/);
});

test("los roles de fuente impiden que contexto o probabilidad resuelvan", () => {
  assert.equal(intelligence.sourceCanResolve("CONTEXT_SOURCE"), false);
  assert.equal(intelligence.sourceCanResolve("PROBABILITY_SIGNAL"), false);
  assert.equal(intelligence.sourceCanResolve("PRIMARY_RESOLUTION"), true);
  assert.ok(intelligence.defaultSourceRoles("tavily").includes("PROHIBITED_FOR_RESOLUTION"));
});

test("una fuente fallback exige condición y una precedencia única", () => {
  const issues = intelligence.validateSourceAssignments([
    { url: "https://example.com/primary", role: "PRIMARY_RESOLUTION", precedence: 1, required: true },
    { url: "https://example.com/fallback", role: "FALLBACK_RESOLUTION", precedence: 1, required: false }
  ], "snapshot_at_deadline");
  assert.ok(issues.some((issue) => issue.code === "SOURCE_FALLBACK_CONDITION_REQUIRED"));
  assert.ok(issues.some((issue) => issue.code === "SOURCE_PRECEDENCE_INVALID"));
});

test("los contratos versionados son estables y bloquean fuentes incompletas", async () => {
  const contract = {
    contract_schema_version: intelligence.SOURCE_CONTRACT_SCHEMA_VERSION,
    policy_version: intelligence.MARKET_INTELLIGENCE_POLICY_VERSION,
    canonical_statement: "¿Se cumplirá la condición objetiva?",
    opportunity_type: "metric_threshold",
    provider: "youtube",
    metric: "subscriberCount",
    operator: ">=",
    threshold: 1000000,
    precision: "three_significant_figures_rounded_down",
    capture_strategy: "snapshot_at_deadline",
    aggregation: "final",
    window_start: "2026-08-07T12:00:00.000Z",
    window_end: "2026-09-06T12:00:00.000Z",
    timezone: "Europe/Madrid",
    maximum_monitor_duration_seconds: 2592000,
    sources: [{ url: "https://www.youtube.com/channel/example", role: "PRIMARY_RESOLUTION", precedence: 1, required: true }]
  };
  assert.deepEqual(intelligence.validateResolutionContract(contract, new Date("2026-08-07T10:00:00.000Z")), []);
  assert.equal((await intelligence.contractHash(contract)).length, 64);
  assert.equal(await intelligence.contractHash({ ...contract, locked_at: "later" }), await intelligence.contractHash(contract));
  assert.notEqual(await intelligence.contractHash({ ...contract, threshold: 2000000 }), await intelligence.contractHash(contract));
});

test("la retención de YouTube bloquea horizontes incompatibles", () => {
  const issues = intelligence.validateResolutionContract({
    contract_schema_version: intelligence.SOURCE_CONTRACT_SCHEMA_VERSION,
    policy_version: intelligence.MARKET_INTELLIGENCE_POLICY_VERSION,
    canonical_statement: "¿Alcanzará el canal el umbral?",
    opportunity_type: "metric_threshold",
    provider: "youtube",
    metric: "subscriberCount",
    operator: ">=",
    threshold: 1000000,
    precision: "rounded",
    capture_strategy: "poll_during_window",
    aggregation: "maximum",
    sampling_interval_seconds: 30,
    maximum_monitor_duration_seconds: 31 * 86400,
    sources: [{ url: "https://www.youtube.com/channel/test", role: "PRIMARY_RESOLUTION", precedence: 1, required: true }]
  }, new Date("2026-08-07T10:00:00.000Z"));
  assert.ok(issues.some((issue) => issue.code === "MONITOR_INTERVAL_UNSAFE"));
  assert.ok(issues.some((issue) => issue.code === "SOURCE_RETENTION_INCOMPATIBLE"));
});

test("los fixtures de hito y revelación generan hipótesis generalizables", () => {
  for (const name of ["thegrefg-milestone.json", "generic-milestone.json", "gta-vi-reveal.json", "generic-reveal.json"]) {
    const hypotheses = intelligence.generateHypotheses(fixture(name), { now: new Date("2026-08-07T12:00:00.000Z") });
    assert.equal(hypotheses.length, 1, name);
    assert.match(hypotheses[0].proposed_question, /^¿/);
  }
});

test("los nombres de fixtures no aparecen en la lógica de producción", () => {
  const production = readdirSync(join(root, "supabase/functions/_shared/market-intelligence"))
    .filter((name) => name.endsWith(".mjs") || name.endsWith(".ts"))
    .map((name) => readFileSync(join(root, "supabase/functions/_shared/market-intelligence", name), "utf8"))
    .join("\n");
  assert.doesNotMatch(production, /TheGrefg|GTA VI/i);
});

test("un adaptador de contexto futuro autorizado no cambia el núcleo experto", () => {
  const adapter = intelligence.assertContextProviderAdapter({
    provider_id: "igdb",
    search_recent() {},
    normalize_context_item() {},
    resolve_canonical_source() {},
    get_rate_limit_state() {},
    redact_for_storage() {}
  });
  assert.equal(adapter.contract_version, intelligence.CONTEXT_PROVIDER_ADAPTER_VERSION);
  assert.throws(() => intelligence.assertContextProviderAdapter({ provider_id: "crawler-global" }), /CONTEXT_PROVIDER_NOT_ALLOWED/);
});

test("el presupuesto contextual y el cooldown son conservadores", () => {
  const budget = intelligence.contextBudget({ max_entities: 999, max_tavily_queries: 999, max_hypotheses_per_entity: 999 });
  assert.equal(budget.max_entities, intelligence.INTELLIGENCE_LIMITS.maxContextScansPerRun);
  assert.equal(budget.max_tavily_queries, intelligence.INTELLIGENCE_LIMITS.maxTavilyQueriesPerRun);
  assert.equal(budget.max_hypotheses_per_entity, 3);
  assert.equal(intelligence.canRunContextScan({ fingerprint: "same", previous_fingerprint: "same" }).code, "CONTEXT_UNCHANGED");
  assert.equal(intelligence.canRunContextScan({ last_checked_at: "2026-08-07T11:00:00.000Z", now: new Date("2026-08-07T12:00:00.000Z") }).code, "CONTEXT_COOLDOWN");
});

test("el agente puede devolver cero propuestas sin fabricar una pregunta", () => {
  assert.deepEqual(intelligence.generateHypotheses({ provider: "youtube", title: "Dato aislado", metric_value: 1 }), []);
  assert.deepEqual(intelligence.generateHypotheses({ marketability_status: "already_resolved", suggested_question: "No debe aparecer" }), []);
});

test("el scheduler editorial y el monitor nacen desactivados e independientes", () => {
  const config = intelligence.schedulerConfiguration();
  assert.equal(config.contextDiscoveryEnabled, false);
  assert.equal(config.sourceMonitorEnabled, false);
  assert.equal(intelligence.scheduledDiscoveryMayMutate("upsert_private_hypothesis"), true);
  assert.equal(intelligence.scheduledDiscoveryMayMutate("create_draft"), false);
  assert.match(migration, /source_monitor_scheduler_enabled', false/);
  assert.match(migration, /context_discovery_scheduler_enabled', false/);
  assert.match(observatoryEdge, /run-context-discovery-due/);
  assert.match(observatoryEdge, /creates_draft: false, publishes: false, resolves: false/);
  assert.match(monitorEdge, /capture-due/);
});

test("la activación del monitor exige scheduler y proveedor configurados", () => {
  assert.match(migration, /SOURCE_SCHEDULER_NOT_ENABLED/);
  assert.match(migration, /SOURCE_PROVIDER_NOT_CONFIGURED/);
  assert.match(migration, /set_market_intelligence_provider_status/);
});

test("el contexto y los arcos se deduplican antes de crear filas nuevas", () => {
  assert.match(migration, /on conflict \(provider,source_fingerprint\) do update/);
  assert.match(migration, /update private\.data_observatory_story_arcs[\s\S]+if not found then[\s\S]+insert into private\.data_observatory_story_arcs/);
});

test("ready_to_resolve nunca ejecuta una liquidación", () => {
  const evidence = intelligence.evidenceNeverAutoResolves({ status: "ready_to_resolve", recommended_outcome: "Sí" });
  assert.equal(evidence.applies_resolution, false);
  assert.equal(evidence.human_confirmation_required, true);
  assert.doesNotMatch(monitorEdge, /resolve_market_admin|apply_market_resolution|settle_market/);
});

test("la puerta de publicación solo afecta a borradores vinculados a inteligencia", () => {
  assert.match(migration, /if draft_row\.intelligence_origin_type is null and not found then return/);
  assert.match(migration, /SOURCE_BINDING_REQUIRED/);
  assert.match(migration, /RESOLUTION_PLAN_NOT_LOCKED/);
  assert.match(migration, /SOURCE_MONITOR_NOT_ARMED/);
});

test("RLS, revocaciones y RPC administrativas protegen las nuevas tablas", () => {
  assert.match(migration, /enable row level security/);
  assert.match(migration, /force row level security/);
  assert.match(migration, /revoke all on table private\.%I from public, anon, authenticated/);
  assert.match(migration, /private\.require_current_admin\(\)/);
  assert.doesNotMatch(migration, /grant (?:select|insert|update|delete) on private\./i);
});

test("la interfaz usa el orden pactado y no publica desde el Observatorio", () => {
  const labels = ["Crear manualmente", "Radar de mercados", "Datos y tendencias", "Mercados publicados", "Auditoría"];
  let previous = -1;
  for (const label of labels) {
    const next = adminUi.normalize("NFC").indexOf(label);
    assert.ok(next > previous, label);
    previous = next;
  }
  assert.match(adminUi, /No guarda, aprueba, programa ni publica/);
  assert.match(adminUi, /save_market_draft_from_intelligence/);
  assert.match(migration, /create or replace function public\.save_market_draft_from_intelligence/);
  assert.match(migration, /save_result := public\.save_market_draft[\s\S]+binding_result := public\.bind_market_draft_intelligence/);
});

test("la resolución muestra evidencias pero conserva confirmación humana", () => {
  assert.match(resolutionUi, /get_market_source_evidence/);
  assert.match(resolutionUi, /get-evidence-package/);
  assert.match(resolutionUi, /no liquida el mercado y exige confirmación humana/);
  assert.match(resolutionUi, /Confirmar resolución y repartir Karma/);
});

test("el feedback no se convierte en precedente sin una acción administrativa explícita", () => {
  assert.match(expertEdge, /record_market_expert_feedback[\s\S]+promote_input: false/);
  assert.match(expertEdge, /action === "promote-precedent"/);
  assert.match(expertEdge, /promote_market_expert_precedent/);
  assert.match(expertEdge, /promoted_explicitly: true/);
  assert.match(migration, /create or replace function public\.promote_market_expert_precedent/);
  assert.match(migration, /admin_action[\s\S]+values \(run_row\.id, actor_id, 'feedback'[\s\S]+false\)/);
  assert.match(migration, /EXPERT_FEEDBACK_ALREADY_PROMOTED/);
  assert.match(adminUi, /changedExpertFields/);
  assert.match(adminUi, /invokeMarketExpert\("record-feedback"/);
});

test("la búsqueda de YouTube es manual y sus límites se documentan en código", () => {
  assert.match(observatoryEdge, /manual_search_only: true/);
  assert.match(observatoryEdge, /estimated_units: 100/);
  assert.match(observatoryEdge, /no se usa en actualizaciones automáticas/);
});

test("la migración no toca economía, predicciones ni la migración viva aplicada", () => {
  assert.doesNotMatch(migration, /alter table public\.predictions|update public\.predictions|place_prediction|lmsr|karma_balance|prestige/i);
  assert.doesNotMatch(migration, /20260801172543_add_live_prediction_market_model/);
});

test("no existe una versión 18 ficticia ni nombres de secretos con valor", () => {
  const production = [observatoryEdge, expertEdge, monitorEdge, migration, adminUi].join("\n");
  assert.doesNotMatch(production, /radar[-_ ]?v18|atinara-radar-v3/i);
  assert.doesNotMatch(production, /TWITCH_CLIENT_SECRET\s*=\s*["'][^"']+|YOUTUBE_API_KEY\s*=\s*["'][^"']+/i);
});
