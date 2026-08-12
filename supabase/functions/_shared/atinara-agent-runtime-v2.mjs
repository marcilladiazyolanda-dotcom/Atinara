import { canonicalJson, sha256Hex } from "./ai/contracts.mjs";
import { assertDeadlineBudget } from "./ai/deadline.mjs";
import {
  ATINARA_AGENT_REGISTRY_VERSION,
  assertRegistryIdentity,
  strategyAllowsWrite,
} from "./atinara-agent-registries-v2.mjs";
import {
  ATINARA_AGENT_TOOL_MANIFEST_V2,
  assertToolHandlers,
  resolveAgentTool,
} from "./atinara-agent-tools-v2.mjs";

export const ATINARA_AGENT_PROTOCOL_VERSION_V2 = "atinara-agent-protocol-v2.1";
export const ATINARA_AGENT_OUTCOMES_V2 = Object.freeze([
  "completed", "degraded", "needs_human_review", "technical_hold",
  "stale_snapshot", "no_progress", "budget_exhausted", "failed",
]);

const DEFAULT_PLANS = Object.freeze({
  radar_source_agent: Object.freeze([
    "read_provider_contract", "search_official_sources", "fetch_official_source",
    "classify_terminal_evidence", "select_resolution_authority",
  ]),
  market_editor_agent: Object.freeze([
    "load_authoritative_origin", "run_deterministic_gate", "request_editorial_enrichment",
    "validate_resolution_contract", "build_private_draft_gate", "persist_editor_run",
  ]),
  market_corrector_agent: Object.freeze([
    "load_authoritative_draft", "classify_repair_issues", "discover_official_sources",
    "build_typed_patch", "validate_typed_patch", "persist_single_version", "revalidate_draft",
  ]),
});

function text(value, max = 180) {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

function integer(value, fallback, min, max) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= min && number <= max ? number : fallback;
}

function safeSummary(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).slice(0, 12).flatMap(([key, item]) => {
    const safeKey = text(key, 60).replace(/[^a-z0-9_]/gi, "_");
    if (!safeKey || /authorization|cookie|secret|token|api_?key|password|prompt|sql|email/i.test(safeKey)) return [];
    if (typeof item === "boolean" || item === null || (typeof item === "number" && Number.isFinite(item))) return [[safeKey, item]];
    return typeof item === "string" ? [[safeKey, text(item, 180)]] : [];
  }));
}

export function planAgentTools(agentType, state = {}) {
  const plan = DEFAULT_PLANS[agentType];
  if (!plan) throw new Error("AGENT_TYPE_INVALID");
  if (agentType === "market_editor_agent" && state.deterministicBlocked === true) {
    return Object.freeze(["load_authoritative_origin", "run_deterministic_gate", "persist_editor_run"]);
  }
  if (agentType === "market_corrector_agent" && state.requiresSourceDiscovery !== true) {
    return Object.freeze(plan.filter((tool) => tool !== "discover_official_sources"));
  }
  return plan;
}

export function createAtinaraAgentRunV2(options = {}) {
  const agentType = text(options.agentType, 80);
  const allowed = ATINARA_AGENT_TOOL_MANIFEST_V2[agentType];
  if (!allowed) throw new Error("AGENT_TYPE_INVALID");
  assertToolHandlers(agentType, options.handlers);
  const registryVersion = text(options.registryVersion || ATINARA_AGENT_REGISTRY_VERSION, 120);
  const registryHash = text(options.registryHash, 64).toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(registryHash)) throw new Error("AGENT_REGISTRY_IDENTITY_INVALID");
  const context = options.executionContext;
  assertDeadlineBudget(context, integer(options.finalizationReserveMs, 10_000, 1_000, 30_000));
  const runId = text(options.runId || context.agentRunId || crypto.randomUUID(), 120);
  const maxSteps = integer(options.maxSteps, 14, 1, 40);
  const maxReplans = integer(options.maxReplans, 2, 0, 2);
  const maxRepeatedActions = integer(options.maxRepeatedActions, 1, 1, 3);
  const initialSnapshotFingerprint = text(options.snapshotFingerprint, 64).toLowerCase();
  const runStartedAt = new Date().toISOString();
  const events = [];
  const actionCounts = new Map();
  const progress = new Set();
  const writesByRound = new Map();
  let authoritativeSnapshotFingerprint = initialSnapshotFingerprint;
  let outcome = "running";
  let stopReason = null;
  let replans = 0;

  const identity = Object.freeze({ registryVersion, registryHash });
  const runIdentity = Object.freeze({ registryVersion, registryHash });

  async function dispatch(toolName, input = {}, dispatchOptions = {}) {
    if (outcome !== "running") throw new Error("AGENT_ALREADY_COMPLETED");
    assertRegistryIdentity(runIdentity, identity.registryVersion, identity.registryHash);
    assertDeadlineBudget(context, integer(options.finalizationReserveMs, 10_000, 1_000, 30_000));
    if (events.length >= maxSteps) throw new Error("AGENT_STEP_BUDGET_EXHAUSTED");
    const tool = resolveAgentTool(agentType, text(toolName, 80));
    const handler = options.handlers[tool.tool];
    const round = integer(dispatchOptions.round, 1, 1, 20);

    if (tool.canWrite) {
      const expectedSnapshot = text(dispatchOptions.expectedSnapshotFingerprint, 64).toLowerCase();
      if (!expectedSnapshot || expectedSnapshot !== authoritativeSnapshotFingerprint) throw new Error("AGENT_STALE_SNAPSHOT");
      if (!strategyAllowsWrite(input?.strategyKey)) throw new Error("AGENT_STRATEGY_WRITE_FORBIDDEN");
      if ((writesByRound.get(round) ?? 0) >= 1) throw new Error("AGENT_WRITE_BUDGET_EXHAUSTED");
    }

    const actionKey = text(dispatchOptions.actionKey || tool.tool, 180);
    const count = (actionCounts.get(actionKey) ?? 0) + 1;
    actionCounts.set(actionKey, count);
    if (count > maxRepeatedActions) throw new Error("AGENT_REPEATED_ACTION");
    const progressFingerprint = text(dispatchOptions.progressFingerprint, 180);
    if (progressFingerprint && progress.has(progressFingerprint)) throw new Error("AGENT_NO_PROGRESS");
    if (progressFingerprint) progress.add(progressFingerprint);
    if (tool.canWrite) {
      writesByRound.set(round, 1);
    }

    const startedAt = Date.now();
    const result = await handler(input, Object.freeze({
      runId, agentType, round, tool, registryVersion, registryHash,
      absoluteDeadlineAt: context.absoluteDeadlineAt,
      signal: context.signal,
    }));
    const resultRecord = result && typeof result === "object" && !Array.isArray(result) ? result : {};
    if (tool.canWrite && typeof resultRecord.snapshotFingerprint === "string") {
      authoritativeSnapshotFingerprint = text(resultRecord.snapshotFingerprint, 64).toLowerCase();
    }
    events.push(Object.freeze({
      sequence: events.length + 1,
      round,
      tool: tool.tool,
      strategy_key: text(input?.strategyKey, 100) || null,
      can_write: tool.canWrite,
      status: ["completed", "degraded", "failed", "no_op"].includes(resultRecord.status) ? resultRecord.status : "completed",
      progress_fingerprint: await sha256Hex(progressFingerprint || canonicalJson({ tool: tool.tool, actionKey, round })),
      duration_ms: Math.max(0, Date.now() - startedAt),
      summary: safeSummary(resultRecord.summary),
    }));
    return resultRecord;
  }

  async function execute(initialState = {}) {
    let state = initialState;
    while (true) {
      const tools = planAgentTools(agentType, state);
      let requestedReplan = false;
      for (const tool of tools) {
        const result = await dispatch(tool, state, {
          round: integer(state.round, 1, 1, 20),
          actionKey: `${tool}:${integer(state.round, 1, 1, 20)}:${replans}`,
          progressFingerprint: await sha256Hex(canonicalJson({ tool, state, replans })),
          expectedSnapshotFingerprint: authoritativeSnapshotFingerprint,
        });
        state = result.nextState && typeof result.nextState === "object" ? result.nextState : state;
        if (result.replan === true) {
          if (replans >= maxReplans) throw new Error("AGENT_REPLAN_BUDGET_EXHAUSTED");
          replans += 1;
          requestedReplan = true;
          break;
        }
      }
      if (!requestedReplan) break;
    }
    outcome = "completed";
    return snapshot();
  }

  /**
   * @param {string} [nextOutcome]
   * @param {string | null} [reason]
   */
  function complete(nextOutcome = "completed", reason = null) {
    const safeOutcome = text(nextOutcome, 40);
    outcome = ATINARA_AGENT_OUTCOMES_V2.includes(safeOutcome) ? safeOutcome : "failed";
    stopReason = reason ? text(reason, 120) : stopReason;
    return snapshot();
  }

  function snapshot() {
    return Object.freeze({
      protocol_version: ATINARA_AGENT_PROTOCOL_VERSION_V2,
      registry_version: registryVersion,
      registry_hash: registryHash,
      run_id: runId,
      agent_type: agentType,
      status: outcome,
      stop_reason: stopReason,
      started_at: runStartedAt,
      completed_at: new Date().toISOString(),
      absolute_deadline_at: context.absoluteDeadlineAt,
      snapshot_fingerprint: authoritativeSnapshotFingerprint,
      step_count: events.length,
      replan_count: replans,
      max_replans: maxReplans,
      tools: events.map((event) => ({ ...event, summary: { ...event.summary } })),
      human_confirmation_required: true,
      writes_per_round_maximum: 1,
      publishes: false,
      resolves: false,
      liquidates: false,
    });
  }

  return Object.freeze({ dispatch, execute, complete, snapshot });
}
