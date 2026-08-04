const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { test } = require("node:test");

const root = join(__dirname, "..");
const brandDirectory = join(root, "assets", "brand");
const expectedAssets = [
  "atinara-logo-dark.svg",
  "atinara-logo-light.svg",
  "atinara-symbol.svg",
  "favicon.svg",
  "atinara-karma.svg",
  "atinara-karma-light.svg",
  "icon-markets.svg",
  "icon-predict.svg",
  "icon-yes.svg",
  "icon-no.svg",
  "icon-prestige.svg",
  "icon-ranking.svg",
  "icon-open.svg",
  "icon-closed.svg",
  "icon-resolved.svg",
  "icon-source.svg",
  "icon-community.svg"
];

function luminance(hex) {
  const channels = hex.match(/[0-9a-f]{2}/gi).map((value) => parseInt(value, 16) / 255);
  const [red, green, blue] = channels.map((value) =>
    value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  );
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrast(foreground, background) {
  const first = luminance(foreground);
  const second = luminance(background);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

test("centraliza el logotipo A3, Karma y los doce glifos aprobados como SVG reales", () => {
  expectedAssets.forEach((fileName) => {
    const svg = readFileSync(join(brandDirectory, fileName), "utf8");
    assert.match(svg, /<svg[^>]+viewBox="[^"]+"/);
    assert.match(svg, /<path\b/);
    assert.doesNotMatch(svg, /<image\b|data:image\/(?:png|jpe?g|webp)|(?:href|src)=["']https?:\/\//i);
    assert.doesNotMatch(svg, /<script\b|onload=|onerror=/i);
  });
});

test("el logo y el glifo oficial conservan la geometría A3 aprobada", () => {
  const logo = readFileSync(join(brandDirectory, "atinara-logo-dark.svg"), "utf8");
  const karma = readFileSync(join(brandDirectory, "atinara-karma.svg"), "utf8");
  assert.match(logo, /M14 6h36c4\.42 0 8 3\.58 8 8v10H40\.49L32 32\.49/);
  assert.match(logo, /M202 36V0h18c10 0 16 4\.7 16 13/);
  assert.match(karma, /M4 2h4v8\.3L15 2h5\.2l-7\.6 9\.2L21 22/);
});

test("las combinaciones canónicas de texto y semántica superan WCAG 2.2 AA", () => {
  const combinations = [
    ["171225", "FAF8FC", 4.5, "Brand Ink / Background"],
    ["655F74", "FAF8FC", 4.5, "Secondary Text / Background"],
    ["FFFFFF", "5B35D5", 4.5, "White / Brand Violet"],
    ["0B7F78", "E9FBF8", 4.5, "Yes / Yes Soft"],
    ["B94459", "FFF0F2", 4.5, "No / No Soft"],
    ["9A4C12", "FFF4E8", 4.5, "Karma Copper / Karma Soft"],
    ["FFFFFF", "171225", 4.5, "White / Brand Ink"],
    ["F8F6FC", "0D0A14", 4.5, "Dark Text / Dark Background"],
    ["C8C0D4", "0D0A14", 4.5, "Dark Secondary / Dark Background"],
    ["B39CFF", "0D0A14", 4.5, "Dark Link / Dark Background"],
    ["72DED5", "123B38", 4.5, "Dark Yes / Dark Yes Soft"],
    ["FF9AAC", "411F2A", 4.5, "Dark No / Dark No Soft"],
    ["FFB477", "3B2518", 4.5, "Dark Karma / Dark Karma Soft"]
  ];
  combinations.forEach(([foreground, background, minimum, label]) => {
    assert.ok(contrast(foreground, background) >= minimum, `${label} no alcanza ${minimum}:1`);
  });
});
