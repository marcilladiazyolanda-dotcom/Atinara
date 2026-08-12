import { AI_ERROR_CODES, aiError } from "./errors.mjs";

export function remainingDeadlineMs(context, now = Date.now()) {
  return Math.max(0, Number(context?.absoluteDeadlineAt) - now);
}

export function assertDeadlineBudget(context, finalizationReserveMs, now = Date.now()) {
  const remaining = remainingDeadlineMs(context, now);
  if (context?.signal?.aborted || remaining <= Math.max(0, Number(finalizationReserveMs) || 0)) {
    throw aiError(AI_ERROR_CODES.DEADLINE_EXCEEDED, {
      httpStatus: 504,
      retryable: true,
      details: { phase: "deadline_budget" },
    });
  }
  return remaining;
}

export function childTimeoutMs(context, timeoutPolicyMs, finalizationReserveMs, now = Date.now()) {
  const remaining = assertDeadlineBudget(context, finalizationReserveMs, now);
  const available = remaining - Math.max(0, Number(finalizationReserveMs) || 0);
  return Math.max(1, Math.min(Math.max(1, Number(timeoutPolicyMs) || 1), available));
}

export function createChildAbort(context, timeoutPolicyMs, finalizationReserveMs, now = Date.now()) {
  const timeoutMs = childTimeoutMs(context, timeoutPolicyMs, finalizationReserveMs, now);
  const controller = new AbortController();
  const abortFromParent = () => controller.abort(context.signal?.reason);
  if (context.signal?.aborted) abortFromParent();
  else context.signal?.addEventListener?.("abort", abortFromParent, { once: true });
  const timeout = setTimeout(() => controller.abort(new DOMException("AI provider deadline", "TimeoutError")), timeoutMs);
  return {
    signal: controller.signal,
    timeoutMs,
    cleanup() {
      clearTimeout(timeout);
      context.signal?.removeEventListener?.("abort", abortFromParent);
    },
  };
}

export async function fetchWithinDeadline(
  input,
  init,
  context,
  {
    timeoutPolicyMs = 30_000,
    finalizationReserveMs = 10_000,
    maxResponseBytes = 2_000_000,
    fetchImpl = globalThis.fetch,
  } = {},
) {
  const child = createChildAbort(context, timeoutPolicyMs, finalizationReserveMs);
  try {
    const suppliedSignal = init?.signal;
    const signal = suppliedSignal && suppliedSignal !== child.signal
      ? AbortSignal.any([child.signal, suppliedSignal])
      : child.signal;
    const response = await fetchImpl(input, { ...init, signal });
    const declaredLength = Number(response.headers.get("content-length") || 0);
    if (declaredLength > maxResponseBytes) throw new Error("INTERNAL_RESPONSE_TOO_LARGE");
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > maxResponseBytes) throw new Error("INTERNAL_RESPONSE_TOO_LARGE");
    const bodyForbidden = [101, 204, 205, 304].includes(response.status);
    return new Response(bodyForbidden ? null : bytes, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  } finally {
    child.cleanup();
  }
}

export async function deadlineSleep(milliseconds, context, finalizationReserveMs = 0) {
  const duration = Math.max(0, Number(milliseconds) || 0);
  const available = childTimeoutMs(context, duration || 1, finalizationReserveMs);
  if (duration > available) throw aiError(AI_ERROR_CODES.DEADLINE_EXCEEDED, { httpStatus: 504, retryable: true });
  await new Promise((resolve, reject) => {
    const finish = () => {
      context.signal?.removeEventListener?.("abort", abort);
      resolve();
    };
    const timer = setTimeout(finish, duration);
    const abort = () => {
      clearTimeout(timer);
      context.signal?.removeEventListener?.("abort", abort);
      reject(aiError(AI_ERROR_CODES.DEADLINE_EXCEEDED, { httpStatus: 504, retryable: true }));
    };
    if (context.signal?.aborted) abort();
    else context.signal?.addEventListener?.("abort", abort, { once: true });
  });
}

/**
 * @param {{durationMs:number, invocationId?:string, agentRunId?:string|null, parentSignal?:AbortSignal|null}} options
 */
export function createAbsoluteExecutionContext({
  durationMs,
  invocationId = globalThis.crypto?.randomUUID?.() ?? `ai-${Date.now()}`,
  agentRunId = null,
  parentSignal = null,
}) {
  const controller = new AbortController();
  const safeDuration = Math.max(1_000, Number(durationMs) || 1_000);
  const absoluteDeadlineAt = Date.now() + safeDuration;
  const abortFromParent = () => controller.abort(parentSignal?.reason);
  if (parentSignal?.aborted) abortFromParent();
  else parentSignal?.addEventListener?.("abort", abortFromParent, { once: true });
  const timer = setTimeout(
    () => controller.abort(new DOMException("Absolute operation deadline", "TimeoutError")),
    safeDuration,
  );
  return {
    context: Object.freeze({ invocationId, agentRunId, absoluteDeadlineAt, signal: controller.signal }),
    cleanup() {
      clearTimeout(timer);
      parentSignal?.removeEventListener?.("abort", abortFromParent);
    },
  };
}
