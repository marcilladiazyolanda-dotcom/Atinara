const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { pathToFileURL } = require("node:url");
const { runInNewContext } = require("node:vm");
const { before, test } = require("node:test");

const root = join(__dirname, "..");
const corePath = join(root, "supabase/functions/_shared/market-radar.mjs");
const adminPage = readFileSync(join(root, "admin-markets.html"), "utf8");
const adminBridge = readFileSync(join(root, "admin-agent-engine.js"), "utf8");
const adminHtml = `${adminPage}\n${adminBridge}`;
const adminMarkets = readFileSync(join(root, "admin-markets.js"), "utf8");
const marketExpert = readFileSync(join(root, "supabase/functions/market-expert/index.ts"), "utf8");
const policyMigration = readFileSync(join(root, "supabase/migrations/20260811163339_replace_radar_fact_gate_with_eligibility_v7.sql"), "utf8");
let radar;

const now = "2026-08-08T12:00:00.000Z";

before(async () => {
  radar = await import(pathToFileURL(corePath).href);
});

function completeCandidate(question, overrides = {}) {
  const candidate = {
    id: "candidate-row",
    provider: "kalshi",
    external_id: "kalshi:KX-REGRESSION",
    source_title: question,
    source_question: question,
    atinara_question: question,
    atinara_category: "Lanzamientos",
    atinara_resolution_criteria: "Se resolverá Sí cuando la fuente oficial publique el resultado dentro del periodo.",
    atinara_resolution_source_url: "https://www.playstation.com/en-us/",
    source_close_at: "2027-01-01T00:00:00.000Z",
    hard_reject_reasons: [],
    eligibility_policy_version: "atinara-prediction-policy-v5",
    ...overrides,
  };
  if (candidate.atinara_resolution_source_url
    && !Object.prototype.hasOwnProperty.call(overrides, "resolution_source_evidence")) {
    const evidence = [{
      title: question,
      url: candidate.atinara_resolution_source_url,
      source_type: "official",
      supports: `${question} Official resolution source.`,
      retrieved_at: now,
      retrieval_status: "verified_content",
      evidence_basis: "retrieved_content",
      parser_version: "atinara-official-content-v1",
      content_sha256: "a".repeat(64),
      claim_status: "direct",
      direct_claim: true,
      claim_verifiable: true,
    }];
    candidate.resolution_source_evidence = evidence;
    candidate.eligibility_evidence = evidence;
  }
  return candidate;
}

function kalshiEvent(title, children) {
  return {
    event_ticker: `KX-${title.replace(/[^a-z0-9]/gi, "").slice(0, 18).toUpperCase()}`,
    series_ticker: "KX-REGRESSION",
    title,
    category: "Entertainment",
    tags: ["Video games"],
    external_event_url: "https://kalshi.com/markets/kx-regression/atinara-regression",
    canonical_url_verified: true,
    markets: children.map((yesSubTitle, index) => ({
      ticker: `KX-REGRESSION-${index + 1}`,
      title,
      yes_sub_title: yesSubTitle,
      no_sub_title: `Not ${yesSubTitle}`,
      status: "active",
      market_type: "binary",
      close_time: "2027-01-01T00:00:00Z",
      yes_bid_dollars: "0.40",
      yes_ask_dollars: "0.44",
      rules_primary: "Resolves from the official public result for this option.",
      settlement_sources: [{ url: "https://thegameawards.com/" }],
      external_event_url: "https://kalshi.com/markets/kx-regression/atinara-regression",
      external_market_url: "https://kalshi.com/markets/kx-regression/atinara-regression",
      canonical_url_verified: true,
    })),
  };
}

function extractBridgeFunction(name, nextName) {
  const starts = [
    adminBridge.indexOf(`  function ${name}(`),
    adminBridge.indexOf(`  async function ${name}(`),
  ].filter((index) => index >= 0);
  const ends = [
    adminBridge.indexOf(`  function ${nextName}(`),
    adminBridge.indexOf(`  async function ${nextName}(`),
  ].filter((index) => index >= 0);
  assert.ok(starts.length, `No se encontró la función frontend ${name}`);
  assert.ok(ends.length, `No se encontró el límite frontend ${nextName}`);
  const start = Math.min(...starts);
  const end = Math.min(...ends.filter((index) => index > start));
  assert.ok(Number.isFinite(end), `No se pudo aislar la función frontend ${name}`);
  return adminBridge.slice(start, end).trim();
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

test("la identidad estable excluye la propia fila y conserva un duplicado exacto real", () => {
  const candidate = completeCandidate("Will Half-Life 3 release before 2027?");
  const family = radar.deriveMarketFamily(candidate);
  const selfById = {
    ...family,
    id: candidate.id,
    provider: "polymarket",
    external_id: "polymarket:another-id",
    question: candidate.atinara_question,
  };
  const selfByProviderIdentity = {
    ...family,
    id: "old-row-copy",
    provider: candidate.provider,
    external_id: candidate.external_id,
    question: candidate.atinara_question,
  };
  const exactDuplicate = {
    ...family,
    id: "other-definition",
    provider: candidate.provider,
    external_id: "kalshi:OTHER-CONTRACT",
    question: candidate.atinara_question,
  };

  const onlySelf = radar.classifyMarketRelations(candidate, [selfById, selfByProviderIdentity]);
  assert.deepEqual(onlySelf.duplicates, []);
  assert.deepEqual(onlySelf.siblings, []);

  const relations = radar.classifyMarketRelations(candidate, [selfById, selfByProviderIdentity, exactDuplicate]);
  assert.equal(relations.duplicates.length, 1);
  assert.equal(relations.duplicates[0].id, exactDuplicate.id);
  assert.equal(relations.duplicates[0].relationship, "exact_duplicate");
  assert.equal(radar.isBlockingDuplicateMatch(relations.duplicates[0]), true);

  const scoredSelf = radar.scoreCandidates([candidate], [selfById, selfByProviderIdentity], now)[0];
  assert.deepEqual(scoredSelf.duplicate_matches, []);
  assert.equal(scoredSelf.score_breakdown.novelty, 20);
  assert.ok(!scoredSelf.hard_reject_reasons.includes("DUPLICATE_MARKET"));
});

test("dos fechas hijas del mismo evento son hermanas no bloqueantes", () => {
  const september = completeCandidate("Will Grand Theft Auto VI release before September 1, 2026?", {
    id: "date-september",
    external_id: "kalshi:GTA6-SEP",
  });
  const october = completeCandidate("Will Grand Theft Auto VI release before October 1, 2026?", {
    id: "date-october",
    external_id: "kalshi:GTA6-OCT",
  });
  const septemberFamily = radar.deriveMarketFamily(september);
  const octoberFamily = radar.deriveMarketFamily(october);
  assert.equal(septemberFamily.family_key, octoberFamily.family_key);
  assert.notEqual(septemberFamily.family_child_key, octoberFamily.family_child_key);

  const relations = radar.classifyMarketRelations(october, [{
    ...september,
    ...septemberFamily,
    question: september.atinara_question,
  }]);
  assert.deepEqual(relations.duplicates, []);
  assert.equal(relations.siblings.length, 1);
  assert.equal(relations.siblings[0].relationship, "sibling");
  assert.equal(relations.siblings[0].blocking, false);
  assert.equal(radar.isBlockingDuplicateMatch(relations.siblings[0]), false);

  const scored = radar.scoreCandidates([october], [{
    ...september,
    ...septemberFamily,
    question: september.atinara_question,
  }], now)[0];
  assert.equal(scored.family_relationship, "sibling");
  assert.deepEqual(scored.duplicate_matches, []);
  assert.ok(!scored.hard_reject_reasons.includes("DUPLICATE_MARKET"));
});

test("Kalshi identifica los hijos de umbral por yes_sub_title aunque compartan title", () => {
  const candidates = radar.adaptKalshiResponse({
    events: [kalshiEvent("Metacritic score for Grand Theft Auto VI", ["Above 90", "Above 95"])],
  }, { now });
  assert.equal(candidates.length, 2);
  assert.equal(candidates[0].source_question, candidates[1].source_question);

  const families = candidates.map((candidate) => radar.deriveMarketFamily(candidate));
  assert.deepEqual(families.map((family) => family.family_type), ["milestone_thresholds", "milestone_thresholds"]);
  assert.equal(families[0].family_key, families[1].family_key);
  assert.deepEqual(
    new Set(families.map((family) => family.family_child_key)),
    new Set(["threshold:gt:90:points", "threshold:gt:95:points"]),
  );

  const scored = radar.scoreCandidates(candidates, [], now);
  assert.ok(scored.every((candidate) => !candidate.hard_reject_reasons.includes("DUPLICATE_MARKET")));
  assert.ok(scored.some((candidate) => candidate.family_relationship === "sibling"));
});

test("Kalshi identifica opciones categóricas por yes_sub_title y no por el padre repetido", () => {
  const candidates = radar.adaptKalshiResponse({
    events: [kalshiEvent("Which game will win Game of the Year 2026?", ["Cairn", "Grand Theft Auto VI"])],
  }, { now });
  const families = candidates.map((candidate) => radar.deriveMarketFamily(candidate));
  assert.equal(families[0].family_key, families[1].family_key);
  assert.deepEqual(
    new Set(families.map((family) => family.family_child_key)),
    new Set(["option:cairn", "option:grand-theft-auto-vi"]),
  );
  const relations = radar.classifyMarketRelations(candidates[1], [{
    ...candidates[0],
    ...families[0],
    id: "existing-option",
    question: candidates[0].source_question,
  }]);
  assert.deepEqual(relations.duplicates, []);
  assert.equal(relations.siblings[0].relationship, "sibling");
  assert.equal(relations.siblings[0].blocking, false);
});

test("VERIFICATION_REQUIRED solo admite override directo con fuente, ventana y proveedor seguros", () => {
  const direct = completeCandidate("Will Valve announce Half-Life 3 before 2027?");
  const decision = { reason_code: "VERIFICATION_REQUIRED" };
  assert.equal(radar.canApplyPredictivePolicyOverride(direct, decision, now), true);
  assert.equal(radar.canApplyPredictivePolicyOverride({ ...direct, atinara_resolution_source_url: null }, decision, now), false);
  assert.equal(radar.canApplyPredictivePolicyOverride({ ...direct, source_close_at: now }, decision, now), false);
  assert.equal(radar.canApplyPredictivePolicyOverride({ ...direct, source_result: "yes" }, decision, now), false);
  assert.equal(radar.canApplyPredictivePolicyOverride({
    ...direct,
    hard_reject_reasons: ["INVALID_OR_UNVERIFIED_SOURCE"],
  }, decision, now), false);
  assert.equal(radar.canApplyPredictivePolicyOverride(
    completeCandidate("Will Half-Life 3 score above 90 on Metacritic?"),
    decision,
    now,
  ), false);
  assert.equal(radar.canApplyPredictivePolicyOverride(
    completeCandidate("Will Half-Life 3 win Game of the Year 2026?"),
    decision,
    now,
  ), false);
});

test("un estado abierto nunca se reutiliza; un rechazo terminal idéntico sí caduca de forma exclusiva", () => {
  const candidate = {
    fingerprint: "fingerprint-1",
    fact_context_fingerprint: "fact-fingerprint-1",
    eligibility_policy_version: "atinara-prediction-policy-v5",
  };
  const verified = {
    normalizer_version: "atinara-radar-v3",
    eligibility_policy_version: "atinara-prediction-policy-v5",
    fingerprint: "fingerprint-1",
    verification_status: "verified_open",
    verification_reason_code: null,
    verification_expires_at: "2026-08-08T12:00:00.001Z",
    fact_policy_version: "atinara-terminal-fact-gate-v2",
    fact_context_fingerprint: "fact-fingerprint-1",
    atinara_question: "Will Valve announce Half-Life 3 before 2027?",
    atinara_category: "Lanzamientos",
    atinara_resolution_criteria: "Sí si Valve lo anuncia oficialmente.",
    atinara_resolution_source_url: "https://www.valvesoftware.com/",
  };
  assert.equal(radar.canReuseRadarVerification(verified, candidate, now), false);
  assert.equal(radar.canReuseRadarVerification({ ...verified, verification_expires_at: now }, candidate, now), false);
  const terminal = {
    ...verified,
    verification_status: "rejected_resolved",
    verification_reason_code: "EVENT_ALREADY_RESOLVED",
  };
  assert.equal(radar.canReuseRadarVerification(terminal, candidate, now), true);
  assert.equal(radar.canReuseRadarVerification({ ...terminal, verification_expires_at: now }, candidate, now), false);
});

test("la política de elegibilidad v5 coincide en Radar, interfaz, Editor y reservas SQL", () => {
  const policy = "atinara-prediction-policy-v5";
  assert.equal(radar.RADAR_ELIGIBILITY_POLICY_VERSION, policy);
  assert.match(adminMarkets, new RegExp(`RADAR_POLICY_VERSION = "${policy}"`));
  assert.match(marketExpert, new RegExp(`RADAR_ELIGIBILITY_POLICY_VERSION = "${policy}"`));
  assert.equal((policyMigration.match(new RegExp(policy, "g")) || []).length >= 3, true);
  assert.doesNotMatch(policyMigration, /atinara-prediction-policy-v4/);
  assert.match(policyMigration, /private\.market_radar_eligibility_checks/);
  assert.match(policyMigration, /status = 'eligible'/);
  assert.match(policyMigration, /preparation_revision/);
  assert.match(policyMigration, /RADAR_FACTUAL_VERIFICATION_REQUIRED/);
});

test("loadPackage comparte inflight y una respuesta vieja no sobrescribe una revisión nueva", async () => {
  const calls = [];
  const invokeExpert = (action, payload) => {
    const request = deferred();
    calls.push({ action, payload, ...request });
    return request.promise;
  };
  const bridge = runInNewContext(`(() => {
    const packageCache = new Map();
    const pendingPackages = new Map();
    const packageRequestVersions = new Map();
    const isRecord = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
    const typedCode = (value, fallback = "MARKET_EXPERT_DOSSIER_UNAVAILABLE") => {
      const code = String(value || "").trim().slice(0, 100);
      return /^[A-Z][A-Z0-9_]{2,99}$/.test(code) ? code : fallback;
    };
    const reasonLabels = {};
    ${extractBridgeFunction("invalidatePackage", "loadPackage")}
    ${extractBridgeFunction("loadPackage", "preparationRevisionFrom")}
    return { packageCache, pendingPackages, invalidatePackage, loadPackage };
  })()`, { invokeExpert });

  const first = bridge.loadPackage("candidate-1");
  const shared = bridge.loadPackage("candidate-1");
  assert.equal(calls.length, 1);
  calls[0].resolve({ package: { run: { id: "run-1" } } });
  const [firstValue, sharedValue] = await Promise.all([first, shared]);
  assert.equal(firstValue.run.id, "run-1");
  assert.equal(sharedValue.run.id, "run-1");
  assert.equal(bridge.pendingPackages.size, 0);

  const oldRequest = bridge.loadPackage("candidate-1", true);
  bridge.invalidatePackage("candidate-1");
  const freshRequest = bridge.loadPackage("candidate-1", true);
  assert.equal(calls.length, 3);
  calls[2].resolve({ package: { run: { id: "run-fresh" } } });
  await freshRequest;
  calls[1].resolve({ package: { run: { id: "run-stale" } } });
  await oldRequest;
  assert.equal(bridge.packageCache.get("candidate-1").run.id, "run-fresh");

  const cached = await bridge.loadPackage("candidate-1");
  assert.equal(cached.run.id, "run-fresh");
  assert.equal(calls.length, 3);
});

test("la sesión guarda candidato, revisión y paquete como una unidad y descarta estado ajeno", () => {
  const storage = new Map();
  const sessionStorage = {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: (key) => storage.delete(key),
  };
  const bridge = runInNewContext(`(() => {
    const appliedPackages = new Map();
    const STORAGE_KEY = "atinara:test-package";
    ${extractBridgeFunction("preparationRevisionFrom", "clearPreparedPackage")}
    ${extractBridgeFunction("clearPreparedPackage", "rememberPreparedPackage")}
    ${extractBridgeFunction("rememberPreparedPackage", "readPreparedPackage")}
    ${extractBridgeFunction("readPreparedPackage", "renderBridgeStatus")}
    return { preparationRevisionFrom, clearPreparedPackage, rememberPreparedPackage, readPreparedPackage };
  })()`, { sessionStorage });

  assert.equal(bridge.preparationRevisionFrom({ run: { result_json: { origin_preparation_revision: 7 } } }), "7");
  bridge.rememberPreparedPackage("candidate-7", "7", { run: { id: "run-7" } });
  const remembered = bridge.readPreparedPackage("candidate-7");
  assert.equal(remembered.candidate_id, "candidate-7");
  assert.equal(remembered.preparation_revision, "7");
  assert.equal(remembered.package.run.id, "run-7");
  assert.equal(bridge.readPreparedPackage("candidate-8"), null);

  bridge.clearPreparedPackage("candidate-7");
  assert.equal(bridge.readPreparedPackage("candidate-7"), null);
  storage.set("atinara:test-package", "{invalid-json");
  assert.equal(bridge.readPreparedPackage("candidate-7"), null);
});

test("Aplicar exige un expediente apto antes de preparar y vuelve a ligarlo después", () => {
  const applyStart = adminBridge.indexOf("    if (target) {");
  const applyEnd = adminBridge.indexOf("    const analyzeButton", applyStart);
  assert.ok(applyStart >= 0 && applyEnd > applyStart, "No se encontró el manejador Aplicar");
  const applyFlow = adminBridge.slice(applyStart, applyEnd);
  const prepareIndex = applyFlow.indexOf("await bridge.prepareRadarCandidate(candidateId");
  const reanalyzeIndex = applyFlow.indexOf("await bridge.refreshRadarExpertAnalysis(candidateId");
  const preflightPackageIndex = applyFlow.indexOf("await loadPackage(candidateId, true)");
  const packageIndex = applyFlow.indexOf("await loadPackage(candidateId, true)", reanalyzeIndex);
  assert.ok(preflightPackageIndex >= 0 && preflightPackageIndex < prepareIndex, "Aplicar debe validar el expediente antes de reservar en Radar");
  assert.ok(prepareIndex >= 0, "Aplicar debe reservar en Radar después del gate experto");
  assert.ok(reanalyzeIndex > prepareIndex, "El análisis debe ejecutarse después de la revisión autoritativa");
  assert.ok(packageIndex > reanalyzeIndex, "El paquete debe cargarse después del nuevo análisis");
  assert.ok(applyFlow.indexOf("clearPreparedPackage(candidateId)") < prepareIndex);
  assert.ok(applyFlow.includes("applyingCandidates.has(candidateId)"));
  assert.ok(applyFlow.includes("preparationRevisionFrom"));
  assert.ok(applyFlow.includes("packageMatchesPreparation(pkg, preparationRevision)"));
  assert.ok(applyFlow.includes("rememberPreparedPackage"));
  assert.ok(!adminHtml.includes("window.setTimeout(() => scheduleScan(true), 2_800)"));

  const submitStart = adminBridge.indexOf('  document.addEventListener("submit"');
  const submitEnd = adminBridge.indexOf("  const observer", submitStart);
  const submitFlow = adminBridge.slice(submitStart, submitEnd);
  assert.ok(submitFlow.includes("readPreparedPackage(candidateId)"));
  assert.ok(adminHtml.includes("payload._radar_preparation_revision"));
  const dossierStart = adminBridge.indexOf("  function dossierMarkup(");
  const dossierEnd = adminBridge.indexOf("  async function enhanceDetail(", dossierStart);
  const dossierSource = adminBridge.slice(dossierStart, dossierEnd);
  assert.match(dossierSource, /if \(!pkg\?\.available\)[\s\S]+blockedDossierMarkup/);
  const blockedStart = adminBridge.indexOf("  function blockedDossierMarkup(");
  const blockedEnd = adminBridge.indexOf("  function dossierMarkup(", blockedStart);
  const blockedSource = adminBridge.slice(blockedStart, blockedEnd);
  assert.ok(blockedSource.includes("data-radar-expert"));
  assert.ok(!blockedSource.includes("data-expert-apply"));
});

test("el paquete experto lleva revisión y fingerprints y falla cerrado si el origen cambió", () => {
  const packageStart = marketExpert.indexOf("function packageFromRun(");
  const packageEnd = marketExpert.indexOf("async function getDraftPackage(", packageStart);
  const getPackageEnd = marketExpert.indexOf("async function discoverOfficialContext(", packageEnd);
  assert.ok(packageStart >= 0 && packageEnd > packageStart && getPackageEnd > packageEnd);
  const packageSource = marketExpert.slice(packageStart, packageEnd);
  const getPackageSource = marketExpert.slice(packageEnd, getPackageEnd);

  for (const field of [
    "preparation_revision",
    "origin_fingerprint",
    "analysis_fingerprint",
    "policy_version",
    "schema_version",
  ]) {
    assert.ok(packageSource.includes(field), `El paquete no expone ${field}`);
  }
  assert.ok(marketExpert.includes("origin_preparation_revision"));
  assert.ok(getPackageSource.includes("MARKET_EXPERT_ANALYSIS_STALE"));
  assert.ok(getPackageSource.includes("available: false"));
  assert.ok(getPackageSource.includes("can_prefill: false"));
  assert.ok(getPackageSource.includes("can_save_private_draft: false"));
  assert.match(getPackageSource, /run\.analysis_fingerprint\s*===\s*currentAnalysisFingerprint/);
  assert.match(getPackageSource, /origin_preparation_revision/);
});

test("la huella experta ignora solo el lease del Radar y conserva los hechos materiales", () => {
  const snapshotStart = marketExpert.indexOf("function analysisOriginSnapshot(");
  const snapshotEnd = marketExpert.indexOf("function getOfficialResolutionUrl(", snapshotStart);
  assert.ok(snapshotStart >= 0 && snapshotEnd > snapshotStart);
  const snapshotSource = marketExpert.slice(snapshotStart, snapshotEnd);
  for (const field of ["fetched_at", "expires_at", "cache_expires_at"]) {
    assert.ok(snapshotSource.includes(`\"${field}\"`), `La huella conserva el lease volátil ${field}`);
  }
  for (const field of ["verified_at", "verification_expires_at", "fingerprint", "preparation_revision"]) {
    assert.ok(!snapshotSource.includes(`\"${field}\"`), `La huella elimina indebidamente el hecho material ${field}`);
  }
  assert.ok(
    marketExpert.split("analysisOriginSnapshot(").length - 1 >= 5,
    "Todos los hashes de origen y análisis deben usar el snapshot semántico",
  );
});

test("solo la puerta determinista puede introducir o conservar bloqueos duros", () => {
  const mergeStart = marketExpert.indexOf("function mergeExpertVerdict(");
  const mergeEnd = marketExpert.indexOf("function buildDraftGate(", mergeStart);
  const reconcileStart = marketExpert.indexOf("function reconcileSavedVerdict(");
  const reconcileEnd = marketExpert.indexOf("function safeToolSummary(", reconcileStart);
  const mergeSource = marketExpert.slice(mergeStart, mergeEnd);
  const reconcileSource = marketExpert.slice(reconcileStart, reconcileEnd);

  assert.match(mergeSource, /expert\.reason_codes[\s\S]+!HARD_REASON_CODES\.has/);
  assert.match(reconcileSource, /deterministicReasonCodes\.filter\(\(code\) => HARD_REASON_CODES\.has\(code\)\)/);
  assert.doesNotMatch(reconcileSource, /HARD_REASON_CODES\.has\(code\) \|\| activeIssueCodes\.has/);
});
