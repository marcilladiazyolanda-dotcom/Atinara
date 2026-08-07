# Atinara

MVP de red social competitiva de predicciones gaming basada en Karma, Prestigio y rankings. **Atinara** es la marca pública; parte de la infraestructura y los identificadores técnicos conservan `Oraklo` como nombre interno para evitar cambios incompatibles.

Web pública canónica: https://marcilladiazyolanda-dotcom.github.io/Atinara/

## Estado local · Paso 13.5.2

El árbol local incorpora el **Observatorio de Datos y tendencias**, un núcleo
experto compartido y el **Agente Centinela** de fuentes de resolución. La
implementación está preparada para revisión y activación manual; no está
desplegada y no cambia el estado productivo vigente.

- `Datos y tendencias` ocupa la tercera pestaña de `Gestionar mercados`, entre
  el Radar y `Mercados publicados`. IGDB, Twitch y YouTube son proveedores
  aislados: la falta o el fallo de uno no bloquea los restantes.
- `market-expert` analiza tanto candidatas del Radar como señales del
  Observatorio bajo una sola Constitución versionada. Entrega JSON estructurado,
  separa hechos, contexto e inferencias, limita herramientas y nunca almacena
  cadena de pensamiento.
- `market-source-monitor` captura evidencias versionadas para la revisión humana.
  Un error, un dato oculto o la ausencia de un valor nunca equivalen a cero o a
  un resultado. `ready_to_resolve` no liquida el mercado.
- La puerta de fuentes es aditiva: solo los borradores vinculados al nuevo
  sistema deben tener contrato vigente y, cuando corresponda, monitor armado.
  Los borradores manuales anteriores conservan su flujo.
- La migración local pendiente es
  `supabase/migrations/20260807163000_add_data_observatory_and_market_intelligence.sql`.
  Las funciones nuevas son `data-observatory`, `market-expert` y
  `market-source-monitor`, siempre con verificación JWT.
- Las credenciales de Twitch y YouTube no forman parte del repositorio. Deben
  configurarse, si Yol decide activarlas, únicamente como secretos de Supabase.
  Los dos schedulers preparados permanecen desactivados y son independientes.

La arquitectura, los contratos, la activación y las pruebas se documentan en
`STEP_13_5_2_DATA_OBSERVATORY_AND_AGENTS.md`.

## Continuidad entre chats

- `AGENTS.md` contiene las instrucciones permanentes que Codex debe aplicar al trabajar en esta carpeta.
- `ORAKLO_PROJECT_CONTEXT.md` recoge el estado técnico, decisiones, roadmap, restricciones y comprobaciones necesarias para retomar el proyecto en un chat nuevo.
- `LIVE_MARKET_ECONOMY.md` define el contrato económico aprobado del precio vivo y `STEP_13_3_LIVE_MARKET_PENPOT_OVERRIDES.md` corrige los supuestos anteriores que no deben llegar al diseño definitivo.
- Antes de editar, hay que leer estos documentos vinculantes y comprobar el estado actual de Git; el transcript anterior no debe ser la única fuente de contexto.

## Estado actual · Radar v17

El Radar v16 está publicado y aceptado en `origin/main = 8255fd50645a6faea2131790c67c83288b8cae54`. Sobre esa base, el Radar v17 está implementado **solo en local** y pendiente de activación manual de Yol. Mantiene `atinara-radar-v2` para no repetir ni ampliar el esquema y añade la política funcional `atinara-prediction-policy-v3`: una fecha anunciada informa la probabilidad, pero no invalida un umbral futuro; un lanzamiento o anuncio puede predecirse aunque el producto no esté anunciado; un premio o una reseña sí exige que el sujeto exista; y un resultado publicado por el proveedor se archiva como resuelto.

V17 descarta estados cerrados, resueltos, no binarios o inválidos antes de Tavily y Gemini; además consulta directamente un máximo acotado de resultados históricos de Kalshi para corregir descartes antiguos como Halo. La auditoría oculta por defecto eventos resueltos y evaluaciones del criterio anterior, permite filtrar por motivos en español y nunca muestra códigos internos. Las tarjetas con una sola opción ocupan las dos columnas y `Detalles` y `Abrir evento original` usan la misma jerarquía visual que `Preparar`.

No hay migración nueva ni cambio de secretos. Las migraciones del Radar v16 ya están aplicadas y no deben repetirse. La activación coordinada debe desplegar primero la Edge Function, subir después los recursos `v=20260807-radar3` y terminar con una actualización explícita de fuentes para sustituir la caché de la política anterior.

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
- `analyze-market-resolution` usa Tavily Search en modo básico para recopilar fuentes anteriores al cierre y Gemini 3 Flash Preview para analizarlas.
- `approve-market-resolution` exige una administradora autenticada y ejecuta la resolución atómica en Supabase.
- La IA nunca puede resolver por sí sola: una persona debe revisar las fuentes, elegir el resultado y confirmar la liquidación.
- Si la ficha usa referencias como «último» o «próximo» sin identificar una fecha concreta, el sistema propone `Anulado`, explica la ambigüedad y usa la ficha original como evidencia. La anulación sigue necesitando confirmación humana.
- Si el mercado está definido pero la búsqueda no encuentra pruebas suficientes, muestra `No concluyente` sin convertirlo en un error técnico ni habilitar una resolución insegura.
- Si Tavily o Gemini no están disponibles, el panel permite una resolución manual protegida que también exige fuentes HTTPS y revisión humana.
- Las fuentes aprobadas y la explicación quedan visibles en la ficha pública del mercado.

Las claves se configuran únicamente como secretos `GEMINI_API_KEY` y `TAVILY_API_KEY` de las Edge Functions. Nunca deben añadirse al frontend ni al repositorio. Cada análisis normal realiza tres búsquedas básicas de Tavily y una petición de texto a Gemini; los límites gratuitos dependen de cada proveedor.

## Radar administrativo de mercados · Paso 13.5

- `admin-markets.html` conserva `Crear manualmente` y añade una pestaña `Radar de mercados` únicamente para administradoras.
- `market-radar` centraliza las consultas externas, valida el JWT y `oraklo_admin`, limita hosts, tiempo, tamaño, reintentos y consumo, y conserva resultados parciales cuando una fuente falla.
- Polymarket usa `GET /public-search`; Kalshi parte de `GET /series` con `Entertainment + Video games` y consulta sus mercados abiertos. No se consultan posiciones, traders, wallets, órdenes o perfiles externos.
- Tavily busca un máximo de seis fuentes públicas por actualización y Gemini adapta como máximo doce candidatas por lote, solo si sus secretos existentes están disponibles. La llamada de Gemini usa entrada acotada, salida JSON, razonamiento mínimo, límite de tokens y timeout de 35 s para evitar la incidencia de latencia detectada tras la activación. Sin secretos, la fuente se declara no configurada y la creación manual continúa.
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

Para activar la personalización hay que ejecutar una sola vez en Supabase el archivo:

`supabase/migrations/20260715020000_add_profile_customization.sql`

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

Para activar el Paso 11 hay que ejecutar una sola vez en Supabase, después de las migraciones anteriores:

`supabase/migrations/20260718143106_add_social_community_mvp.sql`

Después debe aplicarse la corrección del contador público real:

`supabase/migrations/20260718182915_expose_real_market_comment_counts.sql`

Ambas migraciones fueron aplicadas en producción y el MVP social se validó como invitada, con dos cuentas normales y con administradora el 18 de julio de 2026. La cuenta temporal de aceptación y sus datos se eliminaron al terminar.

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
