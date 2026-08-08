-- Reparación detectada por el smoke transaccional de Agente Editor/Observatorio.
-- Separa la variable de iteración del alias SQL item.

begin;

create or replace function public.bind_market_draft_intelligence(
  draft_id_input uuid,
  origin_type_input text,
  origin_id_input text,
  expert_run_id_input uuid,
  contract_input jsonb,
  sources_input jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor_id uuid := private.require_current_admin();
  run_row private.market_expert_runs%rowtype;
  draft_row private.market_drafts%rowtype;
  active_binding private.market_source_bindings%rowtype;
  binding_row private.market_source_bindings%rowtype;
  source_item jsonb;
  sync_result jsonb;
  monitor_required_value boolean;
  primary_count integer;
  invalid_source_count integer;
  duplicate_precedence_count integer;
begin
  if jsonb_typeof(coalesce(contract_input, '{}'::jsonb)) <> 'object'
     or jsonb_typeof(coalesce(sources_input, '[]'::jsonb)) <> 'array' then
    raise exception 'RESOLUTION_PLAN_REQUIRED' using errcode = '22023';
  end if;
  select * into run_row
  from private.market_expert_runs
  where id = expert_run_id_input
    and origin_type = origin_type_input
    and origin_id = origin_id_input
    and status = 'completed';
  if not found then raise exception 'MARKET_EXPERT_ANALYSIS_REQUIRED' using errcode = '22023'; end if;
  select * into draft_row from private.market_drafts where id = draft_id_input for update;
  if not found then raise exception 'DRAFT_NOT_FOUND' using errcode = 'P0001'; end if;

  select
    count(*) filter (where item ->> 'role' = 'PRIMARY_RESOLUTION'),
    count(*) filter (where
      coalesce(item ->> 'url', '') !~ '^https://'
      or coalesce(item ->> 'role', '') not in (
        'DISCOVERY_SIGNAL', 'PROBABILITY_SIGNAL', 'CONTEXT_SOURCE',
        'PRIMARY_RESOLUTION', 'FALLBACK_RESOLUTION', 'CORROBORATION',
        'PROHIBITED_FOR_RESOLUTION'
      )
      or coalesce(item ->> 'precedence', '') !~ '^[1-9][0-9]*$'
    ),
    count(*) - count(distinct item ->> 'precedence')
  into primary_count, invalid_source_count, duplicate_precedence_count
  from jsonb_array_elements(sources_input) source_rows(item);
  if primary_count <> 1 then
    raise exception 'RESOLUTION_PRIMARY_SOURCE_REQUIRED' using errcode = '22023';
  end if;
  if invalid_source_count > 0 or duplicate_precedence_count > 0 then
    raise exception 'RESOLUTION_SOURCE_ASSIGNMENT_INVALID' using errcode = '22023';
  end if;
  if private.market_normalize_text(contract_input ->> 'canonical_statement')
     is distinct from private.market_normalize_text(draft_row.question) then
    raise exception 'RESOLUTION_PLAN_DRAFT_MISMATCH' using errcode = '22023';
  end if;

  select * into active_binding
  from private.market_source_bindings
  where draft_id = draft_id_input and status <> 'superseded'
  order by plan_version desc, created_at desc
  limit 1;
  if active_binding.id is not null then
    if active_binding.origin_type is distinct from origin_type_input
       or active_binding.origin_id is distinct from origin_id_input
       or active_binding.expert_run_id is distinct from expert_run_id_input then
      raise exception 'MARKET_INTELLIGENCE_ORIGIN_MISMATCH' using errcode = '22023';
    end if;
    sync_result := private.sync_market_draft_binding(
      draft_id_input,
      actor_id,
      contract_input,
      sources_input,
      'intelligence_binding_retry_or_update'
    );
    update private.market_drafts set
      intelligence_origin_type = origin_type_input,
      intelligence_origin_id = origin_id_input,
      expert_run_id = run_row.id
    where id = draft_id_input;
    return sync_result || jsonb_build_object(
      'origin_type', origin_type_input,
      'origin_id', origin_id_input,
      'expert_run_id', run_row.id,
      'idempotent', true
    );
  end if;

  monitor_required_value := coalesce(contract_input ->> 'capture_strategy', '') in (
    'snapshot_at_deadline', 'poll_during_window', 'event_presence'
  );
  insert into private.market_source_bindings(
    draft_id, origin_type, origin_id, expert_run_id, plan_version,
    contract_schema_version, policy_version, resolution_contract,
    provider, adapter_version, monitor_required, monitor_readiness
  ) values (
    draft_id_input,
    origin_type_input,
    origin_id_input,
    run_row.id,
    1,
    coalesce(contract_input ->> 'contract_schema_version', 'atinara-resolution-contract-v1'),
    run_row.policy_version,
    jsonb_set(contract_input, '{sources}', sources_input, true),
    coalesce(contract_input ->> 'provider', run_row.provider),
    coalesce(contract_input ->> 'provider_adapter_version', 'unknown'),
    monitor_required_value,
    case when monitor_required_value then 'required' else 'not_required' end
  ) returning * into binding_row;

  for source_item in select value from jsonb_array_elements(sources_input) loop
    insert into private.market_source_binding_sources(
      binding_id, source_url, role, precedence, fallback_condition, required
    ) values (
      binding_row.id,
      left(source_item ->> 'url', 2048),
      source_item ->> 'role',
      (source_item ->> 'precedence')::integer,
      nullif(source_item ->> 'fallback_condition', ''),
      coalesce((source_item ->> 'required')::boolean, false)
    );
  end loop;

  update private.market_drafts set
    intelligence_origin_type = origin_type_input,
    intelligence_origin_id = origin_id_input,
    expert_run_id = run_row.id,
    updated_at = now(),
    updated_by = actor_id
  where id = draft_id_input;
  insert into private.market_admin_audit(actor_id, action_code, draft_id, draft_version, detail)
  values (
    actor_id,
    'MARKET_INTELLIGENCE_BOUND',
    draft_id_input,
    draft_row.content_version,
    jsonb_build_object(
      'binding_id', binding_row.id,
      'origin_type', origin_type_input,
      'plan_version', binding_row.plan_version,
      'idempotent', true
    )
  );
  return to_jsonb(binding_row) || jsonb_build_object('changed', true, 'idempotent', true);
end;
$function$;

revoke all on function public.bind_market_draft_intelligence(uuid,text,text,uuid,jsonb,jsonb)
  from public, anon, authenticated;
grant execute on function public.bind_market_draft_intelligence(uuid,text,text,uuid,jsonb,jsonb)
  to authenticated;

comment on function public.bind_market_draft_intelligence(uuid,text,text,uuid,jsonb,jsonb) is
  'Binding idempotente sin colisiones PL/pgSQL entre variables y alias de fuentes.';

commit;

