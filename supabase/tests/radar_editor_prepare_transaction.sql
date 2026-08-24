-- Regresión transaccional Radar -> Agente Editor -> preparación.
-- Requiere la migración que añade preparation_revision y siempre hace ROLLBACK.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';

do $test$
declare
  admin_id uuid;
  suffix text := replace(gen_random_uuid()::text, '-', '');
  candidate_external_id text;
  cache_key text;
  payload jsonb;
  first_upsert jsonb;
  repeated_upsert jsonb;
  candidate_row private.external_market_candidates%rowtype;
  first_id uuid;
  first_revision bigint;
  safe_payload jsonb;
  reservation jsonb;
  applied jsonb;
  replay jsonb;
  revised_revision bigint;
  expert_run jsonb;
  expert_run_id uuid;
  idempotency_key uuid := gen_random_uuid();
  evaluation_at timestamptz;
  question_value text;
  sources jsonb;
  contract jsonb;
  draft_payload jsonb;
  first_save jsonb;
  replayed_save jsonb;
  saved_draft_id uuid;
  revision_after_save bigint;
  exact_duplicate_id uuid := gen_random_uuid();
  semantic_duplicate_id uuid := gen_random_uuid();
  filtered_matches jsonb;
begin
  select user_row.id into admin_id
  from auth.users user_row
  where coalesce((user_row.raw_app_meta_data ->> 'oraklo_admin')::boolean, false)
  order by user_row.created_at
  limit 1;
  if admin_id is null then raise exception 'TEST_ADMIN_REQUIRED'; end if;

  candidate_external_id := 'kalshi:ATINARA-REGRESSION-' || suffix;
  cache_key := 'transaction-regression:' || suffix;
  payload := jsonb_build_object(
    'provider', 'kalshi',
    'external_id', candidate_external_id,
    'external_event_id', 'ATINARA-REGRESSION-' || suffix,
    'external_market_id', 'ATINARA-REGRESSION-' || suffix || '-YES',
    'external_url', 'https://kalshi.com/markets/atinara-regression/' || suffix,
    'external_event_url', 'https://kalshi.com/markets/atinara-regression/' || suffix,
    'external_market_url', 'https://kalshi.com/markets/atinara-regression/' || suffix,
    'event_group_key', 'kalshi:ATINARA-REGRESSION-' || suffix,
    'fingerprint', 'transaction-fingerprint-' || suffix,
    'normalizer_version', 'atinara-radar-v2',
    'eligibility_policy_version', 'atinara-prediction-policy-v4',
    'source_status', 'active',
    'source_title', 'Atinara regression release ' || suffix,
    'source_question', 'Will Atinara regression release ' || suffix || ' happen before 2027?',
    'source_description', 'Synthetic transaction-only candidate.',
    'source_close_at', now() + interval '30 days',
    'source_resolution_rules', 'Resolves Yes only if the official source confirms the synthetic event.',
    'source_resolution_url', 'https://www.playstation.com/en-us/',
    'source_probability_yes', 50,
    'source_volume_total', 100,
    'source_liquidity', 50,
    'atinara_question', '¿Se confirmará el evento de regresión ' || suffix || ' antes de 2027?',
    'atinara_category', 'Lanzamientos',
    'atinara_resolution_criteria', 'Sí si la fuente oficial confirma el evento sintético dentro del periodo.',
    'atinara_resolution_source_url', 'https://www.playstation.com/en-us/',
    'hard_reject_reasons', '[]'::jsonb,
    'warnings', '[]'::jsonb,
    'duplicate_matches', '[]'::jsonb,
    'family_matches', '[]'::jsonb,
    'verification_status', 'verified_open',
    'verification_reason_code', null,
    'verification_reason', 'Comprobación sintética vigente para la prueba transaccional.',
    'verified_at', now(),
    'verification_expires_at', now() + interval '2 hours',
    'verification_evidence', jsonb_build_array(jsonb_build_object(
      'title', 'Fuente oficial de prueba',
      'url', 'https://www.playstation.com/en-us/',
      'source_type', 'official'
    )),
    'verification_confidence', 100,
    'quality_status', 'fit',
    'quality_score', 90,
    'score_breakdown', jsonb_build_object(
      'popularity', 10, 'relevance', 20, 'clarity', 20,
      'recency', 10, 'uncertainty', 10, 'novelty', 20, 'verification', 100
    ),
    'state', 'available',
    'fetched_at', now(),
    'cache_expires_at', now() + interval '2 hours',
    -- Debe ser ignorado por el payload seguro; la revisión autoritativa vive en la fila.
    'preparation_revision', 999999
  );

  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', admin_id, 'role', 'service_role')::text,
    true
  );
  first_upsert := public.upsert_market_radar_batch_v2(
    'kalshi', cache_key, 'atinara-radar-v2', jsonb_build_array(payload),
    jsonb_build_object('status', 'available', 'is_cached', false)
  );
  if not coalesce((first_upsert ->> 'ok')::boolean, false)
     or (first_upsert ->> 'upserted')::integer <> 1 then
    raise exception 'TEST_FIRST_UPSERT_FAILED: %', first_upsert;
  end if;

  select * into candidate_row
  from private.external_market_candidates candidate_alias
  where candidate_alias.provider = 'kalshi'
    and candidate_alias.external_id = candidate_external_id;
  if not found then raise exception 'TEST_CANDIDATE_NOT_PERSISTED'; end if;
  first_id := candidate_row.id;
  first_revision := candidate_row.preparation_revision;
  if first_revision is null then raise exception 'TEST_PREPARATION_REVISION_MISSING'; end if;

  -- Repite el UPSERT con una autocoincidencia y valores de identidad/revisión falsificados.
  -- La fila debe conservar id, revisión, estado y verificación, sin bloquearse a sí misma.
  payload := payload || jsonb_build_object(
    'id', gen_random_uuid(),
    'duplicate_matches', jsonb_build_array(jsonb_build_object(
      'id', first_id,
      'relationship', 'exact_duplicate',
      'blocking', true
    )),
    'hard_reject_reasons', jsonb_build_array('DUPLICATE_MARKET')
  );
  repeated_upsert := public.upsert_market_radar_batch_v2(
    'kalshi', cache_key, 'atinara-radar-v2', jsonb_build_array(payload),
    jsonb_build_object('status', 'cached', 'is_cached', true)
  );
  if not coalesce((repeated_upsert ->> 'ok')::boolean, false)
     or (select count(*) from private.external_market_candidates candidate_alias
         where candidate_alias.provider = 'kalshi'
           and candidate_alias.external_id = candidate_external_id) <> 1 then
    raise exception 'TEST_REPEATED_UPSERT_NOT_IDEMPOTENT: %', repeated_upsert;
  end if;

  select * into candidate_row
  from private.external_market_candidates candidate_alias
  where candidate_alias.provider = 'kalshi'
    and candidate_alias.external_id = candidate_external_id;
  safe_payload := private.market_radar_safe_payload(candidate_row);
  if candidate_row.id <> first_id
     or candidate_row.preparation_revision <> first_revision
     or candidate_row.state <> 'available'
     or candidate_row.verification_status <> 'verified_open'
     or candidate_row.duplicate_matches <> '[]'::jsonb then
    raise exception 'TEST_REPEATED_UPSERT_CHANGED_AUTHORITATIVE_STATE';
  end if;
  if (safe_payload ->> 'id')::uuid <> first_id
     or (safe_payload ->> 'preparation_revision')::bigint <> first_revision
     or safe_payload ->> 'state' <> 'available'
     or safe_payload ->> 'verification_status' <> 'verified_open'
     or coalesce(safe_payload -> 'duplicate_matches', '[]'::jsonb) <> '[]'::jsonb
     or coalesce(safe_payload -> 'hard_reject_reasons', '[]'::jsonb) @> '["DUPLICATE_MARKET"]'::jsonb then
    raise exception 'TEST_SAFE_PAYLOAD_TRUSTED_NORMALIZED_SPOOF: %', safe_payload;
  end if;

  -- Los matches históricos y los procedentes de mercados/borradores no siempre
  -- incluyen provider/external_id. La exclusión null-safe debe retirar solo el
  -- self estable y conservar ambos tipos de duplicado real como bloqueantes.
  filtered_matches := private.market_candidate_without_stable_self(
    jsonb_build_array(
      jsonb_build_object(
        'id', first_id,
        'relationship', 'exact_duplicate',
        'blocking', true
      ),
      jsonb_build_object(
        'id', exact_duplicate_id,
        'relationship', 'exact_duplicate',
        'blocking', true
      ),
      jsonb_build_object(
        'id', semantic_duplicate_id,
        'relationship', 'semantic_duplicate',
        'blocking', true
      )
    ),
    first_id,
    'kalshi',
    candidate_external_id
  );
  if jsonb_array_length(filtered_matches) <> 2
     or filtered_matches @> jsonb_build_array(jsonb_build_object('id', first_id))
     or not (filtered_matches @> jsonb_build_array(jsonb_build_object(
       'id', exact_duplicate_id,
       'relationship', 'exact_duplicate',
       'blocking', true
     )))
     or not (filtered_matches @> jsonb_build_array(jsonb_build_object(
       'id', semantic_duplicate_id,
       'relationship', 'semantic_duplicate',
       'blocking', true
     )))
     or not private.market_candidate_has_blocking_duplicate(filtered_matches, first_id) then
    raise exception 'TEST_REAL_DUPLICATE_WITHOUT_PROVIDER_WAS_REMOVED: %', filtered_matches;
  end if;

  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', admin_id, 'role', 'authenticated')::text,
    true
  );
  reservation := public.reserve_market_radar_candidate_for_prepare(
    first_id, 'atinara-radar-v2', now()
  );
  if not coalesce((reservation ->> 'ok')::boolean, false)
     or (reservation ->> 'candidate_id')::uuid <> first_id
     or (reservation ->> 'preparation_revision')::bigint <> first_revision then
    raise exception 'TEST_RESERVATION_FAILED: %', reservation;
  end if;

  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', admin_id, 'role', 'service_role')::text,
    true
  );
  applied := public.apply_market_radar_prepare_verification(
    first_id,
    first_revision,
    'atinara-radar-v2',
    now(),
    payload || jsonb_build_object(
      'verified_at', now(),
      'verification_expires_at', now() + interval '2 hours',
      'cache_expires_at', now() + interval '2 hours',
      'duplicate_matches', '[]'::jsonb,
      'hard_reject_reasons', '[]'::jsonb,
      'verification_status', 'verified_open'
    )
  );
  if not coalesce((applied ->> 'ok')::boolean, false) then
    raise exception 'TEST_ATOMIC_VERIFICATION_APPLY_FAILED: %', applied;
  end if;
  revised_revision := (applied -> 'candidate' ->> 'preparation_revision')::bigint;
  if revised_revision <> first_revision + 1 then
    raise exception 'TEST_PREPARATION_REVISION_NOT_INCREMENTED: %', applied;
  end if;

  select * into candidate_row
  from private.external_market_candidates candidate_alias
  where candidate_alias.id = first_id;
  safe_payload := private.market_radar_safe_payload(candidate_row);
  if candidate_row.preparation_revision <> revised_revision
     or (safe_payload ->> 'preparation_revision')::bigint <> revised_revision
     or safe_payload ->> 'verification_status' <> 'verified_open' then
    raise exception 'TEST_REVISED_SAFE_PAYLOAD_INCONSISTENT: %', safe_payload;
  end if;

  replay := public.apply_market_radar_prepare_verification(
    first_id,
    first_revision,
    'atinara-radar-v2',
    now(),
    payload
  );
  if coalesce((replay ->> 'ok')::boolean, false)
     or replay ->> 'error' <> 'PREPARATION_REVISION_MISMATCH' then
    raise exception 'TEST_STALE_REVISION_REPLAY_ACCEPTED: %', replay;
  end if;
  if (select preparation_revision from private.external_market_candidates where id = first_id) <> revised_revision then
    raise exception 'TEST_STALE_REPLAY_MUTATED_REVISION';
  end if;

  -- El guardado consume una revisión al pasar available -> prepared. Una
  -- repetición byte a byte idéntica debe llegar al replay canónico ya guardado,
  -- no confundirse con una sesión vieja ni crear otro borrador.
  evaluation_at := date_trunc('second', now() + interval '30 days');
  question_value := '¿Se confirmará el evento de regresión ' || suffix || ' antes del plazo?';
  sources := jsonb_build_array(jsonb_build_object(
    'url', 'https://www.playstation.com/en-us/',
    'role', 'PRIMARY_RESOLUTION',
    'precedence', 1,
    'required', true,
    'fallback_condition', null
  ));
  contract := jsonb_build_object(
    'plan_version', 1,
    'contract_schema_version', 'atinara-resolution-contract-v1',
    'policy_version', 'atinara-market-constitution-v1',
    'canonical_statement', question_value,
    'origin_type', 'radar_candidate',
    'origin_id', first_id::text,
    'provider', 'official_web',
    'provider_adapter_version', 'atinara-radar-v2',
    'capture_strategy', 'manual_official_source',
    'evaluation_at', evaluation_at,
    'window_end', evaluation_at,
    'timezone', 'Europe/Madrid',
    'sources', sources
  );
  draft_payload := jsonb_build_object(
    'market_slug', 'radar-regression-' || left(suffix, 24),
    'question', question_value,
    'subject', 'Evento de regresión ' || suffix,
    'category', 'Lanzamientos',
    'yes_option', 'Sí',
    'no_option', 'No',
    'evaluation_period_label', 'Hasta el plazo de la prueba transaccional',
    'evaluation_ends_at', evaluation_at,
    'timezone', 'Europe/Madrid',
    'resolution_deadline', evaluation_at + interval '1 day',
    'yes_criteria', 'Sí si la fuente primaria confirma el evento dentro del plazo.',
    'no_criteria', 'No si el plazo termina sin esa confirmación oficial.',
    'edge_cases', 'Los aplazamientos no amplían el plazo de forma automática.',
    'primary_source', jsonb_build_object('url', 'https://www.playstation.com/en-us/'),
    'alternative_sources', '[]'::jsonb,
    'delay_treatment', 'Se conserva el plazo aprobado.',
    'cancellation_treatment', 'Una cancelación exige revisión humana.',
    'leak_treatment', 'Las filtraciones no resuelven el mercado.',
    'rename_treatment', 'Un cambio de nombre conserva la identidad si es inequívoco.',
    'assumptions', 'Solo cuenta la fuente primaria pública.',
    'public_criteria', 'La resolución aplica literalmente los criterios aprobados.',
    'description', 'Borrador sintético creado y revertido por la prueba transaccional.',
    '_idempotency_key', idempotency_key,
    '_change_origin', 'radar_editor_transaction_regression',
    '_timestamp_precision', 'milliseconds-v1',
    '_radar_preparation_revision', revised_revision::text
  );
  expert_run := public.record_market_expert_run(jsonb_build_object(
    'agent_type', 'market_editor',
    'origin_type', 'radar_candidate',
    'origin_id', first_id::text,
    'provider', 'kalshi',
    'origin_fingerprint', 'origin-' || suffix,
    'analysis_fingerprint', 'analysis-' || suffix,
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
      'origin_preparation_revision', revised_revision,
      'decision', 'create'
    ),
    'tool_summary', '[]'::jsonb,
    'analysis_mode', 'validate',
    'trigger_type', 'manual'
  ));
  expert_run_id := (expert_run ->> 'id')::uuid;
  if expert_run_id is null then raise exception 'TEST_EXPERT_RUN_NOT_PERSISTED'; end if;

  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', admin_id, 'role', 'authenticated')::text,
    true
  );
  first_save := public.save_market_draft_from_radar_intelligence_pre_parent_reconciliation_v1(
    first_id, null, null, draft_payload, expert_run_id, contract, sources
  );
  saved_draft_id := (first_save -> 'draft' ->> 'id')::uuid;
  select preparation_revision into revision_after_save
  from private.external_market_candidates
  where id = first_id;
  if saved_draft_id is null
     or coalesce((first_save ->> 'idempotency_replay')::boolean, true)
     or revision_after_save <> revised_revision + 1 then
    raise exception 'TEST_FIRST_EXPERT_SAVE_INVALID: %', first_save;
  end if;

  replayed_save := public.save_market_draft_from_radar_intelligence_pre_parent_reconciliation_v1(
    first_id, null, null, draft_payload, expert_run_id, contract, sources
  );
  if not coalesce((replayed_save ->> 'idempotency_replay')::boolean, false)
     or (replayed_save -> 'draft' ->> 'id')::uuid <> saved_draft_id
     or (select count(*) from private.market_drafts where radar_candidate_id = first_id) <> 1
     or (select preparation_revision from private.external_market_candidates where id = first_id) <> revision_after_save then
    raise exception 'TEST_EXPERT_SAVE_REPLAY_NOT_IDEMPOTENT: %', replayed_save;
  end if;
end;
$test$;

rollback;
