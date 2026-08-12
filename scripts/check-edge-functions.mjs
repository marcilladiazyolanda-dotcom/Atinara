import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(import.meta.dirname, "..");
const functionsRoot = join(root, "supabase", "functions");
const deno = process.env.DENO_BIN || (process.platform === "win32" ? "deno.exe" : "deno");
// Supabase's Edge runtime declaration references the optional built-in AI API
// through npm:openai. Atinara neither imports nor ships that SDK. Map only that
// type-only reference to a minimal declaration so a clean npm install can type
// check the Edge graph without adding an unused OpenAI dependency.
const optionalEdgeAiTypeStub = [
  "export namespace OpenAI {",
  "  export namespace Chat {",
  "    export type ChatCompletionCreateParams = Record<string, unknown>;",
  "  }",
  "}",
].join("\n");
const optionalEdgeAiTypeUrl = `data:application/typescript,${encodeURIComponent(optionalEdgeAiTypeStub)}`;
const edgeImportMapUrl = `data:application/json,${encodeURIComponent(JSON.stringify({
  imports: { "npm:openai@^4.52.5": optionalEdgeAiTypeUrl },
}))}`;
const edges = readdirSync(functionsRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && entry.name !== "_shared")
  .map((entry) => join(functionsRoot, entry.name, "index.ts"))
  .filter((file) => {
    try { readFileSync(file); return true; } catch { return false; }
  })
  .sort();

if (!edges.length) throw new Error("EDGE_FUNCTIONS_NOT_FOUND");

const aiEdges = new Set([
  "market-radar", "market-expert", "market-draft-fixer",
  "validate-market-draft", "analyze-market-resolution",
]);
const directProviderPattern = /GEMINI_MODEL|GEMINI_API_KEY|generativelanguage\.googleapis\.com|:generateContent|\/v1beta\/interactions/;

for (const file of edges) {
  const edgeName = file.split(/[\\/]/).at(-2);
  const source = readFileSync(file, "utf8");
  if (aiEdges.has(edgeName) && directProviderPattern.test(source)) {
    throw new Error(`DIRECT_AI_PROVIDER_CALL_FOUND:${edgeName}`);
  }
  const result = spawnSync(deno, ["check", "--no-lock", `--import-map=${edgeImportMapUrl}`, file], {
    cwd: root,
    env: { ...process.env, ATINARA_EXTERNAL_AI_DISABLED: "1" },
    encoding: "utf8",
    stdio: "pipe",
  });
  if (result.status !== 0) {
    process.stderr.write(result.stdout || "");
    process.stderr.write(result.stderr || "");
    throw new Error(`EDGE_DENO_CHECK_FAILED:${edgeName}`);
  }
  process.stdout.write(`EDGE_CHECK_OK ${edgeName}\n`);
}

process.stdout.write(`EDGE_CHECKS_OK ${edges.length}\n`);
