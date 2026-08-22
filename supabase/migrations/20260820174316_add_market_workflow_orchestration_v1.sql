begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';

select pg_advisory_xact_lock(hashtextextended('atinara:market-workflow-orchestration-v1', 0));

-- V6 is additive. Existing Registry V2.1 rows and hashes are deliberately
-- untouched: this ledger records occurrences, ownership and transitions.

create table private.market_workflow_issue_occurrences_v1 (
  issue_id uuid primary key,
  contract_version text not null check (contract_version = 'atinara-market-issue-v1'),
  issue_code text not null check (issue_code ~ '^[A-Z][A-Z0-9_]{2,99}$'),
  subject_type text not null check (subject_type in (
    'radar_candidate','expert_run','market_draft','review_attempt','repair_attempt',
    'publication_attempt','provider_refresh','official_opportunity'
  )),
  subject_key text not null check (length(subject_key) between 1 and 240),
  subject_version text not null default '0' check (length(subject_version) between 1 and 120),
  subject_fingerprint text check (subject_fingerprint is null or subject_fingerprint ~ '^[a-f0-9]{64}$'),
  issue_fingerprint text not null check (issue_fingerprint ~ '^[a-f0-9]{64}$'),
  detected_by text not null check (detected_by in (
    'radar','editor','validator','corrector','human_review','publication_gate',
    'provider','internal_platform'
  )),
  owner_stage text not null check (owner_stage in (
    'radar','editor','validator','corrector','human_review','publication_gate',
    'provider','internal_platform'
  )),
  severity text not null check (severity in ('info','warning','blocking')),
  repairability text not null check (repairability in (
    'auto_recoverable','auto_repairable','human_editable',
    'waiting_authoritative_source','non_repairable','terminal'
  )),
  blocking_scope text not null check (blocking_scope in (
    'none','approval','human_confirmation','publication','terminal'
  )),
  status text not null check (status in ('open','in_progress','waiting','resolved','superseded')),
  retryable boolean not null,
  next_action text not null check (next_action ~ '^[a-z][a-z0-9_]{2,99}$'),
  registry_issue_code text,
  registry_version text,
  registry_hash text check (registry_hash is null or registry_hash ~ '^[a-f0-9]{64}$'),
  strategy_key text,
  affected_fields text[] not null default '{}'::text[],
  evidence_refs jsonb not null default '[]'::jsonb,
  current_value jsonb not null default 'null'::jsonb,
  proposed_value jsonb not null default 'null'::jsonb,
  confidence numeric(5,2) not null check (confidence between 0 and 100),
  policy_version text not null,
  issue_payload jsonb not null,
  supersedes_issue_id uuid references private.market_workflow_issue_occurrences_v1(issue_id),
  created_at timestamptz not null,
  updated_at timestamptz not null,
  resolved_at timestamptz,
  resolution_method text,
  inserted_at timestamptz not null default clock_timestamp()
);

create index market_workflow_issue_subject_active_v1_idx
  on private.market_workflow_issue_occurrences_v1(subject_type,subject_key,status,owner_stage,created_at desc);
create table private.market_workflow_issue_events_v1 (
  id bigint generated always as identity primary key,
  issue_id uuid not null references private.market_workflow_issue_occurrences_v1(issue_id),
  event_type text not null check (event_type in ('opened','in_progress','waiting','resolved','superseded')),
  previous_status text,
  new_status text not null check (new_status in ('open','in_progress','waiting','resolved','superseded')),
  actor_id uuid,
  owner_stage text not null,
  next_action text not null,
  resolution_method text,
  evidence_refs jsonb not null default '[]'::jsonb,
  occurred_at timestamptz not null default clock_timestamp()
);
create index market_workflow_issue_events_issue_v1_idx
  on private.market_workflow_issue_events_v1(issue_id,occurred_at,id);

create table private.market_workflow_issue_subject_links_v1 (
  issue_id uuid not null references private.market_workflow_issue_occurrences_v1(issue_id),
  subject_type text not null check (subject_type in (
    'radar_candidate','expert_run','market_draft','review_attempt','repair_attempt',
    'publication_attempt','provider_refresh','official_opportunity'
  )),
  subject_key text not null check (length(subject_key) between 1 and 240),
  subject_version text not null check (length(subject_version) between 1 and 120),
  subject_fingerprint text check (subject_fingerprint is null or subject_fingerprint ~ '^[a-f0-9]{64}$'),
  linked_at timestamptz not null default clock_timestamp(),
  primary key(issue_id,subject_type,subject_key,subject_version)
);
create index market_workflow_issue_links_subject_v1_idx
  on private.market_workflow_issue_subject_links_v1(subject_type,subject_key,subject_version,linked_at,issue_id);

create table private.market_radar_temporal_contracts_v1 (
  id bigint generated always as identity primary key,
  candidate_id uuid not null references private.external_market_candidates(id),
  contract_version text not null check (contract_version = 'atinara-temporal-contract-v1'),
  decision_hash text not null check (decision_hash ~ '^[a-f0-9]{64}$'),
  temporal_contract jsonb not null,
  created_at timestamptz not null default clock_timestamp(),
  unique (candidate_id,decision_hash)
);

create table private.market_radar_domain_reviews_v1 (
  request_id uuid primary key,
  candidate_id uuid not null references private.external_market_candidates(id),
  candidate_revision bigint not null check (candidate_revision>=0),
  candidate_fingerprint text not null check (candidate_fingerprint~'^[a-f0-9]{64}$'),
  domain_fingerprint text not null check (domain_fingerprint~'^[a-f0-9]{64}$'),
  policy_version text not null check (policy_version='atinara-gaming-domain-v1'),
  decision text not null check (decision in ('in_domain','out_of_domain')),
  rationale text not null check (length(rationale) between 20 and 1000),
  evidence_refs jsonb not null default '[]'::jsonb check (
    jsonb_typeof(evidence_refs)='array' and jsonb_array_length(evidence_refs)<=8
  ),
  actor_id uuid not null,
  request_hash text not null check (request_hash~'^[a-f0-9]{64}$'),
  supersedes_request_id uuid references private.market_radar_domain_reviews_v1(request_id),
  created_at timestamptz not null default clock_timestamp(),
  check (supersedes_request_id is null or supersedes_request_id<>request_id)
);
create index market_radar_domain_reviews_scope_v1_idx
  on private.market_radar_domain_reviews_v1(
    candidate_id,domain_fingerprint,policy_version,created_at desc,request_id desc
  );

alter table private.external_market_candidates
  add column current_temporal_contract_id bigint
    references private.market_radar_temporal_contracts_v1(id);

alter table private.market_effective_reviews
  add column source_check_id uuid references private.market_draft_primary_source_checks(id),
  add column source_evidence_fingerprint text
    check (source_evidence_fingerprint is null or source_evidence_fingerprint~'^[a-f0-9]{64}$');

alter table private.market_drafts
  add column artifact_status text,
  add column workflow_owner_stage text,
  add column workflow_next_action text,
  add column workflow_issue_count integer,
  add column publication_schedule_status text,
  add column publication_next_retry_at timestamptz;

alter table private.market_drafts
  add constraint market_drafts_artifact_status_v1_check check (
    artifact_status is null or artifact_status in (
      'draft_incomplete','draft_ready_for_validation','draft_with_repairable_issues',
      'draft_waiting_authoritative_source','draft_human_edit_required',
      'review_pending','review_in_progress','review_rejected_repairable',
      'review_rejected_terminal','review_inconclusive','review_unavailable','review_approved',
      'repair_pending','repair_in_progress','repair_applied','repair_waiting_source',
      'repair_human_decision_required','repair_not_supported','repair_failed_technical',
      'human_confirmed','publication_revalidation_required','publication_blocked_recoverable',
      'scheduled','published','publication_failed_terminal'
    )
  ),
  add constraint market_drafts_workflow_owner_v1_check check (
    workflow_owner_stage is null or workflow_owner_stage in (
      'radar','editor','validator','corrector','human_review','publication_gate',
      'provider','internal_platform'
    )
  ),
  add constraint market_drafts_workflow_action_v1_check check (
    workflow_next_action is null or workflow_next_action ~ '^[a-z][a-z0-9_]{2,99}$'
  ),
  add constraint market_drafts_workflow_issue_count_v1_check check (
    workflow_issue_count is null or workflow_issue_count between 0 and 100
  ),
  add constraint market_drafts_publication_schedule_status_v1_check check (
    publication_schedule_status is null or publication_schedule_status in (
      'scheduled_waiting','scheduled_retry','scheduled_blocked_recoverable',
      'scheduled_published','scheduled_cancelled','scheduled_failed_terminal'
    )
  );

alter table private.market_workflow_issue_occurrences_v1 enable row level security;
alter table private.market_workflow_issue_occurrences_v1 force row level security;
alter table private.market_workflow_issue_events_v1 enable row level security;
alter table private.market_workflow_issue_events_v1 force row level security;
alter table private.market_workflow_issue_subject_links_v1 enable row level security;
alter table private.market_workflow_issue_subject_links_v1 force row level security;
alter table private.market_radar_temporal_contracts_v1 enable row level security;
alter table private.market_radar_temporal_contracts_v1 force row level security;
alter table private.market_radar_domain_reviews_v1 enable row level security;
alter table private.market_radar_domain_reviews_v1 force row level security;

revoke all on table private.market_workflow_issue_occurrences_v1,
  private.market_workflow_issue_events_v1,
  private.market_workflow_issue_subject_links_v1,
  private.market_radar_temporal_contracts_v1,
  private.market_radar_domain_reviews_v1
  from public,anon,authenticated,service_role;
revoke all on sequence private.market_workflow_issue_events_v1_id_seq,
  private.market_radar_temporal_contracts_v1_id_seq
  from public,anon,authenticated,service_role;

create or replace function private.reject_market_workflow_append_only_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  raise exception 'MARKET_WORKFLOW_LEDGER_APPEND_ONLY' using errcode='55000';
end;
$function$;
revoke all on function private.reject_market_workflow_append_only_v1()
  from public,anon,authenticated,service_role;

create trigger market_workflow_issue_occurrences_append_only_v1
before update or delete on private.market_workflow_issue_occurrences_v1
for each row execute function private.reject_market_workflow_append_only_v1();
create trigger market_workflow_issue_events_append_only_v1
before update or delete on private.market_workflow_issue_events_v1
for each row execute function private.reject_market_workflow_append_only_v1();
create trigger market_workflow_issue_subject_links_append_only_v1
before update or delete on private.market_workflow_issue_subject_links_v1
for each row execute function private.reject_market_workflow_append_only_v1();
create trigger market_radar_temporal_contracts_append_only_v1
before update or delete on private.market_radar_temporal_contracts_v1
for each row execute function private.reject_market_workflow_append_only_v1();
create trigger market_radar_domain_reviews_append_only_v1
before update or delete on private.market_radar_domain_reviews_v1
for each row execute function private.reject_market_workflow_append_only_v1();

create or replace function private.record_market_workflow_issue_v1(
  subject_type_input text,
  subject_key_input text,
  subject_version_input text,
  subject_fingerprint_input text,
  issue_input jsonb,
  registry_issue_code_input text default null,
  strategy_key_input text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  issue_id_value uuid;
  existing_id uuid;
  active_id uuid;
  active_fingerprint text;
  active_status text;
  current_registry jsonb;
  strategy private.market_repair_strategy_registry%rowtype;
  issue_code_value text;
  affected_fields_value text[];
begin
  if subject_type_input not in (
    'radar_candidate','expert_run','market_draft','review_attempt','repair_attempt',
    'publication_attempt','provider_refresh','official_opportunity'
  ) or nullif(btrim(subject_key_input),'') is null
     or length(subject_key_input)>240
     or nullif(btrim(subject_version_input),'') is null
     or length(subject_version_input)>120
     or (subject_fingerprint_input is not null and subject_fingerprint_input !~ '^[a-f0-9]{64}$') then
    raise exception 'MARKET_WORKFLOW_SUBJECT_INVALID' using errcode='22023';
  end if;
  perform private.assert_market_workflow_issue_v1(issue_input);
  issue_id_value:=(issue_input ->> 'issue_id')::uuid;
  issue_code_value:=issue_input ->> 'issue_code';
  if subject_type_input='market_draft' then
    perform pg_advisory_xact_lock(hashtextextended('market-draft-workflow:'||subject_key_input,0));
  end if;
  perform pg_advisory_xact_lock(hashtextextended(concat_ws('|',
    issue_input ->> 'schema_version',issue_code_value,subject_type_input,
    subject_key_input,subject_version_input
  ),0));
  select occurrence.issue_id into existing_id
  from private.market_workflow_issue_occurrences_v1 occurrence
  where occurrence.issue_id=issue_id_value;
  if existing_id is not null then
    if not exists (
      select 1 from private.market_workflow_issue_occurrences_v1 occurrence
      where occurrence.issue_id=issue_id_value
        and occurrence.issue_fingerprint=issue_input ->> 'fingerprint'
        and occurrence.issue_code=issue_code_value
        and occurrence.contract_version=issue_input ->> 'schema_version'
    ) then
      raise exception 'MARKET_WORKFLOW_ISSUE_ID_REUSED' using errcode='40001';
    end if;
    insert into private.market_workflow_issue_subject_links_v1(
      issue_id,subject_type,subject_key,subject_version,subject_fingerprint
    ) values (issue_id_value,subject_type_input,subject_key_input,subject_version_input,
      subject_fingerprint_input) on conflict do nothing;
    if exists (
      select 1 from private.market_workflow_issue_subject_links_v1 link
      where link.issue_id=issue_id_value and link.subject_type=subject_type_input
        and link.subject_key=subject_key_input and link.subject_version=subject_version_input
        and link.subject_fingerprint is distinct from subject_fingerprint_input
    ) then raise exception 'MARKET_WORKFLOW_SUBJECT_FINGERPRINT_CONFLICT' using errcode='40001'; end if;
    return issue_id_value;
  end if;
  select coalesce(array_agg(value order by ordinality),'{}'::text[])
  into affected_fields_value
  from jsonb_array_elements_text(issue_input -> 'affected_fields') with ordinality;

  if issue_input ->> 'repairability' = 'auto_repairable' then
    if nullif(registry_issue_code_input,'') is null or nullif(strategy_key_input,'') is null then
      raise exception 'MARKET_WORKFLOW_REPAIR_BINDING_REQUIRED' using errcode='55000';
    end if;
    select public.get_market_agent_registry_v2() into current_registry;
    select strategy_row.* into strategy
    from private.market_repair_strategy_registry strategy_row
    join private.market_issue_strategy_bindings binding
      on binding.strategy_key=strategy_row.strategy_key and binding.active
    where binding.issue_code=registry_issue_code_input
      and strategy_row.strategy_key=strategy_key_input
      and strategy_row.active and strategy_row.can_write;
    if not found
       or exists (
         select 1 from unnest(affected_fields_value) affected
         where not (affected=any(strategy.write_fields))
       ) then
      raise exception 'MARKET_WORKFLOW_REPAIR_BINDING_INVALID' using errcode='55000';
    end if;
  else
    current_registry:=null;
  end if;

  select occurrence.issue_id,occurrence.issue_fingerprint,coalesce(latest.new_status,'open')
  into active_id,active_fingerprint,active_status
  from private.market_workflow_issue_occurrences_v1 occurrence
  join private.market_workflow_issue_subject_links_v1 link
    on link.issue_id=occurrence.issue_id
  left join lateral (
    select event.new_status from private.market_workflow_issue_events_v1 event
    where event.issue_id=occurrence.issue_id
    order by event.occurred_at desc,event.id desc limit 1
  ) latest on true
  where occurrence.contract_version=issue_input ->> 'schema_version'
    and occurrence.issue_code=issue_code_value
    and link.subject_type=subject_type_input
    and link.subject_key=subject_key_input
    and link.subject_version=subject_version_input
    and coalesce(latest.new_status,'open') not in ('resolved','superseded')
  order by occurrence.created_at desc limit 1;
  if active_id is not null and active_fingerprint=issue_input ->> 'fingerprint' then
    insert into private.market_workflow_issue_subject_links_v1(
      issue_id,subject_type,subject_key,subject_version,subject_fingerprint
    ) values (active_id,subject_type_input,subject_key_input,subject_version_input,
      subject_fingerprint_input) on conflict do nothing;
    if exists (
      select 1 from private.market_workflow_issue_subject_links_v1 link
      where link.issue_id=active_id and link.subject_type=subject_type_input
        and link.subject_key=subject_key_input and link.subject_version=subject_version_input
        and link.subject_fingerprint is distinct from subject_fingerprint_input
    ) then raise exception 'MARKET_WORKFLOW_SUBJECT_FINGERPRINT_CONFLICT' using errcode='40001'; end if;
    return active_id;
  end if;

  insert into private.market_workflow_issue_occurrences_v1(
    issue_id,contract_version,issue_code,subject_type,subject_key,subject_version,
    subject_fingerprint,issue_fingerprint,detected_by,owner_stage,severity,
    repairability,blocking_scope,status,retryable,next_action,registry_issue_code,
    registry_version,registry_hash,strategy_key,affected_fields,evidence_refs,
    current_value,proposed_value,confidence,policy_version,issue_payload,
    supersedes_issue_id,created_at,updated_at,resolved_at,resolution_method
  ) values (
    issue_id_value,issue_input ->> 'schema_version',issue_code_value,subject_type_input,
    subject_key_input,subject_version_input,subject_fingerprint_input,
    issue_input ->> 'fingerprint',issue_input ->> 'detected_by',issue_input ->> 'owner_stage',
    issue_input ->> 'severity',issue_input ->> 'repairability',
    issue_input ->> 'blocking_scope',issue_input ->> 'status',
    (issue_input ->> 'retryable')::boolean,issue_input ->> 'next_action',
    registry_issue_code_input,current_registry ->> 'version',current_registry ->> 'hash',
    strategy_key_input,affected_fields_value,issue_input -> 'evidence_refs',
    issue_input -> 'current_value',issue_input -> 'proposed_value',
    (issue_input ->> 'confidence')::numeric,issue_input ->> 'policy_version',issue_input,
    active_id,(issue_input ->> 'created_at')::timestamptz,(issue_input ->> 'updated_at')::timestamptz,
    nullif(issue_input ->> 'resolved_at','')::timestamptz,
    nullif(issue_input ->> 'resolution_method','')
  ) returning issue_id into existing_id;
  insert into private.market_workflow_issue_subject_links_v1(
    issue_id,subject_type,subject_key,subject_version,subject_fingerprint
  ) values (existing_id,subject_type_input,subject_key_input,subject_version_input,
    subject_fingerprint_input) on conflict do nothing;
  if exists (
    select 1 from private.market_workflow_issue_subject_links_v1 link
    where link.issue_id=existing_id and link.subject_type=subject_type_input
      and link.subject_key=subject_key_input and link.subject_version=subject_version_input
      and link.subject_fingerprint is distinct from subject_fingerprint_input
  ) then raise exception 'MARKET_WORKFLOW_SUBJECT_FINGERPRINT_CONFLICT' using errcode='40001'; end if;
  insert into private.market_workflow_issue_events_v1(
    issue_id,event_type,previous_status,new_status,owner_stage,next_action,evidence_refs,occurred_at
  ) values (
    existing_id,'opened',null,'open',issue_input ->> 'owner_stage',
    issue_input ->> 'next_action',issue_input -> 'evidence_refs',
    (issue_input ->> 'created_at')::timestamptz
  );
  if active_id is not null then
    insert into private.market_workflow_issue_events_v1(
      issue_id,event_type,previous_status,new_status,owner_stage,next_action,
      resolution_method,evidence_refs,occurred_at
    ) values (
      active_id,'superseded',active_status,'superseded',issue_input ->> 'owner_stage',
      issue_input ->> 'next_action','superseded_by_new_fingerprint',
      jsonb_build_array(jsonb_build_object('superseded_by',existing_id)),clock_timestamp()
    );
  end if;
  return existing_id;
end;
$function$;
revoke all on function private.record_market_workflow_issue_v1(text,text,text,text,jsonb,text,text)
  from public,anon,authenticated,service_role;

create or replace function private.link_market_workflow_issue_subject_v1(
  issue_id_input uuid,
  subject_type_input text,
  subject_key_input text,
  subject_version_input text,
  subject_fingerprint_input text
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if issue_id_input is null
     or subject_type_input not in (
       'radar_candidate','expert_run','market_draft','review_attempt','repair_attempt',
       'publication_attempt','provider_refresh','official_opportunity'
     )
     or nullif(btrim(subject_key_input),'') is null or length(subject_key_input)>240
     or nullif(btrim(subject_version_input),'') is null or length(subject_version_input)>120
     or (subject_fingerprint_input is not null
       and subject_fingerprint_input !~ '^[a-f0-9]{64}$') then
    raise exception 'MARKET_WORKFLOW_SUBJECT_INVALID' using errcode='22023';
  end if;
  insert into private.market_workflow_issue_subject_links_v1(
    issue_id,subject_type,subject_key,subject_version,subject_fingerprint
  ) values (
    issue_id_input,subject_type_input,subject_key_input,subject_version_input,
    subject_fingerprint_input
  ) on conflict do nothing;
  if not exists (
    select 1 from private.market_workflow_issue_subject_links_v1 link
    where link.issue_id=issue_id_input and link.subject_type=subject_type_input
      and link.subject_key=subject_key_input and link.subject_version=subject_version_input
      and link.subject_fingerprint is not distinct from subject_fingerprint_input
  ) then
    raise exception 'MARKET_WORKFLOW_SUBJECT_FINGERPRINT_CONFLICT' using errcode='40001';
  end if;
end;
$function$;
revoke all on function private.link_market_workflow_issue_subject_v1(uuid,text,text,text,text)
  from public,anon,authenticated,service_role;

create or replace function private.capture_market_radar_provider_workflow_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  issue_id_value uuid;
  latest_status_value text;
begin
  if new.issue is null or jsonb_typeof(new.issue) is distinct from 'object' then return null; end if;
  issue_id_value:=private.record_market_workflow_issue_v1(
    'provider_refresh',new.request_id::text,
    left(new.provider||':'||new.capability,120),new.issue ->> 'fingerprint',
    new.issue,null,null
  );
  if new.issue ->> 'status'='resolved' then
    perform pg_advisory_xact_lock(hashtextextended(issue_id_value::text,0));
    select coalesce(latest.new_status,'open') into latest_status_value
    from private.market_workflow_issue_occurrences_v1 occurrence
    left join lateral (
      select event.new_status,event.owner_stage,event.next_action
      from private.market_workflow_issue_events_v1 event
      where event.issue_id=occurrence.issue_id
      order by event.occurred_at desc,event.id desc limit 1
    ) latest on true where occurrence.issue_id=issue_id_value;
    if latest_status_value not in ('resolved','superseded') then
      insert into private.market_workflow_issue_events_v1(
        issue_id,event_type,previous_status,new_status,owner_stage,next_action,
        resolution_method,evidence_refs,occurred_at
      ) values (
        issue_id_value,'resolved',latest_status_value,'resolved',
        coalesce(new.issue ->> 'owner_stage','provider'),
        coalesce(new.issue ->> 'next_action','retry_provider_refresh'),
        coalesce(new.issue ->> 'resolution_method','automatic_resume'),
        jsonb_build_array(jsonb_build_object(
          'refresh_request_id',new.request_id,'refresh_event_id',new.id,
          'provider',new.provider,'capability',new.capability
        )),new.created_at
      );
    end if;
  end if;
  return null;
end;
$function$;
revoke all on function private.capture_market_radar_provider_workflow_v1()
  from public,anon,authenticated,service_role;
create trigger capture_market_radar_provider_workflow_v1
after insert on private.market_radar_refresh_events_v1
for each row execute function private.capture_market_radar_provider_workflow_v1();

create or replace function public.attach_market_workflow_issues_v1(
  subject_type_input text,
  subject_key_input text,
  subject_version_input text,
  subject_fingerprint_input text,
  issues_input jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  issue_value jsonb;
  ids jsonb:='[]'::jsonb;
  issue_id_value uuid;
  first_issue jsonb;
begin
  if auth.role()<>'service_role' then
    raise exception 'SERVICE_ROLE_REQUIRED' using errcode='42501';
  end if;
  if jsonb_typeof(issues_input)<>'array' or jsonb_array_length(issues_input)>40 then
    raise exception 'MARKET_WORKFLOW_ISSUES_INVALID' using errcode='22023';
  end if;
  for issue_value in select value from jsonb_array_elements(issues_input)
  loop
    if first_issue is null or (
      (issue_value ->> 'repairability'='terminal' or issue_value ->> 'blocking_scope'='terminal')
      and first_issue ->> 'repairability'<>'terminal'
      and first_issue ->> 'blocking_scope'<>'terminal'
    ) then first_issue:=issue_value; end if;
    issue_id_value:=private.record_market_workflow_issue_v1(
      subject_type_input,subject_key_input,subject_version_input,
      subject_fingerprint_input,issue_value,null,null
    );
    ids:=ids||jsonb_build_array(issue_id_value);
  end loop;
  if subject_type_input='market_draft' and jsonb_array_length(ids)>0 then
    update private.market_drafts set
      artifact_status=case when first_issue ->> 'repairability'='terminal'
          or first_issue ->> 'blocking_scope'='terminal' then 'review_rejected_terminal'
        when first_issue ->> 'repairability'='waiting_authoritative_source'
        then 'draft_waiting_authoritative_source' else 'review_rejected_repairable' end,
      workflow_owner_stage=first_issue ->> 'owner_stage',
      workflow_next_action=first_issue ->> 'next_action',
      workflow_issue_count=jsonb_array_length(ids)
    where id::text=subject_key_input and content_version::text=subject_version_input;
  end if;
  return jsonb_build_object('ok',true,'issue_ids',ids,'issue_count',jsonb_array_length(ids));
end;
$function$;
revoke all on function public.attach_market_workflow_issues_v1(text,text,text,text,jsonb)
  from public,anon,authenticated,service_role;
grant execute on function public.attach_market_workflow_issues_v1(text,text,text,text,jsonb)
  to service_role;

create or replace function public.attach_market_review_workflow_issues_v1(
  draft_id_input uuid,
  draft_version_input bigint,
  review_attempt_id_input uuid,
  issues_input jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  attempt private.market_review_attempts%rowtype;
  issue_value jsonb;
  issue_id_value uuid;
  authoritative_issues jsonb:='[]'::jsonb;
  first_issue jsonb;
begin
  if auth.role()<>'service_role' then
    raise exception 'SERVICE_ROLE_REQUIRED' using errcode='42501';
  end if;
  if jsonb_typeof(issues_input)<>'array' or jsonb_array_length(issues_input)>40 then
    raise exception 'MARKET_WORKFLOW_ISSUES_INVALID' using errcode='22023';
  end if;
  select * into attempt from private.market_review_attempts
  where id=review_attempt_id_input for update;
  if not found or attempt.draft_id is distinct from draft_id_input
     or attempt.draft_version is distinct from draft_version_input then
    raise exception 'MARKET_REVIEW_ATTEMPT_SCOPE_INVALID' using errcode='40001';
  end if;
  for issue_value in select value from jsonb_array_elements(issues_input)
  loop
    issue_id_value:=private.record_market_workflow_issue_v1(
      'market_draft',draft_id_input::text,draft_version_input::text,
      attempt.content_fingerprint,issue_value,null,null
    );
    issue_value:=jsonb_set(issue_value,'{issue_id}',to_jsonb(issue_id_value),true);
    if first_issue is null or (
      (issue_value ->> 'repairability'='terminal' or issue_value ->> 'blocking_scope'='terminal')
      and first_issue ->> 'repairability'<>'terminal'
      and first_issue ->> 'blocking_scope'<>'terminal'
    ) then first_issue:=issue_value; end if;
    authoritative_issues:=authoritative_issues||jsonb_build_array(issue_value);
    perform private.link_market_workflow_issue_subject_v1(
      issue_id_value,'review_attempt',attempt.id::text,draft_version_input::text,
      attempt.content_fingerprint
    );
  end loop;
  select coalesce(jsonb_agg(value order by value ->> 'created_at',value ->> 'issue_id'),'[]'::jsonb)
    into authoritative_issues
  from jsonb_array_elements(public.get_market_workflow_issues_v1(
    'market_draft',draft_id_input::text,draft_version_input::text
  )) value
  where value ->> 'status' not in ('resolved','superseded');
  first_issue:=null;
  for issue_value in select value from jsonb_array_elements(authoritative_issues)
  loop
    issue_id_value:=(issue_value ->> 'issue_id')::uuid;
    perform private.link_market_workflow_issue_subject_v1(
      issue_id_value,'review_attempt',attempt.id::text,draft_version_input::text,
      attempt.content_fingerprint
    );
    if first_issue is null or (
      (issue_value ->> 'repairability'='terminal' or issue_value ->> 'blocking_scope'='terminal')
      and first_issue ->> 'repairability'<>'terminal'
      and first_issue ->> 'blocking_scope'<>'terminal'
    ) then first_issue:=issue_value; end if;
  end loop;
  if first_issue is not null then
    update private.market_drafts set
      artifact_status=case when first_issue ->> 'repairability'='terminal'
          or first_issue ->> 'blocking_scope'='terminal' then 'review_rejected_terminal'
        when first_issue ->> 'repairability'='waiting_authoritative_source'
        then 'draft_waiting_authoritative_source' else 'review_rejected_repairable' end,
      workflow_owner_stage=first_issue ->> 'owner_stage',
      workflow_next_action=first_issue ->> 'next_action',
      workflow_issue_count=jsonb_array_length(authoritative_issues)
    where id=draft_id_input and content_version=draft_version_input
      and content_fingerprint=attempt.content_fingerprint;
    if not found then raise exception 'DRAFT_VERSION_MOVED' using errcode='40001'; end if;
  end if;
  return jsonb_build_object('ok',true,'attempt_id',attempt.id,
    'workflow_issues',authoritative_issues,
    'workflow_issue_ids',(select coalesce(jsonb_agg(value ->> 'issue_id'),'[]'::jsonb)
      from jsonb_array_elements(authoritative_issues) value),
    'issue_count',jsonb_array_length(authoritative_issues));
end;
$function$;
revoke all on function public.attach_market_review_workflow_issues_v1(uuid,bigint,uuid,jsonb)
  from public,anon,authenticated,service_role;
grant execute on function public.attach_market_review_workflow_issues_v1(uuid,bigint,uuid,jsonb)
  to service_role;

create or replace function public.transition_market_workflow_issue_v1(
  issue_id_input uuid,
  expected_status_input text,
  new_status_input text,
  owner_stage_input text,
  next_action_input text,
  resolution_method_input text default null,
  evidence_refs_input jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  issue private.market_workflow_issue_occurrences_v1%rowtype;
  latest_status text;
  actor uuid;
  terminal_transition boolean;
begin
  if auth.role()<>'service_role' then
    raise exception 'SERVICE_ROLE_REQUIRED' using errcode='42501';
  end if;
  actor:=null;
  select * into issue from private.market_workflow_issue_occurrences_v1
  where issue_id=issue_id_input;
  if not found then raise exception 'MARKET_WORKFLOW_ISSUE_NOT_FOUND' using errcode='P0001'; end if;
  perform pg_advisory_xact_lock(hashtextextended(issue_id_input::text,0));
  select event.new_status into latest_status
  from private.market_workflow_issue_events_v1 event
  where event.issue_id=issue_id_input order by event.occurred_at desc,event.id desc limit 1;
  if latest_status is distinct from expected_status_input then
    raise exception 'MARKET_WORKFLOW_ISSUE_STALE' using errcode='40001';
  end if;
  if new_status_input not in ('in_progress','waiting','resolved','superseded')
     or latest_status in ('resolved','superseded')
     or owner_stage_input not in (
       'radar','editor','validator','corrector','human_review','publication_gate',
       'provider','internal_platform'
     )
     or next_action_input !~ '^[a-z][a-z0-9_]{2,99}$'
     or jsonb_typeof(evidence_refs_input)<>'array'
     or jsonb_array_length(evidence_refs_input)>32 then
    raise exception 'MARKET_WORKFLOW_TRANSITION_INVALID' using errcode='22023';
  end if;
  terminal_transition:=new_status_input in ('resolved','superseded');
  if terminal_transition and nullif(btrim(resolution_method_input),'') is null then
    raise exception 'MARKET_WORKFLOW_RESOLUTION_METHOD_REQUIRED' using errcode='22023';
  end if;
  insert into private.market_workflow_issue_events_v1(
    issue_id,event_type,previous_status,new_status,actor_id,owner_stage,next_action,
    resolution_method,evidence_refs
  ) values (
    issue_id_input,new_status_input,latest_status,new_status_input,actor,owner_stage_input,
    next_action_input,resolution_method_input,evidence_refs_input
  );
  return jsonb_build_object('ok',true,'issue_id',issue_id_input,'status',new_status_input,
    'owner_stage',owner_stage_input,'next_action',next_action_input,
    'resolved_at',case when terminal_transition then clock_timestamp() else null end);
end;
$function$;
revoke all on function public.transition_market_workflow_issue_v1(uuid,text,text,text,text,text,jsonb)
  from public,anon,authenticated,service_role;
grant execute on function public.transition_market_workflow_issue_v1(uuid,text,text,text,text,text,jsonb)
  to service_role;

create or replace function public.get_market_workflow_issues_v1(
  subject_type_input text,
  subject_key_input text,
  subject_version_input text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare result jsonb;
begin
  if auth.role()<>'service_role' then perform private.require_current_admin(); end if;
  select coalesce(jsonb_agg(
    occurrence.issue_payload || jsonb_build_object(
      'status',coalesce(latest.new_status,'open'),
      'owner_stage',coalesce(latest.owner_stage,occurrence.owner_stage),
      'next_action',coalesce(latest.next_action,occurrence.next_action),
      'updated_at',coalesce(latest.occurred_at,occurrence.updated_at),
      'resolved_at',case when latest.new_status in ('resolved','superseded') then latest.occurred_at else null end,
      'resolution_method',latest.resolution_method
    ) order by occurrence.created_at,occurrence.issue_id
  ),'[]'::jsonb) into result
  from private.market_workflow_issue_occurrences_v1 occurrence
  join private.market_workflow_issue_subject_links_v1 link on link.issue_id=occurrence.issue_id
  left join lateral (
    select event.new_status,event.owner_stage,event.next_action,event.occurred_at,event.resolution_method
    from private.market_workflow_issue_events_v1 event
    where event.issue_id=occurrence.issue_id
    order by event.occurred_at desc,event.id desc limit 1
  ) latest on true
  where link.subject_type=subject_type_input
    and link.subject_key=subject_key_input
    and (subject_version_input is null or link.subject_version=subject_version_input);
  return result;
end;
$function$;
revoke all on function public.get_market_workflow_issues_v1(text,text,text)
  from public,anon,authenticated,service_role;
grant execute on function public.get_market_workflow_issues_v1(text,text,text)
  to authenticated,service_role;

create or replace function public.get_market_radar_domain_reviews_v1(fingerprints_input jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare result jsonb;
begin
  if auth.role()<>'service_role' then
    raise exception 'SERVICE_ROLE_REQUIRED' using errcode='42501';
  end if;
  if jsonb_typeof(fingerprints_input)<>'array' or jsonb_array_length(fingerprints_input)>240
     or exists (select 1 from jsonb_array_elements(fingerprints_input) value
       where jsonb_typeof(value)<>'object'
         or (select array_agg(key order by key) from jsonb_object_keys(value) key)
            is distinct from array['domain_fingerprint','external_id','provider']::text[]
         or value ->> 'provider' not in ('polymarket','kalshi')
         or length(coalesce(value ->> 'external_id','')) not between 1 and 220
         or value ->> 'domain_fingerprint' !~ '^[a-f0-9]{64}$') then
    raise exception 'RADAR_DOMAIN_REVIEW_QUERY_INVALID' using errcode='22023';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'request_id',review.request_id,'candidate_id',review.candidate_id,
    'candidate_revision',review.candidate_revision,
    'candidate_fingerprint',review.candidate_fingerprint,
    'domain_fingerprint',review.domain_fingerprint,
    'provider',review.provider,'external_id',review.external_id,
    'policy_version',review.policy_version,'decision',review.decision,
    'rationale',review.rationale,'evidence_refs',review.evidence_refs,
    'supersedes_request_id',review.supersedes_request_id,'created_at',review.created_at
  ) order by review.candidate_fingerprint),'[]'::jsonb) into result
  from (
    select distinct on (candidate.provider,candidate.external_id,domain_review.domain_fingerprint)
      domain_review.*,candidate.provider,candidate.external_id
    from private.market_radar_domain_reviews_v1 domain_review
    join private.external_market_candidates candidate on candidate.id=domain_review.candidate_id
    where domain_review.policy_version='atinara-gaming-domain-v1' and exists (
      select 1 from jsonb_array_elements(fingerprints_input) scope
      where scope ->> 'provider'=candidate.provider
        and scope ->> 'external_id'=candidate.external_id
        and scope ->> 'domain_fingerprint'=domain_review.domain_fingerprint
    )
    order by candidate.provider,candidate.external_id,domain_review.domain_fingerprint,
      domain_review.created_at desc,
      domain_review.request_id desc
  ) review;
  return result;
end;
$function$;
revoke all on function public.get_market_radar_domain_reviews_v1(jsonb)
  from public,anon,authenticated,service_role;
grant execute on function public.get_market_radar_domain_reviews_v1(jsonb) to service_role;

create or replace function public.review_market_radar_domain_v1(
  candidate_id_input uuid,
  expected_revision_input bigint,
  expected_fingerprint_input text,
  decision_input text,
  rationale_input text,
  evidence_refs_input jsonb,
  request_id_input uuid,
  supersedes_request_id_input uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor_id_value uuid:=private.require_current_admin();
  candidate private.external_market_candidates%rowtype;
  existing private.market_radar_domain_reviews_v1%rowtype;
  previous_review private.market_radar_domain_reviews_v1%rowtype;
  inserted private.market_radar_domain_reviews_v1%rowtype;
  issue_id_value uuid;
  issue_status_value text;
  remaining_issues jsonb;
  terminal_issue jsonb;
  previous_terminal_issue_id uuid;
  previous_terminal_status text;
  request_hash_value text;
  decision_checked_at timestamptz;
  decision_expires_at timestamptz;
  decision_reason_code text;
  decision_reason text;
  domain_fingerprint_value text;
begin
  if request_id_input is null or expected_revision_input<0
     or coalesce(expected_fingerprint_input,'')!~'^[a-f0-9]{64}$'
     or decision_input not in ('in_domain','out_of_domain')
     or length(btrim(coalesce(rationale_input,''))) not between 20 and 1000
     or btrim(rationale_input)~'[<>]'
     or btrim(rationale_input)~*'(bearer[[:space:]]|api[_ -]?key|secret|password|token[[:space:]]*[:=]|https?://|[[:alnum:]._%+-]+@[[:alnum:].-]+[.][[:alpha:]]{2,})'
     or jsonb_typeof(evidence_refs_input)<>'array' or jsonb_array_length(evidence_refs_input)>8
     or (decision_input='out_of_domain' and jsonb_array_length(evidence_refs_input)=0)
     or exists (select 1 from jsonb_array_elements(evidence_refs_input) reference
       where jsonb_typeof(reference)<>'object'
         or (select array_agg(key order by key) from jsonb_object_keys(reference) key)
           is distinct from array['role','url']::text[]
         or jsonb_typeof(reference -> 'url')<>'string'
         or jsonb_typeof(reference -> 'role')<>'string'
         or length(reference ->> 'url')>2048
         or reference ->> 'url' !~ '^https://[A-Za-z0-9.-]+(?:/|$)'
         or lower(split_part(split_part(reference ->> 'url','://',2),'/',1)) in ('localhost','0.0.0.0')
         or lower(split_part(split_part(reference ->> 'url','://',2),'/',1))~
           '^(127[.]|10[.]|192[.]168[.]|172[.](1[6-9]|2[0-9]|3[01])[.])'
         or reference ->> 'role' not in ('DOMAIN_CONTEXT','PRIMARY_RESOLUTION','CORROBORATION')) then
    raise exception 'RADAR_DOMAIN_REVIEW_INVALID' using errcode='22023';
  end if;
  request_hash_value:=encode(extensions.digest(convert_to(jsonb_build_array(
    candidate_id_input,expected_revision_input,expected_fingerprint_input,decision_input,
    btrim(rationale_input),evidence_refs_input,'atinara-gaming-domain-v1',actor_id_value,
    supersedes_request_id_input
  )::text,'UTF8'),'sha256'),'hex');
  select * into existing from private.market_radar_domain_reviews_v1
  where request_id=request_id_input;
  if found then
    if existing.request_hash is distinct from request_hash_value then
      raise exception 'RADAR_DOMAIN_REVIEW_REQUEST_REUSED' using errcode='40001';
    end if;
    return jsonb_build_object('ok',true,'request_id',existing.request_id,
      'candidate_id',existing.candidate_id,'decision',existing.decision,
      'candidate_revision',existing.candidate_revision,'idempotency_replay',true);
  end if;
  select * into candidate from private.external_market_candidates
  where id=candidate_id_input for update;
  if not found then raise exception 'RADAR_CANDIDATE_NOT_FOUND' using errcode='P0001'; end if;
  if candidate.preparation_revision is distinct from expected_revision_input
     or candidate.fingerprint is distinct from expected_fingerprint_input then
    raise exception 'PREPARATION_REVISION_MISMATCH' using errcode='40001';
  end if;
  domain_fingerprint_value:=candidate.normalized_payload ->> 'domain_review_fingerprint';
  if coalesce(domain_fingerprint_value,'')!~'^[a-f0-9]{64}$' then
    raise exception 'RADAR_DOMAIN_FINGERPRINT_REQUIRED' using errcode='55000';
  end if;
  select * into previous_review
  from private.market_radar_domain_reviews_v1 review
  where review.candidate_id=candidate.id
    and review.policy_version='atinara-gaming-domain-v1'
    and ((supersedes_request_id_input is null
        and review.domain_fingerprint=domain_fingerprint_value)
      or (supersedes_request_id_input is not null
        and review.request_id=supersedes_request_id_input))
  order by review.created_at desc,review.request_id desc
  limit 1;
  if supersedes_request_id_input is null and previous_review.request_id is not null then
    raise exception 'RADAR_DOMAIN_REVIEW_ALREADY_RECORDED' using errcode='40001';
  end if;
  if supersedes_request_id_input is not null and (
       previous_review.request_id is null
       or previous_review.request_id is distinct from supersedes_request_id_input
       or previous_review.request_id is distinct from (
         select review.request_id from private.market_radar_domain_reviews_v1 review
         where review.candidate_id=candidate.id
           and review.policy_version='atinara-gaming-domain-v1'
         order by review.created_at desc,review.request_id desc limit 1
       )
       or previous_review.decision=decision_input
     ) then
    raise exception 'RADAR_DOMAIN_REVIEW_SUPERSESSION_INVALID' using errcode='40001';
  end if;
  select occurrence.issue_id,coalesce(latest.new_status,'open')
    into issue_id_value,issue_status_value
  from private.market_workflow_issue_occurrences_v1 occurrence
  join private.market_workflow_issue_subject_links_v1 link on link.issue_id=occurrence.issue_id
  left join lateral (
    select event.new_status from private.market_workflow_issue_events_v1 event
    where event.issue_id=occurrence.issue_id order by event.occurred_at desc,event.id desc limit 1
  ) latest on true
  where occurrence.issue_code='GAMING_DOMAIN_REVIEW_REQUIRED'
    and link.subject_type='radar_candidate' and link.subject_key=candidate.id::text
    and link.subject_version=candidate.preparation_revision::text
    and coalesce(latest.new_status,'open') not in ('resolved','superseded')
  order by occurrence.created_at desc limit 1;
  if issue_id_value is null and supersedes_request_id_input is null then
    raise exception 'RADAR_DOMAIN_REVIEW_REQUIRED' using errcode='55000';
  end if;
  if issue_id_value is not null then
    perform pg_advisory_xact_lock(hashtextextended(issue_id_value::text,0));
    select coalesce(latest.new_status,'open') into issue_status_value
    from private.market_workflow_issue_occurrences_v1 occurrence
    left join lateral (
      select event.new_status from private.market_workflow_issue_events_v1 event
      where event.issue_id=occurrence.issue_id order by event.occurred_at desc,event.id desc limit 1
    ) latest on true where occurrence.issue_id=issue_id_value;
    if issue_status_value in ('resolved','superseded') then
      raise exception 'RADAR_DOMAIN_REVIEW_STALE' using errcode='40001';
    end if;
  end if;
  if supersedes_request_id_input is not null then
    select occurrence.issue_id,coalesce(latest.new_status,'open')
      into previous_terminal_issue_id,previous_terminal_status
    from private.market_workflow_issue_occurrences_v1 occurrence
    join private.market_workflow_issue_subject_links_v1 link on link.issue_id=occurrence.issue_id
    left join lateral (
      select event.new_status from private.market_workflow_issue_events_v1 event
      where event.issue_id=occurrence.issue_id order by event.occurred_at desc,event.id desc limit 1
    ) latest on true
    where occurrence.issue_code='OUTSIDE_GAMING_DOMAIN'
      and link.subject_type='radar_candidate' and link.subject_key=candidate.id::text
      and coalesce(latest.new_status,'open') not in ('resolved','superseded')
    order by occurrence.created_at desc limit 1;
    if previous_terminal_issue_id is not null then
      perform pg_advisory_xact_lock(hashtextextended(previous_terminal_issue_id::text,0));
      select coalesce(latest.new_status,'open') into previous_terminal_status
      from private.market_workflow_issue_occurrences_v1 occurrence
      left join lateral (
        select event.new_status from private.market_workflow_issue_events_v1 event
        where event.issue_id=occurrence.issue_id order by event.occurred_at desc,event.id desc limit 1
      ) latest on true where occurrence.issue_id=previous_terminal_issue_id;
      if previous_terminal_status not in ('resolved','superseded') then
        insert into private.market_workflow_issue_events_v1(
          issue_id,event_type,previous_status,new_status,actor_id,owner_stage,next_action,
          resolution_method,evidence_refs
        ) values (
          previous_terminal_issue_id,'superseded',previous_terminal_status,'superseded',
          actor_id_value,'human_review','refresh_draft_eligibility',
          'human_domain_review_corrected',jsonb_build_array(jsonb_build_object(
            'previous_request_id',supersedes_request_id_input,'new_request_id',request_id_input
          ))
        );
      end if;
    end if;
  end if;
  insert into private.market_radar_domain_reviews_v1(
    request_id,candidate_id,candidate_revision,candidate_fingerprint,domain_fingerprint,policy_version,
    decision,rationale,evidence_refs,actor_id,request_hash,supersedes_request_id
  ) values (
    request_id_input,candidate.id,candidate.preparation_revision,candidate.fingerprint,
    domain_fingerprint_value,
    'atinara-gaming-domain-v1',decision_input,btrim(rationale_input),evidence_refs_input,
    actor_id_value,request_hash_value,supersedes_request_id_input
  ) returning * into inserted;
  if issue_id_value is not null then
    insert into private.market_workflow_issue_events_v1(
      issue_id,event_type,previous_status,new_status,actor_id,owner_stage,next_action,
      resolution_method,evidence_refs
    ) values (
      issue_id_value,'resolved',issue_status_value,'resolved',actor_id_value,'human_review',
      'refresh_draft_eligibility','human_domain_review',jsonb_build_array(jsonb_build_object(
        'domain_review_request_id',inserted.request_id,'decision',inserted.decision
      ))
    );
  end if;
  select coalesce(jsonb_agg(value),'[]'::jsonb) into remaining_issues
  from jsonb_array_elements(coalesce(candidate.normalized_payload -> 'workflow_issues','[]'::jsonb)) value
  where value ->> 'issue_code' not in ('GAMING_DOMAIN_REVIEW_REQUIRED','OUTSIDE_GAMING_DOMAIN');
  if decision_input='out_of_domain' then
    terminal_issue:=private.market_workflow_server_issue_v1(
      'OUTSIDE_GAMING_DOMAIN','human_review','radar','terminal','terminal',
      'archive_terminal_candidate',jsonb_build_object(
        'candidate_id',candidate.id,'domain_review_request_id',inserted.request_id
      ),false,'atinara-gaming-domain-v1'
    );
    remaining_issues:=remaining_issues||jsonb_build_array(terminal_issue);
  end if;
  decision_checked_at:=clock_timestamp();
  decision_expires_at:=decision_checked_at+case when decision_input='out_of_domain'
    then interval '100 years' else interval '5 minutes' end;
  decision_reason_code:=case when decision_input='out_of_domain'
    then 'OUTSIDE_GAMING_DOMAIN' else 'VERIFICATION_REQUIRED' end;
  decision_reason:=case when decision_input='out_of_domain'
    then 'La revisión humana concluyó que esta candidata queda fuera del ámbito aprobado.'
    else 'La revisión humana de dominio está registrada; falta renovar la elegibilidad factual.' end;
  update private.external_market_candidates set
    normalized_payload=jsonb_set(jsonb_set(jsonb_set(jsonb_set(
      coalesce(normalized_payload,'{}'::jsonb),'{workflow_issues}',remaining_issues,true),
      '{domain_status}',to_jsonb(decision_input),true),'{domain_reason_code}',
      case when decision_input='out_of_domain' then to_jsonb('OUTSIDE_GAMING_DOMAIN'::text)
        else 'null'::jsonb end,true),'{domain_policy_version}',
      to_jsonb('atinara-gaming-domain-v1'::text),true)
      ||jsonb_build_object('human_domain_review',jsonb_build_object(
        'request_id',inserted.request_id,'decision',inserted.decision,
        'rationale',inserted.rationale,'evidence_refs',inserted.evidence_refs,
        'supersedes_request_id',inserted.supersedes_request_id,
        'candidate_fingerprint',inserted.candidate_fingerprint,
        'domain_fingerprint',inserted.domain_fingerprint,
        'policy_version',inserted.policy_version))
      ||jsonb_build_object(
        'eligibility_status',case when decision_input='out_of_domain'
          then 'terminal' else 'technical_hold' end,
        'eligibility_reason_code',decision_reason_code,
        'eligibility_reason',decision_reason,
        'eligibility_evidence',inserted.evidence_refs,
        'eligibility_policy_version','atinara-prediction-policy-v5',
        'eligibility_checked_at',decision_checked_at,
        'eligibility_expires_at',decision_expires_at
      ),
    state=case when decision_input='out_of_domain' then 'rejected' else 'needs_review' end,
    verification_status=case when decision_input='out_of_domain'
      then 'rejected_ineligible' else 'needs_review' end,
    verification_reason_code=case when decision_input='out_of_domain'
      then 'OUTSIDE_GAMING_DOMAIN' else 'VERIFICATION_REQUIRED' end,
    eligibility_status=case when decision_input='out_of_domain'
      then 'terminal' else 'technical_hold' end,
    eligibility_reason_code=decision_reason_code,
    eligibility_reason=decision_reason,
    eligibility_evidence=inserted.evidence_refs,
    verification_reason=decision_reason,
    current_eligibility_check_id=null,
    eligibility_policy_version='atinara-prediction-policy-v5',
    eligibility_checked_at=decision_checked_at,
    eligibility_expires_at=decision_expires_at,
    updated_at=clock_timestamp()
  where id=candidate.id returning * into candidate;
  insert into private.market_admin_audit(actor_id,action_code,draft_id,draft_version,detail)
  values (actor_id_value,'RADAR_DOMAIN_REVIEW_RECORDED',null,null,jsonb_build_object(
    'candidate_id',candidate.id,'candidate_revision',candidate.preparation_revision,
    'request_id',inserted.request_id,'decision',inserted.decision,
    'supersedes_request_id',inserted.supersedes_request_id,'publishes',false
  ));
  return jsonb_build_object('ok',true,'request_id',inserted.request_id,
    'candidate_id',candidate.id,'decision',inserted.decision,
    'rationale',inserted.rationale,'evidence_refs',inserted.evidence_refs,
    'supersedes_request_id',inserted.supersedes_request_id,
    'candidate_revision',candidate.preparation_revision,'idempotency_replay',false,
    'next_action','refresh_draft_eligibility','publishes',false);
end;
$function$;
revoke all on function public.review_market_radar_domain_v1(uuid,bigint,text,text,text,jsonb,uuid,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.review_market_radar_domain_v1(uuid,bigint,text,text,text,jsonb,uuid,uuid)
  to authenticated;

-- V7 usaba rejected_resolved para cualquier terminal. V6 conserva la causa:
-- solo un resultado conocido se proyecta como resuelto; identidad, política o
-- ámbito terminal siguen siendo ineligibilidad concluyente.
create or replace function private.enforce_market_radar_eligibility_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  payload jsonb:=coalesce(new.normalized_payload,'{}'::jsonb);
  payload_status text:=nullif(payload ->> 'eligibility_status','');
  payload_checked_at timestamptz;
  payload_expires_at timestamptz;
begin
  if payload_status is not null then
    begin
      payload_checked_at:=nullif(payload ->> 'eligibility_checked_at','')::timestamptz;
      payload_expires_at:=nullif(payload ->> 'eligibility_expires_at','')::timestamptz;
    exception when invalid_text_representation or datetime_field_overflow then
      raise exception 'INVALID_RADAR_ELIGIBILITY_DATE' using errcode='22007';
    end;
    if payload ->> 'eligibility_policy_version' is distinct from 'atinara-prediction-policy-v5'
       or payload_status not in ('eligible','terminal','inactive_option','technical_hold','invalid','duplicate')
       or payload_checked_at is null or payload_expires_at is null
       or payload_expires_at<=payload_checked_at
       or jsonb_typeof(coalesce(payload -> 'eligibility_evidence','[]'::jsonb))<>'array'
       or jsonb_array_length(coalesce(payload -> 'eligibility_evidence','[]'::jsonb))>12 then
      raise exception 'INVALID_RADAR_ELIGIBILITY' using errcode='22023';
    end if;
    new.eligibility_status:=payload_status;
    new.eligibility_reason_code:=nullif(left(payload ->> 'eligibility_reason_code',100),'');
    new.eligibility_reason:=nullif(left(payload ->> 'eligibility_reason',1000),'');
    new.eligibility_checked_at:=payload_checked_at;
    new.eligibility_expires_at:=payload_expires_at;
    new.eligibility_policy_version:='atinara-prediction-policy-v5';
    new.eligibility_evidence:=coalesce(payload -> 'eligibility_evidence','[]'::jsonb);
  end if;
  if new.eligibility_policy_version='atinara-prediction-policy-v5' then
    if new.eligibility_status='eligible' then
      new.verification_status:='verified_open';
      new.quality_status:='fit';
      if new.state not in ('prepared','dismissed') then new.state:='available'; end if;
      new.verification_reason_code:=null;
    elsif new.eligibility_status='technical_hold' then
      new.verification_status:='needs_review';
      new.quality_status:='needs_review';
      if new.state not in ('prepared','dismissed') then new.state:='needs_review'; end if;
      new.verification_reason_code:=new.eligibility_reason_code;
    elsif new.eligibility_status='terminal' then
      new.verification_status:=case when new.eligibility_reason_code in (
        'EVENT_ALREADY_RESOLVED','SOURCE_ALREADY_RESOLVED'
      ) then 'rejected_resolved' else 'rejected_ineligible' end;
      new.quality_status:='rejected';
      if new.state<>'dismissed' then new.state:='rejected'; end if;
      new.verification_reason_code:=coalesce(new.eligibility_reason_code,'EVENT_ALREADY_RESOLVED');
    elsif new.eligibility_status='duplicate' then
      new.verification_status:='rejected_duplicate';
      new.quality_status:='rejected';
      if new.state<>'dismissed' then new.state:='rejected'; end if;
      new.verification_reason_code:='DUPLICATE_MARKET';
    elsif new.eligibility_status='invalid' then
      new.verification_status:='rejected_invalid_source';
      new.quality_status:='rejected';
      if new.state<>'dismissed' then new.state:='rejected'; end if;
    else
      new.verification_status:='rejected_ineligible';
      new.quality_status:='rejected';
      if new.state<>'dismissed' then new.state:='rejected'; end if;
    end if;
    new.verification_reason:=new.eligibility_reason;
    new.verified_at:=new.eligibility_checked_at;
    new.verification_expires_at:=new.eligibility_expires_at;
    new.verification_evidence:=new.eligibility_evidence;
    new.fact_status:=null;
    new.fact_policy_version:=null;
    new.fact_context_fingerprint:=null;
    new.fact_checked_at:=null;
    new.fact_check_expires_at:=null;
    new.fact_check_purpose:=null;
    new.current_fact_check_id:=null;
  end if;
  return new;
end;
$function$;
revoke all on function private.enforce_market_radar_eligibility_v1()
  from public,anon,authenticated,service_role;

create or replace function private.preserve_market_radar_terminal_workflow_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  terminal_issue jsonb;
  workflow_issues jsonb:=coalesce(new.normalized_payload -> 'workflow_issues','[]'::jsonb);
  checked_at_value timestamptz;
  expires_at_value timestamptz;
begin
  if old.eligibility_status<>'terminal' then return new; end if;
  checked_at_value:=coalesce(old.eligibility_checked_at,clock_timestamp());
  expires_at_value:=case when old.eligibility_expires_at>checked_at_value
    then old.eligibility_expires_at else checked_at_value+interval '100 years' end;
  select occurrence.issue_payload||jsonb_build_object(
    'issue_id',occurrence.issue_id,'status',coalesce(latest.new_status,'open'),
    'owner_stage',coalesce(latest.owner_stage,occurrence.owner_stage),
    'next_action',coalesce(latest.next_action,occurrence.next_action)
  ) into terminal_issue
  from private.market_workflow_issue_occurrences_v1 occurrence
  join private.market_workflow_issue_subject_links_v1 link on link.issue_id=occurrence.issue_id
  left join lateral (
    select event.new_status,event.owner_stage,event.next_action
    from private.market_workflow_issue_events_v1 event
    where event.issue_id=occurrence.issue_id
    order by event.occurred_at desc,event.id desc limit 1
  ) latest on true
  where link.subject_type='radar_candidate' and link.subject_key=old.id::text
    and (occurrence.repairability='terminal' or occurrence.blocking_scope='terminal')
    and coalesce(latest.new_status,'open') not in ('resolved','superseded')
  order by occurrence.created_at desc,occurrence.issue_id limit 1;
  if terminal_issue is null then return new; end if;
  if jsonb_typeof(workflow_issues)<>'array' then workflow_issues:='[]'::jsonb; end if;
  if not exists (select 1 from jsonb_array_elements(workflow_issues) issue
    where issue ->> 'issue_id'=terminal_issue ->> 'issue_id'
       or issue ->> 'fingerprint'=terminal_issue ->> 'fingerprint') then
    workflow_issues:=workflow_issues||jsonb_build_array(terminal_issue);
  end if;
  new.normalized_payload:=jsonb_set(coalesce(new.normalized_payload,'{}'::jsonb),
    '{workflow_issues}',workflow_issues,true)||jsonb_build_object(
      'eligibility_status','terminal',
      'eligibility_reason_code',old.eligibility_reason_code,
      'eligibility_reason',old.eligibility_reason,
      'eligibility_evidence',old.eligibility_evidence,
      'eligibility_policy_version',coalesce(old.eligibility_policy_version,'atinara-prediction-policy-v5'),
      'eligibility_checked_at',checked_at_value,
      'eligibility_expires_at',expires_at_value
    );
  new.eligibility_status:='terminal';
  new.eligibility_reason_code:=old.eligibility_reason_code;
  new.eligibility_reason:=old.eligibility_reason;
  new.eligibility_evidence:=old.eligibility_evidence;
  new.eligibility_policy_version:=coalesce(old.eligibility_policy_version,'atinara-prediction-policy-v5');
  new.eligibility_checked_at:=checked_at_value;
  new.eligibility_expires_at:=expires_at_value;
  new.current_eligibility_check_id:=old.current_eligibility_check_id;
  new.verification_status:=old.verification_status;
  new.verification_reason_code:=old.verification_reason_code;
  new.verification_reason:=old.verification_reason;
  new.verification_evidence:=old.verification_evidence;
  new.state:=old.state;
  new.quality_status:=old.quality_status;
  new.quality_score:=old.quality_score;
  if jsonb_typeof(old.normalized_payload -> 'human_domain_review')='object' then
    new.normalized_payload:=jsonb_set(new.normalized_payload,'{human_domain_review}',
      old.normalized_payload -> 'human_domain_review',true);
  end if;
  return new;
end;
$function$;
revoke all on function private.preserve_market_radar_terminal_workflow_v1()
  from public,anon,authenticated,service_role;
create trigger aa_preserve_market_radar_terminal_workflow_v1
before update of normalized_payload,eligibility_status,state
on private.external_market_candidates
for each row execute function private.preserve_market_radar_terminal_workflow_v1();

create or replace function private.capture_market_radar_workflow_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  contract jsonb:=new.normalized_payload -> 'temporal_contract';
  issue_value jsonb;
  temporal_id bigint;
  previous_issue record;
  latest_status_value text;
begin
  if jsonb_typeof(contract)='object' then
    if contract ->> 'version' <> 'atinara-temporal-contract-v1'
       or coalesce(contract ->> 'decision_hash','') !~ '^[a-f0-9]{64}$'
       or jsonb_typeof(contract -> 'raw_source_dates')<>'array'
       or jsonb_typeof(contract -> 'evidence_refs')<>'array'
       or jsonb_typeof(contract -> 'anomaly_codes')<>'array' then
      raise exception 'TEMPORAL_CONTRACT_INVALID' using errcode='22023';
    end if;
    insert into private.market_radar_temporal_contracts_v1(
      candidate_id,contract_version,decision_hash,temporal_contract
    ) values (new.id,contract ->> 'version',contract ->> 'decision_hash',contract)
    on conflict (candidate_id,decision_hash) do nothing returning id into temporal_id;
    if temporal_id is null then
      select id into temporal_id from private.market_radar_temporal_contracts_v1
      where candidate_id=new.id and decision_hash=contract ->> 'decision_hash';
    end if;
    if new.current_temporal_contract_id is distinct from temporal_id then
      update private.external_market_candidates
      set current_temporal_contract_id=temporal_id
      where id=new.id and current_temporal_contract_id is distinct from temporal_id;
    end if;
  end if;
  if jsonb_typeof(new.normalized_payload -> 'workflow_issues')='array' then
    if jsonb_array_length(new.normalized_payload -> 'workflow_issues')>40 then
      raise exception 'MARKET_WORKFLOW_ISSUES_INVALID' using errcode='22023';
    end if;
    for issue_value in select value from jsonb_array_elements(new.normalized_payload -> 'workflow_issues')
    loop
      perform private.record_market_workflow_issue_v1(
        'radar_candidate',new.id::text,coalesce(new.preparation_revision,0)::text,
        case when new.fingerprint ~ '^[a-f0-9]{64}$' then new.fingerprint else null end,
        issue_value,null,null
      );
    end loop;
  end if;
  if tg_op='UPDATE' and new.preparation_revision is distinct from old.preparation_revision then
    for previous_issue in
      select occurrence.issue_id,occurrence.issue_code,occurrence.issue_fingerprint,
        occurrence.repairability,occurrence.blocking_scope,
        coalesce(latest.new_status,'open') as current_status
      from private.market_workflow_issue_occurrences_v1 occurrence
      join private.market_workflow_issue_subject_links_v1 link on link.issue_id=occurrence.issue_id
      left join lateral (
        select event.new_status from private.market_workflow_issue_events_v1 event
        where event.issue_id=occurrence.issue_id
        order by event.occurred_at desc,event.id desc limit 1
      ) latest on true
      where link.subject_type='radar_candidate' and link.subject_key=old.id::text
        and link.subject_version=coalesce(old.preparation_revision,0)::text
        and coalesce(latest.new_status,'open') not in ('resolved','superseded')
    loop
      if exists (
        select 1 from jsonb_array_elements(coalesce(
          new.normalized_payload -> 'workflow_issues','[]'::jsonb
        )) current_issue
        where current_issue ->> 'issue_id'=previous_issue.issue_id::text
      ) then
        perform private.link_market_workflow_issue_subject_v1(
          previous_issue.issue_id,'radar_candidate',new.id::text,
          coalesce(new.preparation_revision,0)::text,
          case when new.fingerprint~'^[a-f0-9]{64}$' then new.fingerprint else null end
        );
        continue;
      end if;
      if (previous_issue.repairability='terminal' or previous_issue.blocking_scope='terminal')
         and not exists (
           select 1 from jsonb_array_elements(coalesce(
             new.normalized_payload -> 'workflow_issues','[]'::jsonb
           )) current_issue where current_issue ->> 'issue_code'=previous_issue.issue_code
         ) then
        perform private.link_market_workflow_issue_subject_v1(
          previous_issue.issue_id,'radar_candidate',new.id::text,
          coalesce(new.preparation_revision,0)::text,
          case when new.fingerprint~'^[a-f0-9]{64}$' then new.fingerprint else null end
        );
        continue;
      end if;
      perform pg_advisory_xact_lock(hashtextextended(previous_issue.issue_id::text,0));
      select coalesce(latest.new_status,'open') into latest_status_value
      from private.market_workflow_issue_occurrences_v1 occurrence
      left join lateral (
        select event.new_status from private.market_workflow_issue_events_v1 event
        where event.issue_id=occurrence.issue_id
        order by event.occurred_at desc,event.id desc limit 1
      ) latest on true where occurrence.issue_id=previous_issue.issue_id;
      if latest_status_value not in ('resolved','superseded') then
        insert into private.market_workflow_issue_events_v1(
          issue_id,event_type,previous_status,new_status,owner_stage,next_action,
          resolution_method,evidence_refs
        ) values (
          previous_issue.issue_id,'superseded',latest_status_value,'superseded',
          'radar','retry_provider_refresh','superseded_by_candidate_revalidation',
          jsonb_build_array(jsonb_build_object(
            'previous_revision',old.preparation_revision,'new_revision',new.preparation_revision
          ))
        );
      end if;
    end loop;
  end if;
  return null;
end;
$function$;
revoke all on function private.capture_market_radar_workflow_v1()
  from public,anon,authenticated,service_role;
create trigger capture_market_radar_workflow_v1
after insert or update of normalized_payload,current_temporal_contract_id
on private.external_market_candidates
for each row execute function private.capture_market_radar_workflow_v1();

create or replace function private.capture_market_expert_workflow_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare issue_value jsonb;
begin
  if jsonb_typeof(new.result_json -> 'workflow_issues')='array' then
    if jsonb_array_length(new.result_json -> 'workflow_issues')>40 then
      raise exception 'MARKET_WORKFLOW_ISSUES_INVALID' using errcode='22023';
    end if;
    for issue_value in select value from jsonb_array_elements(new.result_json -> 'workflow_issues')
    loop
      perform private.record_market_workflow_issue_v1(
        'expert_run',new.id::text,'1',new.analysis_fingerprint,issue_value,null,null
      );
    end loop;
  end if;
  return null;
end;
$function$;
revoke all on function private.capture_market_expert_workflow_v1()
  from public,anon,authenticated,service_role;
create trigger capture_market_expert_workflow_v1
after insert or update of result_json on private.market_expert_runs
for each row execute function private.capture_market_expert_workflow_v1();

create or replace function private.project_market_draft_workflow_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  issues jsonb:=coalesce(new.source_provenance -> 'workflow_issues','[]'::jsonb);
  first_issue jsonb;
  open_count integer:=0;
begin
  if jsonb_typeof(issues)<>'array' then
    raise exception 'MARKET_WORKFLOW_ISSUES_INVALID' using errcode='22023';
  end if;
  open_count:=jsonb_array_length(issues);
  select value into first_issue from jsonb_array_elements(issues) limit 1;
  if new.workflow_status='published' then
    new.artifact_status:='published'; new.workflow_owner_stage:=null; new.workflow_next_action:=null;
  elsif new.workflow_status='scheduled' then
    new.artifact_status:='scheduled'; new.workflow_owner_stage:='publication_gate';
    new.workflow_next_action:='wait_for_scheduled_publication';
  elsif new.workflow_status='human_confirmed' then
    new.artifact_status:='human_confirmed'; new.workflow_owner_stage:='publication_gate';
    new.workflow_next_action:='revalidate_and_publish';
  elsif new.workflow_status='cancelled'
     or new.artifact_status in ('review_rejected_terminal','publication_failed_terminal') then
    new.artifact_status:=case when new.artifact_status in (
      'review_rejected_terminal','publication_failed_terminal'
    ) then new.artifact_status else 'review_rejected_terminal' end;
    new.workflow_owner_stage:=coalesce(new.workflow_owner_stage,'human_review');
    new.workflow_next_action:=coalesce(new.workflow_next_action,'retain_terminal_dossier');
  elsif new.artifact_status='repair_pending'
     and new.workflow_owner_stage='corrector'
     and new.workflow_next_action='repair_temporal_or_source_contract' then
    open_count:=coalesce(new.workflow_issue_count,open_count);
  elsif new.workflow_status='review_approved' or new.review_status='approved' then
    new.artifact_status:='review_approved'; new.workflow_owner_stage:='human_review';
    new.workflow_next_action:='confirm_market_draft';
  elsif open_count>0 then
    new.artifact_status:=case
      when first_issue ->> 'repairability'='waiting_authoritative_source'
        then 'draft_waiting_authoritative_source'
      when first_issue ->> 'repairability'='human_editable'
        then 'draft_human_edit_required'
      else 'draft_with_repairable_issues' end;
    new.workflow_owner_stage:=coalesce(first_issue ->> 'owner_stage','validator');
    new.workflow_next_action:=coalesce(first_issue ->> 'next_action','request_market_validation');
  else
    new.artifact_status:=case when new.workflow_status='draft_incomplete'
      then 'draft_incomplete' else 'draft_ready_for_validation' end;
    new.workflow_owner_stage:='validator'; new.workflow_next_action:='request_market_validation';
  end if;
  new.workflow_issue_count:=open_count;
  return new;
end;
$function$;
revoke all on function private.project_market_draft_workflow_v1()
  from public,anon,authenticated,service_role;
create trigger a_project_market_draft_workflow_v1
before insert or update of source_provenance,workflow_status,review_status
on private.market_drafts
for each row execute function private.project_market_draft_workflow_v1();

create or replace function private.block_scheduled_market_draft_content_edit_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if old.workflow_status='scheduled' then
    raise exception 'SCHEDULED_DRAFT_CANCEL_REQUIRED' using errcode='55000';
  end if;
  return new;
end;
$function$;
revoke all on function private.block_scheduled_market_draft_content_edit_v1()
  from public,anon,authenticated,service_role;
create trigger aa_block_scheduled_market_draft_content_edit_v1
before update of market_slug,question,subject,category,yes_option,no_option,
  evaluation_period_label,evaluation_ends_at,closes_at,timezone,resolution_deadline,
  yes_criteria,no_criteria,edge_cases,primary_source,alternative_sources,
  delay_treatment,cancellation_treatment,leak_treatment,rename_treatment,assumptions,
  public_criteria,description
on private.market_drafts
for each row execute function private.block_scheduled_market_draft_content_edit_v1();

create or replace function private.capture_market_draft_workflow_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  issue_value jsonb;
  issue_row record;
  latest_status_value text;
  latest_owner_value text;
  latest_action_value text;
  active_issue_count integer:=0;
  terminal_issue_count integer:=0;
  blocking_issue_count integer:=0;
  terminal_owner_value text;
  terminal_action_value text;
  blocking_owner_value text;
  blocking_action_value text;
begin
  if tg_op='UPDATE' and new.content_version is distinct from old.content_version then
    for issue_row in
      select distinct occurrence.issue_id,occurrence.issue_code,occurrence.detected_by,
        occurrence.repairability,occurrence.blocking_scope
      from private.market_workflow_issue_occurrences_v1 occurrence
      join private.market_workflow_issue_subject_links_v1 link on link.issue_id=occurrence.issue_id
      where link.subject_type='market_draft' and link.subject_key=old.id::text
        and link.subject_version=old.content_version::text
    loop
      perform pg_advisory_xact_lock(hashtextextended(issue_row.issue_id::text,0));
      select coalesce(latest.new_status,'open'),
             coalesce(latest.owner_stage,occurrence.owner_stage),
             coalesce(latest.next_action,occurrence.next_action)
      into latest_status_value,latest_owner_value,latest_action_value
      from private.market_workflow_issue_occurrences_v1 occurrence
      left join lateral (
        select event.new_status,event.owner_stage,event.next_action
        from private.market_workflow_issue_events_v1 event
        where event.issue_id=occurrence.issue_id
        order by event.occurred_at desc,event.id desc limit 1
      ) latest on true where occurrence.issue_id=issue_row.issue_id;
      if latest_status_value in ('resolved','superseded') then continue; end if;
      perform private.link_market_workflow_issue_subject_v1(
        issue_row.issue_id,'market_draft',new.id::text,new.content_version::text,
        case when new.content_fingerprint~'^[a-f0-9]{64}$'
          then new.content_fingerprint else null end
      );
      if issue_row.repairability<>'terminal' and issue_row.blocking_scope<>'terminal'
         and (
           issue_row.detected_by in ('validator','corrector')
           or issue_row.issue_code in (
             'ESSENTIAL_TEXT_NOT_SPANISH','CHILD_IDENTITY_MISMATCH',
             'AUTOMATIC_REVIEW_INCONCLUSIVE'
           )
         )
         and issue_row.issue_code !~ '^(TEMPORAL_|SOURCE_|GAMING_|RADAR_|ELIGIBILITY_|DUPLICATE_|EVENT_)'
         and not (latest_status_value='waiting' and latest_owner_value='validator'
           and latest_action_value='request_market_validation') then
        insert into private.market_workflow_issue_events_v1(
          issue_id,event_type,previous_status,new_status,actor_id,owner_stage,next_action,
          resolution_method,evidence_refs
        ) values (
          issue_row.issue_id,'waiting',latest_status_value,'waiting',new.updated_by,
          'validator','request_market_validation',null,
          jsonb_build_array(jsonb_build_object(
            'previous_version',old.content_version,'new_version',new.content_version
          ))
        );
      end if;
    end loop;
    select count(*)::integer,
           count(*) filter (where occurrence.repairability='terminal'
             or occurrence.blocking_scope='terminal')::integer,
           count(*) filter (where occurrence.blocking_scope in ('approval','terminal')
             and not (
              coalesce(latest.new_status,'open')='waiting'
              and coalesce(latest.owner_stage,occurrence.owner_stage)='validator'
              and coalesce(latest.next_action,occurrence.next_action)='request_market_validation'
              and occurrence.repairability<>'terminal'
              and occurrence.blocking_scope<>'terminal'
            ))::integer,
           (array_agg(coalesce(latest.owner_stage,occurrence.owner_stage)
             order by occurrence.created_at,occurrence.issue_id) filter (where
               occurrence.repairability='terminal' or occurrence.blocking_scope='terminal'))[1],
           (array_agg(coalesce(latest.next_action,occurrence.next_action)
             order by occurrence.created_at,occurrence.issue_id) filter (where
               occurrence.repairability='terminal' or occurrence.blocking_scope='terminal'))[1],
           (array_agg(coalesce(latest.owner_stage,occurrence.owner_stage)
             order by case occurrence.severity when 'blocking' then 0 when 'warning' then 1
               else 2 end,occurrence.created_at,occurrence.issue_id)
             filter (where occurrence.blocking_scope='approval' and not (
               coalesce(latest.new_status,'open')='waiting'
               and coalesce(latest.owner_stage,occurrence.owner_stage)='validator'
               and coalesce(latest.next_action,occurrence.next_action)='request_market_validation'
               and occurrence.repairability<>'terminal'
               and occurrence.blocking_scope<>'terminal'
             )))[1]
           ,(array_agg(coalesce(latest.next_action,occurrence.next_action)
             order by case occurrence.severity when 'blocking' then 0 when 'warning' then 1
               else 2 end,occurrence.created_at,occurrence.issue_id)
             filter (where occurrence.blocking_scope='approval' and not (
               coalesce(latest.new_status,'open')='waiting'
               and coalesce(latest.owner_stage,occurrence.owner_stage)='validator'
               and coalesce(latest.next_action,occurrence.next_action)='request_market_validation'
               and occurrence.repairability<>'terminal'
               and occurrence.blocking_scope<>'terminal'
             )))[1]
    into active_issue_count,terminal_issue_count,blocking_issue_count,
      terminal_owner_value,terminal_action_value,blocking_owner_value,blocking_action_value
    from private.market_workflow_issue_occurrences_v1 occurrence
    join private.market_workflow_issue_subject_links_v1 link on link.issue_id=occurrence.issue_id
    left join lateral (
      select event.new_status,event.owner_stage,event.next_action
      from private.market_workflow_issue_events_v1 event
      where event.issue_id=occurrence.issue_id
      order by event.occurred_at desc,event.id desc limit 1
    ) latest on true
    where link.subject_type='market_draft' and link.subject_key=new.id::text
      and link.subject_version=new.content_version::text
      and coalesce(latest.new_status,'open') not in ('resolved','superseded');
    update private.market_drafts set
      artifact_status=case when terminal_issue_count>0
        then 'review_rejected_terminal' when blocking_issue_count>0
        then 'draft_with_repairable_issues' else 'draft_ready_for_validation' end,
      workflow_owner_stage=case when terminal_issue_count>0
        then coalesce(terminal_owner_value,'human_review') when blocking_issue_count>0
        then coalesce(blocking_owner_value,'validator') else 'validator' end,
      workflow_next_action=case when terminal_issue_count>0
        then coalesce(terminal_action_value,'archive_terminal_candidate')
        when blocking_issue_count>0 then coalesce(blocking_action_value,'request_market_validation')
        else 'request_market_validation' end,
      workflow_issue_count=active_issue_count
    where id=new.id and content_version=new.content_version;
    return null;
  end if;
  if jsonb_typeof(new.source_provenance -> 'workflow_issues')='array' then
    for issue_value in select value from jsonb_array_elements(new.source_provenance -> 'workflow_issues')
    loop
      perform private.record_market_workflow_issue_v1(
        'market_draft',new.id::text,new.content_version::text,
        case when new.content_fingerprint ~ '^[a-f0-9]{64}$' then new.content_fingerprint else null end,
        issue_value,null,null
      );
    end loop;
  end if;
  return null;
end;
$function$;
revoke all on function private.capture_market_draft_workflow_v1()
  from public,anon,authenticated,service_role;
create trigger capture_market_draft_workflow_v1
after insert or update of source_provenance,content_version
on private.market_drafts
for each row execute function private.capture_market_draft_workflow_v1();

create or replace function private.serialize_market_draft_primary_source_check_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  perform 1 from private.market_drafts draft
  where draft.id=new.draft_id for share;
  if not found then raise exception 'DRAFT_NOT_FOUND' using errcode='P0001'; end if;
  return new;
end;
$function$;
revoke all on function private.serialize_market_draft_primary_source_check_v1()
  from public,anon,authenticated,service_role;
drop trigger if exists aa_serialize_market_draft_primary_source_check_v1
  on private.market_draft_primary_source_checks;
create trigger aa_serialize_market_draft_primary_source_check_v1
before insert on private.market_draft_primary_source_checks
for each row execute function private.serialize_market_draft_primary_source_check_v1();

create or replace function private.market_draft_primary_source_check_is_current_v1(
  check_id_input uuid,
  draft_id_input uuid,
  draft_version_input bigint
)
returns boolean
language sql
volatile
security definer
set search_path = ''
as $function$
  select exists (
    select 1
    from private.market_draft_primary_source_checks source_check
    join private.market_drafts draft on draft.id=source_check.draft_id
    join private.market_source_registry registry on registry.id=source_check.registry_source_id
    where source_check.id=check_id_input and source_check.draft_id=draft_id_input
      and source_check.draft_version=draft_version_input
      and source_check.checked_at>=clock_timestamp()-interval '10 minutes'
      and source_check.expires_at>clock_timestamp()
      and source_check.final_url=coalesce(draft.primary_source ->> 'url','')
      and source_check.draft_category=draft.category
      and source_check.registry_role='primary_resolution'
      and source_check.validation_version='atinara-primary-source-validation-v1'
      and private.market_primary_registry_row_matches_v1(
        registry,source_check.final_url,source_check.draft_category
      )
      and draft.primary_source ->> 'registry_source_id'=registry.id::text
      and draft.primary_source ->> 'registry_role'='primary_resolution'
      and draft.primary_source ->> 'validation_version'='atinara-primary-source-validation-v1'
      and draft.primary_source -> 'registry_role_verified'='true'::jsonb
      and draft.primary_source -> 'validated_reachable'='true'::jsonb
      and draft.primary_source -> 'authority_verified'='true'::jsonb
      and draft.primary_source -> 'relevance_verified'='true'::jsonb
      and source_check.evidence_snapshot -> 'accepted'='true'::jsonb
      and source_check.evidence_snapshot -> 'validated_reachable'='true'::jsonb
      and source_check.evidence_snapshot -> 'authority_verified'='true'::jsonb
      and source_check.evidence_snapshot -> 'relevance_verified'='true'::jsonb
      and jsonb_typeof(source_check.evidence_snapshot -> 'matched_tokens')='array'
      and jsonb_array_length(source_check.evidence_snapshot -> 'matched_tokens')>0
  );
$function$;
revoke all on function private.market_draft_primary_source_check_is_current_v1(uuid,uuid,bigint)
  from public,anon,authenticated,service_role;

create or replace function private.market_draft_publication_source_ready_v1(
  draft_id_input uuid,
  draft_version_input bigint,
  scheduled_execution_input boolean
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  draft_row private.market_drafts%rowtype;
  effective_review_row private.market_effective_reviews%rowtype;
  source_check_row private.market_draft_primary_source_checks%rowtype;
  confirmation_detail jsonb;
  revalidation_detail jsonb;
  binding_state jsonb;
begin
  select * into draft_row from private.market_drafts draft
  where draft.id=draft_id_input and draft.content_version=draft_version_input;
  if not found or draft_row.effective_review_id is null
     or draft_row.human_confirmed_review_id is distinct from draft_row.effective_review_id
     or draft_row.human_confirmed_fingerprint is distinct from draft_row.content_fingerprint then
    return false;
  end if;
  select * into effective_review_row from private.market_effective_reviews effective
  where effective.id=draft_row.effective_review_id and effective.draft_id=draft_row.id
    and effective.draft_version=draft_row.content_version
    and effective.content_fingerprint=draft_row.content_fingerprint and effective.active;
  if not found or effective_review_row.source_check_id is null
     or effective_review_row.source_evidence_fingerprint is null then return false; end if;
  select audit.detail into confirmation_detail from private.market_admin_audit audit
  where audit.action_code in ('HUMAN_CONFIRMATION_RECORDED','HUMAN_CONFIRMATION_CARRIED_FORWARD')
    and audit.draft_id=draft_row.id and audit.draft_version=draft_row.content_version
    and audit.detail ->> 'content_fingerprint'=draft_row.content_fingerprint
    and audit.detail ->> 'effective_review_id'=draft_row.effective_review_id::text
  order by audit.created_at desc,audit.id desc limit 1;
  if confirmation_detail is null then return false; end if;
  begin
    binding_state:=private.market_binding_compatibility(draft_row.id);
  exception when others then
    return false;
  end;
  if coalesce((binding_state ->> 'compatible')::boolean,false) is not true then return false; end if;
  if coalesce((binding_state ->> 'required')::boolean,false) then
    if confirmation_detail ->> 'binding_id' is distinct from binding_state ->> 'binding_id'
       or confirmation_detail ->> 'binding_plan_version'
         is distinct from binding_state ->> 'plan_version' then return false; end if;
  elsif nullif(confirmation_detail ->> 'binding_id','') is not null then
    return false;
  end if;
  select source_check.* into source_check_row
  from private.market_draft_primary_source_checks source_check
  where source_check.draft_id=draft_row.id
    and source_check.draft_version=draft_row.content_version
  order by source_check.checked_at desc,source_check.id desc limit 1;
  if not found or private.market_draft_primary_source_check_is_current_v1(
    source_check_row.id,draft_row.id,draft_row.content_version
  ) is not true then return false; end if;
  if scheduled_execution_input is not true
     and source_check_row.id=effective_review_row.source_check_id then return true; end if;
  select audit.detail into revalidation_detail from private.market_admin_audit audit
  where audit.action_code='PUBLICATION_EVIDENCE_REVALIDATED'
    and audit.draft_id=draft_row.id and audit.draft_version=draft_row.content_version
    and audit.detail ->> 'primary_source_check_id'=source_check_row.id::text
    and audit.detail ->> 'baseline_source_check_id'=effective_review_row.source_check_id::text
    and audit.detail ->> 'content_fingerprint'=draft_row.content_fingerprint
    and audit.detail ->> 'effective_review_id'=draft_row.effective_review_id::text
    and (scheduled_execution_input is not true
      or audit.detail ->> 'execution_mode'='scheduled')
  order by audit.created_at desc,audit.id desc limit 1;
  return revalidation_detail is not null
    and revalidation_detail ->> 'binding_id' is not distinct from binding_state ->> 'binding_id'
    and revalidation_detail ->> 'binding_plan_version'
      is not distinct from binding_state ->> 'plan_version';
end;
$function$;
revoke all on function private.market_draft_publication_source_ready_v1(uuid,bigint,boolean)
  from public,anon,authenticated,service_role;

create or replace function public.record_market_draft_review_with_issues_v1(
  attempt_id_input uuid,
  result_input text,
  semantic_issues_input jsonb,
  editorial_notes_input jsonb,
  reviewed_by_input uuid,
  technical_code_input text,
  safe_provider_metadata_input jsonb,
  workflow_issues_input jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  result jsonb;
  attempt private.market_review_attempts%rowtype;
  review_draft private.market_drafts%rowtype;
  issue_value jsonb;
  issue_count integer:=0;
  first_issue jsonb;
  previous_technical_issue record;
  issue_id_value uuid;
  authoritative_issues jsonb:='[]'::jsonb;
  authoritative_workflow_status text;
  authority_state_preserved boolean;
  projected_artifact_status text;
  projected_owner_stage text;
  projected_next_action text;
  terminal_issue_present boolean:=false;
  effective_review_id_value bigint;
  effective_source_check private.market_draft_primary_source_checks%rowtype;
  effective_source_check_id_value uuid;
  source_evidence_fingerprint_value text;
  previous_effective_review_id_value bigint;
  previous_confirmation_detail jsonb;
  current_binding_state jsonb;
begin
  if auth.role()<>'service_role' then
    raise exception 'SERVICE_ROLE_REQUIRED' using errcode='42501';
  end if;
  if jsonb_typeof(workflow_issues_input)<>'array' or jsonb_array_length(workflow_issues_input)>40 then
    raise exception 'MARKET_WORKFLOW_ISSUES_INVALID' using errcode='22023';
  end if;
  terminal_issue_present:=exists (
    select 1 from jsonb_array_elements(workflow_issues_input) issue
    where issue ->> 'repairability'='terminal' or issue ->> 'blocking_scope'='terminal'
  );
  if result_input='approved' and exists (
    select 1 from jsonb_array_elements(workflow_issues_input) issue
    where issue ->> 'blocking_scope' in ('approval','human_confirmation','publication','terminal')
  ) then
    raise exception 'MARKET_WORKFLOW_APPROVED_WITH_BLOCKERS' using errcode='22023';
  end if;
  select * into attempt from private.market_review_attempts
  where id=attempt_id_input for update;
  if not found then raise exception 'MARKET_REVIEW_ATTEMPT_NOT_FOUND' using errcode='P0001'; end if;
  if attempt.completed_at is null then
    select * into review_draft from private.market_drafts
    where id=attempt.draft_id for update;
    if found then previous_effective_review_id_value:=review_draft.effective_review_id; end if;
    if found and review_draft.content_version=attempt.draft_version
       and review_draft.content_fingerprint=attempt.content_fingerprint
       and result_input='approved' then
      begin
        effective_source_check_id_value:=(safe_provider_metadata_input ->> 'primary_source_check_id')::uuid;
      exception when invalid_text_representation or null_value_not_allowed then
        raise exception 'PRIMARY_SOURCE_CHECK_REQUIRED' using errcode='22023';
      end;
      if effective_source_check_id_value is null or not exists (
        select 1 from private.market_draft_primary_source_checks source_check
        where source_check.id=effective_source_check_id_value
          and source_check.draft_id=attempt.draft_id
          and source_check.draft_version=attempt.draft_version
          and source_check.id=(
            select latest.id from private.market_draft_primary_source_checks latest
            where latest.draft_id=attempt.draft_id
              and latest.draft_version=attempt.draft_version
            order by latest.checked_at desc,latest.id desc limit 1
          )
          and source_check.final_url=coalesce(review_draft.primary_source ->> 'url','')
          and source_check.draft_category=review_draft.category
          and private.market_draft_primary_source_check_is_current_v1(
            source_check.id,attempt.draft_id,attempt.draft_version
          )
      ) then raise exception 'PRIMARY_SOURCE_CHECK_REQUIRED' using errcode='22023'; end if;
    end if;
    if found
       and review_draft.content_version=attempt.draft_version
       and review_draft.content_fingerprint=attempt.content_fingerprint
       and result_input in ('approved','rejected') then
      for previous_technical_issue in
        select occurrence.issue_id,coalesce(latest.new_status,'open') as current_status
        from private.market_workflow_issue_occurrences_v1 occurrence
        join private.market_workflow_issue_subject_links_v1 link
          on link.issue_id=occurrence.issue_id
        left join lateral (
          select event.new_status,event.owner_stage,event.next_action
          from private.market_workflow_issue_events_v1 event
          where event.issue_id=occurrence.issue_id
          order by event.occurred_at desc,event.id desc limit 1
        ) latest on true
        where link.subject_type='market_draft'
          and link.subject_key=attempt.draft_id::text
          and link.subject_version=attempt.draft_version::text
          and coalesce(latest.new_status,'open')='waiting'
          and coalesce(latest.owner_stage,occurrence.owner_stage)='validator'
          and coalesce(latest.next_action,occurrence.next_action)='request_market_validation'
      loop
        perform public.transition_market_workflow_issue_v1(
          previous_technical_issue.issue_id,previous_technical_issue.current_status,
          'superseded','validator','request_market_validation',
          'validator_revalidated_material_version',
          jsonb_build_array(jsonb_build_object('attempt_id',attempt_id_input))
        );
      end loop;
    end if;
  end if;
  result:=public.record_market_draft_review_v2(
    attempt_id_input,result_input,semantic_issues_input,editorial_notes_input,
    reviewed_by_input,technical_code_input,safe_provider_metadata_input
  );
  authoritative_workflow_status:=result ->> 'workflow_status';
  authority_state_preserved:=authoritative_workflow_status in ('review_approved','human_confirmed')
    and result ->> 'review_status'='approved'
    and nullif(result ->> 'effective_review_id','') is not null;
  if result ->> 'status'='stale'
     or coalesce((result ->> 'idempotency_replay')::boolean,false) then
    return result||jsonb_build_object(
      'state_preserved',true,
      'workflow_issue_count',0,
      'classification',attempt.classification,
      'technical_code',attempt.technical_code,
      'owner_stage',case when result ->> 'status'='stale' then 'validator' else null end,
      'next_action',case when result ->> 'status'='stale' then 'retry_market_validation' else null end
    );
  end if;
  effective_review_id_value:=nullif(result ->> 'effective_review_id','')::bigint;
  if effective_review_id_value is null then
    select draft.effective_review_id into effective_review_id_value
    from private.market_drafts draft where draft.id=attempt.draft_id
      and draft.content_version=attempt.draft_version
      and draft.content_fingerprint=attempt.content_fingerprint;
  end if;
  if authority_state_preserved and previous_effective_review_id_value is not null then
    select effective.source_check_id,effective.source_evidence_fingerprint
      into effective_source_check_id_value,source_evidence_fingerprint_value
    from private.market_effective_reviews effective
    where effective.id=previous_effective_review_id_value;
    if effective_source_check_id_value is not null
       and source_evidence_fingerprint_value is not null then
      update private.market_effective_reviews set
        source_check_id=effective_source_check_id_value,
        source_evidence_fingerprint=source_evidence_fingerprint_value
      where id=effective_review_id_value and source_check_id is null
        and source_evidence_fingerprint is null;
    end if;
  end if;
  if authority_state_preserved
     and authoritative_workflow_status='human_confirmed'
     and effective_review_id_value is not null
     and effective_review_id_value is distinct from previous_effective_review_id_value then
    select audit.detail into previous_confirmation_detail
    from private.market_admin_audit audit
    where audit.action_code in ('HUMAN_CONFIRMATION_RECORDED','HUMAN_CONFIRMATION_CARRIED_FORWARD')
      and audit.draft_id=attempt.draft_id and audit.draft_version=attempt.draft_version
      and audit.detail ->> 'content_fingerprint'=attempt.content_fingerprint
      and audit.detail ->> 'effective_review_id'=previous_effective_review_id_value::text
    order by audit.created_at desc,audit.id desc limit 1;
    if previous_confirmation_detail is null then
      raise exception 'HUMAN_CONFIRMATION_AUDIT_REQUIRED' using errcode='55000';
    end if;
    current_binding_state:=private.market_binding_compatibility(attempt.draft_id);
    if coalesce((current_binding_state ->> 'compatible')::boolean,false) is not true
       or previous_confirmation_detail ->> 'binding_id'
         is distinct from current_binding_state ->> 'binding_id'
       or previous_confirmation_detail ->> 'binding_plan_version'
         is distinct from current_binding_state ->> 'plan_version' then
      raise exception 'CURRENT_BINDING_COMPATIBILITY_REQUIRED' using errcode='55000';
    end if;
    insert into private.market_admin_audit(actor_id,action_code,draft_id,draft_version,detail)
    values (
      review_draft.human_confirmed_by,'HUMAN_CONFIRMATION_CARRIED_FORWARD',
      attempt.draft_id,attempt.draft_version,jsonb_build_object(
        'effective_review_id',effective_review_id_value,
        'content_fingerprint',attempt.content_fingerprint,
        'binding_id',current_binding_state ->> 'binding_id',
        'binding_plan_version',current_binding_state ->> 'plan_version',
        'carried_from_effective_review_id',previous_effective_review_id_value,
        'review_attempt_id',attempt.id,'automatic_authority_escalation',false,
        'human_confirmation_reused',true
      )
    );
  end if;
  if effective_review_id_value is not null then
    with recursive source_review_chain as (
      select effective.id,effective.reused_from_effective_review_id,
        effective.source_check_id,effective.source_evidence_fingerprint,1 as depth
      from private.market_effective_reviews effective where effective.id=effective_review_id_value
      union all
      select parent.id,parent.reused_from_effective_review_id,
        parent.source_check_id,parent.source_evidence_fingerprint,chain.depth+1
      from source_review_chain chain
      join private.market_effective_reviews parent on parent.id=chain.reused_from_effective_review_id
      where chain.depth<32
    ) select source_check_id,source_evidence_fingerprint
      into effective_source_check_id_value,source_evidence_fingerprint_value
    from source_review_chain where source_check_id is not null
      and source_evidence_fingerprint is not null order by depth limit 1;
    if effective_source_check_id_value is not null then
      update private.market_effective_reviews set
        source_check_id=effective_source_check_id_value,
        source_evidence_fingerprint=source_evidence_fingerprint_value
      where id=effective_review_id_value and source_check_id is null
        and source_evidence_fingerprint is null;
    end if;
  end if;
  if result_input='approved' and effective_review_id_value is not null
     and nullif(safe_provider_metadata_input ->> 'primary_source_check_id','') is not null then
    begin
      effective_source_check_id_value:=(safe_provider_metadata_input ->> 'primary_source_check_id')::uuid;
    exception when invalid_text_representation then
      raise exception 'PRIMARY_SOURCE_CHECK_REQUIRED' using errcode='22023';
    end;
    select source_check.* into effective_source_check
    from private.market_draft_primary_source_checks source_check
    join private.market_drafts draft on draft.id=source_check.draft_id
    where source_check.id=effective_source_check_id_value
      and source_check.draft_id=attempt.draft_id
      and source_check.draft_version=attempt.draft_version
      and source_check.id=(
        select latest.id from private.market_draft_primary_source_checks latest
        where latest.draft_id=attempt.draft_id
          and latest.draft_version=attempt.draft_version
        order by latest.checked_at desc,latest.id desc limit 1
      )
      and private.market_draft_primary_source_check_is_current_v1(
        source_check.id,attempt.draft_id,attempt.draft_version
      )
      and source_check.final_url=coalesce(draft.primary_source ->> 'url','')
      and source_check.draft_category=draft.category;
    if not found then raise exception 'PRIMARY_SOURCE_CHECK_REQUIRED' using errcode='22023'; end if;
    source_evidence_fingerprint_value:=encode(extensions.digest(convert_to(
      private.market_workflow_canonical_json_v1(jsonb_build_object(
        'registry_source_id',effective_source_check.registry_source_id,
        'final_url',effective_source_check.final_url,
        'excerpt_sha256',effective_source_check.evidence_snapshot ->> 'excerpt_sha256',
        'matched_tokens',effective_source_check.evidence_snapshot -> 'matched_tokens'
      )),'UTF8'),'sha256'),'hex');
    update private.market_effective_reviews set
      source_check_id=effective_source_check.id,
      source_evidence_fingerprint=source_evidence_fingerprint_value
    where id=effective_review_id_value and source_check_id is null
      and source_evidence_fingerprint is null;
    if not found and not exists (
      select 1 from private.market_effective_reviews effective
      where effective.id=effective_review_id_value
        and effective.source_check_id=effective_source_check.id
        and effective.source_evidence_fingerprint=source_evidence_fingerprint_value
    ) then raise exception 'EFFECTIVE_REVIEW_SOURCE_BASELINE_CONFLICT' using errcode='40001'; end if;
  end if;
  for previous_technical_issue in
    select occurrence.issue_id,coalesce(latest.new_status,'open') as current_status
    from private.market_workflow_issue_occurrences_v1 occurrence
    join private.market_workflow_issue_subject_links_v1 link
      on link.issue_id=occurrence.issue_id
    left join lateral (
      select event.new_status,event.owner_stage,event.next_action
      from private.market_workflow_issue_events_v1 event
      where event.issue_id=occurrence.issue_id
      order by event.occurred_at desc,event.id desc limit 1
    ) latest on true
    where link.subject_type='market_draft'
      and link.subject_key=attempt.draft_id::text
      and link.subject_version=attempt.draft_version::text
      and (occurrence.detected_by='internal_platform'
        or occurrence.issue_code='AUTOMATIC_REVIEW_INCONCLUSIVE')
      and occurrence.owner_stage='validator'
      and occurrence.blocking_scope='none'
      and occurrence.next_action='retry_market_validation'
      and coalesce(latest.new_status,'open') not in ('resolved','superseded')
  loop
    perform public.transition_market_workflow_issue_v1(
      previous_technical_issue.issue_id,previous_technical_issue.current_status,
      'superseded','validator','retry_market_validation','validator_retry_revalidation',
      jsonb_build_array(jsonb_build_object('attempt_id',attempt_id_input))
    );
  end loop;
  for issue_value in select value from jsonb_array_elements(workflow_issues_input)
  loop
    issue_count:=issue_count+1;
    issue_id_value:=private.record_market_workflow_issue_v1(
      'market_draft',attempt.draft_id::text,attempt.draft_version::text,
      attempt.content_fingerprint,issue_value,null,null
    );
    issue_value:=jsonb_set(issue_value,'{issue_id}',to_jsonb(issue_id_value),true);
    if first_issue is null or (
      (issue_value ->> 'repairability'='terminal' or issue_value ->> 'blocking_scope'='terminal')
      and first_issue ->> 'repairability'<>'terminal'
      and first_issue ->> 'blocking_scope'<>'terminal'
    ) then first_issue:=issue_value; end if;
    authoritative_issues:=authoritative_issues||jsonb_build_array(issue_value);
    perform private.link_market_workflow_issue_subject_v1(
      issue_id_value,'review_attempt',attempt.id::text,attempt.draft_version::text,
      attempt.content_fingerprint
    );
  end loop;
  projected_artifact_status:=case
    when authority_state_preserved and authoritative_workflow_status='human_confirmed'
      then 'human_confirmed'
    when authority_state_preserved and authoritative_workflow_status='review_approved'
      then 'review_approved'
    when result_input='approved' and issue_count=0 then 'review_approved'
    when result_input='rejected' and terminal_issue_present then 'review_rejected_terminal'
    when result_input='rejected' then 'review_rejected_repairable'
    when result_input in ('provider_timeout','provider_rate_limited','provider_unavailable',
      'provider_auth_error','invalid_response','internal_error') then 'review_unavailable'
    else 'review_inconclusive' end;
  projected_owner_stage:=case
    when authority_state_preserved and authoritative_workflow_status='human_confirmed'
      then 'publication_gate'
    when authority_state_preserved and authoritative_workflow_status='review_approved'
      then 'human_review'
    when result_input='approved' and issue_count=0 then 'human_review'
    when result_input in ('rejected','inconclusive')
      then coalesce(first_issue ->> 'owner_stage','corrector')
    else 'validator' end;
  projected_next_action:=case
    when authority_state_preserved and authoritative_workflow_status='human_confirmed'
      then 'revalidate_and_publish'
    when authority_state_preserved and authoritative_workflow_status='review_approved'
      then 'confirm_market_draft'
    when result_input='approved' and issue_count=0 then 'confirm_market_draft'
    when result_input in ('rejected','inconclusive')
      then coalesce(first_issue ->> 'next_action','repair_draft_issues')
    else 'retry_market_validation' end;
  update private.market_drafts set
    artifact_status=projected_artifact_status,
    workflow_owner_stage=projected_owner_stage,
    workflow_next_action=projected_next_action,
    workflow_issue_count=issue_count
  where id=attempt.draft_id
    and content_version=attempt.draft_version
    and content_fingerprint=attempt.content_fingerprint;
  if not found then
    raise exception 'DRAFT_VERSION_MOVED' using errcode='40001';
  end if;
  return result || jsonb_build_object(
    'artifact_status',projected_artifact_status,
    'workflow_issue_count',issue_count,
    'workflow_issues',authoritative_issues,
    'workflow_issue_ids',(
      select coalesce(jsonb_agg(value ->> 'issue_id' order by ordinality),'[]'::jsonb)
      from jsonb_array_elements(authoritative_issues) with ordinality
    ),
    'owner_stage',projected_owner_stage,
    'next_action',projected_next_action
  );
end;
$function$;
revoke all on function public.record_market_draft_review_with_issues_v1(uuid,text,jsonb,jsonb,uuid,text,jsonb,jsonb)
  from public,anon,authenticated,service_role;
grant execute on function public.record_market_draft_review_with_issues_v1(uuid,text,jsonb,jsonb,uuid,text,jsonb,jsonb)
  to service_role;

create or replace function public.get_admin_market_draft_v2(draft_id_input uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  draft_value jsonb;
  issues jsonb;
  active_issues jsonb;
  publication_attempts jsonb;
  draft_version text;
begin
  perform private.require_current_admin();
  draft_value:=public.get_admin_market_draft(draft_id_input);
  if draft_value is null then return null; end if;
  draft_version:=coalesce(draft_value #>> '{draft,content_version}','0');
  issues:=public.get_market_workflow_issues_v1('market_draft',draft_id_input::text,draft_version);
  select coalesce(jsonb_agg(value order by value ->> 'created_at',value ->> 'issue_id'),'[]'::jsonb)
    into active_issues from jsonb_array_elements(issues) value
    where value ->> 'status' not in ('resolved','superseded');
  select coalesce(jsonb_agg(jsonb_build_object(
    'attempt_id',attempt.id,'trigger_type',attempt.trigger_type,
    'expected_version',attempt.expected_version,'attempt_number',attempt.attempt_number,
    'status',attempt.status,'retryable',attempt.retryable,'error_code',attempt.error_code,
    'issue_id',attempt.issue_id,'next_retry_at',attempt.next_retry_at,
    'started_at',attempt.started_at,'completed_at',attempt.completed_at
  ) order by attempt.attempt_number desc),'[]'::jsonb) into publication_attempts
  from (
    select * from private.market_publication_attempts_v1
    where draft_id=draft_id_input order by attempt_number desc limit 20
  ) attempt;
  return jsonb_set(draft_value,'{draft}',coalesce(draft_value -> 'draft','{}'::jsonb) || jsonb_build_object(
      'workflow_issues',issues,
      'active_workflow_issues',active_issues,
      'workflow_issue_count',jsonb_array_length(active_issues),
      'publication_attempts',publication_attempts,
      'artifact_status',coalesce(draft_value #>> '{draft,artifact_status}',
        case when draft_value #>> '{draft,review_status}'='approved' then 'review_approved'
          else 'draft_ready_for_validation' end)
    ),true);
end;
$function$;
revoke all on function public.get_admin_market_draft_v2(uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.get_admin_market_draft_v2(uuid) to authenticated;

create or replace function private.market_family_option_from_question_v1(question_input text)
returns text
language plpgsql
immutable
security definer
set search_path = ''
as $function$
declare match_value text[];
begin
  if nullif(btrim(question_input),'') is null then return null; end if;
  match_value:=regexp_match(question_input,
    '^\s*(?:will|can|could)\s+(.+?)\s+(?:win|be\s+named|be\s+chosen|be\s+awarded|receive|take\s+home)(?:\s|$)','i');
  if match_value is null then
    match_value:=regexp_match(question_input,
      '^\s*¿?(?:ganar[aá]|ser[aá]\s+nombrad[oa]|ser[aá]\s+elegid[oa]|recibir[aá])\s+(.+?)\s+(?:el|la|un|una)\s+(?:premio|galard[oó]n|categor[ií]a)','i');
  end if;
  if match_value is null then
    match_value:=regexp_match(question_input,
      '^\s*(?:will|can|could)\s+(.+?)\s+be\s+(?:the\s+)?(?:winner|game\s+of\s+the\s+year)(?:\s|$)','i');
  end if;
  if match_value is null then
    match_value:=regexp_match(question_input,
      '^\s*¿?ser[aá]\s+(.+?)\s+(?:el|la)\s+(?:ganador|ganadora)(?:\s|$)','i');
  end if;
  if match_value is null or nullif(btrim(match_value[1]),'') is null then return null; end if;
  if array_length(regexp_split_to_array(btrim(match_value[1]),'\s+'),1)>18 then return null; end if;
  return left(btrim(match_value[1]),240);
end;
$function$;
revoke all on function private.market_family_option_from_question_v1(text)
  from public,anon,authenticated,service_role;

create or replace function private.assign_market_candidate_family_v4()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  metadata_value jsonb;
  question_value text;
  yes_label_value text;
  structured_yes_label_value text;
  derived_yes_label_value text;
  categorical_entity_value text;
begin
  question_value:=coalesce(new.normalized_payload ->> 'atinara_question',new.normalized_payload ->> 'source_question');
  structured_yes_label_value:=coalesce(
    new.normalized_payload #>> '{provider_payload,yes_sub_title}',
    new.normalized_payload ->> 'yes_sub_title'
  );
  derived_yes_label_value:=private.market_family_option_from_question_v1(question_value);
  yes_label_value:=coalesce(structured_yes_label_value,derived_yes_label_value);
  if tg_op='UPDATE'
     and old.family_version='atinara-market-family-v4'
     and old.family_key is not distinct from nullif(new.normalized_payload ->> 'family_key','')
     and old.family_child_key is not distinct from nullif(new.normalized_payload ->> 'family_child_key','')
     and old.family_version is not distinct from nullif(new.normalized_payload ->> 'family_version','')
     and row(
       coalesce(old.normalized_payload ->> 'atinara_question',old.normalized_payload ->> 'source_question'),
       old.normalized_payload ->> 'source_title',
       coalesce(old.normalized_payload ->> 'atinara_subject',old.normalized_payload ->> 'subject'),
       coalesce(old.normalized_payload ->> 'event_group_key',old.external_event_id),
       coalesce(old.normalized_payload ->> 'evaluation_ends_at',old.normalized_payload ->> 'family_cutoff_at'),
       coalesce(old.normalized_payload ->> 'evaluation_timezone',old.normalized_payload ->> 'timezone',
         old.normalized_payload ->> 'source_timezone',old.normalized_payload #>> '{provider_payload,timezone}'),
       old.normalized_payload ->> 'source_resolution_rules',
       coalesce(old.normalized_payload #>> '{provider_payload,yes_sub_title}',
         old.normalized_payload ->> 'yes_sub_title',private.market_family_option_from_question_v1(
           coalesce(old.normalized_payload ->> 'atinara_question',old.normalized_payload ->> 'source_question')))
     ) is not distinct from row(
       question_value,new.normalized_payload ->> 'source_title',
       coalesce(new.normalized_payload ->> 'atinara_subject',new.normalized_payload ->> 'subject'),
       coalesce(new.normalized_payload ->> 'event_group_key',new.external_event_id),
       coalesce(new.normalized_payload ->> 'evaluation_ends_at',new.normalized_payload ->> 'family_cutoff_at'),
       coalesce(new.normalized_payload ->> 'evaluation_timezone',new.normalized_payload ->> 'timezone',
         new.normalized_payload ->> 'source_timezone',new.normalized_payload #>> '{provider_payload,timezone}'),
       new.normalized_payload ->> 'source_resolution_rules',yes_label_value
     ) then
    new.family_key:=old.family_key; new.family_title:=old.family_title;
    new.family_type:=old.family_type; new.family_child_key:=old.family_child_key;
    new.family_child_label:=old.family_child_label; new.family_sort_at:=old.family_sort_at;
    new.family_relationship:=old.family_relationship; new.family_semantics:=old.family_semantics;
    new.family_source_event_key:=old.family_source_event_key; new.family_version:=old.family_version;
  else
    metadata_value:=private.market_family_metadata_v4(
      question_value,new.normalized_payload ->> 'source_title',
      coalesce(new.normalized_payload ->> 'atinara_subject',new.normalized_payload ->> 'subject'),
      coalesce(new.normalized_payload ->> 'event_group_key',new.external_event_id),
      private.market_family_safe_timestamptz_v4(coalesce(
        new.normalized_payload ->> 'evaluation_ends_at',new.normalized_payload ->> 'family_cutoff_at')),
      coalesce(new.normalized_payload ->> 'evaluation_timezone',new.normalized_payload ->> 'timezone',
        new.normalized_payload ->> 'source_timezone',new.normalized_payload #>> '{provider_payload,timezone}'),
      new.normalized_payload ->> 'source_resolution_rules',yes_label_value
    );
    if structured_yes_label_value is null and derived_yes_label_value is not null
       and private.market_family_normalize_v4(question_value) ~ '\m(win|wins|ganar[a-z]*)\M' then
      categorical_entity_value:=private.market_family_normalize_v4(
        coalesce(new.normalized_payload ->> 'source_title',question_value));
      if nullif(categorical_entity_value,'') is not null
         and nullif(private.market_family_option_slug_v1(derived_yes_label_value,120),'') is not null then
        metadata_value:=metadata_value||jsonb_build_object(
          'family_key','atinara:v4:'||private.market_family_slug_v4(categorical_entity_value,100)||':outcome',
          'family_title','Opciones · '||categorical_entity_value,
          'family_type','categorical_outcomes',
          'family_child_key','option:'||private.market_family_option_slug_v1(derived_yes_label_value,120),
          'family_child_label',private.market_family_normalize_v4(derived_yes_label_value),
          'family_semantics',coalesce(metadata_value -> 'family_semantics','{}'::jsonb)||jsonb_build_object(
            'cumulative',false,'mutually_exclusive',true,'parent_is_market',false,
            'aggregate_probability',false,'economic_independence',true,
            'entity_label',categorical_entity_value
          )
        );
      end if;
    end if;
    new.family_key:=metadata_value ->> 'family_key'; new.family_title:=metadata_value ->> 'family_title';
    new.family_type:=metadata_value ->> 'family_type'; new.family_child_key:=metadata_value ->> 'family_child_key';
    new.family_child_label:=metadata_value ->> 'family_child_label';
    new.family_sort_at:=private.market_family_safe_timestamptz_v4(metadata_value ->> 'family_sort_at');
    new.family_relationship:='standalone'; new.family_semantics:=coalesce(metadata_value -> 'family_semantics','{}'::jsonb);
    new.family_source_event_key:=metadata_value ->> 'family_source_event_key'; new.family_version:=metadata_value ->> 'family_version';
  end if;
  new.normalized_payload:=coalesce(new.normalized_payload,'{}'::jsonb)||jsonb_build_object(
    'family_key',new.family_key,'family_title',new.family_title,'family_type',new.family_type,
    'family_child_key',new.family_child_key,'family_child_label',new.family_child_label,
    'family_sort_at',new.family_sort_at,'family_relationship',new.family_relationship,
    'family_semantics',new.family_semantics,'family_source_event_key',new.family_source_event_key,
    'family_version',new.family_version
  );
  return new;
end;
$function$;
revoke all on function private.assign_market_candidate_family_v4()
  from public,anon,authenticated,service_role;

create or replace function public.list_market_radar_candidates_v3(
  provider_filter text default null,
  category_filter text default null,
  quality_filter text default 'fit',
  query_filter text default null,
  order_key text default 'recommended',
  horizon_filter text default '180d',
  parent_limit_count integer default 60,
  parent_offset_count integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  result jsonb;
  checked_at_value timestamptz:=clock_timestamp();
begin
  perform private.require_current_admin();
  if provider_filter is not null and provider_filter<>'' and provider_filter not in ('polymarket','kalshi') then
    raise exception 'INVALID_RADAR_PROVIDER' using errcode='22023';
  end if;
  if order_key not in ('recommended','popularity','closing','recent') then
    raise exception 'INVALID_RADAR_ORDER' using errcode='22023';
  end if;
  if coalesce(quality_filter,'fit') not in ('fit','review','rejected','all') then
    raise exception 'INVALID_RADAR_QUALITY' using errcode='22023';
  end if;
  if horizon_filter not in ('30d','90d','180d','365d') then
    raise exception 'INVALID_RADAR_HORIZON' using errcode='22023';
  end if;
  if parent_limit_count not between 1 and 100 or parent_offset_count<0 then
    raise exception 'INVALID_RADAR_PAGE' using errcode='22023';
  end if;

  with candidate_base as materialized (
    select candidate.*,
      coalesce(nullif(candidate.event_group_key,''),nullif(candidate.family_source_event_key,''),
        candidate.provider||':'||coalesce(candidate.external_event_id,candidate.external_id)) as parent_key,
      private.market_radar_candidate_horizon_at_v1(candidate) as horizon_at,
      case when coalesce(candidate.normalized_payload ->> 'source_volume_total','')
          ~ '^-?[0-9]+(?:\.[0-9]+)?$'
        then (candidate.normalized_payload ->> 'source_volume_total')::numeric else 0 end as volume_value,
      coalesce(candidate.source_updated_at,candidate.fetched_at) as recent_at,
      eligibility.id as joined_eligibility_id,
      eligibility.expires_at as joined_eligibility_expires_at
    from private.external_market_candidates candidate
    left join private.market_radar_eligibility_checks eligibility
      on eligibility.id=candidate.current_eligibility_check_id
     and eligibility.candidate_id=candidate.id
    where candidate.normalizer_version='atinara-radar-v2'
      and candidate.family_version='atinara-market-family-v4'
      and candidate.family_key is not null and candidate.family_child_key is not null
      and (provider_filter is null or provider_filter='' or candidate.provider=provider_filter)
      and (category_filter is null or category_filter='' or candidate.atinara_category=category_filter)
      and (
        query_filter is null or query_filter=''
        or candidate.normalized_payload ->> 'source_title' ilike '%'||query_filter||'%'
        or candidate.normalized_payload ->> 'source_question' ilike '%'||query_filter||'%'
        or candidate.normalized_payload ->> 'atinara_question' ilike '%'||query_filter||'%'
      )
  ), matching as materialized (
    select candidate.* from candidate_base candidate
    where (
      coalesce(quality_filter,'fit')='fit' and candidate.state='available'
        and candidate.verification_status='verified_open' and candidate.quality_status='fit'
        and candidate.eligibility_status='eligible'
        and candidate.joined_eligibility_id is not null
        and candidate.joined_eligibility_expires_at>checked_at_value
      or coalesce(quality_filter,'fit')='review'
        and candidate.state in ('available','needs_review')
        and candidate.quality_status in ('fit','needs_review')
        and coalesce(candidate.eligibility_status,'technical_hold') not in ('terminal','duplicate','inactive_option','invalid')
      or coalesce(quality_filter,'fit')='all'
        and candidate.state in ('available','needs_review')
        and coalesce(candidate.eligibility_status,'technical_hold') not in ('terminal','duplicate','inactive_option','invalid')
      or coalesce(quality_filter,'fit')='rejected'
        and (candidate.state='rejected' or candidate.quality_status='rejected')
    )
    and (
      coalesce(quality_filter,'fit')='rejected'
      or candidate.horizon_at is null
      or (candidate.horizon_at>checked_at_value and candidate.horizon_at<=checked_at_value+case horizon_filter
        when '30d' then interval '30 days' when '90d' then interval '90 days'
        when '365d' then interval '365 days' else interval '180 days' end)
    )
    and (coalesce(quality_filter,'fit')='rejected' or not exists (
      select 1 from public.markets market_alias
      where market_alias.family_key=candidate.family_key
        and market_alias.family_child_key=candidate.family_child_key
    ))
    and (coalesce(quality_filter,'fit')='rejected' or not exists (
      select 1 from private.market_drafts draft_alias
      where (draft_alias.radar_candidate_id=candidate.id or (
        draft_alias.family_key=candidate.family_key
        and draft_alias.family_child_key=candidate.family_child_key))
        and draft_alias.workflow_status not in ('cancelled','annulled')
    ))
  ), parent_scores as materialized (
    select parent_key,max(quality_score) as quality_score,max(volume_value) as volume_value,
      min(horizon_at) as horizon_at,max(recent_at) as recent_at
    from matching group by parent_key
  ), ranked_parents as materialized (
    select parent_key,row_number() over (order by
      case when order_key='recommended' then quality_score end desc nulls last,
      case when order_key='popularity' then volume_value end desc nulls last,
      case when order_key='closing' then horizon_at end asc nulls last,
      case when order_key='recent' then recent_at end desc nulls last,
      quality_score desc nulls last,recent_at desc nulls last,parent_key
    ) as parent_rank
    from parent_scores
  ), selected_parents as materialized (
    select parent_key,parent_rank from ranked_parents
    where parent_rank>parent_offset_count
      and parent_rank<=parent_offset_count+parent_limit_count
  ), page_items as (
    select candidate.id as candidate_id,selected.parent_rank,candidate.quality_score,
      candidate.family_child_key,candidate.provider,candidate.external_id
    from matching candidate join selected_parents selected using(parent_key)
    order by selected.parent_rank,candidate.quality_score desc nulls last,
      candidate.family_child_key,candidate.provider,candidate.external_id
  )
  select jsonb_build_object(
    'items',coalesce((select jsonb_agg(private.market_radar_eligibility_payload(candidate_row)
      || jsonb_build_object('parent_rank',item.parent_rank)
      order by item.parent_rank,item.quality_score desc nulls last,item.family_child_key,item.provider,item.external_id)
      from page_items item
      join private.external_market_candidates candidate_row on candidate_row.id=item.candidate_id),'[]'::jsonb),
    'parent_count',(select count(*) from parent_scores),
    'parent_offset',parent_offset_count,
    'parent_limit',parent_limit_count,
    'next_parent_offset',case when parent_offset_count+parent_limit_count<(select count(*) from parent_scores)
      then parent_offset_count+parent_limit_count else null end,
    'quality_filter',coalesce(quality_filter,'fit'),
    'checked_at',checked_at_value
  ) into result;
  return result;
end;
$function$;
revoke all on function public.list_market_radar_candidates_v3(text,text,text,text,text,text,integer,integer)
  from public,anon,authenticated,service_role;
grant execute on function public.list_market_radar_candidates_v3(text,text,text,text,text,text,integer,integer)
  to authenticated;

create table private.market_publication_attempts_v1 (
  id uuid primary key,
  draft_id uuid not null references private.market_drafts(id),
  actor_id uuid,
  trigger_type text not null check (trigger_type in ('manual','scheduled','manual_retry')),
  expected_version bigint not null check (expected_version>0),
  request_hash text not null check (request_hash ~ '^[a-f0-9]{64}$'),
  attempt_number integer not null check (attempt_number > 0),
  status text not null check (status in ('published','scheduled','retry_wait','blocked_recoverable','failed_terminal')),
  retryable boolean not null,
  error_code text,
  issue_id uuid references private.market_workflow_issue_occurrences_v1(issue_id),
  next_retry_at timestamptz,
  response_payload jsonb not null,
  started_at timestamptz not null default clock_timestamp(),
  completed_at timestamptz not null default clock_timestamp(),
  unique (draft_id,attempt_number)
);
create index market_publication_attempts_due_v1_idx
  on private.market_publication_attempts_v1(status,next_retry_at,draft_id);
alter table private.market_publication_attempts_v1 enable row level security;
alter table private.market_publication_attempts_v1 force row level security;
revoke all on table private.market_publication_attempts_v1
  from public,anon,authenticated,service_role;
create trigger market_publication_attempts_append_only_v1
before update or delete on private.market_publication_attempts_v1
for each row execute function private.reject_market_workflow_append_only_v1();

create table private.market_repair_workflow_checkpoints_v1 (
  attempt_id uuid not null references private.market_repair_attempts(id),
  repair_round smallint not null check (repair_round between 1 and 3),
  draft_id uuid not null references private.market_drafts(id),
  expected_version bigint not null check (expected_version>0),
  expected_fingerprint text not null check (expected_fingerprint~'^[a-f0-9]{64}$'),
  resulting_version bigint not null check (resulting_version>=expected_version),
  resulting_fingerprint text not null check (resulting_fingerprint~'^[a-f0-9]{64}$'),
  repair_request_id uuid not null,
  review_attempt_id uuid not null,
  workflow_issue_ids jsonb not null default '[]'::jsonb check (
    jsonb_typeof(workflow_issue_ids)='array' and jsonb_array_length(workflow_issue_ids)<=40
  ),
  changed_fields jsonb not null default '[]'::jsonb check (jsonb_typeof(changed_fields)='array'),
  created_at timestamptz not null default clock_timestamp(),
  primary key(attempt_id,repair_round),
  unique(repair_request_id),
  unique(review_attempt_id)
);
alter table private.market_repair_workflow_checkpoints_v1 enable row level security;
alter table private.market_repair_workflow_checkpoints_v1 force row level security;
revoke all on table private.market_repair_workflow_checkpoints_v1
  from public,anon,authenticated,service_role;
create trigger market_repair_workflow_checkpoints_append_only_v1
before update or delete on private.market_repair_workflow_checkpoints_v1
for each row execute function private.reject_market_workflow_append_only_v1();

create or replace function private.assert_repair_checkpoint_issue_scope_v1(
  draft_id_input uuid,
  version_input bigint,
  workflow_issue_ids_input jsonb
)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare issue_id_value uuid;
begin
  if jsonb_typeof(workflow_issue_ids_input)<>'array'
     or jsonb_array_length(workflow_issue_ids_input)>40
     or exists (
       select 1 from jsonb_array_elements_text(workflow_issue_ids_input) value
       where value!~'^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     ) then raise exception 'REPAIR_CHECKPOINT_ISSUES_INVALID' using errcode='22023'; end if;
  for issue_id_value in select value::uuid
    from jsonb_array_elements_text(workflow_issue_ids_input) value
  loop
    if not exists (
      select 1 from private.market_workflow_issue_occurrences_v1 occurrence
      join private.market_workflow_issue_subject_links_v1 link on link.issue_id=occurrence.issue_id
      left join lateral (
        select event.new_status,event.owner_stage from private.market_workflow_issue_events_v1 event
        where event.issue_id=occurrence.issue_id
        order by event.occurred_at desc,event.id desc limit 1
      ) latest on true
      where occurrence.issue_id=issue_id_value
        and link.subject_type='market_draft' and link.subject_key=draft_id_input::text
        and link.subject_version=version_input::text
        and coalesce(latest.new_status,'open') not in ('resolved','superseded')
        and coalesce(latest.owner_stage,occurrence.owner_stage)='corrector'
        and occurrence.repairability in (
          'auto_repairable','human_editable','waiting_authoritative_source'
        )
    ) then raise exception 'REPAIR_ATTEMPT_ISSUE_SCOPE_INVALID' using errcode='40001'; end if;
  end loop;
end;
$function$;
revoke all on function private.assert_repair_checkpoint_issue_scope_v1(uuid,bigint,jsonb)
  from public,anon,authenticated,service_role;

create or replace function public.apply_market_draft_expert_repair_with_checkpoint_v1(
  draft_id_input uuid,
  expected_version_input bigint,
  draft_input jsonb,
  contract_input jsonb,
  sources_input jsonb,
  primary_source_check_id_input uuid,
  repair_meta_input jsonb,
  workflow_attempt_id_input uuid,
  repair_round_input smallint,
  repair_request_id_input uuid,
  review_attempt_id_input uuid,
  workflow_issue_ids_input jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor_id_value uuid:=private.require_current_admin();
  attempt private.market_repair_attempts%rowtype;
  result jsonb;
  resulting_version_value bigint;
  resulting_fingerprint_value text;
  checkpoint private.market_repair_workflow_checkpoints_v1%rowtype;
  previous_checkpoint private.market_repair_workflow_checkpoints_v1%rowtype;
  before_draft private.market_drafts%rowtype;
  resulting_draft private.market_drafts%rowtype;
  origin_candidate private.external_market_candidates%rowtype;
begin
  select * into attempt from private.market_repair_attempts
  where id=workflow_attempt_id_input and actor_id=actor_id_value
    and draft_id=draft_id_input
  for update;
  select * into before_draft from private.market_drafts
  where id=draft_id_input and content_version=expected_version_input for update;
  if not found then
    raise exception 'REPAIR_WORKFLOW_CHECKPOINT_SCOPE_INVALID' using errcode='40001';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('market-draft-workflow:'||draft_id_input::text,0));
  if private.market_draft_blocking_workflow_issue_v1(
    draft_id_input,expected_version_input,array['terminal']
  ) is not null then
    raise exception 'DRAFT_TERMINAL_NOT_REPAIRABLE' using errcode='55000';
  end if;
  if repair_round_input>1 then
    select * into previous_checkpoint from private.market_repair_workflow_checkpoints_v1
    where attempt_id=attempt.id and repair_round=repair_round_input-1;
  end if;
  if attempt.id is null or attempt.response_payload is not null
     or repair_round_input not between 1 and 3
     or repair_request_id_input is null or review_attempt_id_input is null
     or repair_meta_input ->> 'idempotency_key' is distinct from repair_request_id_input::text
     or (repair_round_input=1 and expected_version_input is distinct from attempt.expected_version)
     or (repair_round_input>1 and (previous_checkpoint.attempt_id is null
       or previous_checkpoint.resulting_version is distinct from expected_version_input
       or previous_checkpoint.resulting_fingerprint is distinct from before_draft.content_fingerprint)) then
    raise exception 'REPAIR_WORKFLOW_CHECKPOINT_SCOPE_INVALID' using errcode='40001';
  end if;
  perform private.assert_repair_checkpoint_issue_scope_v1(
    draft_id_input,expected_version_input,workflow_issue_ids_input
  );
  result:=public.apply_market_draft_expert_repair_v2(
    draft_id_input,expected_version_input,draft_input,contract_input,sources_input,
    primary_source_check_id_input,repair_meta_input
  );
  resulting_version_value:=coalesce(
    nullif(result #>> '{draft,content_version}','')::bigint,
    nullif(result ->> 'new_version','')::bigint
  );
  resulting_fingerprint_value:=coalesce(
    nullif(result #>> '{draft,content_fingerprint}',''),
    (select draft.content_fingerprint from private.market_drafts draft
      where draft.id=draft_id_input and draft.content_version=resulting_version_value)
  );
  if resulting_version_value is null
     or coalesce(resulting_fingerprint_value,'')!~'^[a-f0-9]{64}$' then
    raise exception 'REPAIR_WORKFLOW_CHECKPOINT_RESULT_INVALID' using errcode='55000';
  end if;
  select * into resulting_draft from private.market_drafts
  where id=draft_id_input and content_version=resulting_version_value
    and content_fingerprint=resulting_fingerprint_value;
  if not found then
    raise exception 'REPAIR_WORKFLOW_CHECKPOINT_RESULT_INVALID' using errcode='55000';
  end if;
  if resulting_draft.intelligence_origin_type='radar_candidate' then
    if resulting_draft.radar_candidate_id is null then
      raise exception 'RADAR_ELIGIBILITY_REQUIRED' using errcode='55000';
    end if;
    perform private.assert_market_candidate_draft_identity_v1(
      resulting_draft.radar_candidate_id,to_jsonb(resulting_draft)
    );
    select * into origin_candidate from private.external_market_candidates
    where id=resulting_draft.radar_candidate_id;
    if not found or row(
      resulting_draft.family_key,resulting_draft.family_title,resulting_draft.family_type,
      resulting_draft.family_child_key,resulting_draft.family_child_label,
      resulting_draft.family_sort_at,
      resulting_draft.family_semantics,resulting_draft.family_source_event_key,
      resulting_draft.family_version
    ) is distinct from row(
      origin_candidate.family_key,origin_candidate.family_title,origin_candidate.family_type,
      origin_candidate.family_child_key,origin_candidate.family_child_label,
      origin_candidate.family_sort_at,
      origin_candidate.family_semantics,origin_candidate.family_source_event_key,
      origin_candidate.family_version
    ) then
      raise exception 'CHILD_IDENTITY_MISMATCH' using errcode='55000';
    end if;
  end if;
  insert into private.market_repair_workflow_checkpoints_v1(
    attempt_id,repair_round,draft_id,expected_version,expected_fingerprint,
    resulting_version,resulting_fingerprint,repair_request_id,review_attempt_id,
    workflow_issue_ids,changed_fields
  ) values (
    attempt.id,repair_round_input,draft_id_input,expected_version_input,
    before_draft.content_fingerprint,resulting_version_value,resulting_fingerprint_value,
    repair_request_id_input,review_attempt_id_input,workflow_issue_ids_input,
    coalesce(repair_meta_input -> 'changed_fields','[]'::jsonb)
  ) on conflict (attempt_id,repair_round) do nothing;
  select * into checkpoint from private.market_repair_workflow_checkpoints_v1
  where attempt_id=attempt.id and repair_round=repair_round_input;
  if not found or checkpoint.draft_id is distinct from draft_id_input
     or checkpoint.expected_version is distinct from expected_version_input
     or checkpoint.expected_fingerprint is distinct from before_draft.content_fingerprint
     or checkpoint.resulting_version is distinct from resulting_version_value
     or checkpoint.resulting_fingerprint is distinct from resulting_fingerprint_value
     or checkpoint.repair_request_id is distinct from repair_request_id_input
     or checkpoint.review_attempt_id is distinct from review_attempt_id_input
     or checkpoint.workflow_issue_ids is distinct from workflow_issue_ids_input then
    raise exception 'REPAIR_WORKFLOW_CHECKPOINT_CONFLICT' using errcode='40001';
  end if;
  return result||jsonb_build_object(
    'workflow_attempt_id',attempt.id,'repair_round',checkpoint.repair_round,
    'review_attempt_id',checkpoint.review_attempt_id,'checkpointed',true
  );
end;
$function$;
revoke all on function public.apply_market_draft_expert_repair_with_checkpoint_v1(
  uuid,bigint,jsonb,jsonb,jsonb,uuid,jsonb,uuid,smallint,uuid,uuid,jsonb
) from public,anon,authenticated,service_role;
grant execute on function public.apply_market_draft_expert_repair_with_checkpoint_v1(
  uuid,bigint,jsonb,jsonb,jsonb,uuid,jsonb,uuid,smallint,uuid,uuid,jsonb
) to authenticated;

create or replace function public.checkpoint_market_draft_repair_noop_v1(
  workflow_attempt_id_input uuid,
  draft_id_input uuid,
  expected_version_input bigint,
  repair_round_input smallint,
  repair_request_id_input uuid,
  review_attempt_id_input uuid,
  workflow_issue_ids_input jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor_id_value uuid:=private.require_current_admin();
  attempt private.market_repair_attempts%rowtype;
  draft private.market_drafts%rowtype;
  previous_checkpoint private.market_repair_workflow_checkpoints_v1%rowtype;
  checkpoint private.market_repair_workflow_checkpoints_v1%rowtype;
begin
  select * into attempt from private.market_repair_attempts
  where id=workflow_attempt_id_input and actor_id=actor_id_value
    and draft_id=draft_id_input and response_payload is null
  for update;
  select * into draft from private.market_drafts
  where id=draft_id_input and content_version=expected_version_input;
  if repair_round_input>1 then
    select * into previous_checkpoint from private.market_repair_workflow_checkpoints_v1
    where attempt_id=workflow_attempt_id_input and repair_round=repair_round_input-1;
  end if;
  if attempt.id is null or draft.id is null or repair_round_input not between 1 and 3
     or repair_request_id_input is null or review_attempt_id_input is null
     or (repair_round_input=1 and expected_version_input is distinct from attempt.expected_version)
     or (repair_round_input>1 and (previous_checkpoint.attempt_id is null
       or previous_checkpoint.resulting_version is distinct from expected_version_input
       or previous_checkpoint.resulting_fingerprint is distinct from draft.content_fingerprint)) then
    raise exception 'REPAIR_WORKFLOW_CHECKPOINT_SCOPE_INVALID' using errcode='40001';
  end if;
  perform private.assert_repair_checkpoint_issue_scope_v1(
    draft_id_input,expected_version_input,workflow_issue_ids_input
  );
  insert into private.market_repair_workflow_checkpoints_v1(
    attempt_id,repair_round,draft_id,expected_version,expected_fingerprint,
    resulting_version,resulting_fingerprint,repair_request_id,review_attempt_id,
    workflow_issue_ids,changed_fields
  ) values (
    attempt.id,repair_round_input,draft.id,expected_version_input,draft.content_fingerprint,
    expected_version_input,draft.content_fingerprint,repair_request_id_input,
    review_attempt_id_input,workflow_issue_ids_input,'[]'::jsonb
  ) on conflict (attempt_id,repair_round) do nothing;
  select * into checkpoint from private.market_repair_workflow_checkpoints_v1
  where attempt_id=attempt.id and repair_round=repair_round_input;
  if not found or checkpoint.resulting_version is distinct from expected_version_input
     or checkpoint.resulting_fingerprint is distinct from draft.content_fingerprint
     or checkpoint.repair_request_id is distinct from repair_request_id_input
     or checkpoint.review_attempt_id is distinct from review_attempt_id_input
     or checkpoint.workflow_issue_ids is distinct from workflow_issue_ids_input then
    raise exception 'REPAIR_WORKFLOW_CHECKPOINT_CONFLICT' using errcode='40001';
  end if;
  return jsonb_build_object('ok',true,'checkpointed',true,'no_op',true,
    'attempt_id',attempt.id,'repair_round',checkpoint.repair_round,
    'resulting_version',checkpoint.resulting_version,
    'resulting_fingerprint',checkpoint.resulting_fingerprint,
    'review_attempt_id',checkpoint.review_attempt_id);
end;
$function$;
revoke all on function public.checkpoint_market_draft_repair_noop_v1(
  uuid,uuid,bigint,smallint,uuid,uuid,jsonb
) from public,anon,authenticated,service_role;
grant execute on function public.checkpoint_market_draft_repair_noop_v1(
  uuid,uuid,bigint,smallint,uuid,uuid,jsonb
) to authenticated;

create or replace function public.begin_market_draft_repair_workflow_v1(
  draft_id_input uuid,
  expected_version_input bigint,
  request_key_input uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor_id_value uuid:=private.require_current_admin();
  attempt private.market_repair_attempts%rowtype;
  checkpoint private.market_repair_workflow_checkpoints_v1%rowtype;
  draft private.market_drafts%rowtype;
begin
  select * into attempt from private.market_repair_attempts
  where actor_id=actor_id_value and draft_id=draft_id_input and request_key=request_key_input
  for update;
  if found and attempt.expected_version is distinct from expected_version_input then
    raise exception 'IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD' using errcode='22023';
  end if;
  if found and attempt.response_payload is not null then
    return attempt.response_payload||jsonb_build_object(
      'attempt_id',attempt.id,'idempotency_replay',true,
      'state_preserved',attempt.state_preserved
    );
  end if;
  if found then
    select * into checkpoint from private.market_repair_workflow_checkpoints_v1
    where attempt_id=attempt.id order by repair_round desc limit 1;
    if found then
      select * into draft from private.market_drafts where id=draft_id_input;
      if draft.content_version is distinct from checkpoint.resulting_version
         or draft.content_fingerprint is distinct from checkpoint.resulting_fingerprint then
        raise exception 'REPAIR_WORKFLOW_CHECKPOINT_STALE' using errcode='40001';
      end if;
      return jsonb_build_object(
        'ok',true,'status','completion_required','attempt_id',attempt.id,
        'idempotency_replay',true,'state_preserved',true,
        'expected_version',attempt.expected_version,
        'resulting_version',checkpoint.resulting_version,
        'resulting_fingerprint',checkpoint.resulting_fingerprint,
        'review_attempt_id',checkpoint.review_attempt_id,
        'repair_round',checkpoint.repair_round
      );
    end if;
  end if;
  select * into draft from private.market_drafts where id=draft_id_input for update;
  if not found then raise exception 'DRAFT_NOT_FOUND' using errcode='P0001'; end if;
  perform pg_advisory_xact_lock(hashtextextended('market-draft-workflow:'||draft.id::text,0));
  if private.market_draft_blocking_workflow_issue_v1(
    draft.id,draft.content_version,array['terminal']
  ) is not null then
    raise exception 'DRAFT_TERMINAL_NOT_REPAIRABLE' using errcode='55000';
  end if;
  if draft.workflow_status='human_confirmed' and exists (
    select 1 from private.market_workflow_issue_occurrences_v1 occurrence
    join private.market_workflow_issue_subject_links_v1 link on link.issue_id=occurrence.issue_id
    left join lateral (
      select event.new_status,event.owner_stage from private.market_workflow_issue_events_v1 event
      where event.issue_id=occurrence.issue_id
      order by event.occurred_at desc,event.id desc limit 1
    ) latest on true
    where link.subject_type='market_draft' and link.subject_key=draft.id::text
      and link.subject_version=draft.content_version::text
      and occurrence.blocking_scope='publication'
      and coalesce(latest.owner_stage,occurrence.owner_stage)='corrector'
      and occurrence.repairability in ('auto_repairable','human_editable','waiting_authoritative_source')
      and coalesce(latest.new_status,'open') not in ('resolved','superseded')
  ) then
    raise exception 'PUBLICATION_EVIDENCE_REVALIDATION_REQUIRED' using errcode='55000';
  end if;
  return public.begin_market_draft_repair_attempt_v1(
    draft_id_input,expected_version_input,request_key_input
  );
end;
$function$;
revoke all on function public.begin_market_draft_repair_workflow_v1(uuid,bigint,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.begin_market_draft_repair_workflow_v1(uuid,bigint,uuid)
  to authenticated;

create or replace function public.revalidate_market_draft_publication_evidence_v1(
  draft_id_input uuid,
  expected_version_input bigint,
  expected_fingerprint_input text,
  issue_ids_input jsonb,
  primary_source_check_id_input uuid,
  request_id_input uuid,
  actor_id_input uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  draft private.market_drafts%rowtype;
  source_check private.market_draft_primary_source_checks%rowtype;
  previous_source_check private.market_draft_primary_source_checks%rowtype;
  effective_review private.market_effective_reviews%rowtype;
  requested_ids uuid[];
  active_blocking_ids uuid[];
  issue_id_value uuid;
  issue_status_value text;
  remaining_count integer;
  binding_state jsonb;
  request_hash_value text;
  replay_hash_value text;
  replay_action_value text;
  replay_execution_mode_value text;
  content_changed boolean:=false;
  confirmation_audit_detail jsonb;
  baseline_fingerprint_value text;
  baseline_issue jsonb;
  baseline_issue_id uuid;
  authority_workflow_status text;
  execution_mode_value text;
begin
  if auth.role()<>'service_role' then
    raise exception 'SERVICE_ROLE_REQUIRED' using errcode='42501';
  end if;
  if request_id_input is null or expected_version_input<1
     or coalesce(expected_fingerprint_input,'')!~'^[a-f0-9]{64}$'
     or jsonb_typeof(issue_ids_input)<>'array' or jsonb_array_length(issue_ids_input) not between 1 and 40
     or exists (select 1 from jsonb_array_elements_text(issue_ids_input) value
       where value!~'^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$') then
    raise exception 'PUBLICATION_EVIDENCE_REVALIDATION_INVALID' using errcode='22023';
  end if;
  select array_agg(value::uuid order by value::uuid) into requested_ids
  from jsonb_array_elements_text(issue_ids_input) value;
  if cardinality(requested_ids) is distinct from jsonb_array_length(issue_ids_input) then
    raise exception 'PUBLICATION_EVIDENCE_REVALIDATION_INVALID' using errcode='22023';
  end if;
  if actor_id_input is not null and not exists (
    select 1 from auth.users admin_user where admin_user.id=actor_id_input
      and admin_user.raw_app_meta_data -> 'oraklo_admin'='true'::jsonb
  ) then
    raise exception 'ADMIN_REQUIRED' using errcode='42501';
  end if;
  request_hash_value:=encode(extensions.digest(convert_to(
    private.market_workflow_canonical_json_v1(jsonb_build_object(
      'draft_id',draft_id_input,'expected_version',expected_version_input,
      'expected_fingerprint',lower(expected_fingerprint_input),'issue_ids',to_jsonb(requested_ids),
      'actor_id',actor_id_input
    )),'UTF8'),'sha256'),'hex');
  perform pg_advisory_xact_lock(hashtextextended('market-draft-workflow:'||draft_id_input::text,0));
  perform pg_advisory_xact_lock(hashtextextended('publication-evidence-revalidation:'||request_id_input::text,0));
  select * into draft from private.market_drafts where id=draft_id_input for update;
  if not found then raise exception 'DRAFT_NOT_FOUND' using errcode='P0001'; end if;
  if draft.content_version is distinct from expected_version_input
     or draft.content_fingerprint is distinct from lower(expected_fingerprint_input) then
    raise exception 'DRAFT_VERSION_MOVED' using errcode='40001';
  end if;
  authority_workflow_status:=draft.workflow_status;
  execution_mode_value:=case when actor_id_input is null then 'scheduled' else 'manual' end;
  select audit.detail ->> 'request_hash',audit.action_code,audit.detail ->> 'execution_mode'
    into replay_hash_value,replay_action_value,replay_execution_mode_value
  from private.market_admin_audit audit
    where audit.action_code in (
      'PUBLICATION_EVIDENCE_REVALIDATED','PUBLICATION_EVIDENCE_CHANGE_DETECTED',
      'PUBLICATION_EVIDENCE_BASELINE_REVIEW_REQUIRED'
    )
      and audit.draft_id=draft.id and audit.draft_version=draft.content_version
      and audit.detail ->> 'request_id'=request_id_input::text
  order by audit.created_at desc,audit.id desc limit 1;
  if replay_hash_value is not null then
    if replay_hash_value is distinct from request_hash_value then
      raise exception 'PUBLICATION_EVIDENCE_REQUEST_REUSED' using errcode='40001';
    end if;
    return jsonb_build_object('ok',true,'status',case
        when replay_action_value='PUBLICATION_EVIDENCE_CHANGE_DETECTED'
          then 'repair_required'
        when replay_action_value='PUBLICATION_EVIDENCE_BASELINE_REVIEW_REQUIRED'
          then 'validation_required'
        when replay_execution_mode_value='scheduled' then 'scheduled'
        else 'human_confirmed' end,
      'draft_id',draft.id,'content_version',draft.content_version,
      'content_fingerprint',draft.content_fingerprint,
      'authority_preserved',replay_action_value='PUBLICATION_EVIDENCE_REVALIDATED',
      'content_changed',replay_action_value='PUBLICATION_EVIDENCE_CHANGE_DETECTED',
      'idempotency_replay',true,'next_action',case
        when replay_action_value='PUBLICATION_EVIDENCE_CHANGE_DETECTED'
          then 'repair_temporal_or_source_contract'
        when replay_action_value='PUBLICATION_EVIDENCE_BASELINE_REVIEW_REQUIRED'
          then 'request_market_validation'
        when replay_execution_mode_value='scheduled' then 'wait_for_scheduled_publication'
        else 'revalidate_and_publish' end,
      'publishes',false);
  end if;
  if (actor_id_input is null and (
        draft.workflow_status<>'scheduled'
        or draft.publication_schedule_status not in (
          'scheduled_blocked_recoverable','scheduled_waiting'
        )
      )) or (actor_id_input is not null and draft.workflow_status<>'human_confirmed') then
    raise exception 'PUBLICATION_EVIDENCE_AUTHORITY_MOVED' using errcode='40001';
  end if;
  if draft.human_confirmed_fingerprint is distinct from draft.content_fingerprint
     or draft.human_confirmed_review_id is distinct from draft.effective_review_id
     or draft.human_confirmed_by is null or draft.human_confirmed_at is null
     or draft.effective_review_id is null then
    raise exception 'PUBLICATION_EVIDENCE_AUTHORITY_MOVED' using errcode='40001';
  end if;
  select * into effective_review from private.market_effective_reviews effective
  where effective.id=draft.effective_review_id and effective.draft_id=draft.id
    and effective.draft_version=draft.content_version
    and effective.content_fingerprint=draft.content_fingerprint and effective.active;
  if not found then raise exception 'PUBLICATION_EVIDENCE_AUTHORITY_MOVED' using errcode='40001'; end if;
  select audit.detail into confirmation_audit_detail
  from private.market_admin_audit audit
  where audit.action_code in ('HUMAN_CONFIRMATION_RECORDED','HUMAN_CONFIRMATION_CARRIED_FORWARD')
    and audit.draft_id=draft.id and audit.draft_version=draft.content_version
    and audit.detail ->> 'content_fingerprint'=draft.content_fingerprint
  order by audit.created_at desc,audit.id desc limit 1;
  if confirmation_audit_detail is null then
    raise exception 'PUBLICATION_EVIDENCE_AUTHORITY_MOVED' using errcode='40001';
  end if;
  select * into source_check from private.market_draft_primary_source_checks check_row
  where check_row.id=primary_source_check_id_input and check_row.draft_id=draft.id
    and check_row.draft_version=draft.content_version
    and check_row.id=(
      select latest.id from private.market_draft_primary_source_checks latest
      where latest.draft_id=draft.id and latest.draft_version=draft.content_version
      order by latest.checked_at desc,latest.id desc limit 1
    )
    and private.market_draft_primary_source_check_is_current_v1(
      check_row.id,draft.id,draft.content_version
  );
  if not found then
    if exists (select 1 from private.market_draft_primary_source_checks existing
      where existing.id=primary_source_check_id_input and existing.draft_id=draft.id
        and existing.draft_version=draft.content_version) then
      raise exception 'PRIMARY_SOURCE_CHECK_NOT_LATEST' using errcode='40001';
    end if;
    raise exception 'PRIMARY_SOURCE_CHECK_REQUIRED' using errcode='55000';
  end if;
  foreach issue_id_value in array requested_ids loop
    perform pg_advisory_xact_lock(hashtextextended(issue_id_value::text,0));
  end loop;
  select array_agg(occurrence.issue_id order by occurrence.issue_id) into active_blocking_ids
  from private.market_workflow_issue_occurrences_v1 occurrence
  join private.market_workflow_issue_subject_links_v1 link on link.issue_id=occurrence.issue_id
  left join lateral (
    select event.new_status,event.owner_stage,event.next_action
    from private.market_workflow_issue_events_v1 event where event.issue_id=occurrence.issue_id
    order by event.occurred_at desc,event.id desc limit 1
  ) latest on true
  where link.subject_type='market_draft' and link.subject_key=draft.id::text
    and link.subject_version=draft.content_version::text
    and occurrence.blocking_scope in ('approval','human_confirmation','publication','terminal')
    and coalesce(latest.new_status,'open') not in ('resolved','superseded');
  if coalesce(active_blocking_ids,'{}'::uuid[]) is distinct from requested_ids then
    raise exception 'MARKET_WORKFLOW_EVIDENCE_REVALIDATION_SCOPE_MOVED' using errcode='40001';
  end if;
  if exists (
    select 1 from private.market_workflow_issue_occurrences_v1 occurrence
    left join lateral (
      select event.new_status,event.owner_stage,event.next_action
      from private.market_workflow_issue_events_v1 event where event.issue_id=occurrence.issue_id
      order by event.occurred_at desc,event.id desc limit 1
    ) latest on true
    where occurrence.issue_id=any(requested_ids)
      and (occurrence.blocking_scope<>'publication'
        or coalesce(latest.owner_stage,occurrence.owner_stage)<>'corrector'
        or coalesce(latest.next_action,occurrence.next_action)<>'revalidate_temporal_evidence'
        or occurrence.repairability not in ('auto_repairable','human_editable','waiting_authoritative_source')
        or coalesce(latest.new_status,'open') in ('resolved','superseded'))
  ) then raise exception 'MARKET_WORKFLOW_EVIDENCE_REVALIDATION_SCOPE_MOVED' using errcode='40001'; end if;
  if effective_review.source_check_id is null
     or effective_review.source_evidence_fingerprint is null then
    baseline_issue:=private.market_workflow_server_issue_v1(
      'PUBLICATION_EVIDENCE_BASELINE_MISSING','publication_gate','validator',
      'auto_recoverable','approval','request_market_validation',
      jsonb_build_object('draft_id',draft.id,'draft_version',draft.content_version,
        'primary_source_check_id',source_check.id,'request_id',request_id_input),
      true,'atinara-publication-evidence-v1'
    );
    baseline_issue_id:=private.record_market_workflow_issue_v1(
      'market_draft',draft.id::text,draft.content_version::text,draft.content_fingerprint,
      baseline_issue,null,null
    );
    baseline_issue:=jsonb_set(baseline_issue,'{issue_id}',to_jsonb(baseline_issue_id),true);
    perform pg_advisory_xact_lock(hashtextextended(baseline_issue_id::text,0));
    select coalesce(latest.new_status,'open') into issue_status_value
    from private.market_workflow_issue_occurrences_v1 occurrence
    left join lateral (
      select event.new_status from private.market_workflow_issue_events_v1 event
      where event.issue_id=occurrence.issue_id order by event.occurred_at desc,event.id desc limit 1
    ) latest on true where occurrence.issue_id=baseline_issue_id;
    if issue_status_value<>'waiting' then
      insert into private.market_workflow_issue_events_v1(
        issue_id,event_type,previous_status,new_status,actor_id,owner_stage,next_action,
        resolution_method,evidence_refs
      ) values (
        baseline_issue_id,'waiting',issue_status_value,'waiting',actor_id_input,'validator',
        'request_market_validation','publication_evidence_baseline_missing',
        jsonb_build_array(jsonb_build_object(
          'primary_source_check_id',source_check.id,'request_id',request_id_input
        ))
      );
    end if;
    foreach issue_id_value in array requested_ids loop
      select coalesce(latest.new_status,'open') into issue_status_value
      from private.market_workflow_issue_occurrences_v1 occurrence
      left join lateral (
        select event.new_status from private.market_workflow_issue_events_v1 event
        where event.issue_id=occurrence.issue_id order by event.occurred_at desc,event.id desc limit 1
      ) latest on true where occurrence.issue_id=issue_id_value;
      if issue_status_value not in ('resolved','superseded') then
        insert into private.market_workflow_issue_events_v1(
          issue_id,event_type,previous_status,new_status,actor_id,owner_stage,next_action,
          resolution_method,evidence_refs
        ) values (
          issue_id_value,'superseded',issue_status_value,'superseded',actor_id_input,
          'validator','request_market_validation','publication_evidence_baseline_missing',
          jsonb_build_array(jsonb_build_object('replacement_issue_id',baseline_issue_id))
        );
      end if;
    end loop;
    update private.market_effective_reviews set active=false,
      superseded_at=coalesce(superseded_at,clock_timestamp())
    where id=effective_review.id and active;
    update private.market_drafts set workflow_status='draft_ready',review_status='not_requested',
      effective_review_id=null,reviewed_version=null,reviewed_fingerprint=null,
      human_confirmed_at=null,human_confirmed_by=null,human_confirmed_fingerprint=null,
      human_confirmed_review_id=null,scheduled_for=null,
      publication_schedule_status=case when authority_workflow_status='scheduled'
        then 'scheduled_cancelled' else publication_schedule_status end,
      publication_next_retry_at=null,updated_at=clock_timestamp(),updated_by=actor_id_input
    where id=draft.id;
    select count(*)::integer into remaining_count
    from private.market_workflow_issue_occurrences_v1 occurrence
    join private.market_workflow_issue_subject_links_v1 link on link.issue_id=occurrence.issue_id
    left join lateral (
      select event.new_status from private.market_workflow_issue_events_v1 event
      where event.issue_id=occurrence.issue_id order by event.occurred_at desc,event.id desc limit 1
    ) latest on true
    where link.subject_type='market_draft' and link.subject_key=draft.id::text
      and link.subject_version=draft.content_version::text
      and coalesce(latest.new_status,'open') not in ('resolved','superseded');
    update private.market_drafts set artifact_status='draft_ready_for_validation',
      workflow_owner_stage='validator',workflow_next_action='request_market_validation',
      workflow_issue_count=remaining_count where id=draft.id;
    insert into private.market_admin_audit(actor_id,action_code,draft_id,draft_version,detail)
    values (actor_id_input,'PUBLICATION_EVIDENCE_BASELINE_REVIEW_REQUIRED',
      draft.id,draft.content_version,jsonb_build_object(
        'request_id',request_id_input,'request_hash',request_hash_value,
        'execution_mode',execution_mode_value,'primary_source_check_id',source_check.id,
        'issue_ids',issue_ids_input,'replacement_issue_id',baseline_issue_id,
        'approval_invalidated',true,'confirmation_invalidated',true,
        'original_confirmed_by',draft.human_confirmed_by,'publishes',false
      ));
    return jsonb_build_object('ok',true,'status','validation_required',
      'draft_id',draft.id,'content_version',draft.content_version,
      'content_fingerprint',draft.content_fingerprint,'issue',baseline_issue,
      'authority_preserved',false,'baseline_missing',true,'idempotency_replay',false,
      'next_action','request_market_validation','publishes',false);
  end if;
  content_changed:=source_check.final_url is distinct from coalesce(draft.primary_source ->> 'url','');
  if not content_changed then
    select * into previous_source_check
    from private.market_draft_primary_source_checks check_row
    where check_row.id=effective_review.source_check_id;
    if not found then
      raise exception 'PUBLICATION_EVIDENCE_BASELINE_MISSING' using errcode='55000';
    end if;
    baseline_fingerprint_value:=encode(extensions.digest(convert_to(
      private.market_workflow_canonical_json_v1(jsonb_build_object(
        'registry_source_id',previous_source_check.registry_source_id,
        'final_url',previous_source_check.final_url,
        'excerpt_sha256',previous_source_check.evidence_snapshot ->> 'excerpt_sha256',
        'matched_tokens',previous_source_check.evidence_snapshot -> 'matched_tokens'
      )),'UTF8'),'sha256'),'hex');
    if baseline_fingerprint_value is distinct from effective_review.source_evidence_fingerprint then
      raise exception 'PUBLICATION_EVIDENCE_BASELINE_MISSING' using errcode='55000';
    end if;
    content_changed:=previous_source_check.registry_source_id is distinct from source_check.registry_source_id
      or previous_source_check.evidence_snapshot ->> 'excerpt_sha256'
        is distinct from source_check.evidence_snapshot ->> 'excerpt_sha256'
      or previous_source_check.evidence_snapshot -> 'matched_tokens'
        is distinct from source_check.evidence_snapshot -> 'matched_tokens';
  end if;
  binding_state:=private.market_binding_compatibility(draft.id);
  if coalesce((binding_state ->> 'compatible')::boolean,false) is not true then
    content_changed:=true;
  elsif coalesce((binding_state ->> 'required')::boolean,false) then
    content_changed:=confirmation_audit_detail ->> 'binding_id'
        is distinct from binding_state ->> 'binding_id'
      or confirmation_audit_detail ->> 'binding_plan_version'
        is distinct from binding_state ->> 'plan_version';
  elsif nullif(confirmation_audit_detail ->> 'binding_id','') is not null then
    content_changed:=true;
  end if;
  if content_changed then
    update private.market_effective_reviews set active=false,
      superseded_at=coalesce(superseded_at,clock_timestamp())
    where id=effective_review.id and active;
    update private.market_drafts set workflow_status='draft_ready',review_status='not_requested',
      effective_review_id=null,reviewed_version=null,reviewed_fingerprint=null,
      human_confirmed_at=null,human_confirmed_by=null,human_confirmed_fingerprint=null,
      human_confirmed_review_id=null,artifact_status='repair_pending',
      workflow_owner_stage='corrector',workflow_next_action='repair_temporal_or_source_contract',
      workflow_issue_count=cardinality(requested_ids),scheduled_for=null,
      publication_schedule_status=case when authority_workflow_status='scheduled'
        then 'scheduled_cancelled' else publication_schedule_status end,
      publication_next_retry_at=null,updated_at=clock_timestamp(),updated_by=actor_id_input
    where id=draft.id;
    insert into private.market_admin_audit(actor_id,action_code,draft_id,draft_version,detail)
    values (actor_id_input,'PUBLICATION_EVIDENCE_CHANGE_DETECTED',draft.id,draft.content_version,
      jsonb_build_object('request_id',request_id_input,'request_hash',request_hash_value,
        'primary_source_check_id',source_check.id,'baseline_source_check_id',previous_source_check.id,
        'content_fingerprint',draft.content_fingerprint,'effective_review_id',effective_review.id,
        'binding_id',binding_state ->> 'binding_id',
        'binding_plan_version',binding_state ->> 'plan_version',
        'execution_mode',execution_mode_value,
        'issue_ids',issue_ids_input,'content_changed',true,'approval_invalidated',true,
        'confirmation_invalidated',true,'original_confirmed_by',draft.human_confirmed_by,'publishes',false));
    return jsonb_build_object('ok',true,'status','repair_required','draft_id',draft.id,
      'content_version',draft.content_version,'content_fingerprint',draft.content_fingerprint,
      'authority_preserved',false,'content_changed',true,'idempotency_replay',false,
      'next_action','repair_temporal_or_source_contract','publishes',false);
  end if;
  foreach issue_id_value in array requested_ids loop
    select coalesce(latest.new_status,'open') into issue_status_value
    from private.market_workflow_issue_occurrences_v1 occurrence
    left join lateral (
      select event.new_status from private.market_workflow_issue_events_v1 event
      where event.issue_id=occurrence.issue_id order by event.occurred_at desc,event.id desc limit 1
    ) latest on true where occurrence.issue_id=issue_id_value;
    insert into private.market_workflow_issue_events_v1(
      issue_id,event_type,previous_status,new_status,actor_id,owner_stage,next_action,
      resolution_method,evidence_refs
    ) values (
      issue_id_value,'resolved',issue_status_value,'resolved',actor_id_input,'publication_gate',
      'revalidate_and_publish','publication_evidence_revalidated',jsonb_build_array(jsonb_build_object(
        'primary_source_check_id',source_check.id,'request_id',request_id_input
      ))
    );
  end loop;
  select count(*)::integer into remaining_count
  from private.market_workflow_issue_occurrences_v1 occurrence
  join private.market_workflow_issue_subject_links_v1 link on link.issue_id=occurrence.issue_id
  left join lateral (
    select event.new_status from private.market_workflow_issue_events_v1 event
    where event.issue_id=occurrence.issue_id order by event.occurred_at desc,event.id desc limit 1
  ) latest on true
  where link.subject_type='market_draft' and link.subject_key=draft.id::text
    and link.subject_version=draft.content_version::text
    and coalesce(latest.new_status,'open') not in ('resolved','superseded');
  update private.market_drafts set artifact_status=case when authority_workflow_status='scheduled'
      then 'scheduled' else 'human_confirmed' end,
    workflow_owner_stage='publication_gate',workflow_next_action=case
      when authority_workflow_status='scheduled' then 'wait_for_scheduled_publication'
      else 'revalidate_and_publish' end,
    publication_schedule_status=case when authority_workflow_status='scheduled'
      then 'scheduled_waiting' else publication_schedule_status end,
    publication_next_retry_at=case when authority_workflow_status='scheduled'
      then clock_timestamp() else publication_next_retry_at end,
    workflow_issue_count=remaining_count,updated_at=clock_timestamp()
  where id=draft.id;
  insert into private.market_admin_audit(actor_id,action_code,draft_id,draft_version,detail)
  values (actor_id_input,'PUBLICATION_EVIDENCE_REVALIDATED',draft.id,draft.content_version,
    jsonb_build_object('request_id',request_id_input,'primary_source_check_id',source_check.id,
      'baseline_source_check_id',previous_source_check.id,
      'content_fingerprint',draft.content_fingerprint,'effective_review_id',effective_review.id,
      'binding_id',binding_state ->> 'binding_id',
      'binding_plan_version',binding_state ->> 'plan_version',
      'execution_mode',execution_mode_value,
      'request_hash',request_hash_value,'original_confirmed_by',draft.human_confirmed_by,
      'issue_ids',issue_ids_input,'content_changed',false,'approval_preserved',true,
      'confirmation_preserved',true,'publishes',false));
  return jsonb_build_object('ok',true,'status',case when authority_workflow_status='scheduled'
      then 'scheduled' else 'human_confirmed' end,
    'draft_id',draft.id,'content_version',draft.content_version,
    'content_fingerprint',draft.content_fingerprint,'primary_source_check_id',source_check.id,
    'resolved_issue_ids',issue_ids_input,'workflow_issue_count',remaining_count,
    'authority_preserved',true,'idempotency_replay',false,
    'next_action',case when authority_workflow_status='scheduled'
      then 'wait_for_scheduled_publication' else 'revalidate_and_publish' end,
    'publishes',false);
end;
$function$;
revoke all on function public.revalidate_market_draft_publication_evidence_v1(
  uuid,bigint,text,jsonb,uuid,uuid,uuid
) from public,anon,authenticated,service_role;
grant execute on function public.revalidate_market_draft_publication_evidence_v1(
  uuid,bigint,text,jsonb,uuid,uuid,uuid
) to service_role;

create or replace function public.get_market_draft_publication_evidence_revalidation_replay_v1(
  draft_id_input uuid,
  expected_version_input bigint,
  expected_fingerprint_input text,
  issue_ids_input jsonb,
  request_id_input uuid,
  actor_id_input uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  requested_ids uuid[];
  request_hash_value text;
  audit_action text;
  audit_detail jsonb;
begin
  if auth.role()<>'service_role' then raise exception 'SERVICE_ROLE_REQUIRED' using errcode='42501'; end if;
  if draft_id_input is null or request_id_input is null or actor_id_input is null
     or expected_version_input<1 or coalesce(expected_fingerprint_input,'')!~'^[a-f0-9]{64}$'
     or jsonb_typeof(issue_ids_input)<>'array' or jsonb_array_length(issue_ids_input) not between 1 and 40
     or exists (select 1 from jsonb_array_elements_text(issue_ids_input) value
       where value!~'^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$') then
    raise exception 'PUBLICATION_EVIDENCE_REVALIDATION_INVALID' using errcode='22023';
  end if;
  select array_agg(value::uuid order by value::uuid) into requested_ids
  from jsonb_array_elements_text(issue_ids_input) value;
  request_hash_value:=encode(extensions.digest(convert_to(
    private.market_workflow_canonical_json_v1(jsonb_build_object(
      'draft_id',draft_id_input,'expected_version',expected_version_input,
      'expected_fingerprint',lower(expected_fingerprint_input),'issue_ids',to_jsonb(requested_ids),
      'actor_id',actor_id_input
    )),'UTF8'),'sha256'),'hex');
  select audit.action_code,audit.detail into audit_action,audit_detail
  from private.market_admin_audit audit
  where audit.action_code in (
    'PUBLICATION_EVIDENCE_REVALIDATED','PUBLICATION_EVIDENCE_CHANGE_DETECTED',
    'PUBLICATION_EVIDENCE_BASELINE_REVIEW_REQUIRED'
  )
    and audit.draft_id=draft_id_input and audit.draft_version=expected_version_input
    and audit.detail ->> 'request_id'=request_id_input::text
  order by audit.created_at desc,audit.id desc limit 1;
  if audit_action is null then return jsonb_build_object('replayed',false); end if;
  if audit_detail ->> 'request_hash' is distinct from request_hash_value then
    raise exception 'PUBLICATION_EVIDENCE_REQUEST_REUSED' using errcode='40001';
  end if;
  return jsonb_build_object('ok',true,'replayed',true,'idempotency_replay',true,
    'status',case when audit_action='PUBLICATION_EVIDENCE_CHANGE_DETECTED'
      then 'repair_required'
      when audit_action='PUBLICATION_EVIDENCE_BASELINE_REVIEW_REQUIRED'
      then 'validation_required' else 'human_confirmed' end,
    'draft_id',draft_id_input,'content_version',expected_version_input,
    'content_fingerprint',lower(expected_fingerprint_input),
    'authority_preserved',audit_action='PUBLICATION_EVIDENCE_REVALIDATED',
    'content_changed',audit_action='PUBLICATION_EVIDENCE_CHANGE_DETECTED',
    'next_action',case when audit_action='PUBLICATION_EVIDENCE_CHANGE_DETECTED'
      then 'repair_temporal_or_source_contract'
      when audit_action='PUBLICATION_EVIDENCE_BASELINE_REVIEW_REQUIRED'
      then 'request_market_validation' else 'revalidate_and_publish' end,
    'publishes',false);
end;
$function$;
revoke all on function public.get_market_draft_publication_evidence_revalidation_replay_v1(
  uuid,bigint,text,jsonb,uuid,uuid
) from public,anon,authenticated,service_role;
grant execute on function public.get_market_draft_publication_evidence_revalidation_replay_v1(
  uuid,bigint,text,jsonb,uuid,uuid
) to service_role;

create or replace function public.prepare_market_draft_repair_revalidation_v1(
  attempt_id_input uuid,
  repair_round_input smallint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  attempt private.market_repair_attempts%rowtype;
  checkpoint private.market_repair_workflow_checkpoints_v1%rowtype;
  draft private.market_drafts%rowtype;
  issue_id_value uuid;
  latest_status_value text;
  latest_owner_value text;
  latest_action_value text;
  prepared_count integer:=0;
begin
  if auth.role()<>'service_role' then
    raise exception 'SERVICE_ROLE_REQUIRED' using errcode='42501';
  end if;
  select * into attempt from private.market_repair_attempts
  where id=attempt_id_input and response_payload is null for update;
  select * into checkpoint from private.market_repair_workflow_checkpoints_v1
  where attempt_id=attempt_id_input and repair_round=repair_round_input;
  if attempt.id is null or checkpoint.attempt_id is null then
    raise exception 'REPAIR_WORKFLOW_CHECKPOINT_REQUIRED' using errcode='40001';
  end if;
  select * into draft from private.market_drafts where id=attempt.draft_id for update;
  if not found or draft.content_version is distinct from checkpoint.resulting_version
     or draft.content_fingerprint is distinct from checkpoint.resulting_fingerprint then
    raise exception 'REPAIR_WORKFLOW_CHECKPOINT_STALE' using errcode='40001';
  end if;
  for issue_id_value in select value::uuid
    from jsonb_array_elements_text(checkpoint.workflow_issue_ids) value
  loop
    perform pg_advisory_xact_lock(hashtextextended(issue_id_value::text,0));
    select coalesce(latest.new_status,'open'),
           coalesce(latest.owner_stage,occurrence.owner_stage),
           coalesce(latest.next_action,occurrence.next_action)
    into latest_status_value,latest_owner_value,latest_action_value
    from private.market_workflow_issue_occurrences_v1 occurrence
    left join lateral (
      select event.new_status,event.owner_stage,event.next_action
      from private.market_workflow_issue_events_v1 event
      where event.issue_id=occurrence.issue_id
      order by event.occurred_at desc,event.id desc limit 1
    ) latest on true where occurrence.issue_id=issue_id_value;
    if latest_status_value in ('resolved','superseded') then continue; end if;
    if latest_status_value='waiting' and latest_owner_value='validator'
       and latest_action_value='request_market_validation' then continue; end if;
    perform public.transition_market_workflow_issue_v1(
      issue_id_value,latest_status_value,'waiting','validator','request_market_validation',
      null,jsonb_build_array(jsonb_build_object(
        'repair_attempt_id',attempt.id,'repair_round',checkpoint.repair_round,
        'resulting_version',checkpoint.resulting_version,
        'resulting_fingerprint',checkpoint.resulting_fingerprint
      ))
    );
    prepared_count:=prepared_count+1;
  end loop;
  return jsonb_build_object('ok',true,'attempt_id',attempt.id,
    'repair_round',checkpoint.repair_round,'resulting_version',checkpoint.resulting_version,
    'prepared_issue_count',prepared_count,'ready_for_validation',true);
end;
$function$;
revoke all on function public.prepare_market_draft_repair_revalidation_v1(uuid,smallint)
  from public,anon,authenticated,service_role;
grant execute on function public.prepare_market_draft_repair_revalidation_v1(uuid,smallint)
  to service_role;

create or replace function private.advance_market_draft_workflow_issues_v1(
  draft_id_input uuid,
  version_input bigint,
  scopes_input text[],
  issue_codes_input text[],
  new_status_input text,
  owner_stage_input text,
  next_action_input text,
  resolution_method_input text,
  actor_id_input uuid default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
  issue_row record;
  latest_status_value text;
  transitioned integer:=0;
begin
  if draft_id_input is null or version_input<1
     or coalesce(array_length(scopes_input,1),0)=0
     or exists (select 1 from unnest(scopes_input) scope
       where scope not in ('none','approval','human_confirmation','publication','terminal'))
     or new_status_input not in ('in_progress','resolved','superseded')
     or owner_stage_input not in (
       'radar','editor','validator','corrector','human_review','publication_gate',
       'provider','internal_platform'
     )
     or next_action_input !~ '^[a-z][a-z0-9_]{2,99}$'
     or nullif(btrim(resolution_method_input),'') is null then
    raise exception 'MARKET_WORKFLOW_STAGE_TRANSITION_INVALID' using errcode='22023';
  end if;
  for issue_row in
    select distinct occurrence.issue_id
    from private.market_workflow_issue_occurrences_v1 occurrence
    join private.market_workflow_issue_subject_links_v1 link on link.issue_id=occurrence.issue_id
    where link.subject_type='market_draft'
      and link.subject_key=draft_id_input::text
      and link.subject_version=version_input::text
      and occurrence.blocking_scope=any(scopes_input)
      and (issue_codes_input is null or occurrence.issue_code=any(issue_codes_input))
  loop
    perform pg_advisory_xact_lock(hashtextextended(issue_row.issue_id::text,0));
    select coalesce(latest.new_status,'open') into latest_status_value
    from private.market_workflow_issue_occurrences_v1 occurrence
    left join lateral (
      select event.new_status from private.market_workflow_issue_events_v1 event
      where event.issue_id=occurrence.issue_id
      order by event.occurred_at desc,event.id desc limit 1
    ) latest on true
    where occurrence.issue_id=issue_row.issue_id;
    if latest_status_value in ('resolved','superseded') then continue; end if;
    insert into private.market_workflow_issue_events_v1(
      issue_id,event_type,previous_status,new_status,actor_id,owner_stage,next_action,
      resolution_method,evidence_refs
    ) values (
      issue_row.issue_id,new_status_input,latest_status_value,new_status_input,actor_id_input,
      owner_stage_input,next_action_input,resolution_method_input,'[]'::jsonb
    );
    transitioned:=transitioned+1;
  end loop;
  return transitioned;
end;
$function$;
revoke all on function private.advance_market_draft_workflow_issues_v1(
  uuid,bigint,text[],text[],text,text,text,text,uuid
) from public,anon,authenticated,service_role;

create or replace function private.market_workflow_canonical_json_v1(value_input jsonb)
returns text
language plpgsql
immutable
security definer
set search_path = ''
as $function$
declare result text;
begin
  if value_input is null or jsonb_typeof(value_input)='null' then return 'null'; end if;
  if jsonb_typeof(value_input) in ('boolean','number','string') then return value_input::text; end if;
  if jsonb_typeof(value_input)='array' then
    select '['||coalesce(string_agg(
      private.market_workflow_canonical_json_v1(item.value),',' order by item.ordinality
    ),'')||']' into result
    from jsonb_array_elements(value_input) with ordinality item(value,ordinality);
    return result;
  end if;
  if jsonb_typeof(value_input)='object' then
    if exists (select 1 from jsonb_object_keys(value_input) key where key!~'^[ -~]+$') then
      raise exception 'MARKET_WORKFLOW_CANONICAL_KEY_INVALID' using errcode='22023';
    end if;
    select '{'||coalesce(string_agg(
      to_jsonb(entry.key)::text||':'||private.market_workflow_canonical_json_v1(value_input -> entry.key),
      ',' order by entry.key collate "C"
    ),'')||'}' into result from jsonb_object_keys(value_input) entry(key);
    return result;
  end if;
  raise exception 'MARKET_WORKFLOW_CANONICAL_VALUE_INVALID' using errcode='22023';
end;
$function$;
revoke all on function private.market_workflow_canonical_json_v1(jsonb)
  from public,anon,authenticated,service_role;

create or replace function private.market_workflow_server_issue_v1(
  issue_code_input text,
  detected_by_input text,
  owner_stage_input text,
  repairability_input text,
  blocking_scope_input text,
  next_action_input text,
  current_value_input jsonb,
  retryable_input boolean,
  policy_version_input text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  now_value timestamptz:=clock_timestamp();
  fingerprint_value text;
begin
  fingerprint_value:=encode(extensions.digest(convert_to(
    private.market_workflow_canonical_json_v1(jsonb_build_object(
      'issue_code',issue_code_input,'detected_by',detected_by_input,
      'owner_stage',owner_stage_input,'severity','blocking',
      'repairability',repairability_input,'blocking_scope',blocking_scope_input,
      'affected_fields','[]'::jsonb,'evidence_refs','[]'::jsonb,
      'current_value',coalesce(current_value_input,'null'::jsonb),
      'proposed_value','null'::jsonb,'confidence',100,
      'policy_version',policy_version_input,'schema_version','atinara-market-issue-v1',
      'retryable',retryable_input,'next_action',next_action_input
    )),'UTF8'),'sha256'),'hex');
  return jsonb_build_object(
    'issue_id',gen_random_uuid(),'issue_code',issue_code_input,'detected_by',detected_by_input,
    'owner_stage',owner_stage_input,'severity','blocking','repairability',repairability_input,
    'blocking_scope',blocking_scope_input,'affected_fields','[]'::jsonb,
    'evidence_refs','[]'::jsonb,'current_value',coalesce(current_value_input,'null'::jsonb),
    'proposed_value',null,'confidence',100,'policy_version',policy_version_input,
    'schema_version','atinara-market-issue-v1','fingerprint',fingerprint_value,
    'status','open','retryable',retryable_input,'next_action',next_action_input,
    'created_at',now_value,'updated_at',now_value,'resolved_at',null,'resolution_method',null
  );
end;
$function$;
revoke all on function private.market_workflow_server_issue_v1(text,text,text,text,text,text,jsonb,boolean,text)
  from public,anon,authenticated,service_role;

create or replace function private.market_draft_blocking_workflow_issue_v1(
  draft_id_input uuid,
  version_input bigint,
  scopes_input text[]
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
  select occurrence.issue_payload||jsonb_build_object(
    'issue_id',occurrence.issue_id,
    'status',coalesce(latest.new_status,'open'),
    'owner_stage',coalesce(latest.owner_stage,occurrence.owner_stage),
    'next_action',coalesce(latest.next_action,occurrence.next_action)
  )
  from private.market_workflow_issue_occurrences_v1 occurrence
  join private.market_workflow_issue_subject_links_v1 link on link.issue_id=occurrence.issue_id
  left join lateral (
    select event.new_status,event.owner_stage,event.next_action
    from private.market_workflow_issue_events_v1 event
    where event.issue_id=occurrence.issue_id
    order by event.occurred_at desc,event.id desc limit 1
  ) latest on true
  where link.subject_type='market_draft' and link.subject_key=draft_id_input::text
    and link.subject_version=version_input::text
    and occurrence.blocking_scope=any(scopes_input)
    and coalesce(latest.new_status,'open') not in ('resolved','superseded')
    and not (occurrence.blocking_scope='approval'
      and coalesce(latest.new_status,'open')='waiting'
      and coalesce(latest.owner_stage,occurrence.owner_stage)='validator'
      and coalesce(latest.next_action,occurrence.next_action)='request_market_validation')
  order by case when occurrence.blocking_scope='terminal'
      or occurrence.repairability='terminal' then 0 else 1 end,
    case occurrence.severity when 'blocking' then 0 when 'warning' then 1 else 2 end,
    occurrence.created_at,occurrence.issue_id
  limit 1;
$function$;
revoke all on function private.market_draft_blocking_workflow_issue_v1(uuid,bigint,text[])
  from public,anon,authenticated,service_role;

create or replace function private.capture_official_opportunity_workflow_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare issue jsonb;
begin
  if new.provider<>'official_web'
     or new.action<>'discover_official_opportunities'
     or new.request_id is null or new.request_fingerprint is null
     or new.status<>'technical_failure'
     or (tg_op='UPDATE' and old.status='technical_failure') then
    return null;
  end if;
  issue:=private.market_workflow_server_issue_v1(
    coalesce(nullif(new.error_code,''),'OFFICIAL_DISCOVERY_TECHNICAL_FAILURE'),
    'internal_platform',case when coalesce(new.error_code,'') like 'PROVIDER_%'
      then 'provider' else 'internal_platform' end,
    'auto_recoverable','none','retry_official_opportunity_discovery',
    jsonb_build_object('provider_run_id',new.id,'outcome',new.status),true,
    'atinara-official-opportunity-discovery-v1'
  );
  perform private.record_market_workflow_issue_v1(
    'official_opportunity',new.request_id::text,'1',new.request_fingerprint,
    issue,null,null
  );
  return null;
end;
$function$;
revoke all on function private.capture_official_opportunity_workflow_v1()
  from public,anon,authenticated,service_role;
create trigger capture_official_opportunity_workflow_v1
after insert or update of status on private.data_provider_runs
for each row execute function private.capture_official_opportunity_workflow_v1();

create or replace function private.publication_issue_v1(
  draft_id_input uuid,
  expected_version_input bigint,
  error_code_input text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  owner_value text;
  next_action_value text;
  repairability_value text;
  blocking_scope_value text:='publication';
  retryable_value boolean:=true;
  approval_is_current boolean:=false;
begin
  select exists (
    select 1 from private.market_drafts draft
    where draft.id=draft_id_input
      and draft.content_version=expected_version_input
      and draft.review_status='approved'
      and draft.reviewed_version=draft.content_version
      and draft.reviewed_fingerprint is not distinct from draft.content_fingerprint
      and private.market_current_effective_review_id(draft) is not null
  ) into approval_is_current;
  owner_value:=case
    when error_code_input='CURRENT_APPROVAL_AND_CONFIRMATION_REQUIRED' and approval_is_current
      then 'human_review'
    when error_code_input='CURRENT_APPROVAL_AND_CONFIRMATION_REQUIRED' then 'validator'
    when error_code_input='CURRENT_APPROVAL_REQUIRED' then 'validator'
    when error_code_input='SCHEDULE_AFTER_MARKET_CLOSE' then 'human_review'
    when error_code_input='MARKET_ID_ALREADY_EXISTS' then 'human_review'
    when error_code_input='MARKET_PERIOD_ALREADY_ENDED'
      then 'publication_gate'
    when error_code_input in ('RADAR_ELIGIBILITY_REQUIRED','ELIGIBILITY_EXPIRED',
      'RADAR_DRAFT_ELIGIBILITY_PROVENANCE_REQUIRED') then 'radar'
    when error_code_input='CURRENT_BINDING_COMPATIBILITY_REQUIRED'
      or error_code_input like 'TEMPORAL_%'
      or error_code_input in (
        'SOURCE_BINDING_REQUIRED','SOURCE_BINDING_NOT_FOUND',
        'SOURCE_BINDING_VALIDATION_REQUIRED','SOURCE_BINDING_CONTRACT_CHANGED',
        'SOURCE_BINDING_PROVENANCE_REQUIRED','SOURCE_CONTRACT_NOT_LOCKED',
        'SOURCE_STALE','RESOLUTION_PLAN_NOT_LOCKED'
      ) then 'corrector'
    when error_code_input like '%REVIEW%' or error_code_input like '%FINGERPRINT%' then 'validator'
    else 'internal_platform' end;
  next_action_value:=case
    when error_code_input='CURRENT_APPROVAL_AND_CONFIRMATION_REQUIRED' and approval_is_current
      then 'confirm_market_draft'
    when error_code_input='CURRENT_APPROVAL_AND_CONFIRMATION_REQUIRED' then 'request_market_validation'
    when error_code_input='CURRENT_APPROVAL_REQUIRED' then 'request_market_validation'
    when error_code_input='SCHEDULE_AFTER_MARKET_CLOSE' then 'choose_valid_publication_time'
    when error_code_input='MARKET_PERIOD_ALREADY_ENDED' then 'archive_expired_draft'
    when error_code_input='MARKET_ALREADY_PUBLISHED' then 'reconcile_published_market'
    when error_code_input='MARKET_ID_ALREADY_EXISTS' then 'edit_market_slug'
    when error_code_input='SOURCE_SCHEDULER_NOT_ENABLED'
      then 'review_source_scheduler_configuration'
    when error_code_input='SOURCE_PROVIDER_NOT_CONFIGURED'
      then 'review_source_provider_configuration'
    when error_code_input='SOURCE_MONITOR_NOT_ARMED'
      then 'review_source_monitor_configuration'
    when error_code_input like 'SOURCE_REGISTRY_%'
      then 'review_source_registry_configuration'
    else case owner_value
    when 'radar' then 'refresh_draft_eligibility'
    when 'corrector' then 'revalidate_temporal_evidence'
    when 'validator' then 'request_market_validation'
    else 'retry_market_publication' end end;
  if error_code_input='MARKET_PERIOD_ALREADY_ENDED' then
    repairability_value:='terminal';
    blocking_scope_value:='terminal';
    retryable_value:=false;
  elsif owner_value='internal_platform' then
    repairability_value:='auto_recoverable';
    if error_code_input='MARKET_ALREADY_PUBLISHED'
       or error_code_input in (
         'SOURCE_SCHEDULER_NOT_ENABLED','SOURCE_PROVIDER_NOT_CONFIGURED',
         'SOURCE_MONITOR_NOT_ARMED'
       ) or error_code_input like 'SOURCE_REGISTRY_%' then retryable_value:=false; end if;
  elsif owner_value='corrector' and (
    error_code_input in (
      'SOURCE_BINDING_REQUIRED','SOURCE_BINDING_NOT_FOUND',
      'SOURCE_BINDING_VALIDATION_REQUIRED','SOURCE_BINDING_CONTRACT_CHANGED',
      'SOURCE_BINDING_PROVENANCE_REQUIRED','SOURCE_CONTRACT_NOT_LOCKED',
      'SOURCE_STALE','RESOLUTION_PLAN_NOT_LOCKED'
    )
  ) then
    repairability_value:='waiting_authoritative_source';
  else
    repairability_value:='human_editable';
    if error_code_input='MARKET_ID_ALREADY_EXISTS' then retryable_value:=false; end if;
  end if;
  -- SQL publication issues never claim a Registry writer binding. Contractual
  -- repair remains routed to the responsible agent and is therefore recorded
  -- as human_editable until that agent supplies a bound strategy.
  if repairability_value='auto_repairable' then repairability_value:='human_editable'; end if;
  return private.market_workflow_server_issue_v1(
    error_code_input,'publication_gate',owner_value,repairability_value,blocking_scope_value,
    next_action_value,jsonb_build_object('draft_id',draft_id_input,
      'expected_version',expected_version_input),retryable_value,'atinara-publication-gate-v1'
  );
end;
$function$;
revoke all on function private.publication_issue_v1(uuid,bigint,text)
  from public,anon,authenticated,service_role;

create or replace function public.publish_market_draft_v2(
  draft_id_input uuid,
  expected_version_input bigint,
  scheduled_for_input timestamptz default null,
  request_id_input uuid default gen_random_uuid()
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor uuid;
  request_hash_value text;
  existing private.market_publication_attempts_v1%rowtype;
  result jsonb;
  draft private.market_drafts%rowtype;
  issue jsonb;
  issue_id_value uuid;
  error_code_value text;
  issue_owner_value text;
  issue_repairability_value text;
  issue_scope_value text;
  issue_action_value text;
  issue_retryable_value boolean;
  attempt_number_value integer;
begin
  perform private.require_current_admin(); actor:=auth.uid();
  request_hash_value:=encode(extensions.digest(convert_to(concat_ws('|',draft_id_input::text,
    expected_version_input::text,coalesce(scheduled_for_input::text,''),actor::text),'UTF8'),'sha256'),'hex');
  select * into existing from private.market_publication_attempts_v1 where id=request_id_input;
  if found then
    if existing.draft_id is distinct from draft_id_input or existing.actor_id is distinct from actor
       or existing.request_hash is distinct from request_hash_value then
      raise exception 'PUBLICATION_REQUEST_REUSED' using errcode='40001';
    end if;
    return existing.response_payload||jsonb_build_object('idempotency_replay',true,'attempt_id',existing.id);
  end if;
  select * into draft from private.market_drafts where id=draft_id_input for update;
  if not found then raise exception 'DRAFT_NOT_FOUND' using errcode='P0001'; end if;
  -- A concurrent call can insert the authoritative attempt while this request
  -- waits on the draft lock. Re-read under the serialized draft scope before
  -- performing any workflow transition or publication effect.
  select * into existing from private.market_publication_attempts_v1 where id=request_id_input;
  if found then
    if existing.draft_id is distinct from draft_id_input or existing.actor_id is distinct from actor
       or existing.request_hash is distinct from request_hash_value then
      raise exception 'PUBLICATION_REQUEST_REUSED' using errcode='40001';
    end if;
    return existing.response_payload||jsonb_build_object('idempotency_replay',true,'attempt_id',existing.id);
  end if;
  select coalesce(max(attempt_number),0)+1 into attempt_number_value
  from private.market_publication_attempts_v1 where draft_id=draft_id_input;
  if draft.content_version is distinct from expected_version_input then
    result:=jsonb_build_object('ok',false,'status','publication_blocked_recoverable',
      'error','DRAFT_VERSION_MOVED','owner_stage','human_review',
      'next_action','reload_current_draft','retryable',true,'state_preserved',true,
      'current_version',draft.content_version);
    insert into private.market_publication_attempts_v1(
      id,draft_id,actor_id,trigger_type,expected_version,request_hash,attempt_number,
      status,retryable,error_code,response_payload
    ) values (request_id_input,draft_id_input,actor,'manual',expected_version_input,
      request_hash_value,attempt_number_value,'blocked_recoverable',true,
      'DRAFT_VERSION_MOVED',result);
    return result||jsonb_build_object('attempt_id',request_id_input,'idempotency_replay',false);
  end if;
  if draft.market_id is not null and exists (
    select 1 from public.markets market where market.id=draft.market_id
  ) then
    result:=jsonb_build_object('ok',true,'status','published','market_id',draft.market_id,
      'published_at',draft.published_at,'changed',false,'idempotency_replay',true,
      'catalog_view','catalog','public_path','index.html?market='||draft.market_id);
    insert into private.market_publication_attempts_v1(
      id,draft_id,actor_id,trigger_type,expected_version,request_hash,attempt_number,
      status,retryable,response_payload
    ) values (request_id_input,draft_id_input,actor,'manual',expected_version_input,
      request_hash_value,attempt_number_value,'published',false,result);
    update private.market_drafts set artifact_status='published',
      workflow_owner_stage=null,workflow_next_action=null,
      publication_schedule_status='scheduled_published',publication_next_retry_at=null
    where id=draft_id_input;
    return result||jsonb_build_object('attempt_id',request_id_input);
  end if;
  begin
    perform private.advance_market_draft_workflow_issues_v1(
      draft.id,draft.content_version,array['publication'],
      array['PUBLICATION_TECHNICAL_FAILURE'],'in_progress','internal_platform',
      'retry_market_publication','publication_retry_claimed',actor
    );
    if private.market_draft_publication_source_ready_v1(
      draft.id,draft.content_version,false
    ) is not true then raise exception 'SOURCE_STALE' using errcode='55000'; end if;
    result:=public.publish_market_draft(draft_id_input,expected_version_input,scheduled_for_input);
    perform private.advance_market_draft_workflow_issues_v1(
      draft.id,draft.content_version,array['publication'],
      array['PUBLICATION_TECHNICAL_FAILURE'],'resolved','publication_gate',
      case when result ->> 'status'='scheduled' then 'wait_for_scheduled_publication'
        else 'reconcile_published_market' end,'publication_retry_succeeded',actor
    );
    insert into private.market_publication_attempts_v1(
      id,draft_id,actor_id,trigger_type,expected_version,request_hash,attempt_number,
      status,retryable,response_payload
    ) values (
      request_id_input,draft_id_input,actor,'manual',expected_version_input,request_hash_value,
      attempt_number_value,case when result ->> 'status'='scheduled' then 'scheduled' else 'published' end,
      false,result
    );
    update private.market_drafts set
      publication_schedule_status=case when result ->> 'status'='scheduled'
        then 'scheduled_waiting' else 'scheduled_published' end,
      publication_next_retry_at=null
    where id=draft_id_input;
    return result||jsonb_build_object('ok',true,'attempt_id',request_id_input,
      'idempotency_replay',false);
  exception when others then
    error_code_value:=case when sqlerrm ~ '^[A-Z][A-Z0-9_]{2,100}$' then sqlerrm
      else 'PUBLICATION_TECHNICAL_FAILURE' end;
    issue:=case when error_code_value='MARKET_WORKFLOW_PUBLICATION_BLOCKED'
      then private.market_draft_blocking_workflow_issue_v1(
        draft_id_input,expected_version_input,
        array['approval','human_confirmation','publication','terminal']
      ) else null end;
    if issue is null then
      issue:=private.publication_issue_v1(draft_id_input,expected_version_input,error_code_value);
      issue_id_value:=private.record_market_workflow_issue_v1(
        'market_draft',draft_id_input::text,expected_version_input::text,draft.content_fingerprint,
        issue,null,null
      );
      issue:=jsonb_set(issue,'{issue_id}',to_jsonb(issue_id_value),true);
    else
      issue_id_value:=(issue ->> 'issue_id')::uuid;
      error_code_value:=issue ->> 'issue_code';
    end if;
    result:=jsonb_build_object('ok',false,'status',case
        when issue ->> 'repairability'='terminal' then 'publication_failed_terminal'
        else 'publication_blocked_recoverable' end,
      'error',error_code_value,'issue',issue,'owner_stage',issue ->> 'owner_stage',
      'next_action',issue ->> 'next_action','retryable',(issue ->> 'retryable')::boolean,
      'state_preserved',true);
    insert into private.market_publication_attempts_v1(
      id,draft_id,actor_id,trigger_type,expected_version,request_hash,attempt_number,
      status,retryable,error_code,issue_id,response_payload
    ) values (request_id_input,draft_id_input,actor,'manual',expected_version_input,
      request_hash_value,attempt_number_value,case
        when issue ->> 'repairability'='terminal' then 'failed_terminal'
        else 'blocked_recoverable' end,(issue ->> 'retryable')::boolean,error_code_value,
      issue_id_value,result);
    perform private.link_market_workflow_issue_subject_v1(
      issue_id_value,'publication_attempt',request_id_input::text,
      attempt_number_value::text,request_hash_value
    );
    update private.market_drafts set artifact_status=case
        when issue ->> 'repairability'='terminal' then 'publication_failed_terminal'
        else 'publication_blocked_recoverable' end,
      workflow_owner_stage=issue ->> 'owner_stage',workflow_next_action=issue ->> 'next_action'
    where id=draft_id_input;
    return result||jsonb_build_object('attempt_id',request_id_input,'idempotency_replay',false);
  end;
end;
$function$;
revoke all on function public.publish_market_draft_v2(uuid,bigint,timestamptz,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.publish_market_draft_v2(uuid,bigint,timestamptz,uuid)
  to authenticated;

create or replace function public.publish_due_market_drafts_v2(limit_count integer default 20)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  draft private.market_drafts%rowtype;
  result jsonb;
  published jsonb:='[]'::jsonb;
  failed jsonb:='[]'::jsonb;
  issue jsonb;
  issue_id_value uuid;
  error_code_value text;
  attempt_number_value integer;
  retryable_value boolean;
  next_retry_value timestamptz;
  attempt_id_value uuid;
  request_hash_value text;
  existing_issue_value boolean;
begin
  if auth.role()<>'service_role' then
    raise exception 'SERVICE_ROLE_REQUIRED' using errcode='42501';
  end if;
  for draft in
    select draft_row.* from private.market_drafts draft_row
    where draft_row.workflow_status='scheduled' and draft_row.scheduled_for<=clock_timestamp()
      and coalesce(draft_row.publication_schedule_status,'scheduled_waiting')
        in ('scheduled_waiting','scheduled_retry')
      and (draft_row.publication_next_retry_at is null
        or draft_row.publication_next_retry_at<=clock_timestamp())
    order by draft_row.scheduled_for,draft_row.id
    for update skip locked limit least(greatest(coalesce(limit_count,20),1),100)
  loop
    select coalesce(max(attempt_number),0)+1 into attempt_number_value
    from private.market_publication_attempts_v1 where draft_id=draft.id;
    attempt_id_value:=gen_random_uuid();
    request_hash_value:=encode(extensions.digest(convert_to(concat_ws('|',draft.id::text,
      draft.content_version::text,'scheduled',attempt_number_value::text),'UTF8'),'sha256'),'hex');
    begin
      perform private.advance_market_draft_workflow_issues_v1(
        draft.id,draft.content_version,array['publication'],
        array['PUBLICATION_TECHNICAL_FAILURE'],'in_progress','internal_platform',
        'retry_market_publication','scheduled_publication_retry_claimed',null
      );
      if private.market_draft_publication_source_ready_v1(
        draft.id,draft.content_version,true
      ) is not true then raise exception 'SOURCE_STALE' using errcode='55000'; end if;
      result:=private.materialize_market_draft(draft.id,draft.human_confirmed_by);
      perform private.advance_market_draft_workflow_issues_v1(
        draft.id,draft.content_version,array['publication'],
        array['PUBLICATION_TECHNICAL_FAILURE'],'resolved','publication_gate',
        'reconcile_published_market','scheduled_publication_retry_succeeded',null
      );
      insert into private.market_publication_attempts_v1(
        id,draft_id,actor_id,trigger_type,expected_version,request_hash,attempt_number,
        status,retryable,response_payload
      ) values (attempt_id_value,draft.id,null,'scheduled',draft.content_version,
        request_hash_value,attempt_number_value,'published',false,result);
      update private.market_drafts set publication_schedule_status='scheduled_published',
        publication_next_retry_at=null where id=draft.id;
      published:=published||jsonb_build_array(jsonb_build_object(
        'draft_id',draft.id,'attempt_id',attempt_id_value,'result',result));
    exception when others then
      error_code_value:=case when sqlerrm ~ '^[A-Z][A-Z0-9_]{2,100}$' then sqlerrm
        else 'PUBLICATION_TECHNICAL_FAILURE' end;
      retryable_value:=error_code_value='PUBLICATION_TECHNICAL_FAILURE'
        and attempt_number_value<5;
      next_retry_value:=case when retryable_value then clock_timestamp()+
        make_interval(secs=>least(3600,30*(2^least(attempt_number_value-1,7)))) else null end;
      issue:=case when error_code_value='MARKET_WORKFLOW_PUBLICATION_BLOCKED'
        then private.market_draft_blocking_workflow_issue_v1(
          draft.id,draft.content_version,
          array['approval','human_confirmation','publication','terminal']
        ) else null end;
      existing_issue_value:=issue is not null;
      if issue is null then
        issue:=private.publication_issue_v1(draft.id,draft.content_version,error_code_value);
      else
        error_code_value:=issue ->> 'issue_code';
      end if;
      retryable_value:=retryable_value and (issue ->> 'retryable')::boolean;
      issue:=jsonb_set(issue,'{retryable}',to_jsonb(retryable_value),true);
      if existing_issue_value then
        issue_id_value:=(issue ->> 'issue_id')::uuid;
      else
        issue_id_value:=private.record_market_workflow_issue_v1(
          'market_draft',draft.id::text,draft.content_version::text,draft.content_fingerprint,
          issue,null,null
        );
      end if;
      issue:=jsonb_set(issue,'{issue_id}',to_jsonb(issue_id_value),true);
      result:=jsonb_build_object('ok',false,
        'status',case when retryable_value then 'retry_wait'
          when issue ->> 'repairability'='terminal' then 'publication_failed_terminal'
          else 'publication_blocked_recoverable' end,
        'error',error_code_value,'issue',issue,'owner_stage',issue ->> 'owner_stage',
        'next_action',issue ->> 'next_action','retryable',retryable_value,
        'next_retry_at',next_retry_value,'state_preserved',true);
      insert into private.market_publication_attempts_v1(
        id,draft_id,actor_id,trigger_type,expected_version,request_hash,attempt_number,
        status,retryable,error_code,issue_id,next_retry_at,response_payload
      ) values (attempt_id_value,draft.id,null,'scheduled',draft.content_version,
        request_hash_value,attempt_number_value,
        case when retryable_value then 'retry_wait'
          when issue ->> 'repairability'='terminal' then 'failed_terminal'
          else 'blocked_recoverable' end,
        retryable_value,error_code_value,issue_id_value,next_retry_value,result);
      perform private.link_market_workflow_issue_subject_v1(
        issue_id_value,'publication_attempt',attempt_id_value::text,
        attempt_number_value::text,request_hash_value
      );
      update private.market_drafts set
        artifact_status=case when issue ->> 'repairability'='terminal'
          then 'publication_failed_terminal' else 'publication_blocked_recoverable' end,
        workflow_owner_stage=issue ->> 'owner_stage',
        workflow_next_action=issue ->> 'next_action',
        publication_schedule_status=case when retryable_value then 'scheduled_retry'
          when issue ->> 'repairability'='terminal' then 'scheduled_failed_terminal'
          else 'scheduled_blocked_recoverable' end,
        publication_next_retry_at=next_retry_value
      where id=draft.id;
      failed:=failed||jsonb_build_array(jsonb_build_object(
        'draft_id',draft.id,'attempt_id',attempt_id_value,'status',result ->> 'status',
        'error',error_code_value,'retryable',retryable_value,'next_retry_at',next_retry_value,
        'owner_stage',issue ->> 'owner_stage','next_action',issue ->> 'next_action',
        'issue_id',issue_id_value,'content_version',draft.content_version,
        'content_fingerprint',draft.content_fingerprint,
        'source_revalidation',case when error_code_value='SOURCE_STALE' then
          jsonb_build_object('draft_id',draft.id,'expected_version',draft.content_version,
            'expected_fingerprint',draft.content_fingerprint,
            'issue_ids',jsonb_build_array(issue_id_value),'request_id',attempt_id_value,
            'draft',private.market_draft_source_payload(draft)) else null end
      ));
    end;
  end loop;
  return jsonb_build_object('published',published,'failed',failed,
    'published_count',jsonb_array_length(published),'failed_count',jsonb_array_length(failed));
end;
$function$;
revoke all on function public.publish_due_market_drafts_v2(integer)
  from public,anon,authenticated,service_role;
grant execute on function public.publish_due_market_drafts_v2(integer)
  to service_role;

create or replace function public.retry_scheduled_market_publication_v1(draft_id_input uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor_id_value uuid:=private.require_current_admin();
  draft private.market_drafts%rowtype;
begin
  select * into draft from private.market_drafts where id=draft_id_input for update;
  if not found then raise exception 'DRAFT_NOT_FOUND' using errcode='P0001'; end if;
  if draft.workflow_status='scheduled'
     and draft.publication_schedule_status='scheduled_waiting'
     and exists (select 1 from private.market_admin_audit audit
       where audit.draft_id=draft.id and audit.draft_version=draft.content_version
         and audit.action_code='SCHEDULED_PUBLICATION_RETRY_REQUESTED') then
    return jsonb_build_object('ok',true,'draft_id',draft.id,'status','scheduled_waiting',
      'next_action','retry_scheduled_publication','idempotency_replay',true);
  end if;
  if draft.workflow_status<>'scheduled'
     or draft.publication_schedule_status<>'scheduled_retry' then
    raise exception 'SCHEDULED_PUBLICATION_RETRY_NOT_ALLOWED' using errcode='55000';
  end if;
  update private.market_drafts set publication_schedule_status='scheduled_waiting',
    publication_next_retry_at=clock_timestamp(),artifact_status='scheduled',
    workflow_owner_stage='publication_gate',workflow_next_action='retry_scheduled_publication'
  where id=draft_id_input;
  insert into private.market_admin_audit(actor_id,action_code,draft_id,draft_version,detail)
  values (actor_id_value,'SCHEDULED_PUBLICATION_RETRY_REQUESTED',draft.id,draft.content_version,
    jsonb_build_object('previous_status',draft.publication_schedule_status,
      'new_status','scheduled_waiting','publishes',false));
  return jsonb_build_object('ok',true,'draft_id',draft_id_input,'status','scheduled_waiting',
    'next_action','retry_scheduled_publication','idempotency_replay',false);
end;
$function$;
revoke all on function public.retry_scheduled_market_publication_v1(uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.retry_scheduled_market_publication_v1(uuid) to authenticated;

create or replace function public.cancel_scheduled_market_publication_v1(draft_id_input uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor_id_value uuid:=private.require_current_admin();
  draft private.market_drafts%rowtype;
begin
  select * into draft from private.market_drafts where id=draft_id_input for update;
  if not found then raise exception 'DRAFT_NOT_FOUND' using errcode='P0001'; end if;
  if draft.publication_schedule_status='scheduled_cancelled'
     and draft.workflow_status in ('draft_ready','human_confirmed')
     and exists (select 1 from private.market_admin_audit audit
       where audit.draft_id=draft.id and audit.draft_version=draft.content_version
         and audit.action_code='SCHEDULED_PUBLICATION_CANCELLED') then
    return jsonb_build_object('ok',true,'draft_id',draft.id,'status',draft.workflow_status,
      'confirmation_preserved',draft.workflow_status='human_confirmed',
      'terminal_issue_preserved',draft.workflow_status='draft_ready',
      'next_action',draft.workflow_next_action,'idempotency_replay',true);
  end if;
  if draft.workflow_status<>'scheduled' then
    raise exception 'SCHEDULED_PUBLICATION_CANCEL_NOT_ALLOWED' using errcode='55000';
  end if;
  update private.market_drafts set workflow_status=case
      when draft.publication_schedule_status='scheduled_failed_terminal'
        then 'draft_ready' else 'human_confirmed' end,scheduled_for=null,
    publication_schedule_status='scheduled_cancelled',publication_next_retry_at=null,
    artifact_status=case when draft.publication_schedule_status='scheduled_failed_terminal'
      then 'publication_failed_terminal' else 'human_confirmed' end,
    workflow_owner_stage=case when draft.publication_schedule_status='scheduled_failed_terminal'
      then coalesce(workflow_owner_stage,'publication_gate') else 'publication_gate' end,
    workflow_next_action=case when draft.publication_schedule_status='scheduled_failed_terminal'
      then coalesce(workflow_next_action,'archive_expired_draft') else 'revalidate_and_publish' end
  where id=draft_id_input;
  insert into private.market_admin_audit(actor_id,action_code,draft_id,draft_version,detail)
  values (actor_id_value,'SCHEDULED_PUBLICATION_CANCELLED',draft.id,draft.content_version,
    jsonb_build_object('previous_workflow_status',draft.workflow_status,
      'previous_schedule_status',draft.publication_schedule_status,
      'new_workflow_status',case when draft.publication_schedule_status='scheduled_failed_terminal'
        then 'draft_ready' else 'human_confirmed' end,
      'new_schedule_status','scheduled_cancelled','publishes',false));
  return jsonb_build_object('ok',true,'draft_id',draft_id_input,
    'status',case when draft.publication_schedule_status='scheduled_failed_terminal'
      then 'draft_ready' else 'human_confirmed' end,
    'confirmation_preserved',draft.publication_schedule_status<>'scheduled_failed_terminal',
    'terminal_issue_preserved',draft.publication_schedule_status='scheduled_failed_terminal',
    'next_action',case when draft.publication_schedule_status='scheduled_failed_terminal'
      then coalesce(draft.workflow_next_action,'archive_expired_draft')
      else 'revalidate_and_publish' end,'idempotency_replay',false);
end;
$function$;
revoke all on function public.cancel_scheduled_market_publication_v1(uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.cancel_scheduled_market_publication_v1(uuid) to authenticated;

create or replace function public.archive_terminal_market_draft_v1(
  draft_id_input uuid,
  expected_version_input bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor_id_value uuid:=private.require_current_admin();
  draft private.market_drafts%rowtype;
  terminal_count integer;
begin
  select * into draft from private.market_drafts where id=draft_id_input for update;
  if not found then raise exception 'DRAFT_NOT_FOUND' using errcode='P0001'; end if;
  if draft.workflow_status='cancelled' and draft.artifact_status='review_rejected_terminal'
     and draft.content_version is not distinct from expected_version_input
     and exists (select 1 from private.market_admin_audit audit
       where audit.draft_id=draft.id and audit.draft_version=draft.content_version
         and audit.action_code='TERMINAL_DRAFT_ARCHIVED') then
    return jsonb_build_object('ok',true,'draft_id',draft.id,
      'content_version',draft.content_version,'status','cancelled',
      'artifact_status','review_rejected_terminal','next_action','retain_terminal_dossier',
      'state_preserved',true,'publishes',false,'deletes',false,'idempotency_replay',true);
  end if;
  if draft.content_version is distinct from expected_version_input then
    raise exception 'DRAFT_VERSION_MOVED' using errcode='40001';
  end if;
  if draft.market_id is not null or draft.workflow_status='published' then
    raise exception 'TERMINAL_DRAFT_ARCHIVE_NOT_ALLOWED' using errcode='55000';
  end if;
  select count(*)::integer into terminal_count
  from private.market_workflow_issue_occurrences_v1 occurrence
  join private.market_workflow_issue_subject_links_v1 link on link.issue_id=occurrence.issue_id
  left join lateral (
    select event.new_status from private.market_workflow_issue_events_v1 event
    where event.issue_id=occurrence.issue_id
    order by event.occurred_at desc,event.id desc limit 1
  ) latest on true
  where link.subject_type='market_draft' and link.subject_key=draft.id::text
    and link.subject_version=draft.content_version::text
    and (occurrence.repairability='terminal' or occurrence.blocking_scope='terminal')
    and coalesce(latest.new_status,'open') not in ('resolved','superseded');
  if terminal_count=0 then
    raise exception 'TERMINAL_DRAFT_ISSUE_REQUIRED' using errcode='55000';
  end if;
  update private.market_drafts set workflow_status='cancelled',scheduled_for=null,
    publication_schedule_status=case when publication_schedule_status is null
      then null else 'scheduled_cancelled' end,
    publication_next_retry_at=null,artifact_status='review_rejected_terminal',
    workflow_owner_stage='human_review',workflow_next_action='retain_terminal_dossier',
    workflow_issue_count=terminal_count,updated_at=clock_timestamp(),updated_by=actor_id_value
  where id=draft.id;
  insert into private.market_admin_audit(actor_id,action_code,draft_id,draft_version,detail)
  values (actor_id_value,'TERMINAL_DRAFT_ARCHIVED',draft.id,draft.content_version,
    jsonb_build_object('terminal_issue_count',terminal_count,'publishes',false,
      'confirms',false,'resolves',false,'deletes',false));
  return jsonb_build_object('ok',true,'draft_id',draft.id,
    'content_version',draft.content_version,'status','cancelled',
    'artifact_status','review_rejected_terminal','terminal_issue_count',terminal_count,
    'next_action','retain_terminal_dossier','state_preserved',true,
    'publishes',false,'deletes',false,'idempotency_replay',false);
end;
$function$;
revoke all on function public.archive_terminal_market_draft_v1(uuid,bigint)
  from public,anon,authenticated,service_role;
grant execute on function public.archive_terminal_market_draft_v1(uuid,bigint)
  to authenticated;

create or replace function public.project_market_draft_repair_outcome_v1(
  draft_id_input uuid,
  expected_version_input bigint,
  repair_status_input text,
  owner_stage_input text,
  next_action_input text,
  repair_attempt_id_input uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  draft private.market_drafts%rowtype;
  repair_attempt private.market_repair_attempts%rowtype;
  issue_id_value uuid;
begin
  if auth.role()<>'service_role' then
    raise exception 'SERVICE_ROLE_REQUIRED' using errcode='42501';
  end if;
  if repair_status_input not in ('repair_applied','repair_waiting_source',
      'repair_human_decision_required','repair_not_supported','repair_failed_technical')
     or owner_stage_input not in ('corrector','validator','human_review','internal_platform')
     or next_action_input !~ '^[a-z][a-z0-9_]{2,99}$' then
    raise exception 'REPAIR_OUTCOME_INVALID' using errcode='22023';
  end if;
  select * into draft from private.market_drafts where id=draft_id_input for update;
  if not found then raise exception 'DRAFT_NOT_FOUND' using errcode='P0001'; end if;
  if draft.content_version is distinct from expected_version_input then
    raise exception 'DRAFT_VERSION_MOVED' using errcode='40001';
  end if;
  select * into repair_attempt from private.market_repair_attempts
  where id=repair_attempt_id_input and draft_id=draft_id_input
    and resulting_version=expected_version_input
    and status<>'in_progress' and response_payload is not null;
  if not found then
    raise exception 'REPAIR_ATTEMPT_SCOPE_INVALID' using errcode='40001';
  end if;
  for issue_id_value in
    select value::uuid
    from jsonb_array_elements_text(coalesce(
      repair_attempt.response_payload -> 'workflow_issue_ids','[]'::jsonb
    )) value
    where value ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  loop
    if not exists (
      select 1 from private.market_workflow_issue_subject_links_v1 link
      where link.issue_id=issue_id_value and link.subject_type='market_draft'
        and link.subject_key=draft_id_input::text
        and link.subject_version=repair_attempt.expected_version::text
    ) then raise exception 'REPAIR_ATTEMPT_ISSUE_SCOPE_INVALID' using errcode='40001'; end if;
    perform private.link_market_workflow_issue_subject_v1(
      issue_id_value,'repair_attempt',repair_attempt.id::text,
      repair_attempt.expected_version::text,repair_attempt.expected_fingerprint
    );
  end loop;
  update private.market_drafts set artifact_status=repair_status_input,
    workflow_owner_stage=owner_stage_input,workflow_next_action=next_action_input
  where id=draft_id_input;
  return jsonb_build_object('ok',true,'draft_id',draft_id_input,
    'content_version',draft.content_version,'artifact_status',repair_status_input,
    'owner_stage',owner_stage_input,'next_action',next_action_input);
end;
$function$;
revoke all on function public.project_market_draft_repair_outcome_v1(uuid,bigint,text,text,text,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.project_market_draft_repair_outcome_v1(uuid,bigint,text,text,text,uuid)
  to service_role;

create or replace function public.complete_market_draft_repair_workflow_v1(
  attempt_id_input uuid,
  status_input text,
  phase_input text,
  classification_input text,
  retryable_input boolean,
  error_code_input text,
  patch_fingerprint_input text,
  resulting_version_input bigint,
  resulting_fingerprint_input text,
  response_payload_input jsonb,
  draft_id_input uuid,
  repair_status_input text,
  owner_stage_input text,
  next_action_input text,
  workflow_issue_status_input text,
  resolution_method_input text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  recorded jsonb;
  projection jsonb;
  issue_id_value uuid;
  latest_status_value text;
begin
  if auth.role()<>'service_role' then
    raise exception 'SERVICE_ROLE_REQUIRED' using errcode='42501';
  end if;
  if workflow_issue_status_input not in ('resolved','waiting')
     or (workflow_issue_status_input='resolved'
       and nullif(btrim(resolution_method_input),'') is null) then
    raise exception 'REPAIR_WORKFLOW_COMPLETION_INVALID' using errcode='22023';
  end if;
  recorded:=public.complete_market_draft_repair_attempt_v1(
    attempt_id_input,status_input,phase_input,classification_input,retryable_input,
    error_code_input,patch_fingerprint_input,resulting_version_input,
    resulting_fingerprint_input,response_payload_input
  );
  for issue_id_value in
    select value::uuid
    from jsonb_array_elements_text(coalesce(
      response_payload_input -> 'workflow_issue_ids','[]'::jsonb
    )) value
    where value ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  loop
    if not exists (
      select 1 from private.market_workflow_issue_subject_links_v1 link
      join private.market_repair_attempts attempt on attempt.id=attempt_id_input
      where link.issue_id=issue_id_value and link.subject_type='market_draft'
        and link.subject_key=draft_id_input::text
        and link.subject_version=attempt.expected_version::text
        and attempt.draft_id=draft_id_input
    ) then raise exception 'REPAIR_ATTEMPT_ISSUE_SCOPE_INVALID' using errcode='40001'; end if;
    perform pg_advisory_xact_lock(hashtextextended(issue_id_value::text,0));
    select coalesce(latest.new_status,'open') into latest_status_value
    from private.market_workflow_issue_occurrences_v1 occurrence
    left join lateral (
      select event.new_status from private.market_workflow_issue_events_v1 event
      where event.issue_id=occurrence.issue_id
      order by event.occurred_at desc,event.id desc limit 1
    ) latest on true
    where occurrence.issue_id=issue_id_value;
    if latest_status_value in ('resolved','superseded') then continue; end if;
    if latest_status_value is distinct from workflow_issue_status_input then
      perform public.transition_market_workflow_issue_v1(
        issue_id_value,latest_status_value,workflow_issue_status_input,owner_stage_input,
        next_action_input,case when workflow_issue_status_input='resolved'
          then resolution_method_input else null end,
        jsonb_build_array(jsonb_build_object('repair_attempt_id',attempt_id_input))
      );
    end if;
  end loop;
  projection:=public.project_market_draft_repair_outcome_v1(
    draft_id_input,resulting_version_input,repair_status_input,owner_stage_input,
    next_action_input,attempt_id_input
  );
  return recorded||jsonb_build_object('workflow',projection);
end;
$function$;
revoke all on function public.complete_market_draft_repair_workflow_v1(
  uuid,text,text,text,boolean,text,text,bigint,text,jsonb,uuid,text,text,text,text,text
) from public,anon,authenticated,service_role;
grant execute on function public.complete_market_draft_repair_workflow_v1(
  uuid,text,text,text,boolean,text,text,bigint,text,jsonb,uuid,text,text,text,text,text
) to service_role;

create or replace function public.reconcile_market_draft_repair_workflow_v1(
  attempt_id_input uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  attempt private.market_repair_attempts%rowtype;
  checkpoint private.market_repair_workflow_checkpoints_v1%rowtype;
  draft private.market_drafts%rowtype;
  review private.market_review_attempts%rowtype;
  issue_ids jsonb;
  succeeded boolean;
  retryable_value boolean;
  status_value text;
  classification_value text;
  error_code_value text;
  repair_status_value text;
  next_action_value text;
  response_value jsonb;
begin
  if auth.role()<>'service_role' then
    raise exception 'SERVICE_ROLE_REQUIRED' using errcode='42501';
  end if;
  select * into attempt from private.market_repair_attempts
  where id=attempt_id_input for update;
  if not found then raise exception 'REPAIR_ATTEMPT_NOT_FOUND' using errcode='P0001'; end if;
  if attempt.response_payload is not null then
    return attempt.response_payload||jsonb_build_object(
      'attempt_id',attempt.id,'idempotency_replay',true,
      'state_preserved',attempt.state_preserved
    );
  end if;
  select * into checkpoint from private.market_repair_workflow_checkpoints_v1
  where attempt_id=attempt.id order by repair_round desc limit 1;
  if not found then
    raise exception 'REPAIR_WORKFLOW_CHECKPOINT_REQUIRED' using errcode='40001';
  end if;
  select * into draft from private.market_drafts where id=attempt.draft_id for update;
  if not found or draft.content_version is distinct from checkpoint.resulting_version
     or draft.content_fingerprint is distinct from checkpoint.resulting_fingerprint then
    raise exception 'REPAIR_WORKFLOW_CHECKPOINT_STALE' using errcode='40001';
  end if;
  select * into review from private.market_review_attempts
  where id=checkpoint.review_attempt_id and draft_id=attempt.draft_id
    and draft_version=checkpoint.resulting_version;
  if not found or review.status='in_progress' then
    return jsonb_build_object(
      'ok',false,'status','completion_review_pending','attempt_id',attempt.id,
      'review_attempt_id',checkpoint.review_attempt_id,
      'resulting_version',checkpoint.resulting_version,
      'retryable',true,'state_preserved',true
    );
  end if;
  succeeded:=review.status='approved';
  classification_value:=coalesce(review.classification,
    case when succeeded then 'content' else 'technical' end);
  retryable_value:=classification_value='technical';
  status_value:=case when succeeded and checkpoint.resulting_version>attempt.expected_version
      then 'succeeded' when succeeded then 'no_op'
    when retryable_value then 'technical_failed' else 'blocked' end;
  error_code_value:=case when succeeded then null
    when retryable_value then coalesce(review.technical_code,'REPAIR_REVALIDATION_UNAVAILABLE')
    else 'REPAIR_REVALIDATION_REJECTED' end;
  repair_status_value:=case when succeeded then 'repair_applied'
    when retryable_value then 'repair_failed_technical'
    else 'repair_human_decision_required' end;
  next_action_value:=case when succeeded then 'request_market_validation'
    when retryable_value then 'retry_draft_repair' else 'edit_draft_manually' end;
  issue_ids:=checkpoint.workflow_issue_ids;
  response_value:=jsonb_build_object(
    'ok',succeeded,'status',status_value,'repair_applied',
      checkpoint.resulting_version>attempt.expected_version,
    'previous_version',attempt.expected_version,'new_version',checkpoint.resulting_version,
    'review_approved',succeeded,'review_attempt_id',checkpoint.review_attempt_id,
    'error',error_code_value,'classification',classification_value,
    'retryable',retryable_value,'state_preserved',true,
    'http_status',case when succeeded then 200 when retryable_value then 503 else 422 end,
    'repair_status',repair_status_value,
    'owner_stage',case when succeeded then 'validator' else 'corrector' end,
    'next_action',next_action_value,'workflow_issue_ids',issue_ids,
    'draft_private',true,'publishes',false,'confirms',false,'resolves',false,
    'reconciled_from_checkpoint',true
  );
  return public.complete_market_draft_repair_workflow_v1(
    attempt.id,status_value,case when succeeded then 'complete' else 'revalidation' end,
    classification_value,retryable_value,error_code_value,null,
    checkpoint.resulting_version,checkpoint.resulting_fingerprint,response_value,
    attempt.draft_id,repair_status_value,case when succeeded then 'validator' else 'corrector' end,
    next_action_value,case when succeeded then 'resolved' else 'waiting' end,
    case when succeeded then 'authorized_repair_applied' else null end
  );
end;
$function$;
revoke all on function public.reconcile_market_draft_repair_workflow_v1(uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.reconcile_market_draft_repair_workflow_v1(uuid)
  to service_role;

create or replace function private.assert_market_candidate_draft_identity_v1(
  candidate_id_input uuid,
  draft_payload_input jsonb
)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  candidate private.external_market_candidates%rowtype;
  child_slug_value text;
  field_name_value text;
  field_slug_value text;
  field_without_child_value text;
  sibling_slug_value text;
begin
  select * into candidate from private.external_market_candidates
  where id=candidate_id_input;
  if not found then raise exception 'RADAR_CANDIDATE_NOT_FOUND' using errcode='P0001'; end if;
  if jsonb_typeof(draft_payload_input)<>'object' then
    raise exception 'CHILD_IDENTITY_MISMATCH' using errcode='55000';
  end if;
  if candidate.family_version<>'atinara-market-family-v4'
     or candidate.family_child_key is null
     or candidate.family_child_key not like 'option:%' then
    return;
  end if;
  child_slug_value:=private.market_family_option_slug_v1(candidate.family_child_label);
  if nullif(child_slug_value,'') is null then
    raise exception 'CHILD_IDENTITY_MISMATCH' using errcode='55000';
  end if;
  if private.market_family_option_slug_v1(draft_payload_input ->> 'subject')
       is distinct from child_slug_value then
    raise exception 'CHILD_IDENTITY_MISMATCH' using errcode='55000';
  end if;
  foreach field_name_value in array array[
    'question','yes_criteria','no_criteria','public_criteria','market_slug'
  ] loop
    field_slug_value:=private.market_family_option_slug_v1(
      draft_payload_input ->> field_name_value
    );
    if field_slug_value !~ ('(^|-)'||child_slug_value||'(-|$)') then
      raise exception 'CHILD_IDENTITY_MISMATCH' using errcode='55000';
    end if;
    field_without_child_value:=trim(both '-' from regexp_replace(
      regexp_replace(field_slug_value,'(^|-)'||child_slug_value||'(-|$)','-','g'),
      '-+','-','g'
    ));
    for sibling_slug_value in
      select private.market_family_option_slug_v1(sibling.family_child_label)
      from private.external_market_candidates sibling
      where sibling.family_version='atinara-market-family-v4'
        and sibling.family_key=candidate.family_key
        and sibling.family_child_key<>candidate.family_child_key
        and sibling.family_child_label is not null
    loop
      if nullif(sibling_slug_value,'') is not null
         and (case when child_slug_value~('(^|-)'||sibling_slug_value||'(-|$)')
           then field_without_child_value else field_slug_value end)
           ~('(^|-)'||sibling_slug_value||'(-|$)') then
        raise exception 'CHILD_IDENTITY_MISMATCH' using errcode='55000';
      end if;
    end loop;
  end loop;
end;
$function$;
revoke all on function private.assert_market_candidate_draft_identity_v1(uuid,jsonb)
  from public,anon,authenticated,service_role;

create or replace function public.save_market_draft_from_expert_with_issues_v1(
  candidate_id_input uuid,
  expert_run_id_input uuid,
  draft_input jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor uuid:=private.require_current_admin();
  candidate private.external_market_candidates%rowtype;
  expert private.market_expert_runs%rowtype;
  result jsonb;
  draft_id_value uuid;
  workflow_issues jsonb;
  temporal_contract jsonb;
  provenance jsonb;
  saved_draft private.market_drafts%rowtype;
  existing_draft private.market_drafts%rowtype;
  updated_count integer;
  candidate_issue_fingerprints jsonb;
  child_identity_issue_present boolean:=false;
  draft_request_hash_value text;
begin
  select * into candidate from private.external_market_candidates
  where id=candidate_id_input for update;
  if not found then raise exception 'RADAR_CANDIDATE_NOT_FOUND' using errcode='P0001'; end if;
  select * into expert from private.market_expert_runs where id=expert_run_id_input for share;
  if expert.id is null or expert.origin_type<>'radar_candidate'
     or expert.origin_id<>candidate_id_input::text or expert.status<>'completed'
     or expert.policy_version<>'atinara-market-constitution-v1'
     or expert.schema_version<>'atinara-market-expert-v1'
     or expert.result_json ->> 'origin_analysis_fingerprint' is distinct from expert.origin_fingerprint
     or expert.result_json ->> 'origin_source_fingerprint' is distinct from candidate.fingerprint
     or coalesce(expert.result_json ->> 'origin_preparation_revision','')
       is distinct from candidate.preparation_revision::text then
    raise exception 'MARKET_EXPERT_RUN_INVALID' using errcode='55000';
  end if;
  draft_request_hash_value:=encode(extensions.digest(convert_to(jsonb_build_array(
    candidate.id,expert.id,draft_input-'_idempotency_key'
  )::text,'UTF8'),'sha256'),'hex');
  select * into existing_draft
  from private.market_drafts
  where intelligence_origin_type='radar_candidate'
    and intelligence_origin_id=candidate.id::text
    and coalesce(workflow_status,'draft_ready')<>'cancelled'
  order by created_at,id
  limit 1
  for update;
  if existing_draft.id is not null then
    if existing_draft.expert_run_id is distinct from expert.id
       or existing_draft.source_provenance ->> 'origin_fingerprint'
         is distinct from candidate.fingerprint
       or existing_draft.source_provenance ->> 'origin_preparation_revision'
         is distinct from candidate.preparation_revision::text
       or existing_draft.source_provenance ->> 'issue_draft_request_hash'
         is distinct from draft_request_hash_value then
      raise exception 'MARKET_EXPERT_DRAFT_ALREADY_EXISTS' using errcode='40001';
    end if;
    return jsonb_build_object(
      'ok',true,'draft',to_jsonb(existing_draft),
      'workflow_issues',coalesce(existing_draft.source_provenance -> 'workflow_issues','[]'::jsonb),
      'binding_status',coalesce(existing_draft.source_provenance ->> 'binding_status','pending_recovery'),
      'creates_private_draft',false,'publishes',false,'confirms',false,
      'idempotency_replay',true
    );
  end if;
  workflow_issues:=coalesce(expert.result_json -> 'workflow_issues',
    candidate.normalized_payload -> 'workflow_issues','[]'::jsonb);
  temporal_contract:=coalesce(candidate.normalized_payload -> 'temporal_contract','null'::jsonb);
  select coalesce(jsonb_agg(issue ->> 'fingerprint' order by issue ->> 'fingerprint'),'[]'::jsonb)
    into candidate_issue_fingerprints
  from jsonb_array_elements(coalesce(candidate.normalized_payload -> 'workflow_issues','[]'::jsonb)) issue
  where issue ->> 'issue_code' not in ('RADAR_ELIGIBILITY_REQUIRED','ELIGIBILITY_EXPIRED');
  if jsonb_typeof(workflow_issues)<>'array' or jsonb_array_length(workflow_issues)=0
     or jsonb_array_length(workflow_issues)>40
     or exists (
       select 1 from jsonb_array_elements(workflow_issues) issue
       where issue ->> 'blocking_scope'='terminal' or issue ->> 'repairability'='terminal'
     ) then
    raise exception 'PRIVATE_ISSUE_DRAFT_NOT_ALLOWED' using errcode='55000';
  end if;
  if jsonb_typeof(expert.result_json -> 'draft_gate')<>'object'
     or expert.result_json #>> '{draft_gate,status}'<>'proposal_ready_with_issues'
     or coalesce((expert.result_json #>> '{draft_gate,can_save_private_draft}')::boolean,false) is not true
     or coalesce(expert.result_json -> 'reason_codes','[]'::jsonb) ? 'PROVIDER_PLACEHOLDER'
     or exists (
       select 1 from jsonb_array_elements(workflow_issues) issue
       where issue ->> 'issue_code'='PROVIDER_PLACEHOLDER'
     ) then
    raise exception 'PRIVATE_ISSUE_DRAFT_NOT_ALLOWED' using errcode='55000';
  end if;
  select exists (
    select 1 from jsonb_array_elements(workflow_issues) issue
    where issue ->> 'issue_code'='CHILD_IDENTITY_MISMATCH'
      and issue ->> 'owner_stage'='corrector'
      and issue ->> 'blocking_scope'='approval'
      and issue ->> 'repairability' in ('auto_repairable','human_editable')
  ) into child_identity_issue_present;
  if not child_identity_issue_present then
    perform private.assert_market_candidate_draft_identity_v1(candidate.id,draft_input);
  elsif candidate.family_version<>'atinara-market-family-v4'
     or candidate.family_child_key not like 'option:%'
     or nullif(candidate.family_child_label,'') is null then
    raise exception 'CHILD_IDENTITY_MISMATCH' using errcode='55000';
  end if;
  result:=public.save_market_draft(null,null,draft_input||jsonb_build_object(
    '_change_origin','radar_expert_issue_draft_v1','_binding_managed_externally',true,
    '_expert_candidate_id',candidate.id,'_expert_run_id',expert.id,
    '_expert_origin_fingerprint',expert.origin_fingerprint,
    '_expert_origin_preparation_revision',candidate.preparation_revision));
  draft_id_value:=(result #>> '{draft,id}')::uuid;
  select * into saved_draft from private.market_drafts where id=draft_id_value for update;
  if not found then raise exception 'DRAFT_NOT_FOUND' using errcode='P0001'; end if;
  provenance:=jsonb_build_object(
    'origin_type','radar_candidate','origin_candidate_id',candidate_id_input,
    'origin_preparation_revision',candidate.preparation_revision,
    'origin_fingerprint',candidate.fingerprint,'expert_run_id',expert_run_id_input,
    'issue_draft_request_hash',draft_request_hash_value,
    'workflow_issues',workflow_issues,'temporal_contract',temporal_contract,
    'candidate_workflow_issue_fingerprints',candidate_issue_fingerprints,
    'binding_status','pending_recovery','created_by_actor',actor,
    'provider_truth',jsonb_build_object(
      'provider',candidate.provider,'external_id',candidate.external_id,
      'source_close_at',candidate.normalized_payload -> 'source_close_at',
      'source_resolution_deadline',candidate.normalized_payload -> 'source_resolution_deadline'
    )
  );
  update private.market_drafts set
    intelligence_origin_type='radar_candidate',intelligence_origin_id=candidate_id_input::text,
    expert_run_id=expert_run_id_input,source_provenance=provenance,
    artifact_status='draft_with_repairable_issues',workflow_owner_stage='validator',
    workflow_next_action='request_market_validation',workflow_issue_count=jsonb_array_length(workflow_issues)
  where id=draft_id_value
    and (intelligence_origin_type is null or (
      intelligence_origin_type='radar_candidate'
      and intelligence_origin_id=candidate_id_input::text
      and expert_run_id=expert_run_id_input
    ));
  get diagnostics updated_count=row_count;
  if updated_count<>1 then
    raise exception 'MARKET_EXPERT_DRAFT_SCOPE_MISMATCH' using errcode='40001';
  end if;
  if candidate.family_version='atinara-market-family-v4'
     and candidate.family_key is not null
     and candidate.family_child_key is not null then
    update private.market_drafts set
      family_key=candidate.family_key,
      family_title=candidate.family_title,
      family_type=candidate.family_type,
      family_child_key=candidate.family_child_key,
      family_child_label=candidate.family_child_label,
      family_sort_at=candidate.family_sort_at,
      family_relationship='standalone',
      family_semantics=coalesce(candidate.family_semantics,'{}'::jsonb),
      family_source_event_key=candidate.family_source_event_key,
      family_version=candidate.family_version
    where id=draft_id_value;
  end if;
  select * into saved_draft from private.market_drafts where id=draft_id_value;
  if candidate.family_version='atinara-market-family-v4'
     and candidate.family_key is not null
     and candidate.family_child_key is not null
     and (saved_draft.family_key is distinct from candidate.family_key
       or saved_draft.family_child_key is distinct from candidate.family_child_key) then
    raise exception 'CHILD_IDENTITY_MISMATCH' using errcode='55000';
  end if;
  return result||jsonb_build_object(
    'draft',(result -> 'draft')||jsonb_build_object(
      'source_provenance',provenance,'artifact_status',saved_draft.artifact_status,
      'workflow_owner_stage',saved_draft.workflow_owner_stage,
      'workflow_next_action',saved_draft.workflow_next_action,
      'workflow_issue_count',saved_draft.workflow_issue_count,
      'family_key',saved_draft.family_key,'family_title',saved_draft.family_title,
      'family_type',saved_draft.family_type,'family_child_key',saved_draft.family_child_key,
      'family_child_label',saved_draft.family_child_label,
      'family_sort_at',saved_draft.family_sort_at,
      'family_relationship',saved_draft.family_relationship,
      'family_semantics',saved_draft.family_semantics,
      'family_source_event_key',saved_draft.family_source_event_key,
      'family_version',saved_draft.family_version),
    'workflow_issues',workflow_issues,'binding_status','pending_recovery',
    'creates_private_draft',true,'publishes',false,'confirms',false
  );
end;
$function$;
revoke all on function public.save_market_draft_from_expert_with_issues_v1(uuid,uuid,jsonb)
  from public,anon,authenticated,service_role;
grant execute on function public.save_market_draft_from_expert_with_issues_v1(uuid,uuid,jsonb)
  to authenticated;

create or replace function private.market_draft_has_blocking_workflow_issue_v1(
  draft_id_input uuid,
  version_input bigint,
  scopes_input text[]
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1 from private.market_workflow_issue_occurrences_v1 occurrence
    join private.market_workflow_issue_subject_links_v1 link on link.issue_id=occurrence.issue_id
    left join lateral (
      select event.new_status,event.owner_stage,event.next_action
      from private.market_workflow_issue_events_v1 event
      where event.issue_id=occurrence.issue_id
      order by event.occurred_at desc,event.id desc limit 1
    ) latest on true
    where link.subject_type='market_draft'
      and link.subject_key=draft_id_input::text
      and link.subject_version=version_input::text
      and occurrence.blocking_scope=any(scopes_input)
      and coalesce(latest.new_status,'open') not in ('resolved','superseded')
      and not (
        occurrence.blocking_scope='approval'
        and coalesce(latest.new_status,'open')='waiting'
        and coalesce(latest.owner_stage,occurrence.owner_stage)='validator'
        and coalesce(latest.next_action,occurrence.next_action)='request_market_validation'
      )
      and not (
        occurrence.issue_code='PUBLICATION_TECHNICAL_FAILURE'
        and occurrence.blocking_scope='publication'
        and coalesce(latest.new_status,'open')='in_progress'
        and coalesce(latest.owner_stage,occurrence.owner_stage)='internal_platform'
        and coalesce(latest.next_action,occurrence.next_action)='retry_market_publication'
      )
  );
$function$;
revoke all on function private.market_draft_has_blocking_workflow_issue_v1(uuid,bigint,text[])
  from public,anon,authenticated,service_role;

create or replace function private.market_draft_workflow_authority_gate_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare candidate private.external_market_candidates%rowtype;
begin
  if new.workflow_status is not distinct from old.workflow_status then return new; end if;
  if new.workflow_status in ('review_approved','human_confirmed','scheduled','published')
     and new.intelligence_origin_type='radar_candidate'
     and new.radar_candidate_id is null then
    raise exception 'RADAR_ELIGIBILITY_REQUIRED' using errcode='55000';
  end if;
  if new.workflow_status in ('review_approved','human_confirmed','scheduled','published')
     and new.intelligence_origin_type='radar_candidate' then
    perform private.assert_market_candidate_draft_identity_v1(new.radar_candidate_id,to_jsonb(new));
    select * into candidate from private.external_market_candidates
    where id=new.radar_candidate_id;
    if not found or row(
      new.family_key,new.family_title,new.family_type,new.family_child_key,
      new.family_child_label,new.family_sort_at,
      new.family_semantics,new.family_source_event_key,new.family_version
    ) is distinct from row(
      candidate.family_key,candidate.family_title,candidate.family_type,candidate.family_child_key,
      candidate.family_child_label,candidate.family_sort_at,
      candidate.family_semantics,candidate.family_source_event_key,candidate.family_version
    ) then
      raise exception 'CHILD_IDENTITY_MISMATCH' using errcode='55000';
    end if;
  end if;
  if new.workflow_status='review_approved'
     and private.market_draft_has_blocking_workflow_issue_v1(
       new.id,new.content_version,array['approval','terminal']) then
    raise exception 'MARKET_WORKFLOW_APPROVAL_BLOCKED' using errcode='55000';
  end if;
  if new.workflow_status='human_confirmed'
     and private.market_draft_has_blocking_workflow_issue_v1(
       new.id,new.content_version,array['approval','human_confirmation','terminal']) then
    raise exception 'MARKET_WORKFLOW_CONFIRMATION_BLOCKED' using errcode='55000';
  end if;
  if new.workflow_status in ('scheduled','published')
     and private.market_draft_has_blocking_workflow_issue_v1(
       new.id,new.content_version,array['approval','human_confirmation','publication','terminal']) then
    raise exception 'MARKET_WORKFLOW_PUBLICATION_BLOCKED' using errcode='55000';
  end if;
  return new;
end;
$function$;
revoke all on function private.market_draft_workflow_authority_gate_v1()
  from public,anon,authenticated,service_role;
create trigger z_market_draft_workflow_authority_gate_v1
before update of workflow_status on private.market_drafts
for each row execute function private.market_draft_workflow_authority_gate_v1();

create or replace function public.confirm_market_draft_review_v2(
  draft_id_input uuid,
  expected_version_input bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  result jsonb;
  draft private.market_drafts%rowtype;
  issue jsonb;
  issue_id_value uuid;
  error_code_value text;
  issue_owner_value text;
  issue_repairability_value text;
  issue_scope_value text;
  issue_action_value text;
  issue_retryable_value boolean;
begin
  perform private.require_current_admin();
  select * into draft from private.market_drafts where id=draft_id_input for share;
  if not found then raise exception 'DRAFT_NOT_FOUND' using errcode='P0001'; end if;
  if draft.content_version is distinct from expected_version_input then
    return jsonb_build_object('ok',false,'status','confirmation_stale',
      'error','DRAFT_VERSION_MOVED','owner_stage','human_review',
      'next_action','reload_current_draft','state_preserved',true,'retryable',true,
      'current_version',draft.content_version);
  end if;
  if draft.workflow_status in ('scheduled','published') then
    return jsonb_build_object('ok',true,'status',draft.workflow_status,
      'idempotency_replay',true,'state_preserved',true,
      'artifact_status',case when draft.workflow_status='published'
        then 'published' else 'scheduled' end,
      'owner_stage',case when draft.workflow_status='scheduled'
        then 'publication_gate' else null end,
      'next_action',case when draft.workflow_status='scheduled'
        then 'wait_for_scheduled_publication' else null end);
  end if;
  if draft.content_version=expected_version_input then
    perform private.advance_market_draft_workflow_issues_v1(
      draft.id,draft.content_version,array['none'],array['CONFIRMATION_TECHNICAL_FAILURE'],
      'superseded','human_review','confirm_market_draft',
      'confirmation_retry_revalidation',auth.uid()
    );
  end if;
  begin
    result:=public.confirm_market_draft_review(draft_id_input,expected_version_input);
    select * into draft from private.market_drafts where id=draft_id_input;
    update private.market_drafts set artifact_status=case workflow_status
        when 'published' then 'published' when 'scheduled' then 'scheduled'
        else 'human_confirmed' end,
      workflow_owner_stage=case when workflow_status='published' then null
        else 'publication_gate' end,
      workflow_next_action=case when workflow_status='published' then null
        when workflow_status='scheduled' then 'wait_for_scheduled_publication'
        else 'revalidate_and_publish' end
    where id=draft_id_input;
    return result||jsonb_build_object('ok',true,'owner_stage',case
        when draft.workflow_status='published' then null else 'publication_gate' end,
      'next_action',case when draft.workflow_status='published' then null
        when draft.workflow_status='scheduled' then 'wait_for_scheduled_publication'
        else 'revalidate_and_publish' end,
      'artifact_status',case when draft.workflow_status='published'
        then 'published' when draft.workflow_status='scheduled' then 'scheduled'
        else 'human_confirmed' end);
  exception when others then
    error_code_value:=case when sqlerrm ~ '^[A-Z][A-Z0-9_]{2,100}$' then sqlerrm
      else 'CONFIRMATION_TECHNICAL_FAILURE' end;
    if error_code_value='MARKET_WORKFLOW_CONFIRMATION_BLOCKED' then
      issue:=private.market_draft_blocking_workflow_issue_v1(
        draft_id_input,expected_version_input,
        array['approval','human_confirmation','terminal']
      );
      if issue is not null then
        return jsonb_build_object('ok',false,'status',case
            when issue ->> 'repairability'='terminal' then 'confirmation_failed_terminal'
            else 'confirmation_blocked_recoverable' end,
          'error',issue ->> 'issue_code','issue',issue,
          'owner_stage',issue ->> 'owner_stage','next_action',issue ->> 'next_action',
          'state_preserved',true,'retryable',(issue ->> 'retryable')::boolean);
      end if;
    end if;
    issue_owner_value:=case
      when error_code_value='CONFIRMATION_TECHNICAL_FAILURE' then 'internal_platform'
      when error_code_value like 'RADAR_%' or error_code_value like 'ELIGIBILITY_%' then 'radar'
      when error_code_value='CURRENT_BINDING_COMPATIBILITY_REQUIRED'
        or error_code_value like 'TEMPORAL_%'
        or error_code_value in (
          'SOURCE_BINDING_REQUIRED','SOURCE_BINDING_NOT_FOUND',
          'SOURCE_BINDING_VALIDATION_REQUIRED','SOURCE_BINDING_CONTRACT_CHANGED',
          'SOURCE_BINDING_PROVENANCE_REQUIRED','SOURCE_CONTRACT_NOT_LOCKED',
          'SOURCE_STALE','RESOLUTION_PLAN_NOT_LOCKED'
        ) then 'corrector'
      when error_code_value in (
        'SOURCE_SCHEDULER_NOT_ENABLED','SOURCE_PROVIDER_NOT_CONFIGURED',
        'SOURCE_MONITOR_NOT_ARMED'
      ) or error_code_value like 'SOURCE_REGISTRY_%' then 'internal_platform'
      else 'validator' end;
    issue_action_value:=case
      when error_code_value='CONFIRMATION_TECHNICAL_FAILURE' then 'retry_human_confirmation'
      when issue_owner_value='radar' then 'refresh_draft_eligibility'
      when issue_owner_value='corrector' then 'repair_temporal_or_source_contract'
      when error_code_value='SOURCE_SCHEDULER_NOT_ENABLED' then 'review_source_scheduler_configuration'
      when error_code_value='SOURCE_PROVIDER_NOT_CONFIGURED' then 'review_source_provider_configuration'
      when error_code_value='SOURCE_MONITOR_NOT_ARMED' then 'review_source_monitor_configuration'
      when error_code_value like 'SOURCE_REGISTRY_%' then 'review_source_registry_configuration'
      else 'request_market_validation' end;
    issue_repairability_value:=case
      when error_code_value='CONFIRMATION_TECHNICAL_FAILURE' then 'auto_recoverable'
      when issue_owner_value='corrector' and error_code_value not like 'TEMPORAL_%'
        then 'waiting_authoritative_source'
      else 'human_editable' end;
    issue_scope_value:=case when error_code_value='CONFIRMATION_TECHNICAL_FAILURE'
      then 'none' else 'human_confirmation' end;
    issue_retryable_value:=not (
      error_code_value in (
        'SOURCE_SCHEDULER_NOT_ENABLED','SOURCE_PROVIDER_NOT_CONFIGURED',
        'SOURCE_MONITOR_NOT_ARMED'
      ) or error_code_value like 'SOURCE_REGISTRY_%'
    );
    issue:=private.market_workflow_server_issue_v1(
      error_code_value,'human_review',issue_owner_value,issue_repairability_value,
      issue_scope_value,issue_action_value,
      jsonb_build_object('draft_id',draft_id_input,'expected_version',expected_version_input),
      issue_retryable_value,'atinara-human-confirmation-gate-v1'
    );
    issue_id_value:=private.record_market_workflow_issue_v1(
      'market_draft',draft_id_input::text,expected_version_input::text,draft.content_fingerprint,
      issue,null,null
    );
    issue:=jsonb_set(issue,'{issue_id}',to_jsonb(issue_id_value),true);
    return jsonb_build_object('ok',false,'status','confirmation_blocked_recoverable',
      'error',error_code_value,'issue',issue,'owner_stage',issue ->> 'owner_stage',
      'next_action',issue ->> 'next_action','state_preserved',true,
      'retryable',issue_retryable_value);
  end;
end;
$function$;
revoke all on function public.confirm_market_draft_review_v2(uuid,bigint)
  from public,anon,authenticated,service_role;
grant execute on function public.confirm_market_draft_review_v2(uuid,bigint)
  to authenticated;

create or replace function public.recover_market_draft_radar_eligibility_v1(
  draft_id_input uuid,
  expected_version_input bigint,
  expected_fingerprint_input text,
  candidate_id_input uuid,
  actor_id_input uuid,
  attempt_id_input uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  draft private.market_drafts%rowtype;
  candidate private.external_market_candidates%rowtype;
  expert private.market_expert_runs%rowtype;
  eligibility private.market_radar_eligibility_checks%rowtype;
  binding jsonb;
  provenance_issue_fingerprints jsonb;
  candidate_issue_fingerprints jsonb;
  active_issues jsonb;
  terminal_issue jsonb;
  blocking_issue jsonb;
begin
  if auth.role()<>'service_role' then
    raise exception 'SERVICE_ROLE_REQUIRED' using errcode='42501';
  end if;
  if actor_id_input is null or not exists (
    select 1 from auth.users where id=actor_id_input
      and coalesce((raw_app_meta_data ->> 'oraklo_admin')::boolean,false)
  ) or attempt_id_input is null or coalesce(expected_fingerprint_input,'') !~ '^[a-f0-9]{64}$' then
    raise exception 'ADMIN_REQUIRED' using errcode='42501';
  end if;
  select * into draft from private.market_drafts where id=draft_id_input for update;
  if not found then raise exception 'DRAFT_NOT_FOUND' using errcode='P0001'; end if;
  if draft.content_version is distinct from expected_version_input
     or draft.content_fingerprint is distinct from expected_fingerprint_input
     or draft.intelligence_origin_type<>'radar_candidate'
     or draft.intelligence_origin_id is distinct from candidate_id_input::text
     or draft.market_id is not null then
    raise exception 'DRAFT_VERSION_MOVED' using errcode='40001';
  end if;
  select * into candidate from private.external_market_candidates
  where id=candidate_id_input for update;
  if not found then raise exception 'RADAR_CANDIDATE_NOT_FOUND' using errcode='P0001'; end if;
  select * into expert from private.market_expert_runs where id=draft.expert_run_id;
  provenance_issue_fingerprints:=coalesce(
    draft.source_provenance -> 'candidate_workflow_issue_fingerprints','[]'::jsonb
  );
  select coalesce(jsonb_agg(issue ->> 'fingerprint' order by issue ->> 'fingerprint'),'[]'::jsonb)
    into candidate_issue_fingerprints
  from jsonb_array_elements(coalesce(candidate.normalized_payload -> 'workflow_issues','[]'::jsonb)) issue
  where issue ->> 'issue_code' not in ('RADAR_ELIGIBILITY_REQUIRED','ELIGIBILITY_EXPIRED');
  if not found or expert.origin_type<>'radar_candidate'
     or expert.origin_id is distinct from candidate.id::text
     or expert.status<>'completed'
     or expert.result_json ->> 'origin_analysis_fingerprint' is distinct from expert.origin_fingerprint
     or expert.result_json ->> 'origin_source_fingerprint' is distinct from candidate.fingerprint
     or draft.source_provenance ->> 'origin_fingerprint' is distinct from candidate.fingerprint
     or draft.source_provenance ->> 'origin_preparation_revision'
       is distinct from expert.result_json ->> 'origin_preparation_revision'
     or draft.source_provenance #>> '{temporal_contract,decision_hash}'
       is distinct from candidate.normalized_payload #>> '{temporal_contract,decision_hash}'
     or provenance_issue_fingerprints is distinct from candidate_issue_fingerprints
     or (candidate.family_version='atinara-market-family-v4'
       and (draft.family_key is distinct from candidate.family_key
         or draft.family_child_key is distinct from candidate.family_child_key)) then
    raise exception 'MARKET_EXPERT_ANALYSIS_STALE' using errcode='40001';
  end if;
  perform private.assert_market_candidate_draft_identity_v1(candidate.id,to_jsonb(draft));
  candidate:=private.assert_market_radar_candidate_eligible_v1(
    candidate.id,candidate.preparation_revision);
  select * into eligibility from private.market_radar_eligibility_checks
  where id=candidate.current_eligibility_check_id for share;
  if not found or eligibility.status<>'eligible'
     or eligibility.policy_version<>'atinara-prediction-policy-v5'
     or eligibility.expires_at<=clock_timestamp() then
    raise exception 'RADAR_ELIGIBILITY_REQUIRED' using errcode='55000';
  end if;
  if candidate.prepared_draft_id is not null and candidate.prepared_draft_id<>draft.id then
    raise exception 'RADAR_DRAFT_SCOPE_MISMATCH' using errcode='55000';
  end if;
  update private.external_market_candidates set state='prepared',prepared_draft_id=draft.id,
    updated_at=clock_timestamp() where id=candidate.id;
  -- El trigger canónico versiona la preparación al cambiar el estado o el
  -- borrador reservado. La vinculación debe usar esa revisión persistida, no
  -- la copia anterior al UPDATE.
  select * into candidate from private.external_market_candidates
  where id=candidate_id_input for update;
  update private.market_drafts set radar_candidate_id=candidate.id,
    source_provenance=coalesce(source_provenance,'{}'::jsonb)||jsonb_build_object(
      'radar_candidate_id',candidate.id,
      'radar_preparation_revision',candidate.preparation_revision,
      'radar_eligibility_check_id',eligibility.id,
      'radar_eligibility_policy_version',eligibility.policy_version,
      'radar_eligibility_decision_hash',eligibility.decision_hash,
      'binding_status','recovered'
    ),
    artifact_status='draft_with_repairable_issues',workflow_owner_stage='validator',
    workflow_next_action='request_market_validation'
  where id=draft.id;
  select * into draft from private.market_drafts where id=draft_id_input;
  binding:=public.bind_market_radar_draft_eligibility_v2(
    candidate.id,draft.id,draft.content_version,draft.content_fingerprint,
    candidate.preparation_revision,eligibility.id,actor_id_input,attempt_id_input
  );
  perform private.advance_market_draft_workflow_issues_v1(
    draft.id,draft.content_version,array['approval','human_confirmation','publication'],
    array['RADAR_ELIGIBILITY_REQUIRED','ELIGIBILITY_EXPIRED'],'resolved','validator',
    'request_market_validation','eligibility_recovered',actor_id_input
  );
  select coalesce(jsonb_agg(value),'[]'::jsonb) into active_issues
  from jsonb_array_elements(public.get_market_workflow_issues_v1(
    'market_draft',draft.id::text,draft.content_version::text
  )) value
  where value ->> 'status' not in ('resolved','superseded');
  select value into terminal_issue from jsonb_array_elements(active_issues) value
  where value ->> 'repairability'='terminal' or value ->> 'blocking_scope'='terminal'
  order by value ->> 'created_at',value ->> 'issue_id' limit 1;
  select value into blocking_issue from jsonb_array_elements(active_issues) value
  where value ->> 'blocking_scope'='approval'
  order by case value ->> 'severity' when 'blocking' then 0 when 'warning' then 1 else 2 end,
    value ->> 'created_at',value ->> 'issue_id' limit 1;
  update private.market_drafts set
    artifact_status=case when terminal_issue is not null then 'review_rejected_terminal'
      when blocking_issue is not null then 'draft_with_repairable_issues'
      when draft.workflow_status='published' then 'published'
      when draft.workflow_status='scheduled' then 'scheduled'
      when draft.workflow_status='human_confirmed' then 'human_confirmed'
      when draft.workflow_status='review_approved' then 'review_approved'
      else 'draft_ready_for_validation' end,
    workflow_owner_stage=case when terminal_issue is not null
      then coalesce(terminal_issue ->> 'owner_stage','human_review')
      when blocking_issue is not null then coalesce(blocking_issue ->> 'owner_stage','validator')
      when draft.workflow_status='published' then null
      when draft.workflow_status in ('scheduled','human_confirmed') then 'publication_gate'
      when draft.workflow_status='review_approved' then 'human_review'
      else 'validator' end,
    workflow_next_action=case when terminal_issue is not null
      then coalesce(terminal_issue ->> 'next_action','archive_terminal_candidate')
      when blocking_issue is not null then coalesce(blocking_issue ->> 'next_action','request_market_validation')
      when draft.workflow_status='published' then null
      when draft.workflow_status='scheduled' then 'wait_for_scheduled_publication'
      when draft.workflow_status='human_confirmed' then 'revalidate_and_publish'
      when draft.workflow_status='review_approved' then 'confirm_market_draft'
      else 'request_market_validation' end,
    workflow_issue_count=jsonb_array_length(active_issues)
  where id=draft.id and content_version=draft.content_version
  returning * into draft;
  return binding||jsonb_build_object('ok',true,'draft_id',draft.id,'candidate_id',candidate.id,
    'eligibility_check_id',eligibility.id,'artifact_status',draft.artifact_status,
    'owner_stage',draft.workflow_owner_stage,'next_action',draft.workflow_next_action,
    'workflow_issue_count',draft.workflow_issue_count);
end;
$function$;
revoke all on function public.recover_market_draft_radar_eligibility_v1(uuid,bigint,text,uuid,uuid,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.recover_market_draft_radar_eligibility_v1(uuid,bigint,text,uuid,uuid,uuid)
  to service_role;

create or replace function public.get_market_draft_eligibility_recovery_replay_v1(
  attempt_id_input uuid,
  draft_id_input uuid,
  expected_version_input bigint,
  expected_fingerprint_input text,
  candidate_id_input uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  binding private.market_draft_eligibility_bindings%rowtype;
  draft private.market_drafts%rowtype;
begin
  if auth.role()<>'service_role' then
    raise exception 'SERVICE_ROLE_REQUIRED' using errcode='42501';
  end if;
  if attempt_id_input is null or draft_id_input is null or candidate_id_input is null
     or expected_version_input<1
     or coalesce(expected_fingerprint_input,'')!~'^[a-f0-9]{64}$' then
    raise exception 'INVALID_DRAFT_ELIGIBILITY_SCOPE' using errcode='22023';
  end if;
  select * into binding from private.market_draft_eligibility_bindings
  where attempt_id=attempt_id_input;
  if not found then return jsonb_build_object('replayed',false); end if;
  if binding.draft_id is distinct from draft_id_input
     or binding.draft_version is distinct from expected_version_input
     or binding.draft_fingerprint is distinct from lower(expected_fingerprint_input)
     or binding.candidate_id is distinct from candidate_id_input then
    raise exception 'IDEMPOTENCY_KEY_REUSED' using errcode='23505';
  end if;
  select * into draft from private.market_drafts where id=draft_id_input;
  if not found or draft.content_version is distinct from expected_version_input
     or draft.content_fingerprint is distinct from lower(expected_fingerprint_input)
     or draft.radar_candidate_id is distinct from candidate_id_input then
    raise exception 'DRAFT_VERSION_MOVED' using errcode='40001';
  end if;
  return jsonb_build_object(
    'ok',true,'replayed',true,'status','eligibility_recovered',
    'attempt_id',binding.attempt_id,'draft_id',binding.draft_id,
    'candidate_id',binding.candidate_id,
    'eligibility_check_id',binding.eligibility_check_id,
    'preparation_revision',binding.preparation_revision,
    'eligibility_decision_hash',binding.eligibility_decision_hash,
    'policy_version',binding.policy_version,'bound_at',binding.bound_at,
    'state_preserved',true,'owner_stage','validator',
    'next_action','request_market_validation'
  );
end;
$function$;
revoke all on function public.get_market_draft_eligibility_recovery_replay_v1(
  uuid,uuid,bigint,text,uuid
) from public,anon,authenticated,service_role;
grant execute on function public.get_market_draft_eligibility_recovery_replay_v1(
  uuid,uuid,bigint,text,uuid
) to service_role;

-- The V6 wrappers are the only API-visible orchestration surface. Historical
-- postgres-owned primitives remain available to those wrappers without
-- allowing clients to bypass the issue ledger, checkpoints or attempt log.
revoke all on function public.confirm_market_draft_review(uuid,bigint)
  from public,anon,authenticated,service_role;
revoke all on function public.publish_market_draft(uuid,bigint,timestamptz)
  from public,anon,authenticated,service_role;
revoke all on function public.publish_due_market_drafts(integer)
  from public,anon,authenticated,service_role;
revoke all on function public.record_market_draft_review_v2(uuid,text,jsonb,jsonb,uuid,text,jsonb)
  from public,anon,authenticated,service_role;
revoke all on function public.apply_market_draft_expert_repair_v2(
  uuid,bigint,jsonb,jsonb,jsonb,uuid,jsonb
) from public,anon,authenticated,service_role;
revoke all on function public.begin_market_draft_repair_attempt_v1(uuid,bigint,uuid)
  from public,anon,authenticated,service_role;
revoke all on function public.complete_market_draft_repair_attempt_v1(
  uuid,text,text,text,boolean,text,text,bigint,text,jsonb
) from public,anon,authenticated,service_role;
revoke all on function public.project_market_draft_repair_outcome_v1(
  uuid,bigint,text,text,text,uuid
) from public,anon,authenticated,service_role;

alter table private.market_workflow_issue_occurrences_v1 owner to postgres;
alter table private.market_workflow_issue_events_v1 owner to postgres;
alter table private.market_workflow_issue_subject_links_v1 owner to postgres;
alter table private.market_radar_temporal_contracts_v1 owner to postgres;
alter table private.market_radar_domain_reviews_v1 owner to postgres;
alter table private.market_publication_attempts_v1 owner to postgres;
alter table private.market_repair_workflow_checkpoints_v1 owner to postgres;

alter function private.reject_market_workflow_append_only_v1() owner to postgres;
alter function private.advance_market_draft_workflow_issues_v1(uuid,bigint,text[],text[],text,text,text,text,uuid) owner to postgres;
alter function private.assert_market_candidate_draft_identity_v1(uuid,jsonb) owner to postgres;
alter function private.assert_repair_checkpoint_issue_scope_v1(uuid,bigint,jsonb) owner to postgres;
alter function private.record_market_workflow_issue_v1(text,text,text,text,jsonb,text,text) owner to postgres;
alter function private.link_market_workflow_issue_subject_v1(uuid,text,text,text,text) owner to postgres;
alter function private.capture_market_radar_provider_workflow_v1() owner to postgres;
alter function public.attach_market_workflow_issues_v1(text,text,text,text,jsonb) owner to postgres;
alter function public.attach_market_review_workflow_issues_v1(uuid,bigint,uuid,jsonb) owner to postgres;
alter function public.transition_market_workflow_issue_v1(uuid,text,text,text,text,text,jsonb) owner to postgres;
alter function public.get_market_workflow_issues_v1(text,text,text) owner to postgres;
alter function public.get_market_radar_domain_reviews_v1(jsonb) owner to postgres;
alter function public.review_market_radar_domain_v1(uuid,bigint,text,text,text,jsonb,uuid,uuid) owner to postgres;
alter function private.capture_market_radar_workflow_v1() owner to postgres;
alter function private.preserve_market_radar_terminal_workflow_v1() owner to postgres;
alter function private.enforce_market_radar_eligibility_v1() owner to postgres;
alter function private.capture_market_expert_workflow_v1() owner to postgres;
alter function private.project_market_draft_workflow_v1() owner to postgres;
alter function private.block_scheduled_market_draft_content_edit_v1() owner to postgres;
alter function private.capture_market_draft_workflow_v1() owner to postgres;
alter function private.serialize_market_draft_primary_source_check_v1() owner to postgres;
alter function private.market_draft_primary_source_check_is_current_v1(uuid,uuid,bigint) owner to postgres;
alter function private.market_draft_publication_source_ready_v1(uuid,bigint,boolean) owner to postgres;
alter function public.record_market_draft_review_with_issues_v1(uuid,text,jsonb,jsonb,uuid,text,jsonb,jsonb) owner to postgres;
alter function public.get_admin_market_draft_v2(uuid) owner to postgres;
alter function private.market_family_option_from_question_v1(text) owner to postgres;
alter function private.assign_market_candidate_family_v4() owner to postgres;
alter function public.list_market_radar_candidates_v3(text,text,text,text,text,text,integer,integer) owner to postgres;
alter function private.market_workflow_server_issue_v1(text,text,text,text,text,text,jsonb,boolean,text) owner to postgres;
alter function private.market_workflow_canonical_json_v1(jsonb) owner to postgres;
alter function private.market_draft_blocking_workflow_issue_v1(uuid,bigint,text[]) owner to postgres;
alter function private.capture_official_opportunity_workflow_v1() owner to postgres;
alter function private.publication_issue_v1(uuid,bigint,text) owner to postgres;
alter function public.publish_market_draft_v2(uuid,bigint,timestamptz,uuid) owner to postgres;
alter function public.publish_due_market_drafts_v2(integer) owner to postgres;
alter function public.retry_scheduled_market_publication_v1(uuid) owner to postgres;
alter function public.cancel_scheduled_market_publication_v1(uuid) owner to postgres;
alter function public.archive_terminal_market_draft_v1(uuid,bigint) owner to postgres;
alter function public.project_market_draft_repair_outcome_v1(uuid,bigint,text,text,text,uuid) owner to postgres;
alter function public.complete_market_draft_repair_workflow_v1(uuid,text,text,text,boolean,text,text,bigint,text,jsonb,uuid,text,text,text,text,text) owner to postgres;
alter function public.apply_market_draft_expert_repair_with_checkpoint_v1(uuid,bigint,jsonb,jsonb,jsonb,uuid,jsonb,uuid,smallint,uuid,uuid,jsonb) owner to postgres;
alter function public.checkpoint_market_draft_repair_noop_v1(uuid,uuid,bigint,smallint,uuid,uuid,jsonb) owner to postgres;
alter function public.begin_market_draft_repair_workflow_v1(uuid,bigint,uuid) owner to postgres;
alter function public.revalidate_market_draft_publication_evidence_v1(uuid,bigint,text,jsonb,uuid,uuid,uuid) owner to postgres;
alter function public.get_market_draft_publication_evidence_revalidation_replay_v1(uuid,bigint,text,jsonb,uuid,uuid) owner to postgres;
alter function public.prepare_market_draft_repair_revalidation_v1(uuid,smallint) owner to postgres;
alter function public.reconcile_market_draft_repair_workflow_v1(uuid) owner to postgres;
alter function public.save_market_draft_from_expert_with_issues_v1(uuid,uuid,jsonb) owner to postgres;
alter function private.market_draft_has_blocking_workflow_issue_v1(uuid,bigint,text[]) owner to postgres;
alter function private.market_draft_workflow_authority_gate_v1() owner to postgres;
alter function public.confirm_market_draft_review_v2(uuid,bigint) owner to postgres;
alter function public.recover_market_draft_radar_eligibility_v1(uuid,bigint,text,uuid,uuid,uuid) owner to postgres;
alter function public.get_market_draft_eligibility_recovery_replay_v1(uuid,uuid,bigint,text,uuid) owner to postgres;

comment on table private.market_workflow_issue_occurrences_v1 is
  'Atinara V6: ocurrencias inmutables de incidencias; Registry V2.1 permanece separado e idéntico.';
comment on table private.market_workflow_issue_events_v1 is
  'Eventos append-only que proyectan estado, responsable, siguiente acción y resolución de cada incidencia.';
comment on table private.market_workflow_issue_subject_links_v1 is
  'Enlaces append-only que hacen viajar un único issue_id entre Radar, Expert, borrador, revisión y publicación.';
comment on table private.market_radar_temporal_contracts_v1 is
  'Snapshots temporales append-only: verdad del proveedor separada del contrato canónico de Atinara.';
comment on table private.market_radar_domain_reviews_v1 is
  'Atestaciones administrativas append-only ligadas a candidato, revisión, huella y política; nunca publican ni aprueban mercados.';
comment on table private.market_publication_attempts_v1 is
  'Ledger append-only de intentos manuales y programados, con backoff y resultado recuperable tipado.';
comment on table private.market_repair_workflow_checkpoints_v1 is
  'Checkpoint append-only que liga una escritura del Corrector con su intento y review determinista para completar sin repetir la reparación.';
comment on function public.list_market_radar_candidates_v3(text,text,text,text,text,text,integer,integer) is
  'Lista administrativa paginada por evento padre; nunca corta una familia hija antes de agrupar.';

do $postflight$
declare
  registry jsonb;
  table_name_value text;
  procedure_oid regprocedure;
  authenticated_only regprocedure[]:=array[
    'public.get_admin_market_draft_v2(uuid)'::regprocedure,
    'public.list_market_radar_candidates_v3(text,text,text,text,text,text,integer,integer)'::regprocedure,
    'public.publish_market_draft_v2(uuid,bigint,timestamptz,uuid)'::regprocedure,
    'public.retry_scheduled_market_publication_v1(uuid)'::regprocedure,
    'public.cancel_scheduled_market_publication_v1(uuid)'::regprocedure,
    'public.archive_terminal_market_draft_v1(uuid,bigint)'::regprocedure,
    'public.review_market_radar_domain_v1(uuid,bigint,text,text,text,jsonb,uuid,uuid)'::regprocedure,
    'public.save_market_draft_from_expert_with_issues_v1(uuid,uuid,jsonb)'::regprocedure,
    'public.confirm_market_draft_review_v2(uuid,bigint)'::regprocedure,
    'public.apply_market_draft_expert_repair_with_checkpoint_v1(uuid,bigint,jsonb,jsonb,jsonb,uuid,jsonb,uuid,smallint,uuid,uuid,jsonb)'::regprocedure,
    'public.checkpoint_market_draft_repair_noop_v1(uuid,uuid,bigint,smallint,uuid,uuid,jsonb)'::regprocedure,
    'public.begin_market_draft_repair_workflow_v1(uuid,bigint,uuid)'::regprocedure
  ];
  service_only regprocedure[]:=array[
    'public.attach_market_workflow_issues_v1(text,text,text,text,jsonb)'::regprocedure,
    'public.attach_market_review_workflow_issues_v1(uuid,bigint,uuid,jsonb)'::regprocedure,
    'public.transition_market_workflow_issue_v1(uuid,text,text,text,text,text,jsonb)'::regprocedure,
    'public.record_market_draft_review_with_issues_v1(uuid,text,jsonb,jsonb,uuid,text,jsonb,jsonb)'::regprocedure,
    'public.publish_due_market_drafts_v2(integer)'::regprocedure,
    'public.complete_market_draft_repair_workflow_v1(uuid,text,text,text,boolean,text,text,bigint,text,jsonb,uuid,text,text,text,text,text)'::regprocedure,
    'public.reconcile_market_draft_repair_workflow_v1(uuid)'::regprocedure,
    'public.prepare_market_draft_repair_revalidation_v1(uuid,smallint)'::regprocedure,
    'public.revalidate_market_draft_publication_evidence_v1(uuid,bigint,text,jsonb,uuid,uuid,uuid)'::regprocedure,
    'public.get_market_draft_publication_evidence_revalidation_replay_v1(uuid,bigint,text,jsonb,uuid,uuid)'::regprocedure,
    'public.recover_market_draft_radar_eligibility_v1(uuid,bigint,text,uuid,uuid,uuid)'::regprocedure
    ,'public.get_market_draft_eligibility_recovery_replay_v1(uuid,uuid,bigint,text,uuid)'::regprocedure,
    'public.get_market_radar_domain_reviews_v1(jsonb)'::regprocedure
  ];
  authenticated_and_service regprocedure[]:=array[
    'public.get_market_workflow_issues_v1(text,text,text)'::regprocedure
  ];
  internal_only regprocedure[]:=array[
    'public.confirm_market_draft_review(uuid,bigint)'::regprocedure,
    'public.publish_market_draft(uuid,bigint,timestamptz)'::regprocedure,
    'public.publish_due_market_drafts(integer)'::regprocedure,
    'public.record_market_draft_review_v2(uuid,text,jsonb,jsonb,uuid,text,jsonb)'::regprocedure,
    'public.apply_market_draft_expert_repair_v2(uuid,bigint,jsonb,jsonb,jsonb,uuid,jsonb)'::regprocedure,
    'public.begin_market_draft_repair_attempt_v1(uuid,bigint,uuid)'::regprocedure,
    'public.complete_market_draft_repair_attempt_v1(uuid,text,text,text,boolean,text,text,bigint,text,jsonb)'::regprocedure,
    'public.project_market_draft_repair_outcome_v1(uuid,bigint,text,text,text,uuid)'::regprocedure
  ];
  private_functions regprocedure[]:=array[
    'private.reject_market_workflow_append_only_v1()'::regprocedure,
    'private.record_market_workflow_issue_v1(text,text,text,text,jsonb,text,text)'::regprocedure,
    'private.link_market_workflow_issue_subject_v1(uuid,text,text,text,text)'::regprocedure,
    'private.capture_market_radar_provider_workflow_v1()'::regprocedure,
    'private.capture_market_radar_workflow_v1()'::regprocedure,
    'private.preserve_market_radar_terminal_workflow_v1()'::regprocedure,
    'private.enforce_market_radar_eligibility_v1()'::regprocedure,
    'private.capture_market_expert_workflow_v1()'::regprocedure,
    'private.project_market_draft_workflow_v1()'::regprocedure,
    'private.block_scheduled_market_draft_content_edit_v1()'::regprocedure,
    'private.capture_market_draft_workflow_v1()'::regprocedure,
    'private.serialize_market_draft_primary_source_check_v1()'::regprocedure,
    'private.market_draft_primary_source_check_is_current_v1(uuid,uuid,bigint)'::regprocedure,
    'private.market_draft_publication_source_ready_v1(uuid,bigint,boolean)'::regprocedure,
    'private.market_family_option_from_question_v1(text)'::regprocedure,
    'private.assign_market_candidate_family_v4()'::regprocedure,
    'private.advance_market_draft_workflow_issues_v1(uuid,bigint,text[],text[],text,text,text,text,uuid)'::regprocedure,
    'private.market_workflow_server_issue_v1(text,text,text,text,text,text,jsonb,boolean,text)'::regprocedure,
    'private.market_workflow_canonical_json_v1(jsonb)'::regprocedure,
    'private.market_draft_blocking_workflow_issue_v1(uuid,bigint,text[])'::regprocedure,
    'private.capture_official_opportunity_workflow_v1()'::regprocedure,
    'private.publication_issue_v1(uuid,bigint,text)'::regprocedure,
    'private.assert_market_candidate_draft_identity_v1(uuid,jsonb)'::regprocedure,
    'private.assert_repair_checkpoint_issue_scope_v1(uuid,bigint,jsonb)'::regprocedure,
    'private.market_draft_has_blocking_workflow_issue_v1(uuid,bigint,text[])'::regprocedure,
    'private.market_draft_workflow_authority_gate_v1()'::regprocedure
  ];
  all_functions regprocedure[];
begin
  perform private.assert_market_agent_registry_consistency_v2();
  registry:=jsonb_build_object('version','atinara-agent-registry-v2.1.0',
    'hash',private.market_agent_registry_hash_v2());
  if registry ->> 'version' <> 'atinara-agent-registry-v2.1.0'
     or coalesce(registry ->> 'hash','') !~ '^[a-f0-9]{64}$' then
    raise exception 'AGENT_REGISTRY_V21_CHANGED';
  end if;
  foreach table_name_value in array array[
    'market_workflow_issue_occurrences_v1','market_workflow_issue_events_v1',
    'market_workflow_issue_subject_links_v1',
    'market_radar_temporal_contracts_v1','market_radar_domain_reviews_v1',
    'market_publication_attempts_v1',
    'market_repair_workflow_checkpoints_v1'
  ] loop
    if not exists (
      select 1 from pg_catalog.pg_class relation
      join pg_catalog.pg_namespace namespace on namespace.oid=relation.relnamespace
      where namespace.nspname='private' and relation.relname=table_name_value
        and relation.relrowsecurity and relation.relforcerowsecurity
        and pg_catalog.pg_get_userbyid(relation.relowner)='postgres'
    ) then raise exception 'MARKET_WORKFLOW_RLS_INVALID:%',table_name_value; end if;
  end loop;
  foreach procedure_oid in array authenticated_only loop
    if has_function_privilege('anon',procedure_oid,'execute')
       or not has_function_privilege('authenticated',procedure_oid,'execute')
       or has_function_privilege('service_role',procedure_oid,'execute') then
      raise exception 'MARKET_WORKFLOW_AUTHENTICATED_ACL_INVALID:%',procedure_oid;
    end if;
  end loop;
  foreach procedure_oid in array service_only loop
    if has_function_privilege('anon',procedure_oid,'execute')
       or has_function_privilege('authenticated',procedure_oid,'execute')
       or not has_function_privilege('service_role',procedure_oid,'execute') then
      raise exception 'MARKET_WORKFLOW_SERVICE_ACL_INVALID:%',procedure_oid;
    end if;
  end loop;
  foreach procedure_oid in array authenticated_and_service loop
    if has_function_privilege('anon',procedure_oid,'execute')
       or not has_function_privilege('authenticated',procedure_oid,'execute')
       or not has_function_privilege('service_role',procedure_oid,'execute') then
      raise exception 'MARKET_WORKFLOW_SHARED_ACL_INVALID:%',procedure_oid;
    end if;
  end loop;
  foreach procedure_oid in array private_functions loop
    if has_function_privilege('anon',procedure_oid,'execute')
       or has_function_privilege('authenticated',procedure_oid,'execute')
       or has_function_privilege('service_role',procedure_oid,'execute') then
      raise exception 'MARKET_WORKFLOW_PRIVATE_ACL_INVALID:%',procedure_oid;
    end if;
  end loop;
  foreach procedure_oid in array internal_only loop
    if has_function_privilege('anon',procedure_oid,'execute')
       or has_function_privilege('authenticated',procedure_oid,'execute')
       or has_function_privilege('service_role',procedure_oid,'execute') then
      raise exception 'MARKET_WORKFLOW_INTERNAL_ACL_INVALID:%',procedure_oid;
    end if;
  end loop;
  all_functions:=authenticated_only||service_only||authenticated_and_service
    ||private_functions||internal_only;
  if exists (
    select 1 from pg_proc procedure join pg_roles owner on owner.oid=procedure.proowner
    where procedure.oid=any(all_functions::oid[])
      and (owner.rolname<>'postgres' or not procedure.prosecdef
        or not (procedure.proconfig@>array['search_path=""']::text[]))
  ) then raise exception 'MARKET_WORKFLOW_FUNCTION_SECURITY_INVALID'; end if;
end;
$postflight$;

commit;
