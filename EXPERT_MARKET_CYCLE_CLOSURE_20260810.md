# Atinara · cierre del ciclo experto de mercados

Fecha de intervención: 10–11 de agosto de 2026.

## Alcance y fuentes de verdad

La intervención partió de `origin/main =
1b10d0adbfdc62b787d70f10b16e86a08b876874` en el worktree aislado
`ATINARA-market-cycle-20260809`, rama `codex/market-cycle-definitive`. Se
contrastaron el repositorio, Supabase producción, logs, las Edge Functions
activas, GitHub Pages y las tres capturas del 9 de agosto. No se usaron ZIP
anteriores y no hubo push, force-push, reescritura de migraciones ni borrado de
datos.

## Causas raíz verificadas

1. Radar agregaba rechazo de contenido y fallo operativo bajo el mismo
   `partial_error`. Por eso los descartes de Polymarket y Kalshi degradaban
   falsamente al proveedor aunque las filas sanas se hubieran conservado.
   Gemini sí tuvo un `429` real. Tras corregir el agregado apareció una segunda
   causa operativa: el aislamiento binario hacía varias RPC de red dentro de un
   presupuesto de 20 segundos y podía diferir lotes sanos. No era un problema de
   `statement_timeout`, sino de granularidad y número de viajes.
2. Editor exponía seis códigos porque encadenaba causas derivadas sobre una
   causa factual. La ausencia de una reducción causal impedía saber qué acción
   era posible y el frontend mostraba códigos de auditoría como explicación.
3. Marvel empezó con `RESOLUTION_DEADLINE_INVALID`: el deadline coincidía con el
   final evaluado. Después el validador emitió un falso bloqueo factual sobre
   Metacritic/producto pese a conservar en esa misma versión una atestación
   primaria HTTP 206 vigente; además, una reparación posterior perdía la fuente
   de contexto histórica. El error genérico ocultaba la fase y el intento.
   Ninguna solución depende de Marvel, GTA VI, un proveedor o una fecha
   hardcodeada.

## Solución

- Taxonomía compartida y registrada con disposiciones `auto_repair`,
  `retryable_technical`, `terminal_block` y `human_decision`; cada estrategia
  define campos, invariantes, evidencia y resultado esperado.
- Intentos de reparación separados de la revisión efectiva, con UUID de
  petición, lock de versión/huella, parche tipado mínimo, fingerprint de parche,
  no-op normalizado, una sola versión material y replay idempotente.
- Deadline derivado de evaluación, disponibilidad de fuente, zona IANA y margen
  de política. El contrato conserva `Metascore > 95` y rechaza cualquier parche
  que cambie su significado. Una atestación primaria fresca y ligada a la
  versión puede refutar una falsa inferencia de inexistencia/acceso, pero nunca
  afirmar resultados futuros; las fuentes de contexto solo se recuperan desde
  bindings append-only.
- Las horas UTC y Europe/Madrid que representan el mismo instante se reconocen
  de forma determinista. Un ancla relativa se fija mediante evidencia oficial
  fechada durante preparación; un conflicto material previo a confirmación
  invalida la revisión en vez de mover silenciosamente el contrato.
- Salud de proveedor separada de calidad por fila, persistencia mediante una
  sola RPC por lote y subtransacciones SQL por candidata, métricas exactas,
  retry seguro, `Retry-After`, backoff con jitter, circuito y
  `last-known-good`. El fallback binario permanece solo por compatibilidad.
- UX en español para disponible, disponible con descartes, degradación temporal,
  error técnico, revisión factual, reparación, bloqueo terminal y decisión
  humana. Los fallos muestran intento seguro, fase, tipo, reintentabilidad,
  estado preservado y próxima acción sin exponer SQL, tokens o stacks.

## Producción

Migraciones aplicadas una sola vez:

| Archivo local | Historial remoto | SHA-256 local |
| --- | --- | --- |
| `20260809204739_close_expert_market_cycle_v2.sql` | `20260809213543 · close_expert_market_cycle_v2` | `501cfcc9a0b29d7c673e7b9e552dbbfbb880908cbac442fbd367f1d1d0b88c28` |
| `20260811100833_harden_repair_evidence_and_idempotency_v3.sql` | `20260811100833 · harden_repair_evidence_and_idempotency_v3` | `791f67df1b92eb16a9e2e39d13234471f1d30b82e5228d21531f19e956ac1f48` |
| `20260811104727_isolate_radar_poison_records_v4.sql` | `20260811104727 · isolate_radar_poison_records_v4` | `82c02abcc66388e06f9a9b7aa566e41fa859f2a6032bb1a883df05cbcb0fb4db` |

Edge Functions activas con `verify_jwt=true`:

| Función | Versión | SHA-256 del bundle |
| --- | ---: | --- |
| `market-radar` | 33 | `d7737e578bd7ae8510a8e6395163b065a87e40eb0353e4e9f75b7c062121a94c` |
| `market-expert` | 17 | `c6042aad369e4897e61e0dd8642f8da25de93f3a2d0db6a6ce221f8eb1182d48` |
| `market-draft-fixer` | 16 | `1a01c7e2636d3b2420ba0467560e20d594ba0c12e4cf94cf35f7c5f1913f7d68` |
| `validate-market-draft` | 26 | `7e0b7d551b0ad69177cc3430d3949209582455006a87f1d50fc3fdc38841a0b3` |

Los archivos recuperados de las cuatro funciones activas coinciden con los
`index.ts` y módulos compartidos del árbol probado. Marvel permanece privado en
v9, fingerprint
`ba349eaef4f17591e1f98ae06aec9a3720c7dd4d93f7f3dfa7f6f50098a06d0c`,
deadline `2026-08-14T14:05:00Z`, revisión efectiva `approved`, sin confirmación,
programación, publicación ni `market_id`. La transición v8→v9 creó una única
versión material; el replay del mismo intento fue idempotente.

El último Radar real v33 dejó Gemini 153/153, Kalshi 84 aceptadas y 1
cuarentena, Polymarket 69 aceptadas y 5 cuarentenas, y Tavily/ideas gaming 0.
Todos quedaron `available`, circuito cerrado y cero fallos. Las seis
cuarentenas fueron `RADAR_PROVIDER_FACT_REQUIRED`; no crearon borradores o
mercados ni produjeron un aviso global de degradación.

## Pruebas y seguridad

- Sintaxis: 71 archivos JavaScript válidos.
- Unitarias/integración estática: 319/319.
- TypeScript local: correcto. No se ejecutó Checkly remoto porque esta sesión no
  dispone de sus credenciales; no se presenta la compilación como monitor live.
- SQL productivo con rollback: RLS forzada, privilegios mínimos, taxonomía,
  proveedor sano con cinco descartes, aislamiento de una fila venenosa,
  equivalencia UTC/Europe-Madrid, idempotencia, concurrencia optimista y
  ausencia de mutación en preflight.
- La ruta positiva de publicación se materializó dentro de una transacción y
  terminó en `ROLLBACK`; verificó revisión compatible, confirmación humana
  obligatoria e idempotencia sin publicar un mercado real.
- Todas las acciones administrativas exigen JWT y rol administrativo en
  servidor. `anon` no puede ejecutar las RPC de reparación; las tablas privadas
  fuerzan RLS y no exponen políticas de acceso directo.
- Los advisors no detectaron una vulnerabilidad nueva del corte v4. El aviso
  informativo de la tabla privada sin políticas es intencional: con RLS forzada,
  revocaciones y sin políticas no existe acceso directo. La RPC de lectura
  `SECURITY DEFINER` es solo para `authenticated` y exige administradora en su
  primera instrucción. Los índices nuevos constan aún como no usados tras dos
  ejecuciones; no se eliminan ni se ocultan elevando timeouts.

## Integridad económica

Las huellas SHA-256 anteriores y posteriores son idénticas:

| Relación | Filas | SHA-256 |
| --- | ---: | --- |
| `public.market_maker_state` | 15 | `b3d1a0a27e6a7a754576057aba35c317c1b651388fe67ffceb13784472a0c927` |
| `public.market_price_history` | 17 | `8eb3d854e5ff20eb7ccad96efcbabd4d7545e17ffa457e74630d6f2f2e0f7adf` |
| `public.markets` | 15 | `70d93479e2efe650e3623be40e9aee688216abdbe9866dd5f2a02f67da3ee137` |
| `public.predictions` | 9 | `170372fee7b857c67a51f2c3b33f9675f5b0b406c6040625520d2d6df2a3059c` |
| `public.profiles` | 2 | `8492fdfc993bc473e6a2d9f00924dc8b39b8650f196f86dcf049ed50a179f6bc` |

Totales: 2 perfiles, 2.932 Karma y 40 Prestigio; 15 estados LMSR, 17 puntos
de precio, 9 predicciones y ningún cambio en liquidaciones. La intervención no
creó ni publicó mercados y no cambió Karma, Prestigio, predicciones, LMSR,
precios o liquidaciones.

## Cierre pendiente

1. Yol debe subir el ZIP incremental a GitHub; no se hizo push ni se abrió PR.
2. Después de la subida, comprobar que GitHub Pages sirve
   `v=20260811-expert-cycle3` y repetir el smoke en escritorio/móvil,
   claro/oscuro, recarga, doble clic y recuperación tras fallo.

Ningún punto autoriza confirmar o publicar un mercado real. La confirmación
humana específica continúa siendo obligatoria.
