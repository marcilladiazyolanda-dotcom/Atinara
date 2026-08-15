# Atinara Official Opportunity Discovery V1

Estado: implementación local pendiente de revisión humana, subida a GitHub, migración y despliegue autorizados. No está activa en producción y este paquete no ejecuta ninguna inferencia live.

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

`datePublished` no se interpreta como fecha del acontecimiento. Una hora local inexistente o ambigua por un cambio DST se rechaza. Unicode del sujeto no se utiliza como instrucción; el contenido externo se sanea y las instrucciones incrustadas se rechazan u omiten.

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

## Autorización, red y datos

La Edge `data-observatory` conserva la autenticación administrativa existente. La nueva RPC `public.save_official_opportunity_discovery_v1(jsonb,jsonb)`:

- es `security definer` con `search_path = ''`;
- exige `service_role` también dentro de la función;
- revoca ejecución a `public`, `anon` y `authenticated`;
- valida allowlists cerradas para lote, señal, snapshot, contrato y fuentes;
- vuelve a verificar cada dominio, categoría, rol y versión contra el registro privado;
- escribe como máximo ocho señales en `private.data_observatory_signals` y una fila técnica en `private.data_provider_runs`;
- no posee sentencias sobre borradores, mercados, predicciones, economía, publicación o resolución.

La red aplica HTTPS, URL pública, registro activo, dominio y categoría en la búsqueda, antes de cada descarga y después de cada redirect. Los redirects son manuales y están limitados a tres; cada destino vuelve a validarse. No se envían credenciales, cookies ni referrer. Solo se aceptan HTML/XHTML, con 10 segundos y 600 kB por página. El cuerpo se consume por chunks y se cancela al superar el límite, manteniendo activo el timeout hasta terminar la lectura. La extracción limita globalmente a 128 nodos JSON-LD por documento antes de las conversiones temporales costosas.

No se persiste la consulta humana, HTML ni contenido crudo. Se guardan la huella SHA-256 de la consulta derivada, la huella del HTML, campos estructurados saneados, versiones, referencias al registro y el contrato propuesto. Un fallo parcial de una página no convierte datos ausentes en hechos.

## Huellas y duplicados

La huella usa Atinara Canonical JSON v1 y SHA-256 sobre versión, tipo, sujeto comparable y deadline. El agrupado y el orden de fuentes usan un comparador UTF-16 explícito, no `localeCompare()`. La clasificación de identidad reutiliza únicamente la RPC autoritativa y completa `get_admin_market_family_definitions`; su indisponibilidad falla cerrada, sin recurrir a listados paginados incompletos. Un cambio del digest oficial, contrato, duplicados o razones de mercado marca cualquier análisis anterior como `stale`. Market Expert incorpora a su huella solo el SHA-256 oficial saneado, no el HTML, y tanto su paquete como el autofill comprueban estado, ID y huella vigentes antes de rellenar el editor.

La huella identifica una señal de descubrimiento; no aprueba equivalencia de mercado, no sustituye la identidad familiar autoritativa y no permite reutilizar una revisión.

## Errores estables de entrada

- `OFFICIAL_DISCOVERY_REQUEST_INVALID`
- `OFFICIAL_DISCOVERY_QUERY_REQUIRED`
- `OFFICIAL_DISCOVERY_QUERY_UNSAFE`
- `OFFICIAL_DISCOVERY_QUERY_SENSITIVE`
- `OFFICIAL_DISCOVERY_CATEGORY_INVALID`
- `OFFICIAL_DISCOVERY_HORIZON_INVALID`
- `OFFICIAL_DISCOVERY_TIMEZONE_INVALID`

Esos errores devuelven HTTP 400. Registro vacío, indisponibilidad de proveedor, red o fuente son fallos técnicos y no una proposición negativa.

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

Antes de desplegar deben pasar `npm run validate`, `npm run test:edge` con IA externa desactivada, `npm run benchmark:offline` con `externalNetworkCalls=0`, pruebas SQL locales, `npm audit`, validador Codex y `git diff --check`.

## Despliegue y rollback futuros

Este paquete no autoriza despliegue. Una fase posterior separada deberá:

1. aplicar una sola vez `20260814232218_add_official_opportunity_discovery_v1.sql`;
2. desplegar exclusivamente `data-observatory` y los recursos estáticos afectados;
3. conservar schedulers apagados y verificar Auth, RLS, bundle y cache busting;
4. hacer primero un smoke sin Gemini y confirmar que solo se crean señales/runs técnicos;
5. requerir una autorización distinta para cualquier análisis live del Agente Editor.

Rollback: ocultar la acción o volver al bundle anterior de `data-observatory`; las señales `official_web` permanecen privadas y pueden filtrarse. No se elimina la migración aplicada ni se toca un borrador o mercado para revertir la interfaz.

## Impacto B2B

El contrato separa discovery, evidencia, identidad, propuesta editorial y autoridad humana. Esto permite incorporar adaptadores oficiales futuros por operador sin convertir una plataforma, cliente o jurisdicción en lógica especial del Editor. V1 no añade multitenancy, webhooks ni configuración de operador prematura; esas superficies deben permanecer privadas y versionadas si llegan a autorizarse.
