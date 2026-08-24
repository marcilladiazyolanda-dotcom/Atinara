begin;

-- PostgREST aplica un statement_timeout de 8 s a la sesión autenticadora. Una
-- familia no puede exponerse por partes, pero tampoco debe procesar todos los
-- batches del proveedor dentro de una única sentencia. La puerta vigente de
-- reconciliación ya mantiene invisibles las candidatas mientras su intención
-- no sea terminal. Estos wrappers permiten confirmar un batch por transacción
-- y finalizar únicamente cuando todos están completos.

do $preflight$
declare
  function_source text;
  function_hash text;
begin
  select replace(pg_get_functiondef(
    'public.process_market_radar_refresh_batch_v2(uuid,text,text,uuid)'::regprocedure
  ),chr(13)||chr(10),chr(10)) into function_source;
  function_hash:=encode(extensions.digest(convert_to(function_source,'UTF8'),'sha256'),'hex');
  if function_hash<>'b5d75696bc3ad67e5f07b1cc4df25b0dfd606813d893e9e75b4fc1ecdcd0f6ed'
     or function_source not like '%RADAR_ATOMIC_CANDIDATE_COMMIT_REQUIRED%'
     or function_source like '%intent.provider_pagination_exhausted is not true then%' then
    raise exception 'RADAR_BATCH_RESUME_PROCESS_PREFLIGHT_DRIFT:%',function_hash;
  end if;

  select replace(pg_get_functiondef(
    'public.complete_market_radar_candidate_refresh_v1(uuid,text,text,uuid,text,text,text,integer)'::regprocedure
  ),chr(13)||chr(10),chr(10)) into function_source;
  function_hash:=encode(extensions.digest(convert_to(function_source,'UTF8'),'sha256'),'hex');
  if function_hash<>'6d8dce6096868776da84524896df7b4b3d95cb753db6d27f889da9fe8c41fe16'
     or function_source not like '%provider_pagination_exhausted_value boolean:=false;%'
     or function_source not like '%RADAR_PARENT_RECONCILIATION_INCOMPLETE%' then
    raise exception 'RADAR_BATCH_RESUME_COMPLETE_PREFLIGHT_DRIFT:%',function_hash;
  end if;

  select replace(pg_get_functiondef(
    'private.market_radar_candidate_reconciliation_bound_v1(private.external_market_candidates)'::regprocedure
  ),chr(13)||chr(10),chr(10)) into function_source;
  function_hash:=encode(extensions.digest(convert_to(function_source,'UTF8'),'sha256'),'hex');
  if function_hash<>'fb9885b924c5890aef58065448eb50e7652ed9ea993781e0b73c6c78b0a6d238'
     or function_source not like '%latest_intent.status in (''completed'',''partial'')%' then
    raise exception 'RADAR_BATCH_RESUME_VISIBILITY_PREFLIGHT_DRIFT:%',function_hash;
  end if;
end;
$preflight$;

do $visibility_patch$
declare
  function_source text;
  patched_source text;
  old_anchor text:='    and candidate.current_parent_child_id is not null'||chr(10)
    ||'    and exists (';
  new_anchor text:='    and candidate.current_parent_child_id is not null'||chr(10)
    ||'    and not exists ('||chr(10)
    ||'      select 1'||chr(10)
    ||'      from private.market_radar_parent_reconciliations_v1 active_parent'||chr(10)
    ||'      join private.market_radar_refresh_intents_v1 active_intent'||chr(10)
    ||'        on active_intent.request_id=active_parent.request_id'||chr(10)
    ||'       and active_intent.provider=active_parent.provider'||chr(10)
    ||'       and active_intent.capability=active_parent.capability'||chr(10)
    ||'      where active_parent.provider=candidate.provider'||chr(10)
    ||'        and active_parent.provider_parent_id=candidate.external_event_id'||chr(10)
    ||'        and active_intent.status=''in_progress'''||chr(10)
    ||'    )'||chr(10)
    ||'    and exists (';
begin
  select replace(pg_get_functiondef(
    'private.market_radar_candidate_reconciliation_bound_v1(private.external_market_candidates)'::regprocedure
  ),chr(13)||chr(10),chr(10)) into function_source;
  patched_source:=replace(function_source,old_anchor,new_anchor);
  if patched_source=function_source then
    raise exception 'RADAR_BATCH_RESUME_VISIBILITY_PATCH_MISSING';
  end if;
  execute patched_source;
end;
$visibility_patch$;

create or replace function public.process_market_radar_refresh_batch_v3(
  request_id_input uuid,
  provider_input text,
  capability_input text,
  lease_token_input uuid
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
begin
  if auth.role()<>'service_role' then
    raise exception 'SERVICE_ROLE_REQUIRED' using errcode='42501';
  end if;
  perform set_config('atinara.radar_atomic_candidate_commit',request_id_input::text,true);
  return public.process_market_radar_refresh_batch_v2(
    request_id_input,provider_input,capability_input,lease_token_input
  )||jsonb_build_object(
    'batch_commit_version','atinara-radar-batch-commit-v1',
    'candidate_visibility','deferred_until_provider_terminal'
  );
end;
$function$;

create or replace function public.complete_market_radar_candidate_refresh_v2(
  request_id_input uuid,
  provider_input text,
  capability_input text,
  lease_token_input uuid,
  status_input text,
  error_code_input text,
  failure_stage_input text,
  retry_after_seconds_input integer
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  intent private.market_radar_refresh_intents_v1%rowtype;
  remaining_batch_count integer;
  result jsonb;
begin
  if auth.role()<>'service_role' then
    raise exception 'SERVICE_ROLE_REQUIRED' using errcode='42501';
  end if;
  select * into intent
  from private.market_radar_refresh_intents_v1 intent_alias
  where intent_alias.request_id=request_id_input
    and intent_alias.provider=provider_input
    and intent_alias.capability=capability_input
  for update;
  if not found then
    raise exception 'RADAR_REFRESH_REQUEST_NOT_FOUND' using errcode='22023';
  end if;
  if intent.status<>'in_progress' then
    result:=public.complete_market_radar_candidate_refresh_v1(
      request_id_input,provider_input,capability_input,lease_token_input,
      status_input,error_code_input,failure_stage_input,retry_after_seconds_input
    );
    return result||jsonb_build_object(
      'batch_commit_version','atinara-radar-batch-commit-v1','replayed',true
    );
  end if;
  intent:=private.assert_market_radar_refresh_lease_v1(
    request_id_input,provider_input,capability_input,lease_token_input
  );
  select count(*) into remaining_batch_count
  from private.market_radar_refresh_batches_v1 batch_alias
  where batch_alias.request_id=request_id_input
    and batch_alias.provider=provider_input
    and batch_alias.capability=capability_input
    and batch_alias.status not in ('completed','superseded');
  if remaining_batch_count<>0
     or intent.expected_count is null
     or intent.processed_count is distinct from intent.expected_count then
    raise exception 'RADAR_REFRESH_BATCHES_REMAIN:%',remaining_batch_count
      using errcode='55000';
  end if;
  result:=public.complete_market_radar_candidate_refresh_v1(
    request_id_input,provider_input,capability_input,lease_token_input,
    status_input,error_code_input,failure_stage_input,retry_after_seconds_input
  );
  return result||jsonb_build_object(
    'batch_commit_version','atinara-radar-batch-commit-v1',
    'provider_visibility_committed',true
  );
end;
$function$;

alter function public.process_market_radar_refresh_batch_v3(uuid,text,text,uuid)
  owner to postgres;
alter function public.complete_market_radar_candidate_refresh_v2(
  uuid,text,text,uuid,text,text,text,integer
) owner to postgres;
alter function private.market_radar_candidate_reconciliation_bound_v1(
  private.external_market_candidates
) owner to postgres;

revoke all on function public.process_market_radar_refresh_batch_v3(uuid,text,text,uuid)
  from public,anon,authenticated,service_role;
revoke all on function public.complete_market_radar_candidate_refresh_v2(
  uuid,text,text,uuid,text,text,text,integer
) from public,anon,authenticated,service_role;
grant execute on function public.process_market_radar_refresh_batch_v3(uuid,text,text,uuid)
  to service_role;
grant execute on function public.complete_market_radar_candidate_refresh_v2(
  uuid,text,text,uuid,text,text,text,integer
) to service_role;
revoke all on function private.market_radar_candidate_reconciliation_bound_v1(
  private.external_market_candidates
) from public,anon,authenticated,service_role;

comment on function public.process_market_radar_refresh_batch_v3(uuid,text,text,uuid) is
  'Confirma un único batch durable por transacción; la intención no terminal mantiene sus candidatas fuera de la proyección actual.';
comment on function public.complete_market_radar_candidate_refresh_v2(
  uuid,text,text,uuid,text,text,text,integer
) is 'Finaliza y hace visible el proveedor solo después de confirmar todos sus batches.';

do $postflight$
declare
  procedure_oid regprocedure;
  function_source text;
begin
  foreach procedure_oid in array array[
    'public.process_market_radar_refresh_batch_v3(uuid,text,text,uuid)'::regprocedure,
    'public.complete_market_radar_candidate_refresh_v2(uuid,text,text,uuid,text,text,text,integer)'::regprocedure
  ] loop
    select pg_get_functiondef(procedure_oid)
    into function_source
    from pg_proc procedure where procedure.oid=procedure_oid::oid
      and procedure.prosecdef
      and procedure.proconfig@>array['search_path=""']::text[]
      and pg_get_userbyid(procedure.proowner)='postgres';
    if function_source is null
       or has_function_privilege('anon',procedure_oid,'execute')
       or has_function_privilege('authenticated',procedure_oid,'execute')
       or not has_function_privilege('service_role',procedure_oid,'execute') then
      raise exception 'RADAR_BATCH_RESUME_POSTFLIGHT_SECURITY_INVALID:%',procedure_oid;
    end if;
  end loop;
  if pg_get_functiondef(
       'public.process_market_radar_refresh_batch_v3(uuid,text,text,uuid)'::regprocedure
     ) not like '%candidate_visibility%deferred_until_provider_terminal%'
     or pg_get_functiondef(
       'public.complete_market_radar_candidate_refresh_v2(uuid,text,text,uuid,text,text,text,integer)'::regprocedure
     ) not like '%RADAR_REFRESH_BATCHES_REMAIN%provider_visibility_committed%' then
    raise exception 'RADAR_BATCH_RESUME_POSTFLIGHT_BODY_INVALID';
  end if;
  select pg_get_functiondef(procedure.oid)
  into function_source
  from pg_proc procedure
  where procedure.oid=
    'private.market_radar_candidate_reconciliation_bound_v1(private.external_market_candidates)'::regprocedure::oid
    and procedure.prosecdef
    and procedure.proconfig@>array['search_path=""']::text[]
    and pg_get_userbyid(procedure.proowner)='postgres';
  if function_source not like '%active_intent.status=''in_progress''%'
     or has_function_privilege('anon',
       'private.market_radar_candidate_reconciliation_bound_v1(private.external_market_candidates)','execute')
     or has_function_privilege('authenticated',
       'private.market_radar_candidate_reconciliation_bound_v1(private.external_market_candidates)','execute')
     or has_function_privilege('service_role',
       'private.market_radar_candidate_reconciliation_bound_v1(private.external_market_candidates)','execute') then
    raise exception 'RADAR_BATCH_RESUME_VISIBILITY_POSTFLIGHT_INVALID';
  end if;
end;
$postflight$;

commit;
