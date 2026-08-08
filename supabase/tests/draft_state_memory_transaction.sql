-- Matriz transaccional de Paso 13.5.2.
-- Requiere la migración 20260808120000 y siempre termina en ROLLBACK.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';

do $test$
declare
  admin_id uuid;
  seed private.market_drafts%rowtype;
  draft_row private.market_drafts%rowtype;
  draft_id_value uuid;
  version_one_id bigint;
  test_binding_id uuid;
  previous_binding_sources jsonb;
  current_binding_sources jsonb;
  effective_id bigint;
  human_time timestamptz;
  payload jsonb;
  reordered_sources jsonb;
  result jsonb;
  replay jsonb;
  beginning jsonb;
  recorded jsonb;
  attempt_id uuid;
  stale_attempt_id uuid;
  technical_status text;
  context_value jsonb;
  random_non_admin uuid := gen_random_uuid();
begin
  select user_row.id into admin_id
  from auth.users user_row
  where coalesce((user_row.raw_app_meta_data ->> 'oraklo_admin')::boolean, false)
  order by user_row.created_at
  limit 1;
  if admin_id is null then raise exception 'TEST_ADMIN_REQUIRED'; end if;

  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', admin_id, 'role', 'authenticated')::text,
    true
  );

  select * into seed
  from private.market_drafts
  where id = '6e1992a5-def7-4394-8b4a-4f9561ac0600'::uuid;
  if not found then raise exception 'TEST_SEED_DRAFT_REQUIRED'; end if;

  payload := private.market_draft_source_payload(seed) || jsonb_build_object(
    'market_slug', 'memory-test-' || replace(gen_random_uuid()::text, '-', ''),
    '_idempotency_key', gen_random_uuid(),
    '_change_origin', 'transaction_test_create',
    '_timestamp_precision', 'milliseconds-v1'
  );
  result := public.save_market_draft(null, null, payload);
  draft_id_value := (result -> 'draft' ->> 'id')::uuid;
  if not coalesce((result ->> 'changed')::boolean, false) then
    raise exception 'TEST_CREATE_DID_NOT_CHANGE';
  end if;

  select * into draft_row from private.market_drafts where id = draft_id_value;
  select id into version_one_id
  from private.market_draft_versions
  where draft_id = draft_id_value and content_version = 1;
  if version_one_id is null then raise exception 'TEST_INITIAL_SNAPSHOT_MISSING'; end if;
  if draft_row.evaluation_ends_at <> seed.evaluation_ends_at
     or extract(milliseconds from draft_row.evaluation_ends_at) <> extract(milliseconds from seed.evaluation_ends_at)
     or draft_row.timezone is distinct from seed.timezone then
    raise exception 'TEST_DATETIME_ROUNDTRIP_LOSS';
  end if;

  insert into private.market_source_bindings(
    draft_id, market_id, origin_type, origin_id, expert_run_id, plan_version,
    contract_schema_version, policy_version, contract_hash, resolution_contract,
    status, validation, provider, adapter_version, monitor_required,
    monitor_readiness, locked_at, locked_by
  )
  select
    draft_id_value, null, binding.origin_type,
    binding.origin_id || ':transaction-test:' || draft_id_value::text,
    binding.expert_run_id, 1, binding.contract_schema_version,
    binding.policy_version, binding.contract_hash, binding.resolution_contract,
    'draft', binding.validation, binding.provider, binding.adapter_version,
    binding.monitor_required, binding.monitor_readiness, null, null
  from private.market_source_bindings binding
  where binding.draft_id = seed.id and binding.status <> 'superseded'
  order by binding.plan_version desc
  limit 1
  returning id into test_binding_id;
  if test_binding_id is null then raise exception 'TEST_SEED_BINDING_REQUIRED'; end if;

  insert into private.market_source_binding_sources(
    binding_id, source_id, source_url, role, precedence, fallback_condition, required
  )
  select
    test_binding_id, source.source_id, source.source_url, source.role,
    source.precedence, source.fallback_condition, source.required
  from private.market_source_binding_sources source
  where source.binding_id = (
    select binding.id
    from private.market_source_bindings binding
    where binding.draft_id = seed.id and binding.status <> 'superseded'
    order by binding.plan_version desc
    limit 1
  );

  select jsonb_agg(jsonb_build_object(
    'url', source.source_url,
    'role', source.role,
    'precedence', source.precedence,
    'required', source.required,
    'fallback_condition', source.fallback_condition
  ) order by source.source_url)
  into previous_binding_sources
  from private.market_source_binding_sources source
  where source.binding_id = test_binding_id;

  select jsonb_agg(item.value order by item.ordinality desc)
  into reordered_sources
  from jsonb_array_elements(payload -> 'alternative_sources') with ordinality item(value, ordinality);
  payload := payload || jsonb_build_object(
    'question', '  ' || replace(payload ->> 'question', ' ', '  ') || E'\r\n',
    'alternative_sources', coalesce(reordered_sources, '[]'::jsonb),
    '_idempotency_key', gen_random_uuid(),
    '_change_origin', 'transaction_test_noop'
  );
  result := public.save_market_draft(draft_id_value, 1, payload);
  if coalesce((result ->> 'changed')::boolean, true)
     or not coalesce((result ->> 'review_preserved')::boolean, false)
     or not coalesce((result ->> 'version_unchanged')::boolean, false) then
    raise exception 'TEST_CANONICAL_NOOP_FAILED';
  end if;
  if (select count(*) from private.market_draft_versions where draft_id = draft_id_value) <> 1 then
    raise exception 'TEST_NOOP_CREATED_VERSION';
  end if;
  if (select count(*) from private.market_source_bindings where draft_id = draft_id_value) <> 1 then
    raise exception 'TEST_NOOP_VERSIONED_BINDING';
  end if;

  payload := payload || jsonb_build_object('_idempotency_key', gen_random_uuid());
  result := public.save_market_draft(draft_id_value, 1, payload);
  replay := public.save_market_draft(draft_id_value, 1, payload);
  if not coalesce((replay ->> 'idempotency_replay')::boolean, false)
     or (select count(*) from private.market_draft_versions where draft_id = draft_id_value) <> 1 then
    raise exception 'TEST_IDEMPOTENCY_REPLAY_FAILED';
  end if;

  beginning := public.begin_market_draft_review_v2(
    draft_id_value, 1, gen_random_uuid(),
    'atinara-market-gate-v2',
    'atinara-market-review-policy-v2',
    'atinara-market-draft-schema-v2',
    false
  );
  if beginning ->> 'status' <> 'in_progress' then
    raise exception 'TEST_REVIEW_DID_NOT_START: %', beginning;
  end if;
  attempt_id := (beginning ->> 'attempt_id')::uuid;
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', admin_id, 'role', 'service_role')::text,
    true
  );
  recorded := public.record_market_draft_review_v2(
    attempt_id, 'approved', '[]'::jsonb, '[]'::jsonb,
    admin_id, null, jsonb_build_object('model', 'transaction-mock', 'http_status', 200)
  );
  if recorded ->> 'status' <> 'approved' then raise exception 'TEST_APPROVAL_FAILED'; end if;
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', admin_id, 'role', 'authenticated')::text,
    true
  );

  foreach technical_status in array array[
    'invalid_response', 'provider_rate_limited', 'provider_timeout', 'provider_unavailable'
  ] loop
    beginning := public.begin_market_draft_review_v2(
      draft_id_value, 1, gen_random_uuid(),
      'atinara-market-gate-v2',
      'atinara-market-review-policy-v2',
      'atinara-market-draft-schema-v2',
      true
    );
    attempt_id := (beginning ->> 'attempt_id')::uuid;
    perform set_config(
      'request.jwt.claims',
      jsonb_build_object('sub', admin_id, 'role', 'service_role')::text,
      true
    );
    recorded := public.record_market_draft_review_v2(
      attempt_id, technical_status, '[]'::jsonb, '[]'::jsonb,
      admin_id, upper(technical_status),
      jsonb_build_object('model', 'transaction-mock', 'http_status', case when technical_status = 'provider_rate_limited' then 429 else 503 end)
    );
    if not coalesce((recorded ->> 'effective_review_preserved')::boolean, false)
       or recorded ->> 'review_status' <> 'approved' then
      raise exception 'TEST_TECHNICAL_FAILURE_REPLACED_APPROVAL: %', technical_status;
    end if;
    perform set_config(
      'request.jwt.claims',
      jsonb_build_object('sub', admin_id, 'role', 'authenticated')::text,
      true
    );
  end loop;

  select * into draft_row from private.market_drafts where id = draft_id_value;
  effective_id := private.market_current_effective_review_id(draft_row);
  human_time := clock_timestamp();
  update private.market_drafts set
    workflow_status = 'human_confirmed',
    human_confirmed_at = human_time,
    human_confirmed_by = admin_id,
    human_confirmed_fingerprint = content_fingerprint,
    human_confirmed_review_id = effective_id
  where id = draft_id_value;
  payload := private.market_draft_source_payload(draft_row) || jsonb_build_object(
    '_idempotency_key', gen_random_uuid(),
    '_change_origin', 'transaction_test_confirmed_noop',
    '_timestamp_precision', 'milliseconds-v1'
  );
  result := public.save_market_draft(draft_id_value, 1, payload);
  select * into draft_row from private.market_drafts where id = draft_id_value;
  if coalesce((result ->> 'changed')::boolean, true)
     or draft_row.human_confirmed_at is distinct from human_time
     or draft_row.effective_review_id is distinct from effective_id then
    raise exception 'TEST_NOOP_DID_NOT_PRESERVE_LAST_GOOD_STATE';
  end if;

  beginning := public.begin_market_draft_review_v2(
    draft_id_value, 1, gen_random_uuid(),
    'atinara-market-gate-v2',
    'atinara-market-review-policy-v2',
    'atinara-market-draft-schema-v2',
    true
  );
  stale_attempt_id := (beginning ->> 'attempt_id')::uuid;
  payload := private.market_draft_source_payload(draft_row) || jsonb_build_object(
    'question', draft_row.question || ' · cambio material de prueba',
    '_idempotency_key', gen_random_uuid(),
    '_change_origin', 'transaction_test_material_change',
    '_timestamp_precision', 'milliseconds-v1'
  );
  result := public.save_market_draft(draft_id_value, 1, payload);
  select * into draft_row from private.market_drafts where id = draft_id_value;
  if draft_row.content_version <> 2
     or draft_row.effective_review_id is not null
     or draft_row.human_confirmed_at is not null
     or (select count(*) from private.market_draft_versions where draft_id = draft_id_value) <> 2 then
    raise exception 'TEST_MATERIAL_CHANGE_DID_NOT_INVALIDATE_STATE';
  end if;
  select jsonb_agg(jsonb_build_object(
    'url', source.source_url,
    'role', source.role,
    'precedence', source.precedence,
    'required', source.required,
    'fallback_condition', source.fallback_condition
  ) order by source.source_url)
  into current_binding_sources
  from private.market_source_binding_sources source
  where source.binding_id = (
    select binding.id
    from private.market_source_bindings binding
    where binding.draft_id = draft_id_value and binding.status <> 'superseded'
    order by binding.plan_version desc
    limit 1
  );
  if previous_binding_sources is distinct from current_binding_sources
     or (select max(plan_version) from private.market_source_bindings where draft_id = draft_id_value) <> 2 then
    raise exception 'TEST_BINDING_ROLES_OR_PRECEDENCE_LOST';
  end if;

  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', admin_id, 'role', 'service_role')::text,
    true
  );
  recorded := public.record_market_draft_review_v2(
    stale_attempt_id, 'approved', '[]'::jsonb, '[]'::jsonb,
    admin_id, null, jsonb_build_object('model', 'transaction-mock', 'http_status', 200)
  );
  if recorded ->> 'status' <> 'stale' then raise exception 'TEST_STALE_RESPONSE_NOT_IGNORED'; end if;
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', admin_id, 'role', 'authenticated')::text,
    true
  );

  result := public.restore_market_draft_version(
    draft_id_value, 2, version_one_id, gen_random_uuid()
  );
  select * into draft_row from private.market_drafts where id = draft_id_value;
  if draft_row.content_version <> 3
     or draft_row.review_status <> 'approved'
     or draft_row.workflow_status <> 'review_approved'
     or draft_row.human_confirmed_at is not null
     or not coalesce((result ->> 'review_reused_from_memory')::boolean, false) then
    raise exception 'TEST_APPROVED_VERSION_RESTORE_FAILED';
  end if;

  begin
    perform public.publish_market_draft(draft_id_value, 3, null);
    raise exception 'TEST_PUBLICATION_WAS_NOT_BLOCKED';
  exception when others then
    if sqlerrm = 'TEST_PUBLICATION_WAS_NOT_BLOCKED'
       or position('CURRENT_APPROVAL_AND_CONFIRMATION_REQUIRED' in sqlerrm) = 0 then
      raise;
    end if;
  end;

  beginning := public.begin_market_draft_review_v2(
    draft_id_value, 3, gen_random_uuid(),
    'atinara-market-gate-v2',
    'atinara-market-review-policy-v2',
    'atinara-market-draft-schema-v2',
    true
  );
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', admin_id, 'role', 'service_role')::text,
    true
  );
  recorded := public.record_market_draft_review_v2(
    (beginning ->> 'attempt_id')::uuid, 'provider_timeout', '[]'::jsonb, '[]'::jsonb,
    admin_id, 'PROVIDER_TIMEOUT', jsonb_build_object('model', 'transaction-mock', 'duration_ms', 35000)
  );
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', admin_id, 'role', 'authenticated')::text,
    true
  );
  context_value := public.get_market_draft_expert_repair_context(draft_id_value);
  if context_value ->> 'repair_applicable' <> 'false'
     or context_value -> 'technical_incident' is null then
    raise exception 'TEST_CORRECTOR_ACCEPTED_INFRASTRUCTURE_FAILURE';
  end if;

  begin
    update private.market_draft_versions set change_origin = 'forbidden' where id = version_one_id;
    raise exception 'TEST_IMMUTABILITY_WAS_NOT_ENFORCED';
  exception when others then
    if sqlerrm = 'TEST_IMMUTABILITY_WAS_NOT_ENFORCED'
       or position('MARKET_DRAFT_VERSION_IMMUTABLE' in sqlerrm) = 0 then
      raise;
    end if;
  end;

  if has_function_privilege('anon', 'public.save_market_draft(uuid,bigint,jsonb)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.record_market_draft_review_v2(uuid,text,jsonb,jsonb,uuid,text,jsonb)', 'EXECUTE') then
    raise exception 'TEST_RPC_PRIVILEGES_TOO_BROAD';
  end if;
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', random_non_admin, 'role', 'authenticated')::text,
    true
  );
  begin
    perform public.get_admin_market_draft(draft_id_value);
    raise exception 'TEST_NON_ADMIN_WAS_NOT_BLOCKED';
  exception when others then
    if sqlerrm = 'TEST_NON_ADMIN_WAS_NOT_BLOCKED'
       or position('ADMIN_REQUIRED' in sqlerrm) = 0 then
      raise;
    end if;
  end;
end;
$test$;

select jsonb_build_object(
  'status', 'passed',
  'transaction', 'rolled_back',
  'cases', jsonb_build_array(
    'canonical_noop', 'same_key_replay', 'datetime_precision', 'source_reordering',
    'binding_roles_and_precedence',
    'effective_review', 'invalid_response', '429', 'timeout', '5xx',
    'human_confirmation_preservation', 'material_change', 'stale_response',
    'approved_version_restore', 'publication_block', 'corrector_infrastructure_block',
    'immutable_snapshots', 'anon_denied', 'non_admin_denied'
  )
) as draft_state_memory_test;

rollback;
