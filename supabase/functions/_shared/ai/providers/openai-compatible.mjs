import { createChildAbort, deadlineSleep } from "../deadline.mjs";
import { AI_ERROR_CODES, aiError, asAiGatewayError, classifyHttpProviderError } from "../errors.mjs";
import { assertProviderUrl } from "../model-catalog.mjs";
import { taskGeminiRequests } from "../task-policy.mjs";

function promptForTask(taskType, input, modelId) {
  const spec = taskGeminiRequests(taskType, input, modelId)[0];
  if (typeof spec.body?.input === "string") return { system: "", user: spec.body.input, schema: spec.body.response_format?.schema ?? null };
  const system = spec.body?.systemInstruction?.parts?.map((part) => part.text).filter(Boolean).join("\n") ?? "";
  const user = spec.body?.contents?.flatMap((item) => item.parts ?? []).map((part) => part.text).filter(Boolean).join("\n") ?? "";
  return { system, user, schema: spec.body?.generationConfig?.responseJsonSchema ?? null };
}

async function readLimited(response, maxBytes) {
  const declared = Number(response.headers.get("content-length") || 0);
  if (declared > maxBytes) {
    await response.body?.cancel?.();
    throw aiError(AI_ERROR_CODES.PROVIDER_RESPONSE_TOO_LARGE, { retryable: true });
  }
  if (!response.body?.getReader) {
    const raw = await response.text();
    if (new TextEncoder().encode(raw).byteLength > maxBytes) throw aiError(AI_ERROR_CODES.PROVIDER_RESPONSE_TOO_LARGE, { retryable: true });
    return raw;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let raw = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) {
        await reader.cancel();
        throw aiError(AI_ERROR_CODES.PROVIDER_RESPONSE_TOO_LARGE, { retryable: true });
      }
      raw += decoder.decode(value, { stream: true });
    }
    return raw + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}

function retryAfterSeconds(response) {
  const value = response.headers.get("retry-after")?.trim() ?? "";
  if (!value) return 0;
  if (/^\d+(?:\.\d+)?$/.test(value)) return Math.max(0, Math.ceil(Number(value)));
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.ceil((parsed - Date.now()) / 1_000)) : 0;
}

function parseContent(raw) {
  let payload;
  try { payload = JSON.parse(raw); } catch { throw aiError(AI_ERROR_CODES.PROVIDER_INVALID_RESPONSE, { retryable: true }); }
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) throw aiError(AI_ERROR_CODES.PROVIDER_INVALID_RESPONSE, { retryable: true });
  let value;
  try { value = JSON.parse(content); } catch { throw aiError(AI_ERROR_CODES.PROVIDER_INVALID_RESPONSE, { retryable: true }); }
  return { value, usage: payload?.usage ?? null, requestId: typeof payload?.id === "string" ? payload.id.slice(0, 160) : null };
}

async function invokeOnce({ taskType, input, policy, route, apiKey, context, fetchImpl, endpointUrl, extraBody, attempt }) {
  if (!route.model.modelId) throw aiError(AI_ERROR_CODES.MODEL_NOT_AVAILABLE, { details: { routeId: route.routeId } });
  const prompt = promptForTask(taskType, input, route.model.modelId);
  const child = createChildAbort(context, policy.timeoutMs, policy.finalizationReserveMs);
  const startedAt = performance.now();
  try {
    const url = assertProviderUrl(route.providerId, endpointUrl);
    const response = await fetchImpl(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: route.model.modelId,
        messages: [
          ...(prompt.system ? [{ role: "system", content: prompt.system }] : []),
          { role: "user", content: prompt.user },
        ],
        response_format: prompt.schema
          ? { type: "json_schema", json_schema: { name: "atinara_task_output", strict: true, schema: prompt.schema } }
          : { type: "json_object" },
        stream: false,
        ...extraBody,
      }),
      signal: child.signal,
    });
    const raw = await readLimited(response, policy.maxOutputBytes);
    if (!response.ok) throw classifyHttpProviderError(response.status, {
      providerId: route.providerId,
      routeId: route.routeId,
      retryAfterSeconds: response.status === 429 ? retryAfterSeconds(response) : null,
    });
    const parsed = parseContent(raw);
    return {
      value: parsed.value,
      metadata: {
        adapter: "openai_compatible",
        httpStatus: response.status,
        durationMs: Math.round(performance.now() - startedAt),
        responseBytes: new TextEncoder().encode(raw).byteLength,
        requestId: parsed.requestId,
        usage: parsed.usage,
        retryCount: attempt,
      },
    };
  } catch (error) {
    if (error?.code) throw error;
    throw aiError(child.signal.aborted ? AI_ERROR_CODES.PROVIDER_TIMEOUT : AI_ERROR_CODES.PROVIDER_NETWORK_ERROR, {
      httpStatus: child.signal.aborted ? 504 : 503,
      retryable: true,
      cause: error instanceof Error ? error : undefined,
      details: { providerId: route.providerId, routeId: route.routeId },
    });
  } finally {
    child.cleanup();
  }
}

export async function invokeOpenAiCompatible(options) {
  let lastError;
  for (let attempt = 0; attempt <= options.policy.httpRetries; attempt += 1) {
    try {
      return await invokeOnce({ ...options, extraBody: options.extraBody ?? {}, attempt });
    } catch (error) {
      lastError = asAiGatewayError(error);
      const retryable = [
        AI_ERROR_CODES.PROVIDER_TIMEOUT,
        AI_ERROR_CODES.PROVIDER_RATE_LIMITED,
        AI_ERROR_CODES.PROVIDER_NETWORK_ERROR,
        AI_ERROR_CODES.PROVIDER_HTTP_ERROR,
      ].includes(lastError.code) && lastError.retryable;
      if (!retryable || attempt >= options.policy.httpRetries) throw lastError;
      const delayMs = lastError.code === AI_ERROR_CODES.PROVIDER_RATE_LIMITED
        ? Math.min(8_000, Math.max(0, Number(lastError.details.retryAfterSeconds) * 1_000 || 0))
        : Math.min(8_000, 400 * (2 ** attempt));
      await deadlineSleep(delayMs, options.context, options.policy.finalizationReserveMs);
    }
  }
  throw lastError ?? aiError(AI_ERROR_CODES.PROVIDER_INVALID_RESPONSE, { retryable: true });
}
