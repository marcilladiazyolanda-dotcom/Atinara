const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { pathToFileURL } = require("node:url");
const { before, test } = require("node:test");

const root = join(__dirname, "..");
const radarPath = join(root, "supabase/functions/_shared/market-radar.mjs");
const migrationPath = join(root, "supabase/migrations/20260809150000_complete_family_identity_v4_cutover.sql");
const optionHorizonMigrationPath = join(
  root,
  "supabase/migrations/20260815165805_fix_radar_family_option_horizon_v1.sql",
);
const sqlTestPath = join(root, "supabase/tests/market_family_v4_transaction.sql");
const optionHorizonSqlTestPath = join(
  root,
  "supabase/tests/radar_family_option_horizon_v1_transaction.sql",
);
const migration = readFileSync(migrationPath, "utf8");
const optionHorizonMigration = readFileSync(optionHorizonMigrationPath, "utf8");
const optionHorizonSqlTest = readFileSync(optionHorizonSqlTestPath, "utf8");
let radar;

before(async () => {
  radar = await import(pathToFileURL(radarPath).href);
});

function definition(question, overrides = {}) {
  return {
    provider: "kalshi",
    external_id: `kalshi:${question}`,
    source_question: question,
    atinara_question: question,
    source_title: question,
    hard_reject_reasons: [],
    ...overrides,
  };
}

function gtaTrailer(month, overrides = {}) {
  const question = `Will another GTA VI trailer come out before ${month} 2026?`;
  return definition(question, {
    source_title: "Grand Theft Auto VI - New trailer release date",
    source_resolution_rules: "Resolves Yes if a new, at least 30 second, Grand Theft Auto VI trailer is released before the cutoff.",
    ...overrides,
  });
}

test("v4 agrupa cinco meses GTA como hermanos y nunca como duplicados", () => {
  const months = ["Jul", "Aug", "Sep", "Oct", "Nov"];
  const fixtures = months.map((month, index) => gtaTrailer(month, { id: `gta-trailer-${index}` }));
  const families = fixtures.map((item) => radar.deriveMarketFamily(item));

  assert.equal(new Set(families.map((family) => family.family_key)).size, 1);
  assert.equal(new Set(families.map((family) => family.family_child_key)).size, months.length);
  assert.ok(families.every((family) => family.family_version === "atinara-market-family-v4"));
  assert.ok(families.every((family) => family.family_key.endsWith("official_content:trailer:duration-gte-30-seconds")));

  for (let index = 1; index < fixtures.length; index += 1) {
    const relations = radar.classifyMarketRelations(fixtures[index], fixtures.slice(0, index));
    assert.deepEqual(relations.duplicates, []);
    assert.equal(relations.siblings.length, index);
    assert.ok(relations.siblings.every((match) => match.relationship === "sibling" && match.blocking === false));
  }
});

test("v4 reconoce el mismo mes cross-provider y alias largo/corto como duplicado exacto", () => {
  const kalshi = definition("Will GTA VI be released before October 1, 2026?", {
    id: "kalshi-october",
    provider: "kalshi",
    external_id: "kalshi:GTA-OCT",
  });
  const polymarket = definition("Will Grand Theft Auto VI be released before October 1, 2026?", {
    id: "polymarket-october",
    provider: "polymarket",
    external_id: "polymarket:GTA-OCT",
  });
  const relations = radar.classifyMarketRelations(kalshi, [polymarket]);

  assert.equal(relations.duplicates.length, 1);
  assert.equal(relations.duplicates[0].relationship, "exact_duplicate");
  assert.equal(radar.isBlockingDuplicateMatch(relations.duplicates[0]), true);
  assert.deepEqual(relations.siblings, []);
});

test("v4 conserva lanzamiento agosto/noviembre como hijos distintos", () => {
  const august = definition("Will Grand Theft Auto VI be released on or before August 31, 2026?", { id: "release-aug" });
  const november = definition("Will GTA VI be released before December 1, 2026?", { id: "release-nov" });
  const relations = radar.classifyMarketRelations(november, [august]);

  assert.equal(relations.family.family_key, radar.deriveMarketFamily(august).family_key);
  assert.notEqual(relations.family.family_child_key, radar.deriveMarketFamily(august).family_child_key);
  assert.deepEqual(relations.duplicates, []);
  assert.equal(relations.siblings[0].relationship, "sibling");
});

test("v4 usa la opción estructurada como identidad aunque exista una frontera temporal", () => {
  const nominees = ["Half-Life 3", "Saros", "Slay the Spire 2"].map((name, index) => definition(
    "2026 Game of the Year?",
    {
      id: `tga-${index}`,
      external_id: `kalshi:KXGAMEAWARDS-2026-${index}`,
      source_title: "The Game Awards: 2026 Game of the Year",
      source_resolution_rules: `Resolves Yes if ${name} wins 2026 Game of the Year before the end of 2026.`,
      event_group_key: "kalshi:KXGAMEAWARDS-2026",
      source_close_at: "2027-12-31T15:00:00.000Z",
      provider_payload: { yes_sub_title: name, no_sub_title: name },
    },
  ));
  const families = nominees.map((candidate) => radar.deriveMarketFamily(candidate));

  assert.equal(new Set(families.map((family) => family.family_key)).size, 1);
  assert.deepEqual(
    families.map((family) => family.family_child_key),
    ["option:half-life-3", "option:saros", "option:slay-the-spire-2"],
  );
  assert.ok(families.every((family) => family.family_sort_at === "2027-01-01T00:00:00.000Z"));
  assert.equal(radar.classifyMarketRelations(nominees[1], [nominees[0]]).duplicates.length, 0);
  assert.equal(radar.classifyMarketRelations(nominees[1], [nominees[0]]).siblings.length, 1);
});

test("v4 mantiene el mismo slug Unicode y rechaza etiquetas afirmativas genéricas", () => {
  const candidate = (label) => definition("2026 Game of the Year?", {
    id: `tga-unicode-${label}`,
    external_id: `kalshi:KXGAMEAWARDS-UNICODE-${label}`,
    source_title: "The Game Awards: 2026 Game of the Year",
    source_resolution_rules: "Resolves Yes if the named option wins before the end of 2026.",
    event_group_key: "kalshi:KXGAMEAWARDS-UNICODE",
    provider_payload: { yes_sub_title: label, no_sub_title: label },
  });

  assert.equal(radar.deriveMarketFamily(candidate("Pokémon")).family_child_key, "option:pokemon");
  assert.equal(radar.deriveMarketFamily(candidate("Poke\u0301mon")).family_child_key, "option:pokemon");
  assert.equal(radar.deriveMarketFamily(candidate("İstanbul")).family_child_key, "option:istanbul");
  for (const genericLabel of ["Yes!", "Sí!", "---"]) {
    assert.equal(
      radar.deriveMarketFamily(candidate(genericLabel)).family_child_key,
      "deadline:lt:2027-01-01T00:00:00.000Z:year",
    );
  }
});

test("v4 generaliza acrónimo y sufijo sin un registro hardcodeado", () => {
  const shortName = definition("Will TES VI be released before 2028?", { id: "tes-short" });
  const longName = definition("Will The Elder Scrolls VI be released before 2028?", { id: "tes-long" });
  const numericName = definition("Will The Elder Scrolls 6 be released before 2028?", { id: "tes-numeric" });
  const shortFamily = radar.deriveMarketFamily(shortName);
  const longFamily = radar.deriveMarketFamily(longName);

  assert.equal(shortFamily.family_key, "atinara:v4:tesvi:release_date");
  assert.equal(shortFamily.family_key, longFamily.family_key);
  assert.equal(shortFamily.family_key, radar.deriveMarketFamily(numericName).family_key);
  assert.equal(radar.classifyMarketRelations(shortName, [longName]).duplicates.length, 1);
  assert.equal(radar.classifyMarketRelations(numericName, [longName]).duplicates.length, 1);
});

test("v4 falla cerrado cuando un acrónimo admite dos expansiones", () => {
  const acronym = definition("Will GTA VI be released before 2028?", { id: "ambiguous-acronym" });
  const expansions = [
    definition("Will Grand Theft Auto VI be released before 2028?", { id: "grand-theft-auto" }),
    definition("Will Great Tactical Adventure VI be released before 2028?", { id: "great-tactical-adventure" }),
  ];
  const relations = radar.classifyMarketRelations(acronym, expansions);

  assert.deepEqual(relations.duplicates, []);
  assert.deepEqual(relations.siblings, []);
  assert.equal(relations.ambiguous.length, 2);
  assert.ok(relations.ambiguous.every((match) => match.relationship === "identity_ambiguous" && match.blocking === false));
});

test("v4 canoniza fronteras diarias equivalentes y conserva la semántica original", () => {
  const exclusive = definition("Will Grand Theft Auto VI be released before October 1, 2026?", { id: "before-october" });
  const inclusive = definition("Will GTA VI be released on or before September 30, 2026?", { id: "through-september" });
  const exclusiveFamily = radar.deriveMarketFamily(exclusive);
  const inclusiveFamily = radar.deriveMarketFamily(inclusive);

  assert.equal(exclusiveFamily.family_child_key, inclusiveFamily.family_child_key);
  assert.equal(exclusiveFamily.family_semantics.temporal_boundary.operator, "lt");
  assert.equal(inclusiveFamily.family_semantics.temporal_boundary.operator, "lte");
  assert.equal(inclusiveFamily.family_semantics.temporal_boundary.instant, "2026-09-30T23:59:59.000Z");
  assert.equal(inclusiveFamily.family_semantics.temporal_boundary.canonical_operator, "lt");
  assert.equal(inclusiveFamily.family_semantics.temporal_boundary.canonical_instant, "2026-10-01T00:00:00.000Z");
  assert.equal(radar.classifyMarketRelations(exclusive, [inclusive]).duplicates.length, 1);
});

test("v4 no colapsa horas contractuales distintas", () => {
  const ten = definition("Will GTA VI be released before October 1, 2026 at 10:00 UTC?", { id: "ten" });
  const eleven = definition("Will Grand Theft Auto VI be released before October 1, 2026 at 11:00 UTC?", { id: "eleven" });
  const relations = radar.classifyMarketRelations(ten, [eleven]);

  assert.notEqual(radar.deriveMarketFamily(ten).family_child_key, radar.deriveMarketFamily(eleven).family_child_key);
  assert.deepEqual(relations.duplicates, []);
  assert.equal(relations.siblings[0].relationship, "sibling");
});

test("v4 conserva offsets explícitos y equivalencias horarias correctas", () => {
  const est = definition("Will GTA VI be released before July 1, 2027 at 10:00 EST?", { id: "est" });
  const edt = definition("Will GTA VI be released before July 1, 2027 at 10:00 EDT?", { id: "edt" });
  const utcMinusFive = definition("Will GTA VI be released before July 1, 2027 at 10:00 UTC-05:00?", { id: "utc-minus-five" });
  const lowercaseEst = definition("Will GTA VI be released before July 1, 2027 at 10:00 est?", { id: "lowercase-est" });
  const et = definition("Will GTA VI be released before July 1, 2027 at 10:00 ET?", { id: "et" });
  const utcFourteen = definition("Will GTA VI be released before July 1, 2027 at 14:00 UTC?", { id: "utc-fourteen" });
  const iana = definition("Will GTA VI be released before July 1, 2027 at 10:00?", {
    id: "iana",
    evaluation_timezone: "America/New_York",
  });
  const estFamily = radar.deriveMarketFamily(est);
  const edtFamily = radar.deriveMarketFamily(edt);

  assert.equal(estFamily.family_semantics.temporal_boundary.instant, "2027-07-01T15:00:00.000Z");
  assert.equal(estFamily.family_semantics.temporal_boundary.timezone, "UTC-05:00");
  assert.equal(estFamily.family_semantics.temporal_boundary.offset_minutes, -300);
  assert.equal(edtFamily.family_semantics.temporal_boundary.instant, "2027-07-01T14:00:00.000Z");
  assert.equal(edtFamily.family_semantics.temporal_boundary.timezone, "UTC-04:00");
  assert.equal(edtFamily.family_semantics.temporal_boundary.offset_minutes, -240);
  assert.notEqual(estFamily.family_child_key, edtFamily.family_child_key);
  assert.equal(radar.classifyMarketRelations(est, [edt]).siblings[0].relationship, "sibling");
  assert.equal(radar.classifyMarketRelations(est, [utcMinusFive]).duplicates[0].relationship, "exact_duplicate");
  assert.equal(radar.classifyMarketRelations(est, [lowercaseEst]).duplicates[0].relationship, "exact_duplicate");
  assert.equal(radar.classifyMarketRelations(et, [iana]).duplicates[0].relationship, "exact_duplicate");
  assert.equal(edtFamily.family_child_key, radar.deriveMarketFamily(utcFourteen).family_child_key);
  assert.equal(radar.classifyMarketRelations(et, [utcFourteen]).duplicates[0].relationship, "exact_duplicate");
  assert.equal(edtFamily.family_child_key, "deadline:lt:2027-07-01T14:00:00.000Z:minute");

  for (const [standard, daylight, standardInstant, daylightInstant] of [
    ["PST", "PDT", "2027-07-01T18:00:00.000Z", "2027-07-01T17:00:00.000Z"],
    ["CET", "CEST", "2027-07-01T09:00:00.000Z", "2027-07-01T08:00:00.000Z"],
  ]) {
    const standardFamily = radar.deriveMarketFamily(definition(`Will GTA VI be released before July 1, 2027 at 10:00 ${standard}?`));
    const daylightFamily = radar.deriveMarketFamily(definition(`Will GTA VI be released before July 1, 2027 at 10:00 ${daylight}?`));
    assert.equal(standardFamily.family_semantics.temporal_boundary.instant, standardInstant);
    assert.equal(daylightFamily.family_semantics.temporal_boundary.instant, daylightInstant);
    assert.notEqual(standardFamily.family_child_key, daylightFamily.family_child_key);
  }
});

test("v4 falla cerrado en gaps, folds y abreviaturas horarias ambiguas", () => {
  const fixtures = [
    ["Will GTA VI be released before March 14, 2027 at 02:30 ET?", "nonexistent_local_time", 0],
    ["Will GTA VI be released before November 7, 2027 at 01:30 ET?", "repeated_local_time", 2],
    ["Will GTA VI be released before July 1, 2027 at 10:00 CST?", "ambiguous_timezone", 0],
  ];
  for (const [question, expectedReason, expectedCandidates] of fixtures) {
    const candidate = definition(question, { id: expectedReason });
    const copy = definition(question, { id: `${expectedReason}-copy`, provider: "polymarket" });
    const family = radar.deriveMarketFamily(candidate);
    const boundary = family.family_semantics.temporal_boundary;
    const relations = radar.classifyMarketRelations(candidate, [copy]);

    assert.equal(family.family_semantics.identity_ambiguous, true);
    assert.equal(boundary.timezone_ambiguous, true);
    assert.equal(boundary.ambiguity_reason, expectedReason);
    assert.equal(boundary.candidate_instants.length, expectedCandidates);
    assert.match(family.family_child_key, /^deadline:ambiguous-timezone:/);
    assert.deepEqual(relations.duplicates, []);
    assert.equal(relations.ambiguous[0].relationship, "identity_ambiguous");
    assert.equal(relations.ambiguous[0].blocking, false);
  }
});

test("v4 deriva la dimensión del predicado cuantificado, no del sustantivo tráiler", () => {
  const fixtures = [
    ["Will Hideo Kojima next trailer reach more than 1000000 views in 48 hours?", "threshold:gt:1000000:views"],
    ["Will Hideo Kojima next trailer reach at least 1000000 views in 48 hours?", "threshold:gte:1000000:views"],
    ["Will Hideo Kojima next trailer score above 95 points?", "threshold:gt:95:points"],
    ["Will Hideo Kojima next trailer reach >= 1000000 views?", "threshold:gte:1000000:views"],
    ["Will Hideo Kojima next trailer reach > 1000000 views?", "threshold:gt:1000000:views"],
  ];

  for (const [question, childKey] of fixtures) {
    const family = radar.deriveMarketFamily(definition(question));
    assert.equal(family.family_type, "milestone_thresholds");
    assert.match(family.family_key, /:threshold$/);
    assert.doesNotMatch(family.family_key, /official_content/);
    assert.equal(family.family_child_key, childKey);
  }
});

test("v4 canoniza separadores inequívocos y aísla la notación ambigua", () => {
  const comma = definition("Will Hideo Kojima next trailer reach more than 1,000,000 views?", { id: "comma" });
  const dot = definition("Will Hideo Kojima next trailer reach more than 1.000.000 views?", { id: "dot" });
  const ambiguous = definition("Will Hideo Kojima next trailer reach more than 1,000 views?", { id: "ambiguous-number" });
  const ambiguousCopy = { ...ambiguous, id: "ambiguous-number-copy", external_id: "copy" };

  assert.equal(radar.deriveMarketFamily(comma).family_child_key, "threshold:gt:1000000:views");
  assert.equal(radar.deriveMarketFamily(comma).family_child_key, radar.deriveMarketFamily(dot).family_child_key);
  assert.equal(radar.classifyMarketRelations(comma, [dot]).duplicates.length, 1);

  const ambiguousFamily = radar.deriveMarketFamily(ambiguous);
  assert.equal(ambiguousFamily.family_child_key, "threshold:ambiguous:1-000:views");
  assert.equal(ambiguousFamily.family_semantics.identity_ambiguous, true);
  const relations = radar.classifyMarketRelations(ambiguous, [ambiguousCopy]);
  assert.deepEqual(relations.duplicates, []);
  assert.equal(relations.ambiguous[0].relationship, "identity_ambiguous");
  assert.equal(relations.ambiguous[0].blocking, false);
});

test("v4 separa el invariante de 30 segundos de los umbrales genuinos", () => {
  const official = gtaTrailer("Oct");
  const threshold = definition("Will the next Kojima Productions trailer exceed 5 million views in 48 hours?", {
    source_resolution_rules: "The qualifying official trailer must be at least 30 seconds long.",
  });
  const officialFamily = radar.deriveMarketFamily(official);
  const thresholdFamily = radar.deriveMarketFamily(threshold);

  assert.match(officialFamily.family_key, /official_content:trailer:duration-gte-30-seconds$/);
  assert.equal(officialFamily.family_semantics.duration_contract.value, "30");
  assert.equal(thresholdFamily.family_child_key, "threshold:gt:5000000:views");
  assert.doesNotMatch(thresholdFamily.family_child_key, /30/);
  assert.doesNotMatch(thresholdFamily.family_key, /official_content/);
});

test("v4 recalcula payloads v2/v3 y solo bloquea exact_duplicate v4", () => {
  const candidate = definition("Will GTA VI be released before October 1, 2026?", { id: "candidate" });
  const stale = {
    ...definition("Will Grand Theft Auto VI be released before November 1, 2026?", { id: "stale" }),
    family_version: "atinara-market-family-v3",
    family_key: "atinara:v3:wrong:release_date",
    family_child_key: "deadline:2026-10-31",
  };
  const relations = radar.classifyMarketRelations(candidate, [stale]);

  assert.deepEqual(relations.duplicates, []);
  assert.equal(relations.siblings[0].relationship, "sibling");
  assert.equal(radar.isBlockingDuplicateMatch({ relationship: "exact_duplicate", family_version: "atinara-market-family-v3", blocking: true }), false);
  assert.equal(radar.isBlockingDuplicateMatch({ relationship: "semantic_duplicate", family_version: "atinara-market-family-v4", blocking: true }), false);
  assert.equal(radar.isBlockingDuplicateMatch({ relationship: "exact_duplicate", family_version: "atinara-market-family-v4", blocking: true }), true);
});

test("la migración v4 es autoritativa, transaccional e inerte para la economía", () => {
  const sqlTest = readFileSync(sqlTestPath, "utf8");

  assert.match(migration, /^--[^]*?\nbegin;/);
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /lock table public\.markets[\s\S]*lock table private\.market_drafts[\s\S]*lock table private\.external_market_candidates/);
  assert.match(migration, /market_family_canonical_number_v4/);
  assert.match(migration, /market_family_metadata_v4/);
  assert.match(migration, /'deadline:', boundary_value ->> 'canonical_operator',[\s\S]*':', boundary_value ->> 'canonical_instant',[\s\S]*':', boundary_value ->> 'granularity'/);
  assert.match(migration, /market_candidate_relations_v4/);
  assert.match(migration, /family_version' = 'atinara-market-family-v4'|family_version = 'atinara-market-family-v4'/);
  assert.match(migration, /market_family_v4_(public|draft|candidate)_map/);
  assert.match(migration, /snapshot\.original_state in \('prepared', 'dismissed'\)/);
  assert.match(migration, /had_duplicate_marker and has_other_hard_reason/);
  assert.match(migration, /market_family_v4_false_duplicate_still_rejected/);
  assert.match(migration, /drop trigger if exists a_apply_structured_kalshi_candidate_family_before_write/);
  assert.match(migration, /commit;\s*$/);
  assert.doesNotMatch(migration, /(?:insert|update|delete)\s+(?:into\s+|from\s+)?public\.(?:predictions|profiles|wallets|transactions|bets)/i);

  assert.match(sqlTest, /^--[^]*?\nbegin;/);
  assert.match(sqlTest, /market_family_metadata_v4/);
  assert.match(sqlTest, /14:00 UTC/);
  assert.match(sqlTest, /deadline:lt:2027-07-01T14:00:00\.000Z:minute/);
  assert.match(sqlTest, /rollback;\s*$/);
});

test("la migración aditiva alinea Postgres con la Edge y usa el horizonte predictivo", () => {
  const legacyTemporal = migration.indexOf("elsif temporal_child is not null then");
  const legacyOption = migration.indexOf(
    "and dimension_value in ('outcome', 'participant', 'platform') then",
    legacyTemporal,
  );
  const fixedOption = optionHorizonMigration.indexOf(
    "and dimension_value in ('outcome', 'participant', 'platform') then",
  );
  const fixedTemporal = optionHorizonMigration.indexOf("elsif temporal_child is not null then");

  assert.ok(legacyTemporal >= 0 && legacyOption > legacyTemporal);
  assert.ok(fixedOption >= 0 && fixedTemporal > fixedOption);
  assert.match(optionHorizonMigration, /^--[^]*?\nbegin;/);
  assert.match(optionHorizonMigration, /'option:half-life-3'/);
  assert.match(optionHorizonMigration, /'2027-01-01T00:00:00\.000Z'/);
  assert.match(optionHorizonMigration, /market_family_option_slug_v1/);
  assert.match(optionHorizonMigration, /normalize\(value, NFD\)/);
  assert.match(
    optionHorizonMigration,
    /translate\([\s\S]*?'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'/,
  );
  assert.match(optionHorizonMigration, /market_family_origin_projection_v1/);
  assert.match(
    optionHorizonMigration,
    /origin_value := private\.market_family_origin_projection_v1\(\s*new\.radar_candidate_id, null/,
  );
  assert.match(
    optionHorizonMigration,
    /origin_value := private\.market_family_origin_projection_v1\(null, new\.id\)/,
  );
  assert.match(optionHorizonMigration, /market_radar_candidate_horizon_at_v1/);
  assert.match(
    optionHorizonMigration,
    /old\.family_child_key is not distinct from[\s\S]*?new\.normalized_payload ->> 'family_child_key'/,
  );
  assert.match(
    optionHorizonMigration,
    /select coalesce\(\s*case[\s\S]*?else candidate_input\.family_sort_at[\s\S]*?end,[\s\S]*?'atinara_closes_at'[\s\S]*?'source_close_at'/,
  );
  assert.match(
    optionHorizonMigration,
    /cross join lateral \([\s\S]*?private\.market_radar_candidate_horizon_at_v1\(candidate\) as horizon_at/,
  );
  assert.match(
    optionHorizonMigration,
    /horizon\.horizon_at > checked_at_value[\s\S]*?horizon\.horizon_at <= checked_at_value \+ case horizon_filter/,
  );
  assert.match(
    optionHorizonMigration,
    /case when order_key = 'closing' then horizon\.horizon_at/,
  );
  assert.match(
    optionHorizonMigration,
    /canonical_operator}'[\s\S]*?in \('gt', 'gte'\) then null/,
  );
  assert.match(optionHorizonSqlTest, /public\.list_market_radar_candidates_v2\(/);
  assert.match(optionHorizonSqlTest, /'closing', '365d'/);
  assert.match(optionHorizonSqlTest, /TEST_RADAR_PAST_BOUNDARY_LISTED/);
  assert.match(optionHorizonSqlTest, /TEST_RADAR_LEGACY_IDENTITY_FIXTURE_NOT_MATERIALIZED/);
  assert.match(optionHorizonSqlTest, /TEST_RADAR_CROSS_PROVIDER_DRAFT_GATE_FAILED/);
  assert.match(optionHorizonSqlTest, /set local role authenticated/);
  assert.match(optionHorizonSqlTest, /TEST_RADAR_PRIVATE_FUNCTION_EXECUTE_EXPOSED/);
  assert.doesNotMatch(
    optionHorizonMigration,
    /(?:insert|update|delete)\s+(?:into\s+|from\s+)?(?:public\.(?:markets|predictions|profiles)|private\.market_drafts)/i,
  );
  assert.match(optionHorizonMigration, /commit;\s*$/);
});
