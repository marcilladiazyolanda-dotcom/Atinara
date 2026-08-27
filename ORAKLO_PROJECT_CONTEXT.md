# Atinara · contexto de relevo · repositorio interno Oraklo

Última actualización del contexto: 27 de agosto de 2026.

Este documento permite continuar el proyecto en un chat nuevo sin depender del transcript anterior. Debe leerse junto con `AGENTS.md` y `README.md` antes de proponer o modificar nada.

> **Checkpoint vigente previo a activar el cierre Editor:** `origin/main` está
> en `e74a6d79f3a6ba852d660d04ab6b7243630cdd95`. El rango directo desde
> `4177f84` contiene las nueve rutas de la corrección de hash V1 y sus blobs
> coinciden con la entrega; Calidad de Atinara, Benchmark IA offline y Pages
> están verdes para ese SHA. Producción continúa en Radar v75 y Expert v26.
>
> La prueba manual del Agente Editor reveló una incidencia distinta y real.
> Expert v26 empaquetó 40 handlers del Registry, mientras la tabla productiva
> ya exige 50 estrategias después del cambio de alcance por campos. El
> `assertAgentRegistrySnapshot` falla con `AGENT_STRATEGY_HANDLER_MISSING`
> antes de persistir el run. La UI conservaba después solo el 200 de
> `get-draft-package` con `MARKET_EXPERT_ANALYSIS_REQUIRED`, ocultando el 503
> tipado y dando la impresión de no-op. No se creó run, borrador ni segunda
> UUID.
>
> La corrección local pendiente de subida hace visible el estado
> procesando/error/retry por candidata, bloquea doble click, conserva el error
> tipado y vuelve accionable una incompatibilidad de Registry. Una migración
> nueva convierte `materialize_market_draft_for_repair_v1` en alias compatible
> del writer `save_market_draft_from_expert_with_issues_v2`; no edita historia
> ni ejecuta DML de negocio. Hasta integrar esta entrega no desplegar Expert,
> no reanudar `39bc204b-aa3f-4a69-99da-557f5fa91f7d` y no crear un borrador.
> Véase `docs/ATINARA_RADAR_EDITOR_BRIDGE_REGISTRY_FIX_20260827.md`.

> **Checkpoint anterior preservado del cierre Radar/Discover:**
> `origin/main` está en `4177f84f2c34b93da6fe4b2b4aa90ff13a141328`
> (`radar`), descendiente directo de `a6152a7`. El rango contiene exactamente
> las diez rutas de
> `ATINARA_RADAR_CATALOG_WORKER_LIMIT_V2_FIX_20260827`, sin eliminaciones, y
> cada blob coincide con la entrega local. Calidad de Atinara —incluido Deno—,
> Benchmark IA offline y GitHub Pages están en `success` para ese SHA. La
> estrategia B2B-first permanece intacta y autoritativa; este cierre no
> implementa B2B ni Atinara Engine.
>
> La migración local
> `20260826190000_checkpoint_market_radar_global_catalog_v2.sql` se aplicó una
> sola vez en producción como
> `20260827150224_checkpoint_market_radar_global_catalog_v2`. Tabla, índices,
> RLS forzada, ACL, trigger append-only y las tres RPC `service_role` quedaron
> verificados. No hubo DML de negocio ni backfill.
>
> Después del baseline se desplegó únicamente `market-radar` desde `a6152a7`:
> pasó de v74 a v75, está `ACTIVE`, `verify_jwt=true`, digest
> `7a831f3ce6b91480515b82f0f3c74a1aaf2e8e62160ae2a650a75e54f9372555`.
> Las tres fuentes modificadas del bundle remoto coinciden exactamente con
> `origin/main`; las otras doce dependencias conservaron el grafo de v74.
> Expert v26, Corrector v25, Validator v34 y Resolución v16 no cambiaron y
> conservan JWT obligatorio.
>
> El baseline productivo real anterior al refresh era: 16 mercados, 9
> predicciones, 2 perfiles, Karma total 2.932, Prestigio total 40 y 7 registros
> de borrador. El séptimo corresponde al mercado Tibo ya publicado el 26 de
> agosto; por tanto, la referencia histórica a seis borradores ya no era el
> estado real. Los recuentos protegidos permanecen iguales y no se creó mercado,
> predicción, perfil, posición, precio ni borrador durante este incidente.
>
> Después de v73 se inició exactamente un refresh Kalshi:
> `39bc204b-aa3f-4a69-99da-557f5fa91f7d`. Una actividad productiva ajena a esta
> verificación reanudó la misma UUID con v75 y persistió cuatro checkpoints V2.
> El último, secuencia 4 y hash
> `ebb1586aba60eb4e34507299f10eac4b4f75cd9e1ca79e63eb2cbbae7f8c54ae`,
> conserva un catálogo terminal de 13.561 series, 416 seleccionadas, 87
> completas, 57 fallidas reintentables, 272 pendientes, cero agotadas y 129
> padres. El hash del catálogo es
> `73f681e2938ebcd1565b22a5db8ad5862962b0823478e8bcb6906a8dac5aa94f`
> y la proyección almacenada es V1. Kalshi sigue `in_progress/fetching`,
> `claim_count=8`, con lease vencido; Tavily terminó `completed/terminal`,
> `claim_count=5`. Continúan en cero los batches, manifest y borradores de este
> expediente. SQL confirma una sola `request_id`; no se abrió otra UUID.
>
> Las dos invocaciones de escritura de v73 terminaron HTTP 546 a 10.666 ms y
> 10.033 ms. Las primeras reanudaciones con v74 y v75 terminaron también HTTP
> 546 a 6.216 ms y 6.041 ms. Las continuaciones posteriores demostraron que v75
> sí puede persistir el catálogo y avanzar por lotes sobre la misma UUID; no
> autorizan a desplegar una fuente cuyo contrato de hash no coincida con SQL.
>
> V75 conservó correctamente el análisis único y el hash incremental, pero su
> perfil anterior empezaba después de materializar y parsear los 17 MB del
> proveedor. El perfil de ruta completa demostró la causa residual: lectura,
> decodificación, unión de strings, `JSON.parse`, clasificación y hash consumían
> aproximadamente 2.407 ms CPU y 285 MB RSS sobre 13.559 series, por encima de
> los límites alojados de 2 s y 256 MB antes del primer checkpoint.
>
> La corrección integrada en `4177f84` mantiene el límite fail-closed de 24 MB,
> usa parse JSON nativo y máscaras compactas. Sin embargo, la puerta previa al
> despliegue detectó una discrepancia material: la Edge calculaba el hash con
> `atinara-kalshi-series-catalog-projection-v2`, mientras el constructor del
> checkpoint y la RPC aplicada almacenan y exigen
> `atinara-kalshi-series-catalog-projection-v1`. CI no comprobaba el acuerdo de
> las tres capas. Desplegarla habría creado en una UUID futura un hash V2
> etiquetado como V1 y habría roto su reproducibilidad.
>
> La corrección incremental pendiente conserva la proyección V1 ya aplicada y
> reproduce byte a byte su hash canónico desde las mismas tuplas compactas, sin
> objetos ni ordenación de claves por fila. No modifica SQL ni checkpoints
> existentes. Pasan 619/619 unitarias, 20/20 focales de catálogo global, 9/9
> Edge con Deno 2.1.14, sintaxis en 134 JavaScript, 21 contratos SQL estáticos,
> canonicalización Node/Deno y TypeScript. Un perfil sintético de 13.561 filas
> ejecuta el nuevo hash en 47–110 ms CPU y unos 62 MB RSS de proceso. No cambia
> política, migración, frontend, otras Edge, datos, IA, Registry, economía ni
> presupuestos. Véanse
> `docs/ATINARA_RADAR_CATALOG_WORKER_LIMIT_V2_FIX_20260827.md` y
> `docs/ATINARA_RADAR_CATALOG_HASH_CONTRACT_FIX_20260827.md`.
>
> El expediente histórico
> `c1f677eb-0dae-410f-820d-a4483601ab47` permanece stale e intacto. Hasta que
> Yol suba el nuevo ZIP de contrato hash y GitHub vuelva a quedar verde, no
> desplegar la corrección local, no reanudar `39bc…`, no iniciar otra UUID, no
> llamar Market Expert y no crear un borrador por otra vía.

### Catálogo global y discovery durable V2 · 26 de agosto de 2026

- La lista oficial `/trade-api/v2/series` no ofrece búsqueda textual. Limitarse
  a Entertainment/Video games y Sports/Esports cubría 215 series, pero omitía
  lanzamientos, industria, reviews, streamers y YouTubers registrados bajo
  otras categorías del proveedor. Un escaneo global de eventos tampoco prueba
  completitud: ya había agotado 50 páginas con cursor pendiente.
- Una lectura live de solo proveedor devolvió HTTP 200, cursor nulo, 13.486
  series únicas y 17.181.274 bytes. La política general V2 seleccionó 410
  series: las 217 coincidencias taxonómicas observadas y 193 adicionales por
  metadatos, entidades, autoridades y relaciones entre series hermanas
  derivadas del propio catálogo. El vocabulario efímero quedó en 83 términos;
  91 series dependieron solo de esa relación. Las seis categorías de Atinara
  aparecen en la inferencia (25/115/152/12/97/9) y un control léxico amplio no
  encontró omisiones.
- El primer tramo sella hash SHA-256 del catálogo completo, recuento, cursor
  agotado, política, proyección y las 410 series seleccionadas. Cada
  continuación consulta como máximo 48 series, con concurrencia dos y un
  presupuesto hijo de 40 segundos. Si vence el presupuesto del lote, la serie
  no consume un intento falso: permanece pendiente para la misma UUID.
- `market_radar_provider_discovery_checkpoints_v2` conserva snapshots
  append-only encadenados por hash. SQL recalcula unicidad, pertenencia
  padre-serie, transiciones, intentos y todos los recuentos; ninguna secuencia
  puede perder un resultado anterior, reescribir una serie cumplida ni cambiar
  catálogo o selección. Tabla y RPC fuerzan RLS, lease y `service_role`.
- Caídas de catálogo, timeout, rate limit o respuesta inválida quedan
  `in_progress`, con cooldown, incidencia `blocking_scope=none` y acción
  `resume_provider_discovery`. No producen snapshot fresco vacío ni fallo
  terminal global. Tras cuatro fallos de una serie, su identidad permanece
  explícita como `provider_unavailable`; las familias sanas continúan y la
  calidad declara que no degrada el proveedor.
- No hay IDs de mercado o serie, frontend, DML, backfill, secretos ni cambios
  de Registry, AI, modelos, rutas, modos, flags, presupuestos o economía. Radar
  continúa sin Gemini. La implementación y el hash incremental quedaron
  integrados en `a6152a7`, la migración se aplicó una vez como `20260827150224`
  y v75 es el despliegue actual. La segunda corrección de recursos está
  integrada en `4177f84`, pero su desacuerdo V1/V2 bloquea el despliegue. La
  corrección compatible del contrato hash está preparada localmente y pendiente
  de subida.

### Integración segura sobre las subidas intermedias · 27 de agosto de 2026

- El upload Full Theme es exacto respecto de su ZIP: diez rutas, ninguna
  adicional y ninguna eliminación. La diferencia material no está dentro del
  ZIP, sino en su composición: fue construido sobre `8025df4` y reemplazó tres
  archivos que también habían cambiado en commits posteriores.
- `ORAKLO_PROJECT_CONTEXT.md` perdió las secciones de gráfica/límite y del
  Corrector por campos; `README.md` perdió esos mismos hechos y las versiones
  Corrector v25/Validator v34; `tests/market-radar.test.js` volvió a exigir una
  release de caché ya sustituida por el frontend publicado.
- La fusión de tres vías conserva sin conflicto todo el código Radar, la
  migración V2, los tests globales y los cambios funcionales intermedios. Solo
  README y contexto requieren una resolución semántica; el test de caché se
  fusiona de forma directa.
- La corrección incremental restaura esos tres archivos, usa en
  `market-radar` el comparador UTF-16 ya existente para ordenar tags y añade su
  documento y manifiesto. No toca SQL, frontend, producción, secretos, Auth,
  AI, Registry, economía ni estrategia. Después de subirla deben quedar verdes
  Calidad —incluido Deno—, Pages y benchmark antes de cualquier migración o
  despliegue.

### Gráfica temporal y máximo global de 1.000 Karma · 26 de agosto de 2026

- La causa visual era local y determinista: `getChartPointCoordinates` colocaba
  expresamente un histórico de un punto en `padding.left + chartWidth / 2`.
  Ahora el punto inicial queda en `x=46`, límite izquierdo del área trazable, y
  los puntos siguientes avanzan por tiempo hasta `x=696`. Si todos comparten
  timestamp, el orden de versión evita que se oculten unos sobre otros.
- Cliente y servidor aplicaban dos límites duplicados: 500 Karma y el 20 % del
  saldo. La regla vigente es global, `min(1.000, saldo disponible)`, tanto en
  `get_prediction_quote` como en `place_prediction`; continúan mínimo 10,
  saldo no negativo, posición única, lock transaccional y protección
  `PRICE_MOVED`.
- La migración
  `20260826183050_raise_live_prediction_max_to_1000_v1.sql` consta aplicada
  una sola vez en producción como `20260826184500`. Conserva
  `SECURITY DEFINER`, `search_path` vacío, cotización para `anon/authenticated`
  y confirmación solo para `authenticated`. Los hashes activos son
  `43adc4e6c6358613c01cec41999958c219e13774ecf9c60f405f6cae53e40acf`
  y `8e180eb20edc7afa97e02d0b2dfafa413dfb8b31cd9d8c78f3992f585b5c2028`.
- La prueba SQL reversible usa dos perfiles y un mercado transaccional: 1.000
  Karma en Sí eleva el precio, 1.000 en No lo reduce, cada operación incrementa
  versión e histórico, Sí+No permanece en 100 y 1001, saldo insuficiente,
  duplicado y quote obsoleta fallan cerrados. Tras `ROLLBACK` siguen 16
  mercados, 9 predicciones, 18 puntos, 2 perfiles, 2.932 Karma y 40 Prestigio;
  no queda fixture alguno y Tibo conserva 0 predicciones y su único punto real.
- La regresión de navegador recorre el frontend real con RPC simuladas en
  1440 px y 320 px: `50/50 → 69,67/30,33 → 42,26/57,74`, coordenadas
  `46 → 371 → 696`, scrubber y tooltip operativos, colores diferenciados y
  cero desbordamiento horizontal. La release de caché coordinada para todas
  las superficies que cargan observabilidad es
  `v=20260826-live-market-chart-limit1`.

### Corrector general por campos y publicación E2E verificada · 26 de agosto de 2026

- `origin/main = c9eb88cd04bd4fe2a5ee552dc20bc781569af951` integra la
  ampliación de los 23 campos y el reintento guiado del Validator. La migración
  `fix_market_draft_corrector_field_scope_v1` consta aplicada una sola vez como
  `20260826161837`; no debe repetirse. `validate-market-draft` v34 está
  `ACTIVE`, con JWT obligatorio y digest
  `c12f5955a8aeb1a0d6ec63348f0124b0f93f89b2df4d59eeb9df14e631309ef8`.
- `market-draft-fixer` v25 está `ACTIVE`, con JWT obligatorio y digest
  `76c87e535c2be6df7d5691e5beccd3d5978b9f671bb5b5ed9b16f303a54edb1f`.
  Su último delta quedó integrado en GitHub: evita que el editor semántico
  repita como bloqueo una objeción tipada de workflow de fuentes que la misma
  ronda ya reparó y atestó autoritativamente. La excepción solo se
  aplica cuando el parche determinista contiene fuente primaria y alternativas
  verificadas; cualquier incidencia sustantiva, fuente incompleta o falta de
  evidencia continúa bloqueando.
- El Corrector mantiene estrategias registradas para los 23 campos rellenables,
  tanto en borradores manuales como Radar. Proyecta contexto y propuesta a
  contratos mínimos, representa opcionales ausentes sin `undefined` y limita
  cada fuente enviada al Gateway a `url`, `name` y `role`. Validator v34 recibe
  en su segundo intento la fase segura incumplida y vuelve a ejecutar todas las
  validaciones deterministas; ninguna ruta fabrica evidencia, rebaja una puerta
  o confirma y publica por sí sola.
- El E2E real sobre `ca6a10ea-ad48-4196-aab3-cc3141d3bde1` terminó en versión
  4, huella
  `0b625fd1e8072d8545df4c17e332014c05bb7ed1648fa9060e182dbd7b822627`,
  revisión efectiva 22 `approved` y cero incidencias. El Corrector renovó X y
  cambió únicamente `primary_source` y `alternative_sources`; la revisión
  posterior quedó aprobada con `atinara-market-gate-v3`.
- Yol realizó después las dos acciones humanas separadas. Supabase registró
  `HUMAN_CONFIRMATION_RECORDED` a las `17:55:03Z` y `MARKET_PUBLISHED` a las
  `17:55:32Z`. El mercado público
  `tibo-sottiaux-confirma-corte-pelo-septiembre-2026` está `Abierto`, existe una
  sola vez por slug y pregunta, conserva `scheduled_for=null`,
  `radar_candidate_id=null` y `family_relationship=standalone`. Chrome mostró
  su ficha pública real con pregunta, criterios, fuente X y 50/50 inicial.
- Evidencia del delta final: 115/115 pruebas focales, 597/597 unitarias,
  sintaxis válida en 131 JavaScript, TypeScript verde, 9/9 Edge con Deno
  2.1.14 y `git diff --check`. No añade migración, secreto, cambio de modo,
  ruta, modelo, presupuesto, economía ni autoridad autónoma.

### Continuidad de evidencia oficial futura · 26 de agosto de 2026

- Tavily devolvió seis URLs y cuatro descargas válidas, pero el grupo acabó con
  cero evidencias y cero autoridades. Dos URLs auxiliares fallidas bastaban para
  mantener el grupo incompleto aunque una página oficial exacta y alcanzable
  anunciara un estreno audiovisual futuro dentro del contrato.
- La identidad familiar se truncaba porque el patrón posterior al verbo
  español consumía solo la `a` inicial de `another`; persistió `nother gta vi`
  y la búsqueda factual no podía ligar esa entidad con `Grand Theft Auto VI`.
  Además, el parser reconocía fechas con año y `will be premiered`, pero no la
  forma natural `will premiere` ni una fecha oficial sin año.
- La corrección ordena artículos de mayor a menor y exige límite de palabra;
  deriva el sujeto factual desde la familia recién calculada; reconoce
  equivalentes audiovisuales tipados; liga sujeto, predicado y fecha; e infiere
  fechas sin año respecto de la recuperación sin convertir un pasado reciente
  en el año siguiente.
- Una URL auxiliar fallida solo deja de bloquear cuando cada candidata del
  grupo tiene evidencia oficial verificada, exacta, determinista y futura, y
  esa fecha no rebasa su propia frontera contractual. Una afirmación terminal,
  otro sujeto, otro tipo de contenido o una fecha posterior al cierre falla
  cerrado.
- La página oficial real respondió HTTP 200 y produjo la familia
  `atinara:v5:gtavi:official_content:trailer:duration-gte-30-seconds`, sujeto
  `grand theft auto vi` y prueba futura hasta
  `2026-08-27T12:00:00.000Z`. La validación local pasa 219/219 pruebas
  focalizadas más 58/58 de reconciliación general, 9/9 Edge con Deno 2.1.14,
  sintaxis en 128 JavaScript y `git diff --check`.
- No hay hardcodes de proveedor, serie, mercado o título en producción; no hay
  frontend, SQL, DML, backfill, Gemini en Radar ni cambios de Registry, rutas,
  modos, modelos, flags, presupuestos o economía. La corrección aún no está
  integrada ni desplegada y el E2E no está terminado.

### Continuidad de la revisión de dominio · 26 de agosto de 2026

- Discovery calcula `domain_review_fingerprint` antes de que `scoreCandidates`
  derive familia y presentación. La revalidación reconstruye el proveedor y lo
  mezcla con la fila ya derivada; por ello recalcular la misma función no
  reproduce necesariamente la huella atestada aunque el sujeto no cambie.
- La huella incluía además `parent_reconciliation_fingerprint`. Esa huella puede
  variar cuando cambia disponibilidad o contrato de una hermana, pero la
  completitud del padre ya tiene una puerta autoritativa separada y no decide
  si el sujeto pertenece a gaming.
- La solución compara la candidata revalidada con la fila persistida usando el
  mismo material cerrado de dominio y anulando solo la huella de reconciliación.
  Si proveedor, IDs, textos, categoría, tags, contexto, etiqueta canónica o
  estado de identidad difieren, calcula la huella actual y exige una revisión
  nueva. Si todo coincide, consulta el ledger con la huella ya atestada.
- La política v2 y la coincidencia exacta de proveedor, `external_id` y SHA-256
  siguen comprobándose en `projectRadarDomainReview`; la reconciliación completa,
  elegibilidad, fuentes, duplicados y temporalidad permanecen como puertas
  independientes. No existe autoaprobación ni publicación.
- Evidencia local focal: 97/97 pruebas de Radar y resumibilidad, 9/9 Edge con
  Deno 2.1.14, sintaxis del test y `git diff --check`. No hay migración,
  frontend, DML, backfill, Gemini en Radar ni cambios de Registry/AI/economía.

### Contrato de revisión humana de dominio · 26 de agosto de 2026

- La causa raíz es un desacuerdo de tipos, no Auth ni proveedor: las 398
  candidatas productivas usan 353 huellas `r` + 8 hex y 45 huellas históricas
  `r1-` + 16 hex; la ruta de revisión exigía 64 hex. La tabla de atestaciones
  estaba vacía antes de la corrección porque su restricción y la RPC hacían
  imposible insertar una candidata real.
- La migración incremental admite las dos versiones reales y conserva SHA-256
  por compatibilidad, sin convertir ni reescribir candidatas. La precondición
  sigue comparando revisión y huella exactas bajo lock; `domain_fingerprint`
  permanece SHA-256.
- Las atestaciones nuevas usan `atinara-gaming-domain-v2`, igual que el
  clasificador actual. La versión v1 solo se conserva como historia permitida;
  la lectura service-only proyecta exclusivamente la política vigente.
- La Edge comparte la misma gramática cerrada. Una revisión sigue siendo
  append-only, administrativa, idempotente y ajena a aprobación o publicación.
- La migración se aplicó una sola vez en producción sin DML ni backfill; la Edge
  v71 quedó activa y la primera atestación v2 se persistió y proyectó.
- El E2E continúa desde la misma candidata y los mismos seis borradores. Tras la
  corrección de continuidad se renovará elegibilidad una sola vez y solo
  entonces podrá ejecutarse una única inferencia de Market Expert.

### Checkpoint durable de discovery y cobertura temática · 25 de agosto de 2026

- El alcance público real contiene 109 series Entertainment/Video games y 107
  Sports/Esports, con una coincidencia: 215 series y 515 padres abiertos. El
  recorrido completo terminó en 52,1 s con concurrencia 2 y backoff de 429;
  agotó las 215 series, obtuvo 515 identidades únicas y cero errores finales.
  El escaneo global no sirve como sustituto: alcanzó 10.000 eventos y 50 páginas
  sin demostrar fin de catálogo.
- La primera invocación de la misma UUID indexa todas las series y padres con
  `with_nested_markets=false`, sella un checkpoint privado de hasta 2 MiB y
  libera el lease. La continuación reclama esa UUID, lee el checkpoint y
  enumera familias completas sin repetir las 215 series. Series fallidas se
  reintentan de forma aislada; IDs seleccionados y diferidos se conservan sin
  truncamiento en `provider_selection` v2.
- Las dos consultas taxonómicas también están aisladas: una caída de Video
  games o Esports conserva el scope sano, registra el scope fallido dentro del
  checkpoint y reintenta exclusivamente ese scope al continuar. Incluso si
  ambos scopes quedan temporalmente indisponibles, Radar devuelve alcance
  parcial explícito y no un fallo técnico global ni un snapshot fresco vacío.
- La tabla de checkpoint fuerza RLS y append-only; las tres RPC son
  `service_role` only, exigen lease y validan recuentos, unicidad, pertenencia,
  tamaño, versión, timestamp y hash SHA-256. No hay backfill ni DML manual.
  La migración se probó completa contra producción dentro de una transacción
  terminada en `ROLLBACK`; después `to_regclass` y `to_regprocedure` confirmaron
  que no quedó aplicada.
- La respuesta pública no duplica hasta 2.000 IDs: entrega recuentos, integridad
  del ledger y muestras acotadas. Polymarket sustituye la consulta genérica por
  seis búsquedas temáticas, deduplica padres y aísla búsquedas o familias
  fallidas. No hay IDs de serie/mercado hardcodeados ni Gemini en Radar.
- `list_market_radar_candidates_v5` realiza un solo retry de lectura para
  500/504/57014. Ante transporte ambiguo, la UI espera 500 ms y hace una única
  lectura `refresh=false`; conserva la UUID si sigue activa y limpia
  «Continuar» si ya es terminal. Doble clic comparte promesa únicamente para la
  misma huella y los filtros no pueden cambiar durante la petición activa ni
  mientras exista una intención reanudable. Los offsets de páginas son solo una
  proyección de lectura y no cambian el hash durable del refresh. Una recarga
  restaura desde la sesión únicamente UUID y filtros, sin credenciales ni
  respuestas, y los reconcilia por lectura autoritativa.
- Pasan Deno 2.1.14, 153 pruebas focalizadas, 183 pruebas de las cinco suites
  afectadas, 232 regresiones del ciclo completo y 19 contratos SQL estáticos.
  La prueba ejecutable conserva 109 + 107 - 1 = 215 series, los dos scopes de
  la serie compartida y 515 padres únicos. Pages construyó el commit remoto,
  pero `admin-markets.html` mezcla `20260825-radar-catalog-bound1` con
  `20260825-radar-provider-checkpoint1`; la Action funcional falla cerrada.
- Producción sigue en v69 y no se inició otra UUID. Los fingerprints protegidos,
  seis borradores, 15 mercados, 9 predicciones, Karma 2.932 y Prestigio 40 no se
  modificaron. Tras la integración se aplicará una sola migración, se desplegará
  únicamente `market-radar` y se hará exactamente un refresh fresco controlado.

### Puerta CI de versión de caché Radar · 26 de agosto de 2026

- `origin/main = ddf61bb7667fc209377f2ea120d469b66f2ad65f` contiene exactamente
  las 16 rutas entregadas y su contenido coincide byte por byte con la worktree
  preservada. No hay archivos adicionales ni eliminaciones en el rango.
- GitHub Pages terminó en verde para ese SHA. La Action `Calidad de Atinara`
  falló en `npm run validate`, antes del paso Deno: `public-brand.test.js` y
  `sonarqube-quality.test.js` detectaron dos versiones de caché en
  `admin-markets.html` (`actual=2`, `expected=1`). No se usó Sonar.
- La causa es una entrega frontend no atómica: los dos scripts Radar nuevos
  usaban `20260825-radar-provider-checkpoint1`, mientras los otros trece recursos
  de esa página y las nueve páginas hermanas conservaban
  `20260825-radar-catalog-bound1`. La regla compartida de Pages exige una sola
  release por HTML y para los recursos transversales.
- La corrección incremental cambia únicamente 108 query strings en diez HTML y
  actualiza seis contratos estáticos de versión. Las 110 referencias quedan
  bajo `20260825-radar-provider-checkpoint1`. No modifica contenido JavaScript,
  backend, SQL, Auth, datos, IA, Registry, economía ni borradores. Véase
  `docs/ATINARA_RADAR_CACHE_VERSION_CI_FIX_20260826.md`.

### Aislamiento durable de timeouts de batch · 25 de agosto de 2026

- `process_market_radar_refresh_batch_v4` conserva el primitive v3 y captura
  únicamente `query_canceled` que escape del preflight v2. Reserva antes el
  batch exacto con el mismo orden de locks, revierte el intento parcial y lo
  deja `technical_failed/RADAR_PERSISTENCE_TIMEOUT` con contador de intentos.
- La Edge solo divide una respuesta timeout reintentable con UUID válida y más
  de un elemento. Valida parent, IDs hijos y suma exacta antes de continuar;
  transportes ambiguos se recuperan por el replay idempotente del mismo ledger.
- El margen global no cambia. Tras un split durable, si no quedan 20 s más la
  reserva final, la invocación se difiere y otra recuperación de la misma UUID
  continúa por sus hijos. Un batch unitario conserva el timeout explícito: no se
  descarta, no se aprueba y no se convierte en error factual.
- Los errores no timeout se propagan como tales. No se añaden hardcodes de
  proveedor, serie, evento o mercado; tampoco cambian frontend, secretos, Auth,
  RLS, IA, Registry, rutas, modelos, flags, presupuestos o economía.
- La prueba focalizada cubre contrato Edge, catcher exterior, ACL, replay de
  split 2+2, procesamiento v4 de ambos hijos, totales exactos y finalización
  única. El mismo árbol conserva las matrices generales de 1, 3, 21, 48 y 100+
  hijas, páginas, cursores, Unicode, placeholders, parciales, resultado público,
  Tavily caído, doble clic y reanudación.

### Puerta CI del contrato v4 · 25 de agosto de 2026

- El commit remoto `ca7ccf0d14ec18bc01a1a28c7c31f339316a137a` integró exactamente
  la corrección v4, pero su primera Action `Calidad de Atinara` falló antes de
  Deno por una aserción histórica de la suite global que todavía exigía una
  llamada Edge a v3. Pages y el benchmark IA offline sí terminaron en verde.
- El runtime ya llama v4 y el paquete original pasó sus 94 pruebas focalizadas;
  la discrepancia era exclusivamente el contrato estático paraguas omitido de
  aquel inventario. No se aplicó la migración ni se desplegó la Edge mientras
  la Action permanecía roja.
- La corrección incremental exige v4, exige el divisor durable y prohíbe una
  llamada directa de la Edge a v3. No cambia código productivo, SQL, frontend,
  configuración, presupuestos ni datos. Véase
  `docs/ATINARA_RADAR_CI_V4_CONTRACT_FIX_20260825.md`.

### Checkpoints durables de padres y proyección temprana · 25 de agosto de 2026

- `authenticator` tiene `statement_timeout=8s`. Las siete ejecuciones exitosas
  históricas del writer de padres tardaron hasta 5,99 s; la escritura actual de
  11 padres/148 hijas cruzó el límite. La lectura v5 alcanzó 7,94 s en una
  ejecución exitosa y el smoke registró también un 500 en esa ruta.
- La selección productiva es íntegra: 109 series totales, 25 seleccionadas,
  cero fallidas, 11 padres y 148 hijas. Los endpoints públicos de los once
  eventos respondieron y no existe evidencia de caída general de Kalshi.
- La migración ya aplicada mantiene la firma v1 y acepta subconjuntos estrictamente
  incluidos en `selected_parent_ids`. Cada llamada persiste un padre completo;
  el intent conserva recuentos parciales y `parent_manifest_hash=null` hasta
  alcanzar exactamente padres, hijas e identidades seleccionadas.
- La Edge ordena de forma binaria, renueva el lease y llama una vez por padre.
  El replay es idempotente; un timeout usa `defer_market_radar_refresh_v1`, deja
  la misma UUID reanudable y conserva el código `RADAR_PERSISTENCE_TIMEOUT`.
- La respuesta solo afirma HTTP 202 después de validar la confirmación durable
  de esa deferral. Un fallo o payload ambiguo de la propia RPC ya no se absorbe
  como si la reanudación hubiera quedado registrada.
- La nueva implementación de v5 materializa solo IDs, filtros y puntuaciones;
  carga y proyecta el expediente de las filas ya paginadas antes del `jsonb_agg`.
  Una comparación de lectura sobre las 315 candidatas productivas dio cero
  diferencias entre el payload vigente y el nuevo.
- No cambia frontend, secretos, Auth, RLS, proveedores, IA, Registry, rutas,
  modelos, flags, presupuestos, economía ni datos. El checkpoint y la Edge v68
  están activos; queda pendiente el aislamiento de batches descrito arriba.
- Tras el smoke v68: `refresh_intents=22`, `issues=450`, `provider_runs=49`,
  `parent_ledgers=47`, `candidates=315`, `fact_checks=3306`,
  `eligibility_checks=3522` y `drafts=6`.
  Los fingerprints de mercados, predicciones, perfiles, LMSR, precios y
  borradores, junto con Karma 2.932 y Prestigio 40, siguen idénticos.

### Presupuesto desacoplado del enriquecimiento Radar · 25 de agosto de 2026

- La API demuestra que `record_market_radar_provider_selection_v1` y
  `record_market_radar_parent_reconciliations_v1` respondieron HTTP 200 antes de
  Tavily. El ledger nuevo contiene 11 padres, 148 descubiertas, 148
  contabilizadas, 148 identificadas y cero identidades sin resolver.
- `KXSWITCH2` y `KXMETACRITICSTALKER2` quedaron en
  `failed_series_ids`; `provider_scope_partial=true` y
  `no_parent_truncated=true`. Sus padres afectados permanecen incompletos sin
  degradar los diez padres sanos.
- Tavily finalizó como enriquecimiento no disponible después de varias
  renovaciones de lease, pero el manifest de candidatas aún estaba aguas abajo.
  Esta dependencia temporal obligó a reabrir discovery para recuperar la
  intención aunque el catálogo del proveedor ya estaba contabilizado.
- `withRadarEnrichmentBudget` crea un contexto hijo de 12 s, ligado al deadline
  absoluto y con limpieza garantizada. El heartbeat del feed sigue siendo
  independiente; un timeout auxiliar deja evidencia incompleta y permite que el
  feed alcance manifest, batches y finalización.
- `internalRadarOperationalFailure` conserva además códigos seguros de errores
  locales, no solo `RadarRpcError`, para que un deadline o guard interno no se
  vuelva a presentar como caída del proveedor.
- La corrección es únicamente Edge y pruebas. Los fingerprints de mercados,
  borradores, predicciones, perfiles, LMSR, precios, Karma y Prestigio quedaron
  idénticos tras el smoke.

### Contrato TypeScript del error interno Radar · 25 de agosto de 2026

- La subida `0be8e614c686e6294260faddc2fb36b80da11955` contiene exactamente los
  seis archivos del paquete diagnóstico. Pages y benchmark finalizaron en verde.
- La puerta funcional `Calidad de Atinara` falló en `npm run test:edge`:
  Deno 2.1.14 emitió `TS2322` y `TS2345` porque `JsonRecord` no garantiza las
  propiedades `provider`, `code`, `status` y `message` exigidas por
  `RadarPersistenceError`.
- La corrección declara el retorno como intersección entre
  `ReturnType<typeof publicProviderError>` y `JsonRecord`. No usa cast, no cambia
  el objeto en runtime y mantiene extensibles `retryable` y `database_code`.
- El chequeo exacto pasa las nueve Edge; también pasan 562 unitarias, 128
  archivos JavaScript y 19 contratos SQL. Producción continúa intacta en v65 y
  no se ejecutó un nuevo refresh.

### Preservación de errores internos Radar · 25 de agosto de 2026

- El aislamiento por series está demostrado en producción: la UUID
  `0cfba4f3-c258-48cb-8c6c-4bde7afac576` consumió 25/25 series Kalshi sin fallo,
  descubrió 11 padres y 146 hijas y completó Tavily.
- La primera escritura, el ledger de padres, falló antes de crear manifest o
  batches. `providerFailure` y `persistenceFailure` inspeccionaban solo
  `Error.message`; para `RadarRpcError` ese campo es el envoltorio HTTP y la
  regla SQL real vive en `databaseMessage`.
- `internalRadarRpcFailure` preserva esa regla, el SQLSTATE y su semántica de
  retry. Ya no etiqueta un conflicto interno de persistencia como caída del
  proveedor ni oculta el siguiente diagnóstico accionable.
- La corrección es solo Edge y prueba de contrato. No cambia SQL, frontend,
  datos, IA, Registry, rutas, presupuestos o economía. Tras desplegarla se hará
  un único reintento Kalshi controlado para obtener la regla exacta y corregir
  su causa raíz, sin insistir a ciegas.

### Aislamiento parcial de series Kalshi · 25 de agosto de 2026

- `discoverKalshi` consulta hasta 25 series con concurrencia 2. La implementación
  convertía cualquier elemento `rejected` de `indexedSettled` en un throw global,
  aunque las demás series y sus padres estuvieran completos.
- La corrección conserva los eventos de todas las series `fulfilled`; solo falla
  el proveedor completo si ninguna serie produce eventos y existe al menos una
  caída. La selección registra `failed_series_count`, IDs, alcance parcial y el
  número real de series seleccionadas/diferidas.
- La UI operativa recibe `RADAR_PROVIDER_SERIES_PARTIAL`: muestra cuántas series
  se reintentarán y declara que ningún padre representado fue truncado. No oculta
  el delta ni lo convierte en cuarentena o resultado factual.
- Los endpoints de taxonomía y series respondieron HTTP 200 en la comprobación
  externa posterior; por tanto, la caída observada fue parcial/intermitente y no
  justifica invalidar todo Kalshi.
- La corrección es solo Edge, sin migración, frontend, IA o economía. Tras el
  despliegue se ejecutará otro refresh Kalshi controlado y se exigirá que las
  series sanas produzcan padres, manifest y batches aunque una hermana falle.

### Heartbeat de leases durante discovery · 25 de agosto de 2026

- La primera llamada del refresh fresco persistió únicamente los ledgers de
  padres y perdió el transporte. «Aplicar filtros» recuperó la UUID; una única
  continuación reutilizó la intención y elevó `claim_count` a 2.
- La segunda llamada confirmó la causa: la lease inicial vence a los 45 s,
  mientras enumeración, resolución de identidades y búsqueda oficial consumen
  hasta 56,6 s. Las renovaciones existentes ocurrían antes de registrar padres
  y durante staging/persistencia, pero no mientras las operaciones de red largas
  seguían activas.
- `withRadarRefreshLeaseHeartbeat` renueva cada lease vigente a los 15 s usando
  el mismo token y owner. Envuelve discovery de proveedores y research oficial;
  no revive una lease expirada, no cambia TTL SQL, no permite doble owner y se
  detiene inmediatamente al resolver o fallar la operación.
- Los intents terminales, bloqueados o sin token no se renuevan. Antes de
  research solo se incluyen proveedores cuya discovery se conservó más Tavily,
  para no tocar una capacidad ya finalizada.
- La corrección es únicamente Edge y no cambia migraciones, frontend, datos,
  IA, Registry, rutas, presupuestos o economía. La UUID actual queda preservada
  como evidencia recuperable; tras desplegar se completará Polymarket/Tavily y
  se usará un refresh posterior para recuperar Kalshi de forma limpia.

### Contrato de errores de revalidación Radar · 25 de agosto de 2026

- La candidata `9979db72-d498-41f7-bf26-226aba4846e0` corresponde a Onimusha:
  hija `option:*`, padre Kalshi 19/19, gaming, futura y sin duplicado. No se
  ejecutó Market Expert porque su elegibilidad estaba caducada.
- La revalidación única terminó fail-closed. No abrió formulario ni borrador;
  candidata `available`, `prepared_draft_id=null`, 6 borradores, 15 mercados,
  9 predicciones, Karma 2932, Prestigio 40 y LMSR/histórico intactos.
- PostgreSQL emitió `RADAR_CANDIDATE_IDENTITY_STALE`, pero `rpc()` lanzó
  `RadarRpcError(message=RADAR_RPC_409,databaseMessage=RADAR_CANDIDATE_IDENTITY_STALE)`.
  Auditoría y respuesta usaban solo `error.message`, degradando una transición
  de dominio recuperable a `RADAR_ELIGIBILITY_TECHNICAL_FAILURE` 503.
- El helper compartido nuevo prioriza `databaseMessage`, después `code` y solo
  al final `message`. Identidad stale y padre incompleto se registran en fase
  `provider_revalidation`, `retryable=true`, y devuelven 409 con siguiente
  acción explícita de actualizar Radar. Proveedor/scan y fallos reales conservan
  sus clasificaciones previas.
- Esta corrección no cambia SQL, frontend, datos, IA, Registry, rutas,
  presupuestos ni economía. Tras desplegarla se ejecutará una actualización
  Radar nueva y controlada —no replay de la UUID terminal— para obtener una
  identidad vigente antes de Market Expert.

### Frontera ligera de catálogo y resultados públicos · 25 de agosto de 2026

- El click productivo único reutilizó la UUID durable y completó los cinco
  batches Kalshi 20/22/23/22/18. El error HTTP ocurrió después del commit, al
  reconstruir la vista administrativa; no se repitió ningún batch.
- La causa raíz general es una frontera mal situada: SQL devolvía expedientes
  completos de dominio y la Edge los recortaba después de PostgREST. Con 88
  candidatas no rechazadas y 65 rechazos actuales, esa frontera transportaba
  6,54 MB. La nueva proyección SQL versionada reduce los tres inputs principales
  a 835.015 bytes sobre los datos reales y deja que la paginación por padres
  respete el presupuesto de respuesta de 900.000 bytes.
- El contrato factual vigente no depende del estado `open` del proveedor. Una
  evidencia oficial directa, exacta, recuperada y ligada al contrato marca
  terminal anuncios, lanzamientos, hitos, premios, métricas y otros hechos. Los
  rumores, predicciones, filtraciones o lenguaje especulativo nunca acreditan
  resolución. La detección no usa Gemini ni nombres hardcodeados.
- La UI separa «Auditoría de integridad» de «Oportunidades actuales» y recibe
  por padre recuentos de catálogo, preparables, holds, terminales, resultados
  públicos, inactivas, duplicadas e inválidas. Un padre ya resuelto se conserva
  auditable, pero declara explícitamente cero oportunidades.
- La cuadrícula usa un mínimo intrínseco de 520 px y `auto-fit`; una única
  familia deja de comprimirse en media columna y conserva acciones legibles en
  escritorio, tableta y móvil.
- Evidencia actual: 558 pruebas unitarias, sintaxis de 128 JavaScript, 19
  matrices SQL estáticas, 18 casos browser en 390/768/1366 px, migración y test
  SQL exactos sobre producción con `ROLLBACK`, y `git diff --check` verde.

### Persistencia durable por batch y visibilidad atómica · 24 de agosto de 2026

- La migración parcial se aplicó desde el blob LF canónico de GitHub. Un primer
  transporte desde el checkout Windows conservó CRLF dentro de patrones SQL y
  abortó antes del efecto; historial y tres cuerpos permanecieron intactos. El
  segundo intento canónico pasó preflight y postflight y quedó registrado como
  `20260824174351`.
- El smoke visual recuperó la misma UUID desde servidor; `request_count=1` y
  `claim_count=3`, sin repetir Polymarket. Los cinco batches Kalshi siguieron
  pendientes porque `complete_market_radar_candidate_refresh_v1` intentaba
  confirmar 105 candidatas dentro de una sola sentencia PostgREST. Un batch de
  20 tarda 2,26 s; los cinco juntos, 11,53 s; la sesión autenticadora tiene
  `statement_timeout=8s`.
- La migración local nueva
  `20260824190000_harden_radar_batch_resume_visibility_v1.sql` crea dos wrappers
  service-only. Cada llamada confirma un único batch durable; otra llamada corta
  finaliza solo cuando `processed_count=expected_count`. La puerta compartida
  oculta todas las candidatas antiguas y nuevas de un padre mientras exista una
  reconciliación `in_progress`, por lo que una recarga nunca puede proyectar una
  familia LKG parcial. El estado terminal vuelve a habilitar de golpe únicamente
  los padres completos.
- `market-radar` consulta la intención activa también al cargar caché y el
  coordinador de interfaz adopta la UUID autoritativa. Después de cerrar y abrir
  la pestaña, el botón muestra «Continuar actualización» y no genera otra
  intención. El recurso está versionado de forma coherente en las páginas HTML.
- La simulación exacta productiva con `ROLLBACK` y límite de 8 s completó los
  batches 20/22/23/22/18: 105 procesadas, 105 aceptadas, cero cuarentenas, cierre
  `partial` por el único padre proveedor incompleto, 105 candidatas ligadas a
  padres completos y cero al padre incompleto. La suite SQL completa pasó en la
  misma forma.
- Evidencia local: 553/553 unitarias, sintaxis de 127 JavaScript, 18 matrices
  SQL, 9/9 Edge checks, `git diff --check` y auditoría Supabase read-only. El
  paquete aún no está desplegado; producción conserva los cinco batches
  pendientes y todos los fingerprints de mercados, predicciones, perfiles,
  borradores, Karma, Prestigio, LMSR e histórico.

### Aislamiento de padre parcial en la persistencia Radar · 24 de agosto de 2026

- El segundo refresh V6 creó una única intención durable, con request ID
  `2798d1af-9ccd-4b79-9be7-37d5876d9484`. Polymarket completó cinco batches:
  74 esperadas, 74 procesadas, 74 aceptadas, cero cuarentenas y cero fallos.
  Tavily falló técnicamente de forma aislada y sin datos. Kalshi declaró 105
  candidatas y persistió el ledger completo de ocho padres y 109 hijas, pero
  sus cinco batches permanecen pendientes.
- Siete padres Kalshi agotaron paginación y quedaron completos. Para `KXPS6-26`,
  los endpoints current y nested coincidieron en la hija `KXPS6-26-DEC31`; el
  endpoint histórico oficial respondió `PROVIDER_RATE_LIMITED`. El padre quedó
  honestamente `provider_unavailable`, con paginación no agotada, issue estable
  y próximo reintento. No se inventó identidad ni se ocultó la hija.
- La causa raíz restante está en los writers SQL: las guardas globales de
  `process_market_radar_refresh_batch_v2` y
  `finalize_market_radar_refresh_v4` exigían paginación completa de todos los
  padres antes de procesar cualquier batch. Esa política fail-closed era
  correcta para el padre incompleto, pero propagaba su indisponibilidad a los
  siete padres independientes que sí cumplen el contrato.
- La migración nueva
  `20260824180000_allow_partial_radar_parent_persistence_v1.sql` no contiene DML
  ni backfill. Mantiene las comprobaciones por candidata y por padre, promueve
  únicamente candidatas ligadas a una reconciliación completa y finaliza la
  capacidad como `partial_error/RADAR_PARENT_RECONCILIATION_INCOMPLETE` cuando
  alguna paginación sigue abierta. El replay devuelve el resultado terminal
  persistido y no repite candidatos ni efectos.
- La migración se probó junto con toda la suite transaccional sobre producción
  dentro de `BEGIN/ROLLBACK`: un proveedor con un padre completo y otro parcial
  conserva el segundo no elegible, promueve el primero una sola vez y reanuda
  idempotentemente. Localmente pasan 552 unitarias, sintaxis de 127 JavaScript,
  18 matrices SQL y `git diff --check`.
- El paquete no cambia Edge, frontend, secretos, Registry V2.1, IA, economía ni
  datos de dominio. Tras su subida se aplicará solo la migración nueva y se
  reanudará la misma UUID con «Continuar actualización»; no se ejecutará otro
  refresh. Solo después se completarán el SELECT de aceptación, replay, smoke
  visual y la continuidad Radar → Editor.

### Persistencia live de reconciliación · corte previo del 24 de agosto de 2026

- El refresh `93b078a3-a54c-49d3-bf62-e2438d6eae5a` enumeró 74 hijas de tres
  padres Polymarket y 109 hijas de ocho padres Kalshi, con paginación agotada y
  Tavily desacoplado. Polymarket terminó en
  `RADAR_PARENT_LEGACY_IDENTITY_BIJECTION_MISMATCH`; Kalshi terminó en
  `RADAR_PARENT_CHILD_RECONCILIATION_INVALID`. No llegó a persistir batches ni
  candidatas V3 y no utilizó Gemini.
- En el padre Polymarket `499343`, producción conserva 45 filas históricas pero
  solo 23 `external_market_id` estables: 22 pares son una representación antigua
  mínima y otra posterior enriquecida del mismo contrato. La historia raw es
  válida y no se borra; contar filas físicas como hijas hacía imposible la
  biyección. El arreglo colapsa solo proyecciones `legacy:*` por identidad fuerte,
  conserva referencias a todas sus representaciones y convierte desacuerdos de
  condition/token en conflicto explícito. Las ocurrencias V6 reales nunca se
  colapsan.
- Kalshi exponía reglas resolutivas con varios párrafos. `provider_contract`
  conservaba los saltos mientras `provider_contract_canonical_json` los
  normalizaba antes de firmar; SQL comparaba ambas formas literalmente. El
  contrato firmado normaliza ahora solo caracteres de control/espaciado. El
  payload fuente sigue conservando el texto original.
- La migración pendiente
  `20260824153000_fix_radar_legacy_representation_reconciliation_v1.sql` es DDL
  aditivo sin DML ni backfill. Añade dos helpers privados sin grants y parchea la
  función de registro únicamente si su huella normalizada CRLF/LF coincide con
  el cuerpo productivo esperado. Mantiene owner, `SECURITY DEFINER`,
  `search_path=''` y grant exclusivo a `service_role`.
- Evidencia local: 551/551 unitarias, 127 JavaScript con sintaxis válida, nueve
  Edge verificadas con IA externa desactivada y 18 matrices SQL estáticas
  válidas. Tras la subida se debe aplicar solo la migración nueva, desplegar solo
  `market-radar`, ejecutar exactamente un refresh administrativo sin Gemini y
  comprobar persistencia, replay, completitud y UI antes de reanudar Editor.

### Incidencia bloqueante de completitud e identidad del padre · 23 de agosto de 2026

- `origin/main = 3d0db378d216c753635d066c86a31af24cf1fcea` contiene ya la
  corrección del presupuesto de 900.000 bytes. Actions, Pages y Sonar quedaron
  verdes; producción conserva `market-radar` v58 `ACTIVE`, `verify_jwt=true`.
- El evento Polymarket `800696` conserva 48 snapshots del 11 de agosto: 21
  preguntas nominales y 27 placeholders `Game A`–`Game Z`/`another game`. Las
  48 filas son v2/familia v4 y usan incorrectamente `deadline:*`; todavía no
  existe ninguna intención durable V6 en producción.
- Los endpoints oficiales actuales de evento, market ID, keyset y CLOB
  condition/token enumeran 48 IDs/conditions únicos. Las 21 etiquetas nominales
  y la opción estructurada `Other` quedan identificadas; `Game A`–`Game Z`
  siguen sin metadata resolutiva. No existe evidencia para inventarlas. El
  estado actual seguro es 48 declaradas, 48 contabilizadas, 22 identificadas y
  26 pendientes. El fixture 21/27 se conserva como caso adversarial histórico.
- La rama `codex/atinara-v6-parent-reconciliation` añade normalizador v3,
  dominio v2, reconciliación de padre/hija append-only, resolución por IDs,
  paginación fail-closed, familia v5, proyección SQL v5/v3 y una sección
  administrativa separada. Los triggers v4 quedan limitados a legacy; todos los
  lotes candidatos se promueven en una sola transacción y preparación exige la
  identidad fresca exacta antes de renovar elegibilidad.
- La última revisión endurece además cobertura por occurrence/aliases del
  snapshot anterior, fallback slug solo único, commit multi-batch con lease de
  120 s, finalizador público v5 por capacidad, writers internos sin EXECUTE,
  rebind seguro de candidatas preparadas y duplicado live V4/V5 durable hasta
  confirmación/publicación. Añade binding V3 atómico, replay de eligibility por
  checkpoint sin segunda llamada al proveedor y un orden único de locks para
  Radar, Corrector y publicación, incluido scheduler `SKIP LOCKED` de dos
  workers. Ninguno de esos cambios toca economía o Registry.
- La nueva migración `20260822205445_add_radar_parent_reconciliation_v1.sql`
  está sin aplicar y no contiene backfill. Producción, modos IA, Registry V2.1,
  presupuestos, mercados, borradores, predicciones, perfiles, Karma, Prestigio,
  LMSR e históricos permanecen intactos.
- Evidencia local: 548/548 unitarias; las 9 Edge superan `deno check` con Deno
  canónico 2.1.14; SQL estático 18/18; migración y prueba transaccional parseadas por PostgreSQL;
  browser 18 casos en 390/768/1366 px, con fixtures 48/48 y 21/48 y cero red.
  La ejecución SQL dinámica queda pendiente de una base desechable o del
  despliegue post-subida; no se usó producción para fabricar la prueba.
- Contrato, riesgos y secuencia de activación:
  `docs/ATINARA_RADAR_PARENT_RECONCILIATION_V1.md`. El siguiente checkpoint es
  preparar el ZIP incremental; después Yol debe subirlo antes de migrar,
  desplegar y ejecutar el único refresh productivo autorizado.

### Despliegue V6 y checkpoint de presupuesto Radar · 22 de agosto de 2026

- GitHub `origin/main = 0fa29d440e6cb63bf11aeb9c8b226fc8c0200942` contiene el
  paquete V6 y su corrección Sonar exactos. Actions, Pages y Quality Gate quedaron
  verdes, con cero bugs nuevos de fiabilidad.
- Producción registró exclusivamente
  `20260822164140 · harden_radar_provider_resumability_v1` y
  `20260822164309 · add_market_workflow_orchestration_v1`. El postflight confirmó
  owner `postgres`, `SECURITY DEFINER`, `search_path=''`, ACL cerradas, RLS forzada,
  constraints e índices; las once tablas V6 nacieron vacías y los campos añadidos
  a 6 borradores, 5 reviews y 303 candidatas permanecieron nulos. Registry V2.1
  conserva hash `eb8f345009d419b57c2a44ea6ae4a07adf0348c5bc96c2d9495a902a9f9abee3`.
- Se desplegaron solo `data-observatory` v5, `market-draft-fixer` v21,
  `market-expert` v26, `market-radar` v57, `publish-scheduled-markets` v6 y
  `validate-market-draft` v30. Todos los bundles están `ACTIVE`, conservan
  `verify_jwt=true` y sus archivos remotos coinciden con el SHA canónico.
- El DDL hizo visible un problema conocido de la cola de notificaciones de
  PostgREST. La reparación no disruptiva `select pg_notification_queue_usage()`
  restauró la caché; el cron pasó de 503 a ciclos 200 `OK`, siempre con cero
  publicaciones. No fue necesario reiniciar ni pausar el proyecto.
- El smoke autenticado se detuvo antes de «Actualizar fuentes»: la consulta
  discovery por defecto serializaba 108 hijas dos veces (`candidates`, `groups`),
  81 rechazos y payloads internos, alcanzando 5.832.218 bytes y devolviendo 500.
  Una consulta estrecha de The Game Awards sí devolvió 2 padres y 39 hijas, lo
  que confirmó la causa raíz sin consumir el refresh autorizado.
- La proyección allowlist se integró en `d11a08b` y se desplegó exclusivamente
  como `market-radar` v58. La vista acotada respondió 200 con 510.180 bytes,
  pero la vista canónica completa aún materializaba 1.119.506 bytes y el runtime
  devolvía 500 antes de entregar el JSON. Las tres RPC de lectura seguían sanas:
  108 hijas, 81 rechazos y 43 estados de proveedor.
- La worktree `codex/atinara-v6-radar-response-verify`, basada en `d11a08b`,
  reduce el presupuesto operativo a 900.000 bytes. La proyección conserva
  familias completas y en el corpus productivo entrega 5 padres, 52 hijas y los
  81 rechazos en 736.373 bytes; los 2 padres restantes quedan accesibles mediante
  `next_parent_offset=5`. No elimina una hija aislada ni mezcla familias.
- El ajuste de 900.000 bytes pasa 491 unitarias, sintaxis de 126 JavaScript,
  TypeScript, Edge 9/9, SQL estático 17, navegador 11 casos/3 viewports y cero
  red externa, canonicalización Node/Deno con SHA idéntico y benchmark offline
  5/5. El scan diferencial Codex Security `e6c29c7e` cerró con cobertura completa
  y cero hallazgos. Ese ZIP ya fue subido y quedó canónico en `3d0db378`; el
  smoke no se reanudó porque el preflight visual posterior detectó la incidencia
  de completitud/identidad descrita arriba.

### Cierre sistémico local V6 de Radar y ciclo de mercado · 22 de agosto de 2026

- La rama histórica `codex/atinara-v6-systemic-closure` partió exactamente de
  `origin/main = 1ca7f79d87486cb29bc25dc29be9b2a2ce38ae5e`. Su entrega ya está
  canónica y desplegada conforme al checkpoint anterior; no ha ejecutado Gemini
  live ni ha confirmado, publicado, resuelto o liquidado ningún mercado.
- La causa de los timeouts del Radar era estructural: el writer llamado
  «batch» recorría cada fila, reentraba en otro writer completo, actualizaba el
  snapshot del proveedor por candidata y no conservaba intención, cursor ni
  lease durable. La migración nueva
  `20260820163014_harden_radar_provider_resumability_v1.sql` añade intención,
  lotes reanudables, manifest, lease, circuito por capacidad, cuarentena única,
  eventos append-only y finalización idempotente. Tavily queda como capacidad
  de enriquecimiento y no degrada la salud de Polymarket o Kalshi.
- Radar, Editor, Validator, Corrector y la puerta de publicación comparten ahora
  un contrato versionado de incidencias. Una misma `issue_id` viaja entre
  sujetos mediante enlaces append-only; cada incidencia declara responsable,
  reparabilidad, alcance de bloqueo y siguiente acción. Un problema reparable
  permite formulario y borrador privado, pero no aprobación ni publicación.
  Una condición terminal se detiene en Radar y no expone Editor, Gemini o
  creación de borrador.
- `atinara-temporal-contract-v1` conserva por separado todas las fechas crudas
  del proveedor y su semántica. El cierre técnico nunca se convierte por
  fallback en fecha de evaluación de Atinara; sin evidencia oficial, las fechas
  canónicas permanecen nulas y se crea una incidencia dirigida. No se inventa
  `Europe/Madrid` en un borrador incompleto. La ausencia numérica tampoco se
  convierte en cero ni en `0 %`.
- La identidad y el dominio se calculan mediante reglas generales: las opciones
  categóricas conservan `option:<slug>`, los placeholders permanecen separados,
  la paginación corta por evento padre y una señal gaming negativa solo domina
  cuando no existe evidencia positiva tipada del mismo campo. No se añadieron
  títulos concretos a producción.
- La migración aditiva
  `20260820174316_add_market_workflow_orchestration_v1.sql` incorpora ledger de
  incidencias, enlaces, snapshots temporales, intentos de publicación, estados
  de artefacto y wrappers de recuperación. Registry V2.1, su versión y su hash
  permanecen sin cambios. RLS está forzada, no existen grants directos de API y
  los writers estrechos vuelven a comprobar actor, versión, huella y autoridad.
- La publicación programada revalida la fuente registrada sin Gemini antes del
  efecto. Evidencia equivalente permite un segundo pase idempotente; un cambio
  material reabre Corrector; una aprobación legacy sin baseline vuelve al
  Validator sin backfill; un fallo técnico conserva autoridad. Un `force_review`
  compatible conserva confirmación solo con un evento auditado de carry-forward.
- El hardening final liga también la revalidación just-in-time de Radar a la
  huella de dominio actual y hace autoritativa únicamente la check PRIMARY más
  reciente. Las inserciones de checks se serializan contra el borrador y un
  retry técnico de publicación reclama/resuelve solo su incidencia exacta; no
  borra otros blockers ni debilita la confirmación humana.
- Evidencia local actual: 490/490 unitarias; sintaxis de 126 JavaScript;
  canonicalización idéntica Node/Deno; TypeScript; 17 suites SQL estáticas;
  58 archivos de migración, de los que se aplicaron 57 desde cero en PostgreSQL
  17 omitiendo únicamente la reconciliación material histórica
  `20260809145000`; 17/17 suites SQL reales con `ROLLBACK`; carga Radar de 240
  filas; carreras reales de Radar, Official Opportunity y publicación con una
  sola intención/efecto; Edge 9/9; once casos de UI local con Auth/RPC/Edge
  simulados en 390/768/1366 px; benchmark offline 5/5 con
  `externalNetworkCalls=0`; auditoría npm sin vulnerabilidades, validador Codex
  y `git diff --check` verdes. Esta evidencia de navegador no demuestra la
  integración Browser→Edge→Postgres ni producción.
- `13.5.2` todavía no puede declararse apto para cierre: falta subir y desplegar
  el checkpoint de presupuesto Radar, completar los smokes productivos y el E2E
  hasta `review_approved`. La confirmación humana y la publicación única siguen
  requiriendo la pausa y autorización previstas.

### Radar verificado y reparación local del guardado experto · 15 de agosto de 2026

- GitHub publicó los ocho archivos revisados de la corrección de
  identidad/horizonte y `origin/main` avanzó después hasta
  `f7b5afc2b8f123a39f2da5b94331fbb7dcafd4cb`. El preflight productivo volvió a
  confirmar cero borradores o mercados categóricos Radar con identidad legacy
  `deadline:*`. Se aplicó una sola vez
  `20260815165805_fix_radar_family_option_horizon_v1.sql`; no contiene backfill,
  no exigió redeploy de Edge y preservó owner, `SECURITY DEFINER`,
  `search_path`, ACL y datos de dominio.
- Una única actualización administrativa del Radar, sin Gemini, confirmó que
  las opciones Kalshi de The Game Awards 2026 entran en su horizonte
  predictivo, conservan `option:<slug>`, separan hermanas y bloquean solo
  duplicados exactos cross-provider. Mercados, borradores, predicciones,
  perfiles, Karma, Prestigio, LMSR y huellas económicas permanecieron
  invariantes fuera de las escrituras técnicas normales de ese refresh. La
  incidencia concreta de identidad/horizonte queda cerrada.
- La Fase 1 continuó con la candidata válida de Half-Life 3
  `38d6979a-25bd-4767-bbe4-095c6c76e972`. Market Expert completó el run
  `db6b4335-ed28-4bbd-aa8d-fff7c8cb3dc3`, pero el guardado privado falló de
  forma cerrada con `RADAR_PREPARATION_REVISION_MISMATCH` /
  `DRAFT_VERSION_MOVED`. La candidata quedó en revisión 83, sin
  `prepared_draft_id`, y no se creó ningún borrador; Validator, Corrector,
  confirmación y publicación no se ejecutaron.
- La causa es un rebinding histórico entre capas `SECURITY DEFINER`:
  `save_market_draft_from_radar_intelligence_without_revision_guard` llamaba al
  nombre público `save_market_draft_from_radar`, que más tarde pasó a ser el
  wrapper de elegibilidad y volvió a exigir la revisión ya consumida. El mismo
  wrapper tampoco distinguía el replay exacto después de la transición
  `available -> prepared`.
- La rama local `codex/atinara-radar-expert-save-wrapper-fix` parte exactamente
  de ese `origin/main`. La migración nueva
  `20260815172317_fix_radar_expert_save_wrapper_v1.sql` enlaza el helper experto
  con la implementación preservada, mantiene todas las guardas de ejecución,
  contrato, fuentes y binding, y admite solo un replay preparado exacto. El
  replay no reescribe procedencia ni ligaduras; una UUID, contrato, fuentes,
  actor u origen distintos fallan y revierten la transacción.
- La validación local pasa 461/461 pruebas, sintaxis de 114 archivos,
  canonicalización idéntica Node/Deno, TypeScript y 9 suites SQL estáticas. En
  PostgreSQL 17.10 desechable, el stack canónico más la migración nueva ejecutó
  guardado manual y experto, replay exacto, rechazos incompatibles y controles
  de ACL dentro de `BEGIN/ROLLBACK`, sin mercado ni mutación económica. El
  paquete no está desplegado: no hubo SQL remoto, Edge, Gemini adicional,
  borrador, confirmación, publicación, resolución o liquidación. La continuidad
  se detiene para que Yol suba el ZIP incremental a GitHub.

### Smoke sin Gemini y corrección local de identidad/horizonte Radar · 15 de agosto de 2026

- La Fase 0 productiva de Official Opportunity Discovery V2 terminó con una
  sola intención manual y cero inferencias: run
  `e03cf486-e2d8-4435-934c-0d9a6986441d`, request
  `0318e4fb-7263-4a05-858c-4d697b1cb80b`, estado `partial`, ocho resultados
  de índice, cinco documentos oficiales inspeccionados, cero candidatas
  estructuradas y cero señales persistidas. Los únicos códigos fueron dos
  `OFFICIAL_SOURCE_NOT_REGISTERED` y un
  `OFFICIAL_SOURCE_RESPONSE_TOO_LARGE`. Consulta y HTML no se persistieron;
  no cambió ningún mercado, borrador, predicción, perfil, expediente experto,
  binding ni dato económico.
- Al iniciar el ciclo real Radar sin Gemini, una actualización administrativa
  dejó once opciones Kalshi de The Game Awards 2026 elegibles, pero la lista
  devolvió cero. La causa no era disponibilidad: la Edge derivaba
  `option:half-life-3`, `option:saros`, etc., mientras el trigger Postgres
  volvía a calcular todos esos hijos como la misma frontera
  `deadline:lt:2027-01-01T00:00:00.000Z:year`. Además, la RPC de lista
  aplicaba el horizonte al cierre técnico de Kalshi
  (`2027-12-31T15:00:00Z`) en vez de a la frontera predictiva de la familia
  (`2027-01-01T00:00:00Z`).
- La corrección local parte de `origin/main =
  87cab0819555f4c74aa6fb9546a926fc021e435d` en
  `codex/radar-family-option-horizon-fix`. La migración aditiva
  `20260815165805_fix_radar_family_option_horizon_v1.sql` alinea la prioridad
  de Postgres con la Edge: en `outcome`, `participant` y `platform`, una
  opción estructurada identifica al hijo y la fecha solo ordena/acota la
  familia. El trigger conserva su optimización únicamente cuando la proyección
  entrante coincide; por eso la siguiente actualización normal repara
  identidades históricas incorrectas sin backfill.
- `list_market_radar_candidates_v2` usa ahora una proyección privada común:
  una frontera familiar superior/exacta y las fechas de evaluación preceden a
  `atinara_closes_at` y al cierre técnico del proveedor. `gt/gte` marca un
  inicio, por lo que usa el fin evaluado/Atinara/proveedor; un fin ya vencido
  se excluye. La ordenación por cierre usa esa misma proyección. La identidad
  categórica se conserva además en candidata → borrador → mercado para que el
  gate exacto cross-provider no pierda una opción ya preparada; `market_id`
  prevalece y una colisión entre dos borradores aún publicables con el mismo
  slug falla cerrada. No se alteran preguntas, políticas, IA,
  proveedores, modos, rutas, presupuestos, secretos ni autoridad humana.
- Un `SELECT` de compatibilidad previo al despliegue confirmó en producción
  cero borradores Radar vinculados a dimensiones categóricas y cero enlaces
  legacy `deadline:*` activos o publicados. La corrección no requiere ni
  autoriza backfill o DML de datos existentes.
- Este párrafo describía el corte local del paquete original. Su aplicación y
  el refresh productivo posterior están verificados en la sección anterior y
  sustituyen ese estado histórico; la migración no debe repetirse.

### Reparación local de doble ejecución · Official Opportunity Discovery V2 · 15 de agosto de 2026

- Base limpia verificada: rama `codex/official-discovery-idempotency-v1`, `HEAD = origin/main = f38ae2dc4d30eae99bcfbca3ef1cd535a588e690`. El paquete es exclusivamente local: no ejecutó SQL remoto, deploy, Gemini, commit, push, publicación, confirmación, resolución o liquidación.
- Incidente preservado: una sola intención produjo dos POST, dos runs parciales y cero señales con idéntica huella de consulta. Las filas `fd1db3c2-72e5-4f37-a77e-18b8c834c988` y `635bc7fc-154d-4e1c-9507-59a346cb156a`, y sus request IDs Edge asociados, no se modifican. La causa fue la ausencia de una identidad autoritativa común entre UI, Edge y Postgres; un estado visual global no cerraba la carrera.
- La UI genera una UUID por intención, comparte una sola promesa durante doble submit y reutiliza el ID tras un transporte ambiguo. `data-observatory` valida la UUID y reclama la operación mediante `begin_official_opportunity_discovery_v2` antes de Tavily o de una página oficial. Actor y huella distintos fallan cerrados.
- La migración nueva `20260815115516_harden_official_opportunity_discovery_idempotency_v2.sql` no edita ni repite V1. Añade unicidad parcial en `private.data_provider_runs`, lease de reloj de pared y finalización con `FOR UPDATE`; un replay no entra en red, no crea un segundo run y retorna antes de tocar señales. Otra intención solo refresca una señal cuando el payload validado cambió; un duplicado idéntico es no-op y evidencia crítica nueva marca el análisis previo como `stale`.
- Los estados técnicos quedan separados en `success`, `zero_results`, `partial` y `technical_failure`. El resumen guarda solo versiones, huellas, contadores, códigos y cuota saneada. Puede explicar ocho URLs encontradas, siete documentos inspeccionados y un código de fallo sin persistir consulta, HTML o URL fallida.
- La suite focal pasa 24/24, la suite completa 454/454 y el grafo Deno de las nueve Edge Functions está verde. V1 y V2 se aplicaron juntas sobre PostgreSQL 17 local desechable; la suite SQL pasó con `ROLLBACK`, incluyendo tipos JSON exactos, no-op idéntico y refresh con `stale`. Las carreras reales de dos sesiones produjeron `started=1`, `in_progress=1`, `rows=1`, `finished=1`, `replayed=1` y una finalización bloqueada hasta después de la lease terminó como `interrupted`, seguidas de limpieza a cero. La base temporal fue eliminada y el servidor local detenido; los runners rechazan hosts remotos, parámetros libpq de redirección y variables `PG*` de routing.
- La Fase 0 local está completa y revisada. La siguiente acción es que Yol suba el ZIP incremental y responda `SUBIDO`; después se verificará `origin/main` y, bajo la autorización maestra vigente, se aplicará exclusivamente la migración V2 y se desplegarán `data-observatory` y el frontend para un único smoke de regresión sin Gemini. No se inicia la Fase 1 antes de esa pausa ni se continúa automáticamente con el cierre 13.5.2 o la ampliación de Datos y tendencias.

### Paquete local · Validator single-inference smoke + Official Opportunity Discovery V1 · 15 de agosto de 2026

- La rama local `codex/official-opportunity-discovery-v1` parte exactamente de `origin/main = c1b6d41885aca2a2758ac1fc5c11e190c237a9fe`. Este paquete no está desplegado y no ejecutó SQL remoto, Gemini live, commit, push, PR, publicación, confirmación, resolución o liquidación.
- AI Gateway incorpora el perfil interno `single_inference_smoke_v1`, permitido solo para `market_draft_validation` en `legacy_direct`. Desactiva retry HTTP, retry de salida inválida y fallback de schema, con límite declarado de una petición de proveedor. La revisión normal sigue en `standard`; no cambian modos, rutas, modelos, flags o presupuestos.
- `validate-market-draft` exige para ese perfil una sesión administrativa vigente, borrador/versión explícitos, `force_review=true` y un `attempt_id` UUID proporcionado por la operadora. El puente está disponible solo para una invocación manual desde la consola y no añade un botón productivo. Cualquier smoke live y sus escrituras de revisión requieren una autorización separada.
- Official Opportunity Discovery V1 añade a Datos y tendencias una búsqueda manual de acontecimientos futuros sobre dominios primarios activos del registro. Reutiliza Tavily solo como índice limitado de URLs; descarga y valida cada página oficial, extrae exclusivamente JSON-LD futuro, construye un contrato binario completo y clasifica duplicados contra mercados y borradores.
- El hardening local consume cada página con límite incremental de 600 kB y timeout activo, limita a 128 nodos JSON-LD por documento, exige autoridades registrales distintas para la corroboración y falla cerrado si no puede comprobar mercados y borradores. Los cambios de evidencia/contrato/duplicados dejan el análisis previo `stale`, y el autofill valida de nuevo el paquete y su huella sin ejecutar otra inferencia.
- La migración nueva `20260814232218_add_official_opportunity_discovery_v1.sql` amplía el proveedor de señales con `official_web` y crea una RPC service-only. Esa RPC solo puede escribir `private.data_observatory_signals` y `private.data_provider_runs`; no crea borradores ni toca mercados. La consulta y el HTML crudo no se persisten.
- La interfaz mantiene acciones separadas: descubrir señal, revisión humana, análisis opcional del Agente Editor, aplicación al autofill existente y guardado manual. Twitch, YouTube, X u otra fuente solo entran en V1 si su dominio oficial está registrado y ofrece un acontecimiento futuro estructurado; no se aceptan rumores ni tendencias como fuentes vinculantes.
- Contrato, seguridad, operación, despliegue futuro y rollback están documentados en `docs/ATINARA_OFFICIAL_OPPORTUNITY_DISCOVERY_V1.md`. El siguiente paso permitido por este paquete es únicamente validación local y entrega ZIP; migración, Edge, frontend y cualquier smoke live quedan sujetos a autorización posterior.

### Publicación y verificación de Atinara Canonical JSON v1 · 14 de agosto de 2026

- `origin/main = bcebd8ea62c5212aebfb0b7ba35f0b63c35129b9` publica los diez archivos del paquete `ATINARA_CANONICAL_JSON_V1`, creado originalmente desde la base `20ba48d7a5eae3add57a865a724a6f4fe9b2dce5`. Introduce `ATINARA_CANONICAL_JSON_VERSION = "atinara-canonical-json-v1"` para las huellas compartidas por AI Gateway, Agent Runtime V2 y Registry V2.
- El serializador directo ordena claves recursivamente por unidades UTF-16 sin locale, conserva arrays densos, no normaliza Unicode y usa serialización ECMAScript para strings y números. No ejecuta `toJSON` ni accessors y rechaza valores no JSON o ambiguos con los códigos vigentes.
- La versión identifica contrato, fixture y documentación, pero no se añade al contenido hasheado ni a datos persistidos. Cualquier incompatibilidad futura exige v2 y una transición explícita.
- El fixture compartido conserva como literales cinco inputs saneados, cinco outputs validados, un snapshot de Registry V2 y los payloads simples de progreso y replan de Runtime V2. Las 13 huellas forman la puerta de compatibilidad del paquete.
- El defecto de `localeCompare()` queda cubierto por claves `0`, `1`, `2`, `10`, `4294967294`, `4294967295`, Unicode y claves especiales. Su canonical string literal tiene SHA-256 independiente `14141cffbafc63c88d3468cf5e5fcfc139597f0ac4b2f7b28a8951c0e35ede8e`; el candidato anterior `72c408...` no se usa como evidencia.
- El objetivo es “sin alterar las cadenas ni huellas de los valores productivos válidos cubiertos por los contratos V2.1 actuales; los valores no JSON o previamente ambiguos se rechazan conforme al contrato v1”. No se modifica frontend, README, migraciones, SQL, Edge entrypoints, Auth, modos, flags, presupuestos, proveedores ni datos.
- Los cuatro workflows asociados al SHA publicado —configuración Codex, benchmark IA offline, calidad y GitHub Pages— terminaron en `success`. SonarQube Cloud analizó el mismo SHA y devolvió Quality Gate `OK`: fiabilidad, seguridad y mantenibilidad A, duplicación nueva `0.8 %` y hotspots revisados `100 %`.
- El baseline independiente sobre una rama limpia del mismo SHA superó 420/420 pruebas, sintaxis de 107 JavaScript, canonicalización idéntica Node/Deno, TypeScript, cinco suites SQL estáticas, 9/9 Edge Functions, benchmark offline 5/5 con `externalNetworkCalls=0`, auditoría npm sin vulnerabilidades, validador Codex y `git diff --check`.
- La lectura productiva confirmó Supabase `ACTIVE_HEALTHY` y las migraciones V2.1 `20260813163839`, `20260813163918` y `20260813163959` aplicadas una sola vez. Antes del redeploy, dos consultas SQL exclusivamente `SELECT` confirmaron las cinco tareas en `legacy_direct`, rutas nulas, flags OpenRouter/NVIDIA NIM apagados y los quince límites diarios en cero.
- Con autorización expresa se redesplegaron secuencialmente Radar v56 (`177f2e63c69bc684c2abfbbf75934b233b78bb10c066ce9a0235746dba41e869`), Expert v23 (`fbdc1b6f0abaf1cbb76979e1827f8e8991f2bbdf02a652911618e16b1277979c`), Corrector v20 (`1156dda735d87083e9ac201b0823695bf4f2a732fec74d3fc71bfa9b761b6403`), Validator v28 (`f6a0e11746850e55d7bd24fc37f6f617e46421f3d8be8b19f32a5c2dbb98a8d9`) y Resolución v16 (`d78fd05f920340b2e98d00941258362acaefc35e67471de4d4adec7fd45222eb`). Todas permanecen `ACTIVE` con `verify_jwt=true`.
- La verificación independiente posterior leyó los cinco bundles completos: todos declaran `ATINARA_CANONICAL_JSON_VERSION = "atinara-canonical-json-v1"`, ninguno conserva `localeCompare()` u `Object.fromEntries`, y los cuatro catálogos de inferencia mantienen OpenRouter y NVIDIA NIM con `enabled: false`. El redeploy no cambió SQL, modos, flags, presupuestos, secretos, datos ni autoridad humana; tampoco ejecutó smoke Gemini, shadow, canary o routing.

### Corrección local de `duplicate_matches` entre Market Expert y AI Gateway · 14 de agosto de 2026

- El único smoke Gemini autorizado para `market_expert_reasoning` creó y finalizó la fila técnica `private.market_expert_runs.id = 5bbf2419-99d3-406f-8840-809fae7e8e06`, pero el Gateway rechazó la petición antes de Gemini con `AI_INPUT_FIELD_NOT_ALLOWED` en `input.origin.duplicate_matches`. No hubo intento de proveedor ni persistencia de datos de dominio. Ese run se conserva sin modificación como evidencia del fallo.
- La causa era una deriva entre contratos: el productor `safeOrigin()` ya conservaba `duplicate_matches`, la puerta determinista lo usa para bloquear duplicados y `modelSafeOrigin()` elimina recursivamente identificadores, pero el vocabulario cerrado `PUBLIC_JSON_ALLOWED_KEYS` no declaraba la clave. La auditoría completa contó 120 claves posibles del productor y 109 capaces de alcanzar el Gateway; tras declarar `duplicate_matches`, ninguna queda desalineada.
- La corrección local parte de `origin/main = 6135d132b5fcabf10859a1601d261c5e19a6cec5` en `codex/fix-market-expert-duplicate-matches`. Amplía el vocabulario contractual solo con ese dato ordinario, exige que su valor sea un array y añade regresiones de array vacío, coincidencia real saneada generada por el clasificador de Radar, enlaces de ejecución productor→Gateway y rechazo exacto de identificadores, PII, secretos y campos desconocidos. No cambia canonicalización, huellas vigentes, Runtime V2, Registry V2, Edge entrypoints, SQL, Auth, modos, rutas, flags, presupuestos, modelos, proveedores ni datos.
- El baseline local pasa 424/424 pruebas mediante `npm run validate`, canonicalización idéntica Node/Deno con 13/13 huellas de dominio, 9/9 Edge Functions con IA externa desactivada, benchmark offline 5/5 con `externalNetworkCalls=0`, auditoría npm de 281 dependencias sin vulnerabilidades y `git diff --check`.
- Producción continúa en `market-expert` v23 con `legacy_direct`, rutas nulas y proveedores experimentales apagados. El siguiente paso requiere autorización independiente para desplegar únicamente `market-expert` y ejecutar exactamente un nuevo smoke sobre otra candidata saneada sin expediente previo; no implica promoción, shadow, canary ni routing.

### Activación productiva controlada de V2.1 en `legacy_direct` · 13 de agosto de 2026

- Base canónica verificada antes de actuar: `HEAD = origin/main =
  88bb409330e554ae5494addfac1b7343a347aab6`, worktree limpio y divergencia
  `0/0`. La intervención no hizo commit, push, deploy de frontend, cambio de
  secretos, benchmark live, activación de proveedores ni acción sobre mercados.
- Las migraciones locales V2.1 se aplicaron en el orden cerrado y Supabase las
  registra como `20260813163839_harden_radar_eligibility_rls_v1`,
  `20260813163918_add_ai_gateway_telemetry_and_budgets_v1` y
  `20260813163959_add_agent_engine_v2_v1`. Son aditivas y conservan registry,
  wrappers y rollback v1.
- Los trece ledgers y registries privados auditados tienen RLS habilitado y
  forzado, sin privilegios directos para `anon`, `authenticated` o
  `service_role`. Las cinco suites SQL v7, v8, RLS v12, budget/telemetría y
  Agent Engine v2 pasaron juntas en producción dentro de `BEGIN/ROLLBACK`.
  `radar_eligibility_v7_transaction.sql` se corrigió localmente para probar la
  elegibilidad de candidata que pertenece a v7; el binding de borrador vigente
  desde v8 continúa cubierto por `agent_engine_confirmation_v8_transaction.sql`.
- Se desplegaron secuencialmente Radar v55
  (`b2c842c717d265c09abaaaccb5eed0d013b2ab8be262a9d2e5d15d672531b861`),
  Expert v22
  (`9b5b8bf1f547cad8638598aa2a081c1de7e0c08efbc4032df5c574bff1b5a6e8`),
  Corrector v19
  (`1e6b006b31601bdfb884c7266133d64dd2879e3e9142b0dccda059c68a0fa9a4`),
  Validator v27
  (`494afb960213898ef9db1c2d4aab788c8d744d0c3d81037311412c3f727f1b2d`)
  y Resolución v15
  (`9d065ad553ea8dd1c5903fe6e3aff1610ad03d11c982c4fa21c6fc364b78f235`).
  Las cuatro rutas que infieren usan el Gateway común; ninguna Edge conserva
  URL o transporte directo de proveedor. Radar continúa ejecutando cero IA.
- El control final confirmó cinco settings en `legacy_direct`, rutas nulas,
  flags experimentales apagados, quince límites diarios en cero y cero
  reservas, intentos, runs o steps. Los smokes sin credencial devolvieron `401`
  en las cinco Edge y no iniciaron inferencias.
- Los hashes y recuentos autoritativos de mercados, predicciones, perfiles,
  Karma, Prestigio, maker state e histórico son idénticos al baseline previo.
  La validación local posterior pasó 412/412 pruebas, sintaxis de 106
  JavaScript, TypeScript, cinco suites SQL estáticas, 9/9 Edge checks y
  benchmark offline 5/5 con cero red.
- Continúan pendientes de autorización separada: comprobar credenciales sin
  leer valores, smoke autenticado de paridad, capability discovery live,
  ground truth aprobado, benchmark live, shadow, canary y cualquier cambio a
  `gateway_gemini_parity`, `gateway_routing` o proveedor experimental.

### Implementación local Agent Engine V2.1 + AI Gateway · 12 de agosto de 2026

- Base verificada antes de editar: `HEAD = origin/main =
  d3073bb274be7a4d4085378b661cee1323485fdf`. La implementación vive en la rama
  local `codex/atinara-agent-engine-v2-1`; no se hizo commit, push, despliegue,
  SQL remoto, cambio de secretos ni activación de flags.
- Las invocaciones Gemini activas se extrajeron de `market-expert`,
  `market-draft-fixer`, `validate-market-draft` y
  `analyze-market-resolution` al contrato común de
  `supabase/functions/_shared/ai/`. `market-radar` conserva cero inferencias y
  su contrato histórico dormido queda centralizado para paridad y rollback.
  Ninguna de esas cinco Edge contiene ya URL, modelo o `generateContent`
  directo.
- La transición es por tarea: `legacy_direct` preserva los modelos y
  particularidades vigentes; `gateway_gemini_parity` exige presupuesto medido;
  `gateway_routing` queda pendiente de promoción. OpenRouter y NVIDIA NIM
  permanecen apagados, con presupuesto cero y sin dependencia de credenciales
  o endpoints gratuitos para completar el hito local.
- El Gateway calcula fingerprints después de sanear, resuelve política y
  transporte desde registros cerrados, reserva presupuesto atómico, limita
  bytes y deadline y aplica validadores deterministas específicos por tarea.
  Los errores y la telemetría no transportan prompts, payloads, respuestas ni
  secretos. Un fallo de observabilidad conserva el outcome y no repite la
  inferencia.
- Runtime v2 incorpora Issue, Strategy y Tool Registry, dispatcher real,
  detección de loops/no progreso/stale snapshot, dos replans máximos y un solo
  writer por ronda. Editor y Radar no escriben mercados; Corrector mantiene CAS,
  idempotencia, una versión por ronda y revalidación. Ningún agente confirma,
  publica, resuelve o liquida.
- Las migraciones locales nuevas son `20260812141508_harden_radar_eligibility_rls_v1.sql`,
  `20260812141511_add_ai_gateway_telemetry_and_budgets_v1.sql` y
  `20260812141515_add_agent_engine_v2_v1.sql`. Son aditivas, preservan v1 y sus
  wrappers, fuerzan RLS en los ledgers Radar y crean wrappers estrechos
  service-only/admin. Las tres se aplicaron en orden sobre PostgreSQL temporal y
  sus nuevas suites transaccionales pasaron dentro de `BEGIN/ROLLBACK`.
- Verificación local: 410/410 pruebas unitarias; sintaxis válida en 106
  JavaScript; 9/9 Edge Functions comprobadas con Deno 2.1.14; TypeScript verde;
  5/5 fixtures de benchmark offline con cero red; tres suites SQL V2.1
  ejecutadas con rollback; auditoría npm con cero vulnerabilidades; y recorrido
  administrativo local verde en 1280×720 y 390×844 sin errores de consola ni
  desbordamiento horizontal.
- El corpus público contiene solo cinco fixtures técnicos `draft`. Continúan
  pendientes del hito operativo: credenciales y capability discovery live,
  corpus revisado, ground truth `approved`, benchmark live, shadow de 14 días,
  canary, despliegue, cambios de modo y cualquier promoción de proveedor.
  Producción y GitHub Pages siguen en el corte descrito debajo hasta una acción
  manual posterior de Yol.

### Corrección local de SonarQube Cloud · 12 de agosto de 2026

- Base verificada: `origin/main =
  ec844c78793ed490899fc87b21583ca549a35839`, rama local aislada
  `codex/atinara-sonar-cleanup`. No se hizo commit, push, despliegue, SQL
  remoto, cambio de secretos ni activación de flags.
- El análisis publicado contenía 40 incidencias abiertas de tipo Bug o
  Vulnerability. Las 30 situadas en código, tests y workflow editables se
  corrigieron localmente: pin inmutable de la acción Deno, callbacks explícitos,
  comparadores de orden, entropía Web Crypto, agrupación de regex, eliminación
  de claves duplicadas y ramas idénticas, `WHERE` acotado en tests SQL y
  sustitución de autoasignaciones de prueba.
- El aterrizaje posterior a publicación ya no usa `innerHTML`: normaliza el ID
  como UUID, limita el texto recibido desde storage/BroadcastChannel y construye
  el aviso con DOM y `textContent`. La navegación conserva el ID codificado y
  nunca interpreta la pregunta como markup.
- Las diez incidencias restantes pertenecen a seis migraciones ya aplicadas y
  no se reescribieron. `SONARQUBE_QUALITY_GUIDELINES.md` documenta las parejas
  exactas de regla/ruta que Yol debe configurar en Analysis Scope. La
  duplicación de migraciones se excluye solo del cálculo CPD mediante
  `sonar.cpd.exclusions`; los archivos continúan dentro del análisis de
  seguridad, fiabilidad y mantenibilidad. `supabase/tests/**` queda clasificado
  expresamente como código de prueba.
- Verificación local posterior: 412/412 pruebas unitarias, sintaxis válida en
  106 JavaScript, 9/9 Edge Functions con Deno 2.1.14, TypeScript verde, cinco
  suites SQL con límites transaccionales validados estáticamente, benchmark
  offline 5/5 con cero red, `npm audit` con cero vulnerabilidades, prueba de
  navegador del aviso de publicación y `git diff --check` verde. Las suites SQL
  ejecutables no se repitieron porque este worktree no dispone de PostgreSQL
  desechable ni `ATINARA_TEST_DATABASE_URL`; ya habían pasado con rollback en el
  corte V2.1 inmediatamente anterior y no se modificó ninguna migración.
- En este corte local el Quality Gate remoto no se declaró verde: todavía
  quedaban pendientes la subida manual del paquete, las excepciones exactas en
  el panel de Sonar y un análisis nuevo. Ninguna excepción amplia sobre código
  editable es aceptable.

### Verificación publicada de SonarQube Cloud · 13 de agosto de 2026

- `origin/main = 43ed85cec0d81c9f23c813710d389b98838ac530` contiene la
  implementación V2.1, los workflows y las correcciones editables de Sonar.
  `Calidad de Atinara`, `Benchmark IA offline` y GitHub Pages terminaron en
  `success` para ese mismo SHA. Pages sirve la release coordinada
  `20260812-agent-engine-v21`.
- La validación independiente del árbol publicado volvió a superar 412/412
  pruebas, sintaxis de 106 JavaScript, TypeScript, cinco suites SQL estáticas,
  9/9 Edge Functions con Deno 2.1.14, benchmark offline 5/5 sin red, auditoría
  npm sin vulnerabilidades y `git diff --check`.
- El análisis automático de Sonar corresponde al mismo SHA. Seguridad,
  mantenibilidad, duplicación y hotspots ya cumplen la puerta; la fiabilidad
  permanece en E únicamente por una incidencia
  `plsql:DeleteOrUpdateWithoutWhereCheck` sobre la migración aplicada
  `20260808120000_add_authoritative_draft_versions_and_review_attempts.sql`.
- El panel de Sonar conserva ahora los siete criterios exactos documentados,
  incluida esa ruta sin espacios iniciales o finales. La configuración quedó
  guardada y verificada mediante la API de settings. Sonar no permite relanzar
  el análisis automático sin un push real; este cambio documental puede usarse
  para provocarlo. Hasta comprobar el resultado nuevo no se declara verde el
  Quality Gate ni se avanza al despliegue operativo.
- El preflight remoto de solo lectura confirmó Supabase `ACTIVE_HEALTHY`. Las
  tres migraciones V2.1 siguen pendientes, sus tablas todavía no existen y las
  cinco Edge de IA desplegadas conservan el transporte Gemini directo de V1.
  No se ejecutó SQL, despliegue, cambio de secretos, flags ni datos.

### Cierre de agente, autoridad y publicación · 12 de agosto de 2026

- Base local exacta: `origin/main =
  1ed377b4bceb45589b2add0778a88b7174d0af6d`, worktree aislado
  `ATINARA-agent-engine-confirmation-20260812`, rama
  `codex/agent-engine-confirmation-20260812`. No se mezcló ni descartó ningún
  cambio ajeno y no se hizo push.
- Producción registra cuatro migraciones nuevas y no repetibles. Los archivos
  locales `20260811221546_...v8`, `20260812012000_...v9`,
  `20260812014000_...v10` y `20260812015500_...v11` corresponden a las versiones
  remotas `20260811230350`, `20260811231921`, `20260811232315` y
  `20260811232708`.
- V8 separa confirmación humana y publicación y liga esta última a una
  atestación append-only exacta de borrador, versión, huella, revisión,
  candidata, `preparation_revision`, check, `decision_hash` y política. V9
  rechaza una fuente genérica o perteneciente a otra opción: la autoridad debe
  proceder del contrato exacto. V10 prohíbe persistir razones técnicas
  reintentables como terminales. V11 proyecta `technical_hold` como
  `needs_review`, nunca como rechazo editorial.
- Las funciones activas y probadas son `market-radar` v54, bundle
  `fc56eccf4d1a5c2a751b550cb30cfe659974b9c543f4dd38179eea545fce0533`;
  `market-expert` v21, bundle
  `138fe047f218a5c559e969583bd155270693a72f6e4fad447a096fe39f7318a2`;
  y `market-draft-fixer` v18, bundle
  `e5eb51bed90656c6a9a947ca55277e305d31c8264c4a256b658525fa4712dce8`.
  Todas conservan `verify_jwt=true` y autorización administrativa en servidor.
- El refresh real v54 terminó con Polymarket `available` y 48 procesadas,
  Kalshi `available` y 79 procesadas, y Tavily/Ideas gaming en fallo técnico
  aislado. La UI conservó la cobertura útil y explicó la degradación. El
  cooldown descendió de 127 a 124 segundos en tres segundos.
- Marvel mostró 12 opciones elegibles; la opción `>95` ya preparada fue
  excluida por identidad exacta. Su borrador continúa v9, revisión efectiva 21
  `approved`, sin confirmación, programación, publicación ni `market_id`.
  Madden NFL 27 permanece terminal y oculto aunque Polymarket conserve opciones
  abiertas: la atestación vigente incluye el comunicado oficial de EA que
  identifica a Caleb Williams. Las hijas inactivas de Best Multiplayer 2026 se
  presentan como `PROVIDER_OPTION_INACTIVE`, no como evento padre resuelto.
- El advisor de seguridad devuelve 152 entradas: 49 `INFO` de tablas privadas
  con RLS y ninguna policy (denegación intencional), 18 funciones anónimas
  `SECURITY DEFINER` de lectura, 83 funciones autenticadas con control de
  administradora o propietaria, un aviso preexistente de `pg_net` y la
  protección nativa de contraseñas filtradas. No existe una RPC mutadora pública
  sin control de identidad. La protección nativa requiere plan Pro; HIBP en el
  cliente protege el flujo normal, pero no una llamada directa a Auth.
- La validación final pasa 358/358 pruebas, sintaxis de 74 JavaScript,
  TypeScript y `git diff --check`. Las matrices SQL v8–v11 pasaron en producción
  dentro de transacciones de prueba. Las huellas canónicas coinciden exactamente
  con la línea base: mercados
  `70d93479e2efe650e3623be40e9aee688216abdbe9866dd5f2a02f67da3ee137`,
  predicciones
  `170372fee7b857c67a51f2c3b33f9675f5b0b406c6040625520d2d6df2a3059c`,
  perfiles
  `8492fdfc993bc473e6a2d9f00924dc8b39b8650f196f86dcf049ed50a179f6bc`,
  LMSR `b3d1a0a27e6a7a754576057aba35c317c1b651388fe67ffceb13784472a0c927`
  y precios
  `8eb3d854e5ff20eb7ccad96efcbabd4d7545e17ffa457e74630d6f2f2e0f7adf`.
  Siguen 15 mercados, 9 predicciones, 2 perfiles, 2.932 Karma, 40 Prestigio,
  15 estados LMSR y 17 precios. Ninguna acción confirmó, programó, publicó,
  predijo, resolvió o liquidó un mercado.

### Elegibilidad, fuentes y resiliencia del Radar · 11 de agosto de 2026

- Fuente publicada exacta: `origin/main =
  d58173d5245708b3ff789a931b16f5f89721d58b`. La verificación posterior se hizo
  en el worktree aislado `ATINARA-security-advisors-20260811`, rama
  `codex/security-advisors-20260811`; no se descartó ni mezcló ningún cambio
  ajeno y no se hizo push.
- La revisión factual operativa se sustituyó por una decisión determinista y
  append-only de elegibilidad: `eligible`, `terminal`, `inactive_option`,
  `technical_hold`, `invalid` o `duplicate`. Un fallo técnico conserva el
  último expediente válido; Gemini no decide y no es una dependencia necesaria.
  Editor, confirmación y publicación exigen el check vigente, revisión y huella
  ligadas, y la confirmación humana continúa siendo obligatoria.
- La migración local no repetible
  `20260811163339_replace_radar_fact_gate_with_eligibility_v7.sql` consta en
  producción como `20260811185229 · replace_radar_fact_gate_with_eligibility_v7`;
  SHA-256 local
  `def8fb91fcc69193a6915645688b0f83d51b7e3194b57238dae27e2f51a0e318`.
  La matriz `radar_eligibility_v7_transaction.sql` volvió a pasar en producción
  dentro de `BEGIN/ROLLBACK`; no dejó filas de fixture ni cambios económicos.
- `market-radar` v50 está `ACTIVE`, `verify_jwt=true`, bundle
  `a3f0e433580bb7aaa8cb7a24e922c0fe5fbaae3ea2da23d03dd50c533baf5385`;
  `market-expert` v20 está `ACTIVE`, `verify_jwt=true`, bundle
  `c535c42eb5034e84e8a24d993bfd40bb179e33c17a9f3332d1de153c04d551e2`.
  Los dos archivos recuperados de cada función coinciden exactamente, salvo
  normalización CRLF, con el árbol local probado.
- El cierre del hijo ya no se confunde con el del evento padre. En el snapshot
  real de Best Multiplayer de The Game Awards 2026, las 27 opciones placeholder
  inactivas se presentan como `PROVIDER_OPTION_INACTIVE` porque el mismo evento
  conserva 21 hermanas abiertas y futuras. El código preserva aparte el motivo
  histórico original; no contiene excepción por título, premio o proveedor.
- Las 17 opciones abiertas de Madden NFL 27 quedaron terminales con
  `EVENT_ALREADY_RESOLVED` y cuatro hijas no negociables como
  `PROVIDER_OPTION_INACTIVE`. La evidencia es contenido oficial recuperado de
  EA, con URL, extracto y SHA-256, y cubre la designación y las ediciones
  aplicables; ninguna opción de esa familia vuelve al catálogo visible.
- Las fuentes resolutivas se eligen por sujeto, plataforma y registro de
  autoridad: Steam para PC, Nintendo eShop para Nintendo y PlayStation/PS Store
  para PlayStation cuando el contrato lo exige. Una URL HTTPS sin dominio
  registrado y evidencia exacta no habilita preparación. Los enlaces de otra
  opción del grupo no se heredan.
- El último refresh real dejó Polymarket `available` con 74/74 aceptadas,
  Kalshi `available` con 84/84, Tavily `available` con 0 y todos los circuitos
  cerrados; descartes técnicos, cuarentenas y fallos fueron cero. Los logs
  muestran `200` para Radar v49/v50 y Editor v20. Un cambio de pestaña no
  repitió timestamps de proveedor y el cooldown bajó de 31 a 29 segundos en
  2,2 s.
- Tras la publicación manual, un nuevo refresh real en Pages terminó con
  Polymarket, Kalshi e Ideas gaming `Disponible` y 74, 79 y 0 registros
  procesados, respectivamente. El botón pasó por `Actualizando…` y volvió a
  `Disponible en 147 s`; el contador continuó descendiendo en tiempo real y
  cambiar entre pestañas no volvió a consultar proveedores. El catálogo activo
  mostró 2 eventos y 13 opciones únicas, todas con la probabilidad individual
  del proveedor; al desplegar Marvel aparecieron las 12 opciones y no se
  duplicó ninguna pregunta.
- El smoke del Editor sobre una opción Marvel `> 85` produjo una propuesta
  validada y aplicable, con fuente oficial de Steam y sin
  `RADAR_FACTUAL_VERIFICATION_REQUIRED`; no se aplicó al formulario ni se creó
  un borrador. Marvel `> 95` permanece privado como v9, revisión efectiva 21
  `approved`, fingerprint
  `ba349eaef4f17591e1f98ae06aec9a3720c7dd4d93f7f3dfa7f6f50098a06d0c`,
  sin confirmación, programación, publicación ni `market_id`.
- La validación final pasa 348/348 pruebas, sintaxis de 72 JavaScript,
  TypeScript 6.0.3, Deno 2.5.6 para Radar y Editor, SQL transaccional y
  `git diff --check`. La revisión de seguridad profunda consumió 510.832 tokens
  y 2.543 s; cerró tres hallazgos P3: autoridad de fuente HTTPS, bootstrap
  histórico caducado y binding de revisión/check contra TOCTOU. Los advisors no
  muestran errores de rendimiento nuevos; los avisos RLS de tablas `private`
  sin políticas son el cierre intencional y las RPC exigen administradora.
- La revisión posterior de Advisors clasificó 83 avisos
  `authenticated_security_definer_function_executable` y 18 avisos
  `anon_security_definer_function_executable`. Las 83 funciones fijan
  `search_path`, ninguna concede `EXECUTE` al pseudo-rol `PUBLIC`, las 18
  anónimas son únicamente contratos `get_public_*` o `get_prediction_quote`, y
  ocho RPC administrativas distintas rechazaron una identidad autenticada no
  administradora con SQLSTATE `42501` dentro de `BEGIN/ROLLBACK`. La Data API
  también rechazó `get_admin_market_catalog` para `anon` con `401/42501`.
- El aviso `extension_in_public` corresponde al metadato no relocatable de
  `pg_net` 0.20.3: sus 12 funciones viven en el esquema `net`, ninguna función
  o trigger de Atinara las referencia y `public.http_get` devuelve `PGRST202`
  por no formar parte del esquema expuesto. No se movió ni recreó la extensión.
  Los 49 avisos de rendimiento restantes son solo `INFO` (14 claves foráneas
  sin índice y 35 índices aún sin uso con el volumen actual).
- El aviso nativo de contraseñas filtradas sí expresa una limitación residual
  del plan Supabase Free. El alta normal y la recuperación comprueban HIBP por
  k-anonimato y fallan cerradas, pero una llamada directa a Auth no puede ser
  interceptada por el cliente. La protección HIBP nativa requiere plan Pro;
  no se cambió facturación ni se sustituyó Auth por un flujo privilegiado.
- Las huellas finales coinciden con la línea base: mercados
  `70d93479e2efe650e3623be40e9aee688216abdbe9866dd5f2a02f67da3ee137`,
  predicciones
  `170372fee7b857c67a51f2c3b33f9675f5b0b406c6040625520d2d6df2a3059c`,
  perfiles
  `8492fdfc993bc473e6a2d9f00924dc8b39b8650f196f86dcf049ed50a179f6bc`,
  LMSR `b3d1a0a27e6a7a754576057aba35c317c1b651388fe67ffceb13784472a0c927`,
  precios
  `8eb3d854e5ff20eb7ccad96efcbabd4d7545e17ffa457e74630d6f2f2e0f7adf`
  y borradores
  `78e4fe5967094925270379a635bbb442aa85c3ccc5284a2a38a87c420bc91ee4`.
  Siguen 15 mercados, 9 predicciones, 2 perfiles, 2.932 Karma, 40 Prestigio,
  15 estados LMSR y 17 precios. No hubo predicción, liquidación ni publicación.
- GitHub Pages sirve `admin-markets.js` y `styles.css` con
  `v=20260811-radar-eligibility2`. El smoke real confirmó altura independiente
  mediante `align-items/start` y `align-self/start`, despliegue 4 → 13 botones
  `Detalles`, 13 preguntas únicas, 13 probabilidades, cero referencias a la
  antigua comprobación factual y conmutación dark → light → dark. Madden no
  aparece en los dos eventos activos y sus registros permanecen en auditoría
  como `Evento ya resuelto` u `Opción no disponible`.

### Cierre definitivo Radar → Editor → Corrector → publicación · 11 de agosto de 2026

- Fuente local exacta: `origin/main =
  1b10d0adbfdc62b787d70f10b16e86a08b876874`, rama aislada
  `codex/market-cycle-definitive`. No se mezclaron ni descartaron cambios de
  otros worktrees.
- Las capturas mezclaban descartes normales con salud del proveedor. La causa
  estaba en el agregado: Polymarket y Kalshi convertían filas rechazadas por la
  puerta de calidad en `partial_error`. El contrato v2 conserva por separado
  `accepted_count`, `discarded_count`, `quarantined_count` y `failed_count`; un
  proveedor que respondió y persistió sus filas sanas queda `available`, aunque
  muestre un resumen consultable de descartes.
- Gemini es un enriquecedor sustituible. `429`, `Retry-After`, timeout, red,
  respuesta inválida o `5xx` son incidencias técnicas reintentables; activan
  backoff, jitter, cooldown/circuito y `last-known-good`, sin borrar evidencia
  vigente, elevar versión, fabricar `{}` ni detener otros proveedores.
- Los seis códigos del Agente Editor eran una cascada de envoltorios. La UI y el
  backend conservan todos para auditoría, pero presentan la causa causal mínima,
  distinguen bloqueo terminal, reparación automática, incidencia técnica y
  decisión humana, y solo habilitan una transición realmente disponible.
- Marvel no fallaba por una regla especial del título. El validador llegó a
  inferir ausencia de Metacritic/producto aunque la misma ejecución conservaba
  una atestación HTTP 206 vigente y ligada a la versión. Además, sucesivas
  reparaciones perdían una fuente `CONTEXT_SOURCE` autoritativa. El corte v3
  permite que solo una atestación primaria fresca refute falsos bloqueos de
  existencia/acceso y recupera contexto únicamente desde bindings append-only.
  La regla temporal general derivó `2026-08-14T14:05:00Z` desde el final
  evaluado, disponibilidad de fuente, Europe/Madrid y margen de política, sin
  cambiar `Metascore > 95`. Marvel está privado como v9, fingerprint
  `ba349eaef4f17591e1f98ae06aec9a3720c7dd4d93f7f3dfa7f6f50098a06d0c`,
  revisión efectiva `approved`, sin confirmación, programación, publicación ni
  `market_id`.
- Producción registra tres migraciones nuevas y no repetibles:
  `20260809213543 · close_expert_market_cycle_v2`,
  `20260811100833 · harden_repair_evidence_and_idempotency_v3` y
  `20260811104727 · isolate_radar_poison_records_v4`. V4 añade cuarentena
  append-only y una única RPC por lote con subtransacción por candidata; una
  fila de datos inválida ya no consume múltiples viajes de red ni pierde filas
  sanas. Ninguna migración toca tablas económicas.
- Edge Functions productivas, todas activas y con JWT obligatorio:
  `market-radar` v33
  `d7737e578bd7ae8510a8e6395163b065a87e40eb0353e4e9f75b7c062121a94c`;
  `market-expert` v17
  `c6042aad369e4897e61e0dd8642f8da25de93f3a2d0db6a6ce221f8eb1182d48`;
  `market-draft-fixer` v16
  `1a01c7e2636d3b2420ba0467560e20d594ba0c12e4cf94cf35f7c5f1913f7d68`;
  `validate-market-draft` v26
  `7e0b7d551b0ad69177cc3430d3949209582455006a87f1d50fc3fdc38841a0b3`.
- Los archivos remotos recuperados de las cuatro funciones coinciden con el
  código local probado. Los SHA-256 locales de las migraciones v2/v3/v4 son
  `501cfcc9a0b29d7c673e7b9e552dbbfbb880908cbac442fbd367f1d1d0b88c28`,
  `791f67df1b92eb16a9e2e39d13234471f1d30b82e5228d21531f19e956ac1f48` y
  `82c02abcc66388e06f9a9b7aa566e41fa859f2a6032bb1a883df05cbcb0fb4db`.
- Las matrices SQL de ciclo e aislamiento pasaron dentro de `BEGIN/ROLLBACK`.
  La puerta positiva de publicación materializó un resultado y lo revirtió;
  confirmó que la confirmación humana sigue siendo obligatoria. La suite local
  pasa sintaxis de 71 JavaScript, 319/319 pruebas y TypeScript.
- Dos ejecuciones reales v33 dejaron el último estado así: Gemini 153 aceptadas,
  Kalshi 84 aceptadas y 1 cuarentena, Polymarket 69 aceptadas y 5 cuarentenas,
  Tavily/ideas gaming 0; todos `available`, circuitos cerrados y cero fallos.
  Los seis descartes fueron `RADAR_PROVIDER_FACT_REQUIRED` y no crearon
  borradores ni mercados.
- Las cinco huellas económicas finales coinciden exactamente con la línea base:
  15 mercados, 15 estados LMSR, 17 puntos históricos, 9 predicciones y 2
  perfiles; Karma total 2.932 y Prestigio total 40. No se confirmó, programó,
  publicó, predijo, resolvió ni liquidó ningún mercado.
- El informe completo está en `EXPERT_MARKET_CYCLE_CLOSURE_20260810.md`. Solo
  queda pendiente la subida manual del ZIP por Yol y, después, la comprobación
  real de GitHub Pages en escritorio/móvil y claro/oscuro.

### Corrección general de confirmación humana · 8 de agosto de 2026

- La fuente local fue `origin/main = c70f044823429c503f9a073eeab656fa8c77c808`.
  Los intentos reales de confirmación devolvían
  `MARKET_EXPERT_ANALYSIS_REQUIRED`: la puerta heredada exigía siempre una
  ejecución de `market_expert_runs`, aunque el Corrector hubiese creado un Plan
  manual determinista válido y auditado con `expert_run_id=null`.
- `private.market_source_binding_provenance(uuid)` admite dos procedencias
  generales y cerradas: ejecución experta completada y coherente, o Plan manual
  determinista con adaptador identificado, contrato y fuentes coincidentes,
  instrucciones de revisión humana y auditoría interna. No contiene excepciones
  por mercado, juego, pregunta ni versión concreta.
- `private.assert_market_source_publication_ready(uuid)` vuelve a comprobar
  validación, bloqueo, hash del contrato, monitor y procedencia antes de
  confirmar, programar o publicar. Un origen desconocido, una ejecución experta
  fallida, fuentes divergentes o un contrato alterado siguen bloqueados.
- La interfaz muestra el resultado junto a los botones de revisión,
  confirmación y publicación, enfoca el estado, impide dobles envíos y reconcilia
  con Supabase si se pierde la respuesta de red. El éxito solo habilita publicar
  cuando la confirmación persistida coincide con versión, huella y revisión
  efectiva.
- Los valores estructurados se convierten en texto seguro antes de escapar HTML;
  ya no pueden aparecer como `[object Object]`. La caché pública coordinada es
  `20260808-confirmation1` en los diez HTML.
- Las dos migraciones están aplicadas en producción. La matriz SQL confirmó ambos
  borradores y materializó una publicación dentro de una transacción con
  `ROLLBACK`; después ambos conservaron `review_approved`,
  `human_confirmed_at=null` y `market_id=null`. También pasaron los casos de
  ejecución experta válida, experta fallida y procedencia determinista sin
  auditoría.
- Validación local: 63 archivos JavaScript con sintaxis válida, 184 pruebas
  unitarias y TypeScript de Checkly. Yol sigue siendo la única persona que debe
  efectuar la confirmación real y la publicación.

### Cierre del Paso 13.5.2 · memoria autoritativa · 8 de agosto de 2026

- La base real inspeccionada fue `origin/main =
  3eb35bff241750158dec2aff54773c1ce2edb803`, en la rama
  `work/fix-draft-memory-review-state`. Supabase producción y no un ZIP o un
  resumen anterior fue la fuente de verdad.
- La causa exacta del incidente de GTA VI fue el round-trip del control
  `datetime-local`: la versión aprobada terminaba a
  `2026-08-31T23:59:59.000Z`, pero abrir y guardar desde el formulario truncó
  ambos campos al minuto `23:59:00.000Z`. El resto del payload editable era
  equivalente; el binding v2 y el antiguo MD5 aprobado permitieron demostrarlo.
- `sha256-canonical-v2` normaliza texto, JSON, instantes UTC a milisegundos y
  fuentes no semánticamente ordenadas. Las precedencias y roles del Plan de
  Resolución sí se conservan como semánticos. El frontend usa
  `step="0.001"`, mantiene la zona IANA y vuelve a leer Supabase después de
  guardar.
- `private.market_draft_versions` conserva snapshots materiales inmutables;
  `private.market_review_attempts` conserva cada intento técnico o de contenido;
  `private.market_effective_reviews` conserva por separado la aprobación
  aplicable; y `private.market_workflow_requests` hace recuperables los replay
  idempotentes. Una restauración crea otra versión enlazada, nunca reescribe el
  pasado.
- `save_market_draft` usa lock, `expected_version`, UUID y hash de petición. Un
  payload canónicamente idéntico devuelve `changed=false`, no incrementa versión
  y conserva revisión y confirmación. Radar, Observatorio, Agente Editor y
  Corrector delegan en la misma política.
- `validate-market-draft` está activa como versión interna 6, hash de bundle
  `1e6b75e9a5336746572d7c3eee48a884659250022ab46376898ffeb1abd8db1a`,
  `verify_jwt=true`. Usa `gemini-3.5-flash-lite`, JSON Schema, razonamiento
  mínimo y un único retry solo si la salida estructurada es inválida. Cuota,
  timeout, 5xx, red y autenticación quedan clasificados como intentos técnicos.
- `market-draft-fixer` está activa como versión interna 2, hash de bundle
  `4d393ac5a932c6e94376657b416bae6e6261d9ed722ce373cbf6f434717e8169`,
  `verify_jwt=true`. Rechaza incidentes de infraestructura y solo propone
  cambios mínimos ante errores reales de contenido; nunca confirma o publica.
- GTA VI quedó recuperado de forma auditada como versión 5,
  `review_approved`, SHA-256
  `a1829b275119a0dc4b862e4028172dcf26718d92b8eccccd07125ec407cf0663`,
  con revisión efectiva id 3 y Plan de Resolución v2 compatible. El último
  `invalid_response` de la antigua versión 4 se conserva aparte como intento
  técnico. `human_confirmed_at`, `scheduled_for`, `published_at` y `market_id`
  siguen nulos.
- Producción registra las migraciones `add_authoritative_draft_versions_and_review_attempts`,
  `fix_save_market_draft_actor_ambiguity`, `fix_market_text_normalization`,
  `fix_binding_source_alias_ambiguity` e
  `index_authoritative_draft_memory_foreign_keys`. No deben repetirse.
- Baseline protegida después de la recuperación: 11 mercados, 9 predicciones,
  2 perfiles, 2.027 Karma, 40 Prestigio, 1 borrador, 2 bindings, 0 snapshots de
  fuente y 0 expedientes de evidencia. Los schedulers de monitor y
  descubrimiento contextual permanecen desactivados.
- La matriz transaccional pasa 19 casos con rollback; la suite local pasa 164
  pruebas, sintaxis de 58 JavaScript, TypeScript de Checkly, bundle de las dos
  Edge Functions y mocks de JSON dividido, razonamiento, retry único, 429,
  timeout y 5xx. `docs/STATE_CONSISTENCY_AND_MEMORY.md` fija el contrato para
  futuras escrituras.
- La comprobación final del editor real cubre 1366×768, 1280×720, 1024×768,
  430×932, 390×844, 375×667 y 320×568, en tema claro y oscuro, sin scroll
  horizontal y con el control de tema operable por Enter y Espacio. Los códigos
  de auditoría largos, `fieldset` y controles temporales conservan anchura
  flexible en la pantalla estrecha.
- Yol debe ser la única persona que pulse primero `Confirmar humanamente` y,
  después, `Revalidar y publicar`. Esta entrega no ejecuta ninguna de esas dos
  acciones.

### Paso 13.5.2 · Observatorio y agentes · 7 de agosto de 2026

- Base local canónica: `origin/main = 56e6f58ccc7feaf7c71f30ac4da2387ccc5b893d`;
  rama `codex/paso-13-5-2`. El trabajo no se ha publicado ni desplegado.
- `Gestionar mercados` añade `Datos y tendencias` como tercera pestaña sin
  modificar el contrato del Radar v17. La caché, tablas y procedencias de ambos
  sistemas permanecen separadas.
- IGDB, Twitch y YouTube alimentan señales privadas. Las respuestas se
  normalizan sin inventar ceros, los errores se aíslan y los secretos solo se
  leen desde Edge Functions.
- `market-expert` es un núcleo editorial común para `radar_candidate`,
  `observatory_signal` y arcos contextuales. Usa la Constitución
  `atinara-market-constitution-v1`, el esquema `atinara-market-expert-v1` y el
  contrato de resolución `atinara-resolution-contract-v1`.
- El descubrimiento contextual limita y cachea Tavily, da prioridad a fuentes
  oficiales, puede devolver cero hipótesis y solo persiste contexto, arcos e
  hipótesis privadas. Nunca guarda un borrador por sí solo.
- `market-source-monitor` captura snapshots inmutables, construye expedientes y
  deja la decisión final a una administradora. Datos ausentes, errores o cambios
  de esquema no se traducen en Sí, No o cero.
- La migración `20260807163000_add_data_observatory_and_market_intelligence.sql`
  está preparada, no ejecutada. Los schedulers editorial y de resolución nacen
  desactivados, separados y pendientes de activación manual.
- Validación local: 57 JavaScript con sintaxis válida, 153 pruebas unitarias y
  tipado de Checkly superados. No se ha tocado Supabase, GitHub, producción,
  mercados, predicciones, Karma, Prestigio ni datos reales.

### Radar v17 · criterio predictivo profesional · 7 de agosto de 2026

- La política `atinara-prediction-policy-v3` separa validez de probabilidad: una
  fecha oficial prevista no invalida una opción de umbral futura. GTA VI antes
  de septiembre sigue siendo un contrato válido aunque la fecha anunciada sea
  posterior.
- Una pregunta directa de anuncio, lanzamiento, retraso o tráiler puede ser
  válida sin confirmación previa. Un premio o una reseña de un producto no
  anunciado continúa bloqueado; un juego anunciado, como Onimusha, puede ser
  candidato a GOTY antes de publicarse nominaciones.
- Resultados `yes`, `no` o `scalar` y estados finales del proveedor se descartan
  antes de Tavily/Gemini. Una reconciliación directa y acotada de Kalshi corrige
  descartes históricos, por ejemplo Halo resuelto como Sí, sin gastar IA.
- La política positiva solo corrige falsos `SUBJECT_NOT_ANNOUNCED`,
  `TEMPORAL_INCOHERENCE` o `EVENT_OUTSIDE_CONTRACT` en predicciones directas.
  Nunca pisa un resultado resuelto, una fuente inválida o una comprobación
  inconclusa.
- La auditoría usa español natural, filtra por motivo, oculta por defecto
  eventos resueltos y evaluaciones de la política anterior. Las candidatas v16
  no pueden prepararse hasta actualizar el Radar con v17.
- Las tarjetas de eventos con una sola opción ocupan toda la cuadrícula. Los
  controles `Detalles` y `Abrir evento original` comparten jerarquía con
  `Preparar`. La versión de caché coordinada es `v=20260807-radar3`.
- No hay migración nueva, secretos nuevos, datos simulados ni cambios en LMSR,
  mercados, predicciones, perfiles, Karma o Prestigio. No se ha desplegado ni
  subido nada desde esta tarea.
- Orden de activación obligatorio: desplegar primero `market-radar`; subir
  después el árbol completo a GitHub; finalmente pulsar `Actualizar fuentes`
  una vez y comprobar GTA VI, Half-Life 3, Onimusha y Halo. No ejecutar ninguna
  migración.
- Validación local: sintaxis JavaScript y TypeScript Edge correctas, suite
  completa `npm run validate` y renderizado real de escritorio/móvil sin
  desbordamiento horizontal.

### Paso 13.5.1 · corrección profesional del Radar · 6 de agosto de 2026

- Normalizador `atinara-radar-v2`: evento padre, mercado hijo, URL del evento,
  URL del mercado y fuente de resolución quedan separados y trazables.
- Polymarket valida `/events/slug/{event.slug}`, comprueba que cada hijo
  pertenece al evento y usa como enlace público `/event/{event.slug}`, sin
  prefijo de idioma ni slugs hijos convertidos en rutas inexistentes.
- Kalshi descubre la taxonomía real con `search/tags_by_categories`, obtiene
  hasta 25 series relevantes, pagina `/events` con mercados anidados y admite
  los estados públicos `open` y `active`. No consulta cuentas, órdenes ni
  posiciones.
- Tavily investiga por evento padre y Gemini solo clasifica con los datos y la
  evidencia recibidos. Si faltan secretos, el servicio falla o el análisis no
  concluye, la candidata permanece en revisión y no se puede preparar.
- La migración nueva `20260806183627_harden_market_radar_quality_sources.sql`
  añade estados factuales, motivos, caducidad, evidencia y agrupación. Invalida
  candidatas v1 no preparadas, pero conserva estados `prepared`, `dismissed` y
  sus borradores. No modifica LMSR ni la migración ya aplicada del Radar v1.
- La interfaz presenta una tarjeta por evento, tres opciones hijas prioritarias,
  detalle por opción y auditoría separada de rechazados. Una candidata caducada,
  rechazada o pendiente nunca habilita `Preparar`.
- Recursos coordinados como `v=20260806-radar2`. GitHub, GitHub Pages, Supabase,
  secretos y datos reales siguen sin cambios en esta entrega local.

### Corrección responsive móvil · 5 de agosto de 2026

- Las capturas reales de un teléfono de 360 CSS px mostraron tres columnas de
  tarjetas comprimidas, la cabecera descompuesta, textos ilegibles y scroll
  horizontal global.
- La causa era una regresión de especificidad: las reglas A3 de escritorio
  `body .topbar` y `body .market-grid` prevalecían sobre media queries móviles
  escritos como `.topbar` y `.market-grid`. La cabecera conservaba además las
  áreas de dos filas de escritorio mientras el botón móvil intentaba ocupar un
  área `toggle` inexistente.
- `v=20260805-mobile1` iguala la especificidad en los breakpoints, usa una
  cabecera móvil deliberada de dos filas, agrupa categorías y filtros sin
  carruseles horizontales y muestra una tarjeta completa por fila hasta 620 px.
  Las preguntas dejan de truncarse en móvil; precios y acciones siguen en dos
  columnas táctiles legibles.
- La comprobación real con Chromium superó 320, 360, 375, 390, 768, 1024 y
  1280 px en claro y oscuro. `scrollWidth` coincide con el viewport y no hay
  nodos fuera de límites; el catálogo usa respectivamente 1, 2 y 3 columnas.
- La cabecera y el panel móvil se comprobaron además en las diez páginas a 320,
  360, 375, 390 y 768 px: 50 combinaciones sin desbordamiento global. Las 91
  pruebas unitarias, la sintaxis de 37 JavaScript y el tipado estricto pasan.
- No cambió JavaScript funcional, SQL, migraciones, Edge Functions, Supabase,
  Radar, mercados, predicciones, perfiles, Karma, Prestigio ni datos reales. La
  corrección ya forma parte de la base canónica `b10f0eb`.

### Activación y corrección de Gemini en el Radar · 5 de agosto de 2026

- La migración local `20260804194933_add_market_radar.sql` fue la única alta
  nueva y Supabase la registra como `20260804213111 · add_market_radar`. La
  migración LMSR no se repitió.
- `market-radar` está activa como versión 4 con `verify_jwt=true`;
  `publish-scheduled-markets` permanece intacta como versión 2.
- La aceptación inicial confirmó actualización, caché, fallo parcial, detalle,
  descarte y pre-rellenado. Una cuenta ordinaria queda bloqueada con
  `ADMIN_REQUIRED`; no se guardó ni publicó ningún borrador.
- Gemini agotaba el timeout interno de 24 s porque `gemini-3-flash-preview`
  aplicaba su razonamiento predeterminado a un lote amplio. La corrección limita
  y compacta la entrada, reduce a 50 las definiciones de comparación, exige JSON,
  usa `thinkingLevel: minimal`, limita la salida a 8.192 tokens y concede 35 s.
- La prueba productiva posterior dejó los cuatro proveedores disponibles:
  Polymarket 22 candidatas, Kalshi 0, Ideas gaming 0 y Gemini 12 adaptaciones.
  La invocación terminó con HTTP 200 en 24,8 s y Gemini quedó sin error.
- La fotografía protegida posterior conserva 11 mercados, 9 predicciones,
  2 perfiles, 2.027 Karma, 40 Prestigio y 0 borradores. Las 45 candidatas, incluido
  el único descarte de aceptación, permanecen privadas.

### Corrección de incidencias SonarQube · 4 de agosto de 2026

- El análisis de `c7469c4` tenía Quality Gate verde, calificaciones A y cero bugs,
  vulnerabilidades y hotspots, pero conservaba 347 `CODE_SMELL` activos.
- La corrección local trata HTML semántico, contraste y duplicación CSS,
  complejidad y APIs de JavaScript/TypeScript y una excepción mínima para
  literales repetidos en migraciones aplicadas.
- Las diez páginas usan la versión coordinada `v=20260804-sonar1` para evitar
  mezclar recursos antiguos en GitHub Pages.
- Las causas y pautas preventivas están en `SONARQUBE_QUALITY_GUIDELINES.md`.
- Esta entrega no despliega Edge Functions ni modifica Supabase, Cron, Vault,
  autenticación, permisos, mercados, predicciones, comentarios, economía o datos
  reales. Queda pendiente de la subida manual de Yol y del nuevo análisis.
- El análisis posterior del commit público `8d8ffd91` redujo el total a 112,
  pero reveló una incidencia `javascript:S3403` en la trampa de foco de
  `auth.js` y mantuvo 111 incidencias `plsql:S1192`. La causa de estas últimas
  fue que el análisis automático ignoró la exclusión avanzada declarada en
  `.sonarcloud.properties`. La corrección final reescribe la comparación de
  foco y traslada ese único criterio a `Administration → General Settings →
  Analysis Scope → Ignore Issues on Multiple Criteria`, con la regla
  `plsql:S1192` y el patrón `supabase/migrations/**/*.sql`.

## 1. Objetivo del producto

Atinara es un MVP de red social competitiva de predicciones sobre videojuegos, estudios, lanzamientos, eventos, creadores e industria gaming. `Oraklo` dejó de ser la marca pública el 31 de julio de 2026 y se conserva únicamente en infraestructura, historial e identificadores técnicos existentes.

Conceptos centrales:

- **Karma:** saldo ficticio que se arriesga para participar. Se descuenta al confirmar una predicción.
- **Prestigio:** reputación histórica del predictor. Cambia cuando se resuelve el mercado y determina el rango.
- **Rangos:** Observador, Intérprete, Analista, Visionario y Oráculo.
- **Privacidad:** el saldo de Karma y las predicciones activas son privados. El perfil público solo muestra trayectoria y resultados ya liquidados.
- **Identidad:** anticipación, criterio y gaming premium, nunca casino. Sin dinero real, pagos, compra de Karma ni Modo Real.
- **Precio colectivo vivo:** en mercados binarios, `Sí` y `No` suman 100 % y se mueven únicamente por Karma realmente confirmado mediante un creador automático LMSR.
- **Contrato de beta:** una participación adquiere contratos al precio medio real, queda bloqueada hasta la resolución y no puede venderse, cambiarse o cerrarse anticipadamente. La negociación secundaria solo se reevaluará después de la beta y no está prometida.
- **Pago:** cada contrato nuevo acertado liquida a 1 Karma; el bonus de dificultad y el Prestigio se guardan por separado. El antiguo límite `×10` solo se conserva para predicciones confirmadas antes de activar el modelo vivo.

La usuaria quiere datos reales de Supabase, no cifras, usuarios, comentarios ni actividad simulados.

## 2. Repositorio y stack

- Repositorio público acordado: `marcilladiazyolanda-dotcom/Atinara`.
- URL gratuita acordada durante el desarrollo: `https://marcilladiazyolanda-dotcom.github.io/Atinara/`.
- Dominio propio: comprar y conectar `atinara.com` inmediatamente antes de abrir la beta cerrada, tras volver a comprobar su disponibilidad y precio.
- Frontend: HTML, CSS y JavaScript estático para GitHub Pages.
- Backend: Supabase Auth, Postgres, RLS, RPC y Edge Functions.
- Investigación de resoluciones: Tavily Search básico.
- Análisis de fuentes: `gemini-3-flash-preview`.
- Secretos ya manejados en Supabase: `GEMINI_API_KEY` y `TAVILY_API_KEY`; nunca registrar sus valores.

Convención de nombres:

- **Marca pública:** Atinara; en el logotipo puede escribirse `ATINARA`.
- **Nombre interno heredado:** Oraklo, permitido en nombres de archivos, variables, eventos, RPC, migraciones, Sentry, Checkly, historial y metadatos administrativos.
- **Contratos que no deben renombrarse:** `oraklo_admin`, funciones SQL `*_oraklo_*`, eventos `oraklo:*`, variables `window.oraklo*` y rutas públicas que continúen activas durante la transición.
- Ninguna interfaz, título, descripción, etiqueta accesible, correo o explicación pública debe presentar Oraklo como marca del producto.

Archivos principales:

- `index.html` / `script.js`: mercados y actividad pública.
- `market-detail.html` / `market-detail.js`: ficha, contador y predicción.
- `my-predictions.html` / `my-predictions.js`: predicciones activas y liquidadas del usuario.
- `ranking.html` / `ranking.js`: rangos y clasificaciones.
- `profile.html` / `profile.js`: currículum predictivo y personalización.
- `community.html` / `community.js`: feed cronológico global y de cuentas seguidas.
- `market-comments.js` / `social.js`: debates y utilidades sociales comunes.
- `admin-resolution.html` / `admin-resolution.js`: revisión humana de resoluciones.
- `admin-community.html` / `admin-community.js`: reportes y moderación social humana.
- `auth.js`: sesión, perfil global y menú desplegable de cuenta.
- `supabaseClient.js`: cliente, mapeos públicos y tiempo real de cierre.
- `supabase/functions/`: análisis y aprobación de resoluciones.
- `supabase/migrations/`: migraciones versionadas que sí están registradas en el repositorio.

## 3. Estado Git en el momento del relevo

Implementación local del Paso 13.5, 4 de agosto de 2026:

- Clon limpio: `C:\Users\34696\Documents\Atinara-13-5`.
- Base canónica: `origin/main = f2e4963e54c94a0a606f32ff95e11174dc69c1e3` (`CORREGIR SONARQUBE FIN`).
- Rama local: `codex/paso-13-5-radar`.
- El repositorio vacío `C:\Users\34696\Documents\ATINARA` no se utilizó.
- Polymarket, Kalshi, Supabase, GitHub y producción solo se inspeccionaron en lectura. No hubo `push`, despliegue, SQL remoto, mercados o predicciones de prueba.
- La prueba pública puntual confirmó 22 candidatas gaming normalizables en Polymarket. Kalshi expone las etiquetas `Entertainment / Video games` y series gaming reales, pero en la fotografía comprobada no tenía mercados abiertos para esas series; se conserva un estado vacío honesto.
- IGDB no se activa: no hay credenciales Twitch configuradas. Tavily y Gemini quedan condicionados a los secretos existentes de las Edge Functions y fallan de forma independiente.
- La activación manual y el contrato técnico están en `STEP_13_5_MARKET_RADAR_AND_CATALOG.md`.

Corrección visual final del Paso 13.4, 4 de agosto de 2026:

- Clon limpio de partida: `C:\Users\34696\Documents\Atinara-ui-fix`.
- Base remota inspeccionada: `origin/main = cf9d114eee7e2284d80de6bbdef7777b07547730`.
- Rama de trabajo: `codex/fix-ui-responsive`.
- La navegación usa una lista canónica, omite la ruta actual y solo incorpora destinos administrativos después de que la sesión autoritativa confirme `oraklo_admin`.
- La validación visual cubre los seis tamaños solicitados sin ocultar desbordamientos mediante `overflow-x`.
- El directorio vacío `C:\Users\34696\Documents\ATINARA` no se utilizó como base y no se descartó ningún trabajo existente.

Estado local del Paso 13.4, 3 de agosto de 2026:

- Clon canónico limpio de partida: `C:\Users\34696\Documents\Atinara-paso-13-4`.
- Base remota inspeccionada: `origin/main = 260495252c08667714a3dbfc03b24e4fbf853cfd`.
- Rama de trabajo local: `codex/paso-13-4-implementacion`.
- El directorio `C:\Users\34696\Documents\ATINARA` era un repositorio vacío sin commits ni remoto y no se utilizó como base.
- No se ejecutaron `pull`, `reset`, `rebase`, `push`, despliegues ni mutaciones externas. La publicación seguirá siendo manual mediante el ZIP completo validado.
- El checklist de entrega y activación es `STEP_13_4_IMPLEMENTATION_CHECKLIST.md`.

Estado productivo comprobado el 1 de agosto de 2026 desde un clon nuevo:

- Repositorio fuente de verdad: `marcilladiazyolanda-dotcom/Atinara`; rama pública `main` y URL canónica `https://marcilladiazyolanda-dotcom.github.io/Atinara/`.
- El frontend de activación del mercado vivo se publicó en `f7aac42` (`Implementa el mercado predictivo vivo de Atinara`).
- La migración `20260801172543_add_live_prediction_market_model.sql` ya fue aplicada una sola vez en producción. Supabase la registra como `20260801184105_add_live_prediction_market_model`; no debe repetirse por la diferencia de hora.
- La activación conservó 7 predicciones `legacy_fixed_v1`, 5 activas, sin alterar contratos ni saldos agregados. Después quedaron 11 mercados, 11 estados LMSR, 11 puntos iniciales y 0 predicciones `lmsr_v1`.
- La publicación inicial `f7aac42` sirvió `v=20260801-market1` y se conserva como evidencia histórica. `data.js` fue eliminado en `4ccd97e`; la limpieza completa se publicó en `a5c633b`, y GitHub Pages sirve `v=20260801-market2`. La URL pública de `data.js` devuelve 404.
- La aceptación pública de escritorio confirmó portada, Comunidad, ficha abierta y resuelta, clasificación y perfil con datos reales, cinco rangos, único punto honesto, cotización invitada y ausencia de compraventa. Las métricas ficticias `1.000 Karma`, `0 Prestigio` y `Observador` ya no son visibles para invitadas. No se creó ni modificó ninguna predicción.
- La aceptación móvil real cubrió 320 × 568, 375 × 667, 390 × 844 y 768 × 1024 sobre las seis superficies públicas. Producción mostró dos fallos: el mínimo raíz generaba scroll global a 320 px y las URLs largas de una resolución ensanchaban la ficha a 375/390 px. El árbol de cierre los corrige únicamente en `styles.css`; la repetición visual local supera todas las superficies a 320 y 375 px, mantiene la navegación táctil, la pregunta completa, `Sí` y `No`, gráfica, cinco rangos, cotización y foco visible.
- La nueva fotografía administrativa de solo lectura volvió a confirmar 11 mercados, 11 estados LMSR, 11 puntos iniciales, 7 predicciones `legacy_fixed_v1` —5 activas— y 0 `lmsr_v1`. Estados y puntos siguen en versión 0, probabilidades y `b = 2000` son válidos, las RPC nuevas existen, la firma antigua está ausente y las tablas internas y la resolución administrativa permanecen protegidas. No se alteró ningún dato.
- No hacer `reset`, `rebase`, `force push` ni mezclar el antiguo commit local `16c952d` con el historial creado por GitHub. Toda corrección parte expresamente de `origin/main = a5c633b` o de un clon limpio.

Las comprobaciones que siguen se conservan como trazabilidad histórica y no sustituyen el estado productivo anterior.

Comprobación directa realizada el 31 de julio de 2026 desde un clon nuevo del repositorio publicado:

- Repositorio fuente de verdad: `marcilladiazyolanda-dotcom/Atinara`.
- Rama publicada y local: `main`.
- `HEAD`, `origin/main` y el commit público coinciden exactamente en `f58a28a3f452dc4845d6caf65570826f68444137` (`Migra la marca pública a Atinara`).
- El historial anterior al renombrado se conserva y no se creó otro repositorio.
- El clon estaba limpio antes de preparar las correcciones de verificación descritas más abajo.
- No publicar una corrección sin volver a comprobar el diff, ejecutar la validación completa y conservar los identificadores técnicos heredados.

Commits funcionales de referencia:

- `c80836d`: rediseño y personalización del perfil.
- `cdd4045`: desplegable de cuenta completo y persistente.
- `22f86f9`: recordatorio de avatares gaming para el pulido final.

Observación realizada el 15 de julio de 2026:

- `origin/main` estaba en `bae5a70`.
- La subida remota más reciente solo había cambiado `index.html` a la versión de caché `account3`.
- La rama local contenía todavía cambios más nuevos que `origin/main` en `auth.js`, `styles.css`, el resto de HTML y documentación.

Este dato quedó obsoleto. No hacer `reset`, `checkout` destructivo ni asumir que una copia local antigua está actualizada; el repositorio publicado es la fuente de verdad.

Nueva comprobación realizada el 18 de julio de 2026:

- El `main` público de GitHub seguía en `f341f5f` (`CONTEXTO/AGENTE`).
- El árbol funcional que sirvió de base local coincidía con el árbol público, pero los historiales continuaban siendo distintos por las subidas manuales anteriores.
- El Paso 11 se implementó en una rama nueva para no reescribir, rebasar ni mezclar ese historial desincronizado.
- No hacer `reset`, `rebase` o `pull` destructivo ni asumir que el `origin/main` local representa el `main` público. Comparar árboles y commits antes de una futura sincronización.

Nueva comprobación realizada el 30 de julio de 2026:

- El `main` público de GitHub estaba en `deeb302` (`correcciones`).
- Los hashes remotos de `auth.js`, `styles.css`, los ocho HTML, `README.md` y este contexto coincidían exactamente con la rama local final del Paso 11.
- El Paso 11C se abrió en `codex/password-security-step-11c`, sin modificar el remoto ni los historiales desincronizados.

Comprobación posterior del 30 de julio de 2026:

- La usuaria publicó el Paso 11C y configuró en Supabase Auth doce caracteres y la combinación más fuerte.
- El nuevo `main` público quedó en `c18e04e` (`SEGURIDAD`) y se clonó limpio como base exacta del Paso 12.
- La rama local actual es `codex/quality-observability-step-12`.
- No se debe hacer `push`: la usuaria continúa publicando manualmente el ZIP completo.

Nueva comprobación realizada el 31 de julio de 2026:

- `origin/main` está en `9fa10ca` (`ajustes`) e incluye la corrección que conserva la subcarpeta de GitHub Pages en los recorridos de Checkly.
- La rama local previa y `origin/main` tenían commits distintos pero el mismo árbol; se abrió `codex/atinara-public-brand` directamente desde el remoto actualizado, sin `reset`, `rebase` ni pérdida de cambios.
- El cambio de marca pública usa la versión coordinada `20260731-brand1` y mantiene intactos los contratos internos heredados.
- No se debe hacer `push` ni cambiar el nombre del repositorio o la URL externa sin petición expresa de la usuaria.
- La usuaria autorizó el 31 de julio de 2026 renombrar el repositorio a `Atinara` y continuar gratis en GitHub Pages. La compra de `atinara.com` queda aplazada hasta justo antes de la beta cerrada.

Comprobación posterior al commit de marca `f58a28a`:

- GitHub Pages respondió correctamente en la URL canónica exacta `https://marcilladiazyolanda-dotcom.github.io/Atinara/`; los ocho HTML y sus recursos locales devolvieron HTTP 200 y cargaron `v=20260731-brand1`.
- La portada, Comunidad y una ficha de mercado cargaron datos reales de las RPC públicas sin modificar datos. La consola no mostró errores propios de Atinara ni recursos rotos.
- GitHub Actions completó correctamente calidad y Pages para `f58a28a`. El workflow de Checkly no se ejecutó porque solo admite `pull_request` y `workflow_dispatch`; fue omitido por configuración, no falló.
- SonarQube Cloud siguió enlazado al mismo repositorio renombrado y analizó `main` en `f58a28a`, pero el Quality Gate falló: Security C, Reliability C, cinco incidencias y cero hotspots. No reutilizar el resultado Security A anterior como estado actual.
- La función desplegada `analyze-market-resolution` seguía en la versión 9 con la ruta antigua y la marca pública anterior. El archivo local corregido usa la URL canónica y Atinara, pero aún debe publicarse y desplegarse de forma aislada.
- Checkly, Sentry y el frontend publicado conservaban referencias activas que no respetaban la mayúscula de `/Atinara/`. Se prepararon correcciones locales manteniendo los `logicalId` y nombres técnicos para actualizar los recursos existentes, no duplicarlos.
- La descripción pública del repositorio en GitHub aún presentaba Oraklo como marca y debe corregirse a Atinara.
- La validación local de las correcciones superó sintaxis, dieciocho pruebas unitarias, tipado de Checkly y `git diff --check`.

Comprobación posterior al cierre de las correcciones, realizada el 1 de agosto de 2026:

- `main` y `origin/main` coinciden en `135f759` (`Completa workflows de Atinara`). El único archivo local no versionado es el ZIP de trabajo de la usuaria y no debe modificarse ni incluirse accidentalmente.
- GitHub Pages continúa en la URL canónica exacta. SonarQube tiene Quality Gate aprobado y Security A; GitGuardian muestra una única fuente Atinara segura, monitorizada y con histórico completo; Checkly conserva los tres controles existentes y todos están en verde.
- Sentry recibió y resolvió un error controlado de Atinara en `production`, redactó identidad, URL y parámetros, y entregó correctamente una notificación de prueba por correo. La usuaria dio por cerrada la revisión de sus alertas el 1 de agosto de 2026; no debe volver a bloquear el Paso 13 ni ampliarse salvo nueva petición expresa.
- `analyze-market-resolution` se desplegó aisladamente como versión 10 activa y con verificación JWT. La lectura posterior confirmó la URL canónica, el título público «Ficha original y criterios del mercado en Atinara» y la ausencia de la ruta pública anterior. No se ejecutó SQL ni se modificaron datos.
- Supabase Auth ya usa la Site URL y la única redirección exacta de Atinara. El plan gratuito mantiene plantillas de correo predeterminadas sin personalización hasta configurar SMTP propio. El análisis administrativo de producción respondió sin modificar datos, pero reveló que un mercado que abarcaba todo julio tenía `closes_at` el día 28; no se aprobó ni liquidó. La identidad visual quedó aprobada después en 13.3; la comprobación pública del Open Graph A3 pertenece a la activación y QA del 13.4.
- La clasificación funcional del Paso 13.1 está documentada en `STEP_13_FUNCTIONAL_AUDIT.md`. El 13.2 fue aprobado con correcciones en `STEP_13_2_PRIORITIES_ACCEPTANCE.md`: P0, P1 y P2 son requisitos completos antes de la beta y no fases que puedan aplazarse tras abrirla.
- Ningún mercado podrá publicarse o programarse como público sin superar una revisión automática de claridad, coherencia y resolubilidad. La validación será autoritativa en Supabase, fallará de forma cerrada, explicará todos los motivos bloqueantes y no admitirá omisión administrativa. Cualquier cambio esencial invalidará el aprobado y exigirá una nueva revisión; después seguirá existiendo confirmación humana.

Preparación histórica autorizada el 1 de agosto de 2026:

- La base comprobada sigue siendo `main = origin/main = 135f759`; se conservaron los documentos locales de los pasos 13.1 y 13.2 y el ZIP previo de la usuaria no se modificó.
- Yol aprobó sustituir el porcentaje por recuento por un mercado vivo de Karma, con gráfica real, retorno base por contratos y bonus de dificultad separado. Aprobó también retirar el límite `×10` para posiciones nuevas y aplazar toda compraventa o especulación hasta después de la beta.
- Se preparó `20260801172543_add_live_prediction_market_model.sql` después de auditar el esquema vivo. Antes de activarla, la migración completa se probó dentro de una transacción real con cotización, participación, histórico y liquidación, y terminó con `ROLLBACK`; aquella prueba previa no cambió producción.
- El frontend local usa precios vivos, histórico real, Broadcast de Supabase con consulta periódica de respaldo, cotización versionada y estados honestos. Se eliminó `data.js` para impedir que un fallo de Supabase muestre mercados simulados.
- `LIVE_MARKET_ECONOMY.md` contiene el contrato económico y `STEP_13_3_LIVE_MARKET_PENPOT_OVERRIDES.md` las correcciones vinculantes que el segundo prompt debe aplicar sobre la Fase A neutral.
- Esta preparación quedó superada por la activación real del 1 de agosto de 2026 descrita al inicio de esta sección. No reutilizar su antigua frase de «pendiente» ni volver a ejecutar el SQL.

## 4. Funcionalidades terminadas y comprobadas

### Base real

- Supabase Auth operativo.
- Perfiles reales.
- Mercados reales y métricas públicas mediante RPC.
- Predicciones guardadas en Supabase.
- Cabecera actualizada con Karma, Prestigio, rango y username reales.

RPC públicas usadas, entre otras:

- `get_public_markets()`
- `get_public_market_by_id()`
- `get_public_leaderboard()` como compatibilidad
- `get_public_activity()`
- RPC nuevas de ranking y perfil indicadas más abajo.

### Confirmación de predicción y Karma

- El frontend solicita primero `get_prediction_quote(...)` y confirma mediante la nueva firma versionada de `place_prediction(...)`; nunca inserta directamente en `public.predictions`.
- Supabase comprueba sesión, mercado abierto, duplicado, saldo, mínimo, máximo personal, versión exacta y precio medio máximo aceptado.
- La confirmación adquiere contratos LMSR, mueve el precio, guarda un punto histórico, inserta la predicción y descuenta Karma en una sola transacción.
- Si otra participación mueve el mercado, devuelve `PRICE_MOVED`; el frontend actualiza el desglose y exige una nueva confirmación.
- Tras confirmar se actualizan cabecera, métricas, gráfica y posición privada y aparece un modal de éxito con el contrato guardado.
- Realtime transmite únicamente precio, versión y hora, sin identidad ni posición; una consulta cada 30 segundos recupera cambios si falla la conexión.
- Errores conocidos se traducen a mensajes amables y nunca se sustituyen por mercados de demostración.

Importante: la función viva anterior fue creada manualmente y se auditó antes de preparar la migración. La migración versionada sustituye su firma y conserva todas las predicciones existentes como `legacy_fixed_v1`. No debe aplicarse aislada del frontend nuevo.

### Tiempo y cierre de mercados

- La cuenta atrás usa `closes_at`, no una etiqueta estática.
- Cambia de días a horas, minutos y segundos y muestra fecha exacta.
- Al vencer, el mercado queda cerrado visualmente y se bloquean controles.
- Se distinguen mercado abierto, cerrado pendiente de resolución y resuelto.
- Decisión confirmada el 1 de agosto de 2026: si la pregunta fija un mes, una fecha o un límite anual, `closes_at` debe coincidir con el final exacto del periodo que abarca la pregunta. Para «durante julio», el cierre correcto es el final del 31 de julio.
- La administración cotidiana que se añadirá durante el Paso 13 debe permitir crear y editar mercados directamente desde una cuenta administradora en Atinara. El formulario pedirá la fecha límite que abarca la pregunta, derivará de ella `closes_at`, mostrará la zona horaria y bloqueará la publicación cuando pregunta, criterios y fecha sean incoherentes. La relación entre los campos temporales deberá validarse también en Supabase.
- Antes de publicar, el borrador deberá superar automáticamente controles deterministas y semánticos sobre ambigüedad, opciones, criterios, fechas, fuentes y posibilidad real de resolución. Si la revisión falla, no es concluyente o el servicio no está disponible, el mercado seguirá privado y Atinara mostrará el motivo concreto; una administradora podrá corregirlo y reenviarlo, pero no saltarse el rechazo.

### Resolución y liquidación

- Resolución atómica de mercados y predicciones.
- Acierto nuevo `lmsr_v1`: cada contrato abona 1 Karma, se añade el bonus de dificultad guardado y se actualiza Prestigio.
- Acierto anterior `legacy_fixed_v1`: conserva el cálculo y el límite `×10` vigentes cuando se confirmó.
- Fallo: no se devuelve el Karma arriesgado y se aplica el cambio de Prestigio sin bajar nunca de 0.
- Anulación: devolución íntegra y Prestigio sin cambios.
- Las posiciones nuevas no tienen un tope artificial `×10`; la economía se protege con liquidez, límites de participación, impacto de precio y simulaciones antes de beta.
- El historial muestra Karma recibido, balance, Prestigio y las condiciones reales de cada modelo sin reescribir contratos antiguos.

### Resolución asistida por IA

- `admin-resolution.html` es privado para administradora.
- `analyze-market-resolution` recopila fuentes con Tavily y las analiza con Gemini 3 Flash Preview.
- `approve-market-resolution` exige autenticación administrativa y confirmación humana.
- La IA nunca resuelve o reparte saldos automáticamente.
- Los mercados ambiguos por referencias como «último» o «próximo» se proponen como `Anulado` con explicación, no como error técnico.
- Si faltan pruebas para un mercado bien definido, devuelve `No concluyente`.
- Existe resolución manual protegida con fuentes HTTPS verificadas.
- Se probó correctamente el mercado de Marvel's Wolverine en State of Play: propuesta `Sí`, fuentes y resumen; después fue aprobado manualmente.
- Errores ya encontrados y resueltos: modelo Gemini 2.5 no disponible para usuarios nuevos, límites gratuitos y búsquedas sin fuentes. El modelo vigente en código es `gemini-3-flash-preview` con Tavily como investigación.

### Paso 9: rangos, ranking y temporadas

- Rangos reales según Prestigio:
  - Observador: 0–99.
  - Intérprete: 100–249.
  - Analista: 250–499.
  - Visionario: 500–999.
  - Oráculo: 1.000 o más.
- Clasificación global real y progreso de rango.
- Temporadas preparadas, pero desactivadas.
- Umbral inicial: 100 usuarios más activación administrativa explícita.
- Una futura temporada reinicia solo su clasificación, no el Prestigio histórico ni el rango.

Migración: `20260714145832_add_real_ranks_and_dormant_seasons.sql`.

### Paso 10 y 10B: perfiles predictivos

- Perfil público como currículum predictivo.
- Portada compacta con identidad, rango y cuatro métricas principales.
- Pestañas: Resumen, Historial y Logros.
- Especialidades por categoría y progreso al siguiente rango.
- Historial público únicamente de mercados liquidados.
- Anulaciones visibles, pero fuera de precisión, rachas y especialidades.
- Personalización: username, biografía, categoría favorita, avatar simbólico y tema.
- Menú flotante al pulsar el `@username`, sin abandonar la página:
  - Karma, Prestigio y rango.
  - Mi perfil y personalización.
  - Mercados, predicciones y clasificación.
  - Ayuda y privacidad internas.
  - Resolución solo para administradora.
  - Cierre de sesión.
- El menú se mantiene al hacer scroll, se recoloca bajo el botón y se cierra con `X`, fuera o `Esc`.
- Los recursos HTML usaban la versión de caché `20260715-account3` al cerrar el Paso 10; el Paso 11 coordina todos los recursos con `20260718-community1`.

Migraciones:

- `20260714210500_add_public_predictor_profiles.sql`
- `20260715020000_add_profile_customization.sql`

La personalización fue entregada para ejecutarse manualmente en Supabase. Al retomar, verificar que `get_public_predictor_customization` y `update_my_public_profile` existen o que guardar cambios funciona antes de asumir su estado vivo.

### Paso 11: MVP social y comunidad

Implementado, publicado y aceptado en `codex/community-mvp-step-11` el 18 de julio de 2026:

- Comentarios públicos en mercados abiertos, cerrados o resueltos.
- Respuestas limitadas a un solo nivel, texto plano de 1 a 500 caracteres, marca de spoiler, edición propia y borrado lógico propio.
- Seguimiento de perfiles con contadores públicos reales. La lista completa de cuentas seguidas y los silencios son privados.
- `community.html` con feed `Comunidad` y `Siguiendo`, ambos estrictamente cronológicos y sin algoritmo.
- El feed solo publica comentarios visibles y predicciones ya liquidadas; no devuelve Karma ni predicciones activas.
- Una reacción positiva, `Buena lectura`, para contenido de otras personas. No afecta Karma, Prestigio, rango o clasificación.
- Reportes privados de comentarios y perfiles, silencios personales y restricciones sociales temporales.
- `admin-community.html` para revisión humana: descartar, ocultar, restringir, ocultar y restringir, restaurar o levantar restricciones.
- Auditoría privada de todas las decisiones administrativas.
- Invitados con lectura pública; autenticación obligatoria para cualquier escritura social.
- Tablas con RLS y sin permisos directos para `anon` o `authenticated`; toda la superficie usa RPC con campos cerrados, permisos mínimos y comprobaciones de identidad en el servidor.
- Recursos HTML coordinados con versión de caché `20260718-community1`.

Migración:

- `20260718143106_add_social_community_mvp.sql`
- `20260718182915_expose_real_market_comment_counts.sql`

Estado en Supabase: **ambas migraciones aplicadas manualmente por la usuaria el 18 de julio de 2026, sin errores informados por SQL Editor**.

Aceptación real completada con invitada, `@SKINNY.TONI`, una cuenta normal temporal y la administradora: lectura pública, comentario, edición, spoiler, borrado, respuesta de un nivel, rechazo de anidación adicional, seguimiento privado, reacción, silencio, reporte, descarte administrativo y auditoría. La cuenta temporal y todos sus datos de prueba fueron eliminados al terminar; la cuenta y el comentario original de `@SKINNY.TONI` se conservaron.

Las pruebas técnicas aisladas cubrieron además ocultar/restaurar, restringir/levantar la restricción, acceso directo bloqueado a tablas, exclusión de predicciones activas y ausencia de Karma en el feed. La comprobación pública confirmó que el panel administrativo rechaza invitadas.

Después de la primera publicación se corrigió la colocación del debate en la ficha de mercado: en escritorio queda dentro de la columna principal, inmediatamente después de «Resolución», sin esperar a la altura del panel lateral de predicción; en móvil conserva el flujo vertical. La corrección usa la versión de caché `20260718-community2` en `market-detail.html`.

La aceptación detectó que la RPC histórica publicaba `comments_count = 0` aunque el trigger social mantenía el dato real. `20260718182915_expose_real_market_comment_counts.sql` sustituyó ese valor provisional por `markets.comments_count`. Se verificó en Supabase y en GitHub Pages que tabla, listado, detalle y pantalla devuelven el mismo contador real.

Los asesores de Supabase se ejecutaron después del despliegue. Los avisos informativos de tablas sociales con RLS sin políticas son intencionados: `anon` y `authenticated` no tienen permisos directos y toda la API usa RPC cerradas. Los avisos sobre RPC `security definer` también corresponden a la superficie pública/autenticada deliberada y las funciones sensibles comprueban identidad o administración internamente. Los índices sociales aún aparecen como no usados por falta de tráfico suficiente; no eliminarlos por ese aviso temprano. Queda como endurecimiento previo a una beta pública activar la protección de contraseñas filtradas de Supabase Auth.

### Paso 11C: protección gratuita de contraseñas

Implementado, publicado y validado el 30 de julio de 2026:

- El alta exige doce caracteres, minúscula, mayúscula, número y símbolo.
- La interfaz muestra cinco requisitos accesibles y los actualiza localmente mientras se escribe.
- `password-security.js` calcula SHA-1 mediante Web Crypto dentro del navegador.
- Al enviar el alta consulta Pwned Passwords por k-anonimato usando solo los primeros cinco caracteres del hash.
- La petición usa `Add-Padding: true`, `credentials: omit`, `referrerPolicy: no-referrer`, no tiene cuerpo y dispone de un límite de espera.
- La comprobación no se realiza carácter a carácter y nunca afecta al inicio de sesión.
- Las contraseñas filtradas se bloquean antes de llamar a `supabase.auth.signUp`.
- Si HIBP o Web Crypto no están disponibles, el alta falla de forma cerrada con un mensaje en español; no se crea una cuenta sin comprobar.
- Los errores comunes de Supabase Auth ya no se muestran como mensajes técnicos crudos.
- Todas las páginas cargan primero `password-security.js` y usan la versión de caché `20260730-password1`.
- No hay migración, SQL, Edge Function ni secreto.
- Supabase Auth exige ya doce caracteres y la combinación más fuerte de caracteres.
- GitHub Pages carga `password-security.js` y la versión coordinada `20260730-password1`.

Pruebas superadas: sintaxis, cinco tests unitarios, flujo DOM con HIBP simulado para segura/filtrada/caída, mantenimiento del inicio de sesión, integridad de recursos y comprobación de los once archivos públicos. La API real de Pwned Passwords respondió correctamente con CORS.

Checklist: `STEP_11C_PASSWORD_SECURITY_CHECKLIST.md`.

### Paso 12: calidad, secretos, disponibilidad y errores

La usuaria aprobó y completó el 30 de julio de 2026 la incorporación de cuatro herramientas gratuitas:

- **SonarQube Cloud:** activo sobre el repositorio público mediante su aplicación
  oficial de GitHub. `.sonarcloud.properties` separa pruebas, excluye solo
  dependencias/resultados generados y omite únicamente `plsql:S1192` en
  migraciones aplicadas, que siguen analizándose para el resto de reglas. El
  primer análisis de `main` en `c18e04e` encontró ocho vulnerabilidades bajas
  `Web:S5725`; se corrigieron fijando `@supabase/supabase-js@2.111.0`, su SRI
  SHA-384 y `crossorigin="anonymous"`. El análisis de `c7469c4` confirmó 0 bugs,
  vulnerabilidades y hotspots, pero dejó 347 code smells; su corrección está
  preparada localmente y documentada en `SONARQUBE_QUALITY_GUIDELINES.md`.
- **GitGuardian:** aplicación oficial de GitHub con lectura limitada al repositorio de Oraklo, escaneo histórico y vigilancia de commits nuevos. No se concederán permisos de escritura.
- **Checkly:** dos URL monitors —portada cada 10 minutos y Comunidad cada 30— y un recorrido Playwright público cada hora desde `eu-central-1`. El recorrido no inicia sesión ni modifica datos. El presupuesto previsto es de unas 720 ejecuciones mensuales de navegador.
- **Sentry:** errores JavaScript únicamente en producción, sin Replay, sin Performance, sin breadcrumbs y con `sendDefaultPii: false`. Antes del envío elimina `user`, `request`, extras y campos sensibles; además redacta correos, UUID, JWT, tokens y query strings.

Archivos principales añadidos:

- `.github/workflows/oraklo-quality.yml`
- `.github/workflows/checkly.yml`
- `.github/workflows/checkly-deploy.yml`
- `.sonarcloud.properties`
- `checkly.config.ts`
- `checks/oraklo-availability.check.ts`
- `checks/oraklo-public.spec.ts`
- `observability-config.js`
- `monitoring.js`
- `tests/monitoring.test.js`
- `STEP_12_TOOLING_CHECKLIST.md`

La configuración, activación externa y aceptación de las cuatro herramientas están terminadas. Checkly tiene desplegados y comprobados sus tres controles; Sentry recibió el error controlado sin datos reales; GitGuardian mantiene el repositorio en estado seguro; y SonarQube confirmó la corrección. Los nombres internos existentes de proyectos y monitores pueden conservar `oraklo` sin afectar a la marca pública.

Herramientas vinculadas a un momento concreto:

- **Penpot:** Paso 13.3 cerrado; los tableros A3, 13.3D y Atinara Sunset son la fuente visual de 13.4 y no requieren otra aprobación.
- **Mailjet:** SMTP y plantillas deben configurarse manualmente antes de afirmar que el correo real de recuperación está validado.
- **PostHog:** al comenzar la beta cerrada y solo después de preparar consentimiento, eventos mínimos y privacidad.

## 5. Migraciones y backend del repositorio

Orden actual:

1. `20260713184039_add_resolution_evidence_and_human_approval.sql`
2. `20260713184131_index_resolution_reviewer.sql`
3. `20260714145832_add_real_ranks_and_dormant_seasons.sql`
4. `20260714164629_repair_unsettled_market_status.sql`
5. `20260714210500_add_public_predictor_profiles.sql`
6. `20260715020000_add_profile_customization.sql`
7. `20260718143106_add_social_community_mvp.sql`
8. `20260718182915_expose_real_market_comment_counts.sql`
9. `20260801172543_add_live_prediction_market_model.sql` — aplicada una sola vez en producción el 1 de agosto de 2026; registrada remotamente como `20260801184105_add_live_prediction_market_model`. No repetir.
10. `20260803143000_add_market_administration_gate.sql` — aplicada una sola vez
    en producción el 3 de agosto de 2026. Añade borradores privados, revisión,
    confirmación humana, programación, auditoría, coherencia temporal y permisos
    mínimos. No repetir.
11. `20260809120000_harden_terminal_fact_gate_and_family_identity_v3.sql` —
    aplicada una sola vez y registrada remotamente como
    `20260808233502_harden_terminal_fact_gate_and_family_identity_v3`. Añade la
    primera puerta factual inmutable, separa preparados de rechazos vigentes y
    corrige las falsas duplicidades iniciales. No repetir.
12. `20260809133000_sync_prediction_policy_v4_guards.sql` — aplicada una sola
    vez y registrada remotamente como
    `20260808234810_sync_prediction_policy_v4_guards`. Sincroniza la preparación
    con la política v4 e invalida de forma cerrada toda aprobación
    `verified_open` heredada. No repetir.
13. `20260809140000_authoritative_radar_fact_gate_v1.sql` — aplicada
    materialmente una sola vez el 9 de agosto de 2026. Su manifiesto exacto de
    funciones, columnas, índices, restricciones, triggers y permisos fue
    comprobado antes de reconciliar el asiento remoto exacto
    `20260809140000_authoritative_radar_fact_gate_v1`. **No ejecutar este
    fichero otra vez**.
14. `20260809145000_reconcile_authoritative_radar_fact_gate_v2.sql` — aplicada
    y registrada remotamente como
    `20260809053000_reconcile_authoritative_radar_fact_gate_v2`. Verifica el
    manifiesto material de `140000`, repara de forma cerrada su historial e
    instala la atestación puntual para borradores Radar heredados. No repetir.
15. `20260809150000_complete_family_identity_v4_cutover.sql` — aplicada y
    registrada remotamente como
    `20260809053100_complete_family_identity_v4_cutover`. Completa el backfill
    familiar v4 y la paridad JS/SQL de fronteras temporales. No repetir.
16. `20260809160000_harden_market_review_policy_v3.sql` — aplicada y registrada
    remotamente como `20260809053248_harden_market_review_policy_v3`. Caduca
    aprobaciones automáticas incompatibles y alinea la memoria de revisión con
    la taxonomía v3. No repetir.
17. `20260809170000_require_registered_primary_source_checks_v1.sql` — aplicada
    y registrada remotamente como
    `20260809053353_require_registered_primary_source_checks_v1`. Exige una
    atestación vigente de fuente primaria y añade administración B2B auditada
    del registro, sin conceder escritura directa. No repetir.

No debe suponerse que toda función antigua del Supabase vivo está versionada aquí. Antes de escribir SQL nuevo, inspeccionar esquema, firmas, políticas, permisos y migraciones existentes.

**Historial remoto autoritativo:** las versiones locales `120000`, `133000`,
`145000`, `150000`, `160000` y `170000` tienen timestamps remotos distintos;
`140000` figura con su timestamp exacto después de la reconciliación. No ejecutar
un `db push` ciego ni intentar igualarlos reejecutando SQL: comparar primero el
mapeo 11–17, el estado material y `supabase_migrations.schema_migrations`. Toda
discrepancia debe abortar la operación; `140000` nunca debe reaplicarse.

## 6. Roadmap acordado

- Paso 9: rangos reales, clasificación y temporadas preparadas — terminado.
- Paso 10: perfil de usuario como currículum predictivo — terminado.
- Paso 10B: personalización y menú de cuenta — terminado; su esquema se verificó en Supabase aunque el historial remoto de migraciones no lo refleja de forma fiable.
- Paso 11: MVP social y comunidad — terminado, desplegado y aceptado con cuentas reales.
- Paso 11C: protección gratuita de contraseñas — terminado, publicado y validado.
- Paso 12: SonarQube Cloud, GitGuardian, Checkly y Sentry — terminado, publicado y validado.
- Cambio de marca pública: Atinara sustituye a Oraklo y está publicada en `main`; antes de cerrar su aceptación hay que completar los puntos manuales restantes de `STEP_PUBLIC_BRAND_ATINARA_CHECKLIST.md`.
- Paso 13: preparación de la beta cerrada — 13.1 cerrado, 13.2 aprobado y 13.4
  activado técnicamente; todavía falta la aceptación funcional final de Yol. El
  alcance vinculante está en `STEP_13_2_PRIORITIES_ACCEPTANCE.md`.

Orden acordado para el Paso 13:

1. **13.0 · Cierre documental:** terminado al corregir el estado real del Paso 12 y registrar Atinara como marca pública.
2. **13.1 · Auditoría funcional:** revisar recorridos completos de invitada, usuaria y administradora y clasificar cada punto como terminado, parcial, sin comprobar, ausente o aplazado.
3. **13.2 · Definición de soluciones:** terminado y aprobado. `P0`, `P1` y `P2` indican orden, pero todos deben completarse antes de la beta.
4. **13.3 · Diseño en Penpot:** cerrado y aprobado por Yol el 3 de agosto de 2026. A3 y Atinara Sunset son definitivos para beta v0.1.
5. **13.4 · Implementación:** backend administrativo, cuatro Edge Functions,
   Vault y Cron activados; frontend y sincronización de
   `publish-scheduled-markets` v2 subidos a `main`. Pendiente de aceptación
   funcional final de Yol; no declarar el paso cerrado todavía.
6. **13.5 / 13.5.2 · Radar y calidad editorial:** backend endurecido con
   `market-radar` v27, política predictiva v4, puerta factual v2 y familias v4;
   frontend y smoke administrativo pendientes para cerrar el hito. El catálogo
   ampliado de 24–36 mercados no forma parte de esta entrega.
7. **13.6 · Infraestructura de Beta y Crecimiento:** captación, atribución,
   onboarding, analítica, feedback, retención, referidos y Temporada Cero.
8. **13.7 · Productización B2B:** convertir Atinara Engine en infraestructura
   modular y licenciable para operadores, proveedores, agregadores, medios e
   instituciones después de validar la beta.

Este corte constituye una base técnica de Atinara Engine; no declara completada
la productización comercial B2B del Paso 13.7, que continúa después del Paso
13.6 y de validar Atinara Social.

El alcance aprobado incluye recuperación completa de contraseña; administración cotidiana de mercados desde Atinara; resolución asistida segura; datos honestos y contenido escapado; mercado de precios vivos y cotización autoritativa; accesibilidad, responsive, rendimiento y trazabilidad; y el sistema visual definitivo con emblemas y avatares propios. La creación y publicación debe asegurar que la pregunta, opciones, criterios, fuentes y periodo forman un mercado inequívoco y resoluble. Un borrador puede estar incompleto, pero Supabase debe impedir publicarlo hasta que supere la revisión automática sin omisión y la confirmación humana.

Durante 13.3 Yol autorizó activar primero el contrato económico vivo para que Penpot diseñara el comportamiento real y no la encuesta estática anterior. El diseño posterior quedó cerrado: la arquitectura 13.3A, la identidad A3, los activos 13.3C, las composiciones 13.3D y Atinara Sunset son la referencia definitiva de la beta v0.1.

### Hito 13.5.2 · Corrector Autónomo y familias de mercados (8 de agosto de 2026)

- Producción incorpora las migraciones `20260808180729_add_autonomous_repair_and_market_families_v2`, `20260808182940_strengthen_generic_market_family_derivation`, `20260808183415_enforce_exact_candidate_family_duplicates` y `20260808185135_deduplicate_market_family_matches`.
- `market-draft-fixer` v4 y `market-radar` v22 están activas con `verify_jwt=true`; no se redesplegó ninguna otra Edge Function.
- El Corrector Autónomo trabaja por arquetipos generalizables, limita sus rondas, degrada con seguridad ante fallos de proveedor, crea o sincroniza el Plan de Resolución y revalida el resultado sin confirmar ni publicar.
- Los borradores de aceptación de PS6 y del nuevo tráiler de GTA VI quedaron en versión 2, `review_approved`, con revisión aprobada, cero incidencias deterministas y Plan de Resolución v1. Ambos conservan `human_confirmed_at=null` y `market_id=null`.
- Radar separa `exact_duplicate` de `sibling`: una proposición exacta se bloquea incluso dentro del mismo lote; fechas, umbrales o contenidos distintos del mismo evento se conservan como hijos económicos independientes.
- Las familias atraviesan candidata, borrador y publicación. `get_public_market_family_catalog()` entrega metadatos públicos seguros y Explorar agrupa dos o más hijos bajo un encabezado sin probabilidad agregada ni mercado padre sintético.
- El mercado publicado de GTA VI fue enlazado a `atinara:v1:grand-theft-auto-vi:release_date`, hijo `deadline:2026-08-31`, sin alterar 50/50, participantes, Karma ni estado económico.
- Validación final: 62 archivos JavaScript, 178 pruebas unitarias, TypeScript, permisos, SQL transaccional con `ROLLBACK`, catálogo anónimo, invariantes económicas y asesores de Supabase sin errores.

### Corrección crítica Radar → publicación (8 de agosto de 2026)

- La causa real era una autocoincidencia: una candidata redescubierta podía compararse con su propia fila o con otra representación de la misma identidad `(provider, external_id)`, quedar guardada como `exact_duplicate` y recibir `DUPLICATE_MARKET`.
- La migración `20260808204159_fix_radar_prepare_identity_and_blocking_duplicates` está aplicada y registrada en producción. Elimina autocoincidencias, separa los arrays de duplicados bloqueantes y hermanas no bloqueantes, deduplica por identidad y endurece la reserva SQL con política, vigencia, campos resolubles y tiempo autoritativo.
- `market-radar` v23 está activa con `verify_jwt=true`. Preparar reutiliza una verificación factual vigente, vuelve a comprobar que el proveedor siga abierto, renueva la caché y relee la candidata autoritativa; Tavily y Gemini solo se repiten cuando la verificación no puede reutilizarse.
- La interfaz ya no intenta pulsar un botón obsoleto desde el puente del Agente Editor. Llama al preparador central, interpreta el JSON de error de la Edge Function y distingue solo `exact_duplicate` o `semantic_duplicate` bloqueantes.
- La candidata de Half-Life 3 que produjo el 409 original se probó de nuevo contra la Edge Function desplegada: preparación 200, `verified_open`, cero duplicados bloqueantes, prefill completo y paquete experto aplicable.
- Prueba real completa en producción: Radar → preparación 200 → Agente Editor sin caché ni degradación → propuesta `validated` → guardado atómico v1 con cero incidencias → revisión `approved` → confirmación → publicación. Se publicó el hijo `deadline:2026-11-30` de GTA VI.
- El catálogo público contiene dos hijos de `atinara:v1:grand-theft-auto-vi:release_date`: agosto y noviembre. Tienen claves de hijo distintas y ambos son visibles; una fecha no bloqueó a la otra.
- Estado final tras limpiar la cuenta técnica temporal: 15 mercados, 9 predicciones, 2 perfiles, 2027 Karma total y 40 Prestigio total. El único cambio económico fue el nuevo mercado solicitado; no se creó ninguna predicción ni se alteró Karma o Prestigio.
- Integridad Radar final: 229 candidatas, cero autocoincidencias, cero hermanas bloqueantes y cero elementos no bloqueantes dentro de `duplicate_matches`; los 54 duplicados reales siguen bloqueados.
- Validación final: 63 archivos JavaScript, 186 pruebas unitarias, TypeScript, `git diff --check`, publicación y confirmación idempotentes, RPC pública del mercado, JWT obligatorio y asesores de seguridad/rendimiento de Supabase sin avisos.

### Endurecimiento B2B del Corrector, puerta factual y familias v4 (9 de agosto de 2026)

- El corte local `120000 → 133000 → 140000 → 145000 → 150000 → 160000 →
  170000` está aplicado y registrado con el mapeo remoto fijado en la sección 5.
  La `140000` quedó materialmente completa antes de tener asiento de historial;
  `145000` verificó su manifiesto exacto y reconcilió ese asiento dentro de una
  migración cerrada. No volver a ejecutar ninguna de las siete.
- `market-radar` v26, `market-draft-fixer` v7,
  `validate-market-draft` v8 y `market-expert` v11 están activas y su contenido
  remoto coincide con el árbol local; todas conservan `verify_jwt=true`.
- Atinara Engine separa desde este hito tres conceptos que ningún proveedor o
  puntuación puede volver a fusionar: descubrimiento externo, estado factual y
  elegibilidad contractual. Que Polymarket o Kalshi mantengan un contrato
  abierto nunca acredita que el hecho del mundo siga sin resolver.
- El Radar conserva todos los hijos del evento canónico como contexto factual,
  aunque solo los hijos operables puedan ser candidatos. Una caché nunca se
  presenta como propuesta. Descubrimiento, preparación, confirmación,
  programación y materialización exigen una comprobación factual v2 vigente y
  ligada por huellas; ningún score ni dictamen Gemini puede acreditar por sí
  mismo que el hecho continúa abierto.
- Las conclusiones factuales usan contenido recuperado de una fuente registrada,
  hash, fecha y claim directo. Rumores, predicciones, votaciones, snippets o una
  página meramente relacionada degradan a revisión. Una afirmación terminal en
  una página oficial relevante domina una fecha futura, salvo que ambas estén
  vinculadas de forma explícita a plataformas realmente disjuntas.
- La identidad familiar v4 deriva por separado entidad, predicado, invariantes
  y eje del hijo. Un número incidental de los criterios no convierte una
  escalera de fechas en una familia de umbrales; distintos meses continúan como
  hermanos económicos independientes. Fronteras equivalentes ET, EDT y UTC
  comparten hijo; EST conserva su instante distinto; gaps, folds y abreviaturas
  ambiguas fallan de forma cerrada.
- El Corrector comparte una taxonomía cerrada de incidencias con el validador y
  registra una disposición explícita para cada código: reparar, investigar o
  escalar de forma segura. Repara todo lo deducible, investiga lo demostrable y
  emite un escalado específico cuando la información no basta; nunca transforma
  incertidumbre en una corrección inventada.
- Para métricas, el contrato conserva operador, umbral, fuente, plataforma,
  edición, agregación, ausencia de dato e instante de observación. Las anclas
  temporales usan la fecha autoritativa ya disponible, offset y zona; distingue
  observación de resolución, agrupaciones locales de millares y User Score de
  Metascore. Una ancla no demostrada nunca se inventa.
- La fuente primaria del Corrector debe pertenecer al registro B2B, admitir el
  rol y la categoría, responder mediante una cadena de redirecciones segura y
  demostrar en el cuerpo tanto identidad como predicado. El registro se gestiona
  mediante RPC administrativas auditadas, sin DML directo de `service_role`.
- El caso de aceptación de *Marvel Tokon: Fighting Souls* se reproduce como
  `metric_threshold`, Metascore de crítica `> 95`, máximo entre plataformas
  elegibles y observación el 13 de agosto de 2026 a las 10:00
  `America/New_York`, sin degradarlo a un mercado de lanzamiento. Su borrador
  heredado se puede enlazar mediante la atestación puntual de `145000` después
  de una revalidación fresca; el puente no confirma ni publica.
- El backfill v4 dejó los hijos mensuales de tráiler con una familia común y
  claves temporales distintas, clasificados como `sibling`; las filas ya
  preparadas se conservaron y dejaron de mezclarse con rechazos vigentes.
- La activación de v4 caducó las 22 opciones FC27 que conservaban una aprobación
  anterior y dejó cero candidatas `verified_open` reutilizables. Ya no se
  muestran como aptas. El siguiente ciclo administrativo recuperará la página
  oficial completa y persistirá el rechazo terminal; no puede volver a
  proponerlas por el simple estado abierto de Polymarket.
- Invariantes económicas posteriores: 15 mercados, 9 predicciones, 2 perfiles,
  2027 Karma total y 40 Prestigio total; también se conservaron los hashes de
  mercados, predicciones, maker state e histórico. La corrección no publicó,
  confirmó, predijo ni liquidó ningún mercado.
- Validación final local: sintaxis de 67 archivos JavaScript, 287 pruebas
  unitarias, TypeScript, configuración de monitorización y
  `git diff --check`. Las matrices SQL de las puertas se ejecutaron de forma
  controlada; la reconciliación final de `145000` abortó una primera vez antes
  de escribir, se corrigió contra el esquema real y después se aplicó completa.
- Queda pendiente únicamente el smoke visual autenticado del botón del
  Corrector y del siguiente ciclo explícito del Radar, porque no hubo una sesión
  gráfica administrativa controlable. El backend ya está activo y falla cerrado;
  no presentar ese recorrido de interfaz como ejecutado hasta completarlo.

### Corrección operativa del timeout del Radar (9 de agosto de 2026)

- La actualización explícita mostrada por Yol sí terminó el descubrimiento de
  Polymarket, Kalshi y el procesado de Gemini, pero la escritura autoritativa
  final devolvió `500` después de 54,528 s. Los logs PostgreSQL del mismo
  instante registraron `canceling statement due to statement timeout`; las
  llamadas REST ejecutadas por `authenticator` heredaban el límite de 8 s.
- La causa concreta estaba en la identidad familiar v4. El patrón de contexto
  aceptaba cualquier token `A/B` como posible zona horaria: en las 229
  candidatas reales aparecían 192 instancias de `and/or` y 10 de `X/S`. Cada
  falso token materializaba `pg_timezone_names`; la derivación completa tardaba
  unos 19,698 s y la puerta factual volvía a ejecutarla durante el enlace de su
  snapshot.
- `20260809180000_fix_radar_refresh_timeout.sql` limita el reconocimiento en
  texto a prefijos IANA canónicos, valida zonas explícitas con
  `timezone(text,timestamp)` y reutiliza la identidad familiar autoritativa en
  la segunda escritura cuando ninguna entrada contractual ha cambiado. No hace
  backfill ni contiene DML sobre mercados, predicciones, perfiles o economía.
- La misma migración añade
  `finalize_market_radar_provider_refresh_v1`, revocada para `anon` y
  `authenticated` y concedida solo a `service_role`. Producción la registra como
  `20260809114843 · fix_radar_refresh_timeout`; no debe volver a aplicarse.
- `market-radar` v27 está activa con `verify_jwt=true` y su bundle remoto
  coincide con los dos archivos locales. Persiste secuencialmente lotes de 24,
  mantiene cada lote y sus comprobaciones factuales atómicos, registra el total
  final exacto y degrada solo el proveedor que falle. La respuesta general
  continúa en `200 partial` con los lotes válidos en lugar de caer en
  `RADAR_FAILED`.
- La matriz transaccional nueva completa 160 derivaciones con los textos
  problemáticos bajo `statement_timeout=8s` y conserva `America/New_York`,
  `Europe/Madrid` y `ET`. En producción, las 229 derivaciones pasaron de
  19,698 s a 3,337 s. La validación local completa pasa sintaxis de 68 archivos,
  292 pruebas unitarias, TypeScript y `git diff --check`.
- Antes y después del corte siguen idénticos tanto los recuentos como las
  huellas de 15 mercados, 9 predicciones, 2 perfiles, 15 estados LMSR y 17
  puntos de histórico. También permanecen 2.027 Karma y 40 Prestigio; la
  corrección no confirmó, publicó, predijo, resolvió ni liquidó nada. El Radar
  conserva 229 candidatas y cero comprobaciones factuales vigentes hasta que
  Yol repita la actualización explícita.
- Siguiente prueba exacta: recargar `admin-markets.html` con `Ctrl+F5`, esperar
  a que termine el cooldown si aparece y pulsar una sola vez `Actualizar
  fuentes`. Debe desaparecer el aviso general de carga, los proveedores deben
  mostrar una hora nueva y el Radar debe devolver eventos o errores parciales
  por proveedor. No preparar, confirmar ni publicar todavía.

### Ciclo experto resistente Radar → Editor → Corrector (9 de agosto de 2026)

- La incidencia posterior no era otro timeout. Polymarket perdía su primer lote
  y Kalshi conservaba exactamente 72 filas porque un registro incompatible
  hacía rollback de un lote atómico de 24 y el cliente descartaba la regla SQL.
  Radar v28 biseca únicamente errores de datos hasta aislar una fila, conserva
  las sanas y difiere el resto al agotar un presupuesto real de 64 RPC o 20 s;
  errores de infraestructura, timeout o concurrencia nunca se cuarentenan como
  si fueran datos malos.
- Gemini respeta `Retry-After`, backoff exponencial y jitter. El primer `429`
  abre un circuito que impide programar más lotes, conserva las decisiones ya
  válidas y registra el recuento real como `partial_error` o `unavailable`.
  Todo final de Polymarket, Kalshi, Tavily o Gemini deja además historia
  append-only; el snapshot operativo continúa separado.
- Analizar con el Agente Editor ya no prepara ni revalida Radar. Un expediente
  factual bloqueado sigue siendo legible y devuelve un dictamen tipado; la
  preparación se ejecuta únicamente después de que un paquete vigente permita
  `can_prefill` y `can_save_private_draft`. Un intento factual negativo se
  audita con UUID propia sin sustituir `current_fact_check_id` ni incrementar la
  revisión autoritativa.
- El Corrector v8 nunca usa incidencias semánticas v2 para reparar un borrador
  v3. Primero obtiene una revisión compatible de la versión y huella exactas;
  después investiga por claims pendientes. Reconoce anclas EN/ES/PT completas o
  abreviadas e ISO, exige identidad suficiente, conserva `>95` como umbral
  válido de Metascore, limpia el sujeto editorial y obliga a que el deadline de
  resolución sea estrictamente posterior a la evaluación.
- Producción tiene aplicada `harden_expert_market_cycle_v1` y activas, siempre
  con `verify_jwt=true`, `market-radar` v28, `market-expert` v12,
  `market-draft-fixer` v8 y `validate-market-draft` v9. La candidata Kalshi de
  la captura vuelve a ser legible con `can_analyze=true` y dictamen ausente como
  `null`, no como `{}` ni como 503. El borrador Marvel conserva el review v2
  solo como historia y expone como incidencia determinista vigente
  `RESOLUTION_DEADLINE_INVALID`.
- La validación local completa pasa sintaxis de 70 archivos, 303 pruebas y
  TypeScript. La migración se parseó en 35 sentencias y el finalizador/historial
  append-only se probó dentro de una transacción revertida. Tras el despliegue
  permanecen idénticos recuentos, agregados y SHA-256 de 15 mercados, 9
  predicciones, 2 perfiles, 15 estados LMSR y 17 puntos de histórico; siguen
  siendo 2.027 Karma y 40 Prestigio.
- No se creó, confirmó, programó, publicó, predijo, resolvió ni liquidó ningún
  mercado durante esta corrección. El último smoke visual autenticado requiere
  que Yol suba el frontend incremental y use su sesión administrativa; no debe
  falsearse como ejecutado desde una sesión inexistente. La publicación real
  continúa exigiendo revisión v3 efectiva y confirmación humana.

### Endurecimiento productivo del Radar y recuperación factual (11 de agosto de 2026)

- La intervención parte de `origin/main = 7dcf97e1ab1a74c2d6732d74e4df5eec7e361928`
  en el worktree aislado `ATINARA-radar-hardening-20260811`; el repositorio de
  Yol y sus cambios previos no se mezclaron ni descartaron.
- El estado falso `Con incidencia` tenía tres causas distintas: los descartes
  editoriales se sumaban al estado operativo del proveedor; el snapshot en
  cooldown podía sustituir la última cobertura autoritativa por una lista vacía;
  y los cierres normales de Polymarket/Kalshi se enviaban a cuarentena porque el
  clasificador pedía `PROVIDER_NOT_OPEN` con `fact_status=unresolved`, pero la
  aplicación final lo convertía de nuevo en `unknown`. Radar v44 conserva el
  último resultado válido, separa descartes, cuarentenas y fallos técnicos y
  persiste el cierre canónico como rechazo no abierto con evidencia del
  proveedor, sin degradar toda la fuente.
- La interfaz actualizada mantiene un único refresh en vuelo, desactiva acciones
  incompatibles y recalcula el cooldown cada 500 ms hasta rehabilitar el botón.
  Las tarjetas distinguen `Disponible`, `Disponible con descartes`, degradación
  temporal y error técnico. Todas las opciones de un evento pueden desplegarse
  o contraerse; las preguntas se normalizan a una estructura española común y
  cada fila muestra la probabilidad exacta de su contrato de origen. La
  extracción de strikes de Kalshi conserva cada umbral y URL propios, por lo que
  ya no puede repetir dos veces la misma opción de Big Walk ni enlazarlas al
  mismo contrato.
- La defensa contra duplicados se ejecuta también en la RPC de lectura, dentro
  del mismo snapshot: una identidad exacta ocupada por `public.markets` o por un
  borrador no cancelado desaparece del Radar aunque exista una carrera posterior
  a la clasificación. El smoke productivo terminó con cero solapamientos exactos
  con mercados y cero con borradores activos.
- El cierre factual ya no depende del estado abierto del proveedor ni de Gemini.
  La investigación oficial acotada recorre fuentes primarias, extrae contenido
  estructurado/hidratado y admite una prueba oficial de fecha futura como
  apertura verificable, pero una evidencia terminal siempre prevalece. Para el
  evento Polymarket `499343`, 23 hijos vigentes de FC27 quedaron
  `rejected_resolved`, `fully_resolved` y `EVENT_ALREADY_RESOLVED`; ninguno es
  visible. Las pruebas oficiales conservadas proceden de EA News y de las páginas
  oficiales de ediciones/fechas de EA SPORTS FC 27. No existe ningún hardcode por
  FC27, Marvel, título, proveedor o fecha.
- La recuperación factual del Editor acepta ahora candidatas `needs_review`,
  conserva el expediente anterior en fallos técnicos y devuelve errores de
  dominio tipados. La candidata Marvel Metascore `> 85` se revalidó con la fuente
  oficial de PlayStation, quedó `unresolved + verified_open` en el fact check
  `3285` y produjo una propuesta aplicable sin confirmarla. El borrador privado
  Marvel `> 95` permanece en versión 9, `review_approved`, con revisión efectiva
  compatible y sin confirmación, programación, `market_id` ni publicación.
- Producción registra las migraciones nuevas como
  `20260811130002 · harden_radar_visibility_and_presentation_v5` y
  `20260811133945 · allow_needs_review_radar_revalidation_v6`; corresponden a
  los archivos locales `20260811123656_...v5.sql` y
  `20260811155800_...v6.sql` y no deben repetirse. `market-radar` v44 está
  `ACTIVE`, `verify_jwt=true`, SHA-256 de bundle
  `8dccc9d0aae497fd219782739ea961e12c03d01b4dec8ed6adc1bc8f2ef48583`;
  `market-expert` v18 está `ACTIVE`, `verify_jwt=true`, SHA-256
  `06d551105b5d0c33127f96fd7c875d0c934a4d3005de614fe8d743fa8a5f4f50`.
- El refresh final real dejó Polymarket `available` con 48 procesadas, Kalshi
  `available` con 71, Gemini `available` con 112 e Ideas gaming/Tavily
  `available` con 0; los cuatro registraron cero descartes técnicos, cero
  cuarentenas y cero fallos. Dos muestras cerradas de Polymarket y Kalshi se
  persistieron como `PROVIDER_NOT_OPEN`, `fact_status=unresolved` y evidencia
  canónica del proveedor. Desde el comienzo de v44 no existe ninguna cuarentena.
- La validación local final pasa 337 pruebas, sintaxis JavaScript, TypeScript y
  `git diff --check`. Tras el último refresh siguen exactamente: 15 mercados
  (`Abierto=4`, `Resuelto=11`), 9 predicciones (`Anulada=7`, `Acertada=2`), 2
  perfiles, 2.932 Karma, 40 Prestigio, 15 estados LMSR y 17 puntos de histórico.
  SHA-256: mercados
  `70d93479e2efe650e3623be40e9aee688216abdbe9866dd5f2a02f67da3ee137`,
  predicciones
  `170372fee7b857c67a51f2c3b33f9675f5b0b406c6040625520d2d6df2a3059c`,
  perfiles
  `8492fdfc993bc473e6a2d9f00924dc8b39b8650f196f86dcf049ed50a179f6bc`,
  LMSR `b3d1a0a27e6a7a754576057aba35c317c1b651388fe67ffceb13784472a0c927`
  e histórico
  `8eb3d854e5ff20eb7ccad96efcbabd4d7545e17ffa457e74630d6f2f2e0f7adf`.
- GitHub Pages todavía sirve el frontend anterior
  `v=20260811-expert-cycle3`: el smoke autenticado confirmó el backend nuevo,
  pero el contador vivo, el despliegue completo de opciones y la redacción nueva
  solo serán públicos cuando Yol suba el ZIP incremental de esta intervención.
  No declarar esa UX publicada hasta repetir el smoke sobre el recurso servido.
  Ninguna acción de esta intervención confirmó, programó, publicó, predijo,
  resolvió o liquidó un mercado.

Nota histórica del corte v5/v6: aquel ZIP ya fue subido y su smoke se completó.
El siguiente paso vigente está descrito al comienzo de este documento para el
corte v8–v11; las migraciones antiguas no deben repetirse. Confirmar o publicar
seguirá siendo una decisión humana separada. El mercado antiguo de julio
continúa sin aprobar ni liquidar. No ampliar todavía
el catálogo, chat, GIF, feed algorítmico,
temporadas, monetización, dinero real ni compraventa secundaria.

Backlog social que la usuaria quiere retomar después del MVP para dar más contenido a la plataforma:

- Mensajes directos o chat.
- Notificaciones por email o push.
- Menciones, hashtags y tendencias.
- Imágenes, vídeo, GIF y archivos adjuntos.
- Grupos o comunidades privadas.
- Feed algorítmico.
- Cuentas privadas y solicitudes de seguimiento.
- Hilos con más de un nivel.
- Varias reacciones, votos negativos o dislikes.
- Recompensas sociales de Karma o Prestigio.
- Moderación o sanciones automatizadas con IA.

Este backlog está recordado, pero no debe implementarse sin definir y aprobar cada ampliación. Las restricciones actuales de privacidad, datos reales, revisión humana y ausencia de dinero real siguen vigentes.

## 7. Restricciones vigentes

No implementar sin autorización expresa:

- Dinero real, pagos, compra de Karma o Modo Real.
- Venta de posiciones, salida anticipada, cambio de lado, cobertura, órdenes límite, libro de órdenes o mercado secundario durante la beta.
- Resolución autónoma por IA.
- Arranque de temporadas durante el desarrollo.
- Datos simulados para rellenar pantallas.
- Fluctuaciones, históricos o actividad simulados para que un mercado parezca vivo.
- Exposición pública de predicciones activas o saldo de Karma.
- Paneles o permisos administrativos inseguros.
- Publicar o programar un mercado que no tenga una validación automática vigente de claridad, coherencia y resolubilidad, o permitir que una administradora omita un rechazo.
- Cambios grandes fuera del paso pedido.

## 8. Flujo de colaboración preferido por la usuaria

- Continuar el desarrollo principal en un único chat/agente con todo el contexto.
- Definir bien cada paso y después implementarlo de principio a fin.
- Inspeccionar, editar, probar, revisar diff, crear commit y entregar ZIP completo.
- La usuaria ejecuta normalmente el SQL o guarda secretos en Supabase y sube los archivos a GitHub manualmente.
- Dar instrucciones muy concretas: qué archivo abrir, qué copiar, dónde pulsar y cómo comprobar el resultado.
- Si la usuaria pide diagnóstico antes de cambiar, explicar primero la causa y esperar su decisión.
- No mostrar errores técnicos crudos a usuarios finales.

## 9. Problemas ya aprendidos

- GitHub Pages puede mantener HTML hasta unos minutos y mezclar UI antigua con recursos nuevos. Versionar CSS/JS y comprobar el contenido público real.
- Una subida manual puede actualizar solo parte de los archivos. Comparar siempre `origin/main` con la rama local y verificar todos los HTML, `auth.js` y `styles.css`.
- No elegir modelos de IA solo porque aparecen en AI Studio: confirmar disponibilidad API y manejar 404/429 de forma comprensible.
- Tavily puede no encontrar fuentes. Mercado ambiguo y búsqueda insuficiente son estados de producto, no necesariamente fallos técnicos.
- No fiarse de etiquetas estáticas de cierre cuando existe `closes_at`.
- No usar `closes_at` como límite de investigación sin comprobar antes que coincide con el periodo temporal expresado por la pregunta y los criterios. La auditoría del 1 de agosto detectó un mercado que abarcaba todo julio pero cerraba el día 28; no se aprobó su propuesta de resolución.
- No confundir precio con porcentaje de personas: desde el modelo vivo el precio depende del Karma y del impacto LMSR; participantes y precio son métricas distintas.
- No desplegar por separado la nueva firma SQL y el frontend que la consume. Seguir la activación coordinada y minimizar la ventana entre ambos.
- No describir la beta como un clon económico exacto de Polymarket o Kalshi: comparte el pago por contrato, pero usa LMSR sin libro de órdenes ni venta.
- No reescribir migraciones aplicadas para reducir avisos de mantenibilidad de
  Sonar. Mantenerlas analizadas y usar únicamente excepciones por regla y ruta,
  según `SONARQUBE_QUALITY_GUIDELINES.md`.

## 10. Requisitos visuales previos a beta

- El sistema visual fue aprobado por Yol el 3 de agosto de 2026: A3, Atinara Sunset, tokens, componentes, estados, escritorio y móvil.
- Usar patrones familiares de exploración y acción de Polymarket y Kalshi como referencia de claridad, nunca como plantilla visual. La interfaz será premium y sofisticada, con identidad, retícula, componentes y activos propios de Atinara.
- Diseñar la gráfica real de `Sí` y `No`, los rangos temporales, el precio actual, impacto, precio medio, contratos, retorno base, bonus y Prestigio, incluidos carga, único punto, recotización, error y mercado congelado.
- No diseñar botones o recorridos de venta, salida, cambio de posición o especulación para la beta.
- Las mejoras futuras de emblemas y avatares no reabren 13.3 ni bloquean beta v0.1; cualquier ampliación debe conservar A3 y propiedad intelectual original.
- Mantener el tono de anticipación y criterio y evitar estética de casino.
- Implementar y aceptar visualmente el sistema aprobado antes de abrir la beta. P2 no es un pulido posterior al lanzamiento, aunque mejoras ópticas no bloqueantes puedan planificarse después.

## 11. Comprobación mínima antes de entregar cambios

- `node --check` en cada JavaScript modificado.
- `node --test tests/password-security.test.js` cuando se modifique el control de contraseñas.
- `npm run validate` cuando exista `package.json`; incluye sintaxis, todas las pruebas unitarias y tipado de Checkly.
- `git diff --check`.
- Ejecutar `tests/sonarqube-quality.test.js` como parte de `npm run validate`
  cuando cambien HTML, CSS, lógica administrativa o configuración de Sonar.
- Comprobar que todos los recursos locales existen y comparten una versión de caché coherente.
- Probar sesión invitada y autenticada cuando afecte a Auth/cabecera.
- Probar permisos normales y administrativos cuando afecte a resolución.
- Para futuras regresiones del Paso 11, reutilizar `STEP_11_ACCEPTANCE_CHECKLIST.md` con invitada, dos cuentas normales y administradora.
- Confirmar que el feed no devuelve Karma ni predicciones activas y que las listas completas de seguimiento y silencio siguen privadas.
- Confirmar privacidad y que no aparecen secretos.
- Confirmar compatibilidad con GitHub Pages.
- Crear commit claro y ZIP completo validado si la usuaria va a subirlo manualmente.

## 12. Cómo comenzar el nuevo chat

El primer mensaje recomendado está en la sección final de la respuesta que creó este documento. El nuevo agente debe leer primero estos archivos, inspeccionar Git y resumir el estado antes de editar.
