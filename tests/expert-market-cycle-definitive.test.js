const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { pathToFileURL } = require("node:url");
const { before, test } = require("node:test");

const root = join(__dirname, "..");
const read = (path) => readFileSync(join(root, path), "utf8");
const radarEdge = read("supabase/functions/market-radar/index.ts");
const editorEdge = read("supabase/functions/market-expert/index.ts");
const fixerEdge = read("supabase/functions/market-draft-fixer/index.ts");
const validatorEdge = read("supabase/functions/validate-market-draft/index.ts");
const aiTaskPolicy = read("supabase/functions/_shared/ai/task-policy.mjs");
const geminiLegacyAdapter = read("supabase/functions/_shared/ai/providers/gemini-legacy.mjs");
const aiOutputValidation = read("supabase/functions/_shared/ai/task-output-validation.mjs");
const repairSource = read("supabase/functions/_shared/market-draft-repair.mjs");
const migration = read("supabase/migrations/20260809204739_close_expert_market_cycle_v2.sql");
const hardeningMigration = read("supabase/migrations/20260811100833_harden_repair_evidence_and_idempotency_v3.sql");
const radarIsolationMigration = read("supabase/migrations/20260811104727_isolate_radar_poison_records_v4.sql");
const parentReconciliationMigration = read("supabase/migrations/20260822205445_add_radar_parent_reconciliation_v1.sql");
const adminHtml = read("admin-markets.html");
const adminAgentBridge = read("admin-agent-engine.js");
const adminJs = read("admin-markets.js");
const fixerClient = read("market-draft-fixer.js");

let repair;
before(async () => {
  repair = await import(pathToFileURL(join(root, "supabase/functions/_shared/market-draft-repair.mjs")).href);
});

test("Radar · cinco descartes de contenido conservan proveedor disponible", () => {
  assert.match(radarEdge, /classification:\s*"quality"/);
  assert.match(radarEdge, /degrades_provider:\s*false/);
  assert.match(radarEdge, /const providerCandidateCount = Math\.max\(persistedCount, successfulProviderCandidateCount\)/);
  assert.match(radarEdge, /finalizeProviderRefresh\(environment, provider, cacheKey, "available", providerCandidateCount/);
  assert.match(radarEdge, /discarded:\s*outcome\.quarantined\.length/);
  assert.match(radarEdge, /quality_notices:\s*qualityNotices/);
  assert.match(adminJs, /Disponible con descartes/);
  assert.match(adminJs, /qualityNotices/);
});

test("Radar · 429 respeta Retry-After, abre circuito y preserva last-known-good", () => {
  assert.match(radarEdge, /retryAfterMilliseconds/);
  assert.doesNotMatch(radarEdge, /GEMINI_MODEL|GEMINI_API_KEY|generativelanguage\.googleapis\.com|:generateContent/);
  assert.match(aiTaskPolicy, /radar_candidate_enrichment:[\s\S]*?legacyRouteId: "gemini\.legacy\.radar"/);
  assert.match(geminiLegacyAdapter, /schemaFallback/);
  assert.match(radarEdge, /retry_after_seconds/);
  assert.match(radarEdge, /activeProviderCircuit/);
  assert.match(radarEdge, /last_known_good_count/);
  assert.match(radarEdge, /state_preserved:\s*true/);
  assert.match(migration, /last_success_count/);
  assert.match(migration, /retry_after_at/);
  assert.match(migration, /circuit_state/);
  assert.match(migration, /status_input = 'rate_limited'/);
  assert.match(adminJs, /Degradado temporalmente/);
});

test("Radar · un registro venenoso se aísla dentro de una sola RPC sin perder filas sanas", () => {
  assert.match(radarEdge, /complete_market_radar_candidate_refresh_v1/);
  assert.doesNotMatch(radarEdge, /rpc\(environment, "upsert_market_radar_batch_with_(?:fact_checks|eligibility)/);
  assert.match(parentReconciliationMigration, /public\.process_market_radar_refresh_batch_v1/);
  assert.match(parentReconciliationMigration, /market_radar_candidate_quarantines/);
  assert.match(radarIsolationMigration, /exception when others/);
  assert.match(parentReconciliationMigration, /RADAR_CANDIDATE_RECONCILIATION_BINDING_INCOMPLETE/);
  assert.match(radarIsolationMigration, /database_subtransaction_v1/);
  assert.match(radarIsolationMigration, /exception when others/);
  assert.match(radarIsolationMigration, /market_radar_candidate_quarantines/);
  assert.match(radarIsolationMigration, /list_market_radar_candidate_quarantines_v1/);
  assert.match(adminJs, /Causas consultables/);
  assert.match(adminJs, /RADAR_QUARANTINE_DESCRIPTIONS/);
});

test("un issue-draft conserva el guard live y nunca se considera duplicado de sí mismo", () => {
  assert.match(parentReconciliationMigration,
    /intelligence_origin_type='radar_candidate'[\s\S]*?intelligence_origin_id=candidate_input\.id::text/);
  assert.match(parentReconciliationMigration,
    /RADAR_LEGACY_PREPARED_DRAFT_REQUIRED[\s\S]*?assert_market_radar_candidate_no_live_duplicate_v1\(candidate\)[\s\S]*?child_identity_issue_present/);
  assert.match(parentReconciliationMigration,
    /assert_market_radar_candidate_no_live_duplicate_v1[\s\S]*?pg_advisory_xact_lock[\s\S]*?RADAR_CONFIRMED_DUPLICATE/);
});

test("refresh y revalidación protegen el draft ligado sin loops de identidad o disponibilidad", () => {
  assert.match(parentReconciliationMigration,
    /get_market_radar_protected_candidate_identities_v1[\s\S]*?intelligence_origin_type='radar_candidate'/);
  assert.match(parentReconciliationMigration,
    /rebind_market_radar_protected_candidates_v1[\s\S]*?identity_changed[\s\S]*?CHILD_IDENTITY_MISMATCH/);
  assert.match(parentReconciliationMigration,
    /clear_market_radar_live_duplicate_v1[\s\S]*?live_duplicate_no_longer_present/);
  assert.match(parentReconciliationMigration,
    /sync_market_radar_revalidation_issues_v1[\s\S]*?provider_revalidation_recovered/);
  assert.match(parentReconciliationMigration,/current_canonical_child_key/);
  assert.match(parentReconciliationMigration,/current_parent_child_fingerprint/);
  assert.equal((radarEdge.match(/get_market_radar_candidate_for_draft_revalidation_v3/g)||[]).length,2);
  assert.doesNotMatch(radarEdge,/get_market_radar_candidate_for_draft_revalidation_v2/);
  assert.match(parentReconciliationMigration,
    /binding_status'<>'pending_recovery'[\s\S]*?has_active_radar_draft/);
  assert.match(radarEdge,/\["prepared","rejected"\]\.includes\(cleanText\(candidate\.state, 40\)\)/);
});

test("Validator hace preflight Radar durable y cero inferencia antes del attempt", () => {
  assert.match(validatorEdge,/begin_market_draft_review_v3/);
  assert.doesNotMatch(validatorEdge,/begin_market_draft_review_v2/);
  assert.match(parentReconciliationMigration,
    /begin_market_draft_review_v3[\s\S]*?assert_market_radar_draft_eligibility_v1[\s\S]*?zero_inference/);
  assert.match(validatorEdge,
    /beginStatus === "radar_revalidation_required"[\s\S]*?zero_inference:true/);
  assert.match(parentReconciliationMigration,
    /publication_issue_pre_parent_reconciliation_v1[\s\S]*?RADAR_PARENT_RECONCILIATION_INCOMPLETE/);
});

test("issues Radar conservan identidad determinista y no mueven revisión por timestamps", () => {
  assert.match(radarEdge,/deterministicRadarIssueId/);
  assert.match(parentReconciliationMigration,/market_workflow_issue_deterministic_v1/);
  assert.match(parentReconciliationMigration,
    /market_candidate_preparation_projection[\s\S]*?workflow_issues[\s\S]*?-'issue_id'-'created_at'-'updated_at'/);
});

test("Editor · muestra la causa raíz sin cascada ni recuperación factual", () => {
  assert.match(editorEdge, /DERIVED_REASON_CODES/);
  assert.match(editorEdge, /TERMINAL_REASON_CODES/);
  assert.match(editorEdge, /causal_roots:\s*hardBlocks/);
  assert.match(editorEdge, /derived_diagnostics:\s*derivedDiagnostics/);
  assert.match(editorEdge, /automatic_recovery/);
  assert.match(adminAgentBridge, /Atinara ha detenido esta transición de forma segura/);
  assert.match(adminAgentBridge, /Referencia \$\{escapeHtml\(code\)\}/);
  assert.doesNotMatch(adminJs, /recoverRadarExpertCandidate/);
  assert.match(adminJs, /ensureRadarDraftEligibility/);
});

test("Editor · candidata abierta pero incompleta puede materializar un borrador privado reparable", () => {
  assert.match(editorEdge, /can_materialize_private_repair_draft:\s*canMaterializePrivateRepairDraft/);
  assert.match(adminAgentBridge, /materialize_market_draft_for_repair_v1/);
  assert.match(migration, /create or replace function public\.materialize_market_draft_for_repair_v1/);
  assert.match(migration, /MARKET_EXPERT_REPAIR_DRAFT_BLOCKED/);
  assert.match(migration, /materialization_mode', 'private_repair_v1'/);
  assert.match(migration, /'publishes', false/);
  assert.match(migration, /'confirms', false/);
});

test("Editor · un bloqueo terminal nunca habilita materialización ni publicación", () => {
  assert.match(editorEdge, /const terminalRoots = uniqueStrings\(\[/);
  assert.match(editorEdge, /blocking_scope, 40\) === "terminal"/);
  assert.match(editorEdge, /let hardBlocks = terminalRoots\.length \? terminalRoots/);
  assert.match(editorEdge, /can_publish:\s*false/);
  assert.match(migration, /can_materialize_private_repair_draft/);
  assert.match(migration, /MARKET_EXPERT_REPAIR_DRAFT_BLOCKED/);
});

test("Marvel · el plazo se deriva por política general sin alterar > 95", () => {
  const evaluation = "2026-08-13T14:00:00.000Z";
  assert.deepEqual(repair.RESOLUTION_DEADLINE_POLICY, {
    version: "atinara-resolution-deadline-policy-v1",
    source_availability_delay_seconds: 300,
    human_review_margin_seconds: 86_400,
    maximum_margin_seconds: 604_800,
  });
  assert.equal(
    repair.deriveResolutionDeadline(evaluation, [evaluation]),
    "2026-08-14T14:05:00.000Z",
  );
  const metric = repair.inferMetricContract({
    draft: {
      question: "¿Marvel Tokon: Fighting Souls tendrá una puntuación en Metacritic superior a 95 siete días después de su lanzamiento?",
      yes_criteria: "Sí si el Metascore es superior a 95.",
    },
    radar_candidate: {
      family_semantics: { threshold: { operator: "gt", value: "95", unit: "points" } },
    },
  });
  assert.equal(metric.operator, ">");
  assert.equal(metric.threshold, 95);
  assert.equal(metric.scale_max, 100);
  assert.equal(metric.aggregation, "maximum");
  assert.match(metric.platform_policy, /página canónica del mismo producto y edición objeto de la pregunta/i);
  assert.match(metric.platform_policy, /máximo numérico/i);
  assert.match(metric.platform_policy, /no existe jerarquía entre plataformas/i);
  assert.match(metric.platform_policy, /ediciones con una página canónica distinta/i);
  assert.deepEqual(repair.METRIC_OBSERVATION_POLICY, {
    version: "atinara-metric-observation-policy-v1",
    capture_window_seconds: 300,
  });
  assert.equal(metric.observation_policy_version, "atinara-metric-observation-policy-v1");
  assert.equal(metric.capture_window_seconds, 300);
  assert.match(metric.observation_policy, /una única sesión de captura/i);
  assert.match(metric.observation_policy, /primera respuesta válida/i);
  assert.match(metric.observation_policy, /no se mezclan respuestas/i);
  assert.match(metric.observation_policy, /revisión humana específica/i);
});

test("Corrector · el texto contractual no declara dos zonas para un mismo instante", () => {
  assert.match(repairSource, /return `\$\{local\} \(\$\{timezone\}\)`/);
  assert.doesNotMatch(repairSource, /\$\{timezone\}; \$\{utc\} UTC/);
  assert.match(repairSource, /La fecha-ancla queda fijada por la evidencia oficial fechada/);
  assert.match(repairSource, /Un conflicto material previo a la confirmación invalida la revisión/);
});

test("Temporal · UTC, Europe/Madrid, milisegundos y segundo 59 sobreviven al contrato", () => {
  const evaluation = "2026-10-25T22:59:59.987Z";
  const existing = "2026-10-26T23:59:59.987+01:00";
  assert.equal(
    repair.deriveResolutionDeadline(evaluation, [existing]),
    "2026-10-26T22:59:59.987Z",
  );
  assert.match(adminAgentBridge, /_timestamp_precision = "milliseconds-v1"/);
  assert.match(migration, /expected_fingerprint/);
});

test("Validador · UTC y la hora local IANA equivalente no forman una incoherencia", () => {
  assert.match(validatorEdge, /representationOnlyTemporalIssue/);
  assert.match(validatorEdge, /safelyDismissedReviewIssue/);
  assert.match(validatorEdge, /everyIssueSafelyDismissed/);
  assert.match(validatorEdge, /normalizedResult = "approved"/);
  assert.match(validatorEdge, /if \(!everyIssueSafelyDismissed\) return null/);
  assert.match(aiTaskPolicy, /Compara instantes, no representaciones/);
  assert.match(validatorEdge, /contractText\.includes\(localTime\)/);
  assert.match(validatorEdge, /contractText\.includes\(normalizedEvidenceText\(timezone\)\)/);
  assert.match(validatorEdge, /new Set\(\["evaluation_ends_at", "timezone"\]\)/);
});

test("Validador · una opinión del modelo no invalida una fuente primaria atestada en servidor", () => {
  assert.match(validatorEdge, /get_market_draft_primary_source_attestation_v1/);
  assert.match(validatorEdge, /hasCurrentPrimarySourceAttestation\(draft\)/);
  assert.match(validatorEdge, /attestedPrimarySourceRefutesIssue\(issue, draft\)/);
  assert.match(validatorEdge, /INSUFFICIENT_EVIDENCE/);
  assert.match(validatorEdge, /_primary_source_attestation/);
  assert.match(aiTaskPolicy, /no contradigas esa atestaci.n ni inventes una consulta externa/);
  assert.match(hardeningMigration, /source_check\.draft_version = draft_row\.content_version/);
  assert.match(hardeningMigration, /source_check\.expires_at > clock_timestamp\(\)/);
  assert.match(hardeningMigration, /private\.market_primary_registry_row_matches_v1/);
  assert.match(hardeningMigration, /to service_role/);
  assert.doesNotMatch(hardeningMigration, /grant execute on function public\.get_market_draft_primary_source_attestation_v1[\s\S]{0,160}to authenticated/);
});

test("Corrector · revisión determinista v3 es compatible e intentos son idempotentes", () => {
  assert.match(migration, /review_validator_value in \('atinara-market-gate-v3', 'step13\.4-deterministic-v3'\)/);
  assert.match(migration, /unique \(actor_id, draft_id, request_key\)/);
  assert.match(migration, /response_payload is null/);
  assert.match(migration, /idempotency_replay', not completed_now/);
  assert.match(hardeningMigration, /response_payload is not null/);
  assert.match(hardeningMigration, /La identidad de la peticion se resuelve antes de consultar la version/);
  assert.match(hardeningMigration, /IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD/);
  assert.match(fixerEdge, /deterministicRequestUuid\(workflowRequestKey/);
  assert.match(fixerEdge, /const temporalAnchorSource = safePublicUrl\(temporalContract\?\.source_url\)/);
  assert.match(fixerEdge, /isTemporalAnchor \? "CONTEXT_SOURCE"/);
  assert.match(fixerEdge, /Fuente oficial requerida exclusivamente para fijar la fecha-ancla/);
  assert.match(fixerEdge, /resolutionSources\(context, repaired, isRecord\(deterministic\.temporal_contract\)/);
  assert.match(fixerEdge, /get_market_draft_bound_context_attestation_v1/);
  assert.match(fixerEdge, /La comprobacion autoritativa tambien se registra en rondas no-op/);
  assert.match(fixerEdge, /la misma lectura fresca a la nueva version/);
  assert.match(repairSource, /bound_context_source/);
  assert.match(repairSource, /bound_context_attestation/);
  assert.match(repairSource, /role: "CONTEXT_SOURCE"/);
  assert.match(hardeningMigration, /current_binding\.supersedes_binding_id/);
  assert.match(hardeningMigration, /previous_version\.canonical_payload -> 'alternative_sources'/);
  assert.match(hardeningMigration, /BOUND_CONTEXT_HISTORY_CHANGED/);
  assert.match(fixerClient, /sessionStorage/);
  assert.match(fixerClient, /attempt_id:\s*attemptId/);
});

test("Corrector · fallo técnico preserva revisión, versión y estado autoritativos", () => {
  assert.match(fixerEdge, /state_preserved:\s*true/);
  assert.match(fixerEdge, /previous_version:\s*expectedVersion/);
  assert.match(fixerEdge, /new_version:\s*expectedVersion/);
  assert.match(migration, /Intentos tecnicos del Corrector separados de revisiones efectivas/);
  assert.match(validatorEdge, /retry_after_seconds/);
  assert.match(validatorEdge, /AI_TASK_CONTRACTS\.market_draft_validation/);
  assert.doesNotMatch(validatorEdge, /GEMINI_MODEL|generativelanguage\.googleapis\.com|x-goog-api-key/);
  assert.match(aiTaskPolicy, /gemini\.legacy\.validator/);
  assert.match(aiTaskPolicy, /responseMimeType: "application\/json"/);
  assert.match(aiTaskPolicy, /responseJsonSchema/);
  assert.match(geminiLegacyAdapter, /schemaFallback/);
  assert.match(geminiLegacyAdapter, /spec\.schemaFallbackBody/);
  assert.match(geminiLegacyAdapter, /ai\.details\.httpStatus === 400/);
  assert.match(validatorEdge, /Array\.isArray\(parsed\.editorial_notes\) \? parsed\.editorial_notes : \[\]/);
  assert.match(aiTaskPolicy, /enum: \["approved", "rejected"\]/);
  assert.match(aiTaskPolicy, /Un rejected exige al menos una incidencia concreta/);
  assert.match(aiOutputValidation, /value\.result === "rejected" && value\.issues\.length === 0/);
  assert.doesNotMatch(aiTaskPolicy, /enum: \["approved", "rejected", "inconclusive"\]/);
  assert.match(validatorEdge, /state_preserved:\s*true/);
});

test("Seguridad y publicación · JWT, admin, RLS y confirmación humana siguen obligatorios", () => {
  for (const edge of [radarEdge, editorEdge, fixerEdge]) {
    assert.match(edge, /authenticateAdmin/);
  }
  assert.match(validatorEdge, /authenticateDraftAdmin/);
  assert.match(migration, /force row level security/);
  assert.match(migration, /revoke all on table private\.market_repair_attempts/);
  assert.match(adminJs, /workflow_status === "human_confirmed"/);
  assert.match(adminJs, /confirm_market_draft_review/);
  assert.match(adminJs, /publish_market_draft/);
  assert.match(fixerEdge, /publishes:\s*false/);
  assert.doesNotMatch(`${radarEdge}\n${editorEdge}\n${fixerEdge}\n${validatorEdge}`, /service_role\s*[:=]\s*["'][A-Za-z0-9._-]{20,}/i);
});
