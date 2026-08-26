import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  RADAR_CHILD_PROJECTION_VERSION,
  RADAR_DOMAIN_POLICY_VERSION,
  RADAR_DOMAIN_FINGERPRINT_VERSION,
  RADAR_FAMILY_VERSION,
  RADAR_NORMALIZER_VERSION,
  RADAR_PARENT_RECONCILIATION_VERSION,
  RADAR_PROVIDER_CHILD_CONTRACT_VERSION,
  RADAR_REASON_CODES,
  bindRadarCandidatesToReconciledChildren,
  buildProviderDiscoveryCheckpointV1,
  buildRadarPersistenceBatches,
  collapseLegacyChildRepresentations,
  collectProviderCursorPages,
  deriveMarketFamily,
  evaluateProviderEligibility,
  extractRadarOptionChild,
  isCanonicalRadarChildProjectionValid,
  isRadarParentComplete,
  localizeRadarProviderLabel,
  mergeProviderParentSelections,
  mergeProviderTaxonomySeriesV1,
  normalizeRadarCandidatePresentation,
  prioritizeProviderChildEvidenceAliases,
  radarOptionSlug,
  reconcileProviderParent,
  selectWholeProviderParents,
} from "../supabase/functions/_shared/market-radar.mjs";

const checkedAt = "2026-08-22T18:00:00.000Z";
const legacyRepresentationMigration = readFileSync(new URL(
  "../supabase/migrations/20260824153000_fix_radar_legacy_representation_reconciliation_v1.sql",
  import.meta.url,
), "utf8");
const partialParentPersistenceMigration = readFileSync(new URL(
  "../supabase/migrations/20260824180000_allow_partial_radar_parent_persistence_v1.sql",
  import.meta.url,
), "utf8");

function child(id, label, overrides = {}) {
  return {
    id: String(id),
    external_market_id: String(id),
    conditionId: `condition-${id}`,
    slug: `market-${id}`,
    question: `Will ${label} win Best Multiplayer at the 2026 Game Awards?`,
    groupItemTitle: label,
    status: "open",
    ...overrides,
  };
}

async function reconcile(children, overrides = {}) {
  return reconcileProviderParent({
    provider: "polymarket",
    provider_parent_id: "800696",
    raw_provider_parent_label: "The Game Awards: Best Multiplayer",
    canonical_parent_label: "The Game Awards · Mejor multijugador",
    provider_declared_child_count: children.length,
    provider_pagination_exhausted: true,
    children,
    checked_at: checkedAt,
    source_refs: [{
      url: "https://gamma-api.polymarket.com/events/800696",
      endpoint: "/events/800696",
      identifier_type: "event_id",
      identifier: "800696",
      result: "parent_children_enumerated",
      content_sha256: "a".repeat(64),
      observed_child_ids: children.map((item) => String(item.id ?? item.external_market_id ?? "")).filter(Boolean),
      checked_at: checkedAt,
    }],
    ...overrides,
  });
}

test("versiona normalizador, dominio, familia, reconciliación y proyección", () => {
  assert.equal(RADAR_NORMALIZER_VERSION, "atinara-radar-v3");
  assert.equal(RADAR_DOMAIN_POLICY_VERSION, "atinara-gaming-domain-v2");
  assert.equal(RADAR_DOMAIN_FINGERPRINT_VERSION, "atinara-radar-domain-fingerprint-v2");
  assert.equal(RADAR_FAMILY_VERSION, "atinara-market-family-v5");
  assert.equal(RADAR_PARENT_RECONCILIATION_VERSION, "atinara-radar-parent-reconciliation-v1");
  assert.equal(RADAR_CHILD_PROJECTION_VERSION, "atinara-radar-child-projection-v1");
  assert.equal(RADAR_PROVIDER_CHILD_CONTRACT_VERSION, "atinara-radar-provider-child-contract-v1");
});

test("la migración legacy es aditiva, bloquea drift y cuenta identidades lógicas", () => {
  assert.match(legacyRepresentationMigration,
    /a89b0b56766f91e9b3ecfe67af19cb6945112cff1b2666c2f9675630e8dbd60c/);
  assert.match(legacyRepresentationMigration,
    /count\(distinct private\.market_radar_legacy_candidate_logical_key_v1/);
  assert.match(legacyRepresentationMigration,
    /count\(distinct private\.market_radar_legacy_child_logical_key_v1/);
  assert.match(legacyRepresentationMigration, /RADAR_LEGACY_REPRESENTATION_PREFLIGHT_DRIFT/);
  assert.match(legacyRepresentationMigration, /^begin;/m);
  assert.match(legacyRepresentationMigration, /^commit;/m);
  assert.doesNotMatch(legacyRepresentationMigration,
    /\b(?:insert\s+into|update\s+private\.|delete\s+from|truncate\s+)\b/i);
});

test("la migración de padre parcial aísla el fallo sin volver candidate-ready al padre incompleto", () => {
  assert.match(partialParentPersistenceMigration,
    /RADAR_PARTIAL_PARENT_BATCH_PREFLIGHT_DRIFT/);
  assert.match(partialParentPersistenceMigration,
    /not provider_pagination_exhausted_value then 'partial_error'/);
  assert.match(partialParentPersistenceMigration,
    /RADAR_PARENT_RECONCILIATION_INCOMPLETE/);
  assert.match(partialParentPersistenceMigration,
    /coalesce\(intent\.response_summary,'\{\}'::jsonb\)/);
  assert.match(partialParentPersistenceMigration, /^begin;/m);
  assert.match(partialParentPersistenceMigration, /^commit;/m);
  assert.doesNotMatch(partialParentPersistenceMigration,
    /\b(?:insert\s+into|update\s+(?:public|private)\.|delete\s+from|truncate\s+)\b/i);
});

for (const count of [1, 3, 21, 48, 101, 480]) {
  test(`reconcilia exhaustivamente un padre de ${count} hijas`, async () => {
    const result = await reconcile(Array.from({ length: count }, (_, index) =>
      child(index + 1, `Option ${index + 1}`)));
    assert.equal(result.provider_declared_child_count, count);
    assert.equal(result.provider_discovered_child_count, count);
    assert.equal(result.provider_accounted_child_count, count);
    assert.equal(result.provider_identified_child_count, count);
    assert.equal(result.provider_unresolved_child_count, 0);
    assert.equal(result.reconciliation_status, "complete");
    assert.equal(result.children.filter((item) => item.present_in_current_snapshot).length, count);
    assert.match(result.reconciliation_fingerprint, /^[a-f0-9]{64}$/);
  });
}

test("48 declaradas con 21 identidades y 27 placeholders nunca se reducen a 21", async () => {
  const named = Array.from({ length: 21 }, (_, index) => child(index + 1, `Real Game ${index + 1}`));
  const placeholders = Array.from({ length: 26 }, (_, index) => child(100 + index, `Game ${String.fromCharCode(65 + index)}`, {
    active: false,
    status: "inactive",
  }));
  placeholders.push(child(200, "another game", { active: false, status: "inactive" }));
  const result = await reconcile([...named, ...placeholders]);
  assert.equal(result.provider_declared_child_count, 48);
  assert.equal(result.provider_accounted_child_count, 48);
  assert.equal(result.provider_identified_child_count, 21);
  assert.equal(result.provider_unresolved_child_count, 27);
  assert.equal(result.reconciliation_status, "incomplete_provider_metadata");
  assert.equal(result.children.filter((item) => item.identity_status === "unresolved_placeholder").length, 27);
});

test("un placeholder solo se resuelve mediante una identidad canónica demostrada", async () => {
  const result = await reconcile([child(3357362, "Game A", {
    canonical_child_label: "Marathon",
    identity_source: "polymarket_gamma_market_by_id",
    identity_evidence: [{
      url: "https://gamma-api.polymarket.com/markets/3357362",
      endpoint: "/markets/3357362",
      identifier_type: "external_market_id",
      identifier: "3357362",
      result: "identity_resolved",
      content_sha256: "b".repeat(64),
      checked_at: checkedAt,
    }],
  })]);
  const resolved = result.children[0];
  assert.equal(resolved.raw_provider_child_label, "Game A");
  assert.equal(resolved.canonical_child_label, "Marathon");
  assert.equal(resolved.canonical_child_key, "option:marathon");
  assert.equal(resolved.identity_confidence, 100);
  assert.equal(result.reconciliation_status, "complete");
});

test("la inactividad no oculta la prioridad de resolución de identidad", () => {
  const decision = evaluateProviderEligibility({
    identity_status: "unresolved_placeholder",
    identity_classification: "provider_placeholder_pending_resolution",
    hard_reject_reasons: [RADAR_REASON_CODES.PROVIDER_OPTION_INACTIVE],
    source_status: "inactive",
  }, checkedAt);
  assert.equal(decision.reason_code, RADAR_REASON_CODES.PROVIDER_CHILD_IDENTITY_RESOLUTION_REQUIRED);
  assert.equal(decision.conclusive, false);
});

test("un padre no es completo antes de agotar paginación o cuadrar el total", async () => {
  const pagePending = await reconcile([child(1, "Marathon")], {
    provider_pagination_exhausted: false,
  });
  assert.equal(pagePending.reconciliation_status, "refresh_required");

  const missingSecondPage = await reconcile([child(1, "Marathon")], {
    provider_declared_child_count: 3,
  });
  assert.equal(missingSecondPage.reconciliation_status, "inconsistent_provider_count");
});

test("consume todas las páginas y falla cerrado ante cursor repetido, página perdida o cursor pendiente", async () => {
  const pages = await collectProviderCursorPages(async (cursor) => cursor
    ? { events: [{ id: "second" }], cursor: "" }
    : { events: [{ id: "first" }], cursor: "next" }, {
    itemsField: "events", maxPages: 5,
  });
  assert.deepEqual(pages.items.map((item) => item.id), ["first", "second"]);
  assert.equal(pages.provider_pagination_exhausted, true);

  await assert.rejects(
    collectProviderCursorPages(async () => ({ events: [], cursor: "same" }), {
      itemsField: "events", maxPages: 5,
    }),
    /PROVIDER_CURSOR_REPEATED/,
  );
  await assert.rejects(
    collectProviderCursorPages(async (_cursor, page) => {
      if (page === 1) throw new Error("PROVIDER_TIMEOUT");
      return { events: [{ id: "first" }], cursor: "next" };
    }, { itemsField: "events", maxPages: 5 }),
    /PROVIDER_TIMEOUT/,
  );
  await assert.rejects(
    collectProviderCursorPages(async () => ({ events: [{ id: "only" }], cursor: crypto.randomUUID() }), {
      itemsField: "events", maxPages: 2,
    }),
    /PROVIDER_PAGINATION_INCOMPLETE/,
  );
});

for (const count of [48, 101, 480]) {
  test(`los ${count} expedientes se dividen por bytes sin superar el contrato SQL`, () => {
    const entries = Array.from({ length: count }, (_, index) => ({
      candidate: { external_id: `candidate-${index}`, payload: "x".repeat(34_000) },
      eligibility_check: { status: "eligible", evidence: [] },
    }));
    const batches = buildRadarPersistenceBatches(entries, { maxItems: 24, maxBytes: 700_000 });
    assert.equal(batches.flat().length, count);
    assert.ok(batches.length <= 100);
    for (const batch of batches) {
      assert.ok(batch.length <= 24);
      assert.ok(new TextEncoder().encode(JSON.stringify(batch)).byteLength <= 700_000);
    }
  });
}

test("un único expediente sobredimensionado falla antes de crear un batch", () => {
  assert.throws(() => buildRadarPersistenceBatches([{
    candidate: { external_id: "oversized", payload: "x".repeat(710_000) },
    eligibility_check: {},
  }], { maxBytes: 700_000 }), /RADAR_PERSISTENCE_ENTRY_TOO_LARGE/);
});

test("la selección respeta a la vez los límites de hijas y de padres sin truncar familias", () => {
  const events = Array.from({ length: 121 }, (_, index) => ({
    id: `parent-${index + 1}`,
    markets: [{ id: `child-${index + 1}` }],
  }));
  const result = selectWholeProviderParents(events, { maxChildren: 480, maxParents: 120 });
  assert.equal(result.selected.length, 120);
  assert.equal(result.selection.selected_parent_count, 120);
  assert.equal(result.selection.deferred_parent_count, 1);
  assert.equal(result.selection.selected_child_count, 120);
  assert.equal(result.selection.no_parent_truncated, true);
  assert.deepEqual(result.selection.deferred_parent_ids, ["parent-121"]);
  assert.equal(result.selection.selected_parent_ids.length, 120);

  const indexed = selectWholeProviderParents(
    Array.from({ length: 515 }, (_, index) => ({ id: `indexed-${index + 1}`, markets: [] })),
    { maxParents: 32, maxTotalParents: 2000, countChildren: false },
  );
  const childBudget = selectWholeProviderParents(indexed.selected.map((event, index) => ({
    ...event,
    markets: [{ id: `child-${index + 1}` }],
  })), { maxChildren: 240, maxParents: 24, maxTotalParents: 32 });
  const merged = mergeProviderParentSelections(indexed.selection, childBudget.selection);
  assert.equal(merged.total_parent_count, 515);
  assert.equal(merged.selected_parent_count, 24);
  assert.equal(merged.deferred_parent_count, 491);
  assert.equal(merged.deferred_parent_ids.length, 491);
  assert.equal(new Set([...merged.selected_parent_ids, ...merged.deferred_parent_ids]).size, 515);

  const oversized = [{ id: "oversized", markets: Array.from({ length: 481 }, (_, id) => ({ id })) }];
  assert.throws(() => selectWholeProviderParents(oversized), /PROVIDER_PARENT_CHILD_LIMIT_EXCEEDED/);
});

test("el índice de 2000 padres con IDs largos cabe en el límite SQL ampliado", () => {
  const events=Array.from({length:2000},(_,index)=>({
    id:`parent-${String(index).padStart(4,"0")}-${"x".repeat(195)}`,
  }));
  const result=selectWholeProviderParents(events,{
    maxChildren:480,maxParents:120,maxTotalParents:2000,countChildren:false,
  });
  assert.equal(result.selection.selected_parent_count,120);
  assert.equal(result.selection.deferred_parent_count,1880);
  assert.ok(new TextEncoder().encode(JSON.stringify(result.selection)).byteLength<1_048_576);
});

test("el checkpoint ejecutable conserva 215 series y 515 padres sin pérdida silenciosa", () => {
  const series = Array.from({ length: 215 }, (_, index) => ({
    ticker: `KXSERIES${String(index + 1).padStart(3, "0")}`,
    title: `Gaming series ${index + 1}`,
  }));
  const eventResults = series.map((item, index) => ({
    status: "fulfilled",
    value: Array.from({ length: index < 85 ? 3 : 2 }, (_, childIndex) => ({
      event_ticker: `${item.ticker}-EVENT-${childIndex + 1}`,
      series_ticker: item.ticker,
      title: `Parent ${index + 1}.${childIndex + 1}`,
    })),
  }));
  const checkpoint = buildProviderDiscoveryCheckpointV1({
    schema_version: "atinara-provider-discovery-checkpoint-v1",
    checked_at: "2026-08-25T20:00:00.000Z",
    taxonomy_scopes: [
      { category: "Entertainment", tag: "Video games" },
      { category: "Sports", tag: "Esports" },
    ],
    series,
    event_results: eventResults,
  });
  assert.equal(checkpoint.total_series_count, 215);
  assert.equal(checkpoint.total_taxonomy_scope_count, 2);
  assert.equal(checkpoint.completed_taxonomy_scope_count, 2);
  assert.equal(checkpoint.failed_taxonomy_scope_count, 0);
  assert.equal(checkpoint.completed_series_count, 215);
  assert.equal(checkpoint.failed_series_count, 0);
  assert.equal(checkpoint.total_parent_count, 515);
  assert.equal(new Set(checkpoint.events.map((event) => event.event_ticker)).size, 515);
  assert.ok(new TextEncoder().encode(JSON.stringify(checkpoint)).byteLength < 2_000_000);
});

test("la unión ejecutable de taxonomías conserva 215 series y todos los scopes", () => {
  const scopes = [
    { category: "Entertainment", tag: "Video games" },
    { category: "Sports", tag: "Esports" },
  ];
  const videoGames = Array.from({ length: 109 }, (_, index) => ({
    ticker: `KXVG${String(index + 1).padStart(3, "0")}`,
  }));
  const esports = [
    videoGames[0],
    ...Array.from({ length: 106 }, (_, index) => ({
      ticker: `KXES${String(index + 1).padStart(3, "0")}`,
    })),
  ];
  const merged = mergeProviderTaxonomySeriesV1([
    {
      status: "fulfilled",
      value: {
        scope: { category: "Entertainment", tag: "Video games" },
        series: videoGames,
      },
    },
    {
      status: "fulfilled",
      value: {
        scope: { category: "Sports", tag: "Esports" },
        series: esports,
      },
    },
  ], scopes);
  assert.equal(merged.entries.length, 215);
  assert.deepEqual(merged.failed_scopes, []);
  const shared = merged.entries.find((entry) => entry.source.ticker === videoGames[0].ticker);
  assert.deepEqual(shared.scopes, [
    { category: "Entertainment", tag: "Video games" },
    { category: "Sports", tag: "Esports" },
  ]);
});

test("una taxonomía caída se conserva para reintento sin derribar el alcance sano", () => {
  const scopes = [
    { category: "Entertainment", tag: "Video games" },
    { category: "Sports", tag: "Esports" },
  ];
  const merged = mergeProviderTaxonomySeriesV1([
    {
      status: "fulfilled",
      value: { scope: scopes[0], series: [{ ticker: "KXHEALTHY" }] },
    },
    { status: "rejected", reason: new Error("PROVIDER_TIMEOUT") },
  ], scopes);
  assert.deepEqual(merged.entries.map((entry) => entry.source.ticker), ["KXHEALTHY"]);
  assert.deepEqual(merged.failed_scopes, [scopes[1]]);

  const unavailable = mergeProviderTaxonomySeriesV1([
    { status: "rejected", reason: new Error("PROVIDER_TIMEOUT") },
    { status: "rejected", reason: new Error("PROVIDER_RATE_LIMITED") },
  ], scopes);
  assert.deepEqual(unavailable.entries, []);
  assert.deepEqual(unavailable.failed_scopes, scopes);

  const checkpoint = buildProviderDiscoveryCheckpointV1({
    schema_version: "atinara-provider-discovery-checkpoint-v1",
    checked_at: "2026-08-25T20:00:00.000Z",
    taxonomy_scopes: scopes,
    failed_taxonomy_scopes: merged.failed_scopes,
    series: [{ ticker: "KXHEALTHY" }],
    event_results: [{
      status: "fulfilled",
      value: [{ event_ticker: "KXHEALTHY-EVENT", series_ticker: "KXHEALTHY" }],
    }],
  });
  assert.equal(checkpoint.completed_taxonomy_scope_count, 1);
  assert.equal(checkpoint.failed_taxonomy_scope_count, 1);
  assert.deepEqual(checkpoint.failed_taxonomy_scopes, [scopes[1]]);
  assert.equal(checkpoint.total_parent_count, 1);

  assert.throws(() => buildProviderDiscoveryCheckpointV1({
    schema_version: "atinara-provider-discovery-checkpoint-v1",
    checked_at: "2026-08-25T20:00:00.000Z",
    taxonomy_scopes: [scopes[0]],
    failed_taxonomy_scopes: [scopes[1]],
    series: [],
    event_results: [],
  }), /PROVIDER_DISCOVERY_TAXONOMY_SCOPE_INVALID/);
});

test("un padre JSON equivalente no entra en conflicto por el orden de sus claves", () => {
  const checkpoint = buildProviderDiscoveryCheckpointV1({
    schema_version: "atinara-provider-discovery-checkpoint-v1",
    checked_at: "2026-08-25T20:00:00.000Z",
    series: [{ ticker: "KXONE" }],
    event_results: [{ status: "fulfilled", value: [
      { event_ticker: "SAME", series_ticker: "KXONE", title: "Equivalent" },
      { title: "Equivalent", series_ticker: "KXONE", event_ticker: "SAME" },
    ] }],
  });
  assert.equal(checkpoint.total_parent_count, 1);
});

test("el checkpoint aísla series caídas y falla cerrado ante identidad o pertenencia corrupta", () => {
  const series = [{ ticker: "KXGOOD" }, { ticker: "KXFAILED" }];
  const partial = buildProviderDiscoveryCheckpointV1({
    schema_version: "atinara-provider-discovery-checkpoint-v1",
    checked_at: "2026-08-25T20:00:00.000Z",
    series,
    event_results: [
      { status: "fulfilled", value: [{ event_ticker: "KXGOOD-EVENT", series_ticker: "KXGOOD" }] },
      { status: "rejected", reason: new Error("PROVIDER_TIMEOUT") },
    ],
  });
  assert.equal(partial.completed_series_count, 1);
  assert.deepEqual(partial.failed_series_ids, ["KXFAILED"]);
  assert.equal(partial.total_parent_count, 1);

  assert.throws(() => buildProviderDiscoveryCheckpointV1({
    schema_version: "atinara-provider-discovery-checkpoint-v1",
    checked_at: "2026-08-25T20:00:00.000Z",
    series,
    event_results: [
      { status: "fulfilled", value: [{ event_ticker: "WRONG", series_ticker: "KXFAILED" }] },
      { status: "fulfilled", value: [] },
    ],
  }), /PROVIDER_DISCOVERY_PARENT_MEMBERSHIP_INVALID/);

  assert.throws(() => buildProviderDiscoveryCheckpointV1({
    schema_version: "atinara-provider-discovery-checkpoint-v1",
    checked_at: "2026-08-25T20:00:00.000Z",
    series: [{ ticker: "KXONE" }],
    event_results: [{ status: "fulfilled", value: [
      { event_ticker: "DUPLICATE", series_ticker: "KXONE", title: "A" },
      { event_ticker: "DUPLICATE", series_ticker: "KXONE", title: "B" },
    ] }],
  }), /PROVIDER_DISCOVERY_PARENT_IDENTITY_CONFLICT/);

  assert.throws(() => buildProviderDiscoveryCheckpointV1({
    schema_version: "atinara-provider-discovery-checkpoint-v1",
    checked_at: "2026-08-25T20:00:00.000Z",
    series: [{ ticker: "KXONE", title: "x".repeat(2_000) }],
    event_results: [{ status: "fulfilled", value: [] }],
    max_bytes: 1_024,
  }), /PROVIDER_DISCOVERY_CHECKPOINT_TOO_LARGE/);
});

test("la evidencia heredada de una página solo acredita las hijas observadas en ella", async () => {
  const result = await reconcile([child(1, "Marathon"), child(2, "The Duskbloods")], {
    source_refs: [1, 2].map((id) => ({
      url: `https://gamma-api.polymarket.com/markets?offset=${id - 1}`,
      endpoint: "/markets",
      identifier_type: "event_id",
      identifier: "800696",
      result: "parent_children_enumerated",
      content_sha256: String(id).repeat(64),
      observed_child_ids: [String(id)],
      checked_at: checkedAt,
    })),
  });
  for (const reconciled of result.children) {
    assert.equal(reconciled.identity_evidence.length, 1);
    assert.match(reconciled.identity_evidence[0].url, new RegExp(`offset=${Number(reconciled.external_market_id) - 1}$`));
  }
});

test("evidencia parent de 480 hijas no se replica de forma cuadrática", async () => {
  const children = Array.from({ length: 480 }, (_, index) => child(
    `${String(index + 1).padStart(3, "0")}-${"x".repeat(180)}`,
    `Option ${index + 1}`,
  ));
  const result = await reconcile(children);
  const bytes = new TextEncoder().encode(JSON.stringify(result)).byteLength;
  assert.ok(bytes < 5_000_000, `payload de reconciliación inesperado: ${bytes}`);
  assert.ok(result.children.every((item) =>
    item.identity_evidence.every((evidence) => evidence.observed_child_ids.length <= 4)));
});

test("la evidencia de 480 hijas conserva una alias primaria por hija antes de extras", () => {
  const children=Array.from({length:480},(_,index)=>({
    id:`market-${index}`,
    conditionId:`condition-${index}`,
    slug:`slug-${index}`,
    clobTokenIds:[`token-${index}-yes`,`token-${index}-no`],
  }));
  const aliases=prioritizeProviderChildEvidenceAliases(children,1920);
  assert.equal(aliases.length,1920);
  for (let index=0;index<480;index+=1) assert.ok(aliases.includes(`market-${index}`));
});

test("membership por token o slug acredita la hija exacta sin market id", async () => {
  const result = await reconcile([
    {
      token_ids: ["token-only"], groupItemTitle: "Token Hero",
      question: "Will Token Hero win Best Multiplayer?", status: "open",
    },
    {
      slug: "slug-only", groupItemTitle: "Slug Hero",
      question: "Will Slug Hero win Best Multiplayer?", status: "open",
    },
  ], {
    source_refs: [{
      url: "https://gamma-api.polymarket.com/events/800696",
      endpoint: "/events/800696", identifier_type: "event_id", identifier: "800696",
      result: "parent_children_enumerated", content_sha256: "a".repeat(64),
      observed_child_ids: ["token-only", "slug-only"], checked_at: checkedAt,
    }],
  });
  assert.equal(result.reconciliation_status, "complete");
  assert.deepEqual(result.children.map((item) => item.canonical_child_label), ["Slug Hero", "Token Hero"]);
  assert.ok(result.children.every((item) => item.identity_evidence.length === 1));
});

test("las ocurrencias duplicadas se emparejan 1:1 entre snapshots", async () => {
  const previous = [
    { ...child(1, "Marathon"), provider_parent_id: "800696", child_occurrence_key: "market:1:0" },
    { ...child(1, "Marathon", { slug: "market-1-copy" }), provider_parent_id: "800696", child_occurrence_key: "market:1:1" },
  ];
  const twoToTwo = await reconcile([
    child(1, "Marathon"), child(1, "Marathon", { slug: "market-1-copy" }),
  ], { previous_children: previous });
  assert.equal(twoToTwo.children.length, 2);
  assert.equal(twoToTwo.children.filter((item) => item.present_in_legacy_snapshot).length, 2);

  const twoToOne = await reconcile([child(1, "Marathon")], { previous_children: previous });
  assert.equal(twoToOne.children.length, 2);
  assert.equal(twoToOne.children.filter((item) => !item.present_in_current_snapshot).length, 1);
  assert.equal(twoToOne.reconciliation_status, "historical_mapping_required");

  const oneToTwo = await reconcile([
    child(1, "Marathon"), child(1, "Marathon", { slug: "market-1-copy" }),
  ], { previous_children: [previous[0]] });
  assert.equal(oneToTwo.children.filter((item) => item.present_in_legacy_snapshot).length, 1);
  assert.equal(oneToTwo.children.filter((item) => item.transition === "new").length, 1);

  const reordered = await reconcile([
    child(1, "Marathon", { slug: "market-1-copy" }), child(1, "Marathon"),
  ], { previous_children: previous.toReversed() });
  assert.deepEqual(twoToTwo.children.map((item) => item.child_occurrence_key),
    reordered.children.map((item) => item.child_occurrence_key));
});

test("colapsa representaciones legacy del mismo market id sin ocultar conflictos fuertes", () => {
  const thin = {
    child_occurrence_key: "legacy:old-candidate", provider_parent_id: "499343",
    external_market_id: "2295650", child_fingerprint: "old", checked_at: "2026-08-06T15:27:56.544Z",
    provider_contract: { source_question: "Will Florian Wirtz be on the cover of EA Sports FC 27?" },
  };
  const rich = {
    ...thin, child_occurrence_key: "legacy:new-candidate", external_market_id: "polymarket:2295650",
    condition_id: "condition-2295650", child_slug: "will-florian-wirtz-be-on-the-cover-of-ea-sports-fc-27",
    child_fingerprint: "new", checked_at: "2026-08-16T18:00:15.426Z",
  };
  const collapsed = collapseLegacyChildRepresentations("polymarket", [thin, rich]);
  assert.equal(collapsed.length, 1);
  assert.equal(collapsed[0].external_market_id, "2295650");
  assert.equal(collapsed[0].provider_child_identity_key, "polymarket:market:2295650");
  assert.equal(collapsed[0].condition_id, "condition-2295650");
  assert.equal(collapsed[0].legacy_representation_count, 2);
  assert.equal(collapsed[0].legacy_representation_refs.length, 2);
  assert.equal(collapsed[0].legacy_identity_conflict, false);

  const conflicted = collapseLegacyChildRepresentations("polymarket", [
    rich, { ...rich, child_occurrence_key: "legacy:conflict", condition_id: "different-condition" },
  ]);
  assert.equal(conflicted.length, 1);
  assert.equal(conflicted[0].legacy_identity_conflict, true);

  const ledgerOccurrences = collapseLegacyChildRepresentations("polymarket", [
    { ...rich, child_occurrence_key: "polymarket:market:2295650:0" },
    { ...rich, child_occurrence_key: "polymarket:market:2295650:1" },
  ]);
  assert.equal(ledgerOccurrences.length, 2);
});

test("el contrato canónico firmado normaliza separadores de párrafo sin alterar el payload fuente", async () => {
  const sourceRules = "Regla principal.\n\nRegla secundaria.";
  const result = await reconcile([child(1, "Marathon", { source_resolution_rules: sourceRules })]);
  const projected = result.children[0];
  assert.equal(projected.provider_contract.source_resolution_rules, "Regla principal. Regla secundaria.");
  assert.equal(JSON.parse(projected.provider_contract_canonical_json).source_resolution_rules,
    "Regla principal. Regla secundaria.");
  assert.equal(sourceRules, "Regla principal.\n\nRegla secundaria.");
});

test("el binding candidata-hija usa condition/token y nunca posición cuando falta market id", () => {
  const children = [
    { child_occurrence_key: "a", condition_id: "condition-a", token_ids: ["token-a"], canonical_child_label: "Alpha" },
    { child_occurrence_key: "b", condition_id: "condition-b", token_ids: ["token-b"], canonical_child_label: "Beta" },
  ];
  const candidates = [
    { provider_payload: { condition_id: "condition-b", token_ids: ["token-b"] } },
    { provider_payload: { condition_id: "condition-a", token_ids: ["token-a"] } },
  ];
  const bound = bindRadarCandidatesToReconciledChildren(candidates, children);
  assert.deepEqual(bound.map((item) => item?.canonical_child_label), ["Beta", "Alpha"]);
  assert.deepEqual(bindRadarCandidatesToReconciledChildren([
    { provider_payload: { condition_id: "shared" } },
  ], [
    { condition_id: "shared", canonical_child_label: "One" },
    { condition_id: "shared", canonical_child_label: "Two" },
  ]), [null]);
});

test("un endpoint individual temporalmente caído deja el padre recuperable, nunca completo", async () => {
  const result = await reconcile([child(1, "Game A", {
    identity_resolution_unavailable: true,
    identity_evidence: [{
      url: "https://gamma-api.polymarket.com/markets/1",
      endpoint: "/markets/1",
      identifier_type: "external_market_id",
      identifier: "1",
      result: "PROVIDER_TIMEOUT",
      checked_at: checkedAt,
    }],
  })], { provider_unavailable: true });
  assert.equal(result.reconciliation_status, "provider_unavailable");
  assert.equal(result.provider_accounted_child_count, 1);
  assert.equal(result.provider_unresolved_child_count, 1);
});

test("distingue Other, empate y sin ganador sin inventar nombres", async () => {
  const result = await reconcile([
    child(1, "Other"),
    child(2, "Tie"),
    child(3, "No winner"),
  ]);
  assert.deepEqual(result.children.map((item) => item.identity_classification), [
    "aggregate_other_option", "tie_option", "no_winner_option",
  ]);
  assert.equal(result.reconciliation_status, "complete");
});

test("un duplicado del proveedor se contabiliza sin colapsar una hermana legítima", async () => {
  const result = await reconcile([
    child(1, "Marathon"),
    child(1, "Marathon", { slug: "duplicate-market-1" }),
    child(2, "The Duskbloods"),
  ]);
  assert.equal(result.provider_accounted_child_count, 3);
  assert.equal(result.provider_duplicate_child_count, 1);
  assert.equal(result.children[1].identity_classification, "provider_duplicate_child");
  assert.equal(result.reconciliation_status, "complete");
});

test("un duplicado placeholder con alias estable hereda la relación, no una identidad inventada", async () => {
  const result = await reconcile([
    child(1, "Marathon", { slug: "a-real" }),
    child(1, "Game A", { slug: "z-placeholder" }),
  ]);
  const duplicate = result.children.find((item) => item.identity_classification === "provider_duplicate_child");
  assert.ok(duplicate);
  assert.equal(duplicate.identity_source, "provider_stable_alias_duplicate");
  assert.equal(duplicate.identity_confidence, 100);
  assert.equal(result.reconciliation_status, "complete");
});

test("un tombstone actual se contabiliza como retirado solo con evidencia oficial", async () => {
  const result = await reconcile([child(1, "Game A", { status: "removed", active: false })]);
  assert.equal(result.children[0].identity_classification, "provider_removed_child");
  assert.equal(result.children[0].identity_status, "removed");
  assert.equal(result.children[0].identity_source, "provider_removed_child_verification");
  assert.equal(result.children[0].identity_confidence, 100);
  assert.ok(result.children[0].identity_evidence.some((item) => item.result === "provider_removed_child"));
  assert.equal(result.reconciliation_status, "complete");
});

test("un alias estable contradictorio o dos IDs fuertes con la misma etiqueta son conflicto", async () => {
  const conflict = await reconcile([
    child(1, "Marathon", { conditionId: "condition-a" }),
    child(1, "Marathon", { conditionId: "condition-b" }),
  ]);
  assert.equal(conflict.children[1].identity_classification, "provider_data_conflict");
  assert.equal(conflict.children[1].duplicate_of_child_identity_key,null);
  assert.equal(conflict.reconciliation_status, "terminal_provider_corruption");

  const collision = await reconcile([
    child(1, "Marathon", { conditionId: "condition-a" }),
    child(2, "Marathon", { conditionId: "condition-b" }),
  ]);
  assert.equal(collision.children[1].identity_classification, "provider_data_conflict");
  assert.equal(collision.reconciliation_status, "terminal_provider_corruption");
});

test("un ID movido de padre exige mapeo histórico y una hija eliminada queda auditada", async () => {
  const moved = await reconcile([child(1, "Marathon")], {
    previous_children: [{
      external_market_id: "1",
      provider_parent_id: "other-parent",
      raw_provider_child_label: "Marathon",
      question: "Will Marathon win?",
    }],
  });
  assert.equal(moved.reconciliation_status, "historical_mapping_required");
  assert.equal(moved.children[0].transition, "moved_parent");

  const removed = await reconcile([child(1, "Marathon")], {
    previous_children: [
      { external_market_id: "1", provider_parent_id: "800696", raw_provider_child_label: "Marathon" },
      {
        external_market_id: "2", provider_parent_id: "800696", raw_provider_child_label: "Legacy Game",
        removed_verified: true,
        identity_evidence: [{
          url: "https://gamma-api.polymarket.com/markets/2",
          endpoint: "/markets/2",
          identifier_type: "external_market_id",
          identifier: "2",
          result: "provider_removed_child",
          checked_at: checkedAt,
        }],
      },
    ],
  });
  assert.equal(removed.provider_removed_child_count, 1);
  assert.equal(removed.children.find((item) => item.external_market_id === "2").identity_classification, "provider_removed_child");
});

test("cerrar un placeholder legacy no acredita su nombre ni completa su historia", async () => {
  const result = await reconcile([child(1, "Marathon")], {
    previous_children: [
      { external_market_id: "1", provider_parent_id: "800696", raw_provider_child_label: "Marathon" },
      {
        external_market_id: "2", provider_parent_id: "800696", raw_provider_child_label: "Game A",
        question: "Will Game A win Best Multiplayer at the 2026 Game Awards?",
        closed_verified: true,
        identity_evidence: [{
          url: "https://gamma-api.polymarket.com/markets/2", endpoint: "/markets/2",
          identifier_type: "external_market_id", identifier: "2",
          result: "provider_closed_child", content_sha256: "c".repeat(64), checked_at: checkedAt,
        }],
      },
    ],
  });
  const closedPlaceholder = result.children.find((item) => item.external_market_id === "2");
  assert.equal(closedPlaceholder.identity_classification, "provider_placeholder_pending_resolution");
  assert.equal(closedPlaceholder.identity_status, "unresolved_placeholder");
  assert.equal(closedPlaceholder.availability_status, "closed");
  assert.equal(result.legacy_accounted_child_count, 1);
  assert.equal(result.reconciliation_status, "historical_mapping_required");
});

test("el ledger combinado conserva más de 480 ocurrencias entre actuales y retiradas", async () => {
  const current = Array.from({ length: 300 }, (_, index) => child(index + 1, `Current ${index + 1}`));
  const previous = [
    ...current.map((item) => ({
      external_market_id: item.external_market_id,
      provider_parent_id: "800696",
      raw_provider_child_label: item.groupItemTitle,
    })),
    ...Array.from({ length: 200 }, (_, index) => ({
      external_market_id: String(1000 + index), provider_parent_id: "800696",
      raw_provider_child_label: `Removed ${index + 1}`, removed_verified: true,
      identity_evidence: [{
        url: `https://gamma-api.polymarket.com/markets/${1000 + index}`,
        endpoint: `/markets/${1000 + index}`, identifier_type: "external_market_id",
        identifier: String(1000 + index), result: "provider_removed_child",
        content_sha256: "d".repeat(64), checked_at: checkedAt,
      }],
    })),
  ];
  const result = await reconcile(current, { previous_children: previous });
  assert.equal(result.provider_discovered_child_count, 300);
  assert.equal(result.children.length, 500);
  assert.equal(result.provider_removed_child_count, 200);
  assert.equal(result.legacy_expected_child_count, 500);
  assert.equal(result.legacy_accounted_child_count, 500);
  assert.equal(result.reconciliation_status, "complete");
});

test("cambios de slug o título conservan identidad cuando el ID estable coincide", async () => {
  const result = await reconcile([child(1, "Gears of War: E-Day", { slug: "new-slug" })], {
    previous_children: [{
      external_market_id: "1",
      provider_parent_id: "800696",
      child_slug: "old-slug",
      raw_provider_child_label: "Gears of War E Day",
    }],
  });
  assert.equal(result.children[0].provider_child_identity_key, "polymarket:market:1");
  assert.equal(result.children[0].transition, "renamed");
});

test("slug, título de presentación y URL de navegación no invalidan el contrato editorial", async () => {
  const base = await reconcile([child(1, "Marathon", {
    source_resolution_rules: "Resuelve Sí si Marathon gana.",
    source_resolution_url: "https://thegameawards.com/nominees/best-multiplayer",
  })]);
  const renamed = await reconcile([child(1, "Marathon", {
    slug: "marathon-renamed", title: "Ficha editorial actualizada",
    external_market_url: "https://polymarket.com/event/new-navigation-url",
    source_resolution_rules: "Resuelve Sí si Marathon gana.",
    source_resolution_url: "https://thegameawards.com/nominees/best-multiplayer",
  })]);
  assert.equal(renamed.children[0].provider_contract_hash, base.children[0].provider_contract_hash);
});

test("slug canónico conserva acentos, apóstrofes, subtítulos, números, guiones, siglas y Unicode", () => {
  assert.equal(radarOptionSlug("Marathon"), "marathon");
  for (const label of [
    "Pokémon Legends: Z-A", "Tom Clancy's The Division 3",
    "Gears of War: E-Day", "Call of Duty: Modern Warfare 4", "MMO-RPG X",
  ]) assert.match(radarOptionSlug(label), /-u-[a-f0-9]{8}$/);
  assert.match(radarOptionSlug("東京ゲーム"), /^u-(?:[a-f0-9]+-)*[a-f0-9]+-u-[a-f0-9]{8}$/);
  assert.notEqual(radarOptionSlug("東京ゲーム"), radarOptionSlug("大阪ゲーム"));
  assert.notEqual(radarOptionSlug("Game 星"), radarOptionSlug("Game 月"));
  assert.notEqual(radarOptionSlug(`${"A".repeat(180)}星`), radarOptionSlug(`${"A".repeat(180)}月`));
  assert.notEqual(radarOptionSlug("A 星 B"),radarOptionSlug("A B 星"));
  assert.notEqual(radarOptionSlug("José"),radarOptionSlug("Jose"));
  assert.notEqual(radarOptionSlug("Game's End"),radarOptionSlug("Game s End"));
  assert.equal(radarOptionSlug("POKÉMON"),radarOptionSlug("Pokémon"));
  assert.equal(radarOptionSlug("Poke\u0301mon"),radarOptionSlug("Pokémon"));
  assert.equal(radarOptionSlug("Tom Clancy’s"),radarOptionSlug("Tom Clancy's"));
  assert.equal(radarOptionSlug("E–Day"),radarOptionSlug("E-Day"));
});

test("la extracción contractual crea option:marathon y nunca usa deadline como identidad", () => {
  const candidate = {
    source_title: "The Game Awards: Best Multiplayer",
    source_question: "Will Marathon win Best Multiplayer at the 2026 Game Awards?",
    source_close_at: "2027-01-01T04:59:59.000Z",
    canonical_child_label: "Marathon",
    canonical_child_key: "option:marathon",
    identity_status: "resolved",
    identity_classification: "identified_real_option",
    canonical_projection_version: RADAR_CHILD_PROJECTION_VERSION,
  };
  assert.equal(extractRadarOptionChild(candidate).label, "Marathon");
  const family = deriveMarketFamily(candidate);
  assert.equal(family.family_type, "categorical_outcomes");
  assert.equal(family.family_child_key, "option:marathon");
  assert.equal(family.family_child_label, "Marathon");
  assert.match(family.family_semantics.temporal_boundary.canonical_instant, /^2027-01-01T/);
  assert.notEqual(family.family_child_key, `deadline:lte:${candidate.source_close_at}:year`);
});

test("una hija categórica temporal o un padre incompleto fallan cerrado", () => {
  const complete = {
    family_type: "categorical_outcomes",
    family_child_key: "option:marathon",
    family_child_label: "Marathon",
    canonical_child_key: "option:marathon",
    canonical_child_label: "Marathon",
    identity_status: "resolved",
    identity_classification: "identified_real_option",
    canonical_projection_version: RADAR_CHILD_PROJECTION_VERSION,
    parent_reconciliation_status: "complete",
    parent_reconciliation_version: RADAR_PARENT_RECONCILIATION_VERSION,
    provider_pagination_exhausted: true,
    provider_declared_child_count: 48,
    provider_discovered_child_count: 48,
    provider_accounted_child_count: 48,
    provider_unresolved_child_count: 0,
    provider_conflict_child_count: 0,
    parent_reconciliation_fingerprint: "9".repeat(64),
    external_event_id: "800696",
  };
  assert.equal(isCanonicalRadarChildProjectionValid(complete), true);
  assert.equal(isRadarParentComplete(complete), true);
  assert.equal(isCanonicalRadarChildProjectionValid({
    ...complete,
    family_child_key: "deadline:lte:2027-01-01T04:59:59.000Z:year",
    family_child_label: "lte 2027-01-01T04:59:59.000Z (ET, year)",
  }), false);
  assert.equal(isRadarParentComplete({ ...complete, provider_accounted_child_count: 47 }), false);
  assert.equal(isRadarParentComplete({ ...complete, provider_discovered_child_count: 47 }), false);
  assert.equal(isRadarParentComplete({ ...complete, provider_declared_child_count: null, provider_accounted_child_count: null }), false);
  assert.equal(isCanonicalRadarChildProjectionValid({ ...complete, family_child_key: "option:wrong" }), false);
  for (const label of ["ET","year","before 2027","by 2027","2027 (ET)"]) {
    const key=`option:${radarOptionSlug(label)}`;
    assert.equal(isCanonicalRadarChildProjectionValid({
      ...complete,family_child_key:key,canonical_child_key:key,
      family_child_label:label,canonical_child_label:label,
    }),false);
  }
  for (const label of ["Year Walk", "E.T. Legacy", "ET: The Game"]) {
    const key = `option:${radarOptionSlug(label)}`;
    assert.equal(isCanonicalRadarChildProjectionValid({
      ...complete,
      family_child_key: key,
      canonical_child_key: key,
      family_child_label: label,
      canonical_child_label: label,
    }), true);
  }
});

test("un placeholder estructurado no se convierte en el título repetido del padre", async () => {
  const result = await reconcile([{
    id: "kalshi-child-1",
    external_market_id: "kalshi-child-1",
    yes_sub_title: "Game A",
    title: "The Game Awards: Best Multiplayer",
    status: "open",
  }]);
  assert.equal(result.children[0].identity_status, "unresolved_placeholder");
  assert.equal(result.children[0].canonical_child_label, null);
  assert.equal(result.reconciliation_status, "incomplete_provider_metadata");
});

test("la pregunta contractual conserva mayúsculas y apóstrofes al extraer la opción", async () => {
  const result = await reconcile([{
    id: "question-only",
    external_market_id: "question-only",
    question: "Will Tom Clancy's The Division 3 win Best Multiplayer at the 2026 Game Awards?",
    status: "open",
  }]);
  assert.equal(result.children[0].canonical_child_label, "Tom Clancy's The Division 3");
  assert.equal(result.children[0].canonical_child_key,
    `option:${radarOptionSlug("Tom Clancy's The Division 3")}`);
});

test("una hija sin identificador estable nunca completa el padre", async () => {
  const result = await reconcile([{
    question: "Will Marathon win Best Multiplayer at the 2026 Game Awards?",
    groupItemTitle: "Marathon",
    status: "open",
  }]);
  assert.equal(result.children[0].provider_child_identity_key, null);
  assert.equal(result.children[0].identity_status, "conflict");
  assert.equal(result.reconciliation_status, "incomplete_provider_metadata");
});

test("reordenar hijas no cambia las huellas ni las occurrence keys", async () => {
  const first = await reconcile([child(1, "Marathon"), child(2, "The Duskbloods")]);
  const second = await reconcile([child(2, "The Duskbloods"), child(1, "Marathon")]);
  assert.equal(first.reconciliation_fingerprint, second.reconciliation_fingerprint);
  assert.deepEqual(first.children.map((item) => item.child_occurrence_key),
    second.children.map((item) => item.child_occurrence_key));
});

test("ruido raw no cambia la huella identitaria y un cambio de identidad sí", async () => {
  const baseEvidence = {
    url: "https://gamma-api.polymarket.com/events/800696",
    endpoint: "/events/800696",
    identifier_type: "event_id",
    identifier: "800696",
    result: "parent_children_enumerated",
    identity_sha256: "c".repeat(64),
    checked_at: checkedAt,
  };
  const first = await reconcile([child(1, "Marathon")], {
    source_refs: [{ ...baseEvidence, content_sha256: "1".repeat(64) }],
  });
  const second = await reconcile([child(1, "Marathon")], {
    source_refs: [{ ...baseEvidence, content_sha256: "2".repeat(64) }],
  });
  assert.equal(first.reconciliation_fingerprint, second.reconciliation_fingerprint);
  const changed = await reconcile([child(1, "The Duskbloods")], {
    source_refs: [{ ...baseEvidence, identity_sha256: "d".repeat(64), content_sha256: "2".repeat(64) }],
  });
  assert.notEqual(first.reconciliation_fingerprint, changed.reconciliation_fingerprint);
});

test("reglas, fuente o cierre del proveedor cambian la huella contractual de la hija", async () => {
  const base = child(1, "Marathon", {
    rules_primary: "Resuelve Sí si Marathon gana Mejor multijugador.",
    resolution_source_url: "https://thegameawards.com/nominees/best-multiplayer",
    endDate: "2026-12-11T04:59:59.000Z",
  });
  const first = await reconcile([base]);
  const same = await reconcile([{ ...base, volume: 999_999, liquidity: 123_456 }]);
  assert.equal(first.children[0].provider_contract.contract_version,
    RADAR_PROVIDER_CHILD_CONTRACT_VERSION);
  assert.match(first.children[0].provider_contract_hash, /^[a-f0-9]{64}$/);
  assert.equal(first.children[0].child_fingerprint, same.children[0].child_fingerprint);
  for (const changed of [
    { ...base, rules_primary: "Resuelve Sí solo tras la proclamación oficial." },
    { ...base, resolution_source_url: "https://thegameawards.com/winners" },
    { ...base, endDate: "2026-12-12T04:59:59.000Z" },
  ]) {
    const next = await reconcile([changed]);
    assert.notEqual(first.children[0].provider_contract_hash,
      next.children[0].provider_contract_hash);
    assert.notEqual(first.children[0].child_fingerprint,
      next.children[0].child_fingerprint);
    assert.notEqual(first.reconciliation_fingerprint, next.reconciliation_fingerprint);
  }
});

test("estado y resultado cambian elegibilidad, no el contrato estructural de la hija", async () => {
  const base = child(1, "Marathon", {
    rules_primary: "Resuelve Sí si Marathon gana Mejor multijugador.",
    endDate: "2026-12-11T04:59:59.000Z",
  });
  const open = await reconcile([base]);
  const closed = await reconcile([{ ...base, status: "closed", closed: true }]);
  const resolved = await reconcile([{
    ...base,status: "closed",closed: true,result: "yes",
  }]);
  assert.equal(open.children[0].provider_contract_hash,
    closed.children[0].provider_contract_hash);
  assert.equal(closed.children[0].provider_contract_hash,
    resolved.children[0].provider_contract_hash);
  assert.notEqual(open.children[0].child_fingerprint,
    closed.children[0].child_fingerprint);
  assert.notEqual(closed.children[0].child_fingerprint,
    resolved.children[0].child_fingerprint);
});

test("una hija contractual temporal conserva su familia y no exige option label", async () => {
  const result = await reconcile([{
    id: "release-1",
    external_market_id: "release-1",
    question: "Will GTA VI release before December 2026?",
    endDate: "2026-12-01T00:00:00Z",
    status: "open",
  }]);
  assert.equal(result.children[0].identity_kind, "contract");
  assert.equal(result.children[0].identity_status, "resolved");
  assert.equal(result.children[0].canonical_child_key, null);
  assert.equal(result.reconciliation_status, "complete");
  const family = deriveMarketFamily({
    source_question: "Will GTA VI release before December 2026?",
    source_close_at: "2026-12-01T00:00:00Z",
    identity_status: "resolved",
    identity_classification: "identified_real_option",
  });
  assert.notEqual(family.family_type, "platform_variants");
  assert.match(family.family_child_key, /^deadline:/);
});

test("la semántica categórica estructurada prevalece sobre una pregunta temporal o un label de umbral", () => {
  for (const canonicalChildLabel of ["Before December 2026", "Over 10"] ) {
    const family = deriveMarketFamily({
      source_question: "Will the release happen before December 2026?",
      source_close_at: "2026-12-01T00:00:00Z",
      identity_kind: "option",
      canonical_child_label: canonicalChildLabel,
      canonical_child_key: `option:${radarOptionSlug(canonicalChildLabel)}`,
      identity_status: "resolved",
      identity_classification: "identified_real_option",
    });
    assert.equal(family.family_type, "categorical_outcomes");
    assert.equal(family.family_child_key, `option:${radarOptionSlug(canonicalChildLabel)}`);
  }
});

test("un flag estructurado Other resuelve el significado sin perder el raw placeholder", async () => {
  const result = await reconcile([child(9, "another game", { negRiskOther: true })]);
  assert.equal(result.children[0].raw_provider_child_label, "another game");
  assert.equal(result.children[0].canonical_child_label, "Other");
  assert.equal(result.children[0].identity_classification, "aggregate_other_option");
  assert.equal(result.reconciliation_status, "complete");
});

test("Best Multiplayer se localiza de forma determinista y el original se conserva", () => {
  const label = localizeRadarProviderLabel("Best Multiplayer");
  assert.deepEqual(label, {
    original: "Best Multiplayer",
    label: "Mejor multijugador",
    translated: true,
    catalog_version: "atinara-radar-provider-labels-es-v1",
  });
  const unknown = localizeRadarProviderLabel("Best Experimental Category");
  assert.equal(unknown.label, "Best Experimental Category");
  assert.equal(unknown.translated, false);
  const presentation = normalizeRadarCandidatePresentation({
    source_title: "The Game Awards: Best Multiplayer",
    source_question: "Will Marathon win Best Multiplayer at the 2026 Game Awards?",
  });
  assert.equal(presentation.atinara_group_title, "The Game Awards · Mejor multijugador");
  assert.equal(presentation.atinara_question, "¿Ganará Marathon el premio Mejor multijugador en The Game Awards 2026?");
});
