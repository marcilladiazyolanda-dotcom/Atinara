import { createHash } from "node:crypto";

import { canonicalJson } from "./ai/contracts.mjs";

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const KALSHI_CATALOG_ENTITY_POLICY_VERSION = "atinara-kalshi-catalog-entities-v1";
const KALSHI_CATALOG_PROJECTION_VERSION = "atinara-kalshi-series-catalog-projection-v1";
const KALSHI_CATALOG_PROJECTION_VERSION_V2 = "atinara-kalshi-series-catalog-projection-v2";

/**
 * Conserva el contrato canónico V1 sin materializar en memoria el catálogo
 * completo serializado. Las filas deben llegar ya ordenadas por ticker, como
 * exige el discovery que además valida identidades duplicadas.
 */
export function sha256KalshiCatalogProjectionV1(input = {}) {
  const entityPolicyVersion = String(input.entity_policy_version ?? "");
  const entityTermsHash = String(input.entity_terms_hash ?? "");
  const projectionVersion = String(input.projection_version ?? "");
  const series = input.series;
  const iterator = series != null && typeof series !== "string"
    ? series[Symbol.iterator] : null;
  if (entityPolicyVersion !== KALSHI_CATALOG_ENTITY_POLICY_VERSION
      || projectionVersion !== KALSHI_CATALOG_PROJECTION_VERSION
      || !SHA256_PATTERN.test(entityTermsHash)
      || typeof iterator !== "function") {
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
  let index = 0;
  for (const projection of series) {
    const ticker = typeof projection?.ticker === "string" ? projection.ticker : "";
    if (!ticker || (index > 0 && ticker <= previousTicker)) {
      throw new TypeError("PROVIDER_DISCOVERY_SERIES_IDENTITY_INVALID");
    }
    if (index > 0) digest.update(",");
    digest.update(canonicalJson(projection));
    previousTicker = ticker;
    index += 1;
  }
  digest.update("]}");
  return digest.digest("hex");
}

function isNullableText(value) {
  return value === null || typeof value === "string";
}

function isKalshiCatalogProjectionV2(projection) {
  if (!Array.isArray(projection) || projection.length !== 9
      || typeof projection[0] !== "string" || !projection[0]
      || typeof projection[1] !== "string"
      || typeof projection[2] !== "string"
      || !Array.isArray(projection[3])
      || !projection[3].every((value) => typeof value === "string")
      || !isNullableText(projection[4])
      || !(projection[5] === null || (Array.isArray(projection[5])
        && projection[5].length === 3 && projection[5].every(isNullableText)))
      || !Array.isArray(projection[6])
      || !projection[6].every((source) => Array.isArray(source)
        && source.length === 2 && isNullableText(source[0])
        && typeof source[1] === "string" && Boolean(source[1]))
      || !isNullableText(projection[7])
      || !isNullableText(projection[8])) return false;
  return true;
}

function canonicalKalshiCatalogProjectionV1FromTuple(projection) {
  if (!isKalshiCatalogProjectionV2(projection)) {
    throw new TypeError("PROVIDER_DISCOVERY_CATALOG_PROJECTION_INVALID");
  }
  const importantInfo = projection[5] === null
    ? "null"
    : `{"markdown":${JSON.stringify(projection[5][2])},"message":${JSON.stringify(projection[5][1])},"title":${JSON.stringify(projection[5][0])}}`;
  const settlementSources = projection[6].map((source) =>
    `{"name":${JSON.stringify(source[0])},"url":${JSON.stringify(source[1])}}`).join(",");
  return `{"category":${JSON.stringify(projection[2])},"last_updated_ts":${JSON.stringify(projection[8])},"product_important_info":${importantInfo},"product_scope":${JSON.stringify(projection[4])},"settlement_sources":[${settlementSources}],"tags":${JSON.stringify(projection[3])},"ticker":${JSON.stringify(projection[0])},"title":${JSON.stringify(projection[1])},"volume_fp":${JSON.stringify(projection[7])}}`;
}

/**
 * Reproduce byte a byte el contrato canónico V1 desde tuplas compactas. Así el
 * checkpoint y la RPC aplicada conservan una única versión auditable sin volver
 * a materializar objetos ni ordenar claves para cada fila del catálogo global.
 */
export function sha256KalshiCatalogProjectionV1FromTuples(input = {}) {
  const entityPolicyVersion = String(input.entity_policy_version ?? "");
  const entityTermsHash = String(input.entity_terms_hash ?? "");
  const projectionVersion = String(input.projection_version ?? "");
  const series = input.series;
  const iterator = series != null && typeof series !== "string"
    ? series[Symbol.iterator] : null;
  if (entityPolicyVersion !== KALSHI_CATALOG_ENTITY_POLICY_VERSION
      || projectionVersion !== KALSHI_CATALOG_PROJECTION_VERSION
      || !SHA256_PATTERN.test(entityTermsHash)
      || typeof iterator !== "function") {
    throw new TypeError("PROVIDER_DISCOVERY_CATALOG_HASH_INVALID");
  }

  const digest = createHash("sha256");
  digest.update('{"entity_policy_version":');
  digest.update(JSON.stringify(entityPolicyVersion));
  digest.update(',"entity_terms_hash":');
  digest.update(JSON.stringify(entityTermsHash));
  digest.update(',"projection_version":');
  digest.update(JSON.stringify(projectionVersion));
  digest.update(',"series":[');

  let previousTicker = "";
  let index = 0;
  for (const projection of series) {
    if (!isKalshiCatalogProjectionV2(projection)) {
      throw new TypeError("PROVIDER_DISCOVERY_CATALOG_PROJECTION_INVALID");
    }
    const ticker = projection[0];
    if (index > 0 && ticker <= previousTicker) {
      throw new TypeError("PROVIDER_DISCOVERY_SERIES_IDENTITY_INVALID");
    }
    if (index > 0) digest.update(",");
    digest.update(canonicalKalshiCatalogProjectionV1FromTuple(projection));
    previousTicker = ticker;
    index += 1;
  }
  digest.update("]}");
  return digest.digest("hex");
}

/**
 * Sella la misma evidencia material que V1 mediante una tupla versionada de
 * arrays y escalares. El orden estructural es parte del contrato V2 y evita
 * ordenar claves y materializar objetos canónicos para cada fila global.
 */
export function sha256KalshiCatalogProjectionV2(input = {}) {
  const entityPolicyVersion = String(input.entity_policy_version ?? "");
  const entityTermsHash = String(input.entity_terms_hash ?? "");
  const projectionVersion = String(input.projection_version ?? "");
  const series = input.series;
  const iterator = series != null && typeof series !== "string"
    ? series[Symbol.iterator] : null;
  if (entityPolicyVersion !== KALSHI_CATALOG_ENTITY_POLICY_VERSION
      || projectionVersion !== KALSHI_CATALOG_PROJECTION_VERSION_V2
      || !SHA256_PATTERN.test(entityTermsHash)
      || typeof iterator !== "function") {
    throw new TypeError("PROVIDER_DISCOVERY_CATALOG_HASH_INVALID");
  }

  const digest = createHash("sha256");
  digest.update('{"entity_policy_version":');
  digest.update(JSON.stringify(entityPolicyVersion));
  digest.update(',"entity_terms_hash":');
  digest.update(JSON.stringify(entityTermsHash));
  digest.update(',"projection_version":');
  digest.update(JSON.stringify(projectionVersion));
  digest.update(',"series":[');

  let previousTicker = "";
  let index = 0;
  for (const projection of series) {
    if (!isKalshiCatalogProjectionV2(projection)) {
      throw new TypeError("PROVIDER_DISCOVERY_CATALOG_PROJECTION_INVALID");
    }
    const ticker = projection[0];
    if (index > 0 && ticker <= previousTicker) {
      throw new TypeError("PROVIDER_DISCOVERY_SERIES_IDENTITY_INVALID");
    }
    if (index > 0) digest.update(",");
    digest.update(JSON.stringify(projection));
    previousTicker = ticker;
    index += 1;
  }
  digest.update("]}");
  return digest.digest("hex");
}
