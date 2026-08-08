-- La confirmación humana debe aceptar tanto Planes de Resolución procedentes de
-- una ejecución experta completada como los planes manuales deterministas que
-- crea el Corrector. La procedencia sigue siendo cerrada: un plan sin ejecución
-- experta solo es válido si su contrato, sus fuentes y su auditoría interna
-- demuestran que pertenece al flujo determinista autorizado.

create or replace function private.market_source_binding_provenance(
  binding_id_input uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  binding_row private.market_source_bindings%rowtype;
  issues jsonb := '[]'::jsonb;
  provenance_mode text;
  stored_sources jsonb := '[]'::jsonb;
  contract_sources jsonb := '[]'::jsonb;
begin
  select * into binding_row
  from private.market_source_bindings
  where id = binding_id_input;

  if not found then
    return jsonb_build_object(
      'valid', false,
      'mode', 'missing',
      'issues', jsonb_build_array('SOURCE_BINDING_NOT_FOUND')
    );
  end if;

  if binding_row.expert_run_id is not null then
    provenance_mode := 'completed_expert_run';
    if not exists (
      select 1
      from private.market_expert_runs run_row
      where run_row.id = binding_row.expert_run_id
        and run_row.status = 'completed'
        and run_row.policy_version = binding_row.policy_version
        and run_row.origin_type = binding_row.origin_type
        and run_row.origin_id = binding_row.origin_id
    ) then
      issues := issues || jsonb_build_array('MARKET_EXPERT_ANALYSIS_REQUIRED');
    end if;
  else
    provenance_mode := 'deterministic_manual_plan';

    if binding_row.monitor_required
       or binding_row.monitor_readiness <> 'not_required' then
      issues := issues || jsonb_build_array('DETERMINISTIC_PLAN_CANNOT_REQUIRE_MONITOR');
    end if;
    if coalesce(binding_row.resolution_contract ->> 'capture_strategy', '')
       <> 'manual_official_source' then
      issues := issues || jsonb_build_array('DETERMINISTIC_PLAN_CAPTURE_STRATEGY_INVALID');
    end if;
    if coalesce(binding_row.resolution_contract ->> 'evidence_mode', '')
       <> 'human_review_of_official_source' then
      issues := issues || jsonb_build_array('DETERMINISTIC_PLAN_EVIDENCE_MODE_INVALID');
    end if;
    if nullif(trim(coalesce(
      binding_row.resolution_contract ->> 'manual_review_instructions', ''
    )), '') is null then
      issues := issues || jsonb_build_array('DETERMINISTIC_PLAN_HUMAN_INSTRUCTIONS_REQUIRED');
    end if;
    if coalesce(binding_row.resolution_contract ->> 'missing_data_treatment', '')
       <> 'manual_review_no_assumption' then
      issues := issues || jsonb_build_array('DETERMINISTIC_PLAN_MISSING_DATA_POLICY_INVALID');
    end if;
    if coalesce(binding_row.resolution_contract ->> 'source_conflict_treatment', '')
       <> 'pause_and_specific_human_review' then
      issues := issues || jsonb_build_array('DETERMINISTIC_PLAN_CONFLICT_POLICY_INVALID');
    end if;
    if nullif(trim(coalesce(binding_row.adapter_version, '')), '') is null
       or binding_row.adapter_version = 'unknown'
       or binding_row.resolution_contract ->> 'provider_adapter_version'
          is distinct from binding_row.adapter_version then
      issues := issues || jsonb_build_array('DETERMINISTIC_PLAN_ADAPTER_PROVENANCE_INVALID');
    end if;
    if binding_row.resolution_contract ->> 'contract_schema_version'
       is distinct from binding_row.contract_schema_version
       or binding_row.resolution_contract ->> 'policy_version'
          is distinct from binding_row.policy_version
       or binding_row.resolution_contract ->> 'provider'
          is distinct from binding_row.provider then
      issues := issues || jsonb_build_array('DETERMINISTIC_PLAN_CONTRACT_IDENTITY_INVALID');
    end if;

    if jsonb_typeof(binding_row.resolution_contract -> 'sources') <> 'array' then
      issues := issues || jsonb_build_array('DETERMINISTIC_PLAN_SOURCES_REQUIRED');
    else
      if exists (
        select 1
        from jsonb_array_elements(binding_row.resolution_contract -> 'sources') source_item(value)
        where trim(coalesce(source_item.value ->> 'url', '')) !~ '^https://'
          or coalesce(source_item.value ->> 'role', '') not in (
            'DISCOVERY_SIGNAL', 'PROBABILITY_SIGNAL', 'CONTEXT_SOURCE',
            'PRIMARY_RESOLUTION', 'FALLBACK_RESOLUTION', 'CORROBORATION',
            'PROHIBITED_FOR_RESOLUTION'
          )
          or coalesce(source_item.value ->> 'precedence', '') !~ '^[1-9][0-9]*$'
          or lower(coalesce(source_item.value ->> 'required', 'false')) not in ('true', 'false')
          or (
            source_item.value ->> 'role' = 'FALLBACK_RESOLUTION'
            and nullif(trim(coalesce(source_item.value ->> 'fallback_condition', '')), '') is null
          )
      ) then
        issues := issues || jsonb_build_array('DETERMINISTIC_PLAN_SOURCE_ASSIGNMENTS_INVALID');
      end if;

      select coalesce(jsonb_agg(
        jsonb_strip_nulls(jsonb_build_object(
          'url', trim(coalesce(source_item.value ->> 'url', '')),
          'role', source_item.value ->> 'role',
          'precedence', case
            when coalesce(source_item.value ->> 'precedence', '') ~ '^[1-9][0-9]*$'
              then (source_item.value ->> 'precedence')::integer
            else null
          end,
          'fallback_condition', nullif(trim(coalesce(source_item.value ->> 'fallback_condition', '')), ''),
          'required', case
            when lower(coalesce(source_item.value ->> 'required', 'false')) in ('true', 'false')
              then coalesce((source_item.value ->> 'required')::boolean, false)
            else false
          end
        )) order by
          case
            when coalesce(source_item.value ->> 'precedence', '') ~ '^[1-9][0-9]*$'
              then (source_item.value ->> 'precedence')::integer
            else 2147483647
          end,
          trim(coalesce(source_item.value ->> 'url', ''))
      ), '[]'::jsonb)
      into contract_sources
      from jsonb_array_elements(binding_row.resolution_contract -> 'sources') source_item(value);

      select coalesce(jsonb_agg(
        jsonb_strip_nulls(jsonb_build_object(
          'url', trim(source_row.source_url),
          'role', source_row.role,
          'precedence', source_row.precedence,
          'fallback_condition', nullif(trim(coalesce(source_row.fallback_condition, '')), ''),
          'required', source_row.required
        )) order by source_row.precedence, source_row.source_url
      ), '[]'::jsonb)
      into stored_sources
      from private.market_source_binding_sources source_row
      where source_row.binding_id = binding_row.id;

      if jsonb_array_length(stored_sources) = 0
         or contract_sources is distinct from stored_sources
         or (select count(*) from jsonb_array_elements(stored_sources) source_item(value)
             where source_item.value ->> 'role' = 'PRIMARY_RESOLUTION') <> 1 then
        issues := issues || jsonb_build_array('DETERMINISTIC_PLAN_SOURCE_ASSIGNMENTS_CHANGED');
      end if;
    end if;

    if not exists (
      select 1
      from private.market_admin_audit audit_row
      where audit_row.draft_id = binding_row.draft_id
        and audit_row.actor_id is not null
        and audit_row.action_code in (
          'SOURCE_BINDING_CREATED_BY_AUTONOMOUS_REPAIR',
          'SOURCE_BINDING_VERSIONED_WITH_DRAFT'
        )
        and audit_row.detail ->> 'binding_id' = binding_row.id::text
    ) then
      issues := issues || jsonb_build_array('DETERMINISTIC_PLAN_AUDIT_PROVENANCE_REQUIRED');
    end if;
  end if;

  return jsonb_build_object(
    'valid', jsonb_array_length(issues) = 0,
    'mode', provenance_mode,
    'issues', issues
  );
end;
$function$;

revoke all on function private.market_source_binding_provenance(uuid)
  from public, anon, authenticated, service_role;

comment on function private.market_source_binding_provenance(uuid) is
'Clasifica y valida la procedencia cerrada de un Plan de Resolución: ejecución experta completada o plan manual determinista auditado.';

create or replace function private.assert_market_source_publication_ready(
  draft_id_input uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  draft_row private.market_drafts%rowtype;
  binding_row private.market_source_bindings%rowtype;
  provenance_state jsonb;
begin
  select * into draft_row
  from private.market_drafts
  where id = draft_id_input;
  if not found then raise exception 'DRAFT_NOT_FOUND' using errcode = 'P0001'; end if;

  select * into binding_row
  from private.market_source_bindings
  where draft_id = draft_id_input
    and status <> 'superseded'
  order by plan_version desc, created_at desc
  limit 1;

  if draft_row.intelligence_origin_type is null and not found then return; end if;
  if not found then raise exception 'SOURCE_BINDING_REQUIRED' using errcode = '22023'; end if;

  if binding_row.contract_hash is null
     or binding_row.locked_at is null
     or binding_row.locked_by is null then
    raise exception 'RESOLUTION_PLAN_NOT_LOCKED' using errcode = '22023';
  end if;
  if binding_row.status not in ('validated', 'armed') then
    raise exception 'SOURCE_CONTRACT_NOT_LOCKED' using errcode = '22023';
  end if;
  if not coalesce((binding_row.validation ->> 'valid')::boolean, false) then
    raise exception 'SOURCE_BINDING_VALIDATION_REQUIRED'
      using errcode = '22023', detail = coalesce(binding_row.validation, '{}'::jsonb)::text;
  end if;
  if binding_row.contract_hash
     is distinct from private.market_intelligence_hash(binding_row.resolution_contract) then
    raise exception 'SOURCE_BINDING_CONTRACT_CHANGED' using errcode = '55000';
  end if;

  if binding_row.monitor_required
     and (binding_row.status <> 'armed' or binding_row.monitor_readiness <> 'armed') then
    raise exception 'SOURCE_MONITOR_NOT_ARMED' using errcode = '22023';
  end if;
  if binding_row.monitor_required and not coalesce((
    select enabled
    from private.market_intelligence_runtime_settings
    where setting_key = 'source_monitor_scheduler_enabled'
  ), false) then
    raise exception 'SOURCE_SCHEDULER_NOT_ENABLED' using errcode = '22023';
  end if;

  provenance_state := private.market_source_binding_provenance(binding_row.id);
  if not coalesce((provenance_state ->> 'valid')::boolean, false) then
    if provenance_state ->> 'mode' = 'completed_expert_run'
       and provenance_state -> 'issues' @> '["MARKET_EXPERT_ANALYSIS_REQUIRED"]'::jsonb then
      raise exception 'MARKET_EXPERT_ANALYSIS_REQUIRED'
        using errcode = '22023', detail = (provenance_state -> 'issues')::text;
    end if;
    raise exception 'SOURCE_BINDING_PROVENANCE_REQUIRED'
      using errcode = '22023', detail = (provenance_state -> 'issues')::text;
  end if;
end;
$function$;

revoke all on function private.assert_market_source_publication_ready(uuid)
  from public, anon, authenticated, service_role;

comment on function private.assert_market_source_publication_ready(uuid) is
'Puerta fail-closed para confirmar, programar o publicar: exige contrato inmutable y procedencia experta o determinista verificable.';
