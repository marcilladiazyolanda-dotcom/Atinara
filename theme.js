(function initializeAtinaraTheme(global) {
  "use strict";

  const STORAGE_KEY = "atinara-theme";
  const LIGHT_THEME = "light";
  const DARK_THEME = "dark";
  const VALID_THEMES = new Set([LIGHT_THEME, DARK_THEME]);

  function normalizeTheme(value) {
    return VALID_THEMES.has(value) ? value : LIGHT_THEME;
  }

  function readStoredTheme() {
    try {
      return normalizeTheme(global.localStorage?.getItem(STORAGE_KEY));
    } catch (error) {
      console.info("[Atinara] El tema guardado no está disponible", error instanceof Error ? error.name : "UnknownError");
      return LIGHT_THEME;
    }
  }

  function persistTheme(theme) {
    try {
      global.localStorage?.setItem(STORAGE_KEY, theme);
    } catch (error) {
      // La preferencia sigue activa durante la visita aunque el almacenamiento falle.
      console.info("[Atinara] No se pudo guardar el tema", error instanceof Error ? error.name : "UnknownError");
    }
  }

  function updateToggle(button, theme) {
    if (!button) return;
    const isDark = theme === DARK_THEME;
    const label = isDark ? "Cambiar a modo claro" : "Cambiar a modo oscuro";
    button.setAttribute("aria-label", label);
    button.setAttribute("title", label);
    button.setAttribute("aria-pressed", String(isDark));
    button.dataset.themeState = theme;
  }

  function applyTheme(value, { persist = false } = {}) {
    const theme = normalizeTheme(value);
    document.documentElement.dataset.theme = theme;
    document.querySelectorAll("[data-theme-toggle]").forEach((button) => {
      updateToggle(button, theme);
    });
    if (persist) persistTheme(theme);
    return theme;
  }

  function toggleTheme() {
    const current = normalizeTheme(document.documentElement.dataset.theme);
    return applyTheme(current === DARK_THEME ? LIGHT_THEME : DARK_THEME, { persist: true });
  }

  function createThemeToggle() {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "theme-toggle";
    button.dataset.themeToggle = "true";
    button.innerHTML = `
      <svg class="theme-icon theme-icon-sun" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <circle cx="12" cy="12" r="3.5"></circle>
        <path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.65 17.65l1.42 1.42M2 12h2M20 12h2M4.93 19.07l1.42-1.42M17.65 6.35l1.42-1.42"></path>
      </svg>
      <svg class="theme-icon theme-icon-moon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"></path>
      </svg>
    `;
    updateToggle(button, normalizeTheme(document.documentElement.dataset.theme));
    button.addEventListener("click", toggleTheme);
    return button;
  }

  function ensureToggle(topbar = document.querySelector(".topbar")) {
    if (!topbar) return null;
    const existing = topbar.querySelector("[data-theme-toggle]");
    if (existing) {
      updateToggle(existing, normalizeTheme(document.documentElement.dataset.theme));
      return existing;
    }
    const button = createThemeToggle();
    topbar.appendChild(button);
    return button;
  }

  applyTheme(readStoredTheme());

  global.addEventListener?.("storage", (event) => {
    if (event.key !== STORAGE_KEY) return;
    applyTheme(event.newValue);
  });

  const api = Object.freeze({
    STORAGE_KEY,
    applyTheme,
    ensureToggle,
    readStoredTheme,
    toggleTheme
  });
  global.atinaraTheme = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
