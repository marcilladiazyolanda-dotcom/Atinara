# Atinara Official Opportunity Discovery V1

Estado: V1 está activa en producción. La reparación de idempotencia de extremo a extremo descrita aquí está implementada solo en la rama local `codex/official-discovery-idempotency-v1`, sobre `origin/main = f38ae2dc4d30eae99bcfbca3ef1cd535a588e690`; todavía no se ha subido, migrado ni desplegado. Este paquete no ejecuta inferencias ni operaciones remotas.

## Objetivo y límites

Official Opportunity Discovery V1 permite que una administradora busque acontecimientos futuros en fuentes primarias ya registradas, los convierta de forma determinista en una propuesta binaria completa y los incorpore como señales privadas al flujo existente de Datos y tendencias.

El descubrimiento:

- no llama a Gemini ni a otro modelo;
- no crea ni modifica borradores o mercados;
- no analiza, aprueba, confirma, publica, programa, resuelve ni liquida;
- no cambia modos, rutas, proveedores de IA, modelos o presupuestos;
- no añade secretos: reutiliza `TAVILY_API_KEY` únicamente para localizar páginas dentro de dominios permitidos;
- exige revisión humana antes del análisis del Agente Editor, del autofill y del guardado manual.

Twitch, YouTube, X u otra plataforma solo pueden participar si existe una entrada primaria activa en `private.market_source_registry`, la categoría está permitida y una página HTTPS del dominio registrado publica JSON-LD estructurado y futuro. V1 no rastrea publicaciones sociales libres ni convierte tendencias o rumores en fuentes de resolución.

## Contrato versionado

```text
ATINARA_OFFICIAL_OPPORTUNITY_DISCOVERY_VERSION =
  "atinara-official-opportunity-discovery-v1"
```

V1 admite únicamente:

- JSON-LD `Event` o subtipos terminados en `Event`, usando `startDate`;
- JSON-LD `Product`, `VideoGame` o `SoftwareApplication`, usando `releaseDate`;
- fechas con offset explícito, fechas locales inequívocas en una zona IANA o una fecha civil que se cierra a las 23:59:59 de esa zona;
- acontecimientos con al menos 48 horas de antelación y dentro del horizonte administrativo de 30, 90, 180 o 365 días;
- hasta ocho páginas y cinco propuestas por solicitud de la interfaz.

`datePublished` no se interpreta como fecha del acontecimiento. Una hora local inexistente o ambigua por un cambio DST se rechaza. El contrato conserva `precision = day` para fechas civiles y `precision = instant` para una hora inequívoca, que es el vocabulario productivo de V1. Unicode del sujeto no se utiliza como instrucción; el contenido externo se sanea y las instrucciones incrustadas se rechazan u omiten.

Cada propuesta contiene pregunta, opciones Sí/No, periodo, corte exacto, zona, deadline de resolución, criterios Sí/No, casos límite, tratamiento de retraso/cancelación/filtración/cambio de nombre, fuente primaria, alternativas y contrato de resolución. Una única identidad del registro deja la señal en `needs_review`; solo dos fuentes primarias registradas independientes y coherentes permiten `useful`. Varias URL de una misma autoridad no simulan corroboración. Una coincidencia con mercados o borradores existentes produce `duplicate` y bloquea el análisis desde la tarjeta; si no puede leerse el corpus de ambos, el descubrimiento falla cerrado y no persiste señales.

## Flujo administrativo

```text
Consulta humana en Datos y tendencias
  -> búsqueda Tavily limitada a dominios primarios activos
  -> descarga HTTPS registrada y acotada
  -> extracción JSON-LD determinista
  -> contrato binario + clasificación de duplicados
  -> señal privada del Observatorio
  -> revisión humana
  -> solicitud separada al Agente Editor
  -> autofill separado en Crear manualmente
  -> revisión y guardado humanos
```

El botón de búsqueda solo llega al paso de señal privada. `Analizar`, `Aplicar al formulario` y `Guardar` continúan siendo acciones distintas. El sistema puede devolver cero propuestas y debe hacerlo cuando no exista evidencia suficiente.

## Idempotencia de extremo a extremo V2

Una ejecución productiva del 15 de agosto de 2026 demostró la deficiencia anterior: una sola intención de interfaz produjo dos POST y dos filas técnicas parciales, con la misma huella de consulta y cero señales. Las filas `fd1db3c2-72e5-4f37-a77e-18b8c834c988` y `635bc7fc-154d-4e1c-9507-59a346cb156a` son evidencia histórica y no deben modificarse ni eliminarse.

La causa general era una frontera reintentable sin identidad común: el navegador bloqueaba visualmente con un estado global, pero no emitía una UUID estable; la Edge entraba en red antes de reclamar la operación; y `save_official_opportunity_discovery_v1` insertaba un run nuevo en cada llamada y actualizaba señales existentes.

La reparación V2 aplica las tres capas siguientes:

1. `official-opportunity-request.js` crea una UUID por intención manual, devuelve la misma promesa ante doble submit y reutiliza esa UUID tras un fallo de transporte ambiguo o mientras el backend informa `in_progress`. Una terminación conocida cierra la intención; la siguiente acción manual recibe otra UUID.
2. `data-observatory` exige y valida `request_id`, calcula una huella canónica de los parámetros y llama a `begin_official_opportunity_discovery_v2` antes de Tavily, del registro y de cualquier página oficial. Un replay nunca entra en red.
3. Postgres conserva una sola fila `private.data_provider_runs` por proveedor, acción y UUID mediante índice único. El actor y la huella deben coincidir y el final se serializa con `FOR UPDATE`. Un retry de la misma UUID retorna antes de tocar señales. Una intención nueva con otra UUID solo refresca una señal existente si cambió su evidencia normalizada; un payload idéntico es no-op y un cambio crítico invalida el análisis anterior como `stale`.

Una intención conserva una lease de tres minutos. La primera reclamación posterior, aunque corresponda a otra UUID, reconcilia atómicamente todas las leases oficiales vencidas como `technical_failure` con `OFFICIAL_DISCOVERY_REQUEST_INTERRUPTED`; una finalización que llega tarde aplica esa misma transición antes de validar o insertar señales. Nunca se reejecuta silenciosamente una lease vencida. Una UUID reutilizada con otro actor o payload falla con `OFFICIAL_DISCOVERY_REQUEST_REUSED`.

Los outcomes técnicos son cerrados y estables:

- `success`: se insertó o refrescó materialmente al menos una señal y no hubo fallo de fuente;
- `zero_results`: no hubo señal nueva, incluidas coincidencias ya persistidas, sin fallo de fuente;
- `partial`: una o más fuentes fallaron, aunque el resto pudiera producir señales;
- `technical_failure`: la ejecución no pudo completarse de forma segura.

El resumen persistido incluye solo versiones, IDs/huellas, contadores coherentes entre resultados, documentos, candidatas y fuentes, códigos acotados y cabeceras de cuota reducidas a enteros de hasta 20 dígitos o `null`. Así puede explicar, por ejemplo, ocho resultados de búsqueda, siete documentos inspeccionados y un `OFFICIAL_SOURCE_TIMEOUT`, sin guardar la URL fallida, la consulta, HTML o contenido.

## Autorización, red y datos

La Edge `data-observatory` conserva la autenticación administrativa existente. Antes del parseo, consume el body por bytes con límite estricto y cancelación; un JSON inválido se reduce a `INVALID_REQUEST`, sin copiar fragmentos del payload a errores o logs. La RPC V1 `public.save_official_opportunity_discovery_v1(jsonb,jsonb)` permanece intacta por compatibilidad histórica; la ruta reparada usa exclusivamente `begin_official_opportunity_discovery_v2` y `finish_official_opportunity_discovery_v2`. Ambas funciones V2:

- es `security definer` con `search_path = ''`;
- exige `service_role` también dentro de la función;
- revoca ejecución a `public`, `anon` y `authenticated`;
- validan identidad, actor, huella y allowlists cerradas para resultado, lote, señal, snapshot, contrato y fuentes;
- vuelve a verificar cada dominio, categoría, rol y versión contra el registro privado;
- reclaman exactamente una fila técnica y escriben como máximo ocho señales en `private.data_observatory_signals`;
- un replay de la misma intención nunca toca una señal; una intención distinta puede refrescarla únicamente cuando el payload validado cambió, preserva un rechazo humano y marca `stale` si cambian evidencia, contrato, duplicados o razones;
- no posee sentencias sobre borradores, mercados, predicciones, economía, publicación o resolución.

La red aplica HTTPS, URL pública, registro activo, dominio y categoría en la búsqueda, antes de cada descarga y después de cada redirect. Los redirects son manuales y están limitados a tres; cada destino vuelve a validarse. No se envían credenciales, cookies ni referrer. Solo se aceptan HTML/XHTML, con 10 segundos y 600 kB por página. El cuerpo se consume por chunks y se cancela al superar el límite, manteniendo activo el timeout hasta terminar la lectura. La extracción limita globalmente a 128 nodos JSON-LD por documento antes de las conversiones temporales costosas.

No se persiste la consulta humana, HTML ni contenido crudo. Se guardan la huella SHA-256 de la consulta derivada, la huella del HTML, campos estructurados saneados, versiones, referencias al registro y el contrato propuesto. Un fallo parcial de una página no convierte datos ausentes en hechos.

## Huellas y duplicados

La huella usa Atinara Canonical JSON v1 y SHA-256 sobre versión, tipo, sujeto comparable y deadline. El agrupado y el orden de fuentes usan un comparador UTF-16 explícito, no `localeCompare()`. La clasificación de identidad reutiliza únicamente la RPC autoritativa y completa `get_admin_market_family_definitions`; su indisponibilidad falla cerrada, sin recurrir a listados paginados incompletos. Un cambio del digest oficial, contrato, duplicados o razones de mercado marca cualquier análisis anterior como `stale`. Market Expert incorpora a su huella solo el SHA-256 oficial saneado, no el HTML, y tanto su paquete como el autofill comprueban estado, ID y huella vigentes antes de rellenar el editor.

La huella identifica una señal de descubrimiento; no aprueba equivalencia de mercado, no sustituye la identidad familiar autoritativa y no permite reutilizar una revisión.

## Errores estables de entrada y operación

- `OFFICIAL_DISCOVERY_REQUEST_INVALID`
- `OFFICIAL_DISCOVERY_REQUEST_FIELD_INVALID`
- `OFFICIAL_DISCOVERY_REQUEST_ID_REQUIRED`
- `OFFICIAL_DISCOVERY_REQUEST_REUSED`
- `OFFICIAL_DISCOVERY_REQUEST_NOT_FOUND`
- `OFFICIAL_DISCOVERY_REQUEST_STATE_INVALID`
- `OFFICIAL_DISCOVERY_QUERY_REQUIRED`
- `OFFICIAL_DISCOVERY_QUERY_UNSAFE`
- `OFFICIAL_DISCOVERY_QUERY_SENSITIVE`
- `OFFICIAL_DISCOVERY_CATEGORY_INVALID`
- `OFFICIAL_DISCOVERY_HORIZON_INVALID`
- `OFFICIAL_DISCOVERY_TIMEZONE_INVALID`

Esos errores de entrada u operación devuelven HTTP 400. `OFFICIAL_DISCOVERY_REQUEST_INTERRUPTED` es, en cambio, un resultado terminal `technical_failure` con HTTP 200 y resumen saneado. Registro vacío, indisponibilidad de proveedor, red o fuente son fallos técnicos y no una proposición negativa.

## Pruebas y aceptación

La suite `tests/official-opportunity-discovery.test.js` cubre:

- dos fuentes registradas y contrato completo;
- determinismo ante distinto orden de inserción;
- fecha civil y zona IANA;
- fuente alternativa ausente;
- duplicados de mercado y borrador;
- fuente no registrada, fecha pasada y hora DST ambigua;
- prompt injection, secretos y parámetros inválidos;
- límites de dominio, redirects, bytes y retención;
- allowlist de las dos tablas técnicas y ausencia de Gemini, borradores o publicación;
- separación humana entre descubrimiento, análisis, autofill y guardado.
- doble submit concurrente en frontend y retry de transporte con la misma UUID;
- reclamo backend antes de red, replay terminal y ausencia de URL en errores;
- outcomes `success`, `zero_results`, `partial` y `technical_failure`;
- unicidad SQL, actor/huella, señal válida, duplicado idéntico como no-op, refresh de una intención nueva con invalidación `stale` y ausencia de mutaciones de dominio.

`supabase/tests/official_opportunity_idempotency_v2_transaction.sql` recorre el contrato dentro de `BEGIN/ROLLBACK`; se selecciona con `npm run test:sql:official:transaction`. `npm run test:sql:official-concurrency` abre dos sesiones PostgreSQL contra una base exclusivamente local, sincroniza por marcadores observables en vez de esperas de orden, exige `started` + `in_progress`, un único run, `finished` + `replayed` y prueba que un finish iniciado antes del vencimiento pero desbloqueado después termina `interrupted`. El runner limpia sus fixtures y se niega a aceptar un host no local.

En este paquete, V1 y V2 se aplicaron en orden sobre PostgreSQL 17 local desechable. La suite transaccional terminó en `ROLLBACK`; la prueba concurrente produjo una única fila y la eliminó; después se eliminó la base temporal y se detuvo el servidor. Esta comprobación local no sustituye el preflight del esquema productivo antes de una migración autorizada.

Antes de desplegar deben pasar `npm run validate`, `npm run test:edge` con IA externa desactivada, `npm run benchmark:offline` con `externalNetworkCalls=0`, pruebas SQL locales, `npm audit`, validador Codex y `git diff --check`.

## Despliegue y rollback futuros

Este paquete no autoriza despliegue. Una fase posterior separada deberá:

1. comprobar que V1 y su historial canónico siguen presentes, sin reejecutar ni editar `20260814232218_add_official_opportunity_discovery_v1.sql`;
2. aplicar una sola vez `20260815115516_harden_official_opportunity_discovery_idempotency_v2.sql`;
3. desplegar exclusivamente `data-observatory` y los recursos estáticos afectados;
4. conservar schedulers apagados y verificar Auth, RLS, bundle y cache busting;
5. hacer un único smoke de regresión sin Gemini y confirmar una fila por UUID, replay sin red ni mutación de señal, y refresh solo para una intención nueva con evidencia materialmente distinta;
6. requerir una autorización distinta para cualquier análisis live del Agente Editor.

Rollback: deshabilitar temporalmente la acción y volver juntos al bundle anterior de frontend/Edge. Las columnas, índice y RPC V2 quedan inertes; no se elimina una migración aplicada ni se toca una señal, borrador o mercado. No debe reactivarse la ruta V1 vulnerable a duplicación como supuesto rollback operativo.

## Impacto B2B

El contrato separa discovery, evidencia, identidad, propuesta editorial y autoridad humana. Esto permite incorporar adaptadores oficiales futuros por operador sin convertir una plataforma, cliente o jurisdicción en lógica especial del Editor. V1 no añade multitenancy, webhooks ni configuración de operador prematura; esas superficies deben permanecer privadas y versionadas si llegan a autorizarse.
