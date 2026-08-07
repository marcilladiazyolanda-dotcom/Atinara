import { CONTEXT_PROVIDER_ADAPTER_VERSION } from "./constitution.mjs";

export const AUTHORIZED_CONTEXT_PROVIDERS = Object.freeze(["igdb", "twitch", "youtube", "tavily"]);

export function assertContextProviderAdapter(adapter) {
  if (!adapter || !AUTHORIZED_CONTEXT_PROVIDERS.includes(adapter.provider_id)) throw new Error("CONTEXT_PROVIDER_NOT_ALLOWED");
  const functions = ["search_recent", "normalize_context_item", "resolve_canonical_source", "get_rate_limit_state", "redact_for_storage"];
  if (functions.some((name) => typeof adapter[name] !== "function")) throw new Error("INVALID_CONTEXT_PROVIDER_ADAPTER");
  return { ...adapter, contract_version: CONTEXT_PROVIDER_ADAPTER_VERSION };
}

export function normalizeContextItem(input, provider) {
  return {
    provider,
    source_url: String(input?.source_url || "").slice(0, 2048),
    source_role: String(input?.source_role || "CONTEXT_SOURCE"),
    source_type: String(input?.source_type || "public_page"),
    official_status: String(input?.official_status || "unverified"),
    title: String(input?.title || "").slice(0, 300),
    excerpt: String(input?.excerpt || "").slice(0, 1200),
    published_at: input?.published_at || null,
    observed_at: input?.observed_at || new Date().toISOString(),
    policy_flags: Array.isArray(input?.policy_flags) ? input.policy_flags.slice(0, 20) : [],
  };
}
