import { AI_ERROR_CODES, aiError } from "./errors.mjs";

const DEFAULT_LIMITS = Object.freeze({
  maxDepth: 8,
  maxArrayItems: 80,
  maxObjectKeys: 100,
  maxStringLength: 12_000,
  maxTotalBytes: 256_000,
});

const PROHIBITED_EXACT_KEYS = new Set([
  "user", "user_id", "user_uuid", "profile", "profile_id", "profile_uuid",
  "email", "phone", "contact", "session", "cookie", "authorization", "jwt",
  "bearer", "password", "secret", "api_key", "service_role", "karma", "prestigio",
  "balance", "wallet", "position", "positions", "prediction", "predictions",
  "active_prediction", "active_predictions",
]);
const PROHIBITED_KEY_PREFIX = /^(?:user|profile|email|phone|contact|session|cookie|authorization|jwt|bearer|password|secret|api_key|service_role|karma|prestigio|balance|wallet|position|positions|active_prediction|active_predictions)_/i;
const SECRET_VALUE = /(?:\bBearer\s+[A-Za-z0-9._~+/=-]{16,}|\beyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{8,}\b|\b(?:sk|sb_secret|AIza)[-_A-Za-z0-9]{16,}\b)/;
const EMAIL_VALUE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;

// Atinara Contract Safe JSON is deliberately smaller than arbitrary JSON.
// Every nested object key must belong to this closed, reviewed vocabulary.
const PUBLIC_JSON_ALLOWED_KEYS = new Set(`
  action active aggregation alternative_sources alternatives ambiguous ambiguity_reason analysis_kind archetype assumptions
  atinara_category atinara_closes_at atinara_question atinara_resolution_criteria atinara_resolution_source_url
  affected_fields authority authority_basis authority_verified blocking blocking_reasons bound_context_source
  cache_expires_at cancellation_treatment candidate_index candidates canonical_instant canonical_local_instant
  adapter_version authority_role canonical_domain canonical_operator canonical_statement canonical_url capture_strategy category catalyst_type checked_at
  claim_slots claim_status claim_verifiable closes_at code confidence conclusive content_criterion content_kind
  content_sha256 content_type contextual_basis contextual_basis_refs context_type contract contract_identity contract_policy_version contract_schema_version contract_url
  created_at data_class decision delay_treatment deleted_entity_treatment description details deterministic
  direct_claim disposition dispositions draft duration_contract edge_case edge_cases eligible eligibility_checked_at endpoint_identity_basis endpoint_identity_verified
  eligibility_evidence eligibility_expires_at eligibility_policy_version eligibility_reason eligibility_reason_code
  eligibility_status entity_label entity_type evaluation_at evaluation_ends_at evaluation_period_label evidence
  evidence_basis evidence_mode exact expected_boolean_state expected_result explicit_void_conditions expires_at
  explanations external_event_url external_market_url external_url factual_basis factual_basis_refs facts
  fallback_condition family_child_key family_child_label family_key family_matches family_relationship
  family_semantics family_sort_at family_source_event_key family_title family_type family_version fetched_at
  field final_url finality_delay_seconds fingerprint forecastability_status granularity groups handler_key
  has_more hidden_metric_treatment human_review_margin_seconds human_review_required identity_ambiguous
  inference_summary instant integrity_status invariants issue_plan issues label leak_treatment local_instant
  manual_review_instructions market market_slug market_thesis marketability_reason_codes marketability_status
  maximum_monitor_duration_seconds message metric metric_is_rounded metric_name metric_precision metric_unit
  metric_value milestone_distance milestone_metric milestone_unit milestone_value missing_data_treatment name
  no_criteria no_option normalizer_version observed_at official_event_url operator opportunity_type origin
  origin_preparation_revision origin_type output parser_version participation_closed_at patch phase plan_version
  policy_version postponement_treatment precedence precision preparation_revision primary_source primary_source_url
  progress proposal provider provider_adapter_version provider_policy_flags public_criteria published_at
  prediction_policy_version quality_score quality_status quality_updated_at question reason reason_code reason_codes
  registry_categories registry_domain registry_parser_version registry_role registry_role_verified registry_source_id
  relationship relevance relevance_basis relevance_verified rename_treatment repairable required required_samples
  researchText resolution_contract resolution_deadline resolution_deadline_policy_version resolution_readiness
  resolution_source resolution_source_evidence retrieval_status retrieved_at role rounding_behavior
  resolution_contract_specific sampling_interval_seconds schema_version searchQueries selection_complete selection_editions severity signal_origin signal_type similarity
  source_availability_delay_seconds source_category source_close_at source_conflict_treatment source_contract
  source_description source_liquidity source_probability source_probability_yes source_question
  source_readiness source_resolution_deadline source_resolution_rules source_resolution_url source_result
  source_status source_title source_type source_updated_at source_volume source_volume_total sources state
  structuralIssues subject subject_announced subtitle suggestion suggested_changes suggested_edge_cases supported_contract_kinds supported_fact_statuses supported_reason_codes
  suggested_market_type suggested_no_criteria suggested_question suggested_resolution_contract
  suggested_yes_criteria summary supports temporal_boundary temporal_coherence temporal_contract threshold
  tie_break_policy time_window_end time_window_start timezone timezone_label title ttl_minutes unit uncertainties
  unresolved unresolved_issues unresolved_proof unresolved_proof_basis unresolved_proof_excerpt unresolved_proof_excerpt_sha256 unresolved_question unresolved_until unsupported url valid_until validated_reachable validation_version
  value verification_confidence verification_evidence verification_expires_at verification_reason
  verification_reason_code verification_status verified_at version viable_horizons_days warnings watch_entity_id
  why_now window_end write_fields yes_criteria yes_option previous_value change_value provider_contract_field relevance_score
  aggregate_probability candidate_instants content_kind cumulative duration economic_independence evaluation_at
  event_end_at event_group_key event_name event_start_at external_url hour kind minute mode mutually_exclusive
  offset_minutes origin_type parent_is_market raw_value second timezone_ambiguous timezone_mode window_start
`.trim().split(/\s+/));

export const SCALAR = Symbol("atinara-scalar");
export const URL_VALUE = Symbol("atinara-url");
export const PUBLIC_JSON = Symbol("atinara-public-json");

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isProhibitedKey(value) {
  const normalized = String(value).toLowerCase();
  return PROHIBITED_EXACT_KEYS.has(normalized) || PROHIBITED_KEY_PREFIX.test(normalized);
}

function sanitizeString(value, limit, path, expectUrl = false) {
  const output = value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ")
    .replace(/\r\n?/g, "\n")
    .trim();
  if (output.length > limit) throw aiError(AI_ERROR_CODES.INPUT_TOO_LARGE, { httpStatus: 413, details: { phase: path } });
  if (SECRET_VALUE.test(output) || EMAIL_VALUE.test(output)) {
    throw aiError(AI_ERROR_CODES.DATA_CLASS_PROHIBITED, { httpStatus: 400, details: { phase: path } });
  }
  if (expectUrl && output) {
    try {
      const url = new URL(output);
      if (url.protocol !== "https:" || url.username || url.password) throw new Error("unsafe");
    } catch {
      throw aiError(AI_ERROR_CODES.INPUT_FIELD_NOT_ALLOWED, { httpStatus: 400, details: { phase: path } });
    }
  }
  return output;
}

function sanitizeScalar(value, limits, path, expectUrl = false) {
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return Object.is(value, -0) ? 0 : value;
  if (typeof value === "string") return sanitizeString(value, limits.maxStringLength, path, expectUrl);
  throw aiError(AI_ERROR_CODES.INPUT_FIELD_NOT_ALLOWED, { httpStatus: 400, details: { phase: path } });
}

function sanitizePublicJson(value, limits, path, depth) {
  if (depth > limits.maxDepth) throw aiError(AI_ERROR_CODES.INPUT_TOO_LARGE, { httpStatus: 413, details: { phase: path } });
  if (value === null || ["boolean", "number", "string"].includes(typeof value)) {
    return sanitizeScalar(value, limits, path);
  }
  if (Array.isArray(value)) {
    if (value.length > limits.maxArrayItems) throw aiError(AI_ERROR_CODES.INPUT_TOO_LARGE, { httpStatus: 413, details: { phase: path } });
    return value.map((item, index) => sanitizePublicJson(item, limits, `${path}[${index}]`, depth + 1));
  }
  if (!isRecord(value) || Object.keys(value).length > limits.maxObjectKeys) {
    throw aiError(AI_ERROR_CODES.INPUT_TOO_LARGE, { httpStatus: 413, details: { phase: path } });
  }
  const output = {};
  for (const [key, item] of Object.entries(value)) {
    if (isProhibitedKey(key)) throw aiError(AI_ERROR_CODES.DATA_CLASS_PROHIBITED, { httpStatus: 400, details: { phase: `${path}.${key}` } });
    if (!PUBLIC_JSON_ALLOWED_KEYS.has(key)) {
      throw aiError(AI_ERROR_CODES.INPUT_FIELD_NOT_ALLOWED, { httpStatus: 400, details: { phase: `${path}.${key}` } });
    }
    output[key] = sanitizePublicJson(item, limits, `${path}.${key}`, depth + 1);
  }
  return output;
}

function project(value, shape, limits, path, depth) {
  if (depth > limits.maxDepth) throw aiError(AI_ERROR_CODES.INPUT_TOO_LARGE, { httpStatus: 413, details: { phase: path } });
  if (shape === SCALAR) return sanitizeScalar(value, limits, path);
  if (shape === URL_VALUE) return sanitizeScalar(value, limits, path, true);
  if (shape === PUBLIC_JSON) return sanitizePublicJson(value, limits, path, depth);
  if (Array.isArray(shape)) {
    if (!Array.isArray(value) || value.length > limits.maxArrayItems) {
      throw aiError(AI_ERROR_CODES.INPUT_FIELD_NOT_ALLOWED, { httpStatus: 400, details: { phase: path } });
    }
    return value.map((item, index) => project(item, shape[0], limits, `${path}[${index}]`, depth + 1));
  }
  if (!isRecord(shape) || !isRecord(value)) {
    throw aiError(AI_ERROR_CODES.INPUT_FIELD_NOT_ALLOWED, { httpStatus: 400, details: { phase: path } });
  }
  const unknown = Object.keys(value).filter((key) => !Object.hasOwn(shape, key));
  if (unknown.length) {
    const prohibited = unknown.find((key) => isProhibitedKey(key));
    throw aiError(prohibited ? AI_ERROR_CODES.DATA_CLASS_PROHIBITED : AI_ERROR_CODES.INPUT_FIELD_NOT_ALLOWED, {
      httpStatus: 400,
      details: { phase: `${path}.${prohibited ?? unknown[0]}` },
    });
  }
  const output = {};
  for (const [key, childShape] of Object.entries(shape)) {
    if (!Object.hasOwn(value, key) || value[key] === undefined) continue;
    if (isProhibitedKey(key)) throw aiError(AI_ERROR_CODES.DATA_CLASS_PROHIBITED, { httpStatus: 400, details: { phase: `${path}.${key}` } });
    output[key] = project(value[key], childShape, limits, `${path}.${key}`, depth + 1);
  }
  return output;
}

export function sanitizeTaskInput(input, projection, options = {}) {
  const limits = Object.freeze({ ...DEFAULT_LIMITS, ...(options.limits ?? {}) });
  const sanitized = project(input, projection, limits, "input", 0);
  const bytes = new TextEncoder().encode(JSON.stringify(sanitized)).byteLength;
  if (bytes > limits.maxTotalBytes) throw aiError(AI_ERROR_CODES.INPUT_TOO_LARGE, { httpStatus: 413 });
  return sanitized;
}

export function assertDataClassAllowed(dataClass, providerId) {
  if (dataClass === "prohibited") throw aiError(AI_ERROR_CODES.DATA_CLASS_PROHIBITED, { httpStatus: 400 });
  if (["openrouter", "nvidia_nim"].includes(providerId) && dataClass !== "public_market") {
    throw aiError(AI_ERROR_CODES.DATA_CLASS_PROHIBITED, { httpStatus: 400, details: { providerId } });
  }
}
