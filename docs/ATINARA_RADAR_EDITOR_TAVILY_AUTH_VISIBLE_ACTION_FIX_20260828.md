# Atinara · autenticación Tavily y acción visible del Editor

Fecha: 2026-08-28
Base: `65efed3af0abfedecedfc5c8d74b5f9fcef46f72`

## Incidencias reproducidas

El E2E productivo del Radar y el Editor permitió crear un único borrador privado,
pero la recuperación de elegibilidad quedó en
`ELIGIBILITY_SCAN_UNAVAILABLE`. La telemetría demostró que la búsqueda oficial
de Tavily no devolvía resultados aunque el proveedor figuraba configurado.

Además, la acción visible del Corrector dependía de `window.confirm`. En Chrome,
el diálogo nativo podía quedar fuera del árbol DOM y bloquear la automatización
sin iniciar una llamada ni persistir un intento. La experiencia observable era
equivalente a «clic y nada».

## Causa raíz y clase general

1. `market-radar` y `market-expert` conservaban el contrato antiguo que enviaba
   `api_key` dentro del JSON. La API vigente de Tavily autentica mediante
   `Authorization: Bearer <token>`. Es una incompatibilidad general de contrato
   con el proveedor, no un defecto específico de GTA VI ni de una candidata.
2. La confirmación de reparación estaba fuera del estado renderizado de la
   aplicación. Es una falta general de observabilidad y control de concurrencia
   de acciones administrativas, no un problema del borrador utilizado.

Referencia del contrato de Tavily:
`https://docs.tavily.com/documentation/api-reference/endpoint/search`.

## Corrección

- Radar y Market Expert envían la credencial solo en la cabecera Bearer y nunca
  dentro del payload.
- Radar distingue un rechazo 401/403 como `PROVIDER_AUTH_FAILED`, con mensaje
  público seguro y sin degradar ese error a una conclusión de dominio.
- La telemetría de búsqueda conserva un código de fallo seguro, sin clave,
  payload ni respuesta del proveedor.
- El Corrector sustituye el diálogo nativo por una confirmación DOM accesible
  con estados explícitos de pendiente, cancelado, procesando, éxito o error.
- Un guard `repairInFlight` impide doble envío. Cancelar no llama a la Edge ni
  modifica el borrador.
- Las diez páginas que comparten recursos públicos usan una única versión de
  caché para impedir mezclas de frontend antiguo y nuevo.

No se modifica ninguna migración, RPC, política, modelo, presupuesto, secreto,
economía, mercado, predicción ni dato productivo. No se cambia el contrato de
publicación y ninguna acción confirma, programa, publica, resuelve o liquida.

## Puertas locales antes de integración

- 626/626 pruebas unitarias.
- 162/162 pruebas focalizadas de Radar, elegibilidad, Expert, Editor,
  materialización, idempotencia y resumibilidad.
- Browser workflow: 19 escenarios, viewports 390/768/1366, cero llamadas
  externas y cero intentos bloqueados.
- Sintaxis válida en 135 archivos JavaScript.
- 21 contratos SQL estáticos.
- 9/9 Edge Functions comprobadas con Deno 2.1.14.
- Canonical JSON v1 idéntico en Node y Deno.
- Benchmark offline: 5/5 contratos técnicos, cero llamadas externas.
- TypeScript y `git diff --check` válidos.

## Activación pendiente

La entrega debe integrarse primero en `origin/main` y superar Calidad de
Atinara, Benchmark IA offline y GitHub Pages para ese SHA. Después deben
desplegarse únicamente `market-radar` y `market-expert`, ambas con JWT
obligatorio. El frontend se activa solo mediante Pages. No existe migración
nueva y no debe desplegarse la Edge `market-draft-fixer`, cuyo código no cambia.

La verificación productiva debe reanudar el mismo borrador y la misma candidata,
sin crear otra UUID Radar ni otro borrador. Solo entonces podrá documentarse el
cierre definitivo del hito.
