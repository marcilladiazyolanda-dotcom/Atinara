import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  ATINARA_CANONICAL_JSON_VERSION,
  canonicalJson,
  newInvocationId,
  sha256Hex,
} from "../supabase/functions/_shared/ai/contracts.mjs";
import { createAiGateway } from "../supabase/functions/_shared/ai/gateway.mjs";
import { AI_ERROR_CODES } from "../supabase/functions/_shared/ai/errors.mjs";
import { AI_EXECUTION_PROFILE_SINGLE_INFERENCE_SMOKE_V1 } from "../supabase/functions/_shared/ai/execution-profile.mjs";
import { AI_TASK_CONTRACTS } from "../supabase/functions/_shared/ai/task-policy.mjs";
import { classifyMarketRelations } from "../supabase/functions/_shared/market-radar.mjs";

const canonicalJsonFixture = JSON.parse(readFileSync(
  new URL("./fixtures/atinara-canonical-json-v1.json", import.meta.url),
  "utf8",
));

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

function assertCanonicalError(thunk, code, httpStatus) {
  assert.throws(thunk, (error) => {
    assert.equal(error.code, code);
    assert.equal(error.httpStatus, httpStatus);
    return true;
  });
}

function nestedCanonicalValue(depth) {
  let value = "leaf";
  for (let index = 0; index < depth; index += 1) value = { value };
  return value;
}

test("Canonical JSON v1 fija version, orden UTF-16 y golden literal independiente", async () => {
  assert.equal(ATINARA_CANONICAL_JSON_VERSION, canonicalJsonFixture.version);
  const integerUnicode = canonicalJsonFixture.goldenCases.find(({ id }) => id === "integer-unicode-key-order");
  assert.equal(
    integerUnicode.expectedCanonicalJson,
    "{\"0\":\"zero\",\"1\":\"one\",\"10\":\"ten\",\"2\":\"two\",\"4294967294\":\"max-index\",\"4294967295\":\"not-index\",\"__proto__\":\"data\",\"a\":\"prefix\",\"aa\":\"longer\",\"á\":\"decomposed\",\"constructor\":\"ctor\",\"prototype\":\"proto\",\"á\":\"composed\",\"😀\":\"emoji\"}",
  );
  assert.equal(integerUnicode.expectedSha256, "14141cffbafc63c88d3468cf5e5fcfc139597f0ac4b2f7b28a8951c0e35ede8e");
  assert.equal(canonicalJson(integerUnicode.input), integerUnicode.expectedCanonicalJson);
  assert.equal(await sha256Hex(integerUnicode.expectedCanonicalJson), integerUnicode.expectedSha256);

  const insertionCases = canonicalJsonFixture.goldenCases.filter(({ id }) => id.startsWith("insertion-order-"));
  assert.equal(canonicalJson(insertionCases[0].input), canonicalJson(insertionCases[1].input));
  assert.notEqual(
    canonicalJson(canonicalJsonFixture.goldenCases.find(({ id }) => id === "composed-unicode").input),
    canonicalJson(canonicalJsonFixture.goldenCases.find(({ id }) => id === "decomposed-unicode").input),
  );
});

test("Canonical JSON v1 conserva claves de datos ordinarias sin ejecutar toJSON", () => {
  const ordinaryKeys = JSON.parse('{"toJSON":"valor","prototype":"p","constructor":"c","__proto__":"dato"}');
  assert.equal(
    canonicalJson(ordinaryKeys),
    '{"__proto__":"dato","constructor":"c","prototype":"p","toJSON":"valor"}',
  );
  assert.equal(Object.getPrototypeOf(ordinaryKeys), Object.prototype);

  const nullPrototype = Object.create(null);
  Object.defineProperty(nullPrototype, "b", { value: 2, enumerable: true });
  Object.defineProperty(nullPrototype, "a", { value: 1, enumerable: true });
  assert.equal(canonicalJson(nullPrototype), '{"a":1,"b":2}');

  let toJsonCalls = 0;
  const functionToJson = { value: 1 };
  Object.defineProperty(functionToJson, "toJSON", {
    enumerable: true,
    value() { toJsonCalls += 1; },
  });
  assertCanonicalError(() => canonicalJson(functionToJson), AI_ERROR_CODES.INVALID_REQUEST, 400);
  assert.equal(toJsonCalls, 0);
});

test("Canonical JSON v1 valida arrays densos y propiedades propias", () => {
  assert.equal(canonicalJson([3, 2, 1]), "[3,2,1]");

  const sparse = new Array(2);
  sparse[1] = "present";
  assertCanonicalError(() => canonicalJson(sparse), AI_ERROR_CODES.INVALID_REQUEST, 400);

  const accessor = ["value"];
  let getterCalls = 0;
  Object.defineProperty(accessor, "0", {
    enumerable: true,
    get() { getterCalls += 1; return "forbidden"; },
  });
  assertCanonicalError(() => canonicalJson(accessor), AI_ERROR_CODES.INVALID_REQUEST, 400);
  assert.equal(getterCalls, 0);

  const nonEnumerable = ["value"];
  Object.defineProperty(nonEnumerable, "0", { value: "value", enumerable: false });
  assertCanonicalError(() => canonicalJson(nonEnumerable), AI_ERROR_CODES.INVALID_REQUEST, 400);

  const extraKey = ["value"];
  extraKey.extra = true;
  assertCanonicalError(() => canonicalJson(extraKey), AI_ERROR_CODES.INVALID_REQUEST, 400);
  const nonIndexKey = ["value"];
  nonIndexKey["01"] = true;
  assertCanonicalError(() => canonicalJson(nonIndexKey), AI_ERROR_CODES.INVALID_REQUEST, 400);
  const symbolArray = ["value"];
  symbolArray[Symbol("extra")] = true;
  assertCanonicalError(() => canonicalJson(symbolArray), AI_ERROR_CODES.INVALID_REQUEST, 400);

  const customPrototype = ["value"];
  Object.setPrototypeOf(customPrototype, Object.create(Array.prototype));
  assertCanonicalError(() => canonicalJson(customPrototype), AI_ERROR_CODES.INVALID_REQUEST, 400);
});

test("Canonical JSON v1 rechaza valores ambiguos sin invocar accessors", () => {
  const invalidRoots = [undefined, () => {}, Symbol("value"), 1n, new Date(), new Map(), new Set(), new (class Value {})()];
  for (const value of invalidRoots) {
    assertCanonicalError(() => canonicalJson(value), AI_ERROR_CODES.INVALID_REQUEST, 400);
  }
  for (const value of [undefined, () => {}, Symbol("value"), 1n]) {
    assertCanonicalError(() => canonicalJson({ value }), AI_ERROR_CODES.INVALID_REQUEST, 400);
    assertCanonicalError(() => canonicalJson([value]), AI_ERROR_CODES.INVALID_REQUEST, 400);
  }

  let getterCalls = 0;
  const accessor = {};
  Object.defineProperty(accessor, "value", {
    enumerable: true,
    get() { getterCalls += 1; return "forbidden"; },
  });
  assertCanonicalError(() => canonicalJson(accessor), AI_ERROR_CODES.INVALID_REQUEST, 400);
  assert.equal(getterCalls, 0);

  const nonEnumerable = {};
  Object.defineProperty(nonEnumerable, "value", { value: 1, enumerable: false });
  assertCanonicalError(() => canonicalJson(nonEnumerable), AI_ERROR_CODES.INVALID_REQUEST, 400);

  const symbolProperty = { value: 1 };
  symbolProperty[Symbol("extra")] = true;
  assertCanonicalError(() => canonicalJson(symbolProperty), AI_ERROR_CODES.INVALID_REQUEST, 400);

  const shared = { value: 1 };
  assert.equal(canonicalJson({ first: shared, second: shared }), '{"first":{"value":1},"second":{"value":1}}');
  const cycle = {};
  cycle.self = cycle;
  assertCanonicalError(() => canonicalJson(cycle), AI_ERROR_CODES.INVALID_REQUEST, 400);
  const arrayCycle = [];
  arrayCycle.push(arrayCycle);
  assertCanonicalError(() => canonicalJson(arrayCycle), AI_ERROR_CODES.INVALID_REQUEST, 400);
});

test("Canonical JSON v1 conserva profundidad y errores numericos existentes", () => {
  assert.doesNotThrow(() => canonicalJson(nestedCanonicalValue(19)));
  assert.doesNotThrow(() => canonicalJson(nestedCanonicalValue(20)));
  assertCanonicalError(
    () => canonicalJson(nestedCanonicalValue(21)),
    AI_ERROR_CODES.INPUT_TOO_LARGE,
    413,
  );
  assert.equal(canonicalJson([-0, 1e21, 1e-7, Number.MAX_SAFE_INTEGER]), "[0,1e+21,1e-7,9007199254740991]");
  for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    assertCanonicalError(() => canonicalJson(value), AI_ERROR_CODES.INVALID_REQUEST, 400);
  }
});

test("Canonical JSON v1 rechaza lone surrogates sin cambiar sha256Hex(string)", async () => {
  for (const invalidString of ["\ud800", "\udfff"]) {
    assertCanonicalError(() => canonicalJson(invalidString), AI_ERROR_CODES.INVALID_REQUEST, 400);
    const invalidKey = {};
    Object.defineProperty(invalidKey, invalidString, { value: true, enumerable: true });
    assertCanonicalError(() => canonicalJson(invalidKey), AI_ERROR_CODES.INVALID_REQUEST, 400);
  }
  assert.equal(
    await sha256Hex("\ud800"),
    "83d544ccc223c057d2bf80d3f2a32982c32c3c0db8e2674820da5064783fb097",
  );
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
  for (const forbidden of ["routeHint", "routeId", "model", "schema", "inputFingerprint", "timeoutMs", "executionProfile"]) {
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

function sanitizedDuplicateMatch(patch = {}) {
  const candidate = {
    provider: "kalshi",
    source_title: "Grand Theft Auto VI release date",
    source_question: "Will Grand Theft Auto VI be released before September 1, 2026?",
    atinara_question: "Will Grand Theft Auto VI be released before September 1, 2026?",
  };
  const produced = classifyMarketRelations(candidate, [{
    id: "published-market-id",
    question: "¿Grand Theft Auto VI será lanzado el 31 de agosto de 2026 o antes?",
  }]).duplicates[0];
  assert.equal(produced.id, "published-market-id");
  assert.equal(produced.relationship, "exact_duplicate");
  assert.equal(produced.blocking, true);
  const { id: _internalId, ...sanitized } = produced;
  return { ...sanitized, ...patch };
}

test("market_expert_reasoning admite duplicate_matches vacío y con datos de mercado saneados", async () => {
  const fingerprints = [];
  for (const duplicateMatches of [[], [sanitizedDuplicateMatch()]]) {
    const { gateway, calls } = dependencies({
      fetchImpl: async () => response(geminiEnvelope(VALID.market_expert_reasoning.output)),
    });
    const request = productRequest("market_expert_reasoning");
    request.input.origin.duplicate_matches = duplicateMatches;
    const result = await gateway.generateStructured(request, context());

    assert.deepEqual(result.value, VALID.market_expert_reasoning.output);
    assert.equal(result.metadata.transportMode, "legacy_direct");
    assert.match(result.metadata.inputFingerprint, /^[0-9a-f]{64}$/);
    assert.equal(calls.fetches.length, 1);
    fingerprints.push(result.metadata.inputFingerprint);
  }
  assert.notEqual(fingerprints[0], fingerprints[1]);
});

test("la proyección productiva de Market Expert permanece alineada con la allowlist del Gateway", async () => {
  const source = readFileSync(new URL("../supabase/functions/market-expert/index.ts", import.meta.url), "utf8");
  const producerBlock = source.match(/function safeOrigin\(origin: JsonRecord\)[\s\S]*?const allowed = \[([\s\S]*?)\];/)?.[1];
  const projectionBlock = source.match(/function modelSafeOrigin\(origin: JsonRecord\)([\s\S]*?)function modelSafeDeterministic/)?.[1];
  assert.ok(producerBlock);
  assert.ok(projectionBlock);
  assert.match(source, /return safeOrigin\(raw as JsonRecord\);/);
  assert.match(source, /input: \{ origin: modelSafeOrigin\(origin\), deterministic: modelSafeDeterministic\(deterministic\) \}/);
  assert.match(projectionBlock, /key !== "id" && !key\.endsWith\("_id"\) && !excluded\.has\(key\)/);

  const producerKeys = [...producerBlock.matchAll(/"([^"]+)"/g)].map((match) => match[1]);
  const excludedBlock = projectionBlock.match(/const excluded = new Set\(\[([\s\S]*?)\]\);/)?.[1];
  assert.ok(excludedBlock);
  const excludedKeys = new Set([...excludedBlock.matchAll(/"([^"]+)"/g)].map((match) => match[1]));
  const projectedKeys = [
    ...producerKeys.filter((key) => key !== "id" && !key.endsWith("_id") && !excludedKeys.has(key)),
    "official_source_content_sha256",
  ];
  assert.ok(projectedKeys.includes("duplicate_matches"));
  assert.ok(projectedKeys.includes("official_source_content_sha256"));

  const { gateway, calls } = dependencies({
    fetchImpl: async () => response(geminiEnvelope(VALID.market_expert_reasoning.output)),
  });
  const projectedBatches = [projectedKeys.slice(0, 80), projectedKeys.slice(80)];
  for (const batch of projectedBatches) {
    const request = productRequest("market_expert_reasoning");
    request.input.origin = Object.fromEntries(batch.map((key) => [key, null]));
    if (Object.hasOwn(request.input.origin, "duplicate_matches")) request.input.origin.duplicate_matches = [];
    const result = await gateway.generateStructured(request, context());
    assert.deepEqual(result.value, VALID.market_expert_reasoning.output);
  }
  assert.equal(calls.fetches.length, projectedBatches.length);
});

test("Market Expert incorpora solo el digest oficial saneado a la huella", async () => {
  const fingerprints = [];
  for (const digest of ["a".repeat(64), "b".repeat(64)]) {
    const { gateway } = dependencies({
      fetchImpl: async () => response(geminiEnvelope(VALID.market_expert_reasoning.output)),
    });
    const request = productRequest("market_expert_reasoning");
    request.input.origin = { provider: "official_web", official_source_content_sha256: digest };
    const result = await gateway.generateStructured(request, context());
    fingerprints.push(result.metadata.inputFingerprint);
  }
  assert.notEqual(fingerprints[0], fingerprints[1]);

  const source = readFileSync(new URL("../supabase/functions/market-expert/index.ts", import.meta.url), "utf8");
  assert.match(source, /origin\.provider === "official_web" && \/\^\[0-9a-f\]\{64\}\$\//);
  assert.match(source, /output\.official_source_content_sha256 = officialContentSha256/);
  assert.match(source, /delete snapshot\.expert_analysis_status/);
  assert.match(source, /origin\.expert_analysis_status === "completed"/);
});

test("duplicate_matches conserva su contrato de array", async () => {
  for (const invalidValue of [null, "not-an-array", { relationship: "exact_duplicate" }, 1]) {
    const { gateway, calls } = dependencies({
      fetchImpl: async () => response(geminiEnvelope(VALID.market_expert_reasoning.output)),
    });
    const request = productRequest("market_expert_reasoning");
    request.input.origin.duplicate_matches = invalidValue;
    await assert.rejects(
      gateway.generateStructured(request, context()),
      (error) => {
        assert.equal(error.code, AI_ERROR_CODES.INPUT_FIELD_NOT_ALLOWED);
        assert.equal(error.httpStatus, 400);
        assert.equal(error.details?.phase, "input.origin.duplicate_matches");
        return true;
      },
    );
    assert.equal(calls.fetches.length, 0);
    assert.equal(calls.budgets.length, 0);
  }
});

test("duplicate_matches no amplía identificadores, PII, secretos ni campos desconocidos", async () => {
  const rejected = [
    { patch: { id: "internal-market-id" }, code: AI_ERROR_CODES.INPUT_FIELD_NOT_ALLOWED, field: "id" },
    { patch: { external_id: "provider-market-id" }, code: AI_ERROR_CODES.INPUT_FIELD_NOT_ALLOWED, field: "external_id" },
    { patch: { user_id: "internal-user-id" }, code: AI_ERROR_CODES.DATA_CLASS_PROHIBITED, field: "user_id" },
    { patch: { question: "Contacto editorial: persona@example.invalid" }, code: AI_ERROR_CODES.DATA_CLASS_PROHIBITED, field: "question" },
    { patch: { summary: "Bearer abcdefghijklmnopqrstuvwxyz" }, code: AI_ERROR_CODES.DATA_CLASS_PROHIBITED, field: "summary" },
    { patch: { internal_note: "no permitido" }, code: AI_ERROR_CODES.INPUT_FIELD_NOT_ALLOWED, field: "internal_note" },
  ];

  for (const { patch, code, field } of rejected) {
    const { gateway, calls } = dependencies({
      fetchImpl: async () => response(geminiEnvelope(VALID.market_expert_reasoning.output)),
    });
    const request = productRequest("market_expert_reasoning");
    request.input.origin.duplicate_matches = [sanitizedDuplicateMatch(patch)];

    await assert.rejects(
      gateway.generateStructured(request, context()),
      (error) => {
        assert.equal(error.code, code);
        assert.equal(error.httpStatus, 400);
        assert.equal(error.details?.phase, `input.origin.duplicate_matches[0].${field}`);
        return true;
      },
    );
    assert.equal(calls.fetches.length, 0);
    assert.equal(calls.budgets.length, 0);
  }
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

test("el perfil administrativo del Validator limita el transporte a una petición", async () => {
  let count = 0;
  const { gateway } = dependencies({
    fetchImpl: async () => {
      count += 1;
      return response(geminiEnvelope(VALID.market_draft_validation.output));
    },
  });
  const result = await gateway.generateStructured(
    productRequest("market_draft_validation"),
    { ...context(), executionProfile: AI_EXECUTION_PROFILE_SINGLE_INFERENCE_SMOKE_V1 },
  );
  assert.equal(count, 1);
  assert.equal(result.metadata.executionProfile, AI_EXECUTION_PROFILE_SINGLE_INFERENCE_SMOKE_V1);
  assert.equal(result.metadata.providerRequestLimit, 1);
});

test("el perfil administrativo no reintenta una salida inválida", async () => {
  let count = 0;
  const { gateway } = dependencies({
    fetchImpl: async () => {
      count += 1;
      return response(geminiEnvelope({ result: "approved" }));
    },
  });
  await assert.rejects(
    gateway.generateStructured(
      productRequest("market_draft_validation"),
      { ...context(), executionProfile: AI_EXECUTION_PROFILE_SINGLE_INFERENCE_SMOKE_V1 },
    ),
    (error) => error.code === AI_ERROR_CODES.OUTPUT_CONTRACT_INVALID,
  );
  assert.equal(count, 1);
});

test("el perfil administrativo no ejecuta fallback de schema", async () => {
  let count = 0;
  const { gateway } = dependencies({
    fetchImpl: async () => {
      count += 1;
      return response({ error: { status: "INVALID_ARGUMENT" } }, 400);
    },
  });
  await assert.rejects(
    gateway.generateStructured(
      productRequest("market_draft_validation"),
      { ...context(), executionProfile: AI_EXECUTION_PROFILE_SINGLE_INFERENCE_SMOKE_V1 },
    ),
    (error) => error.code === AI_ERROR_CODES.PROVIDER_HTTP_ERROR,
  );
  assert.equal(count, 1);
});

test("el perfil administrativo se rechaza fuera de Validator legacy_direct antes del proveedor", async () => {
  for (const scenario of [
    { taskType: "market_expert_reasoning", mode: "legacy_direct" },
    { taskType: "market_draft_validation", mode: "gateway_gemini_parity" },
  ]) {
    const { gateway, calls } = dependencies({ mode: scenario.mode });
    await assert.rejects(
      gateway.generateStructured(
        productRequest(scenario.taskType),
        { ...context(), executionProfile: AI_EXECUTION_PROFILE_SINGLE_INFERENCE_SMOKE_V1 },
      ),
      (error) => error.code === AI_ERROR_CODES.EXECUTION_PROFILE_NOT_ALLOWED,
    );
    assert.equal(calls.fetches.length, 0);
    assert.equal(calls.budgets.length, 0);
  }
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

test("Validator corrige el segundo intento con una guía derivada de la fase segura", async () => {
  const systemPrompts = [];
  let count = 0;
  const { gateway } = dependencies({
    fetchImpl: async (_url, init) => {
      count += 1;
      const body = JSON.parse(init.body);
      systemPrompts.push(body.systemInstruction?.parts?.[0]?.text ?? "");
      return response(geminiEnvelope(count === 1
        ? { ...VALID.market_draft_validation.output, unexpected: true }
        : VALID.market_draft_validation.output));
    },
  });
  const result = await gateway.generateStructured(productRequest("market_draft_validation"), context());
  assert.equal(result.value.result, "approved");
  assert.equal(count, 2);
  assert.doesNotMatch(systemPrompts[0], /Reintento técnico del contrato/);
  assert.match(systemPrompts[1], /Reintento técnico del contrato/);
  assert.match(systemPrompts[1], /exactamente las claves result, issues y editorial_notes/);
});

test("Validator conserva una fase segura y específica para cada incumplimiento de salida", async () => {
  const scenarios = [
    {
      output: { ...VALID.market_draft_validation.output, unexpected: true },
      phase: "validator.top_level_keys",
    },
    {
      output: { ...VALID.market_draft_validation.output, editorial_notes: [""] },
      phase: "validator.editorial_notes",
    },
    {
      output: {
        result: "rejected",
        issues: [{ code: "AMBIGUOUS_CRITERIA", field: "yes_criteria", message: "x".repeat(801) }],
        editorial_notes: [],
      },
      phase: "validator.issue_message",
    },
  ];
  for (const scenario of scenarios) {
    const { gateway } = dependencies({
      fetchImpl: async () => response(geminiEnvelope(scenario.output)),
    });
    await assert.rejects(
      gateway.generateStructured(
        productRequest("market_draft_validation"),
        { ...context(), executionProfile: AI_EXECUTION_PROFILE_SINGLE_INFERENCE_SMOKE_V1 },
      ),
      (error) => error.code === AI_ERROR_CODES.OUTPUT_CONTRACT_INVALID
        && error.details?.phase === scenario.phase,
    );
  }
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
