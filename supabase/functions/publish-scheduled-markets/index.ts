import { createClient } from "https://esm.sh/@supabase/supabase-js@2.55.0";

const jsonHeaders = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
};

function jsonResponse(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers: jsonHeaders });
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

  const { data, error } = await serviceClient.rpc("publish_due_market_drafts", {
    limit_count: 20,
  });

  if (error) {
    console.error("Scheduled market publication failed", { code: error.code || "RPC_FAILED" });
    return jsonResponse(503, { error: "PUBLICATION_SERVICE_UNAVAILABLE" });
  }

  const publishedCount = Array.isArray(data?.published) ? data.published.length : 0;
  const failedCount = Array.isArray(data?.failed) ? data.failed.length : 0;
  return jsonResponse(failedCount > 0 ? 207 : 200, {
    status: failedCount > 0 ? "PARTIAL" : "OK",
    published_count: publishedCount,
    failed_count: failedCount,
  });
});
