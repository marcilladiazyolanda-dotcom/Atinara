begin;

do $preflight$
begin
  if to_regprocedure(
       'public.materialize_market_draft_for_repair_v1(uuid,bigint,uuid,jsonb)'
     ) is null
     or to_regprocedure(
       'public.save_market_draft_from_expert_with_issues_v2(uuid,uuid,jsonb)'
     ) is null then
    raise exception 'MARKET_EXPERT_EDITOR_BRIDGE_DEPENDENCY_MISSING';
  end if;
end;
$preflight$;

create or replace function public.materialize_market_draft_for_repair_v1(
  candidate_id_input uuid,
  expected_preparation_revision_input bigint,
  expert_run_id_input uuid,
  draft_input jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  candidate_row private.external_market_candidates%rowtype;
  run_row private.market_expert_runs%rowtype;
  run_revision bigint;
  result_value jsonb;
begin
  perform private.require_current_admin();
  if candidate_id_input is null
     or expected_preparation_revision_input is null
     or expert_run_id_input is null
     or jsonb_typeof(coalesce(draft_input,'null'::jsonb))<>'object'
     or coalesce(draft_input ->> '_radar_preparation_revision','')
       <>expected_preparation_revision_input::text
     or coalesce(draft_input ->> '_idempotency_key','')
       !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    raise exception 'RADAR_REPAIR_DRAFT_INPUT_REQUIRED' using errcode='22023';
  end if;

  select * into candidate_row
  from private.external_market_candidates candidate_alias
  where candidate_alias.id=candidate_id_input
  for update;
  if not found then
    raise exception 'RADAR_CANDIDATE_NOT_FOUND' using errcode='P0001';
  end if;

  select * into run_row
  from private.market_expert_runs run_alias
  where run_alias.id=expert_run_id_input
    and run_alias.origin_type='radar_candidate'
    and run_alias.origin_id=candidate_id_input::text
    and run_alias.status='completed'
  for share;
  if not found then
    raise exception 'MARKET_EXPERT_ANALYSIS_REQUIRED' using errcode='22023';
  end if;

  begin
    run_revision:=nullif(
      run_row.result_json ->> 'origin_preparation_revision',''
    )::bigint;
  exception when invalid_text_representation or numeric_value_out_of_range then
    run_revision:=null;
  end;
  if run_revision is distinct from expected_preparation_revision_input
     or candidate_row.preparation_revision
       is distinct from expected_preparation_revision_input
     or run_row.policy_version<>'atinara-market-constitution-v1'
     or run_row.schema_version<>'atinara-market-expert-v1'
     or run_row.result_json ->> 'origin_analysis_fingerprint'
       is distinct from run_row.origin_fingerprint
     or run_row.result_json ->> 'origin_source_fingerprint'
       is distinct from candidate_row.fingerprint then
    raise exception 'RADAR_PREPARATION_REVISION_MISMATCH' using errcode='40001';
  end if;
  if jsonb_typeof(run_row.result_json -> 'draft_gate')<>'object'
     or run_row.result_json #>> '{draft_gate,status}'
       <>'proposal_ready_with_issues'
     or coalesce((run_row.result_json #>>
       '{draft_gate,can_materialize_private_repair_draft}')::boolean,false)
       is not true
     or coalesce((run_row.result_json #>>
       '{draft_gate,can_save_private_draft}')::boolean,false)
       is not true then
    raise exception 'MARKET_EXPERT_REPAIR_DRAFT_BLOCKED' using errcode='22023';
  end if;

  -- Compatibilidad V1: la única escritura autoritativa es el writer V2, que
  -- conserva familia, issue ledger, huellas, locks e idempotencia vigentes.
  result_value:=public.save_market_draft_from_expert_with_issues_v2(
    candidate_id_input,expert_run_id_input,draft_input
  );
  return result_value||jsonb_build_object(
    'materialization_mode','private_repair_v1',
    'writer_contract_version','save_market_draft_from_expert_with_issues_v2',
    'expert_run_id',expert_run_id_input,
    'draft_private',true,
    'requires_repair',true,
    'published',false,
    'confirmed',false,
    'resolved',false
  );
end;
$function$;

alter function public.materialize_market_draft_for_repair_v1(
  uuid,bigint,uuid,jsonb
) owner to postgres;
revoke all on function public.materialize_market_draft_for_repair_v1(
  uuid,bigint,uuid,jsonb
) from public,anon,authenticated,service_role;
grant execute on function public.materialize_market_draft_for_repair_v1(
  uuid,bigint,uuid,jsonb
) to authenticated;

comment on function public.materialize_market_draft_for_repair_v1(
  uuid,bigint,uuid,jsonb
) is
  'Alias compatible V1 del writer de incidencias V2; conserva contratos actuales de revisión, familia, issue ledger e idempotencia y nunca confirma ni publica.';

commit;
