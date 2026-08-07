begin;

create or replace function public.save_market_draft_from_radar_intelligence(
  candidate_id_input uuid,
  draft_id_input uuid,
  expected_version_input bigint,
  draft_input jsonb,
  expert_run_id_input uuid,
  contract_input jsonb,
  sources_input jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor_id uuid := private.require_current_admin();
  run_row private.market_expert_runs%rowtype;
  save_result jsonb;
  saved_draft_id uuid;
  binding_result jsonb;
  primary_count integer;
  invalid_source_count integer;
  duplicate_precedence_count integer;
  contract_evaluation_at timestamptz;
  draft_evaluation_at timestamptz;
  contract_primary_url text;
  draft_primary_url text;
begin
  if candidate_id_input is null or expert_run_id_input is null then
    raise exception 'RADAR_EXPERT_INPUT_REQUIRED' using errcode = '22023';
  end if;

  if draft_id_input is not null then
    raise exception 'RADAR_EXPERT_DRAFT_MUST_BE_NEW' using errcode = '22023';
  end if;

  if jsonb_typeof(coalesce(draft_input, '{}'::jsonb)) <> 'object'
     or jsonb_typeof(coalesce(contract_input, '{}'::jsonb)) <> 'object'
     or jsonb_typeof(coalesce(sources_input, '[]'::jsonb)) <> 'array' then
    raise exception 'RADAR_EXPERT_PAYLOAD_INVALID' using errcode = '22023';
  end if;

  select *
  into run_row
  from private.market_expert_runs
  where id = expert_run_id_input
    and origin_type = 'radar_candidate'
    and origin_id = candidate_id_input::text
    and status = 'completed';

  if not found then
    raise exception 'MARKET_EXPERT_ANALYSIS_REQUIRED' using errcode = '22023';
  end if;

  if run_row.decision not in ('create', 'create_with_edits')
     or run_row.integrity_status not in ('pass', 'needs_edit')
     or run_row.forecastability_status not in ('forecastable', 'valid_low_probability', 'valid_very_unlikely')
     or run_row.source_readiness not in ('ready', 'ready_with_warnings', 'needs_monitoring') then
    raise exception 'MARKET_EXPERT_DECISION_BLOCKED' using errcode = '22023';
  end if;

  if coalesce(contract_input ->> 'contract_schema_version', '') <> 'atinara-resolution-contract-v1'
     or coalesce(contract_input ->> 'policy_version', '') <> run_row.policy_version
     or coalesce(contract_input ->> 'origin_type', '') <> 'radar_candidate'
     or coalesce(contract_input ->> 'origin_id', '') <> candidate_id_input::text then
    raise exception 'RESOLUTION_PLAN_VERSION_MISMATCH' using errcode = '22023';
  end if;

  begin
    contract_evaluation_at := coalesce(
      nullif(contract_input ->> 'evaluation_at', '')::timestamptz,
      nullif(contract_input ->> 'window_end', '')::timestamptz
    );
    draft_evaluation_at := nullif(draft_input ->> 'evaluation_ends_at', '')::timestamptz;
  exception when invalid_datetime_format then
    raise exception 'INVALID_DRAFT_DATE' using errcode = '22007';
  end;

  if nullif(trim(contract_input ->> 'canonical_statement'), '') is null
     or contract_evaluation_at is null
     or draft_evaluation_at is null then
    raise exception 'RESOLUTION_PLAN_REQUIRED' using errcode = '22023';
  end if;

  if trim(contract_input ->> 'canonical_statement') <> trim(coalesce(draft_input ->> 'question', ''))
     or contract_evaluation_at <> draft_evaluation_at then
    raise exception 'RESOLUTION_PLAN_DRAFT_MISMATCH' using errcode = '22023';
  end if;

  if jsonb_typeof(coalesce(contract_input -> 'sources', '[]'::jsonb)) <> 'array'
     or coalesce(contract_input -> 'sources', '[]'::jsonb) <> sources_input then
    raise exception 'RESOLUTION_SOURCE_ASSIGNMENT_MISMATCH' using errcode = '22023';
  end if;

  select
    count(*) filter (where item ->> 'role' = 'PRIMARY_RESOLUTION'),
    count(*) filter (
      where coalesce(item ->> 'url', '') !~ '^https://'
         or coalesce(item ->> 'role', '') not in (
           'DISCOVERY_SIGNAL', 'PROBABILITY_SIGNAL', 'CONTEXT_SOURCE',
           'PRIMARY_RESOLUTION', 'FALLBACK_RESOLUTION', 'CORROBORATION',
           'PROHIBITED_FOR_RESOLUTION'
         )
         or coalesce(item ->> 'precedence', '') !~ '^[1-9][0-9]*$'
         or case
              when coalesce(item ->> 'precedence', '') ~ '^[1-9][0-9]*$'
              then (item ->> 'precedence')::integer < 1
              else true
            end
    ),
    count(*) - count(distinct (item ->> 'precedence'))
  into primary_count, invalid_source_count, duplicate_precedence_count
  from jsonb_array_elements(sources_input) as source_rows(item);

  if primary_count <> 1 then
    raise exception 'RESOLUTION_PRIMARY_SOURCE_REQUIRED' using errcode = '22023';
  end if;

  select item ->> 'url'
  into contract_primary_url
  from jsonb_array_elements(sources_input) as source_rows(item)
  where item ->> 'role' = 'PRIMARY_RESOLUTION'
  limit 1;
  draft_primary_url := nullif(trim(draft_input -> 'primary_source' ->> 'url'), '');

  if contract_primary_url is null
     or draft_primary_url is null
     or contract_primary_url <> draft_primary_url then
    raise exception 'RESOLUTION_PRIMARY_SOURCE_DRAFT_MISMATCH' using errcode = '22023';
  end if;

  if invalid_source_count > 0 or duplicate_precedence_count > 0 then
    raise exception 'RESOLUTION_SOURCE_ASSIGNMENT_INVALID' using errcode = '22023';
  end if;

  -- Las dos llamadas siguientes forman parte de la misma transacción de esta RPC.
  -- Si el binding falla, el borrador y la reserva de la candidata se revierten.
  save_result := public.save_market_draft_from_radar(
    candidate_id_input,
    draft_id_input,
    expected_version_input,
    draft_input
  );

  saved_draft_id := (save_result -> 'draft' ->> 'id')::uuid;

  binding_result := public.bind_market_draft_intelligence(
    saved_draft_id,
    'radar_candidate',
    candidate_id_input::text,
    run_row.id,
    contract_input,
    sources_input
  );

  return save_result || jsonb_build_object(
    'intelligence_binding', binding_result,
    'expert_run_id', run_row.id,
    'origin_type', 'radar_candidate',
    'origin_id', candidate_id_input::text,
    'atomic', true,
    'published', false,
    'resolved', false,
    'actor_id_recorded', actor_id is not null
  );
end;
$function$;

revoke all on function public.save_market_draft_from_radar_intelligence(
  uuid, uuid, bigint, jsonb, uuid, jsonb, jsonb
) from public, anon;

grant execute on function public.save_market_draft_from_radar_intelligence(
  uuid, uuid, bigint, jsonb, uuid, jsonb, jsonb
) to authenticated;

comment on function public.save_market_draft_from_radar_intelligence(
  uuid, uuid, bigint, jsonb, uuid, jsonb, jsonb
) is 'Guarda atómicamente un borrador privado procedente del Radar y conserva la ejecución experta, el Plan de Resolución y sus fuentes. No aprueba, programa, publica, arma monitores ni resuelve.';

commit;
