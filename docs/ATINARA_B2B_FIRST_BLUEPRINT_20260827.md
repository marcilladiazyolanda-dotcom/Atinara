# Atinara B2B-first · blueprint competitivo y de preparación

**Fecha de investigación:** 27 de agosto de 2026  
**Estado:** referencia canónica para diseño B2B; no autoriza por sí misma migraciones, despliegues ni funciones monetarias.  
**Base técnica verificada:** `origin/main`/GitHub en `adbe3baacad6458e05621bc2bf232af1ac014d04`; Supabase producción activo con PostgreSQL 17.6 y nueve Edge Functions activas con JWT obligatorio en la comprobación de esta fecha.

## 1. Objetivo

Construir Atinara Engine como infraestructura de predicción/forecasting B2B que destaque no por volumen de features, sino por cuatro ventajas combinadas:

1. **Market integrity / resolution-native:** definición y resolución profesional, fuente y evidencia versionadas.
2. **AI governance:** agentes útiles, trazables y con puertas humanas/deterministas.
3. **Engagement:** reputación, puntos ficticios, rankings, temporadas y comunidad.
4. **B2B integration:** tenant, branding, embed/hosted, identidad, analítica, API/webhooks y seguridad.

## 2. Dos mercados B2B diferentes

### A. Audience prediction / fan & community engagement

Comprador: medio, liga, marca, creador, comunidad o plataforma con audiencia.

Objetivo: aumentar participación, retorno, tiempo de interacción, first-party analytics consentida y valor de comunidad.

Competidores/referencias: Low6 y Genius Sports en gamificación/experiencias white-label; Tallysight como señal actual de distribución, atribución y conexión entre plataformas y audiencias.

**Encaje de Atinara:** alto y prioritario. Reutiliza Social, Karma/Prestigio, rankings, mercados, Studio/Resolve y operación de contenidos.

### B. Enterprise private forecasting

Comprador: equipo de producto, estrategia, operaciones, gobierno, investigación o dirección.

Objetivo: agregar conocimiento disperso y convertir incertidumbre en probabilidades actualizadas.

Competidores/referencias: Metaculus Private Instances, Cultivate Forecasts, Commazaar, P0.

**Encaje de Atinara:** interesante como segundo vertical. Requiere mayor énfasis en privacidad, anonimato opcional, SSO, direct probability forecasts, colaboración y métricas de calibración.

## 3. Benchmark de producto

| Capacidad | Referencia sectorial observada | Objetivo Atinara |
|---|---|---|
| Instancia privada/organización | Metaculus, Cultivate, Commazaar | Tenant aislado, Social como tenant de referencia |
| White-label | Cultivate, Low6, Genius Sports | Branding/config por tenant sin forks |
| Embed / integración | Low6; Cultivate en API/webhooks | Hosted + embed primero; API/webhooks después |
| SSO | Cultivate, Low6; Supabase soporta SAML multi-tenant | OIDC/SAML cuando lo demande el ICP, diseño compatible desde A1 |
| Roles/admin | Commazaar, Cultivate | RBAC explícito + tenant auth + platform admin separado |
| Mercado con tokens ficticios | Commazaar | Karma/puntos ficticios configurables y separados de reputación |
| Rankings/retención | Low6, Genius Sports, Cultivate | Prestigio, rankings, temporadas, streaks solo si no degradan calidad |
| Fuentes/resolución | Competidores varían | Diferenciación fuerte: contract + source + evidence + fingerprint + audit |
| IA | Cultivate AI Forecaster, P0 AI-augmented | IA gobernada en todo lifecycle, sin autoaprobar acciones sensibles |
| API/webhooks/export | Cultivate | Contratos versionados e idempotentes, scope por tenant |
| On-prem/air-gapped | Cultivate/enterprise | No construir hasta demanda pagada |
| SOC 2 | Cultivate | Preparar controles, no comprar certificación antes de necesidad comercial |
| Mecanismos de forecast | Metaculus múltiples formatos; mercados internos varían | Core pluggable: mercado actual + forecast directo futuro |

## 4. Aprendizajes de investigación

### 4.1 Metaculus

Ofrece instancias privadas alojadas o on-premise, distintos tipos de pregunta, agregación, organización por equipo/proyecto y colaboración. Lección: el valor enterprise no es solo “apostar puntos”, sino convertir probabilidades en decisiones y discusión estructurada.

### 4.2 Cultivate Labs

Ofrece forecasting empresarial con API/webhooks, SAML/OIDC, SCIM, white-label, multi-idioma y opciones de hosting; también ha incorporado AI Forecaster. Lección: integración, colaboración y operación continua son tabla de entrada enterprise. Otra lección histórica del producto es no mantener mecanismos de mercado complejos si bloquean el avance del producto: Atinara debe desacoplar mecanismo de forecasting del resto del dominio.

### 4.3 Commazaar

Combina mercados internos con tokens virtuales, criterios de resolución bloqueados, roles, auditoría y aislamiento. Lección: Atinara puede ser B2B sin dinero real; los puntos ficticios son comercializables si la operación y seguridad son profesionales.

### 4.4 P0

Se posiciona como prediction markets para equipos, con IA, dashboards e integraciones con herramientas de trabajo. Lección: el mercado enterprise se está reactivando y el “AI-native forecasting” se está convirtiendo en expectativa competitiva.

### 4.5 Low6 / Genius Sports / Tallysight

Low6 comercializa soluciones fully white-label que usan feeds API y SSO, con formatos de predicción y gamificación orientados a retorno. Genius Sports vende gamificación free-to-play y white-label como herramienta de adquisición, engagement, first-party data y retención. Tallysight se posiciona en 2026 como capa de conexión, atribución y activación entre plataformas de predicción y audiencias de creadores/publishers. Lección: al comprador de audience-engagement hay que venderle resultados, distribución, medición y rapidez de implantación, no teoría de mercados. Las cifras de casos publicadas por proveedores se tratan como claims comerciales y no como evidencia independiente.

### 4.6 Evidencia académica

Cowgill & Zitzewitz estudiaron mercados corporativos en Google, Ford y otra empresa: fueron relativamente eficientes y mejoraron previsiones expertas hasta un 25% en MSE, pero presentaron problemas de thinness, incentivos y sesgo optimista. Strijbis & Arnesen encontraron que la precisión de prediction markets variaba principalmente con el **setup** del mercado. Lección: el diseño operativo y de incentivos no es cosmético; debe ser parte del Core.

## 5. Diferenciación que debemos defender

### 5.1 “Resolution-grade” antes que “trading-grade”

Muchos proveedores compiten en trading, odds o liquidez. Atinara debe ser excelente en resolver el problema que aparece después: ¿estaba el contrato bien definido, qué fuente manda, qué pasa si discrepan, qué versión fue aprobada y qué evidencia justifica la resolución?

Esto encaja con activos ya construidos: Validator, Corrector, Expert, Radar, source monitor, evidence packages y aprobación humana.

### 5.2 AI Operations Layer

Convertir los agentes actuales en una capa B2B gobernada:

- discover candidates;
- normalize/canonicalize;
- detect ambiguity/duplicates;
- source and verify;
- draft/review/fix;
- monitor source health;
- prepare resolution evidence;
- summarize audit.

Cada agente debe tener scope, política, input/output schema, presupuesto, timeout, audit y prohibiciones de acción final.

### 5.3 One Engine, multiple surfaces

- Atinara Social: implementación pública propia.
- Client Hosted: microsite del cliente bajo branding configurable.
- Client Embed: componente integrado en web/app del cliente.
- Headless: API/webhooks cuando exista necesidad.
- Private Forecasting: superficie futura para equipos internos.

El dominio debe vivir por debajo de estas superficies.

## 6. Arquitectura B2B recomendada

### 6.1 Tenant model

Conceptos a diseñar en A1, no implementar a ciegas:

- `organizations`: cliente/tenant.
- `workspaces`: experiencia/campaña/comunidad opcional dentro del tenant.
- `organization_memberships`: actor + rol + estado.
- `roles/permissions`: permisos de dominio.
- `tenant_settings`: branding, idioma, features, reglas permitidas.
- `integration_credentials`: secretos cifrados y backend-only, nunca frontend.

Atinara Social se migraría como organización de referencia mediante estrategia aditiva.

### 6.2 Autorización

Patrón recomendado:

request → identidad verificada → membership/claim → permiso → tenant scope → operación.

Nunca:

request → `organization_id` del body → confiar.

Para Supabase, valorar custom claims y `sso_provider_id` para SSO multi-tenant, pero las claims no reemplazan el control de permisos de negocio cuando estos puedan cambiar con rapidez.

### 6.3 RLS y RPC

- tablas expuestas con RLS/policies explícitas;
- grants mínimos;
- `SECURITY INVOKER` por defecto;
- `SECURITY DEFINER` excepcional, con `search_path` seguro, validación de actor/tenant y grants explícitos;
- service-only fuera del contrato público cuando sea posible;
- views con comportamiento de seguridad revisado;
- cada RPC clasificada por audiencia/permiso.

### 6.4 Eventos y analítica

Crear eventualmente un contrato de evento interno estable, por ejemplo:

- tenant/workspace;
- actor pseudonimizado o anónimo cuando proceda;
- event name/version;
- market/question id;
- timestamp;
- source/medium/campaign si existe consentimiento;
- properties allowlisted.

Evitar almacenar payloads crudos o PII innecesaria. El producto debe poder medir engagement sin convertirse en un aspirador de datos.

### 6.5 Webhooks

Cuando se introduzcan:

- firma/HMAC;
- delivery id idempotente;
- retry exponencial;
- dead-letter/estado terminal;
- timestamp/replay protection;
- eventos versionados;
- tenant-bound secrets;
- observabilidad y reenvío controlado.

## 7. Exchange Engine y mecanismos de forecasting

### 7.1 Decisión de arquitectura económica

El LMSR actual queda clasificado como **legacy/transitorio**. No es el target del producto B2B Audience. El objetivo E1 es un **Central Limit Order Book (CLOB) de Karma ficticio**, con comportamiento exchange completo y dominio independiente de la UI.

Paridad funcional objetivo con los principios comunes observados en Polymarket/Kalshi:

- buy/sell de contratos;
- entrada, aumento, reducción y salida antes de resolución;
- limit orders y órdenes marketables/quick;
- partial fills;
- cancel/replace;
- time-in-force: GTC, IOC/FAK, FOK y GTD cuando el producto lo necesite;
- post-only como capacidad opcional para makers;
- price-time priority;
- self-trade prevention;
- bid, ask, spread, depth y last trade;
- open orders, fills, posiciones y reservas de Karma;
- historial derivado de ejecuciones reales;
- settlement determinista del outcome ganador;
- atomicidad, idempotencia y concurrencia seguras.

No copiar la infraestructura blockchain de Polymarket ni la infraestructura regulada de Kalshi. Atinara necesita el **modelo de intercambio**, no sus custodias, wallets o licencias.

Fuentes de referencia actuales:

- Polymarket CLOB: https://docs.polymarket.com/concepts/prices-orderbook
- Polymarket positions/tokens y salida: https://docs.polymarket.com/concepts/positions-tokens
- Polymarket order lifecycle: https://docs.polymarket.com/concepts/order-lifecycle
- Kalshi orderbook: https://help.kalshi.com/en/articles/13823828-the-orderbook
- Kalshi trading counterparties/market makers: https://help.kalshi.com/en/articles/13823808-who-are-you-trading-with
- Kalshi order API: https://docs.kalshi.com/api-reference/orders/create-order-v2

### 7.2 Liquidez bootstrap para pilotos pequeños

Un CLOB vacío no produce precio ni salida. El problema original de poco volumen no se resuelve simplemente eliminando LMSR. Polymarket incentiva resting limit orders y Kalshi utiliza market makers/designated market makers.

Atinara debe diseñar **Virtual Liquidity Provider (VLP)** o nombre equivalente:

- actor/servicio separado del matching engine;
- publica órdenes reales en el mismo libro;
- usa exclusivamente inventario y Karma ficticios;
- posiciones y fills visibles al ledger/auditoría;
- spread, depth, inventory limit, max exposure y horarios configurables;
- no conoce el resultado futuro ni puede saltarse matching/price priority;
- nunca fabrica trades ni modifica histórico sin fill;
- apagable por tenant/mercado;
- circuit breaker ante inventario, volatilidad o anomalías;
- pruebas para evitar crossed book, pérdidas/inventario fuera de límites y auto-trading.

Más adelante puede existir un programa de makers humanos/externos de Karma, pero no es requisito del primer piloto.

Referencias: https://docs.polymarket.com/market-makers/overview y https://help.kalshi.com/en/articles/13823819-how-to-become-a-market-maker-on-kalshi

### 7.3 Tipos de mercado y multi-outcome

El dominio no puede usar `Sí/No` como estructura universal. Debe representar explícitamente:

**A. `binary`**
- dos outcomes complementarios;
- el contrato ganador liquida y el perdedor no;
- las relaciones complementarias pueden optimizar el book sin contaminar el dominio general.

**B. `categorical_single_winner`**
- tres o más outcomes;
- mutuamente excluyentes;
- exactamente uno gana cuando el conjunto es exhaustivo;
- incluir `Otro/Ninguno` cuando sea necesario para evitar un conjunto incompleto;
- precios/probabilidades mostradas deben mantener coherencia de conjunto;
- resolución atómica del evento completo, no outcome por outcome de manera contradictoria.

**C. `binary_family`**
- varios mercados binarios relacionados;
- útil para fechas, thresholds, strikes o condiciones que pueden ser no exclusivas;
- cada contrato conserva criterios propios;
- la UI puede agruparlos como una familia sin convertirlos en un mercado categórico falso.

Polymarket documenta que el tradable unit básico sigue siendo binario y agrupa varios mercados dentro de un evento multi-market; Kalshi también organiza `Series → Event → Market` y usa mercados/strikes binarios. Esto es una referencia de diseño, no una obligación de copiar la estructura.

Referencias: https://docs.polymarket.com/concepts/markets-events y https://docs.kalshi.com/getting_started/terms

### 7.4 Ledger, colateral y precisión

Antes de implementar UI:

- especificar unidad de contrato y payout ficticio;
- usar fixed-point/integer minor units o `numeric`, nunca IEEE float para balances/precios;
- reservar Karma al colocar órdenes resting;
- liberar reservas al cancelar/expirar;
- mover inventario/Karma solo mediante fills atómicos;
- impedir double-spend entre órdenes concurrentes;
- separar available, reserved y position inventory;
- registrar `order_id`, `fill_id`, actor, tenant, market/outcome, price, quantity, timestamps y versión;
- ledger append-only o reconstruible con invariantes verificables;
- settlement y cancelación idempotentes;
- reconciliación automática entre ledger, órdenes, fills y posiciones.

### 7.5 Migración desde LMSR

No borrar LMSR. No editar migraciones aplicadas.

Plan de transición:

1. congelar contrato histórico de `legacy_fixed_v1`/`lmsr_v1`;
2. introducir schema y contratos `orderbook_v1` aditivamente;
3. adaptar lecturas/UI a economics versionados;
4. crear nuevos mercados de prueba exclusivamente en `orderbook_v1`;
5. validar matching, sell/exit, partial fills, cancelación, resolución y anulación con datos reversibles;
6. validar binary + categorical + family;
7. probar VLP en sandbox/tenant demo;
8. ejecutar E2E real sin tocar posiciones históricas;
9. activar cutover solo con autorización humana;
10. mantener adapters de lectura/settlement de legacy hasta que no exista dependencia activa.

### 7.6 Enterprise forecasting

El segundo vertical puede usar mecanismos distintos del trading:

- probabilidad directa 0-100%;
- intervalos/distribuciones;
- scoring/calibración;
- rationales;
- anonimato opcional;
- exchange solo si el tamaño y objetivo lo justifican.

La API de dominio debe separar **question/contract/resolution** de **elicitation/trading mechanism**.

## 8. Seguridad: baseline real observado 27/08/2026

Supabase Advisor marcó:

- numerosas RPC `SECURITY DEFINER` ejecutables por `anon` o `authenticated`;
- funciones administrativas entre las ejecutables por `authenticated`;
- tablas públicas con RLS sin policies;
- `pg_net` en `public`;
- leaked-password protection deshabilitada.

Prioridad de Codex en S1:

1. inventario exacto y clasificación;
2. comprobar si cada función valida internamente actor/rol;
3. mapa de dependencias frontend/Edge/RPC;
4. tests de permisos actuales para evitar regresión;
5. migraciones aditivas de hardening;
6. pruebas negativas antes de despliegue;
7. advisor post-cambio y E2E real.

No se debe arreglar “el lint” rompiendo contratos públicos deliberados. Debe arreglarse el **modelo de autorización**.

## 9. UX para vender B2B

Un cliente debe poder ver en una demo, sin explicación técnica extensa:

1. Crear organización/experiencia.
2. Aplicar branding.
3. Crear o descubrir mercado binario, categórico o familia.
4. Ver por qué es publicable/no publicable.
5. Aprobar humanamente.
6. Publicar en experiencia del cliente con libro de órdenes.
7. Entrar, ampliar, reducir o salir desde móvil según liquidez real del CLOB.
8. Ver órdenes/fills/posición, ranking y reputación.
9. Cerrar y resolver con evidencia.
10. Consultar dashboard/audit trail.

Estados obligatorios: loading, empty, success, validation error, provider unavailable, permission denied, retry, partially degraded y completed.

## 10. Paquete de primer piloto

### Scope sugerido

- una organización;
- un workspace/experiencia;
- branding básico;
- hosted/microsite;
- 5-20 mercados/eventos activos según caso, incluyendo al menos un caso multi-outcome en la demo;
- CLOB con Karma ficticio, entrada/salida y liquidez bootstrap controlada;
- ranking/reputación;
- Studio/Resolve operado por cliente o servicio gestionado;
- dashboard de engagement;
- export CSV/JSON básica si se requiere;
- soporte de implantación;
- sin dinero real.

### Éxito del piloto

Acordar 3-5 KPIs antes de iniciar, por ejemplo:

- % de audiencia que inicia participación;
- retorno semanal;
- mercados por usuario;
- tiempo de creación/publicación;
- mercados resueltos sin disputa;
- errores/latencia;
- horas de soporte/operación del cliente.

## 11. Producto que NO debemos perseguir todavía

- competir con Kalshi/Polymarket en **liquidez monetaria real**; el objetivo sí incluye paridad funcional de exchange con Karma;
- 10k TPS/HFT como objetivo abstracto;
- wallets/fiat/crypto/KYC/AML;
- market maker real;
- mobile apps white-label por cliente;
- SOC 2 inmediatamente;
- on-prem/air-gapped inmediatamente;
- SCIM antes de un cliente que lo necesite;
- SDK de cinco lenguajes;
- data warehouse enorme;
- microservicios por cada módulo.

“Enterprise-grade” primero significa autorización correcta, auditabilidad, aislamiento, reliability y contratos claros. Las certificaciones/infra avanzadas vienen cuando el mercado las paga.

## 12. Orden recomendado para Codex

Codex no debe empezar por implementar `organizations` sin discovery técnico. Primera cadena de trabajo:

1. cerrar checkpoint técnico actualmente abierto si lo hubiera;
2. ejecutar **B2B Readiness Audit** contra main + producción, reutilizando este baseline;
3. producir ADR A1 con mapa de datos global/tenant/workspace;
4. producir matriz S1 de RPC/RLS/grants/roles;
5. diseñar test harness cross-tenant;
6. proponer migración aditiva y rollout/rollback;
7. revisar con Work/Yol;
8. implementar por slices pequeñas con tests y migraciones nuevas;
9. construir demo P1;
10. solo después ampliar Connect/API/SSO según piloto.

## 13. Fuentes externas consultadas

Fuentes oficiales/producto:

- Metaculus Private Instances: https://www.metaculus.com/services/private-instances/
- Cultivate Forecasts: https://www.cultivatelabs.com/forecasts
- Cultivate hosting/features: https://www.cultivatelabs.com/forecasts_features_hosting
- Cultivate AI Forecaster (16/01/2026): https://www.cultivatelabs.com/posts/introducing-ai-probabilistic-forecasting
- Commazaar: https://commazaar.com/
- P0 / Priority Zero: https://priorityzero.ai/
- Low6 Gamezone: https://low6.com/games/game-zone
- Low6: B2B white-label gamification platform: https://low6.com/news/low6-announce-launch-of-new-b2b-white-label-gamification-platform
- Genius Sports gamification: https://www.geniussports.com/engage/gamification/
- Genius Sports F2P: https://www.geniussports.com/bet/free-to-play-games/
- Tallysight creator network for prediction platforms: https://www.tallysight.com/
- Supabase SAML multi-tenant: https://supabase.com/docs/guides/auth/enterprise-sso/auth-sso-saml
- Supabase custom claims/RBAC: https://supabase.com/docs/guides/api/custom-claims-and-role-based-access-control-rbac

Investigación académica:

- Cowgill, B.; Zitzewitz, E. (2015). Corporate Prediction Markets: Evidence from Google, Ford, and Firm X. Review of Economic Studies 82(4), 1309-1341. DOI 10.1093/restud/rdv014.
- Strijbis, O.; Arnesen, S. (2019). Explaining variance in the accuracy of prediction markets. International Journal of Forecasting 35(1), 408-419. DOI 10.1016/j.ijforecast.2018.04.009.

## 14. Criterio de éxito de esta orientación

No medir el giro B2B por seguidores de Atinara Social. Medirlo por si Atinara logra:

- una arquitectura segura y reusable;
- una demo que resuelva un workflow real de cliente;
- discovery que confirme dolor y presupuesto;
- primer piloto controlado;
- segundo cliente sin fork importante;
- calidad de mercado y resolución superior;
- operación suficientemente automatizada y auditable para que el coste marginal baje.

Ese será el camino para que Atinara sea un producto B2B defendible y no una colección de funciones.
