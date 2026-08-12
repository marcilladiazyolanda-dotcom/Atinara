import { AI_ERROR_CODES, aiError } from "./errors.mjs";

export const AI_MODEL_CATALOG_VERSION = "atinara-ai-model-catalog-v1";

export const AI_PROVIDER_CATALOG = Object.freeze({
  gemini: Object.freeze({
    providerId: "gemini",
    hostAllowlist: Object.freeze(["generativelanguage.googleapis.com"]),
    secretName: "GEMINI_API_KEY",
    experimental: false,
  }),
  openrouter: Object.freeze({
    providerId: "openrouter",
    hostAllowlist: Object.freeze(["openrouter.ai"]),
    catalogUrl: "https://openrouter.ai/api/v1/models",
    inferenceUrl: "https://openrouter.ai/api/v1/chat/completions",
    secretName: "OPENROUTER_API_KEY",
    experimental: true,
  }),
  nvidia_nim: Object.freeze({
    providerId: "nvidia_nim",
    hostAllowlist: Object.freeze(["integrate.api.nvidia.com", "build.nvidia.com"]),
    catalogUrl: "https://integrate.api.nvidia.com/v1/models",
    inferenceUrl: "https://integrate.api.nvidia.com/v1/chat/completions",
    secretName: "NVIDIA_API_KEY",
    experimental: true,
  }),
});

export const AI_MODEL_CATALOG = Object.freeze({
  "gemini.3_1_flash_lite": Object.freeze({
    providerId: "gemini",
    modelId: "gemini-3.1-flash-lite",
    capabilities: Object.freeze(["json", "structured_output"]),
  }),
  "gemini.3_5_flash_lite": Object.freeze({
    providerId: "gemini",
    modelId: "gemini-3.5-flash-lite",
    capabilities: Object.freeze(["json", "structured_output"]),
  }),
  "gemini.3_flash_preview": Object.freeze({
    providerId: "gemini",
    modelId: "gemini-3-flash-preview",
    capabilities: Object.freeze(["json", "structured_output", "interactions"]),
  }),
  "openrouter.nemotron_3_5_lightning_free": Object.freeze({
    providerId: "openrouter",
    modelId: "nvidia/nemotron-3.5-lightning:free",
    capabilities: Object.freeze(["json"]),
    exactDiscoveryId: "nvidia/nemotron-3.5-lightning:free",
    experimental: true,
  }),
  "nvidia_nim.nemotron_3_5_lightning": Object.freeze({
    providerId: "nvidia_nim",
    modelId: null,
    capabilities: Object.freeze(["json"]),
    exactDiscoveryNames: Object.freeze([
      "nvidia/nemotron-3.5-lightning",
      "nemotron-3.5-lightning",
    ]),
    experimental: true,
  }),
});

export const AI_ROUTE_CATALOG = Object.freeze({
  "gemini.legacy.radar": Object.freeze({ providerId: "gemini", modelKey: "gemini.3_1_flash_lite", adapter: "gemini_legacy", enabled: true }),
  "gemini.legacy.validator": Object.freeze({ providerId: "gemini", modelKey: "gemini.3_1_flash_lite", adapter: "gemini_legacy", enabled: true }),
  "gemini.legacy.expert": Object.freeze({ providerId: "gemini", modelKey: "gemini.3_5_flash_lite", adapter: "gemini_legacy", enabled: true }),
  "gemini.legacy.repair": Object.freeze({ providerId: "gemini", modelKey: "gemini.3_5_flash_lite", adapter: "gemini_legacy", enabled: true }),
  "gemini.legacy.resolution": Object.freeze({ providerId: "gemini", modelKey: "gemini.3_flash_preview", adapter: "gemini_legacy", enabled: true }),
  "gemini.gateway.radar": Object.freeze({ providerId: "gemini", modelKey: "gemini.3_1_flash_lite", adapter: "gemini", enabled: true }),
  "gemini.gateway.validator": Object.freeze({ providerId: "gemini", modelKey: "gemini.3_1_flash_lite", adapter: "gemini", enabled: true }),
  "gemini.gateway.expert": Object.freeze({ providerId: "gemini", modelKey: "gemini.3_5_flash_lite", adapter: "gemini", enabled: true }),
  "gemini.gateway.repair": Object.freeze({ providerId: "gemini", modelKey: "gemini.3_5_flash_lite", adapter: "gemini", enabled: true }),
  "gemini.gateway.resolution": Object.freeze({ providerId: "gemini", modelKey: "gemini.3_flash_preview", adapter: "gemini", enabled: true }),
  "openrouter.nemotron_3_5_lightning_free": Object.freeze({ providerId: "openrouter", modelKey: "openrouter.nemotron_3_5_lightning_free", adapter: "openrouter", enabled: false }),
  "nvidia_nim.nemotron_3_5_lightning": Object.freeze({ providerId: "nvidia_nim", modelKey: "nvidia_nim.nemotron_3_5_lightning", adapter: "nvidia_nim", enabled: false }),
});

export function resolveModel(modelKey) {
  const model = AI_MODEL_CATALOG[modelKey];
  if (!model) throw aiError(AI_ERROR_CODES.MODEL_NOT_AVAILABLE, { details: { phase: "model_catalog" } });
  return model;
}

export function resolveRoute(routeId) {
  const route = AI_ROUTE_CATALOG[routeId];
  if (!route) throw aiError(AI_ERROR_CODES.ROUTE_NOT_AVAILABLE, { details: { routeId } });
  const provider = AI_PROVIDER_CATALOG[route.providerId];
  const model = resolveModel(route.modelKey);
  return Object.freeze({ routeId, ...route, provider, model });
}

export function assertProviderUrl(providerId, urlValue) {
  const provider = AI_PROVIDER_CATALOG[providerId];
  let url;
  try {
    url = urlValue instanceof URL ? urlValue : new URL(urlValue);
  } catch {
    throw aiError(AI_ERROR_CODES.ROUTE_NOT_AVAILABLE, { details: { providerId, phase: "provider_url" } });
  }
  if (!provider || url.protocol !== "https:" || !provider.hostAllowlist.includes(url.hostname.toLowerCase())) {
    throw aiError(AI_ERROR_CODES.ROUTE_NOT_AVAILABLE, { details: { providerId, phase: "provider_host_allowlist" } });
  }
  return url;
}
