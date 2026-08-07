export const STORY_PATTERNS = Object.freeze([
  "MILESTONE_WITH_NARRATIVE",
  "SCHEDULED_REVEAL_WITH_UNKNOWN_CONTENT",
  "OFFICIAL_ANNOUNCEMENT_WITH_OPEN_CONSEQUENCE",
  "RELEASE_OR_PLATFORM_WINDOW",
  "LIVE_EVENT_THRESHOLD",
  "CREATOR_COMMITMENT",
]);

export function detectStoryPattern(input = {}) {
  const context = `${input.context_type || ""} ${input.catalyst_type || ""} ${input.opportunity_type || ""}`.toLowerCase();
  if (input.milestone_metric && input.milestone_value && String(input.contextual_basis || "").trim()) return "MILESTONE_WITH_NARRATIVE";
  if (input.event_start_at && input.content_confirmed !== true && /reveal|showcase|premiere|presentaci|estreno|scheduled/.test(context)) return "SCHEDULED_REVEAL_WITH_UNKNOWN_CONTENT";
  if (/announcement|anuncio/.test(context) && input.outcome_known !== true) return "OFFICIAL_ANNOUNCEMENT_WITH_OPEN_CONSEQUENCE";
  if (/release|platform|lanzamiento|plataforma/.test(context)) return "RELEASE_OR_PLATFORM_WINDOW";
  if (/live|stream|directo/.test(context) && input.metric_name) return "LIVE_EVENT_THRESHOLD";
  if (/commitment|compromiso/.test(context) && input.official_status === "official") return "CREATOR_COMMITMENT";
  return null;
}
