import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";
import { chromium } from "@playwright/test";

const root = resolve(import.meta.dirname, "..");
const chrome = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const mime = {
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
};
const fixtureHtml = `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Atinara · Prueba de mercado vivo</title>
  <link rel="stylesheet" href="/styles.css">
</head>
<body>
  <main class="page-shell">
    <div id="market-detail-root" aria-live="polite"></div>
    <section id="market-comments-section" hidden></section>
  </main>
  <dialog id="prediction-modal" aria-labelledby="prediction-modal-title">
    <button id="prediction-modal-close" type="button">Cerrar</button>
    <span id="prediction-modal-check"></span>
    <p class="eyebrow"></p>
    <h2 id="prediction-modal-title"></h2>
    <div id="prediction-modal-description"></div>
    <p class="prototype-warning"></p>
    <a id="prediction-modal-primary" href="#"></a>
    <button id="prediction-modal-ok" type="button">Cerrar</button>
  </dialog>
  <script src="/market-detail.js"></script>
</body>
</html>`;

function statSafe(path) {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

const server = createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url || "/", "http://127.0.0.1").pathname);
  if (pathname === "/__live-market-test__.html") {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(fixtureHtml);
    return;
  }
  if (pathname === "/favicon.ico") {
    response.writeHead(204);
    response.end();
    return;
  }

  const file = normalize(join(root, pathname.replace(/^\/+/, "")));
  if (!file.startsWith(root) || !statSafe(file)) {
    response.writeHead(404);
    response.end("Not found");
    return;
  }
  response.writeHead(200, { "content-type": mime[extname(file)] || "application/octet-stream" });
  response.end(readFileSync(file));
});

await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
const address = server.address();
if (!address || typeof address === "string") throw new Error("LIVE_MARKET_BROWSER_PORT_UNAVAILABLE");

function initializeMockRuntime({ viewportName, historyMode = "single" }) {
  const startAt = Date.parse("2026-08-26T17:55:32.000Z");
  const state = {
    viewportName,
    version: 0,
    yesProbability: 0.5,
    noProbability: 0.5,
    karmaTotal: 0,
    participants: 0,
    lastQuote: null,
    profiles: {
      yes: { id: "10000000-0000-4000-8000-000000000001", username: "test-yes", karma: 1377, prestige: 20, rank: "Observador" },
      no: { id: "10000000-0000-4000-8000-000000000002", username: "test-no", karma: 1600, prestige: 20, rank: "Observador" },
    },
    activeProfileKey: "yes",
    predictedUsers: [],
    history: [{
      recorded_at: new Date(startAt).toISOString(),
      yes_percent: 50,
      no_percent: 50,
      market_version: 0,
    }],
  };
  const authListeners = [];

  if (historyMode === "same-timestamp") {
    state.version = 2;
    state.yesProbability = 0.55;
    state.noProbability = 0.45;
    state.karmaTotal = 20;
    state.participants = 2;
    state.history = [
      { recorded_at: new Date(startAt).toISOString(), yes_percent: 50, no_percent: 50, market_version: 0 },
      { recorded_at: new Date(startAt).toISOString(), yes_percent: 60, no_percent: 40, market_version: 1 },
      { recorded_at: new Date(startAt).toISOString(), yes_percent: 55, no_percent: 45, market_version: 2 },
    ];
  }
  if (historyMode === "out-of-order") {
    state.version = 2;
    state.yesProbability = 0.55;
    state.noProbability = 0.45;
    state.karmaTotal = 20;
    state.participants = 2;
    state.history = [
      { recorded_at: new Date(startAt + 120_000).toISOString(), yes_percent: 55, no_percent: 45, market_version: 2 },
      { recorded_at: new Date(startAt).toISOString(), yes_percent: 50, no_percent: 50, market_version: 0 },
      { recorded_at: new Date(startAt + 60_000).toISOString(), yes_percent: 60, no_percent: 40, market_version: 1 },
    ];
  }

  function activeProfile() {
    return state.profiles[state.activeProfileKey];
  }

  function getMarketSnapshot() {
    return {
      id: "test-live-market",
      pregunta: "¿Funcionará correctamente el gráfico del mercado vivo?",
      categoria: "Eventos",
      estado: "Abierto",
      porcentajeSi: state.yesProbability * 100,
      porcentajeNo: state.noProbability * 100,
      dificultad: "Normal",
      karmaTotal: state.karmaTotal,
      participantes: state.participants,
      comentarios: 0,
      cierre: "30 días",
      fechaCierreIso: "2026-09-30T21:59:59.000Z",
      descripcion: "Fixture aislado para comprobar la interfaz real sin persistir datos.",
      fuenteResolucion: "Fuente de prueba",
      criterioSi: "Sí cuando se cumpla.",
      criterioNo: "No cuando no se cumpla.",
      casoLimite: "Sin casos ambiguos.",
      fuentesResolucion: [],
      resultadoResolucion: null,
      notaResolucion: null,
      modeloResolucionIa: null,
      versionMercado: state.version,
      tienePredicciones: state.participants > 0,
    };
  }

  function calculateQuote(option, amount) {
    const selectedProbability = option === "Sí"
      ? state.yesProbability
      : state.noProbability;
    const growth = Math.exp(amount / 2000);
    const shares = 2000 * Math.log(
      (growth - (1 - selectedProbability)) / selectedProbability
    );
    const selectedAfter = 1 - ((1 - selectedProbability) / growth);
    const yesAfter = option === "Sí" ? selectedAfter : 1 - selectedAfter;
    const averagePrice = (amount / shares) * 100;
    const maxAllowed = Math.min(1000, Math.floor(activeProfile().karma));
    return {
      market_id: "test-live-market",
      pricing_model: "lmsr_v1",
      market_version: state.version,
      option_selected: option,
      karma_risked: amount,
      max_karma_allowed: maxAllowed,
      current_price_percentage: selectedProbability * 100,
      average_entry_price_percentage: averagePrice,
      post_trade_price_percentage: selectedAfter * 100,
      yes_price_after_percentage: yesAfter * 100,
      no_price_after_percentage: (1 - yesAfter) * 100,
      price_impact_points: (selectedAfter - selectedProbability) * 100,
      contract_shares: shares,
      base_return_estimated: shares,
      base_benefit_estimated: Math.max(shares - amount, 0),
      option_difficulty: "Normal",
      difficulty_bonus_estimated: amount * 0.05,
      total_return_estimated: shares + amount * 0.05,
      prestige_if_hit: 20,
      prestige_if_miss: -5,
      quoted_at: new Date(startAt + state.version * 60_000).toISOString(),
    };
  }

  const rpc = async (name, parameters = {}) => {
    if (name === "get_public_market_by_id") return { data: [{}], error: null };
    if (name === "get_public_market_price_history") {
      return { data: state.history.map((point) => ({ ...point })), error: null };
    }
    if (name === "get_prediction_quote") {
      const amount = Number(parameters.karma_risked_input);
      const maxAllowed = Math.min(1000, Math.floor(activeProfile().karma));
      if (amount > maxAllowed) return { data: null, error: { message: "MAX_KARMA_EXCEEDED" } };
      const quote = calculateQuote(parameters.option_selected_input, amount);
      state.lastQuote = quote;
      return { data: quote, error: null };
    }
    if (name === "place_prediction") {
      const profile = activeProfile();
      const amount = Number(parameters.karma_risked_input);
      if (state.predictedUsers.includes(profile.id)) {
        return { data: null, error: { message: "PREDICTION_ALREADY_EXISTS" } };
      }
      if (Number(parameters.quote_version_input) !== state.version) {
        return { data: null, error: { message: "PRICE_MOVED" } };
      }
      if (amount > Math.min(1000, Math.floor(profile.karma))) {
        return { data: null, error: { message: "MAX_KARMA_EXCEEDED" } };
      }

      const quote = calculateQuote(parameters.option_selected_input, amount);
      const priceBefore = parameters.option_selected_input === "Sí"
        ? state.yesProbability * 100
        : state.noProbability * 100;
      state.yesProbability = quote.yes_price_after_percentage / 100;
      state.noProbability = quote.no_price_after_percentage / 100;
      state.version += 1;
      state.karmaTotal += amount;
      state.participants += 1;
      state.predictedUsers.push(profile.id);
      profile.karma -= amount;
      state.history.push({
        recorded_at: new Date(startAt + state.version * 60_000).toISOString(),
        yes_percent: state.yesProbability * 100,
        no_percent: state.noProbability * 100,
        market_version: state.version,
      });

      return {
        data: {
          prediction: {
            option_selected: parameters.option_selected_input,
            option_difficulty: "Normal",
            karma_risked: amount,
            contract_shares: quote.contract_shares,
            base_return_estimated: quote.base_return_estimated,
            base_benefit_estimated: quote.base_benefit_estimated,
            difficulty_bonus_estimated: quote.difficulty_bonus_estimated,
            entry_price_percentage: quote.average_entry_price_percentage,
            market_price_before_percentage: priceBefore,
            market_price_after_percentage: quote.post_trade_price_percentage,
            market_version_before: state.version - 1,
            market_version_after: state.version,
            prestige_if_hit: 20,
            prestige_if_miss: -5,
          },
          profile: { ...profile },
          market_price: {
            yes_price_percentage: state.yesProbability * 100,
            no_price_percentage: state.noProbability * 100,
            market_version: state.version,
            recorded_at: state.history.at(-1).recorded_at,
          },
        },
        error: null,
      };
    }
    return { data: null, error: { message: `UNEXPECTED_RPC:${name}` } };
  };

  window.__testState = state;
  window.__switchTestUser = (profileKey) => {
    state.activeProfileKey = profileKey;
    const authState = window.orakloAuth.getState();
    authListeners.forEach((listener) => listener(authState));
  };
  window.mapMarketFromSupabase = getMarketSnapshot;
  window.getOrakloMarketTiming = () => ({
    isOpen: true,
    isClosed: false,
    isResolved: false,
    effectiveStatus: "Abierto",
    label: "30 días",
    exactLabel: "30 sep 2026, 23:59",
  });
  window.formatOrakloLocalDate = (value) => new Date(value).toISOString();
  window.atinaraUi = {
    formatKarmaAmount(value) {
      return `${new Intl.NumberFormat("es-ES", { maximumFractionDigits: 2 }).format(Number(value) || 0)} Karma`;
    },
  };
  window.orakloAuth = {
    getState() {
      return { ready: true, isAuthenticated: true, profile: { ...activeProfile() } };
    },
    async requireAuth() {
      return this.getState();
    },
    onChange(listener) {
      authListeners.push(listener);
      return () => {};
    },
    applyProfileSnapshot(profile) {
      Object.assign(activeProfile(), profile);
    },
    openAuthModal() {},
  };
  window.orakloSupabase = {
    rpc,
    channel() {
      const channel = {
        on() { return channel; },
        subscribe() { return channel; },
      };
      return channel;
    },
    removeChannel() {},
  };
}

async function runViewport(browser, viewport, viewportName) {
  const context = await browser.newContext({ viewport });
  await context.addInitScript(initializeMockRuntime, { viewportName });
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") pageErrors.push(message.text());
  });

  await page.goto(
    `http://127.0.0.1:${address.port}/__live-market-test__.html?id=test-live-market`,
    { waitUntil: "domcontentloaded" }
  );
  await page.waitForSelector(".market-price-chart");
  await page.waitForFunction(() => window.__testState.lastQuote?.karma_risked === 10);

  assert.equal(await page.locator("#karma-amount").getAttribute("max"), "1000");
  assert.match(await page.locator(".input-limit").innerText(), /Máx\. (?:1\.000|1000) Karma/);
  assert.equal(await page.locator(".market-price-combined-marker-yes").getAttribute("cx"), "46");
  assert.equal(await page.locator(".market-price-combined-marker-yes").getAttribute("cy"), "122");
  assert.equal(await page.locator(".market-price-line").count(), 0);
  assert.equal(await page.locator("[data-price-chart-scrubber]").isDisabled(), true);
  assert.match(await page.locator(".market-price-chart").getAttribute("aria-label"), /Sí 50.*No 50/);

  await page.locator("[data-amount='max']").click();
  await page.waitForFunction(() => window.__testState.lastQuote?.karma_risked === 1000);
  await page.locator("#confirm-prediction").click();
  await page.waitForFunction(() => window.__testState.history.length === 2);
  await page.waitForSelector("#prediction-modal[open]");
  assert.match(await page.locator("#prediction-modal-title").innerText(), /confirmada correctamente/);
  await page.locator("#prediction-modal-ok").click();

  const afterYes = await page.evaluate(() => ({
    yes: window.__testState.yesProbability * 100,
    no: window.__testState.noProbability * 100,
  }));
  assert.ok(afterYes.yes > 50);
  assert.ok(afterYes.no < 50);
  assert.ok(Math.abs(afterYes.yes + afterYes.no - 100) < 0.000001);
  assert.deepEqual(
    (await page.locator("polyline.market-price-line-yes").getAttribute("points"))
      .split(" ").map((pair) => Number(pair.split(",")[0])),
    [46, 696]
  );

  await page.evaluate(() => window.__switchTestUser("no"));
  await page.locator("[data-option='no']").click();
  await page.locator("[data-amount='max']").click();
  await page.waitForFunction(() => (
    window.__testState.lastQuote?.option_selected === "No"
    && window.__testState.lastQuote?.karma_risked === 1000
  ));
  await page.locator("#confirm-prediction").click();
  await page.waitForFunction(() => window.__testState.history.length === 3);
  await page.waitForSelector("#prediction-modal[open]");
  await page.locator("#prediction-modal-ok").click();

  const afterNo = await page.evaluate(() => ({
    yes: window.__testState.yesProbability * 100,
    no: window.__testState.noProbability * 100,
    versions: window.__testState.history.map((point) => point.market_version),
  }));
  assert.ok(afterNo.yes < afterYes.yes);
  assert.ok(afterNo.no > afterYes.no);
  assert.ok(Math.abs(afterNo.yes + afterNo.no - 100) < 0.000001);
  assert.deepEqual(afterNo.versions, [0, 1, 2]);

  const yesCoordinates = (await page.locator("polyline.market-price-line-yes").getAttribute("points"))
    .split(" ").map((pair) => pair.split(",").map(Number));
  const noCoordinates = (await page.locator("polyline.market-price-line-no").getAttribute("points"))
    .split(" ").map((pair) => pair.split(",").map(Number));
  assert.deepEqual(yesCoordinates.map(([x]) => x), [46, 371, 696]);
  assert.deepEqual(noCoordinates.map(([x]) => x), [46, 371, 696]);
  assert.ok(yesCoordinates[1][1] < yesCoordinates[0][1]);
  assert.ok(yesCoordinates[2][1] > yesCoordinates[1][1]);
  assert.ok(noCoordinates[1][1] > noCoordinates[0][1]);
  assert.ok(noCoordinates[2][1] < noCoordinates[1][1]);

  const scrubber = page.locator("[data-price-chart-scrubber]");
  assert.equal(await scrubber.getAttribute("max"), "2");
  assert.equal(await scrubber.isDisabled(), false);
  await scrubber.evaluate((node) => {
    node.value = "1";
    node.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const expectedMiddleYes = await page.evaluate(() => window.__testState.history[1].yes_percent);
  assert.match(
    await page.locator("[data-price-tooltip-yes]").innerText(),
    new RegExp(`Sí ${expectedMiddleYes.toLocaleString("es-ES", { maximumFractionDigits: 2 }).replace(",", "\\,")}`)
  );

  const visualState = await page.evaluate(() => {
    const yesLine = document.querySelector("polyline.market-price-line-yes");
    const noLine = document.querySelector("polyline.market-price-line-no");
    const chart = document.querySelector(".market-price-chart");
    const shell = document.querySelector(".market-price-chart-shell");
    return {
      yesStroke: getComputedStyle(yesLine).stroke,
      noStroke: getComputedStyle(noLine).stroke,
      chartWidth: chart.getBoundingClientRect().width,
      shellWidth: shell.getBoundingClientRect().width,
      pageWidth: document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth,
    };
  });
  assert.notEqual(visualState.yesStroke, visualState.noStroke);
  assert.ok(visualState.chartWidth <= visualState.shellWidth + 1);
  assert.ok(visualState.pageWidth <= visualState.viewportWidth + 1);
  assert.deepEqual(pageErrors, []);

  const screenshotDirectory = process.env.ATINARA_LIVE_MARKET_SCREENSHOT_DIR;
  if (screenshotDirectory) {
    mkdirSync(screenshotDirectory, { recursive: true });
    await page.screenshot({
      path: join(screenshotDirectory, `live-market-${viewportName}.png`),
      fullPage: true,
    });
  }

  await context.close();
  return { viewportName, afterYes, afterNo };
}

async function runHistoryGeometryScenario(browser, historyMode) {
  const context = await browser.newContext({ viewport: { width: 900, height: 800 } });
  await context.addInitScript(initializeMockRuntime, { viewportName: historyMode, historyMode });
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") pageErrors.push(message.text());
  });
  await page.goto(
    `http://127.0.0.1:${address.port}/__live-market-test__.html?id=test-live-market`,
    { waitUntil: "domcontentloaded" }
  );
  await page.waitForSelector("polyline.market-price-line-yes");

  const coordinates = (await page.locator("polyline.market-price-line-yes").getAttribute("points"))
    .split(" ").map((pair) => pair.split(",").map(Number));
  assert.deepEqual(coordinates.map(([x]) => x), [46, 371, 696]);
  assert.deepEqual(
    await page.locator("[data-price-point-yes]").evaluateAll((nodes) => (
      nodes.map((node) => Number(node.dataset.pricePointYes))
    )),
    [50, 60, 55]
  );
  assert.match(await page.locator(".market-price-chart").getAttribute("aria-label"), /Sí 55.*No 45/);
  assert.deepEqual(pageErrors, []);
  await context.close();
  return { historyMode, x: coordinates.map(([x]) => x) };
}

const browser = await chromium.launch({ executablePath: chrome, headless: true });
try {
  const results = [];
  results.push(await runViewport(browser, { width: 1440, height: 1000 }, "desktop"));
  results.push(await runViewport(browser, { width: 320, height: 900 }, "mobile-320"));
  results.push(await runHistoryGeometryScenario(browser, "same-timestamp"));
  results.push(await runHistoryGeometryScenario(browser, "out-of-order"));
  process.stdout.write(`LIVE_MARKET_BROWSER_OK ${JSON.stringify(results)}\n`);
} finally {
  await browser.close();
  await new Promise((resolveClose) => server.close(resolveClose));
}
