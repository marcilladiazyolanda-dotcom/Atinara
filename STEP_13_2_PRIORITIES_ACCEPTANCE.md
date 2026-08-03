# Paso 13.2 · Prioridades y criterios de aceptación previos a la beta

Fecha de aprobación: 1 de agosto de 2026.

Estado: **aprobado por Yol con las correcciones recogidas en este documento**. El 1 de agosto de 2026 Yol amplió expresamente el alcance con el mercado predictivo vivo descrito en `LIVE_MARKET_ECONOMY.md`. Su implementación local no autoriza por sí sola una publicación, despliegue o modificación de datos.

> **Continuidad del 3 de agosto de 2026:** Yol cerró el Paso 13.3 con A3 y Atinara Sunset aprobados y abrió 13.4. El árbol local implementa los P0, P1 y P2 de este documento; su activación y aceptación siguen pendientes y se controlan con `STEP_13_4_IMPLEMENTATION_CHECKLIST.md`. Esta nota no convierte ninguna preparación local en producción ni adelanta la QA integral.

## 1. Decisión de lanzamiento

Las prioridades indican el orden de ejecución, no qué puede aplazarse después de la beta:

| Prioridad | Función | Condición de beta |
| --- | --- | --- |
| P0 | Integridad funcional, seguridad y operaciones imprescindibles | Obligatoria y completa |
| P1 | Calidad, accesibilidad, responsive, rendimiento y trazabilidad | Obligatoria y completa |
| P2 | Sistema visual definitivo de Atinara y su implantación | Obligatoria y completa |

No se abrirá la beta cerrada mientras exista un criterio de aceptación pendiente en P0, P1 o P2. Solo el backlog que este documento excluye expresamente podrá continuar después de la beta.

La secuencia acordada es:

1. 13.3: diseñar en Penpot el sistema visual y todas las superficies nuevas o modificadas.
2. 13.4: implementar P0, P1 y P2 conservando las funciones ya aceptadas.
3. 13.5: ejecutar la matriz completa de QA y corregir todos los bloqueos.
4. Abrir la beta únicamente después de la aceptación funcional, técnica y visual de Yol.

Excepción de orden autorizada durante 13.3: se implementó localmente el contrato económico vivo antes de la Fase B visual para que Penpot diseñe el comportamiento real y no la encuesta estática anterior. La excepción no reduce ningún criterio de Penpot, implementación restante o QA. El segundo prompt debe aplicar `STEP_13_3_LIVE_MARKET_PENPOT_OVERRIDES.md`.

## 2. P0 · Integridad funcional y seguridad

### 2.1. Administración completa de mercados desde Atinara

Una cuenta administradora válida podrá:

- crear un mercado;
- guardar y editar borradores privados;
- solicitar la revisión automática previa a publicación;
- programar o publicar únicamente un mercado validado;
- consultar su estado y participación;
- cerrar anticipadamente la participación cuando el resultado ya sea público;
- cancelar bajo reglas seguras;
- resolverlo posteriormente mediante el flujo humano ya protegido.

Criterios de aceptación:

- Invitadas y usuarias normales no pueden ver borradores ni ejecutar operaciones administrativas.
- La autorización se comprueba de nuevo en Supabase; ocultar botones en el navegador no cuenta como protección.
- Un borrador puede estar incompleto, pero nunca puede aparecer en las RPC públicas.
- Las condiciones esenciales quedan bloqueadas o sometidas a una operación especial auditada cuando ya existen participaciones.
- Toda cancelación que afecte a participaciones devuelve el Karma de forma atómica y no modifica Prestigio.
- Cada creación, revisión, publicación, edición restringida, cierre anticipado y cancelación deja trazabilidad administrativa.

### 2.2. Puerta automática obligatoria antes de publicar

**Ningún mercado podrá publicarse, programarse como público ni aparecer para las usuarias sin superar una revisión automática de claridad, coherencia y resolubilidad. No habrá un botón de omisión ni un permiso administrativo para saltarse un rechazo.**

La revisión combinará:

1. **Validaciones deterministas en servidor:** campos obligatorios, opciones, fechas, zona horaria, consistencia estructurada y reglas de estado.
2. **Validación semántica automática:** correspondencia entre pregunta, opciones, criterios, periodo y fuentes de resolución; detección de conceptos vagos, contradicciones y supuestos no definidos.
3. **Confirmación humana posterior:** una administradora revisa el informe aprobado antes de publicar. La revisión automática es necesaria, pero no sustituye la responsabilidad humana.

Para solicitar la validación, el borrador deberá definir como mínimo:

- pregunta completa y sin referencias relativas indeterminadas;
- opciones mutuamente excluyentes y comprensibles;
- sujeto, evento o producto inequívocamente identificado;
- periodo de evaluación estructurado, fecha, hora y zona horaria;
- condición exacta que acredita cada resultado posible;
- jerarquía de fuentes admisibles y alternativas si la fuente principal no está disponible;
- tratamiento de retrasos, cancelaciones, filtraciones, anuncios repetidos, cambios de nombre y otros casos límite aplicables;
- texto público de criterios suficiente para que una usuaria sepa de antemano cómo se resolverá.

El sistema bloqueará, entre otros, estos casos:

- términos subjetivos sin métrica, como «éxito», «importante», «grande» o «pronto»;
- referencias como «el próximo», «el último» o «este evento» sin identificar fecha o edición;
- opciones que se solapan, se contradicen o no cubren de forma clara los resultados definidos;
- discrepancias entre la pregunta, los criterios, la fecha límite y `closes_at`;
- ausencia de una forma pública y verificable de acreditar el resultado;
- fuentes privadas, inaccesibles o demasiado imprecisas para resolver;
- criterios que permiten dos resoluciones razonables distintas;
- un resultado cuya prueba depende de interpretar intenciones o valoraciones no observables;
- análisis automático no concluyente, no disponible, agotado por cuota o con respuesta inválida.

Comportamiento exigido cuando la validación no se supera:

- El mercado continúa como borrador privado y no cambia a publicado ni programado.
- Atinara muestra en español todos los motivos bloqueantes, asociados al campo afectado y con una explicación concreta de cómo corregirlos.
- Los motivos usan códigos estables para pruebas y un texto comprensible para la administradora; nunca se muestra un error técnico crudo.
- Una advertencia sobre ambigüedad o falta de resolubilidad siempre es bloqueante. Solo podrán ser informativos los consejos puramente editoriales que no afecten al resultado.
- La administradora corrige el borrador y solicita una nueva revisión; no puede aceptar el riesgo y publicar igualmente.
- Si el servicio automático falla, el comportamiento es cerrado y seguro: el mercado no se publica.

Vigencia de la validación:

- El aprobado queda vinculado a la versión exacta del título, pregunta, opciones, criterios, fuentes y fechas.
- Cualquier cambio en uno de esos elementos invalida el aprobado y devuelve el mercado a revisión pendiente.
- La publicación se ejecuta mediante una operación autoritativa de Supabase que vuelve a comprobar rol, estado, versión y aprobado vigente dentro de la misma operación.
- Los permisos directos sobre la tabla no permitirán convertir un borrador en público evitando ese contrato.
- El informe conserva fecha, versión del validador, resultado, motivos y huella del contenido revisado.

Casos mínimos de aceptación:

1. «¿Será un éxito?» sin métrica se rechaza y señala el concepto subjetivo.
2. «¿Se anunciará pronto?» sin fecha se rechaza y señala el periodo ausente.
3. Un mercado con pregunta hasta el 31 de julio y cierre el 28 se rechaza por contradicción temporal.
4. Un mercado sin fuentes públicas aptas se rechaza por no resoluble.
5. Un mercado con opciones solapadas se rechaza y explica el solapamiento.
6. Un mercado completo, medible, temporalmente coherente y resoluble supera la revisión y queda listo para confirmación humana.
7. Una caída, cuota agotada o respuesta inválida del validador deja el borrador sin publicar.
8. Editar un mercado aprobado invalida inmediatamente el aprobado anterior.
9. Una usuaria normal y una llamada directa a la API no pueden publicar ni falsear la validación.
10. Ningún borrador, rechazo o informe privado aparece en las RPC públicas.

### 2.3. Coherencia temporal y cierre anticipado

- El formulario solicita el final exacto del periodo que decide la pregunta y muestra siempre la zona horaria.
- Al publicar, `closes_at` coincide con ese final. Para «durante julio», corresponde al final del 31 de julio, no al día 28.
- Se conservará por separado la fecha límite de resolución para que un cierre anticipado no reduzca el periodo que debe investigar la IA.
- Si el resultado se hace oficial antes del límite, la administradora puede cerrar inmediatamente nuevas participaciones, dejando registrada la causa y la hora real.
- La resolución automática investiga el periodo definido por la pregunta, no una fecha de cierre anticipado ni una fecha incoherente heredada.

### 2.4. Resolución asistida segura

- Una contradicción temporal, fuente irrelevante o evidencia insuficiente produce «Revisión necesaria» y bloquea la liquidación.
- No se preseleccionan `Sí`, `No`, `Anulado` ni fuentes mientras exista un bloqueo.
- Cada fuente debe corresponder al hecho, periodo y criterio evaluado.
- La explicación pública solo puede afirmar lo respaldado por las fuentes que la administradora seleccione finalmente.
- La IA nunca aprueba ni liquida por sí sola.
- El mercado auditado de julio debe quedar pendiente hasta corregir o decidir su tratamiento, sin aprobar la propuesta insegura existente.

### 2.5. Recuperación de contraseña y correo transaccional

- Atinara ofrece solicitud y finalización de recuperación de contraseña.
- La respuesta de solicitud no revela si el correo existe.
- Un SMTP propio entrega confirmación, recuperación y avisos de seguridad a direcciones externas con identidad Atinara.
- Los enlaces regresan de forma segura a `/Atinara/` y gestionan caducidad, reutilización y errores con mensajes comprensibles.
- La contraseña nueva cumple las reglas vigentes y permite iniciar sesión; la anterior deja de funcionar.

### 2.6. Datos honestos, contenido seguro y errores comprensibles

- Si Supabase falla, no se muestran mercados, métricas, actividad ni usuarias simuladas.
- Se muestra un estado honesto con reintento.
- Todos los textos dinámicos se escapan o se insertan como texto, incluidos los mercados creados por administración.
- Ninguna pantalla pública muestra `error.message`, detalles SQL, nombres de tablas, trazas o secretos.
- Hay pruebas de regresión frente a inyección HTML persistente, fallos de red y respuestas incompletas.

### 2.7. Precio colectivo vivo y contrato económico de beta

- `Sí` y `No` forman un precio vivo y siempre suman 100 %; participantes, Karma total y precio son métricas distintas.
- La beta usa un creador automático LMSR con Karma, no un recuento de personas y no un libro de órdenes.
- Cada participación confirmada mueve el precio, guarda un punto histórico real y adquiere contratos al precio medio de ejecución.
- La cotización autoritativa muestra precio actual, impacto, precio medio, precio posterior, contratos, retorno base, bonus de dificultad y Prestigio.
- La confirmación es atómica y exige la versión exacta y un precio máximo ya revisado; si se mueve el mercado, se recotiza y se vuelve a confirmar.
- Cada contrato nuevo acertado liquida a 1 Karma. El bonus de dificultad se añade por separado y el antiguo límite `×10` no se aplica al retorno base nuevo.
- Las posiciones anteriores conservan sus condiciones, incluido `×10`; ninguna migración reescribe su contrato.
- La gráfica y sus *sparklines* solo muestran puntos reales. Sin actividad permanecen quietas y explican honestamente la falta de movimiento.
- Durante la beta existe una sola posición bloqueada por persona y mercado. No hay venta, salida anticipada, cambio de lado, cobertura, órdenes o mercado secundario.
- El precio y el histórico agregado son públicos; el Karma disponible, la opción elegida, los contratos y las posiciones activas permanecen privados.
- Liquidez, límites y bonus se someten a simulaciones económicas y pruebas de abuso antes de abrir la beta.

## 3. P1 · Calidad obligatoria antes de beta

### 3.1. Accesibilidad

- Objetivo de conformidad: WCAG 2.2 nivel AA en los recorridos principales.
- Navegación completa por teclado, orden lógico, foco visible y restaurado, diálogos accesibles y contenido no oculto por cabeceras fijas.
- Etiquetas, nombres accesibles, estados, mensajes de error y regiones dinámicas comprensibles para lector de pantalla.
- Contraste, tamaño de objetivos, zoom y reducción de movimiento comprobados.
- Las pruebas automáticas se complementan con revisión manual; una puntuación de Lighthouse no sustituye la aceptación real.

### 3.2. Responsive y compatibilidad visual

- Sin desbordamiento horizontal ni controles inaccesibles en 320, 375, 768, 1024 y 1440 píxeles.
- Se revisan todas las páginas públicas, Auth, perfil, comunidad y paneles administrativos.
- La cabecera nunca tapa títulos, advertencias, fuentes, formularios ni acciones.
- Los formularios, tablas, modales y navegación funcionan con teclado y tacto.

### 3.3. Recorridos, marca y estados

- Registro, confirmación, inicio y cierre de sesión, recuperación, navegación canónica y permisos por rol superan la aceptación completa.
- No aparece Oraklo como marca visible en ningún estado, correo o metadato público.
- Portada y fichas compartidas muestran Open Graph de Atinara.
- Cada pantalla tiene estados coherentes de carga, vacío, error, sin permiso y éxito.

### 3.4. Rendimiento, estabilidad y trazabilidad

- Se fija y documenta una línea base reproducible de Lighthouse en móvil y escritorio para portada, ficha y comunidad.
- No hay errores propios de Atinara en consola, recursos rotos ni dependencias sin fijar.
- Las migraciones del repositorio se reconcilian con el esquema vivo antes de añadir las nuevas y se documenta cualquier diferencia histórica.
- Las migraciones nuevas incluyen permisos mínimos, RLS o contrato RPC correspondiente, pruebas y revisión de asesores de Supabase.
- GitHub Actions, SonarQube, GitGuardian y Checkly deben permanecer en estado aceptado al cerrar 13.5.

## 4. P2 · Diseño visual definitivo obligatorio antes de beta

El diseño no se considera un adorno posterior. Atinara no abrirá su beta con una identidad provisional o con pantallas funcionales visualmente inconexas.

### 4.1. Sistema visual en Penpot

Antes de modificar el CSS se aprobará en Penpot:

- identidad propia de mercado predictivo y red social gaming premium, sofisticada, clara e intuitiva, sin lenguaje ni códigos visuales de casino, dinero real, cripto o esports genérico;
- arquitectura familiar inspirada en patrones de descubrimiento de Polymarket y de ficha/acción de Kalshi, sin copiar sus pantallas, componentes, activos o marca;
- paleta y roles de color;
- tipografías y escala;
- espaciado, rejillas, radios, sombras, iconografía y movimiento;
- componentes y todos sus estados: normal, hover, foco, activo, deshabilitado, carga, error y éxito;
- patrones responsive de cabecera, navegación, tarjetas, formularios, tablas, modales y paneles administrativos.

### 4.2. Pantallas y estados que deben diseñarse e implantarse

- portada y exploración de mercados;
- ficha de mercado y flujo completo de predicción;
- gráfica real de `Sí` y `No`, rangos temporales, cotización, impacto, precio medio, contratos, retorno base, bonus, Prestigio y recotización;
- registro, inicio de sesión y recuperación;
- predicciones privadas;
- clasificación;
- perfil, historial, logros y personalización;
- comunidad y debates;
- administración de mercados y puerta de validación previa;
- resolución y moderación administrativas;
- estados vacíos, carga, error, bloqueo, caducidad, sin permisos y confirmación;
- versiones de escritorio y móvil de todas las superficies anteriores.

### 4.3. Activos propios de Atinara

- Emblema original y diferenciado para Observador, Intérprete, Analista, Visionario y Oráculo.
- Colección coherente de avatares propios relacionados con gaming y el universo de Atinara.
- Iconos e ilustraciones con licencia o autoría verificable y sin recursos provisionales de demostración.
- Alternativas textuales y tratamiento responsive de cualquier activo significativo.

### 4.4. Aceptación visual

- La implementación coincide con los componentes y pantallas aprobados en Penpot.
- No quedan estilos provisionales, duplicados o propios de la marca anterior.
- La jerarquía visual, legibilidad y densidad son coherentes en toda la plataforma.
- El diseño conserva claridad en estados reales con textos cortos, largos, vacíos y errores.
- Yol realiza la aceptación visual final en escritorio y móvil antes de autorizar la beta.

## 5. Fuera del alcance previo a esta beta

Continúan aplazados, salvo una decisión posterior expresa: dinero real, compra de Karma, Modo Real, temporadas activas, chat o mensajes directos, multimedia social, feed algorítmico, resolución autónoma por IA y toda venta, salida anticipada, cambio de posición, cobertura, libro de órdenes, especulación o mercado secundario. Estas últimas funciones solo se reevaluarán después de la beta y no se consideran prometidas.

Estos aplazamientos no reducen la obligación de completar P0, P1 y P2.

## 6. Evidencia necesaria para cerrar 13.5

El cierre previo a beta deberá reunir:

- matriz de aceptación de cada criterio de este documento;
- pruebas automatizadas y manuales con resultados;
- capturas o grabaciones de escritorio y móvil;
- comprobaciones por invitada, usuaria y administradora;
- verificación de permisos y bloqueo directo en Supabase;
- validación de mercados válidos, ambiguos, irresolubles y con fallos del servicio;
- aceptación visual final de Yol;
- confirmación explícita de que no queda ningún P0, P1 o P2 abierto.

## 7. Referencias técnicas de aceptación

- Supabase · `Securing your API`: los permisos determinan qué objetos puede alcanzar cada rol y RLS limita las filas; las funciones deben tener permisos de ejecución explícitos y revisarse especialmente si usan `SECURITY DEFINER`: https://supabase.com/docs/guides/api/securing-your-api
- W3C · WCAG 2.2: recomendación y criterios comprobables para el objetivo de accesibilidad AA: https://www.w3.org/TR/WCAG22/
