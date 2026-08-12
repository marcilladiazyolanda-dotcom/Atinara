import assert from "node:assert/strict";
import test from "node:test";

import {
  assertDeadlineBudget,
  childTimeoutMs,
  createAbsoluteExecutionContext,
  createChildAbort,
  fetchWithinDeadline,
} from "../supabase/functions/_shared/ai/deadline.mjs";
import { createAiGateway } from "../supabase/functions/_shared/ai/gateway.mjs";
import { AI_ERROR_CODES } from "../supabase/functions/_shared/ai/errors.mjs";
import { AI_TASK_CONTRACTS } from "../supabase/functions/_shared/ai/task-policy.mjs";

test("cada timeout hijo conserva la reserva final del deadline absoluto", () => {
  const context = { absoluteDeadlineAt: 1_100, signal: new AbortController().signal };
  assert.equal(childTimeoutMs(context, 1_000, 200, 100), 800);
  assert.equal(childTimeoutMs(context, 250, 200, 100), 250);
  assert.throws(
    () => assertDeadlineBudget(context, 200, 900),
    (error) => error.code === AI_ERROR_CODES.DEADLINE_EXCEEDED,
  );
});

test("la señal padre aborta los hijos derivados del mismo contexto", () => {
  const parent = new AbortController();
  const execution = createAbsoluteExecutionContext({ durationMs: 5_000, parentSignal: parent.signal });
  const child = createChildAbort(execution.context, 2_000, 500);
  parent.abort(new Error("cancelled"));
  assert.equal(execution.context.signal.aborted, true);
  assert.equal(child.signal.aborted, true);
  child.cleanup();
  execution.cleanup();
});

test("un deadline agotado impide runtime, presupuesto e inferencia", async () => {
  const calls = { runtime: 0, budget: 0, fetch: 0 };
  const gateway = createAiGateway({
    runtimeReader: async () => { calls.runtime += 1; return null; },
    persistence: {
      reserveBudget: async () => { calls.budget += 1; return { status: "reserved", reserved: true }; },
      recordInvocation: async () => ({}),
    },
    secretReader: async () => "offline-secret",
    fetchImpl: async () => { calls.fetch += 1; throw new Error("must not fetch"); },
    externalAiDisabled: true,
    offlineTransport: true,
    logger: { error() {} },
  });
  const request = {
    taskType: "market_draft_validation",
    ...AI_TASK_CONTRACTS.market_draft_validation,
    input: { draft: { question: "¿Habrá anuncio?", yes_criteria: "Anuncio oficial." }, primarySourceAttested: true },
  };
  await assert.rejects(
    gateway.generateStructured(request, {
      invocationId: crypto.randomUUID(),
      absoluteDeadlineAt: Date.now() + 1,
      signal: new AbortController().signal,
    }),
    (error) => error.code === AI_ERROR_CODES.DEADLINE_EXCEEDED,
  );
  assert.deepEqual(calls, { runtime: 0, budget: 0, fetch: 0 });
});

test("fetch interno combina la señal hija con el aborto específico del caller", async () => {
  const parent = new AbortController();
  const local = new AbortController();
  const execution = {
    invocationId: "deadline-fetch-combined",
    absoluteDeadlineAt: Date.now() + 20_000,
    signal: parent.signal,
  };
  const pending = fetchWithinDeadline("https://example.invalid", {
    signal: local.signal,
  }, execution, {
    timeoutPolicyMs: 5_000,
    finalizationReserveMs: 1_000,
    fetchImpl: async (_input, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true });
    }),
  });
  local.abort(new DOMException("caller stopped", "AbortError"));
  await assert.rejects(pending, (error) => error?.name === "AbortError");
});
