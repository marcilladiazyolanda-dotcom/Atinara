-- Carga local de 240 candidatas en 10 lotes. Nunca ejecutar contra producción.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '90s';

do $load_test$
declare
  admin_id uuid := '11111111-1111-4111-8111-111111111111'::uuid;
  request_id_value uuid := gen_random_uuid();
  owner_value uuid := gen_random_uuid();
  lease_token_value uuid;
  cache_key_value text := 'radar-load-v1:'||replace(gen_random_uuid()::text,'-','');
  checked_at_value timestamptz := date_trunc('second',clock_timestamp());
  evidence jsonb;
  base_candidate jsonb;
  base_check jsonb;
  items jsonb;
  started jsonb;
  result jsonb;
  batch_index integer;
  process_index integer;
  started_at timestamptz;
  total_started_at timestamptz;
  elapsed_ms numeric;
  max_batch_ms numeric:=0;
  total_ms numeric;
begin
  evidence:=jsonb_build_array(jsonb_build_object(
    'url','https://store.steampowered.com/app/123456/radar-load-v1/',
    'title','Radar load transaction fixture','supports','Official future fixture.',
    'source_type','official','retrieved_at',checked_at_value,
    'retrieval_status','verified_content','evidence_basis','retrieved_content',
    'parser_version','atinara-official-content-v1','content_sha256',repeat('2',64),
    'claim_status','direct','direct_claim',true,'claim_verifiable',true
  ));
  base_candidate:=jsonb_build_object(
    'provider','kalshi','external_event_id','RADAR-LOAD-V1',
    'external_url','https://kalshi.com/markets/radar-load-v1',
    'external_event_url','https://kalshi.com/markets/radar-load-v1',
    'external_market_url','https://kalshi.com/markets/radar-load-v1',
    'event_group_key','kalshi:RADAR-LOAD-V1','cache_key',cache_key_value,
    'normalizer_version','atinara-radar-v2','eligibility_policy_version','atinara-prediction-policy-v5',
    'eligibility_status','eligible','eligibility_reason','Contrato futuro y verificable.',
    'eligibility_checked_at',checked_at_value,'eligibility_expires_at',checked_at_value+interval '6 hours',
    'eligibility_evidence',evidence,'source_status','active','source_title','Radar load fixture',
    'source_question','Will the Radar load fixture happen?',
    'source_close_at',checked_at_value+interval '30 days',
    'source_resolution_rules','Resolves from the official product source.',
    'source_resolution_url','https://store.steampowered.com/app/123456/radar-load-v1/',
    'atinara_question','¿Ocurrirá el fixture de carga del Radar?',
    'atinara_category','Lanzamientos',
    'atinara_resolution_criteria','Sí si la fuente oficial confirma el acontecimiento.',
    'atinara_resolution_source_url','https://store.steampowered.com/app/123456/radar-load-v1/',
    'resolution_source_evidence',evidence,'warnings','[]'::jsonb,'duplicate_matches','[]'::jsonb,
    'verification_status','verified_open','verification_reason','Elegibilidad determinista vigente.',
    'verified_at',checked_at_value,'verification_expires_at',checked_at_value+interval '6 hours',
    'verification_evidence',evidence,'verification_confidence',100,'quality_status','fit',
    'quality_score',90,'score_breakdown','{}'::jsonb,'state','available',
    'fetched_at',checked_at_value,'cache_expires_at',checked_at_value+interval '20 minutes'
  );
  base_check:=jsonb_build_object(
    'provider','kalshi','event_group_key','kalshi:RADAR-LOAD-V1',
    'policy_version','atinara-prediction-policy-v5','status','eligible',
    'reason_code',null,'reason','Contrato futuro y verificable.','evidence',evidence,
    'checked_at',checked_at_value,'expires_at',checked_at_value+interval '6 hours'
  );

  perform set_config('request.jwt.claims',jsonb_build_object('sub',admin_id,'role','authenticated')::text,true);
  perform public.claim_market_radar_provider_probe_v1('kalshi','candidate_feed',request_id_value);
  started:=public.begin_market_radar_refresh_v2(
    request_id_value,'kalshi','candidate_feed',repeat('9',64),cache_key_value,
    'atinara-radar-v2','atinara-prediction-policy-v5',owner_value
  );
  lease_token_value:=(started->>'lease_token')::uuid;
  perform set_config('request.jwt.claims','{"role":"service_role"}',true);
  perform public.declare_market_radar_refresh_manifest_v1(
    request_id_value,'kalshi','candidate_feed',lease_token_value,240
  );

  for batch_index in 0..9 loop
    select jsonb_agg(jsonb_build_object(
      'candidate',base_candidate||jsonb_build_object(
        'external_id','RADAR-LOAD-'||item_index,
        'external_market_id','RADAR-LOAD-'||item_index,
        'external_market_url','https://kalshi.com/markets/radar-load-v1/'||item_index,
        'fingerprint',encode(extensions.digest(convert_to('RADAR-LOAD-'||item_index,'UTF8'),'sha256'),'hex')
      ),
      'eligibility_check',base_check||jsonb_build_object(
        'external_id','RADAR-LOAD-'||item_index,
        'decision_hash',encode(extensions.digest(convert_to('RADAR-LOAD-CHECK-'||item_index,'UTF8'),'sha256'),'hex')
      )
    ) order by item_index)
    into items
    from generate_series(batch_index*24+1,batch_index*24+24) item_index;
    perform public.stage_market_radar_refresh_batch_v1(
      request_id_value,'kalshi','candidate_feed',lease_token_value,batch_index,items
    );
  end loop;
  perform public.seal_market_radar_refresh_v1(
    request_id_value,'kalshi','candidate_feed',lease_token_value,240
  );
  total_started_at:=clock_timestamp();
  for process_index in 1..10 loop
    started_at:=clock_timestamp();
    result:=public.process_market_radar_refresh_batch_v1(
      request_id_value,'kalshi','candidate_feed',lease_token_value
    );
    elapsed_ms:=extract(epoch from (clock_timestamp()-started_at))*1000;
    max_batch_ms:=greatest(max_batch_ms,elapsed_ms);
    if result->>'ok'<>'true' then
      raise exception 'TEST_RADAR_LOAD_BATCH_FAILED: %',result;
    end if;
  end loop;
  total_ms:=extract(epoch from (clock_timestamp()-total_started_at))*1000;
  if max_batch_ms>=8000 or total_ms>=60000 then
    raise exception 'TEST_RADAR_LOAD_BUDGET_EXCEEDED max=% total=%',max_batch_ms,total_ms;
  end if;
  result:=public.finalize_market_radar_refresh_v3(
    request_id_value,'kalshi','candidate_feed',lease_token_value,'available',null,null,null
  );
  if (result->>'accepted_count')::integer<>240
     or (result->>'quarantined_count')::integer<>0
     or result->>'status'<>'available' then
    raise exception 'TEST_RADAR_LOAD_FINAL_INVALID: %',result;
  end if;
  raise notice 'RADAR_LOAD_V1_OK max_batch_ms=% total_ms=%',round(max_batch_ms,2),round(total_ms,2);
end;
$load_test$;

rollback;
