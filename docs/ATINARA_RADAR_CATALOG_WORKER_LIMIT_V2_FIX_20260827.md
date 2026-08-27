# Atinara · segunda corrección del límite del worker del catálogo global

Fecha: 27 de agosto de 2026

Base exacta: `a6152a76b4d966f67ece6f6e8b72dcd0f5400034`

Estado: corrección general verificada en local; pendiente de subida por Yol,
Actions verdes y despliegue exclusivo de `market-radar`.

## Checkpoint productivo protegido

Producción conserva `market-radar` v75, `ACTIVE`, `verify_jwt=true`, digest
`7a831f3ce6b91480515b82f0f3c74a1aaf2e8e62160ae2a650a75e54f9372555`.
La migración V2 continúa aplicada exactamente una vez como
`20260827150224_checkpoint_market_radar_global_catalog_v2`. Expert v26,
Corrector v25, Validator v34 y Resolución v16 no cambiaron.

La única UUID es `39bc204b-aa3f-4a69-99da-557f5fa91f7d`. Sus dos intenciones
están `in_progress/claimed`, `claim_count=4`, lease vencido y conservan cero
checkpoints V2, batches, manifest, candidatas y borradores. Solo hay cuatro
eventos append-only y SQL confirma una única `request_id` desde que comenzó.
No debe reintentarse con v75.

## Causa raíz general

V75 eliminó la doble clasificación y el array global de proyecciones, pero la
medición usada para aprobarlo partía de un objeto JSON ya materializado. La
ruta real todavía:

1. leía el body de aproximadamente 17 MB por fragmentos;
2. decodificaba cada fragmento a string;
3. retenía todos los strings;
4. los unía en una segunda representación completa;
5. ejecutaba `JSON.parse` antes del análisis y del hash.

El perfil de ruta completa sobre 13.559 series midió aproximadamente 2.407 ms
CPU y 285 MB RSS. Los límites alojados son 2 s CPU por petición y 256 MB por
isolate. El `POST` v75 terminó HTTP 546 en 6.041 ms antes del primer checkpoint;
la recuperación posterior respondió 200. Kalshi estaba sano, entregó HTTP 200
y cursor terminal. La clase de fallo es materialización duplicada de un body
JSON grande antes de un checkpoint durable, no una serie o ticker concretos.

## Corrección

### Lectura JSON acotada y nativa

`readProviderResponseJson` conserva el límite fail-closed de 24 MB:

- rechaza anticipadamente un `content-length` declarado superior;
- cuenta los bytes reales con `TransformStream<Uint8Array, Uint8Array>`;
- aborta el stream en cuanto supera el máximo;
- entrega el stream acotado a `Response.json()` para el parser nativo;
- traduce cuerpos inválidos a `PROVIDER_INVALID_RESPONSE` sin exponer payload;
- conserva `PROVIDER_RESPONSE_TOO_LARGE` como error distinguible.

No existe array de strings ni `chunks.join`. El mismo lector se aplica de forma
general a las respuestas JSON de proveedores.

### Análisis compacto del catálogo

La política temática, patrones, stopwords y autoridades no cambian. El análisis:

- normaliza el título una sola vez;
- representa las ocho señales mediante bits;
- conserva una `Uint16Array` y textos preparados en lugar de objetos por fila;
- materializa arrays de señales y clasificación completa solo para seleccionadas;
- usa sets de hosts por etiquetas, manteniendo exactos y subdominios válidos sin
  aceptar sufijos impostores;
- sigue derivando entidades hermanas desde el catálogo acreditado completo.

### Sellado V2 sin objetos canónicos por fila

`sha256KalshiCatalogProjectionV2` consume una sola vez un iterable ordenado de
tuplas. Cada tupla conserva ticker, título, categoría, tags, scope, información
importante, fuentes de liquidación, volumen y última actualización. El helper
valida forma, identidad no vacía y orden estricto.

La versión cambia de `atinara-kalshi-series-catalog-projection-v1` a
`atinara-kalshi-series-catalog-projection-v2`: el hash resultante es nuevo por
diseño, aunque la evidencia material sellada sea la misma. V1 permanece
disponible para compatibilidad y pruebas. Esta UUID todavía no tiene ningún
checkpoint V2, por lo que no se reescribe historia ni se requiere migración.

## Perfil live posterior

Dos lecturas consecutivas del endpoint exacto
`/trade-api/v2/series?include_product_metadata=true&include_volume=true` dieron:

| Evidencia | Ejecución A | Ejecución B |
|---|---:|---:|
| HTTP | 200 | 200 |
| Bytes | 17.306.369 | 17.306.369 |
| Series | 13.561 | 13.561 |
| Cursor | `null` | `null` |
| Términos | 84 | 84 |
| Seleccionadas | 416 | 416 |
| CPU total perfilada | 1.563 ms | 1.501 ms |
| RSS máximo Node | 166 MB | 166 MB |

Deno 2.1.14 completó la misma ruta; el proceso diagnóstico completo consumió
1.891 ms CPU incluyendo el arranque del proceso. Esta evidencia local reduce
CPU y memoria por debajo de los límites, pero no sustituye el smoke alojado.

## Pruebas

- 618/618 pruebas unitarias.
- 19/19 pruebas focales de catálogo global y checkpoint V2.
- Hash V2 equivalente al Canonical JSON de la misma estructura con 137 filas,
  Unicode, apóstrofes, subtítulos, guiones y números.
- Iterable de una sola pasada y rechazo de forma, identidad u orden inválidos.
- Equivalencia del análisis conjunto frente a clasificación unitaria.
- Host oficial válido y sufijo impostor cubiertos.
- 1, 3, 21, 48 y 100+ series, timeout, provider_unavailable, reanudación,
  pertenencia y pérdida de página cubiertos por la suite vigente.
- 9/9 Edge Functions con Deno 2.1.14.
- Sintaxis válida en 134 archivos JavaScript.
- 21 contratos SQL estáticos; sin ejecución SQL porque no cambia SQL.
- Canonicalización Node/Deno idéntica.
- TypeScript verde.
- `git diff --check` verde.
- Sonar no se ejecutó.

## Límites del paquete

No contiene migración, DML, backfill, frontend, secreto ni cambio de Auth,
Registry, AI Gateway, tarea, ruta, modo, modelo, flag, presupuesto, Karma,
Prestigio, LMSR, mercado, predicción o borrador. Radar continúa sin Gemini.
Solo debe desplegarse `market-radar`, siempre con `verify_jwt=true`.

## Continuación después de la subida

1. Ejecutar `git fetch --all --prune` y comparar el rango desde `a6152a7`.
2. Exigir exactamente las diez rutas del manifiesto y contenido idéntico.
3. Exigir Calidad de Atinara —incluido Deno—, Pages y Benchmark IA offline
   verdes para el nuevo SHA. No usar Sonar.
4. Crear una worktree limpia desde el nuevo `origin/main`.
5. Confirmar baseline, migración V2 una vez, v75 y demás Edge sin cambios.
6. Desplegar exclusivamente `market-radar` con JWT obligatorio.
7. Continuar exclusivamente `39bc204b-aa3f-4a69-99da-557f5fa91f7d`; no crear
   otra UUID ni reiniciar el refresh.
8. Exigir catálogo, checkpoint, series, padres, hijas, manifest, batches,
   finalización y replay antes de Market Expert.
9. Crear exactamente un borrador privado desde una candidata fresca y válida.
   No confirmar, programar, publicar, resolver ni liquidar.
