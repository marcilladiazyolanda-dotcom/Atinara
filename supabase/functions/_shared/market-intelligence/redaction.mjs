const SENSITIVE_KEYS = /(?:authorization|token|secret|api[_-]?key|jwt|email|service[_-]?role|password|karma|prestigio|username)/i;

export function redactValue(value, depth = 0) {
  if (depth > 6) return "[REDACTED_DEPTH]";
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => redactValue(item, depth + 1));
  if (!value || typeof value !== "object") return typeof value === "string" ? value.slice(0, 4000) : value;
  return Object.fromEntries(Object.entries(value).flatMap(([key, entry]) => (
    SENSITIVE_KEYS.test(key) ? [] : [[key, redactValue(entry, depth + 1)]]
  )));
}

export function publicErrorCode(error, fallback = "SERVICE_UNAVAILABLE") {
  const message = error instanceof Error ? error.message : String(error || "");
  const match = message.match(/^[A-Z][A-Z0-9_]{2,80}$/);
  return match ? match[0] : fallback;
}

export function safeToolSummary(tools = []) {
  return (Array.isArray(tools) ? tools : []).slice(0, 12).map((tool) => ({
    tool: String(tool?.tool || "unknown").slice(0, 80),
    status: String(tool?.status || "unknown").slice(0, 40),
    count: Number.isFinite(Number(tool?.count)) ? Number(tool.count) : null,
  }));
}
