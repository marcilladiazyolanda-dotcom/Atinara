const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { test } = require("node:test");

const root = join(__dirname, "..");
const migration = readFileSync(join(
  root,
  "supabase/migrations/20260808194234_fix_market_draft_human_confirmation_flow.sql"
), "utf8");
const auditIndexMigration = readFileSync(join(
  root,
  "supabase/migrations/20260808195500_add_market_admin_audit_provenance_index.sql"
), "utf8");
const adminUi = readFileSync(join(root, "admin-markets.js"), "utf8");
const adminHtml = readFileSync(join(root, "admin-markets.html"), "utf8");
const helpers = require("../market-admin-validation.js");

test("la puerta acepta procedencia experta o manual determinista sin excepciones por mercado", () => {
  assert.match(migration, /completed_expert_run/);
  assert.match(migration, /deterministic_manual_plan/);
  assert.match(migration, /run_row\.status = 'completed'/);
  assert.match(migration, /capture_strategy[\s\S]+manual_official_source/);
  assert.match(migration, /evidence_mode[\s\S]+human_review_of_official_source/);
  assert.match(migration, /SOURCE_BINDING_CREATED_BY_AUTONOMOUS_REPAIR/);
  assert.match(migration, /SOURCE_BINDING_VERSIONED_WITH_DRAFT/);
  assert.doesNotMatch(migration, /atinara-draft-repair-v3/);
  assert.doesNotMatch(migration, /PlayStation|Grand Theft Auto|PS6|GTA/i);
});

test("una procedencia desconocida, un contrato cambiado o fuentes divergentes fallan cerrados", () => {
  assert.match(migration, /SOURCE_BINDING_PROVENANCE_REQUIRED/);
  assert.match(migration, /SOURCE_BINDING_CONTRACT_CHANGED/);
  assert.match(migration, /SOURCE_BINDING_VALIDATION_REQUIRED/);
  assert.match(migration, /contract_sources is distinct from stored_sources/);
  assert.match(migration, /DETERMINISTIC_PLAN_SOURCE_ASSIGNMENTS_CHANGED/);
  assert.match(migration, /private\.market_intelligence_hash\(binding_row\.resolution_contract\)/);
  assert.match(migration, /revoke all on function private\.market_source_binding_provenance/);
  assert.match(auditIndexMigration, /market_admin_audit_draft_action_created_idx/);
  assert.match(auditIndexMigration, /\(draft_id, action_code, created_at desc\)/);
});

test("los mensajes estructurados nunca se convierten en object Object", () => {
  const message = helpers.formatStructuredText({
    code: "SOURCE_REQUIRED",
    message: { text: "Falta una fuente oficial", detail: "Añádela antes de continuar" }
  });
  assert.match(message, /Falta una fuente oficial/);
  assert.match(message, /Añádela antes de continuar/);
  assert.match(message, /SOURCE_REQUIRED/);
  assert.doesNotMatch(message, /\[object Object\]/);

  const circular = { message: "Error recuperable" };
  circular.self = circular;
  assert.equal(helpers.formatStructuredText(circular), "Error recuperable");
  assert.equal(helpers.formatStructuredText(null, { detail: "Fallback estructurado" }), "Fallback estructurado");
  assert.doesNotMatch(helpers.getStatusLabel({ label: "Estado legible" }), /\[object Object\]/);
  assert.match(adminUi, /typeof issue\.message !== "object"[\s\S]+escapeHtml\(issue\.message\)/);
  assert.match(adminUi, /helpers\.formatStructuredText\(issue\?\.message \?\? issue/);
});

test("confirmar muestra estado junto al botón y exige comprobar la persistencia autoritativa", () => {
  assert.match(adminUi, /data-review-action-status/);
  assert.match(adminUi, /focusActionStatus\(\)/);
  assert.match(adminUi, /confirmationMatchesDraft/);
  assert.match(adminUi, /confirmationResponseMatches/);
  assert.match(adminUi, /CONFIRMATION_NOT_PERSISTED/);
  assert.match(adminUi, /La respuesta de red se perdió, pero Supabase confirma/);
  assert.match(adminUi, /if \(!draft \|\| state\.busy\) return/);
});

test("revisión, confirmación y publicación informan también los fallos dentro de la puerta", () => {
  const gateUpdates = adminUi.match(/setGateNotice\(/g) || [];
  assert.ok(gateUpdates.length >= 10, "las tres acciones deben actualizar el estado inline");
  assert.match(adminUi, /PUBLICATION_NOT_PERSISTED/);
  assert.match(adminUi, /authoritativeStatus/);
  assert.match(adminUi, /finishedDespiteResponseLoss/);
});

test("los errores de procedencia tienen explicación humana y el navegador recibe los scripts nuevos", () => {
  const provenanceError = helpers.getFriendlyError({ message: "SOURCE_BINDING_PROVENANCE_REQUIRED" });
  const expertError = helpers.getFriendlyError({ details: { code: "MARKET_EXPERT_ANALYSIS_REQUIRED" } });
  assert.match(provenanceError, /procedencia verificable/);
  assert.match(expertError, /Agente Editor/);
  assert.equal(helpers.getFriendlyError({ message: "Mensaje seguro del servidor" }, ""), "");
  assert.match(adminHtml, /market-admin-validation\.js\?v=20260828-radar-official-recovery1/);
  assert.match(adminHtml, /official-opportunity-request\.js\?v=20260828-radar-official-recovery1/);
  assert.match(adminHtml, /admin-markets\.js\?v=20260828-radar-official-recovery1/);
});
