# Atinara · segunda corrección del límite del worker del catálogo global

Fecha: 27 de agosto de 2026

Base exacta: `a6152a76b4d966f67ece6f6e8b72dcd0f5400034`

Estado: integrada en
`4177f84f2c34b93da6fe4b2b4aa90ff13a141328`; sus tres Actions están verdes.
No debe desplegarse tal cual: la puerta previa a producción detectó una
discrepancia de versión del hash y preparó una corrección compatible desde ese
SHA.

## Checkpoint productivo protegido

Producción conserva `market-radar` v75, `ACTIVE`, `verify_jwt=true`, digest
`7a831f3ce6b91480515b82f0f3c74a1aaf2e8e62160ae2a650a75e54f9372555`.
La migración V2 continúa aplicada exactamente una vez como
`20260827150224_checkpoint_market_radar_global_catalog_v2`. Expert v26,
Corrector v25, Validator v34 y Resolución v16 no cambiaron.

La única UUID es `39bc204b-aa3f-4a69-99da-557f5fa91f7d`. Actividad productiva
posterior continuó esa misma UUID con v75 hasta cuatro checkpoints. El último
conserva 13.561 series globales, 416 seleccionadas, 87 completas, 57 fallidas
reintentables, 272 pendientes, cero agotadas y 129 padres. Kalshi está
`in_progress/fetching`, `claim_count=8`, con lease vencido; Tavily terminó
`completed/terminal`, `claim_count=5`. Continúan en cero batches, manifest y
borradores. SQL confirma una única `request_id` desde que comenzó.

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

### Sellado compacto y discrepancia detectada

`sha256KalshiCatalogProjectionV2` consume una sola vez un iterable ordenado de
tuplas. Cada tupla conserva ticker, título, categoría, tags, scope, información
importante, fuentes de liquidación, volumen y última actualización. El helper
valida forma, identidad no vacía y orden estricto.

La revisión completa de la migración demostró que ese cambio de versión no era
desplegable: `buildProviderDiscoveryCheckpointV2` almacena
`atinara-kalshi-series-catalog-projection-v1` y la RPC aplicada rechaza cualquier
otra versión. La Edge integrada en `4177f84` habría calculado bytes V2 y los
habría persistido bajo una etiqueta V1. Los checkpoints productivos existentes
son V1 reales, por lo que no deben migrarse ni reescribirse.

La corrección posterior añade
`sha256KalshiCatalogProjectionV1FromTuples`: conserva la representación compacta
y reproduce exactamente el Canonical JSON V1. Así evita objetos y ordenación de
claves por fila sin introducir una versión que SQL no conoce.

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

## Pruebas de la corrección compatible

- 619/619 pruebas unitarias.
- 20/20 pruebas focales de catálogo global y checkpoint V2.
- Hash compacto V1 idéntico al Canonical JSON V1 con 137 filas, Unicode,
  apóstrofes, subtítulos, guiones y números.
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

## Continuación después de subir la corrección de contrato

1. Ejecutar `git fetch --all --prune` y comparar el rango desde `4177f84`.
2. Exigir exactamente las rutas del nuevo manifiesto y contenido idéntico.
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
