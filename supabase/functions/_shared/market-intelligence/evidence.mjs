import { nullableFiniteNumber } from "../nullable-number.mjs";

export function aggregateSnapshots(snapshots = [], aggregation = "final") {
  const input = Array.isArray(snapshots) ? snapshots : [];
  const usable = input.filter((item) =>
    item?.error_code == null && item?.value !== null && item?.value !== undefined
      && !(typeof item?.value === "string" && !item.value.trim()));
  let accepted = usable;
  let value = null;
  if (aggregation === "maximum" || aggregation === "minimum") {
    accepted = usable.map((item) => ({ ...item, numeric: nullableFiniteNumber(item.value) }))
      .filter((item) => item.numeric !== null);
    const values = accepted.map((item) => item.numeric);
    if (values.length) value = aggregation === "maximum" ? Math.max(...values) : Math.min(...values);
  } else if (aggregation === "any_true" || aggregation === "all_true") {
    accepted = usable.filter((item) => typeof item.value === "boolean");
    if (accepted.length) value = aggregation === "any_true"
      ? accepted.some((item) => item.value === true)
      : accepted.every((item) => item.value === true);
  } else if (aggregation === "count") {
    value = usable.length;
  } else {
    accepted = usable.filter((item) => ["string", "number", "boolean"].includes(typeof item.value));
    value = accepted.at(-1)?.value ?? null;
  }
  const failed = input.length - accepted.length;
  if (!accepted.length) return { value: null, sample_count: 0, failed_count: failed, quality: "insufficient", reason_code: "SOURCE_DATA_MISSING" };
  return { value, sample_count: accepted.length, failed_count: failed, quality: failed ? "partial" : "complete", reason_code: null };
}

export function evidenceNeverAutoResolves(summary) {
  return {
    ...summary,
    ready_to_resolve: summary?.quality !== "insufficient",
    applies_resolution: false,
    human_review_required: true,
    human_confirmation_required: true,
  };
}
