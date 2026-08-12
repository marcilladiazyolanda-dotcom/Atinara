import { AI_ERROR_CODES, aiError, classifyHttpProviderError } from "./errors.mjs";
import { createChildAbort } from "./deadline.mjs";
import { AI_PROVIDER_CATALOG, assertProviderUrl, resolveRoute } from "./model-catalog.mjs";

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function modelRows(payload) {
  if (!isRecord(payload)) return [];
  if (Array.isArray(payload.data)) return payload.data.filter(isRecord);
  if (Array.isArray(payload.models)) return payload.models.filter(isRecord);
  return [];
}

function modelId(row) {
  for (const key of ["id", "name", "model", "model_id"]) {
    if (typeof row[key] === "string" && row[key].trim()) return row[key].trim();
  }
  return "";
}

function compatible(row) {
  const architecture = isRecord(row.architecture) ? row.architecture : {};
  const outputModalities = Array.isArray(architecture.output_modalities) ? architecture.output_modalities : [];
  const parameters = [
    ...(Array.isArray(row.supported_parameters) ? row.supported_parameters : []),
    ...(Array.isArray(row.capabilities) ? row.capabilities : []),
  ].map((item) => String(item).toLowerCase());
  const textCompatible = outputModalities.length === 0 || outputModalities.includes("text");
  const structuredCompatible = parameters.some((item) => [
    "response_format", "json", "json_object", "json_schema", "structured_output",
  ].includes(item));
  return textCompatible && structuredCompatible;
}

async function readCatalog(response, maxBytes = 2_000_000) {
  const declared = Number(response.headers.get("content-length") || 0);
  if (declared > maxBytes) {
    await response.body?.cancel?.();
    throw aiError(AI_ERROR_CODES.PROVIDER_RESPONSE_TOO_LARGE, { retryable: true });
  }
  const raw = await response.text();
  if (new TextEncoder().encode(raw).byteLength > maxBytes) {
    throw aiError(AI_ERROR_CODES.PROVIDER_RESPONSE_TOO_LARGE, { retryable: true });
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw aiError(AI_ERROR_CODES.PROVIDER_INVALID_RESPONSE, { retryable: true });
  }
}

export const AI_CAPABILITY_DISCOVERY_MAX_AGE_MS = 24 * 60 * 60 * 1_000;

export function routeCapabilityAvailable(route, capability, dataClass, now = Date.now()) {
  if (!isRecord(capability) || capability.available !== true) return false;
  const discoveredAt = Date.parse(String(capability.discoveredAt ?? ""));
  if (!Number.isFinite(discoveredAt) || discoveredAt > now + 60_000
    || now - discoveredAt > AI_CAPABILITY_DISCOVERY_MAX_AGE_MS) return false;
  if (capability.endpointUrl !== route.provider.inferenceUrl
    || capability.structuredOutput !== true
    || !Array.isArray(capability.dataClasses)
    || !capability.dataClasses.includes(dataClass)) return false;
  if (route.providerId === "openrouter") return capability.exactModelId === route.model.exactDiscoveryId;
  return Array.isArray(route.model.exactDiscoveryNames)
    && route.model.exactDiscoveryNames.includes(capability.exactModelId);
}

export async function discoverRouteCapability({ routeId, apiKey, context, fetchImpl = globalThis.fetch, liveAuthorized = false }) {
  const route = resolveRoute(routeId);
  if (!route.provider.experimental) {
    return Object.freeze({
      available: true,
      exactModelId: route.model.modelId,
      endpointUrl: null,
      structuredOutput: true,
      dataClasses: ["public_market", "private_market_minimized"],
      discoveredAt: new Date().toISOString(),
    });
  }
  if (liveAuthorized !== true) throw aiError(AI_ERROR_CODES.CAPABILITY_DISCOVERY_REQUIRED, { details: { routeId, providerId: route.providerId } });
  if (!apiKey) throw aiError(AI_ERROR_CODES.PROVIDER_NOT_CONFIGURED, { details: { routeId, providerId: route.providerId } });
  if (typeof fetchImpl !== "function") throw aiError(AI_ERROR_CODES.ROUTE_NOT_AVAILABLE, { details: { routeId } });
  const catalogUrl = assertProviderUrl(route.providerId, AI_PROVIDER_CATALOG[route.providerId].catalogUrl);
  const child = createChildAbort(context, 15_000, 10_000);
  try {
    const response = await fetchImpl(catalogUrl, {
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
      signal: child.signal,
    });
    if (!response.ok) throw classifyHttpProviderError(response.status, { providerId: route.providerId, routeId });
    const payload = await readCatalog(response);
    const rows = modelRows(payload);
    const expected = route.providerId === "openrouter"
      ? [route.model.exactDiscoveryId]
      : route.model.exactDiscoveryNames;
    const found = rows.find((row) => expected.includes(modelId(row)) && compatible(row));
    if (!found) {
      return Object.freeze({
        available: false,
        exactModelId: null,
        endpointUrl: route.provider.inferenceUrl,
        structuredOutput: false,
        dataClasses: ["public_market"],
        discoveredAt: new Date().toISOString(),
        reason: AI_ERROR_CODES.MODEL_NOT_AVAILABLE,
      });
    }
    return Object.freeze({
      available: true,
      exactModelId: modelId(found),
      endpointUrl: route.provider.inferenceUrl,
      structuredOutput: true,
      dataClasses: ["public_market"],
      discoveredAt: new Date().toISOString(),
    });
  } catch (error) {
    if (error?.code) throw error;
    throw aiError(child.signal.aborted ? AI_ERROR_CODES.PROVIDER_TIMEOUT : AI_ERROR_CODES.PROVIDER_NETWORK_ERROR, {
      retryable: true,
      cause: error instanceof Error ? error : undefined,
      details: { routeId, providerId: route.providerId },
    });
  } finally {
    child.cleanup();
  }
}
