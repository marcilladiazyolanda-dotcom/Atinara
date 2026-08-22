const SPANISH_MARKET_EVIDENCE = /\b(?:si|fuente|periodo|fecha|cumple|cumplira|ocurre|ocurrira|sucede|sucedera|gana|ganara|pierde|perdera|sera|habra|llegara|lanzara|estrenara|recibira|lograra|estara|tendra|podra|publica|publicara|confirma|confirmara|anuncia|anunciara|obtiene|obtendra|alcanza|alcanzara|supera|superara|queda|quedara|termina|terminara|cerrara|resuelve|resolvera|considera|considerara|debera|resolucion|segun|antes|despues|durante|hasta|cuando|criterio|opcion|oficial|caso|contrario)\b/i;

function hasSpanishMarketEvidence(value) {
  return SPANISH_MARKET_EVIDENCE.test(value.normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "").toLowerCase());
}

export function essentialMarketTextNotSpanish(values) {
  const material = (Array.isArray(values) ? values : []).map((value) => (
    typeof value === "string" ? value.trim().slice(0, 4_000) : ""
  ));
  if (!material.some(Boolean)) return false;
  const question = material[0] || "";
  if (question && (!question.startsWith("¿") || !hasSpanishMarketEvidence(question))) {
    return true;
  }
  return material.slice(1).some((value) => value && !hasSpanishMarketEvidence(value));
}
