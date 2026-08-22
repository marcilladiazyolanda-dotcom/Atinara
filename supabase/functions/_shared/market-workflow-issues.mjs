import { canonicalJson, sha256Hex } from "./ai/contracts.mjs";

export const MARKET_WORKFLOW_ISSUE_SCHEMA_VERSION = "atinara-market-issue-v1";

export const MARKET_ISSUE_OWNER_STAGES = Object.freeze([
  "radar", "editor", "validator", "corrector", "human_review",
  "publication_gate", "provider", "internal_platform",
]);

export const MARKET_ISSUE_REPAIRABILITY = Object.freeze([
  "auto_recoverable", "auto_repairable", "human_editable",
  "waiting_authoritative_source", "non_repairable", "terminal",
]);

export const MARKET_ISSUE_BLOCKING_SCOPES = Object.freeze([
  "none", "approval", "human_confirmation", "publication", "terminal",
]);

export const MARKET_ISSUE_STATUSES = Object.freeze([
  "open", "in_progress", "waiting", "resolved", "superseded",
]);

const SEVERITIES = new Set(["info", "warning", "blocking"]);
const OWNER_STAGES = new Set(MARKET_ISSUE_OWNER_STAGES);
const REPAIRABILITY = new Set(MARKET_ISSUE_REPAIRABILITY);
const BLOCKING_SCOPES = new Set(MARKET_ISSUE_BLOCKING_SCOPES);
const STATUSES = new Set(MARKET_ISSUE_STATUSES);
const ISSUE_KEYS = Object.freeze([
  "issue_id", "issue_code", "detected_by", "owner_stage", "severity",
  "repairability", "blocking_scope", "affected_fields", "evidence_refs",
  "current_value", "proposed_value", "confidence", "policy_version",
  "schema_version", "fingerprint", "status", "retryable", "next_action",
  "created_at", "updated_at", "resolved_at", "resolution_method",
]);

function boundedText(value, maxLength) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function safeArray(value, maxItems) {
  return Array.isArray(value) ? value.slice(0, maxItems) : [];
}

function compareUtf16Binary(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function assertIssueEnum(value, allowed, code) {
  if (!allowed.has(value)) throw new TypeError(code);
  return value;
}

function assertUuid(value) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new TypeError("MARKET_ISSUE_ID_INVALID");
  }
  return value.toLowerCase();
}

function assertIso(value, nullable = false) {
  if (nullable && value === null) return null;
  const parsed = Date.parse(value);
  if (typeof value !== "string" || !Number.isFinite(parsed)) throw new TypeError("MARKET_ISSUE_DATE_INVALID");
  return new Date(parsed).toISOString();
}

function assertJsonValue(value) {
  // canonicalJson validates plain JSON, Unicode, cycles, accessors and depth.
  canonicalJson(value);
  return value;
}

export async function createMarketWorkflowIssue(input, {
  createId = () => globalThis.crypto.randomUUID(),
  now = () => new Date().toISOString(),
} = {}) {
  const issueCode = boundedText(input?.issueCode, 100).toUpperCase();
  const nextAction = boundedText(input?.nextAction, 100);
  const detectedBy = assertIssueEnum(boundedText(input?.detectedBy, 40), OWNER_STAGES, "MARKET_ISSUE_DETECTOR_INVALID");
  const ownerStage = assertIssueEnum(boundedText(input?.ownerStage, 40), OWNER_STAGES, "MARKET_ISSUE_OWNER_INVALID");
  const severity = assertIssueEnum(boundedText(input?.severity, 20), SEVERITIES, "MARKET_ISSUE_SEVERITY_INVALID");
  const repairability = assertIssueEnum(boundedText(input?.repairability, 40), REPAIRABILITY, "MARKET_ISSUE_REPAIRABILITY_INVALID");
  const blockingScope = assertIssueEnum(boundedText(input?.blockingScope, 40), BLOCKING_SCOPES, "MARKET_ISSUE_BLOCKING_SCOPE_INVALID");
  if (!/^[A-Z][A-Z0-9_]{2,99}$/.test(issueCode)) throw new TypeError("MARKET_ISSUE_CODE_INVALID");
  if (!/^[a-z][a-z0-9_]{2,99}$/.test(nextAction)) throw new TypeError("MARKET_ISSUE_NEXT_ACTION_INVALID");
  if ((repairability === "terminal") !== (blockingScope === "terminal")) {
    throw new TypeError("MARKET_ISSUE_TERMINAL_SCOPE_INVALID");
  }
  const confidence = Number(input?.confidence);
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 100) {
    throw new TypeError("MARKET_ISSUE_CONFIDENCE_INVALID");
  }
  const policyVersion = boundedText(input?.policyVersion, 100);
  if (!policyVersion) throw new TypeError("MARKET_ISSUE_POLICY_REQUIRED");
  const affectedFields = safeArray(input?.affectedFields, 32).map((field) => boundedText(field, 100)).filter(Boolean);
  const evidenceRefs = safeArray(input?.evidenceRefs, 32).map(assertJsonValue);
  const currentValue = assertJsonValue(input?.currentValue ?? null);
  const proposedValue = assertJsonValue(input?.proposedValue ?? null);
  const retryable = input?.retryable === true;
  const fingerprintMaterial = {
    issue_code: issueCode,
    detected_by: detectedBy,
    owner_stage: ownerStage,
    severity,
    repairability,
    blocking_scope: blockingScope,
    affected_fields: affectedFields,
    evidence_refs: evidenceRefs,
    current_value: currentValue,
    proposed_value: proposedValue,
    confidence,
    policy_version: policyVersion,
    schema_version: MARKET_WORKFLOW_ISSUE_SCHEMA_VERSION,
    retryable,
    next_action: nextAction,
  };
  const timestamp = assertIso(now());
  return Object.freeze({
    issue_id: assertUuid(createId()),
    ...fingerprintMaterial,
    fingerprint: await sha256Hex(fingerprintMaterial),
    status: "open",
    retryable,
    created_at: timestamp,
    updated_at: timestamp,
    resolved_at: null,
    resolution_method: null,
  });
}

export function validateMarketWorkflowIssue(issue) {
  if (!issue || typeof issue !== "object" || Array.isArray(issue)) throw new TypeError("MARKET_ISSUE_INVALID");
  const keys = Object.keys(issue).sort(compareUtf16Binary);
  if (JSON.stringify(keys) !== JSON.stringify([...ISSUE_KEYS].sort(compareUtf16Binary))) throw new TypeError("MARKET_ISSUE_KEYS_INVALID");
  assertUuid(issue.issue_id);
  if (!/^[A-Z][A-Z0-9_]{2,99}$/.test(issue.issue_code)) throw new TypeError("MARKET_ISSUE_CODE_INVALID");
  assertIssueEnum(issue.detected_by, OWNER_STAGES, "MARKET_ISSUE_DETECTOR_INVALID");
  assertIssueEnum(issue.owner_stage, OWNER_STAGES, "MARKET_ISSUE_OWNER_INVALID");
  assertIssueEnum(issue.severity, SEVERITIES, "MARKET_ISSUE_SEVERITY_INVALID");
  assertIssueEnum(issue.repairability, REPAIRABILITY, "MARKET_ISSUE_REPAIRABILITY_INVALID");
  assertIssueEnum(issue.blocking_scope, BLOCKING_SCOPES, "MARKET_ISSUE_BLOCKING_SCOPE_INVALID");
  assertIssueEnum(issue.status, STATUSES, "MARKET_ISSUE_STATUS_INVALID");
  if ((issue.repairability === "terminal") !== (issue.blocking_scope === "terminal")) {
    throw new TypeError("MARKET_ISSUE_TERMINAL_SCOPE_INVALID");
  }
  if (!Array.isArray(issue.affected_fields) || !Array.isArray(issue.evidence_refs)) throw new TypeError("MARKET_ISSUE_ARRAY_INVALID");
  if (!Number.isFinite(issue.confidence) || issue.confidence < 0 || issue.confidence > 100) throw new TypeError("MARKET_ISSUE_CONFIDENCE_INVALID");
  if (!/^[a-f0-9]{64}$/.test(issue.fingerprint)) throw new TypeError("MARKET_ISSUE_FINGERPRINT_INVALID");
  if (!/^[a-z][a-z0-9_]{2,99}$/.test(issue.next_action)) throw new TypeError("MARKET_ISSUE_NEXT_ACTION_INVALID");
  if (typeof issue.retryable !== "boolean") throw new TypeError("MARKET_ISSUE_RETRYABLE_INVALID");
  assertIso(issue.created_at);
  assertIso(issue.updated_at);
  assertIso(issue.resolved_at, true);
  assertJsonValue(issue.current_value);
  assertJsonValue(issue.proposed_value);
  canonicalJson(issue);
  return true;
}

export function publicMarketWorkflowIssue(issue) {
  validateMarketWorkflowIssue(issue);
  return Object.freeze({
    issue_id: issue.issue_id,
    issue_code: issue.issue_code,
    detected_by: issue.detected_by,
    owner_stage: issue.owner_stage,
    severity: issue.severity,
    repairability: issue.repairability,
    blocking_scope: issue.blocking_scope,
    affected_fields: issue.affected_fields,
    confidence: issue.confidence,
    status: issue.status,
    retryable: issue.retryable,
    next_action: issue.next_action,
  });
}
