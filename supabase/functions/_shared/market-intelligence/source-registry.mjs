export const API_HOST_ALLOWLIST = Object.freeze({
  igdb: ["api.igdb.com"],
  twitch: ["api.twitch.tv", "id.twitch.tv"],
  youtube: ["www.googleapis.com"],
  tavily: ["api.tavily.com"],
});

export function assertProviderUrl(value, provider) {
  const url = value instanceof URL ? value : new URL(value);
  if (url.protocol !== "https:" || !API_HOST_ALLOWLIST[provider]?.includes(url.hostname.toLowerCase())) throw new Error("PROVIDER_HOST_NOT_ALLOWED");
  return url;
}
