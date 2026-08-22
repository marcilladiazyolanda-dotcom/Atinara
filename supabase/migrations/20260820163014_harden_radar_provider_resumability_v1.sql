-- Radar refresh persistence v2: durable intents, resumable batches and an
-- exclusive provider circuit probe. This migration is additive; the v1 RPCs
-- remain available for bundle rollback and no domain row is backfilled.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';

select pg_advisory_xact_lock(hashtextextended('atinara:radar-provider-resumability-v1', 0));

do $preflight$
begin
  if to_regclass('private.external_market_candidates') is null
     or to_regclass('private.market_radar_eligibility_checks') is null
     or to_regclass('private.market_radar_provider_runs') is null
     or to_regclass('private.market_radar_provider_run_history') is null
     or to_regclass('private.market_radar_candidate_quarantines') is null
     or to_regprocedure(
       'public.upsert_market_radar_batch_with_eligibility_v1(text,text,text,jsonb,jsonb,text,jsonb)'
     ) is null
     or to_regprocedure(
       'public.finalize_market_radar_provider_refresh_v2(text,text,text,integer,integer,integer,integer,integer,text,text,integer)'
     ) is null then
    raise exception 'RADAR_REFRESH_V2_PREFLIGHT_FAILED' using errcode = '55000';
  end if;
end;
$preflight$;

-- The deployed eligibility v1 writer used this legacy stage name while the
-- original quarantine constraint only admitted authoritative_persistence.
-- Preserve both for rollback; v2 writes the canonical authoritative value.
alter table private.market_radar_candidate_quarantines
  drop constraint if exists market_radar_candidate_quarantines_stage_check;
alter table private.market_radar_candidate_quarantines
  add constraint market_radar_candidate_quarantines_stage_check
  check (stage in ('authoritative_persistence', 'eligibility_persistence'));

alter table private.market_radar_candidate_quarantines
  add column if not exists refresh_request_id uuid,
  add column if not exists refresh_batch_id uuid,
  add column if not exists refresh_item_ordinal integer;

create unique index if not exists market_radar_quarantine_refresh_item_uidx
  on private.market_radar_candidate_quarantines(
    refresh_request_id, provider, refresh_batch_id, refresh_item_ordinal
  )
  where refresh_request_id is not null;

create table private.market_radar_provider_circuits_v1 (
  provider text not null check (provider in ('polymarket', 'kalshi', 'tavily')),
  capability text not null check (capability in ('candidate_feed', 'source_enrichment')),
  state text not null default 'closed' check (state in ('closed', 'open', 'half_open')),
  consecutive_failures integer not null default 0 check (consecutive_failures between 0 and 1000),
  next_probe_at timestamptz,
  probe_request_id uuid,
  probe_lease_token uuid,
  probe_lease_expires_at timestamptz,
  last_success_at timestamptz,
  last_success_count integer not null default 0 check (last_success_count between 0 and 240),
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  primary key (provider, capability),
  constraint market_radar_provider_circuit_probe_check check (
    (state = 'half_open'
      and probe_request_id is not null
      and probe_lease_token is not null
      and probe_lease_expires_at is not null)
    or (state <> 'half_open'
      and probe_request_id is null
      and probe_lease_token is null
      and probe_lease_expires_at is null)
  )
);

create table private.market_radar_refresh_intents_v1 (
  request_id uuid not null,
  provider text not null check (provider in ('polymarket', 'kalshi', 'tavily')),
  capability text not null check (capability in ('candidate_feed', 'source_enrichment')),
  actor_id uuid not null,
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  cache_key text not null check (char_length(cache_key) between 1 and 180),
  normalizer_version text not null check (char_length(normalizer_version) between 1 and 100),
  policy_version text not null check (char_length(policy_version) between 1 and 100),
  status text not null default 'in_progress' check (
    status in ('in_progress', 'completed', 'partial', 'technical_failed', 'interrupted')
  ),
  phase text not null default 'claimed' check (
    phase in ('claimed', 'fetching', 'staged', 'persisting', 'finalizing', 'terminal')
  ),
  lease_token uuid,
  lease_owner uuid,
  lease_expires_at timestamptz,
  claim_count integer not null default 1 check (claim_count between 1 and 1000),
  expected_count integer check (expected_count is null or expected_count between 0 and 240),
  staged_count integer not null default 0 check (staged_count between 0 and 240),
  processed_count integer not null default 0 check (processed_count between 0 and 240),
  accepted_count integer not null default 0 check (accepted_count between 0 and 240),
  quarantined_count integer not null default 0 check (quarantined_count between 0 and 240),
  failed_count integer not null default 0 check (failed_count between 0 and 240),
  manifest_hash text check (manifest_hash is null or manifest_hash ~ '^[0-9a-f]{64}$'),
  finalization_hash text check (finalization_hash is null or finalization_hash ~ '^[0-9a-f]{64}$'),
  provider_history_id bigint references private.market_radar_provider_run_history(id) on delete restrict,
  issue jsonb check (issue is null or jsonb_typeof(issue) = 'object'),
  response_summary jsonb check (response_summary is null or jsonb_typeof(response_summary) = 'object'),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  completed_at timestamptz,
  primary key (request_id, provider, capability),
  constraint market_radar_refresh_lease_check check (
    (status = 'in_progress'
      and lease_token is not null
      and lease_owner is not null
      and lease_expires_at is not null)
    or (status <> 'in_progress'
      and lease_token is null
      and lease_owner is null
      and lease_expires_at is null)
  ),
  constraint market_radar_refresh_terminal_check check (
    (status = 'in_progress' and phase <> 'terminal' and completed_at is null)
    or (status <> 'in_progress' and phase = 'terminal' and completed_at is not null)
  )
);

create unique index market_radar_refresh_active_provider_uidx
  on private.market_radar_refresh_intents_v1(provider, capability)
  where status = 'in_progress';
create index market_radar_refresh_lease_idx
  on private.market_radar_refresh_intents_v1(status, lease_expires_at);
create index market_radar_refresh_actor_time_idx
  on private.market_radar_refresh_intents_v1(actor_id, created_at desc);

create table private.market_radar_refresh_batches_v1 (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null,
  provider text not null,
  capability text not null,
  batch_ordinal integer not null check (batch_ordinal between 0 and 99),
  split_path text not null default '' check (split_path ~ '^[01]{0,12}$'),
  parent_batch_id uuid references private.market_radar_refresh_batches_v1(id) on delete restrict,
  generation smallint not null default 0 check (generation between 0 and 12),
  batch_hash text not null check (batch_hash ~ '^[0-9a-f]{64}$'),
  items jsonb not null check (
    jsonb_typeof(items) = 'array'
    and jsonb_array_length(items) between 1 and 24
    and octet_length(items::text) <= 1048576
  ),
  eligibility_attempt_ids jsonb not null check (
    jsonb_typeof(eligibility_attempt_ids) = 'array'
    and jsonb_array_length(eligibility_attempt_ids) = jsonb_array_length(items)
  ),
  status text not null default 'pending' check (
    status in ('pending', 'processing', 'completed', 'superseded', 'technical_failed')
  ),
  attempt_count integer not null default 0 check (attempt_count between 0 and 100),
  accepted_count integer not null default 0 check (accepted_count between 0 and 24),
  quarantined_count integer not null default 0 check (quarantined_count between 0 and 24),
  failed_count integer not null default 0 check (failed_count between 0 and 24),
  error_code text check (error_code is null or error_code ~ '^[A-Z][A-Z0-9_]{2,99}$'),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  completed_at timestamptz,
  foreign key (request_id, provider, capability)
    references private.market_radar_refresh_intents_v1(request_id, provider, capability)
    on delete restrict,
  unique (request_id, provider, capability, batch_ordinal, split_path),
  constraint market_radar_refresh_batch_parent_check check (
    (generation = 0 and parent_batch_id is null and split_path = '')
    or (generation > 0 and parent_batch_id is not null and split_path <> '')
  ),
  constraint market_radar_refresh_batch_terminal_check check (
    (status in ('completed', 'superseded') and completed_at is not null)
    or (status not in ('completed', 'superseded') and completed_at is null)
  )
);

create index market_radar_refresh_batch_pending_idx
  on private.market_radar_refresh_batches_v1(request_id, provider, capability, batch_ordinal, split_path)
  where status in ('pending', 'technical_failed');

create table private.market_radar_refresh_events_v1 (
  id bigint generated always as identity primary key,
  request_id uuid not null,
  provider text not null check (provider in ('polymarket', 'kalshi', 'tavily')),
  capability text not null check (capability in ('candidate_feed', 'source_enrichment')),
  event_code text not null check (event_code ~ '^[A-Z][A-Z0-9_]{2,99}$'),
  previous_phase text,
  next_phase text,
  accepted_count integer not null default 0 check (accepted_count between 0 and 240),
  quarantined_count integer not null default 0 check (quarantined_count between 0 and 240),
  failed_count integer not null default 0 check (failed_count between 0 and 240),
  error_code text check (error_code is null or error_code ~ '^[A-Z][A-Z0-9_]{2,99}$'),
  issue jsonb check (issue is null or jsonb_typeof(issue) = 'object'),
  event_fingerprint text not null check (event_fingerprint ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default clock_timestamp(),
  unique (event_fingerprint)
);

create index market_radar_refresh_events_request_idx
  on private.market_radar_refresh_events_v1(request_id, provider, capability, created_at);

alter table private.market_radar_provider_circuits_v1 enable row level security;
alter table private.market_radar_provider_circuits_v1 force row level security;
alter table private.market_radar_refresh_intents_v1 enable row level security;
alter table private.market_radar_refresh_intents_v1 force row level security;
alter table private.market_radar_refresh_batches_v1 enable row level security;
alter table private.market_radar_refresh_batches_v1 force row level security;
alter table private.market_radar_refresh_events_v1 enable row level security;
alter table private.market_radar_refresh_events_v1 force row level security;

revoke all on table private.market_radar_provider_circuits_v1
  from public, anon, authenticated, service_role;
revoke all on table private.market_radar_refresh_intents_v1
  from public, anon, authenticated, service_role;
revoke all on table private.market_radar_refresh_batches_v1
  from public, anon, authenticated, service_role;
revoke all on table private.market_radar_refresh_events_v1
  from public, anon, authenticated, service_role;
revoke all on sequence private.market_radar_refresh_events_v1_id_seq
  from public, anon, authenticated, service_role;

alter table private.market_radar_provider_runs enable row level security;
alter table private.market_radar_provider_runs force row level security;
revoke all on table private.market_radar_provider_runs
  from public, anon, authenticated, service_role;
revoke all on table private.market_radar_candidate_quarantines
  from public, anon, authenticated, service_role;
revoke all on sequence private.market_radar_candidate_quarantines_id_seq
  from public, anon, authenticated, service_role;

alter table private.market_radar_provider_run_history
  add column if not exists refresh_request_id uuid,
  add column if not exists capability text,
  add column if not exists finalization_hash text,
  add column if not exists failure_stage text;

alter table private.market_radar_provider_runs
  add column if not exists refresh_request_id uuid,
  add column if not exists capability text,
  add column if not exists finalization_hash text,
  add column if not exists failure_stage text;

create unique index if not exists market_radar_provider_history_refresh_uidx
  on private.market_radar_provider_run_history(refresh_request_id, provider, capability)
  where refresh_request_id is not null;

create or replace function private.assert_market_workflow_issue_v1(issue_input jsonb)
returns void
language plpgsql
immutable
security definer
set search_path = ''
as $function$
declare
  expected_keys text[] := array[
    'issue_id','issue_code','detected_by','owner_stage','severity','repairability',
    'blocking_scope','affected_fields','evidence_refs','current_value','proposed_value',
    'confidence','policy_version','schema_version','fingerprint','status','retryable',
    'next_action','created_at','updated_at','resolved_at','resolution_method'
  ];
begin
  if jsonb_typeof(issue_input) <> 'object'
     or (select array_agg(key order by key) from jsonb_object_keys(issue_input) key)
        is distinct from (select array_agg(key order by key) from unnest(expected_keys) key)
     or coalesce(issue_input ->> 'issue_id', '') !~
        '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     or coalesce(issue_input ->> 'issue_code', '') !~ '^[A-Z][A-Z0-9_]{2,99}$'
     or issue_input ->> 'detected_by' not in (
       'radar','editor','validator','corrector','human_review','publication_gate','provider','internal_platform'
     )
     or issue_input ->> 'owner_stage' not in (
       'radar','editor','validator','corrector','human_review','publication_gate','provider','internal_platform'
     )
     or issue_input ->> 'severity' not in ('info','warning','blocking')
     or issue_input ->> 'repairability' not in (
       'auto_recoverable','auto_repairable','human_editable',
       'waiting_authoritative_source','non_repairable','terminal'
     )
     or issue_input ->> 'blocking_scope' not in ('none','approval','human_confirmation','publication','terminal')
     or jsonb_typeof(issue_input -> 'affected_fields') <> 'array'
     or jsonb_array_length(issue_input -> 'affected_fields') > 32
     or jsonb_typeof(issue_input -> 'evidence_refs') <> 'array'
     or jsonb_array_length(issue_input -> 'evidence_refs') > 32
     or jsonb_typeof(issue_input -> 'confidence') <> 'number'
     or (issue_input ->> 'confidence')::numeric < 0
     or (issue_input ->> 'confidence')::numeric > 100
     or coalesce(issue_input ->> 'policy_version', '') = ''
     or coalesce(issue_input ->> 'schema_version', '') = ''
     or coalesce(issue_input ->> 'fingerprint', '') !~ '^[0-9a-f]{64}$'
     or issue_input ->> 'status' not in ('open','in_progress','waiting','resolved','superseded')
     or jsonb_typeof(issue_input -> 'retryable') <> 'boolean'
     or coalesce(issue_input ->> 'next_action', '') !~ '^[a-z][a-z0-9_]{2,99}$'
     or nullif(issue_input ->> 'created_at', '') is null
     or nullif(issue_input ->> 'updated_at', '') is null
     or (issue_input ->> 'blocking_scope' = 'terminal'
       and issue_input ->> 'repairability' <> 'terminal')
     or (issue_input ->> 'repairability' = 'terminal'
       and issue_input ->> 'blocking_scope' <> 'terminal') then
    raise exception 'MARKET_WORKFLOW_ISSUE_INVALID' using errcode = '22023';
  end if;
end;
$function$;

revoke all on function private.assert_market_workflow_issue_v1(jsonb)
  from public, anon, authenticated, service_role;

create or replace function private.record_market_radar_refresh_event_v1(
  request_id_input uuid,
  provider_input text,
  capability_input text,
  event_code_input text,
  previous_phase_input text,
  next_phase_input text,
  accepted_count_input integer,
  quarantined_count_input integer,
  failed_count_input integer,
  error_code_input text,
  issue_input jsonb default null
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $function$
declare
  fingerprint_value text;
  event_id_value bigint;
begin
  if issue_input is not null then
    perform private.assert_market_workflow_issue_v1(issue_input);
  end if;
  fingerprint_value := encode(extensions.digest(convert_to(concat_ws('|',
    request_id_input::text, provider_input, capability_input, event_code_input,
    coalesce(previous_phase_input,''), coalesce(next_phase_input,''),
    coalesce(accepted_count_input,0)::text, coalesce(quarantined_count_input,0)::text,
    coalesce(failed_count_input,0)::text, coalesce(error_code_input,''),
    coalesce(issue_input ->> 'fingerprint','')
  ), 'UTF8'), 'sha256'), 'hex');

  insert into private.market_radar_refresh_events_v1(
    request_id,provider,capability,event_code,previous_phase,next_phase,
    accepted_count,quarantined_count,failed_count,error_code,issue,event_fingerprint
  ) values (
    request_id_input,provider_input,capability_input,event_code_input,
    previous_phase_input,next_phase_input,coalesce(accepted_count_input,0),
    coalesce(quarantined_count_input,0),coalesce(failed_count_input,0),
    error_code_input,issue_input,fingerprint_value
  ) on conflict (event_fingerprint) do nothing
  returning id into event_id_value;
  if event_id_value is null then
    select id into event_id_value from private.market_radar_refresh_events_v1
    where event_fingerprint=fingerprint_value;
  end if;
  return event_id_value;
end;
$function$;

revoke all on function private.record_market_radar_refresh_event_v1(
  uuid,text,text,text,text,text,integer,integer,integer,text,jsonb
) from public, anon, authenticated, service_role;

create or replace function private.reject_market_radar_refresh_event_mutation_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  raise exception 'RADAR_REFRESH_EVENT_APPEND_ONLY' using errcode = '55000';
end;
$function$;

revoke all on function private.reject_market_radar_refresh_event_mutation_v1()
  from public, anon, authenticated, service_role;

create trigger reject_market_radar_refresh_event_mutation_v1
before update or delete on private.market_radar_refresh_events_v1
for each row execute function private.reject_market_radar_refresh_event_mutation_v1();

create or replace function public.claim_market_radar_provider_probe_v1(
  provider_input text,
  capability_input text,
  request_id_input uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor_id_value uuid := private.require_current_admin();
  circuit private.market_radar_provider_circuits_v1%rowtype;
  token_value uuid;
  now_value timestamptz := clock_timestamp();
begin
  if request_id_input is null
     or provider_input not in ('polymarket','kalshi','tavily')
     or capability_input not in ('candidate_feed','source_enrichment')
     or (capability_input = 'candidate_feed' and provider_input = 'tavily')
     or (capability_input = 'source_enrichment' and provider_input <> 'tavily') then
    raise exception 'RADAR_PROVIDER_PROBE_INVALID' using errcode = '22023';
  end if;

  insert into private.market_radar_provider_circuits_v1(provider,capability)
  values (provider_input,capability_input)
  on conflict (provider,capability) do nothing;

  select * into circuit
  from private.market_radar_provider_circuits_v1
  where provider=provider_input and capability=capability_input
  for update;

  if circuit.state='open' and circuit.next_probe_at is not null
     and circuit.next_probe_at>now_value then
    return jsonb_build_object(
      'allowed',false,'state','open','retry_after_at',circuit.next_probe_at,
      'last_success_at',circuit.last_success_at,
      'last_success_count',circuit.last_success_count,
      'actor_id',actor_id_value
    );
  end if;

  if circuit.state='half_open'
     and circuit.probe_lease_expires_at>now_value
     and circuit.probe_request_id is distinct from request_id_input then
    return jsonb_build_object(
      'allowed',false,'state','half_open',
      'retry_after_at',circuit.probe_lease_expires_at,
      'last_success_at',circuit.last_success_at,
      'last_success_count',circuit.last_success_count,
      'actor_id',actor_id_value
    );
  end if;

  if circuit.state in ('open','half_open') then
    if circuit.probe_request_id=request_id_input
       and circuit.probe_lease_expires_at>now_value then
      token_value:=circuit.probe_lease_token;
    else
      token_value:=gen_random_uuid();
      update private.market_radar_provider_circuits_v1 set
        state='half_open',
        probe_request_id=request_id_input,
        probe_lease_token=token_value,
        probe_lease_expires_at=now_value+interval '45 seconds',
        version=version+1,
        updated_at=now_value
      where provider=provider_input and capability=capability_input
      returning * into circuit;
    end if;
    return jsonb_build_object(
      'allowed',true,'state','half_open','probe',true,
      'probe_lease_token',token_value,
      'probe_lease_expires_at',coalesce(circuit.probe_lease_expires_at,now_value+interval '45 seconds'),
      'last_success_at',circuit.last_success_at,
      'last_success_count',circuit.last_success_count,
      'actor_id',actor_id_value
    );
  end if;

  return jsonb_build_object(
    'allowed',true,'state','closed','probe',false,
    'last_success_at',circuit.last_success_at,
    'last_success_count',circuit.last_success_count,
    'actor_id',actor_id_value
  );
end;
$function$;

alter function public.claim_market_radar_provider_probe_v1(text,text,uuid) owner to postgres;
revoke all on function public.claim_market_radar_provider_probe_v1(text,text,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.claim_market_radar_provider_probe_v1(text,text,uuid)
  to authenticated;

create or replace function public.begin_market_radar_refresh_v2(
  request_id_input uuid,
  provider_input text,
  capability_input text,
  request_hash_input text,
  cache_key_input text,
  normalizer_version_input text,
  policy_version_input text,
  lease_owner_input uuid,
  probe_lease_token_input uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor_id_value uuid := private.require_current_admin();
  intent private.market_radar_refresh_intents_v1%rowtype;
  other_intent private.market_radar_refresh_intents_v1%rowtype;
  circuit private.market_radar_provider_circuits_v1%rowtype;
  lease_token_value uuid;
  now_value timestamptz := clock_timestamp();
  previous_phase_value text;
begin
  if request_id_input is null or lease_owner_input is null
     or provider_input not in ('polymarket','kalshi','tavily')
     or capability_input not in ('candidate_feed','source_enrichment')
     or (capability_input='candidate_feed' and provider_input='tavily')
     or (capability_input='source_enrichment' and provider_input<>'tavily')
     or coalesce(request_hash_input,'') !~ '^[0-9a-f]{64}$'
     or nullif(trim(cache_key_input),'') is null or char_length(cache_key_input)>180
     or nullif(trim(normalizer_version_input),'') is null
     or nullif(trim(policy_version_input),'') is null then
    raise exception 'RADAR_REFRESH_REQUEST_INVALID' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'atinara:radar-refresh:'||provider_input||':'||capability_input,0
  ));

  select * into circuit from private.market_radar_provider_circuits_v1
  where provider=provider_input and capability=capability_input for update;
  if not found then
    raise exception 'RADAR_PROVIDER_PROBE_REQUIRED' using errcode='40001';
  end if;
  if circuit.state='half_open' and (
       circuit.probe_request_id is distinct from request_id_input
       or circuit.probe_lease_token is distinct from probe_lease_token_input
       or circuit.probe_lease_expires_at<=now_value
     ) then
    raise exception 'RADAR_PROVIDER_PROBE_LEASE_INVALID' using errcode='40001';
  elsif circuit.state='open' then
    raise exception 'RADAR_PROVIDER_CIRCUIT_OPEN' using errcode='55000';
  elsif circuit.state='closed' and probe_lease_token_input is not null then
    raise exception 'RADAR_PROVIDER_PROBE_LEASE_INVALID' using errcode='40001';
  end if;

  select * into intent
  from private.market_radar_refresh_intents_v1
  where request_id=request_id_input
    and provider=provider_input
    and capability=capability_input
  for update;

  if found then
    if intent.actor_id is distinct from actor_id_value
       or intent.request_hash is distinct from lower(request_hash_input)
       or intent.cache_key is distinct from left(cache_key_input,180)
       or intent.normalizer_version is distinct from normalizer_version_input
       or intent.policy_version is distinct from policy_version_input then
      raise exception 'RADAR_REFRESH_IDEMPOTENCY_CONFLICT' using errcode = '40001';
    end if;
    if intent.status<>'in_progress' then
      return jsonb_build_object(
        'started',false,'replayed',true,'in_progress',false,
        'request_id',intent.request_id,'provider',intent.provider,
        'capability',intent.capability,'status',intent.status,'phase',intent.phase,
        'response_summary',intent.response_summary,'issue',intent.issue
      );
    end if;
    if intent.lease_expires_at>now_value
       and intent.lease_owner is distinct from lease_owner_input then
      return jsonb_build_object(
        'started',false,'replayed',false,'in_progress',true,
        'request_id',intent.request_id,'provider',intent.provider,
        'capability',intent.capability,'status',intent.status,'phase',intent.phase,
        'retry_after_at',intent.lease_expires_at
      );
    end if;
    previous_phase_value:=intent.phase;
    lease_token_value:=case
      when intent.lease_owner=lease_owner_input and intent.lease_expires_at>now_value
        then intent.lease_token
      else gen_random_uuid()
    end;
    update private.market_radar_refresh_intents_v1 set
      lease_token=lease_token_value,
      lease_owner=lease_owner_input,
      lease_expires_at=now_value+interval '45 seconds',
      claim_count=claim_count+case when lease_owner is distinct from lease_owner_input then 1 else 0 end,
      updated_at=now_value
    where request_id=request_id_input and provider=provider_input and capability=capability_input
    returning * into intent;
    perform private.record_market_radar_refresh_event_v1(
      request_id_input,provider_input,capability_input,'RADAR_REFRESH_RECLAIMED',
      previous_phase_value,intent.phase,intent.accepted_count,intent.quarantined_count,
      intent.failed_count,null,null
    );
    return jsonb_build_object(
      'started',false,'replayed',false,'in_progress',false,'resumed',true,
      'request_id',intent.request_id,'provider',intent.provider,
      'capability',intent.capability,'status',intent.status,'phase',intent.phase,
      'lease_token',intent.lease_token,'lease_expires_at',intent.lease_expires_at,
      'expected_count',intent.expected_count,'staged_count',intent.staged_count,
      'processed_count',intent.processed_count
    );
  end if;

  select * into other_intent
  from private.market_radar_refresh_intents_v1
  where provider=provider_input and capability=capability_input and status='in_progress'
  order by created_at
  limit 1
  for update;
  if found and other_intent.lease_expires_at>now_value then
    return jsonb_build_object(
      'started',false,'replayed',false,'in_progress',true,
      'request_id',case
        when other_intent.actor_id=actor_id_value
          and other_intent.request_hash=lower(request_hash_input)
          and other_intent.cache_key=left(cache_key_input,180)
          and other_intent.normalizer_version=normalizer_version_input
          and other_intent.policy_version=policy_version_input
        then other_intent.request_id else null end,
      'provider',provider_input,'capability',capability_input,
      'status','in_progress','phase',other_intent.phase,
      'retry_after_at',other_intent.lease_expires_at
    );
  elsif found then
    update private.market_radar_refresh_intents_v1 set
      status='interrupted',phase='terminal',lease_token=null,lease_owner=null,
      lease_expires_at=null,completed_at=now_value,updated_at=now_value,
      response_summary=jsonb_build_object(
        'outcome','interrupted','code','RADAR_REFRESH_REQUEST_INTERRUPTED',
        'state_preserved',true
      )
    where request_id=other_intent.request_id
      and provider=other_intent.provider and capability=other_intent.capability;
    perform private.record_market_radar_refresh_event_v1(
      other_intent.request_id,other_intent.provider,other_intent.capability,
      'RADAR_REFRESH_REQUEST_INTERRUPTED',other_intent.phase,'terminal',
      other_intent.accepted_count,other_intent.quarantined_count,
      other_intent.failed_count,'RADAR_REFRESH_REQUEST_INTERRUPTED',null
    );
  end if;

  lease_token_value:=gen_random_uuid();
  insert into private.market_radar_refresh_intents_v1(
    request_id,provider,capability,actor_id,request_hash,cache_key,
    normalizer_version,policy_version,lease_token,lease_owner,lease_expires_at
  ) values (
    request_id_input,provider_input,capability_input,actor_id_value,
    lower(request_hash_input),left(cache_key_input,180),normalizer_version_input,
    policy_version_input,lease_token_value,lease_owner_input,now_value+interval '45 seconds'
  ) returning * into intent;
  perform private.record_market_radar_refresh_event_v1(
    request_id_input,provider_input,capability_input,'RADAR_REFRESH_CLAIMED',
    null,'claimed',0,0,0,null,null
  );
  return jsonb_build_object(
    'started',true,'replayed',false,'in_progress',false,'resumed',false,
    'request_id',intent.request_id,'provider',intent.provider,
    'capability',intent.capability,'status',intent.status,'phase',intent.phase,
    'lease_token',intent.lease_token,'lease_expires_at',intent.lease_expires_at,
    'expected_count',intent.expected_count,'staged_count',intent.staged_count
  );
end;
$function$;

alter function public.begin_market_radar_refresh_v2(uuid,text,text,text,text,text,text,uuid,uuid)
  owner to postgres;
revoke all on function public.begin_market_radar_refresh_v2(uuid,text,text,text,text,text,text,uuid,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.begin_market_radar_refresh_v2(uuid,text,text,text,text,text,text,uuid,uuid)
  to authenticated;

create or replace function private.assert_market_radar_refresh_lease_v1(
  request_id_input uuid,
  provider_input text,
  capability_input text,
  lease_token_input uuid
)
returns private.market_radar_refresh_intents_v1
language plpgsql
security definer
set search_path = ''
as $function$
declare
  intent private.market_radar_refresh_intents_v1%rowtype;
begin
  if auth.role()<>'service_role' then
    raise exception 'SERVICE_ROLE_REQUIRED' using errcode = '42501';
  end if;
  select * into intent from private.market_radar_refresh_intents_v1
  where request_id=request_id_input and provider=provider_input and capability=capability_input
  for update;
  if not found or intent.status<>'in_progress'
     or intent.lease_token is distinct from lease_token_input
     or intent.lease_expires_at<=clock_timestamp() then
    raise exception 'RADAR_REFRESH_LEASE_INVALID' using errcode = '40001';
  end if;
  return intent;
end;
$function$;

revoke all on function private.assert_market_radar_refresh_lease_v1(uuid,text,text,uuid)
  from public,anon,authenticated,service_role;

create or replace function public.renew_market_radar_refresh_lease_v1(
  request_id_input uuid,
  provider_input text,
  capability_input text,
  lease_token_input uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  intent private.market_radar_refresh_intents_v1%rowtype;
begin
  intent:=private.assert_market_radar_refresh_lease_v1(
    request_id_input,provider_input,capability_input,lease_token_input
  );
  update private.market_radar_refresh_intents_v1 set
    lease_expires_at=clock_timestamp()+interval '45 seconds',updated_at=clock_timestamp()
  where request_id=request_id_input and provider=provider_input and capability=capability_input
  returning * into intent;
  return jsonb_build_object('ok',true,'lease_expires_at',intent.lease_expires_at,'phase',intent.phase);
end;
$function$;

alter function public.renew_market_radar_refresh_lease_v1(uuid,text,text,uuid) owner to postgres;
revoke all on function public.renew_market_radar_refresh_lease_v1(uuid,text,text,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.renew_market_radar_refresh_lease_v1(uuid,text,text,uuid)
  to service_role;

create or replace function public.declare_market_radar_refresh_manifest_v1(
  request_id_input uuid,
  provider_input text,
  capability_input text,
  lease_token_input uuid,
  expected_count_input integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  intent private.market_radar_refresh_intents_v1%rowtype;
begin
  intent:=private.assert_market_radar_refresh_lease_v1(
    request_id_input,provider_input,capability_input,lease_token_input
  );
  if capability_input<>'candidate_feed' or expected_count_input not between 0 and 240 then
    raise exception 'RADAR_REFRESH_MANIFEST_INVALID' using errcode='22023';
  end if;
  if intent.expected_count is not null then
    if intent.expected_count is distinct from expected_count_input then
      raise exception 'RADAR_REFRESH_MANIFEST_IDEMPOTENCY_CONFLICT' using errcode='40001';
    end if;
    return jsonb_build_object('ok',true,'replayed',true,
      'expected_count',intent.expected_count,'staged_count',intent.staged_count);
  end if;
  update private.market_radar_refresh_intents_v1 set
    expected_count=expected_count_input,phase=case when expected_count_input=0 then 'staged' else 'fetching' end,
    updated_at=clock_timestamp()
  where request_id=request_id_input and provider=provider_input and capability=capability_input
  returning * into intent;
  perform private.record_market_radar_refresh_event_v1(
    request_id_input,provider_input,capability_input,'RADAR_REFRESH_MANIFEST_DECLARED',
    'claimed',intent.phase,0,0,0,null,null
  );
  return jsonb_build_object('ok',true,'replayed',false,
    'expected_count',intent.expected_count,'staged_count',intent.staged_count);
end;
$function$;

alter function public.declare_market_radar_refresh_manifest_v1(uuid,text,text,uuid,integer)
  owner to postgres;
revoke all on function public.declare_market_radar_refresh_manifest_v1(uuid,text,text,uuid,integer)
  from public,anon,authenticated,service_role;
grant execute on function public.declare_market_radar_refresh_manifest_v1(uuid,text,text,uuid,integer)
  to service_role;

create or replace function public.stage_market_radar_refresh_batch_v1(
  request_id_input uuid,
  provider_input text,
  capability_input text,
  lease_token_input uuid,
  batch_ordinal_input integer,
  items_input jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  intent private.market_radar_refresh_intents_v1%rowtype;
  existing_batch private.market_radar_refresh_batches_v1%rowtype;
  batch private.market_radar_refresh_batches_v1%rowtype;
  batch_hash_value text;
  attempt_ids_value jsonb;
begin
  intent:=private.assert_market_radar_refresh_lease_v1(
    request_id_input,provider_input,capability_input,lease_token_input
  );
  if capability_input<>'candidate_feed'
     or batch_ordinal_input is null or batch_ordinal_input not between 0 and 99
     or jsonb_typeof(items_input)<>'array'
     or jsonb_array_length(items_input) not between 1 and 24
     or octet_length(items_input::text)>1048576
     or exists (
       select 1 from jsonb_array_elements(items_input) item
       where jsonb_typeof(item)<>'object'
          or jsonb_typeof(item->'candidate')<>'object'
          or jsonb_typeof(item->'eligibility_check')<>'object'
          or coalesce(item#>>'{candidate,provider}','') is distinct from provider_input
          or nullif(item#>>'{candidate,external_id}','') is null
     ) then
    raise exception 'RADAR_REFRESH_BATCH_INVALID' using errcode = '22023';
  end if;
  if intent.phase not in ('fetching','staged') or intent.manifest_hash is not null
     or intent.expected_count is null
     or (intent.staged_count+jsonb_array_length(items_input)>intent.expected_count
       and not exists (
         select 1 from private.market_radar_refresh_batches_v1 existing
         where existing.request_id=request_id_input and existing.provider=provider_input
           and existing.capability=capability_input
           and existing.batch_ordinal=batch_ordinal_input and existing.split_path=''
       )) then
    raise exception 'RADAR_REFRESH_STAGE_NOT_ALLOWED' using errcode = '55000';
  end if;
  batch_hash_value:=encode(extensions.digest(convert_to(items_input::text,'UTF8'),'sha256'),'hex');
  select * into existing_batch from private.market_radar_refresh_batches_v1
  where request_id=request_id_input and provider=provider_input
    and capability=capability_input and batch_ordinal=batch_ordinal_input and split_path=''
  for update;
  if found then
    if existing_batch.batch_hash is distinct from batch_hash_value
       or existing_batch.items is distinct from items_input then
      raise exception 'RADAR_REFRESH_BATCH_IDEMPOTENCY_CONFLICT' using errcode = '40001';
    end if;
    return jsonb_build_object(
      'ok',true,'replayed',true,'batch_id',existing_batch.id,
      'batch_ordinal',existing_batch.batch_ordinal,'batch_hash',existing_batch.batch_hash,
      'item_count',jsonb_array_length(existing_batch.items)
    );
  end if;
  select jsonb_agg(to_jsonb(gen_random_uuid()) order by ordinality)
  into attempt_ids_value
  from jsonb_array_elements(items_input) with ordinality;
  insert into private.market_radar_refresh_batches_v1(
    request_id,provider,capability,batch_ordinal,batch_hash,items,eligibility_attempt_ids
  ) values (
    request_id_input,provider_input,capability_input,batch_ordinal_input,
    batch_hash_value,items_input,attempt_ids_value
  ) returning * into batch;
  update private.market_radar_refresh_intents_v1 set
    phase='staged',staged_count=staged_count+jsonb_array_length(items_input),
    updated_at=clock_timestamp()
  where request_id=request_id_input and provider=provider_input and capability=capability_input;
  perform private.record_market_radar_refresh_event_v1(
    request_id_input,provider_input,capability_input,'RADAR_REFRESH_BATCH_STAGED',
    intent.phase,'staged',intent.accepted_count,intent.quarantined_count,intent.failed_count,null,null
  );
  return jsonb_build_object(
    'ok',true,'replayed',false,'batch_id',batch.id,'batch_ordinal',batch.batch_ordinal,
    'batch_hash',batch.batch_hash,'item_count',jsonb_array_length(batch.items)
  );
end;
$function$;

alter function public.stage_market_radar_refresh_batch_v1(uuid,text,text,uuid,integer,jsonb)
  owner to postgres;
revoke all on function public.stage_market_radar_refresh_batch_v1(uuid,text,text,uuid,integer,jsonb)
  from public,anon,authenticated,service_role;
grant execute on function public.stage_market_radar_refresh_batch_v1(uuid,text,text,uuid,integer,jsonb)
  to service_role;

create or replace function public.seal_market_radar_refresh_v1(
  request_id_input uuid,
  provider_input text,
  capability_input text,
  lease_token_input uuid,
  expected_count_input integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  intent private.market_radar_refresh_intents_v1%rowtype;
  root_count integer;
  item_count integer;
  min_ordinal integer;
  max_ordinal integer;
  manifest_hash_value text;
begin
  intent:=private.assert_market_radar_refresh_lease_v1(
    request_id_input,provider_input,capability_input,lease_token_input
  );
  if capability_input<>'candidate_feed' or expected_count_input not between 0 and 240
     or intent.expected_count is distinct from expected_count_input then
    raise exception 'RADAR_REFRESH_MANIFEST_INVALID' using errcode = '22023';
  end if;
  select count(*),coalesce(sum(jsonb_array_length(items)),0),min(batch_ordinal),max(batch_ordinal),
         encode(extensions.digest(convert_to(coalesce(string_agg(batch_hash,'' order by batch_ordinal),''),'UTF8'),'sha256'),'hex')
  into root_count,item_count,min_ordinal,max_ordinal,manifest_hash_value
  from private.market_radar_refresh_batches_v1
  where request_id=request_id_input and provider=provider_input and capability=capability_input
    and generation=0 and split_path='';
  if item_count<>expected_count_input
     or (root_count>0 and (min_ordinal<>0 or max_ordinal<>root_count-1))
     or exists (
       select 1
       from private.market_radar_refresh_batches_v1 batch
       cross join lateral jsonb_array_elements(batch.items) item
       where batch.request_id=request_id_input and batch.provider=provider_input
         and batch.capability=capability_input and batch.generation=0
       group by item#>>'{candidate,external_id}' having count(*)>1
     ) then
    raise exception 'RADAR_REFRESH_MANIFEST_INVALID' using errcode = '22023';
  end if;
  if intent.manifest_hash is not null then
    if intent.manifest_hash is distinct from manifest_hash_value
       or intent.expected_count is distinct from expected_count_input then
      raise exception 'RADAR_REFRESH_MANIFEST_IDEMPOTENCY_CONFLICT' using errcode = '40001';
    end if;
    return jsonb_build_object('ok',true,'replayed',true,'manifest_hash',intent.manifest_hash,
      'expected_count',intent.expected_count,'phase',intent.phase);
  end if;
  update private.market_radar_refresh_intents_v1 set
    expected_count=expected_count_input,manifest_hash=manifest_hash_value,
    staged_count=item_count,phase='persisting',updated_at=clock_timestamp()
  where request_id=request_id_input and provider=provider_input and capability=capability_input
  returning * into intent;
  perform private.record_market_radar_refresh_event_v1(
    request_id_input,provider_input,capability_input,'RADAR_REFRESH_MANIFEST_SEALED',
    'staged','persisting',0,0,0,null,null
  );
  return jsonb_build_object('ok',true,'replayed',false,'manifest_hash',intent.manifest_hash,
    'expected_count',intent.expected_count,'phase',intent.phase);
end;
$function$;

alter function public.seal_market_radar_refresh_v1(uuid,text,text,uuid,integer) owner to postgres;
revoke all on function public.seal_market_radar_refresh_v1(uuid,text,text,uuid,integer)
  from public,anon,authenticated,service_role;
grant execute on function public.seal_market_radar_refresh_v1(uuid,text,text,uuid,integer)
  to service_role;

create or replace function private.persist_market_radar_refresh_item_v1(
  provider_input text,
  item_input jsonb,
  eligibility_attempt_id_input uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  candidate_input jsonb := item_input -> 'candidate';
  check_input jsonb := item_input -> 'eligibility_check';
  existing_candidate private.external_market_candidates%rowtype;
  candidate private.external_market_candidates%rowtype;
  check_row private.market_radar_eligibility_checks%rowtype;
  check_checked_at timestamptz;
  check_expires_at timestamptz;
  verification text;
  mapped_quality text;
  mapped_state text;
begin
  if jsonb_typeof(candidate_input)<>'object'
     or jsonb_typeof(check_input)<>'object'
     or eligibility_attempt_id_input is null
     or candidate_input ->> 'provider' is distinct from provider_input
     or nullif(candidate_input ->> 'external_id','') is null
     or nullif(candidate_input ->> 'fingerprint','') is null
     or nullif(candidate_input ->> 'event_group_key','') is null
     or candidate_input ->> 'eligibility_policy_version'
        is distinct from 'atinara-prediction-policy-v5'
     or candidate_input ->> 'eligibility_status' not in (
       'eligible','terminal','inactive_option','technical_hold','invalid','duplicate'
     )
     or check_input ->> 'provider' is distinct from provider_input
     or check_input ->> 'external_id' is distinct from candidate_input ->> 'external_id'
     or check_input ->> 'policy_version' is distinct from 'atinara-prediction-policy-v5'
     or check_input ->> 'status' is distinct from candidate_input ->> 'eligibility_status'
     or coalesce(check_input ->> 'decision_hash','') !~ '^[0-9a-f]{64}$'
     or jsonb_typeof(coalesce(check_input -> 'evidence','[]'::jsonb))<>'array'
     or jsonb_array_length(coalesce(check_input -> 'evidence','[]'::jsonb))>12 then
    raise exception 'INVALID_RADAR_ELIGIBILITY' using errcode = '22023';
  end if;

  begin
    check_checked_at:=(check_input ->> 'checked_at')::timestamptz;
    check_expires_at:=(check_input ->> 'expires_at')::timestamptz;
  exception when invalid_text_representation or datetime_field_overflow then
    raise exception 'INVALID_RADAR_ELIGIBILITY_DATE' using errcode = '22007';
  end;
  if check_expires_at<=check_checked_at then
    raise exception 'INVALID_RADAR_ELIGIBILITY_DATE' using errcode = '22007';
  end if;

  select * into existing_candidate
  from private.external_market_candidates
  where provider=provider_input and external_id=candidate_input ->> 'external_id'
  for update;

  if found and existing_candidate.eligibility_status='terminal'
     and candidate_input ->> 'eligibility_status' is distinct from 'terminal' then
    candidate_input:=candidate_input || jsonb_build_object(
      'eligibility_status','terminal',
      'eligibility_reason_code',existing_candidate.eligibility_reason_code,
      'eligibility_reason',existing_candidate.eligibility_reason,
      'eligibility_evidence',existing_candidate.eligibility_evidence,
      'eligibility_policy_version','atinara-prediction-policy-v5',
      'verification_status',existing_candidate.verification_status,
      'verification_reason_code',existing_candidate.verification_reason_code,
      'verification_reason',existing_candidate.verification_reason,
      'verified_at',existing_candidate.verified_at,
      'verification_expires_at',existing_candidate.verification_expires_at,
      'verification_evidence',existing_candidate.verification_evidence,
      'quality_score',existing_candidate.quality_score,
      'score_breakdown',existing_candidate.score_breakdown,
      'warnings',existing_candidate.warnings
    );
    check_input:=check_input || jsonb_build_object(
      'status','terminal',
      'reason_code',existing_candidate.eligibility_reason_code,
      'reason',existing_candidate.eligibility_reason,
      'evidence',existing_candidate.eligibility_evidence,
      'decision_hash',encode(extensions.digest(convert_to(concat_ws('|',
        provider_input,existing_candidate.external_id,'terminal',
        coalesce(existing_candidate.eligibility_reason_code,''),
        coalesce(check_input ->> 'checked_at','')
      ),'UTF8'),'sha256'),'hex')
    );
  end if;

  verification:=candidate_input ->> 'verification_status';
  if verification not in (
    'pending','verified_open','needs_review','rejected_resolved','rejected_stale',
    'rejected_ineligible','rejected_unannounced','rejected_incoherent',
    'rejected_invalid_source','rejected_duplicate'
  ) then
    raise exception 'INVALID_RADAR_CANDIDATE' using errcode = '22023';
  end if;
  if verification='verified_open' and (
    nullif(candidate_input ->> 'verified_at','') is null
    or nullif(candidate_input ->> 'verification_expires_at','') is null
    or nullif(candidate_input ->> 'external_event_url','') is null
    or nullif(candidate_input ->> 'external_market_url','') is null
  ) then
    raise exception 'INCOMPLETE_RADAR_VERIFICATION' using errcode = '22023';
  end if;
  mapped_quality:=case when verification='verified_open' then 'fit'
    when verification in ('needs_review','pending') then 'needs_review' else 'rejected' end;
  mapped_state:=case when verification='verified_open' then 'available'
    when verification in ('needs_review','pending') then 'needs_review' else 'rejected' end;

  insert into private.external_market_candidates(
    provider,external_id,external_url,external_event_id,fingerprint,cache_key,
    normalizer_version,source_status,atinara_category,normalized_payload,source_excerpt,
    quality_status,quality_score,score_breakdown,warnings,duplicate_matches,fetched_at,
    source_updated_at,expires_at,state,verification_status,verification_reason_code,
    verification_reason,verified_at,verification_expires_at,verification_evidence,
    event_group_key,external_event_url,external_market_url,external_event_slug,
    external_market_slug,updated_at
  ) values (
    provider_input,candidate_input ->> 'external_id',nullif(candidate_input ->> 'external_url',''),
    nullif(candidate_input ->> 'external_event_id',''),candidate_input ->> 'fingerprint',
    left(coalesce(candidate_input ->> 'cache_key','radar-refresh-v2'),180),
    'atinara-radar-v2',nullif(candidate_input ->> 'source_status',''),
    nullif(candidate_input ->> 'atinara_category',''),candidate_input,
    jsonb_build_object(
      'source_title',candidate_input ->> 'source_title',
      'source_question',candidate_input ->> 'source_question',
      'source_resolution_url',candidate_input ->> 'source_resolution_url',
      'source_probability_yes',candidate_input -> 'source_probability_yes',
      'source_volume_total',candidate_input -> 'source_volume_total',
      'source_liquidity',candidate_input -> 'source_liquidity',
      'raw_source_dates',coalesce(candidate_input #> '{temporal_contract,raw_source_dates}','[]'::jsonb),
      'temporal_contract_version',candidate_input #>> '{temporal_contract,version}',
      'temporal_decision_hash',candidate_input #>> '{temporal_contract,decision_hash}'
    ),mapped_quality,
    least(greatest(coalesce((candidate_input ->> 'quality_score')::numeric,0),0),100),
    coalesce(candidate_input -> 'score_breakdown','{}'::jsonb),
    coalesce(candidate_input -> 'warnings','[]'::jsonb),
    coalesce(candidate_input -> 'duplicate_matches','[]'::jsonb),
    coalesce(nullif(candidate_input ->> 'fetched_at','')::timestamptz,clock_timestamp()),
    nullif(candidate_input ->> 'source_updated_at','')::timestamptz,
    coalesce(nullif(candidate_input ->> 'cache_expires_at','')::timestamptz,
      clock_timestamp()+interval '20 minutes'),
    mapped_state,verification,nullif(left(candidate_input ->> 'verification_reason_code',100),''),
    nullif(left(candidate_input ->> 'verification_reason',1000),''),
    nullif(candidate_input ->> 'verified_at','')::timestamptz,
    nullif(candidate_input ->> 'verification_expires_at','')::timestamptz,
    coalesce(candidate_input -> 'verification_evidence','[]'::jsonb),
    left(candidate_input ->> 'event_group_key',240),
    nullif(candidate_input ->> 'external_event_url',''),
    nullif(candidate_input ->> 'external_market_url',''),
    nullif(candidate_input ->> 'external_event_slug',''),
    nullif(candidate_input ->> 'external_market_slug',''),clock_timestamp()
  ) on conflict (provider,external_id) do update set
    external_url=excluded.external_url,external_event_id=excluded.external_event_id,
    fingerprint=excluded.fingerprint,cache_key=excluded.cache_key,
    normalizer_version=excluded.normalizer_version,source_status=excluded.source_status,
    atinara_category=excluded.atinara_category,normalized_payload=excluded.normalized_payload,
    source_excerpt=excluded.source_excerpt,quality_status=excluded.quality_status,
    quality_score=excluded.quality_score,score_breakdown=excluded.score_breakdown,
    warnings=excluded.warnings,duplicate_matches=excluded.duplicate_matches,
    fetched_at=excluded.fetched_at,source_updated_at=excluded.source_updated_at,
    expires_at=excluded.expires_at,verification_status=excluded.verification_status,
    verification_reason_code=excluded.verification_reason_code,
    verification_reason=excluded.verification_reason,verified_at=excluded.verified_at,
    verification_expires_at=excluded.verification_expires_at,
    verification_evidence=excluded.verification_evidence,event_group_key=excluded.event_group_key,
    external_event_url=excluded.external_event_url,external_market_url=excluded.external_market_url,
    external_event_slug=excluded.external_event_slug,external_market_slug=excluded.external_market_slug,
    state=case when private.external_market_candidates.state in ('prepared','dismissed')
      then private.external_market_candidates.state else excluded.state end,
    updated_at=clock_timestamp()
  returning * into candidate;

  insert into private.market_radar_eligibility_checks(
    attempt_id,candidate_id,provider,external_id,event_group_key,policy_version,status,
    reason_code,reason,evidence,checked_at,expires_at,decision_hash
  ) values (
    eligibility_attempt_id_input,candidate.id,provider_input,candidate.external_id,
    nullif(left(check_input ->> 'event_group_key',240),''),'atinara-prediction-policy-v5',
    check_input ->> 'status',nullif(left(check_input ->> 'reason_code',100),''),
    nullif(left(check_input ->> 'reason',1000),''),
    coalesce(check_input -> 'evidence','[]'::jsonb),check_checked_at,check_expires_at,
    lower(check_input ->> 'decision_hash')
  ) on conflict (attempt_id) do nothing;

  select * into check_row from private.market_radar_eligibility_checks
  where attempt_id=eligibility_attempt_id_input;
  if not found or check_row.candidate_id is distinct from candidate.id
     or check_row.decision_hash is distinct from lower(check_input ->> 'decision_hash') then
    raise exception 'RADAR_ELIGIBILITY_IDEMPOTENCY_CONFLICT' using errcode = '40001';
  end if;

  update private.external_market_candidates set
    current_eligibility_check_id=check_row.id,eligibility_status=check_row.status,
    eligibility_reason_code=check_row.reason_code,eligibility_reason=check_row.reason,
    eligibility_evidence=check_row.evidence,eligibility_checked_at=check_row.checked_at,
    eligibility_expires_at=check_row.expires_at,eligibility_policy_version=check_row.policy_version,
    updated_at=clock_timestamp()
  where id=candidate.id returning * into candidate;

  return jsonb_build_object('candidate_id',candidate.id,'eligibility_check_id',check_row.id,
    'preparation_revision',candidate.preparation_revision);
end;
$function$;

revoke all on function private.persist_market_radar_refresh_item_v1(text,jsonb,uuid)
  from public,anon,authenticated,service_role;

create or replace function public.process_market_radar_refresh_batch_v1(
  request_id_input uuid,
  provider_input text,
  capability_input text,
  lease_token_input uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  intent private.market_radar_refresh_intents_v1%rowtype;
  batch private.market_radar_refresh_batches_v1%rowtype;
  item jsonb;
  item_ordinality bigint;
  attempt_id_value uuid;
  accepted_value integer:=0;
  quarantined_value integer:=0;
  returned_state text;
  returned_message text;
  safe_error_code text;
  remaining_value integer;
begin
  intent:=private.assert_market_radar_refresh_lease_v1(
    request_id_input,provider_input,capability_input,lease_token_input
  );
  if capability_input<>'candidate_feed' or intent.manifest_hash is null
     or intent.phase not in ('persisting','finalizing') then
    raise exception 'RADAR_REFRESH_PROCESS_NOT_ALLOWED' using errcode = '55000';
  end if;

  select * into batch
  from private.market_radar_refresh_batches_v1
  where request_id=request_id_input and provider=provider_input and capability=capability_input
    and status in ('pending','technical_failed')
  order by batch_ordinal,split_path
  limit 1
  for update skip locked;
  if not found then
    select count(*) into remaining_value from private.market_radar_refresh_batches_v1
    where request_id=request_id_input and provider=provider_input and capability=capability_input
      and status not in ('completed','superseded');
    if remaining_value=0 then
      update private.market_radar_refresh_intents_v1 set phase='finalizing',updated_at=clock_timestamp()
      where request_id=request_id_input and provider=provider_input and capability=capability_input;
    end if;
    return jsonb_build_object('ok',true,'processed',false,'remaining_batches',remaining_value,
      'phase',case when remaining_value=0 then 'finalizing' else intent.phase end);
  end if;

  update private.market_radar_refresh_batches_v1 set
    status='processing',attempt_count=attempt_count+1,error_code=null,updated_at=clock_timestamp()
  where id=batch.id returning * into batch;

  begin
    for item,item_ordinality in
      select value,ordinality from jsonb_array_elements(batch.items) with ordinality
    loop
      attempt_id_value:=(batch.eligibility_attempt_ids ->> (item_ordinality::integer-1))::uuid;
      begin
        perform private.persist_market_radar_refresh_item_v1(provider_input,item,attempt_id_value);
        accepted_value:=accepted_value+1;
      exception when others then
        get stacked diagnostics returned_state=returned_sqlstate,returned_message=message_text;
        if returned_state='57014' or not (
          returned_message in (
            'INVALID_RADAR_CANDIDATE','INCOMPLETE_RADAR_VERIFICATION',
            'INVALID_RADAR_ELIGIBILITY','INVALID_RADAR_ELIGIBILITY_DATE',
            'TEMPORAL_CONTRACT_INVALID','MARKET_WORKFLOW_ISSUES_INVALID',
            'MARKET_WORKFLOW_ISSUE_INVALID','MARKET_WORKFLOW_SUBJECT_INVALID',
            'MARKET_WORKFLOW_ISSUE_ID_REUSED',
            'MARKET_WORKFLOW_SUBJECT_FINGERPRINT_CONFLICT',
            'MARKET_WORKFLOW_REPAIR_BINDING_REQUIRED'
          ) or returned_state in ('22001','22003','22007','22008','22P02','23502','23503','23514')
        ) then
          raise;
        end if;
        safe_error_code:=case when returned_message in (
          'INVALID_RADAR_CANDIDATE','INCOMPLETE_RADAR_VERIFICATION',
          'INVALID_RADAR_ELIGIBILITY','INVALID_RADAR_ELIGIBILITY_DATE',
          'TEMPORAL_CONTRACT_INVALID','MARKET_WORKFLOW_ISSUES_INVALID',
          'MARKET_WORKFLOW_ISSUE_INVALID','MARKET_WORKFLOW_SUBJECT_INVALID',
          'MARKET_WORKFLOW_ISSUE_ID_REUSED',
          'MARKET_WORKFLOW_SUBJECT_FINGERPRINT_CONFLICT',
          'MARKET_WORKFLOW_REPAIR_BINDING_REQUIRED'
        ) then returned_message else 'RADAR_CANDIDATE_DATA_INVALID' end;
        insert into private.market_radar_candidate_quarantines(
          provider,cache_key,external_id,fingerprint,stage,error_code,database_code,operation,
          refresh_request_id,refresh_batch_id,refresh_item_ordinal
        ) values (
          provider_input,intent.cache_key,
          coalesce(nullif(left(item#>>'{candidate,external_id}',220),''),'[sin-identificador]'),
          case when coalesce(item#>>'{candidate,fingerprint}','')~'^[0-9a-fA-F]{64}$'
            then lower(item#>>'{candidate,fingerprint}') else null end,
          'authoritative_persistence',safe_error_code,returned_state,
          'process_market_radar_refresh_batch_v1',request_id_input,batch.id,item_ordinality::integer
        ) on conflict (refresh_request_id,provider,refresh_batch_id,refresh_item_ordinal)
          where refresh_request_id is not null do nothing;
        quarantined_value:=quarantined_value+1;
      end;
    end loop;

    update private.market_radar_refresh_batches_v1 set
      status='completed',accepted_count=accepted_value,quarantined_count=quarantined_value,
      failed_count=0,completed_at=clock_timestamp(),updated_at=clock_timestamp()
    where id=batch.id;
    update private.market_radar_refresh_intents_v1 set
      processed_count=processed_count+accepted_value+quarantined_value,
      accepted_count=accepted_count+accepted_value,
      quarantined_count=quarantined_count+quarantined_value,
      updated_at=clock_timestamp()
    where request_id=request_id_input and provider=provider_input and capability=capability_input
    returning * into intent;
    perform private.record_market_radar_refresh_event_v1(
      request_id_input,provider_input,capability_input,'RADAR_REFRESH_BATCH_COMPLETED',
      'persisting','persisting',intent.accepted_count,intent.quarantined_count,intent.failed_count,null,null
    );
  exception when query_canceled then
    update private.market_radar_refresh_batches_v1 set
      status='technical_failed',failed_count=jsonb_array_length(items),
      error_code='RADAR_PERSISTENCE_TIMEOUT',updated_at=clock_timestamp()
    where id=batch.id;
    perform private.record_market_radar_refresh_event_v1(
      request_id_input,provider_input,capability_input,'RADAR_REFRESH_BATCH_TECHNICAL_FAILED',
      'persisting','persisting',intent.accepted_count,intent.quarantined_count,
      jsonb_array_length(batch.items),'RADAR_PERSISTENCE_TIMEOUT',null
    );
    return jsonb_build_object('ok',false,'retryable',true,'code','RADAR_PERSISTENCE_TIMEOUT',
      'batch_id',batch.id,'item_count',jsonb_array_length(batch.items));
  when others then
    update private.market_radar_refresh_batches_v1 set
      status='technical_failed',failed_count=jsonb_array_length(items),
      error_code='RADAR_PERSISTENCE_FAILED',updated_at=clock_timestamp()
    where id=batch.id;
    perform private.record_market_radar_refresh_event_v1(
      request_id_input,provider_input,capability_input,'RADAR_REFRESH_BATCH_TECHNICAL_FAILED',
      'persisting','persisting',intent.accepted_count,intent.quarantined_count,
      jsonb_array_length(batch.items),'RADAR_PERSISTENCE_FAILED',null
    );
    return jsonb_build_object('ok',false,'retryable',true,'code','RADAR_PERSISTENCE_FAILED',
      'batch_id',batch.id,'item_count',jsonb_array_length(batch.items));
  end;

  select count(*) into remaining_value from private.market_radar_refresh_batches_v1
  where request_id=request_id_input and provider=provider_input and capability=capability_input
    and status not in ('completed','superseded');
  if remaining_value=0 then
    update private.market_radar_refresh_intents_v1 set phase='finalizing',updated_at=clock_timestamp()
    where request_id=request_id_input and provider=provider_input and capability=capability_input;
  end if;
  return jsonb_build_object('ok',true,'processed',true,'batch_id',batch.id,
    'accepted_count',accepted_value,'quarantined_count',quarantined_value,
    'remaining_batches',remaining_value,'phase',case when remaining_value=0 then 'finalizing' else 'persisting' end);
end;
$function$;

alter function public.process_market_radar_refresh_batch_v1(uuid,text,text,uuid) owner to postgres;
revoke all on function public.process_market_radar_refresh_batch_v1(uuid,text,text,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.process_market_radar_refresh_batch_v1(uuid,text,text,uuid)
  to service_role;

create or replace function public.split_market_radar_refresh_batch_v1(
  request_id_input uuid,
  provider_input text,
  capability_input text,
  lease_token_input uuid,
  batch_id_input uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  intent private.market_radar_refresh_intents_v1%rowtype;
  batch private.market_radar_refresh_batches_v1%rowtype;
  left_batch private.market_radar_refresh_batches_v1%rowtype;
  right_batch private.market_radar_refresh_batches_v1%rowtype;
  left_items jsonb;
  right_items jsonb;
  left_attempts jsonb;
  right_attempts jsonb;
  middle_value integer;
begin
  intent:=private.assert_market_radar_refresh_lease_v1(
    request_id_input,provider_input,capability_input,lease_token_input
  );
  select * into batch from private.market_radar_refresh_batches_v1
  where id=batch_id_input and request_id=request_id_input and provider=provider_input
    and capability=capability_input for update;
  if not found then raise exception 'RADAR_REFRESH_BATCH_NOT_FOUND' using errcode='22023'; end if;
  if batch.status='superseded' then
    return jsonb_build_object('ok',true,'replayed',true,'parent_batch_id',batch.id);
  end if;
  if batch.status<>'technical_failed' or jsonb_array_length(batch.items)<2
     or batch.generation>=12 then
    raise exception 'RADAR_REFRESH_BATCH_SPLIT_NOT_ALLOWED' using errcode='55000';
  end if;
  middle_value:=ceil(jsonb_array_length(batch.items)/2.0)::integer;
  select jsonb_agg(value order by ordinality) into left_items
  from jsonb_array_elements(batch.items) with ordinality where ordinality<=middle_value;
  select jsonb_agg(value order by ordinality) into right_items
  from jsonb_array_elements(batch.items) with ordinality where ordinality>middle_value;
  select jsonb_agg(value order by ordinality) into left_attempts
  from jsonb_array_elements(batch.eligibility_attempt_ids) with ordinality where ordinality<=middle_value;
  select jsonb_agg(value order by ordinality) into right_attempts
  from jsonb_array_elements(batch.eligibility_attempt_ids) with ordinality where ordinality>middle_value;
  insert into private.market_radar_refresh_batches_v1(
    request_id,provider,capability,batch_ordinal,split_path,parent_batch_id,generation,
    batch_hash,items,eligibility_attempt_ids
  ) values (
    request_id_input,provider_input,capability_input,batch.batch_ordinal,batch.split_path||'0',
    batch.id,batch.generation+1,
    encode(extensions.digest(convert_to(left_items::text,'UTF8'),'sha256'),'hex'),
    left_items,left_attempts
  ) returning * into left_batch;
  insert into private.market_radar_refresh_batches_v1(
    request_id,provider,capability,batch_ordinal,split_path,parent_batch_id,generation,
    batch_hash,items,eligibility_attempt_ids
  ) values (
    request_id_input,provider_input,capability_input,batch.batch_ordinal,batch.split_path||'1',
    batch.id,batch.generation+1,
    encode(extensions.digest(convert_to(right_items::text,'UTF8'),'sha256'),'hex'),
    right_items,right_attempts
  ) returning * into right_batch;
  update private.market_radar_refresh_batches_v1 set
    status='superseded',completed_at=clock_timestamp(),updated_at=clock_timestamp()
  where id=batch.id;
  perform private.record_market_radar_refresh_event_v1(
    request_id_input,provider_input,capability_input,'RADAR_REFRESH_BATCH_SPLIT',
    'persisting','persisting',intent.accepted_count,intent.quarantined_count,intent.failed_count,null,null
  );
  return jsonb_build_object('ok',true,'replayed',false,'parent_batch_id',batch.id,
    'left_batch_id',left_batch.id,'right_batch_id',right_batch.id,
    'left_count',jsonb_array_length(left_items),'right_count',jsonb_array_length(right_items));
end;
$function$;

alter function public.split_market_radar_refresh_batch_v1(uuid,text,text,uuid,uuid) owner to postgres;
revoke all on function public.split_market_radar_refresh_batch_v1(uuid,text,text,uuid,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.split_market_radar_refresh_batch_v1(uuid,text,text,uuid,uuid)
  to service_role;

create or replace function private.market_radar_refresh_issue_v1(
  request_id_input uuid,
  provider_input text,
  capability_input text,
  issue_code_input text,
  failure_stage_input text,
  last_success_at_input timestamptz,
  last_success_count_input integer
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  now_value timestamptz:=clock_timestamp();
  issue_id_value uuid:=gen_random_uuid();
  owner_value text:=case when failure_stage_input in ('fetch','enrichment')
    then 'provider' else 'internal_platform' end;
  next_action_value text:=case
    when failure_stage_input='persistence' then 'resume_persistence_intent'
    when capability_input='source_enrichment' then 'retry_source_enrichment'
    else 'retry_provider_refresh' end;
  fingerprint_value text;
  issue_value jsonb;
begin
  fingerprint_value:=encode(extensions.digest(convert_to(concat_ws('|',
    request_id_input::text,provider_input,capability_input,issue_code_input,
    coalesce(failure_stage_input,''),owner_value,next_action_value
  ),'UTF8'),'sha256'),'hex');
  issue_value:=jsonb_build_object(
    'issue_id',issue_id_value,'issue_code',issue_code_input,'detected_by','radar',
    'owner_stage',owner_value,'severity','warning','repairability','auto_recoverable',
    'blocking_scope','none','affected_fields','[]'::jsonb,
    'evidence_refs',jsonb_build_array(jsonb_build_object(
      'request_id',request_id_input,'provider',provider_input,'capability',capability_input
    )),
    'current_value',jsonb_build_object(
      'provider',provider_input,'capability',capability_input,'failure_stage',failure_stage_input,
      'last_success_at',last_success_at_input,'last_success_count',coalesce(last_success_count_input,0)
    ),
    'proposed_value',null,'confidence',100,
    'policy_version','atinara-radar-provider-resilience-v1',
    'schema_version','atinara-market-issue-v1','fingerprint',fingerprint_value,
    'status','open','retryable',true,'next_action',next_action_value,
    'created_at',now_value,'updated_at',now_value,'resolved_at',null,'resolution_method',null
  );
  perform private.assert_market_workflow_issue_v1(issue_value);
  return issue_value;
end;
$function$;

revoke all on function private.market_radar_refresh_issue_v1(uuid,text,text,text,text,timestamptz,integer)
  from public,anon,authenticated,service_role;

create or replace function public.defer_market_radar_refresh_v1(
  request_id_input uuid,
  provider_input text,
  capability_input text,
  lease_token_input uuid,
  issue_code_input text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  intent private.market_radar_refresh_intents_v1%rowtype;
  circuit private.market_radar_provider_circuits_v1%rowtype;
  issue_value jsonb;
begin
  intent:=private.assert_market_radar_refresh_lease_v1(
    request_id_input,provider_input,capability_input,lease_token_input
  );
  if issue_code_input not in ('RADAR_PERSISTENCE_TIMEOUT','RADAR_PERSISTENCE_ISOLATION_DEFERRED','RADAR_PERSISTENCE_FAILED') then
    raise exception 'RADAR_REFRESH_DEFERRAL_INVALID' using errcode='22023';
  end if;
  select * into circuit from private.market_radar_provider_circuits_v1
  where provider=provider_input and capability=capability_input;
  issue_value:=private.market_radar_refresh_issue_v1(
    request_id_input,provider_input,capability_input,issue_code_input,'persistence',
    circuit.last_success_at,circuit.last_success_count
  );
  update private.market_radar_refresh_intents_v1 set
    issue=issue_value,lease_expires_at=clock_timestamp(),updated_at=clock_timestamp()
  where request_id=request_id_input and provider=provider_input and capability=capability_input
  returning * into intent;
  perform private.record_market_radar_refresh_event_v1(
    request_id_input,provider_input,capability_input,issue_code_input,
    intent.phase,intent.phase,intent.accepted_count,intent.quarantined_count,
    intent.failed_count,issue_code_input,issue_value
  );
  return jsonb_build_object('ok',true,'outcome','in_progress','request_id',request_id_input,
    'provider',provider_input,'capability',capability_input,'phase',intent.phase,
    'processed_count',intent.processed_count,'expected_count',intent.expected_count,
    'issue',issue_value,'retryable',true,'next_action','resume_persistence_intent');
end;
$function$;

alter function public.defer_market_radar_refresh_v1(uuid,text,text,uuid,text) owner to postgres;
revoke all on function public.defer_market_radar_refresh_v1(uuid,text,text,uuid,text)
  from public,anon,authenticated,service_role;
grant execute on function public.defer_market_radar_refresh_v1(uuid,text,text,uuid,text)
  to service_role;

create or replace function public.finalize_market_radar_refresh_v3(
  request_id_input uuid,
  provider_input text,
  capability_input text,
  lease_token_input uuid,
  status_input text,
  error_code_input text default null,
  failure_stage_input text default null,
  retry_after_seconds_input integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  intent private.market_radar_refresh_intents_v1%rowtype;
  circuit private.market_radar_provider_circuits_v1%rowtype;
  previous_run private.market_radar_provider_runs%rowtype;
  history_id_value bigint;
  finalization_hash_value text;
  response_value jsonb;
  issue_value jsonb;
  resolved_issue_value jsonb;
  now_value timestamptz:=clock_timestamp();
  failures_value integer;
  next_probe_value timestamptz;
  circuit_state_value text;
  last_success_at_value timestamptz;
  last_success_count_value integer;
  terminal_status_value text;
  pending_batches integer;
begin
  if auth.role()<>'service_role' then
    raise exception 'SERVICE_ROLE_REQUIRED' using errcode='42501';
  end if;
  select * into intent from private.market_radar_refresh_intents_v1
  where request_id=request_id_input and provider=provider_input and capability=capability_input
  for update;
  if not found then
    raise exception 'RADAR_REFRESH_REQUEST_NOT_FOUND' using errcode='22023';
  end if;
  if status_input not in ('available','partial_error','unavailable','rate_limited')
     or failure_stage_input is not null and failure_stage_input not in ('fetch','persistence','enrichment')
     or retry_after_seconds_input is not null and retry_after_seconds_input not between 0 and 86400
     or (status_input='available' and (error_code_input is not null or failure_stage_input is not null))
     or (status_input<>'available' and coalesce(error_code_input,'') !~ '^[A-Z][A-Z0-9_]{2,99}$') then
    raise exception 'RADAR_REFRESH_FINALIZATION_INVALID' using errcode='22023';
  end if;
  finalization_hash_value:=encode(extensions.digest(convert_to(concat_ws('|',
    request_id_input::text,provider_input,capability_input,status_input,
    intent.manifest_hash,coalesce(intent.expected_count,0)::text,
    intent.accepted_count::text,intent.quarantined_count::text,intent.failed_count::text,
    coalesce(error_code_input,''),coalesce(failure_stage_input,'')
  ),'UTF8'),'sha256'),'hex');
  if intent.status<>'in_progress' then
    if intent.finalization_hash is distinct from finalization_hash_value then
      raise exception 'RADAR_REFRESH_FINALIZATION_CONFLICT' using errcode='40001';
    end if;
    return intent.response_summary || jsonb_build_object('replayed',true);
  end if;
  if intent.lease_token is distinct from lease_token_input
     or intent.lease_expires_at<=clock_timestamp() then
    raise exception 'RADAR_REFRESH_LEASE_INVALID' using errcode='40001';
  end if;
  select count(*) into pending_batches from private.market_radar_refresh_batches_v1
  where request_id=request_id_input and provider=provider_input and capability=capability_input
    and status not in ('completed','superseded');
  if status_input='available' and capability_input='candidate_feed'
     and (intent.manifest_hash is null or pending_batches<>0
       or intent.processed_count is distinct from intent.expected_count) then
    raise exception 'RADAR_REFRESH_FINALIZATION_PREMATURE' using errcode='55000';
  end if;

  insert into private.market_radar_provider_circuits_v1(provider,capability)
  values(provider_input,capability_input)
  on conflict(provider,capability) do nothing;
  select * into circuit from private.market_radar_provider_circuits_v1
  where provider=provider_input and capability=capability_input for update;
  select * into previous_run from private.market_radar_provider_runs
  where provider=provider_input and cache_key=intent.cache_key for update;

  if status_input='available' then
    failures_value:=0;
    next_probe_value:=null;
    circuit_state_value:='closed';
    last_success_at_value:=now_value;
    last_success_count_value:=intent.accepted_count;
    if intent.issue is not null then
      resolved_issue_value:=intent.issue || jsonb_build_object(
        'status','resolved','updated_at',now_value,'resolved_at',now_value,
        'resolution_method','automatic_resume'
      );
    end if;
  elsif failure_stage_input='persistence' then
    failures_value:=circuit.consecutive_failures;
    next_probe_value:=circuit.next_probe_at;
    circuit_state_value:=case when circuit.state='half_open' then 'closed' else circuit.state end;
    last_success_at_value:=coalesce(circuit.last_success_at,previous_run.last_success_at);
    last_success_count_value:=coalesce(circuit.last_success_count,previous_run.last_success_count,0);
  else
    failures_value:=least(circuit.consecutive_failures+1,1000);
    next_probe_value:=now_value+make_interval(secs=>coalesce(retry_after_seconds_input,
      case when failures_value=1 then 60 when failures_value=2 then 300 else 900 end));
    circuit_state_value:='open';
    last_success_at_value:=coalesce(circuit.last_success_at,previous_run.last_success_at);
    last_success_count_value:=coalesce(circuit.last_success_count,previous_run.last_success_count,0);
  end if;

  update private.market_radar_provider_circuits_v1 set
    state=circuit_state_value,consecutive_failures=failures_value,next_probe_at=next_probe_value,
    probe_request_id=null,probe_lease_token=null,probe_lease_expires_at=null,
    last_success_at=last_success_at_value,last_success_count=last_success_count_value,
    version=version+1,updated_at=now_value
  where provider=provider_input and capability=capability_input;

  if status_input<>'available' then
    issue_value:=private.market_radar_refresh_issue_v1(
      request_id_input,provider_input,capability_input,error_code_input,failure_stage_input,
      last_success_at_value,last_success_count_value
    );
  end if;
  insert into private.market_radar_provider_run_history(
    provider,cache_key,status,result_count,error_code,error_message,accepted_count,
    discarded_count,quarantined_count,failed_count,last_success_at,last_success_count,
    retry_after_at,circuit_state,refresh_request_id,capability,finalization_hash,failure_stage
  ) values (
    provider_input,intent.cache_key,status_input,
    intent.accepted_count,
    error_code_input,case when error_code_input is null then null else 'Incidencia técnica recuperable.' end,
    intent.accepted_count,intent.quarantined_count,intent.quarantined_count,
    case when status_input='available' then 0 else greatest(intent.failed_count,1) end,
    last_success_at_value,last_success_count_value,next_probe_value,circuit_state_value,
    request_id_input,capability_input,finalization_hash_value,failure_stage_input
  ) returning id into history_id_value;

  insert into private.market_radar_provider_runs(
    provider,cache_key,status,result_count,is_cached,error_code,error_message,fetched_at,
    expires_at,updated_at,accepted_count,discarded_count,quarantined_count,failed_count,
    last_success_at,last_success_count,retry_after_at,circuit_state,refresh_request_id,
    capability,finalization_hash,failure_stage
  ) values (
    provider_input,intent.cache_key,status_input,
    intent.accepted_count,
    false,error_code_input,case when error_code_input is null then null else 'Incidencia técnica recuperable.' end,
    now_value,now_value+case when status_input='available' then interval '20 minutes' else interval '5 minutes' end,
    now_value,intent.accepted_count,intent.quarantined_count,intent.quarantined_count,
    case when status_input='available' then 0 else greatest(intent.failed_count,1) end,
    last_success_at_value,last_success_count_value,next_probe_value,circuit_state_value,
    request_id_input,capability_input,finalization_hash_value,failure_stage_input
  ) on conflict(provider,cache_key) do update set
    status=excluded.status,result_count=excluded.result_count,is_cached=false,
    error_code=excluded.error_code,error_message=excluded.error_message,
    fetched_at=excluded.fetched_at,expires_at=excluded.expires_at,updated_at=excluded.updated_at,
    accepted_count=excluded.accepted_count,discarded_count=excluded.discarded_count,
    quarantined_count=excluded.quarantined_count,failed_count=excluded.failed_count,
    last_success_at=excluded.last_success_at,last_success_count=excluded.last_success_count,
    retry_after_at=excluded.retry_after_at,circuit_state=excluded.circuit_state,
    refresh_request_id=excluded.refresh_request_id,capability=excluded.capability,
    finalization_hash=excluded.finalization_hash,failure_stage=excluded.failure_stage;

  terminal_status_value:=case when status_input='available' then 'completed'
    when intent.accepted_count>0 then 'partial' else 'technical_failed' end;
  response_value:=jsonb_build_object(
    'ok',status_input='available','replayed',false,'request_id',request_id_input,
    'provider',provider_input,'capability',capability_input,'status',status_input,
    'outcome',terminal_status_value,'accepted_count',intent.accepted_count,
    'quarantined_count',intent.quarantined_count,'failed_count',
      case when status_input='available' then 0 else greatest(intent.failed_count,1) end,
    'last_success_at',last_success_at_value,'last_success_count',last_success_count_value,
    'circuit_state',circuit_state_value,'retry_after_at',next_probe_value,
    'history_id',history_id_value,'issue',issue_value,'resolved_issue',resolved_issue_value
  );
  update private.market_radar_refresh_intents_v1 set
    status=terminal_status_value,phase='terminal',lease_token=null,lease_owner=null,
    lease_expires_at=null,finalization_hash=finalization_hash_value,
    provider_history_id=history_id_value,issue=issue_value,
    response_summary=response_value,completed_at=now_value,updated_at=now_value
  where request_id=request_id_input and provider=provider_input and capability=capability_input;
  perform private.record_market_radar_refresh_event_v1(
    request_id_input,provider_input,capability_input,
    case when status_input='available' then 'RADAR_REFRESH_COMPLETED' else error_code_input end,
    intent.phase,'terminal',intent.accepted_count,intent.quarantined_count,
    case when status_input='available' then 0 else greatest(intent.failed_count,1) end,
    error_code_input,coalesce(issue_value,resolved_issue_value)
  );
  return response_value;
end;
$function$;

alter function public.finalize_market_radar_refresh_v3(uuid,text,text,uuid,text,text,text,integer)
  owner to postgres;
revoke all on function public.finalize_market_radar_refresh_v3(uuid,text,text,uuid,text,text,text,integer)
  from public,anon,authenticated,service_role;
grant execute on function public.finalize_market_radar_refresh_v3(uuid,text,text,uuid,text,text,text,integer)
  to service_role;

create or replace function public.get_active_market_radar_refresh_v1(
  request_hash_input text,
  cache_key_input text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  actor_id_value uuid:=private.require_current_admin();
  active_request_id uuid;
begin
  if coalesce(request_hash_input,'') !~ '^[0-9a-f]{64}$'
     or nullif(btrim(cache_key_input),'') is null
     or char_length(cache_key_input)>180 then
    raise exception 'RADAR_REFRESH_REQUEST_INVALID' using errcode='22023';
  end if;
  select intent.request_id into active_request_id
  from private.market_radar_refresh_intents_v1 intent
  where intent.actor_id=actor_id_value
    and intent.request_hash=lower(request_hash_input)
    and intent.cache_key=left(cache_key_input,180)
    and intent.status='in_progress'
  order by intent.updated_at desc,intent.request_id
  limit 1;
  if active_request_id is null then
    return jsonb_build_object('active',false,'request_id',null,'providers','[]'::jsonb);
  end if;
  return jsonb_build_object(
    'active',true,
    'request_id',active_request_id,
    'providers',coalesce((
      select jsonb_agg(jsonb_build_object(
        'provider',intent.provider,
        'capability',intent.capability,
        'status',intent.status,
        'phase',intent.phase,
        'lease_expires_at',intent.lease_expires_at
      ) order by intent.provider,intent.capability)
      from private.market_radar_refresh_intents_v1 intent
      where intent.request_id=active_request_id
        and intent.actor_id=actor_id_value
        and intent.request_hash=lower(request_hash_input)
        and intent.cache_key=left(cache_key_input,180)
        and intent.status='in_progress'
    ),'[]'::jsonb)
  );
end;
$function$;

alter function public.get_active_market_radar_refresh_v1(text,text) owner to postgres;
revoke all on function public.get_active_market_radar_refresh_v1(text,text)
  from public,anon,authenticated,service_role;
grant execute on function public.get_active_market_radar_refresh_v1(text,text)
  to authenticated;

create or replace function public.get_market_radar_refresh_status_v1(request_id_input uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  actor_id_value uuid:=private.require_current_admin();
begin
  return coalesce((
    select jsonb_build_object(
      'request_id',request_id_input,'actor_id',actor_id_value,
      'providers',jsonb_agg(jsonb_build_object(
        'provider',intent.provider,'capability',intent.capability,'status',intent.status,
        'phase',intent.phase,'expected_count',intent.expected_count,
        'processed_count',intent.processed_count,'accepted_count',intent.accepted_count,
        'quarantined_count',intent.quarantined_count,'failed_count',intent.failed_count,
        'issue',intent.issue,'response_summary',intent.response_summary,
        'lease_expires_at',case when intent.status='in_progress' then intent.lease_expires_at else null end
      ) order by intent.provider,intent.capability)
    ) from private.market_radar_refresh_intents_v1 intent
    where intent.request_id=request_id_input and intent.actor_id=actor_id_value
  ),jsonb_build_object('request_id',request_id_input,'providers','[]'::jsonb));
end;
$function$;

alter function public.get_market_radar_refresh_status_v1(uuid) owner to postgres;
revoke all on function public.get_market_radar_refresh_status_v1(uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.get_market_radar_refresh_status_v1(uuid) to authenticated;

comment on table private.market_radar_refresh_intents_v1 is
  'Intenciones Radar idempotentes y reanudables por proveedor/capacidad. No contienen secretos ni payloads de proveedor.';
comment on table private.market_radar_refresh_batches_v1 is
  'Lotes saneados privados con cursor durable. Un timeout conserva el lote para retry o split.';
comment on table private.market_radar_provider_circuits_v1 is
  'Circuit breaker por capacidad. half_open solo existe durante un probe con lease exclusiva.';
comment on table private.market_radar_refresh_events_v1 is
  'Eventos append-only sin consultas, HTML, secretos ni payloads externos.';

do $postflight$
declare
  service_functions regprocedure[]:=array[
    'public.renew_market_radar_refresh_lease_v1(uuid,text,text,uuid)'::regprocedure,
    'public.declare_market_radar_refresh_manifest_v1(uuid,text,text,uuid,integer)'::regprocedure,
    'public.stage_market_radar_refresh_batch_v1(uuid,text,text,uuid,integer,jsonb)'::regprocedure,
    'public.seal_market_radar_refresh_v1(uuid,text,text,uuid,integer)'::regprocedure,
    'public.process_market_radar_refresh_batch_v1(uuid,text,text,uuid)'::regprocedure,
    'public.split_market_radar_refresh_batch_v1(uuid,text,text,uuid,uuid)'::regprocedure,
    'public.defer_market_radar_refresh_v1(uuid,text,text,uuid,text)'::regprocedure,
    'public.finalize_market_radar_refresh_v3(uuid,text,text,uuid,text,text,text,integer)'::regprocedure
  ];
  authenticated_functions regprocedure[]:=array[
    'public.claim_market_radar_provider_probe_v1(text,text,uuid)'::regprocedure,
    'public.begin_market_radar_refresh_v2(uuid,text,text,text,text,text,text,uuid,uuid)'::regprocedure,
    'public.get_active_market_radar_refresh_v1(text,text)'::regprocedure,
    'public.get_market_radar_refresh_status_v1(uuid)'::regprocedure
  ];
  procedure_oid regprocedure;
begin
  foreach procedure_oid in array service_functions loop
    if has_function_privilege('anon',procedure_oid,'execute')
       or has_function_privilege('authenticated',procedure_oid,'execute')
       or not has_function_privilege('service_role',procedure_oid,'execute') then
      raise exception 'RADAR_REFRESH_V2_SERVICE_ACL_INVALID' using errcode='55000';
    end if;
  end loop;
  foreach procedure_oid in array authenticated_functions loop
    if has_function_privilege('anon',procedure_oid,'execute')
       or not has_function_privilege('authenticated',procedure_oid,'execute')
       or has_function_privilege('service_role',procedure_oid,'execute') then
      raise exception 'RADAR_REFRESH_V2_ADMIN_ACL_INVALID' using errcode='55000';
    end if;
  end loop;
  if exists(
    select 1 from pg_proc p join pg_roles r on r.oid=p.proowner
    where p.oid=any((service_functions||authenticated_functions)::oid[])
      and (r.rolname<>'postgres' or not p.prosecdef
        or not (p.proconfig@>array['search_path=""']::text[]))
  ) then
    raise exception 'RADAR_REFRESH_V2_SECURITY_INVALID' using errcode='55000';
  end if;
  if exists(
    select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='private' and c.relname in (
      'market_radar_provider_circuits_v1','market_radar_refresh_intents_v1',
      'market_radar_refresh_batches_v1','market_radar_refresh_events_v1'
    ) and (not c.relrowsecurity or not c.relforcerowsecurity)
  ) then
    raise exception 'RADAR_REFRESH_V2_RLS_INVALID' using errcode='55000';
  end if;
end;
$postflight$;

commit;
