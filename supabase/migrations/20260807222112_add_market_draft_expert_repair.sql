create or replace function public.get_market_draft_expert_repair_context(
  draft_id_input uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  draft_row private.market_drafts%rowtype;
  binding_row private.market_source_bindings%rowtype;
begin
  perform private.require_current_admin();

  select * into draft_row
  from private.market_drafts
  where id = draft_id_input;

  if not found then
    raise exception 'DRAFT_NOT_FOUND' using errcode = 'P0001';
  end if;

  select * into binding_row
  from private.market_source_bindings
  where draft_id = draft_id_input
    and status <> 'superseded'
  order by plan_version desc, created_at desc
  limit 1;

  return jsonb_build_object(
    'draft', to_jsonb(draft_row) - 'created_by' - 'updated_by' - 'human_confirmed_by',
    'deterministic_issues', private.market_draft_deterministic_issues(draft_row),
    'latest_review', (
      select to_jsonb(review_row) - 'reviewed_by'
      from private.market_review_reports review_row
      where review_row.draft_id = draft_id_input
      order by review_row.created_at desc
      limit 1
    ),
    'binding', case
      when binding_row.id is null then null
      else to_jsonb(binding_row)
    end,
    'binding_sources', case
      when binding_row.id is null then '[]'::jsonb
      else coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'url', source_row.source_url,
            'role', source_row.role,
            'precedence', source_row.precedence,
            'fallback_condition', source_row.fallback_condition,
            'required', source_row.required
          ) order by source_row.precedence
        )
        from private.market_source_binding_sources source_row
        where source_row.binding_id = binding_row.id
      ), '[]'::jsonb)
    end
  );
end;
$$;

revoke all on function public.get_market_draft_expert_repair_context(uuid) from public, anon;
grant execute on function public.get_market_draft_expert_repair_context(uuid) to authenticated;

comment on function public.get_market_draft_expert_repair_context(uuid) is
  'Devuelve a la administradora el borrador, la revisión vigente y su Plan de Resolución para preparar una reparación experta. No modifica datos.';

create or replace function public.apply_market_draft_expert_repair(
  draft_id_input uuid,
  expected_version_input bigint,
  draft_input jsonb,
  contract_input jsonb,
  sources_input jsonb,
  repair_meta_input jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := private.require_current_admin();
  before_row private.market_drafts%rowtype;
  active_binding private.market_source_bindings%rowtype;
  save_result jsonb;
  saved_draft_id uuid;
  saved_version bigint;
  binding_result jsonb := null;
  origin_type_value text;
  origin_id_value text;
  expert_run_value uuid;
  contract_question text;
  contract_timezone text;
  contract_evaluation timestamptz;
  draft_evaluation timestamptz;
  primary_source_url text;
  contract_primary_url text;
begin
  if jsonb_typeof(draft_input) <> 'object'
    or jsonb_typeof(contract_input) <> 'object'
    or jsonb_typeof(sources_input) <> 'array'
    or jsonb_typeof(repair_meta_input) <> 'object' then
    raise exception 'INVALID_EXPERT_REPAIR_PAYLOAD' using errcode = '22023';
  end if;

  if octet_length(draft_input::text) > 65536
    or octet_length(contract_input::text) > 65536
    or octet_length(sources_input::text) > 32768
    or octet_length(repair_meta_input::text) > 16384 then
    raise exception 'EXPERT_REPAIR_PAYLOAD_TOO_LARGE' using errcode = '22023';
  end if;

  select * into before_row
  from private.market_drafts
  where id = draft_id_input
  for update;

  if not found then
    raise exception 'DRAFT_NOT_FOUND' using errcode = 'P0001';
  end if;

  if expected_version_input is null or before_row.content_version <> expected_version_input then
    raise exception 'DRAFT_VERSION_MOVED' using errcode = '40001';
  end if;

  if before_row.workflow_status in (
    'published', 'early_closed', 'cancelled', 'pending_resolution', 'resolved', 'annulled'
  ) then
    raise exception 'PUBLISHED_MARKET_FIELDS_LOCKED' using errcode = '22023';
  end if;

  if before_row.workflow_status not in (
    'draft_incomplete', 'draft_ready', 'review_rejected', 'review_inconclusive', 'review_unavailable'
  ) then
    raise exception 'DRAFT_NOT_REPAIRABLE_IN_CURRENT_STATE' using errcode = '22023';
  end if;

  contract_question := trim(coalesce(contract_input ->> 'canonical_statement', ''));
  if contract_question = '' or contract_question <> trim(coalesce(draft_input ->> 'question', '')) then
    raise exception 'REPAIR_CONTRACT_QUESTION_MISMATCH' using errcode = '22023';
  end if;

  contract_timezone := trim(coalesce(contract_input ->> 'timezone', ''));
  if contract_timezone = '' or contract_timezone <> trim(coalesce(draft_input ->> 'timezone', '')) then
    raise exception 'REPAIR_CONTRACT_TIMEZONE_MISMATCH' using errcode = '22023';
  end if;

  begin
    contract_evaluation := coalesce(
      nullif(trim(contract_input ->> 'evaluation_at'), '')::timestamptz,
      nullif(trim(contract_input ->> 'window_end'), '')::timestamptz
    );
    draft_evaluation := nullif(trim(draft_input ->> 'evaluation_ends_at'), '')::timestamptz;
  exception when invalid_datetime_format then
    raise exception 'INVALID_DRAFT_DATE' using errcode = '22007';
  end;

  if contract_evaluation is null or draft_evaluation is null
    or contract_evaluation is distinct from draft_evaluation then
    raise exception 'REPAIR_CONTRACT_DATE_MISMATCH' using errcode = '22023';
  end if;

  primary_source_url := trim(coalesce(draft_input -> 'primary_source' ->> 'url', ''));
  select trim(coalesce(item ->> 'url', '')) into contract_primary_url
  from jsonb_array_elements(sources_input) item
  where item ->> 'role' = 'PRIMARY_RESOLUTION'
  order by coalesce((item ->> 'precedence')::integer, 1)
  limit 1;

  if primary_source_url = '' or contract_primary_url is null
    or primary_source_url <> contract_primary_url then
    raise exception 'REPAIR_PRIMARY_SOURCE_MISMATCH' using errcode = '22023';
  end if;

  select * into active_binding
  from private.market_source_bindings
  where draft_id = draft_id_input
    and status <> 'superseded'
  order by plan_version desc, created_at desc
  limit 1;

  save_result := public.save_market_draft(
    draft_id_input,
    expected_version_input,
    draft_input
  );

  saved_draft_id := (save_result -> 'draft' ->> 'id')::uuid;
  saved_version := (save_result -> 'draft' ->> 'content_version')::bigint;

  origin_type_value := coalesce(
    before_row.intelligence_origin_type,
    active_binding.origin_type
  );
  origin_id_value := coalesce(
    before_row.intelligence_origin_id,
    active_binding.origin_id
  );
  expert_run_value := coalesce(
    before_row.expert_run_id,
    active_binding.expert_run_id
  );

  if expert_run_value is not null then
    if origin_type_value is null or origin_id_value is null then
      raise exception 'MARKET_INTELLIGENCE_ORIGIN_REQUIRED' using errcode = '22023';
    end if;

    update private.market_source_bindings
    set status = 'superseded', updated_at = now()
    where draft_id = saved_draft_id
      and status not in ('closed', 'superseded');

    binding_result := public.bind_market_draft_intelligence(
      saved_draft_id,
      origin_type_value,
      origin_id_value,
      expert_run_value,
      contract_input,
      sources_input
    );
  end if;

  insert into private.market_admin_audit(
    actor_id,
    action_code,
    draft_id,
    draft_version,
    detail
  ) values (
    actor_id,
    'MARKET_DRAFT_EXPERT_REPAIR_APPLIED',
    saved_draft_id,
    saved_version,
    jsonb_build_object(
      'changed_fields', coalesce(repair_meta_input -> 'changed_fields', '[]'::jsonb),
      'repair_policy', coalesce(repair_meta_input ->> 'repair_policy', 'atinara-draft-repair-v1'),
      'repair_mode', coalesce(repair_meta_input ->> 'repair_mode', 'expert_with_deterministic_guardrails'),
      'degraded', coalesce((repair_meta_input ->> 'degraded')::boolean, false),
      'review_requested_after_repair', true
    )
  );

  return save_result || jsonb_build_object(
    'repair_applied', true,
    'intelligence_binding', binding_result,
    'previous_version', expected_version_input,
    'new_version', saved_version
  );
end;
$$;

revoke all on function public.apply_market_draft_expert_repair(uuid,bigint,jsonb,jsonb,jsonb,jsonb) from public, anon;
grant execute on function public.apply_market_draft_expert_repair(uuid,bigint,jsonb,jsonb,jsonb,jsonb) to authenticated;

comment on function public.apply_market_draft_expert_repair(uuid,bigint,jsonb,jsonb,jsonb,jsonb) is
  'Aplica de forma atómica una reparación experta a un borrador privado, invalida la revisión anterior y versiona su Plan de Resolución. No confirma, programa, publica ni resuelve.';
