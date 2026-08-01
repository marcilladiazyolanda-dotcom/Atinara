# Paso 13.1 · Auditoría funcional del MVP

Fecha de corte: 1 de agosto de 2026.

> **Aviso de continuidad:** esta es una fotografía histórica del commit `135f759`, no la descripción del árbol local posterior. Después de la auditoría Yol aprobó un mercado de precios vivos y autorizó su implementación local; también se eliminaron `data.js`, los fallbacks simulados y varios puntos de escape y errores amistosos. Para cualquier trabajo actual —y especialmente para el segundo prompt de Penpot— prevalecen `ORAKLO_PROJECT_CONTEXT.md`, `STEP_13_2_PRIORITIES_ACCEPTANCE.md`, `LIVE_MARKET_ECONOMY.md` y `STEP_13_3_LIVE_MARKET_PENPOT_OVERRIDES.md`. No debe recuperarse el frontend auditado ni diseñarse como estado final.

## 1. Objetivo y límites

Esta auditoría determina qué recorridos del MVP de Atinara están terminados, cuáles necesitan una comprobación final y qué funciones faltan antes de preparar la beta cerrada. El análisis no crea cuentas, mercados, predicciones, comentarios ni movimientos de Karma o Prestigio, y no aprueba ni liquida ningún mercado.

La auditoría se apoya en:

- el árbol publicado en `main`, commit `135f759`;
- la validación local completa (`npm run validate` y `git diff --check`);
- las pruebas de aceptación de producción de los pasos 11 y 11C;
- la inspección del esquema, permisos, RPC y Edge Functions vivos de Supabase;
- las comprobaciones de GitHub Pages, GitHub Actions, SonarQube Cloud, GitGuardian, Checkly y Sentry realizadas entre el 31 de julio y el 1 de agosto de 2026.

## 2. Leyenda

| Estado | Significado |
| --- | --- |
| ✅ Terminado y comprobado | Existe, tiene protección de servidor cuando corresponde y hay evidencia técnica o de producción suficiente. |
| 🟡 Terminado; falta comprobación final | El código y la configuración principal existen, pero falta repetir el recorrido completo en la URL canónica o tras el último despliegue. |
| 🟠 Parcial | El recorrido existe, pero contiene una carencia funcional, de seguridad, privacidad, accesibilidad o experiencia que debe resolverse. |
| 🔴 Ausente | El MVP necesita la capacidad y todavía no está construida. |
| ⏸ Aplazado deliberadamente | No forma parte de la beta cerrada actual y no debe implementarse todavía. |

## 3. Cierre previo de Atinara y observabilidad

| Comprobación | Estado | Evidencia y siguiente acción |
| --- | --- | --- |
| Repositorio, Pages y recursos bajo `/Atinara/` | ✅ | `main` y `origin/main` coinciden en `135f759`; la URL canónica y sus recursos versionados responden correctamente. |
| SonarQube Cloud | ✅ | Un único proyecto Atinara, Quality Gate aprobado, Security A y cero incidencias de seguridad. |
| GitGuardian | ✅ | Única fuente `marcilladiazyolanda-dotcom/Atinara`, monitorización e histórico al 100 %, último escaneo correcto y ningún incidente. |
| Checkly | ✅ | Los tres controles existentes se actualizaron sin duplicarlos y están en estado `Passing` contra la ruta canónica. |
| Captura y privacidad de Sentry | ✅ | Un error controlado llegó como `handled`, en `production`, con la versión `20260731-brand1` y sin usuaria, URL ni parámetros sensibles; después se resolvió. |
| Entrega de correo de Sentry | ✅ | `Send Test Notification` llegó al correo correcto. La usuaria dio por cerrada la revisión de alertas el 1 de agosto de 2026; no se ampliará la regla ni bloqueará la continuación del Paso 13 salvo nueva petición expresa. |
| Edge Function `analyze-market-resolution` | 🟠 | La versión 10 respondió correctamente desde Atinara y el análisis no modificó el mercado. La prueba detectó una incoherencia real: la pregunta abarcaba todo julio, pero `closes_at` estaba fijado el 28 de julio y la IA usó ese día como límite de investigación. Además dejó preseleccionada una fuente sobre un State of Play de febrero que no demostraba la ausencia de anuncios al final de julio y preparó `No` como decisión final pese a la contradicción. La propuesta no se aprobó. |
| Supabase Auth · URL y redirecciones | ✅ | `Site URL` y la única redirección permitida usan la ruta exacta `https://marcilladiazyolanda-dotcom.github.io/Atinara/`; la ruta antigua fue retirada. |
| Supabase Auth · correos | 🟠 | El plan gratuito usa las plantillas predeterminadas y no permite personalizarlas sin SMTP propio. El correo transaccional con identidad Atinara y entrega externa debe definirse en 13.2 antes de la beta. |
| Marca en todos los estados y Open Graph | 🟡 | Código y metadatos están actualizados y protegidos por tests. Falta el recorrido visual completo por roles y una comprobación externa de la portada y una ficha compartida. |

## 4. Recorridos de invitada

| Capacidad | Estado | Evidencia o carencia |
| --- | --- | --- |
| Navegar por portada, mercados, clasificación, perfiles y comunidad | ✅ | Las páginas públicas cargan en GitHub Pages; el recorrido público esencial de Checkly está en verde. |
| Listar, buscar y filtrar mercados reales | ✅ | `script.js` usa las RPC públicas, ofrece filtros y estados de carga y vacío. |
| Abrir una ficha, ver contador, tendencia, criterios, participación y resolución | ✅ | `market-detail.js` distingue abierto, cerrado pendiente y resuelto, y muestra las fuentes aprobadas. |
| Ver clasificación, rangos y progreso | ✅ | La clasificación global y la escala de rangos provienen de RPC con campos cerrados. |
| Ver un currículum predictivo público | ✅ | Solo publica trayectoria y predicciones liquidadas; no publica Karma disponible ni predicciones activas. |
| Leer comunidad, debates y respuestas | ✅ | Los feeds son cronológicos y solo muestran comentarios visibles y resultados ya liquidados. |
| Intentar una escritura sin sesión | ✅ | Predecir, comentar, responder, seguir, reaccionar, silenciar y reportar exigen autenticación. |
| Acceder directamente a paneles administrativos | ✅ | Las páginas rechazan invitadas y las operaciones sensibles vuelven a validar identidad y rol en el servidor. |
| Fallo de Supabase en portada o ficha | 🟠 | `script.js` y `market-detail.js` sustituyen los datos reales por `data.js` y muestran mercados de prueba. Esto contradice la regla del proyecto de usar datos reales o un estado de error honesto. |

## 5. Recorridos de usuaria autenticada

| Capacidad | Estado | Evidencia o carencia |
| --- | --- | --- |
| Iniciar sesión y restaurar una sesión válida | ✅ | Auth usa `getUser()` para validar la sesión; los accesos recientes desde Pages llegaron correctamente a Supabase. |
| Registrarse con una contraseña fuerte | 🟡 | El formulario exige 12 caracteres y comprueba filtraciones con HIBP; Supabase aplica longitud y composición. Falta repetir confirmación y retorno tras el cambio de URL. |
| Cerrar sesión y volver a la URL canónica | 🟡 | La función existe y se aceptó antes del cambio de marca; falta repetir el recorrido en `/Atinara/`. |
| Recuperar una contraseña olvidada | 🔴 | No existe interfaz ni llamada a `resetPasswordForEmail`, ni pantalla segura para establecer la contraseña nueva. |
| Abrir y personalizar el perfil propio | ✅ | Se aceptó en producción; `update_my_public_profile` limita la escritura a `auth.uid()` y a campos validados. |
| Confirmar una predicción y descontar Karma | ✅ | `place_prediction` bloquea filas, valida sesión, mercado, duplicado, saldo y límites, y escribe predicción y saldo en una transacción. El cliente no decide el resultado económico. |
| Consultar predicciones activas y liquidadas | ✅ | La lectura directa autenticada de `predictions` está limitada por RLS a filas propias. |
| Mantener privadas predicciones activas y Karma | ✅ | Las RPC públicas de perfil y comunidad no devuelven saldo actual ni predicciones sin liquidar. |
| Ver resultado, retorno, balance y Prestigio | ✅ | La liquidación atómica y el historial fueron probados; las anulaciones devuelven Karma y no alteran Prestigio. |
| Comentar, responder, editar, borrar y marcar spoiler | ✅ | El Paso 11 se aceptó en producción con cuentas normales y límites de un solo nivel y 500 caracteres. |
| Seguir, reaccionar, silenciar y reportar | ✅ | Operaciones autenticadas, privacidad de relaciones completas y colas de moderación comprobadas. |
| Recibir errores comprensibles | 🟠 | Auth y la capa social traducen errores comunes, pero `my-predictions.js` y partes administrativas todavía pueden mostrar `error.message` técnico. |
| Mostrar datos de mercado de forma segura | 🟠 | Varias vistas insertan campos de mercado en `innerHTML` sin escapar. Hoy esos campos son administrativos, pero la futura gestión de mercados ampliaría el riesgo de inyección persistente. |

## 6. Recorridos de administradora

| Capacidad | Estado | Evidencia o carencia |
| --- | --- | --- |
| Ver opciones administrativas solo con rol válido | ✅ | La interfaz usa `app_metadata.oraklo_admin`; las RPC y Edge Functions sensibles vuelven a comprobar identidad o rol. |
| Analizar un mercado cerrado con Tavily y Gemini | 🟠 | La función viva versión 10 conserva JWT y los secretos en servidor y respondió en producción. Debe rechazar una conclusión cuando el periodo formulado en la pregunta no coincide con `closes_at`, comprobar que cada fuente corresponde al periodo y criterio del mercado, no preseleccionar evidencias irrelevantes y no dejar un resultado oficial preparado mientras exista un bloqueo. El mercado de prueba no se aprobó ni liquidó. |
| Resolver manualmente con fuentes HTTPS y revisión humana | ✅ | La Edge Function de aprobación valida rol, resultado, nota y fuentes antes de llamar a la RPC protegida. |
| Liquidar aciertos, fallos y anulaciones de forma atómica | ✅ | Flujo probado y funciones vivas inspeccionadas; la IA no puede aprobar por sí sola. |
| Moderar reportes y restricciones sociales | ✅ | Descartar, ocultar, restaurar, restringir y levantar restricciones, con auditoría privada, se aceptó en producción. |
| Crear un mercado o guardarlo como borrador | 🔴 | No existe un panel administrativo dentro de Atinara ni un contrato de servidor para alta y borradores. Debe añadirse durante el Paso 13. |
| Programar y publicar un mercado | 🔴 | No existe flujo cotidiano de calendario, revisión y publicación. La publicación deberá bloquearse si la fecha de cierre contradice el periodo temporal de la pregunta o sus criterios. |
| Editar un mercado bajo reglas seguras | 🔴 | No están definidos los campos editables antes y después de recibir participaciones ni su auditoría. |
| Cancelar un mercado y tratar sus participaciones | 🔴 | La anulación durante la resolución existe, pero no un flujo administrativo cotidiano de cancelación con reglas y explicación. |
| Consultar participación antes de cerrar o resolver | 🔴 | El panel de resolución muestra métricas básicas, pero no existe una vista operativa completa para gestionar mercados y participación. |

## 7. Calidad transversal

| Área | Estado | Evidencia o carencia |
| --- | --- | --- |
| Datos reales y estados honestos | 🟠 | El camino normal usa Supabase, pero el fallback de portada y ficha aún publica el catálogo simulado de `data.js`. |
| Privacidad, RLS y permisos directos | ✅ | `anon` no tiene permisos directos sobre tablas públicas; `authenticated` solo puede leer su perfil y predicciones propias mediante RLS. Las escrituras usan RPC o Edge Functions. |
| Cálculos económicos autoritativos | ✅ | Karma, límites, dificultad, retornos y Prestigio se calculan en el servidor y se aplican transaccionalmente. |
| Protección frente a contraseñas filtradas | 🟠 | El formulario normal usa HIBP con k-anonimato, pero la protección vive en el cliente y puede evitarse llamando directamente a Auth; la protección nativa de Supabase continúa desactivada. |
| Trazabilidad del esquema | 🟠 | El esquema vivo contiene las funciones esperadas, pero el historial de migraciones de Supabase no refleja todas las migraciones versionadas y aplicadas manualmente. |
| Seguridad de contenido en frontend | 🟠 | Comunidad y perfiles escapan contenido; portada, ficha y predicciones privadas no escapan de forma uniforme los textos de mercado antes de usar `innerHTML`. |
| Estados de carga, vacío y error | 🟠 | Existen en las áreas principales, pero hay fallbacks simulados y algunos mensajes técnicos sin traducir. |
| Accesibilidad | 🟠 | Hay estructura semántica, etiquetas, `aria-live`, diálogos y estilos `:focus-visible`; falta auditoría completa de teclado, gestión de foco, contraste y lector de pantalla. |
| Responsive | 🟠 | Existen cortes de 1120, 820 y 520 px; falta una pasada manual completa en móvil y escritorio sobre la versión publicada. En el panel de resolución la cabecera de dos filas tapa parte del título y de las evidencias al desplazarse, lo que afecta a una revisión administrativa obligatoria. |
| Rendimiento y peso | 🟡 | No se detectan fallos operativos y el frontend es estático, pero falta fijar una línea base reproducible de Lighthouse antes de beta. |
| Observabilidad | ✅ | Calidad, secretos, disponibilidad, captura de errores y entrega de un correo de prueba están comprobados. La revisión adicional de alertas de Sentry se cerró por decisión de la usuaria. |
| Temporadas | ⏸ | El esquema está preparado, pero su activación requiere decisión administrativa y al menos 100 perfiles. No pertenece a la beta inicial. |
| Chat, multimedia, feed algorítmico y monetización | ⏸ | Son backlog posterior al MVP. Dinero real, compra de Karma y resolución autónoma por IA continúan prohibidos. |

## 8. Resultado de 13.1

El núcleo diferencial de Atinara está construido: mercado público, predicción transaccional, privacidad, perfiles, ranking, comunidad, moderación y resolución humana. La beta no necesita rehacer ese núcleo.

Los huecos que deben entrar en 13.2 son:

1. recuperación completa de contraseña;
2. administración cotidiana de mercados desde Atinara, incluida la coherencia obligatoria entre pregunta, criterios y fecha de cierre;
3. resolución asistida segura ante contradicciones temporales y fuentes irrelevantes, sin resultado final preseleccionado mientras exista un bloqueo;
4. eliminación de datos simulados en los fallos de Supabase;
5. escape uniforme de contenido de mercado y mensajes de error amistosos;
6. cierre de Supabase Auth y aceptación final de la marca;
7. accesibilidad, responsive, rendimiento y trazabilidad de migraciones antes de la beta.

Esta auditoría no asignó originalmente `P0`, `P1` o `P2`. La decisión posterior ya está aprobada y documentada en `STEP_13_2_PRIORITIES_ACCEPTANCE.md` con criterios verificables antes de implementar.

### Requisito temporal confirmado para 13.2

- Si una pregunta contiene un periodo o una fecha límite concreta —por ejemplo, «durante julio», «antes del 15 de septiembre» o «antes de que termine el año»—, el cierre programado del mercado debe corresponder al final exacto de ese periodo. En el mercado auditado, el cierre correcto era el final del 31 de julio, no el 28 de julio.
- La futura gestión administrativa deberá estar integrada en Atinara y ser accesible solo para una cuenta administradora válida.
- El formulario deberá pedir de forma inequívoca la fecha límite que abarca la pregunta, derivar de ella la fecha y hora exactas de `closes_at` y mostrar la zona horaria utilizada, para que la administradora no tenga que introducir dos fechas independientes que puedan contradecirse.
- Podrá guardarse un borrador incompleto, pero no publicarse un mercado con una incoherencia temporal. La relación entre el límite estructurado y `closes_at` deberá validarse también en Supabase; no bastará con una comprobación del navegador. La revisión de que el texto y los criterios expresan el mismo periodo seguirá formando parte de la confirmación administrativa.
- Si un mercado publicado ya tiene participaciones, los cambios temporales deberán quedar restringidos y auditados para no alterar las condiciones aceptadas por las usuarias.
- La resolución asistida deberá actuar como segunda barrera para mercados antiguos o importados: si detecta que la pregunta abarca más tiempo que `closes_at`, deberá señalar la contradicción y no proponer una conclusión de confianza alta.
- Una contradicción temporal o una evidencia insuficiente deberá bloquear la decisión final: el panel no dejará preseleccionado `Sí`, `No` o `Anulado`, ni habilitará la liquidación hasta que la administradora resuelva el bloqueo de forma explícita.
- Las fuentes propuestas deberán corresponder al periodo, hecho y criterio del mercado. No se marcarán por defecto fuentes irrelevantes y la explicación pública solo podrá afirmar aquello que respalden las evidencias finalmente seleccionadas por la administradora.
- La cabecera y los controles fijos no podrán ocultar el título, las advertencias ni las fuentes en escritorio o móvil, porque su lectura forma parte de la aprobación humana obligatoria.

## 9. Próxima secuencia

Esta secuencia registra la decisión existente al cerrar 13.1. La autorización posterior de Yol permitió implementar localmente el contrato de mercado vivo durante 13.3 para que Penpot parta del comportamiento correcto; no autorizó despliegue ni eliminó el diseño y QA restantes.

1. Mantener sin aprobar ni liquidar el mercado que reveló la incoherencia temporal.
2. Aplicar las prioridades y criterios ya aprobados en `STEP_13_2_PRIORITIES_ACCEPTANCE.md`.
3. Diseñar en Penpot el sistema visual completo y las superficies nuevas o modificadas del Paso 13.3.
4. Implementar y validar P0, P1 y P2 antes de abrir la beta; ninguna de las tres prioridades puede aplazarse después del lanzamiento.

La decisión posterior de 13.2 añade una puerta de publicación obligatoria: ningún mercado podrá hacerse público sin superar en servidor una revisión automática de claridad, coherencia y resolubilidad. Un rechazo no tendrá anulación administrativa, deberá explicar sus motivos y cualquier cambio esencial invalidará la validación previa.
