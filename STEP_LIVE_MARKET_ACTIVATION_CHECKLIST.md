# Activación coordinada · mercado predictivo vivo

Fecha de preparación y activación: 1 de agosto de 2026.

Estado: **migración aplicada y frontend productivo**. La migración `supabase/migrations/20260801172543_add_live_prediction_market_model.sql` ya se ejecutó una sola vez en producción y **no debe volver a ejecutarse**. Supabase la registra como `20260801184105_add_live_prediction_market_model`; la diferencia de hora corresponde al registro remoto, no a una migración distinta.

El frontend inicial se publicó en `f7aac42` con `v=20260801-market1`; se conserva como evidencia histórica. `data.js` fue eliminado en `4ccd97e` y la limpieza completa se publicó en `a5c633b`. GitHub Pages sirve `v=20260801-market2`, la URL pública de `data.js` devuelve 404 y las métricas privadas provisionales ya no aparecen para invitadas.

## 1. Por qué se coordinó

La migración cambió la firma de `place_prediction` y el frontend nuevo dependía de RPC y campos nuevos. Por eso SQL y frontend se activaron dentro de una ventana controlada. Esta explicación se conserva como trazabilidad histórica; ya no es una instrucción para volver a activar nada.

Reglas que siguen vigentes:

- no repetir la migración;
- no revertir Supabase de forma improvisada;
- no modificar ni recalcular contratos heredados;
- no crear datos ficticios para ocultar un fallo;
- no aceptar una cotización antigua si `place_prediction` devuelve `PRICE_MOVED`.

## 2. Evidencia previa conservada

- La firma viva anterior de `place_prediction`, `resolve_market`, las RPC públicas, permisos, RLS y columnas afectadas se auditaron antes del cambio.
- La migración completa se probó previamente dentro de una transacción con cotización, participación, histórico y liquidación y terminó con `ROLLBACK`.
- La lectura posterior a aquella prueba confirmó que no quedaron tablas, puntos, predicciones, saldos ni datos temporales.
- El árbol validado correspondía al commit local `77f447f`; la subida web produjo el commit remoto equivalente `f7aac42`.
- Los ZIP de trabajo anteriores no forman parte del repositorio y nunca deben añadirse, modificarse o eliminarse accidentalmente.

## 3. Activación realizada

- [x] Se confirmó una ventana sin resolución en curso.
- [x] Se registró una fotografía agregada previa: 11 mercados, 7 predicciones, 5 activas y 2 perfiles.
- [x] Se aplicó una sola vez `20260801172543_add_live_prediction_market_model.sql`.
- [x] Las RPC nuevas quedaron disponibles y desapareció la firma antigua de `place_prediction`.
- [x] Se publicó el frontend coordinado en `f7aac42`.
- [x] GitHub Pages sirvió los recursos iniciales con `v=20260801-market1`.
- [x] Las 7 predicciones anteriores quedaron como `legacy_fixed_v1` sin cambiar condiciones, Karma, estado o liquidación.
- [x] Los saldos agregados de Karma y Prestigio permanecieron exactamente iguales durante la activación.
- [x] No quedó ninguna predicción, saldo o dato temporal de prueba.

## 4. Supabase · comprobación administrativa de solo lectura

Resultado comprobado de nuevo el 1 de agosto de 2026 mediante consultas exclusivamente de lectura y sin publicar identificadores personales. Coincide con la fotografía anterior:

- [x] 11 mercados.
- [x] 11 estados `market_maker_state`.
- [x] 11 puntos `market_price_history`, uno inicial por mercado.
- [x] 7 contratos `legacy_fixed_v1`, 5 activos.
- [x] 0 contratos `lmsr_v1` después de la aceptación de solo lectura.
- [x] Todos los estados y puntos cumplen `Sí + No = 100 %`.
- [x] Todos los estados mantienen `b = 2000 Karma`.
- [x] Los 11 estados y los 11 puntos históricos continúan en versión 0; no existe actividad LMSR posterior.
- [x] No hay mercados sin estado ni estados sin mercado.
- [x] Los contratos heredados no contienen campos de ejecución LMSR y sus valores compatibles siguen coherentes con el contrato anterior.
- [x] Existe `get_prediction_quote(text, text, integer)`.
- [x] Existe la nueva firma versionada de `place_prediction(text, text, integer, bigint, numeric)`.
- [x] No existe la firma antigua de nueve argumentos.
- [x] Una cotización de 10 Karma devolvió modelo, versión, impacto, precio medio, precio posterior, contratos, retorno base, bonus y Prestigio válidos.
- [x] `market_maker_state` y `market_price_history` no conceden lectura directa a `anon` ni `authenticated`.
- [x] `predictions` y `profiles` usan RLS; una usuaria autenticada solo puede leer sus propias filas.
- [x] Las RPC de mercado no devuelven identidad, opción, contratos ni saldo privado.
- [x] El feed social publica predicciones únicamente cuando `settled_at` existe.
- [x] `resolve_market` solo es ejecutable por `service_role`.
- [x] `resolve_market_with_evidence` solo es ejecutable por `service_role`.
- [x] `approve-market-resolution` está activa, exige JWT válido y comprueba `app_metadata.oraklo_admin === true` antes de invocar la RPC protegida.
- [x] Ninguna consulta creó o modificó mercados, saldos, contratos o predicciones.

Los avisos de asesores sobre tablas con RLS sin políticas son informativos e intencionados porque no tienen permisos directos y se accede por RPC cerradas. Los avisos genéricos sobre RPC `SECURITY DEFINER` públicas incluyen superficies deliberadamente públicas; deben evaluarse por contrato, no silenciarse automáticamente. Los índices sin uso continúan siendo esperables con dos perfiles y poco tráfico. La protección nativa de contraseñas filtradas sigue no disponible en el plan actual y se complementa con el control HIBP por k-anonimato ya documentado.

## 5. GitHub Pages · aceptación invitada

Comprobado sobre la página realmente renderizada, no solo sobre el repositorio:

- [x] Portada, Comunidad, clasificación, un perfil público y una ficha real cargaron datos de Supabase.
- [x] HTML, CSS y JavaScript principales respondieron correctamente. La versión inicial fue `v=20260801-market1` y la comprobación posterior confirmó `v=20260801-market2` en los ocho HTML.
- [x] Ningún HTML ni JavaScript cargó o referenció `data.js`; su URL pública devuelve 404.
- [x] Ante un fallo, el código usa un error honesto con reintento y no un catálogo alternativo.
- [x] La ficha mostró valores reales de `Sí` y `No` que sumaban 100 %.
- [x] Un mercado sin participaciones mostró 50/50, un único punto inicial y el texto «Sin movimientos todavía».
- [x] Los rangos `1 h`, `6 h`, `24 h`, `7 d` y `Todo` respondieron y mantuvieron el único punto real.
- [x] Las líneas se identifican por texto; la gráfica expone un `slider` accesible para ratón, teclado y tacto cuando existan varios puntos.
- [x] Con un único punto el `slider` queda deshabilitado y fecha, `Sí` y `No` permanecen visibles, sin inventar una línea.
- [x] Al intentar confirmar como invitada se abrió el diálogo de inicio de sesión y no se creó ninguna predicción.
- [x] No aparecieron controles de vender, retirarse, cambiar de posición, cubrirse u ordenar una operación.
- [x] No apareció lenguaje de dinero real, inversión o rentabilidad.
- [x] No hubo errores propios de Atinara en consola; el único error observado pertenecía a una extensión del navegador de aceptación.
- [x] En escritorio no hubo desbordamiento horizontal en portada, Comunidad, clasificación, perfil o ficha.
- [x] A 768 × 1024 no hubo desbordamiento global en portada, Comunidad, clasificación, perfil público, ficha abierta ni ficha resuelta.
- [x] A 375 × 667 y 390 × 844, portada, Comunidad, clasificación, perfil y ficha abierta quedaron correctas; la ficha resuelta reveló un desbordamiento real causado por URLs largas.
- [x] A 320 × 568, las seis superficies revelaron un desbordamiento global de 15 px causado por `min-width: 320px` en el elemento raíz.
- [x] El árbol de cierre elimina ese mínimo rígido y aplica `overflow-wrap: anywhere` a los textos de resolución. La comprobación visual local posterior supera las seis superficies a 320 × 568 y 375 × 667 sin scroll global.
- [x] Pregunta, `Sí`, `No`, gráfica, cinco rangos y desglose completo de cotización permanecen visibles; no hay solapamientos del panel ni objetivos táctiles menores de 24 px.
- [x] Los cinco rangos responden por interacción a 320 px y conservan el único punto real sin fabricar movimiento.
- [x] Los controles tienen nombres accesibles, las líneas se identifican también por texto y el foco de teclado es visible.
- [x] Confirmar como invitada abre el diálogo de acceso, mantiene la URL y no envía un formulario ni crea datos.

Incidencia encontrada y corregida en el árbol de limpieza:

- Los ocho HTML mostraban a invitadas `1.000 Karma`, `0 Prestigio` y `Observador` desde un perfil provisional de JavaScript. No procedía de Supabase y contradecía la privacidad y los datos honestos.
- La corrección mantiene ocultas las métricas privadas hasta que existe una sesión real y sustituye el progreso ficticio de portada por una invitación honesta a iniciar sesión.

## 6. Limpieza posterior

- [x] `data.js` se eliminó del árbol final.
- [x] No existe ninguna referencia a `data.js` en HTML o JavaScript.
- [x] La cabecera invitada ya no contiene cifras privadas provisionales en el HTML.
- [x] `auth.js` solo revela los elementos `data-auth-private` con sesión real.
- [x] La portada no calcula progreso de rango para invitadas.
- [x] Todos los recursos locales se coordinan en `v=20260801-market2`.
- [x] Preparar el paquete completo del árbol final validado sin ZIP internos, secretos ni archivos ajenos.
- [x] Eliminar `data.js` en GitHub mediante `4ccd97e`.
- [x] Publicar el resto del árbol final en `a5c633b`.
- [x] Confirmar que `origin/main` contiene la eliminación y la limpieza completa.
- [x] Confirmar que GitHub Pages devuelve 404 para `data.js` y sigue cargando datos reales.
- [x] Repetir portada, Comunidad, clasificación, perfil y fichas sobre `v=20260801-market2`.
- [x] Completar la comprobación móvil real y corregir en el árbol de cierre los dos desbordamientos encontrados.

## 7. Pruebas autenticadas que requieren autorización separada

Estas pruebas no se fingieron ni se ejecutaron durante la aceptación de solo lectura:

- [ ] Solicitar cotización como usuaria real y comprobar su límite personal del 20 %.
- [ ] Confirmar una participación `lmsr_v1` y comprobar descuento, nuevo punto y Realtime.
- [ ] Provocar de forma controlada `PRICE_MOVED` y verificar recotización sin descuento doble.
- [ ] Comprobar mínimo 10, máximo 500, saldo insuficiente y posición duplicada.
- [ ] Comprobar la posición privada en «Mis predicciones».
- [ ] Anular un mercado de aceptación y confirmar devolución íntegra sin cambio de Prestigio.
- [ ] Probar acierto y fallo de `lmsr_v1` y `legacy_fixed_v1` en un entorno controlado separado.

No ejecutar estas operaciones sobre datos reales sin autorización expresa de Yol y un plan de limpieza.

## 8. Validación técnica del árbol final

- [x] `npm run validate`.
- [x] Sintaxis de los 21 archivos JavaScript.
- [x] 23 pruebas de economía, privacidad invitada, seguridad y marca.
- [x] TypeScript de Checkly.
- [x] `git diff --check`.
- [x] Búsqueda de `data.js`, fórmulas por recuento y `×10` nuevo revisada; las apariciones restantes son evidencia histórica, reglas vinculantes o pruebas de regresión.
- [x] Versión de caché `v=20260801-market2` coordinada en todos los recursos locales.
- [x] Diff completo revisado sin ZIP, secretos o archivos ajenos.

## 9. Condición de cierre

La migración, el frontend vivo y la limpieza `a5c633b` están activos. `data.js` devuelve 404, `market2` está renderizado y la aceptación móvil real ya se ejecutó. El mercado vivo solo queda técnicamente cerrado cuando la corrección responsive mínima de esta aceptación esté publicada y vuelva a comprobarse en GitHub Pages; si la publicación no puede automatizarse, esa es la única tarea manual previa. Después se vuelve al Paso 13.3 en Penpot y no se programa otro bloque funcional.
