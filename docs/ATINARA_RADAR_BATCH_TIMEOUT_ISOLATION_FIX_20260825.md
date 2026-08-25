# Atinara · aislamiento durable de timeouts de batch Radar

Fecha: 25 de agosto de 2026  
Base: `origin/main = 4fdc0b13001b7d296b38d986a8eafe3a4a7dd43d`  
Alcance: SQL, `market-radar`, pruebas y memoria operativa. Sin frontend.

## Resultado exigido

Reanudar exclusivamente la intención Kalshi
`39a1656e-61af-4674-a4e0-fa0896236507`, procesar su manifest durable sin repetir
discovery y finalizarla de forma honesta. Solo después puede elegirse una
candidata fresca válida para Market Expert/Editor y crear exactamente un
borrador privado. No se autoriza publicar, confirmar, resolver ni liquidar.

## Evidencia productiva

- Radar v68 está `ACTIVE`, `verify_jwt=true`, digest
  `85ce234327b57e7aee4d656e1fad0e43b712ae979c89515646deea7b3742a519`.
- Kalshi registró 109 series totales, 25 seleccionadas, 84 aplazadas y cero
  fallidas. El alcance seleccionado contiene 11 padres y 148 hijas.
- Los 11 ledgers están persistidos: 148 descubiertas, contabilizadas e
  identificadas, cero identidades sin resolver, nueve padres `complete` y dos
  `provider_unavailable`. El parent manifest es
  `c197e3ac8565ae36465023c59d942b2abcc949b98ca1a8fbbe717935e28c7428`.
- Tavily terminó `AI_DEADLINE_EXCEEDED`, `source_enrichment`,
  `blocking_scope=none`. Kalshi continuó hasta el manifest de candidatas.
- Expected y staged son 86. El manifest
  `7b9f65509641a3f3dc916a6d55168c61526100cc8b625821fcaab10aafc5e1bb`
  contiene cuatro batches de 24, 24, 24 y 14.
- El batch ordinal 0, ID `a79f9663-81fa-4fe9-8b97-129f5b80e541`, quedó
  `technical_failed/RADAR_PERSISTENCE_TIMEOUT`, `attempt_count=1`, 24 items.
  Los ordinales 1, 2 y 3 siguen `pending`.
- La intención está `in_progress/persisting`, `claim_count=2`, con 0 procesadas,
  0 aceptadas, 0 cuarentenas y sin `finalization_hash`. No se creó otra UUID ni
  un borrador.

## Causa raíz y clase general

`process_market_radar_refresh_batch_v1` ya captura un timeout dentro de su
bucle, y `split_market_radar_refresh_batch_v1` ya divide de forma durable un
batch técnico. La ruta productiva `persistProviderResultV2`, sin embargo,
trataba todo `{ok:false}` como excepción y nunca llamaba al divisor.

En la recuperación, el `statement_timeout=8s` se agotó dentro del preflight de
v2, antes del catcher interno v1. PostgREST respondió HTTP 500 y no devolvió el
`batch_id`. Repetir «Continuar actualización» solo podía volver a ejecutar el
mismo lote de 24 elementos. No era una caída de Kalshi, una pérdida de páginas,
un fallo de Tavily ni un problema de identidad de hijas: era una capacidad
durable existente pero desconectada de la ruta activa, con una frontera de
timeout demasiado interior.

## Corrección general

La migración `20260825214500_isolate_market_radar_batch_timeouts_v1.sql`:

1. verifica por SHA-256 las funciones productivas v2, v3 y el divisor v1;
2. crea `process_market_radar_refresh_batch_v4` con owner `postgres`,
   `SECURITY DEFINER`, `search_path=''` y ejecución exclusiva de `service_role`;
3. valida el lease y reserva el primer batch pendiente/técnico con el mismo
   orden de locks antes del subbloque cancelable;
4. conserva sin cambios el resultado de v3 cuando la llamada termina;
5. captura solo `query_canceled` exterior, revierte el intento incompleto,
   incrementa `attempt_count`, marca el batch exacto y devuelve su UUID y
   cardinalidad como `RADAR_PERSISTENCE_TIMEOUT` reintentable;
6. revoca la invocación directa v3 a `service_role`, de modo que la ruta externa
   no pueda saltarse el wrapper.

La Edge llama v4. Solo cuando recibe un timeout reintentable, UUID válida y más
de un item, renueva el lease e invoca
`split_market_radar_refresh_batch_v1` con ese `batch_id`. Exige parent exacto,
IDs hijos válidos y `left_count + right_count = item_count`; acepta el replay
idempotente del parent ya dividido. Cada split consume el límite ya existente
de 512 operaciones. Si falta el margen temporal vigente, difiere la misma UUID
después de guardar el split. Un elemento que siga agotando el tiempo permanece
técnico y visible; nunca se cuarentena como dato malo ni se promueve.

No se modifican tamaños de lote, deadlines, presupuestos, tablas AI, Registry,
modelos, modos, rutas, flags, economía, Karma, Prestigio, LMSR, frontend,
secretos ni proveedores. No contiene backfill ni DML de datos al aplicar la
migración; las escrituras descritas viven dentro de la RPC en ejecución.

## Pruebas y matriz

- 94/94 pruebas focalizadas de Radar, resumibilidad y resiliencia.
- `market-radar` supera `deno check` con Deno 2.1.14.
- 19/19 contratos SQL transaccionales tienen `BEGIN/ROLLBACK` válido.
- El fixture SQL divide 4 items en 2+2, exige replay idempotente, procesa ambos
  hijos por v4, conserva 2 aceptadas + 2 cuarentenas y deja 4 procesadas antes
  de la finalización única.
- Los contratos estáticos exigen catcher exterior, batch exacto, contador de
  intentos, ACL v4, revocación v3, validación de hijos y ausencia de hardcodes.
- La matriz general ya presente conserva binario y categórico; 1, 3, 21, 48 y
  100+ hijas; hermanas; duplicado cross-provider; placeholders; hija inactiva;
  padre parcial o no disponible; resultado público con proveedor abierto;
  fuente stale; timeout; segunda página perdida; cursor duplicado; Unicode,
  apóstrofes, subtítulos, guiones y números; Tavily caído; replay de UUID; doble
  clic; búsqueda vacía; `option:*` y cero categóricas con `deadline:*`.

## Activación tras la subida

1. Ejecutar `git fetch --all --prune` y exigir el inventario exacto del
   manifiesto, sin eliminaciones ni contenido distinto.
2. Exigir verde `Calidad de Atinara`, incluido Deno; comprobar Pages y benchmark
   offline, sin Sonar.
3. Tomar baseline productivo de lectura y confirmar que la migración nueva no
   existe y Radar sigue v68.
4. Aplicar únicamente `20260825214500_isolate_market_radar_batch_timeouts_v1`.
5. Verificar SHA preflight, owner, `SECURITY DEFINER`, `search_path`, ACL y
   cuerpos. No ejecutar backfill ni DML manual.
6. Desplegar únicamente `market-radar` con `verify_jwt=true`; verificar versión,
   estado y digest. No desplegar frontend ni otras Edge.
7. Volver a verificar invariantes protegidos.
8. Pulsar una sola vez «Continuar actualización» para la misma UUID
   `39a1656e-61af-4674-a4e0-fa0896236507`. No crear un refresh fresco.
9. Auditar splits, batches, recuentos, manifest, finalización y replay. Si falla,
   detenerse antes de otra continuación e investigar logs Edge/API/Postgres.
10. Solo con finalización correcta seleccionar una candidata fresca y superar
    elegibilidad, fuentes, familia, identidad y duplicados antes de Market
    Expert/Editor y del único borrador privado.

## Invariantes actuales

Las tablas protegidas siguen en 15 mercados, 9 predicciones, 2 perfiles, 15
estados LMSR, 17 puntos de histórico, 6 borradores, Karma total 2.932 y Prestigio
40. Radar mantiene 315 candidatas, 3.306 fact checks y 3.522 comprobaciones de
elegibilidad. Las escrituras técnicas autorizadas dejan 22 intents, 47 ledgers
de padres, 49 provider runs, 450 incidencias, 39 revisiones y 14 bindings.

No hay candidata nueva promovida, inferencia de Market Expert, propuesta ni
borrador. El E2E no es apto hasta completar esas evidencias.
