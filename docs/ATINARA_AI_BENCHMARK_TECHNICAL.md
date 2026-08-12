# Benchmark técnico de IA · V2.1

Estado: runner y fixtures de protocolo implementados para ejecución offline. No existe todavía ground truth humano aprobado, benchmark live, shadow temporal ni proveedor promovido.

## Separación de objetivos

El benchmark offline demuestra que contratos, adapters, validadores, errores, disponibilidad, presupuestos y métricas funcionan sin red. No demuestra calidad comparativa real.

El corpus operativo futuro tiene un objetivo de 300 casos:

| Tarea | Objetivo |
|---|---:|
| Radar | 80 |
| Editor | 60 |
| Validator | 60 |
| Corrector | 60 |
| Resolución | 40 |

El repositorio contiene solo cinco fixtures mínimos, uno por tarea, todos sintéticos y `draft`. No son ground truth ni pueden sustentar una promoción.

## Estados de ground truth

- `draft`: sin revisión humana suficiente.
- `reviewed_once`: una revisión registrada.
- `disputed`: dos revisiones incompatibles.
- `approved`: dos revisiones compatibles o adjudicación humana explícita.

Solo `approved` puede ser holdout. El runner rechaza un holdout no aprobado, una aprobación sin evidencia de revisión y una disputa sin desacuerdo. Nunca infiere ni fabrica revisiones.

## Entrypoint y aislamiento

`runBenchmarkCase({ caseId, routeId }, executionContext)` carga el caso desde un corpus controlado y resuelve un route ID registrado. Ninguna Edge productiva importa el entrypoint.

Ejecución normal:

```powershell
$env:ATINARA_EXTERNAL_AI_DISABLED='1'
npm run benchmark:offline
```

El runner offline usa transportes mock. Un fetch externo no inyectado debe fallar. `push` y `pull_request` ejecutan `.github/workflows/ai-benchmark-offline.yml`; no existe `schedule` live y la ausencia de secretos no es un error de CI.

## Métricas futuras

Las muestras con telemetría incompleta no participan en métricas. Sobre holdout `approved`, el informe futuro separará por tarea y ruta:

- validez de contrato local;
- exactitud respecto al resultado aprobado;
- incidencias de seguridad, privacidad o autoridad;
- abstención y fallos técnicos;
- latencia p50/p95;
- bytes y tokens cuando el proveedor los informe;
- tasa y causa de fallback;
- estabilidad entre ejecuciones repetidas.

Puertas no negociables para cualquier promoción:

- 100 % de outputs aceptados pasan tamaño, parse, contrato, dominio y política;
- cero PII, secretos, Karma, Prestigio, posiciones o predicciones privadas;
- cero aprobación, publicación, resolución o liquidación autónoma;
- cero sustitución silenciosa de modelo;
- cero fallback por contenido;
- no inferioridad por tarea sobre el holdout, con criterio estadístico fijado antes del benchmark live;
- revisión humana de discrepancias y adjudicación por Yol cuando proceda.

Los umbrales económicos, comparativas comerciales y una eventual adjudicación de proveedor se conservan fuera del repositorio público.

## Live posterior

Una ejecución live futura exige simultáneamente:

- `--live`;
- autorización operativa expresa;
- aprobación del entorno;
- secretos presentes sin mostrarlos;
- budget medido y positivo;
- capability discovery reciente;
- modelo, endpoint, structured output y data class exactos.

Si Lightning no aparece, la ruta queda `unavailable`. No se reemplaza por otra variante y el benchmark no oculta la ausencia. Sin casos `approved`, el resultado es `GROUND_TRUTH_NOT_READY_FOR_PROMOTION`.

Shadow de 14 días, canary, cientos de ejecuciones, doble revisión, despliegue y promoción son un hito operativo posterior. No pueden simularse con fixtures.
