import { AI_ERROR_CODES, aiError } from "../errors.mjs";
import { invokeOpenAiCompatible } from "./openai-compatible.mjs";

export async function invokeOpenRouter(options) {
  if (options.capability?.available !== true || options.capability?.exactModelId !== options.route.model.exactDiscoveryId) {
    throw aiError(AI_ERROR_CODES.MODEL_NOT_AVAILABLE, { details: { providerId: "openrouter", routeId: options.route.routeId } });
  }
  const result = await invokeOpenAiCompatible({
    ...options,
    endpointUrl: options.route.provider.inferenceUrl,
    extraBody: { provider: { allow_fallbacks: false } },
  });
  return { ...result, metadata: { ...result.metadata, adapter: "openrouter", allowFallbacks: false } };
}
