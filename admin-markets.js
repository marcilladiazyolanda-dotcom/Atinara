(function initAdminMarkets() {
  "use strict";

  const root = document.querySelector("#admin-markets-root");
  const newDraftButton = document.querySelector("#admin-new-draft");
  const actionDialog = document.querySelector("#admin-market-action-dialog");
  const actionForm = document.querySelector("#admin-market-action-form");
  const client = window.orakloSupabase;
  const helpers = window.atinaraMarketAdmin;
  if (!root || !helpers) return;
  const officialRequestCoordinator = window.atinaraOfficialOpportunityRequests?.createCoordinator?.() || null;
  const radarRequestCoordinator = window.atinaraRadarRefreshRequests?.createCoordinator?.() || null;
  const publicationAttemptIds = new Map();
  const PUBLICATION_ATTEMPT_KEY_PREFIX = "atinara:market-publication-attempt:v1";
  const eligibilityRecoveryOperationIds = new Map();
  const ELIGIBILITY_RECOVERY_KEY_PREFIX = "atinara:radar-eligibility-recovery:v1";
  const domainReviewOperationIds = new Map();
  const DOMAIN_REVIEW_KEY_PREFIX = "atinara:radar-domain-review:v1";

  const state = {
    auth: null,
    view: "drafts",
    drafts: [],
    catalog: [],
    audit: [],
    selected: null,
    query: "",
    status: "",
    busy: false,
    notice: "",
    noticeTone: "info",
    gateNotice: "",
    gateNoticeTone: "info",
    draftDirty: false,
    draftBaseline: "",
    pendingAction: null,
    actionTrigger: null,
    radar: {
      candidates: [],
      groups: [],
      rejected: { total: 0, counts: {}, items: [] },
      parentReconciliations: [],
      selectedReconciliation: null,
      providers: [],
      errors: [],
      candidateProviders: [],
      enrichmentCapabilities: [],
      providerIssues: [],
      enrichmentIssues: [],
      refreshInProgress: false,
      qualityNotices: [],
      selected: null,
      expandedGroups: new Set(),
      loaded: false,
      cached: false,
      cachedAuthoritative: false,
      requiresEligibilityRefresh: false,
      cooldownUntil: 0,
      provider: "all",
      category: "",
      query: "",
      horizon: "180d",
      quality: "review",
      order: "recommended",
      rejectionReason: "current",
      parentOffset: 0,
      parentOffsetHistory: [],
      reconciliationOffset: 0,
      reconciliationPage: { total: 0, offset: 0, limit: 20, previous_offset: null, next_offset: null, snapshot_available: false },
      page: { parent_count: 0, parent_offset: 0, parent_limit: 60, previous_parent_offset: null, next_parent_offset: null }
    },
    radarPrefill: null,
    radarLoading: false,
    radarCooldownTimer: null,
    observatory: {
      providers: [],
      dashboard: { entities: [], signals: [], context_items: [], story_arcs: [], hypotheses: [], bindings: [], provider_runs: [], schedulers: {} },
      searchProvider: "igdb",
      searchQuery: "",
      searchResults: [],
      selected: null,
      provider: "all",
      category: "",
      marketability: "",
      expertStatus: "",
      query: "",
      errors: [],
      officialDiscovery: {
        query: "",
        category: "Eventos",
        horizonDays: 180,
        timezone: "Europe/Madrid",
        inFlight: false,
        result: null
      }
    }
  };

  const RADAR_CATEGORIES = ["Lanzamientos", "Eventos", "Industria", "Streamers", "Reviews/Premios", "YouTubers"];
  const RADAR_PROVIDER_LABELS = { polymarket: "Polymarket", kalshi: "Kalshi", tavily: "Fuentes oficiales" };
  const RADAR_POLICY_VERSION = "atinara-prediction-policy-v5";
  const RADAR_NORMALIZER_VERSION = "atinara-radar-v3";
  const RADAR_FAMILY_VERSION = "atinara-market-family-v5";
  const RADAR_RECONCILIATION_VERSION = "atinara-radar-parent-reconciliation-v1";
  const RADAR_CHILD_PROJECTION_VERSION = "atinara-radar-child-projection-v1";
  const RADAR_REASON_LABELS = {
    EVENT_ALREADY_RESOLVED: "Evento ya resuelto",
    SOURCE_STALE: "Información desactualizada",
    EVENT_OUTSIDE_CONTRACT: "Contrato no compatible",
    SUBJECT_NOT_ANNOUNCED: "Requisito previo no cumplido",
    TEMPORAL_INCOHERENCE: "Fechas incompatibles",
    INVALID_OR_UNVERIFIED_SOURCE: "Fuente no verificable",
    DUPLICATE_MARKET: "Mercado duplicado",
    PROVIDER_NOT_OPEN: "Mercado de origen cerrado",
    PROVIDER_OPTION_INACTIVE: "Opción no disponible",
    PROVIDER_EVENT_NOT_FOUND: "Evento de origen no disponible",
    PROVIDER_CHILD_NOT_FOUND: "Opción de origen no disponible",
    PROVIDER_CHILD_IDENTITY_RESOLUTION_REQUIRED: "Identidad del proveedor pendiente",
    RADAR_PARENT_RECONCILIATION_INCOMPLETE: "Reconciliación del proveedor pendiente",
    PROVIDER_PARENT_COUNT_INCONSISTENT: "Recuento del proveedor incoherente",
    RESOLUTION_SOURCE_AUTHORITY_PENDING: "Fuente oficial pendiente",
    OFFICIAL_TERMINAL_SCAN_UNAVAILABLE: "Comprobación oficial temporalmente no disponible",
    OFFICIAL_SELECTION_RECHECK_REQUIRED: "Selección oficial en comprobación",
    VERIFICATION_REQUIRED: "Comprobación de elegibilidad pendiente",
    VERIFICATION_EXPIRED: "Comprobación de elegibilidad caducada",
    GAMING_DOMAIN_REVIEW_REQUIRED: "Relación gaming pendiente de revisión",
    OUTSIDE_GAMING_DOMAIN: "Fuera del dominio gaming",
    PROVIDER_PLACEHOLDER: "Opción provisional del proveedor"
  };
  const RADAR_REASON_DESCRIPTIONS = {
    EVENT_ALREADY_RESOLVED: "El resultado ya está publicado y ya no constituye una predicción futura.",
    SOURCE_STALE: "La información guardada ya no representa el estado actual del mercado.",
    EVENT_OUTSIDE_CONTRACT: "La opción no es binaria o no encaja en el periodo y las reglas de Atinara.",
    SUBJECT_NOT_ANNOUNCED: "La pregunta depende de un producto no anunciado para un resultado posterior, como un premio o una reseña.",
    TEMPORAL_INCOHERENCE: "El periodo o las fechas se contradicen de forma objetiva con el contrato.",
    INVALID_OR_UNVERIFIED_SOURCE: "No existe una fuente pública válida con la que resolver la pregunta.",
    DUPLICATE_MARKET: "Ya existe un mercado o borrador equivalente en Atinara.",
    PROVIDER_NOT_OPEN: "El mercado de origen ya está cerrado y no ofrece una opción futura abierta para importar.",
    PROVIDER_OPTION_INACTIVE: "Esta opción no está negociable; el evento padre conserva otras opciones abiertas.",
    PROVIDER_EVENT_NOT_FOUND: "El proveedor ya no ofrece el evento indicado.",
    PROVIDER_CHILD_NOT_FOUND: "La opción ya no pertenece al evento de origen.",
    PROVIDER_CHILD_IDENTITY_RESOLUTION_REQUIRED: "Radar conserva la hija y sus identificadores, pero el proveedor todavía no demuestra una identidad real utilizable.",
    RADAR_PARENT_RECONCILIATION_INCOMPLETE: "El evento padre no puede entrar al catálogo hasta contabilizar y reconciliar todas sus hijas.",
    PROVIDER_PARENT_COUNT_INCONSISTENT: "El número de hijas declarado no coincide con las observadas; no se proyecta el padre como completo.",
    RESOLUTION_SOURCE_AUTHORITY_PENDING: "Atinara volverá a buscar automáticamente una fuente resolutiva oficial y exacta para esta opción.",
    OFFICIAL_TERMINAL_SCAN_UNAVAILABLE: "La consulta de fuentes oficiales no terminó. Es un fallo técnico reintentable y no una prueba de que el evento esté resuelto.",
    OFFICIAL_SELECTION_RECHECK_REQUIRED: "Atinara ha localizado una selección oficial posiblemente ya publicada. Mantiene oculto el evento mientras completa la comprobación automática.",
    VERIFICATION_REQUIRED: "La comprobación de elegibilidad no ha terminado.",
    VERIFICATION_EXPIRED: "La elegibilidad ha caducado y debe repetirse antes de preparar el borrador.",
    GAMING_DOMAIN_REVIEW_REQUIRED: "La relación con videojuegos es ambigua. Puede revisarse sin tratarla como un rechazo definitivo.",
    OUTSIDE_GAMING_DOMAIN: "La evidencia disponible demuestra que la proposición no pertenece al catálogo gaming.",
    PROVIDER_PLACEHOLDER: "El proveedor todavía no identifica una opción concreta. Se conserva para revalidarla, sin enviarla al Editor."
  };
  const WORKFLOW_ISSUE_LABELS = {
    TEMPORAL_AUTHORITATIVE_DATE_REQUIRED: "Falta una fecha oficial demostrada",
    TEMPORAL_SOURCE_SEMANTICS_MISMATCH: "La fecha del proveedor necesita interpretación",
    ESSENTIAL_TEXT_NOT_SPANISH: "El contrato esencial debe quedar en español",
    GAMING_DOMAIN_REVIEW_REQUIRED: "La relación gaming necesita revisión",
    RADAR_ELIGIBILITY_REQUIRED: "La elegibilidad debe renovarse",
    RESOLUTION_PRIMARY_SOURCE_REQUIRED: "Falta una fuente primaria oficial",
    CHILD_IDENTITY_MISMATCH: "La identidad de la opción no coincide en todos los campos",
    PROVIDER_CHILD_CONTRACT_CHANGED: "El proveedor cambió reglas, fuente o fechas de esta opción",
  };
  const WORKFLOW_OWNER_LABELS = {
    radar: "Radar", editor: "Agente Editor", validator: "Validator",
    corrector: "Corrector", human_review: "Revisión humana",
    publication_gate: "Puerta de publicación", provider: "Proveedor",
    internal_platform: "Plataforma interna",
  };
  const WORKFLOW_ACTION_LABELS = {
    resolve_temporal_contract: "Investigar y normalizar la fecha",
    repair_temporal_or_source_contract: "Buscar evidencia y corregir el contrato",
    repair_draft_issues: "Abrir el Corrector",
    request_market_validation: "Solicitar una nueva validación",
    retry_market_validation: "Reintentar Validator",
    refresh_draft_eligibility: "Renovar la elegibilidad",
    retry_provider_refresh: "Actualizar de nuevo el proveedor",
    retry_source_enrichment: "Reintentar el enriquecimiento oficial",
    review_gaming_domain: "Revisar manualmente el ámbito",
    review_gaming_domain_manually: "Revisar manualmente el ámbito",
    revalidate_temporal_evidence: "Revalidar la evidencia temporal",
    edit_draft_manually: "Editar manualmente",
    confirm_market_draft: "Confirmar humanamente",
    revalidate_and_publish: "Revalidar y publicar",
    retry_human_confirmation: "Reintentar la confirmación humana",
    choose_valid_publication_time: "Elegir una fecha de publicación válida",
    archive_expired_draft: "Archivar el expediente terminal",
    reconcile_published_market: "Reconciliar el mercado ya publicado",
    resolve_market_identity_collision: "Resolver la identidad duplicada",
    edit_market_slug: "Cambiar el identificador y revalidar la nueva versión",
    reload_current_draft: "Recargar la versión vigente",
    review_source_scheduler_configuration: "Revisar la configuración del scheduler de fuentes",
    review_source_provider_configuration: "Revisar la configuración del proveedor de fuentes",
    review_source_monitor_configuration: "Revisar el monitor de fuentes",
    review_source_registry_configuration: "Revisar el registro autoritativo de fuentes",
    retain_terminal_dossier: "Conservar el expediente terminal archivado",
  };
  const EXPERT_DECISION_LABELS = {
    create: "Crear", create_with_edits: "Crear con ajustes", reject: "Rechazar",
    stale: "Obsoleta", merge_duplicate: "Duplicado", escalate: "Revisión humana",
  };
  const REVIEW_ATTEMPT_LABELS = {
    approved: "Aprobada", rejected: "Rechazada", provider_timeout: "Proveedor sin respuesta",
    provider_rate_limited: "Límite temporal", provider_unavailable: "Proveedor no disponible",
    invalid_response: "Respuesta no válida", internal_error: "Incidencia interna",
  };
  const CHANGE_ORIGIN_LABELS = {
    manual_save: "Edición manual", radar_expert_bridge_save: "Agente Editor",
    radar_expert_issue_draft_v1: "Propuesta con incidencias", version_restore: "Versión restaurada",
    autonomous_repair: "Corrector autorizado",
  };
  const RADAR_QUARANTINE_DESCRIPTIONS = {
    INVALID_RADAR_CANDIDATE: "La fila no cumple el contrato normalizado obligatorio del Radar.",
    INCOMPLETE_RADAR_VERIFICATION: "Faltan datos autoritativos para tratar la candidata como verificación abierta.",
    RADAR_BATCH_TOO_LARGE: "La fila excede el tamaño seguro admitido para persistencia.",
    INVALID_RADAR_ELIGIBILITY: "La decisión de elegibilidad no cumple el contrato autoritativo.",
    INVALID_RADAR_ELIGIBILITY_DATE: "La vigencia de la elegibilidad no es válida.",
    RADAR_CANDIDATE_DATA_INVALID: "Un campo de la fila no cumple el esquema autoritativo de persistencia."
  };
  const RADAR_SCORE_LABELS = {
    popularity: "Popularidad",
    relevance: "Relevancia gaming",
    clarity: "Claridad",
    recency: "Vigencia",
    uncertainty: "Incertidumbre útil",
    novelty: "Novedad",
    verification: "Confianza de verificación"
  };
  const RADAR_ORIGIN_LABELS = {
    source: "Importado de la fuente",
    adapted: "Adaptado automáticamente",
    review: "Requiere revisión",
    missing: "Sin información"
  };
  const OBSERVATORY_PROVIDER_LABELS = {
    igdb: "IGDB",
    twitch: "Twitch",
    youtube: "YouTube",
    "market-expert": "Agente Editor",
    "source-monitor": "Monitor de fuentes",
    "tavily-context": "Contexto oficial",
    official_web: "Web oficial registrada"
  };

  function escapeHtml(value) {
    const printable = value && typeof value === "object"
      ? helpers.formatStructuredText(value)
      : String(value ?? "");
    return printable
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function valueAttribute(value) {
    return escapeHtml(value || "");
  }

  function localDateTime(value, timeZone = "Europe/Madrid") {
    return helpers.localDateTime(value, timeZone);
  }

  function displayDate(value) {
    if (!value) return "Sin fecha";
    const date = new Date(value);
    return Number.isFinite(date.getTime())
      ? new Intl.DateTimeFormat("es-ES", { dateStyle: "medium", timeStyle: "medium" }).format(date)
      : "Fecha no válida";
  }

  function strictDisplayNumber(value) {
    if (typeof value === "number") return Number.isFinite(value) ? value : null;
    if (typeof value !== "string") return null;
    const normalized = value.trim().replace(",", ".");
    if (!/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:e[+-]?\d+)?$/i.test(normalized)) return null;
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function displayNumber(value) {
    const number = strictDisplayNumber(value);
    return number !== null
      ? new Intl.NumberFormat("es-ES", { notation: Math.abs(number) >= 1000000 ? "compact" : "standard", maximumFractionDigits: 1 }).format(number)
      : "No disponible";
  }

  function displayProbability(value) {
    const number = strictDisplayNumber(value);
    if (number === null) return "Sin precio disponible";
    const normalized = number > 1 && number <= 100 ? number / 100 : number;
    return Number.isFinite(normalized) && normalized >= 0 && normalized <= 1
      ? new Intl.NumberFormat("es-ES", { style: "percent", maximumFractionDigits: 1 }).format(normalized)
      : "Sin precio disponible";
  }

  function externalLink(url, label = "Abrir fuente", variant = "secondary") {
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== "https:") return "";
      const className = variant === "primary" ? "primary-button radar-link-button" : "secondary-button radar-link-button";
      return `<a class="${className}" href="${escapeHtml(parsed.toString())}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a>`;
    } catch {
      return "";
    }
  }

  function radarReasonLabel(code) {
    return RADAR_REASON_LABELS[code] || "No cumple los criterios";
  }

  function radarRejectionReasonCode(candidate) {
    return candidate?.display_reason_code || candidate?.verification_reason_code || "VERIFICATION_REQUIRED";
  }

  function radarCandidatePolicyCurrent(candidate) {
    return candidate?.eligibility_policy_version === RADAR_POLICY_VERSION
      && candidate?.normalizer_version === RADAR_NORMALIZER_VERSION
      && candidate?.family_version === RADAR_FAMILY_VERSION
      && candidate?.parent_reconciliation_version === RADAR_RECONCILIATION_VERSION
      && candidate?.canonical_projection_version === RADAR_CHILD_PROJECTION_VERSION;
  }

  function radarIntegerCount(value) {
    if (value === null || value === undefined || value === "" || (typeof value === "string" && !value.trim())) return null;
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
  }

  function radarParentComplete(candidate) {
    const declared = radarIntegerCount(candidate?.provider_declared_child_count);
    const discovered = radarIntegerCount(candidate?.provider_discovered_child_count);
    const accounted = radarIntegerCount(candidate?.provider_accounted_child_count);
    const unresolved = radarIntegerCount(candidate?.provider_unresolved_child_count);
    const conflicts = radarIntegerCount(candidate?.provider_conflict_child_count);
    return candidate?.parent_reconciliation_status === "complete"
      && candidate?.parent_reconciliation_version === RADAR_RECONCILIATION_VERSION
      && /^[a-f0-9]{64}$/.test(String(candidate?.parent_reconciliation_fingerprint || ""))
      && Boolean(String(candidate?.external_event_id || candidate?.provider_parent_id || "").trim())
      && candidate?.provider_pagination_exhausted === true
      && declared !== null && discovered === declared && accounted === declared
      && unresolved === 0 && conflicts === 0;
  }

  function radarCanonicalChildProjectionValid(candidate) {
    if (candidate?.canonical_projection_version !== RADAR_CHILD_PROJECTION_VERSION) return false;
    if (!["categorical_outcomes", "participant_options", "platform_variants"]
      .includes(candidate?.family_type)) return true;
    const familyKey = String(candidate?.family_child_key || "").trim();
    const canonicalKey = String(candidate?.canonical_child_key || "").trim();
    const familyLabel = String(candidate?.family_child_label || "").trim();
    const canonicalLabel = String(candidate?.canonical_child_label || "").trim();
    const invalidTemporalLabel = /(?:^\s*deadline:|\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,6})?)?(?:Z|[+-]\d{2}:?\d{2})|^\s*(?:lt|lte|gt|gte)\s+\d|^\s*(?:ET|year)\s*$|^\s*(?:before|after|by|on\s+or\s+before|on\s+or\s+after|during|in|antes\s+de|despu[eé]s\s+de|hasta|durante|en)\s+\d{4}(?:\s|$)|^\s*\d{4}(?:\s*\((?:ET|year)\))?\s*$)/i;
    return candidate?.identity_status === "resolved"
      && ["identified_real_option", "aggregate_other_option", "tie_option", "no_winner_option", "provider_closed_child"]
        .includes(candidate?.identity_classification)
      && /^option:[a-z0-9][a-z0-9-]{0,237}$/.test(canonicalKey)
      && familyKey === canonicalKey
      && Boolean(canonicalLabel)
      && familyLabel.localeCompare(canonicalLabel, undefined, { sensitivity: "base" }) === 0
      && !invalidTemporalLabel.test(canonicalLabel);
  }

  function radarReasonDescription(candidate) {
    if (!radarCandidatePolicyCurrent(candidate)) {
      return "Esta evaluación pertenece al criterio anterior y debe volver a comprobarse antes de tomarla como válida.";
    }
    const code = radarRejectionReasonCode(candidate);
    const reason = String(candidate?.display_reason || candidate?.verification_reason || "").trim();
    const isLegacyUnannouncedRule = code === "SUBJECT_NOT_ANNOUNCED"
      && /(?:premisa presupone|producto o evento que no ha sido anunciado|no ha sido anunciado oficialmente)/i.test(reason);
    const looksTechnicalOrEnglish = /^[A-Z0-9_]+$/.test(reason)
      || /\b(?:official confirmation|provider|market|source|found|release before|not open|will be)\b/i.test(reason);
    return reason && !looksTechnicalOrEnglish && !isLegacyUnannouncedRule
      ? reason
      : RADAR_REASON_DESCRIPTIONS[code] || "La candidata no cumple las condiciones para preparar un borrador.";
  }

  function radarEligibilityCurrent(candidate) {
    const checkedAt = Date.parse(candidate?.eligibility_checked_at || "");
    const expiresAt = Date.parse(candidate?.eligibility_expires_at || "");
    return candidate?.eligibility_status === "eligible"
      && candidate?.eligibility_policy_version === RADAR_POLICY_VERSION
      && Boolean(candidate?.current_eligibility_check_id)
      && Number.isFinite(checkedAt)
      && checkedAt <= Date.now() + 60_000
      && Number.isFinite(expiresAt)
      && expiresAt > Date.now();
  }

  function radarResolutionSourceProven(candidate) {
    let sourceUrl = "";
    try {
      const parsed = new URL(candidate?.atinara_resolution_source_url || candidate?.source_resolution_url || "");
      if (parsed.protocol !== "https:") return false;
      sourceUrl = parsed.toString();
    } catch {
      return false;
    }
    const evidence = [
      ...(Array.isArray(candidate?.resolution_source_evidence) ? candidate.resolution_source_evidence : []),
      ...(Array.isArray(candidate?.eligibility_evidence) ? candidate.eligibility_evidence : []),
      ...(Array.isArray(candidate?.verification_evidence) ? candidate.verification_evidence : [])
    ];
    return evidence.some((item) => {
      try {
        return new URL(item?.url || "").toString() === sourceUrl
          && item?.source_type === "official"
          && item?.retrieval_status === "verified_content"
          && item?.evidence_basis === "retrieved_content"
          && item?.claim_status === "direct"
          && item?.direct_claim === true;
      } catch {
        return false;
      }
    });
  }

  function radarVerificationLabel(candidate) {
    if (!radarCandidatePolicyCurrent(candidate)) return "Pendiente de reevaluación";
    if (!radarEligibilityCurrent(candidate)) return "Elegibilidad pendiente";
    if (!radarResolutionSourceProven(candidate)) return "Fuente oficial pendiente";
    if (candidate?.eligibility_state_preserved === true) return "Elegible · estado conservado";
    if (candidate?.verification_status === "verified_open") return "Elegible";
    if (candidate?.verification_status === "needs_review") return "Revisión necesaria";
    return radarReasonLabel(candidate?.verification_reason_code);
  }

  function providerStatusLabel(status) {
    const labels = {
      open: "Abierto",
      active: "Abierto",
      trading: "Abierto",
      initialized: "Abierto",
      closed: "Cerrado",
      determined: "Resultado determinado",
      finalized: "Resuelto",
      settled: "Resuelto",
      inactive: "Inactivo"
    };
    return labels[String(status || "").toLowerCase()] || "No disponible";
  }

  function providerResultLabel(result) {
    if (result === "yes") return "Sí";
    if (result === "no") return "No";
    if (result === "scalar") return "Resultado numérico";
    return "";
  }

  async function invokeRadar(action, payload = {}) {
    const { data, error } = await client.functions.invoke("market-radar", {
      body: { action, ...payload }
    });
    if (error) throw await edgeInvocationError(error, "No se pudo completar la operación del Radar.");
    return data || {};
  }

  async function invokeObservatory(action, payload = {}) {
    const { data, error } = await client.functions.invoke("data-observatory", {
      body: { action, ...payload }
    });
    if (error) throw await edgeInvocationError(error, "No se pudo completar la operación del Observatorio.");
    return data || {};
  }

  async function invokeMarketExpert(action, payload = {}) {
    const { data, error } = await client.functions.invoke("market-expert", {
      body: { action, ...payload }
    });
    if (error) throw await edgeInvocationError(error, "No se pudo completar el análisis del Agente Editor.");
    return data || {};
  }

  async function invokeSourceMonitor(action, payload = {}) {
    const { data, error } = await client.functions.invoke("market-source-monitor", {
      body: { action, ...payload }
    });
    if (error) throw await edgeInvocationError(error, "No se pudo completar la operación del monitor de fuentes.");
    return data || {};
  }

  async function edgeInvocationError(error, fallback) {
    let payload = null;
    try {
      if (error?.context && typeof error.context.clone === "function") {
        payload = await error.context.clone().json();
      }
    } catch {
      // El cuerpo puede no ser JSON; se conserva un error seguro y acotado.
    }
    const payloadError = payload?.error && typeof payload.error === "object" ? payload.error : null;
    const rawCode = payloadError?.code
      || (typeof payload?.error === "string" ? payload.error : "")
      || payload?.code
      || error?.code;
    const code = /^[A-Z][A-Z0-9_]{2,99}$/.test(String(rawCode || "").trim())
      ? String(rawCode).trim()
      : "EDGE_FUNCTION_ERROR";
    const wrapped = operationError(
      code,
      helpers.formatStructuredText(payloadError?.message || payload?.message || fallback, fallback),
      helpers.formatStructuredText(payload?.details || payloadError?.details || "", "")
    );
    wrapped.status = Number(error?.context?.status) || null;
    wrapped.retryable = payload?.retryable === true || wrapped.status === 429 || wrapped.status >= 500;
    wrapped.attemptId = /^[0-9a-f-]{8,64}$/i.test(String(payload?.attempt_id || "")) ? String(payload.attempt_id) : "";
    wrapped.phase = String(payload?.phase || "").slice(0, 80);
    wrapped.statePreserved = payload?.state_preserved === true || payload?.authoritative_pointer_unchanged === true;
    wrapped.authoritativeStateUpdated = payload?.authoritative_state_updated === true;
    wrapped.candidate = payload?.candidate && typeof payload.candidate === "object" && !Array.isArray(payload.candidate)
      ? payload.candidate
      : null;
    wrapped.gate = payload?.gate && typeof payload.gate === "object" ? payload.gate : null;
    return wrapped;
  }

  function setNotice(message, tone = "info") {
    state.notice = helpers.formatStructuredText(message);
    state.noticeTone = tone;
  }

  function setGateNotice(message, tone = "info") {
    state.gateNotice = helpers.formatStructuredText(message);
    state.gateNoticeTone = tone;
  }

  function clearGateNotice() {
    state.gateNotice = "";
    state.gateNoticeTone = "info";
  }

  function noticeMarkup() {
    return state.notice ? `<p class="admin-status-message admin-status-${escapeHtml(state.noticeTone)}" role="status">${escapeHtml(state.notice)}</p>` : "";
  }

  function gateNoticeMarkup() {
    if (!state.gateNotice) return "";
    const role = state.gateNoticeTone === "error" ? "alert" : "status";
    return `<p class="admin-status-message admin-gate-status admin-status-${escapeHtml(state.gateNoticeTone)}" role="${role}" tabindex="-1" data-review-action-status>${escapeHtml(state.gateNotice)}</p>`;
  }

  function focusActionStatus({ preferGate = true } = {}) {
    const status = preferGate
      ? document.querySelector("[data-review-action-status]") || root.querySelector(".admin-status-message")
      : root.querySelector(".admin-status-message") || document.querySelector("[data-review-action-status]");
    if (!status) return;
    status.scrollIntoView({ block: "nearest" });
    status.focus({ preventScroll: true });
  }

  function operationError(code, message, details = "") {
    const error = new Error(message);
    error.code = code;
    error.details = details;
    return error;
  }

  function expertRun(value) {
    const candidate = value?.run && typeof value.run === "object" ? value.run : value;
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return null;
    if (!String(candidate.id || "").trim() || candidate.status !== "completed") return null;
    return candidate;
  }

  function expertErrorMessage(error, fallback) {
    const base = helpers.getFriendlyError(error, "") || String(error?.message || "").trim() || fallback;
    const details = [];
    if (error?.phase === "eligibility_check") details.push("Fase: comprobación de elegibilidad.");
    if (error?.attemptId) details.push(`Intento: ${String(error.attemptId).slice(0, 36)}.`);
    if (error?.statePreserved === true) details.push("El último estado autoritativo se conserva.");
    if (error?.retryable === true) details.push("Puedes reintentarlo cuando finalice la degradación temporal.");
    return [base, ...details].filter(Boolean).join(" ");
  }

  function feedbackComparableDraft(fields = {}) {
    const alternativeSources = Array.isArray(fields.alternative_sources)
      ? fields.alternative_sources.map((item) => ({ url: String(item?.url || "").trim() })).filter((item) => item.url)
      : String(fields.alternative_sources || "").split(/\r?\n/).map((url) => ({ url: url.trim() })).filter((item) => item.url);
    const primarySource = fields.primary_source && typeof fields.primary_source === "object"
      ? { url: String(fields.primary_source.url || "").trim() }
      : fields.primary_source_url ? { url: String(fields.primary_source_url).trim() } : {};
    const comparable = {};
    [
      "market_slug", "question", "subject", "category", "evaluation_period_label",
      "evaluation_ends_at", "timezone", "resolution_deadline", "yes_criteria", "no_criteria",
      "edge_cases", "delay_treatment", "cancellation_treatment", "leak_treatment",
      "rename_treatment", "assumptions", "public_criteria", "description"
    ].forEach((field) => {
      if (Object.hasOwn(fields, field)) comparable[field] = String(fields[field] || "").trim();
    });
    if (Object.hasOwn(fields, "primary_source") || Object.hasOwn(fields, "primary_source_url")) comparable.primary_source = primarySource;
    if (Object.hasOwn(fields, "alternative_sources")) comparable.alternative_sources = alternativeSources;
    return comparable;
  }

  function changedExpertFields(proposedFields, savedPayload) {
    const proposed = feedbackComparableDraft(proposedFields);
    const saved = feedbackComparableDraft(savedPayload);
    return Object.keys(proposed).filter((field) => JSON.stringify(proposed[field]) !== JSON.stringify(saved[field]));
  }

  function radarExpertBindingCompatible(prefill, payload) {
    const contract = prefill?.contract;
    const sources = Array.isArray(prefill?.sources) ? prefill.sources : [];
    if (!prefill?.expertRunId || !contract || typeof contract !== "object" || Array.isArray(contract)) return false;
    const evaluationAt = String(contract.evaluation_at || contract.window_end || "").trim();
    const primary = sources.find((source) => source?.role === "PRIMARY_RESOLUTION");
    return contract.contract_schema_version === "atinara-resolution-contract-v1"
      && String(contract.canonical_statement || "").trim() === String(payload?.question || "").trim()
      && Date.parse(evaluationAt) === Date.parse(String(payload?.evaluation_ends_at || ""))
      && String(primary?.url || "").trim() === String(payload?.primary_source?.url || "").trim();
  }

  function disabled() {
    return state.busy ? " disabled" : "";
  }

  async function rpc(name, args = {}) {
    const { data, error } = await client.rpc(name, args);
    if (error) throw error;
    return data;
  }

  function renderAccess(message, canLogin = false) {
    root.setAttribute("aria-busy", "false");
    root.innerHTML = `
      <article class="admin-access-card">
        <p class="eyebrow">Acceso protegido</p>
        <h2>${escapeHtml(message)}</h2>
        <p>Atinara vuelve a comprobar en Supabase el rol administrativo en cada operación. Ocultar esta pantalla no es la medida de seguridad.</p>
        ${canLogin ? '<button class="primary-button" type="button" data-auth-open>Iniciar sesión</button>' : '<a class="secondary-button" href="index.html">Volver a mercados</a>'}
      </article>`;
  }

  function workflowBadge(status) {
    return `<span class="admin-workflow-badge" data-workflow="${escapeHtml(status)}">${escapeHtml(helpers.getStatusLabel(status))}</span>`;
  }

  function toolbarMarkup() {
    return `
      <div class="admin-market-tabs" role="tablist" aria-label="Secciones de gestión">
        <button type="button" role="tab" data-admin-view="drafts" aria-selected="${state.view === "drafts"}">Crear manualmente</button>
        <button type="button" role="tab" data-admin-view="radar" aria-selected="${state.view === "radar"}">Radar de mercados</button>
        <button type="button" role="tab" data-admin-view="observatory" aria-selected="${state.view === "observatory"}">Datos y tendencias</button>
        <button type="button" role="tab" data-admin-view="catalog" aria-selected="${state.view === "catalog"}">Mercados publicados</button>
        <button type="button" role="tab" data-admin-view="audit" aria-selected="${state.view === "audit"}">Auditoría</button>
      </div>`;
  }

  function listMarkup() {
    const statuses = Object.entries(helpers.STATUS_LABELS)
      .filter(([key]) => !["published", "early_closed", "cancelled", "pending_resolution", "resolved", "annulled"].includes(key))
      .map(([key, label]) => `<option value="${escapeHtml(key)}"${state.status === key ? " selected" : ""}>${escapeHtml(label)}</option>`)
      .join("");
    const items = state.drafts.length
      ? state.drafts.map((draft) => `
          <button class="admin-draft-row" type="button" data-open-draft="${escapeHtml(draft.id)}"${state.selected?.draft?.id === draft.id ? ' aria-current="true"' : ""}>
            <span>${workflowBadge(draft.workflow_status)}</span>
            <strong>${escapeHtml(draft.question || "Borrador sin pregunta")}</strong>
            <small>${escapeHtml(draft.market_slug)} · v${escapeHtml(draft.content_version)} · ${escapeHtml(displayDate(draft.updated_at))}</small>
          </button>`).join("")
      : `<div class="admin-empty-state"><strong>No hay borradores con estos filtros</strong><span>Crea uno nuevo o cambia la búsqueda.</span></div>`;

    return `
      <aside class="admin-draft-list" aria-label="Borradores privados">
        <form id="admin-draft-filters" class="admin-list-filters">
          <label><span>Buscar</span><input name="query" type="search" value="${valueAttribute(state.query)}" placeholder="Pregunta o identificador"></label>
          <label><span>Estado</span><select name="status"><option value="">Todos</option>${statuses}</select></label>
          <button class="secondary-button" type="submit">Aplicar</button>
        </form>
        <div class="admin-draft-rows">${items}</div>
      </aside>`;
  }

  function reviewMarkup(payload) {
    const draft = payload?.draft || {};
    const effective = payload?.effective_review || null;
    const latestAttempt = payload?.latest_attempt || null;
    const latestContentReview = payload?.latest_review || null;
    const binding = payload?.binding_compatibility || { compatible: true, required: false, reasons: [] };
    const deterministic = Array.isArray(payload?.deterministic_issues) ? payload.deterministic_issues : [];
    const semantic = Array.isArray(latestContentReview?.semantic_issues) ? latestContentReview.semantic_issues : [];
    const workflowIssues = Array.isArray(draft.workflow_issues)
      ? draft.workflow_issues.filter((issue) => !["resolved", "superseded"].includes(issue?.status)) : [];
    const issues = [...deterministic, ...semantic];
    const issueItems = issues.map((issue, issueIndex) => {
      const issueField = helpers.formatStructuredText(issue?.field, "Revisión");
      const issueCode = helpers.formatStructuredText(issue?.code, "REVIEW_ISSUE");
      const issueMessage = helpers.formatStructuredText(issue?.message ?? issue, "La revisión detectó un motivo bloqueante.");
      const escapedIssueMessage = issue?.message && typeof issue.message !== "object"
        ? escapeHtml(issue.message)
        : escapeHtml(issueMessage);
      return `
      <li id="admin-issue-${escapeHtml(issueField)}-${issueIndex}" data-field="${escapeHtml(issueField)}" data-content-issue="true">
        <code>${escapeHtml(issueCode)}</code>
        <strong>${escapeHtml(issueField)}</strong>
        <span>${escapedIssueMessage}</span>
      </li>`;
    }).join("");
    const issueMarkup = issues.length
      ? `<ol class="admin-validation-reasons">${issueItems}</ol>`
      : '<p class="admin-empty-state">No hay motivos bloqueantes registrados para esta versión.</p>';
    const workflowIssueMarkup = workflowIssues.length ? `
      <section class="admin-workflow-issues" aria-label="Incidencias y rutas de continuación">
        <h4>Incidencias estructuradas</h4>
        <ol>${workflowIssues.map((issue) => `<li data-workflow-issue-id="${escapeHtml(issue.issue_id)}"
          data-workflow-owner="${escapeHtml(issue.owner_stage)}"
          data-workflow-repairability="${escapeHtml(issue.repairability)}"
          data-workflow-blocking-scope="${escapeHtml(issue.blocking_scope)}">
          <strong>${escapeHtml(WORKFLOW_ISSUE_LABELS[issue.issue_code] || "Incidencia del contrato")}</strong>
          <span>Responsable: ${escapeHtml(WORKFLOW_OWNER_LABELS[issue.owner_stage] || "Revisión administrativa")}</span>
          <span>Siguiente acción: ${escapeHtml(WORKFLOW_ACTION_LABELS[issue.next_action] || "Revisar el borrador")}</span>
        </li>`).join("")}</ol>
      </section>` : "";
    const noteItems = Array.isArray(latestContentReview?.editorial_notes)
      ? latestContentReview.editorial_notes
        .map((note) => helpers.formatStructuredText(note))
        .filter(Boolean)
        .map((note) => `<li>${escapeHtml(note)}</li>`).join("")
      : "";
    const notes = Array.isArray(latestContentReview?.editorial_notes) && latestContentReview.editorial_notes.length
      ? `<ul>${noteItems}</ul>` : "";
    const technicalAttempt = latestAttempt?.classification === "technical";
    const technicalLabels = {
      invalid_response: "La respuesta estructurada del proveedor no fue válida.",
      provider_rate_limited: "El proveedor limitó temporalmente las solicitudes.",
      provider_timeout: "El proveedor no respondió dentro del plazo seguro.",
      provider_unavailable: "El proveedor no está disponible temporalmente.",
      provider_auth_error: "La integración del proveedor rechazó la autenticación.",
      internal_error: "La revisión encontró una incidencia interna temporal.",
      stale: "La respuesta pertenecía a una versión anterior y fue ignorada."
    };
    const technicalMarkup = technicalAttempt ? `
      <aside class="admin-service-incident" role="status">
        <strong>Incidencia temporal del servicio</strong>
        <span>${escapeHtml(technicalLabels[latestAttempt.status] || "La revisión automática no terminó correctamente.")}</span>
        <small>Código: ${escapeHtml(latestAttempt.technical_code || latestAttempt.status)} · ${escapeHtml(displayDate(latestAttempt.completed_at || latestAttempt.started_at))}</small>
        <span>${effective ? "La aprobación efectiva anterior sigue vigente." : "El borrador continúa listo para reintentar; no se ha marcado como rechazado."}</span>
      </aside>` : "";
    const history = Array.isArray(payload?.review_history) ? payload.review_history : [];
    const versions = Array.isArray(payload?.version_history) ? payload.version_history : [];
    const historyMarkup = `
      <details class="admin-state-history">
        <summary>Historial recuperable · ${history.length} intentos · ${versions.length} versiones materiales</summary>
        <div class="admin-state-history-grid">
          <section><h4>Intentos</h4><ol>${history.slice(0, 12).map((attempt) => `<li><strong>${escapeHtml(REVIEW_ATTEMPT_LABELS[attempt.status] || "Intento registrado")}</strong><span>v${escapeHtml(attempt.draft_version)} · ${escapeHtml(attempt.classification === "technical" ? "Técnica" : "Contenido")} · ${escapeHtml(displayDate(attempt.completed_at || attempt.started_at))}</span></li>`).join("") || "<li>Sin intentos.</li>"}</ol></section>
          <section><h4>Versiones</h4><ol>${versions.slice(0, 12).map((version) => `<li><strong>v${escapeHtml(version.content_version)}</strong><span>${escapeHtml(CHANGE_ORIGIN_LABELS[version.change_origin] || "Cambio registrado")} · <code>${escapeHtml(String(version.content_fingerprint || "").slice(0, 16))}…</code></span></li>`).join("") || "<li>Sin snapshots.</li>"}</ol></section>
        </div>
      </details>`;
    const bindingReasons = Array.isArray(binding.reasons) ? binding.reasons : [];
    const bindingReasonText = bindingReasons
      .map((reason) => helpers.formatStructuredText(reason))
      .filter(Boolean)
      .join(", ");
    const bindingMarkup = `
      <p class="admin-binding-compatibility" data-compatible="${binding.compatible === true}">
        <strong>Plan de Resolución:</strong>
        ${binding.required === false ? "No requerido para este borrador manual." : binding.compatible === true
          ? `Compatible · plan v${escapeHtml(binding.plan_version || "—")} · ${escapeHtml(binding.binding_status || "draft")}`
          : `No compatible · ${escapeHtml(bindingReasonText || "requiere revisión")}`}
      </p>`;
    const locked = ["scheduled", "published", "early_closed", "cancelled", "pending_resolution", "resolved", "annulled"].includes(draft.workflow_status);
    const blockingScopePriority = { terminal: 5, publication: 4, human_confirmation: 3, approval: 2, none: 0 };
    const authorityIssues = workflowIssues.filter((issue) => issue.blocking_scope !== "none");
    const dominantAuthorityIssue = [...authorityIssues].sort((left, right) =>
      (blockingScopePriority[right.blocking_scope] || 1) - (blockingScopePriority[left.blocking_scope] || 1))[0] || null;
    const terminalWorkflow = authorityIssues.some((issue) => issue.blocking_scope === "terminal"
      || issue.repairability === "terminal");
    const reviewAuthorityBlocked = authorityIssues.some((issue) => issue.blocking_scope !== "approval"
      || issue.owner_stage !== "validator");
    const canReview = !locked && !reviewAuthorityBlocked
      && !["human_confirmed", "scheduled"].includes(draft.workflow_status);
    const confirmationAuthorityBlocked = authorityIssues.some((issue) =>
      ["approval", "human_confirmation", "terminal"].includes(issue.blocking_scope));
    const canConfirm = Boolean(effective)
      && draft.workflow_status === "review_approved"
      && draft.review_status === "approved"
      && binding.compatible === true
      && !confirmationAuthorityBlocked;
    const terminalPublication = draft.artifact_status === "publication_failed_terminal"
      || terminalWorkflow;
    const publicationAuthorityBlocked = authorityIssues.some((issue) =>
      ["approval", "human_confirmation", "publication", "terminal"].includes(issue.blocking_scope));
    const canPublish = draft.workflow_status === "human_confirmed"
      && !terminalPublication && !publicationAuthorityBlocked;
    const effectiveNextAction = dominantAuthorityIssue?.next_action || draft.workflow_next_action;
    const canRecoverPublication = draft.workflow_status === "human_confirmed"
      && !terminalPublication
      && dominantAuthorityIssue?.blocking_scope === "publication"
      && dominantAuthorityIssue?.retryable !== false;
    const nextActionLabel = WORKFLOW_ACTION_LABELS[effectiveNextAction]
      || (workflowIssues.length ? "Continuar con el agente responsable" : "Editar el borrador");
    const scheduledActive = draft.workflow_status === "scheduled";
    const scheduledRecovery = scheduledActive
      && ["scheduled_retry", "scheduled_blocked_recoverable", "scheduled_failed_terminal"]
        .includes(draft.publication_schedule_status);
    const scheduledTerminal = draft.publication_schedule_status === "scheduled_failed_terminal";
    const scheduledRetryable = draft.publication_schedule_status === "scheduled_retry";
    const recoveryCandidateId = draft.radar_candidate_id
      || draft.source_provenance?.origin_candidate_id
      || draft.source_provenance?.radar_candidate_id;
    const canRecoverRadarEligibility = draft.intelligence_origin_type === "radar_candidate"
      && Boolean(recoveryCandidateId)
      && (!draft.radar_candidate_id || effectiveNextAction === "refresh_draft_eligibility");

    return `
      <section class="admin-review-gate" aria-labelledby="admin-review-title" data-latest-attempt-classification="${escapeHtml(latestAttempt?.classification || "none")}" data-workflow-status="${escapeHtml(draft.workflow_status || "")}" data-publication-schedule-status="${escapeHtml(draft.publication_schedule_status || "")}">
        <div class="admin-section-heading">
          <div><p class="eyebrow">Puerta automática obligatoria</p><h3 id="admin-review-title">Revisión y publicación</h3></div>
          ${workflowBadge(draft.workflow_status)}
        </div>
        <div class="admin-review-summary">
          <p><strong>Versión:</strong> ${escapeHtml(draft.content_version || "—")}</p>
          <p><strong>Huella:</strong> <code>${escapeHtml(String(draft.content_fingerprint || "—").slice(0, 20))}${draft.content_fingerprint ? "…" : ""}</code></p>
          <p><strong>Revisión efectiva:</strong> ${effective ? `Aprobada · ${escapeHtml(effective.validator_version)}` : "Ninguna aplicable"}</p>
          <p><strong>Último intento:</strong> ${latestAttempt ? `${escapeHtml(latestAttempt.status)} · ${escapeHtml(latestAttempt.classification)}` : "No solicitado"}</p>
          <p><strong>Privacidad:</strong> permanece privado hasta la publicación autoritativa.</p>
        </div>
        ${technicalMarkup}
        ${bindingMarkup}
        ${issueMarkup}
        ${workflowIssueMarkup}
        ${notes}
        ${historyMarkup}
        ${gateNoticeMarkup()}
        <div class="admin-gate-actions">
          ${canRecoverRadarEligibility ? `<button class="secondary-button" type="button" data-recover-draft-eligibility="${escapeHtml(recoveryCandidateId)}"${disabled()}>Renovar elegibilidad y continuar</button>` : ""}
          ${canReview
            ? `<button class="primary-button" type="button" data-request-review data-state-allowed="true"${disabled()}>${technicalAttempt ? "Reintentar revisión" : "Solicitar nueva revisión"}</button>`
            : `<span>${locked ? "El expediente está cerrado para edición." : "La revisión se reanudará desde el estado indicado."}</span>`}
          ${canConfirm
            ? `<button class="secondary-button" type="button" data-confirm-review data-state-allowed="true"${disabled()}>Confirmar humanamente</button>`
            : `<a class="secondary-button" href="#admin-market-form">${escapeHtml(nextActionLabel)}</a>`}
        </div>
        <p class="admin-gate-rule">No existe una acción para omitir un rechazo o aceptar el riesgo. Cualquier cambio esencial invalida esta revisión.</p>
        ${canPublish || canRecoverPublication ? `<fieldset class="admin-publish-controls" data-state-allowed="true" data-publication-recovery="${canRecoverPublication}">
          <legend>Programación o publicación</legend>
          ${canPublish ? `<label><span>Programar para (opcional)</span><input type="datetime-local" step="0.001" name="scheduled_for" form="admin-market-form"></label>` : ""}
          <button class="primary-button" type="button" data-publish-draft data-state-allowed="true"${disabled()}>${canRecoverPublication ? "Revalidar evidencia y reintentar" : "Revalidar y publicar"}</button>
          <p>${canRecoverPublication ? "Este intento conserva el mercado privado hasta superar la incidencia de publicación." : "Supabase volverá a comprobar rol, estado, versión, huella y aprobación vigente."}</p>
        </fieldset>` : scheduledActive ? `<aside class="admin-service-incident" role="status">
          <strong>${scheduledTerminal ? "La programación terminó en un estado no reintentable." : scheduledRecovery ? "La publicación programada necesita atención." : "Mercado programado y pendiente de ejecución segura."}</strong>
          <span>${scheduledRecovery ? `${escapeHtml(nextActionLabel)}. ` : ""}Los campos permanecen bloqueados. Cancela la programación antes de editar o de abrir una corrección; la autoridad compatible se conservará cuando el estado lo permita.</span>
          <div class="admin-gate-actions">${scheduledRetryable ? `<button class="primary-button" type="button" data-retry-scheduled${disabled()}>Reintentar ahora</button>` : ""}<button class="secondary-button" type="button" data-cancel-scheduled${disabled()}>Cancelar programación</button></div>
        </aside>` : terminalPublication ? `<aside class="admin-service-incident" role="status">
          <strong>Esta publicación no admite reintento automático.</strong>
          <span>${escapeHtml(nextActionLabel)}. El mercado no se publicará mientras esta condición siga vigente.</span>
          <div class="admin-gate-actions"><button class="secondary-button" type="button" data-archive-terminal-draft${disabled()}>Archivar expediente terminal</button></div>
        </aside>` : `<aside class="admin-service-incident" role="status"><strong>La publicación aún no tiene autoridad.</strong><span>${escapeHtml(nextActionLabel)}. El borrador continúa privado y editable.</span></aside>`}
      </section>`;
  }

  function formMarkup(payload) {
    const draft = payload?.draft || { market_slug: "", content_version: null, workflow_status: "draft_incomplete" };
    const radarOrigins = payload?.radar_origins || {};
    const radarCandidate = payload?.radar_candidate || null;
    const observatorySignal = payload?.observatory_signal || null;
    const scheduledLocked = draft.workflow_status === "scheduled";
    const locked = ["scheduled", "published", "early_closed", "cancelled", "pending_resolution", "resolved", "annulled"].includes(draft.workflow_status);
    const source = draft.primary_source || {};
    const alternatives = Array.isArray(draft.alternative_sources) ? draft.alternative_sources.map((item) => item?.url || "").filter(Boolean).join("\n") : "";
    const latest = payload?.latest_review || null;
    const formIssues = [
      ...(Array.isArray(payload?.deterministic_issues) ? payload.deterministic_issues : []),
      ...(Array.isArray(latest?.semantic_issues) ? latest.semantic_issues : [])
    ];
    const issueAliases = {
      primary_source_url: "primary_source",
      alternative_sources: "alternative_sources",
      evaluation_ends_at: "evaluation_ends_at"
    };
    const invalidAttributes = (name) => {
      const field = issueAliases[name] || name;
      const issueIndex = formIssues.findIndex((issue) => issue.field === field);
      return issueIndex >= 0
        ? ` aria-invalid="true" aria-describedby="admin-issue-${escapeHtml(field)}-${issueIndex}"`
        : "";
    };
    const originMarkup = (name) => {
      const origin = radarOrigins[name];
      return origin && RADAR_ORIGIN_LABELS[origin]
        ? `<small class="radar-field-origin" data-origin="${escapeHtml(origin)}">${escapeHtml(RADAR_ORIGIN_LABELS[origin])}</small>`
        : "";
    };
    const f = (name, label, type = "text", options = {}) => `
      <label class="${options.wide ? "field-wide" : ""}">
        <span>${escapeHtml(label)}${options.required ? " *" : ""}</span>
        <input type="${type}" name="${escapeHtml(name)}" value="${valueAttribute(options.value ?? draft[name])}"${options.step ? ` step="${escapeHtml(options.step)}"` : ""}${options.required ? " required" : ""}${locked ? " disabled" : ""}${invalidAttributes(name)}${options.help && !invalidAttributes(name) ? ` aria-describedby="help-${escapeHtml(name)}"` : ""}>
        ${originMarkup(name)}
        ${options.help ? `<small id="help-${escapeHtml(name)}">${escapeHtml(options.help)}</small>` : ""}
      </label>`;
    const t = (name, label, options = {}) => `
      <label class="${options.wide === false ? "" : "field-wide"}">
        <span>${escapeHtml(label)}${options.required ? " *" : ""}</span>
        <textarea name="${escapeHtml(name)}" rows="${options.rows || 3}"${options.required ? " required" : ""}${locked ? " disabled" : ""}${invalidAttributes(name)}>${escapeHtml(options.value ?? draft[name] ?? "")}</textarea>
        ${originMarkup(name)}
        ${options.help ? `<small>${escapeHtml(options.help)}</small>` : ""}
      </label>`;

    return `
      <article class="admin-draft-editor">
        <form id="admin-market-form" novalidate data-draft-id="${escapeHtml(draft.id || "")}" data-version="${escapeHtml(draft.content_version || "")}" data-content-fingerprint="${escapeHtml(draft.content_fingerprint || "")}" data-radar-candidate-id="${escapeHtml(draft.radar_candidate_id || "")}">
          <div class="admin-section-heading">
            <div><p class="eyebrow">Borrador privado</p><h2>${draft.id ? "Editar mercado" : "Crear mercado"}</h2></div>
            ${workflowBadge(draft.workflow_status || "draft_incomplete")}
          </div>
          ${radarCandidate ? `<aside class="radar-prefill-notice"><strong>Pre-rellenado desde ${escapeHtml(RADAR_PROVIDER_LABELS[radarCandidate.provider] || radarCandidate.provider)}.</strong><span>Nada se ha guardado, revisado, aprobado, programado ni publicado. Completa y revisa los campos antes de guardar el borrador privado.</span></aside>` : ""}
          ${observatorySignal ? `<aside class="radar-prefill-notice observatory-prefill-notice"><strong>Propuesta del Observatorio desde ${escapeHtml(OBSERVATORY_PROVIDER_LABELS[observatorySignal.provider] || observatorySignal.provider)}.</strong><span>Los datos observados, la inferencia editorial y las fuentes vinculantes permanecen separados. Nada se ha guardado, aprobado, programado ni publicado.</span></aside>` : ""}
          ${scheduledLocked
            ? '<p class="admin-locked-notice"><strong>Campos esenciales bloqueados durante la programación:</strong> cancela primero la programación con la acción segura del expediente para poder editar.</p>'
            : locked ? '<p class="admin-locked-notice"><strong>Campos esenciales bloqueados:</strong> el mercado ya no admite edición directa. Utiliza las acciones posteriores seguras.</p>' : ""}
          <fieldset${locked ? " disabled" : ""}>
            <legend>Identidad y pregunta</legend>
            <div class="admin-form-grid">
              ${f("market_slug", "Identificador", "text", { required: true, help: "Letras minúsculas, números y guiones. No se publica hasta superar la puerta." })}
              ${f("category", "Categoría", "text", { value: draft.category })}
              ${f("subject", "Sujeto, evento o producto inequívoco", "text", { wide: true })}
              ${t("question", "Pregunta binaria", { required: true, rows: 2 })}
              ${f("yes_option", "Opción afirmativa", "text", { value: "Sí" })}
              ${f("no_option", "Opción negativa", "text", { value: "No" })}
              ${t("description", "Descripción pública", { rows: 3 })}
            </div>
          </fieldset>
          <fieldset${locked ? " disabled" : ""}>
            <legend>Periodo, cierre y zona horaria</legend>
            <p class="fieldset-note">El cierre de participación se deriva del final estructurado del periodo. La fecha límite de resolución es independiente.</p>
            <div class="admin-form-grid">
              ${f("evaluation_period_label", "Periodo evaluado", "text", { wide: true, help: "Ejemplo: desde el 1 de septiembre de 2026 00:00 hasta el 30 de septiembre de 2026 23:59 Europe/Madrid." })}
              ${f("evaluation_ends_at", "Final exacto del periodo", "datetime-local", { value: localDateTime(draft.evaluation_ends_at, draft.timezone), required: true, step: "0.001" })}
              ${f("timezone", "Zona horaria IANA", "text", { value: draft.timezone || "", required: true })}
              ${f("resolution_deadline", "Fecha límite de resolución", "datetime-local", { value: localDateTime(draft.resolution_deadline, draft.timezone), required: true, step: "0.001" })}
              <div class="field-derived field-wide"><span>closes_at derivado</span><strong>${escapeHtml(draft.evaluation_ends_at ? displayDate(draft.evaluation_ends_at) : "Se calculará al guardar")}</strong><small>No se introduce una segunda fecha contradictoria.</small></div>
            </div>
          </fieldset>
          <fieldset${locked ? " disabled" : ""}>
            <legend>Criterios y fuentes</legend>
            <div class="admin-form-grid">
              ${t("yes_criteria", "Criterio exacto de Sí", { required: true })}
              ${t("no_criteria", "Criterio exacto de No", { required: true })}
              ${t("edge_cases", "Casos límite", { required: true, rows: 4 })}
              ${t("public_criteria", "Explicación pública de los criterios", { required: true, rows: 4 })}
              ${f("primary_source_url", "Fuente principal HTTPS", "url", { value: source.url || "", required: true, wide: true })}
              ${t("alternative_sources", "Fuentes alternativas HTTPS, una por línea", { value: alternatives, required: true, rows: 3 })}
            </div>
          </fieldset>
          <fieldset${locked ? " disabled" : ""}>
            <legend>Tratamiento de situaciones especiales</legend>
            <div class="admin-form-grid">
              ${t("delay_treatment", "Retrasos", { rows: 2 })}
              ${t("cancellation_treatment", "Cancelaciones", { rows: 2 })}
              ${t("leak_treatment", "Filtraciones", { rows: 2 })}
              ${t("rename_treatment", "Cambios de nombre", { rows: 2 })}
              ${t("assumptions", "Supuestos aplicables", { rows: 3 })}
            </div>
          </fieldset>
          <div class="admin-editor-actions">
            <button class="primary-button" type="submit" data-save-draft${disabled()}${locked || draft.id ? " disabled" : ""}>Guardar borrador privado</button>
            <span data-draft-change-status aria-live="polite">${draft.id ? "Sin cambios pendientes" : "Nuevo borrador sin guardar"}</span>
            <small>Los borradores incompletos nunca aparecen en superficies públicas.</small>
          </div>
        </form>
        ${draft.id ? reviewMarkup(payload) : ""}
        ${draft.id ? auditMarkup(payload.audit || [], true) : ""}
      </article>`;
  }

  function catalogMarkup() {
    if (!state.catalog.length) return '<div class="admin-empty-state"><strong>No hay mercados administrables</strong><span>La consulta no devolvió resultados.</span></div>';
    return `<div class="admin-catalog-table" role="region" aria-label="Mercados publicados" tabindex="0">
      <table><thead><tr><th>Mercado</th><th>Estado</th><th>Periodo</th><th>Participación</th><th>Acciones seguras</th></tr></thead><tbody>
      ${state.catalog.map((market) => `
        <tr>
          <td><strong>${escapeHtml(market.question)}</strong><small>${escapeHtml(market.market_id)}</small></td>
          <td>${escapeHtml(market.status)}${market.participation_closed_at ? '<br><span class="admin-workflow-badge">Participación cerrada</span>' : ""}</td>
          <td>${escapeHtml(displayDate(market.evaluation_ends_at || market.closes_at))}<small>Resolución: ${escapeHtml(displayDate(market.resolution_deadline))}</small></td>
          <td>${escapeHtml(market.participants_count || 0)} participantes<br>${window.atinaraUi?.formatKarmaAmount(market.karma_total || 0) || `${escapeHtml(market.karma_total || 0)} Karma`}</td>
          <td>
            <button class="secondary-button" type="button" data-close-early="${escapeHtml(market.market_id)}"${String(market.status).toLowerCase() === "abierto" ? "" : " disabled"}>Cerrar participaciones</button>
            <button class="danger-button" type="button" data-cancel-market="${escapeHtml(market.market_id)}"${["resuelto", "anulado"].includes(String(market.status).toLowerCase()) ? " disabled" : ""}>Anular</button>
            <a class="text-link" href="admin-resolution.html">Ir a resolución</a>
          </td>
        </tr>`).join("")}
      </tbody></table></div>`;
  }

  function auditMarkup(events, embedded = false) {
    const list = Array.isArray(events) ? events : [];
    const items = list.length ? list.map((event) => `
      <li>
        <strong>${escapeHtml(event.action_code)}</strong>
        <span>${escapeHtml(displayDate(event.created_at))}</span>
        ${event.draft_version ? `<small>Versión ${escapeHtml(event.draft_version)}</small>` : ""}
      </li>`).join("") : '<li class="admin-empty-state">Todavía no hay eventos.</li>';
    return `<section class="admin-audit-trail${embedded ? " admin-audit-embedded" : ""}" aria-label="Trazabilidad administrativa"><h3>Auditoría administrativa</h3><ol>${items}</ol></section>`;
  }

  function latestProviderStatus(provider) {
    const source = state.radar.candidateProviders.length
      ? state.radar.candidateProviders
      : state.radar.providers;
    return source
      .filter((item) => item.provider === provider)
      .sort((left, right) => Date.parse(right.fetched_at || 0) - Date.parse(left.fetched_at || 0))[0] || null;
  }

  function radarProviderMarkup() {
    const providers = ["polymarket", "kalshi"];
    return `<section class="radar-provider-strip" aria-label="Estado de proveedores">
      ${providers.map((provider) => {
        const status = latestProviderStatus(provider);
        const discardCount = Math.max(0, Number(status?.discarded_count) || 0);
        const quarantineCount = Math.max(0, Number(status?.quarantined_count) || 0);
        const qualityCount = Math.max(discardCount, quarantineCount);
        const label = status?.error_code === "PROVIDER_NOT_CONFIGURED" ? "No configurado"
          : status?.status === "available" && qualityCount ? "Disponible con descartes"
          : status?.status === "available" ? "Disponible"
          : status?.status === "cached" ? "Disponible desde caché"
          : status?.status === "rate_limited" || status?.status === "partial_error" ? "Degradado temporalmente"
          : status?.status === "unavailable" ? "Error técnico"
          : status?.status ? "Revisión pendiente" : "Sin consultar";
        const visualStatus = status?.status === "available" && qualityCount ? "available_with_discards" : status?.status || "idle";
        const lastKnownGood = status?.status !== "available" && Number(status?.last_success_count) > 0
          ? ` · último resultado válido: ${escapeHtml(status.last_success_count)}` : "";
        const quality = qualityCount ? ` · ${escapeHtml(qualityCount)} descartadas o en cuarentena` : "";
        return `<article class="radar-provider-card" data-provider-status="${escapeHtml(visualStatus)}">
          <div><strong>${escapeHtml(RADAR_PROVIDER_LABELS[provider])}</strong><span>${escapeHtml(label)}</span></div>
          <small>${status ? `${escapeHtml(displayDate(status.fetched_at))} · ${escapeHtml(status.result_count || 0)} procesadas${quality}${lastKnownGood}` : "Pulsa Actualizar fuentes para consultar."}</small>
        </article>`;
      }).join("")}
    </section>`;
  }

  function radarIssueMessage(issue) {
    const messages = {
      RADAR_PERSISTENCE_TIMEOUT: "El guardado alcanzó su límite seguro y puede reanudarse sin repetir las filas confirmadas.",
      RADAR_PERSISTENCE_ISOLATION_DEFERRED: "Quedan lotes pendientes con un cursor seguro para continuar.",
      RADAR_PERSISTENCE_FAILED: "La persistencia no terminó; el último resultado válido permanece disponible.",
      PROVIDER_UNAVAILABLE: "La fuente no respondió. Se conserva su último resultado válido.",
      PROVIDER_RATE_LIMITED: "La fuente ha limitado temporalmente las consultas.",
      PROVIDER_CIRCUIT_OPEN: "La fuente está en espera hasta el siguiente intento seguro.",
      SOURCE_AUTHORITY_REGISTRY_UNAVAILABLE: "El registro de fuentes oficiales no estuvo disponible temporalmente.",
      RADAR_REFRESH_ALREADY_RUNNING: "Ya existe una actualización en curso para esta fuente.",
    };
    return messages[issue?.issue_code] || "La actualización conserva el estado anterior y ofrece un reintento seguro.";
  }

  function radarOperationalSummaryMarkup() {
    const providerIssues = Array.isArray(state.radar.providerIssues) ? state.radar.providerIssues : [];
    const enrichmentIssues = Array.isArray(state.radar.enrichmentIssues) ? state.radar.enrichmentIssues : [];
    const issues = [...providerIssues, ...enrichmentIssues];
    if (!issues.length) return "";
    const resumable = issues.some((issue) => issue?.retryable === true);
    return `<details class="radar-operational-summary">
      <summary>${escapeHtml(issues.length)} incidencia${issues.length === 1 ? "" : "s"} recuperable${issues.length === 1 ? "" : "s"} · las candidatas válidas siguen disponibles</summary>
      <div class="radar-operational-detail" role="status">
        <ul>${issues.map((issue) => {
          const current = issue?.current_value && typeof issue.current_value === "object" ? issue.current_value : {};
          const provider = current.provider || issue.provider || "radar";
          const lastSuccess = current.last_success_at
            ? ` Último resultado válido: ${escapeHtml(displayDate(current.last_success_at))} · ${escapeHtml(current.last_success_count || 0)} filas.`
            : "";
          return `<li><strong>${escapeHtml(RADAR_PROVIDER_LABELS[provider] || "Radar")}</strong><span>${escapeHtml(radarIssueMessage(issue))}${lastSuccess}</span></li>`;
        }).join("")}</ul>
        <p>${resumable ? "Pulsa Continuar actualización para reanudar la misma intención; no se repiten lotes terminados." : "La próxima comprobación segura actualizará este estado."}</p>
        ${enrichmentIssues.length ? "<p>El enriquecimiento de fuentes es auxiliar y no cambia la salud de Polymarket o Kalshi.</p>" : ""}
      </div>
    </details>`;
  }

  function radarFiltersMarkup() {
    const categoryOptions = RADAR_CATEGORIES.map((category) => `<option value="${escapeHtml(category)}"${state.radar.category === category ? " selected" : ""}>${escapeHtml(category)}</option>`).join("");
    const cooldown = Math.max(0, Math.ceil((state.radar.cooldownUntil - Date.now()) / 1000));
    return `<form id="radar-filters" class="radar-filters">
      <label><span>Fuente</span><select name="provider">
        <option value="all"${state.radar.provider === "all" ? " selected" : ""}>Todas las disponibles</option>
        <option value="polymarket"${state.radar.provider === "polymarket" ? " selected" : ""}>Polymarket</option>
        <option value="kalshi"${state.radar.provider === "kalshi" ? " selected" : ""}>Kalshi</option>
      </select></label>
      <label><span>Categoría Atinara</span><select name="category"><option value="">Todas</option>${categoryOptions}</select></label>
      <label class="radar-query"><span>Buscar</span><input type="search" name="query" value="${valueAttribute(state.radar.query)}" placeholder="Pregunta, juego, empresa o evento"></label>
      <label><span>Horizonte</span><select name="horizon">
        <option value="30d"${state.radar.horizon === "30d" ? " selected" : ""}>30 días</option>
        <option value="90d"${state.radar.horizon === "90d" ? " selected" : ""}>90 días</option>
        <option value="180d"${state.radar.horizon === "180d" ? " selected" : ""}>180 días</option>
        <option value="365d"${state.radar.horizon === "365d" ? " selected" : ""}>365 días</option>
      </select></label>
      <label><span>Calidad</span><select name="quality">
        <option value="fit"${state.radar.quality === "fit" ? " selected" : ""}>Solo aptos</option>
        <option value="review"${state.radar.quality === "review" ? " selected" : ""}>Aptos y revisión necesaria</option>
        <option value="all"${state.radar.quality === "all" ? " selected" : ""}>Todos los no rechazados</option>
        <option value="rejected"${state.radar.quality === "rejected" ? " selected" : ""}>Auditoría de rechazados</option>
      </select></label>
      <label><span>Orden</span><select name="order">
        <option value="recommended"${state.radar.order === "recommended" ? " selected" : ""}>Recomendados</option>
        <option value="popularity"${state.radar.order === "popularity" ? " selected" : ""}>Popularidad</option>
        <option value="closing"${state.radar.order === "closing" ? " selected" : ""}>Cierre próximo</option>
        <option value="recent"${state.radar.order === "recent" ? " selected" : ""}>Más recientes</option>
      </select></label>
      <div class="radar-filter-actions">
        <button class="secondary-button" type="submit"${state.busy || state.radarLoading ? " disabled" : ""}>Aplicar filtros</button>
        <button class="primary-button" type="button" data-radar-refresh${state.busy || (!state.radar.refreshInProgress && cooldown) ? " disabled" : ""}>${state.busy ? "Actualizando…" : state.radar.refreshInProgress ? "Continuar actualización" : cooldown ? `Disponible en ${cooldown} s` : "Actualizar fuentes"}</button>
      </div>
    </form>`;
  }

  function radarCandidateReady(candidate) {
    return !radarCandidateIsTerminal(candidate)
      && !(Array.isArray(candidate?.workflow_issues) && candidate.workflow_issues.some((issue) =>
        (issue?.blocking_scope === "terminal" || issue?.repairability === "terminal")
          && !["resolved", "superseded"].includes(String(issue?.status || "open"))))
      && candidate.state === "available"
      && candidate.verification_status === "verified_open"
      && radarCandidatePolicyCurrent(candidate)
      && radarParentComplete(candidate)
      && radarCanonicalChildProjectionValid(candidate)
      && radarEligibilityCurrent(candidate)
      && radarResolutionSourceProven(candidate)
      && !candidate.is_stale
      && !radarBlockingDuplicateMatches(candidate).length;
  }

  function radarCandidateDispositionCode(candidate) {
    return String(candidate?.eligibility_reason_code || candidate?.domain_reason_code || "");
  }

  function radarCandidateIsTerminal(candidate) {
    return [
      "OUTSIDE_GAMING_DOMAIN", "EVENT_ALREADY_RESOLVED", "EVENT_OUTSIDE_CONTRACT",
      "DUPLICATE_MARKET", "PROVIDER_NOT_OPEN", "PROVIDER_OPTION_INACTIVE",
      "PROVIDER_EVENT_NOT_FOUND", "PROVIDER_CHILD_NOT_FOUND"
    ]
      .includes(radarCandidateDispositionCode(candidate));
  }

  function radarCandidateIsPlaceholder(candidate) {
    return ["PROVIDER_PLACEHOLDER", "PROVIDER_CHILD_IDENTITY_RESOLUTION_REQUIRED"]
      .includes(radarCandidateDispositionCode(candidate))
      || candidate?.identity_status === "unresolved_placeholder";
  }

  function radarBlockingDuplicateMatches(candidate) {
    return (Array.isArray(candidate?.duplicate_matches) ? candidate.duplicate_matches : []).filter((match) => {
      const relationship = String(match?.relationship || "");
      return match?.blocking !== false
        && ["exact_duplicate", "semantic_duplicate"].includes(relationship);
    });
  }

  function radarOriginalChildLabel(candidate) {
    return String(candidate?.raw_provider_child_label || "").trim();
  }

  function radarCanonicalChildLabel(candidate) {
    if (!radarCanonicalChildProjectionValid(candidate)) return "";
    return String(candidate?.canonical_child_label || candidate?.family_child_label || "").trim();
  }

  function radarCandidateHeading(candidate) {
    return String(candidate?.atinara_question || radarCanonicalChildLabel(candidate) || "Opción del evento pendiente de adaptación").trim();
  }

  function radarAgentExecutionMarkup(candidate) {
    const execution = candidate?.source_agent_execution;
    const tools = Array.isArray(execution?.tools) ? execution.tools : [];
    if (!tools.length) return "<p>Sin ejecución reciente del agente de fuentes en este detalle.</p>";
    const statusLabels = { completed: "Completado", degraded: "Degradado", failed: "Falló", no_op: "Sin cambios" };
    const toolLabels = {
      read_provider_contract: "Leer contrato del proveedor",
      search_official_sources: "Buscar fuentes oficiales",
      fetch_official_source: "Comprobar fuente oficial",
      classify_terminal_evidence: "Descartar un resultado ya conocido",
      select_resolution_authority: "Seleccionar autoridad de resolución",
      persist_eligibility: "Guardar elegibilidad",
    };
    const executionLabels = { completed: "Completado", degraded: "Disponible con comprobaciones pendientes", failed: "No completado", blocked: "Bloqueado" };
    return `<p><strong>Estado:</strong> ${escapeHtml(executionLabels[execution.status] || "Completado")} · ${escapeHtml(execution.step_count || tools.length)} pasos acotados.</p><ol class="radar-agent-trace">${tools.map((event) => `<li><strong>${escapeHtml(toolLabels[event.tool] || "Comprobación segura")}</strong><span>${escapeHtml(statusLabels[event.status] || "Completado")}</span></li>`).join("")}</ol><p>Este agente solo investiga y clasifica: nunca confirma, publica ni resuelve mercados.</p>`;
  }

  function radarChildMarkup(candidate) {
    const ready = radarCandidateReady(candidate);
    const status = radarVerificationLabel(candidate);
    const canonicalLabel = radarCanonicalChildLabel(candidate);
    const question = radarCandidateHeading(candidate);
    return `<li class="radar-event-option">
      <div class="radar-event-option-copy">
        <strong>${escapeHtml(canonicalLabel || "Identidad canónica pendiente")}</strong>
        <span>${escapeHtml(question)} · Probabilidad del proveedor: ${escapeHtml(displayProbability(candidate.source_probability_yes ?? candidate.source_probability))} · Cierre: ${escapeHtml(displayDate(candidate.source_close_at))}</span>
      </div>
      <div class="radar-event-option-actions">
        <span class="radar-quality-badge" data-quality="${escapeHtml(candidate.quality_status)}">${escapeHtml(status)}</span>
        <button class="primary-button" type="button" data-radar-details="${escapeHtml(candidate.id)}">Detalles</button>
        <button class="primary-button" type="button" data-radar-prepare="${escapeHtml(candidate.id)}"${ready ? "" : " disabled"}>Preparar</button>
      </div>
    </li>`;
  }

  function radarGroupMarkup(group, groupIndex) {
    const allCandidates = Array.isArray(group.candidates) ? group.candidates : [];
    const highlightedCandidates = Array.isArray(group.top_candidates) && group.top_candidates.length
      ? group.top_candidates
      : allCandidates.slice(0, 3);
    const groupKey = String(group.event_group_key || `${group.provider || "external"}:${groupIndex}`);
    const expanded = state.radar.expandedGroups.has(groupKey);
    const candidates = expanded ? allCandidates : highlightedCandidates;
    const declaredCount = radarIntegerCount(group.provider_declared_child_count);
    const accountedCount = radarIntegerCount(group.provider_accounted_child_count);
    const childCount = declaredCount ?? allCandidates.length;
    const hiddenCount = Math.max(0, allCandidates.length - candidates.length);
    const summary = childCount === 1
      ? "1 opción declarada y contabilizada por el proveedor."
      : expanded
        ? `${childCount} opciones declaradas · ${accountedCount ?? "recuento pendiente"} contabilizadas. Se muestran todas las candidatas de este filtro.`
        : `${childCount} opciones declaradas y contabilizadas. Se muestran las tres más relevantes.`;
    const optionsId = `radar-group-options-${groupIndex}`;
    return `<article class="radar-candidate-card radar-event-card" data-verification="${escapeHtml(group.verification_status)}" data-child-count="${escapeHtml(childCount)}">
      <header>
        <div><span class="radar-provider-badge">${escapeHtml(RADAR_PROVIDER_LABELS[group.provider] || group.provider)}</span><span>${escapeHtml(group.category || "Sin clasificar")}</span></div>
        <strong class="radar-score" aria-label="Puntuación Atinara ${escapeHtml(group.quality_score || 0)} de 100">${escapeHtml(group.quality_score || 0)}<small>/100</small></strong>
      </header>
      <h3>${escapeHtml(group.title || "Evento externo")}</h3>
      <p class="radar-event-summary">${escapeHtml(summary)}</p>
      <ul class="radar-event-options" id="${optionsId}">${candidates.map(radarChildMarkup).join("")}</ul>
      ${hiddenCount ? `<p class="radar-event-more">Quedan ${escapeHtml(hiddenCount)} opciones identificadas por mostrar.</p>` : ""}
      <footer>${allCandidates.length > highlightedCandidates.length ? `<button class="secondary-button" type="button" data-radar-toggle-group="${valueAttribute(groupKey)}" aria-expanded="${String(expanded)}" aria-controls="${optionsId}">${expanded ? "Mostrar solo las 3 destacadas" : `Ver las ${allCandidates.length} opciones identificadas`}</button>` : ""}${externalLink(group.external_event_url, "Abrir evento original", "primary")}</footer>
    </article>`;
  }

  function radarCurrentGroupProjection(group) {
    const candidates = Array.isArray(group?.candidates) ? group.candidates : [];
    if (!candidates.length || candidates.some((candidate) =>
      !radarCandidatePolicyCurrent(candidate)
        || !radarParentComplete(candidate)
        || !radarCanonicalChildProjectionValid(candidate))) return null;
    const currentIds = new Set(candidates.map((candidate) => String(candidate.id || "")));
    return {
      ...group,
      candidates,
      top_candidates: (Array.isArray(group.top_candidates) ? group.top_candidates : [])
        .filter((candidate) => currentIds.has(String(candidate.id || ""))),
    };
  }

  function radarRejectionMarkup(candidate) {
    const evidence = Array.isArray(candidate.verification_evidence) ? candidate.verification_evidence : [];
    const sourceResult = providerResultLabel(candidate.source_result);
    return `<article class="radar-rejection-card">
      <header><div><span class="radar-provider-badge">${escapeHtml(RADAR_PROVIDER_LABELS[candidate.provider] || candidate.provider)}</span><strong>${escapeHtml(radarReasonLabel(radarRejectionReasonCode(candidate)))}</strong></div><time>${escapeHtml(displayDate(candidate.verified_at))}</time></header>
      <h4>${escapeHtml(radarCandidateHeading(candidate))}</h4>
      <p>${escapeHtml(radarReasonDescription(candidate))}</p>
      ${sourceResult ? `<p class="radar-provider-result"><strong>Resultado del proveedor:</strong> ${escapeHtml(sourceResult)}</p>` : ""}
      <div class="radar-rejection-links">${externalLink(candidate.external_event_url || candidate.external_market_url, "Abrir mercado original")}${evidence.slice(0, 2).map((item) => externalLink(item.url, item.title || "Abrir evidencia")).join("")}</div>
    </article>`;
  }

  function radarRejectionsMarkup() {
    const rejected = state.radar.rejected || { total: 0, counts: {}, items: [] };
    const items = (Array.isArray(rejected.items) ? rejected.items : [])
      .filter((candidate) => candidate?.identity_status === "resolved"
        && radarParentComplete(candidate)
        && radarCanonicalChildProjectionValid(candidate));
    if (!items.length) return "";
    const policyItems = items.filter(radarCandidatePolicyCurrent);
    const outdatedItems = items.filter((candidate) => !radarCandidatePolicyCurrent(candidate));
    const currentItems = policyItems.filter((candidate) => radarRejectionReasonCode(candidate) !== "EVENT_ALREADY_RESOLVED");
    const selectedReason = state.radar.rejectionReason;
    const visibleItems = selectedReason === "all"
      ? items
      : selectedReason === "outdated"
        ? outdatedItems
      : selectedReason === "current"
        ? currentItems
        : policyItems.filter((candidate) => radarRejectionReasonCode(candidate) === selectedReason);
    const filterButton = (value, label, count) => `<button class="radar-rejection-filter" type="button" data-radar-rejection-filter="${escapeHtml(value)}" aria-pressed="${String(selectedReason === value)}"><span>${escapeHtml(label)}</span><strong>${escapeHtml(count)}</strong></button>`;
    const currentReasonCounts = policyItems.reduce((counts, candidate) => {
      const code = radarRejectionReasonCode(candidate);
      counts[code] = (counts[code] || 0) + 1;
      return counts;
    }, {});
    const reasonButtons = Object.entries(currentReasonCounts)
      .sort((left, right) => Number(right[1]) - Number(left[1]))
      .map(([code, count]) => filterButton(code, radarReasonLabel(code), count))
      .join("");
    const cards = visibleItems.length
      ? `<div class="radar-rejection-grid">${visibleItems.map(radarRejectionMarkup).join("")}</div>`
      : `<div class="admin-empty-state radar-empty"><strong>No hay rechazos con este filtro</strong><span>Elige otro motivo para consultar el archivo de decisiones.</span></div>`;
    return `<section class="radar-rejections" aria-labelledby="radar-rejections-title">
      <header><div><p class="eyebrow">Auditoría de elegibilidad</p><h3 id="radar-rejections-title">${escapeHtml(items.length)} candidatas reales registradas</h3></div><p>Los eventos ya resueltos y las evaluaciones del criterio anterior quedan ocultos por defecto. Puedes filtrar cada motivo sin exponer códigos internos.</p></header>
      <div class="radar-rejection-counts" role="group" aria-label="Filtrar candidatas no aptas por motivo">${filterButton("current", "Rechazos vigentes", currentItems.length)}${filterButton("all", "Todos", items.length)}${outdatedItems.length ? filterButton("outdated", "Criterio anterior", outdatedItems.length) : ""}${reasonButtons}</div>
      <p class="radar-rejection-summary" role="status">Mostrando ${escapeHtml(visibleItems.length)} de ${escapeHtml(items.length)} candidatas.</p>
      ${cards}
    </section>`;
  }

  const RADAR_RECONCILIATION_LABELS = {
    complete: "Completa",
    incomplete_provider_metadata: "Metadatos del proveedor incompletos",
    inconsistent_provider_count: "Recuento incoherente",
    refresh_required: "Actualización pendiente",
    provider_unavailable: "Proveedor temporalmente no disponible",
    historical_mapping_required: "Mapeo histórico pendiente",
    terminal_provider_corruption: "Conflicto terminal del proveedor"
  };

  const RADAR_CHILD_CLASSIFICATION_LABELS = {
    identified_real_option: "Opción real identificada",
    provider_placeholder_pending_resolution: "Identidad pendiente de reconciliación",
    aggregate_other_option: "Opción agregada «Otro»",
    tie_option: "Opción de empate",
    no_winner_option: "Opción sin ganador",
    provider_removed_child: "Hija eliminada por el proveedor",
    provider_closed_child: "Hija cerrada por el proveedor",
    provider_duplicate_child: "Duplicado exacto del proveedor",
    provider_data_conflict: "Conflicto de datos del proveedor"
  };
  const RADAR_CHILD_AVAILABILITY_LABELS = {
    open: "Abierta", closed: "Cerrada", inactive: "Inactiva", removed: "Eliminada",
    unopened: "Aún no abierta", paused: "Pausada", unknown: "Estado no disponible"
  };
  const RADAR_CHILD_TRANSITION_LABELS = {
    same: "Sin cambio", new: "Nueva", renamed: "Renombrada",
    removed: "Retirada", moved_parent: "Movida de evento padre"
  };
  const RADAR_IDENTITY_EVIDENCE_RESULT_LABELS = {
    parent_children_enumerated: "Hijas enumeradas en el padre",
    current_child_page_enumerated: "Página actual enumerada",
    historical_child_page_enumerated: "Página histórica enumerada",
    child_identity_observed_in_parent: "Identidad observada en el padre",
    identity_resolved: "Identidad resuelta",
    provider_removed_child: "Retirada confirmada por el proveedor",
    provider_closed_child: "Cierre confirmado por el proveedor",
    provider_unavailable: "Proveedor temporalmente no disponible",
    placeholder_unresolved: "Identidad todavía no disponible"
  };

  function radarCountText(value) {
    const count = radarIntegerCount(value);
    return count === null ? "No disponible" : String(count);
  }

  function radarReconciliationIssueMarkup(issue) {
    if (!issue || typeof issue !== "object") return "";
    const stageLabels = { radar: "Radar", provider_refresh: "Actualización del proveedor" };
    const scopeLabels = { none: "Sin bloqueo", approval: "Aprobación", human_confirmation: "Confirmación humana", publication: "Publicación", terminal: "Terminal" };
    const actionLabels = { retry_provider_refresh: "Reintentar la actualización del proveedor", resolve_provider_child_identity: "Resolver la identidad de la hija", inspect_provider_data_conflict: "Revisar el conflicto de datos del proveedor" };
    const statusLabels = { open: "Abierta", in_progress: "En curso", waiting: "En espera", resolved: "Resuelta", superseded: "Sustituida" };
    return `<section class="radar-reconciliation-issue"><h4>Seguimiento de la incidencia</h4><dl>
      <div><dt>Issue</dt><dd><code>${escapeHtml(issue.issue_id || "No disponible")}</code></dd></div>
      <div><dt>Detectada por</dt><dd>${escapeHtml(stageLabels[issue.detected_by] || issue.detected_by || "No disponible")}</dd></div>
      <div><dt>Responsable</dt><dd>${escapeHtml(stageLabels[issue.owner_stage] || issue.owner_stage || "No disponible")}</dd></div>
      <div><dt>Alcance bloqueado</dt><dd>${escapeHtml(scopeLabels[issue.blocking_scope] || issue.blocking_scope || "No disponible")}</dd></div>
      <div><dt>Siguiente acción</dt><dd>${escapeHtml(actionLabels[issue.next_action] || issue.next_action || "No disponible")}</dd></div>
      <div><dt>Estado</dt><dd>${escapeHtml(statusLabels[issue.status] || "No disponible")}</dd></div>
    </dl></section>`;
  }

  function radarIdentityEvidenceMarkup(items) {
    const evidence = Array.isArray(items) ? items.slice(0, 12) : [];
    if (!evidence.length) return "<p>Evidencia de identidad no disponible.</p>";
    return `<ul class="radar-evidence-list">${evidence.map((item) => `<li>
      <strong>${escapeHtml(RADAR_IDENTITY_EVIDENCE_RESULT_LABELS[item.result] || "Comprobación oficial")}</strong>
      ${item.endpoint ? ` · endpoint <code>${escapeHtml(item.endpoint)}</code>` : ""}
      ${item.identifier ? ` · identificador <code>${escapeHtml(item.identifier)}</code>` : ""}
      ${item.checked_at ? ` · ${escapeHtml(displayDate(item.checked_at))}` : ""}
      ${externalLink(item.url, "Abrir evidencia oficial")}
    </li>`).join("")}</ul>`;
  }

  function radarReconciliationMarkup() {
    const items = Array.isArray(state.radar.parentReconciliations)
      ? state.radar.parentReconciliations : [];
    const page = state.radar.reconciliationPage || {};
    const previousOffset = radarIntegerCount(page.previous_offset);
    const nextOffset = radarIntegerCount(page.next_offset);
    const pagination = previousOffset !== null || nextOffset !== null ? `<nav class="radar-page-controls" aria-label="Páginas de reconciliación del proveedor">
      ${previousOffset !== null ? `<button class="secondary-button" type="button" data-radar-reconciliation-page="${escapeHtml(previousOffset)}">Conciliaciones anteriores</button>` : ""}
      <span>Mostrando ${escapeHtml(items.length)} de ${escapeHtml(radarCountText(page.total))} padres reconciliados.</span>
      ${nextOffset !== null ? `<button class="secondary-button" type="button" data-radar-reconciliation-page="${escapeHtml(nextOffset)}">Conciliaciones siguientes</button>` : ""}
    </nav>` : "";
    if (!items.length) return `<section class="radar-reconciliation-section" aria-labelledby="radar-reconciliation-title">
      <header><div><p class="eyebrow">Integridad de catálogo</p><h3 id="radar-reconciliation-title">Reconciliación del proveedor</h3></div><p>${page.snapshot_available === false ? "No existe todavía un snapshot vigente con recuento de padres e hijas. Las filas legacy no se proyectan como catálogo actual." : "La consulta es válida y no contiene padres para estos filtros."}</p></header>${pagination}
    </section>`;
    const incomplete = items.filter((item) => item.reconciliation_status !== "complete").length;
    return `<section class="radar-reconciliation-section" aria-labelledby="radar-reconciliation-title">
      <header><div><p class="eyebrow">Integridad de catálogo</p><h3 id="radar-reconciliation-title">Reconciliación del proveedor</h3></div><p>${escapeHtml(radarCountText(page.total))} padres comprobados · ${escapeHtml(incomplete)} pendientes en esta página. Un padre incompleto no entra en candidatas ni en rechazos.</p></header>
      <div class="radar-reconciliation-grid">${items.map((item) => {
        const canonicalTitle = String(item.canonical_parent_label || "").trim();
        return `<article class="radar-reconciliation-card" data-reconciliation="${escapeHtml(item.reconciliation_status)}">
          <header><div><span class="radar-provider-badge">${escapeHtml(RADAR_PROVIDER_LABELS[item.provider] || item.provider)}</span><strong>${escapeHtml(RADAR_RECONCILIATION_LABELS[item.reconciliation_status] || "Pendiente")}</strong></div><time>${escapeHtml(displayDate(item.checked_at))}</time></header>
          <h4>${escapeHtml(canonicalTitle || "Identidad canónica del padre pendiente")}</h4>
          ${canonicalTitle ? "" : `<p><strong>Título original:</strong> ${escapeHtml(item.raw_provider_parent_label || "No disponible")}</p>`}
          <p>${escapeHtml(radarCountText(item.provider_declared_child_count))} opciones declaradas · ${escapeHtml(radarCountText(item.provider_accounted_child_count))} contabilizadas · ${escapeHtml(radarCountText(item.provider_identified_child_count))} identificadas · ${escapeHtml(radarCountText(item.provider_unresolved_child_count))} pendientes de identidad.</p>
          <p>${item.provider_pagination_exhausted === true ? "Paginación del proveedor agotada." : "La paginación del proveedor todavía no está agotada."}${item.next_retry_at ? ` Próximo reintento: ${escapeHtml(displayDate(item.next_retry_at))}.` : ""}</p>
          ${radarReconciliationIssueMarkup(item.issue)}
          <div class="radar-reconciliation-links">${item.id ? `<button class="primary-button" type="button" data-radar-reconciliation="${escapeHtml(item.id)}" aria-haspopup="dialog" aria-controls="radar-reconciliation-detail">Ver reconciliación</button>` : ""}${externalLink(item.external_parent_url, "Abrir evento original")}</div>
        </article>`;
      }).join("")}</div>${pagination}
    </section>`;
  }

  function radarReconciliationDetailMarkup(reconciliation) {
    if (!reconciliation) return "";
    const children = Array.isArray(reconciliation.children) ? reconciliation.children : [];
    const canonicalTitle = String(reconciliation.canonical_parent_label || "").trim();
    const title = canonicalTitle || "Identidad canónica del padre pendiente";
    const parentSources = Array.isArray(reconciliation.source_refs) ? reconciliation.source_refs : [];
    return `<section class="radar-candidate-detail" id="radar-reconciliation-detail" role="dialog" aria-modal="false" aria-labelledby="radar-reconciliation-detail-title" tabindex="-1">
      <header><div><p class="eyebrow">Detalle técnico bajo demanda</p><h2 id="radar-reconciliation-detail-title">${escapeHtml(title)}</h2></div><button class="secondary-button" type="button" data-radar-close-reconciliation>Cerrar</button></header>
      <div class="radar-detail-grid"><section><h3>Recuento autoritativo</h3><dl>
        <div><dt>ID del padre</dt><dd><code>${escapeHtml(reconciliation.provider_parent_id || "No disponible")}</code></dd></div>
        <div><dt>Título original</dt><dd>${escapeHtml(reconciliation.raw_provider_parent_label || "No disponible")}</dd></div>
        <div><dt>Título canónico Atinara</dt><dd>${escapeHtml(canonicalTitle || "No disponible")}</dd></div>
        <div><dt>Declaradas</dt><dd>${escapeHtml(radarCountText(reconciliation.provider_declared_child_count))}</dd></div>
        <div><dt>Descubiertas</dt><dd>${escapeHtml(radarCountText(reconciliation.provider_discovered_child_count))}</dd></div>
        <div><dt>Contabilizadas</dt><dd>${escapeHtml(radarCountText(reconciliation.provider_accounted_child_count))}</dd></div>
        <div><dt>Identificadas</dt><dd>${escapeHtml(radarCountText(reconciliation.provider_identified_child_count))}</dd></div>
        <div><dt>Pendientes</dt><dd>${escapeHtml(radarCountText(reconciliation.provider_unresolved_child_count))}</dd></div>
        <div><dt>Cerradas</dt><dd>${escapeHtml(radarCountText(reconciliation.provider_closed_child_count))}</dd></div>
        <div><dt>Eliminadas verificadas</dt><dd>${escapeHtml(radarCountText(reconciliation.provider_removed_child_count))}</dd></div>
        <div><dt>Duplicadas</dt><dd>${escapeHtml(radarCountText(reconciliation.provider_duplicate_child_count))}</dd></div>
        <div><dt>Conflictos</dt><dd>${escapeHtml(radarCountText(reconciliation.provider_conflict_child_count))}</dd></div>
        <div><dt>Nuevas</dt><dd>${escapeHtml(radarCountText(reconciliation.new_child_count))}</dd></div>
      </dl></section><section><h3>Contrato</h3><dl>
        <div><dt>Estado</dt><dd>${escapeHtml(RADAR_RECONCILIATION_LABELS[reconciliation.reconciliation_status] || reconciliation.reconciliation_status)}</dd></div>
        <div><dt>Versión</dt><dd><code>${escapeHtml(reconciliation.reconciliation_version)}</code></dd></div>
        <div><dt>Fingerprint</dt><dd><code>${escapeHtml(reconciliation.reconciliation_fingerprint)}</code></dd></div>
        <div><dt>Paginación agotada</dt><dd>${reconciliation.provider_pagination_exhausted === true ? "Sí" : "No"}</dd></div>
        <div><dt>Próximo reintento</dt><dd>${reconciliation.next_retry_at ? escapeHtml(displayDate(reconciliation.next_retry_at)) : "No programado"}</dd></div>
      </dl>${radarIdentityEvidenceMarkup(parentSources)}</section></div>
      ${radarReconciliationIssueMarkup(reconciliation.issue)}
      <section class="radar-reconciliation-children" aria-label="Hijas reconciliadas"><div class="radar-reconciliation-grid">${children.map((child) => `<article class="radar-reconciliation-card">
        <header><div><strong>${escapeHtml(child.canonical_child_label || "Identidad pendiente")}</strong></div><span>${escapeHtml(RADAR_CHILD_AVAILABILITY_LABELS[child.availability_status] || "Estado no disponible")}</span></header>
        <p><strong>Etiqueta original:</strong> ${escapeHtml(child.raw_provider_child_label || "No disponible")}</p>
        <p><strong>Clave canónica:</strong> <code>${escapeHtml(child.canonical_child_key || "No disponible")}</code></p>
        <p><strong>ID externo:</strong> <code>${escapeHtml(child.external_market_id || "No disponible")}</code>${child.condition_id ? ` · condición <code>${escapeHtml(child.condition_id)}</code>` : ""}</p>
        <p><strong>Evento:</strong> <code>${escapeHtml(child.event_id || child.event_slug || "No disponible")}</code></p>
        <p>${escapeHtml(RADAR_CHILD_CLASSIFICATION_LABELS[child.identity_classification] || "Clasificación no disponible")} · ${escapeHtml(child.identity_status === "resolved" ? "Identidad resuelta" : child.identity_status === "unresolved_placeholder" ? "Identidad pendiente" : child.identity_status === "duplicate" ? "Duplicada" : child.identity_status === "removed" ? "Eliminada" : "En conflicto")}</p>
        <p><strong>Transición:</strong> ${escapeHtml(RADAR_CHILD_TRANSITION_LABELS[child.transition] || "No disponible")} · actual: ${child.present_in_current_snapshot === true ? "sí" : "no"} · histórica: ${child.present_in_legacy_snapshot === true ? "sí" : "no"}</p>
        <p><strong>Fuente de identidad:</strong> ${escapeHtml(child.identity_source || "Fuente de identidad no disponible")}${radarIntegerCount(child.identity_confidence) !== null ? ` · ${escapeHtml(radarIntegerCount(child.identity_confidence))} %` : ""}</p>
        ${Array.isArray(child.token_ids) && child.token_ids.length ? `<p><strong>Contratos del proveedor:</strong> ${child.token_ids.map((token) => `<code>${escapeHtml(token)}</code>`).join(" · ")}</p>` : ""}
        ${radarIdentityEvidenceMarkup(child.identity_evidence)}
      </article>`).join("")}</div></section>
    </section>`;
  }

  function radarDetailMarkup(candidate) {
    if (!candidate) return "";
    const scores = candidate.score_breakdown || {};
    const warnings = Array.isArray(candidate.warnings) ? candidate.warnings : [];
    const missing = Array.isArray(candidate.missing_fields) ? candidate.missing_fields : [];
    const duplicates = Array.isArray(candidate.duplicate_matches) ? candidate.duplicate_matches : [];
    const siblings = Array.isArray(candidate.family_matches) ? candidate.family_matches : [];
    const tags = Array.isArray(candidate.source_tags) ? candidate.source_tags : [];
    const currentExpertRun = expertRun(candidate.expert_analysis);
    const candidateReady = radarCandidateReady(candidate);
    const terminalCandidate = radarCandidateIsTerminal(candidate);
    const placeholderCandidate = radarCandidateIsPlaceholder(candidate);
    const identityOrReconciliationBlocked = !radarCandidatePolicyCurrent(candidate)
      || !radarParentComplete(candidate) || !radarCanonicalChildProjectionValid(candidate);
    const domainReviewRequired = radarCandidateDispositionCode(candidate) === "GAMING_DOMAIN_REVIEW_REQUIRED";
    const humanDomainReview = candidate.human_domain_review && typeof candidate.human_domain_review === "object"
      ? candidate.human_domain_review : null;
    const domainReviewActionable = domainReviewRequired || Boolean(humanDomainReview?.request_id);
    const domainEvidence = Array.isArray(humanDomainReview?.evidence_refs)
      ? humanDomainReview.evidence_refs : [];
    const continuationAction = placeholderCandidate || identityOrReconciliationBlocked
        ? `<button class="secondary-button" type="button" data-radar-refresh>Volver a comprobar el proveedor</button><span>La identidad o la reconciliación del padre debe completarse antes del Editor y del borrador.</span>`
        : terminalCandidate
          ? `<span>Condición terminal auditada: no se enviará al Editor ni se creará un borrador.</span>`
        : domainReviewRequired
          ? `<span>La pertenencia temática necesita una decisión humana explícita antes de renovar la elegibilidad.</span>`
          : candidateReady
            ? `<button class="primary-button" type="button" data-radar-prepare="${escapeHtml(candidate.id)}">Preparar borrador</button>`
            : `<button class="primary-button" type="button" data-radar-prepare="${escapeHtml(candidate.id)}">Renovar elegibilidad y continuar</button>`;
    return `<section class="radar-candidate-detail" role="dialog" aria-modal="false" aria-labelledby="radar-detail-title" tabindex="-1">
      <header><div><p class="eyebrow">Detalle privado de la candidata</p><h2 id="radar-detail-title">${escapeHtml(radarCandidateHeading(candidate))}</h2></div><button class="secondary-button" type="button" data-radar-close-detail>Cerrar</button></header>
      <div class="radar-detail-grid">
        <section><h3>Procedencia</h3><dl>
          <div><dt>Proveedor</dt><dd>${escapeHtml(RADAR_PROVIDER_LABELS[candidate.provider] || candidate.provider)}</dd></div>
          <div><dt>ID externo</dt><dd><code>${escapeHtml(candidate.external_id)}</code></dd></div>
          <div><dt>Título original</dt><dd>${escapeHtml(candidate.source_title || "No disponible")}</dd></div>
          <div><dt>Pregunta original</dt><dd>${escapeHtml(candidate.source_question || "No disponible")}</dd></div>
          <div><dt>Etiqueta original del proveedor</dt><dd>${escapeHtml(radarOriginalChildLabel(candidate) || "No diferenciada en el campo estructurado")}</dd></div>
          <div><dt>Identidad canónica Atinara</dt><dd>${escapeHtml(radarCanonicalChildLabel(candidate) || "Proyección canónica pendiente")}</dd></div>
          <div><dt>Fuente de identidad</dt><dd>${escapeHtml(candidate.identity_source || "No disponible")}${Number.isFinite(Number(candidate.identity_confidence)) ? ` · ${escapeHtml(candidate.identity_confidence)} %` : ""}</dd></div>
          <div><dt>Estado y fechas</dt><dd>${escapeHtml(providerStatusLabel(candidate.source_status))} · ${escapeHtml(displayDate(candidate.source_close_at))}</dd></div>
          ${candidate.source_result ? `<div><dt>Resultado del proveedor</dt><dd>${escapeHtml(providerResultLabel(candidate.source_result))}</dd></div>` : ""}
        </dl><div class="radar-source-links">${externalLink(candidate.external_event_url, "Abrir evento original", "primary")}${externalLink(candidate.external_market_url, "Abrir mercado original", "primary")}</div></section>
        <section><h3>Reglas y fuentes</h3><p>${escapeHtml(candidate.source_resolution_rules || "La fuente no ofrece reglas completas.")}</p>${externalLink(candidate.atinara_resolution_source_url || candidate.source_resolution_url, "Abrir fuente de resolución")}</section>
        <section><h3>Métricas externas</h3><dl>
          <div><dt>Probabilidad de referencia</dt><dd>${escapeHtml(displayProbability(candidate.source_probability_yes))}</dd></div>
          <div><dt>Volumen 24 h</dt><dd>${escapeHtml(displayNumber(candidate.source_volume_24h))}</dd></div>
          <div><dt>Volumen total</dt><dd>${escapeHtml(displayNumber(candidate.source_volume_total))}</dd></div>
          <div><dt>Liquidez</dt><dd>${escapeHtml(displayNumber(candidate.source_liquidity))}</dd></div>
          <div><dt>Interés abierto</dt><dd>${escapeHtml(displayNumber(candidate.source_open_interest))}</dd></div>
        </dl><p class="radar-reference-note">Estas métricas son solo referencia administrativa y nunca alteran precios, Karma o participaciones de Atinara.</p></section>
        <section><h3>Adaptación propuesta</h3><p><strong>Categoría:</strong> ${escapeHtml(candidate.atinara_category || "Requiere revisión")}</p><p>${escapeHtml(candidate.source_description || "Sin contexto adaptado.")}</p><p><strong>Criterios:</strong> ${escapeHtml(candidate.atinara_resolution_criteria || "Requieren revisión humana.")}</p></section>
        <section><h3>Elegibilidad de la candidata</h3><dl>
          <div><dt>Estado</dt><dd>${escapeHtml(radarVerificationLabel(candidate))}</dd></div>
          <div><dt>Motivo</dt><dd>${escapeHtml(candidate.eligibility_state_preserved === true
            ? radarEligibilityCurrent(candidate)
              ? "La última elegibilidad válida sigue vigente; el enriquecimiento más reciente se reintentará."
              : "Se conserva el último expediente conocido, pero su elegibilidad ya no está vigente y debe renovarse."
            : candidate.verification_status === "verified_open" ? "Mercado predictivo válido" : radarReasonLabel(candidate.verification_reason_code))}</dd></div>
          <div><dt>Comprobada</dt><dd>${escapeHtml(displayDate(candidate.eligibility_checked_at || candidate.verified_at))}</dd></div>
          <div><dt>Vigente hasta</dt><dd>${escapeHtml(displayDate(candidate.eligibility_expires_at || candidate.verification_expires_at))}</dd></div>
        </dl><p>${escapeHtml(radarReasonDescription(candidate))}</p></section>
        <section><h3>Atinara Score</h3><dl>${Object.entries(scores).map(([key, value]) => `<div><dt>${escapeHtml(RADAR_SCORE_LABELS[key] || "Criterio adicional")}</dt><dd>${escapeHtml(value)}</dd></div>`).join("")}</dl><p>No es una predicción científica: ordena candidatas con criterios transparentes.</p></section>
        <section><h3>Revisión necesaria</h3>
          ${warnings.length ? `<ul>${warnings.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>` : "<p>Sin advertencias registradas.</p>"}
          ${missing.length ? `<p><strong>Campos sin información:</strong> ${escapeHtml(missing.join(", "))}</p>` : ""}
          ${candidate.family_key ? radarCanonicalChildProjectionValid(candidate)
            ? `<p><strong>Familia:</strong> ${escapeHtml(candidate.family_title || candidate.family_key)} · <code>${escapeHtml(candidate.family_child_key)}</code></p>`
            : `<p><strong>Proyección bloqueada:</strong> la identidad hija no cumple el contrato canónico vigente.</p>` : ""}
          ${siblings.length ? `<p><strong>Mercados hermanos permitidos:</strong> ${escapeHtml(siblings.length)}. Comparten acontecimiento, pero conservan opción, precio y economía independientes.</p>` : ""}
          ${duplicates.length ? `<ul>${duplicates.map((item) => `<li><strong>${escapeHtml(item.relationship || "exact_duplicate")}</strong> · ${escapeHtml(item.question || item.id || "Mercado existente")}</li>`).join("")}</ul>` : "<p>Sin duplicados exactos ni semánticos.</p>"}
          ${tags.length ? `<p><strong>Tags:</strong> ${escapeHtml(tags.join(", "))}</p>` : ""}
          ${humanDomainReview ? `<div class="admin-workflow-note"><strong>Última decisión humana:</strong> ${escapeHtml(humanDomainReview.decision === "out_of_domain" ? "Fuera del ámbito" : "Dentro del ámbito")}<p>${escapeHtml(humanDomainReview.rationale || "Sin explicación disponible.")}</p>${domainEvidence.length ? `<ul>${domainEvidence.map((reference) => `<li>${externalLink(reference.url, reference.role === "DOMAIN_CONTEXT" ? "Abrir evidencia de dominio" : "Abrir fuente revisada")}</li>`).join("")}</ul>` : ""}<small>La corrección crea una nueva atestación y conserva la anterior en el historial.</small></div>` : ""}
          ${domainReviewActionable ? `<label><span>${humanDomainReview ? "Justificación de la corrección" : "Justificación de dominio"}</span><textarea name="radar_domain_rationale" minlength="20" maxlength="1000" placeholder="Explica qué evidencia permite clasificar esta candidata sin depender de una coincidencia textual."></textarea></label><div class="admin-gate-actions"><button class="primary-button" type="button" data-radar-domain-decision="in_domain">Confirmar dentro del ámbito</button><button class="secondary-button" type="button" data-radar-domain-decision="out_of_domain">Marcar fuera del ámbito</button></div>` : ""}
        </section>
        <section><h3>Agente Editor</h3>${identityOrReconciliationBlocked
          ? `<p>No se ejecuta mientras la identidad canónica o el padre permanezcan incompletos.</p>`
          : currentExpertRun
          ? `<p><strong>${escapeHtml(EXPERT_DECISION_LABELS[currentExpertRun.result_json?.decision] || "Dictamen disponible")}</strong></p><p>${escapeHtml(currentExpertRun.result_json?.summary || "Análisis estructurado guardado sin modificar el Radar.")}</p>`
          : `<p>Análisis opcional y aditivo. No cambia la aptitud ni la política determinista del Radar.</p>`}</section>
        <section><h3>Agente de fuentes</h3>${radarAgentExecutionMarkup(candidate)}</section>
      </div>
      <footer>${terminalCandidate || placeholderCandidate || identityOrReconciliationBlocked || domainReviewRequired ? "" : `<button class="secondary-button" type="button" data-radar-expert="${escapeHtml(candidate.id)}">${currentExpertRun ? "Reanalizar con el Agente Editor" : "Analizar con el Agente Editor"}</button>`}${continuationAction}</footer>
    </section>`;
  }

  async function reviewRadarDomain(decision) {
    const candidate = state.radar.selected;
    if (!candidate || state.busy || !["in_domain", "out_of_domain"].includes(decision)) return;
    const rationale = document.querySelector('[name="radar_domain_rationale"]')?.value.trim() || "";
    if (rationale.length < 20) {
      setNotice("La revisión de dominio necesita una justificación de al menos 20 caracteres.", "warning");
      renderWorkspace();
      document.querySelector('[name="radar_domain_rationale"]')?.focus();
      return;
    }
    if (decision === "out_of_domain" && !window.confirm("Esta decisión bloqueará la candidata como terminal. Confirma que la evidencia enlazada demuestra que queda fuera del ámbito gaming.")) {
      return;
    }
    const supersedesRequestId = candidate.human_domain_review?.request_id || null;
    const material = `${candidate.preparation_revision}:${candidate.fingerprint}:${decision}:${rationale}`;
    const storageKey = `${DOMAIN_REVIEW_KEY_PREFIX}:${candidate.id}`;
    let operationId = domainReviewOperationIds.get(storageKey)?.material === material
      ? domainReviewOperationIds.get(storageKey).requestId : "";
    if (!operationId) {
      try {
        const stored = JSON.parse(sessionStorage.getItem(storageKey) || "null");
        if (stored?.material === material && /^[0-9a-f-]{36}$/i.test(stored?.requestId || "")) {
          operationId = stored.requestId;
        }
      } catch { /* La memoria de la pestaña conserva la intención. */ }
    }
    if (!operationId) operationId = crypto.randomUUID();
    const intent = { material, requestId: operationId };
    domainReviewOperationIds.set(storageKey, intent);
    try { sessionStorage.setItem(storageKey, JSON.stringify(intent)); } catch { /* Memoria en proceso. */ }
    state.busy = true;
    renderWorkspace();
    try {
      await invokeRadar("review-domain", {
        candidate_id: candidate.id,
        expected_revision: candidate.preparation_revision,
        expected_fingerprint: candidate.fingerprint,
        decision,
        rationale,
        evidence_refs: [{
          url: candidate.external_event_url || candidate.external_market_url || "",
          role: "DOMAIN_CONTEXT"
        }],
        operation_id: operationId,
        supersedes_request_id: supersedesRequestId
      });
      domainReviewOperationIds.delete(storageKey);
      try { sessionStorage.removeItem(storageKey); } catch { /* El resultado ya es autoritativo. */ }
      await loadRadar(false);
      setNotice(decision === "in_domain"
        ? "Revisión de dominio registrada. Renueva ahora la elegibilidad antes de preparar el borrador."
        : "Revisión de dominio registrada. La candidata permanece fuera del flujo de borradores.", "success");
    } catch (error) {
      setNotice(helpers.getFriendlyError(error, "No se pudo registrar la revisión de dominio."), "error");
    } finally {
      state.busy = false;
      renderWorkspace();
      focusActionStatus();
    }
  }

  function radarMarkup() {
    const groups = (Array.isArray(state.radar.groups) ? state.radar.groups : [])
      .map(radarCurrentGroupProjection).filter(Boolean);
    const cards = groups.length
      ? `<div class="radar-candidate-grid">${groups.map((group, index) => radarGroupMarkup(group, index)).join("")}</div>`
      : `<div class="admin-empty-state radar-empty"><strong>No hay eventos con estos filtros</strong><span>Actualiza las fuentes o cambia categoría, consulta u horizonte. No se inventan mercados para llenar este estado.</span></div>`;
    const operationalSummary = radarOperationalSummaryMarkup();
    const page = state.radar.page || {};
    const previousOffset = state.radar.parentOffsetHistory.length
      ? state.radar.parentOffsetHistory[state.radar.parentOffsetHistory.length - 1] : null;
    const pageMarkup = (Number(page.parent_offset) > 0 || page.next_parent_offset !== null) ? `<nav class="radar-page-controls" aria-label="Páginas de eventos Radar">
      ${previousOffset !== null ? `<button class="secondary-button" type="button" data-radar-page-previous>Eventos anteriores</button>` : ""}
      <span>Mostrando ${escapeHtml(groups.length)} de ${escapeHtml(page.parent_count || groups.length)} padres aptos para catálogo.</span>
      ${page.next_parent_offset !== null ? `<button class="secondary-button" type="button" data-radar-page="${escapeHtml(page.next_parent_offset)}">Eventos siguientes</button>` : ""}
    </nav>` : "";
    const quarantinedRows = state.radar.qualityNotices.flatMap((notice) =>
      (Array.isArray(notice.quarantined) ? notice.quarantined : []).map((item) => ({
        ...item,
        provider: item.provider || notice.provider
      }))
    );
    const qualityNotices = state.radar.qualityNotices.length
      ? `<details class="radar-quality-summary"><summary>Candidatas descartadas o en cuarentena · ${escapeHtml(state.radar.qualityNotices.reduce((total, notice) => total + (Number(notice.quarantined_count) || 0), 0))}</summary><ul>${state.radar.qualityNotices.map((notice) => `<li>${escapeHtml(RADAR_PROVIDER_LABELS[notice.provider] || notice.provider)}: ${escapeHtml(notice.message || "La fila no superó la validación de contenido.")}</li>`).join("")}</ul>${quarantinedRows.length ? `<h4>Causas consultables</h4><ul class="radar-quality-causes">${quarantinedRows.map((item) => `<li><strong>${escapeHtml(RADAR_PROVIDER_LABELS[item.provider] || item.provider)} · ${escapeHtml(item.external_id || "Identificador no disponible")}</strong><span>${escapeHtml(RADAR_QUARANTINE_DESCRIPTIONS[item.code] || RADAR_QUARANTINE_DESCRIPTIONS.RADAR_CANDIDATE_DATA_INVALID)}</span></li>`).join("")}</ul>` : ""}<p>Estos descartes no degradan la disponibilidad operativa del proveedor.</p></details>`
      : "";
    return `<section class="market-radar" aria-labelledby="market-radar-title">
      <header class="radar-heading"><div><p class="eyebrow">Administración · descubrimiento privado</p><h2 id="market-radar-title">Radar de mercados</h2><p>Descubre oportunidades gaming reales y prepara el formulario existente. Ninguna candidata se publica ni se aprueba automáticamente.</p></div><span class="radar-cache-badge">${state.radar.requiresEligibilityRefresh ? "Elegibilidad pendiente" : state.radar.cachedAuthoritative ? "Última consulta vigente" : "Fuentes actualizadas"}</span></header>
      ${radarFiltersMarkup()}
      ${radarProviderMarkup()}
      ${operationalSummary}
      ${qualityNotices}
      ${radarReconciliationMarkup()}
      <div class="radar-results-heading"><h3>${escapeHtml(groups.length)} eventos · ${escapeHtml(state.radar.candidates.length)} opciones</h3><p>Una tarjeta por evento padre. Las probabilidades y métricas externas son solo referencia administrativa.</p></div>
      ${cards}
      ${pageMarkup}
      ${radarRejectionsMarkup()}
      ${radarDetailMarkup(state.radar.selected)}
      ${radarReconciliationDetailMarkup(state.radar.selectedReconciliation)}
    </section>`;
  }

  function observatoryProviderMarkup() {
    const latestRuns = Array.isArray(state.observatory.dashboard.provider_runs) ? state.observatory.dashboard.provider_runs : [];
    return `<section class="observatory-provider-grid" aria-label="Estado de proveedores y agentes">
      ${state.observatory.providers.map((provider) => {
        const latest = latestRuns.find((run) => run.provider === provider.provider);
        const configured = provider.configured === true;
        const status = provider.status === "deterministic_only" ? "Puerta determinista disponible" : provider.status === "scheduler_disabled" ? "Programación desactivada" : configured ? "Configurado" : "No configurado";
        return `<article class="observatory-provider-card" data-status="${escapeHtml(configured ? "configured" : provider.status || "not_configured")}">
          <div><strong>${escapeHtml(OBSERVATORY_PROVIDER_LABELS[provider.provider] || provider.provider)}</strong><span>${escapeHtml(status)}</span></div>
          <small>${latest ? `${escapeHtml(displayDate(latest.completed_at || latest.created_at))} · ${escapeHtml(latest.is_cached ? "Caché" : latest.status || "Última consulta")}` : "Sin consulta registrada"}</small>
          ${provider.policy_version ? `<code>${escapeHtml(provider.policy_version)}</code>` : ""}
        </article>`;
      }).join("")}
    </section>`;
  }

  function observatorySearchMarkup() {
    const results = state.observatory.searchResults.length
      ? `<ul class="observatory-search-results">${state.observatory.searchResults.map((item) => `<li>
          <div><strong>${escapeHtml(item.label)}</strong><span>${escapeHtml(OBSERVATORY_PROVIDER_LABELS[item.provider] || item.provider)} · ${escapeHtml(item.entity_type)}</span></div>
          ${externalLink(item.canonical_url, "Abrir fuente")}
          <button class="primary-button" type="button" data-observatory-add="${escapeHtml(item.external_id)}">Seguir fuente</button>
        </li>`).join("")}</ul>`
      : "";
    return `<section class="observatory-watch-search" aria-labelledby="observatory-watch-title">
      <div class="admin-section-heading"><div><p class="eyebrow">Fuentes seguidas</p><h3 id="observatory-watch-title">Añadir una entidad pública</h3></div><p>La búsqueda es manual y limitada. YouTube consume cuota únicamente cuando la solicitas.</p></div>
      <form id="observatory-search-form" class="observatory-search-form">
        <label><span>Proveedor</span><select name="provider">
          <option value="igdb"${state.observatory.searchProvider === "igdb" ? " selected" : ""}>IGDB</option>
          <option value="twitch"${state.observatory.searchProvider === "twitch" ? " selected" : ""}>Twitch</option>
          <option value="youtube"${state.observatory.searchProvider === "youtube" ? " selected" : ""}>YouTube</option>
        </select></label>
        <label class="field-wide"><span>Juego, empresa, canal o ID público</span><input type="search" name="query" minlength="2" maxlength="200" value="${valueAttribute(state.observatory.searchQuery)}" required></label>
        <button class="secondary-button" type="submit"${disabled()}>Buscar en la API</button>
      </form>
      <button class="secondary-button" type="button" data-observatory-top-games${disabled()}>Ver juegos destacados de Twitch</button>
      ${results}
    </section>`;
  }

  function observatoryOfficialDiscoveryMarkup() {
    const discovery = state.observatory.officialDiscovery;
    const result = discovery.result;
    const discoveryBusy = discovery.inFlight === true;
    const resultMarkup = result ? `<p class="observatory-official-result" role="status"><strong>${escapeHtml(result.saved || 0)} oportunidad(es) guardada(s) como señales privadas.</strong><span>${escapeHtml(result.inspected_documents || 0)} páginas oficiales inspeccionadas · ${escapeHtml(result.structured_candidates || 0)} candidatos estructurados · ${escapeHtml(result.rejected_candidates || 0)} descartados. ${result.outcome === "partial" ? "La consulta terminó con incidencias parciales." : result.outcome === "technical_failure" ? "La consulta terminó con un fallo técnico seguro." : result.outcome === "zero_results" ? "La consulta terminó sin resultados válidos nuevos." : "La consulta terminó sin incidencias de transporte."}</span></p>` : "";
    return `<section class="observatory-official-discovery" aria-labelledby="observatory-official-title">
      <div class="admin-section-heading"><div><p class="eyebrow">Official Opportunity Discovery V1</p><h3 id="observatory-official-title">Descubrir acontecimientos oficiales</h3></div><p>Busca solo en dominios primarios activos del registro. Twitch, YouTube o X participan únicamente si su fuente oficial está registrada y publica una fecha futura estructurada.</p></div>
      <form id="observatory-official-discovery-form" class="observatory-official-form" aria-busy="${discoveryBusy ? "true" : "false"}">
        <label class="field-wide"><span>Acontecimiento, producto u organización</span><input type="search" name="query" minlength="3" maxlength="200" value="${valueAttribute(discovery.query)}" placeholder="Ej.: Nintendo Direct, The Game Awards" required></label>
        <label><span>Categoría</span><select name="category">${RADAR_CATEGORIES.map((category) => `<option value="${valueAttribute(category)}"${discovery.category === category ? " selected" : ""}>${escapeHtml(category)}</option>`).join("")}</select></label>
        <label><span>Horizonte</span><select name="horizon_days">${[30, 90, 180, 365].map((days) => `<option value="${days}"${Number(discovery.horizonDays) === days ? " selected" : ""}>${days} días</option>`).join("")}</select></label>
        <label><span>Zona horaria IANA</span><input name="timezone" maxlength="100" value="${valueAttribute(discovery.timezone)}" placeholder="Europe/Madrid" required></label>
        <button class="primary-button" type="submit"${state.busy || discoveryBusy ? " disabled" : ""}>${discoveryBusy ? "Buscando…" : "Buscar oportunidades oficiales"}</button>
      </form>
      <p class="admin-status-message" role="status" aria-live="polite">${discoveryBusy ? "La búsqueda oficial está en curso. Esta intención no puede enviarse dos veces." : "Listo para una nueva búsqueda manual."}</p>
      <p class="admin-gate-rule">Esta acción no invoca un modelo de IA, no crea borradores y no guarda mercados. Después podrás revisar la señal, pedir el análisis del Agente Editor y aplicar manualmente su propuesta al formulario.</p>
      ${resultMarkup}
    </section>`;
  }

  function observatoryWatchlistMarkup() {
    const entities = Array.isArray(state.observatory.dashboard.entities) ? state.observatory.dashboard.entities : [];
    const cards = entities.length ? entities.map((entity) => `<article class="observatory-watch-card">
      <div><span class="radar-provider-badge">${escapeHtml(OBSERVATORY_PROVIDER_LABELS[entity.provider] || entity.provider)}</span><strong>${escapeHtml(entity.label)}</strong><small>${escapeHtml(entity.entity_type)} · ${escapeHtml(entity.health_status || "Sin comprobar")}</small></div>
      <div>${externalLink(entity.canonical_url, "Abrir")}
        <button class="secondary-button" type="button" data-observatory-pause="${escapeHtml(entity.id)}">Pausar</button>
      </div>
    </article>`).join("") : `<div class="admin-empty-state"><strong>No hay fuentes seguidas</strong><span>Añade una entidad pública mediante la búsqueda. No se realiza rastreo global.</span></div>`;
    return `<section class="observatory-watchlist" aria-label="Lista de fuentes seguidas"><div class="observatory-watch-grid">${cards}</div></section>`;
  }

  function observatoryFiltersMarkup() {
    return `<form id="observatory-filters" class="observatory-filters">
      <label><span>Proveedor</span><select name="provider"><option value="all">Todos</option>${["official_web", "igdb", "twitch", "youtube"].map((provider) => `<option value="${provider}"${state.observatory.provider === provider ? " selected" : ""}>${escapeHtml(OBSERVATORY_PROVIDER_LABELS[provider])}</option>`).join("")}</select></label>
      <label><span>Aptitud</span><select name="marketability"><option value="">Todas</option>${["pending", "useful", "needs_review", "insufficient_history", "policy_blocked", "rejected"].map((status) => `<option value="${status}"${state.observatory.marketability === status ? " selected" : ""}>${escapeHtml(observatoryStatusLabel(status))}</option>`).join("")}</select></label>
      <label><span>Análisis experto</span><select name="expertStatus"><option value="">Todos</option>${["not_requested", "pending", "completed", "failed", "stale"].map((status) => `<option value="${status}"${state.observatory.expertStatus === status ? " selected" : ""}>${escapeHtml(observatoryExpertLabel(status))}</option>`).join("")}</select></label>
      <label class="field-wide"><span>Buscar</span><input type="search" name="query" value="${valueAttribute(state.observatory.query)}" placeholder="Entidad, señal o categoría"></label>
      <button class="secondary-button" type="submit">Aplicar filtros</button>
      <button class="primary-button" type="button" data-observatory-refresh${disabled()}>${state.busy ? "Actualizando…" : "Actualizar fuentes seguidas"}</button>
    </form>`;
  }

  function observatoryStatusLabel(status) {
    return ({ pending: "Pendiente", useful: "Útil", needs_review: "Revisión necesaria", insufficient_history: "Historial insuficiente", not_interesting: "Interés insuficiente", already_resolved: "Resultado conocido", incoherent: "Incoherente", unsupported_metric: "Métrica no compatible", unverifiable: "No verificable", duplicate: "Duplicada", policy_blocked: "Bloqueada por política", rejected: "Descartada" })[status] || status || "Pendiente";
  }

  function observatoryExpertLabel(status) {
    return ({ not_requested: "No solicitado", pending: "En curso", completed: "Completado", failed: "Fallido", stale: "Caducado" })[status] || status || "No solicitado";
  }

  function observatorySignalCard(signal) {
    const officialOpportunity = signal.provider === "official_web";
    const metric = officialOpportunity
      ? displayDate(signal.time_window_end)
      : signal.metric_value === null || signal.metric_value === undefined
      ? "Dato no disponible"
      : `${displayNumber(signal.metric_value)}${signal.metric_unit ? ` ${escapeHtml(signal.metric_unit)}` : ""}`;
    const analysisBlocked = officialOpportunity && signal.marketability_status === "duplicate";
    return `<article class="observatory-signal-card" data-marketability="${escapeHtml(signal.marketability_status)}">
      <header><div><span class="radar-provider-badge">${escapeHtml(OBSERVATORY_PROVIDER_LABELS[signal.provider] || signal.provider)}</span><span>${escapeHtml(signal.atinara_category || signal.signal_type)}</span></div><time>${escapeHtml(displayDate(signal.observed_at))}</time></header>
      <h3>${escapeHtml(signal.title)}</h3>
      <dl><div><dt>${officialOpportunity ? "Corte propuesto" : "Dato observado"}</dt><dd>${escapeHtml(metric)}</dd></div><div><dt>Aptitud</dt><dd>${escapeHtml(observatoryStatusLabel(signal.marketability_status))}</dd></div><div><dt>Resolución</dt><dd>${escapeHtml(signal.resolution_readiness || "Pendiente")}</dd></div><div><dt>Agente Editor</dt><dd>${escapeHtml(observatoryExpertLabel(signal.expert_analysis_status))}</dd></div></dl>
      <p class="observatory-factual"><strong>Hecho observado:</strong> ${escapeHtml(signal.factual_basis || "La fuente no aporta todavía una descripción factual suficiente.")}</p>
      ${signal.inference_summary ? `<p class="observatory-inference"><strong>Inferencia editorial:</strong> ${escapeHtml(signal.inference_summary)}</p>` : ""}
      <footer>${externalLink(signal.canonical_url, "Abrir origen")}
        <button class="secondary-button" type="button" data-observatory-details="${escapeHtml(signal.id)}">Ver análisis</button>
        <button class="primary-button" type="button" data-observatory-analyze="${escapeHtml(signal.id)}"${analysisBlocked ? " disabled" : ""}>${analysisBlocked ? "Duplicada" : signal.expert_analysis_status === "completed" ? "Reanalizar" : "Analizar"}</button>
        <button class="secondary-button" type="button" data-observatory-dismiss="${escapeHtml(signal.id)}">Descartar</button>
      </footer>
    </article>`;
  }

  function observatoryDetailMarkup(detail) {
    if (!detail) return "";
    const signal = detail.signal || {};
    const run = detail.expert_analysis || {};
    const verdict = run.result_json || {};
    const proposal = verdict.proposal || {};
    const contract = verdict.resolution_contract || signal.suggested_resolution_contract || {};
    const sources = Array.isArray(contract.sources) ? contract.sources : [];
    const hypotheses = Array.isArray(detail.hypotheses) ? detail.hypotheses : [];
    const reasonCodes = Array.isArray(verdict.reason_codes) ? verdict.reason_codes : [];
    return `<section class="observatory-detail" role="dialog" aria-modal="false" aria-labelledby="observatory-detail-title" tabindex="-1">
      <header><div><p class="eyebrow">Expediente privado · sin cadena de pensamiento</p><h2 id="observatory-detail-title">${escapeHtml(signal.title || "Detalle de señal")}</h2></div><button class="secondary-button" type="button" data-observatory-close>Cerrar</button></header>
      <div class="observatory-detail-grid">
        <section><h3>Dato observado</h3><p>${escapeHtml(signal.factual_basis || "No disponible")}</p><dl><div><dt>Proveedor</dt><dd>${escapeHtml(OBSERVATORY_PROVIDER_LABELS[signal.provider] || signal.provider)}</dd></div><div><dt>Métrica</dt><dd>${escapeHtml(signal.metric_name || "No aplica")}</dd></div><div><dt>Valor</dt><dd>${signal.metric_value === null || signal.metric_value === undefined ? "Ausente; no equivale a cero" : escapeHtml(displayNumber(signal.metric_value))}</dd></div></dl></section>
        <section><h3>Contexto documentado</h3><p>${escapeHtml(signal.contextual_basis || "Todavía no existe contexto suficiente.")}</p><p><strong>Por qué ahora:</strong> ${escapeHtml(verdict.why_now || signal.why_now || "Pendiente de análisis")}</p><p><strong>Cuestión abierta:</strong> ${escapeHtml(verdict.unresolved_question || signal.unresolved_question || "Pendiente de análisis")}</p></section>
        <section><h3>Dictamen experto</h3><dl><div><dt>Decisión</dt><dd>${escapeHtml(verdict.decision || "No disponible")}</dd></div><div><dt>Integridad</dt><dd>${escapeHtml(verdict.integrity_status || "Pendiente")}</dd></div><div><dt>Forecastability</dt><dd>${escapeHtml(verdict.forecastability_status || "Pendiente")}</dd></div><div><dt>Fuentes</dt><dd>${escapeHtml(verdict.source_readiness || "Pendiente")}</dd></div><div><dt>Confianza</dt><dd>${escapeHtml(verdict.confidence ?? "—")}</dd></div></dl><p>${escapeHtml(verdict.summary || "Solicita el análisis para obtener un dictamen estructurado.")}</p>${reasonCodes.length ? `<ul>${reasonCodes.map((code) => `<li><code>${escapeHtml(code)}</code></li>`).join("")}</ul>` : ""}</section>
        <section><h3>Propuesta editable</h3><p>${escapeHtml(proposal.question || signal.suggested_question || "No existe una propuesta aprobable todavía.")}</p><p><strong>Tesis:</strong> ${escapeHtml(verdict.market_thesis || signal.market_thesis || "Pendiente")}</p><button class="primary-button" type="button" data-observatory-prepare="${escapeHtml(signal.id)}"${run.id && (proposal.question || signal.suggested_question) ? "" : " disabled"}>Aplicar propuesta al formulario</button><small>No guarda, aprueba, programa ni publica.</small></section>
        <section class="field-wide"><h3>Plan de Resolución</h3><dl><div><dt>Esquema</dt><dd>${escapeHtml(contract.contract_schema_version || "Pendiente")}</dd></div><div><dt>Proveedor</dt><dd>${escapeHtml(contract.provider || "Pendiente")}</dd></div><div><dt>Estrategia</dt><dd>${escapeHtml(contract.capture_strategy || "Pendiente")}</dd></div><div><dt>Métrica y umbral</dt><dd>${escapeHtml(contract.metric || "No aplica")} ${escapeHtml(contract.operator || "")} ${escapeHtml(contract.threshold ?? "")}</dd></div><div><dt>Agregación</dt><dd>${escapeHtml(contract.aggregation || "Pendiente")}</dd></div></dl><h4>Fuentes y roles</h4>${sources.length ? `<ol>${sources.map((source) => `<li><strong>${escapeHtml(source.role)}</strong> · ${externalLink(source.url, "Abrir fuente")}</li>`).join("")}</ol>` : `<p>Falta una fuente de resolución aprobable.</p>`}</section>
        <section class="field-wide"><h3>Hipótesis privadas</h3>${hypotheses.length ? `<ul>${hypotheses.map((hypothesis) => `<li><strong>${escapeHtml(hypothesis.proposed_question || "Hipótesis descartada")}</strong><span>${escapeHtml(hypothesis.why_now || hypothesis.rejection_reason_codes?.join(", ") || "")}</span></li>`).join("")}</ul>` : `<p>No se ha fabricado ninguna hipótesis sin una oportunidad sólida.</p>`}<button class="secondary-button" type="button" data-observatory-discover-context="${escapeHtml(signal.id)}">Descubrir oportunidades</button></section>
      </div>
    </section>`;
  }

  function observatoryContextMarkup() {
    const arcs = Array.isArray(state.observatory.dashboard.story_arcs) ? state.observatory.dashboard.story_arcs : [];
    const hypotheses = Array.isArray(state.observatory.dashboard.hypotheses) ? state.observatory.dashboard.hypotheses : [];
    return `<section class="observatory-context" aria-labelledby="observatory-context-title"><div class="admin-section-heading"><div><p class="eyebrow">Contexto y oportunidades</p><h3 id="observatory-context-title">Narrativas trazables</h3></div><p>Hecho, contexto e inferencia se guardan por separado. El agente puede devolver cero propuestas.</p></div>
      <div class="observatory-context-grid"><article><strong>${escapeHtml(arcs.length)}</strong><span>story arcs privados</span></article><article><strong>${escapeHtml(hypotheses.filter((item) => item.hypothesis_status === "shortlisted" || item.hypothesis_status === "generated").length)}</strong><span>hipótesis para revisar</span></article><article><strong>Desactivado</strong><span>scheduler editorial</span></article></div></section>`;
  }

  function observatoryMonitoringMarkup() {
    const bindings = Array.isArray(state.observatory.dashboard.bindings) ? state.observatory.dashboard.bindings : [];
    const schedulerEnabled = state.observatory.dashboard.schedulers?.source_monitor_scheduler_enabled?.enabled === true;
    return `<section class="observatory-monitoring" aria-labelledby="observatory-monitor-title"><div class="admin-section-heading"><div><p class="eyebrow">Agente Centinela</p><h3 id="observatory-monitor-title">Monitorización de resolución</h3></div><p>validated prepara el contrato; armed exige activación manual del scheduler; ready_to_resolve nunca liquida.</p></div>
      ${bindings.length ? `<div class="observatory-binding-list">${bindings.map((binding) => `<article><div><strong>${escapeHtml(binding.market_id || `Borrador · plan v${binding.plan_version}`)}</strong><span>${escapeHtml(binding.provider)} · ${escapeHtml(binding.status)}</span><small>${escapeHtml(binding.monitor_required ? `Monitor ${binding.monitor_readiness}` : "Sin capturas periódicas")}</small></div><div><button class="secondary-button" type="button" data-binding-verify="${escapeHtml(binding.id)}">Validar contrato</button>${binding.monitor_required ? `<button class="secondary-button" type="button" data-binding-arm="${escapeHtml(binding.id)}"${schedulerEnabled ? "" : " disabled"}>${schedulerEnabled ? "Armar monitor" : "Scheduler desactivado"}</button>` : ""}${["armed", "monitoring", "failed"].includes(binding.status) ? `<button class="secondary-button" type="button" data-binding-pause="${escapeHtml(binding.id)}">Pausar</button>` : ""}</div></article>`).join("")}</div>` : `<div class="admin-empty-state"><strong>No hay planes monitorizados</strong><span>Los mercados manuales no necesitan binding. No se exigen capturas antes de publicar.</span></div>`}
    </section>`;
  }

  function observatoryMarkup() {
    const allSignals = Array.isArray(state.observatory.dashboard.signals) ? state.observatory.dashboard.signals : [];
    const query = state.observatory.query.toLowerCase();
    const signals = allSignals.filter((signal) =>
      (state.observatory.provider === "all" || signal.provider === state.observatory.provider)
      && (!state.observatory.marketability || signal.marketability_status === state.observatory.marketability)
      && (!state.observatory.expertStatus || signal.expert_analysis_status === state.observatory.expertStatus)
      && (!query || `${signal.title} ${signal.subtitle || ""} ${signal.atinara_category || ""}`.toLowerCase().includes(query))
    );
    const cards = signals.length ? `<div class="observatory-signal-grid">${signals.map(observatorySignalCard).join("")}</div>` : `<div class="admin-empty-state"><strong>No hay señales con estos filtros</strong><span>Configura una fuente o actualiza las seguidas. Atinara no inventa datos para llenar el estado.</span></div>`;
    return `<section class="data-observatory" aria-labelledby="data-observatory-title">
      <header class="radar-heading"><div><p class="eyebrow">Administración · inteligencia de fuentes</p><h2 id="data-observatory-title">Observatorio de datos</h2><p>Descubre acontecimientos en fuentes oficiales registradas y analiza señales de IGDB, Twitch y YouTube antes de llevarlas al editor.</p></div><span class="radar-cache-badge">Privado · sin publicación automática</span></header>
      <aside class="admin-fail-closed-notice"><strong>Las métricas externas no son resultados.</strong><span>Un dato ausente no equivale a cero o No. Toda propuesta conserva revisión, contrato y confirmación humanas.</span></aside>
      ${observatoryProviderMarkup()}${observatoryOfficialDiscoveryMarkup()}${observatorySearchMarkup()}${observatoryWatchlistMarkup()}${observatoryFiltersMarkup()}
      <div class="radar-results-heading"><h3>${escapeHtml(signals.length)} señales</h3><p>Solo datos reales de proveedores configurados; cada fallo es parcial.</p></div>
      ${cards}${observatoryContextMarkup()}${observatoryMonitoringMarkup()}${observatoryDetailMarkup(state.observatory.selected)}
    </section>`;
  }

  function setDraftDirtyState(form) {
    if (!form) return;
    const baseDraft = state.selected?.draft || {};
    const currentPayload = helpers.collectDraftPayload(form, baseDraft);
    const currentCanonical = JSON.stringify(helpers.canonicalizeDraftPayload(currentPayload));
    const hasStoredDraft = Boolean(form.dataset.draftId);
    const hasNewDraftContent = Boolean(
      currentPayload.market_slug
      || currentPayload.question
      || currentPayload.subject
      || currentPayload.category
      || currentPayload.evaluation_ends_at
      || currentPayload.resolution_deadline
      || currentPayload.primary_source?.url
      || currentPayload.alternative_sources?.length
    );
    const dirty = hasStoredDraft
      ? currentCanonical !== state.draftBaseline
      : hasNewDraftContent;
    if (form.dataset.lastCanonical && form.dataset.lastCanonical !== currentCanonical) {
      delete form.dataset.idempotencyKey;
    }
    form.dataset.lastCanonical = currentCanonical;
    state.draftDirty = dirty;
    const saveButton = form.querySelector("[data-save-draft]");
    if (saveButton) saveButton.disabled = state.busy || !dirty;
    const status = form.querySelector("[data-draft-change-status]");
    if (status) {
      status.textContent = hasStoredDraft
        ? dirty ? "Cambios sin guardar" : "Sin cambios pendientes"
        : dirty ? "Nuevo borrador sin guardar" : "Sin cambios pendientes";
      status.dataset.dirty = String(dirty);
    }
    document.querySelectorAll("[data-request-review], [data-confirm-review], [data-publish-draft]")
      .forEach((button) => {
        button.disabled = state.busy || dirty || button.dataset.stateAllowed !== "true";
      });
    const publishControls = document.querySelector(".admin-publish-controls");
    if (publishControls) {
      publishControls.disabled = state.busy || dirty || publishControls.dataset.stateAllowed !== "true";
    }
  }

  function initializeDraftFormState() {
    const form = document.querySelector("#admin-market-form");
    if (!form) {
      state.draftDirty = false;
      state.draftBaseline = "";
      return;
    }
    const baseDraft = state.selected?.draft || {};
    state.draftBaseline = form.dataset.draftId
      ? JSON.stringify(helpers.canonicalizeDraftPayload(baseDraft))
      : "";
    form.dataset.lastCanonical = JSON.stringify(
      helpers.canonicalizeDraftPayload(helpers.collectDraftPayload(form, baseDraft))
    );
    setDraftDirtyState(form);
  }

  function canDiscardDraftChanges() {
    return !state.draftDirty || window.confirm("Hay cambios materiales sin guardar. ¿Quieres descartarlos?");
  }

  function renderWorkspace() {
    root.setAttribute("aria-busy", String(state.busy));
    let content = "";
    if (state.view === "drafts") {
      content = `<div class="admin-market-workspace">${listMarkup()}${formMarkup(state.selected)}</div>`;
    } else if (state.view === "radar") {
      content = radarMarkup();
    } else if (state.view === "observatory") {
      content = observatoryMarkup();
    } else if (state.view === "catalog") {
      content = catalogMarkup();
    } else {
      content = auditMarkup(state.audit);
    }
    root.innerHTML = `${toolbarMarkup()}${noticeMarkup()}${content}`;
    initializeDraftFormState();
  }

  async function loadDrafts({ preserveSelection = true } = {}) {
    state.drafts = await rpc("list_admin_market_drafts", {
      status_filter: state.status || null,
      query_filter: state.query || null,
      limit_count: 100,
      offset_count: 0
    }) || [];
    if (!preserveSelection) {
      state.selected = null;
      clearGateNotice();
    }
  }

  async function openDraft(id) {
    if (!canDiscardDraftChanges()) return;
    clearGateNotice();
    state.busy = true;
    renderWorkspace();
    try {
      state.selected = await rpc("get_admin_market_draft_v2", { draft_id_input: id });
      setNotice("Borrador privado cargado.", "success");
    } catch (error) {
      setNotice(helpers.getFriendlyError(error, "No se pudo cargar el borrador."), "error");
    } finally {
      state.busy = false;
      renderWorkspace();
      document.querySelector("#admin-market-form input")?.focus();
    }
  }

  async function saveDraft(form) {
    const baseDraft = state.selected?.draft || {};
    const payload = helpers.collectDraftPayload(form, baseDraft);
    if (form.dataset.draftId && helpers.draftPayloadsEqual(payload, baseDraft)) {
      setNotice("No había cambios materiales. Se conserva la versión y la revisión vigente.", "success");
      state.draftDirty = false;
      setDraftDirtyState(form);
      const existingNotice = root.querySelector(".admin-status-message");
      if (existingNotice) existingNotice.textContent = state.notice;
      return;
    }
    const localIssues = helpers.validateDraftLocally(payload);
    if (localIssues.length) {
      setNotice(localIssues[0].message, "error");
      let inlineNotice = root.querySelector("[data-inline-save-error]");
      if (!inlineNotice) {
        inlineNotice = document.createElement("p");
        inlineNotice.dataset.inlineSaveError = "true";
        inlineNotice.className = "admin-status-message admin-status-error";
        inlineNotice.setAttribute("role", "alert");
        form.prepend(inlineNotice);
      }
      inlineNotice.textContent = state.notice;
      form.querySelector(`[name="${CSS.escape(localIssues[0].field)}"]`)?.focus();
      return;
    }
    form.dataset.idempotencyKey ||= crypto.randomUUID();
    payload._idempotency_key = form.dataset.idempotencyKey;
    payload._change_origin = state.radarPrefill ? "intelligence_form_save" : "manual_form_save";
    if (state.radarPrefill?.candidateId) {
      payload._radar_preparation_revision = state.radarPrefill.preparationRevision;
    }
    state.busy = true;
    root.setAttribute("aria-busy", "true");
    form.setAttribute("aria-busy", "true");
    form.querySelectorAll("button, input, textarea, select").forEach((control) => { control.disabled = true; });
    let saved = false;
    try {
      const intelligencePrefill = state.radarPrefill;
      const args = {
        draft_id_input: form.dataset.draftId || null,
        expected_version_input: form.dataset.version ? Number(form.dataset.version) : null,
        draft_input: payload
      };
      let result;
      if (intelligencePrefill?.candidateId && !form.dataset.draftId) {
        result = radarExpertBindingCompatible(intelligencePrefill, payload)
          ? await rpc("save_market_draft_from_radar_intelligence", {
            candidate_id_input: intelligencePrefill.candidateId,
            ...args,
            expert_run_id_input: intelligencePrefill.expertRunId,
            contract_input: intelligencePrefill.contract || {},
            sources_input: intelligencePrefill.sources || []
          })
          : await rpc("save_market_draft_from_radar", {
            candidate_id_input: intelligencePrefill.candidateId,
            ...args
          });
      } else if (intelligencePrefill?.originType === "observatory_signal" && !form.dataset.draftId) {
        result = await rpc("save_market_draft_from_intelligence", {
          ...args,
          origin_type_input: intelligencePrefill.originType,
          origin_id_input: intelligencePrefill.originId,
          expert_run_id_input: intelligencePrefill.expertRunId,
          contract_input: intelligencePrefill.contract || {},
          sources_input: intelligencePrefill.sources || []
        });
      } else {
        result = await rpc("save_market_draft", args);
      }
      if (result?.changed !== false) clearGateNotice();
      let feedbackWarning = false;
      if (intelligencePrefill?.expertRunId) {
        const changedFields = changedExpertFields(intelligencePrefill.proposedFields || {}, payload);
        await invokeMarketExpert("record-feedback", {
          run_id: intelligencePrefill.expertRunId,
          final_decision: changedFields.length ? "saved_with_edits" : "saved_as_proposed",
          changed_fields: changedFields,
          reason: changedFields.length
            ? "La administradora ajustó la propuesta antes de guardarla como borrador privado."
            : "La administradora guardó la propuesta sin cambios materiales."
        }).catch(() => { feedbackWarning = true; });
      }
      state.radarPrefill = null;
      await loadDrafts();
      state.selected = await rpc("get_admin_market_draft_v2", { draft_id_input: result.draft.id });
      const issueCount = Array.isArray(result.deterministic_issues) ? result.deterministic_issues.length : 0;
      const pluralSuffix = issueCount === 1 ? "" : "s";
      const noticeMessage = result.changed === false
        ? result.message || "No había cambios materiales. Se conserva la versión y la revisión vigente."
        : issueCount
        ? `Borrador guardado en privado con ${issueCount} motivo${pluralSuffix} pendiente${pluralSuffix}.`
        : "Borrador guardado. Ya puede solicitarse la revisión automática.";
      setNotice(
        feedbackWarning ? `${noticeMessage} El feedback experto no pudo registrarse y podrá reintentarse sin afectar al borrador.` : noticeMessage,
        issueCount || feedbackWarning ? "warning" : "success"
      );
      saved = true;
    } catch (error) {
      setNotice(helpers.getFriendlyError(error, "No se pudo guardar el borrador."), "error");
      let inlineNotice = root.querySelector("[data-inline-save-error]");
      if (!inlineNotice) {
        inlineNotice = document.createElement("p");
        inlineNotice.dataset.inlineSaveError = "true";
        inlineNotice.className = "admin-status-message admin-status-error";
        inlineNotice.setAttribute("role", "alert");
        form.prepend(inlineNotice);
      }
      inlineNotice.textContent = state.notice;
    } finally {
      state.busy = false;
      root.setAttribute("aria-busy", "false");
      if (saved) {
        renderWorkspace();
      } else {
        form.removeAttribute("aria-busy");
        form.querySelectorAll("input, textarea, select").forEach((control) => { control.disabled = false; });
        setDraftDirtyState(form);
      }
    }
  }

  function confirmationMatchesDraft(payload, expectedDraft) {
    const confirmedDraft = payload?.draft;
    const effectiveReviewId = payload?.effective_review?.id;
    return Boolean(confirmedDraft?.human_confirmed_at)
      && confirmedDraft.workflow_status === "human_confirmed"
      && Number(confirmedDraft.content_version) === Number(expectedDraft.content_version)
      && confirmedDraft.content_fingerprint === expectedDraft.content_fingerprint
      && confirmedDraft.human_confirmed_fingerprint === confirmedDraft.content_fingerprint
      && effectiveReviewId !== null
      && effectiveReviewId !== undefined
      && String(confirmedDraft.human_confirmed_review_id) === String(effectiveReviewId);
  }

  function confirmationResponseMatches(result, expectedDraft, payload) {
    const effectiveReviewId = payload?.effective_review?.id;
    return result?.status === "human_confirmed"
      && result?.confirmed_at
      && result?.content_fingerprint === expectedDraft.content_fingerprint
      && effectiveReviewId !== null
      && effectiveReviewId !== undefined
      && String(result?.effective_review_id) === String(effectiveReviewId);
  }

  function applyConfirmationResponseLocally(result) {
    if (!state.selected?.draft) return;
    state.selected = {
      ...state.selected,
      draft: {
        ...state.selected.draft,
        workflow_status: "human_confirmed",
        human_confirmed_at: result.confirmed_at,
        human_confirmed_fingerprint: result.content_fingerprint,
        human_confirmed_review_id: result.effective_review_id
      }
    };
  }

  async function requestReview() {
    const draft = state.selected?.draft;
    if (!draft || state.busy) return;
    const previousAttemptId = state.selected?.latest_attempt?.id || null;
    state.busy = true;
    setGateNotice("Revisión en curso. El mercado continúa privado.", "info");
    setNotice("Revisión en curso. El mercado continúa privado.", "info");
    renderWorkspace();
    try {
      const { data, error } = await client.functions.invoke("validate-market-draft", {
        body: {
          draft_id: draft.id,
          expected_version: draft.content_version,
          attempt_id: crypto.randomUUID(),
          force_review: state.selected?.latest_attempt?.classification === "technical"
        }
      });
      if (error) throw error;
      state.selected = await rpc("get_admin_market_draft_v2", { draft_id_input: draft.id });
      const tone = ["approved", "review_approved"].includes(data?.status) ? "success" : "warning";
      const message = helpers.formatStructuredText(data?.message, "Revisión terminada.");
      const listRefreshFailed = await loadDrafts().then(() => false).catch(() => true);
      const finalMessage = listRefreshFailed
        ? `${message} La lista no pudo actualizarse, pero el estado abierto sí es autoritativo.`
        : message;
      setGateNotice(finalMessage, listRefreshFailed ? "warning" : tone);
      setNotice(finalMessage, listRefreshFailed ? "warning" : tone);
    } catch (error) {
      const reconciled = await rpc("get_admin_market_draft_v2", { draft_id_input: draft.id }).catch(() => null);
      if (reconciled) state.selected = reconciled;
      const latestAttempt = reconciled?.latest_attempt;
      const finishedDespiteResponseLoss = latestAttempt?.id
        && latestAttempt.id !== previousAttemptId
        && latestAttempt.completed_at;
      if (finishedDespiteResponseLoss) {
        const approved = reconciled?.draft?.workflow_status === "review_approved";
        const message = approved
          ? "La respuesta de red se perdió, pero Supabase confirma que la revisión quedó aprobada."
          : "La respuesta de red se perdió, pero Supabase confirma que la revisión terminó y el mercado sigue privado.";
        setGateNotice(message, approved ? "success" : "warning");
        setNotice(message, approved ? "success" : "warning");
      } else {
        const message = helpers.getFriendlyError(error, "La revisión no se completó. El mercado continúa privado.");
        setGateNotice(message, "error");
        setNotice(message, "error");
      }
    } finally {
      state.busy = false;
      renderWorkspace();
      focusActionStatus();
    }
  }

  async function runDraftValidationSingleInferenceSmoke(draftId, expectedVersion, options = {}) {
    const attemptId = String(options.attemptId || "").trim();
    const validUuid = (value) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
    if (!state.auth?.isAdmin) throw new Error("ADMIN_REQUIRED");
    if (!validUuid(String(draftId || "")) || !Number.isSafeInteger(Number(expectedVersion))
      || Number(expectedVersion) < 1 || !validUuid(attemptId)) {
      throw new Error("INVALID_SINGLE_INFERENCE_SMOKE_REQUEST");
    }
    const { data, error } = await client.functions.invoke("validate-market-draft", {
      body: {
        draft_id: String(draftId),
        expected_version: Number(expectedVersion),
        attempt_id: attemptId,
        force_review: true,
        execution_profile: "single_inference_smoke_v1"
      }
    });
    if (error) throw error;
    return data;
  }

  async function ensureRadarDraftEligibility(draft) {
    const candidateId = String(draft?.radar_candidate_id || "").trim();
    if (!candidateId) return null;
    return invokeRadar("check-eligibility", {
      candidate_id: candidateId,
      operation_id: crypto.randomUUID(),
      draft_id: draft.id,
      draft_version: draft.content_version,
      draft_fingerprint: draft.content_fingerprint
    });
  }

  async function recoverDraftRadarEligibility(candidateId) {
    const draft = state.selected?.draft;
    if (!draft || state.busy) return;
    const recoveryKey = `${ELIGIBILITY_RECOVERY_KEY_PREFIX}:${draft.id}:${draft.content_version}`;
    const recoveryMaterial = `${draft.content_fingerprint || ""}:${candidateId}`;
    let operationId = eligibilityRecoveryOperationIds.get(recoveryKey)?.material === recoveryMaterial
      ? eligibilityRecoveryOperationIds.get(recoveryKey).operationId : "";
    if (!operationId) {
      try {
        const stored = JSON.parse(sessionStorage.getItem(recoveryKey) || "null");
        if (stored?.material === recoveryMaterial
          && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(stored?.operationId || "")) {
          operationId = stored.operationId;
        }
      } catch { /* La memoria de la pestaña conserva el retry. */ }
    }
    if (!operationId) operationId = crypto.randomUUID();
    const recoveryIntent = { material: recoveryMaterial,operationId };
    eligibilityRecoveryOperationIds.set(recoveryKey,recoveryIntent);
    try { sessionStorage.setItem(recoveryKey,JSON.stringify(recoveryIntent)); } catch { /* La memoria conserva la intención. */ }
    const clearRecoveryIntent = () => {
      eligibilityRecoveryOperationIds.delete(recoveryKey);
      try { sessionStorage.removeItem(recoveryKey); } catch { /* El readback autoritativo ya terminó. */ }
    };
    state.busy = true;
    setGateNotice("Radar está renovando la elegibilidad y enlazando esta versión privada…", "info");
    renderWorkspace();
    try {
      const result = await invokeRadar("recover-draft-eligibility", {
        candidate_id: candidateId,
        operation_id: operationId,
        draft_id: draft.id,
        draft_version: draft.content_version,
        draft_fingerprint: draft.content_fingerprint,
      });
      state.selected = await rpc("get_admin_market_draft_v2", { draft_id_input: draft.id });
      clearRecoveryIntent();
      setGateNotice(result?.message || "Elegibilidad renovada. Validator ya puede revisar la versión enlazada.", "success");
    } catch (error) {
      setGateNotice(helpers.getFriendlyError(error, "No se pudo renovar la elegibilidad. El borrador continúa privado y editable."), "warning");
    } finally {
      state.busy = false;
      renderWorkspace();
      focusActionStatus();
    }
  }

  async function confirmReview() {
    const draft = state.selected?.draft;
    if (!draft || state.busy) return;
    if (!window.confirm("¿Confirmas que has revisado personalmente la pregunta, criterios, periodo, fechas y fuentes de esta versión?")) return;
    state.busy = true;
    setGateNotice("Registrando la confirmación humana en Supabase…", "info");
    setNotice("Registrando la confirmación humana en Supabase…", "info");
    renderWorkspace();
    let result = null;
    let requestError = null;
    let confirmationRequested = false;
    try {
      confirmationRequested = true;
      result = await rpc("confirm_market_draft_review_v3", {
        draft_id_input: draft.id,
        expected_version_input: draft.content_version
      });
    } catch (error) {
      requestError = error;
    }

    const reconciled = await rpc("get_admin_market_draft_v2", { draft_id_input: draft.id }).catch(() => null);
    if (reconciled) state.selected = reconciled;
    const persisted = confirmationRequested && (
      confirmationMatchesDraft(reconciled, draft)
      || confirmationResponseMatches(result, draft, state.selected)
    );

    if (persisted) {
      if (!confirmationMatchesDraft(reconciled, draft)) applyConfirmationResponseLocally(result);
      const listRefreshFailed = await loadDrafts().then(() => false).catch(() => true);
      const message = listRefreshFailed
        ? "Confirmación humana registrada. La lista no pudo actualizarse, pero ya puedes publicar esta versión."
        : requestError
          ? "La respuesta de red se perdió, pero Supabase confirma que la validación humana quedó registrada."
          : "Confirmación humana registrada. La publicación volverá a comprobar toda la versión.";
      setGateNotice(message, listRefreshFailed ? "warning" : "success");
      setNotice(message, listRefreshFailed ? "warning" : "success");
    } else {
      const error = requestError || operationError(
        "CONFIRMATION_NOT_PERSISTED",
        "Supabase no devolvió la confirmación humana persistida."
      );
      const owner = WORKFLOW_OWNER_LABELS[result?.owner_stage] || "el agente responsable";
      const nextAction = WORKFLOW_ACTION_LABELS[result?.next_action] || "revisar el borrador";
      const message = result?.ok === false
        ? `La confirmación no se registró y el borrador se conservó. Responsable: ${owner}. Siguiente acción: ${nextAction}.`
        : helpers.getFriendlyError(error, "No se pudo registrar la confirmación. El mercado continúa privado.");
      setGateNotice(message, result?.ok === false ? "warning" : "error");
      setNotice(message, result?.ok === false ? "warning" : "error");
    }

    state.busy = false;
    renderWorkspace();
    focusActionStatus();
  }

  async function publishDraft() {
    const draft = state.selected?.draft;
    if (!draft || state.busy) return;
    const scheduledValue = document.querySelector('[name="scheduled_for"]')?.value || "";
    const scheduledFor = scheduledValue
      ? helpers.toIsoOrEmpty(scheduledValue, draft.timezone || "")
      : null;
    if (scheduledValue && !scheduledFor) {
      const message = "La fecha programada no es válida en la zona horaria del mercado.";
      setGateNotice(message, "error");
      setNotice(message, "error");
      renderWorkspace();
      focusActionStatus();
      return;
    }
    const action = scheduledFor ? "programar" : "publicar";
    if (!window.confirm(`Supabase revalidará el rol y la revisión vigente antes de ${action}. ¿Continuar?`)) return;
    state.busy = true;
    setGateNotice(`Supabase está revalidando la versión antes de ${action}…`, "info");
    setNotice(`Supabase está revalidando la versión antes de ${action}…`, "info");
    renderWorkspace();
    let result = null;
    let requestError = null;
    let publicationRequested = false;
    const publicationKey = `${PUBLICATION_ATTEMPT_KEY_PREFIX}:${draft.id}:${draft.content_version}`;
    const publicationMaterial = `${draft.content_fingerprint || ""}:${scheduledValue}:${draft.timezone || ""}`;
    let publicationRequestId = publicationAttemptIds.get(publicationKey)?.material === publicationMaterial
      ? publicationAttemptIds.get(publicationKey).requestId : "";
    if (!publicationRequestId) {
      try {
        const stored = JSON.parse(sessionStorage.getItem(publicationKey) || "null");
        if (stored?.material === publicationMaterial
          && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(stored?.requestId || "")) {
          publicationRequestId = stored.requestId;
        }
      } catch { /* Se conserva la intención en memoria. */ }
    }
    if (!publicationRequestId) publicationRequestId = crypto.randomUUID();
    const publicationIntent = { material: publicationMaterial, requestId: publicationRequestId };
    publicationAttemptIds.set(publicationKey, publicationIntent);
    try { sessionStorage.setItem(publicationKey, JSON.stringify(publicationIntent)); } catch { /* La memoria conserva el retry de esta pestaña. */ }
    const clearPublicationIntent = () => {
      publicationAttemptIds.delete(publicationKey);
      try { sessionStorage.removeItem(publicationKey); } catch { /* El resultado autoritativo ya es terminal. */ }
    };
    try {
      await ensureRadarDraftEligibility(draft).catch(() => null);
      publicationRequested = true;
      result = await rpc("publish_market_draft_v2", {
        draft_id_input: draft.id,
        expected_version_input: draft.content_version,
        scheduled_for_input: scheduledFor,
        request_id_input: publicationRequestId
      });
    } catch (error) {
      requestError = error;
    }

    const reconciled = await rpc("get_admin_market_draft_v2", { draft_id_input: draft.id }).catch(() => null);
    const authoritativeStatus = publicationRequested && ["scheduled", "published"].includes(result?.status)
      ? result.status
      : publicationRequested && ["scheduled", "published"].includes(reconciled?.draft?.workflow_status)
        ? reconciled.draft.workflow_status
        : null;

    if (authoritativeStatus) {
      clearPublicationIntent();
      const listRefreshFailed = await loadDrafts({ preserveSelection: false }).then(() => false).catch(() => {
        state.selected = null;
        return true;
      });
      clearGateNotice();
      const baseMessage = authoritativeStatus === "scheduled"
        ? "Mercado programado con aprobación vigente."
        : "Mercado publicado y estado LMSR inicializado de forma autoritativa.";
      const message = requestError
        ? `La respuesta de red se perdió, pero Supabase confirma el resultado. ${baseMessage}`
        : listRefreshFailed
          ? `${baseMessage} La lista privada se actualizará en la próxima carga.`
          : baseMessage;
      setNotice(message, listRefreshFailed ? "warning" : "success");
    } else {
      if (result?.ok === false) clearPublicationIntent();
      if (reconciled) state.selected = reconciled;
      const owner = WORKFLOW_OWNER_LABELS[result?.owner_stage] || "el agente responsable";
      const nextAction = WORKFLOW_ACTION_LABELS[result?.next_action] || "revisar el borrador";
      const error = requestError || operationError("PUBLICATION_NOT_PERSISTED", "La publicación continúa bloqueada.");
      const message = result?.ok === false
        ? `La publicación se bloqueó sin perder el borrador ni la confirmación compatible. Responsable: ${owner}. Siguiente acción: ${nextAction}.`
        : helpers.getFriendlyError(error, "La publicación se bloqueó de forma segura.");
      setGateNotice(message, result?.ok === false ? "warning" : "error");
      setNotice(message, result?.ok === false ? "warning" : "error");
    }

    state.busy = false;
    renderWorkspace();
    focusActionStatus({ preferGate: !authoritativeStatus });
  }

  async function retryScheduledPublication() {
    const draft = state.selected?.draft;
    if (!draft || state.busy) return;
    state.busy = true;
    try {
      await rpc("retry_scheduled_market_publication_v1", { draft_id_input: draft.id });
      state.selected = await rpc("get_admin_market_draft_v2", { draft_id_input: draft.id });
      setGateNotice("El intento programado queda listo para el siguiente ciclo seguro.", "success");
    } catch (error) {
      setGateNotice(helpers.getFriendlyError(error, "No se pudo reactivar el intento programado."), "error");
    } finally {
      state.busy = false;
      renderWorkspace();
      focusActionStatus();
    }
  }

  async function cancelScheduledPublication() {
    const draft = state.selected?.draft;
    if (!draft || state.busy) return;
    const terminal = draft.publication_schedule_status === "scheduled_failed_terminal";
    if (!window.confirm(terminal
      ? "¿Cancelar la programación terminal y conservar el expediente privado para archivarlo?"
      : "¿Cancelar la programación y conservar el borrador humanamente confirmado?")) return;
    state.busy = true;
    try {
      const result = await rpc("cancel_scheduled_market_publication_v1", { draft_id_input: draft.id });
      state.selected = await rpc("get_admin_market_draft_v2", { draft_id_input: draft.id });
      const workflowStatus = state.selected?.draft?.workflow_status;
      if (result?.confirmation_preserved === true && workflowStatus === "human_confirmed") {
        setGateNotice("Programación cancelada. La confirmación compatible se conserva y puedes reprogramar.", "success");
      } else if (result?.terminal_issue_preserved === true && workflowStatus === "draft_ready") {
        setGateNotice("Programación cancelada. La incidencia terminal sigue abierta y la confirmación ya no es vigente; conserva o archiva el expediente sin publicarlo.", "warning");
      } else {
        throw operationError("SCHEDULED_CANCELLATION_NOT_RECONCILED", "Supabase no confirmó el estado final de la cancelación.");
      }
    } catch (error) {
      setGateNotice(helpers.getFriendlyError(error, "No se pudo cancelar la programación."), "error");
    } finally {
      state.busy = false;
      renderWorkspace();
      focusActionStatus();
    }
  }

  async function archiveTerminalDraft() {
    const draft=state.selected?.draft;
    if (!draft||state.busy) return;
    if (!window.confirm("¿Archivar este borrador terminal sin publicarlo ni eliminar su trazabilidad?")) return;
    state.busy=true;
    try {
      await rpc("archive_terminal_market_draft_v1",{
        draft_id_input:draft.id,expected_version_input:draft.content_version,
      });
      state.selected=await rpc("get_admin_market_draft_v2",{draft_id_input:draft.id});
      await loadDrafts();
      setGateNotice("Expediente terminal archivado. No se publicó ni se eliminó ningún dato.","success");
    } catch(error) {
      setGateNotice(helpers.getFriendlyError(error,"No se pudo archivar el expediente terminal."),"error");
    } finally {
      state.busy=false;renderWorkspace();focusActionStatus();
    }
  }

  function radarRequestPayload(refresh = false) {
    return {
      provider: state.radar.provider,
      category: state.radar.category,
      query: state.radar.query,
      horizon: state.radar.horizon,
      quality: state.radar.quality,
      order: state.radar.order,
      parent_offset: state.radar.parentOffset,
      reconciliation_offset: state.radar.reconciliationOffset,
      refresh
    };
  }

  function updateRadarCooldownButton() {
    const button = root.querySelector("[data-radar-refresh]");
    const seconds = Math.max(0, Math.ceil((state.radar.cooldownUntil - Date.now()) / 1000));
    if (button) {
      button.disabled = state.busy || (!state.radar.refreshInProgress && seconds > 0);
      button.textContent = state.busy ? "Actualizando…"
        : state.radar.refreshInProgress ? "Continuar actualización"
          : seconds > 0 ? `Disponible en ${seconds} s` : "Actualizar fuentes";
    }
    if (seconds === 0 && state.radarCooldownTimer !== null) {
      window.clearInterval(state.radarCooldownTimer);
      state.radarCooldownTimer = null;
    }
  }

  function startRadarCooldownTicker() {
    window.clearInterval(state.radarCooldownTimer);
    state.radarCooldownTimer = null;
    updateRadarCooldownButton();
    if (state.radar.cooldownUntil <= Date.now()) return;
    state.radarCooldownTimer = window.setInterval(updateRadarCooldownButton, 500);
  }

  async function loadRadar(refresh = false) {
    if (state.radarLoading) return;
    state.radarLoading = true;
    state.busy = true;
    if (refresh) setNotice("Actualizando fuentes. Los proveedores pueden fallar de forma independiente.", "info");
    renderWorkspace();
    try {
      const requestPayload = radarRequestPayload(refresh);
      const data = refresh && radarRequestCoordinator
        ? await radarRequestCoordinator.run(requestPayload, (payload) => invokeRadar("discover", payload))
        : await invokeRadar("discover", requestPayload);
      const nextCandidates = Array.isArray(data.candidates) ? data.candidates : [];
      const nextGroups = Array.isArray(data.groups) ? data.groups : null;
      if (!nextGroups || (nextCandidates.length && !nextGroups.length)) {
        throw new Error("RADAR_CURRENT_PARENT_PROJECTION_REQUIRED");
      }
      const nextParentReconciliations = Array.isArray(data.parent_reconciliations)
        ? data.parent_reconciliations : [];
      const currentGroupKeys = new Set(nextGroups.map((group) => String(group.event_group_key || "")));
      const nextExpandedGroups = new Set(
        [...state.radar.expandedGroups].filter((groupKey) => currentGroupKeys.has(groupKey)),
      );
      const nextRejected = data.rejected && typeof data.rejected === "object"
        ? data.rejected
        : { total: 0, counts: {}, items: [] };
      const nextRejectionReason = !["current", "all", "outdated"].includes(state.radar.rejectionReason)
        && !Object.hasOwn(nextRejected.counts || {}, state.radar.rejectionReason)
        ? "current" : state.radar.rejectionReason;
      const nextProviders = Array.isArray(data.providers) ? data.providers : [];
      const nextErrors = Array.isArray(data.errors) ? data.errors : [];
      const nextCandidateProviders = Array.isArray(data.candidate_providers)
        ? data.candidate_providers
        : nextProviders.filter((provider) => provider?.provider !== "tavily");
      const nextEnrichmentCapabilities = Array.isArray(data.enrichment_capabilities)
        ? data.enrichment_capabilities
        : nextProviders.filter((provider) => provider?.provider === "tavily");
      const nextProviderIssues = Array.isArray(data.provider_issues)
        ? data.provider_issues
        : nextErrors.map((error) => error?.issue).filter(Boolean);
      const nextEnrichmentIssues = Array.isArray(data.enrichment_issues)
        ? data.enrichment_issues
        : nextErrors.filter((error) => error?.degrades_provider === false)
          .map((error) => error?.issue).filter(Boolean);
      const nextRefreshInProgress = data.refresh_in_progress === true;
      const nextQualityNotices = Array.isArray(data.quality_notices) ? data.quality_notices : [];
      const nextPage = data.page && typeof data.page === "object"
        ? data.page : { parent_count: nextGroups.length, parent_offset: state.radar.parentOffset, parent_limit: 60, next_parent_offset: null };
      const nextReconciliationPage = data.reconciliation_page && typeof data.reconciliation_page === "object"
        ? data.reconciliation_page : { total: nextParentReconciliations.length, offset: 0, limit: 20, previous_offset: null, next_offset: null, snapshot_available: true };
      const cooldownMs = Math.max(0, Number(data.cooldown_seconds) || 0) * 1000;
      const serverCooldownUntil = Date.parse(data.cooldown_until || "");
      const nextCooldownUntil = nextRefreshInProgress ? 0 : Number.isFinite(serverCooldownUntil)
        ? serverCooldownUntil
        : Date.now() + cooldownMs;
      Object.assign(state.radar, {
        candidates: nextCandidates, groups: nextGroups,
        parentReconciliations: nextParentReconciliations,
        expandedGroups: nextExpandedGroups, rejected: nextRejected,
        rejectionReason: nextRejectionReason, providers: nextProviders, errors: nextErrors,
        candidateProviders: nextCandidateProviders, enrichmentCapabilities: nextEnrichmentCapabilities,
        providerIssues: nextProviderIssues, enrichmentIssues: nextEnrichmentIssues,
        refreshInProgress: nextRefreshInProgress, qualityNotices: nextQualityNotices,
        cached: data.cached === true, cachedAuthoritative: data.cached_authoritative === true,
        requiresEligibilityRefresh: data.requires_eligibility_refresh === true,
        page: nextPage, parentOffset: Math.max(0, Number(nextPage.parent_offset) || 0),
        reconciliationPage: nextReconciliationPage,
        reconciliationOffset: Math.max(0, Number(nextReconciliationPage.offset) || 0),
        loaded: true, cooldownUntil: nextCooldownUntil, selected: null, selectedReconciliation: null,
      });
      startRadarCooldownTicker();
      const reconciledResults = Math.max(0, Number(data.reconciled_provider_results) || 0);
      const reconciliationCopy = reconciledResults
        ? ` Se corrigieron ${reconciledResults} resultado${reconciledResults === 1 ? "" : "s"} directamente con el proveedor.`
        : "";
      const radarNotice = (state.radar.refreshInProgress
        ? "La actualización conserva su progreso. Puedes continuar la misma intención sin repetir lotes terminados."
        : data.partial
        ? "Radar actualizado con cobertura parcial. El detalle recuperable queda disponible en el resumen."
        : state.radar.qualityNotices.length
          ? "Radar actualizado. Algunas candidatas quedaron descartadas o en cuarentena sin degradar a sus proveedores."
        : data.cached
          ? state.radar.cachedAuthoritative
            ? "Radar cargado desde el último estado de elegibilidad vigente."
            : "No existe todavía una consulta vigente. Usa Actualizar fuentes cuando termine la espera."
          : "Radar actualizado sin crear ni modificar ningún mercado.") + reconciliationCopy;
      setNotice(radarNotice, data.partial || state.radar.refreshInProgress ? "info" : "success");
    } catch (error) {
      setNotice(helpers.getFriendlyError(error, "No se pudo cargar el Radar. La creación manual sigue disponible."), "error");
    } finally {
      state.radarLoading = false;
      state.busy = false;
      renderWorkspace();
    }
  }

  async function openRadarDetails(candidateId) {
    state.busy = true;
    renderWorkspace();
    try {
      const data = await invokeRadar("details", { candidate_id: candidateId });
      state.radar.selected = data.candidate || null;
      state.radar.selectedReconciliation = null;
      if (state.radar.selected
        && !radarCandidateIsTerminal(state.radar.selected)
        && !radarCandidateIsPlaceholder(state.radar.selected)
        && radarCandidatePolicyCurrent(state.radar.selected)
        && radarParentComplete(state.radar.selected)
        && radarCanonicalChildProjectionValid(state.radar.selected)) {
        const expert = await invokeMarketExpert("get-analysis", { origin_type: "radar_candidate", origin_id: candidateId }).catch(() => null);
        state.radar.selected.expert_analysis = expertRun(expert);
      }
    } catch (error) {
      setNotice(helpers.getFriendlyError(error, "No se pudo abrir el detalle del candidato."), "error");
    } finally {
      state.busy = false;
      renderWorkspace();
      document.querySelector(".radar-candidate-detail")?.focus();
    }
  }

  async function openRadarReconciliation(reconciliationId) {
    state.busy = true;
    renderWorkspace();
    try {
      const data = await invokeRadar("reconciliation-details", { reconciliation_id: reconciliationId });
      state.radar.selectedReconciliation = data.reconciliation || null;
      state.radar.selected = null;
      setNotice("Reconciliación cargada. Las etiquetas raw se muestran solo en este detalle técnico.", "info");
    } catch (error) {
      setNotice(helpers.getFriendlyError(error, "No se pudo abrir la reconciliación del proveedor."), "error");
    } finally {
      state.busy = false;
      renderWorkspace();
      document.querySelector('[aria-labelledby="radar-reconciliation-detail-title"]')?.focus();
    }
  }

  async function prepareRadarCandidate(candidateId, { throwOnError = false } = {}) {
    state.busy = true;
    setNotice("Comprobando estado y duplicados antes de pre-rellenar…", "info");
    renderWorkspace();
    let result = null;
    let failure = null;
    try {
      const data = await invokeRadar("prepare", { candidate_id: candidateId });
      const candidate = data.candidate || {};
      const prefill = data.prefill || {};
      const preparationRevision = String(
        data.preparation_revision
        || candidate.preparation_revision
        || data.reservation?.preparation_revision
        || ""
      ).trim();
      const eligibilityCheckId = String(data.eligibility_check_id || candidate.current_eligibility_check_id || "").trim();
      const currentExpertRun = state.radar.selected?.id === candidateId
        ? expertRun(state.radar.selected.expert_analysis) : null;
      const expertVerdict = currentExpertRun?.result_json && typeof currentExpertRun.result_json === "object"
        ? currentExpertRun.result_json : {};
      const expertProposal = expertVerdict.proposal && typeof expertVerdict.proposal === "object"
        && !Array.isArray(expertVerdict.proposal) ? expertVerdict.proposal : {};
      const expertContract = expertVerdict.resolution_contract
        && typeof expertVerdict.resolution_contract === "object"
        && !Array.isArray(expertVerdict.resolution_contract)
        ? expertVerdict.resolution_contract : {};
      const fields = currentExpertRun ? { ...(prefill.fields || {}), ...expertProposal } : prefill.fields || {};
      const alternatives = (Array.isArray(fields.alternative_sources)
        ? fields.alternative_sources.map((item) => typeof item === "string" ? item : item?.url)
        : String(fields.alternative_sources || "").split(/\r?\n/))
        .map((url) => String(url || "").trim()).filter(Boolean).map((url) => ({ url }));
      state.radarPrefill = {
        candidateId,
        preparationRevision,
        eligibilityCheckId,
        origins: prefill.origins || {},
        expertRunId: currentExpertRun?.id || null,
        contract: expertContract,
        sources: Array.isArray(expertContract.sources) ? expertContract.sources : [],
        proposedFields: fields
      };
      state.selected = {
        draft: {
          ...fields,
          id: null,
          content_version: null,
          workflow_status: "draft_incomplete",
          primary_source: fields.primary_source_url ? { url: fields.primary_source_url } : {},
          alternative_sources: alternatives
        },
        deterministic_issues: [],
        latest_review: null,
        audit: [],
        radar_origins: prefill.origins || {},
        radar_candidate: candidate
      };
      state.view = "drafts";
      setNotice("Formulario pre-rellenado. Revisa y completa la información: todavía no se ha guardado nada.", "warning");
      result = { ...data, preparation_revision: preparationRevision };
      document.dispatchEvent(new CustomEvent("atinara:radar-preparation-complete", {
        detail: { candidateId, preparationRevision, eligibilityCheckId }
      }));
    } catch (error) {
      failure = error;
      if (error?.authoritativeStateUpdated === true && error?.candidate?.id === candidateId) {
        const terminal = error.candidate.eligibility_status === "terminal"
          || String(error.candidate.verification_status || "").startsWith("rejected_")
          || error.candidate.state === "rejected";
        if (terminal) {
          removeVisibleRadarCandidate(candidateId);
          if (state.radar.selected?.id === candidateId) state.radar.selected = null;
        } else {
          replaceVisibleRadarCandidate(error.candidate);
        }
      }
      setNotice(expertErrorMessage(error, "No se pudo preparar el borrador. No se ha abierto ni guardado ningún borrador."), "error");
    } finally {
      state.busy = false;
      renderWorkspace();
      if (result) {
        document.querySelector("#admin-market-form")?.scrollIntoView({ behavior: "smooth", block: "start" });
        document.querySelector('#admin-market-form [name="question"]')?.focus({ preventScroll: true });
      }
    }
    if (failure && throwOnError) throw failure;
    return result;
  }

  function openPrivateIssueDraftForm(candidateId, draftPackage, preparationRevision) {
    const fields = draftPackage?.fields || {};
    const alternatives = String(fields.alternative_sources || "").split(/\r?\n/)
      .map((url) => url.trim()).filter(Boolean).map((url) => ({ url }));
    const workflowIssues = Array.isArray(draftPackage?.gate?.workflow_issues)
      ? draftPackage.gate.workflow_issues : [];
    const expertVerdict = draftPackage?.run?.result_json && typeof draftPackage.run.result_json === "object"
      ? draftPackage.run.result_json : {};
    const expertContract = expertVerdict.resolution_contract
      && typeof expertVerdict.resolution_contract === "object"
      && !Array.isArray(expertVerdict.resolution_contract)
      ? expertVerdict.resolution_contract : {};
    state.radarPrefill = {
      candidateId,
      preparationRevision,
      eligibilityCheckId: null,
      origins: {},
      expertRunId: draftPackage?.run?.id || null,
      contract: expertContract,
      sources: Array.isArray(expertContract.sources) ? expertContract.sources : [],
      proposedFields: fields,
    };
    state.selected = {
      draft: {
        ...fields,id:null,content_version:null,workflow_status:"draft_incomplete",
        artifact_status:"draft_with_repairable_issues",workflow_issues:workflowIssues,
        primary_source: fields.primary_source_url ? { url: fields.primary_source_url } : {},
        alternative_sources: alternatives,
      },
      deterministic_issues: workflowIssues.map((issue) => ({
        code: issue.issue_code,field: issue.affected_fields?.[0] || "market_definition",
        message: WORKFLOW_ISSUE_LABELS[issue.issue_code] || "Incidencia pendiente de resolver.",
      })),
      latest_review:null,audit:[],radar_origins:{},radar_candidate:state.radar.selected,
    };
    state.view="drafts";
    setNotice("Propuesta con incidencias aplicada al formulario privado. Puedes guardarla y enviarla a Validator; no puede aprobarse ni publicarse todavía.","warning");
    renderWorkspace();
    return { ok:true,preparation_revision:preparationRevision };
  }

  async function dismissRadarCandidate(candidateId) {
    state.busy = true;
    renderWorkspace();
    try {
      await invokeRadar("dismiss", { candidate_id: candidateId });
      removeVisibleRadarCandidate(candidateId);
      if (state.radar.selected?.id === candidateId) state.radar.selected = null;
      setNotice("Candidata descartada y registrada en la trazabilidad privada.", "success");
    } catch (error) {
      setNotice(helpers.getFriendlyError(error, "No se pudo descartar la candidata."), "error");
    } finally {
      state.busy = false;
      renderWorkspace();
    }
  }

  function removeVisibleRadarCandidate(candidateId) {
    state.radar.candidates = state.radar.candidates.filter((candidate) => candidate.id !== candidateId);
    state.radar.groups = state.radar.groups.map((group) => {
      const candidates = Array.isArray(group.candidates) ? group.candidates.filter((candidate) => candidate.id !== candidateId) : [];
      const topCandidates = Array.isArray(group.top_candidates) ? group.top_candidates.filter((candidate) => candidate.id !== candidateId) : [];
      return {
        ...group,
        candidates,
        top_candidates: topCandidates,
        child_count: Number.isInteger(Number(group.provider_declared_child_count))
          ? Number(group.provider_declared_child_count) : group.child_count,
      };
    }).filter((group) => group.candidates.length);
  }

  function replaceVisibleRadarCandidate(candidate) {
    if (!candidate?.id) return;
    const replace = (item) => item?.id === candidate.id ? { ...item, ...candidate } : item;
    state.radar.candidates = state.radar.candidates.map(replace);
    state.radar.groups = state.radar.groups.map((group) => ({
      ...group,
      candidates: Array.isArray(group.candidates) ? group.candidates.map(replace) : [],
      top_candidates: Array.isArray(group.top_candidates) ? group.top_candidates.map(replace) : [],
    }));
  }

  async function loadObservatory({ refresh = false } = {}) {
    state.busy = true;
    if (refresh) setNotice("Actualizando únicamente las fuentes seguidas. Cada proveedor puede fallar de forma independiente.", "info");
    renderWorkspace();
    try {
      const status = await invokeObservatory("provider-status");
      state.observatory.providers = Array.isArray(status.providers) ? status.providers : [];
      const data = refresh
        ? await invokeObservatory("discover", { providers: ["igdb", "twitch", "youtube"], trigger_type: "manual" })
        : await invokeObservatory("dashboard", { filters: { limit: 100 } });
      state.observatory.dashboard = data.dashboard || state.observatory.dashboard;
      state.observatory.errors = Array.isArray(data.errors) ? data.errors : [];
      if (refresh) {
        setNotice(data.partial
          ? "Observatorio actualizado con incidencias parciales. Los proveedores disponibles siguen utilizables."
          : "Observatorio actualizado sin crear borradores ni modificar mercados.", data.partial ? "warning" : "success");
      } else {
        setNotice("Observatorio privado cargado. La monitorización programada permanece desactivada.", "success");
      }
    } catch (error) {
      setNotice(helpers.getFriendlyError(error, "No se pudo cargar el Observatorio. Crear manualmente y el Radar siguen disponibles."), "error");
    } finally {
      state.busy = false;
      renderWorkspace();
    }
  }

  async function searchObservatory(form) {
    const data = new FormData(form);
    state.observatory.searchProvider = String(data.get("provider") || "igdb");
    state.observatory.searchQuery = String(data.get("query") || "").trim();
    if (state.observatory.searchQuery.length < 2) return;
    state.busy = true;
    renderWorkspace();
    try {
      const result = await invokeObservatory("search", {
        provider: state.observatory.searchProvider,
        query: state.observatory.searchQuery
      });
      state.observatory.searchResults = Array.isArray(result.items) ? result.items : [];
      setNotice(result.warning || (state.observatory.searchResults.length
        ? "Resultados públicos listos para añadir al seguimiento privado."
        : "La fuente no devolvió coincidencias."), result.warning ? "warning" : "info");
    } catch (error) {
      state.observatory.searchResults = [];
      setNotice(helpers.getFriendlyError(error, "El proveedor no está disponible o no está configurado."), "error");
    } finally {
      state.busy = false;
      renderWorkspace();
    }
  }

  async function discoverOfficialOpportunities(form) {
    if (!officialRequestCoordinator) {
      setNotice("La protección de idempotencia no está disponible. Recarga la página antes de buscar.", "error");
      return;
    }
    const data = new FormData(form);
    const discovery = state.observatory.officialDiscovery;
    discovery.query = String(data.get("query") || "").trim();
    discovery.category = String(data.get("category") || "Eventos").trim();
    discovery.horizonDays = Number(data.get("horizon_days")) || 180;
    discovery.timezone = String(data.get("timezone") || "Europe/Madrid").trim();
    try {
      const result = await officialRequestCoordinator.run({
        query: discovery.query,
        category: discovery.category,
        horizon_days: discovery.horizonDays,
        timezone: discovery.timezone,
        max_results: 5
      }, async (requestPayload) => {
        discovery.inFlight = true;
        state.busy = true;
        setNotice("Buscando fechas futuras estructuradas únicamente en fuentes oficiales registradas. No se invoca ningún modelo.", "info");
        renderWorkspace();
        return invokeObservatory("discover-official-opportunities", requestPayload);
      });
      if (result.outcome === "in_progress") {
        setNotice("Esta misma búsqueda ya está en curso. No se ha iniciado una segunda consulta externa.", "info");
        return;
      }
      discovery.result = result;
      state.observatory.dashboard = result.dashboard || state.observatory.dashboard;
      const saved = Number(result.saved) || 0;
      setNotice(result.outcome === "technical_failure"
        ? "La búsqueda terminó con un fallo técnico controlado. No se creó ningún borrador ni mercado; puedes iniciar una nueva búsqueda manual."
        : saved
        ? `${saved} oportunidad(es) oficial(es) guardada(s) como señales privadas. Revisa cada contrato antes de solicitar el análisis del Agente Editor.`
        : "No se encontró una oportunidad futura estructurada que superase las puertas deterministas. No se ha fabricado ninguna propuesta.",
      result.outcome === "partial" || result.outcome === "technical_failure" ? "warning" : saved ? "success" : "info");
    } catch (error) {
      discovery.result = null;
      setNotice(helpers.getFriendlyError(error, "No se pudo completar el descubrimiento oficial. No se creó ningún borrador ni mercado."), "error");
    } finally {
      discovery.inFlight = false;
      state.busy = false;
      renderWorkspace();
      document.querySelector("#observatory-official-title")?.scrollIntoView({ block: "nearest" });
    }
  }

  async function loadTwitchTopGames() {
    state.busy = true;
    state.observatory.searchProvider = "twitch";
    renderWorkspace();
    try {
      const result = await invokeObservatory("twitch-top-games");
      state.observatory.searchResults = Array.isArray(result.items) ? result.items : [];
      setNotice(state.observatory.searchResults.length
        ? "Juegos destacados de Twitch listos para añadir al seguimiento privado. El puesto observado no crea una propuesta sin historial."
        : "Twitch no devolvió categorías destacadas en esta consulta.", "info");
    } catch (error) {
      state.observatory.searchResults = [];
      setNotice(helpers.getFriendlyError(error, "Twitch no está disponible o no está configurado."), "error");
    } finally {
      state.busy = false;
      renderWorkspace();
    }
  }

  async function addObservatoryEntity(externalId) {
    const entity = state.observatory.searchResults.find((item) => String(item.external_id) === String(externalId));
    if (!entity) return;
    state.busy = true;
    renderWorkspace();
    try {
      await invokeObservatory("add-watch", { entity: {
        provider: entity.provider,
        entity_type: entity.entity_type,
        external_id: entity.external_id,
        label: entity.label,
        canonical_url: entity.canonical_url,
        configuration: { added_from: "manual_provider_search" }
      } });
      state.observatory.searchResults = [];
      await loadObservatory();
      setNotice("Fuente añadida al seguimiento privado. No se ha creado ni publicado ningún mercado.", "success");
    } catch (error) {
      setNotice(helpers.getFriendlyError(error, "No se pudo añadir la fuente al seguimiento."), "error");
      state.busy = false;
      renderWorkspace();
    }
  }

  async function pauseObservatoryEntity(entityId) {
    state.busy = true;
    renderWorkspace();
    try {
      await invokeObservatory("remove-watch", { entity_id: entityId });
      await loadObservatory();
      setNotice("Seguimiento pausado. Los datos históricos conservan su trazabilidad y retención.", "success");
    } catch (error) {
      setNotice(helpers.getFriendlyError(error, "No se pudo pausar esta fuente."), "error");
      state.busy = false;
      renderWorkspace();
    }
  }

  async function openObservatoryDetails(signalId, { preserveNotice = false } = {}) {
    state.busy = true;
    renderWorkspace();
    try {
      const data = await invokeObservatory("details", { signal_id: signalId });
      state.observatory.selected = data.detail || null;
      if (!preserveNotice) setNotice("Expediente privado cargado. Los hechos, el contexto y la inferencia permanecen separados.", "info");
    } catch (error) {
      setNotice(helpers.getFriendlyError(error, "No se pudo abrir el expediente de la señal."), "error");
    } finally {
      state.busy = false;
      renderWorkspace();
      document.querySelector(".observatory-detail")?.focus();
    }
  }

  async function analyzeObservatorySignal(signalId) {
    state.busy = true;
    setNotice("El Agente Editor está comprobando integridad, previsibilidad y Plan de Resolución.", "info");
    renderWorkspace();
    try {
      const result = await invokeObservatory("request-expert-analysis", { signal_id: signalId });
      setNotice(result.expert?.message || "Análisis estructurado terminado. No se ha guardado ningún borrador.", "success");
      await openObservatoryDetails(signalId, { preserveNotice: true });
    } catch (error) {
      state.busy = false;
      setNotice(helpers.getFriendlyError(error, "El Agente Editor no pudo completar el análisis. La señal sigue privada."), "error");
      renderWorkspace();
    }
  }

  async function discoverObservatoryContext(signalId) {
    state.busy = true;
    setNotice("Buscando contexto permitido y oportunidades trazables. Puede devolver cero propuestas.", "info");
    renderWorkspace();
    try {
      const result = await invokeObservatory("discover-context", { signal_id: signalId });
      setNotice(result.discovery?.message || "Descubrimiento editorial terminado sin crear borradores.", "success");
      await openObservatoryDetails(signalId, { preserveNotice: true });
    } catch (error) {
      state.busy = false;
      setNotice(helpers.getFriendlyError(error, "No se pudo ampliar el contexto. No se ha fabricado ninguna propuesta."), "error");
      renderWorkspace();
    }
  }

  async function prepareObservatorySignal(signalId) {
    state.busy = true;
    setNotice("Preparando una copia editable. Todavía no se guarda, valida ni publica.", "info");
    renderWorkspace();
    try {
      const data = await invokeObservatory("prepare-draft", { signal_id: signalId });
      const prefill = data.prefill || {};
      const fields = prefill.fields || {};
      const alternatives = String(fields.alternative_sources || "").split(/\r?\n/).map((url) => url.trim()).filter(Boolean).map((url) => ({ url }));
      state.radarPrefill = {
        originType: prefill.origin?.type || "observatory_signal",
        originId: prefill.origin?.id || signalId,
        expertRunId: prefill.origin?.expert_run_id,
        contract: prefill.contract || {},
        sources: Array.isArray(prefill.sources) ? prefill.sources : [],
        proposedFields: fields
      };
      state.selected = {
        draft: {
          ...fields,
          id: null,
          content_version: null,
          workflow_status: "draft_incomplete",
          primary_source: fields.primary_source_url ? { url: fields.primary_source_url } : {},
          alternative_sources: alternatives
        },
        deterministic_issues: [],
        latest_review: null,
        audit: [],
        observatory_origin: prefill.origin || {},
        expert_recommendation: prefill.expert || {}
      };
      state.view = "drafts";
      setNotice("Propuesta aplicada al formulario. Revísala: solo se vinculará el plan al guardar este nuevo borrador.", "warning");
    } catch (error) {
      setNotice(helpers.getFriendlyError(error, "No se pudo preparar la propuesta. La señal no se ha modificado."), "error");
    } finally {
      state.busy = false;
      renderWorkspace();
      document.querySelector("#admin-market-form")?.scrollIntoView({ behavior: "smooth", block: "start" });
      document.querySelector('#admin-market-form [name="question"]')?.focus({ preventScroll: true });
    }
  }

  async function dismissObservatorySignal(signalId) {
    state.busy = true;
    renderWorkspace();
    try {
      await invokeObservatory("dismiss-signal", { signal_id: signalId });
      state.observatory.selected = null;
      await loadObservatory();
      setNotice("Señal descartada con trazabilidad privada. No afecta al proveedor ni a los mercados.", "success");
    } catch (error) {
      setNotice(helpers.getFriendlyError(error, "No se pudo descartar la señal."), "error");
      state.busy = false;
      renderWorkspace();
    }
  }

  async function refreshRadarExpertAnalysis(candidateId, { force = false, preparationRevision = "" } = {}) {
    const payload = {
      origin_type: "radar_candidate",
      origin_id: candidateId,
      ...(preparationRevision ? { preparation_revision: preparationRevision } : {})
    };
    try {
      const analysis = await invokeMarketExpert(force ? "revalidate-analysis" : "analyze-origin", payload);
      const data = await invokeMarketExpert("get-analysis", {
        origin_type: "radar_candidate",
        origin_id: candidateId
      });
      const run = expertRun(data) || expertRun(analysis);
      if (!run) {
        throw operationError(
          "MARKET_EXPERT_ANALYSIS_NOT_PERSISTED",
          "El Agente Editor no devolvió un dictamen persistido y vigente. La candidata no se ha preparado."
        );
      }
      if (state.radar.selected?.id === candidateId) {
        state.radar.selected = { ...state.radar.selected, expert_analysis: run };
      }
      document.dispatchEvent(new CustomEvent("atinara:radar-expert-analysis-complete", {
        detail: { candidateId, run }
      }));
      return { analysis, run };
    } catch (error) {
      document.dispatchEvent(new CustomEvent("atinara:radar-expert-analysis-failed", {
        detail: { candidateId }
      }));
      throw error;
    }
  }

  async function analyzeRadarCandidate(candidateId) {
    state.busy = true;
    setNotice("El Agente Editor está analizando el expediente en modo de solo lectura…", "info");
    renderWorkspace();
    try {
      const result = await refreshRadarExpertAnalysis(candidateId, { force: true });
      const warnings = Array.isArray(result.analysis?.warnings) ? result.analysis.warnings : [];
      setNotice(
        warnings.includes("AI_TELEMETRY_WRITE_FAILED")
          ? "Dictamen experto actualizado. La observabilidad quedó incompleta; el resultado se conserva y no se repetirá la inferencia."
          : "Dictamen experto actualizado sin preparar, guardar ni publicar ningún mercado.",
        warnings.includes("AI_TELEMETRY_WRITE_FAILED") ? "warning" : "success",
      );
    } catch (error) {
      setNotice(expertErrorMessage(error, "El análisis experto no está disponible. El Radar sigue operativo."), "error");
    } finally {
      state.busy = false;
      renderWorkspace();
    }
  }

  async function runBindingAction(action, bindingId) {
    state.busy = true;
    const labels = { "verify-binding": "Validando el contrato y la disponibilidad del proveedor…", "arm-binding": "Armando el monitor…", "pause-binding": "Pausando el monitor…" };
    setNotice(labels[action] || "Actualizando el Plan de Resolución…", "info");
    renderWorkspace();
    try {
      const result = await invokeSourceMonitor(action, { binding_id: bindingId });
      await loadObservatory();
      const issues = Array.isArray(result.binding?.validation?.issues) ? result.binding.validation.issues : [];
      setNotice(issues.length
        ? `El contrato permanece bloqueado: ${issues.join(", ")}.`
        : action === "arm-binding" ? "Monitor armado. La publicación volverá a comprobarlo en Supabase." : action === "pause-binding" ? "Monitor pausado con trazabilidad." : "Contrato validado y bloqueado para esta versión.", issues.length ? "warning" : "success");
      renderWorkspace();
    } catch (error) {
      state.busy = false;
      setNotice(helpers.getFriendlyError(error, "La operación fue bloqueada de forma segura. El borrador sigue privado."), "error");
      renderWorkspace();
    }
  }

  async function loadView(view) {
    if (state.view === "drafts" && view !== "drafts" && !canDiscardDraftChanges()) return;
    clearGateNotice();
    state.view = view;
    state.busy = true;
    renderWorkspace();
    try {
      if (view === "drafts") await loadDrafts();
      if (view === "radar") {
        state.busy = false;
        if (!state.radar.loaded) await loadRadar(false);
        else renderWorkspace();
        return;
      }
      if (view === "observatory") {
        state.busy = false;
        await loadObservatory();
        return;
      }
      if (view === "catalog") state.catalog = await rpc("get_admin_market_catalog") || [];
      if (view === "audit") state.audit = await rpc("get_admin_market_audit", { limit_count: 200 }) || [];
      setNotice("", "info");
    } catch (error) {
      setNotice(helpers.getFriendlyError(error, "No se pudo cargar esta sección."), "error");
    } finally {
      state.busy = false;
      renderWorkspace();
    }
  }

  function managePublishedMarket(marketId, mode, trigger) {
    const label = mode === "early" ? "cerrar nuevas participaciones" : "anular el mercado";
    state.pendingAction = { marketId, mode };
    state.actionTrigger = trigger;
    const title = document.querySelector("#admin-action-dialog-title");
    const copy = document.querySelector("#admin-action-dialog-copy");
    const reason = document.querySelector("#admin-action-reason");
    const acknowledgement = document.querySelector("#admin-action-acknowledgement");
    const confirmation = document.querySelector("#admin-action-confirmation");
    const status = document.querySelector("#admin-action-dialog-status");
    const submit = document.querySelector("#admin-action-submit");
    if (!actionDialog || !title || !copy || !reason || !acknowledgement || !confirmation || !status || !submit) return;
    title.textContent = mode === "early" ? "Cerrar nuevas participaciones" : "Anular mercado de forma segura";
    copy.textContent = mode === "early"
      ? "Solo procede cuando el resultado ya es público. El periodo original se conserva para la resolución humana."
      : "La anulación es distinta del cierre anticipado: devolverá el Karma de forma atómica, no cambiará el Prestigio y quedará auditada.";
    reason.value = "";
    acknowledgement.hidden = mode !== "cancel";
    confirmation.checked = false;
    confirmation.required = mode === "cancel";
    status.hidden = true;
    status.textContent = "";
    submit.textContent = mode === "early" ? "Cerrar participaciones" : "Anular y devolver Karma";
    submit.className = mode === "early" ? "primary-button" : "danger-button";
    actionDialog.showModal();
    reason.focus();
    actionDialog.dataset.actionLabel = label;
  }

  async function executeManagedAction(event) {
    event.preventDefault();
    const pending = state.pendingAction;
    if (!pending) return;
    const reasonNode = document.querySelector("#admin-action-reason");
    const confirmation = document.querySelector("#admin-action-confirmation");
    const status = document.querySelector("#admin-action-dialog-status");
    const submit = document.querySelector("#admin-action-submit");
    const reason = reasonNode?.value.trim() || "";
    if (reason.length < 20) {
      status.textContent = "El motivo debe tener al menos 20 caracteres.";
      status.hidden = false;
      reasonNode?.focus();
      return;
    }
    if (pending.mode === "cancel" && !confirmation?.checked) {
      status.textContent = "Confirma que comprendes la devolución y el Prestigio sin cambios.";
      status.hidden = false;
      confirmation?.focus();
      return;
    }
    submit.disabled = true;
    status.textContent = "Supabase está revalidando el rol y aplicando la operación atómica…";
    status.hidden = false;
    state.busy = true;
    renderWorkspace();
    try {
      await rpc(pending.mode === "early" ? "close_market_participation_early" : "cancel_market_safely", {
        market_id_input: pending.marketId,
        reason_input: reason.trim()
      });
      state.catalog = await rpc("get_admin_market_catalog") || [];
      setNotice(pending.mode === "early"
        ? "Nuevas participaciones cerradas. El periodo original se conserva para la resolución humana."
        : "Mercado anulado. La devolución fue atómica y el Prestigio no cambió.", "success");
      actionDialog.close();
    } catch (error) {
      status.textContent = helpers.getFriendlyError(error, "La acción fue bloqueada de forma segura.");
      status.hidden = false;
    } finally {
      state.busy = false;
      submit.disabled = false;
      renderWorkspace();
    }
  }

  root.addEventListener("click", (event) => {
    const target = event.target.closest("button, a");
    if (!target || target.disabled) return;
    if (target.dataset.adminView) loadView(target.dataset.adminView);
    if (target.dataset.openDraft) openDraft(target.dataset.openDraft);
    if (target.dataset.requestReview !== undefined) requestReview();
    if (target.dataset.confirmReview !== undefined) confirmReview();
    if (target.dataset.publishDraft !== undefined) publishDraft();
    if (target.dataset.retryScheduled !== undefined) retryScheduledPublication();
    if (target.dataset.cancelScheduled !== undefined) cancelScheduledPublication();
    if (target.dataset.archiveTerminalDraft !== undefined) archiveTerminalDraft();
    if (target.dataset.recoverDraftEligibility) recoverDraftRadarEligibility(target.dataset.recoverDraftEligibility);
    if (target.dataset.radarRefresh !== undefined) {
      state.radar.parentOffset = 0;
      state.radar.parentOffsetHistory = [];
      state.radar.reconciliationOffset = 0;
      loadRadar(true);
    }
    if (target.dataset.radarPage !== undefined) {
      const nextOffset = Math.max(0, Number(target.dataset.radarPage) || 0);
      if (nextOffset !== state.radar.parentOffset) state.radar.parentOffsetHistory.push(state.radar.parentOffset);
      state.radar.parentOffset = nextOffset;
      loadRadar(false);
    }
    if (target.dataset.radarPagePrevious !== undefined) {
      state.radar.parentOffset = state.radar.parentOffsetHistory.pop() ?? 0;
      loadRadar(false);
    }
    if (target.dataset.radarReconciliationPage !== undefined) {
      state.radar.reconciliationOffset = Math.max(0, Number(target.dataset.radarReconciliationPage) || 0);
      loadRadar(false);
    }
    if (target.dataset.radarToggleGroup) {
      const groupKey = target.dataset.radarToggleGroup;
      if (state.radar.expandedGroups.has(groupKey)) state.radar.expandedGroups.delete(groupKey);
      else state.radar.expandedGroups.add(groupKey);
      renderWorkspace();
      const toggle = [...root.querySelectorAll("[data-radar-toggle-group]")]
        .find((button) => button.dataset.radarToggleGroup === groupKey);
      toggle?.focus({ preventScroll: true });
    }
    if (target.dataset.radarRejectionFilter) {
      state.radar.rejectionReason = target.dataset.radarRejectionFilter;
      renderWorkspace();
      document.querySelector(".radar-rejections")?.scrollIntoView({ block: "nearest" });
    }
    if (target.dataset.radarDetails) openRadarDetails(target.dataset.radarDetails);
    if (target.dataset.radarReconciliation) openRadarReconciliation(target.dataset.radarReconciliation);
    if (target.dataset.radarPrepare) prepareRadarCandidate(target.dataset.radarPrepare);
    if (target.dataset.radarDomainDecision) reviewRadarDomain(target.dataset.radarDomainDecision);
    if (target.dataset.radarDismiss) dismissRadarCandidate(target.dataset.radarDismiss);
    if (target.dataset.radarExpert) analyzeRadarCandidate(target.dataset.radarExpert);
    if (target.dataset.radarCloseDetail !== undefined) {
      const closedCandidateId = state.radar.selected?.id || "";
      state.radar.selected = null;
      renderWorkspace();
      document.querySelector(`[data-radar-details="${CSS.escape(closedCandidateId)}"]`)?.focus();
    }
    if (target.dataset.radarCloseReconciliation !== undefined) {
      const closedReconciliationId = state.radar.selectedReconciliation?.id || "";
      state.radar.selectedReconciliation = null;
      renderWorkspace();
      document.querySelector(`[data-radar-reconciliation="${CSS.escape(closedReconciliationId)}"]`)?.focus();
    }
    if (target.dataset.observatoryRefresh !== undefined) loadObservatory({ refresh: true });
    if (target.dataset.observatoryTopGames !== undefined) loadTwitchTopGames();
    if (target.dataset.observatoryAdd) addObservatoryEntity(target.dataset.observatoryAdd);
    if (target.dataset.observatoryPause) pauseObservatoryEntity(target.dataset.observatoryPause);
    if (target.dataset.observatoryDetails) openObservatoryDetails(target.dataset.observatoryDetails);
    if (target.dataset.observatoryAnalyze) analyzeObservatorySignal(target.dataset.observatoryAnalyze);
    if (target.dataset.observatoryDiscoverContext) discoverObservatoryContext(target.dataset.observatoryDiscoverContext);
    if (target.dataset.observatoryPrepare) prepareObservatorySignal(target.dataset.observatoryPrepare);
    if (target.dataset.observatoryDismiss) dismissObservatorySignal(target.dataset.observatoryDismiss);
    if (target.dataset.bindingVerify) runBindingAction("verify-binding", target.dataset.bindingVerify);
    if (target.dataset.bindingArm) runBindingAction("arm-binding", target.dataset.bindingArm);
    if (target.dataset.bindingPause) runBindingAction("pause-binding", target.dataset.bindingPause);
    if (target.dataset.observatoryClose !== undefined) {
      const closedSignalId = state.observatory.selected?.signal?.id || "";
      state.observatory.selected = null;
      renderWorkspace();
      document.querySelector(`[data-observatory-details="${CSS.escape(closedSignalId)}"]`)?.focus();
    }
    if (target.dataset.closeEarly) managePublishedMarket(target.dataset.closeEarly, "early", target);
    if (target.dataset.cancelMarket) managePublishedMarket(target.dataset.cancelMarket, "cancel", target);
  });

  root.addEventListener("input", (event) => {
    const form = event.target.closest("#admin-market-form");
    if (form) setDraftDirtyState(form);
  });

  root.addEventListener("change", (event) => {
    const form = event.target.closest("#admin-market-form");
    if (form) setDraftDirtyState(form);
  });

  root.addEventListener("submit", (event) => {
    event.preventDefault();
    if (event.target.id === "radar-filters") {
      const data = new FormData(event.target);
      ["provider", "category", "query", "horizon", "quality", "order"].forEach((name) => {
        const value = data.get(name);
        state.radar[name] = typeof value === "string" ? value.trim() : "";
      });
      state.radar.parentOffset = 0;
      state.radar.parentOffsetHistory = [];
      state.radar.reconciliationOffset = 0;
      loadRadar(false);
      return;
    }
    if (event.target.id === "observatory-search-form") {
      searchObservatory(event.target);
      return;
    }
    if (event.target.id === "observatory-official-discovery-form") {
      discoverOfficialOpportunities(event.target);
      return;
    }
    if (event.target.id === "observatory-filters") {
      const data = new FormData(event.target);
      ["provider", "marketability", "expertStatus", "query"].forEach((name) => {
        state.observatory[name] = String(data.get(name) || "").trim();
      });
      renderWorkspace();
      return;
    }
    if (event.target.id === "admin-draft-filters") {
      const data = new FormData(event.target);
      const query = data.get("query");
      const status = data.get("status");
      state.query = typeof query === "string" ? query.trim() : "";
      state.status = typeof status === "string" ? status.trim() : "";
      state.busy = true;
      renderWorkspace();
      loadDrafts({ preserveSelection: false }).then(() => {
        state.busy = false;
        renderWorkspace();
      }).catch((error) => {
        state.busy = false;
        setNotice(helpers.getFriendlyError(error, "No se pudieron aplicar los filtros."), "error");
        renderWorkspace();
      });
    }
    if (event.target.id === "admin-market-form") saveDraft(event.target);
  });

  newDraftButton?.addEventListener("click", () => {
    if (!canDiscardDraftChanges()) return;
    clearGateNotice();
    state.view = "drafts";
    state.selected = null;
    state.radarPrefill = null;
    setNotice("Nuevo borrador privado. Solo el identificador es obligatorio para guardarlo por primera vez.", "info");
    renderWorkspace();
    document.querySelector('[name="market_slug"]')?.focus();
  });

  actionForm?.addEventListener("submit", executeManagedAction);
  document.querySelector("[data-admin-dialog-cancel]")?.addEventListener("click", () => {
    actionDialog?.close();
  });
  actionDialog?.addEventListener("close", () => {
    state.pendingAction = null;
    state.actionTrigger?.focus({ preventScroll: true });
    state.actionTrigger = null;
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && state.radar.selected) {
      const closedCandidateId = state.radar.selected.id || "";
      state.radar.selected = null;
      renderWorkspace();
      document.querySelector(`[data-radar-details="${CSS.escape(closedCandidateId)}"]`)?.focus();
    }
    if (event.key === "Escape" && state.radar.selectedReconciliation) {
      const closedReconciliationId = state.radar.selectedReconciliation.id || "";
      state.radar.selectedReconciliation = null;
      renderWorkspace();
      document.querySelector(`[data-radar-reconciliation="${CSS.escape(closedReconciliationId)}"]`)?.focus();
    }
    if (event.key === "Escape" && state.observatory.selected) {
      const closedSignalId = state.observatory.selected.signal?.id || "";
      state.observatory.selected = null;
      renderWorkspace();
      document.querySelector(`[data-observatory-details="${CSS.escape(closedSignalId)}"]`)?.focus();
    }
  });

  window.addEventListener("beforeunload", (event) => {
    if (!state.draftDirty) return;
    event.preventDefault();
    event.returnValue = "";
  });

  window.atinaraMarketAdminBridge = Object.freeze({
    prepareRadarCandidate,
    openPrivateIssueDraftForm,
    refreshRadarExpertAnalysis,
    runDraftValidationSingleInferenceSmoke,
    publishDraft,
  });

  async function applyAuth(auth) {
    state.auth = auth;
    if (!auth?.isAuthenticated) {
      renderAccess("Inicia sesión para gestionar mercados", true);
      return;
    }
    if (!auth.isAdmin) {
      renderAccess("Tu cuenta no tiene permiso de administración");
      return;
    }
    state.busy = true;
    try {
      await loadDrafts();
      setNotice("Permiso administrativo comprobado. Los borradores permanecen privados.", "success");
      state.busy = false;
      renderWorkspace();
    } catch (error) {
      state.busy = false;
      const message = helpers.getFriendlyError(error, "No se pudo comprobar el permiso administrativo.");
      if (/sesión|permiso/i.test(message)) renderAccess(message, /sesión/i.test(message));
      else {
        setNotice(message, "error");
        renderWorkspace();
      }
    }
  }

  if (!client || !window.orakloAuth) {
    renderAccess("La conexión segura no está disponible");
  } else {
    window.orakloAuth.onChange(applyAuth);
  }
})();
