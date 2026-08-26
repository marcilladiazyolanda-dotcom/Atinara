# Atinara · continuidad de evidencia oficial futura en Radar

Fecha: 26 de agosto de 2026
Base exacta: `58e47a89eb639285a9b0ca27b604b8fd2c2553c0`
Estado: corrección incremental verificada en local; pendiente de integración y
despliegue exclusivo de `market-radar`.

## Objetivo

Permitir que Radar complete un escaneo de elegibilidad cuando una fuente oficial
exacta acredita que el hecho contractual sigue en el futuro, aunque falle otra
URL auxiliar del mismo grupo. La excepción es cerrada: debe cubrir a todas las
candidatas, demostrar el mismo sujeto y predicado y no rebasar la frontera de
cada hija.

No contiene migración, frontend, DML o backfill. No modifica Auth, secretos,
Registry V2.1, AI Gateway, rutas, modos, modelos, flags, presupuestos, Karma,
Prestigio o LMSR. Radar conserva cero inferencias.

## Estado productivo y evidencia

`origin/main = 58e47a89eb639285a9b0ca27b604b8fd2c2553c0` superó Calidad de
Atinara, Deno, Pages y benchmark offline. Solo `market-radar` se desplegó como
v72, `ACTIVE`, `verify_jwt=true`, digest
`5e95a578528355f92ced016d8aa1c5523d1931f00942d44679942f7d809d9116`.
Expert v26, Corrector v22, Validator v31 y Resolución v16 siguen sin cambios.

El refresh `c1f677eb-0dae-410f-820d-a4483601ab47` continúa
`completed/terminal`: 215/215 series Kalshi, cero fallidas, 590 padres
indexados, 24 seleccionados completos, 566 diferidos, 192/192 hijas
descubiertas/contabilizadas/identificadas y 162/162 candidatas procesadas y
aceptadas. Su manifest es
`085a5f169cd0f045c9ae867adba049b9b9937be1f02a79f02df6486d4537bae4`
y su finalización
`aaab476f8b372eaafcfc41b2533af878ebec28f308bf2cbe71aa860a204cf5`.

La candidata `1aa9b332-07d9-4dff-a2e3-d98a7066237e` conserva padre completo,
siete hijas, paginación agotada, proveedor abierto, ausencia de duplicado y una
revisión humana vigente `in_domain`. V72 superó esa puerta. Los dos intentos
controlados siguientes fueron:

- `0488f6b7-ee48-4cb9-853e-2b357101e64a`;
- `bc5b79e8-8338-4f09-a020-36405b32957d`.

Ambos devolvieron HTTP 503 `ELIGIBILITY_SCAN_UNAVAILABLE`. No se realizó un
tercer intento, no se llamó Market Expert y no se creó un borrador. Producción
conserva exactamente seis borradores privados.

## Causa raíz general

El fallo no era Auth, RLS, SQL, Kalshi, pérdida de hijas ni caída completa de
Tavily. El escaneo encontró seis URLs y descargó cuatro, pero persistió cero
evidencias de autoridad para el grupo. Tres defectos se combinaron:

1. Tras un verbo español, el patrón opcional de artículo probaba `a` antes que
   `another` y no exigía límite de palabra. La entidad quedaba `nother gta vi`.
2. El parser de hitos solo reconocía nombres literales y formas como
   `will be premiered`; no la expresión audiovisual equivalente
   `An Extended Look will premiere`.
3. Las fechas oficiales sin año no producían una prueba determinista. Si además
   fallaba una URL auxiliar, el grupo seguía incompleto aunque otra página
   oficial exacta anunciara el hito dentro del contrato.

La clase general afecta a cualquier proveedor, idioma mezclado, familia de
contenido oficial y página autoritativa con lenguaje natural equivalente. No
depende de GTA VI, Rockstar, Kalshi ni un ID concreto.

## Corrección

- Los artículos se evalúan de mayor a menor longitud y con límite de palabra.
  Se conserva `The` cuando forma parte del nombre propio.
- El sujeto factual de contenido oficial se deriva de la familia recién
  calculada, no de una forma persistida incorrecta.
- Tráiler, teaser y clip admiten equivalentes audiovisuales acotados solo cuando
  existe contexto de vídeo, canal, streaming o estreno. El tipo contractual no
  se mezcla con artículos editoriales ni con otro contenido.
- Los predicados futuros y terminales reconocen formas activas naturales. Una
  afirmación terminal en una frase adyacente prevalece y bloquea.
- Una fecha sin año usa el año UTC de recuperación. Solo rueda al siguiente año
  si la fecha del año actual lleva más de 180 días vencida.
- Una URL auxiliar fallida deja de bloquear únicamente si cada candidata posee
  evidencia oficial exacta, verificada y determinista, y
  `unresolved_until <= temporal_boundary`. Otro sujeto, una fecha pasada o una
  fecha posterior al cierre fallan cerrados.

El primer fallo deja la telemetría auxiliar degradada y visible; no se oculta ni
se presenta como éxito del proveedor. La cobertura oficial solo permite que la
elegibilidad continúe hasta sus puertas autoritativas restantes.

## Pruebas

- Siete suites focalizadas de Radar, fuentes, familias, resumibilidad,
  reanudación y ciclo de borrador: 219/219.
- Reconciliación exhaustiva de padres, paginación, placeholders y 1, 3, 21, 48,
  101 y 480 hijas: 58/58. Total focal ampliado: 277/277.
- Artículo mixto español/inglés sin truncamiento y preservación de nombres con
  artículo propio.
- Contenido audiovisual equivalente, otro sujeto, artículo editorial, fecha
  recién vencida, afirmación terminal y frontera contractual anterior.
- Recuperación de URL parcial solo con cobertura oficial exacta para todas las
  hijas; producción no contiene nombres de fixtures ni IDs conocidos.
- Nueve Edge Functions con Deno 2.1.14: 9/9.
- Sintaxis válida en 128 archivos JavaScript.
- `git diff --check` verde.
- La [página oficial real](https://www.rockstargames.com/newswire/article/9k2kaa1o3297k9/grand-theft-auto-vi-an-extended-look)
  respondió HTTP 200; sobre el payload exacto productivo produjo familia
  `atinara:v5:gtavi:official_content:trailer:duration-gte-30-seconds`, sujeto
  `grand theft auto vi` y prueba futura
  `2026-08-27T12:00:00.000Z`, antes del cierre contractual.

La matriz focalizada conserva además binarios, categóricas, familias de 1, 3,
21, 48 y 100+ hijas, hermanas, duplicado cross-provider, placeholders, hijas
inactivas, padres parciales o indisponibles, resultados públicos con proveedor
abierto, fuentes stale, timeouts, páginas y cursores, Unicode, caída de Tavily,
reanudación, doble clic, búsqueda vacía e identidades `option:*`/`deadline:*`.

## Activación

1. Verificar el nuevo `origin/main`, las diez rutas y su contenido exacto.
2. Exigir Calidad de Atinara, Deno, Pages y benchmark offline verdes; no usar
   Sonar.
3. Tomar baseline de solo lectura y confirmar v72, seis borradores y huellas
   protegidas.
4. Desplegar únicamente `market-radar` con `verify_jwt=true`; no aplicar SQL ni
   desplegar frontend.
5. Confirmar nueva versión, `ACTIVE`, JWT, digest e invariantes.
6. No reintentar la preparación sobre la candidata stale. Ejecutar exactamente
   un refresh Kalshi nuevo para persistir la identidad familiar corregida.
7. Revalidar una candidata fresca que conserve padre completo, paginación,
   apertura, fuentes, ausencia de resultado público y ausencia de duplicado.
8. Solo entonces ejecutar una única inferencia de Market Expert/Editor y crear
   exactamente un borrador privado.
9. Nunca confirmar, publicar, resolver o liquidar.

## Rollback y riesgos

El rollback restaura el bundle productivo v72 de `market-radar`; no hay esquema
ni datos que revertir. Si el nuevo refresh o la elegibilidad fallan, no repetir
a ciegas: conservar la UUID y diagnosticar logs, lease, evidencias, manifest y
batches antes de otro cambio.

La taxonomía audiovisual es deliberadamente acotada. Una formulación oficial
futura no reconocida seguirá en revisión técnica hasta añadir una regla general
con regresión. La identidad corregida invalida el snapshot actual, por lo que el
E2E no puede terminar sin un refresh real posterior al despliegue.
