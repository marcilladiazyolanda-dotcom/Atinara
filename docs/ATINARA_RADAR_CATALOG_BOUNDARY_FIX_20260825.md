# Radar V6 · frontera de catálogo, terminalidad pública y UI inequívoca

Fecha: 2026-08-25  
Base canónica: `5ad6ae96413c37bbecea69f4f18b391d994fa2b2`  
Proyecto productivo: `fgrblufbuywxjahpymnh`

## Resultado productivo previo

La migración de reanudación quedó aplicada como
`20260825134153_harden_radar_batch_resume_visibility_v1` y `market-radar` v61
está `ACTIVE`, con `verify_jwt=true`.

Un único click autenticado reutilizó
`2798d1af-9ccd-4b79-9be7-37d5876d9484` y completó Kalshi:

- batches 20/22/23/22/18: todos `completed` y `attempt_count=1`;
- 105 esperadas, procesadas y aceptadas;
- 0 cuarentenas y 0 fallos;
- intención terminal `partial`, `claim_count=4`;
- siete padres completos conservados;
- `KXPS6-26` aislado como `provider_unavailable` porque el endpoint histórico
  respondió `PROVIDER_RATE_LIMITED`; current y nested sí coinciden en su hija.

No se creó otra UUID ni se modificaron mercados, predicciones, perfiles,
borradores, Karma, Prestigio, estado LMSR o histórico de precios.

## Incidencia posterior al commit

La persistencia terminó correctamente, pero la respuesta visual devolvió HTTP
500. El mismo error se reprodujo con una lectura `refresh=false`, por lo que no
era un problema de batch ni de proveedor.

Los tamaños autoritativos antes de la Edge eran:

- `list_market_radar_candidates_v4`: 3.648.689 bytes, 88 filas;
- `list_market_radar_rejections_v2`: 2.894.709 bytes, 65 filas;
- reconciliaciones: 71.239 bytes.

SQL devolvía `normalized_payload`, contratos, fechas raw, evidencia, relaciones
y trazas completas; la Edge intentaba proyectar el contrato ligero solo después
de recibir y parsear más de 6,5 MB. El límite de 900.000 bytes protegía la
respuesta final, pero no la frontera PostgREST previa.

## Corrección general

La migración aditiva
`20260825160000_bound_market_radar_catalog_projection_v1.sql` crea:

- `private.market_radar_catalog_candidate_payload_v1`;
- `public.list_market_radar_candidates_v5`;
- `public.list_market_radar_rejections_v3`;
- `public.list_market_radar_parent_reconciliations_v3`.

Las RPC antiguas permanecen disponibles. Las nuevas conservan filtros, orden,
paginación por padres, identidad, elegibilidad, duplicados, issue ledger y dos
enlaces de evidencia para auditoría, pero eliminan antes de PostgREST payloads
raw, contratos completos, trazas y campos no consumidos.

Sobre el snapshot real, dentro de `BEGIN/ROLLBACK`:

- candidatas: 441.890 bytes;
- rechazos: 319.708 bytes;
- reconciliaciones: 73.417 bytes;
- total de los tres inputs: 835.015 bytes.

La Edge usa las nuevas versiones y conserva `fetched_at` para que una respuesta
antigua nunca parezca fresca.

## Resultado público conocido

El estado del proveedor y el estado factual son independientes:

```text
provider open
        +
evidencia oficial directa, exacta y terminal
        =
EVENT_ALREADY_RESOLVED
        → terminal
        → cero catálogo
        → cero Editor / Preparar
```

La regla se aplica por tipo contractual a anuncios, lanzamientos, hitos,
premios, métricas/reseñas y otros hechos verificables. Exige contenido oficial
recuperado, URL HTTPS registrada, hash, identidad exacta y afirmación directa.
Rumores, predicciones, votos, filtraciones, lenguaje modal o una fuente de otra
opción no pueden cerrar un mercado. Gemini no participa.

Producción ya demuestra:

- Madden NFL 27: 17 hijas terminales por resultado público, 4 inactivas,
  0 oportunidades;
- EA Sports FC27: 23 hijas terminales por resultado público,
  0 oportunidades;
- MLB The Show 27: 30 holds no terminales, 30 opciones auditables pero ninguna
  preparable mientras falte la comprobación vigente.

## Presentación administrativa

La sección superior pasa a llamarse «Auditoría de integridad». Cada padre
muestra por separado opciones de catálogo, preparables, terminales por resultado
público, inactivas y holds. El catálogo predictivo se titula «Oportunidades
actuales» y declara que resultados públicos, opciones inactivas y padres
incompletos nunca aparecen en él.

La cuadrícula cambia a `auto-fit` con mínimo intrínseco de 520 px. Esto elimina
la compresión de una sola familia observada en escritorio sin alterar el layout
de móvil o tableta.

Versión de recursos: `20260825-radar-catalog-bound1`.

## Evidencia previa a entrega

- 558/558 pruebas unitarias.
- 128 archivos JavaScript con sintaxis válida.
- 19/19 matrices SQL estáticas.
- 18 casos browser, 390/768/1366 px, sin overflow ni llamadas externas.
- Migración exacta y test transaccional sobre producción con `ROLLBACK`.
- `git diff --check` verde.
- Sin DML, backfill, Gemini, borradores, publicación o cambios económicos.

## Activación después de GitHub

1. `git fetch` y comparación exacta del paquete incremental con el nuevo
   `origin/main`.
2. Confirmar que `20260825160000` no está aplicada y que la intención durable
   continúa terminal 105/105.
3. Repetir fingerprints de mercados, predicciones, perfiles, borradores, Karma,
   Prestigio, LMSR e histórico.
4. Aplicar solo
   `20260825160000_bound_market_radar_catalog_projection_v1.sql`.
5. Verificar owner `postgres`, `SECURITY DEFINER`, `search_path=''`, ACL,
   cuerpos y ausencia de DML/backfill.
6. Esperar a que Pages sirva `20260825-radar-catalog-bound1`.
7. Desplegar únicamente `market-radar`, con `verify_jwt=true`.
8. Abrir Radar y usar solo `Aplicar filtros`; no iniciar otro refresh ni volver
   a continuar la intención terminal.
9. Exigir lectura HTTP 200, botón de refresh normal, 8 padres Kalshi auditados,
   paginación por oportunidades y cero candidato Madden/FC27.
10. Ejecutar smoke visual escritorio/móvil y confirmar que ninguna tarjeta se
    comprime o desborda.
11. Solo entonces retomar el E2E Radar → Editor. Yol conserva la confirmación
    humana; esta entrega no publica ningún mercado.
