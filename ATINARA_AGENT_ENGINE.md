# Atinara Agent Engine · V2.1 productivo en `legacy_direct`

Estado del documento: protocolo v1, cierre SQL v8–v11 y base V2.1 desplegados y
verificados en producción. La activación V2.1 se realizó el 13 de agosto de 2026
sin cambiar secretos, frontend, proveedor ni autoridad de dominio.

Agent Engine V2.1 está activo como capa de contratos, runtime y persistencia, pero todas las tareas conservan `legacy_direct`. No están activados `gateway_gemini_parity`, `gateway_routing`, OpenRouter ni NVIDIA NIM. Su arquitectura y operación se documentan en `ATINARA_AI_GATEWAY.md` y `ATINARA_AGENT_ENGINE_V2_RUNBOOK.md`.

## Transición V2.1

V2.1 conserva los tres agentes y añade selección real de herramientas:

- Issue Registry, Strategy Registry y bindings viven en tablas privadas separadas, proyectadas de la registry v1 sin eliminarla.
- Tool Registry y handlers viven en código; cada inicio compara correspondencia completa, `registryVersion` y `registryHash` contra SQL.
- El dispatcher rechaza herramientas no permitidas, estrategias sin write, un segundo writer por ronda, snapshot stale, loops, no progreso y más de dos replans.
- Editor no escribe mercados. Corrector puede persistir una sola versión por ronda mediante el writer autoritativo existente, CAS e idempotencia.
- Runs y steps son append-only, sin payloads de dominio, y comparten el deadline absoluto con tools, Gateway y persistencia.

Las inferencias ya no viven dentro de las Edge de dominio. Cada Edge invoca el AI Gateway y la compatibilidad Gemini se conserva en adaptadores centralizados. Los modos se activan tarea por tarea; OpenRouter y NVIDIA permanecen apagados.

## Corte productivo verificado

- `market-radar` v55 (`verify_jwt=true`, bundle
  `b2c842c717d265c09abaaaccb5eed0d013b2ab8be262a9d2e5d15d672531b861`).
- `market-expert` v22 (`verify_jwt=true`, bundle
  `9b5b8bf1f547cad8638598aa2a081c1de7e0c08efbc4032df5c574bff1b5a6e8`).
- `market-draft-fixer` v19 (`verify_jwt=true`, bundle
  `1e6b006b31601bdfb884c7266133d64dd2879e3e9142b0dccda059c68a0fa9a4`).
- `validate-market-draft` v27 (`verify_jwt=true`, bundle
  `494afb960213898ef9db1c2d4aab788c8d744d0c3d81037311412c3f727f1b2d`).
- `analyze-market-resolution` v15 (`verify_jwt=true`, bundle
  `9d065ad553ea8dd1c5903fe6e3aff1610ad03d11c982c4fa21c6fc364b78f235`).
- Migraciones remotas no repetibles `20260811230350` (v8),
  `20260811231921` (v9), `20260811232315` (v10) y `20260811232708` (v11).
- Migraciones V2.1 remotas no repetibles `20260813163839` (RLS Radar),
  `20260813163918` (Gateway, budgets y telemetría) y `20260813163959`
  (registries y runtime v2).

La v9 exige autoridad resolutiva del contrato y de la opción exactos. La v10
impide que una caída reintentable se persista como resultado terminal. La v11
proyecta cualquier `technical_hold` como revisión pendiente y conserva por
separado el historial append-only del intento fallido.

## Propósito

Atinara usa tres agentes especializados sobre un único protocolo determinista:

- `radar_source_agent`: comprueba el contrato del proveedor, recupera fuentes oficiales, separa autoridad resolutiva futura de evidencia terminal y persiste elegibilidad.
- `market_editor_agent`: lee una candidata o señal, ejecuta la puerta determinista, usa Gemini solo como enriquecimiento sustituible y construye una propuesta privada.
- `market_corrector_agent`: clasifica incidencias reparables, construye un parche mínimo, lo valida, persiste como máximo una versión material por ronda y vuelve a ejecutar el Validador.

El protocolo común es `atinara-agent-protocol-v1` y vive en
`supabase/functions/_shared/atinara-agent-runtime.mjs`.

## Invariantes

Cada ejecución declara una lista cerrada de herramientas, presupuesto de pasos,
plazo total, límite de repetición y huellas de progreso. Runtime v2 hace cumplir
la parada: una herramienta no declarada, una acción repetida, una huella ya
vista, el agotamiento del plazo o el presupuesto no se limitan a cortar la
traza, sino que impiden iniciar el siguiente efecto.

Las trazas almacenan únicamente nombre de herramienta, estado y resúmenes
sanitizados. No almacenan razonamiento interno, prompts completos, tokens,
secretos, SQL, cabeceras ni contenido externo sin acotar.

Ningún agente puede:

- confirmar humanamente;
- programar o publicar;
- resolver o liquidar;
- modificar Karma, Prestigio, predicciones, LMSR o precios;
- convertir una caída técnica en un rechazo factual;
- utilizar Gemini como autoridad o dependencia obligatoria.

## Radar y fuentes

El Radar trata por separado:

1. Estado canónico del proveedor.
2. Resultado terminal directo y exacto.
3. Autoridad futura de resolución indicada por el contrato del proveedor.
4. Duplicidad con mercados o borradores ajenos.
5. Incidencias técnicas y último estado válido.

Una autoridad futura solo es apta si el contrato exacto del proveedor incluyó
su URL de liquidación, el dominio está registrado con rol
`PRIMARY_RESOLUTION`, la evidencia conserva `candidate_external_id`, las reglas
nombran la opción y la semántica Sí/No, y el endpoint oficial respondió con una
huella SHA-256. Se guarda como `resolution_authority` y `direct_claim=false`;
una URL genérica del mismo proveedor o una fuente de otra hija no puede
habilitarla ni cerrar un mercado.

Si la búsqueda de resultados terminales falla, una candidata nueva pasa a
`technical_hold`. Si existe un expediente elegible todavía vigente, se muestra
como último estado válido con marca de degradación. Nunca se presenta una
consulta parcial como una comprobación fresca completa.

El borrador creado desde una candidata se excluye de sus propios duplicados por
`radar_candidate_id` y `prepared_draft_id`. Un borrador o mercado distinto que
represente la misma proposición continúa bloqueando.

## Confirmación y publicación

La confirmación humana registra que la administradora revisó personalmente una
versión, huella y revisión efectiva exactas. Permanece privada y no depende de
la disponibilidad momentánea de proveedores externos.

La publicación sí renueva la elegibilidad y crea una atestación append-only en
`private.market_draft_eligibility_bindings`. La puerta SQL exige igualdad exacta
de:

- borrador;
- versión y huella de contenido;
- candidata;
- `preparation_revision`;
- check de elegibilidad actual y su `decision_hash`;
- política vigente.

Un refresh material o un check posterior invalida la atestación anterior. La
publicación falla cerrada hasta repetir la comprobación, sin borrar la
confirmación humana de la misma versión.

## Seguridad y Supabase Free

Las Edge Functions conservan `verify_jwt=true` y vuelven a comprobar la
administradora en servidor. Las RPC públicas del flujo se conceden solo al rol
que las necesita y las funciones privadas revocan ejecución a `public`, `anon`,
`authenticated` y `service_role`.

Los avisos del advisor sobre `SECURITY DEFINER` son heurísticos: no interpretan
`private.require_current_admin()` ni la comprobación de `auth.uid()` de las RPC
de propietaria. El corte verificado contiene 18 funciones anónimas de lectura y
83 autenticadas; ninguna mutadora queda sin control de identidad. Deben
revisarse por firma y privilegios, no silenciarse revocando el acceso necesario
al cliente.

Las tablas `private` sin policy conservan RLS forzado y todos los privilegios de
tabla revocados. El aviso `rls_enabled_no_policy` describe en ellas un cierre
denegatorio intencional, incluida `market_draft_eligibility_bindings`; no es una
exposición de datos.

La protección de contraseñas filtradas de Supabase Auth requiere plan Pro. En
Free se mantiene la política local de longitud/fortaleza y recuperación segura;
el advisor seguirá mostrando esa recomendación hasta cambiar de plan.

## Operación

- Radar y detalle: lectura o refresh administrativo acotado.
- Editor: lectura inicial; solo persiste su ejecución al finalizar con snapshot
  autoritativo todavía compatible.
- Corrector: intento idempotente, máximo tres rondas, parada por no progreso y
  separación entre intento técnico y revisión efectiva.
- Publicación: siempre requiere revisión aprobada compatible, confirmación
  humana específica y ligadura de elegibilidad fresca para esa versión.

Los schedulers siguen desactivados. El sistema no usa dinero real ni incorpora
una dependencia de pago de OpenAI; el diseño admite futuros adaptadores sin
cambiar las puertas autoritativas.
