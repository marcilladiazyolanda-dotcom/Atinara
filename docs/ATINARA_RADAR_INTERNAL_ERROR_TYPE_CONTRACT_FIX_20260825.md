# Radar V6 · contrato tipado del error interno

Fecha: 25 de agosto de 2026  
Base canónica: `0be8e614c686e6294260faddc2fb36b80da11955`

## Hallazgo antes del despliegue

La subida canónica contiene exactamente los seis archivos de
`ATINARA_RADAR_INTERNAL_ERROR_PRESERVATION_FIX_20260825`. No se desplegó porque
la ejecución GitHub Actions `32872289159` falló en «Comprobar Edge Functions
sin llamadas externas».

La reproducción con la misma versión Deno 2.1.14 produjo:

- `TS2322` al asignar el fallo al resultado de persistencia;
- `TS2345` al construir `RadarPersistenceError`;
- causa común: `JsonRecord` no demuestra las propiedades obligatorias
  `provider`, `code`, `status` y `message`.

## Corrección

`internalRadarRpcFailure` declara ahora:

`ReturnType<typeof publicProviderError> & JsonRecord`

La intersección conserva el contrato público obligatorio y permite los campos
adicionales `retryable` y `database_code`. No introduce cast, no altera el
objeto emitido y no cambia clasificación, status, persistencia ni reintentos.

La prueba exige expresamente ese retorno para impedir que el helper vuelva a
ensancharse a un diccionario que el pipeline no pueda consumir con seguridad.

## Verificación y alcance

- nueve Edge verificadas con Deno 2.1.14;
- 562 pruebas unitarias, cero fallos;
- 128 archivos JavaScript con sintaxis válida;
- 19 contratos SQL estáticos válidos;
- `git diff --check` sin incidencias.

El paquete no contiene migración, frontend, DML, backfill, Gemini, secretos,
cambios de Registry, rutas, modelos, flags, presupuestos o economía. Producción
permanece en `market-radar` v65 y no se lanzó ningún refresh adicional.

Después de subirlo se verificará el nuevo SHA, se desplegará únicamente
`market-radar` con `verify_jwt=true` y se ejecutará un solo refresh Kalshi para
obtener la regla SQL interna exacta.
