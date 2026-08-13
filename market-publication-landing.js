(function initPublishedMarketLanding() {
  "use strict";

  const PUBLICATION_KEY = "atinara:last-published-market:v2";
  const PUBLICATION_RELOAD_KEY = "atinara:public-market-auto-reload:v1";
  const PUBLICATION_EVENT_KEY = "atinara:market-published-event:v1";
  const PUBLICATION_CHANNEL = "atinara-market-catalog-v1";
  const MARKET_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const safeText = (value, max = 800) => String(value ?? "").trim().slice(0, max);
  const safeMarketId = (value) => {
    const candidate = safeText(value, 80);
    return MARKET_ID_PATTERN.test(candidate) ? candidate.toLowerCase() : "";
  };
  const normalizePublication = (value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const normalizedMarketId = safeMarketId(value.marketId);
    if (!normalizedMarketId) return null;
    return {
      marketId: normalizedMarketId,
      question: safeText(value.question, 600)
    };
  };
  const search = new URLSearchParams(window.location.search);
  const queryMarketId = safeMarketId(search.get("market"));

  let publication = null;
  let marketId = queryMarketId;
  let started = Date.now();
  let waitTimer = null;
  let refreshInFlight = false;

  try {
    publication = normalizePublication(JSON.parse(sessionStorage.getItem(PUBLICATION_KEY) || "null"));
  } catch {
    sessionStorage.removeItem(PUBLICATION_KEY);
  }
  if (!marketId) marketId = publication?.marketId || "";

  const style = document.createElement("style");
  style.textContent = `
    .published-market-arrival {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      align-items: center;
      gap: 14px;
      margin: 0 0 18px;
      padding: 14px 16px;
      border: 1px solid rgba(94, 224, 160, 0.55);
      border-radius: 10px;
      background: linear-gradient(135deg, rgba(94, 224, 160, 0.12), rgba(110, 168, 255, 0.07));
    }
    .published-market-arrival > div {
      display: grid;
      gap: 4px;
      min-width: 0;
    }
    .published-market-arrival strong,
    .published-market-arrival span {
      overflow-wrap: anywhere;
    }
    .market-card.published-market-highlight {
      outline: 3px solid rgba(94, 224, 160, 0.78);
      outline-offset: 3px;
      box-shadow: 0 0 0 8px rgba(94, 224, 160, 0.08);
    }
    @media (max-width: 720px) {
      .published-market-arrival {
        grid-template-columns: 1fr;
      }
      .published-market-arrival a {
        width: 100%;
      }
    }
  `;
  document.head.appendChild(style);

  function cardForMarket() {
    if (!marketId) return null;
    const directCard = [...document.querySelectorAll("#market-list .market-card[data-market-id]")]
      .find((card) => card.dataset.marketId === marketId);
    if (directCard) return directCard;
    const encoded = encodeURIComponent(marketId);
    return [...document.querySelectorAll("#market-list .market-card")].find((card) => {
      const hrefs = [...card.querySelectorAll("a[href]")].map((link) => link.getAttribute("href") || "");
      return hrefs.some((href) =>
        href.includes(`market-detail.html?id=${encoded}`) ||
        href.includes(`market-detail.html?id=${marketId}`)
      );
    }) || null;
  }

  function showArrival(card) {
    const family = card.closest(".market-family-card");
    const familyChildren = family?.querySelector(".market-family-children");
    const familyToggle = family?.querySelector(".market-family-toggle");
    if (familyChildren && familyToggle) {
      familyChildren.hidden = false;
      familyToggle.setAttribute("aria-expanded", "true");
      familyToggle.textContent = "Ocultar mercados";
    }
    card.classList.add("published-market-highlight");
    card.setAttribute("aria-current", "true");

    let banner = document.querySelector("[data-published-market-arrival]");
    if (!banner) {
      banner = document.createElement("section");
      banner.className = "published-market-arrival";
      banner.dataset.publishedMarketArrival = "true";
      banner.setAttribute("role", "status");
      document.querySelector(".markets-section")?.prepend(banner);
    }
    const summary = document.createElement("div");
    const title = document.createElement("strong");
    const question = document.createElement("span");
    const link = document.createElement("a");
    title.textContent = "Mercado publicado y disponible";
    question.textContent = safeText(publication?.question || marketId, 600);
    link.className = "primary-button";
    link.href = `market-detail.html?id=${encodeURIComponent(marketId)}`;
    link.textContent = "Abrir mercado";
    summary.append(title, question);
    banner.replaceChildren(summary, link);

    card.scrollIntoView({ behavior: "smooth", block: "center" });
    sessionStorage.removeItem(PUBLICATION_RELOAD_KEY);
    sessionStorage.removeItem(PUBLICATION_KEY);

    if (queryMarketId) {
      const cleanUrl = new URL(window.location.href);
      cleanUrl.searchParams.delete("market");
      try { window.history.replaceState({}, "", cleanUrl); } catch { /* Entorno restringido. */ }
    }
  }

  function waitForMarket() {
    window.clearTimeout(waitTimer);
    if (!marketId) return;
    const card = cardForMarket();
    if (card) {
      showArrival(card);
      return;
    }

    if (Date.now() - started < 12000) {
      waitTimer = window.setTimeout(waitForMarket, 140);
      return;
    }

    if (sessionStorage.getItem(PUBLICATION_RELOAD_KEY) !== marketId) {
      sessionStorage.setItem(PUBLICATION_RELOAD_KEY, marketId);
      window.location.reload();
      return;
    }

    const warning = document.querySelector("#data-source-warning");
    if (warning) {
      warning.hidden = false;
      warning.textContent = "El mercado ya fue publicado, pero el catálogo no pudo localizarlo automáticamente. Reintenta la conexión con Supabase.";
    }
  }

  async function refreshForPublication(nextPublication) {
    const normalizedPublication = normalizePublication(nextPublication);
    if (!normalizedPublication) return;
    publication = normalizedPublication;
    marketId = normalizedPublication.marketId;
    started = Date.now();
    sessionStorage.setItem(PUBLICATION_KEY, JSON.stringify(normalizedPublication));
    if (refreshInFlight) return;
    refreshInFlight = true;
    try {
      if (typeof window.initializeMarkets === "function") {
        await window.initializeMarkets();
      }
    } catch {
      // waitForMarket mostrará el estado de conexión si el RPC público falla.
    } finally {
      refreshInFlight = false;
      waitForMarket();
    }
  }

  try {
    const channel = new BroadcastChannel(PUBLICATION_CHANNEL);
    channel.addEventListener("message", (event) => {
      if (event.data?.type === "market-published") refreshForPublication(event.data.payload);
    });
  } catch {
    // Se conserva el fallback de storage y navegación directa.
  }

  window.addEventListener("storage", (event) => {
    if (event.key !== PUBLICATION_EVENT_KEY || !event.newValue) return;
    try { refreshForPublication(JSON.parse(event.newValue)); } catch { /* Evento inválido ignorado. */ }
  });

  if (marketId) waitForMarket();
})();
