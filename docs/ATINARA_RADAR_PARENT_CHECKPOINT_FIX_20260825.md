# Radar V6 · checkpoints durables de padres

Fecha: 25 de agosto de 2026  
Base canónica: `0b11030e70b31cb5b174285715fc762e226f863b`

## Estado productivo observado

La entrega anterior quedó integrada exactamente en `origin/main`; Calidad de
Atinara, Pages y el benchmark offline terminaron correctamente. Se desplegó
solo `market-radar` v67, `ACTIVE`, `verify_jwt=true`, digest
`df8a9d308e2ae8a72b466849b6d3fafc76c7e51620114168afb9571c627e2075`.

El único refresh Kalshi nuevo fue
`b73e9718-7017-4af4-80d1-6ed470902061`. Demostró:

- 109 series disponibles, 25 seleccionadas y cero series fallidas;
- 11 padres seleccionados, 148 hijas descubiertas y ningún truncado de padre;
- `record_market_radar_provider_selection_v1` HTTP 200;
- Tavily completado como capacidad auxiliar independiente;
- `record_market_radar_parent_reconciliations_v1` HTTP 500;
- cero parent ledgers, manifest, batches o candidatas para esa UUID;
- estado terminal `technical_failed`, sin abrir una segunda intención;
- mercados, borradores, predicciones, perfiles, LMSR, precios, Karma y
  Prestigio protegidos sin cambios.

La lectura posterior dejó `refresh_intents=20` e `issues=446` por las dos
capacidades técnicas y la incidencia nueva. `provider_runs=48`,
`candidates=315`, `fact_checks=3306`, `eligibility_checks=3522`, `drafts=6` y
los seis fingerprints protegidos permanecieron exactamente iguales al
baseline. Karma continuó en 2.932 y Prestigio en 40.

## Causa raíz general

No fue una caída de Kalshi ni una pérdida de hijas. Los once endpoints de evento
respondieron y las 148 identidades estaban en memoria. El límite efectivo de
PostgREST es `statement_timeout=8s`:

- el writer monolítico tenía siete ejecuciones exitosas con máximo 5,99 s; la
  llamada actual de 11 padres/148 hijas cruzó el límite y no dejó checkpoint;
- `list_market_radar_candidates_v5` tenía ejecuciones exitosas de hasta 7,94 s
  y el smoke registró también un 500 en esa ruta;
- un `EXPLAIN (ANALYZE, BUFFERS)` autenticado de la vista actual tardó 5,83 s,
  tocó 11.372 bloques compartidos y derramó más de mil bloques temporales.

La frontera ligera estaba situada después de `list_market_radar_candidates_v4`:
v5 materializaba primero el expediente JSON completo y lo reducía después. El
writer, por su parte, exigía todos los padres en una sola transacción. Ambos
contratos carecían de margen temporal bajo la sesión real.

## Corrección

La migración
`20260825193000_checkpoint_market_radar_parent_persistence_v1.sql`:

- mantiene la firma y los privilegios de
  `record_market_radar_parent_reconciliations_v1`;
- permite subconjuntos formados solo por padres seleccionados y nunca por padres
  diferidos o ajenos;
- conserva cada padre y todas sus hijas como una unidad transaccional append-only;
- deja `parent_manifest_hash=null` mientras falte cualquier padre o hija;
- actualiza recuentos parciales sin afirmar paginación completa;
- sella el manifest únicamente cuando los IDs, recuentos de padres, hijas y
  estados coinciden exactamente con `provider_selection`;
- rechaza replays materiales distintos y cualquier exceso, omisión o conflicto;
- reemplaza v5 por una CTE mínima y proyecta solo las filas ya paginadas antes de
  agregarlas a JSON.

La Edge `market-radar`:

- ordena los padres de forma binaria y envía uno por RPC;
- renueva el lease antes de cada checkpoint;
- exige `complete=true` y un manifest SHA-256 al terminar;
- conserva códigos SQL seguros y mapea SQLSTATE `57014`/HTTP 504 a
  `RADAR_PERSISTENCE_TIMEOUT`;
- difiere un timeout técnico con la misma UUID y siguiente acción
  `resume_persistence_intent`, en vez de cerrar falsamente el proveedor;
- solo devuelve HTTP 202 después de comprobar que la RPC de deferral confirmó
  `in_progress`, `retryable=true`, la UUID y la siguiente acción; una deferral
  ambigua ya no se oculta ni se presenta como reanudación confirmada;
- continúa ejecutando cero inferencias y no contiene IDs o títulos especiales.

## Evidencia local y de solo lectura

- 187/187 pruebas focalizadas de Radar, catálogo, familias, coordinación,
  resumibilidad y ciclo experto;
- `market-radar` válido con Deno 2.1.14;
- 19/19 contratos SQL estructuralmente válidos;
- migración ejecutada sobre PostgreSQL 17 desechable con hashes productivos,
  preflight, transformación, recompilación, ACL y postflight correctos;
- checkpoint vacío sellado con recuentos 0/0 y hash de 64 caracteres;
- fixture Unicode/apóstrofe/guion/número proyectado sin payload raw;
- comparación de las 315 candidatas productivas: cero diferencias entre la
  proyección vigente y la propuesta; máximo 6.848 bytes en ambos contratos;
- el test SQL transaccional ahora recorre checkpoints de 1, 3, 21, 48 y 101
  hijas, fallo intermedio, replay, conflicto y sellado exacto.

La suite SQL transaccional completa requiere el stack local Supabase y debe
ejecutarse en CI tras la subida. No se usó producción para DML de prueba.

## Activación pendiente

1. Subir el paquete incremental y verificar SHA, inventario y contenido.
2. Exigir Calidad de Atinara verde, incluido Deno y contratos SQL.
3. Aplicar la única migración nueva antes de desplegar la Edge; no ejecutar
   backfill ni DML manual.
4. Desplegar únicamente `market-radar` con `verify_jwt=true`.
5. Verificar versión, digest, ACL, fingerprints protegidos y paridad de v5.
6. Reanudar exclusivamente la UUID productiva cuando el contrato lo permita;
   no crear refreshes a ciegas.
7. Exigir parent ledgers, manifest, batches, finalización y replay antes de
   seleccionar una candidata o ejecutar Market Expert.

## Riesgos residuales

- La mejora de tiempo real de v5 solo puede medirse después de aplicar la
  migración en el entorno productivo; la paridad semántica sí está demostrada.
- La UUID actual es terminal por la versión desplegada. Si el coordinador no la
  admite tras el cambio, debe iniciarse como máximo el único refresh fresco
  adicional explícitamente necesario, nunca varios intentos ciegos.
- El E2E Radar → Market Expert/Editor → borrador privado sigue pendiente y no
  puede declararse apto antes del smoke posterior a la activación.
