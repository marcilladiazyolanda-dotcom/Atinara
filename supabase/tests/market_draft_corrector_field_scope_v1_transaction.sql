-- Regresión transaccional del Corrector por campo y de perfiles públicos v1.
-- Requiere 20260826190000 y nunca publica, confirma ni resuelve.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';

do $test$
declare
  admin_id uuid;
  draft_id_value uuid;
  draft_version_value bigint;
  x_registry_id uuid;
  profile_url text := 'https://x.com/thsottiaux';
  status_url text := 'https://x.com/thsottiaux/status/2092315945700381084';
  other_profile_url text := 'https://x.com/another_handle';
  payload jsonb;
  saved jsonb;
  registry_result jsonb;
  issues jsonb;
  evidence jsonb;
  recorded jsonb;
  rejected boolean;
  market_count_before bigint;
  prediction_count_before bigint;
begin
  select user_row.id into admin_id
  from auth.users user_row
  where coalesce((user_row.raw_app_meta_data ->> 'oraklo_admin')::boolean, false)
  order by user_row.created_at
  limit 1;
  if admin_id is null then raise exception 'TEST_ADMIN_REQUIRED'; end if;

  select count(*) into market_count_before from public.markets;
  select count(*) into prediction_count_before from public.predictions;

  select registry.id into x_registry_id
  from private.market_source_registry registry
  where registry.provider = 'public_social_account'
    and registry.canonical_domain = 'x.com'
    and coalesce(registry.external_entity_id, '') = 'account_path_v1'
    and registry.active
    and registry.authority_tier = 'primary'
    and registry.parser_version = 'atinara-public-account-source-v1'
    and jsonb_array_length(registry.allowed_roles) = 1
    and registry.allowed_roles @> '["primary_resolution"]'::jsonb
    and jsonb_array_length(registry.categories) = 0;
  if x_registry_id is null then raise exception 'TEST_X_PRIMARY_REGISTRY_MISSING'; end if;
  if exists (
    select 1
    from private.market_source_registry registry
    where registry.id = x_registry_id
      and registry.allowed_roles @> '["radar_fact_evidence"]'::jsonb
  ) then
    raise exception 'TEST_X_GRANTED_RADAR_FACT_AUTHORITY';
  end if;

  if exists (
    with expected(issue_code, strategy_key, field_name) as (
      values
        ('INVALID_MARKET_SLUG', 'normalize_market_slug', 'market_slug'),
        ('INVALID_QUESTION', 'rebuild_binary_question', 'question'),
        ('SUBJECT_REQUIRED', 'infer_canonical_subject', 'subject'),
        ('CATEGORY_REQUIRED', 'infer_category', 'category'),
        ('OPTIONS_NOT_BINARY', 'normalize_binary_options', 'yes_option'),
        ('OPTIONS_NOT_BINARY', 'normalize_binary_options', 'no_option'),
        ('PERIOD_REQUIRED', 'derive_evaluation_period', 'evaluation_period_label'),
        ('PERIOD_REQUIRED', 'derive_evaluation_period', 'evaluation_ends_at'),
        ('PERIOD_REQUIRED', 'derive_evaluation_period', 'closes_at'),
        ('TIMEZONE_INVALID', 'normalize_iana_timezone', 'timezone'),
        ('RESOLUTION_DEADLINE_INVALID', 'derive_resolution_deadline', 'resolution_deadline'),
        ('YES_CRITERIA_REQUIRED', 'rebuild_resolution_criteria', 'yes_criteria'),
        ('NO_CRITERIA_REQUIRED', 'rebuild_resolution_criteria', 'no_criteria'),
        ('EDGE_CASES_REQUIRED', 'derive_edge_cases', 'edge_cases'),
        ('PUBLIC_CRITERIA_REQUIRED', 'derive_public_criteria', 'public_criteria'),
        ('DESCRIPTION_REQUIRED', 'derive_description', 'description'),
        ('DELAY_TREATMENT_REQUIRED', 'derive_delay_treatment', 'delay_treatment'),
        ('CANCELLATION_TREATMENT_REQUIRED', 'derive_cancellation_treatment', 'cancellation_treatment'),
        ('LEAK_TREATMENT_REQUIRED', 'derive_leak_treatment', 'leak_treatment'),
        ('RENAME_TREATMENT_REQUIRED', 'derive_rename_treatment', 'rename_treatment'),
        ('ASSUMPTIONS_REQUIRED', 'derive_assumptions', 'assumptions'),
        ('INSUFFICIENT_EVIDENCE', 'apply_registered_sources', 'primary_source'),
        ('INSUFFICIENT_EVIDENCE', 'apply_registered_sources', 'alternative_sources')
    )
    select 1
    from expected
    where not exists (
      select 1
      from private.market_issue_registry issue
      join private.market_issue_strategy_bindings binding
        on binding.issue_code = issue.code and binding.active
      join private.market_repair_strategy_registry strategy
        on strategy.strategy_key = binding.strategy_key and strategy.active
      where issue.code = expected.issue_code
        and issue.active and issue.repairable
        and strategy.strategy_key = expected.strategy_key
        and strategy.can_write
        and strategy.write_fields @> jsonb_build_array(expected.field_name)
    )
  ) then
    raise exception 'TEST_CORRECTOR_WRITER_FIELD_UNCOVERED';
  end if;

  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', admin_id, 'role', 'authenticated')::text,
    true
  );
  payload := jsonb_build_object(
    'market_slug', 'corrector-field-scope-' || replace(gen_random_uuid()::text, '-', ''),
    'question', '¿Confirmará públicamente Tibo (@thsottiaux) antes del 30 de septiembre de 2098 que se ha cortado el pelo?',
    'subject', 'Thibault “Tibo” Sottiaux (@thsottiaux)',
    'category', 'Eventos',
    'yes_option', 'Sí',
    'no_option', 'No',
    'evaluation_period_label', 'Hasta el 29 de septiembre de 2098 a las 23:59:59, hora de California.',
    'evaluation_ends_at', '2098-09-30T06:59:59.000Z',
    'closes_at', '2098-09-30T06:59:59.000Z',
    'timezone', 'America/Los_Angeles',
    'resolution_deadline', '2098-10-03T06:59:59.000Z',
    'yes_criteria', 'Resolver Sí si Tibo confirma públicamente dentro del periodo que ya se ha cortado el pelo de la cabeza.',
    'no_criteria', 'Resolver No si termina el periodo sin una confirmación pública válida que cumpla íntegramente el criterio de Sí.',
    'edge_cases', 'Fotografías, rumores, publicaciones de terceros, intenciones futuras y cortes de barba no cuentan.',
    'primary_source', jsonb_build_object('url', profile_url, 'role', 'PRIMARY_RESOLUTION'),
    'alternative_sources', jsonb_build_array(jsonb_build_object(
      'url', status_url, 'role', 'CORROBORATION'
    )),
    'delay_treatment', 'Una indisponibilidad temporal de X no amplía el periodo evaluado original.',
    'cancellation_treatment', 'La ausencia de publicación resuelve No y no constituye por sí sola una anulación.',
    'leak_treatment', 'Una fotografía o afirmación de un tercero no resuelve el mercado sin confirmación de Tibo.',
    'rename_treatment', 'Un cambio de handle exige continuidad pública y verificable con la cuenta @thsottiaux.',
    'assumptions', 'Pelo significa exclusivamente pelo de la cabeza y la confirmación debe describir una acción ya realizada.',
    'public_criteria', 'Se resolverá Sí con una confirmación pública válida de Tibo dentro del periodo; en otro caso se resolverá No.',
    'description', 'Borrador manual privado para probar el alcance por campos y la fuente primaria oficial.',
    '_idempotency_key', gen_random_uuid(),
    '_change_origin', 'corrector_field_scope_transaction_test',
    '_timestamp_precision', 'milliseconds-v1'
  );
  saved := public.save_market_draft(null, null, payload);
  draft_id_value := (saved -> 'draft' ->> 'id')::uuid;
  draft_version_value := (saved -> 'draft' ->> 'content_version')::bigint;
  if draft_id_value is null or draft_version_value is null then
    raise exception 'TEST_CORRECTOR_DRAFT_CREATE_FAILED: %', saved;
  end if;

  update private.market_drafts
  set description = '', delay_treatment = '', cancellation_treatment = '',
      leak_treatment = '', rename_treatment = '', assumptions = ''
  where id = draft_id_value;
  select private.market_draft_deterministic_issues(draft) into issues
  from private.market_drafts draft
  where draft.id = draft_id_value;
  if exists (
    select 1
    from (values
      ('DESCRIPTION_REQUIRED'),
      ('DELAY_TREATMENT_REQUIRED'),
      ('CANCELLATION_TREATMENT_REQUIRED'),
      ('LEAK_TREATMENT_REQUIRED'),
      ('RENAME_TREATMENT_REQUIRED'),
      ('ASSUMPTIONS_REQUIRED')
    ) expected(code)
    where not exists (
      select 1 from jsonb_array_elements(issues) issue
      where issue ->> 'code' = expected.code
    )
  ) then
    raise exception 'TEST_FILLABLE_FIELD_ISSUE_NOT_EMITTED: %', issues;
  end if;

  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', admin_id, 'role', 'service_role')::text,
    true
  );
  registry_result := public.get_market_draft_authoritative_source_registry_v1('primary_resolution');
  if not exists (
    select 1
    from jsonb_array_elements(registry_result) registry
    where (registry ->> 'id')::uuid = x_registry_id
      and registry ->> 'parser_version' = 'atinara-public-account-source-v1'
      and registry -> 'allowed_roles' @> '["primary_resolution"]'::jsonb
  ) then
    raise exception 'TEST_X_REGISTRY_NOT_EXPOSED_TO_CORRECTOR';
  end if;

  evidence := jsonb_build_object(
    'kind', 'primary_resolution',
    'requested_url', profile_url,
    'final_url', profile_url,
    'candidate_origin', 'draft_inherited',
    'accepted', true,
    'code', 'PRIMARY_SOURCE_VERIFIED',
    'checked_at', clock_timestamp(),
    'redirect_count', 0,
    'redirect_chain', jsonb_build_array(profile_url),
    'registry_source_id', x_registry_id,
    'registry_domain', 'x.com',
    'registry_parser_version', 'atinara-public-account-source-v1',
    'parser_version', 'atinara-public-account-source-v1',
    'registry_categories', '[]'::jsonb,
    'draft_category', 'Eventos',
    'registry_role', 'primary_resolution',
    'registry_role_verified', true,
    'authority', 'private_source_registry_primary_resolution_v1',
    'relevance_basis', 'fetched_content_and_canonical_url_v1',
    'identity_scope', 'public_account_path_v1',
    'account_handle', 'thsottiaux',
    'matched_tokens', '["thsottiaux","tibo"]'::jsonb,
    'http_status', 200,
    'excerpt_sha256', repeat('a', 64),
    'excerpt_chars', 128,
    'validated_reachable', true,
    'authority_verified', true,
    'relevance_verified', true,
    'validation_version', 'atinara-primary-source-validation-v1'
  );

  rejected := false;
  begin
    perform public.record_market_draft_primary_source_check_v1(
      draft_id_value, draft_version_value, x_registry_id,
      status_url, status_url, 'Eventos', 'atinara-primary-source-validation-v1',
      evidence || jsonb_build_object(
        'requested_url', status_url,
        'final_url', status_url,
        'redirect_chain', jsonb_build_array(status_url)
      )
    );
  exception when sqlstate '22023' then
    if sqlerrm <> 'PUBLIC_ACCOUNT_SOURCE_CHECK_INVALID' then raise; end if;
    rejected := true;
  end;
  if not rejected then raise exception 'TEST_X_STATUS_ACCEPTED_AS_PRIMARY'; end if;

  rejected := false;
  begin
    perform public.record_market_draft_primary_source_check_v1(
      draft_id_value, draft_version_value, x_registry_id,
      other_profile_url, other_profile_url, 'Eventos', 'atinara-primary-source-validation-v1',
      evidence || jsonb_build_object(
        'requested_url', other_profile_url,
        'final_url', other_profile_url,
        'redirect_chain', jsonb_build_array(other_profile_url),
        'account_handle', 'another_handle',
        'matched_tokens', '["another_handle"]'::jsonb
      )
    );
  exception when sqlstate '22023' then
    if sqlerrm <> 'PUBLIC_ACCOUNT_IDENTITY_MISMATCH' then raise; end if;
    rejected := true;
  end;
  if not rejected then raise exception 'TEST_X_HANDLE_MISMATCH_ACCEPTED'; end if;

  rejected := false;
  begin
    perform public.record_market_draft_primary_source_check_v1(
      draft_id_value, draft_version_value, x_registry_id,
      profile_url, profile_url, 'Eventos', 'atinara-primary-source-validation-v1',
      evidence - 'identity_scope'
    );
  exception when sqlstate '22023' then
    if sqlerrm <> 'PUBLIC_ACCOUNT_SOURCE_CHECK_INVALID' then raise; end if;
    rejected := true;
  end;
  if not rejected then raise exception 'TEST_X_IDENTITY_SCOPE_OMISSION_ACCEPTED'; end if;

  recorded := public.record_market_draft_primary_source_check_v1(
    draft_id_value, draft_version_value, x_registry_id,
    profile_url, profile_url, 'Eventos', 'atinara-primary-source-validation-v1',
    evidence
  );
  if (recorded ->> 'id')::uuid is null
     or (recorded ->> 'registry_source_id')::uuid is distinct from x_registry_id then
    raise exception 'TEST_X_PROFILE_ATTESTATION_NOT_RECORDED: %', recorded;
  end if;

  if (select count(*) from public.markets) is distinct from market_count_before
     or (select count(*) from public.predictions) is distinct from prediction_count_before
     or exists (
       select 1
       from private.market_drafts draft
       where draft.id = draft_id_value
         and draft.workflow_status in (
           'human_confirmed', 'scheduled', 'published', 'pending_resolution',
           'resolved', 'annulled', 'early_closed'
         )
     ) then
    raise exception 'TEST_CORRECTOR_SCOPE_TOUCHED_PUBLICATION_OR_ECONOMY';
  end if;
end;
$test$;

rollback;
