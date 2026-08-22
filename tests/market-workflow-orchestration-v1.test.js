import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  ATINARA_TEMPORAL_CONTRACT_VERSION,
  createAtinaraTemporalContract,
  isIanaTimezone,
  validateAtinaraTemporalContract,
} from "../supabase/functions/_shared/market-temporal-contract.mjs";
import {
  buildDraftPrefill,
  deriveMarketFamily,
  evaluateGamingDomain,
  extractRadarOptionChild,
} from "../supabase/functions/_shared/market-radar.mjs";
import { nullableFiniteNumber } from "../supabase/functions/_shared/nullable-number.mjs";
import { evaluateValiditySeparately } from "../supabase/functions/_shared/market-intelligence/option-logic.mjs";
import { aggregateSnapshots } from "../supabase/functions/_shared/market-intelligence/evidence.mjs";
import { essentialMarketTextNotSpanish } from "../supabase/functions/_shared/market-language.mjs";
import { canonicalJson } from "../supabase/functions/_shared/ai/contracts.mjs";
import { createMarketWorkflowIssue } from "../supabase/functions/_shared/market-workflow-issues.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(join(root, path), "utf8");
const radarEdge = read("supabase/functions/market-radar/index.ts");
const expertEdge = read("supabase/functions/market-expert/index.ts");
const validatorEdge = read("supabase/functions/validate-market-draft/index.ts");
const correctorEdge = read("supabase/functions/market-draft-fixer/index.ts");
const schedulerEdge = read("supabase/functions/publish-scheduled-markets/index.ts");
const admin = read("admin-markets.js");
const agentUi = read("admin-agent-engine.js");
const fixerUi = read("market-draft-fixer.js");
const migration = read("supabase/migrations/20260820174316_add_market_workflow_orchestration_v1.sql");

function legacyRadarCanonical(value) {
  const normalize = (item) => {
    if (Array.isArray(item)) return item.map(normalize);
    if (!item || typeof item !== "object") return item ?? null;
    return Object.fromEntries(Object.keys(item).sort((left, right) => left.localeCompare(right))
      .map((key) => [key, normalize(item[key])]));
  };
  return JSON.stringify(normalize(value));
}

function temporalCandidate(patch = {}) {
  return {
    provider: "kalshi",
    normalizer_version: "atinara-radar-v2",
    source_title: "The Game Awards 2026",
    source_question: "Will Half-Life 3 win Game of the Year at The Game Awards 2026?",
    source_close_at: "2027-12-31T23:59:00Z",
    external_market_url: "https://kalshi.com/markets/example",
    fetched_at: "2026-08-20T12:00:00Z",
    provider_payload: {
      close_time: "2027-12-31T23:59:00Z",
      expected_expiration_time: "2026-12-12T22:00:00Z",
      latest_expiration_time: "2027-01-15T22:00:00Z",
    },
    ...patch,
  };
}

test("contrato temporal A conserva 2027 de origen y admite una proyección 2026 demostrada", async () => {
  const contract = await createAtinaraTemporalContract(temporalCandidate({
    temporal_projection: {
      canonical_event_at: "2026-12-10T20:00:00Z",
      forecast_closes_at: "2026-12-10T19:55:00Z",
      evaluation_ends_at: "2026-12-10T22:00:00Z",
      resolution_deadline: "2027-01-15T22:00:00Z",
      timezone: "America/Los_Angeles",
      confidence: 98,
    },
    temporal_evidence: [{ url: "https://thegameawards.com/", fingerprint: "a".repeat(64), role: "PRIMARY_RESOLUTION" }],
  }));
  assert.equal(contract.version, ATINARA_TEMPORAL_CONTRACT_VERSION);
  assert.equal(contract.evaluation_ends_at, "2026-12-10T22:00:00.000Z");
  assert.equal(contract.resolution_deadline, "2027-01-15T22:00:00.000Z");
  assert.ok(contract.raw_source_dates.some((item) => item.field_name === "source_close_at"
    && item.raw_value === "2027-12-31T23:59:00Z"));
  assert.deepEqual(contract.anomaly_codes, ["SOURCE_TECHNICAL_DATE_PRESERVED"]);
  assert.equal(contract.blocking_scope, "none");
  assert.equal(validateAtinaraTemporalContract(contract), true);
});

test("contrato temporal B deja null sin fuente, permite prefill privado y bloquea solo aprobación", async () => {
  const contract = await createAtinaraTemporalContract(temporalCandidate());
  assert.equal(contract.evaluation_ends_at, null);
  assert.equal(contract.timezone, null);
  assert.ok(contract.anomaly_codes.includes("TEMPORAL_SOURCE_SEMANTICS_MISMATCH"));
  assert.ok(contract.anomaly_codes.includes("TEMPORAL_AUTHORITATIVE_DATE_REQUIRED"));
  assert.equal(contract.owner_stage, "editor");
  assert.equal(contract.blocking_scope, "approval");
  assert.equal(contract.next_action, "resolve_temporal_contract");
  const prefill = buildDraftPrefill({
    ...temporalCandidate(),
    temporal_contract: contract,
    atinara_question: "¿Ganará Half-Life 3 el premio a juego del año?",
    atinara_category: "Reviews/Premios",
    atinara_resolution_criteria: "Sí si la fuente oficial lo proclama ganador.",
  });
  assert.equal(prefill.fields.evaluation_ends_at, "");
  assert.equal(prefill.fields.timezone, "");
  assert.ok(prefill.missing_fields.includes("evaluation_ends_at"));
});

test("la zona temporal exige un identificador IANA válido sin convertirlo en fallo técnico", async () => {
  assert.equal(isIanaTimezone("UTC"), true);
  assert.equal(isIanaTimezone("Europe/Madrid"), true);
  assert.equal(isIanaTimezone("Europe/Invalid"), false);
  const contract = await createAtinaraTemporalContract(temporalCandidate({
    temporal_projection: {
      evaluation_ends_at: "2026-12-10T22:00:00Z",
      resolution_deadline: "2026-12-11T22:00:00Z",
      timezone: "Europe/Invalid",
      confidence: 90,
    },
  }));
  assert.equal(contract.timezone, null);
  assert.ok(contract.anomaly_codes.includes("TEMPORAL_AUTHORITATIVE_DATE_REQUIRED"));
  assert.throws(
    () => validateAtinaraTemporalContract({ ...contract, timezone: "Europe/Invalid" }),
    { name: "TypeError", message: "TEMPORAL_CONTRACT_TIMEZONE_INVALID" },
  );
});

test("contratos C y D no corrigen falsamente un evento 2026 celebrado o resuelto en 2027", async () => {
  const evidence = [{ url: "https://thegameawards.com/", fingerprint: "b".repeat(64), role: "PRIMARY_RESOLUTION" }];
  const heldIn2027 = await createAtinaraTemporalContract(temporalCandidate({
    temporal_projection: {
      canonical_event_at: "2027-01-10T20:00:00Z", forecast_closes_at: "2027-01-10T19:55:00Z",
      evaluation_ends_at: "2027-01-10T22:00:00Z", resolution_deadline: "2027-01-12T22:00:00Z",
      timezone: "Europe/Madrid", confidence: 95,
    }, temporal_evidence: evidence,
  }));
  assert.equal(heldIn2027.evaluation_ends_at, "2027-01-10T22:00:00.000Z");
  assert.equal(heldIn2027.blocking_scope, "none");

  const decemberSettlement = await createAtinaraTemporalContract(temporalCandidate({
    source_close_at: "2026-12-20T20:00:00Z",
    temporal_projection: {
      canonical_event_at: "2026-12-20T20:00:00Z", forecast_closes_at: "2026-12-20T19:55:00Z",
      evaluation_ends_at: "2026-12-20T22:00:00Z", resolution_deadline: "2027-01-05T12:00:00Z",
      timezone: "Europe/Madrid", confidence: 99,
    }, temporal_evidence: evidence,
  }));
  assert.equal(new Date(decemberSettlement.evaluation_ends_at).getUTCFullYear(), 2026);
  assert.equal(new Date(decemberSettlement.resolution_deadline).getUTCFullYear(), 2027);
  assert.equal(decemberSettlement.blocking_scope, "none");
});

test("la huella temporal ignora solo fetched_at y cambia al cambiar la decisión", async () => {
  const base = temporalCandidate();
  const first = await createAtinaraTemporalContract(base, "2026-08-20T12:00:00Z");
  const replay = await createAtinaraTemporalContract({ ...base, fetched_at: "2026-08-21T12:00:00Z" });
  const changed = await createAtinaraTemporalContract({
    ...base,
    temporal_projection: { evaluation_ends_at: "2026-12-10T22:00:00Z", timezone: "UTC", confidence: 80 },
  });
  assert.equal(first.decision_hash, replay.decision_hash);
  assert.notEqual(first.decision_hash, changed.decision_hash);
  const evidenceA = await createAtinaraTemporalContract({
    ...base,
    temporal_evidence: [{
      url: "https://thegameawards.com/",content_sha256: "1".repeat(64),role: "PRIMARY_RESOLUTION",
    }],
  });
  const evidenceB = await createAtinaraTemporalContract({
    ...base,
    temporal_evidence: [{
      url: "https://thegameawards.com/",content_sha256: "2".repeat(64),role: "PRIMARY_RESOLUTION",
    }],
  });
  assert.equal(evidenceA.evidence_refs[0].fingerprint, "1".repeat(64));
  assert.notEqual(evidenceA.decision_hash,evidenceB.decision_hash);
});

test("Radar usa Canonical JSON v1 sin cambiar las huellas válidas del corpus operativo", () => {
  const corpus = [
    { provider: "kalshi", capability: "candidate_feed", cache_key: "radar:all", request_version: "v1" },
    { provider: "polymarket", batch_index: 0, accepted_count: 2, quarantined_count: 0 },
    { event_id: "tga-2026", markets: [{ market_id: "10", status: "open" }, { market_id: "2", status: "open" }] },
    { source_title: "The Game Awards 2026", source_question: "¿Ganará Aurora?", source_close_at: "2026-12-10T22:00:00Z" },
    { canonical_url: "https://thegameawards.com/", content_sha256: "a".repeat(64), role: "PRIMARY_RESOLUTION" },
    { eligible: true, reason_code: null, ttl_minutes: 360, evidence: [] },
    { family_key: "atinara:v4:tga:outcome", family_child_key: "option:aurora", family_version: "atinara-market-family-v4" },
    { relationship: "exact_duplicate", blocking: true, market_id: "mercado-aurora" },
    { phase: "persistence", cursor: 24, completed_batches: [0], request_id: "00000000-0000-4000-8000-000000000001" },
    { timezone: "Europe/Madrid", evaluation_ends_at: "2026-12-10T22:00:00Z", anomaly_codes: [] },
    { provider: "tavily", capability: "source_enrichment", last_success_count: 8, last_success_at: "2026-08-20T12:00:00Z" },
    { registry_version: "atinara-agent-registry-v2.1.0", registry_hash: "b".repeat(64) },
    { run_id: "00000000-0000-4000-8000-000000000002", step: 2, status: "waiting", progress: { processed: 24, total: 48 } },
  ];
  assert.equal(corpus.length, 13);
  for (const value of corpus) assert.equal(canonicalJson(value), legacyRadarCanonical(value));
  assert.match(radarEdge, /import \{ canonicalJson, sha256Hex \} from "\.\.\/_shared\/ai\/contracts\.mjs"/);
  assert.doesNotMatch(radarEdge, /function canonicalJson\(/);
  assert.doesNotMatch(radarEdge, /\.localeCompare\(/);
});

test("una frontera explícita de la pregunta crea fechas Atinara sin reutilizar el cierre técnico", async () => {
  const family = deriveMarketFamily({
    source_title: "Fecha de lanzamiento",
    source_question: "Will Aurora release before December 31, 2026?",
  });
  const contract = await createAtinaraTemporalContract({
    ...temporalCandidate({
      source_title: "Aurora release date",
      source_question: "Will Aurora release before December 31, 2026?",
    }),
    ...family,
  });
  assert.equal(contract.evaluation_ends_at, family.family_semantics.temporal_boundary.canonical_instant);
  assert.notEqual(contract.evaluation_ends_at, "2027-12-31T23:59:00.000Z");
  assert.equal(Date.parse(contract.evaluation_ends_at) - Date.parse(contract.forecast_closes_at), 5 * 60_000);
  assert.equal(contract.blocking_scope, "none");
});

test("identidad y dominio extraen opciones reales y aíslan placeholders sin hardcodes", () => {
  const real = {
    source_title: "The Game Awards: Best Multiplayer",
    source_question: "Will Half-Life 3 win Best Multiplayer at The Game Awards 2026?",
  };
  const sibling = { ...real, source_question: "Will Saros win Best Multiplayer at The Game Awards 2026?" };
  const placeholder = { ...real, source_question: "Will Game A win Best Multiplayer at The Game Awards 2026?" };
  assert.equal(extractRadarOptionChild(real)?.slug, "half-life-3");
  assert.equal(deriveMarketFamily(real)?.family_child_key, "option:half-life-3");
  assert.equal(deriveMarketFamily(sibling)?.family_child_key, "option:saros");
  assert.equal(evaluateGamingDomain(placeholder).status, "placeholder");
  assert.equal(evaluateGamingDomain({ source_title: "Sports Illustrated", source_question: "Will a footballer win?" }).status, "review_required");
  assert.equal(evaluateGamingDomain({ source_title: "Football Manager 2027", source_question: "Will it include the Premier League?" }).status, "review_required");
  assert.equal(evaluateGamingDomain({ source_title: "NBA 2K27", source_question: "Will it include the official NBA season?" }).status, "review_required");
});

test("ausencia numérica nunca se convierte en cero ni en probabilidad extrema", () => {
  for (const value of [null, undefined, "", "   ", false, true, [], {}, 1n, Symbol("1"), () => 1]) {
    assert.equal(nullableFiniteNumber(value), null);
  }
  assert.equal(nullableFiniteNumber("0"), 0);
  assert.equal(nullableFiniteNumber("12,5"), 12.5);
  assert.equal(nullableFiniteNumber("1e3"), 1_000);
  assert.equal(nullableFiniteNumber("12px"), null);
  assert.equal(evaluateValiditySeparately({ probability: null }).forecastability_status, "unknown");
  assert.deepEqual(aggregateSnapshots([{ value: "" }]), {
    value: null, sample_count: 0, failed_count: 1, quality: "insufficient", reason_code: "SOURCE_DATA_MISSING",
  });
  for (const value of [false, true, [], {}]) {
    assert.deepEqual(aggregateSnapshots([{ value }], "maximum"), {
      value: null, sample_count: 0, failed_count: 1, quality: "insufficient", reason_code: "SOURCE_DATA_MISSING",
    });
  }
  assert.deepEqual(aggregateSnapshots([{ value: false }], "any_true"), {
    value: false, sample_count: 1, failed_count: 0, quality: "complete", reason_code: null,
  });
  assert.deepEqual(aggregateSnapshots([{ value: "12.5" }, { value: [] }], "maximum"), {
    value: 12.5, sample_count: 1, failed_count: 1, quality: "partial", reason_code: null,
  });
  assert.match(admin, /Sin precio disponible/);
});

test("la puerta lingüística exige evidencia española y no confunde nombres propios", () => {
  assert.equal(essentialMarketTextNotSpanish([
    "¿Ganará Pokémon Legends el premio oficial?",
    "Sí si Pokémon Legends gana según la fuente oficial.",
    "No si Pokémon Legends pierde o queda fuera.",
    "La resolución seguirá el resultado oficial.",
  ]), false);
  assert.equal(essentialMarketTextNotSpanish(["¿Ganará Aurora?","Sí.","No si pierde.","Según el resultado."]),false);
  assert.equal(essentialMarketTextNotSpanish(["¿Ganara\u0301 Aurora?","Si\u0301.","No si pierde.","Segu\u0301n el resultado."]),false);
  for (const foreign of [
    ["Will Aurora win?", "Yes if Aurora wins.", "No if Aurora loses.", "According to the official source."],
    ["Is Aurora going to win?", "It resolves to Yes when Aurora wins.", "No otherwise.", "Official results apply."],
    ["Aurora va-t-il gagner ?", "Oui si Aurora gagne.", "Non autrement.", "Selon la source officielle."],
    ["Aurora vai ganhar?", "Sim se Aurora vencer.", "Não caso contrário.", "Segundo a fonte oficial."],
    ["Wird Aurora gewinnen?", "Ja, wenn Aurora gewinnt.", "Nein andernfalls.", "Laut offizieller Quelle."],
  ]) assert.equal(essentialMarketTextNotSpanish(foreign), true);
});

test("Expert y Validator progresan el artefacto sin IA sobre snapshots reparables", () => {
  assert.match(expertEdge, /skipEditorialInference = preInferenceGate\.status !== "proposal_ready"/);
  assert.match(expertEdge, /zero_inference: true/);
  assert.match(expertEdge, /proposal_ready_with_issues/);
  assert.match(expertEdge, /"PROVIDER_PLACEHOLDER"/);
  assert.doesNotMatch(expertEdge, /proposalQuestionChild/);
  assert.match(agentUi, /save_market_draft_from_expert_with_issues_v1/);
  assert.doesNotMatch(expertEdge, /origin\.source_close_at\s*\|\|\s*origin\.time_window_end/);
  assert.match(validatorEdge, /inherited_workflow_gate: true, zero_inference: true/);
  assert.match(validatorEdge, /record_market_draft_review_with_issues_v1/);
  assert.match(validatorEdge, /review_rejected_repairable/);
  assert.match(correctorEdge, /get_market_workflow_issues_v1/);
  assert.match(correctorEdge, /workflow_issue_ids/);
  assert.match(correctorEdge, /MARKET_WORKFLOW_TRANSITION_FAILED/);
  assert.match(correctorEdge, /MARKET_WORKFLOW_TRANSITION_INCOMPLETE/);
  assert.doesNotMatch(correctorEdge, /transition_market_workflow_issue_v1[\s\S]{0,500}\.catch\(\(\) =>/);
});

test("confirmación, publicación y scheduler devuelven recuperación estructurada", () => {
  assert.match(admin, /confirm_market_draft_review_v2/);
  assert.match(admin, /publish_market_draft_v2/);
  assert.match(admin, /PUBLICATION_ATTEMPT_KEY_PREFIX/);
  assert.match(admin, /request_id_input: publicationRequestId/);
  assert.match(fixerUi, /Publicación bloqueada y recuperable/);
  assert.match(fixerUi, /PUBLICATION_ATTEMPT_KEY_PREFIX/);
  assert.match(fixerUi, /publicationRequestId\(context\)/);
  assert.match(fixerUi, /toIsoOrEmpty\?\.\(context\.scheduledValue, context\.timezone \|\| ""\)/);
  assert.match(schedulerEdge, /publish_due_market_drafts_v2/);
  assert.match(migration, /publication_blocked_recoverable/);
  assert.match(migration, /retry_scheduled_market_publication_v1/);
  assert.match(migration, /cancel_scheduled_market_publication_v1/);
  assert.match(migration, /MARKET_WORKFLOW_APPROVAL_BLOCKED/);
  assert.match(migration, /publication_failed_terminal/);
  assert.match(migration, /reload_current_draft/);
});

test("la UI no deja botones muertos y traduce estados, roles y acciones", () => {
  assert.doesNotMatch(agentUi, /La propuesta no puede pasar al borrador mientras conserve bloqueos/);
  assert.match(agentUi, /Las incidencias reparables pasan al borrador privado/);
  assert.match(agentUi, /workflowOwnerLabels\[issue\.owner_stage\]/);
  assert.match(agentUi, /workflowActionLabels\[issue\.next_action\]/);
  assert.match(admin, /Incidencias estructuradas/);
  assert.match(admin, /Responsable:/);
  assert.match(admin, /Siguiente acción:/);
  assert.match(admin, /data-workflow-owner/);
  assert.match(fixerUi, /data-workflow-owner='corrector'/);
  assert.doesNotMatch(admin, /data-confirm-review[^>]*\sdisabled(?:\s|>)/);
  assert.doesNotMatch(admin, /data-publish-draft[^>]*Falta confirmación humana/);
});

test("una condición terminal se audita en Radar sin abrir Editor, Gemini o borrador", () => {
  assert.match(radarEdge, /RADAR_REASON_CODES\.EVENT_ALREADY_RESOLVED/);
  assert.match(radarEdge, /RADAR_REASON_CODES\.DUPLICATE_MARKET/);
  assert.match(radarEdge, /RADAR_TERMINAL_WORKFLOW_CODES\.has\(code\)/);
  assert.match(radarEdge, /decisionCode = cleanText\(candidate\.eligibility_reason_code \|\| candidate\.domain_reason_code/);
  assert.match(radarEdge, /const nextAction = terminal \? "archive_terminal_candidate"/);
  assert.match(admin, /!radarCandidateIsTerminal\(state\.radar\.selected\)/);
  assert.match(admin, /Condición terminal auditada: no se enviará al Editor ni se creará un borrador/);
});

test("el ledger V6 es aditivo y conserva íntegro Registry V2.1", async () => {
  assert.match(migration, /create table private\.market_workflow_issue_occurrences_v1/);
  assert.match(migration, /create table private\.market_workflow_issue_events_v1/);
  assert.match(migration, /create table private\.market_workflow_issue_subject_links_v1/);
  assert.match(migration, /hacen viajar un único issue_id/);
  assert.match(migration, /force row level security/);
  assert.match(migration, /AGENT_REGISTRY_V21_CHANGED/);
  assert.doesNotMatch(migration, /insert into private\.market_issue_registry|update private\.market_issue_registry|delete from private\.market_issue_registry/i);
  assert.doesNotMatch(migration, /insert into private\.market_repair_strategy_registry|update private\.market_repair_strategy_registry/i);
  const serverGolden = await createMarketWorkflowIssue({
    issueCode: "PUBLICATION_TECHNICAL_FAILURE", detectedBy: "publication_gate",
    ownerStage: "internal_platform", severity: "blocking", repairability: "auto_recoverable",
    blockingScope: "publication", affectedFields: [], evidenceRefs: [],
    currentValue: { draft_id: "00000000-0000-4000-8000-000000000001", expected_version: 2 },
    proposedValue: null, confidence: 100, policyVersion: "atinara-publication-gate-v1",
    retryable: true, nextAction: "retry_market_publication",
  }, {
    createId: () => "00000000-0000-4000-8000-000000000002",
    now: () => "2026-08-21T00:00:00.000Z",
  });
  assert.equal(serverGolden.fingerprint, "be7bc38e9c4986db1ea7551c8a5d92c293ef51383c72859c945a5c7f88abc71d");
});
