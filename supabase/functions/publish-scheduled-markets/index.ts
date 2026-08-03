import { createClient } from "https://esm.sh/@supabase/supabase-js@2.55.0";

const jsonHeaders = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
};

function jsonResponse(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers: jsonHeaders });
}

async function sameSecret(received: string, expected: string) {
  const encoder = new TextEncoder();
  const [receivedHash, expectedHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(received)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ]);
  const left = new Uint8Array(receivedHash);
  const right = new Uint8Array(expectedHash);
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left[index] ^ right[index];
  }
  return difference === 0;
}

Deno.serve(async (request) => {
  if (request.method !== "POST") {
    return jsonResponse(405, { error: "METHOD_NOT_ALLOWED" });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const authorization = request.headers.get("authorization") || "";
  const expectedAuthorization = serviceRoleKey ? `Bearer ${serviceRoleKey}` : "";

  if (!supabaseUrl || !expectedAuthorization
      || !(await sameSecret(authorization, expectedAuthorization))) {
    return jsonResponse(401, { error: "NOT_AUTHORIZED" });
  }

  const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
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
