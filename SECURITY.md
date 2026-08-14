# Política de seguridad de Atinara

## 1. Sistema y alcance

Atinara es una red social competitiva de predicciones con Karma ficticio, Prestigio, reputación, comunidad y mercados verificables. La beta actual no admite depósitos, retiradas, compra de Karma, conversión a dinero real ni derechos económicos. Cualquier modalidad con valor económico queda fuera del producto actual y requiere superar expresamente la Puerta regulatoria R1.

Esta política orienta revisiones humanas, Codex Security, SonarQube y cualquier auditoría del repositorio. Cubre:

- frontend público y administración;
- Supabase Auth, Postgres, RLS, RPC, triggers y migraciones;
- Edge Functions y proveedores externos;
- Radar, Editor, Corrector, Validador, resolución y publicación;
- Agent Engine V2.1, AI Gateway, registries, budgets y telemetría;
- automatizaciones, observabilidad y pruebas incluidas en el repositorio.

Supabase es la fuente autoritativa del estado persistente. GitHub Pages aloja el frontend estático mientras siga siendo la arquitectura aprobada. Las APIs y modelos externos no son fuentes confiables de disponibilidad, formato, autoridad o veracidad por sí solos.

## 2. Estado operativo relevante

En el corte documentado el 13 de agosto de 2026, Agent Engine V2.1 está desplegado como capa de contratos, runtime y persistencia, pero las cinco tareas conservan `legacy_direct`. `gateway_gemini_parity`, `gateway_routing`, OpenRouter y NVIDIA NIM permanecen desactivados. Cualquier cambio de modo, presupuesto o proveedor es una promoción operativa separada y requiere autorización expresa.

Los documentos canónicos para esta superficie son:

- `docs/ATINARA_AGENT_ENGINE.md`;
- `docs/ATINARA_AI_GATEWAY.md`;
- `docs/ATINARA_AGENT_ENGINE_V2_RUNBOOK.md`;
- `docs/ATINARA_RPC_DEPENDENCY_MATRIX.md`;
- `docs/ATINARA_AI_BENCHMARK_TECHNICAL.md`.

El código y el estado real de producción prevalecen sobre una afirmación documental obsoleta. Una discrepancia debe investigarse y corregirse, no resolverse escogiendo el texto más conveniente.

## 3. Activos que deben protegerse

- Cuentas, sesiones, identidad y recuperación de acceso.
- Rol y capacidad de la administradora.
- Karma, Prestigio, predicciones, posiciones, mercados, cierres y liquidaciones.
- Mercados privados, borradores, revisiones, confirmaciones, evidencias y atestaciones.
- Secretos, claves, tokens, `service_role` y credenciales de proveedores.
- Integridad de RLS, RPC, Edge Functions, triggers, registries y políticas.
- Trazabilidad de creación, edición, revisión, aprobación, publicación, cierre, anulación y resolución.
- Datos personales, telemetría y cualquier dato que identifique o permita perfilar a una usuaria.
- Propiedad intelectual y componentes futuros de Atinara Engine.

## 4. Modelo de amenazas y límites de confianza

Trata como potencialmente controlables por un atacante, manipulables o no confiables:

- todo dato recibido del navegador, incluso desde una cuenta autenticada;
- parámetros de URL, formularios, contenido social y entradas administrativas antes de autorización server-side;
- respuestas de Polymarket, Kalshi, Tavily, Gemini, OpenRouter, NVIDIA NIM y cualquier proveedor externo;
- texto generado por modelos, aunque declare alta confianza o incluya fuentes;
- webhooks, respuestas HTTP, metadatos remotos, cachés y errores de proveedor;
- datos locales del navegador y estados visuales no confirmados por Supabase;
- documentación, prompts y fixtures cuando contradigan el código o el sistema real.

Límites principales:

1. Navegador público hacia Auth, RPC y Edge Functions.
2. Cuenta autenticada hacia datos propios y operaciones autorizadas.
3. Cuenta administradora hacia operaciones administrativas verificadas en servidor.
4. Edge Functions hacia proveedores externos.
5. IA y agentes hacia reglas deterministas, herramientas, persistencia y confirmaciones humanas.
6. Código y migraciones hacia Supabase producción.
7. Atinara Social actual hacia cualquier futura infraestructura B2B o regulada.

## 5. Invariantes de seguridad

### 5.1 Autenticación y autorización

- Toda operación sensible se autoriza en servidor. Ocultar controles en la interfaz nunca constituye autorización.
- RLS debe permanecer activa en tablas expuestas y las políticas deben aplicar propiedad, rol o capacidad real. `TO authenticated` por sí solo no es autorización suficiente.
- `user_metadata` y otros campos editables por la usuaria no pueden decidir permisos.
- Una función `SECURITY DEFINER` requiere justificación, `search_path` seguro, autorización interna, alcance mínimo y permisos `EXECUTE` restringidos.
- Las superficies administrativas, de publicación, resolución, purga o mantenimiento no pueden quedar invocables por `anon` ni por usuarios sin capacidad válida.
- Cambiar o eliminar una cuenta no debe asumirse como revocación inmediata de todos los tokens existentes sin comprobar el contrato de sesión.

### 5.2 Tablas privadas, RLS y grants

- Las tablas privadas con RLS forzado, sin policies y sin privilegios directos pueden representar un cierre denegatorio intencional. `rls_enabled_no_policy` no es por sí solo una exposición.
- Esa excepción solo es válida si se verifican esquema no expuesto, `FORCE ROW LEVEL SECURITY`, ausencia de grants directos y acceso únicamente mediante wrappers autorizados.
- Un aviso heurístico de Sonar o Supabase no debe silenciarse con una exclusión amplia. Debe revisarse por firma, rol, grants, cuerpo y callers.
- `service_role` no debe obtener acceso directo innecesario a ledgers privados cuando el contrato vigente usa wrappers service-only más estrechos.

### 5.3 Secretos y proveedores

- Nunca se almacenan secretos, `service_role`, tokens o credenciales en frontend, repositorio, logs, errores, fixtures o telemetría.
- Las APIs con secretos pasan por backend o Edge Functions.
- Todo proveedor externo debe tener validación de host, autenticación cuando corresponda, timeout, presupuesto, límites, tamaño máximo, parse seguro y fallo parcial explícito.
- Una caída, timeout, 429, 5xx, respuesta inválida o proveedor no configurado nunca equivale a aprobación, rechazo factual ni resolución.
- Los valores de secretos no se imprimen, comparan en logs ni copian a prompts. Las comprobaciones operativas se limitan a presencia, nombre o digest cuando el contrato lo permita.

### 5.4 Integridad económica y de mercado

- Karma es ficticio y permanece separado de cualquier hipotético saldo monetario futuro.
- Predicciones, cotizaciones, descuentos, devoluciones, retornos y Prestigio se calculan o validan de forma autoritativa en servidor.
- Las operaciones críticas son atómicas, idempotentes y seguras ante doble clic, reintentos y concurrencia.
- Ningún mercado se publica o programa sin validación vigente de claridad, coherencia, cierre, resolubilidad y elegibilidad.
- Ningún agente puede autoaprobar, confirmar humanamente, publicar, programar, resolver o liquidar.
- Cambiar contenido material, versión, huella, revisión, candidata o check de elegibilidad invalida cualquier atestación incompatible.
- Las revisiones no se reutilizan por similitud textual. La reutilización exige equivalencia canónica, versión compatible y huella válida.
- Un estado técnico no puede persistirse como hecho terminal ni reemplazar el último estado válido sin una marca honesta de degradación.

### 5.5 Agent Engine V2.1 y AI Gateway

- Toda inferencia nueva atraviesa `supabase/functions/_shared/ai/`; una Edge de dominio no elige por su cuenta modelo, schema, timeout, retry, fallback, presupuesto o huella.
- El cambio de modo es por tarea. No se admite un flag global capaz de apagar o desviar todas las tareas.
- `legacy_direct` conserva compatibilidad. `gateway_gemini_parity` exige presupuesto medido. `gateway_routing` permanece inaccesible hasta promoción expresa.
- OpenRouter y NVIDIA NIM solo pueden recibir `public_market`, con modelo y endpoint exactos, secreto presente, capability discovery vigente, presupuesto positivo y structured output compatible.
- El fallback es exclusivamente técnico. Nunca se consulta otro modelo para superar rechazo, abstención, confianza baja o puerta de seguridad.
- Runtime, herramientas, fetches, Gateway y persistencia comparten un único deadline absoluto con reserva para finalizar.
- El dispatcher debe impedir herramientas no registradas, loops, no progreso, snapshot obsoleto, exceso de replans y más de un writer por ronda.
- Runs, steps, checks e intentos son append-only cuando así lo define su contrato. La purga solo puede ejecutarse mediante el wrapper service-only autorizado, con cortes internos y auditoría.
- Telemetría no almacena prompts, payloads, respuestas crudas, PII, secretos ni razonamiento interno. Un fallo de telemetría no repite una inferencia válida ni cambia su resultado de dominio.
- Radar continúa sin inferencias mientras ese sea el contrato productivo documentado.
- Las huellas de Gateway, Runtime V2 y Registry V2 usan canonicalización versionada: `ATINARA_CANONICAL_JSON_VERSION = "atinara-canonical-json-v1"`. La versión no se incorpora al contenido hasheado ni a datos persistidos; v1 conserva las huellas productivas válidas y cualquier cambio incompatible exige v2, transición explícita y pruebas cruzadas Node/Deno.

### 5.6 Datos y privacidad

- Predicciones activas, posiciones y Karma disponible permanecen privados según el contrato vigente.
- Solo se exponen los datos estrictamente necesarios para cada superficie.
- Los datos persistentes relevantes conservan actor, fecha, versión, motivo, huella y evidencia cuando corresponda.
- El almacenamiento local no es fuente autoritativa para operaciones críticas.
- No se inventan usuarias, mercados, actividad, métricas, resultados o comentarios para rellenar interfaces o pruebas productivas.

### 5.7 Código, migraciones y despliegues

- No se editan migraciones ya aplicadas. Toda evolución usa una migración nueva, compatible, verificable y reversible cuando sea razonable.
- Antes de desplegar o migrar se comparan código, historial local, producción y dependencias.
- No se realizan push, deploy, SQL productivo, reparación de migraciones, cambios de secretos, publicación o resolución sin la autorización exigida por `AGENTS.md`.
- Los cambios de seguridad incluyen pruebas de regresión proporcionales al riesgo.
- Las pruebas productivas priorizan lectura, logs y transacciones con `BEGIN/ROLLBACK`. No alteran datos reales solo para demostrar un caso.

## 6. Hallazgos reportables y severidad

Son hallazgos de seguridad, entre otros, los fallos que permitan o hagan plausible:

- acceso a datos de otra usuaria, mercados privados o funciones administrativas;
- alteración no autorizada de Karma, Prestigio, predicciones, resultados, mercados o liquidaciones;
- bypass de RLS, autorización server-side, confirmación humana o elegibilidad vigente;
- exposición de secretos, sesiones, datos personales o telemetría sensible;
- SSRF, inyección, XSS, ejecución de comandos o código, path traversal o redirección explotable;
- uso de IA o proveedor externo para convertir un fallo técnico en aprobación o resolución de dominio;
- repetición, carrera o doble ejecución que deje un resultado persistente incorrecto;
- confusión de identidad, roles, tenants, productos o fronteras B2B;
- cambio silencioso de modo, ruta, modelo, presupuesto o data class del Gateway;
- mutación o purga no autorizada de un ledger append-only.

La severidad se basa en atacante plausible, alcance, datos o privilegios afectados, persistencia, facilidad de explotación, controles compensatorios reales y exposición del componente. No se eleva ni reduce solo porque el repositorio sea público, una ruta parezca poco usada o una herramienta emita una etiqueta genérica.

## 7. Fuera de alcance o no reportable por sí solo

No constituyen por sí solos vulnerabilidades:

- la ausencia de dinero real, KYC monetario, depósitos o retiradas, porque no forman parte de la beta;
- deuda de estilo, mantenibilidad o UX sin consecuencia de seguridad demostrable;
- hipótesis sin atacante, entrada, control roto e impacto razonablemente establecidos;
- mocks o fixtures no alcanzables desde producción y sin secretos reales;
- identificadores históricos `Oraklo` sin confusión de seguridad, autorización o exposición;
- una tabla privada sin policies cuando se verifica el cierre denegatorio completo descrito en esta política;
- la recomendación de protección de contraseñas filtradas mientras el plan contratado no la permita y existan los controles compensatorios documentados.

Estas exclusiones no autorizan a ocultar un fallo real que atraviese un límite de confianza.

## 8. Limitaciones y controles complementarios

- Atinara evoluciona hacia beta pública; revalida esta política al introducir nuevos servicios, roles, datos o fronteras.
- Los proveedores pueden degradarse o cambiar contratos; sus respuestas requieren validación y estados de fallo explícitos.
- SonarQube, Checkly, pruebas, Sentry y Codex Security son controles complementarios. Ninguno sustituye RLS, autorización server-side, pruebas de integración o revisión humana.
- Los detalles comerciales, límites económicos internos, adjudicaciones de proveedor, corpus privado y estrategia B2B sensible no pertenecen al repositorio público.

## 9. Gestión responsable de cambios de seguridad

Los hallazgos se corrigen en la causa raíz y se validan contra rutas hermanas y estados equivalentes. No se introducen excepciones amplias para silenciar herramientas. Si una corrección cambia un contrato, mantiene compatibilidad o define una transición explícita y recuperable.

No incluyas secretos ni detalles de explotación innecesarios en issues, logs o documentación pública. Cuando un hallazgo afecte a credenciales, propiedad intelectual B2B o una vulnerabilidad no corregida de producción, utiliza un canal privado apropiado antes de publicar detalles.
