# Atinara · integración segura del Radar Full Theme

Fecha: 27 de agosto de 2026

Base exacta: `8caaa4787f09604a8f3e7ff535e6c418f75f7b2f`

Estado: corrección incremental local; pendiente de subida y de una nueva
ejecución verde de Calidad de Atinara antes de cualquier cambio productivo.

## Alcance

Integrar el paquete Radar Full Theme, construido sobre `8025df4`, con las
subidas que Yol realizó antes de cargar ese ZIP. La corrección conserva el
código funcional de ambos lados, repara tres artefactos compartidos que el
reemplazo manual dejó basados en el corte anterior y adapta una ordenación a la
puerta de determinismo añadida después de esa base.

La nueva estrategia B2B de `01351db` permanece intacta y autoritativa. Esta
entrega no implementa ninguna función B2B: su único objetivo es dejar cerrado
el checkpoint Radar para que Yol pueda abrir esa fase después en otra
conversación.

## Evidencia remota

- `origin/main` fue obtenido con `git fetch --all --prune` y quedó en
  `8caaa4787f09604a8f3e7ff535e6c418f75f7b2f`.
- El último commit contiene exactamente las diez rutas declaradas por el ZIP,
  sin archivos adicionales ni eliminaciones.
- El contenido de esas diez rutas coincide byte por byte con el commit local
  preservado `a10791257ffa5d95e8b498e3c9f639ed0c07202a`.
- Entre la base y el upload final existen los commits `8768ab4`, `87a635e`,
  `4a3036a`, `c9eb88c`, `adbe3ba` y `01351db`.
- Pages y `Benchmark IA offline` terminaron en `success` para `8caaa47`.
- `Calidad de Atinara` terminó en `failure` dentro de “Validar JavaScript y
  pruebas”; el paso Deno quedó `skipped`.
- GitHub Pages sirve `v=20260826-live-market-chart-limit1`, pero la regresión
  reemplazada por el ZIP esperaba
  `v=20260825-radar-provider-checkpoint1`.
- La suite completa local reveló además que el nuevo catálogo ordenaba sus tags
  mediante `.sort()` sin comparador. Una regresión de calidad incorporada en
  las subidas intermedias exige comparador explícito en código productivo.

No se ejecutó Sonar.

## Causa raíz

La entrega Full Theme era internamente exacta, pero su base era anterior a las
subidas intermedias. GitHub recibió archivos completos, no una fusión de tres
vías. Tres rutas se habían modificado en ambos lados:

1. `ORAKLO_PROJECT_CONTEXT.md`: el upload conservó el nuevo checkpoint Radar,
   pero retiró el estado de gráfica/límite y Corrector/Validator.
2. `README.md`: ocurrió la misma pérdida documental y reaparecieron versiones
   productivas antiguas.
3. `tests/market-radar.test.js`: reapareció la expectativa de la release de
   caché anterior aunque `admin-markets.html` ya usa la release nueva.

Una fusión de tres vías confirma conflictos solo en los dos documentos. El test
se fusiona limpiamente. El código Radar, la migración V2, la estrategia B2B y
los cambios funcionales intermedios no entran en conflicto. La única adaptación
de código necesaria es sustituir la ordenación implícita de tags por
`compareUtf16Text`, el comparador binario ya utilizado por el mismo módulo.

## Corrección

- restaurar las versiones productivas Corrector v25 y Validator v34 y los
  hechos auditados del Corrector por campos;
- restaurar la gráfica temporal, el límite global de 1.000 Karma y su release
  coordinada;
- conservar íntegro el catálogo global Kalshi y el checkpoint durable V2;
- alinear el test de interfaz con la release que el frontend y Pages sirven;
- ordenar los tags del fingerprint con el comparador binario UTF-16 explícito;
- registrar este incidente de composición y su inventario exacto.

Solo cambia una expresión del bundle `market-radar`; no altera selección,
normalización, red, tiempos, persistencia ni autoridad. No cambia migración,
frontend, otras Edge, Auth, secretos, Registry, AI Gateway, modelos, rutas,
modos, flags, presupuestos, Karma, Prestigio, LMSR, mercados, predicciones o
borradores. No aplica DML, backfill ni despliegue. No llama Market Expert y
Radar continúa sin Gemini.

## Puertas de validación

Antes de crear el ZIP se deben comprobar:

- regresión focal de `tests/market-radar.test.js`;
- clasificación/checkpoint global V2;
- suites transversales afectadas Radar → elegibilidad → Expert → Editor;
- sintaxis JavaScript proporcional;
- Deno de las nueve Edge Functions;
- contratos SQL estáticos;
- `git diff --check` e inventario exacto.

Resultado local de esta entrega:

- 615/615 pruebas unitarias;
- 79/79 pruebas focales de `market-radar`;
- 16/16 pruebas del clasificador y checkpoint global V2;
- 9/9 Edge Functions con Deno 2.1.14;
- sintaxis válida en 133 archivos JavaScript;
- 21/21 contratos SQL estáticos;
- canonicalización idéntica en Node y Deno, incluidas 13 huellas de dominio,
  10 golden cases y el SHA binario
  `14141cffbafc63c88d3468cf5e5fcfc139597f0ac4b2f7b28a8951c0e35ede8e`;
- benchmark offline 5/5 con `externalNetworkCalls=0`;
- `git diff --check` verde y cero marcadores de conflicto.

La ejecución SQL real no se repite porque este incremental no modifica SQL y
el entorno no tiene una base PostgreSQL desechable configurada. El typecheck de
Checkly tampoco se repite porque no hay dependencias instaladas y ningún archivo
Checkly o `tsconfig` cambia; Deno sí valida el grafo completo de las nueve Edge.
Ambas puertas remotas permanecen obligatorias dentro de Calidad de Atinara.

La subida posterior debe volver a exigir, sobre el mismo SHA, Calidad de
Atinara con Deno, Pages y benchmark offline verdes. Si cualquiera falla, no se
aplica la migración V2 y no se despliega `market-radar`.

## Continuación autorizada después de CI verde

1. Crear una worktree limpia desde el nuevo `origin/main`.
2. Tomar baseline productivo de solo lectura.
3. Aplicar una sola vez
   `20260826190000_checkpoint_market_radar_global_catalog_v2.sql` y verificar
   RLS, ACL, funciones e historial.
4. Desplegar únicamente `market-radar` con `verify_jwt=true`.
5. Ejecutar exactamente un refresh Kalshi fresco y continuar solo su UUID hasta
   catálogo, series, padres, hijas, manifest, batches, finalización y replay.
6. Elegir una candidata fresca que supere todas las puertas y crear exactamente
   un borrador privado mediante Market Expert/Editor.
7. No confirmar, publicar, resolver ni liquidar.
