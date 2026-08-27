const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { pathToFileURL } = require("node:url");
const { test, before } = require("node:test");

const root = join(__dirname, "..");
const sharedPath = join(root, "supabase/functions/_shared/market-radar.mjs");
const edge = readFileSync(join(root, "supabase/functions/market-radar/index.ts"), "utf8");
const migration = readFileSync(join(
  root,
  "supabase/migrations/20260826190000_checkpoint_market_radar_global_catalog_v2.sql",
), "utf8");
let radar;

before(async () => {
  radar = await import(pathToFileURL(sharedPath).href);
});

const checkedAt = "2026-08-26T12:00:00.000Z";
const hash = (value = "a") => value.repeat(64).slice(0, 64);

function seriesFixture(index, overrides = {}) {
  return {
    ticker: `KX-GAMING-${String(index).padStart(3, "0")}`,
    title: `Video game series ${index}`,
    category: "Entertainment",
    tags: ["Video games"],
    taxonomy_scopes: [{ category: "Entertainment", tag: "Video games" }],
    catalog_signals: ["registered_gaming_taxonomy"],
    catalog_entity_matches: [],
    radar_themes: ["Industria"],
    inferred_atinara_category: "Industria",
    series_slug: `video-game-series-${index}`,
    settlement_sources: [{ url: "https://www.nintendo.com/" }],
    ...overrides,
  };
}

function buildCheckpoint(count) {
  return radar.buildProviderDiscoveryCheckpointV2({
    checked_at: checkedAt,
    catalog: {
      provider_catalog_hash: hash("a"),
      entity_terms_hash: hash("b"),
      entity_term_count: 3,
      total_provider_series_count: count + 13_000,
      provider_pagination_exhausted: true,
      provider_cursor: null,
    },
    series: Array.from({ length: count }, (_, index) => seriesFixture(index + 1)),
    max_series: 2_000,
    max_parents: 2_000,
    max_attempts: 4,
    max_bytes: 4_000_000,
  });
}

function fulfilled(seriesTicker, index, at = checkedAt) {
  return {
    series_ticker: seriesTicker,
    status: "fulfilled",
    checked_at: at,
    events: [{
      event_ticker: `EVENT-${String(index).padStart(3, "0")}`,
      series_ticker: seriesTicker,
      title: `Gaming parent ${index}`,
      strike_date: "2027-01-01T00:00:00.000Z",
    }],
  };
}

function rejected(seriesTicker, code = "PROVIDER_TIMEOUT", at = checkedAt) {
  return {
    series_ticker: seriesTicker,
    status: "rejected",
    checked_at: at,
    error_code: code,
    retry_after_at: null,
    events: [],
  };
}

function advance(checkpoint, results, sequence = checkpoint.sequence) {
  return radar.advanceProviderDiscoveryCheckpointV2(checkpoint, results, {
    previous_checkpoint_hash: hash(String((sequence % 9) + 1)),
    max_batch: 48,
    max_series: 2_000,
    max_parents: 2_000,
    max_attempts: 4,
    max_bytes: 4_000_000,
  });
}

test("el clasificador global cubre las seis temáticas actuales sin depender de la categoría del proveedor", () => {
  const cases = [
    ["Future video game release date and launch trailer", "Lanzamientos"],
    ["League of Legends esports tournament event", "Eventos"],
    ["Video game publisher acquisition and gaming studio layoffs", "Industria"],
    ["Twitch streamer viewers record for a Fortnite creator", "Streamers"],
    ["Metacritic review score and Game Awards GOTY nominee", "Reviews/Premios"],
    ["YouTube gaming creator subscriber record", "YouTubers"],
  ];
  for (const [title, expectedTheme] of cases) {
    const result = radar.classifyKalshiRadarSeriesCatalogV2({
      ticker: `KX-${expectedTheme}`,
      title,
      category: "Other",
      tags: [],
      product_metadata: { scope: title },
    });
    assert.equal(result.selected, true, title);
    assert.ok(result.signals.length > 0, title);
    assert.ok(result.radar_themes.includes(expectedTheme), `${title}: ${result.radar_themes}`);
  }
});

test("taxonomía registrada, entidades, industria y autoridades son señales generales auditables", () => {
  const taxonomy = radar.classifyKalshiRadarSeriesCatalogV2({
    ticker: "ARBITRARY", title: "Unknown future title", category: "Misc", tags: ["Video games"],
  });
  assert.ok(taxonomy.signals.includes("registered_gaming_taxonomy"));
  const official = radar.classifyKalshiRadarSeriesCatalogV2({
    ticker: "ARBITRARY-OFFICIAL", title: "Future product", category: "Companies", tags: [],
    settlement_sources: [{ url: "https://newsroom.nintendo.com/future-product" }],
  });
  assert.equal(official.selected, true);
  assert.ok(official.signals.includes("official_gaming_source"));
  const editorial = radar.classifyKalshiRadarSeriesCatalogV2({
    ticker: "ARBITRARY-REVIEW", title: "Critic score", category: "Entertainment", tags: [],
    settlement_sources: [{ url: "https://www.metacritic.com/game/example" }],
  });
  assert.ok(editorial.signals.includes("gaming_editorial_source"));
});

test("las entidades hermanas se derivan del catálogo acreditado sin títulos ni IDs hardcodeados", () => {
  const seeds = [
    { ticker: "SEED-1", title: "Asterion release window", tags: ["Video games"] },
    { ticker: "SEED-2", title: "Asterion review score", tags: ["Video games"] },
    {
      ticker: "CREATOR-ONLY", title: "Generic politician interview", tags: [],
      settlement_sources: [{ url: "https://www.youtube.com/watch?v=example" }],
    },
  ];
  const terms = radar.buildKalshiRadarCatalogEntityTermsV2(seeds);
  assert.ok(terms.includes("asterion"));
  assert.equal(terms.includes("politician"), false);
  const sibling = radar.classifyKalshiRadarSeriesCatalogV2({
    ticker: "SIBLING", title: "Will Asterion happen before bitcoin falls?", tags: [],
  }, { catalog_entity_terms: terms });
  assert.equal(sibling.selected, true);
  assert.ok(sibling.signals.includes("catalog_gaming_entity_match"));
  assert.deepEqual(sibling.catalog_entity_matches, ["asterion"]);
  assert.equal(radar.evaluateGamingDomain({
    source_title: "Will Asterion happen before bitcoin falls?",
  }).status, "review_required");
});

test("expansion geográfica o deportiva no se convierte en gaming por una palabra aislada", () => {
  for (const title of [
    "European Union expansion before 2030",
    "MLB expansion team announced before 2028",
    "Company expansion into three countries",
  ]) {
    assert.equal(radar.classifyKalshiRadarSeriesCatalogV2({
      ticker: "GENERIC", title, category: "Politics", tags: [],
    }).selected, false, title);
    assert.notEqual(radar.evaluateGamingDomain({ source_title: title }).status, "in_domain", title);
  }
  assert.equal(radar.evaluateGamingDomain({
    source_title: "Political console policy in the presidential election",
  }).status, "review_required");
  for (const source_title of [
    "Best music streamer on Twitch",
    "Top songs on YouTube TV",
    "Will a podcast host release an album?",
  ]) assert.equal(radar.evaluateGamingDomain({ source_title }).status, "review_required");
  assert.equal(radar.evaluateGamingDomain({
    source_title: "Best video game soundtrack and music score",
  }).status, "in_domain");
});

test("las fuentes de creadores y editoriales solo pesan en catálogos acotados", () => {
  const manyCreatorSources = Array.from({ length: 4 }, (_, index) => ({
    url: index === 0 ? "https://www.youtube.com/@example" : `https://example${index}.com/source`,
  }));
  assert.equal(radar.classifyKalshiRadarSeriesCatalogV2({
    ticker: "GENERIC", title: "Audience milestone", category: "Social", tags: [],
    settlement_sources: manyCreatorSources,
  }).selected, false);
  const manyEditorialSources = Array.from({ length: 7 }, (_, index) => ({
    url: index === 0 ? "https://www.ign.com/reviews/example" : `https://example${index}.com/source`,
  }));
  assert.equal(radar.classifyKalshiRadarSeriesCatalogV2({
    ticker: "GENERIC", title: "Critic score", category: "Entertainment", tags: [],
    settlement_sources: manyEditorialSources,
  }).selected, false);
});

test("Unicode, apóstrofes, subtítulos, guiones y números conservan clasificación", () => {
  for (const title of [
    "Pokémon Legends: Z-A — Nintendo Switch 2 launch",
    "Tom Clancy's Rainbow Six: Siege X esports event",
    "CD Projekt's next video-game review score",
    "YouTuber número 1 de Minecraft — 100 M subscribers",
  ]) {
    assert.equal(radar.classifyKalshiRadarSeriesCatalogV2({
      ticker: "KX-UNICODE", title, category: "Other", tags: [],
    }).selected, true, title);
  }
});

test("el snapshot inicial prueba catálogo completo, selección razonada y cero progreso inventado", () => {
  const checkpoint = buildCheckpoint(3);
  const state = radar.providerDiscoveryCheckpointV2State(checkpoint, {
    max_series: 2_000, max_parents: 2_000, max_attempts: 4, max_bytes: 4_000_000,
  });
  assert.equal(checkpoint.schema_version, radar.RADAR_PROVIDER_DISCOVERY_CHECKPOINT_V2);
  assert.equal(checkpoint.sequence, 1);
  assert.equal(checkpoint.previous_checkpoint_hash, null);
  assert.equal(checkpoint.catalog.provider_pagination_exhausted, true);
  assert.equal(checkpoint.catalog.provider_cursor, null);
  assert.equal(checkpoint.catalog.selected_series_count, 3);
  assert.equal(state.pending_series_ids.length, 3);
  assert.equal(state.results.length, 0);
  assert.equal(state.ready, false);
  assert.throws(() => radar.buildProviderDiscoveryCheckpointV2({
    checked_at: checkedAt,
    catalog: {
      provider_catalog_hash: hash("a"), total_provider_series_count: 13_000,
      entity_terms_hash: hash("b"), entity_term_count: 0,
      provider_pagination_exhausted: true, provider_cursor: null,
    },
    series: [],
  }), /CHECKPOINT_V2_INVALID/);
  assert.throws(() => radar.buildProviderDiscoveryCheckpointV2({
    checked_at: checkedAt,
    catalog: {
      provider_catalog_hash: hash("a"), total_provider_series_count: 13_000,
      entity_terms_hash: hash("b"), entity_term_count: 0,
      provider_pagination_exhausted: true, provider_cursor: null,
    },
    series: [seriesFixture(1, { catalog_signals: [] })],
  }), /SERIES_IDENTITY_INVALID/);
});

test("1, 3, 21, 48 y 100+ series se completan sin perder padres entre secuencias", () => {
  for (const count of [1, 3, 21, 48, 121]) {
    let checkpoint = buildCheckpoint(count);
    let offset = 0;
    while (offset < count) {
      const batch = checkpoint.series.slice(offset, offset + 48)
        .map((series, index) => fulfilled(series.ticker, offset + index + 1,
          `2026-08-26T12:${String(Math.floor(offset / 48)).padStart(2, "0")}:00.000Z`));
      checkpoint = advance(checkpoint, batch);
      offset += batch.length;
    }
    const state = radar.providerDiscoveryCheckpointV2State(checkpoint, {
      max_series: 2_000, max_parents: 2_000, max_attempts: 4, max_bytes: 4_000_000,
    });
    assert.equal(state.ready, true, String(count));
    assert.equal(state.completed_series_ids.length, count, String(count));
    assert.equal(state.events.length, count, String(count));
    const projection = radar.projectProviderDiscoveryCheckpointV2(checkpoint, {
      max_series: 2_000, max_parents: 2_000, max_attempts: 4, max_bytes: 4_000_000,
    });
    assert.equal(projection.total_series_count, count);
    assert.equal(projection.total_parent_count, count);
    assert.equal(projection.catalog_evidence.provider_catalog_hash, hash("a"));
  }
});

test("cada avance acepta como máximo 48 identidades únicas y nunca reconsulta una serie cumplida", () => {
  const checkpoint = buildCheckpoint(49);
  assert.throws(() => advance(checkpoint, checkpoint.series.map((series, index) =>
    fulfilled(series.ticker, index + 1))), /PROVIDER_DISCOVERY_BATCH_INVALID/);
  const first = advance(checkpoint, [fulfilled(checkpoint.series[0].ticker, 1)]);
  assert.throws(() => advance(first, [fulfilled(first.series[0].ticker, 1)]),
    /PROVIDER_DISCOVERY_BATCH_TRANSITION_INVALID/);
  assert.throws(() => advance(checkpoint, [
    fulfilled(checkpoint.series[0].ticker, 1),
    fulfilled(checkpoint.series[0].ticker, 2),
  ]), /PROVIDER_DISCOVERY_BATCH_INVALID/);
});

test("una caída de serie queda explícita, reintentable y puede recuperarse en la misma cadena", () => {
  const initial = buildCheckpoint(1);
  const failed = advance(initial, [rejected(initial.series[0].ticker)]);
  let state = radar.providerDiscoveryCheckpointV2State(failed, {
    max_series: 2_000, max_parents: 2_000, max_attempts: 4, max_bytes: 4_000_000,
  });
  assert.deepEqual(state.retryable_failed_series_ids, [initial.series[0].ticker]);
  assert.equal(state.ready, false);
  const recovered = advance(failed, [fulfilled(
    initial.series[0].ticker, 1, "2026-08-26T12:01:00.000Z",
  )]);
  state = radar.providerDiscoveryCheckpointV2State(recovered, {
    max_series: 2_000, max_parents: 2_000, max_attempts: 4, max_bytes: 4_000_000,
  });
  assert.equal(state.ready, true);
  assert.equal(state.results[0].attempt_count, 2);
  assert.equal(state.events.length, 1);
});

test("cuatro fallos no desaparecen: quedan aislados y proyectados como provider_unavailable", () => {
  let checkpoint = buildCheckpoint(1);
  for (let attempt = 0; attempt < 4; attempt += 1) {
    checkpoint = advance(checkpoint, [rejected(
      checkpoint.series[0].ticker,
      "PROVIDER_TIMEOUT",
      `2026-08-26T12:0${attempt}:00.000Z`,
    )]);
  }
  const state = radar.providerDiscoveryCheckpointV2State(checkpoint, {
    max_series: 2_000, max_parents: 2_000, max_attempts: 4, max_bytes: 4_000_000,
  });
  assert.equal(state.ready, true);
  assert.deepEqual(state.exhausted_failed_series_ids, [checkpoint.series[0].ticker]);
  const projection = radar.projectProviderDiscoveryCheckpointV2(checkpoint, {
    max_series: 2_000, max_parents: 2_000, max_attempts: 4, max_bytes: 4_000_000,
  });
  assert.deepEqual(projection.failed_series_ids, [checkpoint.series[0].ticker]);
  assert.throws(() => advance(checkpoint, [rejected(checkpoint.series[0].ticker)]),
    /PROVIDER_DISCOVERY_BATCH_TRANSITION_INVALID/);
});

test("pertenencia padre-serie, identidad global y contadores fallan cerrados", () => {
  const checkpoint = buildCheckpoint(2);
  assert.throws(() => advance(checkpoint, [{
    ...fulfilled(checkpoint.series[0].ticker, 1),
    events: [{ event_ticker: "EVENT-001", series_ticker: checkpoint.series[1].ticker }],
  }]), /PROVIDER_DISCOVERY_PARENT_MEMBERSHIP_INVALID/);
  assert.throws(() => advance(checkpoint, [
    fulfilled(checkpoint.series[0].ticker, 1),
    {
      ...fulfilled(checkpoint.series[1].ticker, 2),
      events: [{ event_ticker: "EVENT-001", series_ticker: checkpoint.series[1].ticker }],
    },
  ]), /PROVIDER_DISCOVERY_PARENT_IDENTITY_CONFLICT/);
  const tampered = { ...checkpoint, pending_series_count: 1 };
  assert.throws(() => radar.providerDiscoveryCheckpointV2State(tampered),
    /CHECKPOINT_V2_COUNT_INVALID/);
});

test("SQL V2 es append-only, service-only, encadenado e idempotente", () => {
  assert.match(migration,
    /create table private\.market_radar_provider_discovery_checkpoints_v2/);
  assert.match(migration, /primary key \(request_id, provider, capability, sequence\)/);
  assert.match(migration, /previous_checkpoint_hash[\s\S]+checkpoint_hash/);
  assert.match(migration, /entity_terms_hash[\s\S]+entity_term_count/);
  assert.match(migration, /before update or delete[\s\S]+reject_market_radar_provider_discovery_checkpoint_mutation_v1/);
  assert.match(migration, /enable row level security[\s\S]+force row level security/);
  assert.match(migration, /auth\.role\(\) <> 'service_role'/);
  assert.match(migration, /changed_result_count not between 1 and 48/);
  assert.match(migration, /previous_result ->> 'status' = 'fulfilled'[\s\S]+next_result is distinct from previous_result/);
  assert.match(migration, /where not exists \([\s\S]+series_results[\s\S]+next_result/);
  assert.match(migration, /replayed_value := true/);
  assert.match(migration, /lease_expires_at = clock_timestamp\(\)/);
  assert.match(migration, /RADAR_PROVIDER_DISCOVERY_CHECKPOINT_V2_EXPOSED/);
  assert.match(migration, /octet_length\(checkpoint::text\) <= 4194304/);
});

test("una caída del catálogo o del lote conserva UUID, cooldown e incidencia accionable", () => {
  assert.match(migration, /defer_market_radar_provider_discovery_v2/);
  assert.match(migration, /issue_code_input not in \([\s\S]+PROVIDER_RATE_LIMITED[\s\S]+PROVIDER_INVALID_RESPONSE/);
  assert.match(migration, /'blocking_scope','none'/);
  assert.match(migration, /'next_action','resume_provider_discovery'/);
  assert.match(migration, /lease_expires_at = retry_after_value/);
  assert.match(migration, /'outcome','in_progress'/);
  assert.match(edge, /defer_market_radar_provider_discovery_v2/);
  assert.match(edge, /discovery_in_progress:\s*true/);
});

test("Edge usa catálogo global completo, lectura acotada y checkpoint antes de padres e hijas", () => {
  const getV2 = edge.indexOf('"get_market_radar_provider_discovery_checkpoint_v2"');
  const getV1 = edge.indexOf('"get_market_radar_provider_discovery_checkpoint_v1"');
  const buildV2 = edge.indexOf("async function buildKalshiProviderDiscoveryCheckpointV2");
  const enumerateChildren = edge.indexOf("async function enumerateKalshiEventChildren");
  assert.ok(getV2 >= 0 && getV2 < getV1);
  assert.ok(buildV2 >= 0 && buildV2 < enumerateChildren);
  assert.match(edge, /new URL\(`\$\{KALSHI_API_ROOT\}\/series`\)/);
  assert.match(edge, /include_product_metadata["'],\s*["']true/);
  assert.match(edge, /include_volume["'],\s*["']true/);
  assert.match(edge, /if \(providerCursor\) throw new Error\("PROVIDER_PAGINATION_INCOMPLETE"\)/);
  assert.match(edge, /MAX_KALSHI_CATALOG_RESPONSE_BYTES = 24_000_000/);
  assert.match(edge, /readProviderResponseText/);
  assert.match(edge, /MAX_PROVIDER_DISCOVERY_SERIES_BATCH = 48/);
  assert.match(edge, /withRadarProviderDiscoveryBudget/);
  assert.match(edge, /buildKalshiRadarCatalogEntityTermsV2/);
  assert.match(edge, /catalog_entity_terms: catalogEntityTerms/);
  assert.match(edge, /El deadline del lote no es un fallo de esta serie/);
  assert.match(edge, /boundedEnvironment\.execution\.signal\.aborted/);
  assert.match(edge, /provider_catalog_hash/);
  assert.match(edge, /provider_catalog_pagination_exhausted/);
  assert.match(edge, /product_important_info/);
  assert.match(edge, /settlement_sources: settlementSources/);
  assert.match(edge, /volume_fp: cleanText\(series\.volume_fp/);
  assert.doesNotMatch(edge, /KXSWITCH2|KXMETACRITICSTALKER2/);
  assert.doesNotMatch(edge, /gemini/i);
});

test("el sellado ambiguo no se confunde con una caída del proveedor", () => {
  const discovery = edge.slice(
    edge.indexOf("async function discoverKalshi("),
    edge.indexOf("async function fetchKalshiMarketRecord"),
  );
  const build = discovery.indexOf("freshCheckpoint = await buildKalshiProviderDiscoveryCheckpointV2");
  const providerCatch = discovery.indexOf("} catch (error) {", build);
  const checkpoint = discovery.indexOf(
    "const durable = await checkpointRadarProviderDiscovery(environment, intent, freshCheckpoint)",
    providerCatch,
  );
  assert.ok(build >= 0 && providerCatch > build && checkpoint > providerCatch);
  assert.match(discovery, /la siguiente lectura recupera la misma secuencia/);
});
