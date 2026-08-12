const ORAKLO_REDACTED_VALUE = "[dato oculto]";
const ORAKLO_MONITORING_MAX_DEPTH = 5;

function stripMonitoringQueryStrings(value) {
  return String(value || "").replace(/\bhttps?:\/\/[^\s"'<>]+/gi, (rawUrl) => {
    try {
      const url = new URL(rawUrl);
      return `${url.origin}${url.pathname}`;
    } catch {
      return rawUrl.split(/[?#]/, 1)[0];
    }
  });
}

function redactMonitoringString(value) {
  return stripMonitoringQueryStrings(value)
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[correo oculto]")
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[token oculto]")
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi, "[id oculto]")
    .replace(
      /\b(access_token|refresh_token|authorization|password|passwd|email|session|apikey|api_key|token|prompt|input|output|response|provider_error|budget)\b(\s*[:=]\s*)([^\s&,;]+)/gi,
      `$1$2${ORAKLO_REDACTED_VALUE}`
    );
}

function isSensitiveMonitoringKey(key) {
  return /^(access_?token|refresh_?token|authorization|budget|cookie|dsn|email|input|output|password|passwd|prompt|provider(?:_error|_response)?|request|response|secret|session|token|username)$/i.test(
    String(key || "")
  );
}

function scrubMonitoringValue(value, depth = 0, seen = new WeakSet()) {
  if (typeof value === "string") return redactMonitoringString(value);
  if (value == null || typeof value !== "object") return value;
  if (depth >= ORAKLO_MONITORING_MAX_DEPTH) return "[contenido omitido]";
  if (seen.has(value)) return "[referencia circular]";

  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => scrubMonitoringValue(item, depth + 1, seen));
  }

  return Object.entries(value).reduce((result, [key, item]) => {
    result[key] = isSensitiveMonitoringKey(key)
      ? ORAKLO_REDACTED_VALUE
      : scrubMonitoringValue(item, depth + 1, seen);
    return result;
  }, {});
}

function stripMonitoringUrl(rawUrl) {
  try {
    const url = new URL(String(rawUrl || ""), "https://oraklo.invalid");
    if (url.origin === "https://oraklo.invalid") return url.pathname;
    return `${url.origin}${url.pathname}`;
  } catch {
    return redactMonitoringString(rawUrl);
  }
}

function sanitizeSentryEvent(event) {
  const sanitized = scrubMonitoringValue(event || {});

  delete sanitized.user;
  delete sanitized.request;
  delete sanitized.breadcrumbs;
  delete sanitized.extra;

  if (sanitized.contexts?.trace) {
    delete sanitized.contexts.trace;
  }

  if (sanitized.transaction) {
    sanitized.transaction = stripMonitoringUrl(sanitized.transaction);
  }

  return sanitized;
}

function isValidSentryDsn(value) {
  return /^https:\/\/[^@/\s]+@[^/\s]+\/\d+$/.test(String(value || "").trim());
}

function isValidSentryIntegrity(value) {
  return /^sha384-[A-Za-z0-9+/]{64}$/.test(String(value || "").trim());
}

function isAllowedMonitoringHost(hostname, allowedHosts) {
  return Array.isArray(allowedHosts) && allowedHosts.includes(String(hostname || ""));
}

function createSentryOptions(config) {
  return {
    dsn: config.sentryDsn,
    environment: config.environment || "production",
    release: config.release || "oraklo@unknown",
    sendDefaultPii: false,
    sampleRate: 1,
    tracesSampleRate: 0,
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,
    maxBreadcrumbs: 0,
    attachStacktrace: true,
    allowUrls: [
      /https:\/\/marcilladiazyolanda-dotcom\.github\.io\/Atinara\//
    ],
    denyUrls: [
      /^chrome-extension:\/\//i,
      /^moz-extension:\/\//i,
      /^safari-extension:\/\//i
    ],
    beforeBreadcrumb() {
      return null;
    },
    beforeSend(event) {
      return sanitizeSentryEvent(event);
    }
  };
}

function initializeOrakloSentry(globalObject = globalThis) {
  const config = globalObject.ORAKLO_OBSERVABILITY_CONFIG || {};
  const hostname = globalObject.location?.hostname || "";
  const sentry = globalObject.Sentry;

  if (
    !sentry ||
    typeof sentry.init !== "function" ||
    !isValidSentryDsn(config.sentryDsn) ||
    !isAllowedMonitoringHost(hostname, config.allowedHosts)
  ) {
    return false;
  }

  sentry.init(createSentryOptions(config));
  return true;
}

function loadOrakloSentry(globalObject = globalThis, documentObject = globalObject.document) {
  const config = globalObject.ORAKLO_OBSERVABILITY_CONFIG || {};
  const hostname = globalObject.location?.hostname || "";

  if (
    !documentObject?.head ||
    !isValidSentryDsn(config.sentryDsn) ||
    !isValidSentryIntegrity(config.sentrySdkIntegrity) ||
    !isAllowedMonitoringHost(hostname, config.allowedHosts)
  ) {
    return false;
  }

  if (globalObject.Sentry) return initializeOrakloSentry(globalObject);
  if (documentObject.querySelector("script[data-oraklo-sentry-sdk]")) return true;

  const script = documentObject.createElement("script");
  script.src = config.sentrySdkUrl;
  script.integrity = config.sentrySdkIntegrity;
  script.crossOrigin = "anonymous";
  script.referrerPolicy = "no-referrer";
  script.dataset.orakloSentrySdk = "true";
  script.onload = () => initializeOrakloSentry(globalObject);
  script.onerror = () => script.remove();
  documentObject.head.appendChild(script);
  return true;
}

const orakloMonitoringApi = {
  createSentryOptions,
  initializeOrakloSentry,
  isAllowedMonitoringHost,
  isValidSentryDsn,
  isValidSentryIntegrity,
  loadOrakloSentry,
  redactMonitoringString,
  sanitizeSentryEvent,
  scrubMonitoringValue,
  stripMonitoringQueryStrings,
  stripMonitoringUrl
};

if (typeof window !== "undefined") {
  window.orakloMonitoring = orakloMonitoringApi;
  loadOrakloSentry(window, document);
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = orakloMonitoringApi;
}
