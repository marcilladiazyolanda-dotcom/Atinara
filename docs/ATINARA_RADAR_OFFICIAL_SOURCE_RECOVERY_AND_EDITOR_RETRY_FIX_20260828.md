# Atinara · recuperación de fuentes oficiales y retry visible del Editor

Fecha: 2026-08-28
Base: `04b4f9de5b2fec1056d8abadacd08cd5006b02d3`

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

## Activación pendiente

La entrega debe integrarse primero en `origin/main` y superar Calidad de
Atinara, Benchmark IA offline y GitHub Pages para ese SHA. Después debe
desplegarse únicamente `market-radar`, con JWT obligatorio. El cambio compartido
solo altera lógica invocada por Radar; `market-expert` continúa consumiendo del
módulo únicamente la constante de versión, que no cambia, y no necesita
redespliegue. El frontend se activa mediante Pages.

La verificación productiva debe reutilizar el intento de elegibilidad ya
persistido cuando corresponda, recuperar la ligadura del único borrador privado
existente y demostrar idempotencia. No se crea otra UUID Radar, otra candidata
E2E ni otro borrador. README y contexto se actualizarán solo con la versión,
digest, SHA y evidencias finales realmente observadas.
