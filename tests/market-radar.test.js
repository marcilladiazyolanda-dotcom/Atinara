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

test("el normalizador usa la versión v2", () => {
  assert.equal(radar.RADAR_NORMALIZER_VERSION, "atinara-radar-v2");
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

test("fixture Half-Life 3 no anunciado se rechaza salvo una pregunta explícita de anuncio", () => {
  const release = radar.evaluateDeterministicEligibility({ source_question: "Will Half-Life 3 release in 2026?", source_close_at: "2026-12-31T00:00:00Z" }, { subject_announced: false }, now);
  const announcement = radar.evaluateDeterministicEligibility({ source_question: "Will Valve announce Half-Life 3 in 2026?", source_close_at: "2026-12-31T00:00:00Z" }, { subject_announced: false }, now);
  assert.equal(release.reason_code, "SUBJECT_NOT_ANNOUNCED");
  assert.equal(announcement, null);
});

test("la incoherencia temporal tiene un código estable", () => {
  const decision = radar.evaluateDeterministicEligibility({ source_question: "Will a game launch?" }, { temporal_coherence: false }, now);
  assert.equal(decision.reason_code, "TEMPORAL_INCOHERENCE");
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
  assert.match(edge, /facts \{event_resolved_at/);
  assert.match(edge, /failClosedCandidates/);
  assert.doesNotMatch(edge, /for \(const candidate of candidates\)[\s\S]*api\.tavily\.com/);
});

test("la verificación vigente se reutiliza por huella y evita repetir servicios automáticos", () => {
  assert.match(edge, /const cachedVerification = new Map/);
  assert.match(edge, /Date\.parse\(cleanText\(item\.verification_expires_at/);
  assert.match(edge, /cached\.fingerprint[\s\S]*candidate\.fingerprint/);
  assert.match(edge, /const needsVerification: JsonRecord\[\] = \[\]/);
  assert.match(edge, /if \(needsVerification\.length\)/);
});

test("la preparación revalida versión, caducidad, proveedor y duplicados", () => {
  assert.match(edge, /NORMALIZER_OUTDATED/);
  assert.match(edge, /VERIFICATION_EXPIRED/);
  assert.match(edge, /revalidatePolymarketCandidate/);
  assert.match(edge, /revalidateKalshiCandidate/);
  assert.match(edge, /reserve_market_radar_candidate_for_prepare/);
  assert.match(edge, /PROVIDER_REVALIDATION_FAILED/);
  assert.match(edge, /revalidateCriticalEligibility/);
  assert.match(edge, /researchGroupsWithTavily\(environment\.tavilyKey, \[candidate\]\)/);
  assert.match(edge, /verifyAndAdaptWithGemini\(environment\.geminiKey, \[candidate\]/);
  assert.match(edge, /prepareRevalidationError/);
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
  assert.match(adminUi, /Auditoría factual/);
  assert.match(adminUi, /verification_status === "verified_open"/);
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
  assert.match(edge, /MAX_GEMINI_GROUPS = 20/);
  assert.match(edge, /GEMINI_TIMEOUT_MS = 35_000/);
  assert.match(edge, /REFRESH_COOLDOWN_MS = 60_000/);
  assert.match(edge, /thinkingLevel: "minimal"/);
  assert.match(edge, /responseMimeType: "application\/json"/);
  assert.doesNotMatch(edge, /cron|setInterval/i);
});
