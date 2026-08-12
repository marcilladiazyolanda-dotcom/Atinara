export const ATINARA_AGENT_PROTOCOL_VERSION = "atinara-agent-protocol-v1";

export const ATINARA_AGENT_TOOL_MANIFEST = Object.freeze({
  radar_source_agent: Object.freeze([
    "read_provider_contract",
    "search_official_sources",
    "fetch_official_source",
    "classify_terminal_evidence",
    "select_resolution_authority",
    "persist_eligibility",
  ]),
  market_editor_agent: Object.freeze([
    "load_authoritative_origin",
    "run_deterministic_gate",
    "request_editorial_enrichment",
    "validate_resolution_contract",
    "build_private_draft_gate",
    "persist_editor_run",
  ]),
  market_corrector_agent: Object.freeze([
    "load_authoritative_draft",
    "classify_repair_issues",
    "discover_official_sources",
    "build_typed_patch",
    "validate_typed_patch",
    "persist_single_version",
    "revalidate_draft",
  ]),
});

function safeText(value, maxLength) {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ").trim().slice(0, maxLength);
}

const SENSITIVE_SUMMARY_KEY = /(?:authorization|bearer|cookie|secret|token|api_?key|password|prompt|sql|header|email)/i;
const SECRET_LIKE_TEXT = /(?:Bearer\s+[A-Za-z0-9._~+/=-]+|eyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{8,}|[A-Za-z0-9_-]{32,})/g;

function safeSummaryText(value, maxLength) {
  return safeText(value, maxLength).replace(SECRET_LIKE_TEXT, "[redacted]");
}

function safeInteger(value, fallback, minimum, maximum) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= minimum && number <= maximum ? number : fallback;
}

function safeSummary(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const output = {};
  for (const [key, item] of Object.entries(value).slice(0, 12)) {
    const safeKey = safeText(key, 60).replace(/[^a-z0-9_]/gi, "_");
    if (!safeKey || SENSITIVE_SUMMARY_KEY.test(safeKey)) continue;
    if (typeof item === "boolean" || item === null) output[safeKey] = item;
    else if (typeof item === "number" && Number.isFinite(item)) output[safeKey] = item;
    else if (typeof item === "string") output[safeKey] = safeSummaryText(item, 180);
    else if (Array.isArray(item)) output[safeKey] = item.slice(0, 8).map((entry) => safeSummaryText(entry, 100));
  }
  return output;
}

/**
 * @param {{
 *   agentType:string,
 *   objective?:string,
 *   policyVersion?:string,
 *   runId?:string,
 *   maxSteps?:number,
 *   maxRepeatedActions?:number,
 *   deadlineAt?:number,
 *   startedAt?:string
 * }} options
 */
export function createAtinaraAgentRun({
  agentType,
  objective,
  policyVersion,
  runId,
  maxSteps = 12,
  maxRepeatedActions = 1,
  deadlineAt = Number.POSITIVE_INFINITY,
  startedAt = new Date().toISOString(),
} = {}) {
  const type = safeText(agentType, 80);
  const allowedTools = new Set(ATINARA_AGENT_TOOL_MANIFEST[type] ?? []);
  if (!type || !allowedTools.size) throw new Error("AGENT_TYPE_INVALID");
  const id = safeText(runId, 80) || globalThis.crypto?.randomUUID?.() || `agent-${Date.now()}`;
  const stepLimit = safeInteger(maxSteps, 12, 1, 40);
  const repeatLimit = safeInteger(maxRepeatedActions, 1, 1, 4);
  const events = [];
  const actionCounts = new Map();
  const progressFingerprints = new Set();
  let stopReason = null;
  let outcome = "running";

  const stopped = () => Boolean(stopReason) || outcome !== "running";
  const record = (tool, {
    status = "completed",
    actionKey = "",
    progressFingerprint = "",
    summary = {},
    retryable = false,
  } = {}) => {
    const toolName = safeText(tool, 80);
    if (!allowedTools.has(toolName)) throw new Error("AGENT_TOOL_NOT_ALLOWED");
    if (stopped()) return { accepted: false, stop_reason: stopReason || "AGENT_ALREADY_COMPLETED" };
    if (Date.now() >= Number(deadlineAt)) {
      stopReason = "AGENT_DEADLINE_EXCEEDED";
      return { accepted: false, stop_reason: stopReason };
    }
    if (events.length >= stepLimit) {
      stopReason = "AGENT_STEP_BUDGET_EXHAUSTED";
      return { accepted: false, stop_reason: stopReason };
    }
    const normalizedAction = safeText(actionKey || toolName, 180);
    const nextCount = (actionCounts.get(normalizedAction) ?? 0) + 1;
    actionCounts.set(normalizedAction, nextCount);
    if (nextCount > repeatLimit) {
      stopReason = "AGENT_REPEATED_ACTION";
      return { accepted: false, stop_reason: stopReason };
    }
    const progress = safeText(progressFingerprint, 180);
    if (progress && progressFingerprints.has(progress)) {
      stopReason = "AGENT_NO_PROGRESS";
      return { accepted: false, stop_reason: stopReason };
    }
    if (progress) progressFingerprints.add(progress);
    events.push({
      sequence: events.length + 1,
      tool: toolName,
      status: ["completed", "degraded", "failed", "no_op"].includes(status) ? status : "failed",
      retryable: retryable === true,
      summary: safeSummary(summary),
    });
    return { accepted: true, sequence: events.length, stop_reason: null };
  };

  /** @param {string} [nextOutcome] @param {string|null} [reason] */
  const complete = (nextOutcome = "completed", reason = null) => {
    if (outcome === "running") outcome = safeText(nextOutcome, 40) || "completed";
    if (reason && !stopReason) stopReason = safeText(reason, 100);
    return snapshot();
  };

  const snapshot = () => ({
    protocol_version: ATINARA_AGENT_PROTOCOL_VERSION,
    run_id: id,
    agent_type: type,
    objective: safeText(objective, 240),
    policy_version: safeText(policyVersion, 100),
    status: outcome,
    stop_reason: stopReason,
    started_at: startedAt,
    step_count: events.length,
    max_steps: stepLimit,
    tools: events.map((event) => ({ ...event, summary: { ...event.summary } })),
    human_confirmation_required: true,
    publishes: false,
    resolves: false,
  });

  return Object.freeze({ record, complete, snapshot, stopped });
}

export function agentToolSummary(agentExecution) {
  const tools = Array.isArray(agentExecution?.tools) ? agentExecution.tools : [];
  return tools.slice(0, 20).map((event) => ({
    tool: safeText(event?.tool, 80),
    status: safeText(event?.status, 40),
    count: Number(event?.summary?.count ?? 1) || 1,
  }));
}
