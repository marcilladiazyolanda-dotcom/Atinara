import assert from "node:assert/strict";
import test from "node:test";

import { discoverRouteCapability } from "../supabase/functions/_shared/ai/capability-discovery.mjs";
import { AI_ERROR_CODES } from "../supabase/functions/_shared/ai/errors.mjs";
import { createAiGateway } from "../supabase/functions/_shared/ai/gateway.mjs";
import { AI_TASK_CONTRACTS } from "../supabase/functions/_shared/ai/task-policy.mjs";

const RADAR_INPUT = {
  groups: [{ candidates: [{ question: "¿Se anunciará el juego antes del cierre?" }] }],
  existing: { prediction_policy_version: "v5" },
};

const RADAR_OUTPUT = {
  candidates: [{
    candidate_index: 0,
    eligible: true,
    conclusive: true,
    reason_code: "VERIFICATION_REQUIRED",
    reason: "La evidencia permite mantener la candidata para revisión humana.",
    confidence: 80,
    ttl_minutes: 60,
    facts: {
      event_resolved_at: null,
      official_reveal_at: null,
      release_at: null,
      subject_announced: true,
      temporal_coherence: true,
    },
    atinara_question: "¿Se anunciará el juego antes del cierre?",
    atinara_category: "Lanzamientos",
    atinara_resolution_criteria: "Solo un anuncio oficial anterior al cierre permite resolver Sí.",
  }],
};

function context() {
  return {
    invocationId: crypto.randomUUID(),
    absoluteDeadlineAt: Date.now() + 60_000,
    signal: new AbortController().signal,
  };
}

function request() {
  return {
    taskType: "radar_candidate_enrichment",
    ...AI_TASK_CONTRACTS.radar_candidate_enrichment,
    input: structuredClone(RADAR_INPUT),
  };
}

function capability(exactModelId, endpointUrl) {
  return {
    available: true,
    exactModelId,
    endpointUrl,
    structuredOutput: true,
    dataClasses: ["public_market"],
    discoveredAt: new Date().toISOString(),
  };
}

function gatewayFor({ routeId, providerFlag, secret = "offline-secret", capabilityValue, reserveBudget, fetchImpl }) {
  const calls = { budget: 0, fetch: 0, telemetry: 0 };
  const persistence = {
    readTaskRuntime: async () => ({
      task_type: "radar_candidate_enrichment",
      transport_mode: "gateway_routing",
      primary_route_id: routeId,
      fallback_route_id: null,
      openrouter_enabled: routeId.startsWith("openrouter") && providerFlag,
      nvidia_nim_enabled: routeId.startsWith("nvidia_nim") && providerFlag,
    }),
    reserveBudget: async (value) => {
      calls.budget += 1;
      return reserveBudget
        ? reserveBudget(value)
        : { status: "reserved", reserved: true, requested_units: value.requestedUnits, used_units: 1, limit_units: 1 };
    },
    recordInvocation: async () => {
      calls.telemetry += 1;
      return { id: calls.telemetry };
    },
  };
  const gateway = createAiGateway({
    persistence,
    secretReader: async () => secret,
    capabilityReader: async () => capabilityValue,
    fetchImpl: async (...args) => {
      calls.fetch += 1;
      return fetchImpl(...args);
    },
    externalAiDisabled: true,
    offlineTransport: true,
    logger: { error() {} },
  });
  return { gateway, calls };
}

test("OpenRouter y NVIDIA permanecen desactivados por flags independientes", async () => {
  for (const routeId of ["openrouter.nemotron_3_5_lightning_free", "nvidia_nim.nemotron_3_5_lightning"]) {
    const { gateway, calls } = gatewayFor({
      routeId,
      providerFlag: false,
      capabilityValue: {},
      fetchImpl: async () => { throw new Error("must not fetch"); },
    });
    await assert.rejects(gateway.generateStructured(request(), context()), (error) => error.code === AI_ERROR_CODES.ROUTE_NOT_AVAILABLE);
    assert.equal(calls.fetch, 0);
    assert.equal(calls.budget, 0);
  }
});

test("secreto ausente produce AI_PROVIDER_NOT_CONFIGURED y no consulta red", async () => {
  const { gateway, calls } = gatewayFor({
    routeId: "openrouter.nemotron_3_5_lightning_free",
    providerFlag: true,
    secret: "",
    capabilityValue: capability("nvidia/nemotron-3.5-lightning:free", "https://openrouter.ai/api/v1/chat/completions"),
    fetchImpl: async () => { throw new Error("must not fetch"); },
  });
  await assert.rejects(gateway.generateStructured(request(), context()), (error) => error.code === AI_ERROR_CODES.PROVIDER_NOT_CONFIGURED);
  assert.equal(calls.fetch, 0);
  assert.equal(calls.budget, 0);
});

test("modelo exacto ausente o discovery caducado produce AI_MODEL_NOT_AVAILABLE", async () => {
  for (const capabilityValue of [
    { ...capability("nvidia/nemotron-3.5-nano:free", "https://openrouter.ai/api/v1/chat/completions") },
    { ...capability("nvidia/nemotron-3.5-lightning:free", "https://openrouter.ai/api/v1/chat/completions"), discoveredAt: "2026-01-01T00:00:00.000Z" },
  ]) {
    const { gateway, calls } = gatewayFor({
      routeId: "openrouter.nemotron_3_5_lightning_free",
      providerFlag: true,
      capabilityValue,
      fetchImpl: async () => { throw new Error("must not fetch"); },
    });
    await assert.rejects(gateway.generateStructured(request(), context()), (error) => error.code === AI_ERROR_CODES.MODEL_NOT_AVAILABLE);
    assert.equal(calls.fetch, 0);
    assert.equal(calls.budget, 0);
  }
});

test("presupuesto cero falla antes de inferencia externa", async () => {
  const { gateway, calls } = gatewayFor({
    routeId: "openrouter.nemotron_3_5_lightning_free",
    providerFlag: true,
    capabilityValue: capability("nvidia/nemotron-3.5-lightning:free", "https://openrouter.ai/api/v1/chat/completions"),
    reserveBudget: async () => ({ status: "exhausted", reserved: false, requested_units: 1, used_units: 0, limit_units: 0 }),
    fetchImpl: async () => { throw new Error("must not fetch"); },
  });
  await assert.rejects(gateway.generateStructured(request(), context()), (error) => error.code === AI_ERROR_CODES.BUDGET_EXHAUSTED);
  assert.equal(calls.fetch, 0);
  assert.equal(calls.budget, 1);
});

test("OpenRouter usa solo Lightning exacto, structured output y allow_fallbacks false", async () => {
  let sentBody;
  const { gateway, calls } = gatewayFor({
    routeId: "openrouter.nemotron_3_5_lightning_free",
    providerFlag: true,
    capabilityValue: capability("nvidia/nemotron-3.5-lightning:free", "https://openrouter.ai/api/v1/chat/completions"),
    fetchImpl: async (url, init) => {
      assert.equal(String(url), "https://openrouter.ai/api/v1/chat/completions");
      sentBody = JSON.parse(init.body);
      return new Response(JSON.stringify({
        id: "offline-openrouter",
        choices: [{ message: { content: JSON.stringify(RADAR_OUTPUT) } }],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });
  const result = await gateway.generateStructured(request(), context());
  assert.deepEqual(result.value, RADAR_OUTPUT);
  assert.equal(sentBody.model, "nvidia/nemotron-3.5-lightning:free");
  assert.equal(sentBody.provider.allow_fallbacks, false);
  assert.equal(sentBody.response_format.type, "json_schema");
  assert.equal(calls.fetch, 1);
  assert.equal(calls.telemetry, 1);
});

test("el adaptador compatible reintenta 429 según política sin cambiar modelo", async () => {
  let attempts = 0;
  const { gateway, calls } = gatewayFor({
    routeId: "openrouter.nemotron_3_5_lightning_free",
    providerFlag: true,
    capabilityValue: capability("nvidia/nemotron-3.5-lightning:free", "https://openrouter.ai/api/v1/chat/completions"),
    fetchImpl: async (_url, init) => {
      attempts += 1;
      assert.equal(JSON.parse(init.body).model, "nvidia/nemotron-3.5-lightning:free");
      if (attempts === 1) return new Response("{}", { status: 429, headers: { "retry-after": "0" } });
      return new Response(JSON.stringify({
        id: "offline-openrouter-retry",
        choices: [{ message: { content: JSON.stringify(RADAR_OUTPUT) } }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });
  const result = await gateway.generateStructured(request(), context());
  assert.deepEqual(result.value, RADAR_OUTPUT);
  assert.equal(calls.fetch, 2);
  assert.equal(calls.budget, 1);
});

test("capability discovery con transport mock no sustituye Lightning", async () => {
  const fetchCatalog = (rows) => discoverRouteCapability({
    routeId: "nvidia_nim.nemotron_3_5_lightning",
    apiKey: "offline-secret",
    context: context(),
    liveAuthorized: true,
    fetchImpl: async (url) => {
      assert.equal(String(url), "https://integrate.api.nvidia.com/v1/models");
      return new Response(JSON.stringify({ models: rows }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });
  const unavailable = await fetchCatalog([{ id: "nvidia/nemotron-3.5-nano", capabilities: ["json_schema"] }]);
  assert.equal(unavailable.available, false);
  assert.equal(unavailable.reason, AI_ERROR_CODES.MODEL_NOT_AVAILABLE);
  const available = await fetchCatalog([{ id: "nvidia/nemotron-3.5-lightning", capabilities: ["json_schema"] }]);
  assert.equal(available.available, true);
  assert.equal(available.exactModelId, "nvidia/nemotron-3.5-lightning");
  assert.equal(available.endpointUrl, "https://integrate.api.nvidia.com/v1/chat/completions");
});
