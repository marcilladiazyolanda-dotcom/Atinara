import { AI_ERROR_CODES, aiError } from "../errors.mjs";
import { invokeOpenAiCompatible } from "./openai-compatible.mjs";

export async function invokeNvidiaNim(options) {
  const exactModelId = options.capability?.exactModelId;
  if (options.capability?.available !== true || typeof exactModelId !== "string" || !options.route.model.exactDiscoveryNames.includes(exactModelId)) {
    throw aiError(AI_ERROR_CODES.MODEL_NOT_AVAILABLE, { details: { providerId: "nvidia_nim", routeId: options.route.routeId } });
  }
  const route = { ...options.route, model: { ...options.route.model, modelId: exactModelId } };
  const result = await invokeOpenAiCompatible({ ...options, route, endpointUrl: route.provider.inferenceUrl });
  return { ...result, metadata: { ...result.metadata, adapter: "nvidia_nim", resolvedModelId: exactModelId } };
}
