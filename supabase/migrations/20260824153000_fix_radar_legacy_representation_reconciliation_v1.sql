begin;

-- Corrección aditiva, sin DML ni backfill. Una identidad estable del proveedor
-- puede tener varias representaciones históricas (por ejemplo, un external_id
-- antiguo y el mismo ID enriquecido después). Las filas raw se conservan; el
-- contrato de completitud cuenta hijas lógicas y sigue exigiendo que toda fila
-- histórica esté cubierta por una hija reconciliada.

do $preflight$
declare
  function_source text;
  function_hash text;
begin
  if to_regprocedure(
       'public.record_market_radar_parent_reconciliations_v1(uuid,text,text,uuid,jsonb)'
     ) is null
     or to_regprocedure(
       'private.market_radar_child_matches_legacy_v1(jsonb,jsonb,text)'
     ) is null then
    raise exception 'RADAR_LEGACY_REPRESENTATION_PREFLIGHT_MISSING';
  end if;
  select pg_catalog.pg_get_functiondef(
    'public.record_market_radar_parent_reconciliations_v1(uuid,text,text,uuid,jsonb)'::regprocedure
  ) into function_source;
  function_hash:=encode(extensions.digest(convert_to(
    replace(function_source,chr(13)||chr(10),chr(10)),'UTF8'
  ),'sha256'),'hex');
  if function_hash<>'a89b0b56766f91e9b3ecfe67af19cb6945112cff1b2666c2f9675630e8dbd60c'
     or function_source not like '%select count(*)::integer into legacy_candidate_count%'
     or function_source not like '%select count(*)::integer into legacy_ledger_count%'
     or function_source not like '%select count(*) from private.external_market_candidates baseline%'
     or function_source not like '%select count(*) from private.market_radar_parent_children_v1 baseline%' then
    raise exception 'RADAR_LEGACY_REPRESENTATION_PREFLIGHT_DRIFT:%',function_hash;
  end if;
end;
$preflight$;

create or replace function private.market_radar_legacy_child_logical_key_v1(
  baseline_input jsonb,
  provider_input text
)
returns text
language plpgsql
immutable
set search_path to ''
as $function$
declare
  provider_value text:=lower(nullif(btrim(provider_input),''));
  identity_value text:=nullif(btrim(baseline_input ->> 'provider_child_identity_key'),'');
  market_value text:=nullif(btrim(baseline_input ->> 'external_market_id'),'');
  condition_value text:=nullif(btrim(baseline_input ->> 'condition_id'),'');
  slug_value text:=nullif(btrim(baseline_input ->> 'child_slug'),'');
  occurrence_value text:=nullif(btrim(baseline_input ->> 'child_occurrence_key'),'');
  token_value text;
begin
  if provider_value not in ('polymarket','kalshi') then
    return null;
  end if;
  if identity_value~*('^'||provider_value||':(market|condition|token):') then
    return lower(identity_value);
  end if;
  if market_value is not null then
    if market_value~*('^'||provider_value||':market:') then
      market_value:=substring(market_value from char_length(provider_value)+9);
    elsif market_value~*('^'||provider_value||':') then
      market_value:=substring(market_value from char_length(provider_value)+2);
    end if;
    if nullif(market_value,'') is not null then
      return lower(provider_value||':market:'||market_value);
    end if;
  end if;
  if condition_value is not null then
    return lower(provider_value||':condition:'||condition_value);
  end if;
  if jsonb_typeof(baseline_input -> 'token_ids')='array' then
    select min(value) into token_value
    from jsonb_array_elements_text(baseline_input -> 'token_ids') token(value)
    where nullif(btrim(value),'') is not null;
  end if;
  if token_value is not null then
    return lower(provider_value||':token:'||token_value);
  end if;
  if identity_value is not null then
    return lower(identity_value);
  end if;
  if slug_value is not null then
    return lower(provider_value||':slug:'||slug_value);
  end if;
  return case when occurrence_value is null then null
    else lower(provider_value||':occurrence:'||occurrence_value) end;
end;
$function$;

alter function private.market_radar_legacy_child_logical_key_v1(jsonb,text)
  owner to postgres;
revoke all on function private.market_radar_legacy_child_logical_key_v1(jsonb,text)
  from public,anon,authenticated,service_role;

create or replace function private.market_radar_legacy_candidate_logical_key_v1(
  external_id_input text,
  normalized_payload_input jsonb,
  provider_input text
)
returns text
language sql
immutable
set search_path to ''
as $function$
  select private.market_radar_legacy_child_logical_key_v1(
    jsonb_build_object(
      'provider_child_identity_key',nullif(normalized_payload_input ->> 'parent_child_identity_key',''),
      'external_market_id',coalesce(
        nullif(normalized_payload_input ->> 'external_market_id',''),external_id_input
      ),
      'condition_id',nullif(normalized_payload_input #>> '{provider_payload,condition_id}',''),
      'token_ids',case
        when jsonb_typeof(normalized_payload_input #> '{provider_payload,token_ids}')='array'
          then normalized_payload_input #> '{provider_payload,token_ids}'
        else '[]'::jsonb end,
      'child_slug',nullif(normalized_payload_input ->> 'external_market_slug',''),
      'child_occurrence_key','legacy:'||coalesce(external_id_input,'unidentified')
    ),
    provider_input
  );
$function$;

alter function private.market_radar_legacy_candidate_logical_key_v1(text,jsonb,text)
  owner to postgres;
revoke all on function private.market_radar_legacy_candidate_logical_key_v1(text,jsonb,text)
  from public,anon,authenticated,service_role;

do $patch$
declare
  original_source text;
  patched_source text;
begin
  select pg_catalog.pg_get_functiondef(
    'public.record_market_radar_parent_reconciliations_v1(uuid,text,text,uuid,jsonb)'::regprocedure
  ) into original_source;
  patched_source:=replace(
    original_source,
    'select count(*)::integer into legacy_candidate_count',
    'select count(distinct private.market_radar_legacy_candidate_logical_key_v1(legacy_candidate.external_id,legacy_candidate.normalized_payload,provider_input))::integer into legacy_candidate_count'
  );
  if patched_source=original_source then
    raise exception 'RADAR_LEGACY_CANDIDATE_COUNT_PATCH_MISSING';
  end if;
  original_source:=patched_source;
  patched_source:=replace(
    original_source,
    'select count(*)::integer into legacy_ledger_count',
    'select count(distinct private.market_radar_legacy_child_logical_key_v1(to_jsonb(legacy_child),provider_input))::integer into legacy_ledger_count'
  );
  if patched_source=original_source then
    raise exception 'RADAR_LEGACY_LEDGER_COUNT_PATCH_MISSING';
  end if;
  original_source:=patched_source;
  patched_source:=replace(
    original_source,
    'select count(*) from private.external_market_candidates baseline',
    'select count(distinct private.market_radar_legacy_candidate_logical_key_v1(baseline.external_id,baseline.normalized_payload,provider_input)) from private.external_market_candidates baseline'
  );
  if patched_source=original_source then
    raise exception 'RADAR_LEGACY_CANDIDATE_BIJECTION_PATCH_MISSING';
  end if;
  original_source:=patched_source;
  patched_source:=replace(
    original_source,
    'select count(*) from private.market_radar_parent_children_v1 baseline',
    'select count(distinct private.market_radar_legacy_child_logical_key_v1(to_jsonb(baseline),provider_input)) from private.market_radar_parent_children_v1 baseline'
  );
  if patched_source=original_source then
    raise exception 'RADAR_LEGACY_LEDGER_BIJECTION_PATCH_MISSING';
  end if;
  execute patched_source;
end;
$patch$;

alter function public.record_market_radar_parent_reconciliations_v1(
  uuid,text,text,uuid,jsonb
) owner to postgres;
revoke all on function public.record_market_radar_parent_reconciliations_v1(
  uuid,text,text,uuid,jsonb
) from public,anon,authenticated;
grant execute on function public.record_market_radar_parent_reconciliations_v1(
  uuid,text,text,uuid,jsonb
) to service_role;

do $postflight$
declare
  function_source text;
begin
  select pg_catalog.pg_get_functiondef(
    'public.record_market_radar_parent_reconciliations_v1(uuid,text,text,uuid,jsonb)'::regprocedure
  ) into function_source;
  if function_source not like '%count(distinct private.market_radar_legacy_candidate_logical_key_v1(%'
     or function_source not like '%count(distinct private.market_radar_legacy_child_logical_key_v1(%'
     or function_source like '%select count(*)::integer into legacy_candidate_count%'
     or function_source like '%select count(*)::integer into legacy_ledger_count%'
     or function_source like '%select count(*) from private.external_market_candidates baseline%'
     or function_source like '%select count(*) from private.market_radar_parent_children_v1 baseline%' then
    raise exception 'RADAR_LEGACY_REPRESENTATION_POSTFLIGHT_BODY_INVALID';
  end if;
  if not exists (
    select 1
    from pg_catalog.pg_proc procedure
    join pg_catalog.pg_roles role_alias on role_alias.oid=procedure.proowner
    where procedure.oid in (
      'private.market_radar_legacy_child_logical_key_v1(jsonb,text)'::regprocedure::oid,
      'private.market_radar_legacy_candidate_logical_key_v1(text,jsonb,text)'::regprocedure::oid
    )
      and role_alias.rolname='postgres'
      and procedure.provolatile='i'
      and not procedure.prosecdef
      and procedure.proconfig@>array['search_path=""']::text[]
    group by role_alias.rolname
    having count(*)=2
  ) or not exists (
    select 1
    from pg_catalog.pg_proc procedure
    join pg_catalog.pg_roles role_alias on role_alias.oid=procedure.proowner
    where procedure.oid=
      'public.record_market_radar_parent_reconciliations_v1(uuid,text,text,uuid,jsonb)'::regprocedure::oid
      and role_alias.rolname='postgres'
      and procedure.prosecdef
      and procedure.proconfig@>array['search_path=""']::text[]
  ) then
    raise exception 'RADAR_LEGACY_REPRESENTATION_POSTFLIGHT_SECURITY_INVALID';
  end if;
  if has_function_privilege('anon',
       'private.market_radar_legacy_child_logical_key_v1(jsonb,text)','execute')
     or has_function_privilege('authenticated',
       'private.market_radar_legacy_child_logical_key_v1(jsonb,text)','execute')
     or has_function_privilege('service_role',
       'private.market_radar_legacy_child_logical_key_v1(jsonb,text)','execute')
     or has_function_privilege('anon',
       'private.market_radar_legacy_candidate_logical_key_v1(text,jsonb,text)','execute')
     or has_function_privilege('authenticated',
       'private.market_radar_legacy_candidate_logical_key_v1(text,jsonb,text)','execute')
     or has_function_privilege('service_role',
       'private.market_radar_legacy_candidate_logical_key_v1(text,jsonb,text)','execute')
     or has_function_privilege('anon',
       'public.record_market_radar_parent_reconciliations_v1(uuid,text,text,uuid,jsonb)','execute')
     or has_function_privilege('authenticated',
       'public.record_market_radar_parent_reconciliations_v1(uuid,text,text,uuid,jsonb)','execute')
     or not has_function_privilege('service_role',
       'public.record_market_radar_parent_reconciliations_v1(uuid,text,text,uuid,jsonb)','execute') then
    raise exception 'RADAR_LEGACY_REPRESENTATION_POSTFLIGHT_ACL_INVALID';
  end if;
end;
$postflight$;

commit;
