# Radar V6 · corrección del fallo de persistencia posterior al refresh

Fecha: 2026-08-24  
Base canónica: `origin/main` en `abfb1b872fd086d81f8d3126d3e7730793c65814`  
Proyecto productivo: `fgrblufbuywxjahpymnh`

## Incidencia observada

El único refresh administrativo autorizado, con `request_id`
`27b48d65-e13e-480d-ad92-021c533da179`, enumeró correctamente Polymarket y
Kalshi, pero ambos feeds terminaron en `technical_failed` durante
`persistence`. PostgreSQL registró dos errores idénticos:

`column reference "child" is ambiguous`

No se usó Gemini. Tavily finalizó desacoplado. No se crearon lotes, candidatas
V3, reconciliaciones, borradores ni cambios económicos durante ese refresh.

## Causas raíz y correcciones generales

1. `record_market_radar_parent_reconciliations_v1` declaraba una variable
   PL/pgSQL `child` y reutilizaba `child` como alias SQL al comprobar cobertura
   legacy. La variable pasa a llamarse `child_value`; los alias SQL conservan su
   semántica y `plpgsql.variable_conflict=error` queda cubierto por prueba.
2. Las funciones V3 de elegibilidad y duplicados ya escribían
   `verification_confidence`, y Edge ya consumía ese contrato, pero la columna
   nunca se añadió a `private.external_market_candidates`. Se añade como
   `numeric(5,2)` nullable con rango `[0,100]`, sin default ni backfill.
3. El rebind de candidatas protegidas evaluaba `token_ids` ausente con lógica
   ternaria SQL y descartaba silenciosamente la coincidencia aunque existiera
   una identidad fuerte. Se sustituye por un `CASE` explícito: solo compara
   tokens cuando existe un array no vacío.
4. Una candidata legacy sin `availability_status` persistido se interpretaba
   como cambio material frente a una hija vigente `open`, generando un falso
   `PROVIDER_OPTION_INACTIVE`. La transición adopta el valor vigente como
   baseline únicamente cuando el campo anterior está ausente; un cambio real
   posterior sigue invalidando elegibilidad.

La migración es aditiva: no contiene backfill ni DML de datos de dominio. No
modifica Edge Functions, frontend, IA, Registry, rutas, modos, proveedores,
modelos, presupuestos, mercados, predicciones, perfiles, Karma, Prestigio o
LMSR.

## Migración

`20260824140500_fix_radar_parent_reconciliation_child_alias_v1.sql`

- añade una columna y una constraint;
- reemplaza exclusivamente las dos funciones SQL afectadas;
- conserva owner `postgres`, `SECURITY DEFINER`, `search_path=''` y ACL mínima;
- incorpora preflight de drift y postflight de cuerpo, esquema, seguridad y ACL;
- no altera la migración ya aplicada `20260822205445`.

## Evidencia previa a la entrega

- 49/49 pruebas deterministas de reconciliación de padres: verde.
- 18/18 archivos de prueba SQL con fronteras transaccionales válidas: verde.
- Suite SQL completa `radar_parent_reconciliation_v1_transaction.sql`
  ejecutada contra producción con la migración temporal dentro de una
  transacción: verde y `ROLLBACK` final.
- Dry-run del archivo exacto de migración, incluidos preflight y postflight,
  sustituyendo solo el `COMMIT` final por `ROLLBACK`: verde.
- La suite cubrió 1, 3, 21, 48 y 101 hijas; 174 hijas en el manifest; replay;
  elegibilidad; preparación y borrador privado; rebind de borrador protegido;
  estado incompleto 48/21/27; cobertura legacy; y rollback atómico multibatch.
- Tras las pruebas: cero fixtures `parent-*`, cero columna temporal persistida,
  cero reconciliaciones/hijas persistidas y recuentos económicos conservados
  (`markets=15`, `predictions=9`, `profiles=2`, `market_maker_state=15`,
  `market_price_history=17`, `drafts=6`, `candidates=303`).

## Secuencia posterior a la subida

1. `git fetch` y comparación exacta de rutas y hashes con este paquete.
2. Preflight productivo y confirmación de que `20260824140500` no está aplicada.
3. Aplicar solo `20260824140500`.
4. Verificar historial, columna/constraint, cuerpos, owner, seguridad, search_path,
   ACL, ausencia de backfill y invariantes.
5. No redesplegar Edge ni frontend: este paquete no modifica sus fuentes.
6. Reanudar de forma controlada el smoke Radar sin Gemini y comprobar intención,
   manifest, batches, reconciliación, aceptación, replay y UI.
7. Continuar Radar → Editor → Validator hasta la puerta humana, sin publicar ni
   confirmar en nombre de Yol.

