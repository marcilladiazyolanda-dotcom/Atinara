import { AI_ERROR_CODES, aiError } from "./errors.mjs";

export const AI_TASK_TYPES = Object.freeze([
  "radar_candidate_enrichment",
  "market_draft_validation",
  "market_expert_reasoning",
  "market_draft_repair",
  "market_resolution_analysis",
]);

export const AI_TRANSPORT_MODES = Object.freeze([
  "legacy_direct",
  "gateway_gemini_parity",
  "gateway_routing",
]);

export const AI_DATA_CLASSES = Object.freeze([
  "public_market",
  "private_market_minimized",
  "prohibited",
]);

const PRODUCT_REQUEST_KEYS = new Set(["taskType", "contractVersion", "policyVersion", "input"]);
const CALLER_FORBIDDEN_KEYS = new Set([
  "inputFingerprint",
  "outputFingerprint",
  "routeHint",
  "routeId",
  "provider",
  "providerId",
  "model",
  "modelId",
  "schema",
  "timeout",
  "timeoutMs",
  "maxOutputBytes",
  "retries",
  "fallback",
  "budget",
  "lifecycle",
  "dataClass",
]);

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function cleanToken(value, maxLength) {
  return typeof value === "string"
    ? value.trim().replace(/[^a-zA-Z0-9._:-]/g, "").slice(0, maxLength)
    : "";
}

export function assertAiTaskRequest(value) {
  if (!isRecord(value)) throw aiError(AI_ERROR_CODES.INVALID_REQUEST, { httpStatus: 400 });
  for (const key of Object.keys(value)) {
    if (CALLER_FORBIDDEN_KEYS.has(key) || !PRODUCT_REQUEST_KEYS.has(key)) {
      throw aiError(AI_ERROR_CODES.INVALID_REQUEST, {
        httpStatus: 400,
        details: { phase: "request_contract" },
      });
    }
  }
  const taskType = cleanToken(value.taskType, 80);
  const contractVersion = cleanToken(value.contractVersion, 100);
  const policyVersion = cleanToken(value.policyVersion, 100);
  if (!AI_TASK_TYPES.includes(taskType) || !contractVersion || !policyVersion || !isRecord(value.input)) {
    throw aiError(AI_ERROR_CODES.INVALID_REQUEST, { httpStatus: 400 });
  }
  return Object.freeze({ taskType, contractVersion, policyVersion, input: value.input });
}

export function assertAiExecutionContext(value, now = Date.now()) {
  if (!isRecord(value)) throw aiError(AI_ERROR_CODES.INVALID_REQUEST, { httpStatus: 400 });
  const invocationId = cleanToken(value.invocationId, 120);
  const agentRunId = value.agentRunId == null ? null : cleanToken(value.agentRunId, 120);
  const absoluteDeadlineAt = Number(value.absoluteDeadlineAt);
  const signal = value.signal;
  if (!invocationId || !Number.isFinite(absoluteDeadlineAt) || absoluteDeadlineAt <= now) {
    throw aiError(AI_ERROR_CODES.DEADLINE_EXCEEDED, { httpStatus: 504, retryable: true });
  }
  if (!signal || typeof signal !== "object" || typeof signal.aborted !== "boolean") {
    throw aiError(AI_ERROR_CODES.INVALID_REQUEST, { httpStatus: 400, details: { phase: "execution_context" } });
  }
  return Object.freeze({ invocationId, agentRunId, absoluteDeadlineAt, signal });
}

function canonicalizeValue(value, depth = 0) {
  if (depth > 20) throw aiError(AI_ERROR_CODES.INPUT_TOO_LARGE, { httpStatus: 413 });
  if (value === null || typeof value === "boolean" || typeof value === "string") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw aiError(AI_ERROR_CODES.INVALID_REQUEST, { httpStatus: 400 });
    return Object.is(value, -0) ? 0 : value;
  }
  if (Array.isArray(value)) return value.map((item) => canonicalizeValue(item, depth + 1));
  if (!isRecord(value)) throw aiError(AI_ERROR_CODES.INVALID_REQUEST, { httpStatus: 400 });
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalizeValue(value[key], depth + 1)]));
}

export function canonicalJson(value) {
  return JSON.stringify(canonicalizeValue(value));
}

export async function sha256Hex(value) {
  const data = new TextEncoder().encode(typeof value === "string" ? value : canonicalJson(value));
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function newInvocationId() {
  return globalThis.crypto?.randomUUID?.() ?? `ai-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
