# Atinara · recuperación de fuentes oficiales y retry visible del Editor

Fecha: 2026-08-28
Base: `04b4f9de5b2fec1056d8abadacd08cd5006b02d3`
Corte funcional integrado: `b160e30752ad0abb69e361c6f9081d69dad5b897`

## Incidencia reproducida

Tras activar la autenticación Bearer vigente, la revalidación productiva de la
candidata elegida siguió terminando en `ELIGIBILITY_SCAN_UNAVAILABLE`. La
telemetría autoritativa ya no mostraba un rechazo de autenticación: Tavily
respondía `HTTP 432`, que su contrato documenta como agotamiento del uso del
plan. La búsqueda devolvía cero URLs y el escaneo oficial quedaba técnicamente
incompleto aunque la candidata declaraba una fuente de resolución oficial.

Además, el frontend no distinguía completamente entre un transporte ambiguo y
una respuesta autoritativa fallida. En el primer caso podía perder el
identificador idempotente de recuperación. Dos prechecks de elegibilidad previos
a publicación también absorbían el error mediante `.catch(() => null)`, por lo
que una acción podía continuar sin explicar la causa real.

## Causa raíz y clase general

1. La elegibilidad dependía de que el buscador externo encontrara una ruta
   profunda aun cuando el proveedor ya había declarado una autoridad oficial.
   Una cuota, timeout o respuesta vacía del enriquecedor auxiliar impedía usar
   el contrato oficial de forma segura. Es una dependencia temporal general de
   discovery, no un defecto de una candidata concreta.
2. La recuperación del frontend trataba como equivalentes la ausencia de
   respuesta autoritativa y una respuesta con `attempt_id`. Es una pérdida
   general de idempotencia observable ante transporte ambiguo.
3. Los prechecks absorbidos convertían un fallo tipado en un avance opaco. Es
   una clase general de no-op o continuación silenciosa en acciones sensibles.

Referencia del contrato de Tavily:
`https://docs.tavily.com/documentation/api-reference/endpoint/search`.

## Corrección general

- Cuando Tavily no está disponible, falla o devuelve cero resultados, Radar
  deriva un conjunto pequeño y acotado de rutas same-origin desde la identidad
  normalizada y la URL de resolución declarada por el proveedor.
- Las rutas derivadas nunca son evidencia por sí mismas. Deben responder por
  HTTPS, pertenecer a una autoridad registrada, respetar límites de tamaño y
  deadline, superar el contrato exacto de identidad y no contener prueba
  terminal contradictoria.
- La derivación no contiene títulos, tickers, series, hosts ni mercados
  concretos. Cubre identidades completas y siglas inequívocas conservando un
  sufijo romano o numérico exacto; una sigla o secuela distinta falla cerrada.
- Tavily sigue siendo el enriquecedor preferido. La telemetría conserva por
  separado contratos directos, URLs halladas, sondas de identidad y el código
  técnico seguro del proveedor.
- El frontend conserva el mismo `operation_id` tras un transporte ambiguo y
  solo lo rota cuando la respuesta autoritativa devuelve el `attempt_id`
  correspondiente.
- Los estados de recuperación se anuncian mediante región viva accesible e
  indican intento, preservación del estado y posibilidad de retry sin mostrar
  errores técnicos crudos.
- Los prechecks de elegibilidad previos a publicación ya no se absorben. Un
  fallo detiene la acción y pasa por el manejo visible existente.
- Las diez páginas que comparten recursos públicos usan una única versión de
  caché para evitar mezclar el frontend anterior con el corregido.

No se modifica ninguna migración, RPC, secreto, presupuesto, modelo, economía,
mercado, predicción ni dato productivo. No se reduce ninguna puerta factual y
ninguna acción confirma, programa, publica, resuelve o liquida.

## Puertas locales

- 630/630 pruebas unitarias.
- Regresiones de autoridad oficial: caída, cuota o cero resultados; identidad
  completa; sigla inequívoca; sufijo exacto; sigla corta y secuela incorrecta.
- Browser workflow: 19 escenarios, viewports 390/768/1366, cero llamadas
  externas y cero intentos bloqueados.
- Transporte ambiguo reutiliza el mismo identificador; una respuesta
  autoritativa fallida muestra el bloqueo y permite un identificador nuevo.
- Sintaxis válida en 136 archivos JavaScript.
- Canonical JSON v1 idéntico en Node y Deno.
- TypeScript válido.
- 21 contratos SQL estáticos; no hay migración que ejecutar.
- 9/9 Edge Functions comprobadas con Deno 2.1.14.
- Benchmark offline: 5/5 contratos técnicos, cero llamadas externas.
- `git diff --check` válido.

## Plan de activación previo al cierre · histórico

Antes del cierre, la entrega debía integrarse primero en `origin/main` y superar
Calidad de Atinara, Benchmark IA offline y GitHub Pages para ese SHA. Después
debía desplegarse únicamente `market-radar`, con JWT obligatorio. El cambio
compartido solo alteraba lógica invocada por Radar; en ese plan,
`market-expert` continuaba consumiendo del módulo únicamente la constante de
versión y no necesitaba redespliegue. El frontend se activaría mediante Pages.

La verificación productiva debía reutilizar el intento de elegibilidad ya
persistido cuando correspondiera, recuperar la ligadura del único borrador
privado existente y demostrar idempotencia. El plan prohibía crear otra UUID
Radar, otra candidata E2E u otro borrador. Esta sección conserva la secuencia
previa como historia; el resultado final se registra a continuación.

## Cierre operativo verificado

- El corte funcional integrado del cierre Radar es
  `b160e30752ad0abb69e361c6f9081d69dad5b897`.
- La verificación operativa final dejó `market-radar` v79 y `market-expert` v30.
- La única UUID del expediente es
  `39bc204b-aa3f-4a69-99da-557f5fa91f7d`; no se inició otra y el discovery
  durable quedó completado.
- Se creó exactamente un borrador privado en este expediente:
  `4f5a0260-6e42-4bc3-9dcb-1d01e47f2568`. Su persistencia es evidencia acotada
  del puente Radar/Editor, pero no representa un E2E funcional perfecto ni una
  publicación.
- Radar/Editor queda cerrado operativamente. Las puertas de revisión,
  confirmación humana y publicación permanecen separadas y no se rebajan.
- `RISK-RADAR-SOURCE-001` queda aceptado con estado exacto
  `accepted / non-blocking / fail-closed`: no bloquea el cierre y cualquier
  evidencia de fuente insuficiente sigue deteniendo el avance.
- Radar pasa a mantenimiento. Solo se reabre por bug crítico, seguridad o
  pérdida de datos.
- El roadmap B2B queda desbloqueado para la siguiente decisión de Yol. Este
  cierre no declara superadas las puertas B2B ni autoriza por sí mismo cambios
  de producto o producción.
