import { AI_ERROR_CODES, aiError } from "./errors.mjs";

export const AI_EXECUTION_PROFILE_STANDARD = "standard";
export const AI_EXECUTION_PROFILE_SINGLE_INFERENCE_SMOKE_V1 = "single_inference_smoke_v1";

export const AI_EXECUTION_PROFILES = Object.freeze([
  AI_EXECUTION_PROFILE_STANDARD,
  AI_EXECUTION_PROFILE_SINGLE_INFERENCE_SMOKE_V1,
]);

function profileNotAllowed() {
  return aiError(AI_ERROR_CODES.EXECUTION_PROFILE_NOT_ALLOWED, {
    httpStatus: 400,
    details: { phase: "execution_profile" },
  });
}

export function parseAiExecutionProfile(value) {
  if (value == null || value === "") return AI_EXECUTION_PROFILE_STANDARD;
  if (typeof value !== "string" || !AI_EXECUTION_PROFILES.includes(value)) {
    throw profileNotAllowed();
  }
  return value;
}

export function resolveAiExecutionProfile({ executionProfile, taskType, transportMode, policy }) {
  if (executionProfile === AI_EXECUTION_PROFILE_STANDARD) {
    return Object.freeze({
      executionProfile,
      providerRequestLimit: null,
      policy,
    });
  }
  if (
    executionProfile !== AI_EXECUTION_PROFILE_SINGLE_INFERENCE_SMOKE_V1
    || taskType !== "market_draft_validation"
    || transportMode !== "legacy_direct"
  ) {
    throw profileNotAllowed();
  }
  return Object.freeze({
    executionProfile,
    providerRequestLimit: 1,
    policy: Object.freeze({
      ...policy,
      httpRetries: 0,
      invalidOutputRetries: 0,
      schemaFallback: false,
    }),
  });
}
