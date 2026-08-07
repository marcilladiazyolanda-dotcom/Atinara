import { INTELLIGENCE_LIMITS, SCHEDULER_DEFAULTS } from "./constitution.mjs";

export function contextBudget(input = {}) {
  return {
    max_entities: Math.min(Math.max(Number(input.max_entities) || INTELLIGENCE_LIMITS.maxContextScansPerRun, 1), INTELLIGENCE_LIMITS.maxContextScansPerRun),
    max_tavily_queries: Math.min(Math.max(Number(input.max_tavily_queries) || INTELLIGENCE_LIMITS.maxTavilyQueriesPerRun, 0), INTELLIGENCE_LIMITS.maxTavilyQueriesPerRun),
    max_hypotheses_per_entity: Math.min(Math.max(Number(input.max_hypotheses_per_entity) || INTELLIGENCE_LIMITS.maxHypothesesPerEntity, 0), INTELLIGENCE_LIMITS.maxHypothesesPerEntity),
  };
}

export function canRunContextScan({ last_checked_at, fingerprint, previous_fingerprint, now = new Date() } = {}) {
  if (fingerprint && fingerprint === previous_fingerprint) return { allowed: false, code: "CONTEXT_UNCHANGED" };
  const last = last_checked_at ? new Date(last_checked_at) : null;
  const elapsed = last && Number.isFinite(last.getTime()) ? now.getTime() - last.getTime() : Infinity;
  if (elapsed < INTELLIGENCE_LIMITS.contextScanCooldownMinutes * 60000) return { allowed: false, code: "CONTEXT_COOLDOWN" };
  return { allowed: true, code: "CONTEXT_SCAN_ALLOWED" };
}

export function schedulerConfiguration(overrides = {}) {
  return { ...SCHEDULER_DEFAULTS, ...overrides, contextDiscoveryEnabled: overrides.contextDiscoveryEnabled === true };
}

export function scheduledDiscoveryMayMutate(action) {
  return ["upsert_context_item", "upsert_story_arc", "upsert_private_hypothesis"].includes(action);
}
