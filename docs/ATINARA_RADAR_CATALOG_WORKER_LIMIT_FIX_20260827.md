# Atinara · primera corrección del límite del worker del catálogo global

Fecha: 27 de agosto de 2026

Base exacta original: `98e5eded9fdef2dd9dea0975dad73a079bcb7f6e`

Estado: integrada en `a6152a76b4d966f67ece6f6e8b72dcd0f5400034`,
Actions verdes y desplegada exclusivamente como `market-radar` v75. La
corrección eliminó el trabajo duplicado previsto, pero el smoke alojado demostró
que no resolvía por sí sola el límite de recursos. Queda supersedida para el
próximo despliegue por
`ATINARA_RADAR_CATALOG_WORKER_LIMIT_V2_FIX_20260827`.

## Activación verificada

El rango `98e5ede..a6152a7` contiene exactamente las diez rutas del ZIP original,
sin archivos extra ni eliminaciones, y sus blobs coinciden con la entrega. Para
ese SHA finalizaron en `success` Calidad de Atinara —incluido Deno—, Benchmark
IA offline y GitHub Pages.

La migración V2 permaneció aplicada una sola vez como
`20260827150224_checkpoint_market_radar_global_catalog_v2`; no se aplicó SQL.
Después del baseline se desplegó solo `market-radar`: v75, `ACTIVE`,
`verify_jwt=true`, digest
`7a831f3ce6b91480515b82f0f3c74a1aaf2e8e62160ae2a650a75e54f9372555`.
Expert v26, Corrector v25, Validator v34 y Resolución v16 no cambiaron.

## Resultado productivo preservado

La única UUID continúa siendo
`39bc204b-aa3f-4a69-99da-557f5fa91f7d`. V75 reclamó sus dos intenciones
existentes sin crear otra: ambas quedaron `in_progress/claimed`,
`claim_count=4`, lease vencido, cero checkpoints V2, cero batches, cero manifest,
cero candidatas y cero borradores. SQL conserva cuatro eventos append-only y
confirma una sola `request_id` desde el comienzo del refresh.

La escritura v75 terminó `POST /functions/v1/market-radar` HTTP 546 en 6.041 ms.
La lectura de recuperación posterior respondió HTTP 200 en 1.630 ms. Los RPC de
claim, begin, renovación de lease y lectura de checkpoints respondieron 200; no
se alcanzó `checkpoint_market_radar_provider_discovery_v2`.

## Qué resolvía esta primera fase

La implementación integrada en `a6152a7`:

- evitó clasificar dos veces todas las series;
- materializó clasificaciones completas solo para la selección temática;
- sustituyó el array de proyecciones por un iterable ordenado de una sola pasada;
- conservó la proyección y el SHA-256 V1;
- no introdujo hardcodes, migración, DML, frontend ni cambios de política.

Esos cambios eran correctos y se conservan en la segunda fase.

## Por qué la prueba anterior era insuficiente

El perfil que justificó v75 empezaba con un objeto JSON ya materializado. No
contaba el coste de leer el stream de 17 MB, decodificar cada fragmento, retener
el array de strings, unirlo y ejecutar `JSON.parse` antes del análisis.

El perfil completo posterior reprodujo el endpoint exacto con 13.559 series y
aproximadamente 17,3 MB. La ruta original de v75 consumió en torno a 2.407 ms de
CPU y alcanzó unos 285 MB RSS. Eso supera los límites alojados de 2 s CPU y
256 MB por isolate y explica el HTTP 546 antes del checkpoint. Kalshi estaba
sano, respondió 200 y entregó cursor terminal; no fue un fallo del proveedor.

## Continuación autoritativa

La causa residual y su corrección general están en
`docs/ATINARA_RADAR_CATALOG_WORKER_LIMIT_V2_FIX_20260827.md`. No debe reanudarse
la UUID con v75 ni crearse otra. Tras subir y verificar el nuevo ZIP se despliega
exclusivamente `market-radar` con JWT obligatorio y se continúa la misma UUID.

No se usó Sonar. No se modificaron migración, datos, Auth, secretos, Registry,
AI Gateway, rutas, modos, modelos, flags, presupuestos, Karma, Prestigio, LMSR,
mercados, predicciones ni borradores. Radar continúa sin Gemini.
