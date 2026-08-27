# Atinara · catálogo global dentro del límite del worker

Fecha: 27 de agosto de 2026

Base exacta: `98e5eded9fdef2dd9dea0975dad73a079bcb7f6e`

Estado: corrección general verificada en local; pendiente de subida por Yol,
Actions verdes y despliegue exclusivo de `market-radar`.

## Incidente productivo preservado

La migración V2 continúa aplicada una sola vez como
`20260827150224_checkpoint_market_radar_global_catalog_v2`. Producción usa
`market-radar` v74, `ACTIVE`, `verify_jwt=true`, digest
`aa502e5e6c17a26f13d38e2a06892659aa7979bd9d03c766164415aec6ccb8ea`.
Ninguna otra Edge cambió.

La única UUID sigue siendo
`39bc204b-aa3f-4a69-99da-557f5fa91f7d`. Sus intenciones
`kalshi/candidate_feed` y `tavily/source_enrichment` están
`in_progress/claimed`, `claim_count=3`, lease vencido, cero checkpoints V2,
cero batches, cero manifest, cero candidatas y cero borradores. El ledger
conserva cuatro eventos previos. No hubo otra UUID.

La reanudación v74 reclamó correctamente ambas intenciones. La ruta escribió
`begin_market_radar_refresh_v2`, renovó leases y leyó los checkpoints V2/V1 con
HTTP 200. Después terminó `POST /functions/v1/market-radar` HTTP 546 en 6.216 ms,
antes de `checkpoint_market_radar_provider_discovery_v2`. La recuperación de
lectura respondió HTTP 200 en 1.483 ms y volvió a mostrar la misma UUID.

## Causa raíz general

HTTP 546 significa que el worker superó CPU o memoria. El runtime alojado limita
cada petición a 2 s de CPU y el isolate a 256 MB. V74 ya evitaba materializar el
JSON canónico global, pero todavía hacía trabajo proporcional duplicado:

1. `buildKalshiRadarCatalogEntityTermsV2` normalizaba y clasificaba todas las
   series para derivar el vocabulario;
2. la Edge volvía a clasificar todas las series con ese vocabulario;
3. retenía una proyección completa por ticker, creaba otro array ordenado y solo
   entonces lo recorría para el hash.

Sobre una captura live de 13.547 series, el perfil Deno midió 1.714 ms para
términos, 2.883 ms para proyectar y reclasificar, 100 ms para ordenar y 310 ms
para hashear. La transformación superaba aproximadamente 5 s de CPU antes del
checkpoint, además de conservar memoria innecesaria. No depende de una serie,
ticker, mercado, categoría o resultado concreto.

Kalshi no estaba caído. Las lecturas directas respondieron HTTP 200 con cursor
terminal. Durante el perfil el catálogo evolucionó de 13.547 a 13.549 series,
lo que confirma que la solución no puede depender de un recuento histórico.

## Corrección

`analyzeKalshiRadarSeriesCatalogV2` conserva la política existente pero evita el
segundo análisis completo:

- calcula metadatos y señales base una sola vez;
- deriva el mismo vocabulario con las mismas frecuencias y señales semilla;
- conserva temporalmente solo texto normalizado y señales base;
- construye temas, categoría inferida y clasificación completa únicamente para
  las series seleccionadas por señal o entidad.

La Edge ordena las filas fuente por ticker canónico y
`kalshiCatalogFingerprintProjections` produce cada proyección bajo demanda.
`sha256KalshiCatalogProjectionV1` acepta cualquier iterable síncrono, consume una
sola vez, exige tickers no vacíos, únicos y estrictamente ordenados y conserva
exactamente los bytes y SHA-256 de la proyección V1. Arrays existentes siguen
siendo compatibles.

No cambia ninguna señal, stopword, patrón, autoridad, término, categoría,
prioridad, máximo, checkpoint, política, versión de proyección, hash, cursor o
criterio de selección.

## Perfil live posterior

Una lectura nueva del endpoint exacto
`/trade-api/v2/series?include_product_metadata=true&include_volume=true`
produjo:

| Evidencia | Resultado |
|---|---:|
| HTTP | 200 |
| Bytes | 17.291.725 |
| Series | 13.549 |
| Cursor | `null` |
| Términos | 83 |
| Series seleccionadas | 411 |
| Análisis | 681 ms |
| Orden | 92 ms |
| Hash | 472 ms |
| Procesamiento total | 1.247 ms |
| RSS máximo observado | 160.002.048 bytes |

El perfil es local y no sustituye el smoke alojado. Su función es demostrar que
el trabajo CPU queda por debajo de 2 s con margen y que la memoria permanece
acotada antes de volver a consumir la UUID productiva.

## Pruebas

- 617/617 pruebas unitarias.
- 18/18 pruebas focales de catálogo global y checkpoint V2.
- Equivalencia entre análisis conjunto y términos + clasificación unitaria con
  137 series.
- Equivalencia exacta entre iterable de una sola pasada y Canonical JSON V1 con
  137 proyecciones, Unicode, apóstrofes, subtítulos, guiones y números.
- Rechazo de iterable no válido, ticker repetido o fuera de orden.
- 9/9 Edge Functions con Deno 2.1.14.
- Sintaxis válida en 134 JavaScript.
- 21 contratos SQL estáticos.
- Canonicalización Node/Deno idéntica.
- TypeScript verde.
- `git diff --check` verde.
- Sonar no se ejecutó.

## Límites

No hay migración, DML, backfill, frontend, secreto, cambio de Auth, Registry,
AI Gateway, tarea, ruta, modo, modelo, flag, presupuesto, Karma, Prestigio,
LMSR, mercado, predicción o borrador. Radar continúa sin Gemini. Solo debe
desplegarse `market-radar`, siempre con `verify_jwt=true`.

## Continuación después de la subida

1. Ejecutar `git fetch --all --prune` y comparar el rango exacto desde
   `98e5eded9fdef2dd9dea0975dad73a079bcb7f6e`.
2. Exigir únicamente el inventario del manifiesto, sin eliminaciones, y comparar
   contenido remoto con esta worktree.
3. Exigir Calidad de Atinara —incluido Deno—, Pages y Benchmark IA offline
   verdes para el nuevo SHA. No usar Sonar.
4. Crear una worktree limpia desde el nuevo `origin/main`.
5. Confirmar baseline, migración V2 una sola vez, v74 actual y las demás Edge
   sin cambios.
6. Desplegar únicamente `market-radar` con JWT obligatorio y verificar versión,
   digest y bundle.
7. No crear otra UUID. Cuando el lease lo permita, continuar exclusivamente
   `39bc204b-aa3f-4a69-99da-557f5fa91f7d`.
8. Exigir checkpoint inicial, catálogo sellado, series, padres, hijas, manifest,
   batches, finalización y replay antes de Market Expert.
9. Crear exactamente un borrador privado solo desde una candidata fresca y
   válida. No confirmar, publicar, programar, resolver ni liquidar.
