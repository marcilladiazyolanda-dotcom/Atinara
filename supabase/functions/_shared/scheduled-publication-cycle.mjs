function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function records(value) {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function text(value, max = 160) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

/** @type {(code: string, error: unknown) => void} */
const noopOperationalError = () => undefined;

export async function runScheduledPublicationCycle({
  publishDue,
  loadRegistry,
  revalidateBatch,
  maxDue = 20,
  onOperationalError = noopOperationalError,
}) {
  if (typeof publishDue !== "function" || typeof loadRegistry !== "function"
    || typeof revalidateBatch !== "function") {
    throw new Error("SCHEDULED_PUBLICATION_DEPENDENCIES_INVALID");
  }
  const initial = await publishDue(maxDue);
  let published = records(initial?.published);
  let failed = records(initial?.failed);
  const sourceStale = failed.filter((item) => item.error === "SOURCE_STALE"
    && isRecord(item.source_revalidation));
  let sourceOutcomes = [];
  if (sourceStale.length === 0) return { published, failed, sourceOutcomes };

  let registry;
  try {
    registry = await loadRegistry();
  } catch (error) {
    onOperationalError("SOURCE_REGISTRY_UNAVAILABLE", error);
    return { published, failed, sourceOutcomes };
  }
  try {
    sourceOutcomes = records(await revalidateBatch(sourceStale, records(registry)));
  } catch (error) {
    onOperationalError("SOURCE_REVALIDATION_BATCH_FAILED", error);
    return { published, failed, sourceOutcomes: [] };
  }

  const outcomesByDraft = new Map(sourceOutcomes.map((item) => [text(item.draft_id, 80), item]));
  const recoveredDrafts = new Set(sourceOutcomes
    .filter((item) => item.recovered === true)
    .map((item) => text(item.draft_id, 80)));
  failed = failed.flatMap((item) => {
    const draftId = text(item.draft_id, 80);
    if (recoveredDrafts.has(draftId)) return [];
    const outcome = outcomesByDraft.get(draftId);
    if (outcome?.status === "validation_required") return [{
      ...item,
      error: "PUBLICATION_EVIDENCE_BASELINE_MISSING",
      owner_stage: "validator",
      next_action: "request_market_validation",
    }];
    if (outcome?.status === "repair_required") return [{
      ...item,
      error: "SOURCE_CONTENT_CHANGED",
      owner_stage: "corrector",
      next_action: "repair_temporal_or_source_contract",
    }];
    return [item];
  });

  if (recoveredDrafts.size > 0) {
    try {
      const retried = await publishDue(Math.min(maxDue, recoveredDrafts.size));
      published = published.concat(records(retried?.published));
      failed = failed.concat(records(retried?.failed));
    } catch (error) {
      onOperationalError("PUBLICATION_RETRY_FAILED", error);
      failed.push(...sourceStale
        .filter((item) => recoveredDrafts.has(text(item.draft_id, 80)))
        .map((item) => ({
          ...item,
          status: "retry_wait",
          error: "PUBLICATION_RETRY_PENDING",
          retryable: true,
        })));
    }
  }
  return { published, failed, sourceOutcomes };
}
