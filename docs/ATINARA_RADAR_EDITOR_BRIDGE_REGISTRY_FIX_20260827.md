# Atinara · corrección del puente Radar → Agente Editor · 27-08-2026

## Alcance

Esta entrega corrige el fallo productivo observado como
`click → nada visible → nada persistido` al analizar una candidata del Radar.
No añade funciones de producto, no cambia la estrategia B2B-first y no
autoriza confirmar, programar, publicar, resolver o liquidar mercados.

Base canónica verificada antes de la entrega:
`e74a6d79f3a6ba852d660d04ab6b7243630cdd95`. Las tres Actions de ese SHA
estaban en `success`. Producción permanecía en `market-radar` v75 y
`market-expert` v26, ambas `ACTIVE` y con JWT obligatorio.

La UUID autoritativa sigue siendo
`39bc204b-aa3f-4a69-99da-557f5fa91f7d`. Conserva cuatro checkpoints V2; no se
creó otra UUID ni se reinició el catálogo.

## Causa raíz demostrada

El entrypoint productivo de `market-expert` v26 coincide con GitHub, pero su
bundle conserva una copia antigua de
`_shared/atinara-agent-registries-v2.mjs`: 40 handlers frente a las 50
estrategias que devuelve el Registry productivo después de la ampliación del
Corrector por campos.

La acción `analyze-origin` crea el Agent Engine y ejecuta
`assertAgentRegistrySnapshot`. La estrategia número 41 provoca
`AGENT_STRATEGY_HANDLER_MISSING`; la Edge responde 503 antes de crear un
`market_expert_run`. Las lecturas posteriores `get-analysis` y
`get-draft-package` sí responden 200 y, al no existir run, devuelven
`MARKET_EXPERT_ANALYSIS_REQUIRED`.

La UI descartaba el detalle del 503 al emitir
`atinara:radar-expert-analysis-failed` solo con `candidateId`. El bridge
invalidaba su caché, repetía `get-draft-package` y sustituía el error real por
el bloqueo genérico. Además, la lectura inicial de `get-analysis` usaba un
`.catch(() => null)`. El resultado visible era un falso no-op aunque el
backend hubiera fallado de forma tipada.

## Auditoría de rutas de materialización

| Ruta | Contrato vigente | Uso correcto |
| --- | --- | --- |
| `save_market_draft_from_radar_intelligence` | Vigente | Propuesta normal, elegibilidad vigente, contrato y fuentes completos. Persiste binding de inteligencia y elegibilidad de forma atómica. |
| `save_market_draft_from_expert_with_issues_v2` | Writer vigente de incidencias | `proposal_ready_with_issues` o `workflow_issues` no terminales. Crea borrador privado con familia, lineage, issue ledger y autoridad pendiente. |
| `materialize_market_draft_for_repair_v1` | Compatibilidad | Fallback para clientes/paquetes antiguos que expresan `can_materialize=true` y `can_save=false`. El gate actual normalmente selecciona antes el writer V2. |

La implementación productiva anterior de la tercera ruta había quedado
incompatible con el writer Radar V3: eliminaba
`_radar_preparation_revision` y llamaba `save_market_draft_from_radar`, que
ahora exige esa revisión, idempotency key y elegibilidad autoritativa. La nueva
migración no elimina la firma: la convierte en un alias fail-closed del writer
V2, conserva ACL y valida revisión, fingerprints, policy, schema, gate e
idempotencia antes de delegar.

## Corrección general

- La acción de análisis mantiene estado por candidata: `processing`, `failed`
  o dictamen persistido.
- El click muestra de inmediato que la operación empezó.
- El evento de fallo transporta solo código, mensaje saneado, fase, status,
  retryability, preservación y gate; nunca una respuesta cruda.
- Un fallo no puede ser sobrescrito por el 200 genérico del package.
- Los fallos reintentables muestran `Reintentar análisis` y la siguiente acción.
- La lectura inicial ya no absorbe errores.
- Un `Set` impide dos análisis simultáneos de la misma candidata.
- La Edge clasifica cualquier incompatibilidad `AGENT_*` como técnica,
  preservada y reintentable en fase `agent_registry_compatibility`.
- La migración nueva repara la firma legacy sin editar migraciones aplicadas y
  sin DML de negocio ni backfill.
- Las diez superficies HTML usan un único token de release en todos sus
  recursos locales. Esto evita mezclar la versión nueva de los dos scripts con
  dependencias en caché; no cambia lógica ni contenido de las demás páginas.

## Activación requerida después de integrar en GitHub

1. Verificar el nuevo `origin/main` y el contenido exacto de la entrega.
2. Exigir Calidad de Atinara, Benchmark IA offline y Pages verdes para ese SHA.
3. Repetir baseline productivo de solo lectura.
4. Aplicar una sola vez
   `20260827234500_fix_market_expert_editor_bridge_contract_v1.sql`.
5. Desplegar `market-radar` desde el mismo `origin/main`, porque la corrección
   de hash V1 ya integrada en la base aún no está activa.
6. Desplegar `market-expert` desde ese `origin/main`; el bundle debe contener
   el Registry compartido vigente y el nuevo error tipado.
7. No desplegar Corrector, Validator, Resolución ni otras Edge.
8. Verificar Pages con `v=20260827-radar-editor-bridge1`.
9. Reanudar exclusivamente la UUID existente desde su último checkpoint.
10. Solo tras discovery autoritativo, recorrer una vez
    Radar → Eligibility → Expert → Editor → borrador privado.

## Puertas locales de esta entrega

- Suite unitaria completa: 622/622.
- Sintaxis: 134 archivos JavaScript.
- Canonicalización: 13 casos de compatibilidad y 10 golden cases.
- Edge Functions: 9/9 con Deno 2.1.14, incluida `market-expert`.
- Contratos SQL estáticos: 21/21.
- Benchmark IA offline: 5/5, con `externalNetworkCalls=0`.
- Navegador contractual: 19 casos en 390, 768 y 1.366 px, incluida la caída
  503 del Registry, estado visible, retry, doble evento y cero escrituras.
- `git diff --check`: correcto.

La comprobación de inventario y hash del ZIP se ejecuta al generar el paquete.
Ninguna evidencia local sustituye la activación y el E2E productivo.

## Estado de seguridad y datos

No se modifica Auth, RLS de tablas, secretos, rutas de IA, modos, modelos,
presupuestos, economía, Karma, Prestigio, LMSR ni datos existentes. La nueva
RPC conserva `SECURITY DEFINER`, `search_path=''`, ejecución solo para
`authenticated` y la comprobación administrativa interna. La entrega no crea
ningún run, borrador, mercado o refresh.
