# Atinara AI Gateway V2.1

Estado: implementado, verificado y desplegado en producción. Las cinco tareas permanecen en `legacy_direct`; Canonical JSON v1 se propagó a sus bundles el 14 de agosto de 2026. Gemini sigue siendo el único transporte activo mediante el adaptador de compatibilidad centralizado; `gateway_gemini_parity`, `gateway_routing`, OpenRouter y NVIDIA NIM permanecen sin activar.

## Fronteras

- El dominio conserva reglas, evidencias, permisos, estados y confirmación humana.
- Agent Runtime v2 planifica herramientas registradas, controla rondas, huellas, replans y un único writer.
- AI Gateway controla contrato, saneamiento, ruta, modelo, presupuesto, transporte, validación y telemetría.
- Los proveedores solo producen una propuesta. Nunca son autoridad de publicación, aprobación, resolución, liquidación, Karma o Prestigio.
- El frontend llama a Edge Functions de dominio. No conoce proveedores, rutas, modelos, secretos ni presupuestos.

## Contrato productivo

```ts
type AiTaskRequest<TInput> = {
  taskType: AiTaskType;
  contractVersion: string;
  policyVersion: string;
  input: TInput;
};

type AiExecutionContext = {
  invocationId: string;
  agentRunId?: string;
  absoluteDeadlineAt: number;
  signal: AbortSignal;
};
```

La Edge no puede indicar `routeId`, modelo, schema, timeout, bytes, data class, reintentos, fallback, presupuesto ni fingerprint. El Gateway rechaza claves adicionales y resuelve esos valores desde catálogos cerrados.

Orden de ejecución:

1. Validar tarea y versiones.
2. Proyectar mediante allowlists recursivas y rechazar datos prohibidos.
3. Canonicalizar y calcular `inputFingerprint` en el Gateway.
4. Leer la política y el modo privado de la tarea.
5. Comprobar data class, secreto, capability y reserva atómica.
6. Invocar con el tiempo restante del deadline absoluto.
7. Limitar bytes, parsear y validar contrato, dominio y política.
8. Calcular `outputFingerprint`.
9. Persistir telemetría sin cambiar una respuesta de dominio válida si falla la observabilidad.

## Atinara Canonical JSON v1

La canonicalización compartida por AI Gateway, Agent Runtime V2 y Registry V2 declara:

```text
ATINARA_CANONICAL_JSON_VERSION = "atinara-canonical-json-v1"
```

La versión identifica el contrato y sus fixtures, pero no se incorpora al contenido hasheado ni se persiste en este paquete: hacerlo cambiaría las huellas existentes. Cualquier cambio futuro incompatible exige un contrato `atinara-canonical-json-v2`, con transición explícita; no se admite cambiar v1 en silencio.

Atinara Canonical JSON v1 es un subconjunto explícito de JSON compatible con los principios de RFC 8785:

- ordena recursivamente las claves por unidades de código UTF-16 mediante un comparador binario explícito, sin locale;
- conserva el orden de los arrays y exige índices propios, densos y enumerables de `0` a `length - 1`;
- no normaliza Unicode, por lo que las formas compuesta y descompuesta permanecen distintas;
- usa la serialización ECMAScript de `JSON.stringify` solo para strings, claves y números;
- serializa directamente a string, sin reconstruir objetos con `Object.fromEntries`;
- admite objetos con prototipo `Object.prototype` o `null` y claves de datos ordinarias como `toJSON`, `__proto__`, `constructor` y `prototype`;
- no ejecuta `toJSON` ni getters y rechaza accessors, funciones, symbols, `BigInt`, prototipos personalizados, propiedades propias no enumerables, arrays dispersos o con claves adicionales, ciclos y lone surrogates;
- conserva el límite de profundidad: más de 20 niveles devuelve `AI_INPUT_TOO_LARGE` con HTTP 413; los valores inválidos devuelven `AI_INVALID_REQUEST` con HTTP 400.

El contrato genérico `sha256Hex(string)` no cambia. La validación de Unicode bien formado pertenece a `canonicalJson` y a sus claves y valores.

Este paquete se aplica “sin alterar las cadenas ni huellas de los valores productivos válidos cubiertos por los contratos V2.1 actuales; los valores no JSON o previamente ambiguos se rechazan conforme al contrato v1”. El corpus compartido fija cinco inputs saneados, cinco outputs validados, un snapshot de Registry V2 y los payloads de progreso y replan de Runtime V2, además de los casos de ordenación y rechazo.

## Tareas y paridad Gemini

| Tarea | Contrato | Modelo de paridad | Reserva final |
|---|---|---|---:|
| `radar_candidate_enrichment` | `atinara-ai-radar-candidate-enrichment-v1` | `gemini-3.1-flash-lite`; ruta dormida | 10 s |
| `market_draft_validation` | `atinara-ai-market-draft-validation-v1` | `gemini-3.1-flash-lite` | 10 s |
| `market_expert_reasoning` | `atinara-ai-market-expert-reasoning-v1` | `gemini-3.5-flash-lite` | 15 s |
| `market_draft_repair` | `atinara-ai-market-draft-repair-v1` | `gemini-3.5-flash-lite` | 12 s |
| `market_resolution_analysis` | `atinara-ai-market-resolution-analysis-v1` | `gemini-3-flash-preview` | 10 s |

Radar continúa ejecutando cero inferencias. El Corrector conserva el parche determinista como único parche aplicable. Resolución conserva `Interactions` y el fallback técnico al endpoint `generateContent`.

## Transición por tarea

Cada tarea tiene uno de estos modos privados:

- `legacy_direct`: adaptador de compatibilidad centralizado. Es el default si falta la migración o falla la lectura del setting.
- `gateway_gemini_parity`: mismo modelo Gemini mediante la ruta normalizada; requiere presupuesto medido.
- `gateway_routing`: inalcanzable hasta una promoción operativa expresa.

No existe un booleano global capaz de apagar todas las tareas. La retirada del código directo de cada Edge no retira la compatibilidad Gemini: vive en `providers/gemini-legacy.mjs` para transición y rollback.

## Sanitización y salida estructurada

Atinara usa validadores deterministas específicos por tarea, no un validador JSON Schema general. El schema enviado al proveedor es orientativo; la aceptación local exige, sin coerción ni defaults silenciosos:

- tamaño máximo;
- JSON parseable;
- claves y tipos exactos;
- relaciones de dominio;
- política de autoridad;
- ausencia de claves de razonamiento oculto.

El sanitizer aplica vocabulario cerrado en todos los niveles, límites de profundidad, arrays, strings, URLs y bytes. Rechaza identidad, contacto, sesiones, cookies, JWT, secretos, Karma, Prestigio, saldo, posiciones y predicciones privadas. Los IDs internos y el payload crudo de proveedor se eliminan de la proyección editorial.

En `market_expert_reasoning`, `origin.duplicate_matches` es dato ordinario de mercado: se valida siempre como array y admite tanto el array vacío como coincidencias saneadas producidas por la clasificación determinista. `PUBLIC_JSON` es el vocabulario transversal de campos de mercado, pero declarar esta clave no amplía la clase de datos ni las claves admitidas dentro de cada coincidencia. La proyección productiva elimina recursivamente `id` y claves `*_id`; el Gateway sigue rechazando identificadores no proyectados, PII, secretos y cualquier campo anidado fuera del vocabulario cerrado antes de reservar presupuesto o invocar al proveedor.

Data classes:

- `public_market`: única clase admisible para OpenRouter o NVIDIA NIM.
- `private_market_minimized`: solo Gemini, con una proyección contractual mínima.
- `prohibited`: nunca invocable.

## Presupuesto y concurrencia

`public.reserve_ai_provider_budget_v1` es un wrapper service-only sobre una implementación privada. La reserva es atómica e idempotente por invocation, proveedor, tarea y día UTC. Un advisory lock transaccional serializa la clave diaria; el incremento condicionado impide sobreconsumo concurrente.

- `baseline_existing` preserva la disponibilidad de `legacy_direct`; un fallo de persistencia se informa y no apaga el servicio ya existente.
- `metered` es obligatorio para modos nuevos y falla cerrado si la reserva no puede demostrarse.
- OpenRouter y NVIDIA nacen con límite cero.
- Presupuesto cero devuelve `AI_BUDGET_EXHAUSTED` antes de red.

La política económica del proveedor no forma parte del dominio de mercados.

## Proveedores y fallback

Los transportes aceptan `fetch` inyectable y las pruebas normales no usan red externa.

- Gemini: compatibilidad y ruta de paridad por tarea.
- OpenRouter: solo el ID exacto `nvidia/nemotron-3.5-lightning:free`, con `allow_fallbacks:false`.
- NVIDIA NIM: solo el ID directo exacto de Lightning si capability discovery oficial lo encuentra.

Una ruta experimental requiere flag propio, secreto presente, budget positivo, discovery reciente, modelo y endpoint exactos, structured output compatible y data class permitida. No se sustituye Lightning por Nano, Ultra, Super u otro modelo.

El fallback entre modelos se admite solo por timeout, 429, red, 5xx, respuesta inválida o contrato técnico inválido. Un rechazo, abstención, confianza baja o veredicto de contenido termina la inferencia; nunca se consulta otro modelo para buscar aprobación.

## Errores comunes

| Código | Significado |
|---|---|
| `AI_PROVIDER_NOT_CONFIGURED` | Falta el secreto requerido. |
| `AI_MODEL_NOT_AVAILABLE` | Discovery no encuentra el modelo exacto compatible. |
| `AI_BUDGET_EXHAUSTED` | No existe presupuesto medido suficiente. |
| `AI_BUDGET_RESERVATION_FAILED` | No se pudo demostrar la reserva. |
| `AI_DEADLINE_EXCEEDED` | No queda tiempo preservando finalización. |
| `AI_PROVIDER_RESPONSE_TOO_LARGE` | La respuesta excede el máximo de bytes. |
| `AI_OUTPUT_CONTRACT_INVALID` | La estructura local no coincide. |
| `AI_OUTPUT_DOMAIN_INVALID` | La estructura es válida, pero contradice el dominio. |
| `AI_OUTPUT_POLICY_INVALID` | La salida intenta exceder su autoridad. |
| `AI_TELEMETRY_WRITE_FAILED` | El resultado se conserva con observabilidad incompleta. |

Los errores públicos solo exponen código estable y reintento. Nunca contienen prompt, payload, respuesta cruda, secreto, error crudo del proveedor o presupuesto.

## Telemetría y retención

`private.ai_invocation_attempts` guarda fingerprints, ruta, modelo, lifecycle, bytes, latencia, tokens cuando existan y resultado técnico. No guarda prompts, entradas, respuestas ni razonamiento. Runs y steps del agente almacenan resúmenes acotados y huellas.

- `UPDATE` está prohibido por trigger.
- Los roles API carecen de `DELETE` y de acceso directo.
- La purga service-only no acepta IDs ni cutoff del caller.
- Intentos IA: 90 días.
- Runs y steps: 180 días.
- No se promete un rollup de 13 meses.

Si falla la telemetría, una respuesta válida conserva exactamente su resultado, añade `AI_TELEMETRY_WRITE_FAILED` y no repite la inferencia. En benchmark o shadow la muestra queda `metricsEligible=false`.

## Superficies

- Contratos y políticas: `supabase/functions/_shared/ai/`.
- Runtime y registries: `supabase/functions/_shared/atinara-agent-*-v2.mjs`.
- Persistencia: migraciones `20260812141511` y `20260812141515`.
- Dependencias v1/v2: `docs/ATINARA_RPC_DEPENDENCY_MATRIX.md`.
- Operación y rollback: `docs/ATINARA_AGENT_ENGINE_V2_RUNBOOK.md`.
- Benchmark: `docs/ATINARA_AI_BENCHMARK_TECHNICAL.md`.

Las comparativas comerciales, límites económicos internos, adjudicaciones, corpus privado y estrategia B2B detallada no pertenecen a este repositorio público.
