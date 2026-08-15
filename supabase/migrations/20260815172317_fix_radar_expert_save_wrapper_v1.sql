begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';

-- La capa de revisión del Editor conserva metadatos de preparación que el
-- writer base no debe persistir. Al añadirse las puertas factual y de
-- elegibilidad, el helper preexistente quedó enlazado por nombre al wrapper
-- público nuevo. Ese rebinding reintroducía el guard ya consumido y hacía
-- imposible el primer guardado. La reparación vuelve a enlazar la capa interna
-- con la implementación pre-gate preservada y mantiene los wrappers públicos.

do $preflight$
declare
  base_writer regprocedure := to_regprocedure(
    'public.save_market_draft_from_radar_without_authoritative_fact_gate_v1(uuid,uuid,bigint,jsonb)'
  );
  internal_writer regprocedure := to_regprocedure(
    'public.save_market_draft_from_radar_intelligence_without_revision_guard(uuid,uuid,bigint,jsonb,uuid,jsonb,jsonb)'
  );
  expert_gate regprocedure := to_regprocedure(
    'public.save_market_draft_from_radar_intelligence_without_authoritative_fact_gate_v1(uuid,uuid,bigint,jsonb,uuid,jsonb,jsonb)'
  );
  radar_writer regprocedure := to_regprocedure(
    'public.save_market_draft_from_radar(uuid,uuid,bigint,jsonb)'
  );
  expert_writer regprocedure := to_regprocedure(
    'public.save_market_draft_from_radar_intelligence(uuid,uuid,bigint,jsonb,uuid,jsonb,jsonb)'
  );
  internal_definition text;
  expert_gate_definition text;
  radar_definition text;
  expert_definition text;
begin
  if base_writer is null
     or internal_writer is null
     or expert_gate is null
     or radar_writer is null
     or expert_writer is null then
    raise exception 'RADAR_EXPERT_SAVE_WRAPPER_PREFLIGHT_FAILED'
      using errcode = '55000';
  end if;

  select pg_get_functiondef(internal_writer) into internal_definition;
  select pg_get_functiondef(expert_gate) into expert_gate_definition;
  select pg_get_functiondef(radar_writer) into radar_definition;
  select pg_get_functiondef(expert_writer) into expert_definition;

  if position('public.save_market_draft_from_radar(' in internal_definition) = 0
     or position(
       'public.save_market_draft_from_radar_without_authoritative_fact_gate_v1('
       in internal_definition
     ) > 0
     or position(
       'public.save_market_draft_from_radar_intelligence_without_revision_guard('
       in expert_gate_definition
     ) = 0
     or position(
       'private.assert_market_radar_candidate_eligible_v1('
       in radar_definition
     ) = 0
     or position(
       'public.save_market_draft_from_radar_intelligence_without_authoritative_fact_gate_v1('
       in expert_definition
     ) = 0 then
    raise exception 'RADAR_EXPERT_SAVE_WRAPPER_DRIFT'
      using errcode = '55000';
  end if;

  if exists (
    select 1
    from pg_proc procedure
    join pg_roles owner on owner.oid = procedure.proowner
    where procedure.oid in (
      base_writer::oid,
      internal_writer::oid,
      expert_gate::oid,
      radar_writer::oid,
      expert_writer::oid
    )
      and (
        owner.rolname is distinct from 'postgres'
        or not procedure.prosecdef
        or not (procedure.proconfig @> array['search_path=""']::text[])
      )
  ) then
    raise exception 'RADAR_EXPERT_SAVE_WRAPPER_SECURITY_DRIFT'
      using errcode = '55000';
  end if;
end;
$preflight$;

create or replace function public.save_market_draft_from_radar_intelligence_without_revision_guard(
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
  active_binding private.market_source_bindings%rowtype;
  save_result jsonb;
  saved_draft_id uuid;
  binding_result jsonb;
  persisted_sources jsonb := '[]'::jsonb;
  expected_binding_contract jsonb;
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
     or run_row.forecastability_status not in (
       'forecastable', 'valid_low_probability', 'valid_very_unlikely'
     )
     or run_row.source_readiness not in (
       'ready', 'ready_with_warnings', 'needs_monitoring'
     ) then
    raise exception 'MARKET_EXPERT_DECISION_BLOCKED' using errcode = '22023';
  end if;

  if coalesce(contract_input ->> 'contract_schema_version', '')
       <> 'atinara-resolution-contract-v1'
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

  if trim(contract_input ->> 'canonical_statement')
       <> trim(coalesce(draft_input ->> 'question', ''))
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

  -- Esta es la implementación estable anterior a las puertas factual y de
  -- elegibilidad. Llamarla por su nombre preservado evita reentrar en el wrapper
  -- público y mantiene una sola validación de preparation_revision.
  save_result := public.save_market_draft_from_radar_without_authoritative_fact_gate_v1(
    candidate_id_input,
    draft_id_input,
    expected_version_input,
    draft_input
  );

  saved_draft_id := (save_result -> 'draft' ->> 'id')::uuid;

  if coalesce((save_result ->> 'idempotency_replay')::boolean, false) then
    select *
    into active_binding
    from private.market_source_bindings binding_alias
    where binding_alias.draft_id = saved_draft_id
      and binding_alias.status <> 'superseded'
    order by binding_alias.plan_version desc, binding_alias.created_at desc
    limit 1;

    expected_binding_contract := jsonb_set(
      contract_input, '{sources}', sources_input, true
    );
    select coalesce(jsonb_agg(jsonb_build_object(
      'url', source_alias.source_url,
      'role', source_alias.role,
      'precedence', source_alias.precedence,
      'fallback_condition', source_alias.fallback_condition,
      'required', source_alias.required
    ) order by source_alias.precedence, source_alias.id), '[]'::jsonb)
    into persisted_sources
    from private.market_source_binding_sources source_alias
    where source_alias.binding_id = active_binding.id;

    if active_binding.id is null
       or active_binding.origin_type is distinct from 'radar_candidate'
       or active_binding.origin_id is distinct from candidate_id_input::text
       or active_binding.expert_run_id is distinct from run_row.id
       or active_binding.resolution_contract is distinct from expected_binding_contract
       or persisted_sources is distinct from sources_input then
      raise exception 'RADAR_PREPARATION_REVISION_MISMATCH'
        using errcode = '40001';
    end if;

    binding_result := jsonb_build_object(
      'required', true,
      'changed', false,
      'compatible', true,
      'binding_id', active_binding.id,
      'plan_version', active_binding.plan_version,
      'origin_type', active_binding.origin_type,
      'origin_id', active_binding.origin_id,
      'expert_run_id', active_binding.expert_run_id,
      'idempotent', true
    );
  else
    binding_result := public.bind_market_draft_intelligence(
      saved_draft_id,
      'radar_candidate',
      candidate_id_input::text,
      run_row.id,
      contract_input,
      sources_input
    );
  end if;

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

-- Los wrappers de elegibilidad deben distinguir una intención inicial de la
-- repetición exacta que ya cambió available -> prepared. El writer inferior
-- valida la UUID, el hash y el draft reservado; cualquier payload distinto
-- falla y revierte antes de producir un segundo efecto.
create or replace function public.save_market_draft_from_radar(
  candidate_id_input uuid,
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
  candidate private.external_market_candidates%rowtype;
  eligibility private.market_radar_eligibility_checks%rowtype;
  submitted_revision bigint;
  prepared_replay boolean := false;
  save_result jsonb;
  saved_draft_id uuid;
begin
  if jsonb_typeof(draft_input) <> 'object'
     or coalesce(draft_input ->> '_radar_preparation_revision', '')
       !~ '^[1-9][0-9]*$' then
    raise exception 'RADAR_PREPARATION_REVISION_MISMATCH' using errcode = '40001';
  end if;
  submitted_revision := (draft_input ->> '_radar_preparation_revision')::bigint;

  select * into candidate
  from private.external_market_candidates candidate_alias
  where candidate_alias.id = candidate_id_input
  for update;
  if not found then
    raise exception 'RADAR_CANDIDATE_NOT_FOUND' using errcode = 'P0001';
  end if;

  prepared_replay := candidate.state = 'prepared'
    and candidate.preparation_revision = submitted_revision + 1
    and candidate.prepared_draft_id is not null
    and draft_id_input is null;
  if not prepared_replay then
    candidate := private.assert_market_radar_candidate_eligible_v1(
      candidate_id_input, submitted_revision
    );
  end if;

  if candidate.state not in ('available', 'prepared') then
    raise exception 'RADAR_CANDIDATE_NOT_PREPARABLE' using errcode = '55000';
  end if;
  if candidate.state = 'available'
     and exists (
       select 1
       from jsonb_array_elements(coalesce(candidate.duplicate_matches, '[]'::jsonb)) match
       where coalesce((match ->> 'blocking')::boolean, true)
         and match ->> 'relationship' in ('exact_duplicate', 'semantic_duplicate')
     ) then
    raise exception 'RADAR_CONFIRMED_DUPLICATE' using errcode = '23505';
  end if;
  select * into eligibility
  from private.market_radar_eligibility_checks
  where id = candidate.current_eligibility_check_id;

  save_result := public.save_market_draft_from_radar_without_authoritative_fact_gate_v1(
    candidate_id_input,
    draft_id_input,
    expected_version_input,
    draft_input - '_radar_fact_check_id' - '_radar_eligibility_check_id'
  );
  saved_draft_id := nullif(save_result #>> '{draft,id}', '')::uuid;
  -- Un replay preparado ya conserva la atestación inmutable del primer
  -- guardado. Una vinculación inicial a un draft existente sigue recorriendo
  -- esta rama aunque el writer base la considere un no-op de contenido.
  if saved_draft_id is not null and not prepared_replay then
    update private.market_drafts draft_alias set
      source_provenance = coalesce(draft_alias.source_provenance, '{}'::jsonb)
        || jsonb_build_object(
          'radar_candidate_id', candidate.id,
          'radar_preparation_revision', candidate.preparation_revision,
          'radar_eligibility_check_id', eligibility.id,
          'radar_eligibility_policy_version', eligibility.policy_version,
          'radar_eligibility_status', eligibility.status,
          'radar_eligibility_checked_at', eligibility.checked_at,
          'radar_eligibility_decision_hash', eligibility.decision_hash,
          'atomic_eligibility_gate', true
        )
    where draft_alias.id = saved_draft_id;
  end if;
  return save_result || jsonb_build_object(
    'radar_eligibility_check_id', eligibility.id,
    'radar_eligibility_policy_version', eligibility.policy_version,
    'atomic_eligibility_gate', true
  );
end;
$function$;

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
  actor_id_value uuid := private.require_current_admin();
  candidate private.external_market_candidates%rowtype;
  eligibility private.market_radar_eligibility_checks%rowtype;
  submitted_revision bigint;
  prepared_replay boolean := false;
  save_result jsonb;
  saved_draft_id uuid;
begin
  if jsonb_typeof(draft_input) <> 'object'
     or coalesce(draft_input ->> '_radar_preparation_revision', '')
       !~ '^[1-9][0-9]*$' then
    raise exception 'RADAR_PREPARATION_REVISION_MISMATCH' using errcode = '40001';
  end if;
  submitted_revision := (draft_input ->> '_radar_preparation_revision')::bigint;

  select * into candidate
  from private.external_market_candidates candidate_alias
  where candidate_alias.id = candidate_id_input
  for update;
  if not found then
    raise exception 'RADAR_CANDIDATE_NOT_FOUND' using errcode = 'P0001';
  end if;

  prepared_replay := candidate.state = 'prepared'
    and candidate.preparation_revision = submitted_revision + 1
    and candidate.prepared_draft_id is not null
    and draft_id_input is null;
  if not prepared_replay then
    candidate := private.assert_market_radar_candidate_eligible_v1(
      candidate_id_input, submitted_revision
    );
  end if;

  select * into eligibility
  from private.market_radar_eligibility_checks
  where id = candidate.current_eligibility_check_id;

  save_result := public.save_market_draft_from_radar_intelligence_without_authoritative_fact_gate_v1(
    candidate_id_input,
    draft_id_input,
    expected_version_input,
    draft_input - '_radar_fact_check_id' - '_radar_eligibility_check_id',
    expert_run_id_input,
    contract_input,
    sources_input
  );
  if prepared_replay
     and coalesce(
       (save_result #>> '{intelligence_binding,changed}')::boolean,
       true
     ) then
    -- El helper inferior puede versionar un binding compatible. Durante un
    -- replay preparado solo se admite identidad exacta; la excepción revierte
    -- cualquier intento de cambiar contrato o fuentes en esta transacción.
    raise exception 'RADAR_PREPARATION_REVISION_MISMATCH' using errcode = '40001';
  end if;
  saved_draft_id := nullif(save_result #>> '{draft,id}', '')::uuid;
  -- Igual que en la ruta manual, el replay solo devuelve el expediente ya
  -- creado; no modifica su procedencia ni vuelve a ligar la elegibilidad.
  if saved_draft_id is not null and not prepared_replay then
    update private.market_drafts draft_alias set
      source_provenance = coalesce(draft_alias.source_provenance, '{}'::jsonb)
        || jsonb_build_object(
          'radar_candidate_id', candidate.id,
          'radar_preparation_revision', candidate.preparation_revision,
          'radar_eligibility_check_id', eligibility.id,
          'radar_eligibility_policy_version', eligibility.policy_version,
          'radar_eligibility_status', eligibility.status,
          'radar_eligibility_checked_at', eligibility.checked_at,
          'radar_eligibility_decision_hash', eligibility.decision_hash,
          'market_expert_run_id', expert_run_id_input,
          'atomic_eligibility_gate', true
        )
    where draft_alias.id = saved_draft_id;
  end if;
  return save_result || jsonb_build_object(
    'radar_eligibility_check_id', eligibility.id,
    'radar_eligibility_policy_version', eligibility.policy_version,
    'atomic_eligibility_gate', true
  );
end;
$function$;

alter function public.save_market_draft_from_radar_intelligence_without_revision_guard(
  uuid,uuid,bigint,jsonb,uuid,jsonb,jsonb
) owner to postgres;
alter function public.save_market_draft_from_radar(uuid,uuid,bigint,jsonb)
  owner to postgres;
alter function public.save_market_draft_from_radar_intelligence(
  uuid,uuid,bigint,jsonb,uuid,jsonb,jsonb
) owner to postgres;

revoke all on function public.save_market_draft_from_radar_intelligence_without_revision_guard(
  uuid,uuid,bigint,jsonb,uuid,jsonb,jsonb
) from public, anon, authenticated, service_role;

revoke all on function public.save_market_draft_from_radar(uuid,uuid,bigint,jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.save_market_draft_from_radar(uuid,uuid,bigint,jsonb)
  to authenticated;

revoke all on function public.save_market_draft_from_radar_intelligence(
  uuid,uuid,bigint,jsonb,uuid,jsonb,jsonb
) from public, anon, authenticated, service_role;
grant execute on function public.save_market_draft_from_radar_intelligence(
  uuid,uuid,bigint,jsonb,uuid,jsonb,jsonb
) to authenticated;

comment on function public.save_market_draft_from_radar_intelligence_without_revision_guard(
  uuid,uuid,bigint,jsonb,uuid,jsonb,jsonb
) is
  'Capa interna estable del guardado Radar + Editor. Valida ejecución, contrato y fuentes y llama directamente al writer pre-gate preservado. No es invocable por roles API.';
comment on function public.save_market_draft_from_radar(uuid,uuid,bigint,jsonb) is
  'Guarda o reproduce idempotentemente un borrador Radar con elegibilidad vigente. Nunca confirma, publica ni modifica economía.';
comment on function public.save_market_draft_from_radar_intelligence(
  uuid,uuid,bigint,jsonb,uuid,jsonb,jsonb
) is
  'Guarda o reproduce idempotentemente un borrador Radar y su binding experto bajo elegibilidad vigente. Nunca confirma ni publica.';

do $postflight$
declare
  internal_writer regprocedure := to_regprocedure(
    'public.save_market_draft_from_radar_intelligence_without_revision_guard(uuid,uuid,bigint,jsonb,uuid,jsonb,jsonb)'
  );
  radar_writer regprocedure := to_regprocedure(
    'public.save_market_draft_from_radar(uuid,uuid,bigint,jsonb)'
  );
  expert_writer regprocedure := to_regprocedure(
    'public.save_market_draft_from_radar_intelligence(uuid,uuid,bigint,jsonb,uuid,jsonb,jsonb)'
  );
  internal_definition text;
  radar_definition text;
  expert_definition text;
begin
  select pg_get_functiondef(internal_writer) into internal_definition;
  select pg_get_functiondef(radar_writer) into radar_definition;
  select pg_get_functiondef(expert_writer) into expert_definition;

  if position(
       'public.save_market_draft_from_radar_without_authoritative_fact_gate_v1('
       in internal_definition
     ) = 0
     or position('public.save_market_draft_from_radar(' in internal_definition) > 0
     or position('prepared_replay :=' in radar_definition) = 0
     or position('prepared_replay :=' in expert_definition) = 0
     or position(
       'public.save_market_draft_from_radar_intelligence_without_authoritative_fact_gate_v1('
       in expert_definition
     ) = 0 then
    raise exception 'RADAR_EXPERT_SAVE_WRAPPER_POSTFLIGHT_FAILED'
      using errcode = '55000';
  end if;

  if exists (
    select 1
    from pg_proc procedure
    join pg_roles owner on owner.oid = procedure.proowner
    where procedure.oid in (
      internal_writer::oid,
      radar_writer::oid,
      expert_writer::oid
    )
      and (
        owner.rolname is distinct from 'postgres'
        or not procedure.prosecdef
        or not (procedure.proconfig @> array['search_path=""']::text[])
      )
  )
     or has_function_privilege(
       'anon',
       'public.save_market_draft_from_radar(uuid,uuid,bigint,jsonb)',
       'EXECUTE'
     )
     or not has_function_privilege(
       'authenticated',
       'public.save_market_draft_from_radar(uuid,uuid,bigint,jsonb)',
       'EXECUTE'
     )
     or has_function_privilege(
       'service_role',
       'public.save_market_draft_from_radar(uuid,uuid,bigint,jsonb)',
       'EXECUTE'
     )
     or has_function_privilege(
       'anon',
       'public.save_market_draft_from_radar_intelligence(uuid,uuid,bigint,jsonb,uuid,jsonb,jsonb)',
       'EXECUTE'
     )
     or not has_function_privilege(
       'authenticated',
       'public.save_market_draft_from_radar_intelligence(uuid,uuid,bigint,jsonb,uuid,jsonb,jsonb)',
       'EXECUTE'
     )
     or has_function_privilege(
       'service_role',
       'public.save_market_draft_from_radar_intelligence(uuid,uuid,bigint,jsonb,uuid,jsonb,jsonb)',
       'EXECUTE'
     )
     or has_function_privilege('anon', internal_writer, 'EXECUTE')
     or has_function_privilege('authenticated', internal_writer, 'EXECUTE')
     or has_function_privilege('service_role', internal_writer, 'EXECUTE') then
    raise exception 'RADAR_EXPERT_SAVE_WRAPPER_SECURITY_POSTFLIGHT_FAILED'
      using errcode = '55000';
  end if;
end;
$postflight$;

commit;
