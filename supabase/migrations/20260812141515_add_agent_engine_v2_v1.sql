-- Agent Engine v2.1: registros separados, runs/steps append-only y escritor único.
-- Migración aditiva: la tabla combinada v1 permanece intacta para rollback.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';

select pg_advisory_xact_lock(hashtextextended('atinara:agent-engine-v2.1', 0));

create table private.market_issue_registry (
  code text primary key check (code ~ '^[A-Z][A-Z0-9_]{2,99}$'),
  phase text not null check (phase in ('radar', 'editor', 'validator', 'corrector', 'publication')),
  severity text not null check (severity in ('info', 'warning', 'blocking')),
  repairable boolean not null,
  policy_version text not null,
  schema_version text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table private.market_repair_strategy_registry (
  strategy_key text primary key check (strategy_key ~ '^[a-z][a-z0-9_]{2,99}$'),
  handler_key text not null check (handler_key ~ '^[a-z][a-z0-9_]{2,99}$'),
  can_write boolean not null default false,
  affected_fields jsonb not null default '[]'::jsonb check (jsonb_typeof(affected_fields) = 'array'),
  write_fields jsonb not null default '[]'::jsonb check (jsonb_typeof(write_fields) = 'array'),
  invariants jsonb not null default '[]'::jsonb check (jsonb_typeof(invariants) = 'array'),
  registry_version text not null default 'atinara-agent-registry-v2.1.0',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint market_repair_strategy_handler_unique unique (handler_key)
);

create table private.market_issue_strategy_bindings (
  issue_code text not null references private.market_issue_registry(code) on delete restrict,
  strategy_key text not null references private.market_repair_strategy_registry(strategy_key) on delete restrict,
  priority smallint not null default 100 check (priority between 1 and 1000),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (issue_code, strategy_key)
);

insert into private.market_issue_registry (
  code, phase, severity, repairable, policy_version, schema_version, active
)
select
  code,
  phase,
  severity,
  disposition in ('auto_repair', 'auto_recover'),
  policy_version,
  schema_version,
  active
from private.market_issue_strategy_registry
on conflict (code) do nothing;

insert into private.market_repair_strategy_registry (
  strategy_key, handler_key, can_write, affected_fields, write_fields, invariants, active
)
select
  source.strategy_key,
  source.strategy_key,
  source.strategy_key = any (array[
    'derive_edge_cases', 'derive_evaluation_period', 'derive_or_escalate_temporal_contract',
    'derive_public_criteria', 'derive_resolution_deadline', 'infer_canonical_subject',
    'infer_category', 'infer_metric_contract', 'infer_or_escalate_subject',
    'normalize_binary_options', 'normalize_iana_timezone', 'rebuild_binary_question',
    'rebuild_or_escalate_contract', 'rebuild_or_escalate_criteria',
    'rebuild_resolution_criteria', 'synchronize_temporal_fields'
  ]::text[]),
  coalesce((
    select jsonb_agg(distinct field.value order by field.value)
    from private.market_issue_strategy_registry grouped
    cross join lateral jsonb_array_elements_text(grouped.affected_fields) field(value)
    where grouped.strategy_key = source.strategy_key
  ), '[]'::jsonb),
  coalesce((
    select jsonb_agg(distinct field.value order by field.value)
    from private.market_issue_strategy_registry grouped
    cross join lateral jsonb_array_elements_text(grouped.affected_fields) field(value)
    where grouped.strategy_key = source.strategy_key
      and field.value = any (array[
        'market_slug', 'question', 'subject', 'category', 'yes_option', 'no_option',
        'evaluation_period_label', 'evaluation_ends_at', 'closes_at', 'timezone',
        'resolution_deadline', 'yes_criteria', 'no_criteria', 'edge_cases',
        'public_criteria', 'description', 'delay_treatment', 'cancellation_treatment',
        'leak_treatment', 'rename_treatment', 'assumptions', 'primary_source',
        'alternative_sources'
      ]::text[])
  ), '[]'::jsonb),
  coalesce((
    select jsonb_agg(distinct invariant.value order by invariant.value)
    from private.market_issue_strategy_registry grouped
    cross join lateral jsonb_array_elements_text(grouped.invariants) invariant(value)
    where grouped.strategy_key = source.strategy_key
  ), '[]'::jsonb),
  bool_or(source.active)
from private.market_issue_strategy_registry source
group by source.strategy_key
on conflict (strategy_key) do nothing;

insert into private.market_issue_strategy_bindings (issue_code, strategy_key, priority, active)
select code, strategy_key, 100, active
from private.market_issue_strategy_registry
on conflict (issue_code, strategy_key) do nothing;

create or replace function private.market_agent_registry_hash_v2()
returns text
language sql
stable
security definer
set search_path = ''
as $function$
  select encode(extensions.digest(convert_to(jsonb_build_object(
    'version', 'atinara-agent-registry-v2.1.0',
    'issues', coalesce((
      select jsonb_agg(to_jsonb(issue) - 'created_at' order by issue.code)
      from private.market_issue_registry issue where issue.active
    ), '[]'::jsonb),
    'strategies', coalesce((
      select jsonb_agg(to_jsonb(strategy) - 'created_at' order by strategy.strategy_key)
      from private.market_repair_strategy_registry strategy where strategy.active
    ), '[]'::jsonb),
    'bindings', coalesce((
      select jsonb_agg(to_jsonb(binding) - 'created_at' order by binding.issue_code, binding.priority, binding.strategy_key)
      from private.market_issue_strategy_bindings binding where binding.active
    ), '[]'::jsonb)
  )::text, 'UTF8'), 'sha256'), 'hex');
$function$;

revoke all on function private.market_agent_registry_hash_v2()
  from public, anon, authenticated, service_role;

create or replace function private.assert_market_agent_registry_consistency_v2()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  if exists (
    select 1 from private.market_repair_strategy_registry
    where active and handler_key <> strategy_key
  ) then
    raise exception 'AGENT_STRATEGY_HANDLER_MISMATCH';
  end if;
  if exists (
    select 1
    from private.market_issue_registry issue
    where issue.active and issue.repairable
      and not exists (
        select 1 from private.market_issue_strategy_bindings binding
        join private.market_repair_strategy_registry strategy using (strategy_key)
        where binding.issue_code = issue.code and binding.active and strategy.active
      )
  ) then
    raise exception 'AGENT_REPAIRABLE_ISSUE_UNBOUND';
  end if;
  if exists (
    select 1
    from private.market_issue_strategy_bindings binding
    left join private.market_issue_registry issue on issue.code = binding.issue_code and issue.active
    left join private.market_repair_strategy_registry strategy on strategy.strategy_key = binding.strategy_key and strategy.active
    where binding.active and (issue.code is null or strategy.strategy_key is null)
  ) then
    raise exception 'AGENT_REGISTRY_BINDING_INVALID';
  end if;
  if exists (
    select 1
    from private.market_repair_strategy_registry strategy
    cross join lateral jsonb_array_elements_text(strategy.write_fields) field(value)
    where strategy.active and strategy.can_write and field.value <> all (array[
      'market_slug', 'question', 'subject', 'category', 'yes_option', 'no_option',
      'evaluation_period_label', 'evaluation_ends_at', 'closes_at', 'timezone',
      'resolution_deadline', 'yes_criteria', 'no_criteria', 'edge_cases',
      'public_criteria', 'description', 'delay_treatment', 'cancellation_treatment',
      'leak_treatment', 'rename_treatment', 'assumptions', 'primary_source',
      'alternative_sources'
    ]::text[])
  ) then
    raise exception 'AGENT_STRATEGY_FIELD_NOT_ALLOWED';
  end if;
end;
$function$;

select private.assert_market_agent_registry_consistency_v2();

create table private.market_agent_runs (
  id uuid primary key default gen_random_uuid(),
  invocation_id text not null unique check (length(invocation_id) between 8 and 120),
  agent_type text not null check (agent_type in ('radar_source_agent', 'market_editor_agent', 'market_corrector_agent')),
  outcome text not null check (outcome in (
    'completed', 'degraded', 'needs_human_review', 'technical_hold',
    'stale_snapshot', 'no_progress', 'budget_exhausted', 'failed'
  )),
  registry_version text not null check (registry_version = 'atinara-agent-registry-v2.1.0'),
  registry_hash text not null check (registry_hash ~ '^[0-9a-f]{64}$'),
  snapshot_fingerprint text check (snapshot_fingerprint is null or snapshot_fingerprint ~ '^[0-9a-f]{64}$'),
  step_count integer not null default 0 check (step_count between 0 and 40),
  replan_count smallint not null default 0 check (replan_count between 0 and 2),
  stop_reason text,
  started_at timestamptz not null,
  completed_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint market_agent_run_time_check check (completed_at >= started_at)
);

create table private.market_agent_steps (
  id bigint generated by default as identity primary key,
  run_id uuid not null references private.market_agent_runs(id) on delete restrict,
  sequence integer not null check (sequence between 1 and 40),
  round_no smallint not null check (round_no between 1 and 20),
  tool_name text not null check (tool_name ~ '^[a-z][a-z0-9_]{2,99}$'),
  strategy_key text references private.market_repair_strategy_registry(strategy_key) on delete restrict,
  is_writer boolean not null default false,
  status text not null check (status in ('completed', 'degraded', 'failed', 'no_op')),
  progress_fingerprint text check (progress_fingerprint is null or progress_fingerprint ~ '^[0-9a-f]{64}$'),
  summary jsonb not null default '{}'::jsonb check (jsonb_typeof(summary) = 'object' and pg_column_size(summary) <= 8192),
  duration_ms integer not null default 0 check (duration_ms between 0 and 600000),
  created_at timestamptz not null default now(),
  constraint market_agent_steps_run_sequence_unique unique (run_id, sequence)
);

create unique index market_agent_steps_one_writer_per_round
  on private.market_agent_steps(run_id, round_no) where is_writer;
create index market_agent_runs_created_idx on private.market_agent_runs(created_at);
create index market_agent_steps_run_idx on private.market_agent_steps(run_id, sequence);

alter table private.market_issue_registry enable row level security;
alter table private.market_issue_registry force row level security;
alter table private.market_repair_strategy_registry enable row level security;
alter table private.market_repair_strategy_registry force row level security;
alter table private.market_issue_strategy_bindings enable row level security;
alter table private.market_issue_strategy_bindings force row level security;
alter table private.market_agent_runs enable row level security;
alter table private.market_agent_runs force row level security;
alter table private.market_agent_steps enable row level security;
alter table private.market_agent_steps force row level security;

revoke all on table private.market_issue_registry from public, anon, authenticated, service_role;
revoke all on table private.market_repair_strategy_registry from public, anon, authenticated, service_role;
revoke all on table private.market_issue_strategy_bindings from public, anon, authenticated, service_role;
revoke all on table private.market_agent_runs from public, anon, authenticated, service_role;
revoke all on table private.market_agent_steps from public, anon, authenticated, service_role;
revoke all on sequence private.market_agent_steps_id_seq from public, anon, authenticated, service_role;

create trigger reject_market_issue_registry_update_v2
before update on private.market_issue_registry
for each row execute function private.reject_ai_append_only_update_v1();
create trigger reject_market_repair_strategy_registry_update_v2
before update on private.market_repair_strategy_registry
for each row execute function private.reject_ai_append_only_update_v1();
create trigger reject_market_issue_strategy_binding_update_v2
before update on private.market_issue_strategy_bindings
for each row execute function private.reject_ai_append_only_update_v1();
create trigger reject_market_agent_run_update_v2
before update on private.market_agent_runs
for each row execute function private.reject_ai_append_only_update_v1();
create trigger reject_market_agent_step_update_v2
before update on private.market_agent_steps
for each row execute function private.reject_ai_append_only_update_v1();

create or replace function public.get_market_agent_registry_v2()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  if private.market_request_role_v1() is distinct from 'service_role' then
    perform private.require_current_admin();
  end if;
  perform private.assert_market_agent_registry_consistency_v2();
  return jsonb_build_object(
    'version', 'atinara-agent-registry-v2.1.0',
    'hash', private.market_agent_registry_hash_v2(),
    'issues', coalesce((select jsonb_agg(to_jsonb(issue) - 'created_at' order by issue.code) from private.market_issue_registry issue where issue.active), '[]'::jsonb),
    'strategies', coalesce((select jsonb_agg(to_jsonb(strategy) - 'created_at' order by strategy.strategy_key) from private.market_repair_strategy_registry strategy where strategy.active), '[]'::jsonb),
    'bindings', coalesce((select jsonb_agg(to_jsonb(binding) - 'created_at' order by binding.issue_code, binding.priority, binding.strategy_key) from private.market_issue_strategy_bindings binding where binding.active), '[]'::jsonb)
  );
end;
$function$;

revoke all on function public.get_market_agent_registry_v2()
  from public, anon, authenticated, service_role;
grant execute on function public.get_market_agent_registry_v2()
  to authenticated, service_role;

create or replace function public.record_market_agent_run_v2(payload_input jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  existing private.market_agent_runs%rowtype;
  inserted private.market_agent_runs%rowtype;
  current_hash text;
begin
  if private.market_request_role_v1() is distinct from 'service_role' then
    raise exception 'SERVICE_ROLE_REQUIRED' using errcode = '42501';
  end if;
  perform private.assert_market_agent_registry_consistency_v2();
  current_hash := private.market_agent_registry_hash_v2();
  if payload_input ->> 'registry_version' is distinct from 'atinara-agent-registry-v2.1.0'
    or lower(payload_input ->> 'registry_hash') is distinct from current_hash then
    raise exception 'AGENT_REGISTRY_IDENTITY_MISMATCH';
  end if;
  select * into existing from private.market_agent_runs
  where invocation_id = payload_input ->> 'invocation_id';
  if found then
    if existing.registry_hash <> current_hash
      or existing.agent_type <> payload_input ->> 'agent_type'
      or existing.outcome <> payload_input ->> 'outcome' then
      raise exception 'AGENT_RUN_IDEMPOTENCY_CONFLICT';
    end if;
    return jsonb_build_object('run_id', existing.id, 'idempotent', true);
  end if;
  insert into private.market_agent_runs (
    invocation_id, agent_type, outcome, registry_version, registry_hash,
    snapshot_fingerprint, step_count, replan_count, stop_reason, started_at, completed_at
  ) values (
    left(payload_input ->> 'invocation_id', 120),
    payload_input ->> 'agent_type', payload_input ->> 'outcome',
    payload_input ->> 'registry_version', lower(payload_input ->> 'registry_hash'),
    nullif(lower(payload_input ->> 'snapshot_fingerprint'), ''),
    coalesce((payload_input ->> 'step_count')::integer, 0),
    coalesce((payload_input ->> 'replan_count')::smallint, 0),
    nullif(left(payload_input ->> 'stop_reason', 120), ''),
    (payload_input ->> 'started_at')::timestamptz,
    (payload_input ->> 'completed_at')::timestamptz
  ) returning * into inserted;
  return jsonb_build_object('run_id', inserted.id, 'idempotent', false);
end;
$function$;

revoke all on function public.record_market_agent_run_v2(jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.record_market_agent_run_v2(jsonb) to service_role;

create or replace function public.record_market_agent_step_v2(payload_input jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  run_value private.market_agent_runs%rowtype;
  existing private.market_agent_steps%rowtype;
  inserted_id bigint;
  writer_value boolean := coalesce((payload_input ->> 'is_writer')::boolean, false);
  strategy_value private.market_repair_strategy_registry%rowtype;
begin
  if private.market_request_role_v1() is distinct from 'service_role' then
    raise exception 'SERVICE_ROLE_REQUIRED' using errcode = '42501';
  end if;
  select * into run_value from private.market_agent_runs where id = (payload_input ->> 'run_id')::uuid;
  if not found then raise exception 'AGENT_RUN_NOT_FOUND'; end if;
  if run_value.registry_version is distinct from payload_input ->> 'registry_version'
    or run_value.registry_hash is distinct from lower(payload_input ->> 'registry_hash')
    or run_value.registry_hash is distinct from private.market_agent_registry_hash_v2() then
    raise exception 'AGENT_REGISTRY_IDENTITY_MISMATCH';
  end if;
  if writer_value then
    select * into strategy_value from private.market_repair_strategy_registry
    where strategy_key = payload_input ->> 'strategy_key' and active;
    if not found or not strategy_value.can_write then
      raise exception 'AGENT_STRATEGY_WRITE_FORBIDDEN';
    end if;
    if payload_input ->> 'tool_name' <> 'persist_single_version' then
      raise exception 'AGENT_WRITER_TOOL_INVALID';
    end if;
  end if;
  select * into existing from private.market_agent_steps
  where run_id = run_value.id and sequence = (payload_input ->> 'sequence')::integer;
  if found then
    if existing.tool_name <> payload_input ->> 'tool_name'
      or coalesce(existing.progress_fingerprint, '') <> coalesce(lower(payload_input ->> 'progress_fingerprint'), '') then
      raise exception 'AGENT_STEP_IDEMPOTENCY_CONFLICT';
    end if;
    return jsonb_build_object('step_id', existing.id, 'idempotent', true);
  end if;
  insert into private.market_agent_steps (
    run_id, sequence, round_no, tool_name, strategy_key, is_writer,
    status, progress_fingerprint, summary, duration_ms
  ) values (
    run_value.id,
    (payload_input ->> 'sequence')::integer,
    (payload_input ->> 'round_no')::smallint,
    payload_input ->> 'tool_name',
    nullif(payload_input ->> 'strategy_key', ''),
    writer_value,
    payload_input ->> 'status',
    nullif(lower(payload_input ->> 'progress_fingerprint'), ''),
    coalesce(payload_input -> 'summary', '{}'::jsonb),
    coalesce((payload_input ->> 'duration_ms')::integer, 0)
  ) returning id into inserted_id;
  return jsonb_build_object('step_id', inserted_id, 'idempotent', false);
exception
  when unique_violation then
    if writer_value then raise exception 'AGENT_WRITE_BUDGET_EXHAUSTED'; end if;
    raise;
end;
$function$;

revoke all on function public.record_market_agent_step_v2(jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.record_market_agent_step_v2(jsonb) to service_role;

create or replace function private.purge_ai_operational_telemetry_private_v1()
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  detailed_cutoff_value timestamptz := clock_timestamp() - interval '90 days';
  operational_cutoff_value timestamptz := clock_timestamp() - interval '180 days';
  invocation_count bigint := 0;
  step_count bigint := 0;
  run_count bigint := 0;
begin
  delete from private.ai_invocation_attempts where created_at < detailed_cutoff_value;
  get diagnostics invocation_count = row_count;
  delete from private.market_agent_steps step
  using private.market_agent_runs run
  where step.run_id = run.id and run.created_at < operational_cutoff_value;
  get diagnostics step_count = row_count;
  delete from private.market_agent_runs where created_at < operational_cutoff_value;
  get diagnostics run_count = row_count;
  insert into private.ai_retention_audit (
    detailed_cutoff, operational_cutoff, invocation_rows_deleted,
    run_rows_deleted, step_rows_deleted
  ) values (
    detailed_cutoff_value, operational_cutoff_value, invocation_count,
    run_count, step_count
  );
  return jsonb_build_object(
    'detailed_cutoff', detailed_cutoff_value,
    'operational_cutoff', operational_cutoff_value,
    'invocation_rows_deleted', invocation_count,
    'run_rows_deleted', run_count,
    'step_rows_deleted', step_count
  );
end;
$function$;

revoke all on function private.purge_ai_operational_telemetry_private_v1()
  from public, anon, authenticated, service_role;

comment on table private.market_issue_registry is 'Issue Registry v2 proyectado de v1 sin eliminar la fuente de rollback.';
comment on table private.market_repair_strategy_registry is 'Strategy Registry v2; handlers y can_write se validan contra código antes de ejecutar.';
comment on table private.market_agent_runs is 'Runs operativos append-only, sin prompts ni payloads, retenidos 180 días.';
comment on table private.market_agent_steps is 'Pasos operativos append-only con un único writer por run y ronda.';

commit;
