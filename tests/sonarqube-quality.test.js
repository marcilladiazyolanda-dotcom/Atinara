const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { test } = require("node:test");

const root = join(__dirname, "..");
const htmlFiles = [
  "admin-community.html",
  "admin-markets.html",
  "admin-resolution.html",
  "community.html",
  "index.html",
  "market-detail.html",
  "my-predictions.html",
  "profile.html",
  "ranking.html",
  "reset-password.html"
];

function read(fileName) {
  return readFileSync(join(root, fileName), "utf8");
}

function luminance(hex) {
  const channels = hex.match(/[0-9a-f]{2}/gi).map((value) => parseInt(value, 16) / 255);
  const [red, green, blue] = channels.map((value) =>
    value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  );
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrast(foreground, background) {
  const first = luminance(foreground);
  const second = luminance(background);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

test("la configuración local de Sonar usa únicamente parámetros admitidos por el análisis automático", () => {
  const properties = read(".sonarcloud.properties");
  assert.doesNotMatch(properties, /sonar\.exclusions=[^\n]*supabase\/migrations/);
  assert.doesNotMatch(properties, /sonar\.issue\.ignore\.multicriteria/);
  assert.doesNotMatch(properties, /sonar\.issue\.ignore\.allfile/);
  assert.match(properties, /sonar\.test\.inclusions=[^\n]*supabase\/tests\/\*\*/);
  assert.match(properties, /^sonar\.cpd\.exclusions=supabase\/migrations\/\*\*\/\*\.sql$/m);
});

test("la corrección Sonar conserva análisis SQL y elimina los patrones inseguros detectados", () => {
  const workflow = read(".github/workflows/oraklo-quality.yml");
  const adminMarkets = read("admin-markets.js");
  const adminValidation = read("market-admin-validation.js");
  const landing = read("market-publication-landing.js");
  const browserFixer = read("market-draft-fixer.js");
  const aiContracts = read("supabase/functions/_shared/ai/contracts.mjs");
  const draftRepair = read("supabase/functions/_shared/market-draft-repair.mjs");
  const resolutionContract = read("supabase/functions/_shared/market-intelligence/resolution-contract.mjs");
  const radarShared = read("supabase/functions/_shared/market-radar.mjs");
  const edgeFixer = read("supabase/functions/market-draft-fixer/index.ts");
  const radarEdge = read("supabase/functions/market-radar/index.ts");
  const agentSql = read("supabase/tests/agent_engine_v2_transaction.sql");
  const factSql = read("supabase/tests/authoritative_radar_fact_gate_transaction.sql");
  const attestationSql = read("supabase/tests/market_radar_legacy_fact_attestation_transaction.sql");

  assert.match(workflow, /denoland\/setup-deno@[0-9a-f]{40} # v2\.0\.5/);
  assert.doesNotMatch(adminMarkets, /\.map\(radarGroupMarkup\)/);
  assert.doesNotMatch(adminMarkets, /draftBaseline:\s*null/);
  assert.match(landing, /const normalizePublication =/);
  assert.match(landing, /MARKET_ID_PATTERN/);
  assert.match(landing, /banner\.replaceChildren\(summary, link\)/);
  assert.doesNotMatch(landing, /\.innerHTML\s*=/);
  [browserFixer, aiContracts, radarEdge].forEach((source) => {
    assert.doesNotMatch(source, /Math\.random\(/);
  });
  [adminValidation, aiContracts, draftRepair, resolutionContract, radarShared, edgeFixer, radarEdge]
    .forEach((source) => assert.doesNotMatch(source, /\.sort\(\)/));
  assert.match(draftRepair, /const metricKind = targetUser \|\| \(!targetCritic && rulesUser && !rulesCritic\)/);
  assert.doesNotMatch(draftRepair, /\?\s*"critic"\s*:\s*"critic"/);
  assert.doesNotMatch(radarEdge, /\.some\(isBlockingDuplicateMatch\)/);
  assert.match(agentSql, /update private\.market_agent_runs[\s\S]*?where invocation_id like 'agent-sql-v21-%'/);
  assert.doesNotMatch(factSql, /set reason = reason/);
  assert.doesNotMatch(attestationSql, /set attestation_sha256 = attestation_sha256/);
});

test("la trampa de foco del acceso no compara elementos de tipos opcionales", () => {
  const auth = read("auth.js");
  assert.match(auth, /first\?\.matches\(":focus"\)/);
  assert.match(auth, /last\?\.matches\(":focus"\)/);
  assert.doesNotMatch(auth, /document\.activeElement === (?:first|last)/);
});

test("las páginas usan elementos HTML nativos para navegación, estado, filtros y diálogo", () => {
  htmlFiles.forEach((fileName) => {
    const html = read(fileName);
    assert.doesNotMatch(html, /role="(?:group|status|dialog)"/);
    if (html.includes("karma-pill")) {
      assert.match(html, /<nav class="topbar-actions[^"]*"[^>]*>/);
      assert.match(html, /<output class="karma-pill"/);
    }
  });

  const index = read("index.html");
  assert.equal((index.match(/<fieldset class="filter-fieldset">/g) || []).length, 2);
  assert.match(index, /<output class="season-snapshot"/);

  const detail = read("market-detail.html");
  assert.match(detail, /<dialog class="modal-backdrop" id="prediction-modal"/);
  assert.doesNotMatch(detail, /id="prediction-modal"[^>]*hidden/);
  const detailScript = read("market-detail.js");
  assert.match(detailScript, /predictionModal\.showModal\(\)/);
  assert.match(detailScript, /predictionModal\.close\(\)/);
  const css = read("styles.css");
  assert.match(css, /\.modal-backdrop\[hidden\],\s*dialog\.modal-backdrop:not\(\[open\]\)/);
});

test("las superficies oscuras corregidas mantienen contraste WCAG AA", () => {
  const pairs = [
    ["F8FBFF", "1D2A46"],
    ["FF9FB3", "24151E"],
    ["F7DB9B", "211A10"],
    ["CFE0FF", "14213A"],
    ["C8F4DC", "142820"],
    ["FFD2D2", "2B181E"],
    ["FFE2A0", "211A10"],
    ["FFC0C0", "24151C"],
    ["B9F5D5", "142820"],
    ["FFFFFF", "2A2534"],
    ["C8DCFF", "14213A"],
    ["BFF2D7", "142820"],
    ["FFC3C3", "2B181E"],
    ["F7D995", "211A10"],
    ["F5D793", "211A10"]
  ];
  pairs.forEach(([foreground, background]) => {
    assert.ok(
      contrast(foreground, background) >= 4.5,
      `${foreground} sobre ${background} no alcanza 4.5:1`
    );
  });
});

test("las Edge Functions mantienen pequeñas las responsabilidades y separan autorización", () => {
  const analyzer = read("supabase/functions/analyze-market-resolution/index.ts");
  const approver = read("supabase/functions/approve-market-resolution/index.ts");
  const validator = read("supabase/functions/validate-market-draft/index.ts");

  assert.match(analyzer, /function authenticateResolutionAdmin/);
  assert.match(analyzer, /function runResolutionAnalysis/);
  assert.match(approver, /function authenticateApprovalAdmin/);
  assert.match(approver, /function verifyMarketForApproval/);
  assert.match(validator, /function authenticateDraftAdmin/);
  assert.match(validator, /function beginDraftReview/);
  assert.match(validator, /function finalizeAutomaticReview/);
  [analyzer, approver, validator].forEach((source) => {
    assert.match(source, /appMetadata\.oraklo_admin === true/);
  });
});

test("la corrección de calidad usa una única versión de caché pública", () => {
  htmlFiles.forEach((fileName) => {
    const versions = [...read(fileName).matchAll(/[?&]v=([a-zA-Z0-9-]+)/g)]
      .map((match) => match[1]);
    assert.equal(new Set(versions).size, 1, `${fileName} mezcla versiones de caché.`);
  });
});
