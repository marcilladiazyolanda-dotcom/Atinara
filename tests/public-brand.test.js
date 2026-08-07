const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { test } = require("node:test");

const repositoryRoot = join(__dirname, "..");
const publicHtmlFiles = [
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

const publicTextSources = [
  "admin-community.js",
  "admin-markets.js",
  "admin-resolution.js",
  "auth.js",
  "community.js",
  "market-detail.js",
  "profile.js",
  "ranking.js",
  "script.js",
  "site-ui.js",
  "supabase/functions/analyze-market-resolution/index.ts"
];

function readRepositoryFile(fileName) {
  return readFileSync(join(repositoryRoot, fileName), "utf8");
}

test("presenta Atinara como única marca pública en todas las páginas", () => {
  publicHtmlFiles.forEach((fileName) => {
    const html = readRepositoryFile(fileName);

    assert.match(html, /<title>Atinara \|[^<]+<\/title>/);
    assert.match(html, /<meta name="application-name" content="Atinara">/);
    assert.match(html, /<meta property="og:site_name" content="Atinara">/);
    assert.match(html, /<meta property="og:title" content="Atinara \|[^">]+">/);
    assert.match(html, /<meta property="og:description" content="[^">]+Atinara[^">]*">/);
    assert.match(html, /<meta name="twitter:card" content="summary">/);
    assert.match(html, /class="brand"/);
    assert.match(html, /site-ui\.js\?v=20260807-radar3/);
    assert.match(html, /assets\/brand\/favicon\.svg/);
    assert.doesNotMatch(html, /\bOraklo\b/);
  });
});

test("mantiene coordinada la versión de los recursos públicos", () => {
  publicHtmlFiles.forEach((fileName) => {
    const html = readRepositoryFile(fileName);
    const versions = Array.from(
      html.matchAll(/(?:href|src)="(?!https?:)[^"]+\?v=([^"]+)"/g),
      (match) => match[1]
    );

    assert.ok(versions.length > 0, `${fileName} no versiona sus recursos locales.`);
    assert.deepEqual(
      [...new Set(versions)],
      ["20260807-radar3"],
      `${fileName} mezcla versiones de caché.`
    );
  });
});

test("evita indexar los paneles administrativos y la recuperación", () => {
  ["admin-community.html", "admin-markets.html", "admin-resolution.html", "reset-password.html"].forEach((fileName) => {
    const html = readRepositoryFile(fileName);

    assert.match(html, /<meta name="robots" content="noindex, nofollow">/);
  });
});

test("no genera textos visibles con la marca pública anterior", () => {
  publicTextSources.forEach((fileName) => {
    const source = readRepositoryFile(fileName);

    assert.match(source, /\bAtinara\b/, `${fileName} no contiene la marca pública actual.`);
    assert.doesNotMatch(
      source,
      /\bOraklo\b/,
      `${fileName} todavía puede mostrar la marca pública anterior.`
    );
  });
});

test("la Edge Function enlaza la ficha con la URL canónica exacta", () => {
  const source = readRepositoryFile(
    "supabase/functions/analyze-market-resolution/index.ts"
  );

  assert.match(
    source,
    /"https:\/\/marcilladiazyolanda-dotcom\.github\.io\/Atinara\/"/
  );
  assert.doesNotMatch(
    source,
    /\/oraklo-prototype-2\.0\/|github\.io\/atinara\//
  );
});
