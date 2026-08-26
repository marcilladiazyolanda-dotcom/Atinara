function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function text(value, max = 4_000) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

/**
 * El Validator recibe una referencia editorial mínima. La atestación fresca
 * permanece separada y autoritativa; extractos recuperados, UUID internos y
 * banderas persistidas no atraviesan el Gateway ni consumen el prompt.
 */
export function semanticMarketSource(value) {
  if (!isRecord(value)) return {};
  const url = text(value.url, 2_048);
  const name = text(value.name, 500) || text(value.publisher, 500);
  const role = text(value.role, 120) || text(value.registry_role, 120);
  return {
    ...(url ? { url } : {}),
    ...(name ? { name } : {}),
    ...(role ? { role } : {}),
  };
}

export function semanticDraft(draft) {
  const sourceDraft = isRecord(draft) ? draft : {};
  return {
    market_slug: text(sourceDraft.market_slug),
    question: text(sourceDraft.question),
    subject: text(sourceDraft.subject),
    category: text(sourceDraft.category),
    yes_option: text(sourceDraft.yes_option),
    no_option: text(sourceDraft.no_option),
    evaluation_period_label: text(sourceDraft.evaluation_period_label),
    evaluation_ends_at: text(sourceDraft.evaluation_ends_at),
    closes_at: text(sourceDraft.closes_at),
    timezone: text(sourceDraft.timezone),
    resolution_deadline: text(sourceDraft.resolution_deadline),
    yes_criteria: text(sourceDraft.yes_criteria),
    no_criteria: text(sourceDraft.no_criteria),
    edge_cases: text(sourceDraft.edge_cases),
    primary_source: semanticMarketSource(sourceDraft.primary_source),
    alternative_sources: Array.isArray(sourceDraft.alternative_sources)
      ? sourceDraft.alternative_sources.map(semanticMarketSource)
      : [],
    delay_treatment: text(sourceDraft.delay_treatment),
    cancellation_treatment: text(sourceDraft.cancellation_treatment),
    leak_treatment: text(sourceDraft.leak_treatment),
    rename_treatment: text(sourceDraft.rename_treatment),
    assumptions: text(sourceDraft.assumptions),
    public_criteria: text(sourceDraft.public_criteria),
    description: text(sourceDraft.description),
  };
}
