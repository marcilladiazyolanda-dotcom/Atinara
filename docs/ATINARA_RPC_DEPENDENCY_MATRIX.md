# Matriz de dependencias RPC · elegibilidad Radar v1/v2

**Estado:** preflight local de Agent Engine V2.1.  
**Corte inspeccionado:** `d3073bb274be7a4d4085378b661cee1323485fdf`, producción Supabase `fgrblufbuywxjahpymnh`, 12 de agosto de 2026.  
**Propósito:** demostrar que el endurecimiento RLS previsto conserva la ruta v1 y su rollback antes de revocar o cambiar cualquier permiso existente.

Este documento registra dependencias reales. No autoriza una migración remota. Las consultas de producción fueron exclusivamente de lectura y no se leyeron valores de secretos.

## Estado material verificado

| Tabla | Owner | RLS | FORCE RLS | ACL material | Policies | Escritura válida |
|---|---|---:|---:|---|---|---|
| `private.market_radar_eligibility_checks` | `postgres` | desactivado | desactivado | solo `postgres=arwdDxtm` | ninguna | únicamente funciones `SECURITY DEFINER` cerradas |
| `private.market_radar_eligibility_attempts` | `postgres` | desactivado | desactivado | solo `postgres=arwdDxtm` | ninguna | únicamente `public.record_market_radar_eligibility_attempt_v1` |

Los grants de tabla y las políticas RLS son controles distintos. Aunque `anon`, `authenticated` y `service_role` no tienen ACL directa, V2.1 activa y fuerza RLS como defensa en profundidad. No añade policies permisivas: las funciones propietarias siguen siendo la única superficie.

## Funciones dependientes y compatibilidad

| Tabla | Función real y firma | Owner / modo | Grant actual | Ruta v1 | Ruta v2 | Prueba positiva | Prueba negativa |
|---|---|---|---|---|---|---|---|
| checks | `public.upsert_market_radar_batch_with_eligibility_v1(text,text,text,jsonb,jsonb,text,jsonb)` | `postgres`, definer, `search_path=''` | `service_role` | `market-radar` persiste lote y check por candidata | mismo wrapper; implementación propietaria atraviesa `FORCE RLS` | inserta lote válido y enlaza `current_eligibility_check_id` | `anon`/`authenticated` reciben permiso denegado; fila inválida queda aislada |
| checks | `public.apply_market_radar_prepare_eligibility_v1(uuid,bigint,text,timestamptz,jsonb,jsonb,boolean)` | `postgres`, definer, `search_path=''` | `service_role` | `market-radar` revalida antes de preparar | mismo wrapper y contrato | revalidación válida crea check y, si procede, reserva candidata | rol no service, revisión obsoleta o hash incompatible fallan sin mutar |
| attempts | `public.record_market_radar_eligibility_attempt_v1(uuid,bigint,text,uuid,text,text,boolean)` | `postgres`, definer, `search_path=''` | `service_role` | registra fallo técnico append-only | mismo wrapper y contrato | fallo técnico compatible conserva estado y crea un intento | rol no service o replay incompatible fallan; no altera el check vigente |
| checks | `public.bind_market_radar_draft_eligibility_v2(uuid,uuid,bigint,text,bigint,bigint,uuid,uuid)` | `postgres`, definer, `search_path=''` | `service_role` | liga publicación a check vigente | se conserva sin cambios | liga versión, huella, revisión y decisión exactas | check ajeno/caducado, actor distinto o replay incompatible fallan |
| checks | `public.list_market_radar_candidates_v2(text,text,text,text,text,text,integer,integer)` | `postgres`, definer, `search_path=''`; exige admin | `authenticated` | catálogo privado del Radar | se conserva sin cambios | una administradora lee solo candidatas elegibles vigentes | invitada o cuenta no administradora no recibe datos |
| checks | `public.get_market_intelligence_origin(text,text)` | `postgres`, definer, `search_path=''`; admin salvo service | `authenticated`, `service_role` | carga origen para Editor | misma lectura, después instrumentada por runtime v2 | origen válido devuelve expediente y puerta | identidad no autorizada o origen inexistente falla cerrado |
| checks | `public.save_market_draft_from_radar(uuid,uuid,bigint,jsonb)` | `postgres`, definer, `search_path=''`; exige admin | `authenticated` | guarda borrador privado desde Radar | permanece como writer autoritativo | candidata/check/revisión exactos crean o actualizan una versión | cuenta no admin, check obsoleto o versión movida no escriben |
| checks | `public.save_market_draft_from_radar_intelligence(uuid,uuid,bigint,jsonb,uuid,jsonb,jsonb)` | `postgres`, definer, `search_path=''`; exige admin | `authenticated` | guarda borrador + binding de Editor | permanece como writer autoritativo | paquete experto compatible materializa una versión privada | paquete stale, check incompatible o cuenta no admin fallan |
| checks | `private.assert_market_radar_candidate_eligible_v1(uuid,bigint)` | `postgres`, definer, `search_path=''` | solo owner | helper interno de guardado | se reutiliza | devuelve candidata únicamente con check vigente exacto | ningún rol API puede ejecutarla directamente |
| checks | `private.assert_market_radar_draft_eligibility_v1(private.market_drafts,timestamptz)` | `postgres`, definer, `search_path=''` | solo owner | puerta interna de publicación | se reutiliza | acepta binding exacto y no caducado | ningún rol API puede ejecutarla; mismatch bloquea publicación |

## Dependencias de código 1:1

| Interfaz | JavaScript | Edge | Shared | RPC | Tabla | Tests de regresión |
|---|---|---|---|---|---|---|
| Radar administrativo en `admin-markets.html` | `admin-markets.js` | `supabase/functions/market-radar/index.ts` | `_shared/market-radar.mjs` y runtime v1/v2 | `upsert_market_radar_batch_with_eligibility_v1`, `apply_market_radar_prepare_eligibility_v1`, `record_market_radar_eligibility_attempt_v1` | checks, attempts, `external_market_candidates` | `tests/market-radar.test.js`, `tests/agent-engine-confirmation-v8.test.js`, `supabase/tests/radar_eligibility_rls_v12_transaction.sql` |
| Agente Editor en `admin-markets.html` | `admin-agent-engine.js`, `admin-markets.js` | `market-expert/index.ts` | inteligencia compartida y runtimes v1/v2 | `get_market_intelligence_origin`, `save_market_draft_from_radar_intelligence` | checks, drafts, expert runs | `tests/expert-market-cycle-definitive.test.js`, `tests/agent-engine-v2.test.js` |
| Confirmación/publicación humana | `admin-markets.js`, `market-draft-fixer.js` | `market-radar/index.ts` solo para revalidar | puerta de elegibilidad | `bind_market_radar_draft_eligibility_v2`, `confirm_market_draft_review`, `publish_market_draft` | checks, bindings, drafts | `tests/agent-engine-confirmation-v8.test.js`, `supabase/tests/agent_engine_confirmation_v8_transaction.sql` |

## Puerta de migración y rollback v1

La migración `harden_radar_eligibility_rls_v1` puede avanzar solo si la matriz SQL demuestra dentro de `BEGIN/ROLLBACK`:

1. `ENABLE ROW LEVEL SECURITY` y `FORCE ROW LEVEL SECURITY` en ambas tablas.
2. El owner sigue siendo `postgres` y los wrappers definer conservan su firma, owner, `search_path` y grants.
3. Las rutas service positivas insertan y leen mediante los wrappers, nunca mediante grants de tabla.
4. `anon`, `authenticated` y un contexto service que intente DML directo reciben permiso denegado.
5. Los triggers append-only rechazan `UPDATE` y `DELETE`, incluso al owner funcional.
6. La ruta v1 completa continúa funcionando después del endurecimiento.

Rollback v1 no significa desactivar RLS. Si V2.1 se retira, las Edge vuelven a sus funciones v1 y a `legacy_direct`; los wrappers y tablas anteriores permanecen. La migración es aditiva y no elimina funciones, columnas, datos, triggers ni grants necesarios por v1.
