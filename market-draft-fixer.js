(function initMarketDraftFixer() {
  "use strict";

  const root = document.querySelector("#admin-markets-root");
  const client = window.orakloSupabase;
  if (!root || !client) return;

  const RETURN_KEY = "atinara:market-draft-repair:return:v3";
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
    if (gate.dataset.latestAttemptClassification === "technical") return false;
    const hasContentIssues = gate.querySelectorAll("[data-content-issue='true']").length > 0;
    return hasContentIssues && /(rejected|rechazad|inconclus|incomplet|contradic|ambigu)/i.test(gate.textContent || "");
  }

  function enhance() {
    const gate = document.querySelector(".admin-review-gate");
    const draft = currentDraft();
    if (!gate || !draft || !needsRepair() || gate.querySelector("[data-expert-repair-panel]")) return;

    const issueCount = gate.querySelectorAll("[data-content-issue='true']").length;
    const panel = document.createElement("section");
    panel.className = "admin-expert-repair-panel";
    panel.dataset.expertRepairPanel = "true";
    panel.innerHTML = `
      <div>
        <p class="eyebrow">Corrector experto · cambios mínimos y auditados</p>
        <h4>Resolver ${issueCount} ${issueCount === 1 ? "incongruencia" : "incongruencias"}</h4>
      </div>
      <p>Atinara elegirá la regla más objetiva que esté respaldada por el borrador. En acontecimientos digitales globales normaliza el límite en UTC y define expresamente lanzamientos regionales, acceso anticipado, betas, demos y predescargas.</p>
      <div class="admin-expert-repair-panel-actions">
        <button class="primary-button" type="button" data-expert-repair-draft>Aplicar correcciones y volver a revisar</button>
        <small>No confirma, programa ni publica por ti. La confirmación humana seguirá siendo obligatoria.</small>
      </div>
      <p class="admin-expert-repair-panel-status" data-expert-repair-status hidden></p>
    `;
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

  async function errorMessage(error) {
    let message = safeText(error?.message || error?.context?.message, 800);
    try {
      if (error?.context && typeof error.context.clone === "function") {
        const body = await error.context.clone().json();
        message = safeText(body?.message || body?.error || message, 800);
      }
    } catch {
      // El mensaje genérico sigue siendo seguro.
    }
    return message || "No se pudieron aplicar las correcciones. El borrador continúa privado.";
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
      status.textContent = "El Corrector Experto está alineando pregunta, criterios, zona horaria, fuentes y Plan de Resolución.";
    }

    try {
      const { data, error } = await client.functions.invoke("market-draft-fixer", {
        body: {
          action: "repair-and-revalidate",
          draft_id: draft.id,
          expected_version: draft.version
        }
      });
      if (error) throw error;
      const reviewStatus = safeText(data?.review?.status || "inconclusive", 50);
      const approved = reviewStatus === "approved";
      const message = safeText(data?.message, 1000) || (approved
        ? "Correcciones aplicadas y revisión aprobada."
        : "Correcciones aplicadas; la revisión conserva observaciones pendientes.");
      const changedFields = Array.isArray(data?.changed_fields) ? data.changed_fields : [];

      sessionStorage.setItem(RETURN_KEY, JSON.stringify({
        draftId: draft.id,
        status: approved ? "success" : "warning",
        message,
        changedFields,
        newVersion: data?.new_version || null
      }));
      if (status) {
        status.dataset.tone = approved ? "success" : "warning";
        status.textContent = message;
      }
      setTimeout(() => window.location.reload(), 700);
    } catch (error) {
      if (status) {
        status.hidden = false;
        status.dataset.tone = "error";
        status.textContent = await errorMessage(error);
      }
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
        banner.innerHTML = `<strong>${result.status === "success" ? "Corrección completada" : "Corrección aplicada con revisión pendiente"}</strong><span>${safeText(result.message, 1000)}${changed}</span>`;
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
