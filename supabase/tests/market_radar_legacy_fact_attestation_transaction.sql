-- Matriz transaccional del puente factual legacy. Ejecutar únicamente después
-- de 140 y 145 (puede convivir con 150/160/170) y conservar siempre ROLLBACK.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';

do $shape_and_acl$
declare
  history_row supabase_migrations.schema_migrations%rowtype;
begin
  if not exists (
       select 1 from information_schema.columns
       where table_schema = 'private' and table_name = 'market_source_registry'
         and column_name in (
           'provider','source_name','canonical_domain','external_entity_id',
           'allowed_roles','authority_tier','categories','access_method',
           'health_status','retention_policy','parser_version','active',
           'created_at','updated_at'
         )
       group by table_schema, table_name having count(*) = 14
     )
     or exists (
       select 1 from information_schema.columns
       where table_schema = 'private' and table_name = 'market_source_registry'
         and column_name = 'registry_scope'
     ) then
    raise exception 'TEST_RADAR_SOURCE_REGISTRY_SHAPE_MISMATCH';
  end if;
  if (select count(*) from private.market_source_registry
      where provider = 'radar' and active
        and authority_tier = 'primary'
        and allowed_roles @> '["radar_fact_evidence"]'::jsonb) < 10
     or (select count(*) from private.market_source_registry
      where provider = 'radar_provider' and active
        and authority_tier = 'primary'
        and allowed_roles @> '["provider_fact"]'::jsonb) < 2 then
    raise exception 'TEST_RADAR_SOURCE_REGISTRY_BOOTSTRAP_MISMATCH';
  end if;

  select * into history_row
  from supabase_migrations.schema_migrations migration
  where migration.version = '20260809140000';
  if not found
     or history_row.name is distinct from 'authoritative_radar_fact_gate_v1' then
    raise exception 'TEST_AUTHORITATIVE_GATE_HISTORY_NOT_RECONCILED';
  end if;
  if history_row.created_by = 'atinara_reconcile_authoritative_radar_fact_gate_v2'
     and not exists (
       select 1 from unnest(coalesce(history_row.statements, array[]::text[])) statement
       where statement like '%3e5a1b4567a202d359380fc1f31d3988b2a2b934f1a77eefd58f46901b5949db%'
         and statement like '%91f532bc85abba7538c0d53ff0e6d3c534c4b5e40a7f11b0bd538c15a25024e6%'
     ) then
    raise exception 'TEST_AUTHORITATIVE_GATE_HISTORY_AUDIT_HASH_MISSING';
  end if;

  if to_regclass('private.market_radar_legacy_fact_attestations') is null
     or to_regprocedure(
       'public.attest_legacy_market_radar_draft_fact_v1(uuid,uuid,bigint,text,bigint,bigint,uuid)'
     ) is null
     or to_regprocedure(
       'private.market_radar_legacy_fact_attestation_valid_v1(private.market_drafts,jsonb,timestamp with time zone)'
     ) is null then
    raise exception 'TEST_LEGACY_FACT_ATTESTATION_OBJECTS_MISSING';
  end if;

  if has_table_privilege('service_role','private.market_radar_legacy_fact_attestations','SELECT')
     or has_table_privilege('service_role','private.market_radar_legacy_fact_attestations','INSERT')
     or has_table_privilege('service_role','private.market_radar_legacy_fact_attestations','UPDATE')
     or has_table_privilege('service_role','private.market_radar_legacy_fact_attestations','DELETE')
     or has_sequence_privilege(
       'service_role','private.market_radar_legacy_fact_attestations_id_seq','USAGE'
     ) then
    raise exception 'TEST_LEGACY_FACT_ATTESTATION_RAW_SERVICE_ACL';
  end if;
  if has_function_privilege(
       'authenticated',
       'public.attest_legacy_market_radar_draft_fact_v1(uuid,uuid,bigint,text,bigint,bigint,uuid)',
       'EXECUTE'
     )
     or not has_function_privilege(
       'service_role',
       'public.attest_legacy_market_radar_draft_fact_v1(uuid,uuid,bigint,text,bigint,bigint,uuid)',
       'EXECUTE'
     ) then
    raise exception 'TEST_LEGACY_FACT_ATTESTATION_RPC_ACL';
  end if;
  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'private.market_radar_legacy_fact_attestations'::regclass
      and tgname = 'reject_market_radar_legacy_fact_attestation_mutation'
      and tgenabled <> 'D' and not tgisinternal
  ) then
    raise exception 'TEST_LEGACY_FACT_ATTESTATION_APPEND_ONLY_TRIGGER_MISSING';
  end if;
end;
$shape_and_acl$;

set local role service_role;

do $service_raw_dml_denied$
begin
  begin
    perform 1 from private.market_radar_legacy_fact_attestations limit 1;
    raise exception 'TEST_SERVICE_RAW_ATTESTATION_SELECT_ACCEPTED';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into private.market_radar_legacy_fact_attestations default values;
    raise exception 'TEST_SERVICE_RAW_ATTESTATION_INSERT_ACCEPTED';
  exception when insufficient_privilege then null;
  end;
  begin
    update private.market_radar_legacy_fact_attestations
    set attestation_sha256 = attestation_sha256 where false;
    raise exception 'TEST_SERVICE_RAW_ATTESTATION_UPDATE_ACCEPTED';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from private.market_radar_legacy_fact_attestations where false;
    raise exception 'TEST_SERVICE_RAW_ATTESTATION_DELETE_ACCEPTED';
  exception when insufficient_privilege then null;
  end;
  begin
    perform nextval('private.market_radar_legacy_fact_attestations_id_seq'::regclass);
    raise exception 'TEST_SERVICE_RAW_ATTESTATION_SEQUENCE_ACCEPTED';
  exception when insufficient_privilege then null;
  end;
end;
$service_raw_dml_denied$;

reset role;

do $legacy_bridge$
declare
  admin_id uuid;
  suffix text := replace(gen_random_uuid()::text, '-', '');
  external_id_value text := 'kalshi:LEGACY-BRIDGE-' || replace(gen_random_uuid()::text, '-', '');
  candidate_id_value uuid;
  draft_id_value uuid;
  draft_version_value bigint;
  draft_fingerprint_value text;
  candidate_revision_value bigint;
  current_revalidation_fact_id bigint;
  origin_prepare_fact_id bigint;
  fact_count_before bigint;
  fact_count_after bigint;
  attestation_count_before bigint;
  audit_count_before bigint;
  result_value jsonb;
  save_result jsonb;
  revalidation_result jsonb;
  resolved_result jsonb;
  draft_payload jsonb;
  verification_payload jsonb;
  fact_payload jsonb;
  context_snapshot jsonb;
  source_snapshot jsonb;
  resolved_source_snapshot jsonb;
  candidate private.external_market_candidates%rowtype;
  draft_row private.market_drafts%rowtype;
  current_fact private.market_radar_fact_checks%rowtype;
  origin_fact private.market_radar_fact_checks%rowtype;
  attestation private.market_radar_legacy_fact_attestations%rowtype;
  expected_failure boolean;
begin
  select user_row.id into admin_id
  from auth.users user_row
  where coalesce((user_row.raw_app_meta_data ->> 'oraklo_admin')::boolean, false)
  order by user_row.created_at
  limit 1;
  if admin_id is null then raise exception 'TEST_ADMIN_REQUIRED'; end if;

  insert into private.external_market_candidates(
    provider, external_id, external_event_id, external_url, fingerprint,
    normalizer_version, normalized_payload, source_status, atinara_category,
    source_excerpt, quality_status, quality_score, score_breakdown, warnings,
    duplicate_matches, fetched_at, expires_at, state, verification_status,
    verification_reason_code, verification_evidence, event_group_key,
    external_event_url, external_market_url
  ) values (
    'kalshi', external_id_value, 'LEGACY-BRIDGE-' || suffix,
    'https://kalshi.com/markets/legacy-bridge-' || suffix,
    'legacy-bridge-' || suffix, 'atinara-radar-v2',
    jsonb_build_object(
      'provider', 'kalshi', 'external_id', external_id_value,
      'external_event_id', 'LEGACY-BRIDGE-' || suffix,
      'external_market_id', 'LEGACY-BRIDGE-' || suffix || '-YES',
      'event_group_key', 'kalshi:LEGACY-BRIDGE-' || suffix,
      'eligibility_policy_version', 'atinara-prediction-policy-v4',
      'source_status', 'active',
      'source_title', 'Legacy bridge transaction ' || suffix,
      'source_question', 'Will the legacy bridge event happen before October 2026?',
      'source_close_at', now() + interval '40 days',
      'source_resolution_rules', 'Resolves from the official source.',
      'source_resolution_url', 'https://www.playstation.com/en-us/',
      'atinara_question', '¿Ocurrirá el fixture legacy antes de octubre de 2026?',
      'atinara_category', 'Lanzamientos',
      'atinara_resolution_criteria', 'Sí si la fuente oficial lo confirma antes del plazo.',
      'atinara_resolution_source_url', 'https://www.playstation.com/en-us/',
      'hard_reject_reasons', '[]'::jsonb,
      'warnings', '[]'::jsonb, 'duplicate_matches', '[]'::jsonb
    ),
    'active', 'Lanzamientos', '{}'::jsonb, 'needs_review', 90,
    '{}'::jsonb, '[]'::jsonb, '[]'::jsonb, now(), now() + interval '15 minutes',
    'needs_review', 'needs_review', 'VERIFICATION_REQUIRED', '[]'::jsonb,
    'kalshi:LEGACY-BRIDGE-' || suffix,
    'https://kalshi.com/markets/legacy-bridge-' || suffix,
    'https://kalshi.com/markets/legacy-bridge-' || suffix
  ) returning id into candidate_id_value;

  draft_payload := jsonb_build_object(
    'market_slug', 'legacy-fact-bridge-' || left(suffix, 24),
    'question', '¿Ocurrirá el fixture legacy antes del plazo?',
    'subject', 'Legacy bridge transaction ' || suffix,
    'category', 'Lanzamientos', 'yes_option', 'Sí', 'no_option', 'No',
    'evaluation_period_label', 'Hasta el plazo transaccional',
    'evaluation_ends_at', date_trunc('second', now() + interval '30 days'),
    'timezone', 'Europe/Madrid',
    'resolution_deadline', date_trunc('second', now() + interval '31 days'),
    'yes_criteria', 'Sí si la fuente primaria confirma el evento dentro del plazo.',
    'no_criteria', 'No si el plazo termina sin confirmación oficial.',
    'edge_cases', 'Los aplazamientos no amplían el plazo automáticamente.',
    'primary_source', jsonb_build_object('url', 'https://www.playstation.com/en-us/'),
    'alternative_sources', '[]'::jsonb,
    'delay_treatment', 'Se conserva el plazo aprobado.',
    'cancellation_treatment', 'Una cancelación exige revisión humana.',
    'leak_treatment', 'Las filtraciones no resuelven el mercado.',
    'rename_treatment', 'Un cambio de nombre conserva la identidad.',
    'assumptions', 'Solo cuenta la fuente primaria pública.',
    'public_criteria', 'La resolución aplica literalmente los criterios aprobados.',
    'description', 'Fixture legacy revertido por la matriz transaccional.',
    '_idempotency_key', gen_random_uuid(),
    '_change_origin', 'legacy_fact_attestation_transaction',
    '_timestamp_precision', 'milliseconds-v1'
  );
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', admin_id, 'role', 'authenticated')::text,
    true
  );
  save_result := public.save_market_draft(null, null, draft_payload);
  draft_id_value := nullif(save_result #>> '{draft,id}', '')::uuid;
  if draft_id_value is null then
    raise exception 'TEST_LEGACY_DRAFT_CREATE_FAILED: %', save_result;
  end if;

  update private.market_drafts draft_alias set
    radar_candidate_id = candidate_id_value,
    source_provenance = jsonb_build_object(
      'provider', 'kalshi', 'external_id', external_id_value,
      'external_event_id', 'LEGACY-BRIDGE-' || suffix,
      'event_group_key', 'kalshi:LEGACY-BRIDGE-' || suffix,
      'normalizer_version', 'atinara-radar-v2',
      'prepared_at', clock_timestamp()
    )
  where draft_alias.id = draft_id_value
  returning * into draft_row;
  update private.external_market_candidates candidate_alias set
    state = 'prepared', prepared_draft_id = draft_id_value
  where candidate_alias.id = candidate_id_value;

  select * into candidate
  from private.external_market_candidates candidate_alias
  where candidate_alias.id = candidate_id_value;
  select * into draft_row
  from private.market_drafts draft_alias where draft_alias.id = draft_id_value;
  draft_version_value := draft_row.content_version;
  draft_fingerprint_value := draft_row.content_fingerprint;
  if candidate.state <> 'prepared'
     or candidate.prepared_draft_id <> draft_id_value
     or draft_row.source_provenance ? 'radar_fact_check_id'
     or draft_fingerprint_value !~ '^[0-9a-f]{64}$' then
    raise exception 'TEST_LEGACY_FIXTURE_INVALID';
  end if;

  context_snapshot := jsonb_build_object(
    'fact_context_schema_version', 'atinara-radar-fact-context-v2',
    'provider', 'kalshi', 'external_id', external_id_value,
    'external_event_id', 'LEGACY-BRIDGE-' || suffix,
    'external_market_id', 'LEGACY-BRIDGE-' || suffix || '-YES',
    'event_group_key', 'kalshi:LEGACY-BRIDGE-' || suffix,
    'source_status', 'active', 'source_result', null, 'source_settled_at', null,
    'canonical_event_children', jsonb_build_array(jsonb_build_object(
      'market_id', 'LEGACY-BRIDGE-' || suffix || '-YES',
      'question', 'Will the legacy bridge event happen before October 2026?',
      'status', 'active', 'result', null
    )),
    'canonical_event_children_total', 1,
    'canonical_event_children_complete', true
  );
  source_snapshot := jsonb_build_array(jsonb_build_object(
    'title', 'Official legacy bridge fixture',
    'url', 'https://www.playstation.com/en-us/',
    'source_type', 'official',
    'supports', 'The legacy bridge event will happen on September 1, 2026.',
    'retrieved_at', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'retrieval_status', 'verified_content',
    'evidence_basis', 'retrieved_content',
    'parser_version', 'atinara-official-content-v1',
    'content_sha256', repeat('a', 64), 'content_type', 'text/html',
    'claim_status', 'direct', 'direct_claim', true, 'claim_verifiable', true,
    'relevance_score', 100, 'supported_reason_codes', '[]'::jsonb,
    'supported_fact_statuses', jsonb_build_array('unresolved'),
    'supported_contract_kinds', jsonb_build_array('announcement'),
    'unresolved_proof', true,
    'unresolved_proof_basis', 'official_future_date_v1',
    'unresolved_until', to_char((now() + interval '20 days') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'unresolved_proof_excerpt', 'The legacy bridge event will happen on September 1, 2026.',
    'unresolved_proof_excerpt_sha256', encode(extensions.digest(convert_to(
      'The legacy bridge event will happen on September 1, 2026.', 'UTF8'
    ), 'sha256'), 'hex')
  ));
  verification_payload := private.market_radar_safe_payload(candidate) || jsonb_build_object(
    'eligibility_policy_version', 'atinara-prediction-policy-v4',
    'fact_policy_version', 'atinara-terminal-fact-gate-v2',
    'verification_status', 'verified_open', 'verification_reason_code', null,
    'verification_reason', 'Revalidación autoritativa del fixture legacy.',
    'verified_at', now(), 'verification_expires_at', now() + interval '15 minutes',
    'verification_evidence', source_snapshot,
    'cache_expires_at', now() + interval '15 minutes'
  );
  fact_payload := jsonb_build_object(
    'attempt_id', gen_random_uuid(), 'purpose', 'revalidate',
    'provider', 'kalshi', 'external_id', external_id_value,
    'event_group_key', 'kalshi:LEGACY-BRIDGE-' || suffix,
    'fact_context_fingerprint', repeat('0', 64),
    'fact_policy_version', 'atinara-terminal-fact-gate-v2',
    'fact_status', 'unresolved', 'verification_status', 'verified_open',
    'reason_code', null, 'reason', 'Revalidación autoritativa del fixture legacy.',
    'confidence', 100, 'evidence', source_snapshot,
    'checked_at', now(), 'expires_at', now() + interval '15 minutes',
    'context_snapshot', context_snapshot, 'context_sha256', repeat('0', 64),
    'source_snapshot', source_snapshot, 'source_sha256', repeat('0', 64),
    'decision_hash', repeat('0', 64)
  );
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', admin_id, 'role', 'service_role')::text,
    true
  );
  revalidation_result := public.apply_market_radar_revalidation_fact_v1(
    candidate.id, candidate.preparation_revision, 'atinara-radar-v2', now(),
    verification_payload, fact_payload
  );
  if not coalesce((revalidation_result ->> 'ok')::boolean, false) then
    raise exception 'TEST_LEGACY_REVALIDATION_FAILED: %', revalidation_result;
  end if;
  select * into candidate
  from private.external_market_candidates candidate_alias
  where candidate_alias.id = candidate_id_value;
  candidate_revision_value := candidate.preparation_revision;
  current_revalidation_fact_id := candidate.current_fact_check_id;
  if candidate.fact_check_purpose <> 'revalidate'
     or candidate.fact_status <> 'unresolved'
     or candidate.verification_status <> 'verified_open' then
    raise exception 'TEST_LEGACY_REVALIDATION_LINK_INVALID';
  end if;

  select count(*) into fact_count_before
  from private.market_radar_fact_checks where candidate_id = candidate.id;
  select count(*) into attestation_count_before
  from private.market_radar_legacy_fact_attestations where candidate_id = candidate.id;
  select count(*) into audit_count_before
  from private.market_admin_audit
  where draft_id = draft_id_value and action_code = 'RADAR_LEGACY_FACT_ATTESTED';

  result_value := public.attest_legacy_market_radar_draft_fact_v1(
    draft_id_value, candidate.id, draft_version_value,
    repeat('f', 64), candidate_revision_value,
    current_revalidation_fact_id, admin_id
  );
  if result_value ->> 'error' <> 'DRAFT_FINGERPRINT_MOVED' then
    raise exception 'TEST_LEGACY_TAMPERED_FINGERPRINT_ACCEPTED: %', result_value;
  end if;
  result_value := public.attest_legacy_market_radar_draft_fact_v1(
    draft_id_value, candidate.id, draft_version_value + 1,
    draft_fingerprint_value, candidate_revision_value,
    current_revalidation_fact_id, admin_id
  );
  if result_value ->> 'error' <> 'DRAFT_VERSION_MOVED' then
    raise exception 'TEST_LEGACY_TAMPERED_VERSION_ACCEPTED: %', result_value;
  end if;
  result_value := public.attest_legacy_market_radar_draft_fact_v1(
    draft_id_value, candidate.id, draft_version_value,
    draft_fingerprint_value, candidate_revision_value + 1,
    current_revalidation_fact_id, admin_id
  );
  if result_value ->> 'error' <> 'PREPARATION_REVISION_MISMATCH' then
    raise exception 'TEST_LEGACY_TAMPERED_REVISION_ACCEPTED: %', result_value;
  end if;
  result_value := public.attest_legacy_market_radar_draft_fact_v1(
    draft_id_value, candidate.id, draft_version_value,
    draft_fingerprint_value, candidate_revision_value,
    current_revalidation_fact_id + 999999, admin_id
  );
  if result_value ->> 'error' <> 'FACT_CHECK_REQUIRED' then
    raise exception 'TEST_LEGACY_TAMPERED_FACT_ACCEPTED: %', result_value;
  end if;
  result_value := public.attest_legacy_market_radar_draft_fact_v1(
    draft_id_value, candidate.id, draft_version_value,
    draft_fingerprint_value, candidate_revision_value,
    current_revalidation_fact_id, gen_random_uuid()
  );
  if result_value ->> 'error' <> 'ADMIN_REQUIRED' then
    raise exception 'TEST_LEGACY_NON_ADMIN_ACTOR_ACCEPTED: %', result_value;
  end if;
  if (select count(*) from private.market_radar_fact_checks where candidate_id = candidate.id)
       <> fact_count_before
     or (select count(*) from private.market_radar_legacy_fact_attestations where candidate_id = candidate.id)
       <> attestation_count_before then
    raise exception 'TEST_LEGACY_FAILED_ATTEMPT_PERSISTED_DML';
  end if;

  result_value := public.attest_legacy_market_radar_draft_fact_v1(
    draft_id_value, candidate.id, draft_version_value,
    draft_fingerprint_value, candidate_revision_value,
    current_revalidation_fact_id, admin_id
  );
  if not coalesce((result_value ->> 'ok')::boolean, false)
     or not coalesce((result_value ->> 'attested')::boolean, false) then
    raise exception 'TEST_LEGACY_ATTESTATION_FAILED: %', result_value;
  end if;

  select count(*) into fact_count_after
  from private.market_radar_fact_checks where candidate_id = candidate.id;
  select * into candidate
  from private.external_market_candidates candidate_alias where candidate_alias.id = candidate_id_value;
  select * into draft_row
  from private.market_drafts draft_alias where draft_alias.id = draft_id_value;
  select * into attestation
  from private.market_radar_legacy_fact_attestations row_alias
  where row_alias.draft_id = draft_id_value;
  origin_prepare_fact_id := attestation.origin_prepare_fact_check_id;
  select * into current_fact
  from private.market_radar_fact_checks fact_alias
  where fact_alias.id = current_revalidation_fact_id;
  select * into origin_fact
  from private.market_radar_fact_checks fact_alias
  where fact_alias.id = origin_prepare_fact_id;

  if fact_count_after <> fact_count_before + 1
     or (select count(*) from private.market_radar_legacy_fact_attestations
         where candidate_id = candidate.id) <> 1
     or candidate.preparation_revision <> candidate_revision_value
     or candidate.current_fact_check_id <> current_revalidation_fact_id
     or candidate.fact_check_purpose <> 'revalidate'
     or draft_row.content_version <> draft_version_value
     or draft_row.content_fingerprint <> draft_fingerprint_value
     or origin_fact.purpose <> 'prepare'
     or origin_fact.preparation_revision <> current_fact.preparation_revision
     or origin_fact.context_snapshot is distinct from current_fact.context_snapshot
     or origin_fact.context_sha256 is distinct from current_fact.context_sha256
     or origin_fact.source_snapshot is distinct from current_fact.source_snapshot
     or origin_fact.source_sha256 is distinct from current_fact.source_sha256
     or origin_fact.checked_at is distinct from current_fact.checked_at
     or origin_fact.expires_at is distinct from current_fact.expires_at
     or draft_row.source_provenance ->> 'radar_fact_check_id' <> origin_fact.id::text
     or draft_row.source_provenance ->> 'radar_legacy_revalidation_fact_check_id'
       <> current_fact.id::text
     or draft_row.source_provenance ->> 'radar_legacy_attestation_id' <> attestation.id::text
     or draft_row.source_provenance ->> 'radar_legacy_attestation_version'
       <> 'atinara-radar-legacy-attestation-v1'
     or not private.market_radar_legacy_fact_attestation_valid_v1(
       draft_row, draft_row.source_provenance, now()
     ) then
    raise exception 'TEST_LEGACY_ATTESTATION_BINDING_INVALID: %', result_value;
  end if;
  perform private.assert_market_radar_draft_fact_current_v1(draft_row, now());
  if (select count(*) from private.market_admin_audit
      where draft_id = draft_id_value and action_code = 'RADAR_LEGACY_FACT_ATTESTED')
       <> audit_count_before + 1 then
    raise exception 'TEST_LEGACY_ATTESTATION_AUDIT_MISSING';
  end if;

  -- Repetir la misma operación no crea otra fila ni otro prepare fact.
  result_value := public.attest_legacy_market_radar_draft_fact_v1(
    draft_id_value, candidate.id, draft_version_value,
    draft_fingerprint_value, candidate_revision_value,
    current_revalidation_fact_id, admin_id
  );
  if not coalesce((result_value ->> 'ok')::boolean, false)
     or coalesce((result_value ->> 'attested')::boolean, true)
     or not coalesce((result_value ->> 'already_authoritative')::boolean, false)
     or (select count(*) from private.market_radar_fact_checks where candidate_id = candidate.id)
       <> fact_count_after
     or (select count(*) from private.market_radar_legacy_fact_attestations
         where candidate_id = candidate.id) <> 1 then
    raise exception 'TEST_LEGACY_ATTESTATION_NOT_IDEMPOTENT: %', result_value;
  end if;

  expected_failure := false;
  begin
    update private.market_drafts draft_alias set
      source_provenance = draft_alias.source_provenance
        || jsonb_build_object('radar_fact_check_id', current_revalidation_fact_id)
    where draft_alias.id = draft_id_value;
  exception when others then
    if position('RADAR_DRAFT_FACT_LINK_IMMUTABLE' in sqlerrm) > 0 then
      expected_failure := true;
    else raise; end if;
  end;
  if not expected_failure then raise exception 'TEST_LEGACY_FACT_LINK_TAMPER_ACCEPTED'; end if;

  -- Simula una reparación material posterior: la versión y la huella cambian,
  -- pero la procedencia prepare append-only queda ligada y la puerta sigue
  -- exigiendo el revalidate current. La atestación no se reescribe.
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', admin_id, 'role', 'authenticated')::text,
    true
  );
  save_result := public.save_market_draft(
    draft_id_value, draft_version_value,
    (draft_payload - '_idempotency_key') || jsonb_build_object(
      '_idempotency_key', gen_random_uuid(),
      '_change_origin', 'legacy_fact_attestation_repair_fixture',
      'description', 'Fixture legacy corregido sin perder la atestación factual.'
    )
  );
  select * into draft_row
  from private.market_drafts draft_alias where draft_alias.id = draft_id_value;
  if draft_row.content_version <= draft_version_value
     or draft_row.content_fingerprint = draft_fingerprint_value
     or draft_row.source_provenance ->> 'radar_fact_check_id' <> origin_prepare_fact_id::text
     or (select count(*) from private.market_radar_legacy_fact_attestations
         where draft_id = draft_id_value) <> 1 then
    raise exception 'TEST_LEGACY_REPAIR_LOST_FACT_MEMORY: %', save_result;
  end if;
  perform private.assert_market_radar_draft_fact_current_v1(draft_row, now());

  -- Si el mismo evento se resuelve después, revalidate persiste el terminal y
  -- la atestación antigua jamás autoriza confirmación, schedule o materialize.
  resolved_source_snapshot := jsonb_build_array(jsonb_build_object(
    'title', 'Official legacy bridge result',
    'url', 'https://www.playstation.com/en-us/', 'source_type', 'official',
    'supports', 'The complete official selection has published every result.',
    'retrieved_at', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'retrieval_status', 'verified_content', 'evidence_basis', 'retrieved_content',
    'parser_version', 'atinara-official-content-v1',
    'content_sha256', repeat('b', 64), 'content_type', 'text/html',
    'claim_status', 'direct', 'direct_claim', true, 'claim_verifiable', true,
    'relevance_score', 100, 'selection_complete', true,
    'supported_reason_codes', jsonb_build_array('EVENT_ALREADY_RESOLVED'),
    'supported_fact_statuses', jsonb_build_array('fully_resolved'),
    'supported_contract_kinds', '[]'::jsonb, 'unresolved_proof', false
  ));
  fact_payload := fact_payload || jsonb_build_object(
    'attempt_id', gen_random_uuid(), 'purpose', 'revalidate',
    'fact_status', 'fully_resolved', 'verification_status', 'rejected_resolved',
    'reason_code', 'EVENT_ALREADY_RESOLVED',
    'reason', 'La fuente oficial ya publicó el resultado.',
    'evidence', resolved_source_snapshot, 'source_snapshot', resolved_source_snapshot,
    'checked_at', now(), 'expires_at', now() + interval '15 minutes'
  );
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', admin_id, 'role', 'service_role')::text,
    true
  );
  resolved_result := public.apply_market_radar_revalidation_fact_v1(
    candidate.id, candidate.preparation_revision, 'atinara-radar-v2', now(),
    private.market_radar_safe_payload(candidate) || jsonb_build_object(
      'eligibility_policy_version', 'atinara-prediction-policy-v4',
      'fact_policy_version', 'atinara-terminal-fact-gate-v2',
      'verification_status', 'rejected_resolved',
      'verification_reason_code', 'EVENT_ALREADY_RESOLVED',
      'verification_reason', 'La fuente oficial ya publicó el resultado.',
      'verification_evidence', resolved_source_snapshot,
      'verified_at', now(), 'cache_expires_at', now() + interval '15 minutes'
    ), fact_payload
  );
  select * into candidate
  from private.external_market_candidates candidate_alias where candidate_alias.id = candidate_id_value;
  if coalesce((resolved_result ->> 'ok')::boolean, true)
     or resolved_result ->> 'error' <> 'RADAR_CANDIDATE_RESOLVED'
     or candidate.fact_status <> 'fully_resolved'
     or candidate.verification_status <> 'rejected_resolved' then
    raise exception 'TEST_LEGACY_RESOLVED_REVALIDATION_INVALID: %', resolved_result;
  end if;
  result_value := public.attest_legacy_market_radar_draft_fact_v1(
    draft_id_value, candidate.id, draft_row.content_version,
    draft_row.content_fingerprint, candidate.preparation_revision,
    candidate.current_fact_check_id, admin_id
  );
  if result_value ->> 'error' <> 'RADAR_EVENT_ALREADY_RESOLVED' then
    raise exception 'TEST_LEGACY_RESOLVED_ATTESTATION_ACCEPTED: %', result_value;
  end if;
  expected_failure := false;
  begin
    perform private.assert_market_radar_draft_fact_current_v1(draft_row, now());
  exception when others then
    if position('RADAR_EVENT_ALREADY_RESOLVED' in sqlerrm) > 0 then
      expected_failure := true;
    else raise; end if;
  end;
  if not expected_failure then raise exception 'TEST_LEGACY_RESOLVED_PUBLICATION_GATE_ACCEPTED'; end if;

  begin
    update private.market_radar_legacy_fact_attestations
    set attestation_sha256 = repeat('0', 64) where id = attestation.id;
    raise exception 'TEST_LEGACY_ATTESTATION_UPDATE_ACCEPTED';
  exception when others then
    if position('RADAR_LEGACY_FACT_ATTESTATION_APPEND_ONLY' in sqlerrm) = 0 then raise; end if;
  end;
end;
$legacy_bridge$;

rollback;
