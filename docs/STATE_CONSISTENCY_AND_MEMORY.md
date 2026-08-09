# Memoria y consistencia de estado

Este documento fija el contrato autoritativo de Gestión de mercados desde el Paso 13.5.2. Supabase producción es la fuente de verdad. El DOM, `localStorage` y `sessionStorage` nunca acreditan una versión, una revisión, una confirmación, un binding ni una publicación.

## Invariantes

### Contenido y huella

`private.market_draft_canonical_payload` produce el único payload editable canónico. La política `sha256-canonical-v2`:

- normaliza CRLF/CR a LF, espacios equivalentes, extremos vacíos y `null`;
- representa todos los instantes en UTC con precisión estable de milisegundos;
- conserva la zona IANA como un campo semántico separado;
- ordena recursivamente los objetos JSON;
- deduplica las fuentes alternativas por URL y las ordena cuando el orden no tiene significado;
- conserva roles y precedencias en el Plan de Resolución, donde sí son semánticos;
- incluye los campos editables que no siempre están visibles en la pantalla.

El frontend renderiza `datetime-local` con `step="0.001"` y envía `_timestamp_precision="milliseconds-v1"`. Así se distinguen una edición deliberada a `:00.000` de un cliente antiguo que solo sabía enviar minutos. Los clientes antiguos conservan temporalmente la protección `market_datetime_preserve_precision`; los nuevos envían y aceptan el instante exacto.

### Versiones materiales

`private.market_draft_versions` conserva un snapshot fuente y otro canónico por `(draft_id, content_version)`, su SHA-256, política, esquema, origen, actor, fecha y evidencia de recuperación. Un trigger impide `UPDATE` y `DELETE`.

Un guardado cuyo payload canónico coincide es un no-op: no cambia la fila, no incrementa `content_version`, no crea snapshot y conserva revisión y confirmación. Restaurar una versión siempre crea una versión material nueva y referencia `restored_from_version_id`; nunca reescribe el pasado.

### Revisión efectiva e intentos

`private.market_review_attempts` registra cada ejecución, incluidos `invalid_response`, cuota, timeout, 5xx, red, autenticación del proveedor y respuestas obsoletas. `private.market_effective_reviews` registra por separado el último veredicto aprobado que puede gobernar el contenido actual.

Una incidencia técnica solo actualiza el último intento. Si existe una aprobación aplicable, el borrador conserva `review_approved` o `human_confirmed`; si no existe, queda `draft_ready`. Una incidencia nunca se convierte en rechazo de contenido y nunca abre el Corrector Experto.

Una revisión es reutilizable únicamente si coinciden la huella canónica, `policy_version`, `schema_version`, una entrada vigente y reutilizable de `market_review_policy_compatibility`, y no existe revocación. La recuperación puntual del incidente de precisión se identifica mediante una base de compatibilidad explícita, exige el antiguo MD5 exacto, el binding vigente y un diff limitado a `evaluation_ends_at`/`closes_at`.

### Confirmación y publicación

La confirmación humana queda unida a la huella y al `effective_review_id`. Repetir exactamente la misma confirmación es un no-op. Cualquier cambio material la borra. Publicar o programar vuelve a comprobar dentro de la misma transacción:

- versión esperada;
- SHA-256 actual;
- aprobación efectiva vigente;
- confirmación para esa huella y esa revisión;
- compatibilidad del Plan de Resolución;
- periodo todavía abierto;
- procedencia Radar inmutable, cuando exista;
- comprobación factual v2 `revalidate` vigente, `unresolved` y enlazada por
  candidata, revisión, política, contexto, evidencia y huellas;
- rol administrativo.

## Concurrencia e idempotencia

Cada guardado usa `expected_version` y una UUID de idempotencia. `private.market_workflow_requests` vincula actor, operación, clave y hash de petición. Repetir la misma petición devuelve la respuesta guardada; reutilizar una clave con otro payload falla; dos claves concurrentes sobre la misma versión se serializan mediante `FOR UPDATE` y solo una puede mutar.

Las revisiones usan una UUID de intento, una restricción de intento activo por versión y comprobación de versión/huella al finalizar. Una respuesta tardía se registra como `stale` y no pisa el estado nuevo. Los botones se bloquean durante la operación, pero la seguridad no depende del frontend.

## Recuperación

Para recuperar estado desde otro navegador se usa `get_admin_market_draft`. Devuelve borrador, revisión efectiva, último intento, historial de intentos, snapshots, binding, fuentes con roles y precedencia, compatibilidad y auditoría. No se reconstruye autoridad desde caché local.

Una recuperación normal de una versión usa `restore_market_draft_version`. La reparación puntual del incidente heredado usa `restore_market_draft_review_memory`; falla de forma cerrada si no puede demostrar la equivalencia y nunca llama a Gemini, confirma ni publica.

## Separación de lectura, análisis y avance

Desde `harden_expert_market_cycle_v1`, leer y analizar una candidata Radar nunca
reservan una revisión ni sustituyen su hecho autoritativo. Son operaciones
distintas:

- `get_market_intelligence_origin` devuelve siempre un expediente administrable
  y un `advancement_gate`; un bloqueo factual impide avanzar, no diagnosticar.
- `market-expert` puede guardar un dictamen bloqueado, pero solo un paquete
  vigente con ambas capacidades explícitas permite iniciar `prepare`.
- un `prepare` negativo se registra mediante
  `record_market_radar_prepare_attempt_v1` como snapshot append-only desligado;
  el puntero, la revisión y el estado autoritativos permanecen sin cambios;
- la persistencia del Radar aísla solo errores de fila y deja visibles los IDs
  externos cuarentenados o diferidos; cada final de proveedor queda en historia
  append-only además del snapshot operativo;
- el Corrector solicita primero una revisión v3 compatible con versión, huella,
  política y esquema. Un rechazo v2 puede mostrarse como historia, pero nunca
  entra en `repairable_content_issues` ni borra campos de inferencia.

Estas reglas no suavizan ninguna puerta: preparar, guardar, confirmar, programar
y publicar siguen revalidando sus contratos autoritativos en el backend.

## Inventario de escrituras

| Acción | Inicio | Backend autoritativo | Versión / concurrencia | Atomicidad e idempotencia | Doble clic / retry | Auditoría y resultado |
|---|---|---|---|---|---|---|
| Guardar manual | `admin-markets.js` | `save_market_draft` | `expected_version`, `FOR UPDATE` | Transacción única; UUID y hash; no-op canónico | UI bloqueada; replay o `DRAFT_VERSION_MOVED` | Snapshot solo material; auditoría de cambio o no-op |
| Preparar desde Radar | `admin-markets.js` | `save_market_draft_from_radar` | Versión del borrador y lock de candidata | Guarda y reserva candidata en una transacción; misma UUID | Una sola reserva; replay seguro | Procedencia y `RADAR_DRAFT_PREPARED` |
| Radar + Agente Editor | puente de `admin-markets.html` | `save_market_draft_from_radar_intelligence` | Versión, candidata y ejecución experta | Guardado, procedencia y binding en una transacción | Botón bloqueado; guardado base idempotente | Dictamen y Plan de Resolución vinculados; nunca publica |
| Datos y tendencias | `admin-markets.js` | `save_market_draft_from_intelligence` | Solo creación y ejecución experta válida | Guardado y binding en una transacción; UUID obligatoria | Una sola creación | Origen, contrato, fuentes y feedback persistidos |
| Aplicar propuesta del Agente Editor | `admin-markets.js` / puente | RPC anteriores y `bind_market_draft_intelligence` | Versión y origen inmutables | Binding repetido compara contrato+fuentes y hace no-op | UI bloqueada; mismatch falla | Plan versionado si cambia |
| Corrector Experto | `market-draft-fixer.js` | Edge `market-draft-fixer` → check PRIMARY v1 → `apply_market_draft_expert_repair_v2` → Edge `validate-market-draft` | `expected_version`; fuente primaria atestada; el resultado antiguo no puede guardar | El check append-only se registra primero; apply revalida identidad y vigencia, y guarda contenido+binding+auditoría atómicamente | UI bloqueada; como máximo una versión; retry viejo falla cerrado | Solo errores de contenido; propuesta, fuente, campos y binding auditados; nunca confirma/publica |
| Solicitar revisión | `admin-markets.js` | Edge `validate-market-draft` → `begin/record_market_draft_review_v2` | UUID de intento; lock de borrador; una ejecución activa | Inicio y finalización idempotentes; respuesta tardía `stale` | Botón bloqueado; replay del intento; un retry técnico explícito crea otro intento | Intento técnico/contenido separado de revisión efectiva |
| Confirmar revisión | `admin-markets.js` | `confirm_market_draft_review` | `expected_version`, huella, revisión y binding | Transacción única; confirmación repetida es no-op | Botón bloqueado; retry devuelve confirmación existente | `HUMAN_CONFIRMATION_RECORDED` una vez |
| Programar / publicar | `admin-markets.js` | revalidación Radar → `publish_market_draft` / `materialize_market_draft` | Lock, versión, aprobación, confirmación y fact check v2 actuales | Revalidación persistida y gate transaccional; la materialización e inserción son atómicas | Botón bloqueado; fact expirado/resuelto bloquea; un estado materializado no duplica | Programación/publicación auditada; nunca elude procedencia ni puerta factual |
| Verificar binding | `admin-markets.js` | Edge `market-source-monitor` y RPC de binding | Lock/estado de binding y plan versionado | Resultado persistido en Supabase | UI bloqueada; repetir revalida, no crea mercado | Estado de validación y problemas trazables |
| Armar / pausar monitor | `admin-markets.js` | Edge `market-source-monitor` | Transición de estado comprobada | Cada transición es autoritativa | UI bloqueada; estados incompatibles fallan | Queda auditado; no resuelve y no activa el scheduler global |
| Capturar evidencia | `admin-resolution.js` | Edge `market-source-monitor` → snapshot/result RPC | Binding vigente; huella de evidencia | Snapshot y ejecución son persistentes; un valor ausente no se vuelve cero | Botón bloqueado; capturas repetidas son historial, no una resolución | Evidencia y paquete recuperables; nunca resuelve solo |
| Resolver mercado | `admin-resolution.js` | `analyze-market-resolution` → `approve-market-resolution` → `resolve_market_with_evidence` | Mercado abierto, análisis vigente y confirmación administrativa | Reparto y estado en una transacción; estado resuelto impide repetir | UI bloqueada; segundo intento no vuelve a repartir | Auditoría y evidencia; fuera del alcance de esta reparación |

## Escaneo ligero de otras escrituras

- **Corregido ahora:** guardados manuales, Radar, Observatorio, Agente Editor, binding, Corrector, revisión y confirmación usan memoria autoritativa o protecciones de replay/versionado coherentes.
- **Ya protegido:** participaciones y resolución usan transacciones y bloqueos en Supabase; candidatos Radar usan huellas/estado; snapshots y paquetes conservan historial; los schedulers permanecen desactivados salvo los jobs previamente existentes y autorizados.
- **Recomendación futura:** añadir una clave de idempotencia explícita de extremo a extremo a cada transición de monitor y a cada captura manual. Hoy sus estados, locks y restricciones evitan efectos económicos duplicados, pero una clave común facilitaría devolver exactamente la misma respuesta tras una pérdida de red.

## Reglas para funciones futuras

1. Toda escritura debe terminar en Supabase y usar una transacción para sus invariantes.
2. Un recurso versionado debe exigir `expected_version` y lock de fila.
3. Toda acción reintentable debe aceptar una UUID y guardar el hash de la petición y su respuesta.
4. Los no-op se detectan con la representación canónica, antes de incrementar versión.
5. Los fallos técnicos se registran como intentos y nunca como hechos del dominio.
6. Las respuestas de proveedor deben validarse antes de persistir y los logs solo pueden contener metadatos seguros.
7. Una aprobación, confirmación o binding debe declarar versión, huella, política y esquema.
8. Restaurar significa crear historia nueva enlazada a la anterior, no modificar snapshots.
9. Ninguna Edge Function de preparación, revisión, corrección o evidencia puede confirmar, publicar o resolver.
10. Toda función `security definer` fija `search_path`, comprueba rol y revoca permisos por defecto.
