import { API_HOST_ALLOWLIST, publicErrorCode } from "./index.mjs";

export type JsonRecord = Record<string, unknown>;

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export function jsonResponse(body: JsonRecord, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

function configuredKey(variable: string, legacy: string): string {
  const configured = Deno.env.get(variable);
  if (configured) {
    try {
      const parsed = JSON.parse(configured) as Record<string, string>;
      if (parsed.default) return parsed.default;
    } catch {
      // Compatibilidad con secretos anteriores.
    }
  }
  return Deno.env.get(legacy) ?? "";
}

export function getSupabaseEnvironment() {
  const value = {
    supabaseUrl: Deno.env.get("SUPABASE_URL") ?? "",
    publishableKey: configuredKey("SUPABASE_PUBLISHABLE_KEYS", "SUPABASE_ANON_KEY"),
    secretKey: configuredKey("SUPABASE_SECRET_KEYS", "SUPABASE_SERVICE_ROLE_KEY"),
  };
  return value.supabaseUrl && value.publishableKey && value.secretKey ? value : null;
}

function restHeaders(key: string, authorization?: string): Record<string, string> {
  const headers: Record<string, string> = { apikey: key, "Content-Type": "application/json" };
  if (authorization) headers.Authorization = authorization;
  else if (!key.startsWith("sb_secret_")) headers.Authorization = `Bearer ${key}`;
  return headers;
}

export async function rpc(environment: NonNullable<ReturnType<typeof getSupabaseEnvironment>>, name: string, args: JsonRecord, options: { authorization?: string; service?: boolean } = {}): Promise<unknown> {
  const key = options.service ? environment.secretKey : environment.publishableKey;
  const response = await fetch(`${environment.supabaseUrl}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: restHeaders(key, options.service ? undefined : options.authorization),
    body: JSON.stringify(args),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    console.error("Market intelligence RPC failed", JSON.stringify({ name, status: response.status }));
    throw new Error(`RPC_${response.status}`);
  }
  return payload;
}

export async function authenticateAdmin(environment: NonNullable<ReturnType<typeof getSupabaseEnvironment>>, authorization: string): Promise<{ adminId: string } | Response> {
  if (!authorization.startsWith("Bearer ")) return jsonResponse({ error: "AUTH_REQUIRED", message: "Inicia sesión para usar esta herramienta administrativa." }, 401);
  const response = await fetch(`${environment.supabaseUrl}/auth/v1/user`, { headers: { Authorization: authorization, apikey: environment.publishableKey } });
  if (!response.ok) return jsonResponse({ error: "AUTH_REQUIRED", message: "La sesión ha caducado." }, 401);
  const user = await response.json() as JsonRecord;
  const metadata = user.app_metadata && typeof user.app_metadata === "object" ? user.app_metadata as JsonRecord : {};
  if (metadata.oraklo_admin !== true) return jsonResponse({ error: "ADMIN_REQUIRED", message: "Esta herramienta es privada para administración." }, 403);
  return { adminId: String(user.id || "").slice(0, 80) };
}

async function secureTokenMatch(candidate: string, expected: string): Promise<boolean> {
  if (!candidate || !expected) return false;
  const encode = (value: string) => new TextEncoder().encode(value);
  const [left, right] = await Promise.all([
    crypto.subtle.digest("SHA-256", encode(candidate)),
    crypto.subtle.digest("SHA-256", encode(expected)),
  ]);
  const leftBytes = new Uint8Array(left);
  const rightBytes = new Uint8Array(right);
  let difference = leftBytes.length ^ rightBytes.length;
  for (let index = 0; index < Math.min(leftBytes.length, rightBytes.length); index += 1) difference |= leftBytes[index] ^ rightBytes[index];
  return difference === 0;
}

export async function authenticateAdminOrService(environment: NonNullable<ReturnType<typeof getSupabaseEnvironment>>, authorization: string, allowService = false): Promise<{ adminId: string; isService?: boolean } | Response> {
  if (allowService && authorization.startsWith("Bearer ")) {
    const candidate = authorization.slice(7);
    const legacyServiceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    if (await secureTokenMatch(candidate, environment.secretKey) || await secureTokenMatch(candidate, legacyServiceRole)) {
      return { adminId: "scheduled-service", isService: true };
    }
  }
  return authenticateAdmin(environment, authorization);
}

export async function readJsonBody(req: Request, maxBytes = 12_288): Promise<JsonRecord> {
  const length = Number(req.headers.get("content-length") || 0);
  if (length > maxBytes) throw new Error("REQUEST_TOO_LARGE");
  const text = await req.text();
  if (text.length > maxBytes) throw new Error("REQUEST_TOO_LARGE");
  const parsed = text ? JSON.parse(text) : {};
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("INVALID_REQUEST");
  return parsed as JsonRecord;
}

export async function fetchProviderJson(provider: keyof typeof API_HOST_ALLOWLIST, urlInput: string | URL, init: RequestInit = {}, options: { timeoutMs?: number; maxBytes?: number; retries?: number } = {}) {
  const url = urlInput instanceof URL ? urlInput : new URL(urlInput);
  if (url.protocol !== "https:" || !API_HOST_ALLOWLIST[provider]?.includes(url.hostname.toLowerCase())) throw new Error("PROVIDER_HOST_NOT_ALLOWED");
  const timeoutMs = Math.min(Math.max(options.timeoutMs ?? 12000, 1000), 35000);
  const maxBytes = Math.min(Math.max(options.maxBytes ?? 2_000_000, 1000), 3_000_000);
  const retries = Math.min(Math.max(options.retries ?? 1, 0), 1);
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { ...init, redirect: "error", signal: controller.signal });
      const rate = {
        limit: response.headers.get("ratelimit-limit"),
        remaining: response.headers.get("ratelimit-remaining"),
        reset: response.headers.get("ratelimit-reset"),
      };
      if (!response.ok) {
        if ((response.status === 429 || response.status >= 500) && attempt < retries) {
          await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)));
          continue;
        }
        throw new Error(response.status === 429 ? "PROVIDER_RATE_LIMITED" : response.status === 401 ? "PROVIDER_UNAUTHORIZED" : `PROVIDER_HTTP_${response.status}`);
      }
      const text = await response.text();
      if (text.length > maxBytes) throw new Error("PROVIDER_RESPONSE_TOO_LARGE");
      let data: unknown;
      try { data = JSON.parse(text); } catch { throw new Error("PROVIDER_INVALID_RESPONSE"); }
      return { data, rate, etag: response.headers.get("etag") };
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") throw new Error("PROVIDER_TIMEOUT");
      if (attempt >= retries) throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
  throw new Error("PROVIDER_UNAVAILABLE");
}

export function handleEdgeError(error: unknown, fallbackMessage: string): Response {
  const code = publicErrorCode(error);
  const status = code === "REQUEST_TOO_LARGE" || code === "INVALID_REQUEST" ? 400 : code.includes("AUTH") ? 401 : 503;
  return jsonResponse({ error: code, message: fallbackMessage }, status);
}
