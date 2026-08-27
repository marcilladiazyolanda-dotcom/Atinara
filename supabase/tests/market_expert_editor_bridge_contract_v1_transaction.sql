begin;

do $test$
declare
  definition text;
begin
  if to_regprocedure(
       'public.materialize_market_draft_for_repair_v1(uuid,bigint,uuid,jsonb)'
     ) is null
     or to_regprocedure(
       'public.save_market_draft_from_expert_with_issues_v2(uuid,uuid,jsonb)'
     ) is null then
    raise exception 'MARKET_EXPERT_EDITOR_BRIDGE_FUNCTION_MISSING';
  end if;

  select pg_catalog.pg_get_functiondef(
    'public.materialize_market_draft_for_repair_v1(uuid,bigint,uuid,jsonb)'::regprocedure
  ) into definition;
  if pg_catalog.position(
       'save_market_draft_from_expert_with_issues_v2' in definition
     )=0
     or pg_catalog.position(
       'writer_contract_version' in definition
     )=0
     or pg_catalog.position(
       'draft_input - ''_radar_preparation_revision''' in definition
     )>0
     or pg_catalog.position(
       'save_market_draft_from_radar(' in definition
     )>0 then
    raise exception 'MARKET_EXPERT_EDITOR_BRIDGE_WRITER_MISMATCH';
  end if;

  if has_function_privilege(
       'anon',
       'public.materialize_market_draft_for_repair_v1(uuid,bigint,uuid,jsonb)',
       'execute'
     )
     or not has_function_privilege(
       'authenticated',
       'public.materialize_market_draft_for_repair_v1(uuid,bigint,uuid,jsonb)',
       'execute'
     )
     or has_function_privilege(
       'service_role',
       'public.materialize_market_draft_for_repair_v1(uuid,bigint,uuid,jsonb)',
       'execute'
     ) then
    raise exception 'MARKET_EXPERT_EDITOR_BRIDGE_PRIVILEGE_MISMATCH';
  end if;
end;
$test$;

rollback;
