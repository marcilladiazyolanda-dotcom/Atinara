const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { pathToFileURL } = require("node:url");
const { before, test } = require("node:test");

const root = path.resolve(__dirname, "..");
const radarPath = path.join(root, "supabase/functions/_shared/market-radar.mjs");
const edge = fs.readFileSync(path.join(root, "supabase/functions/market-radar/index.ts"), "utf8");
const admin = fs.readFileSync(path.join(root, "admin-markets.js"), "utf8");
const draftFixerUi = fs.readFileSync(path.join(root, "market-draft-fixer.js"), "utf8");
const migration = fs.readFileSync(path.join(root, "supabase/migrations/20260809140000_authoritative_radar_fact_gate_v1.sql"), "utf8");
const eligibilityMigration = fs.readFileSync(path.join(root, "supabase/migrations/20260811163339_replace_radar_fact_gate_with_eligibility_v7.sql"), "utf8");
const agentEngineMigration = fs.readFileSync(path.join(root, "supabase/migrations/20260811221546_close_agent_engine_confirmation_and_source_authority_v8.sql"), "utf8");
const reconciliationMigration = fs.readFileSync(path.join(root, "supabase/migrations/20260809145000_reconcile_authoritative_radar_fact_gate_v2.sql"), "utf8");
const legacyAttestationMatrix = fs.readFileSync(path.join(root, "supabase/tests/market_radar_legacy_fact_attestation_transaction.sql"), "utf8");
const publicationFlow = fs.readFileSync(path.join(root, "supabase/migrations/20260808144221_fix_atomic_resolution_plan_publication_flow.sql"), "utf8");
const administrationGate = fs.readFileSync(path.join(root, "supabase/migrations/20260803143000_add_market_administration_gate.sql"), "utf8");
const now = "2026-08-09T12:00:00.000Z";
let radar;

before(async () => {
  radar = await import(pathToFileURL(radarPath).href);
});

function eligibleCandidate(overrides = {}) {
  return {
    provider: "polymarket",
    external_id: "polymarket:fact-gate-fixture",
    source_question: "Will the fixture be announced before 2027?",
    atinara_question: "¿Se anunciará el fixture antes de 2027?",
    atinara_category: "Lanzamientos",
    atinara_resolution_criteria: "Sí si la fuente oficial lo anuncia antes del plazo.",
    atinara_resolution_source_url: "https://www.playstation.com/fixture",
    hard_reject_reasons: [],
    ...overrides,
  };
}

function verifiedOfficialEvidence(overrides = {}) {
  const supports = overrides.supports ?? "The fixture will be announced on December 1, 2026.";
  const excerpt = overrides.unresolved_proof_excerpt ?? (overrides.unresolved_proof === false ? null : supports);
  return {
    title: "Official fixture announcement",
    url: "https://www.playstation.com/fixture",
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
    supported_fact_statuses: excerpt ? ["unresolved"] : [],
    supported_contract_kinds: excerpt ? ["announcement"] : [],
    unresolved_proof: Boolean(excerpt),
    unresolved_proof_basis: excerpt ? "official_future_date_v1" : null,
    unresolved_until: excerpt ? "2026-12-01T12:00:00.000Z" : null,
    unresolved_proof_excerpt: excerpt,
    unresolved_proof_excerpt_sha256: excerpt ? createHash("sha256").update(excerpt).digest("hex") : null,
    ...overrides,
  };
}

const officialEvidence = [verifiedOfficialEvidence()];

test("la política factual v2 no aprueba una conclusión de IA sin evidencia", () => {
  assert.equal(radar.RADAR_FACT_POLICY_VERSION, "atinara-terminal-fact-gate-v2");
  const withoutEvidence = radar.applyEligibilityDecision(eligibleCandidate(), {
    eligible: true,
    conclusive: true,
    evidence: [],
  }, now);
  assert.equal(withoutEvidence.verification_status, "needs_review");
  assert.equal(withoutEvidence.fact_status, "unknown");

  const evidenced = radar.applyEligibilityDecision(eligibleCandidate(), {
    eligible: true,
    conclusive: true,
    fact_status: "unresolved",
    evidence: officialEvidence,
  }, now);
  assert.equal(evidenced.verification_status, "verified_open");
  assert.equal(evidenced.fact_status, "unresolved");
});

test("un hecho parcial o contradictorio nunca abre la puerta", () => {
  for (const factStatus of ["partially_resolved", "conflicting"]) {
    const result = radar.applyEligibilityDecision(eligibleCandidate(), {
      eligible: true,
      conclusive: true,
      fact_status: factStatus,
      evidence: officialEvidence,
    }, now);
    assert.equal(result.verification_status, "needs_review");
    assert.equal(result.fact_status, factStatus);
    assert.equal(result.state, "needs_review");
  }
});

test("fully_resolved prevalece sobre cierre de proveedor y duplicidad", () => {
  const resolvedEvidence = verifiedOfficialEvidence({
    supports: "The complete fixture selection has been officially announced.",
    unresolved_proof: false,
    selection_complete: true,
    supported_reason_codes: ["EVENT_ALREADY_RESOLVED"],
    supported_fact_statuses: ["fully_resolved"],
    supported_contract_kinds: [],
  });
  const result = radar.applyEligibilityDecision(eligibleCandidate({
    hard_reject_reasons: ["PROVIDER_NOT_OPEN", "INVALID_OR_UNVERIFIED_SOURCE", "DUPLICATE_MARKET"],
  }), {
    eligible: false,
    conclusive: true,
    fact_status: "fully_resolved",
    reason_code: "EVENT_ALREADY_RESOLVED",
    evidence: [resolvedEvidence],
  }, now);
  assert.equal(result.verification_status, "rejected_resolved");
  assert.equal(result.verification_reason_code, "EVENT_ALREADY_RESOLVED");
  assert.equal(result.fact_status, "fully_resolved");
});

test("una portada parcial o con continuaciones no cierra la familia", () => {
  const names = ["Player One", "Player Two", "Player Three"];
  const children = names.map((name) => ({ question: `Will ${name} be on the cover of Example FC 28?` }));
  const candidates = names.map((name) => ({
    source_question: `Will ${name} be on the cover of Example FC 28?`,
    provider_payload: {
      canonical_event_children: children,
      canonical_event_children_total: children.length,
      canonical_event_children_complete: true,
    },
  }));
  const partial = radar.detectOfficialCoverEventResolution(candidates, [{
    ...verifiedOfficialEvidence({ unresolved_proof: false }),
    url: "https://www.ea.com/example-fc-28",
    title: "Example FC 28 regional cover",
    supports: "Player One is the regional cover athlete; more covers will be revealed later.",
  }]);
  assert.equal(partial, null);

  const incompleteEditions = radar.detectOfficialCoverEventResolution(candidates, [{
    ...verifiedOfficialEvidence({ unresolved_proof: false }),
    url: "https://www.ea.com/example-fc-28",
    title: "Example FC 28 covers",
    supports: "Player One appears on the Standard and Ultimate Edition covers.",
  }]);
  assert.equal(incompleteEditions, null);

  const complete = radar.detectOfficialCoverEventResolution(candidates, [{
    ...verifiedOfficialEvidence({ unresolved_proof: false }),
    url: "https://www.ea.com/example-fc-28",
    title: "Complete Example FC 28 cover lineup",
    supports: "The complete cover lineup is Player One and Player Two for all editions.",
  }]);
  assert.equal(complete?.selection_complete, true);
  assert.equal(complete?.fact_status, "fully_resolved");
});

test("rumor, predicción, voto o lenguaje modal nunca cierran una portada aunque el host sea oficial", () => {
  const names = ["Player One", "Player Two", "Player Three"];
  const children = names.map((name) => ({ question: `Will ${name} be on the cover of Example FC 28?` }));
  const candidates = names.map((name) => ({
    source_question: `Will ${name} be on the cover of Example FC 28?`,
    provider_payload: {
      canonical_event_children: children,
      canonical_event_children_total: children.length,
      canonical_event_children_complete: true,
    },
  }));
  for (const supports of [
    "Our prediction says Player One could be on the complete cover lineup.",
    "Rumor: Player One may feature on the full cover lineup.",
    "Vote now for fan favorite Player One in the complete cover lineup poll.",
  ]) {
    const evidence = verifiedOfficialEvidence({
      url: "https://www.ea.com/example-fc-28",
      title: "Complete Example FC 28 cover lineup",
      supports,
      unresolved_proof: false,
    });
    assert.equal(radar.detectOfficialCoverEventResolution(candidates, [evidence]), null);
  }
});

test("Gemini no puede otorgar ni apertura ni resolución terminal", () => {
  const candidate = eligibleCandidate();
  const directButUnbound = verifiedOfficialEvidence({
    supports: "PlayStation publishes official product news.",
    unresolved_proof: false,
  });
  const terminal = radar.applyEligibilityDecision(candidate, {
    eligible: false,
    conclusive: true,
    fact_status: "fully_resolved",
    reason_code: "EVENT_ALREADY_RESOLVED",
    evidence: [directButUnbound],
  }, now);
  assert.equal(terminal.verification_status, "needs_review");
  assert.equal(terminal.fact_status, "unknown");

  const invalid = radar.applyEligibilityDecision(candidate, {
    eligible: false,
    conclusive: true,
    reason_code: "INVALID_OR_UNVERIFIED_SOURCE",
    evidence: [],
  }, now);
  assert.equal(invalid.verification_status, "needs_review");

  const unrelatedNegative = radar.applyEligibilityDecision(candidate, {
    eligible: false,
    conclusive: true,
    reason_code: "SUBJECT_NOT_ANNOUNCED",
    evidence: [directButUnbound],
  }, now);
  assert.equal(unrelatedNegative.verification_status, "needs_review");
});

test("verified_open exige proof futura tipada y rechaza contenido terminal contradictorio", () => {
  const candidate = eligibleCandidate({
    source_question: "Will Grand Theft Auto VI release before 2027?",
    atinara_question: "¿Se lanzará Grand Theft Auto VI antes de 2027?",
  });
  for (const supports of [
    "Grand Theft Auto VI is available worldwide from August 1, 2026.",
    "Grand Theft Auto VI launches worldwide on August 1, 2026.",
    "Grand Theft Auto VI arrived in stores worldwide.",
    "Grand Theft Auto VI salió a la venta mundialmente.",
    "Grand Theft Auto VI hit stores worldwide today.",
    "Grand Theft Auto VI went on sale worldwide.",
    "Grand Theft Auto VI is now playable.",
    "Grand Theft Auto VI shipped worldwide today.",
    "Grand Theft Auto VI ya se puede comprar.",
    "Grand Theft Auto VI llegó a las tiendas.",
  ]) {
    const result = radar.applyEligibilityDecision(candidate, {
      eligible: true,
      conclusive: true,
      fact_status: "unresolved",
      evidence: [verifiedOfficialEvidence({ supports, unresolved_proof: false })],
    }, now);
    assert.equal(result.verification_status, "needs_review", supports);
  }

  const excerpt = "Grand Theft Auto VI will be released on December 1, 2026.";
  const proof = verifiedOfficialEvidence({
    supports: excerpt,
    unresolved_proof_excerpt: excerpt,
    unresolved_proof_excerpt_sha256: createHash("sha256").update(excerpt).digest("hex"),
    unresolved_until: "2026-12-01T12:00:00.000Z",
    supported_contract_kinds: ["release"],
  });
  const approved = radar.applyEligibilityDecision(candidate, {
    eligible: true,
    conclusive: true,
    fact_status: "unresolved",
    evidence: [proof],
  }, now);
  assert.equal(approved.verification_status, "verified_open");

  const contradictory = radar.applyEligibilityDecision(candidate, {
    eligible: true,
    conclusive: true,
    fact_status: "unresolved",
    evidence: [{ ...proof, supports: `Grand Theft Auto VI is available now. ${excerpt}` }],
  }, now);
  assert.equal(contradictory.verification_status, "needs_review");
});

test("el parser puro liga identidad, predicado y fecha y no mezcla GTA VI con GTA Online", () => {
  const group = {
    title: "Grand Theft Auto VI release",
    candidates: [{
      source_title: "Grand Theft Auto VI release",
      source_question: "Will Grand Theft Auto VI release before 2027?",
      source_close_at: "2026-12-31T23:59:59.000Z",
    }],
  };
  assert.equal(radar.deriveDeterministicUnresolvedProof(
    "GTA Online event launches on October 31, 2026.", group, now,
  ), null);
  assert.equal(radar.deriveDeterministicUnresolvedProof(
    "Grand Theft Auto VI is available now. Grand Theft Auto VI expansion will launch on October 31, 2026.",
    group,
    now,
  ), null);
  const valid = radar.deriveDeterministicUnresolvedProof(
    "Grand Theft Auto VI will launch on December 1, 2026.", group, now,
  );
  assert.equal(valid?.until, "2026-12-01T12:00:00.000Z");
  assert.deepEqual(valid?.contractKinds, ["release"]);
  assert.match(edge, /deriveDeterministicUnresolvedProof\(page\.content, group, retrievedAt\)/);
});

test("el parser da precedencia al lanzamiento material y respeta la plataforma contractual", () => {
  const excerpt = "Grand Theft Auto VI launches for PC on September 1, 2026.";
  const genericCandidate = eligibleCandidate({
    source_title: "Grand Theft Auto VI release",
    source_question: "Will Grand Theft Auto VI release before November 1, 2026?",
    atinara_question: "¿Se lanzará Grand Theft Auto VI antes del 1 de noviembre de 2026?",
    source_close_at: "2026-11-01T00:00:00.000Z",
  });
  const genericGroup = {
    title: "Grand Theft Auto VI release",
    candidates: [genericCandidate],
  };
  for (const terminalClaim of [
    "Grand Theft Auto VI hit stores worldwide today",
    "Grand Theft Auto VI went on sale worldwide",
    "Grand Theft Auto VI is now playable",
    "Grand Theft Auto VI shipped",
    "Grand Theft Auto VI is currently available worldwide",
    "Grand Theft Auto VI is now live worldwide",
    "Grand Theft Auto VI can be played now worldwide",
    "The Grand Theft Auto VI global launch took place today",
    "The Grand Theft Auto VI worldwide launch is complete",
    "Grand Theft Auto VI ya se puede comprar",
    "Grand Theft Auto VI llegó a las tiendas",
    "Grand Theft Auto VI se estrenó hoy en todo el mundo",
    "El lanzamiento de Grand Theft Auto VI ya se produjo",
  ]) {
    assert.equal(radar.deriveDeterministicUnresolvedProof(
      `${terminalClaim}. ${excerpt}`,
      genericGroup,
      now,
    ), null, terminalClaim);
    const terminalEvidence = verifiedOfficialEvidence({
      supports: `${terminalClaim}. ${excerpt}`,
      unresolved_proof_excerpt: excerpt,
      unresolved_proof_excerpt_sha256: createHash("sha256").update(excerpt).digest("hex"),
      unresolved_until: "2026-09-01T12:00:00.000Z",
      supported_contract_kinds: ["release"],
    });
    assert.equal(radar.applyEligibilityDecision(genericCandidate, {
      eligible: true,
      conclusive: true,
      fact_status: "unresolved",
      evidence: [terminalEvidence],
    }, now).verification_status, "needs_review", terminalClaim);
  }

  const pcGroup = {
    title: "Grand Theft Auto VI PC release",
    candidates: [{
      source_title: "Grand Theft Auto VI PC release",
      source_question: "Will Grand Theft Auto VI release for PC before November 1, 2026?",
      source_close_at: "2026-11-01T00:00:00.000Z",
    }],
  };
  const scopedProof = radar.deriveDeterministicUnresolvedProof(
    "Grand Theft Auto VI hit stores for consoles worldwide today. Grand Theft Auto VI launches for PC on September 1, 2026.",
    pcGroup,
    now,
  );
  assert.equal(scopedProof?.until, "2026-09-01T12:00:00.000Z");
  assert.deepEqual(scopedProof?.contractKinds, ["release"]);
  assert.equal(radar.deriveDeterministicUnresolvedProof(
    "Grand Theft Auto VI is now playable worldwide. Grand Theft Auto VI launches for PC on September 1, 2026.",
    pcGroup,
    now,
  ), null);
  for (const coreferentialTerminal of [
    "Grand Theft Auto VI is our newest title. It is now available worldwide.",
    "Grand Theft Auto VI is our newest title. Today, it is now available worldwide.",
    "Grand Theft Auto VI is our newest title. After years of anticipation, it is now available.",
    "Grand Theft Auto VI is our newest title. Fans have waited years. It is now available.",
    "Grand Theft Auto VI is our newest title. And now, the game is available.",
    "Grand Theft Auto VI is our newest title. Fans have waited years. The studio thanks the community. It is now available worldwide.",
    `Grand Theft Auto VI is our newest title. ${"After a long international campaign, ".repeat(5)}today it is now available worldwide.`,
    "Grand Theft Auto VI is our newest title. Available now worldwide.",
    "Grand Theft Auto VI is our newest title. OUT NOW.",
    "Grand Theft Auto VI is our newest title. Launch complete.",
  ]) {
    assert.equal(radar.deriveDeterministicUnresolvedProof(
      `${coreferentialTerminal} Grand Theft Auto VI launches for PC on September 1, 2026.`,
      pcGroup,
      now,
    ), null, coreferentialTerminal);
  }
  assert.equal(radar.deriveDeterministicUnresolvedProof(
    "Grand Theft Auto VI for PC hit stores worldwide today. Grand Theft Auto VI PC expansion launches on September 1, 2026.",
    pcGroup,
    now,
  ), null);

  for (const [candidatePlatform, terminalPlatform, futurePlatform] of [
    ["PS5", "PlayStation", "PS5"],
    ["Steam", "PC", "Steam"],
    ["PC", "Steam", "PC"],
    ["Xbox Series X", "Xbox", "Xbox Series X"],
  ]) {
    const platformGroup = {
      title: `Grand Theft Auto VI ${candidatePlatform} release`,
      candidates: [{
        source_title: `Grand Theft Auto VI ${candidatePlatform} release`,
        source_question: `Will Grand Theft Auto VI release for ${candidatePlatform} before November 1, 2026?`,
        source_close_at: "2026-11-01T00:00:00.000Z",
      }],
    };
    assert.equal(radar.deriveDeterministicUnresolvedProof(
      `Grand Theft Auto VI is now available on ${terminalPlatform}. Grand Theft Auto VI will be released for ${futurePlatform} on September 1, 2026.`,
      platformGroup,
      now,
    ), null, `${candidatePlatform} / ${terminalPlatform}`);
  }

  const pcCandidate = eligibleCandidate({
    source_question: "Will Grand Theft Auto VI release for PC before November 1, 2026?",
    atinara_question: "¿Se lanzará Grand Theft Auto VI para PC antes del 1 de noviembre de 2026?",
  });
  const scopedEvidence = verifiedOfficialEvidence({
    supports: `Grand Theft Auto VI hit stores for consoles worldwide today. ${excerpt}`,
    unresolved_proof_excerpt: excerpt,
    unresolved_proof_excerpt_sha256: createHash("sha256").update(excerpt).digest("hex"),
    unresolved_until: "2026-09-01T12:00:00.000Z",
    supported_contract_kinds: ["release"],
  });
  assert.equal(radar.applyEligibilityDecision(pcCandidate, {
    eligible: true,
    conclusive: true,
    fact_status: "unresolved",
    evidence: [scopedEvidence],
  }, now).verification_status, "verified_open");
  assert.equal(radar.applyEligibilityDecision(pcCandidate, {
    eligible: true,
    conclusive: true,
    fact_status: "unresolved",
    evidence: [{
      ...scopedEvidence,
      supports: `Grand Theft Auto VI is now playable worldwide. ${excerpt}`,
    }],
  }, now).verification_status, "needs_review");
  assert.equal(radar.applyEligibilityDecision(genericCandidate, {
    eligible: true,
    conclusive: true,
    fact_status: "unresolved",
    evidence: [scopedEvidence],
  }, now).verification_status, "needs_review");
});

test("el parser puro conserva abierto Marvel solo por ancla oficial +7 días", () => {
  const marvel = {
    title: "Marvel Tokon Fighting Souls Metacritic score",
    candidates: [{
      source_title: "Marvel Tokon: Fighting Souls: Metacritic score",
      source_question: "Will Marvel Tokon: Fighting Souls have a Metacritic score above 95 seven days after release?",
      source_resolution_rules: "Above 95 seven days after release at 10:00AM ET",
      source_close_at: "2026-08-13T14:00:00.000Z",
      source_resolution_deadline: "2026-08-13T14:00:00.000Z",
    }],
  };
  const proof = radar.deriveDeterministicUnresolvedProof(
    "Marvel Tōkon: Fighting Souls launches on August 6, 2026.", marvel, now,
  );
  assert.equal(proof?.until, "2026-08-13T14:00:00.000Z");
  assert.deepEqual(proof?.contractKinds, ["review"]);
  assert.equal(radar.deriveDeterministicUnresolvedProof(
    "A different fighting game launches on August 6, 2026.", marvel, now,
  ), null);
});

test("descubrimiento, preparación y persistencia usan la puerta atómica de elegibilidad", () => {
  assert.match(edge, /upsert_market_radar_batch_with_eligibility_v1/);
  assert.match(edge, /apply_market_radar_prepare_eligibility_v1/);
  assert.doesNotMatch(edge, /rpc\(environment, "upsert_market_radar_batch_v2"/);
  assert.doesNotMatch(edge, /rpc\(environment, "record_market_radar_fact_checks"/);
  assert.doesNotMatch(edge, /rpc\(environment, "apply_market_radar_prepare_verification"/);
  assert.match(edge, /eligibility_check_input: eligibilityCheck/);
  assert.ok(edge.indexOf("apply_market_radar_prepare_eligibility_v1") < edge.indexOf("if (!applied?.ok)"));
  assert.match(edge, /requires_eligibility_refresh: !cachedAuthoritative/);
  assert.match(edge, /applyDeterministicRadarEligibility\(candidate, providerDecision, now\)/);
  assert.match(edge, /ELIGIBILITY_SCAN_UNAVAILABLE/);
  assert.match(eligibilityMigration, /create table if not exists private\.market_radar_eligibility_checks/);
  assert.match(eligibilityMigration, /RADAR_ELIGIBILITY_APPEND_ONLY/);
  assert.match(eligibilityMigration, /candidate\.eligibility_status = 'terminal'[\s\S]*?item ->> 'eligibility_status' is distinct from 'terminal'/);
  assert.match(edge, /\/rest\/v1\/rpc\/\$\{name\}/);
  assert.doesNotMatch(edge, /\/rest\/v1\/(?:external_market_candidates|market_radar_fact_checks)/);
  assert.doesNotMatch(edge, /\.from\(["'`](?:external_market_candidates|market_radar_fact_checks)["'`]\)/);
});

test("la elegibilidad y los cierres oficiales se evalúan antes del score", () => {
  const runStart = edge.indexOf("async function runDiscovery");
  const runEnd = edge.indexOf("function candidatePreflight", runStart);
  const run = edge.slice(runStart, runEnd);
  assert.ok(run.indexOf("applyDeterministicRadarEligibility") < run.lastIndexOf("scoreCandidates"));
  assert.ok(run.indexOf("officialEventResolutionSignals") < run.lastIndexOf("scoreCandidates"));
  assert.match(run, /candidate\.eligibility_status !== "eligible"/);
  assert.doesNotMatch(run, /verifyAndAdaptWithGemini\(/);
  assert.equal((run.match(/scoreCandidates\(/g) || []).length, 1);
});

test("la autoridad de fuentes viene del registro privado y falla cerrado", () => {
  assert.doesNotMatch(edge, /OFFICIAL_EVIDENCE_HOSTS/);
  assert.match(edge, /get_market_radar_authoritative_source_domains_v1/);
  assert.match(edge, /if \(!authoritativeDomains\.size\) throw new Error\("SOURCE_REGISTRY_UNAVAILABLE"\)/);
  assert.match(edge, /include_domains: \[\.\.\.authoritativeDomains\]/);
  assert.match(edge, /retrieval_status: "verified_content"/);
  assert.match(edge, /evidence_basis: "retrieved_content"/);
  assert.match(edge, /fetchVerifiedOfficialPage/);
  assert.match(edge, /rawModelTerminal/);
  assert.match(migration, /private\.market_source_registry/);
  assert.match(migration, /allowed_roles @> '\["radar_fact_evidence"\]'::jsonb/);
  assert.match(migration, /allowed_roles @> '\["provider_fact"\]'::jsonb/);
  assert.match(migration, /verification_status_value = 'verified_open'[\s\S]*market_radar_sources_nonterminal_v1\(source_value, checked_at_value\)/);
  assert.ok(migration.indexOf("create or replace function private.market_radar_provider_fact_authorized_v1")
    < migration.indexOf("create or replace function private.market_radar_sources_support_reason_v1"));
  assert.match(migration, /unresolved_proof_excerpt_sha256/);
  assert.match(migration, /supported_fact_statuses'[\s\S]*'unresolved'/);
});

test("SQL vincula snapshots append-only y bloquea todas las firmas antiguas", () => {
  for (const column of [
    "candidate_id", "preparation_revision", "purpose", "attempt_id",
    "context_snapshot", "context_sha256", "source_snapshot", "source_sha256", "expires_at",
  ]) assert.match(migration, new RegExp(`add column if not exists ${column}`));
  assert.match(migration, /RADAR_FACT_CHECK_APPEND_ONLY/);
  assert.match(migration, /extensions\.digest/);
  assert.match(migration, /atinara-terminal-fact-gate-v2/g);
  assert.match(migration, /fact_status in \('partially_resolved', 'conflicting', 'unknown'\)/);
  assert.match(migration, /revoke all on function public\.upsert_market_radar_batch_v2[\s\S]*service_role/);
  assert.match(migration, /create or replace function public\.apply_market_radar_prepare_verification[\s\S]*FACT_CHECK_REQUIRED/);
  assert.match(migration, /save_market_draft_from_radar_without_authoritative_fact_gate_v1/);
  assert.match(migration, /save_market_draft_from_radar_intelligence_without_authoritative_fact_gate_v1/);
  assert.match(migration, /current_fact_check_id <> expected_fact_check_id_input/);
  assert.match(migration, /revoke all privileges on table private\.external_market_candidates[\s\S]*service_role/);
  assert.match(migration, /revoke all privileges on table private\.market_radar_fact_checks[\s\S]*service_role/);
  assert.match(migration, /revoke all privileges on sequence private\.market_radar_fact_checks_id_seq[\s\S]*service_role/);
  assert.match(migration, /revoke all privileges on table private\.market_drafts[\s\S]*service_role/);
});

test("la 140 desplegada permanece congelada y 145 reconcilia su historial solo tras manifiesto exacto", () => {
  assert.equal(
    createHash("sha256").update(migration.replace(/\r\n/g, "\n")).digest("hex"),
    "3e5a1b4567a202d359380fc1f31d3988b2a2b934f1a77eefd58f46901b5949db",
  );
  assert.match(reconciliationMigration, /function_count <> 27/);
  assert.match(reconciliationMigration, /91f532bc85abba7538c0d53ff0e6d3c534c4b5e40a7f11b0bd538c15a25024e6/);
  assert.match(reconciliationMigration, /AUTHORITATIVE_RADAR_FACT_GATE_V1_MANIFEST_MISMATCH/);
  assert.match(reconciliationMigration, /AUTHORITATIVE_RADAR_FACT_GATE_V1_HISTORY_CONFLICT/);
  assert.doesNotMatch(reconciliationMigration, /registry_scope/);
  assert.match(reconciliationMigration, /where provider = 'radar' and active/);
  assert.match(reconciliationMigration, /where provider = 'radar_provider' and active/);
  assert.match(reconciliationMigration, /group by table_schema, table_name having count\(\*\) = 14/);
  assert.match(reconciliationMigration, /where migration\.version = '20260809140000'/);
  assert.match(reconciliationMigration, /insert into supabase_migrations\.schema_migrations/);
  assert.match(reconciliationMigration, /3e5a1b4567a202d359380fc1f31d3988b2a2b934f1a77eefd58f46901b5949db/);
  assert.doesNotMatch(reconciliationMigration, /alter function public\.save_market_draft_from_radar[\s\S]*rename to/);
});

test("el puente legacy es puntual, append-only y conserva current revalidate y revisión", () => {
  assert.match(reconciliationMigration, /create table if not exists private\.market_radar_legacy_fact_attestations/);
  assert.match(reconciliationMigration, /draft_id uuid not null unique/);
  assert.match(reconciliationMigration, /origin_prepare_fact_check_id bigint not null unique/);
  assert.match(reconciliationMigration, /RADAR_LEGACY_FACT_ATTESTATION_APPEND_ONLY/);
  assert.match(reconciliationMigration, /revoke all privileges on table private\.market_radar_legacy_fact_attestations[\s\S]*service_role/);
  assert.match(reconciliationMigration, /revoke all privileges on sequence private\.market_radar_legacy_fact_attestations_id_seq[\s\S]*service_role/);
  assert.match(reconciliationMigration, /create or replace function public\.attest_legacy_market_radar_draft_fact_v1/);
  assert.match(reconciliationMigration, /if auth\.role\(\) <> 'service_role'/);
  assert.match(reconciliationMigration, /candidate\.state is distinct from 'prepared'/);
  assert.match(reconciliationMigration, /candidate\.prepared_draft_id is distinct from draft_row\.id/);
  assert.match(reconciliationMigration, /current_fact\.checked_at < checked_at_value - interval '5 minutes'/);
  assert.match(reconciliationMigration, /'radar_fact_checked_at','atomic_fact_gate'/);
  assert.match(reconciliationMigration, /'radar_legacy_revalidation_fact_check_id','radar_legacy_attested_at'/);
  assert.match(reconciliationMigration, /candidate\.fact_status = 'fully_resolved'/);
  assert.match(reconciliationMigration, /private\.insert_market_radar_fact_check_v2\([\s\S]*'prepare', prepare_payload/);
  assert.match(reconciliationMigration, /candidate\.current_fact_check_id is distinct from expected_revalidation_fact_check_id_input/);
  assert.match(reconciliationMigration, /candidate\.preparation_revision is distinct from expected_candidate_revision_input/);
  assert.match(reconciliationMigration, /draft_row\.content_version is distinct from expected_draft_version_input/);
  assert.match(reconciliationMigration, /draft_row\.content_fingerprint is distinct from expected_draft_fingerprint_input/);
  assert.match(reconciliationMigration, /RADAR_LEGACY_FACT_ATTESTED/);
  assert.doesNotMatch(reconciliationMigration, /update private\.external_market_candidates candidate_alias set/);
  assert.doesNotMatch(reconciliationMigration, /update private\.market_drafts[\s\S]*content_version\s*=/);
});

test("la matriz legacy cubre manipulación, idempotencia, reparación y resolución posterior", () => {
  assert.match(legacyAttestationMatrix, /^begin;/m);
  assert.match(legacyAttestationMatrix, /^rollback;/m);
  assert.match(legacyAttestationMatrix, /TEST_SERVICE_RAW_ATTESTATION_SELECT_ACCEPTED/);
  assert.match(legacyAttestationMatrix, /TEST_RADAR_SOURCE_REGISTRY_SHAPE_MISMATCH/);
  assert.match(legacyAttestationMatrix, /TEST_RADAR_SOURCE_REGISTRY_BOOTSTRAP_MISMATCH/);
  assert.match(legacyAttestationMatrix, /TEST_LEGACY_TAMPERED_FINGERPRINT_ACCEPTED/);
  assert.match(legacyAttestationMatrix, /TEST_LEGACY_TAMPERED_VERSION_ACCEPTED/);
  assert.match(legacyAttestationMatrix, /TEST_LEGACY_TAMPERED_REVISION_ACCEPTED/);
  assert.match(legacyAttestationMatrix, /TEST_LEGACY_TAMPERED_FACT_ACCEPTED/);
  assert.match(legacyAttestationMatrix, /TEST_LEGACY_FAILED_ATTEMPT_PERSISTED_DML/);
  assert.match(legacyAttestationMatrix, /fact_count_after <> fact_count_before \+ 1/);
  assert.match(legacyAttestationMatrix, /candidate\.current_fact_check_id <> current_revalidation_fact_id/);
  assert.match(legacyAttestationMatrix, /TEST_LEGACY_ATTESTATION_NOT_IDEMPOTENT/);
  assert.match(legacyAttestationMatrix, /legacy_fact_attestation_repair_fixture/);
  assert.match(legacyAttestationMatrix, /TEST_LEGACY_REPAIR_LOST_FACT_MEMORY/);
  assert.match(legacyAttestationMatrix, /TEST_LEGACY_RESOLVED_ATTESTATION_ACCEPTED/);
  assert.match(legacyAttestationMatrix, /TEST_LEGACY_RESOLVED_PUBLICATION_GATE_ACCEPTED/);
});

test("la interfaz solo deja Preparar con elegibilidad vigente", () => {
  assert.match(admin, /candidate\?\.eligibility_status === "eligible"/);
  assert.match(admin, /candidate\?\.eligibility_policy_version === RADAR_POLICY_VERSION/);
  assert.match(admin, /Boolean\(candidate\?\.current_eligibility_check_id\)/);
  assert.match(admin, /expiresAt > Date\.now\(\)/);
  assert.match(admin, /candidate\.verification_status === "verified_open"/);
  assert.doesNotMatch(admin, /_radar_fact_check_id/);
});

test("la caché conserva solo decisiones de elegibilidad vigentes", () => {
  assert.match(eligibilityMigration, /join private\.market_radar_eligibility_checks eligibility/);
  assert.match(eligibilityMigration, /eligibility\.candidate_id = candidate\.id/);
  assert.match(eligibilityMigration, /eligibility\.policy_version = candidate\.eligibility_policy_version/);
  assert.match(eligibilityMigration, /eligibility\.expires_at > checked_at_value/);
  assert.match(eligibilityMigration, /get_market_radar_candidate_for_revalidation_v1[\s\S]*to service_role/);
  assert.match(eligibilityMigration, /origin_type_input = 'radar_candidate'[\s\S]*market_radar_eligibility_payload/);

  const cachedBranch = edge.slice(
    edge.indexOf("if (!requestedRefresh || cooldownRemaining > 0)"),
    edge.indexOf("const now = new Date().toISOString()"),
  );
  assert.doesNotMatch(cachedBranch, /candidates: \[\]/);
  assert.doesNotMatch(cachedBranch, /groups: \[\]/);
  assert.match(cachedBranch, /cached: true/);
  assert.match(cachedBranch, /cached_authoritative: cachedAuthoritative/);
  assert.match(cachedBranch, /requires_eligibility_refresh: !cachedAuthoritative/);
  assert.match(cachedBranch, /current\.candidates\.length > 0 \|\| providerCoverageCurrent/);
  assert.match(edge, /loadRadarView\(environment, authorization, filters, now\)/);
  assert.match(edge, /Date\.parse\(cleanText\(candidate\.eligibility_checked_at, 100\)\) >= minimumCheckedAt/);
  assert.match(edge, /get_market_radar_candidate_for_revalidation_v1[\s\S]{0,180}undefined, true/);
});

test("la UI distingue caché vigente, serializa cargas y no se autoactualiza al cambiar de pestaña", () => {
  assert.match(admin, /candidate\?\.eligibility_status === "eligible"/);
  assert.match(admin, /cachedAuthoritative: false/);
  assert.match(admin, /Última consulta vigente/);
  assert.match(admin, /Elegibilidad pendiente/);
  assert.match(admin, /if \(state\.radarLoading\) return/);
  assert.match(admin, /state\.radarLoading = true/);
  assert.match(admin, /state\.radarLoading = false/);
  assert.match(admin, /if \(!state\.radar\.loaded\) await loadRadar\(false\);/);
  assert.match(admin, /Date\.parse\(data\.cooldown_until \|\| ""\)/);
  assert.doesNotMatch(admin, /scheduleRadarFactualRefresh|radarFactualRefreshTimer/);
  assert.doesNotMatch(admin, /state\.radar\.cached[^\n]{0,120}\? "Verificado"/);
});

test("un borrador Radar confirma en privado y renueva una ligadura exacta antes de publicar", () => {
  assert.match(agentEngineMigration, /create table if not exists private\.market_draft_eligibility_bindings/);
  assert.match(agentEngineMigration, /draft_version[\s\S]*draft_fingerprint[\s\S]*preparation_revision[\s\S]*eligibility_check_id/);
  assert.match(agentEngineMigration, /create or replace function private\.assert_market_radar_draft_eligibility_v1/);
  assert.match(agentEngineMigration, /RADAR_DRAFT_ELIGIBILITY_BINDING_REQUIRED/);
  assert.match(agentEngineMigration, /if new\.workflow_status in \('scheduled', 'published'\)/);
  assert.doesNotMatch(agentEngineMigration, /if new\.workflow_status in \('human_confirmed', 'scheduled', 'published'\)/);

  const confirmStart = agentEngineMigration.indexOf("create or replace function public.confirm_market_draft_review");
  const triggerStart = agentEngineMigration.indexOf("create or replace function private.market_draft_radar_eligibility_gate_v1");
  const confirmBody = agentEngineMigration.slice(confirmStart, triggerStart);
  assert.match(confirmBody, /ensure_market_source_confirmation_ready_v1/);
  assert.doesNotMatch(confirmBody, /ensure_market_source_publication_ready/);

  const materializeStart = publicationFlow.indexOf("create or replace function private.materialize_market_draft");
  const publishStart = publicationFlow.indexOf("create or replace function public.publish_market_draft");
  const materializeBody = publicationFlow.slice(materializeStart, publishStart);
  const publishBody = publicationFlow.slice(publishStart, publicationFlow.indexOf("create or replace function public.get_admin_market_draft", publishStart));
  assert.ok(publishBody.indexOf("ensure_market_source_publication_ready") < publishBody.indexOf("if scheduled_for_input is not null"));
  assert.ok(materializeBody.indexOf("assert_market_source_publication_ready") < materializeBody.indexOf("insert into public.markets"));

  const schedulerStart = administrationGate.indexOf("create or replace function public.publish_due_market_drafts");
  const schedulerBody = administrationGate.slice(schedulerStart, administrationGate.indexOf("create or replace function public.close_market_participation_early", schedulerStart));
  assert.match(schedulerBody, /private\.materialize_market_draft/);

  const confirmStartUi = admin.indexOf("async function confirmReview");
  const publishStartUi = admin.indexOf("async function publishDraft");
  const confirmUi = admin.slice(confirmStartUi, publishStartUi);
  const publishUi = admin.slice(publishStartUi, admin.indexOf("async function requestReview", publishStartUi) > 0
    ? admin.indexOf("async function requestReview", publishStartUi)
    : admin.indexOf("async function loadRadar", publishStartUi));
  assert.doesNotMatch(confirmUi, /ensureRadarDraftEligibility\(draft\)/);
  assert.match(confirmUi, /rpc\("confirm_market_draft_review"/);
  assert.ok(publishUi.indexOf("ensureRadarDraftEligibility(draft)") < publishUi.indexOf('rpc("publish_market_draft"'));
  assert.match(admin, /confirmationRequested &&/);
  assert.match(admin, /publicationRequested &&/);
  assert.match(admin, /invokeRadar\("check-eligibility", \{[\s\S]*candidate_id: candidateId,[\s\S]*draft_id: draft\.id,[\s\S]*draft_fingerprint: draft\.content_fingerprint/);
  assert.match(admin, /data-radar-candidate-id="\$\{escapeHtml\(draft\.radar_candidate_id \|\| ""\)\}"/);
  assert.match(admin, /data-content-fingerprint="\$\{escapeHtml\(draft\.content_fingerprint \|\| ""\)\}"/);
  assert.match(draftFixerUi, /const radarCandidateId = safeText\(form\.dataset\.radarCandidateId/);
  assert.match(draftFixerUi, /const draftFingerprint = safeText\(form\.dataset\.contentFingerprint/);
  const interceptedPublish = draftFixerUi.slice(
    draftFixerUi.indexOf("async function runPublication"),
    draftFixerUi.indexOf("function enhanceBindingMessage"),
  );
  assert.ok(interceptedPublish.indexOf("checkRadarPublicationEligibility(context)")
    < interceptedPublish.indexOf('client.rpc("publish_market_draft"'));
  assert.match(draftFixerUi, /action: "check-eligibility"[\s\S]*candidate_id: context\.radarCandidateId[\s\S]*draft_id: context\.draftId[\s\S]*draft_fingerprint: context\.draftFingerprint/);
  assert.doesNotMatch(draftFixerUi, /legacy_fact_attestation/);
});

test("el Editor prioriza la explicación del 409 y nunca presenta SQL interno", () => {
  assert.match(draftFixerUi, /function safeRepairErrorText\(value, max = 800\)/);
  assert.match(draftFixerUi, /SQLSTATE[\s\S]*PL\\\/pgSQL[\s\S]*SQL statement[\s\S]*private\|public\|auth\|extensions/);
  assert.match(draftFixerUi, /\^\[A-Z\]\[A-Z0-9_\]\{2,\}\$/);
  const errorStart = draftFixerUi.indexOf("async function repairFailure");
  const errorEnd = draftFixerUi.indexOf("async function runRepair", errorStart);
  const errorBody = draftFixerUi.slice(errorStart, errorEnd);
  assert.ok(errorBody.indexOf("body?.escalation?.reason") < errorBody.indexOf("body?.message"));
  assert.ok(errorBody.indexOf("body?.message") < errorBody.indexOf("body?.error"));
  assert.doesNotMatch(errorBody, /body\?\.message \|\| body\?\.error/);
});
