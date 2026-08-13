import { SOURCE_CONTRACT_SCHEMA_VERSION, MARKET_INTELLIGENCE_POLICY_VERSION } from "./constitution.mjs";
import { validateSourceAssignments } from "./source-roles.mjs";
import { validateTemporalContract } from "./temporal-logic.mjs";

export const CAPTURE_STRATEGIES = Object.freeze(["current_at_resolution", "snapshot_at_deadline", "poll_during_window", "event_presence", "static_revalidation", "manual_official_source"]);
export const AGGREGATIONS = Object.freeze(["final", "maximum", "minimum", "any_true", "all_true", "count", "exact_state"]);

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort((left, right) => left.localeCompare(right)).map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

export function stableContractString(contract) {
  const copy = { ...contract };
  delete copy.contract_hash;
  delete copy.validated_at;
  delete copy.approved_at;
  delete copy.approved_by;
  delete copy.locked_at;
  return stable(copy);
}

export async function contractHash(contract) {
  const bytes = new TextEncoder().encode(stableContractString(contract));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function validateResolutionContract(contract, now = new Date()) {
  const issues = [];
  if (contract?.contract_schema_version !== SOURCE_CONTRACT_SCHEMA_VERSION) issues.push({ code: "RESOLUTION_SCHEMA_VERSION_UNKNOWN", field: "contract_schema_version" });
  if (contract?.policy_version !== MARKET_INTELLIGENCE_POLICY_VERSION) issues.push({ code: "RESOLUTION_POLICY_VERSION_UNKNOWN", field: "policy_version" });
  if (!String(contract?.canonical_statement || "").trim()) issues.push({ code: "CANONICAL_STATEMENT_REQUIRED", field: "canonical_statement" });
  if (!CAPTURE_STRATEGIES.includes(contract?.capture_strategy)) issues.push({ code: "SOURCE_METRIC_UNSUPPORTED", field: "capture_strategy" });
  if (!AGGREGATIONS.includes(contract?.aggregation)) issues.push({ code: "AGGREGATION_UNSUPPORTED", field: "aggregation" });
  if (contract?.opportunity_type === "metric_threshold") {
    for (const field of ["metric", "operator", "threshold", "precision"]) if (contract?.[field] === null || contract?.[field] === undefined || contract?.[field] === "") issues.push({ code: "METRIC_CONTRACT_INCOMPLETE", field });
  }
  issues.push(...validateTemporalContract(contract, now));
  issues.push(...validateSourceAssignments(contract?.sources, contract?.capture_strategy));
  if (contract?.capture_strategy === "poll_during_window" && Number(contract?.sampling_interval_seconds) < 60) issues.push({ code: "MONITOR_INTERVAL_UNSAFE", field: "sampling_interval_seconds" });
  if (contract?.provider === "youtube" && Number(contract?.maximum_monitor_duration_seconds) > 30 * 86400) issues.push({ code: "SOURCE_RETENTION_INCOMPATIBLE", field: "maximum_monitor_duration_seconds" });
  return issues;
}

export function monitorRequired(contract) {
  return ["snapshot_at_deadline", "poll_during_window", "event_presence"].includes(contract?.capture_strategy);
}
