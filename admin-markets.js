(function initAdminMarkets() {
  "use strict";

  const root = document.querySelector("#admin-markets-root");
  const newDraftButton = document.querySelector("#admin-new-draft");
  const actionDialog = document.querySelector("#admin-market-action-dialog");
  const actionForm = document.querySelector("#admin-market-action-form");
  const client = window.orakloSupabase;
  const helpers = window.atinaraMarketAdmin;
  if (!root || !helpers) return;

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
    draftDirty: false,
    draftBaseline: null,
    pendingAction: null,
    actionTrigger: null,
    radar: {
      candidates: [],
      groups: [],
      rejected: { total: 0, counts: {}, items: [] },
      providers: [],
      errors: [],
      selected: null,
      cached: false,
      cooldownUntil: 0,
      provider: "all",
      category: "",
      query: "",
      horizon: "180d",
      quality: "review",
      order: "recommended",
      rejectionReason: "current"
    },
    radarPrefill: null,
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
      errors: []
    }
  };

  const RADAR_CATEGORIES = ["Lanzamientos", "Eventos", "Industria", "Streamers", "Reviews/Premios", "YouTubers"];
  const RADAR_PROVIDER_LABELS = { polymarket: "Polymarket", kalshi: "Kalshi", tavily: "Ideas gaming", gemini: "Gemini" };
  const RADAR_POLICY_VERSION = "atinara-prediction-policy-v3";
  const RADAR_REASON_LABELS = {
    EVENT_ALREADY_RESOLVED: "Evento ya resuelto",
    SOURCE_STALE: "Información desactualizada",
    EVENT_OUTSIDE_CONTRACT: "Contrato no compatible",
    SUBJECT_NOT_ANNOUNCED: "Requisito previo no cumplido",
    TEMPORAL_INCOHERENCE: "Fechas incompatibles",
    INVALID_OR_UNVERIFIED_SOURCE: "Fuente no verificable",
    DUPLICATE_MARKET: "Mercado duplicado",
    PROVIDER_NOT_OPEN: "Mercado de origen cerrado",
    PROVIDER_EVENT_NOT_FOUND: "Evento de origen no disponible",
    PROVIDER_CHILD_NOT_FOUND: "Opción de origen no disponible",
    VERIFICATION_REQUIRED: "Comprobación pendiente",
    VERIFICATION_EXPIRED: "Comprobación caducada"
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
    PROVIDER_EVENT_NOT_FOUND: "El proveedor ya no ofrece el evento indicado.",
    PROVIDER_CHILD_NOT_FOUND: "La opción ya no pertenece al evento de origen.",
    VERIFICATION_REQUIRED: "La comprobación automática no dispone todavía de información suficiente.",
    VERIFICATION_EXPIRED: "La comprobación ha caducado y debe repetirse antes de preparar el borrador."
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
    "tavily-context": "Contexto oficial"
  };

  function escapeHtml(value) {
    return String(value ?? "")
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

  function displayNumber(value) {
    const number = Number(value);
    return Number.isFinite(number)
      ? new Intl.NumberFormat("es-ES", { notation: Math.abs(number) >= 1000000 ? "compact" : "standard", maximumFractionDigits: 1 }).format(number)
      : "No disponible";
  }

  function displayProbability(value) {
    const number = Number(value);
    const normalized = number > 1 && number <= 100 ? number / 100 : number;
    return Number.isFinite(normalized) && normalized >= 0 && normalized <= 1
      ? new Intl.NumberFormat("es-ES", { style: "percent", maximumFractionDigits: 1 }).format(normalized)
      : "No disponible";
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

  function radarCandidatePolicyCurrent(candidate) {
    return candidate?.eligibility_policy_version === RADAR_POLICY_VERSION;
  }

  function radarReasonDescription(candidate) {
    if (!radarCandidatePolicyCurrent(candidate)) {
      return "Esta evaluación pertenece al criterio anterior y debe volver a comprobarse antes de tomarla como válida.";
    }
    const code = candidate?.verification_reason_code || "";
    const reason = String(candidate?.verification_reason || "").trim();
    const isLegacyUnannouncedRule = code === "SUBJECT_NOT_ANNOUNCED"
      && /(?:premisa presupone|producto o evento que no ha sido anunciado|no ha sido anunciado oficialmente)/i.test(reason);
    const looksTechnicalOrEnglish = /^[A-Z0-9_]+$/.test(reason)
      || /\b(?:official confirmation|provider|market|source|found|release before|not open|will be)\b/i.test(reason);
    return reason && !looksTechnicalOrEnglish && !isLegacyUnannouncedRule
      ? reason
      : RADAR_REASON_DESCRIPTIONS[code] || "La candidata no cumple las condiciones para preparar un borrador.";
  }

  function radarVerificationLabel(candidate) {
    if (!radarCandidatePolicyCurrent(candidate)) return "Pendiente de reevaluación";
    if (candidate?.verification_status === "verified_open") return "Verificado";
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
    if (error) throw error;
    return data || {};
  }

  async function invokeObservatory(action, payload = {}) {
    const { data, error } = await client.functions.invoke("data-observatory", {
      body: { action, ...payload }
    });
    if (error) throw error;
    return data || {};
  }

  async function invokeMarketExpert(action, payload = {}) {
    const { data, error } = await client.functions.invoke("market-expert", {
      body: { action, ...payload }
    });
    if (error) throw error;
    return data || {};
  }

  async function invokeSourceMonitor(action, payload = {}) {
    const { data, error } = await client.functions.invoke("market-source-monitor", {
      body: { action, ...payload }
    });
    if (error) throw error;
    return data || {};
  }

  function setNotice(message, tone = "info") {
    state.notice = message;
    state.noticeTone = tone;
  }

  function noticeMarkup() {
    return state.notice ? `<p class="admin-status-message admin-status-${escapeHtml(state.noticeTone)}" role="status">${escapeHtml(state.notice)}</p>` : "";
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
    const issues = [...deterministic, ...semantic];
    const issueItems = issues.map((issue, issueIndex) => `
      <li id="admin-issue-${escapeHtml(issue.field)}-${issueIndex}" data-field="${escapeHtml(issue.field)}" data-content-issue="true">
        <code>${escapeHtml(issue.code)}</code>
        <strong>${escapeHtml(issue.field || "Revisión")}</strong>
        <span>${escapeHtml(issue.message)}</span>
      </li>`).join("");
    const issueMarkup = issues.length
      ? `<ol class="admin-validation-reasons">${issueItems}</ol>`
      : '<p class="admin-empty-state">No hay motivos bloqueantes registrados para esta versión.</p>';
    const noteItems = Array.isArray(latestContentReview?.editorial_notes)
      ? latestContentReview.editorial_notes.map((note) => `<li>${escapeHtml(note)}</li>`).join("")
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
          <section><h4>Intentos</h4><ol>${history.slice(0, 12).map((attempt) => `<li><strong>${escapeHtml(attempt.status)}</strong><span>v${escapeHtml(attempt.draft_version)} · ${escapeHtml(attempt.classification)} · ${escapeHtml(displayDate(attempt.completed_at || attempt.started_at))}</span></li>`).join("") || "<li>Sin intentos.</li>"}</ol></section>
          <section><h4>Versiones</h4><ol>${versions.slice(0, 12).map((version) => `<li><strong>v${escapeHtml(version.content_version)}</strong><span>${escapeHtml(version.change_origin)} · <code>${escapeHtml(String(version.content_fingerprint || "").slice(0, 16))}…</code></span></li>`).join("") || "<li>Sin snapshots.</li>"}</ol></section>
        </div>
      </details>`;
    const bindingReasons = Array.isArray(binding.reasons) ? binding.reasons : [];
    const bindingMarkup = `
      <p class="admin-binding-compatibility" data-compatible="${binding.compatible === true}">
        <strong>Plan de Resolución:</strong>
        ${binding.required === false ? "No requerido para este borrador manual." : binding.compatible === true
          ? `Compatible · plan v${escapeHtml(binding.plan_version || "—")} · ${escapeHtml(binding.binding_status || "draft")}`
          : `No compatible · ${escapeHtml(bindingReasons.join(", ") || "requiere revisión")}`}
      </p>`;
    const canReview = ["draft_ready", "review_rejected", "review_inconclusive", "review_unavailable"].includes(draft.workflow_status) || technicalAttempt;
    const canConfirm = Boolean(effective)
      && draft.workflow_status === "review_approved"
      && draft.review_status === "approved"
      && binding.compatible === true;
    const canPublish = draft.workflow_status === "human_confirmed";
    const locked = ["published", "early_closed", "cancelled", "pending_resolution", "resolved", "annulled"].includes(draft.workflow_status);

    return `
      <section class="admin-review-gate" aria-labelledby="admin-review-title" data-latest-attempt-classification="${escapeHtml(latestAttempt?.classification || "none")}">
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
        ${notes}
        ${historyMarkup}
        <div class="admin-gate-actions">
          <button class="primary-button" type="button" data-request-review data-state-allowed="${canReview && !locked}"${disabled()}${canReview && !locked ? "" : " disabled"}>${technicalAttempt ? "Reintentar revisión" : "Solicitar nueva revisión"}</button>
          <button class="secondary-button" type="button" data-confirm-review data-state-allowed="${canConfirm}"${disabled()}${canConfirm ? "" : " disabled"}>Confirmar humanamente</button>
        </div>
        <p class="admin-gate-rule">No existe una acción para omitir un rechazo o aceptar el riesgo. Cualquier cambio esencial invalida esta revisión.</p>
        <fieldset class="admin-publish-controls" data-state-allowed="${canPublish}"${canPublish ? "" : " disabled"}>
          <legend>Programación o publicación</legend>
          <label><span>Programar para (opcional)</span><input type="datetime-local" step="0.001" name="scheduled_for" form="admin-market-form"></label>
          <button class="primary-button" type="button" data-publish-draft data-state-allowed="${canPublish}"${disabled()}>${canPublish ? "Revalidar y publicar" : "Falta confirmación humana"}</button>
          <p>Supabase volverá a comprobar rol, estado, versión, huella y aprobación vigente.</p>
        </fieldset>
      </section>`;
  }

  function formMarkup(payload) {
    const draft = payload?.draft || { market_slug: "", content_version: null, workflow_status: "draft_incomplete" };
    const radarOrigins = payload?.radar_origins || {};
    const radarCandidate = payload?.radar_candidate || null;
    const observatorySignal = payload?.observatory_signal || null;
    const locked = ["published", "early_closed", "cancelled", "pending_resolution", "resolved", "annulled"].includes(draft.workflow_status);
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
        <form id="admin-market-form" novalidate data-draft-id="${escapeHtml(draft.id || "")}" data-version="${escapeHtml(draft.content_version || "")}">
          <div class="admin-section-heading">
            <div><p class="eyebrow">Borrador privado</p><h2>${draft.id ? "Editar mercado" : "Crear mercado"}</h2></div>
            ${workflowBadge(draft.workflow_status || "draft_incomplete")}
          </div>
          ${radarCandidate ? `<aside class="radar-prefill-notice"><strong>Pre-rellenado desde ${escapeHtml(RADAR_PROVIDER_LABELS[radarCandidate.provider] || radarCandidate.provider)}.</strong><span>Nada se ha guardado, revisado, aprobado, programado ni publicado. Completa y revisa los campos antes de guardar el borrador privado.</span></aside>` : ""}
          ${observatorySignal ? `<aside class="radar-prefill-notice observatory-prefill-notice"><strong>Propuesta del Observatorio desde ${escapeHtml(OBSERVATORY_PROVIDER_LABELS[observatorySignal.provider] || observatorySignal.provider)}.</strong><span>Los datos observados, la inferencia editorial y las fuentes vinculantes permanecen separados. Nada se ha guardado, aprobado, programado ni publicado.</span></aside>` : ""}
          ${locked ? '<p class="admin-locked-notice"><strong>Campos esenciales bloqueados:</strong> el mercado ya fue publicado. Utiliza las acciones posteriores seguras.</p>' : ""}
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
              ${f("timezone", "Zona horaria IANA", "text", { value: draft.timezone || "Europe/Madrid", required: true })}
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
    return state.radar.providers
      .filter((item) => item.provider === provider)
      .sort((left, right) => Date.parse(right.fetched_at || 0) - Date.parse(left.fetched_at || 0))[0] || null;
  }

  function radarProviderMarkup() {
    const providers = ["polymarket", "kalshi", "tavily", "gemini"];
    return `<section class="radar-provider-strip" aria-label="Estado de proveedores">
      ${providers.map((provider) => {
        const status = latestProviderStatus(provider);
        const label = status?.error_code === "PROVIDER_NOT_CONFIGURED" ? "No configurado" : status?.status === "available" ? "Disponible" : status?.status === "cached" ? "En caché" : status?.status === "rate_limited" ? "Límite temporal" : status?.status ? "Con incidencia" : "Sin consultar";
        return `<article class="radar-provider-card" data-provider-status="${escapeHtml(status?.status || "idle")}">
          <div><strong>${escapeHtml(RADAR_PROVIDER_LABELS[provider])}</strong><span>${escapeHtml(label)}</span></div>
          <small>${status ? `${escapeHtml(displayDate(status.fetched_at))} · ${escapeHtml(status.result_count || 0)} candidatas${status.is_cached ? " · caché" : " · nuevos"}` : "Pulsa Actualizar fuentes para consultar."}</small>
        </article>`;
      }).join("")}
    </section>`;
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
        <button class="secondary-button" type="submit">Aplicar filtros</button>
        <button class="primary-button" type="button" data-radar-refresh${state.busy || cooldown ? " disabled" : ""}>${state.busy ? "Actualizando…" : cooldown ? `Disponible en ${cooldown} s` : "Actualizar fuentes"}</button>
      </div>
    </form>`;
  }

  function radarCandidateReady(candidate) {
    const expiresAt = Date.parse(candidate.verification_expires_at || "");
    return candidate.state === "available"
      && candidate.verification_status === "verified_open"
      && candidate.eligibility_policy_version === RADAR_POLICY_VERSION
      && Number.isFinite(expiresAt)
      && expiresAt > Date.now()
      && !candidate.is_stale
      && !(Array.isArray(candidate.duplicate_matches) && candidate.duplicate_matches.length);
  }

  function radarChildMarkup(candidate) {
    const ready = radarCandidateReady(candidate);
    const status = radarVerificationLabel(candidate);
    return `<li class="radar-event-option">
      <div class="radar-event-option-copy">
        <strong>${escapeHtml(candidate.atinara_question || candidate.source_question || candidate.source_title)}</strong>
        <span>${escapeHtml(displayProbability(candidate.source_probability_yes ?? candidate.source_probability))} · ${escapeHtml(displayDate(candidate.source_close_at))}</span>
      </div>
      <div class="radar-event-option-actions">
        <span class="radar-quality-badge" data-quality="${escapeHtml(candidate.quality_status)}">${escapeHtml(status)}</span>
        <button class="primary-button" type="button" data-radar-details="${escapeHtml(candidate.id)}">Detalles</button>
        <button class="primary-button" type="button" data-radar-prepare="${escapeHtml(candidate.id)}"${ready ? "" : " disabled"}>Preparar</button>
      </div>
    </li>`;
  }

  function radarGroupMarkup(group) {
    const candidates = Array.isArray(group.top_candidates) && group.top_candidates.length
      ? group.top_candidates
      : Array.isArray(group.candidates) ? group.candidates.slice(0, 3) : [];
    const hiddenCount = Math.max(0, Number(group.child_count || group.candidates?.length || 0) - candidates.length);
    const childCount = Number(group.child_count || group.candidates?.length || candidates.length);
    const summary = childCount === 1
      ? "1 opción encontrada para este evento."
      : `${childCount} opciones del mismo evento. Se muestran las tres más relevantes.`;
    return `<article class="radar-candidate-card radar-event-card" data-verification="${escapeHtml(group.verification_status)}" data-child-count="${escapeHtml(childCount)}">
      <header>
        <div><span class="radar-provider-badge">${escapeHtml(RADAR_PROVIDER_LABELS[group.provider] || group.provider)}</span><span>${escapeHtml(group.category || "Sin clasificar")}</span></div>
        <strong class="radar-score" aria-label="Puntuación Atinara ${escapeHtml(group.quality_score || 0)} de 100">${escapeHtml(group.quality_score || 0)}<small>/100</small></strong>
      </header>
      <h3>${escapeHtml(group.title || "Evento externo")}</h3>
      <p class="radar-event-summary">${escapeHtml(summary)}</p>
      <ul class="radar-event-options">${candidates.map(radarChildMarkup).join("")}</ul>
      ${hiddenCount ? `<p class="radar-event-more">${escapeHtml(hiddenCount)} opciones adicionales disponibles en el detalle de sus candidatas.</p>` : ""}
      <footer>${externalLink(group.external_event_url, "Abrir evento original", "primary")}</footer>
    </article>`;
  }

  function radarRejectionMarkup(candidate) {
    const evidence = Array.isArray(candidate.verification_evidence) ? candidate.verification_evidence : [];
    const sourceResult = providerResultLabel(candidate.source_result);
    return `<article class="radar-rejection-card">
      <header><div><span class="radar-provider-badge">${escapeHtml(RADAR_PROVIDER_LABELS[candidate.provider] || candidate.provider)}</span><strong>${escapeHtml(radarReasonLabel(candidate.verification_reason_code))}</strong></div><time>${escapeHtml(displayDate(candidate.verified_at))}</time></header>
      <h4>${escapeHtml(candidate.atinara_question || candidate.source_question || candidate.source_title)}</h4>
      <p>${escapeHtml(radarReasonDescription(candidate))}</p>
      ${sourceResult ? `<p class="radar-provider-result"><strong>Resultado del proveedor:</strong> ${escapeHtml(sourceResult)}</p>` : ""}
      <div class="radar-rejection-links">${externalLink(candidate.external_event_url || candidate.external_market_url, "Abrir mercado original")}${evidence.slice(0, 2).map((item) => externalLink(item.url, item.title || "Abrir evidencia")).join("")}</div>
    </article>`;
  }

  function radarRejectionsMarkup() {
    const rejected = state.radar.rejected || { total: 0, counts: {}, items: [] };
    const items = Array.isArray(rejected.items) ? rejected.items : [];
    if (!items.length) return "";
    const policyItems = items.filter(radarCandidatePolicyCurrent);
    const outdatedItems = items.filter((candidate) => !radarCandidatePolicyCurrent(candidate));
    const currentItems = policyItems.filter((candidate) => candidate.verification_reason_code !== "EVENT_ALREADY_RESOLVED");
    const selectedReason = state.radar.rejectionReason;
    const visibleItems = selectedReason === "all"
      ? items
      : selectedReason === "outdated"
        ? outdatedItems
      : selectedReason === "current"
        ? currentItems
        : policyItems.filter((candidate) => candidate.verification_reason_code === selectedReason);
    const filterButton = (value, label, count) => `<button class="radar-rejection-filter" type="button" data-radar-rejection-filter="${escapeHtml(value)}" aria-pressed="${String(selectedReason === value)}"><span>${escapeHtml(label)}</span><strong>${escapeHtml(count)}</strong></button>`;
    const currentReasonCounts = policyItems.reduce((counts, candidate) => {
      const code = candidate.verification_reason_code || "VERIFICATION_REQUIRED";
      counts[code] = (counts[code] || 0) + 1;
      return counts;
    }, {});
    const reasonButtons = Object.entries(currentReasonCounts)
      .sort((left, right) => Number(right[1]) - Number(left[1]))
      .map(([code, count]) => filterButton(code, radarReasonLabel(code), count))
      .join("");
    const cards = visibleItems.length
      ? `<div class="radar-rejection-grid">${visibleItems.map(radarRejectionMarkup).join("")}</div>`
      : `<div class="admin-empty-state radar-empty"><strong>No hay rechazos con este filtro</strong><span>Elige otro motivo para consultar el archivo factual.</span></div>`;
    return `<section class="radar-rejections" aria-labelledby="radar-rejections-title">
      <header><div><p class="eyebrow">Auditoría factual</p><h3 id="radar-rejections-title">${escapeHtml(rejected.total || items.length)} candidatas registradas</h3></div><p>Los eventos ya resueltos y las evaluaciones del criterio anterior quedan ocultos por defecto. Puedes filtrar cada motivo sin exponer códigos internos.</p></header>
      <div class="radar-rejection-counts" role="group" aria-label="Filtrar candidatas no aptas por motivo">${filterButton("current", "Rechazos vigentes", currentItems.length)}${filterButton("all", "Todos", items.length)}${outdatedItems.length ? filterButton("outdated", "Criterio anterior", outdatedItems.length) : ""}${reasonButtons}</div>
      <p class="radar-rejection-summary" role="status">Mostrando ${escapeHtml(visibleItems.length)} de ${escapeHtml(items.length)} candidatas.</p>
      ${cards}
    </section>`;
  }

  function radarDetailMarkup(candidate) {
    if (!candidate) return "";
    const scores = candidate.score_breakdown || {};
    const warnings = Array.isArray(candidate.warnings) ? candidate.warnings : [];
    const missing = Array.isArray(candidate.missing_fields) ? candidate.missing_fields : [];
    const duplicates = Array.isArray(candidate.duplicate_matches) ? candidate.duplicate_matches : [];
    const tags = Array.isArray(candidate.source_tags) ? candidate.source_tags : [];
    return `<section class="radar-candidate-detail" role="dialog" aria-modal="false" aria-labelledby="radar-detail-title" tabindex="-1">
      <header><div><p class="eyebrow">Detalle privado de la candidata</p><h2 id="radar-detail-title">${escapeHtml(candidate.atinara_question || candidate.source_question)}</h2></div><button class="secondary-button" type="button" data-radar-close-detail>Cerrar</button></header>
      <div class="radar-detail-grid">
        <section><h3>Procedencia</h3><dl>
          <div><dt>Proveedor</dt><dd>${escapeHtml(RADAR_PROVIDER_LABELS[candidate.provider] || candidate.provider)}</dd></div>
          <div><dt>ID externo</dt><dd><code>${escapeHtml(candidate.external_id)}</code></dd></div>
          <div><dt>Título original</dt><dd>${escapeHtml(candidate.source_title || "No disponible")}</dd></div>
          <div><dt>Pregunta original</dt><dd>${escapeHtml(candidate.source_question || "No disponible")}</dd></div>
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
        <section><h3>Verificación factual</h3><dl>
          <div><dt>Estado</dt><dd>${escapeHtml(radarVerificationLabel(candidate))}</dd></div>
          <div><dt>Motivo</dt><dd>${escapeHtml(candidate.verification_status === "verified_open" ? "Mercado predictivo válido" : radarReasonLabel(candidate.verification_reason_code))}</dd></div>
          <div><dt>Verificada</dt><dd>${escapeHtml(displayDate(candidate.verified_at))}</dd></div>
          <div><dt>Caduca</dt><dd>${escapeHtml(displayDate(candidate.verification_expires_at))}</dd></div>
        </dl><p>${escapeHtml(radarReasonDescription(candidate))}</p>${Array.isArray(candidate.verification_evidence) ? candidate.verification_evidence.map((item, index) => externalLink(item.url, `Abrir evidencia ${index + 1}`)).join("") : ""}</section>
        <section><h3>Atinara Score</h3><dl>${Object.entries(scores).map(([key, value]) => `<div><dt>${escapeHtml(RADAR_SCORE_LABELS[key] || "Criterio adicional")}</dt><dd>${escapeHtml(value)}</dd></div>`).join("")}</dl><p>No es una predicción científica: ordena candidatas con criterios transparentes.</p></section>
        <section><h3>Revisión necesaria</h3>
          ${warnings.length ? `<ul>${warnings.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>` : "<p>Sin advertencias registradas.</p>"}
          ${missing.length ? `<p><strong>Campos sin información:</strong> ${escapeHtml(missing.join(", "))}</p>` : ""}
          ${duplicates.length ? `<ul>${duplicates.map((item) => `<li><strong>${escapeHtml(item.status)}</strong> · ${escapeHtml(item.reason)}</li>`).join("")}</ul>` : "<p>Sin duplicados deterministas.</p>"}
          ${tags.length ? `<p><strong>Tags:</strong> ${escapeHtml(tags.join(", "))}</p>` : ""}
        </section>
        <section><h3>Agente Editor</h3>${candidate.expert_analysis
          ? `<p><strong>${escapeHtml(candidate.expert_analysis.result_json?.decision || "Dictamen disponible")}</strong></p><p>${escapeHtml(candidate.expert_analysis.result_json?.summary || "Análisis estructurado guardado sin modificar el Radar.")}</p>`
          : `<p>Análisis opcional y aditivo. No cambia la aptitud, la caché ni la política determinista del Radar v17.</p>`}</section>
      </div>
      <footer><button class="secondary-button" type="button" data-radar-expert="${escapeHtml(candidate.id)}">${candidate.expert_analysis ? "Reanalizar con el Agente Editor" : "Analizar con el Agente Editor"}</button><button class="primary-button" type="button" data-radar-prepare="${escapeHtml(candidate.id)}"${radarCandidateReady(candidate) ? "" : " disabled"}>Preparar borrador</button></footer>
    </section>`;
  }

  function radarMarkup() {
    const groups = Array.isArray(state.radar.groups) ? state.radar.groups : [];
    const cards = groups.length
      ? `<div class="radar-candidate-grid">${groups.map(radarGroupMarkup).join("")}</div>`
      : `<div class="admin-empty-state radar-empty"><strong>No hay eventos con estos filtros</strong><span>Actualiza las fuentes o cambia categoría, consulta u horizonte. No se inventan mercados para llenar este estado.</span></div>`;
    const errors = state.radar.errors.length
      ? `<aside class="radar-partial-error" role="status"><strong>Actualización parcial.</strong><ul>${state.radar.errors.map((providerError) => `<li>${escapeHtml(RADAR_PROVIDER_LABELS[providerError.provider] || providerError.provider)}: ${escapeHtml(providerError["message"] || "La fuente no está disponible temporalmente.")}</li>`).join("")}</ul><span>La creación manual y las demás fuentes siguen disponibles.</span></aside>`
      : "";
    return `<section class="market-radar" aria-labelledby="market-radar-title">
      <header class="radar-heading"><div><p class="eyebrow">Administración · descubrimiento privado</p><h2 id="market-radar-title">Radar de mercados</h2><p>Descubre oportunidades gaming reales y prepara el formulario existente. Ninguna candidata se publica ni se aprueba automáticamente.</p></div><span class="radar-cache-badge">${state.radar.cached ? "Datos en caché" : "Última consulta disponible"}</span></header>
      ${radarFiltersMarkup()}
      ${radarProviderMarkup()}
      ${errors}
      <div class="radar-results-heading"><h3>${escapeHtml(groups.length)} eventos · ${escapeHtml(state.radar.candidates.length)} opciones</h3><p>Una tarjeta por evento padre. Las probabilidades y métricas externas son solo referencia administrativa.</p></div>
      ${cards}
      ${radarRejectionsMarkup()}
      ${radarDetailMarkup(state.radar.selected)}
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
      <label><span>Proveedor</span><select name="provider"><option value="all">Todos</option>${["igdb", "twitch", "youtube"].map((provider) => `<option value="${provider}"${state.observatory.provider === provider ? " selected" : ""}>${escapeHtml(OBSERVATORY_PROVIDER_LABELS[provider])}</option>`).join("")}</select></label>
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
    const metric = signal.metric_value === null || signal.metric_value === undefined
      ? "Dato no disponible"
      : `${displayNumber(signal.metric_value)}${signal.metric_unit ? ` ${escapeHtml(signal.metric_unit)}` : ""}`;
    return `<article class="observatory-signal-card" data-marketability="${escapeHtml(signal.marketability_status)}">
      <header><div><span class="radar-provider-badge">${escapeHtml(OBSERVATORY_PROVIDER_LABELS[signal.provider] || signal.provider)}</span><span>${escapeHtml(signal.atinara_category || signal.signal_type)}</span></div><time>${escapeHtml(displayDate(signal.observed_at))}</time></header>
      <h3>${escapeHtml(signal.title)}</h3>
      <dl><div><dt>Dato observado</dt><dd>${metric}</dd></div><div><dt>Aptitud</dt><dd>${escapeHtml(observatoryStatusLabel(signal.marketability_status))}</dd></div><div><dt>Resolución</dt><dd>${escapeHtml(signal.resolution_readiness || "Pendiente")}</dd></div><div><dt>Agente Editor</dt><dd>${escapeHtml(observatoryExpertLabel(signal.expert_analysis_status))}</dd></div></dl>
      <p class="observatory-factual"><strong>Hecho observado:</strong> ${escapeHtml(signal.factual_basis || "La fuente no aporta todavía una descripción factual suficiente.")}</p>
      ${signal.inference_summary ? `<p class="observatory-inference"><strong>Inferencia editorial:</strong> ${escapeHtml(signal.inference_summary)}</p>` : ""}
      <footer>${externalLink(signal.canonical_url, "Abrir origen")}
        <button class="secondary-button" type="button" data-observatory-details="${escapeHtml(signal.id)}">Ver análisis</button>
        <button class="primary-button" type="button" data-observatory-analyze="${escapeHtml(signal.id)}">${signal.expert_analysis_status === "completed" ? "Reanalizar" : "Analizar"}</button>
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
      <header class="radar-heading"><div><p class="eyebrow">Administración · inteligencia de fuentes</p><h2 id="data-observatory-title">Observatorio de datos</h2><p>Analiza señales de IGDB, Twitch y YouTube y conviértelas en borradores verificables.</p></div><span class="radar-cache-badge">Privado · sin publicación automática</span></header>
      <aside class="admin-fail-closed-notice"><strong>Las métricas externas no son resultados.</strong><span>Un dato ausente no equivale a cero o No. Toda propuesta conserva revisión, contrato y confirmación humanas.</span></aside>
      ${observatoryProviderMarkup()}${observatorySearchMarkup()}${observatoryWatchlistMarkup()}${observatoryFiltersMarkup()}
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
      state.draftBaseline = null;
      return;
    }
    const baseDraft = state.selected?.draft || {};
    state.draftBaseline = form.dataset.draftId
      ? JSON.stringify(helpers.canonicalizeDraftPayload(baseDraft))
      : null;
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
    if (!preserveSelection) state.selected = null;
  }

  async function openDraft(id) {
    if (!canDiscardDraftChanges()) return;
    state.busy = true;
    renderWorkspace();
    try {
      state.selected = await rpc("get_admin_market_draft", { draft_id_input: id });
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
        result = await rpc("save_market_draft_from_radar", { candidate_id_input: intelligencePrefill.candidateId, ...args });
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
      state.selected = await rpc("get_admin_market_draft", { draft_id_input: result.draft.id });
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

  async function requestReview() {
    const draft = state.selected?.draft;
    if (!draft) return;
    state.busy = true;
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
      state.selected = await rpc("get_admin_market_draft", { draft_id_input: draft.id });
      setNotice(data?.message || "Revisión terminada.", data?.status === "approved" ? "success" : "warning");
      await loadDrafts();
    } catch (error) {
      state.selected = await rpc("get_admin_market_draft", { draft_id_input: draft.id }).catch(() => state.selected);
      setNotice(helpers.getFriendlyError(error, "La revisión no se completó. El mercado continúa privado."), "error");
    } finally {
      state.busy = false;
      renderWorkspace();
    }
  }

  async function confirmReview() {
    const draft = state.selected?.draft;
    if (!draft) return;
    if (!window.confirm("¿Confirmas que has revisado personalmente la pregunta, criterios, periodo, fechas y fuentes de esta versión?")) return;
    state.busy = true;
    renderWorkspace();
    try {
      await rpc("confirm_market_draft_review", { draft_id_input: draft.id, expected_version_input: draft.content_version });
      state.selected = await rpc("get_admin_market_draft", { draft_id_input: draft.id });
      await loadDrafts();
      setNotice("Confirmación humana registrada. La publicación volverá a comprobar toda la versión.", "success");
    } catch (error) {
      setNotice(helpers.getFriendlyError(error, "No se pudo registrar la confirmación."), "error");
    } finally {
      state.busy = false;
      renderWorkspace();
    }
  }

  async function publishDraft() {
    const draft = state.selected?.draft;
    if (!draft) return;
    const scheduledValue = document.querySelector('[name="scheduled_for"]')?.value || "";
    const scheduledFor = scheduledValue
      ? helpers.toIsoOrEmpty(scheduledValue, draft.timezone || "Europe/Madrid")
      : null;
    if (scheduledValue && !scheduledFor) {
      setNotice("La fecha programada no es válida en la zona horaria del mercado.", "error");
      renderWorkspace();
      return;
    }
    const action = scheduledFor ? "programar" : "publicar";
    if (!window.confirm(`Supabase revalidará el rol y la revisión vigente antes de ${action}. ¿Continuar?`)) return;
    state.busy = true;
    renderWorkspace();
    try {
      const result = await rpc("publish_market_draft", {
        draft_id_input: draft.id,
        expected_version_input: draft.content_version,
        scheduled_for_input: scheduledFor
      });
      await loadDrafts({ preserveSelection: false });
      setNotice(result.status === "scheduled" ? "Mercado programado con aprobación vigente." : "Mercado publicado y estado LMSR inicializado de forma autoritativa.", "success");
    } catch (error) {
      setNotice(helpers.getFriendlyError(error, "La publicación se bloqueó de forma segura."), "error");
    } finally {
      state.busy = false;
      renderWorkspace();
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
      refresh
    };
  }

  function fallbackRadarGroups(candidates) {
    const groups = new Map();
    candidates.forEach((candidate) => {
      const key = candidate.event_group_key || `${candidate.provider || "external"}:${candidate.external_event_id || candidate.external_id}`;
      const current = groups.get(key) || {
        event_group_key: key,
        provider: candidate.provider,
        title: candidate.source_title || candidate.source_question,
        category: candidate.atinara_category || candidate.source_category,
        external_event_url: candidate.external_event_url || candidate.external_url,
        verification_status: candidate.verification_status || "needs_review",
        quality_score: Number(candidate.quality_score) || 0,
        candidates: []
      };
      current.candidates.push(candidate);
      current.quality_score = Math.max(current.quality_score, Number(candidate.quality_score) || 0);
      groups.set(key, current);
    });
    return [...groups.values()].map((group) => ({
      ...group,
      child_count: group.candidates.length,
      top_candidates: group.candidates.slice().sort((left, right) => (Number(right.quality_score) || 0) - (Number(left.quality_score) || 0)).slice(0, 3)
    }));
  }

  async function loadRadar(refresh = false) {
    state.busy = true;
    if (refresh) setNotice("Actualizando fuentes. Los proveedores pueden fallar de forma independiente.", "info");
    renderWorkspace();
    try {
      const data = await invokeRadar("discover", radarRequestPayload(refresh));
      state.radar.candidates = Array.isArray(data.candidates) ? data.candidates : [];
      state.radar.groups = Array.isArray(data.groups) && data.groups.length
        ? data.groups
        : fallbackRadarGroups(state.radar.candidates);
      state.radar.rejected = data.rejected && typeof data.rejected === "object"
        ? data.rejected
        : { total: 0, counts: {}, items: [] };
      if (!["current", "all", "outdated"].includes(state.radar.rejectionReason)
        && !Object.hasOwn(state.radar.rejected.counts || {}, state.radar.rejectionReason)) {
        state.radar.rejectionReason = "current";
      }
      state.radar.providers = Array.isArray(data.providers) ? data.providers : [];
      state.radar.errors = Array.isArray(data.errors) ? data.errors : [];
      state.radar.cached = data.cached === true;
      const cooldownMs = Math.max(0, Number(data.cooldown_seconds) || 0) * 1000;
      state.radar.cooldownUntil = Date.now() + cooldownMs;
      window.clearTimeout(state.radarCooldownTimer);
      state.radarCooldownTimer = cooldownMs
        ? window.setTimeout(() => renderWorkspace(), cooldownMs + 100)
        : null;
      state.radar.selected = null;
      const reconciledResults = Math.max(0, Number(data.reconciled_provider_results) || 0);
      const reconciliationCopy = reconciledResults
        ? ` Se corrigieron ${reconciledResults} resultado${reconciledResults === 1 ? "" : "s"} directamente con el proveedor.`
        : "";
      const radarNotice = (data.partial
        ? "Radar actualizado con incidencias parciales. Las fuentes disponibles siguen utilizables."
        : data.cached
          ? "Radar cargado desde la caché privada sin consultar proveedores."
          : "Radar actualizado sin crear ni modificar ningún mercado.") + reconciliationCopy;
      setNotice(radarNotice, data.partial ? "warning" : "success");
    } catch (error) {
      setNotice(helpers.getFriendlyError(error, "No se pudo cargar el Radar. La creación manual sigue disponible."), "error");
    } finally {
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
      if (state.radar.selected) {
        const expert = await invokeMarketExpert("get-analysis", { origin_type: "radar_candidate", origin_id: candidateId }).catch(() => null);
        state.radar.selected.expert_analysis = expert?.run || null;
      }
    } catch (error) {
      setNotice(helpers.getFriendlyError(error, "No se pudo abrir el detalle del candidato."), "error");
    } finally {
      state.busy = false;
      renderWorkspace();
      document.querySelector(".radar-candidate-detail")?.focus();
    }
  }

  async function prepareRadarCandidate(candidateId) {
    state.busy = true;
    setNotice("Comprobando estado y duplicados antes de pre-rellenar…", "info");
    renderWorkspace();
    try {
      const data = await invokeRadar("prepare", { candidate_id: candidateId });
      const candidate = data.candidate || {};
      const prefill = data.prefill || {};
      const fields = prefill.fields || {};
      const alternatives = String(fields.alternative_sources || "").split(/\r?\n/).map((url) => url.trim()).filter(Boolean).map((url) => ({ url }));
      state.radarPrefill = {
        candidateId,
        origins: prefill.origins || {},
        expertRunId: state.radar.selected?.id === candidateId ? state.radar.selected.expert_analysis?.id || null : null,
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
    } catch (error) {
      setNotice(helpers.getFriendlyError(error, "No se pudo preparar el borrador. El candidato no se ha modificado."), "error");
    } finally {
      state.busy = false;
      renderWorkspace();
      document.querySelector("#admin-market-form")?.scrollIntoView({ behavior: "smooth", block: "start" });
      document.querySelector('#admin-market-form [name="question"]')?.focus({ preventScroll: true });
    }
  }

  async function dismissRadarCandidate(candidateId) {
    state.busy = true;
    renderWorkspace();
    try {
      await invokeRadar("dismiss", { candidate_id: candidateId });
      state.radar.candidates = state.radar.candidates.filter((candidate) => candidate.id !== candidateId);
      state.radar.groups = state.radar.groups.map((group) => {
        const candidates = Array.isArray(group.candidates) ? group.candidates.filter((candidate) => candidate.id !== candidateId) : [];
        const topCandidates = Array.isArray(group.top_candidates) ? group.top_candidates.filter((candidate) => candidate.id !== candidateId) : [];
        return { ...group, candidates, top_candidates: topCandidates, child_count: candidates.length };
      }).filter((group) => group.candidates.length);
      if (state.radar.selected?.id === candidateId) state.radar.selected = null;
      setNotice("Candidata descartada y registrada en la trazabilidad privada.", "success");
    } catch (error) {
      setNotice(helpers.getFriendlyError(error, "No se pudo descartar la candidata."), "error");
    } finally {
      state.busy = false;
      renderWorkspace();
    }
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

  async function analyzeRadarCandidate(candidateId) {
    state.busy = true;
    setNotice("El Agente Editor analiza la candidata sin modificar la caché ni el criterio del Radar v17.", "info");
    renderWorkspace();
    try {
      await invokeMarketExpert("analyze-origin", { origin_type: "radar_candidate", origin_id: candidateId });
      const data = await invokeMarketExpert("get-analysis", { origin_type: "radar_candidate", origin_id: candidateId });
      state.radar.selected = { ...(state.radar.selected || {}), expert_analysis: data.run || null };
      setNotice("Dictamen experto añadido de forma aditiva. La aptitud determinista del Radar no ha cambiado.", "success");
    } catch (error) {
      setNotice(helpers.getFriendlyError(error, "El análisis experto no está disponible. El Radar v17 sigue operativo."), "error");
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
    state.view = view;
    state.busy = true;
    renderWorkspace();
    try {
      if (view === "drafts") await loadDrafts();
      if (view === "radar") {
        state.busy = false;
        await loadRadar(false);
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
    if (target.dataset.radarRefresh !== undefined) loadRadar(true);
    if (target.dataset.radarRejectionFilter) {
      state.radar.rejectionReason = target.dataset.radarRejectionFilter;
      renderWorkspace();
      document.querySelector(".radar-rejections")?.scrollIntoView({ block: "nearest" });
    }
    if (target.dataset.radarDetails) openRadarDetails(target.dataset.radarDetails);
    if (target.dataset.radarPrepare) prepareRadarCandidate(target.dataset.radarPrepare);
    if (target.dataset.radarDismiss) dismissRadarCandidate(target.dataset.radarDismiss);
    if (target.dataset.radarExpert) analyzeRadarCandidate(target.dataset.radarExpert);
    if (target.dataset.radarCloseDetail !== undefined) {
      const closedCandidateId = state.radar.selected?.id || "";
      state.radar.selected = null;
      renderWorkspace();
      document.querySelector(`[data-radar-details="${CSS.escape(closedCandidateId)}"]`)?.focus();
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
      loadRadar(false);
      return;
    }
    if (event.target.id === "observatory-search-form") {
      searchObservatory(event.target);
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
