const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { pathToFileURL } = require("node:url");
const { test, before } = require("node:test");

const root = join(__dirname, "..");
const corePath = join(root, "supabase/functions/_shared/market-radar.mjs");
const aiOutputPath = join(root, "supabase/functions/_shared/ai/task-output-validation.mjs");
const edge = readFileSync(join(root, "supabase/functions/market-radar/index.ts"), "utf8");
const marketExpertEdge = readFileSync(join(root, "supabase/functions/market-expert/index.ts"), "utf8");
const baseMigration = readFileSync(join(root, "supabase/migrations/20260804194933_add_market_radar.sql"), "utf8");
const v2Migration = readFileSync(join(root, "supabase/migrations/20260806183627_harden_market_radar_quality_sources.sql"), "utf8");
const visibilityMigration = readFileSync(join(root, "supabase/migrations/20260811123656_harden_radar_visibility_and_presentation_v5.sql"), "utf8");
const revalidationMigration = readFileSync(join(root, "supabase/migrations/20260811155800_allow_needs_review_radar_revalidation_v6.sql"), "utf8");
const batchTimeoutIsolationMigration = readFileSync(join(root, "supabase/migrations/20260825214500_isolate_market_radar_batch_timeouts_v1.sql"), "utf8");
const adminUi = readFileSync(join(root, "admin-markets.js"), "utf8");
const adminHtml = readFileSync(join(root, "admin-markets.html"), "utf8");
const adminAgentBridge = readFileSync(join(root, "admin-agent-engine.js"), "utf8");
const styles = readFileSync(join(root, "styles.css"), "utf8");
const aiTaskPolicy = readFileSync(join(root, "supabase/functions/_shared/ai/task-policy.mjs"), "utf8");
const aiModelCatalog = readFileSync(join(root, "supabase/functions/_shared/ai/model-catalog.mjs"), "utf8");
let radar;
let aiOutput;

before(async () => {
  radar = await import(pathToFileURL(corePath).href);
  aiOutput = await import(pathToFileURL(aiOutputPath).href);
});

const now = "2026-08-06T12:00:00.000Z";

function verifiedOfficialEvidence(overrides = {}) {
  const supports = overrides.supports ?? "Official factual statement.";
  return {
    title: overrides.title ?? "Official source",
    url: overrides.url ?? "https://www.ea.com/games/example/official",
    source_type: "official",
    supports,
    retrieved_at: now,
    retrieval_status: "verified_content",
    evidence_basis: "retrieved_content",
    parser_version: "atinara-official-content-v1",
    content_sha256: createHash("sha256").update(supports).digest("hex"),
    content_type: "text/html",
    claim_status: "direct",
    direct_claim: true,
    claim_verifiable: true,
    relevance_score: 100,
    supported_reason_codes: [],
    supported_fact_statuses: [],
    supported_contract_kinds: [],
    unresolved_proof: false,
    ...overrides,
  };
}

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
  const event = {
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
  return {
    ...event,
    provider_declared_child_count: overrides.provider_declared_child_count ?? event.markets.length,
    provider_pagination_exhausted: overrides.provider_pagination_exhausted ?? true,
  };
}

function resolvedFc27CoverEvent() {
  return polyEvent({
    markets: [
      polyMarket("m-kylian", "will-kylian-mbappe-be-on-the-cover-of-ea-sports-fc-27", "Will Kylian Mbappe be on the cover of EA Sports FC 27?", {
        active: false,
        closed: true,
        resolved: true,
        result: "yes",
        outcomePrices: '["1","0"]',
        resolvedAt: "2026-07-23T12:00:00Z",
      }),
      polyMarket("m-jude", "will-jude-bellingham-be-on-the-cover-of-ea-sports-fc-27", "Will Jude Bellingham be on the cover of EA Sports FC 27?", {
        active: false,
        closed: true,
        resolved: true,
        result: "yes",
        outcomePrices: '["1","0"]',
        resolvedAt: "2026-07-23T12:00:00Z",
      }),
      polyMarket("m-ousmane", "will-ousmane-dembele-be-on-the-cover-of-ea-sports-fc-27", "Will Ousmane Dembele be on the cover of EA Sports FC 27?"),
      polyMarket("m-harry", "will-harry-kane-be-on-the-cover-of-ea-sports-fc-27", "Will Harry Kane be on the cover of EA Sports FC 27?"),
      polyMarket("m-lionel", "will-lionel-messi-be-on-the-cover-of-ea-sports-fc-27", "Will Lionel Messi be on the cover of EA Sports FC 27?"),
    ],
  });
}

function kalshiEvent(overrides = {}) {
  const event = {
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
  return {
    ...event,
    provider_declared_child_count: overrides.provider_declared_child_count ?? event.markets.length,
    provider_pagination_exhausted: overrides.provider_pagination_exhausted ?? true,
  };
}

function completeCandidate(question, overrides = {}) {
  const candidate = {
    source_question: question,
    atinara_question: question,
    atinara_category: "Lanzamientos",
    atinara_resolution_criteria: "Se resolverá Sí si una fuente oficial confirma el resultado dentro del periodo.",
    atinara_resolution_source_url: "https://www.example.com/official-source",
    source_close_at: "2026-12-31T23:59:59Z",
    hard_reject_reasons: [],
    eligibility_policy_version: "atinara-prediction-policy-v5",
    ...overrides,
  };
  if (candidate.atinara_resolution_source_url
    && !Object.prototype.hasOwnProperty.call(overrides, "resolution_source_evidence")) {
    const evidence = [verifiedOfficialEvidence({
      url: candidate.atinara_resolution_source_url,
      title: question,
      supports: `${question} Official resolution source.`,
    })];
    candidate.resolution_source_evidence = evidence;
    candidate.eligibility_evidence = evidence;
  }
  return candidate;
}

test("el normalizador usa la versión v3", () => {
  assert.equal(radar.RADAR_NORMALIZER_VERSION, "atinara-radar-v3");
  assert.equal(radar.RADAR_ELIGIBILITY_POLICY_VERSION, "atinara-prediction-policy-v5");
  assert.equal(radar.RADAR_FAMILY_VERSION, "atinara-market-family-v5");
  assert.equal(radar.RADAR_FACT_POLICY_VERSION, "atinara-terminal-fact-gate-v2");
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
  assert.equal(candidates[0].provider_payload.canonical_event_children.length, 4);
  assert.ok(candidates[0].fact_context_fingerprint);
});

test("Polymarket liga la huella factual al estado de todas las hijas canónicas", () => {
  const before = radar.adaptPolymarketResponse({ events: [polyEvent()] }, { now, canonicalUrlVerified: true })[0];
  const changed = polyEvent();
  changed.markets[1] = { ...changed.markets[1], active: false, closed: true, resolved: true, result: "yes" };
  const after = radar.adaptPolymarketResponse({ events: [changed] }, { now, canonicalUrlVerified: true })[0];
  assert.notEqual(before.fact_context_fingerprint, after.fact_context_fingerprint);
  assert.notEqual(before.fingerprint, after.fingerprint);
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

test("un cierre del proveedor se persiste como no abierto, nunca como hecho desconocido", () => {
  const closedEvent = polyEvent({
    markets: [polyMarket(
      "m-closed",
      "will-example-player-be-on-the-cover-of-ea-sports-fc-27",
      "Will Example Player be on the cover of EA Sports FC 27?",
      { active: false, closed: true, result: null },
    )],
  });
  const candidate = radar.adaptPolymarketResponse({ events: [closedEvent] }, {
    now,
    canonicalUrlVerified: true,
  })[0];
  assert.ok(candidate);
  const decision = radar.evaluateProviderEligibility(candidate, now);
  assert.equal(decision.reason_code, "PROVIDER_NOT_OPEN");
  const rejected = radar.applyEligibilityDecision(candidate, {
    ...decision,
    fact_status: "unresolved",
  }, now);
  assert.equal(rejected.verification_status, "rejected_ineligible");
  assert.equal(rejected.verification_reason_code, "PROVIDER_NOT_OPEN");
  assert.equal(rejected.fact_status, "unresolved");
  assert.equal(rejected.verification_evidence[0].source_type, "provider");
  assert.deepEqual(rejected.verification_evidence[0].supported_fact_statuses, ["unresolved"]);
});

test("una tarjeta conserva tres destacadas y todas las opciones del evento padre", () => {
  const candidates = radar.scoreCandidates(radar.adaptPolymarketResponse({ events: [polyEvent()] }, { now, canonicalUrlVerified: true }), [], now);
  const groups = radar.groupCandidates(candidates);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].child_count, 4);
  assert.equal(groups[0].top_candidates.length, 3);
  assert.equal(groups[0].candidates.length, 4);
});

test("Kalshi mantiene pregunta y probabilidad ligadas en cada umbral aunque el título se repita", () => {
  const event = {
    event_ticker: "KXMC-EXAMPLE",
    series_ticker: "KXMC",
    title: "Example Game: Metacritic score",
    category: "Entertainment",
    external_event_url: "https://kalshi.com/markets/kxmc/example-game/kxmc-example",
    canonical_url_verified: true,
    markets: [
      {
        ticker: "KXMC-EXAMPLE-90",
        title: "Example Game Metacritic score?",
        yes_sub_title: "Above 90",
        no_sub_title: "Above 90",
        floor_strike: 90,
        strike_type: "greater",
        market_type: "binary",
        status: "active",
        yes_bid_dollars: "0.9500",
        yes_ask_dollars: "1.0000",
        close_time: "2026-09-01T12:00:00Z",
        rules_primary: "If the Metascore for Example Game is Above 90 seven days after release at 10:00AM ET, then the market resolves to Yes.",
        external_market_url: "https://kalshi.com/markets/kxmc/example-game/kxmc-example",
        canonical_url_verified: true,
      },
      {
        ticker: "KXMC-EXAMPLE-95",
        title: "Example Game Metacritic score?",
        yes_sub_title: "Above 95",
        no_sub_title: "Above 95",
        floor_strike: 95,
        strike_type: "greater",
        market_type: "binary",
        status: "active",
        yes_bid_dollars: "0.0000",
        yes_ask_dollars: "0.0700",
        close_time: "2026-09-01T12:00:00Z",
        rules_primary: "If the Metascore for Example Game is Above 95 seven days after release at 10:00AM ET, then the market resolves to Yes.",
        external_market_url: "https://kalshi.com/markets/kxmc/example-game/kxmc-example",
        canonical_url_verified: true,
      },
    ],
  };
  const candidates = radar.adaptKalshiResponse({ events: [event] }, { now })
    .map((candidate) => radar.normalizeRadarCandidatePresentation(candidate));
  assert.deepEqual(candidates.map((candidate) => candidate.atinara_question), [
    "¿Tendrá Example Game una puntuación en Metacritic superior a 90 7 días después de su lanzamiento?",
    "¿Tendrá Example Game una puntuación en Metacritic superior a 95 7 días después de su lanzamiento?",
  ]);
  assert.deepEqual(candidates.map((candidate) => Number(candidate.source_probability_yes.toFixed(1))), [97.5, 3.5]);
  assert.deepEqual(candidates.map((candidate) => candidate.provider_payload.floor_strike), [90, 95]);
});

test("la presentación de portada usa una estructura española común sin alterar la opción", () => {
  const candidates = radar.adaptPolymarketResponse({ events: [polyEvent()] }, { now, canonicalUrlVerified: true })
    .map((candidate) => radar.normalizeRadarCandidatePresentation(candidate));
  assert.equal(candidates[0].atinara_question, "¿Aparecerá Khvicha Kvaratskhelia en la portada de EA Sports FC 27?");
  assert.equal(candidates[1].atinara_question, "¿Aparecerá Manuel Neuer en la portada de EA Sports FC 27?");
  assert.equal(candidates[0].source_probability_yes, 37.9);
});

test("el extractor factual conserva alt y metadatos oficiales pero elimina scripts", () => {
  const text = radar.extractOfficialHtmlText(`
    <meta property="og:description" content="Official cover selection">
    <ea-hero image-tooltip="EA SPORTS Example 27 Standard Edition cover art featuring Ada Player"></ea-hero>
    <img alt="EA SPORTS Example 27 Ultimate Edition cover art featuring Ada Player">
    <script>ignore secret-token and fake outcome</script>
    <p>Published by the official studio.</p>
  `);
  assert.match(text, /Official cover selection/);
  assert.match(text, /Standard Edition cover art featuring Ada Player/);
  assert.match(text, /Ultimate Edition cover art featuring Ada Player/);
  assert.match(text, /Published by the official studio/);
  assert.doesNotMatch(text, /secret-token|fake outcome/);
});

test("el extractor factual conserva textos alternativos estructurados de ediciones", () => {
  const text = radar.extractOfficialHtmlText(`
    <script type="application/json">{
      "gameEditions":[
        {"editionName":"Ultimate Plus Edition","packArt":{"alternateText":"Example Game 27 Ultimate Plus Edition key art featuring Ada Player and Bea Player"}},
        {"editionName":"Ultimate Edition","packArt":{"alternateText":"Example Game 27 Ultimate Edition key art featuring Ada Player"}},
        {"editionName":"Standard Edition","packArt":{"alternateText":"Example Game 27 cover art featuring Ada Player"}}
      ],
      "accessToken":"never-copy-this-value"
    }</script>
  `);
  assert.match(text, /Ultimate Plus Edition key art featuring Ada Player and Bea Player/);
  assert.match(text, /Ultimate Edition key art featuring Ada Player/);
  assert.match(text, /Standard Edition: Example Game 27 cover art featuring Ada Player/);
  assert.doesNotMatch(text, /never-copy-this-value|accessToken/);
  const page = { url: "https://official.example/games/example-game-27/buy", title: "Example Game 27", content: text };
  const segments = radar.officialEvidenceSegmentsForSubject(page, "Example Game 27", "selection");
  const selectionEditions = radar.officialSelectionEditionCoverage(page, segments, "Example Game 27");
  assert.deepEqual(new Set(selectionEditions), new Set([
    "standard", "ultimate", "ultimate_plus",
  ]));
  const names = ["Ada Player", "Bea Player", "Cora Player"];
  const candidates = names.map((name, index) => ({
    provider: "polymarket",
    external_id: `option-${index}`,
    source_question: `Will ${name} be on the cover of Example Game 27?`,
    source_resolution_rules: "Resolves Yes for any Standard, Ultimate, or Ultimate Plus edition cover.",
    provider_payload: {
      canonical_event_children_complete: true,
      canonical_event_children_total: names.length,
      canonical_event_children: names.map((child, childIndex) => ({
        market_id: `child-${childIndex}`,
        question: `Will ${child} be on the cover of Example Game 27?`,
      })),
    },
  }));
  const resolution = radar.detectOfficialCoverEventResolution(candidates, [verifiedOfficialEvidence({
    url: "https://official.example/games/example-game-27/buy",
    supports: segments.join(" ").slice(0, 500),
    selection_editions: selectionEditions,
  })]);
  assert.equal(resolution?.selection_complete, true);
  assert.deepEqual(new Set(resolution?.outcome_names), new Set(["Ada Player", "Bea Player"]));
});

test("la investigación sigue solo enlaces editoriales acotados de la misma autoridad oficial", () => {
  const urls = radar.extractOfficialRelatedUrls(`
    <a href="/games/example/cover-discovery-hub">Official cover reveal</a>
    <a href="/games/example/news/editions-and-release-dates">Editions and release dates</a>
    <a href="/games/example/buy">Buy editions</a>
    <a href="https://docs.ea.com/games/example/cover">Otro subdominio</a>
    <a href="https://ea.com@evil.example/cover">Host engañoso</a>
    <a href="/assets/cover.png">Imagen</a>
    <a href="#cover">Fragmento</a>
  `, "https://www.ea.com/games/example", ["ea.com"], 4);
  assert.deepEqual(new Set(urls), new Set([
    "https://www.ea.com/games/example/cover-discovery-hub",
    "https://www.ea.com/games/example/news/editions-and-release-dates",
    "https://www.ea.com/games/example/buy",
    "https://docs.ea.com/games/example/cover",
  ]));
});

test("la evidencia métrica exige la ficha canónica del mismo producto", () => {
  const wrong = radar.officialEvidenceSegmentsForSubject({
    url: "https://www.metacritic.com/movie/the-score/credits/",
    title: "The Score credits - Metacritic",
    content: "The Score credits - Metacritic. Big Walk. Metacritic score.",
  }, "Big Walk", "metric");
  const right = radar.officialEvidenceSegmentsForSubject({
    url: "https://www.metacritic.com/game/big-walk/",
    title: "Big Walk Reviews - Metacritic",
    content: "Big Walk has not been released yet.",
  }, "Big Walk", "metric");
  assert.deepEqual(wrong, []);
  assert.ok(right.some((segment) => /Big Walk/.test(segment)));
});

test("una navegación de otra edición no liga su contenido de portada a FC27", () => {
  const segments = radar.officialEvidenceSegmentsForSubject({
    url: "https://news.ea.com/fc-26-cover-stars",
    title: "EA SPORTS FC 26 cover stars",
    content: "Jude Bellingham and Jamal Musiala are the FC 26 cover stars. EA SPORTS FC 27 features.",
  }, "EA SPORTS FC 27", "selection");
  assert.deepEqual(segments, []);
});

test("el contexto oficial próximo asocia la portada con su edición sin hardcode de título", () => {
  const page = {
    url: "https://www.ea.com/games/example/membership",
    title: "Official membership page",
    content: "Example Game 27 cover art showing Ada Player. Game Trial. Members get a trial of the Standard Edition.",
  };
  const segments = radar.officialEvidenceSegmentsForSubject(page, "Example Game 27", "selection");
  assert.deepEqual(radar.officialSelectionEditionCoverage(page, segments, "Example Game 27"), ["standard"]);
});

test("la puntuación no puede convertir un rechazo factual en candidato apto", () => {
  const candidate = radar.adaptPolymarketResponse({ events: [resolvedFc27CoverEvent()] }, { now, canonicalUrlVerified: true })[0];
  const rejected = radar.applyEligibilityDecision(candidate, radar.evaluateProviderEligibility(candidate, now), now);
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

test("la decisión conserva la cobertura estructurada de ediciones en su evidencia", () => {
  const candidate = radar.adaptPolymarketResponse({ events: [polyEvent()] }, { now, canonicalUrlVerified: true })[0];
  const reviewed = radar.applyEligibilityDecision(candidate, {
    eligible: false,
    conclusive: false,
    reason_code: "VERIFICATION_REQUIRED",
    evidence: [verifiedOfficialEvidence({ selection_editions: ["standard", "ultimate", "ultimate_plus", "unknown"] })],
  }, now);
  assert.deepEqual(reviewed.verification_evidence[0].selection_editions, ["standard", "ultimate", "ultimate_plus"]);
});

test("una afirmación terminal del modelo no prevalece sobre el cierre probado del proveedor", () => {
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
  assert.notEqual(rejected.verification_status, "rejected_resolved");
  assert.equal(rejected.verification_reason_code, "PROVIDER_NOT_OPEN");
});

test("los lotes de enriquecimiento IA son pequeños, monoproveedor y conservan las candidatas aplazadas", () => {
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
  const plan = radar.buildAiCandidateBatches([...polymarket, ...kalshi], {
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

test("FC27 conserva ganadores cerrados, reconoce varias portadas oficiales y bloquea las hijas aún abiertas", () => {
  const allCandidates = radar.adaptPolymarketResponse({ events: [resolvedFc27CoverEvent()] }, { now, canonicalUrlVerified: true });
  const openCandidates = allCandidates.filter((candidate) => candidate.source_status === "open");
  assert.equal(openCandidates.length, 3);
  assert.ok(openCandidates.every((candidate) => candidate.provider_payload.canonical_event_children.length === 5));
  assert.ok(openCandidates.every((candidate) => candidate.provider_payload.canonical_event_children.some(
    (child) => child.question.includes("Kylian Mbappe") && child.result === "yes",
  )));

  const evidence = [verifiedOfficialEvidence({
    url: "https://news.ea.com/press-releases/press-releases-details/2026/Kylian-Mbapp-and-Jude-Bellingham-Welcome-You-to-EA-SPORTS-FC-27-Launching-Worldwide-on-September-25/default.aspx",
    title: "Kylian Mbappe and Jude Bellingham welcome you to EA SPORTS FC 27",
    supports: "EA SPORTS FC 27 cover stars are Kylian Mbappe on the Standard and Ultimate Edition covers, with Jude Bellingham joining him on the Ultimate Plus cover.",
  })];
  const resolution = radar.detectOfficialCoverEventResolution(openCandidates, evidence);
  assert.equal(resolution.selection_complete, true);
  assert.equal(resolution.fact_status, "fully_resolved");
  assert.deepEqual(new Set(resolution.outcome_names), new Set(["Kylian Mbappe", "Jude Bellingham"]));

  const signals = openCandidates.map((candidate) => ({
    event_group_key: candidate.event_group_key,
    candidate_identity: `${candidate.provider}:${candidate.external_id}`,
    resolved_at: "2026-07-23T12:00:00Z",
    reason: "EA publicó la selección completa de portadas.",
    confidence: 100,
    evidence: resolution.evidence,
    selection_complete: true,
  }));
  const rejected = radar.propagateResolvedEventGroups(openCandidates, signals, now);
  assert.ok(rejected.every((candidate) => candidate.verification_status === "rejected_resolved"));
  assert.ok(rejected.every((candidate) => candidate.fact_status === "fully_resolved"));
  assert.ok(rejected.every((candidate) => candidate.state === "rejected"));
});

test("una selección de portada puede cerrarse con cobertura oficial acumulada de todas sus ediciones", () => {
  const allCandidates = radar.adaptPolymarketResponse({ events: [resolvedFc27CoverEvent()] }, { now, canonicalUrlVerified: true });
  const openCandidates = allCandidates.filter((candidate) => candidate.source_status === "open");
  const evidence = [
    verifiedOfficialEvidence({
      url: "https://www.ea.com/games/example/standard",
      title: "Example 27 Standard Edition",
      supports: "EA SPORTS FC 27 Standard Edition cover art featuring Kylian Mbappe.",
    }),
    verifiedOfficialEvidence({
      url: "https://www.ea.com/games/example/ultimate",
      title: "Example 27 Ultimate Edition",
      supports: "EA SPORTS FC 27 Ultimate Edition cover art featuring Kylian Mbappe.",
    }),
    verifiedOfficialEvidence({
      url: "https://www.ea.com/games/example/ultimate-plus",
      title: "Example 27 Ultimate Plus Edition",
      supports: "EA SPORTS FC 27 Ultimate Plus Edition key art featuring Kylian Mbappe and Jude Bellingham.",
    }),
  ];
  const resolution = radar.detectOfficialCoverEventResolution(openCandidates, evidence);
  assert.equal(resolution?.selection_complete, true);
  assert.deepEqual(new Set(resolution?.outcome_names), new Set(["Kylian Mbappe", "Jude Bellingham"]));
  assert.ok(resolution.evidence.every((item) => item.selection_complete === true));
});

test("un único atleta anunciado no cierra un contrato que admite varias ediciones", () => {
  const candidates = radar.adaptPolymarketResponse({ events: [polyEvent()] }, { now, canonicalUrlVerified: true });
  const evidence = [verifiedOfficialEvidence({
    url: "https://www.ea.com/games/example/cover",
    title: "EA SPORTS Example 27 official cover athlete",
    supports: "EA SPORTS FC 27 official cover athlete named Kylian Mbappe.",
  })];
  assert.equal(radar.detectOfficialCoverEventResolution(candidates, evidence), null);
});

test("la cobertura estructurada liga una portada sin etiqueta a su edición cercana", () => {
  const allCandidates = radar.adaptPolymarketResponse({ events: [resolvedFc27CoverEvent()] }, { now, canonicalUrlVerified: true });
  const openCandidates = allCandidates.filter((candidate) => candidate.source_status === "open");
  const evidence = [
    verifiedOfficialEvidence({
      url: "https://www.ea.com/games/example/membership",
      supports: "EA SPORTS FC 27 cover art showing Kylian Mbappe.",
      selection_editions: ["standard"],
    }),
    verifiedOfficialEvidence({
      url: "https://www.ea.com/games/example/coming-soon",
      supports: "EA SPORTS FC 27 Ultimate Edition cover art featuring Kylian Mbappe.",
      selection_editions: ["ultimate"],
    }),
    verifiedOfficialEvidence({
      url: "https://www.ea.com/games/example/features",
      supports: "EA SPORTS FC 27 Ultimate Plus Edition key art featuring Kylian Mbappe and Jude Bellingham.",
      selection_editions: ["ultimate_plus"],
    }),
  ];
  const resolution = radar.detectOfficialCoverEventResolution(openCandidates, evidence);
  assert.equal(resolution?.selection_complete, true);
  assert.deepEqual(new Set(resolution?.outcome_names), new Set(["Kylian Mbappe", "Jude Bellingham"]));
});

test("una fuente oficial de otra edición nunca resuelve la identidad actual", () => {
  const candidates = radar.adaptPolymarketResponse({ events: [polyEvent()] }, { now, canonicalUrlVerified: true });
  const evidence = [verifiedOfficialEvidence({
    url: "https://news.ea.com/press-releases/example-fc-26",
    title: "EA SPORTS FC 26 cover stars",
    supports: "EA announced the complete EA SPORTS FC 26 Standard and Ultimate Edition cover lineup.",
  })];
  assert.equal(radar.detectOfficialCoverEventResolution(candidates, evidence), null);
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

test("la política predictiva solo resuelve VERIFICATION_REQUIRED para una predicción directa completa y segura", () => {
  const candidate = completeCandidate("Will Grand Theft Auto VI release before September 1, 2026?");
  assert.equal(radar.canApplyPredictivePolicyOverride(candidate, { reason_code: "VERIFICATION_REQUIRED" }, now), true);
  assert.equal(radar.canApplyPredictivePolicyOverride(candidate, { reason_code: "EVENT_ALREADY_RESOLVED" }, now), false);
  assert.equal(radar.canApplyPredictivePolicyOverride(candidate, { reason_code: "INVALID_OR_UNVERIFIED_SOURCE" }, now), false);
  assert.equal(radar.canApplyPredictivePolicyOverride({ ...candidate, atinara_resolution_source_url: null }, { reason_code: "VERIFICATION_REQUIRED" }, now), false);
  assert.equal(radar.canApplyPredictivePolicyOverride({ ...candidate, source_result: "yes" }, { reason_code: "VERIFICATION_REQUIRED" }, now), false);
  assert.equal(radar.canApplyPredictivePolicyOverride({
    ...candidate,
    hard_reject_reasons: ["INVALID_OR_UNVERIFIED_SOURCE"],
  }, { reason_code: "VERIFICATION_REQUIRED" }, now), false);
  assert.equal(radar.canApplyPredictivePolicyOverride(
    completeCandidate("Will Grand Theft Auto VI score above 95 on Metacritic?"),
    { reason_code: "VERIFICATION_REQUIRED" },
    now,
  ), false);
  assert.equal(radar.canApplyPredictivePolicyOverride(
    completeCandidate("Will Grand Theft Auto VI win Game of the Year 2026?"),
    { reason_code: "VERIFICATION_REQUIRED" },
    now,
  ), false);
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
    "clob.polymarket.com",
    "external-api.kalshi.com",
    "gamma-api.polymarket.com",
  ]);
});

test("el Gateway interpreta texto JSON dividido e ignora bloques de razonamiento", () => {
  const result = aiOutput.parseTaskProviderEnvelope("radar_candidate_enrichment", {
    candidates: [{ content: { parts: [{ thought: true, text: "privado" }, { text: '{"candidates":[{"candidate_index":' }, { text: "0}]}" }] } }],
  });
  assert.deepEqual(result, { candidates: [{ candidate_index: 0 }] });
});

test("el contrato Radar rechaza índices duplicados o alterados", () => {
  const decision = {
    candidate_index: 0, eligible: true, conclusive: false,
    reason_code: "VERIFICATION_REQUIRED", reason: "La evidencia requiere revisión.",
    confidence: 50, ttl_minutes: 60,
    facts: { event_resolved_at: null, official_reveal_at: null, release_at: null, subject_announced: null, temporal_coherence: null },
    atinara_question: "¿Ocurrirá el evento?", atinara_category: "Eventos",
    atinara_resolution_criteria: "Se resolverá con una fuente oficial.",
  };
  assert.throws(
    () => aiOutput.validateTaskOutput("radar_candidate_enrichment", { candidates: [decision, decision, decision] }, { candidateCount: 3 }),
    (error) => error.code === "AI_OUTPUT_CONTRACT_INVALID",
  );
});

test("una actualización explícita nunca reutiliza un estado abierto y solo conserva rechazos terminales idénticos", () => {
  const candidate = { fingerprint: "fp-1", fact_context_fingerprint: "fact-fp-1", eligibility_policy_version: "atinara-prediction-policy-v5" };
  const verified = {
    normalizer_version: "atinara-radar-v3",
    eligibility_policy_version: "atinara-prediction-policy-v5",
    fingerprint: "fp-1",
    verification_status: "verified_open",
    verification_reason_code: null,
    verification_expires_at: "2026-08-06T13:00:00.000Z",
    fact_policy_version: "atinara-terminal-fact-gate-v2",
    fact_context_fingerprint: "fact-fp-1",
    atinara_question: "¿Se anunciará GTA VI?",
    atinara_category: "Lanzamientos",
    atinara_resolution_criteria: "Sí si Rockstar lo anuncia oficialmente.",
    atinara_resolution_source_url: "https://www.rockstargames.com/VI",
  };
  assert.equal(radar.canReuseRadarVerification(verified, candidate, now), false);
  assert.equal(radar.canReuseRadarVerification({ ...verified, verification_status: "needs_review" }, candidate, now), false);
  assert.equal(radar.canReuseRadarVerification({ ...verified, verification_reason_code: "VERIFICATION_REQUIRED" }, candidate, now), false);
  assert.equal(radar.canReuseRadarVerification({ ...verified, verification_expires_at: "2026-08-06T11:59:59.000Z" }, candidate, now), false);
  assert.equal(radar.canReuseRadarVerification({ ...verified, fingerprint: "fp-2" }, candidate, now), false);
  assert.equal(radar.canReuseRadarVerification({
    ...verified,
    verification_status: "rejected_resolved",
    verification_reason_code: "EVENT_ALREADY_RESOLVED",
  }, candidate, now), true);
  assert.equal(radar.canReuseRadarVerification({
    ...verified,
    verification_status: "rejected_resolved",
    verification_reason_code: "EVENT_ALREADY_RESOLVED",
    verification_expires_at: now,
  }, candidate, now), false);
  assert.equal(radar.canReuseRadarVerification({ ...verified, eligibility_policy_version: "atinara-prediction-policy-v3" }, candidate, now), false);
});

test("la revalidación conserva el código SQL de dominio y distingue identidad stale de un 503 técnico", () => {
  assert.equal(radar.radarOperationalErrorCode({
    databaseMessage: "RADAR_CANDIDATE_IDENTITY_STALE",
    message: "RADAR_RPC_409",
  }), "RADAR_CANDIDATE_IDENTITY_STALE");
  assert.equal(radar.radarOperationalErrorCode({
    code: "PROVIDER_UNAVAILABLE",
    message: "network failed",
  }), "PROVIDER_UNAVAILABLE");
  assert.equal(radar.radarOperationalErrorCode({ message: "texto no seguro" }),
    "RADAR_ELIGIBILITY_TECHNICAL_FAILURE");
  assert.match(edge, /RADAR_CANDIDATE_IDENTITY_STALE[\s\S]+refresh_radar_sources/);
  assert.match(edge, /RADAR_CANDIDATE_IDENTITY_STALE[\s\S]+retryable_input/);
});

test("discovery y persistencia conservan la regla SQL interna sin llamarla caída del proveedor", () => {
  assert.match(edge, /function internalRadarRpcFailure/);
  assert.match(edge, /function internalRadarOperationalFailure/);
  assert.match(edge, /ReturnType<typeof publicProviderError> & JsonRecord/);
  assert.match(edge, /error instanceof RadarRpcError/);
  assert.match(edge, /const code = timedOut \? "RADAR_PERSISTENCE_TIMEOUT"/);
  assert.match(edge, /error\.databaseMessage \|\| "RADAR_PERSISTENCE_FAILED"/);
  assert.match(edge, /code === "RADAR_PERSISTENCE_FAILED"/);
  assert.match(edge, /database_code: error\.databaseCode \|\| null/);
  assert.match(edge, /function providerFailure[\s\S]+internalRadarOperationalFailure\(error, provider\)/);
  assert.match(edge, /function persistenceFailure[\s\S]+internalRadarOperationalFailure\(error, provider\)/);
  assert.match(edge, /code\.includes\("DEADLINE_EXCEEDED"\)/);
  assert.doesNotMatch(edge, /internalRadarRpcFailure[\s\S]+code:\s*"PROVIDER_UNAVAILABLE"/);
});

test("cada padre se confirma como checkpoint y un timeout de persistencia conserva la misma UUID", () => {
  assert.match(edge, /payloads\.sort\(\(left, right\)/);
  assert.match(edge, /payloads\.map\(\(payload\) => \[payload\]\)/);
  assert.match(edge, /for \(const reconciliationBatch of checkpoints\)/);
  assert.match(edge, /checkpoint\?\.complete !== true/);
  assert.match(edge, /persistenceFailure\(error, provider\)/);
  assert.match(edge, /async function deferRadarRefreshPersistence/);
  assert.match(edge, /RADAR_DEFERRABLE_PERSISTENCE_CODES/);
  assert.match(edge, /const deferral = toRecord\(await rpc\(environment, "defer_market_radar_refresh_v1"/);
  assert.match(edge, /deferral\?\.outcome !== "in_progress"/);
  assert.match(edge, /throw new Error\("RADAR_REFRESH_DEFERRAL_INVALID"\)/);
  assert.doesNotMatch(edge, /defer_market_radar_refresh_v1[\s\S]{0,500}\.catch\(\(\) => null\)/);
  assert.match(edge, /status: deferred \? 202 : failure\.status/);
  assert.match(edge, /next_action: deferred \? "resume_persistence_intent"/);
  assert.match(edge, /status: deferral \? 202 : failure\.status/);
  assert.match(edge, /next_action: deferral \? "resume_persistence_intent"/);
});

test("un timeout exterior identifica, divide y reanuda únicamente el batch durable afectado", () => {
  assert.match(edge, /"process_market_radar_refresh_batch_v4"/);
  assert.match(edge, /batchCode === "RADAR_PERSISTENCE_TIMEOUT"/);
  assert.match(edge, /timeoutItemCount > 1/);
  assert.match(edge, /"split_market_radar_refresh_batch_v1"/);
  assert.match(edge, /batch_id_input: timeoutBatchId/);
  assert.match(edge, /splitParentId !== timeoutBatchId/);
  assert.match(edge, /leftCount \+ rightCount === timeoutItemCount/);
  assert.match(edge, /throw new Error\("RADAR_REFRESH_BATCH_SPLIT_INVALID"\)/);
  assert.match(edge, /processedBatchCount \+= 1;[\s\S]+continue;/);
  assert.match(batchTimeoutIsolationMigration, /exception when query_canceled/);
  assert.match(batchTimeoutIsolationMigration, /for update skip locked/);
  assert.match(batchTimeoutIsolationMigration, /attempt_count=batch_alias\.attempt_count\+1/);
  assert.match(batchTimeoutIsolationMigration, /RADAR_REFRESH_BATCH_TIMEOUT_STATE_INVALID/);
  assert.match(batchTimeoutIsolationMigration,
    /revoke all on function public\.process_market_radar_refresh_batch_v3[\s\S]+grant execute on function public\.process_market_radar_refresh_batch_v4[\s\S]+to service_role/);
  assert.doesNotMatch(batchTimeoutIsolationMigration,
    /KX[A-Z0-9-]+|kalshi\.com\/markets|polymarket\.com\/event/i);
});

test("el enriquecimiento auxiliar tiene un deadline propio y siempre libera su contexto", () => {
  assert.match(edge, /RADAR_ENRICHMENT_BUDGET_MS = 12_000/);
  assert.match(edge, /async function withRadarEnrichmentBudget/);
  assert.match(edge, /durationMs: Math\.min\(RADAR_ENRICHMENT_BUDGET_MS, remaining\)/);
  assert.match(edge, /parentSignal: environment\.execution\.signal/);
  assert.match(edge, /finally \{[\s\S]*scoped\.cleanup\(\)/);
  assert.match(edge, /withRadarRefreshLeaseHeartbeat\([\s\S]+withRadarEnrichmentBudget\([\s\S]+researchGroupsWithTavily/);
});

test("una URL auxiliar fallida solo se recupera con cobertura oficial futura exacta", () => {
  const researchSource = edge.slice(
    edge.indexOf("async function researchGroupsWithTavily"),
    edge.indexOf("function officialEventResolutionSignals"),
  );
  assert.match(researchSource, /hasDeterministicOfficialResearchCoverage\(groupCandidates, groupEvidence, coverageCheckedAt\)/);
  assert.match(researchSource, /deterministic_future_fallback_groups: deterministicFutureFallbackGroups/);
  assert.match(researchSource, /incompleteGroupKeys\.delete\(groupKey\)/);
  assert.doesNotMatch(researchSource, /GTA|Rockstar|KXGTATRAILER|Project Aurora/i);
});

test("la fuente de resolución exige evidencia oficial exacta y dominio autoritativo", () => {
  const authoritativeDomains = new Set(["ea.com", "thegameawards.com"]);
  const evidence = [
    { url: "https://example.com/inventada", source_type: "public" },
    verifiedOfficialEvidence({
      url: "https://www.ea.com/games/ea-sports-fc/fc-27/news/official",
      supports: "Official EA Sports FC 27 product announcement.",
    }),
  ];
  const accepted = radar.selectVerifiedResolutionUrl({
    source_question: "Will EA Sports FC 27 release this year?",
  }, evidence, authoritativeDomains);
  const untrusted = radar.selectVerifiedResolutionUrl({}, evidence.slice(0, 1), authoritativeDomains);
  const existing = radar.selectVerifiedResolutionUrl(
    { source_resolution_url: "https://thegameawards.com/nominees/game-of-the-year" },
    evidence,
    authoritativeDomains,
  );
  assert.equal(accepted, evidence[1].url);
  assert.equal(untrusted, null);
  assert.equal(existing, null);
});

test("una resolución no se propaga por ratio sin selección completa", () => {
  const candidates = [
    { event_group_key: "polymarket:ea-fc27", hard_reject_reasons: [], verification_status: "needs_review" },
    { event_group_key: "polymarket:ea-fc27", hard_reject_reasons: [], verification_status: "needs_review" },
    { event_group_key: "kalshi:gta6", hard_reject_reasons: [], verification_status: "verified_open" },
  ];
  const signal = (candidateIdentity) => ({
    event_group_key: "polymarket:ea-fc27",
    candidate_identity: candidateIdentity,
    resolved_at: "2026-07-17T00:00:00.000Z",
    confidence: 95,
    evidence: [verifiedOfficialEvidence({ url: "https://www.ea.com/games/ea-sports-fc/fc-27/news/official" })],
  });
  const result = radar.propagateResolvedEventGroups(candidates, [signal("polymarket:1"), signal("polymarket:2")], now);
  assert.deepEqual(result.slice(0, 2).map((candidate) => candidate.verification_status), ["needs_review", "needs_review"]);
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
  const names = ["Kylian Mbappe", "Erling Haaland", "Ousmane Dembele"];
  const children = names.map((name) => ({ question: `Will ${name} be on the cover of EA Sports FC 27?` }));
  const candidates = names.map((name) => ({
    source_question: `Will ${name} be on the cover of EA Sports FC 27?`,
    provider_payload: {
      canonical_event_children: children,
      canonical_event_children_total: children.length,
      canonical_event_children_complete: true,
    },
  }));
  const resolution = radar.detectOfficialCoverEventResolution(candidates, [verifiedOfficialEvidence({
    url: "https://www.ea.com/games/ea-sports-fc/ea-play",
    title: "EA Sports FC EA Play - EA Official Site",
    supports: "The complete cover lineup for all EA SPORTS FC 27 editions shows Kylian Mbappe.",
  })]);
  assert.equal(resolution.winner_name, "Kylian Mbappe");
  assert.equal(resolution.evidence.length, 1);
  assert.equal(radar.detectOfficialCoverEventResolution(candidates, [{
    source_type: "public",
    url: "https://example.com/rumor",
    supports: "EA Sports FC 27 cover art showing Kylian Mbappe.",
  }]), null);
  assert.equal(radar.detectOfficialCoverEventResolution(candidates, [{
    ...verifiedOfficialEvidence(),
    url: "https://www.ea.com/games/college-football-27",
    supports: "College Football 27 cover art showing Kylian Mbappe.",
  }]), null);
});

test("el consenso oficial de una familia de portada incluye opciones reutilizadas", () => {
  const officialEvidence = [verifiedOfficialEvidence({
    url: "https://www.ea.com/games/madden-nfl/madden-nfl-27/news/welcome-to-madden-27",
    supports: "The complete cover lineup for all Madden NFL 27 editions has been selected.",
    selection_complete: true,
    supported_reason_codes: ["EVENT_ALREADY_RESOLVED"],
    supported_fact_statuses: ["fully_resolved"],
  })];
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

test("la Edge indexa todas las series gaming y esports de Kalshi antes de enumerar familias", () => {
  assert.match(edge, /new URL\(`\$\{KALSHI_API_ROOT\}\/series`\)/);
  assert.match(edge, /include_product_metadata", "true"/);
  assert.match(edge, /include_volume", "true"/);
  assert.match(edge, /\.map\(\(tag\) => cleanText\(tag, 100\)\)\.filter\(Boolean\)\.sort\(compareUtf16Text\)/);
  assert.match(edge, /classifyKalshiRadarSeriesCatalogV2/);
  assert.match(edge, /providerCatalogHash/);
  assert.match(edge, /search\/tags_by_categories/);
  assert.match(edge, /MAX_KALSHI_SERIES = 2_000/);
  assert.match(edge, /category: "Entertainment", tag: "Video games"/);
  assert.match(edge, /category: "Sports", tag: "Esports"/);
  assert.match(edge, /external-api\.kalshi\.com\/trade-api\/v2/);
  assert.match(edge, /with_nested_markets", "false"/);
  assert.match(edge, /min_close_ts/);
  assert.match(edge, /limit", "200"/);
  assert.match(edge, /KALSHI_CONCURRENCY = 2/);
  assert.match(edge, /checkpointRadarProviderDiscovery/);
  assert.match(edge, /RADAR_PROVIDER_DISCOVERY_CHECKPOINTED/);
  assert.match(edge, /record_market_radar_provider_selection_v2/);
  assert.doesNotMatch(edge, /MAX_KALSHI_SERIES = (?:4|25)/);
});

test("una taxonomía o serie Kalshi fallida no derriba el alcance sano ni desaparece", () => {
  assert.match(edge, /const checkpointFailedTaxonomyScopes = toRecordArray/);
  assert.match(edge, /const taxonomyRetryResults = await mapWithConcurrency/);
  assert.match(edge, /failed_taxonomy_scope_count: failedTaxonomyScopes\.length/);
  assert.match(edge, /failed_taxonomy_scopes: failedTaxonomyScopes/);
  assert.match(edge, /retryable_failed_series_ids/);
  assert.match(edge, /status: "rejected"[\s\S]*error_code:[\s\S]*events: \[\]/);
  assert.match(edge, /advanceProviderDiscoveryCheckpointV2/);
  assert.match(edge, /exhausted_failed_series_ids/);
  assert.doesNotMatch(edge, /if \(!indexedEvents\.length && failedSeriesIds\.length\) throw new Error\("PROVIDER_UNAVAILABLE"\)/);
  assert.match(edge, /failed_series_count: failedSeriesIds\.length/);
  assert.match(edge, /failed_series_ids: failedSeriesIds/);
  assert.match(edge, /const failedSeriesRetryResults = await mapWithConcurrency/);
  assert.match(edge, /else recoveredEvents\.push\(\.\.\.result\.value\)/);
  assert.match(edge, /provider_scope_partial: failedTaxonomyScopes\.length > 0[\s\S]{0,100}failedSeriesIds\.length > 0 \|\| failedParentIds\.length > 0/);
  assert.match(edge, /RADAR_PROVIDER_SERIES_PARTIAL/);
  assert.match(edge, /failedTaxonomyScopes[\s\S]{0,180}taxonomía/);
  assert.match(edge, /se reintentarán sin descartar las familias sanas/);
});

test("Polymarket busca las seis temáticas abiertas y deduplica padres antes de enumerar", () => {
  for (const query of [
    "video game release delay", "gaming event game awards",
    "video game studio publisher", "gaming streamer Twitch",
    "video game Metacritic Game Awards", "gaming YouTube creator",
  ]) assert.match(edge, new RegExp(query));
  assert.match(edge, /return RADAR_CATEGORIES\.map/);
  assert.match(edge, /const eventsByIdentity = new Map<string, JsonRecord>\(\)/);
  assert.match(edge, /failed_search_categories: failedSearchCategories/);
  assert.doesNotMatch(edge, /filters\.query \|\| categoryQueries\[filters\.category\] \|\| "video game gaming"/);
});

test("la respuesta pública resume el ledger de hasta 2000 padres sin duplicar sus IDs", () => {
  const projector = edge.slice(
    edge.indexOf("function projectProviderSelectionForResponse"),
    edge.indexOf("const POLYMARKET_CATEGORY_QUERIES"),
  );
  assert.match(projector, /delete projected\.selected_parent_ids/);
  assert.match(projector, /delete projected\.deferred_parent_ids/);
  assert.match(projector, /parent_identity_sample_limit: 8/);
  assert.match(projector, /provider_selection_ledger_complete/);
  assert.match(edge, /providerSelections\.push\(\{[\s\S]*projectProviderSelectionForResponse/);
});

test("la Edge valida evento y pertenencia del hijo en Polymarket", () => {
  assert.match(edge, /events\/slug\//);
  assert.match(edge, /enumeratePolymarketEventChildren/);
  assert.match(edge, /sameProviderMarketIdentitySet\("polymarket", slugMarkets, idMarkets\)/);
  assert.match(edge, /markets\/keyset/);
  assert.match(edge, /provider_pagination_exhausted: exactAgreement/);
  assert.match(edge, /parent_reconciliation_source_refs: refs/);
  assert.doesNotMatch(edge, /polymarket\.com\/es\//);
});

test("Tavily se consulta una vez por evento padre y el contrato IA dormido queda centralizado", () => {
  const researchSource = edge.slice(
    edge.indexOf("async function researchGroupsWithTavily"),
    edge.indexOf("function officialEventResolutionSignals"),
  );
  assert.match(edge, /groupCandidates\(candidates\)/);
  assert.match(edge, /evidenceByGroup/);
  assert.match(edge, /include_domains/);
  assert.doesNotMatch(edge, /GEMINI_MODEL|GEMINI_API_KEY|generativelanguage\.googleapis\.com|:generateContent/);
  assert.match(aiTaskPolicy, /radar_candidate_enrichment:[\s\S]*?dataClass: "public_market"/);
  assert.match(edge, /mapWithConcurrency\(groups, TAVILY_CONCURRENCY/);
  assert.match(edge, /get_market_radar_authoritative_source_domains_v1/);
  assert.match(edge, /childQuestions/);
  assert.match(edge, /const factTerms =/);
  assert.match(edge, /official announced revealed selected winner result complete lineup/);
  assert.match(edge, /selectionSubject[\s\S]*official \$\{selectionSubject\} cover reveal cover stars standard ultimate deluxe complete lineup/);
  assert.match(edge, /:\s*`\$\{factTerms\} \$\{group\.title\} \$\{childQuestions\}`/);
  assert.doesNotMatch(researchSource, /for \(const candidate of candidates\)/);
});

test("los descartes deterministas no consumen el enriquecedor y Kalshi reconcilia resultados", () => {
  assert.match(edge, /evaluateProviderEligibility\(classifiedCandidate, now\)/);
  assert.match(edge, /projectRadarDomainReview\(candidate, humanReview\)/);
  assert.equal(typeof radar.projectRadarDomainReview, "function");
  assert.match(edge, /const scanCandidates = candidates\.filter\(\(candidate\) => candidate\.eligibility_status === "eligible"\)/);
  assert.match(edge, /applyDeterministicRadarEligibility\(classifiedCandidate, providerDecision, now\)/);
  assert.match(edge, /MAX_REJECTED_OUTCOME_RECONCILIATIONS = 16/);
  assert.match(edge, /historical\/markets/);
  assert.match(edge, /reconcileRejectedKalshiOutcomes/);
  assert.match(edge, /reconciled_provider_results/);
});

test("la caché solo conserva decisiones de elegibilidad vigentes", () => {
  assert.match(edge, /function hasCurrentEligibility/);
  assert.match(edge, /filter\(\(candidate\) => filters\.quality !== "fit" \|\| hasCurrentEligibility\(candidate, checkedAt\)\)/);
  assert.match(edge, /list_market_radar_candidates_v5/);
  assert.match(edge, /requires_eligibility_refresh: !cachedAuthoritative/);
  assert.match(edge, /stage_market_radar_refresh_batch_v1/);
});

test("la vista solo expone candidatas evaluadas con la política predictiva vigente", () => {
  assert.match(edge, /filter\(\(candidate\) => cleanText\(candidate\.eligibility_policy_version, 80\) === RADAR_ELIGIBILITY_POLICY_VERSION\)/);
  assert.match(edge, /applyDeterministicRadarEligibility\(classifiedCandidate, providerDecision, now\)/);
  assert.doesNotMatch(edge, /canApplyPredictivePolicyOverride/);
});

test("Radar no ejecuta IA y conserva contadores de verificación deterministas", () => {
  assert.doesNotMatch(edge, /finalizeProviderRefresh\([\s\S]*?"gemini"/);
  assert.doesNotMatch(edge, /persistProcessorPartialFailure|verifyAndAdaptWithGemini|verifyGeminiBatch/);
  assert.match(edge, /let processedVerificationCount = 0/);
  assert.match(edge, /let failedVerificationBatches = 0/);
  assert.match(edge, /deferred_verification_count: deferredVerificationCount/);
});

test("la preparación revalida proveedor y aplica elegibilidad en una transacción autoritativa", () => {
  assert.match(edge, /NORMALIZER_OUTDATED/);
  assert.match(edge, /ELIGIBILITY_POLICY_OUTDATED/);
  assert.match(edge, /ELIGIBILITY_EXPIRED/);
  assert.match(edge, /revalidatePolymarketCandidate/);
  assert.match(edge, /revalidateKalshiCandidate/);
  assert.match(edge, /revalidateCandidateForPreparation/);
  assert.match(edge, /apply_market_radar_prepare_eligibility_v4/);
  assert.match(edge, /expected_preparation_revision_input/);
  assert.match(edge, /PREPARATION_REVISION_MISMATCH/);
  assert.match(edge, /candidatePreflight/);
  assert.match(edge, /refreshCandidateCacheLease/);
  assert.match(edge, /applyDeterministicRadarEligibility/);
  assert.match(edge, /researchGroupsWithTavily\([\s\S]*?environment\.tavilyKey,[\s\S]*?\[eligibility\]/);
  assert.doesNotMatch(edge, /if \(action === "revalidate"\)/);
  assert.match(edge, /prepareRevalidationError/);
  assert.match(edge, /RESOLUTION_SOURCE_REQUIRED/);
  assert.match(edge, /const authoritativeCandidate = toRecord\(applied\.candidate\)/);
  assert.match(edge, /eligibility_check_input: eligibilityCheck/);
  assert.match(edge, /const readiness = candidateReady\(authoritativeCandidate\)/);
  assert.match(edge, /some\(\(match\) => isBlockingDuplicateMatch\(match\)\)/);
  assert.doesNotMatch(edge, /some\(isBlockingDuplicateMatch\)/);
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

test("el historial usa slug solo como fallback único y nunca sobre IDs fuertes", () => {
  assert.match(edge,/const fallbackSlugs = new Map/);
  assert.match(edge,/if \(!strongIdentities\.length && childSlug\)/);
  assert.match(edge,/if \(fallback\.count !== 1\) continue/);
  assert.match(edge,/const rowIdentities = strongRowIdentities\.length[\s\S]*?: rowSlug/);
  assert.match(edge,/token_ids_input: \[\.\.\.tokenIds\]/);
});

test("la revalidación factual admite needs_review sin abrir una puerta de publicación", () => {
  assert.match(revalidationMigration, /candidate\.state not in \('available', 'needs_review', 'prepared'\)/);
  assert.match(revalidationMigration, /private\.insert_market_radar_fact_check_v2/);
  assert.match(revalidationMigration, /expected_preparation_revision_input/);
  assert.match(revalidationMigration, /candidate\.preparation_revision <> expected_preparation_revision_input/);
  assert.match(revalidationMigration, /when final_verification_status = 'verified_open' then 'available'/);
  assert.match(revalidationMigration, /else 'rejected'/);
  assert.doesNotMatch(revalidationMigration, /publish_market|insert into public\.markets|predictions|karma|prestige|market_maker_state/i);
});

test("las RPC privadas conservan permisos mínimos y autorización administrativa", () => {
  assert.match(baseMigration, /revoke all on table private\.external_market_candidates from public, anon, authenticated/);
  assert.match(v2Migration, /private\.require_current_admin\(\)/);
  assert.match(v2Migration, /grant execute on function public\.upsert_market_radar_batch_v2[\s\S]+to service_role/);
  assert.match(v2Migration, /grant execute on function public\.list_market_radar_candidates_v2[\s\S]+to authenticated/);
  assert.doesNotMatch(v2Migration, /grant all on table private\.external_market_candidates to service_role/);
});

test("la lectura Radar excluye por identidad exacta mercados y borradores activos", () => {
  assert.match(visibilityMigration, /candidate\.family_version = 'atinara-market-family-v4'/);
  assert.match(visibilityMigration, /not exists \([\s\S]*from public\.markets market_alias[\s\S]*market_alias\.family_child_key = candidate\.family_child_key/);
  assert.match(visibilityMigration, /not exists \([\s\S]*from private\.market_drafts draft_alias[\s\S]*draft_alias\.radar_candidate_id = candidate\.id/);
  assert.match(visibilityMigration, /draft_alias\.workflow_status not in \('cancelled', 'annulled'\)/);
  assert.doesNotMatch(visibilityMigration, /predictions|market_maker_state|market_price_history|profiles/i);
});

test("ninguna RPC del Radar publica, resuelve o crea participaciones", () => {
  assert.doesNotMatch(v2Migration, /insert into public\.predictions/i);
  assert.doesNotMatch(v2Migration, /publish_market_draft\(/i);
  assert.doesNotMatch(edge, /publish-scheduled-markets|place_prediction|resolve_market/i);
});

test("la interfaz agrupa por evento, separa fuentes y audita rechazados", () => {
  assert.match(adminUi, /radarGroupMarkup/);
  assert.match(adminUi, /top_candidates/);
  assert.match(adminUi, /data-radar-toggle-group/);
  assert.match(adminUi, /expandedGroups: new Set\(\)/);
  assert.match(adminUi, /setInterval\(updateRadarCooldownButton, 500\)/);
  assert.match(adminUi, /Probabilidad del proveedor:/);
  assert.match(adminUi, /Abrir evento original/);
  assert.match(adminUi, /Abrir mercado original/);
  assert.match(adminUi, /Abrir fuente de resolución/);
  assert.match(adminUi, /candidate\.atinara_resolution_source_url \|\| candidate\.source_resolution_url/);
  assert.match(adminUi, /Auditoría de elegibilidad/);
  assert.match(adminUi, /verification_status === "verified_open"/);
  assert.match(adminUi, /data-child-count/);
  assert.match(adminUi, /data-radar-rejection-filter/);
  assert.match(adminUi, /RADAR_REASON_LABELS/);
  assert.match(adminUi, /RADAR_SCORE_LABELS/);
  assert.match(adminUi, /Criterio anterior/);
  assert.match(adminUi, /radarCandidatePolicyCurrent/);
  assert.match(adminUi, /radarBlockingDuplicateMatches/);
  assert.match(adminUi, /\["exact_duplicate", "semantic_duplicate"\]/);
  assert.match(adminUi, /edgeInvocationError/);
  assert.match(adminUi, /window\.atinaraMarketAdminBridge/);
  assert.match(adminAgentBridge, /await bridge\.prepareRadarCandidate\(candidateId, \{ throwOnError: true \}\)/);
  assert.match(adminAgentBridge, /await bridge\.refreshRadarExpertAnalysis\(candidateId/);
  assert.match(adminAgentBridge, /packageMatchesPreparation\(pkg, preparationRevision\)/);
  assert.doesNotMatch(adminHtml, /debe conservar una verificación factual vigente antes de abrir el formulario/);
  assert.match(adminUi, /class="primary-button" type="button" data-radar-details/);
  assert.match(styles, /radar-event-card\[data-child-count="1"\][\s\S]*grid-column:\s*1 \/ -1/);
  assert.match(styles, /radar-rejection-filter/);
  assert.match(adminHtml, /v=20260827-radar-editor-bridge1/);
  assert.doesNotMatch(adminHtml, /v=20260811-expert-cycle3/);
  assert.doesNotMatch(adminHtml, /v=20260809-expert-cycle2/);
  assert.doesNotMatch(adminHtml, /v=20260806-radar2/);
});

test("la respuesta discovery proyecta expedientes ligeros y limita por padres completos", () => {
  const resolutionUrl = "https://www.thegameawards.com/nominees/game-of-the-year";
  const candidates = Array.from({ length: 24 }, (_, index) => ({
    id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    provider: "kalshi",
    external_id: `kxgameawards-2026-${index}`,
    external_event_id: `kxgameawards-parent-${Math.floor(index / 4)}`,
    event_group_key: `kalshi:kxgameawards-parent-${Math.floor(index / 4)}`,
    family_key: `atinara:v4:tga-${Math.floor(index / 4)}:outcome`,
    family_child_key: `option:game-${index}`,
    family_child_label: `Game ${index}`,
    source_title: `The Game Awards 2026 ${"x".repeat(900)}`,
    source_question: `¿Ganará Game ${index} el premio?`,
    source_close_at: "2027-12-31T15:00:00Z",
    source_probability_yes: null,
    atinara_category: "Reviews/Premios",
    atinara_group_title: `The Game Awards · Familia ${Math.floor(index / 4)}`,
    quality_score: 90 - index,
    parent_rank: Math.floor(index / 4) + 1,
    state: "available",
    normalizer_version: "atinara-radar-v3",
    verification_status: "verified_open",
    eligibility_status: "eligible",
    eligibility_policy_version: "atinara-prediction-policy-v5",
    eligibility_checked_at: "2026-08-22T17:00:00Z",
    eligibility_expires_at: "2026-08-23T17:00:00Z",
    current_eligibility_check_id: index + 1,
    atinara_resolution_source_url: resolutionUrl,
    resolution_source_evidence: [{
      url: resolutionUrl,
      source_type: "official",
      retrieval_status: "verified_content",
      evidence_basis: "retrieved_content",
      claim_status: "direct",
      direct_claim: true,
      supports: "z".repeat(20_000),
    }],
    provider_payload: { raw: "p".repeat(30_000) },
    source_agent_execution: { raw: "a".repeat(20_000) },
    duplicate_matches: [],
  }));
  const groups = radar.groupCandidates(candidates);
  const projected = radar.projectRadarDiscoveryView({
    groups,
    candidates,
    rejected: { total: 0, counts: {}, items: [] },
    providers: [],
    page: { parent_count: groups.length, parent_offset: 0, parent_limit: 60, next_parent_offset: null },
  });

  assert.equal(projected.candidate_count, candidates.length);
  assert.equal(projected.candidates[0].id, candidates[0].id);
  assert.equal(projected.candidates[0].provider_payload, undefined);
  assert.equal(projected.groups[0].candidates.length, 4);
  assert.equal(projected.groups[0].candidates[0].source_probability_yes, null);
  assert.equal(projected.groups[0].candidates[0].resolution_source_proven, true);
  assert.equal(projected.groups[0].candidates[0].resolution_source_evidence.length, 1);
  assert.equal(projected.groups[0].candidates[0].resolution_source_evidence[0].supports, undefined);
  assert.equal("provider_payload" in projected.groups[0].candidates[0], false);
  assert.equal("source_agent_execution" in projected.groups[0].candidates[0], false);
  assert.equal("top_candidates" in projected.groups[0], false);

  const constrained = radar.constrainRadarDiscoveryPayload({
    ok: true,
    ...projected,
    diagnostic_padding: "d".repeat(45_000),
  }, 64_000);
  assert.equal(constrained.fits, true);
  assert.ok(constrained.omitted_parent_count > 0);
  assert.ok(constrained.bytes <= 64_000);
  assert.ok(constrained.payload.groups.every((group) => group.candidates.length === 4));
  assert.equal(
    constrained.payload.page.next_parent_offset,
    constrained.payload.groups.length,
  );
  assert.equal(constrained.payload.candidate_count, constrained.payload.groups.length * 4);
});

test("una candidata preparada admite una comprobación de elegibilidad tipada y conserva español UTF-8", () => {
  assert.match(edge, /\["available", "needs_review", "prepared"\]\.includes\(state\)/);
  assert.match(edge, /phase: "eligibility_check"/);
  assert.match(edge, /state_preserved: true/);
  assert.match(edge, /class RadarRevalidationOutcomeError/);
  assert.match(edge, /authoritative_state_updated: true/);
  assert.match(adminUi, /wrapped\.authoritativeStateUpdated = payload\?\.authoritative_state_updated === true/);
  assert.match(adminUi, /removeVisibleRadarCandidate\(candidateId\)/);
  assert.match(adminUi, /function replaceVisibleRadarCandidate\(candidate\)/);
  assert.match(adminUi, /if \(terminal\)/);
  assert.match(adminUi, /replaceVisibleRadarCandidate\(error\.candidate\)/);
  assert.doesNotMatch(marketExpertEdge, /Actualizar comprobación factual y reanalizar/);
  assert.match(edge, /if \(action === "check-eligibility"\)/);
});

test("la evidencia oficial enlazada completa portadas sin depender de un resultado exacto del buscador", () => {
  assert.match(edge, /extractOfficialRelatedUrls/);
  assert.match(edge, /MAX_RELATED_OFFICIAL_SOURCE_URLS_PER_GROUP = 3/);
  assert.match(edge, /const relatedTargets:/);
  assert.match(edge, /page\.relatedUrls/);
  assert.match(edge, /fetchVerifiedOfficialPage\([\s\S]*?target\.url,[\s\S]*?authoritativeDomains,[\s\S]*?relatedDeadlineAt,[\s\S]*?environment\.execution\.signal/);
  assert.match(edge, /MAX_SELECTION_FOLLOWUP_GROUPS = 4/);
  assert.match(edge, /const incompleteSelectionGroups = groups\.filter/);
  assert.match(edge, /const incompleteMetricGroups = groups\.filter/);
  assert.match(edge, /official "\$\{subject\}" release date launch date/);
  assert.match(edge, /item\.supported_contract_kinds\.includes\("review"\)/);
  assert.match(edge, /const terminalEvidence = exactEvidence\.filter/);
  assert.match(edge, /const groupSelectionHold = groupSelectionHolds\.get/);
  assert.match(edge, /if \(groupResolution \|\| terminalEvidence\.length\)/);
  assert.match(edge, /include_raw_content: false/);
  assert.match(edge, /fetchVerifiedOfficialPage\([\s\S]*?target\.url,[\s\S]*?authoritativeDomains,[\s\S]*?followupDeadlineAt,[\s\S]*?environment\.execution\.signal/);
  assert.doesNotMatch(edge, /EA Sports FC 27|Big Walk|Marvel Tokon/i);
});

test("el frontend nunca consulta directamente proveedores ni introduce secretos", () => {
  assert.match(adminUi, /client\.functions\.invoke\("market-radar"/);
  assert.doesNotMatch(adminUi, /gamma-api\.polymarket|api\.elections\.kalshi|api\.tavily/);
  assert.doesNotMatch(adminUi, /TAVILY_API_KEY|GEMINI_API_KEY|service_role/i);
});

test("los límites, timeout y refresco siguen acotados sin Cron", () => {
  assert.match(edge, /MAX_PROVIDER_PAGES = 50/);
  assert.match(edge, /MAX_NORMALIZED_PER_PROVIDER = 480/);
  assert.match(edge, /buildRadarPersistenceBatches\(entries/);
  assert.match(edge, /MAX_VISIBLE_GROUPS = 60/);
  assert.match(edge, /RADAR_DISCOVERY_RESPONSE_BUDGET_BYTES/);
  assert.equal(radar.RADAR_DISCOVERY_RESPONSE_BUDGET_BYTES, 900_000);
  assert.match(edge, /projectRadarDiscoveryView/);
  assert.match(edge, /constrainRadarDiscoveryPayload/);
  assert.match(edge, /RADAR_RESPONSE_BUDGET_EXCEEDED/);
  assert.match(edge, /MAX_AI_ENRICHMENT_GROUPS = 30/);
  assert.match(edge, /MAX_AI_ENRICHMENT_CANDIDATES = 180/);
  assert.match(edge, /AI_ENRICHMENT_BATCH_SIZE = 9/);
  assert.match(edge, /REFRESH_COOLDOWN_MS = 60_000/);
  assert.match(aiModelCatalog, /"gemini\.legacy\.radar"/);
  assert.match(aiTaskPolicy, /radar_candidate_enrichment:[\s\S]*?timeoutMs: 20_000/);
  assert.doesNotMatch(edge, /GEMINI_MODEL|GEMINI_API_KEY|generativelanguage\.googleapis\.com|:generateContent/);
  assert.match(edge, /selectVerifiedResolutionUrl\(candidate, evidence, authoritativeDomains\)/);
  assert.match(edge, /const groupResolutions = new Map\(officialEventResolutionSignals/);
  assert.match(edge, /officialEventResolutionSignals\(candidates, evidenceByGroup, now\)/);
  assert.match(edge, /cooldown_until:\s*new Date\(Date\.now\(\) \+ REFRESH_COOLDOWN_MS\)\.toISOString\(\)/);
  assert.match(edge, /requires_eligibility_refresh: responseCandidates\.length === 0/);
  assert.doesNotMatch(edge, /Devuelve exactamente un elemento por external_id/);
  assert.doesNotMatch(edge, /maxLength:/);
  assert.doesNotMatch(edge, /temperature:/);
  assert.doesNotMatch(edge, /cron|setInterval/i);
});
