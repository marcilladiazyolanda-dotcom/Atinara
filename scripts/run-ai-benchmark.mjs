import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { discoverRouteCapability } from "../supabase/functions/_shared/ai/capability-discovery.mjs";
import { runBenchmarkCase } from "../supabase/functions/_shared/ai/benchmark.mjs";
import { createAiPersistence } from "../supabase/functions/_shared/ai/persistence.mjs";
import { resolveRoute } from "../supabase/functions/_shared/ai/model-catalog.mjs";

const DEFAULT_CORPUS_DIR = resolve("tests/fixtures/ai-benchmark");
const ROUTES_BY_TASK = Object.freeze({
  radar_candidate_enrichment: "gemini.gateway.radar",
  market_expert_reasoning: "gemini.gateway.expert",
  market_draft_validation: "gemini.gateway.validator",
  market_draft_repair: "gemini.gateway.repair",
  market_resolution_analysis: "gemini.gateway.resolution",
});

function option(name) {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) ?? "";
}

function configuredKey(variable, legacy) {
  const value = process.env[variable] ?? "";
  if (value) {
    try {
      const parsed = JSON.parse(value);
      if (typeof parsed?.default === "string" && parsed.default) return parsed.default;
    } catch {
      // Formato de secreto simple.
    }
  }
  return process.env[legacy] ?? "";
}

async function loadCorpus(directory) {
  const manifest = JSON.parse(await readFile(resolve(directory, "manifest.v1.json"), "utf8"));
  const cases = new Map();
  for (const file of manifest.fixtureFiles ?? []) {
    const content = await readFile(resolve(directory, file), "utf8");
    for (const line of content.split(/\r?\n/).filter(Boolean)) {
      const item = JSON.parse(line);
      if (!item.caseId || cases.has(item.caseId)) throw new Error("BENCHMARK_CASE_ID_DUPLICATE");
      cases.set(item.caseId, item);
    }
  }
  return { manifest, cases, loadCase: async (caseId) => cases.get(caseId) ?? null };
}

function mockProviderResponse(benchmarkCase, routeId, url) {
  const output = benchmarkCase.technicalExpectedOutput;
  if (routeId.startsWith("openrouter") || routeId.startsWith("nvidia_nim")) {
    return new Response(JSON.stringify({
      id: `offline-${benchmarkCase.caseId}`,
      choices: [{ message: { content: JSON.stringify(output) } }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    }), { status: 200, headers: { "content-type": "application/json" } });
  }
  if (String(url).endsWith("/v1beta/interactions")) {
    return new Response(JSON.stringify({ outputs: [{ type: "text", text: JSON.stringify(output) }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }
  return new Response(JSON.stringify({
    candidates: [{ content: { parts: [{ text: JSON.stringify(output) }] } }],
    usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 },
  }), { status: 200, headers: { "content-type": "application/json" } });
}

function livePreflight(corpus, routeId) {
  if (process.env.ATINARA_AI_LIVE_AUTHORIZED !== "1") throw new Error("LIVE_BENCHMARK_AUTHORIZATION_REQUIRED");
  if (process.env.ATINARA_AI_ENVIRONMENT_APPROVED !== "1") throw new Error("LIVE_BENCHMARK_ENVIRONMENT_APPROVAL_REQUIRED");
  if (!(Number(process.env.ATINARA_AI_LIVE_BUDGET_UNITS) > 0)) throw new Error("AI_BUDGET_EXHAUSTED");
  if (!routeId) throw new Error("LIVE_BENCHMARK_EXACT_ROUTE_REQUIRED");
  if ([...corpus.cases.values()].some((item) => item.groundTruthState !== "approved" || item.holdout !== true)) {
    throw new Error("GROUND_TRUTH_NOT_READY_FOR_PROMOTION");
  }
  const route = resolveRoute(routeId);
  if (!process.env[route.provider.secretName]) throw new Error("AI_PROVIDER_NOT_CONFIGURED");
  if (!process.env.SUPABASE_URL || !configuredKey("SUPABASE_SECRET_KEYS", "SUPABASE_SERVICE_ROLE_KEY")) {
    throw new Error("LIVE_BENCHMARK_ATOMIC_BUDGET_NOT_CONFIGURED");
  }
}

async function main() {
  const live = process.argv.includes("--live");
  const corpusDirectory = resolve(option("corpus-dir") || DEFAULT_CORPUS_DIR);
  const requestedRoute = option("route");
  const corpus = await loadCorpus(corpusDirectory);
  if (live) livePreflight(corpus, requestedRoute);
  else {
    process.env.ATINARA_EXTERNAL_AI_DISABLED = "1";
    globalThis.fetch = async () => {
      throw new Error("BENCHMARK_UNINJECTED_EXTERNAL_FETCH");
    };
  }

  const secretReader = async (name) => process.env[name] ?? "";
  const livePersistence = live ? createAiPersistence({
    supabaseUrl: process.env.SUPABASE_URL,
    secretKey: configuredKey("SUPABASE_SECRET_KEYS", "SUPABASE_SERVICE_ROLE_KEY"),
    fetchImpl: globalThis.fetch,
  }) : null;
  const results = [];
  for (const benchmarkCase of corpus.cases.values()) {
    const routeId = requestedRoute || ROUTES_BY_TASK[benchmarkCase.request.taskType];
    if (!routeId) throw new Error("BENCHMARK_ROUTE_NOT_REGISTERED");
    const context = {
      invocationId: crypto.randomUUID(),
      absoluteDeadlineAt: Date.now() + 120_000,
      signal: new AbortController().signal,
    };
    const fetchImpl = live
      ? globalThis.fetch
      : async (url) => mockProviderResponse(benchmarkCase, routeId, url);
    const result = await runBenchmarkCase({ caseId: benchmarkCase.caseId, routeId }, context, {
      corpusStore: corpus,
      fetchImpl,
      liveAuthorized: live,
      persistence: livePersistence,
      secretReader,
      capabilityReader: live
        ? async (capabilityRouteId, capabilityContext) => {
          const route = resolveRoute(capabilityRouteId);
          return discoverRouteCapability({
            routeId: capabilityRouteId,
            apiKey: await secretReader(route.provider.secretName),
            context: capabilityContext,
            fetchImpl: globalThis.fetch,
            liveAuthorized: true,
          });
        }
        : undefined,
    });
    results.push(result);
  }

  const approved = results.filter((item) => item.groundTruthState === "approved").length;
  const technicalFailures = results.filter((item) => item.status !== "technical_pass");
  const summary = {
    mode: live ? "live" : "offline",
    externalNetworkCalls: live ? "authorized" : 0,
    cases: results.length,
    technicalPassed: results.length - technicalFailures.length,
    technicalFailed: technicalFailures.length,
    approvedGroundTruthCases: approved,
    groundTruthStatus: approved > 0 ? "GROUND_TRUTH_AVAILABLE" : "GROUND_TRUTH_NOT_READY_FOR_PROMOTION",
    promotionClaimed: false,
    results,
  };
  console.log(JSON.stringify(summary, null, 2));
  if (technicalFailures.length) process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : "BENCHMARK_FAILED");
    process.exitCode = 1;
  });
}
