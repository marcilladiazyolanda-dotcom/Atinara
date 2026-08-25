# Radar V6 · aislamiento parcial de series Kalshi

Fecha: 2026-08-25  
Base canónica: `03e89696a3f8ea3269ecfe4f22bffc7dccb3fbf3`  
Proyecto: `fgrblufbuywxjahpymnh`

## Estado previo

- `market-radar` v64 `ACTIVE`, `verify_jwt=true`, digest
  `6bd6e422afeead349fbe548237d8d3f950c0917cf178f70d9e1d3a5d11cc2ec2`.
- Heartbeat verificado: Tavily completado; Polymarket 74/74, cinco batches,
  una ejecución por batch y cero cuarentenas.
- UUID intermedia `2a268e1d-b4d0-4b79-829d-03ab481015c3` terminal en sus tres
  capacidades; Kalshi no se usa como snapshot fresco.
- Dominio y economía intactos: 15 mercados, 6 borradores, 9 predicciones,
  maker 15, price history 17, Karma 2932 y Prestigio 40.

## Incidencia

El refresh filtrado a Kalshi `30e26184-a974-4878-9a1b-39005b856fd8`
terminó en cinco segundos:

- Tavily `completed`;
- Kalshi `technical_failed/PROVIDER_UNAVAILABLE` en `fetch`;
- cero padres, manifest, batches o candidatas persistidas;
- endpoints oficiales de taxonomía y series comprobados después con HTTP 200.

La causa está en `discoverKalshi`: se consultan 25 series mediante
`mapWithConcurrency`, pero cualquier resultado rechazado ejecutaba
`throw new Error("PROVIDER_UNAVAILABLE")`. Una caída parcial anulaba las series
sanas y ocultaba el alcance real.

## Corrección general

- Conserva todos los eventos de series `fulfilled`.
- Registra los tickers fallidos sin mensajes crudos.
- Solo falla globalmente si no hay ningún evento utilizable y existe al menos
  una serie fallida.
- Calcula `selected_series_count` sobre series realmente exitosas.
- Añade `failed_series_count`, `failed_series_ids` y
  `provider_scope_partial=true`.
- Incluye las series fallidas en `deferred_series_count` para futuros retries.
- Emite `RADAR_PROVIDER_SERIES_PARTIAL` sin degradar la salud de padres sanos.
- La UI explica que las series fallidas se reintentarán y que ningún padre
  representado fue truncado.

La enumeración de un padre ya seleccionado conserva sus guardas estrictas: un
conflicto de identidad, límite de hijas o URL inválida no se transforma en éxito.

## Alcance y verificación

- Edge: `supabase/functions/market-radar/index.ts`.
- Test: `tests/market-radar.test.js`.
- Sin migración, frontend, DML, backfill, Gemini, secretos o economía.
- 85 pruebas enfocadas verdes.
- Parse TypeScript correcto.
- `git diff --check` verde.

## Activación

1. Verificar subida exacta sobre `03e8969`.
2. Confirmar v64 e invariantes.
3. Desplegar solo `market-radar`, JWT obligatorio.
4. Respetar cooldown y ejecutar un refresh Kalshi nuevo.
5. Exigir que al menos las series sanas produzcan padres, manifest y batches.
6. Auditar `failed_series_count` si es mayor que cero.
7. Continuar hasta terminal sin crear otra UUID durante el mismo intento.
8. Seleccionar una candidata únicamente del snapshot nuevo y vigente.
