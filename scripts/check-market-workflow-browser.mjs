import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFileSync, statSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";
import { chromium } from "playwright";

const root = resolve(import.meta.dirname, "..");
const chrome = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png" };
const server = createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url || "/", "http://127.0.0.1").pathname);
  const relative = pathname === "/" ? "admin-markets.html" : pathname.replace(/^\/+/, "");
  const file = normalize(join(root, relative));
  if (!file.startsWith(root) || !statSafe(file)) {
    response.writeHead(404); response.end("not found"); return;
  }
  response.writeHead(200, { "content-type": `${mime[extname(file)] || "application/octet-stream"}; charset=utf-8`, "cache-control": "no-store" });
  let body=readFileSync(file);
  if (relative==="admin-markets.html") {
    body=Buffer.from(body.toString("utf8").replace(/\s+integrity="[^"]+"/g, "").replace(/\s+crossorigin="anonymous"/g, ""));
  }
  response.end(body);
});
function statSafe(file) { try { return statSync(file).isFile(); } catch { return false; } }
await new Promise((resolveReady) => server.listen(0, "127.0.0.1", resolveReady));
const port = server.address().port;
let externalNetworkCalls = 0;
let blockedExternalAttempts = 0;

const issue = {
  issue_id: "11111111-1111-4111-8111-111111111111",
  issue_code: "TEMPORAL_AUTHORITATIVE_DATE_REQUIRED",
  owner_stage: "corrector",
  detected_by: "radar",
  severity: "blocking",
  repairability: "waiting_authoritative_source",
  blocking_scope: "approval",
  affected_fields: ["evaluation_ends_at"],
  evidence_refs: [], current_value: null, proposed_value: null, confidence: 100,
  policy_version: "atinara-temporal-semantics-v1", schema_version: "atinara-market-issue-v1",
  fingerprint: "a".repeat(64), status: "waiting", retryable: true,
  next_action: "repair_temporal_or_source_contract",
  created_at: "2026-08-20T12:00:00Z", updated_at: "2026-08-20T12:00:00Z",
  resolved_at: null, resolution_method: null,
};
const candidate = {
  id: "22222222-2222-4222-8222-222222222222", provider: "kalshi",
  external_id: "KX-FIXTURE", event_group_key: "kalshi:fixture", preparation_revision: 3,
  source_title: "The Game Awards 2026", source_question: "Will Aurora win Game of the Year?",
  atinara_question: "¿Ganará Aurora el premio a juego del año?", atinara_category: "Reviews/Premios",
  atinara_resolution_criteria: "Sí si la fuente oficial proclama a Aurora.",
  source_probability_yes: null, quality_score: 88, quality_status: "needs_review",
  state: "needs_review", verification_status: "needs_review", eligibility_status: "technical_hold",
  eligibility_policy_version: "atinara-prediction-policy-v5", domain_status: "in_domain",
  workflow_issues: [issue], family_type: "categorical_outcomes", family_child_key: "option:aurora",
  family_child_label: "Aurora", external_event_url: "https://kalshi.com/markets/fixture",
};
const run = {
  id: "33333333-3333-4333-8333-333333333333",
  status: "completed",
  origin_preparation_revision: 3,
  result_json: {
    decision: "create_with_edits",
    summary: "Propuesta privada con fecha oficial pendiente.",
    origin_preparation_revision: 3,
  },
};
const draftPackage = {
  available: true,
  origin: { type: "radar_candidate", id: candidate.id, preparation_revision: 3, fingerprint: "b".repeat(64) },
  run: { ...run, policy_version: "atinara-market-constitution-v1", schema_version: "atinara-market-expert-v1" },
  verdict: { decision: "create_with_edits", integrity_status: "needs_edit", forecastability_status: "forecastable", source_readiness: "ready_with_warnings", confidence: 80, human_review_required: true, summary: "Propuesta privada con fecha oficial pendiente.", workflow_issues: [issue] },
  fields: { market_slug: "aurora-goty", question: "¿Ganará Aurora el premio a juego del año?", subject: "Aurora", category: "Reviews/Premios", evaluation_period_label: "Fecha oficial pendiente", evaluation_ends_at: null, timezone: null, resolution_deadline: null, yes_criteria: "Sí si la fuente oficial proclama a Aurora.", no_criteria: "No si proclama a otra candidatura.", edge_cases: "Un aplazamiento exige revisar el periodo.", public_criteria: "Se usa la fuente oficial.", description: "Borrador privado.", primary_source_url: "https://thegameawards.com/", alternative_sources: "" },
  contract: { capture_strategy: "manual_official_source", provider: "official_web", timezone: null, sources: [{ role: "PRIMARY_RESOLUTION", url: "https://thegameawards.com/", precedence: 1, required: true }] },
  sources: [{ role: "PRIMARY_RESOLUTION", url: "https://thegameawards.com/", precedence: 1, required: true }],
  gate: { status: "proposal_ready_with_issues", can_prefill: true, can_save_private_draft: true, can_materialize_private_repair_draft: true, hard_blocks: [issue.issue_code], warnings: [], workflow_issues: [issue], owner_stage: "corrector", next_action: issue.next_action },
};
const draft = {
  id: "44444444-4444-4444-8444-444444444444", market_slug: "aurora-goty",
  question: "¿Ganará Aurora el premio a juego del año?", subject: "Aurora", category: "Reviews/Premios",
  yes_option: "Sí", no_option: "No", workflow_status: "draft_incomplete", review_status: "rejected",
  artifact_status: "draft_waiting_authoritative_source", workflow_owner_stage: "corrector",
  workflow_next_action: "repair_temporal_or_source_contract", workflow_issue_count: 1,
  content_version: 1, content_fingerprint: "c".repeat(64), workflow_issues: [issue],
  source_provenance: { origin_type: "radar_candidate", origin_candidate_id: candidate.id, workflow_issues: [issue] },
  intelligence_origin_type: "radar_candidate", intelligence_origin_id: candidate.id,
  evaluation_ends_at: null, timezone: null, resolution_deadline: null,
  yes_criteria: "Sí si la fuente oficial proclama a Aurora.", no_criteria: "No si proclama a otra candidatura.",
  edge_cases: "Un aplazamiento exige revisar el periodo.", primary_source: { url: "https://thegameawards.com/" }, alternative_sources: [],
};
const draftPayload = { draft, deterministic_issues: [{ code: "TEMPORAL_INCOHERENCE", field: "evaluation_ends_at", message: "Falta fecha oficial." }], effective_review: null, latest_attempt: { id: "55555555-5555-4555-8555-555555555555", status: "rejected", classification: "content", semantic_issues: [] }, latest_review: { semantic_issues: [], editorial_notes: [] }, review_history: [], version_history: [], binding_compatibility: { compatible: false, required: true, reasons: ["Fecha pendiente"] }, audit: [] };

function issueFixture(overrides = {}) {
  return { ...issue, ...overrides };
}

function draftFixture(workflowIssue, overrides = {}) {
  return {
    ...draft,
    workflow_issues: workflowIssue ? [workflowIssue] : [],
    source_provenance: {
      ...draft.source_provenance,
      workflow_issues: workflowIssue ? [workflowIssue] : [],
    },
    ...overrides,
  };
}

function payloadFixture(activeDraft, deterministicIssues = [], overrides = {}) {
  return {
    ...draftPayload,
    draft: activeDraft,
    deterministic_issues: deterministicIssues,
    ...overrides,
  };
}

const criteriaIssue = issueFixture({
  issue_id: "66666666-6666-4666-8666-666666666666",
  issue_code: "CRITERIA_CROSS_FIELD_INCOHERENT",
  owner_stage: "corrector",
  repairability: "auto_repairable",
  affected_fields: ["yes_criteria", "no_criteria"],
  next_action: "repair_draft_issues",
  fingerprint: "e".repeat(64),
});
const waitingIssue = issueFixture({
  issue_id: "77777777-7777-4777-8777-777777777777",
  issue_code: "RESOLUTION_PRIMARY_SOURCE_REQUIRED",
  owner_stage: "corrector",
  repairability: "waiting_authoritative_source",
  affected_fields: ["primary_source"],
  next_action: "repair_temporal_or_source_contract",
  status: "waiting",
  fingerprint: "f".repeat(64),
});
const eligibilityIssue = issueFixture({
  issue_id: "88888888-8888-4888-8888-888888888888",
  issue_code: "ELIGIBILITY_EXPIRED",
  owner_stage: "radar",
  repairability: "auto_recoverable",
  affected_fields: ["radar_eligibility"],
  next_action: "refresh_draft_eligibility",
  fingerprint: "1".repeat(64),
});
const publicationIssue = issueFixture({
  issue_id: "99999999-9999-4999-8999-999999999999",
  issue_code: "SOURCE_STALE",
  detected_by: "publication_gate",
  owner_stage: "publication_gate",
  repairability: "auto_recoverable",
  blocking_scope: "publication",
  affected_fields: ["primary_source"],
  next_action: "revalidate_temporal_evidence",
  fingerprint: "2".repeat(64),
});
const terminalIssue = issueFixture({
  issue_id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
  issue_code: "EVENT_ALREADY_RESOLVED",
  owner_stage: "radar",
  repairability: "terminal",
  blocking_scope: "terminal",
  affected_fields: ["source_status"],
  next_action: "archive_terminal_candidate",
  retryable: false,
  fingerprint: "3".repeat(64),
});

const criteriaDraft = draftFixture(criteriaIssue, {
  id: "aaaaaaaa-1111-4111-8111-111111111111",
  market_slug: "criteria-incoherent",
  evaluation_ends_at: "2026-12-12T21:00:00Z",
  timezone: "Europe/Madrid",
  resolution_deadline: "2026-12-13T21:00:00Z",
  artifact_status: "review_rejected_repairable",
  workflow_next_action: "repair_draft_issues",
});
const waitingDraft = draftFixture(waitingIssue, {
  id: "bbbbbbbb-1111-4111-8111-111111111111",
  market_slug: "waiting-source",
  artifact_status: "repair_waiting_source",
  workflow_next_action: "repair_temporal_or_source_contract",
});
const publicationDraft = draftFixture(publicationIssue, {
  id: "cccccccc-1111-4111-8111-111111111111",
  market_slug: "source-stale-publication",
  workflow_status: "human_confirmed",
  review_status: "approved",
  artifact_status: "publication_blocked_recoverable",
  workflow_owner_stage: "publication_gate",
  workflow_next_action: "revalidate_temporal_evidence",
  evaluation_ends_at: "2026-12-12T21:00:00Z",
  timezone: "Europe/Madrid",
  resolution_deadline: "2026-12-13T21:00:00Z",
});
const scheduledDraft = draftFixture(null, {
  id: "cececece-1111-4111-8111-111111111111",
  market_slug: "scheduled-source-revalidation",
  workflow_status: "scheduled",
  review_status: "approved",
  artifact_status: "scheduled",
  workflow_owner_stage: "publication_gate",
  workflow_next_action: "wait_for_scheduled_publication",
  workflow_issue_count: 0,
  publication_schedule_status: "scheduled_waiting",
  scheduled_for: "2026-12-12T21:00:00Z",
  evaluation_ends_at: "2026-12-12T21:00:00Z",
  timezone: "Europe/Madrid",
  resolution_deadline: "2026-12-13T21:00:00Z",
});
const expiredDraft = draftFixture(eligibilityIssue, {
  id: "cdcdcdcd-1111-4111-8111-111111111111",
  market_slug: "eligibility-expired",
  radar_candidate_id: null,
  artifact_status: "draft_with_repairable_issues",
  workflow_owner_stage: "radar",
  workflow_next_action: "refresh_draft_eligibility",
});
const expiredCandidate = {
  ...candidate,
  id: "dddddddd-1111-4111-8111-111111111111",
  external_id: "KX-EXPIRED",
  eligibility_status: "technical_hold",
  verification_status: "needs_review",
  workflow_issues: [eligibilityIssue],
};
const expiredPackage = {
  ...draftPackage,
  origin: { ...draftPackage.origin, id: expiredCandidate.id },
  verdict: { ...draftPackage.verdict, workflow_issues: [eligibilityIssue] },
  gate: {
    ...draftPackage.gate,
    workflow_issues: [eligibilityIssue],
    hard_blocks: [eligibilityIssue.issue_code],
    owner_stage: "radar",
    next_action: eligibilityIssue.next_action,
  },
};
const recoveredExpiredPackage = {
  ...expiredPackage,
  origin: { ...expiredPackage.origin, preparation_revision: 4 },
  run: {
    ...expiredPackage.run,
    origin_preparation_revision: 4,
    result_json: { ...run.result_json, origin_preparation_revision: 4 },
  },
  verdict: { ...expiredPackage.verdict, origin_preparation_revision: 4, workflow_issues: [] },
  gate: {
    ...expiredPackage.gate,
    status: "proposal_ready",
    workflow_issues: [],
    hard_blocks: [],
    owner_stage: "editor",
    next_action: "apply_proposal",
  },
};
const terminalCandidate = {
  ...candidate,
  id: "eeeeeeee-1111-4111-8111-111111111111",
  external_id: "KX-TERMINAL",
  state: "rejected",
  verification_status: "rejected_resolved",
  verification_reason_code: "EVENT_ALREADY_RESOLVED",
  eligibility_status: "terminal",
  eligibility_reason_code: "EVENT_ALREADY_RESOLVED",
  hard_reject_reasons: ["EVENT_ALREADY_RESOLVED"],
  workflow_issues: [terminalIssue],
};
const terminalPackage = {
  ...draftPackage,
  origin: { ...draftPackage.origin, id: terminalCandidate.id },
  verdict: { ...draftPackage.verdict, decision: "reject", workflow_issues: [terminalIssue] },
  gate: {
    ...draftPackage.gate,
    status: "blocked",
    can_prefill: false,
    can_save_private_draft: false,
    can_materialize_private_repair_draft: false,
    workflow_issues: [terminalIssue],
    hard_blocks: [terminalIssue.issue_code],
    owner_stage: "radar",
    next_action: terminalIssue.next_action,
  },
};
const domainIssue = issueFixture({
  issue_id: "abababab-abab-4bab-8bab-abababababab",
  issue_code: "GAMING_DOMAIN_REVIEW_REQUIRED",
  detected_by: "radar", owner_stage: "human_review", repairability: "human_editable",
  blocking_scope: "approval", next_action: "review_gaming_domain_manually",
  fingerprint: "4".repeat(64),
});
const domainCandidate = {
  ...candidate,
  id: "fefefefe-1111-4111-8111-111111111111",
  external_id: "KX-DOMAIN-REVIEW", fingerprint: "5".repeat(64),
  source_probability_yes: false, domain_status: "review_required",
  domain_reason_code: "GAMING_DOMAIN_REVIEW_REQUIRED",
  eligibility_reason_code: "GAMING_DOMAIN_REVIEW_REQUIRED",
  workflow_issues: [domainIssue],
};

const scenarios = {
  "draft-temporal": { activeDraft: draft, activePayload: draftPayload },
  "radar-temporal": { activeCandidate: candidate, activePackage: draftPackage },
  "draft-content": {
    activeDraft: criteriaDraft,
    activePayload: payloadFixture(criteriaDraft, [{
      code: criteriaIssue.issue_code,
      field: "yes_criteria",
      message: "Los criterios afirmativo y negativo se solapan.",
    }]),
  },
  "radar-expired": {
    activeCandidate: expiredCandidate, activePackage: expiredPackage,
    recoveredPackage: recoveredExpiredPackage,
  },
  "radar-expired-failure": {
    activeCandidate: expiredCandidate, activePackage: expiredPackage,
    recoveredPackage: recoveredExpiredPackage,
  },
  "draft-expired-recovery": {
    activeDraft: expiredDraft,
    activePayload: payloadFixture(expiredDraft, []),
  },
  "draft-waiting": {
    activeDraft: waitingDraft,
    activePayload: payloadFixture(waitingDraft, [{
      code: waitingIssue.issue_code,
      field: "primary_source",
      message: "Falta una fuente oficial concluyente.",
    }]),
  },
  "draft-publication": {
    activeDraft: publicationDraft,
    activePayload: payloadFixture(publicationDraft, [], {
      effective_review: { id: "12121212-1212-4212-8212-121212121212", validator_version: "validator-v29" },
      latest_attempt: { id: "13131313-1313-4313-8313-131313131313", status: "approved", classification: "content", completed_at: "2026-08-20T12:00:00Z" },
      binding_compatibility: { compatible: true, required: true, plan_version: 1, binding_status: "verified" },
    }),
  },
  "draft-scheduled": {
    activeDraft: scheduledDraft,
    activePayload: payloadFixture(scheduledDraft, [], {
      effective_review: { id: "14141414-1414-4414-8414-141414141414", validator_version: "validator-v29" },
      latest_attempt: { id: "15151515-1515-4515-8515-151515151515", status: "approved", classification: "content", completed_at: "2026-08-20T12:00:00Z" },
      binding_compatibility: { compatible: true, required: true, plan_version: 1, binding_status: "verified" },
    }),
  },
  "radar-terminal": { activeCandidate: terminalCandidate, activePackage: terminalPackage },
  "radar-domain-review": { activeCandidate: domainCandidate },
};

function initMock(input) {
  const {
    scenario, run, activeCandidate = null, activePackage = null,
    activeDraft = null, activePayload = null, recoveredPackage = null,
  } = input;
  window.__atinaraCalls = [];
  let currentPayload = activePayload;
  let currentCandidate = activeCandidate;
  let eligibilityRecovered = false;
  let recoveryInvocations = 0;
  const admin = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", email: "admin@example.test", app_metadata: { oraklo_admin: true }, user_metadata: { username: "Admin" } };
  const response = (name, args) => {
    if (name === "list_admin_market_drafts") return activeDraft ? [activeDraft] : [];
    if (name === "get_admin_market_draft_v2") return currentPayload;
    if (name === "save_market_draft_from_expert_with_issues_v1") {
      return { ok: true, draft: { id: "14141414-1414-4414-8414-141414141414" } };
    }
    if (name === "publish_market_draft_v2") {
      return {
        ok: false,
        status: "publication_blocked_recoverable",
        owner_stage: "publication_gate",
        next_action: "revalidate_temporal_evidence",
        state_preserved: true,
        idempotency_replay: false,
      };
    }
    if (name === "get_admin_market_catalog" || name === "get_admin_market_audit") return [];
    return {};
  };
  const invoke = (name, body) => {
    window.__atinaraCalls.push({ name, action: body?.body?.action || "", body: body?.body || null });
    const action = body?.body?.action;
    if (name === "market-radar" && action === "discover") return { data: {
      ok: true,
      candidates: currentCandidate ? [currentCandidate] : [],
      groups: currentCandidate ? [{ event_group_key: currentCandidate.event_group_key, provider: "kalshi", title: currentCandidate.source_title, category: currentCandidate.atinara_category, verification_status: currentCandidate.verification_status, quality_score: 88, child_count: 1, candidates: [currentCandidate], top_candidates: [currentCandidate] }] : [],
      rejected: { total: scenario === "radar-terminal" ? 1 : 0, counts: scenario === "radar-terminal" ? { EVENT_ALREADY_RESOLVED: 1 } : {}, items: [] }, providers: [], candidate_providers: [], enrichment_capabilities: [], provider_issues: [], enrichment_issues: [], quality_notices: [], page: { parent_count: activeCandidate ? 1 : 0, parent_offset: 0, parent_limit: 60, next_parent_offset: null }, cached: true, cached_authoritative: true, cooldown_seconds: 0,
    }, error: null };
    if (name === "market-radar" && action === "details") return { data: { ok: true, candidate: currentCandidate }, error: null };
    if (name === "market-radar" && action === "review-domain") {
      currentCandidate = {
        ...currentCandidate,
        state: "rejected", verification_status: "rejected_ineligible",
        verification_reason_code: "OUTSIDE_GAMING_DOMAIN", eligibility_status: "terminal",
        eligibility_reason_code: "OUTSIDE_GAMING_DOMAIN", domain_status: "out_of_domain",
        domain_reason_code: "OUTSIDE_GAMING_DOMAIN", workflow_issues: [terminalIssue],
        human_domain_review: {
          request_id: body?.body?.operation_id, decision: "out_of_domain",
          rationale: body?.body?.rationale, evidence_refs: body?.body?.evidence_refs || [],
          candidate_fingerprint: currentCandidate?.fingerprint,
          policy_version: "atinara-gaming-domain-v1",
        },
      };
      return { data: { ok: true, status: "domain_review_recorded", review: {
        decision: "out_of_domain", idempotency_replay: false,
      } }, error: null };
    }
    if (name === "market-radar" && action === "recover-draft-eligibility") {
      recoveryInvocations += 1;
      if (scenario === "draft-expired-recovery" && recoveryInvocations === 1) return {
        data: null,
        error: {
          code: "FUNCTION_FAILED",
          context: {
            status: 503,
            clone: () => ({ json: async () => ({
              error: "EDGE_FUNCTION_ERROR",
              message: "La respuesta se perdió después del write técnico.",
              retryable: true,state_preserved: true,
            }) }),
          },
        },
      };
      return { data: { ok: true, status: "eligible", message: "Elegibilidad renovada." }, error: null };
    }
    if (name === "market-radar" && action === "prepare") {
      if (scenario === "radar-expired-failure") return {
        data: null,
        error: {
          code: "FUNCTION_FAILED",
          context: {
            status: 503,
            clone: () => ({ json: async () => ({
              error: "PROVIDER_UNAVAILABLE",
              message: "El proveedor no respondió; se conserva la incidencia.",
              retryable: true,
              state_preserved: true,
            }) }),
          },
        },
      };
      eligibilityRecovered = true;
      const preparedCandidate = {
        ...activeCandidate,
        preparation_revision: 4,
        state: "prepared",
        verification_status: "verified_open",
        eligibility_status: "eligible",
        current_eligibility_check_id: 44,
      };
      return { data: {
        ok: true,candidate: preparedCandidate,preparation_revision: 4,
        eligibility_check_id: 44,reservation: { preparation_revision: 4 },
        prefill: { fields: recoveredPackage?.fields || activePackage?.fields || {},origins: {} },
      }, error: null };
    }
    if (name === "market-expert" && action === "get-analysis") return { data: { run }, error: null };
    if (name === "market-expert" && action === "get-draft-package") return { data: {
      ok: true,
      package: eligibilityRecovered && recoveredPackage
        ? { ...recoveredPackage, origin: {
          ...recoveredPackage.origin, id: activeCandidate?.id || recoveredPackage.origin.id,
        } }
        : activePackage,
    }, error: null };
    if (name === "market-expert" && action === "revalidate-analysis") return { data: { ok: true }, error: null };
    if (name === "validate-market-draft") return { data: { ok: false, status: "review_rejected_repairable", message: "Validator conserva el borrador privado y lo dirige al Corrector." }, error: null };
    if (name === "market-draft-fixer") return scenario === "draft-waiting"
      ? { data: { ok: false, status: "repair_waiting_source", review: { status: "inconclusive" }, message: "La fuente oficial todavía no está disponible; el borrador sigue editable.", retryable: true, waiting_authoritative_source: true }, error: null }
      : { data: { ok: true, status: "repair_applied", review: { status: "approved" }, message: "Corrección aplicada y revalidada.", changed_fields: ["yes_criteria", "no_criteria"], new_version: 2 }, error: null };
    return { data: { ok: true }, error: null };
  };
  const chain = { select() { return this; }, eq() { return this; }, maybeSingle: async () => ({ data: { id: admin.id, username: "Admin", karma: 0, prestige: 0, rank: "Admin" }, error: null }) };
  window.__atinaraMockClient = {
    auth: { getSession: async () => ({ data: { session: { user: admin } } }), getUser: async () => ({ data: { user: admin } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }), signOut: async () => ({}) },
    from: () => chain,
    rpc: async (name, args) => { window.__atinaraCalls.push({ name, args }); return { data: response(name, args), error: null }; },
    functions: { invoke: async (name, body) => invoke(name, body) },
  };
}

const browser = await chromium.launch({ executablePath: chrome, headless: true });
async function pageFor(scenario, viewport) {
  const context = await browser.newContext({ viewport });
  await context.addInitScript(initMock, { scenario, run, ...scenarios[scenario] });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type()==="error") errors.push(message.text()); });
  page.on("requestfinished", (request) => {
    const url = new URL(request.url());
    if (url.hostname !== "127.0.0.1" && url.hostname !== "cdn.jsdelivr.net") externalNetworkCalls += 1;
  });
  await page.route("https://cdn.jsdelivr.net/**", (route) => route.fulfill({ contentType: "text/javascript", body: "window.supabase={createClient:()=>window.__atinaraMockClient};" }));
  await page.route(/^https:\/\/(?!cdn\.jsdelivr\.net).*/, (route) => {
    blockedExternalAttempts += 1;
    return route.abort();
  });
  await page.goto(`http://127.0.0.1:${port}/admin-markets.html`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#admin-markets-root:not([aria-busy='true'])", { timeout: 15_000 });
  return { page, context, errors };
}

try {
  // Caso 1 · Radar temporal -> Editor -> borrador privado -> Validator -> Corrector.
  const draftCase = await pageFor("draft-temporal", { width: 390, height: 844 });
  await draftCase.page.waitForSelector(`[data-open-draft="${draft.id}"]`, { timeout: 15_000 }).catch(async () => {
    throw new Error(`DRAFT_BROWSER_BOOT_FAILED:${draftCase.errors.join("|")}:${(await draftCase.page.textContent("body"))?.slice(0, 500)}`);
  });
  await draftCase.page.click(`[data-open-draft="${draft.id}"]`);
  await draftCase.page.waitForSelector(".admin-workflow-issues");
  await draftCase.page.waitForFunction(() => {
    const button=document.querySelector("[data-request-review]");
    return button instanceof HTMLButtonElement && !button.disabled;
  },null,{timeout:5_000}).catch(async () => {
    throw new Error(`REVIEW_BUTTON_BLOCKED:${await draftCase.page.locator("[data-request-review]").evaluate((node) => node.outerHTML)}:${draftCase.errors.join("|")}`);
  });
  await draftCase.page.waitForSelector("[data-expert-repair-panel]");
  assert.match(await draftCase.page.textContent(".admin-workflow-issues"), /Responsable: Corrector/);
  assert.match(await draftCase.page.textContent(".admin-workflow-issues"), /Siguiente acción:/);
  assert.equal(await draftCase.page.locator("[data-request-review]").isEnabled(), true);
  assert.equal(await draftCase.page.locator("[data-expert-repair-panel]").count(), 1);
  assert.equal(await draftCase.page.locator("[data-confirm-review]").count(), 0);
  assert.equal(await draftCase.page.locator("[data-publish-draft]").count(), 0);
  await draftCase.page.click("[data-request-review]");
  await draftCase.page.waitForFunction(() => window.__atinaraCalls.some((call) => call.name === "validate-market-draft"));
  assert.match(await draftCase.page.textContent("body"), /Validator conserva el borrador privado|Corrector/);
  assert.equal(await draftCase.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true);
  assert.deepEqual(draftCase.errors, []);
  await draftCase.context.close();

  const issueCase = await pageFor("radar-temporal", { width: 1366, height: 900 });
  await issueCase.page.click('[data-admin-view="radar"]');
  await issueCase.page.waitForSelector(`[data-radar-details="${candidate.id}"]`);
  await issueCase.page.click(`[data-radar-details="${candidate.id}"]`);
  await issueCase.page.waitForSelector(`[data-expert-apply="${candidate.id}"]:not([disabled])`);
  await issueCase.page.click(`[data-expert-apply="${candidate.id}"]`);
  await issueCase.page.waitForSelector("#admin-market-form .market-expert-bridge-banner").catch(async () => {
    const debug = await issueCase.page.evaluate(() => ({
      calls: window.__atinaraCalls,
      status: document.querySelector(".admin-status-message")?.textContent || "",
      bridgeStatus: document.querySelector(".market-expert-bridge-status")?.textContent || "",
      form: document.querySelector("#admin-market-form")?.outerHTML.slice(0, 1200) || "",
    }));
    throw new Error(`ISSUE_FORM_BRIDGE_FAILED:${JSON.stringify(debug)}:${issueCase.errors.join("|")}`);
  });
  assert.equal(await issueCase.page.inputValue('[name="evaluation_ends_at"]'), "");
  assert.match(await issueCase.page.textContent(".admin-status-message"), /incidencias|privad/i);
  const calls = await issueCase.page.evaluate(() => window.__atinaraCalls);
  assert.equal(calls.some((call) => call.name === "market-radar" && call.action === "prepare"), false);
  assert.equal(calls.some((call) => call.name === "market-expert" && ["analyze-origin", "revalidate-analysis"].includes(call.action)), false);
  assert.equal(await issueCase.page.locator("[data-save-draft]").isEnabled(), true);
  await issueCase.page.click("[data-save-draft]");
  await issueCase.page.waitForFunction(() => window.__atinaraCalls.some((call) => call.name === "save_market_draft_from_expert_with_issues_v1"));
  assert.equal(await issueCase.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true);
  assert.deepEqual(issueCase.errors, []);
  await issueCase.context.close();

  // Caso 2 · criterios incoherentes -> Corrector -> revalidación.
  const contentCase = await pageFor("draft-content", { width: 1366, height: 900 });
  await contentCase.page.click(`[data-open-draft="${criteriaDraft.id}"]`);
  await contentCase.page.waitForSelector("[data-expert-repair-panel]");
  contentCase.page.on("dialog", (dialog) => dialog.accept());
  assert.equal(await contentCase.page.locator("[data-expert-repair-draft]").isEnabled(), true);
  await contentCase.page.click("[data-expert-repair-draft]");
  await contentCase.page.waitForFunction(() => window.__atinaraCalls.some((call) => call.name === "market-draft-fixer"));
  await contentCase.page.waitForFunction(() => /Corrección aplicada y revalidada/.test(document.querySelector("[data-expert-repair-status]")?.textContent || ""));
  assert.equal((await contentCase.page.evaluate(() => window.__atinaraCalls)).filter((call) => call.name === "market-draft-fixer").length, 1);
  assert.deepEqual(contentCase.errors, []);
  await contentCase.context.close();

  // Caso 3 · elegibilidad caducada: Radar recupera primero y actualiza el expediente exacto.
  const expiredCase = await pageFor("radar-expired", { width: 390, height: 844 });
  await expiredCase.page.click('[data-admin-view="radar"]');
  await expiredCase.page.click(`[data-radar-details="${expiredCandidate.id}"]`);
  await expiredCase.page.waitForSelector(`[data-expert-apply="${expiredCandidate.id}"]:not([disabled])`);
  await expiredCase.page.click(`[data-expert-apply="${expiredCandidate.id}"]`);
  await expiredCase.page.waitForSelector("#admin-market-form .market-expert-bridge-banner").catch(async () => {
    throw new Error(`EXPIRED_RECOVERY_BRIDGE_FAILED:${JSON.stringify(await expiredCase.page.evaluate(() => ({
      calls: window.__atinaraCalls,
      status: document.querySelector(".admin-status-message")?.textContent || "",
      bridge: document.querySelector(".market-expert-bridge-status")?.textContent || "",
    })))}:${expiredCase.errors.join("|")}`);
  });
  assert.equal(await expiredCase.page.locator("[data-save-draft]").isEnabled(), true);
  assert.equal(await expiredCase.page.inputValue('[name="evaluation_ends_at"]'), "");
  const expiredCalls = await expiredCase.page.evaluate(() => window.__atinaraCalls);
  assert.equal(expiredCalls.some((call) => call.name === "market-radar" && call.action === "prepare"), true);
  assert.equal(expiredCalls.some((call) => call.name === "market-expert" && call.action === "analyze-origin"), true);
  assert.equal(expiredCalls.some((call) => call.name === "market-expert" && call.action === "revalidate-analysis"), false);
  assert.deepEqual(expiredCase.errors, []);
  await expiredCase.context.close();

  // Caso 3b · si la recuperación técnica falla, se conserva la incidencia sin fingir elegibilidad.
  const expiredFailureCase = await pageFor("radar-expired-failure", { width: 768, height: 900 });
  await expiredFailureCase.page.click('[data-admin-view="radar"]');
  await expiredFailureCase.page.click(`[data-radar-details="${expiredCandidate.id}"]`);
  await expiredFailureCase.page.waitForSelector(`[data-expert-apply="${expiredCandidate.id}"]:not([disabled])`);
  await expiredFailureCase.page.click(`[data-expert-apply="${expiredCandidate.id}"]`);
  await expiredFailureCase.page.waitForSelector("#admin-market-form .market-expert-bridge-banner");
  const expiredFailureCalls = await expiredFailureCase.page.evaluate(() => window.__atinaraCalls);
  assert.equal(expiredFailureCalls.some((call) => call.name === "market-radar" && call.action === "prepare"), true);
  assert.equal(expiredFailureCalls.some((call) => call.name === "market-expert" && call.action === "revalidate-analysis"), false);
  assert.equal(await expiredFailureCase.page.locator("[data-save-draft]").isEnabled(), true);
  await expiredFailureCase.page.click("[data-save-draft]");
  await expiredFailureCase.page.waitForFunction(() => window.__atinaraCalls.some((call) => call.name === "save_market_draft_from_expert_with_issues_v1"));
  assert.deepEqual(expiredFailureCase.errors, []);
  await expiredFailureCase.context.close();

  const recoveryCase = await pageFor("draft-expired-recovery", { width: 768, height: 900 });
  await recoveryCase.page.click(`[data-open-draft="${expiredDraft.id}"]`);
  assert.equal(await recoveryCase.page.locator("[data-expert-repair-panel]").count(),0);
  await recoveryCase.page.waitForSelector(`[data-recover-draft-eligibility="${candidate.id}"]:not([disabled])`);
  await recoveryCase.page.click(`[data-recover-draft-eligibility="${candidate.id}"]`);
  await recoveryCase.page.waitForFunction(() => window.__atinaraCalls.filter((call) => call.name === "market-radar" && call.action === "recover-draft-eligibility").length===1);
  await recoveryCase.page.waitForSelector(`[data-recover-draft-eligibility="${candidate.id}"]:not([disabled])`);
  await recoveryCase.page.click(`[data-recover-draft-eligibility="${candidate.id}"]`);
  await recoveryCase.page.waitForFunction(() => window.__atinaraCalls.filter((call) => call.name === "market-radar" && call.action === "recover-draft-eligibility").length===2);
  const recoveryCalls = (await recoveryCase.page.evaluate(() => window.__atinaraCalls))
    .filter((call) => call.name === "market-radar" && call.action === "recover-draft-eligibility");
  assert.equal(recoveryCalls[0].body.operation_id,recoveryCalls[1].body.operation_id);
  assert.deepEqual(recoveryCase.errors, []);
  await recoveryCase.context.close();

  // Caso 4 · fuente no encontrada: espera explícita, edición y reintento disponibles, sin publicación.
  const waitingCase = await pageFor("draft-waiting", { width: 390, height: 844 });
  await waitingCase.page.click(`[data-open-draft="${waitingDraft.id}"]`);
  await waitingCase.page.waitForSelector("[data-expert-repair-panel]");
  assert.match(await waitingCase.page.textContent(".admin-workflow-issues"), /Corrector|Siguiente acción/);
  assert.equal(await waitingCase.page.locator('[name="primary_source_url"]').isEnabled(), true);
  assert.equal(await waitingCase.page.locator("[data-expert-repair-draft]").isEnabled(), true);
  assert.equal(await waitingCase.page.locator("[data-publish-draft]").count(), 0);
  waitingCase.page.on("dialog", (dialog) => dialog.accept());
  await waitingCase.page.click("[data-expert-repair-draft]");
  await waitingCase.page.waitForFunction(() => window.__atinaraCalls.some((call) => call.name === "market-draft-fixer"));
  await waitingCase.page.waitForFunction(() => /todavía no está disponible|sigue editable/.test(document.querySelector("[data-expert-repair-status]")?.textContent || ""));
  assert.deepEqual(waitingCase.errors, []);
  await waitingCase.context.close();

  // Caso 5 · publicación revalida una fuente obsoleta y devuelve la ruta recuperable sin recrear borrador.
  const publicationCase = await pageFor("draft-publication", { width: 1366, height: 900 });
  await publicationCase.page.click(`[data-open-draft="${publicationDraft.id}"]`);
  await publicationCase.page.waitForSelector("[data-publish-draft]:not([disabled])");
  publicationCase.page.on("dialog", (dialog) => dialog.accept());
  await publicationCase.page.click("[data-publish-draft]");
  await publicationCase.page.waitForFunction(() => window.__atinaraCalls.some((call) => call.name === "publish_market_draft_v2"));
  await publicationCase.page.waitForFunction(() => /Puerta de publicación|Revalidar la evidencia temporal/.test(document.body.textContent || ""));
  const publicationCalls = await publicationCase.page.evaluate(() => window.__atinaraCalls);
  assert.equal(publicationCalls.filter((call) => call.name === "publish_market_draft_v2").length, 1);
  assert.equal(publicationCalls.some((call) => call.name === "save_market_draft_from_expert_with_issues_v1"), false);
  assert.deepEqual(publicationCase.errors, []);
  await publicationCase.context.close();

  // Caso 6 · condición terminal: Radar audita y no ofrece Editor, Gemini ni borrador.
  const terminalCase = await pageFor("radar-terminal", { width: 1366, height: 900 });
  await terminalCase.page.click('[data-admin-view="radar"]');
  await terminalCase.page.waitForSelector(`[data-radar-details="${terminalCandidate.id}"]`);
  await terminalCase.page.click(`[data-radar-details="${terminalCandidate.id}"]`);
  assert.match(await terminalCase.page.textContent("body"), /Evento ya resuelto|resultado ya/i);
  assert.equal(await terminalCase.page.locator(`[data-expert-apply="${terminalCandidate.id}"]:not([disabled])`).count(), 0);
  assert.equal(await terminalCase.page.locator("#admin-market-form").count(), 0);
  const terminalCalls = await terminalCase.page.evaluate(() => window.__atinaraCalls);
  assert.equal(terminalCalls.some((call) => call.name === "market-expert"), false);
  assert.equal(terminalCalls.some((call) => call.name === "save_market_draft_from_expert_with_issues_v1"), false);
  assert.deepEqual(terminalCase.errors, []);
  await terminalCase.context.close();

  // Caso 7 · revisión humana de dominio: dato inválido no se vuelve cero y una
  // decisión fuera de ámbito deja la candidata terminal sin invocar Editor.
  const domainCase = await pageFor("radar-domain-review", { width: 768, height: 900 });
  await domainCase.page.click('[data-admin-view="radar"]');
  await domainCase.page.waitForSelector(`[data-radar-details="${domainCandidate.id}"]`);
  await domainCase.page.click(`[data-radar-details="${domainCandidate.id}"]`);
  assert.match(await domainCase.page.textContent("body"), /Sin precio disponible/);
  assert.equal(await domainCase.page.locator(`[data-expert-apply="${domainCandidate.id}"]:not([disabled])`).count(), 0);
  await domainCase.page.fill('[name="radar_domain_rationale"]', "La categoría registral y el evento oficial demuestran que no pertenece al catálogo gaming.");
  domainCase.page.on("dialog", (dialog) => dialog.accept());
  await domainCase.page.click('[data-radar-domain-decision="out_of_domain"]');
  await domainCase.page.waitForFunction(() => window.__atinaraCalls.some((call) => call.name === "market-radar" && call.action === "review-domain"));
  await domainCase.page.waitForFunction(() => /Fuera del dominio gaming|fuera del ámbito/i.test(document.body.textContent || ""));
  const domainCalls = await domainCase.page.evaluate(() => window.__atinaraCalls);
  assert.equal(domainCalls.filter((call) => call.name === "market-radar" && call.action === "review-domain").length, 1);
  assert.equal(domainCalls.some((call) => call.name === "market-expert"
    && ["analyze-origin", "revalidate-analysis"].includes(call.action)), false);
  assert.equal(domainCalls.some((call) => call.name === "save_market_draft_from_expert_with_issues_v1"), false);
  assert.equal(await domainCase.page.locator(`[data-expert-apply="${domainCandidate.id}"]:not([disabled])`).count(), 0);
  assert.equal(await domainCase.page.locator("#admin-market-form").count(), 0);
  assert.equal(await domainCase.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true);
  assert.deepEqual(domainCase.errors, []);
  await domainCase.context.close();

  // Caso 8 · un borrador programado no permite editar ni ofrece anclas muertas:
  // cancelar es la acción explícita previa a cualquier edición o Corrector.
  const scheduledCase = await pageFor("draft-scheduled", { width: 768, height: 900 });
  await scheduledCase.page.click(`[data-open-draft="${scheduledDraft.id}"]`);
  await scheduledCase.page.waitForSelector("[data-cancel-scheduled]:not([disabled])");
  assert.equal(await scheduledCase.page.locator('[name="question"]').isDisabled(), true);
  assert.equal(await scheduledCase.page.locator("[data-save-draft]").isDisabled(), true);
  assert.match(await scheduledCase.page.textContent(".admin-locked-notice"), /cancela primero la programación/i);
  assert.match(await scheduledCase.page.textContent(".admin-service-incident"), /Cancela la programación antes de editar/i);
  assert.equal(await scheduledCase.page.locator('[href="#admin-market-form"]:has-text("Atender incidencia")').count(), 0);
  assert.equal(await scheduledCase.page.locator("[data-expert-repair-panel]").count(), 0);
  assert.equal(await scheduledCase.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true);
  assert.deepEqual(scheduledCase.errors, []);
  await scheduledCase.context.close();

  assert.equal(externalNetworkCalls, 0);
  process.stdout.write(`MARKET_WORKFLOW_BROWSER_OK cases=11 viewports=390,768,1366 externalNetworkCalls=${externalNetworkCalls} blockedExternalAttempts=${blockedExternalAttempts}\n`);
} finally {
  await browser.close();
  await new Promise((resolveClose) => server.close(resolveClose));
}
