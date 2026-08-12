import { invokeGeminiLegacy } from "./gemini-legacy.mjs";

export async function invokeGemini(options) {
  const result = await invokeGeminiLegacy(options);
  return { ...result, metadata: { ...result.metadata, adapter: "gemini_gateway_parity" } };
}
