import { createClient } from "https://esm.sh/@supabase/supabase-js@2.55.0";
import {
  isRecord,
  safePublicUrl,
  validateRegisteredPrimarySource,
} from "../_shared/market-draft-repair.mjs";
import { runScheduledPublicationCycle } from "../_shared/scheduled-publication-cycle.mjs";

type JsonRecord = Record<string, unknown>;
type ServiceClient = ReturnType<typeof createClient<any, "public", any>>;

const MAX_DUE_DRAFTS = 20;
const SOURCE_REVALIDATION_CONCURRENCY = 4;
const SOURCE_REVALIDATION_TIMEOUT_MS = 6_000;
const SOURCE_REVALIDATION_BUDGET_MS = 28_000;

const jsonHeaders = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
};

function jsonResponse(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers: jsonHeaders });
}

function text(value: unknown, max = 160): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function records(value: unknown): JsonRecord[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

async function serviceRpc(
  client: ServiceClient,
  name: string,
  args: JsonRecord,
): Promise<JsonRecord> {
  const { data, error } = await client.rpc(name, args);
  if (error) throw new Error(text(error.message || error.code, 120) || "RPC_FAILED");
  return isRecord(data) ? data : {};
}

async function mapWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  worker: (value: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (cursor < values.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(values[index]);
    }
  }));
  return results;
}

async function revalidateScheduledSource(
  client: ServiceClient,
  item: JsonRecord,
  registry: JsonRecord[],
  deadlineAt: number,
  signal: AbortSignal,
): Promise<JsonRecord> {
  const scope = isRecord(item.source_revalidation) ? item.source_revalidation : null;
  const draft = scope && isRecord(scope.draft) ? scope.draft : null;
  const draftId = text(scope?.draft_id, 80);
  const expectedVersion = Number(scope?.expected_version);
  const expectedFingerprint = text(scope?.expected_fingerprint, 80).toLowerCase();
  const requestId = text(scope?.request_id, 80);
  const issueIds = Array.isArray(scope?.issue_ids)
    ? scope.issue_ids.map((value) => text(value, 80)).filter(Boolean) : [];
  const primaryUrl = safePublicUrl(isRecord(draft?.primary_source) ? draft.primary_source.url : null);
  if (!draft || !primaryUrl || !/^[0-9a-f-]{36}$/i.test(draftId)
    || !Number.isSafeInteger(expectedVersion) || expectedVersion < 1
    || !/^[a-f0-9]{64}$/.test(expectedFingerprint)
    || !/^[0-9a-f-]{36}$/i.test(requestId) || issueIds.length !== 1) {
    return { draft_id: draftId, status: "invalid_scope", recovered: false };
  }
  const validation = await validateRegisteredPrimarySource(
    { url: primaryUrl, origin: "scheduled_publication" },
    { draft, source_validation_category: text(draft.category, 120) },
    registry,
    globalThis.fetch,
    {
      signal,
      deadline_at: deadlineAt,
      timeout_ms: Math.min(SOURCE_REVALIDATION_TIMEOUT_MS, Math.max(1, deadlineAt - Date.now())),
      max_redirects: 3,
    },
  );
  const evidence: JsonRecord | null = isRecord(validation?.evidence)
    ? validation.evidence as JsonRecord : null;
  if (!evidence || evidence.accepted !== true || text(evidence.code, 100) !== "PRIMARY_SOURCE_VERIFIED") {
    return {
      draft_id: draftId,
      status: "source_unavailable",
      error: text(evidence?.code, 100) || "PRIMARY_SOURCE_UNAVAILABLE",
      recovered: false,
    };
  }
  try {
    const recorded = await serviceRpc(client, "record_market_draft_primary_source_check_v1", {
      draft_id_input: draftId,
      draft_version_input: expectedVersion,
      registry_source_id_input: evidence.registry_source_id,
      requested_url_input: evidence.requested_url,
      final_url_input: evidence.final_url,
      category_input: evidence.draft_category,
      validation_version_input: evidence.validation_version,
      evidence_snapshot_input: evidence,
    });
    const checkId = text(recorded.id, 80);
    if (!/^[0-9a-f-]{36}$/i.test(checkId)) throw new Error("PRIMARY_SOURCE_CHECK_RECORD_INVALID");
    const outcome = await serviceRpc(client, "revalidate_market_draft_publication_evidence_v1", {
      draft_id_input: draftId,
      expected_version_input: expectedVersion,
      expected_fingerprint_input: expectedFingerprint,
      issue_ids_input: issueIds,
      primary_source_check_id_input: checkId,
      request_id_input: requestId,
      actor_id_input: null,
    });
    return {
      draft_id: draftId,
      status: text(outcome.status, 80),
      recovered: outcome.status === "scheduled" && outcome.authority_preserved === true,
      owner_stage: outcome.owner_stage,
      next_action: outcome.next_action,
      error: outcome.status === "validation_required"
        ? "PUBLICATION_EVIDENCE_BASELINE_MISSING"
        : outcome.status === "repair_required" ? "SOURCE_CONTENT_CHANGED" : null,
    };
  } catch (error) {
    return {
      draft_id: draftId,
      status: "revalidation_failed",
      error: text(error instanceof Error ? error.message : error, 100) || "SOURCE_REVALIDATION_FAILED",
      recovered: false,
    };
  }
}

Deno.serve(async (request) => {
  if (request.method !== "POST") {
    return jsonResponse(405, { error: "METHOD_NOT_ALLOWED" });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const cronSecret = request.headers.get("x-atinara-cron-secret") || "";

  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse(503, { error: "PUBLICATION_SERVICE_UNAVAILABLE" });
  }

  if (cronSecret.length < 32 || cronSecret.length > 256) {
    return jsonResponse(401, { error: "NOT_AUTHORIZED" });
  }

  const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: authorized, error: authorizationError } = await serviceClient.rpc(
    "verify_market_publish_cron_secret",
    { candidate_secret: cronSecret },
  );

  if (authorizationError) {
    console.error("Scheduled market authorization failed", {
      code: authorizationError.code || "RPC_FAILED",
    });
    return jsonResponse(503, { error: "PUBLICATION_SERVICE_UNAVAILABLE" });
  }

  if (authorized !== true) {
    return jsonResponse(401, { error: "NOT_AUTHORIZED" });
  }

  let cycle: { published: JsonRecord[]; failed: JsonRecord[]; sourceOutcomes: JsonRecord[] };
  try {
    cycle = await runScheduledPublicationCycle({
      maxDue: MAX_DUE_DRAFTS,
      publishDue: async (limit: number) => {
        const { data, error } = await serviceClient.rpc("publish_due_market_drafts_v2", {
          limit_count: limit,
        });
        if (error) throw new Error(text(error.code || error.message, 120) || "RPC_FAILED");
        return isRecord(data) ? data : {};
      },
      loadRegistry: async () => {
        const { data, error } = await serviceClient.rpc(
          "get_market_draft_authoritative_source_registry_v1",
          { role_input: "primary_resolution" },
        );
        if (error) throw new Error(text(error.code || error.message, 120) || "RPC_FAILED");
        return records(data);
      },
      revalidateBatch: async (sourceStale: JsonRecord[], registry: JsonRecord[]) => {
        const deadlineAt = Date.now() + SOURCE_REVALIDATION_BUDGET_MS;
        return await mapWithConcurrency(
          sourceStale,
          SOURCE_REVALIDATION_CONCURRENCY,
          (item) => revalidateScheduledSource(
            serviceClient,item,registry,deadlineAt,request.signal,
          ),
        );
      },
      onOperationalError: (code: string, error: unknown) => console.error(
        "Scheduled publication recovery unavailable",
        { code, detail: text(error instanceof Error ? error.message : error, 80) || "FAILED" },
      ),
    });
  } catch (error) {
    console.error("Scheduled market publication failed", {
      code: text(error instanceof Error ? error.message : error, 100) || "RPC_FAILED",
    });
    return jsonResponse(503, { error: "PUBLICATION_SERVICE_UNAVAILABLE" });
  }

  const { published, failed, sourceOutcomes } = cycle;

  const publishedCount = published.length;
  const failedCount = failed.length;
  return jsonResponse(failedCount > 0 ? 207 : 200, {
    status: failedCount > 0 ? "PARTIAL" : "OK",
    published_count: publishedCount,
    failed_count: failedCount,
    retry_wait_count: failed.filter((item: Record<string, unknown>) => item.status === "retry_wait").length,
    blocked_recoverable_count: failed.filter(
      (item: Record<string, unknown>) => item.status === "publication_blocked_recoverable",
    ).length,
    failed_terminal_count: failed.filter(
      (item: Record<string, unknown>) => item.status === "publication_failed_terminal",
    ).length,
    source_revalidated_count: sourceOutcomes.filter((item) => item.recovered === true).length,
    source_changed_count: sourceOutcomes.filter((item) => item.status === "repair_required").length,
    baseline_review_required_count: sourceOutcomes.filter(
      (item) => item.status === "validation_required",
    ).length,
    source_revalidation_failed_count: sourceOutcomes.filter(
      (item) => !["scheduled", "repair_required", "validation_required"].includes(text(item.status, 80)),
    ).length,
  });
});
