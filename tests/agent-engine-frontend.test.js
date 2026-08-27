const assert = require("node:assert/strict");
const { readFileSync, readdirSync } = require("node:fs");
const { join } = require("node:path");
const { test } = require("node:test");

const root = join(__dirname, "..");
const read = (file) => readFileSync(join(root, file), "utf8");
const editorBridge = read("admin-agent-engine.js");
const marketsHtml = read("admin-markets.html");
const marketsUi = read("admin-markets.js");
const correctorUi = read("market-draft-fixer.js");
const resolutionUi = read("admin-resolution.js");
const validationUi = read("market-admin-validation.js");

test("el puente del Agent Engine vive en un recurso externo ordenado y versionado", () => {
  assert.doesNotMatch(marketsHtml, /function\s+(?:invokeMarketExpert|installExpertPanel|renderExpertDossier)/);
  assert.match(marketsHtml, /market-draft-fixer\.js\?v=20260827-radar-editor-bridge1[\s\S]+admin-agent-engine\.js\?v=20260827-radar-editor-bridge1/);
  assert.match(editorBridge, /function initRadarExpertBridge/);
});

test("las superficies de agente son neutrales respecto al proveedor", () => {
  [editorBridge, marketsUi, correctorUi, resolutionUi, validationUi].forEach((source) => {
    assert.doesNotMatch(source, /Gemini|Tavily|OpenRouter|NVIDIA|Nemotron/);
  });
});

test("el Corrector construye mensajes con DOM seguro y conserva regiones accesibles", () => {
  assert.doesNotMatch(correctorUi, /\.innerHTML\s*=/);
  assert.match(correctorUi, /document\.createElement/);
  assert.match(correctorUi, /\.textContent\s*=/);
  assert.match(correctorUi, /setAttribute\("role",\s*"alert"\)/);
  assert.match(correctorUi, /setAttribute\("role",\s*"status"\)/);
});

test("la propuesta de resolución sigue siendo solo una entrada para revisión humana", () => {
  assert.match(resolutionUi, /analysis_ready_for_human_review/);
  assert.match(resolutionUi, /can_resolve_market/);
  assert.match(resolutionUi, /AI_TELEMETRY_WRITE_FAILED/);
  assert.match(resolutionUi, /Observabilidad incompleta/);
  assert.match(resolutionUi, /approve-market-resolution/);
});

test("la telemetría incompleta se muestra sin cambiar el outcome", () => {
  assert.match(editorBridge, /AI_TELEMETRY_WRITE_FAILED/);
  assert.match(marketsUi, /AI_TELEMETRY_WRITE_FAILED/);
  assert.match(correctorUi, /AI_TELEMETRY_WRITE_FAILED/);
  assert.match(validationUi, /La operación conserva su resultado/);
});

test("el análisis del Editor muestra inicio, fallo tipado y reintento sin no-op silencioso", () => {
  assert.match(editorBridge, /const analysisAttempts = new Map\(\)/);
  assert.match(editorBridge, /La acción ya ha comenzado/);
  assert.match(editorBridge, /atinara:radar-expert-analysis-failed[\s\S]*?event\.detail\?\.failure/);
  assert.match(editorBridge, /analysisAttempts\.set\(candidateId, \{ status: "failed", failure \}\)/);
  assert.match(editorBridge, /failure\.retryable \? "Reintentar análisis"/);
  assert.match(marketsUi, /detail: \{ candidateId, failure \}/);
  assert.match(marketsUi, /activeRadarExpertAnalyses\.has\(candidateId\)/);
  assert.doesNotMatch(marketsUi, /invokeMarketExpert\("get-analysis"[\s\S]{0,180}\.catch\(\(\) => null\)/);
  assert.doesNotMatch(editorBridge, /invokeExpert\("record-feedback"[\s\S]{0,500}\.catch\(\(\) => null\)/);
  assert.match(editorBridge, /El feedback editorial no pudo registrarse/);
  assert.match(editorBridge, /el borrador no debe volver a guardarse para repetirlo/);
  assert.match(editorBridge, /safeDraftSaveError\(error\)/);
});

test("todas las páginas que cargan observabilidad usan la misma release de recursos", () => {
  const htmlFiles = readdirSync(root).filter((name) => name.endsWith(".html"));
  const consumers = htmlFiles.filter((name) => read(name).includes("observability-config.js"));
  assert.ok(consumers.length >= 10);
  consumers.forEach((name) => {
    const source = read(name);
    const version = "20260827-radar-editor-bridge1";
    assert.match(source, new RegExp(`styles\\.css\\?v=${version}`));
    assert.match(source, new RegExp(`observability-config\\.js\\?v=${version}`));
    assert.match(source, new RegExp(`monitoring\\.js\\?v=${version}`));
  });
});
