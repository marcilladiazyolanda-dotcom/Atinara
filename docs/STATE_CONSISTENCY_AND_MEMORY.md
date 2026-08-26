# Memoria y consistencia de estado

Este documento fija el contrato autoritativo de Gestión de mercados desde el Paso 13.5.2. Supabase producción es la fuente de verdad. El DOM, `localStorage` y `sessionStorage` nunca acreditan una versión, una revisión, una confirmación, un binding ni una publicación.

## Invariantes

### Identidad y horizonte de candidatas Radar

La identidad familiar de una candidata es un único contrato compartido entre
`_shared/market-radar.mjs` y Postgres. Para dimensiones categóricas
`outcome`, `participant` y `platform`, una etiqueta afirmativa estructurada
no genérica produce `option:<slug>` incluso cuando la proposición incluye una
fecha. La frontera temporal permanece en `family_sort_at` y en
`family_semantics.temporal_boundary`; nunca sustituye a la opción como
`family_child_key`.

Las candidatas v3 aceptan únicamente la proyección familiar v5 calculada por el
normalizador vigente; los triggers v4 se ejecutan solo para expedientes legacy y
no pueden reescribirla. Una actualización normal corrige así una identidad SQL
histórica divergente sin hacer compatible el snapshot antiguo. La RPC
administrativa filtra y ordena horizontes mediante
`market_radar_candidate_horizon_at_v1`: frontera familiar superior/exacta o
evaluación, `atinara_closes_at` y, como último recurso, cierre técnico del
proveedor. Una frontera inferior `gt/gte` es el inicio y no el fin; no desplaza
el cierre efectivo. La lista excluye finales ya vencidos.

Cuando `radar_candidate_id` vincula un borrador, su identidad familiar v4 o v5 se
proyecta desde la candidata autoritativa en vez de reinterpretar la opción a
partir de texto editorial incompleto. Al materializar, el mercado hereda la
identidad del borrador. La cadena conserva el bloqueo exacto cross-provider sin
convertir una opción hermana en duplicado y sin conceder publicación automática.
La referencia exacta `market_id` prevalece; antes de materializar solo cuenta
una intención `human_confirmed` o `scheduled`, y dos intenciones publicables con
el mismo slug detienen la proyección en vez de elegir un borrador arbitrario.

### Completitud del padre y transición de snapshots Radar

Una fila raw del proveedor y una candidata canónica actual son memorias
distintas. `atinara-radar-v3` solo proyecta una hija cuando el snapshot
append-only `atinara-radar-parent-reconciliation-v1` demuestra el padre y el
registro `atinara-radar-child-projection-v1` demuestra su identidad. Una fila
v2 se conserva como historia, pero no puede aparecer en el catálogo actual ni
iniciar un borrador nuevo.

La intención durable declara además un parent manifest. Cada padre registra
total declarado, descubierto, contabilizado, identificado, pendiente, cerrado,
eliminado, duplicado y conflictivo, junto a paginación, huella y evidencia. SQL
recalcula los recuentos desde las hijas; no confía en sumas del runtime. Un
refresh puede terminar correctamente y contener un padre
`incomplete_provider_metadata`: la ejecución está cerrada, pero ese padre solo
aparece en «Reconciliación del proveedor» y no como catálogo o rechazo.

Identidad y disponibilidad son ejes separados. Un placeholder inactivo sigue
siendo primero `unresolved_placeholder`; no se convierte en un mercado real
rechazado. Su etiqueta raw, IDs y respuestas oficiales se conservan. Solo una
etiqueta demostrada por el mismo proveedor produce identidad canónica. Una
categórica resuelta exige `option:<slug>` y rechaza cualquier label temporal.
La corrección de identidad no modifica mercados o borradores legacy: una ruta
ya preparada conserva compatibilidad exacta, mientras toda preparación nueva
exige padre completo.

La promoción de candidatas y la finalización de la intención comparten una sola
transacción SQL. Los batches permanecen durables como staging, pero ninguna
hija se proyecta con el padre nuevo hasta que todos los batches terminan y el
snapshot pasa a terminal. Un fallo revierte la promoción completa y deja la
intención reanudable sobre el último catálogo válido.

El service role solo puede entrar por el wrapper atómico y por el finalizador
v5 que separa `candidate_feed` de `source_enrichment`; los procesadores v1/v2 y
finalizadores v3/v4 son internos del owner. El commit extiende su propio lease a
120 segundos frente al timeout RPC de 90. Cada refresh compara todas las
occurrences del último snapshot durable —no solo las heredadas originalmente de
v2— y acepta un rename/move únicamente por intersección de aliases fuertes. Un
slug es fallback solo si no existe ID/condition/token y es único en el scope.

Las candidatas v3 ya preparadas no se reescriben como nuevas. Si la hija actual
conserva identidad y opción exactas, el commit reata únicamente los punteros
append-only; esos IDs técnicos no elevan `preparation_revision`. Una huella
material, una disponibilidad no abierta o una identidad distinta sí deja el
expediente stale y obliga a revalidar. Los rechazos reales cerrados/inactivos
siguen visibles mediante el contrato de reconciliación bound, sin adquirir
autoridad para avanzar.

La detección de duplicado exacto se repite bajo una identidad y advisory lock
comunes V4/V5 al preparar, guardar, confirmar y publicar. Un match live se
persiste como check `duplicate`, rechazo e issue ledger idempotentes; no queda
como un 409 efímero. Colisiones de slug, Unicode, puntuación o etiquetas iguales
con IDs fuertes distintos son conflicto de proveedor, nunca prueba de duplicado.

### Guardado Radar y replay del expediente experto

Las capas versionadas de guardado no se enlazan mediante un nombre público que
pueda ser redefinido después. El helper interno de Market Expert llama a
`save_market_draft_from_radar_without_authoritative_fact_gate_v1`, la
implementación preservada que corresponde a su posición en el grafo; los
wrappers públicos siguen siendo las únicas entradas autenticadas y aplican una
sola vez la revisión y la elegibilidad vigentes.

El primer guardado puede realizar la transición autoritativa
`available -> prepared` y aumentar `preparation_revision`. Un retry con la misma
UUID conserva la revisión enviada originalmente solo si la candidata está
`prepared`, apunta al mismo borrador y el writer inferior demuestra igualdad de
payload. En la ruta experta también deben coincidir ejecución, origen, contrato,
fuentes y binding activo. Ese replay devuelve el expediente existente sin
reescribir procedencia, sin versionar el binding y sin crear auditoría adicional.
Cualquier diferencia falla con el contrato de revisión movida y revierte todos
los efectos de la transacción.

### Refresco Radar durable y salud por capacidad

Cada actualización manual genera una UUID de intención y reclama en Postgres
`(request_id, provider, capability)` antes de consultar red. Polymarket y Kalshi
poseen la capacidad `candidate_feed`; Tavily posee `source_enrichment`. Una
caída de enriquecimiento nunca convierte el catálogo de candidatas en parcial o
indisponible.

En el adaptador Kalshi, cuando el índice temático no cabe con seguridad junto a
la enumeración de hijas, la intención sella primero
`market_radar_provider_discovery_checkpoints_v1`. El checkpoint es privado,
append-only, ligado a `(request_id, provider, capability)`, al lease y a un hash
SHA-256; conserva scopes taxonómicos, series, padres, fallos parciales y
evidencia temporal antes de liberar el transporte. La caída de un scope no
elimina el otro: queda identificada y solo ese scope se reintenta al continuar.
Si ambos scopes no responden, el resultado es parcial y accionable, nunca éxito
fresco ni fallo técnico global. Una continuación solo puede reclamar la misma
UUID y leer ese payload con `service_role`. El ledger de selección cuenta cada padre
indexado como materializado o diferido, aunque la respuesta pública omita sus
IDs completos por presupuesto. Un checkpoint presente solo en memoria, una
serie fallida no registrada o un catálogo parcial presentado como agotado no
constituyen progreso durable. Polymarket conserva su paginación Gamma/CLOB y su
aislamiento por búsqueda y padre; no puede escribir un payload con forma Kalshi
en este checkpoint. Si su índice deja de caber en una invocación, deberá añadir
un adaptador durable propio bajo el mismo principio, no reutilizar tipos falsos.

El navegador conserva la intención reanudable por la huella exacta de filtros.
Doble clic comparte la promesa; cambiar filtros durante esa intención falla
antes de crear otra UUID. Si se pierde la respuesta, una lectura `refresh=false`
reconcilia el estado autoritativo: mantiene «Continuar» únicamente mientras
Postgres conserva la intención activa y lo limpia cuando ya es terminal. Esa
lectura nunca llama proveedores, no inicia refresh y no convierte el snapshot
anterior en una consulta fresca.

Mientras la intención no sea terminal, el coordinador conserva en
`sessionStorage` únicamente su UUID y los seis filtros de identidad. No persiste
JWT, Auth, respuestas, payloads de proveedor ni credenciales. Una recarga
restaura esos filtros, hace una lectura sin refresh y elimina la memoria cuando
Postgres confirma estado terminal.

`parent_offset` y `reconciliation_offset` pertenecen solo a la proyección de
lectura. No forman parte de la huella durable del refresh: cambiar de página
conserva la misma UUID activa y nunca crea, interrumpe ni oculta una intención.

Las candidatas saneadas se sellan en un manifest de hasta 480 elementos y se
dividen en lotes durables de hasta 24. Cada elemento conserva ordinal e
`eligibility_attempt_id`; un replay exacto no crea otro check, cuarentena,
evento o histórico. La promoción procesa todos los lotes dentro de un único
commit; una fila inválida se aísla una sola vez y un fallo técnico revierte la
promoción sin exponer una familia parcial. El cursor no vive en el navegador ni
en la respuesta de una Edge.

El circuito se serializa por proveedor y capacidad, con un único probe
`half_open`. La finalización bloquea intención, circuito y snapshot, y crea una
sola fila de histórico. Un intento fallido conserva `last_success_at`, recuento
y candidatas del último resultado válido sin extender sus fechas de
elegibilidad ni presentarlo como un fetch nuevo.

### Contrato de incidencias y progresión del artefacto

`atinara-market-issue-v1` es distinto del Registry V2.1. Registry continúa
siendo la configuración estática y hasheada de issues/estrategias/herramientas;
el ledger V6 registra ocurrencias concretas y no altera su versión o huella.

Una incidencia contiene `issue_id`, `issue_code`, detector, responsable,
severidad, reparabilidad, alcance de bloqueo, campos, evidencia técnica segura,
valores actual/propuesto, confianza, versiones, huella, estado, capacidad de
retry y `next_action`. El estado efectivo se deriva de eventos append-only
`open → in_progress|waiting → resolved|superseded`; la ocurrencia original no se
actualiza. La misma `issue_id` se enlaza de forma append-only a candidata, run
experto, borrador, intento de revisión/reparación o publicación.

Un alcance `approval` permite que el expediente pase de Radar al Editor, al
formulario y al borrador privado, pero impide `review_approved`. Un alcance
`publication` conserva borrador, revisión y confirmación y devuelve el
expediente al agente señalado. Solo `terminal` detiene la creación del borrador.
Todo estado no terminal declara un responsable y siguiente acción; ningún
botón puede quedar deshabilitado sin explicación o alternativa.

### Contrato temporal y datos ausentes

`atinara-temporal-contract-v1` conserva `raw_source_dates` con proveedor,
alcance, nombre de campo, valor original, instante parseado, semántica declarada
y versión de adaptador. La proyección canónica (`evaluation_ends_at`,
`forecast_closes_at`, `resolution_deadline`, zona y evidencia) es independiente
y posee su propia huella. `fetched_at` no cambia esa decisión; una fecha o
semántica material sí la cambia y exige revalidación.

`source_close_at`, `close_time`, `endDate` o expiraciones del proveedor son
datos de origen y nunca obtienen autoridad contractual por fallback. Una
frontera explícita de pregunta solo produce fechas Atinara en familias
temporales compatibles. Sin evidencia suficiente, la proyección permanece
nula, se crea `TEMPORAL_AUTHORITATIVE_DATE_REQUIRED` y el borrador privado
continúa hacia Corrector sin poder aprobarse o publicarse. La interfaz no asigna
una zona IANA implícita.

Los conversores numéricos compartidos preservan `null`, `undefined`, vacío y
espacios como ausencia; `0` sigue siendo un cero real. La interfaz muestra
`Sin precio disponible` y nunca sustituye un dato ausente por `0 %`, `50 %` o
otra probabilidad inventada.

### Contenido y huella

`private.market_draft_canonical_payload` produce el único payload editable canónico. La política `sha256-canonical-v2`:

- normaliza CRLF/CR a LF, espacios equivalentes, extremos vacíos y `null`;
- representa todos los instantes en UTC con precisión estable de milisegundos;
- conserva la zona IANA como un campo semántico separado;
- ordena recursivamente los objetos JSON;
- deduplica las fuentes alternativas por URL y las ordena cuando el orden no tiene significado;
- conserva roles y precedencias en el Plan de Resolución, donde sí son semánticos;
- incluye los campos editables que no siempre están visibles en la pantalla.

El frontend renderiza `datetime-local` con `step="0.001"` y envía `_timestamp_precision="milliseconds-v1"`. Así se distinguen una edición deliberada a `:00.000` de un cliente antiguo que solo sabía enviar minutos. Los clientes antiguos conservan temporalmente la protección `market_datetime_preserve_precision`; los nuevos envían y aceptan el instante exacto.

### Versiones materiales

`private.market_draft_versions` conserva un snapshot fuente y otro canónico por `(draft_id, content_version)`, su SHA-256, política, esquema, origen, actor, fecha y evidencia de recuperación. Un trigger impide `UPDATE` y `DELETE`.

Un guardado cuyo payload canónico coincide es un no-op: no cambia la fila, no incrementa `content_version`, no crea snapshot y conserva revisión y confirmación. Restaurar una versión siempre crea una versión material nueva y referencia `restored_from_version_id`; nunca reescribe el pasado.

### Revisión efectiva e intentos

`private.market_review_attempts` registra cada ejecución, incluidos `invalid_response`, cuota, timeout, 5xx, red, autenticación del proveedor y respuestas obsoletas. `private.market_effective_reviews` registra por separado el último veredicto aprobado que puede gobernar el contenido actual.

Una incidencia técnica solo actualiza el último intento. Si existe una aprobación aplicable, el borrador conserva `review_approved` o `human_confirmed`; si no existe, queda `draft_ready`. Una incidencia nunca se convierte en rechazo de contenido y nunca abre el Corrector Experto.

Una revisión es reutilizable únicamente si coinciden la huella canónica, `policy_version`, `schema_version`, una entrada vigente y reutilizable de `market_review_policy_compatibility`, y no existe revocación. La recuperación puntual del incidente de precisión se identifica mediante una base de compatibilidad explícita, exige el antiguo MD5 exacto, el binding vigente y un diff limitado a `evaluation_ends_at`/`closes_at`.

### Confirmación y publicación

La confirmación humana queda unida a la huella y al `effective_review_id`. Repetir exactamente la misma confirmación es un no-op. Cualquier cambio material la borra. Publicar o programar vuelve a comprobar dentro de la misma transacción:

- versión esperada;
- SHA-256 actual;
- aprobación efectiva vigente;
- confirmación para esa huella y esa revisión;
- compatibilidad del Plan de Resolución;
- periodo todavía abierto;
- procedencia Radar inmutable, cuando exista;
- comprobación factual v2 `revalidate` vigente, `unresolved` y enlazada por
  candidata, revisión, política, contexto, evidencia y huellas;
- rol administrativo.

## Concurrencia e idempotencia

Cada guardado usa `expected_version` y una UUID de idempotencia. `private.market_workflow_requests` vincula actor, operación, clave y hash de petición. Repetir la misma petición devuelve la respuesta guardada; reutilizar una clave con otro payload falla; dos claves concurrentes sobre la misma versión se serializan mediante `FOR UPDATE` y solo una puede mutar. Radar añade intención, lease, manifest, lote y finalización; dos sesiones sobre la misma intención producen un único claim y un único histórico.

Official Opportunity Discovery aplica la misma propiedad antes de cualquier red externa. El navegador conserva una UUID por intención; `begin_official_opportunity_discovery_v2` crea como máximo un `data_provider_runs` por UUID/actor/huella y los replays observan `in_progress` o el resumen terminal. Cada nueva reclamación reconcilia primero cualquier lease oficial vencida como `OFFICIAL_DISCOVERY_REQUEST_INTERRUPTED`, incluso si la intención posterior usa otra UUID. `finish_official_opportunity_discovery_v2` bloquea esa fila y rechaza primero una finalización cuyo lease haya vencido; un replay terminal retorna antes de tocar señales. Una intención distinta puede insertar o refrescar una señal solo si su payload validado cambió; un payload idéntico es no-op y evidencia crítica distinta marca el análisis previo como `stale`. Una intención interrumpida termina explícitamente y requiere una UUID nueva para otra ejecución humana.

Las revisiones usan una UUID de intento, una restricción de intento activo por versión y comprobación de versión/huella al finalizar. Una respuesta tardía se registra como `stale` y no pisa el estado nuevo. Los botones se bloquean durante la operación, pero la seguridad no depende del frontend.

## Recuperación

Para recuperar estado desde otro navegador se usa `get_admin_market_draft_v2`. Devuelve borrador, revisión efectiva, último intento, historial de intentos, snapshots, binding, fuentes con roles y precedencia, compatibilidad, auditoría e incidencias enlazadas. No se reconstruye autoridad desde caché local.

Una recuperación normal de una versión usa `restore_market_draft_version`. La reparación puntual del incidente heredado usa `restore_market_draft_review_memory`; falla de forma cerrada si no puede demostrar la equivalencia y nunca llama a Gemini, confirma ni publica.

## Separación de lectura, análisis y avance

Desde `harden_expert_market_cycle_v1`, leer y analizar una candidata Radar nunca
reservan una revisión ni sustituyen su hecho autoritativo. Son operaciones
distintas:

- `get_market_intelligence_origin` devuelve siempre un expediente administrable
  y un `advancement_gate`; un bloqueo factual impide avanzar, no diagnosticar.
- `market-expert` puede guardar un dictamen bloqueado, pero solo un paquete
  vigente con ambas capacidades explícitas permite iniciar `prepare`.
- un `prepare` negativo se registra mediante
  `record_market_radar_prepare_attempt_v1` como snapshot append-only desligado;
  el puntero, la revisión y el estado autoritativos permanecen sin cambios;
- la persistencia del Radar aísla solo errores de fila y deja visibles los IDs
  externos cuarentenados o diferidos; cada final de proveedor queda en historia
  append-only además del snapshot operativo;
- el Corrector solicita primero una revisión v3 compatible con versión, huella,
  política y esquema. Un rechazo v2 puede mostrarse como historia, pero nunca
  entra en `repairable_content_issues` ni borra campos de inferencia.

Estas reglas no suavizan ninguna puerta: preparar, guardar, confirmar, programar
y publicar siguen revalidando sus contratos autoritativos en el backend.

## Memoria de AI Gateway y Agent Engine V2.1

Las inferencias y las decisiones de dominio son memorias distintas:

- `private.ai_invocation_attempts` conserva solo metadatos, lifecycle y fingerprints; nunca el prompt, input o output.
- `private.market_agent_runs` y `private.market_agent_steps` conservan identidad de registry, tool, estado, huella de progreso y resumen acotado.
- La revisión, borrador, binding, confirmación, publicación y resolución siguen viviendo en sus tablas autoritativas existentes. Una traza de agente no acredita ninguno de esos estados.
- `AI_TELEMETRY_WRITE_FAILED` no cambia una respuesta válida, no crea un retry de inferencia y deja la muestra fuera de métricas.
- Reservas de proveedor son idempotentes por invocation/proveedor/tarea/día UTC y no sustituyen locks, CAS o idempotencia del dominio.
- Runs, steps e intentos no admiten `UPDATE`; los roles API tampoco admiten `DELETE`. La purga usa cutoffs internos de 90/180 días y se audita.
- Un run registra la versión y hash de registry. Si SQL y handlers divergen, el runtime falla antes de ejecutar herramientas.

El rollback a v1 cambia el modo de transporte o el bundle de una Edge, pero no borra estas memorias ni desactiva RLS. La tabla registry combinada v1 y los wrappers v1 se conservan.

## Inventario de escrituras

| Acción | Inicio | Backend autoritativo | Versión / concurrencia | Atomicidad e idempotencia | Doble clic / retry | Auditoría y resultado |
|---|---|---|---|---|---|---|
| Guardar manual | `admin-markets.js` | `save_market_draft` | `expected_version`, `FOR UPDATE` | Transacción única; UUID y hash; no-op canónico | UI bloqueada; replay o `DRAFT_VERSION_MOVED` | Snapshot solo material; auditoría de cambio o no-op |
| Preparar desde Radar | `admin-markets.js` | `save_market_draft_from_radar` | Versión del borrador y lock de candidata | Guarda y reserva candidata en una transacción; misma UUID | Una sola reserva; replay exacto no reescribe procedencia | Procedencia y `RADAR_DRAFT_PREPARED` |
| Actualizar Radar | `radar-refresh-request.js` | Edge `market-radar` → intención/checkpoint de proveedor/lotes/finalización v2/v4 | UUID, actor, huella, lease, índice de padres, manifest y cursor | Claim antes de red; checkpoint e IDs diferidos durables; un histórico/snapshot | Doble clic comparte intención; transporte ambiguo se reconcilia por lectura; replay no repite catálogo, lote ni final | Candidatas/checks/cuarentenas aislados; salud por capacidad |
| Radar + Agente Editor | puente de `admin-markets.html` | `save_market_draft_from_radar_intelligence` | Versión, candidata, ejecución experta y binding | Guardado, procedencia y binding en una transacción | Botón bloqueado; replay exige UUID, contrato, fuentes y binding exactos y no escribe | Dictamen y Plan de Resolución vinculados; nunca publica |
| Borrador con incidencias | puente del Editor | `save_market_draft_from_expert_with_issues_v2` (`v1` delega por compatibilidad) | Candidata, run, familia v4/v5 e `issue_id` exactos | Crea borrador privado y enlaces append-only; no concede binding de elegibilidad | Replay exacto conserva una sola ocurrencia | Responsable, bloqueo y siguiente acción sobreviven al handoff |
| Descubrir oportunidades oficiales | `admin-markets.js` | Edge `data-observatory` → `begin/finish_official_opportunity_discovery_v2` | UUID, actor, huella e índice único antes de red | Una fila técnica; `FOR UPDATE`; insert o refresh condicional; payload idéntico no-op | Doble submit comparte promesa; retry ambiguo reutiliza UUID; replay no entra en red | `success`, `zero_results`, `partial` o `technical_failure` sin consulta, HTML ni URL fallida |
| Datos y tendencias | `admin-markets.js` | `save_market_draft_from_intelligence` | Solo creación y ejecución experta válida | Guardado y binding en una transacción; UUID obligatoria | Una sola creación | Origen, contrato, fuentes y feedback persistidos |
| Aplicar propuesta del Agente Editor | `admin-markets.js` / puente | RPC anteriores y `bind_market_draft_intelligence` | Versión y origen inmutables | Binding repetido compara contrato+fuentes y hace no-op | UI bloqueada; mismatch falla | Plan versionado si cambia |
| Corrector Experto | `market-draft-fixer.js` | Edge `market-draft-fixer` → check PRIMARY v1 → `begin_market_draft_repair_workflow_v1` → `apply_market_draft_expert_repair_with_checkpoint_v1` o checkpoint no-op → Edge `validate-market-draft` → `complete_market_draft_repair_workflow_v1` / reconciliación | `expected_version`; issue IDs exactas; fuente primaria atestada; orden `candidate → workflow advisory → draft → attempt`; el resultado antiguo no puede guardar | Checkpoint, apply, transición y proyección quedan recuperables; replay sella una finalización ya aplicada sin otra inferencia | UI bloqueada; como máximo una versión; retry reanuda o falla cerrado | Solo issues del owner Corrector; propuesta, fuente, campos, binding y review attempt enlazados; nunca confirma/publica |
| Solicitar revisión | `admin-markets.js` | Edge `validate-market-draft` → `begin_market_draft_review_v2` → `record_market_draft_review_with_issues_v1` | UUID de intento; lock de borrador; versión/huella y check PRIMARY exacta | Inicio, issues, enlaces al `review_attempt` y finalización idempotentes; respuesta tardía `stale` | Botón bloqueado; replay lee las issues autoritativas; un retry técnico crea otro intento | Intento técnico/contenido separado de revisión efectiva; terminal prevalece en fresh y replay |
| Confirmar revisión | `admin-markets.js` | `confirm_market_draft_review_v2` | `expected_version`, huella, revisión, binding e issues `human_confirmation`/terminal | Wrapper estructurado; confirmación repetida es no-op; `force_review` compatible exige carry-forward auditado | Botón bloqueado; retry devuelve confirmación existente sin borrar blockers | `HUMAN_CONFIRMATION_RECORDED` o `HUMAN_CONFIRMATION_CARRIED_FORWARD`; nunca se atribuye una acción nueva al modelo |
| Programar / publicar | `admin-markets.js` / Edge `publish-scheduled-markets` | `publish_market_draft_v2` / `publish_due_market_drafts_v2` → revalidación PRIMARY service-only → writer canónico | Orden `candidate → workflow advisory → draft`; versión, aprobación, confirmación, binding, baseline e incidencias actuales | UUID de intento; check fresca comparada con baseline; dos workers reclaman con `FOR UPDATE SKIP LOCKED`; segundo pase programado solo tras atestación equivalente | Replay no duplica mercado; cambio vuelve a Corrector; baseline legacy vuelve al Validator; fallo técnico conserva autoridad | Programación/publicación y revalidación auditadas; un draft programado se edita solo después de cancelación explícita |
| Verificar binding | `admin-markets.js` | Edge `market-source-monitor` y RPC de binding | Lock/estado de binding y plan versionado | Resultado persistido en Supabase | UI bloqueada; repetir revalida, no crea mercado | Estado de validación y problemas trazables |
| Armar / pausar monitor | `admin-markets.js` | Edge `market-source-monitor` | Transición de estado comprobada | Cada transición es autoritativa | UI bloqueada; estados incompatibles fallan | Queda auditado; no resuelve y no activa el scheduler global |
| Capturar evidencia | `admin-resolution.js` | Edge `market-source-monitor` → snapshot/result RPC | Binding vigente; huella de evidencia | Snapshot y ejecución son persistentes; un valor ausente no se vuelve cero | Botón bloqueado; capturas repetidas son historial, no una resolución | Evidencia y paquete recuperables; nunca resuelve solo |
| Resolver mercado | `admin-resolution.js` | `analyze-market-resolution` → `approve-market-resolution` → `resolve_market_with_evidence` | Mercado abierto, análisis vigente y confirmación administrativa | Reparto y estado en una transacción; estado resuelto impide repetir | UI bloqueada; segundo intento no vuelve a repartir | Auditoría y evidencia; fuera del alcance de esta reparación |

## Escaneo ligero de otras escrituras

- **Corregido ahora:** guardados manuales, Radar, Observatorio, Agente Editor, binding, Corrector, revisión y confirmación usan memoria autoritativa o protecciones de replay/versionado coherentes.
- **Ya protegido:** participaciones y resolución usan transacciones y bloqueos en Supabase; candidatos Radar usan huellas/estado; snapshots y paquetes conservan historial; los schedulers permanecen desactivados salvo los jobs previamente existentes y autorizados.
- **Recomendación futura:** añadir una clave de idempotencia explícita de extremo a extremo a cada transición de monitor y a cada captura manual. Hoy sus estados, locks y restricciones evitan efectos económicos duplicados, pero una clave común facilitaría devolver exactamente la misma respuesta tras una pérdida de red.

## Reglas para funciones futuras

1. Toda escritura debe terminar en Supabase y usar una transacción para sus invariantes.
2. Un recurso versionado debe exigir `expected_version` y lock de fila.
3. Toda acción reintentable debe aceptar una UUID y guardar el hash de la petición y su respuesta.
4. Los no-op se detectan con la representación canónica, antes de incrementar versión.
5. Los fallos técnicos se registran como intentos y nunca como hechos del dominio.
6. Las respuestas de proveedor deben validarse antes de persistir y los logs solo pueden contener metadatos seguros.
7. Una aprobación, confirmación o binding debe declarar versión, huella, política y esquema.
8. Restaurar significa crear historia nueva enlazada a la anterior, no modificar snapshots.
9. Ninguna Edge Function de preparación, revisión, corrección o evidencia puede confirmar, publicar o resolver.
10. Toda función `security definer` fija `search_path`, comprueba rol y revoca permisos por defecto.
11. Toda inferencia usa el contrato común; la Edge no elige transporte ni aporta fingerprints.
12. Toda operación larga comparte un `absoluteDeadlineAt` y reserva tiempo para persistencia y respuesta.
13. Una capa interna versionada llama a la implementación preservada exacta; nunca reentra por un nombre público redefinible ni repite una guarda ya consumida.
14. Toda incidencia no terminal conserva `owner_stage`, `blocking_scope` y `next_action`; solo una condición `terminal` puede impedir crear un borrador privado.
15. Una fecha del proveedor conserva nombre y semántica originales; no se promueve por fallback a fecha contractual de Atinara.
16. Un refresco multi-etapa persiste intención y cursor antes de responder; un diferido que solo exista en memoria o en logs no es reanudable.
