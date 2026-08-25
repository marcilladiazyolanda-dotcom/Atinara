# Radar V6 · contrato de errores de revalidación

Fecha: 2026-08-25  
Base canónica: `013a3d986965664a3e68e23b5f41ae1d181de259`  
Proyecto: `fgrblufbuywxjahpymnh`

## Estado verificado

- Migración `20260825150021_bound_market_radar_catalog_projection_v1` aplicada.
- `market-radar` v62 `ACTIVE`, `verify_jwt=true`, digest
  `009b6196d2e3a22dc15316d8f3663e020e73ba7a354aeeac60cecc80767b41cb`.
- Pages sirve `20260825-radar-catalog-bound1`.
- Radar carga por tres páginas: 4 + 1 + 1 padres, sin HTTP 500.
- Ocho padres auditados; `KXPS6-26` aislado y los siete completos visibles.
- Madden y FC27: 0 oportunidades; 17/23 resultados oficiales terminales.
- Escritorio y móvil: ancho completo para una familia, cero overflow y cero
  solapamiento entre copy y acciones.

## Incidencia reproducida

Se seleccionó Onimusha: Way of the Sword porque conserva:

- identidad hija explícita `option:onimusha-way-of-the-sword-*`;
- padre Kalshi completo 19/19;
- dominio gaming;
- evento futuro;
- fuente de The Game Awards;
- cero duplicados.

La elegibilidad estaba caducada. La única acción «Renovar elegibilidad y
continuar» revalidó proveedor, padre, terminalidad y autoridad sin Gemini. La
puerta PostgreSQL devolvió `RADAR_CANDIDATE_IDENTITY_STALE`, resultado correcto:
el contrato observado ya no coincide exactamente con el snapshot persistido del
24 de agosto y debe ejecutarse un Radar fresco.

No se abrió formulario ni se creó borrador. La candidata continúa `available`,
sin `prepared_draft_id`. Mercados, predicciones, perfiles, borradores, Karma,
Prestigio, LMSR e histórico no cambiaron.

## Causa raíz

`rpc()` conserva el código factual en `RadarRpcError.databaseMessage`, pero la
auditoría y `eligibilityFailureResponse()` leían solo `error.message`, cuyo valor
es `RADAR_RPC_409`.

Consecuencias incorrectas:

- HTTP 503 genérico en lugar de 409 de dominio;
- `RADAR_ELIGIBILITY_TECHNICAL_FAILURE` en auditoría;
- fase `eligibility_persistence` en lugar de `provider_revalidation`;
- `retryable=false`;
- ninguna acción explícita para refrescar Radar.

## Corrección general

`radarOperationalErrorCode()` aplica precedencia estable:

1. `databaseMessage` saneado;
2. `code` tipado;
3. `message` solo si ya es un código seguro;
4. fallback conocido.

La misma función gobierna auditoría y respuesta HTTP. Para identidad stale:

- HTTP 409;
- fase `provider_revalidation`;
- `retryable=true`;
- `next_action=refresh_radar_sources`;
- mensaje español que exige una actualización Radar;
- estado anterior preservado.

Padre incompleto recibe el mismo tratamiento recuperable con
`next_action=retry_provider_refresh`. Los fallos reales de proveedor, scan
oficial y persistencia mantienen su semántica anterior.

## Alcance

Archivos productivos:

- `supabase/functions/_shared/market-radar.mjs`;
- `supabase/functions/market-radar/index.ts`.

No hay migración, frontend, secreto, DML, backfill, Gemini, cambio de Registry,
modo, ruta, modelo, proveedor, presupuesto o economía.

## Verificación

- 559/559 pruebas unitarias.
- 128 archivos JavaScript con sintaxis válida.
- 19/19 matrices SQL estáticas.
- parse TypeScript de `market-radar` correcto.
- smoke productivo previo: HTTP 200, tres páginas y layout escritorio/móvil.
- estado y economía invariantes después del intento fail-closed.
- `git diff --check` verde.

## Activación

1. Verificar subida exacta contra la base `013a3d9`.
2. Confirmar producción todavía en v62 y sin cambios de dominio.
3. Desplegar solo `market-radar`, `verify_jwt=true`.
4. Comprobar bundle y que solo cambian `index.ts` y `_shared/market-radar.mjs`.
5. Ejecutar una actualización Radar nueva y controlada desde la interfaz; no
   reanudar la UUID terminal anterior.
6. Seleccionar una candidata futura, explícita y sin duplicado del nuevo
   snapshot.
7. Renovar elegibilidad; exigir código/fase exactos si vuelve a fallar.
8. Solo con elegibilidad vigente, ejecutar Market Expert y continuar el E2E.
