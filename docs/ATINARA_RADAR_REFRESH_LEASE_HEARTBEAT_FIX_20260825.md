# Radar V6 · heartbeat de lease durante discovery y fuentes oficiales

Fecha: 2026-08-25  
Base canónica: `fc6220f06ecbd2dbc2afb57422540cd8287d87b4`  
Proyecto: `fgrblufbuywxjahpymnh`

## Estado productivo

- `market-radar` v63 `ACTIVE`, `verify_jwt=true`, digest
  `9c45bec7deca45724ddbb8d7c18303c5cedfd7034899dc1d55d4a52c32221c30`.
- Migración de catálogo aplicada y smoke HTTP 200 cerrado.
- Contrato de errores de revalidación desplegado.
- Modos AI `legacy_direct`, experimentales apagados y Registry V2.1 intacto.

## Incidencia reproducida

Un refresh nuevo creó `2a268e1d-b4d0-4b79-829d-03ab481015c3`:

- primera llamada: parent ledgers 3/3 Polymarket y 11 Kalshi, un padre Kalshi
  incompleto; transporte 546 a los 56,6 s;
- recuperación por «Aplicar filtros»: misma UUID y botón «Continuar»;
- continuación única: `claim_count=2`, sin otra intención;
- Kalshi terminó `technical_failed` antes del manifest/staging;
- Polymarket y Tavily permanecieron `claimed` con lease vencida;
- cero batches, candidatas persistidas, cuarentenas o cambios de dominio.

PostgreSQL registró múltiples `RADAR_REFRESH_LEASE_INVALID`. El bloqueo es
correcto: un owner no debe escribir después de los 45 s.

## Causa raíz

La Edge renovaba leases:

- antes de registrar reconciliaciones;
- antes de declarar, stagear y sellar batches;
- antes de cada batch y finalización.

No las renovaba mientras ejecutaba:

- discovery y paginación completa de proveedores;
- resolución de identidades hijas;
- búsqueda y recuperación de fuentes oficiales.

Esas operaciones pueden superar el TTL sin que exista otro fallo.

## Corrección

`withRadarRefreshLeaseHeartbeat`:

1. filtra intents con token, no terminales y propiedad efectiva;
2. renueva antes de iniciar la operación;
3. compite la operación contra un tick de 15 s;
4. en cada tick renueva secuencialmente todos los intents válidos;
5. cancela el timer al terminar;
6. propaga cualquier fallo sin revivir leases ni cambiar el resultado de dominio.

Se aplica a discovery y a research oficial. Antes de research se excluyen los
proveedores que no llegaron a `discoveredByProvider`, evitando renovar una
capacidad ya fallida o finalizada.

No cambia TTL SQL, lease token, owner, constraints, RPC, datos ni política de
replay. No usa `setInterval` ni deja timers pendientes al finalizar.

## Alcance y verificación

- Edge modificada: `market-radar/index.ts`.
- Test modificado: `tests/radar-provider-resumability-v1.test.js`.
- Sin migración, frontend, secreto, DML, backfill, Gemini o economía.
- 84 pruebas enfocadas verdes.
- Parse TypeScript de `market-radar` correcto.
- `git diff --check` verde.

## Activación

1. Verificar subida exacta sobre `fc6220f`.
2. Confirmar v63 y los intents de la UUID actual.
3. Desplegar solo `market-radar`, `verify_jwt=true`.
4. Continuar la UUID actual una vez para cerrar Polymarket/Tavily.
5. No reutilizar Kalshi terminal de esa intención como snapshot fresco.
6. Iniciar después un refresh nuevo para Kalshi y exigir heartbeat, manifest,
   batches y finalización sin lease inválida.
7. Seleccionar una candidata vigente solo tras el nuevo snapshot.
8. Market Expert permanece bloqueado hasta elegibilidad actual.
