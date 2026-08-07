export const SOURCE_ROLES = Object.freeze([
  "DISCOVERY_SIGNAL",
  "PROBABILITY_SIGNAL",
  "CONTEXT_SOURCE",
  "PRIMARY_RESOLUTION",
  "FALLBACK_RESOLUTION",
  "CORROBORATION",
  "PROHIBITED_FOR_RESOLUTION",
]);

const RESOLUTION_ROLES = new Set(["PRIMARY_RESOLUTION", "FALLBACK_RESOLUTION", "CORROBORATION"]);

export function defaultSourceRoles(provider) {
  const normalized = String(provider || "").toLowerCase();
  if (["polymarket", "kalshi"].includes(normalized)) return ["DISCOVERY_SIGNAL", "PROBABILITY_SIGNAL"];
  if (normalized === "igdb") return ["DISCOVERY_SIGNAL", "CONTEXT_SOURCE", "CORROBORATION"];
  if (["youtube", "twitch"].includes(normalized)) return ["DISCOVERY_SIGNAL", "CONTEXT_SOURCE", "PRIMARY_RESOLUTION"];
  if (normalized === "tavily") return ["CONTEXT_SOURCE", "PROHIBITED_FOR_RESOLUTION"];
  return ["CONTEXT_SOURCE"];
}

export function validateSourceAssignments(sources = [], captureStrategy = "") {
  const issues = [];
  const normalized = Array.isArray(sources) ? sources : [];
  for (const [index, source] of normalized.entries()) {
    if (!SOURCE_ROLES.includes(source?.role)) issues.push({ code: "SOURCE_ROLE_REQUIRED", field: `sources.${index}.role` });
    if (source?.role === "FALLBACK_RESOLUTION" && !String(source?.fallback_condition || "").trim()) {
      issues.push({ code: "SOURCE_FALLBACK_CONDITION_REQUIRED", field: `sources.${index}.fallback_condition` });
    }
    if (source?.role === "PROHIBITED_FOR_RESOLUTION" && source?.required === true) {
      issues.push({ code: "PROHIBITED_SOURCE_CANNOT_BE_REQUIRED", field: `sources.${index}.required` });
    }
    if (!Number.isInteger(Number(source?.precedence)) || Number(source.precedence) < 1) {
      issues.push({ code: "SOURCE_PRECEDENCE_INVALID", field: `sources.${index}.precedence` });
    }
  }
  const precedence = normalized
    .filter((source) => RESOLUTION_ROLES.has(source?.role))
    .map((source) => Number(source.precedence));
  if (new Set(precedence).size !== precedence.length) issues.push({ code: "SOURCE_PRECEDENCE_INVALID", field: "sources" });
  const hasPrimary = normalized.some((source) => source?.role === "PRIMARY_RESOLUTION");
  if (!hasPrimary && captureStrategy !== "manual_official_source") {
    issues.push({ code: "RESOLUTION_PRIMARY_SOURCE_REQUIRED", field: "sources" });
  }
  return issues;
}

export function sourceCanResolve(role) {
  return role === "PRIMARY_RESOLUTION" || role === "FALLBACK_RESOLUTION";
}
