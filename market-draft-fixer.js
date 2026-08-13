(function initMarketDraftFixer() {
  "use strict";

  const root = document.querySelector("#admin-markets-root");
  const client = window.orakloSupabase;
  if (!root || !client) return;

  const RETURN_KEY = "atinara:market-draft-repair:return:v3";
  const ATTEMPT_KEY_PREFIX = "atinara:market-draft-repair:attempt:v1";
  let timer = null;
  let restoring = false;

  const style = document.createElement("style");
  style.textContent = `
    .admin-expert-repair-panel {
      display: grid;
      gap: 12px;
      margin: 18px 0;
      padding: 16px;
      border: 1px solid rgba(110, 168, 255, 0.48);
      border-radius: 10px;
      background: linear-gradient(135deg, rgba(110, 168, 255, 0.1), rgba(169, 139, 255, 0.07));
    }
    .admin-expert-repair-panel h4,
    .admin-expert-repair-panel p { margin: 0; }
    .admin-expert-repair-panel-actions {
      display: flex;
      align-items: center;
      gap: 12px;
      flex-wrap: wrap;
    }
    .admin-expert-repair-panel-status,
    .admin-expert-repair-result {
      padding: 11px 13px;
      border: 1px solid var(--line-strong);
      border-radius: 8px;
      overflow-wrap: anywhere;
    }
    .admin-expert-repair-panel-status[data-tone="success"],
    .admin-expert-repair-result[data-tone="success"] {
      color: var(--green);
      border-color: rgba(94, 224, 160, 0.5);
      background: rgba(94, 224, 160, 0.08);
    }
    .admin-expert-repair-panel-status[data-tone="warning"],
    .admin-expert-repair-result[data-tone="warning"] {
      color: var(--gold);
      border-color: rgba(240, 196, 107, 0.5);
      background: rgba(240, 196, 107, 0.08);
    }
    .admin-expert-repair-panel-status[data-tone="error"] {
      color: var(--danger);
      border-color: rgba(255, 138, 138, 0.5);
      background: rgba(255, 138, 138, 0.08);
    }
    .admin-expert-repair-result {
      display: grid;
      gap: 4px;
      margin: 12px 0 18px;
    }
    @media (max-width: 720px) {
      .admin-expert-repair-panel-actions > * { width: 100%; }
    }
  `;
  document.head.appendChild(style);

  const safeText = (value, max = 1200) => String(value ?? "").trim().slice(0, max);

  function renderRepairMessage(container, title, message) {
    const heading = document.createElement("strong");
    const body = document.createElement("span");
    heading.textContent = safeText(title, 160);
    body.textContent = safeText(message, 1_200);
    container.replaceChildren(heading, body);
  }

  function safeRepairErrorText(value, max = 800) {
    if (typeof value !== "string") return "";
    const text = safeText(value.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " "), max);
    if (!text || /^\[object\s+Object\]$/i.test(text)) return "";
    const exposesSql = /(?:\bSQLSTATE\b|\bPL\/pgSQL\b|\bPostg(?:reSQL|REST)\b|\bSQL statement\b|\bCONTEXT:\s|\bERROR:\s|\$function\$|\b(?:private|public|auth|extensions)\.[a-z_][a-z0-9_]*\b|\b(?:select\s+.+\s+from|insert\s+into|update\s+.+\s+set|delete\s+from|alter\s+table|create\s+(?:or\s+replace\s+)?function|drop\s+(?:table|function))\b)/i.test(text);
    return exposesSql ? "" : text;
  }

  function firstRepairErrorMessage(values) {
    for (const value of values) {
      const text = safeRepairErrorText(value, 800);
      if (text && !/^[A-Z][A-Z0-9_]{2,}$/.test(text)) return text;
    }
    return "";
  }

  function currentDraft() {
    const form = document.querySelector("#admin-market-form");
    if (!form) return null;
    const id = safeText(form.dataset.draftId, 100);
    const version = Number(form.dataset.version);
    return id && Number.isSafeInteger(version) && version > 0 ? { id, version } : null;
  }

  function needsRepair() {
    const gate = document.querySelector(".admin-review-gate");
    if (!gate) return false;
    const hasContentIssues = gate.querySelectorAll("[data-content-issue='true']").length > 0;
    const technicalAttempt = gate.dataset.latestAttemptClassification === "technical";
    return hasContentIssues && (technicalAttempt || /(rejected|rechazad|inconclus|incomplet|contradic|ambigu)/i.test(gate.textContent || ""));
  }

  function enhance() {
    const gate = document.querySelector(".admin-review-gate");
    const draft = currentDraft();
    if (!gate || !draft || !needsRepair() || gate.querySelector("[data-expert-repair-panel]")) return;

    const issueCount = gate.querySelectorAll("[data-content-issue='true']").length;
    const panel = document.createElement("section");
    panel.className = "admin-expert-repair-panel";
    panel.dataset.expertRepairPanel = "true";
    const heading = document.createElement("div");
    const eyebrow = document.createElement("p");
    const title = document.createElement("h4");
    const description = document.createElement("p");
    const panelActions = document.createElement("div");
    const repairButton = document.createElement("button");
    const authority = document.createElement("small");
    const repairStatus = document.createElement("p");
    eyebrow.className = "eyebrow";
    eyebrow.textContent = "Corrector Autónomo · hasta tres rondas auditadas";
    title.textContent = `Resolver ${issueCount} ${issueCount === 1 ? "incongruencia" : "incongruencias"}`;
    description.textContent = "Atinara detectará el arquetipo, completará lo deducible, validará fuentes oficiales, sincronizará el Plan de Resolución y volverá a revisar. Los fallos técnicos se registran aparte y no se presentan como una falsa petición de edición humana.";
    panelActions.className = "admin-expert-repair-panel-actions";
    repairButton.className = "primary-button";
    repairButton.type = "button";
    repairButton.dataset.expertRepairDraft = "true";
    repairButton.textContent = "Aplicar correcciones y volver a revisar";
    authority.textContent = "No confirma, programa ni publica por ti. La confirmación humana seguirá siendo obligatoria.";
    repairStatus.className = "admin-expert-repair-panel-status";
    repairStatus.dataset.expertRepairStatus = "true";
    repairStatus.setAttribute("role", "status");
    repairStatus.hidden = true;
    heading.append(eyebrow, title);
    panelActions.append(repairButton, authority);
    panel.append(heading, description, panelActions, repairStatus);
    const actions = gate.querySelector(".admin-gate-actions");
    if (actions) gate.insertBefore(panel, actions);
    else gate.appendChild(panel);
  }

  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(() => {
      enhance();
      restoreResult();
    }, 80);
  }

  function attemptStorageKey(draft) {
    return `${ATTEMPT_KEY_PREFIX}:${draft.id}:${draft.version}`;
  }

  function repairAttemptKey(draft) {
    const key = attemptStorageKey(draft);
    try {
      const stored = safeText(sessionStorage.getItem(key), 80);
      if (/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(stored)) return stored;
      const created = crypto.randomUUID();
      sessionStorage.setItem(key, created);
      return created;
    } catch {
      return crypto.randomUUID();
    }
  }

  function clearRepairAttempt(draft) {
    try { sessionStorage.removeItem(attemptStorageKey(draft)); } catch { /* El servidor conserva la idempotencia. */ }
  }

  async function repairFailure(error) {
    let message = firstRepairErrorMessage([
      error?.message,
      error?.context?.message
    ]);
    let body = null;
    try {
      if (error?.context && typeof error.context.clone === "function") {
        body = await error.context.clone().json();
        message = firstRepairErrorMessage([
          body?.escalation?.reason,
          body?.escalation?.message,
          body?.message,
          body?.error,
          message
        ]);
      }
    } catch {
      // El mensaje genérico sigue siendo seguro.
    }
    const attemptId = safeText(body?.attempt_id, 80);
    const phase = safeText(body?.failure_phase, 80) || "desconocida";
    const retryable = body?.retryable === true
      || Number(error?.context?.status) === 429
      || Number(error?.context?.status) >= 500;
    const preserved = body?.state_preserved !== false;
    const explanation = message || "No se pudieron aplicar las correcciones.";
    return {
      attemptId,
      phase,
      retryable,
      preserved,
      message: `${explanation} ${preserved ? "El último estado autoritativo se conserva." : "Atinara no pudo confirmar el estado persistido."}${retryable ? " Puedes reintentarlo con seguridad." : " Revisa la causa indicada antes de continuar."}`,
    };
  }

  async function runRepair(button) {
    const draft = currentDraft();
    if (!draft) return;
    if (!window.confirm("Atinara corregirá únicamente los problemas registrados y ejecutará una nueva revisión. No se publicará ni se confirmará automáticamente. ¿Continuar?")) return;

    const status = document.querySelector("[data-expert-repair-status]");
    button.disabled = true;
    button.textContent = "Corrigiendo y revisando…";
    if (status) {
      status.hidden = false;
      status.dataset.tone = "warning";
      status.setAttribute("role", "status");
      status.textContent = "El Corrector Experto está alineando pregunta, criterios, zona horaria, fuentes y Plan de Resolución.";
    }

    try {
      const attemptId = repairAttemptKey(draft);
      const { data, error } = await client.functions.invoke("market-draft-fixer", {
        body: {
          action: "repair-and-revalidate",
          draft_id: draft.id,
          expected_version: draft.version,
          attempt_id: attemptId
        }
      });
      if (error) throw error;
      const reviewStatus = safeText(data?.review?.status || "inconclusive", 50);
      const approved = reviewStatus === "approved";
      const telemetryIncomplete = Array.isArray(data?.warnings)
        && data.warnings.includes("AI_TELEMETRY_WRITE_FAILED");
      const domainMessage = safeText(data?.message, 1000) || (approved
        ? "Correcciones aplicadas y revisión aprobada."
        : "Correcciones aplicadas; la revisión conserva observaciones pendientes.");
      const message = telemetryIncomplete
        ? `${domainMessage} Observabilidad incompleta: el resultado se conserva y la inferencia no se repetirá.`
        : domainMessage;
      const changedFields = Array.isArray(data?.changed_fields) ? data.changed_fields : [];
      clearRepairAttempt(draft);

      sessionStorage.setItem(RETURN_KEY, JSON.stringify({
        draftId: draft.id,
        status: approved && !telemetryIncomplete ? "success" : "warning",
        message,
        changedFields,
        newVersion: data?.new_version || null,
        attemptId: safeText(data?.attempt_id, 80)
      }));
      if (status) {
        status.dataset.tone = approved && !telemetryIncomplete ? "success" : "warning";
        status.setAttribute("role", "status");
        status.textContent = message;
      }
      setTimeout(() => window.location.reload(), 700);
    } catch (error) {
      const failure = await repairFailure(error);
      if (status) {
        status.hidden = false;
        status.dataset.tone = "error";
        status.setAttribute("role", "alert");
        const attempt = failure.attemptId ? ` Intento ${failure.attemptId.slice(0, 8)}.` : "";
        status.textContent = `${failure.message}${attempt} Fase: ${failure.phase}.`;
      }
      if (!failure.retryable) clearRepairAttempt(draft);
      button.disabled = false;
      button.textContent = "Aplicar correcciones y volver a revisar";
    }
  }

  function restoreResult() {
    if (restoring) return;
    const raw = sessionStorage.getItem(RETURN_KEY);
    if (!raw) return;
    let result;
    try { result = JSON.parse(raw); }
    catch { sessionStorage.removeItem(RETURN_KEY); return; }
    const draftId = safeText(result?.draftId, 100);
    if (!draftId) { sessionStorage.removeItem(RETURN_KEY); return; }

    restoring = true;
    const started = Date.now();
    const waitForRow = () => {
      const row = document.querySelector(`[data-open-draft="${CSS.escape(draftId)}"]`);
      if (row) {
        row.click();
        waitForEditor();
      } else if (Date.now() - started < 20000) {
        setTimeout(waitForRow, 150);
      } else {
        restoring = false;
        sessionStorage.removeItem(RETURN_KEY);
      }
    };
    const waitForEditor = () => {
      const editor = document.querySelector(".admin-draft-editor");
      const form = document.querySelector("#admin-market-form");
      if (editor && form?.dataset.draftId === draftId) {
        const banner = document.createElement("aside");
        banner.className = "admin-expert-repair-result";
        banner.dataset.tone = result.status === "success" ? "success" : "warning";
        const changed = Array.isArray(result.changedFields) && result.changedFields.length
          ? ` Campos modificados: ${result.changedFields.join(", ")}.`
          : "";
        renderRepairMessage(
          banner,
          result.status === "success" ? "Corrección completada" : "Corrección aplicada con revisión pendiente",
          `${safeText(result.message, 1000)}${changed}`,
        );
        editor.prepend(banner);
        sessionStorage.removeItem(RETURN_KEY);
        restoring = false;
      } else if (Date.now() - started < 20000) {
        setTimeout(waitForEditor, 120);
      } else {
        restoring = false;
        sessionStorage.removeItem(RETURN_KEY);
      }
    };
    waitForRow();
  }

  root.addEventListener("click", (event) => {
    const button = event.target.closest("[data-expert-repair-draft]");
    if (button) runRepair(button);
  });
  new MutationObserver(schedule).observe(root, { childList: true, subtree: true });
  schedule();
})();

(function initAtinaraPublicationFlow() {
  "use strict";

  const root = document.querySelector("#admin-markets-root");
  const client = window.orakloSupabase;
  if (!root || !client) return;

  const PUBLICATION_KEY = "atinara:last-published-market:v2";
  const PUBLICATION_RELOAD_KEY = "atinara:publication-catalog-reload:v1";
  const PUBLICATION_EVENT_KEY = "atinara:market-published-event:v1";
  const PUBLICATION_CHANNEL = "atinara-market-catalog-v1";
  let publicationInFlight = false;
  let restoreTimer = null;

  const style = document.createElement("style");
  style.textContent = `
    .admin-publication-inline-status {
      display: grid;
      gap: 4px;
      margin-top: 12px;
      padding: 11px 13px;
      border: 1px solid var(--line-strong);
      border-radius: 8px;
      overflow-wrap: anywhere;
    }
    .admin-publication-inline-status[data-tone="info"] {
      color: var(--accent-strong);
      border-color: rgba(110, 168, 255, 0.48);
      background: rgba(110, 168, 255, 0.08);
    }
    .admin-publication-inline-status[data-tone="success"] {
      color: var(--green);
      border-color: rgba(94, 224, 160, 0.52);
      background: rgba(94, 224, 160, 0.08);
    }
    .admin-publication-inline-status[data-tone="error"] {
      color: var(--danger);
      border-color: rgba(255, 138, 138, 0.52);
      background: rgba(255, 138, 138, 0.08);
    }
    .admin-publication-success-banner {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 14px;
      align-items: center;
      margin: 0 0 18px;
      padding: 14px 16px;
      border: 1px solid rgba(94, 224, 160, 0.55);
      border-radius: 10px;
      background: linear-gradient(135deg, rgba(94, 224, 160, 0.12), rgba(110, 168, 255, 0.07));
    }
    .admin-publication-success-banner > div {
      display: grid;
      gap: 4px;
      min-width: 0;
    }
    .admin-publication-success-banner strong,
    .admin-publication-success-banner span {
      overflow-wrap: anywhere;
    }
    .admin-publication-success-actions {
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
      justify-content: flex-end;
    }
    .admin-catalog-table tr.admin-market-just-published {
      outline: 2px solid rgba(94, 224, 160, 0.72);
      outline-offset: -2px;
      background: rgba(94, 224, 160, 0.08);
    }
    .admin-binding-compatibility[data-compatible="true"] small {
      display: block;
      margin-top: 4px;
      color: var(--muted);
    }
    @media (max-width: 720px) {
      .admin-publication-success-banner {
        grid-template-columns: 1fr;
      }
      .admin-publication-success-actions,
      .admin-publication-success-actions > * {
        width: 100%;
      }
    }
  `;
  document.head.appendChild(style);

  const safeText = (value, max = 1200) => String(value ?? "").trim().slice(0, max);

  function renderPublicationStatus(container, title, message, detail = "") {
    if (!container) return;
    const heading = document.createElement("strong");
    const body = document.createElement("span");
    heading.textContent = safeText(title, 160);
    body.textContent = safeText(message, 1_200);
    const children = [heading, body];
    if (detail) {
      const extra = document.createElement("small");
      extra.textContent = safeText(detail, 1_200);
      children.push(extra);
    }
    container.replaceChildren(...children);
    container.setAttribute("role", container.dataset.tone === "error" ? "alert" : "status");
  }

  function currentPublicationContext() {
    const form = document.querySelector("#admin-market-form");
    if (!form) return null;
    const draftId = safeText(form.dataset.draftId, 100);
    const version = Number(form.dataset.version);
    const marketId = safeText(form.elements.market_slug?.value, 140);
    const question = safeText(form.elements.question?.value, 500);
    const scheduledValue = safeText(form.elements.scheduled_for?.value, 100);
    const radarCandidateId = safeText(form.dataset.radarCandidateId, 100);
    const draftFingerprint = safeText(form.dataset.contentFingerprint, 80);
    if (!draftId || !Number.isSafeInteger(version) || version < 1 || !marketId) return null;
    return { form, draftId, version, marketId, question, scheduledValue, radarCandidateId, draftFingerprint };
  }

  function inlineStatus(fieldset) {
    let node = fieldset?.querySelector("[data-publication-inline-status]");
    if (!node && fieldset) {
      node = document.createElement("p");
      node.className = "admin-publication-inline-status";
      node.dataset.publicationInlineStatus = "true";
      node.setAttribute("role", "status");
      fieldset.appendChild(node);
    }
    return node;
  }

  async function detailedError(error) {
    const details = [
      error?.message,
      error?.details,
      error?.hint,
      error?.code,
      error?.context?.message
    ].map((value) => safeText(value, 1000)).filter(Boolean);
    try {
      if (error?.context && typeof error.context.clone === "function") {
        const payload = await error.context.clone().json();
        details.unshift(
          safeText(payload?.message, 1000),
          safeText(payload?.error, 200),
          safeText(payload?.details, 1000)
        );
      }
    } catch {
      // Se conserva la información segura ya disponible.
    }
    return details.filter(Boolean).join(" · ");
  }

  function friendlyPublicationError(raw) {
    const text = safeText(raw, 2400);
    const mappings = [
      ["DRAFT_VERSION_MOVED", "El borrador cambió en otra operación. Vuelve a abrirlo antes de publicar."],
      ["CURRENT_APPROVAL_AND_CONFIRMATION_REQUIRED", "La aprobación o la confirmación humana ya no coincide con esta versión."],
      ["CURRENT_BINDING_COMPATIBILITY_REQUIRED", "El Plan de Resolución no coincide con el contenido actual del borrador."],
      ["RESOLUTION_PLAN_NOT_LOCKED", "El Plan de Resolución no pudo validarse y bloquearse automáticamente."],
      ["SOURCE_CONTRACT_NOT_LOCKED", "El contrato de resolución todavía no está validado."],
      ["SOURCE_MONITOR_NOT_ARMED", "Este mercado necesita un monitor de fuente armado antes de publicarse."],
      ["SOURCE_SCHEDULER_NOT_ENABLED", "Este mercado necesita activar previamente el scheduler autorizado del monitor."],
      ["MARKET_PERIOD_ALREADY_ENDED", "El periodo del mercado ya terminó y no puede publicarse."],
      ["MARKET_ID_ALREADY_EXISTS", "Ya existe un mercado publicado con este identificador."],
      ["SCHEDULE_AFTER_MARKET_CLOSE", "La fecha programada debe ser anterior al cierre del mercado."],
      ["RADAR_EVENT_ALREADY_RESOLVED", "Una fuente oficial confirma que el resultado ya es conocido; el mercado no puede publicarse."],
      ["RADAR_CANDIDATE_RESOLVED", "Una fuente oficial confirma que el resultado ya es conocido; el mercado no puede publicarse."],
      ["RADAR_ELIGIBILITY_REQUIRED", "No existe una decisión de elegibilidad vigente para publicar este borrador Radar."],
      ["RADAR_ELIGIBILITY_EXPIRED", "La elegibilidad caducó y la publicación permanece bloqueada hasta actualizarla."],
      ["ELIGIBILITY_EXPIRED", "La elegibilidad caducó y la publicación permanece bloqueada hasta actualizarla."],
      ["ELIGIBILITY_SCAN_UNAVAILABLE", "No se pudo descartar con seguridad que el resultado ya sea público. El borrador continúa privado y puedes reintentar."],
      ["ADMIN_REQUIRED", "La sesión actual no conserva permiso administrativo."],
      ["AUTH_REQUIRED", "La sesión ha caducado. Inicia sesión de nuevo."]
    ];
    const match = mappings.find(([code]) => text.includes(code));
    return match?.[1] || "La publicación no se completó. Atinara no aplicó cambios parciales y el borrador continúa seguro.";
  }

  function publicationPayload(context) {
    let scheduledFor = null;
    if (context.scheduledValue) {
      const parsed = new Date(context.scheduledValue);
      if (!Number.isFinite(parsed.getTime())) throw new Error("SCHEDULE_DATE_INVALID");
      scheduledFor = parsed.toISOString();
    }
    return {
      draft_id_input: context.draftId,
      expected_version_input: context.version,
      scheduled_for_input: scheduledFor
    };
  }

  async function checkRadarPublicationEligibility(context) {
    if (!context.radarCandidateId) return null;
    const { data, error } = await client.functions.invoke("market-radar", {
      body: {
        action: "check-eligibility",
        candidate_id: context.radarCandidateId,
        operation_id: crypto.randomUUID(),
        draft_id: context.draftId,
        draft_version: context.version,
        draft_fingerprint: context.draftFingerprint
      }
    });
    if (error) throw error;
    const candidate = data?.candidate || {};
    if (data?.ok !== true
      || candidate.eligibility_status !== "eligible"
      || candidate.eligibility_policy_version !== "atinara-prediction-policy-v5"
      || candidate.verification_status !== "verified_open"
      || !candidate.current_eligibility_check_id) {
      throw new Error(data?.error || "RADAR_ELIGIBILITY_REQUIRED");
    }
    return data;
  }

  function announcePublication(payload) {
    const eventPayload = { ...payload, nonce: crypto.randomUUID() };
    try {
      const channel = new BroadcastChannel(PUBLICATION_CHANNEL);
      channel.postMessage({ type: "market-published", payload: eventPayload });
      channel.close();
    } catch {
      // La navegación directa sigue disponible cuando BroadcastChannel no existe.
    }
    try {
      localStorage.setItem(PUBLICATION_EVENT_KEY, JSON.stringify(eventPayload));
    } catch {
      // El evento entre pestañas es una mejora; Supabase sigue siendo autoritativo.
    }
  }

  function storePublication(result, context) {
    const payload = {
      marketId: safeText(result?.market_id || context.marketId, 140),
      question: context.question,
      publishedAt: result?.published_at || new Date().toISOString(),
      status: safeText(result?.status || "published", 40),
      publicPath: safeText(result?.public_path || `index.html?market=${encodeURIComponent(context.marketId)}`, 500),
      adminHandled: false,
      createdAt: new Date().toISOString()
    };
    sessionStorage.setItem(PUBLICATION_KEY, JSON.stringify(payload));
    announcePublication(payload);
    return payload;
  }

  function findCatalogRow(marketId) {
    return [...document.querySelectorAll(".admin-catalog-table tbody tr")].find((row) => {
      const identifiers = [...row.querySelectorAll("small")].map((node) => safeText(node.textContent, 300));
      return identifiers.includes(marketId) || safeText(row.textContent, 5000).includes(marketId);
    }) || null;
  }

  function renderCatalogSuccess(publication) {
    const table = document.querySelector(".admin-catalog-table");
    if (!table || !publication?.marketId) return false;
    const row = findCatalogRow(publication.marketId);
    if (!row) return false;

    row.classList.add("admin-market-just-published");
    row.setAttribute("aria-current", "true");

    if (!document.querySelector("[data-publication-success-banner]")) {
      const banner = document.createElement("section");
      banner.className = "admin-publication-success-banner";
      banner.dataset.publicationSuccessBanner = "true";
      const publicUrl = `index.html?market=${encodeURIComponent(publication.marketId)}`;
      const detailUrl = `market-detail.html?id=${encodeURIComponent(publication.marketId)}`;
      const copy = document.createElement("div");
      const heading = document.createElement("strong");
      const question = document.createElement("span");
      const actions = document.createElement("div");
      const explore = document.createElement("a");
      const detail = document.createElement("a");
      heading.textContent = "Mercado publicado y visible";
      question.textContent = safeText(publication.question || publication.marketId, 600);
      actions.className = "admin-publication-success-actions";
      explore.className = "primary-button";
      explore.href = publicUrl;
      explore.textContent = "Abrir en Explorar mercados";
      detail.className = "secondary-button";
      detail.href = detailUrl;
      detail.textContent = "Abrir ficha pública";
      copy.append(heading, question);
      actions.append(explore, detail);
      banner.append(copy, actions);
      table.parentElement?.insertBefore(banner, table);
    }

    row.scrollIntoView({ behavior: "smooth", block: "center" });
    publication.adminHandled = true;
    sessionStorage.setItem(PUBLICATION_KEY, JSON.stringify(publication));
    sessionStorage.removeItem(PUBLICATION_RELOAD_KEY);
    return true;
  }

  function openCatalog(publication) {
    const started = Date.now();
    const selectCatalog = () => {
      const tab = document.querySelector('[data-admin-view="catalog"]');
      if (tab) {
        tab.click();
        waitForCatalog();
      } else if (Date.now() - started < 15000) {
        setTimeout(selectCatalog, 100);
      }
    };
    const waitForCatalog = () => {
      if (renderCatalogSuccess(publication)) return;
      if (Date.now() - started < 15000) {
        setTimeout(waitForCatalog, 120);
        return;
      }
      if (sessionStorage.getItem(PUBLICATION_RELOAD_KEY) !== publication.marketId) {
        sessionStorage.setItem(PUBLICATION_RELOAD_KEY, publication.marketId);
        window.location.reload();
      }
    };
    selectCatalog();
  }

  async function runPublication(button) {
    if (publicationInFlight) return;
    const context = currentPublicationContext();
    if (!context) return;

    const isScheduled = Boolean(context.scheduledValue);
    const verb = isScheduled ? "programar" : "publicar";
    if (!window.confirm(`Supabase validará revisión, confirmación y Plan de Resolución antes de ${verb}. ¿Continuar?`)) return;

    publicationInFlight = true;
    const fieldset = button.closest(".admin-publish-controls");
    const status = inlineStatus(fieldset);
    const previousLabel = button.textContent;
    button.disabled = true;
    if (fieldset) fieldset.setAttribute("aria-busy", "true");
    if (status) {
      status.dataset.tone = "info";
      renderPublicationStatus(status, "Validando y publicando…", "Atinara bloqueará automáticamente un Plan de Resolución compatible antes de materializar el mercado.");
    }

    try {
      await checkRadarPublicationEligibility(context);
      const { data, error } = await client.rpc("publish_market_draft", publicationPayload(context));
      if (error) throw error;

      if (safeText(data?.status, 40) === "scheduled") {
        if (status) {
          status.dataset.tone = "success";
          renderPublicationStatus(status, "Mercado programado", "Se publicará en la fecha autorizada y el Plan de Resolución ha quedado validado.");
        }
        setTimeout(() => window.location.reload(), 900);
        return;
      }

      const publication = storePublication(data || {}, context);
      if (status) {
        status.dataset.tone = "success";
        renderPublicationStatus(status, "Mercado publicado", "Abriendo el catálogo administrativo con el nuevo mercado resaltado.");
      }
      openCatalog(publication);
    } catch (error) {
      const raw = await detailedError(error);
      if (status) {
        status.dataset.tone = "error";
        renderPublicationStatus(status, "Publicación bloqueada de forma segura", friendlyPublicationError(raw), raw);
      }
      button.disabled = false;
      button.textContent = previousLabel;
      if (fieldset) fieldset.removeAttribute("aria-busy");
    } finally {
      publicationInFlight = false;
    }
  }

  function enhanceBindingMessage() {
    const node = document.querySelector('.admin-binding-compatibility[data-compatible="true"]');
    const button = document.querySelector("[data-publish-draft][data-state-allowed='true']");
    if (!node || !button || node.querySelector("[data-auto-lock-hint]")) return;
    const hint = document.createElement("small");
    hint.dataset.autoLockHint = "true";
    hint.textContent = "Atinara validará y bloqueará automáticamente este plan dentro de la misma transacción de publicación.";
    node.appendChild(hint);
  }

  function restorePublication() {
    clearTimeout(restoreTimer);
    restoreTimer = setTimeout(() => {
      enhanceBindingMessage();
      let publication;
      try {
        publication = JSON.parse(sessionStorage.getItem(PUBLICATION_KEY) || "null");
      } catch {
        sessionStorage.removeItem(PUBLICATION_KEY);
        return;
      }
      if (publication?.marketId && publication.adminHandled !== true) {
        openCatalog(publication);
      }
    }, 100);
  }

  root.addEventListener("click", (event) => {
    const button = event.target.closest("[data-publish-draft]");
    if (!button || button.disabled) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    runPublication(button);
  }, true);

  new MutationObserver(restorePublication).observe(root, { childList: true, subtree: true });
  restorePublication();
})();
