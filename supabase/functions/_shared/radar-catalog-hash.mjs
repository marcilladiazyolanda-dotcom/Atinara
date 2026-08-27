import { createHash } from "node:crypto";

import { canonicalJson } from "./ai/contracts.mjs";

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const KALSHI_CATALOG_ENTITY_POLICY_VERSION = "atinara-kalshi-catalog-entities-v1";
const KALSHI_CATALOG_PROJECTION_VERSION = "atinara-kalshi-series-catalog-projection-v1";

/**
 * Conserva el contrato canónico V1 sin materializar en memoria el catálogo
 * completo serializado. Las filas deben llegar ya ordenadas por ticker, como
 * exige el discovery que además valida identidades duplicadas.
 */
export function sha256KalshiCatalogProjectionV1(input = {}) {
  const entityPolicyVersion = String(input.entity_policy_version ?? "");
  const entityTermsHash = String(input.entity_terms_hash ?? "");
  const projectionVersion = String(input.projection_version ?? "");
  const series = Array.isArray(input.series) ? input.series : null;
  if (entityPolicyVersion !== KALSHI_CATALOG_ENTITY_POLICY_VERSION
      || projectionVersion !== KALSHI_CATALOG_PROJECTION_VERSION
      || !SHA256_PATTERN.test(entityTermsHash)
      || !series) {
    throw new TypeError("PROVIDER_DISCOVERY_CATALOG_HASH_INVALID");
  }

  const digest = createHash("sha256");
  digest.update('{"entity_policy_version":');
  digest.update(canonicalJson(entityPolicyVersion));
  digest.update(',"entity_terms_hash":');
  digest.update(canonicalJson(entityTermsHash));
  digest.update(',"projection_version":');
  digest.update(canonicalJson(projectionVersion));
  digest.update(',"series":[');

  let previousTicker = "";
  for (let index = 0; index < series.length; index += 1) {
    const projection = series[index];
    const ticker = typeof projection?.ticker === "string" ? projection.ticker : "";
    if (!ticker || (index > 0 && ticker <= previousTicker)) {
      throw new TypeError("PROVIDER_DISCOVERY_SERIES_IDENTITY_INVALID");
    }
    if (index > 0) digest.update(",");
    digest.update(canonicalJson(projection));
    previousTicker = ticker;
  }
  digest.update("]}");
  return digest.digest("hex");
}
