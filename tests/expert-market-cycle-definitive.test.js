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
const repairSource = read("supabase/functions/_shared/market-draft-repair.mjs");
const migration = read("supabase/migrations/20260809204739_close_expert_market_cycle_v2.sql");
const hardeningMigration = read("supabase/migrations/20260811100833_harden_repair_evidence_and_idempotency_v3.sql");
const radarIsolationMigration = read("supabase/migrations/20260811104727_isolate_radar_poison_records_v4.sql");
const adminHtml = read("admin-markets.html");
const adminJs = read("admin-markets.js");
const fixerClient = read("market-draft-fixer.js");

let repair;
before(async () => {
  repair = await import(pathToFileURL(join(root, "supabase/functions/_shared/market-draft-repair.mjs")).href);
});

test("Radar · cinco descartes de contenido conservan proveedor disponible", () => {
  assert.match(radarEdge, /classification:\s*"quality"/);
  assert.match(radarEdge, /degrades_provider:\s*false/);
  assert.match(radarEdge, /finalizeProviderRefresh\(environment, provider, cacheKey, "available", persistedCount/);
  assert.match(radarEdge, /discarded:\s*outcome\.quarantined\.length/);
  assert.match(radarEdge, /quality_notices:\s*qualityNotices/);
  assert.match(adminJs, /Disponible con descartes/);
  assert.match(adminJs, /qualityNotices/);
});

test("Radar · 429 respeta Retry-After, abre circuito y preserva last-known-good", () => {
  assert.match(radarEdge, /retryAfterMilliseconds/);
  assert.match(radarEdge, /GEMINI_MODEL = "gemini-3\.1-flash-lite"/);
  assert.match(radarEdge, /responseMimeType: "application\/json"/);
  assert.match(radarEdge, /responseJsonSchema: geminiResponseJsonSchema/);
  assert.match(radarEdge, /geminiProviderSchemaSupported/);
  assert.match(radarEdge, /error\.status !== 400/);
  assert.match(radarEdge, /providerPayload = await send\(false\)/);
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
  assert.match(radarEdge, /upsert_market_radar_batch_with_fact_checks_v2/);
  assert.match(radarEdge, /acceptedCount \+ quarantined\.length !== entries\.length/);
  assert.match(radarEdge, /outcome\.persistedCount \+= batchResult\.acceptedCount/);
  assert.match(radarEdge, /outcome\.quarantined\.push\(\.\.\.batchResult\.quarantined\)/);
  assert.match(radarEdge, /if \(entries\.length > 1\)/);
  assert.match(radarEdge, /entries\.slice\(0, middle\)/);
  assert.match(radarEdge, /entries\.slice\(middle\)/);
  assert.match(radarEdge, /outcome\.quarantined\.push\(quarantine\)/);
  assert.match(radarIsolationMigration, /database_subtransaction_v1/);
  assert.match(radarIsolationMigration, /exception when others/);
  assert.match(radarIsolationMigration, /market_radar_candidate_quarantines/);
  assert.match(radarIsolationMigration, /list_market_radar_candidate_quarantines_v1/);
  assert.match(adminJs, /Causas consultables/);
  assert.match(adminJs, /RADAR_QUARANTINE_DESCRIPTIONS/);
});

test("Editor · muestra causas raíz, separa diagnósticos derivados y ofrece recuperación", () => {
  assert.match(editorEdge, /DERIVED_REASON_CODES/);
  assert.match(editorEdge, /TERMINAL_REASON_CODES/);
  assert.match(editorEdge, /causal_roots:\s*hardBlocks/);
  assert.match(editorEdge, /derived_diagnostics:\s*derivedDiagnostics/);
  assert.match(editorEdge, /automatic_recovery/);
  assert.match(adminHtml, /Atinara ha detenido esta transición de forma segura/);
  assert.match(adminHtml, /Referencia \$\{escapeHtml\(code\)\}/);
  assert.match(adminJs, /recoverRadarExpertCandidate/);
});

test("Editor · candidata abierta pero incompleta puede materializar un borrador privado reparable", () => {
  assert.match(editorEdge, /can_materialize_private_repair_draft:\s*canMaterializePrivateRepairDraft/);
  assert.match(adminHtml, /materialize_market_draft_for_repair_v1/);
  assert.match(migration, /create or replace function public\.materialize_market_draft_for_repair_v1/);
  assert.match(migration, /MARKET_EXPERT_REPAIR_DRAFT_BLOCKED/);
  assert.match(migration, /materialization_mode', 'private_repair_v1'/);
  assert.match(migration, /'publishes', false/);
  assert.match(migration, /'confirms', false/);
});

test("Editor · un bloqueo terminal nunca habilita materialización ni publicación", () => {
  assert.match(editorEdge, /const terminalRoots = rawHardBlocks\.filter/);
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
  assert.match(adminHtml, /_timestamp_precision = "milliseconds-v1"/);
  assert.match(migration, /expected_fingerprint/);
});

test("Validador · UTC y la hora local IANA equivalente no forman una incoherencia", () => {
  assert.match(validatorEdge, /representationOnlyTemporalIssue/);
  assert.match(validatorEdge, /safelyDismissedReviewIssue/);
  assert.match(validatorEdge, /everyIssueSafelyDismissed/);
  assert.match(validatorEdge, /normalizedResult = "approved"/);
  assert.match(validatorEdge, /if \(!everyIssueSafelyDismissed\) return null/);
  assert.match(validatorEdge, /Compara instantes, no representaciones/);
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
  assert.match(validatorEdge, /no contradigas esa atestación ni inventes una consulta externa/);
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
  assert.match(validatorEdge, /safeProviderErrorDetails/);
  assert.match(validatorEdge, /provider_error_status/);
  assert.match(validatorEdge, /provider_error_reason/);
  assert.match(validatorEdge, /GEMINI_MODEL = "gemini-3\.1-flash-lite"/);
  assert.match(validatorEdge, /responseMimeType: "application\/json"/);
  assert.match(validatorEdge, /responseJsonSchema/);
  assert.match(validatorEdge, /schemaFallback/);
  assert.match(validatorEdge, /generate-content-json-mode-app-schema-v1/);
  assert.match(validatorEdge, /response\.status === 400/);
  assert.match(validatorEdge, /diagnoseInvalidReview/);
  assert.match(validatorEdge, /invalid_response_diagnostics/);
  assert.match(validatorEdge, /Array\.isArray\(parsed\.editorial_notes\) \? parsed\.editorial_notes : \[\]/);
  assert.match(validatorEdge, /enum: \["approved", "rejected"\]/);
  assert.match(validatorEdge, /Un rejected exige al menos una incidencia concreta/);
  assert.match(validatorEdge, /result === "rejected" && issues\.length === 0/);
  assert.doesNotMatch(validatorEdge, /enum: \["approved", "rejected", "inconclusive"\]/);
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
