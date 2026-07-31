const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");

test("las rutas de Checkly conservan la subcarpeta de GitHub Pages", () => {
  const repositoryRoot = join(__dirname, "..");
  const configSource = readFileSync(
    join(repositoryRoot, "checkly.config.ts"),
    "utf8"
  );
  const browserCheckSource = readFileSync(
    join(repositoryRoot, "checks", "oraklo-public.spec.ts"),
    "utf8"
  );

  const productionUrlMatch = configSource.match(
    /const productionUrl = "([^"]+)";/
  );
  assert.ok(productionUrlMatch, "No se encontró la URL de producción de Checkly.");

  const productionUrl = productionUrlMatch[1];
  const navigationTargets = Array.from(
    browserCheckSource.matchAll(/page\.goto\("([^"]+)"\)/g),
    (match) => match[1]
  );
  const resolvedUrls = navigationTargets.map(
    (target) => new URL(target, productionUrl).href
  );

  assert.equal(
    productionUrl,
    "https://marcilladiazyolanda-dotcom.github.io/atinara/"
  );
  assert.deepEqual(resolvedUrls, [
    "https://marcilladiazyolanda-dotcom.github.io/atinara/",
    "https://marcilladiazyolanda-dotcom.github.io/atinara/community.html",
    "https://marcilladiazyolanda-dotcom.github.io/atinara/admin-community.html",
    "https://marcilladiazyolanda-dotcom.github.io/atinara/admin-resolution.html"
  ]);
});
