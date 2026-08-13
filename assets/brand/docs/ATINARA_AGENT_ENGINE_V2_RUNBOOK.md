# Runbook Agent Engine V2.1

Este runbook separa la implementación local de cualquier activación. No autoriza push, despliegue, migraciones remotas, cambios de secretos, flags, benchmark live, canary ni publicación de mercados.

Estado productivo verificado el 13 de agosto de 2026: las tres migraciones V2.1
están aplicadas una sola vez y las cinco Edge están activas en `legacy_direct`.
OpenRouter, NVIDIA NIM, `gateway_gemini_parity` y `gateway_routing` siguen
apagados. Cualquier paso posterior requiere una autorización nueva y expresa.

## Verificación local

Tooling fijado:

- Node 22;
- Supabase CLI `2.113.0` mediante `npx --no-install`;
- Deno `2.1.14`.

Comandos:

```powershell
$env:ATINARA_EXTERNAL_AI_DISABLED='1'
npm ci --ignore-scripts
npm run test:syntax
npm run test:unit
npm run test:monitoring-config
npm run test:edge
npm run test:sql:static
npm run benchmark:offline
npx --no-install supabase --version
git diff --check
```

Las pruebas SQL transaccionales aceptan `--execute` solo contra una base local desechable configurada expresamente mediante `ATINARA_TEST_DATABASE_URL`. `--v2-only` limita la ejecución a las tres suites nuevas cuando se valida sobre un baseline mínimo; sin esa opción se ejecutan también las regresiones v7/v8 sobre un stack local completo. `migration list` requiere un stack local o proyecto enlazado y no forma parte de la comprobación offline por defecto. Nunca apuntar esas operaciones a producción.

## Orden de migraciones

Aplicadas una sola vez en producción y en este orden; no repetir:

1. `20260812141508_harden_radar_eligibility_rls_v1.sql`.
2. `20260812141511_add_ai_gateway_telemetry_and_budgets_v1.sql`.
3. `20260812141515_add_agent_engine_v2_v1.sql`.

Antes de la primera, validar `docs/ATINARA_RPC_DEPENDENCY_MATRIX.md` y ejecutar las pruebas positivas/negativas. Las migraciones son aditivas: no editar migraciones aplicadas, no eliminar la tabla registry v1 y no retirar wrappers v1.

Supabase registra las versiones productivas como `20260813163839`,
`20260813163918` y `20260813163959`, respectivamente.

Después de aplicar en un entorno de prueba, ejecutar dentro de `BEGIN/ROLLBACK`:

- `radar_eligibility_v7_transaction.sql`;
- `agent_engine_confirmation_v8_transaction.sql`;
- `radar_eligibility_rls_v12_transaction.sql`;
- `ai_gateway_budget_telemetry_transaction.sql`;
- `agent_engine_v2_transaction.sql`.

Las cinco matrices pasaron juntas en producción dentro de `BEGIN/ROLLBACK` el
13 de agosto de 2026. La suite v7 prueba la elegibilidad de candidata que le
corresponde; el binding de borrador introducido en v8 se valida en
`agent_engine_confirmation_v8_transaction.sql`.

## Promoción futura por función

Cada tarea avanza independientemente:

1. Mantener `legacy_direct`.
2. Desplegar la Edge que ya llama al contrato común.
3. Verificar el flujo de dominio y su rollback.
4. Comparar legacy/paridad offline y después en un smoke autorizado.
5. Cambiar solo esa tarea a `gateway_gemini_parity`.
6. Observar sin cambiar el resultado de dominio por fallos de telemetría.
7. Considerar `gateway_routing` únicamente tras benchmark, revisión y promoción.

Orden: Radar sin inferencia, Market Expert, Corrector, Validator y Resolución. OpenRouter y NVIDIA conservan flags separados en `false` y budgets cero.

El despliegue base de esas cinco funciones ya se completó en ese orden y con
JWT obligatorio: Radar v55, Expert v22, Corrector v19, Validator v27 y
Resolución v15. Los pasos 4–7 continúan pendientes y no deben inferirse del
despliegue base.

## Comprobación manual de Gemini previa a un cambio de modo o nuevo despliegue

No automatizar rotaciones ni leer valores.

1. Listar únicamente nombres o digests de Edge secrets.
2. Confirmar en Google AI Studio que la credencial vigente usa el tipo de autenticación actual y no una clave estándar próxima a quedar obsoleta.
3. Comprobar que no existe un `GOOGLE_API_KEY` inesperado con precedencia.
4. Mantener `GEMINI_API_KEY` como única variable autoritativa.
5. Rotar manualmente solo con autorización.
6. Probar una tarea de paridad antes de cambiar su modo.

Esta comprobación no bloquea la implementación local. No pedir, mostrar ni escribir valores de secretos.

## Proveedores experimentales

Antes de un smoke live:

1. Habilitar de forma expresa un único flag.
2. Confirmar secreto presente, sin leer su valor.
3. Configurar budget medido positivo.
4. Ejecutar capability discovery contra el catálogo oficial.
5. Exigir el modelo y endpoint exactos, structured output compatible y `public_market`.
6. Ejecutar manualmente con autorización y telemetría completa.

Ausencia de secreto devuelve `AI_PROVIDER_NOT_CONFIGURED`; ausencia de Lightning exacto devuelve `AI_MODEL_NOT_AVAILABLE`. Ambos dejan la ruta apagada y no bloquean el software local.

## Telemetría y purga

La purga se invoca solo con el wrapper service-only `purge_ai_operational_telemetry_v1`. No acepta fecha ni selección de runs. Calcula internamente 90 días para intentos IA y 180 días para runs/steps, registra el cutoff y el recuento, y nunca purga auditoría de mercado.

Un warning `AI_TELEMETRY_WRITE_FAILED` requiere investigar persistencia, permisos y deadline. No repetir la inferencia para cambiar una propuesta ya válida.

## Rollback técnico

El rollback prioritario no es destructivo:

1. Cambiar solo la tarea afectada a `legacy_direct`.
2. Verificar que resuelve al adaptador `gemini.legacy.*` exacto.
3. Mantener las tablas y wrappers V2.1; no borrar telemetría ni registry.
4. Si el bundle nuevo es la causa, volver a desplegar la versión v1 de esa Edge conservando las migraciones aditivas.
5. Confirmar que revisión, confirmación humana, publicación y resolución mantienen sus puertas autoritativas.

No se revierte `FORCE RLS` para recuperar v1: las RPC definer verificadas siguen siendo su superficie. No usar un bypass de trigger por variable de sesión.

## Promoción posterior

Permanecen pendientes y no deben marcarse como realizados:

- capability discovery live;
- completar y revisar corpus;
- ground truth `approved`;
- benchmark live;
- shadow de 14 días;
- canary y volumen suficiente;
- despliegue coordinado;
- cambios de modo;
- promoción de proveedor.

Los informes comerciales, límites económicos, adjudicaciones y estrategia B2B detallada se guardan fuera del repositorio y del ZIP público hasta decisión manual de Yol.
