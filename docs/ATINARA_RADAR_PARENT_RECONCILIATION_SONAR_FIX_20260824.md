# Atinara · corrección Sonar de Radar Parent Reconciliation

Fecha: 24 de agosto de 2026.

Base canónica: `origin/main = 9932628b76ee061686fa32314916a7df5d7c936b`.

## Motivo

El commit del paquete principal contiene exactamente sus 50 archivos y supera
Actions, benchmark y Pages. SonarCloud bloqueó el Quality Gate con 69
incidencias `plsql:NullComparison` exclusivamente sobre la nueva migración.

El analizador Oracle PL/SQL interpretaba como comparaciones con `NULL` dos
formas válidas de PostgreSQL:

- `set search_path=''`;
- comparaciones deliberadas con la cadena vacía `''`.

## Corrección

Sin cambiar la semántica de dominio:

- 84 cláusulas pasan a la sintaxis PostgreSQL equivalente
  `set search_path to ''`; `pg_proc.proconfig` continúa siendo
  `search_path=""`;
- las comparaciones con cadena vacía usan `length(...)` o `nullif(...,'')`;
- la inicialización local de `unicode_slug` usa `default ''`.

No se cambia ninguna función, firma, grant, revoke, RLS, constraint, índice,
trigger, contrato, hash de dominio, writer, estado o dato. La migración continúa
sin backfill y todavía no se ha aplicado.

## Inventario incremental

1. `supabase/migrations/20260822205445_add_radar_parent_reconciliation_v1.sql`
2. `docs/ATINARA_RADAR_PARENT_RECONCILIATION_SONAR_FIX_20260824.md`

## Verificación local

- Parser PostgreSQL 18.2.6: 387 sentencias válidas.
- SQL estático: 18/18.
- Suite focal Radar/workflow: 67/67.
- `git diff --check`: verde.
- Cero ocurrencias restantes de `set search_path=''` o comparaciones
  `= ''` / `<> ''` en la migración.

Después de subir este diferencial se debe esperar el nuevo SonarCloud Quality
Gate. No se autoriza aplicar la migración ni desplegar mientras Sonar siga rojo.
