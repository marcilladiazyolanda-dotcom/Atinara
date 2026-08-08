const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { pathToFileURL } = require("node:url");
const { test, before } = require("node:test");

const root = join(__dirname, "..");
const corePath = join(root, "supabase/functions/_shared/market-radar.mjs");
const edge = readFileSync(join(root, "supabase/functions/market-radar/index.ts"), "utf8");
const baseMigration = readFileSync(join(root, "supabase/migrations/20260804194933_add_market_radar.sql"), "utf8");
const v2Migration = readFileSync(join(root, "supabase/migrations/20260806183627_harden_market_radar_quality_sources.sql"), "utf8");
const adminUi = readFileSync(join(root, "admin-markets.js"), "utf8");
const adminHtml = readFileSync(join(root, "admin-markets.html"), "utf8");
const styles = readFileSync(join(root, "styles.css"), "utf8");
let radar;

before(async () => {
  radar = await import(pathToFileURL(corePath).href);
});

const now = "2026-08-06T12:00:00.000Z";

function polyMarket(id, slug, question, overrides = {}) {
  return {
    id,
    slug,
    question,
    description: "Resuelve según la fuente oficial pública.",
    resolutionSource: "https://www.ea.com/games/ea-sports-fc/fc-27/news",
    outcomes: '["Yes","No"]',
    outcomePrices: '["0.379","0.621"]',
    endDate: "2026-09-25T00:00:00Z",
    active: true,
    closed: false,
    volumeNum: "127.5",
    liquidityNum: "8.7",
    ...overrides,
  };
}

function polyEvent(overrides = {}) {
  return {
    id: "499343",
    slug: "ea-sports-fc27-cover-athlete",
    title: "EA Sports FC27: Cover Athlete",
    active: true,
    closed: false,
    canonical_url_verified: true,
    markets: [
      polyMarket("m-khvicha", "will-khvicha-be-on-the-cover-of-ea-sports-fc-27", "Will Khvicha Kvaratskhelia be on the cover of EA Sports FC 27?"),
      polyMarket("m-neuer", "will-manuel-neuer-be-on-the-cover-of-ea-sports-fc-27", "Will Manuel Neuer be on the cover of EA Sports FC 27?", { outcomePrices: '["0.38","0.62"]' }),
      polyMarket("m-bruno", "will-bruno-fernandes-be-on-the-cover-of-ea-sports-fc-27", "Will Bruno Fernandes be on the cover of EA Sports FC 27?", { outcomePrices: '["0.355","0.645"]' }),
      polyMarket("m-diaz", "will-luis-diaz-be-on-the-cover-of-ea-sports-fc-27", "Will Luis Diaz be on the cover of EA Sports FC 27?", { outcomePrices: '["0.365","0.635"]' }),
    ],
    ...overrides,
  };
}

function kalshiEvent(overrides = {}) {
  return {
    event_ticker: "KXPS6-26",
    series_ticker: "KXPS6",
    title: "PS6 announcement",
    category: "Entertainment",
    tags: ["Video games"],
    external_event_url: "https://kalshi.com/markets/kxps6/ps6-announcement/kxps6-26",
    canonical_url_verified: true,
    markets: [{
      ticker: "KXPS6-26-DEC31",
      event_ticker: "KXPS6-26",
      series_ticker: "KXPS6",
      title: "Will PlayStation 6 be announced before 2027?",
      status: "active",
      market_type: "binary",
      close_time: "2027-01-01T00:00:00Z",
      yes_bid_dollars: "0.41",
      yes_ask_dollars: "0.45",
      last_price_dollars: "0.43",
      volume_fp: "5000.75",
      liquidity_dollars: "1200.00",
      rules_primary: "Resolves Yes if Sony officially announces PlayStation 6 before the deadline.",
      settlement_sources: [{ url: "https://www.playstation.com/en-us/" }],
      external_event_url: "https://kalshi.com/markets/kxps6/ps6-announcement/kxps6-26",
      external_market_url: "https://kalshi.com/markets/kxps6/ps6-announcement/kxps6-26",
      canonical_url_verified: true,
    }],
    ...overrides,
  };
}

function completeCandidate(question, overrides = {}) {
  return {
    source_question: question,
    atinara_question: question,
    atinara_category: "Lanzamientos",
    atinara_resolution_criteria: "Se resolverá Sí si una fuente oficial confirma el resultado dentro del periodo.",
    atinara_resolution_source_url: "https://www.example.com/official-source",
    source_close_at: "2026-12-31T23:59:59Z",
    hard_reject_reasons: [],
    eligibility_policy_version: "atinara-prediction-policy-v3",
    ...overrides,
  };
}

test("el normalizador usa la versión v2", () => {
  assert.equal(radar.RADAR_NORMALIZER_VERSION, "atinara-radar-v2");
  assert.equal(radar.RADAR_ELIGIBILITY_POLICY_VERSION, "atinara-prediction-policy-v3");
});

test("Polymarket conserva evento padre y mercado hijo sin fabricar una URL con el slug hijo", () => {
  const candidates = radar.adaptPolymarketResponse({ events: [polyEvent()] }, { now, canonicalUrlVerified: true });
  assert.equal(candidates.length, 4);
  assert.equal(candidates[0].external_event_slug, "ea-sports-fc27-cover-athlete");
  assert.equal(candidates[0].external_market_slug, "will-khvicha-be-on-the-cover-of-ea-sports-fc-27");
  assert.equal(candidates[0].external_event_url, "https://polymarket.com/event/ea-sports-fc27-cover-athlete");
  assert.equal(candidates[0].external_market_url, candidates[0].external_event_url);
  assert.doesNotMatch(candidates[0].external_event_url, /\/es\//);
});

test("Polymarket conserva identidad y probabilidad de cada mercado hijo", () => {
  const candidates = radar.adaptPolymarketResponse({ events: [polyEvent()] }, { now, canonicalUrlVerified: true });
  assert.equal(candidates[0].external_event_id, "499343");
  assert.equal(candidates[0].external_market_id, "m-khvicha");
  assert.equal(candidates[0].source_probability_yes, 37.9);
  assert.equal(candidates[0].event_group_key, "polymarket:499343");
});

test("Polymarket hereda la fuente de resolución del evento padre", () => {
  const event = polyEvent({ resolutionSource: "https://www.ea.com/es-es/games/ea-sports-fc/fc-27/news" });
  event.markets = [polyMarket("m-parent-source", "child-source", "Will the official source confirm it?", { resolutionSource: null })];
  const candidate = radar.adaptPolymarketResponse({ events: [event] }, { now, canonicalUrlVerified: true })[0];
  assert.equal(candidate.source_resolution_url, event.resolutionSource);
});

test("Polymarket bloquea evento archivado, órdenes desactivadas y cierre vencido", () => {
  const archived = radar.adaptPolymarketResponse({ events: [polyEvent({ archived: true })] }, { now, canonicalUrlVerified: true })[0];
  const noOrders = radar.adaptPolymarketResponse({ events: [polyEvent({ acceptingOrders: false })] }, { now, canonicalUrlVerified: true })[0];
  const expired = radar.adaptPolymarketResponse({ events: [polyEvent({ markets: [polyMarket("m-expired", "expired", "Will this stay open?", { endDate: "2026-08-05T12:00:00Z" })] })] }, { now, canonicalUrlVerified: true })[0];
  for (const candidate of [archived, noOrders, expired]) {
    assert.ok(candidate.hard_reject_reasons.includes("PROVIDER_NOT_OPEN"));
  }
});

test("Polymarket bloquea una URL canónica no validada", () => {
  const candidate = radar.adaptPolymarketResponse({ events: [{ ...polyEvent(), canonical_url_verified: false }] }, { now })[0];
  assert.ok(candidate.hard_reject_reasons.includes("INVALID_OR_UNVERIFIED_SOURCE"));
  assert.equal(candidate.external_event_url, null);
});

test("Kalshi acepta el estado active y conserva los campos relevantes", () => {
  const candidate = radar.adaptKalshiResponse({ events: [kalshiEvent()] }, { now })[0];
  assert.equal(candidate.source_status, "active");
  assert.equal(candidate.source_probability_yes, 43);
  assert.equal(candidate.source_volume_total, 5000.75);
  assert.equal(candidate.external_event_id, "KXPS6-26");
  assert.equal(candidate.external_market_id, "KXPS6-26-DEC31");
  assert.equal(candidate.event_group_key, "kalshi:KXPS6-26");
  assert.deepEqual(candidate.hard_reject_reasons, []);
});

test("Kalshi bloquea estados cerrados y tipos no binarios", () => {
  const closed = kalshiEvent();
  closed.markets[0].status = "finalized";
  const multi = kalshiEvent({ event_ticker: "KXMULTI" });
  multi.markets[0] = { ...multi.markets[0], ticker: "KXMULTI-A", market_type: "scalar" };
  const candidates = radar.adaptKalshiResponse({ events: [closed, multi] }, { now });
  assert.ok(candidates[0].hard_reject_reasons.includes("PROVIDER_NOT_OPEN"));
  assert.ok(candidates[1].hard_reject_reasons.includes("EVENT_OUTSIDE_CONTRACT"));
});

test("Polymarket conserva un resultado explícito del mercado hijo sin inferirlo del evento padre", () => {
  const event = polyEvent({ result: "yes" });
  event.markets = [
    polyMarket("m-resolved", "resolved", "Will the official source confirm it?", { result: "no", resolved: true }),
    polyMarket("m-open", "open", "Will another outcome happen?"),
  ];
  const candidates = radar.adaptPolymarketResponse({ events: [event] }, { now, canonicalUrlVerified: true });
  assert.equal(candidates[0].source_result, "no");
  assert.ok(candidates[0].hard_reject_reasons.includes("EVENT_ALREADY_RESOLVED"));
  assert.equal(candidates[1].source_result, null);
  assert.ok(!candidates[1].hard_reject_reasons.includes("EVENT_ALREADY_RESOLVED"));
});

test("Kalshi conserva un resultado final Sí como evento ya resuelto", () => {
  const event = kalshiEvent();
  event.markets[0] = {
    ...event.markets[0],
    status: "finalized",
    result: "yes",
    settled_time: "2026-08-01T12:00:00Z",
  };
  const candidate = radar.adaptKalshiResponse({ events: [event] }, { now })[0];
  const decision = radar.evaluateProviderEligibility(candidate, now);
  assert.equal(candidate.source_result, "yes");
  assert.ok(candidate.hard_reject_reasons.includes("EVENT_ALREADY_RESOLVED"));
  assert.equal(decision.reason_code, "EVENT_ALREADY_RESOLVED");
  assert.match(decision.reason, /«Sí»/);
});

test("Kalshi bloquea un mercado cuyo cierre ya ha vencido aunque siga active", () => {
  const event = kalshiEvent();
  event.markets[0].close_time = "2026-08-05T12:00:00Z";
  const candidate = radar.adaptKalshiResponse({ events: [event] }, { now })[0];
  assert.ok(candidate.hard_reject_reasons.includes("PROVIDER_NOT_OPEN"));
});

test("una tarjeta agrupa un evento padre y muestra solo las tres opciones prioritarias", () => {
  const candidates = radar.scoreCandidates(radar.adaptPolymarketResponse({ events: [polyEvent()] }, { now, canonicalUrlVerified: true }), [], now);
  const groups = radar.groupCandidates(candidates);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].child_count, 4);
  assert.equal(groups[0].top_candidates.length, 3);
});

test("la puntuación no puede convertir un rechazo factual en candidato apto", () => {
  const candidate = radar.adaptPolymarketResponse({ events: [polyEvent()] }, { now, canonicalUrlVerified: true })[0];
  const rejected = radar.applyEligibilityDecision(candidate, { eligible: false, conclusive: true, reason_code: "EVENT_ALREADY_RESOLVED", confidence: 100 }, now);
  const scored = radar.scoreCandidates([rejected], [], now)[0];
  assert.equal(scored.verification_status, "rejected_resolved");
  assert.equal(scored.quality_status, "rejected");
  assert.equal(scored.state, "rejected");
});

test("una verificación inconclusa permanece en needs_review y nunca se convierte en rechazo duro", () => {
  const candidate = radar.adaptPolymarketResponse({ events: [polyEvent()] }, { now, canonicalUrlVerified: true })[0];
  const reviewed = radar.applyEligibilityDecision(candidate, {
    eligible: false,
    conclusive: false,
    reason_code: "VERIFICATION_REQUIRED",
    confidence: 0,
    ttl_minutes: 1,
  }, now);
  assert.equal(reviewed.verification_status, "needs_review");
  assert.equal(reviewed.quality_status, "needs_review");
  assert.equal(reviewed.state, "needs_review");
  assert.equal(reviewed.verification_reason_code, "VERIFICATION_REQUIRED");
  assert.ok(!reviewed.hard_reject_reasons.includes("VERIFICATION_REQUIRED"));
  assert.equal(reviewed.verification_expires_at, "2026-08-06T12:05:00.000Z");
});

test("el motivo factual específico prevalece sobre un cierre genérico del proveedor", () => {
  const candidate = radar.adaptPolymarketResponse({
    events: [polyEvent({ closed: true })],
  }, { now, canonicalUrlVerified: true })[0];
  const rejected = radar.applyEligibilityDecision(candidate, {
    eligible: false,
    conclusive: true,
    reason_code: "EVENT_ALREADY_RESOLVED",
    confidence: 100,
  }, now);
  assert.ok(rejected.hard_reject_reasons.includes("PROVIDER_NOT_OPEN"));
  assert.equal(rejected.verification_status, "rejected_resolved");
  assert.equal(rejected.verification_reason_code, "EVENT_ALREADY_RESOLVED");
});

test("los lotes de Gemini son pequeños, monoproveedor y conservan las candidatas aplazadas", () => {
  const polymarket = Array.from({ length: 19 }, (_, index) => ({
    provider: "polymarket",
    external_id: `poly-${index}`,
    event_group_key: `polymarket:event-${Math.floor(index / 5)}`,
    quality_score: 100 - index,
  }));
  const kalshi = Array.from({ length: 9 }, (_, index) => ({
    provider: "kalshi",
    external_id: `kalshi-${index}`,
    event_group_key: `kalshi:event-${Math.floor(index / 3)}`,
    quality_score: 80 - index,
  }));
  const plan = radar.buildGeminiCandidateBatches([...polymarket, ...kalshi], {
    maxGroups: 20,
    maxCandidates: 24,
    batchSize: 7,
  });
  assert.equal(plan.batches.flat().length, 24);
  assert.equal(plan.deferred.length, 4);
  assert.ok(plan.batches.every((batch) => batch.length <= 7));
  assert.ok(plan.batches.every((batch) => new Set(batch.map((candidate) => candidate.provider)).size === 1));
});

test("fixture EA FC 27 ya revelado se rechaza como resuelto", () => {
  const candidate = radar.adaptPolymarketResponse({ events: [polyEvent()] }, { now, canonicalUrlVerified: true })[0];
  const decision = radar.evaluateDeterministicEligibility(candidate, { official_reveal_at: "2026-07-23T12:00:00Z" }, now);
  assert.equal(decision.reason_code, "EVENT_ALREADY_RESOLVED");
});

test("fixture Fable GOTY 2026 se rechaza si el lanzamiento es posterior al periodo", () => {
  const candidate = { source_question: "Will Fable win Game of the Year at the 2026 Game Awards?", source_close_at: "2026-12-11T00:00:00Z" };
  const decision = radar.evaluateDeterministicEligibility(candidate, { release_at: "2027-02-15T00:00:00Z", subject_announced: true }, now);
  assert.equal(decision.reason_code, "EVENT_OUTSIDE_CONTRACT");
});

test("Half-Life 3 puede predecir lanzamiento o anuncio, pero no un GOTY dependiente sin anuncio", () => {
  const release = radar.evaluateDeterministicEligibility({ source_question: "Will Half-Life 3 release in 2026?", source_close_at: "2026-12-31T00:00:00Z" }, { subject_announced: false }, now);
  const announcement = radar.evaluateDeterministicEligibility({ source_question: "Will Valve announce Half-Life 3 in 2026?", source_close_at: "2026-12-31T00:00:00Z" }, { subject_announced: false }, now);
  const award = radar.evaluateDeterministicEligibility({ source_question: "Will Half-Life 3 win Game of the Year at The Game Awards 2026?", source_close_at: "2026-12-31T00:00:00Z" }, { subject_announced: false }, now);
  assert.equal(release, null);
  assert.equal(announcement, null);
  assert.equal(award.reason_code, "SUBJECT_NOT_ANNOUNCED");
});

test("la incoherencia temporal tiene un código estable", () => {
  const decision = radar.evaluateDeterministicEligibility({ source_question: "Will this happen?" }, { temporal_coherence: false }, now);
  assert.equal(decision.reason_code, "TEMPORAL_INCOHERENCE");
});

test("la fecha oficial de GTA VI informa la probabilidad, pero no invalida un umbral anterior", () => {
  const candidate = completeCandidate("Will Grand Theft Auto VI release before September 1, 2026?", {
    atinara_question: "¿Se lanzará Grand Theft Auto VI antes del 1 de septiembre de 2026?",
    atinara_resolution_source_url: "https://www.rockstargames.com/VI",
  });
  const facts = {
    subject_announced: true,
    release_at: "2026-11-19T00:00:00Z",
    temporal_coherence: false,
  };
  assert.equal(radar.evaluateDeterministicEligibility(candidate, facts, now), null);
  assert.equal(radar.evaluatePredictiveEligibility(candidate, facts, now).eligible, true);
  assert.equal(radar.canApplyPredictivePolicyOverride(candidate, { reason_code: "TEMPORAL_INCOHERENCE" }), true);
  assert.equal(radar.canApplyPredictivePolicyOverride(candidate, { reason_code: "EVENT_OUTSIDE_CONTRACT" }), true);
});

test("la política predictiva nunca pisa un resultado resuelto ni una fuente inválida", () => {
  const candidate = completeCandidate("Will Grand Theft Auto VI release before September 1, 2026?");
  assert.equal(radar.canApplyPredictivePolicyOverride(candidate, { reason_code: "EVENT_ALREADY_RESOLVED" }), false);
  assert.equal(radar.canApplyPredictivePolicyOverride(candidate, { reason_code: "INVALID_OR_UNVERIFIED_SOURCE" }), false);
  assert.equal(radar.canApplyPredictivePolicyOverride(candidate, { reason_code: "VERIFICATION_REQUIRED" }), false);
});

test("un lanzamiento futuro no anunciado sigue siendo una predicción válida y resoluble", () => {
  const candidate = completeCandidate("Will Half-Life 3 release in 2026?", {
    atinara_resolution_source_url: "https://www.valvesoftware.com/",
  });
  const decision = radar.evaluatePredictiveEligibility(candidate, { subject_announced: false }, now);
  assert.equal(decision.eligible, true);
  assert.equal(decision.conclusive, true);
});

test("Onimusha anunciado puede ser candidato a GOTY antes de publicarse las nominaciones", () => {
  const candidate = completeCandidate("Will Onimusha: Way of the Sword win Game of the Year at The Game Awards 2026?", {
    atinara_category: "Reviews/Premios",
    atinara_resolution_source_url: "https://thegameawards.com/nominees/game-of-the-year",
  });
  const facts = { subject_announced: true };
  assert.equal(radar.evaluateDeterministicEligibility(candidate, facts, now), null);
  assert.equal(radar.evaluatePredictiveEligibility(candidate, facts, now).eligible, true);
});

test("el pre-rellenado no usa la URL del mercado como fuente de resolución", () => {
  const candidate = radar.adaptPolymarketResponse({ events: [polyEvent()] }, { now, canonicalUrlVerified: true })[0];
  const prefill = radar.buildDraftPrefill({ ...candidate, id: "candidate-id", atinara_resolution_criteria: "Sí si EA lo confirma oficialmente." });
  assert.equal(prefill.fields.primary_source_url, "https://www.ea.com/games/ea-sports-fc/fc-27/news");
  assert.equal(prefill.fields.alternative_sources, "");
  assert.notEqual(prefill.fields.primary_source_url, candidate.external_event_url);
  assert.equal(prefill.auto_saved, false);
  assert.equal(prefill.published, false);
});

test("las URLs privadas, locales y protocolos inseguros se rechazan", () => {
  assert.equal(radar.safePublicUrl("javascript:alert(1)"), null);
  assert.equal(radar.safePublicUrl("https://127.0.0.1/private"), null);
  assert.equal(radar.safePublicUrl("https://localhost/private"), null);
  assert.equal(radar.safeProbability(105), null);
  assert.deepEqual([...radar.RADAR_API_HOSTS].sort(), [
    "api.elections.kalshi.com",
    "api.tavily.com",
    "external-api.kalshi.com",
    "gamma-api.polymarket.com",
    "generativelanguage.googleapis.com",
  ]);
});

test("Gemini interpreta texto JSON dividido e ignora razonamiento", () => {
  const result = radar.parseGeminiAdaptations({ candidates: [{ content: { parts: [{ thought: true, text: "privado" }, { text: '{"candidates":[{"external_id":"m-' }, { text: '1"}]}' }] } }] });
  assert.deepEqual(result, [{ external_id: "m-1" }]);
});

test("Gemini se vincula por índices enteros controlados sin aceptar duplicados ni IDs alterados", () => {
  const decisions = radar.indexGeminiDecisions([
    { candidate_index: 1, external_id: "alterado", eligible: true },
    { candidate_index: 1, eligible: false },
    { candidate_index: "0", eligible: true },
    { candidate_index: 3, eligible: true },
    { candidate_index: 0, eligible: false },
  ], 3);
  assert.deepEqual([...decisions.keys()], [1, 0]);
  assert.equal(decisions.get(1).eligible, true);
  assert.equal(decisions.get(0).eligible, false);
});

test("una actualización explícita nunca reutiliza verificaciones inconclusas o caducadas", () => {
  const candidate = { fingerprint: "fp-1", eligibility_policy_version: "atinara-prediction-policy-v3" };
  const verified = {
    normalizer_version: "atinara-radar-v2",
    eligibility_policy_version: "atinara-prediction-policy-v3",
    fingerprint: "fp-1",
    verification_status: "verified_open",
    verification_reason_code: null,
    verification_expires_at: "2026-08-06T13:00:00.000Z",
    atinara_question: "¿Se anunciará GTA VI?",
    atinara_category: "Lanzamientos",
    atinara_resolution_criteria: "Sí si Rockstar lo anuncia oficialmente.",
    atinara_resolution_source_url: "https://www.rockstargames.com/VI",
  };
  assert.equal(radar.canReuseRadarVerification(verified, candidate, now), true);
  assert.equal(radar.canReuseRadarVerification({ ...verified, verification_status: "needs_review" }, candidate, now), false);
  assert.equal(radar.canReuseRadarVerification({ ...verified, verification_reason_code: "VERIFICATION_REQUIRED" }, candidate, now), false);
  assert.equal(radar.canReuseRadarVerification({ ...verified, verification_expires_at: "2026-08-06T11:59:59.000Z" }, candidate, now), false);
  assert.equal(radar.canReuseRadarVerification({ ...verified, fingerprint: "fp-2" }, candidate, now), false);
  assert.equal(radar.canReuseRadarVerification({ ...verified, atinara_resolution_source_url: null }, candidate, now), false);
  assert.equal(radar.canReuseRadarVerification({ ...verified, eligibility_policy_version: "atinara-prediction-policy-v2" }, candidate, now), false);
});

test("la fuente de resolución se toma solo de datos existentes o evidencia oficial", () => {
  const evidence = [
    { url: "https://example.com/inventada", source_type: "public" },
    { url: "https://www.ea.com/games/ea-sports-fc/fc-27/news/official", source_type: "official" },
  ];
  const accepted = radar.selectVerifiedResolutionUrl({}, evidence);
  const untrusted = radar.selectVerifiedResolutionUrl({}, evidence.slice(0, 1));
  const existing = radar.selectVerifiedResolutionUrl(
    { source_resolution_url: "https://thegameawards.com/nominees/game-of-the-year" },
    evidence,
  );
  assert.equal(accepted, evidence[1].url);
  assert.equal(untrusted, null);
  assert.equal(existing, "https://thegameawards.com/nominees/game-of-the-year");
});

test("una resolución concluyente se propaga al evento padre solo con consenso suficiente", () => {
  const candidates = [
    { event_group_key: "polymarket:ea-fc27", hard_reject_reasons: [], verification_status: "rejected_resolved" },
    { event_group_key: "polymarket:ea-fc27", hard_reject_reasons: [], verification_status: "rejected_resolved" },
    { event_group_key: "kalshi:gta6", hard_reject_reasons: [], verification_status: "verified_open" },
  ];
  const signal = (candidateIdentity) => ({
    event_group_key: "polymarket:ea-fc27",
    candidate_identity: candidateIdentity,
    resolved_at: "2026-07-17T00:00:00.000Z",
    confidence: 95,
    evidence: [{ url: "https://www.ea.com/games/ea-sports-fc/fc-27/news/official" }],
  });
  const result = radar.propagateResolvedEventGroups(candidates, [signal("polymarket:1"), signal("polymarket:2")], now);
  assert.deepEqual(result.slice(0, 2).map((candidate) => candidate.verification_status), ["rejected_resolved", "rejected_resolved"]);
  assert.equal(result[2].verification_status, "verified_open");
});

test("una señal aislada de una opción hija no resuelve toda la familia", () => {
  const candidates = Array.from({ length: 4 }, (_, index) => ({
    external_id: String(index),
    event_group_key: "kalshi:release-dates",
    hard_reject_reasons: [],
    verification_status: index === 0 ? "rejected_resolved" : "verified_open",
  }));
  const result = radar.propagateResolvedEventGroups(candidates, [{
    event_group_key: "kalshi:release-dates",
    candidate_identity: "kalshi:0",
    resolved_at: "2026-08-01T00:00:00.000Z",
    confidence: 95,
    evidence: [{ url: "https://www.xbox.com/example" }],
  }], now);
  assert.deepEqual(result.map((candidate) => candidate.verification_status), ["rejected_resolved", "verified_open", "verified_open", "verified_open"]);
});

test("una fuente oficial puede cerrar de forma determinista una familia de atleta de portada", () => {
  const candidates = ["Kylian Mbappe", "Erling Haaland", "Ousmane Dembele"].map((name) => ({
    source_question: `Will ${name} be on the cover of EA Sports FC 27?`,
  }));
  const resolution = radar.detectOfficialCoverEventResolution(candidates, [{
    source_type: "official",
    url: "https://www.ea.com/games/ea-sports-fc/ea-play",
    title: "EA Sports FC EA Play - EA Official Site",
    supports: "Cover art for EA SPORTS FC 27, showing Kylian Mbappe standing against a vibrant cityscape.",
  }]);
  assert.equal(resolution.winner_name, "Kylian Mbappe");
  assert.equal(resolution.evidence.length, 1);
  assert.equal(radar.detectOfficialCoverEventResolution(candidates, [{
    source_type: "public",
    url: "https://example.com/rumor",
    supports: "EA Sports FC 27 cover art showing Kylian Mbappe.",
  }]), null);
  assert.equal(radar.detectOfficialCoverEventResolution(candidates, [{
    source_type: "official",
    url: "https://www.ea.com/games/college-football-27",
    supports: "College Football 27 cover art showing Kylian Mbappe.",
  }]), null);
});

test("el consenso oficial de una familia de portada incluye opciones reutilizadas", () => {
  const officialEvidence = [{ source_type: "official", url: "https://www.ea.com/games/madden-nfl/madden-nfl-27/news/welcome-to-madden-27" }];
  const candidates = Array.from({ length: 4 }, (_, index) => ({
    provider: "polymarket",
    external_id: String(index),
    event_group_key: "polymarket:madden-27-cover",
    source_title: "Madden NFL 27: Cover Athlete",
    source_question: `Will Player ${index} be on the cover of Madden NFL 27?`,
    hard_reject_reasons: index === 3 ? ["PROVIDER_NOT_OPEN"] : [],
    verification_status: index === 3 ? "rejected_ineligible" : "rejected_resolved",
    verification_reason: "La portada oficial ya fue revelada.",
    verification_confidence: 100,
    verification_evidence: index === 3 ? [] : officialEvidence,
  }));
  const signals = radar.buildCoverResolutionSignals(candidates, now);
  assert.equal(signals.length, 4);
  const resolved = radar.propagateResolvedEventGroups(candidates, signals, now);
  assert.deepEqual(resolved.map((candidate) => candidate.verification_status), Array(4).fill("rejected_resolved"));
  assert.equal(radar.buildCoverResolutionSignals(candidates.map((candidate) => ({ ...candidate, source_title: "Release dates" })), now).length, 0);
});

test("la Edge descubre taxonomía y eventos Kalshi sin límite arbitrario de cuatro series", () => {
  assert.match(edge, /search\/tags_by_categories/);
  assert.match(edge, /MAX_KALSHI_SERIES = 25/);
  assert.match(edge, /with_nested_markets/);
  assert.match(edge, /min_close_ts/);
  assert.match(edge, /limit", "200"/);
  assert.match(edge, /KALSHI_CONCURRENCY = 4/);
  assert.doesNotMatch(edge, /MAX_KALSHI_SERIES = 4/);
});

test("la Edge valida evento y pertenencia del hijo en Polymarket", () => {
  assert.match(edge, /events\/slug\//);
  assert.match(edge, /canonicalMarkets\.filter/);
  assert.match(edge, /canonical_url_verified: true/);
  assert.doesNotMatch(edge, /polymarket\.com\/es\//);
});

test("Tavily se consulta una vez por evento padre y Gemini recibe evidencia estructurada", () => {
  assert.match(edge, /groupCandidates\(candidates\)/);
  assert.match(edge, /evidenceByGroup/);
  assert.match(edge, /include_domains/);
  assert.match(edge, /event_resolved_at: \{ type:/);
  assert.match(edge, /responseJsonSchema: geminiResponseJsonSchema/);
  assert.match(edge, /failClosedCandidates/);
  assert.match(edge, /mapWithConcurrency\(groups, TAVILY_CONCURRENCY/);
  assert.match(edge, /valvesoftware\.com/);
  assert.match(edge, /childQuestions/);
  assert.match(edge, /cleanText\(`official announcement release date result eligibility \$\{group\.title\} \$\{childQuestions\}`, 1_200\)/);
  assert.doesNotMatch(edge, /for \(const candidate of candidates\)[\s\S]*api\.tavily\.com/);
});

test("los descartes deterministas no consumen Tavily ni Gemini y Kalshi reconcilia resultados", () => {
  assert.match(edge, /evaluateProviderEligibility\(candidate, now\)/);
  assert.match(edge, /const deterministicRejections/);
  assert.match(edge, /MAX_REJECTED_OUTCOME_RECONCILIATIONS = 16/);
  assert.match(edge, /historical\/markets/);
  assert.match(edge, /reconcileRejectedKalshiOutcomes/);
  assert.match(edge, /reconciled_provider_results/);
});

test("la verificación vigente se reutiliza por huella y evita repetir servicios automáticos", () => {
  assert.match(edge, /const cachedVerification = new Map/);
  assert.match(edge, /candidateIdentity\(item\)/);
  assert.match(edge, /canReuseRadarVerification\(cached, candidate, now\)/);
  assert.match(edge, /const needsVerification: JsonRecord\[\] = \[\]/);
  assert.match(edge, /if \(needsVerification\.length\)/);
});

test("la vista solo expone candidatas evaluadas con la política predictiva vigente", () => {
  assert.match(edge, /filter\(\(candidate\) => cleanText\(candidate\.eligibility_policy_version, 80\) === RADAR_ELIGIBILITY_POLICY_VERSION\)/);
  assert.match(edge, /canApplyPredictivePolicyOverride\(adapted, decision\)/);
});

test("el estado de Gemini refleja éxito total o fallo parcial real", () => {
  assert.match(edge, /record_market_radar_provider_success/);
  assert.match(edge, /persistProcessorPartialFailure/);
  assert.match(edge, /status_input: "partial_error"/);
  assert.match(edge, /processedDecisions === 0/);
  assert.match(edge, /deferredCandidates: plan\.deferred\.length/);
  assert.match(edge, /deferred_verification_count: deferredVerificationCount/);
});

test("la preparación revalida versión, caducidad, proveedor y duplicados", () => {
  assert.match(edge, /NORMALIZER_OUTDATED/);
  assert.match(edge, /ELIGIBILITY_POLICY_OUTDATED/);
  assert.match(edge, /VERIFICATION_EXPIRED/);
  assert.match(edge, /revalidatePolymarketCandidate/);
  assert.match(edge, /revalidateKalshiCandidate/);
  assert.match(edge, /reserve_market_radar_candidate_for_prepare/);
  assert.match(edge, /PROVIDER_REVALIDATION_FAILED/);
  assert.match(edge, /revalidateCriticalEligibility/);
  assert.match(edge, /researchGroupsWithTavily\(environment\.tavilyKey, \[candidate\]\)/);
  assert.match(edge, /verifyAndAdaptWithGemini\(environment\.geminiKey, \[candidate\]/);
  assert.match(edge, /prepareRevalidationError/);
  assert.match(edge, /RESOLUTION_SOURCE_REQUIRED/);
  assert.match(edge, /const factualReadiness = candidateReady\(factuallyRevalidated\)/);
  assert.match(edge, /RADAR_CANDIDATE_RESOLVED/);
  assert.match(edge, /RADAR_CANDIDATE_INELIGIBLE/);
  assert.match(edge, /RADAR_CANDIDATE_UNANNOUNCED/);
});

test("la migración v2 añade verificación, agrupación y URLs separadas", () => {
  for (const column of ["verification_status", "verification_reason_code", "verified_at", "verification_expires_at", "verification_evidence", "event_group_key", "external_event_url", "external_market_url", "external_event_slug", "external_market_slug"]) {
    assert.match(v2Migration, new RegExp(`add column if not exists ${column}`));
  }
  assert.match(v2Migration, /normalizer_version <> 'atinara-radar-v2'/);
  assert.match(v2Migration, /state not in \('prepared', 'dismissed'\)/);
  assert.match(v2Migration, /when verification = 'verified_open' then 'available'/);
  assert.match(v2Migration, /else 'rejected'/);
});

test("las RPC privadas conservan permisos mínimos y autorización administrativa", () => {
  assert.match(baseMigration, /revoke all on table private\.external_market_candidates from public, anon, authenticated/);
  assert.match(v2Migration, /private\.require_current_admin\(\)/);
  assert.match(v2Migration, /grant execute on function public\.upsert_market_radar_batch_v2[\s\S]+to service_role/);
  assert.match(v2Migration, /grant execute on function public\.list_market_radar_candidates_v2[\s\S]+to authenticated/);
  assert.doesNotMatch(v2Migration, /grant all on table private\.external_market_candidates to service_role/);
});

test("ninguna RPC del Radar publica, resuelve o crea participaciones", () => {
  assert.doesNotMatch(v2Migration, /insert into public\.predictions/i);
  assert.doesNotMatch(v2Migration, /publish_market_draft\(/i);
  assert.doesNotMatch(edge, /publish-scheduled-markets|place_prediction|resolve_market/i);
});

test("la interfaz agrupa por evento, separa fuentes y audita rechazados", () => {
  assert.match(adminUi, /radarGroupMarkup/);
  assert.match(adminUi, /top_candidates/);
  assert.match(adminUi, /Abrir evento original/);
  assert.match(adminUi, /Abrir mercado original/);
  assert.match(adminUi, /Abrir fuente de resolución/);
  assert.match(adminUi, /candidate\.atinara_resolution_source_url \|\| candidate\.source_resolution_url/);
  assert.match(adminUi, /Auditoría factual/);
  assert.match(adminUi, /verification_status === "verified_open"/);
  assert.match(adminUi, /data-child-count/);
  assert.match(adminUi, /data-radar-rejection-filter/);
  assert.match(adminUi, /RADAR_REASON_LABELS/);
  assert.match(adminUi, /RADAR_SCORE_LABELS/);
  assert.match(adminUi, /Criterio anterior/);
  assert.match(adminUi, /radarCandidatePolicyCurrent/);
  assert.match(adminUi, /class="primary-button" type="button" data-radar-details/);
  assert.match(styles, /radar-event-card\[data-child-count="1"\][\s\S]*grid-column:\s*1 \/ -1/);
  assert.match(styles, /radar-rejection-filter/);
  assert.match(adminHtml, /v=20260808-draft-memory2/);
  assert.doesNotMatch(adminHtml, /v=20260806-radar2/);
});

test("el frontend nunca consulta directamente proveedores ni introduce secretos", () => {
  assert.match(adminUi, /client\.functions\.invoke\("market-radar"/);
  assert.doesNotMatch(adminUi, /gamma-api\.polymarket|api\.elections\.kalshi|api\.tavily/);
  assert.doesNotMatch(adminUi, /TAVILY_API_KEY|GEMINI_API_KEY|service_role/i);
});

test("los límites, timeout y refresco siguen acotados sin Cron", () => {
  assert.match(edge, /MAX_PROVIDER_PAGES = 3/);
  assert.match(edge, /MAX_NORMALIZED_PER_PROVIDER = 240/);
  assert.match(edge, /MAX_VISIBLE_GROUPS = 60/);
  assert.match(edge, /MAX_GEMINI_GROUPS = 30/);
  assert.match(edge, /MAX_GEMINI_CANDIDATES = 180/);
  assert.match(edge, /GEMINI_BATCH_SIZE = 9/);
  assert.match(edge, /GEMINI_CONCURRENCY = 2/);
  assert.match(edge, /GEMINI_TIMEOUT_MS = 20_000/);
  assert.match(edge, /GEMINI_MODEL = "gemini-3\.5-flash-lite"/);
  assert.match(edge, /REFRESH_COOLDOWN_MS = 60_000/);
  assert.match(edge, /thinkingLevel: "minimal"/);
  assert.match(edge, /responseMimeType: "application\/json"/);
  assert.match(edge, /responseJsonSchema: geminiResponseJsonSchema/);
  assert.match(edge, /candidate_index: \{ type: "integer"/);
  assert.match(edge, /indexGeminiDecisions\(decisions, candidates\.length\)/);
  assert.doesNotMatch(edge, /parent_event_resolved: \{ type:/);
  assert.doesNotMatch(edge, /atinara_resolution_source_url: \{ type:/);
  assert.match(edge, /selectVerifiedResolutionUrl\(candidate, evidence\)/);
  assert.match(edge, /propagateResolvedEventGroups\(verified, eventResolutions, now\)/);
  assert.match(edge, /officialEventResolutionSignals\(candidates, evidenceByGroup, now\)/);
  assert.match(edge, /buildCoverResolutionSignals\(candidates, now\)/);
  assert.match(edge, /atinara_resolution_source_url: cached\.atinara_resolution_source_url \?\? cached\.source_resolution_url/);
  assert.doesNotMatch(edge, /Devuelve exactamente un elemento por external_id/);
  assert.doesNotMatch(edge, /maxLength:/);
  assert.doesNotMatch(edge, /temperature:/);
  assert.doesNotMatch(edge, /cron|setInterval/i);
});
