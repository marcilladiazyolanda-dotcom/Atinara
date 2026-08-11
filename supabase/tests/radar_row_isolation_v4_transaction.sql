begin;

do $test$
declare
  suffix text := replace(gen_random_uuid()::text, '-', '');
  cache_key_value text;
  valid_external_id text;
  poison_external_id text;
  context_snapshot_value jsonb;
  source_snapshot_value jsonb;
  valid_candidate jsonb;
  poison_candidate jsonb;
  valid_fact_check jsonb;
  poison_fact_check jsonb;
  upsert_result jsonb;
  quarantine_list jsonb;
  admin_id_value uuid;
begin
  if has_function_privilege(
       'anon',
       'public.upsert_market_radar_batch_with_fact_checks_v2(text,text,text,jsonb,jsonb,text,jsonb)',
       'execute'
     )
     or has_function_privilege(
       'authenticated',
       'public.upsert_market_radar_batch_with_fact_checks_v2(text,text,text,jsonb,jsonb,text,jsonb)',
       'execute'
     )
     or not has_function_privilege(
       'service_role',
       'public.upsert_market_radar_batch_with_fact_checks_v2(text,text,text,jsonb,jsonb,text,jsonb)',
       'execute'
     ) then
    raise exception 'RADAR_ROW_ISOLATION_V4_PRIVILEGES_INVALID';
  end if;
  if has_function_privilege(
       'anon',
       'public.list_market_radar_candidate_quarantines_v1(text,text,integer)',
       'execute'
     )
     or not has_function_privilege(
       'authenticated',
       'public.list_market_radar_candidate_quarantines_v1(text,text,integer)',
       'execute'
     ) then
    raise exception 'RADAR_QUARANTINE_AUDIT_PRIVILEGES_INVALID';
  end if;

  cache_key_value := 'radar-row-isolation-v4:' || suffix;
  valid_external_id := 'kalshi:ROW-ISOLATION-VALID-' || suffix;
  poison_external_id := 'kalshi:ROW-ISOLATION-POISON-' || suffix;
  context_snapshot_value := jsonb_build_object(
    'fact_context_schema_version', 'atinara-radar-fact-context-v2',
    'provider', 'kalshi',
    'external_id', valid_external_id,
    'external_event_id', 'ROW-ISOLATION-' || suffix,
    'external_market_id', 'ROW-ISOLATION-' || suffix || '-YES',
    'event_group_key', 'kalshi:ROW-ISOLATION-' || suffix,
    'source_status', 'active',
    'source_result', null,
    'source_settled_at', null,
    'canonical_event_children', jsonb_build_array(jsonb_build_object(
      'market_id', 'ROW-ISOLATION-' || suffix || '-YES',
      'question', 'Will the row-isolation fixture happen?',
      'status', 'active',
      'result', null
    )),
    'canonical_event_children_total', 1,
    'canonical_event_children_complete', true
  );
  source_snapshot_value := jsonb_build_array(jsonb_build_object(
    'title', 'Official row-isolation fixture',
    'url', 'https://www.playstation.com/en-us/',
    'source_type', 'official',
    'supports', 'The row-isolation fixture remains scheduled for a future date.',
    'retrieved_at', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'retrieval_status', 'verified_content',
    'evidence_basis', 'retrieved_content',
    'parser_version', 'atinara-official-content-v1',
    'content_sha256', repeat('a', 64),
    'content_type', 'text/html',
    'claim_status', 'direct',
    'direct_claim', true,
    'claim_verifiable', true,
    'relevance_score', 100,
    'supported_reason_codes', '[]'::jsonb,
    'supported_fact_statuses', jsonb_build_array('unresolved'),
    'supported_contract_kinds', jsonb_build_array('announcement'),
    'unresolved_proof', true,
    'unresolved_proof_basis', 'official_future_date_v1',
    'unresolved_until', to_char((now() + interval '20 days') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'unresolved_proof_excerpt', 'The row-isolation fixture remains scheduled for a future date.',
    'unresolved_proof_excerpt_sha256', encode(extensions.digest(
      convert_to('The row-isolation fixture remains scheduled for a future date.', 'UTF8'),
      'sha256'
    ), 'hex')
  ));
  valid_candidate := jsonb_build_object(
    'provider', 'kalshi',
    'external_id', valid_external_id,
    'external_event_id', 'ROW-ISOLATION-' || suffix,
    'external_market_id', 'ROW-ISOLATION-' || suffix || '-YES',
    'external_url', 'https://kalshi.com/markets/row-isolation/' || suffix,
    'external_event_url', 'https://kalshi.com/markets/row-isolation/' || suffix,
    'external_market_url', 'https://kalshi.com/markets/row-isolation/' || suffix,
    'event_group_key', 'kalshi:ROW-ISOLATION-' || suffix,
    'fingerprint', repeat('a', 64),
    'fact_context_fingerprint', repeat('0', 64),
    'fact_policy_version', 'atinara-terminal-fact-gate-v2',
    'normalizer_version', 'atinara-radar-v2',
    'eligibility_policy_version', 'atinara-prediction-policy-v4',
    'source_status', 'active',
    'source_title', 'Row-isolation fixture',
    'source_question', 'Will the row-isolation fixture happen?',
    'source_close_at', now() + interval '30 days',
    'source_resolution_rules', 'Resolves from the official source.',
    'source_resolution_url', 'https://www.playstation.com/en-us/',
    'atinara_question', '¿Ocurrirá el fixture de aislamiento por fila?',
    'atinara_category', 'Lanzamientos',
    'atinara_resolution_criteria', 'Sí si la fuente oficial lo confirma.',
    'atinara_resolution_source_url', 'https://www.playstation.com/en-us/',
    'hard_reject_reasons', '[]'::jsonb,
    'warnings', '[]'::jsonb,
    'duplicate_matches', '[]'::jsonb,
    'verification_status', 'verified_open',
    'verification_reason', 'Comprobación transaccional.',
    'verified_at', now(),
    'verification_expires_at', now() + interval '15 minutes',
    'verification_evidence', source_snapshot_value,
    'verification_confidence', 100,
    'quality_status', 'fit',
    'quality_score', 90,
    'score_breakdown', '{}'::jsonb,
    'state', 'available',
    'fetched_at', now(),
    'cache_expires_at', now() + interval '15 minutes'
  );
  valid_fact_check := jsonb_build_object(
    'attempt_id', gen_random_uuid(),
    'purpose', 'discovery',
    'provider', 'kalshi',
    'external_id', valid_external_id,
    'event_group_key', 'kalshi:ROW-ISOLATION-' || suffix,
    'fact_context_fingerprint', repeat('0', 64),
    'fact_policy_version', 'atinara-terminal-fact-gate-v2',
    'fact_status', 'unresolved',
    'verification_status', 'verified_open',
    'reason', 'Comprobación transaccional.',
    'confidence', 100,
    'evidence', source_snapshot_value,
    'checked_at', now(),
    'expires_at', now() + interval '15 minutes',
    'context_snapshot', context_snapshot_value,
    'context_sha256', repeat('0', 64),
    'source_snapshot', source_snapshot_value,
    'source_sha256', repeat('0', 64),
    'decision_hash', repeat('0', 64)
  );
  poison_candidate := valid_candidate || jsonb_build_object(
    'external_id', poison_external_id,
    'external_market_id', 'ROW-ISOLATION-' || suffix || '-POISON',
    'external_market_url', 'https://kalshi.com/markets/row-isolation/' || suffix || '/poison',
    'fingerprint', repeat('b', 64),
    'verification_status', 'invalid_fixture_status'
  );
  poison_fact_check := valid_fact_check || jsonb_build_object(
    'attempt_id', gen_random_uuid(),
    'external_id', poison_external_id
  );

  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  upsert_result := public.upsert_market_radar_batch_with_fact_checks_v2(
    'kalshi', cache_key_value, 'atinara-radar-v2',
    jsonb_build_array(valid_candidate, poison_candidate),
    jsonb_build_array(valid_fact_check, poison_fact_check),
    'atinara-terminal-fact-gate-v2',
    jsonb_build_object(
      'status', 'partial_error',
      'is_cached', false,
      'error_code', 'RADAR_REFRESH_IN_PROGRESS',
      'error_message', 'Actualización transaccional en curso.'
    )
  );
  if not coalesce((upsert_result ->> 'ok')::boolean, false)
     or (upsert_result ->> 'accepted_count')::integer <> 1
     or (upsert_result ->> 'quarantined_count')::integer <> 1
     or upsert_result #>> '{quarantined,0,external_id}' is distinct from poison_external_id
     or upsert_result #>> '{quarantined,0,code}' is distinct from 'INVALID_RADAR_CANDIDATE'
     or exists (
       select 1 from private.external_market_candidates
       where provider = 'kalshi' and external_id = poison_external_id
     )
     or not exists (
       select 1 from private.external_market_candidates
       where provider = 'kalshi' and external_id = valid_external_id
         and current_fact_check_id is not null
     )
     or not exists (
       select 1 from private.market_radar_candidate_quarantines
       where provider = 'kalshi' and cache_key = cache_key_value
         and external_id = poison_external_id
         and error_code = 'INVALID_RADAR_CANDIDATE'
     ) then
    raise exception 'RADAR_ROW_ISOLATION_V4_FAILED: %', upsert_result;
  end if;

  select id into admin_id_value
  from auth.users
  where coalesce((raw_app_meta_data ->> 'oraklo_admin')::boolean, false)
  order by created_at
  limit 1;
  if admin_id_value is null then raise exception 'ADMIN_FIXTURE_REQUIRED'; end if;
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('role', 'authenticated', 'sub', admin_id_value)::text,
    true
  );
  quarantine_list := public.list_market_radar_candidate_quarantines_v1(
    'kalshi', cache_key_value, 20
  );
  if jsonb_array_length(quarantine_list) <> 1
     or quarantine_list #>> '{0,external_id}' is distinct from poison_external_id
     or quarantine_list #>> '{0,error_code}' is distinct from 'INVALID_RADAR_CANDIDATE' then
    raise exception 'RADAR_QUARANTINE_AUDIT_NOT_CONSULTABLE: %', quarantine_list;
  end if;
end;
$test$;

rollback;
