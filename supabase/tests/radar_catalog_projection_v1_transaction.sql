begin;

do $test$
declare
  payload jsonb;
  function_row record;
  function_source text;
begin
  if to_regprocedure('private.market_radar_catalog_candidate_payload_v1(jsonb,boolean)') is null
     or to_regprocedure('private.market_radar_catalog_candidate_row_payload_v1(private.external_market_candidates,bigint)') is null
     or to_regprocedure('public.list_market_radar_candidates_v5(text,text,text,text,text,text,integer,integer)') is null
     or to_regprocedure('public.list_market_radar_rejections_v3(text,text,integer,integer)') is null
     or to_regprocedure('public.list_market_radar_parent_reconciliations_v3(text,text,text,text,integer,integer)') is null then
    raise exception 'TEST_RADAR_CATALOG_PROJECTION_FUNCTION_MISSING';
  end if;

  for function_row in
    select p.oid,p.proowner::regrole::text as owner,p.prosecdef,p.proconfig
    from pg_proc p
    where p.oid=any(array[
      'private.market_radar_catalog_candidate_payload_v1(jsonb,boolean)'::regprocedure::oid,
      'private.market_radar_catalog_candidate_row_payload_v1(private.external_market_candidates,bigint)'::regprocedure::oid,
      'public.list_market_radar_candidates_v5(text,text,text,text,text,text,integer,integer)'::regprocedure::oid,
      'public.list_market_radar_rejections_v3(text,text,integer,integer)'::regprocedure::oid,
      'public.list_market_radar_parent_reconciliations_v3(text,text,text,text,integer,integer)'::regprocedure::oid
    ])
  loop
    if function_row.owner<>'postgres' or not function_row.prosecdef
       or function_row.proconfig is distinct from array['search_path=""']::text[] then
      raise exception 'TEST_RADAR_CATALOG_PROJECTION_SECURITY_INVALID:%',function_row.oid;
    end if;
  end loop;

  if has_function_privilege('anon',
       'public.list_market_radar_candidates_v5(text,text,text,text,text,text,integer,integer)','execute')
     or not has_function_privilege('authenticated',
       'public.list_market_radar_candidates_v5(text,text,text,text,text,text,integer,integer)','execute')
     or has_function_privilege('authenticated',
       'private.market_radar_catalog_candidate_payload_v1(jsonb,boolean)','execute')
     or has_function_privilege('service_role',
       'private.market_radar_catalog_candidate_row_payload_v1(private.external_market_candidates,bigint)','execute') then
    raise exception 'TEST_RADAR_CATALOG_PROJECTION_ACL_INVALID';
  end if;

  select pg_get_functiondef(
    'public.list_market_radar_candidates_v5(text,text,text,text,text,text,integer,integer)'::regprocedure
  ) into function_source;
  if function_source like '%public.list_market_radar_candidates_v4(%'
     or function_source not like '%market_radar_catalog_candidate_row_payload_v1%'
     or function_source not like '%select candidate.id,candidate.provider,candidate.external_id%'
     or function_source like '%select candidate.*,%' then
    raise exception 'TEST_RADAR_CATALOG_BOUNDARY_NOT_PUSHED_DOWN';
  end if;

  payload:=private.market_radar_catalog_candidate_payload_v1(jsonb_build_object(
    'id','00000000-0000-4000-8000-000000000001',
    'provider','kalshi','external_id','kalshi:test','fetched_at','2026-08-25T12:00:00Z',
    'provider_payload',jsonb_build_object('raw_secret_like_bulk',repeat('x',10000)),
    'source_excerpt',jsonb_build_object('raw_source_dates',jsonb_build_array(repeat('x',10000))),
    'hard_reject_reasons',jsonb_build_array('EVENT_ALREADY_RESOLVED'),
    'duplicate_matches',jsonb_build_array(jsonb_build_object(
      'id','00000000-0000-4000-8000-000000000002','question','Duplicada',
      'relationship','exact_duplicate','blocking',true,'raw',repeat('x',10000))),
    'workflow_issues',jsonb_build_array(jsonb_build_object(
      'issue_id','00000000-0000-4000-8000-000000000003','issue_code','EVENT_ALREADY_RESOLVED',
      'blocking_scope','terminal','repairability','terminal','raw',repeat('x',10000)))
  ),true);

  if payload ->> 'provider'<>'kalshi' or payload ->> 'fetched_at'<>'2026-08-25T12:00:00Z'
     or payload ? 'provider_payload' or payload ? 'source_excerpt'
     or octet_length(payload::text)>5000
     or payload #>> '{duplicate_matches,0,relationship}'<>'exact_duplicate'
     or payload #>> '{workflow_issues,0,issue_code}'<>'EVENT_ALREADY_RESOLVED' then
    raise exception 'TEST_RADAR_CATALOG_PROJECTION_PAYLOAD_INVALID:%',payload;
  end if;
end;
$test$;

rollback;
