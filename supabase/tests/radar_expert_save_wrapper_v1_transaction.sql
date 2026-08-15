-- Regresión transaccional de Radar -> Editor -> borrador privado.
-- Recorre los wrappers públicos vigentes, prueba replay exacto y siempre revierte.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';

do $test$
declare
  admin_id uuid;
  suffix text := replace(gen_random_uuid()::text, '-', '');
  checked_at_value timestamptz := clock_timestamp();
  expert_external_id text := 'kalshi:EXPERT-SAVE-' || suffix;
  manual_external_id text := 'kalshi:MANUAL-SAVE-' || suffix;
  source_url text := 'https://store.steampowered.com/app/123456/atinara-save-wrapper/';
  source_evidence jsonb;
  expert_candidate_input jsonb;
  manual_candidate_input jsonb;
  expert_check_input jsonb;
  manual_check_input jsonb;
  upsert_result jsonb;
  expert_candidate private.external_market_candidates%rowtype;
  manual_candidate private.external_market_candidates%rowtype;
  expert_revision bigint;
  manual_revision bigint;
  sources jsonb;
  expert_question text;
  manual_question text;
  evaluation_at timestamptz := date_trunc('second', clock_timestamp() + interval '30 days');
  contract jsonb;
  expert_draft jsonb;
  manual_draft jsonb;
  expert_run_result jsonb;
  expert_run_id_value uuid;
  expert_save jsonb;
  expert_replay jsonb;
  manual_save jsonb;
  manual_replay jsonb;
  expert_draft_id uuid;
  manual_draft_id uuid;
  expert_revision_after bigint;
  manual_revision_after bigint;
  economic_before jsonb;
  economic_after jsonb;
  internal_writer regprocedure := to_regprocedure(
    'public.save_market_draft_from_radar_intelligence_without_revision_guard(uuid,uuid,bigint,jsonb,uuid,jsonb,jsonb)'
  );
  radar_writer regprocedure := to_regprocedure(
    'public.save_market_draft_from_radar(uuid,uuid,bigint,jsonb)'
  );
  expert_writer regprocedure := to_regprocedure(
    'public.save_market_draft_from_radar_intelligence(uuid,uuid,bigint,jsonb,uuid,jsonb,jsonb)'
  );
begin
  if internal_writer is null or radar_writer is null or expert_writer is null then
    raise exception 'TEST_RADAR_EXPERT_SAVE_SCHEMA_INCOMPLETE';
  end if;

  if position(
       'public.save_market_draft_from_radar_without_authoritative_fact_gate_v1('
       in pg_get_functiondef(internal_writer)
     ) = 0
     or position(
       'public.save_market_draft_from_radar('
       in pg_get_functiondef(internal_writer)
     ) > 0 then
    raise exception 'TEST_RADAR_EXPERT_SAVE_STILL_REENTERS_PUBLIC_WRAPPER';
  end if;

  if exists (
    select 1
    from pg_proc procedure
    join pg_roles owner on owner.oid = procedure.proowner
    where procedure.oid in (
      internal_writer::oid,
      radar_writer::oid,
      expert_writer::oid
    )
      and (
        owner.rolname is distinct from 'postgres'
        or not procedure.prosecdef
        or not (procedure.proconfig @> array['search_path=""']::text[])
      )
  ) then
    raise exception 'TEST_RADAR_EXPERT_SAVE_SECURITY_PROPERTIES_INVALID';
  end if;

  if has_function_privilege('anon', radar_writer, 'EXECUTE')
     or has_function_privilege('service_role', radar_writer, 'EXECUTE')
     or not has_function_privilege('authenticated', radar_writer, 'EXECUTE')
     or has_function_privilege('anon', expert_writer, 'EXECUTE')
     or has_function_privilege('service_role', expert_writer, 'EXECUTE')
     or not has_function_privilege('authenticated', expert_writer, 'EXECUTE')
     or has_function_privilege('anon', internal_writer, 'EXECUTE')
     or has_function_privilege('authenticated', internal_writer, 'EXECUTE')
     or has_function_privilege('service_role', internal_writer, 'EXECUTE') then
    raise exception 'TEST_RADAR_EXPERT_SAVE_ACL_INVALID';
  end if;

  select user_row.id into admin_id
  from auth.users user_row
  where coalesce((user_row.raw_app_meta_data ->> 'oraklo_admin')::boolean, false)
  order by user_row.created_at, user_row.id
  limit 1;
  if admin_id is null then
    raise exception 'TEST_RADAR_EXPERT_SAVE_ADMIN_REQUIRED';
  end if;

  select jsonb_build_object(
    'markets', (
      select coalesce(md5(string_agg(md5(to_jsonb(row_value)::text), ''
        order by to_jsonb(row_value)::text)), md5(''))
      from public.markets row_value
    ),
    'predictions', (
      select coalesce(md5(string_agg(md5(to_jsonb(row_value)::text), ''
        order by to_jsonb(row_value)::text)), md5(''))
      from public.predictions row_value
    ),
    'profiles', (
      select coalesce(md5(string_agg(md5(to_jsonb(row_value)::text), ''
        order by to_jsonb(row_value)::text)), md5(''))
      from public.profiles row_value
    ),
    'maker', (
      select coalesce(md5(string_agg(md5(to_jsonb(row_value)::text), ''
        order by to_jsonb(row_value)::text)), md5(''))
      from public.market_maker_state row_value
    ),
    'prices', (
      select coalesce(md5(string_agg(md5(to_jsonb(row_value)::text), ''
        order by to_jsonb(row_value)::text)), md5(''))
      from public.market_price_history row_value
    )
  ) into economic_before;

  source_evidence := jsonb_build_array(jsonb_build_object(
    'url', source_url,
    'title', 'Atinara save wrapper transaction fixture',
    'supports', 'Official fixture for a future event.',
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

  expert_candidate_input := jsonb_build_object(
    'provider', 'kalshi',
    'external_id', expert_external_id,
    'external_event_id', 'EXPERT-SAVE-' || suffix,
    'external_market_id', 'EXPERT-SAVE-' || suffix || '-YES',
    'external_url', 'https://kalshi.com/markets/expert-save/' || suffix,
    'external_event_url', 'https://kalshi.com/markets/expert-save/' || suffix,
    'external_market_url', 'https://kalshi.com/markets/expert-save/' || suffix,
    'event_group_key', 'kalshi:EXPERT-SAVE-' || suffix,
    'fingerprint', encode(extensions.digest(convert_to(expert_external_id, 'UTF8'), 'sha256'), 'hex'),
    'normalizer_version', 'atinara-radar-v2',
    'eligibility_policy_version', 'atinara-prediction-policy-v5',
    'eligibility_status', 'eligible',
    'eligibility_reason', 'Contrato futuro verificable.',
    'eligibility_checked_at', checked_at_value,
    'eligibility_expires_at', checked_at_value + interval '6 hours',
    'eligibility_evidence', source_evidence,
    'source_status', 'active',
    'source_title', 'Atinara expert save fixture',
    'source_question', 'Will the Atinara expert save fixture happen?',
    'source_close_at', checked_at_value + interval '30 days',
    'source_resolution_rules', 'Resolves from the official product source.',
    'source_resolution_url', source_url,
    'atinara_question', '¿Ocurrirá el fixture experto de Atinara?',
    'atinara_category', 'Lanzamientos',
    'atinara_resolution_criteria', 'Sí si la fuente oficial confirma el acontecimiento dentro del periodo.',
    'atinara_resolution_source_url', source_url,
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
  manual_candidate_input := expert_candidate_input || jsonb_build_object(
    'external_id', manual_external_id,
    'external_event_id', 'MANUAL-SAVE-' || suffix,
    'external_market_id', 'MANUAL-SAVE-' || suffix || '-YES',
    'external_url', 'https://kalshi.com/markets/manual-save/' || suffix,
    'external_event_url', 'https://kalshi.com/markets/manual-save/' || suffix,
    'external_market_url', 'https://kalshi.com/markets/manual-save/' || suffix,
    'event_group_key', 'kalshi:MANUAL-SAVE-' || suffix,
    'fingerprint', encode(extensions.digest(convert_to(manual_external_id, 'UTF8'), 'sha256'), 'hex'),
    'source_title', 'Atinara manual save fixture',
    'source_question', 'Will the Atinara manual save fixture happen?',
    'atinara_question', '¿Ocurrirá el fixture manual de Atinara?'
  );

  expert_check_input := jsonb_build_object(
    'attempt_id', gen_random_uuid(),
    'provider', 'kalshi',
    'external_id', expert_external_id,
    'event_group_key', 'kalshi:EXPERT-SAVE-' || suffix,
    'policy_version', 'atinara-prediction-policy-v5',
    'status', 'eligible',
    'reason', 'Contrato futuro verificable.',
    'evidence', source_evidence,
    'checked_at', checked_at_value,
    'expires_at', checked_at_value + interval '6 hours',
    'decision_hash', repeat('a', 64)
  );
  manual_check_input := expert_check_input || jsonb_build_object(
    'attempt_id', gen_random_uuid(),
    'external_id', manual_external_id,
    'event_group_key', 'kalshi:MANUAL-SAVE-' || suffix,
    'decision_hash', repeat('b', 64)
  );

  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  upsert_result := public.upsert_market_radar_batch_with_eligibility_v1(
    'kalshi',
    'radar-expert-save:' || suffix,
    'atinara-radar-v2',
    jsonb_build_array(expert_candidate_input, manual_candidate_input),
    jsonb_build_array(expert_check_input, manual_check_input),
    'atinara-prediction-policy-v5',
    jsonb_build_object('status', 'available', 'is_cached', false)
  );
  if not coalesce((upsert_result ->> 'ok')::boolean, false)
     or (upsert_result ->> 'accepted_count')::integer <> 2
     or (upsert_result ->> 'quarantined_count')::integer <> 0 then
    raise exception 'TEST_RADAR_EXPERT_SAVE_UPSERT_FAILED: %', upsert_result;
  end if;

  select * into expert_candidate
  from private.external_market_candidates
  where provider = 'kalshi' and external_id = expert_external_id;
  select * into manual_candidate
  from private.external_market_candidates
  where provider = 'kalshi' and external_id = manual_external_id;
  if expert_candidate.id is null or manual_candidate.id is null then
    raise exception 'TEST_RADAR_EXPERT_SAVE_CANDIDATES_MISSING';
  end if;
  expert_revision := expert_candidate.preparation_revision;
  manual_revision := manual_candidate.preparation_revision;

  expert_question := '¿Ocurrirá el fixture experto ' || suffix || ' antes del plazo?';
  manual_question := '¿Ocurrirá el fixture manual ' || suffix || ' antes del plazo?';
  sources := jsonb_build_array(jsonb_build_object(
    'url', source_url,
    'role', 'PRIMARY_RESOLUTION',
    'precedence', 1,
    'required', true,
    'fallback_condition', null
  ));
  contract := jsonb_build_object(
    'plan_version', 1,
    'contract_schema_version', 'atinara-resolution-contract-v1',
    'policy_version', 'atinara-market-constitution-v1',
    'canonical_statement', expert_question,
    'origin_type', 'radar_candidate',
    'origin_id', expert_candidate.id::text,
    'provider', 'official_web',
    'provider_adapter_version', 'atinara-radar-v2',
    'capture_strategy', 'manual_official_source',
    'evaluation_at', evaluation_at,
    'window_end', evaluation_at,
    'timezone', 'Europe/Madrid',
    'sources', sources
  );

  expert_draft := jsonb_build_object(
    'market_slug', 'radar-expert-save-' || left(suffix, 24),
    'question', expert_question,
    'subject', 'Fixture experto ' || suffix,
    'category', 'Lanzamientos',
    'yes_option', 'Sí',
    'no_option', 'No',
    'evaluation_period_label', 'Hasta el plazo de la prueba transaccional',
    'evaluation_ends_at', evaluation_at,
    'timezone', 'Europe/Madrid',
    'resolution_deadline', evaluation_at + interval '1 day',
    'yes_criteria', 'Sí si la fuente primaria confirma el acontecimiento dentro del plazo.',
    'no_criteria', 'No si termina el plazo sin confirmación oficial.',
    'edge_cases', 'Un aplazamiento no amplía automáticamente el plazo.',
    'primary_source', jsonb_build_object('url', source_url),
    'alternative_sources', '[]'::jsonb,
    'delay_treatment', 'Se conserva el plazo aprobado.',
    'cancellation_treatment', 'Una cancelación exige revisión humana.',
    'leak_treatment', 'Las filtraciones no resuelven el mercado.',
    'rename_treatment', 'Un cambio de nombre conserva la identidad inequívoca.',
    'assumptions', 'Solo cuenta la fuente primaria pública.',
    'public_criteria', 'La resolución aplica literalmente los criterios aprobados.',
    'description', 'Borrador sintético revertido por la prueba transaccional.',
    '_idempotency_key', gen_random_uuid(),
    '_change_origin', 'radar_expert_save_wrapper_transaction',
    '_timestamp_precision', 'milliseconds-v1',
    '_radar_preparation_revision', expert_revision::text,
    '_radar_eligibility_check_id', expert_candidate.current_eligibility_check_id
  );
  manual_draft := expert_draft || jsonb_build_object(
    'market_slug', 'radar-manual-save-' || left(suffix, 24),
    'question', manual_question,
    'subject', 'Fixture manual ' || suffix,
    '_idempotency_key', gen_random_uuid(),
    '_change_origin', 'radar_manual_save_wrapper_transaction',
    '_radar_preparation_revision', manual_revision::text,
    '_radar_eligibility_check_id', manual_candidate.current_eligibility_check_id
  );

  expert_run_result := public.record_market_expert_run(jsonb_build_object(
    'agent_type', 'market_editor',
    'origin_type', 'radar_candidate',
    'origin_id', expert_candidate.id::text,
    'provider', 'kalshi',
    'origin_fingerprint', encode(extensions.digest(convert_to(expert_external_id, 'UTF8'), 'sha256'), 'hex'),
    'analysis_fingerprint', encode(extensions.digest(convert_to('analysis-' || suffix, 'UTF8'), 'sha256'), 'hex'),
    'policy_version', 'atinara-market-constitution-v1',
    'schema_version', 'atinara-market-expert-v1',
    'model_version', 'transaction-regression',
    'status', 'completed',
    'decision', 'create',
    'integrity_status', 'pass',
    'forecastability_status', 'forecastable',
    'source_readiness', 'ready',
    'confidence', 100,
    'human_review_required', true,
    'result_json', jsonb_build_object(
      'origin_preparation_revision', expert_revision,
      'decision', 'create'
    ),
    'tool_summary', '[]'::jsonb,
    'analysis_mode', 'validate',
    'trigger_type', 'manual'
  ));
  expert_run_id_value := nullif(expert_run_result ->> 'id', '')::uuid;
  if expert_run_id_value is null then
    raise exception 'TEST_RADAR_EXPERT_SAVE_RUN_MISSING';
  end if;

  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', admin_id, 'role', 'authenticated')::text,
    true
  );

  manual_save := public.save_market_draft_from_radar(
    manual_candidate.id, null, null, manual_draft
  );
  manual_draft_id := nullif(manual_save #>> '{draft,id}', '')::uuid;
  select preparation_revision into manual_revision_after
  from private.external_market_candidates where id = manual_candidate.id;
  if manual_draft_id is null
     or coalesce((manual_save ->> 'idempotency_replay')::boolean, true)
     or manual_revision_after is distinct from manual_revision + 1
     or (select count(*) from private.market_drafts where radar_candidate_id = manual_candidate.id) <> 1 then
    raise exception 'TEST_RADAR_MANUAL_FIRST_SAVE_INVALID: %', manual_save;
  end if;

  manual_replay := public.save_market_draft_from_radar(
    manual_candidate.id, null, null, manual_draft
  );
  if not coalesce((manual_replay ->> 'idempotency_replay')::boolean, false)
     or nullif(manual_replay #>> '{draft,id}', '')::uuid is distinct from manual_draft_id
     or (select count(*) from private.market_drafts where radar_candidate_id = manual_candidate.id) <> 1
     or (select preparation_revision from private.external_market_candidates
         where id = manual_candidate.id) is distinct from manual_revision_after then
    raise exception 'TEST_RADAR_MANUAL_REPLAY_NOT_IDEMPOTENT: %', manual_replay;
  end if;

  expert_save := public.save_market_draft_from_radar_intelligence(
    expert_candidate.id,
    null,
    null,
    expert_draft,
    expert_run_id_value,
    contract,
    sources
  );
  expert_draft_id := nullif(expert_save #>> '{draft,id}', '')::uuid;
  select preparation_revision into expert_revision_after
  from private.external_market_candidates where id = expert_candidate.id;
  if expert_draft_id is null
     or coalesce((expert_save ->> 'idempotency_replay')::boolean, true)
     or expert_revision_after is distinct from expert_revision + 1
     or not coalesce((expert_save ->> 'atomic')::boolean, false)
     or coalesce((expert_save ->> 'published')::boolean, true)
     or coalesce((expert_save ->> 'resolved')::boolean, true)
     or (select count(*) from private.market_drafts where radar_candidate_id = expert_candidate.id) <> 1
     or (select count(*) from private.market_source_bindings binding_alias
         where binding_alias.draft_id = expert_draft_id
           and binding_alias.expert_run_id = expert_run_id_value
           and binding_alias.status <> 'superseded') <> 1 then
    raise exception 'TEST_RADAR_EXPERT_FIRST_SAVE_INVALID: %', expert_save;
  end if;

  expert_replay := public.save_market_draft_from_radar_intelligence(
    expert_candidate.id,
    null,
    null,
    expert_draft,
    expert_run_id_value,
    contract,
    sources
  );
  if not coalesce((expert_replay ->> 'idempotency_replay')::boolean, false)
     or nullif(expert_replay #>> '{draft,id}', '')::uuid is distinct from expert_draft_id
     or (select count(*) from private.market_drafts where radar_candidate_id = expert_candidate.id) <> 1
     or (select count(*) from private.market_source_bindings binding_alias
         where binding_alias.draft_id = expert_draft_id
           and binding_alias.expert_run_id = expert_run_id_value
           and binding_alias.status <> 'superseded') <> 1
     or (select preparation_revision from private.external_market_candidates
         where id = expert_candidate.id) is distinct from expert_revision_after then
    raise exception 'TEST_RADAR_EXPERT_REPLAY_NOT_IDEMPOTENT: %', expert_replay;
  end if;

  begin
    perform public.save_market_draft_from_radar_intelligence(
      expert_candidate.id,
      null,
      null,
      expert_draft,
      expert_run_id_value,
      contract || jsonb_build_object('capture_strategy', 'snapshot_at_deadline'),
      sources
    );
    raise exception 'TEST_RADAR_EXPERT_BINDING_CHANGE_REPLAY_ACCEPTED';
  exception when sqlstate '40001' then
    if sqlerrm <> 'RADAR_PREPARATION_REVISION_MISMATCH' then raise; end if;
  end;
  if (select count(*) from private.market_source_bindings binding_alias
      where binding_alias.draft_id = expert_draft_id
        and binding_alias.expert_run_id = expert_run_id_value) <> 1 then
    raise exception 'TEST_RADAR_EXPERT_BINDING_CHANGE_NOT_ROLLED_BACK';
  end if;

  begin
    perform public.save_market_draft_from_radar_intelligence(
      expert_candidate.id,
      null,
      null,
      expert_draft || jsonb_build_object('_idempotency_key', gen_random_uuid()),
      expert_run_id_value,
      contract,
      sources
    );
    raise exception 'TEST_RADAR_EXPERT_INCOMPATIBLE_REPLAY_ACCEPTED';
  exception when sqlstate '40001' then
    if sqlerrm <> 'RADAR_PREPARATION_REVISION_MISMATCH' then raise; end if;
  end;

  begin
    perform set_config(
      'request.jwt.claims',
      jsonb_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text,
      true
    );
    perform public.save_market_draft_from_radar_intelligence(
      expert_candidate.id,
      null,
      null,
      expert_draft,
      expert_run_id_value,
      contract,
      sources
    );
    raise exception 'TEST_RADAR_EXPERT_NON_ADMIN_ACCEPTED';
  exception when sqlstate '42501' then
    if sqlerrm <> 'ADMIN_REQUIRED' then raise; end if;
  end;

  if exists (
    select 1 from public.markets
    where id in (expert_draft ->> 'market_slug', manual_draft ->> 'market_slug')
  ) then
    raise exception 'TEST_RADAR_EXPERT_SAVE_PUBLISHED_MARKET';
  end if;

  select jsonb_build_object(
    'markets', (
      select coalesce(md5(string_agg(md5(to_jsonb(row_value)::text), ''
        order by to_jsonb(row_value)::text)), md5(''))
      from public.markets row_value
    ),
    'predictions', (
      select coalesce(md5(string_agg(md5(to_jsonb(row_value)::text), ''
        order by to_jsonb(row_value)::text)), md5(''))
      from public.predictions row_value
    ),
    'profiles', (
      select coalesce(md5(string_agg(md5(to_jsonb(row_value)::text), ''
        order by to_jsonb(row_value)::text)), md5(''))
      from public.profiles row_value
    ),
    'maker', (
      select coalesce(md5(string_agg(md5(to_jsonb(row_value)::text), ''
        order by to_jsonb(row_value)::text)), md5(''))
      from public.market_maker_state row_value
    ),
    'prices', (
      select coalesce(md5(string_agg(md5(to_jsonb(row_value)::text), ''
        order by to_jsonb(row_value)::text)), md5(''))
      from public.market_price_history row_value
    )
  ) into economic_after;
  if economic_after is distinct from economic_before then
    raise exception 'TEST_RADAR_EXPERT_SAVE_CHANGED_ECONOMY: before=%, after=%',
      economic_before, economic_after;
  end if;
end;
$test$;

rollback;
