const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { pathToFileURL } = require("node:url");
const { test, before } = require("node:test");

const root = join(__dirname, "..");
const corePath = join(root, "supabase/functions/_shared/market-radar.mjs");
const edge = readFileSync(join(root, "supabase/functions/market-radar/index.ts"), "utf8");
const migration = readFileSync(join(root, "supabase/migrations/20260804194933_add_market_radar.sql"), "utf8");
const adminUi = readFileSync(join(root, "admin-markets.js"), "utf8");
let radar;

before(async () => {
  radar = await import(pathToFileURL(corePath).href);
});

const now = "2026-08-04T12:00:00.000Z";

function validPolymarket(overrides = {}) {
  return {
    id: "poly-gaming-1",
    slug: "game-awards-goty-2026",
    question: "Will Hollow Knight Silksong be nominated for Game of the Year 2026?",
    description: "Resolves according to the official Game Awards nominees.",
    rules: "Yes if the official nominees include Hollow Knight Silksong; otherwise No.",
    resolutionSource: "https://thegameawards.com/nominees",
    outcomes: "[\"Yes\",\"No\"]",
    outcomePrices: "[\"0.45\",\"0.55\"]",
    endDate: "2026-11-01T22:59:00Z",
    active: true,
    closed: false,
    acceptingOrders: true,
    volume24hr: "1250.50",
    volumeNum: "8100.25",
    liquidityNum: "2200",
    updatedAt: "2026-08-03T10:00:00Z",
    ...overrides
  };
}

function validKalshi(overrides = {}) {
  return {
    ticker: "KXGAMEAWARDS-26-GOTY",
    event_ticker: "KXGAMEAWARDS-26",
    title: "Will a video game studio win Game of the Year 2026?",
    rules_primary: "Resolves Yes if the official Game Awards winner matches the named studio.",
    rules_secondary: "A cancelled ceremony resolves according to the published rulebook.",
    status: "open",
    close_time: "2026-12-01T22:59:00Z",
    yes_bid_dollars: "0.42",
    yes_ask_dollars: "0.46",
    last_price_dollars: "0.44",
    volume_24h_fp: "500.25",
    volume_fp: "5000.75",
    open_interest_fp: "750.50",
    liquidity_dollars: "1200.00",
    updated_time: "2026-08-03T10:00:00Z",
    ...overrides
  };
}

test("Polymarket normaliza un mercado binario, números string y paginación", () => {
  const result = radar.adaptPolymarketResponse({ data: [validPolymarket()], after_cursor: "next-page" }, { now });
  assert.equal(result.candidates.length, 1);
  assert.equal(result.cursor, "next-page");
  assert.equal(result.candidates[0].source_probability_yes, 0.45);
  assert.equal(result.candidates[0].source_volume_total, 8100.25);
  assert.equal(result.candidates[0].provider, "polymarket");
});

test("Polymarket identifica Sí aunque los outcomes estén invertidos", () => {
  const result = radar.adaptPolymarketResponse([
    validPolymarket({ outcomes: "[\"No\",\"Yes\"]", outcomePrices: "[\"0.61\",\"0.39\"]" })
  ], { now });
  assert.equal(result.candidates[0].source_probability_yes, 0.39);
});

test("Polymarket rechaza outcomes malformados, cierre, fecha ausente y tema no gaming", () => {
  const malformed = radar.adaptPolymarketResponse([validPolymarket({ outcomePrices: "not-json" })], { now });
  const closed = radar.adaptPolymarketResponse([validPolymarket({ closed: true })], { now });
  const noDate = radar.adaptPolymarketResponse([validPolymarket({ endDate: null })], { now });
  const politics = radar.adaptPolymarketResponse([validPolymarket({ question: "Will the president win the election?", description: "Politics", rules: "Official election result" })], { now });
  assert.equal(malformed.rejected.length, 1);
  assert.equal(closed.rejected.length, 1);
  assert.equal(noDate.rejected.length, 1);
  assert.equal(politics.rejected.length, 1);
});

test("Polymarket tolera respuesta parcial y JSON raíz array", () => {
  const partial = radar.adaptPolymarketResponse([null, {}, validPolymarket()], { now });
  assert.equal(partial.candidates.length, 1);
});

test("Kalshi normaliza reglas, bid/ask, fixed point y cursor", () => {
  const result = radar.adaptKalshiResponse({ markets: [validKalshi()], cursor: "kalshi-next" }, { now });
  const candidate = result.candidates[0];
  assert.equal(result.cursor, "kalshi-next");
  assert.equal(candidate.source_probability_yes, 0.44);
  assert.match(candidate.source_resolution_rules, /cancelled ceremony/);
  assert.equal(candidate.source_volume_total, 5000.75);
  assert.equal(candidate.source_open_interest, 750.5);
});

test("Kalshi usa último precio cuando no hay midpoint y avisa si no hay precio", () => {
  const last = radar.adaptKalshiResponse({ markets: [validKalshi({ yes_bid_dollars: null, yes_ask_dollars: null, last_price_dollars: "0.37" })] }, { now });
  const missing = radar.adaptKalshiResponse({ markets: [validKalshi({ ticker: "KXGAME-2", yes_bid_dollars: null, yes_ask_dollars: null, last_price_dollars: null })] }, { now });
  assert.equal(last.candidates[0].source_probability_yes, 0.37);
  assert.equal(missing.candidates[0].source_probability_yes, null);
  assert.match(missing.candidates[0].warnings.join(" "), /precio utilizable/i);
});

test("Kalshi rechaza mercado cerrado, evento no gaming y respuesta parcial", () => {
  const closed = radar.adaptKalshiResponse({ markets: [validKalshi({ status: "closed" })] }, { now });
  const finance = radar.adaptKalshiResponse({ markets: [validKalshi({ title: "Will the Federal Reserve cut the interest rate?" })] }, { now });
  const partial = radar.adaptKalshiResponse({ markets: [null, {}, validKalshi()] }, { now });
  assert.equal(closed.rejected.length, 1);
  assert.equal(finance.rejected.length, 1);
  assert.equal(partial.candidates.length, 1);
});

test("Tavily solo queda utilizable cuando la adaptación demuestra pregunta, fecha, fuente y criterios", () => {
  const result = radar.adaptTavilyResults({
    results: [{
      title: "Video game release date announced for Hollow Knight Silksong",
      url: "https://example.com/gaming/silksong-release",
      content: "The studio published an official release date."
    }]
  }, { now, tags: ["Lanzamientos"] });
  const candidate = result.candidates[0];
  assert.equal(radar.isAdaptedIdeaComplete(candidate), false);
  const adapted = radar.applyAdaptation(candidate, {
    external_id: candidate.external_id,
    atinara_category: "Lanzamientos",
    atinara_question_es: "¿Hollow Knight: Silksong se lanzará antes del 31 de diciembre de 2026?",
    atinara_resolution_criteria_es: "Sí si el estudio publica el juego antes de finalizar el periodo; No en caso contrario.",
    atinara_resolution_source_url: "https://example.com/gaming/silksong-release",
    atinara_closes_at: "2026-12-31T22:59:00Z"
  });
  assert.equal(radar.isAdaptedIdeaComplete(adapted), true);
});

test("la entrada de Gemini queda acotada y elimina campos innecesarios", () => {
  const compact = radar.compactGeminiCandidate({
    provider: "polymarket",
    external_id: "poly-gaming-1",
    source_title: "T".repeat(500),
    source_question: "Q".repeat(500),
    source_description: "D".repeat(4000),
    source_resolution_rules: "R".repeat(6000),
    source_resolution_url: "https://example.com/rules",
    source_close_at: "2026-12-01T22:59:00Z",
    source_tags: Array.from({ length: 20 }, (_, index) => `tag-${index}`),
    source_volume_total: 5000,
    private_field: "never-send"
  });
  assert.equal(compact.source_title.length, 300);
  assert.equal(compact.source_question.length, 300);
  assert.equal(compact.source_description.length, 900);
  assert.equal(compact.source_resolution_rules.length, 1800);
  assert.equal(compact.source_tags.length, 12);
  assert.equal("source_volume_total" in compact, false);
  assert.equal("private_field" in compact, false);
});

test("Gemini interpreta texto dividido y descarta partes de razonamiento", () => {
  const result = radar.parseGeminiAdaptations({
    candidates: [{
      content: {
        parts: [
          { thought: true, text: "razonamiento privado" },
          { text: '[{"external_id":"poly-' },
          { text: 'gaming-1"}]' }
        ]
      }
    }]
  });
  assert.deepEqual(result, [{ external_id: "poly-gaming-1" }]);
});

test("normalización descarta NaN, Infinity, protocolos inseguros y campos nulos", () => {
  assert.equal(radar.safeNumber("NaN"), null);
  assert.equal(radar.safeNumber(Infinity), null);
  assert.equal(radar.safeProbability("105"), null);
  assert.equal(radar.safeIsoDate("fecha imposible"), null);
  assert.equal(radar.safePublicUrl("javascript:alert(1)"), null);
  assert.equal(radar.safePublicUrl("https://127.0.0.1/private"), null);
  assert.equal(radar.safePublicUrl("https://[::1]/private"), null);
  assert.deepEqual(radar.safeStringArray(null), []);
});

test("normalización de texto conserva caracteres útiles y produce huella estable", () => {
  assert.equal(radar.normalizeComparableText("¿Sí: Átinara 2026?"), "atinara 2026");
  assert.equal(radar.stableFingerprint("Átinara", "2026"), radar.stableFingerprint("atinara", "2026"));
  assert.notEqual(radar.stableFingerprint("Atinara A"), radar.stableFingerprint("Atinara B"));
});

test("duplicados externos, por URL y por pregunta se clasifican como confirmados", () => {
  const candidate = radar.adaptPolymarketResponse([validPolymarket()], { now }).candidates[0];
  const matches = radar.detectDuplicates(candidate, [
    { provider: "polymarket", external_id: "poly-gaming-1", kind: "candidate" },
    { external_url: candidate.external_url, kind: "draft" },
    { question: candidate.source_question, kind: "market" }
  ]);
  assert.equal(matches.length, 3);
  assert.ok(matches.every((match) => match.status === "confirmed"));
});

test("una coincidencia semántica sugerida permanece posible y exige revisión humana", () => {
  const candidate = radar.adaptPolymarketResponse([validPolymarket()], { now }).candidates[0];
  candidate.duplicate_matches = [{
    status: "possible",
    reason: "Coincidencia semántica sugerida para revisión humana.",
    kind: "draft",
    id: "draft-existing-1"
  }];
  const scored = radar.scoreCandidates([candidate], [], now)[0];
  assert.equal(scored.quality_status, "needs_review");
  assert.ok(scored.duplicate_matches.some((match) => match.id === "draft-existing-1" && match.status === "possible"));
  assert.ok(!scored.duplicate_matches.some((match) => match.id === "draft-existing-1" && match.status === "confirmed"));
});

test("Atinara Score normaliza popularidad por proveedor y limita 0–100", () => {
  const poly = radar.adaptPolymarketResponse([validPolymarket()], { now }).candidates[0];
  const kalshi = radar.adaptKalshiResponse({ markets: [validKalshi()] }, { now }).candidates[0];
  const scored = radar.scoreCandidates([poly, kalshi], [], now);
  scored.forEach((candidate) => {
    assert.ok(candidate.quality_score >= 0 && candidate.quality_score <= 100);
    assert.deepEqual(Object.keys(candidate.score_breakdown), ["popularity", "relevance", "clarity", "recency", "uncertainty", "novelty"]);
    assert.ok(candidate.score_breakdown.popularity <= 30);
  });
});

test("Atinara Score funciona sin métricas y penaliza probabilidad extrema", () => {
  const noMetrics = radar.adaptKalshiResponse({ markets: [validKalshi({ volume_24h_fp: null, volume_fp: null, open_interest_fp: null, liquidity_dollars: null })] }, { now }).candidates[0];
  const scored = radar.scoreCandidates([noMetrics], [], now)[0];
  assert.equal(scored.score_breakdown.popularity, 0);
  assert.ok(scored.quality_score >= 0);
  const extreme = radar.adaptKalshiResponse({ markets: [validKalshi({ yes_bid_dollars: "0.99", yes_ask_dollars: "0.995" })] }, { now });
  assert.equal(extreme.rejected.length, 1);
});

test("pre-rellenado usa datos disponibles, deja huecos y nunca guarda o publica", () => {
  const candidate = radar.adaptPolymarketResponse([validPolymarket()], { now }).candidates[0];
  const adapted = radar.applyAdaptation(candidate, {
    external_id: candidate.external_id,
    atinara_category: "Reviews/Premios",
    atinara_question_es: "¿Hollow Knight: Silksong será nominado a juego del año 2026?",
    atinara_context_es: "La fuente oficial publicará las nominaciones.",
    atinara_resolution_criteria_es: "Sí si aparece en la lista oficial; No en caso contrario.",
    atinara_resolution_source_url: "https://thegameawards.com/nominees",
    atinara_closes_at: "2026-11-01T22:59:00Z"
  });
  const prefill = radar.buildDraftPrefill({ ...adapted, id: "candidate-id" });
  assert.equal(prefill.fields.category, "Reviews/Premios");
  assert.equal(prefill.fields.subject, "");
  assert.equal(prefill.fields.no_criteria, "");
  assert.equal(prefill.auto_saved, false);
  assert.equal(prefill.published, false);
  assert.equal(prefill.approved, false);
  assert.equal(prefill.scheduled, false);
});

test("la Edge Function impone JWT, rol admin, allowlist, timeout, backoff y fallo parcial", () => {
  assert.match(edge, /authorization\.startsWith\("Bearer "\)/);
  assert.match(edge, /appMetadata\.oraklo_admin !== true/);
  assert.match(edge, /RADAR_API_HOSTS\.includes/);
  assert.match(edge, /AbortController/);
  assert.match(edge, /attempt < 2/);
  assert.match(edge, /response\.status !== 429/);
  assert.match(edge, /partial: errors\.length > 0/);
  assert.match(edge, /semantic_duplicate/);
  assert.match(edge, /status: "possible"/);
  assert.doesNotMatch(edge, /body\.(?:url|external_url).*fetch/s);
  assert.doesNotMatch(edge, /console\.(?:log|error)\([^\n]*(?:authorization|apiKey|secretKey|JWT)/i);
});

test("el frontend no llama proveedores externos y conserva el formulario manual", () => {
  assert.match(adminUi, /client\.functions\.invoke\("market-radar"/);
  assert.doesNotMatch(adminUi, /gamma-api\.polymarket|external-api\.kalshi|api\.tavily/);
  assert.match(adminUi, /save_market_draft_from_radar/);
  assert.match(adminUi, /save_market_draft", args/);
  assert.match(adminUi, /auto(?:máticamente|maticamente)/i);
  assert.doesNotMatch(adminUi, /IGDB|igdb/, "IGDB futuro no debe aparecer como una fuente deshabilitada.");
  assert.doesNotMatch(adminUi, /innerHTML\s*=\s*(?:candidate|data\.)/);
});

test("la migración mantiene candidatos y procedencia privados con permisos mínimos", () => {
  assert.match(migration, /create table if not exists private\.external_market_candidates/);
  assert.match(migration, /unique \(provider, external_id\)/);
  assert.match(migration, /enable row level security/);
  assert.match(migration, /revoke all on table private\.external_market_candidates from public, anon, authenticated/);
  assert.match(migration, /grant select, insert, update on table private\.external_market_candidates to service_role/);
  assert.doesNotMatch(migration, /grant all on table private\.external_market_candidates to [^;]*service_role/);
  assert.match(migration, /grant execute on function public\.upsert_market_radar_batch[\s\S]+to service_role/);
  assert.match(migration, /private\.require_current_admin\(\)/);
  assert.match(migration, /source_provenance jsonb/);
  assert.match(migration, /'is_stale', candidate\.expires_at <= now\(\)/);
  assert.match(migration, /RADAR_DRAFT_PREPARED/);
  assert.match(migration, /state not in \('available', 'needs_review'\)|state not in \('available', 'needs_review'\)/);
});

test("ninguna RPC del Radar publica, aprueba, programa o crea participaciones", () => {
  assert.doesNotMatch(migration, /insert into public\.predictions/i);
  assert.doesNotMatch(migration, /publish_market_draft\(/i);
  assert.doesNotMatch(migration, /review_status\s*=\s*'approved'/i);
  assert.doesNotMatch(migration, /scheduled_for\s*=/i);
  assert.doesNotMatch(edge, /publish-scheduled-markets|place_prediction|resolve_market/i);
});

test("los límites internos evitan consumo accidental y no hay Cron", () => {
  assert.match(edge, /MAX_PROVIDER_PAGES = 1/);
  assert.match(edge, /MAX_NORMALIZED_PER_PROVIDER = 120/);
  assert.match(edge, /MAX_VISIBLE = 60/);
  assert.match(edge, /MAX_GEMINI_BATCH = 12/);
  assert.match(edge, /GEMINI_TIMEOUT_MS = 35_000/);
  assert.match(edge, /GEMINI_MAX_OUTPUT_TOKENS = 8_192/);
  assert.match(edge, /thinkingLevel: "minimal"/);
  assert.match(edge, /responseMimeType: "application\/json"/);
  assert.doesNotMatch(edge, /responseJsonSchema/);
  assert.match(edge, /REFRESH_COOLDOWN_MS = 60_000/);
  assert.match(edge, /horizon_filter: filters\.horizon/);
  assert.equal((edge.match(/adaptWithGemini\(environment\.geminiKey/g) || []).length, 1);
  assert.doesNotMatch(edge, /cron|setInterval/i);
});
