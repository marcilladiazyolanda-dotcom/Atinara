# Atinara · checkpoint de discovery y cobertura temática del Radar

Fecha: 25 de agosto de 2026  
Base exacta: `addfc0b372bc45c572a843f3cec7893b3e41e06c`  
Estado: corrección incremental verificada en local y contra SQL real con
`ROLLBACK`; pendiente de integración y despliegue.

## Objetivo

Eliminar tres clases generales de fallo sin fabricar candidatas ni rebajar las
puertas de mercado:

1. Kalshi no debe fallar ni repetir todo discovery porque el índice completo y
   la enumeración exhaustiva de hijas no caben en una única invocación.
2. Radar debe reconocer el alcance gaming abierto de las categorías actuales de
   Atinara, sin aplazar siempre el mismo prefijo de series ni depender de una
   única consulta genérica.
3. Una pérdida de transporte o un 500 transitorio de lectura no debe dejar la UI
   en «Actualizando…», ofrecer una UUID terminal como reanudable ni iniciar una
   segunda intención.

La corrección no publica, confirma, resuelve ni liquida mercados. No modifica
Karma, Prestigio, LMSR, Auth, secretos, Registry V2.1, tareas, rutas, modos,
modelos, flags o presupuestos de IA. Radar continúa con cero inferencias.

## Evidencia productiva de partida

Producción permanece en `market-radar` v69, `ACTIVE`, `verify_jwt=true`, digest
`7d81a755520b527924679c1b9186801b51f462ba38c8e38725701abb39ee7265`.
Expert v26, Corrector v22, Validator v31 y Resolución v16 no cambiaron.

La UUID `39a1656e-61af-4674-a4e0-fa0896236507` terminó
`partial/terminal`, `claim_count=3`, con estas invariantes:

- 11 padres Kalshi y 148 hijas descubiertas, contabilizadas e identificadas;
- 9 padres `complete`, 2 `provider_unavailable`, 0 hijas sin identidad;
- parent manifest
  `c197e3ac8565ae36465023c59d942b2abcc949b98ca1a8fbbe717935e28c7428`;
- expected, staged, processed y accepted: 86;
- quarantined y failed: 0;
- manifest
  `7b9f65509641a3f3dc916a6d55168c61526100cc8b625821fcaab10aafc5e1bb`;
- dos batches raíz de 24 `superseded`, cuatro hijos de 12 completados y dos
  raíces de 24 y 14 completados;
- finalization
  `62d641016b4b91bc79047d2cf28ab8cf7722d117a8962a318f403b3eda504f6f`;
- Tavily `technical_failed`, `source_enrichment`, `blocking_scope=none`;
- 86 candidatas promovidas, ninguna elegible y ningún borrador nuevo.

Una lectura de catálogo inmediatamente posterior a la finalización devolvió un
500; otra lectura posterior devolvió 200. La UI mostró temporalmente el snapshot
anterior y «Continuar actualización», aunque la UUID ya era terminal.

## Auditoría de cobertura del proveedor

La taxonomía pública de Kalshi mostró dos scopes relevantes:

| Scope | Series |
|---|---:|
| Entertainment / Video games | 109 |
| Sports / Esports | 107 |
| Unión exacta | 215 |

El recorrido de las 215 series mediante el host recomendado
`external-api.kalshi.com`, concurrencia 2, cursor exhaustivo y backoff
exponencial terminó en 52.079 ms:

- 329 peticiones, incluidas 112 respuestas 429 reintentadas;
- 215/215 series completadas;
- 0 errores finales y 0 cursores repetidos;
- 515 padres abiertos únicos: 12 Video games y 503 Esports.

Un escaneo global de eventos no sustituye este recorrido: alcanzó 10.000 filas
y 50 páginas sin cursor terminal. La API de eventos admite un único
`series_ticker` por petición y los 429 no incluyen `Retry-After`; por tanto, la
paginación por serie y el backoff son parte del contrato, no una optimización
opcional.

La Edge v69 solo selecciona 25 series Video games y aplaza 84. Esas 84 vuelven a
quedar detrás del mismo orden en el siguiente refresh, y Esports ni siquiera
forma parte del alcance. No era una caída general de Kalshi: era truncamiento
temporal previo a un checkpoint durable y una cobertura temática incompleta.
La implementación inicial del checkpoint aislaba fallos por serie, pero todavía
podía derribar todo Kalshi si fallaba la consulta que enumera uno de los dos
scopes taxonómicos; esa frontera también queda aislada en esta entrega.

## Solución general

### 1. Checkpoint durable antes de enumerar hijas

La primera invocación de una UUID Kalshi:

1. consulta taxonomía Video games y Esports;
2. agota la paginación de series de ambos scopes y registra cualquier scope
   temporalmente fallido sin descartar el sano;
3. agota los eventos abiertos de cada serie con `with_nested_markets=false`;
4. conserva cada serie fallida sin derribar las sanas;
5. sella series, padres, fallos, timestamp y recuentos en
   `private.market_radar_provider_discovery_checkpoints_v1`;
6. libera el lease y responde 202 para continuar esa misma UUID.

La continuación reclama la UUID, carga el checkpoint y no repite el índice.
Reintenta únicamente los scopes y series que fallaron, aplica categoría, texto y
horizonte, equilibra las seis categorías Atinara cuando no existen filtros y
enumera un conjunto acotado de familias completas. Cada padre indexado queda en
`provider_selection`: seleccionado o diferido, nunca truncado silenciosamente.
Manifest, batches y finalización solo empiezan después de registrar selección y
ledgers de padres.

Si una o las dos consultas taxonómicas vuelven a fallar, la selección conserva
el inventario sano y declara `failed_taxonomy_scopes` y
`provider_scope_partial=true`. No lanza un fallo técnico global, no degrada
Tavily a proveedor de catálogo y no presenta un snapshot vacío como fresco.

Límites explícitos:

- 2.000 series y 2.000 padres indexados;
- 32 padres por ronda de enumeración;
- 24 padres y 240 hijas materializados;
- 480 hijas máximas por padre y por contrato de persistencia;
- 2 MiB de checkpoint y 1 MiB de selección durable.

La respuesta administrativa no duplica los hasta 2.000 IDs: devuelve recuentos,
confirmación de integridad del ledger y muestras de ocho IDs. El ledger privado
conserva el inventario íntegro para auditoría.

### 2. Polymarket por categorías actuales

Cuando no hay consulta textual ni categoría seleccionada, Polymarket ejecuta
seis búsquedas independientes:

- Lanzamientos: `video game release delay`;
- Eventos: `gaming event game awards`;
- Industria: `video game studio publisher`;
- Streamers: `gaming streamer Twitch`;
- Reviews/Premios: `video game Metacritic Game Awards`;
- YouTubers: `gaming YouTube creator`.

Los padres se deduplican por identidad fuerte antes de enumerar Gamma/CLOB. Una
búsqueda o padre fallido queda identificado y no elimina las familias sanas. La
consulta del usuario prevalece si existe; no hay títulos, series, eventos o IDs
concretos en producción.

### 3. Lectura y UI recuperables

`list_market_radar_candidates_v5` admite un único retry read-only de 500 ms para
HTTP 500, HTTP 504 o SQLSTATE 57014. Otros errores conservan su código y no se
ocultan como éxito.

El coordinador del navegador conserva una sola promesa y UUID por huella de
filtros. Si la petición de refresh pierde el transporte:

1. espera 500 ms;
2. ejecuta exactamente una lectura `discover` con `refresh=false`;
3. conserva «Continuar» y la UUID solo si Postgres sigue `in_progress`;
4. limpia el estado reanudable si la intención ya es terminal;
5. si también falla la lectura, conserva la UUID para un retry explícito.

Aplicar filtros o buscar nunca inicia refresh. Mientras la petición está activa
o existe una intención reanudable, cambiar sus filtros se detiene antes de crear
otra UUID. Solo un doble clic con la misma huella comparte la promesa; una huella
distinta falla cerrada. El botón se libera en `finally`; no existe doble submit
ni snapshot anterior presentado como fresco.

Los offsets de páginas de oportunidades y reconciliación no forman parte de la
identidad durable: son proyección de lectura. Navegar conserva y muestra la UUID
activa sin iniciar, interrumpir ni reemplazar el refresh.

La memoria de la pestaña conserva solo UUID y filtros de identidad mientras el
estado sea activo o ambiguo. Tras recargar restaura esos filtros y reconcilia por
lectura; nunca almacena JWT, credenciales, respuestas o payloads de proveedor y
se elimina al confirmar un estado terminal. Un 4xx determinista también la
limpia; únicamente red, 5xx o 429 conservan la UUID como resultado ambiguo.

## Contrato SQL y seguridad

La migración
`20260825223000_checkpoint_market_radar_provider_discovery_v1.sql`:

- crea una tabla privada con RLS forzada y sin grants de tabla;
- impide `UPDATE` y `DELETE` mediante trigger append-only;
- liga el checkpoint por FK a la intención exacta;
- valida versión, tipo JSON, timestamp, recuentos, unicidad, pertenencia de cada
  evento a una serie, IDs fallidos, tamaños y hash SHA-256;
- expone `checkpoint_market_radar_provider_discovery_v1`,
  `get_market_radar_provider_discovery_checkpoint_v1` y
  `record_market_radar_provider_selection_v2` solo a `service_role`;
- exige lease vigente en las tres rutas;
- acepta únicamente el adaptador Kalshi; Polymarket no puede introducir un
  payload Gamma/CLOB bajo el esquema de series y eventos Kalshi;
- no contiene backfill ni DML de datos de negocio.

La migración completa, incluido el postflight de RLS y ACL, se ejecutó contra el
PostgreSQL productivo dentro de una transacción cuyo `COMMIT` se sustituyó por
`ROLLBACK`. La consulta posterior confirmó `table_rolled_back=true` y
`function_rolled_back=true`.

## Pruebas verificadas

- Deno 2.1.14: `market-radar/index.ts` verde.
- JavaScript modificado: sintaxis verde.
- Focalizadas Radar/resumibilidad/padres: 153/153.
- Constructor ejecutable: 109 + 107 - 1 = 215 series, los dos scopes del
  solapamiento, 515 padres únicos y equivalencia JSON independiente del orden
  de claves.
- Regresión Radar→Expert/Editor/Corrector y UI: 232/232.
- Repetición final de las cinco suites afectadas: 183/183.
- SQL estático: 19/19.
- `git diff --check`: verde.

La matriz incluye binario, categóricas, 1/3/21/48/100+ hijas, hermanas,
duplicado cross-provider, placeholders resuelto e irresoluble, hija inactiva,
padre parcial, proveedor no disponible, resultado público con proveedor abierto,
fuente stale, timeout, segunda página perdida, cursor duplicado, Unicode,
apóstrofes, subtítulos, guiones, números, Tavily caído, reanudación, doble clic,
búsqueda vacía, `option:*` y categóricas cero con `deadline:*`.

## Activación después de integrar el ZIP exacto

1. Verificar el nuevo `origin/main`, el inventario y el contenido contra esta
   entrega; exigir Action «Calidad de Atinara», Pages y benchmark offline verdes.
2. Tomar baseline productivo de solo lectura y confirmar Radar v69, JWT y digest.
3. Aplicar una sola vez la migración `checkpoint_market_radar_provider_discovery_v1`.
4. Desplegar únicamente `market-radar` con `verify_jwt=true`.
5. Verificar versión nueva, estado `ACTIVE`, digest y fingerprints protegidos.
6. Ejecutar exactamente un refresh fresco Kalshi. La primera respuesta debe
   checkpointar; «Continuar» debe reutilizar la misma UUID.
7. Auditar por SELECT series, padres, fallos, hash del checkpoint, selección,
   ledgers, manifest, batches, intentos, procesados, aceptados, cuarentenas,
   fallos, finalización, estado terminal y replay.
8. Solo con una candidata gaming futura, hija explícita, padre completo,
   paginación agotada, fuente correcta, proveedor abierto, sin resultado público,
   sin duplicado y elegibilidad vigente, ejecutar Market Expert/Editor y crear
   exactamente un borrador privado. No publicar ni confirmar.

## Rollback

Si el despliegue falla antes de crear un manifest, no iniciar otra UUID: leer
checkpoint, lease, logs Edge/API/Postgres y eventos de refresh. La Edge anterior
puede volver a desplegarse sin tocar datos; el checkpoint nuevo es privado e
inerte para v69. No eliminar la tabla ni los ledgers como maniobra operativa.
Cualquier reversión de esquema debe prepararse como migración nueva y aditiva,
nunca mediante DML manual o edición de una migración ya aplicada.

## Riesgos residuales antes del smoke

- La latencia real de 215 series depende de los 429 de Kalshi; el heartbeat y el
  checkpoint eliminan la pérdida de progreso, pero el tiempo exacto debe medirse
  tras desplegar.
- Los padres diferidos quedan auditados y filtrables, no materializados todos en
  una sola ronda. Esto protege el límite de 135 s y 480 candidatas, pero exige
  comprobar que categoría y búsqueda seleccionan el padre esperado.
- Polymarket puede devolver resultados distintos por consulta temática; la
  deduplicación y los fallos parciales están probados, pero Gamma/CLOB deben
  verificarse en el E2E productivo si la candidata final procede de ese proveedor.
- El objetivo no está terminado hasta crear exactamente un borrador privado
  nuevo con candidate ID, eligibility check, source binding, identidad hija,
  versión, fingerprint e issue ledger coherente.
