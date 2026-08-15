import { AI_ERROR_CODES, aiError } from "./errors.mjs";
import { parseAiExecutionProfile } from "./execution-profile.mjs";

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

export const ATINARA_CANONICAL_JSON_VERSION = "atinara-canonical-json-v1";

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
  "executionProfile",
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
  const executionProfile = parseAiExecutionProfile(value.executionProfile);
  if (!invocationId || !Number.isFinite(absoluteDeadlineAt) || absoluteDeadlineAt <= now) {
    throw aiError(AI_ERROR_CODES.DEADLINE_EXCEEDED, { httpStatus: 504, retryable: true });
  }
  if (!signal || typeof signal !== "object" || typeof signal.aborted !== "boolean") {
    throw aiError(AI_ERROR_CODES.INVALID_REQUEST, { httpStatus: 400, details: { phase: "execution_context" } });
  }
  return Object.freeze({ invocationId, agentRunId, absoluteDeadlineAt, signal, executionProfile });
}

function invalidCanonicalJson() {
  return aiError(AI_ERROR_CODES.INVALID_REQUEST, { httpStatus: 400 });
}

function assertWellFormedUnicode(value) {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const nextCodeUnit = value.charCodeAt(index + 1);
      if (!(nextCodeUnit >= 0xdc00 && nextCodeUnit <= 0xdfff)) throw invalidCanonicalJson();
      index += 1;
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      throw invalidCanonicalJson();
    }
  }
}

function compareUtf16CodeUnits(left, right) {
  const commonLength = Math.min(left.length, right.length);
  for (let index = 0; index < commonLength; index += 1) {
    const difference = left.charCodeAt(index) - right.charCodeAt(index);
    if (difference !== 0) return difference;
  }
  return left.length - right.length;
}

function serializeCanonicalArray(value, depth, ancestors) {
  if (Object.getPrototypeOf(value) !== Array.prototype) throw invalidCanonicalJson();
  if (ancestors.has(value)) throw invalidCanonicalJson();

  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.some((key) => typeof key === "symbol")) throw invalidCanonicalJson();

  const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
  if (
    !lengthDescriptor
    || !Object.hasOwn(lengthDescriptor, "value")
    || lengthDescriptor.value !== value.length
    || lengthDescriptor.enumerable
  ) {
    throw invalidCanonicalJson();
  }

  const elementKeys = ownKeys.filter((key) => key !== "length");
  if (elementKeys.length !== value.length) throw invalidCanonicalJson();

  const elementDescriptors = [];
  for (let index = 0; index < value.length; index += 1) {
    const key = String(index);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, "value")) {
      throw invalidCanonicalJson();
    }
    elementDescriptors.push(descriptor);
  }

  for (const key of elementKeys) {
    const index = Number(key);
    if (!Number.isInteger(index) || index < 0 || index >= value.length || String(index) !== key) {
      throw invalidCanonicalJson();
    }
  }

  ancestors.add(value);
  try {
    return `[${elementDescriptors
      .map((descriptor) => serializeCanonicalValue(descriptor.value, depth + 1, ancestors))
      .join(",")}]`;
  } finally {
    ancestors.delete(value);
  }
}

function serializeCanonicalObject(value, depth, ancestors) {
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw invalidCanonicalJson();
  if (ancestors.has(value)) throw invalidCanonicalJson();

  const entries = [];
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key === "symbol") throw invalidCanonicalJson();
    assertWellFormedUnicode(key);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, "value")) {
      throw invalidCanonicalJson();
    }
    entries.push([key, descriptor.value]);
  }
  entries.sort(([left], [right]) => compareUtf16CodeUnits(left, right));

  ancestors.add(value);
  try {
    return `{${entries
      .map(([key, entryValue]) => `${JSON.stringify(key)}:${serializeCanonicalValue(entryValue, depth + 1, ancestors)}`)
      .join(",")}}`;
  } finally {
    ancestors.delete(value);
  }
}

function serializeCanonicalValue(value, depth, ancestors) {
  if (depth > 20) throw aiError(AI_ERROR_CODES.INPUT_TOO_LARGE, { httpStatus: 413 });
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") {
    assertWellFormedUnicode(value);
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw invalidCanonicalJson();
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return serializeCanonicalArray(value, depth, ancestors);
  if (typeof value !== "object") throw invalidCanonicalJson();
  return serializeCanonicalObject(value, depth, ancestors);
}

export function canonicalJson(value) {
  return serializeCanonicalValue(value, 0, new WeakSet());
}

export async function sha256Hex(value) {
  const data = new TextEncoder().encode(typeof value === "string" ? value : canonicalJson(value));
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function newInvocationId() {
  if (typeof globalThis.crypto?.randomUUID !== "function") {
    throw aiError(AI_ERROR_CODES.INVALID_REQUEST, {
      httpStatus: 500,
      details: { phase: "invocation_id" },
    });
  }
  return globalThis.crypto.randomUUID();
}
