-- Agent Engine v2 registry/run/step consistency regression. All writes roll back.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

select private.assert_market_agent_registry_consistency_v2();

do $catalog$
declare
  relation_name text;
  privilege_name text;
begin
  if to_regclass('private.market_agent_runs') is null
     or to_regclass('private.market_agent_steps') is null
     or to_regclass('private.market_issue_registry') is null
     or to_regclass('private.market_repair_strategy_registry') is null
     or to_regclass('private.market_issue_strategy_bindings') is null then
    raise exception 'TEST_AGENT_ENGINE_V2_TABLE_MISSING';
  end if;
  if not exists (
    select 1 from pg_indexes where schemaname = 'private'
      and indexname = 'market_agent_steps_one_writer_per_round'
  ) then
    raise exception 'TEST_AGENT_ENGINE_V2_WRITER_INDEX_MISSING';
  end if;
  foreach relation_name in array array['market_agent_runs', 'market_agent_steps'] loop
    foreach privilege_name in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE'] loop
      if has_table_privilege('service_role', format('private.%I', relation_name), privilege_name) then
        raise exception 'TEST_AGENT_ENGINE_V2_DIRECT_ACL_PRESENT:%:%', relation_name, privilege_name;
      end if;
    end loop;
  end loop;
end;
$catalog$;

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;

do $service_paths$
declare
  registry jsonb := public.get_market_agent_registry_v2();
  invocation_value text := 'agent-sql-v21-' || txid_current()::text;
  run_result jsonb;
  run_id_value uuid;
begin
  if registry ->> 'version' <> 'atinara-agent-registry-v2.1.0'
     or (registry ->> 'hash') !~ '^[0-9a-f]{64}$' then
    raise exception 'TEST_AGENT_ENGINE_V2_REGISTRY_IDENTITY_INVALID';
  end if;
  run_result := public.record_market_agent_run_v2(jsonb_build_object(
    'invocation_id', invocation_value,
    'agent_type', 'market_corrector_agent',
    'outcome', 'completed',
    'registry_version', registry ->> 'version',
    'registry_hash', registry ->> 'hash',
    'snapshot_fingerprint', repeat('c', 64),
    'step_count', 3,
    'replan_count', 0,
    'started_at', clock_timestamp() - interval '1 second',
    'completed_at', clock_timestamp()
  ));
  run_id_value := (run_result ->> 'run_id')::uuid;

  perform public.record_market_agent_step_v2(jsonb_build_object(
    'run_id', run_id_value, 'registry_version', registry ->> 'version',
    'registry_hash', registry ->> 'hash', 'sequence', 1, 'round_no', 1,
    'tool_name', 'load_authoritative_draft', 'is_writer', false,
    'status', 'completed', 'progress_fingerprint', repeat('d', 64),
    'summary', '{"loaded":true}'::jsonb, 'duration_ms', 1
  ));
  perform public.record_market_agent_step_v2(jsonb_build_object(
    'run_id', run_id_value, 'registry_version', registry ->> 'version',
    'registry_hash', registry ->> 'hash', 'sequence', 2, 'round_no', 1,
    'tool_name', 'persist_single_version', 'strategy_key', 'derive_edge_cases',
    'is_writer', true, 'status', 'completed', 'progress_fingerprint', repeat('e', 64),
    'summary', '{"written":true}'::jsonb, 'duration_ms', 2
  ));

  begin
    perform public.record_market_agent_step_v2(jsonb_build_object(
      'run_id', run_id_value, 'registry_version', registry ->> 'version',
      'registry_hash', registry ->> 'hash', 'sequence', 3, 'round_no', 1,
      'tool_name', 'persist_single_version', 'strategy_key', 'derive_edge_cases',
      'is_writer', true, 'status', 'completed', 'progress_fingerprint', repeat('f', 64),
      'summary', '{}'::jsonb, 'duration_ms', 2
    ));
    raise exception 'TEST_AGENT_ENGINE_V2_SECOND_WRITER_ALLOWED';
  exception when others then
    if sqlerrm not like '%AGENT_WRITE_BUDGET_EXHAUSTED%' then raise; end if;
  end;

  begin
    perform public.record_market_agent_step_v2(jsonb_build_object(
      'run_id', run_id_value, 'registry_version', registry ->> 'version',
      'registry_hash', registry ->> 'hash', 'sequence', 4, 'round_no', 2,
      'tool_name', 'persist_single_version', 'strategy_key', 'research_registered_primary',
      'is_writer', true, 'status', 'failed', 'progress_fingerprint', repeat('0', 64),
      'summary', '{}'::jsonb, 'duration_ms', 1
    ));
    raise exception 'TEST_AGENT_ENGINE_V2_NON_WRITER_STRATEGY_ALLOWED';
  exception when others then
    if sqlerrm not like '%AGENT_STRATEGY_WRITE_FORBIDDEN%' then raise; end if;
  end;
end;
$service_paths$;

reset role;

do $append_only$
begin
  begin
    update private.market_agent_runs set stop_reason = 'mutated';
    raise exception 'TEST_AGENT_ENGINE_V2_RUN_UPDATE_ALLOWED';
  exception when sqlstate '55000' then null;
  end;
  begin
    update private.market_agent_steps set summary = '{}'::jsonb;
    raise exception 'TEST_AGENT_ENGINE_V2_STEP_UPDATE_ALLOWED';
  exception when sqlstate '55000' then null;
  end;
end;
$append_only$;

rollback;
