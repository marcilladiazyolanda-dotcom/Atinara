# Instrucciones permanentes de Atinara · nombre interno Oraklo

## Antes de empezar cualquier tarea

1. Lee `ORAKLO_PROJECT_CONTEXT.md` y `README.md` completos. Para economía, predicción o Penpot lee también `LIVE_MARKET_ECONOMY.md` y `STEP_13_3_LIVE_MARKET_PENPOT_OVERRIDES.md` antes de actuar.
2. Inspecciona `git status`, la rama actual, los últimos commits y la diferencia con `origin/main` antes de editar.
3. Conserva cualquier cambio local o remoto que no pertenezca a la tarea. No uses comandos destructivos para sincronizar.
4. No repitas funcionalidades que el contexto marque como terminadas. Si el código y el documento discrepan, comprueba el código y explica la discrepancia.
5. Espera a que la usuaria indique el siguiente resultado que quiere. No inicies por tu cuenta una fase nueva del roadmap.

## Producto y tono

- Atinara es la marca pública de la red social competitiva de predicciones sobre videojuegos y el ecosistema gaming. `Oraklo` se conserva únicamente en infraestructura, historial e identificadores técnicos existentes.
- Karma es el saldo ficticio para participar; Prestigio es la reputación histórica y determina el rango.
- No hay dinero real, pagos, compra de Karma ni Modo Real.
- La interfaz debe sentirse como un mercado predictivo premium, sofisticado, claro e intuitivo. Puede adoptar patrones familiares de descubrimiento y acción de Polymarket o Kalshi, pero nunca copiar sus pantallas, activos o identidad. La marca, los componentes y el lenguaje visual deben ser propios de Atinara y evitar cualquier estética o lenguaje de casino, dinero real, cripto o esports genérico.
- Ningún texto, título, metadato o mensaje visible para usuarias debe presentar `Oraklo` como marca. La marca pública se escribe **Atinara** y en logotipo puede escribirse **ATINARA**.
- Las predicciones activas y el Karma disponible son privados. El perfil y las predicciones liquidadas sí pueden ser públicos.
- No inventes usuarios, métricas, actividad, comentarios ni resultados. La interfaz debe reflejar datos reales de Supabase o estados vacíos honestos.
- La interfaz y los mensajes para la usuaria deben estar en español, ser claros y evitar errores técnicos crudos.

## Arquitectura y seguridad

- Frontend estático compatible con GitHub Pages: HTML, CSS y JavaScript sin proceso de compilación.
- Backend: Supabase Auth, Postgres/RLS, RPC y Edge Functions.
- Nunca pongas claves, `service_role`, `GEMINI_API_KEY` o `TAVILY_API_KEY` en el frontend o en el repositorio.
- Las operaciones económicas o de liquidación deben ser atómicas y autoritativas en Supabase. El frontend solo ayuda a validar y mostrar mensajes.
- No insertes directamente en `predictions` desde el frontend: usa `place_prediction`.
- El mercado vivo usa una cotización LMSR versionada. El precio medio, impacto, contratos, retorno base, bonus y Prestigio se calculan en servidor; si la versión cambia, la usuaria debe revisar una nueva cotización.
- Durante la beta no hay venta, salida anticipada, cambio de posición, cobertura, libro de órdenes ni mercado secundario. Solo se reevaluarán después de la beta y no están prometidos.
- No expongas funciones de resolución protegidas a clientes públicos. La resolución requiere administradora autenticada y confirmación humana.
- La IA investiga y propone; nunca liquida por sí sola.
- Ningún mercado puede publicarse o programarse como público sin una validación automática vigente de claridad, coherencia y resolubilidad ejecutada y comprobada en servidor. Un rechazo debe mantenerlo privado, explicar los motivos y no admitir omisión administrativa; cualquier cambio esencial exige repetir la revisión.
- Las temporadas están preparadas, pero deben permanecer desactivadas hasta alcanzar el umbral de usuarios y recibir activación administrativa explícita.

## Forma de trabajar acordada

- Un único implementador por tarea. No coordines dos agentes editando los mismos archivos simultáneamente.
- Inspecciona antes de cambiar y mantén el alcance pedido. No añadas funciones futuras sin autorización.
- Usa migraciones SQL versionadas para cambios de esquema y documenta qué debe ejecutar manualmente la usuaria.
- Al completar un hito importante, actualiza `ORAKLO_PROJECT_CONTEXT.md` para que el siguiente chat no dependa del transcript.
- La usuaria suele ejecutar SQL/secretos en Supabase y subir manualmente a GitHub el contenido de un ZIP completo.
- No hagas `push`, despliegues ni mutaciones externas salvo petición expresa.
- Tras cambios JavaScript ejecuta comprobación de sintaxis. Revisa también estructura CSS/HTML, rutas, flujo afectado y `git diff --check`.
- Para cambios visuales, verifica escritorio y móvil en proporción al riesgo. Mantén el versionado de recursos para evitar caché antigua de GitHub Pages.
- Entrega un commit claro y, cuando se solicite publicación manual, un ZIP del repositorio completo; no solo los archivos modificados.

## Criterios que nunca deben romperse

- Auth, cabecera y actualización de perfil real.
- Descuento real de Karma al confirmar y persistencia tras recargar.
- Contador basado en `closes_at`, cierre automático visual y bloqueo de predicción tras el vencimiento.
- Resolución atómica con devolución/retorno y Prestigio nunca inferior a 0. Las posiciones nuevas `lmsr_v1` liquidan cada contrato acertado a 1 Karma más el bonus de dificultad separado y no tienen el antiguo tope `×10`; las posiciones anteriores `legacy_fixed_v1` conservan ese límite y todas sus condiciones originales.
- Mercados anulados: devolución íntegra del Karma y sin cambio de Prestigio.
- Los precios `Sí` y `No` suman 100 %, solo se mueven por participaciones confirmadas y su histórico nunca se rellena con fluctuaciones simuladas.
- Fuentes de resolución visibles, verificables y anteriores al cierre.
- Pregunta, opciones, criterios, periodo, fecha de cierre y fuentes coherentes antes de publicar; los mercados ambiguos o no resolubles permanecen como borradores privados.
- Ranking y perfiles basados en datos reales; predicciones activas nunca públicas.
- Compatibilidad con GitHub Pages.

## Próxima fase conocida

- Paso 9 (rangos, clasificación y temporadas dormidas): terminado.
- Paso 10 y 10B (currículum predictivo, personalización y menú de cuenta): terminado en la rama de trabajo local.
- Paso 11 (comentarios, seguimiento, feed, reacción y moderación): terminado, desplegado y aceptado.
- Paso 11C (protección gratuita de contraseñas filtradas): publicado y validado el 30 de julio de 2026.
- Paso 12 (calidad y observabilidad): terminado, publicado y comprobado con SonarQube Cloud, GitGuardian, Checkly y Sentry.
- Cambio de marca pública: aprobado el 31 de julio de 2026. Atinara sustituye a Oraklo en toda la superficie pública; los contratos técnicos internos no se renombran.
- Paso 13.1 (auditoría funcional): cerrado el 1 de agosto de 2026.
- Paso 13.2 (prioridades y criterios): aprobado con correcciones en `STEP_13_2_PRIORITIES_ACCEPTANCE.md`. P0, P1 y P2 son requisitos completos antes de abrir la beta.
- El mercado vivo se activó en producción el 1 de agosto de 2026. La migración `20260801172543_add_live_prediction_market_model.sql` ya fue aplicada una sola vez y **no debe volver a ejecutarse**. El frontend inicial se publicó en `f7aac42`.
- La activación conservó las 7 predicciones anteriores como `legacy_fixed_v1`, mantuvo sin cambios los saldos agregados y creó 11 estados LMSR y 11 puntos históricos iniciales para 11 mercados. La aceptación posterior no creó ni modificó predicciones.
- `data.js` fue eliminado de `main` en `4ccd97e` y la limpieza completa se publicó en `a5c633b`. GitHub Pages sirve `v=20260801-market2`, la URL pública de `data.js` devuelve 404 y las invitadas ya no ven Karma, Prestigio ni rango provisionales.
- La aceptación pública de escritorio quedó superada. La aceptación móvil real se ejecutó en 320 × 568, 375 × 667, 390 × 844 y 768 × 1024 sobre portada, Comunidad, clasificación, perfil público y fichas abierta y resuelta. Detectó dos desbordamientos reales —el mínimo raíz de 320 px y las URLs largas de una resolución—; el árbol de cierre los corrige de forma mínima en `styles.css` y la comprobación visual local posterior supera las seis superficies a 320 y 375 px.
- Una nueva consulta administrativa exclusivamente de lectura confirmó 11 mercados, 11 estados LMSR, 11 puntos iniciales, 7 contratos `legacy_fixed_v1` —5 activos— y 0 `lmsr_v1`; versiones, probabilidades, RPC, privacidad y resolución administrativa siguen protegidas. No se creó ni modificó ninguna predicción.
- Paso 13.3 continúa en Penpot. La Fase A neutral debe corregirse con `STEP_13_3_LIVE_MARKET_PENPOT_OVERRIDES.md`; ese documento y `LIVE_MARKET_ECONOMY.md` sustituyen cualquier supuesto anterior sobre porcentajes por recuento, gráfica estática o límite general `×10`.
- Tras publicar y comprobar en GitHub Pages la corrección móvil mínima del árbol de cierre, el siguiente paso vuelve a ser el Paso 13.3 con Yol: logo, paleta, tipografías, iconografía, retícula, componentes, avatares, emblemas, movimiento y responsive. No se programa otro bloque funcional.
