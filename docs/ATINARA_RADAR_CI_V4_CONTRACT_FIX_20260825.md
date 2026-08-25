# Atinara · corrección de la puerta CI del contrato Radar v4

Fecha: 25 de agosto de 2026
Base: `origin/main = ca7ccf0d14ec18bc01a1a28c7c31f339316a137a`
Alcance: contrato de regresión y memoria operativa. Sin runtime ni producción.

## Evidencia remota

El contenido remoto de `ca7ccf0d14ec18bc01a1a28c7c31f339316a137a`
coincide con las diez rutas de la entrega de aislamiento de timeouts. Para ese
SHA, Pages y `Benchmark IA offline` terminaron correctamente. La Action
`Calidad de Atinara`, ejecución `32892746856`, falló en el paso
`Validar JavaScript y pruebas` y omitió por dependencia el paso Deno.

La única prueba fallida fue:

`Radar · un registro venenoso se aísla por batch durable sin perder filas sanas`

El archivo `tests/expert-market-cycle-definitive.test.js` todavía exigía que el
texto de la Edge contuviera `process_market_radar_refresh_batch_v3`. La Edge
correcta ya invoca `process_market_radar_refresh_batch_v4`; v4 conserva v3 como
primitive SQL interno, añade el catcher exterior y devuelve el batch exacto
para su aislamiento durable. Por tanto, la prueba histórica contradecía el
cutover que sí verificaban las suites focalizadas.

## Corrección

La prueba paraguas ahora:

- exige la llamada Edge a `process_market_radar_refresh_batch_v4`;
- exige la conexión a `split_market_radar_refresh_batch_v1`;
- prohíbe que la Edge invoque directamente v3;
- conserva las puertas existentes de cuarentena, reconciliación y finalización.

No se modifica código productivo, migraciones, frontend, Edge Functions,
secretos, Auth, RLS, IA, Registry, modelos, rutas, modos, flags, presupuestos,
economía, Karma, Prestigio ni LMSR. No hay DML, backfill ni eliminación.

## Verificación local

- Test focalizado que falló en CI: 18/18.
- Suite global: 566/566.
- Sintaxis válida: 128 archivos JavaScript.
- Canonical JSON v1: 13 casos de dominio, 10 golden y 22 inválidos con
  fingerprint idéntico en Node 22.23.2 y Deno 2.1.14.
- TypeScript de configuración: correcto.
- Contratos SQL estáticos: 19/19.
- Grafo de Edge Functions: 9/9 con Deno 2.1.14.
- Dependencias: cero vulnerabilidades con el umbral `high` de la Action.
- `git diff --check`: correcto para el rango incremental.

## Activación

1. Subir únicamente el inventario del manifiesto incremental.
2. Ejecutar `git fetch --all --prune` y comparar rutas y contenido con esta
   entrega.
3. Exigir verde la Action completa `Calidad de Atinara`, incluido el paso Deno.
4. Comprobar Pages y benchmark offline; no usar Sonar.
5. Solo entonces tomar baseline productivo, aplicar exclusivamente la migración
   `20260825214500_isolate_market_radar_batch_timeouts_v1` y desplegar únicamente
   `market-radar` con JWT obligatorio.
6. Continuar una sola vez la UUID existente
   `39a1656e-61af-4674-a4e0-fa0896236507`; no crear otro refresh.

La corrección de CI no cambia el runtime que se desplegará. Su función es hacer
que la puerta global compruebe el contrato vigente antes de cualquier mutación
productiva.
