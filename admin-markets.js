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
    actionTrigger: null
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
        <button type="button" role="tab" data-admin-view="drafts" aria-selected="${state.view === "drafts"}">Borradores y revisión</button>
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
    const f = (name, label, type = "text", options = {}) => `
      <label class="${options.wide ? "field-wide" : ""}">
        <span>${escapeHtml(label)}${options.required ? " *" : ""}</span>
        <input type="${type}" name="${escapeHtml(name)}" value="${valueAttribute(options.value ?? draft[name])}"${options.required ? " required" : ""}${locked ? " disabled" : ""}${invalidAttributes(name)}${options.help && !invalidAttributes(name) ? ` aria-describedby="help-${escapeHtml(name)}"` : ""}>
        ${options.help ? `<small id="help-${escapeHtml(name)}">${escapeHtml(options.help)}</small>` : ""}
      </label>`;
    const t = (name, label, options = {}) => `
      <label class="${options.wide === false ? "" : "field-wide"}">
        <span>${escapeHtml(label)}${options.required ? " *" : ""}</span>
        <textarea name="${escapeHtml(name)}" rows="${options.rows || 3}"${options.required ? " required" : ""}${locked ? " disabled" : ""}${invalidAttributes(name)}>${escapeHtml(options.value ?? draft[name] ?? "")}</textarea>
        ${options.help ? `<small>${escapeHtml(options.help)}</small>` : ""}
      </label>`;

    return `
      <article class="admin-draft-editor">
        <form id="admin-market-form" novalidate data-draft-id="${escapeHtml(draft.id || "")}" data-version="${escapeHtml(draft.content_version || "")}">
          <div class="admin-section-heading">
            <div><p class="eyebrow">Borrador privado</p><h2>${draft.id ? "Editar mercado" : "Crear mercado"}</h2></div>
            ${workflowBadge(draft.workflow_status || "draft_incomplete")}
          </div>
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

  function renderWorkspace() {
    root.setAttribute("aria-busy", String(state.busy));
    let content = "";
    if (state.view === "drafts") {
      content = `<div class="admin-market-workspace">${listMarkup()}${formMarkup(state.selected)}</div>`;
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
      const result = await rpc("save_market_draft", {
        draft_id_input: form.dataset.draftId || null,
        expected_version_input: form.dataset.version ? Number(form.dataset.version) : null,
        draft_input: payload
      });
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

  async function loadView(view) {
    state.view = view;
    state.busy = true;
    renderWorkspace();
    try {
      if (view === "drafts") await loadDrafts();
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
    if (target.dataset.closeEarly) managePublishedMarket(target.dataset.closeEarly, "early", target);
    if (target.dataset.cancelMarket) managePublishedMarket(target.dataset.cancelMarket, "cancel", target);
  });

  root.addEventListener("submit", (event) => {
    event.preventDefault();
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
