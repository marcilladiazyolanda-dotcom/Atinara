const assert = require("node:assert/strict");
const { existsSync, readFileSync } = require("node:fs");
const { join } = require("node:path");
const { test } = require("node:test");

const repositoryRoot = join(__dirname, "..");
const migrationPath = join(
  repositoryRoot,
  "supabase/migrations/20260801172543_add_live_prediction_market_model.sql"
);

function calculateLmsrQuote(selectedProbability, liquidity, karma) {
  const growth = Math.exp(karma / liquidity);
  const shares = liquidity * Math.log(
    (growth - (1 - selectedProbability)) / selectedProbability
  );
  const probabilityAfter = 1 - ((1 - selectedProbability) / growth);
  return {
    shares,
    probabilityAfter,
    averagePricePercentage: (karma / shares) * 100
  };
}

test("el LMSR mueve el precio y calcula un precio medio entre inicio y final", () => {
  const quote = calculateLmsrQuote(0.5, 2000, 100);

  assert.ok(quote.shares > 100);
  assert.ok(quote.probabilityAfter > 0.5);
  assert.ok(quote.averagePricePercentage > 50);
  assert.ok(quote.averagePricePercentage < quote.probabilityAfter * 100);
});

test("una opción al uno por ciento puede superar x10 sin movimiento simulado", () => {
  const quote = calculateLmsrQuote(0.01, 2000, 10);

  assert.ok(quote.shares > 100, "El retorno base debe poder superar 100 Karma.");
  assert.ok(quote.probabilityAfter > 0.01);
  assert.ok(quote.averagePricePercentage > 1);
  assert.ok(quote.averagePricePercentage < quote.probabilityAfter * 100);
});

test("la migración conserva contratos antiguos y liquida los nuevos sin el tope x10", () => {
  const sql = readFileSync(migrationPath, "utf8");

  assert.match(sql, /pricing_model\s*=\s*'legacy_fixed_v1'/);
  assert.match(sql, /coalesce\(prediction_row\.pricing_model, 'legacy_fixed_v1'\) = 'lmsr_v1'/);
  assert.match(sql, /prediction_row\.contract_shares[\s\S]+prediction_row\.difficulty_bonus_estimated/);
  assert.match(sql, /Las posiciones anteriores conservan exactamente el contrato x10/);
  assert.match(sql, /0\.99999999::numeric/);
  assert.match(sql, /get_prediction_quote[\s\S]+PREDICTION_ALREADY_EXISTS/);
  assert.match(sql, /where m\.status in \('Abierto', 'Cerrado', 'Resuelto'\)/);
  assert.match(sql, /realtime\.send\([\s\S]+?'price_changed'[\s\S]+?'market:' \|\| market_id_input[\s\S]+?false/);
});

test("el frontend usa cotización versionada, histórico real y ningún catálogo simulado", () => {
  const detailSource = readFileSync(join(repositoryRoot, "market-detail.js"), "utf8");
  const homeSource = readFileSync(join(repositoryRoot, "script.js"), "utf8");
  const detailHtml = readFileSync(join(repositoryRoot, "market-detail.html"), "utf8");
  const indexHtml = readFileSync(join(repositoryRoot, "index.html"), "utf8");

  assert.match(detailSource, /get_prediction_quote/);
  assert.match(detailSource, /quote_version_input/);
  assert.match(detailSource, /max_entry_price_input/);
  assert.match(detailSource, /get_public_market_price_history/);
  assert.match(detailSource, /\.on\("broadcast", \{ event: "price_changed" \}/);
  assert.match(detailSource, /setInterval\([\s\S]+30000\)/);
  assert.match(detailSource, /data-price-point-date/);
  assert.match(detailSource, /data-price-chart-scrubber/);
  assert.match(detailSource, /market-price-combined-marker/);
  assert.match(detailSource, /data-market-empty-note/);
  assert.doesNotMatch(detailSource, /entry_percentage_input|base_benefit_estimated_input/);
  assert.match(homeSource, /data-market-load-retry/);
  assert.match(homeSource, /No mostraremos datos de prueba/);
  assert.doesNotMatch(homeSource, /Mostrando mercados de prueba|getFallbackMarkets/);
  assert.doesNotMatch(detailHtml, /data\.js/);
  assert.doesNotMatch(indexHtml, /data\.js/);
  assert.doesNotMatch(indexHtml, /Mercados de prueba/i);
  assert.equal(existsSync(join(repositoryRoot, "data.js")), false);
});

test("una invitada no recibe saldo ni progreso de cuenta simulados", () => {
  const htmlFiles = [
    "index.html",
    "market-detail.html",
    "community.html",
    "ranking.html",
    "profile.html",
    "my-predictions.html",
    "admin-resolution.html",
    "admin-community.html"
  ];
  const authSource = readFileSync(join(repositoryRoot, "auth.js"), "utf8");
  const homeSource = readFileSync(join(repositoryRoot, "script.js"), "utf8");

  htmlFiles.forEach((fileName) => {
    const html = readFileSync(join(repositoryRoot, fileName), "utf8");
    assert.doesNotMatch(html, /Karma disponible: 1\.000/);
    assert.doesNotMatch(html, /data-profile-karma>1\.000/);
    assert.match(html, /data-auth-private hidden/);
  });

  assert.match(
    authSource,
    /querySelectorAll\("\[data-auth-private\]"\)[\s\S]+node\.hidden = !isAuthenticated/
  );
  assert.match(homeSource, /if \(!currentAuthState\?\.isAuthenticated\)/);
  assert.match(homeSource, /Consulta tu Prestigio, rango y progreso/);
});
