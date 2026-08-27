# Instrucciones permanentes de Atinara · B2B-first · nombre interno histórico Oraklo

**Decisión estratégica vigente desde el 27 de agosto de 2026.** Estas instrucciones se aplican a todo el árbol del repositorio y prevalecen sobre secuencias B2C-first anteriores. Codex debe obedecerlas aunque el prompt de una tarea no repita la estrategia. Una conversación antigua, un ZIP previo o un resumen no sustituyen el estado actual del repositorio, Supabase producción ni esta decisión.

## 0. Prioridad B2B-first obligatoria

- **Atinara Engine es desde ahora la prioridad de producto y empresa.** Debe evolucionar hacia una plataforma B2B modular, auditable, configurable, segura, integrable y licenciable.
- **Atinara Social continúa**, pero su función estratégica principal pasa a ser implementación de referencia, demostrador, entorno de dogfooding, banco de pruebas y escaparate real de Atinara Engine. No se abandona ni se degrada.
- El éxito de Atinara ya no depende de construir primero una gran red social propia. El primer wedge comercial prioritario es B2B2C: medios, creadores, comunidades, plataformas, marcas, eventos y organizaciones que ya tengan audiencia y quieran ofrecer experiencias de predicción con puntos ficticios, reputación, rankings y mercados verificables.
- El segundo vertical previsto, condicionado a descubrimiento real, es forecasting privado para equipos y organizaciones. Debe reutilizar el mismo núcleo de Engine sin bifurcar permanentemente el producto.
- No se construirán funciones B2B hipotéticas por prestigio técnico. Toda inversión importante debe responder a una necesidad común del producto, a una puerta de preparación B2B o a evidencia de clientes/pilotos.
- Ningún dinero real, depósito, retirada, saldo real, KYC monetario, wallet, pago o conversión de Karma queda autorizado antes de superar expresamente la Puerta regulatoria R1.
- La especificación completa y el benchmark sectorial están en `docs/ATINARA_B2B_FIRST_BLUEPRINT_20260827.md`. La arquitectura objetivo del motor de negociación está en `docs/ATINARA_EXCHANGE_ENGINE_TARGET_20260827.md`. Ambos deben leerse antes de cambios arquitectónicos, económicos, de seguridad, integración, multi-tenant, white-label, analítica, agentes o comercialización B2B.

## 1. Lectura obligatoria antes de cualquier tarea

Lee completos, en este orden:

1. `AGENTS.md`.
2. `ATINARA_PRODUCT_STRATEGY.md`.
3. `docs/ATINARA_B2B_FIRST_BLUEPRINT_20260827.md`.
4. `docs/ATINARA_EXCHANGE_ENGINE_TARGET_20260827.md`.
5. `ORAKLO_PROJECT_CONTEXT.md`.
6. `README.md`.
7. Para economía o predicción: `LIVE_MARKET_ECONOMY.md`, interpretándolo como contrato productivo histórico/transitorio hasta el cutover de E1, no como arquitectura objetivo B2B.
8. Para identidad o Penpot: `STEP_13_3_LIVE_MARKET_PENPOT_OVERRIDES.md`.
9. Para escrituras de borradores, revisiones o estados: `docs/STATE_CONSISTENCY_AND_MEMORY.md` cuando exista en la rama.

Al retomar una conversación nueva o antigua, vuelve a leerlos. Si un documento histórico contiene la secuencia antigua «13.6 crecimiento B2C → validar Social → 13.7 B2B», esa secuencia se considera **supersedida** por la decisión B2B-first de 2026-08-27. El estado técnico histórico sigue siendo válido cuando esté confirmado por código/producción.

## 2. Fuentes de verdad y continuidad

- Antes de editar, inspecciona `git status`, rama, últimos commits, `origin/main` y diferencias locales.
- Para producción, comprueba Supabase, migraciones, Edge Functions, despliegues y logs reales cuando la tarea lo requiera y exista acceso.
- Conserva cambios locales o remotos ajenos a la tarea. No uses sincronizaciones destructivas.
- El estado técnico cambiante vive en `ORAKLO_PROJECT_CONTEXT.md`; la intención empresarial y de producto vive en `ATINARA_PRODUCT_STRATEGY.md`; el objetivo técnico B2B y las puertas de preparación viven en `docs/ATINARA_B2B_FIRST_BLUEPRINT_20260827.md`; la arquitectura económica objetivo vive en `docs/ATINARA_EXCHANGE_ENGINE_TARGET_20260827.md`.
- Si código, producción y documentación discrepan, verifica el sistema real, identifica la fuente vigente y corrige la memoria dentro del alcance autorizado.
- No repitas auditorías cerradas salvo cambio material, discrepancia o riesgo nuevo.
- No modifiques migraciones ya aplicadas. Todo cambio de esquema utiliza una migración nueva, compatible, verificable y, cuando sea viable, reversible.
- No alteres datos reales, Karma, Prestigio, predicciones, mercados, resoluciones o decisiones humanas sin autorización expresa.

## 3. Identidad y productos

- **Atinara** es la única marca pública. `Oraklo` solo permanece en identificadores técnicos, infraestructura e historial cuando renombrarlo sea arriesgado o innecesario.
- **Atinara Engine** es el producto B2B prioritario y debe preservar propiedad intelectual, modularidad y reutilización entre clientes.
- **Atinara Social** es la primera implementación de referencia del Engine y un producto real con Karma ficticio, Prestigio, reputación, comunidad y mercados verificables.
- Karma es saldo ficticio para participar. Prestigio es reputación histórica y determina el rango. Nunca se presentan como dinero, inversión, rentabilidad o derecho económico futuro.
- Predicciones activas y Karma disponible son privados. Perfil y predicciones liquidadas pueden ser públicos según las reglas vigentes.
- La interfaz debe ser premium, clara, rápida, responsive, accesible, coherente en claro/oscuro y comprensible en español. La arquitectura debe quedar preparada para localización sin hardcodes irreversibles.
- No inventes usuarios, métricas, actividad, comentarios, mercados o resultados. Usa datos reales o estados vacíos honestos.
- Puede aprenderse de patrones de competidores, pero no copiar activos, pantallas, textos, identidad ni lógica propietaria.

## 4. Estrategia B2B obligatoria

Toda propuesta o cambio significativo debe responder a estas prioridades, en este orden:

1. Seguridad, integridad de datos y aislamiento entre organizaciones.
2. Integridad del ciclo de mercado: creación, revisión, fuentes, publicación, seguimiento, cierre, resolución, disputa y auditoría.
3. Modularidad del dominio y capacidad de configuración sin forks por cliente.
4. Time-to-value del cliente: experiencia alojada/embebible, branding, identidad, analítica e integración proporcionadas.
5. Diferenciación de Atinara: IA auditable con control humano + mercados rigurosos + capa social/gamificada + operación profesional.
6. Atinara Social como referencia real y dogfooding del Engine.
7. Crecimiento B2C propio solo cuando ayude a probar, demostrar o mejorar el producto, no como prerrequisito de la vía B2B.
8. Funciones enterprise avanzadas solo cuando exista evidencia de demanda o una puerta de calidad las exija.

Para cada cambio evalúa, cuando sea aplicable:

- impacto por tenant/organización y riesgo de fuga entre clientes;
- RBAC, RLS, autorización servidor y mínimos privilegios;
- separación Karma/dinero real;
- modularidad, API/webhooks/white-label y ausencia de forks permanentes;
- trazabilidad y auditabilidad;
- seguridad, privacidad, retención, exportación y borrado de datos;
- propiedad intelectual y conveniencia de repositorio público o privado;
- calidad de reglas, fuentes, cierres, anulaciones y resoluciones;
- observabilidad, SLA, recuperación, coste y rendimiento;
- dependencia de proveedores, clientes o jurisdicciones;
- accesibilidad, responsive y localización;
- proporcionalidad con la fase actual y evidencia comercial disponible.

## 5. Arquitectura y seguridad

- Frontend actual compatible con GitHub Pages: HTML, CSS y JavaScript sin compilación, hasta que una decisión arquitectónica B2B justificada requiera otra cosa. No migres framework por moda.
- Backend actual: Supabase Auth, Postgres/RLS, RPC y Edge Functions.
- Supabase es la fuente autoritativa del estado persistente. Local/session storage solo puede servir de apoyo visual o recuperación no autoritativa.
- Nunca pongas `service_role`, claves, tokens, secretos ni credenciales en frontend, repositorio, logs o errores.
- APIs externas pasan por backend/Edge Functions con autenticación, autorización, validación, sanitización, allowlists de host, timeout, cuotas, caché, trazabilidad y fallos parciales.
- Un fallo técnico o de proveedor nunca equivale a rechazo factual, aprobación o resolución.
- Operaciones sensibles son atómicas, idempotentes y seguras ante doble clic, reintento y concurrencia.
- No insertes directamente en `predictions` desde frontend; usa los contratos autoritativos de servidor vigentes.
- **Decisión expresa 2026-08-27:** el motor objetivo B2B deja de ser LMSR y pasa a ser un exchange de contratos con CLOB, entrada y salida antes de resolución, órdenes compradoras/vendedoras, fills parciales, cancelación y posiciones negociables con Karma ficticio. El LMSR productivo actual es transitorio y no se elimina ni se altera destructivamente: `lmsr_v1` y `legacy_fixed_v1` deben conservar sus contratos hasta una migración/cutover E1 explícitos y probados.

### 5.1 Multi-tenant y autorización futura

La productización B2B debe seguir un modelo tenant-first, pero sin migración destructiva:

- Introducir organización/tenant mediante migraciones aditivas y compatibilidad; Atinara Social debe poder convertirse en el tenant de referencia sin perder datos.
- La identidad del tenant nunca se confía a un `organization_id` arbitrario enviado por el cliente. Debe derivarse de membresía verificada, claims firmados o contexto de servidor.
- Toda tabla o vista B2B debe tener estrategia explícita de aislamiento. Las pruebas deben incluir al menos dos tenants y accesos cruzados adversariales.
- `authenticated` no equivale a `admin`. Toda RPC administrativa debe comprobar permiso de negocio real y tenant.
- Preferir `SECURITY INVOKER`. Si `SECURITY DEFINER` es imprescindible, fijar `search_path`, validar actor/tenant/permiso, revocar `EXECUTE` por defecto y concederlo solo a roles necesarios.
- Mantener separados control plane, configuración de cliente, datos de usuarios/participación, operación de mercados, analítica e integraciones cuando reduzca riesgo y reescritura.
- SSO SAML/OIDC, SCIM, entornos dedicados u on-premise no son obligatorios para el primer piloto, pero el modelo no debe impedirlos.

### 5.2 AI Gateway y Agent Engine V2.1

- Toda nueva inferencia debe atravesar `supabase/functions/_shared/ai/`; una Edge de dominio no elige por su cuenta modelo, schema, timeout, presupuesto, retry, fallback ni fingerprint.
- Los modos de transporte son por tarea (`legacy_direct`, `gateway_gemini_parity`, `gateway_routing`); no crear un flag global capaz de apagar todas las tareas.
- El Gateway sanea mediante allowlists, calcula huellas y valida tamaño, parse, contrato, dominio y política. No admite coerción silenciosa ni aceptación parcial.
- OpenRouter/NVIDIA NIM siguen experimentales hasta promoción expresa. La ausencia de un proveedor experimental nunca rompe la ruta estable.
- El fallback es técnico, nunca una forma de conseguir aprobación o cambiar una abstención/rechazo de política.
- Telemetría y trazas no almacenan prompts crudos, respuestas, PII, secretos ni cadena de pensamiento.
- Runs, steps e intentos sensibles deben ser trazables y, cuando corresponda, append-only.
- La IA descubre, investiga, clasifica, redacta y propone. **Nunca** confirma, publica, programa, resuelve o liquida sin la intervención humana exigida.
- La ventaja B2B de Atinara debe ser una IA verificable y gobernada, no un agente autónomo que oculte incertidumbre o fabrique evidencia.

## 6. Mercados, fuentes y resolución

Todo mercado debe definir sin ambigüedad: sujeto, acontecimiento, periodo, zona horaria, tipo de contrato, opciones/outcomes, criterios de cada outcome, casos límite, fuentes, cierre, anulación, conflictos de fuentes y plan de resolución. `Sí/No` es solo el caso binario, no una suposición universal del dominio.

Tipos mínimos del modelo objetivo:

- **binary:** un hecho Sí/No;
- **categorical_single_winner:** N outcomes mutuamente excluyentes con un único ganador, incluyendo `Otro/Ninguno` cuando sea necesario para que el conjunto sea exhaustivo;
- **binary_family:** familia de mercados binarios hermanos para umbrales, fechas, strikes o condiciones que no deban forzarse artificialmente a un único ganador.

No conviertas un mercado categórico en N preguntas independientes si ello rompe exclusividad, colateral, resolución o UX; tampoco unas como categóricas opciones que puedan cumplirse simultáneamente.

- Distingue duplicados reales de mercados hermanos, fechas, umbrales y opciones de una misma familia.
- No reutilices revisiones por coincidencia textual: exige equivalencia canónica, versión compatible y huella válida.
- Las fuentes deben tener una función explícita: descubrimiento, verificación, resolución o contexto. No confundir popularidad con autoridad factual.
- Criterios y fuentes de resolución deben quedar versionados/huellados y, cuando proceda, bloqueados antes de aceptar participación.
- Conserva actor, fecha, motivo, versión, huella y evidencias de decisiones materiales.
- Ningún corrector sortea puertas de seguridad, rebaja requisitos, fabrica evidencia ni autoaprueba para terminar en verde.

## 7. Calidad profesional y reparación experta

### 7.1 Causa raíz

- Ante una incidencia identifica causa raíz y clase general del problema. No optimices solo para el ejemplo que la hizo visible.
- Revisa interfaz, dominio, backend, datos, Auth, RLS, RPC, Edge, caché, concurrencia, integraciones, accesibilidad, rendimiento, observabilidad y producción según el riesgo.
- Soluciona el patrón, no mediante `if` por caso conocido, allowlists improvisadas, textos especiales o hardcodes que sustituyan reglas de dominio.
- Preserva datos, decisiones válidas y cambios ajenos. Si cambia un contrato, diseña compatibilidad o transición segura.
- Antes de eliminar tablas, funciones, estados, campos o código, localiza dependencias y define recuperación.
- Evita lógica duplicada, valores mágicos, funciones vacías, TODO productivo, mocks en producción, fallos silenciosos y falsos éxitos.

### 7.2 Agentes expertos y correctores

- Combina políticas versionadas, reglas deterministas, datos verificables, fuentes explícitas, precedentes aprobados, herramientas permitidas e incertidumbre declarada.
- Separa diagnóstico, política, propuesta, aplicación, revalidación y auditoría.
- Si una reparación está autorizada y puede hacerse de forma segura, aplícala de forma general, registra el cambio y vuelve a validar.
- Si no puede repararse con seguridad, detente en un estado honesto, accionable y trazable.
- Las decisiones reutilizables viven en dominio/políticas/componentes compartidos, no enterradas en prompts o ramas de frontend.

### 7.3 Protocolo obligatorio de impacto transversal

**Toda petición de cambio, por pequeña que parezca, exige comprobar qué la rodea antes de editar.** Codex no debe corregir una pantalla o función de forma aislada si el contrato real cruza otras capas.

Antes de implementar:

1. identificar fuente de verdad y contrato vigente;
2. buscar todas las referencias, callers, writers, readers, tests, migraciones y documentación del concepto afectado;
3. trazar impacto en UI, dominio, base de datos, RPC, Edge Functions, Auth/RLS/RBAC, Realtime, caché, analítica, integraciones, tenants, accesibilidad, responsive y rendimiento según corresponda;
4. detectar supuestos ocultos que el cambio invalide, especialmente hardcodes binarios `Sí/No`, estados de lifecycle, permisos, idempotencia, privacidad o versiones económicas;
5. definir compatibilidad con datos/posiciones/mercados existentes, rollback y criterios de aceptación;
6. preservar cambios ajenos y no editar migraciones aplicadas.

Durante la implementación:

- cambia el contrato compartido en el nivel correcto, no mediante parches divergentes por pantalla;
- evita duplicar lógica entre frontend, RPC y Edge;
- si una nueva capacidad requiere adaptar consumidores, haz la transición completa o introduce versionado/compatibilidad explícita;
- ningún cambio de mercado puede dejar creación, trading, cierre, resolución, histórico, analítica o UI interpretando estructuras diferentes.

Después:

- busca referencias obsoletas y ramas muertas;
- prueba happy path, errores, concurrencia/idempotencia, permisos, tenant isolation y regresión del contrato anterior;
- para cambios económicos, prueba conservación de colateral/inventario, prioridad de matching, partial fills, cancelaciones, salida y settlement;
- para multi-outcome, prueba exclusividad/exhaustividad, ganador único, anulaciones y familias no exclusivas;
- actualiza documentación/memoria y no declares terminado mientras una capa afectada quede sin adaptar o sin verificar.

## 8. Puertas B2B de producto y calidad

Codex no debe presentar Atinara como «lista para vender a empresas» hasta superar las puertas definidas en el blueprint:

- **S1 Seguridad y aislamiento:** inventario de permisos/RPC/RLS, modelo tenant, RBAC, pruebas cross-tenant y eliminación de exposiciones no justificadas.
- **A1 Arquitectura:** límites de dominio, tenant/configuración, compatibilidad de Atinara Social y ausencia de forks por cliente.
- **E1 Exchange Engine:** CLOB ficticio funcional, ledger/colateral, órdenes/fills/posiciones, entrada/salida, liquidez bootstrap, binary + categorical + familias, settlement y transición segura desde LMSR.
- **P1 Producto B2B:** ciclo real end-to-end bajo tenant desde configuración, trading y salida hasta analítica y resolución.
- **I1 Integración:** experiencia alojada/embebible, identidad e integración mínima documentada; API/webhooks según necesidad real.
- **O1 Operación:** observabilidad, backups, recuperación, runbooks, rendimiento, cuotas, errores parciales y rollback.
- **C1 Comercial:** ICP validado, propuesta de piloto, métricas de éxito, documentación de privacidad/seguridad y precio como hipótesis contrastada.

Las puertas no autorizan por sí mismas despliegues, SQL productivo o cambios remotos. Yol conserva la decisión de iniciar cada fase.

## 9. Pruebas y definición de terminado

- Define criterios de aceptación antes de implementar cambios significativos.
- Ejecuta pruebas proporcionales al riesgo sobre lógica, integración real, proveedores, permisos, RLS, tenants, migraciones, concurrencia, idempotencia, regresión, accesibilidad, responsive, rendimiento y fallos parciales.
- Los mocks apoyan; no sustituyen la ruta real cuando sea verificable.
- Para multi-tenant, incluye pruebas negativas de acceso cruzado y autorización por rol.
- En producción prioriza lecturas, logs y pruebas transaccionales con rollback. No alteres datos reales para demostrar que una prueba pasa.
- No declares algo corregido, desplegado, activado, seguro o terminado sin evidencia.
- Terminado exige: causa raíz conocida; implementación completa; aceptación cumplida; pruebas relevantes verdes; sin regresiones materiales conocidas; datos/permisos protegidos; documentación/memoria actualizadas; producción comprobada cuando corresponda; riesgos residuales explicados.

## 10. Forma de trabajo acordada

### Control de consumo y subagentes

- Por defecto, cada tarea se ejecuta en el hilo principal. Mantén `agents.enabled = false` en `.codex/config.toml`.
- No lances subagentes, tareas paralelas o ejecuciones independientes salvo autorización expresa de Yol en el prompt actual.
- Un worktree solo aísla el checkout; no autoriza duplicar chats o agentes para el mismo encargo.
- Si Yol autoriza un subagente, limita concurrencia a uno y úsalo para investigación/revisión/pruebas independientes de solo lectura; un único implementador modifica archivos.

### Ejecución general

- Un único implementador por tarea.
- Inspecciona antes de cambiar y limita alcance.
- Reutiliza comprobaciones recientes de Work/GitHub/Supabase; verifica solo lo cambiado o riesgoso.
- No hagas push, deploy, SQL productivo, activaciones, cambios de secretos ni mutaciones externas salvo autorización expresa.
- Tras JavaScript, comprueba sintaxis. Revisa HTML/CSS, rutas, flujo, `git diff --check` y pruebas específicas.
- Para cambios visuales valida escritorio y móvil y conserva versionado de recursos para evitar caché antigua.
- Al cerrar un hito importante actualiza la memoria técnica/estratégica afectada.
- No inicies una fase nueva del roadmap por tu cuenta. Yol decide cuándo continuar.

### Entregas manuales para GitHub

- Yol suele subir personalmente los archivos preparados.
- Los ZIP contienen solo archivos modificados/añadidos/creados, conservando rutas y sin carpeta envolvente.
- Si superan 100 archivos, dividir en paquetes/commits coherentes y numerados.
- Entrega lista exacta de archivos, migraciones, Edge Functions, secretos y pasos manuales.
- Enumera aparte cualquier archivo a eliminar.
- Excluye `.git`, `node_modules`, `.env`, secretos, credenciales, temporales y ZIP antiguos.

## 11. Criterios que nunca deben romperse

- Auth, cabecera y perfil real.
- Descuento real de Karma al confirmar y persistencia tras recargar.
- Contador basado en `closes_at`, cierre automático y bloqueo tras vencimiento.
- Resolución atómica con devolución/retorno y Prestigio nunca inferior a cero.
- Posiciones `lmsr_v1` y `legacy_fixed_v1` conservan sus contratos vigentes; nunca se reinterpretan como órdenes CLOB ni se reescriben retroactivamente.
- Tras el cutover E1, los mercados nuevos del vertical Audience usan el motor exchange versionado, no LMSR, salvo excepción explícita y documentada.
- Una posición exchange puede reducirse o cerrarse antes de resolución mediante venta/contrapartida real del libro; no se simula una salida con precio inventado.
- Órdenes, fills, reservas de Karma, posiciones y settlement son autoritativos, atómicos, idempotentes y usan aritmética fixed-point/decimal segura, nunca floats monetarios.
- Mercados anulados restauran el valor/collateral ficticio que corresponda al contrato versionado y no alteran Prestigio de forma arbitraria.
- Precios, bid/ask, spread, último trade e histórico proceden de órdenes/fills reales; no se inventan fluctuaciones.
- El dominio no hardcodea `Sí/No`: binary es un adapter/caso especial; categorical y binary_family deben recorrer creación, trading, cierre, resolución, analítica y UI.
- Fuentes visibles/verificables y válidas según el contrato.
- Pregunta, opciones, criterios, periodo, cierre y fuentes coherentes antes de publicar.
- Mercados ambiguos, vencidos, no verificables o no resolubles permanecen privados o se rechazan.
- Ranking y perfiles usan datos reales. Predicciones activas nunca públicas.
- Compatibilidad con GitHub Pages mientras siga aprobada.
- Ninguna capacidad B2B puede introducir fuga entre tenants o rebajar permisos existentes.

## 12. Secuencia estratégica vigente desde 2026-08-27

```text
Cerrar de forma segura cualquier trabajo 13.5.x ya en curso
        ↓
13.6 · B2B Discovery & Readiness
  ├─ ICP y propuesta de valor
  ├─ S1 seguridad/aislamiento
  ├─ A1 arquitectura tenant-first
  ├─ E1 Exchange Engine (CLOB + multi-outcome + entrada/salida)
  ├─ P1 demo B2B real sobre Atinara Social
  └─ paquete de piloto y métricas
        ↓
Primer piloto B2B controlado (preferentemente pagado)
        ↓
13.7 · Productización y escalado de Atinara Engine
  ├─ multi-tenant/configuración
  ├─ white-label/embebible
  ├─ API/webhooks/SSO según demanda
  ├─ analítica y operación
  └─ seguridad/reliability/comercialización
        ↓
Expansión a segundo vertical: forecasting privado, si discovery lo valida
        ↓
Puerta regulatoria R1
        ↓
Solo con R1 favorable y autorización expresa:
funciones con valor económico real
```

**Atinara Social continúa durante toda la secuencia como implementación de referencia, producto real y laboratorio. No es necesario alcanzar gran tracción B2C antes de trabajar en Atinara Engine.**
