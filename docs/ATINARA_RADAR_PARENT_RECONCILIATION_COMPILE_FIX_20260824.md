# Atinara · corrección de compilación de la migración Radar

Fecha: 24 de agosto de 2026.

Base canónica: `origin/main = 46aef25ec1ef221f9b0c29ea0b2a7041d62ac056`.

## Incidencia

El primer intento productivo de
`add_radar_parent_reconciliation_v1` fue rechazado por PostgreSQL antes del
commit con `record variable cannot be part of multiple-item INTO list`.

La transacción completa fue revertida. Se comprobó después:

- migración ausente del historial remoto;
- tablas padre/hija inexistentes;
- columnas nuevas de candidata/checkpoint inexistentes;
- cero estado parcial.

## Corrección

`market_radar_material_repair_checkpoint_valid_v1` deja de seleccionar un
`%rowtype` y un `jsonb` en el mismo `INTO`. Ahora:

1. carga el checkpoint completo mediante un `SELECT ... INTO` exclusivo;
2. carga el `canonical_payload` de la versión base mediante un segundo
   `SELECT ... INTO` condicionado al checkpoint encontrado.

No cambia contratos, reglas, locks, permisos, datos ni decisiones de dominio.

La validación transaccional completa permitió detectar y cerrar además, antes
de otro intento con efecto:

- una bifurcación `CASE` de cobertura legacy reescrita como ramas booleanas
  equivalentes;
- un paréntesis ausente en la proyección de duplicado live;
- nombres de parámetros legacy V2 conservados exactamente;
- tipo de retorno JSONB del wrapper histórico de rechazos preservado;
- un paréntesis excedente en la sincronización de provider projection.

## Inventario incremental

1. `supabase/migrations/20260822205445_add_radar_parent_reconciliation_v1.sql`
2. `docs/ATINARA_RADAR_PARENT_RECONCILIATION_COMPILE_FIX_20260824.md`

## Verificación

- Parser PostgreSQL 18.2.6: 387 sentencias válidas.
- SQL estático: 18/18.
- Suites focales Radar/workflow: 67/67.
- `git diff --check`: verde.
- Migración completa ejecutada con preflight, compilación de todas las
  funciones y postflight reales, sustituyendo únicamente el `COMMIT` final por
  `ROLLBACK`: verde y sin persistencia.

Producción permanece en el estado anterior a la migración. Este diferencial
debe subirse a GitHub antes de reintentar la aplicación.
