import { createChildAbort, deadlineSleep } from "../deadline.mjs";
import {
  AI_ERROR_CODES,
  aiError,
  asAiGatewayError,
  classifyHttpProviderError,
  isAiGatewayError,
} from "../errors.mjs";
import { assertProviderUrl } from "../model-catalog.mjs";
import { taskGeminiRequests } from "../task-policy.mjs";

function retryAfterMilliseconds(response, now = Date.now()) {
  const value = response.headers.get("retry-after")?.trim() ?? "";
  if (!value) return null;
  if (/^\d+(?:\.\d+)?$/.test(value)) return Math.max(0, Math.ceil(Number(value) * 1_000));
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed - now) : null;
}

async function readLimitedText(response, maxBytes) {
  const declared = Number(response.headers.get("content-length") || 0);
  if (declared > maxBytes) {
    await response.body?.cancel?.();
    throw aiError(AI_ERROR_CODES.PROVIDER_RESPONSE_TOO_LARGE, { retryable: true, details: { httpStatus: response.status } });
  }
  if (!response.body?.getReader) {
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > maxBytes) {
      throw aiError(AI_ERROR_CODES.PROVIDER_RESPONSE_TOO_LARGE, { retryable: true, details: { httpStatus: response.status } });
    }
    return text;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw aiError(AI_ERROR_CODES.PROVIDER_RESPONSE_TOO_LARGE, { retryable: true, details: { httpStatus: response.status } });
      }
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}

function parseEnvelope(raw) {
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
  } catch {
    // Classified below without retaining provider payloads.
  }
  throw aiError(AI_ERROR_CODES.PROVIDER_INVALID_RESPONSE, { retryable: true, details: { phase: "provider_envelope" } });
}

function isInvalidArgument(raw) {
  try {
    const parsed = JSON.parse(raw);
    return parsed?.error?.status === "INVALID_ARGUMENT";
  } catch {
    return false;
  }
}

function canRetry(error, attempt, maximum) {
  if (attempt >= maximum) return false;
  const ai = asAiGatewayError(error);
  return ai.retryable && [
    AI_ERROR_CODES.PROVIDER_TIMEOUT,
    AI_ERROR_CODES.PROVIDER_RATE_LIMITED,
    AI_ERROR_CODES.PROVIDER_NETWORK_ERROR,
    AI_ERROR_CODES.PROVIDER_HTTP_ERROR,
  ].includes(ai.code);
}

async function sendRequest({ spec, body, apiKey, policy, route, context, fetchImpl, attempt }) {
  const url = assertProviderUrl("gemini", `https://generativelanguage.googleapis.com${spec.path}`);
  const child = createChildAbort(context, policy.timeoutMs, policy.finalizationReserveMs);
  const startedAt = performance.now();
  try {
    const response = await fetchImpl(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
        ...(spec.headers ?? {}),
      },
      body: JSON.stringify(body),
      signal: child.signal,
    });
    const raw = await readLimitedText(response, policy.maxOutputBytes);
    const metadata = {
      endpoint: spec.endpoint,
      httpStatus: response.status,
      durationMs: Math.round(performance.now() - startedAt),
      responseBytes: new TextEncoder().encode(raw).byteLength,
      retryCount: attempt,
      requestId: (response.headers.get("x-goog-request-id") || response.headers.get("x-request-id") || "").slice(0, 160) || null,
    };
    if (!response.ok) {
      const error = classifyHttpProviderError(response.status, {
        providerId: route.providerId,
        routeId: route.routeId,
        retryAfterSeconds: response.status === 429 ? Math.ceil((retryAfterMilliseconds(response) ?? 0) / 1_000) : null,
      });
      // La compatibilidad de schema necesita solo esta señal booleana. Nunca
      // adjuntar el payload ni el objeto Response al error que cruza capas.
      error.schemaInvalidArgument = response.status === 400 && isInvalidArgument(raw);
      throw error;
    }
    const payload = parseEnvelope(raw);
    return {
      payload,
      metadata: { ...metadata, usage: payload.usageMetadata ?? null },
      raw,
      response,
    };
  } catch (error) {
    if (isAiGatewayError(error)) throw error;
    const aborted = child.signal.aborted;
    throw aiError(aborted ? AI_ERROR_CODES.PROVIDER_TIMEOUT : AI_ERROR_CODES.PROVIDER_NETWORK_ERROR, {
      httpStatus: aborted ? 504 : 503,
      retryable: true,
      cause: error instanceof Error ? error : undefined,
      details: { providerId: route.providerId, routeId: route.routeId },
    });
  } finally {
    child.cleanup();
  }
}

async function executeSpec(options, spec) {
  let body = spec.body;
  let schemaFallback = false;
  for (let attempt = 0; attempt <= options.policy.httpRetries; attempt += 1) {
    try {
      return { ...(await sendRequest({ ...options, spec, body, attempt })), schemaFallback };
    } catch (error) {
      const ai = asAiGatewayError(error);
      if (options.policy.schemaFallback !== false && !schemaFallback && spec.schemaFallbackBody
        && ai.details.httpStatus === 400 && error?.schemaInvalidArgument === true) {
        schemaFallback = true;
        body = spec.schemaFallbackBody;
        attempt -= 1;
        continue;
      }
      if (!canRetry(ai, attempt, options.policy.httpRetries)) throw ai;
      const retryMs = ai.code === AI_ERROR_CODES.PROVIDER_RATE_LIMITED
        ? Math.min(8_000, Math.max(0, Number(ai.details.retryAfterSeconds) * 1_000 || 0))
        : Math.min(8_000, 400 * (2 ** attempt));
      await deadlineSleep(retryMs, options.context, options.policy.finalizationReserveMs);
    }
  }
  throw aiError(AI_ERROR_CODES.PROVIDER_INVALID_RESPONSE, { retryable: true });
}

function endpointFallbackAllowed(spec, error) {
  const status = Number(asAiGatewayError(error).details.httpStatus ?? 0);
  return Array.isArray(spec.fallbackOnStatuses) && spec.fallbackOnStatuses.includes(status);
}

export async function invokeGeminiLegacy({
  taskType, input, policy, route, apiKey, context, fetchImpl, parseOutput, outputRetryPhase = null,
}) {
  const specs = taskGeminiRequests(taskType, input, route.model.modelId, { outputRetryPhase });
  let lastError = null;
  for (let index = 0; index < specs.length; index += 1) {
    const spec = specs[index];
    try {
      const response = await executeSpec({ taskType, input, policy, route, apiKey, context, fetchImpl }, spec);
      const value = parseOutput(response.payload, spec.endpoint);
      return {
        value,
        metadata: {
          ...response.metadata,
          schemaFallback: response.schemaFallback,
          adapter: "gemini_legacy",
        },
      };
    } catch (error) {
      lastError = asAiGatewayError(error);
      const hasNext = index + 1 < specs.length;
      const invalidOutput = [AI_ERROR_CODES.PROVIDER_INVALID_RESPONSE, AI_ERROR_CODES.OUTPUT_CONTRACT_INVALID].includes(lastError.code);
      if (!hasNext || (!invalidOutput && !endpointFallbackAllowed(spec, lastError))) throw lastError;
    }
  }
  throw lastError ?? aiError(AI_ERROR_CODES.PROVIDER_INVALID_RESPONSE, { retryable: true });
}
