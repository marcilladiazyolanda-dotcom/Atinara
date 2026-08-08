const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { pathToFileURL } = require("node:url");
const { test, before } = require("node:test");

const root = join(__dirname, "..");
const repairPath = join(root, "supabase/functions/_shared/market-draft-repair.mjs");
const radarPath = join(root, "supabase/functions/_shared/market-radar.mjs");
const fixerEdge = readFileSync(join(root, "supabase/functions/market-draft-fixer/index.ts"), "utf8");
const radarEdge = readFileSync(join(root, "supabase/functions/market-radar/index.ts"), "utf8");
const migration = readFileSync(join(root, "supabase/migrations/20260808180729_add_autonomous_repair_and_market_families_v2.sql"), "utf8");
const familyDerivationMigration = readFileSync(join(root, "supabase/migrations/20260808182940_strengthen_generic_market_family_derivation.sql"), "utf8");
const candidateDuplicateMigration = readFileSync(join(root, "supabase/migrations/20260808183415_enforce_exact_candidate_family_duplicates.sql"), "utf8");
const familyMatchDeduplicationMigration = readFileSync(join(root, "supabase/migrations/20260808185135_deduplicate_market_family_matches.sql"), "utf8");
const radarIdentityMigration = readFileSync(join(root, "supabase/migrations/20260808204159_fix_radar_prepare_identity_and_blocking_duplicates.sql"), "utf8");
const explorer = require(join(root, "market-family-explorer.js"));
const landing = readFileSync(join(root, "market-publication-landing.js"), "utf8");
const home = readFileSync(join(root, "script.js"), "utf8");
const styles = readFileSync(join(root, "styles.css"), "utf8");
let repair;
let radar;

before(async () => {
  repair = await import(pathToFileURL(repairPath).href);
  radar = await import(pathToFileURL(radarPath).href);
});

function ps6Context() {
  return {
    draft: {
      market_slug: "ps6-anuncio-2026",
      question: "¿Se anunciará la PS6 antes del 1 de enero de 2027?",
      subject: "",
      category: "Lanzamientos",
      yes_option: "Sí",
      no_option: "No",
      yes_criteria: "Sony anuncia oficialmente la consola PlayStation 6 antes del 1 de enero de 2027.",
      primary_source: { url: "https://sonyinteractive.com/en/news/press-releases/" },
      alternative_sources: [],
      resolution_deadline: "2027-01-01T15:00:00Z",
    },
    radar_candidate: {
      source_question: "PS6 announced by 2026?",
      source_title: "PS6 announced this year?",
      source_resolution_rules: "If Sony announces the PS6 before 2027, the market resolves Yes.",
      atinara_category: "Lanzamientos",
    },
  };
}

function trailerContext() {
  return {
    draft: {
      market_slug: "gta-vi-trailer-2026",
      question: "¿Se lanzará un nuevo tráiler de Grand Theft Auto VI antes de octubre de 2026?",
      subject: "",
      category: "Lanzamientos",
      yes_option: "Sí",
      no_option: "No",
      yes_criteria: "Rockstar Games publica un tráiler de Grand Theft Auto VI de al menos 30 segundos antes del 1 de octubre de 2026.",
      primary_source: { url: "https://www.rockstargames.com/" },
      alternative_sources: [],
      resolution_deadline: "2026-10-08T14:00:00Z",
    },
    radar_candidate: {
      source_question: "Will another GTA VI trailer come out before Oct 2026?",
      source_title: "Grand Theft Auto VI: New trailer release date",
      source_resolution_rules: "If a new (at least 30 second) GTA VI trailer is released before Oct 1, 2026, this resolves Yes.",
      atinara_category: "Lanzamientos",
    },
  };
}

test("Corrector · PS6 usa official_announcement, fecha inclusiva UTC y criterios completos", () => {
  const context = ps6Context();
  const result = repair.buildDeterministicRepair(context, [{ url: "https://sonyinteractive.com/en/news/", title: "Sony Interactive Entertainment News" }]);
  assert.equal(result.archetype, "official_announcement");
  assert.match(result.patch.subject, /PlayStation 6 \/ PS6/);
  assert.equal(result.patch.evaluation_ends_at, "2026-12-31T23:59:59.000Z");
  assert.equal(result.patch.timezone, "UTC");
  assert.match(result.patch.yes_criteria, /anuncio oficial y público/);
  assert.match(result.patch.description, /PlayStation 6 \/ PS6/);
  assert.match(result.patch.edge_cases, /patentes/);
  assert.match(result.patch.edge_cases, /fuentes primarias/);
  assert.equal(result.patch.alternative_sources.length, 1);
  assert.equal(repair.validateRepairDraft(repair.applyRepairPatch(context.draft, result)).length, 0);
});

test("Corrector · tráiler usa content_release, conserva 30 segundos y cubre casos límite", () => {
  const context = trailerContext();
  const result = repair.buildDeterministicRepair(context, [{
    url: "https://www.rockstargames.com/newswire/article/example/grand-theft-auto-vi-watch-trailer-2-now",
    title: "Grand Theft Auto VI - Watch Trailer 2 Now",
  }]);
  assert.equal(result.archetype, "content_release");
  assert.equal(result.patch.subject, "Grand Theft Auto VI");
  assert.equal(result.patch.evaluation_ends_at, "2026-09-30T23:59:59.000Z");
  assert.match(result.patch.yes_criteria, /al menos 30 segundos/);
  assert.match(result.patch.description, /tráiler nuevo de Grand Theft Auto VI/);
  for (const term of ["teasers", "clips", "reediciones", "versión localizada", "filtraciones", "retirada"]) {
    assert.match(result.patch.edge_cases, new RegExp(term));
  }
});

test("Corrector · proveedor limitado degrada sin veto técnico ni falsa revisión humana", () => {
  assert.match(fixerEdge, /GEMINI_RATE_LIMITED/);
  assert.match(fixerEdge, /GEMINI_TIMEOUT/);
  assert.match(fixerEdge, /GEMINI_INVALID_RESPONSE/);
  assert.match(fixerEdge, /repair_applied: allChanged\.size > 0/);
  assert.match(fixerEdge, /technical_incident/);
  assert.doesNotMatch(fixerEdge, /TECHNICAL_REVIEW_FAILURE_NOT_REPAIRABLE/);
  assert.match(fixerEdge, /AUTONOMOUS_REPAIR_MAX_ROUNDS/);
});

test("Corrector · ambigüedad irreducible informa código, campo, evidencia y alternativas", () => {
  const result = repair.detectIrreducibleAmbiguity({
    primary_source_conflicts: [
      { url: "https://official.example/a", statement: "La regla usa UTC." },
      { url: "https://official.example/b", statement: "La regla usa hora local." },
    ],
  });
  assert.equal(result.code, "CONFLICTING_PRIMARY_SOURCES");
  assert.equal(result.field, "primary_source");
  assert.equal(result.evidence.length, 2);
  assert.equal(result.alternatives.length, 2);
  assert.match(fixerEdge, /draft_private: true/);
});

function gtaRelease(question, overrides = {}) {
  return {
    id: overrides.id,
    provider: overrides.provider || "kalshi",
    external_id: overrides.external_id,
    source_title: "Grand Theft Auto VI release date",
    source_question: question,
    atinara_question: question,
    hard_reject_reasons: overrides.hard_reject_reasons || [],
    source_close_at: overrides.source_close_at,
  };
}

const publishedAugust = {
  id: "gta-vi-august",
  question: "¿Grand Theft Auto VI será lanzado el 31 de agosto de 2026 o antes?",
};

test("Familias · misma fecha es exact_duplicate y bloquea", () => {
  const candidate = gtaRelease("Will Grand Theft Auto VI be released before August 31, 2026?");
  const relation = radar.classifyMarketRelations(candidate, [publishedAugust]);
  assert.equal(relation.duplicates[0].relationship, "exact_duplicate");
  assert.equal(relation.duplicates[0].blocking, true);
  assert.equal(relation.siblings.length, 0);
});

test("Familias · fecha distinta es sibling, comparte familia y recupera novedad", () => {
  const candidate = gtaRelease("Will Grand Theft Auto VI be released before October 31, 2026?", {
    hard_reject_reasons: ["DUPLICATE_MARKET"],
  });
  const relation = radar.classifyMarketRelations(candidate, [publishedAugust]);
  assert.equal(relation.siblings[0].relationship, "sibling");
  assert.equal(relation.family.family_key, radar.deriveMarketFamily(publishedAugust).family_key);
  assert.notEqual(relation.family.family_child_key, radar.deriveMarketFamily(publishedAugust).family_child_key);
  assert.equal(radar.scoreCandidates([candidate], [publishedAugust])[0].hard_reject_reasons.includes("DUPLICATE_MARKET"), false);
  assert.deepEqual(relation.family.family_semantics, {
    cumulative: true,
    mutually_exclusive: false,
    parent_is_market: false,
    aggregate_probability: false,
    economic_independence: true,
  });
});

test("Familias · una candidata nunca puede bloquearse al reencontrarse a sí misma", () => {
  const candidate = gtaRelease("Will Grand Theft Auto VI be released before December 31, 2026?", {
    id: "candidate-uuid",
    external_id: "kalshi:KXGTA6-26-DEC31",
  });
  const cachedOccurrence = {
    ...candidate,
    id: "cached-copy-with-another-row-shape",
    question: candidate.atinara_question,
  };
  const relation = radar.classifyMarketRelations(candidate, [candidate, cachedOccurrence]);
  assert.equal(relation.duplicates.length, 0);
  assert.equal(relation.siblings.length, 0);
  const scored = radar.scoreCandidates([candidate, cachedOccurrence]);
  assert.ok(scored.every((item) => !item.hard_reject_reasons.includes("DUPLICATE_MARKET")));
  assert.ok(scored.every((item) => item.score_breakdown.novelty === 20));
});

test("Familias · identidad distinta y mismo hijo continúa siendo un duplicado real", () => {
  const first = gtaRelease("Will Grand Theft Auto VI be released before December 31, 2026?", {
    id: "first",
    external_id: "kalshi:KXGTA6-26-DEC31-A",
  });
  const second = {
    ...first,
    id: "second",
    external_id: "kalshi:KXGTA6-26-DEC31-B",
    question: first.atinara_question,
  };
  const relation = radar.classifyMarketRelations(second, [first]);
  assert.equal(relation.duplicates.length, 1);
  assert.equal(radar.isBlockingDuplicateMatch(relation.duplicates[0]), true);
  assert.equal(radar.isBlockingDuplicateMatch({ relationship: "sibling", blocking: false }), false);
});

test("Familias · tráiler y lanzamiento son proposiciones distintas", () => {
  const trailer = gtaRelease("Will another Grand Theft Auto VI trailer come out before October 2026?");
  const releaseFamily = radar.deriveMarketFamily(publishedAugust);
  const trailerFamily = radar.deriveMarketFamily(trailer);
  assert.notEqual(trailerFamily.family_key, releaseFamily.family_key);
  assert.equal(trailerFamily.family_type, "event_content_options");
  assert.equal(radar.classifyMarketRelations(trailer, [publishedAugust]).duplicates.length, 0);
});

test("Familias · cross-provider usa proposición e hijo, no el proveedor", () => {
  const kalshi = gtaRelease("Will Grand Theft Auto VI be released before October 31, 2026?", { provider: "kalshi" });
  const polymarketSame = { ...kalshi, id: "poly-same", provider: "polymarket", question: kalshi.atinara_question };
  const polymarketSibling = gtaRelease("Will Grand Theft Auto VI be released before November 30, 2026?", { provider: "polymarket", id: "poly-sibling" });
  assert.equal(radar.classifyMarketRelations(kalshi, [polymarketSame]).duplicates[0].relationship, "exact_duplicate");
  assert.equal(radar.classifyMarketRelations(kalshi, [polymarketSibling]).siblings[0].relationship, "sibling");
});

test("Familias · un mismo lote conserva el primer exacto, bloquea el repetido y permite el hermano", () => {
  const first = gtaRelease("Will Grand Theft Auto VI be released before October 31, 2026?", { provider: "kalshi", id: "first" });
  const duplicate = { ...first, id: "duplicate", external_id: "duplicate", provider: "polymarket" };
  const sibling = gtaRelease("Will Grand Theft Auto VI be released before November 30, 2026?", { provider: "polymarket", id: "sibling" });
  const scored = radar.scoreCandidates([first, duplicate, sibling]);
  const byId = new Map(scored.map((item) => [item.id, item]));
  assert.equal(byId.get("first").hard_reject_reasons.includes("DUPLICATE_MARKET"), false);
  assert.equal(byId.get("duplicate").hard_reject_reasons.includes("DUPLICATE_MARKET"), true);
  assert.equal(byId.get("duplicate").duplicate_matches[0].relationship, "exact_duplicate");
  assert.equal(byId.get("sibling").hard_reject_reasons.includes("DUPLICATE_MARKET"), false);
  assert.equal(byId.get("sibling").family_relationship, "sibling");
});

test("Familias · la taxonomía genérica cubre anuncios, contenido, premios, presencia y umbrales", () => {
  const fixtures = [
    ["Dispositivo Aurora", "¿Se anunciará oficialmente Dispositivo Aurora antes del 1 de enero de 2027?", "deadline_ladder", "announcement_date"],
    ["Saga Boreal", "¿Se publicará un nuevo tráiler oficial de Saga Boreal antes de octubre de 2026?", "event_content_options", "official_content"],
    ["Obra Cobalto", "¿Será Obra Cobalto nominada a Juego del Año 2026?", "categorical_outcomes", "outcome"],
    ["Estudio Épsilon", "¿Aparecerá Estudio Épsilon en la Feria Boreal 2026?", "participant_options", "participant"],
    ["Activo Delta", "¿Superará Activo Delta los 100 puntos antes de 2027?", "milestone_thresholds", "threshold"],
  ];
  for (const [subject, question, expectedType, dimension] of fixtures) {
    const family = radar.deriveMarketFamily({ subject, atinara_question: question });
    assert.equal(family.family_type, expectedType);
    assert.match(family.family_key, new RegExp(`:${dimension}$`));
    assert.equal(family.family_semantics.economic_independence, true);
    assert.equal(family.family_semantics.aggregate_probability, false);
  }
  const threshold = radar.deriveMarketFamily({ subject: fixtures[4][0], atinara_question: fixtures[4][1] });
  assert.equal(threshold.family_child_key, "threshold:100:puntos");
  assert.equal(threshold.family_semantics.cumulative, true);
  assert.equal(threshold.family_semantics.mutually_exclusive, false);
});

test("Backend · metadatos atraviesan candidata, borrador, publicación y RPC pública segura", () => {
  for (const column of [
    "family_key", "family_title", "family_type", "family_child_key", "family_child_label",
    "family_sort_at", "family_relationship", "family_semantics", "family_source_event_key", "family_version",
  ]) assert.match(migration, new RegExp(`add column if not exists ${column}`));
  assert.match(migration, /assign_and_classify_market_candidate_family/);
  assert.match(migration, /assign_market_draft_family/);
  assert.match(migration, /assign_public_market_family/);
  assert.match(migration, /get_public_market_family_catalog/);
  assert.match(migration, /grant execute on function public\.get_public_market_family_catalog\(\) to anon, authenticated/);
  assert.match(migration, /set search_path = ''/);
  assert.match(migration, /markets_family_child_uidx/);
  assert.match(familyDerivationMigration, /market_family_threshold_key/);
  assert.match(familyDerivationMigration, /market_family_entity/);
  assert.match(familyDerivationMigration, /milestone_thresholds/);
  assert.doesNotMatch(familyDerivationMigration, /PlayStation 6|PS6|Grand Theft Auto|GTA VI/i);
  assert.match(candidateDuplicateMigration, /family_child_key = new\.family_child_key/);
  assert.match(candidateDuplicateMigration, /'relationship', 'exact_duplicate'/);
  assert.match(candidateDuplicateMigration, /'DUPLICATE_MARKET'/);
  assert.match(familyMatchDeduplicationMigration, /market_family_unique_jsonb_array/);
  assert.match(familyMatchDeduplicationMigration, /group by element\.item/);
  assert.match(familyMatchDeduplicationMigration, /zzz_deduplicate_market_candidate_family_arrays_before_write/);
  assert.doesNotMatch(familyMatchDeduplicationMigration, /public\.(markets|predictions|profiles)\s+(?:set|values)/i);
  assert.match(radarIdentityMigration, /market_candidate_blocking_duplicates/);
  assert.match(radarIdentityMigration, /element\.item ->> 'id' is distinct from self_id_input::text/);
  assert.match(radarIdentityMigration, /relationship' in \('exact_duplicate', 'semantic_duplicate'\)/);
  assert.match(radarIdentityMigration, /relationship' = 'sibling'/);
  assert.match(radarIdentityMigration, /reserve_market_radar_candidate_for_prepare/);
  assert.doesNotMatch(radarIdentityMigration, /(?:insert|update|delete)\s+(?:into\s+|from\s+)?public\.(?:markets|predictions|profiles)/i);
  assert.match(radarEdge, /get_admin_market_family_definitions/);
  assert.doesNotMatch(migration, /insert into public\.predictions|update public\.predictions|publish_market_draft\(/i);
});

function child(id, familyKey = null, sort = null) {
  return {
    id,
    pregunta: `Pregunta ${id}`,
    familyKey,
    familyTitle: familyKey ? "Fecha de lanzamiento · Juego" : "",
    familyType: familyKey ? "deadline_ladder" : "",
    familyChildKey: `deadline:${sort || id}`,
    familySortAt: sort,
    familySemantics: { economic_independence: true },
  };
}

test("Explorar · un hijo queda normal y dos hijos crean un padre sin probabilidad agregada", () => {
  assert.equal(explorer.groupMarkets([child("one", "family")])[0].kind, "market");
  const grouped = explorer.groupMarkets([
    child("late", "family", "2026-10-31T23:59:59Z"),
    child("early", "family", "2026-09-30T23:59:59Z"),
  ]);
  assert.equal(grouped[0].kind, "family");
  assert.deepEqual(grouped[0].children.map((item) => item.id), ["early", "late"]);
  assert.match(explorer.familySemanticsLabel(grouped[0]), /acumulativos y no exclusivos/);
  assert.doesNotMatch(home, /probabilidad agregada/i);
});

test("Explorar · búsqueda, llegada y publicación instantánea expanden y resaltan el hijo", () => {
  assert.match(home, /familyKeysMatchingQuery/);
  assert.match(home, /Boolean\(activeFilters\.query\.trim\(\)\)/);
  assert.match(landing, /familyChildren\.hidden = false/);
  assert.match(landing, /published-market-highlight/);
  assert.match(landing, /BroadcastChannel/);
  assert.match(landing, /initializeMarkets/);
});

test("Explorar · familia es responsive, accesible y no desborda", () => {
  assert.match(home, /aria-expanded/);
  assert.match(home, /aria-controls/);
  assert.match(home, /event\.key === "Escape"/);
  assert.match(styles, /\.market-family-card\s*\{[^}]*min-width:\s*0;[^}]*max-width:\s*100%;[^}]*overflow:\s*hidden;/s);
  assert.match(styles, /@media \(max-width: 380px\)/);
  assert.match(styles, /grid-template-columns:\s*minmax\(0, 1fr\)/);
});
