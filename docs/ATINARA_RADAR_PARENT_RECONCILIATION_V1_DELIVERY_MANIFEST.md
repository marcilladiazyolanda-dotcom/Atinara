# Atinara · manifiesto de entrega · Radar Parent Reconciliation V1

Fecha: 24 de agosto de 2026.

Base canónica verificada después de `git fetch --all --prune`:
`origin/main = 3d0db378d216c753635d066c86a31af24cf1fcea`.

## Alcance

Entrega incremental para corregir de forma general la completitud del padre,
reconciliación exhaustiva de hijas, placeholders legacy, identidad categórica,
paginación, proyección administrativa y continuidad segura
Radar → Market Expert/Editor → borrador → Validator → Corrector → publicación.

- 45 archivos modificados.
- 5 archivos nuevos, incluido este manifiesto.
- 0 archivos eliminados.
- 50 archivos totales en el ZIP.
- Ningún secreto, `.env`, dependencia, artefacto temporal o ZIP anterior.
- Ningún cambio en AI Gateway, Registry V2.1, modos, rutas, modelos,
  proveedores experimentales o presupuestos.
- Producción no fue modificada y no se utilizó Gemini.

## Inventario exacto

### Modificados

1. `ORAKLO_PROJECT_CONTEXT.md`
2. `README.md`
3. `admin-agent-engine.js`
4. `admin-community.html`
5. `admin-markets.html`
6. `admin-markets.js`
7. `admin-resolution.html`
8. `community.html`
9. `docs/ATINARA_MARKET_CYCLE_E2E_CLOSURE.md`
10. `docs/STATE_CONSISTENCY_AND_MEMORY.md`
11. `index.html`
12. `market-detail.html`
13. `my-predictions.html`
14. `profile.html`
15. `ranking.html`
16. `reset-password.html`
17. `scripts/check-market-workflow-browser.mjs`
18. `scripts/run-supabase-transaction-tests.mjs`
19. `styles.css`
20. `supabase/functions/_shared/market-draft-repair.mjs`
21. `supabase/functions/_shared/market-radar.mjs`
22. `supabase/functions/market-draft-fixer/index.ts`
23. `supabase/functions/market-radar/index.ts`
24. `supabase/functions/validate-market-draft/index.ts`
25. `supabase/tests/authoritative_radar_fact_gate_transaction.sql`
26. `supabase/tests/market_workflow_orchestration_v1_transaction.sql`
27. `supabase/tests/radar_editor_prepare_transaction.sql`
28. `supabase/tests/radar_expert_save_wrapper_v1_transaction.sql`
29. `supabase/tests/radar_provider_resumability_v1_transaction.sql`
30. `tests/agent-engine-confirmation-v8.test.js`
31. `tests/agent-engine-frontend.test.js`
32. `tests/agent-engine-v2.test.js`
33. `tests/authoritative-radar-fact-gate.test.js`
34. `tests/autonomous-repair-and-families.test.js`
35. `tests/expert-market-cycle-definitive.test.js`
36. `tests/human-confirmation-flow.test.js`
37. `tests/market-family-v4.test.js`
38. `tests/market-intelligence.test.js`
39. `tests/market-radar.test.js`
40. `tests/market-workflow-orchestration-v1.test.js`
41. `tests/official-opportunity-discovery.test.js`
42. `tests/radar-editor-regressions.test.js`
43. `tests/radar-eligibility-sources-v5.test.js`
44. `tests/radar-provider-resumability-v1.test.js`
45. `tests/radar-refresh-resilience.test.js`

### Nuevos

46. `docs/ATINARA_RADAR_PARENT_RECONCILIATION_V1.md`
47. `docs/ATINARA_RADAR_PARENT_RECONCILIATION_V1_DELIVERY_MANIFEST.md`
48. `supabase/migrations/20260822205445_add_radar_parent_reconciliation_v1.sql`
49. `supabase/tests/radar_parent_reconciliation_v1_transaction.sql`
50. `tests/radar-parent-reconciliation.test.js`

## Puertas locales

- Unitarias: 548/548.
- JavaScript: 127 archivos con sintaxis válida.
- TypeScript: verde.
- Edge Functions: 9/9 con Deno 2.1.14.
- Canonical JSON: Node/Deno idénticos.
- SQL estático: 18/18.
- Parser PostgreSQL 18.2.6: migración y tests nuevos válidos.
- Browser E2E: 18 casos; 390/768/1366 px; cero red externa.
- `git diff --check`: verde; solo avisos informativos LF/CRLF.
- Auditoría final Supabase: `APTO LOCAL`, sin defectos materiales abiertos.

No se declara ejecutado el SQL dinámico: este entorno no dispone de PostgreSQL
local/desechable ni de `ATINARA_TEST_DATABASE_URL`. Tampoco se presenta este
checkpoint como evidencia productiva.

## Activación posterior a la subida

1. `git fetch` y comparación exacta del nuevo `origin/main` con este inventario.
2. Esperar Actions, Pages y Sonar del nuevo SHA.
3. Ejecutar el preflight productivo ya autorizado.
4. Aplicar únicamente
   `20260822205445_add_radar_parent_reconciliation_v1.sql`.
5. Verificar owner, `SECURITY DEFINER`, `search_path`, ACL, RLS, constraints,
   índices, triggers, cero backfill y cero mutación de dominio.
6. Desplegar solo las Edge modificadas y el frontend versionado, con JWT.
7. Ejecutar un único refresh autenticado del Radar, sin Gemini.
8. Demostrar `declared = accounted`, replay, UI y browser smoke productivos.
9. Solo entonces reanudar el E2E V6 hasta `review_approved` y detenerse para la
   confirmación humana real de Yol.
