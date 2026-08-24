# Radar V6 · aislamiento de padres parciales en persistencia

Fecha: 2026-08-24  
Base canónica: `origin/main` en `413b075058a32a1f106a320afdabe75f51ae1d32`  
Proyecto productivo: `fgrblufbuywxjahpymnh`

## Estado productivo de partida

La entrega anterior está canónica y activa:

- la migración local
  `20260824153000_fix_radar_legacy_representation_reconciliation_v1.sql`
  figura remotamente una sola vez como `20260824153114`;
- `market-radar` v60 está `ACTIVE`, con `verify_jwt=true`;
- sus dos archivos modificados coinciden con el contenido de GitHub;
- no cambiaron Registry V2.1, modos, rutas, flags, proveedores experimentales,
  modelos ni presupuestos;
- no se usó Gemini.

La única actualización administrativa autorizada creó la intención durable
`2798d1af-9ccd-4b79-9be7-37d5876d9484`. Una continuación posterior reutilizó
esa misma UUID; no creó un refresh distinto.

| Capacidad | Manifest | Persistencia | Resultado observado |
|---|---:|---:|---|
| Polymarket | 74 candidatas, 3 padres | 74/74 en 5 batches | Completo, 0 cuarentenas y 0 fallos |
| Kalshi | 105 candidatas, 8 padres y 109 hijas | 0/105; 5 batches pendientes | Durable en `persisting` |
| Tavily | 0 candidatas | 0 | Fallo técnico aislado, sin degradar proveedores |

## Incidencia y causa raíz general

Siete padres Kalshi están completos y con paginación agotada. El octavo,
`KXPS6-26`, conserva una hija coincidente en las superficies current y nested:
`KXPS6-26-DEC31`. La consulta al endpoint histórico oficial recibió
`PROVIDER_RATE_LIMITED`; por ello el ledger lo clasificó correctamente como:

- `reconciliation_status = provider_unavailable`;
- `provider_pagination_exhausted = false`;
- incidencia estable y próximo reintento;
- ninguna identidad inventada o hija descartada.

La persistencia devolvió `RADAR_PARENT_MANIFEST_REQUIRED` antes de cada batch.
El problema no está en la reconciliación del padre: las funciones
`process_market_radar_refresh_batch_v2` y `finalize_market_radar_refresh_v4`
exigían globalmente que **todos** los padres hubieran agotado paginación. Un
único padre no disponible impedía así promover candidatas de otros padres
independientes que sí estaban completos.

El invariante correcto es doble:

1. una candidata nunca puede hacerse visible si su propio padre no está
   completo, paginado y vinculado a esa candidata;
2. un padre incompleto no debe bloquear la promoción atómica de candidatas
   ligadas a padres completos del mismo proveedor.

## Corrección aditiva

`20260824180000_allow_partial_radar_parent_persistence_v1.sql` modifica solo
tres funciones existentes, después de verificar sus huellas productivas
normalizadas CRLF/LF:

- `process_market_radar_refresh_batch_v2` elimina únicamente el guard global de
  paginación. Conserva los guards por `provider_parent_id`, reconciliación,
  estado, identidad y binding de cada candidata;
- `finalize_market_radar_refresh_v4` admite validar un cierre
  `partial_error`, conserva la coherencia del manifest y devuelve en replay el
  `response_summary` terminal ya persistido;
- `complete_market_radar_candidate_refresh_v1` consulta el estado durable de
  paginación. Si queda alguna superficie sin agotar, finaliza como
  `partial_error`, con código `RADAR_PARENT_RECONCILIATION_INCOMPLETE`, etapa
  `fetch` y retry de 300 segundos. Si toda la paginación fue consumida,
  conserva el comportamiento vigente.

La migración restaura explícitamente owner `postgres`, `SECURITY DEFINER`,
`search_path=''` y ACL: solo la función pública de completion mantiene
`EXECUTE` para `service_role`. No añade tablas, columnas, índices, triggers,
constraints ni grants de cliente.

No contiene DML, backfill, borrado ni edición de una migración aplicada. No
cambia Edge, frontend, secretos, IA, Registry, mercados, borradores,
predicciones, perfiles, Karma, Prestigio, LMSR o histórico.

## Aceptación probada

La suite transaccional añade un proveedor con dos padres:

- uno completo, con candidata válida;
- otro `provider_unavailable`, con paginación incompleta y issue reparable.

La migración exacta y toda la suite SQL se ejecutaron sobre producción dentro
de una transacción con `ROLLBACK`. Se demostró que:

- la candidata del padre completo se promueve una sola vez;
- el padre parcial nunca queda candidate-ready;
- el resultado del proveedor es `partial_error/partial`;
- el issue conserva `RADAR_PARENT_RECONCILIATION_INCOMPLETE`;
- el replay no duplica candidata ni efecto;
- el caso distinto de placeholders no resueltos con toda la paginación agotada
  conserva su semántica previa.

Validación local final antes del empaquetado:

- 552 unitarias verdes, 0 fallos;
- 127 archivos JavaScript con sintaxis válida;
- 18 matrices SQL transaccionales válidas;
- prueba SQL dinámica completa en producción con `ROLLBACK`;
- `git diff --check` verde.

## Activación después de la subida

1. Ejecutar `git fetch` y comparar exactamente rutas y contenidos del paquete
   con el nuevo `origin/main`.
2. Confirmar que `20260824180000` no está aplicada y que las tres huellas de
   preflight son todavía:
   - batch v2:
     `5f507eaa0e5ba70207b9c3fa8b060ff6c8a3f94a37417faffb96ad55cd907926`;
   - finalizer v4:
     `9fcc8efea66de602c88de8e78303f4e2ffafbe639e92177eea15f3443ff4ff51`;
   - completion v1:
     `3e0df80d753e6b94a1b9546664c8bbc0b3a6757b60726a3175303ffe6e96e21a`.
3. Repetir el baseline de datos de dominio y ajustes IA.
4. Aplicar exclusivamente la migración nueva y verificar historial, cuerpos,
   owner, `SECURITY DEFINER`, `search_path`, ACL y ausencia de DML/backfill.
5. No desplegar ninguna Edge Function ni frontend.
6. Desde la interfaz administrativa autenticada, pulsar una sola vez
   **Continuar actualización**. Debe reutilizar la UUID
   `2798d1af-9ccd-4b79-9be7-37d5876d9484`; no iniciar otro refresh.
7. Verificar los cinco batches Kalshi, contadores, cierre parcial durable,
   ledger, aislamiento de `KXPS6-26` y replay idempotente.
8. Repetir fingerprints de mercados, predicciones, perfiles, borradores,
   Karma, Prestigio, LMSR e histórico. Solo se admiten las escrituras normales
   del Radar.
9. Ejecutar el smoke visual de reconciliación, categóricas y UI. Si pasa,
   reanudar el E2E V6 desde Radar hacia Editor; no confirmar ni publicar por
   Yol.

## Rollback lógico

No aplicar una contramigración improvisada. Si falla el preflight, la migración
aborta completa antes del cambio. Si el postflight falla, toda la transacción
revierte. La intención durable permanece reanudable y sus batches pendientes;
no se borra ni se fabrica estado para la prueba.
