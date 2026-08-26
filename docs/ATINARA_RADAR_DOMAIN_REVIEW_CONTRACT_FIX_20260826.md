# Atinara · contrato de revisión humana de dominio Radar

Fecha: 26 de agosto de 2026
Base exacta: `cc089e32b7f920a8d14f9231c3fc821519fa34ca`
Estado: corrección incremental verificada en local y contra PostgreSQL real con
`ROLLBACK`; pendiente de integración, migración y despliegue.

## Objetivo

Permitir que la revisión humana de ámbito gaming opere sobre candidatas Radar
reales sin rebajar ninguna puerta, fabricar evidencia ni eludir la concurrencia.
La entrega alinea tres contratos que habían evolucionado por separado:

1. huella versionada de candidata;
2. huella SHA-256 de dominio;
3. política vigente `atinara-gaming-domain-v2`.

No publica, confirma, resuelve ni liquida mercados. No modifica Karma,
Prestigio, LMSR, Auth, secretos, Registry V2.1, tareas, rutas, modos, modelos,
flags o presupuestos de IA. Radar conserva cero inferencias.

## Evidencia productiva

Producción está en `origin/main =
cc089e32b7f920a8d14f9231c3fc821519fa34ca`, `market-radar` v70, `ACTIVE`,
`verify_jwt=true`, digest
`0e93b7f7a6c0feae4827ee35f353d3a0ddf506de6eab52632deda9462dc8399f`.
La única UUID fresca es `c1f677eb-0dae-410f-820d-a4483601ab47` y terminó
correctamente:

- 215/215 series Kalshi y cero fallidas;
- 590 padres indexados, 24 seleccionados y 566 diferidos;
- 24 padres `complete`, todos con paginación agotada;
- 192 hijas descubiertas, contabilizadas e identificadas;
- expected, staged, processed y accepted: 162;
- quarantined y failed: 0;
- manifest
  `085a5f169cd0f045c9ae867adba049b9b9937be1f02a79f02df6486d4537bae4`;
- finalization
  `aaab476f8b372eaafcfc41b2533af878ebec28f308bf2cbe71aa860a204cf5`.

La candidata fresca `1aa9b332-07d9-4dff-a2e3-d98a7066237e` representa la
hija explícita `kalshi:market:KXGTATRAILER-26SEP`. Su padre está completo, su
identidad está resuelta, el proveedor está abierto, no existe duplicado ni
borrador y la revisión determinista pidió una decisión humana de dominio.

Al pulsar «Confirmar dentro del ámbito», la UI falló cerrada con un mensaje
seguro. La lectura de servidor confirmó cero filas en
`private.market_radar_domain_reviews_v1`; ningún borrador, mercado o dato
protegido cambió.

## Causa raíz general

`private.external_market_candidates.fingerprint` usa identificadores
versionados. Las 398 filas productivas observadas se distribuyen así:

- 353 huellas actuales `r` + 8 hex, como `r3712d951`;
- 45 huellas históricas `r1-` + 16 hex;
- 0 huellas SHA-256.

Sin embargo:

- `market-radar` validaba `expected_fingerprint` exclusivamente como 64 hex;
- `review_market_radar_domain_v1` repetía esa restricción;
- la columna `candidate_fingerprint` del ledger solo admitía 64 hex;
- la tabla y las RPC persistían/consultaban
  `atinara-gaming-domain-v1`, mientras el clasificador compartido usa v2.

Por tanto, ninguna candidata productiva podía crear una atestación aplicable.
No era un fallo de Kalshi, Rockstar, Auth, RLS, navegador o contenido concreto;
era un desacuerdo general entre el tipo de identidad material y el contrato de
workflow.

## Solución

La Edge define una única gramática cerrada para huellas de candidata:

- SHA-256 de 64 hex, por compatibilidad;
- `r` + 8 hex, formato vigente;
- `r1-` + 16 hex, formato histórico.

La migración
`20260826130000_fix_market_radar_domain_review_contract_v2.sql`:

- falla cerrada si encuentra una huella productiva fuera de esas versiones;
- amplía solo la restricción de `candidate_fingerprint` del ledger;
- conserva `domain_fingerprint` y `request_hash` como SHA-256;
- conserva la comparación exacta de `preparation_revision` y `fingerprint`
  bajo `FOR UPDATE`;
- permite v1 como historia y escribe/lee únicamente v2 como política vigente;
- mantiene RLS forzada, tabla sin grants, lectura `service_role` only y
  escritura solo para administradoras autenticadas mediante la RPC;
- preserva idempotencia, supersesión y ledger de incidencias append-only;
- no ejecuta DML, no convierte filas y no contiene backfill.

La separación es deliberada: la huella de candidata prueba qué revisión se
atestó; la huella de dominio prueba que el sujeto y el texto clasificable no
cambiaron. Ninguna sustituye a la otra.

## Pruebas

- Pruebas focalizadas de Radar y resumibilidad: 96/96.
- Caso estático de Edge: la acción `review-domain` usa la gramática versionada y
  ya no contiene la restricción SHA-256 exclusiva.
- Caso SQL: formatos actual e histórico, política v2, ACL y RLS forzada.
- Transacción de workflow actualizada para insertar y reanudar atestaciones con
  `r3712d951` y `r1-006f0c801b31acce`, conservando replay, supersesión y
  ausencia de publicación.
- Migración completa ejecutada contra PostgreSQL productivo con
  `lock_timeout=5s`, `statement_timeout=120s` y `ROLLBACK`; postflight verde.
- Comprobación posterior: las restricciones productivas v1 originales seguían
  presentes, confirmando que la prueba no dejó el esquema aplicado.
- Contratos SQL estáticos: 19/19.
- Edge Functions con Deno 2.1.14: 9/9, incluido `market-radar`.
- Sintaxis del test modificado y `git diff --check`: verdes.

## Activación

1. Verificar el nuevo `origin/main`, las rutas y su contenido exacto.
2. Exigir Calidad de Atinara, chequeo Deno, Pages y benchmark offline verdes;
   no usar Sonar.
3. Tomar baseline de solo lectura y confirmar v70, JWT, digest, seis borradores
   y fingerprints protegidos.
4. Aplicar una sola vez la migración
   `fix_market_radar_domain_review_contract_v2`.
5. Desplegar únicamente `market-radar` con `verify_jwt=true`.
6. Confirmar nueva versión, `ACTIVE`, JWT, digest y las invariantes protegidas.
7. Reabrir la misma candidata, registrar una única decisión `in_domain` con su
   justificación y comprobar fila, revisión, huellas, política e issue resuelto.
8. Renovar la elegibilidad exactamente una vez. Si vuelve a fallar, investigar
   la causa tipada antes de repetir.
9. Solo si queda elegible, ejecutar una única inferencia de Market Expert,
   materializar una propuesta y guardar exactamente un borrador privado.
10. No iniciar otro refresh, no usar Gemini en Radar y no confirmar o publicar.

## Rollback y riesgos

Si la migración no supera el postflight, toda la transacción revierte. No se
deben editar migraciones aplicadas ni relajar la comparación exacta de revisión
y huella. Si la Edge no queda activa, no registrar la atestación hasta restaurar
la versión anterior o desplegar el bundle verificado.

Riesgos residuales:

- la candidata elegida cierra el 1 de septiembre y Rockstar anuncia un
  «Extended Look» para el 27 de agosto; antes de Expert debe repetirse la puerta
  factual y comprobar que aún no existe un resultado público aplicable;
- la migración repara el camino de atestación, pero el E2E no queda terminado
  hasta demostrar elegibilidad vigente, una única inferencia y un único borrador
  privado nuevo;
- las atestaciones v1 se conservan por compatibilidad histórica, pero no se
  proyectan bajo v2 sin una revisión nueva y explícita.
