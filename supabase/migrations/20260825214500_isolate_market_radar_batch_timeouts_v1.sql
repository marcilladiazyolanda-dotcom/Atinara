begin;

-- PostgREST cancela la sentencia completa cuando el procesamiento supera su
-- statement_timeout. El primitive v1 ya convierte un timeout dentro del bucle
-- de items en un resultado durable, pero el preflight de v2 puede agotarlo
-- antes de entrar en ese bloque. Este wrapper reserva el mismo batch que va a
-- procesar v3 y conserva el timeout exterior como estado técnico reanudable.

do $preflight$
declare
  function_source text;
  function_hash text;
begin
  if to_regprocedure(
       'public.process_market_radar_refresh_batch_v2(uuid,text,text,uuid)'
     ) is null
     or to_regprocedure(
       'public.process_market_radar_refresh_batch_v3(uuid,text,text,uuid)'
     ) is null
     or to_regprocedure(
       'public.split_market_radar_refresh_batch_v1(uuid,text,text,uuid,uuid)'
     ) is null then
    raise exception 'RADAR_BATCH_TIMEOUT_ISOLATION_DEPENDENCY_MISSING';
  end if;

  select replace(pg_get_functiondef(
    'public.process_market_radar_refresh_batch_v2(uuid,text,text,uuid)'::regprocedure
  ),chr(13)||chr(10),chr(10)) into function_source;
  function_hash:=encode(extensions.digest(convert_to(function_source,'UTF8'),'sha256'),'hex');
  if function_hash<>'b5d75696bc3ad67e5f07b1cc4df25b0dfd606813d893e9e75b4fc1ecdcd0f6ed'
     or function_source not like '%public.process_market_radar_refresh_batch_v1(%'
     or function_source like '%intent.provider_pagination_exhausted is not true then%' then
    raise exception 'RADAR_BATCH_TIMEOUT_ISOLATION_V2_PREFLIGHT_DRIFT:%',function_hash;
  end if;

  select replace(pg_get_functiondef(
    'public.process_market_radar_refresh_batch_v3(uuid,text,text,uuid)'::regprocedure
  ),chr(13)||chr(10),chr(10)) into function_source;
  function_hash:=encode(extensions.digest(convert_to(function_source,'UTF8'),'sha256'),'hex');
  if function_hash<>'0b02adeb99438932134c784001b55257a361573110925b2ec55a1724edd0a6ed'
     or function_source not like '%public.process_market_radar_refresh_batch_v2(%'
     or function_source not like '%candidate_visibility%deferred_until_provider_terminal%' then
    raise exception 'RADAR_BATCH_TIMEOUT_ISOLATION_V3_PREFLIGHT_DRIFT:%',function_hash;
  end if;

  select replace(pg_get_functiondef(
    'public.split_market_radar_refresh_batch_v1(uuid,text,text,uuid,uuid)'::regprocedure
  ),chr(13)||chr(10),chr(10)) into function_source;
  function_hash:=encode(extensions.digest(convert_to(function_source,'UTF8'),'sha256'),'hex');
  if function_hash<>'82e1561a35610bd8cfff19bc1825644127d4f458fdebbc0478d1d1f68a4951bb'
     or function_source not like '%batch.status<>''technical_failed''%'
     or function_source not like '%jsonb_array_length(batch.items)<2%'
     or function_source not like '%batch.generation>=12%' then
    raise exception 'RADAR_BATCH_TIMEOUT_ISOLATION_SPLIT_PREFLIGHT_DRIFT:%',function_hash;
  end if;
end;
$preflight$;

create or replace function public.process_market_radar_refresh_batch_v4(
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
declare
  intent private.market_radar_refresh_intents_v1%rowtype;
  batch private.market_radar_refresh_batches_v1%rowtype;
  result jsonb;
  updated_count integer;
begin
  if auth.role()<>'service_role' then
    raise exception 'SERVICE_ROLE_REQUIRED' using errcode='42501';
  end if;

  -- Mantiene el orden de locks del writer vigente: intención y después batch.
  -- El lock se toma fuera del subbloque que captura query_canceled, de modo que
  -- la reversión del intento no pierde la identidad exacta que debe aislarse.
  intent:=private.assert_market_radar_refresh_lease_v1(
    request_id_input,provider_input,capability_input,lease_token_input
  );
  select * into batch
  from private.market_radar_refresh_batches_v1 batch_alias
  where batch_alias.request_id=request_id_input
    and batch_alias.provider=provider_input
    and batch_alias.capability=capability_input
    and batch_alias.status in ('pending','technical_failed')
  order by batch_alias.batch_ordinal,batch_alias.split_path
  limit 1
  for update skip locked;

  begin
    result:=public.process_market_radar_refresh_batch_v3(
      request_id_input,provider_input,capability_input,lease_token_input
    );
    return result||jsonb_build_object(
      'batch_timeout_isolation_version','atinara-radar-batch-timeout-isolation-v1'
    );
  exception when query_canceled then
    if batch.id is null then
      raise;
    end if;
    update private.market_radar_refresh_batches_v1 batch_alias set
      status='technical_failed',
      attempt_count=batch_alias.attempt_count+1,
      failed_count=jsonb_array_length(batch_alias.items),
      error_code='RADAR_PERSISTENCE_TIMEOUT',
      updated_at=clock_timestamp()
    where batch_alias.id=batch.id
      and batch_alias.request_id=request_id_input
      and batch_alias.provider=provider_input
      and batch_alias.capability=capability_input
      and batch_alias.status in ('pending','processing','technical_failed');
    get diagnostics updated_count=row_count;
    if updated_count<>1 then
      raise exception 'RADAR_REFRESH_BATCH_TIMEOUT_STATE_INVALID'
        using errcode='55000';
    end if;
    perform private.record_market_radar_refresh_event_v1(
      request_id_input,provider_input,capability_input,
      'RADAR_REFRESH_BATCH_TECHNICAL_FAILED','persisting','persisting',
      intent.accepted_count,intent.quarantined_count,
      jsonb_array_length(batch.items),'RADAR_PERSISTENCE_TIMEOUT',null
    );
    return jsonb_build_object(
      'ok',false,
      'retryable',true,
      'code','RADAR_PERSISTENCE_TIMEOUT',
      'batch_id',batch.id,
      'item_count',jsonb_array_length(batch.items),
      'batch_timeout_isolation_version','atinara-radar-batch-timeout-isolation-v1'
    );
  end;
end;
$function$;

alter function public.process_market_radar_refresh_batch_v4(uuid,text,text,uuid)
  owner to postgres;

revoke all on function public.process_market_radar_refresh_batch_v4(uuid,text,text,uuid)
  from public,anon,authenticated,service_role;
revoke all on function public.process_market_radar_refresh_batch_v3(uuid,text,text,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.process_market_radar_refresh_batch_v4(uuid,text,text,uuid)
  to service_role;

comment on function public.process_market_radar_refresh_batch_v4(uuid,text,text,uuid) is
  'Procesa un batch durable y conserva como timeout reanudable tanto el bucle v1 como el preflight exterior v2.';

do $postflight$
declare
  function_source text;
begin
  select pg_get_functiondef(procedure.oid)
  into function_source
  from pg_proc procedure
  where procedure.oid=
      'public.process_market_radar_refresh_batch_v4(uuid,text,text,uuid)'::regprocedure::oid
    and procedure.prosecdef
    and procedure.proconfig@>array['search_path=""']::text[]
    and pg_get_userbyid(procedure.proowner)='postgres';
  if function_source is null
     or function_source not like '%exception when query_canceled%'
     or function_source not like '%attempt_count=batch_alias.attempt_count+1%'
     or function_source not like '%RADAR_REFRESH_BATCH_TIMEOUT_STATE_INVALID%'
     or function_source not like '%atinara-radar-batch-timeout-isolation-v1%'
     or has_function_privilege('anon',
       'public.process_market_radar_refresh_batch_v4(uuid,text,text,uuid)','execute')
     or has_function_privilege('authenticated',
       'public.process_market_radar_refresh_batch_v4(uuid,text,text,uuid)','execute')
     or not has_function_privilege('service_role',
       'public.process_market_radar_refresh_batch_v4(uuid,text,text,uuid)','execute')
     or has_function_privilege('service_role',
       'public.process_market_radar_refresh_batch_v3(uuid,text,text,uuid)','execute')
     or not has_function_privilege('service_role',
       'public.split_market_radar_refresh_batch_v1(uuid,text,text,uuid,uuid)','execute') then
    raise exception 'RADAR_BATCH_TIMEOUT_ISOLATION_POSTFLIGHT_INVALID';
  end if;
end;
$postflight$;

commit;
