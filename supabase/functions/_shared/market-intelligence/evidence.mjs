export function aggregateSnapshots(snapshots = [], aggregation = "final") {
  const usable = (Array.isArray(snapshots) ? snapshots : []).filter((item) => item?.error_code == null && item?.value !== null && item?.value !== undefined);
  const failed = (Array.isArray(snapshots) ? snapshots : []).length - usable.length;
  if (!usable.length) return { value: null, sample_count: 0, failed_count: failed, quality: "insufficient", reason_code: "SOURCE_DATA_MISSING" };
  const numeric = usable.map((item) => Number(item.value)).filter(Number.isFinite);
  let value = usable.at(-1)?.value ?? null;
  if (aggregation === "maximum" && numeric.length) value = Math.max(...numeric);
  else if (aggregation === "minimum" && numeric.length) value = Math.min(...numeric);
  else if (aggregation === "count") value = usable.length;
  else if (aggregation === "any_true") value = usable.some((item) => item.value === true);
  else if (aggregation === "all_true") value = usable.every((item) => item.value === true);
  return { value, sample_count: usable.length, failed_count: failed, quality: failed ? "partial" : "complete", reason_code: null };
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
