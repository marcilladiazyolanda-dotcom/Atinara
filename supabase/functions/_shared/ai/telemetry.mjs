import { AI_ERROR_CODES } from "./errors.mjs";
import { childTimeoutMs } from "./deadline.mjs";

function lifecycleEntries(values, startedAt) {
  return values.map((state, index) => ({
    state,
    offsetMs: Math.max(0, Math.round((startedAt[state] ?? startedAt.completed ?? Date.now()) - startedAt.created)),
    sequence: index + 1,
  }));
}

export async function persistAiTelemetry({ persistence, context, policy, record, timeline, logger = console }) {
  try {
    const timeoutMs = childTimeoutMs(context, 2_000, Math.max(0, policy.finalizationReserveMs - 2_000));
    const child = new AbortController();
    const abort = () => child.abort(context.signal?.reason);
    if (context.signal?.aborted) abort();
    else context.signal?.addEventListener?.("abort", abort, { once: true });
    const timer = setTimeout(() => child.abort(), timeoutMs);
    try {
      await persistence.recordInvocation({
        ...record,
        lifecycle: lifecycleEntries(policy.lifecycle, timeline),
      }, child.signal);
    } finally {
      clearTimeout(timer);
      context.signal?.removeEventListener?.("abort", abort);
    }
    return Object.freeze({ status: "persisted", warnings: Object.freeze([]) });
  } catch {
    logger?.error?.("AI telemetry persistence failed", JSON.stringify({
      code: AI_ERROR_CODES.TELEMETRY_WRITE_FAILED,
      invocationId: record.invocationId,
      taskType: record.taskType,
      routeId: record.routeId,
    }));
    return Object.freeze({
      status: "failed",
      warnings: Object.freeze([AI_ERROR_CODES.TELEMETRY_WRITE_FAILED]),
    });
  }
}

export async function persistAgentTelemetry({ persistence, context, execution, logger = console }) {
  try {
    const timeoutMs = childTimeoutMs(context, 2_500, 1_000);
    const child = new AbortController();
    const abort = () => child.abort(context.signal?.reason);
    if (context.signal?.aborted) abort();
    else context.signal?.addEventListener?.("abort", abort, { once: true });
    const timer = setTimeout(() => child.abort(), timeoutMs);
    try {
      await persistence.recordAgentExecution(execution, child.signal);
    } finally {
      clearTimeout(timer);
      context.signal?.removeEventListener?.("abort", abort);
    }
    return Object.freeze({ status: "persisted", warnings: Object.freeze([]) });
  } catch {
    logger?.error?.("Agent telemetry persistence failed", JSON.stringify({
      code: AI_ERROR_CODES.TELEMETRY_WRITE_FAILED,
      invocationId: execution?.run_id,
      agentType: execution?.agent_type,
    }));
    return Object.freeze({
      status: "failed",
      warnings: Object.freeze([AI_ERROR_CODES.TELEMETRY_WRITE_FAILED]),
    });
  }
}
