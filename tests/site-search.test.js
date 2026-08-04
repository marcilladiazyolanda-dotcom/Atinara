const assert = require("node:assert/strict");
const { test } = require("node:test");

const ui = require("../site-ui.js");

const markets = [
  { id: "silksong", pregunta: "¿Hollow Knight: Silksong tendrá 90 o más?", categoria: "Reviews/Premios", estado: "Abierto" },
  { id: "xbox", pregunta: "¿Xbox anunciará una adquisición este año?", categoria: "Industria", estado: "Abierto" },
  { id: "gta", pregunta: "¿GTA VI se retrasará oficialmente?", categoria: "Lanzamientos", estado: "Resuelto" }
];

test("el buscador encuentra mercados reales por pregunta, categoría y estado", () => {
  assert.deepEqual(ui.filterMarkets(markets, "silksong").map((item) => item.id), ["silksong"]);
  assert.deepEqual(ui.filterMarkets(markets, "industria").map((item) => item.id), ["xbox"]);
  assert.deepEqual(ui.filterMarkets(markets, "resuelto").map((item) => item.id), ["gta"]);
});

test("el buscador normaliza acentos, limita resultados y no fabrica coincidencias", () => {
  assert.deepEqual(ui.filterMarkets(markets, "adquisicion").map((item) => item.id), ["xbox"]);
  assert.equal(ui.filterMarkets(markets, "mercado inexistente").length, 0);
  assert.equal(ui.filterMarkets([...markets, ...markets], "abierto", 2).length, 2);
});

test("la navegación conserva el orden canónico y omite únicamente la página actual", () => {
  assert.equal(ui.normalizeCurrentPage("/Atinara/"), "index.html");
  assert.equal(ui.normalizeCurrentPage("/Atinara/index.html"), "index.html");
  assert.deepEqual(
    ui.getNavigationDestinations("/Atinara/community.html").map((item) => item.label),
    [
      "Explorar mercados",
      "Clasificación",
      "Mis predicciones",
      "Gestionar mercados",
      "Resolver mercados",
      "Moderar comunidad"
    ]
  );
  assert.deepEqual(
    ui.getNavigationDestinations("/Atinara/admin-resolution.html").map((item) => item.label),
    [
      "Explorar mercados",
      "Comunidad",
      "Clasificación",
      "Mis predicciones",
      "Gestionar mercados",
      "Moderar comunidad"
    ]
  );
  assert.equal(
    ui.getNavigationDestinations("/Atinara/profile.html").filter((item) => item.adminOnly).length,
    3
  );
});

test("el formateador de Karma coloca el glifo después de la cifra y conserva la etiqueta accesible", () => {
  const markup = ui.formatKarmaAmount(200);
  assert.match(markup, />200<\/span><img class="karma-glyph"/);
  assert.match(markup, /aria-label="200 Karma"/);
  assert.doesNotMatch(markup, />K 200|>200 K</);
});

test("el escape compartido neutraliza contenido HTML malicioso", () => {
  assert.equal(ui.escapeHtml('<img src=x onerror="alert(1)">'), "&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
});

test("la navegacion publica omite por completo los destinos administrativos", () => {
  const labels = ui.getNavigationDestinations("/Atinara/index.html", { includeAdmin: false })
    .map((destination) => destination.label);

  assert.deepEqual(labels, ["Comunidad", "Clasificación", "Mis predicciones"]);
});
