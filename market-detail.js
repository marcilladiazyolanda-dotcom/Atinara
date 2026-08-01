const detailRoot = document.querySelector("#market-detail-root");
const detailCommentsSection = document.querySelector("#market-comments-section");
const predictionModal = document.querySelector("#prediction-modal");
const predictionModalCheck = document.querySelector("#prediction-modal-check");
const predictionModalEyebrow = document.querySelector("#prediction-modal .eyebrow");
const predictionModalTitle = document.querySelector("#prediction-modal-title");
const predictionModalSummary = document.querySelector("#prediction-modal-description");
const predictionModalWarning = document.querySelector("#prediction-modal .prototype-warning");
const predictionModalPrimary = document.querySelector("#prediction-modal-primary");
const predictionModalClose = document.querySelector("#prediction-modal-close");
const predictionModalOk = document.querySelector("#prediction-modal-ok");

const predictionState = {
  option: "si",
  amount: 50
};

const predictionRules = {
  minKarma: 10,
  maxBeta: 500,
  maxNormalRatio: 0.2
};

const priceHistoryRanges = [
  { id: "1h", label: "1 h" },
  { id: "6h", label: "6 h" },
  { id: "24h", label: "24 h" },
  { id: "7d", label: "7 d" },
  { id: "all", label: "Todo" }
];

const predictionQuoteState = {
  status: "idle",
  key: "",
  quote: null,
  error: "",
  timer: null,
  requestId: 0
};

const priceHistoryState = {
  range: "24h",
  points: [],
  status: "idle",
  error: ""
};

let detailDataWarning = "";
let currentMarket = null;
let detailClockTimer = null;
let detailCloseRefreshRequested = false;
let detailCommentsAnchorHandled = false;
let marketPriceChannel = null;
let marketPricePollTimer = null;
let marketPriceRefreshPromise = null;
let marketPriceRefreshQueued = false;

function formatNumber(value) {
  return new Intl.NumberFormat("es-ES").format(Number(value) || 0);
}

function escapeDetailHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function getSafeResolutionUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "https:" ? url.href : "";
  } catch (_error) {
    return "";
  }
}

function createResolutionSourcesMarkup(market) {
  const sources = Array.isArray(market.fuentesResolucion)
    ? market.fuentesResolucion
    : [];
  const sourceItems = sources.map((source) => {
    const url = getSafeResolutionUrl(source.url);
    if (!url) return "";

    const citedText = source.citedText
      ? `<p>${escapeDetailHtml(source.citedText)}</p>`
      : "";

    return `
      <li class="resolution-source-item">
        <a href="${escapeDetailHtml(url)}" target="_blank" rel="noopener noreferrer">
          ${escapeDetailHtml(source.title || "Consultar fuente")}
          <span aria-hidden="true">↗</span>
        </a>
        ${citedText}
      </li>
    `;
  }).filter(Boolean).join("");

  if (!sourceItems) return "";

  const reviewLabel = market.modeloResolucionIa
    ? "Análisis asistido por IA y aprobado por una persona."
    : "Fuentes comprobadas durante la revisión humana.";

  return `
    <div class="resolution-evidence">
      <dt>Motivos y fuentes verificadas</dt>
      <dd>
        <p class="resolution-review-label">${reviewLabel}</p>
        <ul class="resolution-source-list">${sourceItems}</ul>
      </dd>
    </div>
  `;
}

function formatKarma(value) {
  return `${formatNumber(Math.round(Number(value) || 0))} Karma`;
}

function formatPercentage(value, maximumFractionDigits = 1) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  return new Intl.NumberFormat("es-ES", {
    minimumFractionDigits: 0,
    maximumFractionDigits
  }).format(number);
}

function formatSignedPoints(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  const formatted = formatPercentage(Math.abs(number), 2);
  if (number > 0) return `+${formatted} puntos`;
  if (number < 0) return `−${formatted} puntos`;
  return "0 puntos";
}

function getQueryMarketId() {
  return new URLSearchParams(window.location.search).get("id");
}

function getDisplayUser() {
  const authState = window.orakloAuth?.getState?.() || {};
  const authProfile = authState.profile;

  return {
    isAuthenticated: Boolean(authState.isAuthenticated),
    karma: authState.isAuthenticated ? Number(authProfile?.karma ?? 0) : null,
    prestige: authState.isAuthenticated ? Number(authProfile?.prestige ?? 0) : null,
    rank: authState.isAuthenticated ? authProfile?.rank || "Observador" : "Invitada"
  };
}

function getMarketTiming(market, now = Date.now()) {
  return window.getOrakloMarketTiming(market, now);
}

function getMarketStatusLabel(market, now = Date.now()) {
  const timing = getMarketTiming(market, now);
  if (timing.isResolved && market.resultadoResolucion) {
    return `Resuelto · ${market.resultadoResolucion}`;
  }
  return timing.effectiveStatus;
}

function normalizeRpcMarket(data) {
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof window.mapMarketFromSupabase !== "function") {
    return null;
  }

  return window.mapMarketFromSupabase(row);
}

async function loadMarketFromSupabase(marketId) {
  if (!window.orakloSupabase || typeof window.mapMarketFromSupabase !== "function") {
    throw new Error("Supabase no está disponible.");
  }

  const { data, error } = await window.orakloSupabase.rpc("get_public_market_by_id", {
    market_id_input: marketId
  });

  if (error) {
    throw error;
  }

  const market = normalizeRpcMarket(data);
  if (!market) {
    throw new Error("Mercado no encontrado.");
  }

  return market;
}

function normalizePriceHistory(data) {
  return (Array.isArray(data) ? data : [])
    .map((row) => ({
      recordedAt: row.recorded_at,
      yesPercent: Number(row.yes_percent),
      noPercent: Number(row.no_percent),
      marketVersion: Number(row.market_version)
    }))
    .filter((point) => (
      point.recordedAt
      && Number.isFinite(point.yesPercent)
      && Number.isFinite(point.noPercent)
      && Number.isFinite(point.marketVersion)
    ));
}

async function loadMarketPriceHistory(marketId, range = priceHistoryState.range) {
  if (!window.orakloSupabase) {
    throw new Error("MARKET_PRICE_UNAVAILABLE");
  }

  const { data, error } = await window.orakloSupabase.rpc(
    "get_public_market_price_history",
    {
      market_id_input: marketId,
      range_input: range
    }
  );

  if (error) throw error;
  return normalizePriceHistory(data);
}

function getStatusClass(status) {
  const classes = {
    "Abierto": "status-open",
    "Cerrado": "status-closed",
    "Resuelto": "status-resolved"
  };

  return classes[status] || "status-open";
}

function getDifficultyClass(difficulty) {
  const classes = {
    "Fácil": "difficulty-easy",
    "Normal": "difficulty-normal",
    "Difícil": "difficulty-hard",
    "Muy difícil": "difficulty-very-hard",
    "Épica": "difficulty-epic"
  };

  return classes[difficulty] || "difficulty-normal";
}

function getDifficultyFromPercentage(percentage) {
  if (percentage >= 70) return "Fácil";
  if (percentage >= 50) return "Normal";
  if (percentage >= 30) return "Difícil";
  if (percentage >= 15) return "Muy difícil";
  return "Épica";
}

function getMaxKarma() {
  const displayUser = getDisplayUser();
  if (!displayUser.isAuthenticated) {
    return predictionRules.maxBeta;
  }

  const availableKarma = Math.max(0, Math.floor(displayUser.karma));
  return Math.max(
    0,
    Math.min(
      Math.floor(availableKarma * predictionRules.maxNormalRatio),
      predictionRules.maxBeta,
      availableKarma
    )
  );
}

function clampKarma(value) {
  const maxKarma = getMaxKarma();
  if (maxKarma < predictionRules.minKarma) return maxKarma;

  const parsed = Number(value);
  if (Number.isNaN(parsed)) return predictionRules.minKarma;
  return Math.min(Math.max(Math.floor(parsed), predictionRules.minKarma), maxKarma);
}

function getOptionData(market, option) {
  const percentage = option === "si" ? market.porcentajeSi : market.porcentajeNo;
  const label = option === "si" ? "Sí" : "No";
  const difficulty = getDifficultyFromPercentage(percentage);

  return { label, percentage, difficulty };
}

function getChartPointCoordinates(points, valueKey) {
  const width = 720;
  const height = 260;
  const padding = { top: 18, right: 24, bottom: 34, left: 46 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  const timestamps = points.map((point) => new Date(point.recordedAt).getTime());
  const minimumTime = Math.min(...timestamps);
  const maximumTime = Math.max(...timestamps);
  const timeSpan = Math.max(1, maximumTime - minimumTime);

  return points.map((point, index) => {
    const timestamp = timestamps[index];
    const x = points.length === 1
      ? padding.left + chartWidth / 2
      : padding.left + ((timestamp - minimumTime) / timeSpan) * chartWidth;
    const value = Math.min(100, Math.max(0, Number(point[valueKey])));
    const y = padding.top + ((100 - value) / 100) * chartHeight;
    return {
      x: Number(x.toFixed(2)),
      y: Number(y.toFixed(2)),
      value,
      point
    };
  });
}

function createPriceSeriesMarkup(points, valueKey, className, label) {
  const coordinates = getChartPointCoordinates(points, valueKey);
  if (coordinates.length === 0) return "";

  const polyline = coordinates.length > 1
    ? `<polyline class="market-price-line ${className}" points="${coordinates.map((item) => `${item.x},${item.y}`).join(" ")}" />`
    : "";
  const last = coordinates.at(-1);
  const dateLabel = typeof window.formatOrakloLocalDate === "function"
    ? window.formatOrakloLocalDate(last.point.recordedAt)
    : last.point.recordedAt;

  return `
    ${polyline}
    <circle class="market-price-dot ${className}" cx="${last.x}" cy="${last.y}" r="5">
      <title>${label} ${formatPercentage(last.value, 2)} % · ${escapeDetailHtml(dateLabel)}</title>
    </circle>
  `;
}

function getPricePointDateLabel(point) {
  if (typeof window.formatOrakloLocalDate === "function") {
    return window.formatOrakloLocalDate(point.recordedAt);
  }
  return point.recordedAt;
}

function createPriceInteractionMarkup(points) {
  const coordinates = getChartPointCoordinates(points, "yesPercent");
  if (coordinates.length === 0) return "";

  const maximumInteractivePoints = 60;
  const step = Math.max(1, Math.ceil(coordinates.length / maximumInteractivePoints));

  return coordinates
    .filter((_item, index) => index % step === 0 || index === coordinates.length - 1)
    .map(({ x, y, point }) => {
      const dateLabel = getPricePointDateLabel(point);
      const accessibleLabel = `${dateLabel}. Sí ${formatPercentage(point.yesPercent, 2)} por ciento. No ${formatPercentage(point.noPercent, 2)} por ciento.`;

      return `
        <circle
          class="market-price-hit-area"
          cx="${x}"
          cy="${y}"
          r="11"
          aria-hidden="true"
          data-price-point-date="${escapeDetailHtml(dateLabel)}"
          data-price-point-yes="${point.yesPercent}"
          data-price-point-no="${point.noPercent}"
        >
          <title>${escapeDetailHtml(accessibleLabel)}</title>
        </circle>
      `;
    })
    .join("");
}

function createPriceChartMarkup(market) {
  if (priceHistoryState.status === "loading") {
    return '<div class="market-price-chart-state" role="status">Actualizando evolución real…</div>';
  }

  if (priceHistoryState.status === "error") {
    return `
      <div class="market-price-chart-state market-price-chart-error" role="status">
        <span>No se ha podido cargar el histórico.</span>
        <button type="button" class="secondary-button" data-price-history-retry>Reintentar</button>
      </div>
    `;
  }

  const points = priceHistoryState.points;
  if (points.length === 0) {
    return '<div class="market-price-chart-state">El histórico real todavía no tiene puntos disponibles.</div>';
  }

  const latest = points.at(-1);
  const accessibleLabel = `Evolución real. Último precio: Sí ${formatPercentage(latest.yesPercent, 2)} por ciento y No ${formatPercentage(latest.noPercent, 2)} por ciento.`;
  const singlePointNote = points.length === 1
    ? '<p class="market-price-single-note">Solo existe el punto inicial; la línea aparecerá con el primer movimiento real.</p>'
    : "";
  const latestDateLabel = getPricePointDateLabel(latest);

  return `
    <div class="market-price-chart-shell">
      <svg class="market-price-chart" viewBox="0 0 720 260" role="img" aria-label="${escapeDetailHtml(accessibleLabel)}" preserveAspectRatio="none">
        <g class="market-price-grid" aria-hidden="true">
          <line x1="46" y1="18" x2="696" y2="18"></line>
          <line x1="46" y1="122" x2="696" y2="122"></line>
          <line x1="46" y1="226" x2="696" y2="226"></line>
          <text x="8" y="23">100 %</text>
          <text x="16" y="127">50 %</text>
          <text x="25" y="231">0 %</text>
        </g>
        ${createPriceSeriesMarkup(points, "yesPercent", "market-price-line-yes", "Sí")}
        ${createPriceSeriesMarkup(points, "noPercent", "market-price-line-no", "No")}
        ${createPriceInteractionMarkup(points)}
      </svg>
      <input
        class="market-price-scrubber"
        type="range"
        min="0"
        max="${Math.max(0, points.length - 1)}"
        value="${Math.max(0, points.length - 1)}"
        step="1"
        data-price-chart-scrubber
        aria-label="Explorar los puntos del histórico de precios"
        ${points.length === 1 ? "disabled" : ""}
      >
      <div class="market-price-tooltip" data-price-chart-tooltip aria-live="polite">
        <span data-price-tooltip-date>${escapeDetailHtml(latestDateLabel)}</span>
        <strong data-price-tooltip-yes>Sí ${formatPercentage(latest.yesPercent, 2)} %</strong>
        <strong data-price-tooltip-no>No ${formatPercentage(latest.noPercent, 2)} %</strong>
      </div>
      ${singlePointNote}
    </div>
  `;
}

function createLivePriceMarkup(market) {
  const timing = getMarketTiming(market);
  const historyStart = market.inicioHistorialPrecio && typeof window.formatOrakloLocalDate === "function"
    ? window.formatOrakloLocalDate(market.inicioHistorialPrecio)
    : "la activación del mercado vivo";
  const liveLabel = timing.isOpen ? "Precio vivo" : "Histórico congelado";

  return `
    <section class="market-price-card" id="market-price-card" aria-labelledby="market-price-title">
      <div class="market-price-heading">
        <div>
          <p class="eyebrow" id="market-price-title">Evolución del mercado</p>
          <p class="market-price-live-state${timing.isOpen ? " is-live" : ""}">
            <span aria-hidden="true"></span>${liveLabel}
          </p>
        </div>
        <div class="market-price-current" aria-live="polite">
          <span class="market-price-current-yes">Sí <strong data-current-yes-price>${formatPercentage(market.porcentajeSi, 2)} %</strong></span>
          <span class="market-price-current-no">No <strong data-current-no-price>${formatPercentage(market.porcentajeNo, 2)} %</strong></span>
        </div>
      </div>
      <div class="market-price-legend" aria-hidden="true">
        <span class="market-price-legend-yes">Sí</span>
        <span class="market-price-legend-no">No</span>
      </div>
      ${createPriceChartMarkup(market)}
      <div class="market-price-ranges" role="group" aria-label="Periodo del histórico">
        ${priceHistoryRanges.map((range) => `
          <button type="button" data-price-range="${range.id}" aria-pressed="${priceHistoryState.range === range.id}">${range.label}</button>
        `).join("")}
      </div>
      <p class="market-price-history-note">Histórico real disponible desde ${escapeDetailHtml(historyStart)}. Sin movimientos simulados.</p>
    </section>
  `;
}

function createResolutionMarkup(market) {
  const timing = getMarketTiming(market);
  const resolutionDate = market.fechaResolucion && typeof window.formatOrakloLocalDate === "function"
    ? window.formatOrakloLocalDate(market.fechaResolucion)
    : market.fechaResolucion || "";
  let outcomeRows = "";
  let evidenceRows = "";

  if (market.resultadoResolucion) {
    outcomeRows += `<div class="resolution-outcome"><dt>Resultado oficial</dt><dd>${escapeDetailHtml(market.resultadoResolucion)}</dd></div>`;
    if (market.notaResolucion) {
      outcomeRows += `<div><dt>Explicación de la resolución</dt><dd>${escapeDetailHtml(market.notaResolucion)}</dd></div>`;
    }
    if (resolutionDate) {
      outcomeRows += `<div><dt>Fecha de resolución</dt><dd>${escapeDetailHtml(resolutionDate)}</dd></div>`;
    }
    evidenceRows = createResolutionSourcesMarkup(market);
  } else if (timing.isClosed) {
    outcomeRows = '<div class="resolution-pending"><dt>Estado de resolución</dt><dd>Pendiente de resolución</dd></div>';
  } else if (timing.isResolved) {
    outcomeRows = '<div class="resolution-pending"><dt>Resultado oficial</dt><dd>No disponible</dd></div>';
  }

  return `
    <dl class="resolution-list">
      ${outcomeRows}
      ${evidenceRows}
      <div><dt>Fuente de resolución</dt><dd>${escapeDetailHtml(market.fuenteResolucion)}</dd></div>
      <div><dt>Criterio de Sí</dt><dd>${escapeDetailHtml(market.criterioSi)}</dd></div>
      <div><dt>Criterio de No</dt><dd>${escapeDetailHtml(market.criterioNo)}</dd></div>
      <div><dt>Caso dudoso</dt><dd>${escapeDetailHtml(market.casoDudoso)}</dd></div>
    </dl>
  `;
}

function renderLoadingState() {
  if (detailCommentsSection) detailCommentsSection.hidden = true;
  detailRoot.innerHTML = `
    <section class="not-found-card loading-detail-card">
      <p class="eyebrow">Detalle de mercado</p>
      <h1>Cargando mercado...</h1>
      <p>Consultando métricas públicas en Supabase.</p>
    </section>
  `;
}

function renderNotFound() {
  currentMarket = null;
  stopDetailClock();
  if (detailCommentsSection) detailCommentsSection.hidden = true;
  detailRoot.innerHTML = `
    <section class="not-found-card">
      <p class="eyebrow">Detalle de mercado</p>
      <h1>Mercado no encontrado</h1>
      <p>No hemos encontrado un mercado con ese identificador.</p>
      <a class="primary-button" href="index.html">Volver a explorar mercados</a>
    </section>
  `;
}

function renderDataError() {
  currentMarket = null;
  stopDetailClock();
  stopMarketPriceUpdates();
  if (detailCommentsSection) detailCommentsSection.hidden = true;
  detailRoot.innerHTML = `
    <section class="not-found-card" role="alert">
      <p class="eyebrow">Conexión no disponible</p>
      <h1>No se ha podido cargar el mercado</h1>
      <p>No mostraremos datos de prueba. Reintenta la conexión para consultar la información real de Atinara.</p>
      <button class="primary-button" type="button" data-detail-retry>Reintentar</button>
      <a class="secondary-button" href="index.html">Volver a mercados</a>
    </section>
  `;
  detailRoot.querySelector("[data-detail-retry]")?.addEventListener("click", initializeMarketDetail);
}

function renderDetail(market) {
  currentMarket = market;
  if (detailCommentsSection) {
    detailCommentsSection.hidden = false;
    if (window.location.hash === "#market-comments-section" && !detailCommentsAnchorHandled) {
      detailCommentsAnchorHandled = true;
      window.requestAnimationFrame(() => {
        detailCommentsSection.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    }
  }
  const displayUser = getDisplayUser();
  const maxKarma = getMaxKarma();
  const hasEnoughKarma = maxKarma >= predictionRules.minKarma;
  const timing = getMarketTiming(market);
  const participationDisabled = !timing.isOpen || !hasEnoughKarma;
  predictionState.amount = hasEnoughKarma
    ? clampKarma(predictionState.amount || predictionRules.minKarma)
    : 0;
  const noPredictionsNotice = market.tienePredicciones
    ? ""
    : '<p class="market-empty-note" data-market-empty-note>Todavía no hay movimientos reales. El mercado comienza en 50 % / 50 %.</p>';
  const disabledNote = timing.isResolved
    ? "Este mercado está resuelto. La participación queda desactivada."
    : timing.isClosed
      ? "Este mercado está cerrado y pendiente de resolución."
      : !hasEnoughKarma
        ? "Tu saldo actual no permite alcanzar el mínimo de 10 Karma con el límite del 20 %."
        : "";

  detailRoot.innerHTML = `
    <section class="detail-hero" aria-labelledby="detail-title">
      <div>
        <div class="featured-meta">
          <span class="tag">${escapeDetailHtml(market.categoria)}</span>
          <span class="status ${getStatusClass(timing.effectiveStatus)}" data-detail-market-status>${getMarketStatusLabel(market)}</span>
          <span class="difficulty ${getDifficultyClass(market.dificultad)}">Dificultad: ${escapeDetailHtml(market.dificultad)}</span>
        </div>
        <h1 id="detail-title">${escapeDetailHtml(market.pregunta)}</h1>
        <p class="detail-description">${escapeDetailHtml(market.descripcion)}</p>
      </div>
      <div class="detail-hero-card">
        <span>${displayUser.isAuthenticated ? "Estado de la cuenta" : "Acceso"}</span>
        <strong>${escapeDetailHtml(displayUser.rank)}</strong>
        ${displayUser.isAuthenticated
          ? `<small>Prestigio: ${formatNumber(displayUser.prestige)}</small><small>Karma disponible: ${formatNumber(displayUser.karma)}</small>`
          : "<small>Inicia sesión para consultar tu Karma y confirmar.</small>"}
      </div>
    </section>

    <p class="data-source-warning detail-source-warning" data-detail-source-warning${detailDataWarning ? "" : " hidden"}>${escapeDetailHtml(detailDataWarning)}</p>

    <section class="detail-notices" aria-label="Avisos importantes">
      <p><strong>Privacidad:</strong> Tu predicción activa será privada hasta que el mercado se resuelva.</p>
      <p><strong>Prototipo:</strong> Sin dinero real, sin compra de Karma y sin Modo Real.</p>
      <p><strong>Resolución:</strong> El Karma se descuenta al confirmar. Cada contrato acertado liquida a 1 Karma, se añade por separado el bonus de dificultad y el Prestigio nunca baja de 0. Si se anula, se devuelve todo el Karma y no cambia el Prestigio.</p>
    </section>

    <div class="detail-layout">
      <aside class="prediction-panel" aria-labelledby="prediction-heading">
        <p class="eyebrow">Participación</p>
        <h2 id="prediction-heading">Hacer predicción</h2>
        <p class="panel-copy">El precio se mueve con el Karma participante. Tu cotización incluye el impacto antes de confirmar.</p>

        <div class="option-grid" role="group" aria-label="Seleccionar opción">
          ${createOptionButton(market, "si", participationDisabled)}
          ${createOptionButton(market, "no", participationDisabled)}
        </div>

        <div class="karma-input-block">
          <label for="karma-amount">Karma utilizado</label>
          <div class="karma-input-row">
            <input id="karma-amount" type="number" min="${hasEnoughKarma ? predictionRules.minKarma : 0}" max="${maxKarma}" step="10" value="${predictionState.amount}"${participationDisabled ? " disabled" : ""}>
            <span class="input-limit">Máx. ${formatNumber(maxKarma)}</span>
          </div>
          <div class="quick-amounts" aria-label="Cantidades rápidas">
            <button type="button" data-amount="10"${participationDisabled || maxKarma < 10 ? " disabled" : ""}>10 K</button>
            <button type="button" data-amount="50"${participationDisabled || maxKarma < 50 ? " disabled" : ""}>50 K</button>
            <button type="button" data-amount="100"${participationDisabled || maxKarma < 100 ? " disabled" : ""}>100 K</button>
            <button type="button" data-amount="max"${participationDisabled ? " disabled" : ""}>Máx.</button>
          </div>
        </div>

        <div class="estimate-card" id="estimate-card"></div>
        <button class="primary-button confirm-button" id="confirm-prediction" type="button"${participationDisabled ? " disabled" : ""}>Confirmar predicción</button>
        <p class="disabled-note" data-market-disabled-note${disabledNote ? "" : " hidden"}>${disabledNote}</p>
      </aside>

      <section class="detail-main">
        <article class="detail-card">
          <h2>Información del mercado</h2>
          ${createLivePriceMarkup(market)}
          ${noPredictionsNotice}
          <div class="detail-stat-grid">
            <div class="stat"><span>Karma total</span><strong data-detail-karma-total>${formatNumber(market.karmaTotal)}</strong></div>
            <div class="stat"><span>Participantes</span><strong data-detail-participants>${formatNumber(market.participantes)}</strong></div>
            <div class="stat"><span>Comentarios</span><strong data-detail-comment-count>${formatNumber(market.comentarios)}</strong></div>
            <div class="stat detail-close-stat">
              <span>Cierre</span>
              <strong data-detail-market-countdown>${timing.label}</strong>
              <small data-detail-market-exact${timing.exactLabel ? "" : " hidden"}>${timing.exactLabel}</small>
            </div>
          </div>
        </article>

        <article class="detail-card">
          <h2>Resolución</h2>
          ${createResolutionMarkup(market)}
        </article>

      </section>
    </div>
  `;

  const detailMain = detailRoot.querySelector(".detail-main");
  if (detailMain && detailCommentsSection) {
    detailMain.append(detailCommentsSection);
  }

  bindDetailEvents(market);
  bindPriceHistoryEvents();
  renderEstimate(market);
  if (timing.isOpen && hasEnoughKarma) {
    ensurePredictionQuote(market);
  }
  updateDetailClock();
}

function createOptionButton(market, optionId, disabled = false) {
  const option = getOptionData(market, optionId);
  const selected = predictionState.option === optionId;

  return `
    <button class="option-button${selected ? " is-selected" : ""}" type="button" data-option="${optionId}" aria-pressed="${selected}"${disabled ? " disabled" : ""}>
      <span>${option.label}</span>
      <strong data-option-price>${formatPercentage(option.percentage, 2)} %</strong>
      <small data-option-difficulty>Orientación actual: ${option.difficulty}</small>
      <small>Precio vivo antes de impacto</small>
    </button>
  `;
}

function getPredictionQuoteKey(market) {
  const option = getOptionData(market, predictionState.option);
  const amount = clampKarma(predictionState.amount);
  return `${market.id}:${market.versionMercado}:${option.label}:${amount}`;
}

function normalizePredictionQuote(data) {
  const quote = Array.isArray(data) ? data[0] : data;
  if (!quote || typeof quote !== "object") return null;

  return {
    marketId: quote.market_id,
    pricingModel: quote.pricing_model || "lmsr_v1",
    marketVersion: Number(quote.market_version),
    option: {
      label: quote.option_selected,
      currentPrice: Number(quote.current_price_percentage),
      averagePrice: Number(quote.average_entry_price_percentage),
      postTradePrice: Number(quote.post_trade_price_percentage),
      difficulty: quote.option_difficulty
    },
    amount: Number(quote.karma_risked),
    maxKarmaAllowed: Number(quote.max_karma_allowed),
    priceImpact: Number(quote.price_impact_points),
    contractShares: Number(quote.contract_shares),
    baseReturn: Number(quote.base_return_estimated),
    baseBenefit: Number(quote.base_benefit_estimated),
    bonus: Number(quote.difficulty_bonus_estimated),
    returnTotal: Number(quote.total_return_estimated),
    prestigeHit: Number(quote.prestige_if_hit),
    prestigeMiss: Number(quote.prestige_if_miss),
    quotedAt: quote.quoted_at
  };
}

async function requestPredictionQuoteNow(market) {
  if (!market || !getMarketTiming(market).isOpen) return null;

  const option = getOptionData(market, predictionState.option);
  const amount = clampKarma(predictionState.amount);
  if (amount < predictionRules.minKarma) return null;

  const key = getPredictionQuoteKey(market);
  const requestId = predictionQuoteState.requestId + 1;
  predictionQuoteState.requestId = requestId;
  predictionQuoteState.status = "loading";
  predictionQuoteState.key = key;
  predictionQuoteState.error = "";
  renderEstimate(market);

  try {
    const { data, error } = await window.orakloSupabase.rpc(
      "get_prediction_quote",
      {
        market_id_input: market.id,
        option_selected_input: option.label,
        karma_risked_input: amount
      }
    );

    if (error) throw error;
    const quote = normalizePredictionQuote(data);
    if (!quote) throw new Error("MARKET_PRICE_UNAVAILABLE");

    if (requestId !== predictionQuoteState.requestId || key !== getPredictionQuoteKey(market)) {
      return null;
    }

    predictionQuoteState.status = "ready";
    predictionQuoteState.quote = quote;
    predictionQuoteState.error = "";
    renderEstimate(market);
    return quote;
  } catch (error) {
    if (requestId !== predictionQuoteState.requestId) return null;
    predictionQuoteState.status = "error";
    predictionQuoteState.quote = null;
    predictionQuoteState.error = getFriendlyPredictionError(getPredictionErrorKey(error));
    renderEstimate(market);
    return null;
  }
}

function schedulePredictionQuote(market, delay = 250) {
  if (predictionQuoteState.timer !== null) {
    window.clearTimeout(predictionQuoteState.timer);
  }

  predictionQuoteState.status = "loading";
  predictionQuoteState.quote = null;
  predictionQuoteState.key = getPredictionQuoteKey(market);
  predictionQuoteState.error = "";
  renderEstimate(market);
  predictionQuoteState.timer = window.setTimeout(() => {
    predictionQuoteState.timer = null;
    requestPredictionQuoteNow(market);
  }, delay);
}

function ensurePredictionQuote(market) {
  const key = getPredictionQuoteKey(market);
  if (predictionQuoteState.status === "ready" && predictionQuoteState.key === key) {
    return Promise.resolve(predictionQuoteState.quote);
  }
  return requestPredictionQuoteNow(market);
}

function renderEstimate(market) {
  const card = document.querySelector("#estimate-card");
  const input = document.querySelector("#karma-amount");
  const confirmButton = document.querySelector("#confirm-prediction");
  if (!card) return;

  if (input) {
    input.value = clampKarma(predictionState.amount);
  }

  if (!getMarketTiming(market).isOpen) {
    if (confirmButton) confirmButton.disabled = true;
    card.removeAttribute("aria-busy");
    card.innerHTML = `
      <p class="eyebrow">Cotización cerrada</p>
      <p>El histórico permanece visible, pero ya no se admiten nuevas participaciones.</p>
    `;
    return;
  }

  if (getMaxKarma() < predictionRules.minKarma) {
    if (confirmButton) confirmButton.disabled = true;
    card.removeAttribute("aria-busy");
    card.innerHTML = `
      <p class="eyebrow">Karma insuficiente</p>
      <p>Tu límite actual no alcanza el mínimo de 10 Karma.</p>
    `;
    return;
  }

  const key = getPredictionQuoteKey(market);
  const quoteIsCurrent = predictionQuoteState.key === key;
  if (predictionQuoteState.status === "loading" && quoteIsCurrent) {
    if (confirmButton) confirmButton.disabled = true;
    card.setAttribute("aria-busy", "true");
    card.innerHTML = `
      <p class="eyebrow">Cotización autoritativa</p>
      <p class="quote-loading" role="status">Calculando precio medio e impacto real…</p>
    `;
    return;
  }

  if (predictionQuoteState.status === "error" && quoteIsCurrent) {
    if (confirmButton) confirmButton.disabled = true;
    card.removeAttribute("aria-busy");
    card.innerHTML = `
      <p class="eyebrow">Cotización no disponible</p>
      <p class="quote-error" role="status">${escapeDetailHtml(predictionQuoteState.error)}</p>
      <button type="button" class="secondary-button quote-retry" data-quote-retry>Reintentar cálculo</button>
    `;
    card.querySelector("[data-quote-retry]")?.addEventListener("click", () => {
      requestPredictionQuoteNow(market);
    });
    return;
  }

  const estimate = quoteIsCurrent ? predictionQuoteState.quote : null;
  if (!estimate) {
    if (confirmButton) confirmButton.disabled = true;
    card.setAttribute("aria-busy", "true");
    card.innerHTML = `
      <p class="eyebrow">Cotización autoritativa</p>
      <p class="quote-loading" role="status">Preparando cálculo…</p>
    `;
    return;
  }

  card.removeAttribute("aria-busy");
  if (confirmButton) confirmButton.disabled = false;
  card.innerHTML = `
    <p class="eyebrow">Cotización autoritativa</p>
    <dl class="estimate-list">
      <div><dt>Opción elegida</dt><dd>${estimate.option.label}</dd></div>
      <div><dt>Karma utilizado</dt><dd>${formatKarma(estimate.amount)}</dd></div>
      <div><dt>Precio antes de participar</dt><dd>${formatPercentage(estimate.option.currentPrice, 2)} %</dd></div>
      <div><dt>Impacto de esta participación</dt><dd>+${formatPercentage(estimate.priceImpact, 2)} puntos</dd></div>
      <div><dt>Precio medio de entrada</dt><dd>${formatPercentage(estimate.option.averagePrice, 2)} %</dd></div>
      <div><dt>Precio después de participar</dt><dd>${formatPercentage(estimate.option.postTradePrice, 2)} %</dd></div>
      <div><dt>Contratos obtenidos</dt><dd>${formatPercentage(estimate.contractShares, 2)}</dd></div>
      <div><dt>Retorno base si acierta</dt><dd>${formatKarma(estimate.baseReturn)}</dd></div>
      <div><dt>Beneficio base estimado</dt><dd>${formatKarma(estimate.baseBenefit)}</dd></div>
      <div><dt>Bonus por dificultad</dt><dd>+${formatKarma(estimate.bonus)}</dd></div>
      <div><dt>Retorno total estimado</dt><dd>${formatKarma(estimate.returnTotal)}</dd></div>
      <div><dt>Dificultad de entrada</dt><dd>${escapeDetailHtml(estimate.option.difficulty)}</dd></div>
      <div><dt>Prestigio posible si acierta</dt><dd>+${estimate.prestigeHit}</dd></div>
      <div><dt>Prestigio si falla</dt><dd>${estimate.prestigeMiss}</dd></div>
    </dl>
    <p class="privacy-note">La cotización no reserva el precio. Si el mercado cambia antes de confirmar, Atinara te pedirá revisar el nuevo cálculo. La predicción quedará bloqueada hasta la resolución.</p>
  `;
}

function bindDetailEvents(market) {
  document.querySelectorAll("[data-option]").forEach((button) => {
    button.addEventListener("click", () => {
      predictionState.option = button.dataset.option;
      renderDetail(currentMarket || market);
    });
  });

  const amountInput = document.querySelector("#karma-amount");
  amountInput?.addEventListener("input", (event) => {
    predictionState.amount = clampKarma(event.target.value);
    schedulePredictionQuote(currentMarket || market);
  });

  document.querySelectorAll("[data-amount]").forEach((button) => {
    button.addEventListener("click", () => {
      const value = button.dataset.amount === "max" ? getMaxKarma() : button.dataset.amount;
      predictionState.amount = clampKarma(value);
      schedulePredictionQuote(currentMarket || market, 0);
    });
  });

  const confirmButton = document.querySelector("#confirm-prediction");
  confirmButton?.addEventListener("click", () => {
    const activeMarket = currentMarket || market;
    if (!getMarketTiming(activeMarket).isOpen) return;
    handleConfirmPrediction(activeMarket);
  });
}

function getPlacePredictionParams(market, quote) {
  return {
    market_id_input: market.id,
    option_selected_input: quote.option.label,
    karma_risked_input: Math.round(quote.amount),
    quote_version_input: quote.marketVersion,
    max_entry_price_input: Number(quote.option.averagePrice.toFixed(4))
  };
}

function normalizePlacePredictionResult(data) {
  const result = Array.isArray(data) ? data[0] : data;
  return {
    prediction: Array.isArray(result?.prediction) ? result.prediction[0] : result?.prediction || null,
    profile: Array.isArray(result?.profile) ? result.profile[0] : result?.profile || null,
    marketPrice: result?.market_price || null
  };
}

function getAuthoritativeEstimate(prediction, fallbackEstimate) {
  if (!prediction) return fallbackEstimate;

  const amount = Number(prediction.karma_risked ?? fallbackEstimate.amount);
  const baseBenefit = Number(
    prediction.base_benefit_estimated ?? fallbackEstimate.baseBenefit
  );
  const bonus = Number(
    prediction.difficulty_bonus_estimated ?? fallbackEstimate.bonus
  );
  const baseReturn = Number(
    prediction.base_return_estimated ?? amount + baseBenefit
  );
  const entryPrice = Number(
    prediction.entry_price_percentage
      ?? prediction.entry_percentage
      ?? fallbackEstimate.option.averagePrice
  );
  const priceBefore = Number(
    prediction.market_price_before_percentage
      ?? fallbackEstimate.option.currentPrice
  );
  const priceAfter = Number(
    prediction.market_price_after_percentage
      ?? fallbackEstimate.option.postTradePrice
  );

  return {
    option: {
      label: prediction.option_selected || fallbackEstimate.option.label,
      currentPrice: priceBefore,
      averagePrice: entryPrice,
      postTradePrice: priceAfter,
      difficulty: prediction.option_difficulty || fallbackEstimate.option.difficulty
    },
    amount,
    marketVersion: Number(
      prediction.market_version_before ?? fallbackEstimate.marketVersion
    ),
    priceImpact: priceAfter - priceBefore,
    contractShares: Number(
      prediction.contract_shares ?? fallbackEstimate.contractShares
    ),
    baseReturn,
    baseBenefit,
    bonus,
    returnTotal: baseReturn + bonus,
    prestigeHit: Number(prediction.prestige_if_hit ?? fallbackEstimate.prestigeHit),
    prestigeMiss: Number(prediction.prestige_if_miss ?? fallbackEstimate.prestigeMiss)
  };
}

async function placePredictionWithSupabase(market, estimate) {
  if (!window.orakloSupabase) {
    throw new Error("SUPABASE_UNAVAILABLE");
  }

  const { data, error } = await window.orakloSupabase.rpc(
    "place_prediction",
    getPlacePredictionParams(market, estimate)
  );

  if (error) {
    throw error;
  }

  return normalizePlacePredictionResult(data);
}

function getPredictionErrorKey(error) {
  const errorText = [error?.code, error?.message, error?.details, error?.hint]
    .filter(Boolean)
    .join(" ")
    .toUpperCase();
  const knownErrors = [
    "PREDICTION_ALREADY_EXISTS",
    "INSUFFICIENT_KARMA",
    "MAX_KARMA_EXCEEDED",
    "MARKET_NOT_OPEN",
    "AUTH_REQUIRED",
    "PROFILE_NOT_FOUND",
    "MARKET_NOT_FOUND",
    "MARKET_PRICE_UNAVAILABLE",
    "MIN_KARMA_REQUIRED",
    "INVALID_OPTION",
    "INVALID_QUOTE",
    "PRICE_MOVED",
    "SUPABASE_UNAVAILABLE"
  ];

  const knownError = knownErrors.find((key) => errorText.includes(key));
  if (knownError) return knownError;
  if (error?.code === "23505") return "PREDICTION_ALREADY_EXISTS";
  return "UNKNOWN";
}

function getFriendlyPredictionError(errorKey) {
  const messages = {
    PREDICTION_ALREADY_EXISTS: "Ya tienes una predicción registrada en este mercado.",
    INSUFFICIENT_KARMA: "No tienes Karma suficiente para esta predicción.",
    MAX_KARMA_EXCEEDED: "La cantidad supera el máximo permitido para tu saldo actual.",
    MARKET_NOT_OPEN: "Este mercado ya no está abierto.",
    AUTH_REQUIRED: "Inicia sesión para confirmar tu predicción.",
    PROFILE_NOT_FOUND: "No se ha encontrado tu perfil. Cierra sesión y vuelve a entrar.",
    MARKET_NOT_FOUND: "Este mercado ya no está disponible.",
    MARKET_PRICE_UNAVAILABLE: "No se puede calcular el precio vivo ahora mismo. Reinténtalo en unos instantes.",
    MIN_KARMA_REQUIRED: "La cantidad mínima por predicción es 10 Karma.",
    INVALID_OPTION: "Elige Sí o No antes de confirmar tu predicción.",
    INVALID_QUOTE: "La cotización ya no es válida. Revisa el nuevo cálculo antes de confirmar.",
    PRICE_MOVED: "El precio ha cambiado. Revisa la nueva cotización antes de confirmar.",
    SUPABASE_UNAVAILABLE: "No se puede conectar con Supabase ahora mismo. Inténtalo de nuevo en unos instantes.",
    UNKNOWN: "No se ha podido confirmar la predicción. Inténtalo de nuevo."
  };

  return messages[errorKey] || messages.UNKNOWN;
}

function validatePredictionBeforeSave(market, estimate, auth) {
  if (!predictionState.option || !["si", "no"].includes(predictionState.option)) {
    return getFriendlyPredictionError("INVALID_OPTION");
  }

  if (!getMarketTiming(market).isOpen) {
    return getFriendlyPredictionError("MARKET_NOT_OPEN");
  }

  const amount = Number(estimate.amount);
  if (!Number.isFinite(amount) || amount < predictionRules.minKarma) {
    return getFriendlyPredictionError("MIN_KARMA_REQUIRED");
  }

  const availableKarma = Math.max(0, Math.floor(Number(auth?.profile?.karma) || 0));
  const maxAllowed = Math.min(
    Math.floor(availableKarma * predictionRules.maxNormalRatio),
    predictionRules.maxBeta
  );

  if (amount > availableKarma) {
    return getFriendlyPredictionError("INSUFFICIENT_KARMA");
  }

  if (amount > maxAllowed) {
    return getFriendlyPredictionError("MAX_KARMA_EXCEEDED");
  }

  return "";
}

async function syncProfileAfterPrediction(profile) {
  if (profile && typeof window.orakloAuth?.applyProfileSnapshot === "function") {
    window.orakloAuth.applyProfileSnapshot(profile);
  }

  if (typeof window.refreshOrakloProfile === "function") {
    return window.refreshOrakloProfile();
  }

  return window.orakloAuth?.refreshProfile?.();
}

async function refreshMarketAfterPrediction(market) {
  try {
    const [refreshedMarket, history] = await Promise.all([
      loadMarketFromSupabase(market.id),
      loadMarketPriceHistory(market.id)
    ]);
    detailDataWarning = "";
    priceHistoryState.points = history;
    priceHistoryState.status = "ready";
    priceHistoryState.error = "";
    renderDetail(refreshedMarket);
    return refreshedMarket;
  } catch (_error) {
    detailDataWarning = "La predicción se ha guardado, pero las métricas no han podido actualizarse todavía.";
    renderDetail(market);
    return market;
  }
}

async function refreshMarketAfterClosure(market) {
  try {
    const refreshedMarket = await loadMarketFromSupabase(market.id);
    detailDataWarning = "";
    renderDetail(refreshedMarket);
    return refreshedMarket;
  } catch (_error) {
    detailDataWarning = "El mercado se ha cerrado en pantalla, pero no se ha podido sincronizar de nuevo con Supabase.";
    renderDetail(market);
    return market;
  }
}

function invalidatePredictionQuote() {
  predictionQuoteState.requestId += 1;
  predictionQuoteState.status = "idle";
  predictionQuoteState.key = "";
  predictionQuoteState.quote = null;
  predictionQuoteState.error = "";
  if (predictionQuoteState.timer !== null) {
    window.clearTimeout(predictionQuoteState.timer);
    predictionQuoteState.timer = null;
  }
}

function renderLivePriceSurface() {
  if (!currentMarket) return;
  const currentCard = document.querySelector("#market-price-card");
  if (currentCard) {
    currentCard.outerHTML = createLivePriceMarkup(currentMarket);
    bindPriceHistoryEvents();
  }

  if (currentMarket.tienePredicciones) {
    document.querySelector("[data-market-empty-note]")?.remove();
  }

  const yesButton = document.querySelector('[data-option="si"]');
  const noButton = document.querySelector('[data-option="no"]');
  [
    [yesButton, currentMarket.porcentajeSi],
    [noButton, currentMarket.porcentajeNo]
  ].forEach(([button, percentage]) => {
    if (!button) return;
    const priceNode = button.querySelector("[data-option-price]");
    const difficultyNode = button.querySelector("[data-option-difficulty]");
    if (priceNode) priceNode.textContent = `${formatPercentage(percentage, 2)} %`;
    if (difficultyNode) {
      difficultyNode.textContent = `Orientación actual: ${getDifficultyFromPercentage(percentage)}`;
    }
  });

  const karmaNode = document.querySelector("[data-detail-karma-total]");
  const participantNode = document.querySelector("[data-detail-participants]");
  if (karmaNode) karmaNode.textContent = formatNumber(currentMarket.karmaTotal);
  if (participantNode) participantNode.textContent = formatNumber(currentMarket.participantes);
  syncDetailDataWarning();
}

function syncDetailDataWarning() {
  const warningNode = document.querySelector("[data-detail-source-warning]");
  if (!warningNode) return;
  warningNode.textContent = detailDataWarning;
  warningNode.hidden = !detailDataWarning;
}

async function loadSelectedPriceHistory() {
  if (!currentMarket) return;
  priceHistoryState.status = "loading";
  priceHistoryState.error = "";
  renderLivePriceSurface();

  try {
    priceHistoryState.points = await loadMarketPriceHistory(
      currentMarket.id,
      priceHistoryState.range
    );
    priceHistoryState.status = "ready";
  } catch (_error) {
    priceHistoryState.status = "error";
    priceHistoryState.error = "No se ha podido cargar el histórico.";
  }

  renderLivePriceSurface();
}

function bindPriceHistoryEvents() {
  document.querySelectorAll("[data-price-range]").forEach((button) => {
    button.addEventListener("click", () => {
      const nextRange = button.dataset.priceRange;
      if (!priceHistoryRanges.some((range) => range.id === nextRange)) return;
      if (priceHistoryState.range === nextRange && priceHistoryState.status === "ready") return;
      priceHistoryState.range = nextRange;
      loadSelectedPriceHistory();
    });
  });

  document.querySelector("[data-price-history-retry]")?.addEventListener(
    "click",
    loadSelectedPriceHistory
  );

  const tooltip = document.querySelector("[data-price-chart-tooltip]");
  const tooltipDate = tooltip?.querySelector("[data-price-tooltip-date]");
  const tooltipYes = tooltip?.querySelector("[data-price-tooltip-yes]");
  const tooltipNo = tooltip?.querySelector("[data-price-tooltip-no]");
  const showPricePoint = (date, yes, no) => {
    if (!tooltipDate || !tooltipYes || !tooltipNo) return;
    tooltipDate.textContent = date || "Fecha no disponible";
    tooltipYes.textContent = `Sí ${formatPercentage(yes, 2)} %`;
    tooltipNo.textContent = `No ${formatPercentage(no, 2)} %`;
  };

  document.querySelectorAll("[data-price-point-date]").forEach((point) => {
    const showPoint = () => {
      showPricePoint(
        point.dataset.pricePointDate,
        point.dataset.pricePointYes,
        point.dataset.pricePointNo
      );
    };

    point.addEventListener("mouseenter", showPoint);
    point.addEventListener("click", showPoint);
  });

  document.querySelector("[data-price-chart-scrubber]")?.addEventListener(
    "input",
    (event) => {
      const point = priceHistoryState.points[Number(event.target.value)];
      if (!point) return;
      showPricePoint(
        getPricePointDateLabel(point),
        point.yesPercent,
        point.noPercent
      );
    }
  );
}

async function refreshMarketPriceData() {
  if (!currentMarket) return;
  if (marketPriceRefreshPromise) {
    marketPriceRefreshQueued = true;
    return marketPriceRefreshPromise;
  }

  const marketId = currentMarket.id;
  const previousVersion = currentMarket.versionMercado;
  marketPriceRefreshPromise = Promise.all([
    loadMarketFromSupabase(marketId),
    loadMarketPriceHistory(marketId, priceHistoryState.range)
  ])
    .then(([market, history]) => {
      currentMarket = market;
      priceHistoryState.points = history;
      priceHistoryState.status = "ready";
      priceHistoryState.error = "";
      detailDataWarning = "";
      renderLivePriceSurface();

      if (market.versionMercado !== previousVersion) {
        invalidatePredictionQuote();
        schedulePredictionQuote(market, 0);
      }
    })
    .catch(() => {
      detailDataWarning = "El precio vivo no ha podido comprobarse todavía. La última cotización visible se conserva sin simular cambios.";
      syncDetailDataWarning();
    })
    .finally(() => {
      marketPriceRefreshPromise = null;
      if (marketPriceRefreshQueued) {
        marketPriceRefreshQueued = false;
        refreshMarketPriceData();
      }
    });

  return marketPriceRefreshPromise;
}

function startMarketPriceUpdates(market) {
  stopMarketPriceUpdates();
  if (!window.orakloSupabase || !market) return;

  marketPriceChannel = window.orakloSupabase
    .channel(`market:${market.id}`)
    .on("broadcast", { event: "price_changed" }, (message) => {
      const payload = message?.payload || {};
      if (payload.market_id !== market.id) return;
      refreshMarketPriceData();
    })
    .subscribe();

  marketPricePollTimer = window.setInterval(() => {
    if (currentMarket && getMarketTiming(currentMarket).isOpen) {
      refreshMarketPriceData();
    }
  }, 30000);
}

function stopMarketPriceUpdates() {
  if (marketPricePollTimer !== null) {
    window.clearInterval(marketPricePollTimer);
    marketPricePollTimer = null;
  }
  if (marketPriceChannel && window.orakloSupabase) {
    window.orakloSupabase.removeChannel(marketPriceChannel);
  }
  marketPriceChannel = null;
}

function disablePredictionControls() {
  document
    .querySelectorAll("[data-option], #karma-amount, [data-amount], #confirm-prediction")
    .forEach((control) => {
      control.disabled = true;
    });
}

function updateDetailClock(now = Date.now()) {
  if (!currentMarket) return;

  const timing = getMarketTiming(currentMarket, now);
  const countdownNode = document.querySelector("[data-detail-market-countdown]");
  const exactDateNode = document.querySelector("[data-detail-market-exact]");
  const statusNode = document.querySelector("[data-detail-market-status]");
  const disabledNoteNode = document.querySelector("[data-market-disabled-note]");

  if (countdownNode) countdownNode.textContent = timing.label;
  if (exactDateNode) {
    exactDateNode.textContent = timing.exactLabel;
    exactDateNode.hidden = !timing.exactLabel;
  }
  if (statusNode) {
    statusNode.className = `status ${getStatusClass(timing.effectiveStatus)}`;
    statusNode.textContent = getMarketStatusLabel(currentMarket, now);
  }

  if (timing.isOpen) return;

  disablePredictionControls();
  if (disabledNoteNode) {
    disabledNoteNode.hidden = false;
    disabledNoteNode.textContent = timing.isResolved
      ? "Este mercado está resuelto. La participación queda desactivada."
      : "Este mercado está cerrado y pendiente de resolución.";
  }

  if (
    timing.isClosed &&
    currentMarket.estado === "Abierto" &&
    !detailCloseRefreshRequested
  ) {
    detailCloseRefreshRequested = true;
    currentMarket.estado = "Cerrado";
    refreshMarketAfterClosure(currentMarket);
  }
}

function startDetailClock() {
  stopDetailClock();
  updateDetailClock();
  detailClockTimer = window.setInterval(updateDetailClock, 1000);
}

function stopDetailClock() {
  if (detailClockTimer === null) return;
  window.clearInterval(detailClockTimer);
  detailClockTimer = null;
}

async function handleConfirmPrediction(market) {
  const auth = await window.orakloAuth?.requireAuth({
    message: "Inicia sesión para confirmar tu predicción."
  });

  if (!auth) return;

  const activeMarket = currentMarket || market;
  predictionState.amount = clampKarma(predictionState.amount);
  const quote = await requestPredictionQuoteNow(activeMarket);
  if (!quote) {
    openPredictionModal(
      activeMarket,
      "error",
      predictionQuoteState.error || getFriendlyPredictionError("MARKET_PRICE_UNAVAILABLE")
    );
    return;
  }

  const validationMessage = validatePredictionBeforeSave(activeMarket, quote, auth);
  if (validationMessage) {
    openPredictionModal(activeMarket, "error", validationMessage, { estimate: quote });
    return;
  }

  const confirmButton = document.querySelector("#confirm-prediction");
  const originalLabel = confirmButton.textContent;
  confirmButton.disabled = true;
  confirmButton.textContent = "Confirmando...";

  try {
    const result = await placePredictionWithSupabase(activeMarket, quote);
    const authoritativeEstimate = getAuthoritativeEstimate(result.prediction, quote);
    await syncProfileAfterPrediction(result.profile);
    predictionState.amount = clampKarma(predictionState.amount);
    const refreshedMarket = await refreshMarketAfterPrediction(activeMarket);
    openPredictionModal(refreshedMarket, "saved", "", {
      estimate: authoritativeEstimate,
      prediction: result.prediction,
      remainingKarma: Number(result.profile?.karma)
    });
  } catch (error) {
    const errorKey = getPredictionErrorKey(error);

    if (errorKey === "AUTH_REQUIRED") {
      window.orakloAuth?.openAuthModal(getFriendlyPredictionError(errorKey));
      return;
    }

    let modalMarket = activeMarket;
    if (errorKey === "MARKET_NOT_OPEN") {
      detailCloseRefreshRequested = true;
      activeMarket.estado = "Cerrado";
      modalMarket = await refreshMarketAfterClosure(activeMarket);
    }

    let modalEstimate = quote;
    if (errorKey === "PRICE_MOVED" || errorKey === "INVALID_QUOTE") {
      const refreshedQuote = await requestPredictionQuoteNow(modalMarket);
      if (refreshedQuote) modalEstimate = refreshedQuote;
    }

    const mode = errorKey === "PREDICTION_ALREADY_EXISTS" ? "duplicate" : "error";
    openPredictionModal(modalMarket, mode, getFriendlyPredictionError(errorKey), {
      estimate: modalEstimate
    });
  } finally {
    const activeButton = document.querySelector("#confirm-prediction");
    if (activeButton) {
      activeButton.disabled = !currentMarket || !getMarketTiming(currentMarket).isOpen || getMaxKarma() < predictionRules.minKarma;
      activeButton.textContent = originalLabel;
    }
  }
}

function openPredictionModal(market, mode = "saved", errorMessage = "", context = {}) {
  const fallbackOption = getOptionData(market, predictionState.option);
  const fallbackEstimate = context.estimate || predictionQuoteState.quote || {
    option: {
      label: fallbackOption.label,
      currentPrice: fallbackOption.percentage,
      averagePrice: Number.NaN,
      postTradePrice: Number.NaN,
      difficulty: fallbackOption.difficulty
    },
    amount: clampKarma(predictionState.amount),
    priceImpact: Number.NaN,
    contractShares: Number.NaN,
    baseReturn: Number.NaN,
    baseBenefit: Number.NaN,
    bonus: Number.NaN,
    returnTotal: Number.NaN,
    prestigeHit: 0,
    prestigeMiss: 0
  };
  const estimate = mode === "saved"
    ? getAuthoritativeEstimate(context.prediction, fallbackEstimate)
    : fallbackEstimate;
  const hasCompleteQuote = Number.isFinite(Number(estimate.option?.averagePrice));
  const isSaved = mode === "saved";
  const isDuplicate = mode === "duplicate";
  const title = isSaved
    ? "Predicción confirmada correctamente"
    : isDuplicate
      ? "Ya tienes una predicción registrada en este mercado."
      : "No se ha podido guardar la predicción";

  predictionModalCheck.hidden = !isSaved;
  predictionModalEyebrow.textContent = isSaved ? "Predicción guardada" : "Aviso";
  predictionModalTitle.textContent = title;
  predictionModalPrimary.hidden = mode === "error";
  predictionModalPrimary.textContent = "Ver mis predicciones";
  predictionModalOk.textContent = "Cerrar";

  predictionModalSummary.innerHTML = `
    <dl class="estimate-list modal-estimate-list">
      <div><dt>Mercado</dt><dd>${escapeDetailHtml(market.pregunta)}</dd></div>
      <div><dt>Opción elegida</dt><dd>${escapeDetailHtml(estimate.option.label)}</dd></div>
      <div><dt>Karma utilizado</dt><dd>${formatKarma(estimate.amount)}</dd></div>
      ${hasCompleteQuote ? `
        <div><dt>Precio antes de participar</dt><dd>${formatPercentage(estimate.option.currentPrice, 2)} %</dd></div>
        <div><dt>Impacto de la participación</dt><dd>${formatSignedPoints(estimate.priceImpact)}</dd></div>
        <div><dt>Precio medio de entrada</dt><dd>${formatPercentage(estimate.option.averagePrice, 2)} %</dd></div>
        <div><dt>Contratos guardados</dt><dd>${formatPercentage(estimate.contractShares, 2)}</dd></div>
        <div><dt>Retorno base guardado</dt><dd>${formatKarma(estimate.baseReturn)}</dd></div>
        <div><dt>Beneficio base guardado</dt><dd>${formatKarma(estimate.baseBenefit)}</dd></div>
        <div><dt>Bonus de dificultad guardado</dt><dd>+${formatKarma(estimate.bonus)}</dd></div>
        <div><dt>Retorno total posible</dt><dd>${formatKarma(estimate.returnTotal)}</dd></div>
        <div><dt>Dificultad guardada</dt><dd>${escapeDetailHtml(estimate.option.difficulty)}</dd></div>
      ` : ""}
      ${isSaved ? `<div><dt>Karma restante</dt><dd>${formatKarma(context.remainingKarma)}</dd></div>` : ""}
      ${hasCompleteQuote ? `
        <div><dt>Prestigio posible si acierta</dt><dd>+${estimate.prestigeHit}</dd></div>
        <div><dt>Prestigio si falla</dt><dd>${estimate.prestigeMiss}</dd></div>
      ` : ""}
    </dl>
  `;

  predictionModalWarning.textContent = isSaved
    ? "Tu predicción se ha guardado y el Karma se ha descontado. Al resolverse, Atinara abonará automáticamente el retorno que corresponda y actualizará el Prestigio."
    : isDuplicate
      ? "Puedes revisar tu predicción existente en Mis predicciones."
      : errorMessage || "No se ha guardado ningún dato nuevo.";

  predictionModal.hidden = false;
  predictionModalOk.focus();
}

function closePredictionModal() {
  predictionModal.hidden = true;
}

predictionModalClose.addEventListener("click", closePredictionModal);
predictionModalOk.addEventListener("click", closePredictionModal);
predictionModal.addEventListener("click", (event) => {
  if (event.target === predictionModal) {
    closePredictionModal();
  }
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !predictionModal.hidden) {
    closePredictionModal();
  }
});

function bindAuthProfileUpdates() {
  window.orakloAuth?.onChange?.((auth) => {
    if (!auth.ready || !currentMarket) return;
    predictionState.amount = clampKarma(predictionState.amount);
    renderDetail(currentMarket);
  });
}

async function initializeMarketDetail() {
  const marketId = getQueryMarketId();
  if (!marketId) {
    renderNotFound();
    return;
  }

  renderLoadingState();
  predictionState.amount = predictionRules.minKarma;
  invalidatePredictionQuote();
  priceHistoryState.range = "24h";
  priceHistoryState.points = [];
  priceHistoryState.status = "loading";
  priceHistoryState.error = "";

  try {
    const market = await loadMarketFromSupabase(marketId);
    detailDataWarning = "";
    detailCloseRefreshRequested = false;

    try {
      priceHistoryState.points = await loadMarketPriceHistory(marketId);
      priceHistoryState.status = "ready";
    } catch (_historyError) {
      priceHistoryState.status = "error";
      priceHistoryState.error = "No se ha podido cargar el histórico.";
    }

    renderDetail(market);
    startDetailClock();
    startMarketPriceUpdates(market);
  } catch (error) {
    if (String(error?.message || "").includes("Mercado no encontrado")) {
      renderNotFound();
      return;
    }
    renderDataError();
  }
}

window.addEventListener("pagehide", () => {
  stopDetailClock();
  stopMarketPriceUpdates();
  invalidatePredictionQuote();
});
window.addEventListener("pageshow", (event) => {
  if (event.persisted && currentMarket) {
    startDetailClock();
    startMarketPriceUpdates(currentMarket);
    ensurePredictionQuote(currentMarket);
  }
});
bindAuthProfileUpdates();
initializeMarketDetail();
