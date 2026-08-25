# Radar V6 · preservación de errores internos en discovery y persistencia

Fecha: 25 de agosto de 2026  
Base canónica: `155b2c86a25d5a2c20f0345f687ae6b7a8a70da9`

## Evidencia productiva previa

`market-radar` v65 quedó `ACTIVE` con `verify_jwt=true`. El refresh Kalshi
controlado `0cfba4f3-c258-48cb-8c6c-4bde7afac576` demostró que el aislamiento
por series funciona:

- 25 de 25 series seleccionadas y consultadas;
- `failed_series_count=0`;
- 11 padres y 146 hijas descubiertas;
- Tavily completó su capacidad sin Gemini;
- fallo durante persistencia, antes de ledger de padres, manifest o batches;
- cero candidatas, padres, manifest o batches Kalshi escritos por esa UUID.

La respuesta persistida fue `PROVIDER_UNAVAILABLE`, aunque discovery había
terminado correctamente. Por tanto, esa etiqueta no describe la causa real.

## Causa raíz del diagnóstico perdido

Las RPC convierten el error PostgREST en `RadarRpcError`. Su `message` contiene
el envoltorio operativo; la regla SQL concreta permanece en `databaseMessage` y
el SQLSTATE en `databaseCode`. `providerFailure` y `persistenceFailure`
consultaban primero el mensaje genérico, por lo que ocultaban la regla interna y
la reemplazaban por una supuesta indisponibilidad del proveedor.

## Corrección

`internalRadarRpcFailure` se aplica antes de clasificar fallos externos y:

- extrae el código con `radarOperationalErrorCode`, que prioriza
  `databaseMessage`;
- conserva `database_code` para la auditoría técnica;
- mantiene retry solo para timeout, lease perdida/inválida y aislamiento de
  persistencia diferido;
- devuelve conflicto no reintentable para otras reglas internas hasta que se
  diagnostique su causa;
- evita llamar caída de Kalshi a un rechazo ocurrido dentro de SQL.

La prueba de contrato exige que discovery y persistencia usen este helper y que
no vuelva a introducir `PROVIDER_UNAVAILABLE` en esa ruta interna.

## Alcance y activación

El paquete modifica únicamente la Edge `market-radar`, su prueba y la
documentación. No incorpora migración, frontend, backfill, DML manual, Gemini,
cambios de Registry, modelos, rutas, flags, presupuestos ni economía.

Después de subir el paquete:

1. verificar el SHA remoto y las pruebas canónicas;
2. desplegar solo `market-radar`, conservando `verify_jwt=true`;
3. ejecutar un único refresh Kalshi controlado tras el cooldown;
4. leer la regla SQL exacta preservada;
5. detener los reintentos y corregir su causa raíz si exige código o migración.

Este parche es diagnóstico y de integridad del contrato. No declara todavía
Kalshi ni el E2E 13.5.2 aptos para cierre.
