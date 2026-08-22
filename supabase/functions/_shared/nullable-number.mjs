export function nullableFiniteNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (!/^[+-]?(?:\d+(?:[.,]\d+)?|[.,]\d+)(?:[eE][+-]?\d+)?$/.test(normalized)) {
    return null;
  }
  const parsed = Number(normalized.replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}
