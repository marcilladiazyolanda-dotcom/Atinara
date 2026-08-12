const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { pathToFileURL } = require("node:url");
const { before, test } = require("node:test");

const root = join(__dirname, "..");
const read = (path) => readFileSync(join(root, path), "utf8");
const sharedPath = join(root, "supabase/functions/_shared/market-radar.mjs");
const radarEdge = read("supabase/functions/market-radar/index.ts");
const marketExpert = read("supabase/functions/market-expert/index.ts");
const adminJs = read("admin-markets.js");
const adminHtml = read("admin-markets.html");
const styles = read("styles.css");
const migration = read("supabase/migrations/20260811163339_replace_radar_fact_gate_with_eligibility_v7.sql");
let radar;

before(async () => {
  radar = await import(pathToFileURL(sharedPath).href);
});

const now = "2026-08-11T16:00:00.000Z";
const future = "2026-12-11T20:00:00.000Z";
const authoritativeDomains = new Set([
  "ea.com",
  "nintendo.com",
  "playstation.com",
  "store.steampowered.com",
]);

function polymarketOption(id, question, overrides = {}) {
  return {
    id,
    slug: id,
    question,
    description: "Resuelve con el anuncio oficial del organizador.",
    outcomes: '["Yes","No"]',
    outcomePrices: '["0.4","0.6"]',
    active: true,
    closed: false,
    acceptingOrders: true,
    endDate: future,
    ...overrides,
  };
}

function officialEvidence({ url, title, supports }) {
  return {
    url,
    title,
    supports,
    source_type: "official",
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
  };
}

test("Polymarket · una opción inactiva no convierte un evento padre futuro en cerrado", () => {
  const event = {
    id: "game-awards-best-multiplayer-2026",
    slug: "game-awards-best-multiplayer-2026",
    title: "The Game Awards: Best Multiplayer 2026",
    active: true,
    closed: false,
    archived: false,
    canonical_url_verified: true,
    markets: [
      polymarketOption("game-x", "Will Game X win Best Multiplayer at the 2026 Game Awards?"),
      polymarketOption("placeholder-y", "Will Game Y win Best Multiplayer at the 2026 Game Awards?", {
        active: false,
        acceptingOrders: false,
      }),
    ],
  };
  const [open, inactive] = radar.adaptPolymarketResponse({ events: [event] }, {
    now,
    canonicalUrlVerified: true,
  });

  assert.deepEqual(open.hard_reject_reasons, []);
  assert.equal(open.source_status, "open");
  assert.equal(inactive.source_status, "inactive");
  assert.ok(inactive.hard_reject_reasons.includes("PROVIDER_OPTION_INACTIVE"));
  assert.ok(!inactive.hard_reject_reasons.includes("PROVIDER_NOT_OPEN"));

  const openDecision = radar.applyDeterministicRadarEligibility(
    open,
    radar.evaluateProviderEligibility(open, now),
    now,
  );
  const inactiveDecision = radar.applyDeterministicRadarEligibility(
    inactive,
    radar.evaluateProviderEligibility(inactive, now),
    now,
  );
  assert.equal(openDecision.eligibility_status, "eligible");
  assert.equal(inactiveDecision.eligibility_status, "inactive_option");
});

test("AuditorÃ­a histÃ³rica Â· una opciÃ³n inactiva no se presenta como cierre del evento padre", () => {
  const archivedCandidate = {
    verification_status: "rejected_ineligible",
    verification_reason_code: "PROVIDER_NOT_OPEN",
    verification_reason: "El mercado de origen ya estÃ¡ cerrado.",
    eligibility_status: "inactive_option",
    source_status: "inactive",
    source_result: null,
    source_close_at: future,
    external_market_id: "placeholder-y",
    provider_payload: {
      canonical_url_verified: true,
      canonical_event_children_complete: true,
      canonical_event_children_total: 2,
      canonical_event_children: [
        { market_id: "game-x", status: "open", close_at: future, result: null },
        { market_id: "placeholder-y", status: "closed", close_at: future, result: null },
      ],
    },
  };

  const summary = radar.summarizeRejections([archivedCandidate]);
  assert.equal(summary.counts.PROVIDER_OPTION_INACTIVE, 1);
  assert.equal(summary.counts.PROVIDER_NOT_OPEN, undefined);
  assert.equal(summary.items[0].verification_reason_code, "PROVIDER_OPTION_INACTIVE");
  assert.equal(summary.items[0].recorded_verification_reason_code, "PROVIDER_NOT_OPEN");
});

test("Resolución conocida · una designación oficial exacta cierra toda la familia aunque el proveedor siga abierto", () => {
  const event = {
    id: "madden-27-cover",
    slug: "madden-27-cover-athlete",
    title: "Madden NFL 27: Cover Athlete",
    active: true,
    closed: false,
    canonical_url_verified: true,
    markets: [
      polymarketOption("caleb", "Will Caleb Williams be on the cover of Madden NFL 27?"),
      polymarketOption("aaron", "Will Aaron Rodgers be on the cover of Madden NFL 27?"),
      polymarketOption("lamar", "Will Lamar Jackson be on the cover of Madden NFL 27?"),
    ],
  };
  const candidates = radar.adaptPolymarketResponse({ events: [event] }, {
    now,
    canonicalUrlVerified: true,
  });
  for (const candidate of candidates) {
    candidate.source_resolution_rules = "The market resolves Yes if the player is announced as cover athlete or appears on any console edition. All editions, including Standard and Deluxe, count.";
    candidate.source_description = candidate.source_resolution_rules;
  }
  const partialEvidence = officialEvidence({
    url: "https://www.ea.com/games/example-football",
    title: "Official game artwork",
    supports: "The Madden NFL 27 Deluxe Edition cover art features Caleb Williams. The Madden NFL 27 mobile season features cover athlete Caleb Williams.",
  });
  assert.equal(radar.detectOfficialCoverEventResolution(candidates, [partialEvidence]), null);
  assert.equal(radar.detectOfficialCoverSelectionHold(candidates, [partialEvidence])?.selection_detected, true);
  const evidence = officialEvidence({
    url: "https://news.ea.com/press-releases/madden-nfl-27-cover-athlete",
    title: "Caleb Williams Named EA SPORTS Madden NFL 27 Cover Athlete",
    supports: "EA SPORTS announced that Caleb Williams will grace the cover of EA SPORTS Madden NFL 27. Williams appears on the Standard Edition cover and the Deluxe Edition cover features him.",
  });

  const resolution = radar.detectOfficialCoverEventResolution(candidates, [evidence]);
  assert.equal(resolution.selection_complete, true);
  assert.deepEqual(resolution.outcome_names, ["Caleb Williams"]);
  const signals = radar.buildCoverResolutionSignals(
    candidates.map((candidate, index) => ({
      ...candidate,
      verification_status: index === 0 ? "rejected_resolved" : "verified_open",
      verification_reason_code: index === 0 ? "EVENT_ALREADY_RESOLVED" : null,
      verification_confidence: index === 0 ? 100 : 85,
      verification_evidence: index === 0 ? resolution.evidence : [],
    })),
    now,
  );
  assert.equal(signals.length, candidates.length);
});

test("Fuentes · se elige la tienda oficial del mismo producto y no evidencia de otra opción", () => {
  const halfLife = {
    source_title: "Video games released this year",
    source_question: "Will Half-Life 3 release this year?",
    source_description: "PC release",
  };
  const halfLifeEvidence = [
    officialEvidence({
      url: "https://www.ea.com/games/ea-sports-fc/news",
      title: "EA SPORTS FC news",
      supports: "Latest EA SPORTS FC announcements.",
    }),
    officialEvidence({
      url: "https://www.nintendo.com/us/store/products/super-mario-galaxy-3-switch-2/",
      title: "Super Mario Galaxy 3",
      supports: "Official Nintendo product page for Super Mario Galaxy 3.",
    }),
    officialEvidence({
      url: "https://store.steampowered.com/app/123456/HalfLife_3/",
      title: "Half-Life 3 on Steam",
      supports: "Official Steam product page for Half-Life 3 on PC.",
    }),
  ];
  assert.equal(
    radar.selectVerifiedResolutionUrl(halfLife, halfLifeEvidence, authoritativeDomains),
    "https://store.steampowered.com/app/123456/HalfLife_3/",
  );

  const wolverine = {
    source_question: "Will Marvel's Wolverine release this year?",
    source_resolution_rules: "Release on PlayStation 5.",
  };
  const wolverineEvidence = [
    officialEvidence({
      url: "https://store.playstation.com/product/marvels-wolverine",
      title: "Marvel's Wolverine",
      supports: "Official PlayStation Store product page for Marvel's Wolverine on PS5.",
    }),
    officialEvidence({
      url: "https://store.steampowered.com/app/999999/Marvels_Wolverine/",
      title: "Marvel's Wolverine",
      supports: "A Steam page mentioning Marvel's Wolverine.",
    }),
  ];
  assert.equal(
    radar.selectVerifiedResolutionUrl(wolverine, wolverineEvidence, authoritativeDomains),
    "https://store.playstation.com/product/marvels-wolverine",
  );

  const mario = { source_question: "Will Super Mario Galaxy 3 release this year?" };
  assert.equal(
    radar.selectVerifiedResolutionUrl(mario, halfLifeEvidence, authoritativeDomains),
    "https://www.nintendo.com/us/store/products/super-mario-galaxy-3-switch-2/",
  );
});

test("Seguridad de fuentes · HTTPS no sustituye autoridad y evidencia exacta", () => {
  const candidate = {
    source_question: "Will Half-Life 3 release this year?",
    atinara_question: "¿Se lanzará Half-Life 3 este año?",
    atinara_category: "Lanzamientos",
    atinara_resolution_criteria: "Sí si la tienda oficial confirma el lanzamiento durante el periodo.",
    source_resolution_url: "https://unregistered-source.example/product/half-life-3",
  };
  assert.equal(
    radar.selectVerifiedResolutionUrl(candidate, [], authoritativeDomains),
    null,
  );
  assert.equal(radar.isAdaptedIdeaComplete(candidate), false);

  const steamEvidence = officialEvidence({
    url: "https://store.steampowered.com/app/123456/HalfLife_3/",
    title: "Half-Life 3 on Steam",
    supports: "Official Steam product page for Half-Life 3 on PC.",
  });
  const sourceUrl = radar.selectVerifiedResolutionUrl(candidate, [steamEvidence], authoritativeDomains);
  assert.equal(sourceUrl, steamEvidence.url);
  assert.equal(radar.isAdaptedIdeaComplete({
    ...candidate,
    atinara_resolution_source_url: sourceUrl,
    resolution_source_evidence: [steamEvidence],
    eligibility_evidence: [steamEvidence],
  }), true);
});

test("Autoridad resolutiva · un endpoint genérico o la evidencia de otra opción no habilitan la candidata", () => {
  const candidate = {
    provider: "kalshi",
    external_id: "kalshi:half-life-3",
    normalizer_version: "atinara-radar-v2",
    source_question: "Will Half-Life 3 release this year?",
    family_title: "Video games released this year",
    source_resolution_rules: "If Half-Life 3 is released before Jan 1, 2027, the market resolves Yes; otherwise it resolves No.",
    source_resolution_url: "https://store.steampowered.com/charts/mostplayed",
    source_resolution_provenance: {
      provider: "kalshi",
      source_url: "https://store.steampowered.com/charts/mostplayed",
      upstream_field: "market.settlement_sources",
      adapter_version: "atinara-radar-v2",
      declared_by_provider: true,
    },
  };
  const genericPage = {
    url: candidate.source_resolution_url,
    title: "Steam Charts",
    content: "Most played games on Steam, including a passing reference to Half-Life 3.",
    contentType: "text/html",
    contentSha256: "a".repeat(64),
  };
  assert.equal(
    radar.buildResolutionAuthorityEvidence(candidate, genericPage, now, authoritativeDomains),
    null,
  );

  const exactCandidate = {
    ...candidate,
    source_resolution_url: "https://store.steampowered.com/app/123456/HalfLife_3/",
    source_resolution_provenance: {
      ...candidate.source_resolution_provenance,
      source_url: "https://store.steampowered.com/app/123456/HalfLife_3/",
    },
  };
  const exactPage = {
    ...genericPage,
    url: exactCandidate.source_resolution_url,
    title: "Half-Life 3 on Steam",
  };
  const evidence = radar.buildResolutionAuthorityEvidence(
    exactCandidate,
    exactPage,
    now,
    authoritativeDomains,
  );
  assert.equal(evidence.parser_version, "atinara-resolution-authority-v3");
  assert.equal(evidence.candidate_external_id, exactCandidate.external_id);
  assert.equal(evidence.endpoint_identity_verified, true);
  assert.equal(
    radar.selectVerifiedResolutionUrl(exactCandidate, [evidence], authoritativeDomains),
    exactCandidate.source_resolution_url,
  );
  assert.equal(
    radar.selectVerifiedResolutionUrl({ ...exactCandidate, external_id: "kalshi:other-child" }, [evidence], authoritativeDomains),
    null,
  );
});

test("UI · todas las opciones son desplegables y cada tarjeta conserva su altura", () => {
  assert.match(adminJs, /const candidates = expanded \? allCandidates : highlightedCandidates/);
  assert.match(adminJs, /`Ver las \$\{childCount\} opciones`/);
  assert.match(adminJs, /Probabilidad del proveedor:/);
  assert.match(styles, /\.radar-candidate-grid\s*\{[\s\S]*?align-items:\s*start/);
  assert.match(styles, /\.radar-candidate-card\s*\{[\s\S]*?align-self:\s*start/);
});

test("Estado · cambiar de pestaña no relanza Radar y el cooldown usa el instante del servidor", () => {
  assert.match(adminJs, /if \(!state\.radar\.loaded\) await loadRadar\(false\);\s*else renderWorkspace\(\);/);
  assert.doesNotMatch(adminJs, /scheduleRadarFactualRefresh|radarFactualRefreshTimer/);
  assert.match(adminJs, /Date\.parse\(data\.cooldown_until \|\| ""\)/);
  assert.match(adminJs, /window\.setInterval\(updateRadarCooldownButton, 500\)/);
  assert.match(radarEdge, /cooldown_until:\s*new Date\(Date\.now\(\) \+ cooldownRemaining\)\.toISOString\(\)/);
});

test("Estado · una caída del enriquecimiento conserva el último expediente válido sin degradar al proveedor", () => {
  assert.match(radarEdge, /eligibility_state_preserved:\s*true/);
  assert.match(radarEdge, /provider_refresh_state:\s*"source_enrichment_degraded"/);
  assert.match(radarEdge, /persistableCandidates[\s\S]*?RESOLUTION_SOURCE_AUTHORITY_PENDING[\s\S]*?currentCandidatesByIdentity/);
  assert.match(radarEdge, /persistProviderResult\([\s\S]*?persistableCandidates,[\s\S]*?providerCandidates\.length/);
  assert.match(radarEdge, /errors\.push\(\{[\s\S]*?SOURCE_AUTHORITY_REGISTRY_UNAVAILABLE/);
  assert.match(radarEdge, /directAuthorityFallbackGroups[\s\S]*?authorityCandidateIds[\s\S]*?incompleteGroupKeys\.delete/);
  assert.match(radarEdge, /MAX_CANONICAL_EVENT_CHILDREN \+ 8/);
  assert.match(adminJs, /Elegible · estado conservado/);
  assert.match(adminJs, /OFFICIAL_TERMINAL_SCAN_UNAVAILABLE:\s*"Comprobación oficial temporalmente no disponible"/);
  assert.match(adminJs, /Es un fallo técnico reintentable y no una prueba de que el evento esté resuelto/);
});

test("Contrato · la revisión factual operativa queda retirada y la elegibilidad es append-only", () => {
  assert.doesNotMatch(adminHtml, /Actualizar comprobaci[oó]n factual y reanalizar/i);
  assert.doesNotMatch(adminJs, /recoverRadarExpertCandidate|revalidateRadarDraftFact/);
  assert.doesNotMatch(radarEdge, /if \(action === "revalidate"\)/);
  assert.match(radarEdge, /requestedAction === "revalidate" \? "check-eligibility"/);
  assert.match(radarEdge, /if \(action === "check-eligibility"\)/);
  assert.match(migration, /create table if not exists private\.market_radar_eligibility_checks/);
  assert.match(migration, /create table if not exists private\.market_radar_eligibility_attempts/);
  assert.match(migration, /RADAR_ELIGIBILITY_APPEND_ONLY/);
  assert.match(migration, /authoritative_pointer_unchanged', true/);
  assert.match(radarEdge, /record_market_radar_eligibility_attempt_v1/);
  assert.match(migration, /candidate\.eligibility_status = 'terminal'[\s\S]*?check_status <> 'terminal'/);
  assert.match(migration, /then 'technical_hold'[\s\S]*?ELIGIBILITY_REFRESH_REQUIRED/);
  assert.match(migration, /candidate\.id, provenance_revision/);
  assert.match(migration, /where code = 'RADAR_FACTUAL_VERIFICATION_REQUIRED'/);
  assert.match(adminHtml, /20260812-agent-engine2/);
});

test("Editor · la proyección segura conserva la elegibilidad autoritativa sin incluir leases en la huella", () => {
  for (const field of [
    "eligibility_status",
    "eligibility_reason_code",
    "eligibility_reason",
    "eligibility_evidence",
    "eligibility_checked_at",
    "eligibility_expires_at",
    "current_eligibility_check_id",
    "resolution_source_evidence",
  ]) {
    assert.match(marketExpert, new RegExp(`\\"${field}\\"`));
  }
  assert.match(marketExpert, /"eligibility_checked_at", "eligibility_expires_at", "current_eligibility_check_id"/);
  assert.doesNotMatch(marketExpert, /RADAR_FACTUAL_VERIFICATION_REQUIRED/);
});

test("Generalización · la lógica de producción no contiene títulos de las fixtures", () => {
  const production = `${read("supabase/functions/_shared/market-radar.mjs")}\n${radarEdge}\n${marketExpert}`;
  assert.doesNotMatch(production, /Madden|Marvel|Half[- ]Life|Big Walk|GTA VI|Grand Theft Auto|EA Sports FC ?27/i);
});
