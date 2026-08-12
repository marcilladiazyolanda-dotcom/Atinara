import { canonicalJson, sha256Hex } from "./ai/contracts.mjs";

export const ATINARA_AGENT_REGISTRY_VERSION = "atinara-agent-registry-v2.1.0";

export const MARKET_WRITER_FIELD_ALLOWLIST = Object.freeze([
  "market_slug", "question", "subject", "category", "yes_option", "no_option",
  "evaluation_period_label", "evaluation_ends_at", "closes_at", "timezone",
  "resolution_deadline", "yes_criteria", "no_criteria", "edge_cases",
  "public_criteria", "description", "delay_treatment", "cancellation_treatment",
  "leak_treatment", "rename_treatment", "assumptions", "primary_source",
  "alternative_sources",
]);

const WRITER_FIELDS = new Set(MARKET_WRITER_FIELD_ALLOWLIST);

export const STRATEGY_HANDLER_NAMES = Object.freeze([
  "block_exact_duplicate", "bounded_retry_backoff", "derive_edge_cases",
  "derive_evaluation_period", "derive_or_escalate_temporal_contract",
  "derive_public_criteria", "derive_resolution_deadline", "infer_canonical_subject",
  "infer_category", "infer_metric_contract", "infer_or_escalate_subject",
  "isolate_and_retry_batch", "normalize_binary_options", "normalize_iana_timezone",
  "preserve_effective_review_and_retry", "preserve_last_known_good",
  "quarantine_terminal_fact", "quarantine_unresolvable_contract",
  "reanalyze_current_revision", "rebuild_binary_question",
  "rebuild_or_escalate_contract", "rebuild_or_escalate_criteria",
  "rebuild_resolution_criteria", "refresh_deterministic_eligibility", "refresh_factual_dossier",
  "refresh_normalized_candidate", "reload_authoritative_version",
  "request_specific_contract_decision", "request_specific_editorial_decision",
  "request_specific_source_decision", "research_corroboration",
  "research_registered_primary", "research_registered_sources",
  "retry_after_backoff", "retry_semantic_review",
  "suppress_when_causal_root_exists", "surface_invalid_repair_strategy",
  "surface_missing_repair_strategy", "surface_provider_configuration_defect",
  "synchronize_temporal_fields",
]);

const WRITE_CAPABLE_STRATEGIES = new Set([
  "derive_edge_cases", "derive_evaluation_period", "derive_or_escalate_temporal_contract",
  "derive_public_criteria", "derive_resolution_deadline", "infer_canonical_subject",
  "infer_category", "infer_metric_contract", "infer_or_escalate_subject",
  "normalize_binary_options", "normalize_iana_timezone", "rebuild_binary_question",
  "rebuild_or_escalate_contract", "rebuild_or_escalate_criteria",
  "rebuild_resolution_criteria", "synchronize_temporal_fields",
]);

export const STRATEGY_HANDLER_REGISTRY = Object.freeze(Object.fromEntries(
  STRATEGY_HANDLER_NAMES.map((strategyKey) => [strategyKey, Object.freeze({
    strategyKey,
    handlerKey: strategyKey,
    canWrite: WRITE_CAPABLE_STRATEGIES.has(strategyKey),
  })]),
));

function record(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function text(value, max = 120) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function rows(value) {
  return Array.isArray(value) ? value.filter(record) : [];
}

function fields(value) {
  return Array.isArray(value) ? value.map((item) => text(item, 80)).filter(Boolean) : [];
}

export function assertAgentRegistrySnapshot(snapshot, handlers = STRATEGY_HANDLER_REGISTRY) {
  if (!record(snapshot)) throw new Error("AGENT_REGISTRY_INVALID");
  const issues = rows(snapshot.issues);
  const strategies = rows(snapshot.strategies);
  const bindings = rows(snapshot.bindings);
  const strategyKeys = new Set(strategies.map((item) => text(item.strategy_key)).filter(Boolean));
  const handlerKeys = new Set(Object.keys(handlers));

  for (const strategy of strategies) {
    const key = text(strategy.strategy_key);
    const handler = handlers[key];
    if (!key || !handler) throw new Error("AGENT_STRATEGY_HANDLER_MISSING");
    if (text(strategy.handler_key) && text(strategy.handler_key) !== text(handler.handlerKey)) {
      throw new Error("AGENT_STRATEGY_HANDLER_MISMATCH");
    }
    if ((strategy.can_write === true) !== (handler.canWrite === true)) throw new Error("AGENT_STRATEGY_WRITE_MISMATCH");
    if (strategy.can_write === true) {
      for (const field of fields(strategy.write_fields ?? strategy.affected_fields)) {
        if (!WRITER_FIELDS.has(field)) throw new Error("AGENT_STRATEGY_FIELD_NOT_ALLOWED");
      }
    }
  }
  for (const handlerKey of handlerKeys) {
    if (!strategyKeys.has(handlerKey)) throw new Error("AGENT_HANDLER_NOT_REGISTERED");
  }

  const boundIssues = new Set(bindings.map((item) => text(item.issue_code)).filter(Boolean));
  for (const binding of bindings) {
    if (!strategyKeys.has(text(binding.strategy_key))) throw new Error("AGENT_BINDING_STRATEGY_MISSING");
  }
  for (const issue of issues) {
    if (issue.repairable === true && !boundIssues.has(text(issue.code))) {
      throw new Error("AGENT_REPAIRABLE_ISSUE_UNBOUND");
    }
  }
  return Object.freeze({ issues: issues.length, strategies: strategies.length, bindings: bindings.length });
}

export function strategyAllowsWrite(strategyKey) {
  return STRATEGY_HANDLER_REGISTRY[text(strategyKey)]?.canWrite === true;
}

export function assertRegistryIdentity(run, registryVersion, registryHash) {
  if (text(run?.registryVersion, 120) !== text(registryVersion, 120)
    || !/^[0-9a-f]{64}$/i.test(text(registryHash, 64))
    || text(run?.registryHash, 64).toLowerCase() !== text(registryHash, 64).toLowerCase()) {
    throw new Error("AGENT_REGISTRY_IDENTITY_MISMATCH");
  }
  return true;
}

export async function agentRegistryHash(snapshot) {
  assertAgentRegistrySnapshot(snapshot);
  return sha256Hex(canonicalJson({
    version: ATINARA_AGENT_REGISTRY_VERSION,
    issues: rows(snapshot.issues),
    strategies: rows(snapshot.strategies),
    bindings: rows(snapshot.bindings),
  }));
}
