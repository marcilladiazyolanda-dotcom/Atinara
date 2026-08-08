# Atinara · contexto de relevo · repositorio interno Oraklo

Última actualización del contexto: 8 de agosto de 2026.

Este documento permite continuar el proyecto en un chat nuevo sin depender del transcript anterior. Debe leerse junto con `AGENTS.md` y `README.md` antes de proponer o modificar nada.

> **Estado vigente:** el Radar funcional v17 continúa activo e intacto. Supabase
> lo enumera internamente como despliegue 18, con hash
> `942a51d928aa4c7666bb481cd55d449fb5ff00270decdb7889de8f584b15fc8e` y
> `verify_jwt=true`. El cierre del Paso 13.5.2 añade memoria autoritativa de
> borradores y revisiones; no activa Cron ni schedulers y no modifica mercados
> publicados, predicciones, Karma, Prestigio o economía.

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

No debe suponerse que toda función antigua del Supabase vivo está versionada aquí. Antes de escribir SQL nuevo, inspeccionar esquema, firmas, políticas, permisos y migraciones existentes.

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
6. **13.5 · Radar y catálogo:** Radar administrativo activado y aceptado técnicamente; migración aplicada una sola vez y `market-radar` v4 activa con JWT. El catálogo ampliado de 24–36 mercados no forma parte de esta entrega.
7. **13.6 · QA integral y beta:** aceptación completa después de activar el árbol coordinado.

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

Siguiente paso operativo: subir a `main`, conservando rutas, el ZIP mínimo de
este hito y hacer únicamente la comprobación visual final con recarga forzada.
No repetir migraciones ni despliegues: el backend ya está activado. El mercado
antiguo de julio continúa sin aprobar ni liquidar. No ampliar todavía el
catálogo, chat, GIF, feed algorítmico, temporadas, monetización, dinero real ni
compraventa secundaria.

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
