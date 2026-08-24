# Radar V6 · corrección live de reconciliación y contrato canónico

Fecha: 2026-08-24  
Base canónica: `origin/main` en `2ac36203ea4aae38b69d821828408cc12bf58e82`  
Proyecto productivo: `fgrblufbuywxjahpymnh`

## Estado y evidencia del fallo

El refresh administrativo autenticado y sin Gemini
`93b078a3-a54c-49d3-bf62-e2438d6eae5a` se ejecutó una sola vez después de
aplicar `20260824140500_fix_radar_parent_reconciliation_child_alias_v1.sql`.
Enumeró correctamente:

- Polymarket: 3 padres y 74 hijas;
- Kalshi: 8 padres y 109 hijas;
- Tavily: 0 resultados, desacoplado.

Ambos feeds se detuvieron antes de crear batches. PostgreSQL registró:

- Polymarket: `RADAR_PARENT_LEGACY_IDENTITY_BIJECTION_MISMATCH`;
- Kalshi: `RADAR_PARENT_CHILD_RECONCILIATION_INVALID`.

No se crearon candidatas V3, reconciliaciones persistidas, borradores ni
mutaciones económicas. Mercados, predicciones, perfiles, Karma, Prestigio,
LMSR e histórico conservaron sus fingerprints baseline.

## Causa raíz general A · filas históricas no son hijas lógicas

`private.external_market_candidates` puede conservar dos representaciones
históricas del mismo identificador estable: una fila antigua mínima y otra
posterior enriquecida con condition ID y slug. El padre Polymarket `499343`
hizo visible el patrón: 45 filas raw representan 23 `external_market_id`
distintos; 22 identidades tienen ambas representaciones.

El loader usaba el ID interno de fila como occurrence y SQL exigía que cada
hija actual coincidiera con exactamente una fila física. Por eso una única hija
real vinculada a sus dos snapshots legítimos se interpretaba como una violación
de biyección.

La corrección:

1. agrupa únicamente proyecciones `legacy:<candidate_id>` del mismo padre y la
   misma identidad fuerte del proveedor;
2. selecciona la representación más rica sin reescribir ni borrar las demás;
3. conserva `legacy_representation_count` y referencias auditables;
4. marca desacuerdos de condition/token como conflicto explícito;
5. no colapsa ocurrencias reales del ledger V6;
6. hace que SQL cuente identidades lógicas distintas, manteniendo la cobertura
   obligatoria de todas las filas raw.

Un cambio de título o slug con el mismo ID sigue siendo la misma hija; dos IDs
fuertes distintos siguen siendo hermanas distintas o conflicto según evidencia.
No se usa orden, probabilidad, similitud ni IA.

## Causa raíz general B · dos representaciones del mismo contrato firmado

Kalshi entrega reglas resolutivas en varios párrafos. El `provider_contract`
conservaba separadores `\n\n`, mientras la proyección material usada para
`provider_contract_canonical_json` y su SHA-256 aplicaba `cleanText`. SQL
comparaba literalmente ambos valores y rechazaba todos esos contratos aunque
su contenido fuese idéntico.

La proyección firmada normaliza ahora caracteres de control y espacios una sola
vez antes de construir ambas representaciones. El payload fuente conserva el
texto original y su procedencia. La reparación es independiente de proveedor,
título, evento y categoría.

## Migración aditiva

`20260824153000_fix_radar_legacy_representation_reconciliation_v1.sql`

- no contiene DML, backfill, defaults de dominio ni borrado;
- crea dos helpers privados `IMMUTABLE`, owner `postgres`, `search_path=''` y
  sin `EXECUTE` para `anon`, `authenticated` o `service_role`;
- sustituye solo los cuatro conteos físicos del registrador por conteos de
  identidad lógica;
- verifica la huella normalizada CRLF/LF del cuerpo previo antes del cambio;
- conserva `SECURITY DEFINER` y el grant exclusivo del registrador a
  `service_role`;
- no modifica las migraciones ya aplicadas.

No se cambia `RADAR_NORMALIZER_VERSION`, `RADAR_FAMILY_VERSION`,
`RADAR_DOMAIN_POLICY_VERSION` ni el contrato de reconciliación: esta reparación
cumple la semántica V6 ya versionada; no introduce una semántica nueva.

## Alcance de despliegue

- Edge Function: solo `market-radar`, con `verify_jwt=true`.
- Migración: solo `20260824153000_fix_radar_legacy_representation_reconciliation_v1.sql`.
- Frontend: ninguno.
- Secretos, Registry V2.1, modos, rutas, flags, modelos y presupuestos: ninguno.
- DML manual, backfill, Gemini, publicación o confirmación humana: ninguno.

## Pruebas locales

- 551 unitarias verdes, 0 fallos.
- 52 pruebas específicas de reconciliación, incluidas 1/3/21/48/101/480 hijas,
  duplicados legacy, conflictos fuertes, cambio de slug/título y contrato
  multilínea.
- 127 archivos JavaScript con sintaxis válida.
- 9/9 Edge Functions verificadas con Deno 2.1.14 e IA externa desactivada.
- 18/18 matrices SQL con fronteras transaccionales válidas.
- `git diff --check` verde.

## Secuencia obligatoria después de la subida

1. `git fetch` y comparación exacta del nuevo `origin/main` con este inventario.
2. Confirmar que la migración `20260824153000` no figura aplicada y que el hash
   normalizado del registrador sigue siendo
   `a89b0b56766f91e9b3ecfe67af19cb6945112cff1b2666c2f9675630e8dbd60c`.
3. Repetir baseline de economía, borradores, candidatas, reconciliaciones,
   settings IA y Edge.
4. Aplicar solo la migración nueva; verificar historial, cuerpos, owner,
   seguridad, `search_path`, ACL y ausencia de DML/backfill.
5. Desplegar solo `market-radar` con `verify_jwt=true`; verificar versión,
   estado, bundle y logs.
6. Ejecutar exactamente un refresh desde la interfaz administrativa, sin
   Gemini.
7. Verificar intención, manifest, batches, contadores, finalización y replay.
8. Exigir por cada padre `declared = accounted`, paginación agotada, cero
   pérdida silenciosa y cero categóricas con `deadline:*`.
9. Comprobar visualmente escritorio y móvil: identidades reales, sección de
   reconciliación separada, español y ausencia de placeholders falsos.
10. Solo si todo pasa, reanudar Radar → Editor → Validator hasta la puerta de
    confirmación humana; Yol sigue siendo la única persona que puede confirmar.
