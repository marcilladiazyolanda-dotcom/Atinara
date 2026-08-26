# Atinara

MVP de red social competitiva de predicciones gaming basada en Karma, Prestigio y rankings. **Atinara** es la marca pública; parte de la infraestructura y los identificadores técnicos conservan `Oraklo` como nombre interno para evitar cambios incompatibles.

Web pública canónica: https://marcilladiazyolanda-dotcom.github.io/Atinara/

Contrato operativo de los agentes: [`docs/ATINARA_AGENT_ENGINE.md`](docs/ATINARA_AGENT_ENGINE.md).

## Agent Engine V2.1 y AI Gateway · producción en `legacy_direct`

La arquitectura V2.1 y las cinco Edge coordinadas están desplegadas en producción con las cinco tareas fijadas a `legacy_direct`. Las cuatro rutas de inferencia activas llaman a un contrato común y Radar conserva cero inferencias y un contrato dormido de compatibilidad. Los modelos Gemini exactos permanecen disponibles mediante el adaptador legacy centralizado; la promoción a `gateway_gemini_parity` se hará tarea por tarea y todavía no está autorizada.

- Contratos, políticas, saneamiento, deadlines, validación determinista, presupuesto atómico y telemetría viven en `supabase/functions/_shared/ai/`.
- Agent Runtime v2 selecciona herramientas registradas, controla loops, replans, huellas y un único writer; nunca confirma, publica, resuelve o liquida.
- OpenRouter y NVIDIA NIM están apagados, con presupuesto cero y solo transports mock en CI. No existe dependencia productiva de endpoints gratuitos ni coste nuevo obligatorio.
- El benchmark público es offline y contiene solo fixtures `draft`; no existe ground truth aprobado ni proveedor adjudicado.
- Las tres migraciones V2.1 se aplicaron una sola vez en producción el 13 de agosto de 2026 y constan remotamente como `20260813163839`, `20260813163918` y `20260813163959`. No modificarlas ni repetirlas.
- Producción verificada el 26 de agosto usa Radar v72, Expert v26, Corrector v23, Validator v33 y Resolución v16, todas con `verify_jwt=true`. Corrector v23 y Validator v33 incorporan la reparación por 23 campos y la minimización de fuentes; el delta de reintento guiado por fase permanece local hasta completar su subida, despliegue acotado y E2E. OpenRouter y NVIDIA NIM siguen apagados, sin rutas ni presupuesto positivo.

Arquitectura: [`docs/ATINARA_AI_GATEWAY.md`](docs/ATINARA_AI_GATEWAY.md). Benchmark: [`docs/ATINARA_AI_BENCHMARK_TECHNICAL.md`](docs/ATINARA_AI_BENCHMARK_TECHNICAL.md). Operación y rollback: [`docs/ATINARA_AGENT_ENGINE_V2_RUNBOOK.md`](docs/ATINARA_AGENT_ENGINE_V2_RUNBOOK.md).

## Estado operativo de 13.5.2 · Radar v72 activo y E2E bloqueado antes de Expert

`origin/main = 58e47a89eb639285a9b0ca27b604b8fd2c2553c0` pasó Calidad de
Atinara, Deno, Pages y benchmark offline. Solo `market-radar` se desplegó como
v72, `ACTIVE`, con JWT obligatorio y digest
`5e95a578528355f92ced016d8aa1c5523d1931f00942d44679942f7d809d9116`.

El único refresh fresco, `c1f677eb-0dae-410f-820d-a4483601ab47`, terminó
Kalshi `completed/terminal` con 215/215 series, cero series fallidas, 590 padres
indexados, 24 padres seleccionados completos y 192/192 hijas descubiertas,
contabilizadas e identificadas. Persistió 162/162 candidatas, sin cuarentenas o
fallos; manifest
`085a5f169cd0f045c9ae867adba049b9b9937be1f02a79f02df6486d4537bae4`
y finalización
`aaab476f8b372eaafcfc41b2533af878ebec28f308bf2cbe71aa860a204cf5`.
Las recuperaciones reutilizaron la misma UUID y no se inició otro refresh.

V72 conserva la revisión humana `in_domain` exacta de la candidata
`1aa9b332-07d9-4dff-a2e3-d98a7066237e` y alcanza el escaneo oficial. Sus dos
intentos controlados, `0488f6b7-ee48-4cb9-853e-2b357101e64a` y
`bc5b79e8-8338-4f09-a020-36405b32957d`, fallaron igual con HTTP 503 y
`ELIGIBILITY_SCAN_UNAVAILABLE`; no hubo un tercer retry.

La causa general combina identidad y continuidad de evidencia. El artículo
inglés `another` quedaba truncado tras un verbo español, de modo que la familia
persistía `nother gta vi`. El escaneo tampoco reconocía una descripción
audiovisual equivalente con `will premiere` y fecha oficial sin año, y una URL
auxiliar fallida mantenía incompleto el grupo aunque existiera prueba oficial
exacta de un estreno futuro dentro del contrato.

La corrección incremental conserva el artículo completo, deriva el sujeto desde
la familia vigente, liga sujeto/predicado/fecha y permite continuar únicamente
si todas las candidatas tienen cobertura oficial determinista antes de su
frontera contractual. Otro sujeto, una afirmación terminal o una fecha fuera
del contrato fallan cerrados. Pasa 219/219 pruebas focalizadas y 58/58 de
reconciliación general, 9/9 Edge con Deno 2.1.14, sintaxis de 128 JavaScript y
la página oficial real. Véase
[`docs/ATINARA_RADAR_OFFICIAL_EVIDENCE_CONTINUITY_FIX_20260826.md`](docs/ATINARA_RADAR_OFFICIAL_EVIDENCE_CONTINUITY_FIX_20260826.md).

La corrección no está integrada ni desplegada. No se llamó Market Expert y
continúan exactamente seis borradores. Tras subirla y desplegar solo Radar será
necesario exactamente un refresh Kalshi nuevo para sustituir la identidad stale;
no debe reintentarse la preparación sobre el snapshot actual.

## Historial operativo · Radar v69 y checkpoint de discovery

El corte remoto de aquel hito era `origin/main =
ddf61bb7667fc209377f2ea120d469b66f2ad65f`. La migración de aislamiento de
batches consta aplicada una sola vez en producción como `20260825203949` y solo
`market-radar` se desplegó como v69. El refresh administrativo
`39a1656e-61af-4674-a4e0-fa0896236507` terminó `partial/terminal` con
`claim_count=3`; no se creó otra intención.

Kalshi conservó 11 padres y 148/148 hijas identificadas: nueve padres
`complete`, dos `provider_unavailable` y cero identidades perdidas. El parent
manifest es `c197e3ac8565ae36465023c59d942b2abcc949b98ca1a8fbbe717935e28c7428`.
Los dos batches de 24 que agotaron el timeout quedaron `superseded` y sus cuatro
hijos de 12 se completaron; los otros batches de 24 y 14 también terminaron.
Expected, processed y accepted son 86, cuarentenas y fallos son cero. El manifest
de candidatas es `7b9f65509641a3f3dc916a6d55168c61526100cc8b625821fcaab10aafc5e1bb`
y la finalización es
`62d641016b4b91bc79047d2cf28ab8cf7722d117a8962a318f403b3eda504f6f`.
Tavily quedó `technical_failed` como `source_enrichment`, con
`blocking_scope=none`, sin degradar Kalshi ni impedir manifest, batches o
finalización.

La auditoría general posterior encontró una limitación distinta: la Edge v69
solo prioriza 25 de 109 series de «Video games» y vuelve a diferir las mismas
84. El alcance público vigente contiene 215 series gaming —109 de
Entertainment/Video games y 107 de Sports/Esports, con una coincidencia— y 515
padres abiertos. El recorrido completo por el host recomendado de Kalshi agotó
las 215 series, con backoff de 429, 515 padres únicos y cero errores finales;
un escaneo global sin `series_ticker` no es utilizable porque siguió abierto tras
10.000 eventos y 50 páginas.

El commit remoto integra la corrección que sella primero un checkpoint privado,
append-only y service-only de hasta 2.000 series/padres, libera el lease y
reanuda la misma UUID para enumerar familias sin repetir el catálogo. Incluye
Video games y Esports, reintenta solo series fallidas, registra todos los IDs en
el ledger y resume la respuesta pública para no superar 900 KB. Polymarket usa
seis búsquedas temáticas —una por categoría Atinara—, deduplica padres y aísla
búsquedas o familias fallidas. La lectura del catálogo reintenta una sola vez
los 500/504/57014 transitorios; la UI reconcilia por lectura un transporte
ambiguo, bloquea cambios de filtros mientras la petición está activa o existe
una UUID reanudable y nunca crea una segunda intención por doble clic o
búsqueda. Los offsets de paginación no forman parte del hash durable y, por
tanto, navegar conserva la misma actualización activa. Una recarga recupera de
la sesión solo UUID y filtros, nunca credenciales ni respuestas, y los reconcilia
mediante lectura antes de ofrecer una acción nueva.

El contenido remoto coincide byte por byte con las 16 rutas entregadas, pero no
está desplegado ni aplicado: la Action funcional del commit falló antes de Deno
porque `admin-markets.html` mezcló dos versiones de caché pública. La corrección
incremental pendiente eleva de forma atómica los recursos compartidos de las
diez páginas bajo `20260825-radar-provider-checkpoint1`. La implementación Radar conserva Deno
2.1.14 verde, 153 pruebas focalizadas, 183 pruebas de las cinco suites
afectadas, 232 regresiones de Radar→Expert/Editor/Corrector y 19 contratos SQL
estáticos. La migración completa se ejecutó contra PostgreSQL real dentro de
una transacción terminada en `ROLLBACK`, y se comprobó que tabla y funciones no
quedaron instaladas. No se inició otro refresh, no se llamó Market Expert y los
seis borradores productivos permanecen intactos.

Madden NFL 27 y EA Sports FC27 están correctamente marcados
`EVENT_ALREADY_RESOLVED` mediante evidencia oficial aunque Polymarket los
mantenga abiertos; aportan cero candidatas. La regla es general para anuncios,
lanzamientos, hitos, premios, métricas y otros hechos, y rechaza rumor o
especulación como evidencia. No usa Gemini ni nombres hardcodeados.

Especificación de la reconciliación:
[`docs/ATINARA_RADAR_PARENT_RECONCILIATION_V1.md`](docs/ATINARA_RADAR_PARENT_RECONCILIATION_V1.md).
Incidencia y activación actual:
[`docs/ATINARA_RADAR_BATCH_TIMEOUT_ISOLATION_FIX_20260825.md`](docs/ATINARA_RADAR_BATCH_TIMEOUT_ISOLATION_FIX_20260825.md).
Corrección de la puerta CI v4:
[`docs/ATINARA_RADAR_CI_V4_CONTRACT_FIX_20260825.md`](docs/ATINARA_RADAR_CI_V4_CONTRACT_FIX_20260825.md).
Checkpoint precedente:
[`docs/ATINARA_RADAR_PARENT_CHECKPOINT_FIX_20260825.md`](docs/ATINARA_RADAR_PARENT_CHECKPOINT_FIX_20260825.md).
Corrección pendiente de cobertura y reanudación:
[`docs/ATINARA_RADAR_PROVIDER_DISCOVERY_CHECKPOINT_FIX_20260825.md`](docs/ATINARA_RADAR_PROVIDER_DISCOVERY_CHECKPOINT_FIX_20260825.md).
Corrección incremental de la puerta CI y caché pública:
[`docs/ATINARA_RADAR_CACHE_VERSION_CI_FIX_20260826.md`](docs/ATINARA_RADAR_CACHE_VERSION_CI_FIX_20260826.md).

## Estado vigente · cierre definitivo del ciclo experto

Atinara conserva su producto social de predicciones con Karma ficticio y, sobre
el mismo núcleo contractual, construye **Atinara Engine** como producto B2B. El
árbol incorpora el **Observatorio de Datos y tendencias**, un Agente Editor
compartido, el Corrector Autónomo y el **Agente Centinela** de fuentes. La
infraestructura principal de este hito está activada en producción; los
schedulers de descubrimiento y monitorización continúan apagados.

El backend coordinado está activo en producción. El build de GitHub Pages para
`ddf61bb` terminó correctamente, pero el HTML publicado mezcla
`20260825-radar-catalog-bound1` y `20260825-radar-provider-checkpoint1`; no debe
considerarse una entrega funcional aprobada hasta integrar la corrección que
unifica el corte de recursos en las diez páginas. El smoke anterior contra
Pages y el backend vigente confirmó el refresco real, el cooldown en tiempo real, el
aislamiento por proveedor, la exclusión exacta de opciones ya preparadas y las
opciones completas sin confirmar ni publicar mercados.

- `Datos y tendencias` ocupa la tercera pestaña de `Gestionar mercados`, entre
  el Radar y `Mercados publicados`. IGDB, Twitch y YouTube son proveedores
  aislados: la falta o el fallo de uno no bloquea los restantes.
- `market-expert` analiza tanto candidatas del Radar como señales del
  Observatorio bajo una sola Constitución versionada. Entrega JSON estructurado,
  separa hechos, contexto e inferencias, limita herramientas y nunca almacena
  cadena de pensamiento.
- El Radar usa `atinara-prediction-policy-v5`: un proveedor abierto sirve para
  descubrir, pero nunca demuestra que el hecho siga sin resolver. La puerta de
  elegibilidad conserva el evento canónico completo, vuelve a ejecutarse antes
  de preparar y antes de cualquier confirmación, programación o publicación, y
  registra decisiones privadas, append-only y ligadas a candidata, revisión y
  fuente. La antigua comprobación factual ya no bloquea el flujo operativo.
- El Corrector y el validador comparten una taxonomía cerrada y constructores
  para los diez arquetipos admitidos. Cada incidencia tiene una disposición
  explícita de reparación, investigación o escalado seguro. Las fuentes
  primarias deben estar registradas, ser alcanzables y demostrar en su contenido
  el sujeto y el predicado; pertenecer a un dominio conocido no basta.
- `market-source-monitor` captura evidencias versionadas para la revisión humana.
  Un error, un dato oculto o la ausencia de un valor nunca equivalen a cero o a
  un resultado. `ready_to_resolve` no liquida el mercado.
- La puerta de fuentes es aditiva: solo los borradores vinculados al nuevo
  sistema deben tener contrato vigente y, cuando corresponda, monitor armado.
  Los borradores manuales anteriores conservan su flujo.
- Las migraciones locales `20260809120000`, `20260809133000`, `20260809140000`,
  `20260809145000`, `20260809150000`, `20260809160000` y `20260809170000`
  forman el corte B2B vigente. La `140000` ya fue aplicada materialmente y su
  historial se reconcilió mediante `145000`: **no se debe ejecutar otra vez**.
  Las restantes también están aplicadas y registradas en producción. La
  corrección operativa `20260809180000_fix_radar_refresh_timeout.sql` también
  está aplicada y no debe repetirse.
- `market-radar` v54, `market-draft-fixer` v18,
  `validate-market-draft` v26 y `market-expert` v21 están activas con
  `verify_jwt=true`. Radar separa disponibilidad técnica, descartes de contenido
  y cuarentena por fila; Gemini conserva el último estado válido y no bloquea a
  los demás proveedores. Editor, Validador y Corrector comparten una taxonomía
  registrada y estrategias de reparación auditables e idempotentes.
- Producción registra tres migraciones nuevas, ya aplicadas y no repetibles:
  `20260809213543 · close_expert_market_cycle_v2`,
  `20260811100833 · harden_repair_evidence_and_idempotency_v3` y
  `20260811104727 · isolate_radar_poison_records_v4`. Sus archivos locales
  conservan los timestamps `20260809204739`, `20260811100833` y
  `20260811104727`, respectivamente.
- La puerta vigente se completó con la migración local no repetible
  `20260811163339_replace_radar_fact_gate_with_eligibility_v7.sql`, registrada
  remotamente como `20260811185229 · replace_radar_fact_gate_with_eligibility_v7`.
  El bootstrap histórico solo concede `technical_hold`; una fuente primaria
  exige registro y evidencia exacta, y una revisión material distinta invalida
  la procedencia del borrador.
- El cierre de agente y publicación añade cuatro migraciones no repetibles. Sus
  archivos locales `20260811221546_...v8`, `20260812012000_...v9`,
  `20260812014000_...v10` y `20260812015500_...v11` constan remotamente como
  `20260811230350`, `20260811231921`, `20260811232315` y `20260811232708`.
  V8 liga publicación a versión, huella, revisión, candidata y check exactos;
  v9 exige autoridad resolutiva del contrato exacto; v10 impide convertir
  errores reintentables en decisiones terminales; v11 proyecta los
  `technical_hold` como revisión pendiente, nunca como rechazo editorial.
- El borrador privado de regresión Marvel está reparado como versión 9 mediante
  reglas generales: `resolution_deadline` se deriva del periodo evaluado y la
  política temporal, las representaciones UTC/Europe-Madrid equivalentes no se
  contradicen, la atestación primaria vigente prevalece sobre una inferencia
  factual no respaldada y las fuentes de contexto se conservan por historial
  append-only. Su revisión efectiva es `approved`; continúa privado, sin
  confirmación, programación, publicación ni `market_id`.
- El smoke real con Radar v54 dejó Polymarket `available` con 48 procesadas y
  Kalshi `available` con 79. Tavily/Ideas gaming falló de forma aislada y
  reintentable; la UI mostró cobertura degradada y conservó los contratos
  oficiales útiles. Marvel ofreció 12 opciones elegibles y excluyó la opción
  `>95` ya ligada a su borrador. El cooldown bajó de 127 a 124 segundos en tres
  segundos. Madden NFL 27 permaneció terminal y oculto con evidencia oficial
  directa de EA; Best Multiplayer 2026 se clasificó como opciones no
  negociables, no como evento padre resuelto.
- La validación final pasa 358/358 pruebas, sintaxis de 74 JavaScript y
  TypeScript. Las matrices SQL v8–v11 pasaron en producción dentro de
  transacciones de prueba sin publicar ni tocar la economía. Las huellas
  canónicas permanecen idénticas a la línea base: 15 mercados
  `70d93479e2efe650e3623be40e9aee688216abdbe9866dd5f2a02f67da3ee137`,
  9 predicciones
  `170372fee7b857c67a51f2c3b33f9675f5b0b406c6040625520d2d6df2a3059c`,
  2 perfiles
  `8492fdfc993bc473e6a2d9f00924dc8b39b8650f196f86dcf049ed50a179f6bc`,
  15 estados LMSR
  `b3d1a0a27e6a7a754576057aba35c317c1b651388fe67ffceb13784472a0c927`
  y 17 precios
  `8eb3d854e5ff20eb7ccad96efcbabd4d7545e17ffa457e74630d6f2f2e0f7adf`.
  Karma total sigue en 2.932 y Prestigio total en 40.
- El advisor de seguridad devuelve 152 avisos: 49 `INFO` por tablas privadas
  con RLS y ninguna policy (cierre denegatorio intencional), 18 funciones
  `SECURITY DEFINER` anónimas de lectura pública, 83 funciones autenticadas con
  controles de administradora o propietaria, una recomendación preexistente de
  `pg_net` y la protección nativa de contraseñas filtradas. No existe una RPC
  mutadora pública sin control de identidad. La protección nativa requiere
  Supabase Pro; en Free, el formulario normal usa HIBP por k-anonimato y falla
  cerrado, pero no puede interceptar llamadas directas a Auth.
- Las credenciales de Twitch y YouTube no forman parte del repositorio. Deben
  configurarse, si Yol decide activarlas, únicamente como secretos de Supabase.
  Los dos schedulers preparados permanecen desactivados y son independientes.

La arquitectura, los contratos, la activación y las pruebas se documentan en
`EXPERT_MARKET_CYCLE_CLOSURE_20260810.md`; el estado productivo autoritativo se
conserva en `ORAKLO_PROJECT_CONTEXT.md`.

## Continuidad entre chats

- `AGENTS.md` contiene las instrucciones permanentes que Codex debe aplicar al trabajar en esta carpeta.
- `ORAKLO_PROJECT_CONTEXT.md` recoge el estado técnico, decisiones, roadmap, restricciones y comprobaciones necesarias para retomar el proyecto en un chat nuevo.
- `LIVE_MARKET_ECONOMY.md` define el contrato económico aprobado del precio vivo y `STEP_13_3_LIVE_MARKET_PENPOT_OVERRIDES.md` corrige los supuestos anteriores que no deben llegar al diseño definitivo.
- Antes de editar, hay que leer estos documentos vinculantes y comprobar el estado actual de Git; el transcript anterior no debe ser la única fuente de contexto.

## Antecedente histórico · Radar v17

Registro histórico del 7 de agosto de 2026. No describe el estado vigente ni
contiene instrucciones ejecutables.

El Radar v16 está publicado y aceptado en `origin/main = 8255fd50645a6faea2131790c67c83288b8cae54`. Sobre esa base, el Radar v17 está implementado **solo en local** y pendiente de activación manual de Yol. Mantiene `atinara-radar-v2` para no repetir ni ampliar el esquema y añade la política funcional `atinara-prediction-policy-v3`: una fecha anunciada informa la probabilidad, pero no invalida un umbral futuro; un lanzamiento o anuncio puede predecirse aunque el producto no esté anunciado; un premio o una reseña sí exige que el sujeto exista; y un resultado publicado por el proveedor se archiva como resuelto.

V17 descarta estados cerrados, resueltos, no binarios o inválidos antes de Tavily y Gemini; además consulta directamente un máximo acotado de resultados históricos de Kalshi para corregir descartes antiguos como Halo. La auditoría oculta por defecto eventos resueltos y evaluaciones del criterio anterior, permite filtrar por motivos en español y nunca muestra códigos internos. Las tarjetas con una sola opción ocupan las dos columnas y `Detalles` y `Abrir evento original` usan la misma jerarquía visual que `Preparar`.

En aquel hito no hubo una migración nueva ni cambio de secretos. Sus migraciones
quedaron aplicadas y su activación coordinada desplegó primero la Edge Function,
publicó después los recursos `v=20260807-radar3` y terminó con una actualización
explícita de fuentes. No repetir ahora esa secuencia histórica.

Yol cerró el Paso 13.3 el 3 de agosto de 2026. La identidad oficial de la beta v0.1 es `A3 · Criterio modular` y la dirección cromática definitiva es **Atinara Sunset**. El sistema aprobado se implementa con SVG centralizados en `assets/brand/`, tokens CSS canónicos, cabecera tinta con línea Sunset, superficies claras, `Sí` turquesa, `No` coral y el glifo de Karma después de cada cantidad compacta.

El árbol canónico ya contiene la administración cotidiana de mercados con puerta automática cerrada, programación protegida, trazabilidad, guardas temporales de resolución, recuperación completa de contraseña, buscador real, accesibilidad y responsive. También conserva íntegros el LMSR vivo, la privacidad y la compatibilidad histórica de `legacy_fixed_v1`.

El Paso 13.5 incorpora un Radar privado dentro de `Gestionar mercados`. Polymarket y Kalshi se consultan mediante endpoints públicos; Tavily y Gemini se reutilizan solo desde la Edge Function cuando sus secretos ya estén configurados. Las candidatas se filtran a gaming, se normalizan, reciben un score transparente, se comparan con mercados y borradores y pueden pre-rellenar el formulario existente. La administradora debe revisar y guardar el borrador; el Radar nunca publica, aprueba, programa, crea participaciones ni altera precios.

El Radar v16 continúa activo y aceptado técnicamente con JWT obligatorio. V17 conserva la autorización administrativa, el fallo cerrado, la preparación privada y la revisión humana: no publica mercados, no crea participaciones y no modifica Karma, Prestigio ni la economía LMSR. El contrato y el registro histórico están en `STEP_13_5_MARKET_RADAR_AND_CATALOG.md`.

La corrección frontend preparada como `v=20260805-mobile1` resuelve una regresión
de especificidad que mantenía la cabecera y las tres columnas de escritorio en
teléfonos. En 320–620 px la cabecera usa dos filas ordenadas, las categorías y
filtros se agrupan sin desplazamiento horizontal y el catálogo muestra una
tarjeta completa por fila. La validación cubre las diez páginas a 320, 360,
375, 390 y 768 px sin desbordamiento global. Esa corrección ya forma parte de
la base canónica `b10f0eb` usada para el Paso 13.5.1.

## Mercado predictivo vivo · activado en producción

Atinara usa en producción un creador automático de mercado LMSR con Karma para que `Sí` y `No` formen un precio colectivo real y siempre sumen 100 %. La migración `20260801172543_add_live_prediction_market_model.sql` fue aplicada una sola vez el 1 de agosto de 2026 y el frontend coordinado se publicó inicialmente en `f7aac42`. No se debe repetir la migración.

- Cada mercado nuevo empieza al 50/50 y usa `b = 2000 Karma` durante la beta.
- Antes de confirmar, Supabase cotiza impacto, precio medio, contratos, retorno base, bonus de dificultad y Prestigio.
- La versión del mercado y el precio máximo revisado protegen frente a una confirmación con una cotización antigua.
- Cada contrato acertado nuevo liquida a 1 Karma y el bonus se añade por separado. El antiguo tope `×10` solo permanece en predicciones anteriores.
- La beta admite una sola posición bloqueada hasta la resolución. No incluye venta, salida anticipada, cambio de lado, órdenes ni mercado secundario.
- Las actualizaciones usan Broadcast de Supabase y una consulta periódica como respaldo, sin publicar identidad ni posiciones privadas.
- `data.js` fue eliminado en `4ccd97e`: no existe en `origin/main`, su URL pública devuelve 404 y ante un fallo se muestra un error honesto con reintento, nunca mercados de demostración.

La fotografía de activación fue de 11 mercados, 11 estados LMSR, 11 puntos históricos iniciales y 7 predicciones heredadas `legacy_fixed_v1`; no cambió ningún contrato anterior ni los saldos agregados de Karma y Prestigio. La aceptación pública de escritorio confirmó datos reales, `Sí + No = 100 %`, un único punto honesto sin movimiento, los cinco rangos temporales, cotización de solo lectura para invitadas y ausencia de controles de compraventa. No se creó ni modificó ninguna predicción durante la comprobación.

La limpieza completa se publicó en `a5c633b` y GitHub Pages ya sirve `v=20260801-market2`. Esa versión oculta a invitadas el Karma, Prestigio y rango provisionales que la cabecera mostraba como si fueran datos de cuenta. La aceptación pública de escritorio superó portada, Comunidad, clasificación, perfil público, ficha abierta y ficha resuelta con datos reales y sin errores propios de Atinara.

La aceptación móvil real se ejecutó a 320 × 568, 375 × 667, 390 × 844 y 768 × 1024. Producción reveló un desbordamiento global a 320 px y otro en la ficha resuelta a 375/390 px por URLs largas. El árbol de cierre elimina el mínimo rígido del elemento raíz y permite partir esas URLs; las seis superficies públicas superan después la comprobación visual local a 320 y 375 px, sin ocultar pregunta, precios, gráfica, rangos, cotización ni acciones. Los cinco rangos responden por interacción, el único punto continúa siendo honesto, el foco es visible, los controles tienen nombre accesible y no aparecen métricas privadas ni compraventa. Confirmar como invitada abre el acceso sin enviar formularios ni crear datos.

Una nueva comprobación administrativa de Supabase, exclusivamente de lectura, volvió a confirmar 11 mercados, 11 estados LMSR, 11 puntos iniciales, 7 contratos heredados —5 activos— y 0 contratos `lmsr_v1`. Todos los estados continúan en versión 0, las probabilidades suman 100 %, `b = 2000`, la firma antigua sigue ausente y las tablas internas y la resolución permanecen protegidas. No se creó ni modificó ninguna predicción.

## Resolución asistida por IA

- `admin-resolution.html` es el panel privado de revisión de mercados cerrados.
- `analyze-market-resolution` recopila fuentes anteriores al cierre y envía una proyección mínima a la tarea `market_resolution_analysis` del AI Gateway. La ruta de compatibilidad conserva Gemini 3 Flash Preview y `Interactions → generateContent`.
- `approve-market-resolution` exige una administradora autenticada y ejecuta la resolución atómica en Supabase.
- La IA nunca puede resolver por sí sola: una persona debe revisar las fuentes, elegir el resultado y confirmar la liquidación.
- Si la ficha usa referencias como «último» o «próximo» sin identificar una fecha concreta, el sistema propone `Anulado`, explica la ambigüedad y usa la ficha original como evidencia. La anulación sigue necesitando confirmación humana.
- Si el mercado está definido pero la búsqueda no encuentra pruebas suficientes, muestra `No concluyente` sin convertirlo en un error técnico ni habilitar una resolución insegura.
- Si la investigación o el análisis no están disponibles, el panel conserva el estado y permite una resolución manual protegida que también exige fuentes HTTPS y revisión humana.
- Las fuentes aprobadas y la explicación quedan visibles en la ficha pública del mercado.

Las claves se configuran únicamente como Edge secrets y nunca se añaden al frontend o al repositorio. El frontend no conoce el proveedor, modelo, error crudo, payload ni presupuesto.

## Radar administrativo de mercados · Paso 13.5

- `admin-markets.html` conserva `Crear manualmente` y añade una pestaña `Radar de mercados` únicamente para administradoras.
- `market-radar` centraliza las consultas externas, valida el JWT y `oraklo_admin`, limita hosts, tiempo, tamaño, reintentos y consumo, y conserva resultados parciales cuando una fuente falla.
- Polymarket usa `GET /public-search`; Kalshi parte de `GET /series` con `Entertainment + Video games` y consulta sus mercados abiertos. No se consultan posiciones, traders, wallets, órdenes o perfiles externos.
- La ruta operativa del Radar es determinista y ejecuta cero llamadas de modelo. El contrato histórico de enriquecimiento permanece dormido y centralizado en el AI Gateway para compatibilidad, pruebas y una decisión futura explícita.
- El score de 0 a 100 separa popularidad relativa, relevancia gaming, claridad, actualidad, incertidumbre y novedad. Las probabilidades externas son referencia privada y nunca alimentan el LMSR de Atinara.
- `Preparar borrador` vuelve a comprobar estado y duplicados, muestra el origen de cada campo y rellena el formulario real. Los huecos no fiables permanecen vacíos; solo `Guardar borrador privado` persiste la propuesta y conserva la revisión semántica y confirmación humana existentes.
- La migración mantiene candidatas, estado de proveedores y procedencia en `private`, con RLS y permisos mínimos. No añade campos públicos a `markets`.
- IGDB no se activa en esta entrega porque no hay credenciales Twitch configuradas; queda como proveedor futuro documentado, sin exponer controles rotos.

## Rangos y clasificación

- El rango se calcula automáticamente desde el Prestigio histórico:
  - Observador: 0–99.
  - Intérprete: 100–249.
  - Analista: 250–499.
  - Visionario: 500–999.
  - Oráculo: 1.000 o más.
- `ranking.html` muestra la clasificación global real, estadísticas y progreso de rango.
- Las temporadas están preparadas, pero desactivadas durante el desarrollo.
- La configuración inicial exige 100 usuarios registrados y una activación administrativa explícita.
- Al empezar una temporada solo se reinicia su clasificación competitiva; el Prestigio histórico y el rango se conservan.

## Currículum predictivo

- `profile.html?id=<uuid>` muestra el perfil público real de un predictor.
- La portada prioriza identidad, rango y cuatro métricas esenciales. El resto se reparte entre las pestañas `Resumen`, `Historial` y `Logros` para evitar una ficha saturada.
- Incluye Prestigio, rango, posición global, precisión, aciertos, fallos, racha actual, mejor racha y especialidades.
- El historial público contiene exclusivamente predicciones ya liquidadas y enlaza a la resolución con sus fuentes.
- El Karma disponible y todas las predicciones activas o pendientes continúan siendo privados.
- Las anulaciones aparecen en el historial, pero no cuentan para la precisión, las rachas ni las especialidades.
- Las insignias están preparadas con estados bloqueado/conseguido; sus emblemas visuales definitivos se diseñarán durante el pulido final.
- La posición de temporada muestra «Temporada no iniciada» mientras el sistema siga desactivado.
- El usuario puede personalizar su username, biografía pública, categoría favorita, avatar simbólico y tema visual. La RPC de escritura solo permite modificar el perfil de `auth.uid()` y valida todos los valores en Supabase.
- Al pulsar el `@username` de cualquier cabecera se abre, sin abandonar la página, un menú flotante con el resumen de Karma, Prestigio y rango; accesos al perfil, personalización, mercados, predicciones y clasificación; ayuda, privacidad, panel administrativo cuando corresponda y cierre de sesión.
- Las RPC públicas usan una lista cerrada de campos, `search_path` vacío y permisos explícitos. Es intencionado que puedan atravesar RLS para publicar solo el currículum y los resultados liquidados; nunca devuelven el saldo actual ni filas activas.

La personalización se materializó mediante el archivo:

`supabase/migrations/20260715020000_add_profile_customization.sql`

Su esquema ya fue verificado en producción aunque el historial remoto antiguo
no sea completo. No ejecutar el fichero a ciegas; inspeccionar primero el estado
material y reconciliar historial si fuera necesario.

Los HTML llevan una versión de caché en los recursos locales para que GitHub Pages sirva conjuntamente la nueva estructura, estilos y scripts.

## Comunidad social · Paso 11 MVP

- `community.html` ofrece dos feeds estrictamente cronológicos: actividad pública de toda la comunidad y actividad de las cuentas seguidas.
- El feed mezcla únicamente comentarios visibles y predicciones ya liquidadas. Nunca publica predicciones activas, saldo de Karma ni relaciones privadas completas.
- Cada mercado tiene un debate real con comentarios de hasta 500 caracteres, una sola profundidad de respuesta, edición y borrado lógico del contenido propio y marca de spoiler.
- Los perfiles muestran contadores reales de seguidores y seguidos. La lista completa de cuentas seguidas y los silencios personales solo se entregan a su propietaria autenticada.
- La reacción positiva `Buena lectura` se puede añadir a comentarios y predicciones liquidadas de otras personas. No modifica Karma, Prestigio, rangos o clasificación.
- Los invitados pueden leer; escribir, seguir, reaccionar, silenciar o reportar exige autenticación.
- `admin-community.html` es una cola privada de moderación humana para revisar reportes, ocultar o restaurar comentarios y aplicar o levantar restricciones sociales temporales. Cada decisión queda registrada en una auditoría privada.
- Las tablas sociales tienen RLS y no conceden acceso directo a `anon` o `authenticated`: la API pública se limita a RPC con campos cerrados, `search_path` vacío y permisos explícitos.

El Paso 11 se activó una sola vez mediante:

`supabase/migrations/20260718143106_add_social_community_mvp.sql`

Después se aplicó la corrección del contador público real:

`supabase/migrations/20260718182915_expose_real_market_comment_counts.sql`

Ambas migraciones fueron aplicadas en producción y el MVP social se validó como invitada, con dos cuentas normales y con administradora el 18 de julio de 2026. La cuenta temporal de aceptación y sus datos se eliminaron al terminar.
No deben ejecutarse de nuevo.

La secuencia detallada de activación y pruebas está en `STEP_11_ACCEPTANCE_CHECKLIST.md`.

## Protección gratuita de contraseñas · Paso 11C

- El registro exige doce caracteres, minúscula, mayúscula, número y símbolo.
- `password-security.js` calcula SHA-1 dentro del navegador y consulta gratuitamente Pwned Passwords mediante k-anonimato.
- Solo se envían los primeros cinco caracteres del hash, nunca la contraseña ni el hash completo.
- La petición se realiza únicamente al enviar el alta, usa `Add-Padding: true` y no incluye cookies, credenciales, referente o cuerpo.
- Una contraseña filtrada bloquea el registro. Si HIBP no está disponible, el alta se detiene con un mensaje comprensible; el inicio de sesión existente continúa funcionando.
- El control de filtraciones protege el formulario normal, pero al ejecutarse en el cliente no sustituye una validación de servidor frente a llamadas directas a Supabase Auth.
- En Supabase Free deben configurarse por separado los requisitos de servidor: doce caracteres y la opción más fuerte de caracteres requeridos.
- Este paso no necesita SQL ni secretos.

La activación y la matriz de aceptación están en `STEP_11C_PASSWORD_SECURITY_CHECKLIST.md`.

## Calidad y observabilidad · Paso 12

El Paso 12 incorpora cuatro capas gratuitas sin sustituir la arquitectura del MVP:

- SonarQube Cloud: análisis automático de calidad, mantenibilidad y seguridad.
- GitGuardian: escaneo histórico y continuo de secretos mediante la aplicación de GitHub de solo lectura.
- Checkly: dos controles de disponibilidad y un recorrido público Playwright sin escrituras ni cuentas de prueba.
- Sentry: errores JavaScript en producción con PII desactivada, sin Replay, sin trazas y con redacción adicional antes del envío.

La configuración versionada, las cuotas elegidas, los datos que nunca deben enviarse y la secuencia de activación están en `STEP_12_TOOLING_CHECKLIST.md`.

La auditoría funcional histórica por roles que abre la preparación de la beta está en `STEP_13_FUNCTIONAL_AUDIT.md`. Las prioridades y los criterios de aceptación aprobados están en `STEP_13_2_PRIORITIES_ACCEPTANCE.md`: P0, P1 y P2 son obligatorios antes de la beta, incluida una puerta automática sin omisión que impide publicar mercados ambiguos o no resolubles y el contrato de precio vivo aprobado después de la auditoría.

Herramientas y activaciones posteriores:

- **Penpot:** el Paso 13.3 está cerrado y es la fuente visual de implementación. No reabrir identidad o paleta durante 13.4.
- **Mailjet:** la integración y las plantillas quedan preparadas documentalmente; SMTP propio debe configurarse manualmente antes de validar el envío real de recuperación.
- **PostHog:** al comenzar la beta cerrada y únicamente después de preparar consentimiento, eventos mínimos y privacidad.

### Backlog social posterior al MVP

Cuando Atinara salga del MVP, ampliar el Paso 11 de forma progresiva con: mensajes directos o chat; notificaciones por email o push; menciones; hashtags y tendencias; imágenes, vídeo, GIF y archivos; grupos o comunidades privadas; feed algorítmico; cuentas privadas y solicitudes de seguimiento; hilos con más profundidad; varias reacciones o votos negativos; recompensas sociales de Karma o Prestigio; y moderación o sanciones automatizadas con IA. Ninguno de estos puntos forma parte del MVP actual y deberá diseñarse y aprobarse antes de implementarlo.

Cuando llegue el lanzamiento, el umbral y la duración se pueden ajustar desde el SQL Editor con una cuenta administrativa. Esta llamada deja preparada la activación; la temporada solo comenzará cuando también se alcance el número indicado de perfiles:

```sql
select public.configure_oraklo_seasons(
  seasons_enabled_input => true,
  minimum_registered_users_input => 100,
  season_length_months_input => 3
);
```

## Estado visual aprobado

- `A3 · Criterio modular`, su favicon, el glifo de Karma y los doce glifos iniciales son activos aprobados para la beta v0.1.
- Atinara Sunset es la paleta definitiva del paso: fondo claro, cabecera `Brand Ink`, violeta para interacción y línea fina violeta–fucsia–naranja.
- Las mejoras ópticas futuras, la ampliación de avatares, emblemas o iconografía no bloquean la beta ni reabren el Paso 13.3.
- La implementación debe conservar la economía LMSR, los datos reales y la ausencia de compraventa; el diseño nunca autoriza contenido o fluctuaciones ficticias.
