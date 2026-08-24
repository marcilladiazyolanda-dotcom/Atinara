# Atinara · reconciliación de padres e hijas Radar v1

Última actualización: 24 de agosto de 2026.

## Estado

Implementación local candidata sobre `origin/main = 3d0db378d216c753635d066c86a31af24cf1fcea`.
Producción permanece sin cambios: `market-radar` v58 sigue activo con
`verify_jwt=true`, la migración de este documento no está aplicada y el primer
refresh durable V6 continúa sin ejecutarse. El E2E final de 13.5.2 permanece
pausado hasta que Yol suba el paquete incremental y se supere el postflight,
un único refresh productivo y el smoke visual autenticado.

## Causa raíz general

La durabilidad V6 acreditaba todas las filas que el runtime había reunido, pero
no acreditaba que esas filas fueran todas las hijas declaradas por el proveedor.
El manifest podía ser internamente coherente después de una paginación parcial,
un límite o una proyección legacy. A la vez, las vistas aceptaban snapshots
`atinara-radar-v2`/familia v4 por sus strings de versión y la elegibilidad
clasificaba una opción inactiva antes de resolver su identidad.

El resultado observable era una reducción silenciosa de 48 hijas de Polymarket
a 21 opciones nominales, con otras 27 filas `Game A`–`Game Z`/`another game`
presentadas como rechazos. Las 48 conservaban además una frontera `deadline:*`
como identidad categórica.

## Contrato vigente

Cada padre produce un snapshot append-only con:

- total declarado, descubierto, contabilizado, identificado y no resuelto;
- cerradas, eliminadas, duplicadas, conflictivas y nuevas;
- prueba de paginación agotada;
- versión y fingerprint de reconciliación;
- referencias a endpoints oficiales;
- incidencia enlazada al issue ledger cuando no está completo.

Cada hija queda exactamente en una clasificación permitida y separa:

- identidad (`identity_status`);
- disponibilidad (`availability_status`);
- etiqueta raw del proveedor;
- identidad canónica Atinara;
- IDs estables, fuente, confianza y evidencia.

`complete` solo es posible si la paginación está agotada, declarado =
contabilizado, no hay identidades pendientes o conflictos y toda hija legacy
está explicada. Una candidata visible/preparable requiere además normalizador
v3, proyección hija v1 y, para `categorical_outcomes`, una clave `option:*` y
una etiqueta no temporal.

La familia canónica nueva es `atinara-market-family-v5`: la extracción de hija,
la precedencia categórica y la proyección `option:<slug>` cambiaron
materialmente y un snapshot v4 no puede aparentar compatibilidad. Los triggers
v4 permanecen activos exclusivamente para expedientes legacy. Borrador,
Corrector, confirmación y publicación conservan v4 o v5 según el origen y
comparan siempre la hija exacta; nunca reinterpretan una v5 como v4.

## Resolución de placeholders

El runtime nunca usa posición alfabética, probabilidad, similitud semántica ni
IA. Para Polymarket consulta primero el market por `external_market_id` y, si
continúa provisional, el CLOB por `condition_id`. Conserva hashes y referencias
de cada respuesta. Kalshi conserva ticker/event ticker y el endpoint canónico
del padre/mercado.

Si un endpoint oficial demuestra una etiqueta real, esta sustituye solo la
proyección canónica; la etiqueta raw permanece en el ledger. Si todos los
endpoints oficiales continúan devolviendo el placeholder, no se inventa un
nombre: la hija queda `provider_placeholder_pending_resolution` y el padre
`incomplete_provider_metadata`, con próximo reintento.

La comprobación read-only del 23 de agosto enumeró 48 IDs/conditions únicos.
Veintiuna etiquetas nominales y la opción estructurada `Other` quedaron
identificadas; los 26 placeholders `Game A`–`Game Z` siguieron sin identidad
resolutiva en Gamma por evento/market, keyset y CLOB por condition/token. El
estado actual esperable es por tanto 48 declaradas, 48 contabilizadas, 22
identificadas y 26 pendientes, salvo que el proveedor cambie antes del refresh.
El fixture adversarial 21/27 se conserva porque prueba la regla general, no
porque sea una afirmación sobre el estado actual.

## Persistencia y seguridad

La migración `20260822205445_add_radar_parent_reconciliation_v1.sql`:

- crea dos tablas privadas append-only con RLS forzada y sin grants de tabla;
- liga el parent manifest al request/lease V6;
- recalcula todos los recuentos en SQL;
- compara cada occurrence del último snapshot durable y del baseline v2 por
  aliases estables —market, condition, token o slug fallback único—; el mismo
  cardinal no puede sustituir una hija legacy por otra;
- vincula cada candidata v3 al snapshot de padre y a su hija exacta;
- conserva el contrato estructural completo del proveedor como provenance, pero
  invalida el borrador solo por términos editoriales materiales —pregunta,
  reglas, fuente resolutiva y fechas—; un cambio de slug o URL de navegación no
  se confunde con un cambio contractual;
- añade hashes de integridad recalculados por SQL para padre e hija y rechaza
  timestamps futuros, hijos con `checked_at` incoherente y retries anteriores al
  snapshot;
- procesa y promueve todos los lotes candidatos dentro de una única transacción,
  por lo que ninguna familia parcial se hace visible entre lotes;
- amplía dentro de esa transacción el lease a 120 segundos, por encima del
  timeout RPC de 90 segundos, y revoca al service role los writers/finalizadores
  internos que permitirían saltarse el wrapper atómico;
- exige en preparación una instantánea fresca exacta de padre/hija; un rename o
  movimiento obliga a refrescar antes de renovar elegibilidad;
- proyecta la familia v5 sin colisionar con triggers v4 y conserva esa identidad
  en Editor, Corrector, borrador, confirmación y publicación;
- crea `list_market_radar_candidates_v4` y `list_market_radar_rejections_v2`;
- preserva candidatas/borradores legacy preparados, pero impide iniciar un
  borrador nuevo desde una fila v2;
- guarda una candidata v3 directamente mediante el writer canónico, liga la
  elegibilidad en la misma transacción y permite replay exacto sin un segundo
  borrador; Market Expert valida contrato/fuentes y delega una sola vez en ese
  writer, nunca en la implementación v2;
- reata una candidata v3 ya preparada al snapshot nuevo solo si la identidad
  fuerte y la opción canónica coinciden; una hija cerrada deja de ser apta,
  aunque continúa como rechazo real y contabilizado;
- vuelve a comprobar duplicados exactos V4/V5 bajo un lock canónico al preparar,
  guardar, confirmar y publicar; una coincidencia live persiste check, estado e
  incidencia, mientras una hermana legítima nunca se bloquea por slug o texto;
- no contiene backfill ni DML sobre mercados, borradores, predicciones,
  perfiles, Karma, Prestigio, LMSR o históricos de precio.

Los writers de Radar, Corrector, Validator, confirmación y publicación usan el
orden de concurrencia `candidate → advisory del workflow → draft → attempt`.
El scheduler conserva dos workers mediante claims `FOR UPDATE SKIP LOCKED`. Si
la respuesta se pierde después de guardar una eligibility check, el retry lee
el checkpoint por `attempt_id` y continúa sin repetir ninguna llamada al
proveedor.

Una reparación de pregunta, descripción o reglas no se autoaprueba por haber
cambiado texto: el checkpoint permite renovar la elegibilidad, pero la misma
incidencia pasa a `waiting`, owner `validator`, `request_market_validation`.
Solo una revisión de la versión material puede supersederla. URL y fechas se
comparan además de forma exacta con el contrato actual.

La finalización durable puede registrar correctamente un refresh cuyo proveedor
entregó un padre incompleto: «refresh completado» describe la ejecución, no
convierte el padre en `complete`. Solo la vista separada «Reconciliación del
proveedor» lo expone hasta su resolución.

## Interfaz

La administración ya no usa `family_child_label` como «opción del proveedor».
Muestra por separado etiqueta raw e identidad canónica, bloquea en profundidad
labels temporales y presenta una única ficha por padre incompleto. Las hijas sin
identidad no aparecen en «Rechazos vigentes». `Best Multiplayer` se localiza
determinísticamente como «Mejor multijugador»; una etiqueta desconocida conserva
el texto original y no se traduce heurísticamente.

## Evidencia local

- 548/548 pruebas unitarias.
- Property tests con 1, 3, 21, 48, 101 y 480 hijas.
- Placeholder resuelto/no resuelto, eliminado, duplicado, movido y renombrado.
- Ledger combinado de 300 hijas actuales y 200 retiradas históricas sin
  truncamiento; tombstones actuales y cierre legacy sin falsa identidad.
- Other, empate, sin ganador, inactividad, Unicode, apóstrofes, subtítulos,
  números, guiones, cursor pendiente y recuento inconsistente.
- `deno check` verde para las 9 Edge con la versión canónica Deno 2.1.14.
- Migración y test transaccional parseados por el parser PostgreSQL real.
- SQL estático 18/18; el test transaccional incluye rollback de dos batches,
  cobertura legacy por identidad, ACL y falsos `complete`. SQL dinámico sigue
  pendiente de una base desechable/local y no se presenta como ejecutado.
- Browser E2E 18 casos en 390/768/1366 px, incluidos 48/48 y 21/48, cero
  overflow y cero red externa.
- Ninguna inferencia Gemini ni mutación productiva.

## Activación pendiente después de la subida

1. `git fetch` y comparación exacta de rutas/contenidos con este paquete.
2. Esperar Actions, Pages, Sonar y puertas canónicas.
3. Repetir preflight/fingerprints productivos.
4. Aplicar solo la nueva migración y ejecutar postflight de owner, definer,
   `search_path`, ACL, RLS, constraints, índices, triggers y cero backfill.
5. Desplegar solo `market-radar` con `verify_jwt=true` y publicar el HTML/JS.
6. Ejecutar exactamente un refresh administrativo, sin Gemini.
7. Verificar intención, parent manifest, lotes, recuentos, finalización y replay.
8. Obtener el `N` actual de Polymarket y demostrar declarado = contabilizado,
   cero categóricas reales con `deadline:*` y UI coherente.
9. Solo si pasa, reanudar el E2E V6 desde el punto pausado.

La activación es migración → Edge dentro de una ventana administrativa corta y
con cero intenciones Radar activas. Entre ambos pasos el bundle v58 falla
cerrado porque sus writers antiguos ya no tienen `EXECUTE`; la web pública y la
economía no dependen de ese refresh. No se invierte el orden porque la Edge
nueva necesita RPCs que todavía no existen antes de la migración.
