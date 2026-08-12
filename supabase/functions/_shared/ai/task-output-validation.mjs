import { AI_ERROR_CODES, aiError } from "./errors.mjs";

const VALIDATOR_CODES = new Set([
  "AMBIGUOUS_CRITERIA",
  "AMBIGUOUS_SUBJECT",
  "AUTOMATIC_REVIEW_INCONCLUSIVE",
  "CONTRADICTORY_CRITERIA",
  "INSUFFICIENT_EVIDENCE",
  "INVALID_METRIC",
  "INVALID_QUESTION",
  "INVALID_TIMEZONE",
  "MISSING_EDGE_CASES",
  "MISSING_NO_CRITERIA",
  "MISSING_PUBLIC_CRITERIA",
  "MISSING_RESOLUTION_SOURCE",
  "NON_BINARY_OPTIONS",
  "TEMPORAL_INCOHERENCE",
  "UNRESOLVABLE_CONTRACT",
]);

const RADAR_REASON_CODES = new Set([
  "EVENT_ALREADY_RESOLVED",
  "SOURCE_STALE",
  "EVENT_OUTSIDE_CONTRACT",
  "SUBJECT_NOT_ANNOUNCED",
  "TEMPORAL_INCOHERENCE",
  "INVALID_OR_UNVERIFIED_SOURCE",
  "VERIFICATION_REQUIRED",
]);

const RADAR_CATEGORIES = new Set([
  "Lanzamientos",
  "Eventos",
  "Industria",
  "Streamers",
  "Reviews/Premios",
  "YouTubers",
]);

const EXPERT_DECISIONS = new Set(["create", "create_with_edits", "reject", "stale", "merge_duplicate", "escalate"]);
const EXPERT_INTEGRITY = new Set(["pass", "needs_edit", "fail"]);
const EXPERT_FORECASTABILITY = new Set(["forecastable", "valid_low_probability", "valid_very_unlikely", "already_determined", "stale", "unknown"]);
const FORBIDDEN_REASONING_KEY = /(?:chain[_-]?of[_-]?thought|reasoning[_-]?trace|hidden[_-]?reasoning|system[_-]?prompt|raw[_-]?prompt|token[_-]?usage)/i;

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function fail(code = AI_ERROR_CODES.OUTPUT_CONTRACT_INVALID, phase = "task_output") {
  throw aiError(code, {
    httpStatus: 502,
    retryable: code === AI_ERROR_CODES.OUTPUT_CONTRACT_INVALID,
    details: { phase },
  });
}

function exactKeys(value, required, optional = []) {
  if (!isRecord(value)) return false;
  const allowed = new Set([...required, ...optional]);
  return required.every((key) => Object.hasOwn(value, key))
    && Object.keys(value).every((key) => allowed.has(key));
}

function validString(value, min = 0, max = 4_000) {
  return typeof value === "string" && value.length >= min && value.length <= max;
}

function validStringArray(value, maxItems, maxLength, minItems = 0) {
  return Array.isArray(value) && value.length >= minItems && value.length <= maxItems
    && value.every((item) => validString(item, 1, maxLength));
}

function hasForbiddenReasoningKey(value, depth = 0) {
  if (depth > 12 || !value || typeof value !== "object") return false;
  return Object.entries(value).some(([key, item]) => FORBIDDEN_REASONING_KEY.test(key) || hasForbiddenReasoningKey(item, depth + 1));
}

function parseJsonText(text, compatibility = false) {
  if (typeof text !== "string" || !text.trim()) fail(AI_ERROR_CODES.PROVIDER_INVALID_RESPONSE, "provider_text");
  let candidate = text.trim();
  if (compatibility && /^```(?:json)?/i.test(candidate)) {
    candidate = candidate.replace(/^```(?:json)?/i, "").replace(/```\s*$/, "").trim();
  }
  if (compatibility) {
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start >= 0 && end > start) candidate = candidate.slice(start, end + 1);
  }
  try {
    return JSON.parse(candidate);
  } catch {
    fail(AI_ERROR_CODES.PROVIDER_INVALID_RESPONSE, "json_parse");
  }
}

function extractGenerateContentText(payload) {
  if (!isRecord(payload) || !Array.isArray(payload.candidates)) fail(AI_ERROR_CODES.PROVIDER_INVALID_RESPONSE, "gemini_envelope");
  const parts = payload.candidates.flatMap((candidate) => {
    const content = isRecord(candidate) && isRecord(candidate.content) ? candidate.content : {};
    return Array.isArray(content.parts) ? content.parts : [];
  });
  const text = parts.filter((part) => isRecord(part) && part.thought !== true && typeof part.text === "string")
    .map((part) => part.text).join("");
  if (!text) fail(AI_ERROR_CODES.PROVIDER_INVALID_RESPONSE, "gemini_content");
  return text;
}

function extractInteractionsText(payload) {
  if (!isRecord(payload)) fail(AI_ERROR_CODES.PROVIDER_INVALID_RESPONSE, "interactions_envelope");
  const steps = Array.isArray(payload.steps) ? payload.steps : Array.isArray(payload.outputs) ? payload.outputs : [];
  const output = [];
  for (const step of steps) {
    if (!isRecord(step)) continue;
    const blocks = step.type === "model_output" && Array.isArray(step.content)
      ? step.content
      : step.type === "text" ? [step] : [];
    for (const block of blocks) {
      if (isRecord(block) && block.type === "text" && typeof block.text === "string") output.push(block.text);
    }
  }
  if (!output.length && typeof payload.output_text === "string") output.push(payload.output_text);
  const text = output.join("\n").trim();
  if (!text) fail(AI_ERROR_CODES.PROVIDER_INVALID_RESPONSE, "interactions_content");
  return text;
}

export function parseTaskProviderEnvelope(taskType, payload, endpoint = "generateContent") {
  const text = endpoint === "interactions" ? extractInteractionsText(payload) : extractGenerateContentText(payload);
  const compatibility = taskType === "market_resolution_analysis" || taskType === "radar_candidate_enrichment";
  return parseJsonText(text, compatibility);
}

function validateRadar(value, input) {
  if (!exactKeys(value, ["candidates"]) || !Array.isArray(value.candidates)) fail();
  const expected = Array.isArray(input.groups)
    ? input.groups.reduce((total, group) => total + (Array.isArray(group?.candidates) ? group.candidates.length : 0), 0)
    : Number(input.candidateCount);
  if (!Number.isSafeInteger(expected) || expected < 1 || value.candidates.length !== expected) fail();
  const indexes = new Set();
  const required = [
    "candidate_index", "eligible", "conclusive", "reason_code", "reason", "confidence", "ttl_minutes",
    "facts", "atinara_question", "atinara_category", "atinara_resolution_criteria",
  ];
  const factKeys = ["event_resolved_at", "official_reveal_at", "release_at", "subject_announced", "temporal_coherence"];
  for (const candidate of value.candidates) {
    if (!exactKeys(candidate, required) || !Number.isSafeInteger(candidate.candidate_index)
      || candidate.candidate_index < 0 || candidate.candidate_index >= expected || indexes.has(candidate.candidate_index)
      || typeof candidate.eligible !== "boolean" || typeof candidate.conclusive !== "boolean"
      || !RADAR_REASON_CODES.has(candidate.reason_code) || !validString(candidate.reason, 1, 1_000)
      || !Number.isSafeInteger(candidate.confidence) || candidate.confidence < 0 || candidate.confidence > 100
      || !Number.isSafeInteger(candidate.ttl_minutes) || candidate.ttl_minutes < 5 || candidate.ttl_minutes > 1_440
      || !exactKeys(candidate.facts, factKeys)
      || !factKeys.slice(0, 3).every((key) => candidate.facts[key] === null || validString(candidate.facts[key], 1, 100))
      || !factKeys.slice(3).every((key) => candidate.facts[key] === null || typeof candidate.facts[key] === "boolean")
      || !validString(candidate.atinara_question, 1, 700) || !RADAR_CATEGORIES.has(candidate.atinara_category)
      || !validString(candidate.atinara_resolution_criteria, 1, 4_000)) fail();
    indexes.add(candidate.candidate_index);
  }
  return value;
}

function validateExpert(value) {
  const required = [
    "decision", "integrity_status", "forecastability_status", "confidence", "human_review_required",
    "reason_codes", "summary", "suggested_changes", "uncertainties", "proposal_patch", "policy_version", "schema_version",
  ];
  const patchKeys = ["question", "subject", "category", "yes_criteria", "no_criteria", "edge_cases", "public_criteria", "description"];
  if (!exactKeys(value, required) || hasForbiddenReasoningKey(value)
    || !EXPERT_DECISIONS.has(value.decision) || !EXPERT_INTEGRITY.has(value.integrity_status)
    || !EXPERT_FORECASTABILITY.has(value.forecastability_status)
    || !Number.isSafeInteger(value.confidence) || value.confidence < 0 || value.confidence > 100
    || typeof value.human_review_required !== "boolean"
    || !validStringArray(value.reason_codes, 12, 100)
    || !validString(value.summary, 1, 2_000)
    || !validStringArray(value.suggested_changes, 12, 800)
    || !validStringArray(value.uncertainties, 12, 800)
    || !exactKeys(value.proposal_patch, patchKeys)
    || !patchKeys.every((key) => validString(value.proposal_patch[key], 0, 4_000))
    || value.policy_version !== "atinara-market-constitution-v1"
    || value.schema_version !== "atinara-market-expert-v1") fail();
  return value;
}

function validateDraftReview(value) {
  if (!exactKeys(value, ["result", "issues", "editorial_notes"])
    || !["approved", "rejected"].includes(value.result)
    || !Array.isArray(value.issues) || value.issues.length > 30
    || !validStringArray(value.editorial_notes, 20, 500)) fail();
  for (const issue of value.issues) {
    if (!exactKeys(issue, ["code", "field", "message"]) || !VALIDATOR_CODES.has(issue.code)
      || !validString(issue.field, 1, 100) || !validString(issue.message, 8, 800)) fail();
  }
  if ((value.result === "approved" && value.issues.length !== 0)
    || (value.result === "rejected" && value.issues.length === 0)) fail(AI_ERROR_CODES.OUTPUT_DOMAIN_INVALID);
  return value;
}

function validateRepair(value) {
  const patchKeys = ["description", "assumptions", "delay_treatment", "cancellation_treatment", "leak_treatment", "rename_treatment"];
  if (!exactKeys(value, ["patch", "explanations", "unresolved_issues"])
    || !exactKeys(value.patch, patchKeys)
    || !patchKeys.every((key) => validString(value.patch[key], 0, 4_000))
    || !validStringArray(value.explanations, 12, 800)
    || !Array.isArray(value.unresolved_issues) || value.unresolved_issues.length > 8) fail();
  for (const issue of value.unresolved_issues) {
    if (!exactKeys(issue, ["code", "field", "reason"]) || !VALIDATOR_CODES.has(issue.code)
      || !validString(issue.field, 1, 100) || !validString(issue.reason, 8, 800)) fail();
  }
  return value;
}

function validateResolution(value, input) {
  const required = ["proposed_result", "confidence", "summary", "reasons", "cutoff_analysis", "caveats", "recommended_note", "source_dates"];
  if (!exactKeys(value, required) || !["Si", "Sí", "No", "Anulado", "No concluyente"].includes(value.proposed_result)
    || !["Alta", "Media", "Baja"].includes(value.confidence)
    || !validString(value.summary, 1, 2_000) || !validStringArray(value.reasons, 6, 600, 1)
    || !validString(value.cutoff_analysis, 1, 2_000) || !validStringArray(value.caveats, 6, 600)
    || !validString(value.recommended_note, 0, 4_000)
    || !Array.isArray(value.source_dates) || value.source_dates.length > 10) fail();
  const sourceTitles = new Set(Array.isArray(input.sources) ? input.sources.map((source) => source?.title).filter((title) => typeof title === "string") : []);
  for (const source of value.source_dates) {
    if (!exactKeys(source, ["title", "published_at", "relevance"])
      || !validString(source.title, 1, 200) || !sourceTitles.has(source.title)
      || !validString(source.published_at, 1, 40) || !validString(source.relevance, 1, 600)) fail(AI_ERROR_CODES.OUTPUT_DOMAIN_INVALID);
  }
  return value;
}

export function validateTaskOutput(taskType, value, input) {
  if (!isRecord(value) || hasForbiddenReasoningKey(value)) fail();
  if (taskType === "radar_candidate_enrichment") return validateRadar(value, input);
  if (taskType === "market_expert_reasoning") return validateExpert(value);
  if (taskType === "market_draft_validation") return validateDraftReview(value);
  if (taskType === "market_draft_repair") return validateRepair(value);
  if (taskType === "market_resolution_analysis") return validateResolution(value, input);
  fail(AI_ERROR_CODES.CONTRACT_NOT_SUPPORTED, "task_type");
}
