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
  if pg_catalog.strpos(
       definition,'save_market_draft_from_expert_with_issues_v2'
     )=0
     or pg_catalog.strpos(
       definition,'writer_contract_version'
     )=0
     or pg_catalog.strpos(
       definition,'draft_input - ''_radar_preparation_revision'''
     )>0
     or pg_catalog.strpos(
       definition,'save_market_draft_from_radar('
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
