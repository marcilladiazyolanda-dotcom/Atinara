-- Regresión transaccional de idempotencia para Official Opportunity V2.
-- Requiere 20260815115516 y siempre termina en ROLLBACK.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';

create temporary table official_discovery_v2_baseline on commit drop as
select
  (select count(*) from public.markets) as markets,
  (select count(*) from private.market_drafts) as drafts,
  (select count(*) from public.predictions) as predictions,
  (select count(*) from public.profiles) as profiles,
  (select count(*) from public.market_price_history) as price_history,
  (select count(*) from private.market_expert_runs) as expert_runs,
  (select count(*) from private.ai_invocation_attempts) as ai_attempts;

insert into private.market_source_registry (
  id, provider, source_name, canonical_domain, external_entity_id,
  allowed_roles, authority_tier, categories, access_method, health_status,
  retention_policy, parser_version, active
) values (
  '10000000-0000-4000-8000-00000000b001',
  'official-idempotency-test', 'Official idempotency transaction fixture',
  'official-idempotency.example', 'official-idempotency-v2',
  '["primary_resolution"]'::jsonb, 'primary', '["Eventos"]'::jsonb,
  'https', 'healthy', '{"snapshot":true}'::jsonb,
  'official-idempotency-parser-v1', true
), (
  '10000000-0000-4000-8000-00000000b002',
  'official-idempotency-test-alt', 'Official idempotency corroboration fixture',
  'official-idempotency-alt.example', 'official-idempotency-v2-alt',
  '["primary_resolution"]'::jsonb, 'primary', '["Eventos"]'::jsonb,
  'https', 'healthy', '{"snapshot":true}'::jsonb,
  'official-idempotency-parser-v1', true
);

do $privileges$
begin
  if not has_function_privilege(
       'service_role',
       'public.begin_official_opportunity_discovery_v2(uuid,text,uuid)',
       'EXECUTE'
     )
     or not has_function_privilege(
       'service_role',
       'public.finish_official_opportunity_discovery_v2(uuid,text,uuid,jsonb,jsonb)',
       'EXECUTE'
     )
     or has_function_privilege(
       'authenticated',
       'public.begin_official_opportunity_discovery_v2(uuid,text,uuid)',
       'EXECUTE'
     )
     or has_function_privilege(
       'anon',
       'public.finish_official_opportunity_discovery_v2(uuid,text,uuid,jsonb,jsonb)',
       'EXECUTE'
     )
     or has_function_privilege(
       'service_role',
       'private.assert_official_opportunity_signal_v2(jsonb)',
       'EXECUTE'
     ) then
    raise exception 'TEST_OFFICIAL_IDEMPOTENCY_RPC_PRIVILEGES_INVALID';
  end if;
end;
$privileges$;

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;

do $claims_and_first_result$
declare
  admin_id constant uuid := '10000000-0000-4000-8000-00000000a001';
  request_a constant uuid := '10000000-0000-4000-8000-000000000001';
  request_b constant uuid := '10000000-0000-4000-8000-000000000002';
  request_fingerprint constant text := repeat('c', 64);
  signal_fingerprint constant text := repeat('d', 64);
  source_url constant text := 'https://official-idempotency.example/events/future-2027';
  started jsonb;
  replay jsonb;
  finished jsonb;
  signal_value jsonb;
  contract_value jsonb;
  source_value jsonb;
  corroboration_source_value jsonb;
  expected_failure boolean := false;
begin
  started := public.begin_official_opportunity_discovery_v2(
    request_a, request_fingerprint, admin_id
  );
  replay := public.begin_official_opportunity_discovery_v2(
    request_a, request_fingerprint, admin_id
  );
  if started ->> 'state' <> 'started'
     or replay ->> 'state' <> 'in_progress'
     or started ->> 'provider_run_id' is distinct from replay ->> 'provider_run_id' then
    raise exception 'TEST_OFFICIAL_IDEMPOTENCY_SEQUENTIAL_CLAIM_FAILED:%:%', started, replay;
  end if;

  begin
    perform public.begin_official_opportunity_discovery_v2(
      request_a, repeat('e', 64), admin_id
    );
  exception when sqlstate '22023' then
    if sqlerrm <> 'OFFICIAL_DISCOVERY_REQUEST_REUSED' then raise; end if;
    expected_failure := true;
  end;
  if not expected_failure then
    raise exception 'TEST_OFFICIAL_IDEMPOTENCY_REUSED_ID_ACCEPTED';
  end if;

  expected_failure := false;
  begin
    perform public.begin_official_opportunity_discovery_v2(
      request_a, request_fingerprint, '10000000-0000-4000-8000-00000000a002'
    );
  exception when sqlstate '22023' then
    if sqlerrm <> 'OFFICIAL_DISCOVERY_REQUEST_REUSED' then raise; end if;
    expected_failure := true;
  end;
  if not expected_failure then
    raise exception 'TEST_OFFICIAL_IDEMPOTENCY_REUSED_ID_BY_OTHER_ACTOR_ACCEPTED';
  end if;

  started := public.begin_official_opportunity_discovery_v2(
    request_b, request_fingerprint, admin_id
  );
  if started ->> 'state' <> 'started'
     or started ->> 'provider_run_id' = replay ->> 'provider_run_id' then
    raise exception 'TEST_OFFICIAL_IDEMPOTENCY_DIFFERENT_ID_NOT_STARTED:%', started;
  end if;
  finished := public.finish_official_opportunity_discovery_v2(
    request_b, request_fingerprint, admin_id, '[]'::jsonb,
    jsonb_build_object(
      'outcome', 'zero_results', 'error_code', null,
      'query_fingerprint', repeat('e', 64), 'search_results', 0,
      'inspected_documents', 0, 'structured_candidates', 0,
      'rejected_candidates', 0, 'source_error_count', 0,
      'source_error_codes', '{}'::jsonb,
      'provider_rate', '{"limit":null,"remaining":null,"reset":null}'::jsonb
    )
  );
  if finished ->> 'outcome' <> 'zero_results'
     or (finished #>> '{result_summary,saved}')::integer <> 0 then
    raise exception 'TEST_OFFICIAL_IDEMPOTENCY_ZERO_RESULT_INVALID:%', finished;
  end if;

  source_value := jsonb_build_object(
    'provider', 'official-idempotency-test',
    'url', source_url,
    'role', 'PRIMARY_RESOLUTION',
    'precedence', 1,
    'required', true,
    'registry_source_id', '10000000-0000-4000-8000-00000000b001',
    'parser_version', 'official-idempotency-parser-v1'
  );
  corroboration_source_value := jsonb_build_object(
    'provider', 'official-idempotency-test-alt',
    'url', 'https://official-idempotency-alt.example/events/future-2027',
    'role', 'CORROBORATION',
    'precedence', 2,
    'required', false,
    'registry_source_id', '10000000-0000-4000-8000-00000000b002',
    'parser_version', 'official-idempotency-parser-v1'
  );
  contract_value := jsonb_build_object(
    'version', 'atinara-official-opportunity-discovery-v1',
    'contract_schema_version', 'atinara-resolution-contract-v1',
    'policy_version', 'atinara-market-constitution-v1',
    'canonical_statement', '¿Comenzará el evento oficial futuro de prueba antes del corte indicado?',
    'opportunity_type', 'official_event_deadline',
    'event_name', 'Evento oficial futuro de prueba',
    'official_event_url', source_url,
    'provider', 'official_web',
    'provider_adapter_version', 'atinara-official-opportunity-discovery-v1',
    'entity_type', 'official_event',
    'entity_id', signal_fingerprint,
    'canonical_url', source_url,
    'metric', null, 'operator', 'exact_state', 'threshold', null,
    'unit', null, 'precision', 'instant',
    'window_start', now(),
    'window_end', (now() + interval '20 days'),
    'evaluation_at', (now() + interval '20 days'),
    'resolution_deadline', (now() + interval '21 days'),
    'timezone', 'Europe/Madrid', 'finality_delay_seconds', 300,
    'capture_strategy', 'manual_official_source',
    'sampling_interval_seconds', 0, 'required_samples', 1,
    'aggregation', 'exact_state', 'maximum_monitor_duration_seconds', 0,
    'missing_data_treatment', 'manual_review_no_assumption',
    'cancellation_treatment', 'resolve_no_if_definitive_before_cutoff',
    'postponement_treatment', 'preserve_approved_period',
    'source_conflict_treatment', 'pause_and_human_review',
    'sources', jsonb_build_array(source_value, corroboration_source_value)
  );
  signal_value := jsonb_build_object(
    'provider', 'official_web', 'signal_type', 'official_future_event',
    'entity_type', 'official_event', 'entity_id', signal_fingerprint,
    'canonical_url', source_url, 'title', 'Evento oficial futuro de prueba',
    'subtitle', 'Fixture transaccional',
    'description', 'Señal privada creada exclusivamente dentro de una transacción con rollback.',
    'atinara_category', 'Eventos', 'observed_at', now(),
    'valid_until', (now() + interval '20 days'),
    'signal_origin', 'registered_official_source',
    'opportunity_type', 'official_event_deadline', 'context_type', 'official_structured_event',
    'catalyst_type', 'official_event_date',
    'factual_basis', 'La fuente oficial de prueba declara una fecha futura inequívoca.',
    'contextual_basis', 'La comprobación usa exclusivamente una autoridad registrada.',
    'inference_summary', 'La señal requiere revisión humana y no crea un borrador.',
    'market_thesis', 'La fecha futura permite formular un contrato binario objetivo.',
    'why_now', 'La fecha está publicada y aún no ha llegado.',
    'unresolved_question', '¿Comenzará el evento oficial futuro de prueba antes del corte indicado?',
    'suggested_market_type', 'binary_official_deadline',
    'time_window_start', now(),
    'time_window_end', (now() + interval '20 days'),
    'source_payload_excerpt', jsonb_build_object(
      'version', 'atinara-official-opportunity-discovery-v1',
      'registry_source_id', '10000000-0000-4000-8000-00000000b001',
      'registry_domain', 'official-idempotency.example',
      'parser_version', 'official-idempotency-parser-v1',
      'content_sha256', repeat('f', 64), 'kind', 'event',
      'raw_value', (now() + interval '20 days')::text
    ),
    'source_fingerprint', signal_fingerprint,
    'marketability_status', 'useful',
    'marketability_reason_codes', '[]'::jsonb,
    'resolution_readiness', 'manual_secondary_source',
    'suggested_question', '¿Comenzará el evento oficial futuro de prueba antes del corte indicado?',
    'suggested_yes_criteria', 'Sí, si la fuente primaria confirma que el evento comenzó antes o exactamente en el corte.',
    'suggested_no_criteria', 'No, si el evento no comenzó antes del corte o fue aplazado más allá del periodo evaluado.',
    'suggested_edge_cases', 'Una cuenta atrás o una emisión previa no cuentan hasta que comience formalmente el evento anunciado.',
    'suggested_resolution_contract', contract_value,
    'duplicate_matches', '[]'::jsonb,
    'provider_policy_flags', '["HUMAN_REVIEW_AND_SAVE_REQUIRED"]'::jsonb,
    'retention_expires_at', (now() + interval '50 days')
  );
  expected_failure := false;
  begin
    perform public.finish_official_opportunity_discovery_v2(
      request_a, request_fingerprint,
      '10000000-0000-4000-8000-00000000a002', null, null
    );
  exception when sqlstate '22023' then
    if sqlerrm <> 'OFFICIAL_DISCOVERY_REQUEST_REUSED' then raise; end if;
    expected_failure := true;
  end;
  if not expected_failure then
    raise exception 'TEST_OFFICIAL_IDEMPOTENCY_FINISH_BY_OTHER_ACTOR_ACCEPTED';
  end if;
  finished := public.finish_official_opportunity_discovery_v2(
    request_a, request_fingerprint, admin_id, jsonb_build_array(signal_value),
    jsonb_build_object(
      'outcome', 'success', 'error_code', null,
      'query_fingerprint', repeat('e', 64), 'search_results', 2,
      'inspected_documents', 2, 'structured_candidates', 2,
      'rejected_candidates', 0, 'source_error_count', 0,
      'source_error_codes', '{}'::jsonb,
      'provider_rate', '{"limit":"100","remaining":"99","reset":"60"}'::jsonb
    )
  );
  if finished ->> 'outcome' <> 'success'
     or (finished #>> '{result_summary,saved}')::integer <> 1
     or (finished #>> '{result_summary,duplicate_signals}')::integer <> 0 then
    raise exception 'TEST_OFFICIAL_IDEMPOTENCY_SUCCESS_INVALID:%', finished;
  end if;
  replay := public.finish_official_opportunity_discovery_v2(
    request_a, request_fingerprint, admin_id, jsonb_build_array(signal_value),
    jsonb_build_object(
      'outcome', 'success', 'error_code', null,
      'query_fingerprint', repeat('e', 64), 'search_results', 2,
      'inspected_documents', 2, 'structured_candidates', 2,
      'rejected_candidates', 0, 'source_error_count', 0,
      'source_error_codes', '{}'::jsonb,
      'provider_rate', '{"limit":null,"remaining":null,"reset":null}'::jsonb
    )
  );
  if coalesce((replay ->> 'replayed')::boolean, false) is not true
     or replay ->> 'provider_run_id' is distinct from finished ->> 'provider_run_id' then
    raise exception 'TEST_OFFICIAL_IDEMPOTENCY_TERMINAL_REPLAY_FAILED:%', replay;
  end if;
end;
$claims_and_first_result$;

reset role;

update private.data_observatory_signals
set updated_at = '2000-01-01T00:00:00Z'::timestamptz
where provider = 'official_web' and source_fingerprint = repeat('d', 64);

create temporary table official_discovery_v2_signal_fixture on commit drop as
select jsonb_build_object(
  'provider', signal.provider, 'signal_type', signal.signal_type,
  'entity_type', signal.entity_type, 'entity_id', signal.entity_id,
  'canonical_url', signal.canonical_url, 'title', signal.title,
  'subtitle', signal.subtitle, 'description', signal.description,
  'atinara_category', signal.atinara_category, 'observed_at', signal.observed_at,
  'valid_until', signal.valid_until, 'signal_origin', signal.signal_origin,
  'opportunity_type', signal.opportunity_type, 'context_type', signal.context_type,
  'catalyst_type', signal.catalyst_type, 'factual_basis', signal.factual_basis,
  'contextual_basis', signal.contextual_basis, 'inference_summary', signal.inference_summary,
  'market_thesis', signal.market_thesis, 'why_now', signal.why_now,
  'unresolved_question', signal.unresolved_question,
  'suggested_market_type', signal.suggested_market_type,
  'time_window_start', signal.time_window_start, 'time_window_end', signal.time_window_end,
  'source_payload_excerpt', signal.source_payload_excerpt,
  'source_fingerprint', signal.source_fingerprint,
  'marketability_status', signal.marketability_status,
  'marketability_reason_codes', signal.marketability_reason_codes,
  'resolution_readiness', signal.resolution_readiness,
  'suggested_question', signal.suggested_question,
  'suggested_yes_criteria', signal.suggested_yes_criteria,
  'suggested_no_criteria', signal.suggested_no_criteria,
  'suggested_edge_cases', signal.suggested_edge_cases,
  'suggested_resolution_contract', signal.suggested_resolution_contract,
  'duplicate_matches', signal.duplicate_matches,
  'provider_policy_flags', signal.provider_policy_flags,
  'retention_expires_at', signal.retention_expires_at
) as payload
from private.data_observatory_signals signal
where signal.provider = 'official_web' and signal.source_fingerprint = repeat('d', 64);
grant select on official_discovery_v2_signal_fixture to service_role;

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;

do $remaining_outcomes$
declare
  admin_id constant uuid := '10000000-0000-4000-8000-00000000a001';
  request_fingerprint constant text := repeat('c', 64);
  signal_value jsonb;
  result_value jsonb;
  successful_run_value jsonb;
  expected_failure boolean;
  invalid_case jsonb;
begin
  select payload into signal_value from official_discovery_v2_signal_fixture;

  successful_run_value := jsonb_build_object(
    'outcome', 'success', 'error_code', null,
    'query_fingerprint', repeat('e', 64), 'search_results', 2,
    'inspected_documents', 2, 'structured_candidates', 2,
    'rejected_candidates', 0, 'source_error_count', 0,
    'source_error_codes', '{}'::jsonb,
    'provider_rate', '{"limit":null,"remaining":null,"reset":null}'::jsonb
  );

  perform public.begin_official_opportunity_discovery_v2(
    '10000000-0000-4000-8000-000000000009', request_fingerprint, admin_id
  );

  for invalid_case in
    select value
    from jsonb_array_elements(jsonb_build_array(
      jsonb_build_object('label', 'root_array', 'payload', '[]'::jsonb),
      jsonb_build_object('label', 'unexpected_key', 'payload',
        successful_run_value || '{"unexpected":true}'::jsonb),
      jsonb_build_object('label', 'missing_provider_rate', 'payload',
        successful_run_value - 'provider_rate'),
      jsonb_build_object('label', 'string_counter', 'payload',
        jsonb_set(successful_run_value, '{search_results}', '"0"'::jsonb)),
      jsonb_build_object('label', 'fractional_counter', 'payload',
        jsonb_set(successful_run_value, '{search_results}', '0.5'::jsonb)),
      jsonb_build_object('label', 'negative_counter', 'payload',
        jsonb_set(successful_run_value, '{source_error_count}', '-1'::jsonb)),
      jsonb_build_object('label', 'invalid_error_map', 'payload',
        jsonb_set(successful_run_value, '{source_error_codes}', '[]'::jsonb))
    ))
  loop
    expected_failure := false;
    begin
      perform public.finish_official_opportunity_discovery_v2(
        '10000000-0000-4000-8000-000000000009', request_fingerprint, admin_id,
        '[]'::jsonb, invalid_case -> 'payload'
      );
    exception when sqlstate '22023' then
      if sqlerrm <> 'OFFICIAL_DISCOVERY_RESULT_INVALID' then raise; end if;
      expected_failure := true;
    end;
    if not expected_failure then
      raise exception 'TEST_OFFICIAL_IDEMPOTENCY_INVALID_RUN_INPUT_ACCEPTED:%',
        invalid_case ->> 'label';
    end if;
  end loop;

  expected_failure := false;
  begin
    perform public.finish_official_opportunity_discovery_v2(
      '10000000-0000-4000-8000-000000000009', request_fingerprint, admin_id,
      jsonb_build_array(signal_value),
      jsonb_set(successful_run_value, '{search_results}', '1'::jsonb)
    );
  exception when sqlstate '22023' then
    if sqlerrm <> 'OFFICIAL_DISCOVERY_RESULT_INCONSISTENT' then raise; end if;
    expected_failure := true;
  end;
  if not expected_failure then
    raise exception 'TEST_OFFICIAL_IDEMPOTENCY_INSPECTION_EXCEEDS_SEARCH_ACCEPTED';
  end if;

  expected_failure := false;
  begin
    perform public.finish_official_opportunity_discovery_v2(
      '10000000-0000-4000-8000-000000000009', request_fingerprint, admin_id,
      '[]'::jsonb,
      successful_run_value || jsonb_build_object(
        'outcome', 'zero_results',
        'search_results', 2,
        'inspected_documents', 1,
        'structured_candidates', 0
      )
    );
  exception when sqlstate '22023' then
    if sqlerrm <> 'OFFICIAL_DISCOVERY_RESULT_INCONSISTENT' then raise; end if;
    expected_failure := true;
  end;
  if not expected_failure then
    raise exception 'TEST_OFFICIAL_IDEMPOTENCY_UNACCOUNTED_SEARCH_RESULT_ACCEPTED';
  end if;

  expected_failure := false;
  begin
    perform public.finish_official_opportunity_discovery_v2(
      '10000000-0000-4000-8000-000000000009', request_fingerprint, admin_id,
      jsonb_build_array(signal_value),
      jsonb_set(successful_run_value, '{structured_candidates}', '1'::jsonb)
    );
  exception when sqlstate '22023' then
    if sqlerrm <> 'OFFICIAL_DISCOVERY_RESULT_INCONSISTENT' then raise; end if;
    expected_failure := true;
  end;
  if not expected_failure then
    raise exception 'TEST_OFFICIAL_IDEMPOTENCY_SOURCE_COUNT_EXCEEDS_CANDIDATES_ACCEPTED';
  end if;

  expected_failure := false;
  begin
    perform public.finish_official_opportunity_discovery_v2(
      '10000000-0000-4000-8000-000000000009', request_fingerprint, admin_id,
      jsonb_build_array(signal_value, signal_value),
      jsonb_set(successful_run_value, '{structured_candidates}', '1'::jsonb)
    );
  exception when sqlstate '22023' then
    if sqlerrm <> 'OFFICIAL_DISCOVERY_RESULT_INCONSISTENT' then raise; end if;
    expected_failure := true;
  end;
  if not expected_failure then
    raise exception 'TEST_OFFICIAL_IDEMPOTENCY_SIGNALS_EXCEED_CANDIDATES_ACCEPTED';
  end if;

  expected_failure := false;
  begin
    perform public.finish_official_opportunity_discovery_v2(
      '10000000-0000-4000-8000-000000000009', request_fingerprint, admin_id,
      jsonb_build_array(signal_value - 'time_window_start'), successful_run_value
    );
  exception when sqlstate '22023' then
    if sqlerrm <> 'OFFICIAL_DISCOVERY_SIGNAL_INVALID' then raise; end if;
    expected_failure := true;
  end;
  if not expected_failure then
    raise exception 'TEST_OFFICIAL_IDEMPOTENCY_MISSING_SIGNAL_TIME_ACCEPTED';
  end if;

  expected_failure := false;
  begin
    perform public.finish_official_opportunity_discovery_v2(
      '10000000-0000-4000-8000-000000000009', request_fingerprint, admin_id,
      jsonb_build_array(jsonb_set(
        signal_value,
        '{suggested_resolution_contract}',
        (signal_value -> 'suggested_resolution_contract') - 'canonical_statement'
      )),
      successful_run_value
    );
  exception when sqlstate '22023' then
    if sqlerrm <> 'OFFICIAL_DISCOVERY_CONTRACT_INVALID' then raise; end if;
    expected_failure := true;
  end;
  if not expected_failure then
    raise exception 'TEST_OFFICIAL_IDEMPOTENCY_INCOMPLETE_CONTRACT_ACCEPTED';
  end if;

  expected_failure := false;
  begin
    perform public.finish_official_opportunity_discovery_v2(
      '10000000-0000-4000-8000-000000000009', request_fingerprint, admin_id,
      jsonb_build_array(jsonb_set(signal_value, '{title}', '123'::jsonb)),
      successful_run_value
    );
  exception when sqlstate '22023' then
    if sqlerrm <> 'OFFICIAL_DISCOVERY_SIGNAL_INVALID' then raise; end if;
    expected_failure := true;
  end;
  if not expected_failure then
    raise exception 'TEST_OFFICIAL_IDEMPOTENCY_NON_STRING_SIGNAL_TEXT_ACCEPTED';
  end if;

  expected_failure := false;
  begin
    perform public.finish_official_opportunity_discovery_v2(
      '10000000-0000-4000-8000-000000000009', request_fingerprint, admin_id,
      jsonb_build_array(jsonb_set(
        signal_value, '{signal_type}', '"official_future_release"'::jsonb
      )),
      successful_run_value
    );
  exception when sqlstate '22023' then
    if sqlerrm <> 'OFFICIAL_DISCOVERY_SIGNAL_INVALID' then raise; end if;
    expected_failure := true;
  end;
  if not expected_failure then
    raise exception 'TEST_OFFICIAL_IDEMPOTENCY_EVENT_RELEASE_TUPLE_ACCEPTED';
  end if;

  expected_failure := false;
  begin
    perform public.finish_official_opportunity_discovery_v2(
      '10000000-0000-4000-8000-000000000009', request_fingerprint, admin_id,
      jsonb_build_array(jsonb_set(
        signal_value,
        '{suggested_resolution_contract,sources,0,precedence}',
        '2'::jsonb
      )),
      successful_run_value
    );
  exception when sqlstate '22023' then
    if sqlerrm <> 'OFFICIAL_DISCOVERY_CONTRACT_PRIMARY_INVALID' then raise; end if;
    expected_failure := true;
  end;
  if not expected_failure then
    raise exception 'TEST_OFFICIAL_IDEMPOTENCY_PRIMARY_PRECEDENCE_ACCEPTED';
  end if;

  expected_failure := false;
  begin
    perform public.finish_official_opportunity_discovery_v2(
      '10000000-0000-4000-8000-000000000009', request_fingerprint, admin_id,
      jsonb_build_array(jsonb_set(
        signal_value, '{unresolved_question}', '"Otra pregunta no autorizada"'::jsonb
      )),
      successful_run_value
    );
  exception when sqlstate '22023' then
    if sqlerrm <> 'OFFICIAL_DISCOVERY_SIGNAL_INVALID' then raise; end if;
    expected_failure := true;
  end;
  if not expected_failure then
    raise exception 'TEST_OFFICIAL_IDEMPOTENCY_QUESTION_DRIFT_ACCEPTED';
  end if;

  expected_failure := false;
  begin
    perform public.finish_official_opportunity_discovery_v2(
      '10000000-0000-4000-8000-000000000009', request_fingerprint, admin_id,
      jsonb_build_array(jsonb_set(
        signal_value,
        '{suggested_resolution_contract,sources,0,precedence}',
        '"1"'::jsonb
      )),
      successful_run_value
    );
  exception when sqlstate '22023' then
    if sqlerrm <> 'OFFICIAL_DISCOVERY_CONTRACT_SOURCE_INVALID' then raise; end if;
    expected_failure := true;
  end;
  if not expected_failure then
    raise exception 'TEST_OFFICIAL_IDEMPOTENCY_STRING_PRECEDENCE_ACCEPTED';
  end if;

  expected_failure := false;
  begin
    perform public.finish_official_opportunity_discovery_v2(
      '10000000-0000-4000-8000-000000000009', request_fingerprint, admin_id,
      jsonb_build_array(jsonb_set(
        signal_value,
        '{suggested_resolution_contract,sources}',
        (signal_value #> '{suggested_resolution_contract,sources}') ||
          jsonb_build_array(
            jsonb_set(
              jsonb_set(
                signal_value #> '{suggested_resolution_contract,sources,0}',
                '{role}', '"CORROBORATION"'::jsonb
              ),
              '{precedence}', '3'::jsonb
            ) || '{"required":false}'::jsonb
          )
      )),
      successful_run_value
    );
  exception when sqlstate '22023' then
    if sqlerrm <> 'OFFICIAL_DISCOVERY_CONTRACT_SOURCE_INVALID' then raise; end if;
    expected_failure := true;
  end;
  if not expected_failure then
    raise exception 'TEST_OFFICIAL_IDEMPOTENCY_DUPLICATE_REGISTRY_SOURCE_ACCEPTED';
  end if;

  expected_failure := false;
  begin
    perform public.finish_official_opportunity_discovery_v2(
      '10000000-0000-4000-8000-000000000009', request_fingerprint, admin_id,
      jsonb_build_array(jsonb_set(
        signal_value,
        '{suggested_resolution_contract,sources}',
        jsonb_build_array(signal_value #> '{suggested_resolution_contract,sources,0}')
      )),
      successful_run_value
    );
  exception when sqlstate '22023' then
    if sqlerrm <> 'OFFICIAL_DISCOVERY_SIGNAL_INVALID' then raise; end if;
    expected_failure := true;
  end;
  if not expected_failure then
    raise exception 'TEST_OFFICIAL_IDEMPOTENCY_SINGLE_SOURCE_USEFUL_ACCEPTED';
  end if;

  expected_failure := false;
  begin
    perform public.finish_official_opportunity_discovery_v2(
      '10000000-0000-4000-8000-000000000009', request_fingerprint, admin_id,
      jsonb_build_array(jsonb_set(
        signal_value,
        '{marketability_reason_codes}',
        '[{"code":"OBJECT_NOT_ALLOWED"}]'::jsonb
      )),
      successful_run_value
    );
  exception when sqlstate '22023' then
    if sqlerrm <> 'OFFICIAL_DISCOVERY_SIGNAL_INVALID' then raise; end if;
    expected_failure := true;
  end;
  if not expected_failure then
    raise exception 'TEST_OFFICIAL_IDEMPOTENCY_NON_STRING_REASON_ACCEPTED';
  end if;

  expected_failure := false;
  begin
    perform public.finish_official_opportunity_discovery_v2(
      '10000000-0000-4000-8000-000000000009', request_fingerprint, admin_id,
      jsonb_build_array(jsonb_set(signal_value, '{provider_policy_flags}', '[123]'::jsonb)),
      successful_run_value
    );
  exception when sqlstate '22023' then
    if sqlerrm <> 'OFFICIAL_DISCOVERY_SIGNAL_INVALID' then raise; end if;
    expected_failure := true;
  end;
  if not expected_failure then
    raise exception 'TEST_OFFICIAL_IDEMPOTENCY_NON_STRING_POLICY_FLAG_ACCEPTED';
  end if;

  expected_failure := false;
  begin
    perform public.finish_official_opportunity_discovery_v2(
      '10000000-0000-4000-8000-000000000009', request_fingerprint, admin_id,
      jsonb_build_array(jsonb_set(signal_value, '{duplicate_matches}', '["invalid"]'::jsonb)),
      successful_run_value
    );
  exception when sqlstate '22023' then
    if sqlerrm <> 'OFFICIAL_DISCOVERY_SIGNAL_INVALID' then raise; end if;
    expected_failure := true;
  end;
  if not expected_failure then
    raise exception 'TEST_OFFICIAL_IDEMPOTENCY_INVALID_DUPLICATE_MATCH_ACCEPTED';
  end if;

  expected_failure := false;
  begin
    perform public.finish_official_opportunity_discovery_v2(
      '10000000-0000-4000-8000-000000000009', request_fingerprint, admin_id,
      jsonb_build_array(jsonb_set(
        signal_value,
        '{duplicate_matches}',
        jsonb_build_array(jsonb_build_object(
          'id', 'existing-market',
          'question', '¿Comenzará el evento oficial futuro de prueba antes del corte indicado?',
          'similarity', 1,
          'family_key', 'official-event:future-test',
          'family_child_key', 'deadline:2026-09-04',
          'family_title', 'Evento oficial futuro de prueba',
          'family_version', 'atinara-market-family-v4',
          'relationship', 'exact_duplicate',
          'blocking', true
        ))
      )),
      successful_run_value
    );
  exception when sqlstate '22023' then
    if sqlerrm <> 'OFFICIAL_DISCOVERY_SIGNAL_INVALID' then raise; end if;
    expected_failure := true;
  end;
  if not expected_failure then
    raise exception 'TEST_OFFICIAL_IDEMPOTENCY_DUPLICATE_STATUS_MISMATCH_ACCEPTED';
  end if;

  expected_failure := false;
  begin
    perform public.finish_official_opportunity_discovery_v2(
      '10000000-0000-4000-8000-000000000009', request_fingerprint, admin_id,
      jsonb_build_array(jsonb_set(
        signal_value,
        '{duplicate_matches}',
        jsonb_build_array(jsonb_build_object(
          'id', 'sibling-market',
          'question', '¿Comenzará un mercado hermano antes del corte indicado?',
          'similarity', 0.5,
          'family_key', 'official-event:future-test',
          'family_child_key', 'deadline:2026-09-05',
          'family_title', 'Evento oficial futuro de prueba',
          'family_version', 'atinara-market-family-v4',
          'relationship', 'sibling',
          'blocking', true
        ))
      )),
      successful_run_value
    );
  exception when sqlstate '22023' then
    if sqlerrm <> 'OFFICIAL_DISCOVERY_SIGNAL_INVALID' then raise; end if;
    expected_failure := true;
  end;
  if not expected_failure then
    raise exception 'TEST_OFFICIAL_IDEMPOTENCY_NONBLOCKING_RELATION_BLOCKED';
  end if;

  expected_failure := false;
  begin
    perform public.finish_official_opportunity_discovery_v2(
      '10000000-0000-4000-8000-000000000009', request_fingerprint, admin_id,
      '[]'::jsonb,
      jsonb_build_object(
        'outcome', 'zero_results', 'error_code', null,
        'query_fingerprint', null, 'search_results', 0,
        'inspected_documents', 0, 'structured_candidates', 0,
        'rejected_candidates', 0, 'source_error_count', 0,
        'source_error_codes', '{}'::jsonb,
        'provider_rate', '{"limit":null,"remaining":null,"reset":null}'::jsonb
      )
    );
  exception when sqlstate '22023' then
    if sqlerrm <> 'OFFICIAL_DISCOVERY_RESULT_INCONSISTENT' then raise; end if;
    expected_failure := true;
  end;
  if not expected_failure then
    raise exception 'TEST_OFFICIAL_IDEMPOTENCY_MISSING_QUERY_FINGERPRINT_ACCEPTED';
  end if;

  perform public.finish_official_opportunity_discovery_v2(
    '10000000-0000-4000-8000-000000000009', request_fingerprint, admin_id,
    '[]'::jsonb,
    jsonb_build_object(
      'outcome', 'technical_failure', 'error_code', 'PROVIDER_UNAVAILABLE',
      'query_fingerprint', null, 'search_results', 0,
      'inspected_documents', 0, 'structured_candidates', 0,
      'rejected_candidates', 0, 'source_error_count', 1,
      'source_error_codes', '{"PROVIDER_UNAVAILABLE":1}'::jsonb,
      'provider_rate', '{"limit":null,"remaining":null,"reset":null}'::jsonb
    )
  );

  perform public.begin_official_opportunity_discovery_v2(
    '10000000-0000-4000-8000-000000000003', request_fingerprint, admin_id
  );
  result_value := public.finish_official_opportunity_discovery_v2(
    '10000000-0000-4000-8000-000000000003', request_fingerprint, admin_id,
    jsonb_build_array(signal_value),
    jsonb_build_object(
      'outcome', 'success', 'error_code', null,
      'query_fingerprint', repeat('e', 64), 'search_results', 2,
      'inspected_documents', 2, 'structured_candidates', 2,
      'rejected_candidates', 0, 'source_error_count', 0,
      'source_error_codes', '{}'::jsonb,
      'provider_rate', '{"limit":null,"remaining":null,"reset":null}'::jsonb
    )
  );
  if result_value ->> 'outcome' <> 'zero_results'
     or (result_value #>> '{result_summary,duplicate_signals}')::integer <> 1 then
    raise exception 'TEST_OFFICIAL_IDEMPOTENCY_DUPLICATE_SIGNAL_INVALID:%', result_value;
  end if;
  if (select updated_at from private.data_observatory_signals
      where provider = 'official_web' and source_fingerprint = repeat('d', 64))
       is distinct from '2000-01-01T00:00:00Z'::timestamptz then
    raise exception 'TEST_OFFICIAL_IDEMPOTENCY_IDENTICAL_SIGNAL_UPDATED';
  end if;

  update private.data_observatory_signals
     set analysis_fingerprint = repeat('b', 64),
         expert_analysis_status = 'completed',
         marketability_status = 'rejected',
         hypothesis_status = 'rejected'
   where provider = 'official_web' and source_fingerprint = repeat('d', 64);
  insert into private.market_admin_audit(actor_id, action_code, detail)
  select
    admin_id,
    'OBSERVATORY_SIGNAL_DISMISSED',
    jsonb_build_object('signal_id', signal.id)
  from private.data_observatory_signals signal
  where signal.provider = 'official_web'
    and signal.source_fingerprint = repeat('d', 64);
  signal_value := jsonb_set(
    signal_value,
    '{duplicate_matches}',
    jsonb_build_array(jsonb_build_object(
      'id', 'existing-market',
      'question', '¿Comenzará el evento oficial futuro de prueba antes del corte indicado?',
      'similarity', 1,
      'family_key', 'official-event:future-test',
      'family_child_key', 'deadline:2026-09-04',
      'family_title', 'Evento oficial futuro de prueba',
      'family_version', 'atinara-market-family-v4',
      'relationship', 'sibling',
      'blocking', false
    ))
  );
  perform public.begin_official_opportunity_discovery_v2(
    '10000000-0000-4000-8000-000000000011', request_fingerprint, admin_id
  );
  result_value := public.finish_official_opportunity_discovery_v2(
    '10000000-0000-4000-8000-000000000011', request_fingerprint, admin_id,
    jsonb_build_array(signal_value), successful_run_value
  );
  if result_value ->> 'outcome' <> 'success'
     or (result_value #>> '{result_summary,saved}')::integer <> 1
     or (select expert_analysis_status from private.data_observatory_signals
         where provider = 'official_web' and source_fingerprint = repeat('d', 64)) <> 'stale'
     or (select marketability_status from private.data_observatory_signals
         where provider = 'official_web' and source_fingerprint = repeat('d', 64)) <> 'rejected'
     or (select hypothesis_status from private.data_observatory_signals
         where provider = 'official_web' and source_fingerprint = repeat('d', 64)) <> 'rejected'
     or (select jsonb_array_length(duplicate_matches) from private.data_observatory_signals
         where provider = 'official_web' and source_fingerprint = repeat('d', 64)) <> 1 then
    raise exception 'TEST_OFFICIAL_IDEMPOTENCY_DUPLICATE_ONLY_REFRESH_INVALID:%', result_value;
  end if;

  update private.data_observatory_signals
     set expert_analysis_status = 'completed'
   where provider = 'official_web' and source_fingerprint = repeat('d', 64);
  signal_value := jsonb_set(
    jsonb_set(
      jsonb_set(
        jsonb_set(
          jsonb_set(
            signal_value,
            '{source_payload_excerpt,content_sha256}',
            to_jsonb(repeat('a', 64))
          ),
          '{suggested_question}',
          to_jsonb('¿Comenzará el evento oficial futuro de prueba según el calendario actualizado?'::text)
        ),
        '{unresolved_question}',
        to_jsonb('¿Comenzará el evento oficial futuro de prueba según el calendario actualizado?'::text)
      ),
      '{suggested_resolution_contract,canonical_statement}',
      to_jsonb('¿Comenzará el evento oficial futuro de prueba según el calendario actualizado?'::text)
    ),
    '{suggested_resolution_contract,timezone}',
    to_jsonb('UTC'::text)
  );
  perform public.begin_official_opportunity_discovery_v2(
    '10000000-0000-4000-8000-000000000012', request_fingerprint, admin_id
  );
  result_value := public.finish_official_opportunity_discovery_v2(
    '10000000-0000-4000-8000-000000000012', request_fingerprint, admin_id,
    jsonb_build_array(signal_value), successful_run_value
  );
  if result_value ->> 'outcome' <> 'success'
     or (result_value #>> '{result_summary,saved}')::integer <> 1
     or (select expert_analysis_status from private.data_observatory_signals
         where provider = 'official_web' and source_fingerprint = repeat('d', 64)) <> 'stale'
     or (select marketability_status from private.data_observatory_signals
         where provider = 'official_web' and source_fingerprint = repeat('d', 64)) <> 'rejected'
     or (select hypothesis_status from private.data_observatory_signals
         where provider = 'official_web' and source_fingerprint = repeat('d', 64)) <> 'rejected'
     or (select source_payload_excerpt #>> '{content_sha256}' from private.data_observatory_signals
         where provider = 'official_web' and source_fingerprint = repeat('d', 64)) <> repeat('a', 64)
     or (select suggested_question from private.data_observatory_signals
         where provider = 'official_web' and source_fingerprint = repeat('d', 64))
          <> '¿Comenzará el evento oficial futuro de prueba según el calendario actualizado?'
     or (select suggested_resolution_contract ->> 'canonical_statement'
         from private.data_observatory_signals
         where provider = 'official_web' and source_fingerprint = repeat('d', 64))
          <> '¿Comenzará el evento oficial futuro de prueba según el calendario actualizado?'
     or (select suggested_resolution_contract ->> 'timezone'
         from private.data_observatory_signals
         where provider = 'official_web' and source_fingerprint = repeat('d', 64)) <> 'UTC'
     or (select suggested_question is distinct from
              suggested_resolution_contract ->> 'canonical_statement'
         from private.data_observatory_signals
         where provider = 'official_web' and source_fingerprint = repeat('d', 64)) then
    raise exception 'TEST_OFFICIAL_IDEMPOTENCY_CHANGED_SIGNAL_NOT_REFRESHED:%', result_value;
  end if;

  perform public.begin_official_opportunity_discovery_v2(
    '10000000-0000-4000-8000-000000000004', request_fingerprint, admin_id
  );
  result_value := public.finish_official_opportunity_discovery_v2(
    '10000000-0000-4000-8000-000000000004', request_fingerprint, admin_id,
    '[]'::jsonb,
    jsonb_build_object(
      'outcome', 'partial', 'error_code', null,
      'query_fingerprint', repeat('e', 64), 'search_results', 8,
      'inspected_documents', 7, 'structured_candidates', 0,
      'rejected_candidates', 0, 'source_error_count', 1,
      'source_error_codes', '{"OFFICIAL_SOURCE_TIMEOUT":1}'::jsonb,
      'provider_rate', '{"limit":null,"remaining":null,"reset":null}'::jsonb
    )
  );
  if result_value ->> 'outcome' <> 'partial'
     or (result_value #>> '{result_summary,search_results}')::integer <> 8
     or (result_value #>> '{result_summary,inspected_documents}')::integer <> 7
     or (result_value #>> '{result_summary,source_error_count}')::integer <> 1 then
    raise exception 'TEST_OFFICIAL_IDEMPOTENCY_PARTIAL_INVALID:%', result_value;
  end if;

  perform public.begin_official_opportunity_discovery_v2(
    '10000000-0000-4000-8000-000000000005', request_fingerprint, admin_id
  );
  result_value := public.finish_official_opportunity_discovery_v2(
    '10000000-0000-4000-8000-000000000005', request_fingerprint, admin_id,
    '[]'::jsonb,
    jsonb_build_object(
      'outcome', 'technical_failure', 'error_code', 'PROVIDER_TIMEOUT',
      'query_fingerprint', null, 'search_results', 0,
      'inspected_documents', 0, 'structured_candidates', 0,
      'rejected_candidates', 0, 'source_error_count', 1,
      'source_error_codes', '{"PROVIDER_TIMEOUT":1}'::jsonb,
      'provider_rate', '{"limit":null,"remaining":null,"reset":null}'::jsonb
    )
  );
  if result_value ->> 'outcome' <> 'technical_failure'
     or result_value #>> '{result_summary,error_code}' <> 'PROVIDER_TIMEOUT' then
    raise exception 'TEST_OFFICIAL_IDEMPOTENCY_TECHNICAL_FAILURE_INVALID:%', result_value;
  end if;
end;
$remaining_outcomes$;

reset role;

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;

do $start_expiring_lease$
begin
  perform public.begin_official_opportunity_discovery_v2(
    '10000000-0000-4000-8000-000000000006',
    repeat('c', 64),
    '10000000-0000-4000-8000-00000000a001'
  );
end;
$start_expiring_lease$;

reset role;

update private.data_provider_runs
set lease_expires_at = now() - interval '1 second'
where provider = 'official_web'
  and action = 'discover_official_opportunities'
  and request_id = '10000000-0000-4000-8000-000000000006';

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;

do $expired_lease$
declare
  new_intent jsonb;
  terminal_result jsonb;
  terminal_replay jsonb;
begin
  new_intent := public.begin_official_opportunity_discovery_v2(
    '10000000-0000-4000-8000-000000000008',
    repeat('c', 64),
    '10000000-0000-4000-8000-00000000a001'
  );
  terminal_result := public.begin_official_opportunity_discovery_v2(
    '10000000-0000-4000-8000-000000000006',
    repeat('c', 64),
    '10000000-0000-4000-8000-00000000a001'
  );
  terminal_replay := public.begin_official_opportunity_discovery_v2(
    '10000000-0000-4000-8000-000000000006',
    repeat('c', 64),
    '10000000-0000-4000-8000-00000000a001'
  );

  if new_intent ->> 'state' <> 'started'
     or terminal_result ->> 'state' <> 'terminal'
     or terminal_result ->> 'outcome' <> 'technical_failure'
     or terminal_result #>> '{result_summary,error_code}' <> 'OFFICIAL_DISCOVERY_REQUEST_INTERRUPTED'
     or terminal_result #>> '{result_summary,source_error_codes,OFFICIAL_DISCOVERY_REQUEST_INTERRUPTED}' <> '1'
     or coalesce((terminal_result ->> 'replayed')::boolean, false) is not true
     or terminal_replay is distinct from terminal_result then
    raise exception 'TEST_OFFICIAL_IDEMPOTENCY_EXPIRED_LEASE_INVALID:%:%', terminal_result, terminal_replay;
  end if;

  perform public.finish_official_opportunity_discovery_v2(
    '10000000-0000-4000-8000-000000000008',
    repeat('c', 64),
    '10000000-0000-4000-8000-00000000a001',
    '[]'::jsonb,
    jsonb_build_object(
      'outcome', 'zero_results', 'error_code', null,
      'query_fingerprint', repeat('e', 64), 'search_results', 0,
      'inspected_documents', 0, 'structured_candidates', 0,
      'rejected_candidates', 0, 'source_error_count', 0,
      'source_error_codes', '{}'::jsonb,
      'provider_rate', '{"limit":null,"remaining":null,"reset":null}'::jsonb
    )
  );
end;
$expired_lease$;

reset role;

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;

do $start_late_finish$
begin
  perform public.begin_official_opportunity_discovery_v2(
    '10000000-0000-4000-8000-000000000010',
    repeat('c', 64),
    '10000000-0000-4000-8000-00000000a001'
  );
end;
$start_late_finish$;

reset role;

update private.data_provider_runs
set lease_expires_at = now() - interval '1 second'
where provider = 'official_web'
  and action = 'discover_official_opportunities'
  and request_id = '10000000-0000-4000-8000-000000000010';

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;

do $late_finish$
declare
  signal_value jsonb;
  late_signal jsonb;
  terminal_result jsonb;
begin
  select payload into signal_value from official_discovery_v2_signal_fixture;
  late_signal := jsonb_set(
    jsonb_set(
      jsonb_set(signal_value, '{source_fingerprint}', to_jsonb(repeat('a', 64))),
      '{entity_id}', to_jsonb(repeat('a', 64))
    ),
    '{suggested_resolution_contract,entity_id}', to_jsonb(repeat('a', 64))
  );
  terminal_result := public.finish_official_opportunity_discovery_v2(
    '10000000-0000-4000-8000-000000000010',
    repeat('c', 64),
    '10000000-0000-4000-8000-00000000a001',
    jsonb_build_array(late_signal),
    jsonb_build_object(
      'outcome', 'success', 'error_code', null,
      'query_fingerprint', repeat('e', 64), 'search_results', 2,
      'inspected_documents', 2, 'structured_candidates', 2,
      'rejected_candidates', 0, 'source_error_count', 0,
      'source_error_codes', '{}'::jsonb,
      'provider_rate', '{"limit":null,"remaining":null,"reset":null}'::jsonb
    )
  );
  if terminal_result ->> 'state' <> 'terminal'
     or terminal_result ->> 'outcome' <> 'technical_failure'
     or terminal_result #>> '{result_summary,error_code}' <> 'OFFICIAL_DISCOVERY_REQUEST_INTERRUPTED'
     or coalesce((terminal_result ->> 'replayed')::boolean, true) is not false then
    raise exception 'TEST_OFFICIAL_IDEMPOTENCY_LATE_FINISH_ACCEPTED:%', terminal_result;
  end if;
end;
$late_finish$;

reset role;

do $late_finish_did_not_insert$
begin
  if exists (
    select 1 from private.data_observatory_signals signal
    where signal.provider = 'official_web'
      and signal.source_fingerprint = repeat('a', 64)
  ) then
    raise exception 'TEST_OFFICIAL_IDEMPOTENCY_LATE_FINISH_INSERTED_SIGNAL';
  end if;
end;
$late_finish_did_not_insert$;

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;

do $reject_unsafe_provider_rate$
declare
  expected_failure boolean := false;
begin
  perform public.begin_official_opportunity_discovery_v2(
    '10000000-0000-4000-8000-000000000007',
    repeat('c', 64),
    '10000000-0000-4000-8000-00000000a001'
  );
  begin
    perform public.finish_official_opportunity_discovery_v2(
      '10000000-0000-4000-8000-000000000007',
      repeat('c', 64),
      '10000000-0000-4000-8000-00000000a001',
      '[]'::jsonb,
      jsonb_build_object(
        'outcome', 'zero_results', 'error_code', null,
        'query_fingerprint', repeat('e', 64), 'search_results', 0,
        'inspected_documents', 0, 'structured_candidates', 0,
        'rejected_candidates', 0, 'source_error_count', 0,
        'source_error_codes', '{}'::jsonb,
        'provider_rate', jsonb_build_object(
          'limit', 'https://secret.example/query?q=private',
          'remaining', '<html>token</html>',
          'reset', 'sb_secret_abcdefghijklmnop'
        )
      )
    );
  exception when sqlstate '22023' then
    if sqlerrm <> 'OFFICIAL_DISCOVERY_RESULT_INVALID' then raise; end if;
    expected_failure := true;
  end;
  if not expected_failure then
    raise exception 'TEST_OFFICIAL_IDEMPOTENCY_UNSAFE_PROVIDER_RATE_ACCEPTED';
  end if;
end;
$reject_unsafe_provider_rate$;

reset role;

do $final_assertions$
declare
  baseline official_discovery_v2_baseline%rowtype;
begin
  select * into baseline from official_discovery_v2_baseline;
  if (select count(*) from public.markets) <> baseline.markets
     or (select count(*) from private.market_drafts) <> baseline.drafts
     or (select count(*) from public.predictions) <> baseline.predictions
     or (select count(*) from public.profiles) <> baseline.profiles
     or (select count(*) from public.market_price_history) <> baseline.price_history
     or (select count(*) from private.market_expert_runs) <> baseline.expert_runs
     or (select count(*) from private.ai_invocation_attempts) <> baseline.ai_attempts then
    raise exception 'TEST_OFFICIAL_IDEMPOTENCY_DOMAIN_MUTATION_DETECTED';
  end if;
  if (select count(*) from private.data_provider_runs
      where provider = 'official_web'
        and action = 'discover_official_opportunities'
           and request_id between '10000000-0000-4000-8000-000000000001'::uuid
                              and '10000000-0000-4000-8000-000000000012'::uuid) <> 12 then
    raise exception 'TEST_OFFICIAL_IDEMPOTENCY_PROVIDER_RUN_COUNT_INVALID';
  end if;
  if (select count(*) from private.data_observatory_signals
      where provider = 'official_web' and source_fingerprint = repeat('d', 64)) <> 1
     or (select expert_analysis_status from private.data_observatory_signals
         where provider = 'official_web' and source_fingerprint = repeat('d', 64)) <> 'stale'
     or (select marketability_status from private.data_observatory_signals
         where provider = 'official_web' and source_fingerprint = repeat('d', 64)) <> 'rejected'
     or (select hypothesis_status from private.data_observatory_signals
         where provider = 'official_web' and source_fingerprint = repeat('d', 64)) <> 'rejected'
     or (select source_payload_excerpt #>> '{content_sha256}' from private.data_observatory_signals
         where provider = 'official_web' and source_fingerprint = repeat('d', 64)) <> repeat('a', 64)
     or (select jsonb_array_length(duplicate_matches) from private.data_observatory_signals
         where provider = 'official_web' and source_fingerprint = repeat('d', 64)) <> 1 then
    raise exception 'TEST_OFFICIAL_IDEMPOTENCY_SIGNAL_REFRESH_INVALID';
  end if;
  if exists (
    select 1 from private.data_provider_runs run
    where run.provider = 'official_web'
      and run.request_id is not null
      and run.quota_state::text ~* '(https?://|<html|future-2027|official-idempotency\.example)'
  ) then
    raise exception 'TEST_OFFICIAL_IDEMPOTENCY_TELEMETRY_LEAK';
  end if;
  if (select count(*)
      from private.market_admin_audit audit
      join private.data_observatory_signals signal
        on audit.detail ->> 'signal_id' = signal.id::text
      where audit.actor_id = '10000000-0000-4000-8000-00000000a001'
        and audit.action_code = 'OBSERVATORY_SIGNAL_DISMISSED'
        and signal.provider = 'official_web'
        and signal.source_fingerprint = repeat('d', 64)) <> 1 then
    raise exception 'TEST_OFFICIAL_IDEMPOTENCY_HUMAN_DISMISSAL_AUDIT_CHANGED';
  end if;
end;
$final_assertions$;

rollback;
