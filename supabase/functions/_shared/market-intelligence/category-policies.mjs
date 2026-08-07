export const CATEGORY_POLICIES = Object.freeze({
  Gaming: { allowed_opportunities: ["release_window", "platform_availability", "official_announcement", "scheduled_event_content"] },
  Streamers: { allowed_opportunities: ["live_event_threshold", "creator_commitment"] },
  YouTubers: { allowed_opportunities: ["milestone", "metric_threshold", "creator_commitment", "scheduled_event_content"] },
  "Reviews/Premios": { allowed_opportunities: ["scheduled_event_content", "official_announcement"] },
});

export function categoryAllows(category, opportunityType) {
  const policy = CATEGORY_POLICIES[category];
  return !policy || policy.allowed_opportunities.includes(opportunityType);
}
