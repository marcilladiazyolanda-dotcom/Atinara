const assert = require("node:assert/strict");
const { readFileSync, readdirSync } = require("node:fs");
const { join } = require("node:path");
const { pathToFileURL } = require("node:url");
const { before, test } = require("node:test");

const root = join(__dirname, "..");
const fixturesRoot = join(root, "tests/fixtures/ai-benchmark");
const manifest = JSON.parse(readFileSync(join(fixturesRoot, "manifest.v1.json"), "utf8"));
const workflow = readFileSync(join(root, ".github/workflows/ai-benchmark-offline.yml"), "utf8");
const runner = readFileSync(join(root, "scripts/run-ai-benchmark.mjs"), "utf8");
let benchmark;

before(async () => {
  benchmark = await import(pathToFileURL(join(root, "supabase/functions/_shared/ai/benchmark.mjs")).href);
});

function publicCases() {
  return manifest.fixtureFiles.flatMap((file) => readFileSync(join(fixturesRoot, file), "utf8")
    .split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line)));
}

test("el corpus objetivo suma 300 pero el repositorio solo contiene fixtures draft", () => {
  assert.equal(Object.values(manifest.targetCaseCounts).reduce((sum, value) => sum + value, 0), 300);
  const cases = publicCases();
  assert.equal(cases.length, 5);
  assert.equal(new Set(cases.map((item) => item.caseId)).size, cases.length);
  for (const item of cases) {
    assert.equal(item.groundTruthState, "draft");
    assert.equal(item.holdout, false);
    assert.deepEqual(item.reviews, []);
    assert.doesNotThrow(() => benchmark.assertBenchmarkCase(item));
  }
  assert.equal(manifest.publicFixturesAreGroundTruth, false);
});

test("holdout exige approved y approved exige doble revisión compatible o adjudicación", () => {
  const base = structuredClone(publicCases()[0]);
  assert.throws(() => benchmark.assertBenchmarkCase({ ...base, holdout: true }), /GROUND_TRUTH_HOLDOUT_REQUIRES_APPROVAL/);
  assert.throws(() => benchmark.assertBenchmarkCase({ ...base, groundTruthState: "approved" }), /GROUND_TRUTH_APPROVAL_REQUIRED/);
  assert.doesNotThrow(() => benchmark.assertBenchmarkCase({
    ...base,
    groundTruthState: "approved",
    holdout: true,
    reviews: [{ reviewer: "reviewer-a", decision: "accept" }, { reviewer: "reviewer-b", decision: "accept" }],
  }));
  assert.doesNotThrow(() => benchmark.assertBenchmarkCase({
    ...base,
    groundTruthState: "approved",
    holdout: true,
    reviews: [{ reviewer: "reviewer-a", decision: "accept" }, { reviewer: "reviewer-b", decision: "reject" }],
    adjudication: { reviewer: "adjudicator", decision: "accept" },
  }));
});

test("reviewed_once y disputed conservan transiciones honestas", () => {
  const base = structuredClone(publicCases()[0]);
  assert.throws(() => benchmark.assertBenchmarkCase({ ...base, groundTruthState: "reviewed_once" }), /GROUND_TRUTH_REVIEW_REQUIRED/);
  assert.throws(() => benchmark.assertBenchmarkCase({
    ...base,
    groundTruthState: "disputed",
    reviews: [{ decision: "accept" }, { decision: "accept" }],
  }), /GROUND_TRUTH_DISPUTE_REQUIRED/);
  assert.doesNotThrow(() => benchmark.assertBenchmarkCase({
    ...base,
    groundTruthState: "disputed",
    reviews: [{ decision: "accept" }, { decision: "reject" }],
  }));
});

test("CI de benchmark es offline, sin schedule y sin dependencia de secretos", () => {
  assert.match(workflow, /push:/);
  assert.match(workflow, /pull_request:/);
  assert.match(workflow, /ATINARA_EXTERNAL_AI_DISABLED: "1"/);
  assert.match(workflow, /npm run benchmark:offline/);
  assert.doesNotMatch(workflow, /schedule:|cron:|OPENROUTER_API_KEY|NVIDIA_API_KEY|GEMINI_API_KEY/);
  assert.match(runner, /externalNetworkCalls: live \? "authorized" : 0/);
  assert.match(runner, /GROUND_TRUTH_NOT_READY_FOR_PROMOTION/);
  assert.match(runner, /LIVE_BENCHMARK_AUTHORIZATION_REQUIRED/);
  assert.match(runner, /LIVE_BENCHMARK_ENVIRONMENT_APPROVAL_REQUIRED/);
  assert.match(runner, /ATINARA_AI_LIVE_BUDGET_UNITS/);
  assert.match(runner, /BENCHMARK_UNINJECTED_EXTERNAL_FETCH/);
});

test("entrypoint benchmark queda fuera de las Edge productivas", () => {
  const edgeFiles = [
    "market-radar/index.ts", "market-expert/index.ts", "market-draft-fixer/index.ts",
    "validate-market-draft/index.ts", "analyze-market-resolution/index.ts",
  ];
  for (const edgeFile of edgeFiles) {
    const source = readFileSync(join(root, "supabase/functions", edgeFile), "utf8");
    assert.doesNotMatch(source, /ai\/benchmark|runBenchmarkCase|routeHint\s*[:=]\s*["']benchmark/);
  }
  assert.ok(readdirSync(fixturesRoot).every((file) => file.endsWith(".json") || file.endsWith(".jsonl")));
});
