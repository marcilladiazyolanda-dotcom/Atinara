(function initRadarExpertBridge() {
  "use strict";

  const root = document.querySelector("#admin-markets-root");
  const client = window.orakloSupabase;
  const helpers = window.atinaraMarketAdmin;
  if (!root || !client || !helpers) return;

  const packageCache = new Map();
  const pendingPackages = new Map();
  const packageRequestVersions = new Map();
  const appliedPackages = new Map();
  const applyingCandidates = new Set();
  const analysisAttempts = new Map();
  const STORAGE_KEY = "atinara:radar-expert-draft-package:v1";
  const SAVED_NOTICE_KEY = "atinara:radar-expert-saved:v1";
  let scanTimer = null;
  let forceNextScan = false;
  let detailRequestSequence = 0;
  let bridgeStatus = null;

  const labels = {
    decision: {
      create: "Crear",
      create_with_edits: "Crear con ajustes",
      reject: "Rechazar",
      stale: "Obsoleta",
      merge_duplicate: "Fusionar con duplicado",
      escalate: "Revisión humana necesaria"
    },
    integrity: { pass: "Válida", needs_edit: "Necesita ajustes", fail: "Bloqueada" },
    forecastability: {
      forecastable: "Pronosticable",
      valid_low_probability: "Válida y poco probable",
      valid_very_unlikely: "Válida y muy improbable",
      already_determined: "Resultado ya determinado",
      stale: "Obsoleta",
      unknown: "Sin determinar"
    },
    sources: {
      ready: "Preparadas",
      ready_with_warnings: "Preparadas con advertencias",
      needs_official_source: "Falta fuente oficial",
      needs_monitoring: "Necesita monitorización",
      not_resolvable: "No resoluble"
    },
    gate: {
      proposal_ready: "Propuesta lista",
      proposal_ready_with_issues: "Propuesta privada con incidencias",
      candidate_terminal: "Candidata terminal",
      validated: "Propuesta validada",
      warning: "Apta con advertencias",
      repairable: "Reparación automática disponible",
      blocked: "Propuesta bloqueada"
    }
  };

  const reasonLabels = {
    TEMPORAL_END_REQUIRED: "Falta la fecha final de evaluación.",
    TEMPORAL_WINDOW_ALREADY_ENDED: "La ventana temporal ya terminó.",
    TEMPORAL_INCOHERENCE: "Las fechas del contrato son incompatibles.",
    TEMPORAL_AUTHORITATIVE_DATE_REQUIRED: "Falta una fecha oficial demostrada; puede guardarse un borrador privado, pero no aprobarse.",
    TEMPORAL_SOURCE_SEMANTICS_MISMATCH: "La fecha técnica del proveedor no demuestra la fecha canónica de Atinara.",
    ESSENTIAL_TEXT_NOT_SPANISH: "La pregunta y los criterios esenciales deben quedar en español antes de aprobar.",
    GAMING_DOMAIN_REVIEW_REQUIRED: "La pertenencia al dominio gaming necesita revisión determinista.",
    RESOLUTION_PRIMARY_SOURCE_REQUIRED: "Falta una fuente primaria de resolución.",
    RESOLUTION_PRIMARY_SOURCE_MULTIPLE: "Hay más de una fuente marcada como primaria.",
    SOURCE_PRECEDENCE_INVALID: "El orden de precedencia de las fuentes no es válido.",
    INVALID_OR_UNVERIFIED_SOURCE: "Existe una URL de fuente no válida o no verificable.",
    DUPLICATE_MARKET: "La candidata coincide con otro mercado o borrador.",
    EVENT_ALREADY_RESOLVED: "El resultado ya es público.",
    EXPERT_PROVIDER_DEGRADED: "El proveedor editorial estuvo temporalmente limitado; se conserva la evaluación determinista.",
    EXPERT_NOT_CONFIGURED: "El análisis editorial avanzado no está configurado.",
    MARKET_EXPERT_ANALYSIS_REQUIRED: "Primero debe completarse un análisis experto.",
    MARKET_EXPERT_ANALYSIS_STALE: "El análisis experto pertenece a una revisión anterior de la candidata.",
    MARKET_EXPERT_ANALYSIS_NOT_PERSISTED: "El análisis no quedó guardado como dictamen vigente.",
    MARKET_EXPERT_DOSSIER_UNAVAILABLE: "No se pudo recuperar el expediente experto.",
    MARKET_EXPERT_DRAFT_ALREADY_EXISTS: "Ya existe un borrador para esta candidata y no coincide con este intento.",
    MARKET_EXPERT_RUN_INVALID: "El dictamen no coincide con la candidata o su revisión vigente.",
    PRIVATE_ISSUE_DRAFT_NOT_ALLOWED: "La propuesta con incidencias ya no cumple la puerta vigente.",
    RADAR_PREPARATION_REVISION_MISMATCH: "La revisión de preparación cambió. Vuelve a aplicar la propuesta vigente.",
    RADAR_PARENT_RECONCILIATION_INCOMPLETE: "El padre aún no ha terminado su reconciliación autoritativa.",
    AGENT_STRATEGY_HANDLER_MISSING: "La versión activa del Agente Editor no coincide con el Registry vigente.",
    RADAR_ELIGIBILITY_REQUIRED: "La candidata necesita una decisión de elegibilidad vigente antes de avanzar.",
    ELIGIBILITY_EXPIRED: "La elegibilidad ha caducado. Actualiza el Radar.",
    CANDIDATE_NOT_REVALIDATABLE: "La candidata no admite una acción de preparación en su estado actual.",
    PROVIDER_RATE_LIMITED: "El proveedor ha limitado temporalmente las consultas.",
    PROVIDER_TIMEOUT: "El proveedor no respondió dentro del tiempo seguro.",
    SERVICE_UNAVAILABLE: "El servicio experto no está disponible temporalmente.",
    RADAR_CANDIDATE_NOT_PREPARABLE: "La candidata no cumple todavía las condiciones para preparar un borrador.",
    RADAR_NORMALIZER_OUTDATED: "La candidata debe actualizarse con la versión actual del normalizador.",
    RADAR_ELIGIBILITY_POLICY_OUTDATED: "La candidata debe revisarse con la política de elegibilidad actual.",
    RADAR_RESOLUTION_SOURCE_REQUIRED: "Falta una fuente de resolución verificable para esta candidata."
  };
  const sourceRoleLabels = {
    DISCOVERY_SIGNAL: "Señal de descubrimiento",
    PROBABILITY_SIGNAL: "Señal de probabilidad",
    CONTEXT_SOURCE: "Fuente de contexto",
    PRIMARY_RESOLUTION: "Fuente primaria de resolución",
    FALLBACK_RESOLUTION: "Fuente alternativa de resolución",
    CORROBORATION: "Fuente de corroboración",
    PROHIBITED_FOR_RESOLUTION: "No válida para resolver",
  };
  const workflowOwnerLabels = {
    radar: "Radar",
    editor: "Agente Editor",
    validator: "Validator",
    corrector: "Corrector",
    human_review: "Revisión humana",
    publication_gate: "Puerta de publicación",
    provider: "Proveedor",
    internal_platform: "Plataforma interna",
  };
  const workflowActionLabels = {
    resolve_temporal_contract: "Investigar y normalizar la fecha",
    repair_temporal_or_source_contract: "Buscar evidencia y corregir el contrato",
    repair_child_identity: "Alinear la identidad de la opción",
    repair_essential_spanish_text: "Corregir el contrato esencial en español",
    repair_draft_issues: "Abrir el Corrector",
    request_market_validation: "Solicitar una nueva validación",
    retry_market_validation: "Reintentar Validator",
    refresh_draft_eligibility: "Renovar la elegibilidad",
    review_gaming_domain: "Revisar la pertenencia gaming",
    recheck_provider_identity: "Volver a comprobar la opción del proveedor",
    archive_terminal_candidate: "Conservar en la auditoría terminal",
  };

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function externalLink(url, label) {
    try {
      const parsed = new URL(String(url || ""));
      if (parsed.protocol !== "https:") return "";
      return `<a class="secondary-button radar-link-button" href="${escapeHtml(parsed.toString())}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a>`;
    } catch {
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

  function datetimeLocal(value, timeZone = "Europe/Madrid") {
    return helpers.localDateTime(value, timeZone);
  }

  function isRecord(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  }

  function typedCode(value, fallback = "MARKET_EXPERT_DOSSIER_UNAVAILABLE") {
    const code = String(value || "").trim().slice(0, 100);
    return /^[A-Z][A-Z0-9_]{2,99}$/.test(code) ? code : fallback;
  }

  function localTypedError(code, message) {
    const error = new Error(String(message || "").trim().slice(0, 1_000));
    error.code = typedCode(code);
    return error;
  }

  async function expertInvocationError(error, fallback) {
    let payload = null;
    try {
      if (error?.context && typeof error.context.clone === "function") {
        payload = await error.context.clone().json();
      }
    } catch {
      // El cuerpo puede no ser JSON. Nunca se muestra una respuesta cruda.
    }
    const payloadError = isRecord(payload?.error) ? payload.error : null;
    const code = typedCode(
      payloadError?.code
      || (typeof payload?.error === "string" ? payload.error : "")
      || payload?.code
      || error?.code
    );
    const wrapped = localTypedError(
      code,
      payloadError?.message || payload?.message || reasonLabels[code] || fallback
    );
    wrapped.status = Number(error?.context?.status) || null;
    wrapped.retryable = payload?.retryable === true || wrapped.status === 429 || wrapped.status >= 500;
    wrapped.gate = isRecord(payload?.gate) ? payload.gate : null;
    return wrapped;
  }

  async function invokeExpert(action, payload) {
    const { data, error } = await client.functions.invoke("market-expert", {
      body: { action, ...(payload || {}) }
    });
    if (error) throw await expertInvocationError(error, "No se pudo completar la operación del Agente Editor.");
    return data || {};
  }

  function invalidatePackage(candidateId) {
    packageRequestVersions.set(candidateId, (packageRequestVersions.get(candidateId) || 0) + 1);
    packageCache.delete(candidateId);
    pendingPackages.delete(candidateId);
  }

  async function loadPackage(candidateId, force = false) {
    if (!force && packageCache.has(candidateId)) return packageCache.get(candidateId);
    const pending = pendingPackages.get(candidateId);
    if (!force && pending) return pending.promise;
    const requestVersion = (packageRequestVersions.get(candidateId) || 0) + 1;
    packageRequestVersions.set(candidateId, requestVersion);
    const promise = invokeExpert("get-draft-package", {
      origin_type: "radar_candidate",
      origin_id: candidateId
    }).then((data) => {
      const rawPackage = isRecord(data.package) ? data.package : {};
      const rawGate = isRecord(rawPackage.gate) ? rawPackage.gate : isRecord(data.gate) ? data.gate : {};
      const fallbackCode = typedCode(
        isRecord(data.error) ? data.error.code : data.error || data.code,
        "MARKET_EXPERT_ANALYSIS_REQUIRED"
      );
      const value = {
        ...rawPackage,
        available: rawPackage.available === true,
        gate: {
          status: "blocked",
          can_prefill: false,
          can_save_private_draft: false,
          hard_blocks: rawPackage.available === true ? [] : [fallbackCode],
          warnings: [],
          ...rawGate,
        },
        error: rawPackage.error || (data.error || data.message ? {
          code: fallbackCode,
          message: data.message || reasonLabels[fallbackCode] || "El expediente está bloqueado."
        } : null),
      };
      if (packageRequestVersions.get(candidateId) === requestVersion) {
        packageCache.set(candidateId, value);
      }
      return value;
    }).finally(() => {
      if (pendingPackages.get(candidateId)?.requestVersion === requestVersion) {
        pendingPackages.delete(candidateId);
      }
    });
    pendingPackages.set(candidateId, { requestVersion, promise });
    return promise;
  }

  function preparationRevisionFrom(value) {
    return String(
      value?.preparation_revision
      || value?.origin_preparation_revision
      || value?.origin?.preparation_revision
      || value?.candidate?.preparation_revision
      || value?.reservation?.preparation_revision
      || value?.run?.origin_preparation_revision
      || value?.run?.result_json?.origin_preparation_revision
      || value?.verdict?.origin_preparation_revision
      || ""
    ).trim();
  }

  function packageMatchesPreparation(pkg, preparationRevision) {
    const originRevisions = [pkg?.preparation_revision, pkg?.origin?.preparation_revision]
      .filter((value) => value !== null && value !== undefined && String(value).trim())
      .map((value) => String(value).trim());
    const expertRevisions = [
      pkg?.run?.origin_preparation_revision,
      pkg?.run?.result_json?.origin_preparation_revision,
      pkg?.verdict?.origin_preparation_revision
    ].filter((value) => value !== null && value !== undefined && String(value).trim())
      .map((value) => String(value).trim());
    return Boolean(
      preparationRevision
      && originRevisions.length
      && expertRevisions.length
      && originRevisions.every((revision) => revision === preparationRevision)
      && expertRevisions.every((revision) => revision === preparationRevision)
    );
  }

  function clearPreparedPackage(candidateId = "") {
    try { sessionStorage.removeItem(STORAGE_KEY); } catch { /* The in-memory binding is cleared below. */ }
    if (candidateId) appliedPackages.delete(candidateId);
    else appliedPackages.clear();
  }

  function rememberPreparedPackage(candidateId, preparationRevision, pkg) {
    const value = {
      candidate_id: candidateId,
      preparation_revision: preparationRevision,
      package: pkg
    };
    appliedPackages.set(candidateId, value);
    try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(value)); } catch { /* Memory remains authoritative for this page. */ }
    return value;
  }

  function readPreparedPackage(candidateId) {
    const inMemory = appliedPackages.get(candidateId);
    if (inMemory?.candidate_id === candidateId && inMemory?.package) return inMemory;
    try {
      const stored = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || "null");
      if (stored?.candidate_id === candidateId && stored?.package) {
        appliedPackages.set(candidateId, stored);
        return stored;
      }
    } catch {
      // A missing or malformed session binding must never fall back to a stale package.
    }
    appliedPackages.delete(candidateId);
    return null;
  }

  function renderBridgeStatus() {
    let status = root.querySelector("[data-market-expert-bridge-status]");
    if (!bridgeStatus) {
      status?.remove();
      return;
    }
    if (!status) {
      status = document.createElement("p");
      status.className = "market-expert-bridge-status";
      status.dataset.marketExpertBridgeStatus = "true";
      status.setAttribute("role", bridgeStatus.tone === "error" ? "alert" : "status");
      root.prepend(status);
    }
    status.setAttribute("role", bridgeStatus.tone === "error" ? "alert" : "status");
    status.dataset.tone = bridgeStatus.tone;
    status.textContent = bridgeStatus.message;
  }

  function setBridgeStatus(message, tone = "warning") {
    bridgeStatus = message ? { message, tone } : null;
    renderBridgeStatus();
  }

  function listMarkup(values, tone) {
    const items = Array.isArray(values) ? values.filter(Boolean) : [];
    if (!items.length) return "";
    return `<ul class="market-expert-issue-list" data-tone="${escapeHtml(tone)}">${items.map((code) => `
      <li><span>${escapeHtml(reasonLabels[code] || "Atinara ha detenido esta transición de forma segura.")}</span><small>Referencia ${escapeHtml(code)}</small></li>`).join("")}</ul>`;
  }

  function agentTimelineMarkup(execution) {
    const tools = Array.isArray(execution?.tools) ? execution.tools.filter(isRecord).slice(0, 24) : [];
    if (!tools.length) return "";
    const statusLabels = {
      completed: "Completado",
      degraded: "Completado con incidencia técnica",
      failed: "Fallido",
      no_op: "Sin cambios"
    };
    const toolLabels = {
      load_authoritative_origin: "Cargar origen autoritativo",
      run_deterministic_gate: "Aplicar puerta determinista",
      request_editorial_enrichment: "Preparar análisis editorial",
      validate_resolution_contract: "Validar el Plan de Resolución",
      build_private_draft_gate: "Preparar la puerta del borrador privado",
      persist_editor_run: "Guardar el expediente experto",
    };
    return `<section class="market-agent-timeline" aria-label="Trazabilidad del Agente Editor">
      <h4>Trazabilidad de herramientas</h4>
      <ol>${tools.map((step) => `<li>
        <span>${escapeHtml(toolLabels[step.tool] || "Comprobación controlada")}</span>
        <small>${escapeHtml(statusLabels[step.status] || "Registrado")}${Number.isFinite(Number(step.duration_ms)) ? ` · ${Math.max(0, Number(step.duration_ms))} ms` : ""}</small>
      </li>`).join("")}</ol>
    </section>`;
  }

  function packageCanApply(pkg, candidateId = "") {
    const canCreatePrivateDraft = pkg?.gate?.can_save_private_draft === true
      || pkg?.gate?.can_materialize_private_repair_draft === true;
    return pkg?.available === true
      && pkg?.origin?.type === "radar_candidate"
      && Boolean(pkg?.origin?.id)
      && (!candidateId || pkg.origin.id === candidateId)
      && Boolean(pkg?.run?.id)
      && (pkg?.gate?.can_prefill === true
        || pkg?.gate?.can_materialize_private_repair_draft === true)
      && canCreatePrivateDraft;
  }

  function packageFailure(pkg) {
    const gate = isRecord(pkg?.gate) ? pkg.gate : {};
    const hardBlocks = Array.isArray(gate.hard_blocks) ? gate.hard_blocks.filter(Boolean) : [];
    const embedded = isRecord(pkg?.error) ? pkg.error : {};
    const code = typedCode(
      embedded.code || (typeof pkg?.error === "string" ? pkg.error : "") || pkg?.code || hardBlocks[0],
      "MARKET_EXPERT_ANALYSIS_REQUIRED"
    );
    return {
      code,
      message: String(embedded.message || pkg?.message || reasonLabels[code] || "El expediente está bloqueado.").trim().slice(0, 1_000),
      retryable: embedded.retryable === true || pkg?.retryable === true,
      hardBlocks: [...new Set([code, ...hardBlocks.map((item) => typedCode(item, String(item).slice(0, 100)))])],
    };
  }

  function safeDraftSaveError(error) {
    const messageCode = String(error?.message || "").trim();
    const code = typedCode(
      /^[A-Z][A-Z0-9_]{2,99}$/.test(messageCode) ? messageCode : error?.code,
      "MARKET_EXPERT_DOSSIER_UNAVAILABLE"
    );
    const message = reasonLabels[code]
      || "No se pudo guardar el borrador. El expediente sigue privado y puede reintentarse después de recargar su estado.";
    return `${message} Referencia ${code}.`;
  }

  function normalizeAnalysisFailure(value) {
    const failure = isRecord(value) ? value : {};
    const code = typedCode(failure.code);
    return {
      code,
      message: String(
        failure.message
        || reasonLabels[code]
        || "El Agente Editor no pudo completar el análisis. No se ha guardado ni preparado nada."
      ).trim().slice(0, 1_000),
      retryable: failure.retryable === true,
      status: Number(failure.status) || null,
      phase: String(failure.phase || "").trim().slice(0, 80),
      state_preserved: failure.state_preserved === true,
      gate: isRecord(failure.gate) ? failure.gate : null,
    };
  }

  function analysisFailureStatus(failure) {
    if (["MARKET_EXPERT_ANALYSIS_STALE", "MARKET_EXPERT_ANALYSIS_NOT_PERSISTED"]
      .includes(failure.code)) return "Análisis obsoleto";
    if (["RADAR_ELIGIBILITY_REQUIRED", "ELIGIBILITY_EXPIRED", "RADAR_ELIGIBILITY_POLICY_OUTDATED"]
      .includes(failure.code)) return "Elegibilidad obsoleta";
    if (failure.retryable || failure.status === 429 || failure.status >= 500) {
      return "Servicio temporalmente no disponible";
    }
    return "Error técnico";
  }

  function failedAnalysisPackage(value) {
    const failure = normalizeAnalysisFailure(value);
    return {
      available: false,
      ui_status_label: analysisFailureStatus(failure),
      gate: failure.gate || {
        status: "blocked",
        can_prefill: false,
        can_save_private_draft: false,
        hard_blocks: [failure.code],
        warnings: [],
      },
      error: failure,
    };
  }

  function processingDossierMarkup() {
    return `<div class="market-expert-dossier-heading">
        <div><p class="eyebrow">Expediente experto · ejecución controlada</p><h3>Agente Editor</h3></div>
        <span class="market-expert-dossier-status">Procesando</span>
      </div>
      <p role="status">El Agente Editor está comprobando el Registry, las puertas deterministas y la revisión vigente. La acción ya ha comenzado.</p>
      <div class="market-expert-dossier-actions"><small>No se prepara, guarda, confirma ni publica ningún mercado durante este análisis.</small></div>`;
  }

  function blockedDossierMarkup(pkg, candidateId) {
    const gate = isRecord(pkg?.gate) ? pkg.gate : {};
    const failure = packageFailure(pkg);
    const statusLabel = String(pkg?.ui_status_label || labels.gate[gate.status] || "Propuesta bloqueada");
    return `<div class="market-expert-dossier-heading">
        <div><p class="eyebrow">Expediente experto · lectura segura</p><h3>Agente Editor</h3></div>
        <span class="market-expert-dossier-status">${escapeHtml(statusLabel)}</span>
      </div>
      <p>${escapeHtml(failure.message)}</p>
      <div><h4>Estado tipado</h4>${listMarkup(failure.hardBlocks, "error")}</div>
      <div class="market-expert-dossier-actions">
        <button class="primary-button" type="button" data-radar-expert="${escapeHtml(candidateId)}">${failure.retryable ? "Reintentar análisis" : "Analizar con el Agente Editor"}</button>
        <small>${failure.retryable
          ? "La incidencia es temporal. Analizar vuelve a solicitar un dictamen sin preparar, guardar ni publicar nada."
          : "Analizar crea o actualiza el dictamen sin preparar, guardar, confirmar ni publicar ningún mercado."}</small>
      </div>`;
  }

  function dossierMarkup(pkg, candidateId) {
    if (!pkg?.available) {
      return blockedDossierMarkup(pkg, candidateId);
    }
    const verdict = pkg.verdict || {};
    const fields = pkg.fields || {};
    const contract = pkg.contract || {};
    const gate = pkg.gate || {};
    const sources = Array.isArray(pkg.sources) ? pkg.sources : [];
    const hardBlocks = Array.isArray(gate.hard_blocks) ? gate.hard_blocks : [];
    const warnings = [...new Set([
      ...(Array.isArray(gate.warnings) ? gate.warnings : []),
      ...(Array.isArray(verdict.warnings) ? verdict.warnings : []),
    ])];
    const telemetryIncomplete = warnings.includes("AI_TELEMETRY_WRITE_FAILED");
    const recovery = isRecord(gate.automatic_recovery) ? gate.automatic_recovery : null;
    const isApplying = applyingCandidates.has(candidateId);
    const gateAllowsApply = (
      gate.can_prefill === true
      && gate.can_save_private_draft === true
    ) || gate.can_materialize_private_repair_draft === true;
    const repairMaterialization = gate.can_save_private_draft !== true
      && gate.can_materialize_private_repair_draft === true;
    const canApply = packageCanApply(pkg, candidateId) && !isApplying;
    const workflowIssues = Array.isArray(gate.workflow_issues) ? gate.workflow_issues : [];
    const sourceMarkup = sources.length
      ? `<ul class="market-expert-source-list">${sources.map((source) => `<li>
          <strong>${escapeHtml(sourceRoleLabels[source.role] || "Fuente registrada")}</strong>
          <span>Precedencia ${escapeHtml(source.precedence || "—")}${source.required ? " · obligatoria" : ""}</span>
          ${externalLink(source.url, "Abrir fuente")}
        </li>`).join("")}</ul>`
      : `<p>No hay fuentes vinculables en el contrato.</p>`;

    return `
      <div class="market-expert-dossier-heading">
        <div>
          <p class="eyebrow">Expediente experto · sin cadena de pensamiento</p>
          <h3>Agente Editor</h3>
        </div>
        <span class="market-expert-dossier-status">${escapeHtml(labels.gate[gate.status] || "Estado pendiente")}</span>
      </div>
      <p>${escapeHtml(verdict.summary || "Dictamen estructurado disponible.")}</p>
      <dl class="market-expert-dossier-grid">
        <div><dt>Decisión</dt><dd>${escapeHtml(labels.decision[verdict.decision] || "Pendiente")}</dd></div>
        <div><dt>Integridad</dt><dd>${escapeHtml(labels.integrity[verdict.integrity_status] || "Pendiente")}</dd></div>
        <div><dt>Pronosticabilidad</dt><dd>${escapeHtml(labels.forecastability[verdict.forecastability_status] || "Pendiente")}</dd></div>
        <div><dt>Fuentes</dt><dd>${escapeHtml(labels.sources[verdict.source_readiness] || "Pendiente")}</dd></div>
        <div><dt>Confianza del dictamen</dt><dd>${escapeHtml(verdict.confidence ?? "—")}/100</dd></div>
        <div><dt>Confirmación humana</dt><dd>${verdict.human_review_required === false ? "No" : "Obligatoria"}</dd></div>
      </dl>
      ${telemetryIncomplete ? `<p class="market-agent-observability-warning" role="status">Observabilidad incompleta. El dictamen se conserva y Atinara no repetirá la inferencia para cambiarlo.</p>` : ""}
      ${agentTimelineMarkup(verdict.agent_execution)}
      <div>
        <h4>Propuesta editable</h4>
        <div class="market-expert-proposal-grid">
          <div class="market-expert-field-wide"><span class="expert-field-label">Pregunta</span><strong>${escapeHtml(fields.question || "Sin pregunta")}</strong></div>
          <div><span class="expert-field-label">Categoría</span><span>${escapeHtml(fields.category || "Pendiente")}</span></div>
          <div><span class="expert-field-label">Sujeto</span><span>${escapeHtml(fields.subject || "Pendiente")}</span></div>
          <div><span class="expert-field-label">Fin de evaluación</span><span>${escapeHtml(displayDate(fields.evaluation_ends_at))}</span></div>
          <div><span class="expert-field-label">Fuente primaria</span><span>${escapeHtml(fields.primary_source_url || "Pendiente")}</span></div>
          <div class="market-expert-field-wide"><span class="expert-field-label">Criterio Sí</span><span>${escapeHtml(fields.yes_criteria || "Pendiente")}</span></div>
          <div class="market-expert-field-wide"><span class="expert-field-label">Criterio No</span><span>${escapeHtml(fields.no_criteria || "Pendiente")}</span></div>
          <div class="market-expert-field-wide"><span class="expert-field-label">Casos límite</span><span>${escapeHtml(fields.edge_cases || "Pendiente")}</span></div>
        </div>
      </div>
      <div>
        <h4>Plan de Resolución</h4>
        <div class="market-expert-contract-grid">
          <div><span class="expert-field-label">Estrategia</span><span>${escapeHtml({ manual_official_source: "Revisión de fuente oficial", snapshot_at_deadline: "Captura en la fecha límite", poll_during_window: "Seguimiento durante el periodo" }[contract.capture_strategy] || "Pendiente")}</span></div>
          <div><span class="expert-field-label">Proveedor contractual</span><span>${escapeHtml({ official_web: "Fuente oficial registrada", polymarket: "Polymarket", kalshi: "Kalshi" }[contract.provider] || "Proveedor registrado")}</span></div>
          <div><span class="expert-field-label">Evaluación</span><span>${escapeHtml(displayDate(contract.evaluation_at || contract.window_end))}</span></div>
          <div><span class="expert-field-label">Zona horaria</span><span>${escapeHtml(contract.timezone || "Pendiente")}</span></div>
        </div>
        <h4>Fuentes y roles</h4>
        ${sourceMarkup}
      </div>
      ${hardBlocks.length ? `<div><h4>Bloqueos</h4>${listMarkup(hardBlocks, "error")}</div>` : ""}
      ${workflowIssues.length ? `<div><h4>Incidencias que viajarán con el borrador</h4><ul class="market-expert-source-list">${workflowIssues.map((issue) => `<li>
        <strong>${escapeHtml(reasonLabels[issue.issue_code] || "Incidencia estructurada")}</strong>
        <span>Responsable: ${escapeHtml(workflowOwnerLabels[issue.owner_stage] || "Revisión administrativa")} · Próxima acción: ${escapeHtml(workflowActionLabels[issue.next_action] || "Revisar el borrador")}</span>
      </li>`).join("")}</ul></div>` : ""}
      ${warnings.length ? `<div><h4>Advertencias</h4>${listMarkup(warnings, "warning")}</div>` : ""}
      <div class="market-expert-dossier-actions">
        <button class="primary-button" type="button" data-expert-apply="${escapeHtml(candidateId)}"${canApply ? "" : " disabled"}>${isApplying ? "Preparando propuesta…" : "Aplicar propuesta al formulario"}</button>
        <small>${isApplying
          ? "Revalidando Radar y actualizando el dictamen antes de cargar el formulario."
          : gateAllowsApply
          ? repairMaterialization
            ? "Solo pre-rellena. Al guardar se creará un borrador privado en reparación; el Corrector completará lo deducible y volverá a validarlo."
            : "Solo pre-rellena. El borrador se guardará cuando tú pulses Guardar y conservará Radar, dictamen, contrato y fuentes en una única transacción."
          : "La propuesta solo se detiene aquí ante una condición terminal. Las incidencias reparables pasan al borrador privado con responsable y siguiente acción."}</small>
      </div>`;
  }

  async function enhanceDetail(detail, force = false) {
    const candidateId = detail.querySelector("[data-radar-expert]")?.dataset.radarExpert
      || detail.querySelector("[data-radar-prepare]")?.dataset.radarPrepare;
    if (!candidateId) return;
    const sections = [...detail.querySelectorAll("section")];
    const target = sections.find((section) => section.querySelector(":scope > h3")?.textContent.trim() === "Agente Editor")
      || sections.at(-1);
    if (!target) return;
    const requestId = String(++detailRequestSequence);
    target.dataset.expertPackageRequest = requestId;
    target.classList.add("market-expert-dossier");
    target.dataset.gate = "loading";
    const analysisAttempt = analysisAttempts.get(candidateId);
    if (analysisAttempt?.status === "processing") {
      target.dataset.gate = "processing";
      target.innerHTML = processingDossierMarkup();
      return;
    }
    if (analysisAttempt?.status === "failed") {
      target.dataset.gate = "blocked";
      target.innerHTML = blockedDossierMarkup(failedAnalysisPackage(analysisAttempt.failure), candidateId);
      return;
    }
    target.innerHTML = `<h3>Agente Editor</h3><p>Cargando el expediente experto…</p>`;
    try {
      const pkg = await loadPackage(candidateId, force);
      if (!target.isConnected || target.dataset.expertPackageRequest !== requestId) return;
      target.dataset.gate = pkg?.gate?.status || "blocked";
      target.innerHTML = dossierMarkup(pkg, candidateId);
    } catch (error) {
      if (!target.isConnected || target.dataset.expertPackageRequest !== requestId) return;
      target.dataset.gate = "blocked";
      target.innerHTML = blockedDossierMarkup({
        available: false,
        gate: error?.gate || {
          status: "blocked",
          can_prefill: false,
          can_save_private_draft: false,
          hard_blocks: [typedCode(error?.code)],
          warnings: [],
        },
        error: {
          code: typedCode(error?.code),
          message: error?.message || "No se pudo cargar el expediente experto.",
          retryable: error?.retryable === true,
        },
      }, candidateId);
    }
  }

  function scheduleScan(force = false) {
    forceNextScan ||= force;
    window.clearTimeout(scanTimer);
    scanTimer = window.setTimeout(() => {
      const shouldForce = forceNextScan;
      forceNextScan = false;
      const detail = root.querySelector(".radar-candidate-detail");
      if (detail && (shouldForce || detail.dataset.expertDossierReady !== "true")) {
        detail.dataset.expertDossierReady = "true";
        enhanceDetail(detail, shouldForce);
      }
      showSavedNotice();
      renderBridgeStatus();
    }, 40);
  }

  function waitForForm(timeoutMs = 20_000) {
    return new Promise((resolve, reject) => {
      const startedAt = Date.now();
      const inspect = () => {
        const form = document.querySelector("#admin-market-form");
        if (form) return resolve(form);
        if (Date.now() - startedAt >= timeoutMs) return reject(new Error("FORM_TIMEOUT"));
        window.setTimeout(inspect, 100);
      };
      inspect();
    });
  }

  function setField(form, name, value, transform) {
    const element = form.elements.namedItem(name);
    if (!element || !(element instanceof HTMLElement)) return;
    const finalValue = transform ? transform(value) : String(value ?? "");
    if ("value" in element) element.value = finalValue;
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function applyPackageToForm(form, pkg, preparationRevision) {
    const fields = pkg.fields || {};
    const timezone = fields.timezone || pkg.contract?.timezone || "";
    const mapping = {
      market_slug: fields.market_slug,
      question: fields.question,
      subject: fields.subject,
      category: fields.category,
      evaluation_period_label: fields.evaluation_period_label,
      timezone,
      yes_criteria: fields.yes_criteria,
      no_criteria: fields.no_criteria,
      edge_cases: fields.edge_cases,
      delay_treatment: fields.delay_treatment,
      cancellation_treatment: fields.cancellation_treatment,
      leak_treatment: fields.leak_treatment,
      rename_treatment: fields.rename_treatment,
      assumptions: fields.assumptions,
      public_criteria: fields.public_criteria,
      description: fields.description,
      primary_source_url: fields.primary_source_url,
      alternative_sources: fields.alternative_sources,
      yes_option: "Sí",
      no_option: "No"
    };
    Object.entries(mapping).forEach(([name, value]) => setField(form, name, value));
    setField(form, "evaluation_ends_at", fields.evaluation_ends_at, (value) => datetimeLocal(value, timezone));
    setField(form, "resolution_deadline", fields.resolution_deadline, (value) => datetimeLocal(value, timezone));
    form.dataset.atinaraExpertBridge = "true";
    form.dataset.expertCandidateId = pkg.origin?.id || "";
    form.dataset.expertRunId = pkg.run?.id || "";
    form.dataset.preparationRevision = preparationRevision;

    form.querySelector(".market-expert-bridge-banner")?.remove();
    const banner = document.createElement("aside");
    banner.className = "market-expert-bridge-banner";
    banner.innerHTML = `<strong>Propuesta del Agente Editor aplicada.</strong><span>Revísala y edítala. Al guardar se conservarán atómicamente la procedencia del Radar, el dictamen, el Plan de Resolución y las fuentes. Nada se ha publicado.</span>`;
    form.querySelector(".admin-section-heading")?.insertAdjacentElement("afterend", banner);
    form.scrollIntoView({ behavior: "smooth", block: "start" });
    form.querySelector('[name="question"]')?.focus({ preventScroll: true });
  }

  function statusElement(form) {
    let status = form.querySelector(".market-expert-bridge-status");
    if (!status) {
      status = document.createElement("p");
      status.className = "market-expert-bridge-status";
      status.setAttribute("role", "status");
      form.append(status);
    }
    return status;
  }

  function localDateTimeToIso(value, timeZone = "") {
    const raw = String(value || "").trim();
    if (!raw) return "";
    if (/Z$|[+-]\d{2}:?\d{2}$/.test(raw)) {
      const direct = new Date(raw);
      return Number.isFinite(direct.getTime()) ? direct.toISOString() : "";
    }
    return helpers.toIsoOrEmpty(raw, timeZone);
  }

  function draftPayload(form) {
    const data = new FormData(form);
    const plainFields = [
      "market_slug", "question", "subject", "category", "yes_option", "no_option",
      "evaluation_period_label", "evaluation_ends_at", "timezone", "resolution_deadline",
      "yes_criteria", "no_criteria", "edge_cases", "delay_treatment",
      "cancellation_treatment", "leak_treatment", "rename_treatment", "assumptions",
      "public_criteria", "description"
    ];
    const payload = {};
    plainFields.forEach((field) => { payload[field] = String(data.get(field) || "").trim(); });
    payload.yes_option = payload.yes_option || "Sí";
    payload.no_option = payload.no_option || "No";
    payload.timezone = payload.timezone || "";
    payload.evaluation_ends_at = localDateTimeToIso(payload.evaluation_ends_at, payload.timezone);
    payload.resolution_deadline = localDateTimeToIso(payload.resolution_deadline, payload.timezone);
    const primaryUrl = String(data.get("primary_source_url") || "").trim();
    payload.primary_source = primaryUrl ? { url: primaryUrl } : {};
    payload.alternative_sources = String(data.get("alternative_sources") || "")
      .split(/\r?\n/)
      .map((url) => url.trim())
      .filter(Boolean)
      .map((url) => ({ url }));
    form.dataset.idempotencyKey ||= crypto.randomUUID();
    payload._idempotency_key = form.dataset.idempotencyKey;
    payload._change_origin = "radar_expert_bridge_save";
    payload._timestamp_precision = "milliseconds-v1";
    payload._radar_preparation_revision = String(form.dataset.preparationRevision || "").trim();
    return payload;
  }

  function sourcesForDraft(pkg, payload) {
    const original = Array.isArray(pkg.sources) ? pkg.sources : [];
    const originalByUrl = new Map(original.map((source) => [String(source?.url || "").trim(), source]));
    const output = [];
    const usedPrecedences = new Set([1]);
    let nextPrecedence = 2;
    const primaryUrl = String(payload.primary_source?.url || "").trim();
    if (primaryUrl) {
      output.push({
        url: primaryUrl,
        role: "PRIMARY_RESOLUTION",
        precedence: 1,
        required: true,
        fallback_condition: null
      });
    }
    for (const item of payload.alternative_sources || []) {
      const url = String(item?.url || "").trim();
      if (!url || url === primaryUrl || output.some((source) => source.url === url)) continue;
      const previous = originalByUrl.get(url) || {};
      const previousRole = String(previous.role || "");
      const role = [
        "DISCOVERY_SIGNAL", "PROBABILITY_SIGNAL", "CONTEXT_SOURCE",
        "FALLBACK_RESOLUTION", "CORROBORATION", "PROHIBITED_FOR_RESOLUTION"
      ].includes(previousRole) ? previousRole : "CORROBORATION";
      let precedence = Number(previous.precedence);
      if (!Number.isSafeInteger(precedence) || precedence < 2 || usedPrecedences.has(precedence)) {
        while (usedPrecedences.has(nextPrecedence)) nextPrecedence += 1;
        precedence = nextPrecedence;
      }
      usedPrecedences.add(precedence);
      nextPrecedence = Math.max(nextPrecedence, precedence + 1);
      output.push({
        url,
        role,
        precedence,
        required: previous.required === true,
        fallback_condition: role === "FALLBACK_RESOLUTION"
          ? String(previous.fallback_condition || "Si la fuente primaria deja de estar disponible o no publica el dato previsto.")
          : null
      });
    }
    return output;
  }

  function contractForDraft(pkg, payload, sources) {
    const primaryUrl = String(payload.primary_source?.url || "").trim();
    return {
      ...(pkg.contract || {}),
      canonical_statement: payload.question,
      evaluation_at: payload.evaluation_ends_at || null,
      window_end: payload.evaluation_ends_at || null,
      resolution_deadline: payload.resolution_deadline || null,
      timezone: payload.timezone || null,
      official_event_url: primaryUrl || pkg.contract?.official_event_url || null,
      canonical_url: primaryUrl || pkg.contract?.canonical_url || null,
      sources
    };
  }

  function changedFields(proposed, saved) {
    const fields = [
      "market_slug", "question", "subject", "category", "evaluation_period_label",
      "evaluation_ends_at", "timezone", "resolution_deadline", "yes_criteria",
      "no_criteria", "edge_cases", "public_criteria", "description"
    ];
    const changed = fields.filter((field) => String(proposed?.[field] ?? "").trim() !== String(saved?.[field] ?? "").trim());
    const proposedPrimary = String(proposed?.primary_source_url || "").trim();
    const savedPrimary = String(saved?.primary_source?.url || "").trim();
    if (proposedPrimary !== savedPrimary) changed.push("primary_source");
    return [...new Set(changed)];
  }

  async function saveAtomicExpertDraft(form, pkg) {
    const status = statusElement(form);
    status.dataset.tone = "warning";
    status.textContent = "Guardando el borrador privado y vinculando el expediente experto…";
    const buttons = [...form.querySelectorAll('button[type="submit"], input[type="submit"]')];
    buttons.forEach((button) => { button.disabled = true; });
    try {
      const payload = draftPayload(form);
      if (!/^[a-z0-9][a-z0-9-]{2,119}$/.test(payload.market_slug)) {
        throw new Error("El identificador debe contener solo minúsculas, números y guiones.");
      }
      const sources = sourcesForDraft(pkg, payload);
      const contract = contractForDraft(pkg, payload, sources);
      const issueDraft = pkg?.gate?.status === "proposal_ready_with_issues"
        || (Array.isArray(pkg?.gate?.workflow_issues) && pkg.gate.workflow_issues.length > 0);
      const repairMaterialization = pkg?.gate?.can_save_private_draft !== true
        && pkg?.gate?.can_materialize_private_repair_draft === true;
      const rpcName = issueDraft ? "save_market_draft_from_expert_with_issues_v2"
        : repairMaterialization ? "materialize_market_draft_for_repair_v1"
          : "save_market_draft_from_radar_intelligence";
      const rpcPayload = issueDraft ? {
        candidate_id_input: pkg.origin.id,
        expert_run_id_input: pkg.run.id,
        draft_input: payload
      } : repairMaterialization ? {
        candidate_id_input: pkg.origin.id,
        expected_preparation_revision_input: Number(form.dataset.preparationRevision),
        expert_run_id_input: pkg.run.id,
        draft_input: payload
      } : {
        candidate_id_input: pkg.origin.id,
        draft_id_input: null,
        expected_version_input: null,
        draft_input: payload,
        expert_run_id_input: pkg.run.id,
        contract_input: contract,
        sources_input: sources
      };
      const { data, error } = await client.rpc(rpcName, rpcPayload);
      if (error) throw error;
      const edits = changedFields(pkg.fields, payload);
      let feedbackRecorded = true;
      try {
        await invokeExpert("record-feedback", {
          run_id: pkg.run.id,
          final_decision: edits.length ? "saved_with_edits" : "saved_as_proposed",
          changed_fields: edits,
          reason: edits.length
            ? "La administradora ajustó la propuesta antes de guardarla como borrador privado."
            : "La administradora guardó la propuesta sin cambios materiales."
        });
      } catch {
        feedbackRecorded = false;
      }
      clearPreparedPackage(form.dataset.expertCandidateId);
      const savedMessage = issueDraft
        ? "Borrador privado guardado con sus incidencias, responsable y siguiente acción. Aún no puede aprobarse ni publicarse."
        : repairMaterialization
        ? "Borrador privado creado en estado de reparación. Ya puede intervenir el Corrector Experto."
        : "Borrador privado guardado con procedencia del Radar, dictamen experto, Plan de Resolución y fuentes.";
      const finalMessage = feedbackRecorded
        ? savedMessage
        : `${savedMessage} El feedback editorial no pudo registrarse; el borrador no debe volver a guardarse para repetirlo.`;
      try {
        sessionStorage.setItem(SAVED_NOTICE_KEY, JSON.stringify({
          draft_id: data?.draft?.id || null,
          message: finalMessage,
          tone: feedbackRecorded ? "success" : "warning"
        }));
      } catch { /* El guardado ya es definitivo; el aviso entre recargas es opcional. */ }
      status.dataset.tone = feedbackRecorded ? "success" : "warning";
      status.textContent = feedbackRecorded
        ? "Borrador guardado. Recargando el expediente privado…"
        : "Borrador guardado; el feedback no pudo registrarse. Recargando sin repetir la escritura…";
      window.setTimeout(() => window.location.reload(), 450);
    } catch (error) {
      clearPreparedPackage(form.dataset.expertCandidateId);
      status.dataset.tone = "error";
      status.textContent = safeDraftSaveError(error);
      buttons.forEach((button) => { button.disabled = false; });
      delete form.dataset.expertSaving;
    }
  }

  function showSavedNotice() {
    let raw = null;
    try { raw = sessionStorage.getItem(SAVED_NOTICE_KEY); } catch { return; }
    if (!raw || root.querySelector(".market-expert-saved-notice")) return;
    let value;
    try { value = JSON.parse(raw); } catch { value = { message: raw }; }
    try { sessionStorage.removeItem(SAVED_NOTICE_KEY); } catch { /* The notice can remain in blocked storage. */ }
    const notice = document.createElement("p");
    notice.className = `admin-status-message admin-status-${value.tone === "warning" ? "warning" : "success"} market-expert-saved-notice`;
    notice.setAttribute("role", "status");
    notice.textContent = value.message || "Borrador experto guardado de forma privada.";
    root.prepend(notice);
  }

  document.addEventListener("click", async (event) => {
    const target = event.target.closest?.("[data-expert-apply]");
    if (target) {
      event.preventDefault();
      const candidateId = target.dataset.expertApply;
      if (!candidateId || applyingCandidates.has(candidateId)) return;
      applyingCandidates.add(candidateId);
      target.disabled = true;
      clearPreparedPackage(candidateId);
      setBridgeStatus("Comprobando el expediente y sus puertas antes de preparar…", "warning");
      try {
        const currentPackage = await loadPackage(candidateId, true);
        if (!packageCanApply(currentPackage, candidateId)) {
          const failure = packageFailure(currentPackage);
          throw localTypedError(failure.code, failure.message);
        }
        const currentRevision = preparationRevisionFrom(currentPackage);
        if (!currentRevision || !packageMatchesPreparation(currentPackage, currentRevision)) {
          throw localTypedError(
            "MARKET_EXPERT_ANALYSIS_STALE",
            "El expediente no corresponde a la revisión vigente. Analiza de nuevo antes de preparar."
          );
        }
        const issueFlow = currentPackage?.gate?.status === "proposal_ready_with_issues"
          || (Array.isArray(currentPackage?.gate?.workflow_issues)
            && currentPackage.gate.workflow_issues.length > 0);
        const workflowIssueCodes = new Set(
          (Array.isArray(currentPackage?.gate?.workflow_issues)
            ? currentPackage.gate.workflow_issues : [])
            .map((issue) => String(issue?.issue_code || "").trim()),
        );
        const eligibilityRecoveryFlow = issueFlow
          && ["RADAR_ELIGIBILITY_REQUIRED", "ELIGIBILITY_EXPIRED"]
            .some((code) => workflowIssueCodes.has(code));
        let preparationRevision = currentRevision;
        let pkg = currentPackage;
        const bridge = window.atinaraMarketAdminBridge;
        if (!issueFlow || eligibilityRecoveryFlow) {
          if (typeof bridge?.prepareRadarCandidate !== "function" || typeof bridge?.refreshRadarExpertAnalysis !== "function") {
            throw localTypedError("RADAR_PREPARATION_UNAVAILABLE", "La preparación segura del Radar no está disponible. Recarga la página antes de continuar.");
          }
          let recoveryFailedSafely = false;
          try {
            setBridgeStatus(eligibilityRecoveryFlow
              ? "Renovando la elegibilidad antes de aplicar la propuesta…"
              : "Expediente apto. Radar está reservando una revisión privada…", "warning");
            const preparation = await bridge.prepareRadarCandidate(candidateId, { throwOnError: true });
            preparationRevision = preparationRevisionFrom(preparation);
            if (!preparationRevision) {
              throw new Error("Radar no devolvió una revisión de preparación válida. La propuesta no se ha aplicado.");
            }
            invalidatePackage(candidateId);
            setBridgeStatus("Radar preparado. Actualizando el dictamen para la revisión reservada…", "warning");
            await bridge.refreshRadarExpertAnalysis(candidateId, { force: false, preparationRevision });
            invalidatePackage(candidateId);
            setBridgeStatus("Análisis actualizado. Cargando el expediente exacto de esta preparación…", "warning");
            pkg = await loadPackage(candidateId, true);
          } catch (recoveryError) {
            if (!eligibilityRecoveryFlow || recoveryError?.retryable !== true
              || typeof bridge?.openPrivateIssueDraftForm !== "function") throw recoveryError;
            recoveryFailedSafely = true;
            setBridgeStatus("La elegibilidad no pudo renovarse por una incidencia técnica. La propuesta privada conserva la incidencia y no recibe autoridad.", "warning");
            bridge.openPrivateIssueDraftForm(candidateId,currentPackage,currentRevision);
          }
          if (recoveryFailedSafely) pkg = currentPackage;
        } else {
          if (typeof bridge?.openPrivateIssueDraftForm !== "function") {
            throw localTypedError("RADAR_PREPARATION_UNAVAILABLE", "El formulario privado recuperable no está disponible. Recarga la página.");
          }
          setBridgeStatus("Aplicando la propuesta privada con sus incidencias; no se concede ninguna autoridad.", "warning");
          bridge.openPrivateIssueDraftForm(candidateId,pkg,preparationRevision);
        }
        if (pkg?.origin?.type !== "radar_candidate" || pkg?.origin?.id !== candidateId) {
          throw new Error("El expediente experto no pertenece a la candidata preparada. La propuesta no se ha aplicado.");
        }
        if (!packageMatchesPreparation(pkg, preparationRevision)) {
          throw new Error("El expediente experto no corresponde a la revisión actual de Radar. Vuelve a aplicar la propuesta.");
        }
        if (!packageCanApply(pkg, candidateId)) {
          throw new Error("La propuesta no puede avanzar porque existe una condición terminal.");
        }
        const form = await waitForForm();
        rememberPreparedPackage(candidateId, preparationRevision, pkg);
        applyPackageToForm(form, pkg, preparationRevision);
        setBridgeStatus("", "success");
      } catch (error) {
        clearPreparedPackage(candidateId);
        const code = typedCode(error?.code, "MARKET_EXPERT_APPLY_BLOCKED");
        setBridgeStatus(`${code} · ${error?.message || reasonLabels[code] || "No se pudo aplicar la propuesta."}`, "error");
      } finally {
        applyingCandidates.delete(candidateId);
        target.disabled = false;
        const currentTarget = document.querySelector(`[data-expert-apply="${CSS.escape(candidateId)}"]`);
        if (currentTarget) currentTarget.disabled = false;
        scheduleScan();
      }
      return;
    }

    const analyzeButton = event.target.closest?.("[data-radar-expert]");
    if (analyzeButton) {
      const candidateId = analyzeButton.dataset.radarExpert;
      if (analysisAttempts.get(candidateId)?.status === "processing") {
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      analysisAttempts.set(candidateId, { status: "processing", startedAt: Date.now() });
      invalidatePackage(candidateId);
      setBridgeStatus("El Agente Editor ha iniciado el análisis. No se guardará ningún borrador hasta que exista un dictamen autoritativo.", "warning");
      scheduleScan(true);
    }
  }, true);

  document.addEventListener("atinara:radar-preparation-complete", (event) => {
    const candidateId = event.detail?.candidateId;
    if (candidateId) invalidatePackage(candidateId);
  });

  document.addEventListener("atinara:radar-expert-analysis-complete", (event) => {
    const candidateId = event.detail?.candidateId;
    if (!candidateId) return;
    analysisAttempts.delete(candidateId);
    invalidatePackage(candidateId);
    setBridgeStatus("Dictamen experto persistido. Ya puede revisarse el expediente exacto de esta candidata.", "success");
    scheduleScan(true);
  });

  document.addEventListener("atinara:radar-expert-analysis-failed", (event) => {
    const candidateId = event.detail?.candidateId;
    if (!candidateId) return;
    const failure = normalizeAnalysisFailure(event.detail?.failure);
    analysisAttempts.set(candidateId, { status: "failed", failure });
    invalidatePackage(candidateId);
    setBridgeStatus(`${failure.code} · ${failure.message}`, "error");
    scheduleScan(true);
  });

  document.addEventListener("submit", (event) => {
    const form = event.target.closest?.("#admin-market-form");
    if (!form || form.dataset.atinaraExpertBridge !== "true" || form.dataset.draftId) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (form.dataset.expertSaving === "true") return;
    const candidateId = String(form.dataset.expertCandidateId || "").trim();
    const preparationRevision = String(form.dataset.preparationRevision || "").trim();
    const prepared = readPreparedPackage(candidateId);
    const pkg = prepared?.package;
    const validBinding = Boolean(
      candidateId
      && preparationRevision
      && prepared?.candidate_id === candidateId
      && prepared?.preparation_revision === preparationRevision
      && pkg?.origin?.type === "radar_candidate"
      && pkg?.origin?.id === candidateId
      && packageMatchesPreparation(pkg, preparationRevision)
      && pkg?.run?.id
      && String(pkg.run.id) === String(form.dataset.expertRunId || "")
      && (pkg?.gate?.can_prefill === true
        || pkg?.gate?.can_materialize_private_repair_draft === true)
      && (pkg?.gate?.can_save_private_draft === true
        || pkg?.gate?.can_materialize_private_repair_draft === true)
    );
    if (!validBinding) {
      clearPreparedPackage(candidateId);
      const status = statusElement(form);
      status.dataset.tone = "error";
      status.textContent = "La candidata o su revisión de preparación ya no coinciden con el expediente experto. Vuelve a aplicar la propuesta antes de guardar.";
      return;
    }
    form.dataset.expertSaving = "true";
    saveAtomicExpertDraft(form, pkg);
  }, true);

  const observer = new MutationObserver(() => scheduleScan());
  observer.observe(root, { childList: true, subtree: true });
  scheduleScan();
})();
