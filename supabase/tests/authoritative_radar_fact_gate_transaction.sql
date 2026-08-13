-- Regresion de contrato para la puerta factual autoritativa.
-- Se ejecuta solo contra una base local/de prueba y siempre termina en ROLLBACK.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';

do $privilege_contract$
begin
  if has_table_privilege(
       'service_role', 'private.external_market_candidates', 'SELECT'
     ) or has_table_privilege(
       'service_role', 'private.external_market_candidates', 'INSERT'
     ) or has_table_privilege(
       'service_role', 'private.external_market_candidates', 'UPDATE'
     ) or has_table_privilege(
       'service_role', 'private.external_market_candidates', 'DELETE'
     ) then
    raise exception 'TEST_SERVICE_ROLE_CANDIDATE_DML_PRIVILEGE_PRESENT';
  end if;
  if has_table_privilege(
       'service_role', 'private.market_radar_fact_checks', 'SELECT'
     ) or has_table_privilege(
       'service_role', 'private.market_radar_fact_checks', 'INSERT'
     ) or has_table_privilege(
       'service_role', 'private.market_radar_fact_checks', 'UPDATE'
     ) or has_table_privilege(
       'service_role', 'private.market_radar_fact_checks', 'DELETE'
     ) then
    raise exception 'TEST_SERVICE_ROLE_FACT_DML_PRIVILEGE_PRESENT';
  end if;
  if has_sequence_privilege(
       'service_role', 'private.market_radar_fact_checks_id_seq', 'USAGE'
     ) or has_sequence_privilege(
       'service_role', 'private.market_radar_fact_checks_id_seq', 'SELECT'
     ) or has_sequence_privilege(
       'service_role', 'private.market_radar_fact_checks_id_seq', 'UPDATE'
  ) then
    raise exception 'TEST_SERVICE_ROLE_FACT_SEQUENCE_PRIVILEGE_PRESENT';
  end if;
  if has_table_privilege(
       'service_role', 'private.market_drafts', 'SELECT'
     ) or has_table_privilege(
       'service_role', 'private.market_drafts', 'INSERT'
     ) or has_table_privilege(
       'service_role', 'private.market_drafts', 'UPDATE'
     ) or has_table_privilege(
       'service_role', 'private.market_drafts', 'DELETE'
     ) then
    raise exception 'TEST_SERVICE_ROLE_DRAFT_DML_PRIVILEGE_PRESENT';
  end if;
end;
$privilege_contract$;

-- Comprueba el rol SQL real, no solo request.jwt.claims. Cada sentencia debe
-- fallar por ACL antes de poder leer, fabricar o enlazar evidencia factual.
select set_config(
  'request.jwt.claims',
  jsonb_build_object('sub', gen_random_uuid(), 'role', 'service_role')::text,
  true
);
set local role service_role;

do $service_role_contract$
declare
  registry_result jsonb;
begin
  begin
    perform 1 from private.external_market_candidates limit 1;
    raise exception 'TEST_SERVICE_ROLE_RAW_CANDIDATE_SELECT_ACCEPTED';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into private.external_market_candidates default values;
    raise exception 'TEST_SERVICE_ROLE_RAW_CANDIDATE_INSERT_ACCEPTED';
  exception when insufficient_privilege then null;
  end;
  begin
    update private.external_market_candidates set updated_at = now() where false;
    raise exception 'TEST_SERVICE_ROLE_RAW_CANDIDATE_UPDATE_ACCEPTED';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from private.external_market_candidates where false;
    raise exception 'TEST_SERVICE_ROLE_RAW_CANDIDATE_DELETE_ACCEPTED';
  exception when insufficient_privilege then null;
  end;
  begin
    perform 1 from private.market_radar_fact_checks limit 1;
    raise exception 'TEST_SERVICE_ROLE_RAW_FACT_SELECT_ACCEPTED';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into private.market_radar_fact_checks default values;
    raise exception 'TEST_SERVICE_ROLE_RAW_FACT_INSERT_ACCEPTED';
  exception when insufficient_privilege then null;
  end;
  begin
    update private.market_radar_fact_checks set reason = 'sonar-permission-test' where false;
    raise exception 'TEST_SERVICE_ROLE_RAW_FACT_UPDATE_ACCEPTED';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from private.market_radar_fact_checks where false;
    raise exception 'TEST_SERVICE_ROLE_RAW_FACT_DELETE_ACCEPTED';
  exception when insufficient_privilege then null;
  end;
  begin
    perform nextval('private.market_radar_fact_checks_id_seq'::regclass);
    raise exception 'TEST_SERVICE_ROLE_RAW_FACT_SEQUENCE_ACCEPTED';
  exception when insufficient_privilege then null;
  end;
  begin
    perform 1 from private.market_drafts limit 1;
    raise exception 'TEST_SERVICE_ROLE_RAW_DRAFT_SELECT_ACCEPTED';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into private.market_drafts default values;
    raise exception 'TEST_SERVICE_ROLE_RAW_DRAFT_INSERT_ACCEPTED';
  exception when insufficient_privilege then null;
  end;
  begin
    update private.market_drafts set radar_candidate_id = null where false;
    raise exception 'TEST_SERVICE_ROLE_RAW_DRAFT_UPDATE_ACCEPTED';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from private.market_drafts where false;
    raise exception 'TEST_SERVICE_ROLE_RAW_DRAFT_DELETE_ACCEPTED';
  exception when insufficient_privilege then null;
  end;

  -- Las RPCs mínimas sí siguen siendo ejecutables bajo el mismo rol SQL.
  registry_result := public.get_market_radar_authoritative_source_domains_v1();
  if jsonb_typeof(registry_result) <> 'array'
     or jsonb_array_length(registry_result) = 0 then
    raise exception 'TEST_SERVICE_ROLE_AUTHORIZED_RPC_FAILED: %', registry_result;
  end if;
  begin
    perform public.get_market_radar_candidate_for_revalidation_v1(gen_random_uuid());
    raise exception 'TEST_RAW_REVALIDATION_MISSING_ID_DID_NOT_FAIL';
  exception when sqlstate 'P0001' then
    if position('RADAR_CANDIDATE_NOT_FOUND' in sqlerrm) = 0 then raise; end if;
  end;
end;
$service_role_contract$;

reset role;

do $test$
declare
  admin_id uuid;
  legacy_result jsonb;
  registry_result jsonb;
  suffix text := replace(gen_random_uuid()::text, '-', '');
  external_id_value text;
  cache_external_id text;
  expired_external_id text;
  candidate_payload jsonb;
  cache_candidate_payload jsonb;
  expired_candidate_payload jsonb;
  context_snapshot_value jsonb;
  cache_context_snapshot jsonb;
  expired_context_snapshot jsonb;
  source_snapshot_value jsonb;
  unresolved_source_snapshot_value jsonb;
  expired_source_snapshot jsonb;
  fact_check_value jsonb;
  cache_fact_check jsonb;
  expired_fact_check jsonb;
  upsert_result jsonb;
  list_result jsonb;
  detail_result jsonb;
  prepare_result jsonb;
  resolved_result jsonb;
  replay_result jsonb;
  rejected_result jsonb;
  reservation_result jsonb;
  save_result jsonb;
  confirmation_result jsonb;
  publication_result jsonb;
  scheduler_result jsonb;
  draft_payload jsonb;
  saved_draft_id uuid;
  saved_provenance jsonb;
  evaluation_at timestamptz;
  discovery_fact_id bigint;
  prepare_fact_id bigint;
  repeated_attempt_id uuid;
  fact_count_before bigint;
  review_report_id bigint;
  effective_review_id_value bigint;
  expected_failure boolean;
  candidate_row private.external_market_candidates%rowtype;
  fact_row private.market_radar_fact_checks%rowtype;
  draft_row private.market_drafts%rowtype;
  revision_value bigint;
  orphan_candidate_id uuid;
  review_validator_version text;
  review_policy_version text;
  review_schema_version text;
begin
  select user_row.id into admin_id
  from auth.users user_row
  where coalesce((user_row.raw_app_meta_data ->> 'oraklo_admin')::boolean, false)
  order by user_row.created_at
  limit 1;
  if admin_id is null then raise exception 'TEST_ADMIN_REQUIRED'; end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'private'
      and table_name = 'external_market_candidates'
      and column_name = 'current_fact_check_id'
  ) then raise exception 'TEST_CURRENT_FACT_LINK_MISSING'; end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'private'
      and table_name = 'market_radar_fact_checks'
      and column_name in ('candidate_id', 'preparation_revision', 'purpose', 'context_sha256', 'source_sha256')
    group by table_schema, table_name
    having count(*) = 5
  ) then raise exception 'TEST_FACT_SNAPSHOT_COLUMNS_MISSING'; end if;

  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'private.market_radar_fact_checks'::regclass
      and tgname = 'reject_market_radar_fact_check_mutation'
      and not tgisinternal
  ) then raise exception 'TEST_APPEND_ONLY_TRIGGER_MISSING'; end if;

  if has_function_privilege('authenticated',
       'public.upsert_market_radar_batch_v2(text,text,text,jsonb,jsonb)', 'EXECUTE')
     or has_function_privilege('service_role',
       'public.upsert_market_radar_batch_v2(text,text,text,jsonb,jsonb)', 'EXECUTE') then
    raise exception 'TEST_LEGACY_UPSERT_STILL_EXECUTABLE';
  end if;
  if has_function_privilege('authenticated',
       'public.list_market_radar_candidates(text,text,text,text,text,text,integer,integer)', 'EXECUTE') then
    raise exception 'TEST_LEGACY_RADAR_LIST_STILL_EXECUTABLE';
  end if;
  if not has_function_privilege('authenticated',
       'public.list_market_radar_candidates_v2(text,text,text,text,text,text,integer,integer)', 'EXECUTE')
     or not has_function_privilege('authenticated',
       'public.get_market_radar_candidate(uuid)', 'EXECUTE')
     or has_function_privilege('authenticated',
       'public.get_market_radar_candidate_for_revalidation_v1(uuid)', 'EXECUTE')
     or not has_function_privilege('service_role',
       'public.get_market_radar_candidate_for_revalidation_v1(uuid)', 'EXECUTE')
     or has_function_privilege('authenticated',
       'public.apply_market_radar_revalidation_fact_v1(uuid,bigint,text,timestamp with time zone,jsonb,jsonb)', 'EXECUTE')
     or not has_function_privilege('service_role',
       'public.apply_market_radar_revalidation_fact_v1(uuid,bigint,text,timestamp with time zone,jsonb,jsonb)', 'EXECUTE')
     or not has_function_privilege('authenticated',
       'public.get_market_intelligence_origin(text,text)', 'EXECUTE') then
    raise exception 'TEST_RADAR_READ_PRIVILEGES_INVALID';
  end if;

  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', gen_random_uuid(), 'role', 'service_role')::text,
    true
  );
  legacy_result := public.apply_market_radar_prepare_verification(
    gen_random_uuid(), 1, 'atinara-radar-v2', now(), '{}'::jsonb
  );
  if legacy_result ->> 'error' <> 'FACT_CHECK_REQUIRED' then
    raise exception 'TEST_LEGACY_PREPARE_BYPASS: %', legacy_result;
  end if;

  registry_result := public.get_market_radar_authoritative_source_domains_v1();
  if jsonb_typeof(registry_result) <> 'array'
     or jsonb_array_length(registry_result) = 0
     or exists (
       select 1 from jsonb_array_elements(registry_result) item
       where coalesce(item ->> 'authority_tier', '') <> 'primary'
          or coalesce(item ->> 'canonical_domain', '') = ''
     ) then
    raise exception 'TEST_AUTHORITATIVE_SOURCE_REGISTRY_INVALID: %', registry_result;
  end if;

  if private.market_radar_sources_authorized_v1(jsonb_build_array(jsonb_build_object(
       'url', 'https://polymarket.com/event/open-market',
       'source_type', 'provider'
     ))) then
    raise exception 'TEST_PROVIDER_OPEN_WAS_ACCEPTED_AS_EXTERNAL_FACT';
  end if;
  if not private.market_radar_provider_fact_authorized_v1(jsonb_build_array(jsonb_build_object(
       'url', 'https://polymarket.com/event/resolved-market',
       'source_type', 'provider',
       'retrieval_status', 'verified_provider_api',
       'evidence_basis', 'provider_api',
       'claim_status', 'direct', 'direct_claim', true,
       'claim_verifiable', true,
       'supports', 'Result: Yes',
       'supported_reason_codes', jsonb_build_array('EVENT_ALREADY_RESOLVED'),
       'supported_fact_statuses', jsonb_build_array('fully_resolved')
     ))) then
    raise exception 'TEST_PROVIDER_TERMINAL_SOURCE_NOT_RECOGNIZED';
  end if;
  if private.market_radar_provider_fact_authorized_v1(jsonb_build_array(
       jsonb_build_object(
         'url', 'https://polymarket.com/event/resolved-market',
         'source_type', 'provider',
         'retrieval_status', 'verified_provider_api',
         'evidence_basis', 'provider_api',
         'claim_status', 'direct', 'direct_claim', true,
         'claim_verifiable', true,
         'supports', 'Result: Yes',
         'supported_reason_codes', jsonb_build_array('EVENT_ALREADY_RESOLVED')
       ),
       jsonb_build_object(
         'url', 'https://untrusted.example/result',
         'source_type', 'public'
       )
     )) then
    raise exception 'TEST_PROVIDER_FACT_ACCEPTED_UNTRUSTED_COMPANION';
  end if;

  external_id_value := 'kalshi:FACT-GATE-' || suffix;
  context_snapshot_value := jsonb_build_object(
    'fact_context_schema_version', 'atinara-radar-fact-context-v2',
    'provider', 'kalshi', 'external_id', external_id_value,
    'external_event_id', 'FACT-GATE-' || suffix,
    'external_market_id', 'FACT-GATE-' || suffix || '-YES',
    'event_group_key', 'kalshi:FACT-GATE-' || suffix,
    'source_status', 'active', 'source_result', null,
    'source_settled_at', null,
    'canonical_event_children', jsonb_build_array(jsonb_build_object(
      'market_id', 'FACT-GATE-' || suffix || '-YES',
      'question', 'Will the transaction fixture happen?',
      'status', 'active', 'result', null
    )),
    'canonical_event_children_total', 1,
    'canonical_event_children_complete', true
  );
  source_snapshot_value := jsonb_build_array(jsonb_build_object(
    'title', 'Official transaction fixture',
    'url', 'https://www.playstation.com/en-us/',
    'source_type', 'official',
    'supports', 'The transaction fixture will be announced on September 1, 2026.',
    'retrieved_at', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'retrieval_status', 'verified_content',
    'evidence_basis', 'retrieved_content',
    'parser_version', 'atinara-official-content-v1',
    'content_sha256', repeat('a', 64),
    'content_type', 'text/html',
    'claim_status', 'direct', 'direct_claim', true,
    'claim_verifiable', true, 'relevance_score', 100,
    'supported_reason_codes', '[]'::jsonb,
    'supported_fact_statuses', jsonb_build_array('unresolved'),
    'supported_contract_kinds', jsonb_build_array('announcement'),
    'unresolved_proof', true,
    'unresolved_proof_basis', 'official_future_date_v1',
    'unresolved_until', to_char((now() + interval '20 days') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'unresolved_proof_excerpt', 'The transaction fixture will be announced on September 1, 2026.',
    'unresolved_proof_excerpt_sha256', encode(extensions.digest(
      convert_to('The transaction fixture will be announced on September 1, 2026.', 'UTF8'), 'sha256'
    ), 'hex')
  ));
  unresolved_source_snapshot_value := source_snapshot_value;
  if not private.market_radar_sources_authorized_v1(source_snapshot_value)
     or not private.market_radar_sources_nonterminal_v1(source_snapshot_value, now()) then
    raise exception 'TEST_DETERMINISTIC_UNRESOLVED_PROOF_REJECTED';
  end if;
  if private.market_radar_sources_nonterminal_v1(
       jsonb_build_array((source_snapshot_value -> 0)
         - 'unresolved_proof'
         - 'unresolved_proof_basis'
         - 'unresolved_until'
         - 'unresolved_proof_excerpt'
         - 'unresolved_proof_excerpt_sha256'),
       now()
     ) then
    raise exception 'TEST_ABSENCE_OF_TERMINAL_WAS_ACCEPTED_AS_UNRESOLVED_PROOF';
  end if;
  if private.market_radar_sources_authorized_v1(jsonb_build_array(
       (source_snapshot_value -> 0) || jsonb_build_object(
         'retrieval_status', 'search_snippet', 'evidence_basis', 'snippet'
       )
     )) then
    raise exception 'TEST_SNIPPET_WAS_ACCEPTED_AS_RETRIEVED_CONTENT';
  end if;
  if private.market_radar_sources_authorized_v1(jsonb_build_array(
       (source_snapshot_value -> 0) || jsonb_build_object(
         'supports', 'Our prediction says the fixture could be announced later.'
       )
     )) then
    raise exception 'TEST_MODEL_MODAL_EVIDENCE_ACCEPTED';
  end if;
  if private.market_radar_selection_complete_sources_v1(source_snapshot_value)
     or private.market_radar_sources_support_reason_v1(
       source_snapshot_value, 'SUBJECT_NOT_ANNOUNCED'
     ) then
    raise exception 'TEST_UNBOUND_TERMINAL_EVIDENCE_ACCEPTED';
  end if;
  candidate_payload := jsonb_build_object(
    'provider', 'kalshi', 'external_id', external_id_value,
    'external_event_id', 'FACT-GATE-' || suffix,
    'external_market_id', 'FACT-GATE-' || suffix || '-YES',
    'external_url', 'https://kalshi.com/markets/fact-gate/' || suffix,
    'external_event_url', 'https://kalshi.com/markets/fact-gate/' || suffix,
    'external_market_url', 'https://kalshi.com/markets/fact-gate/' || suffix,
    'event_group_key', 'kalshi:FACT-GATE-' || suffix,
    'fingerprint', 'fact-gate-' || suffix,
    'fact_context_fingerprint', repeat('0', 64),
    'fact_policy_version', 'atinara-terminal-fact-gate-v2',
    'normalizer_version', 'atinara-radar-v2',
    'eligibility_policy_version', 'atinara-prediction-policy-v4',
    'source_status', 'active', 'source_title', 'Transaction fixture',
    'source_question', 'Will the transaction fixture happen?',
    'source_close_at', now() + interval '30 days',
    'source_resolution_rules', 'Resolves from the official source.',
    'source_resolution_url', 'https://www.playstation.com/en-us/',
    'atinara_question', '¿Ocurrirá el fixture transaccional?',
    'atinara_category', 'Lanzamientos',
    'atinara_resolution_criteria', 'Sí si la fuente oficial lo confirma.',
    'atinara_resolution_source_url', 'https://www.playstation.com/en-us/',
    'hard_reject_reasons', '[]'::jsonb, 'warnings', '[]'::jsonb,
    'duplicate_matches', '[]'::jsonb,
    'verification_status', 'verified_open',
    'verification_reason', 'Comprobación de transacción.',
    'verified_at', now(), 'verification_expires_at', now() + interval '15 minutes',
    'verification_evidence', source_snapshot_value,
    'verification_confidence', 100,
    'quality_status', 'fit', 'quality_score', 90,
    'score_breakdown', '{}'::jsonb, 'state', 'available',
    'fetched_at', now(), 'cache_expires_at', now() + interval '15 minutes'
  );
  fact_check_value := jsonb_build_object(
    'attempt_id', gen_random_uuid(), 'purpose', 'discovery',
    'provider', 'kalshi', 'external_id', external_id_value,
    'event_group_key', 'kalshi:FACT-GATE-' || suffix,
    'fact_context_fingerprint', repeat('0', 64),
    'fact_policy_version', 'atinara-terminal-fact-gate-v2',
    'fact_status', 'unresolved', 'verification_status', 'verified_open',
    'reason', 'Comprobación de transacción.', 'confidence', 100,
    'evidence', source_snapshot_value, 'checked_at', now(),
    'expires_at', now() + interval '15 minutes',
    'context_snapshot', context_snapshot_value,
    'context_sha256', repeat('0', 64),
    'source_snapshot', source_snapshot_value,
    'source_sha256', repeat('0', 64), 'decision_hash', repeat('0', 64)
  );
  upsert_result := public.upsert_market_radar_batch_with_fact_checks_v1(
    'kalshi', 'fact-gate-transaction:' || suffix, 'atinara-radar-v2',
    jsonb_build_array(candidate_payload), jsonb_build_array(fact_check_value),
    'atinara-terminal-fact-gate-v2',
    jsonb_build_object('status', 'available', 'is_cached', false)
  );
  if not coalesce((upsert_result ->> 'ok')::boolean, false)
     or (upsert_result ->> 'fact_checks_linked')::integer <> 1 then
    raise exception 'TEST_ATOMIC_DISCOVERY_FAILED: %', upsert_result;
  end if;
  select * into candidate_row
  from private.external_market_candidates candidate_alias
  where candidate_alias.provider = 'kalshi'
    and candidate_alias.external_id = external_id_value;
  select * into fact_row from private.market_radar_fact_checks where id = candidate_row.current_fact_check_id;
  if candidate_row.state <> 'available'
     or candidate_row.verification_status <> 'verified_open'
     or candidate_row.fact_status <> 'unresolved'
     or candidate_row.fact_policy_version <> 'atinara-terminal-fact-gate-v2'
     or candidate_row.fact_check_purpose <> 'discovery'
     or fact_row.candidate_id <> candidate_row.id
     or fact_row.preparation_revision <> candidate_row.preparation_revision then
    raise exception 'TEST_DISCOVERY_FACT_LINK_INVALID';
  end if;

  discovery_fact_id := candidate_row.current_fact_check_id;
  revision_value := candidate_row.preparation_revision;

  -- Ni siquiera la función interna acepta una apertura basada solo en ausencia
  -- de señales terminales, una resolución sin selection_complete, o un motivo
  -- terminal que la evidencia no declare soportar.
  expected_failure := false;
  begin
    perform private.insert_market_radar_fact_check_v2(
      candidate_row.id, revision_value, 'discovery',
      fact_check_value || jsonb_build_object(
        'attempt_id', gen_random_uuid(),
        'evidence', jsonb_build_array((source_snapshot_value -> 0)
          - 'unresolved_proof'
          - 'unresolved_proof_basis'
          - 'unresolved_until'
          - 'unresolved_proof_excerpt'
          - 'unresolved_proof_excerpt_sha256'),
        'source_snapshot', jsonb_build_array((source_snapshot_value -> 0)
          - 'unresolved_proof'
          - 'unresolved_proof_basis'
          - 'unresolved_until'
          - 'unresolved_proof_excerpt'
          - 'unresolved_proof_excerpt_sha256'),
        'checked_at', now(), 'expires_at', now() + interval '15 minutes'
      )
    );
  exception when others then
    if position('RADAR_FACT_EVIDENCE_REQUIRED' in sqlerrm) > 0 then expected_failure := true;
    else raise; end if;
  end;
  if not expected_failure then raise exception 'TEST_RPC_OPEN_WITHOUT_POSITIVE_PROOF_ACCEPTED'; end if;

  expected_failure := false;
  begin
    perform private.insert_market_radar_fact_check_v2(
      candidate_row.id, revision_value, 'discovery',
      fact_check_value || jsonb_build_object(
        'attempt_id', gen_random_uuid(),
        'fact_status', 'fully_resolved',
        'verification_status', 'rejected_resolved',
        'reason_code', 'EVENT_ALREADY_RESOLVED',
        'checked_at', now(), 'expires_at', now() + interval '15 minutes'
      )
    );
  exception when others then
    if position('RADAR_FACT_EVIDENCE_REQUIRED' in sqlerrm) > 0 then expected_failure := true;
    else raise; end if;
  end;
  if not expected_failure then raise exception 'TEST_RPC_TERMINAL_WITHOUT_SELECTION_ACCEPTED'; end if;

  expected_failure := false;
  begin
    perform private.insert_market_radar_fact_check_v2(
      candidate_row.id, revision_value, 'discovery',
      fact_check_value || jsonb_build_object(
        'attempt_id', gen_random_uuid(),
        'fact_status', 'unknown',
        'verification_status', 'rejected_unannounced',
        'reason_code', 'SUBJECT_NOT_ANNOUNCED',
        'checked_at', now(), 'expires_at', now() + interval '15 minutes'
      )
    );
  exception when others then
    if position('RADAR_FACT_EVIDENCE_REQUIRED' in sqlerrm) > 0 then expected_failure := true;
    else raise; end if;
  end;
  if not expected_failure then raise exception 'TEST_RPC_UNBOUND_TERMINAL_REASON_ACCEPTED'; end if;

  -- La RPC directa solo expone una propuesta cuando el discovery fact enlazado
  -- es vigente; el payload incluye la decisión autoritativa, no una inferencia UI.
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', admin_id, 'role', 'authenticated')::text,
    true
  );
  list_result := public.list_market_radar_candidates_v2(
    'kalshi', null, 'all', 'Transaction fixture', 'recommended', '180d', 20, 0
  );
  if jsonb_array_length(list_result) <> 1
     or list_result -> 0 ->> 'external_id' <> external_id_value
     or list_result -> 0 ->> 'verification_status' <> 'verified_open'
     or coalesce((list_result -> 0 ->> 'fact_snapshot_current')::boolean, false) is not true then
    raise exception 'TEST_CURRENT_DISCOVERY_NOT_LISTED: %', list_result;
  end if;
  detail_result := public.get_market_radar_candidate(candidate_row.id);
  if detail_result ->> 'verification_status' <> 'verified_open'
     or coalesce((detail_result ->> 'fact_snapshot_current')::boolean, false) is not true then
    raise exception 'TEST_CURRENT_DISCOVERY_DIRECT_READ_INVALID: %', detail_result;
  end if;
  detail_result := public.get_market_intelligence_origin('radar_candidate', candidate_row.id::text);
  if detail_result ->> 'verification_status' <> 'verified_open'
     or coalesce((detail_result ->> 'fact_snapshot_current')::boolean, false) is not true then
    raise exception 'TEST_CURRENT_DISCOVERY_EXPERT_READ_INVALID: %', detail_result;
  end if;
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', admin_id, 'role', 'service_role')::text,
    true
  );

  -- Una fila sin fact check jamás reaparece por conservar verified_open en el
  -- payload. El trigger la degrada y las dos RPC administrativas fallan cerradas.
  insert into private.external_market_candidates (
    provider, external_id, fingerprint, normalizer_version, normalized_payload,
    quality_status, quality_score, fetched_at, expires_at, state,
    verification_status, verification_reason_code
  ) values (
    'kalshi', 'fact-gate-orphan-' || suffix, 'fact-gate-orphan-' || suffix,
    'atinara-radar-v2', jsonb_build_object(
      'source_title', 'Orphan cache fixture ' || suffix,
      'source_question', 'Will the orphan cache fixture happen?',
      'atinara_question', '¿Ocurrirá el fixture huérfano?',
      'eligibility_policy_version', 'atinara-prediction-policy-v4',
      'hard_reject_reasons', '[]'::jsonb
    ),
    'fit', 90, now(), now() + interval '30 minutes', 'available',
    'verified_open', null
  ) returning id into orphan_candidate_id;
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', admin_id, 'role', 'authenticated')::text,
    true
  );
  list_result := public.list_market_radar_candidates_v2(
    'kalshi', null, 'all', 'Orphan cache fixture', 'recommended', '180d', 20, 0
  );
  if jsonb_array_length(list_result) <> 0 then
    raise exception 'TEST_FACTLESS_CACHE_LISTED: %', list_result;
  end if;
  expected_failure := false;
  begin
    perform public.get_market_radar_candidate(orphan_candidate_id);
  exception when others then
    if position('RADAR_FACTUAL_REFRESH_REQUIRED' in sqlerrm) > 0 then
      expected_failure := true;
    else
      raise;
    end if;
  end;
  if not expected_failure then raise exception 'TEST_FACTLESS_DIRECT_READ_EXPOSED'; end if;
  expected_failure := false;
  begin
    perform public.get_market_intelligence_origin('radar_candidate', orphan_candidate_id::text);
  exception when others then
    if position('RADAR_FACTUAL_REFRESH_REQUIRED' in sqlerrm) > 0 then
      expected_failure := true;
    else
      raise;
    end if;
  end;
  if not expected_failure then raise exception 'TEST_FACTLESS_EXPERT_READ_EXPOSED'; end if;
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', admin_id, 'role', 'service_role')::text,
    true
  );
  detail_result := public.get_market_radar_candidate_for_revalidation_v1(orphan_candidate_id);
  if detail_result ->> 'verification_status' <> 'needs_review'
     or coalesce((detail_result ->> 'fact_snapshot_current')::boolean, false) then
    raise exception 'TEST_FACTLESS_SERVICE_READ_NOT_DEGRADED: %', detail_result;
  end if;

  -- Un fact check que ya expiró tampoco es una propuesta, aunque la revisión de
  -- proveedor y la caché general de la fila todavía tengan tiempo restante.
  expired_external_id := 'kalshi:FACT-GATE-EXPIRED-' || suffix;
  expired_context_snapshot := context_snapshot_value || jsonb_build_object(
    'external_id', expired_external_id,
    'external_event_id', 'FACT-GATE-EXPIRED-' || suffix,
    'external_market_id', 'FACT-GATE-EXPIRED-' || suffix || '-YES',
    'event_group_key', 'kalshi:FACT-GATE-EXPIRED-' || suffix,
    'canonical_event_children', jsonb_build_array(jsonb_build_object(
      'market_id', 'FACT-GATE-EXPIRED-' || suffix || '-YES',
      'question', 'Will the expired cache fixture happen?',
      'status', 'active', 'result', null
    ))
  );
  expired_source_snapshot := jsonb_build_array(
    (unresolved_source_snapshot_value -> 0) || jsonb_build_object(
      'retrieved_at', to_char((now() - interval '20 minutes') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    )
  );
  expired_candidate_payload := candidate_payload || jsonb_build_object(
    'external_id', expired_external_id,
    'external_event_id', 'FACT-GATE-EXPIRED-' || suffix,
    'external_market_id', 'FACT-GATE-EXPIRED-' || suffix || '-YES',
    'fingerprint', 'fact-gate-expired-' || suffix,
    'event_group_key', 'kalshi:FACT-GATE-EXPIRED-' || suffix,
    'source_title', 'Expired cache fixture ' || suffix,
    'source_question', 'Will the expired cache fixture happen?',
    'atinara_question', '¿Ocurrirá el fixture de caché expirada?',
    'verification_evidence', expired_source_snapshot,
    'verified_at', now() - interval '20 minutes',
    'verification_expires_at', now() + interval '15 minutes',
    'fetched_at', now() - interval '20 minutes',
    'cache_expires_at', now() + interval '15 minutes'
  );
  expired_fact_check := fact_check_value || jsonb_build_object(
    'attempt_id', gen_random_uuid(),
    'provider', 'kalshi', 'external_id', expired_external_id,
    'event_group_key', 'kalshi:FACT-GATE-EXPIRED-' || suffix,
    'context_snapshot', expired_context_snapshot,
    'evidence', expired_source_snapshot,
    'source_snapshot', expired_source_snapshot,
    'checked_at', now() - interval '20 minutes',
    'expires_at', now() - interval '5 minutes'
  );
  upsert_result := public.upsert_market_radar_batch_with_fact_checks_v1(
    'kalshi', 'fact-gate-expired:' || suffix, 'atinara-radar-v2',
    jsonb_build_array(expired_candidate_payload), jsonb_build_array(expired_fact_check),
    'atinara-terminal-fact-gate-v2',
    jsonb_build_object('status', 'available', 'is_cached', false)
  );
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', admin_id, 'role', 'authenticated')::text,
    true
  );
  list_result := public.list_market_radar_candidates_v2(
    'kalshi', null, 'all', 'Expired cache fixture', 'recommended', '180d', 20, 0
  );
  if jsonb_array_length(list_result) <> 0 then
    raise exception 'TEST_EXPIRED_FACT_CACHE_LISTED: %', list_result;
  end if;
  expected_failure := false;
  begin
    perform public.get_market_radar_candidate((
      select id from private.external_market_candidates
      where provider = 'kalshi' and external_id = expired_external_id
    ));
  exception when others then
    if position('RADAR_FACTUAL_REFRESH_REQUIRED' in sqlerrm) > 0 then
      expected_failure := true;
    else
      raise;
    end if;
  end;
  if not expected_failure then raise exception 'TEST_EXPIRED_FACT_DIRECT_READ_EXPOSED'; end if;
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', admin_id, 'role', 'service_role')::text,
    true
  );

  -- Si el mismo mercado se resuelve después de entrar en caché, la siguiente
  -- comprobación discovery lo retira de propuestas y lo mueve al archivo factual.
  cache_external_id := 'kalshi:FACT-GATE-CACHE-' || suffix;
  cache_context_snapshot := context_snapshot_value || jsonb_build_object(
    'external_id', cache_external_id,
    'external_event_id', 'FACT-GATE-CACHE-' || suffix,
    'external_market_id', 'FACT-GATE-CACHE-' || suffix || '-YES',
    'event_group_key', 'kalshi:FACT-GATE-CACHE-' || suffix,
    'canonical_event_children', jsonb_build_array(jsonb_build_object(
      'market_id', 'FACT-GATE-CACHE-' || suffix || '-YES',
      'question', 'Will the cached transition fixture happen?',
      'status', 'active', 'result', null
    ))
  );
  cache_candidate_payload := candidate_payload || jsonb_build_object(
    'external_id', cache_external_id,
    'external_event_id', 'FACT-GATE-CACHE-' || suffix,
    'external_market_id', 'FACT-GATE-CACHE-' || suffix || '-YES',
    'fingerprint', 'fact-gate-cache-' || suffix,
    'event_group_key', 'kalshi:FACT-GATE-CACHE-' || suffix,
    'source_title', 'Cached transition fixture ' || suffix,
    'source_question', 'Will the cached transition fixture happen?',
    'atinara_question', '¿Ocurrirá el fixture de transición en caché?'
  );
  cache_fact_check := fact_check_value || jsonb_build_object(
    'attempt_id', gen_random_uuid(),
    'provider', 'kalshi', 'external_id', cache_external_id,
    'event_group_key', 'kalshi:FACT-GATE-CACHE-' || suffix,
    'context_snapshot', cache_context_snapshot,
    'checked_at', now(), 'expires_at', now() + interval '15 minutes'
  );
  perform public.upsert_market_radar_batch_with_fact_checks_v1(
    'kalshi', 'fact-gate-cache:' || suffix, 'atinara-radar-v2',
    jsonb_build_array(cache_candidate_payload), jsonb_build_array(cache_fact_check),
    'atinara-terminal-fact-gate-v2',
    jsonb_build_object('status', 'available', 'is_cached', false)
  );
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', admin_id, 'role', 'authenticated')::text,
    true
  );
  list_result := public.list_market_radar_candidates_v2(
    'kalshi', null, 'all', 'Cached transition fixture', 'recommended', '180d', 20, 0
  );
  if jsonb_array_length(list_result) <> 1
     or list_result -> 0 ->> 'verification_status' <> 'verified_open' then
    raise exception 'TEST_OPEN_CACHE_TRANSITION_NOT_LISTED: %', list_result;
  end if;
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', admin_id, 'role', 'service_role')::text,
    true
  );
  cache_context_snapshot := cache_context_snapshot || jsonb_build_object(
    'source_status', 'settled', 'source_result', 'yes',
    'source_settled_at', now(),
    'canonical_event_children', jsonb_build_array(jsonb_build_object(
      'market_id', 'FACT-GATE-CACHE-' || suffix || '-YES',
      'question', 'Will the cached transition fixture happen?',
      'status', 'settled', 'result', 'yes'
    ))
  );
  cache_candidate_payload := cache_candidate_payload || jsonb_build_object(
    'source_status', 'settled', 'source_result', 'yes',
    'verification_status', 'rejected_resolved',
    'verification_reason_code', 'EVENT_ALREADY_RESOLVED',
    'verification_reason', 'El proveedor y la fuente oficial ya publicaron el resultado.',
    'verified_at', now(), 'verification_expires_at', null,
    'quality_status', 'rejected', 'quality_score', 0, 'state', 'rejected'
  );
  cache_fact_check := cache_fact_check || jsonb_build_object(
    'attempt_id', gen_random_uuid(),
    'fact_status', 'fully_resolved',
    'verification_status', 'rejected_resolved',
    'reason_code', 'EVENT_ALREADY_RESOLVED',
    'reason', 'El proveedor y la fuente oficial ya publicaron el resultado.',
    'context_snapshot', cache_context_snapshot,
    'checked_at', now(), 'expires_at', now() + interval '15 minutes'
  );
  perform public.upsert_market_radar_batch_with_fact_checks_v1(
    'kalshi', 'fact-gate-cache:' || suffix, 'atinara-radar-v2',
    jsonb_build_array(cache_candidate_payload), jsonb_build_array(cache_fact_check),
    'atinara-terminal-fact-gate-v2',
    jsonb_build_object('status', 'available', 'is_cached', false)
  );
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', admin_id, 'role', 'authenticated')::text,
    true
  );
  list_result := public.list_market_radar_candidates_v2(
    'kalshi', null, 'all', 'Cached transition fixture', 'recommended', '180d', 20, 0
  );
  rejected_result := public.list_market_radar_rejections('kalshi', null, 100, 0);
  detail_result := public.get_market_radar_candidate((
    select id from private.external_market_candidates
    where provider = 'kalshi' and external_id = cache_external_id
  ));
  if jsonb_array_length(list_result) <> 0
     or not exists (
       select 1 from jsonb_array_elements(rejected_result) item
       where item ->> 'external_id' = cache_external_id
         and item ->> 'verification_status' = 'rejected_resolved'
     )
     or detail_result ->> 'verification_status' <> 'rejected_resolved'
     or coalesce((detail_result ->> 'fact_snapshot_current')::boolean, false) is not true then
    raise exception 'TEST_RESOLVED_AFTER_CACHE_EXPOSED: % / % / %', list_result, rejected_result, detail_result;
  end if;
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', admin_id, 'role', 'service_role')::text,
    true
  );

  -- Un snapshot discovery sirve para mostrar la candidata, nunca para reservar
  -- ni guardar un borrador.
  reservation_result := public.reserve_market_radar_candidate_for_prepare(
    candidate_row.id, 'atinara-radar-v2', now()
  );
  if coalesce((reservation_result ->> 'ok')::boolean, false)
     or reservation_result ->> 'error' <> 'FACT_CHECK_REQUIRED' then
    raise exception 'TEST_DISCOVERY_RESERVATION_BYPASS: %', reservation_result;
  end if;
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', admin_id, 'role', 'authenticated')::text,
    true
  );
  expected_failure := false;
  begin
    perform public.save_market_draft_from_radar(
      candidate_row.id, null, null,
      jsonb_build_object(
        '_idempotency_key', gen_random_uuid(),
        '_radar_preparation_revision', revision_value::text,
        '_radar_fact_check_id', discovery_fact_id::text
      )
    );
  exception when others then
    if position('FACT_CHECK_REQUIRED' in sqlerrm) > 0 then
      expected_failure := true;
    else
      raise;
    end if;
  end;
  if not expected_failure then raise exception 'TEST_DISCOVERY_SAVE_BYPASS'; end if;
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', admin_id, 'role', 'service_role')::text,
    true
  );

  -- Un cierre demostrado por el evento canónico se rechaza, pero no se
  -- confunde con un resultado conocido. La evidencia del proveedor es obligatoria.
  prepare_result := public.apply_market_radar_prepare_fact_verification_v1(
    candidate_row.id, revision_value, 'atinara-radar-v2', now(),
    private.market_radar_safe_payload(candidate_row) || jsonb_build_object(
      'eligibility_policy_version', 'atinara-prediction-policy-v4',
      'fact_policy_version', 'atinara-terminal-fact-gate-v2',
      'verification_status', 'rejected_ineligible',
      'verification_reason_code', 'PROVIDER_NOT_OPEN',
      'verification_reason', 'El evento canónico ya no está abierto.',
      'verification_evidence', jsonb_build_array(jsonb_build_object(
        'title', 'Estado canónico del proveedor',
        'url', 'https://kalshi.com/markets/fact-gate/' || suffix,
        'source_type', 'provider',
        'retrieval_status', 'verified_provider_api',
        'evidence_basis', 'provider_api',
        'claim_status', 'direct', 'direct_claim', true,
        'claim_verifiable', true,
        'supported_reason_codes', jsonb_build_array('PROVIDER_NOT_OPEN'),
        'supports', 'El mercado ya no acepta operaciones.'
      )),
      'verified_at', now(), 'cache_expires_at', now() + interval '15 minutes'
    ),
    fact_check_value || jsonb_build_object(
      'attempt_id', gen_random_uuid(), 'purpose', 'prepare',
      'fact_status', 'unresolved', 'verification_status', 'rejected_ineligible',
      'reason_code', 'PROVIDER_NOT_OPEN',
      'reason', 'El evento canónico ya no está abierto.',
      'evidence', jsonb_build_array(jsonb_build_object(
        'title', 'Estado canónico del proveedor',
        'url', 'https://kalshi.com/markets/fact-gate/' || suffix,
        'source_type', 'provider',
        'retrieval_status', 'verified_provider_api',
        'evidence_basis', 'provider_api',
        'claim_status', 'direct', 'direct_claim', true,
        'claim_verifiable', true,
        'supported_reason_codes', jsonb_build_array('PROVIDER_NOT_OPEN'),
        'supports', 'El mercado ya no acepta operaciones.'
      )),
      'source_snapshot', jsonb_build_array(jsonb_build_object(
        'title', 'Estado canónico del proveedor',
        'url', 'https://kalshi.com/markets/fact-gate/' || suffix,
        'source_type', 'provider',
        'retrieval_status', 'verified_provider_api',
        'evidence_basis', 'provider_api',
        'claim_status', 'direct', 'direct_claim', true,
        'claim_verifiable', true,
        'supported_reason_codes', jsonb_build_array('PROVIDER_NOT_OPEN'),
        'supports', 'El mercado ya no acepta operaciones.'
      )),
      'checked_at', now(), 'expires_at', now() + interval '15 minutes'
    )
  );
  if coalesce((prepare_result ->> 'ok')::boolean, true)
     or not coalesce((prepare_result ->> 'persisted')::boolean, false) then
    raise exception 'TEST_PROVIDER_NOT_OPEN_NOT_PERSISTED: %', prepare_result;
  end if;
  select * into candidate_row
  from private.external_market_candidates where id = candidate_row.id;
  if candidate_row.state <> 'rejected'
     or candidate_row.verification_status <> 'rejected_ineligible'
     or candidate_row.verification_reason_code <> 'PROVIDER_NOT_OPEN'
     or candidate_row.fact_status <> 'unresolved' then
    raise exception 'TEST_PROVIDER_NOT_OPEN_STATE_INVALID';
  end if;
  revision_value := candidate_row.preparation_revision;

  -- Una revisión falsa y un cruce fact_status/status incompatible no insertan
  -- evidencia ni alteran la candidata.
  prepare_result := public.apply_market_radar_prepare_fact_verification_v1(
    candidate_row.id, revision_value + 1, 'atinara-radar-v2', now(),
    private.market_radar_safe_payload(candidate_row),
    fact_check_value || jsonb_build_object(
      'attempt_id', gen_random_uuid(), 'purpose', 'prepare',
      'checked_at', now(), 'expires_at', now() + interval '15 minutes'
    )
  );
  if coalesce((prepare_result ->> 'ok')::boolean, false)
     or prepare_result ->> 'error' <> 'PREPARATION_REVISION_MISMATCH' then
    raise exception 'TEST_TAMPERED_REVISION_ACCEPTED: %', prepare_result;
  end if;
  prepare_result := public.apply_market_radar_prepare_fact_verification_v1(
    candidate_row.id, revision_value, 'atinara-radar-v2', now(),
    private.market_radar_safe_payload(candidate_row) || jsonb_build_object(
      'eligibility_policy_version', 'atinara-prediction-policy-v4',
      'fact_policy_version', 'atinara-terminal-fact-gate-v2',
      'verification_status', 'verified_open', 'verified_at', now(),
      'verification_expires_at', now() + interval '15 minutes',
      'cache_expires_at', now() + interval '15 minutes'
    ),
    fact_check_value || jsonb_build_object(
      'attempt_id', gen_random_uuid(), 'purpose', 'prepare',
      'fact_status', 'fully_resolved', 'verification_status', 'verified_open',
      'checked_at', now(), 'expires_at', now() + interval '15 minutes'
    )
  );
  if coalesce((prepare_result ->> 'ok')::boolean, false)
     or coalesce((prepare_result ->> 'persisted')::boolean, true) then
    raise exception 'TEST_TAMPERED_FACT_STATUS_ACCEPTED: %', prepare_result;
  end if;
  prepare_result := public.apply_market_radar_prepare_fact_verification_v1(
    candidate_row.id, revision_value, 'atinara-radar-v2', now(),
    private.market_radar_safe_payload(candidate_row) || jsonb_build_object(
      'eligibility_policy_version', 'atinara-prediction-policy-v4',
      'fact_policy_version', 'atinara-terminal-fact-gate-v2',
      'verification_status', 'verified_open', 'verified_at', now(),
      'verification_expires_at', now() + interval '15 minutes',
      'cache_expires_at', now() + interval '15 minutes'
    ),
    fact_check_value || jsonb_build_object(
      'attempt_id', gen_random_uuid(), 'purpose', 'prepare',
      'context_sha256', repeat('f', 64),
      'checked_at', now(), 'expires_at', now() + interval '15 minutes'
    )
  );
  if coalesce((prepare_result ->> 'ok')::boolean, false)
     or coalesce((prepare_result ->> 'persisted')::boolean, true) then
    raise exception 'TEST_TAMPERED_CONTEXT_HASH_ACCEPTED: %', prepare_result;
  end if;

  -- Un resultado concluyente oficial tiene prioridad, se persiste y bloquea.
  source_snapshot_value := jsonb_build_array(jsonb_build_object(
    'title', 'Official complete transaction fixture result',
    'url', 'https://www.playstation.com/en-us/',
    'source_type', 'official',
    'supports', 'The complete official selection has published the result for every option.',
    'retrieved_at', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'retrieval_status', 'verified_content',
    'evidence_basis', 'retrieved_content',
    'parser_version', 'atinara-official-content-v1',
    'content_sha256', repeat('b', 64),
    'content_type', 'text/html',
    'claim_status', 'direct', 'direct_claim', true,
    'claim_verifiable', true, 'relevance_score', 100,
    'selection_complete', true,
    'supported_reason_codes', jsonb_build_array('EVENT_ALREADY_RESOLVED'),
    'supported_fact_statuses', jsonb_build_array('fully_resolved'),
    'supported_contract_kinds', '[]'::jsonb,
    'unresolved_proof', false
  ));
  repeated_attempt_id := gen_random_uuid();
  fact_check_value := fact_check_value || jsonb_build_object(
    'attempt_id', repeated_attempt_id, 'purpose', 'prepare',
    'fact_status', 'fully_resolved', 'verification_status', 'rejected_resolved',
    'reason_code', 'EVENT_ALREADY_RESOLVED',
    'reason', 'La fuente oficial ya publicó el resultado.',
    'evidence', source_snapshot_value,
    'source_snapshot', source_snapshot_value,
    'checked_at', now(), 'expires_at', now() + interval '15 minutes'
  );
  resolved_result := public.apply_market_radar_prepare_fact_verification_v1(
    candidate_row.id, revision_value, 'atinara-radar-v2', now(),
    private.market_radar_safe_payload(candidate_row) || jsonb_build_object(
      'eligibility_policy_version', 'atinara-prediction-policy-v4',
      'fact_policy_version', 'atinara-terminal-fact-gate-v2',
      'verification_status', 'rejected_resolved',
      'verification_reason_code', 'EVENT_ALREADY_RESOLVED',
      'verification_reason', 'La fuente oficial ya publicó el resultado.',
      'verification_evidence', source_snapshot_value,
      'verified_at', now(), 'cache_expires_at', now() + interval '15 minutes'
    ), fact_check_value
  );
  if coalesce((resolved_result ->> 'ok')::boolean, true)
     or not coalesce((resolved_result ->> 'persisted')::boolean, false)
     or resolved_result ->> 'error' <> 'RADAR_CANDIDATE_RESOLVED' then
    raise exception 'TEST_RESOLVED_PREPARE_NOT_PERSISTED: %', resolved_result;
  end if;
  select * into candidate_row
  from private.external_market_candidates where id = candidate_row.id;
  if candidate_row.state <> 'rejected'
     or candidate_row.verification_status <> 'rejected_resolved'
     or candidate_row.verification_reason_code <> 'EVENT_ALREADY_RESOLVED'
     or candidate_row.fact_status <> 'fully_resolved'
     or candidate_row.current_fact_check_id is null then
    raise exception 'TEST_RESOLVED_PREPARE_STATE_INVALID';
  end if;

  -- El mismo intento no crea una segunda fila ni reaplica la decisión.
  revision_value := candidate_row.preparation_revision;
  select count(*) into fact_count_before
  from private.market_radar_fact_checks where candidate_id = candidate_row.id;
  replay_result := public.apply_market_radar_prepare_fact_verification_v1(
    candidate_row.id, revision_value, 'atinara-radar-v2', now(),
    private.market_radar_safe_payload(candidate_row) || jsonb_build_object(
      'eligibility_policy_version', 'atinara-prediction-policy-v4',
      'fact_policy_version', 'atinara-terminal-fact-gate-v2',
      'verification_status', 'rejected_resolved',
      'verification_evidence', source_snapshot_value,
      'verified_at', now(), 'cache_expires_at', now() + interval '15 minutes'
    ), fact_check_value
  );
  if coalesce((replay_result ->> 'ok')::boolean, false)
     or coalesce((replay_result ->> 'persisted')::boolean, true)
     or replay_result ->> 'error' <> 'RADAR_FACT_ATTEMPT_REPLAY'
     or (select count(*) from private.market_radar_fact_checks
         where candidate_id = candidate_row.id) <> fact_count_before
     or (select preparation_revision from private.external_market_candidates
         where id = candidate_row.id) <> revision_value then
    raise exception 'TEST_FACT_ATTEMPT_REPLAY_ACCEPTED: %', replay_result;
  end if;

  -- Una revalidación positiva recupera la candidata con un nuevo snapshot prepare.
  source_snapshot_value := unresolved_source_snapshot_value;
  fact_check_value := fact_check_value || jsonb_build_object(
    'attempt_id', gen_random_uuid(), 'purpose', 'prepare',
    'fact_status', 'unresolved', 'verification_status', 'verified_open',
    'reason_code', null, 'reason', 'Comprobación de transacción.',
    'confidence', 100, 'evidence', source_snapshot_value,
    'source_snapshot', source_snapshot_value,
    'checked_at', now(), 'expires_at', now() + interval '15 minutes'
  );
  prepare_result := public.apply_market_radar_prepare_fact_verification_v1(
    candidate_row.id, revision_value, 'atinara-radar-v2', now(),
    private.market_radar_safe_payload(candidate_row) || jsonb_build_object(
      'eligibility_policy_version', 'atinara-prediction-policy-v4',
      'fact_policy_version', 'atinara-terminal-fact-gate-v2',
      'verification_status', 'verified_open', 'verified_at', now(),
      'verification_expires_at', now() + interval '15 minutes',
      'verification_evidence', source_snapshot_value,
      'cache_expires_at', now() + interval '15 minutes'
    ), fact_check_value
  );
  if not coalesce((prepare_result ->> 'ok')::boolean, false)
     or prepare_result -> 'candidate' ->> 'fact_check_purpose' <> 'prepare' then
    raise exception 'TEST_ATOMIC_PREPARE_FAILED: %', prepare_result;
  end if;

  -- Una comprobación inconclusa también se persiste antes de devolver ok=false.
  select * into candidate_row
  from private.external_market_candidates where id = candidate_row.id;
  revision_value := candidate_row.preparation_revision;
  fact_check_value := fact_check_value || jsonb_build_object(
    'attempt_id', gen_random_uuid(), 'purpose', 'prepare',
    'fact_status', 'unknown', 'verification_status', 'needs_review',
    'confidence', 0, 'evidence', '[]'::jsonb,
    'source_snapshot', '[]'::jsonb,
    'checked_at', now(), 'expires_at', now() + interval '5 minutes'
  );
  rejected_result := public.apply_market_radar_prepare_fact_verification_v1(
    candidate_row.id, revision_value, 'atinara-radar-v2', now(),
    private.market_radar_safe_payload(candidate_row) || jsonb_build_object(
      'eligibility_policy_version', 'atinara-prediction-policy-v4',
      'fact_policy_version', 'atinara-terminal-fact-gate-v2',
      'verification_status', 'needs_review',
      'verification_reason_code', 'VERIFICATION_REQUIRED',
      'verification_evidence', '[]'::jsonb, 'verified_at', now(),
      'cache_expires_at', now() + interval '5 minutes'
    ), fact_check_value
  );
  if coalesce((rejected_result ->> 'ok')::boolean, true)
     or not coalesce((rejected_result ->> 'persisted')::boolean, false) then
    raise exception 'TEST_NEGATIVE_PREPARE_NOT_PERSISTED: %', rejected_result;
  end if;
  select * into candidate_row
  from private.external_market_candidates where id = candidate_row.id;
  if candidate_row.state <> 'needs_review'
     or candidate_row.fact_status <> 'unknown'
     or candidate_row.fact_check_purpose <> 'prepare' then
    raise exception 'TEST_NEGATIVE_PREPARE_STATE_INVALID';
  end if;

  -- Deja de nuevo un snapshot prepare positivo para probar todas las rutas de guardado.
  revision_value := candidate_row.preparation_revision;
  fact_check_value := fact_check_value || jsonb_build_object(
    'attempt_id', gen_random_uuid(), 'purpose', 'prepare',
    'fact_status', 'unresolved', 'verification_status', 'verified_open',
    'reason_code', null, 'reason', 'Comprobación final de guardado.',
    'confidence', 100, 'evidence', source_snapshot_value,
    'source_snapshot', source_snapshot_value,
    'checked_at', now(), 'expires_at', now() + interval '15 minutes'
  );
  prepare_result := public.apply_market_radar_prepare_fact_verification_v1(
    candidate_row.id, revision_value, 'atinara-radar-v2', now(),
    private.market_radar_safe_payload(candidate_row) || jsonb_build_object(
      'eligibility_policy_version', 'atinara-prediction-policy-v4',
      'fact_policy_version', 'atinara-terminal-fact-gate-v2',
      'verification_status', 'verified_open', 'verified_at', now(),
      'verification_expires_at', now() + interval '15 minutes',
      'verification_evidence', source_snapshot_value,
      'cache_expires_at', now() + interval '15 minutes'
    ), fact_check_value
  );
  if not coalesce((prepare_result ->> 'ok')::boolean, false) then
    raise exception 'TEST_FINAL_PREPARE_FAILED: %', prepare_result;
  end if;
  select * into candidate_row
  from private.external_market_candidates where id = candidate_row.id;
  revision_value := candidate_row.preparation_revision;
  prepare_fact_id := candidate_row.current_fact_check_id;

  -- Los campos de estado y hash no son confiables por sí solos: la reserva debe
  -- contrastarlos con la fila append-only. Cada subtransacción revierte el spoof.
  begin
    update private.external_market_candidates
    set fact_context_fingerprint = repeat('f', 64)
    where id = candidate_row.id;
    reservation_result := public.reserve_market_radar_candidate_for_prepare(
      candidate_row.id, 'atinara-radar-v2', now()
    );
    if coalesce((reservation_result ->> 'ok')::boolean, false)
       or reservation_result ->> 'error' <> 'FACT_CHECK_REQUIRED' then
      raise exception 'TEST_TAMPERED_HASH_ACCEPTED: %', reservation_result;
    end if;
    raise exception 'ROLLBACK_EXPECTED_HASH_TAMPER' using errcode = 'P0002';
  exception when sqlstate 'P0002' then null;
  end;
  begin
    update private.external_market_candidates
    set verification_status = 'needs_review'
    where id = candidate_row.id;
    reservation_result := public.reserve_market_radar_candidate_for_prepare(
      candidate_row.id, 'atinara-radar-v2', now()
    );
    if coalesce((reservation_result ->> 'ok')::boolean, false)
       or reservation_result ->> 'error' <> 'FACT_CHECK_REQUIRED' then
      raise exception 'TEST_TAMPERED_STATUS_ACCEPTED: %', reservation_result;
    end if;
    raise exception 'ROLLBACK_EXPECTED_STATUS_TAMPER' using errcode = 'P0002';
  exception when sqlstate 'P0002' then null;
  end;

  evaluation_at := date_trunc('second', now() + interval '30 days');
  draft_payload := jsonb_build_object(
    'market_slug', 'authoritative-fact-gate-' || left(suffix, 24),
    'question', '¿Ocurrirá el fixture transaccional antes del plazo?',
    'subject', 'Fixture factual ' || suffix,
    'category', 'Lanzamientos', 'yes_option', 'Sí', 'no_option', 'No',
    'evaluation_period_label', 'Hasta el plazo transaccional',
    'evaluation_ends_at', evaluation_at, 'timezone', 'Europe/Madrid',
    'resolution_deadline', evaluation_at + interval '1 day',
    'yes_criteria', 'Sí si la fuente primaria confirma el evento dentro del plazo.',
    'no_criteria', 'No si el plazo termina sin confirmación oficial.',
    'edge_cases', 'Los aplazamientos no amplían el plazo automáticamente.',
    'primary_source', jsonb_build_object('url', 'https://www.playstation.com/en-us/'),
    'alternative_sources', '[]'::jsonb,
    'delay_treatment', 'Se conserva el plazo aprobado.',
    'cancellation_treatment', 'Una cancelación exige revisión humana.',
    'leak_treatment', 'Las filtraciones no resuelven el mercado.',
    'rename_treatment', 'Un cambio de nombre conserva la identidad inequívoca.',
    'assumptions', 'Solo cuenta la fuente primaria pública.',
    'public_criteria', 'La resolución aplica literalmente los criterios aprobados.',
    'description', 'Borrador sintético revertido por esta prueba.',
    '_idempotency_key', gen_random_uuid(),
    '_change_origin', 'authoritative_fact_gate_transaction',
    '_timestamp_precision', 'milliseconds-v1',
    '_radar_preparation_revision', revision_value::text,
    '_radar_fact_check_id', prepare_fact_id::text
  );
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', admin_id, 'role', 'authenticated')::text,
    true
  );

  -- Ni un id factual de discovery ni una revisión manipulada pueden guardar.
  expected_failure := false;
  begin
    perform public.save_market_draft_from_radar(
      candidate_row.id, null, null,
      draft_payload || jsonb_build_object('_radar_fact_check_id', discovery_fact_id::text)
    );
  exception when others then
    if position('FACT_CHECK_REQUIRED' in sqlerrm) > 0 then expected_failure := true;
    else raise; end if;
  end;
  if not expected_failure then raise exception 'TEST_TAMPERED_FACT_ID_SAVE_ACCEPTED'; end if;
  expected_failure := false;
  begin
    perform public.save_market_draft_from_radar(
      candidate_row.id, null, null,
      draft_payload || jsonb_build_object('_radar_preparation_revision', (revision_value + 99)::text)
    );
  exception when others then
    if position('PREPARATION_REVISION_MISMATCH' in sqlerrm) > 0 then expected_failure := true;
    else raise; end if;
  end;
  if not expected_failure then raise exception 'TEST_TAMPERED_SAVE_REVISION_ACCEPTED'; end if;

  save_result := public.save_market_draft_from_radar(
    candidate_row.id, null, null, draft_payload
  );
  saved_draft_id := nullif(save_result #>> '{draft,id}', '')::uuid;
  if saved_draft_id is null
     or (save_result ->> 'radar_fact_check_id')::bigint <> prepare_fact_id
     or not coalesce((save_result ->> 'atomic_fact_gate')::boolean, false) then
    raise exception 'TEST_AUTHORITATIVE_SAVE_FAILED: %', save_result;
  end if;
  select source_provenance into saved_provenance
  from private.market_drafts where id = saved_draft_id;
  select * into fact_row
  from private.market_radar_fact_checks where id = prepare_fact_id;
  if (saved_provenance ->> 'radar_fact_check_id')::bigint <> fact_row.id
     or (saved_provenance ->> 'radar_candidate_id')::uuid <> candidate_row.id
     or (saved_provenance ->> 'radar_preparation_revision')::bigint
       <> fact_row.preparation_revision
     or saved_provenance ->> 'radar_fact_policy_version' <> fact_row.fact_policy_version
     or saved_provenance ->> 'radar_fact_status' <> 'unresolved'
     or saved_provenance ->> 'radar_fact_context_sha256' <> fact_row.context_sha256
     or saved_provenance ->> 'radar_fact_source_sha256' <> fact_row.source_sha256
     or saved_provenance ->> 'radar_fact_purpose' <> 'prepare' then
    raise exception 'TEST_SAVED_FACT_PROVENANCE_INVALID: %', saved_provenance;
  end if;

  -- Incluso el propietario queda sujeto al trigger: un enlace Radar existente
  -- no se puede borrar ni reescribir para fingir que el borrador es manual.
  expected_failure := false;
  begin
    update private.market_drafts
    set
      radar_candidate_id = null,
      source_provenance = source_provenance
        - 'radar_candidate_id'
        - 'radar_fact_check_id'
        - 'radar_preparation_revision'
    where id = saved_draft_id;
  exception when others then
    if position('RADAR_DRAFT_FACT_LINK_IMMUTABLE' in sqlerrm) > 0 then
      expected_failure := true;
    else raise; end if;
  end;
  if not expected_failure then raise exception 'TEST_RADAR_DRAFT_UNLINK_ACCEPTED'; end if;

  -- Confirmar/publicar nunca reutiliza el prepare original. Una RPC separada
  -- agrega purpose=revalidate sin reservar otra vez ni modificar el borrador.
  select * into candidate_row
  from private.external_market_candidates where id = candidate_row.id;
  revision_value := candidate_row.preparation_revision;
  fact_check_value := fact_check_value || jsonb_build_object(
    'attempt_id', gen_random_uuid(), 'purpose', 'revalidate',
    'fact_status', 'unresolved', 'verification_status', 'verified_open',
    'reason_code', null, 'reason', 'Comprobación previa a publicación.',
    'confidence', 100, 'evidence', source_snapshot_value,
    'source_snapshot', source_snapshot_value,
    'context_snapshot', context_snapshot_value,
    'checked_at', now(), 'expires_at', now() + interval '15 minutes'
  );
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', admin_id, 'role', 'service_role')::text,
    true
  );
  prepare_result := public.apply_market_radar_revalidation_fact_v1(
    candidate_row.id, revision_value, 'atinara-radar-v2', now(),
    private.market_radar_safe_payload(candidate_row) || jsonb_build_object(
      'eligibility_policy_version', 'atinara-prediction-policy-v4',
      'fact_policy_version', 'atinara-terminal-fact-gate-v2',
      'verification_status', 'verified_open', 'verified_at', now(),
      'verification_expires_at', now() + interval '15 minutes',
      'verification_evidence', source_snapshot_value,
      'cache_expires_at', now() + interval '15 minutes'
    ),
    fact_check_value
  );
  select * into candidate_row
  from private.external_market_candidates where id = candidate_row.id;
  if not coalesce((prepare_result ->> 'ok')::boolean, false)
     or candidate_row.state <> 'prepared'
     or candidate_row.fact_check_purpose <> 'revalidate'
     or candidate_row.current_fact_check_id = prepare_fact_id
     or candidate_row.preparation_revision <= revision_value
     or prepare_result ? 'reservation' then
    raise exception 'TEST_POST_PREPARE_REVALIDATION_FAILED: %', prepare_result;
  end if;

  -- Construye una aprobación efectiva compatible sin depender de un proveedor
  -- externo: solo prepara la ruta de publicación que esta prueba debe bloquear.
  select * into draft_row from private.market_drafts where id = saved_draft_id;
  select
    compatibility.validator_version,
    compatibility.policy_version,
    compatibility.schema_version
  into review_validator_version, review_policy_version, review_schema_version
  from private.market_review_policy_compatibility compatibility
  where compatibility.reusable
    and compatibility.invalidated_at is null
  order by
    case when compatibility.policy_version = 'atinara-market-review-policy-v3'
      then 0 else 1 end,
    compatibility.validator_version
  limit 1;
  if review_validator_version is null or draft_row.content_fingerprint is null then
    raise exception 'TEST_PUBLICATION_REVIEW_FIXTURE_UNAVAILABLE';
  end if;

  insert into private.market_review_reports(
    draft_id, draft_version, content_fingerprint, validator_version,
    result, deterministic_issues, semantic_issues, editorial_notes, reviewed_by,
    policy_version, schema_version, canonical_fingerprint,
    review_classification, safe_provider_metadata
  ) values (
    draft_row.id, draft_row.content_version, draft_row.content_fingerprint,
    review_validator_version, 'approved', '[]'::jsonb, '[]'::jsonb,
    '[]'::jsonb, admin_id, review_policy_version, review_schema_version,
    draft_row.content_fingerprint, 'content',
    jsonb_build_object('fixture', 'authoritative_fact_gate_transaction')
  ) returning id into review_report_id;

  insert into private.market_effective_reviews(
    draft_id, draft_version, report_id, content_fingerprint,
    validator_version, policy_version, schema_version, compatibility_basis
  ) values (
    draft_row.id, draft_row.content_version, review_report_id,
    draft_row.content_fingerprint, review_validator_version,
    review_policy_version, review_schema_version,
    'authoritative_fact_gate_transaction_fixture'
  ) returning id into effective_review_id_value;

  update private.market_drafts draft_alias set
    workflow_status = 'review_approved',
    review_status = 'approved',
    reviewed_version = draft_alias.content_version,
    reviewed_fingerprint = draft_alias.content_fingerprint,
    effective_review_id = effective_review_id_value,
    updated_at = now(), updated_by = admin_id
  where draft_alias.id = saved_draft_id
  returning * into draft_row;
  if private.market_current_effective_review_id(draft_row) <> effective_review_id_value then
    raise exception 'TEST_PUBLICATION_EFFECTIVE_REVIEW_INVALID';
  end if;

  -- Con el prepare fact todavía abierto, confirmación y programación pasan por
  -- la nueva puerta. Esto demuestra que no es un bloqueo cosmético total.
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', admin_id, 'role', 'authenticated')::text,
    true
  );
  confirmation_result := public.confirm_market_draft_review(
    saved_draft_id, draft_row.content_version
  );
  if confirmation_result ->> 'status' <> 'human_confirmed' then
    raise exception 'TEST_RADAR_CONFIRM_OPEN_FAILED: %', confirmation_result;
  end if;
  publication_result := public.publish_market_draft(
    saved_draft_id, draft_row.content_version, clock_timestamp() + interval '2 minutes'
  );
  if publication_result ->> 'status' <> 'scheduled' then
    raise exception 'TEST_RADAR_SCHEDULE_OPEN_FAILED: %', publication_result;
  end if;
  update private.market_drafts
  set scheduled_for = clock_timestamp() - interval '1 minute'
  where id = saved_draft_id;

  -- El scheduler tampoco puede materializar usando un enlace caducado. La
  -- subtransacción restaura después el snapshot positivo para el caso terminal.
  begin
    update private.external_market_candidates
    set
      fact_check_expires_at = clock_timestamp() - interval '1 second',
      verification_expires_at = clock_timestamp() - interval '1 second'
    where id = candidate_row.id;
    update private.market_drafts
    set scheduled_for = clock_timestamp() + interval '1 day'
    where id <> saved_draft_id
      and workflow_status = 'scheduled'
      and scheduled_for <= clock_timestamp();
    perform set_config(
      'request.jwt.claims',
      jsonb_build_object('sub', admin_id, 'role', 'service_role')::text,
      true
    );
    scheduler_result := public.publish_due_market_drafts(1);
    if jsonb_array_length(coalesce(scheduler_result -> 'published', '[]'::jsonb)) <> 0
       or not exists (
         select 1 from jsonb_array_elements(
           coalesce(scheduler_result -> 'failed', '[]'::jsonb)
         ) failure
         where failure ->> 'draft_id' = saved_draft_id::text
       )
       or exists (
         select 1 from public.markets market_row
         where market_row.id = draft_row.market_slug
       ) then
      raise exception 'TEST_EXPIRED_SCHEDULER_PUBLISHED: %', scheduler_result;
    end if;
    raise exception 'ROLLBACK_EXPECTED_EXPIRED_SCHEDULER' using errcode = 'P0002';
  exception when sqlstate 'P0002' then null;
  end;

  -- Una actualización factual posterior conoce ya el resultado. La candidata
  -- conserva prepared por trazabilidad, pero ese estado no autoriza el borrador.
  source_snapshot_value := jsonb_build_array(jsonb_build_object(
    'title', 'Official transaction fixture result',
    'url', 'https://www.playstation.com/en-us/',
    'source_type', 'official',
    'supports', 'The complete official selection has published the result for every option.',
    'retrieved_at', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'retrieval_status', 'verified_content',
    'evidence_basis', 'retrieved_content',
    'parser_version', 'atinara-official-content-v1',
    'content_sha256', repeat('b', 64),
    'content_type', 'text/html',
    'claim_status', 'direct', 'direct_claim', true,
    'claim_verifiable', true, 'relevance_score', 100,
    'selection_complete', true,
    'supported_reason_codes', jsonb_build_array('EVENT_ALREADY_RESOLVED'),
    'supported_fact_statuses', jsonb_build_array('fully_resolved'),
    'supported_contract_kinds', '[]'::jsonb,
    'unresolved_proof', false
  ));
  fact_check_value := fact_check_value || jsonb_build_object(
    'attempt_id', gen_random_uuid(), 'purpose', 'revalidate',
    'fact_status', 'fully_resolved',
    'verification_status', 'rejected_resolved',
    'reason_code', 'EVENT_ALREADY_RESOLVED',
    'reason', 'La fuente oficial ya publicó el resultado.',
    'confidence', 100, 'evidence', source_snapshot_value,
    'source_snapshot', source_snapshot_value,
    'context_snapshot', context_snapshot_value,
    'checked_at', now(), 'expires_at', now() + interval '15 minutes'
  );
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', admin_id, 'role', 'service_role')::text,
    true
  );
  revision_value := candidate_row.preparation_revision;
  resolved_result := public.apply_market_radar_revalidation_fact_v1(
    candidate_row.id, revision_value, 'atinara-radar-v2', now(),
    private.market_radar_safe_payload(candidate_row) || jsonb_build_object(
      'eligibility_policy_version', 'atinara-prediction-policy-v4',
      'fact_policy_version', 'atinara-terminal-fact-gate-v2',
      'verification_status', 'rejected_resolved',
      'verification_reason_code', 'EVENT_ALREADY_RESOLVED',
      'verification_reason', 'La fuente oficial ya publicó el resultado.',
      'verification_evidence', source_snapshot_value,
      'verified_at', now(), 'cache_expires_at', now() + interval '15 minutes'
    ),
    fact_check_value
  );
  select * into candidate_row
  from private.external_market_candidates where id = candidate_row.id;
  if coalesce((resolved_result ->> 'ok')::boolean, true)
     or not coalesce((resolved_result ->> 'persisted')::boolean, false)
     or resolved_result ->> 'error' <> 'RADAR_CANDIDATE_RESOLVED'
     or candidate_row.state <> 'prepared'
     or candidate_row.fact_status <> 'fully_resolved'
     or candidate_row.verification_status <> 'rejected_resolved' then
    raise exception 'TEST_PREPARED_RESOLVED_TRANSITION_FAILED: %', resolved_result;
  end if;

  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', admin_id, 'role', 'authenticated')::text,
    true
  );
  expected_failure := false;
  begin
    perform public.confirm_market_draft_review(saved_draft_id, draft_row.content_version);
  exception when others then
    if position('RADAR_EVENT_ALREADY_RESOLVED' in sqlerrm) > 0 then
      expected_failure := true;
    else raise; end if;
  end;
  if not expected_failure then raise exception 'TEST_RESOLVED_RECONFIRM_ACCEPTED'; end if;

  expected_failure := false;
  begin
    perform public.publish_market_draft(
      saved_draft_id, draft_row.content_version, clock_timestamp() + interval '3 minutes'
    );
  exception when others then
    if position('RADAR_EVENT_ALREADY_RESOLVED' in sqlerrm) > 0 then
      expected_failure := true;
    else raise; end if;
  end;
  if not expected_failure then raise exception 'TEST_RESOLVED_RESCHEDULE_ACCEPTED'; end if;

  -- También bloquea escrituras directas y la última defensa materializadora.
  expected_failure := false;
  begin
    update private.market_drafts set workflow_status = 'scheduled'
    where id = saved_draft_id;
  exception when others then
    if position('RADAR_EVENT_ALREADY_RESOLVED' in sqlerrm) > 0 then
      expected_failure := true;
    else raise; end if;
  end;
  if not expected_failure then raise exception 'TEST_RESOLVED_RAW_SCHEDULE_ACCEPTED'; end if;

  expected_failure := false;
  begin
    perform private.materialize_market_draft(saved_draft_id, admin_id);
  exception when others then
    if position('RADAR_EVENT_ALREADY_RESOLVED' in sqlerrm) > 0 then
      expected_failure := true;
    else raise; end if;
  end;
  if not expected_failure then raise exception 'TEST_RESOLVED_MATERIALIZE_ACCEPTED'; end if;

  -- Aísla el scheduler dentro de la transacción: ningún otro borrador real se
  -- procesa y el fixture debe aparecer en failed sin crear mercado público.
  update private.market_drafts
  set scheduled_for = clock_timestamp() + interval '1 day'
  where id <> saved_draft_id
    and workflow_status = 'scheduled'
    and scheduled_for <= clock_timestamp();
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', admin_id, 'role', 'service_role')::text,
    true
  );
  scheduler_result := public.publish_due_market_drafts(1);
  if jsonb_array_length(coalesce(scheduler_result -> 'published', '[]'::jsonb)) <> 0
     or not exists (
       select 1 from jsonb_array_elements(
         coalesce(scheduler_result -> 'failed', '[]'::jsonb)
       ) failure
       where failure ->> 'draft_id' = saved_draft_id::text
     )
     or exists (
       select 1 from public.markets market_row
       where market_row.id = draft_row.market_slug
     ) then
    raise exception 'TEST_RESOLVED_SCHEDULER_PUBLISHED: %', scheduler_result;
  end if;

  begin
    update private.market_radar_fact_checks set reason = 'forbidden mutation'
    where id = prepare_fact_id;
    raise exception 'TEST_APPEND_ONLY_UPDATE_ACCEPTED';
  exception when sqlstate '55000' then null;
  end;
end;
$test$;

rollback;
