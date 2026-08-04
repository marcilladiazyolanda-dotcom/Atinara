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

test("todas las cabeceras delegan en una única navegación canónica", () => {
  htmlFiles.forEach((fileName) => {
    const html = read(fileName);
    assert.equal(
      (html.match(/data-primary-navigation/g) || []).length,
      1,
      `${fileName} debe contener un único punto de montaje de navegación.`
    );
    assert.doesNotMatch(html, /class="detail-nav"|class="topbar-link/);
  });
});

test("elimina el control de notificaciones inerte y sus estilos exclusivos", () => {
  const publicSources = `${read("index.html")}\n${read("styles.css")}`;
  assert.doesNotMatch(publicSources, /icon-button|notification-dot|class="bell"|\.bell\b/);
});

test("el buscador vacío no construye un panel redundante", () => {
  const source = read("site-ui.js");
  assert.doesNotMatch(source, /Mercados reales|Escribe una pregunta, categoría o estado|global-search-heading|global-search-close/);
  assert.match(source, /if \(!input\.value\.trim\(\)\) \{\s*closeSearch\(\);/);
});

test("las tarjetas y paneles principales usan superficies semÃ¡nticas en ambos temas", () => {
  const css = read("styles.css");
  assert.match(css, /\.market-card:hover,\s*\.market-card:focus-within\s*\{[^}]*background:\s*var\(--interactive-surface-hover\)/s);
  assert.match(css, /\.predictions-grid \.prediction-card:hover,\s*\.predictions-grid \.prediction-card:focus-within\s*\{[^}]*background:\s*var\(--interactive-surface-hover\)/s);
  assert.doesNotMatch(css, /\.prediction-card:hover\s*\{[^}]*rgba\(21,\s*28,\s*45/s);
  assert.match(css, /\.community-feed-panel,\s*\.community-sidebar-card\s*\{[^}]*background:\s*var\(--surface\)/s);
  assert.match(css, /\.ranking-summary-card,\s*\.ranking-board-card,\s*\.rank-tier\s*\{[^}]*background:\s*var\(--surface\)/s);
  assert.match(css, /\.admin-market-panel,\s*\.admin-analysis-panel,\s*\.admin-access-card,\s*\.admin-loading-card\s*\{[^}]*background:\s*var\(--surface\)/s);
});

test("Karma y las métricas de cabecera no pueden partirse ni heredar texto oscuro", () => {
  const css = read("styles.css");
  assert.match(css, /\.karma-pill\s*\{[^}]*white-space:\s*nowrap/s);
  assert.match(css, /\.user-stat-pill,\s*\.user-stat-pill strong\s*\{\s*color:\s*#f8f6fc;/s);
});
