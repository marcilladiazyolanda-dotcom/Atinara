(function initMarketFamilyExplorer(globalScope) {
  "use strict";

  function safeText(value, max = 500) {
    return String(value ?? "").trim().slice(0, max);
  }

  function timestamp(value) {
    const parsed = Date.parse(value || "");
    return Number.isFinite(parsed) ? parsed : Number.MAX_SAFE_INTEGER;
  }

  function sortChildren(children) {
    return [...children].sort((left, right) =>
      timestamp(left.familySortAt || left.cierreFecha) - timestamp(right.familySortAt || right.cierreFecha)
      || safeText(left.familyChildKey).localeCompare(safeText(right.familyChildKey), "es")
      || safeText(left.id).localeCompare(safeText(right.id), "es")
    );
  }

  function groupMarkets(markets) {
    const values = Array.isArray(markets) ? markets : [];
    const byFamily = new Map();
    values.forEach((market) => {
      const key = safeText(market?.familyKey, 240);
      if (!key) return;
      if (!byFamily.has(key)) byFamily.set(key, []);
      byFamily.get(key).push(market);
    });
    const emitted = new Set();
    const result = [];
    values.forEach((market) => {
      const key = safeText(market?.familyKey, 240);
      const siblings = key ? byFamily.get(key) || [] : [];
      if (!key || siblings.length < 2) {
        result.push({ kind: "market", market });
        return;
      }
      if (emitted.has(key)) return;
      emitted.add(key);
      const children = sortChildren(siblings);
      const first = children[0];
      result.push({
        kind: "family",
        key,
        title: safeText(first.familyTitle, 300) || "Mercados relacionados",
        type: safeText(first.familyType, 80) || "generic_related",
        semantics: first.familySemantics && typeof first.familySemantics === "object" ? first.familySemantics : {},
        children,
      });
    });
    return result;
  }

  function searchableText(market) {
    return [
      market?.pregunta,
      market?.categoria,
      market?.familyTitle,
      market?.familyChildLabel,
      market?.familyType,
    ].map((value) => safeText(value, 500)).join(" ");
  }

  function familySemanticsLabel(group) {
    if (group?.type === "deadline_ladder") {
      return "Umbrales temporales acumulativos y no exclusivos. Cada fecha conserva su propio precio y actividad.";
    }
    return "Opciones relacionadas para navegar juntas; cada mercado mantiene precio, estado y actividad independientes.";
  }

  const api = Object.freeze({ groupMarkets, searchableText, familySemanticsLabel, sortChildren });
  globalScope.AtinaraMarketFamilies = api;
  if (typeof module === "object" && module.exports) module.exports = api;
})(typeof window === "object" ? window : globalThis);
