export const FORECASTABILITY = Object.freeze([
  "forecastable", "valid_low_probability", "valid_very_unlikely", "already_determined", "stale", "unknown",
]);

export function evaluateValiditySeparately({ structuralIssues = [], probability = null, resultKnown = false, stale = false } = {}) {
  if (resultKnown) return { integrity_status: "fail", forecastability_status: "already_determined", human_review_required: false };
  if (stale) return { integrity_status: "fail", forecastability_status: "stale", human_review_required: false };
  if (structuralIssues.length) return { integrity_status: "needs_edit", forecastability_status: "unknown", human_review_required: true };
  const numeric = Number(probability);
  const forecastability = Number.isFinite(numeric) && numeric <= 0.05
    ? "valid_very_unlikely"
    : Number.isFinite(numeric) && numeric <= 0.2
      ? "valid_low_probability"
      : "forecastable";
  return { integrity_status: "pass", forecastability_status: forecastability, human_review_required: false };
}

export function validateBinaryOptions(options = []) {
  if (!Array.isArray(options) || options.length !== 2) return [{ code: "BINARY_OPTIONS_REQUIRED", field: "options" }];
  const values = options.map((value) => String(value || "").trim().toLowerCase());
  if (!values[0] || !values[1] || values[0] === values[1]) return [{ code: "OPTIONS_OVERLAP", field: "options" }];
  return [];
}
