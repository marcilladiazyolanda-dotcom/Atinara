import assert from "node:assert/strict";
import test from "node:test";

import { runScheduledPublicationCycle } from "../supabase/functions/_shared/scheduled-publication-cycle.mjs";

function stale(draftId) {
  return {
    draft_id: draftId,
    status: "publication_blocked_recoverable",
    error: "SOURCE_STALE",
    owner_stage: "corrector",
    next_action: "revalidate_temporal_evidence",
    source_revalidation: { draft_id: draftId },
  };
}

test("scheduler V6 revalida evidencia equivalente y publica una sola vez en el segundo pase", async () => {
  const calls = [];
  const draftId = "00000000-0000-4000-8000-000000000001";
  const result = await runScheduledPublicationCycle({
    publishDue: async (limit) => {
      calls.push(["publish", limit]);
      return calls.filter(([kind]) => kind === "publish").length === 1
        ? { published: [], failed: [stale(draftId)] }
        : { published: [{ draft_id: draftId, market_id: "scheduled-safe" }], failed: [] };
    },
    loadRegistry: async () => {
      calls.push(["registry"]);
      return [{ id: "source-1" }];
    },
    revalidateBatch: async (items, registry) => {
      calls.push(["revalidate", items.length, registry.length]);
      return [{ draft_id: draftId, status: "scheduled", recovered: true }];
    },
  });

  assert.deepEqual(calls, [
    ["publish", 20],
    ["registry"],
    ["revalidate", 1, 1],
    ["publish", 1],
  ]);
  assert.equal(result.published.length, 1);
  assert.equal(result.failed.length, 0);
  assert.equal(result.sourceOutcomes[0].recovered, true);
});

test("scheduler V6 no reintenta cuando cambia evidencia o falta baseline y conserva el owner exacto", async () => {
  const changedId = "00000000-0000-4000-8000-000000000002";
  const legacyId = "00000000-0000-4000-8000-000000000003";
  let publishCalls = 0;
  const result = await runScheduledPublicationCycle({
    publishDue: async () => {
      publishCalls += 1;
      return { published: [], failed: [stale(changedId), stale(legacyId)] };
    },
    loadRegistry: async () => [{ id: "source-1" }],
    revalidateBatch: async () => [
      { draft_id: changedId, status: "repair_required", recovered: false },
      { draft_id: legacyId, status: "validation_required", recovered: false },
    ],
  });

  assert.equal(publishCalls, 1);
  assert.deepEqual(result.failed.map(({ draft_id, error, owner_stage, next_action }) => ({
    draft_id,error,owner_stage,next_action,
  })), [
    {
      draft_id: changedId,
      error: "SOURCE_CONTENT_CHANGED",
      owner_stage: "corrector",
      next_action: "repair_temporal_or_source_contract",
    },
    {
      draft_id: legacyId,
      error: "PUBLICATION_EVIDENCE_BASELINE_MISSING",
      owner_stage: "validator",
      next_action: "request_market_validation",
    },
  ]);
});

test("scheduler V6 conserva un retry durable si se pierde el segundo pase", async () => {
  const draftId = "00000000-0000-4000-8000-000000000004";
  let publishCalls = 0;
  const operational = [];
  const result = await runScheduledPublicationCycle({
    publishDue: async () => {
      publishCalls += 1;
      if (publishCalls === 1) return { published: [], failed: [stale(draftId)] };
      throw new Error("RPC_UNAVAILABLE");
    },
    loadRegistry: async () => [],
    revalidateBatch: async () => [{ draft_id: draftId, status: "scheduled", recovered: true }],
    onOperationalError: (code) => operational.push(code),
  });

  assert.deepEqual(operational, ["PUBLICATION_RETRY_FAILED"]);
  assert.equal(result.published.length, 0);
  assert.equal(result.failed.length, 1);
  assert.equal(result.failed[0].status, "retry_wait");
  assert.equal(result.failed[0].error, "PUBLICATION_RETRY_PENDING");
  assert.equal(result.failed[0].retryable, true);
});
