const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { pathToFileURL } = require("node:url");
const { before, test } = require("node:test");

const root = join(__dirname, "..");
const migration = readFileSync(join(root, "supabase/migrations/20260812141515_add_agent_engine_v2_v1.sql"), "utf8");
const canonicalJsonFixture = JSON.parse(readFileSync(
  join(root, "tests/fixtures/atinara-canonical-json-v1.json"),
  "utf8",
));
let registries;
let tools;
let runtime;
let persistence;
let contracts;

before(async () => {
  registries = await import(pathToFileURL(join(root, "supabase/functions/_shared/atinara-agent-registries-v2.mjs")).href);
  tools = await import(pathToFileURL(join(root, "supabase/functions/_shared/atinara-agent-tools-v2.mjs")).href);
  runtime = await import(pathToFileURL(join(root, "supabase/functions/_shared/atinara-agent-runtime-v2.mjs")).href);
  persistence = await import(pathToFileURL(join(root, "supabase/functions/_shared/ai/persistence.mjs")).href);
  contracts = await import(pathToFileURL(join(root, "supabase/functions/_shared/ai/contracts.mjs")).href);
});

function registrySnapshot() {
  const strategies = registries.STRATEGY_HANDLER_NAMES.map((strategyKey) => ({
    strategy_key: strategyKey,
    handler_key: strategyKey,
    can_write: registries.STRATEGY_HANDLER_REGISTRY[strategyKey].canWrite,
    affected_fields: [],
    write_fields: strategyKey === "derive_edge_cases" ? ["edge_cases"] : [],
  }));
  return {
    issues: [{ code: "EDGE_CASES_REQUIRED", repairable: true }],
    strategies,
    bindings: [{ issue_code: "EDGE_CASES_REQUIRED", strategy_key: "derive_edge_cases" }],
  };
}

function handlersFor(agentType, overrides = {}) {
  return Object.fromEntries(tools.ATINARA_AGENT_TOOL_MANIFEST_V2[agentType].map((tool) => [
    tool,
    overrides[tool] ?? (async () => ({ status: "completed", summary: { count: 1 } })),
  ]));
}

function executionContext() {
  return {
    invocationId: crypto.randomUUID(),
    agentRunId: crypto.randomUUID(),
    absoluteDeadlineAt: Date.now() + 60_000,
    signal: new AbortController().signal,
  };
}

function domainCanonicalCase(id) {
  return canonicalJsonFixture.domainCompatibilityCases.find((testCase) => testCase.id === id);
}

test("Canonical JSON v1 cubre la huella real del Registry v2", async () => {
  const registryCase = domainCanonicalCase("registry-v2.snapshot");
  const { version, issues, strategies, bindings } = registryCase.input;
  const snapshot = { issues, strategies, bindings };
  assert.equal(version, registries.ATINARA_AGENT_REGISTRY_VERSION);
  assert.deepEqual(snapshot, registrySnapshot());
  assert.equal(contracts.canonicalJson(registryCase.input), registryCase.expectedCanonicalJson);
  assert.equal(await registries.agentRegistryHash(snapshot), registryCase.expectedSha256);
});

test("Canonical JSON v1 cubre progreso y replan del Runtime v2", async () => {
  const progressCase = domainCanonicalCase("agent-runtime-v2.progress");
  const progressRun = runtime.createAtinaraAgentRunV2({
    agentType: "market_editor_agent",
    handlers: handlersFor("market_editor_agent"),
    registryHash: "a".repeat(64),
    snapshotFingerprint: "b".repeat(64),
    executionContext: executionContext(),
  });
  await progressRun.dispatch("load_authoritative_origin");
  assert.equal(progressRun.snapshot().tools[0].progress_fingerprint, progressCase.expectedSha256);

  const replanCase = domainCanonicalCase("agent-runtime-v2.replan");
  assert.equal(contracts.canonicalJson(replanCase.input), replanCase.expectedCanonicalJson);
  assert.equal(await contracts.sha256Hex(replanCase.expectedCanonicalJson), replanCase.expectedSha256);
  const executeRun = runtime.createAtinaraAgentRunV2({
    agentType: "market_editor_agent",
    handlers: handlersFor("market_editor_agent"),
    registryHash: "c".repeat(64),
    snapshotFingerprint: "d".repeat(64),
    executionContext: executionContext(),
  });
  const execution = await executeRun.execute({ round: 1 });
  assert.equal(
    execution.tools[0].progress_fingerprint,
    await contracts.sha256Hex(replanCase.expectedSha256),
  );
});

test("Registry v2 exige correspondencia total SQL, handlers, bindings y allowlist", () => {
  assert.equal(registries.STRATEGY_HANDLER_NAMES.includes("refresh_deterministic_eligibility"), true);
  const snapshot = registrySnapshot();
  assert.deepEqual(registries.assertAgentRegistrySnapshot(snapshot), {
    issues: 1,
    strategies: registries.STRATEGY_HANDLER_NAMES.length,
    bindings: 1,
  });

  const missingHandler = { ...registries.STRATEGY_HANDLER_REGISTRY };
  delete missingHandler.derive_edge_cases;
  assert.throws(() => registries.assertAgentRegistrySnapshot(snapshot, missingHandler), /AGENT_STRATEGY_HANDLER_MISSING/);

  const extraHandler = { ...registries.STRATEGY_HANDLER_REGISTRY, unregistered_handler: { handlerKey: "unregistered_handler", canWrite: false } };
  assert.throws(() => registries.assertAgentRegistrySnapshot(snapshot, extraHandler), /AGENT_HANDLER_NOT_REGISTERED/);

  assert.throws(() => registries.assertAgentRegistrySnapshot({ ...snapshot, bindings: [] }), /AGENT_REPAIRABLE_ISSUE_UNBOUND/);
  const invalidFields = registrySnapshot();
  invalidFields.strategies = invalidFields.strategies.map((item) => item.strategy_key === "derive_edge_cases"
    ? { ...item, write_fields: ["karma_balance"] }
    : item);
  assert.throws(() => registries.assertAgentRegistrySnapshot(invalidFields), /AGENT_STRATEGY_FIELD_NOT_ALLOWED/);
});

test("Runtime v2 despacha handlers reales y bloquea herramientas ajenas", async () => {
  let calls = 0;
  const run = runtime.createAtinaraAgentRunV2({
    agentType: "market_editor_agent",
    handlers: handlersFor("market_editor_agent", {
      load_authoritative_origin: async () => {
        calls += 1;
        return { status: "completed", summary: { loaded: true } };
      },
    }),
    registryHash: "a".repeat(64),
    snapshotFingerprint: "b".repeat(64),
    executionContext: executionContext(),
  });
  await run.dispatch("load_authoritative_origin", {}, { progressFingerprint: "origin-loaded" });
  assert.equal(calls, 1);
  await assert.rejects(() => run.dispatch("persist_single_version"), /AGENT_TOOL_NOT_ALLOWED/);
  assert.equal(run.snapshot().publishes, false);
  assert.equal(run.snapshot().resolves, false);
  assert.equal(run.snapshot().liquidates, false);
});

test("Radar v2 es de solo lectura y la persistencia de elegibilidad queda en el RPC de dominio", () => {
  const radarTools = tools.ATINARA_AGENT_TOOL_MANIFEST_V2.radar_source_agent;
  assert.equal(radarTools.includes("persist_eligibility"), false);
  assert.equal(radarTools.every((tool) => tools.ATINARA_AGENT_TOOL_REGISTRY_V2[tool].canWrite === false), true);
  assert.match(readFileSync(join(root, "supabase/functions/market-radar/index.ts"), "utf8"), /upsert_market_radar_batch_with_eligibility_v1/);
});

test("Writer único exige estrategia autorizada, CAS y una escritura por ronda", async () => {
  const initial = "c".repeat(64);
  const run = runtime.createAtinaraAgentRunV2({
    agentType: "market_corrector_agent",
    handlers: handlersFor("market_corrector_agent", {
      persist_single_version: async () => ({ status: "completed", snapshotFingerprint: "d".repeat(64) }),
    }),
    registryHash: "e".repeat(64),
    snapshotFingerprint: initial,
    executionContext: executionContext(),
  });
  await assert.rejects(() => run.dispatch("persist_single_version", { strategyKey: "research_registered_primary" }, {
    round: 1, expectedSnapshotFingerprint: initial, progressFingerprint: "forbidden-write",
  }), /AGENT_STRATEGY_WRITE_FORBIDDEN/);
  await assert.rejects(() => run.dispatch("persist_single_version", { strategyKey: "derive_edge_cases" }, {
    round: 1, expectedSnapshotFingerprint: "f".repeat(64), progressFingerprint: "stale-write",
  }), /AGENT_STALE_SNAPSHOT/);
  await run.dispatch("persist_single_version", { strategyKey: "derive_edge_cases" }, {
    round: 1, expectedSnapshotFingerprint: initial, progressFingerprint: "first-write",
  });
  await assert.rejects(() => run.dispatch("persist_single_version", { strategyKey: "derive_edge_cases" }, {
    round: 1, expectedSnapshotFingerprint: "d".repeat(64), progressFingerprint: "second-write",
  }), /AGENT_WRITE_BUDGET_EXHAUSTED/);
});

test("Runtime v2 detecta loop, no-progress, deadline y segundo replan máximo", async () => {
  const repeated = runtime.createAtinaraAgentRunV2({
    agentType: "market_editor_agent",
    handlers: handlersFor("market_editor_agent"),
    registryHash: "1".repeat(64),
    snapshotFingerprint: "2".repeat(64),
    executionContext: executionContext(),
  });
  await repeated.dispatch("load_authoritative_origin", {}, { actionKey: "same-action", progressFingerprint: "same-progress" });
  await assert.rejects(() => repeated.dispatch("load_authoritative_origin", {}, {
    actionKey: "same-action", progressFingerprint: "other-progress",
  }), /AGENT_REPEATED_ACTION/);

  const noProgress = runtime.createAtinaraAgentRunV2({
    agentType: "market_editor_agent",
    handlers: handlersFor("market_editor_agent"),
    registryHash: "3".repeat(64),
    snapshotFingerprint: "4".repeat(64),
    maxRepeatedActions: 2,
    executionContext: executionContext(),
  });
  await noProgress.dispatch("load_authoritative_origin", {}, { actionKey: "one", progressFingerprint: "duplicate" });
  await assert.rejects(() => noProgress.dispatch("load_authoritative_origin", {}, {
    actionKey: "two", progressFingerprint: "duplicate",
  }), /AGENT_NO_PROGRESS/);

  let replans = 0;
  const replanHandlers = handlersFor("market_editor_agent", {
    load_authoritative_origin: async () => ({
      status: "degraded",
      replan: true,
      nextState: { deterministicBlocked: replans++ % 2 === 0 },
    }),
  });
  const replan = runtime.createAtinaraAgentRunV2({
    agentType: "market_editor_agent",
    handlers: replanHandlers,
    registryHash: "5".repeat(64),
    snapshotFingerprint: "6".repeat(64),
    maxRepeatedActions: 3,
    executionContext: executionContext(),
  });
  await assert.rejects(() => replan.execute({ round: 1 }), /AGENT_REPLAN_BUDGET_EXHAUSTED/);
});

test("Hash/version del registry son parte del run y no pueden divergir", () => {
  assert.equal(registries.assertRegistryIdentity({
    registryVersion: registries.ATINARA_AGENT_REGISTRY_VERSION,
    registryHash: "a".repeat(64),
  }, registries.ATINARA_AGENT_REGISTRY_VERSION, "a".repeat(64)), true);
  assert.throws(() => registries.assertRegistryIdentity({
    registryVersion: "stale",
    registryHash: "a".repeat(64),
  }, registries.ATINARA_AGENT_REGISTRY_VERSION, "a".repeat(64)), /AGENT_REGISTRY_IDENTITY_MISMATCH/);
});

test("Persistencia v2 escribe run y pasos append-only sin payloads de dominio", async () => {
  const calls = [];
  const store = persistence.createAiPersistence({
    supabaseUrl: "https://project.supabase.co",
    secretKey: "test-service-key",
    fetchImpl: async (url, init) => {
      calls.push({ url, body: JSON.parse(init.body) });
      return new Response(JSON.stringify(url.endsWith("record_market_agent_run_v2")
        ? { run_id: crypto.randomUUID(), idempotent: false }
        : { step_id: 1, idempotent: false }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });
  const run = runtime.createAtinaraAgentRunV2({
    agentType: "market_editor_agent",
    handlers: handlersFor("market_editor_agent"),
    registryHash: "7".repeat(64),
    snapshotFingerprint: "8".repeat(64),
    executionContext: executionContext(),
  });
  await run.dispatch("load_authoritative_origin", {}, { progressFingerprint: "authoritative-origin" });
  const execution = run.complete("completed");
  await store.recordAgentExecution(execution, new AbortController().signal);
  assert.equal(calls.length, 2);
  assert.match(calls[0].url, /record_market_agent_run_v2$/);
  assert.match(calls[1].url, /record_market_agent_step_v2$/);
  assert.match(calls[1].body.payload_input.progress_fingerprint, /^[0-9a-f]{64}$/);
  assert.doesNotMatch(JSON.stringify(calls), /prompt|authorization|cookie|secret_value/i);
});

test("Migración v2 es aditiva, privada, append-only y conserva rollback v1", () => {
  assert.match(migration, /create table private\.market_issue_registry/);
  assert.match(migration, /create table private\.market_repair_strategy_registry/);
  assert.match(migration, /create table private\.market_issue_strategy_bindings/);
  assert.match(migration, /from private\.market_issue_strategy_registry/);
  assert.match(migration, /market_agent_steps_one_writer_per_round/);
  assert.match(migration, /reject_market_agent_run_update_v2/);
  assert.match(migration, /reject_market_agent_step_update_v2/);
  assert.match(migration, /force row level security/g);
  assert.match(migration, /revoke all on table private\.market_agent_runs from public, anon, authenticated, service_role/);
  assert.match(migration, /SERVICE_ROLE_REQUIRED/);
  assert.match(migration, /AGENT_STRATEGY_WRITE_FORBIDDEN/);
  assert.match(migration, /AGENT_REGISTRY_IDENTITY_MISMATCH/);
  assert.match(migration, /clock_timestamp\(\) - interval '180 days'/);
  assert.doesNotMatch(migration, /drop table|alter table private\.market_issue_strategy_registry|delete from private\.market_issue_strategy_registry/i);
});
