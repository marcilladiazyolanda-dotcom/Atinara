# Atinara · catálogo Kalshi completo y discovery durable por series

Fecha: 26 de agosto de 2026
Base exacta: `8025df43e898280d06c88c70c43a26dc8acba472`
Estado actualizado el 27 de agosto: integrada en `a6152a7`; migración aplicada
una sola vez como `20260827150224`; `market-radar` v75 desplegado. El primer
refresh V2 queda pausado en su misma UUID por un límite de recursos del worker;
la corrección completa de lectura, análisis y hash está preparada localmente y
pendiente de subida.

## Actualización productiva · 27 de agosto de 2026

La activación respetó el orden previsto: Actions verdes, baseline de solo
lectura, migración V2 una vez y despliegues exclusivos de Radar con JWT. La Edge
actual es v75, digest
`7a831f3ce6b91480515b82f0f3c74a1aaf2e8e62160ae2a650a75e54f9372555`.
Las demás Edge y los datos protegidos no cambiaron.

El único refresh nuevo es
`39bc204b-aa3f-4a69-99da-557f5fa91f7d`. Después de v73 y una reanudación por
versión con v74 y v75 conserva dos intenciones `in_progress/claimed`,
`claim_count=4`,
cero checkpoints V2, cero batches y cero manifest. Las invocaciones de escritura
terminaron HTTP 546; las lecturas de recuperación conservaron la UUID y no se
abrió otra. No debe reanudarse con v75.

V75 conservó el análisis único y el hash incremental de la primera corrección,
pero el perfil usado para aprobarla omitía lectura, decodificación y parse del
body. La ruta completa todavía consumía aproximadamente 2.407 ms CPU y 285 MB
RSS sobre 13.559 series, por encima de 2 s y 256 MB. La corrección
`ATINARA_RADAR_CATALOG_WORKER_LIMIT_V2_FIX_20260827` usa parse JSON nativo sobre
un stream acotado, máscaras compactas y una proyección V2 de tuplas. Dos lecturas
posteriores de 13.561 series y 17.306.369 bytes conservaron 84 términos y 416
seleccionadas, cursor terminal, 1.501–1.563 ms CPU y 166 MB RSS máximo en Node.
Este addendum prevalece sobre las instrucciones históricas de activación que
siguen abajo como registro del diseño original.

## Objetivo

Hacer que una sola UUID de Radar pueda encontrar los padres relacionados con
las seis temáticas actuales de Atinara y avanzar de forma durable aunque el
catálogo o una serie sufran rate limit, timeout, indisponibilidad o pérdida de
transporte. Un fallo técnico acotado no puede convertir todo Kalshi en fallo
terminal, borrar progreso sano ni presentar un snapshot anterior como fresco.

La entrega no publica, confirma, resuelve ni liquida mercados. No modifica los
seis borradores existentes, Karma, Prestigio, LMSR, Auth, secretos, Registry
V2.1, AI Gateway, tareas, rutas, modos, modelos, flags o presupuestos. Radar
continúa sin Gemini ni ninguna otra inferencia.

## Estado de partida protegido

`origin/main = 8025df43e898280d06c88c70c43a26dc8acba472` contiene exactamente
la corrección de continuidad de evidencia oficial que partía de `58e47a8`; su
Action Calidad de Atinara, Deno, Pages y benchmark offline están verdes. Esa
corrección todavía no está desplegada.

Producción conserva `market-radar` v72, `ACTIVE`, `verify_jwt=true`, digest
`5e95a578528355f92ced016d8aa1c5523d1931f00942d44679942f7d809d9116`.
Expert v26, Corrector v22, Validator v31 y Resolución v16 no cambiaron. Los seis
borradores y las huellas protegidas permanecen intactos.

La última UUID terminada,
`c1f677eb-0dae-410f-820d-a4483601ab47`, recorrió 215/215 series de las dos
taxonomías legacy, indexó 590 padres, materializó 24 padres completos y
192/192 hijas, y procesó 162/162 candidatas sin cuarentenas ni fallos. La
candidata observada después quedó stale al corregirse su identidad familiar;
dos intentos de preparación terminaron con `ELIGIBILITY_SCAN_UNAVAILABLE`. No
hubo tercer intento, Market Expert ni borrador nuevo.

## Causa raíz general

Kalshi no ofrece búsqueda textual de series. Las consultas anteriores
Entertainment/Video games y Sports/Esports demostraban exhaustividad solo para
su taxonomía, no para videojuegos clasificados por Kalshi bajo tecnología,
negocio, entretenimiento general, cultura, creadores u otras categorías. Un
escaneo global de `/events` tampoco era sustituto: alcanzaba el límite de 50
páginas con cursor pendiente.

Aunque se ampliara la selección, consultar cientos de series y todos sus
cursores dentro de una invocación volvería a unir cobertura funcional con un
límite temporal. Sin un checkpoint antes de manifest, una pérdida de transporte
obligaría a repetir catálogo y discovery sano; una caída global o de una serie
podría impedir que las demás alcanzaran padres, hijas y finalización.

La clase general es, por tanto, doble:

1. discrepancia entre la taxonomía del proveedor y las temáticas de producto;
2. ausencia de una frontera durable entre el catálogo completo y el recorrido
   temporalmente acotado de sus series.

No depende de un ticker, título, serie, mercado o evento conocido.

## Evidencia live del catálogo oficial

Una lectura de solo proveedor de
`/trade-api/v2/series?include_product_metadata=true&include_volume=true`
produjo:

| Evidencia | Resultado |
|---|---:|
| HTTP | 200 |
| Cursor terminal | `null` |
| Bytes leídos | 17.181.274 |
| Series totales | 13.486 |
| Tickers únicos | 13.486 |
| Términos de entidad derivados | 83 |
| Series seleccionadas | 410 |
| Con taxonomía Video games/Esports | 217 |
| Fuera de esa taxonomía | 193 |
| Seleccionadas solo por relación de entidad | 91 |
| Omisiones del control léxico amplio | 0 |

La categoría Atinara inferida distribuyó las 410 series así:

| Categoría | Series |
|---|---:|
| Lanzamientos | 25 |
| Eventos | 115 |
| Industria | 152 |
| Streamers | 12 |
| Reviews/Premios | 97 |
| YouTubers | 9 |

La medición prueba cobertura del catálogo en ese instante; no convierte cada
serie en candidata. Las puertas posteriores siguen rechazando falsos positivos,
mercados cerrados o resueltos, placeholders, padres parciales, fuentes
incorrectas, incoherencias temporales y duplicados.

## Selección general sin excepciones por ID

`atinara-kalshi-radar-series-catalog-v2` combina señales auditables:

- tags registrados `Video games` o `Esports`;
- metadatos explícitos de videojuegos, eventos, industria o creadores;
- entidades e industria gaming genéricas;
- fuentes oficiales, editoriales o de creador bajo límites conservadores;
- relación con una entidad derivada del propio catálogo acreditado.

El vocabulario de relaciones no es una lista de juegos. Se reconstruye en cada
catálogo desde series ya acreditadas por taxonomía, metadatos o autoridad. Un
término solo entra si aparece como máximo en 40 series globales, al menos la
mitad de sus apariciones están en semillas acreditadas y existe en dos semillas
o es un acrónimo explícito. Stopwords generales eliminan términos temáticos,
gramaticales, deportivos, audiovisuales y métricas ambiguas. La lista se limita
a 1.000 términos y su política, contenido, hash y recuento quedan sellados.

La regla amplia deliberadamente prioriza recall. `atinara-gaming-domain-v2`, la
revisión humana cuando corresponda y todas las puertas de integridad conservan
la decisión final sobre cada hija. Añadir cobertura de catálogo no autoaprueba
ni publica nada.

## Checkpoint durable V2

La primera invocación de una UUID Kalshi:

1. lee una sola vez el catálogo global con límite de 24 MB;
2. exige lista no vacía, ticker único, cursor nulo y máximo 100.000 series;
3. calcula una proyección estable del catálogo completo y su SHA-256;
4. deriva y sella el vocabulario efímero;
5. selecciona y ordena hasta 2.000 series;
6. persiste la secuencia 1 antes de consultar sus eventos;
7. libera el lease y responde progreso sobre la misma UUID.

Cada continuación reclama esa UUID, recupera el último snapshot y consulta
como máximo 48 series con concurrencia dos y un presupuesto hijo de 40 segundos.
Cada endpoint de eventos agota su cursor con hasta 200 padres por página. El
heartbeat de la intención permanece en el contexto global.

Si expira el presupuesto hijo, una petición en vuelo no registra un falso fallo
ni consume intento: la serie queda pendiente. Un resultado real de timeout,
rate limit, indisponibilidad o respuesta inválida conserva código, timestamp y
`retry_after_at`. Solo esa serie se reintenta, hasta cuatro veces. Al cuarto
fallo queda explícita como `provider_unavailable`; las series sanas continúan y
el aviso es de calidad con `degrades_provider=false`.

Cuando ninguna serie puede avanzar por cooldown o presupuesto, la intención
permanece `in_progress`, `blocking_scope=none`, con
`next_action=resume_provider_discovery`. La UI solo puede continuar esa UUID.
No se inicia manifest ni se muestra catálogo fresco hasta que todas las series
estén cumplidas o agotadas de forma explícita.

## Integridad SQL

La migración
`20260826190000_checkpoint_market_radar_global_catalog_v2.sql` crea
`private.market_radar_provider_discovery_checkpoints_v2` con:

- FK a la intención exacta `(request_id, provider, capability)`;
- clave por secuencia y hash único de snapshot;
- RLS forzada, cero grants de tabla y trigger append-only;
- máximo 4 MiB por snapshot;
- RPC de checkpoint, lectura y deferral solo para `service_role` y lease vigente;
- idempotencia exacta para replay ambiguo de la misma secuencia;
- cadena obligatoria mediante `previous_checkpoint_hash`;
- catálogo, selección y timestamp inmutables durante una UUID;
- máximo 48 resultados nuevos o modificados por secuencia;
- intento inicial uno e incremento exacto en cada retry;
- resultado cumplido inmutable y prohibición de perder resultados anteriores;
- unicidad de series y padres, pertenencia padre-serie y recálculo de todos los
  contadores antes de insertar.

La migración no contiene backfill ni DML de negocio. V1 permanece únicamente
para reanudar UUID históricas; toda intención nueva usa V2.

## Continuidad hasta revisión humana

Al terminar discovery, el flujo existente conserva sus responsabilidades:

- Radar normaliza, reconcilia padres e hijas y aplica dominio, apertura,
  resultado público, temporalidad, fuentes, duplicados y elegibilidad;
- una incidencia reparable queda visible y reintentable sin falsear éxito;
- un bloqueo terminal impide preparar esa candidata, no borra familias sanas;
- Market Expert solo puede analizar una candidata fresca que haya superado
  todas las puertas;
- Editor propone y materializa una sola escritura idempotente de borrador
  privado;
- ningún agente se autoaprueba, confirma, publica, resuelve o liquida.

La corrección integrada en la base para evidencia oficial futura viaja en el
mismo bundle al desplegar `market-radar`; no necesita otra Edge ni otra
migración. El E2E productivo exige un refresh nuevo porque el expediente actual
es anterior a esa identidad familiar corregida.

## Pruebas y matriz general

Las pruebas nuevas cubren clasificación de las seis temáticas, taxonomía,
metadatos, autoridades, relaciones dinámicas entre series, ausencia de
hardcodes, falsos positivos de expansión, límites editoriales/de creador,
Unicode, apóstrofes, subtítulos, guiones y números.

El checkpoint se ejecuta con 1, 3, 21, 48 y 121 series; prueba lotes máximos de
48, cadena y replay, reanudación de la misma UUID, recuperación de un fallo,
cuatro intentos explícitos, pertenencia padre-serie, duplicados, contadores,
deferral, cooldown, presupuesto y transporte ambiguo. La matriz heredada
mantiene binario, `categorical_outcomes`, 1/3/21/48/100+ hijas, hermanas,
duplicado exacto cross-provider, placeholders, hija inactiva, padre parcial,
`provider_unavailable`, resultado público con proveedor abierto, fuente stale,
timeout, segunda página perdida, cursor duplicado, Tavily caído, doble clic,
búsqueda vacía e identidades `option:*` y `deadline:*`.

Puertas finales ejecutadas sobre esta entrega:

- lógica afectada, familias, hechos y resumibilidad: 155/155;
- matriz transversal Radar → elegibilidad → Expert → Editor → confirmación
  humana: 162/162;
- regresión específica de clasificación y fuentes: 28/28;
- Edge Functions con Deno 2.1.14: 9/9;
- sintaxis válida en 129 archivos JavaScript;
- contratos SQL estáticos: 19/19;
- `git diff --check`: verde.

No se repitió la suite completa de 563 porque el contenido remoto de la base ya
era idéntico a la entrega previamente verificada. Este entorno no dispone de
PostgreSQL, Docker ni CLI Supabase local; por tanto, la migración se revisó por
contrato y prueba estática, pero su ejecución transaccional real queda como
puerta obligatoria posterior a la integración y antes del despliegue.

## Activación después de integrar el ZIP exacto

1. Ejecutar `git fetch --all --prune` y comparar rutas y contenido contra el
   ZIP; exigir Calidad de Atinara, Deno, Pages y benchmark offline verdes. No
   usar Sonar.
2. Crear una worktree limpia desde el nuevo `origin/main` y tomar baseline
   productivo de solo lectura, incluida v72, digest, JWT, seis borradores y
   fingerprints protegidos.
3. Aplicar una sola vez la migración V2 y comprobar tabla, RLS, ACL y funciones.
4. Desplegar únicamente `market-radar` con `verify_jwt=true`; no desplegar
   frontend ni otras Edge.
5. Confirmar nueva versión `ACTIVE`, digest, JWT e invariantes.
6. Respetar cooldown y ejecutar exactamente un refresh fresco solo Kalshi.
7. Continuar exclusivamente esa UUID hasta catálogo, series, padres, hijas,
   manifest, batches, finalización y replay. No repetir a ciegas ante un fallo.
8. Elegir una hija futura, explícita, fresca, de padre completo y paginación
   agotada, con proveedor abierto, identidad vigente, fuentes correctas, sin
   resultado público ni duplicado y elegibilidad vigente.
9. Solo entonces ejecutar Market Expert/Editor y crear exactamente un borrador
   privado con binding, versión, huella e issue ledger coherentes.
10. No confirmar, publicar, resolver ni liquidar.

## Rollback y riesgos residuales

Si falla antes del manifest, no abrir otra UUID: leer el último checkpoint,
lease, logs Edge/API/Postgres y eventos, y reanudar únicamente cuando el estado
lo permita. La Edge v72 puede restaurarse sin borrar checkpoints; la tabla V2
queda privada e inerte. Cualquier reversión de esquema debe ser una migración
nueva y aditiva, nunca DML manual ni edición de la migración aplicada.

Riesgos que solo puede cerrar el smoke productivo:

- latencia y número real de continuaciones para las 410 series bajo rate limit;
- tamaño del snapshot con el catálogo y los padres presentes ese día;
- disponibilidad real de las fuentes de elegibilidad y de una candidata fresca;
- integración exacta Radar → Expert → Editor → único borrador privado.

El paquete no declara Radar ni el E2E aptos antes de obtener esas evidencias.
