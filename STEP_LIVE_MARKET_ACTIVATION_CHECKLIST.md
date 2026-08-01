# Activación coordinada · mercado predictivo vivo

Fecha de preparación y activación: 1 de agosto de 2026.

Estado: **migración aplicada y frontend productivo**. La migración `supabase/migrations/20260801172543_add_live_prediction_market_model.sql` ya se ejecutó una sola vez en producción y **no debe volver a ejecutarse**. Supabase la registra como `20260801184105_add_live_prediction_market_model`; la diferencia de hora corresponde al registro remoto, no a una migración distinta.

El frontend inicial se publicó en `f7aac42` con `v=20260801-market1`. El árbol final de limpieza elimina `data.js`, corrige las métricas ficticias que veía una invitada y coordina `v=20260801-market2`. La escritura automática devolvió `403 Resource not accessible by integration` en el primer intento y no se repitió; el commit remoto queda pendiente de publicación manual y su hash no debe inventarse.

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

Resultado del 1 de agosto de 2026, sin publicar identificadores personales:

- [x] 11 mercados.
- [x] 11 estados `market_maker_state`.
- [x] 11 puntos `market_price_history`, uno inicial por mercado.
- [x] 7 contratos `legacy_fixed_v1`, 5 activos.
- [x] 0 contratos `lmsr_v1` después de la aceptación de solo lectura.
- [x] Todos los estados y puntos cumplen `Sí + No = 100 %`.
- [x] Todos los estados mantienen `b = 2000 Karma`.
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
- [x] `approve-market-resolution` está activa, exige JWT válido y comprueba `app_metadata.oraklo_admin === true` antes de invocar la RPC protegida.

Los avisos de asesores sobre tablas con RLS sin políticas son informativos e intencionados porque no tienen permisos directos y se accede por RPC cerradas. Los avisos genéricos sobre RPC `SECURITY DEFINER` públicas incluyen superficies deliberadamente públicas; deben evaluarse por contrato, no silenciarse automáticamente. Los índices sin uso continúan siendo esperables con dos perfiles y poco tráfico. La protección nativa de contraseñas filtradas sigue no disponible en el plan actual y se complementa con el control HIBP por k-anonimato ya documentado.

## 5. GitHub Pages · aceptación invitada

Comprobado sobre la página realmente renderizada, no solo sobre el repositorio:

- [x] Portada, Comunidad, clasificación, un perfil público y una ficha real cargaron datos de Supabase.
- [x] HTML, CSS y JavaScript principales respondieron correctamente y la versión inicial fue `v=20260801-market1`.
- [x] Ningún HTML ni JavaScript cargó o referenció `data.js`.
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
- [ ] La inspección visual móvil real sigue pendiente: el navegador de aceptación rechazó el cambio de viewport y no debe afirmarse que una revisión estática lo sustituye.

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
- [ ] Eliminar expresamente `data.js` desde GitHub y confirmar esa eliminación en un commit.
- [ ] Publicar el resto del árbol final y registrar el hash remoto real de limpieza.
- [ ] Confirmar que `origin/main` contiene la eliminación.
- [ ] Confirmar que GitHub Pages devuelve 404 para `data.js` y sigue cargando datos reales.
- [ ] Repetir portada, ficha y consola sobre `v=20260801-market2`.
- [ ] Completar la comprobación móvil real sin desbordamiento ni acciones ocultas.

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

La migración y el frontend vivo están activos. El bloque de limpieza solo se cierra cuando el commit esté en `origin/main`, `data.js` devuelva 404, la versión `market2` esté realmente renderizada y la comprobación móvil real quede aceptada. Hasta entonces, el siguiente paso operativo sigue siendo terminar esta aceptación; después se vuelve al Paso 13.3 en Penpot y no se programa otro bloque funcional.
