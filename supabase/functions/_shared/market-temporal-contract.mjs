import { canonicalJson, sha256Hex } from "./ai/contracts.mjs";

export const ATINARA_TEMPORAL_CONTRACT_VERSION = "atinara-temporal-contract-v1";
export const ATINARA_TEMPORAL_POLICY_VERSION = "atinara-temporal-semantics-v1";

const RAW_DATE_FIELDS = Object.freeze({
  polymarket: Object.freeze([
    ["startDate", "market", "market_open"],
    ["endDate", "market", "market_resolution_window"],
    ["closedTime", "market", "market_closed"],
    ["gameStartTime", "event", "event_start"],
    ["umaEndDate", "market", "oracle_resolution_window"],
  ]),
  kalshi: Object.freeze([
    ["open_time", "market", "market_open"],
    ["close_time", "market", "last_trade"],
    ["expected_expiration_time", "market", "expected_result"],
    ["latest_expiration_time", "market", "latest_resolution"],
    ["expiration_time", "market", "legacy_expiration"],
    ["occurrence_datetime", "event", "event_occurrence"],
  ]),
});

const CONTRACT_KEYS = Object.freeze([
  "version", "raw_source_dates", "canonical_event_at", "forecast_closes_at",
  "evaluation_ends_at", "resolution_deadline", "timezone", "confidence",
  "evidence_refs", "anomaly_codes", "policy_version", "adapter_version",
  "decision_hash", "owner_stage", "blocking_scope", "next_action",
]);

function text(value, max = 500) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function iso(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

export function isIanaTimezone(value) {
  const timezone = text(value, 100);
  if (!timezone || timezone.startsWith("AMBIGUOUS:")) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(0);
    return true;
  } catch {
    return false;
  }
}

function firstValue(source, keys) {
  for (const key of keys) {
    const value = source?.[key];
    if (typeof value === "string" && value.trim()) return { key, value: value.trim() };
  }
  return null;
}

function rawSourceDates(candidate, fetchedAt) {
  const provider = text(candidate?.provider, 40).toLowerCase();
  const payload = record(candidate?.provider_payload) ?? record(candidate?.normalized_payload?.provider_payload) ?? {};
  const values = [];
  const seen = new Set();
  const add = (fieldName, rawValue, scope, declaredSemantics, source = payload) => {
    const value = text(rawValue, 160);
    if (!value || seen.has(`${fieldName}\u0000${value}`)) return;
    seen.add(`${fieldName}\u0000${value}`);
    values.push({
      provider,
      scope,
      field_name: fieldName,
      raw_value: value,
      parsed_iso: iso(value),
      declared_semantics: declaredSemantics,
      inferred_semantics: null,
      source_url: text(
        source?.url ?? candidate?.external_market_url ?? candidate?.external_event_url ?? candidate?.external_url,
        2_000,
      ) || null,
      fetched_at: fetchedAt,
      adapter_version: text(candidate?.normalizer_version, 100) || "atinara-radar-v2",
    });
  };
  for (const [fieldName, scope, semantics] of RAW_DATE_FIELDS[provider] ?? []) {
    add(fieldName, payload[fieldName], scope, semantics);
  }
  const fallbacks = [
    ["source_market_open_at", candidate?.source_market_open_at, "market", "normalized_market_open"],
    ["source_close_at", candidate?.source_close_at, "market", "normalized_provider_close"],
    ["source_event_at", candidate?.source_event_at, "event", "normalized_event_time"],
    ["source_event_start_at", candidate?.source_event_start_at, "event", "normalized_event_start"],
    ["source_event_end_at", candidate?.source_event_end_at, "event", "normalized_event_end"],
    ["source_settlement_at", candidate?.source_settlement_at, "market", "normalized_settlement"],
    ["source_resolution_deadline", candidate?.source_resolution_deadline, "market", "normalized_resolution_deadline"],
    ["source_series_expiry_at", candidate?.source_series_expiry_at, "series", "normalized_series_expiry"],
    ["source_last_trade_at", candidate?.source_last_trade_at, "market", "normalized_last_trade"],
  ];
  for (const [fieldName, rawValue, scope, semantics] of fallbacks) add(fieldName, rawValue, scope, semantics, candidate);
  return values;
}

function namedYear(candidate) {
  const material = [candidate?.source_title, candidate?.source_question, candidate?.atinara_question]
    .filter((value) => typeof value === "string").join(" ");
  const years = [...material.matchAll(/\b(20[2-9][0-9])\b/g)].map((match) => Number(match[1]));
  return years.length ? Math.min(...years) : null;
}

function sourceEvidence(candidate) {
  const lists = [candidate?.temporal_evidence, candidate?.resolution_source_evidence, candidate?.eligibility_evidence];
  return lists.flatMap((value) => Array.isArray(value) ? value : [])
    .filter((value) => record(value))
    .map((value) => {
      const fingerprint = text(value.fingerprint ?? value.content_sha256, 80);
      return {
        url: text(value.url, 2_000) || null,
        fingerprint: /^[a-f0-9]{64}$/i.test(fingerprint) ? fingerprint.toLowerCase() : null,
        role: text(value.role ?? value.source_role, 80) || null,
      };
    })
    .slice(0, 16);
}

function canonicalProjection(candidate) {
  const explicit = record(candidate?.atinara_temporal_projection)
    ?? record(candidate?.temporal_projection)
    ?? record(candidate?.temporal_contract);
  if (explicit) {
    const timezone = text(explicit.timezone, 100);
    return {
    canonical_event_at: iso(explicit.canonical_event_at),
    forecast_closes_at: iso(explicit.forecast_closes_at),
    evaluation_ends_at: iso(explicit.evaluation_ends_at),
    resolution_deadline: iso(explicit.resolution_deadline),
    timezone: isIanaTimezone(timezone) ? timezone : null,
    confidence: Number.isFinite(Number(explicit.confidence))
      ? Math.max(0, Math.min(100, Number(explicit.confidence))) : 0,
    };
  }
  const semantics = record(candidate?.family_semantics) ?? {};
  const boundary = record(semantics.temporal_boundary) ?? {};
  const evaluationEndsAt = iso(boundary.canonical_instant);
  const timezone = text(boundary.timezone, 100);
  const eligibleFamily = ["deadline_ladder", "milestone_thresholds"]
    .includes(text(candidate?.family_type, 80));
  const safeTimezone = isIanaTimezone(timezone) ? timezone : null;
  if (!eligibleFamily || !evaluationEndsAt || !safeTimezone || boundary.timezone_ambiguous === true) return {};
  const evaluationMs = Date.parse(evaluationEndsAt);
  return {
    canonical_event_at: null,
    forecast_closes_at: new Date(evaluationMs - 5 * 60_000).toISOString(),
    evaluation_ends_at: evaluationEndsAt,
    resolution_deadline: new Date(evaluationMs + (24 * 60 * 60_000) + (5 * 60_000)).toISOString(),
    timezone: safeTimezone,
    confidence: 95,
    contractual_question_boundary: true,
  };
}

export async function createAtinaraTemporalContract(candidate = {}, now = new Date().toISOString()) {
  const fetchedAt = iso(candidate?.fetched_at) ?? iso(now) ?? new Date().toISOString();
  const rawDates = rawSourceDates(candidate, fetchedAt);
  const projection = canonicalProjection(candidate);
  const evidenceRefs = sourceEvidence(candidate);
  const anomalies = [];
  const labelYear = namedYear(candidate);
  const providerClose = firstValue(candidate, ["source_close_at"]);
  const providerCloseIso = iso(providerClose?.value);
  if (labelYear && providerCloseIso && new Date(providerCloseIso).getUTCFullYear() > labelYear) {
    anomalies.push(projection.evaluation_ends_at && projection.timezone
      && (evidenceRefs.length || projection.contractual_question_boundary === true)
      ? "SOURCE_TECHNICAL_DATE_PRESERVED" : "TEMPORAL_SOURCE_SEMANTICS_MISMATCH");
  }
  if (!projection.evaluation_ends_at || !projection.timezone) {
    anomalies.push("TEMPORAL_AUTHORITATIVE_DATE_REQUIRED");
  }
  const blockingAnomalies = anomalies.filter((code) => code.startsWith("TEMPORAL_"));
  const material = {
    version: ATINARA_TEMPORAL_CONTRACT_VERSION,
    raw_source_dates: rawDates,
    canonical_event_at: projection.canonical_event_at ?? null,
    forecast_closes_at: projection.forecast_closes_at ?? null,
    evaluation_ends_at: projection.evaluation_ends_at ?? null,
    resolution_deadline: projection.resolution_deadline ?? null,
    timezone: projection.timezone ?? null,
    confidence: projection.confidence ?? 0,
    evidence_refs: evidenceRefs,
    anomaly_codes: [...new Set(anomalies)],
    policy_version: ATINARA_TEMPORAL_POLICY_VERSION,
    adapter_version: text(candidate?.normalizer_version, 100) || "atinara-radar-v2",
    owner_stage: blockingAnomalies.length ? "editor" : "radar",
    blocking_scope: blockingAnomalies.length ? "approval" : "none",
    next_action: blockingAnomalies.length ? "resolve_temporal_contract" : "continue_market_workflow",
  };
  const decisionMaterial = {
    ...material,
    raw_source_dates: rawDates.map(({ fetched_at: _fetchedAt, ...value }) => value),
  };
  return Object.freeze({ ...material, decision_hash: await sha256Hex(canonicalJson(decisionMaterial)) });
}

export function validateAtinaraTemporalContract(contract) {
  if (!record(contract) || JSON.stringify(Object.keys(contract).sort()) !== JSON.stringify([...CONTRACT_KEYS].sort())) {
    throw new TypeError("TEMPORAL_CONTRACT_KEYS_INVALID");
  }
  if (contract.version !== ATINARA_TEMPORAL_CONTRACT_VERSION
      || contract.policy_version !== ATINARA_TEMPORAL_POLICY_VERSION) {
    throw new TypeError("TEMPORAL_CONTRACT_VERSION_INVALID");
  }
  if (!Array.isArray(contract.raw_source_dates) || !Array.isArray(contract.evidence_refs)
      || !Array.isArray(contract.anomaly_codes)) throw new TypeError("TEMPORAL_CONTRACT_ARRAY_INVALID");
  if (!/^[a-f0-9]{64}$/.test(contract.decision_hash)) throw new TypeError("TEMPORAL_CONTRACT_HASH_INVALID");
  if (!Number.isFinite(contract.confidence) || contract.confidence < 0 || contract.confidence > 100) {
    throw new TypeError("TEMPORAL_CONTRACT_CONFIDENCE_INVALID");
  }
  for (const field of ["canonical_event_at", "forecast_closes_at", "evaluation_ends_at", "resolution_deadline"]) {
    if (contract[field] !== null && !iso(contract[field])) throw new TypeError("TEMPORAL_CONTRACT_DATE_INVALID");
  }
  if (contract.timezone !== null && !isIanaTimezone(contract.timezone)) {
    throw new TypeError("TEMPORAL_CONTRACT_TIMEZONE_INVALID");
  }
  canonicalJson(contract);
  return true;
}
