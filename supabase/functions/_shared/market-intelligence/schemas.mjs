import { MARKET_EXPERT_SCHEMA_VERSION, MARKET_INTELLIGENCE_POLICY_VERSION } from "./constitution.mjs";

export const EXPERT_DECISIONS = Object.freeze(["create", "create_with_edits", "reject", "stale", "merge_duplicate", "escalate"]);
const INTEGRITY = new Set(["pass", "needs_edit", "fail"]);
const FORECASTABILITY = new Set(["forecastable", "valid_low_probability", "valid_very_unlikely", "already_determined", "stale", "unknown"]);
const SOURCE_READINESS = new Set(["ready", "ready_with_warnings", "needs_official_source", "needs_monitoring", "not_resolvable"]);
const FORBIDDEN_KEYS = /(?:chain[_-]?of[_-]?thought|reasoning[_-]?trace|hidden[_-]?reasoning|system[_-]?prompt|raw[_-]?prompt|token[_-]?usage)/i;

function hasForbiddenKey(value, depth = 0) {
  if (depth > 8 || !value || typeof value !== "object") return false;
  return Object.entries(value).some(([key, item]) => FORBIDDEN_KEYS.test(key) || hasForbiddenKey(item, depth + 1));
}

export function expertVerdictSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["decision", "integrity_status", "forecastability_status", "source_readiness", "confidence", "human_review_required", "reason_codes", "summary", "evidence", "suggested_changes", "uncertainties", "proposal", "resolution_contract", "policy_version", "schema_version"],
  };
}

export function validateExpertVerdict(value) {
  const issues = [];
  if (!value || typeof value !== "object" || Array.isArray(value)) return { valid: false, issues: ["EXPERT_JSON_OBJECT_REQUIRED"] };
  if (hasForbiddenKey(value)) issues.push("FORBIDDEN_REASONING_FIELD");
  if (!EXPERT_DECISIONS.includes(value.decision)) issues.push("INVALID_EXPERT_DECISION");
  if (!INTEGRITY.has(value.integrity_status)) issues.push("INVALID_INTEGRITY_STATUS");
  if (!FORECASTABILITY.has(value.forecastability_status)) issues.push("INVALID_FORECASTABILITY_STATUS");
  if (!SOURCE_READINESS.has(value.source_readiness)) issues.push("INVALID_SOURCE_READINESS");
  if (!Number.isFinite(Number(value.confidence)) || Number(value.confidence) < 0 || Number(value.confidence) > 100) issues.push("INVALID_CONFIDENCE");
  for (const key of ["reason_codes", "evidence", "suggested_changes", "uncertainties"]) {
    if (!Array.isArray(value[key])) issues.push(`INVALID_${key.toUpperCase()}`);
  }
  if (!value.proposal || typeof value.proposal !== "object") issues.push("INVALID_PROPOSAL");
  if (!value.resolution_contract || typeof value.resolution_contract !== "object") issues.push("INVALID_RESOLUTION_CONTRACT");
  if (value.policy_version !== MARKET_INTELLIGENCE_POLICY_VERSION) issues.push("POLICY_VERSION_MISMATCH");
  if (value.schema_version !== MARKET_EXPERT_SCHEMA_VERSION) issues.push("SCHEMA_VERSION_MISMATCH");
  return { valid: issues.length === 0, issues };
}

export function createDeterministicVerdict(overrides = {}) {
  const verdict = {
    decision: "escalate",
    integrity_status: "needs_edit",
    forecastability_status: "unknown",
    source_readiness: "needs_official_source",
    confidence: 0,
    human_review_required: true,
    reason_codes: ["EXPERT_NOT_CONFIGURED"],
    summary: "La puerta determinista está disponible, pero el análisis experto no está configurado.",
    evidence: [],
    suggested_changes: [],
    uncertainties: ["Falta el análisis experto estructurado."],
    proposal: {},
    resolution_contract: {},
    policy_version: MARKET_INTELLIGENCE_POLICY_VERSION,
    schema_version: MARKET_EXPERT_SCHEMA_VERSION,
    ...overrides,
  };
  const validation = validateExpertVerdict(verdict);
  return validation.valid ? verdict : { ...verdict, decision: "reject", reason_codes: validation.issues };
}
