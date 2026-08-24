-- Incidencia V6: completitud durable del padre, reconciliacion exhaustiva de
-- hijas y corte fail-closed de snapshots legacy. Migracion exclusivamente
-- aditiva: no contiene backfill ni DML sobre datos de dominio/economia.

begin;
set local lock_timeout='5s';
set local statement_timeout='120s';
select pg_catalog.pg_advisory_xact_lock(92060822205445);

do $preflight$
begin
  if to_regclass('private.market_radar_refresh_intents_v1') is null
     or to_regclass('private.market_radar_refresh_batches_v1') is null
     or to_regclass('private.external_market_candidates') is null
     or to_regclass('private.market_workflow_issue_occurrences_v1') is null
     or to_regprocedure('private.assert_market_radar_refresh_lease_v1(uuid,text,text,uuid)') is null
     or to_regprocedure('private.record_market_workflow_issue_v1(text,text,text,text,jsonb,text,text)') is null
     or to_regprocedure('public.process_market_radar_refresh_batch_v1(uuid,text,text,uuid)') is null
     or to_regprocedure('public.finalize_market_radar_refresh_v3(uuid,text,text,uuid,text,text,text,integer)') is null then
    raise exception 'RADAR_PARENT_RECONCILIATION_DEPENDENCY_MISSING';
  end if;
  if to_regprocedure('private.assert_market_radar_draft_eligibility_v1(private.market_drafts,timestamptz)') is null
     or to_regprocedure('public.begin_market_draft_review_v2(uuid,bigint,uuid,text,text,text,boolean)') is null
     or to_regprocedure('public.confirm_market_draft_review_v2(uuid,bigint)') is null
     or to_regprocedure('public.save_market_draft_from_radar(uuid,uuid,bigint,jsonb)') is null
     or to_regprocedure('public.save_market_draft_from_radar_intelligence(uuid,uuid,bigint,jsonb,uuid,jsonb,jsonb)') is null
     or to_regprocedure('public.save_market_draft_from_radar_intelligence_without_revision_guard(uuid,uuid,bigint,jsonb,uuid,jsonb,jsonb)') is null
     or to_regprocedure('public.bind_market_radar_draft_eligibility_v2(uuid,uuid,bigint,text,bigint,bigint,uuid,uuid)') is null
     or to_regprocedure('public.apply_market_draft_expert_repair_with_checkpoint_v1(uuid,bigint,jsonb,jsonb,jsonb,uuid,jsonb,uuid,smallint,uuid,uuid,jsonb)') is null
     or to_regprocedure('public.begin_market_draft_repair_workflow_v1(uuid,bigint,uuid)') is null
     or to_regprocedure('public.checkpoint_market_draft_repair_noop_v1(uuid,uuid,bigint,smallint,uuid,uuid,jsonb)') is null
     or to_regprocedure('public.complete_market_draft_repair_workflow_v1(uuid,text,text,text,boolean,text,text,bigint,text,jsonb,uuid,text,text,text,text,text)') is null
     or to_regprocedure('public.reconcile_market_draft_repair_workflow_v1(uuid)') is null
     or to_regprocedure('public.publish_market_draft_v2(uuid,bigint,timestamptz,uuid)') is null
     or to_regprocedure('public.publish_due_market_drafts_v2(integer)') is null
     or to_regprocedure('public.save_market_draft_from_expert_with_issues_v1(uuid,uuid,jsonb)') is null then
    raise exception 'RADAR_REVIEW_PREFLIGHT_DEPENDENCY_MISSING';
  end if;
  if to_regclass('private.market_radar_parent_reconciliations_v1') is not null
     or to_regclass('private.market_radar_parent_children_v1') is not null then
    raise exception 'RADAR_PARENT_RECONCILIATION_ALREADY_EXISTS';
  end if;
  if exists (
    select 1 from private.market_drafts draft
    where draft.intelligence_origin_type='radar_candidate'
      and draft.intelligence_origin_id is not null
      and draft.workflow_status not in ('cancelled','annulled')
    group by draft.intelligence_origin_type,draft.intelligence_origin_id
    having count(*)>1
  ) then
    raise exception 'RADAR_ACTIVE_DRAFT_ORIGIN_DUPLICATE';
  end if;
end;
$preflight$;

create unique index market_drafts_active_radar_origin_v1_uidx
  on private.market_drafts(intelligence_origin_type,intelligence_origin_id)
  where intelligence_origin_type='radar_candidate'
    and intelligence_origin_id is not null
    and workflow_status not in ('cancelled','annulled');

alter table private.market_radar_refresh_intents_v1
  add column parent_manifest_hash text
    check (parent_manifest_hash is null or parent_manifest_hash ~ '^[a-f0-9]{64}$'),
  add column provider_parent_count integer
    check (provider_parent_count is null or provider_parent_count between 0 and 120),
  add column reconciled_parent_count integer
    check (reconciled_parent_count is null or reconciled_parent_count between 0 and 120),
  add column incomplete_parent_count integer
    check (incomplete_parent_count is null or incomplete_parent_count between 0 and 120),
  add column provider_pagination_exhausted boolean,
  add column provider_selection jsonb
    check (provider_selection is null or (
      jsonb_typeof(provider_selection)='object' and octet_length(provider_selection::text)<=131072
    ));

alter table private.market_radar_refresh_intents_v1
  drop constraint if exists market_radar_refresh_intents_v1_expected_count_check,
  drop constraint if exists market_radar_refresh_intents_v1_staged_count_check,
  drop constraint if exists market_radar_refresh_intents_v1_processed_count_check,
  drop constraint if exists market_radar_refresh_intents_v1_accepted_count_check,
  drop constraint if exists market_radar_refresh_intents_v1_quarantined_count_check,
  drop constraint if exists market_radar_refresh_intents_v1_failed_count_check,
  add constraint market_radar_refresh_intents_v1_expected_count_check
    check (expected_count is null or expected_count between 0 and 480),
  add constraint market_radar_refresh_intents_v1_staged_count_check check (staged_count between 0 and 480),
  add constraint market_radar_refresh_intents_v1_processed_count_check check (processed_count between 0 and 480),
  add constraint market_radar_refresh_intents_v1_accepted_count_check check (accepted_count between 0 and 480),
  add constraint market_radar_refresh_intents_v1_quarantined_count_check check (quarantined_count between 0 and 480),
  add constraint market_radar_refresh_intents_v1_failed_count_check check (failed_count between 0 and 480);

alter table private.market_radar_refresh_events_v1
  drop constraint if exists market_radar_refresh_events_v1_accepted_count_check,
  drop constraint if exists market_radar_refresh_events_v1_quarantined_count_check,
  drop constraint if exists market_radar_refresh_events_v1_failed_count_check,
  add constraint market_radar_refresh_events_v1_accepted_count_check check (accepted_count between 0 and 480),
  add constraint market_radar_refresh_events_v1_quarantined_count_check check (quarantined_count between 0 and 480),
  add constraint market_radar_refresh_events_v1_failed_count_check check (failed_count between 0 and 480);

alter table private.market_radar_provider_circuits_v1
  drop constraint if exists market_radar_provider_circuits_v1_last_success_count_check,
  add constraint market_radar_provider_circuits_v1_last_success_count_check
    check (last_success_count between 0 and 480);

alter table private.market_radar_provider_run_history
  drop constraint if exists market_radar_provider_run_history_result_count_check,
  add constraint market_radar_provider_run_history_result_count_check
    check (result_count between 0 and 480);

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
set search_path to ''
as $function$
declare
  intent private.market_radar_refresh_intents_v1%rowtype;
begin
  intent:=private.assert_market_radar_refresh_lease_v1(
    request_id_input,provider_input,capability_input,lease_token_input
  );
  if capability_input<>'candidate_feed' or expected_count_input not between 0 and 480 then
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
    expected_count=expected_count_input,
    phase=case when expected_count_input=0 then 'staged' else 'fetching' end,
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
set search_path to ''
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
  if capability_input<>'candidate_feed' or expected_count_input not between 0 and 480
     or intent.expected_count is distinct from expected_count_input then
    raise exception 'RADAR_REFRESH_MANIFEST_INVALID' using errcode='22023';
  end if;
  select count(*),coalesce(sum(jsonb_array_length(items)),0),min(batch_ordinal),max(batch_ordinal),
    encode(extensions.digest(convert_to(coalesce(string_agg(
      batch_hash,'' order by batch_ordinal
    ),''),'UTF8'),'sha256'),'hex')
  into root_count,item_count,min_ordinal,max_ordinal,manifest_hash_value
  from private.market_radar_refresh_batches_v1
  where request_id=request_id_input and provider=provider_input
    and capability=capability_input and generation=0 and length(split_path)=0;
  if item_count<>expected_count_input
     or (root_count>0 and (min_ordinal<>0 or max_ordinal<>root_count-1))
     or exists (
       select 1 from private.market_radar_refresh_batches_v1 batch
       cross join lateral jsonb_array_elements(batch.items) item
       where batch.request_id=request_id_input and batch.provider=provider_input
         and batch.capability=capability_input and batch.generation=0
       group by item#>>'{candidate,external_id}' having count(*)>1
     ) then
    raise exception 'RADAR_REFRESH_MANIFEST_INVALID' using errcode='22023';
  end if;
  if intent.manifest_hash is not null then
    if intent.manifest_hash is distinct from manifest_hash_value
       or intent.expected_count is distinct from expected_count_input then
      raise exception 'RADAR_REFRESH_MANIFEST_IDEMPOTENCY_CONFLICT' using errcode='40001';
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
    'staged','persisting',intent.accepted_count,intent.quarantined_count,
    intent.failed_count,null,null
  );
  return jsonb_build_object('ok',true,'replayed',false,'manifest_hash',intent.manifest_hash,
    'expected_count',intent.expected_count,'phase',intent.phase);
end;
$function$;
alter function public.seal_market_radar_refresh_v1(uuid,text,text,uuid,integer)
  owner to postgres;
revoke all on function public.seal_market_radar_refresh_v1(uuid,text,text,uuid,integer)
  from public,anon,authenticated,service_role;
grant execute on function public.seal_market_radar_refresh_v1(uuid,text,text,uuid,integer)
  to service_role;

create table private.market_radar_parent_reconciliations_v1 (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null,
  provider text not null check (provider in ('polymarket','kalshi')),
  capability text not null default 'candidate_feed' check (capability='candidate_feed'),
  provider_parent_id text not null check (char_length(provider_parent_id) between 1 and 220),
  raw_provider_parent_label text,
  canonical_parent_label text,
  raw_provider_category text,
  atinara_category text,
  category text,
  external_parent_url text check (external_parent_url is null or external_parent_url ~ '^https://'),
  horizon_at timestamptz,
  provider_declared_child_count integer check (
    provider_declared_child_count is null or provider_declared_child_count between 0 and 480
  ),
  provider_discovered_child_count integer not null check (provider_discovered_child_count between 0 and 480),
  provider_accounted_child_count integer not null check (provider_accounted_child_count between 0 and 480),
  provider_identified_child_count integer not null check (provider_identified_child_count between 0 and 480),
  provider_unresolved_child_count integer not null check (provider_unresolved_child_count between 0 and 480),
  provider_removed_child_count integer not null check (provider_removed_child_count between 0 and 1920),
  provider_closed_child_count integer not null check (provider_closed_child_count between 0 and 480),
  provider_duplicate_child_count integer not null check (provider_duplicate_child_count between 0 and 480),
  provider_conflict_child_count integer not null check (provider_conflict_child_count between 0 and 480),
  legacy_expected_child_count integer check (legacy_expected_child_count is null or legacy_expected_child_count between 0 and 1920),
  legacy_accounted_child_count integer check (legacy_accounted_child_count is null or legacy_accounted_child_count between 0 and 1920),
  new_child_count integer not null check (new_child_count between 0 and 480),
  provider_pagination_exhausted boolean not null,
  reconciliation_status text not null check (reconciliation_status in (
    'complete','incomplete_provider_metadata','inconsistent_provider_count',
    'refresh_required','provider_unavailable','historical_mapping_required',
    'terminal_provider_corruption'
  )),
  reconciliation_version text not null check (reconciliation_version='atinara-radar-parent-reconciliation-v1'),
  normalizer_version text not null check (normalizer_version='atinara-radar-v3'),
  family_version text not null check (family_version='atinara-market-family-v5'),
  reconciliation_fingerprint text not null check (reconciliation_fingerprint ~ '^[a-f0-9]{64}$'),
  checked_at timestamptz not null,
  next_retry_at timestamptz,
  source_refs jsonb not null check (jsonb_typeof(source_refs)='array' and jsonb_array_length(source_refs)<=24),
  payload_hash text not null check (payload_hash ~ '^[a-f0-9]{64}$'),
  issue_id uuid references private.market_workflow_issue_occurrences_v1(issue_id) on delete restrict,
  inserted_at timestamptz not null default clock_timestamp(),
  foreign key (request_id,provider,capability)
    references private.market_radar_refresh_intents_v1(request_id,provider,capability)
    on delete restrict,
  unique(request_id,provider,provider_parent_id),
  constraint market_radar_parent_reconciliation_counts_v1 check (
    provider_identified_child_count+provider_unresolved_child_count
      +provider_duplicate_child_count
      <= provider_accounted_child_count
    and provider_closed_child_count<=provider_accounted_child_count
    and provider_conflict_child_count<=provider_unresolved_child_count
    and (legacy_expected_child_count is null or legacy_accounted_child_count is not null)
  ),
  constraint market_radar_parent_reconciliation_complete_v1 check (
    reconciliation_status<>'complete' or (
      provider_pagination_exhausted
      and provider_declared_child_count is not null
      and provider_declared_child_count=provider_discovered_child_count
      and provider_declared_child_count=provider_accounted_child_count
      and provider_unresolved_child_count=0
      and provider_conflict_child_count=0
      and (legacy_expected_child_count is null
        or legacy_expected_child_count=legacy_accounted_child_count)
    )
  )
);

create index market_radar_parent_reconciliation_current_v1_idx
  on private.market_radar_parent_reconciliations_v1(provider,provider_parent_id,checked_at desc,inserted_at desc);
create index market_radar_parent_reconciliation_status_v1_idx
  on private.market_radar_parent_reconciliations_v1(reconciliation_status,checked_at desc);

create table private.market_radar_parent_children_v1 (
  id bigint generated always as identity primary key,
  parent_reconciliation_id uuid not null
    references private.market_radar_parent_reconciliations_v1(id) on delete restrict,
  child_occurrence_key text not null check (char_length(child_occurrence_key) between 1 and 500),
  provider_child_identity_key text check (
    provider_child_identity_key is null or char_length(provider_child_identity_key) between 1 and 500
  ),
  identity_kind text not null check (identity_kind in ('option','contract')),
  external_market_id text,
  condition_id text,
  token_ids jsonb not null default '[]'::jsonb check (jsonb_typeof(token_ids)='array' and jsonb_array_length(token_ids)<=20),
  child_slug text,
  event_id text,
  event_slug text,
  raw_provider_child_label text,
  canonical_child_label text,
  canonical_child_slug text,
  canonical_child_key text,
  identity_classification text not null check (identity_classification in (
    'identified_real_option','provider_placeholder_pending_resolution',
    'aggregate_other_option','tie_option','no_winner_option','provider_removed_child',
    'provider_closed_child','provider_duplicate_child','provider_data_conflict'
  )),
  identity_status text not null check (identity_status in (
    'resolved','unresolved_placeholder','conflict','duplicate','removed'
  )),
  availability_status text not null check (availability_status in (
    'open','closed','inactive','removed','unknown','unopened','paused'
  )),
  identity_source text,
  identity_confidence numeric(5,2) not null check (identity_confidence between 0 and 100),
  identity_evidence jsonb not null check (jsonb_typeof(identity_evidence)='array' and jsonb_array_length(identity_evidence)<=24),
  present_in_current_snapshot boolean not null,
  present_in_legacy_snapshot boolean not null,
  transition text not null check (transition in ('same','new','renamed','removed','moved_parent')),
  duplicate_of_child_identity_key text,
  provider_contract jsonb not null check (
    jsonb_typeof(provider_contract)='object' and pg_column_size(provider_contract)<=32768
  ),
  provider_contract_canonical_json text not null check (
    char_length(provider_contract_canonical_json) between 2 and 32768
  ),
  provider_contract_hash text not null check (provider_contract_hash ~ '^[a-f0-9]{64}$'),
  projection_version text not null check (projection_version='atinara-radar-child-projection-v1'),
  child_fingerprint text not null check (child_fingerprint ~ '^[a-f0-9]{64}$'),
  payload_hash text not null check (payload_hash ~ '^[a-f0-9]{64}$'),
  checked_at timestamptz not null,
  inserted_at timestamptz not null default clock_timestamp(),
  unique(parent_reconciliation_id,child_occurrence_key),
  constraint market_radar_parent_child_identity_v1 check (
    (identity_status='resolved' and provider_child_identity_key is not null and (
      (identity_kind='option' and canonical_child_label is not null
        and canonical_child_slug is not null
        and canonical_child_slug ~ '^[a-z0-9][a-z0-9-]{0,239}$'
        and canonical_child_key='option:'||canonical_child_slug)
      or (identity_kind='contract' and canonical_child_label is null
        and canonical_child_slug is null and canonical_child_key is null)
    ))
    or (identity_status<>'resolved')
  ),
  constraint market_radar_parent_child_classification_v1 check (
    (identity_classification in (
      'identified_real_option','aggregate_other_option','tie_option',
      'no_winner_option','provider_closed_child'
    ) and identity_status='resolved')
    or (identity_classification='provider_placeholder_pending_resolution'
      and identity_status='unresolved_placeholder')
    or (identity_classification='provider_data_conflict' and identity_status='conflict')
    or (identity_classification='provider_duplicate_child' and identity_status='duplicate')
    or (identity_classification='provider_removed_child' and identity_status='removed')
  ),
  constraint market_radar_parent_child_presence_v1 check (
    present_in_current_snapshot or present_in_legacy_snapshot
  )
);

create index market_radar_parent_child_external_v1_idx
  on private.market_radar_parent_children_v1(parent_reconciliation_id,external_market_id)
  where external_market_id is not null;
create index market_radar_parent_child_identity_v1_idx
  on private.market_radar_parent_children_v1(provider_child_identity_key,checked_at desc);

alter table private.external_market_candidates
  add column current_parent_reconciliation_id uuid
    references private.market_radar_parent_reconciliations_v1(id) on delete restrict,
  add column current_parent_child_id bigint
    references private.market_radar_parent_children_v1(id) on delete restrict;

create index external_market_candidates_parent_reconciliation_v1_idx
  on private.external_market_candidates(current_parent_reconciliation_id)
  where current_parent_reconciliation_id is not null;
create index external_market_candidates_parent_child_v1_idx
  on private.external_market_candidates(current_parent_child_id)
  where current_parent_child_id is not null;

alter table private.market_repair_workflow_checkpoints_v1
  add column radar_candidate_id uuid
    references private.external_market_candidates(id) on delete restrict,
  add column radar_candidate_fingerprint text,
  add column radar_candidate_preparation_revision bigint,
  add column provider_child_contract_hash text check (
    provider_child_contract_hash is null or provider_child_contract_hash~'^[a-f0-9]{64}$'
  ),
  add column parent_child_fingerprint text check (
    parent_child_fingerprint is null or parent_child_fingerprint~'^[a-f0-9]{64}$'
  ),
  add column temporal_decision_hash text check (
    temporal_decision_hash is null or temporal_decision_hash~'^[a-f0-9]{64}$'
  ),
  add column domain_fingerprint text check (
    domain_fingerprint is null or domain_fingerprint~'^[a-f0-9]{64}$'
  ),
  add column family_version text,
  add column family_key text,
  add column family_child_key text;

create or replace function private.capture_market_repair_checkpoint_radar_binding_v1()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  draft private.market_drafts%rowtype;
  candidate private.external_market_candidates%rowtype;
  candidate_id_value uuid;
begin
  select * into draft from private.market_drafts draft_alias where draft_alias.id=new.draft_id;
  if not found then raise exception 'DRAFT_NOT_FOUND' using errcode='P0001'; end if;
  begin
    candidate_id_value:=coalesce(draft.radar_candidate_id,
      case when draft.intelligence_origin_type='radar_candidate'
        and draft.intelligence_origin_id~'^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        then draft.intelligence_origin_id::uuid end
    );
  exception when invalid_text_representation then
    raise exception 'RADAR_DRAFT_SCOPE_MISMATCH' using errcode='40001';
  end;
  if candidate_id_value is null then return new; end if;
  select * into candidate from private.external_market_candidates candidate_alias
  where candidate_alias.id=candidate_id_value;
  if not found then raise exception 'RADAR_CANDIDATE_NOT_FOUND' using errcode='P0001'; end if;
  new.radar_candidate_id:=candidate.id;
  new.radar_candidate_fingerprint:=candidate.fingerprint;
  new.radar_candidate_preparation_revision:=candidate.preparation_revision;
  new.provider_child_contract_hash:=candidate.normalized_payload ->> 'provider_child_contract_hash';
  new.parent_child_fingerprint:=candidate.normalized_payload ->> 'parent_child_fingerprint';
  new.temporal_decision_hash:=candidate.normalized_payload #>> '{temporal_contract,decision_hash}';
  new.domain_fingerprint:=candidate.normalized_payload ->> 'domain_fingerprint';
  new.family_version:=candidate.family_version;
  new.family_key:=candidate.family_key;
  new.family_child_key:=candidate.family_child_key;
  if candidate.normalizer_version='atinara-radar-v3' and (
    coalesce(new.provider_child_contract_hash,'')!~'^[a-f0-9]{64}$'
    or coalesce(new.parent_child_fingerprint,'')!~'^[a-f0-9]{64}$'
    or new.family_version is distinct from 'atinara-market-family-v5'
    or nullif(new.family_key,'') is null or nullif(new.family_child_key,'') is null
  ) then raise exception 'RADAR_REPAIR_CHECKPOINT_BINDING_INVALID' using errcode='55000'; end if;
  return new;
end;
$function$;
alter function private.capture_market_repair_checkpoint_radar_binding_v1() owner to postgres;
revoke all on function private.capture_market_repair_checkpoint_radar_binding_v1()
  from public,anon,authenticated,service_role;
create trigger capture_market_repair_checkpoint_radar_binding_v1
before insert on private.market_repair_workflow_checkpoints_v1
for each row execute function private.capture_market_repair_checkpoint_radar_binding_v1();

create or replace function private.market_radar_material_repair_checkpoint_valid_v1(
  draft_input private.market_drafts,
  candidate_input private.external_market_candidates
)
returns boolean
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  checkpoint private.market_repair_workflow_checkpoints_v1%rowtype;
  baseline jsonb;
  current_payload jsonb:=private.market_draft_canonical_payload(draft_input);
  issue_state record;
  prior_contract jsonb;
  current_contract jsonb;
  material_issue_seen boolean:=false;
begin
  select checkpoint_alias.* into checkpoint
  from private.market_repair_workflow_checkpoints_v1 checkpoint_alias
  join private.market_repair_attempts attempt on attempt.id=checkpoint_alias.attempt_id
  where checkpoint_alias.draft_id=draft_input.id
    and checkpoint_alias.resulting_version=draft_input.content_version
    and checkpoint_alias.resulting_fingerprint=draft_input.content_fingerprint
    and checkpoint_alias.resulting_version>checkpoint_alias.expected_version
    and attempt.status='succeeded' and attempt.phase='complete'
    and checkpoint_alias.radar_candidate_id=candidate_input.id
    and checkpoint_alias.provider_child_contract_hash
      is not distinct from candidate_input.normalized_payload ->> 'provider_child_contract_hash'
    and checkpoint_alias.parent_child_fingerprint
      is not distinct from candidate_input.normalized_payload ->> 'parent_child_fingerprint'
    and checkpoint_alias.temporal_decision_hash
      is not distinct from candidate_input.normalized_payload #>> '{temporal_contract,decision_hash}'
    and checkpoint_alias.domain_fingerprint
      is not distinct from candidate_input.normalized_payload ->> 'domain_fingerprint'
    and row(checkpoint_alias.family_version,checkpoint_alias.family_key,
      checkpoint_alias.family_child_key) is not distinct from
      row(candidate_input.family_version,candidate_input.family_key,
        candidate_input.family_child_key)
  order by checkpoint_alias.repair_round desc limit 1;
  if checkpoint.attempt_id is not null then
    select version_alias.canonical_payload into baseline
    from private.market_draft_versions version_alias
    where version_alias.draft_id=checkpoint.draft_id
      and version_alias.content_version=checkpoint.expected_version;
  end if;
  if checkpoint.attempt_id is null or jsonb_typeof(baseline)<>'object'
     or row(draft_input.family_version,draft_input.family_key,draft_input.family_child_key)
       is distinct from row(candidate_input.family_version,candidate_input.family_key,
         candidate_input.family_child_key) then
    return false;
  end if;

  for issue_state in
    select distinct occurrence.issue_id,occurrence.issue_code,occurrence.current_value
    from private.market_workflow_issue_occurrences_v1 occurrence
    join private.market_workflow_issue_subject_links_v1 link
      on link.issue_id=occurrence.issue_id
    left join lateral (
      select event.new_status from private.market_workflow_issue_events_v1 event
      where event.issue_id=occurrence.issue_id
      order by event.occurred_at desc,event.id desc limit 1
    ) latest on true
    where link.subject_type='market_draft' and link.subject_key=draft_input.id::text
      and link.subject_version=draft_input.content_version::text
      and occurrence.issue_code in (
        'CHILD_IDENTITY_MISMATCH','PROVIDER_CHILD_CONTRACT_CHANGED',
        'CANONICAL_CHILD_PROJECTION_INVALID'
      ) and coalesce(latest.new_status,occurrence.status) not in ('resolved','superseded')
  loop
    material_issue_seen:=true;
    if not exists (
      select 1 from jsonb_array_elements_text(checkpoint.workflow_issue_ids) issue_id(value)
      where issue_id.value=issue_state.issue_id::text
    ) then return false; end if;
    if issue_state.issue_code<>'PROVIDER_CHILD_CONTRACT_CHANGED' then continue; end if;
    prior_contract:=issue_state.current_value #> '{provider_child,prior_provider_contract}';
    current_contract:=issue_state.current_value #> '{provider_child,provider_contract}';
    if jsonb_typeof(prior_contract)<>'object' or jsonb_typeof(current_contract)<>'object' then
      return false;
    end if;
    if prior_contract -> 'source_question' is distinct from current_contract -> 'source_question'
       and baseline ->> 'question' is not distinct from current_payload ->> 'question' then
      return false;
    end if;
    if prior_contract -> 'source_description' is distinct from current_contract -> 'source_description'
       and baseline ->> 'description' is not distinct from current_payload ->> 'description' then
      return false;
    end if;
    if prior_contract -> 'source_resolution_rules'
         is distinct from current_contract -> 'source_resolution_rules'
       and row(baseline ->> 'yes_criteria',baseline ->> 'no_criteria',
         baseline ->> 'edge_cases',baseline ->> 'public_criteria')
         is not distinct from row(current_payload ->> 'yes_criteria',
           current_payload ->> 'no_criteria',current_payload ->> 'edge_cases',
           current_payload ->> 'public_criteria') then
      return false;
    end if;
    if prior_contract -> 'source_resolution_url'
         is distinct from current_contract -> 'source_resolution_url'
       and (
         baseline #>> '{primary_source,url}' is not distinct from
           current_payload #>> '{primary_source,url}'
         or current_payload #>> '{primary_source,url}' is distinct from
           candidate_input.normalized_payload ->> 'atinara_resolution_source_url'
       ) then return false; end if;
    if prior_contract -> 'source_close_at' is distinct from current_contract -> 'source_close_at'
       or prior_contract -> 'source_resolution_deadline'
         is distinct from current_contract -> 'source_resolution_deadline' then
      begin
        if draft_input.evaluation_ends_at is distinct from
             nullif(candidate_input.normalized_payload #>>
               '{temporal_contract,evaluation_ends_at}','')::timestamptz
           or draft_input.closes_at is distinct from
             nullif(candidate_input.normalized_payload #>>
               '{temporal_contract,forecast_closes_at}','')::timestamptz
           or draft_input.resolution_deadline is distinct from
             nullif(candidate_input.normalized_payload #>>
               '{temporal_contract,resolution_deadline}','')::timestamptz
           or draft_input.timezone is distinct from
             nullif(candidate_input.normalized_payload #>>'{temporal_contract,timezone}','') then
          return false;
        end if;
      exception when invalid_text_representation or datetime_field_overflow then
        return false;
      end;
    end if;
  end loop;
  return material_issue_seen;
end;
$function$;
alter function private.market_radar_material_repair_checkpoint_valid_v1(
  private.market_drafts,private.external_market_candidates
) owner to postgres;
revoke all on function private.market_radar_material_repair_checkpoint_valid_v1(
  private.market_drafts,private.external_market_candidates
) from public,anon,authenticated,service_role;

alter table private.market_radar_parent_reconciliations_v1 enable row level security;
alter table private.market_radar_parent_reconciliations_v1 force row level security;
alter table private.market_radar_parent_children_v1 enable row level security;
alter table private.market_radar_parent_children_v1 force row level security;

revoke all on table private.market_radar_parent_reconciliations_v1,
  private.market_radar_parent_children_v1 from public,anon,authenticated,service_role;
revoke all on sequence private.market_radar_parent_children_v1_id_seq
  from public,anon,authenticated,service_role;

create or replace function private.reject_market_radar_reconciliation_mutation_v1()
returns trigger language plpgsql security definer set search_path to ''
as $function$
begin
  raise exception 'RADAR_PARENT_RECONCILIATION_APPEND_ONLY' using errcode='55000';
end;
$function$;
revoke all on function private.reject_market_radar_reconciliation_mutation_v1()
  from public,anon,authenticated,service_role;

create trigger market_radar_parent_reconciliation_append_only_v1
before update or delete on private.market_radar_parent_reconciliations_v1
for each row execute function private.reject_market_radar_reconciliation_mutation_v1();
create trigger market_radar_parent_children_append_only_v1
before update or delete on private.market_radar_parent_children_v1
for each row execute function private.reject_market_radar_reconciliation_mutation_v1();

create or replace function public.record_market_radar_provider_selection_v1(
  request_id_input uuid,
  provider_input text,
  capability_input text,
  lease_token_input uuid,
  selection_input jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  intent private.market_radar_refresh_intents_v1%rowtype;
  total_parent_count_value integer;
  selected_parent_count_value integer;
  deferred_parent_count_value integer;
  selected_child_count_value integer;
  selected_ids_count integer;
  deferred_ids_count integer;
begin
  if auth.role()<>'service_role' then
    raise exception 'SERVICE_ROLE_REQUIRED' using errcode='42501';
  end if;
  intent:=private.assert_market_radar_refresh_lease_v1(
    request_id_input,provider_input,capability_input,lease_token_input
  );
  if capability_input<>'candidate_feed' or jsonb_typeof(selection_input)<>'object'
     or selection_input ->> 'policy_version' is distinct from 'atinara-radar-parent-selection-v1'
     or coalesce((selection_input ->> 'no_parent_truncated')::boolean,false) is not true
     or octet_length(selection_input::text)>131072
     or jsonb_typeof(coalesce(selection_input -> 'selected_parent_ids','[]'::jsonb))<>'array'
     or jsonb_typeof(coalesce(selection_input -> 'deferred_parent_ids','[]'::jsonb))<>'array'
     or jsonb_array_length(coalesce(selection_input -> 'selected_parent_ids','[]'::jsonb))>120
     or jsonb_array_length(coalesce(selection_input -> 'deferred_parent_ids','[]'::jsonb))>240
     or coalesce(selection_input ->> 'total_parent_count','')!~ '^\d+$'
     or coalesce(selection_input ->> 'selected_parent_count','')!~ '^\d+$'
     or coalesce(selection_input ->> 'deferred_parent_count','')!~ '^\d+$'
     or coalesce(selection_input ->> 'selected_child_count','')!~ '^\d+$' then
    raise exception 'RADAR_PROVIDER_SELECTION_INVALID' using errcode='22023';
  end if;
  total_parent_count_value:=(selection_input ->> 'total_parent_count')::integer;
  selected_parent_count_value:=(selection_input ->> 'selected_parent_count')::integer;
  deferred_parent_count_value:=(selection_input ->> 'deferred_parent_count')::integer;
  selected_child_count_value:=(selection_input ->> 'selected_child_count')::integer;
  selected_ids_count:=jsonb_array_length(selection_input -> 'selected_parent_ids');
  deferred_ids_count:=jsonb_array_length(selection_input -> 'deferred_parent_ids');
  if total_parent_count_value not between 0 and 240
     or selected_parent_count_value not between 0 and 120
     or deferred_parent_count_value not between 0 and 240
     or selected_child_count_value not between 0 and 480
     or selected_parent_count_value+deferred_parent_count_value<>total_parent_count_value
     or selected_ids_count<>selected_parent_count_value
     or deferred_ids_count<>deferred_parent_count_value
     or exists (
       select 1 from jsonb_array_elements(
         (selection_input -> 'selected_parent_ids')||(selection_input -> 'deferred_parent_ids')
       ) item
       where jsonb_typeof(item)<>'string'
         or nullif(btrim(item #>> '{}'),'') is null
         or char_length(item #>> '{}')>220
     )
     or selected_ids_count+deferred_ids_count<>(
       select count(distinct item #>> '{}')
       from jsonb_array_elements(
         (selection_input -> 'selected_parent_ids')||(selection_input -> 'deferred_parent_ids')
       ) item
     ) then
    raise exception 'RADAR_PROVIDER_SELECTION_INVALID' using errcode='22023';
  end if;
  if intent.provider_selection is not null and intent.provider_selection is distinct from selection_input then
    raise exception 'RADAR_PROVIDER_SELECTION_IDEMPOTENCY_CONFLICT' using errcode='40001';
  end if;
  update private.market_radar_refresh_intents_v1 set
    provider_selection=coalesce(provider_selection,selection_input),updated_at=clock_timestamp()
  where request_id=request_id_input and provider=provider_input and capability=capability_input
  returning * into intent;
  return jsonb_build_object('ok',true,'provider_selection',intent.provider_selection);
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception 'RADAR_PROVIDER_SELECTION_INVALID' using errcode='22003';
end;
$function$;
alter function public.record_market_radar_provider_selection_v1(uuid,text,text,uuid,jsonb)
  owner to postgres;
revoke all on function public.record_market_radar_provider_selection_v1(uuid,text,text,uuid,jsonb)
  from public,anon,authenticated,service_role;
grant execute on function public.record_market_radar_provider_selection_v1(uuid,text,text,uuid,jsonb)
  to service_role;

create or replace function private.market_radar_reconciliation_payload_hash_v1(
  payload_input jsonb,
  payload_kind_input text
)
returns text
language plpgsql
immutable
set search_path to ''
as $function$
declare
  material jsonb;
  items jsonb;
begin
  if jsonb_typeof(payload_input)<>'object'
     or payload_kind_input not in ('parent','child') then
    raise exception 'RADAR_RECONCILIATION_PAYLOAD_INVALID' using errcode='22023';
  end if;
  material:=payload_input-'checked_at'-'next_retry_at'-'payload_hash';
  if jsonb_typeof(material -> 'identity_evidence')='array' then
    select coalesce(jsonb_agg(
      evidence.value-'checked_at'-'content_sha256' order by evidence.ordinality
    ),'[]'::jsonb) into items
    from jsonb_array_elements(material -> 'identity_evidence')
      with ordinality evidence(value,ordinality);
    material:=jsonb_set(material,'{identity_evidence}',items,true);
  end if;
  if jsonb_typeof(material -> 'source_refs')='array' then
    select coalesce(jsonb_agg(
      source_ref.value-'checked_at'-'content_sha256' order by source_ref.ordinality
    ),'[]'::jsonb) into items
    from jsonb_array_elements(material -> 'source_refs')
      with ordinality source_ref(value,ordinality);
    material:=jsonb_set(material,'{source_refs}',items,true);
  end if;
  if jsonb_typeof(material -> 'issue')='object' then
    material:=jsonb_set(material,'{issue}',
      (material -> 'issue')-'issue_id'-'created_at'-'updated_at'-'resolved_at'
        -'status'-'resolution_method',true);
  end if;
  if payload_kind_input='parent' and jsonb_typeof(material -> 'children')='array' then
    select coalesce(jsonb_agg(
      (child.value-'checked_at'-'identity_evidence'-'provider_contract_canonical_json')
      ||jsonb_build_object(
        '_semantic_payload_hash',private.market_radar_reconciliation_payload_hash_v1(
          child.value,'child'
        )
      )
      order by child.ordinality
    ),'[]'::jsonb) into items
    from jsonb_array_elements(material -> 'children')
      with ordinality child(value,ordinality);
    material:=jsonb_set(material,'{children}',items,true);
  end if;
  return encode(extensions.digest(convert_to(
    private.market_workflow_canonical_json_v1(material),'UTF8'
  ),'sha256'),'hex');
end;
$function$;
alter function private.market_radar_reconciliation_payload_hash_v1(jsonb,text)
  owner to postgres;
revoke all on function private.market_radar_reconciliation_payload_hash_v1(jsonb,text)
  from public,anon,authenticated,service_role;

create or replace function private.market_radar_child_matches_legacy_v1(
  baseline_input jsonb,
  child_input jsonb,
  provider_input text
)
returns boolean
language plpgsql
immutable
set search_path to ''
as $function$
declare
  baseline_occurrence text:=nullif(baseline_input ->> 'child_occurrence_key','');
  baseline_market text:=nullif(baseline_input ->> 'external_market_id','');
  baseline_condition text:=nullif(baseline_input ->> 'condition_id','');
  baseline_slug text:=nullif(baseline_input ->> 'child_slug','');
  baseline_tokens jsonb:=case when jsonb_typeof(baseline_input -> 'token_ids')='array'
    then baseline_input -> 'token_ids' else '[]'::jsonb end;
  child_tokens jsonb:=case when jsonb_typeof(child_input -> 'token_ids')='array'
    then child_input -> 'token_ids' else '[]'::jsonb end;
begin
  if provider_input not in ('polymarket','kalshi')
     or jsonb_typeof(baseline_input)<>'object' or jsonb_typeof(child_input)<>'object' then
    return false;
  end if;
  if baseline_occurrence is not null and baseline_occurrence not like 'legacy:%' then
    return child_input ->> 'child_occurrence_key'=baseline_occurrence;
  end if;
  if baseline_market is not null then
    return child_input ->> 'external_market_id'=baseline_market;
  end if;
  if baseline_condition is not null then
    return child_input ->> 'condition_id'=baseline_condition;
  end if;
  if jsonb_array_length(baseline_tokens)>0 then
    return exists (
      select 1 from jsonb_array_elements_text(baseline_tokens) baseline_token(value)
      join jsonb_array_elements_text(child_tokens) child_token(value) using(value)
    );
  end if;
  return baseline_slug is not null and child_input ->> 'child_slug'=baseline_slug;
end;
$function$;
alter function private.market_radar_child_matches_legacy_v1(jsonb,jsonb,text)
  owner to postgres;
revoke all on function private.market_radar_child_matches_legacy_v1(jsonb,jsonb,text)
  from public,anon,authenticated,service_role;

create or replace function public.record_market_radar_parent_reconciliations_v1(
  request_id_input uuid,
  provider_input text,
  capability_input text,
  lease_token_input uuid,
  reconciliations_input jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  intent private.market_radar_refresh_intents_v1%rowtype;
  reconciliation jsonb;
  child jsonb;
  parent_row private.market_radar_parent_reconciliations_v1%rowtype;
  issue_id_value uuid;
  current_count integer;
  identified_count integer;
  unresolved_count integer;
  removed_count integer;
  closed_count integer;
  duplicate_count integer;
  conflict_count integer;
  new_count integer;
  status_value text;
  declared_count integer;
  legacy_expected_value integer;
  legacy_accounted_value integer;
  legacy_accounted_count integer;
  legacy_persisted_expected_value integer;
  legacy_persisted_accounted_value integer;
  legacy_count integer;
  legacy_candidate_count integer;
  legacy_ledger_count integer;
  prior_parent_id_value uuid;
  known_legacy_count integer;
  manifest_hash_value text;
  parent_count_value integer;
  incomplete_count_value integer;
  selected_child_count_value integer;
  persisted_child_count integer;
  identity_confidence_value numeric;
  checked_at_value timestamptz;
  next_retry_at_value timestamptz;
  child_checked_at_value timestamptz;
  expected_provider_identity_key text;
  output_items jsonb:='[]'::jsonb;
  prior_issue record;
begin
  if auth.role()<>'service_role' then
    raise exception 'SERVICE_ROLE_REQUIRED' using errcode='42501';
  end if;
  intent:=private.assert_market_radar_refresh_lease_v1(
    request_id_input,provider_input,capability_input,lease_token_input
  );
  if capability_input<>'candidate_feed' or provider_input not in ('polymarket','kalshi')
     or jsonb_typeof(reconciliations_input)<>'array'
     or jsonb_array_length(reconciliations_input) not between 0 and 120
     or octet_length(reconciliations_input::text)>5242880 then
    raise exception 'RADAR_PARENT_RECONCILIATION_INVALID' using errcode='22023';
  end if;

  for reconciliation in select value from jsonb_array_elements(reconciliations_input)
  loop
    if jsonb_typeof(reconciliation)<>'object'
       or reconciliation ->> 'provider' is distinct from provider_input
       or nullif(reconciliation ->> 'provider_parent_id','') is null
       or char_length(reconciliation ->> 'provider_parent_id')>220
       or reconciliation ->> 'reconciliation_version' is distinct from 'atinara-radar-parent-reconciliation-v1'
       or reconciliation ->> 'normalizer_version' is distinct from 'atinara-radar-v3'
       or reconciliation ->> 'family_version' is distinct from 'atinara-market-family-v5'
       or coalesce(reconciliation ->> 'reconciliation_fingerprint','') !~ '^[a-f0-9]{64}$'
       or reconciliation ->> 'reconciliation_status' not in (
         'complete','incomplete_provider_metadata','inconsistent_provider_count',
         'refresh_required','provider_unavailable','historical_mapping_required',
         'terminal_provider_corruption'
       )
       or jsonb_typeof(coalesce(reconciliation -> 'children','[]'::jsonb))<>'array'
       -- El total actual sigue limitado a 480; el ledger combinado puede
       -- conservar hasta 1.920 tombstones históricos sin truncarlos.
       or jsonb_array_length(coalesce(reconciliation -> 'children','[]'::jsonb))>1920
       or jsonb_typeof(coalesce(reconciliation -> 'source_refs','[]'::jsonb))<>'array'
       or jsonb_array_length(coalesce(reconciliation -> 'source_refs','[]'::jsonb))>24
       or jsonb_array_length(coalesce(reconciliation -> 'source_refs','[]'::jsonb))=0
       or (reconciliation ->> 'reconciliation_status' in (
         'incomplete_provider_metadata','inconsistent_provider_count','refresh_required',
         'provider_unavailable','historical_mapping_required'
       ) and nullif(reconciliation ->> 'next_retry_at','') is null)
       or (reconciliation ->> 'reconciliation_status' in (
         'complete','terminal_provider_corruption'
       ) and nullif(reconciliation ->> 'next_retry_at','') is not null)
       or (reconciliation ->> 'reconciliation_status'='complete' and not exists (
         select 1 from jsonb_array_elements(reconciliation -> 'source_refs') source_ref
         where source_ref ->> 'url' ~ '^https://'
           and coalesce(source_ref ->> 'identity_sha256',source_ref ->> 'content_sha256')
             ~ '^[a-f0-9]{64}$'
           and source_ref ->> 'result' in (
             'parent_children_enumerated','current_child_page_enumerated',
             'historical_child_page_enumerated'
           )
       )) then
      raise exception 'RADAR_PARENT_RECONCILIATION_INVALID' using errcode='22023';
    end if;
    begin
      checked_at_value:=(reconciliation ->> 'checked_at')::timestamptz;
      next_retry_at_value:=nullif(reconciliation ->> 'next_retry_at','')::timestamptz;
    exception when invalid_text_representation or datetime_field_overflow then
      raise exception 'RADAR_PARENT_RECONCILIATION_TIME_INVALID' using errcode='22007';
    end;
    if checked_at_value is null
       or checked_at_value<intent.created_at-interval '5 minutes'
       or checked_at_value>clock_timestamp()+interval '5 minutes'
       or (next_retry_at_value is not null and next_retry_at_value<=checked_at_value) then
      raise exception 'RADAR_PARENT_RECONCILIATION_TIME_INVALID' using errcode='22007';
    end if;
    begin
      declared_count:=nullif(reconciliation ->> 'provider_declared_child_count','')::integer;
    exception when invalid_text_representation or numeric_value_out_of_range then
      raise exception 'RADAR_PARENT_RECONCILIATION_COUNT_INVALID' using errcode='22003';
    end;
    if declared_count is not null and declared_count not between 0 and 480 then
      raise exception 'RADAR_PARENT_RECONCILIATION_COUNT_INVALID' using errcode='22003';
    end if;
    if exists (
      select 1
      from jsonb_array_elements(reconciliation -> 'children') item
      group by item ->> 'child_occurrence_key'
      having count(*)>1
    ) then
      raise exception 'RADAR_PARENT_CHILD_OCCURRENCE_DUPLICATE' using errcode='23505';
    end if;
    if exists (
      select 1 from jsonb_array_elements(reconciliation -> 'children') item
      where (item ->> 'identity_classification'='provider_duplicate_child' and not exists (
        select 1 from jsonb_array_elements(reconciliation -> 'children') anchor
        where anchor ->> 'child_occurrence_key'<>item ->> 'child_occurrence_key'
          and anchor ->> 'provider_child_identity_key'
            =item ->> 'duplicate_of_child_identity_key'
          and anchor ->> 'identity_classification'<>'provider_duplicate_child'
      )) or (item ->> 'identity_classification'<>'provider_duplicate_child'
        and nullif(item ->> 'duplicate_of_child_identity_key','') is not null)
    ) then
      raise exception 'RADAR_PARENT_CHILD_DUPLICATE_REFERENCE_INVALID' using errcode='23514';
    end if;
    if exists (
      select 1 from jsonb_array_elements(reconciliation -> 'children') item
      where nullif(item ->> 'provider_child_identity_key','') is not null
      group by item ->> 'provider_child_identity_key'
      having count(*)>1
        and count(*) filter(where item ->> 'identity_classification'='provider_data_conflict')=0
        and count(*) filter(where item ->> 'identity_classification'='provider_duplicate_child')
          <>count(*)-1
    ) then
      raise exception 'RADAR_PARENT_CHILD_DUPLICATE_CLASSIFICATION_INVALID' using errcode='23514';
    end if;
    if exists (
      select 1
      from jsonb_array_elements(reconciliation -> 'children') with ordinality left_child(item,ordinality)
      join jsonb_array_elements(reconciliation -> 'children') with ordinality right_child(item,ordinality)
        on left_child.ordinality<right_child.ordinality
      where (
        (nullif(left_child.item ->> 'external_market_id','') is not null
          and left_child.item ->> 'external_market_id'=right_child.item ->> 'external_market_id')
        or (nullif(left_child.item ->> 'condition_id','') is not null
          and left_child.item ->> 'condition_id'=right_child.item ->> 'condition_id')
        or exists (
          select 1 from jsonb_array_elements_text(case
            when jsonb_typeof(left_child.item -> 'token_ids')='array'
              then left_child.item -> 'token_ids' else '[]'::jsonb end) left_token(value)
          join jsonb_array_elements_text(case
            when jsonb_typeof(right_child.item -> 'token_ids')='array'
              then right_child.item -> 'token_ids' else '[]'::jsonb end) right_token(value)
            using(value)
        )
      ) and left_child.item ->> 'identity_classification' not in (
        'provider_duplicate_child','provider_data_conflict'
      ) and right_child.item ->> 'identity_classification' not in (
        'provider_duplicate_child','provider_data_conflict'
      )
    ) then
      raise exception 'RADAR_PARENT_CHILD_STABLE_IDENTITY_REPEATED' using errcode='23514';
    end if;
    begin
      legacy_expected_value:=nullif(
        reconciliation ->> 'legacy_expected_child_count',''
      )::integer;
      legacy_accounted_value:=nullif(
        reconciliation ->> 'legacy_accounted_child_count',''
      )::integer;
    exception when invalid_text_representation or numeric_value_out_of_range then
      raise exception 'RADAR_PARENT_RECONCILIATION_COUNT_INVALID' using errcode='22003';
    end;
    if (legacy_expected_value is not null and legacy_expected_value not between 0 and 1920)
       or (legacy_accounted_value is not null and legacy_accounted_value not between 0 and 1920)
       or (legacy_expected_value is null and legacy_accounted_value is not null)
       or (legacy_expected_value is not null and (
         legacy_accounted_value is null or legacy_accounted_value>legacy_expected_value
       )) then
      raise exception 'RADAR_PARENT_RECONCILIATION_COUNT_INVALID' using errcode='22003';
    end if;

    select
      count(*) filter(where coalesce((value ->> 'present_in_current_snapshot')::boolean,false)),
      count(*) filter(where coalesce((value ->> 'present_in_current_snapshot')::boolean,false)
        and value ->> 'identity_status'='resolved'),
      count(*) filter(where coalesce((value ->> 'present_in_current_snapshot')::boolean,false)
        and value ->> 'identity_status' in ('unresolved_placeholder','conflict')),
      count(*) filter(where value ->> 'identity_classification'='provider_removed_child'),
      count(*) filter(where coalesce((value ->> 'present_in_current_snapshot')::boolean,false)
        and value ->> 'availability_status'='closed'),
      count(*) filter(where coalesce((value ->> 'present_in_current_snapshot')::boolean,false)
        and value ->> 'identity_classification'='provider_duplicate_child'),
      count(*) filter(where coalesce((value ->> 'present_in_current_snapshot')::boolean,false)
        and value ->> 'identity_classification'='provider_data_conflict'),
      count(*) filter(where coalesce((value ->> 'present_in_current_snapshot')::boolean,false)
        and value ->> 'transition'='new'),
      count(*) filter(where coalesce((value ->> 'present_in_legacy_snapshot')::boolean,false)),
      count(*) filter(where coalesce((value ->> 'present_in_legacy_snapshot')::boolean,false)
        and (
          coalesce((value ->> 'present_in_current_snapshot')::boolean,false)
          or (value ->> 'identity_classification'='provider_removed_child'
            and exists(select 1 from jsonb_array_elements(case
              when jsonb_typeof(value -> 'identity_evidence')='array'
                then value -> 'identity_evidence' else '[]'::jsonb end) evidence
              where evidence ->> 'result'='provider_removed_child'))
          or (value ->> 'identity_classification'='provider_closed_child'
            and exists(select 1 from jsonb_array_elements(case
              when jsonb_typeof(value -> 'identity_evidence')='array'
                then value -> 'identity_evidence' else '[]'::jsonb end) evidence
              where evidence ->> 'result'='provider_closed_child'))
        ))
    into current_count,identified_count,unresolved_count,removed_count,closed_count,
      duplicate_count,conflict_count,new_count,legacy_count,legacy_accounted_count
    from jsonb_array_elements(reconciliation -> 'children');

    select count(*)::integer into legacy_candidate_count
    from private.external_market_candidates legacy_candidate
    where legacy_candidate.provider=provider_input
      and legacy_candidate.external_event_id=reconciliation ->> 'provider_parent_id'
      and legacy_candidate.normalizer_version<>'atinara-radar-v3';
    select prior_parent.id into prior_parent_id_value
    from private.market_radar_parent_reconciliations_v1 prior_parent
    join private.market_radar_refresh_intents_v1 prior_intent
      on prior_intent.request_id=prior_parent.request_id
     and prior_intent.provider=prior_parent.provider
     and prior_intent.capability=prior_parent.capability
    where prior_parent.provider=provider_input
      and prior_parent.provider_parent_id=reconciliation ->> 'provider_parent_id'
      and prior_parent.request_id<>request_id_input
      and prior_intent.status in ('completed','partial')
    order by prior_parent.checked_at desc,prior_parent.inserted_at desc
    limit 1;
    select count(*)::integer into legacy_ledger_count
    from private.market_radar_parent_children_v1 legacy_child
    where legacy_child.parent_reconciliation_id=prior_parent_id_value;
    known_legacy_count:=greatest(
      coalesce(legacy_candidate_count,0),coalesce(legacy_ledger_count,0)
    );
    if exists (
      select 1 from private.external_market_candidates baseline
      where baseline.provider=provider_input
        and baseline.external_event_id=reconciliation ->> 'provider_parent_id'
        and baseline.normalizer_version<>'atinara-radar-v3'
        and not exists (
          select 1 from jsonb_array_elements(reconciliation -> 'children') child
          where coalesce((child ->> 'present_in_legacy_snapshot')::boolean,false)
            and private.market_radar_child_matches_legacy_v1(jsonb_build_object(
              'external_market_id',coalesce(
                nullif(baseline.normalized_payload ->> 'external_market_id',''),baseline.external_id
              ),
              'condition_id',nullif(baseline.normalized_payload #>> '{provider_payload,condition_id}',''),
              'token_ids',case
                when jsonb_typeof(baseline.normalized_payload #> '{provider_payload,token_ids}')='array'
                  then baseline.normalized_payload #> '{provider_payload,token_ids}'
                else '[]'::jsonb end,
              'child_slug',nullif(baseline.normalized_payload ->> 'external_market_slug','')
            ),child,provider_input)
        )
    ) or exists (
      select 1 from private.market_radar_parent_children_v1 baseline
      where baseline.parent_reconciliation_id=prior_parent_id_value and not exists (
        select 1 from jsonb_array_elements(reconciliation -> 'children') child
        where coalesce((child ->> 'present_in_legacy_snapshot')::boolean,false)
          and private.market_radar_child_matches_legacy_v1(
            to_jsonb(baseline),child,provider_input
          )
      )
    ) then
      raise exception 'RADAR_PARENT_LEGACY_IDENTITY_COVERAGE_MISMATCH' using errcode='22023';
    end if;
    if exists (
      select 1 from jsonb_array_elements(reconciliation -> 'children') child
      where coalesce((child ->> 'present_in_legacy_snapshot')::boolean,false)
        and (
          (prior_parent_id_value is not null and (
            select count(*) from private.market_radar_parent_children_v1 baseline
            where baseline.parent_reconciliation_id=prior_parent_id_value
              and private.market_radar_child_matches_legacy_v1(
                to_jsonb(baseline),child,provider_input
              )
          )<>1)
          or (prior_parent_id_value is null and (
            select count(*) from private.external_market_candidates baseline
            where baseline.provider=provider_input
              and baseline.external_event_id=reconciliation ->> 'provider_parent_id'
              and baseline.normalizer_version<>'atinara-radar-v3'
              and private.market_radar_child_matches_legacy_v1(jsonb_build_object(
                'external_market_id',coalesce(
                  nullif(baseline.normalized_payload ->> 'external_market_id',''),baseline.external_id
                ),
                'condition_id',nullif(baseline.normalized_payload #>> '{provider_payload,condition_id}',''),
                'token_ids',case
                  when jsonb_typeof(baseline.normalized_payload #> '{provider_payload,token_ids}')='array'
                    then baseline.normalized_payload #> '{provider_payload,token_ids}'
                  else '[]'::jsonb end,
                'child_slug',nullif(baseline.normalized_payload ->> 'external_market_slug','')
              ),child,provider_input)
          )<>1)
        )
    ) then
      raise exception 'RADAR_PARENT_LEGACY_IDENTITY_BIJECTION_MISMATCH' using errcode='22023';
    end if;

    if current_count is distinct from (reconciliation ->> 'provider_discovered_child_count')::integer
       or current_count is distinct from (reconciliation ->> 'provider_accounted_child_count')::integer
       or identified_count is distinct from (reconciliation ->> 'provider_identified_child_count')::integer
       or unresolved_count is distinct from (reconciliation ->> 'provider_unresolved_child_count')::integer
       or removed_count is distinct from (reconciliation ->> 'provider_removed_child_count')::integer
       or closed_count is distinct from (reconciliation ->> 'provider_closed_child_count')::integer
       or duplicate_count is distinct from (reconciliation ->> 'provider_duplicate_child_count')::integer
       or conflict_count is distinct from (reconciliation ->> 'provider_conflict_child_count')::integer
       or new_count is distinct from (reconciliation ->> 'new_child_count')::integer
       or (legacy_expected_value is null and legacy_count<>0)
       -- Todas las filas legacy deben seguir presentes en el ledger. Estar
       -- observada no significa estar reconciliada: legacy_accounted puede ser
       -- menor mientras el estado sea historical_mapping_required.
       or (legacy_expected_value is not null and legacy_count is distinct from legacy_expected_value)
       or (legacy_expected_value is null and legacy_accounted_value is not null)
       or (legacy_expected_value is not null
         and legacy_accounted_value is distinct from legacy_accounted_count)
       or (known_legacy_count>0 and (
         legacy_expected_value is distinct from known_legacy_count
         or legacy_count is distinct from known_legacy_count
       )) then
      raise exception 'RADAR_PARENT_RECONCILIATION_COUNT_MISMATCH' using errcode='22023';
    end if;
    status_value:=reconciliation ->> 'reconciliation_status';
    if status_value='complete' and (
      coalesce((reconciliation ->> 'provider_pagination_exhausted')::boolean,false) is not true
      or declared_count is null or declared_count<>current_count
      or unresolved_count<>0 or conflict_count<>0
      or (legacy_expected_value is not null
        and legacy_accounted_count<>legacy_expected_value)
    ) then
      raise exception 'RADAR_PARENT_RECONCILIATION_FALSE_COMPLETE' using errcode='23514';
    end if;

    for child in select value from jsonb_array_elements(reconciliation -> 'children')
    loop
      begin
        identity_confidence_value:=nullif(child ->> 'identity_confidence','')::numeric;
        child_checked_at_value:=(child ->> 'checked_at')::timestamptz;
      exception when invalid_text_representation or numeric_value_out_of_range
          or datetime_field_overflow then
        raise exception 'RADAR_PARENT_CHILD_CONFIDENCE_INVALID' using errcode='22003';
      end;
      expected_provider_identity_key:=null;
      if nullif(child ->> 'external_market_id','') is not null then
        expected_provider_identity_key:=provider_input||':market:'||(child ->> 'external_market_id');
      elsif nullif(child ->> 'condition_id','') is not null then
        expected_provider_identity_key:=provider_input||':condition:'||(child ->> 'condition_id');
      elsif jsonb_array_length(coalesce(child -> 'token_ids','[]'::jsonb))>0 then
        expected_provider_identity_key:=provider_input||':token:'||(child -> 'token_ids' ->> 0);
      elsif nullif(child ->> 'child_slug','') is not null then
        expected_provider_identity_key:=provider_input||':slug:'||(child ->> 'child_slug');
      end if;
      if jsonb_typeof(child)<>'object'
         or nullif(child ->> 'child_occurrence_key','') is null
         or char_length(child ->> 'child_occurrence_key')>500
         or char_length(coalesce(child ->> 'provider_child_identity_key',''))>500
         or child ->> 'identity_kind' not in ('option','contract')
         or (nullif(child ->> 'provider_child_identity_key','') is null
           and child ->> 'identity_status'<>'conflict')
         or child ->> 'identity_classification' not in (
           'identified_real_option','provider_placeholder_pending_resolution',
           'aggregate_other_option','tie_option','no_winner_option','provider_removed_child',
           'provider_closed_child','provider_duplicate_child','provider_data_conflict'
         )
         or child ->> 'identity_status' not in (
           'resolved','unresolved_placeholder','conflict','duplicate','removed'
         )
         or child ->> 'transition' not in ('same','new','renamed','removed','moved_parent')
         or child ->> 'availability_status' not in (
           'open','closed','inactive','removed','unknown','unopened','paused'
         )
         or child ->> 'projection_version' is distinct from 'atinara-radar-child-projection-v1'
         or identity_confidence_value is null or identity_confidence_value not between 0 and 100
         or child_checked_at_value is distinct from checked_at_value
         or (child ->> 'identity_status' in ('resolved','duplicate','removed') and (
           nullif(child ->> 'identity_source','') is null or identity_confidence_value<>100
         ))
         or (child ->> 'identity_status'='unresolved_placeholder'
           and identity_confidence_value<>0)
         or coalesce(child ->> 'child_fingerprint','') !~ '^[a-f0-9]{64}$'
         or jsonb_typeof(child -> 'provider_contract') is distinct from 'object'
         or pg_column_size(child -> 'provider_contract')>32768
         or char_length(coalesce(child ->> 'provider_contract_canonical_json','')) not between 2 and 32768
         or child #>> '{provider_contract,contract_version}'
           is distinct from 'atinara-radar-provider-child-contract-v1'
         or child #>> '{provider_contract,provider}' is distinct from provider_input
         or child #>> '{provider_contract,provider_parent_id}'
           is distinct from reconciliation ->> 'provider_parent_id'
         or child #>> '{provider_contract,external_market_id}'
           is distinct from nullif(child ->> 'external_market_id','')
         or child #>> '{provider_contract,condition_id}'
           is distinct from nullif(child ->> 'condition_id','')
         or coalesce(child #> '{provider_contract,token_ids}','[]'::jsonb)
           is distinct from coalesce(child -> 'token_ids','[]'::jsonb)
         or child #>> '{provider_contract,child_slug}'
           is distinct from nullif(child ->> 'child_slug','')
         or child #>> '{provider_contract,event_slug}'
           is distinct from nullif(child ->> 'event_slug','')
         or child #>> '{provider_contract,raw_provider_child_label}'
           is distinct from nullif(child ->> 'raw_provider_child_label','')
         or (nullif(child ->> 'event_id','') is not null
           and child ->> 'event_id'<>reconciliation ->> 'provider_parent_id')
         or nullif(child ->> 'provider_child_identity_key','')
           is distinct from expected_provider_identity_key
         or coalesce(child ->> 'provider_contract_hash','') !~ '^[a-f0-9]{64}$'
         or (child ->> 'provider_contract_canonical_json')::jsonb is distinct from
           jsonb_build_object(
             'contract_version',child #>> '{provider_contract,contract_version}',
             'provider',child #>> '{provider_contract,provider}',
             'source_question',child #> '{provider_contract,source_question}',
             'source_description',child #> '{provider_contract,source_description}',
             'source_resolution_rules',child #> '{provider_contract,source_resolution_rules}',
             'source_resolution_url',child #> '{provider_contract,source_resolution_url}',
             'source_close_at',child #> '{provider_contract,source_close_at}',
             'source_resolution_deadline',child #> '{provider_contract,source_resolution_deadline}'
           )
         or encode(extensions.digest(convert_to(child ->> 'provider_contract_canonical_json','UTF8'),'sha256'),'hex')
           is distinct from child ->> 'provider_contract_hash'
         or jsonb_typeof(coalesce(child -> 'identity_evidence','[]'::jsonb))<>'array'
         or jsonb_array_length(coalesce(child -> 'identity_evidence','[]'::jsonb))>24
         or not exists (
           select 1 from jsonb_array_elements(child -> 'identity_evidence') evidence
           where evidence ->> 'url' ~ '^https://'
             and nullif(evidence ->> 'result','') is not null
         )
         or not (
           (child ->> 'identity_classification' in (
             'identified_real_option','aggregate_other_option','tie_option',
             'no_winner_option','provider_closed_child'
           ) and child ->> 'identity_status'='resolved')
           or (child ->> 'identity_classification'='provider_placeholder_pending_resolution'
             and child ->> 'identity_status'='unresolved_placeholder')
           or (child ->> 'identity_classification'='provider_data_conflict'
             and child ->> 'identity_status'='conflict')
           or (child ->> 'identity_classification'='provider_duplicate_child'
             and child ->> 'identity_status'='duplicate')
           or (child ->> 'identity_classification'='provider_removed_child'
             and child ->> 'identity_status'='removed')
         )
         or (child ->> 'identity_status'='resolved' and child ->> 'identity_kind'='option' and (
           nullif(child ->> 'canonical_child_label','') is null
           or coalesce(child ->> 'canonical_child_slug','') !~ '^[a-z0-9][a-z0-9-]{0,239}$'
           or child ->> 'canonical_child_key'
             is distinct from 'option:'||(child ->> 'canonical_child_slug')
           or child ->> 'canonical_child_label' ~* '^\s*deadline:'
           or child ->> 'canonical_child_label' ~* '\d{4}-\d{2}-\d{2}T\d{2}:\d{2}'
           or child ->> 'canonical_child_label' ~* '^\s*(lt|lte|gt|gte)\s+\d'
           or child ->> 'canonical_child_label' ~* '^\s*(ET|year)\s*$'
           or child ->> 'canonical_child_label' ~* '^\s*(before|after|by|on\s+or\s+before|on\s+or\s+after|during|in|antes\s+de|despu[eé]s\s+de|hasta|durante|en)\s+\d{4}(\s|$)'
           or child ->> 'canonical_child_label' ~* '^\s*\d{4}(\s*\((ET|year)\))?\s*$'
         ))
         or (child ->> 'identity_status'='resolved' and child ->> 'identity_kind'='contract' and (
           nullif(child ->> 'canonical_child_label','') is not null
           or nullif(child ->> 'canonical_child_slug','') is not null
           or nullif(child ->> 'canonical_child_key','') is not null
         ))
         or (child ->> 'identity_status'='unresolved_placeholder' and (
           nullif(child ->> 'canonical_child_label','') is not null
           or nullif(child ->> 'canonical_child_slug','') is not null
           or nullif(child ->> 'canonical_child_key','') is not null
         ))
         or (child ->> 'identity_classification'='provider_duplicate_child' and
           nullif(child ->> 'duplicate_of_child_identity_key','') is null)
         or (child ->> 'identity_classification'='provider_closed_child'
           and child ->> 'availability_status' not in ('closed','inactive'))
         or (child ->> 'identity_classification'='provider_removed_child' and (
           not (coalesce((child ->> 'present_in_current_snapshot')::boolean,false)
             or coalesce((child ->> 'present_in_legacy_snapshot')::boolean,false))
           or child ->> 'availability_status'<>'removed'
           or not exists (
             select 1 from jsonb_array_elements(child -> 'identity_evidence') evidence
             where evidence ->> 'url' ~ '^https://'
               and evidence ->> 'result'='provider_removed_child'
           )
         ))
         or (child ->> 'identity_status'='resolved' and not exists (
           select 1 from jsonb_array_elements(child -> 'identity_evidence') evidence
           where evidence ->> 'url' ~ '^https://'
             and evidence ->> 'identifier' is not null
             and coalesce(evidence ->> 'identity_sha256',evidence ->> 'content_sha256')
               ~ '^[a-f0-9]{64}$'
             and evidence ->> 'result' in (
               'identity_resolved','child_identity_observed_in_parent','provider_closed_child'
             )
         )) then
        raise exception 'RADAR_PARENT_CHILD_RECONCILIATION_INVALID' using errcode='22023';
      end if;
    end loop;
    issue_id_value:=null;
    for prior_issue in
      select occurrence.issue_id,occurrence.issue_code,occurrence.issue_fingerprint,
        coalesce(latest.new_status,'open') as effective_status
      from private.market_workflow_issue_occurrences_v1 occurrence
      join private.market_workflow_issue_subject_links_v1 link
        on link.issue_id=occurrence.issue_id
      left join lateral (
        select event.new_status from private.market_workflow_issue_events_v1 event
        where event.issue_id=occurrence.issue_id
        order by event.occurred_at desc,event.id desc limit 1
      ) latest on true
      where link.subject_type='provider_refresh'
        and link.subject_key=left(provider_input||':'||(reconciliation ->> 'provider_parent_id'),240)
        and link.subject_version='atinara-radar-parent-reconciliation-v1'
        and occurrence.issue_code in (
          'PROVIDER_CHILD_IDENTITY_RESOLUTION_REQUIRED',
          'RADAR_PARENT_RECONCILIATION_INCOMPLETE','PROVIDER_PARENT_COUNT_INCONSISTENT'
        )
        and coalesce(latest.new_status,'open') not in ('resolved','superseded')
    loop
      if status_value='complete' then
        insert into private.market_workflow_issue_events_v1(
          issue_id,event_type,previous_status,new_status,owner_stage,next_action,
          resolution_method,evidence_refs,occurred_at
        ) values (
          prior_issue.issue_id,'resolved',prior_issue.effective_status,'resolved','radar',
          'retry_provider_refresh','provider_parent_reconciled',
          jsonb_build_array(jsonb_build_object(
            'reconciliation_fingerprint',reconciliation ->> 'reconciliation_fingerprint'
          )),clock_timestamp()
        );
      elsif coalesce(reconciliation #>> '{issue,fingerprint}','')<>prior_issue.issue_fingerprint then
        insert into private.market_workflow_issue_events_v1(
          issue_id,event_type,previous_status,new_status,owner_stage,next_action,
          resolution_method,evidence_refs,occurred_at
        ) values (
          prior_issue.issue_id,'superseded',prior_issue.effective_status,'superseded','radar',
          'retry_provider_refresh','superseded_by_parent_reconciliation',
          jsonb_build_array(jsonb_build_object(
            'reconciliation_fingerprint',reconciliation ->> 'reconciliation_fingerprint'
          )),clock_timestamp()
        );
      end if;
    end loop;
    if status_value<>'complete' then
      if jsonb_typeof(reconciliation -> 'issue')<>'object' then
        raise exception 'RADAR_PARENT_RECONCILIATION_ISSUE_REQUIRED' using errcode='23514';
      end if;
      issue_id_value:=private.record_market_workflow_issue_v1(
        'provider_refresh',
        left(provider_input||':'||(reconciliation ->> 'provider_parent_id'),240),
        'atinara-radar-parent-reconciliation-v1',
        reconciliation ->> 'reconciliation_fingerprint',
        reconciliation -> 'issue',null,null
      );
    end if;

    legacy_persisted_expected_value:=coalesce(
      nullif(known_legacy_count,0),legacy_expected_value
    );
    if legacy_expected_value is null then
      legacy_persisted_accounted_value:=null;
    else
      legacy_persisted_accounted_value:=legacy_accounted_count;
    end if;

    insert into private.market_radar_parent_reconciliations_v1(
      request_id,provider,capability,provider_parent_id,raw_provider_parent_label,
      canonical_parent_label,raw_provider_category,atinara_category,category,
      external_parent_url,horizon_at,provider_declared_child_count,
      provider_discovered_child_count,provider_accounted_child_count,
      provider_identified_child_count,provider_unresolved_child_count,
      provider_removed_child_count,provider_closed_child_count,
      provider_duplicate_child_count,provider_conflict_child_count,
      legacy_expected_child_count,legacy_accounted_child_count,new_child_count,
      provider_pagination_exhausted,reconciliation_status,reconciliation_version,
      normalizer_version,family_version,reconciliation_fingerprint,checked_at,
      next_retry_at,source_refs,payload_hash,issue_id
    ) values (
      request_id_input,provider_input,capability_input,
      left(reconciliation ->> 'provider_parent_id',220),
      nullif(left(reconciliation ->> 'raw_provider_parent_label',500),''),
      nullif(left(reconciliation ->> 'canonical_parent_label',500),''),
      nullif(left(reconciliation ->> 'raw_provider_category',120),''),
      nullif(left(reconciliation ->> 'atinara_category',120),''),
      nullif(left(reconciliation ->> 'category',120),''),
      nullif(left(reconciliation ->> 'external_parent_url',2000),''),
      nullif(reconciliation ->> 'horizon_at','')::timestamptz,declared_count,
      current_count,current_count,identified_count,unresolved_count,removed_count,
      closed_count,duplicate_count,conflict_count,
      legacy_persisted_expected_value,legacy_persisted_accounted_value,new_count,
      coalesce((reconciliation ->> 'provider_pagination_exhausted')::boolean,false),
      status_value,'atinara-radar-parent-reconciliation-v1','atinara-radar-v3',
      'atinara-market-family-v5',reconciliation ->> 'reconciliation_fingerprint',
      (reconciliation ->> 'checked_at')::timestamptz,
      nullif(reconciliation ->> 'next_retry_at','')::timestamptz,
      coalesce(reconciliation -> 'source_refs','[]'::jsonb),
      private.market_radar_reconciliation_payload_hash_v1(reconciliation,'parent'),
      issue_id_value
    ) on conflict(request_id,provider,provider_parent_id) do nothing;

    select * into parent_row
    from private.market_radar_parent_reconciliations_v1 parent_alias
    where parent_alias.request_id=request_id_input
      and parent_alias.provider=provider_input
      and parent_alias.provider_parent_id=reconciliation ->> 'provider_parent_id';
    if not found or parent_row.reconciliation_fingerprint
      is distinct from reconciliation ->> 'reconciliation_fingerprint'
      or parent_row.payload_hash is distinct from
        private.market_radar_reconciliation_payload_hash_v1(reconciliation,'parent') then
      raise exception 'RADAR_PARENT_RECONCILIATION_IDEMPOTENCY_CONFLICT' using errcode='40001';
    end if;

    for child in select value from jsonb_array_elements(reconciliation -> 'children')
    loop
      insert into private.market_radar_parent_children_v1(
        parent_reconciliation_id,child_occurrence_key,provider_child_identity_key,identity_kind,
        external_market_id,condition_id,token_ids,child_slug,event_id,event_slug,
        raw_provider_child_label,canonical_child_label,canonical_child_slug,
        canonical_child_key,identity_classification,identity_status,
        availability_status,identity_source,identity_confidence,identity_evidence,
        present_in_current_snapshot,present_in_legacy_snapshot,transition,
        duplicate_of_child_identity_key,provider_contract,provider_contract_canonical_json,
        provider_contract_hash,
        projection_version,child_fingerprint,payload_hash,checked_at
      ) values (
        parent_row.id,left(child ->> 'child_occurrence_key',500),
        nullif(left(child ->> 'provider_child_identity_key',500),''),child ->> 'identity_kind',
        nullif(left(child ->> 'external_market_id',220),''),
        nullif(left(child ->> 'condition_id',220),''),
        coalesce(child -> 'token_ids','[]'::jsonb),
        nullif(left(child ->> 'child_slug',400),''),
        nullif(left(child ->> 'event_id',220),''),
        nullif(left(child ->> 'event_slug',400),''),
        nullif(left(child ->> 'raw_provider_child_label',500),''),
        nullif(left(child ->> 'canonical_child_label',500),''),
        nullif(left(child ->> 'canonical_child_slug',240),''),
        nullif(left(child ->> 'canonical_child_key',247),''),
        child ->> 'identity_classification',child ->> 'identity_status',
        left(child ->> 'availability_status',80),
        nullif(left(child ->> 'identity_source',120),''),
        least(greatest(coalesce((child ->> 'identity_confidence')::numeric,0),0),100),
        coalesce(child -> 'identity_evidence','[]'::jsonb),
        coalesce((child ->> 'present_in_current_snapshot')::boolean,false),
        coalesce((child ->> 'present_in_legacy_snapshot')::boolean,false),
        child ->> 'transition',
        nullif(left(child ->> 'duplicate_of_child_identity_key',500),''),
        child -> 'provider_contract',child ->> 'provider_contract_canonical_json',
        child ->> 'provider_contract_hash',
        'atinara-radar-child-projection-v1',child ->> 'child_fingerprint',
        private.market_radar_reconciliation_payload_hash_v1(child,'child'),
        (child ->> 'checked_at')::timestamptz
      ) on conflict(parent_reconciliation_id,child_occurrence_key) do nothing;
      if not exists (
        select 1 from private.market_radar_parent_children_v1 child_alias
        where child_alias.parent_reconciliation_id=parent_row.id
          and child_alias.child_occurrence_key=child ->> 'child_occurrence_key'
          and child_alias.child_fingerprint=child ->> 'child_fingerprint'
          and child_alias.payload_hash=
            private.market_radar_reconciliation_payload_hash_v1(child,'child')
      ) then
        raise exception 'RADAR_PARENT_CHILD_IDEMPOTENCY_CONFLICT' using errcode='40001';
      end if;
    end loop;
    select count(*) into persisted_child_count
    from private.market_radar_parent_children_v1 child_alias
    where child_alias.parent_reconciliation_id=parent_row.id;
    if persisted_child_count<>jsonb_array_length(reconciliation -> 'children') then
      raise exception 'RADAR_PARENT_CHILD_PERSISTENCE_INCOMPLETE' using errcode='23514';
    end if;
    output_items:=output_items||jsonb_build_array(jsonb_build_object(
      'id',parent_row.id,'provider_parent_id',parent_row.provider_parent_id,
      'reconciliation_status',parent_row.reconciliation_status,
      'reconciliation_fingerprint',parent_row.reconciliation_fingerprint,
      'issue_id',parent_row.issue_id
    ));
  end loop;

  select count(*),count(*) filter(where reconciliation_status<>'complete'),
    encode(extensions.digest(convert_to(coalesce(string_agg(
      provider_parent_id||':'||reconciliation_fingerprint,'|' order by provider_parent_id
    ),''),'UTF8'),'sha256'),'hex')
  into parent_count_value,incomplete_count_value,manifest_hash_value
  from private.market_radar_parent_reconciliations_v1
  where request_id=request_id_input and provider=provider_input;
  select coalesce(sum(provider_discovered_child_count),0)::integer
  into selected_child_count_value
  from private.market_radar_parent_reconciliations_v1
  where request_id=request_id_input and provider=provider_input;
  if parent_count_value<>jsonb_array_length(reconciliations_input)
     or manifest_hash_value is null
     or intent.provider_selection is null
     or (intent.provider_selection ->> 'selected_parent_count')::integer<>parent_count_value
     or (intent.provider_selection ->> 'selected_child_count')::integer<>selected_child_count_value
     or exists (
       select 1
       from private.market_radar_parent_reconciliations_v1 parent_alias
       where parent_alias.request_id=request_id_input
         and parent_alias.provider=provider_input
         and not exists (
           select 1
           from jsonb_array_elements_text(
             intent.provider_selection -> 'selected_parent_ids'
           ) selected(parent_id)
           where selected.parent_id=parent_alias.provider_parent_id
         )
     )
     or exists (
       select 1
       from jsonb_array_elements_text(
         intent.provider_selection -> 'selected_parent_ids'
       ) selected(parent_id)
       where not exists (
         select 1
         from private.market_radar_parent_reconciliations_v1 parent_alias
         where parent_alias.request_id=request_id_input
           and parent_alias.provider=provider_input
           and parent_alias.provider_parent_id=selected.parent_id
       )
     )
     or exists (
       select 1
       from jsonb_array_elements_text(intent.provider_selection -> 'deferred_parent_ids') deferred(parent_id)
       join private.market_radar_parent_reconciliations_v1 parent_alias
         on parent_alias.provider_parent_id=deferred.parent_id
       where parent_alias.request_id=request_id_input
         and parent_alias.provider=provider_input
     ) then
    raise exception 'RADAR_PARENT_MANIFEST_INCOMPLETE' using errcode='23514';
  end if;
  if intent.parent_manifest_hash is not null
     and intent.parent_manifest_hash is distinct from manifest_hash_value then
    raise exception 'RADAR_PARENT_MANIFEST_IDEMPOTENCY_CONFLICT' using errcode='40001';
  end if;
  update private.market_radar_refresh_intents_v1 set
    parent_manifest_hash=manifest_hash_value,
    provider_parent_count=parent_count_value,
    reconciled_parent_count=parent_count_value,
    incomplete_parent_count=incomplete_count_value,
    provider_pagination_exhausted=not exists (
      select 1 from private.market_radar_parent_reconciliations_v1 parent_alias
      where parent_alias.request_id=request_id_input and parent_alias.provider=provider_input
        and not parent_alias.provider_pagination_exhausted
    ),
    updated_at=clock_timestamp()
  where request_id=request_id_input and provider=provider_input and capability=capability_input;
  return jsonb_build_object(
    'ok',true,'request_id',request_id_input,'provider',provider_input,
    'parent_manifest_hash',manifest_hash_value,'provider_parent_count',parent_count_value,
    'reconciled_parent_count',parent_count_value,
    'incomplete_parent_count',incomplete_count_value,'items',output_items
  );
exception when invalid_text_representation or datetime_field_overflow then
  raise exception 'RADAR_PARENT_RECONCILIATION_VALUE_INVALID' using errcode='22007';
end;
$function$;

alter function public.record_market_radar_parent_reconciliations_v1(uuid,text,text,uuid,jsonb)
  owner to postgres;
revoke all on function public.record_market_radar_parent_reconciliations_v1(uuid,text,text,uuid,jsonb)
  from public,anon,authenticated,service_role;
grant execute on function public.record_market_radar_parent_reconciliations_v1(uuid,text,text,uuid,jsonb)
  to service_role;

create or replace function public.get_market_radar_parent_children_for_reconciliation_v1(
  provider_input text,
  parent_ids_input text[]
)
returns setof jsonb
language plpgsql
stable
security definer
set search_path to ''
as $function$
begin
  if auth.role()<>'service_role' then
    raise exception 'SERVICE_ROLE_REQUIRED' using errcode='42501';
  end if;
  if provider_input not in ('polymarket','kalshi')
     or coalesce(array_length(parent_ids_input,1),0) not between 1 and 120
     or exists(select 1 from unnest(parent_ids_input) value
       where nullif(btrim(value),'') is null or char_length(value)>220) then
    raise exception 'RADAR_PARENT_HISTORY_SCOPE_INVALID' using errcode='22023';
  end if;
  return query
  with latest_parent as (
    select distinct on (parent_alias.provider_parent_id)
      parent_alias.id,parent_alias.provider_parent_id
    from private.market_radar_parent_reconciliations_v1 parent_alias
    join private.market_radar_refresh_intents_v1 intent
      on intent.request_id=parent_alias.request_id
     and intent.provider=parent_alias.provider
     and intent.capability=parent_alias.capability
    where parent_alias.provider=provider_input
      and parent_alias.provider_parent_id=any(parent_ids_input)
      and intent.status in ('completed','partial')
    order by parent_alias.provider_parent_id,parent_alias.checked_at desc,parent_alias.inserted_at desc
  ), ledger as (
    select latest.provider_parent_id,
      child.child_occurrence_key,
      child.provider_child_identity_key,child.external_market_id,child.condition_id,
      child.token_ids,child.child_slug,child.event_id,child.event_slug,
      child.raw_provider_child_label,child.canonical_child_label,
      child.identity_classification,child.identity_status,child.availability_status,
      child.identity_source,child.identity_confidence,child.identity_evidence,
      child.provider_contract,child.provider_contract_hash,
      child.checked_at,0 as source_priority
    from latest_parent latest
    join private.market_radar_parent_children_v1 child
      on child.parent_reconciliation_id=latest.id
    where child.present_in_current_snapshot
  ), legacy as (
    select candidate.external_event_id as provider_parent_id,
      'legacy:'||candidate.id::text as child_occurrence_key,
      provider_input||':'||coalesce(
        nullif(candidate.normalized_payload ->> 'external_market_id',''),candidate.external_id
      ) as provider_child_identity_key,
      coalesce(nullif(candidate.normalized_payload ->> 'external_market_id',''),candidate.external_id) as external_market_id,
      nullif(candidate.normalized_payload #>> '{provider_payload,condition_id}','') as condition_id,
      coalesce(candidate.normalized_payload #> '{provider_payload,token_ids}','[]'::jsonb) as token_ids,
      nullif(candidate.normalized_payload ->> 'external_market_slug','') as child_slug,
      candidate.external_event_id as event_id,
      nullif(candidate.normalized_payload ->> 'external_event_slug','') as event_slug,
      coalesce(
        nullif(candidate.normalized_payload ->> 'raw_provider_child_label',''),
        nullif(candidate.normalized_payload #>> '{provider_payload,yes_sub_title}',''),
        nullif(candidate.normalized_payload ->> 'source_question','')
      ) as raw_provider_child_label,
      case when candidate.normalizer_version='atinara-radar-v3'
        and candidate.normalized_payload ->> 'identity_status'='resolved'
        then nullif(candidate.normalized_payload ->> 'canonical_child_label','') end
        as canonical_child_label,
      coalesce(nullif(candidate.normalized_payload ->> 'identity_classification',''),
        'provider_placeholder_pending_resolution') as identity_classification,
      coalesce(nullif(candidate.normalized_payload ->> 'identity_status',''),
        'unresolved_placeholder') as identity_status,
      coalesce(nullif(candidate.normalized_payload ->> 'availability_status',''),
        nullif(candidate.source_status,''),'unknown') as availability_status,
      nullif(candidate.normalized_payload ->> 'identity_source','') as identity_source,
      coalesce(nullif(candidate.normalized_payload ->> 'identity_confidence','')::numeric,0)
        as identity_confidence,
      coalesce(candidate.normalized_payload -> 'identity_evidence','[]'::jsonb)
        as identity_evidence,
      jsonb_build_object(
        'contract_version','atinara-radar-provider-child-contract-v1',
        'provider',candidate.provider,'provider_parent_id',candidate.external_event_id,
        'external_market_id',coalesce(
          nullif(candidate.normalized_payload ->> 'external_market_id',''),candidate.external_id
        ),
        'condition_id',nullif(candidate.normalized_payload #>> '{provider_payload,condition_id}',''),
        'token_ids',coalesce(candidate.normalized_payload #> '{provider_payload,token_ids}','[]'::jsonb),
        'child_slug',nullif(candidate.normalized_payload ->> 'external_market_slug',''),
        'event_slug',nullif(candidate.normalized_payload ->> 'external_event_slug',''),
        'external_event_url',nullif(candidate.normalized_payload ->> 'external_event_url',''),
        'external_market_url',nullif(candidate.normalized_payload ->> 'external_market_url',''),
        'source_title',nullif(candidate.normalized_payload ->> 'source_title',''),
        'source_question',nullif(candidate.normalized_payload ->> 'source_question',''),
        'source_description',nullif(candidate.normalized_payload ->> 'source_description',''),
        'source_resolution_rules',nullif(candidate.normalized_payload ->> 'source_resolution_rules',''),
        'source_resolution_url',nullif(candidate.normalized_payload ->> 'source_resolution_url',''),
        'source_close_at',nullif(candidate.normalized_payload ->> 'source_close_at',''),
        'source_resolution_deadline',nullif(candidate.normalized_payload ->> 'source_resolution_deadline',''),
        'source_status',nullif(candidate.normalized_payload ->> 'source_status',''),
        'source_result',nullif(candidate.normalized_payload ->> 'source_result',''),
        'raw_provider_child_label',coalesce(
          nullif(candidate.normalized_payload ->> 'raw_provider_child_label',''),
          nullif(candidate.normalized_payload #>> '{provider_payload,yes_sub_title}',''),
          nullif(candidate.normalized_payload ->> 'source_question','')
        )
      ) as provider_contract,
      null::text as provider_contract_hash,
      candidate.fetched_at as checked_at,1 as source_priority
    from private.external_market_candidates candidate
    where candidate.provider=provider_input
      and candidate.external_event_id=any(parent_ids_input)
      and not exists (
        select 1 from latest_parent latest
        where latest.provider_parent_id=candidate.external_event_id
      )
  ), combined as (
    select * from ledger union all select * from legacy
  )
  select to_jsonb(selected)-'source_priority'
  from combined selected
  order by selected.provider_parent_id,selected.source_priority,
    selected.child_occurrence_key,selected.checked_at desc;
end;
$function$;

alter function public.get_market_radar_parent_children_for_reconciliation_v1(text,text[])
  owner to postgres;
revoke all on function public.get_market_radar_parent_children_for_reconciliation_v1(text,text[])
  from public,anon,authenticated,service_role;
grant execute on function public.get_market_radar_parent_children_for_reconciliation_v1(text,text[])
  to service_role;

create or replace function public.get_market_radar_children_for_reconciliation_v3(
  provider_input text,
  parent_ids_input text[],
  external_market_ids_input text[],
  condition_ids_input text[],
  token_ids_input text[],
  child_slugs_input text[],
  child_identity_keys_input text[],
  current_request_id_input uuid default null
)
returns setof jsonb
language plpgsql
stable
security definer
set search_path to ''
as $function$
begin
  if auth.role()<>'service_role' then
    raise exception 'SERVICE_ROLE_REQUIRED' using errcode='42501';
  end if;
  if provider_input not in ('polymarket','kalshi')
     or coalesce(array_length(parent_ids_input,1),0) not between 1 and 120
     or coalesce(array_length(external_market_ids_input,1),0)>480
     or coalesce(array_length(condition_ids_input,1),0)>480
     or coalesce(array_length(token_ids_input,1),0)>9600
     or coalesce(array_length(child_slugs_input,1),0)>480
     or coalesce(array_length(child_identity_keys_input,1),0)>480
     or exists(select 1 from unnest(parent_ids_input) value
       where nullif(btrim(value),'') is null or char_length(value)>220)
     or exists(select 1 from unnest(coalesce(external_market_ids_input,array[]::text[])) value
       where nullif(btrim(value),'') is null or char_length(value)>220)
     or exists(select 1 from unnest(coalesce(condition_ids_input,array[]::text[])) value
       where nullif(btrim(value),'') is null or char_length(value)>220)
     or exists(select 1 from unnest(coalesce(token_ids_input,array[]::text[])) value
       where nullif(btrim(value),'') is null or char_length(value)>220)
     or exists(select 1 from unnest(coalesce(child_slugs_input,array[]::text[])) value
       where nullif(btrim(value),'') is null or char_length(value)>400)
     or exists(select 1 from unnest(coalesce(child_identity_keys_input,array[]::text[])) value
       where nullif(btrim(value),'') is null or char_length(value)>500) then
    raise exception 'RADAR_PARENT_HISTORY_SCOPE_INVALID' using errcode='22023';
  end if;
  return query
  with latest_parent as materialized (
    select distinct on (parent_alias.provider_parent_id)
      parent_alias.id,parent_alias.provider_parent_id,parent_alias.checked_at
    from private.market_radar_parent_reconciliations_v1 parent_alias
    join private.market_radar_refresh_intents_v1 intent
      on intent.request_id=parent_alias.request_id
     and intent.provider=parent_alias.provider
     and intent.capability=parent_alias.capability
    where parent_alias.provider=provider_input
      and intent.status in ('completed','partial')
      and (current_request_id_input is null
        or parent_alias.request_id<>current_request_id_input)
    order by parent_alias.provider_parent_id,parent_alias.checked_at desc,
      parent_alias.inserted_at desc
  ), ledger as (
    select child.id,child.child_occurrence_key,latest.provider_parent_id,child.provider_child_identity_key,
      child.identity_kind,child.external_market_id,child.condition_id,child.token_ids,
      child.child_slug,child.event_id,child.event_slug,child.raw_provider_child_label,
      child.canonical_child_label,child.canonical_child_key,
      child.identity_classification,child.identity_status,child.availability_status,
      child.identity_source,child.identity_confidence,child.identity_evidence,
      child.present_in_current_snapshot,child.present_in_legacy_snapshot,
      child.transition,child.provider_contract,child.provider_contract_hash,
      child.child_fingerprint,child.checked_at,0 as source_priority
    from latest_parent latest
    join private.market_radar_parent_children_v1 child
      on child.parent_reconciliation_id=latest.id
    where latest.provider_parent_id=any(parent_ids_input)
      or child.external_market_id=any(coalesce(external_market_ids_input,array[]::text[]))
      or child.condition_id=any(coalesce(condition_ids_input,array[]::text[]))
      or child.child_slug=any(coalesce(child_slugs_input,array[]::text[]))
      or child.provider_child_identity_key=any(coalesce(child_identity_keys_input,array[]::text[]))
      or exists (
        select 1 from jsonb_array_elements_text(child.token_ids) token(value)
        where token.value=any(coalesce(token_ids_input,array[]::text[]))
      )
  ), legacy as (
    select null::bigint as id,'legacy:'||candidate.id::text as child_occurrence_key,
      candidate.external_event_id as provider_parent_id,
      provider_input||':market:'||coalesce(
        nullif(candidate.normalized_payload ->> 'external_market_id',''),candidate.external_id
      ) as provider_child_identity_key,
      case when candidate.family_type in ('categorical_outcomes','participant_options','platform_variants')
        then 'option' else 'contract' end as identity_kind,
      coalesce(nullif(candidate.normalized_payload ->> 'external_market_id',''),candidate.external_id)
        as external_market_id,
      nullif(candidate.normalized_payload #>> '{provider_payload,condition_id}','') as condition_id,
      coalesce(candidate.normalized_payload #> '{provider_payload,token_ids}','[]'::jsonb) as token_ids,
      nullif(candidate.normalized_payload ->> 'external_market_slug','') as child_slug,
      candidate.external_event_id as event_id,
      nullif(candidate.normalized_payload ->> 'external_event_slug','') as event_slug,
      coalesce(nullif(candidate.normalized_payload ->> 'raw_provider_child_label',''),
        nullif(candidate.normalized_payload #>> '{provider_payload,yes_sub_title}',''),
        nullif(candidate.normalized_payload ->> 'source_question','')) as raw_provider_child_label,
      null::text as canonical_child_label,null::text as canonical_child_key,
      'provider_placeholder_pending_resolution'::text as identity_classification,
      'unresolved_placeholder'::text as identity_status,
      case when candidate.source_status in ('open','active','trading','initialized') then 'open'
        when candidate.source_status in ('closed','settled','finalized','determined') then 'closed'
        when candidate.source_status='inactive' then 'inactive' else 'unknown' end as availability_status,
      null::text as identity_source,0::numeric as identity_confidence,'[]'::jsonb as identity_evidence,
      true as present_in_current_snapshot,true as present_in_legacy_snapshot,
      'same'::text as transition,
      jsonb_build_object(
        'contract_version','atinara-radar-provider-child-contract-v1',
        'provider',candidate.provider,'provider_parent_id',candidate.external_event_id,
        'external_market_id',coalesce(
          nullif(candidate.normalized_payload ->> 'external_market_id',''),candidate.external_id
        ),
        'condition_id',nullif(candidate.normalized_payload #>> '{provider_payload,condition_id}',''),
        'token_ids',coalesce(candidate.normalized_payload #> '{provider_payload,token_ids}','[]'::jsonb),
        'child_slug',nullif(candidate.normalized_payload ->> 'external_market_slug',''),
        'event_slug',nullif(candidate.normalized_payload ->> 'external_event_slug',''),
        'external_event_url',nullif(candidate.normalized_payload ->> 'external_event_url',''),
        'external_market_url',nullif(candidate.normalized_payload ->> 'external_market_url',''),
        'source_title',nullif(candidate.normalized_payload ->> 'source_title',''),
        'source_question',nullif(candidate.normalized_payload ->> 'source_question',''),
        'source_description',nullif(candidate.normalized_payload ->> 'source_description',''),
        'source_resolution_rules',nullif(candidate.normalized_payload ->> 'source_resolution_rules',''),
        'source_resolution_url',nullif(candidate.normalized_payload ->> 'source_resolution_url',''),
        'source_close_at',nullif(candidate.normalized_payload ->> 'source_close_at',''),
        'source_resolution_deadline',nullif(candidate.normalized_payload ->> 'source_resolution_deadline',''),
        'source_status',nullif(candidate.normalized_payload ->> 'source_status',''),
        'source_result',nullif(candidate.normalized_payload ->> 'source_result',''),
        'raw_provider_child_label',coalesce(
          nullif(candidate.normalized_payload ->> 'raw_provider_child_label',''),
          nullif(candidate.normalized_payload #>> '{provider_payload,yes_sub_title}',''),
          nullif(candidate.normalized_payload ->> 'source_question','')
        )
      ) as provider_contract,null::text as provider_contract_hash,
      candidate.fingerprint as child_fingerprint,
      candidate.fetched_at as checked_at,1 as source_priority
    from private.external_market_candidates candidate
    where candidate.provider=provider_input
      and candidate.normalizer_version<>'atinara-radar-v3'
      and not exists (
        select 1 from latest_parent latest
        where latest.provider_parent_id=candidate.external_event_id
      )
      and (
        candidate.external_event_id=any(parent_ids_input)
        or coalesce(nullif(candidate.normalized_payload ->> 'external_market_id',''),candidate.external_id)
          =any(coalesce(external_market_ids_input,array[]::text[]))
        or nullif(candidate.normalized_payload #>> '{provider_payload,condition_id}','')
          =any(coalesce(condition_ids_input,array[]::text[]))
        or nullif(candidate.normalized_payload ->> 'external_market_slug','')
          =any(coalesce(child_slugs_input,array[]::text[]))
        or nullif(candidate.normalized_payload ->> 'parent_child_identity_key','')
          =any(coalesce(child_identity_keys_input,array[]::text[]))
        or exists (
          select 1 from jsonb_array_elements_text(case
            when jsonb_typeof(candidate.normalized_payload #> '{provider_payload,token_ids}')='array'
              then candidate.normalized_payload #> '{provider_payload,token_ids}'
            else '[]'::jsonb end
          ) token(value)
          where token.value=any(coalesce(token_ids_input,array[]::text[]))
        )
      )
  ), combined as (
    select * from ledger union all select * from legacy
  )
  select to_jsonb(selected)-'source_priority'
  from combined selected
  order by selected.provider_parent_id,selected.source_priority,
    selected.child_occurrence_key,selected.checked_at desc;
end;
$function$;

alter function public.get_market_radar_children_for_reconciliation_v3(
  text,text[],text[],text[],text[],text[],text[],uuid
)
  owner to postgres;
revoke all on function public.get_market_radar_children_for_reconciliation_v3(
  text,text[],text[],text[],text[],text[],text[],uuid
)
  from public,anon,authenticated,service_role;
grant execute on function public.get_market_radar_children_for_reconciliation_v3(
  text,text[],text[],text[],text[],text[],text[],uuid
)
  to service_role;

create or replace function public.get_market_radar_protected_candidate_identities_v1(
  provider_filter text default null
)
returns setof jsonb
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare protected_count integer;
begin
  if auth.role()<>'service_role' then
    raise exception 'SERVICE_ROLE_REQUIRED' using errcode='42501';
  end if;
  if provider_filter is not null and provider_filter not in ('polymarket','kalshi') then
    raise exception 'INVALID_RADAR_PROVIDER' using errcode='22023';
  end if;
  select count(*) into protected_count
  from private.external_market_candidates candidate
  where (
      candidate.state in ('prepared','rejected') and candidate.prepared_draft_id is not null
      or exists (
        select 1 from private.market_drafts draft
        where draft.workflow_status not in ('cancelled','annulled') and (
          draft.radar_candidate_id=candidate.id or (
            draft.intelligence_origin_type='radar_candidate'
            and draft.intelligence_origin_id=candidate.id::text
          )
        )
      )
    )
    and (provider_filter is null or candidate.provider=provider_filter);
  if protected_count>480 then
    raise exception 'RADAR_PROTECTED_CANDIDATE_LIMIT_EXCEEDED' using errcode='54000';
  end if;
  return query
  select jsonb_build_object(
    'provider',candidate.provider,
    'external_id',candidate.external_id,
    'state',candidate.state,
    'normalizer_version',candidate.normalizer_version
  )
  from private.external_market_candidates candidate
  where (
      candidate.state in ('prepared','rejected') and candidate.prepared_draft_id is not null
      or exists (
        select 1 from private.market_drafts draft
        where draft.workflow_status not in ('cancelled','annulled') and (
          draft.radar_candidate_id=candidate.id or (
            draft.intelligence_origin_type='radar_candidate'
            and draft.intelligence_origin_id=candidate.id::text
          )
        )
      )
    )
    and (provider_filter is null or candidate.provider=provider_filter)
  order by candidate.provider,candidate.external_id;
end;
$function$;
alter function public.get_market_radar_protected_candidate_identities_v1(text)
  owner to postgres;
revoke all on function public.get_market_radar_protected_candidate_identities_v1(text)
  from public,anon,authenticated,service_role;
grant execute on function public.get_market_radar_protected_candidate_identities_v1(text)
  to service_role;

create or replace function private.enforce_market_candidate_reconciliation_projection_v1()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  identity_status_value text;
  classification_value text;
  canonical_label_value text;
  canonical_key_value text;
  family_type_value text;
begin
  if new.normalized_payload ->> 'normalizer_version'
    is distinct from 'atinara-radar-v3' then
    return new;
  end if;
  if new.normalized_payload ->> 'family_version'
    is distinct from 'atinara-market-family-v5' then
    raise exception 'RADAR_FAMILY_VERSION_INVALID' using errcode='22023';
  end if;
  family_type_value:=nullif(new.normalized_payload ->> 'family_type','');
  if nullif(new.normalized_payload ->> 'family_key','') is null
     or family_type_value is null
     or jsonb_typeof(coalesce(new.normalized_payload -> 'family_semantics','{}'::jsonb))<>'object' then
    raise exception 'RADAR_FAMILY_PROJECTION_INVALID' using errcode='23514';
  end if;
  new.normalizer_version:='atinara-radar-v3';
  new.family_key:=new.normalized_payload ->> 'family_key';
  new.family_title:=nullif(new.normalized_payload ->> 'family_title','');
  new.family_type:=family_type_value;
  new.family_child_key:=nullif(new.normalized_payload ->> 'family_child_key','');
  new.family_child_label:=nullif(new.normalized_payload ->> 'family_child_label','');
  new.family_sort_at:=private.market_family_safe_timestamptz_v4(
    new.normalized_payload ->> 'family_sort_at'
  );
  new.family_relationship:=coalesce(
    nullif(new.normalized_payload ->> 'family_relationship',''),'standalone'
  );
  new.family_semantics:=coalesce(new.normalized_payload -> 'family_semantics','{}'::jsonb);
  new.family_source_event_key:=nullif(new.normalized_payload ->> 'family_source_event_key','');
  new.family_version:='atinara-market-family-v5';
  if (private.market_candidate_has_blocking_duplicate(new.duplicate_matches,new.id)
      and (new.normalized_payload ->> 'eligibility_status'='eligible'
        or new.normalized_payload ->> 'verification_status'='verified_open'
        or new.normalized_payload ->> 'state'='available'))
     or (not private.market_candidate_has_blocking_duplicate(new.duplicate_matches,new.id)
       and (new.normalized_payload ->> 'eligibility_status'='duplicate'
         or new.normalized_payload ->> 'verification_status'='rejected_duplicate')) then
    raise exception 'RADAR_DUPLICATE_PROJECTION_INVALID' using errcode='23514';
  end if;
  identity_status_value:=new.normalized_payload ->> 'identity_status';
  classification_value:=new.normalized_payload ->> 'identity_classification';
  canonical_label_value:=nullif(new.normalized_payload ->> 'canonical_child_label','');
  canonical_key_value:=nullif(new.normalized_payload ->> 'canonical_child_key','');
  if identity_status_value in ('unresolved_placeholder','conflict','duplicate','removed') then
    if new.family_type in ('categorical_outcomes','participant_options','platform_variants') then
      new.family_child_key:=null;
      new.family_child_label:=null;
      new.normalized_payload:=new.normalized_payload||jsonb_build_object(
        'family_child_key',null,'family_child_label',null,
        'family_type',new.family_type,'family_version','atinara-market-family-v5'
      );
    end if;
    return new;
  end if;
  if identity_status_value<>'resolved'
     or classification_value not in (
       'identified_real_option','aggregate_other_option','tie_option',
       'no_winner_option','provider_closed_child'
     ) then
    raise exception 'RADAR_CHILD_IDENTITY_INVALID' using errcode='22023';
  end if;
  if new.family_type in ('categorical_outcomes','participant_options','platform_variants') then
    if canonical_label_value is null
       or canonical_key_value is null
       or canonical_key_value !~ '^option:(?:[a-z0-9][a-z0-9-]{0,237}|u-[a-f0-9-]{1,235})$'
       or canonical_label_value ~* '^\s*deadline:'
       or canonical_label_value ~* '\d{4}-\d{2}-\d{2}T\d{2}:\d{2}'
       or canonical_label_value ~* '^\s*(lt|lte|gt|gte)\s+\d'
       or canonical_label_value ~* '^\s*(ET|year)\s*$'
       or canonical_label_value ~* '^\s*(before|after|by|on\s+or\s+before|on\s+or\s+after|during|in|antes\s+de|despu[eé]s\s+de|hasta|durante|en)\s+\d{4}(\s|$)'
       or canonical_label_value ~* '^\s*\d{4}(\s*\((ET|year)\))?\s*$' then
      raise exception 'CANONICAL_CHILD_PROJECTION_INVALID' using errcode='23514';
    end if;
    new.family_child_key:=canonical_key_value;
    new.family_child_label:=canonical_label_value;
    new.normalized_payload:=new.normalized_payload||jsonb_build_object(
      'family_child_key',canonical_key_value,'family_child_label',canonical_label_value,
      'family_type',new.family_type,'family_version','atinara-market-family-v5'
    );
  end if;
  return new;
end;
$function$;
revoke all on function private.enforce_market_candidate_reconciliation_projection_v1()
  from public,anon,authenticated,service_role;

-- Los triggers V4 siguen siendo necesarios para escrituras legacy, pero no
-- pueden recalcular ni degradar un expediente V3/V5 ya normalizado por la Edge.
drop trigger if exists a_assign_market_candidate_family_v4_before_write
  on private.external_market_candidates;
create trigger a_assign_market_candidate_family_v4_before_write
before insert or update of normalized_payload,external_event_id
on private.external_market_candidates
for each row
when ((new.normalized_payload ->> 'normalizer_version') is distinct from 'atinara-radar-v3')
execute function private.assign_market_candidate_family_v4();

drop trigger if exists zzz_classify_market_candidate_relations_v4_before_write
  on private.external_market_candidates;
create trigger zzz_classify_market_candidate_relations_v4_before_write
before insert or update of normalized_payload,duplicate_matches,family_key,family_child_key
on private.external_market_candidates
for each row
when ((new.normalized_payload ->> 'normalizer_version') is distinct from 'atinara-radar-v3')
execute function private.classify_market_candidate_relations_v4();

drop trigger if exists zzz_deduplicate_market_candidate_family_arrays_before_write
  on private.external_market_candidates;
create trigger zzz_deduplicate_market_candidate_family_arrays_before_write
before insert or update of normalized_payload,duplicate_matches
on private.external_market_candidates
for each row
when ((new.normalized_payload ->> 'normalizer_version') is distinct from 'atinara-radar-v3')
execute function private.deduplicate_market_candidate_family_arrays();

drop trigger if exists b_enforce_market_candidate_reconciliation_projection_v1
  on private.external_market_candidates;
create trigger b_enforce_market_candidate_reconciliation_projection_v1
before insert or update of normalized_payload on private.external_market_candidates
for each row execute function private.enforce_market_candidate_reconciliation_projection_v1();

create or replace function private.market_family_option_slug_v2(
  value_input text,
  length_input integer default 120
)
returns text
language plpgsql
immutable
set search_path to ''
as $function$
declare
  bounded_length integer:=greatest(1,least(coalesce(length_input,120),240));
  cleaned_value text;
  folded_value text;
  ascii_slug text;
  unicode_slug text default '';
  slug_value text;
  character_value text;
  folded_character text;
  index_value integer;
  encoded_value bytea;
  hash_source text;
  byte_index integer;
  hash_value bigint:=2166136261;
  hash_suffix text;
begin
  cleaned_value:=left(trim(regexp_replace(
    regexp_replace(coalesce(value_input,''),'[[:cntrl:]]',' ','g'),
    '[[:space:]]+',' ','g'
  )),500);
  folded_value:=translate(
    regexp_replace(normalize(cleaned_value,NFD),U&'[\0300-\036F]','','g'),
    'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'
  );
  ascii_slug:=trim(both '-' from regexp_replace(
    folded_value,'[^a-z0-9]+','-','g'
  ));
  for index_value in 1..char_length(lower(normalize(cleaned_value,NFC))) loop
    character_value:=substr(lower(normalize(cleaned_value,NFC)),index_value,1);
    folded_character:=translate(
      regexp_replace(normalize(character_value,NFD),U&'[\0300-\036F]','','g'),
      'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'
    );
    if character_value~'[[:alnum:]]' and folded_character!~'^[a-z0-9]$' then
      unicode_slug:=unicode_slug||case when length(unicode_slug)=0 then '' else '-' end
        ||to_hex(ascii(character_value));
    end if;
  end loop;
  slug_value:=case
    when length(ascii_slug)>0 and length(unicode_slug)>0 then ascii_slug||'-u-'||unicode_slug
    when length(ascii_slug)>0 then ascii_slug
    when length(unicode_slug)>0 then 'u-'||unicode_slug
    else ''
  end;
  hash_source:=regexp_replace(
    regexp_replace(lower(normalize(cleaned_value,NFC)),U&'[\2018\2019\02BC\FF07]',chr(39),'g'),
    U&'[\2010-\2015\2212\FE58\FE63\FF0D]','-','g'
  );
  encoded_value:=convert_to(hash_source,'UTF8');
  if length(encoded_value)>0 then
    for byte_index in 0..length(encoded_value)-1 loop
      hash_value:=((hash_value # get_byte(encoded_value,byte_index)) * 16777619) % 4294967296;
    end loop;
  end if;
  hash_suffix:=lpad(to_hex(hash_value),8,'0');
  if normalize(cleaned_value,NFC)!~'^[A-Za-z0-9[:space:]]+$' then
    slug_value:=coalesce(nullif(slug_value,''),'u')||'-u-'||hash_suffix;
  end if;
  if char_length(slug_value)<=bounded_length then return slug_value; end if;
  if bounded_length<=8 then return left(hash_suffix,bounded_length); end if;
  return left(rtrim(left(slug_value,greatest(1,bounded_length-9)),'-')||'-'||hash_suffix,bounded_length);
end;
$function$;
revoke all on function private.market_family_option_slug_v2(text,integer)
  from public,anon,authenticated,service_role;

create or replace function private.market_family_cross_version_identity_v1(
  family_version_input text,
  family_key_input text,
  family_type_input text,
  family_child_key_input text,
  family_child_label_input text
)
returns text
language plpgsql
immutable
set search_path to ''
as $function$
declare child_key_value text;
begin
  if family_version_input not in ('atinara-market-family-v4','atinara-market-family-v5')
     or nullif(family_key_input,'') is null then return null; end if;
  child_key_value:=case when family_type_input in (
      'categorical_outcomes','participant_options','platform_variants'
    ) and nullif(family_child_label_input,'') is not null
    then 'option:'||private.market_family_option_slug_v2(family_child_label_input,120)
    else nullif(family_child_key_input,'') end;
  if child_key_value is null then return null; end if;
  return regexp_replace(family_key_input,'^atinara:v[45]:','atinara:vx:')
    ||':'||child_key_value;
end;
$function$;
alter function private.market_family_cross_version_identity_v1(text,text,text,text,text)
  owner to postgres;
revoke all on function private.market_family_cross_version_identity_v1(text,text,text,text,text)
  from public,anon,authenticated,service_role;

do $cross_version_preflight$
begin
  if exists (
    select 1 from private.market_drafts draft
    where draft.market_id is null and draft.workflow_status not in ('cancelled','annulled')
      and private.market_family_cross_version_identity_v1(
        draft.family_version,draft.family_key,draft.family_type,
        draft.family_child_key,draft.family_child_label
      ) is not null
    group by private.market_family_cross_version_identity_v1(
      draft.family_version,draft.family_key,draft.family_type,
      draft.family_child_key,draft.family_child_label
    ) having count(*)>1
  ) or exists (
    select 1 from public.markets market
    where private.market_family_cross_version_identity_v1(
      market.family_version,market.family_key,market.family_type,
      market.family_child_key,market.family_child_label
    ) is not null
    group by private.market_family_cross_version_identity_v1(
      market.family_version,market.family_key,market.family_type,
      market.family_child_key,market.family_child_label
    ) having count(*)>1
  ) or exists (
    select 1 from private.market_drafts draft
    join public.markets market on
      private.market_family_cross_version_identity_v1(
        draft.family_version,draft.family_key,draft.family_type,
        draft.family_child_key,draft.family_child_label
      )=private.market_family_cross_version_identity_v1(
        market.family_version,market.family_key,market.family_type,
        market.family_child_key,market.family_child_label
      )
    where draft.market_id is null and draft.workflow_status not in ('cancelled','annulled')
      and draft.market_slug is distinct from market.id
  ) then
    raise exception 'MARKET_FAMILY_CROSS_VERSION_DUPLICATE_PREFLIGHT'
      using errcode='23505';
  end if;
end;
$cross_version_preflight$;

create unique index market_drafts_cross_version_identity_v1_uidx
  on private.market_drafts((private.market_family_cross_version_identity_v1(
    family_version,family_key,family_type,family_child_key,family_child_label
  )))
  where market_id is null and workflow_status not in ('cancelled','annulled')
    and family_version in ('atinara-market-family-v4','atinara-market-family-v5')
    and family_key is not null and family_child_key is not null;
create unique index markets_cross_version_identity_v1_uidx
  on public.markets((private.market_family_cross_version_identity_v1(
    family_version,family_key,family_type,family_child_key,family_child_label
  )))
  where family_version in ('atinara-market-family-v4','atinara-market-family-v5')
    and family_key is not null and family_child_key is not null;

create or replace function private.guard_market_draft_cross_version_identity_v1()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare identity_value text;
begin
  if new.market_id is not null or new.workflow_status in ('cancelled','annulled') then return new; end if;
  identity_value:=private.market_family_cross_version_identity_v1(
    new.family_version,new.family_key,new.family_type,new.family_child_key,new.family_child_label
  );
  if identity_value is null then return new; end if;
  if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended(identity_value,0)) then
    raise exception 'MARKET_FAMILY_IDENTITY_BUSY' using errcode='40001';
  end if;
  if exists (
    select 1 from public.markets market
    where private.market_family_cross_version_identity_v1(
      market.family_version,market.family_key,market.family_type,
      market.family_child_key,market.family_child_label
    )=identity_value
  ) then raise exception 'RADAR_CONFIRMED_DUPLICATE' using errcode='23505'; end if;
  return new;
end;
$function$;
alter function private.guard_market_draft_cross_version_identity_v1() owner to postgres;
revoke all on function private.guard_market_draft_cross_version_identity_v1()
  from public,anon,authenticated,service_role;
create trigger zz_guard_market_draft_cross_version_identity_v1
before insert or update of family_version,family_key,family_type,family_child_key,
  family_child_label,workflow_status,market_id on private.market_drafts
for each row execute function private.guard_market_draft_cross_version_identity_v1();

create or replace function private.guard_public_market_cross_version_identity_v1()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare identity_value text;
begin
  identity_value:=private.market_family_cross_version_identity_v1(
    new.family_version,new.family_key,new.family_type,new.family_child_key,new.family_child_label
  );
  if identity_value is null then return new; end if;
  if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended(identity_value,0)) then
    raise exception 'MARKET_FAMILY_IDENTITY_BUSY' using errcode='40001';
  end if;
  if exists (
    select 1 from private.market_drafts draft
    where draft.market_id is null and draft.workflow_status not in ('cancelled','annulled')
      and draft.market_slug is distinct from new.id
      and private.market_family_cross_version_identity_v1(
        draft.family_version,draft.family_key,draft.family_type,
        draft.family_child_key,draft.family_child_label
      )=identity_value
  ) then raise exception 'RADAR_CONFIRMED_DUPLICATE' using errcode='23505'; end if;
  return new;
end;
$function$;
alter function private.guard_public_market_cross_version_identity_v1() owner to postgres;
revoke all on function private.guard_public_market_cross_version_identity_v1()
  from public,anon,authenticated,service_role;
create trigger zz_guard_public_market_cross_version_identity_v1
before insert or update of family_version,family_key,family_type,family_child_key,
  family_child_label on public.markets
for each row execute function private.guard_public_market_cross_version_identity_v1();

create or replace function private.market_candidate_blocking_duplicates(
  items_input jsonb,
  self_id_input uuid default null
)
returns jsonb
language sql
immutable
set search_path to ''
as $function$
  with filtered as (
    select item,ordinality,
      coalesce(nullif(item ->> 'id',''),md5(item::text)) identity_key
    from jsonb_array_elements(case when jsonb_typeof(items_input)='array'
      then items_input else '[]'::jsonb end) with ordinality elements(item,ordinality)
    where jsonb_typeof(item)='object'
      and (self_id_input is null or item ->> 'id' is distinct from self_id_input::text)
      and item ->> 'relationship'='exact_duplicate'
      and item ->> 'family_version' in ('atinara-market-family-v4','atinara-market-family-v5')
      and lower(coalesce(item ->> 'blocking','true')) not in ('false','0','no')
  ), unique_matches as (
    select distinct on(identity_key) item,ordinality
    from filtered order by identity_key,ordinality
  )
  select coalesce(jsonb_agg(item order by ordinality),'[]'::jsonb) from unique_matches;
$function$;

create or replace function private.market_candidate_sibling_matches(
  items_input jsonb,
  self_id_input uuid default null
)
returns jsonb
language sql
immutable
set search_path to ''
as $function$
  with filtered as (
    select item,ordinality,
      coalesce(nullif(item ->> 'id',''),md5(item::text)) identity_key,
      coalesce(item ->> 'family_child_key','') child_key
    from jsonb_array_elements(case when jsonb_typeof(items_input)='array'
      then items_input else '[]'::jsonb end) with ordinality elements(item,ordinality)
    where jsonb_typeof(item)='object'
      and (self_id_input is null or item ->> 'id' is distinct from self_id_input::text)
      and item ->> 'relationship'='sibling'
      and item ->> 'family_version' in ('atinara-market-family-v4','atinara-market-family-v5')
      and lower(coalesce(item ->> 'blocking','false')) in ('false','0','no')
  ), unique_matches as (
    select distinct on(identity_key,child_key) item,ordinality
    from filtered order by identity_key,child_key,ordinality
  )
  select coalesce(jsonb_agg(item order by ordinality),'[]'::jsonb) from unique_matches;
$function$;

create or replace function private.market_candidate_has_blocking_duplicate(
  items_input jsonb,
  self_id_input uuid default null
)
returns boolean
language sql
immutable
set search_path to ''
as $function$
  select jsonb_array_length(
    private.market_candidate_blocking_duplicates(items_input,self_id_input)
  )>0;
$function$;

alter function private.market_candidate_blocking_duplicates(jsonb,uuid) owner to postgres;
alter function private.market_candidate_sibling_matches(jsonb,uuid) owner to postgres;
alter function private.market_candidate_has_blocking_duplicate(jsonb,uuid) owner to postgres;
revoke all on function private.market_candidate_blocking_duplicates(jsonb,uuid)
  from public,anon,authenticated,service_role;
revoke all on function private.market_candidate_sibling_matches(jsonb,uuid)
  from public,anon,authenticated,service_role;
revoke all on function private.market_candidate_has_blocking_duplicate(jsonb,uuid)
  from public,anon,authenticated,service_role;

create or replace function private.market_radar_candidate_cross_version_identity_v1(
  candidate_input private.external_market_candidates
)
returns text
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  metadata_value jsonb;
  family_key_value text;
  child_key_value text;
begin
  if candidate_input.family_version='atinara-market-family-v4' then
    metadata_value:=private.market_family_metadata_v4(
      coalesce(candidate_input.normalized_payload ->> 'atinara_question',
        candidate_input.normalized_payload ->> 'source_question'),
      null,null,candidate_input.event_group_key,candidate_input.family_sort_at,
      coalesce(candidate_input.normalized_payload ->> 'timezone','UTC'),
      candidate_input.normalized_payload ->> 'source_resolution_rules',
      candidate_input.normalized_payload #>> '{provider_payload,yes_sub_title}'
    );
    family_key_value:=coalesce(candidate_input.family_key,metadata_value ->> 'family_key');
    child_key_value:=case when candidate_input.family_child_key like 'option:%'
        and candidate_input.family_child_label is not null
      then 'option:'||private.market_family_option_slug_v2(
        candidate_input.family_child_label,120
      )
      when metadata_value ->> 'family_type' in (
        'categorical_outcomes','participant_options','platform_variants'
      ) and nullif(metadata_value ->> 'family_child_label','') is not null
      then 'option:'||private.market_family_option_slug_v2(
        metadata_value ->> 'family_child_label',120
      ) else metadata_value ->> 'family_child_key' end;
  else
    family_key_value:=candidate_input.family_key;
    child_key_value:=case when candidate_input.family_type in (
        'categorical_outcomes','participant_options','platform_variants'
      ) and candidate_input.family_child_label is not null
      then 'option:'||private.market_family_option_slug_v2(
        candidate_input.family_child_label,120
      ) else candidate_input.family_child_key end;
  end if;
  if family_key_value is null or child_key_value is null then return null; end if;
  return regexp_replace(family_key_value,'^atinara:v[45]:','atinara:vx:')
    ||':'||child_key_value;
end;
$function$;
alter function private.market_radar_candidate_cross_version_identity_v1(
  private.external_market_candidates
) owner to postgres;
revoke all on function private.market_radar_candidate_cross_version_identity_v1(
  private.external_market_candidates
) from public,anon,authenticated,service_role;

create or replace function private.market_radar_candidate_live_duplicates_v1(
  candidate_input private.external_market_candidates
)
returns jsonb
language sql
stable
security definer
set search_path to ''
as $function$
  with target as materialized (
    select private.market_radar_candidate_cross_version_identity_v1(candidate_input) as identity_key
  ), draft_projection as (
    select draft.id,draft.question,draft.radar_candidate_id,draft.family_key,draft.family_child_key,
      draft.family_child_label,draft.family_version,
      private.market_family_metadata_v4(
        draft.question,null,draft.subject,
        coalesce(draft.source_provenance ->> 'event_group_key',draft.family_source_event_key),
        draft.evaluation_ends_at,draft.timezone,
        concat_ws(' ',draft.yes_criteria,draft.no_criteria,draft.edge_cases),null
      ) as derived,
      origin.provider as origin_provider,origin.external_id as origin_external_id,
      private.market_radar_candidate_cross_version_identity_v1(origin) as origin_identity
    from private.market_drafts draft
    left join private.external_market_candidates origin on origin.id=draft.radar_candidate_id
    where draft.market_id is null
      and draft.workflow_status not in ('cancelled','annulled')
      and not (
        draft.radar_candidate_id is not distinct from candidate_input.id
        or (draft.intelligence_origin_type='radar_candidate'
          and draft.intelligence_origin_id=candidate_input.id::text)
      )
  ), market_projection as (
    select market.id,market.question,market.family_key,market.family_child_key,
      market.family_child_label,market.family_version,
      private.market_family_metadata_v4(
        market.question,null,null,market.family_source_event_key,
        market.evaluation_ends_at,market.evaluation_timezone,null,null
      ) as derived,
      origin.provider as origin_provider,origin.external_id as origin_external_id,
      private.market_radar_candidate_cross_version_identity_v1(origin) as origin_identity
    from public.markets market
    left join private.market_drafts origin_draft
      on origin_draft.market_id=market.id or origin_draft.market_slug=market.id
    left join private.external_market_candidates origin on origin.id=origin_draft.radar_candidate_id
    where not exists (
      select 1 from private.market_drafts own_draft
      where own_draft.id=candidate_input.prepared_draft_id
        and (own_draft.market_id=market.id or own_draft.market_slug=market.id)
    )
  ), draft_identity as (
    select draft.*,coalesce(draft.origin_identity,
      regexp_replace(coalesce(draft.family_key,draft.derived ->> 'family_key'),
        '^atinara:v[45]:','atinara:vx:')||':'||
      (case when draft.family_version='atinara-market-family-v4'
          and draft.family_child_key like 'option:%'
          and draft.family_child_label is not null
        then 'option:'||private.market_family_option_slug_v2(draft.family_child_label,120)
        when draft.family_version='atinara-market-family-v4'
          and draft.derived ->> 'family_type' in (
            'categorical_outcomes','participant_options','platform_variants'
          ) and nullif(draft.derived ->> 'family_child_label','') is not null
        then 'option:'||private.market_family_option_slug_v2(
          draft.derived ->> 'family_child_label',120
        )
        when draft.family_version='atinara-market-family-v4'
          then draft.derived ->> 'family_child_key'
        else draft.family_child_key end)) as identity_key
    from draft_projection draft
  ), market_identity as (
    select market.*,coalesce(market.origin_identity,
      regexp_replace(coalesce(market.family_key,market.derived ->> 'family_key'),
        '^atinara:v[45]:','atinara:vx:')||':'||
      (case when market.family_version='atinara-market-family-v4'
          and market.family_child_key like 'option:%'
          and market.family_child_label is not null
        then 'option:'||private.market_family_option_slug_v2(market.family_child_label,120)
        when market.family_version='atinara-market-family-v4'
          and market.derived ->> 'family_type' in (
            'categorical_outcomes','participant_options','platform_variants'
          ) and nullif(market.derived ->> 'family_child_label','') is not null
        then 'option:'||private.market_family_option_slug_v2(
          market.derived ->> 'family_child_label',120
        )
        when market.family_version='atinara-market-family-v4'
          then market.derived ->> 'family_child_key'
        else market.family_child_key end)) as identity_key
    from market_projection market
  ), matches as (
    select 'draft'::text as kind,draft.id::text as id,jsonb_build_object(
      'id',draft.id,'kind','draft','question',draft.question,
      'relationship','exact_duplicate','blocking',true,
      'family_version','atinara-market-family-v5',
      'family_key',candidate_input.family_key,
      'family_child_key',candidate_input.family_child_key
    ) as item from draft_identity draft cross join target
    where (draft.origin_provider,draft.origin_external_id)
        is not distinct from (candidate_input.provider,candidate_input.external_id)
      or (target.identity_key is not null and draft.identity_key=target.identity_key)
    union all
    select 'market'::text as kind,market.id::text as id,jsonb_build_object(
      'id',market.id,'kind','market','question',market.question,
      'relationship','exact_duplicate','blocking',true,
      'family_version','atinara-market-family-v5',
      'family_key',candidate_input.family_key,
      'family_child_key',candidate_input.family_child_key
    ) as item from market_identity market cross join target
    where (market.origin_provider,market.origin_external_id)
        is not distinct from (candidate_input.provider,candidate_input.external_id)
      or (target.identity_key is not null and market.identity_key=target.identity_key)
  )
  select coalesce(jsonb_agg(item order by kind,id),'[]'::jsonb)
  from (
    select distinct on(kind,id) kind,id,item from matches
    order by kind,id limit 12
  ) bounded;
$function$;
alter function private.market_radar_candidate_live_duplicates_v1(
  private.external_market_candidates
) owner to postgres;
revoke all on function private.market_radar_candidate_live_duplicates_v1(
  private.external_market_candidates
) from public,anon,authenticated,service_role;

create or replace function private.market_radar_candidate_has_live_duplicate_v1(
  candidate_input private.external_market_candidates
)
returns boolean
language sql
stable
security definer
set search_path to ''
as $function$
  select jsonb_array_length(
    private.market_radar_candidate_live_duplicates_v1(candidate_input)
  )>0;
$function$;
alter function private.market_radar_candidate_has_live_duplicate_v1(
  private.external_market_candidates
) owner to postgres;
revoke all on function private.market_radar_candidate_has_live_duplicate_v1(
  private.external_market_candidates
) from public,anon,authenticated,service_role;

-- Forward definitions: los writers PL/pgSQL siguientes las resuelven también
-- con check_function_bodies estricto durante la aplicación remota.
create or replace function private.market_workflow_issue_deterministic_v1(issue_input jsonb)
returns jsonb language plpgsql immutable set search_path to '' as $function$
declare
  fingerprint_value text:=lower(coalesce(issue_input ->> 'fingerprint',''));
  issue_id_value uuid;
begin
  if jsonb_typeof(issue_input)<>'object' or fingerprint_value!~'^[a-f0-9]{64}$' then
    raise exception 'MARKET_WORKFLOW_ISSUE_FINGERPRINT_INVALID' using errcode='22023';
  end if;
  issue_id_value:=(substr(fingerprint_value,1,8)||'-'||substr(fingerprint_value,9,4)
    ||'-4'||substr(fingerprint_value,14,3)||'-8'||substr(fingerprint_value,18,3)
    ||'-'||substr(fingerprint_value,21,12))::uuid;
  return issue_input||jsonb_build_object('issue_id',issue_id_value);
end;
$function$;
alter function private.market_workflow_issue_deterministic_v1(jsonb) owner to postgres;
revoke all on function private.market_workflow_issue_deterministic_v1(jsonb)
  from public,anon,authenticated,service_role;

create or replace function private.market_workflow_issue_array_replace_v1(
  existing_input jsonb,issue_input jsonb
)
returns jsonb language plpgsql immutable set search_path to '' as $function$
declare result_value jsonb;
begin
  if jsonb_typeof(issue_input)<>'object' or nullif(issue_input ->> 'issue_code','') is null then
    return case when jsonb_typeof(existing_input)='array' then existing_input else '[]'::jsonb end;
  end if;
  issue_input:=private.market_workflow_issue_deterministic_v1(issue_input);
  if jsonb_typeof(existing_input)='array' and exists (
    select 1 from jsonb_array_elements(existing_input) existing
    where existing ->> 'issue_code'=issue_input ->> 'issue_code'
      and existing ->> 'fingerprint'=issue_input ->> 'fingerprint'
  ) then return existing_input; end if;
  select coalesce(jsonb_agg(issue order by ordinality),'[]'::jsonb) into result_value
  from (select issue,ordinality from jsonb_array_elements(case
    when jsonb_typeof(existing_input)='array' then existing_input else '[]'::jsonb end
  ) with ordinality items(issue,ordinality)
  where issue ->> 'issue_code'<>issue_input ->> 'issue_code'
  order by ordinality limit 39) bounded;
  return result_value||jsonb_build_array(issue_input);
end;
$function$;
alter function private.market_workflow_issue_array_replace_v1(jsonb,jsonb) owner to postgres;
revoke all on function private.market_workflow_issue_array_replace_v1(jsonb,jsonb)
  from public,anon,authenticated,service_role;

create or replace function private.persist_market_radar_live_duplicate_v1(
  candidate_id_input uuid,
  eligibility_checked_at_input timestamptz,
  eligibility_check_input jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  candidate private.external_market_candidates%rowtype;
  check_row private.market_radar_eligibility_checks%rowtype;
  attempt_id_value uuid;
  expires_at_value timestamptz;
  matches_value jsonb;
  decision_hash_value text;
  issue_value jsonb;
  workflow_issues_value jsonb;
  issue_link record;
  duplicate_terminal boolean;
begin
  select * into candidate from private.external_market_candidates candidate_alias
  where candidate_alias.id=candidate_id_input for update;
  if not found then raise exception 'RADAR_CANDIDATE_NOT_FOUND' using errcode='P0001'; end if;
  matches_value:=private.market_radar_candidate_live_duplicates_v1(candidate);
  if jsonb_array_length(matches_value)=0 then
    raise exception 'RADAR_LIVE_DUPLICATE_NOT_FOUND' using errcode='40001';
  end if;
  duplicate_terminal:=exists (
    select 1 from jsonb_array_elements(matches_value) match
    where match ->> 'kind'='market'
  );
  begin
    attempt_id_value:=(eligibility_check_input ->> 'attempt_id')::uuid;
    expires_at_value:=(eligibility_check_input ->> 'expires_at')::timestamptz;
  exception when invalid_text_representation or datetime_field_overflow then
    raise exception 'INVALID_RADAR_ELIGIBILITY_DATE' using errcode='22007';
  end;
  if expires_at_value<=eligibility_checked_at_input then
    raise exception 'INVALID_RADAR_ELIGIBILITY' using errcode='22023';
  end if;
  decision_hash_value:=encode(extensions.digest(convert_to(
    candidate.id::text||'|'||attempt_id_value::text||'|live-duplicate|'||matches_value::text,
    'UTF8'
  ),'sha256'),'hex');
  select * into check_row from private.market_radar_eligibility_checks check_alias
  where check_alias.attempt_id=attempt_id_value;
  if found then
    if check_row.candidate_id is distinct from candidate.id
       or check_row.status<>'duplicate'
       or check_row.decision_hash<>decision_hash_value then
      raise exception 'RADAR_ELIGIBILITY_IDEMPOTENCY_CONFLICT' using errcode='40001';
    end if;
    return jsonb_build_object(
      'ok',false,'error','RADAR_CONFIRMED_DUPLICATE','persisted',true,
      'idempotent',true,'candidate',private.market_radar_eligibility_payload(candidate)
    );
  end if;
  insert into private.market_radar_eligibility_checks(
    attempt_id,candidate_id,provider,external_id,event_group_key,policy_version,
    status,reason_code,reason,evidence,checked_at,expires_at,decision_hash
  ) values (
    attempt_id_value,candidate.id,candidate.provider,candidate.external_id,
    candidate.event_group_key,'atinara-prediction-policy-v5','duplicate',
    'DUPLICATE_MARKET','Existe un mercado o borrador exacto vigente.',matches_value,
    eligibility_checked_at_input,expires_at_value,decision_hash_value
  ) returning * into check_row;
  issue_value:=private.market_workflow_server_issue_v1(
    'RADAR_CONFIRMED_DUPLICATE','radar','radar',
    case when duplicate_terminal then 'terminal' else 'auto_recoverable' end,
    case when duplicate_terminal then 'terminal' else 'approval' end,
    case when duplicate_terminal then 'archive_terminal_candidate'
      else 'refresh_draft_eligibility' end,jsonb_build_object(
      'candidate_id',candidate.id,'family_key',candidate.family_key,
      'family_child_key',candidate.family_child_key,'matches',matches_value
    ),not duplicate_terminal,'atinara-market-family-v5'
  );
  issue_value:=private.market_workflow_issue_deterministic_v1(issue_value);
  select coalesce(jsonb_agg(issue order by ordinality),'[]'::jsonb) into workflow_issues_value
  from (
    select issue,ordinality from jsonb_array_elements(case
      when jsonb_typeof(candidate.normalized_payload -> 'workflow_issues')='array'
        then candidate.normalized_payload -> 'workflow_issues' else '[]'::jsonb end
    ) with ordinality items(issue,ordinality)
    where issue ->> 'issue_code'<>'RADAR_CONFIRMED_DUPLICATE'
    order by ordinality limit 39
  ) bounded_issues;
  workflow_issues_value:=workflow_issues_value||jsonb_build_array(issue_value);
  update private.external_market_candidates candidate_alias set
    duplicate_matches=matches_value,
    state='rejected',
    verification_status='rejected_duplicate',
    verification_reason_code='DUPLICATE_MARKET',
    verification_reason='Existe un mercado o borrador exacto vigente.',
    verification_evidence=matches_value,
    verification_confidence=100,
    verified_at=eligibility_checked_at_input,
    verification_expires_at=expires_at_value,
    current_eligibility_check_id=check_row.id,
    eligibility_status='duplicate',
    eligibility_reason_code='DUPLICATE_MARKET',
    eligibility_reason='Existe un mercado o borrador exacto vigente.',
    eligibility_evidence=matches_value,
    eligibility_checked_at=eligibility_checked_at_input,
    eligibility_expires_at=expires_at_value,
    eligibility_policy_version='atinara-prediction-policy-v5',
    normalized_payload=candidate_alias.normalized_payload||jsonb_strip_nulls(jsonb_build_object(
      'duplicate_matches',matches_value,'state','rejected',
      'verification_status','rejected_duplicate','verification_reason_code','DUPLICATE_MARKET',
      'verification_reason','Existe un mercado o borrador exacto vigente.',
      'verification_evidence',matches_value,'verification_confidence',100,
      'verified_at',eligibility_checked_at_input,'verification_expires_at',expires_at_value,
      'current_eligibility_check_id',check_row.id,'eligibility_status','duplicate',
      'eligibility_reason_code','DUPLICATE_MARKET',
      'eligibility_reason','Existe un mercado o borrador exacto vigente.',
      'eligibility_evidence',matches_value,'eligibility_checked_at',eligibility_checked_at_input,
      'eligibility_expires_at',expires_at_value,
      'eligibility_policy_version','atinara-prediction-policy-v5',
      'workflow_issues',workflow_issues_value
    )),updated_at=clock_timestamp()
  where candidate_alias.id=candidate.id;
  for issue_link in
    select draft.id as draft_id,draft.content_version,draft.content_fingerprint
    from private.market_drafts draft
    where draft.workflow_status not in ('cancelled','annulled') and (
      draft.radar_candidate_id=candidate.id or (
        draft.intelligence_origin_type='radar_candidate'
        and draft.intelligence_origin_id=candidate.id::text
      )
    )
  loop
    perform private.record_market_workflow_issue_v1(
      'market_draft',issue_link.draft_id::text,issue_link.content_version::text,
      case when issue_link.content_fingerprint~'^[a-f0-9]{64}$'
        then issue_link.content_fingerprint else null end,
      issue_value,null,null
    );
    perform private.project_market_draft_workflow_state_v2(
      issue_link.draft_id,issue_link.content_version
    );
  end loop;
  select * into candidate from private.external_market_candidates candidate_alias
  where candidate_alias.id=candidate_id_input;
  return jsonb_build_object(
    'ok',false,'error','RADAR_CONFIRMED_DUPLICATE','persisted',true,
    'idempotent',false,'eligibility_check_id',check_row.id,
    'issue_id',issue_value ->> 'issue_id',
    'candidate',private.market_radar_eligibility_payload(candidate)
  );
end;
$function$;
alter function private.persist_market_radar_live_duplicate_v1(uuid,timestamptz,jsonb)
  owner to postgres;
revoke all on function private.persist_market_radar_live_duplicate_v1(uuid,timestamptz,jsonb)
  from public,anon,authenticated,service_role;

create or replace function private.clear_market_radar_live_duplicate_v1(
  candidate_id_input uuid,
  eligibility_checked_at_input timestamptz,
  eligibility_input jsonb
)
returns private.external_market_candidates
language plpgsql
security definer
set search_path to ''
as $function$
declare
  candidate private.external_market_candidates%rowtype;
  workflow_issues_value jsonb;
  prior_issue record;
  draft_state record;
  recovery_state_value text;
begin
  select * into candidate from private.external_market_candidates candidate_alias
  where candidate_alias.id=candidate_id_input for update;
  if not found then raise exception 'RADAR_CANDIDATE_NOT_FOUND' using errcode='P0001'; end if;
  if (candidate.prepared_draft_id is null and not exists (
       select 1 from private.market_drafts draft
       where draft.workflow_status not in ('cancelled','annulled') and (
         draft.radar_candidate_id=candidate.id or (
           draft.intelligence_origin_type='radar_candidate'
           and draft.intelligence_origin_id=candidate.id::text
         )
       )
     ))
     or candidate.verification_status<>'rejected_duplicate'
     or candidate.eligibility_status<>'duplicate'
     or eligibility_input ->> 'eligibility_status'<>'eligible'
     or eligibility_input ->> 'verification_status'<>'verified_open'
     or private.market_radar_candidate_has_live_duplicate_v1(candidate) then
    raise exception 'RADAR_LIVE_DUPLICATE_RECOVERY_INVALID' using errcode='40001';
  end if;
  recovery_state_value:=case when candidate.prepared_draft_id is not null
    then 'prepared' else 'available' end;
  select coalesce(jsonb_agg(issue order by ordinality),'[]'::jsonb)
  into workflow_issues_value
  from jsonb_array_elements(case
    when jsonb_typeof(candidate.normalized_payload -> 'workflow_issues')='array'
      then candidate.normalized_payload -> 'workflow_issues' else '[]'::jsonb end
  ) with ordinality items(issue,ordinality)
  where issue ->> 'issue_code'<>'RADAR_CONFIRMED_DUPLICATE';
  update private.external_market_candidates candidate_alias set
    duplicate_matches='[]'::jsonb,state=recovery_state_value,
    verification_status='verified_open',
    verification_reason_code=nullif(eligibility_input ->> 'verification_reason_code',''),
    verification_reason=nullif(eligibility_input ->> 'verification_reason',''),
    verification_evidence=coalesce(eligibility_input -> 'verification_evidence','[]'::jsonb),
    verification_confidence=coalesce(nullif(eligibility_input ->> 'verification_confidence','')::numeric,100),
    verified_at=eligibility_checked_at_input,
    verification_expires_at=nullif(eligibility_input ->> 'verification_expires_at','')::timestamptz,
    eligibility_status='eligible',eligibility_reason_code=null,
    eligibility_reason=nullif(eligibility_input ->> 'eligibility_reason',''),
    eligibility_evidence=coalesce(eligibility_input -> 'eligibility_evidence','[]'::jsonb),
    eligibility_checked_at=eligibility_checked_at_input,
    eligibility_expires_at=nullif(eligibility_input ->> 'eligibility_expires_at','')::timestamptz,
    eligibility_policy_version='atinara-prediction-policy-v5',
    normalized_payload=candidate_alias.normalized_payload||jsonb_build_object(
      'duplicate_matches','[]'::jsonb,'state',recovery_state_value,
      'verification_status','verified_open',
      'verification_reason_code',eligibility_input -> 'verification_reason_code',
      'verification_reason',eligibility_input -> 'verification_reason',
      'verification_evidence',coalesce(eligibility_input -> 'verification_evidence','[]'::jsonb),
      'verification_confidence',coalesce(eligibility_input -> 'verification_confidence','100'::jsonb),
      'verified_at',eligibility_checked_at_input,
      'verification_expires_at',eligibility_input -> 'verification_expires_at',
      'eligibility_status','eligible','eligibility_reason_code',null,
      'eligibility_reason',eligibility_input -> 'eligibility_reason',
      'eligibility_evidence',coalesce(eligibility_input -> 'eligibility_evidence','[]'::jsonb),
      'eligibility_checked_at',eligibility_checked_at_input,
      'eligibility_expires_at',eligibility_input -> 'eligibility_expires_at',
      'eligibility_policy_version','atinara-prediction-policy-v5',
      'workflow_issues',workflow_issues_value
    ),updated_at=clock_timestamp()
  where candidate_alias.id=candidate.id;
  for prior_issue in
    select occurrence.issue_id,coalesce(latest.new_status,occurrence.status) as current_status
    from private.market_workflow_issue_occurrences_v1 occurrence
    join private.market_workflow_issue_subject_links_v1 link on link.issue_id=occurrence.issue_id
    left join lateral (
      select event.new_status from private.market_workflow_issue_events_v1 event
      where event.issue_id=occurrence.issue_id order by event.occurred_at desc,event.id desc limit 1
    ) latest on true
    where link.subject_type='radar_candidate' and link.subject_key=candidate.id::text
      and occurrence.issue_code='RADAR_CONFIRMED_DUPLICATE'
      and coalesce(latest.new_status,occurrence.status) not in ('resolved','superseded')
  loop
    insert into private.market_workflow_issue_events_v1(
      issue_id,event_type,previous_status,new_status,owner_stage,next_action,
      resolution_method,evidence_refs,occurred_at
    ) values (
      prior_issue.issue_id,'resolved',prior_issue.current_status,'resolved','radar',
      'refresh_draft_eligibility','live_duplicate_no_longer_present',
      jsonb_build_array(jsonb_build_object(
        'candidate_id',candidate.id,'checked_at',eligibility_checked_at_input
      )),clock_timestamp()
    );
  end loop;
  for draft_state in
    select draft.id,draft.content_version
    from private.market_drafts draft
    where draft.workflow_status not in ('cancelled','annulled') and (
      draft.radar_candidate_id=candidate.id or (
        draft.intelligence_origin_type='radar_candidate'
        and draft.intelligence_origin_id=candidate.id::text
      )
    ) for update of draft
  loop
    perform private.project_market_draft_workflow_state_v2(
      draft_state.id,draft_state.content_version
    );
  end loop;
  select * into candidate from private.external_market_candidates candidate_alias
  where candidate_alias.id=candidate_id_input;
  return candidate;
exception when invalid_text_representation or datetime_field_overflow then
  raise exception 'RADAR_LIVE_DUPLICATE_RECOVERY_INVALID' using errcode='22007';
end;
$function$;
alter function private.clear_market_radar_live_duplicate_v1(uuid,timestamptz,jsonb)
  owner to postgres;
revoke all on function private.clear_market_radar_live_duplicate_v1(uuid,timestamptz,jsonb)
  from public,anon,authenticated,service_role;

create or replace function private.project_market_draft_workflow_state_v2(
  draft_id_input uuid,
  content_version_input bigint
)
returns private.market_drafts
language plpgsql
security definer
set search_path to ''
as $function$
declare
  draft private.market_drafts%rowtype;
  initial_draft private.market_drafts%rowtype;
  candidate_lock private.external_market_candidates%rowtype;
  candidate_lock_id uuid;
  active_issues jsonb;
  first_issue jsonb;
begin
  select * into draft from private.market_drafts draft_alias
  where draft_alias.id=draft_id_input for update;
  if not found or draft.content_version is distinct from content_version_input then
    raise exception 'DRAFT_VERSION_MOVED' using errcode='40001';
  end if;
  select coalesce(jsonb_agg(issue order by
    case when issue ->> 'blocking_scope'='terminal'
      or issue ->> 'repairability'='terminal' then 0
      when issue ->> 'blocking_scope' in ('approval','human_confirmation','publication') then 1
      else 2 end,
    case issue ->> 'severity' when 'blocking' then 0 when 'warning' then 1 else 2 end,
    issue ->> 'created_at',issue ->> 'issue_id'),'[]'::jsonb)
  into active_issues
  from jsonb_array_elements(public.get_market_workflow_issues_v1(
    'market_draft',draft.id::text,draft.content_version::text
  )) issue
  where issue ->> 'status' not in ('resolved','superseded');
  select issue into first_issue
  from jsonb_array_elements(active_issues) issue
  where issue ->> 'blocking_scope' in (
    'approval','human_confirmation','publication','terminal'
  ) or issue ->> 'repairability'='terminal'
  order by case when issue ->> 'blocking_scope'='terminal'
      or issue ->> 'repairability'='terminal' then 0 else 1 end,
    case issue ->> 'severity' when 'blocking' then 0 when 'warning' then 1 else 2 end,
    issue ->> 'created_at',issue ->> 'issue_id'
  limit 1;
  update private.market_drafts draft_alias set
    artifact_status=case
      when first_issue is not null and (first_issue ->> 'blocking_scope'='terminal'
        or first_issue ->> 'repairability'='terminal') then 'review_rejected_terminal'
      when first_issue is not null and draft_alias.workflow_status in (
        'review_approved','human_confirmed','scheduled'
      ) then 'publication_revalidation_required'
      when first_issue is not null
        and first_issue ->> 'repairability'='waiting_authoritative_source'
        then 'draft_waiting_authoritative_source'
      when first_issue is not null then 'draft_with_repairable_issues'
      when draft_alias.workflow_status='published' then 'published'
      when draft_alias.workflow_status='scheduled' then 'scheduled'
      when draft_alias.workflow_status='human_confirmed' then 'human_confirmed'
      when draft_alias.workflow_status='review_approved' then 'review_approved'
      else 'draft_ready_for_validation' end,
    workflow_owner_stage=case
      when first_issue is not null then coalesce(first_issue ->> 'owner_stage','validator')
      when draft_alias.workflow_status='published' then null
      when draft_alias.workflow_status in ('scheduled','human_confirmed') then 'publication_gate'
      when draft_alias.workflow_status='review_approved' then 'human_review'
      else 'validator' end,
    workflow_next_action=case
      when first_issue is not null then coalesce(first_issue ->> 'next_action','request_market_validation')
      when draft_alias.workflow_status='published' then null
      when draft_alias.workflow_status='scheduled' then 'wait_for_scheduled_publication'
      when draft_alias.workflow_status='human_confirmed' then 'revalidate_and_publish'
      when draft_alias.workflow_status='review_approved' then 'confirm_market_draft'
      else 'request_market_validation' end,
    workflow_issue_count=jsonb_array_length(active_issues),updated_at=clock_timestamp()
  where draft_alias.id=draft.id and draft_alias.content_version=draft.content_version
  returning * into draft;
  return draft;
end;
$function$;
alter function private.project_market_draft_workflow_state_v2(uuid,bigint) owner to postgres;
revoke all on function private.project_market_draft_workflow_state_v2(uuid,bigint)
  from public,anon,authenticated,service_role;

create or replace function private.sync_market_radar_revalidation_issues_v1(
  candidate_id_input uuid,
  eligibility_input jsonb
)
returns private.external_market_candidates
language plpgsql
security definer
set search_path to ''
as $function$
declare
  candidate private.external_market_candidates%rowtype;
  issues_value jsonb;
  prior_issue record;
  issue_link record;
  draft_state record;
begin
  select * into candidate from private.external_market_candidates candidate_alias
  where candidate_alias.id=candidate_id_input for update;
  if not found then raise exception 'RADAR_CANDIDATE_NOT_FOUND' using errcode='P0001'; end if;
  if candidate.eligibility_status is distinct from eligibility_input ->> 'eligibility_status' then
    return candidate;
  end if;
  issues_value:=eligibility_input -> 'workflow_issues';
  if jsonb_typeof(issues_value)<>'array' or jsonb_array_length(issues_value)>40 then
    raise exception 'MARKET_WORKFLOW_ISSUES_INVALID' using errcode='22023';
  end if;
  select coalesce(jsonb_agg(
    private.market_workflow_issue_deterministic_v1(issue)
    order by issue ->> 'fingerprint'
  ),'[]'::jsonb) into issues_value
  from jsonb_array_elements(issues_value) issue;
  select coalesce(jsonb_agg(coalesce(existing.issue,new_issue.issue)
    order by new_issue.issue ->> 'fingerprint'),'[]'::jsonb)
  into issues_value
  from jsonb_array_elements(issues_value) new_issue(issue)
  left join lateral (
    select old_issue.value as issue
    from jsonb_array_elements(case
      when jsonb_typeof(candidate.normalized_payload -> 'workflow_issues')='array'
        then candidate.normalized_payload -> 'workflow_issues' else '[]'::jsonb end
    ) old_issue(value)
    where old_issue.value ->> 'issue_code'=new_issue.issue ->> 'issue_code'
      and old_issue.value ->> 'fingerprint'=new_issue.issue ->> 'fingerprint'
    limit 1
  ) existing on true;
  if candidate.normalized_payload -> 'workflow_issues' is distinct from issues_value then
    update private.external_market_candidates candidate_alias set
      normalized_payload=jsonb_set(
        coalesce(candidate_alias.normalized_payload,'{}'::jsonb),
        '{workflow_issues}',issues_value,true
      ),updated_at=clock_timestamp()
    where candidate_alias.id=candidate.id;
  end if;
  for issue_link in
    select draft.id as draft_id,draft.content_version,draft.content_fingerprint,
      issue.value as issue
    from private.market_drafts draft
    cross join lateral jsonb_array_elements(issues_value) issue(value)
    where draft.workflow_status not in ('cancelled','annulled') and (
      draft.radar_candidate_id=candidate.id or (
        draft.intelligence_origin_type='radar_candidate'
        and draft.intelligence_origin_id=candidate.id::text
      )
    )
  loop
    perform private.record_market_workflow_issue_v1(
      'market_draft',issue_link.draft_id::text,issue_link.content_version::text,
      case when issue_link.content_fingerprint~'^[a-f0-9]{64}$'
        then issue_link.content_fingerprint else null end,
      issue_link.issue,null,null
    );
    perform private.project_market_draft_workflow_state_v2(
      issue_link.draft_id,issue_link.content_version
    );
  end loop;
  for prior_issue in
      select occurrence.issue_id,occurrence.issue_code,
        coalesce(latest.new_status,occurrence.status) as current_status
      from private.market_workflow_issue_occurrences_v1 occurrence
      join private.market_workflow_issue_subject_links_v1 link on link.issue_id=occurrence.issue_id
      left join lateral (
        select event.new_status from private.market_workflow_issue_events_v1 event
        where event.issue_id=occurrence.issue_id order by event.occurred_at desc,event.id desc limit 1
      ) latest on true
      where link.subject_type='radar_candidate' and link.subject_key=candidate.id::text
        and (occurrence.issue_code in (
          'SOURCE_STALE','SUBJECT_NOT_ANNOUNCED','GAMING_DOMAIN_REVIEW_REQUIRED',
          'PROVIDER_NOT_OPEN','PROVIDER_OPTION_INACTIVE','PROVIDER_EVENT_NOT_FOUND',
          'PROVIDER_CHILD_NOT_FOUND','INVALID_OR_UNVERIFIED_SOURCE',
          'RESOLUTION_SOURCE_AUTHORITY_PENDING','OFFICIAL_TERMINAL_SCAN_UNAVAILABLE',
          'OFFICIAL_SELECTION_RECHECK_REQUIRED','VERIFICATION_REQUIRED','VERIFICATION_EXPIRED',
          'TEMPORAL_INCOHERENCE','RADAR_PARENT_RECONCILIATION_INCOMPLETE',
          'PROVIDER_CHILD_IDENTITY_RESOLUTION_REQUIRED','PROVIDER_PARENT_COUNT_INCONSISTENT',
          'RADAR_CANDIDATE_IDENTITY_STALE'
        ) or occurrence.issue_code like 'TEMPORAL\_%' escape '\')
        and coalesce(latest.new_status,occurrence.status) not in ('resolved','superseded')
        and not exists (
          select 1 from jsonb_array_elements(issues_value) issue
          where issue ->> 'issue_code'=occurrence.issue_code
        )
        and not exists (
          select 1
          from private.market_workflow_issue_subject_links_v1 draft_link
          join private.market_drafts linked_draft
            on linked_draft.id::text=draft_link.subject_key
          where draft_link.issue_id=occurrence.issue_id
            and draft_link.subject_type='market_draft'
            and linked_draft.workflow_status not in ('cancelled','annulled','published')
        )
    loop
      insert into private.market_workflow_issue_events_v1(
        issue_id,event_type,previous_status,new_status,owner_stage,next_action,
        resolution_method,evidence_refs,occurred_at
      ) values (
        prior_issue.issue_id,
        case when eligibility_input ->> 'eligibility_status'='eligible' then 'resolved' else 'superseded' end,
        prior_issue.current_status,
        case when eligibility_input ->> 'eligibility_status'='eligible' then 'resolved' else 'superseded' end,
        'radar','refresh_draft_eligibility',
        case when eligibility_input ->> 'eligibility_status'='eligible'
          then 'provider_revalidation_recovered' else 'provider_revalidation_cause_changed' end,
        jsonb_build_array(jsonb_build_object('candidate_id',candidate.id)),clock_timestamp()
      );
  end loop;
  for draft_state in
    select draft.id,draft.content_version
    from private.market_drafts draft
    where draft.workflow_status not in ('cancelled','annulled') and (
      draft.radar_candidate_id=candidate.id or (
        draft.intelligence_origin_type='radar_candidate'
        and draft.intelligence_origin_id=candidate.id::text
      )
    )
    for update of draft
  loop
    perform private.project_market_draft_workflow_state_v2(
      draft_state.id,draft_state.content_version
    );
  end loop;
  select * into candidate from private.external_market_candidates candidate_alias
  where candidate_alias.id=candidate_id_input;
  return candidate;
end;
$function$;
alter function private.sync_market_radar_revalidation_issues_v1(uuid,jsonb) owner to postgres;
revoke all on function private.sync_market_radar_revalidation_issues_v1(uuid,jsonb)
  from public,anon,authenticated,service_role;

create or replace function private.market_family_text_contains_label_v2(
  text_input text,
  label_input text
)
returns boolean
language plpgsql
immutable
set search_path to ''
as $function$
declare
  text_value text;
  label_value text;
  search_offset integer:=1;
  relative_position integer;
  match_position integer;
  before_character text;
  after_character text;
begin
  text_value:=regexp_replace(lower(normalize(regexp_replace(
    regexp_replace(coalesce(text_input,''),'[[:cntrl:]]',' ','g'),
    '[[:space:]]+',' ','g'
  ),NFC)),U&'[\2018\2019\02BC\FF07]',chr(39),'g');
  text_value:=regexp_replace(text_value,U&'[\2010-\2015\2212\FE58\FE63\FF0D]','-','g');
  label_value:=regexp_replace(lower(normalize(regexp_replace(
    regexp_replace(coalesce(label_input,''),'[[:cntrl:]]',' ','g'),
    '[[:space:]]+',' ','g'
  ),NFC)),U&'[\2018\2019\02BC\FF07]',chr(39),'g');
  label_value:=regexp_replace(label_value,U&'[\2010-\2015\2212\FE58\FE63\FF0D]','-','g');
  text_value:=btrim(text_value);
  label_value:=btrim(label_value);
  if length(label_value)=0 or length(text_value)=0 then return false; end if;
  loop
    relative_position:=strpos(substr(text_value,search_offset),label_value);
    if relative_position=0 then return false; end if;
    match_position:=search_offset+relative_position-1;
    before_character:=case when match_position=1 then ''
      else substr(text_value,match_position-1,1) end;
    after_character:=substr(text_value,match_position+char_length(label_value),1);
    if (length(before_character)=0 or before_character!~'[[:alnum:]]')
       and (length(after_character)=0 or after_character!~'[[:alnum:]]') then
      return true;
    end if;
    search_offset:=match_position+1;
    if search_offset>char_length(text_value) then return false; end if;
  end loop;
end;
$function$;
alter function private.market_family_text_contains_label_v2(text,text) owner to postgres;
revoke all on function private.market_family_text_contains_label_v2(text,text)
  from public,anon,authenticated,service_role;

create or replace function private.assert_market_radar_candidate_no_live_duplicate_v1(
  candidate_input private.external_market_candidates
)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare lock_identity_value text;
begin
  lock_identity_value:=private.market_radar_candidate_cross_version_identity_v1(candidate_input);
  if lock_identity_value is null then return; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(lock_identity_value,0));
  if private.market_radar_candidate_has_live_duplicate_v1(candidate_input) then
    raise exception 'RADAR_CONFIRMED_DUPLICATE' using errcode='23505';
  end if;
end;
$function$;
alter function private.assert_market_radar_candidate_no_live_duplicate_v1(
  private.external_market_candidates
) owner to postgres;
revoke all on function private.assert_market_radar_candidate_no_live_duplicate_v1(
  private.external_market_candidates
) from public,anon,authenticated,service_role;

create or replace function private.market_workflow_issue_deterministic_v1(issue_input jsonb)
returns jsonb
language plpgsql
immutable
set search_path to ''
as $function$
declare
  fingerprint_value text:=lower(coalesce(issue_input ->> 'fingerprint',''));
  issue_id_value uuid;
begin
  if jsonb_typeof(issue_input)<>'object' or fingerprint_value!~'^[a-f0-9]{64}$' then
    raise exception 'MARKET_WORKFLOW_ISSUE_FINGERPRINT_INVALID' using errcode='22023';
  end if;
  issue_id_value:=(substr(fingerprint_value,1,8)||'-'||substr(fingerprint_value,9,4)
    ||'-4'||substr(fingerprint_value,14,3)||'-8'||substr(fingerprint_value,18,3)
    ||'-'||substr(fingerprint_value,21,12))::uuid;
  return issue_input||jsonb_build_object('issue_id',issue_id_value);
end;
$function$;
alter function private.market_workflow_issue_deterministic_v1(jsonb) owner to postgres;
revoke all on function private.market_workflow_issue_deterministic_v1(jsonb)
  from public,anon,authenticated,service_role;

create or replace function private.market_workflow_issue_array_replace_v1(
  existing_input jsonb,
  issue_input jsonb
)
returns jsonb
language plpgsql
immutable
set search_path to ''
as $function$
declare result_value jsonb;
begin
  if jsonb_typeof(issue_input)<>'object' or nullif(issue_input ->> 'issue_code','') is null then
    return case when jsonb_typeof(existing_input)='array' then existing_input else '[]'::jsonb end;
  end if;
  issue_input:=private.market_workflow_issue_deterministic_v1(issue_input);
  if jsonb_typeof(existing_input)='array' and exists (
    select 1 from jsonb_array_elements(existing_input) existing
    where existing ->> 'issue_code'=issue_input ->> 'issue_code'
      and existing ->> 'fingerprint'=issue_input ->> 'fingerprint'
  ) then return existing_input; end if;
  select coalesce(jsonb_agg(issue order by ordinality),'[]'::jsonb) into result_value
  from (
    select issue,ordinality from jsonb_array_elements(case
      when jsonb_typeof(existing_input)='array' then existing_input else '[]'::jsonb end
    ) with ordinality items(issue,ordinality)
    where issue ->> 'issue_code'<>issue_input ->> 'issue_code'
    order by ordinality limit 39
  ) bounded;
  return result_value||jsonb_build_array(issue_input);
end;
$function$;
alter function private.market_workflow_issue_array_replace_v1(jsonb,jsonb) owner to postgres;
revoke all on function private.market_workflow_issue_array_replace_v1(jsonb,jsonb)
  from public,anon,authenticated,service_role;

create or replace function private.assert_market_candidate_draft_identity_v1(
  candidate_id_input uuid,
  draft_payload_input jsonb
)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare
  candidate private.external_market_candidates%rowtype;
  child_slug_value text;
  child_search_slug_value text;
  field_name_value text;
  field_slug_value text;
  field_without_child_value text;
  sibling_slug_value text;
  sibling_label_value text;
begin
  select * into candidate
  from private.external_market_candidates candidate_alias
  where candidate_alias.id=candidate_id_input;
  if not found then
    raise exception 'RADAR_CANDIDATE_NOT_FOUND' using errcode='P0001';
  end if;
  if jsonb_typeof(draft_payload_input)<>'object' then
    raise exception 'CHILD_IDENTITY_MISMATCH' using errcode='55000';
  end if;
  perform private.assert_market_radar_candidate_no_live_duplicate_v1(candidate);
  if candidate.family_version not in (
       'atinara-market-family-v4','atinara-market-family-v5'
     ) or candidate.family_child_key is null
     or candidate.family_child_key not like 'option:%' then
    return;
  end if;
  child_slug_value:=case candidate.family_version
    when 'atinara-market-family-v5'
      then private.market_family_option_slug_v2(candidate.family_child_label)
    else private.market_family_option_slug_v1(candidate.family_child_label)
  end;
  if nullif(child_slug_value,'') is null then
    raise exception 'CHILD_IDENTITY_MISMATCH' using errcode='55000';
  end if;
  child_search_slug_value:=coalesce(
    nullif(private.market_family_option_slug_v1(candidate.family_child_label),''),
    child_slug_value
  );
  if (case candidate.family_version
      when 'atinara-market-family-v5'
        then private.market_family_option_slug_v2(draft_payload_input ->> 'subject')
      else private.market_family_option_slug_v1(draft_payload_input ->> 'subject')
    end) is distinct from child_slug_value then
    raise exception 'CHILD_IDENTITY_MISMATCH' using errcode='55000';
  end if;
  foreach field_name_value in array array[
    'question','yes_criteria','no_criteria','public_criteria','market_slug'
  ] loop
    field_slug_value:=private.market_family_option_slug_v1(
      draft_payload_input ->> field_name_value
    );
    if (field_name_value='market_slug' and field_slug_value
        !~('(^|-)'||child_search_slug_value||'(-|$)'))
       or (field_name_value<>'market_slug' and not private.market_family_text_contains_label_v2(
         draft_payload_input ->> field_name_value,candidate.family_child_label
       )) then raise exception 'CHILD_IDENTITY_MISMATCH' using errcode='55000'; end if;
    field_without_child_value:=trim(both '-' from regexp_replace(
      regexp_replace(field_slug_value,'(^|-)'||child_search_slug_value||'(-|$)','-','g'),
      '-+','-','g'
    ));
    for sibling_slug_value,sibling_label_value in
      select private.market_family_option_slug_v1(sibling.family_child_label),
        sibling.family_child_label
      from private.external_market_candidates sibling
      where sibling.family_version=candidate.family_version
        and sibling.family_key=candidate.family_key
        and sibling.family_child_key<>candidate.family_child_key
        and sibling.family_child_label is not null
    loop
      if field_name_value='market_slug' and nullif(sibling_slug_value,'') is not null
         and (case when child_search_slug_value~('(^|-)'||sibling_slug_value||'(-|$)')
           then field_without_child_value else field_slug_value end)
           ~('(^|-)'||sibling_slug_value||'(-|$)')
         or field_name_value<>'market_slug'
           and not private.market_family_text_contains_label_v2(
             candidate.family_child_label,sibling_label_value
           ) and private.market_family_text_contains_label_v2(
             draft_payload_input ->> field_name_value,sibling_label_value
           ) then
        raise exception 'CHILD_IDENTITY_MISMATCH' using errcode='55000';
      end if;
    end loop;
  end loop;
end;
$function$;
revoke all on function private.assert_market_candidate_draft_identity_v1(uuid,jsonb)
  from public,anon,authenticated,service_role;

create or replace function private.market_family_origin_projection_v1(
  radar_candidate_id_input uuid,
  market_id_input text
)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  result jsonb;
  active_slug_matches integer;
begin
  if radar_candidate_id_input is not null and market_id_input is not null then
    raise exception 'RADAR_FAMILY_ORIGIN_AMBIGUOUS' using errcode='22023';
  end if;
  if radar_candidate_id_input is not null then
    select jsonb_build_object(
      'family_key',candidate.family_key,'family_title',candidate.family_title,
      'family_type',candidate.family_type,'family_child_key',candidate.family_child_key,
      'family_child_label',candidate.family_child_label,'family_sort_at',candidate.family_sort_at,
      'family_relationship','standalone','family_semantics',coalesce(candidate.family_semantics,'{}'::jsonb),
      'family_source_event_key',candidate.family_source_event_key,'family_version',candidate.family_version
    ) into result
    from private.external_market_candidates candidate
    where candidate.id=radar_candidate_id_input
      and candidate.family_version in ('atinara-market-family-v4','atinara-market-family-v5')
      and candidate.family_key is not null and candidate.family_child_key is not null;
  elsif market_id_input is not null then
    select jsonb_build_object(
      'family_key',draft.family_key,'family_title',draft.family_title,
      'family_type',draft.family_type,'family_child_key',draft.family_child_key,
      'family_child_label',draft.family_child_label,'family_sort_at',draft.family_sort_at,
      'family_relationship','standalone','family_semantics',coalesce(draft.family_semantics,'{}'::jsonb),
      'family_source_event_key',draft.family_source_event_key,'family_version',draft.family_version
    ) into result
    from private.market_drafts draft
    where draft.market_id=market_id_input
      and draft.family_version in ('atinara-market-family-v4','atinara-market-family-v5')
      and draft.family_key is not null and draft.family_child_key is not null
    limit 1;
    if result is null then
      -- Recuento y elección pertenecen a la misma instantánea. Dos intenciones
      -- publicables con el mismo slug fallan cerradas; nunca se elige por fecha.
      select count(*)::integer,
        jsonb_agg(jsonb_build_object(
          'family_key',draft.family_key,'family_title',draft.family_title,
          'family_type',draft.family_type,'family_child_key',draft.family_child_key,
          'family_child_label',draft.family_child_label,'family_sort_at',draft.family_sort_at,
          'family_relationship','standalone','family_semantics',coalesce(draft.family_semantics,'{}'::jsonb),
          'family_source_event_key',draft.family_source_event_key,'family_version',draft.family_version
        ) order by draft.updated_at desc,draft.created_at desc,draft.id desc) -> 0
      into active_slug_matches,result
      from private.market_drafts draft
      where draft.market_id is null and draft.market_slug=market_id_input
        and draft.workflow_status in ('human_confirmed','scheduled')
        and draft.family_version in ('atinara-market-family-v4','atinara-market-family-v5')
        and draft.family_key is not null and draft.family_child_key is not null;
      if active_slug_matches>1 then
        raise exception 'RADAR_FAMILY_ORIGIN_AMBIGUOUS' using errcode='22023';
      end if;
    end if;
  end if;
  return result;
end;
$function$;
alter function private.market_family_origin_projection_v1(uuid,text) owner to postgres;
revoke all on function private.market_family_origin_projection_v1(uuid,text)
  from public,anon,authenticated,service_role;

create or replace function private.assign_market_draft_family_v4()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  candidate private.external_market_candidates%rowtype;
  candidate_id_value uuid;
  metadata_value jsonb;
begin
  candidate_id_value:=new.radar_candidate_id;
  if candidate_id_value is null
     and new.intelligence_origin_type='radar_candidate'
     and coalesce(new.intelligence_origin_id,'')
       ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$' then
    candidate_id_value:=new.intelligence_origin_id::uuid;
  end if;
  if candidate_id_value is not null then
    select * into candidate
    from private.external_market_candidates candidate_alias
    where candidate_alias.id=candidate_id_value;
  end if;
  if candidate.id is not null
     and candidate.family_version in ('atinara-market-family-v4','atinara-market-family-v5')
     and candidate.family_key is not null and candidate.family_child_key is not null then
    new.family_key:=candidate.family_key;
    new.family_title:=candidate.family_title;
    new.family_type:=candidate.family_type;
    new.family_child_key:=candidate.family_child_key;
    new.family_child_label:=candidate.family_child_label;
    new.family_sort_at:=candidate.family_sort_at;
    new.family_relationship:='standalone';
    new.family_semantics:=coalesce(candidate.family_semantics,'{}'::jsonb);
    new.family_source_event_key:=candidate.family_source_event_key;
    new.family_version:=candidate.family_version;
    return new;
  end if;
  metadata_value:=private.market_family_metadata_v4(
    new.question,null,new.subject,
    coalesce(new.source_provenance ->> 'event_group_key',new.family_source_event_key),
    new.evaluation_ends_at,new.timezone,
    concat_ws(' ',new.yes_criteria,new.no_criteria,new.edge_cases),null
  );
  if new.workflow_status not in ('cancelled','annulled')
     and coalesce((metadata_value #>> '{family_semantics,identity_ambiguous}')::boolean,false) then
    raise exception 'FAMILY_IDENTITY_AMBIGUOUS' using errcode='23514';
  end if;
  new.family_key:=metadata_value ->> 'family_key';
  new.family_title:=metadata_value ->> 'family_title';
  new.family_type:=metadata_value ->> 'family_type';
  new.family_child_key:=metadata_value ->> 'family_child_key';
  new.family_child_label:=metadata_value ->> 'family_child_label';
  new.family_sort_at:=private.market_family_safe_timestamptz_v4(metadata_value ->> 'family_sort_at');
  new.family_relationship:='standalone';
  new.family_semantics:=coalesce(metadata_value -> 'family_semantics','{}'::jsonb);
  new.family_source_event_key:=metadata_value ->> 'family_source_event_key';
  new.family_version:=metadata_value ->> 'family_version';
  return new;
end;
$function$;
revoke all on function private.assign_market_draft_family_v4()
  from public,anon,authenticated,service_role;

create or replace function private.assign_public_market_family_v4()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  metadata_value jsonb;
  origin_value jsonb;
begin
  origin_value:=private.market_family_origin_projection_v1(null,new.id);
  if origin_value is not null then
    new.family_key:=origin_value ->> 'family_key';
    new.family_title:=origin_value ->> 'family_title';
    new.family_type:=origin_value ->> 'family_type';
    new.family_child_key:=origin_value ->> 'family_child_key';
    new.family_child_label:=origin_value ->> 'family_child_label';
    new.family_sort_at:=private.market_family_safe_timestamptz_v4(origin_value ->> 'family_sort_at');
    new.family_relationship:='standalone';
    new.family_semantics:=coalesce(origin_value -> 'family_semantics','{}'::jsonb);
    new.family_source_event_key:=origin_value ->> 'family_source_event_key';
    new.family_version:=origin_value ->> 'family_version';
    return new;
  end if;
  metadata_value:=private.market_family_metadata_v4(
    new.question,null,null,new.family_source_event_key,
    new.evaluation_ends_at,new.evaluation_timezone,null,null
  );
  if coalesce((metadata_value #>> '{family_semantics,identity_ambiguous}')::boolean,false) then
    raise exception 'FAMILY_IDENTITY_AMBIGUOUS' using errcode='23514';
  end if;
  new.family_key:=metadata_value ->> 'family_key';
  new.family_title:=metadata_value ->> 'family_title';
  new.family_type:=metadata_value ->> 'family_type';
  new.family_child_key:=metadata_value ->> 'family_child_key';
  new.family_child_label:=metadata_value ->> 'family_child_label';
  new.family_sort_at:=private.market_family_safe_timestamptz_v4(metadata_value ->> 'family_sort_at');
  new.family_relationship:='standalone';
  new.family_semantics:=coalesce(metadata_value -> 'family_semantics','{}'::jsonb);
  new.family_source_event_key:=metadata_value ->> 'family_source_event_key';
  new.family_version:=metadata_value ->> 'family_version';
  return new;
end;
$function$;
revoke all on function private.assign_public_market_family_v4()
  from public,anon,authenticated,service_role;

create or replace function public.process_market_radar_refresh_batch_v2(
  request_id_input uuid,
  provider_input text,
  capability_input text,
  lease_token_input uuid
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  intent private.market_radar_refresh_intents_v1%rowtype;
  pending_batch private.market_radar_refresh_batches_v1%rowtype;
  result jsonb;
  updated_count integer:=0;
  accepted_count_value integer:=0;
begin
  if auth.role()<>'service_role' then
    raise exception 'SERVICE_ROLE_REQUIRED' using errcode='42501';
  end if;
  if capability_input='candidate_feed' and coalesce(
    current_setting('atinara.radar_atomic_candidate_commit',true),''
  )<>request_id_input::text then
    raise exception 'RADAR_ATOMIC_CANDIDATE_COMMIT_REQUIRED' using errcode='55000';
  end if;
  intent:=private.assert_market_radar_refresh_lease_v1(
    request_id_input,provider_input,capability_input,lease_token_input
  );
  if capability_input<>'candidate_feed'
     or intent.parent_manifest_hash is null
     or intent.provider_parent_count is null
     or intent.reconciled_parent_count is distinct from intent.provider_parent_count
     or intent.provider_pagination_exhausted is not true then
    raise exception 'RADAR_PARENT_MANIFEST_REQUIRED' using errcode='55000';
  end if;
  select * into pending_batch
  from private.market_radar_refresh_batches_v1 batch_alias
  where batch_alias.request_id=request_id_input
    and batch_alias.provider=provider_input
    and batch_alias.capability=capability_input
    and batch_alias.status in ('pending','technical_failed')
  order by batch_alias.batch_ordinal,batch_alias.split_path
  limit 1;
  if found and exists (
    select 1 from jsonb_array_elements(pending_batch.items) item
    where item #>> '{candidate,normalizer_version}' is distinct from 'atinara-radar-v3'
      or item #>> '{candidate,family_version}' is distinct from 'atinara-market-family-v5'
      or item #>> '{candidate,parent_reconciliation_version}'
        is distinct from 'atinara-radar-parent-reconciliation-v1'
      or coalesce(item #>> '{candidate,parent_reconciliation_fingerprint}','')
        !~ '^[a-f0-9]{64}$'
      or coalesce(item #>> '{candidate,canonical_projection_version}','')
        is distinct from 'atinara-radar-child-projection-v1'
      or nullif(item #>> '{candidate,parent_child_occurrence_key}','') is null
      or coalesce(item #>> '{candidate,parent_child_fingerprint}','') !~ '^[a-f0-9]{64}$'
      or coalesce(item #>> '{candidate,provider_child_contract_hash}','') !~ '^[a-f0-9]{64}$'
      or jsonb_typeof(item #> '{candidate,provider_child_contract}') is distinct from 'object'
      or exists (
        select 1 from private.external_market_candidates prepared_candidate
        where prepared_candidate.provider=provider_input
          and prepared_candidate.external_id=item #>> '{candidate,external_id}'
          and (
            prepared_candidate.state in ('prepared','rejected')
              and prepared_candidate.prepared_draft_id is not null
            or exists (
              select 1 from private.market_drafts protected_draft
              where protected_draft.workflow_status not in ('cancelled','annulled') and (
                protected_draft.radar_candidate_id=prepared_candidate.id or (
                  protected_draft.intelligence_origin_type='radar_candidate'
                  and protected_draft.intelligence_origin_id=prepared_candidate.id::text
                )
              )
            )
          )
      )
      or not exists (
        select 1 from private.market_radar_parent_reconciliations_v1 parent_alias
        where parent_alias.request_id=request_id_input
          and parent_alias.provider=provider_input
          and parent_alias.provider_parent_id=item #>> '{candidate,external_event_id}'
          and parent_alias.reconciliation_fingerprint
            =item #>> '{candidate,parent_reconciliation_fingerprint}'
      )
      or not exists (
        select 1
        from private.market_radar_parent_reconciliations_v1 parent_alias
        join private.market_radar_parent_children_v1 child_alias
          on child_alias.parent_reconciliation_id=parent_alias.id
        where parent_alias.request_id=request_id_input
          and parent_alias.provider=provider_input
          and parent_alias.provider_parent_id=item #>> '{candidate,external_event_id}'
          and child_alias.present_in_current_snapshot
          and child_alias.child_occurrence_key=item #>> '{candidate,parent_child_occurrence_key}'
          and child_alias.child_fingerprint=item #>> '{candidate,parent_child_fingerprint}'
          and child_alias.provider_contract_hash
            =item #>> '{candidate,provider_child_contract_hash}'
          and child_alias.provider_contract=item #> '{candidate,provider_child_contract}'
          and child_alias.provider_child_identity_key is not distinct from
            nullif(item #>> '{candidate,parent_child_identity_key}','')
          and child_alias.external_market_id is not distinct from
            nullif(item #>> '{candidate,external_market_id}','')
          and child_alias.identity_status=item #>> '{candidate,identity_status}'
          and child_alias.identity_classification
            =item #>> '{candidate,identity_classification}'
          and child_alias.canonical_child_key is not distinct from
            nullif(item #>> '{candidate,canonical_child_key}','')
          and child_alias.canonical_child_label is not distinct from
            nullif(item #>> '{candidate,canonical_child_label}','')
      )
  ) then
    raise exception 'RADAR_CANDIDATE_RECONCILIATION_BINDING_INVALID' using errcode='23514';
  end if;

  result:=public.process_market_radar_refresh_batch_v1(
    request_id_input,provider_input,capability_input,lease_token_input
  );
  if coalesce((result ->> 'processed')::boolean,false) is not true then
    return result||jsonb_build_object('contract_version','atinara-radar-parent-reconciliation-v1');
  end if;
  accepted_count_value:=coalesce((result ->> 'accepted_count')::integer,0);
  with accepted_items as (
    select item.value #> '{candidate}' as candidate
    from private.market_radar_refresh_batches_v1 batch_alias,
      lateral jsonb_array_elements(batch_alias.items) with ordinality item(value,ordinality)
    where batch_alias.id=(result ->> 'batch_id')::uuid
      and not exists (
        select 1 from private.market_radar_candidate_quarantines quarantine
        where quarantine.refresh_request_id=request_id_input
          and quarantine.provider=provider_input
          and quarantine.refresh_batch_id=batch_alias.id
          and quarantine.refresh_item_ordinal=item.ordinality::integer
      )
  ), bindings as (
    select candidate_row.id as candidate_id,parent_alias.id as parent_id,
      child_alias.id as child_id,parent_alias.payload_hash as parent_integrity_hash,
      child_alias.payload_hash as child_integrity_hash,child_alias.provider_contract,
      child_alias.provider_contract_hash,parent_alias.checked_at as reconciliation_checked_at
    from accepted_items item
    join private.external_market_candidates candidate_row
      on candidate_row.provider=provider_input
     and candidate_row.external_id=item.candidate ->> 'external_id'
     and candidate_row.normalized_payload ->> 'normalizer_version'='atinara-radar-v3'
     and candidate_row.normalized_payload ->> 'parent_reconciliation_fingerprint'
       =item.candidate ->> 'parent_reconciliation_fingerprint'
    join private.market_radar_parent_reconciliations_v1 parent_alias
      on parent_alias.request_id=request_id_input
     and parent_alias.provider=provider_input
     and parent_alias.provider_parent_id=item.candidate ->> 'external_event_id'
     and parent_alias.reconciliation_fingerprint
       =item.candidate ->> 'parent_reconciliation_fingerprint'
    join private.market_radar_parent_children_v1 child_alias
      on child_alias.parent_reconciliation_id=parent_alias.id
     and child_alias.present_in_current_snapshot
     and child_alias.child_occurrence_key=item.candidate ->> 'parent_child_occurrence_key'
     and child_alias.child_fingerprint=item.candidate ->> 'parent_child_fingerprint'
     and child_alias.provider_contract_hash=item.candidate ->> 'provider_child_contract_hash'
     and child_alias.provider_contract=item.candidate -> 'provider_child_contract'
     and child_alias.provider_child_identity_key is not distinct from
       nullif(item.candidate ->> 'parent_child_identity_key','')
     and child_alias.external_market_id is not distinct from
       nullif(item.candidate ->> 'external_market_id','')
  )
  update private.external_market_candidates candidate_alias set
    normalizer_version='atinara-radar-v3',
    source_status=nullif(bindings.provider_contract ->> 'source_status',''),
    external_url=coalesce(
      nullif(bindings.provider_contract ->> 'external_market_url',''),
      nullif(bindings.provider_contract ->> 'external_event_url','')
    ),
    external_event_url=nullif(bindings.provider_contract ->> 'external_event_url',''),
    external_market_url=nullif(bindings.provider_contract ->> 'external_market_url',''),
    external_event_slug=nullif(bindings.provider_contract ->> 'event_slug',''),
    external_market_slug=nullif(bindings.provider_contract ->> 'child_slug',''),
    fetched_at=bindings.reconciliation_checked_at,
    current_parent_reconciliation_id=bindings.parent_id,
    current_parent_child_id=bindings.child_id,
    normalized_payload=candidate_alias.normalized_payload||jsonb_build_object(
      'parent_reconciliation_integrity_hash',bindings.parent_integrity_hash,
      'parent_child_integrity_hash',bindings.child_integrity_hash,
      'provider_child_contract',bindings.provider_contract,
      'provider_child_contract_hash',bindings.provider_contract_hash,
      'source_title',bindings.provider_contract -> 'source_title',
      'source_question',bindings.provider_contract -> 'source_question',
      'source_description',bindings.provider_contract -> 'source_description',
      'source_resolution_rules',bindings.provider_contract -> 'source_resolution_rules',
      'source_resolution_url',bindings.provider_contract -> 'source_resolution_url',
      'source_close_at',bindings.provider_contract -> 'source_close_at',
      'source_resolution_deadline',bindings.provider_contract -> 'source_resolution_deadline',
      'source_status',bindings.provider_contract -> 'source_status',
      'source_result',bindings.provider_contract -> 'source_result'
    ),
    updated_at=clock_timestamp()
  from bindings
  where candidate_alias.id=bindings.candidate_id;
  get diagnostics updated_count=row_count;
  if updated_count<>accepted_count_value then
    raise exception 'RADAR_CANDIDATE_RECONCILIATION_BINDING_INCOMPLETE' using errcode='23514';
  end if;
  return result||jsonb_build_object(
    'contract_version','atinara-radar-parent-reconciliation-v1',
    'reconciliation_bound_count',updated_count
  );
end;
$function$;

alter function public.process_market_radar_refresh_batch_v2(uuid,text,text,uuid)
  owner to postgres;
revoke all on function public.process_market_radar_refresh_batch_v2(uuid,text,text,uuid)
  from public,anon,authenticated,service_role;
-- El entrypoint anterior persiste cada batch en una transacción distinta. Se
-- conserva para la llamada interna del owner, pero la Edge no puede invocarlo
-- directamente después de este cutover.
revoke all on function public.process_market_radar_refresh_batch_v1(uuid,text,text,uuid)
  from public,anon,authenticated,service_role;

create or replace function private.rebind_market_radar_protected_candidates_v1(
  request_id_input uuid,
  provider_input text
)
returns integer
language plpgsql
security definer
set search_path to ''
as $function$
declare
  rebound_count integer:=0;
  issue_link record;
begin
  with possible as (
    select candidate.id as candidate_id,parent_alias.id as parent_id,
      parent_alias.reconciliation_fingerprint,
      parent_alias.payload_hash as parent_integrity_hash,child_alias.id as child_id,
      child_alias.child_occurrence_key,child_alias.provider_child_identity_key,
      child_alias.child_fingerprint,child_alias.payload_hash as child_integrity_hash,
      child_alias.canonical_child_key,
      child_alias.canonical_child_label,child_alias.identity_status,
      child_alias.identity_classification,child_alias.availability_status,
      child_alias.raw_provider_child_label,child_alias.provider_contract,
      child_alias.provider_contract_hash,
      candidate.normalized_payload -> 'provider_child_contract' as prior_provider_contract,
      candidate.normalized_payload ->> 'provider_child_contract_hash' as prior_provider_contract_hash,
      candidate.family_type in (
        'categorical_outcomes','participant_options','platform_variants'
      ) and row(
        child_alias.canonical_child_key,child_alias.canonical_child_label
      ) is distinct from row(
        candidate.family_child_key,candidate.family_child_label
      ) as identity_changed,
      candidate.normalized_payload ->> 'provider_child_contract_hash'
        is distinct from child_alias.provider_contract_hash as contract_changed,
      candidate.normalized_payload ->> 'availability_status'
        is distinct from child_alias.availability_status as availability_changed,
      nullif(candidate.normalized_payload ->> 'source_result','')
        is distinct from nullif(child_alias.provider_contract ->> 'source_result','')
        as result_changed,
      nullif(child_alias.provider_contract ->> 'source_result','') is not null
        and nullif(candidate.normalized_payload ->> 'source_result','')
          is distinct from nullif(child_alias.provider_contract ->> 'source_result','')
        as terminal_result,
      row(
        candidate.normalized_payload ->> 'parent_reconciliation_fingerprint',
        candidate.normalized_payload ->> 'parent_reconciliation_integrity_hash',
        candidate.normalized_payload ->> 'parent_child_fingerprint',
        candidate.normalized_payload ->> 'parent_child_integrity_hash',
        candidate.normalized_payload ->> 'availability_status',
        nullif(candidate.normalized_payload ->> 'canonical_child_key',''),
        nullif(candidate.normalized_payload ->> 'canonical_child_label','')
      ) is distinct from row(
        parent_alias.reconciliation_fingerprint,parent_alias.payload_hash,
        child_alias.child_fingerprint,child_alias.payload_hash,
        child_alias.availability_status,child_alias.canonical_child_key,
        child_alias.canonical_child_label
      ) as material_changed,
      count(*) over(partition by candidate.id) as match_count
    from private.external_market_candidates candidate
    join private.market_radar_parent_reconciliations_v1 parent_alias
      on parent_alias.request_id=request_id_input
     and parent_alias.provider=provider_input
     and parent_alias.provider_parent_id=candidate.external_event_id
     and parent_alias.reconciliation_status='complete'
    join private.market_radar_parent_children_v1 child_alias
      on child_alias.parent_reconciliation_id=parent_alias.id
     and child_alias.present_in_current_snapshot
     and child_alias.identity_status='resolved'
     and child_alias.identity_classification in (
       'identified_real_option','aggregate_other_option','tie_option',
       'no_winner_option','provider_closed_child'
     )
    where candidate.provider=provider_input
      and candidate.normalizer_version='atinara-radar-v3'
      and (
        candidate.state in ('prepared','rejected') and candidate.prepared_draft_id is not null
        or exists (
          select 1 from private.market_drafts protected_draft
          where protected_draft.workflow_status not in ('cancelled','annulled') and (
            protected_draft.radar_candidate_id=candidate.id or (
              protected_draft.intelligence_origin_type='radar_candidate'
              and protected_draft.intelligence_origin_id=candidate.id::text
            )
          )
        )
      )
      and case
        when nullif(candidate.normalized_payload ->> 'parent_child_identity_key','') is not null
          then child_alias.provider_child_identity_key
            =candidate.normalized_payload ->> 'parent_child_identity_key'
        when nullif(candidate.normalized_payload ->> 'external_market_id','') is not null
          then child_alias.external_market_id
            =candidate.normalized_payload ->> 'external_market_id'
        when nullif(candidate.normalized_payload ->> 'condition_id','') is not null
          then child_alias.condition_id=candidate.normalized_payload ->> 'condition_id'
        when jsonb_typeof(candidate.normalized_payload -> 'token_ids')='array'
          and jsonb_array_length(candidate.normalized_payload -> 'token_ids')>0
          then child_alias.token_ids=candidate.normalized_payload -> 'token_ids'
        when nullif(candidate.normalized_payload ->> 'external_market_slug','') is not null
          then child_alias.child_slug=candidate.normalized_payload ->> 'external_market_slug'
        else false end
      and (nullif(candidate.normalized_payload ->> 'external_market_id','') is null
        or child_alias.external_market_id=candidate.normalized_payload ->> 'external_market_id')
      and (nullif(candidate.normalized_payload ->> 'condition_id','') is null
        or child_alias.condition_id=candidate.normalized_payload ->> 'condition_id')
      and (jsonb_typeof(candidate.normalized_payload -> 'token_ids')<>'array'
        or jsonb_array_length(candidate.normalized_payload -> 'token_ids')=0
        or child_alias.token_ids=candidate.normalized_payload -> 'token_ids')
      and (
        (candidate.family_type in (
          'categorical_outcomes','participant_options','platform_variants'
        )
          and child_alias.identity_kind='option')
        or (candidate.family_type not in (
          'categorical_outcomes','participant_options','platform_variants'
        )
          and child_alias.identity_kind='contract')
      )
  ), unique_matches as (
    select * from possible where match_count=1
  ), actionable_matches as (
    select matched.*,case when matched.material_changed then
      private.market_workflow_server_issue_v1(
        case when matched.terminal_result then 'RADAR_EVENT_ALREADY_RESOLVED'
          when matched.identity_changed then 'CHILD_IDENTITY_MISMATCH'
          when matched.contract_changed then 'PROVIDER_CHILD_CONTRACT_CHANGED'
          when matched.availability_changed then 'PROVIDER_OPTION_INACTIVE'
          else 'RADAR_ELIGIBILITY_REQUIRED' end,
        'radar',case when matched.terminal_result then 'radar'
          when matched.identity_changed or matched.contract_changed then 'corrector'
          when matched.availability_changed then 'provider' else 'radar' end,
        case when matched.terminal_result then 'terminal'
          when matched.identity_changed or matched.contract_changed then 'human_editable'
          else 'auto_recoverable' end,
        case when matched.terminal_result then 'terminal' else 'approval' end,
        case when matched.terminal_result then 'archive_terminal_candidate'
          when matched.identity_changed then 'repair_child_identity'
          when matched.contract_changed then 'repair_temporal_or_source_contract'
          when matched.availability_changed then 'retry_provider_refresh'
          else 'refresh_draft_eligibility' end,jsonb_build_object(
          'candidate_id',matched.candidate_id,
          'current_child',jsonb_build_object(
            'family_child_key',(select candidate.family_child_key
              from private.external_market_candidates candidate where candidate.id=matched.candidate_id),
            'family_child_label',(select candidate.family_child_label
              from private.external_market_candidates candidate where candidate.id=matched.candidate_id)
          ),
          'provider_child',jsonb_build_object(
            'canonical_child_key',matched.canonical_child_key,
            'canonical_child_label',matched.canonical_child_label,
            'child_fingerprint',matched.child_fingerprint,
            'prior_provider_contract_hash',matched.prior_provider_contract_hash,
            'provider_contract_hash',matched.provider_contract_hash,
            'prior_provider_contract',matched.prior_provider_contract,
            'provider_contract',matched.provider_contract
          )
        ),not matched.terminal_result,'atinara-radar-parent-reconciliation-v1'
      ) else null end as issue_value
    from unique_matches matched
  )
  update private.external_market_candidates candidate set
    current_parent_reconciliation_id=matched.parent_id,
    current_parent_child_id=matched.child_id,
    current_eligibility_check_id=case when matched.material_changed then null
      else candidate.current_eligibility_check_id end,
    eligibility_status=case when matched.terminal_result then 'terminal'
      when matched.material_changed then 'technical_hold'
      else candidate.eligibility_status end,
    eligibility_reason_code=case when matched.material_changed then
      case when matched.terminal_result then 'RADAR_EVENT_ALREADY_RESOLVED'
        when matched.identity_changed then 'CHILD_IDENTITY_MISMATCH'
        when matched.contract_changed then 'PROVIDER_CHILD_CONTRACT_CHANGED'
        when matched.availability_changed then 'PROVIDER_OPTION_INACTIVE'
        else 'RADAR_ELIGIBILITY_REQUIRED' end else candidate.eligibility_reason_code end,
    eligibility_reason=case when matched.material_changed then
      case when matched.terminal_result
        then 'El proveedor ya declara un resultado para esta hija.'
        when matched.identity_changed
        then 'La identidad vigente del proveedor cambió y el borrador debe repararse.'
        when matched.contract_changed
        then 'El contrato vigente de la hija cambió y debe repararse o revalidarse.'
        when matched.availability_changed
        then 'La disponibilidad vigente de la hija cambió y debe revalidarse.'
        else 'El snapshot material del proveedor cambió y debe revalidarse.' end
      else candidate.eligibility_reason end,
    state=case when matched.terminal_result then 'rejected' else candidate.state end,
    verification_status=case when matched.terminal_result then 'rejected_resolved'
      else candidate.verification_status end,
    verification_reason_code=case when matched.terminal_result then 'EVENT_ALREADY_RESOLVED'
      else candidate.verification_reason_code end,
    verification_reason=case when matched.terminal_result
      then 'El proveedor ya declara un resultado para esta hija.' else candidate.verification_reason end,
    normalized_payload=candidate.normalized_payload||jsonb_build_object(
      'parent_reconciliation_version','atinara-radar-parent-reconciliation-v1',
      'parent_reconciliation_fingerprint',matched.reconciliation_fingerprint,
      'parent_reconciliation_integrity_hash',matched.parent_integrity_hash,
      'parent_child_occurrence_key',matched.child_occurrence_key,
      'parent_child_identity_key',matched.provider_child_identity_key,
      'parent_child_fingerprint',matched.child_fingerprint,
      'parent_child_integrity_hash',matched.child_integrity_hash,
      'canonical_projection_version','atinara-radar-child-projection-v1',
      'canonical_child_key',matched.canonical_child_key,
      'canonical_child_label',matched.canonical_child_label,
      'identity_status',matched.identity_status,
      'identity_classification',matched.identity_classification,
      'availability_status',matched.availability_status,
      'raw_provider_child_label',matched.raw_provider_child_label
      ,'provider_child_contract',matched.provider_contract
      ,'provider_child_contract_hash',matched.provider_contract_hash
    )||case when matched.material_changed then jsonb_build_object(
      'eligibility_status',case when matched.terminal_result then 'terminal'
        else 'technical_hold' end,
      'eligibility_reason_code',case when matched.terminal_result then 'RADAR_EVENT_ALREADY_RESOLVED'
        when matched.identity_changed then 'CHILD_IDENTITY_MISMATCH'
        when matched.contract_changed then 'PROVIDER_CHILD_CONTRACT_CHANGED'
        when matched.availability_changed then 'PROVIDER_OPTION_INACTIVE'
        else 'RADAR_ELIGIBILITY_REQUIRED' end,
      'eligibility_reason',case when matched.terminal_result
        then 'El proveedor ya declara un resultado para esta hija.'
        when matched.identity_changed
        then 'La identidad vigente del proveedor cambió y el borrador debe repararse.'
        when matched.contract_changed
        then 'El contrato vigente de la hija cambió y debe repararse o revalidarse.'
        when matched.availability_changed
        then 'La disponibilidad vigente de la hija cambió y debe revalidarse.'
        else 'El snapshot material del proveedor cambió y debe revalidarse.' end,
      'current_eligibility_check_id',null,
      'state',case when matched.terminal_result then 'rejected' else candidate.state end,
      'verification_status',case when matched.terminal_result then 'rejected_resolved'
        else candidate.verification_status end,
      'verification_reason_code',case when matched.terminal_result then 'EVENT_ALREADY_RESOLVED'
        else candidate.verification_reason_code end,
      'verification_reason',case when matched.terminal_result
        then 'El proveedor ya declara un resultado para esta hija.' else candidate.verification_reason end
    ) else '{}'::jsonb end
    ||case when matched.issue_value is not null then jsonb_build_object(
      'workflow_issues',private.market_workflow_issue_array_replace_v1(
        candidate.normalized_payload -> 'workflow_issues',matched.issue_value
      )
    ) else '{}'::jsonb end,
    updated_at=clock_timestamp()
  from actionable_matches matched
  where candidate.id=matched.candidate_id
    and row(candidate.current_parent_reconciliation_id,candidate.current_parent_child_id)
      is distinct from row(matched.parent_id,matched.child_id);
  get diagnostics rebound_count=row_count;
  for issue_link in
    select candidate.id as candidate_id,draft.id as draft_id,draft.content_version,
      draft.content_fingerprint,issue.value as issue
    from private.external_market_candidates candidate
    join private.market_radar_parent_reconciliations_v1 parent_alias
      on parent_alias.id=candidate.current_parent_reconciliation_id
     and parent_alias.request_id=request_id_input
     and parent_alias.provider=provider_input
    join private.market_drafts draft on draft.workflow_status not in ('cancelled','annulled')
      and (draft.radar_candidate_id=candidate.id or (
        draft.intelligence_origin_type='radar_candidate'
        and draft.intelligence_origin_id=candidate.id::text
      ))
    cross join lateral jsonb_array_elements(case
      when jsonb_typeof(candidate.normalized_payload -> 'workflow_issues')='array'
        then candidate.normalized_payload -> 'workflow_issues' else '[]'::jsonb end
    ) issue(value)
    where issue.value ->> 'issue_code' in (
      'CHILD_IDENTITY_MISMATCH','PROVIDER_CHILD_CONTRACT_CHANGED',
      'PROVIDER_OPTION_INACTIVE','RADAR_EVENT_ALREADY_RESOLVED',
      'RADAR_ELIGIBILITY_REQUIRED'
    )
  loop
    perform private.record_market_workflow_issue_v1(
      'market_draft',issue_link.draft_id::text,issue_link.content_version::text,
      case when issue_link.content_fingerprint~'^[a-f0-9]{64}$'
        then issue_link.content_fingerprint else null end,
      issue_link.issue,null,null
    );
    perform private.project_market_draft_workflow_state_v2(
      issue_link.draft_id,issue_link.content_version
    );
  end loop;
  return rebound_count;
end;
$function$;
alter function private.rebind_market_radar_protected_candidates_v1(uuid,text) owner to postgres;
revoke all on function private.rebind_market_radar_protected_candidates_v1(uuid,text)
  from public,anon,authenticated,service_role;

-- Los IDs append-only del snapshot son punteros técnicos. Si sus huellas e
-- identidad no cambian, rebindear una candidata preparada no invalida por sí
-- solo el expediente del Editor/Validator. Cualquier huella material nueva sí
-- permanece dentro de normalized_payload y eleva la revisión.
create or replace function private.market_candidate_preparation_projection(
  candidate private.external_market_candidates
)
returns jsonb
language sql
immutable
set search_path to ''
as $function$
  select (
    to_jsonb(candidate)
      - 'preparation_revision' - 'created_at' - 'updated_at'
      - 'cache_key' - 'fetched_at' - 'expires_at'
      - 'verification_status' - 'verification_reason_code'
      - 'verification_reason' - 'verification_evidence'
      - 'verification_confidence' - 'verified_at' - 'verification_expires_at'
      - 'fact_status' - 'fact_policy_version' - 'fact_context_fingerprint'
      - 'fact_checked_at' - 'fact_check_expires_at' - 'fact_check_purpose'
      - 'current_fact_check_id'
      - 'eligibility_status' - 'eligibility_reason_code' - 'eligibility_reason'
      - 'eligibility_evidence' - 'eligibility_checked_at' - 'eligibility_expires_at'
      - 'eligibility_policy_version' - 'current_eligibility_check_id'
      - 'current_parent_reconciliation_id' - 'current_parent_child_id'
  )||jsonb_build_object(
    'normalized_payload',(coalesce(candidate.normalized_payload,'{}'::jsonb)
      - 'id' - 'preparation_revision' - 'cache_key' - 'fetched_at'
      - 'cache_expires_at' - 'expires_at' - 'quality_status'
      - 'verification_status' - 'verification_reason_code'
      - 'verification_reason' - 'verification_evidence'
      - 'verification_confidence' - 'verified_at' - 'verification_expires_at'
      - 'fact_status' - 'fact_policy_version' - 'fact_context_fingerprint'
      - 'fact_checked_at' - 'fact_check_expires_at' - 'fact_check_purpose'
      - 'current_fact_check_id'
      - 'eligibility_status' - 'eligibility_reason_code' - 'eligibility_reason'
      - 'eligibility_evidence' - 'eligibility_checked_at' - 'eligibility_expires_at'
      - 'eligibility_policy_version' - 'current_eligibility_check_id'
      - 'workflow_issues' - 'provider_payload' - 'temporal_contract')||jsonb_build_object(
        'workflow_issues',coalesce((select jsonb_agg(
          issue-'issue_id'-'created_at'-'updated_at'-'status'-'resolved_at'-'resolution_method'
          order by issue ->> 'fingerprint'
        ) from jsonb_array_elements(case
          when jsonb_typeof(candidate.normalized_payload -> 'workflow_issues')='array'
            then candidate.normalized_payload -> 'workflow_issues' else '[]'::jsonb end
        ) issue),'[]'::jsonb),
        'temporal_contract',case
          when jsonb_typeof(candidate.normalized_payload -> 'temporal_contract')='object'
          then jsonb_strip_nulls(jsonb_build_object(
            'version',candidate.normalized_payload #>> '{temporal_contract,version}',
            'policy_version',candidate.normalized_payload #>> '{temporal_contract,policy_version}',
            'decision_hash',candidate.normalized_payload #>> '{temporal_contract,decision_hash}',
            'blocking_scope',candidate.normalized_payload #>> '{temporal_contract,blocking_scope}'
          )) else null end
      )
  );
$function$;
alter function private.market_candidate_preparation_projection(private.external_market_candidates)
  owner to postgres;
revoke all on function private.market_candidate_preparation_projection(private.external_market_candidates)
  from public,anon,authenticated,service_role;

create or replace function public.finalize_market_radar_refresh_v4(
  request_id_input uuid,
  provider_input text,
  capability_input text,
  lease_token_input uuid,
  status_input text,
  error_code_input text,
  failure_stage_input text,
  retry_after_seconds_input integer
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  intent private.market_radar_refresh_intents_v1%rowtype;
  result jsonb;
begin
  if auth.role()<>'service_role' then
    raise exception 'SERVICE_ROLE_REQUIRED' using errcode='42501';
  end if;
  select * into intent
  from private.market_radar_refresh_intents_v1 intent_alias
  where intent_alias.request_id=request_id_input
    and intent_alias.provider=provider_input
    and intent_alias.capability=capability_input
  for update;
  if not found then
    raise exception 'RADAR_REFRESH_REQUEST_NOT_FOUND' using errcode='22023';
  end if;
  if intent.status<>'in_progress' then
    result:=public.finalize_market_radar_refresh_v3(
      request_id_input,provider_input,capability_input,lease_token_input,
      status_input,error_code_input,failure_stage_input,retry_after_seconds_input
    );
    return result||jsonb_build_object('provider_selection',intent.provider_selection);
  end if;
  intent:=private.assert_market_radar_refresh_lease_v1(
    request_id_input,provider_input,capability_input,lease_token_input
  );
  if capability_input='candidate_feed' and status_input='available' and (
    intent.normalizer_version<>'atinara-radar-v3'
    or intent.provider_selection is null
    or intent.parent_manifest_hash is null
    or intent.provider_parent_count is null
    or (intent.provider_selection ->> 'selected_parent_count')::integer
      is distinct from intent.provider_parent_count
    or (intent.provider_selection ->> 'selected_child_count')::integer
      is distinct from (
        select coalesce(sum(parent_alias.provider_discovered_child_count),0)::integer
        from private.market_radar_parent_reconciliations_v1 parent_alias
        where parent_alias.request_id=request_id_input
          and parent_alias.provider=provider_input
      )
    or intent.reconciled_parent_count is distinct from intent.provider_parent_count
    or intent.provider_pagination_exhausted is not true
    or (intent.provider_parent_count>0 and not exists (
      select 1 from private.market_radar_parent_reconciliations_v1 parent_alias
      where parent_alias.request_id=request_id_input
        and parent_alias.provider=provider_input
    ))
  ) then
    raise exception 'RADAR_PARENT_MANIFEST_INCOMPLETE' using errcode='23514';
  end if;
  result:=public.finalize_market_radar_refresh_v3(
    request_id_input,provider_input,capability_input,lease_token_input,
    status_input,error_code_input,failure_stage_input,retry_after_seconds_input
  );
  update private.market_radar_refresh_intents_v1 set
    response_summary=coalesce(response_summary,'{}'::jsonb)||jsonb_build_object(
      'provider_selection',intent.provider_selection
    )
  where request_id=request_id_input and provider=provider_input and capability=capability_input;
  return result||jsonb_build_object('provider_selection',intent.provider_selection);
end;
$function$;

alter function public.finalize_market_radar_refresh_v4(uuid,text,text,uuid,text,text,text,integer)
  owner to postgres;
revoke all on function public.finalize_market_radar_refresh_v4(uuid,text,text,uuid,text,text,text,integer)
  from public,anon,authenticated,service_role;
revoke all on function public.finalize_market_radar_refresh_v3(uuid,text,text,uuid,text,text,text,integer)
  from public,anon,authenticated,service_role;

create or replace function public.finalize_market_radar_refresh_v5(
  request_id_input uuid,
  provider_input text,
  capability_input text,
  lease_token_input uuid,
  status_input text,
  error_code_input text,
  failure_stage_input text,
  retry_after_seconds_input integer
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
begin
  if auth.role()<>'service_role' then
    raise exception 'SERVICE_ROLE_REQUIRED' using errcode='42501';
  end if;
  if capability_input='candidate_feed' then
    return public.finalize_market_radar_refresh_v4(
      request_id_input,provider_input,capability_input,lease_token_input,
      status_input,error_code_input,failure_stage_input,retry_after_seconds_input
    );
  elsif capability_input='source_enrichment' then
    return public.finalize_market_radar_refresh_v3(
      request_id_input,provider_input,capability_input,lease_token_input,
      status_input,error_code_input,failure_stage_input,retry_after_seconds_input
    );
  end if;
  raise exception 'RADAR_REFRESH_CAPABILITY_INVALID' using errcode='22023';
end;
$function$;
alter function public.finalize_market_radar_refresh_v5(uuid,text,text,uuid,text,text,text,integer)
  owner to postgres;
revoke all on function public.finalize_market_radar_refresh_v5(uuid,text,text,uuid,text,text,text,integer)
  from public,anon,authenticated,service_role;
grant execute on function public.finalize_market_radar_refresh_v5(uuid,text,text,uuid,text,text,text,integer)
  to service_role;

create or replace function public.complete_market_radar_candidate_refresh_v1(
  request_id_input uuid,
  provider_input text,
  capability_input text,
  lease_token_input uuid,
  status_input text,
  error_code_input text,
  failure_stage_input text,
  retry_after_seconds_input integer
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  batch_result jsonb;
  finalized_result jsonb;
  iteration_count integer:=0;
  accepted_count_value integer:=0;
  quarantined_count_value integer:=0;
  protected_rebound_count_value integer:=0;
begin
  if auth.role()<>'service_role' then
    raise exception 'SERVICE_ROLE_REQUIRED' using errcode='42501';
  end if;
  if capability_input<>'candidate_feed' or status_input<>'available'
     or error_code_input is not null or failure_stage_input is not null
     or retry_after_seconds_input is not null then
    raise exception 'RADAR_ATOMIC_CANDIDATE_COMMIT_INVALID' using errcode='22023';
  end if;
  select response_summary into finalized_result
  from private.market_radar_refresh_intents_v1 intent_alias
  where intent_alias.request_id=request_id_input
    and intent_alias.provider=provider_input
    and intent_alias.capability=capability_input
    and intent_alias.status<>'in_progress'
  for update;
  if found then
    finalized_result:=public.finalize_market_radar_refresh_v4(
      request_id_input,provider_input,capability_input,lease_token_input,
      status_input,error_code_input,failure_stage_input,retry_after_seconds_input
    );
    return finalized_result||jsonb_build_object(
      'atomic_candidate_commit',true,'replayed',true
    );
  end if;
  perform private.assert_market_radar_refresh_lease_v1(
    request_id_input,provider_input,capability_input,lease_token_input
  );
  -- La promoción es una única transacción de hasta 480 candidatas. El lease
  -- inicial V6 dura 45 s, menos que el timeout RPC de 90 s; se amplía aquí de
  -- forma acotada antes de procesar para que los batches internos no invaliden
  -- al mismo owner a mitad del commit atómico.
  update private.market_radar_refresh_intents_v1 intent_alias set
    lease_expires_at=greatest(
      intent_alias.lease_expires_at,clock_timestamp()+interval '120 seconds'
    ),
    updated_at=clock_timestamp()
  where intent_alias.request_id=request_id_input
    and intent_alias.provider=provider_input
    and intent_alias.capability=capability_input
    and intent_alias.status='in_progress'
    and intent_alias.lease_token=lease_token_input;
  if not found then
    raise exception 'RADAR_REFRESH_LEASE_LOST' using errcode='40001';
  end if;
  perform set_config('atinara.radar_atomic_candidate_commit',request_id_input::text,true);
  loop
    iteration_count:=iteration_count+1;
    if iteration_count>512 then
      raise exception 'RADAR_ATOMIC_CANDIDATE_COMMIT_LIMIT' using errcode='54000';
    end if;
    batch_result:=public.process_market_radar_refresh_batch_v2(
      request_id_input,provider_input,capability_input,lease_token_input
    );
    if coalesce((batch_result ->> 'ok')::boolean,false) is not true then
      raise exception 'RADAR_ATOMIC_CANDIDATE_BATCH_FAILED:%',
        coalesce(batch_result ->> 'code','RADAR_PERSISTENCE_FAILED') using errcode='55000';
    end if;
    accepted_count_value:=accepted_count_value
      +coalesce((batch_result ->> 'accepted_count')::integer,0);
    quarantined_count_value:=quarantined_count_value
      +coalesce((batch_result ->> 'quarantined_count')::integer,0);
    exit when coalesce((batch_result ->> 'remaining_batches')::integer,0)=0;
  end loop;
  protected_rebound_count_value:=private.rebind_market_radar_protected_candidates_v1(
    request_id_input,provider_input
  );
  finalized_result:=public.finalize_market_radar_refresh_v4(
    request_id_input,provider_input,capability_input,lease_token_input,
    status_input,error_code_input,failure_stage_input,retry_after_seconds_input
  );
  return finalized_result||jsonb_build_object(
    'atomic_candidate_commit',true,
    'processed_batch_count',iteration_count,
    'atomic_accepted_count',accepted_count_value,
    'atomic_quarantined_count',quarantined_count_value,
    'protected_candidate_rebound_count',protected_rebound_count_value
  );
end;
$function$;

alter function public.complete_market_radar_candidate_refresh_v1(
  uuid,text,text,uuid,text,text,text,integer
) owner to postgres;
revoke all on function public.complete_market_radar_candidate_refresh_v1(
  uuid,text,text,uuid,text,text,text,integer
) from public,anon,authenticated,service_role;
grant execute on function public.complete_market_radar_candidate_refresh_v1(
  uuid,text,text,uuid,text,text,text,integer
) to service_role;

create or replace function private.market_radar_candidate_reconciliation_bound_v1(
  candidate private.external_market_candidates
)
returns boolean
language sql
stable
security definer
set search_path to ''
as $function$
  select candidate.normalizer_version='atinara-radar-v3'
    and candidate.normalized_payload ->> 'normalizer_version'='atinara-radar-v3'
    and candidate.family_version='atinara-market-family-v5'
    and candidate.normalized_payload ->> 'canonical_projection_version'
      ='atinara-radar-child-projection-v1'
    and candidate.current_parent_reconciliation_id is not null
    and candidate.current_parent_child_id is not null
    and exists (
      select 1
      from private.market_radar_parent_reconciliations_v1 parent_alias
      join private.market_radar_parent_children_v1 child_alias
        on child_alias.parent_reconciliation_id=parent_alias.id
      where parent_alias.id=candidate.current_parent_reconciliation_id
        and child_alias.id=candidate.current_parent_child_id
        and parent_alias.provider=candidate.provider
        and parent_alias.provider_parent_id=candidate.external_event_id
        and parent_alias.reconciliation_status='complete'
        and parent_alias.provider_pagination_exhausted
        and parent_alias.provider_declared_child_count=parent_alias.provider_discovered_child_count
        and parent_alias.provider_declared_child_count=parent_alias.provider_accounted_child_count
        and parent_alias.provider_unresolved_child_count=0
        and parent_alias.provider_conflict_child_count=0
        and parent_alias.reconciliation_version='atinara-radar-parent-reconciliation-v1'
        and parent_alias.reconciliation_fingerprint
          =candidate.normalized_payload ->> 'parent_reconciliation_fingerprint'
        and parent_alias.payload_hash
          =candidate.normalized_payload ->> 'parent_reconciliation_integrity_hash'
        and parent_alias.id=(
          select latest_parent.id
          from private.market_radar_parent_reconciliations_v1 latest_parent
          join private.market_radar_refresh_intents_v1 latest_intent
            on latest_intent.request_id=latest_parent.request_id
           and latest_intent.provider=latest_parent.provider
           and latest_intent.capability=latest_parent.capability
          where latest_parent.provider=candidate.provider
            and latest_parent.provider_parent_id=candidate.external_event_id
            and latest_intent.status in ('completed','partial')
          order by latest_parent.checked_at desc,latest_parent.inserted_at desc
          limit 1
        )
        and child_alias.present_in_current_snapshot
        and child_alias.identity_status='resolved'
        and child_alias.identity_classification in (
          'identified_real_option','aggregate_other_option','tie_option',
          'no_winner_option','provider_closed_child'
        )
        and child_alias.external_market_id is not distinct from
          nullif(candidate.normalized_payload ->> 'external_market_id','')
        and child_alias.child_occurrence_key
          =candidate.normalized_payload ->> 'parent_child_occurrence_key'
        and child_alias.child_fingerprint
          =candidate.normalized_payload ->> 'parent_child_fingerprint'
        and child_alias.payload_hash
          =candidate.normalized_payload ->> 'parent_child_integrity_hash'
        and child_alias.provider_contract_hash
          =candidate.normalized_payload ->> 'provider_child_contract_hash'
        and child_alias.provider_contract
          =candidate.normalized_payload -> 'provider_child_contract'
        and child_alias.provider_child_identity_key is not distinct from
          nullif(candidate.normalized_payload ->> 'parent_child_identity_key','')
        and (
          candidate.family_type not in (
            'categorical_outcomes','participant_options','platform_variants'
          )
          or (
            candidate.family_child_key=child_alias.canonical_child_key
            and candidate.family_child_label=child_alias.canonical_child_label
            and candidate.family_child_key like 'option:%'
            and candidate.family_child_key='option:'||private.market_family_option_slug_v2(
              child_alias.canonical_child_label,120
            )
            and candidate.family_child_label !~* '^\s*deadline:'
            and candidate.family_child_label !~* '\d{4}-\d{2}-\d{2}T\d{2}:\d{2}'
            and candidate.family_child_label !~* '^\s*(lt|lte|gt|gte)\s+\d'
            and candidate.family_child_label !~* '^\s*(ET|year)\s*$'
            and candidate.family_child_label !~* '^\s*(before|after|by|on\s+or\s+before|on\s+or\s+after|during|in|antes\s+de|despu[eé]s\s+de|hasta|durante|en)\s+\d{4}(\s|$)'
            and candidate.family_child_label !~* '^\s*\d{4}(\s*\((ET|year)\))?\s*$'
          )
        )
    );
$function$;
revoke all on function private.market_radar_candidate_reconciliation_bound_v1(private.external_market_candidates)
  from public,anon,authenticated,service_role;

create or replace function private.market_radar_candidate_reconciliation_ready_v1(
  candidate private.external_market_candidates
)
returns boolean
language sql
stable
security definer
set search_path to ''
as $function$
  select private.market_radar_candidate_reconciliation_bound_v1(candidate)
    and exists (
      select 1 from private.market_radar_parent_children_v1 child_alias
      where child_alias.id=candidate.current_parent_child_id
        and child_alias.parent_reconciliation_id=candidate.current_parent_reconciliation_id
        and child_alias.availability_status='open'
    );
$function$;
revoke all on function private.market_radar_candidate_reconciliation_ready_v1(private.external_market_candidates)
  from public,anon,authenticated,service_role;

alter function public.save_market_draft_from_radar(uuid,uuid,bigint,jsonb)
  rename to save_market_draft_from_radar_pre_parent_reconciliation_v1;
alter function public.save_market_draft_from_radar_intelligence(
  uuid,uuid,bigint,jsonb,uuid,jsonb,jsonb
) rename to save_market_draft_from_radar_intelligence_pre_parent_reconciliation_v1;
revoke all on function public.save_market_draft_from_radar_pre_parent_reconciliation_v1(
  uuid,uuid,bigint,jsonb
) from public,anon,authenticated,service_role;
revoke all on function public.save_market_draft_from_radar_intelligence_pre_parent_reconciliation_v1(
  uuid,uuid,bigint,jsonb,uuid,jsonb,jsonb
) from public,anon,authenticated,service_role;

create or replace function private.persist_market_radar_draft_origin_binding_v1(
  candidate_input private.external_market_candidates,
  draft_id_input uuid
)
returns private.market_drafts
language plpgsql
security definer
set search_path to ''
as $function$
declare
  draft private.market_drafts%rowtype;
  eligibility private.market_radar_eligibility_checks%rowtype;
  provenance jsonb;
begin
  select * into draft from private.market_drafts draft_alias
  where draft_alias.id=draft_id_input for update;
  if not found then raise exception 'DRAFT_NOT_FOUND' using errcode='P0001'; end if;
  perform private.assert_market_candidate_draft_identity_v1(candidate_input.id,to_jsonb(draft));
  select * into eligibility from private.market_radar_eligibility_checks check_alias
  where check_alias.id=candidate_input.current_eligibility_check_id;
  if not found or eligibility.candidate_id is distinct from candidate_input.id then
    raise exception 'RADAR_ELIGIBILITY_REQUIRED' using errcode='55000';
  end if;
  provenance:=coalesce(draft.source_provenance,'{}'::jsonb)||jsonb_build_object(
    'origin_type','radar_candidate','origin_candidate_id',candidate_input.id,
    'origin_fingerprint',coalesce(
      draft.source_provenance ->> 'origin_fingerprint',candidate_input.fingerprint
    ),
    'radar_candidate_id',candidate_input.id,
    'radar_analysis_binding',jsonb_build_object(
      'source_fingerprint',candidate_input.fingerprint,
      'provider_child_contract_hash',
        candidate_input.normalized_payload ->> 'provider_child_contract_hash',
      'family_version',candidate_input.family_version,'family_key',candidate_input.family_key,
      'family_child_key',candidate_input.family_child_key,
      'temporal_decision_hash',
        candidate_input.normalized_payload #>> '{temporal_contract,decision_hash}',
      'domain_fingerprint',candidate_input.normalized_payload ->> 'domain_fingerprint'
    ),
    'radar_identity_binding',jsonb_build_object(
      'family_version',candidate_input.family_version,'family_key',candidate_input.family_key,
      'family_child_key',candidate_input.family_child_key,
      'parent_reconciliation_fingerprint',
        candidate_input.normalized_payload ->> 'parent_reconciliation_fingerprint',
      'parent_reconciliation_integrity_hash',
        candidate_input.normalized_payload ->> 'parent_reconciliation_integrity_hash',
      'parent_child_fingerprint',
        candidate_input.normalized_payload ->> 'parent_child_fingerprint',
      'parent_child_integrity_hash',
        candidate_input.normalized_payload ->> 'parent_child_integrity_hash',
      'provider_child_contract_hash',
        candidate_input.normalized_payload ->> 'provider_child_contract_hash'
    ),
    'provider_truth',jsonb_build_object(
      'provider',candidate_input.provider,'external_id',candidate_input.external_id,
      'provider_child_contract',candidate_input.normalized_payload -> 'provider_child_contract',
      'provider_child_contract_hash',
        candidate_input.normalized_payload ->> 'provider_child_contract_hash'
    ),
    'temporal_contract',candidate_input.normalized_payload -> 'temporal_contract',
    'radar_preparation_revision',candidate_input.preparation_revision,
    'radar_eligibility_check_id',eligibility.id,
    'radar_eligibility_policy_version',eligibility.policy_version,
    'radar_eligibility_status',eligibility.status,
    'radar_eligibility_checked_at',eligibility.checked_at,
    'radar_eligibility_decision_hash',eligibility.decision_hash,
    'atomic_eligibility_gate',true,
    'binding_status','bound'
  );
  update private.market_drafts draft_alias set
    radar_candidate_id=candidate_input.id,
    intelligence_origin_type=coalesce(draft_alias.intelligence_origin_type,'radar_candidate'),
    intelligence_origin_id=coalesce(draft_alias.intelligence_origin_id,candidate_input.id::text),
    source_provenance=provenance
  where draft_alias.id=draft.id
    and (draft_alias.source_provenance is distinct from provenance
      or draft_alias.intelligence_origin_type is null
      or draft_alias.intelligence_origin_id is null
      or draft_alias.radar_candidate_id is distinct from candidate_input.id)
  returning * into draft;
  if not found then
    select * into draft from private.market_drafts draft_alias where draft_alias.id=draft_id_input;
  end if;
  if row(draft.family_version,draft.family_key,draft.family_type,
      draft.family_child_key,draft.family_child_label)
     is distinct from row(candidate_input.family_version,candidate_input.family_key,
      candidate_input.family_type,candidate_input.family_child_key,
      candidate_input.family_child_label) then
    raise exception 'CHILD_IDENTITY_MISMATCH' using errcode='55000';
  end if;
  return draft;
end;
$function$;
alter function private.persist_market_radar_draft_origin_binding_v1(
  private.external_market_candidates,uuid
) owner to postgres;
revoke all on function private.persist_market_radar_draft_origin_binding_v1(
  private.external_market_candidates,uuid
) from public,anon,authenticated,service_role;

create or replace function private.bind_market_radar_draft_eligibility_internal_v1(
  candidate_input private.external_market_candidates,
  draft_input private.market_drafts,
  eligibility_input private.market_radar_eligibility_checks,
  actor_id_input uuid,
  attempt_id_input uuid
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  binding_row private.market_draft_eligibility_bindings%rowtype;
  inserted_now boolean:=false;
begin
  if actor_id_input is null or attempt_id_input is null
     or candidate_input.id is null or draft_input.id is null or eligibility_input.id is null
     or draft_input.radar_candidate_id is distinct from candidate_input.id
     or candidate_input.prepared_draft_id is distinct from draft_input.id
     or candidate_input.current_eligibility_check_id is distinct from eligibility_input.id
     or draft_input.market_id is not null
     or eligibility_input.candidate_id is distinct from candidate_input.id
     or eligibility_input.decision_hash !~ '^[a-f0-9]{64}$'
     or draft_input.content_fingerprint !~ '^[a-f0-9]{64}$'
     or not (
       private.market_radar_candidate_reconciliation_bound_v1(candidate_input)
       or (candidate_input.normalizer_version='atinara-radar-v2'
         and candidate_input.state='prepared'
         and candidate_input.prepared_draft_id=draft_input.id)
     ) then
    raise exception 'INVALID_DRAFT_ELIGIBILITY_BINDING' using errcode='22023';
  end if;
  select * into binding_row
  from private.market_draft_eligibility_bindings binding_alias
  where binding_alias.attempt_id=attempt_id_input;
  if found then
    if binding_row.draft_id is distinct from draft_input.id
       or binding_row.draft_version is distinct from draft_input.content_version
       or binding_row.draft_fingerprint is distinct from lower(draft_input.content_fingerprint)
       or binding_row.candidate_id is distinct from candidate_input.id
       or binding_row.preparation_revision is distinct from candidate_input.preparation_revision
       or binding_row.eligibility_check_id is distinct from eligibility_input.id
       or binding_row.eligibility_decision_hash is distinct from eligibility_input.decision_hash then
      raise exception 'IDEMPOTENCY_KEY_REUSED' using errcode='23505';
    end if;
  else
    if eligibility_input.status<>'eligible'
       or eligibility_input.policy_version<>'atinara-prediction-policy-v5'
       or eligibility_input.expires_at<=clock_timestamp() then
      raise exception 'RADAR_ELIGIBILITY_REQUIRED' using errcode='55000';
    end if;
    insert into private.market_draft_eligibility_bindings(
      attempt_id,draft_id,draft_version,draft_fingerprint,candidate_id,
      preparation_revision,eligibility_check_id,eligibility_decision_hash,
      policy_version,bound_by
    ) values (
      attempt_id_input,draft_input.id,draft_input.content_version,
      lower(draft_input.content_fingerprint),candidate_input.id,
      candidate_input.preparation_revision,eligibility_input.id,
      eligibility_input.decision_hash,eligibility_input.policy_version,actor_id_input
    ) on conflict on constraint market_draft_eligibility_bindings_exact_unique do nothing
    returning * into binding_row;
    inserted_now:=found;
    if not found then
      select * into binding_row
      from private.market_draft_eligibility_bindings binding_alias
      where binding_alias.draft_id=draft_input.id
        and binding_alias.draft_version=draft_input.content_version
        and binding_alias.draft_fingerprint=lower(draft_input.content_fingerprint)
        and binding_alias.candidate_id=candidate_input.id
        and binding_alias.preparation_revision=candidate_input.preparation_revision
        and binding_alias.eligibility_check_id=eligibility_input.id
        and binding_alias.eligibility_decision_hash=eligibility_input.decision_hash
      order by binding_alias.id desc limit 1;
    end if;
  end if;
  if binding_row.id is null then
    raise exception 'RADAR_ELIGIBILITY_BINDING_CONFLICT' using errcode='40001';
  end if;
  if inserted_now then
    insert into private.market_admin_audit(actor_id,action_code,draft_id,draft_version,detail)
    values (actor_id_input,'RADAR_DRAFT_ELIGIBILITY_BOUND',draft_input.id,
      draft_input.content_version,jsonb_build_object(
        'candidate_id',candidate_input.id,
        'preparation_revision',candidate_input.preparation_revision,
        'eligibility_check_id',eligibility_input.id,
        'eligibility_decision_hash',eligibility_input.decision_hash,
        'binding_id',binding_row.id
      ));
  end if;
  return jsonb_build_object(
    'binding_id',binding_row.id,'draft_id',binding_row.draft_id,
    'draft_version',binding_row.draft_version,
    'draft_fingerprint',binding_row.draft_fingerprint,
    'candidate_id',binding_row.candidate_id,
    'preparation_revision',binding_row.preparation_revision,
    'eligibility_check_id',binding_row.eligibility_check_id,
    'bound_at',binding_row.bound_at,'changed',inserted_now,
    'idempotency_replay',not inserted_now
  );
end;
$function$;
alter function private.bind_market_radar_draft_eligibility_internal_v1(
  private.external_market_candidates,private.market_drafts,
  private.market_radar_eligibility_checks,uuid,uuid
) owner to postgres;
revoke all on function private.bind_market_radar_draft_eligibility_internal_v1(
  private.external_market_candidates,private.market_drafts,
  private.market_radar_eligibility_checks,uuid,uuid
) from public,anon,authenticated,service_role;

create or replace function public.bind_market_radar_draft_eligibility_v2(
  candidate_id_input uuid,
  draft_id_input uuid,
  expected_version_input bigint,
  expected_fingerprint_input text,
  expected_preparation_revision_input bigint,
  eligibility_check_id_input bigint,
  actor_id_input uuid,
  attempt_id_input uuid
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  candidate private.external_market_candidates%rowtype;
  draft private.market_drafts%rowtype;
  eligibility private.market_radar_eligibility_checks%rowtype;
begin
  if auth.role()<>'service_role' then
    raise exception 'SERVICE_ROLE_REQUIRED' using errcode='42501';
  end if;
  if actor_id_input is null or not exists (
    select 1 from auth.users user_alias where user_alias.id=actor_id_input
      and coalesce((user_alias.raw_app_meta_data ->> 'oraklo_admin')::boolean,false)
  ) then raise exception 'ADMIN_REQUIRED' using errcode='42501'; end if;
  if candidate_id_input is null or draft_id_input is null or attempt_id_input is null
     or expected_preparation_revision_input is null or expected_preparation_revision_input<1
     or eligibility_check_id_input is null
     or coalesce(expected_fingerprint_input,'') !~ '^[a-f0-9]{64}$' then
    raise exception 'INVALID_DRAFT_ELIGIBILITY_BINDING' using errcode='22023';
  end if;
  -- Orden global: candidate -> workflow advisory -> draft -> attempt.
  select * into candidate from private.external_market_candidates candidate_alias
  where candidate_alias.id=candidate_id_input for update;
  if not found then raise exception 'RADAR_CANDIDATE_NOT_FOUND' using errcode='P0001'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'market-draft-workflow:'||draft_id_input::text,0
  ));
  select * into draft from private.market_drafts draft_alias
  where draft_alias.id=draft_id_input for update;
  if not found then raise exception 'DRAFT_NOT_FOUND' using errcode='P0001'; end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(attempt_id_input::text,0)
  );
  if draft.content_version is distinct from expected_version_input
     or lower(draft.content_fingerprint) is distinct from lower(expected_fingerprint_input)
     or candidate.preparation_revision is distinct from expected_preparation_revision_input then
    raise exception 'DRAFT_VERSION_MOVED' using errcode='40001';
  end if;
  candidate:=private.assert_market_radar_candidate_eligible_v1(
    candidate.id,expected_preparation_revision_input
  );
  select * into eligibility from private.market_radar_eligibility_checks check_alias
  where check_alias.id=eligibility_check_id_input for share;
  if not found then raise exception 'RADAR_ELIGIBILITY_REQUIRED' using errcode='55000'; end if;
  return private.bind_market_radar_draft_eligibility_internal_v1(
    candidate,draft,eligibility,actor_id_input,attempt_id_input
  );
end;
$function$;
alter function public.bind_market_radar_draft_eligibility_v2(
  uuid,uuid,bigint,text,bigint,bigint,uuid,uuid
) owner to postgres;
revoke all on function public.bind_market_radar_draft_eligibility_v2(
  uuid,uuid,bigint,text,bigint,bigint,uuid,uuid
) from public,anon,authenticated,service_role;
grant execute on function public.bind_market_radar_draft_eligibility_v2(
  uuid,uuid,bigint,text,bigint,bigint,uuid,uuid
) to service_role;

create or replace function public.save_market_draft_from_radar(
  candidate_id_input uuid,
  draft_id_input uuid,
  expected_version_input bigint,
  draft_input jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  actor_id_value uuid:=private.require_current_admin();
  candidate private.external_market_candidates%rowtype;
  eligibility private.market_radar_eligibility_checks%rowtype;
  submitted_revision bigint;
  operation_id uuid;
  prepared_replay boolean:=false;
  result jsonb;
  saved_draft private.market_drafts%rowtype;
  binding jsonb;
begin
  if jsonb_typeof(draft_input)<>'object'
     or coalesce(draft_input ->> '_radar_preparation_revision','') !~ '^[1-9][0-9]*$'
     or nullif(draft_input ->> '_idempotency_key','') is null then
    raise exception 'RADAR_PREPARATION_REVISION_MISMATCH' using errcode='40001';
  end if;
  begin
    submitted_revision:=(draft_input ->> '_radar_preparation_revision')::bigint;
    operation_id:=(draft_input ->> '_idempotency_key')::uuid;
  exception when invalid_text_representation or numeric_value_out_of_range then
    raise exception 'INVALID_IDEMPOTENCY_KEY' using errcode='22023';
  end;
  select * into candidate from private.external_market_candidates candidate_alias
  where candidate_alias.id=candidate_id_input for update;
  if not found then raise exception 'RADAR_CANDIDATE_NOT_FOUND' using errcode='P0001'; end if;
  prepared_replay:=candidate.state='prepared'
    and candidate.preparation_revision=submitted_revision+1
    and candidate.prepared_draft_id is not null and draft_id_input is null;
  if candidate.normalizer_version='atinara-radar-v2' then
    if not prepared_replay then
      raise exception 'RADAR_NORMALIZER_OUTDATED' using errcode='55000';
    end if;
    result:=public.save_market_draft_from_radar_pre_parent_reconciliation_v1(
      candidate_id_input,draft_id_input,expected_version_input,draft_input
    );
    if nullif(result #>> '{draft,id}','')::uuid is distinct from candidate.prepared_draft_id then
      raise exception 'RADAR_DRAFT_SCOPE_MISMATCH' using errcode='55000';
    end if;
    return result||jsonb_build_object(
      'identity_contract_version','atinara-radar-prepared-legacy-identity-v1'
    );
  elsif candidate.normalizer_version<>'atinara-radar-v3' then
    raise exception 'RADAR_NORMALIZER_OUTDATED' using errcode='55000';
  end if;

  if draft_id_input is not null then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
      'market-draft-workflow:'||draft_id_input::text,0
    ));
  end if;
  if not prepared_replay then
    candidate:=private.assert_market_radar_candidate_eligible_v1(
      candidate.id,submitted_revision
    );
    if candidate.state<>'available' then
      raise exception 'RADAR_CANDIDATE_NOT_PREPARABLE' using errcode='55000';
    end if;
    if not private.market_radar_candidate_reconciliation_ready_v1(candidate) then
      raise exception 'RADAR_PARENT_RECONCILIATION_INCOMPLETE' using errcode='55000';
    end if;
    perform private.assert_market_radar_candidate_no_live_duplicate_v1(candidate);
    perform private.assert_market_candidate_draft_identity_v1(candidate.id,draft_input);
  end if;
  result:=public.save_market_draft(
    draft_id_input,expected_version_input,
    draft_input-'_radar_fact_check_id'-'_radar_eligibility_check_id'
  );
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'market-draft-workflow:'||(result #>> '{draft,id}'),0
  ));
  select * into saved_draft from private.market_drafts draft_alias
  where draft_alias.id=(result #>> '{draft,id}')::uuid for update;
  if not found then raise exception 'DRAFT_NOT_FOUND' using errcode='P0001'; end if;
  if prepared_replay then
    if saved_draft.id is distinct from candidate.prepared_draft_id
       or saved_draft.radar_candidate_id is distinct from candidate.id then
      raise exception 'RADAR_DRAFT_SCOPE_MISMATCH' using errcode='55000';
    end if;
  else
    update private.market_drafts draft_alias set
      radar_candidate_id=candidate.id,
      source_provenance=coalesce(draft_alias.source_provenance,'{}'::jsonb)
        ||jsonb_build_object(
          'origin_type','radar_candidate','origin_candidate_id',candidate.id,
          'provider',candidate.provider,'external_id',candidate.external_id,
          'event_group_key',candidate.event_group_key
        )
    where draft_alias.id=saved_draft.id;
    update private.external_market_candidates candidate_alias set
      state='prepared',prepared_draft_id=saved_draft.id,updated_at=clock_timestamp()
    where candidate_alias.id=candidate.id and candidate_alias.state='available';
    if not found then raise exception 'RADAR_CANDIDATE_NOT_PREPARABLE' using errcode='40001'; end if;
    insert into private.market_admin_audit(actor_id,action_code,draft_id,draft_version,detail)
    values (actor_id_value,'RADAR_DRAFT_PREPARED',saved_draft.id,
      saved_draft.content_version,jsonb_build_object(
        'provider',candidate.provider,'external_id',candidate.external_id,
        'event_group_key',candidate.event_group_key,
        'eligibility_check_id',candidate.current_eligibility_check_id,
        'idempotency_replay',false
      ));
  end if;
  select * into candidate from private.external_market_candidates candidate_alias
  where candidate_alias.id=candidate_id_input for update;
  if candidate.state<>'prepared' or candidate.prepared_draft_id<>saved_draft.id
     or candidate.preparation_revision<>submitted_revision+1 then
    raise exception 'RADAR_PREPARATION_REVISION_MISMATCH' using errcode='40001';
  end if;
  saved_draft:=private.persist_market_radar_draft_origin_binding_v1(
    candidate,saved_draft.id
  );
  select * into eligibility from private.market_radar_eligibility_checks check_alias
  where check_alias.id=candidate.current_eligibility_check_id for share;
  if not found then raise exception 'RADAR_ELIGIBILITY_REQUIRED' using errcode='55000'; end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(operation_id::text,0)
  );
  binding:=private.bind_market_radar_draft_eligibility_internal_v1(
    candidate,saved_draft,eligibility,actor_id_value,operation_id
  );
  return result||jsonb_build_object('draft',to_jsonb(saved_draft),
    'identity_contract_version','atinara-radar-preparation-identity-v1',
    'radar_eligibility_check_id',eligibility.id,
    'radar_eligibility_policy_version',eligibility.policy_version,
    'draft_eligibility_binding',binding,'atomic_eligibility_gate',true,
    'radar_candidate_replay',prepared_replay,'atomic',true);
end;
$function$;
alter function public.save_market_draft_from_radar(uuid,uuid,bigint,jsonb) owner to postgres;
revoke all on function public.save_market_draft_from_radar(uuid,uuid,bigint,jsonb)
  from public,anon,authenticated,service_role;
grant execute on function public.save_market_draft_from_radar(uuid,uuid,bigint,jsonb)
  to authenticated;

create or replace function public.save_market_draft_from_radar_intelligence_without_revision_guard(
  candidate_id_input uuid,draft_id_input uuid,expected_version_input bigint,
  draft_input jsonb,expert_run_id_input uuid,contract_input jsonb,sources_input jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  actor_id uuid:=private.require_current_admin();
  candidate private.external_market_candidates%rowtype;
  run_row private.market_expert_runs%rowtype;
  active_binding private.market_source_bindings%rowtype;
  save_result jsonb;
  saved_draft_id uuid;
  binding_result jsonb;
  persisted_sources jsonb:='[]'::jsonb;
  expected_binding_contract jsonb;
  primary_count integer;
  invalid_source_count integer;
  duplicate_precedence_count integer;
  contract_evaluation_at timestamptz;
  draft_evaluation_at timestamptz;
  contract_primary_url text;
  draft_primary_url text;
  run_preparation_revision bigint;
  expert_prepared_replay boolean:=false;
begin
  if candidate_id_input is null or expert_run_id_input is null then
    raise exception 'RADAR_EXPERT_INPUT_REQUIRED' using errcode='22023';
  end if;
  if draft_id_input is not null then
    raise exception 'RADAR_EXPERT_DRAFT_MUST_BE_NEW' using errcode='22023';
  end if;
  if jsonb_typeof(coalesce(draft_input,'{}'::jsonb))<>'object'
     or jsonb_typeof(coalesce(contract_input,'{}'::jsonb))<>'object'
     or jsonb_typeof(coalesce(sources_input,'[]'::jsonb))<>'array' then
    raise exception 'RADAR_EXPERT_PAYLOAD_INVALID' using errcode='22023';
  end if;
  select * into candidate from private.external_market_candidates candidate_alias
  where candidate_alias.id=candidate_id_input for update;
  if not found then
    raise exception 'RADAR_CANDIDATE_NOT_FOUND' using errcode='P0001';
  end if;
  select * into run_row from private.market_expert_runs run_alias
  where run_alias.id=expert_run_id_input
    and run_alias.origin_type='radar_candidate'
    and run_alias.origin_id=candidate_id_input::text
    and run_alias.status='completed';
  begin
    run_preparation_revision:=nullif(
      run_row.result_json ->> 'origin_preparation_revision',''
    )::bigint;
  exception when invalid_text_representation or numeric_value_out_of_range then
    run_preparation_revision:=null;
  end;
  expert_prepared_replay:=candidate.state='prepared'
    and candidate.prepared_draft_id is not null and draft_id_input is null
    and run_preparation_revision is not null
    and candidate.preparation_revision=run_preparation_revision+1
    and draft_input ->> '_radar_preparation_revision'=run_preparation_revision::text
    and nullif(draft_input ->> '_idempotency_key','') is not null;
  if not found
     or run_row.policy_version<>'atinara-market-constitution-v1'
     or run_row.schema_version<>'atinara-market-expert-v1'
     or run_row.result_json ->> 'origin_analysis_fingerprint'
       is distinct from run_row.origin_fingerprint
     or run_row.result_json ->> 'origin_source_fingerprint'
       is distinct from candidate.fingerprint
     or not (
       run_preparation_revision is not distinct from candidate.preparation_revision
       or expert_prepared_replay
     ) then
    raise exception 'MARKET_EXPERT_ANALYSIS_REQUIRED' using errcode='22023';
  end if;
  if run_row.decision not in ('create','create_with_edits')
     or run_row.integrity_status not in ('pass','needs_edit')
     or run_row.forecastability_status not in (
       'forecastable','valid_low_probability','valid_very_unlikely'
     ) or run_row.source_readiness not in (
       'ready','ready_with_warnings','needs_monitoring'
     ) then
    raise exception 'MARKET_EXPERT_DECISION_BLOCKED' using errcode='22023';
  end if;
  if coalesce(contract_input ->> 'contract_schema_version','')
       <>'atinara-resolution-contract-v1'
     or coalesce(contract_input ->> 'policy_version','')<>run_row.policy_version
     or coalesce(contract_input ->> 'origin_type','')<>'radar_candidate'
     or coalesce(contract_input ->> 'origin_id','')<>candidate_id_input::text then
    raise exception 'RESOLUTION_PLAN_VERSION_MISMATCH' using errcode='22023';
  end if;
  begin
    contract_evaluation_at:=coalesce(
      nullif(contract_input ->> 'evaluation_at','')::timestamptz,
      nullif(contract_input ->> 'window_end','')::timestamptz
    );
    draft_evaluation_at:=nullif(draft_input ->> 'evaluation_ends_at','')::timestamptz;
  exception when invalid_datetime_format then
    raise exception 'INVALID_DRAFT_DATE' using errcode='22007';
  end;
  if nullif(trim(contract_input ->> 'canonical_statement'),'') is null
     or contract_evaluation_at is null or draft_evaluation_at is null then
    raise exception 'RESOLUTION_PLAN_REQUIRED' using errcode='22023';
  end if;
  if trim(contract_input ->> 'canonical_statement')
       <>trim(coalesce(draft_input ->> 'question',''))
     or contract_evaluation_at<>draft_evaluation_at then
    raise exception 'RESOLUTION_PLAN_DRAFT_MISMATCH' using errcode='22023';
  end if;
  if jsonb_typeof(coalesce(contract_input -> 'sources','[]'::jsonb))<>'array'
     or coalesce(contract_input -> 'sources','[]'::jsonb)<>sources_input then
    raise exception 'RESOLUTION_SOURCE_ASSIGNMENT_MISMATCH' using errcode='22023';
  end if;
  select
    count(*) filter(where item ->> 'role'='PRIMARY_RESOLUTION'),
    count(*) filter(where coalesce(item ->> 'url','')!~'^https://'
      or coalesce(item ->> 'role','') not in (
        'DISCOVERY_SIGNAL','PROBABILITY_SIGNAL','CONTEXT_SOURCE',
        'PRIMARY_RESOLUTION','FALLBACK_RESOLUTION','CORROBORATION',
        'PROHIBITED_FOR_RESOLUTION'
      ) or coalesce(item ->> 'precedence','')!~'^[1-9][0-9]*$'
      or case when coalesce(item ->> 'precedence','')~'^[1-9][0-9]*$'
        then (item ->> 'precedence')::integer<1 else true end),
    count(*)-count(distinct(item ->> 'precedence'))
  into primary_count,invalid_source_count,duplicate_precedence_count
  from jsonb_array_elements(sources_input) source_rows(item);
  if primary_count<>1 then
    raise exception 'RESOLUTION_PRIMARY_SOURCE_REQUIRED' using errcode='22023';
  end if;
  select item ->> 'url' into contract_primary_url
  from jsonb_array_elements(sources_input) source_rows(item)
  where item ->> 'role'='PRIMARY_RESOLUTION' limit 1;
  draft_primary_url:=nullif(trim(draft_input -> 'primary_source' ->> 'url'),'');
  if contract_primary_url is null or draft_primary_url is null
     or contract_primary_url<>draft_primary_url then
    raise exception 'RESOLUTION_PRIMARY_SOURCE_DRAFT_MISMATCH' using errcode='22023';
  end if;
  if invalid_source_count>0 or duplicate_precedence_count>0 then
    raise exception 'RESOLUTION_SOURCE_ASSIGNMENT_INVALID' using errcode='22023';
  end if;

  -- Único corte V3: el helper editorial valida run/contrato/fuentes y delega
  -- toda identidad, elegibilidad, idempotencia y binding Radar al writer nuevo.
  save_result:=public.save_market_draft_from_radar(
    candidate_id_input,draft_id_input,expected_version_input,draft_input
  );
  saved_draft_id:=(save_result #>> '{draft,id}')::uuid;
  if coalesce((save_result ->> 'idempotency_replay')::boolean,false) then
    select * into active_binding from private.market_source_bindings binding_alias
    where binding_alias.draft_id=saved_draft_id and binding_alias.status<>'superseded'
    order by binding_alias.plan_version desc,binding_alias.created_at desc limit 1;
    expected_binding_contract:=jsonb_set(contract_input,'{sources}',sources_input,true);
    select coalesce(jsonb_agg(jsonb_build_object(
      'url',source_alias.source_url,'role',source_alias.role,
      'precedence',source_alias.precedence,
      'fallback_condition',source_alias.fallback_condition,
      'required',source_alias.required
    ) order by source_alias.precedence,source_alias.id),'[]'::jsonb)
    into persisted_sources
    from private.market_source_binding_sources source_alias
    where source_alias.binding_id=active_binding.id;
    if active_binding.id is null
       or active_binding.origin_type is distinct from 'radar_candidate'
       or active_binding.origin_id is distinct from candidate_id_input::text
       or active_binding.expert_run_id is distinct from run_row.id
       or active_binding.resolution_contract is distinct from expected_binding_contract
       or persisted_sources is distinct from sources_input then
      raise exception 'RADAR_PREPARATION_REVISION_MISMATCH' using errcode='40001';
    end if;
    binding_result:=jsonb_build_object(
      'required',true,'changed',false,'compatible',true,
      'binding_id',active_binding.id,'plan_version',active_binding.plan_version,
      'origin_type',active_binding.origin_type,'origin_id',active_binding.origin_id,
      'expert_run_id',active_binding.expert_run_id,'idempotent',true
    );
  else
    binding_result:=public.bind_market_draft_intelligence(
      saved_draft_id,'radar_candidate',candidate_id_input::text,
      run_row.id,contract_input,sources_input
    );
  end if;
  return save_result||jsonb_build_object(
    'intelligence_binding',binding_result,'expert_run_id',run_row.id,
    'origin_type','radar_candidate','origin_id',candidate_id_input::text,
    'atomic',true,'published',false,'resolved',false,
    'actor_id_recorded',actor_id is not null
  );
end;
$function$;
alter function public.save_market_draft_from_radar_intelligence_without_revision_guard(
  uuid,uuid,bigint,jsonb,uuid,jsonb,jsonb
) owner to postgres;
revoke all on function public.save_market_draft_from_radar_intelligence_without_revision_guard(
  uuid,uuid,bigint,jsonb,uuid,jsonb,jsonb
) from public,anon,authenticated,service_role;

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
set search_path to ''
as $function$
declare
  result jsonb;
begin
  perform private.require_current_admin();
  -- La implementación sin guard de revisión valida el run/contrato/fuentes y
  -- delega una sola vez en el writer público V3 anterior. No reentra en la
  -- cadena pre-parent ni duplica el binding del Market Expert.
  result:=public.save_market_draft_from_radar_intelligence_without_revision_guard(
    candidate_id_input,draft_id_input,expected_version_input,draft_input,
    expert_run_id_input,contract_input,sources_input
  );
  return result||jsonb_build_object(
    'identity_contract_version','atinara-radar-preparation-identity-v1'
  );
end;
$function$;
alter function public.save_market_draft_from_radar_intelligence(
  uuid,uuid,bigint,jsonb,uuid,jsonb,jsonb
) owner to postgres;
revoke all on function public.save_market_draft_from_radar_intelligence(
  uuid,uuid,bigint,jsonb,uuid,jsonb,jsonb
) from public,anon,authenticated,service_role;
grant execute on function public.save_market_draft_from_radar_intelligence(
  uuid,uuid,bigint,jsonb,uuid,jsonb,jsonb
) to authenticated;

create or replace function private.lock_market_draft_workflow_scope_v1(
  draft_id_input uuid
)
returns private.market_drafts
language plpgsql
security definer
set search_path to ''
as $function$
declare
  initial_draft private.market_drafts%rowtype;
  locked_draft private.market_drafts%rowtype;
  candidate_id_value uuid;
  locked_candidate_id uuid;
begin
  select * into initial_draft from private.market_drafts draft_alias
  where draft_alias.id=draft_id_input;
  if not found then raise exception 'DRAFT_NOT_FOUND' using errcode='P0001'; end if;
  candidate_id_value:=initial_draft.radar_candidate_id;
  if candidate_id_value is null
     and initial_draft.intelligence_origin_type='radar_candidate'
     and coalesce(initial_draft.intelligence_origin_id,'')
       ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$' then
    candidate_id_value:=initial_draft.intelligence_origin_id::uuid;
  end if;
  if candidate_id_value is not null then
    select candidate_alias.id into locked_candidate_id
    from private.external_market_candidates candidate_alias
    where candidate_alias.id=candidate_id_value for update;
    if not found then
      raise exception 'RADAR_CANDIDATE_NOT_FOUND' using errcode='P0001';
    end if;
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'market-draft-workflow:'||draft_id_input::text,0
  ));
  select * into locked_draft from private.market_drafts draft_alias
  where draft_alias.id=draft_id_input for update;
  if not found then raise exception 'DRAFT_NOT_FOUND' using errcode='P0001'; end if;
  if candidate_id_value is distinct from coalesce(
       locked_draft.radar_candidate_id,
       case when locked_draft.intelligence_origin_type='radar_candidate'
          and coalesce(locked_draft.intelligence_origin_id,'')
            ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'
         then locked_draft.intelligence_origin_id::uuid else null end
     ) then
    raise exception 'DRAFT_VERSION_MOVED' using errcode='40001';
  end if;
  return locked_draft;
end;
$function$;
alter function private.lock_market_draft_workflow_scope_v1(uuid) owner to postgres;
revoke all on function private.lock_market_draft_workflow_scope_v1(uuid)
  from public,anon,authenticated,service_role;

alter function public.apply_market_draft_expert_repair_with_checkpoint_v1(
  uuid,bigint,jsonb,jsonb,jsonb,uuid,jsonb,uuid,smallint,uuid,uuid,jsonb
) rename to apply_market_draft_expert_repair_checkpoint_pre_parent_v1;
alter function public.begin_market_draft_repair_workflow_v1(uuid,bigint,uuid)
  rename to begin_market_draft_repair_workflow_pre_parent_v1;
alter function public.checkpoint_market_draft_repair_noop_v1(
  uuid,uuid,bigint,smallint,uuid,uuid,jsonb
) rename to checkpoint_market_draft_repair_noop_pre_parent_v1;
alter function public.complete_market_draft_repair_workflow_v1(
  uuid,text,text,text,boolean,text,text,bigint,text,jsonb,uuid,text,text,text,text,text
) rename to complete_market_draft_repair_workflow_pre_parent_v1;
alter function public.reconcile_market_draft_repair_workflow_v1(uuid)
  rename to reconcile_market_draft_repair_workflow_pre_parent_v1;

revoke all on function public.apply_market_draft_expert_repair_checkpoint_pre_parent_v1(
  uuid,bigint,jsonb,jsonb,jsonb,uuid,jsonb,uuid,smallint,uuid,uuid,jsonb
) from public,anon,authenticated,service_role;
revoke all on function public.begin_market_draft_repair_workflow_pre_parent_v1(
  uuid,bigint,uuid
) from public,anon,authenticated,service_role;
revoke all on function public.checkpoint_market_draft_repair_noop_pre_parent_v1(
  uuid,uuid,bigint,smallint,uuid,uuid,jsonb
) from public,anon,authenticated,service_role;
revoke all on function public.complete_market_draft_repair_workflow_pre_parent_v1(
  uuid,text,text,text,boolean,text,text,bigint,text,jsonb,uuid,text,text,text,text,text
) from public,anon,authenticated,service_role;
revoke all on function public.reconcile_market_draft_repair_workflow_pre_parent_v1(uuid)
  from public,anon,authenticated,service_role;

create or replace function public.apply_market_draft_expert_repair_with_checkpoint_v1(
  draft_id_input uuid,expected_version_input bigint,draft_input jsonb,
  contract_input jsonb,sources_input jsonb,primary_source_check_id_input uuid,
  repair_meta_input jsonb,workflow_attempt_id_input uuid,repair_round_input smallint,
  repair_request_id_input uuid,review_attempt_id_input uuid,workflow_issue_ids_input jsonb
)
returns jsonb language plpgsql security definer set search_path to ''
as $function$
begin
  perform private.lock_market_draft_workflow_scope_v1(draft_id_input);
  return public.apply_market_draft_expert_repair_checkpoint_pre_parent_v1(
    draft_id_input,expected_version_input,draft_input,contract_input,sources_input,
    primary_source_check_id_input,repair_meta_input,workflow_attempt_id_input,
    repair_round_input,repair_request_id_input,review_attempt_id_input,workflow_issue_ids_input
  );
end;
$function$;

create or replace function public.begin_market_draft_repair_workflow_v1(
  draft_id_input uuid,expected_version_input bigint,request_key_input uuid
)
returns jsonb language plpgsql security definer set search_path to ''
as $function$
begin
  perform private.lock_market_draft_workflow_scope_v1(draft_id_input);
  return public.begin_market_draft_repair_workflow_pre_parent_v1(
    draft_id_input,expected_version_input,request_key_input
  );
end;
$function$;

create or replace function public.checkpoint_market_draft_repair_noop_v1(
  workflow_attempt_id_input uuid,draft_id_input uuid,expected_version_input bigint,
  repair_round_input smallint,repair_request_id_input uuid,review_attempt_id_input uuid,
  workflow_issue_ids_input jsonb
)
returns jsonb language plpgsql security definer set search_path to ''
as $function$
begin
  perform private.lock_market_draft_workflow_scope_v1(draft_id_input);
  return public.checkpoint_market_draft_repair_noop_pre_parent_v1(
    workflow_attempt_id_input,draft_id_input,expected_version_input,repair_round_input,
    repair_request_id_input,review_attempt_id_input,workflow_issue_ids_input
  );
end;
$function$;

create or replace function public.complete_market_draft_repair_workflow_v1(
  attempt_id_input uuid,status_input text,phase_input text,classification_input text,
  retryable_input boolean,error_code_input text,patch_fingerprint_input text,
  resulting_version_input bigint,resulting_fingerprint_input text,response_payload_input jsonb,
  draft_id_input uuid,repair_status_input text,owner_stage_input text,next_action_input text,
  workflow_issue_status_input text,resolution_method_input text
)
returns jsonb language plpgsql security definer set search_path to ''
as $function$
begin
  perform private.lock_market_draft_workflow_scope_v1(draft_id_input);
  return public.complete_market_draft_repair_workflow_pre_parent_v1(
    attempt_id_input,status_input,phase_input,classification_input,retryable_input,
    error_code_input,patch_fingerprint_input,resulting_version_input,
    resulting_fingerprint_input,response_payload_input,draft_id_input,repair_status_input,
    owner_stage_input,next_action_input,workflow_issue_status_input,resolution_method_input
  );
end;
$function$;

create or replace function public.reconcile_market_draft_repair_workflow_v1(
  attempt_id_input uuid
)
returns jsonb language plpgsql security definer set search_path to ''
as $function$
declare
  draft_id_value uuid;
begin
  select attempt.draft_id into draft_id_value from private.market_repair_attempts attempt
  where attempt.id=attempt_id_input;
  if not found then raise exception 'REPAIR_ATTEMPT_NOT_FOUND' using errcode='P0001'; end if;
  perform private.lock_market_draft_workflow_scope_v1(draft_id_value);
  return public.reconcile_market_draft_repair_workflow_pre_parent_v1(
    attempt_id_input
  );
end;
$function$;

alter function public.apply_market_draft_expert_repair_with_checkpoint_v1(
  uuid,bigint,jsonb,jsonb,jsonb,uuid,jsonb,uuid,smallint,uuid,uuid,jsonb
) owner to postgres;
alter function public.begin_market_draft_repair_workflow_v1(uuid,bigint,uuid) owner to postgres;
alter function public.checkpoint_market_draft_repair_noop_v1(
  uuid,uuid,bigint,smallint,uuid,uuid,jsonb
) owner to postgres;
alter function public.complete_market_draft_repair_workflow_v1(
  uuid,text,text,text,boolean,text,text,bigint,text,jsonb,uuid,text,text,text,text,text
) owner to postgres;
alter function public.reconcile_market_draft_repair_workflow_v1(uuid) owner to postgres;
revoke all on function public.apply_market_draft_expert_repair_with_checkpoint_v1(
  uuid,bigint,jsonb,jsonb,jsonb,uuid,jsonb,uuid,smallint,uuid,uuid,jsonb
) from public,anon,authenticated,service_role;
revoke all on function public.begin_market_draft_repair_workflow_v1(uuid,bigint,uuid)
  from public,anon,authenticated,service_role;
revoke all on function public.checkpoint_market_draft_repair_noop_v1(
  uuid,uuid,bigint,smallint,uuid,uuid,jsonb
) from public,anon,authenticated,service_role;
revoke all on function public.complete_market_draft_repair_workflow_v1(
  uuid,text,text,text,boolean,text,text,bigint,text,jsonb,uuid,text,text,text,text,text
) from public,anon,authenticated,service_role;
revoke all on function public.reconcile_market_draft_repair_workflow_v1(uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.apply_market_draft_expert_repair_with_checkpoint_v1(
  uuid,bigint,jsonb,jsonb,jsonb,uuid,jsonb,uuid,smallint,uuid,uuid,jsonb
) to authenticated;
grant execute on function public.begin_market_draft_repair_workflow_v1(uuid,bigint,uuid)
  to authenticated;
grant execute on function public.checkpoint_market_draft_repair_noop_v1(
  uuid,uuid,bigint,smallint,uuid,uuid,jsonb
) to authenticated;
grant execute on function public.complete_market_draft_repair_workflow_v1(
  uuid,text,text,text,boolean,text,text,bigint,text,jsonb,uuid,text,text,text,text,text
) to service_role;
grant execute on function public.reconcile_market_draft_repair_workflow_v1(uuid)
  to service_role;

alter function public.publish_market_draft_v2(uuid,bigint,timestamptz,uuid)
  rename to publish_market_draft_pre_parent_v1;
revoke all on function public.publish_market_draft_pre_parent_v1(
  uuid,bigint,timestamptz,uuid
) from public,anon,authenticated,service_role;

create or replace function public.publish_market_draft_v2(
  draft_id_input uuid,
  expected_version_input bigint,
  scheduled_for_input timestamptz default null,
  request_id_input uuid default gen_random_uuid()
)
returns jsonb language plpgsql security definer set search_path to ''
as $function$
begin
  perform private.lock_market_draft_workflow_scope_v1(draft_id_input);
  return public.publish_market_draft_pre_parent_v1(
    draft_id_input,expected_version_input,scheduled_for_input,request_id_input
  );
end;
$function$;
alter function public.publish_market_draft_v2(uuid,bigint,timestamptz,uuid)
  owner to postgres;
revoke all on function public.publish_market_draft_v2(uuid,bigint,timestamptz,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.publish_market_draft_v2(uuid,bigint,timestamptz,uuid)
  to authenticated;

create or replace function private.try_lock_market_draft_workflow_scope_v1(
  draft_id_input uuid
)
returns private.market_drafts
language plpgsql
security definer
set search_path to ''
as $function$
declare
  initial_draft private.market_drafts%rowtype;
  locked_draft private.market_drafts%rowtype;
  candidate_id_value uuid;
  locked_candidate_id uuid;
begin
  select * into initial_draft from private.market_drafts draft_alias
  where draft_alias.id=draft_id_input;
  if not found then return null; end if;
  candidate_id_value:=initial_draft.radar_candidate_id;
  if candidate_id_value is null
     and initial_draft.intelligence_origin_type='radar_candidate'
     and coalesce(initial_draft.intelligence_origin_id,'')
       ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$' then
    candidate_id_value:=initial_draft.intelligence_origin_id::uuid;
  end if;
  if candidate_id_value is not null then
    select candidate_alias.id into locked_candidate_id
    from private.external_market_candidates candidate_alias
    where candidate_alias.id=candidate_id_value for update skip locked;
    if not found then return null; end if;
  end if;
  if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended(
    'market-draft-workflow:'||draft_id_input::text,0
  )) then return null; end if;
  select * into locked_draft from private.market_drafts draft_alias
  where draft_alias.id=draft_id_input for update skip locked;
  if not found then return null; end if;
  if candidate_id_value is distinct from coalesce(
       locked_draft.radar_candidate_id,
       case when locked_draft.intelligence_origin_type='radar_candidate'
          and coalesce(locked_draft.intelligence_origin_id,'')
            ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'
         then locked_draft.intelligence_origin_id::uuid else null end
     ) then return null; end if;
  return locked_draft;
end;
$function$;
alter function private.try_lock_market_draft_workflow_scope_v1(uuid) owner to postgres;
revoke all on function private.try_lock_market_draft_workflow_scope_v1(uuid)
  from public,anon,authenticated,service_role;

create or replace function public.publish_due_market_drafts_v2(limit_count integer default 20)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  draft private.market_drafts%rowtype;
  draft_id_value uuid;
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
  target_count integer:=least(greatest(coalesce(limit_count,20),1),100);
  claimed_count integer:=0;
begin
  if auth.role()<>'service_role' then
    raise exception 'SERVICE_ROLE_REQUIRED' using errcode='42501';
  end if;
  -- Dos workers pueden inspeccionar la misma ventana. Cada claim intenta en
  -- orden candidate -> advisory -> draft y salta cualquier scope retenido.
  for draft_id_value in
    select draft_row.id from private.market_drafts draft_row
    where draft_row.workflow_status='scheduled'
      and draft_row.scheduled_for<=clock_timestamp()
      and coalesce(draft_row.publication_schedule_status,'scheduled_waiting')
        in ('scheduled_waiting','scheduled_retry')
      and (draft_row.publication_next_retry_at is null
        or draft_row.publication_next_retry_at<=clock_timestamp())
    order by draft_row.scheduled_for,draft_row.id
    limit least(greatest(target_count*10,100),1000)
  loop
    exit when claimed_count>=target_count;
    draft:=private.try_lock_market_draft_workflow_scope_v1(draft_id_value);
    if draft.id is null
       or draft.workflow_status<>'scheduled'
       or draft.scheduled_for>clock_timestamp()
       or coalesce(draft.publication_schedule_status,'scheduled_waiting')
          not in ('scheduled_waiting','scheduled_retry')
       or (draft.publication_next_retry_at is not null
         and draft.publication_next_retry_at>clock_timestamp()) then
      continue;
    end if;
    claimed_count:=claimed_count+1;
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
      else error_code_value:=issue ->> 'issue_code'; end if;
      retryable_value:=retryable_value and (issue ->> 'retryable')::boolean;
      issue:=jsonb_set(issue,'{retryable}',to_jsonb(retryable_value),true);
      if existing_issue_value then issue_id_value:=(issue ->> 'issue_id')::uuid;
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
    'published_count',jsonb_array_length(published),'failed_count',jsonb_array_length(failed),
    'claimed_count',claimed_count,'claim_order','candidate_advisory_draft');
end;
$function$;
alter function public.publish_due_market_drafts_v2(integer) owner to postgres;
revoke all on function public.publish_due_market_drafts_v2(integer)
  from public,anon,authenticated,service_role;
grant execute on function public.publish_due_market_drafts_v2(integer) to service_role;

create or replace function public.get_market_radar_candidate(candidate_id_input uuid)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  candidate private.external_market_candidates%rowtype;
  ready boolean;
  legacy_prepared boolean;
begin
  perform private.require_current_admin();
  select * into candidate from private.external_market_candidates candidate_alias
  where candidate_alias.id=candidate_id_input;
  if not found then raise exception 'RADAR_CANDIDATE_NOT_FOUND' using errcode='P0001'; end if;
  ready:=private.market_radar_candidate_reconciliation_ready_v1(candidate);
  legacy_prepared:=candidate.normalizer_version='atinara-radar-v2'
    and candidate.state='prepared' and candidate.prepared_draft_id is not null;
  return private.market_radar_eligibility_payload(candidate)||jsonb_build_object(
    'current_reconciliation_ready',ready,
    'legacy_snapshot',candidate.normalizer_version<>'atinara-radar-v3',
    'advancement_gate',jsonb_build_object(
      'can_analyze',ready or legacy_prepared,
      'can_prepare',ready,
      'blocked_code',case when ready then null else 'RADAR_PARENT_RECONCILIATION_INCOMPLETE' end,
      'retryable',not ready
    )
  );
end;
$function$;
alter function public.get_market_radar_candidate(uuid) owner to postgres;
revoke all on function public.get_market_radar_candidate(uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.get_market_radar_candidate(uuid) to authenticated;

create or replace function public.get_market_radar_candidate_for_revalidation_v1(
  candidate_id_input uuid
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  candidate private.external_market_candidates%rowtype;
begin
  if auth.role()<>'service_role' then
    raise exception 'SERVICE_ROLE_REQUIRED' using errcode='42501';
  end if;
  select * into candidate from private.external_market_candidates candidate_alias
  where candidate_alias.id=candidate_id_input;
  if not found then raise exception 'RADAR_CANDIDATE_NOT_FOUND' using errcode='P0001'; end if;
  return private.market_radar_eligibility_payload(candidate)||jsonb_build_object(
    'current_reconciliation_ready',private.market_radar_candidate_reconciliation_ready_v1(candidate),
    'legacy_snapshot',candidate.normalizer_version<>'atinara-radar-v3',
    'requires_provider_reconciliation',not private.market_radar_candidate_reconciliation_ready_v1(candidate)
  );
end;
$function$;
alter function public.get_market_radar_candidate_for_revalidation_v1(uuid) owner to postgres;
revoke all on function public.get_market_radar_candidate_for_revalidation_v1(uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.get_market_radar_candidate_for_revalidation_v1(uuid) to service_role;

alter function public.get_market_intelligence_origin(text,text)
  rename to get_market_intelligence_origin_pre_parent_reconciliation_v1;
alter function public.get_market_intelligence_origin_pre_parent_reconciliation_v1(text,text)
  owner to postgres;
revoke all on function public.get_market_intelligence_origin_pre_parent_reconciliation_v1(text,text)
  from public,anon,authenticated,service_role;

create or replace function public.get_market_intelligence_origin(
  origin_type_input text,
  origin_id_input text
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  result jsonb;
  candidate private.external_market_candidates%rowtype;
  ready boolean;
  legacy_prepared boolean;
begin
  if auth.role()<>'service_role' then perform private.require_current_admin(); end if;
  result:=public.get_market_intelligence_origin_pre_parent_reconciliation_v1(
    origin_type_input,origin_id_input
  );
  if origin_type_input<>'radar_candidate' then return result; end if;
  begin
    select * into candidate from private.external_market_candidates candidate_alias
    where candidate_alias.id=origin_id_input::uuid;
  exception when invalid_text_representation then
    raise exception 'INTELLIGENCE_ORIGIN_NOT_FOUND' using errcode='P0001';
  end;
  if not found then raise exception 'INTELLIGENCE_ORIGIN_NOT_FOUND' using errcode='P0001'; end if;
  ready:=private.market_radar_candidate_reconciliation_ready_v1(candidate);
  legacy_prepared:=candidate.normalizer_version='atinara-radar-v2'
    and candidate.state='prepared' and candidate.prepared_draft_id is not null;
  if ready or legacy_prepared then return result; end if;
  return result||jsonb_build_object(
    'current_reconciliation_ready',false,'legacy_snapshot',candidate.normalizer_version<>'atinara-radar-v3',
    'advancement_gate',jsonb_build_object(
      'can_analyze',false,'can_prepare',false,
      'blocked_code','RADAR_PARENT_RECONCILIATION_INCOMPLETE',
      'retryable',true,'next_action','retry_provider_refresh'
    )
  );
end;
$function$;
alter function public.get_market_intelligence_origin(text,text) owner to postgres;
revoke all on function public.get_market_intelligence_origin(text,text)
  from public,anon,authenticated,service_role;
grant execute on function public.get_market_intelligence_origin(text,text)
  to authenticated,service_role;

create or replace function public.list_market_radar_parent_reconciliations_v1(
  provider_filter text default null,
  category_filter text default null,
  query_filter text default null,
  limit_count integer default 100,
  offset_count integer default 0
)
returns setof jsonb
language plpgsql
stable
security definer
set search_path to ''
as $function$
begin
  perform private.require_current_admin();
  if nullif(provider_filter,'') is not null
     and provider_filter not in ('polymarket','kalshi') then
    raise exception 'INVALID_RADAR_PROVIDER' using errcode='22023';
  end if;
  if limit_count not between 1 and 100 or offset_count<0 then
    raise exception 'INVALID_RADAR_PAGE' using errcode='22023';
  end if;
  return query
  with latest as (
    select distinct on (parent_alias.provider,parent_alias.provider_parent_id)
      parent_alias.*
    from private.market_radar_parent_reconciliations_v1 parent_alias
    join private.market_radar_refresh_intents_v1 intent
      on intent.request_id=parent_alias.request_id
     and intent.provider=parent_alias.provider
     and intent.capability=parent_alias.capability
    where intent.status in ('completed','partial')
    order by parent_alias.provider,parent_alias.provider_parent_id,
      parent_alias.checked_at desc,parent_alias.inserted_at desc
  )
  select to_jsonb(parent_alias)||jsonb_build_object(
    'issue',case when occurrence.issue_id is null then null else jsonb_build_object(
      'issue_id',occurrence.issue_id,'issue_code',occurrence.issue_code,
      'detected_by',occurrence.detected_by,'owner_stage',occurrence.owner_stage,
      'severity',occurrence.severity,'repairability',occurrence.repairability,
      'blocking_scope',occurrence.blocking_scope,
      'status',coalesce(issue_event.new_status,occurrence.status),
      'retryable',occurrence.retryable,'next_action',occurrence.next_action
    ) end
  )
  from latest parent_alias
  left join private.market_workflow_issue_occurrences_v1 occurrence
    on occurrence.issue_id=parent_alias.issue_id
  left join lateral (
    select event.new_status from private.market_workflow_issue_events_v1 event
    where event.issue_id=occurrence.issue_id
    order by event.occurred_at desc,event.id desc limit 1
  ) issue_event on true
  where (nullif(provider_filter,'') is null or parent_alias.provider=provider_filter)
    and (nullif(category_filter,'') is null or parent_alias.category=category_filter)
    and (nullif(query_filter,'') is null
      or parent_alias.raw_provider_parent_label ilike '%'||query_filter||'%'
      or parent_alias.canonical_parent_label ilike '%'||query_filter||'%')
  order by (parent_alias.reconciliation_status='complete'),parent_alias.checked_at desc,
    parent_alias.provider,parent_alias.provider_parent_id
  limit limit_count offset offset_count;
end;
$function$;
alter function public.list_market_radar_parent_reconciliations_v1(text,text,text,integer,integer)
  owner to postgres;
revoke all on function public.list_market_radar_parent_reconciliations_v1(text,text,text,integer,integer)
  from public,anon,authenticated,service_role;
grant execute on function public.list_market_radar_parent_reconciliations_v1(text,text,text,integer,integer)
  to authenticated;

create or replace function public.list_market_radar_parent_reconciliations_v2(
  provider_filter text default null,
  category_filter text default null,
  query_filter text default null,
  horizon_filter text default '180d',
  limit_count integer default 20,
  offset_count integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare result jsonb;
begin
  perform private.require_current_admin();
  if nullif(provider_filter,'') is not null
     and provider_filter not in ('polymarket','kalshi') then
    raise exception 'INVALID_RADAR_PROVIDER' using errcode='22023';
  end if;
  if horizon_filter not in ('30d','90d','180d','365d')
     or limit_count not between 1 and 50 or offset_count<0 then
    raise exception 'INVALID_RADAR_PAGE' using errcode='22023';
  end if;
  with latest as materialized (
    select distinct on (parent_alias.provider,parent_alias.provider_parent_id)
      parent_alias.*
    from private.market_radar_parent_reconciliations_v1 parent_alias
    join private.market_radar_refresh_intents_v1 intent
      on intent.request_id=parent_alias.request_id
     and intent.provider=parent_alias.provider
     and intent.capability=parent_alias.capability
    where intent.status in ('completed','partial')
    order by parent_alias.provider,parent_alias.provider_parent_id,
      parent_alias.checked_at desc,parent_alias.inserted_at desc
  ), filtered as materialized (
    select parent_alias.*
    from latest parent_alias
    where (nullif(provider_filter,'') is null or parent_alias.provider=provider_filter)
      and (nullif(category_filter,'') is null or parent_alias.atinara_category=category_filter)
      and (nullif(query_filter,'') is null
        or parent_alias.raw_provider_parent_label ilike '%'||query_filter||'%'
        or parent_alias.canonical_parent_label ilike '%'||query_filter||'%')
      and (parent_alias.horizon_at is null or parent_alias.horizon_at<=clock_timestamp()+case horizon_filter
        when '30d' then interval '30 days' when '90d' then interval '90 days'
        when '365d' then interval '365 days' else interval '180 days' end)
  ), page as materialized (
    select parent_alias.* from filtered parent_alias
    order by (parent_alias.reconciliation_status='complete'),parent_alias.checked_at desc,
      parent_alias.provider,parent_alias.provider_parent_id
    limit limit_count offset offset_count
  )
  select jsonb_build_object(
    'items',coalesce((select jsonb_agg(to_jsonb(parent_alias)||jsonb_build_object(
      'issue',case when occurrence.issue_id is null then null else jsonb_build_object(
        'issue_id',occurrence.issue_id,'issue_code',occurrence.issue_code,
        'detected_by',occurrence.detected_by,'owner_stage',occurrence.owner_stage,
        'severity',occurrence.severity,'repairability',occurrence.repairability,
        'blocking_scope',occurrence.blocking_scope,
        'status',coalesce(issue_event.new_status,occurrence.status),
        'retryable',occurrence.retryable,'next_action',occurrence.next_action
      ) end
    ) order by (parent_alias.reconciliation_status='complete'),parent_alias.checked_at desc,
      parent_alias.provider,parent_alias.provider_parent_id)
      from page parent_alias
      left join private.market_workflow_issue_occurrences_v1 occurrence
        on occurrence.issue_id=parent_alias.issue_id
      left join lateral (
        select event.new_status from private.market_workflow_issue_events_v1 event
        where event.issue_id=occurrence.issue_id
        order by event.occurred_at desc,event.id desc limit 1
      ) issue_event on true),'[]'::jsonb),
    'total',(select count(*) from filtered),'offset',offset_count,'limit',limit_count,
    'previous_offset',case when offset_count>0 then greatest(0,offset_count-limit_count) else null end,
    'next_offset',case when offset_count+limit_count<(select count(*) from filtered)
      then offset_count+limit_count else null end,
    'snapshot_available',exists(select 1 from latest)
  ) into result;
  return result;
end;
$function$;
alter function public.list_market_radar_parent_reconciliations_v2(text,text,text,text,integer,integer)
  owner to postgres;
revoke all on function public.list_market_radar_parent_reconciliations_v2(text,text,text,text,integer,integer)
  from public,anon,authenticated,service_role;
grant execute on function public.list_market_radar_parent_reconciliations_v2(text,text,text,text,integer,integer)
  to authenticated;

create or replace function public.get_market_radar_parent_reconciliation_v1(
  reconciliation_id_input uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare result jsonb;
begin
  perform private.require_current_admin();
  select to_jsonb(parent_alias)||jsonb_build_object(
    'children',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',child.id,'external_market_id',child.external_market_id,
        'condition_id',child.condition_id,'token_ids',child.token_ids,
        'child_slug',child.child_slug,'event_id',child.event_id,'event_slug',child.event_slug,
        'raw_provider_child_label',child.raw_provider_child_label,
        'canonical_child_label',child.canonical_child_label,
        'canonical_child_key',child.canonical_child_key,
        'identity_classification',child.identity_classification,
        'identity_status',child.identity_status,
        'availability_status',child.availability_status,
        'identity_source',child.identity_source,
        'identity_confidence',child.identity_confidence,
        'identity_evidence',child.identity_evidence,
        'present_in_current_snapshot',child.present_in_current_snapshot,
        'present_in_legacy_snapshot',child.present_in_legacy_snapshot,
        'transition',child.transition,'projection_version',child.projection_version,
        'provider_contract',child.provider_contract,
        'provider_contract_hash',child.provider_contract_hash,
        'child_fingerprint',child.child_fingerprint,'checked_at',child.checked_at
      ) order by child.present_in_current_snapshot desc,child.external_market_id,
        child.provider_child_identity_key,child.child_occurrence_key)
      from private.market_radar_parent_children_v1 child
      where child.parent_reconciliation_id=parent_alias.id
    ),'[]'::jsonb)
  ) into result
  from private.market_radar_parent_reconciliations_v1 parent_alias
  where parent_alias.id=reconciliation_id_input;
  return result;
end;
$function$;
alter function public.get_market_radar_parent_reconciliation_v1(uuid) owner to postgres;
revoke all on function public.get_market_radar_parent_reconciliation_v1(uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.get_market_radar_parent_reconciliation_v1(uuid)
  to authenticated;

create or replace function public.list_market_radar_candidates_v4(
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
set search_path to ''
as $function$
declare
  result jsonb;
  checked_at_value timestamptz:=clock_timestamp();
begin
  perform private.require_current_admin();
  if nullif(provider_filter,'') is not null
     and provider_filter not in ('polymarket','kalshi') then
    raise exception 'INVALID_RADAR_PROVIDER' using errcode='22023';
  end if;
  if order_key not in ('recommended','popularity','closing','recent')
     or coalesce(quality_filter,'fit') not in ('fit','review','rejected','all')
     or horizon_filter not in ('30d','90d','180d','365d') then
    raise exception 'INVALID_RADAR_FILTER' using errcode='22023';
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
    where candidate.normalizer_version='atinara-radar-v3'
      and candidate.family_version='atinara-market-family-v5'
      and candidate.family_key is not null and candidate.family_child_key is not null
      and private.market_radar_candidate_reconciliation_ready_v1(candidate)
      and (nullif(provider_filter,'') is null or candidate.provider=provider_filter)
      and (nullif(category_filter,'') is null or candidate.atinara_category=category_filter)
      and (nullif(query_filter,'') is null
        or candidate.normalized_payload ->> 'source_title' ilike '%'||query_filter||'%'
        or candidate.normalized_payload ->> 'source_question' ilike '%'||query_filter||'%'
        or candidate.normalized_payload ->> 'atinara_question' ilike '%'||query_filter||'%')
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
        and coalesce(candidate.eligibility_status,'technical_hold')
          not in ('terminal','duplicate','inactive_option','invalid')
      or coalesce(quality_filter,'fit')='all'
        and candidate.state in ('available','needs_review')
        and coalesce(candidate.eligibility_status,'technical_hold')
          not in ('terminal','duplicate','inactive_option','invalid')
      or coalesce(quality_filter,'fit')='rejected'
        and (candidate.state='rejected' or candidate.quality_status='rejected')
    )
    and (coalesce(quality_filter,'fit')='rejected' or candidate.horizon_at is null
      or (candidate.horizon_at>checked_at_value
        and candidate.horizon_at<=checked_at_value+case horizon_filter
          when '30d' then interval '30 days' when '90d' then interval '90 days'
          when '365d' then interval '365 days' else interval '180 days' end))
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
    select parent_key,row_number() over(order by
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
    'items',coalesce((select jsonb_agg(
      private.market_radar_eligibility_payload(candidate_row)||jsonb_build_object(
        'parent_rank',item.parent_rank,
        'parent_reconciliation_id',candidate_row.current_parent_reconciliation_id,
        'parent_child_id',candidate_row.current_parent_child_id
      ) order by item.parent_rank,item.quality_score desc nulls last,
        item.family_child_key,item.provider,item.external_id)
      from page_items item
      join private.external_market_candidates candidate_row
        on candidate_row.id=item.candidate_id),'[]'::jsonb),
    'parent_count',(select count(*) from parent_scores),
    'parent_offset',parent_offset_count,'parent_limit',parent_limit_count,
    'next_parent_offset',case
      when parent_offset_count+parent_limit_count<(select count(*) from parent_scores)
      then parent_offset_count+parent_limit_count else null end,
    'previous_parent_offset',case when parent_offset_count>0
      then greatest(0,parent_offset_count-parent_limit_count) else null end,
    'quality_filter',coalesce(quality_filter,'fit'),'checked_at',checked_at_value,
    'projection_version','atinara-radar-child-projection-v1',
    'reconciliation_version','atinara-radar-parent-reconciliation-v1'
  ) into result;
  return result;
end;
$function$;

alter function public.list_market_radar_candidates_v4(text,text,text,text,text,text,integer,integer)
  owner to postgres;
revoke all on function public.list_market_radar_candidates_v4(text,text,text,text,text,text,integer,integer)
  from public,anon,authenticated,service_role;
grant execute on function public.list_market_radar_candidates_v4(text,text,text,text,text,text,integer,integer)
  to authenticated;

create or replace function public.list_market_radar_rejections_v2(
  provider_filter text default null,
  category_filter text default null,
  limit_count integer default 100,
  offset_count integer default 0
)
returns setof jsonb
language plpgsql
stable
security definer
set search_path to ''
as $function$
begin
  perform private.require_current_admin();
  if nullif(provider_filter,'') is not null
     and provider_filter not in ('polymarket','kalshi') then
    raise exception 'INVALID_RADAR_PROVIDER' using errcode='22023';
  end if;
  if limit_count not between 1 and 200 or offset_count<0 then
    raise exception 'INVALID_RADAR_PAGE' using errcode='22023';
  end if;
  return query
  select private.market_radar_eligibility_payload(candidate)
    ||jsonb_build_object(
      'parent_reconciliation_id',candidate.current_parent_reconciliation_id,
      'parent_child_id',candidate.current_parent_child_id
    )
  from private.external_market_candidates candidate
  where candidate.normalizer_version='atinara-radar-v3'
    and candidate.verification_status like 'rejected_%'
    and candidate.state='rejected'
    and private.market_radar_candidate_reconciliation_bound_v1(candidate)
    and candidate.normalized_payload ->> 'identity_status'='resolved'
    and (nullif(provider_filter,'') is null or candidate.provider=provider_filter)
    and (nullif(category_filter,'') is null or candidate.atinara_category=category_filter)
  order by candidate.verified_at desc nulls last,candidate.updated_at desc,candidate.id
  limit limit_count offset offset_count;
end;
$function$;

alter function public.list_market_radar_rejections_v2(text,text,integer,integer)
  owner to postgres;
revoke all on function public.list_market_radar_rejections_v2(text,text,integer,integer)
  from public,anon,authenticated,service_role;
grant execute on function public.list_market_radar_rejections_v2(text,text,integer,integer)
  to authenticated;

-- Compatibilidad fail-closed durante la ventana migracion -> Edge: cualquier
-- bundle v58 que siga llamando las firmas anteriores recibe ya la proyeccion
-- reconciliada, nunca el snapshot legacy v2.
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
language sql
stable
security definer
set search_path to ''
as $function$
  select public.list_market_radar_candidates_v4(
    provider_filter,category_filter,quality_filter,query_filter,order_key,
    horizon_filter,parent_limit_count,parent_offset_count
  );
$function$;
alter function public.list_market_radar_candidates_v3(text,text,text,text,text,text,integer,integer)
  owner to postgres;
revoke all on function public.list_market_radar_candidates_v3(text,text,text,text,text,text,integer,integer)
  from public,anon,authenticated,service_role;
grant execute on function public.list_market_radar_candidates_v3(text,text,text,text,text,text,integer,integer)
  to authenticated;

create or replace function public.list_market_radar_candidates_v2(
  provider_filter text default null,
  category_filter text default null,
  quality_filter text default 'fit',
  query_filter text default null,
  order_key text default 'recommended',
  horizon_filter text default '180d',
  limit_count integer default 60,
  offset_count integer default 0
)
returns jsonb
language sql
stable
security definer
set search_path to ''
as $function$
  select public.list_market_radar_candidates_v4(
    provider_filter,category_filter,quality_filter,query_filter,order_key,
    horizon_filter,limit_count,offset_count
  );
$function$;
alter function public.list_market_radar_candidates_v2(text,text,text,text,text,text,integer,integer)
  owner to postgres;
revoke all on function public.list_market_radar_candidates_v2(text,text,text,text,text,text,integer,integer)
  from public,anon,authenticated,service_role;
grant execute on function public.list_market_radar_candidates_v2(text,text,text,text,text,text,integer,integer)
  to authenticated;

create or replace function public.list_market_radar_rejections(
  provider_filter text default null,
  category_filter text default null,
  limit_count integer default 100,
  offset_count integer default 0
)
returns jsonb
language sql
stable
security definer
set search_path to ''
as $function$
  select coalesce(jsonb_agg(item),'[]'::jsonb)
  from public.list_market_radar_rejections_v2(
    provider_filter,category_filter,limit_count,offset_count
  ) item;
$function$;
alter function public.list_market_radar_rejections(text,text,integer,integer)
  owner to postgres;
revoke all on function public.list_market_radar_rejections(text,text,integer,integer)
  from public,anon,authenticated,service_role;
grant execute on function public.list_market_radar_rejections(text,text,integer,integer)
  to authenticated;

create or replace function public.apply_market_radar_prepare_eligibility_v2(
  candidate_id_input uuid,
  expected_preparation_revision_input bigint,
  normalizer_version_input text,
  eligibility_checked_at_input timestamptz,
  eligibility_input jsonb,
  eligibility_check_input jsonb,
  reserve_for_prepare_input boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare candidate private.external_market_candidates%rowtype;
begin
  if auth.role()<>'service_role' then
    raise exception 'SERVICE_ROLE_REQUIRED' using errcode='42501';
  end if;
  if normalizer_version_input<>'atinara-radar-v3' then
    raise exception 'INVALID_RADAR_ELIGIBILITY' using errcode='22023';
  end if;
  select * into candidate from private.external_market_candidates candidate_alias
  where candidate_alias.id=candidate_id_input for share;
  if not found then raise exception 'RADAR_CANDIDATE_NOT_FOUND' using errcode='P0001'; end if;
  if not (
    private.market_radar_candidate_reconciliation_ready_v1(candidate)
    or (candidate.normalizer_version='atinara-radar-v2'
      and candidate.state='prepared' and candidate.prepared_draft_id is not null)
  ) then
    raise exception 'RADAR_PARENT_RECONCILIATION_INCOMPLETE' using errcode='55000';
  end if;
  return public.apply_market_radar_prepare_eligibility_v1(
    candidate_id_input,expected_preparation_revision_input,'atinara-radar-v2',
    eligibility_checked_at_input,eligibility_input,eligibility_check_input,
    reserve_for_prepare_input
  );
end;
$function$;

alter function public.apply_market_radar_prepare_eligibility_v2(uuid,bigint,text,timestamptz,jsonb,jsonb,boolean)
  owner to postgres;
revoke all on function public.apply_market_radar_prepare_eligibility_v2(uuid,bigint,text,timestamptz,jsonb,jsonb,boolean)
  from public,anon,authenticated,service_role;

create or replace function public.apply_market_radar_prepare_eligibility_v3(
  candidate_id_input uuid,
  expected_preparation_revision_input bigint,
  normalizer_version_input text,
  eligibility_checked_at_input timestamptz,
  eligibility_input jsonb,
  eligibility_check_input jsonb,
  identity_snapshot_input jsonb,
  reserve_for_prepare_input boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  candidate private.external_market_candidates%rowtype;
  current_child private.market_radar_parent_children_v1%rowtype;
  result jsonb;
  eligibility_attempt_id_value uuid;
  eligibility_replay boolean:=false;
  duplicate_recovered boolean:=false;
  provider_projection_synced boolean:=false;
begin
  if auth.role()<>'service_role' then
    raise exception 'SERVICE_ROLE_REQUIRED' using errcode='42501';
  end if;
  if normalizer_version_input<>'atinara-radar-v3'
     or jsonb_typeof(identity_snapshot_input)<>'object'
     or identity_snapshot_input ->> 'contract_version'
       is distinct from 'atinara-radar-preparation-identity-v1' then
    raise exception 'RADAR_IDENTITY_SNAPSHOT_INVALID' using errcode='22023';
  end if;
  select * into candidate
  from private.external_market_candidates candidate_alias
  where candidate_alias.id=candidate_id_input
  for update;
  if not found then
    raise exception 'RADAR_CANDIDATE_NOT_FOUND' using errcode='P0001';
  end if;
  begin
    eligibility_attempt_id_value:=(eligibility_check_input ->> 'attempt_id')::uuid;
  exception when invalid_text_representation then
    raise exception 'RADAR_IDENTITY_SNAPSHOT_INVALID' using errcode='22023';
  end;
  select exists (
    select 1 from private.market_radar_eligibility_checks check_alias
    where check_alias.attempt_id=eligibility_attempt_id_value
      and check_alias.candidate_id=candidate.id
  ) into eligibility_replay;
  if not eligibility_replay and expected_preparation_revision_input is not null
     and candidate.preparation_revision is distinct from expected_preparation_revision_input then
    raise exception 'RADAR_PREPARATION_REVISION_MISMATCH' using errcode='40001';
  end if;
  if not private.market_radar_candidate_reconciliation_bound_v1(candidate) then
    raise exception 'RADAR_PARENT_RECONCILIATION_INCOMPLETE' using errcode='55000';
  end if;
  if row(
    candidate.provider,candidate.external_id,candidate.external_event_id,
    candidate.normalizer_version,candidate.family_version,candidate.family_key,
    candidate.family_type,candidate.family_child_key,candidate.family_child_label,
    candidate.normalized_payload ->> 'external_market_id',
    candidate.normalized_payload ->> 'canonical_projection_version',
    candidate.normalized_payload ->> 'canonical_child_key',
    candidate.normalized_payload ->> 'canonical_child_label',
    candidate.normalized_payload ->> 'parent_reconciliation_version',
    candidate.normalized_payload ->> 'parent_reconciliation_fingerprint',
    candidate.normalized_payload ->> 'parent_reconciliation_integrity_hash',
    candidate.normalized_payload ->> 'parent_child_occurrence_key',
    nullif(candidate.normalized_payload ->> 'parent_child_identity_key',''),
    candidate.normalized_payload ->> 'parent_child_fingerprint',
    candidate.normalized_payload ->> 'parent_child_integrity_hash',
    candidate.normalized_payload ->> 'provider_child_contract_hash',
    candidate.normalized_payload ->> 'identity_status',
    candidate.normalized_payload ->> 'identity_classification'
  ) is distinct from row(
    identity_snapshot_input ->> 'provider',
    identity_snapshot_input ->> 'external_id',
    identity_snapshot_input ->> 'external_event_id',
    identity_snapshot_input ->> 'normalizer_version',
    identity_snapshot_input ->> 'family_version',
    identity_snapshot_input ->> 'family_key',
    identity_snapshot_input ->> 'family_type',
    identity_snapshot_input ->> 'family_child_key',
    identity_snapshot_input ->> 'family_child_label',
    identity_snapshot_input ->> 'external_market_id',
    identity_snapshot_input ->> 'canonical_projection_version',
    identity_snapshot_input ->> 'canonical_child_key',
    identity_snapshot_input ->> 'canonical_child_label',
    identity_snapshot_input ->> 'parent_reconciliation_version',
    identity_snapshot_input ->> 'parent_reconciliation_fingerprint',
    identity_snapshot_input ->> 'parent_reconciliation_integrity_hash',
    identity_snapshot_input ->> 'parent_child_occurrence_key',
    nullif(identity_snapshot_input ->> 'parent_child_identity_key',''),
    identity_snapshot_input ->> 'parent_child_fingerprint',
    identity_snapshot_input ->> 'parent_child_integrity_hash',
    identity_snapshot_input ->> 'provider_child_contract_hash',
    identity_snapshot_input ->> 'identity_status',
    identity_snapshot_input ->> 'identity_classification'
  ) then
    raise exception 'RADAR_CANDIDATE_IDENTITY_STALE' using errcode='40001';
  end if;
  select child_alias.* into current_child
    from private.market_radar_parent_reconciliations_v1 parent_alias
    join private.market_radar_parent_children_v1 child_alias
      on child_alias.parent_reconciliation_id=parent_alias.id
    where parent_alias.id=candidate.current_parent_reconciliation_id
      and child_alias.id=candidate.current_parent_child_id
      and parent_alias.provider=identity_snapshot_input ->> 'provider'
      and parent_alias.provider_parent_id=identity_snapshot_input ->> 'external_event_id'
      and parent_alias.reconciliation_fingerprint
        =identity_snapshot_input ->> 'parent_reconciliation_fingerprint'
      and parent_alias.payload_hash
        =identity_snapshot_input ->> 'parent_reconciliation_integrity_hash'
      and child_alias.child_occurrence_key
        =identity_snapshot_input ->> 'parent_child_occurrence_key'
      and child_alias.provider_child_identity_key is not distinct from
        nullif(identity_snapshot_input ->> 'parent_child_identity_key','')
      and child_alias.child_fingerprint
        =identity_snapshot_input ->> 'parent_child_fingerprint'
      and child_alias.payload_hash
        =identity_snapshot_input ->> 'parent_child_integrity_hash'
      and child_alias.provider_contract_hash
        =identity_snapshot_input ->> 'provider_child_contract_hash'
      and child_alias.canonical_child_key is not distinct from
        nullif(identity_snapshot_input ->> 'canonical_child_key','')
      and child_alias.canonical_child_label is not distinct from
        nullif(identity_snapshot_input ->> 'canonical_child_label','')
  ;
  if not found then
    raise exception 'RADAR_CANDIDATE_IDENTITY_STALE' using errcode='40001';
  end if;
  if coalesce(eligibility_input ->> 'fingerprint','')!~'^r[a-f0-9]{8}$' then
    raise exception 'RADAR_CANDIDATE_IDENTITY_STALE' using errcode='40001';
  end if;
  update private.external_market_candidates candidate_alias set
    fingerprint=lower(eligibility_input ->> 'fingerprint'),
    normalized_payload=candidate_alias.normalized_payload||jsonb_build_object(
      'fingerprint',lower(eligibility_input ->> 'fingerprint'),
      'source_title',current_child.provider_contract -> 'source_title',
      'source_question',current_child.provider_contract -> 'source_question',
      'source_description',current_child.provider_contract -> 'source_description',
      'source_category',eligibility_input -> 'source_category',
      'source_tags',coalesce(eligibility_input -> 'source_tags','[]'::jsonb),
      'source_status',current_child.provider_contract -> 'source_status',
      'source_result',current_child.provider_contract -> 'source_result',
      'source_close_at',current_child.provider_contract -> 'source_close_at',
      'source_resolution_deadline',current_child.provider_contract -> 'source_resolution_deadline',
      'source_resolution_rules',current_child.provider_contract -> 'source_resolution_rules',
      'source_resolution_url',current_child.provider_contract -> 'source_resolution_url',
      'external_event_slug',current_child.provider_contract -> 'event_slug',
      'external_market_slug',current_child.provider_contract -> 'child_slug',
      'external_event_url',current_child.provider_contract -> 'external_event_url',
      'external_market_url',current_child.provider_contract -> 'external_market_url',
      'provider_child_contract',current_child.provider_contract,
      'provider_child_contract_hash',current_child.provider_contract_hash,
      'temporal_contract',eligibility_input -> 'temporal_contract',
      'domain_fingerprint',eligibility_input -> 'domain_fingerprint'
    ),updated_at=clock_timestamp()
  where candidate_alias.id=candidate.id;
  select * into candidate from private.external_market_candidates candidate_alias
  where candidate_alias.id=candidate_id_input for update;
  provider_projection_synced:=true;
  if private.market_radar_candidate_cross_version_identity_v1(candidate) is not null then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
      private.market_radar_candidate_cross_version_identity_v1(candidate),0
    ));
    if private.market_radar_candidate_has_live_duplicate_v1(candidate) then
      return private.persist_market_radar_live_duplicate_v1(
        candidate.id,eligibility_checked_at_input,eligibility_check_input
      )||jsonb_build_object(
        'identity_snapshot_contract','atinara-radar-preparation-identity-v1'
      );
    elsif (candidate.prepared_draft_id is not null or exists (
         select 1 from private.market_drafts draft
         where draft.workflow_status not in ('cancelled','annulled') and (
           draft.radar_candidate_id=candidate.id or (
             draft.intelligence_origin_type='radar_candidate'
             and draft.intelligence_origin_id=candidate.id::text
           )
         )
       ))
       and candidate.verification_status='rejected_duplicate'
       and candidate.eligibility_status='duplicate' then
      candidate:=private.clear_market_radar_live_duplicate_v1(
        candidate.id,eligibility_checked_at_input,eligibility_input
      );
      duplicate_recovered:=true;
    end if;
  end if;
  result:=public.apply_market_radar_prepare_eligibility_v1(
    candidate_id_input,
    case when eligibility_replay or duplicate_recovered or provider_projection_synced
      then candidate.preparation_revision
      else expected_preparation_revision_input end,
    'atinara-radar-v2',
    eligibility_checked_at_input,eligibility_input,eligibility_check_input,
    reserve_for_prepare_input
  );
  select * into candidate
  from private.external_market_candidates candidate_alias
  where candidate_alias.id=candidate_id_input
  for update;
  update private.external_market_candidates candidate_alias set
    external_url=coalesce(
      nullif(current_child.provider_contract ->> 'external_market_url',''),
      nullif(current_child.provider_contract ->> 'external_event_url',''),
      candidate_alias.external_url
    ),
    external_event_url=coalesce(
      nullif(current_child.provider_contract ->> 'external_event_url',''),
      candidate_alias.external_event_url
    ),
    external_market_url=coalesce(
      nullif(current_child.provider_contract ->> 'external_market_url',''),
      candidate_alias.external_market_url
    ),
    external_event_slug=coalesce(
      nullif(current_child.provider_contract ->> 'event_slug',''),
      candidate_alias.external_event_slug
    ),
    external_market_slug=coalesce(
      nullif(current_child.provider_contract ->> 'child_slug',''),
      candidate_alias.external_market_slug
    ),
    source_status=nullif(current_child.provider_contract ->> 'source_status',''),
    verification_status=case candidate.eligibility_status
      when 'eligible' then 'verified_open'
      when 'terminal' then 'rejected_resolved'
      when 'duplicate' then 'rejected_duplicate'
      when 'invalid' then 'rejected_invalid_source'
      when 'technical_hold' then 'needs_review'
      else 'rejected_ineligible' end,
    verification_reason_code=candidate.eligibility_reason_code,
    verification_reason=candidate.eligibility_reason,
    verification_evidence=coalesce(candidate.eligibility_evidence,'[]'::jsonb),
    verification_confidence=case when candidate.eligibility_status='eligible'
      then least(greatest(coalesce(nullif(eligibility_input ->> 'eligibility_confidence','')::numeric,100),0),100)
      else least(greatest(coalesce(nullif(eligibility_input ->> 'eligibility_confidence','')::numeric,0),0),100) end,
    verified_at=eligibility_checked_at_input,
    verification_expires_at=candidate.eligibility_expires_at,
    fetched_at=eligibility_checked_at_input,
    expires_at=candidate.eligibility_expires_at,
    state=case
      when candidate_alias.state='dismissed' then 'dismissed'
      when candidate.eligibility_status='eligible' and candidate_alias.prepared_draft_id is not null
        then 'prepared'
      when candidate.eligibility_status='eligible' then 'available'
      when candidate.eligibility_status='technical_hold' then 'needs_review'
      else 'rejected' end,
    normalized_payload=candidate_alias.normalized_payload||jsonb_build_object(
      'source_status',current_child.provider_contract -> 'source_status',
      'verification_status',case candidate.eligibility_status
        when 'eligible' then 'verified_open'
        when 'terminal' then 'rejected_resolved'
        when 'duplicate' then 'rejected_duplicate'
        when 'invalid' then 'rejected_invalid_source'
        when 'technical_hold' then 'needs_review'
        else 'rejected_ineligible' end,
      'verification_reason_code',candidate.eligibility_reason_code,
      'verification_reason',candidate.eligibility_reason,
      'verification_evidence',coalesce(candidate.eligibility_evidence,'[]'::jsonb),
      'verified_at',eligibility_checked_at_input,
      'verification_expires_at',candidate.eligibility_expires_at
    ),updated_at=clock_timestamp()
  where candidate_alias.id=candidate.id;
  select * into candidate from private.external_market_candidates candidate_alias
  where candidate_alias.id=candidate_id_input for update;
  if coalesce((result ->> 'ok')::boolean,false)
     and candidate.prepared_draft_id is not null and candidate.state<>'prepared' then
    update private.external_market_candidates set state='prepared',updated_at=clock_timestamp()
    where id=candidate.id;
    select * into candidate from private.external_market_candidates where id=candidate_id_input for update;
  end if;
  if not private.market_radar_candidate_reconciliation_bound_v1(candidate)
     or (reserve_for_prepare_input and coalesce((result ->> 'ok')::boolean,false)
       and not private.market_radar_candidate_reconciliation_ready_v1(candidate)) then
    raise exception 'RADAR_PARENT_RECONCILIATION_INCOMPLETE' using errcode='55000';
  end if;
  candidate:=private.sync_market_radar_revalidation_issues_v1(
    candidate.id,eligibility_input
  );
  return result||jsonb_build_object(
    'identity_snapshot_contract','atinara-radar-preparation-identity-v1',
    'identity_replay',eligibility_replay,'duplicate_recovered',duplicate_recovered,
    'candidate',private.market_radar_eligibility_payload(candidate)
  );
end;
$function$;

alter function public.apply_market_radar_prepare_eligibility_v3(
  uuid,bigint,text,timestamptz,jsonb,jsonb,jsonb,boolean
) owner to postgres;
revoke all on function public.apply_market_radar_prepare_eligibility_v3(
  uuid,bigint,text,timestamptz,jsonb,jsonb,jsonb,boolean
) from public,anon,authenticated,service_role;

create or replace function public.apply_market_radar_prepare_eligibility_v4(
  candidate_id_input uuid,
  expected_preparation_revision_input bigint,
  normalizer_version_input text,
  eligibility_checked_at_input timestamptz,
  eligibility_input jsonb,
  eligibility_check_input jsonb,
  identity_snapshot_input jsonb,
  reserve_for_prepare_input boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  candidate private.external_market_candidates%rowtype;
  draft private.market_drafts%rowtype;
  result jsonb;
  legacy_prepared boolean;
  legacy_cross_identity text;
  duplicate_recovered boolean:=false;
begin
  if auth.role()<>'service_role' then
    raise exception 'SERVICE_ROLE_REQUIRED' using errcode='42501';
  end if;
  select * into candidate from private.external_market_candidates candidate_alias
  where candidate_alias.id=candidate_id_input for update;
  if not found then raise exception 'RADAR_CANDIDATE_NOT_FOUND' using errcode='P0001'; end if;
  legacy_prepared:=candidate.normalizer_version='atinara-radar-v2'
    and candidate.state in ('prepared','rejected')
    and candidate.prepared_draft_id is not null
    and candidate.eligibility_status is distinct from 'terminal';
  if not legacy_prepared then
    if normalizer_version_input<>'atinara-radar-v3' then
      raise exception 'RADAR_IDENTITY_SNAPSHOT_INVALID' using errcode='22023';
    end if;
    return public.apply_market_radar_prepare_eligibility_v3(
      candidate_id_input,expected_preparation_revision_input,normalizer_version_input,
      eligibility_checked_at_input,eligibility_input,eligibility_check_input,
      identity_snapshot_input,reserve_for_prepare_input
    );
  end if;
  if reserve_for_prepare_input
     or normalizer_version_input<>'atinara-radar-v2'
     or jsonb_typeof(identity_snapshot_input)<>'object'
     or identity_snapshot_input ->> 'contract_version'
       is distinct from 'atinara-radar-prepared-legacy-identity-v1' then
    raise exception 'RADAR_LEGACY_PREPARED_SCOPE_INVALID' using errcode='22023';
  end if;
  select * into draft from private.market_drafts draft_alias
  where draft_alias.id=candidate.prepared_draft_id for share;
  if not found or draft.radar_candidate_id is distinct from candidate.id
     or draft.workflow_status in ('cancelled','annulled')
     or row(draft.family_version,draft.family_key,draft.family_type,
       draft.family_child_key,draft.family_child_label)
       is distinct from row(candidate.family_version,candidate.family_key,
         candidate.family_type,candidate.family_child_key,candidate.family_child_label)
     or row(
       identity_snapshot_input ->> 'provider',identity_snapshot_input ->> 'external_id',
       identity_snapshot_input ->> 'normalizer_version',identity_snapshot_input ->> 'family_version',
       identity_snapshot_input ->> 'family_key',identity_snapshot_input ->> 'family_type',
       identity_snapshot_input ->> 'family_child_key',identity_snapshot_input ->> 'family_child_label',
       identity_snapshot_input ->> 'prepared_draft_id'
     ) is distinct from row(
       candidate.provider,candidate.external_id,candidate.normalizer_version,candidate.family_version,
       candidate.family_key,candidate.family_type,candidate.family_child_key,
       candidate.family_child_label,candidate.prepared_draft_id::text
     ) then
    raise exception 'RADAR_LEGACY_PREPARED_IDENTITY_STALE' using errcode='40001';
  end if;
  if row(
       candidate.external_event_id,
       coalesce(nullif(candidate.normalized_payload ->> 'external_market_id',''),candidate.external_id),
       candidate.normalized_payload ->> 'source_question',
       nullif(candidate.normalized_payload ->> 'source_resolution_rules','')
     ) is distinct from row(
       identity_snapshot_input ->> 'current_external_event_id',
       identity_snapshot_input ->> 'current_external_market_id',
       identity_snapshot_input ->> 'current_source_question',
       nullif(identity_snapshot_input ->> 'current_source_resolution_rules','')
     )
     or nullif(candidate.normalized_payload ->> 'source_close_at','')::timestamptz
       is distinct from nullif(identity_snapshot_input ->> 'current_source_close_at','')::timestamptz
     or not exists (
       select 1
       from private.market_radar_parent_reconciliations_v1 parent_alias
       join private.market_radar_parent_children_v1 child_alias
         on child_alias.parent_reconciliation_id=parent_alias.id
       where parent_alias.provider=candidate.provider
         and parent_alias.provider_parent_id=identity_snapshot_input ->> 'current_external_event_id'
         and parent_alias.reconciliation_status='complete'
         and parent_alias.reconciliation_version
           =identity_snapshot_input ->> 'current_parent_reconciliation_version'
         and parent_alias.reconciliation_fingerprint
           =identity_snapshot_input ->> 'current_parent_reconciliation_fingerprint'
         and parent_alias.id=(
           select latest_parent.id
           from private.market_radar_parent_reconciliations_v1 latest_parent
           join private.market_radar_refresh_intents_v1 latest_intent
             on latest_intent.request_id=latest_parent.request_id
            and latest_intent.provider=latest_parent.provider
            and latest_intent.capability=latest_parent.capability
           where latest_parent.provider=candidate.provider
             and latest_parent.provider_parent_id=identity_snapshot_input ->> 'current_external_event_id'
             and latest_intent.status in ('completed','partial')
           order by latest_parent.checked_at desc,latest_parent.inserted_at desc limit 1
         )
         and child_alias.present_in_current_snapshot
         and child_alias.identity_status='resolved'
         and child_alias.external_market_id is not distinct from
           nullif(identity_snapshot_input ->> 'current_external_market_id','')
         and child_alias.child_occurrence_key
           =identity_snapshot_input ->> 'current_parent_child_occurrence_key'
         and child_alias.provider_child_identity_key is not distinct from
           nullif(identity_snapshot_input ->> 'current_parent_child_identity_key','')
         and child_alias.child_fingerprint
           =identity_snapshot_input ->> 'current_parent_child_fingerprint'
     ) then
    raise exception 'RADAR_LEGACY_PREPARED_IDENTITY_STALE' using errcode='40001';
  end if;
  legacy_cross_identity:=private.market_radar_candidate_cross_version_identity_v1(candidate);
  if identity_snapshot_input ->> 'current_identity_status'<>'resolved'
     or identity_snapshot_input ->> 'current_identity_classification' not in (
       'identified_real_option','aggregate_other_option','tie_option',
       'no_winner_option','provider_closed_child'
     )
     or (candidate.family_type in (
       'categorical_outcomes','participant_options','platform_variants'
     ) and (
       nullif(identity_snapshot_input ->> 'current_canonical_child_key','') is null
       or nullif(identity_snapshot_input ->> 'current_canonical_child_label','') is null
       or legacy_cross_identity is null
       or right(legacy_cross_identity,
         char_length(identity_snapshot_input ->> 'current_canonical_child_key')+1)
         <>':'||(identity_snapshot_input ->> 'current_canonical_child_key')
     ))
     or (candidate.family_type not in (
       'categorical_outcomes','participant_options','platform_variants'
     ) and (
       nullif(identity_snapshot_input ->> 'current_canonical_child_key','') is not null
       or nullif(identity_snapshot_input ->> 'current_canonical_child_label','') is not null
     )) then
    raise exception 'RADAR_LEGACY_PREPARED_IDENTITY_STALE' using errcode='40001';
  end if;
  if private.market_radar_candidate_cross_version_identity_v1(candidate) is not null then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
      private.market_radar_candidate_cross_version_identity_v1(candidate),0
    ));
    if private.market_radar_candidate_has_live_duplicate_v1(candidate) then
      return private.persist_market_radar_live_duplicate_v1(
        candidate.id,eligibility_checked_at_input,eligibility_check_input
      )||jsonb_build_object(
        'identity_snapshot_contract','atinara-radar-prepared-legacy-identity-v1',
        'legacy_identity_preserved',true
      );
    elsif candidate.verification_status='rejected_duplicate'
       and candidate.eligibility_status='duplicate' then
      candidate:=private.clear_market_radar_live_duplicate_v1(
        candidate.id,eligibility_checked_at_input,eligibility_input
      );
      duplicate_recovered:=true;
    end if;
  end if;
  result:=public.apply_market_radar_prepare_eligibility_v1(
    candidate_id_input,case when duplicate_recovered then candidate.preparation_revision
      else expected_preparation_revision_input end,'atinara-radar-v2',
    eligibility_checked_at_input,eligibility_input,eligibility_check_input,false
  );
  select * into candidate from private.external_market_candidates candidate_alias
  where candidate_alias.id=candidate_id_input for update;
  if coalesce((result ->> 'ok')::boolean,false)
     and candidate.prepared_draft_id is not null and candidate.state<>'prepared' then
    update private.external_market_candidates set state='prepared',updated_at=clock_timestamp()
    where id=candidate.id;
    select * into candidate from private.external_market_candidates where id=candidate_id_input for update;
  end if;
  candidate:=private.sync_market_radar_revalidation_issues_v1(candidate.id,eligibility_input);
  return result||jsonb_build_object(
    'identity_snapshot_contract','atinara-radar-prepared-legacy-identity-v1',
    'legacy_identity_preserved',true,'duplicate_recovered',duplicate_recovered,
    'candidate',private.market_radar_eligibility_payload(candidate)
  );
end;
$function$;
alter function public.apply_market_radar_prepare_eligibility_v4(
  uuid,bigint,text,timestamptz,jsonb,jsonb,jsonb,boolean
) owner to postgres;
revoke all on function public.apply_market_radar_prepare_eligibility_v4(
  uuid,bigint,text,timestamptz,jsonb,jsonb,jsonb,boolean
) from public,anon,authenticated,service_role;
grant execute on function public.apply_market_radar_prepare_eligibility_v4(
  uuid,bigint,text,timestamptz,jsonb,jsonb,jsonb,boolean
) to service_role;
revoke all on function public.apply_market_radar_prepare_eligibility_v1(
  uuid,bigint,text,timestamptz,jsonb,jsonb,boolean
) from public,anon,authenticated,service_role;
revoke all on function public.upsert_market_radar_batch(text,text,text,jsonb,jsonb)
  from public,anon,authenticated,service_role;
revoke all on function public.upsert_market_radar_batch_v2(text,text,text,jsonb,jsonb)
  from public,anon,authenticated,service_role;
revoke all on function public.upsert_market_radar_batch_with_fact_checks_v1(
  text,text,text,jsonb,jsonb,text,jsonb
) from public,anon,authenticated,service_role;
revoke all on function public.upsert_market_radar_batch_with_fact_checks_v2(
  text,text,text,jsonb,jsonb,text,jsonb
) from public,anon,authenticated,service_role;
revoke all on function public.upsert_market_radar_batch_with_eligibility_v1(
  text,text,text,jsonb,jsonb,text,jsonb
) from public,anon,authenticated,service_role;
revoke all on function public.apply_market_radar_prepare_verification(
  uuid,bigint,text,timestamptz,jsonb
) from public,anon,authenticated,service_role;
revoke all on function public.apply_market_radar_prepare_fact_verification_v1(
  uuid,bigint,text,timestamptz,jsonb,jsonb
) from public,anon,authenticated,service_role;
revoke all on function public.apply_market_radar_revalidation_fact_v1(
  uuid,bigint,text,timestamptz,jsonb,jsonb
) from public,anon,authenticated,service_role;
revoke all on function public.record_market_radar_fact_checks(jsonb)
  from public,anon,authenticated,service_role;

alter function private.assert_market_radar_draft_eligibility_v1(
  private.market_drafts,timestamptz
) rename to assert_market_radar_draft_eligibility_pre_parent_reconciliation_v1;
alter function private.assert_market_radar_draft_eligibility_pre_parent_reconciliation_v1(
  private.market_drafts,timestamptz
) owner to postgres;
revoke all on function private.assert_market_radar_draft_eligibility_pre_parent_reconciliation_v1(
  private.market_drafts,timestamptz
) from public,anon,authenticated,service_role;

create function private.assert_market_radar_draft_eligibility_v1(
  draft_input private.market_drafts,
  checked_at_input timestamptz default clock_timestamp()
)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare radar_lineage boolean;
begin
  radar_lineage:=draft_input.radar_candidate_id is not null
    or draft_input.intelligence_origin_type='radar_candidate'
    or coalesce(draft_input.source_provenance,'{}'::jsonb) ? 'radar_candidate_id'
    or coalesce(draft_input.source_provenance,'{}'::jsonb) ? 'origin_candidate_id';
  if radar_lineage and draft_input.radar_candidate_id is null then
    raise exception 'RADAR_DRAFT_ELIGIBILITY_BINDING_REQUIRED' using errcode='55000';
  end if;
  perform private.assert_market_radar_draft_eligibility_pre_parent_reconciliation_v1(
    draft_input,checked_at_input
  );
end;
$function$;
alter function private.assert_market_radar_draft_eligibility_v1(
  private.market_drafts,timestamptz
) owner to postgres;
revoke all on function private.assert_market_radar_draft_eligibility_v1(
  private.market_drafts,timestamptz
) from public,anon,authenticated,service_role;

create or replace function public.begin_market_draft_review_v3(
  draft_id_input uuid,
  expected_version_input bigint,
  request_key_input uuid,
  validator_version_input text,
  policy_version_input text,
  schema_version_input text,
  force_review_input boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  draft private.market_drafts%rowtype;
  initial_draft private.market_drafts%rowtype;
  candidate_lock private.external_market_candidates%rowtype;
  candidate_lock_id uuid;
  issue_value jsonb;
  issue_code_value text;
  error_value text;
begin
  perform private.require_current_admin();
  select * into initial_draft from private.market_drafts draft_alias
  where draft_alias.id=draft_id_input;
  if not found then raise exception 'DRAFT_NOT_FOUND' using errcode='P0001'; end if;
  if initial_draft.content_version is distinct from expected_version_input then
    raise exception 'DRAFT_VERSION_MOVED' using errcode='40001';
  end if;
  begin
    candidate_lock_id:=coalesce(
      initial_draft.radar_candidate_id,
      case when initial_draft.intelligence_origin_type='radar_candidate'
        and initial_draft.intelligence_origin_id~'^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        then initial_draft.intelligence_origin_id::uuid end,
      case when initial_draft.source_provenance ->> 'radar_candidate_id'
        ~'^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        then (initial_draft.source_provenance ->> 'radar_candidate_id')::uuid end,
      case when initial_draft.source_provenance ->> 'origin_candidate_id'
        ~'^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        then (initial_draft.source_provenance ->> 'origin_candidate_id')::uuid end
    );
  exception when invalid_text_representation then
    raise exception 'RADAR_DRAFT_SCOPE_MISMATCH' using errcode='40001';
  end;
  if candidate_lock_id is not null then
    select * into candidate_lock from private.external_market_candidates candidate_alias
    where candidate_alias.id=candidate_lock_id for update;
    if not found then raise exception 'RADAR_CANDIDATE_NOT_FOUND' using errcode='P0001'; end if;
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'market-draft-workflow:'||draft_id_input::text,0
  ));
  select * into draft from private.market_drafts draft_alias
  where draft_alias.id=draft_id_input for update;
  if not found or draft.content_version is distinct from initial_draft.content_version
     or draft.content_fingerprint is distinct from initial_draft.content_fingerprint
     or draft.radar_candidate_id is distinct from initial_draft.radar_candidate_id
     or draft.intelligence_origin_type is distinct from initial_draft.intelligence_origin_type
     or draft.intelligence_origin_id is distinct from initial_draft.intelligence_origin_id then
    raise exception 'DRAFT_VERSION_MOVED' using errcode='40001';
  end if;
  if draft.radar_candidate_id is not null
     or draft.intelligence_origin_type='radar_candidate'
     or coalesce(draft.source_provenance,'{}'::jsonb) ? 'radar_candidate_id'
     or coalesce(draft.source_provenance,'{}'::jsonb) ? 'origin_candidate_id' then
    begin
      perform private.assert_market_radar_draft_eligibility_v1(draft,clock_timestamp());
    exception when sqlstate '55000' or unique_violation or serialization_failure then
      error_value:=sqlerrm;
      if error_value not in (
        'RADAR_CONFIRMED_DUPLICATE','RADAR_EVENT_ALREADY_RESOLVED','RADAR_CANDIDATE_RESOLVED',
        'CHILD_IDENTITY_MISMATCH','RADAR_PARENT_RECONCILIATION_INCOMPLETE',
        'RADAR_CANDIDATE_IDENTITY_STALE','RADAR_DRAFT_ELIGIBILITY_BINDING_REQUIRED',
        'RADAR_DRAFT_ELIGIBILITY_PROVENANCE_REQUIRED','RADAR_ELIGIBILITY_REQUIRED',
        'RADAR_ELIGIBILITY_EXPIRED','RADAR_CANDIDATE_INELIGIBLE',
        'RADAR_RESOLUTION_SOURCE_REQUIRED'
      ) then raise; end if;
      issue_code_value:=case
        when error_value='RADAR_CONFIRMED_DUPLICATE' then 'RADAR_CONFIRMED_DUPLICATE'
        when error_value in ('RADAR_EVENT_ALREADY_RESOLVED','RADAR_CANDIDATE_RESOLVED')
          then 'RADAR_EVENT_ALREADY_RESOLVED'
        when error_value='CHILD_IDENTITY_MISMATCH' then 'CHILD_IDENTITY_MISMATCH'
        when error_value in ('RADAR_PARENT_RECONCILIATION_INCOMPLETE','RADAR_CANDIDATE_IDENTITY_STALE')
          then 'RADAR_PARENT_RECONCILIATION_INCOMPLETE'
        else 'RADAR_ELIGIBILITY_REQUIRED' end;
      issue_value:=private.market_workflow_server_issue_v1(
        issue_code_value,'validator',case when issue_code_value='CHILD_IDENTITY_MISMATCH'
          then 'corrector' else 'radar' end,
        case when issue_code_value='RADAR_EVENT_ALREADY_RESOLVED'
          then 'terminal' when issue_code_value='CHILD_IDENTITY_MISMATCH'
          then 'human_editable' else 'auto_recoverable' end,
        case when issue_code_value='RADAR_EVENT_ALREADY_RESOLVED'
          then 'terminal' else 'approval' end,
        case when issue_code_value='RADAR_EVENT_ALREADY_RESOLVED'
          then 'archive_terminal_candidate'
          when issue_code_value='CHILD_IDENTITY_MISMATCH' then 'repair_child_identity'
          when issue_code_value='RADAR_PARENT_RECONCILIATION_INCOMPLETE' then 'retry_provider_refresh'
          else 'refresh_draft_eligibility' end,
        jsonb_build_object('draft_id',draft.id,'cause',error_value),
        issue_code_value<>'RADAR_EVENT_ALREADY_RESOLVED',
        'atinara-market-review-policy-v3'
      );
      issue_value:=private.market_workflow_issue_deterministic_v1(issue_value);
      perform private.record_market_workflow_issue_v1(
        'market_draft',draft.id::text,draft.content_version::text,
        case when draft.content_fingerprint~'^[a-f0-9]{64}$'
          then draft.content_fingerprint else null end,
        issue_value,null,null
      );
      update private.market_drafts draft_alias set
        artifact_status=case when issue_value ->> 'blocking_scope'='terminal'
          then 'review_rejected_terminal'
          when draft_alias.workflow_status in ('review_approved','human_confirmed','scheduled')
          then 'publication_revalidation_required'
          else 'draft_with_repairable_issues' end,
        workflow_owner_stage=issue_value ->> 'owner_stage',
        workflow_next_action=issue_value ->> 'next_action',
        workflow_issue_count=greatest(coalesce(draft_alias.workflow_issue_count,0),1),
        updated_at=clock_timestamp()
      where draft_alias.id=draft.id
        and draft_alias.content_version=draft.content_version
        and draft_alias.content_fingerprint is not distinct from draft.content_fingerprint;
      return jsonb_build_object(
        'ok',false,'status','radar_revalidation_required','classification','content',
        'zero_inference',true,'state_preserved',true,
        'retryable',issue_code_value<>'RADAR_EVENT_ALREADY_RESOLVED',
        'owner_stage',issue_value ->> 'owner_stage','next_action',issue_value ->> 'next_action',
        'workflow_issues',jsonb_build_array(issue_value),
        'message','Validator no inició inferencia: Radar debe revalidar este expediente.'
      );
    end;
  end if;
  return public.begin_market_draft_review_v2(
    draft_id_input,expected_version_input,request_key_input,validator_version_input,
    policy_version_input,schema_version_input,force_review_input
  );
end;
$function$;
alter function public.begin_market_draft_review_v3(uuid,bigint,uuid,text,text,text,boolean)
  owner to postgres;
revoke all on function public.begin_market_draft_review_v3(uuid,bigint,uuid,text,text,text,boolean)
  from public,anon,authenticated,service_role;
grant execute on function public.begin_market_draft_review_v3(uuid,bigint,uuid,text,text,text,boolean)
  to authenticated;
revoke all on function public.begin_market_draft_review_v2(uuid,bigint,uuid,text,text,text,boolean)
  from public,anon,authenticated,service_role;

create or replace function public.get_market_radar_candidate_for_draft_revalidation_v3(
  candidate_id_input uuid,
  draft_id_input uuid,
  expected_version_input bigint,
  expected_fingerprint_input text
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  candidate private.external_market_candidates%rowtype;
  draft private.market_drafts%rowtype;
begin
  if auth.role()<>'service_role' then
    raise exception 'SERVICE_ROLE_REQUIRED' using errcode='42501';
  end if;
  select * into candidate from private.external_market_candidates candidate_alias
  where candidate_alias.id=candidate_id_input for share;
  if not found then raise exception 'RADAR_CANDIDATE_NOT_FOUND' using errcode='P0001'; end if;
  select * into draft from private.market_drafts draft_alias
  where draft_alias.id=draft_id_input for share;
  if not found or draft.content_version is distinct from expected_version_input
     or draft.content_fingerprint is distinct from lower(expected_fingerprint_input)
     or draft.market_id is not null then
    raise exception 'DRAFT_VERSION_MOVED' using errcode='40001';
  end if;
  if draft.radar_candidate_id=candidate.id and candidate.prepared_draft_id=draft.id then
    return public.get_market_radar_candidate_for_draft_revalidation_v2(
      candidate.id,draft.id,expected_version_input,expected_fingerprint_input
    )||jsonb_build_object('has_active_radar_draft',true,'pending_recovery',false);
  end if;
  if draft.radar_candidate_id is not null
     or candidate.prepared_draft_id is not null
     or draft.intelligence_origin_type<>'radar_candidate'
     or draft.intelligence_origin_id is distinct from candidate.id::text
     or draft.source_provenance ->> 'binding_status'<>'pending_recovery'
     or draft.source_provenance ->> 'origin_candidate_id' is distinct from candidate.id::text
     or draft.workflow_status in ('cancelled','annulled','published') then
    raise exception 'RADAR_DRAFT_SCOPE_MISMATCH' using errcode='55000';
  end if;
  return private.market_radar_eligibility_payload(candidate)||jsonb_build_object(
    'has_active_radar_draft',true,'pending_recovery',true,'scoped_draft_id',draft.id
  );
end;
$function$;
alter function public.get_market_radar_candidate_for_draft_revalidation_v3(uuid,uuid,bigint,text)
  owner to postgres;
revoke all on function public.get_market_radar_candidate_for_draft_revalidation_v3(uuid,uuid,bigint,text)
  from public,anon,authenticated,service_role;
grant execute on function public.get_market_radar_candidate_for_draft_revalidation_v3(uuid,uuid,bigint,text)
  to service_role;
revoke all on function public.get_market_radar_candidate_for_draft_revalidation_v2(uuid,uuid,bigint,text)
  from public,anon,authenticated,service_role;

alter function private.publication_issue_v1(uuid,bigint,text)
  rename to publication_issue_pre_parent_reconciliation_v1;
alter function private.publication_issue_pre_parent_reconciliation_v1(uuid,bigint,text)
  owner to postgres;
revoke all on function private.publication_issue_pre_parent_reconciliation_v1(uuid,bigint,text)
  from public,anon,authenticated,service_role;

create function private.publication_issue_v1(
  draft_id_input uuid,
  expected_version_input bigint,
  error_code_input text
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
begin
  if error_code_input in ('RADAR_CONFIRMED_DUPLICATE','RADAR_EVENT_ALREADY_RESOLVED') then
    return private.market_workflow_issue_deterministic_v1(
      private.market_workflow_server_issue_v1(
      error_code_input,'publication_gate','radar','terminal','terminal',
      'archive_terminal_candidate',jsonb_build_object(
        'draft_id',draft_id_input,'expected_version',expected_version_input
      ),false,'atinara-radar-parent-reconciliation-v1'
      )
    );
  elsif error_code_input in (
    'RADAR_PARENT_RECONCILIATION_INCOMPLETE','RADAR_CANDIDATE_IDENTITY_STALE',
    'CANONICAL_CHILD_PROJECTION_INVALID','RADAR_CANDIDATE_INELIGIBLE',
    'PROVIDER_NOT_OPEN','PROVIDER_OPTION_INACTIVE','PROVIDER_EVENT_NOT_FOUND',
    'PROVIDER_CHILD_NOT_FOUND'
  ) then
    return private.market_workflow_issue_deterministic_v1(
      private.market_workflow_server_issue_v1(
      error_code_input,'publication_gate','radar','auto_recoverable','publication',
      case when error_code_input='RADAR_PARENT_RECONCILIATION_INCOMPLETE'
        then 'retry_provider_refresh' else 'refresh_draft_eligibility' end,
      jsonb_build_object('draft_id',draft_id_input,'expected_version',expected_version_input),
      true,'atinara-radar-parent-reconciliation-v1'
      )
    );
  elsif error_code_input='CHILD_IDENTITY_MISMATCH' then
    return private.market_workflow_issue_deterministic_v1(
      private.market_workflow_server_issue_v1(
      error_code_input,'publication_gate','corrector','human_editable','publication',
      'repair_child_identity',jsonb_build_object(
        'draft_id',draft_id_input,'expected_version',expected_version_input
      ),true,'atinara-radar-parent-reconciliation-v1'
      )
    );
  end if;
  return private.publication_issue_pre_parent_reconciliation_v1(
    draft_id_input,expected_version_input,error_code_input
  );
end;
$function$;
alter function private.publication_issue_v1(uuid,bigint,text) owner to postgres;
revoke all on function private.publication_issue_v1(uuid,bigint,text)
  from public,anon,authenticated,service_role;

create or replace function public.confirm_market_draft_review_v3(
  draft_id_input uuid,
  expected_version_input bigint
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  draft private.market_drafts%rowtype;
  initial_draft private.market_drafts%rowtype;
  candidate_lock private.external_market_candidates%rowtype;
  candidate_lock_id uuid;
begin
  perform private.require_current_admin();
  select * into initial_draft from private.market_drafts draft_alias
  where draft_alias.id=draft_id_input;
  if not found then raise exception 'DRAFT_NOT_FOUND' using errcode='P0001'; end if;
  if initial_draft.content_version is distinct from expected_version_input then
    raise exception 'DRAFT_VERSION_MOVED' using errcode='40001';
  end if;
  begin
    candidate_lock_id:=coalesce(
      initial_draft.radar_candidate_id,
      case when initial_draft.intelligence_origin_type='radar_candidate'
        and initial_draft.intelligence_origin_id~'^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        then initial_draft.intelligence_origin_id::uuid end,
      case when initial_draft.source_provenance ->> 'radar_candidate_id'
        ~'^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        then (initial_draft.source_provenance ->> 'radar_candidate_id')::uuid end,
      case when initial_draft.source_provenance ->> 'origin_candidate_id'
        ~'^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        then (initial_draft.source_provenance ->> 'origin_candidate_id')::uuid end
    );
  exception when invalid_text_representation then
    raise exception 'RADAR_DRAFT_SCOPE_MISMATCH' using errcode='40001';
  end;
  if candidate_lock_id is not null then
    select * into candidate_lock from private.external_market_candidates candidate_alias
    where candidate_alias.id=candidate_lock_id for update;
    if not found then raise exception 'RADAR_CANDIDATE_NOT_FOUND' using errcode='P0001'; end if;
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'market-draft-workflow:'||draft_id_input::text,0
  ));
  select * into draft from private.market_drafts draft_alias
  where draft_alias.id=draft_id_input for update;
  if not found or draft.content_version is distinct from initial_draft.content_version
     or draft.content_fingerprint is distinct from initial_draft.content_fingerprint
     or draft.radar_candidate_id is distinct from initial_draft.radar_candidate_id
     or draft.intelligence_origin_type is distinct from initial_draft.intelligence_origin_type
     or draft.intelligence_origin_id is distinct from initial_draft.intelligence_origin_id then
    raise exception 'DRAFT_VERSION_MOVED' using errcode='40001';
  end if;
  return public.confirm_market_draft_review_v2(draft_id_input,expected_version_input);
end;
$function$;
alter function public.confirm_market_draft_review_v3(uuid,bigint) owner to postgres;
revoke all on function public.confirm_market_draft_review_v3(uuid,bigint)
  from public,anon,authenticated,service_role;
grant execute on function public.confirm_market_draft_review_v3(uuid,bigint) to authenticated;
revoke all on function public.confirm_market_draft_review_v2(uuid,bigint)
  from public,anon,authenticated,service_role;

alter function public.save_market_draft_from_expert_with_issues_v1(uuid,uuid,jsonb)
  rename to save_market_draft_from_expert_with_issues_pre_parent_v1;
revoke all on function public.save_market_draft_from_expert_with_issues_pre_parent_v1(
  uuid,uuid,jsonb
) from public,anon,authenticated,service_role;

create or replace function public.save_market_draft_from_expert_with_issues_v2(
  candidate_id_input uuid,
  expert_run_id_input uuid,
  draft_input jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to ''
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
  select * into candidate
  from private.external_market_candidates candidate_alias
  where candidate_alias.id=candidate_id_input
  for update;
  if not found then
    raise exception 'RADAR_CANDIDATE_NOT_FOUND' using errcode='P0001';
  end if;
  if candidate.normalizer_version='atinara-radar-v3'
     and not private.market_radar_candidate_reconciliation_bound_v1(candidate) then
    raise exception 'RADAR_PARENT_RECONCILIATION_INCOMPLETE' using errcode='55000';
  elsif candidate.normalizer_version<>'atinara-radar-v3'
     and not (candidate.normalizer_version='atinara-radar-v2'
       and candidate.state='prepared' and candidate.prepared_draft_id is not null) then
    raise exception 'RADAR_NORMALIZER_OUTDATED' using errcode='55000';
  end if;
  select * into expert
  from private.market_expert_runs expert_alias
  where expert_alias.id=expert_run_id_input
  for share;
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
  from private.market_drafts draft_alias
  where draft_alias.intelligence_origin_type='radar_candidate'
    and draft_alias.intelligence_origin_id=candidate.id::text
    and coalesce(draft_alias.workflow_status,'draft_ready')<>'cancelled'
  order by draft_alias.created_at,draft_alias.id
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
  if candidate.normalizer_version='atinara-radar-v2' then
    raise exception 'RADAR_LEGACY_PREPARED_DRAFT_REQUIRED' using errcode='55000';
  end if;
  if candidate.eligibility_status in ('terminal','inactive_option','invalid','duplicate')
     or candidate.verification_status in (
       'rejected_resolved','rejected_duplicate','rejected_invalid_source','rejected_ineligible'
     ) then
    raise exception '%',case
      when candidate.eligibility_status='duplicate'
        or candidate.verification_status='rejected_duplicate' then 'RADAR_CONFIRMED_DUPLICATE'
      when candidate.eligibility_status='terminal'
        or candidate.verification_status='rejected_resolved' then 'RADAR_EVENT_ALREADY_RESOLVED'
      else 'RADAR_CANDIDATE_INELIGIBLE' end using errcode='55000';
  end if;
  if not private.market_radar_candidate_reconciliation_ready_v1(candidate) then
    raise exception 'RADAR_CANDIDATE_INELIGIBLE' using errcode='55000';
  end if;
  -- El issue editorial puede permitir crear un borrador reparable, pero nunca
  -- omite la autoridad de duplicado live ni su lock V4/V5.
  perform private.assert_market_radar_candidate_no_live_duplicate_v1(candidate);
  workflow_issues:=coalesce(
    expert.result_json -> 'workflow_issues',
    candidate.normalized_payload -> 'workflow_issues','[]'::jsonb
  );
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
  elsif candidate.family_version not in ('atinara-market-family-v4','atinara-market-family-v5')
     or candidate.family_child_key not like 'option:%'
     or nullif(candidate.family_child_label,'') is null then
    raise exception 'CHILD_IDENTITY_MISMATCH' using errcode='55000';
  end if;
  result:=public.save_market_draft(null,null,draft_input||jsonb_build_object(
    '_change_origin','radar_expert_issue_draft_v2','_binding_managed_externally',true,
    '_expert_candidate_id',candidate.id,'_expert_run_id',expert.id,
    '_expert_origin_fingerprint',expert.origin_fingerprint,
    '_expert_origin_preparation_revision',candidate.preparation_revision
  ));
  draft_id_value:=(result #>> '{draft,id}')::uuid;
  select * into saved_draft
  from private.market_drafts draft_alias
  where draft_alias.id=draft_id_value
  for update;
  if not found then raise exception 'DRAFT_NOT_FOUND' using errcode='P0001'; end if;
  provenance:=jsonb_build_object(
    'origin_type','radar_candidate','origin_candidate_id',candidate_id_input,
    'origin_preparation_revision',candidate.preparation_revision,
    'origin_fingerprint',candidate.fingerprint,'expert_run_id',expert_run_id_input,
    'issue_draft_request_hash',draft_request_hash_value,
    'workflow_issues',workflow_issues,'temporal_contract',temporal_contract,
    'candidate_workflow_issue_fingerprints',candidate_issue_fingerprints,
    'binding_status','pending_recovery','created_by_actor',actor,
    'radar_analysis_binding',jsonb_build_object(
      'source_fingerprint',candidate.fingerprint,
      'provider_child_contract_hash',candidate.normalized_payload ->> 'provider_child_contract_hash',
      'family_version',candidate.family_version,'family_key',candidate.family_key,
      'family_child_key',candidate.family_child_key,
      'temporal_decision_hash',candidate.normalized_payload #>> '{temporal_contract,decision_hash}',
      'domain_fingerprint',candidate.normalized_payload ->> 'domain_fingerprint'
    ),
    'radar_identity_binding',jsonb_build_object(
      'family_version',candidate.family_version,
      'family_key',candidate.family_key,
      'family_child_key',candidate.family_child_key,
      'parent_reconciliation_fingerprint',
        candidate.normalized_payload ->> 'parent_reconciliation_fingerprint',
      'parent_child_fingerprint',candidate.normalized_payload ->> 'parent_child_fingerprint',
      'provider_child_contract_hash',candidate.normalized_payload ->> 'provider_child_contract_hash'
    ),
    'provider_truth',jsonb_build_object(
      'provider',candidate.provider,'external_id',candidate.external_id,
      'provider_child_contract',candidate.normalized_payload -> 'provider_child_contract',
      'provider_child_contract_hash',candidate.normalized_payload ->> 'provider_child_contract_hash',
      'source_question',candidate.normalized_payload -> 'source_question',
      'source_resolution_rules',candidate.normalized_payload -> 'source_resolution_rules',
      'source_resolution_url',candidate.normalized_payload -> 'source_resolution_url',
      'source_close_at',candidate.normalized_payload -> 'source_close_at',
      'source_resolution_deadline',candidate.normalized_payload -> 'source_resolution_deadline'
    )
  );
  update private.market_drafts set
    intelligence_origin_type='radar_candidate',intelligence_origin_id=candidate_id_input::text,
    expert_run_id=expert_run_id_input,source_provenance=provenance,
    artifact_status='draft_with_repairable_issues',workflow_owner_stage='validator',
    workflow_next_action='request_market_validation',workflow_issue_count=jsonb_array_length(workflow_issues),
    family_key=candidate.family_key,family_title=candidate.family_title,
    family_type=candidate.family_type,family_child_key=candidate.family_child_key,
    family_child_label=candidate.family_child_label,family_sort_at=candidate.family_sort_at,
    family_relationship='standalone',family_semantics=coalesce(candidate.family_semantics,'{}'::jsonb),
    family_source_event_key=candidate.family_source_event_key,family_version=candidate.family_version
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
  select * into saved_draft
  from private.market_drafts draft_alias
  where draft_alias.id=draft_id_value;
  if row(
    saved_draft.family_key,saved_draft.family_title,saved_draft.family_type,
    saved_draft.family_child_key,saved_draft.family_child_label,saved_draft.family_sort_at,
    saved_draft.family_semantics,saved_draft.family_source_event_key,saved_draft.family_version
  ) is distinct from row(
    candidate.family_key,candidate.family_title,candidate.family_type,
    candidate.family_child_key,candidate.family_child_label,candidate.family_sort_at,
    coalesce(candidate.family_semantics,'{}'::jsonb),candidate.family_source_event_key,candidate.family_version
  ) then
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
      'family_version',saved_draft.family_version
    ),
    'workflow_issues',workflow_issues,'binding_status','pending_recovery',
    'creates_private_draft',true,'publishes',false,'confirms',false,
    'identity_contract_version','atinara-radar-preparation-identity-v1'
  );
end;
$function$;

alter function public.save_market_draft_from_expert_with_issues_v2(uuid,uuid,jsonb)
  owner to postgres;
revoke all on function public.save_market_draft_from_expert_with_issues_v2(uuid,uuid,jsonb)
  from public,anon,authenticated,service_role;
grant execute on function public.save_market_draft_from_expert_with_issues_v2(uuid,uuid,jsonb)
  to authenticated;

create or replace function public.save_market_draft_from_expert_with_issues_v1(
  candidate_id_input uuid,
  expert_run_id_input uuid,
  draft_input jsonb
)
returns jsonb
language sql
volatile
security definer
set search_path to ''
as $function$
  select public.save_market_draft_from_expert_with_issues_v2(
    candidate_id_input,expert_run_id_input,draft_input
  );
$function$;
alter function public.save_market_draft_from_expert_with_issues_v1(uuid,uuid,jsonb)
  owner to postgres;
revoke all on function public.save_market_draft_from_expert_with_issues_v1(uuid,uuid,jsonb)
  from public,anon,authenticated,service_role;
grant execute on function public.save_market_draft_from_expert_with_issues_v1(uuid,uuid,jsonb)
  to authenticated;

create or replace function private.assert_market_radar_candidate_eligible_v1(
  candidate_id_input uuid,
  expected_preparation_revision_input bigint default null
)
returns private.external_market_candidates
language plpgsql
security definer
set search_path to ''
as $function$
declare
  candidate private.external_market_candidates%rowtype;
  eligibility private.market_radar_eligibility_checks%rowtype;
  legacy_prepared boolean;
  lock_identity_value text;
begin
  select * into candidate
  from private.external_market_candidates candidate_alias
  where candidate_alias.id=candidate_id_input for share;
  if not found then raise exception 'RADAR_CANDIDATE_NOT_FOUND' using errcode='P0001'; end if;
  if expected_preparation_revision_input is not null
     and candidate.preparation_revision is distinct from expected_preparation_revision_input then
    raise exception 'RADAR_PREPARATION_REVISION_MISMATCH' using errcode='40001';
  end if;
  if candidate.eligibility_status='terminal'
     or candidate.verification_status='rejected_resolved' then
    raise exception 'RADAR_EVENT_ALREADY_RESOLVED' using errcode='55000';
  end if;
  if candidate.eligibility_status='duplicate'
     or candidate.verification_status='rejected_duplicate' then
    raise exception 'RADAR_CONFIRMED_DUPLICATE' using errcode='23505';
  end if;
  lock_identity_value:=private.market_radar_candidate_cross_version_identity_v1(candidate);
  if lock_identity_value is not null then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(lock_identity_value,0));
    if private.market_radar_candidate_has_live_duplicate_v1(candidate) then
      raise exception 'RADAR_CONFIRMED_DUPLICATE' using errcode='23505';
    end if;
  end if;
  legacy_prepared:=candidate.normalizer_version='atinara-radar-v2'
    and candidate.state='prepared' and candidate.prepared_draft_id is not null;
  if not legacy_prepared
     and not private.market_radar_candidate_reconciliation_ready_v1(candidate) then
    raise exception 'RADAR_PARENT_RECONCILIATION_INCOMPLETE' using errcode='55000';
  end if;
  select * into eligibility
  from private.market_radar_eligibility_checks check_alias
  where check_alias.id=candidate.current_eligibility_check_id;
  if not found
     or eligibility.candidate_id is distinct from candidate.id
     or eligibility.policy_version is distinct from 'atinara-prediction-policy-v5'
     or eligibility.status is distinct from candidate.eligibility_status
     or eligibility.checked_at is distinct from candidate.eligibility_checked_at
     or eligibility.expires_at is distinct from candidate.eligibility_expires_at then
    raise exception 'RADAR_ELIGIBILITY_REQUIRED' using errcode='55000';
  end if;
  if candidate.eligibility_status is distinct from 'eligible'
     or candidate.eligibility_policy_version is distinct from 'atinara-prediction-policy-v5'
     or candidate.verification_status is distinct from 'verified_open' then
    raise exception 'RADAR_CANDIDATE_INELIGIBLE' using errcode='55000';
  end if;
  if not private.market_radar_candidate_resolution_source_ready_v1(candidate) then
    raise exception 'RADAR_RESOLUTION_SOURCE_REQUIRED' using errcode='55000';
  end if;
  if eligibility.expires_at<=now() then
    raise exception 'RADAR_ELIGIBILITY_EXPIRED' using errcode='55000';
  end if;
  return candidate;
end;
$function$;
revoke all on function private.assert_market_radar_candidate_eligible_v1(uuid,bigint)
  from public,anon,authenticated,service_role;

create or replace function public.get_market_radar_eligibility_attempt_checkpoint_v1(
  candidate_id_input uuid,
  attempt_id_input uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  candidate private.external_market_candidates%rowtype;
  eligibility private.market_radar_eligibility_checks%rowtype;
begin
  if auth.role()<>'service_role' then
    raise exception 'SERVICE_ROLE_REQUIRED' using errcode='42501';
  end if;
  if candidate_id_input is null or attempt_id_input is null then
    raise exception 'RADAR_ELIGIBILITY_CHECKPOINT_SCOPE_INVALID' using errcode='22023';
  end if;
  select * into eligibility from private.market_radar_eligibility_checks check_alias
  where check_alias.attempt_id=attempt_id_input
    and check_alias.candidate_id=candidate_id_input;
  if not found then return jsonb_build_object('found',false,'replayed',false); end if;
  select * into candidate from private.external_market_candidates candidate_alias
  where candidate_alias.id=candidate_id_input;
  if not found or candidate.current_eligibility_check_id is distinct from eligibility.id
     or candidate.eligibility_status is distinct from eligibility.status
     or candidate.eligibility_checked_at is distinct from eligibility.checked_at
     or candidate.eligibility_expires_at is distinct from eligibility.expires_at then
    return jsonb_build_object(
      'found',true,'replayed',false,'error','RADAR_ELIGIBILITY_CHECKPOINT_SUPERSEDED',
      'eligibility_check_id',eligibility.id
    );
  end if;
  if eligibility.expires_at<=now() then
    return jsonb_build_object(
      'found',true,'replayed',false,'error','RADAR_ELIGIBILITY_EXPIRED',
      'eligibility_check_id',eligibility.id
    );
  end if;
  if eligibility.status<>'eligible' then
    return jsonb_build_object(
      'found',true,'replayed',false,
      'error',coalesce(eligibility.reason_code,'RADAR_CANDIDATE_INELIGIBLE'),
      'eligibility_check_id',eligibility.id,'candidate',private.market_radar_eligibility_payload(candidate)
    );
  end if;
  return jsonb_build_object(
    'found',true,'replayed',true,'eligibility_check_id',eligibility.id,
    'decision_hash',eligibility.decision_hash,'checked_at',eligibility.checked_at,
    'expires_at',eligibility.expires_at,'candidate',private.market_radar_eligibility_payload(candidate)
  );
end;
$function$;
alter function public.get_market_radar_eligibility_attempt_checkpoint_v1(uuid,uuid)
  owner to postgres;
revoke all on function public.get_market_radar_eligibility_attempt_checkpoint_v1(uuid,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.get_market_radar_eligibility_attempt_checkpoint_v1(uuid,uuid)
  to service_role;

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
set search_path to ''
as $function$
declare
  candidate private.external_market_candidates%rowtype;
  draft private.market_drafts%rowtype;
  expert private.market_expert_runs%rowtype;
  eligibility private.market_radar_eligibility_checks%rowtype;
  current_child private.market_radar_parent_children_v1%rowtype;
  binding jsonb;
  material_repair_proven boolean:=false;
  source_exact boolean:=false;
  temporal_exact boolean:=false;
  baseline_contract_hash text;
  issue_state record;
  latest_status_value text;
  latest_owner_value text;
  latest_action_value text;
  contract_temporal_change boolean;
  contract_source_change boolean;
  contract_validation_pending boolean:=false;
begin
  if auth.role()<>'service_role' then
    raise exception 'SERVICE_ROLE_REQUIRED' using errcode='42501';
  end if;
  if actor_id_input is null or attempt_id_input is null
     or coalesce(expected_fingerprint_input,'')!~'^[a-f0-9]{64}$'
     or not exists (
       select 1 from auth.users actor
       where actor.id=actor_id_input
         and coalesce((actor.raw_app_meta_data ->> 'oraklo_admin')::boolean,false)
     ) then raise exception 'ADMIN_REQUIRED' using errcode='42501'; end if;

  -- Orden único para evitar candidate->draft frente a draft->candidate.
  select * into candidate from private.external_market_candidates candidate_alias
  where candidate_alias.id=candidate_id_input for update;
  if not found then raise exception 'RADAR_CANDIDATE_NOT_FOUND' using errcode='P0001'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'market-draft-workflow:'||draft_id_input::text,0
  ));
  select * into draft from private.market_drafts draft_alias
  where draft_alias.id=draft_id_input for update;
  if not found then raise exception 'DRAFT_NOT_FOUND' using errcode='P0001'; end if;
  if draft.content_version is distinct from expected_version_input
     or draft.content_fingerprint is distinct from expected_fingerprint_input
     or draft.intelligence_origin_type<>'radar_candidate'
     or draft.intelligence_origin_id is distinct from candidate.id::text
     or draft.market_id is not null then
    raise exception 'DRAFT_VERSION_MOVED' using errcode='40001';
  end if;

  if candidate.normalizer_version='atinara-radar-v3' then
    if not private.market_radar_candidate_reconciliation_bound_v1(candidate) then
      raise exception 'RADAR_PARENT_RECONCILIATION_INCOMPLETE' using errcode='55000';
    end if;
    select child_alias.* into current_child
    from private.market_radar_parent_reconciliations_v1 parent_alias
    join private.market_radar_parent_children_v1 child_alias
      on child_alias.parent_reconciliation_id=parent_alias.id
    where parent_alias.id=candidate.current_parent_reconciliation_id
      and child_alias.id=candidate.current_parent_child_id
      and parent_alias.reconciliation_status='complete'
      and child_alias.present_in_current_snapshot
      and child_alias.identity_status='resolved'
      and child_alias.child_fingerprint
        =candidate.normalized_payload ->> 'parent_child_fingerprint'
      and child_alias.provider_contract_hash
        =candidate.normalized_payload ->> 'provider_child_contract_hash';
    if not found then
      raise exception 'RADAR_CANDIDATE_IDENTITY_STALE' using errcode='40001';
    end if;
  elsif not (candidate.normalizer_version='atinara-radar-v2'
      and candidate.prepared_draft_id=draft.id) then
    raise exception 'RADAR_NORMALIZER_OUTDATED' using errcode='55000';
  end if;

  if draft.expert_run_id is not null then
    select * into expert from private.market_expert_runs expert_alias
    where expert_alias.id=draft.expert_run_id;
    if not found or expert.origin_type<>'radar_candidate'
       or expert.origin_id is distinct from candidate.id::text
       or expert.status<>'completed'
       or expert.result_json ->> 'origin_analysis_fingerprint'
         is distinct from expert.origin_fingerprint then
      raise exception 'MARKET_EXPERT_ANALYSIS_STALE' using errcode='40001';
    end if;
  end if;

  -- Todo issue efectivo del candidato debe viajar con el mismo issue_id al
  -- borrador/version actual. El array histórico de provenance no es autoridad.
  if exists (
    select 1
    from private.market_workflow_issue_occurrences_v1 occurrence
    join private.market_workflow_issue_subject_links_v1 candidate_link
      on candidate_link.issue_id=occurrence.issue_id
    left join lateral (
      select event.new_status from private.market_workflow_issue_events_v1 event
      where event.issue_id=occurrence.issue_id
      order by event.occurred_at desc,event.id desc limit 1
    ) latest on true
    where candidate_link.subject_type='radar_candidate'
      and candidate_link.subject_key=candidate.id::text
      and coalesce(latest.new_status,occurrence.status) not in ('resolved','superseded')
      and not exists (
        select 1 from private.market_workflow_issue_subject_links_v1 draft_link
        where draft_link.issue_id=occurrence.issue_id
          and draft_link.subject_type='market_draft'
          and draft_link.subject_key=draft.id::text
          and draft_link.subject_version=draft.content_version::text
          and draft_link.subject_fingerprint is not distinct from draft.content_fingerprint
      )
  ) then raise exception 'MARKET_EXPERT_ANALYSIS_STALE' using errcode='40001'; end if;

  material_repair_proven:=private.market_radar_material_repair_checkpoint_valid_v1(
    draft,candidate
  );
  select exists (
    select 1 from private.market_workflow_issue_occurrences_v1 occurrence
    join private.market_workflow_issue_subject_links_v1 link
      on link.issue_id=occurrence.issue_id
    left join lateral (
      select event.new_status from private.market_workflow_issue_events_v1 event
      where event.issue_id=occurrence.issue_id
      order by event.occurred_at desc,event.id desc limit 1
    ) latest on true
    where link.subject_type='market_draft' and link.subject_key=draft.id::text
      and link.subject_version=draft.content_version::text
      and occurrence.issue_code='PROVIDER_CHILD_CONTRACT_CHANGED'
      and coalesce(latest.new_status,occurrence.status) not in ('resolved','superseded')
  ) into contract_validation_pending;

  if expert.id is not null
     and expert.result_json ->> 'origin_source_fingerprint' is distinct from candidate.fingerprint
     and not material_repair_proven
     and not (
       draft.source_provenance #>> '{radar_analysis_binding,source_fingerprint}'
         is not distinct from expert.result_json ->> 'origin_source_fingerprint'
       and draft.source_provenance #>> '{radar_analysis_binding,provider_child_contract_hash}'
         is not distinct from candidate.normalized_payload ->> 'provider_child_contract_hash'
       and draft.source_provenance #>> '{radar_analysis_binding,family_version}'
         is not distinct from candidate.family_version
       and draft.source_provenance #>> '{radar_analysis_binding,family_key}'
         is not distinct from candidate.family_key
       and draft.source_provenance #>> '{radar_analysis_binding,family_child_key}'
         is not distinct from candidate.family_child_key
       and draft.source_provenance #>> '{radar_analysis_binding,temporal_decision_hash}'
         is not distinct from candidate.normalized_payload #>> '{temporal_contract,decision_hash}'
       and draft.source_provenance #>> '{radar_analysis_binding,domain_fingerprint}'
         is not distinct from candidate.normalized_payload ->> 'domain_fingerprint'
     ) then raise exception 'MARKET_EXPERT_ANALYSIS_STALE' using errcode='40001'; end if;

  if not material_repair_proven and exists (
    select 1
    from private.market_workflow_issue_occurrences_v1 occurrence
    join private.market_workflow_issue_subject_links_v1 link on link.issue_id=occurrence.issue_id
    left join lateral (
      select event.new_status from private.market_workflow_issue_events_v1 event
      where event.issue_id=occurrence.issue_id
      order by event.occurred_at desc,event.id desc limit 1
    ) latest on true
    where link.subject_type='market_draft' and link.subject_key=draft.id::text
      and link.subject_version=draft.content_version::text
      and occurrence.issue_code in (
        'CHILD_IDENTITY_MISMATCH','PROVIDER_CHILD_CONTRACT_CHANGED',
        'CANONICAL_CHILD_PROJECTION_INVALID'
      )
      and coalesce(latest.new_status,occurrence.status) not in ('resolved','superseded')
  ) then raise exception 'MARKET_EXPERT_ANALYSIS_STALE' using errcode='40001'; end if;

  baseline_contract_hash:=coalesce(
    draft.source_provenance #>> '{radar_identity_binding,provider_child_contract_hash}',
    draft.source_provenance #>> '{provider_truth,provider_child_contract_hash}',
    draft.source_provenance ->> 'radar_recovery_provider_child_contract_hash'
  );
  if candidate.normalizer_version='atinara-radar-v3'
     and baseline_contract_hash is not null
     and baseline_contract_hash is distinct from current_child.provider_contract_hash
     and not material_repair_proven then
    raise exception 'MARKET_EXPERT_ANALYSIS_STALE' using errcode='40001';
  end if;
  if row(draft.family_version,draft.family_key,draft.family_type,
      draft.family_child_key,draft.family_child_label)
     is distinct from row(candidate.family_version,candidate.family_key,candidate.family_type,
      candidate.family_child_key,candidate.family_child_label) then
    raise exception 'CHILD_IDENTITY_MISMATCH' using errcode='55000';
  end if;
  perform private.assert_market_candidate_draft_identity_v1(candidate.id,to_jsonb(draft));

  if draft.source_provenance #>> '{temporal_contract,decision_hash}' is not null
     and draft.source_provenance #>> '{temporal_contract,decision_hash}'
       is distinct from candidate.normalized_payload #>> '{temporal_contract,decision_hash}'
     and not material_repair_proven then
    raise exception 'MARKET_EXPERT_ANALYSIS_STALE' using errcode='40001';
  end if;
  candidate:=private.assert_market_radar_candidate_eligible_v1(
    candidate.id,candidate.preparation_revision
  );
  select * into eligibility from private.market_radar_eligibility_checks check_alias
  where check_alias.id=candidate.current_eligibility_check_id for share;
  if not found or eligibility.status<>'eligible'
     or eligibility.policy_version<>'atinara-prediction-policy-v5'
     or eligibility.expires_at<=clock_timestamp() then
    raise exception 'RADAR_ELIGIBILITY_REQUIRED' using errcode='55000';
  end if;
  if candidate.prepared_draft_id is not null and candidate.prepared_draft_id<>draft.id then
    raise exception 'RADAR_DRAFT_SCOPE_MISMATCH' using errcode='55000';
  end if;

  source_exact:=nullif(candidate.normalized_payload ->> 'atinara_resolution_source_url','') is not null
    and draft.primary_source ->> 'url'
      =candidate.normalized_payload ->> 'atinara_resolution_source_url';
  begin
    temporal_exact:=jsonb_typeof(candidate.normalized_payload -> 'temporal_contract')='object'
      and nullif(candidate.normalized_payload #>> '{temporal_contract,decision_hash}','') is not null
      and draft.closes_at is not distinct from
        nullif(candidate.normalized_payload #>> '{temporal_contract,forecast_closes_at}','')::timestamptz
      and draft.evaluation_ends_at is not distinct from
        nullif(candidate.normalized_payload #>> '{temporal_contract,evaluation_ends_at}','')::timestamptz
      and draft.resolution_deadline is not distinct from
        nullif(candidate.normalized_payload #>> '{temporal_contract,resolution_deadline}','')::timestamptz
      and draft.timezone is not distinct from
        nullif(candidate.normalized_payload #>> '{temporal_contract,timezone}','');
  exception when invalid_text_representation or datetime_field_overflow then
    temporal_exact:=false;
  end;

  update private.external_market_candidates candidate_alias set
    state='prepared',prepared_draft_id=draft.id,updated_at=clock_timestamp()
  where candidate_alias.id=candidate.id;
  select * into candidate from private.external_market_candidates candidate_alias
  where candidate_alias.id=candidate_id_input for update;
  update private.market_drafts draft_alias set
    radar_candidate_id=candidate.id,
    source_provenance=coalesce(draft_alias.source_provenance,'{}'::jsonb)||jsonb_build_object(
      'radar_candidate_id',candidate.id,
      'radar_preparation_revision',candidate.preparation_revision,
      'radar_eligibility_check_id',eligibility.id,
      'radar_eligibility_policy_version',eligibility.policy_version,
      'radar_eligibility_decision_hash',eligibility.decision_hash,
      'radar_recovery_source_fingerprint',candidate.fingerprint,
      'radar_recovery_provider_child_contract_hash',
        candidate.normalized_payload ->> 'provider_child_contract_hash',
      'radar_analysis_binding',jsonb_build_object(
        'source_fingerprint',candidate.fingerprint,
        'provider_child_contract_hash',candidate.normalized_payload ->> 'provider_child_contract_hash',
        'family_version',candidate.family_version,'family_key',candidate.family_key,
        'family_child_key',candidate.family_child_key,
        'temporal_decision_hash',candidate.normalized_payload #>> '{temporal_contract,decision_hash}',
        'domain_fingerprint',candidate.normalized_payload ->> 'domain_fingerprint'
      ),
      'radar_identity_binding',jsonb_build_object(
        'family_version',candidate.family_version,'family_key',candidate.family_key,
        'family_child_key',candidate.family_child_key,
        'parent_reconciliation_fingerprint',
          candidate.normalized_payload ->> 'parent_reconciliation_fingerprint',
        'parent_child_fingerprint',candidate.normalized_payload ->> 'parent_child_fingerprint',
        'provider_child_contract_hash',
          candidate.normalized_payload ->> 'provider_child_contract_hash'
      ),
      'provider_truth',jsonb_build_object(
        'provider',candidate.provider,'external_id',candidate.external_id,
        'provider_child_contract',candidate.normalized_payload -> 'provider_child_contract',
        'provider_child_contract_hash',candidate.normalized_payload ->> 'provider_child_contract_hash'
      ),
      'temporal_contract',candidate.normalized_payload -> 'temporal_contract',
      'binding_status',case when contract_validation_pending
        then 'eligibility_recovered_validation_pending' else 'recovered' end
    ),updated_at=clock_timestamp()
  where draft_alias.id=draft.id and draft_alias.content_version=draft.content_version
    and draft_alias.content_fingerprint=draft.content_fingerprint;
  select * into draft from private.market_drafts draft_alias
  where draft_alias.id=draft_id_input for update;
  binding:=public.bind_market_radar_draft_eligibility_v2(
    candidate.id,draft.id,draft.content_version,draft.content_fingerprint,
    candidate.preparation_revision,eligibility.id,actor_id_input,attempt_id_input
  );

  for issue_state in
    select distinct occurrence.issue_id,occurrence.issue_code,occurrence.current_value,
      coalesce(latest.new_status,occurrence.status) as current_status
    from private.market_workflow_issue_occurrences_v1 occurrence
    join private.market_workflow_issue_subject_links_v1 link on link.issue_id=occurrence.issue_id
    left join lateral (
      select event.new_status from private.market_workflow_issue_events_v1 event
      where event.issue_id=occurrence.issue_id
      order by event.occurred_at desc,event.id desc limit 1
    ) latest on true
    where link.subject_type='market_draft' and link.subject_key=draft.id::text
      and link.subject_version=draft.content_version::text
      and coalesce(latest.new_status,occurrence.status) not in ('resolved','superseded')
      and (
        occurrence.issue_code in (
          'RADAR_ELIGIBILITY_REQUIRED','ELIGIBILITY_EXPIRED','PROVIDER_NOT_OPEN',
          'PROVIDER_OPTION_INACTIVE','PROVIDER_EVENT_NOT_FOUND','PROVIDER_CHILD_NOT_FOUND',
          'OFFICIAL_TERMINAL_SCAN_UNAVAILABLE','OFFICIAL_SELECTION_RECHECK_REQUIRED',
          'VERIFICATION_REQUIRED','VERIFICATION_EXPIRED','GAMING_DOMAIN_REVIEW_REQUIRED',
          'RADAR_PARENT_RECONCILIATION_INCOMPLETE',
          'PROVIDER_CHILD_IDENTITY_RESOLUTION_REQUIRED','PROVIDER_PARENT_COUNT_INCONSISTENT',
          'RADAR_CANDIDATE_IDENTITY_STALE','RADAR_CONFIRMED_DUPLICATE'
        )
        or (source_exact and occurrence.issue_code in (
          'SOURCE_STALE','INVALID_OR_UNVERIFIED_SOURCE',
          'RESOLUTION_SOURCE_AUTHORITY_PENDING'
        ))
        or (temporal_exact and occurrence.issue_code like 'TEMPORAL\_%' escape '\')
        or (material_repair_proven and occurrence.issue_code in (
          'CHILD_IDENTITY_MISMATCH','PROVIDER_CHILD_CONTRACT_CHANGED',
          'CANONICAL_CHILD_PROJECTION_INVALID'
        ))
      )
  loop
    if issue_state.issue_code='PROVIDER_CHILD_CONTRACT_CHANGED' then
      contract_temporal_change:=exists (
        select 1 from unnest(array['source_close_at','source_resolution_deadline'])
          as fields(field_name)
        where issue_state.current_value #>> array['provider_child','prior_provider_contract',field_name]
          is distinct from issue_state.current_value #>> array['provider_child','provider_contract',field_name]
      );
      contract_source_change:=exists (
        select 1 from unnest(array[
          'source_question','source_description','source_resolution_rules',
          'source_resolution_url'
        ]) as fields(field_name)
        where issue_state.current_value #>> array['provider_child','prior_provider_contract',field_name]
          is distinct from issue_state.current_value #>> array['provider_child','provider_contract',field_name]
      );
      if (contract_temporal_change and not temporal_exact)
         or (contract_source_change and not source_exact) then
        continue;
      end if;
    end if;
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(issue_state.issue_id::text,0)
    );
    latest_status_value:=null;
    latest_owner_value:=null;
    latest_action_value:=null;
    select event.new_status,event.owner_stage,event.next_action
      into latest_status_value,latest_owner_value,latest_action_value
    from private.market_workflow_issue_events_v1 event
    where event.issue_id=issue_state.issue_id
    order by event.occurred_at desc,event.id desc limit 1;
    if issue_state.issue_code='PROVIDER_CHILD_CONTRACT_CHANGED' then
      if coalesce(latest_status_value,issue_state.current_status) not in ('resolved','superseded')
         and not (coalesce(latest_status_value,issue_state.current_status)='waiting'
           and latest_owner_value='validator'
           and latest_action_value='request_market_validation') then
        insert into private.market_workflow_issue_events_v1(
          issue_id,event_type,previous_status,new_status,actor_id,owner_stage,next_action,
          resolution_method,evidence_refs,occurred_at
        ) values (
          issue_state.issue_id,'waiting',
          coalesce(latest_status_value,issue_state.current_status),'waiting',
          actor_id_input,'validator','request_market_validation',null,
          jsonb_build_array(jsonb_build_object(
            'draft_id',draft.id,'draft_version',draft.content_version,
            'eligibility_check_id',eligibility.id,
            'material_repair_checkpoint',material_repair_proven
          )),clock_timestamp()
        );
      end if;
      continue;
    end if;
    if coalesce(latest_status_value,issue_state.current_status) not in ('resolved','superseded') then
      insert into private.market_workflow_issue_events_v1(
        issue_id,event_type,previous_status,new_status,actor_id,owner_stage,next_action,
        resolution_method,evidence_refs,occurred_at
      ) values (
        issue_state.issue_id,'resolved',coalesce(latest_status_value,issue_state.current_status),
        'resolved',actor_id_input,'validator','request_market_validation',
        'eligibility_recovered_exact_contract',jsonb_build_array(jsonb_build_object(
          'draft_id',draft.id,'draft_version',draft.content_version,
          'eligibility_check_id',eligibility.id,'source_exact',source_exact,
          'temporal_exact',temporal_exact
        )),clock_timestamp()
      );
    end if;
  end loop;
  draft:=private.project_market_draft_workflow_state_v2(draft.id,draft.content_version);
  return binding||jsonb_build_object(
    'ok',true,'draft_id',draft.id,'candidate_id',candidate.id,
    'eligibility_check_id',eligibility.id,'artifact_status',draft.artifact_status,
    'owner_stage',draft.workflow_owner_stage,'next_action',draft.workflow_next_action,
    'workflow_issue_count',draft.workflow_issue_count,
    'source_contract_exact',source_exact,'temporal_contract_exact',temporal_exact,
    'material_repair_checkpoint',material_repair_proven,
    'contract_validation_pending',contract_validation_pending
  );
end;
$function$;
alter function public.recover_market_draft_radar_eligibility_v1(
  uuid,bigint,text,uuid,uuid,uuid
) owner to postgres;
revoke all on function public.recover_market_draft_radar_eligibility_v1(
  uuid,bigint,text,uuid,uuid,uuid
) from public,anon,authenticated,service_role;
grant execute on function public.recover_market_draft_radar_eligibility_v1(
  uuid,bigint,text,uuid,uuid,uuid
) to service_role;

alter table private.market_radar_parent_reconciliations_v1 owner to postgres;
alter table private.market_radar_parent_children_v1 owner to postgres;
alter sequence private.market_radar_parent_children_v1_id_seq owner to postgres;
alter function private.reject_market_radar_reconciliation_mutation_v1() owner to postgres;
alter function private.enforce_market_candidate_reconciliation_projection_v1() owner to postgres;
alter function private.market_family_option_slug_v2(text,integer) owner to postgres;
alter function private.assert_market_candidate_draft_identity_v1(uuid,jsonb) owner to postgres;
alter function private.assign_market_draft_family_v4() owner to postgres;
alter function private.assign_public_market_family_v4() owner to postgres;
alter function private.market_radar_candidate_reconciliation_bound_v1(private.external_market_candidates)
  owner to postgres;
alter function private.market_radar_candidate_reconciliation_ready_v1(private.external_market_candidates)
  owner to postgres;
alter function private.assert_market_radar_candidate_eligible_v1(uuid,bigint) owner to postgres;

comment on table private.market_radar_parent_reconciliations_v1 is
  'Snapshots append-only que demuestran completitud, paginacion e identidad de cada padre del proveedor.';
comment on table private.market_radar_parent_children_v1 is
  'Ledger append-only de cada hija observada o legacy contabilizada, con identidad y disponibilidad separadas.';
comment on function public.record_market_radar_parent_reconciliations_v1(uuid,text,text,uuid,jsonb) is
  'Writer service-only ligado a request y lease; recalcula recuentos y registra la incidencia padre en el issue ledger.';
comment on function public.list_market_radar_candidates_v4(text,text,text,text,text,text,integer,integer) is
  'Proyeccion administrativa fail-closed: solo padres completos v3, sin cortar familias antes de paginar.';
comment on function public.list_market_radar_rejections_v2(text,text,integer,integer) is
  'Rechazos reales v3; excluye placeholders e hijos de padres incompletos.';
comment on function public.complete_market_radar_candidate_refresh_v1(uuid,text,text,uuid,text,text,text,integer) is
  'Promueve todos los lotes candidatos y finaliza la intención en una sola transacción visible.';
comment on function public.apply_market_radar_prepare_eligibility_v4(uuid,bigint,text,timestamptz,jsonb,jsonb,jsonb,boolean) is
  'Revalida V3 con identidad exacta y conserva, en scope cerrado, borradores V2 ya preparados sin migrar su identidad.';

do $postflight$
declare
  table_name_value text;
  function_oid regprocedure;
  legacy_writers regprocedure[]:=array[
    'public.process_market_radar_refresh_batch_v1(uuid,text,text,uuid)'::regprocedure,
    'public.process_market_radar_refresh_batch_v2(uuid,text,text,uuid)'::regprocedure,
    'public.finalize_market_radar_refresh_v3(uuid,text,text,uuid,text,text,text,integer)'::regprocedure,
    'public.finalize_market_radar_refresh_v4(uuid,text,text,uuid,text,text,text,integer)'::regprocedure,
    'public.begin_market_draft_review_v2(uuid,bigint,uuid,text,text,text,boolean)'::regprocedure,
    'public.get_market_radar_candidate_for_draft_revalidation_v2(uuid,uuid,bigint,text)'::regprocedure,
    'public.confirm_market_draft_review_v2(uuid,bigint)'::regprocedure,
    'public.apply_market_radar_prepare_eligibility_v1(uuid,bigint,text,timestamptz,jsonb,jsonb,boolean)'::regprocedure,
    'public.apply_market_radar_prepare_eligibility_v2(uuid,bigint,text,timestamptz,jsonb,jsonb,boolean)'::regprocedure,
    'public.apply_market_radar_prepare_eligibility_v3(uuid,bigint,text,timestamptz,jsonb,jsonb,jsonb,boolean)'::regprocedure,
    'public.upsert_market_radar_batch(text,text,text,jsonb,jsonb)'::regprocedure,
    'public.upsert_market_radar_batch_v2(text,text,text,jsonb,jsonb)'::regprocedure,
    'public.upsert_market_radar_batch_with_fact_checks_v1(text,text,text,jsonb,jsonb,text,jsonb)'::regprocedure,
    'public.upsert_market_radar_batch_with_fact_checks_v2(text,text,text,jsonb,jsonb,text,jsonb)'::regprocedure,
    'public.upsert_market_radar_batch_with_eligibility_v1(text,text,text,jsonb,jsonb,text,jsonb)'::regprocedure,
    'public.apply_market_radar_prepare_verification(uuid,bigint,text,timestamptz,jsonb)'::regprocedure,
    'public.apply_market_radar_prepare_fact_verification_v1(uuid,bigint,text,timestamptz,jsonb,jsonb)'::regprocedure,
    'public.apply_market_radar_revalidation_fact_v1(uuid,bigint,text,timestamptz,jsonb,jsonb)'::regprocedure,
    'public.record_market_radar_fact_checks(jsonb)'::regprocedure
    ,'public.save_market_draft_from_radar_intelligence_without_revision_guard(uuid,uuid,bigint,jsonb,uuid,jsonb,jsonb)'::regprocedure
    ,'public.save_market_draft_from_expert_with_issues_pre_parent_v1(uuid,uuid,jsonb)'::regprocedure
  ];
  authenticated_only regprocedure[]:=array[
    'public.list_market_radar_candidates_v4(text,text,text,text,text,text,integer,integer)'::regprocedure,
    'public.list_market_radar_candidates_v3(text,text,text,text,text,text,integer,integer)'::regprocedure,
    'public.list_market_radar_candidates_v2(text,text,text,text,text,text,integer,integer)'::regprocedure,
    'public.list_market_radar_rejections_v2(text,text,integer,integer)'::regprocedure,
    'public.list_market_radar_rejections(text,text,integer,integer)'::regprocedure,
    'public.list_market_radar_parent_reconciliations_v1(text,text,text,integer,integer)'::regprocedure,
    'public.list_market_radar_parent_reconciliations_v2(text,text,text,text,integer,integer)'::regprocedure,
    'public.get_market_radar_parent_reconciliation_v1(uuid)'::regprocedure,
    'public.get_market_radar_candidate(uuid)'::regprocedure,
    'public.save_market_draft_from_expert_with_issues_v1(uuid,uuid,jsonb)'::regprocedure,
    'public.save_market_draft_from_expert_with_issues_v2(uuid,uuid,jsonb)'::regprocedure
    ,'public.save_market_draft_from_radar(uuid,uuid,bigint,jsonb)'::regprocedure
    ,'public.save_market_draft_from_radar_intelligence(uuid,uuid,bigint,jsonb,uuid,jsonb,jsonb)'::regprocedure
    ,'public.apply_market_draft_expert_repair_with_checkpoint_v1(uuid,bigint,jsonb,jsonb,jsonb,uuid,jsonb,uuid,smallint,uuid,uuid,jsonb)'::regprocedure
    ,'public.begin_market_draft_repair_workflow_v1(uuid,bigint,uuid)'::regprocedure
    ,'public.checkpoint_market_draft_repair_noop_v1(uuid,uuid,bigint,smallint,uuid,uuid,jsonb)'::regprocedure
    ,'public.publish_market_draft_v2(uuid,bigint,timestamptz,uuid)'::regprocedure
    ,'public.begin_market_draft_review_v3(uuid,bigint,uuid,text,text,text,boolean)'::regprocedure
    ,'public.confirm_market_draft_review_v3(uuid,bigint)'::regprocedure
  ];
  service_only regprocedure[]:=array[
    'public.record_market_radar_parent_reconciliations_v1(uuid,text,text,uuid,jsonb)'::regprocedure,
    'public.get_market_radar_parent_children_for_reconciliation_v1(text,text[])'::regprocedure,
    'public.get_market_radar_children_for_reconciliation_v3(text,text[],text[],text[],text[],text[],text[],uuid)'::regprocedure,
    'public.get_market_radar_protected_candidate_identities_v1(text)'::regprocedure,
    'public.get_market_radar_candidate_for_revalidation_v1(uuid)'::regprocedure,
    'public.get_market_radar_candidate_for_draft_revalidation_v3(uuid,uuid,bigint,text)'::regprocedure,
    'public.record_market_radar_provider_selection_v1(uuid,text,text,uuid,jsonb)'::regprocedure,
    'public.declare_market_radar_refresh_manifest_v1(uuid,text,text,uuid,integer)'::regprocedure,
    'public.seal_market_radar_refresh_v1(uuid,text,text,uuid,integer)'::regprocedure,
    'public.finalize_market_radar_refresh_v5(uuid,text,text,uuid,text,text,text,integer)'::regprocedure,
    'public.complete_market_radar_candidate_refresh_v1(uuid,text,text,uuid,text,text,text,integer)'::regprocedure,
    'public.apply_market_radar_prepare_eligibility_v4(uuid,bigint,text,timestamptz,jsonb,jsonb,jsonb,boolean)'::regprocedure,
    'public.get_market_radar_eligibility_attempt_checkpoint_v1(uuid,uuid)'::regprocedure,
    'public.bind_market_radar_draft_eligibility_v2(uuid,uuid,bigint,text,bigint,bigint,uuid,uuid)'::regprocedure,
    'public.recover_market_draft_radar_eligibility_v1(uuid,bigint,text,uuid,uuid,uuid)'::regprocedure,
    'public.complete_market_draft_repair_workflow_v1(uuid,text,text,text,boolean,text,text,bigint,text,jsonb,uuid,text,text,text,text,text)'::regprocedure,
    'public.reconcile_market_draft_repair_workflow_v1(uuid)'::regprocedure,
    'public.publish_due_market_drafts_v2(integer)'::regprocedure
  ];
begin
  foreach table_name_value in array array[
    'market_radar_parent_reconciliations_v1','market_radar_parent_children_v1'
  ] loop
    if not exists (
      select 1 from pg_catalog.pg_class relation
      join pg_catalog.pg_namespace namespace on namespace.oid=relation.relnamespace
      where namespace.nspname='private' and relation.relname=table_name_value
        and relation.relowner='postgres'::regrole
        and relation.relrowsecurity and relation.relforcerowsecurity
    ) then raise exception 'RADAR_PARENT_RECONCILIATION_RLS_INVALID:%',table_name_value; end if;
    if exists (
      select 1 from information_schema.role_table_grants grant_row
      where grant_row.table_schema='private' and grant_row.table_name=table_name_value
        and grant_row.grantee in ('PUBLIC','anon','authenticated','service_role')
    ) then raise exception 'RADAR_PARENT_RECONCILIATION_ACL_INVALID:%',table_name_value; end if;
  end loop;
  if exists(select 1 from private.market_radar_parent_reconciliations_v1)
     or exists(select 1 from private.market_radar_parent_children_v1)
     or exists(select 1 from private.external_market_candidates
       where current_parent_reconciliation_id is not null or current_parent_child_id is not null) then
    raise exception 'RADAR_PARENT_RECONCILIATION_UNAUTHORIZED_BACKFILL';
  end if;
  if to_regclass('private.market_drafts_active_radar_origin_v1_uidx') is null then
    raise exception 'RADAR_ACTIVE_DRAFT_ORIGIN_INDEX_MISSING';
  end if;
  if to_regclass('private.market_radar_parent_reconciliation_current_v1_idx') is null
     or to_regclass('private.market_radar_parent_reconciliation_status_v1_idx') is null
     or to_regclass('private.market_radar_parent_child_external_v1_idx') is null
     or to_regclass('private.market_radar_parent_child_identity_v1_idx') is null
     or to_regclass('private.external_market_candidates_parent_reconciliation_v1_idx') is null
     or to_regclass('private.external_market_candidates_parent_child_v1_idx') is null
     or to_regclass('private.market_drafts_cross_version_identity_v1_uidx') is null
     or to_regclass('public.markets_cross_version_identity_v1_uidx') is null then
    raise exception 'RADAR_PARENT_RECONCILIATION_INDEX_MISSING';
  end if;
  if (select count(*) from pg_catalog.pg_trigger trigger_row
      where not trigger_row.tgisinternal and trigger_row.tgname in (
        'capture_market_repair_checkpoint_radar_binding_v1',
        'market_radar_parent_reconciliation_append_only_v1',
        'market_radar_parent_children_append_only_v1',
        'zz_guard_market_draft_cross_version_identity_v1',
        'zz_guard_public_market_cross_version_identity_v1'
      ))<>5 then
    raise exception 'RADAR_PARENT_RECONCILIATION_TRIGGER_MISSING';
  end if;
  if (select count(*) from information_schema.columns column_row
      where column_row.table_schema='private'
        and column_row.table_name='market_repair_workflow_checkpoints_v1'
        and column_row.column_name in (
          'radar_candidate_id','radar_candidate_fingerprint',
          'radar_candidate_preparation_revision','provider_child_contract_hash',
          'parent_child_fingerprint','temporal_decision_hash','domain_fingerprint',
          'family_version','family_key','family_child_key'
        ))<>10 then
    raise exception 'RADAR_REPAIR_CHECKPOINT_COLUMNS_MISSING';
  end if;
  if (select count(*) from pg_catalog.pg_constraint constraint_row
      where constraint_row.conname in (
        'market_radar_parent_reconciliation_counts_v1',
        'market_radar_parent_reconciliation_complete_v1',
        'market_radar_parent_child_identity_v1',
        'market_radar_parent_child_classification_v1',
        'market_radar_parent_child_presence_v1'
      ))<>5 then
    raise exception 'RADAR_PARENT_RECONCILIATION_CONSTRAINT_MISSING';
  end if;
  foreach function_oid in array legacy_writers loop
    if has_function_privilege('service_role',function_oid,'EXECUTE')
       or has_function_privilege('anon',function_oid,'EXECUTE')
       or has_function_privilege('authenticated',function_oid,'EXECUTE') then
      raise exception 'RADAR_PARENT_RECONCILIATION_LEGACY_WRITER_EXPOSED:%',function_oid;
    end if;
  end loop;
  foreach function_oid in array authenticated_only loop
    if not has_function_privilege('authenticated',function_oid,'EXECUTE')
       or has_function_privilege('anon',function_oid,'EXECUTE')
       or has_function_privilege('service_role',function_oid,'EXECUTE') then
      raise exception 'RADAR_PARENT_RECONCILIATION_READ_ACL_INVALID:%',function_oid;
    end if;
  end loop;
  foreach function_oid in array service_only loop
    if not has_function_privilege('service_role',function_oid,'EXECUTE')
       or has_function_privilege('anon',function_oid,'EXECUTE')
       or has_function_privilege('authenticated',function_oid,'EXECUTE') then
      raise exception 'RADAR_PARENT_RECONCILIATION_WRITE_ACL_INVALID:%',function_oid;
    end if;
  end loop;
  if exists (
    select 1 from pg_catalog.pg_proc procedure
    join pg_catalog.pg_namespace namespace on namespace.oid=procedure.pronamespace
    where namespace.nspname in ('public','private')
      and procedure.proname in (
        'record_market_radar_parent_reconciliations_v1',
        'record_market_radar_provider_selection_v1',
        'get_market_radar_parent_children_for_reconciliation_v1',
        'get_market_radar_children_for_reconciliation_v3',
        'get_market_radar_protected_candidate_identities_v1',
        'process_market_radar_refresh_batch_v2','finalize_market_radar_refresh_v4',
        'finalize_market_radar_refresh_v5',
        'complete_market_radar_candidate_refresh_v1',
        'market_radar_candidate_reconciliation_bound_v1',
        'market_radar_candidate_reconciliation_ready_v1',
        'rebind_market_radar_protected_candidates_v1',
        'market_candidate_preparation_projection',
        'market_radar_candidate_has_live_duplicate_v1',
        'market_radar_candidate_live_duplicates_v1',
        'persist_market_radar_live_duplicate_v1',
        'clear_market_radar_live_duplicate_v1',
        'sync_market_radar_revalidation_issues_v1',
        'market_radar_candidate_cross_version_identity_v1',
        'market_family_option_slug_v2',
        'market_family_text_contains_label_v2',
        'assert_market_radar_candidate_no_live_duplicate_v1',
        'market_workflow_issue_array_replace_v1',
        'market_workflow_issue_deterministic_v1',
        'market_family_origin_projection_v1',
        'assert_market_candidate_draft_identity_v1',
        'persist_market_radar_draft_origin_binding_v1',
        'bind_market_radar_draft_eligibility_internal_v1',
        'market_radar_material_repair_checkpoint_valid_v1',
        'lock_market_draft_workflow_scope_v1','try_lock_market_draft_workflow_scope_v1',
        'assign_market_draft_family_v4','assign_public_market_family_v4',
        'list_market_radar_candidates_v4','list_market_radar_candidates_v3',
        'list_market_radar_candidates_v2',
        'list_market_radar_rejections_v2','list_market_radar_rejections',
        'list_market_radar_parent_reconciliations_v1',
        'list_market_radar_parent_reconciliations_v2',
        'get_market_radar_parent_reconciliation_v1',
        'get_market_radar_candidate','get_market_radar_candidate_for_revalidation_v1',
        'get_market_intelligence_origin','get_market_intelligence_origin_pre_parent_reconciliation_v1',
        'declare_market_radar_refresh_manifest_v1','seal_market_radar_refresh_v1',
        'apply_market_radar_prepare_eligibility_v2','apply_market_radar_prepare_eligibility_v3',
        'apply_market_radar_prepare_eligibility_v4',
        'begin_market_draft_review_v2','begin_market_draft_review_v3',
        'get_market_radar_candidate_for_draft_revalidation_v2',
        'get_market_radar_candidate_for_draft_revalidation_v3',
        'confirm_market_draft_review_v2','confirm_market_draft_review_v3',
        'save_market_draft_from_radar','save_market_draft_from_radar_intelligence',
        'save_market_draft_from_radar_intelligence_without_revision_guard',
        'bind_market_radar_draft_eligibility_v2',
        'get_market_radar_eligibility_attempt_checkpoint_v1',
        'recover_market_draft_radar_eligibility_v1',
        'apply_market_draft_expert_repair_with_checkpoint_v1',
        'begin_market_draft_repair_workflow_v1','checkpoint_market_draft_repair_noop_v1',
        'complete_market_draft_repair_workflow_v1','reconcile_market_draft_repair_workflow_v1',
        'publish_market_draft_v2','publish_due_market_drafts_v2',
        'publication_issue_v1','publication_issue_pre_parent_reconciliation_v1',
        'assert_market_radar_draft_eligibility_v1',
        'assert_market_radar_draft_eligibility_pre_parent_reconciliation_v1',
        'save_market_draft_from_expert_with_issues_v1','save_market_draft_from_expert_with_issues_v2',
        'save_market_draft_from_expert_with_issues_pre_parent_v1'
      ) and (
        procedure.proowner<>'postgres'::regrole
        or coalesce(array_to_string(procedure.proconfig,','),'') not like '%search_path=%'
      )
  ) then raise exception 'RADAR_PARENT_RECONCILIATION_FUNCTION_HARDENING_INVALID'; end if;
end;
$postflight$;

commit;
