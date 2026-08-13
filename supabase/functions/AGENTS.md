# Instrucciones para Edge Functions y Agent Engine de Atinara

Estas instrucciones amplían `AGENTS.md` para todo `supabase/functions/`.

## Lectura obligatoria

Antes de editar en esta carpeta, lee:

1. `AGENTS.md` raíz.
2. `SECURITY.md`.
3. `docs/ATINARA_AGENT_ENGINE.md`.
4. `docs/ATINARA_AI_GATEWAY.md`.
5. `docs/ATINARA_AGENT_ENGINE_V2_RUNBOOK.md`.
6. `docs/ATINARA_RPC_DEPENDENCY_MATRIX.md` cuando la ruta afecte RPC o persistencia.

Verifica el estado actual antes de repetir versiones productivas documentadas.

## Estado y límites vigentes

- Agent Engine V2.1 está desplegado, pero todas las tareas continúan en `legacy_direct` en el corte documentado.
- `gateway_gemini_parity`, `gateway_routing`, OpenRouter y NVIDIA NIM permanecen apagados hasta promoción expresa.
- No cambies modos, flags, presupuestos, modelos, secretos, canary, benchmark live o proveedores sin autorización nueva.
- No despliegues Edge Functions desde una tarea local salvo autorización específica para esa mutación.
- Mantén `verify_jwt=true` y revalida administradora en servidor en las funciones protegidas.

## Contratos que no pueden romperse

- Toda inferencia nueva pasa por `supabase/functions/_shared/ai/`.
- La Edge de dominio no elige ruta, modelo, schema, timeout, bytes, retry, fallback, presupuesto ni fingerprint.
- Sanitiza por allowlist recursiva y rechaza PII, sesiones, JWT, secretos, Karma, Prestigio, posiciones y predicciones privadas fuera de contrato.
- Fallback solo por fallo técnico; nunca por rechazo, abstención o confianza baja.
- Runtime, herramientas, fetches, Gateway y persistencia comparten un deadline absoluto.
- Tool Registry, Strategy Registry y bindings deben corresponder con SQL, versión y huella.
- Un solo writer por ronda. Editor no escribe. Corrector usa writer autoritativo, CAS e idempotencia.
- Runs, steps e intentos son append-only y no guardan prompts, payloads crudos, respuestas ni razonamiento.
- `technical_hold` y errores reintentables no son resultados terminales.
- Un fallo de telemetría no cambia un resultado válido ni repite la inferencia.
- Ningún agente confirma humanamente, publica, programa, resuelve, liquida o modifica economía.

## Proveedores y red

- Las pruebas normales usan `ATINARA_EXTERNAL_AI_DISABLED=1` y cero red externa.
- No reemplaces el modelo exacto por otro de nombre parecido.
- No hagas capability discovery live, smoke, shadow o canary sin autorización.
- No leas valores de secretos. Como máximo comprueba nombres o presencia cuando el alcance lo autorice.
- Valida hosts, redirecciones, tamaño, timeout, abort, errores y respuesta estructurada.

## Pruebas mínimas

Cuando aplique, ejecuta:

```powershell
$env:ATINARA_EXTERNAL_AI_DISABLED='1'
npm run test:syntax
npm run test:unit
npm run test:monitoring-config
npm run test:edge
npm run test:sql:static
npm run benchmark:offline
git diff --check
```

Añade regresiones de contrato, deadline, abort, bytes, schema, policy, budget, retry, idempotencia, single-writer, snapshot stale, no progreso y fallo de telemetría según el cambio.

## Revisión obligatoria

- Rechaza inferencias directas nuevas fuera del Gateway.
- Rechaza secrets, payloads, prompts, PII o errores crudos en logs o telemetría.
- Rechaza cualquier ruta que convierta fallo técnico en decisión de mercado.
- Rechaza bypass de confirmación humana, doble writer, huellas incompatibles o retries con doble efecto.
- Rechaza deploys o cambios de modo presentados como consecuencia automática de una implementación local.
