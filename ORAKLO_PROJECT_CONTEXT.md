# Atinara · contexto de relevo · repositorio interno Oraklo

Última actualización del contexto: 31 de julio de 2026.

Este documento permite continuar el proyecto en un chat nuevo sin depender del transcript anterior. Debe leerse junto con `AGENTS.md` y `README.md` antes de proponer o modificar nada.

## 1. Objetivo del producto

Atinara es un MVP de red social competitiva de predicciones sobre videojuegos, estudios, lanzamientos, eventos, creadores e industria gaming. `Oraklo` dejó de ser la marca pública el 31 de julio de 2026 y se conserva únicamente en infraestructura, historial e identificadores técnicos existentes.

Conceptos centrales:

- **Karma:** saldo ficticio que se arriesga para participar. Se descuenta al confirmar una predicción.
- **Prestigio:** reputación histórica del predictor. Cambia cuando se resuelve el mercado y determina el rango.
- **Rangos:** Observador, Intérprete, Analista, Visionario y Oráculo.
- **Privacidad:** el saldo de Karma y las predicciones activas son privados. El perfil público solo muestra trayectoria y resultados ya liquidados.
- **Identidad:** anticipación, criterio y gaming premium, nunca casino. Sin dinero real, pagos, compra de Karma ni Modo Real.

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

Comprobación directa realizada el 31 de julio de 2026 desde un clon nuevo del repositorio publicado:

- Repositorio fuente de verdad: `marcilladiazyolanda-dotcom/Atinara`.
- Rama publicada y local: `main`.
- `HEAD`, `origin/main` y el commit público coinciden exactamente en `f58a28a3f452dc4845d6caf65570826f68444137` (`Migra la marca pública a Atinara`).
- El historial anterior al renombrado se conserva y no se creó otro repositorio.
- El clon estaba limpio antes de preparar las correcciones de verificación descritas más abajo.
- No publicar una corrección sin volver a comprobar el diff, ejecutar la validación completa y conservar los identificadores técnicos heredados.

Los párrafos siguientes son comprobaciones históricas conservadas como trazabilidad; la comprobación anterior es la que describe el estado actual.

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

- El frontend usa `place_prediction(...)`; no inserta directamente en `public.predictions`.
- Supabase comprueba sesión, mercado abierto, duplicado, saldo y máximo permitido.
- Inserta la predicción y descuenta Karma en una sola operación.
- Devuelve predicción y perfil autoritativos.
- Tras confirmar se actualizan cabecera y métricas y aparece modal de éxito.
- Errores conocidos se traducen a mensajes amables.

Importante: la función `place_prediction` fue creada manualmente en Supabase antes de que existieran las migraciones actuales y puede no estar representada en esta carpeta. No recrearla ni sustituirla sin auditar primero el esquema vivo.

### Tiempo y cierre de mercados

- La cuenta atrás usa `closes_at`, no una etiqueta estática.
- Cambia de días a horas, minutos y segundos y muestra fecha exacta.
- Al vencer, el mercado queda cerrado visualmente y se bloquean controles.
- Se distinguen mercado abierto, cerrado pendiente de resolución y resuelto.

### Resolución y liquidación

- Resolución atómica de mercados y predicciones.
- Acierto: se abona el retorno correspondiente y se actualiza Prestigio.
- Fallo: no se devuelve el Karma arriesgado y se aplica el cambio de Prestigio sin bajar nunca de 0.
- Anulación: devolución íntegra y Prestigio sin cambios.
- Retorno total máximo: x10 del Karma arriesgado.
- El historial muestra Karma recibido, balance y Prestigio real.

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

- **SonarQube Cloud:** activo sobre el repositorio público mediante su aplicación oficial de GitHub. `.sonarcloud.properties` separa pruebas y excluye solo dependencias/resultados generados. El primer análisis de `main` en `c18e04e` encontró ocho vulnerabilidades bajas `Web:S5725`; se corrigieron fijando `@supabase/supabase-js@2.111.0`, su SRI SHA-384 y `crossorigin="anonymous"` en los ocho HTML. El segundo análisis confirmó Security A, cero vulnerabilidades y Quality Gate calculado.
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

Herramientas aplazadas pero vinculadas a un momento concreto:

- **Penpot:** debe abrir el próximo bloque visual del MVP antes de volver a modificar identidad, componentes, responsive, rangos, emblemas o avatares.
- **Mailjet:** antes de recuperación de contraseña, invitaciones o beta con correo transaccional.
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

No debe suponerse que toda función antigua del Supabase vivo está versionada aquí. Antes de escribir SQL nuevo, inspeccionar esquema, firmas, políticas, permisos y migraciones existentes.

## 6. Roadmap acordado

- Paso 9: rangos reales, clasificación y temporadas preparadas — terminado.
- Paso 10: perfil de usuario como currículum predictivo — terminado.
- Paso 10B: personalización y menú de cuenta — terminado; su esquema se verificó en Supabase aunque el historial remoto de migraciones no lo refleja de forma fiable.
- Paso 11: MVP social y comunidad — terminado, desplegado y aceptado con cuentas reales.
- Paso 11C: protección gratuita de contraseñas — terminado, publicado y validado.
- Paso 12: SonarQube Cloud, GitGuardian, Checkly y Sentry — terminado, publicado y validado.
- Cambio de marca pública: Atinara sustituye a Oraklo. El código local está preparado en `codex/atinara-public-brand`; antes de dar la transición por publicada hay que completar `STEP_PUBLIC_BRAND_ATINARA_CHECKLIST.md`.
- Paso 13: preparación de la beta cerrada — siguiente fase aprobada.

Orden acordado para el Paso 13:

1. **13.0 · Cierre documental:** terminado al corregir el estado real del Paso 12 y registrar Atinara como marca pública.
2. **13.1 · Auditoría funcional:** revisar recorridos completos de invitada, usuaria y administradora y clasificar cada punto como terminado, parcial, sin comprobar, ausente o aplazado.
3. **13.2 · Definición de soluciones:** priorizar huecos `P0/P1/P2` y fijar criterios de aceptación.
4. **13.3 · Diseño en Penpot:** diseñar únicamente las pantallas, componentes, estados y responsive necesarios antes de modificar de nuevo la interfaz.
5. **13.4 · Implementación:** construir las funciones aprobadas sin rehacer lo que ya funciona.
6. **13.5 · QA y beta:** probar los recorridos completos y abrir acceso controlado a un grupo pequeño.

Huecos funcionales ya confirmados para la auditoría: recuperación completa de contraseña y administración cotidiana de mercados —crear, guardar borrador, programar, publicar, editar bajo reglas seguras, cancelar y consultar participación—. No asumir que el resto de puntos auditables está ausente hasta comprobar el código y el estado vivo.

Siguiente paso operativo: publicar y verificar Atinara en toda la superficie pública, incluida la Edge Function y la configuración externa de Auth/URL. Después iniciar exclusivamente la auditoría funcional 13.1; no ampliar todavía chat, GIF, feed algorítmico, temporadas o monetización.

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
- Resolución autónoma por IA.
- Arranque de temporadas durante el desarrollo.
- Datos simulados para rellenar pantallas.
- Exposición pública de predicciones activas o saldo de Karma.
- Paneles o permisos administrativos inseguros.
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

## 10. Recordatorios para el pulido final

- Antes de programar el siguiente rediseño, crear en Penpot el sistema visual del MVP: tokens, componentes, estados, escritorio y móvil.
- Diseñar un emblema propio para cada rango: Observador, Intérprete, Analista, Visionario y Oráculo.
- Sustituir los avatares simbólicos por avatares originales relacionados con gaming y el universo de Atinara.
- Mantener el tono de anticipación y criterio y evitar estética de casino.

## 11. Comprobación mínima antes de entregar cambios

- `node --check` en cada JavaScript modificado.
- `node --test tests/password-security.test.js` cuando se modifique el control de contraseñas.
- `npm run validate` cuando exista `package.json`; incluye sintaxis, todas las pruebas unitarias y tipado de Checkly.
- `git diff --check`.
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
