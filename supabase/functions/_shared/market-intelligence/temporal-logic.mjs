import { INTELLIGENCE_LIMITS } from "./constitution.mjs";

export function safeDate(value) {
  const date = value ? new Date(value) : null;
  return date && Number.isFinite(date.getTime()) ? date : null;
}

export function chooseMilestoneHorizon({ now = new Date(), allowedDays = INTELLIGENCE_LIMITS.allowedMilestoneHorizonsDays, viableDays = [] } = {}) {
  const allowed = allowedDays.filter((days) => Number.isInteger(days) && days > 0 && days <= 90);
  const viable = new Set((Array.isArray(viableDays) ? viableDays : []).map(Number));
  const days = allowed.find((candidate) => !viable.size || viable.has(candidate));
  if (!days) return null;
  return new Date(now.getTime() + days * 86400000).toISOString();
}

export function validateTemporalContract(contract, now = new Date()) {
  const issues = [];
  const start = safeDate(contract?.window_start);
  const end = safeDate(contract?.window_end || contract?.evaluation_at);
  if (!end) issues.push({ code: "TEMPORAL_END_REQUIRED", field: "window_end" });
  else if (end <= now) issues.push({ code: "TEMPORAL_WINDOW_ALREADY_ENDED", field: "window_end" });
  if (start && end && start >= end) issues.push({ code: "TEMPORAL_INCOHERENCE", field: "window_start" });
  if (!String(contract?.timezone || "").includes("/")) issues.push({ code: "TIMEZONE_REQUIRED", field: "timezone" });
  if (Number(contract?.sampling_interval_seconds) === 60 && Number(contract?.maximum_monitor_duration_seconds) > 21600) {
    issues.push({ code: "HIGH_FREQUENCY_WINDOW_TOO_LONG", field: "maximum_monitor_duration_seconds" });
  }
  return issues;
}

export function announcedIsNotCompleted({ announced_at, occurred_at }) {
  return Boolean(safeDate(announced_at)) && !safeDate(occurred_at);
}
