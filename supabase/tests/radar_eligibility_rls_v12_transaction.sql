-- RLS/ACL regression for the existing Radar v1/v2 writer paths.
-- Run after all migrations and always preserve the final ROLLBACK.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $catalog$
declare
  relation_name text;
  role_name text;
  privilege_name text;
  function_oid regprocedure;
  owner_name text;
  function_config text[];
begin
  foreach relation_name in array array[
    'market_radar_eligibility_checks',
    'market_radar_eligibility_attempts'
  ] loop
    if not exists (
      select 1
      from pg_class relation
      join pg_namespace namespace on namespace.oid = relation.relnamespace
      where namespace.nspname = 'private'
        and relation.relname = relation_name
        and relation.relrowsecurity
        and relation.relforcerowsecurity
    ) then
      raise exception 'TEST_RADAR_RLS_NOT_FORCED:%', relation_name;
    end if;
    foreach role_name in array array['anon', 'authenticated', 'service_role'] loop
      foreach privilege_name in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE'] loop
        if has_table_privilege(role_name, format('private.%I', relation_name), privilege_name) then
          raise exception 'TEST_RADAR_DIRECT_ACL_PRESENT:%:%:%', relation_name, role_name, privilege_name;
        end if;
      end loop;
    end loop;
  end loop;

  foreach function_oid in array array[
    'public.upsert_market_radar_batch_with_eligibility_v1(text,text,text,jsonb,jsonb,text,jsonb)'::regprocedure,
    'public.apply_market_radar_prepare_eligibility_v1(uuid,bigint,text,timestamp with time zone,jsonb,jsonb,boolean)'::regprocedure,
    'public.record_market_radar_eligibility_attempt_v1(uuid,bigint,text,uuid,text,text,boolean)'::regprocedure,
    'public.bind_market_radar_draft_eligibility_v2(uuid,uuid,bigint,text,bigint,bigint,uuid,uuid)'::regprocedure
  ] loop
    select owner.rolname, function_row.proconfig
      into owner_name, function_config
    from pg_proc function_row
    join pg_roles owner on owner.oid = function_row.proowner
    where function_row.oid = function_oid
      and function_row.prosecdef;
    if not found or owner_name <> 'postgres'
       or not ('search_path=""' = any(coalesce(function_config, array[]::text[]))) then
      raise exception 'TEST_RADAR_WRAPPER_CONTRACT_INVALID:%', function_oid::text;
    end if;
    if not has_function_privilege('service_role', function_oid, 'EXECUTE')
       or has_function_privilege('anon', function_oid, 'EXECUTE')
       or has_function_privilege('authenticated', function_oid, 'EXECUTE') then
      raise exception 'TEST_RADAR_WRAPPER_ACL_INVALID:%', function_oid::text;
    end if;
  end loop;

  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'private.market_radar_eligibility_checks'::regclass
      and tgname = 'reject_market_radar_eligibility_check_mutation'
      and not tgisinternal and tgenabled <> 'D'
  ) or not exists (
    select 1 from pg_trigger
    where tgrelid = 'private.market_radar_eligibility_attempts'::regclass
      and tgname = 'reject_market_radar_eligibility_attempt_mutation'
      and not tgisinternal and tgenabled <> 'D'
  ) then
    raise exception 'TEST_RADAR_APPEND_ONLY_TRIGGER_MISSING';
  end if;
end;
$catalog$;

-- Positive writer/data-path coverage remains in radar_eligibility_v7_transaction.sql
-- and agent_engine_confirmation_v8_transaction.sql. This v12 guard proves that
-- the same wrappers remain executable while raw access is still impossible.

rollback;
