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
      order: "recommended"
    },
    radarPrefill: null,
    radarCooldownTimer: null
  };

  const RADAR_CATEGORIES = ["Lanzamientos", "Eventos", "Industria", "Streamers", "Reviews/Premios", "YouTubers"];
  const RADAR_PROVIDER_LABELS = { polymarket: "Polymarket", kalshi: "Kalshi", tavily: "Ideas gaming", gemini: "Gemini" };
  const RADAR_ORIGIN_LABELS = {
    source: "Importado de la fuente",
    adapted: "Adaptado automáticamente",
    review: "Requiere revisión",
    missing: "Sin información"
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
    if (!value) return "";
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return "";
    try {
      const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23"
      }).formatToParts(date);
      const get = (type) => parts.find((part) => part.type === type)?.value || "";
      return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
    } catch (error) {
      console.warn(
        "Atinara: no se pudo representar una fecha administrativa.",
        error instanceof Error ? error.name : "UnknownError"
      );
      return "";
    }
  }

  function displayDate(value) {
    if (!value) return "Sin fecha";
    const date = new Date(value);
    return Number.isFinite(date.getTime())
      ? new Intl.DateTimeFormat("es-ES", { dateStyle: "medium", timeStyle: "short" }).format(date)
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

  function externalLink(url, label = "Abrir fuente") {
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== "https:") return "";
      return `<a class="text-link" href="${escapeHtml(parsed.toString())}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a>`;
    } catch {
      return "";
    }
  }

  async function invokeRadar(action, payload = {}) {
    const { data, error } = await client.functions.invoke("market-radar", {
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
    const latest = payload?.latest_review || null;
    const deterministic = Array.isArray(payload?.deterministic_issues) ? payload.deterministic_issues : [];
    const semantic = Array.isArray(latest?.semantic_issues) ? latest.semantic_issues : [];
    const issues = [...deterministic, ...semantic];
    const issueItems = issues.map((issue, issueIndex) => `
      <li id="admin-issue-${escapeHtml(issue.field)}-${issueIndex}" data-field="${escapeHtml(issue.field)}">
        <code>${escapeHtml(issue.code)}</code>
        <strong>${escapeHtml(issue.field || "Revisión")}</strong>
        <span>${escapeHtml(issue.message)}</span>
      </li>`).join("");
    const issueMarkup = issues.length
      ? `<ol class="admin-validation-reasons">${issueItems}</ol>`
      : '<p class="admin-empty-state">No hay motivos bloqueantes registrados para esta versión.</p>';
    const noteItems = Array.isArray(latest?.editorial_notes)
      ? latest.editorial_notes.map((note) => `<li>${escapeHtml(note)}</li>`).join("")
      : "";
    const notes = Array.isArray(latest?.editorial_notes) && latest.editorial_notes.length
      ? `<ul>${noteItems}</ul>` : "";
    const canReview = ["draft_ready", "review_rejected", "review_inconclusive", "review_unavailable"].includes(draft.workflow_status);
    const canConfirm = draft.workflow_status === "review_approved" && draft.review_status === "approved";
    const canPublish = draft.workflow_status === "human_confirmed";
    const locked = ["published", "early_closed", "cancelled", "pending_resolution", "resolved", "annulled"].includes(draft.workflow_status);

    return `
      <section class="admin-review-gate" aria-labelledby="admin-review-title">
        <div class="admin-section-heading">
          <div><p class="eyebrow">Puerta automática obligatoria</p><h3 id="admin-review-title">Revisión y publicación</h3></div>
          ${workflowBadge(draft.workflow_status)}
        </div>
        <div class="admin-review-summary">
          <p><strong>Versión:</strong> ${escapeHtml(draft.content_version || "—")}</p>
          <p><strong>Revisión:</strong> ${escapeHtml(draft.review_status || "No solicitada")}</p>
          <p><strong>Privacidad:</strong> permanece privado hasta la publicación autoritativa.</p>
        </div>
        ${issueMarkup}
        ${notes}
        <div class="admin-gate-actions">
          <button class="primary-button" type="button" data-request-review${disabled()}${canReview && !locked ? "" : " disabled"}>Solicitar nueva revisión</button>
          <button class="secondary-button" type="button" data-confirm-review${disabled()}${canConfirm ? "" : " disabled"}>Confirmar humanamente</button>
        </div>
        <p class="admin-gate-rule">No existe una acción para omitir un rechazo o aceptar el riesgo. Cualquier cambio esencial invalida esta revisión.</p>
        <fieldset class="admin-publish-controls"${canPublish ? "" : " disabled"}>
          <legend>Programación o publicación</legend>
          <label><span>Programar para (opcional)</span><input type="datetime-local" name="scheduled_for" form="admin-market-form"></label>
          <button class="primary-button" type="button" data-publish-draft${disabled()}>${canPublish ? "Revalidar y publicar" : "Falta confirmación humana"}</button>
          <p>Supabase volverá a comprobar rol, estado, versión, huella y aprobación vigente.</p>
        </fieldset>
      </section>`;
  }

  function formMarkup(payload) {
    const draft = payload?.draft || { market_slug: "", content_version: null, workflow_status: "draft_incomplete" };
    const radarOrigins = payload?.radar_origins || {};
    const radarCandidate = payload?.radar_candidate || null;
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
        <input type="${type}" name="${escapeHtml(name)}" value="${valueAttribute(options.value ?? draft[name])}"${options.required ? " required" : ""}${locked ? " disabled" : ""}${invalidAttributes(name)}${options.help && !invalidAttributes(name) ? ` aria-describedby="help-${escapeHtml(name)}"` : ""}>
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
              ${f("evaluation_ends_at", "Final exacto del periodo", "datetime-local", { value: localDateTime(draft.evaluation_ends_at, draft.timezone), required: true })}
              ${f("timezone", "Zona horaria IANA", "text", { value: draft.timezone || "Europe/Madrid", required: true })}
              ${f("resolution_deadline", "Fecha límite de resolución", "datetime-local", { value: localDateTime(draft.resolution_deadline, draft.timezone), required: true })}
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
            <button class="primary-button" type="submit"${disabled()}${locked ? " disabled" : ""}>Guardar borrador privado</button>
            <span>Los borradores incompletos nunca aparecen en superficies públicas.</span>
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
      && Number.isFinite(expiresAt)
      && expiresAt > Date.now()
      && !candidate.is_stale
      && !(Array.isArray(candidate.duplicate_matches) && candidate.duplicate_matches.length);
  }

  function radarChildMarkup(candidate) {
    const ready = radarCandidateReady(candidate);
    const status = candidate.verification_status === "verified_open" ? "Verificado"
      : candidate.verification_status === "needs_review" ? "Revisión necesaria"
        : "No preparable";
    return `<li class="radar-event-option">
      <div class="radar-event-option-copy">
        <strong>${escapeHtml(candidate.atinara_question || candidate.source_question || candidate.source_title)}</strong>
        <span>${escapeHtml(displayProbability(candidate.source_probability_yes ?? candidate.source_probability))} · ${escapeHtml(displayDate(candidate.source_close_at))}</span>
      </div>
      <div class="radar-event-option-actions">
        <span class="radar-quality-badge" data-quality="${escapeHtml(candidate.quality_status)}">${escapeHtml(status)}</span>
        <button class="secondary-button" type="button" data-radar-details="${escapeHtml(candidate.id)}">Detalles</button>
        <button class="primary-button" type="button" data-radar-prepare="${escapeHtml(candidate.id)}"${ready ? "" : " disabled"}>Preparar</button>
      </div>
    </li>`;
  }

  function radarGroupMarkup(group) {
    const candidates = Array.isArray(group.top_candidates) && group.top_candidates.length
      ? group.top_candidates
      : Array.isArray(group.candidates) ? group.candidates.slice(0, 3) : [];
    const hiddenCount = Math.max(0, Number(group.child_count || group.candidates?.length || 0) - candidates.length);
    return `<article class="radar-candidate-card radar-event-card" data-verification="${escapeHtml(group.verification_status)}">
      <header>
        <div><span class="radar-provider-badge">${escapeHtml(RADAR_PROVIDER_LABELS[group.provider] || group.provider)}</span><span>${escapeHtml(group.category || "Sin clasificar")}</span></div>
        <strong class="radar-score" aria-label="Puntuación Atinara ${escapeHtml(group.quality_score || 0)} de 100">${escapeHtml(group.quality_score || 0)}<small>/100</small></strong>
      </header>
      <h3>${escapeHtml(group.title || "Evento externo")}</h3>
      <p class="radar-event-summary">${escapeHtml(group.child_count || candidates.length)} opciones del mismo evento. Se muestran las tres más relevantes.</p>
      <ul class="radar-event-options">${candidates.map(radarChildMarkup).join("")}</ul>
      ${hiddenCount ? `<p class="radar-event-more">${escapeHtml(hiddenCount)} opciones adicionales disponibles en el detalle de sus candidatas.</p>` : ""}
      <footer>${externalLink(group.external_event_url, "Abrir evento original")}</footer>
    </article>`;
  }

  function radarRejectionMarkup(candidate) {
    const evidence = Array.isArray(candidate.verification_evidence) ? candidate.verification_evidence : [];
    return `<article class="radar-rejection-card">
      <header><div><span class="radar-provider-badge">${escapeHtml(RADAR_PROVIDER_LABELS[candidate.provider] || candidate.provider)}</span><strong>${escapeHtml(candidate.verification_reason_code || "REJECTED")}</strong></div><time>${escapeHtml(displayDate(candidate.verified_at))}</time></header>
      <h4>${escapeHtml(candidate.atinara_question || candidate.source_question || candidate.source_title)}</h4>
      <p>${escapeHtml(candidate.verification_reason || "La candidata no cumple las condiciones de preparación.")}</p>
      <div class="radar-rejection-links">${externalLink(candidate.external_event_url || candidate.external_market_url, "Abrir mercado original")}${evidence.slice(0, 2).map((item) => externalLink(item.url, item.title || "Abrir evidencia")).join("")}</div>
    </article>`;
  }

  function radarRejectionsMarkup() {
    const rejected = state.radar.rejected || { total: 0, counts: {}, items: [] };
    const items = Array.isArray(rejected.items) ? rejected.items : [];
    if (!items.length) return "";
    const counts = Object.entries(rejected.counts || {}).map(([code, count]) => `<li><code>${escapeHtml(code)}</code><strong>${escapeHtml(count)}</strong></li>`).join("");
    return `<section class="radar-rejections" aria-labelledby="radar-rejections-title">
      <header><div><p class="eyebrow">Auditoría factual</p><h3 id="radar-rejections-title">${escapeHtml(rejected.total || items.length)} candidatas rechazadas</h3></div><p>No pueden preparar borradores. Se conserva el motivo y la evidencia para revisión administrativa.</p></header>
      <ul class="radar-rejection-counts">${counts}</ul>
      <div class="radar-rejection-grid">${items.map(radarRejectionMarkup).join("")}</div>
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
          <div><dt>Estado y fechas</dt><dd>${escapeHtml(candidate.source_status || "No disponible")} · ${escapeHtml(displayDate(candidate.source_close_at))}</dd></div>
        </dl><div class="radar-source-links">${externalLink(candidate.external_event_url, "Abrir evento original")}${externalLink(candidate.external_market_url, "Abrir mercado original")}</div></section>
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
          <div><dt>Estado</dt><dd>${escapeHtml(candidate.verification_status || "pending")}</dd></div>
          <div><dt>Código</dt><dd><code>${escapeHtml(candidate.verification_reason_code || "VERIFICATION_REQUIRED")}</code></dd></div>
          <div><dt>Verificada</dt><dd>${escapeHtml(displayDate(candidate.verified_at))}</dd></div>
          <div><dt>Caduca</dt><dd>${escapeHtml(displayDate(candidate.verification_expires_at))}</dd></div>
        </dl><p>${escapeHtml(candidate.verification_reason || "Pendiente de verificación factual.")}</p>${Array.isArray(candidate.verification_evidence) ? candidate.verification_evidence.map((item) => externalLink(item.url, item.title || "Abrir evidencia")).join("") : ""}</section>
        <section><h3>Atinara Score</h3><dl>${Object.entries(scores).map(([key, value]) => `<div><dt>${escapeHtml(key)}</dt><dd>${escapeHtml(value)}</dd></div>`).join("")}</dl><p>No es una predicción científica: ordena candidatas con criterios transparentes.</p></section>
        <section><h3>Revisión necesaria</h3>
          ${warnings.length ? `<ul>${warnings.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>` : "<p>Sin advertencias registradas.</p>"}
          ${missing.length ? `<p><strong>Campos sin información:</strong> ${escapeHtml(missing.join(", "))}</p>` : ""}
          ${duplicates.length ? `<ul>${duplicates.map((item) => `<li><strong>${escapeHtml(item.status)}</strong> · ${escapeHtml(item.reason)}</li>`).join("")}</ul>` : "<p>Sin duplicados deterministas.</p>"}
          ${tags.length ? `<p><strong>Tags:</strong> ${escapeHtml(tags.join(", "))}</p>` : ""}
        </section>
      </div>
      <footer><button class="primary-button" type="button" data-radar-prepare="${escapeHtml(candidate.id)}"${radarCandidateReady(candidate) ? "" : " disabled"}>Preparar borrador</button></footer>
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

  function renderWorkspace() {
    root.setAttribute("aria-busy", String(state.busy));
    let content = "";
    if (state.view === "drafts") {
      content = `<div class="admin-market-workspace">${listMarkup()}${formMarkup(state.selected)}</div>`;
    } else if (state.view === "radar") {
      content = radarMarkup();
    } else if (state.view === "catalog") {
      content = catalogMarkup();
    } else {
      content = auditMarkup(state.audit);
    }
    root.innerHTML = `${toolbarMarkup()}${noticeMarkup()}${content}`;
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
    const payload = helpers.collectDraftPayload(form);
    const localIssues = helpers.validateDraftLocally(payload);
    if (localIssues.length) {
      setNotice(localIssues[0].message, "error");
      renderWorkspace();
      form.querySelector(`[name="${CSS.escape(localIssues[0].field)}"]`)?.focus();
      return;
    }
    state.busy = true;
    renderWorkspace();
    try {
      const args = {
        draft_id_input: form.dataset.draftId || null,
        expected_version_input: form.dataset.version ? Number(form.dataset.version) : null,
        draft_input: payload
      };
      const result = state.radarPrefill?.candidateId && !form.dataset.draftId
        ? await rpc("save_market_draft_from_radar", { candidate_id_input: state.radarPrefill.candidateId, ...args })
        : await rpc("save_market_draft", args);
      state.radarPrefill = null;
      await loadDrafts();
      state.selected = await rpc("get_admin_market_draft", { draft_id_input: result.draft.id });
      const issueCount = Array.isArray(result.deterministic_issues) ? result.deterministic_issues.length : 0;
      const pluralSuffix = issueCount === 1 ? "" : "s";
      const noticeMessage = issueCount
        ? `Borrador guardado en privado con ${issueCount} motivo${pluralSuffix} pendiente${pluralSuffix}.`
        : "Borrador guardado. Ya puede solicitarse la revisión automática.";
      setNotice(noticeMessage, issueCount ? "warning" : "success");
    } catch (error) {
      setNotice(helpers.getFriendlyError(error, "No se pudo guardar el borrador."), "error");
    } finally {
      state.busy = false;
      renderWorkspace();
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
        body: { draft_id: draft.id, expected_version: draft.content_version }
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
    const scheduledFor = scheduledValue ? new Date(scheduledValue).toISOString() : null;
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
      const radarNotice = data.partial
        ? "Radar actualizado con incidencias parciales. Las fuentes disponibles siguen utilizables."
        : data.cached
          ? "Radar cargado desde la caché privada sin consultar proveedores."
          : "Radar actualizado sin crear ni modificar ningún mercado.";
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
      state.radarPrefill = { candidateId, origins: prefill.origins || {} };
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

  async function loadView(view) {
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
    if (target.dataset.radarDetails) openRadarDetails(target.dataset.radarDetails);
    if (target.dataset.radarPrepare) prepareRadarCandidate(target.dataset.radarPrepare);
    if (target.dataset.radarDismiss) dismissRadarCandidate(target.dataset.radarDismiss);
    if (target.dataset.radarCloseDetail !== undefined) {
      const closedCandidateId = state.radar.selected?.id || "";
      state.radar.selected = null;
      renderWorkspace();
      document.querySelector(`[data-radar-details="${CSS.escape(closedCandidateId)}"]`)?.focus();
    }
    if (target.dataset.closeEarly) managePublishedMarket(target.dataset.closeEarly, "early", target);
    if (target.dataset.cancelMarket) managePublishedMarket(target.dataset.cancelMarket, "cancel", target);
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
