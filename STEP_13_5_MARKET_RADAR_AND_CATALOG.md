# Paso 13.5 · Radar de mercados y pre-rellenado administrativo

Fecha de preparación: 4 de agosto de 2026. Activación y corrección operativa: 5 de agosto de 2026.

Estado: **activado y aceptado técnicamente**. El catálogo ampliado de 24–36 mercados no se implementa en esta entrega. El Radar permanece privado y no creó borradores ni modificó datos públicos durante la aceptación.

> **Nota de continuidad:** este documento conserva la activación original del
> Radar como registro histórico. El estado vigente es `market-radar` v26 con
> política predictiva v4, puerta factual v2 y familia v4, documentado en
> `ORAKLO_PROJECT_CONTEXT.md` y
> `STEP_13_5_2_DATA_OBSERVATORY_AND_AGENTS.md`. Ningún orden de despliegue de
> este documento debe repetirse.

## 1. Alcance y garantías

- `Gestionar mercados` conserva el flujo `Crear manualmente` y añade `Radar de mercados` dentro de la misma superficie administrativa.
- El Radar descubre candidatas, las normaliza, filtra, puntúa y compara. `Preparar borrador` solo pre-rellena el formulario existente.
- Una candidata nunca queda guardada, revisada, aprobada, confirmada, programada o publicada por pulsar `Preparar borrador`.
- El guardado humano continúa usando `save_market_draft`; cuando existe procedencia del Radar, `save_market_draft_from_radar` llama al mismo contrato y añade trazabilidad privada de forma atómica.
- La revisión determinista, la revisión semántica, la confirmación humana y la publicación autoritativa del Paso 13.4 permanecen sin cambios.
- Probabilidad, volumen, liquidez e interés abierto externos son referencia administrativa. Nunca modifican `market_lmsr_state`, precios, Karma, Prestigio, contratos, participantes o histórico de Atinara.

## 2. Proveedores

| Proveedor | Obligatorio | Autenticación externa | Datos usados | Caché | Estado local |
|---|---:|---|---|---:|---|
| Polymarket Gamma | Sí | Ninguna | eventos/mercados activos, outcomes, precio Sí, fechas, reglas, fuente, volumen y liquidez | 20 min | Implementado; comprobación pública: 3 eventos y 22 candidatas gaming normalizables |
| Kalshi Market Data | Sí | Ninguna | series `Entertainment / Video games`, mercados abiertos, reglas, bid/ask o último precio, fechas, volumen, liquidez e interés abierto | 20 min | Implementado; series gaming reales encontradas, pero 0 mercados abiertos en la fotografía comprobada |
| Tavily | Controlado | `TAVILY_API_KEY` solo en Edge Functions | hasta 6 fuentes públicas por consulta gaming | 12 h | Implementado con degradación `no configurado` |
| Gemini | Controlado | `GEMINI_API_KEY` solo en Edge Functions | lote máximo de 12 candidatas externas ya filtradas | usa la caché del candidato | Activo; 12 adaptaciones en la aceptación posterior a la corrección de latencia |
| IGDB | No, futuro | Requeriría `TWITCH_CLIENT_ID` y `TWITCH_CLIENT_SECRET` | metadatos gaming estables | prolongada, futura | No activado: no había credenciales configuradas y no se añadió una interfaz rota |

La ausencia de un mercado abierto en una fuente produce un estado vacío honesto. No autoriza a inventar candidatas.

## 3. Endpoints y consumo por actualización manual

Endpoints públicos:

- Polymarket: `GET https://gamma-api.polymarket.com/public-search` con `q`, `events_status=active`, `limit_per_type=60`, `page=1`, `keep_closed_markets=0` y perfiles desactivados.
- Kalshi: `GET https://external-api.kalshi.com/trade-api/v2/series?category=Entertainment&tags=Video games&include_volume=true`.
- Kalshi: hasta cuatro `GET /trade-api/v2/markets?status=open&series_ticker=…&mve_filter=exclude&limit=100`.
- Tavily opcional: un `POST https://api.tavily.com/search`, profundidad básica y máximo de seis resultados.
- Gemini opcional: un `POST` por lote a `gemini-3-flash-preview:generateContent`, máximo doce candidatas.

Coste máximo estimado de una actualización completa: 1 GET de Polymarket + 1 GET de series Kalshi + hasta 4 GET de mercados Kalshi + 1 búsqueda Tavily + 1 adaptación Gemini. Cambiar orden o filtros locales no consume Tavily ni Gemini. El doble clic queda bloqueado y existe un cooldown de 60 segundos.

No se utilizan Polymarket Data API, CLOB, perfiles, posiciones, trades, holders, comentarios o wallets; tampoco órdenes, cartera o cuentas de Kalshi. Esos endpoints se descartaron porque el Radar solo necesita definición pública de mercados y usarlos ampliaría datos, riesgo y semántica financiera sin aportar al pre-rellenado.

## 4. Modelo normalizado

`supabase/functions/_shared/market-radar.mjs` valida y normaliza:

`provider`, `external_id`, `external_url`, `external_event_id`, `source_title`, `source_question`, `source_description`, `source_resolution_rules`, `source_resolution_url`, `source_category`, `source_tags`, `source_status`, `source_created_at`, `source_updated_at`, `source_start_at`, `source_close_at`, `source_probability_yes`, `source_volume_24h`, `source_volume_total`, `source_liquidity`, `source_open_interest`, `source_image_url`, `atinara_category`, `atinara_question_es`, `atinara_context_es`, `atinara_resolution_criteria_es`, `atinara_resolution_source_url`, `atinara_closes_at`, `atinara_resolves_at`, `yes_label`, `no_label`, `quality_status`, `quality_score`, `score_breakdown`, `warnings`, `missing_fields`, `duplicate_matches`, `fingerprint`, `fetched_at` y `cache_expires_at`.

Todos los campos externos son opcionales. Fechas inválidas, `NaN`, `Infinity`, JSON serializado malformado, protocolos inseguros y URLs locales se convierten en ausencia o rechazo; nunca llegan como valores no finitos al frontend.

Se descartan las respuestas completas, traders, wallets, perfiles, comentarios, órdenes, historiales de trading, cabeceras y metadatos innecesarios. La imagen externa solo puede conservarse como URL de referencia privada; no se carga ni se publica automáticamente.

## 5. Filtro y Atinara Score

El filtro determinista rechaza mercados cerrados o sucedidos, no binarios, sin fecha objetiva, no gaming, no clasificables, subjetivos, prácticamente decididos, políticos, de conflictos, cripto, financieros o deportes ajenos al gaming. Tavily solo puede continuar al lote semántico si la fuente ya es gaming y no pertenece a un tema bloqueado; si Gemini no demuestra fecha y criterios, se rechaza antes de persistir.

Puntuación 0–100:

- popularidad relativa dentro del proveedor: 30;
- relevancia gaming y taxonomía Atinara: 25;
- claridad y resolubilidad: 20;
- actualidad y horizonte: 10;
- incertidumbre útil: 10;
- novedad: 5.

La popularidad usa `log1p` y máximos por proveedor. Polymarket y Kalshi no se comparan como si su volumen monetario fuera equivalente. El desglose se muestra y se explica que no es una predicción científica.

## 6. Duplicados y pre-rellenado

El orden de comprobación es:

1. `provider + external_id`;
2. URL externa;
3. pregunta normalizada sin acentos, artículos, signos o variantes Sí/No;
4. similitud textual alta;
5. Gemini solo compara semánticamente las candidatas que no tengan ya un duplicado determinista confirmado. Su resultado se conserva como `possible`, nunca como bloqueo automático, y exige revisión humana.

Un duplicado confirmado no puede prepararse automáticamente. Un posible duplicado, incluida cualquier coincidencia semántica sugerida por Gemini, sigue visible para comparación humana y nunca se convierte automáticamente en confirmación.

El pre-rellenado etiqueta cada campo como `Importado de la fuente`, `Adaptado automáticamente`, `Requiere revisión` o `Sin información`. Conserva vacíos `subject`, periodo textual, criterio No, casos límite o fecha de resolución cuando no estén demostrados. El formulario continúa editable y sus validadores existentes deciden si puede guardarse.

## 7. Base de datos y seguridad

Migración nueva:

`supabase/migrations/20260804194933_add_market_radar.sql`

Añade:

- `private.external_market_candidates`;
- `private.market_radar_provider_runs`;
- `private.market_drafts.radar_candidate_id` y `source_provenance` anulables;
- índices por proveedor, caché, categoría, estado, expiración, score y huella;
- RPC administrativas de lista, detalle, estado, descarte y guardado desde Radar;
- RPC de servicio para persistir lotes y fallos de proveedor.

Las tablas tienen RLS, carecen de acceso `anon`/`authenticated` directo y solo las funciones administrativas devuelven campos cerrados. Las escrituras de proveedor se conceden exclusivamente a `service_role`. La seguridad no depende de ocultar la pestaña.

`source_provenance` conserva proveedor, id/URL externa, título original, fechas, snapshot mínimo de métricas, probabilidad de referencia, huella, versión del adaptador, advertencias, score y fecha de preparación. No añade columnas públicas a `markets`.

## 8. Edge Function

`supabase/functions/market-radar/index.ts` admite:

- `discover`;
- `details`;
- `prepare`;
- `dismiss`;
- `provider-status`.

La función exige POST, tamaño máximo, JWT válido y `app_metadata.oraklo_admin === true`. Solo consulta los hosts permitidos, usa `AbortController`, timeout de 12 s —35 s para Gemini—, un único reintento con backoff de 500 ms en 429/5xx, respuesta máxima de 2 MB y errores públicos estructurados. Nunca acepta una URL proxy del navegador ni envía JWT a un proveedor. Gemini recibe una entrada compacta, responde en JSON, usa razonamiento mínimo y tiene la salida limitada a 8.192 tokens.

Límites: una página por proveedor, 120 candidatas normalizadas por proveedor, 60 visibles, cuatro series Kalshi y doce candidatas por lote Gemini. No hay Cron: la actualización es manual.

## 9. Datos enviados a Gemini

Solo se envían, para cada candidata ya filtrada y con longitudes acotadas: proveedor, id externo, título, pregunta, descripción, reglas, URL de resolución, fecha de cierre y tags. Para comparar semánticamente se añade una lista limitada a 50 definiciones con id interno, tipo y pregunta, sin datos personales. No se envían email, UUID de usuarias, username, Karma, Prestigio, rango, predicciones, JWT, sesiones, comentarios, traders, wallets ni secretos.

## 10. Pruebas y evidencia local

- Adaptadores Polymarket y Kalshi con fixtures mínimas: binario, outcomes invertidos, bid/ask, último precio, reglas, números fixed-point, cierres, ausencia de fecha, no gaming, respuesta parcial, cursores y JSON malformado.
- Normalización: UTC, números, probabilidades, nulos, tags, caracteres, huella y duplicados.
- Score: normalización por proveedor, seis factores, ausencia de métricas y límite 0–100.
- Seguridad: 401, 403 y administración, allowlist, timeout, backoff, fallo parcial, permisos mínimos y ausencia de proxy libre.
- Pre-rellenado: no inventa, no guarda, no publica, no aprueba, no programa y conserva la creación manual.
- UI: claro/oscuro con tokens semánticos, foco visible y rejillas 3/2/1 columnas.

La comprobación pública se hizo sin credenciales y sin persistir datos. Polymarket respondió 200 y ofreció 22 candidatas gaming normalizables para `video game gaming`. Kalshi respondió 200, publicó las etiquetas `Entertainment / Video games` y series gaming, pero esas series no tenían mercados abiertos en la fotografía del 4 de agosto de 2026. Este último punto requiere volver a comprobarse después del despliegue; no se finge con fixtures en la interfaz.

## 11. Registro histórico de la activación original

- GitHub Pages sirve las diez páginas con `v=20260804-radar1`.
- Supabase registra `20260804213111 · add_market_radar`, procedente de `20260804194933_add_market_radar.sql`; LMSR y Cron no se repitieron.
- `market-radar` está activa como versión 4 con `verify_jwt=true`; `publish-scheduled-markets` continúa en versión 2.
- La aceptación autenticada cubrió actualización, caché, fallo parcial, detalle, descarte y pre-rellenado. Una cuenta normal recibió `ADMIN_REQUIRED`; no se publicó ninguna candidata.
- La incidencia posterior de Gemini era un timeout interno de 24 s. Tras compactar la entrada y usar razonamiento mínimo, la prueba real terminó en 24,8 s con 12 adaptaciones y estado `available` sin error.
- No hay que volver a aplicar estas migraciones, cambiar secretos ni desplegar
  estas versiones. La referencia v4 de este registro quedó superada por v26.

## 12. Punto de parada

Estado correcto después de la aceptación y de la corrección de Gemini:

`Paso 13.5 activado y aceptado técnicamente; market-radar v4 activa con JWT y Gemini disponible`.

## 13. Paso 13.5.1 · corrección profesional preparada localmente (histórico)

> Este apartado conserva el plan de activación de 6 de agosto de 2026 como
> registro histórico. Sus migraciones y despliegues ya se ejecutaron y fueron
> superados por la puerta factual B2B del 9 de agosto. No repetir el orden ni
> usar estas versiones como estado vigente; consultar `ORAKLO_PROJECT_CONTEXT.md`.

Estado en esa fotografía histórica: **implementado localmente y pendiente de
activación manual de Yol**. El estado vigente está en el documento de contexto.
Este apartado no modifica el registro histórico anterior: producción continúa
con la migración y Edge Function ya activadas hasta completar el orden manual.

### Cambios de contrato

- El normalizador pasa a `atinara-radar-v2` y conserva por separado evento padre,
  mercado hijo, slugs, URL canónica del evento, URL canónica del mercado y fuente
  pública de resolución.
- Polymarket valida el evento con Gamma `/events/slug/{event.slug}` y la
  pertenencia de cada mercado hijo. La URL pública usa siempre el slug padre.
- Kalshi obtiene la categoría y etiqueta exactas desde
  `/search/tags_by_categories`, ordena hasta 25 series por relevancia, volumen y
  actualidad, y pagina `/events` con `with_nested_markets=true`. Los mercados
  `active` son abiertos; no se reducen a un catálogo fijo de cuatro series.
- Una tarjeta representa un evento padre. Muestra hasta tres mercados hijos y
  cada hijo conserva su propia probabilidad, fecha, verificación y acción.
- El estado factual es independiente del score: `verified_open`, `needs_review`
  o uno de los estados `rejected_*`. Un rechazo, caducidad o revisión pendiente
  nunca puede habilitar la preparación.
- Tavily usa búsquedas básicas agrupadas por evento. Gemini recibe únicamente
  datos públicos y evidencia estructurada. Las comprobaciones deterministas
  prevalecen y cualquier fallo o conclusión insuficiente mantiene el flujo
  cerrado.

### Fotografía pública de cobertura del 6 de agosto de 2026

La comprobación de solo lectura de la API oficial de Kalshi descubrió exactamente
`Entertainment / Video games`, 108 series en el catálogo y consultó las 25 de
mayor prioridad con concurrencia 4. Cuatro series contenían eventos abiertos:
`KXGAMEAWARDS`, `KXGTA6`, `KXGTATRAILER` y `KXPS6`; en total fueron 4 eventos y
28 mercados hijos binarios abiertos, sin fallos de serie. Esta evidencia sustituye
el cero histórico de la fotografía del 4 de agosto, pero no altera ni persiste
datos remotos. La página HTML pública de Kalshi respondió temporalmente con
limitación `429`; por ello el contrato valida existencia y pertenencia mediante
la API oficial y no convierte ese límite del sitio en un catálogo vacío.

La consulta pública equivalente de Polymarket devolvió 3 eventos gaming activos.
Se validaron los tres por slug en Gamma y se abrieron sus URLs canónicas de evento:
`mlb-the-show-27-cover-athlete` (30 hijos), `madden-nfl-27-cover-athlete`
(21 hijos) y `ea-sports-fc27-cover-athlete` (23 hijos). Las tres respondieron
`200`; ninguna devolvió `404`. Los slugs de los mercados hijos no se utilizaron
como rutas de evento.

### Regresiones cubiertas

- EA Sports FC 27 ya revelado el 23 de julio de 2026:
  `rejected_resolved`.
- Fable candidato a GOTY 2026 con lanzamiento en febrero de 2027:
  `rejected_ineligible`.
- Half-Life 3 tratado como lanzamiento, review o premio sin anuncio oficial:
  `rejected_unannounced`. Una pregunta explícita sobre si será anunciado puede
  continuar en revisión.
- Una URL inexistente o no canónica: `rejected_invalid_source`.
- Un mercado caducado, cerrado o duplicado no puede preparar un borrador.

### Migración y activación históricas — completadas; no ejecutar

En aquella fotografía, la migración nueva era:

`supabase/migrations/20260806183627_harden_market_radar_quality_sources.sql`

Fue aplicada una sola vez. Añade verificación, motivo, caducidad, evidencia,
agrupación y URLs separadas; reemplaza las RPC necesarias con permisos mínimos;
invalida candidatas v1 no preparadas; y conserva `prepared`, `dismissed` y todos
los borradores. No ejecuta ni copia `20260804194933_add_market_radar.sql`, no
modifica LMSR y no toca datos de mercados, predicciones, Karma o Prestigio.

Orden manual histórico, ya ejecutado y no reutilizable:

1. Aplicar únicamente la migración nueva `20260806183627...`.
2. Volver a desplegar únicamente `market-radar` con verificación JWT.
3. Publicar el frontend coordinado `v=20260806-radar2`.
4. Probar como administradora actualización, evento agrupado, detalle, rechazo,
   bloqueo de revisión/caducidad y preparación de una candidata verificada sin
   guardar un borrador real si no se desea persistir datos.

No hay que crear ni cambiar secretos. Si Tavily o Gemini no existen o fallan,
la candidata permanece privada y bloqueada. IGDB, Twitch y YouTube continúan
fuera de alcance.
