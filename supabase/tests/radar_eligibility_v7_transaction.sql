begin;

do $test$
declare
  suffix text := replace(gen_random_uuid()::text, '-', '');
  external_id_value text := 'kalshi:ELIGIBILITY-V7-' || suffix;
  expired_external_id_value text := 'kalshi:ELIGIBILITY-V7-EXPIRED-' || suffix;
  event_key_value text := 'kalshi:ELIGIBILITY-V7-' || suffix;
  checked_at_value timestamptz := clock_timestamp();
  eligible_attempt_id uuid := gen_random_uuid();
  technical_attempt_id uuid := gen_random_uuid();
  terminal_attempt_id uuid := gen_random_uuid();
  reopen_attempt_id uuid := gen_random_uuid();
  expired_attempt_id uuid := gen_random_uuid();
  same_revision_attempt_id uuid := gen_random_uuid();
  material_refresh_attempt_id uuid := gen_random_uuid();
  candidate_input jsonb;
  check_input jsonb;
  source_evidence jsonb;
  upsert_result jsonb;
  attempt_result jsonb;
  apply_result jsonb;
  replay_result jsonb;
  candidate_row private.external_market_candidates%rowtype;
  check_row private.market_radar_eligibility_checks%rowtype;
  draft_fixture private.market_drafts%rowtype;
  original_pointer bigint;
  terminal_pointer bigint;
  original_revision bigint;
  terminal_revision bigint;
  projection_before jsonb;
  projection_after jsonb;
  projection_top_diff jsonb;
  projection_payload_diff jsonb;
  check_count bigint;
  attempt_count bigint;
  economic_before jsonb;
  economic_after jsonb;
begin
  if to_regclass('private.market_radar_eligibility_checks') is null
     or to_regclass('private.market_radar_eligibility_attempts') is null
     or to_regprocedure(
       'public.upsert_market_radar_batch_with_eligibility_v1(text,text,text,jsonb,jsonb,text,jsonb)'
     ) is null
     or to_regprocedure(
       'public.apply_market_radar_prepare_eligibility_v1(uuid,bigint,text,timestamp with time zone,jsonb,jsonb,boolean)'
     ) is null
     or to_regprocedure(
       'public.record_market_radar_eligibility_attempt_v1(uuid,bigint,text,uuid,text,text,boolean)'
     ) is null
     or to_regprocedure(
       'private.market_radar_candidate_resolution_source_ready_v1(private.external_market_candidates)'
     ) is null then
    raise exception 'RADAR_ELIGIBILITY_V7_SCHEMA_INCOMPLETE';
  end if;

  if has_table_privilege('anon', 'private.market_radar_eligibility_checks', 'SELECT')
     or has_table_privilege('authenticated', 'private.market_radar_eligibility_checks', 'SELECT')
     or has_table_privilege('service_role', 'private.market_radar_eligibility_checks', 'SELECT')
     or has_table_privilege('anon', 'private.market_radar_eligibility_attempts', 'SELECT')
     or has_table_privilege('authenticated', 'private.market_radar_eligibility_attempts', 'SELECT')
     or has_table_privilege('service_role', 'private.market_radar_eligibility_attempts', 'SELECT') then
    raise exception 'RADAR_ELIGIBILITY_LEDGER_PRIVILEGES_TOO_BROAD';
  end if;
  if has_function_privilege(
       'anon',
       'public.upsert_market_radar_batch_with_eligibility_v1(text,text,text,jsonb,jsonb,text,jsonb)',
       'EXECUTE'
     )
     or has_function_privilege(
       'authenticated',
       'public.upsert_market_radar_batch_with_eligibility_v1(text,text,text,jsonb,jsonb,text,jsonb)',
       'EXECUTE'
     )
     or not has_function_privilege(
       'service_role',
       'public.upsert_market_radar_batch_with_eligibility_v1(text,text,text,jsonb,jsonb,text,jsonb)',
       'EXECUTE'
     )
     or has_function_privilege(
       'authenticated',
       'public.record_market_radar_eligibility_attempt_v1(uuid,bigint,text,uuid,text,text,boolean)',
       'EXECUTE'
     )
     or not has_function_privilege(
       'service_role',
       'public.record_market_radar_eligibility_attempt_v1(uuid,bigint,text,uuid,text,text,boolean)',
       'EXECUTE'
     ) then
    raise exception 'RADAR_ELIGIBILITY_RPC_PRIVILEGES_INVALID';
  end if;

  if not exists (
       select 1
       from pg_trigger
       where tgrelid = 'private.market_radar_eligibility_checks'::regclass
         and tgname = 'reject_market_radar_eligibility_check_mutation'
         and not tgisinternal
     )
     or not exists (
       select 1
       from pg_trigger
       where tgrelid = 'private.market_radar_eligibility_attempts'::regclass
         and tgname = 'reject_market_radar_eligibility_attempt_mutation'
         and not tgisinternal
     )
     or not exists (
       select 1
       from pg_trigger
       where tgrelid = 'private.market_drafts'::regclass
         and tgname = 'aaaa_market_draft_radar_eligibility_gate_v1'
         and not tgisinternal
     ) then
    raise exception 'RADAR_ELIGIBILITY_TRIGGER_MISSING';
  end if;

  if coalesce((
       select active
       from private.market_issue_strategy_registry
       where code = 'RADAR_FACTUAL_VERIFICATION_REQUIRED'
     ), false)
     or not coalesce((
       select active
       from private.market_issue_strategy_registry
       where code = 'RADAR_ELIGIBILITY_REQUIRED'
     ), false) then
    raise exception 'RADAR_FACTUAL_STRATEGY_NOT_RETIRED';
  end if;
  if exists (
    select 1
    from private.market_radar_eligibility_checks check_alias
    where check_alias.status = 'eligible'
      and check_alias.reason = 'Candidata futura migrada a la puerta determinista de elegibilidad.'
  ) then
    raise exception 'RADAR_BOOTSTRAP_MINTED_FRESH_ELIGIBILITY';
  end if;
  if position(
       'assert_market_radar_draft_eligibility_v1'
       in pg_get_functiondef('private.assert_market_source_publication_ready(uuid)'::regprocedure)
     ) = 0 then
    raise exception 'RADAR_PUBLICATION_GATE_NOT_LINKED';
  end if;

  select jsonb_build_object(
    'markets', (select coalesce(md5(string_agg(md5(to_jsonb(row_value)::text), '' order by to_jsonb(row_value)::text)), md5('')) from public.markets row_value),
    'predictions', (select coalesce(md5(string_agg(md5(to_jsonb(row_value)::text), '' order by to_jsonb(row_value)::text)), md5('')) from public.predictions row_value),
    'profiles', (select coalesce(md5(string_agg(md5(to_jsonb(row_value)::text), '' order by to_jsonb(row_value)::text)), md5('')) from public.profiles row_value),
    'maker', (select coalesce(md5(string_agg(md5(to_jsonb(row_value)::text), '' order by to_jsonb(row_value)::text)), md5('')) from public.market_maker_state row_value),
    'prices', (select coalesce(md5(string_agg(md5(to_jsonb(row_value)::text), '' order by to_jsonb(row_value)::text)), md5('')) from public.market_price_history row_value)
  ) into economic_before;

  source_evidence := jsonb_build_array(jsonb_build_object(
    'url', 'https://store.steampowered.com/app/123456/eligibility-v7-fixture/',
    'title', 'Eligibility v7 transaction fixture on Steam',
    'supports', 'Official Steam product page for the eligibility v7 transaction fixture.',
    'source_type', 'official',
    'retrieved_at', checked_at_value,
    'retrieval_status', 'verified_content',
    'evidence_basis', 'retrieved_content',
    'parser_version', 'atinara-official-content-v1',
    'content_sha256', repeat('1', 64),
    'claim_status', 'direct',
    'direct_claim', true,
    'claim_verifiable', true
  ));
  candidate_input := jsonb_build_object(
    'provider', 'kalshi',
    'external_id', external_id_value,
    'external_event_id', 'ELIGIBILITY-V7-' || suffix,
    'external_market_id', 'ELIGIBILITY-V7-' || suffix || '-YES',
    'external_url', 'https://kalshi.com/markets/eligibility-v7/' || suffix,
    'external_event_url', 'https://kalshi.com/markets/eligibility-v7/' || suffix,
    'external_market_url', 'https://kalshi.com/markets/eligibility-v7/' || suffix,
    'event_group_key', event_key_value,
    'fingerprint', encode(extensions.digest(convert_to(external_id_value, 'UTF8'), 'sha256'), 'hex'),
    'normalizer_version', 'atinara-radar-v2',
    'eligibility_policy_version', 'atinara-prediction-policy-v5',
    'eligibility_status', 'eligible',
    'eligibility_reason_code', null,
    'eligibility_reason', 'Contrato futuro y negociable en el proveedor canónico.',
    'eligibility_checked_at', checked_at_value,
    'eligibility_expires_at', checked_at_value + interval '6 hours',
    'eligibility_evidence', source_evidence,
    'source_status', 'active',
    'source_title', 'Eligibility v7 transaction fixture',
    'source_question', 'Will the eligibility v7 fixture happen?',
    'source_close_at', checked_at_value + interval '30 days',
    'source_resolution_rules', 'Resolves from the official product source.',
    'source_resolution_url', 'https://store.steampowered.com/app/123456/eligibility-v7-fixture/',
    'atinara_question', '¿Ocurrirá el fixture transaccional de elegibilidad v7?',
    'atinara_category', 'Lanzamientos',
    'atinara_resolution_criteria', 'Sí si la fuente oficial confirma el acontecimiento dentro del periodo.',
    'atinara_resolution_source_url', 'https://store.steampowered.com/app/123456/eligibility-v7-fixture/',
    'resolution_source_evidence', source_evidence,
    'hard_reject_reasons', '[]'::jsonb,
    'warnings', '[]'::jsonb,
    'duplicate_matches', '[]'::jsonb,
    'verification_status', 'verified_open',
    'verification_reason', 'Elegibilidad determinista vigente.',
    'verified_at', checked_at_value,
    'verification_expires_at', checked_at_value + interval '6 hours',
    'verification_evidence', source_evidence,
    'verification_confidence', 100,
    'quality_status', 'fit',
    'quality_score', 90,
    'score_breakdown', '{}'::jsonb,
    'state', 'available',
    'fetched_at', checked_at_value,
    'cache_expires_at', checked_at_value + interval '20 minutes'
  );
  check_input := jsonb_build_object(
    'attempt_id', eligible_attempt_id,
    'provider', 'kalshi',
    'external_id', external_id_value,
    'event_group_key', event_key_value,
    'policy_version', 'atinara-prediction-policy-v5',
    'status', 'eligible',
    'reason_code', null,
    'reason', 'Contrato futuro y negociable en el proveedor canónico.',
    'evidence', source_evidence,
    'checked_at', checked_at_value,
    'expires_at', checked_at_value + interval '6 hours',
    'decision_hash', repeat('a', 64)
  );

  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  upsert_result := public.upsert_market_radar_batch_with_eligibility_v1(
    'kalshi', 'radar-eligibility-v7:' || suffix, 'atinara-radar-v2',
    jsonb_build_array(candidate_input), jsonb_build_array(check_input),
    'atinara-prediction-policy-v5',
    jsonb_build_object('status', 'available', 'is_cached', false)
  );
  if not coalesce((upsert_result ->> 'ok')::boolean, false)
     or (upsert_result ->> 'accepted_count')::integer <> 1
     or (upsert_result ->> 'quarantined_count')::integer <> 0 then
    raise exception 'RADAR_ELIGIBILITY_UPSERT_FAILED: %', upsert_result;
  end if;

  select * into candidate_row
  from private.external_market_candidates
  where provider = 'kalshi' and external_id = external_id_value;
  select * into check_row
  from private.market_radar_eligibility_checks
  where attempt_id = eligible_attempt_id;
  if candidate_row.id is null
     or check_row.id is null
     or candidate_row.current_eligibility_check_id is distinct from check_row.id
     or candidate_row.eligibility_status is distinct from 'eligible'
     or candidate_row.eligibility_policy_version is distinct from 'atinara-prediction-policy-v5'
     or candidate_row.verification_status is distinct from 'verified_open'
     or candidate_row.current_fact_check_id is not null
     or candidate_row.fact_status is not null then
    raise exception 'RADAR_ELIGIBILITY_POINTER_INVALID';
  end if;
  original_pointer := candidate_row.current_eligibility_check_id;
  original_revision := candidate_row.preparation_revision;

  attempt_result := public.record_market_radar_eligibility_attempt_v1(
    candidate_row.id, candidate_row.preparation_revision, 'prepare',
    technical_attempt_id, 'official_terminal_scan', 'UPSTREAM_TIMEOUT', true
  );
  replay_result := public.record_market_radar_eligibility_attempt_v1(
    candidate_row.id, candidate_row.preparation_revision, 'prepare',
    technical_attempt_id, 'official_terminal_scan', 'UPSTREAM_TIMEOUT', true
  );
  select count(*) into attempt_count
  from private.market_radar_eligibility_attempts
  where attempt_id = technical_attempt_id;
  select * into candidate_row
  from private.external_market_candidates where id = candidate_row.id;
  if not coalesce((attempt_result ->> 'ok')::boolean, false)
     or not coalesce((replay_result ->> 'idempotent')::boolean, false)
     or attempt_count <> 1
     or candidate_row.current_eligibility_check_id is distinct from original_pointer
     or candidate_row.preparation_revision is distinct from original_revision then
    raise exception 'RADAR_TECHNICAL_ATTEMPT_CHANGED_AUTHORITY';
  end if;

  begin
    update private.market_radar_eligibility_checks
    set reason = 'mutación prohibida'
    where id = original_pointer;
    raise exception 'RADAR_ELIGIBILITY_CHECK_MUTATION_WAS_ALLOWED';
  exception when sqlstate '55000' then
    if sqlerrm <> 'RADAR_ELIGIBILITY_APPEND_ONLY' then raise; end if;
  end;
  begin
    delete from private.market_radar_eligibility_attempts
    where attempt_id = technical_attempt_id;
    raise exception 'RADAR_ELIGIBILITY_ATTEMPT_MUTATION_WAS_ALLOWED';
  exception when sqlstate '55000' then
    if sqlerrm <> 'RADAR_ELIGIBILITY_APPEND_ONLY' then raise; end if;
  end;

  draft_fixture.radar_candidate_id := candidate_row.id;
  draft_fixture.source_provenance := jsonb_build_object(
    'radar_candidate_id', candidate_row.id,
    'radar_preparation_revision', original_revision,
    'radar_eligibility_check_id', check_row.id,
    'radar_eligibility_policy_version', check_row.policy_version,
    'radar_eligibility_status', check_row.status,
    'radar_eligibility_decision_hash', check_row.decision_hash
  );
  perform private.assert_market_radar_draft_eligibility_v1(
    draft_fixture, checked_at_value
  );

  -- Rotating A to B without changing the material projection keeps R valid.
  apply_result := public.apply_market_radar_prepare_eligibility_v1(
    candidate_row.id,
    original_revision,
    'atinara-radar-v2',
    checked_at_value + interval '30 seconds',
    jsonb_build_object(
      'provider', 'kalshi',
      'external_id', external_id_value,
      'eligibility_policy_version', 'atinara-prediction-policy-v5',
      'eligibility_status', 'eligible',
      'atinara_question', candidate_input ->> 'atinara_question',
      'atinara_category', 'Lanzamientos',
      'atinara_resolution_criteria', candidate_input ->> 'atinara_resolution_criteria',
      'atinara_resolution_source_url', 'https://store.steampowered.com/app/123456/eligibility-v7-fixture/',
      'resolution_source_evidence', source_evidence
    ),
    jsonb_build_object(
      'attempt_id', same_revision_attempt_id,
      'provider', 'kalshi',
      'external_id', external_id_value,
      'policy_version', 'atinara-prediction-policy-v5',
      'status', 'eligible',
      'reason', 'Renovación de lease sin cambio material.',
      'evidence', source_evidence,
      'expires_at', checked_at_value + interval '6 hours',
      'decision_hash', repeat('e', 64)
    ),
    false
  );
  select * into candidate_row
  from private.external_market_candidates where id = candidate_row.id;
  if not coalesce((apply_result ->> 'ok')::boolean, false)
     or candidate_row.preparation_revision is distinct from original_revision
     or candidate_row.current_eligibility_check_id is not distinct from original_pointer then
    raise exception 'RADAR_SAME_REVISION_CHECK_ROTATION_FAILED: %', apply_result;
  end if;
  perform private.assert_market_radar_draft_eligibility_v1(
    draft_fixture, checked_at_value + interval '30 seconds'
  );

  -- A material refresh to R+1/B must invalidate the old R/A provenance.
  apply_result := public.apply_market_radar_prepare_eligibility_v1(
    candidate_row.id,
    original_revision,
    'atinara-radar-v2',
    checked_at_value + interval '45 seconds',
    jsonb_build_object(
      'provider', 'kalshi',
      'external_id', external_id_value,
      'eligibility_policy_version', 'atinara-prediction-policy-v5',
      'eligibility_status', 'eligible',
      'atinara_question', (candidate_input ->> 'atinara_question') || ' · revisión material',
      'atinara_category', 'Lanzamientos',
      'atinara_resolution_criteria', candidate_input ->> 'atinara_resolution_criteria',
      'atinara_resolution_source_url', 'https://store.steampowered.com/app/123456/eligibility-v7-fixture/',
      'resolution_source_evidence', source_evidence
    ),
    jsonb_build_object(
      'attempt_id', material_refresh_attempt_id,
      'provider', 'kalshi',
      'external_id', external_id_value,
      'policy_version', 'atinara-prediction-policy-v5',
      'status', 'eligible',
      'reason', 'Refresh elegible con cambio material.',
      'evidence', source_evidence,
      'expires_at', checked_at_value + interval '6 hours',
      'decision_hash', repeat('f', 64)
    ),
    false
  );
  select * into candidate_row
  from private.external_market_candidates where id = candidate_row.id;
  if not coalesce((apply_result ->> 'ok')::boolean, false)
     or candidate_row.preparation_revision is distinct from original_revision + 1 then
    raise exception 'RADAR_MATERIAL_REFRESH_DID_NOT_INCREMENT_REVISION: %', apply_result;
  end if;
  begin
    perform private.assert_market_radar_draft_eligibility_v1(
      draft_fixture, checked_at_value + interval '45 seconds'
    );
    raise exception 'RADAR_STALE_DRAFT_PROVENANCE_WAS_ACCEPTED';
  exception when sqlstate '40001' then
    if sqlerrm <> 'RADAR_PREPARATION_REVISION_MISMATCH' then raise; end if;
  end;
  original_revision := candidate_row.preparation_revision;

  apply_result := public.apply_market_radar_prepare_eligibility_v1(
    candidate_row.id,
    candidate_row.preparation_revision,
    'atinara-radar-v2',
    checked_at_value + interval '1 minute',
    jsonb_build_object(
      'provider', 'kalshi',
      'external_id', external_id_value,
      'eligibility_policy_version', 'atinara-prediction-policy-v5',
      'eligibility_status', 'terminal',
      'atinara_question', candidate_input ->> 'atinara_question',
      'atinara_category', 'Lanzamientos',
      'atinara_resolution_criteria', candidate_input ->> 'atinara_resolution_criteria',
      'atinara_resolution_source_url', 'https://store.steampowered.com/'
    ),
    jsonb_build_object(
      'attempt_id', terminal_attempt_id,
      'provider', 'kalshi',
      'external_id', external_id_value,
      'policy_version', 'atinara-prediction-policy-v5',
      'status', 'terminal',
      'reason_code', 'EVENT_ALREADY_RESOLVED',
      'reason', 'Una fuente oficial exacta ya publicó el resultado.',
      'evidence', jsonb_build_array(jsonb_build_object(
        'url', 'https://store.steampowered.com/',
        'direct_claim', true
      )),
      'expires_at', checked_at_value + interval '6 hours',
      'decision_hash', repeat('b', 64)
    ),
    false
  );
  select * into candidate_row
  from private.external_market_candidates where id = candidate_row.id;
  terminal_pointer := candidate_row.current_eligibility_check_id;
  if coalesce((apply_result ->> 'ok')::boolean, true)
     or apply_result ->> 'error' is distinct from 'RADAR_CANDIDATE_RESOLVED'
     or candidate_row.eligibility_status is distinct from 'terminal'
     or candidate_row.verification_status is distinct from 'rejected_resolved'
     or candidate_row.state is distinct from 'rejected'
     or candidate_row.preparation_revision is distinct from original_revision + 1
     or terminal_pointer is not distinct from original_pointer then
    raise exception 'RADAR_TERMINAL_DECISION_NOT_PERSISTED: %', apply_result;
  end if;
  terminal_revision := candidate_row.preparation_revision;
  projection_before := private.market_candidate_preparation_projection(candidate_row);

  apply_result := public.apply_market_radar_prepare_eligibility_v1(
    candidate_row.id,
    candidate_row.preparation_revision,
    'atinara-radar-v2',
    checked_at_value + interval '2 minutes',
    jsonb_build_object(
      'provider', 'kalshi',
      'external_id', external_id_value,
      'eligibility_policy_version', 'atinara-prediction-policy-v5',
      'eligibility_status', 'eligible',
      'atinara_question', candidate_input ->> 'atinara_question',
      'atinara_category', 'Lanzamientos',
      'atinara_resolution_criteria', candidate_input ->> 'atinara_resolution_criteria',
      'atinara_resolution_source_url', 'https://store.steampowered.com/'
    ),
    jsonb_build_object(
      'attempt_id', reopen_attempt_id,
      'provider', 'kalshi',
      'external_id', external_id_value,
      'policy_version', 'atinara-prediction-policy-v5',
      'status', 'eligible',
      'reason', 'El proveedor continúa mostrando el contrato como abierto.',
      'evidence', '[]'::jsonb,
      'expires_at', checked_at_value + interval '6 hours',
      'decision_hash', repeat('c', 64)
    ),
    false
  );
  select * into candidate_row
  from private.external_market_candidates where id = candidate_row.id;
  select count(*) into check_count
  from private.market_radar_eligibility_checks
  where attempt_id = reopen_attempt_id;
  projection_after := private.market_candidate_preparation_projection(candidate_row);
  if candidate_row.preparation_revision is distinct from terminal_revision then
    select coalesce(jsonb_object_agg(diff_key, jsonb_build_array(
      projection_before -> diff_key, projection_after -> diff_key
    )), '{}'::jsonb)
    into projection_top_diff
    from (
      select key as diff_key
      from jsonb_object_keys(projection_before || projection_after) key
      where key <> 'normalized_payload'
        and projection_before -> key is distinct from projection_after -> key
    ) changed;
    select coalesce(jsonb_object_agg(diff_key, jsonb_build_array(
      projection_before -> 'normalized_payload' -> diff_key,
      projection_after -> 'normalized_payload' -> diff_key
    )), '{}'::jsonb)
    into projection_payload_diff
    from (
      select key as diff_key
      from jsonb_object_keys(
        coalesce(projection_before -> 'normalized_payload', '{}'::jsonb)
        || coalesce(projection_after -> 'normalized_payload', '{}'::jsonb)
      ) key
      where projection_before -> 'normalized_payload' -> key
        is distinct from projection_after -> 'normalized_payload' -> key
    ) changed;
    raise exception 'RADAR_TERMINAL_RECHECK_CHANGED_MATERIAL_REVISION: before=%, after=%, top_diff=%, payload_diff=%',
      terminal_revision, candidate_row.preparation_revision,
      projection_top_diff, projection_payload_diff;
  end if;
  if coalesce((apply_result ->> 'ok')::boolean, true)
     or apply_result ->> 'error' is distinct from 'RADAR_CANDIDATE_RESOLVED'
     or candidate_row.eligibility_status is distinct from 'terminal'
     or check_count <> 1
     or not exists (
       select 1 from private.market_radar_eligibility_checks
       where attempt_id = reopen_attempt_id and status = 'terminal'
     ) then
    raise exception 'RADAR_TERMINAL_DECISION_REOPENED';
  end if;
  terminal_pointer := candidate_row.current_eligibility_check_id;

  replay_result := public.apply_market_radar_prepare_eligibility_v1(
    candidate_row.id,
    candidate_row.preparation_revision,
    'atinara-radar-v2',
    checked_at_value + interval '2 minutes',
    jsonb_build_object(
      'provider', 'kalshi',
      'external_id', external_id_value,
      'eligibility_policy_version', 'atinara-prediction-policy-v5',
      'eligibility_status', 'eligible'
    ),
    jsonb_build_object(
      'attempt_id', reopen_attempt_id,
      'provider', 'kalshi',
      'external_id', external_id_value,
      'policy_version', 'atinara-prediction-policy-v5',
      'status', 'eligible',
      'reason', 'El proveedor continúa mostrando el contrato como abierto.',
      'evidence', '[]'::jsonb,
      'expires_at', checked_at_value + interval '6 hours',
      'decision_hash', repeat('c', 64)
    ),
    false
  );
  select count(*) into check_count
  from private.market_radar_eligibility_checks
  where attempt_id = reopen_attempt_id;
  select * into candidate_row
  from private.external_market_candidates where id = candidate_row.id;
  if check_count <> 1
     or candidate_row.current_eligibility_check_id is distinct from terminal_pointer
     or candidate_row.preparation_revision is distinct from terminal_revision
     or replay_result ->> 'error' is distinct from 'RADAR_CANDIDATE_RESOLVED' then
    raise exception 'RADAR_ELIGIBILITY_DOUBLE_CLICK_NOT_IDEMPOTENT: count=%, pointer_before=%, pointer_after=%, revision_before=%, revision_after=%, result=%',
      check_count, terminal_pointer, candidate_row.current_eligibility_check_id,
      terminal_revision, candidate_row.preparation_revision, replay_result;
  end if;

  candidate_input := candidate_input || jsonb_build_object(
    'external_id', expired_external_id_value,
    'external_market_id', 'ELIGIBILITY-V7-EXPIRED-' || suffix,
    'event_group_key', event_key_value || ':expired',
    'fingerprint', encode(extensions.digest(convert_to(expired_external_id_value, 'UTF8'), 'sha256'), 'hex'),
    'eligibility_checked_at', checked_at_value - interval '2 hours',
    'eligibility_expires_at', checked_at_value - interval '1 hour',
    'verified_at', checked_at_value - interval '2 hours',
    'verification_expires_at', checked_at_value - interval '1 hour'
  );
  check_input := check_input || jsonb_build_object(
    'attempt_id', expired_attempt_id,
    'external_id', expired_external_id_value,
    'event_group_key', event_key_value || ':expired',
    'checked_at', checked_at_value - interval '2 hours',
    'expires_at', checked_at_value - interval '1 hour',
    'decision_hash', repeat('d', 64)
  );
  upsert_result := public.upsert_market_radar_batch_with_eligibility_v1(
    'kalshi', 'radar-eligibility-v7-expired:' || suffix, 'atinara-radar-v2',
    jsonb_build_array(candidate_input), jsonb_build_array(check_input),
    'atinara-prediction-policy-v5',
    jsonb_build_object('status', 'available', 'is_cached', false)
  );
  select * into candidate_row
  from private.external_market_candidates
  where provider = 'kalshi' and external_id = expired_external_id_value;
  begin
    perform private.assert_market_radar_candidate_eligible_v1(
      candidate_row.id, candidate_row.preparation_revision
    );
    raise exception 'RADAR_EXPIRED_ELIGIBILITY_WAS_ACCEPTED';
  exception when sqlstate '55000' then
    if sqlerrm <> 'RADAR_ELIGIBILITY_EXPIRED' then raise; end if;
  end;

  select jsonb_build_object(
    'markets', (select coalesce(md5(string_agg(md5(to_jsonb(row_value)::text), '' order by to_jsonb(row_value)::text)), md5('')) from public.markets row_value),
    'predictions', (select coalesce(md5(string_agg(md5(to_jsonb(row_value)::text), '' order by to_jsonb(row_value)::text)), md5('')) from public.predictions row_value),
    'profiles', (select coalesce(md5(string_agg(md5(to_jsonb(row_value)::text), '' order by to_jsonb(row_value)::text)), md5('')) from public.profiles row_value),
    'maker', (select coalesce(md5(string_agg(md5(to_jsonb(row_value)::text), '' order by to_jsonb(row_value)::text)), md5('')) from public.market_maker_state row_value),
    'prices', (select coalesce(md5(string_agg(md5(to_jsonb(row_value)::text), '' order by to_jsonb(row_value)::text)), md5('')) from public.market_price_history row_value)
  ) into economic_after;
  if economic_after is distinct from economic_before then
    raise exception 'RADAR_ELIGIBILITY_CHANGED_ECONOMY: before=%, after=%',
      economic_before, economic_after;
  end if;
end;
$test$;

rollback;
