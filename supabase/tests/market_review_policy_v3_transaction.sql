-- Regresión transaccional del corte de revisiones v3.
-- Requiere 20260809160000 y siempre termina en ROLLBACK.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';

do $test$
declare
  admin_id uuid;
  draft_row private.market_drafts%rowtype;
  draft_id_value uuid;
  version_id_value bigint;
  report_v2_id bigint;
  report_v3_id bigint;
  review_v2_id bigint;
  review_v3_id bigint;
  attempt_id_value uuid;
  review_request_key uuid;
  deterministic_draft_id uuid;
  deterministic_attempt_id uuid;
  deterministic_report_id bigint;
  payload jsonb;
  deterministic_payload jsonb;
  review_result jsonb;
  saved jsonb;
  beginning jsonb;
  replay jsonb;
  expected_failure boolean;
  fixture_suffix text := replace(gen_random_uuid()::text, '-', '');
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

  -- Fixture contractual completamente nuevo: no clona familia, child ni
  -- procedencia de un mercado real y deja que el trigger v4 derive identidad.
  payload := jsonb_build_object(
    'market_slug', 'review-policy-v3-test-' || fixture_suffix,
    'question', '¿Se anunciará oficialmente Proyecto Policy V3 ' || fixture_suffix || ' antes del 1 de enero de 2099?',
    'subject', 'Proyecto Policy V3 ' || fixture_suffix,
    'category', 'Tecnología',
    'yes_option', 'Sí',
    'no_option', 'No',
    'evaluation_period_label', 'Hasta el 31 de diciembre de 2098 a las 23:59:59 UTC, inclusive',
    'evaluation_ends_at', '2098-12-31T23:59:59.000Z',
    'closes_at', '2098-12-31T23:59:59.000Z',
    'timezone', 'UTC',
    'resolution_deadline', '2099-01-02T23:59:59.000Z',
    'yes_criteria', 'Se resuelve a Sí si la organización titular anuncia pública y oficialmente Proyecto Policy V3 ' || fixture_suffix || ' antes del cierre contractual.',
    'no_criteria', 'Se resuelve a No si al cierre contractual no existe el anuncio público y oficial definido en el criterio de Sí.',
    'edge_cases', 'Rumores, filtraciones, registros, patentes y publicaciones de terceros no cuentan; una fuente primaria contradictoria detiene la resolución.',
    'primary_source', jsonb_build_object(
      'url', 'https://example.com/policy-v3/' || fixture_suffix,
      'role', 'PRIMARY_RESOLUTION'
    ),
    'alternative_sources', jsonb_build_array(jsonb_build_object(
      'url', 'https://example.org/policy-v3/' || fixture_suffix,
      'role', 'CORROBORATION'
    )),
    'delay_treatment', 'Los retrasos no alteran el periodo contractual aprobado.',
    'cancellation_treatment', 'Una cancelación no equivale por sí sola al anuncio afirmado.',
    'leak_treatment', 'Las filtraciones y publicaciones no autorizadas no cuentan.',
    'rename_treatment', 'Un cambio de nombre requiere continuidad oficial inequívoca.',
    'assumptions', 'Las horas se comparan en UTC y los conflictos materiales se revisan de forma específica.',
    'public_criteria', 'Atinara comprobará el anuncio oficial en las fuentes públicas declaradas hasta el cierre inclusive.',
    'description', 'Mercado aislado de prueba transaccional para la puerta de revisión v3.',
    '_idempotency_key', gen_random_uuid(),
    '_change_origin', 'review_policy_v3_transaction_test',
    '_timestamp_precision', 'milliseconds-v1'
  );
  saved := public.save_market_draft(null, null, payload);
  draft_id_value := (saved -> 'draft' ->> 'id')::uuid;
  if draft_id_value is null then raise exception 'TEST_DRAFT_CREATE_FAILED: %', saved; end if;

  select * into draft_row from private.market_drafts where id = draft_id_value;
  if draft_row.family_version is distinct from 'atinara-market-family-v4'
     or draft_row.family_key is null
     or draft_row.family_child_key is null
     or (select count(*) from private.market_drafts duplicate
         where duplicate.family_version = draft_row.family_version
           and duplicate.family_key = draft_row.family_key
           and duplicate.family_child_key = draft_row.family_child_key) <> 1 then
    raise exception 'TEST_V3_FIXTURE_FAMILY_NOT_UNIQUE';
  end if;
  select id into version_id_value
  from private.market_draft_versions
  where draft_id = draft_id_value and content_version = draft_row.content_version;
  if version_id_value is null then raise exception 'TEST_V3_VERSION_MISSING'; end if;
  if (select policy_version from private.market_draft_versions where id = version_id_value)
       <> 'atinara-market-review-policy-v3'
     or (select schema_version from private.market_draft_versions where id = version_id_value)
       <> 'atinara-market-draft-schema-v3' then
    raise exception 'TEST_NEW_SNAPSHOT_NOT_V3';
  end if;

  insert into private.market_review_reports(
    draft_id, draft_version, content_fingerprint, validator_version,
    result, semantic_issues, editorial_notes, reviewed_by,
    policy_version, schema_version, canonical_fingerprint,
    review_classification, safe_provider_metadata
  ) values (
    draft_row.id, draft_row.content_version, draft_row.content_fingerprint,
    'atinara-market-gate-v2', 'approved', '[]'::jsonb, '[]'::jsonb, admin_id,
    'atinara-market-review-policy-v2', 'atinara-market-draft-schema-v2',
    draft_row.content_fingerprint, 'content', '{}'::jsonb
  ) returning id into report_v2_id;

  insert into private.market_effective_reviews(
    draft_id, draft_version, version_id, report_id, content_fingerprint,
    validator_version, policy_version, schema_version, compatibility_basis, active
  ) values (
    draft_row.id, draft_row.content_version, version_id_value, report_v2_id,
    draft_row.content_fingerprint, 'atinara-market-gate-v2',
    'atinara-market-review-policy-v2', 'atinara-market-draft-schema-v2',
    'transaction_test_v2_automatic', true
  ) returning id into review_v2_id;

  update private.market_drafts set
    effective_review_id = review_v2_id,
    reviewed_version = content_version,
    reviewed_fingerprint = content_fingerprint,
    review_status = 'approved',
    workflow_status = 'review_approved',
    human_confirmed_at = null,
    human_confirmed_by = null,
    human_confirmed_fingerprint = null,
    human_confirmed_review_id = null
  where id = draft_row.id;
  select * into draft_row from private.market_drafts where id = draft_id_value;

  if private.market_current_effective_review_id(draft_row) is not null
     or private.market_reusable_effective_review_id(draft_row.id, draft_row.content_fingerprint) is not null then
    raise exception 'TEST_UNCONFIRMED_V2_WAS_REUSED';
  end if;

  update private.market_effective_reviews set
    active = false,
    superseded_at = now()
  where id = review_v2_id;
  update private.market_drafts set effective_review_id = null where id = draft_id_value;

  insert into private.market_review_reports(
    draft_id, draft_version, content_fingerprint, validator_version,
    result, semantic_issues, editorial_notes, reviewed_by,
    policy_version, schema_version, canonical_fingerprint,
    review_classification, safe_provider_metadata
  ) values (
    draft_row.id, draft_row.content_version, draft_row.content_fingerprint,
    'atinara-market-gate-v3', 'approved', '[]'::jsonb, '[]'::jsonb, admin_id,
    'atinara-market-review-policy-v3', 'atinara-market-draft-schema-v3',
    draft_row.content_fingerprint, 'content', '{}'::jsonb
  ) returning id into report_v3_id;

  insert into private.market_effective_reviews(
    draft_id, draft_version, version_id, report_id, content_fingerprint,
    validator_version, policy_version, schema_version, compatibility_basis, active
  ) values (
    draft_row.id, draft_row.content_version, version_id_value, report_v3_id,
    draft_row.content_fingerprint, 'atinara-market-gate-v3',
    'atinara-market-review-policy-v3', 'atinara-market-draft-schema-v3',
    'transaction_test_v3_exact', true
  ) returning id into review_v3_id;
  update private.market_drafts set
    effective_review_id = review_v3_id,
    reviewed_version = content_version,
    reviewed_fingerprint = content_fingerprint,
    review_status = 'approved',
    workflow_status = 'review_approved'
  where id = draft_id_value;
  select * into draft_row from private.market_drafts where id = draft_id_value;

  if private.market_current_effective_review_id(draft_row) is distinct from review_v3_id
     or private.market_reusable_effective_review_id(draft_row.id, draft_row.content_fingerprint)
       is distinct from review_v3_id then
    raise exception 'TEST_V3_REVIEW_NOT_ACCEPTED';
  end if;
  beginning := public.begin_market_draft_review_v2(
    draft_id_value, draft_row.content_version, gen_random_uuid(),
    'atinara-market-gate-v3',
    'atinara-market-review-policy-v3',
    'atinara-market-draft-schema-v3',
    false
  );
  if beginning ->> 'status' <> 'approved_cached'
     or (beginning ->> 'effective_review_id')::bigint is distinct from review_v3_id then
    raise exception 'TEST_V3_BEGIN_DID_NOT_REUSE_CURRENT_APPROVAL: %', beginning;
  end if;

  update private.market_effective_reviews set
    active = false,
    revoked_at = now(),
    revocation_reason = 'transaction_test_isolate_human_v2'
  where id = review_v3_id;
  update private.market_effective_reviews set
    active = true,
    superseded_at = null
  where id = review_v2_id;
  update private.market_drafts set
    effective_review_id = review_v2_id,
    reviewed_version = content_version,
    reviewed_fingerprint = content_fingerprint,
    review_status = 'approved',
    workflow_status = 'human_confirmed',
    human_confirmed_at = now(),
    human_confirmed_by = admin_id,
    human_confirmed_fingerprint = content_fingerprint,
    human_confirmed_review_id = review_v2_id
  where id = draft_id_value;
  select * into draft_row from private.market_drafts where id = draft_id_value;

  if private.market_current_effective_review_id(draft_row) is distinct from review_v2_id
     or private.market_reusable_effective_review_id(draft_row.id, draft_row.content_fingerprint)
       is distinct from review_v2_id then
    raise exception 'TEST_MATERIAL_HUMAN_V2_NOT_PRESERVED';
  end if;

  update private.market_drafts
  set human_confirmed_fingerprint = repeat('0', 64)
  where id = draft_id_value;
  select * into draft_row from private.market_drafts where id = draft_id_value;
  if private.market_current_effective_review_id(draft_row) is not null
     or private.market_reusable_effective_review_id(draft_row.id, draft_row.content_fingerprint) is not null then
    raise exception 'TEST_STALE_HUMAN_V2_SURVIVED_FINGERPRINT_CHANGE';
  end if;

  expected_failure := false;
  begin
    perform public.begin_market_draft_review_v2(
      draft_id_value, draft_row.content_version, gen_random_uuid(),
      'atinara-market-gate-v2',
      'atinara-market-review-policy-v2',
      'atinara-market-draft-schema-v2',
      false
    );
  exception when sqlstate '22023' then
    if sqlerrm <> 'REVIEW_POLICY_OUTDATED' then raise; end if;
    expected_failure := true;
  end;
  if not expected_failure then raise exception 'TEST_V2_BEGIN_WAS_NOT_BLOCKED'; end if;

  review_request_key := gen_random_uuid();
  beginning := public.begin_market_draft_review_v2(
    draft_id_value, draft_row.content_version, review_request_key,
    'atinara-market-gate-v3',
    'atinara-market-review-policy-v3',
    'atinara-market-draft-schema-v3',
    false
  );
  if beginning ->> 'status' <> 'in_progress' then
    raise exception 'TEST_V3_BEGIN_NOT_ALLOWED: %', beginning;
  end if;
  attempt_id_value := (beginning ->> 'attempt_id')::uuid;
  replay := public.begin_market_draft_review_v2(
    draft_id_value, draft_row.content_version, review_request_key,
    'atinara-market-gate-v3',
    'atinara-market-review-policy-v3',
    'atinara-market-draft-schema-v3',
    false
  );
  if (replay ->> 'attempt_id')::uuid is distinct from attempt_id_value
     or not coalesce((replay ->> 'idempotency_replay')::boolean, false) then
    raise exception 'TEST_V3_BEGIN_REPLAY_FAILED: %', replay;
  end if;

  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', admin_id, 'role', 'service_role')::text,
    true
  );
  foreach review_result in array array[
    jsonb_build_object('result', 'rejected'),
    jsonb_build_object('result', 'inconclusive')
  ] loop
    expected_failure := false;
    begin
      perform public.record_market_draft_review_v2(
        attempt_id_value, review_result ->> 'result', '[]'::jsonb, '[]'::jsonb,
        admin_id, null, '{}'::jsonb
      );
    exception when sqlstate '22023' then
      if sqlerrm <> 'REVIEW_CONTENT_ISSUES_REQUIRED' then raise; end if;
      expected_failure := true;
    end;
    if not expected_failure then
      raise exception 'TEST_EMPTY_CONTENT_RESULT_WAS_ACCEPTED: %', review_result ->> 'result';
    end if;
  end loop;

  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', admin_id, 'role', 'authenticated')::text,
    true
  );
  deterministic_payload := payload || jsonb_build_object(
    'market_slug', 'review-policy-v3-deterministic-' || fixture_suffix,
    'question', '¿Se anunciará oficialmente Proyecto Deterministic V3 ' || fixture_suffix || ' antes del 1 de enero de 2099?',
    'subject', '',
    'yes_criteria', 'Se resuelve a Sí si existe un anuncio oficial inequívoco de Proyecto Deterministic V3 ' || fixture_suffix || ' antes del cierre contractual.',
    'no_criteria', 'Se resuelve a No si al cierre contractual no existe un anuncio oficial inequívoco de Proyecto Deterministic V3 ' || fixture_suffix || '.',
    'primary_source', jsonb_build_object(
      'url', 'https://example.com/policy-v3/deterministic/' || fixture_suffix,
      'role', 'PRIMARY_RESOLUTION'
    ),
    'alternative_sources', jsonb_build_array(jsonb_build_object(
      'url', 'https://example.org/policy-v3/deterministic/' || fixture_suffix,
      'role', 'CORROBORATION'
    )),
    'public_criteria', 'Atinara comprobará el anuncio oficial de Proyecto Deterministic V3 ' || fixture_suffix || ' hasta el cierre inclusive.',
    'description', 'Fixture determinista aislado para probar el reetiquetado v3 sin reutilizar identidad familiar.',
    '_idempotency_key', gen_random_uuid(),
    '_change_origin', 'review_policy_v3_deterministic_test',
    '_timestamp_precision', 'milliseconds-v1'
  );
  saved := public.save_market_draft(null, null, deterministic_payload);
  deterministic_draft_id := (saved -> 'draft' ->> 'id')::uuid;
  if deterministic_draft_id is null then
    raise exception 'TEST_DETERMINISTIC_DRAFT_CREATE_FAILED: %', saved;
  end if;
  beginning := public.begin_market_draft_review_v2(
    deterministic_draft_id,
    (saved -> 'draft' ->> 'content_version')::bigint,
    gen_random_uuid(),
    'atinara-market-gate-v3',
    'atinara-market-review-policy-v3',
    'atinara-market-draft-schema-v3',
    false
  );
  if beginning ->> 'status' <> 'rejected' then
    raise exception 'TEST_DETERMINISTIC_REJECTION_NOT_CREATED: %', beginning;
  end if;
  deterministic_attempt_id := (beginning ->> 'attempt_id')::uuid;
  select attempt.report_id into deterministic_report_id
  from private.market_review_attempts attempt
  where attempt.id = deterministic_attempt_id
    and attempt.validator_version = 'step13.4-deterministic-v3'
    and attempt.policy_version = 'atinara-market-review-policy-v3'
    and attempt.schema_version = 'atinara-market-draft-schema-v3';
  if deterministic_report_id is null or not exists (
    select 1
    from private.market_review_reports report
    where report.id = deterministic_report_id
      and report.validator_version = 'step13.4-deterministic-v3'
      and report.policy_version = 'atinara-market-review-policy-v3'
      and report.schema_version = 'atinara-market-draft-schema-v3'
      and jsonb_array_length(report.deterministic_issues) > 0
  ) then
    raise exception 'TEST_DETERMINISTIC_REJECTION_NOT_RELABELLED_V3';
  end if;
end;
$test$;

rollback;
