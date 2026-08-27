# Atinara · estrategia permanente B2B-first

**Estado:** decisión estratégica vigente y obligatoria.  
**Aprobación:** Yol, 27 de agosto de 2026.  
**Ámbito:** Chat, Pro, Work, Codex, GitHub, Supabase, diseño, QA, seguridad, datos, producto y estrategia comercial.

Este documento sustituye la prioridad anterior «crecer Atinara Social primero y productizar B2B después». No invalida el trabajo técnico ya construido ni la separación Karma/dinero real. Cambia la prioridad: **Atinara Engine pasa a ser el producto empresarial principal y Atinara Social su implementación de referencia.**

## 1. Tesis de producto

Atinara debe convertirse en una plataforma de infraestructura de predicción y forecasting capaz de ser licenciada e integrada por terceros sin bifurcar el núcleo por cliente.

La propuesta diferencial no será «otro prediction market». Atinara debe combinar cinco capacidades en un mismo sistema:

1. **Integridad de mercado y resolución:** contratos claros, fuentes versionadas, evidencias, criterios bloqueables, auditoría y resolución defendible.
2. **Operación profesional asistida por IA:** descubrimiento, análisis, edición, validación, monitorización y preparación de resolución, siempre con puertas deterministas y control humano en acciones sensibles.
3. **Engagement y reputación:** Karma ficticio/puntos, Prestigio, rankings, temporadas, perfiles, comunidad y mecánicas de retorno.
4. **Infraestructura B2B:** organizaciones, aislamiento, roles, branding, integración, analítica, API/webhooks y SSO según la fase.
5. **Configurabilidad sin forks:** un núcleo común que pueda servir a Atinara Social, clientes con audiencia y, posteriormente, forecasting privado empresarial.

La ambición es ser el producto del sector con mejor combinación de **rigurosidad de mercado + facilidad operativa + engagement + auditabilidad de IA + integración B2B**, no el que acumule más funciones enterprise hipotéticas.

## 2. Portafolio objetivo

### 2.1 Atinara Engine · prioridad

Infraestructura B2B modular, auditable, configurable, integrable y licenciable. La propiedad intelectual general del Engine permanece en Atinara.

Módulos conceptuales, internos y revisables:

- **Discover:** radar, señales, descubrimiento y priorización.
- **Studio:** creación, edición, revisión, aprobación, programación y gobierno editorial.
- **Resolve:** fuentes, monitorización, evidencias, anulaciones, disputas, resolución y auditoría.
- **Engage:** participación con puntos ficticios, reputación, rankings, temporadas, comunidad y contenido compartible.
- **Connect:** organizaciones, identidad, branding, experiencias embebibles/alojadas, API, webhooks, SSO, exportación y analítica.
- **Core:** contratos de dominio y mecanismos de forecasting/participación. El Core monetario queda bloqueado por R1.

### 2.2 Atinara Social · implementación de referencia

Atinara Social continúa como producto público real. Su nueva función estratégica prioritaria es:

- dogfooding de Engine;
- demostración verificable a clientes;
- laboratorio de UX y accesibilidad;
- entorno para probar el ciclo completo de mercado;
- generación de casos y métricas reales;
- escaparate de la identidad Atinara.

No se perseguirá crecimiento B2C masivo como condición previa a B2B. Las mejoras de Social se priorizan cuando mejoren el Engine, la demo, la calidad, la seguridad o el aprendizaje real de usuarios.

### 2.3 Vertical comercial inicial · Audience Prediction Infrastructure

Primer ICP prioritario: organizaciones que **ya tienen audiencia** y quieren añadir una experiencia de predicción/forecasting sin construir la tecnología completa.

Perfiles iniciales a investigar:

- medios y publishers;
- creadores y comunidades con audiencia recurrente;
- gaming/esports y comunidades de entretenimiento;
- eventos, conferencias y ligas;
- marcas con programas de comunidad;
- plataformas digitales con necesidad de engagement/first-party analytics.

Oferta inicial deseada: experiencia alojada o embebible con branding del cliente, **exchange de predicción con Karma ficticio**, mercados verificables, entrada/salida antes de resolución, libro de órdenes, rankings, reputación, operación editorial, resolución y analítica. La UX objetivo debe acercarse a la lógica funcional de Polymarket/Kalshi sin copiar su tecnología, activos ni introducir dinero real.

### 2.4 Segundo vertical · Private Forecasting

Después de validar el núcleo multiempresa, estudiar forecasting privado para equipos/organizaciones: probabilidades sobre hitos de producto, demanda, ventas, riesgos o fechas.

Debe reutilizar identidad, tenant, auditoría, preguntas/contratos, resolución, analítica e integraciones. No se crea una segunda plataforma separada.

En este vertical debe contemplarse un mecanismo de forecast directo/probabilístico además del exchange cuando el objetivo sea elicitar opinión de equipos pequeños. La literatura muestra que el diseño del mecanismo y la participación condicionan la precisión; no debe forzarse trading a un caso que realmente necesita probabilidades directas. El LMSR no es el target B2B del vertical Audience.

## 2.5 Decisión económica B2B · Exchange Engine, no LMSR

**Decisión aprobada 27/08/2026:** el LMSR se considera mecanismo productivo transitorio/histórico de Atinara Social. Fue útil para dotar de precio continuo a un producto con poco volumen, pero **no es la arquitectura objetivo de Atinara Engine**.

El vertical Audience debe evolucionar a un motor de intercambio inspirado funcionalmente en los elementos comunes de Polymarket y Kalshi:

- CLOB (Central Limit Order Book) autoritativo;
- precios descubiertos por oferta/demanda, no calculados por LMSR;
- compra y venta de contratos/outcomes;
- posibilidad de reducir/cerrar una posición antes de resolución;
- órdenes limit y órdenes ejecutables inmediatamente contra el libro;
- partial fills, cancelación y expiración/time-in-force;
- price-time priority determinista;
- bid/ask, spread, profundidad, último trade e histórico real;
- posiciones, reservas de Karma, fills y ledger auditables;
- settlement del outcome ganador conforme al contrato versionado;
- self-trade prevention, idempotencia y control de concurrencia.

**Karma sigue siendo ficticio.** Implementar estas mecánicas no autoriza dinero real ni R1. Atinara puede reproducir la experiencia económica de un exchange sin blockchain, USDC, depósitos o KYC monetario.

### Liquidez con bajo volumen

Quitar LMSR sin resolver la liquidez recrearía el problema original. Polymarket y Kalshi dependen de market makers/liquidity providers. Por ello Atinara Engine debe incluir una capa de **liquidez ficticia gestionada** que publique órdenes visibles en el mismo CLOB, con inventario/colateral virtual, límites, spread/depth configurables, auditoría y sin privilegios ocultos de ejecución. Su misión es bootstrap de pilotos pequeños; no inventar trades ni alterar settlement.

### Tipos de mercado

El dominio deja de asumir que todo es binario:

1. `binary`: Sí/No.
2. `categorical_single_winner`: N outcomes mutuamente excluyentes y, cuando el contrato lo exija, exhaustivos; un único outcome ganador.
3. `binary_family`: conjunto de contratos binarios relacionados para umbrales, strikes, fechas o alternativas que puedan coexistir o que deban resolverse separadamente.

Polymarket y Kalshi suelen representar una experiencia multiopción mediante eventos/grupos de mercados binarios relacionados; Atinara no debe copiar esa representación ciegamente. El modelo debe expresar la semántica real y proyectarla a la UX adecuada, preservando exclusividad, resolución y colateral.

### Transición segura

- `legacy_fixed_v1` y `lmsr_v1` siguen siendo contratos históricos válidos hasta su cierre/resolución.
- No se edita la migración LMSR aplicada.
- El nuevo motor se introduce versionado (`orderbook_v1` o nombre definitivo) mediante migraciones nuevas.
- Atinara Social se migra mediante compatibilidad/cutover explícito, nunca reescribiendo posiciones antiguas.
- Antes del cutover debe existir reconciliación de ledger, pruebas de matching/concurrencia, rollback y E2E real.

La especificación técnica canónica de esta decisión es `docs/ATINARA_EXCHANGE_ENGINE_TARGET_20260827.md`.

## 3. Lo que Atinara debe hacer mejor que el sector

### 3.1 Resolution-native by design

Cada mercado/pregunta profesional debe nacer con:

- sujeto y acontecimiento canónicos;
- periodo y zona horaria;
- opciones/umbrales;
- criterios de resolución positivos y negativos;
- casos límite;
- jerarquía y función de fuentes;
- fecha/hora de cierre;
- reglas de anulación;
- conflictos de fuentes;
- versionado, huella y actor;
- evidencia recuperable para resolución.

Una empresa debe poder explicar meses después por qué se publicó y por qué se resolvió de una forma concreta.

### 3.2 IA auditable, no magia opaca

Los agentes de Atinara deben:

- separar hechos, inferencias e incertidumbre;
- citar fuentes y conservar huellas/evidencias cuando corresponda;
- trabajar bajo políticas versionadas;
- combinar reglas deterministas y modelos;
- no transformar errores técnicos en decisiones de dominio;
- no autoaprobar acciones finales sensibles;
- registrar qué herramienta/modelo/política/versionado intervino sin almacenar cadena de pensamiento ni secretos.

Esta gobernanza debe convertirse en parte de la propuesta B2B.

### 3.3 Time-to-value superior

El cliente inicial debe poder llegar a una experiencia funcional sin proyecto de integración de meses. Orden de preferencia:

1. microsite/experiencia alojada configurable;
2. embed/widget seguro y responsive;
3. identidad del cliente o login simplificado;
4. API/webhooks para integraciones reales;
5. SSO empresarial cuando el ICP/piloto lo demande.

No construir SDKs múltiples, on-premise ni multirregión antes de necesidad comercial demostrada.

### 3.4 Engagement medible

Atinara debe ofrecer al cliente métricas útiles, con privacidad y consentimiento:

- participantes únicos y activos;
- conversión a primera predicción;
- predicciones por participante;
- retorno D1/D7/D30 cuando haya volumen;
- participación por mercado/categoría;
- uso de rankings/temporadas/comunidad;
- comparticiones e invitaciones;
- resolución consultada;
- cohortes y fuentes de adquisición cuando proceda;
- abandono/errores de la experiencia.

La analítica no debe inventar actividad ni perseguir datos personales innecesarios.

### 3.5 Seguridad y aislamiento como producto

La multi-tenencia debe ser demostrablemente segura. El objetivo mínimo incluye:

- organización/tenant explícito;
- membresía y roles;
- RLS y autorización de servidor;
- pruebas de acceso cruzado entre tenants;
- separación de administración y participación;
- auditoría de acciones sensibles;
- scopes/permisos para API y webhooks;
- límites de tasa y cuota;
- logs sin secretos/PII innecesaria;
- exportación/borrado/retención definidos;
- backups, recuperación e incident response proporcional.

`authenticated` nunca es sinónimo de administrador.

## 4. Modelo arquitectónico objetivo

La arquitectura debe separar responsabilidades sin convertir la beta en microservicios prematuros.

### 4.1 Capas de dominio

1. **Organizations & Identity:** tenants, membresías, roles, invitaciones, clientes externos, SSO futuro.
2. **Configuration:** branding, idioma, categorías, reglas de puntos/reputación, features por plan/tenant.
3. **Market Definition:** contrato de mercado/pregunta, versiones, criterios, fuentes, familia, lifecycle.
4. **Forecasting Runtime:** participación, mecanismo, cotización/forecast, cierre y estado.
5. **Resolution & Evidence:** seguimiento, snapshots, evidencias, disputa, decisión y auditoría.
6. **Engagement:** Karma/puntos ficticios, Prestigio/reputación, rankings, temporadas, comunidad.
7. **Analytics:** eventos de producto, calidad de mercado, engagement y métricas de cliente.
8. **Integrations:** embed, webhooks, API, SSO, exportaciones, adaptadores de proveedores.
9. **Agent Operations:** radar, expert, editor, corrector, centinela, resolución asistida y Gateway.

### 4.2 Migración multi-tenant

No realizar una reescritura destructiva. Estrategia recomendada:

- crear tablas `organizations`/membresías y permisos mediante migraciones nuevas;
- crear un tenant de referencia para Atinara Social;
- añadir `organization_id` de forma aditiva a entidades que deban aislarse;
- backfill verificable y por lotes/transacción según riesgo;
- introducir constraints e índices después de verificar cobertura;
- actualizar RPC/Edge para derivar tenant de identidad autorizada;
- introducir RLS/policies y revocar grants excesivos;
- probar dos o más tenants con IDs cruzados;
- eliminar compatibilidad antigua solo cuando no existan dependencias.

No se codifica esta migración hasta cerrar S1/A1 y definir qué entidades son globales, por tenant o por workspace.

### 4.3 Configuración y white-label

Evitar `if (cliente === X)`. La configuración debe ser datos/contratos versionados:

- nombre/logo/branding permitido;
- temas/tokens de diseño;
- idioma/localización;
- categorías y navegación;
- puntos/reputación habilitados;
- rankings/temporadas;
- feature flags por capacidad;
- dominio/origen permitido para embeds;
- políticas de moderación y privacidad;
- fuentes/proveedores permitidos cuando sean del cliente.

No permitir que branding/configuración modifique reglas de seguridad o integridad del dominio.

## 5. Seguridad B2B · prioridad inmediata

La revisión de Supabase producción del 27-08-2026 detectó una deuda que debe convertirse en trabajo S1 antes de una beta B2B:

- varias funciones `SECURITY DEFINER` expuestas a `anon` o al conjunto de `authenticated`;
- funciones administrativas/de workflow que merecen revisión de grants y autorización real;
- tablas del esquema público con RLS habilitado pero sin políticas;
- `pg_net` en `public` marcado por el advisor;
- protección de contraseñas filtradas deshabilitada.

Esto **no prueba por sí solo una vulnerabilidad explotable**: algunas funciones públicas pueden ser deliberadamente públicas y algunas funciones `SECURITY DEFINER` pueden validar internamente al actor. S1 debe inventariar, clasificar y probar antes de modificar.

Criterio para S1:

- clasificar cada RPC como pública, usuario, tenant-admin, platform-admin o service-only;
- comprobar autorización interna y grants efectivos;
- preferir `SECURITY INVOKER` cuando sea posible;
- en `SECURITY DEFINER`, fijar `search_path`, comprobar actor/tenant/permiso, revocar `PUBLIC` y conceder solo lo necesario;
- revisar RLS/policies/grants de tablas expuestas;
- activar controles Auth apropiados tras verificar impacto;
- añadir tests adversariales y de regresión.

No hacer un `REVOKE` masivo sin mapa de dependencias: podría romper Social y flujos productivos.

## 6. Roadmap B2B-first

### 13.5.x · cierre seguro del trabajo ya iniciado

No abandonar procesos abiertos a medias ni introducir regresiones. Cerrar únicamente lo que esté ya en curso o sea necesario para estabilizar el sistema real.

### 13.6 · B2B Discovery & Readiness

#### 13.6.0 · Baseline y freeze de prioridades

- fijar documentación B2B-first;
- inventario de capacidades existentes reutilizables;
- clasificar deuda: bloqueante para B2B, mejora Social o nice-to-have;
- no iniciar nuevas funciones de crecimiento B2C que no aporten a demo/Engine/seguridad/aprendizaje.

#### 13.6.1 · Discovery comercial

- definir 3-5 ICP concretos;
- 10-20 entrevistas de problema antes de grandes desarrollos;
- investigar workflow actual del cliente, coste de no resolverlo, integración y seguridad;
- validar si prefieren microsite, embed o API;
- validar quién crea/resuelve mercados y cuánto soporte gestionado desean;
- fijar hipótesis de piloto y métricas de éxito.

#### 13.6.2 · S1 Seguridad y aislamiento

- inventario RPC/RLS/grants/Edge/Auth;
- modelo de roles y permisos;
- clasificación tenant/global/service-only;
- tests adversariales cross-tenant diseñados antes de la migración.

#### 13.6.3 · A1 Arquitectura tenant-first

- ADR de organizations/workspaces;
- contrato de configuración;
- estrategia aditiva de migración de Atinara Social;
- límites de datos, dominio e integraciones;
- decisión de qué código/artefactos deben pasar a repositorio privado.

#### 13.6.4 · P1 Demo B2B

Crear una demo que recorra una ruta real:

cliente/tenant → branding/config → creación → revisión → aprobación humana → publicación → participación → cierre → resolución/evidencia → analítica/auditoría.

No requiere aún SAML, SCIM, on-premise ni SDKs.

#### 13.6.5 · C1 Primer piloto

- propuesta de piloto preferentemente pagado;
- alcance fijo y reversible;
- DPA/privacidad/TOS/seguridad mínimos apropiados;
- métricas de éxito acordadas;
- coste de integración y soporte medido;
- sin exclusividad amplia ni cesión del núcleo.

### 13.7 · Productización y escalado

Después del primer piloto o evidencia equivalente:

- multi-tenant endurecido;
- self-service administrativo donde aporte valor;
- embed/hosted production-ready;
- API/webhooks versionados;
- SSO/OIDC/SAML y SCIM si el segmento lo exige;
- analítica cliente y exportaciones;
- observabilidad/SLA/runbooks;
- documentación de integración y seguridad;
- billing/licencias no monetarias de usuario final;
- soporte y onboarding reproducibles;
- segundo y tercer cliente para demostrar replicabilidad.

## 7. Puertas obligatorias

### S1 · Security & Tenant Isolation

Aprobada solo cuando:

- existe matriz de permisos;
- no hay acceso cross-tenant en pruebas negativas;
- RPC/admin paths validan actor y rol;
- RLS/grants son coherentes;
- secretos y service-role están confinados;
- advisors críticos quedan resueltos, aceptados con justificación o bloqueados por plan explícito.

### A1 · Architecture

- modelo organization/workspace documentado;
- Social migra sin pérdida de datos;
- dominio no depende de una UI/cliente;
- configuración no requiere forks;
- mecanismos de forecast pueden evolucionar sin reescritura total.

### P1 · Product

- E2E real de tenant y mercado;
- UX premium/responsive/accesible;
- estados loading/empty/error/retry reales;
- resolución y audit trail demostrables;
- analítica cliente útil.

### I1 · Integration

- experiencia alojada o embed segura;
- contrato de identidad/integración documentado;
- API/webhooks solo los necesarios, versionados e idempotentes;
- límites, auth, rate limit y retry definidos.

### O1 · Operations

- monitoring/alertas;
- backups y recuperación verificables;
- runbook de incidente;
- métricas de latencia/error;
- prueba de carga proporcional;
- rollback/despliegue seguro.

### C1 · Commercial

- ICP y problema confirmados;
- propuesta de valor comprensible;
- piloto con alcance y éxito medibles;
- hipótesis de precio contrastable;
- seguridad/privacidad/documentación suficiente para el cliente objetivo.

## 8. Modelo comercial inicial

No fijar precios finales sin discovery. Arquitectura comercial recomendada:

- **Pilot:** experiencia alojada, una organización/workspace, branding, número limitado de mercados/campañas, analítica y soporte de implantación.
- **Pro:** varias experiencias, operación self-service, integraciones, webhooks/API seleccionados y analítica avanzada.
- **Enterprise:** SSO/SCIM si se requiere, SLA, soporte, entornos o controles especiales, DPA y configuración avanzada.
- **Add-ons:** operación gestionada de mercados, Discover/AI intelligence, integraciones o proveedores de datos premium.

Hipótesis de métrica de precio para validar: base de plataforma + capacidad/uso (MAU, mercados activos o workspaces) + integración/soporte. No cobrar porcentaje de Karma ficticio ni usar lenguaje de apuesta/inversión.

## 9. Métricas de excelencia

### Producto cliente/audiencia

- time-to-first-live-experience;
- activación a primera predicción;
- participantes activos;
- predicciones por usuario;
- retorno/cohortes;
- mercados con participación suficiente;
- tiempo de operador para crear/publicar/resolver;
- porcentaje de mercados resueltos sin disputa/ambigüedad;
- share/referral cuando corresponda.

### Calidad de mercado

- bloqueos por ambigüedad antes de publicar;
- cobertura de fuentes válida;
- cambios de contrato después de aprobación;
- anulaciones por error evitable;
- tiempo y evidencia para resolver;
- divergencia/disputas y causa.

### Forecasting privado futuro

- participación/cobertura;
- Brier/log score o métrica adecuada;
- calibración;
- mejora frente a baseline/forecast experto;
- frecuencia de actualización;
- diversidad de participantes y sesgos detectados.

### Operación B2B

- uptime/error rate/latencia;
- incidentes y MTTR;
- despliegues/rollbacks;
- integraciones fallidas/retries;
- aislamiento tenant y eventos de autorización denegada;
- coste por tenant/usuario/mercado para controlar margen.

### Negocio

- conversión discovery → piloto;
- piloto → contrato;
- tiempo de implantación;
- coste de soporte;
- ARR/MRR cuando exista;
- retención/expansión de clientes;
- concentración de ingresos por cliente.

## 10. Lo que no construiremos todavía

Salvo evidencia comercial o autorización expresa:

- dinero real, depósitos, retiradas, KYC/AML monetario o wallets;
- infraestructura de 10k TPS, HFT o complejidad de exchange institucional sin evidencia de carga; **el CLOB funcional sí es requisito E1**, pero se dimensiona al uso real;
- liquidez externa/market making real;
- apps nativas por cliente;
- SDKs para múltiples lenguajes;
- on-premise/air-gapped;
- infraestructura multi-región compleja;
- certificaciones enterprise costosas antes de que el ICP las exija;
- forks permanentes por cliente;
- features exclusivas para un único prospect sin cláusula/reutilización clara.

La arquitectura sí debe evitar bloquear estas opciones cuando tengan sentido futuro.

## 11. Propiedad intelectual

- Licenciar uso; no vender el núcleo por defecto.
- Conservar mejoras genéricas reutilizables.
- Evitar exclusividad amplia; si existe, limitar por territorio/categoría/plazo/cliente y exigir contraprestación suficiente.
- Evaluar repositorio privado antes de exponer lógica diferencial, adaptadores de clientes, documentación de seguridad o Core propietario.
- No introducir dependencias jurídicas/técnicas de un solo operador, proveedor o jurisdicción.

## 12. Puerta regulatoria R1

R1 permanece intacta. Antes de cualquier función con valor económico debe estudiarse formalmente clasificación jurídica, DGOJ/CNMV cuando proceda, licencias, capital, garantías, certificación, KYC/AML, pagos, fiscalidad, juego responsable, publicidad, protección de menores, jurisdicción, seguros, responsabilidad contractual y coste.

**La orientación B2B no autoriza dinero real.** Un cliente B2B con audiencia puede utilizar puntos ficticios sin que Atinara implemente pagos o saldo monetario.

## 13. Regla de decisión

Ante dos soluciones técnicamente válidas, preferir la que:

1. aumente seguridad e integridad;
2. reduzca acoplamiento y forks;
3. mejore la auditabilidad de mercados/IA;
4. preserve la semántica exchange (órdenes, fills, posiciones, salida, multi-outcome) sin acoplarla a una sola UI o tenant;
5. reduzca tiempo de implantación para clientes;
6. mejore engagement medible sin manipulación ni datos inventados;
7. permita reutilización entre verticales;
8. conserve propiedad intelectual;
9. sea proporcional a evidencia y fase;
10. mantenga Atinara Social estable;
11. no cierre la vía futura regulada ni la anticipe prematuramente.

## 14. Secuencia vigente

```text
Cerrar trabajo 13.5.x ya en curso sin regresiones
        ↓
13.6 B2B Discovery & Readiness
        ↓
S1 + A1 + E1 + P1 + I1 + O1 + C1 de forma progresiva
        ↓
Primer piloto B2B controlado, preferentemente pagado
        ↓
13.7 Productización y escalado de Atinara Engine
        ↓
Segundo vertical de forecasting privado si discovery lo valida
        ↓
Puerta regulatoria R1
        ↓
Solo con R1 favorable y autorización expresa: valor económico real
```

Atinara Social permanece activa como implementación de referencia durante todo el proceso.
