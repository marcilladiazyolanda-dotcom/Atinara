-- Matriz transaccional del Agent Engine v8. Ejecutar después de la migración
-- 20260811221546 y conservar siempre ROLLBACK.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $shape_acl_and_gates$
declare
  confirm_definition text;
  publish_definition text;
  trigger_definition text;
begin
  if to_regclass('private.market_draft_eligibility_bindings') is null then
    raise exception 'TEST_AGENT_ENGINE_BINDING_TABLE_MISSING';
  end if;
  if not exists (
    select 1 from pg_class table_row
    where table_row.oid = 'private.market_draft_eligibility_bindings'::regclass
      and table_row.relrowsecurity and table_row.relforcerowsecurity
  ) then
    raise exception 'TEST_AGENT_ENGINE_BINDING_RLS_MISSING';
  end if;
  if has_table_privilege('anon', 'private.market_draft_eligibility_bindings', 'SELECT')
     or has_table_privilege('authenticated', 'private.market_draft_eligibility_bindings', 'SELECT')
     or has_table_privilege('service_role', 'private.market_draft_eligibility_bindings', 'SELECT')
     or has_table_privilege('service_role', 'private.market_draft_eligibility_bindings', 'INSERT') then
    raise exception 'TEST_AGENT_ENGINE_BINDING_RAW_ACL_TOO_BROAD';
  end if;
  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'private.market_draft_eligibility_bindings'::regclass
      and tgname = 'reject_market_draft_eligibility_binding_mutation'
      and tgenabled <> 'D' and not tgisinternal
  ) then
    raise exception 'TEST_AGENT_ENGINE_BINDING_APPEND_ONLY_MISSING';
  end if;
  if (select count(*) from pg_indexes
      where schemaname = 'private'
        and indexname in (
          'market_draft_eligibility_bindings_draft_idx',
          'market_draft_eligibility_bindings_candidate_idx',
          'market_draft_eligibility_bindings_check_idx',
          'market_draft_eligibility_bindings_actor_idx'
        )) <> 4 then
    raise exception 'TEST_AGENT_ENGINE_BINDING_INDEXES_MISSING';
  end if;

  if has_function_privilege(
       'authenticated',
       'public.bind_market_radar_draft_eligibility_v2(uuid,uuid,bigint,text,bigint,bigint,uuid,uuid)',
       'EXECUTE'
     )
     or not has_function_privilege(
       'service_role',
       'public.bind_market_radar_draft_eligibility_v2(uuid,uuid,bigint,text,bigint,bigint,uuid,uuid)',
       'EXECUTE'
     )
     or has_function_privilege(
       'authenticated',
       'public.get_market_radar_candidate_for_draft_revalidation_v2(uuid,uuid,bigint,text)',
       'EXECUTE'
     ) then
    raise exception 'TEST_AGENT_ENGINE_SERVICE_RPC_ACL_INVALID';
  end if;
  if has_function_privilege('anon', 'public.confirm_market_draft_review(uuid,bigint)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.confirm_market_draft_review(uuid,bigint)', 'EXECUTE')
     or has_function_privilege('anon', 'public.publish_market_draft(uuid,bigint,timestamp with time zone)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.publish_market_draft(uuid,bigint,timestamp with time zone)', 'EXECUTE') then
    raise exception 'TEST_AGENT_ENGINE_ADMIN_RPC_ACL_INVALID';
  end if;

  select pg_get_functiondef('public.confirm_market_draft_review(uuid,bigint)'::regprocedure)
  into confirm_definition;
  select pg_get_functiondef('public.publish_market_draft(uuid,bigint,timestamp with time zone)'::regprocedure)
  into publish_definition;
  select pg_get_functiondef('private.market_draft_radar_eligibility_gate_v1()'::regprocedure)
  into trigger_definition;
  if position('private.require_current_admin()' in confirm_definition) = 0
     or position('ensure_market_source_confirmation_ready_v1' in confirm_definition) = 0
     or position('ensure_market_source_publication_ready' in confirm_definition) > 0 then
    raise exception 'TEST_AGENT_ENGINE_CONFIRMATION_GATE_INVALID';
  end if;
  if position('private.require_current_admin()' in publish_definition) = 0
     or position('ensure_market_source_publication_ready' in publish_definition) = 0 then
    raise exception 'TEST_AGENT_ENGINE_PUBLICATION_GATE_INVALID';
  end if;
  if trigger_definition !~* 'workflow_status[^;]{0,180}scheduled[^;]{0,180}published[^;]{0,240}assert_market_radar_draft_eligibility_v1' then
    raise exception 'TEST_AGENT_ENGINE_TRIGGER_PUBLICATION_GATE_MISSING';
  end if;
  if trigger_definition ~* 'workflow_status[^;]{0,180}human_confirmed[^;]{0,240}assert_market_radar_draft_eligibility_v1' then
    raise exception 'TEST_AGENT_ENGINE_CONFIRMATION_STILL_REQUIRES_RADAR';
  end if;

  if exists (
    select 1
    from private.external_market_candidates candidate
    join private.market_drafts draft_row
      on draft_row.id = candidate.prepared_draft_id
     and draft_row.radar_candidate_id = candidate.id
    where candidate.state = 'rejected'
      and candidate.verification_status = 'rejected_duplicate'
      and not exists (
        select 1
        from jsonb_array_elements(coalesce(candidate.duplicate_matches, '[]'::jsonb)) match_item
        where coalesce(match_item ->> 'blocking', 'true') <> 'false'
          and match_item ->> 'relationship' in ('exact_duplicate', 'semantic_duplicate')
          and coalesce(match_item ->> 'id', '') <> candidate.prepared_draft_id::text
      )
  ) then
    raise exception 'TEST_AGENT_ENGINE_FALSE_SELF_DUPLICATE_REMAINS';
  end if;
end;
$shape_acl_and_gates$;

set local role service_role;

do $raw_binding_access_denied$
begin
  begin
    perform 1 from private.market_draft_eligibility_bindings limit 1;
    raise exception 'TEST_AGENT_ENGINE_SERVICE_RAW_SELECT_ACCEPTED';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into private.market_draft_eligibility_bindings default values;
    raise exception 'TEST_AGENT_ENGINE_SERVICE_RAW_INSERT_ACCEPTED';
  exception when insufficient_privilege then null;
  end;
end;
$raw_binding_access_denied$;

reset role;

select jsonb_build_object(
  'ok', true,
  'suite', 'agent_engine_confirmation_v8_transaction',
  'bindings', (select count(*) from private.market_draft_eligibility_bindings)
) as result;

rollback;
