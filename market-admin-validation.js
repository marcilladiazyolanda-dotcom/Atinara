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
    ["SOURCE_BINDING_PROVENANCE_REQUIRED", "El Plan de Resolución no tiene una procedencia verificable. Vuelve a corregir o revisar el borrador antes de confirmarlo."],
    ["MARKET_EXPERT_ANALYSIS_REQUIRED", "Este Plan de Resolución exige un análisis del Agente Editor completado antes de la confirmación humana."],
    ["SOURCE_BINDING_VALIDATION_REQUIRED", "El Plan de Resolución debe validarse de nuevo antes de confirmar."],
    ["SOURCE_BINDING_CONTRACT_CHANGED", "El Plan de Resolución cambió después de bloquearse. Vuelve a generar y revisar el borrador."],
    ["CURRENT_BINDING_COMPATIBILITY_REQUIRED", "El Plan de Resolución ya no coincide con la versión actual del borrador."],
    ["RESOLUTION_PLAN_NOT_LOCKED", "El Plan de Resolución aún no está validado y bloqueado."],
    ["SOURCE_CONTRACT_NOT_LOCKED", "El contrato de fuentes debe validarse de nuevo."],
    ["SOURCE_MONITOR_NOT_ARMED", "El monitor de fuentes obligatorio todavía no está preparado."],
    ["SOURCE_SCHEDULER_NOT_ENABLED", "La programación del monitor de fuentes obligatorio no está activa."],
    ["CONFIRMATION_NOT_PERSISTED", "Supabase no confirmó que la validación humana quedara guardada. El mercado continúa privado."],
    ["PUBLICATION_NOT_PERSISTED", "Supabase no confirmó un estado final de publicación. El mercado continúa privado."],
    ["EARLY_CLOSE_REASON_REQUIRED", "Explica por qué el resultado ya es público antes de cerrar participaciones."],
    ["CANCELLATION_REASON_REQUIRED", "Explica por qué el mercado debe anularse."]
  ];

  function getStatusLabel(value) {
    const normalized = formatStructuredText(value, "Estado desconocido");
    return STATUS_LABELS[normalized] || normalized;
  }

  function formatStructuredText(value, fallback = "") {
    const visited = new Set();
    const preferredKeys = [
      "message", "text", "description", "detail", "reason", "label", "title",
      "code", "field", "error", "hint"
    ];

    function visit(input, depth = 0) {
      if (input === null || input === undefined) return "";
      if (typeof input === "string") return input.trim();
      if (["number", "boolean", "bigint"].includes(typeof input)) return String(input);
      if (typeof input !== "object" || depth > 5 || visited.has(input)) return "";
      visited.add(input);
      const values = Array.isArray(input)
        ? input
        : [
            ...preferredKeys.filter((key) => Object.hasOwn(input, key)).map((key) => input[key]),
            ...Object.keys(input).filter((key) => !preferredKeys.includes(key)).sort().map((key) => input[key])
          ];
      const parts = values.map((item) => visit(item, depth + 1)).filter(Boolean);
      return [...new Set(parts)].join(" · ");
    }

    return visit(value) || visit(fallback);
  }

  function getFriendlyError(error, fallback = "No se pudo completar la operación.") {
    const source = [error?.code, error?.message, error?.details, error?.hint]
      .map((value) => formatStructuredText(value))
      .filter(Boolean).join(" ");
    const match = FRIENDLY_ERRORS.find(([code]) => source.includes(code));
    return match ? match[1] : formatStructuredText(fallback, "No se pudo completar la operación.");
  }

  function normalizeUrl(value) {
    const raw = String(value || "").trim();
    if (!raw || !URL.canParse(raw)) return "";
    const url = new URL(raw);
    return url.protocol === "https:" ? url.href : "";
  }

  function toIsoOrEmpty(value, timeZone = "Europe/Madrid") {
    const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/.exec(String(value || ""));
    if (!match) return "";
    const milliseconds = Number(String(match[7] || "").padEnd(3, "0"));
    const requestedUtc = Date.UTC(
      Number(match[1]), Number(match[2]) - 1, Number(match[3]),
      Number(match[4]), Number(match[5]), Number(match[6] || 0), milliseconds
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
        get("hour"), get("minute"), get("second"), milliseconds
      );
      const result = new Date(requestedUtc - (representedUtc - requestedUtc));
      if (!Number.isFinite(result.getTime())) return "";
      return normalizeLocalDateTimeInput(localDateTime(result.toISOString(), timeZone))
        === normalizeLocalDateTimeInput(value)
        ? result.toISOString()
        : "";
    } catch (error) {
      const errorName = error instanceof Error ? error.name : "UnknownError";
      console.warn(`[Atinara] Zona horaria no válida: ${errorName}`);
      return "";
    }
  }

  function normalizeLocalDateTimeInput(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/.exec(String(value || ""));
    if (!match) return "";
    return `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6] || "00"}.${String(match[7] || "").padEnd(3, "0")}`;
  }

  function localDateTime(value, timeZone = "Europe/Madrid") {
    const date = value ? new Date(value) : null;
    if (!date || !Number.isFinite(date.getTime())) return "";
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
      }).formatToParts(date);
      const get = (type) => parts.find((part) => part.type === type)?.value || "";
      const milliseconds = String(date.getUTCMilliseconds()).padStart(3, "0");
      return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}:${get("second")}.${milliseconds}`;
    } catch {
      return "";
    }
  }

  function timestampFromForm(value, timeZone, originalValue, originalTimeZone) {
    const normalizedInput = normalizeLocalDateTimeInput(value);
    const normalizedOriginal = normalizeLocalDateTimeInput(localDateTime(originalValue, originalTimeZone));
    if (normalizedInput && originalValue && timeZone === originalTimeZone
        && normalizedInput === normalizedOriginal) {
      return canonicalTimestamp(originalValue) || "";
    }
    return toIsoOrEmpty(value, timeZone);
  }

  function normalizeComparableText(value) {
    const normalized = String(value ?? "")
      .replace(/\r\n?/g, "\n")
      .trim()
      .replace(/\s+/g, " ");
    return normalized || null;
  }

  function canonicalJson(value) {
    if (Array.isArray(value)) return value.map(canonicalJson);
    if (value && typeof value === "object") {
      return Object.keys(value).sort().reduce((result, key) => {
        result[key] = canonicalJson(value[key]);
        return result;
      }, {});
    }
    return typeof value === "string" ? normalizeComparableText(value) : value;
  }

  function canonicalTimestamp(value) {
    const date = value ? new Date(value) : null;
    return date && Number.isFinite(date.getTime()) ? date.toISOString() : null;
  }

  function canonicalAlternativeSources(value) {
    const unique = new Map();
    (Array.isArray(value) ? value : []).forEach((source) => {
      if (!source || typeof source !== "object") return;
      const item = canonicalJson(source);
      const serialized = JSON.stringify(item);
      const sourceKey = normalizeComparableText(item?.url) || serialized;
      const current = unique.get(sourceKey);
      if (!current || serialized < current.serialized) unique.set(sourceKey, { item, serialized, sourceKey });
    });
    return [...unique.values()]
      .sort((left, right) => left.sourceKey < right.sourceKey ? -1
        : left.sourceKey > right.sourceKey ? 1
        : left.serialized < right.serialized ? -1 : left.serialized > right.serialized ? 1 : 0)
      .map((entry) => entry.item);
  }

  function canonicalizeDraftPayload(payload = {}) {
    const textFields = [
      "question", "subject", "category", "yes_option", "no_option",
      "evaluation_period_label", "timezone", "yes_criteria", "no_criteria",
      "edge_cases", "delay_treatment", "cancellation_treatment",
      "leak_treatment", "rename_treatment", "assumptions", "public_criteria",
      "description"
    ];
    const canonical = {
      market_slug: String(payload.market_slug || "").trim().toLowerCase()
    };
    textFields.forEach((field) => { canonical[field] = normalizeComparableText(payload[field]); });
    canonical.evaluation_ends_at = canonicalTimestamp(payload.evaluation_ends_at);
    canonical.closes_at = canonicalTimestamp(payload.closes_at || payload.evaluation_ends_at);
    canonical.resolution_deadline = canonicalTimestamp(payload.resolution_deadline);
    canonical.primary_source = canonicalJson(
      payload.primary_source && typeof payload.primary_source === "object"
        ? payload.primary_source : {}
    );
    canonical.alternative_sources = canonicalAlternativeSources(payload.alternative_sources);
    return canonical;
  }

  function draftPayloadsEqual(left, right) {
    return JSON.stringify(canonicalizeDraftPayload(left)) === JSON.stringify(canonicalizeDraftPayload(right));
  }

  function collectDraftPayload(form, baseDraft = {}) {
    const read = (name) => String(form.elements.namedItem(name)?.value || "").trim();
    const timezone = read("timezone");
    const primaryUrl = normalizeUrl(read("primary_source_url"));
    const basePrimary = baseDraft?.primary_source && typeof baseDraft.primary_source === "object"
      ? baseDraft.primary_source : {};
    const baseAlternatives = new Map(
      (Array.isArray(baseDraft?.alternative_sources) ? baseDraft.alternative_sources : [])
        .filter((item) => item && typeof item === "object")
        .map((item) => [normalizeUrl(item.url), item])
        .filter(([url]) => url)
    );
    const alternativeUrls = [...new Set(read("alternative_sources")
      .split(/\r?\n/)
      .map(normalizeUrl)
      .filter(Boolean))]
      .sort()
      .map((url) => ({ ...(baseAlternatives.get(url) || {}), url }));

    const evaluationInput = read("evaluation_ends_at");
    const deadlineInput = read("resolution_deadline");
    return {
      _timestamp_precision: "milliseconds-v1",
      market_slug: read("market_slug").toLowerCase(),
      question: read("question"),
      subject: read("subject"),
      category: read("category"),
      yes_option: "Sí",
      no_option: "No",
      evaluation_period_label: read("evaluation_period_label"),
      evaluation_ends_at: timestampFromForm(
        evaluationInput, timezone, baseDraft.evaluation_ends_at, baseDraft.timezone
      ),
      timezone,
      resolution_deadline: timestampFromForm(
        deadlineInput, timezone, baseDraft.resolution_deadline, baseDraft.timezone
      ),
      yes_criteria: read("yes_criteria"),
      no_criteria: read("no_criteria"),
      edge_cases: read("edge_cases"),
      primary_source: primaryUrl
        ? { ...(normalizeUrl(basePrimary.url) === primaryUrl ? basePrimary : {}), url: primaryUrl }
        : {},
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
    formatStructuredText,
    normalizeUrl,
    toIsoOrEmpty,
    localDateTime,
    timestampFromForm,
    normalizeComparableText,
    canonicalizeDraftPayload,
    draftPayloadsEqual,
    collectDraftPayload,
    validateDraftLocally
  };

  globalScope.atinaraMarketAdmin = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
