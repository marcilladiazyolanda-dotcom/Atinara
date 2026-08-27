# Atinara · sellado incremental del catálogo global Radar

Fecha: 27 de agosto de 2026

Base exacta: `a536a28e711a9c337ea23fde60c907a886584a72`

Estado actualizado: integrada en
`98e5eded9fdef2dd9dea0975dad73a079bcb7f6e` y desplegada exclusivamente como
`market-radar` v74. Eliminó la materialización monolítica del hash, pero el smoke
alojado terminó HTTP 546 porque el catálogo completo todavía se clasificaba dos
veces y superaba el límite CPU del worker. La continuación vigente está en
`ATINARA_RADAR_CATALOG_WORKER_LIMIT_FIX_20260827`; este documento conserva la
evidencia histórica de la primera causa y corrección.

## Incidente productivo preservado

La migración V2 se aplicó una sola vez en producción como
`20260827150224_checkpoint_market_radar_global_catalog_v2`. Después se desplegó
únicamente `market-radar` v73, `ACTIVE`, `verify_jwt=true`, digest
`550a3b4372a61e77e0004534085c74bb23475e52f42f27916437c15c02778bd8`.

Se inició exactamente un refresh Kalshi:
`39bc204b-aa3f-4a69-99da-557f5fa91f7d`. El intento inicial y una única
reanudación conservaron esa UUID. Sus dos intenciones —`kalshi/candidate_feed`
y `tavily/source_enrichment`— permanecen `in_progress/claimed`,
`claim_count=2`, con el lease vencido. El ledger contiene dos eventos
`RADAR_REFRESH_CLAIMED` y dos `RADAR_REFRESH_RECLAIMED`; no existen checkpoint
V2, batch, manifest, candidata o borrador para ese refresh.

Las dos invocaciones de escritura terminaron HTTP 546 a 10.666 ms y 10.033 ms.
Las lecturas automáticas de recuperación devolvieron HTTP 200, conservaron la
misma UUID y no presentaron el snapshot anterior como fresco. No se realizó un
tercer intento ni se abrió otra intención.

## Causa raíz general

Kalshi no estaba caído ni había superado el límite de respuesta. Una lectura
independiente del endpoint exacto
`/trade-api/v2/series?include_product_metadata=true&include_volume=true`
produjo:

| Evidencia | Resultado |
|---|---:|
| HTTP | 200 |
| Tiempo total | 4,54 s |
| Bytes | 17.286.505 |
| Series | 13.545 |
| Cursor | `null` |
| Límite configurado | 24.000.000 bytes |
| Series seleccionadas por la política vigente | 410 |
| Términos de entidad | 83 |

El problema estaba después de la descarga y antes del primer checkpoint. La
Edge creaba las 13.545 proyecciones ordenadas y llamaba a `sha256Hex` con el
objeto global completo. Ese helper debe construir primero todo el JSON canónico,
incluidos arrays de descriptores y cadenas intermedias, y después codificarlo
otra vez para SHA-256.

La reproducción exacta alcanzó 273,1 MB durante `canonical_hash`. Supabase
limita una Edge alojada a 256 MB. El runtime terminó el worker con HTTP 546, una
clase de fallo no capturable por el `try/catch`; por eso no aparecieron ni
`defer_market_radar_provider_discovery_v2` ni el primer checkpoint. El proveedor
ya había respondido, pero JavaScript no recuperó el control.

La clase general es materializar un documento canónico global de tamaño
variable antes de hashearlo. No depende de una serie, mercado, ticker, título,
categoría o respuesta concreta de Kalshi.

## Corrección

`sha256KalshiCatalogProjectionV1` alimenta un digest SHA-256 incremental:

1. escribe las cuatro claves del sobre en orden canónico UTF-16;
2. canoniza y añade una sola proyección cada vez;
3. valida que los tickers sean no vacíos, únicos y estrictamente ordenados;
4. cierra el array y obtiene el digest hexadecimal.

El contrato no cambia. La salida es byte-equivalente a
`sha256Hex({ entity_policy_version, entity_terms_hash, projection_version,
series })`; por tanto, no cambia la versión de proyección, el hash esperado, la
selección, la evidencia SQL ni la reanudación durable. No hace falta una nueva
migración.

Sobre el mismo catálogo real:

| Fase | Antes | Después |
|---|---:|---:|
| Pico del sellado | 273,1 MB | 149,9 MB |
| Pico de toda la transformación | 273,1 MB | 172,8 MB |
| Margen frente a 256 MB | -17,1 MB | 83,2 MB |

## Pruebas

- 17/17 pruebas específicas de catálogo y checkpoint V2.
- 334/334 regresiones focales de Radar, familias, fuentes, elegibilidad,
  resumibilidad, Expert, Editor, Validator y Corrector.
- Equivalencia exacta entre digest incremental y canonicalización original con
  137 series, Unicode, apóstrofes, subtítulos, guiones y números.
- Rechazo de proyecciones desordenadas o con identidad repetida.
- Perfil live: 13.545 proyecciones, 410 seleccionadas, pico final 149,9 MB.
- `deno check` de `market-radar` con Deno 2.1.14: verde.
- Sintaxis JavaScript de los archivos modificados: verde.
- `git diff --check`: verde.

La suite completa de 615 pruebas, las 9 Edge y los 21 contratos SQL ya estaban
verdes para la base exacta y no se repiten porque esta corrección no modifica
SQL, frontend, contratos de dominio ni otras Edge. Calidad de Atinara debe
repetir sus puertas sobre el SHA que integre este paquete.

## Límites del cambio

No hay migración nueva, DML, backfill, frontend, secretos, cambio de Auth,
Registry, AI Gateway, tareas, rutas, modos, modelos, flags, presupuestos, Karma,
Prestigio, LMSR, mercados, predicciones o borradores. Radar continúa con cero
inferencias y sin Gemini. No se despliega ninguna Edge diferente de
`market-radar`.

La estrategia B2B-first permanece intacta. Esta corrección solo elimina el
bloqueo real que impide cerrar Radar/Discover.

## Continuación después de la subida

1. Ejecutar `git fetch --all --prune` y exigir exactamente el inventario del
   manifiesto, sin eliminaciones ni archivos adicionales.
2. Comparar contenido remoto y local y exigir Calidad de Atinara, Pages y
   Benchmark IA offline verdes sobre el mismo SHA. No usar Sonar.
3. Crear una worktree limpia desde el nuevo `origin/main`.
4. Confirmar que la migración V2 sigue aplicada una sola vez y que las demás
   Edge y datos protegidos no cambiaron.
5. Desplegar únicamente `market-radar` desde ese `origin/main`, con
   `verify_jwt=true`; verificar versión, digest y bundle.
6. No crear otra UUID. Cuando el lease y el contrato lo permitan, continuar
   exclusivamente `39bc204b-aa3f-4a69-99da-557f5fa91f7d`.
7. Exigir checkpoint inicial, catálogo sellado, lotes de series, padres, hijas,
   manifest, batches de candidatas, finalización y replay.
8. Solo entonces elegir una candidata fresca y válida, ejecutar una sola ruta
   Expert/Editor y crear exactamente un borrador privado.
9. No confirmar, publicar, programar, resolver ni liquidar.
