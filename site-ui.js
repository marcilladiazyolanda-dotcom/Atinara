(function initializeAtinaraUi(global) {
  "use strict";

  const SEARCH_LIMIT = 8;
  const NAVIGATION_DESTINATIONS = Object.freeze([
    { label: "Explorar mercados", href: "index.html" },
    { label: "Comunidad", href: "community.html" },
    { label: "Clasificación", href: "ranking.html" },
    { label: "Mis predicciones", href: "my-predictions.html" },
    { label: "Gestionar mercados", href: "admin-markets.html", adminOnly: true },
    { label: "Resolver mercados", href: "admin-resolution.html", adminOnly: true },
    { label: "Moderar comunidad", href: "admin-community.html", adminOnly: true }
  ]);
  const state = {
    markets: null,
    loadingPromise: null,
    activeIndex: -1,
    trigger: null,
    results: []
  };

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function normalizeSearchText(value) {
    return String(value || "")
      .toLocaleLowerCase("es-ES")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim();
  }

  function normalizeCurrentPage(pathname = global.location?.pathname || "") {
    const segments = String(pathname).split("/").filter(Boolean);
    const lastSegment = decodeURIComponent(segments.at(-1) || "").toLocaleLowerCase("es-ES");
    return !lastSegment || !lastSegment.includes(".") ? "index.html" : lastSegment;
  }

  function getNavigationDestinations(
    pathname = global.location?.pathname || "",
    { includeAdmin = true } = {}
  ) {
    const currentPage = normalizeCurrentPage(pathname);
    return NAVIGATION_DESTINATIONS.filter((destination) => {
      if (destination.href === currentPage) return false;
      return includeAdmin || !destination.adminOnly;
    });
  }

  function createNavigationLink(destination) {
    const link = document.createElement("a");
    link.href = destination.href;
    link.textContent = destination.label;
    if (destination.adminOnly) link.dataset.adminOnly = "true";
    return link;
  }

  function renderNavigationLinks(container, { includeAdmin = false } = {}) {
    if (!container) return;
    container.replaceChildren(
      ...getNavigationDestinations(global.location?.pathname || "", { includeAdmin })
        .map(createNavigationLink)
    );
  }

  function setAdminNavigation(isAuthorizedAdmin) {
    const includeAdmin = isAuthorizedAdmin === true;
    document.querySelectorAll("[data-primary-navigation]").forEach((navigation) => {
      renderNavigationLinks(navigation, { includeAdmin });
    });

    const mobilePanel = document.querySelector("#mobile-menu-panel");
    if (mobilePanel) {
      const firstControl = mobilePanel.querySelector(".mobile-account-metrics");
      const fragment = document.createDocumentFragment();
      getNavigationDestinations(global.location?.pathname || "", { includeAdmin })
        .forEach((destination) => fragment.appendChild(createNavigationLink(destination)));
      mobilePanel.querySelectorAll(":scope > a").forEach((link) => link.remove());
      mobilePanel.insertBefore(fragment, firstControl);
    }
  }

  function formatNumber(value, maximumFractionDigits = 2) {
    const number = Number(value);
    if (!Number.isFinite(number)) return "—";
    return new Intl.NumberFormat("es-ES", { maximumFractionDigits }).format(number);
  }

  function formatKarmaAmount(value, options = {}) {
    const number = Number(value);
    const formatted = Number.isFinite(number)
      ? formatNumber(number, options.maximumFractionDigits ?? 2)
      : "—";
    const accessible = options.label || `${formatted} Karma`;
    const signClass = number > 0 ? " is-positive" : number < 0 ? " is-negative" : "";
    return `<span class="karma-amount${signClass}" aria-label="${escapeHtml(accessible)}"><span>${escapeHtml(formatted)}</span><img class="karma-glyph" src="assets/brand/atinara-karma.svg" alt="" aria-hidden="true" width="16" height="16"></span>`;
  }

  function setKarmaAmount(node, value, options = {}) {
    if (!node) return;
    const number = Number(value);
    const formatted = Number.isFinite(number)
      ? formatNumber(number, options.maximumFractionDigits ?? 0)
      : "—";
    node.replaceChildren();
    const valueNode = document.createElement("span");
    valueNode.textContent = formatted;
    const glyph = document.createElement("img");
    glyph.className = "karma-glyph";
    glyph.src = "assets/brand/atinara-karma.svg";
    glyph.alt = "";
    glyph.setAttribute("aria-hidden", "true");
    glyph.width = 16;
    glyph.height = 16;
    node.append(valueNode, glyph);
    node.setAttribute("aria-label", options.label || `${formatted} Karma`);
  }

  function filterMarkets(markets, query, limit = SEARCH_LIMIT) {
    const normalizedQuery = normalizeSearchText(query);
    if (!normalizedQuery) return [];
    return (Array.isArray(markets) ? markets : [])
      .map((market) => ({
        market,
        haystack: normalizeSearchText([
          market.pregunta || market.question,
          market.categoria || market.category,
          market.estado || market.status
        ].join(" "))
      }))
      .filter((entry) => entry.haystack.includes(normalizedQuery))
      .slice(0, limit)
      .map((entry) => entry.market);
  }

  function appendHighlightedText(container, text, query) {
    const original = String(text || "");
    const normalized = normalizeSearchText(original);
    const needle = normalizeSearchText(query);
    if (!needle) {
      container.textContent = original;
      return;
    }

    const start = normalized.indexOf(needle);
    if (start < 0) {
      container.textContent = original;
      return;
    }

    container.append(document.createTextNode(original.slice(0, start)));
    const mark = document.createElement("mark");
    mark.textContent = original.slice(start, start + needle.length);
    container.append(mark, document.createTextNode(original.slice(start + needle.length)));
  }

  function getSearchPanel() {
    return document.querySelector("#global-search-results");
  }

  function closeSearch({ restoreFocus = false } = {}) {
    const panel = getSearchPanel();
    if (panel) {
      panel.hidden = true;
      panel.replaceChildren();
    }
    state.activeIndex = -1;
    state.results = [];
    document.querySelectorAll("[data-global-search]").forEach((input) => {
      input.setAttribute("aria-expanded", "false");
      input.removeAttribute("aria-activedescendant");
    });
    if (restoreFocus) state.trigger?.focus({ preventScroll: true });
  }

  function setActiveSearchResult(index) {
    const items = Array.from(document.querySelectorAll("#global-search-results [role='option']"));
    if (!items.length) return;
    state.activeIndex = Math.max(0, Math.min(index, items.length - 1));
    items.forEach((item, itemIndex) => {
      const active = itemIndex === state.activeIndex;
      item.dataset.active = String(active);
      item.setAttribute("aria-selected", String(active));
    });
    const activeItem = items[state.activeIndex];
    activeItem?.scrollIntoView({ block: "nearest" });
    state.trigger?.setAttribute("aria-activedescendant", activeItem?.id || "");
  }

  function renderSearchResults(query, status = "ready") {
    const panel = getSearchPanel();
    if (!panel || !state.trigger) return;
    if (!query.trim()) {
      closeSearch();
      return;
    }
    panel.replaceChildren();
    panel.hidden = false;
    state.trigger.setAttribute("aria-expanded", "true");
    state.activeIndex = -1;

    if (status === "loading") {
      const loading = document.createElement("p");
      loading.className = "global-search-state";
      loading.setAttribute("role", "status");
      loading.textContent = "Consultando el catálogo público de Atinara…";
      panel.appendChild(loading);
      return;
    }

    if (status === "error") {
      const error = document.createElement("p");
      error.className = "global-search-state is-error";
      error.setAttribute("role", "alert");
      error.textContent = "No se ha podido consultar el catálogo. Cierra el buscador y vuelve a intentarlo.";
      panel.appendChild(error);
      return;
    }

    state.results = filterMarkets(state.markets, query);
    if (!state.results.length) {
      const empty = document.createElement("p");
      empty.className = "global-search-state";
      empty.setAttribute("role", "status");
      empty.textContent = "No hay mercados reales que coincidan con la búsqueda.";
      panel.appendChild(empty);
      return;
    }

    const list = document.createElement("div");
    list.className = "global-search-list";
    list.setAttribute("role", "listbox");
    list.setAttribute("aria-label", "Resultados de mercados");
    state.results.forEach((market, index) => {
      const row = document.createElement("a");
      const id = String(market.id || "");
      const question = market.pregunta || market.question || "Mercado sin título";
      const category = market.categoria || market.category || "Sin categoría";
      const statusLabel = market.estado || market.status || "Estado no disponible";
      const yesPrice = Number(market.porcentajeSi ?? market.yes_price ?? market.yes_percent ?? 50);
      const noPrice = Number(market.porcentajeNo ?? market.no_price ?? market.no_percent ?? (100 - yesPrice));
      row.id = `global-search-result-${index}`;
      row.href = `market-detail.html?id=${encodeURIComponent(id)}`;
      row.setAttribute("role", "option");
      row.setAttribute("aria-selected", "false");
      row.dataset.searchResult = String(index);

      const copy = document.createElement("span");
      copy.className = "global-search-copy";
      const title = document.createElement("strong");
      appendHighlightedText(title, question, query);
      const meta = document.createElement("span");
      meta.textContent = `${category} · ${statusLabel}`;
      copy.append(title, meta);

      const prices = document.createElement("span");
      prices.className = "global-search-prices";
      const yes = document.createElement("span");
      yes.className = "is-yes";
      yes.textContent = `Sí ${formatNumber(yesPrice)} %`;
      const no = document.createElement("span");
      no.className = "is-no";
      no.textContent = `No ${formatNumber(noPrice)} %`;
      prices.append(yes, no);
      row.append(copy, prices);
      list.appendChild(row);
    });
    panel.appendChild(list);
  }

  async function loadMarketsForSearch() {
    if (state.markets) return state.markets;
    if (state.loadingPromise) return state.loadingPromise;
    if (!global.orakloSupabase || typeof global.mapMarketFromSupabase !== "function") {
      throw new Error("CATALOG_UNAVAILABLE");
    }
    state.loadingPromise = global.orakloSupabase.rpc("get_public_markets")
      .then(({ data, error }) => {
        if (error) throw error;
        state.markets = (data || []).map(global.mapMarketFromSupabase);
        return state.markets;
      })
      .finally(() => {
        state.loadingPromise = null;
      });
    return state.loadingPromise;
  }

  async function openSearch(input) {
    state.trigger = input;
    if (!input.value.trim()) {
      closeSearch();
      return;
    }
    renderSearchResults(input.value, state.markets ? "ready" : "loading");
    try {
      await loadMarketsForSearch();
      if (state.trigger === input && input.value.trim() && !getSearchPanel()?.hidden) {
        renderSearchResults(input.value);
      }
    } catch (_error) {
      if (input.value.trim()) renderSearchResults(input.value, "error");
    }
  }

  function ensureSearchPanel(topbar) {
    let panel = getSearchPanel();
    if (panel) return panel;
    panel = document.createElement("section");
    panel.id = "global-search-results";
    panel.className = "global-search-results";
    panel.setAttribute("aria-label", "Búsqueda de mercados");
    panel.hidden = true;
    topbar.insertAdjacentElement("afterend", panel);
    return panel;
  }

  function ensureSearch(topbar) {
    let search = topbar.querySelector(".search");
    let input = search?.querySelector("input[type='search']");
    if (!search || !input) {
      search = document.createElement("div");
      search.className = "search global-search";
      search.setAttribute("role", "search");
      const label = document.createElement("label");
      label.className = "sr-only";
      label.htmlFor = "global-market-search";
      label.textContent = "Buscar mercados";
      input = document.createElement("input");
      input.id = "global-market-search";
      input.type = "search";
      input.placeholder = "Buscar mercados, categorías o temas";
      input.autocomplete = "off";
      search.append(label, input);
      topbar.querySelector(".brand")?.insertAdjacentElement("afterend", search);
    }

    ensureSearchPanel(topbar);
    input.dataset.globalSearch = "true";
    input.setAttribute("role", "combobox");
    input.setAttribute("aria-autocomplete", "list");
    input.setAttribute("aria-controls", "global-search-results");
    input.setAttribute("aria-expanded", "false");

    if (input.dataset.searchEnhanced === "true") return;
    input.dataset.searchEnhanced = "true";
    input.addEventListener("focus", () => {
      state.trigger = input;
      if (input.value.trim()) openSearch(input);
      else closeSearch();
    });
    input.addEventListener("input", () => {
      state.trigger = input;
      if (!input.value.trim()) {
        closeSearch();
        return;
      }
      openSearch(input);
    });
    input.addEventListener("keydown", (event) => {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setActiveSearchResult(state.activeIndex + 1);
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        setActiveSearchResult(state.activeIndex <= 0 ? state.results.length - 1 : state.activeIndex - 1);
      } else if (event.key === "Enter" && state.activeIndex >= 0) {
        event.preventDefault();
        document.querySelector(`#global-search-result-${state.activeIndex}`)?.click();
      } else if (event.key === "Escape") {
        event.preventDefault();
        closeSearch({ restoreFocus: true });
      }
    });
  }

  function ensureBrand(topbar) {
    const brand = topbar.querySelector(".brand");
    if (!brand || brand.querySelector("img.brand-logo")) return;
    brand.replaceChildren();
    const logo = document.createElement("img");
    logo.className = "brand-logo";
    logo.src = "assets/brand/atinara-logo-light.svg";
    logo.alt = "Atinara";
    logo.width = 172;
    logo.height = 36;
    brand.appendChild(logo);
  }

  function ensureCanonicalNavigation(topbar) {
    const navigation = topbar.querySelector("[data-primary-navigation]") || document.createElement("nav");
    topbar.querySelectorAll(".detail-nav").forEach((legacyNavigation) => {
      if (legacyNavigation !== navigation) legacyNavigation.remove();
    });
    topbar.querySelectorAll(".topbar-actions .topbar-link").forEach((legacyControl) => {
      legacyControl.remove();
    });

    navigation.className = "primary-navigation";
    navigation.dataset.primaryNavigation = "true";
    navigation.setAttribute("aria-label", "Navegación principal");
    renderNavigationLinks(navigation);

    if (!navigation.isConnected) {
      topbar.querySelector(".topbar-actions")?.insertAdjacentElement("beforebegin", navigation);
    }
  }

  function ensureMobileMenu(topbar) {
    if (topbar.querySelector("[data-mobile-menu-toggle]")) return;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "mobile-menu-toggle";
    button.dataset.mobileMenuToggle = "true";
    button.setAttribute("aria-expanded", "false");
    button.setAttribute("aria-controls", "mobile-menu-panel");
    button.setAttribute("aria-label", "Abrir menú principal");
    button.innerHTML = '<span aria-hidden="true"></span><span aria-hidden="true"></span><span aria-hidden="true"></span>';

    const panel = document.createElement("nav");
    panel.id = "mobile-menu-panel";
    panel.className = "mobile-menu-panel";
    panel.setAttribute("aria-label", "Navegación móvil");
    panel.hidden = true;
    const links = document.createDocumentFragment();
    getNavigationDestinations(global.location?.pathname || "", { includeAdmin: false })
      .forEach((destination) => links.appendChild(createNavigationLink(destination)));
    panel.appendChild(links);

    const metrics = document.createElement("div");
    metrics.className = "mobile-account-metrics";
    metrics.dataset.authPrivate = "true";
    metrics.hidden = true;
    metrics.innerHTML = `
      <span aria-label="Karma disponible"><strong data-profile-karma>—</strong></span>
      <span>Prestigio: <strong data-profile-prestige>—</strong></span>
      <span>Rango: <strong data-profile-rank>—</strong></span>
    `;

    const guestButton = document.createElement("button");
    guestButton.type = "button";
    guestButton.dataset.authOpen = "true";
    guestButton.dataset.authState = "guest";
    guestButton.textContent = "Entrar o crear cuenta";
    const profileButton = document.createElement("button");
    profileButton.type = "button";
    profileButton.dataset.authState = "user";
    profileButton.dataset.profileUsername = "true";
    profileButton.hidden = true;
    profileButton.textContent = "Cuenta";
    const signOutButton = document.createElement("button");
    signOutButton.type = "button";
    signOutButton.dataset.authSignout = "true";
    signOutButton.dataset.authState = "user";
    signOutButton.hidden = true;
    signOutButton.textContent = "Cerrar sesión";
    panel.append(metrics, guestButton, profileButton, signOutButton);
    topbar.appendChild(button);
    topbar.insertAdjacentElement("afterend", panel);

    button.addEventListener("click", () => {
      const open = panel.hidden;
      panel.hidden = !open;
      button.setAttribute("aria-expanded", String(open));
      button.setAttribute("aria-label", open ? "Cerrar menú principal" : "Abrir menú principal");
      if (open) panel.querySelector("a:not([hidden])")?.focus();
    });
    panel.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      panel.hidden = true;
      button.setAttribute("aria-expanded", "false");
      button.setAttribute("aria-label", "Abrir menú principal");
      button.focus();
    });
    panel.addEventListener("click", (event) => {
      if (!event.target.closest("a, button")) return;
      panel.hidden = true;
      button.setAttribute("aria-expanded", "false");
      button.setAttribute("aria-label", "Abrir menú principal");
    });
  }

  function enhanceHeader() {
    const topbar = document.querySelector(".topbar");
    if (!topbar) return;
    ensureBrand(topbar);
    ensureSearch(topbar);
    ensureCanonicalNavigation(topbar);
    ensureMobileMenu(topbar);
  }

  function bindGlobalDismissal() {
    document.addEventListener("pointerdown", (event) => {
      if (event.target.closest(".search") || event.target.closest("#global-search-results")) return;
      closeSearch();
    });
  }

  function initialize() {
    if (document.documentElement.dataset.atinaraUiInitialized === "true") return;
    document.documentElement.dataset.atinaraUiInitialized = "true";
    enhanceHeader();
    bindGlobalDismissal();
    document.querySelectorAll("[data-karma-value]").forEach((node) => {
      setKarmaAmount(node, node.dataset.karmaValue);
    });
  }

  const api = {
    escapeHtml,
    normalizeSearchText,
    normalizeCurrentPage,
    getNavigationDestinations,
    filterMarkets,
    formatNumber,
    formatKarmaAmount,
    setKarmaAmount,
    closeSearch,
    setAdminNavigation,
    enhanceHeader
  };

  global.atinaraUi = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof document !== "undefined") {
    if (document.querySelector(".topbar")) {
      initialize();
    } else if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", initialize, { once: true });
    } else {
      initialize();
    }
  }
})(typeof window !== "undefined" ? window : globalThis);
