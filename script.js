let categories = ["Todos"];

const stateFilters = [
  { id: "activos", label: "Abiertos" },
  { id: "cierran-pronto", label: "Cierran pronto" },
  { id: "populares", label: "Populares" },
  { id: "sin-movimiento", label: "Sin movimiento" },
  { id: "resueltos", label: "Resueltos" }
];

let markets = [];
let globalRankingUsers = [];
let seasonRankingUsers = [];
let homeRankingUsers = [];
let competitionStatus = null;
let rankLadder = [
  { posicion: 1, nombre: "Observador", prestigioMinimo: 0 },
  { posicion: 2, nombre: "Intérprete", prestigioMinimo: 100 },
  { posicion: 3, nombre: "Analista", prestigioMinimo: 250 },
  { posicion: 4, nombre: "Visionario", prestigioMinimo: 500 },
  { posicion: 5, nombre: "Oráculo", prestigioMinimo: 1000 }
];
let currentAuthState = null;
let publicActivity = null;
let marketClockTimer = null;
let marketDataRefreshTimer = null;
let expiryRefreshPromise = null;
let expiryRefreshPending = false;
let marketsUseSupabase = false;
let marketLoadFailed = false;
const expirySyncRequested = new Set();

const activeFilters = {
  category: "Todos",
  state: "activos",
  query: ""
};

const categoryFilterNode = document.querySelector("#category-filters");
const stateFilterNode = document.querySelector("#state-filters");
const marketListNode = document.querySelector("#market-list");
const resultCountNode = document.querySelector("#result-count");
const emptyStateNode = document.querySelector("#empty-state");
const featuredMarketNode = document.querySelector("#featured-market");
const leaderboardPanelNode = document.querySelector("#leaderboard-panel");
const homeRankingEyebrowNode = document.querySelector("#home-ranking-eyebrow");
const homeRankingTitleNode = document.querySelector("#home-ranking-title");
const competitionSnapshotLabelNode = document.querySelector("#competition-snapshot-label");
const competitionCurrentRankNode = document.querySelector("#competition-current-rank");
const competitionCurrentPrestigeNode = document.querySelector("#competition-current-prestige");
const rankProgressNoteNode = document.querySelector("#rank-progress-note");
const activityPanelNode = document.querySelector("#public-activity-panel");
const dataSourceWarningNode = document.querySelector("#data-source-warning");
const searchInput = document.querySelector("#market-search");
const clearButton = document.querySelector("#clear-filters");

function formatNumber(value) {
  return new Intl.NumberFormat("es-ES").format(Number(value) || 0);
}

function formatPercentage(value, maximumFractionDigits = 1) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  return new Intl.NumberFormat("es-ES", {
    maximumFractionDigits
  }).format(number);
}

function formatKarma(value, maximumFractionDigits = 0) {
  return window.atinaraUi?.formatKarmaAmount(value, { maximumFractionDigits })
    || `${formatNumber(value)} Karma`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
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

function createMarketTimingMarkup(market) {
  const timing = getMarketTiming(market);
  const encodedMarketId = encodeURIComponent(market.id);
  const exactDateMarkup = timing.exactLabel
    ? `<small class="market-exact-date" data-market-exact-date>${timing.exactLabel}</small>`
    : '<small class="market-exact-date" data-market-exact-date hidden></small>';

  return `
    <div class="market-timing" data-market-timing data-market-id="${encodedMarketId}" data-effective-status="${timing.effectiveStatus}">
      <p class="close-date" data-market-countdown>${timing.label}</p>
      ${exactDateMarkup}
    </div>
  `;
}

function getMarketUrl(market) {
  return `market-detail.html?id=${encodeURIComponent(market.id)}`;
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

function getStatusClass(status) {
  const classes = {
    "Abierto": "status-open",
    "Cerrado": "status-closed",
    "Resuelto": "status-resolved"
  };

  return classes[status] || "status-open";
}

function isDifficultMarket(market) {
  return ["Difícil", "Muy difícil", "Épica"].includes(market.dificultad);
}

function setDataSourceWarning(message) {
  if (!dataSourceWarningNode) return;
  dataSourceWarningNode.textContent = message;
  dataSourceWarningNode.hidden = !message;
}

async function loadMarketsFromSupabase() {
  if (!window.orakloSupabase || typeof window.mapMarketFromSupabase !== "function") {
    throw new Error("Supabase no está disponible.");
  }

  const { data, error } = await window.orakloSupabase.rpc("get_public_markets");

  if (error) {
    throw error;
  }

  return (data || []).map(window.mapMarketFromSupabase);
}

function mapLeaderboardUser(row) {
  return {
    id: row.id || row.user_id || row.profile_id || row.username,
    posicion: toNumber(row.position),
    username: row.username || row.display_name || "@Usuario",
    prestigio: toNumber(row.season_prestige ?? row.prestige ?? row.prestigio),
    prestigioHistorico: toNumber(row.lifetime_prestige ?? row.prestige ?? row.prestigio),
    rango: row.rank || row.rango || "Observador",
    mejorCategoria: row.best_category || row.mejor_categoria || "Pendiente",
    prediccionesResueltas: toNumber(row.resolved_predictions),
    aciertos: toNumber(row.correct_predictions),
    precision: toNumber(row.accuracy),
    siguienteRango: row.next_rank || null,
    prestigioRestante: toNumber(row.prestige_to_next_rank)
  };
}

async function loadGlobalLeaderboardFromSupabase() {
  if (!window.orakloSupabase) {
    throw new Error("Supabase no está disponible.");
  }

  const currentResult = await window.orakloSupabase.rpc("get_public_global_leaderboard", {
    limit_count: 10
  });

  if (!currentResult.error) {
    return (currentResult.data || []).map(mapLeaderboardUser);
  }

  const legacyResult = await window.orakloSupabase.rpc("get_public_leaderboard", {
    limit_count: 10
  });

  if (legacyResult.error) throw currentResult.error;
  return (legacyResult.data || []).map(mapLeaderboardUser).filter((user) => user.prestigio > 0);
}

async function loadSeasonLeaderboardFromSupabase() {
  if (!window.orakloSupabase) {
    throw new Error("Supabase no está disponible.");
  }

  const { data, error } = await window.orakloSupabase.rpc("get_public_season_leaderboard", {
    limit_count: 10
  });

  if (error) throw error;
  return (data || []).map(mapLeaderboardUser);
}

async function loadCompetitionStatusFromSupabase() {
  if (!window.orakloSupabase) {
    throw new Error("Supabase no está disponible.");
  }

  const { data, error } = await window.orakloSupabase.rpc("get_public_competition_status");
  if (error) throw error;
  return Array.isArray(data) ? data[0] || null : data;
}

async function loadRankLadderFromSupabase() {
  if (!window.orakloSupabase) {
    throw new Error("Supabase no está disponible.");
  }

  const { data, error } = await window.orakloSupabase.rpc("get_public_rank_ladder");
  if (error) throw error;
  return (data || []).map((rank) => ({
    posicion: toNumber(rank.position),
    nombre: rank.name,
    prestigioMinimo: toNumber(rank.min_prestige),
    descripcion: rank.description || ""
  }));
}

function mapPublicActivity(row) {
  return {
    registeredUsers: toNumber(row?.registered_users),
    activePredictions: toNumber(row?.active_predictions),
    openMarkets: toNumber(row?.open_markets)
  };
}

async function loadActivityFromSupabase() {
  if (!window.orakloSupabase) {
    throw new Error("Supabase no está disponible.");
  }

  const { data, error } = await window.orakloSupabase.rpc("get_public_activity");

  if (error) {
    throw error;
  }

  return mapPublicActivity(Array.isArray(data) ? data[0] : data);
}

function getFilteredMarkets() {
  const query = normalizeText(activeFilters.query.trim());
  let filtered = markets.filter((market) => {
    const effectiveStatus = getMarketTiming(market).effectiveStatus;
    const matchesCategory =
      activeFilters.category === "Todos" || market.categoria === activeFilters.category;
    const searchable = normalizeText(
      `${market.pregunta} ${market.categoria} ${effectiveStatus} ${market.resultadoResolucion || ""}`
    );
    const matchesQuery = query.length === 0 || searchable.includes(query);

    return matchesCategory && matchesQuery;
  });

  if (activeFilters.state === "activos") {
    filtered = filtered.filter((market) => getMarketTiming(market).isOpen);
  }

  if (activeFilters.state === "cierran-pronto") {
    filtered = filtered
      .filter((market) => {
        const timing = getMarketTiming(market);
        return timing.isOpen && timing.hasCloseDate;
      })
      .sort((a, b) => getMarketTiming(a).closeTimestamp - getMarketTiming(b).closeTimestamp);
  }

  if (activeFilters.state === "populares") {
    filtered = filtered
      .filter((market) => getMarketTiming(market).isOpen)
      .sort((a, b) => b.popularidad - a.popularidad);
  }

  if (activeFilters.state === "sin-movimiento") {
    filtered = filtered.filter((market) =>
      getMarketTiming(market).isOpen && toNumber(market.prediccionesReales) === 0
    );
  }

  if (activeFilters.state === "dificiles") {
    filtered = filtered
      .filter((market) => getMarketTiming(market).isOpen && isDifficultMarket(market))
      .sort((a, b) => b.popularidad - a.popularidad);
  }

  if (activeFilters.state === "nuevos") {
    filtered = filtered
      .filter((market) => getMarketTiming(market).isOpen)
      .sort((a, b) => new Date(b.fechaCreacion) - new Date(a.fechaCreacion));
  }

  if (activeFilters.state === "resueltos") {
    filtered = filtered.filter((market) => getMarketTiming(market).effectiveStatus === "Resuelto");
  }

  return filtered;
}

function createTrendMarkup(market) {
  const hasPredictions = market.tienePredicciones !== false && market.prediccionesReales > 0;
  const label = hasPredictions
    ? `Precio vivo: Sí ${formatPercentage(market.porcentajeSi, 2)} por ciento, No ${formatPercentage(market.porcentajeNo, 2)} por ciento`
    : "Sin movimientos todavía. Precio inicial del 50 por ciento para Sí y No.";

  return `
    <div class="market-price-pair${hasPredictions ? "" : " has-no-movement"}" role="group" aria-label="${escapeHtml(label)}">
      <span class="market-price is-yes"><small>✓ Sí</small><strong>${formatPercentage(market.porcentajeSi, 2)} %</strong></span>
      <span class="market-price is-no"><small>× No</small><strong>${formatPercentage(market.porcentajeNo, 2)} %</strong></span>
    </div>
  `;
}

function createMarketCard(market) {
  const timing = getMarketTiming(market);
  const card = document.createElement("article");
  card.className = "market-card";
  card.innerHTML = `
    <div class="market-card-header">
      <span class="tag">${escapeHtml(market.categoria)}</span>
      <span class="status ${getStatusClass(timing.effectiveStatus)}" data-market-status>${escapeHtml(getMarketStatusLabel(market))}</span>
    </div>
    <h3>${escapeHtml(market.pregunta)}</h3>
    ${createTrendMarkup(market)}
    <p class="market-movement-state">${market.prediccionesReales > 0 ? "Precio actualizado solo por participaciones reales" : "Sin movimientos · punto inicial honesto"}</p>
    ${createMarketTimingMarkup(market)}
    <div class="market-stats-line" aria-label="Datos reales de actividad del mercado">
      <span class="metric metric-users">${formatNumber(market.participantes)} participantes</span>
      <span class="metric metric-karma">${formatKarma(market.karmaTotal)}</span>
    </div>
    <div class="card-actions">
      <a class="predict-yes-button" href="${getMarketUrl(market)}&amp;side=yes">✓ Predecir Sí</a>
      <a class="predict-no-button" href="${getMarketUrl(market)}&amp;side=no">× Predecir No</a>
    </div>
  `;

  return card;
}

function getUserProfileUrl(user) {
  return user.id
    ? `profile.html?id=${encodeURIComponent(user.id)}`
    : "ranking.html";
}

function createLeaderboardRow(user, index) {
  const link = document.createElement("a");
  link.className = "leaderboard-row";
  link.href = getUserProfileUrl(user);
  link.setAttribute("aria-label", `Abrir el perfil predictivo de ${user.username}`);
  const position = user.posicion || index + 1;
  link.innerHTML = `
    <span class="rank-position">${position}</span>
    <span>
      <span class="rank-user">${escapeHtml(user.username)}</span>
      <span class="rank-meta">${formatNumber(user.prestigio)} Prestigio · ${escapeHtml(user.rango)}</span>
      <span class="rank-category">${user.aciertos} aciertos · ${formatNumber(user.precision)}% precisión</span>
    </span>
  `;

  return link;
}

function getHomeRankProgress(prestige) {
  const ladder = [...rankLadder].sort((a, b) => a.prestigioMinimo - b.prestigioMinimo);
  const safePrestige = Math.max(0, toNumber(prestige));
  let current = ladder[0] || { nombre: "Observador", prestigioMinimo: 0 };

  ladder.forEach((rank) => {
    if (rank.prestigioMinimo <= safePrestige) current = rank;
  });

  const next = ladder.find((rank) => rank.prestigioMinimo > safePrestige) || null;
  return {
    current,
    next,
    remaining: next ? Math.max(0, next.prestigioMinimo - safePrestige) : 0
  };
}

function renderCompetitionSnapshot() {
  if (
    !competitionSnapshotLabelNode
    || !competitionCurrentRankNode
    || !competitionCurrentPrestigeNode
    || !rankProgressNoteNode
  ) return;

  if (!currentAuthState?.isAuthenticated) {
    competitionSnapshotLabelNode.textContent = "Tu progreso";
    competitionCurrentRankNode.textContent = "Inicia sesión";
    competitionCurrentPrestigeNode.textContent = "";
    competitionCurrentPrestigeNode.hidden = true;
    rankProgressNoteNode.textContent = "Consulta tu Prestigio, rango y progreso.";
    return;
  }

  const profile = currentAuthState.profile;
  const progress = getHomeRankProgress(profile.prestige);
  const seasonsActive = competitionStatus?.state === "Activa";

  competitionSnapshotLabelNode.textContent = seasonsActive
    ? competitionStatus.season_name || "Temporada activa"
    : "Rango actual";

  competitionCurrentRankNode.textContent = profile.rank || progress.current.nombre;
  competitionCurrentPrestigeNode.textContent = `Prestigio: ${formatNumber(profile.prestige)}`;
  competitionCurrentPrestigeNode.hidden = false;

  rankProgressNoteNode.textContent = progress.next
    ? `Faltan ${formatNumber(progress.remaining)} de Prestigio para ${progress.next.nombre}.`
    : "Rango máximo alcanzado.";
}

function renderLeaderboard() {
  leaderboardPanelNode.innerHTML = "";

  const seasonIsActive = competitionStatus?.state === "Activa";
  homeRankingUsers = seasonIsActive ? seasonRankingUsers : globalRankingUsers;
  if (homeRankingEyebrowNode) {
    homeRankingEyebrowNode.textContent = seasonIsActive ? "Temporada activa" : "Clasificación";
  }
  if (homeRankingTitleNode) {
    homeRankingTitleNode.textContent = seasonIsActive
      ? competitionStatus?.season_name || "Top temporada"
      : "Top global";
  }

  if (homeRankingUsers.length === 0) {
    leaderboardPanelNode.innerHTML = `
      <div class="leaderboard-empty">
        <div class="leaderboard-placeholder" aria-hidden="true">
          <span class="placeholder-line"></span>
          <span class="placeholder-line"></span>
          <span class="placeholder-line"></span>
        </div>
        <strong>Aún no hay ranking competitivo</strong>
        <p>La clasificación aparecerá cuando se resuelvan mercados y haya Prestigio real.</p>
      </div>
    `;
    return;
  }

  const list = document.createElement("div");
  list.className = "leaderboard-list";
  homeRankingUsers.forEach((user, index) => {
    list.appendChild(createLeaderboardRow(user, index));
  });
  leaderboardPanelNode.appendChild(list);
}

function renderActivity() {
  if (!activityPanelNode) return;

  if (!publicActivity) {
    activityPanelNode.innerHTML = `
      <p class="eyebrow">Actividad</p>
      <h2>Ahora en Atinara</h2>
      <p>Conectando con la actividad pública de Supabase...</p>
    `;
    return;
  }

  if (publicActivity.activePredictions === 0) {
    activityPanelNode.innerHTML = `
      <p class="eyebrow">Actividad</p>
      <h2>Ahora en Atinara</h2>
      <p>Todavía no hay actividad predictiva registrada.</p>
      <div class="activity-metrics" aria-label="Métricas públicas">
        <span>${formatNumber(publicActivity.registeredUsers)} usuarios registrados</span>
        <span>${formatNumber(publicActivity.openMarkets)} mercados abiertos</span>
      </div>
    `;
    return;
  }

  activityPanelNode.innerHTML = `
    <p class="eyebrow">Actividad</p>
    <h2>Ahora en Atinara</h2>
    <div class="activity-metrics" aria-label="Métricas públicas">
      <span><strong>${formatNumber(publicActivity.registeredUsers)}</strong> usuarios registrados</span>
      <span><strong>${formatNumber(publicActivity.activePredictions)}</strong> predicciones activas</span>
      <span><strong>${formatNumber(publicActivity.openMarkets)}</strong> mercados abiertos</span>
    </div>
  `;
}

function renderFilterButtons() {
  categoryFilterNode.innerHTML = "";
  categories.forEach((category) => {
    const button = document.createElement("button");
    button.className = "chip";
    button.type = "button";
    button.textContent = category;
    button.setAttribute("aria-pressed", String(activeFilters.category === category));
    button.addEventListener("click", () => {
      activeFilters.category = category;
      render();
    });
    categoryFilterNode.appendChild(button);
  });

  stateFilterNode.innerHTML = "";
  stateFilters.forEach((filter) => {
    const button = document.createElement("button");
    button.className = "chip";
    button.type = "button";
    button.textContent = filter.label;
    button.setAttribute("aria-pressed", String(activeFilters.state === filter.id));
    button.addEventListener("click", () => {
      activeFilters.state = filter.id;
      render();
    });
    stateFilterNode.appendChild(button);
  });
}

function renderFeaturedMarket() {
  featuredMarketNode.hidden = true;
  featuredMarketNode.replaceChildren();
}

function renderMarkets() {
  if (marketLoadFailed) {
    marketListNode.innerHTML = `
      <section class="not-found-card market-load-error" role="alert">
        <p class="eyebrow">Conexión no disponible</p>
        <h2>No se han podido cargar los mercados</h2>
        <p>No mostraremos datos de prueba. Reintenta para consultar los precios y mercados reales de Atinara.</p>
        <button class="primary-button" type="button" data-market-load-retry>Reintentar</button>
      </section>
    `;
    resultCountNode.textContent = "Mercados no disponibles";
    emptyStateNode.hidden = true;
    marketListNode.querySelector("[data-market-load-retry]")?.addEventListener(
      "click",
      initializeMarkets
    );
    return;
  }

  const filteredMarkets = getFilteredMarkets();
  marketListNode.innerHTML = "";

  filteredMarkets.forEach((market) => {
    marketListNode.appendChild(createMarketCard(market));
  });

  const count = filteredMarkets.length;
  resultCountNode.textContent = `${count} ${count === 1 ? "mercado" : "mercados"}`;
  emptyStateNode.hidden = count !== 0;
}

function renderLoadingState() {
  renderFilterButtons();
  renderLeaderboard();
  renderActivity();
  featuredMarketNode.hidden = true;
  resultCountNode.textContent = "";
  emptyStateNode.hidden = true;
  marketListNode.innerHTML = '<p class="loading-state">Cargando mercados...</p>';
}

function render() {
  renderFilterButtons();
  renderFeaturedMarket();
  renderMarkets();
  renderLeaderboard();
  renderCompetitionSnapshot();
  renderActivity();
}

function updateMarketTimingNodes(now = Date.now()) {
  const newlyExpiredMarkets = [];

  document.querySelectorAll("[data-market-timing]").forEach((node) => {
    const marketId = decodeURIComponent(node.dataset.marketId || "");
    const market = markets.find((item) => item.id === marketId);
    if (!market) return;

    const timing = getMarketTiming(market, now);
    const countdownNode = node.querySelector("[data-market-countdown]");
    const exactDateNode = node.querySelector("[data-market-exact-date]");
    const statusNode = node.closest(".market-card, .featured-card")?.querySelector("[data-market-status]");

    if (countdownNode) countdownNode.textContent = timing.label;
    if (exactDateNode) {
      exactDateNode.textContent = timing.exactLabel;
      exactDateNode.hidden = !timing.exactLabel;
    }
    if (statusNode) {
      statusNode.className = `status ${getStatusClass(timing.effectiveStatus)}`;
      statusNode.textContent = getMarketStatusLabel(market, now);
    }

    node.dataset.effectiveStatus = timing.effectiveStatus;

    if (
      market.estado === "Abierto" &&
      timing.effectiveStatus === "Cerrado" &&
      marketsUseSupabase &&
      !expirySyncRequested.has(market.id)
    ) {
      newlyExpiredMarkets.push(market);
    }
  });

  if (newlyExpiredMarkets.length > 0) {
    handleExpiredMarkets(newlyExpiredMarkets);
  }
}

async function refreshMarketsAfterExpiry() {
  if (expiryRefreshPromise) {
    expiryRefreshPending = true;
    return expiryRefreshPromise;
  }

  expiryRefreshPromise = loadMarketsFromSupabase()
    .then((freshMarkets) => {
      markets = freshMarkets;
      marketsUseSupabase = true;
      marketLoadFailed = false;
      setDataSourceWarning("");
      render();
    })
    .catch(() => {
      setDataSourceWarning("El mercado se ha cerrado en pantalla, pero no se ha podido sincronizar de nuevo con Supabase.");
    })
    .finally(() => {
      expiryRefreshPromise = null;
      if (expiryRefreshPending) {
        expiryRefreshPending = false;
        refreshMarketsAfterExpiry();
      }
    });

  return expiryRefreshPromise;
}

function handleExpiredMarkets(expiredMarkets) {
  let hasNewExpiry = false;

  expiredMarkets.forEach((market) => {
    if (expirySyncRequested.has(market.id)) return;
    expirySyncRequested.add(market.id);
    market.estado = "Cerrado";
    hasNewExpiry = true;
  });

  if (!hasNewExpiry) return;
  render();
  refreshMarketsAfterExpiry();
}

function startMarketClock() {
  if (marketClockTimer !== null) {
    window.clearInterval(marketClockTimer);
  }
  if (marketDataRefreshTimer !== null) {
    window.clearInterval(marketDataRefreshTimer);
  }

  updateMarketTimingNodes();
  marketClockTimer = window.setInterval(updateMarketTimingNodes, 1000);
  marketDataRefreshTimer = window.setInterval(refreshMarketsAfterExpiry, 30000);
}

function stopMarketClock() {
  if (marketClockTimer !== null) {
    window.clearInterval(marketClockTimer);
    marketClockTimer = null;
  }
  if (marketDataRefreshTimer !== null) {
    window.clearInterval(marketDataRefreshTimer);
    marketDataRefreshTimer = null;
  }
}

clearButton.addEventListener("click", () => {
  activeFilters.category = "Todos";
  activeFilters.state = "activos";
  activeFilters.query = "";
  searchInput.value = "";
  render();
  searchInput.focus();
});

searchInput.addEventListener("input", (event) => {
  activeFilters.query = event.target.value;
  render();
});

async function initializeMarkets() {
  renderLoadingState();

  const [
    marketsResult,
    globalLeaderboardResult,
    seasonLeaderboardResult,
    competitionResult,
    rankLadderResult,
    activityResult
  ] = await Promise.allSettled([
    loadMarketsFromSupabase(),
    loadGlobalLeaderboardFromSupabase(),
    loadSeasonLeaderboardFromSupabase(),
    loadCompetitionStatusFromSupabase(),
    loadRankLadderFromSupabase(),
    loadActivityFromSupabase()
  ]);

  if (marketsResult.status === "fulfilled") {
    markets = marketsResult.value;
    categories = ["Todos", ...new Set(markets.map((market) => market.categoria).filter(Boolean))];
    marketsUseSupabase = true;
    marketLoadFailed = false;
    setDataSourceWarning("");
  } else {
    markets = [];
    marketsUseSupabase = false;
    marketLoadFailed = true;
    setDataSourceWarning("No se han podido cargar los mercados reales. No mostraremos datos de prueba; vuelve a intentarlo en unos instantes.");
  }

  globalRankingUsers = globalLeaderboardResult.status === "fulfilled"
    ? globalLeaderboardResult.value
    : [];
  seasonRankingUsers = seasonLeaderboardResult.status === "fulfilled"
    ? seasonLeaderboardResult.value
    : [];
  competitionStatus = competitionResult.status === "fulfilled"
    ? competitionResult.value
    : null;
  if (rankLadderResult.status === "fulfilled" && rankLadderResult.value.length > 0) {
    rankLadder = rankLadderResult.value;
  }
  publicActivity = activityResult.status === "fulfilled" ? activityResult.value : null;

  render();
  startMarketClock();
}

window.addEventListener("pagehide", stopMarketClock);
window.addEventListener("pageshow", (event) => {
  if (event.persisted && markets.length > 0) startMarketClock();
});

window.orakloAuth?.onChange((authState) => {
  currentAuthState = authState;
  renderCompetitionSnapshot();
});

initializeMarkets();
