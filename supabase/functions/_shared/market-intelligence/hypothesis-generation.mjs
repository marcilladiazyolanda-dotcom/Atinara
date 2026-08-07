import { chooseMilestoneHorizon } from "./temporal-logic.mjs";
import { detectStoryPattern } from "./story-arcs.mjs";

function base(origin, pattern) {
  return {
    opportunity_type: String(origin.opportunity_type || "other_reviewed"),
    pattern,
    hypothesis_status: "generated",
    why_now: String(origin.why_now || "Existe un disparador factual reciente y una cuestión todavía abierta."),
    market_thesis: String(origin.market_thesis || "La señal puede convertirse en una pregunta binaria si conserva incertidumbre y una vía de resolución verificable."),
    factual_basis: String(origin.factual_basis || ""),
    contextual_basis: String(origin.contextual_basis || ""),
    unresolved_question: String(origin.unresolved_question || ""),
    resolution_path: origin.resolution_path || {},
    rejection_reason_codes: [],
  };
}

export function generateHypotheses(origin = {}, options = {}) {
  if (origin.outcome_known === true || origin.marketability_status === "already_resolved") return [];
  if (origin.provider === "youtube" && (origin.head_to_head === true || origin.mixed_provider_metric === true || origin.metric_hidden === true)) return [];
  const pattern = detectStoryPattern(origin);
  if (!pattern) return [];
  const entity = String(origin.entity_label || origin.title || "la entidad").trim();
  const proposals = [];
  if (pattern === "MILESTONE_WITH_NARRATIVE") {
    const threshold = Number(origin.milestone_value);
    if (!Number.isFinite(threshold) || !origin.milestone_metric || !origin.contextual_basis) return [];
    const evaluationAt = chooseMilestoneHorizon({ now: options.now || new Date(), viableDays: origin.viable_horizons_days || [] });
    if (!evaluationAt) return [];
    const formatted = new Intl.NumberFormat("es-ES", { maximumFractionDigits: 0 }).format(threshold);
    proposals.push({
      ...base(origin, pattern),
      proposed_question: `¿Alcanzará ${entity} al menos ${formatted} ${String(origin.milestone_unit || "").trim()} antes del ${new Intl.DateTimeFormat("es-ES", { dateStyle: "long", timeZone: "Europe/Madrid" }).format(new Date(evaluationAt))}?`,
      unresolved_question: origin.unresolved_question || `Si la métrica pública alcanzará ${formatted} dentro del horizonte seleccionado.`,
      resolution_path: { provider: origin.provider, metric: origin.milestone_metric, threshold, evaluation_at: evaluationAt, capture_strategy: "snapshot_at_deadline" },
    });
  } else if (pattern === "SCHEDULED_REVEAL_WITH_UNKNOWN_CONTENT") {
    if (!origin.event_start_at || !origin.official_event_url || !origin.content_criterion) return [];
    proposals.push({
      ...base(origin, pattern),
      proposed_question: `¿Mostrará ${entity} ${String(origin.content_criterion).trim()} durante el evento anunciado?`,
      unresolved_question: origin.unresolved_question || `Si el contenido oficial incluirá ${String(origin.content_criterion).trim()}.`,
      resolution_path: { provider: origin.provider, event_url: origin.official_event_url, evaluation_at: origin.event_start_at, capture_strategy: "manual_official_source", metric: "content_occurrence" },
    });
  } else if (origin.suggested_question && origin.resolution_path) {
    proposals.push({ ...base(origin, pattern), proposed_question: String(origin.suggested_question).slice(0, 500) });
  }
  return proposals.slice(0, 3);
}
