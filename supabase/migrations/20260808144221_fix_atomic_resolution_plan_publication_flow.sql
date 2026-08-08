create or replace function private.ensure_market_source_publication_ready(draft_id_input uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  binding_state jsonb;
  binding_id_value uuid;
  binding_row private.market_source_bindings%rowtype;
  verification_result jsonb;
begin
  binding_state := private.market_binding_compatibility(draft_id_input);

  if not coalesce((binding_state ->> 'compatible')::boolean, false) then
    raise exception 'CURRENT_BINDING_COMPATIBILITY_REQUIRED'
      using errcode = '22023',
            detail = coalesce(binding_state -> 'reasons', '[]'::jsonb)::text;
  end if;

  if not coalesce((binding_state ->> 'required')::boolean, false) then
    return binding_state || jsonb_build_object(
      'publication_ready', true,
      'auto_validated', false,
      'message', 'Este borrador no requiere un Plan de Resolución vinculado.'
    );
  end if;

  binding_id_value := nullif(binding_state ->> 'binding_id', '')::uuid;
  if binding_id_value is null then
    raise exception 'SOURCE_BINDING_REQUIRED' using errcode = '22023';
  end if;

  select * into binding_row
  from private.market_source_bindings
  where id = binding_id_value
  for update;
  if not found then
    raise exception 'SOURCE_BINDING_NOT_FOUND' using errcode = 'P0001';
  end if;

  if binding_row.status = 'draft'
     or binding_row.contract_hash is null
     or binding_row.locked_at is null then
    verification_result := public.verify_market_source_binding(binding_id_value);
    select * into binding_row
    from private.market_source_bindings
    where id = binding_id_value;
  end if;

  if binding_row.status not in ('validated', 'armed')
     or binding_row.contract_hash is null
     or binding_row.locked_at is null then
    raise exception 'RESOLUTION_PLAN_NOT_LOCKED'
      using errcode = '22023',
            detail = coalesce(binding_row.validation, '{}'::jsonb)::text;
  end if;

  if binding_row.monitor_required then
    if binding_row.status <> 'armed' or binding_row.monitor_readiness <> 'armed' then
      raise exception 'SOURCE_MONITOR_NOT_ARMED' using errcode = '22023';
    end if;
    if not coalesce((
      select enabled
      from private.market_intelligence_runtime_settings
      where setting_key = 'source_monitor_scheduler_enabled'
    ), false) then
      raise exception 'SOURCE_SCHEDULER_NOT_ENABLED' using errcode = '22023';
    end if;
  end if;

  perform private.assert_market_source_publication_ready(draft_id_input);

  return private.market_binding_compatibility(draft_id_input) || jsonb_build_object(
    'publication_ready', true,
    'auto_validated', verification_result is not null,
    'binding_status', binding_row.status,
    'locked_at', binding_row.locked_at,
    'contract_hash', binding_row.contract_hash
  );
end;
$function$;

comment on function private.ensure_market_source_publication_ready(uuid) is
'Valida y bloquea de forma idempotente un Plan de Resolución compatible antes de confirmar, programar o publicar. No arma monitores ni elude sus requisitos.';

create or replace function public.confirm_market_draft_review(
  draft_id_input uuid,
  expected_version_input bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor_id uuid := private.require_current_admin();
  draft_row private.market_drafts%rowtype;
  effective_review_id_value bigint;
  binding_state jsonb;
begin
  select * into draft_row
  from private.market_drafts
  where id = draft_id_input
  for update;
  if not found then raise exception 'DRAFT_NOT_FOUND' using errcode = 'P0001'; end if;
  if expected_version_input is null or draft_row.content_version <> expected_version_input then
    raise exception 'DRAFT_VERSION_MOVED' using errcode = '40001';
  end if;

  effective_review_id_value := private.market_current_effective_review_id(draft_row);
  if effective_review_id_value is null
     or draft_row.review_status <> 'approved'
     or draft_row.reviewed_version <> draft_row.content_version
     or draft_row.reviewed_fingerprint is distinct from draft_row.content_fingerprint then
    raise exception 'CURRENT_APPROVAL_REQUIRED' using errcode = '22023';
  end if;

  binding_state := private.ensure_market_source_publication_ready(draft_row.id);

  if draft_row.human_confirmed_at is not null
     and draft_row.human_confirmed_fingerprint = draft_row.content_fingerprint
     and draft_row.human_confirmed_review_id = effective_review_id_value then
    return jsonb_build_object(
      'status', 'human_confirmed',
      'confirmed_at', draft_row.human_confirmed_at,
      'effective_review_id', effective_review_id_value,
      'content_fingerprint', draft_row.content_fingerprint,
      'binding', binding_state,
      'changed', false,
      'idempotency_replay', true
    );
  end if;

  update private.market_drafts set
    workflow_status = 'human_confirmed',
    human_confirmed_at = now(),
    human_confirmed_by = actor_id,
    human_confirmed_fingerprint = content_fingerprint,
    human_confirmed_review_id = effective_review_id_value,
    updated_at = now(),
    updated_by = actor_id
  where id = draft_row.id
  returning * into draft_row;

  insert into private.market_admin_audit(actor_id, action_code, draft_id, draft_version, detail)
  values (
    actor_id,
    'HUMAN_CONFIRMATION_RECORDED',
    draft_row.id,
    draft_row.content_version,
    jsonb_build_object(
      'effective_review_id', effective_review_id_value,
      'content_fingerprint', draft_row.content_fingerprint,
      'binding_id', binding_state ->> 'binding_id',
      'binding_plan_version', binding_state ->> 'plan_version',
      'binding_auto_validated', coalesce((binding_state ->> 'auto_validated')::boolean, false)
    )
  );

  return jsonb_build_object(
    'status', draft_row.workflow_status,
    'confirmed_at', draft_row.human_confirmed_at,
    'effective_review_id', effective_review_id_value,
    'content_fingerprint', draft_row.content_fingerprint,
    'binding', binding_state,
    'changed', true,
    'idempotency_replay', false
  );
end;
$function$;

create or replace function private.materialize_market_draft(
  draft_id_input uuid,
  actor_id_input uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  draft_row private.market_drafts%rowtype;
  effective_review_id_value bigint;
  binding_state jsonb;
begin
  if actor_id_input is null or not exists (
    select 1 from auth.users user_row
    where user_row.id = actor_id_input
      and coalesce((user_row.raw_app_meta_data ->> 'oraklo_admin')::boolean, false)
  ) then
    raise exception 'ADMIN_REQUIRED' using errcode = '42501';
  end if;

  select * into draft_row
  from private.market_drafts
  where id = draft_id_input
  for update;
  if not found then raise exception 'DRAFT_NOT_FOUND' using errcode = 'P0001'; end if;

  if draft_row.market_id is not null
     and draft_row.workflow_status = 'published'
     and exists (select 1 from public.markets market_row where market_row.id = draft_row.market_id) then
    return jsonb_build_object(
      'status', 'published',
      'market_id', draft_row.market_id,
      'published_at', draft_row.published_at,
      'changed', false,
      'idempotency_replay', true
    );
  end if;

  effective_review_id_value := private.market_current_effective_review_id(draft_row);
  if effective_review_id_value is null
     or draft_row.review_status <> 'approved'
     or draft_row.reviewed_version <> draft_row.content_version
     or draft_row.reviewed_fingerprint is distinct from draft_row.content_fingerprint
     or draft_row.human_confirmed_at is null
     or draft_row.human_confirmed_fingerprint is distinct from draft_row.content_fingerprint
     or draft_row.human_confirmed_review_id is distinct from effective_review_id_value then
    raise exception 'CURRENT_APPROVAL_AND_CONFIRMATION_REQUIRED' using errcode = '22023';
  end if;

  binding_state := private.market_binding_compatibility(draft_row.id);
  if not coalesce((binding_state ->> 'compatible')::boolean, false) then
    raise exception 'CURRENT_BINDING_COMPATIBILITY_REQUIRED' using errcode = '22023';
  end if;
  perform private.assert_market_source_publication_ready(draft_row.id);

  if draft_row.evaluation_ends_at is null or draft_row.evaluation_ends_at <= now() then
    raise exception 'MARKET_PERIOD_ALREADY_ENDED' using errcode = '22023';
  end if;
  if draft_row.market_id is not null then
    raise exception 'MARKET_ALREADY_PUBLISHED' using errcode = '22023';
  end if;
  if exists (select 1 from public.markets market_row where market_row.id = draft_row.market_slug) then
    raise exception 'MARKET_ID_ALREADY_EXISTS' using errcode = '23505';
  end if;

  insert into public.markets(
    id, question, category, status, yes_percent, no_percent, difficulty,
    close_label, closes_at, description, resolution_source, yes_criteria,
    no_criteria, edge_case, highlighted, popularity,
    evaluation_ends_at, evaluation_timezone, resolution_deadline,
    market_definition_version
  ) values (
    draft_row.market_slug,
    draft_row.question,
    draft_row.category,
    'Abierto',
    50,
    50,
    'Normal',
    'Cierra ' || to_char(
      draft_row.evaluation_ends_at at time zone draft_row.timezone,
      'DD Mon YYYY · HH24:MI:SS'
    ),
    draft_row.evaluation_ends_at,
    coalesce(draft_row.description, draft_row.public_criteria),
    coalesce(draft_row.primary_source ->> 'url', ''),
    draft_row.yes_criteria,
    draft_row.no_criteria,
    draft_row.edge_cases,
    false,
    0,
    draft_row.evaluation_ends_at,
    draft_row.timezone,
    draft_row.resolution_deadline,
    draft_row.content_version
  );

  update private.market_drafts set
    market_id = market_slug,
    workflow_status = 'published',
    published_at = now(),
    published_by = actor_id_input,
    scheduled_for = null,
    updated_at = now(),
    updated_by = actor_id_input
  where id = draft_row.id
  returning * into draft_row;

  insert into private.market_admin_audit(actor_id, action_code, draft_id, market_id, draft_version, detail)
  values (
    actor_id_input,
    'MARKET_PUBLISHED',
    draft_row.id,
    draft_row.market_id,
    draft_row.content_version,
    jsonb_build_object(
      'effective_review_id', effective_review_id_value,
      'content_fingerprint', draft_row.content_fingerprint,
      'binding_id', binding_state ->> 'binding_id'
    )
  );

  return jsonb_build_object(
    'status', 'published',
    'market_id', draft_row.market_id,
    'published_at', draft_row.published_at,
    'changed', true,
    'idempotency_replay', false,
    'catalog_view', 'catalog',
    'public_path', 'index.html?market=' || draft_row.market_id
  );
end;
$function$;

create or replace function public.publish_market_draft(
  draft_id_input uuid,
  expected_version_input bigint,
  scheduled_for_input timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor_id uuid := private.require_current_admin();
  draft_row private.market_drafts%rowtype;
  effective_review_id_value bigint;
  binding_state jsonb;
begin
  select * into draft_row
  from private.market_drafts
  where id = draft_id_input
  for update;
  if not found then raise exception 'DRAFT_NOT_FOUND' using errcode = 'P0001'; end if;
  if expected_version_input is null or draft_row.content_version <> expected_version_input then
    raise exception 'DRAFT_VERSION_MOVED' using errcode = '40001';
  end if;

  if draft_row.market_id is not null
     and draft_row.workflow_status = 'published'
     and exists (select 1 from public.markets market_row where market_row.id = draft_row.market_id) then
    return jsonb_build_object(
      'status', 'published',
      'market_id', draft_row.market_id,
      'published_at', draft_row.published_at,
      'changed', false,
      'idempotency_replay', true,
      'catalog_view', 'catalog',
      'public_path', 'index.html?market=' || draft_row.market_id
    );
  end if;

  effective_review_id_value := private.market_current_effective_review_id(draft_row);
  if effective_review_id_value is null
     or draft_row.review_status <> 'approved'
     or draft_row.reviewed_version <> draft_row.content_version
     or draft_row.reviewed_fingerprint is distinct from draft_row.content_fingerprint
     or draft_row.human_confirmed_at is null
     or draft_row.human_confirmed_fingerprint is distinct from draft_row.content_fingerprint
     or draft_row.human_confirmed_review_id is distinct from effective_review_id_value then
    raise exception 'CURRENT_APPROVAL_AND_CONFIRMATION_REQUIRED' using errcode = '22023';
  end if;

  binding_state := private.ensure_market_source_publication_ready(draft_row.id);

  if scheduled_for_input is not null and scheduled_for_input > now() then
    if scheduled_for_input >= draft_row.evaluation_ends_at then
      raise exception 'SCHEDULE_AFTER_MARKET_CLOSE' using errcode = '22023';
    end if;
    if draft_row.workflow_status = 'scheduled'
       and draft_row.scheduled_for = scheduled_for_input then
      return jsonb_build_object(
        'status', 'scheduled',
        'scheduled_for', draft_row.scheduled_for,
        'changed', false,
        'idempotency_replay', true,
        'binding', binding_state
      );
    end if;
    update private.market_drafts set
      workflow_status = 'scheduled',
      scheduled_for = scheduled_for_input,
      updated_at = now(),
      updated_by = actor_id
    where id = draft_row.id
    returning * into draft_row;
    insert into private.market_admin_audit(actor_id, action_code, draft_id, draft_version, detail)
    values (
      actor_id,
      'MARKET_SCHEDULED',
      draft_row.id,
      draft_row.content_version,
      jsonb_build_object(
        'scheduled_for', scheduled_for_input,
        'effective_review_id', effective_review_id_value,
        'content_fingerprint', draft_row.content_fingerprint,
        'binding_id', binding_state ->> 'binding_id',
        'binding_auto_validated', coalesce((binding_state ->> 'auto_validated')::boolean, false)
      )
    );
    return jsonb_build_object(
      'status', 'scheduled',
      'scheduled_for', scheduled_for_input,
      'changed', true,
      'idempotency_replay', false,
      'binding', binding_state,
      'catalog_view', 'catalog'
    );
  end if;

  return private.materialize_market_draft(draft_id_input, actor_id)
    || jsonb_build_object('binding', binding_state);
end;
$function$;

create or replace function public.get_admin_market_draft(draft_id_input uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  draft_row private.market_drafts%rowtype;
  binding_row private.market_source_bindings%rowtype;
begin
  perform private.require_current_admin();
  select * into draft_row from private.market_drafts where id = draft_id_input;
  if not found then raise exception 'DRAFT_NOT_FOUND' using errcode = 'P0001'; end if;

  select * into binding_row
  from private.market_source_bindings
  where draft_id = draft_id_input and status <> 'superseded'
  order by plan_version desc, created_at desc
  limit 1;

  return jsonb_build_object(
    'draft', to_jsonb(draft_row) - 'created_by' - 'updated_by' - 'human_confirmed_by' - 'published_by',
    'deterministic_issues', private.market_draft_deterministic_issues(draft_row),
    'effective_review', (
      select jsonb_build_object(
        'id', effective.id,
        'status', 'approved',
        'draft_version', effective.draft_version,
        'content_fingerprint', effective.content_fingerprint,
        'validator_version', effective.validator_version,
        'policy_version', effective.policy_version,
        'schema_version', effective.schema_version,
        'compatibility_basis', effective.compatibility_basis,
        'created_at', effective.created_at,
        'report_id', effective.report_id,
        'semantic_issues', coalesce(report.semantic_issues, '[]'::jsonb),
        'editorial_notes', coalesce(report.editorial_notes, '[]'::jsonb)
      )
      from private.market_effective_reviews effective
      left join private.market_review_reports report on report.id = effective.report_id
      where effective.id = private.market_current_effective_review_id(draft_row)
    ),
    'latest_attempt', (
      select jsonb_build_object(
        'id', attempt.id,
        'status', attempt.status,
        'classification', attempt.classification,
        'technical_code', attempt.technical_code,
        'draft_version', attempt.draft_version,
        'content_fingerprint', attempt.content_fingerprint,
        'validator_version', attempt.validator_version,
        'policy_version', attempt.policy_version,
        'schema_version', attempt.schema_version,
        'safe_provider_metadata', attempt.safe_provider_metadata,
        'started_at', attempt.started_at,
        'completed_at', attempt.completed_at,
        'report_id', attempt.report_id,
        'semantic_issues', coalesce(report.semantic_issues, '[]'::jsonb),
        'editorial_notes', coalesce(report.editorial_notes, '[]'::jsonb)
      )
      from private.market_review_attempts attempt
      left join private.market_review_reports report on report.id = attempt.report_id
      where attempt.draft_id = draft_row.id
        and attempt.draft_version = draft_row.content_version
        and attempt.content_fingerprint = draft_row.content_fingerprint
      order by coalesce(attempt.completed_at, attempt.started_at) desc, attempt.started_at desc
      limit 1
    ),
    'latest_historical_attempt', (
      select jsonb_build_object(
        'id', attempt.id,
        'status', attempt.status,
        'classification', attempt.classification,
        'technical_code', attempt.technical_code,
        'draft_version', attempt.draft_version,
        'content_fingerprint', attempt.content_fingerprint,
        'validator_version', attempt.validator_version,
        'started_at', attempt.started_at,
        'completed_at', attempt.completed_at
      )
      from private.market_review_attempts attempt
      where attempt.id = draft_row.last_review_attempt_id
    ),
    'latest_review', (
      select to_jsonb(report) - 'reviewed_by'
      from private.market_review_reports report
      left join private.market_review_attempts attempt on attempt.report_id = report.id
      where report.draft_id = draft_id_input
        and report.draft_version = draft_row.content_version
        and report.content_fingerprint = draft_row.content_fingerprint
        and coalesce(attempt.classification, report.review_classification, 'content') = 'content'
      order by report.created_at desc, report.id desc
      limit 1
    ),
    'review_history', coalesce((
      select jsonb_agg(history.item order by history.started_at desc)
      from (
        select
          attempt.started_at,
          jsonb_build_object(
            'id', attempt.id,
            'status', attempt.status,
            'classification', attempt.classification,
            'technical_code', attempt.technical_code,
            'draft_version', attempt.draft_version,
            'content_fingerprint', attempt.content_fingerprint,
            'validator_version', attempt.validator_version,
            'policy_version', attempt.policy_version,
            'schema_version', attempt.schema_version,
            'safe_provider_metadata', attempt.safe_provider_metadata,
            'started_at', attempt.started_at,
            'completed_at', attempt.completed_at,
            'report_id', attempt.report_id
          ) as item
        from private.market_review_attempts attempt
        where attempt.draft_id = draft_id_input
        order by attempt.started_at desc
        limit 30
      ) history
    ), '[]'::jsonb),
    'version_history', coalesce((
      select jsonb_agg(history.item order by history.content_version desc)
      from (
        select
          version.content_version,
          jsonb_build_object(
            'id', version.id,
            'content_version', version.content_version,
            'content_fingerprint', version.content_fingerprint,
            'fingerprint_version', version.fingerprint_version,
            'policy_version', version.policy_version,
            'schema_version', version.schema_version,
            'change_origin', version.change_origin,
            'restored_from_version_id', version.restored_from_version_id,
            'recovery_evidence', version.recovery_evidence,
            'created_at', version.created_at
          ) as item
        from private.market_draft_versions version
        where version.draft_id = draft_id_input
        order by version.content_version desc
        limit 30
      ) history
    ), '[]'::jsonb),
    'binding', case when binding_row.id is null then null else to_jsonb(binding_row) - 'locked_by' end,
    'binding_sources', case when binding_row.id is null then '[]'::jsonb else coalesce((
      select jsonb_agg(jsonb_build_object(
        'url', source.source_url,
        'role', source.role,
        'precedence', source.precedence,
        'fallback_condition', source.fallback_condition,
        'required', source.required
      ) order by source.precedence, source.id)
      from private.market_source_binding_sources source
      where source.binding_id = binding_row.id
    ), '[]'::jsonb) end,
    'binding_compatibility', private.market_binding_compatibility(draft_id_input),
    'review_memory', jsonb_build_object(
      'authoritative', true,
      'fingerprint_version', draft_row.fingerprint_version,
      'effective_review_id', private.market_current_effective_review_id(draft_row),
      'last_attempt_id', draft_row.last_review_attempt_id,
      'material_version_count', (
        select count(*) from private.market_draft_versions version where version.draft_id = draft_id_input
      ),
      'state_memory_count', (
        select count(*) from private.market_draft_state_memory memory where memory.draft_id = draft_id_input
      )
    ),
    'audit', coalesce((
      select jsonb_agg(to_jsonb(audit_row) - 'actor_id' order by audit_row.created_at desc)
      from (
        select * from private.market_admin_audit
        where draft_id = draft_id_input
        order by created_at desc
        limit 50
      ) audit_row
    ), '[]'::jsonb)
  );
end;
$function$;

revoke all on function private.ensure_market_source_publication_ready(uuid) from public, anon, authenticated;
revoke all on function public.confirm_market_draft_review(uuid,bigint) from public, anon;
grant execute on function public.confirm_market_draft_review(uuid,bigint) to authenticated;
revoke all on function public.publish_market_draft(uuid,bigint,timestamptz) from public, anon;
grant execute on function public.publish_market_draft(uuid,bigint,timestamptz) to authenticated;
revoke all on function public.get_admin_market_draft(uuid) from public, anon;
grant execute on function public.get_admin_market_draft(uuid) to authenticated;