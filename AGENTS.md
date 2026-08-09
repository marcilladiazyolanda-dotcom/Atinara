# Instrucciones permanentes de Atinara · nombre interno histórico Oraklo

Estas instrucciones se aplican a todo el árbol del repositorio. Codex debe obedecerlas aunque el prompt de una tarea no repita la estrategia. Una conversación antigua o un resumen previo no sustituyen el estado actual del repositorio.
La estrategia de producto es común a Chat, Pro, Work y Codex. Al retomar cualquier conversación del proyecto, nueva o antigua, debe aplicarse el estado vigente aunque el prompt concreto no lo repita. La documentación canónica y los sistemas reales prevalecen sobre transcripciones antiguas.

## 1. Lectura obligatoria antes de cualquier tarea

Lee completos, en este orden:

1. `AGENTS.md`.
2. `ORAKLO_PROJECT_CONTEXT.md`.
3. `ATINARA_PRODUCT_STRATEGY.md`.
4. `README.md`.
5. Para economía o predicción: `LIVE_MARKET_ECONOMY.md`.
6. Para identidad o Penpot: `STEP_13_3_LIVE_MARKET_PENPOT_OVERRIDES.md`.
7. Para escrituras de borradores, revisiones o estados: `docs/STATE_CONSISTENCY_AND_MEMORY.md` cuando exista en la rama.

Al retomar una conversación nueva o antigua, vuelve a leer estos archivos. No trabajes únicamente desde el transcript, una memoria externa, un ZIP anterior o una descripción del usuario si puedes verificar el sistema real.

## 2. Fuentes de verdad y continuidad

- Antes de editar, inspecciona `git status`, rama, últimos commits, `origin/main` y diferencias locales.
- Para producción, comprueba Supabase y los despliegues reales cuando la tarea lo requiera y exista acceso.
- Conserva cambios locales o remotos ajenos a la tarea. No uses sincronizaciones destructivas.
- Si una conversación antigua parte de una rama desactualizada, compara con `origin/main` antes de actuar. La estrategia vigente de `ATINARA_PRODUCT_STRATEGY.md` en la rama canónica prevalece salvo que Yol indique expresamente que está cambiándola.
- El estado técnico cambiante se documenta en `ORAKLO_PROJECT_CONTEXT.md`; la intención de producto y empresa se documenta en `ATINARA_PRODUCT_STRATEGY.md`.
- Si código y documentación discrepan, verifica el código y el sistema real, explica la discrepancia y corrige la memoria dentro del alcance autorizado.
- No repitas funcionalidades ni auditorías ya cerradas salvo cambio material, discrepancia o necesidad proporcional al riesgo.

## 3. Identidad y producto actual

- **Atinara** es la única marca pública. `Oraklo` se conserva únicamente en identificadores técnicos, infraestructura e historial cuando renombrarlo resulte arriesgado o innecesario.
- Atinara es una red social competitiva de predicciones con varias categorías, no solo gaming.
- Karma es saldo ficticio para participar. Prestigio es reputación histórica y determina el rango.
- Durante la beta no hay depósitos, retiradas, compra de Karma ni dinero real.
- El Karma no es convertible a euros, no genera derechos económicos y nunca debe prometer valor futuro.
- Una futura modalidad regulada, si llega a existir, tendrá saldo, cuentas y controles separados del Karma.
- La reputación, precisión, historial, Prestigio, rangos, especialidades e insignias sí deben poder conservar valor reputacional.
- La interfaz pública debe ser premium, clara, accesible y propia de Atinara. Puede aprender de patrones de Polymarket o Kalshi, pero no copiar sus activos, pantallas o identidad.
- Evita estética y lenguaje de casino, promesas de beneficio, inversión, rentabilidad, cripto agresiva o esports genérico.
- Predicciones activas y Karma disponible son privados. Perfil y predicciones liquidadas pueden ser públicos según las reglas vigentes.
- No inventes usuarios, métricas, actividad, comentarios, mercados o resultados. Usa datos reales o estados vacíos honestos.
- La interfaz y los mensajes para usuarias deben estar en español y no mostrar errores técnicos crudos.

## 4. Intención estratégica obligatoria

Toda propuesta, revisión o cambio debe tener en cuenta la visión completa de `ATINARA_PRODUCT_STRATEGY.md`:

- Atinara Social debe ser un producto completo y viable con Karma ficticio.
- El Paso 13.6 prepara captación, beta, atribución, onboarding, analítica, feedback, retención, referidos y Temporada Cero.
- Tras validar la beta, el Paso 13.7 prepara **Atinara Engine**, una infraestructura B2B modular y licenciable a operadores regulados, proveedores, agregadores, medios o instituciones.
- La vía preferente a estudiar combina Atinara Social, Atinara Engine y un operador regulado asociado. Winamax es solo un ejemplo de posible cliente.
- Ningún dinero real, depósito, retirada, KYC monetario o motor monetario queda autorizado antes de superar expresamente la Puerta regulatoria R1.
- La meta empresarial es generar ingresos recurrentes y una actividad profesional sostenible sin vender innecesariamente el núcleo ni depender de un único cliente.

Para cada cambio significativo evalúa y documenta, cuando sea aplicable:

1. Impacto en Atinara Social y en la beta.
2. Separación Karma/dinero real.
3. Modularidad y ausencia de acoplamiento innecesario.
4. Trazabilidad y auditabilidad.
5. Seguridad, privacidad e integridad.
6. Propiedad intelectual y conveniencia de repositorio público o privado.
7. Posible evolución a API, webhooks, marca blanca o configuración por operador.
8. Calidad de reglas, fuentes, cierres, anulaciones y resoluciones.
9. Dependencias de proveedores, clientes o jurisdicciones.
10. Proporcionalidad: no sobredimensionar ahora una función futura.

Pensar en el futuro B2B no autoriza a añadir funciones fuera del alcance. Obliga a evitar callejones sin salida y a señalar deuda técnica relevante.

## 5. Arquitectura y seguridad actuales

- Frontend estático compatible con GitHub Pages: HTML, CSS y JavaScript sin compilación, salvo decisión futura expresa y documentada.
- Backend: Supabase Auth, Postgres/RLS, RPC y Edge Functions.
- Nunca pongas claves, `service_role`, secretos de Supabase ni claves de proveedores en el frontend o repositorio.
- Las APIs externas se consultan desde Edge Functions con autenticación, autorización, hosts permitidos, límites, caché y fallos parciales según el contrato vigente. El navegador no actúa como proxy de secretos.
- Ninguna métrica externa modifica directamente la economía de Atinara.
- Las operaciones económicas o de liquidación son atómicas y autoritativas en Supabase. El frontend solo ayuda a validar y mostrar.
- No insertes directamente en `predictions` desde el frontend; usa los RPC autoritativos vigentes, como `place_prediction`.
- El mercado vivo usa cotización LMSR versionada. Precio, impacto, contratos, retorno, bonus y Prestigio se calculan en servidor; si la versión cambia, la usuaria revisa una nueva cotización.
- Durante la beta no hay venta, salida anticipada, cambio de posición, cobertura, libro de órdenes ni mercado secundario salvo autorización posterior expresa.
- No expongas funciones protegidas de administración o resolución a clientes públicos.
- La IA investiga, clasifica y propone; nunca aprueba, publica, liquida o resuelve por sí sola cuando el contrato exige confirmación humana.
- Ningún mercado se publica o programa sin validación vigente de claridad, coherencia y resolubilidad en servidor. Un cambio esencial invalida la aprobación anterior.
- Temporadas y schedulers permanecen en el estado documentado y solo se activan mediante autorización expresa.

## 6. Calidad profesional, reparación experta y auditabilidad

### 6.1 Causa raíz y solución general

- Ante cualquier incidencia identifica primero la **causa raíz** y la **clase general del problema**. No optimices únicamente para el ejemplo que hizo visible el fallo.
- Antes de modificar, determina qué capas pueden estar implicadas: interfaz, dominio, backend, datos, Auth, RLS, RPC, Edge Functions, caché, concurrencia, proveedores externos, accesibilidad, rendimiento, observabilidad y producción.
- La corrección debe resolver el patrón de fallo y los estados equivalentes previsibles. No se aceptan listas cerradas de excepciones, `if` por caso conocido, textos especiales, allowlists improvisadas ni hardcodes utilizados como sustituto de una regla de dominio.
- Preserva comportamientos válidos, datos existentes y decisiones ajenas al alcance. Si cambia un contrato, crea compatibilidad o una transición explícita y segura.
- Antes de eliminar o sustituir código, tablas, funciones, estados o campos, localiza dependencias y define recuperación o reversión.
- Evita lógica duplicada, valores mágicos, funciones vacías, TODO en rutas productivas, mocks o fixtures en producción, fallos silenciosos y estados de éxito que no correspondan con el resultado real.
- Un error técnico, timeout, respuesta inválida o caída de proveedor nunca equivale a una aprobación, un rechazo factual ni una resolución. Debe existir un estado explícito y recuperable de indisponibilidad o revisión.

### 6.2 Agentes expertos y correctores

- Los agentes expertos deben combinar políticas versionadas, reglas deterministas, datos verificables, fuentes con función explícita, precedentes aprobados, herramientas permitidas e incertidumbre declarada. No deben depender de una colección cerrada de casos particulares.
- Separa diagnóstico, decisión de política, propuesta de corrección, aplicación, revalidación y auditoría. Una etapa no debe falsear el resultado de otra.
- Si un detector o corrector encuentra una incidencia y la reparación está dentro del alcance autorizado, debe diagnosticar su causa, aplicar una corrección general cuando sea seguro hacerlo, registrar qué cambió y volver a ejecutar las validaciones afectadas.
- Si la reparación automática no puede realizarse con seguridad, debe detenerse en un estado honesto y accionable con causa, evidencia y siguiente acción. No debe fingir éxito, ocultar la limitación ni degradar silenciosamente la validación.
- Ningún corrector puede sortear una puerta de seguridad, rebajar un requisito, fabricar evidencia o autoaprobar un mercado para conseguir que el flujo termine en verde.
- La autonomía técnica no sustituye las confirmaciones humanas exigidas. Ningún agente publica, programa, resuelve o liquida mercados sin la intervención humana establecida por el contrato.
- Las decisiones reutilizables deben expresarse como reglas de dominio, políticas o componentes compartidos, no como conocimiento enterrado en prompts, cadenas de texto o ramas específicas del frontend.

### 6.3 Calidad B2B y auditabilidad

- Mantén trazabilidad de creación, edición, revisión, aprobación, publicación, cierre, anulación y resolución.
- Usa versiones, locks, idempotencia y operaciones transaccionales en escrituras sensibles.
- Conserva evidencias y fuentes de resolución verificables.
- Aplica mínimos privilegios y separación de funciones.
- Separa razonablemente interfaz, dominio, reglas de mercado, resolución, identidad, datos, analítica e integraciones cuando ello reduzca reescrituras o riesgos.
- Antes de añadir lógica diferencial B2B o integraciones de operadores al repositorio público, evalúa y señala si debe residir en un repositorio privado.
- Favorece contratos y límites que permitan futuras APIs, webhooks, adaptadores, configuración por operador o marca blanca sin bifurcar permanentemente el producto.
- No construyas infraestructura B2B prematura ni sacrifiques accesibilidad, rendimiento, claridad u onboarding por escenarios todavía no validados.
- Evita dependencia innecesaria de un único proveedor, cliente o jurisdicción. Cuando una dependencia sea necesaria, encapsúlala tras contratos y fallos controlados.

### 6.4 Pruebas y definición de terminado

- Define criterios de aceptación verificables antes de implementar una corrección significativa o una función nueva.
- Ejecuta pruebas proporcionales al riesgo sobre lógica, integración, contratos de proveedores, permisos, RLS, migraciones, concurrencia, idempotencia, regresión, accesibilidad, responsive, rendimiento y fallos parciales.
- Las pruebas deben recorrer la ruta real implementada. Los mocks sirven como apoyo, no como sustituto de comprobar la integración real cuando esta pueda verificarse.
- En producción prioriza lecturas, observación de logs o pruebas transaccionales con rollback. No alteres datos reales solo para demostrar que una prueba pasa.
- No declares algo corregido, activo, desplegado o terminado sin evidencia verificable.
- Un trabajo solo está terminado cuando: se conoce la causa raíz; la implementación es completa y no decorativa; se cumplen los criterios de aceptación; pasan las pruebas relevantes; no existen regresiones materiales conocidas; permisos, seguridad y datos quedan protegidos; la documentación y memoria afectadas están actualizadas; producción se ha comprobado cuando forma parte del alcance; y los riesgos residuales se explican.
- Si una prueba falla, una integración no puede verificarse o queda una limitación material, indícalo expresamente y no presentes la tarea como terminada.

## 7. Forma de trabajo acordada

- Un único implementador por tarea. No coordines dos agentes editando los mismos archivos simultáneamente.
- Inspecciona antes de cambiar y limita el alcance a lo pedido.
- Work puede haber revisado GitHub, Supabase, SQL, pruebas o producción. No repitas esas comprobaciones sin necesidad; reutiliza evidencia vigente y verifica solo lo afectado o riesgoso.
- Usa migraciones SQL versionadas para cambios de esquema. No edites ni repitas migraciones ya aplicadas.
- No hagas `push`, despliegues, SQL productivo, activaciones, secretos o mutaciones externas salvo autorización expresa de Yol.
- Tras cambios JavaScript, comprueba sintaxis. Revisa también HTML/CSS, rutas, flujo afectado y `git diff --check`.
- Ejecuta las pruebas indicadas por el repositorio y las específicas del riesgo. Documenta lo que no pueda ejecutarse.
- Para cambios visuales, valida escritorio y móvil en proporción al riesgo y conserva el versionado de recursos para evitar caché antigua.
- Al cerrar un hito importante, actualiza `ORAKLO_PROJECT_CONTEXT.md`. Si cambia la estrategia, actualiza también `ATINARA_PRODUCT_STRATEGY.md` y este archivo.
- No inicies por tu cuenta una fase nueva del roadmap. Yol decide cuándo continuar.

### Entregas manuales para GitHub

- Yol suele subir personalmente los archivos preparados.
- Cuando se solicite ZIP, incluye **solo archivos modificados, añadidos o creados**, conservando sus rutas. No incluyas todo el repositorio.
- Si la entrega supera 100 archivos, divídela en dos paquetes o grupos de commit claramente numerados y documenta el orden.
- Entrega una lista exacta de archivos, migraciones, Edge Functions, secretos y pasos manuales.
- Enumera por separado cualquier archivo que deba eliminarse. No incluyas `.git`, `node_modules`, `.env`, secretos, credenciales, temporales ni ZIP antiguos.

## 8. Criterios que nunca deben romperse

- Auth, cabecera y perfil real.
- Descuento real de Karma al confirmar y persistencia tras recargar.
- Contador basado en `closes_at`, cierre automático y bloqueo tras vencimiento.
- Resolución atómica con devolución o retorno y Prestigio nunca inferior a cero.
- Posiciones `lmsr_v1`: cada contrato acertado liquida según el contrato vigente, con bonus de dificultad separado. Posiciones `legacy_fixed_v1`: conservan sus condiciones históricas.
- Mercados anulados: devolución íntegra del Karma y sin cambio de Prestigio.
- Precios Sí/No coherentes con el modelo vigente; el histórico nunca se rellena con fluctuaciones inventadas.
- Fuentes visibles, verificables y válidas según el contrato de resolución.
- Pregunta, opciones, criterios, periodo, cierre y fuentes coherentes antes de publicar.
- Mercados ambiguos, vencidos, no verificables o no resolubles permanecen privados o se rechazan.
- Ranking y perfiles basados en datos reales. Predicciones activas nunca públicas.
- Compatibilidad con GitHub Pages mientras siga siendo la arquitectura aprobada.

## 9. Secuencia estratégica vigente

```text
Cerrar y estabilizar el Paso 13.5.2
        ↓
Paso 13.6 · Infraestructura de Beta y Crecimiento
        ↓
Validación real de Atinara Social
        ↓
Paso 13.7 · Productización B2B y preparación para operadores
        ↓
Puerta regulatoria R1
        ↓
Solo con resultado favorable y autorización expresa:
modalidad regulada con valor económico
```

Consulta `ORAKLO_PROJECT_CONTEXT.md` para saber qué parte está realmente cerrada, desplegada o pendiente. No deduzcas el estado desde esta secuencia ni desde una conversación antigua.
