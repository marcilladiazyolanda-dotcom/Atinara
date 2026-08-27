# Atinara · compatibilidad final del hash del catálogo Radar

Fecha: 27 de agosto de 2026

Base exacta: `4177f84f2c34b93da6fe4b2b4aa90ff13a141328`

Estado: corrección general verificada en local; pendiente de subida por Yol,
Actions verdes y despliegue exclusivo de `market-radar`.

## Bloqueo detectado antes del despliegue

El paquete de límite de worker está integrado exactamente en `4177f84` y sus
tres Actions están verdes. La lectura completa de la migración V2 descubrió un
desacuerdo que esas puertas no cubrían:

- la Edge calculaba `atinara-kalshi-series-catalog-projection-v2`;
- `buildProviderDiscoveryCheckpointV2` almacenaba la etiqueta de proyección V1;
- la RPC productiva aceptaba exclusivamente la etiqueta V1.

El hash incluye la versión en sus bytes. Por tanto, no era una diferencia de
nombre: una UUID futura habría persistido un hash V2 bajo una declaración V1 y
la evidencia no podría reproducirse con el contrato anunciado. Se bloqueó el
despliegue antes de modificar producción.

## Estado productivo protegido

Producción conserva `market-radar` v75, `ACTIVE`, `verify_jwt=true`, digest
`7a831f3ce6b91480515b82f0f3c74a1aaf2e8e62160ae2a650a75e54f9372555`.
La migración V2 sigue aplicada una sola vez como
`20260827150224_checkpoint_market_radar_global_catalog_v2`. No se aplicará otra
migración para esta corrección.

La única UUID continúa siendo `39bc204b-aa3f-4a69-99da-557f5fa91f7d`. El
checkpoint 4 conserva catálogo terminal de 13.561 series, 416 seleccionadas, 87
completas, 57 fallidas reintentables, 272 pendientes, cero agotadas y 129
padres. Su `provider_catalog_hash` es
`73f681e2938ebcd1565b22a5db8ad5862962b0823478e8bcb6906a8dac5aa94f`,
su `checkpoint_hash` es
`ebb1586aba60eb4e34507299f10eac4b4f75cd9e1ca79e63eb2cbbae7f8c54ae`
y su proyección declarada y efectiva es V1. No hay batches, manifest ni
borrador procedente de este expediente.

El baseline de lectura conserva 16 mercados, 9 predicciones, 2 perfiles, Karma
total 2.932, Prestigio total 40, 16 estados LMSR, 18 puntos de histórico, 7
borradores, 22 versiones, 46 reviews, 16 bindings, 398 candidatas, 3.306 fact
checks y 3.772 eligibility checks. Existe un único intento técnico de
eligibilidad posterior al inicio del refresh, con estado preservado y sin
materialización de borrador.

## Corrección

`sha256KalshiCatalogProjectionV1FromTuples` consume una sola vez las tuplas
compactas ya ordenadas y valida:

- nueve campos por fila;
- ticker no vacío y orden estricto;
- tipos nulos/textuales;
- tags y fuentes bien formados;
- versión V1, política de entidades y hash de términos válidos.

El serializer emite exactamente el orden canónico de claves de la proyección
V1, incluidas las estructuras anidadas de información importante y fuentes. No
materializa objetos por fila, no vuelve a ordenar sus claves y no cambia la
evidencia sellada. La Edge vuelve a declarar V1, igual que el constructor y la
RPC ya aplicada.

No se modifica ni se reescribe `sha256KalshiCatalogProjectionV2`; queda como
helper no usado. Adoptar esa versión en el futuro exigiría un contrato completo
y una migración nueva, fuera de este cierre.

## Pruebas

- 619/619 pruebas unitarias.
- 20/20 pruebas focales de catálogo global y checkpoint V2.
- Igualdad exacta entre hash V1 por objetos y hash V1 por tuplas para 137 filas
  con Unicode, apóstrofes, subtítulos, guiones y números.
- Iterable de una sola pasada; rechazo de forma u orden inválidos.
- Contrato estático que exige V1 en Edge, constructor y migración.
- 9/9 Edge Functions con Deno 2.1.14.
- Sintaxis válida en 134 archivos JavaScript.
- 21 contratos SQL estáticos.
- Canonicalización idéntica en Node y Deno.
- TypeScript verde.
- Perfil sintético de 13.561 filas: 47–110 ms CPU para el nuevo hash y unos 62
  MB RSS de proceso.
- `git diff --check` verde.
- Sonar no se ejecutó.

## Límites

No contiene migración, DML, backfill, frontend, secretos, cambios de Auth,
Registry, AI Gateway, tareas, rutas, modos, modelos, flags, presupuestos,
economía, Karma, Prestigio, LMSR, mercados, predicciones ni borradores. Radar
continúa sin Gemini. Solo podrá desplegarse `market-radar`, con
`verify_jwt=true`, después de integrar este paquete y verificar sus Actions.

## Continuación

1. Subir el ZIP incremental y verificar el nuevo `origin/main` desde `4177f84`.
2. Exigir inventario y blobs idénticos, además de Calidad, Benchmark offline y
   Pages verdes para el SHA resultante.
3. Repetir el baseline de solo lectura y confirmar que sigue existiendo una sola
   UUID.
4. Desplegar exclusivamente `market-radar`; no aplicar migraciones.
5. Reanudar exclusivamente `39bc204b-aa3f-4a69-99da-557f5fa91f7d` conforme a
   lease, cooldown y `next_action`.
6. Completar Radar y, solo después, una ruta Expert/Editor con exactamente un
   borrador privado. No confirmar, programar, publicar, resolver ni liquidar.

Si la versión corregida vuelve a caer por CPU o memoria antes de un primer
checkpoint en una UUID futura, se aplica la stop condition acordada: no crear
otra microoptimización; detenerse y diseñar unidades durables separadas para
fetch, parse y procesamiento del catálogo sin reducir integridad ni cobertura.
