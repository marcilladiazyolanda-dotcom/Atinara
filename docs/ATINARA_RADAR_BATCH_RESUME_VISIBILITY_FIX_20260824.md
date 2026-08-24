# Radar V6 · persistencia durable por batch y visibilidad atómica

Fecha: 2026-08-24  
Base canónica: `origin/main` en `0af8e8090cfe4ccb3eca73f0d75348c483fca15d`  
Proyecto productivo: `fgrblufbuywxjahpymnh`

## Estado productivo preservado

- `20260824174351 · allow_partial_radar_parent_persistence_v1` está aplicada;
- `market-radar` v60 sigue `ACTIVE`, `verify_jwt=true` y no fue redesplegada;
- la única intención es `2798d1af-9ccd-4b79-9be7-37d5876d9484`;
- Polymarket está terminal con 74/74 aceptadas;
- Kalshi conserva 105 candidatas staged en cinco batches pendientes y
  `claim_count=3`;
- siete padres Kalshi están completos y `KXPS6-26` permanece
  `provider_unavailable`, sin identidad inventada;
- Tavily continúa como enriquecimiento técnico aislado;
- no se usó Gemini ni se creó borrador, mercado, predicción o efecto económico.

## Incidencia reproducida

La migración anterior eliminó correctamente la guardia global que hacía que un
padre incompleto bloqueara a sus hermanos completos. La siguiente continuación
reutilizó la misma UUID, pero PostgreSQL registró:

`RADAR_ATOMIC_CANDIDATE_BATCH_FAILED:RADAR_PERSISTENCE_TIMEOUT`

El rol `authenticator` de PostgREST conserva `statement_timeout=8s`. Una prueba
transaccional sobre los datos reales midió:

- primer batch, 20 candidatas: 2,26 s;
- cinco batches y finalización monolítica: 11,53 s.

Por tanto, el problema no era una candidata venenosa ni la reconciliación. El
writer ejecutaba cinco unidades sanas dentro de una única sentencia que excedía
el límite de la superficie HTTP.

## Contrato corregido

La migración
`20260824190000_harden_radar_batch_resume_visibility_v1.sql` añade:

- `process_market_radar_refresh_batch_v3`: confirma como máximo un batch por
  transacción, después de lease, manifest, binding e identidad;
- `complete_market_radar_candidate_refresh_v2`: rechaza finalizar mientras
  quede cualquier batch o `processed_count != expected_count`, y delega en el
  finalizador canónico cuando todo está completo;
- una defensa en la puerta compartida de reconciliación: si el mismo padre
  tiene una reconciliación ligada a una intención `in_progress`, ninguna fila
  antigua ni nueva de ese padre se considera current.

Esto preserva simultáneamente:

1. batches bajo el límite PostgREST;
2. lease, idempotencia y replay;
3. cero familia parcial durante una recarga o pérdida de respuesta;
4. padres completos independientes del padre proveedor incompleto;
5. cuarentena y contadores existentes;
6. visibilidad solo después del estado terminal del proveedor.

Los wrappers son `SECURITY DEFINER`, owner `postgres`, `search_path=''` y solo
`service_role` tiene `EXECUTE`. La función privada de binding continúa sin
grants API. La migración no contiene DML ejecutado al aplicarse, backfill,
borrado ni cambios de economía.

## Recuperación de interfaz

La Edge consulta `get_active_market_radar_refresh_v1` antes de devolver incluso
la vista cacheada. Si existe intención activa, responde su UUID y
`refresh_in_progress=true` aunque la pestaña anterior se haya cerrado.

`radar-refresh-request.js` adopta esa UUID mediante `resume`; el botón vuelve a
mostrar «Continuar actualización». Un clic reutiliza la intención autoritativa,
no crea una nueva. Todos los HTML comparten la versión de caché
`20260824-radar-batch-resume1` para impedir combinaciones de frontend antiguo y
nuevo.

## Evidencia

- 553/553 pruebas unitarias verdes.
- 127 archivos JavaScript con sintaxis válida.
- 18/18 matrices SQL estáticas válidas.
- 9/9 Edge Functions comprobadas con Deno 2.1.14 e IA externa desactivada.
- Migración exacta y suite transaccional completa sobre producción con
  `ROLLBACK`.
- Simulación de la UUID real bajo `statement_timeout=8s`, también con
  `ROLLBACK`: batches 20/22/23/22/18, 105/105 aceptadas, 0 cuarentenas,
  intención `partial`, 105 candidatas ligadas a padres completos y 0 al padre
  incompleto.
- Regresión LKG: una candidata ligada al padre terminal anterior deja de ser
  current al registrarse la reconciliación activa; la candidata nueva tampoco
  es current antes del terminal; tras finalizar aparece la proyección completa.
- `git diff --check` verde.

La prueba browser productiva del nuevo bundle queda deliberadamente pendiente
de que Yol suba este paquete y GitHub Pages lo sirva.

## Activación tras la subida

1. `git fetch` y comparación exacta de todas las rutas y contenidos.
2. Confirmar que `20260824190000` no figura aplicada y que continúan presentes
   las huellas preflight de process v2, complete v1 y binding.
3. Repetir fingerprints de dominio, modos IA, presupuestos y Registry.
4. Aplicar solo `20260824190000_harden_radar_batch_resume_visibility_v1.sql`.
5. Verificar historial, cuerpos, owner, `SECURITY DEFINER`, `search_path`, ACL y
   ausencia de backfill.
6. Desplegar solo `market-radar`, siempre con `verify_jwt=true`.
7. Esperar a que GitHub Pages sirva `20260824-radar-batch-resume1`.
8. Abrir una pestaña administrativa nueva: debe mostrar «Continuar
   actualización» y la UUID existente antes del clic.
9. Pulsar una sola vez. Exigir cinco batches completos, 105 procesadas y
   aceptadas, cero cuarentenas y final `partial` únicamente por `KXPS6-26`.
10. Verificar intención única, replay, padres/hijas, categóricas `option:*`,
    cero `deadline:*`, UI en español y fingerprints económicos.
11. Solo si todo pasa, reanudar Radar → Editor. Yol conserva la confirmación
    humana y ninguna publicación se realiza en esta fase.

## Detención segura

No volver a pulsar Radar antes de desplegar este paquete. Si falla preflight,
migración, Edge, Pages o cualquier invariante de familia, detenerse sin DML
manual: la intención y sus cinco batches pendientes son recuperables.
