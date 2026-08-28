import {
  candidateResolutionSubject,
  cleanText,
  deriveMarketFamily,
  normalizeComparableText,
  providerResolutionSourceUrls,
  safePublicUrl,
} from "./market-radar.mjs";

function officialIdentityRouteKeys(candidate) {
  const tokens = normalizeComparableText(candidateResolutionSubject(candidate))
    .split(" ")
    .filter((token) => /^[a-z0-9]{1,40}$/.test(token));
  if (!tokens.length) return [];
  const last = tokens.at(-1) ?? "";
  const distinctiveSuffix = tokens.length > 1
    && /^(?:[0-9]{1,4}|[ivxlcdm]{1,8})$/.test(last) ? last : "";
  const acronymPrefix = tokens.slice(0, distinctiveSuffix ? -1 : tokens.length)
    .filter((token) => token.length >= 2)
    .map((token) => token[0])
    .join("");
  const acronym = `${acronymPrefix}${distinctiveSuffix}`;
  return [...new Set([
    distinctiveSuffix,
    acronym.length >= 3 ? acronym : "",
    tokens.join("-"),
    tokens.join(""),
  ].filter((value) => value.length >= 1 && value.length <= 120))];
}

/**
 * Descubre solo rutas same-origin derivadas de la identidad cuando el proveedor
 * declaró una portada oficial demasiado genérica. Estas URLs no son evidencia:
 * todavía deben responder, pertenecer al registro oficial y superar la
 * coincidencia contractual exacta antes de poder habilitar una candidata.
 *
 * @param {Record<string, unknown>} candidate
 * @param {unknown} contractUrlValue
 * @param {ReadonlySet<string>|Set<string>|string[]} authoritativeDomains
 */
export function providerResolutionIdentityProbeUrls(
  candidate,
  contractUrlValue,
  authoritativeDomains = new Set(),
) {
  const contractUrl = safePublicUrl(contractUrlValue);
  if (!contractUrl
      || !providerResolutionSourceUrls(candidate, authoritativeDomains).includes(contractUrl)) return [];
  const contract = new URL(contractUrl);
  const routeKeys = officialIdentityRouteKeys(candidate);
  if (!routeKeys.length) return [];
  const contentKind = cleanText(
    deriveMarketFamily(candidate)?.family_semantics?.content_kind,
    40,
  );
  const mediaSuffixes = ["trailer", "teaser", "clip"].includes(contentKind)
    ? ["media/videos", "videos", "media"] : [];
  const routeCandidates = [];
  for (const routeKey of routeKeys) {
    for (const suffix of mediaSuffixes) routeCandidates.push(`/${routeKey}/${suffix}`);
    routeCandidates.push(`/${routeKey}`, `/games/${routeKey}`, `/game/${routeKey}`);
  }
  const urls = [];
  for (const pathname of routeCandidates) {
    const candidateUrl = safePublicUrl(new URL(pathname, contract.origin).toString());
    if (!candidateUrl || candidateUrl === contractUrl) continue;
    const parsed = new URL(candidateUrl);
    if (parsed.origin !== contract.origin || urls.includes(candidateUrl)) continue;
    urls.push(candidateUrl);
    if (urls.length >= 12) break;
  }
  return urls;
}
