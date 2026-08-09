# Paso 13.5.2 · Observatorio de datos y agentes de mercado

Fecha de preparación original: 7 de agosto de 2026. Último endurecimiento: 9 de
agosto de 2026.

Estado vigente: **backend B2B activado y frontend coordinado en este árbol**.
Supabase conserva las puertas factuales, de revisión y de fuentes primarias; los
schedulers opcionales de descubrimiento y monitorización siguen desactivados.
El frontend de este árbol aún no está fusionado en `main`, por lo que GitHub
Pages continúa sirviendo la versión anterior hasta que el PR supere sus checks.
El smoke visual con una sesión administrativa real continúa pendiente y nunca
debe crear, confirmar, publicar, predecir ni resolver un mercado.

## 1. Fronteras del sistema

El Paso 13.5.2 añade tres capacidades privadas y deliberadamente separadas:

1. **Observatorio de Datos y tendencias.** Descubre entidades y señales de
   IGDB, Twitch y YouTube. Su almacenamiento, caché y auditoría no reutilizan
   `external_market_candidates`.
2. **Agente Editor compartido.** Analiza una candidata del Radar o una señal del
   Observatorio con la misma Constitución, validadores y salida estructurada.
   Puede proponer, editar, rechazar, declarar obsoleto, fusionar duplicados o
   escalar. No guarda ni publica un mercado.
3. **Agente Centinela de fuentes.** Versiona contratos y snapshots para ayudar a
   resolver un mercado. Reúne evidencia, pero nunca elige ni liquida un
   resultado sin confirmación humana.

El diseño original conservaba `atinara-radar-v2` y la política
`atinara-prediction-policy-v3`. El endurecimiento del 9 de agosto de 2026 eleva
la política factual a `atinara-prediction-policy-v4`; no cambia el principio de
separación entre Radar, Observatorio y agentes ni repite migraciones aplicadas.

## 2. Constitución y contratos versionados

La lógica común vive en
`supabase/functions/_shared/market-intelligence/` y expone:

- Constitución: `atinara-market-constitution-v1`.
- Dictamen experto: `atinara-market-expert-v1`.
- Descubrimiento contextual: `atinara-context-discovery-v1`.
- Contrato de resolución: `atinara-resolution-contract-v1`.
- Roles de fuente: `PRIMARY_RESOLUTION`, `FALLBACK_RESOLUTION`,
  `CONTEXT_SOURCE` y `PROHIBITED_FOR_RESOLUTION`.

La validez contractual se evalúa aparte de la probabilidad. Una opción muy poco
probable puede seguir siendo íntegra si es objetiva, binaria, temporalmente
coherente y resoluble. Un titular, rumor o probabilidad externa solo aporta
contexto; no se convierte silenciosamente en fuente de resolución.

La entrada externa se trata como no confiable. El agente solo puede usar las
herramientas registradas, rechaza URLs arbitrarias, no ofrece SQL y valida una
salida JSON limitada. No se guardan prompts internos, secretos, cadena de
pensamiento ni trazas de razonamiento.

## 3. Proveedores y privacidad

| Proveedor | Uso | Credenciales | Ausencia o fallo |
|---|---|---|---|
| IGDB | juegos, lanzamientos, compañías, plataformas | Twitch Client ID/Secret | `no configurado`; no bloquea otros proveedores |
| Twitch | búsqueda de canales, juegos destacados y directos públicos | Twitch Client ID/Secret | error aislado; un directo offline no se inventa como cero |
| YouTube | canales, playlist de uploads, vídeos y emisiones públicas | YouTube API key | cuota/ocultación/ausencia quedan explícitas |
| Tavily | contexto público limitado | secreto ya existente | contexto no disponible; no invalida por sí solo una señal |
| Gemini | dictamen estructurado | secreto ya existente | fallo cerrado y reintento; no rompe el proveedor origen |

Los valores `TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET` y `YOUTUBE_API_KEY`
nunca se escriben en el frontend, migraciones, documentación o registros. El
token OAuth de Twitch se conserva únicamente en memoria de la instancia y se
renueva tras expiración o un 401.

YouTube usa una política conservadora: `subscriberCount` puede estar oculto y,
cuando existe, se trata como redondeado; no se mezclan métricas de plataformas,
no se comparan personas y no se fabrican rivalidades. Los datos efímeros tienen
retención acotada y la purga solo actúa después de su vencimiento.

## 4. Flujo administrativo

El orden de pestañas de `Gestionar mercados` es:

1. Crear manualmente.
2. Radar de mercados.
3. Datos y tendencias.
4. Mercados publicados.
5. Auditoría.

`Datos y tendencias` presenta estado de proveedores, búsqueda manual,
watchlist, señales, contexto, arcos e hipótesis. `Preparar borrador` solo lleva
un pre-rellenado al formulario. Los campos no demostrados permanecen vacíos y
solo la acción humana `Guardar borrador privado` persiste el borrador.

Al guardar una propuesta del Observatorio se registra su origen y el dictamen
experto en la misma transacción que crea el borrador: si el binding falla, el
borrador tampoco queda creado como si fuera manual. El plan de resolución se
valida y bloquea por versión y hash. Cambiar
el contrato crea una versión nueva; la anterior no se reescribe.

El guardado registra también si Yol aceptó la propuesta o qué campos corrigió.
Ese feedback no cambia la Constitución, no altera dictámenes anteriores y no
crea un precedente por sí solo. La promoción utiliza la acción administrativa
separada `promote-precedent`, exige título, tipo y explicación, y cada feedback
solo puede promoverse una vez.

La puerta de publicación solo se aplica a borradores vinculados a inteligencia:
exige un plan vigente y, si necesita capturas automáticas, un monitor armado.
Los borradores manuales sin binding no cambian de contrato.

## 5. Descubrimiento editorial

El botón manual `Descubrir oportunidades` funciona con el scheduler apagado.
Recupera contexto público acotado, prioriza una fuente oficial cuando es
posible, aplica cooldown y presupuesto y puede devolver cero hipótesis. Una
hipótesis conserva `market_thesis`, `why_now`, base factual, base contextual,
inferencia, cuestión pendiente y camino de resolución.

Los patrones `MILESTONE_WITH_NARRATIVE` y
`SCHEDULED_REVEAL_WITH_UNKNOWN_CONTENT` son generalizables: los nombres de los
fixtures no existen en la lógica de producción. El descubrimiento automático,
cuando Yol decida activarlo, solo procesa entidades seguidas cuyo escaneo esté
vencido. Crea o actualiza contexto, arcos e hipótesis privadas; nunca crea un
borrador, publica, aprueba o resuelve.

## 6. Monitor de fuentes y resolución humana

Un binding pasa por `draft → validated → armed → monitoring`. `validated`
significa que el contrato y sus fuentes son coherentes. `armed` solo es posible
cuando Yol ha habilitado por separado el scheduler y el proveedor necesario
consta configurado.

El monitor admite captura puntual, snapshot al límite, polling acotado y
presencia de evento. Los intervalos, duración y retención se validan antes de
armar. Cada snapshot es inmutable. `missing`, timeout, cuota, 401 persistente,
429, esquema cambiado o evidencia contradictoria generan incidencia; nunca un
resultado implícito.

El expediente de evidencia es versionado y conserva fuentes, cronología,
agregación y calidad. Incluso `ready_to_resolve` significa únicamente que hay
material para la revisión. La administradora sigue seleccionando Sí, No o
Anulado y ejecutando la confirmación protegida existente.

## 7. Migración y funciones preparadas

Aplicar una sola vez, después de revisar y subir el árbol:

`supabase/migrations/20260807163000_add_data_observatory_and_market_intelligence.sql`

La migración crea tablas privadas con RLS forzado, RPC con permisos mínimos,
auditoría, deduplicación, retención y la puerta aditiva de fuentes. No ejecuta
ni duplica las migraciones LMSR o Radar ya aplicadas.

Edge Functions nuevas, todas con `verify_jwt=true`:

- `market-expert`.
- `data-observatory`.
- `market-source-monitor`.

## 8. Configuración manual de secretos

Comprobar primero que `GEMINI_API_KEY` y `TAVILY_API_KEY` siguen configuradas,
sin mostrar, rotar ni copiar sus valores. Configurar solo si faltan:

```text
TWITCH_CLIENT_ID
TWITCH_CLIENT_SECRET
YOUTUBE_API_KEY
```

Los valores se introducen exclusivamente en Supabase Secrets o en el panel de
secretos del proyecto. No se guardan en `.env`, SQL, GitHub, capturas o chat.
El archivo `supabase/functions/.env.example` contiene únicamente nombres vacíos.

## 9. Schedulers preparados y desactivados

La migración crea estos ajustes en `false`:

```text
context_discovery_scheduler_enabled = false
source_monitor_scheduler_enabled = false
```

Son independientes. El primero llama a `data-observatory` con
`run-context-discovery-due`; el segundo llama a `market-source-monitor` con
`capture-due`. Ambos deben usar una credencial de servicio almacenada en
Supabase Vault, nunca escrita literalmente en la migración o en Cron. Mantener
`verify_jwt=true`.

La activación futura debe realizarse en dos decisiones separadas:

1. Crear cada job de Cron con su nombre y expresión revisados.
2. Guardar la URL del proyecto y el JWT de servicio en Vault.
3. Probar manualmente una invocación y revisar auditoría/consumo.
4. Cambiar a `true` únicamente el ajuste correspondiente.
5. Confirmar que el scheduler editorial solo persiste contexto privado y que el
   de resolución solo captura evidencia.

No se incluyen comandos con credenciales ni se activa ningún job en esta
entrega.

## 10. Orden histórico de activación manual

Esta secuencia documenta la activación original del Observatorio. Está
superada por el corte productivo de la sección 13 y no debe reutilizarse para
repetir migraciones o Edge Functions ya activas.

1. Subir a GitHub el contenido descomprimido del ZIP.
2. Confirmar las migraciones ya aplicadas.
3. Aplicar únicamente la nueva migración `20260807163000...`.
4. Comprobar sin revelar valores que Gemini y Tavily siguen disponibles.
5. Configurar, solo si faltan, los tres secretos de Twitch/YouTube.
6. Desplegar `market-expert` con verificación JWT.
7. Desplegar `data-observatory` con verificación JWT.
8. Desplegar `market-source-monitor` con verificación JWT.
9. Revisar los estados de proveedor y las versiones de política.
10. Probar el Agente Editor con una candidata del Radar y una señal privada.
11. Probar manualmente IGDB, Twitch y YouTube sin publicar nada.
12. Ejecutar `Descubrir oportunidades` sobre una entidad seguida.
13. Confirmar que solo se crean contexto, arcos e hipótesis privadas.
14. Validar un contrato y comprobar que queda `validated` sin capturas.
15. Activar el scheduler editorial solo tras aprobación expresa de Yol.
16. Activar por separado el scheduler de resolución tras otra aprobación.
17. Armar un binding de prueba desde la acción administrativa.
18. Comprobar captura, incidencia y expediente sin ejecutar liquidación.
19. Revisar costes, cuotas, cooldown, retención y auditoría.
20. Confirmar que ningún scheduler publica ni resuelve automáticamente.

## 11. Fotografía histórica de validación y smoke tests pendientes

Esta sección conserva la fotografía del 7 de agosto y queda superada por la
validación vigente de la sección 13. En aquella entrega se comprobó localmente:

- sintaxis de 57 archivos JavaScript;
- 153 pruebas unitarias, incluidas 36 específicas de inteligencia de mercados;
- tipado de Checkly;
- parseo TypeScript de las tres Edge Functions y del runtime compartido;
- versión coordinada `v=20260807-observatory-intelligence1` en los diez HTML;
- separación del Radar, privacidad, autorización, inmutabilidad, ausencia frente
  a cero, contrato de fuentes, prompt injection y no resolución automática.

En aquella entrega quedaban pendientes de activación y smoke test real:

- disponibilidad y cuotas reales de IGDB, Twitch, YouTube, Tavily y Gemini;
- aplicación de la migración y permisos efectivos en Supabase;
- despliegue con `verify_jwt=true`;
- captura remota, Vault y jobs programados;
- validación visual pública posterior a la subida manual.

Estas comprobaciones pendientes no se presentan como superadas. Ningún smoke
test debe crear mercados públicos, predicciones o resoluciones reales.

## 12. Alcance original preservado — fotografía histórica

No se ha modificado el LMSR, el contrato `legacy_fixed_v1`, la migración viva,
predicciones, mercados, Karma, Prestigio, autenticación, publicación programada,
Radar v17 ni proveedores externos. No hay catálogo de 24–36 mercados, scraping
global, redes sociales nuevas, dinero real o resolución autónoma por IA.

## 13. Endurecimiento B2B activado el 9 de agosto de 2026

Este añadido registra el estado vigente y prevalece sobre las instrucciones de
activación manual de las secciones anteriores:

- El proveedor externo es una fuente de descubrimiento, no la autoridad sobre
  si un hecho continúa abierto. La elegibilidad requiere una puerta factual
  independiente antes de puntuar y antes de preparar.
- `market-radar` v26 conserva el evento canónico completo para evaluar hijos
  abiertos, cerrados y resueltos. Una respuesta cacheada no devuelve propuestas
  y una candidata solo puede avanzar con una comprobación factual v2 vigente,
  inmutable y ligada a su revisión y sus huellas.
- Una fuente primaria que demuestre una selección completa puede cerrar la
  familia aunque el proveedor mantenga contratos abiertos. Evidencia parcial,
  secundaria, modal o contradictoria degrada a revisión; Tavily y Gemini no
  originan por sí solos un estado terminal ni `verified_open`.
- La identidad de familia v4 separa invariantes y eje variable. Los mercados de
  distintos meses son hermanos independientes y un número incidental dentro de
  las reglas no los convierte en el mismo umbral. Dos fronteras no ambiguas con
  el mismo instante UTC son el mismo hijo aunque una use ET y otra UTC.
- `market-draft-fixer` v7 y `validate-market-draft` v8 comparten una taxonomía
  cerrada de incidencias y constructores para los diez arquetipos admitidos. El
  Corrector repara lo deducible, investiga lo verificable y escala con estado
  estructurado lo que no puede demostrar; nunca inventa fuente, métrica,
  agregación, sujeto, predicado o ancla temporal.
- Las fuentes primarias del Corrector deben estar registradas para rol y
  categoría, ser alcanzables mediante redirecciones seguras y demostrar en el
  cuerpo identidad y predicado. La administración B2B del registro usa RPC
  auditadas y no expone DML directo.
- El corte de migraciones local `120000 → 133000 → 140000 → 145000 → 150000 →
  160000 → 170000` ya está aplicado. La `140000` fue reconciliada mediante el
  preflight material de `145000` y no debe ejecutarse de nuevo. El mapeo exacto
  de versiones remotas está fijado en `ORAKLO_PROJECT_CONTEXT.md`.
- `market-radar` v26, `market-draft-fixer` v7,
  `validate-market-draft` v8 y `market-expert` v11 están desplegadas con JWT
  obligatorio y su contenido remoto coincide con el árbol local.
- Tras la aplicación se mantuvieron exactamente 15 mercados, 9 predicciones, 2
  perfiles, 2027 Karma total y 40 Prestigio total. Cinco falsas duplicidades de
  tráiler se reclasificaron como hijos mensuales `sibling`; las filas ya
  preparadas se preservaron y dejaron de aparecer como rechazos vigentes.
- La política v4 caducó las 22 opciones FC27 que conservaban una aprobación v3:
  dejaron de ser propuestas aptas. El siguiente ciclo administrativo deberá
  recuperar la fuente oficial y guardar el dictamen terminal; el estado abierto
  del proveedor no puede rehabilitarlas.
- Confirmar, programar, publicar y materializar vuelven a exigir una
  revalidación factual vigente. Un borrador Radar no puede desligarse de su
  procedencia para eludir la puerta; el bridge heredado de `145000` solo enlaza
  después de una revalidación fresca y nunca confirma ni publica.
- La validación local completa terminó con sintaxis de 67 archivos JavaScript,
  287 pruebas unitarias, TypeScript, monitorización y `git diff --check`.
- El smoke visual autenticado sigue pendiente porque no hubo una sesión gráfica
  administrativa controlable. Debe limitarse a revalidar y aplicar el Corrector
  al borrador privado de Marvel y lanzar un ciclo explícito del Radar, sin
  confirmar ni publicar. No repetir migraciones ni despliegues para realizarlo.
