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
  const availabilitySource = readFileSync(
    join(repositoryRoot, "checks", "oraklo-availability.check.ts"),
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
    "https://marcilladiazyolanda-dotcom.github.io/Atinara/"
  );
  assert.match(
    configSource,
    /repoUrl: "https:\/\/github\.com\/marcilladiazyolanda-dotcom\/Atinara"/
  );
  assert.match(
    availabilitySource,
    /const productionUrl = "https:\/\/marcilladiazyolanda-dotcom\.github\.io\/Atinara\/";/
  );
  assert.doesNotMatch(configSource + availabilitySource, /\/oraklo-prototype-2\.0\/|github\.io\/atinara\//);
  assert.deepEqual(resolvedUrls, [
    "https://marcilladiazyolanda-dotcom.github.io/Atinara/",
    "https://marcilladiazyolanda-dotcom.github.io/Atinara/community.html",
    "https://marcilladiazyolanda-dotcom.github.io/Atinara/admin-community.html",
    "https://marcilladiazyolanda-dotcom.github.io/Atinara/admin-resolution.html"
  ]);
});
