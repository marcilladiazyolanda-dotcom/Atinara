# Instrucciones para migraciones Supabase de Atinara

Estas instrucciones amplían `AGENTS.md` para todo `supabase/migrations/`.

## Lectura obligatoria

Lee antes de modificar:

1. `AGENTS.md` raíz.
2. `SECURITY.md`.
3. `docs/ATINARA_AGENT_ENGINE_V2_RUNBOOK.md` si afecta Radar, Gateway o Agent Engine.
4. `docs/ATINARA_RPC_DEPENDENCY_MATRIX.md` y las suites transaccionales relacionadas.

## Migraciones aplicadas

La documentación productiva registra, entre otras, las migraciones V2.1 locales:

- `20260812141508_harden_radar_eligibility_rls_v1.sql`;
- `20260812141511_add_ai_gateway_telemetry_and_budgets_v1.sql`;
- `20260812141515_add_agent_engine_v2_v1.sql`.

Verifica siempre el historial real antes de actuar. Nunca edites los archivos ya aplicados ni intentes volver a ejecutarlos. Una discrepancia entre timestamp local y remoto se documenta; no se arregla reescribiendo historia.

## Disciplina de cambio

- Crea una migración nueva con la CLI actual; no inventes un timestamp histórico.
- Diseña cambios aditivos y compatibles. Si hay retirada, incluye transición, dependencias, rollback y verificación.
- No elimines Registry v1, wrappers v1, bindings, telemetría o triggers append-only para simplificar V2.1.
- No reviertas FORCE RLS como mecanismo de rollback.
- No uses variables de sesión controlables como bypass de trigger, RLS o purga.
- Mantén ownership, `search_path`, grants y `EXECUTE` mínimos.
- Toda tabla expuesta tiene RLS y policies explícitas. Las tablas privadas sin policy solo pueden ser cierre denegatorio con FORCE RLS y privilegios revocados.
- Las escrituras críticas son atómicas, idempotentes y seguras ante concurrencia.
- Nunca alteres Karma, Prestigio, predicciones, mercados o liquidaciones reales para probar.

## Verificación

- Revisa callers, vistas, triggers, funciones, grants, dependencias y datos existentes.
- Ejecuta advisors y valida manualmente los avisos de `SECURITY DEFINER` y `rls_enabled_no_policy`; no los silencies a ciegas.
- Prueba actor permitido y denegado, ownership, anon/authenticated/admin/service, retry, concurrencia y rollback.
- Usa una base local desechable o transacción `BEGIN/ROLLBACK` autorizada. Nunca apuntes `ATINARA_TEST_DATABASE_URL` a producción.
- No ejecutes `db push`, `migration repair`, `migration up` remoto ni SQL productivo sin autorización expresa.

## Revisión obligatoria

- Rechaza cualquier edición de una migración aplicada.
- Rechaza funciones privilegiadas invocables por roles no necesarios.
- Rechaza policies que confundan autenticación con autorización.
- Rechaza purgas con cutoff o IDs controlados por caller.
- Rechaza migraciones sin pruebas negativas y sin ruta de recuperación proporcional al riesgo.
