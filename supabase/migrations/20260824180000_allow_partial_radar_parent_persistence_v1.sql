begin;

-- Un padre incompleto debe permanecer fail-closed sin bloquear los padres
-- completos del mismo proveedor. No hay DML manual ni backfill: se ajustan los
-- writers durables para promover solo candidatas ligadas a padres completos y
-- finalizar la intención como parcial cuando exista cualquier padre incompleto.

do $preflight$
declare
  function_source text;
  function_hash text;
begin
  select replace(pg_get_functiondef(
    'public.process_market_radar_refresh_batch_v2(uuid,text,text,uuid)'::regprocedure
  ),chr(13)||chr(10),chr(10)) into function_source;
  function_hash:=encode(extensions.digest(convert_to(function_source,'UTF8'),'sha256'),'hex');
  if function_hash<>'5f507eaa0e5ba70207b9c3fa8b060ff6c8a3f94a37417faffb96ad55cd907926'
     or function_source not like '%intent.provider_pagination_exhausted is not true then%' then
    raise exception 'RADAR_PARTIAL_PARENT_BATCH_PREFLIGHT_DRIFT:%',function_hash;
  end if;

  select replace(pg_get_functiondef(
    'public.finalize_market_radar_refresh_v4(uuid,text,text,uuid,text,text,text,integer)'::regprocedure
  ),chr(13)||chr(10),chr(10)) into function_source;
  function_hash:=encode(extensions.digest(convert_to(function_source,'UTF8'),'sha256'),'hex');
  if function_hash<>'9fcc8efea66de602c88de8e78303f4e2ffafbe639e92177eea15f3443ff4ff51'
     or function_source not like '%status_input=''available''%intent.provider_pagination_exhausted is not true%'
     or function_source not like '%result:=public.finalize_market_radar_refresh_v3(%' then
    raise exception 'RADAR_PARTIAL_PARENT_FINALIZER_PREFLIGHT_DRIFT:%',function_hash;
  end if;

  select replace(pg_get_functiondef(
    'public.complete_market_radar_candidate_refresh_v1(uuid,text,text,uuid,text,text,text,integer)'::regprocedure
  ),chr(13)||chr(10),chr(10)) into function_source;
  function_hash:=encode(extensions.digest(convert_to(function_source,'UTF8'),'sha256'),'hex');
  if function_hash<>'3e0df80d753e6b94a1b9546664c8bbc0b3a6757b60726a3175303ffe6e96e21a'
     or function_source not like '%protected_rebound_count_value integer:=0;%'
     or function_source like '%incomplete_parent_count_value integer%' then
    raise exception 'RADAR_PARTIAL_PARENT_COMPLETION_PREFLIGHT_DRIFT:%',function_hash;
  end if;
end;
$preflight$;

do $patch$
declare
  function_source text;
  patched_source text;
begin
  select replace(pg_get_functiondef(
    'public.process_market_radar_refresh_batch_v2(uuid,text,text,uuid)'::regprocedure
  ),chr(13)||chr(10),chr(10)) into function_source;
  patched_source:=replace(
    function_source,
    'or intent.provider_pagination_exhausted is not true then',
    'then'
  );
  if patched_source=function_source then
    raise exception 'RADAR_PARTIAL_PARENT_BATCH_PATCH_MISSING';
  end if;
  execute patched_source;

  select replace(pg_get_functiondef(
    'public.finalize_market_radar_refresh_v4(uuid,text,text,uuid,text,text,text,integer)'::regprocedure
  ),chr(13)||chr(10),chr(10)) into function_source;
  patched_source:=replace(
    function_source,
$old_replay$  if intent.status<>'in_progress' then
    result:=public.finalize_market_radar_refresh_v3(
      request_id_input,provider_input,capability_input,lease_token_input,
      status_input,error_code_input,failure_stage_input,retry_after_seconds_input
    );
    return result||jsonb_build_object('provider_selection',intent.provider_selection);
  end if;$old_replay$,
$new_replay$  if intent.status<>'in_progress' then
    return coalesce(intent.response_summary,'{}'::jsonb)
      ||jsonb_build_object('provider_selection',intent.provider_selection,'replayed',true);
  end if;$new_replay$
  );
  if patched_source=function_source then
    raise exception 'RADAR_PARTIAL_PARENT_REPLAY_PATCH_MISSING';
  end if;
  function_source:=patched_source;
  patched_source:=replace(
    function_source,
    'capability_input=''candidate_feed'' and status_input=''available'' and (',
    'capability_input=''candidate_feed'' and status_input in (''available'',''partial_error'') and ('
  );
  if patched_source=function_source then
    raise exception 'RADAR_PARTIAL_PARENT_FINAL_STATUS_PATCH_MISSING';
  end if;
  function_source:=patched_source;
  patched_source:=replace(
    function_source,
    '    or intent.provider_pagination_exhausted is not true'||chr(10),
    ''
  );
  if patched_source=function_source then
    raise exception 'RADAR_PARTIAL_PARENT_FINAL_GUARD_PATCH_MISSING';
  end if;
  execute patched_source;

  select replace(pg_get_functiondef(
    'public.complete_market_radar_candidate_refresh_v1(uuid,text,text,uuid,text,text,text,integer)'::regprocedure
  ),chr(13)||chr(10),chr(10)) into function_source;
  patched_source:=replace(
    function_source,
    '  protected_rebound_count_value integer:=0;',
    '  protected_rebound_count_value integer:=0;'||chr(10)
      ||'  incomplete_parent_count_value integer:=0;'||chr(10)
      ||'  provider_pagination_exhausted_value boolean:=false;'
  );
  if patched_source=function_source then
    raise exception 'RADAR_PARTIAL_PARENT_COMPLETION_DECLARE_PATCH_MISSING';
  end if;
  function_source:=patched_source;
  patched_source:=replace(
    function_source,
$old_completion$  protected_rebound_count_value:=private.rebind_market_radar_protected_candidates_v1(
    request_id_input,provider_input
  );
  finalized_result:=public.finalize_market_radar_refresh_v4(
    request_id_input,provider_input,capability_input,lease_token_input,
    status_input,error_code_input,failure_stage_input,retry_after_seconds_input
  );$old_completion$,
$new_completion$  protected_rebound_count_value:=private.rebind_market_radar_protected_candidates_v1(
    request_id_input,provider_input
  );
  select coalesce(intent_alias.incomplete_parent_count,0),
    coalesce(intent_alias.provider_pagination_exhausted,false)
  into incomplete_parent_count_value,provider_pagination_exhausted_value
  from private.market_radar_refresh_intents_v1 intent_alias
  where intent_alias.request_id=request_id_input
    and intent_alias.provider=provider_input
    and intent_alias.capability=capability_input;
  if not found then
    raise exception 'RADAR_REFRESH_REQUEST_NOT_FOUND' using errcode='22023';
  end if;
  finalized_result:=public.finalize_market_radar_refresh_v4(
    request_id_input,provider_input,capability_input,lease_token_input,
    case when not provider_pagination_exhausted_value then 'partial_error' else status_input end,
    case when not provider_pagination_exhausted_value
      then 'RADAR_PARENT_RECONCILIATION_INCOMPLETE' else error_code_input end,
    case when not provider_pagination_exhausted_value then 'fetch' else failure_stage_input end,
    case when not provider_pagination_exhausted_value then 300 else retry_after_seconds_input end
  );$new_completion$
  );
  if patched_source=function_source then
    raise exception 'RADAR_PARTIAL_PARENT_COMPLETION_PATCH_MISSING';
  end if;
  execute patched_source;
end;
$patch$;

alter function public.process_market_radar_refresh_batch_v2(uuid,text,text,uuid)
  owner to postgres;
alter function public.finalize_market_radar_refresh_v4(
  uuid,text,text,uuid,text,text,text,integer
) owner to postgres;
alter function public.complete_market_radar_candidate_refresh_v1(
  uuid,text,text,uuid,text,text,text,integer
) owner to postgres;

revoke all on function public.process_market_radar_refresh_batch_v2(uuid,text,text,uuid)
  from public,anon,authenticated,service_role;
revoke all on function public.finalize_market_radar_refresh_v4(
  uuid,text,text,uuid,text,text,text,integer
) from public,anon,authenticated,service_role;
revoke all on function public.complete_market_radar_candidate_refresh_v1(
  uuid,text,text,uuid,text,text,text,integer
) from public,anon,authenticated,service_role;
grant execute on function public.complete_market_radar_candidate_refresh_v1(
  uuid,text,text,uuid,text,text,text,integer
) to service_role;

do $postflight$
declare
  batch_source text;
  finalizer_source text;
  completion_source text;
begin
  select pg_get_functiondef(
    'public.process_market_radar_refresh_batch_v2(uuid,text,text,uuid)'::regprocedure
  ) into batch_source;
  select pg_get_functiondef(
    'public.finalize_market_radar_refresh_v4(uuid,text,text,uuid,text,text,text,integer)'::regprocedure
  ) into finalizer_source;
  select pg_get_functiondef(
    'public.complete_market_radar_candidate_refresh_v1(uuid,text,text,uuid,text,text,text,integer)'::regprocedure
  ) into completion_source;
  if batch_source like '%intent.provider_pagination_exhausted is not true then%'
     or finalizer_source not like '%status_input in (''available'',''partial_error'')%'
     or finalizer_source like '%intent.provider_pagination_exhausted is not true%'
     or finalizer_source not like '%coalesce(intent.response_summary%''replayed'',true%'
     or completion_source not like '%incomplete_parent_count_value integer%'
     or completion_source not like '%provider_pagination_exhausted_value boolean%'
     or completion_source not like '%RADAR_PARENT_RECONCILIATION_INCOMPLETE%'
     or completion_source not like '%not provider_pagination_exhausted_value%''partial_error''%' then
    raise exception 'RADAR_PARTIAL_PARENT_POSTFLIGHT_BODY_INVALID';
  end if;
  if exists (
    select 1 from pg_proc procedure
    join pg_roles role_alias on role_alias.oid=procedure.proowner
    where procedure.oid in (
      'public.process_market_radar_refresh_batch_v2(uuid,text,text,uuid)'::regprocedure::oid,
      'public.finalize_market_radar_refresh_v4(uuid,text,text,uuid,text,text,text,integer)'::regprocedure::oid,
      'public.complete_market_radar_candidate_refresh_v1(uuid,text,text,uuid,text,text,text,integer)'::regprocedure::oid
    ) and (role_alias.rolname<>'postgres' or not procedure.prosecdef
      or not procedure.proconfig@>array['search_path=""']::text[])
  ) then
    raise exception 'RADAR_PARTIAL_PARENT_POSTFLIGHT_SECURITY_INVALID';
  end if;
  if has_function_privilege('anon',
       'public.complete_market_radar_candidate_refresh_v1(uuid,text,text,uuid,text,text,text,integer)','execute')
     or has_function_privilege('authenticated',
       'public.complete_market_radar_candidate_refresh_v1(uuid,text,text,uuid,text,text,text,integer)','execute')
     or not has_function_privilege('service_role',
       'public.complete_market_radar_candidate_refresh_v1(uuid,text,text,uuid,text,text,text,integer)','execute')
     or has_function_privilege('service_role',
       'public.process_market_radar_refresh_batch_v2(uuid,text,text,uuid)','execute')
     or has_function_privilege('service_role',
       'public.finalize_market_radar_refresh_v4(uuid,text,text,uuid,text,text,text,integer)','execute') then
    raise exception 'RADAR_PARTIAL_PARENT_POSTFLIGHT_ACL_INVALID';
  end if;
end;
$postflight$;

commit;
