(function initMarketAdminValidation(globalScope) {
  "use strict";

  const STATUS_LABELS = {
    draft_incomplete: "Borrador incompleto",
    draft_ready: "Pendiente de revisión",
    review_pending: "Revisión pendiente",
    review_in_progress: "Revisión en curso",
    review_rejected: "Rechazado",
    review_inconclusive: "Análisis no concluyente",
    review_unavailable: "Servicio no disponible",
    review_approved: "Validado · pendiente de confirmación",
    human_confirmed: "Confirmación humana completada",
    scheduled: "Programado",
    published: "Publicado",
    early_closed: "Cerrado anticipadamente",
    cancelled: "Cancelado",
    pending_resolution: "Pendiente de resolución",
    resolved: "Resuelto",
    annulled: "Anulado"
  };

  const FRIENDLY_ERRORS = [
    ["DRAFT_VERSION_MOVED", "El borrador cambió en otra sesión. Recárgalo antes de continuar."],
    ["REVIEW_VERSION_MOVED", "La revisión ya no corresponde a la versión actual."],
    ["CURRENT_APPROVAL_REQUIRED", "La versión actual necesita una nueva revisión aprobada."],
    ["CURRENT_APPROVAL_AND_CONFIRMATION_REQUIRED", "Faltan una revisión vigente y la confirmación humana."],
    ["PUBLISHED_MARKET_FIELDS_LOCKED", "Los campos esenciales están bloqueados porque el mercado ya fue publicado."],
    ["ADMIN_REQUIRED", "Tu cuenta no tiene permiso de administración."],
    ["AUTH_REQUIRED", "La sesión ha caducado. Inicia sesión de nuevo."],
    ["MARKET_PERIOD_ALREADY_ENDED", "El periodo del mercado ya ha terminado."],
    ["SCHEDULE_AFTER_MARKET_CLOSE", "La publicación debe programarse antes del final del periodo."],
    ["INVALID_DRAFT_DATE", "Revisa las fechas, horas y zona horaria."],
    ["INVALID_MARKET_SLUG", "El identificador debe usar letras minúsculas, números y guiones."],
    ["EARLY_CLOSE_REASON_REQUIRED", "Explica por qué el resultado ya es público antes de cerrar participaciones."],
    ["CANCELLATION_REASON_REQUIRED", "Explica por qué el mercado debe anularse."]
  ];

  function getStatusLabel(value) {
    return STATUS_LABELS[String(value || "").trim()] || String(value || "Estado desconocido");
  }

  function getFriendlyError(error, fallback = "No se pudo completar la operación.") {
    const source = [error?.code, error?.message, error?.details, error?.hint]
      .filter(Boolean).join(" ");
    const match = FRIENDLY_ERRORS.find(([code]) => source.includes(code));
    return match ? match[1] : fallback;
  }

  function normalizeUrl(value) {
    const raw = String(value || "").trim();
    if (!raw || !URL.canParse(raw)) return "";
    const url = new URL(raw);
    return url.protocol === "https:" ? url.href : "";
  }

  function toIsoOrEmpty(value, timeZone = "Europe/Madrid") {
    const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(String(value || ""));
    if (!match) return "";
    const requestedUtc = Date.UTC(
      Number(match[1]), Number(match[2]) - 1, Number(match[3]),
      Number(match[4]), Number(match[5]), 0
    );
    try {
      const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23"
      }).formatToParts(new Date(requestedUtc));
      const get = (type) => Number(parts.find((part) => part.type === type)?.value);
      const representedUtc = Date.UTC(
        get("year"), get("month") - 1, get("day"),
        get("hour"), get("minute"), get("second")
      );
      const result = new Date(requestedUtc - (representedUtc - requestedUtc));
      return Number.isFinite(result.getTime()) ? result.toISOString() : "";
    } catch (error) {
      const errorName = error instanceof Error ? error.name : "UnknownError";
      console.warn(`[Atinara] Zona horaria no válida: ${errorName}`);
      return "";
    }
  }

  function collectDraftPayload(form) {
    const read = (name) => String(form.elements.namedItem(name)?.value || "").trim();
    const timezone = read("timezone");
    const primaryUrl = normalizeUrl(read("primary_source_url"));
    const alternativeUrls = read("alternative_sources")
      .split(/\r?\n/)
      .map(normalizeUrl)
      .filter(Boolean)
      .map((url) => ({ url }));

    return {
      market_slug: read("market_slug").toLowerCase(),
      question: read("question"),
      subject: read("subject"),
      category: read("category"),
      yes_option: "Sí",
      no_option: "No",
      evaluation_period_label: read("evaluation_period_label"),
      evaluation_ends_at: toIsoOrEmpty(read("evaluation_ends_at"), timezone),
      timezone,
      resolution_deadline: toIsoOrEmpty(read("resolution_deadline"), timezone),
      yes_criteria: read("yes_criteria"),
      no_criteria: read("no_criteria"),
      edge_cases: read("edge_cases"),
      primary_source: primaryUrl ? { url: primaryUrl } : {},
      alternative_sources: alternativeUrls,
      delay_treatment: read("delay_treatment"),
      cancellation_treatment: read("cancellation_treatment"),
      leak_treatment: read("leak_treatment"),
      rename_treatment: read("rename_treatment"),
      assumptions: read("assumptions"),
      public_criteria: read("public_criteria"),
      description: read("description")
    };
  }

  function validateDraftLocally(payload) {
    const issues = [];
    const add = (code, field, message) => issues.push({ code, field, message });
    if (!/^[a-z0-9][a-z0-9-]{2,119}$/.test(payload.market_slug)) {
      add("INVALID_MARKET_SLUG", "market_slug", "Usa letras minúsculas, números y guiones.");
    }
    if (payload.question && payload.question.length < 20) {
      add("QUESTION_TOO_SHORT", "question", "La pregunta necesita al menos 20 caracteres.");
    }
    if (payload.evaluation_ends_at && payload.resolution_deadline &&
        Date.parse(payload.resolution_deadline) < Date.parse(payload.evaluation_ends_at)) {
      add("TEMPORAL_CONTRADICTION", "resolution_deadline", "La resolución no puede vencer antes del periodo evaluado.");
    }
    if (payload.primary_source?.url === undefined && payload.primary_source && Object.keys(payload.primary_source).length) {
      add("PRIMARY_SOURCE_INVALID", "primary_source_url", "La fuente debe utilizar HTTPS.");
    }
    return issues;
  }

  const api = {
    STATUS_LABELS,
    getStatusLabel,
    getFriendlyError,
    normalizeUrl,
    toIsoOrEmpty,
    collectDraftPayload,
    validateDraftLocally
  };

  globalScope.atinaraMarketAdmin = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
