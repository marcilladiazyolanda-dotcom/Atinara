import assert from "node:assert/strict";
import test from "node:test";

import { canonicalJson, newInvocationId } from "../supabase/functions/_shared/ai/contracts.mjs";
import { createAiGateway } from "../supabase/functions/_shared/ai/gateway.mjs";
import { AI_ERROR_CODES } from "../supabase/functions/_shared/ai/errors.mjs";
import { AI_TASK_CONTRACTS } from "../supabase/functions/_shared/ai/task-policy.mjs";

const VALID = Object.freeze({
  radar_candidate_enrichment: {
    input: { groups: [{ candidates: [{ question: "¿Se anunciará el juego antes del cierre?" }] }], existing: { prediction_policy_version: "v5" } },
    output: {
      candidates: [{
        candidate_index: 0,
        eligible: true,
        conclusive: true,
        reason_code: "VERIFICATION_REQUIRED",
        reason: "La evidencia incluida permite una revisión humana posterior.",
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
        atinara_resolution_criteria: "Se resuelve Sí solo con el anuncio oficial antes del cierre.",
      }],
    },
  },
  market_draft_validation: {
    input: { draft: { question: "¿Se anunciará el juego?", yes_criteria: "Anuncio oficial." }, primarySourceAttested: true },
    output: { result: "approved", issues: [], editorial_notes: [] },
  },
  market_expert_reasoning: {
    input: { origin: { provider: "tavily", title: "Anuncio público" }, deterministic: { integrity_status: "pass" } },
    output: {
      decision: "create",
      integrity_status: "pass",
      forecastability_status: "forecastable",
      confidence: 82,
      human_review_required: true,
      reason_codes: [],
      summary: "La propuesta es comprobable mediante una fuente pública.",
      suggested_changes: [],
      uncertainties: [],
      proposal_patch: {
        question: "", subject: "", category: "", yes_criteria: "",
        no_criteria: "", edge_cases: "", public_criteria: "", description: "",
      },
      policy_version: "atinara-market-constitution-v1",
      schema_version: "atinara-market-expert-v1",
    },
  },
  market_draft_repair: {
    input: { context: { question: "¿Se anunciará el juego?" }, deterministic: { issues: [] } },
    output: {
      patch: {
        description: "", assumptions: "", delay_treatment: "",
        cancellation_treatment: "", leak_treatment: "", rename_treatment: "",
      },
      explanations: [],
      unresolved_issues: [],
    },
  },
  market_resolution_analysis: {
    input: {
      market: { question: "¿Se anunció el juego?", closes_at: "2026-08-01T00:00:00Z" },
      researchText: "La fuente oficial publicó un anuncio antes del cierre.",
      sources: [{ title: "Fuente oficial", url: "https://example.com/anuncio", cited_text: "Anuncio publicado." }],
      searchQueries: ["anuncio oficial"],
    },
    output: {
      proposed_result: "Si",
      confidence: "Alta",
      summary: "La fuente incluida documenta el anuncio antes del cierre.",
      reasons: ["El anuncio está recogido en la evidencia incluida."],
      cutoff_analysis: "La publicación es anterior al cierre indicado.",
      caveats: [],
      recommended_note: "Revisar la fuente antes de la aprobación humana.",
      source_dates: [{ title: "Fuente oficial", published_at: "2026-07-31", relevance: "Acredita el anuncio." }],
    },
  },
});

function productRequest(taskType) {
  return { taskType, ...AI_TASK_CONTRACTS[taskType], input: structuredClone(VALID[taskType].input) };
}

function context(id = crypto.randomUUID()) {
  return { invocationId: id, absoluteDeadlineAt: Date.now() + 120_000, signal: new AbortController().signal };
}

function geminiEnvelope(value) {
  return {
    candidates: [{ content: { parts: [{ text: JSON.stringify(value) }] } }],
    usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
  };
}

function interactionsEnvelope(value) {
  return { outputs: [{ type: "text", text: JSON.stringify(value) }] };
}

function response(payload, status = 200, headers = {}) {
  return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json", ...headers } });
}

test("los contratos canónicos ordenan claves y generan IDs con Web Crypto", () => {
  assert.equal(
    canonicalJson({ z: 1, a: { y: 2, b: 3 } }),
    canonicalJson({ a: { b: 3, y: 2 }, z: 1 }),
  );
  assert.match(newInvocationId(), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
});

function dependencies({ mode = "legacy_direct", fetchImpl, reserveBudget, recordInvocation, runtime = {}, capabilityReader } = {}) {
  const calls = { budgets: [], telemetry: [], fetches: [] };
  const transport = fetchImpl ?? (async (url) => {
    calls.fetches.push(String(url));
    const task = Object.keys(VALID).find((taskType) => String(url).includes("interactions")
      ? taskType === "market_resolution_analysis"
      : false);
    const value = task ? VALID[task].output : VALID.market_draft_validation.output;
    return response(String(url).includes("interactions") ? interactionsEnvelope(value) : geminiEnvelope(value));
  });
  const persistence = {
    async readTaskRuntime() { return { transport_mode: mode, ...runtime }; },
    async reserveBudget(value) {
      calls.budgets.push(value);
      if (reserveBudget) return reserveBudget(value);
      return { status: "reserved", reserved: true, idempotent: false, requested_units: value.requestedUnits };
    },
    async recordInvocation(value) {
      calls.telemetry.push(value);
      if (recordInvocation) return recordInvocation(value);
      return { id: calls.telemetry.length, idempotent: false };
    },
  };
  const gateway = createAiGateway({
    persistence,
    fetchImpl: async (url, init) => {
      calls.fetches.push(String(url));
      return transport(url, init);
    },
    secretReader: async () => "test-secret-never-logged",
    capabilityReader,
    externalAiDisabled: true,
    offlineTransport: true,
    logger: { error() {} },
  });
  return { gateway, calls };
}

for (const taskType of Object.keys(VALID)) {
  test(`AI Gateway conserva el contrato Gemini de ${taskType}`, async () => {
    const { gateway, calls } = dependencies({
      fetchImpl: async (url) => response(
        String(url).includes("interactions")
          ? interactionsEnvelope(VALID[taskType].output)
          : geminiEnvelope(VALID[taskType].output),
      ),
    });
    const result = await gateway.generateStructured(productRequest(taskType), context());
    assert.deepEqual(result.value, VALID[taskType].output);
    assert.equal(result.metadata.transportMode, "legacy_direct");
    assert.match(result.metadata.inputFingerprint, /^[0-9a-f]{64}$/);
    assert.match(result.metadata.outputFingerprint, /^[0-9a-f]{64}$/);
    assert.equal(result.telemetryStatus, "persisted");
    assert.equal(calls.budgets[0].budgetMode, "baseline_existing");
    assert.equal(calls.telemetry.length, 1);
  });
}

test("el caller productivo no puede inyectar ruta, modelo, schema ni fingerprint", async () => {
  const { gateway } = dependencies();
  for (const forbidden of ["routeHint", "routeId", "model", "schema", "inputFingerprint", "timeoutMs"]) {
    await assert.rejects(
      gateway.generateStructured({ ...productRequest("market_draft_validation"), [forbidden]: "caller-value" }, context()),
      (error) => error.code === AI_ERROR_CODES.INVALID_REQUEST,
    );
  }
});

test("el sanitizer rechaza identidad, secretos, Karma, Prestigio y predicciones privadas", async () => {
  const prohibited = ["user_id", "api_key", "karma", "prestigio", "active_predictions"];
  for (const key of prohibited) {
    const { gateway } = dependencies();
    const request = productRequest("market_expert_reasoning");
    request.input.origin[key] = key === "api_key" ? "FAKE_AI_KEY_DO_NOT_USE" : "prohibido";
    await assert.rejects(
      gateway.generateStructured(request, context()),
      (error) => error.code === AI_ERROR_CODES.DATA_CLASS_PROHIBITED,
    );
  }
});

test("el sanitizer aplica una allowlist recursiva y rechaza claves anidadas desconocidas", async () => {
  const { gateway } = dependencies();
  const request = productRequest("market_expert_reasoning");
  request.input.origin.future_unregistered_field = "no permitido";
  await assert.rejects(
    gateway.generateStructured(request, context()),
    (error) => error.code === AI_ERROR_CODES.INPUT_FIELD_NOT_ALLOWED,
  );
});

test("la huella se calcula después de sanear y es canónica", async () => {
  const first = dependencies({ fetchImpl: async () => response(geminiEnvelope(VALID.market_draft_validation.output)) });
  const second = dependencies({ fetchImpl: async () => response(geminiEnvelope(VALID.market_draft_validation.output)) });
  const left = productRequest("market_draft_validation");
  const right = { ...left, input: { primarySourceAttested: true, draft: { yes_criteria: "Anuncio oficial.", question: "¿Se anunciará el juego?" } } };
  const [a, b] = await Promise.all([
    first.gateway.generateStructured(left, context()),
    second.gateway.generateStructured(right, context()),
  ]);
  assert.equal(a.metadata.inputFingerprint, b.metadata.inputFingerprint);
});

test("la ausencia del secreto produce AI_PROVIDER_NOT_CONFIGURED sin red", async () => {
  const { gateway, calls } = dependencies();
  const noSecret = createAiGateway({
    persistence: {
      readTaskRuntime: async () => null,
      reserveBudget: async () => { throw new Error("must not reserve"); },
      recordInvocation: async () => ({}),
    },
    fetchImpl: async () => { throw new Error("must not fetch"); },
    secretReader: async () => "",
    externalAiDisabled: true,
    offlineTransport: true,
    logger: { error() {} },
  });
  await assert.rejects(
    noSecret.generateStructured(productRequest("market_draft_validation"), context()),
    (error) => error.code === AI_ERROR_CODES.PROVIDER_NOT_CONFIGURED,
  );
  assert.equal(calls.fetches.length, 0);
  void gateway;
});

test("legacy_direct preserva el servicio si falla la reserva baseline", async () => {
  const { gateway } = dependencies({
    fetchImpl: async () => response(geminiEnvelope(VALID.market_draft_validation.output)),
    reserveBudget: async () => { throw new Error("offline persistence"); },
  });
  const result = await gateway.generateStructured(productRequest("market_draft_validation"), context());
  assert.deepEqual(result.value, VALID.market_draft_validation.output);
  assert.ok(result.warnings.includes(AI_ERROR_CODES.BUDGET_RESERVATION_FAILED));
});

test("gateway_gemini_parity falla cerrado si el presupuesto está agotado", async () => {
  const { gateway, calls } = dependencies({
    mode: "gateway_gemini_parity",
    reserveBudget: async () => ({ status: "exhausted", reserved: false, requested_units: 1, used_units: 0, limit_units: 0 }),
  });
  await assert.rejects(
    gateway.generateStructured(productRequest("market_draft_validation"), context()),
    (error) => error.code === AI_ERROR_CODES.BUDGET_EXHAUSTED,
  );
  assert.equal(calls.fetches.length, 0);
  assert.equal(calls.budgets[0].budgetMode, "metered");
});

test("un fallo de telemetría no altera una respuesta válida ni repite inferencia", async () => {
  let fetchCount = 0;
  const { gateway } = dependencies({
    fetchImpl: async () => {
      fetchCount += 1;
      return response(geminiEnvelope(VALID.market_draft_validation.output));
    },
    recordInvocation: async () => { throw new Error("telemetry unavailable"); },
  });
  const result = await gateway.generateStructured(productRequest("market_draft_validation"), context());
  assert.deepEqual(result.value, VALID.market_draft_validation.output);
  assert.equal(result.telemetryStatus, "failed");
  assert.equal(result.metadata.metricsEligible, false);
  assert.ok(result.warnings.includes(AI_ERROR_CODES.TELEMETRY_WRITE_FAILED));
  assert.equal(fetchCount, 1);
});

test("Validator conserva el fallback de schema ante INVALID_ARGUMENT", async () => {
  let count = 0;
  const { gateway } = dependencies({
    fetchImpl: async () => {
      count += 1;
      return count === 1
        ? response({ error: { status: "INVALID_ARGUMENT" } }, 400)
        : response(geminiEnvelope(VALID.market_draft_validation.output));
    },
  });
  const result = await gateway.generateStructured(productRequest("market_draft_validation"), context());
  assert.equal(result.value.result, "approved");
  assert.equal(count, 2);
});

test("los errores del proveedor no transportan su payload entre capas", async () => {
  const marker = "RAW_PROVIDER_PAYLOAD_MUST_NOT_ESCAPE";
  const { gateway } = dependencies({
    fetchImpl: async () => response({ error: { status: "UNAUTHENTICATED", message: marker } }, 401),
  });
  await assert.rejects(
    gateway.generateStructured(productRequest("market_draft_validation"), context()),
    (error) => {
      assert.equal(error.code, AI_ERROR_CODES.PROVIDER_AUTH_ERROR);
      assert.doesNotMatch(JSON.stringify(error), new RegExp(marker));
      assert.equal(Object.hasOwn(error, "providerRaw"), false);
      assert.equal(Object.hasOwn(error, "response"), false);
      return true;
    },
  );
});

test("Resolución conserva Interactions y fallback técnico a generateContent", async () => {
  const urls = [];
  const { gateway } = dependencies({
    fetchImpl: async (url) => {
      urls.push(String(url));
      if (urls.length === 1) return response({ error: { status: "NOT_FOUND" } }, 404);
      return response(geminiEnvelope(VALID.market_resolution_analysis.output));
    },
  });
  const result = await gateway.generateStructured(productRequest("market_resolution_analysis"), context());
  assert.equal(result.value.proposed_result, "Si");
  assert.match(urls[0], /\/v1beta\/interactions$/);
  assert.match(urls[1], /gemini-3-flash-preview:generateContent$/);
});

test("structured output rechaza claves extra y aceptación parcial", async () => {
  const invalid = { ...VALID.market_draft_validation.output, unexpected: true };
  const { gateway } = dependencies({ fetchImpl: async () => response(geminiEnvelope(invalid)) });
  await assert.rejects(
    gateway.generateStructured(productRequest("market_draft_validation"), context()),
    (error) => error.code === AI_ERROR_CODES.OUTPUT_CONTRACT_INVALID,
  );
});

test("gateway_routing no busca otra respuesta por rechazo o incoherencia de dominio", async () => {
  for (const output of [
    { result: "rejected", issues: [{ code: "AMBIGUOUS_CRITERIA", field: "yes_criteria", message: "El criterio no identifica un hecho público inequívoco." }], editorial_notes: [] },
    { result: "approved", issues: [{ code: "AMBIGUOUS_CRITERIA", field: "yes_criteria", message: "El criterio no identifica un hecho público inequívoco." }], editorial_notes: [] },
  ]) {
    let fetchCount = 0;
    const { gateway } = dependencies({
      mode: "gateway_routing",
      runtime: {
        primary_route_id: "gemini.gateway.validator",
        fallback_route_id: "gemini.legacy.validator",
      },
      fetchImpl: async () => {
        fetchCount += 1;
        return response(geminiEnvelope(output));
      },
    });
    if (output.result === "rejected") {
      const result = await gateway.generateStructured(productRequest("market_draft_validation"), context());
      assert.equal(result.value.result, "rejected");
    } else {
      await assert.rejects(
        gateway.generateStructured(productRequest("market_draft_validation"), context()),
        (error) => error.code === AI_ERROR_CODES.OUTPUT_DOMAIN_INVALID,
      );
    }
    assert.equal(fetchCount, 1);
  }
});

test("gateway_routing usa fallback solo después de una respuesta técnicamente inválida", async () => {
  let fetchCount = 0;
  const { gateway } = dependencies({
    mode: "gateway_routing",
    runtime: {
      primary_route_id: "gemini.gateway.validator",
      fallback_route_id: "gemini.legacy.validator",
    },
    fetchImpl: async () => {
      fetchCount += 1;
      if (fetchCount <= 2) return response(geminiEnvelope({ result: "approved" }));
      return response(geminiEnvelope(VALID.market_draft_validation.output));
    },
  });
  const result = await gateway.generateStructured(productRequest("market_draft_validation"), context());
  assert.equal(result.value.result, "approved");
  assert.equal(fetchCount, 3);
});
