-- Radar provider resumability v1. All fixtures and technical writes roll back.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $test$
declare
  admin_id uuid := '11111111-1111-4111-8111-111111111111'::uuid;
  second_admin_id uuid := gen_random_uuid();
  normal_user_id uuid := gen_random_uuid();
  request_id_value uuid := gen_random_uuid();
  failure_request_id uuid := gen_random_uuid();
  probe_request_id uuid := gen_random_uuid();
  tavily_request_id uuid := gen_random_uuid();
  lease_owner_value uuid := gen_random_uuid();
  lease_token_value uuid;
  checked_at_value timestamptz := date_trunc('second',clock_timestamp());
  suffix text := replace(gen_random_uuid()::text,'-','');
  cache_key_value text := 'radar-resume-v1:'||replace(gen_random_uuid()::text,'-','');
  evidence jsonb;
  candidate_a jsonb;
  candidate_b jsonb;
  candidate_c jsonb;
  candidate_d jsonb;
  check_a jsonb;
  check_b jsonb;
  check_c jsonb;
  check_d jsonb;
  items jsonb;
  probe jsonb;
  started jsonb;
  stage jsonb;
  replay jsonb;
  sealed jsonb;
  split_result jsonb;
  first_processed jsonb;
  processed jsonb;
  finalized jsonb;
  batch_id_value uuid;
  before_economic jsonb;
  after_economic jsonb;
  count_value integer;
  history_id_value bigint;
  circuit_state_value text;
  expected_failure boolean;
  active_refresh jsonb;
begin
  if to_regclass('private.market_radar_refresh_intents_v1') is null
     or to_regclass('private.market_radar_refresh_batches_v1') is null
     or to_regclass('private.market_radar_provider_circuits_v1') is null
     or to_regclass('private.market_radar_refresh_events_v1') is null then
    raise exception 'TEST_RADAR_RESUME_SCHEMA_MISSING';
  end if;

  if exists(
    select 1 from pg_proc p join pg_roles r on r.oid=p.proowner
    where p.oid in (
      'public.begin_market_radar_refresh_v2(uuid,text,text,text,text,text,text,uuid,uuid)'::regprocedure::oid,
      'public.get_active_market_radar_refresh_v1(text,text)'::regprocedure::oid,
      'public.process_market_radar_refresh_batch_v1(uuid,text,text,uuid)'::regprocedure::oid,
      'public.process_market_radar_refresh_batch_v4(uuid,text,text,uuid)'::regprocedure::oid,
      'public.split_market_radar_refresh_batch_v1(uuid,text,text,uuid,uuid)'::regprocedure::oid,
      'public.finalize_market_radar_refresh_v3(uuid,text,text,uuid,text,text,text,integer)'::regprocedure::oid
    ) and (r.rolname<>'postgres' or not p.prosecdef
      or not (p.proconfig@>array['search_path=""']::text[]))
  ) then
    raise exception 'TEST_RADAR_RESUME_FUNCTION_SECURITY_INVALID';
  end if;

  if has_function_privilege('anon',
       'public.begin_market_radar_refresh_v2(uuid,text,text,text,text,text,text,uuid,uuid)','execute')
     or not has_function_privilege('authenticated',
       'public.begin_market_radar_refresh_v2(uuid,text,text,text,text,text,text,uuid,uuid)','execute')
     or not has_function_privilege('authenticated',
       'public.get_active_market_radar_refresh_v1(text,text)','execute')
     or has_function_privilege('service_role',
       'public.get_active_market_radar_refresh_v1(text,text)','execute')
     or has_function_privilege('authenticated',
       'public.process_market_radar_refresh_batch_v1(uuid,text,text,uuid)','execute')
     or has_function_privilege('service_role',
       'public.process_market_radar_refresh_batch_v1(uuid,text,text,uuid)','execute')
     or has_function_privilege('authenticated',
       'public.process_market_radar_refresh_batch_v4(uuid,text,text,uuid)','execute')
     or not has_function_privilege('service_role',
       'public.process_market_radar_refresh_batch_v4(uuid,text,text,uuid)','execute')
     or has_function_privilege('service_role',
       'public.process_market_radar_refresh_batch_v3(uuid,text,text,uuid)','execute')
     or has_function_privilege('authenticated',
       'public.split_market_radar_refresh_batch_v1(uuid,text,text,uuid,uuid)','execute')
     or not has_function_privilege('service_role',
       'public.split_market_radar_refresh_batch_v1(uuid,text,text,uuid,uuid)','execute')
     or has_table_privilege('service_role','private.market_radar_refresh_intents_v1','select')
     or has_table_privilege('service_role','private.market_radar_provider_runs','update')
     or has_table_privilege('service_role','private.market_radar_candidate_quarantines','insert') then
    raise exception 'TEST_RADAR_RESUME_ACL_INVALID';
  end if;

  select jsonb_build_object(
    'markets',(select coalesce(md5(string_agg(md5(to_jsonb(t)::text),'' order by to_jsonb(t)::text)),md5('')) from public.markets t),
    'predictions',(select coalesce(md5(string_agg(md5(to_jsonb(t)::text),'' order by to_jsonb(t)::text)),md5('')) from public.predictions t),
    'profiles',(select coalesce(md5(string_agg(md5(to_jsonb(t)::text),'' order by to_jsonb(t)::text)),md5('')) from public.profiles t
      where id not in (second_admin_id,normal_user_id)),
    'maker',(select coalesce(md5(string_agg(md5(to_jsonb(t)::text),'' order by to_jsonb(t)::text)),md5('')) from public.market_maker_state t),
    'prices',(select coalesce(md5(string_agg(md5(to_jsonb(t)::text),'' order by to_jsonb(t)::text)),md5('')) from public.market_price_history t)
  ) into before_economic;

  insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data)
  values
    (second_admin_id,'second-admin@example.invalid','{"oraklo_admin":true}'::jsonb,'{}'::jsonb),
    (normal_user_id,'normal@example.invalid','{}'::jsonb,'{}'::jsonb);
  insert into public.profiles(id,username) values
    (second_admin_id,'second-admin-'||left(suffix,8)),
    (normal_user_id,'normal-'||left(suffix,8));

  perform set_config('request.jwt.claims',jsonb_build_object(
    'sub',admin_id,'role','authenticated'
  )::text,true);
  probe:=public.claim_market_radar_provider_probe_v1('kalshi','candidate_feed',request_id_value);
  if not coalesce((probe->>'allowed')::boolean,false) then
    raise exception 'TEST_RADAR_RESUME_PROBE_NOT_ALLOWED: %',probe;
  end if;
  started:=public.begin_market_radar_refresh_v2(
    request_id_value,'kalshi','candidate_feed',repeat('a',64),cache_key_value,
    'atinara-radar-v2','atinara-prediction-policy-v5',lease_owner_value
  );
  if not coalesce((started->>'started')::boolean,false) then
    raise exception 'TEST_RADAR_RESUME_NOT_STARTED: %',started;
  end if;
  lease_token_value:=(started->>'lease_token')::uuid;
  active_refresh:=public.get_active_market_radar_refresh_v1(repeat('a',64),cache_key_value);
  if active_refresh ->> 'active'<>'true'
     or active_refresh ->> 'request_id' is distinct from request_id_value::text
     or jsonb_array_length(active_refresh -> 'providers')<>1 then
    raise exception 'TEST_RADAR_RESUME_RELOAD_DISCOVERY_INVALID:%',active_refresh;
  end if;
  perform set_config('request.jwt.claims',jsonb_build_object(
    'sub',second_admin_id,'role','authenticated'
  )::text,true);
  active_refresh:=public.get_active_market_radar_refresh_v1(repeat('a',64),cache_key_value);
  if active_refresh ->> 'active'<>'false' then
    raise exception 'TEST_RADAR_RESUME_ACTIVE_INTENT_LEAKED:%',active_refresh;
  end if;
  perform set_config('request.jwt.claims',jsonb_build_object(
    'sub',admin_id,'role','authenticated'
  )::text,true);

  evidence:=jsonb_build_array(jsonb_build_object(
    'url','https://store.steampowered.com/app/123456/radar-resume-v1/',
    'title','Radar resumability transaction fixture','supports','Official future fixture.',
    'source_type','official','retrieved_at',checked_at_value,
    'retrieval_status','verified_content','evidence_basis','retrieved_content',
    'parser_version','atinara-official-content-v1','content_sha256',repeat('1',64),
    'claim_status','direct','direct_claim',true,'claim_verifiable',true
  ));
  candidate_a:=jsonb_build_object(
    'provider','kalshi','external_id','RESUME-A-'||suffix,
    'external_event_id','RESUME-'||suffix,'external_market_id','RESUME-A-'||suffix,
    'external_url','https://kalshi.com/markets/resume/'||suffix,
    'external_event_url','https://kalshi.com/markets/resume/'||suffix,
    'external_market_url','https://kalshi.com/markets/resume/'||suffix,
    'event_group_key','kalshi:RESUME-'||suffix,
    'fingerprint',encode(extensions.digest(convert_to('RESUME-A-'||suffix,'UTF8'),'sha256'),'hex'),
    'cache_key',cache_key_value,'normalizer_version','atinara-radar-v2',
    'eligibility_policy_version','atinara-prediction-policy-v5','eligibility_status','eligible',
    'eligibility_reason','Contrato futuro y verificable.','eligibility_checked_at',checked_at_value,
    'eligibility_expires_at',checked_at_value+interval '6 hours','eligibility_evidence',evidence,
    'source_status','active','source_title','Radar resumability fixture',
    'source_question','Will the Radar resumability fixture happen?',
    'source_close_at',checked_at_value+interval '30 days',
    'source_resolution_rules','Resolves from the official product source.',
    'source_resolution_url','https://store.steampowered.com/app/123456/radar-resume-v1/',
    'atinara_question','¿Ocurrirá el fixture de reanudación del Radar?',
    'atinara_category','Lanzamientos',
    'atinara_resolution_criteria','Sí si la fuente oficial confirma el acontecimiento.',
    'atinara_resolution_source_url','https://store.steampowered.com/app/123456/radar-resume-v1/',
    'resolution_source_evidence',evidence,'warnings','[]'::jsonb,'duplicate_matches','[]'::jsonb,
    'verification_status','verified_open','verification_reason','Elegibilidad determinista vigente.',
    'verified_at',checked_at_value,'verification_expires_at',checked_at_value+interval '6 hours',
    'verification_evidence',evidence,'verification_confidence',100,
    'quality_status','fit','quality_score',90,'score_breakdown','{}'::jsonb,
    'state','available','fetched_at',checked_at_value,
    'cache_expires_at',checked_at_value+interval '20 minutes'
  );
  check_a:=jsonb_build_object(
    'provider','kalshi','external_id',candidate_a->>'external_id',
    'event_group_key',candidate_a->>'event_group_key','policy_version','atinara-prediction-policy-v5',
    'status','eligible','reason_code',null,'reason','Contrato futuro y verificable.',
    'evidence',evidence,'checked_at',checked_at_value,'expires_at',checked_at_value+interval '6 hours',
    'decision_hash',repeat('a',64)
  );
  candidate_b:=candidate_a||jsonb_build_object(
    'external_id','RESUME-B-'||suffix,'external_market_id','RESUME-B-'||suffix,
    'fingerprint',encode(extensions.digest(convert_to('RESUME-B-'||suffix,'UTF8'),'sha256'),'hex'),
    'temporal_contract',jsonb_build_object('version','invalid-temporal-contract')
  );
  check_b:=check_a||jsonb_build_object('external_id',candidate_b->>'external_id','decision_hash',repeat('b',64));
  candidate_c:=candidate_a||jsonb_build_object(
    'external_id','RESUME-C-'||suffix,'external_market_id','RESUME-C-'||suffix,
    'fingerprint',encode(extensions.digest(convert_to('RESUME-C-'||suffix,'UTF8'),'sha256'),'hex')
  );
  check_c:=check_a||jsonb_build_object('external_id',candidate_c->>'external_id','decision_hash',repeat('c',64));
  candidate_d:=candidate_a||jsonb_build_object(
    'external_id','RESUME-D-'||suffix,'external_market_id','RESUME-D-'||suffix,
    'fingerprint',encode(extensions.digest(convert_to('RESUME-D-'||suffix,'UTF8'),'sha256'),'hex'),
    'workflow_issues',jsonb_build_array(jsonb_build_object('issue_code','INVALID_FIXTURE'))
  );
  check_d:=check_a||jsonb_build_object('external_id',candidate_d->>'external_id','decision_hash',repeat('d',64));
  items:=jsonb_build_array(
    jsonb_build_object('candidate',candidate_a,'eligibility_check',check_a),
    jsonb_build_object('candidate',candidate_b,'eligibility_check',check_b),
    jsonb_build_object('candidate',candidate_c,'eligibility_check',check_c),
    jsonb_build_object('candidate',candidate_d,'eligibility_check',check_d)
  );

  perform set_config('request.jwt.claims','{"role":"service_role"}',true);
  perform public.declare_market_radar_refresh_manifest_v1(
    request_id_value,'kalshi','candidate_feed',lease_token_value,4
  );
  stage:=public.stage_market_radar_refresh_batch_v1(
    request_id_value,'kalshi','candidate_feed',lease_token_value,0,items
  );
  replay:=public.stage_market_radar_refresh_batch_v1(
    request_id_value,'kalshi','candidate_feed',lease_token_value,0,items
  );
  batch_id_value:=(stage->>'batch_id')::uuid;
  if coalesce((stage->>'replayed')::boolean,true)
     or not coalesce((replay->>'replayed')::boolean,false)
     or replay->>'batch_id' is distinct from stage->>'batch_id' then
    raise exception 'TEST_RADAR_RESUME_STAGE_REPLAY_INVALID: % %',stage,replay;
  end if;
  begin
    perform public.stage_market_radar_refresh_batch_v1(
      request_id_value,'kalshi','candidate_feed',lease_token_value,0,
      items||jsonb_build_array(jsonb_build_object('candidate',candidate_a,'eligibility_check',check_a))
    );
    raise exception 'TEST_RADAR_RESUME_STAGE_CONFLICT_ACCEPTED';
  exception when sqlstate '40001' then
    if sqlerrm<>'RADAR_REFRESH_BATCH_IDEMPOTENCY_CONFLICT' then raise; end if;
  end;

  sealed:=public.seal_market_radar_refresh_v1(
    request_id_value,'kalshi','candidate_feed',lease_token_value,4
  );
  replay:=public.seal_market_radar_refresh_v1(
    request_id_value,'kalshi','candidate_feed',lease_token_value,4
  );
  if coalesce((sealed->>'replayed')::boolean,true)
     or not coalesce((replay->>'replayed')::boolean,false) then
    raise exception 'TEST_RADAR_RESUME_SEAL_REPLAY_INVALID: % %',sealed,replay;
  end if;

  -- Un timeout durable se divide por el batch exacto. El replay del mismo
  -- parent es idempotente y los dos hijos conservan las cuatro entradas.
  update private.market_radar_refresh_batches_v1 set
    status='technical_failed',attempt_count=1,failed_count=4,
    error_code='RADAR_PERSISTENCE_TIMEOUT',updated_at=clock_timestamp()
  where id=batch_id_value;
  split_result:=public.split_market_radar_refresh_batch_v1(
    request_id_value,'kalshi','candidate_feed',lease_token_value,batch_id_value
  );
  replay:=public.split_market_radar_refresh_batch_v1(
    request_id_value,'kalshi','candidate_feed',lease_token_value,batch_id_value
  );
  if not coalesce((split_result->>'ok')::boolean,false)
     or coalesce((split_result->>'replayed')::boolean,true)
     or (split_result->>'left_count')::integer<>2
     or (split_result->>'right_count')::integer<>2
     or not coalesce((replay->>'replayed')::boolean,false)
     or replay->>'parent_batch_id' is distinct from batch_id_value::text then
    raise exception 'TEST_RADAR_RESUME_SPLIT_REPLAY_INVALID: % %',split_result,replay;
  end if;
  if (select count(*) from private.market_radar_refresh_batches_v1 batch_alias
      where batch_alias.parent_batch_id=batch_id_value)<>2
     or (select count(*) from private.market_radar_refresh_batches_v1 batch_alias
      where batch_alias.id=batch_id_value and batch_alias.status='superseded')<>1 then
    raise exception 'TEST_RADAR_RESUME_SPLIT_LEDGER_INVALID';
  end if;

  first_processed:=public.process_market_radar_refresh_batch_v4(
    request_id_value,'kalshi','candidate_feed',lease_token_value
  );
  if not coalesce((first_processed->>'ok')::boolean,false)
     or (first_processed->>'accepted_count')::integer<>1
     or (first_processed->>'quarantined_count')::integer<>1
     or (first_processed->>'remaining_batches')::integer<>1
     or first_processed->>'batch_timeout_isolation_version'
       is distinct from 'atinara-radar-batch-timeout-isolation-v1' then
    raise exception 'TEST_RADAR_RESUME_FIRST_SPLIT_PROCESS_INVALID: %',first_processed;
  end if;
  processed:=public.process_market_radar_refresh_batch_v4(
    request_id_value,'kalshi','candidate_feed',lease_token_value
  );
  if not coalesce((processed->>'ok')::boolean,false)
     or (processed->>'accepted_count')::integer<>1
     or (processed->>'quarantined_count')::integer<>1
     or (processed->>'remaining_batches')::integer<>0 then
    raise exception 'TEST_RADAR_RESUME_PROCESS_INVALID: %',processed;
  end if;
  if not exists (
    select 1 from private.market_radar_refresh_intents_v1 intent_alias
    where intent_alias.request_id=request_id_value
      and intent_alias.accepted_count=2
      and intent_alias.quarantined_count=2
      and intent_alias.processed_count=4
      and intent_alias.phase='finalizing'
  ) then raise exception 'TEST_RADAR_RESUME_SPLIT_TOTALS_INVALID'; end if;
  select count(*) into count_value from private.external_market_candidates
  where provider='kalshi' and external_id in (
    candidate_a->>'external_id',candidate_b->>'external_id',candidate_c->>'external_id'
    ,candidate_d->>'external_id'
  );
  if count_value<>2 then raise exception 'TEST_RADAR_RESUME_HEALTHY_ROWS_LOST: %',count_value; end if;
  select count(*) into count_value from private.market_radar_candidate_quarantines
  where refresh_request_id=request_id_value;
  if count_value<>2 or not exists (
    select 1 from private.market_radar_candidate_quarantines
    where refresh_request_id=request_id_value
      and error_code='TEMPORAL_CONTRACT_INVALID'
  ) or not exists (
    select 1 from private.market_radar_candidate_quarantines
    where refresh_request_id=request_id_value
      and error_code='MARKET_WORKFLOW_ISSUE_INVALID'
  ) then raise exception 'TEST_RADAR_RESUME_QUARANTINE_COUNT_INVALID: %',count_value; end if;
  update private.external_market_candidates set
    normalized_payload=normalized_payload||jsonb_build_object(
      'eligibility_status','terminal','eligibility_reason_code','EVENT_ALREADY_RESOLVED',
      'eligibility_reason','El resultado oficial ya es conocido.',
      'eligibility_evidence',coalesce(eligibility_evidence,'[]'::jsonb),
      'eligibility_policy_version','atinara-prediction-policy-v5',
      'eligibility_checked_at',clock_timestamp(),
      'eligibility_expires_at',clock_timestamp()+interval '100 years'
    ),
    eligibility_status='terminal',eligibility_reason_code='EVENT_ALREADY_RESOLVED',
    eligibility_reason='El resultado oficial ya es conocido.',
    verification_status='rejected_resolved',
    verification_reason_code='EVENT_ALREADY_RESOLVED',
    verification_reason='El resultado oficial ya es conocido.',
    quality_status='rejected',state='rejected',quality_score=0
  where provider='kalshi' and external_id=candidate_a ->> 'external_id';
  perform private.persist_market_radar_refresh_item_v1(
    'kalshi',jsonb_build_object('candidate',candidate_a,'eligibility_check',check_a),
    gen_random_uuid()
  );
  if not exists (
    select 1 from private.external_market_candidates candidate
    where candidate.provider='kalshi' and candidate.external_id=candidate_a ->> 'external_id'
      and candidate.eligibility_status='terminal'
      and candidate.eligibility_reason_code='EVENT_ALREADY_RESOLVED'
      and candidate.verification_status='rejected_resolved'
      and candidate.verification_reason_code='EVENT_ALREADY_RESOLVED'
      and candidate.quality_status='rejected' and candidate.state='rejected'
  ) then raise exception 'TEST_RADAR_RESUME_TERMINAL_CANDIDATE_REVIVED:%',(
    select to_jsonb(candidate) from private.external_market_candidates candidate
    where candidate.provider='kalshi' and candidate.external_id=candidate_a ->> 'external_id'
  ); end if;

  finalized:=public.finalize_market_radar_refresh_v3(
    request_id_value,'kalshi','candidate_feed',lease_token_value,'available',null,null,null
  );
  history_id_value:=(finalized->>'history_id')::bigint;
  replay:=public.finalize_market_radar_refresh_v3(
    request_id_value,'kalshi','candidate_feed',lease_token_value,'available',null,null,null
  );
  if finalized->>'outcome'<>'completed' or not coalesce((replay->>'replayed')::boolean,false) then
    raise exception 'TEST_RADAR_RESUME_FINALIZE_REPLAY_INVALID: % %',finalized,replay;
  end if;
  if (finalized ->> 'accepted_count')::integer<>2
     or (finalized ->> 'last_success_count')::integer<>2
     or not exists (
       select 1 from private.market_radar_provider_runs run
       where run.provider='kalshi' and run.cache_key=cache_key_value
         and run.result_count=2 and run.last_success_count=2
         and run.quarantined_count=2
     ) then raise exception 'TEST_RADAR_RESUME_SUCCESS_COUNT_INCLUDES_QUARANTINE:%',finalized; end if;
  select count(*) into count_value from private.market_radar_provider_run_history
  where refresh_request_id=request_id_value and provider='kalshi' and capability='candidate_feed';
  if count_value<>1 then raise exception 'TEST_RADAR_RESUME_FINALIZED_MORE_THAN_ONCE: %',count_value; end if;

  perform set_config('request.jwt.claims',jsonb_build_object(
    'sub',admin_id,'role','authenticated'
  )::text,true);
  replay:=public.begin_market_radar_refresh_v2(
    request_id_value,'kalshi','candidate_feed',repeat('a',64),cache_key_value,
    'atinara-radar-v2','atinara-prediction-policy-v5',gen_random_uuid()
  );
  if not coalesce((replay->>'replayed')::boolean,false) or replay->>'status'<>'completed' then
    raise exception 'TEST_RADAR_RESUME_BEGIN_TERMINAL_REPLAY_INVALID: %',replay;
  end if;
  perform set_config('request.jwt.claims',jsonb_build_object(
    'sub',second_admin_id,'role','authenticated'
  )::text,true);
  begin
    perform public.begin_market_radar_refresh_v2(
      request_id_value,'kalshi','candidate_feed',repeat('a',64),cache_key_value,
      'atinara-radar-v2','atinara-prediction-policy-v5',gen_random_uuid()
    );
    raise exception 'TEST_RADAR_RESUME_OTHER_ACTOR_ACCEPTED';
  exception when sqlstate '40001' then
    if sqlerrm<>'RADAR_REFRESH_IDEMPOTENCY_CONFLICT' then raise; end if;
  end;
  perform set_config('request.jwt.claims',jsonb_build_object(
    'sub',normal_user_id,'role','authenticated'
  )::text,true);
  expected_failure:=false;
  begin
    perform public.get_active_market_radar_refresh_v1(repeat('a',64),cache_key_value);
  exception when sqlstate '42501' then
    if sqlerrm<>'ADMIN_REQUIRED' then raise; end if;
    expected_failure:=true;
  end;
  if not expected_failure then raise exception 'TEST_RADAR_RESUME_ACTIVE_NON_ADMIN_ACCEPTED'; end if;
  begin
    perform public.begin_market_radar_refresh_v2(
      gen_random_uuid(),'polymarket','candidate_feed',repeat('d',64),'normal-user-test',
      'atinara-radar-v2','atinara-prediction-policy-v5',gen_random_uuid()
    );
    raise exception 'TEST_RADAR_RESUME_NON_ADMIN_ACCEPTED';
  exception when sqlstate '42501' then
    if sqlerrm<>'ADMIN_REQUIRED' then raise; end if;
  end;

  begin
    update private.market_radar_refresh_events_v1 set event_code='MUTATED'
    where request_id=request_id_value;
    raise exception 'TEST_RADAR_RESUME_EVENT_MUTATION_ALLOWED';
  exception when sqlstate '55000' then
    if sqlerrm<>'RADAR_REFRESH_EVENT_APPEND_ONLY' then raise; end if;
  end;

  -- A retryable provider failure opens only its candidate-feed circuit. After
  -- next_probe_at a single request owns half_open and success closes it.
  perform set_config('request.jwt.claims',jsonb_build_object(
    'sub',admin_id,'role','authenticated'
  )::text,true);
  probe:=public.claim_market_radar_provider_probe_v1('polymarket','candidate_feed',failure_request_id);
  started:=public.begin_market_radar_refresh_v2(
    failure_request_id,'polymarket','candidate_feed',repeat('d',64),cache_key_value||':poly',
    'atinara-radar-v2','atinara-prediction-policy-v5',gen_random_uuid()
  );
  lease_token_value:=(started->>'lease_token')::uuid;
  perform set_config('request.jwt.claims','{"role":"service_role"}',true);
  finalized:=public.finalize_market_radar_refresh_v3(
    failure_request_id,'polymarket','candidate_feed',lease_token_value,
    'unavailable','PROVIDER_UNAVAILABLE','fetch',0
  );
  select state into circuit_state_value from private.market_radar_provider_circuits_v1
  where provider='polymarket' and capability='candidate_feed';
  if circuit_state_value<>'open' or finalized->>'circuit_state'<>'open' then
    raise exception 'TEST_RADAR_RESUME_CIRCUIT_DID_NOT_OPEN: % %',circuit_state_value,finalized;
  end if;
  if not exists (
    select 1 from private.market_workflow_issue_subject_links_v1 link
    where link.subject_type='provider_refresh'
      and link.subject_key=failure_request_id::text
      and link.subject_version='polymarket:candidate_feed'
  ) then raise exception 'TEST_RADAR_RESUME_PROVIDER_ISSUE_NOT_LINKED'; end if;

  perform set_config('request.jwt.claims',jsonb_build_object(
    'sub',admin_id,'role','authenticated'
  )::text,true);
  probe:=public.claim_market_radar_provider_probe_v1('polymarket','candidate_feed',probe_request_id);
  if not coalesce((probe->>'allowed')::boolean,false) or probe->>'state'<>'half_open' then
    raise exception 'TEST_RADAR_RESUME_HALF_OPEN_NOT_CLAIMED: %',probe;
  end if;
  replay:=public.claim_market_radar_provider_probe_v1(
    'polymarket','candidate_feed',gen_random_uuid()
  );
  if replay ->> 'allowed'<>'false' or replay ->> 'state'<>'half_open' then
    raise exception 'TEST_RADAR_RESUME_SECOND_HALF_OPEN_PROBE_ACCEPTED:%',replay;
  end if;
  expected_failure:=false;
  begin
    perform public.begin_market_radar_refresh_v2(
      probe_request_id,'polymarket','candidate_feed',repeat('e',64),cache_key_value||':poly-probe',
      'atinara-radar-v2','atinara-prediction-policy-v5',gen_random_uuid(),gen_random_uuid()
    );
  exception when sqlstate '40001' then
    if sqlerrm<>'RADAR_PROVIDER_PROBE_LEASE_INVALID' then raise; end if;
    expected_failure:=true;
  end;
  if not expected_failure then raise exception 'TEST_RADAR_RESUME_WRONG_PROBE_TOKEN_ACCEPTED'; end if;
  started:=public.begin_market_radar_refresh_v2(
    probe_request_id,'polymarket','candidate_feed',repeat('e',64),cache_key_value||':poly-probe',
    'atinara-radar-v2','atinara-prediction-policy-v5',gen_random_uuid(),
    (probe->>'probe_lease_token')::uuid
  );
  lease_token_value:=(started->>'lease_token')::uuid;
  perform set_config('request.jwt.claims','{"role":"service_role"}',true);
  perform public.declare_market_radar_refresh_manifest_v1(
    probe_request_id,'polymarket','candidate_feed',lease_token_value,0
  );
  perform public.seal_market_radar_refresh_v1(
    probe_request_id,'polymarket','candidate_feed',lease_token_value,0
  );
  perform public.finalize_market_radar_refresh_v3(
    probe_request_id,'polymarket','candidate_feed',lease_token_value,'available',null,null,null
  );
  select state into circuit_state_value from private.market_radar_provider_circuits_v1
  where provider='polymarket' and capability='candidate_feed';
  if circuit_state_value<>'closed' then
    raise exception 'TEST_RADAR_RESUME_CIRCUIT_DID_NOT_CLOSE: %',circuit_state_value;
  end if;

  -- Tavily is a separate enrichment capability and never changes candidate
  -- feed circuits.
  perform set_config('request.jwt.claims',jsonb_build_object(
    'sub',admin_id,'role','authenticated'
  )::text,true);
  probe:=public.claim_market_radar_provider_probe_v1('tavily','source_enrichment',tavily_request_id);
  started:=public.begin_market_radar_refresh_v2(
    tavily_request_id,'tavily','source_enrichment',repeat('f',64),cache_key_value||':tavily',
    'atinara-radar-v2','atinara-prediction-policy-v5',gen_random_uuid()
  );
  lease_token_value:=(started->>'lease_token')::uuid;
  perform set_config('request.jwt.claims','{"role":"service_role"}',true);
  perform public.finalize_market_radar_refresh_v3(
    tavily_request_id,'tavily','source_enrichment',lease_token_value,
    'unavailable','PROVIDER_UNAVAILABLE','enrichment',60
  );
  if exists(
    select 1 from private.market_radar_provider_circuits_v1
    where capability='candidate_feed' and state<>'closed'
  ) then
    raise exception 'TEST_RADAR_RESUME_TAVILY_DEGRADED_CANDIDATE_FEED';
  end if;

  select jsonb_build_object(
    'markets',(select coalesce(md5(string_agg(md5(to_jsonb(t)::text),'' order by to_jsonb(t)::text)),md5('')) from public.markets t),
    'predictions',(select coalesce(md5(string_agg(md5(to_jsonb(t)::text),'' order by to_jsonb(t)::text)),md5('')) from public.predictions t),
    'profiles',(select coalesce(md5(string_agg(md5(to_jsonb(t)::text),'' order by to_jsonb(t)::text)),md5('')) from public.profiles t
      where id not in (second_admin_id,normal_user_id)),
    'maker',(select coalesce(md5(string_agg(md5(to_jsonb(t)::text),'' order by to_jsonb(t)::text)),md5('')) from public.market_maker_state t),
    'prices',(select coalesce(md5(string_agg(md5(to_jsonb(t)::text),'' order by to_jsonb(t)::text)),md5('')) from public.market_price_history t)
  ) into after_economic;
  if before_economic is distinct from after_economic then
    raise exception 'TEST_RADAR_RESUME_ECONOMIC_MUTATION: % %',before_economic,after_economic;
  end if;
end;
$test$;

rollback;
