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

test("el tema se aplica antes de la hoja de estilos en las diez pÃ¡ginas", () => {
  htmlFiles.forEach((fileName) => {
    const html = read(fileName);
    const themePosition = html.indexOf('src="theme.js?v=20260807-radar3"');
    const stylesheetPosition = html.indexOf('href="styles.css?v=20260807-radar3"');
    assert.ok(themePosition > 0, `${fileName} no carga el controlador de tema.`);
    assert.ok(themePosition < stylesheetPosition, `${fileName} puede mostrar un destello del tema incorrecto.`);
  });
});

test("el tema parte de claro, persiste y no depende del sistema operativo", () => {
  const source = read("theme.js");
  assert.match(source, /STORAGE_KEY = "atinara-theme"/);
  assert.match(source, /return LIGHT_THEME/);
  assert.match(source, /document\.documentElement\.dataset\.theme = theme/);
  assert.match(source, /localStorage\?\.setItem\(STORAGE_KEY, theme\)/);
  assert.match(source, /addEventListener\?\.\("storage"/);
  assert.doesNotMatch(source, /prefers-color-scheme|matchMedia/);
});

test("el control de tema es Ãºnico, accesible y conserva la cabecera Sunset", () => {
  const themeSource = read("theme.js");
  const uiSource = read("site-ui.js");
  const css = read("styles.css");
  assert.match(themeSource, /Cambiar a modo oscuro/);
  assert.match(themeSource, /Cambiar a modo claro/);
  assert.match(themeSource, /aria-pressed/);
  assert.match(themeSource, /topbar\.querySelector\("\[data-theme-toggle\]"\)/);
  assert.match(uiSource, /atinaraTheme\?\.ensureToggle\(topbar\)/);
  assert.match(css, /\.theme-toggle\s*\{[^}]*grid-area:\s*theme/s);
  assert.match(css, /\.topbar\s*\{[^}]*background:\s*var\(--header-background\)/s);
  assert.doesNotMatch(css, /filter:\s*invert\(/);
});

test("los temas comparten tokens semÃ¡nticos sin overlays globales", () => {
  const css = read("styles.css");
  assert.match(css, /html\[data-theme="dark"\]\s*\{[^}]*--background:[^}]*--surface:[^}]*--theme-text:/s);
  assert.match(css, /--yes-soft:/);
  assert.match(css, /--no-soft:/);
  assert.match(css, /--interactive-surface-hover:/);
  assert.doesNotMatch(css, /html\[data-theme="dark"\][^{]*\{[^}]*filter:/s);
  assert.doesNotMatch(css, /html\[data-theme="dark"\][^{]*::(?:before|after)/s);
});
