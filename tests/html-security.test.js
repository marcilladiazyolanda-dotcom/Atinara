const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { test } = require("node:test");

const htmlFiles = [
  "admin-community.html",
  "admin-resolution.html",
  "community.html",
  "index.html",
  "market-detail.html",
  "my-predictions.html",
  "profile.html",
  "ranking.html"
];

const supabaseScriptUrl =
  "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.111.0";
const supabaseScriptIntegrity =
  "sha384-fPWur1rx/DE6YtXP/x0MD6dd90RgnVsz5yX/DIg7CcVAnTBZsENWuIcpvVTM39ti";

test("protege el script externo de Supabase con versión fija y SRI", () => {
  htmlFiles.forEach((fileName) => {
    const html = readFileSync(join(__dirname, "..", fileName), "utf8");

    assert.match(html, new RegExp(`src="${supabaseScriptUrl.replaceAll(".", "\\.")}"`));
    assert.match(html, new RegExp(`integrity="${supabaseScriptIntegrity}"`));
    assert.match(html, /crossorigin="anonymous"/);
    assert.doesNotMatch(
      html,
      /cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js@2"/
    );
  });
});
