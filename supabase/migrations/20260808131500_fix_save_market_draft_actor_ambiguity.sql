-- Reparación detectada por la matriz transaccional de Paso 13.5.2.
-- Evita la ambigüedad PL/pgSQL entre la variable administrativa y la columna actor_id.

begin;

create or replace function public.save_market_draft(
  draft_id_input uuid,
  expected_version_input bigint,
  draft_input jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor_id_value uuid := private.require_current_admin();
  draft_row private.market_drafts%rowtype;
  candidate_row private.market_drafts%rowtype;
  previous_fingerprint text;
  next_fingerprint text;
  next_legacy_fingerprint text;
  issues jsonb;
  next_evaluation_end timestamptz;
  next_resolution_deadline timestamptz;
  next_timezone text := nullif(trim(coalesce(draft_input ->> 'timezone', '')), '');
  next_slug text := lower(trim(coalesce(draft_input ->> 'market_slug', '')));
  next_primary_source jsonb := coalesce(draft_input -> 'primary_source', '{}'::jsonb);
  next_alternative_sources jsonb := coalesce(draft_input -> 'alternative_sources', '[]'::jsonb);
  change_origin text := left(coalesce(nullif(trim(draft_input ->> '_change_origin'), ''), 'manual_save'), 100);
  binding_managed_externally boolean := coalesce((draft_input ->> '_binding_managed_externally')::boolean, false);
  exact_timestamp_input boolean := draft_input ->> '_timestamp_precision' = 'milliseconds-v1';
  binding_result jsonb := null;
  reusable_review_id bigint;
  effective_review_id_value bigint;
  version_id_value bigint;
  restored_from_version_id_value bigint;
  request_key_value uuid;
  request_hash_value text;
  request_row private.market_workflow_requests%rowtype;
  response_value jsonb;
begin
  if jsonb_typeof(draft_input) <> 'object' then
    raise exception 'INVALID_DRAFT_PAYLOAD' using errcode = '22023';
  end if;
  if octet_length(draft_input::text) > 65536 then
    raise exception 'DRAFT_PAYLOAD_TOO_LARGE' using errcode = '22023';
  end if;
  if next_slug !~ '^[a-z0-9][a-z0-9-]{2,119}$' then
    raise exception 'INVALID_MARKET_SLUG' using errcode = '22023';
  end if;
  if jsonb_typeof(next_primary_source) <> 'object'
     or jsonb_typeof(next_alternative_sources) <> 'array' then
    raise exception 'INVALID_DRAFT_SOURCES' using errcode = '22023';
  end if;
  if next_timezone is not null and not exists (
    select 1 from pg_catalog.pg_timezone_names where name = next_timezone
  ) then
    raise exception 'INVALID_DRAFT_TIMEZONE' using errcode = '22023';
  end if;

  begin
    next_evaluation_end := nullif(trim(draft_input ->> 'evaluation_ends_at'), '')::timestamptz;
    next_resolution_deadline := nullif(trim(draft_input ->> 'resolution_deadline'), '')::timestamptz;
    request_key_value := nullif(trim(draft_input ->> '_idempotency_key'), '')::uuid;
  exception
    when invalid_datetime_format then
      raise exception 'INVALID_DRAFT_DATE' using errcode = '22007';
    when invalid_text_representation then
      raise exception 'INVALID_IDEMPOTENCY_KEY' using errcode = '22023';
  end;
  begin
    restored_from_version_id_value := nullif(trim(draft_input ->> '_restored_from_version_id'), '')::bigint;
  exception when invalid_text_representation then
    raise exception 'INVALID_RESTORED_VERSION' using errcode = '22023';
  end;
  request_key_value := coalesce(request_key_value, gen_random_uuid());
  request_hash_value := encode(extensions.digest(convert_to(
    jsonb_build_object(
      'draft_id', draft_id_input,
      'expected_version', expected_version_input,
      'draft', draft_input - '_idempotency_key' - '_change_origin'
        - '_binding_managed_externally' - '_timestamp_precision'
    )::text,
    'UTF8'
  ), 'sha256'), 'hex');

  insert into private.market_workflow_requests(
    actor_id, operation, request_key, request_hash
  ) values (
    actor_id_value, 'save_market_draft', request_key_value, request_hash_value
  )
  on conflict (actor_id, operation, request_key) do nothing
  returning * into request_row;

  if request_row.id is null then
    select * into request_row
    from private.market_workflow_requests existing_request
    where existing_request.actor_id = actor_id_value
      and existing_request.operation = 'save_market_draft'
      and existing_request.request_key = request_key_value;
    if request_row.request_hash is distinct from request_hash_value then
      raise exception 'IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD' using errcode = '22023';
    end if;
    if request_row.response_payload is not null then
      return request_row.response_payload || jsonb_build_object('idempotency_replay', true);
    end if;
    raise exception 'IDEMPOTENT_REQUEST_IN_PROGRESS' using errcode = '40001';
  end if;

  if draft_id_input is null then
    if restored_from_version_id_value is not null then
      raise exception 'INVALID_RESTORED_VERSION' using errcode = '22023';
    end if;
    insert into private.market_drafts (
      market_slug, question, subject, category, yes_option, no_option,
      evaluation_period_label, evaluation_ends_at, closes_at, timezone,
      resolution_deadline, yes_criteria, no_criteria, edge_cases,
      primary_source, alternative_sources, delay_treatment,
      cancellation_treatment, leak_treatment, rename_treatment, assumptions,
      public_criteria, description, created_by, updated_by
    ) values (
      next_slug,
      nullif(trim(draft_input ->> 'question'), ''),
      nullif(trim(draft_input ->> 'subject'), ''),
      nullif(trim(draft_input ->> 'category'), ''),
      coalesce(nullif(trim(draft_input ->> 'yes_option'), ''), 'Sí'),
      coalesce(nullif(trim(draft_input ->> 'no_option'), ''), 'No'),
      nullif(trim(draft_input ->> 'evaluation_period_label'), ''),
      next_evaluation_end,
      next_evaluation_end,
      next_timezone,
      next_resolution_deadline,
      nullif(trim(draft_input ->> 'yes_criteria'), ''),
      nullif(trim(draft_input ->> 'no_criteria'), ''),
      nullif(trim(draft_input ->> 'edge_cases'), ''),
      next_primary_source,
      next_alternative_sources,
      nullif(trim(draft_input ->> 'delay_treatment'), ''),
      nullif(trim(draft_input ->> 'cancellation_treatment'), ''),
      nullif(trim(draft_input ->> 'leak_treatment'), ''),
      nullif(trim(draft_input ->> 'rename_treatment'), ''),
      nullif(trim(draft_input ->> 'assumptions'), ''),
      nullif(trim(draft_input ->> 'public_criteria'), ''),
      nullif(trim(draft_input ->> 'description'), ''),
      actor_id_value,
      actor_id_value
    ) returning * into draft_row;

    next_fingerprint := private.market_draft_fingerprint(draft_row);
    next_legacy_fingerprint := private.market_draft_legacy_fingerprint(draft_row);
    issues := private.market_draft_deterministic_issues(draft_row);

    update private.market_drafts set
      content_fingerprint = next_fingerprint,
      legacy_content_fingerprint = next_legacy_fingerprint,
      fingerprint_version = 'sha256-canonical-v2',
      workflow_status = case when jsonb_array_length(issues) = 0 then 'draft_ready' else 'draft_incomplete' end,
      review_status = 'not_requested'
    where id = draft_row.id
    returning * into draft_row;

    version_id_value := private.record_market_draft_version(
      draft_row, change_origin, actor_id_value, null, '{}'::jsonb
    );

    insert into private.market_admin_audit(actor_id, action_code, draft_id, draft_version, detail)
    values (
      actor_id_value,
      'DRAFT_CREATED',
      draft_row.id,
      draft_row.content_version,
      jsonb_build_object(
        'deterministic_issue_count', jsonb_array_length(issues),
        'changed', true,
        'version_id', version_id_value,
        'fingerprint_version', 'sha256-canonical-v2',
        'idempotency_key_recorded', true
      )
    );

    response_value := jsonb_build_object(
      'draft', to_jsonb(draft_row) - 'created_by' - 'updated_by' - 'human_confirmed_by' - 'published_by',
      'deterministic_issues', issues,
      'changed', true,
      'review_preserved', false,
      'review_reused_from_memory', false,
      'version_unchanged', false,
      'version_id', version_id_value,
      'idempotency_replay', false
    );
    update private.market_workflow_requests set
      draft_id = draft_row.id,
      response_payload = response_value,
      completed_at = now()
    where id = request_row.id;
    return response_value;
  end if;

  select * into draft_row
  from private.market_drafts
  where id = draft_id_input
  for update;
  if not found then raise exception 'DRAFT_NOT_FOUND' using errcode = 'P0001'; end if;
  if expected_version_input is null or expected_version_input <> draft_row.content_version then
    raise exception 'DRAFT_VERSION_MOVED' using errcode = '40001';
  end if;
  if draft_row.workflow_status in (
    'published', 'early_closed', 'cancelled', 'pending_resolution', 'resolved', 'annulled'
  ) then
    raise exception 'PUBLISHED_MARKET_FIELDS_LOCKED' using errcode = '22023';
  end if;
  if restored_from_version_id_value is not null and (
    change_origin <> 'version_restore'
    or not exists (
      select 1
      from private.market_draft_versions source_version
      where source_version.id = restored_from_version_id_value
        and source_version.draft_id = draft_row.id
    )
  ) then
    raise exception 'INVALID_RESTORED_VERSION' using errcode = '22023';
  end if;

  -- Clientes anteriores a Paso 13.5.2 solo enviaban minutos. Se conserva su
  -- protección de compatibilidad, pero un cliente que declara precisión exacta
  -- puede cambiar intencionadamente :59.000 por :00.000.
  if not exact_timestamp_input then
    next_evaluation_end := private.market_datetime_preserve_precision(
      draft_row.evaluation_ends_at, next_evaluation_end
    );
    next_resolution_deadline := private.market_datetime_preserve_precision(
      draft_row.resolution_deadline, next_resolution_deadline
    );
  end if;

  previous_fingerprint := private.market_draft_fingerprint(draft_row);
  candidate_row := draft_row;
  candidate_row.market_slug := next_slug;
  candidate_row.question := nullif(trim(draft_input ->> 'question'), '');
  candidate_row.subject := nullif(trim(draft_input ->> 'subject'), '');
  candidate_row.category := nullif(trim(draft_input ->> 'category'), '');
  candidate_row.yes_option := coalesce(nullif(trim(draft_input ->> 'yes_option'), ''), 'Sí');
  candidate_row.no_option := coalesce(nullif(trim(draft_input ->> 'no_option'), ''), 'No');
  candidate_row.evaluation_period_label := nullif(trim(draft_input ->> 'evaluation_period_label'), '');
  candidate_row.evaluation_ends_at := next_evaluation_end;
  candidate_row.closes_at := next_evaluation_end;
  candidate_row.timezone := next_timezone;
  candidate_row.resolution_deadline := next_resolution_deadline;
  candidate_row.yes_criteria := nullif(trim(draft_input ->> 'yes_criteria'), '');
  candidate_row.no_criteria := nullif(trim(draft_input ->> 'no_criteria'), '');
  candidate_row.edge_cases := nullif(trim(draft_input ->> 'edge_cases'), '');
  candidate_row.primary_source := next_primary_source;
  candidate_row.alternative_sources := next_alternative_sources;
  candidate_row.delay_treatment := nullif(trim(draft_input ->> 'delay_treatment'), '');
  candidate_row.cancellation_treatment := nullif(trim(draft_input ->> 'cancellation_treatment'), '');
  candidate_row.leak_treatment := nullif(trim(draft_input ->> 'leak_treatment'), '');
  candidate_row.rename_treatment := nullif(trim(draft_input ->> 'rename_treatment'), '');
  candidate_row.assumptions := nullif(trim(draft_input ->> 'assumptions'), '');
  candidate_row.public_criteria := nullif(trim(draft_input ->> 'public_criteria'), '');
  candidate_row.description := nullif(trim(draft_input ->> 'description'), '');
  next_fingerprint := private.market_draft_fingerprint(candidate_row);
  next_legacy_fingerprint := private.market_draft_legacy_fingerprint(candidate_row);

  if previous_fingerprint = next_fingerprint then
    issues := private.market_draft_deterministic_issues(draft_row);
    insert into private.market_admin_audit(actor_id, action_code, draft_id, draft_version, detail)
    values (
      actor_id_value,
      'DRAFT_SAVE_NOOP_REVIEW_PRESERVED',
      draft_row.id,
      draft_row.content_version,
      jsonb_build_object(
        'deterministic_issue_count', jsonb_array_length(issues),
        'changed', false,
        'review_status', draft_row.review_status,
        'workflow_status', draft_row.workflow_status,
        'effective_review_id', draft_row.effective_review_id,
        'human_confirmation_preserved', draft_row.human_confirmed_at is not null,
        'fingerprint_version', draft_row.fingerprint_version
      )
    );
    response_value := jsonb_build_object(
      'draft', to_jsonb(draft_row) - 'created_by' - 'updated_by' - 'human_confirmed_by' - 'published_by',
      'deterministic_issues', issues,
      'changed', false,
      'review_preserved', true,
      'review_reused_from_memory', false,
      'version_unchanged', true,
      'idempotency_replay', false,
      'message', 'No había cambios materiales. Se conserva la versión y la revisión vigente.'
    );
    update private.market_workflow_requests set
      draft_id = draft_row.id,
      response_payload = response_value,
      completed_at = now()
    where id = request_row.id;
    return response_value;
  end if;

  update private.market_effective_reviews set
    active = false,
    superseded_at = coalesce(superseded_at, now())
  where id = draft_row.effective_review_id and active;

  update private.market_drafts set
    market_slug = candidate_row.market_slug,
    question = candidate_row.question,
    subject = candidate_row.subject,
    category = candidate_row.category,
    yes_option = candidate_row.yes_option,
    no_option = candidate_row.no_option,
    evaluation_period_label = candidate_row.evaluation_period_label,
    evaluation_ends_at = candidate_row.evaluation_ends_at,
    closes_at = candidate_row.closes_at,
    timezone = candidate_row.timezone,
    resolution_deadline = candidate_row.resolution_deadline,
    yes_criteria = candidate_row.yes_criteria,
    no_criteria = candidate_row.no_criteria,
    edge_cases = candidate_row.edge_cases,
    primary_source = candidate_row.primary_source,
    alternative_sources = candidate_row.alternative_sources,
    delay_treatment = candidate_row.delay_treatment,
    cancellation_treatment = candidate_row.cancellation_treatment,
    leak_treatment = candidate_row.leak_treatment,
    rename_treatment = candidate_row.rename_treatment,
    assumptions = candidate_row.assumptions,
    public_criteria = candidate_row.public_criteria,
    description = candidate_row.description,
    content_version = content_version + 1,
    content_fingerprint = next_fingerprint,
    legacy_content_fingerprint = next_legacy_fingerprint,
    fingerprint_version = 'sha256-canonical-v2',
    effective_review_id = null,
    reviewed_version = null,
    reviewed_fingerprint = null,
    review_status = 'not_requested',
    workflow_status = 'draft_ready',
    human_confirmed_at = null,
    human_confirmed_by = null,
    human_confirmed_fingerprint = null,
    human_confirmed_review_id = null,
    last_review_attempt_id = null,
    updated_by = actor_id_value,
    updated_at = now()
  where id = draft_row.id
  returning * into draft_row;

  issues := private.market_draft_deterministic_issues(draft_row);
  if jsonb_array_length(issues) = 0 then
    reusable_review_id := private.market_reusable_effective_review_id(
      draft_row.id, draft_row.content_fingerprint
    );
  end if;

  if reusable_review_id is not null then
    insert into private.market_effective_reviews(
      draft_id, draft_version, version_id, attempt_id, report_id,
      content_fingerprint, validator_version, policy_version, schema_version,
      compatibility_basis, reused_from_effective_review_id, active
    )
    select
      draft_row.id,
      draft_row.content_version,
      null,
      source_review.attempt_id,
      source_review.report_id,
      draft_row.content_fingerprint,
      source_review.validator_version,
      source_review.policy_version,
      source_review.schema_version,
      'exact_canonical_fingerprint_and_policy_reuse',
      source_review.id,
      true
    from private.market_effective_reviews source_review
    where source_review.id = reusable_review_id
    returning id into effective_review_id_value;
  end if;

  update private.market_drafts set
    workflow_status = case
      when jsonb_array_length(issues) > 0 then 'draft_incomplete'
      when effective_review_id_value is not null then 'review_approved'
      else 'draft_ready'
    end,
    review_status = case when effective_review_id_value is not null then 'approved' else 'not_requested' end,
    effective_review_id = effective_review_id_value,
    reviewed_version = case when effective_review_id_value is not null then content_version else null end,
    reviewed_fingerprint = case when effective_review_id_value is not null then content_fingerprint else null end
  where id = draft_row.id
  returning * into draft_row;

  version_id_value := private.record_market_draft_version(
    draft_row, change_origin, actor_id_value, restored_from_version_id_value, '{}'::jsonb
  );
  if effective_review_id_value is not null then
    update private.market_effective_reviews
    set version_id = version_id_value
    where id = effective_review_id_value;
  end if;

  if not binding_managed_externally then
    binding_result := private.sync_market_draft_binding(
      draft_row.id, actor_id_value, null, null, change_origin
    );
  end if;

  insert into private.market_admin_audit(actor_id, action_code, draft_id, draft_version, detail)
  values (
    actor_id_value,
    case when effective_review_id_value is not null
      then 'DRAFT_SAVED_APPROVAL_REUSED_FROM_MEMORY'
      else 'DRAFT_SAVED_REVIEW_INVALIDATED'
    end,
    draft_row.id,
    draft_row.content_version,
    jsonb_build_object(
      'deterministic_issue_count', jsonb_array_length(issues),
      'changed', true,
      'previous_fingerprint', previous_fingerprint,
      'next_fingerprint', next_fingerprint,
      'fingerprint_version', 'sha256-canonical-v2',
      'version_id', version_id_value,
      'effective_review_id', effective_review_id_value,
      'reused_from_effective_review_id', reusable_review_id,
      'binding_sync', binding_result,
      'change_origin', change_origin
    )
  );

  response_value := jsonb_build_object(
    'draft', to_jsonb(draft_row) - 'created_by' - 'updated_by' - 'human_confirmed_by' - 'published_by',
    'deterministic_issues', issues,
    'changed', true,
    'review_preserved', false,
    'review_reused_from_memory', effective_review_id_value is not null,
    'version_unchanged', false,
    'version_id', version_id_value,
    'binding_sync', binding_result,
    'idempotency_replay', false,
    'message', case when effective_review_id_value is not null
      then 'El contenido coincide con una versión aprobada compatible. Se recuperó la revisión y hace falta una nueva confirmación humana.'
      else 'Los cambios materiales crearon una versión nueva e invalidaron la revisión anterior.'
    end
  );
  update private.market_workflow_requests set
    draft_id = draft_row.id,
    response_payload = response_value,
    completed_at = now()
  where id = request_row.id;
  return response_value;
end;
$function$;

revoke all on function public.save_market_draft(uuid,bigint,jsonb) from public, anon;
grant execute on function public.save_market_draft(uuid,bigint,jsonb) to authenticated;

comment on function public.save_market_draft(uuid,bigint,jsonb) is
  'Guardado canónico e idempotente. La variable administrativa no colisiona con la inferencia ON CONFLICT.';

commit;

