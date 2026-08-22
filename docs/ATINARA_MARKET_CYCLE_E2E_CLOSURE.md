# Atinara · cierre E2E del ciclo de mercado 13.5.2

Última actualización: 22 de agosto de 2026.

## Estado de esta evidencia

Este documento separa la candidata local, el despliegue y la demostración
productiva. El paquete V6 parte de `origin/main`
`1ca7f79d87486cb29bc25dc29be9b2a2ce38ae5e` y ha superado las puertas locales,
pero todavía no se ha publicado en GitHub ni desplegado. Por tanto, el veredicto
actual es:

**13.5.2 NO APTO PARA CIERRE · pendiente de postflight y E2E productivo.**

Este estado no es un rechazo de la implementación. Impide presentar pruebas
locales como evidencia de producción. Solo podrá cambiar a `APTO PARA CIERRE`
después de CI/Sonar, migraciones, bundles, frontend, smokes y un recorrido real
hasta `review_approved`. La confirmación humana se detiene para Yol; ninguna IA
puede realizarla.

## Causas raíz cerradas localmente

1. El writer «batch» de Radar reentraba por candidata, no conservaba intención
   ni cursor y finalizaba de forma no idempotente.
2. Tavily estaba mezclado con proveedores de candidatas y degradaba todo Radar.
3. El último estado válido no se conservaba en todos los fallos del proveedor.
4. Identidad categórica, dominio gaming, placeholders y paginación no compartían
   un contrato suficientemente general entre Edge, SQL y UI.
5. Los timestamps técnicos del proveedor podían promoverse por fallback a
   fechas contractuales de Atinara.
6. Valores ausentes podían convertirse en cero o probabilidad extrema.
7. Las incidencias se reducían a listas/copy y perdían responsable, bloqueo y
   siguiente acción entre Radar, Editor, Validator, Corrector y publicación.
8. La programación no conservaba un intento idempotente ni una recuperación
   dirigida ante fallos reintentables.
9. El test de idempotencia de Official Opportunity leía una tabla con RLS
   forzada desde un rol que no podía observarla y producía un falso rojo.
10. La publicación programada no renovaba ni comparaba la evidencia primaria al
   vencer la atestación del Validator; una aprobación legacy sin baseline podía
   quedar además en un bucle de recuperación sin owner ejecutable.

Las correcciones son reglas generales, no excepciones por título, proveedor o
fixture. Registry V2.1 no se usa como ledger y conserva versión y huella.

## Contratos versionados

- Refresco Radar: intención, capacidad, lease, manifest, lote, cursor, circuito
  y finalización durable; los wrappers v1 permanecen para rollback.
- Temporalidad: `atinara-temporal-contract-v1` separa fechas crudas de la
  proyección canónica y nunca concede autoridad por fallback.
- Incidencias: `atinara-market-issue-v1` conserva identidad y enlaces
  append-only entre artefactos.
- Canonicalización: `atinara-canonical-json-v1` continúa sin cambios.
- Agent Registry: V2.1 continúa sin cambios de versión, datos o hash.
- Dominio: discovery, preparación y recuperación recalculan la misma huella;
  una decisión humana solo se reutiliza para provider, external_id, política y
  `domain_fingerprint` exactos.
- Fuente de publicación: una única check PRIMARY más reciente es autoritativa;
  su inserción se serializa con el lock del borrador y nunca se retrocede a una
  check anterior todavía fresca.

## Matriz de responsabilidades

| issue_code | detected_by | owner_stage | blocking_scope | next_action | resultado esperado |
|---|---|---|---|---|---|
| `TEMPORAL_AUTHORITATIVE_DATE_REQUIRED` | Radar/Editor | Corrector | aprobación | `resolve_temporal_contract` | Formulario y borrador privado permitidos; sin aprobación/publicación hasta evidencia. |
| `TEMPORAL_SOURCE_SEMANTICS_MISMATCH` | Radar/Validator | Corrector | aprobación | `repair_temporal_or_source_contract` | Conserva fecha cruda; corrige solo la proyección y revalida. |
| `ESSENTIAL_TEXT_NOT_SPANISH` | Editor | Corrector | aprobación | `repair_essential_spanish_text` | Regenera texto esencial en español sin cambiar nombres propios ni autoaprobar. |
| `CHILD_IDENTITY_MISMATCH` | Editor | Corrector | aprobación | `repair_child_identity` | Alinea pregunta, criterios y opción; hermanas siguen separadas. |
| `RESOLUTION_PRIMARY_SOURCE_REQUIRED` | Editor/Validator | Corrector | aprobación | `repair_temporal_or_source_contract` | `waiting_authoritative_source`; edición y retry disponibles. |
| `RADAR_ELIGIBILITY_REQUIRED` | Radar/publicación | Radar | aprobación o publicación | `refresh_draft_eligibility` | Renueva check y binding exactos sin recrear borrador. |
| `ELIGIBILITY_EXPIRED` | Radar/publicación | Radar | aprobación o publicación | `refresh_draft_eligibility` | No usa Gemini sobre snapshot obsoleto; conserva expediente. |
| `GAMING_DOMAIN_REVIEW_REQUIRED` | Radar | Revisión humana | aprobación | `review_gaming_domain_manually` | Una señal ambigua exige decisión administrativa auditada; no se trata como terminal. |
| `PROVIDER_PLACEHOLDER` | Radar | Radar | ninguno | `recheck_provider_identity` | No Editor ni borrador hasta que exista una opción concreta. |
| `SOURCE_STALE` | publicación | Puerta de publicación/Corrector | publicación | `revalidate_temporal_evidence` | Conserva revisión/confirmación y vuelve al agente responsable. |
| `PUBLICATION_EVIDENCE_BASELINE_MISSING` | publicación | Validator | aprobación | `request_market_validation` | Sin backfill: invalida autoridad no demostrable, conserva la check actual y exige nueva revisión y confirmación. |
| `PUBLICATION_TECHNICAL_FAILURE` | publicación/scheduler | Plataforma interna | publicación | `retry_market_publication` | Backoff acotado e intento idempotente; no duplica mercado. |
| `EVENT_ALREADY_RESOLVED` | Radar | Radar | terminal | `archive_terminal_candidate` | No Editor, Gemini o borrador; queda auditable. |
| `OUTSIDE_GAMING_DOMAIN` | Radar | Radar | terminal | `archive_terminal_candidate` | Rechazo determinista sin inferencia ni persistencia de mercado. |
| `DUPLICATE_MARKET` | Radar | Radar | terminal | `archive_terminal_candidate` | Bloquea solo la proposición exacta; no colapsa hermanas. |

Una incidencia no terminal siempre tiene responsable y siguiente acción. El
alcance `approval` no bloquea el avance hasta borrador; `publication` no borra
el borrador ni su revisión; únicamente `terminal` impide materializarlo.

## Estados del artefacto

La progresión admite, entre otros:

```text
candidate_needs_temporal_analysis
  -> proposal_ready_with_issues
  -> draft_with_repairable_issues | draft_waiting_authoritative_source
  -> review_rejected_repairable
  -> repair_in_progress | repair_waiting_source
  -> repair_applied
  -> review_approved
  -> human_confirmed
  -> publication_revalidation_required | publication_blocked_recoverable
  -> scheduled | published
```

`review_rejected_terminal` y `publication_failed_terminal` requieren evidencia
terminal de la etapa propietaria. Un timeout, 429, fallo de telemetría, fuente
temporalmente inaccesible o respuesta inválida nunca entra en esos estados.

## Evidencia local

| Puerta | Resultado local |
|---|---|
| Base | `HEAD = origin/main = 1ca7f79…` antes de editar. |
| Sintaxis | 126 archivos JavaScript. |
| Unitarias | 490/490. |
| Canonical JSON | Node/Deno idénticos; 13 dominio, 10 golden, 22 inválidos, SHA `14141cff…`. |
| TypeScript | `tsc --project tsconfig.json`. |
| Edge | 9/9 con IA externa desactivada. |
| SQL estático | 17/17. |
| Migraciones | 58 archivos; 57 aplicados desde cero en PostgreSQL 17. Se omite únicamente `20260809145000_reconcile_authoritative_radar_fact_gate_v2.sql`, reconciliación material histórica que exige manifiesto productivo. |
| SQL dinámico | 17/17 dentro de `BEGIN/ROLLBACK`. |
| Carga Radar | 240 candidatas dentro de límites. |
| Concurrencia Radar | `started=1`, `in_progress=1`, dos proveedores bajo la UUID canónica, una finalización/replay y un único probe half-open. |
| Concurrencia publicación | Dos sesiones con la misma UUID: un intento, un mercado, un borrador publicado y un replay; las checks se serializan y el retry técnico se resuelve; base desechable. |
| Concurrencia Official Opportunity | Un run, una finalización, un replay y finalización tardía `interrupted`. |
| Navegador local | Once casos de UI en 390/768/1366 px, sin overflow ni red externa. Auth, RPC y Edge son dobles controlados; no demuestra Browser→Edge→Postgres ni producción. |
| Benchmark | 5/5 técnico; `externalNetworkCalls=0`; cero ground truth aprobado. |
| Dependencias | `npm audit --offline`: 0 vulnerabilidades. |
| Codex | 10 skills, 4 subagentes, 25 reglas, 50 ejemplos. |
| Whitespace | `git diff --check` limpio. |

Las pruebas de navegador local demuestran la interfaz y sus contratos con
dobles controlados, no una integración productiva. Cubren: anomalía temporal que llega a borrador y
Corrector; criterios incoherentes reparables; elegibilidad caducada sin Gemini;
espera de fuente con edición/retry; publicación con fuente obsoleta que vuelve
al owner; condición terminal sin Editor, Gemini o borrador; revisión humana de
dominio; y bloqueo de edición de un borrador programado con cancelación real.

## Seguridad, privacidad y autoridad

- Las tablas nuevas usan owner `postgres`, RLS forzada y cero grants directos
  para roles API. Los wrappers fijan `search_path=''` y comprueban rol.
- Los ledgers son append-only; los cambios de estado son eventos CAS.
- No se persisten prompts, HTML, consultas, secretos, PII o respuestas crudas.
- Radar sigue con cero inferencias. Editor/Validator/Corrector conservan AI
  Gateway, deadline, presupuesto y telemetría existentes.
- `legacy_direct`, rutas nulas, modelos, flags y presupuestos no cambian.
- Ninguna ruta nueva elude la confirmación humana. El scheduler solo publica
  una versión ya confirmada después de revalidar evidencia primaria y binding;
  ninguna ruta resuelve, liquida o altera economía por sí sola. La beta mantiene
  Karma separado de dinero real.

## Rendimiento y recuperación

El refresh limita 240 elementos, lotes de 24, sublotes por split y un único
probe por capacidad. Un batch técnico fallido permanece durable; no existe un
deferred exclusivamente en memoria. El rollback despliega la Edge anterior y
conserva tablas/ledgers V6, sin borrar historia, retirar RLS ni restaurar grants.

La publicación programada realiza una comprobación oficial sin Gemini. El
primer pase materializa `SOURCE_STALE`; la Edge valida únicamente hosts del
registro, persiste una check acotada y compara el baseline. Evidencia equivalente
habilita un segundo pase idempotente; contenido distinto reabre Corrector;
baseline legacy ausente vuelve al Validator; un fallo técnico conserva la
autoridad y no publica.

## Puertas productivas pendientes

1. Subida manual del ZIP y verificación de `origin/main` exacto.
2. CI y Quality Gate de Sonar sobre el mismo SHA.
3. Aplicar únicamente `20260820163014` y `20260820174316`.
4. Verificar owner, `SECURITY DEFINER`, `search_path`, ACL, RLS, ausencia de
   backfill y preservación del Registry V2.1.
5. Desplegar solo frontend y Edge afectadas, con JWT y configuración actuales.
6. Ejecutar smokes Radar, handoff de issue, Editor, borrador, Validator,
   Corrector y publicación recuperable.
7. Recorrer un mercado real hasta `review_approved` y detenerse para revisión y
   confirmación humana de Yol.
8. Tras esa confirmación, revalidar y publicar exactamente una vez.

Datos y tendencias solo continúa automáticamente después de un veredicto
productivo `13.5.2 APTO PARA CIERRE`; reutilizará el mismo contrato de issues,
provenance, temporalidad, idempotencia, aislamiento de proveedores y autoridad
humana. En este paquete, Official Opportunity enlaza al ledger un fallo técnico
del run; la taxonomía y el handoff de incidencias de cada señal estructurada
pertenecen a esa fase posterior y no se presentan aquí como cerrados.
