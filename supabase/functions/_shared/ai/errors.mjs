export const AI_ERROR_CODES = Object.freeze({
  INVALID_REQUEST: "AI_INVALID_REQUEST",
  CONTRACT_NOT_SUPPORTED: "AI_CONTRACT_NOT_SUPPORTED",
  POLICY_NOT_SUPPORTED: "AI_POLICY_NOT_SUPPORTED",
  INPUT_FIELD_NOT_ALLOWED: "AI_INPUT_FIELD_NOT_ALLOWED",
  INPUT_TOO_LARGE: "AI_INPUT_TOO_LARGE",
  DATA_CLASS_PROHIBITED: "AI_DATA_CLASS_PROHIBITED",
  PROVIDER_NOT_CONFIGURED: "AI_PROVIDER_NOT_CONFIGURED",
  MODEL_NOT_AVAILABLE: "AI_MODEL_NOT_AVAILABLE",
  ROUTE_NOT_AVAILABLE: "AI_ROUTE_NOT_AVAILABLE",
  BUDGET_EXHAUSTED: "AI_BUDGET_EXHAUSTED",
  BUDGET_RESERVATION_FAILED: "AI_BUDGET_RESERVATION_FAILED",
  DEADLINE_EXCEEDED: "AI_DEADLINE_EXCEEDED",
  PROVIDER_TIMEOUT: "AI_PROVIDER_TIMEOUT",
  PROVIDER_RATE_LIMITED: "AI_PROVIDER_RATE_LIMITED",
  PROVIDER_AUTH_ERROR: "AI_PROVIDER_AUTH_ERROR",
  PROVIDER_NETWORK_ERROR: "AI_PROVIDER_NETWORK_ERROR",
  PROVIDER_HTTP_ERROR: "AI_PROVIDER_HTTP_ERROR",
  PROVIDER_RESPONSE_TOO_LARGE: "AI_PROVIDER_RESPONSE_TOO_LARGE",
  PROVIDER_INVALID_RESPONSE: "AI_PROVIDER_INVALID_RESPONSE",
  OUTPUT_CONTRACT_INVALID: "AI_OUTPUT_CONTRACT_INVALID",
  OUTPUT_DOMAIN_INVALID: "AI_OUTPUT_DOMAIN_INVALID",
  OUTPUT_POLICY_INVALID: "AI_OUTPUT_POLICY_INVALID",
  TELEMETRY_WRITE_FAILED: "AI_TELEMETRY_WRITE_FAILED",
  CAPABILITY_DISCOVERY_REQUIRED: "AI_CAPABILITY_DISCOVERY_REQUIRED",
  EXTERNAL_AI_DISABLED: "AI_EXTERNAL_AI_DISABLED",
});

const TECHNICAL_FALLBACK_CODES = new Set([
  AI_ERROR_CODES.PROVIDER_TIMEOUT,
  AI_ERROR_CODES.PROVIDER_RATE_LIMITED,
  AI_ERROR_CODES.PROVIDER_NETWORK_ERROR,
  AI_ERROR_CODES.PROVIDER_HTTP_ERROR,
  AI_ERROR_CODES.PROVIDER_RESPONSE_TOO_LARGE,
  AI_ERROR_CODES.PROVIDER_INVALID_RESPONSE,
  AI_ERROR_CODES.OUTPUT_CONTRACT_INVALID,
]);

const SAFE_DETAIL_KEYS = new Set([
  "providerId",
  "routeId",
  "taskType",
  "httpStatus",
  "retryAfterSeconds",
  "phase",
  "contractVersion",
  "policyVersion",
  "modelCatalogVersion",
]);

function safeDetails(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).flatMap(([key, item]) => {
    if (!SAFE_DETAIL_KEYS.has(key)) return [];
    if (typeof item === "boolean" || item === null) return [[key, item]];
    if (typeof item === "number" && Number.isFinite(item)) return [[key, item]];
    if (typeof item === "string") return [[key, item.slice(0, 160)]];
    return [];
  }));
}

export class AiGatewayError extends Error {
  constructor(code, options = {}) {
    super(code, options.cause ? { cause: options.cause } : undefined);
    this.name = "AiGatewayError";
    this.code = code;
    this.httpStatus = Number.isInteger(options.httpStatus) ? options.httpStatus : 503;
    this.retryable = options.retryable === true;
    this.details = Object.freeze(safeDetails(options.details));
    this.telemetryStatus = "unknown";
    this.warnings = Object.freeze([]);
  }
}

export function aiError(code, options = {}) {
  return new AiGatewayError(code, options);
}

export function isAiGatewayError(value) {
  return value instanceof AiGatewayError;
}

export function asAiGatewayError(value, fallbackCode = AI_ERROR_CODES.PROVIDER_INVALID_RESPONSE) {
  if (isAiGatewayError(value)) return value;
  return aiError(fallbackCode, {
    retryable: TECHNICAL_FALLBACK_CODES.has(fallbackCode),
    cause: value instanceof Error ? value : undefined,
  });
}

export function isTechnicalFallbackEligible(value) {
  const error = asAiGatewayError(value);
  return error.retryable && TECHNICAL_FALLBACK_CODES.has(error.code);
}

export function publicAiError(value) {
  const error = asAiGatewayError(value);
  return {
    error: error.code,
    retryable: error.retryable,
  };
}

export function classifyHttpProviderError(status, details = {}) {
  const safeStatus = Number(status) || 0;
  if (safeStatus === 401 || safeStatus === 403) {
    return aiError(AI_ERROR_CODES.PROVIDER_AUTH_ERROR, {
      httpStatus: 502,
      details: { ...details, httpStatus: safeStatus },
    });
  }
  if (safeStatus === 429) {
    return aiError(AI_ERROR_CODES.PROVIDER_RATE_LIMITED, {
      httpStatus: 429,
      retryable: true,
      details: { ...details, httpStatus: safeStatus },
    });
  }
  return aiError(AI_ERROR_CODES.PROVIDER_HTTP_ERROR, {
    httpStatus: safeStatus >= 500 ? 503 : 502,
    retryable: safeStatus >= 500,
    details: { ...details, httpStatus: safeStatus },
  });
}
