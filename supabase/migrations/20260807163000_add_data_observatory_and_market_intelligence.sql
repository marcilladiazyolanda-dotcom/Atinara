-- Paso 13.5.2 · Observatorio de datos, Agente Editor y Centinela de fuentes.
-- Integración aditiva sobre Radar v17. No altera mercados, predicciones ni economía.
-- La migración se prepara localmente; no activa Cron, proveedores ni monitorización.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '90s';

create schema if not exists private;
create extension if not exists pgcrypto with schema extensions;
revoke all on schema private from public, anon, authenticated;

alter table private.market_drafts
  add column if not exists intelligence_origin_type text,
  add column if not exists intelligence_origin_id text,
  add column if not exists expert_run_id uuid;

create table if not exists private.data_observatory_entities (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('igdb', 'twitch', 'youtube')),
  entity_type text not null,
  external_id text not null,
  canonical_url text not null,
  label text not null,
  active boolean not null default true,
  configuration jsonb not null default '{}'::jsonb check (jsonb_typeof(configuration) = 'object'),
  health_status text not null default 'unknown' check (health_status in ('unknown', 'healthy', 'degraded', 'unavailable', 'rate_limited', 'retired')),
  last_checked_at timestamptz,
  next_context_scan_at timestamptz,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, entity_type, external_id)
);

create table if not exists private.data_observatory_signals (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('igdb', 'twitch', 'youtube')),
  signal_type text not null,
  entity_type text not null,
  entity_id text not null,
  parent_entity_id text,
  canonical_url text,
  title text not null,
  subtitle text,
  description text,
  atinara_category text,
  observed_at timestamptz not null,
  source_updated_at timestamptz,
  valid_until timestamptz,
  signal_origin text not null default 'provider_api',
  opportunity_type text,
  context_type text,
  story_arc_id uuid,
  catalyst_type text,
  factual_basis text,
  contextual_basis text,
  inference_summary text,
  market_thesis text,
  why_now text,
  unresolved_question text,
  suggested_market_type text,
  hypothesis_status text not null default 'not_generated' check (hypothesis_status in ('not_generated', 'pending_context', 'generated', 'shortlisted', 'rejected', 'superseded')),
  metric_name text,
  metric_value numeric,
  metric_unit text,
  metric_precision text,
  metric_is_rounded boolean not null default false,
  previous_value numeric,
  change_value numeric,
  time_window_start timestamptz,
  time_window_end timestamptz,
  source_payload_excerpt jsonb not null default '{}'::jsonb check (jsonb_typeof(source_payload_excerpt) = 'object'),
  source_fingerprint text not null,
  marketability_status text not null default 'pending' check (marketability_status in ('pending', 'useful', 'needs_review', 'insufficient_history', 'not_interesting', 'already_resolved', 'incoherent', 'unsupported_metric', 'unverifiable', 'duplicate', 'policy_blocked', 'rejected')),
  marketability_reason_codes jsonb not null default '[]'::jsonb check (jsonb_typeof(marketability_reason_codes) = 'array'),
  resolution_readiness text check (resolution_readiness is null or resolution_readiness in ('ready_static', 'ready_snapshot_at_deadline', 'ready_monitored_window', 'needs_monitoring', 'manual_secondary_source', 'not_resolvable')),
  suggested_question text,
  suggested_yes_criteria text,
  suggested_no_criteria text,
  suggested_edge_cases text,
  suggested_resolution_contract jsonb not null default '{}'::jsonb check (jsonb_typeof(suggested_resolution_contract) = 'object'),
  duplicate_matches jsonb not null default '[]'::jsonb check (jsonb_typeof(duplicate_matches) = 'array'),
  provider_policy_flags jsonb not null default '[]'::jsonb check (jsonb_typeof(provider_policy_flags) = 'array'),
  retention_expires_at timestamptz,
  expert_analysis_status text not null default 'not_requested' check (expert_analysis_status in ('not_requested', 'pending', 'completed', 'failed', 'stale')),
  expert_run_id uuid,
  expert_decision text check (expert_decision is null or expert_decision in ('create', 'create_with_edits', 'reject', 'stale', 'merge_duplicate', 'escalate')),
  integrity_status text check (integrity_status is null or integrity_status in ('pass', 'needs_edit', 'fail')),
  forecastability_status text check (forecastability_status is null or forecastability_status in ('forecastable', 'valid_low_probability', 'valid_very_unlikely', 'already_determined', 'stale', 'unknown')),
  source_readiness text check (source_readiness is null or source_readiness in ('ready', 'ready_with_warnings', 'needs_official_source', 'needs_monitoring', 'not_resolvable')),
  expert_confidence integer check (expert_confidence is null or expert_confidence between 0 and 100),
  human_review_required boolean not null default true,
  expert_reason_codes jsonb not null default '[]'::jsonb check (jsonb_typeof(expert_reason_codes) = 'array'),
  analysis_fingerprint text,
  policy_version text,
  expert_schema_version text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, source_fingerprint)
);

create table if not exists private.data_observatory_context_items (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid references private.data_observatory_entities(id) on delete cascade,
  origin_type text,
  origin_id text,
  provider text not null,
  source_url text not null,
  source_role text not null check (source_role in ('DISCOVERY_SIGNAL', 'PROBABILITY_SIGNAL', 'CONTEXT_SOURCE', 'PRIMARY_RESOLUTION', 'FALLBACK_RESOLUTION', 'CORROBORATION', 'PROHIBITED_FOR_RESOLUTION')),
  source_type text not null,
  official_status text not null check (official_status in ('official', 'verified_identity', 'secondary', 'unverified')),
  title text not null,
  excerpt text,
  published_at timestamptz,
  observed_at timestamptz not null default now(),
  source_fingerprint text not null,
  retention_expires_at timestamptz,
  policy_flags jsonb not null default '[]'::jsonb check (jsonb_typeof(policy_flags) = 'array'),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (provider, source_fingerprint)
);

create table if not exists private.data_observatory_story_arcs (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references private.data_observatory_entities(id) on delete cascade,
  arc_type text not null,
  title text not null,
  status text not null default 'active' check (status in ('active', 'paused', 'resolved', 'superseded')),
  target_metric text,
  target_event text,
  target_value numeric,
  target_at timestamptz,
  factual_summary text not null,
  contextual_summary text,
  evidence_refs jsonb not null default '[]'::jsonb check (jsonb_typeof(evidence_refs) = 'array'),
  last_evaluated_at timestamptz,
  next_evaluation_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists private.market_opportunity_hypotheses (
  id uuid primary key default gen_random_uuid(),
  origin_type text not null check (origin_type in ('observatory_signal', 'context_story_arc')),
  origin_id text not null,
  story_arc_id uuid references private.data_observatory_story_arcs(id) on delete set null,
  opportunity_type text not null,
  hypothesis_status text not null default 'generated' check (hypothesis_status in ('pending_context', 'generated', 'shortlisted', 'rejected', 'superseded')),
  proposed_question text,
  why_now text,
  market_thesis text,
  factual_basis text,
  contextual_basis text,
  unresolved_question text,
  resolution_path jsonb not null default '{}'::jsonb check (jsonb_typeof(resolution_path) = 'object'),
  rejection_reason_codes jsonb not null default '[]'::jsonb check (jsonb_typeof(rejection_reason_codes) = 'array'),
  expert_run_id uuid,
  fingerprint text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (origin_type, origin_id, fingerprint)
);

create table if not exists private.data_provider_runs (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  action text not null,
  status text not null check (status in ('available', 'not_configured', 'cached', 'partial', 'failed', 'rate_limited', 'quota_exhausted')),
  result_count integer not null default 0 check (result_count >= 0),
  quota_state jsonb not null default '{}'::jsonb check (jsonb_typeof(quota_state) = 'object'),
  error_code text,
  is_cached boolean not null default false,
  trigger_type text not null default 'manual' check (trigger_type in ('manual', 'scheduled')),
  context_scan_id uuid,
  next_allowed_at timestamptz,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists private.market_source_registry (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  source_name text not null,
  canonical_domain text not null,
  external_entity_id text,
  allowed_roles jsonb not null default '[]'::jsonb check (jsonb_typeof(allowed_roles) = 'array'),
  authority_tier text not null check (authority_tier in ('primary', 'secondary', 'context', 'prohibited')),
  categories jsonb not null default '[]'::jsonb check (jsonb_typeof(categories) = 'array'),
  access_method text not null,
  health_status text not null default 'unknown' check (health_status in ('unknown', 'healthy', 'degraded', 'unavailable', 'rate_limited', 'changed_schema', 'conflicting', 'retired')),
  retention_policy jsonb not null default '{}'::jsonb check (jsonb_typeof(retention_policy) = 'object'),
  parser_version text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists private.market_intelligence_policy_versions (
  version text primary key,
  schema_version text not null,
  policy_hash text not null,
  status text not null check (status in ('draft', 'active', 'retired')),
  activated_at timestamptz,
  retired_at timestamptz,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now()
);

create table if not exists private.market_intelligence_runtime_settings (
  setting_key text primary key,
  enabled boolean not null default false,
  value_text text,
  updated_by uuid,
  updated_at timestamptz not null default now()
);

create table if not exists private.market_expert_runs (
  id uuid primary key default gen_random_uuid(),
  agent_type text not null default 'market_editor',
  origin_type text not null check (origin_type in ('radar_candidate', 'observatory_signal', 'context_story_arc')),
  origin_id text not null,
  provider text,
  origin_fingerprint text not null,
  analysis_fingerprint text not null,
  policy_version text not null,
  schema_version text not null,
  model_version text,
  status text not null check (status in ('pending', 'completed', 'failed', 'stale')),
  decision text check (decision is null or decision in ('create', 'create_with_edits', 'reject', 'stale', 'merge_duplicate', 'escalate')),
  integrity_status text check (integrity_status is null or integrity_status in ('pass', 'needs_edit', 'fail')),
  forecastability_status text check (forecastability_status is null or forecastability_status in ('forecastable', 'valid_low_probability', 'valid_very_unlikely', 'already_determined', 'stale', 'unknown')),
  source_readiness text check (source_readiness is null or source_readiness in ('ready', 'ready_with_warnings', 'needs_official_source', 'needs_monitoring', 'not_resolvable')),
  confidence integer check (confidence is null or confidence between 0 and 100),
  human_review_required boolean not null default true,
  result_json jsonb not null default '{}'::jsonb check (jsonb_typeof(result_json) = 'object'),
  tool_summary jsonb not null default '[]'::jsonb check (jsonb_typeof(tool_summary) = 'array'),
  analysis_mode text not null default 'validate' check (analysis_mode in ('validate', 'discover')),
  trigger_type text not null default 'manual' check (trigger_type in ('manual', 'scheduled')),
  context_scan_id uuid,
  error_code text,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (origin_type, origin_id, analysis_fingerprint, policy_version, schema_version)
);

do $constraints$
begin
  if not exists (select 1 from pg_constraint where conname = 'market_drafts_expert_run_id_fkey') then
    alter table private.market_drafts
      add constraint market_drafts_expert_run_id_fkey foreign key (expert_run_id)
      references private.market_expert_runs(id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'market_opportunity_hypotheses_expert_run_id_fkey') then
    alter table private.market_opportunity_hypotheses
      add constraint market_opportunity_hypotheses_expert_run_id_fkey foreign key (expert_run_id)
      references private.market_expert_runs(id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'data_observatory_signals_story_arc_id_fkey') then
    alter table private.data_observatory_signals
      add constraint data_observatory_signals_story_arc_id_fkey foreign key (story_arc_id)
      references private.data_observatory_story_arcs(id) on delete set null;
  end if;
end
$constraints$;

create table if not exists private.market_expert_feedback (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references private.market_expert_runs(id) on delete cascade,
  actor_id uuid not null,
  admin_action text not null,
  original_decision text,
  final_decision text,
  changed_fields jsonb not null default '[]'::jsonb check (jsonb_typeof(changed_fields) = 'array'),
  correction_reason text,
  promoted_to_precedent boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists private.market_expert_precedents (
  id uuid primary key default gen_random_uuid(),
  source_feedback_id uuid unique references private.market_expert_feedback(id) on delete set null,
  title text not null,
  category text,
  problem_type text not null,
  facts_json jsonb not null default '{}'::jsonb check (jsonb_typeof(facts_json) = 'object'),
  approved_decision text not null,
  explanation text not null,
  tags jsonb not null default '[]'::jsonb check (jsonb_typeof(tags) = 'array'),
  reason_codes jsonb not null default '[]'::jsonb check (jsonb_typeof(reason_codes) = 'array'),
  active boolean not null default true,
  policy_version text not null,
  approved_by uuid not null,
  created_at timestamptz not null default now()
);

create table if not exists private.market_source_bindings (
  id uuid primary key default gen_random_uuid(),
  draft_id uuid references private.market_drafts(id) on delete cascade,
  market_id text,
  origin_type text not null check (origin_type in ('radar_candidate', 'observatory_signal', 'context_story_arc')),
  origin_id text not null,
  expert_run_id uuid references private.market_expert_runs(id) on delete set null,
  plan_version integer not null default 1 check (plan_version > 0),
  contract_schema_version text not null,
  policy_version text not null,
  contract_hash text,
  resolution_contract jsonb not null check (jsonb_typeof(resolution_contract) = 'object'),
  status text not null default 'draft' check (status in ('draft', 'validating', 'validated', 'armed', 'monitoring', 'paused', 'waiting_for_finality', 'ready_to_resolve', 'source_conflict', 'failed', 'closed', 'superseded')),
  validation jsonb not null default '{}'::jsonb check (jsonb_typeof(validation) = 'object'),
  provider text not null,
  adapter_version text not null,
  monitor_required boolean not null default false,
  monitor_readiness text not null default 'not_required' check (monitor_readiness in ('not_required', 'required', 'validated', 'armed', 'monitoring', 'paused', 'failed')),
  locked_at timestamptz,
  locked_by uuid,
  supersedes_binding_id uuid references private.market_source_bindings(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint market_source_binding_target_check check ((draft_id is not null) or (market_id is not null)),
  unique (draft_id, plan_version),
  unique (market_id, plan_version)
);

create table if not exists private.market_source_binding_sources (
  id uuid primary key default gen_random_uuid(),
  binding_id uuid not null references private.market_source_bindings(id) on delete cascade,
  source_id uuid references private.market_source_registry(id) on delete restrict,
  source_url text not null,
  role text not null check (role in ('DISCOVERY_SIGNAL', 'PROBABILITY_SIGNAL', 'CONTEXT_SOURCE', 'PRIMARY_RESOLUTION', 'FALLBACK_RESOLUTION', 'CORROBORATION', 'PROHIBITED_FOR_RESOLUTION')),
  precedence integer not null check (precedence > 0),
  fallback_condition text,
  required boolean not null default false,
  created_at timestamptz not null default now(),
  unique (binding_id, precedence)
);

create table if not exists private.market_source_snapshots (
  id uuid primary key default gen_random_uuid(),
  binding_id uuid not null references private.market_source_bindings(id) on delete restrict,
  provider text not null,
  metric text,
  value jsonb,
  unit text,
  observed_at timestamptz not null,
  provider_timestamp timestamptz,
  quality text not null check (quality in ('complete', 'partial', 'missing', 'invalid')),
  response_excerpt jsonb not null default '{}'::jsonb check (jsonb_typeof(response_excerpt) = 'object'),
  payload_hash text not null,
  retention_expires_at timestamptz,
  error_code text,
  created_at timestamptz not null default now(),
  unique (binding_id, payload_hash, observed_at)
);

create table if not exists private.market_source_monitor_runs (
  id uuid primary key default gen_random_uuid(),
  binding_id uuid not null references private.market_source_bindings(id) on delete cascade,
  status text not null check (status in ('started', 'completed', 'partial', 'failed', 'rate_limited', 'changed_schema', 'conflicting')),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  error_code text,
  next_capture_at timestamptz,
  rate_limit_state jsonb not null default '{}'::jsonb check (jsonb_typeof(rate_limit_state) = 'object'),
  adapter_version text not null,
  created_at timestamptz not null default now()
);

create table if not exists private.market_resolution_evidence_packages (
  id uuid primary key default gen_random_uuid(),
  market_id text not null,
  binding_id uuid not null references private.market_source_bindings(id) on delete restrict,
  plan_version integer not null,
  contract_hash text not null,
  status text not null check (status in ('building', 'ready_to_resolve', 'insufficient', 'conflicting', 'superseded')),
  recommended_outcome text check (recommended_outcome is null or recommended_outcome in ('Sí', 'No', 'Anulado')),
  confidence integer check (confidence is null or confidence between 0 and 100),
  evidence_json jsonb not null default '{}'::jsonb check (jsonb_typeof(evidence_json) = 'object'),
  conflicts_json jsonb not null default '[]'::jsonb check (jsonb_typeof(conflicts_json) = 'array'),
  warnings_json jsonb not null default '[]'::jsonb check (jsonb_typeof(warnings_json) = 'array'),
  manual_review_required boolean not null default true,
  created_at timestamptz not null default now(),
  superseded_at timestamptz
);

-- Índices para las consultas administrativas, capturas y tareas vencidas.
create index if not exists data_observatory_entities_provider_active_idx on private.data_observatory_entities (provider, active, updated_at desc);
create index if not exists data_observatory_entities_next_scan_idx on private.data_observatory_entities (next_context_scan_at) where active;
create index if not exists data_observatory_signals_provider_observed_idx on private.data_observatory_signals (provider, observed_at desc);
create index if not exists data_observatory_signals_entity_observed_idx on private.data_observatory_signals (entity_type, entity_id, observed_at desc);
create index if not exists data_observatory_signals_status_idx on private.data_observatory_signals (marketability_status, expert_analysis_status, observed_at desc);
create index if not exists data_observatory_context_entity_idx on private.data_observatory_context_items (entity_id, observed_at desc);
create index if not exists data_observatory_context_retention_idx on private.data_observatory_context_items (retention_expires_at) where retention_expires_at is not null;
create index if not exists data_observatory_story_entity_idx on private.data_observatory_story_arcs (entity_id, status, updated_at desc);
create index if not exists data_observatory_story_next_idx on private.data_observatory_story_arcs (next_evaluation_at) where status = 'active';
create index if not exists market_hypotheses_origin_idx on private.market_opportunity_hypotheses (origin_type, origin_id, updated_at desc);
create index if not exists data_provider_runs_provider_idx on private.data_provider_runs (provider, created_at desc);
create index if not exists market_expert_runs_origin_idx on private.market_expert_runs (origin_type, origin_id, created_at desc);
create index if not exists market_expert_precedents_lookup_idx on private.market_expert_precedents (category, problem_type, active);
create unique index if not exists market_source_registry_identity_uidx on private.market_source_registry (provider, canonical_domain, coalesce(external_entity_id, ''));
create index if not exists market_source_bindings_status_idx on private.market_source_bindings (status, updated_at desc);
create index if not exists market_source_bindings_market_idx on private.market_source_bindings (market_id, plan_version desc) where market_id is not null;
create index if not exists market_source_binding_sources_binding_idx on private.market_source_binding_sources (binding_id, precedence);
create index if not exists market_source_snapshots_binding_idx on private.market_source_snapshots (binding_id, observed_at desc);
create index if not exists market_monitor_runs_binding_idx on private.market_source_monitor_runs (binding_id, started_at desc);
create index if not exists market_monitor_runs_next_idx on private.market_source_monitor_runs (next_capture_at) where next_capture_at is not null;
create index if not exists market_evidence_market_idx on private.market_resolution_evidence_packages (market_id, created_at desc);

do $do$
declare table_name text;
begin
  foreach table_name in array array[
    'data_observatory_entities', 'data_observatory_signals', 'data_observatory_context_items',
    'data_observatory_story_arcs', 'market_opportunity_hypotheses', 'data_provider_runs',
    'market_source_registry', 'market_intelligence_policy_versions', 'market_intelligence_runtime_settings',
    'market_expert_runs', 'market_expert_feedback', 'market_expert_precedents',
    'market_source_bindings', 'market_source_binding_sources', 'market_source_snapshots',
    'market_source_monitor_runs', 'market_resolution_evidence_packages'
  ] loop
    execute format('alter table private.%I enable row level security', table_name);
    execute format('alter table private.%I force row level security', table_name);
    execute format('revoke all on table private.%I from public, anon, authenticated', table_name);
    execute format('grant all on table private.%I to postgres', table_name);
  end loop;
end;
$do$;

grant select, insert, update on table
  private.data_observatory_entities, private.data_observatory_signals,
  private.data_observatory_context_items, private.data_observatory_story_arcs,
  private.market_opportunity_hypotheses, private.data_provider_runs,
  private.market_source_registry, private.market_expert_runs,
  private.market_source_monitor_runs, private.market_resolution_evidence_packages,
  private.market_source_bindings, private.market_source_binding_sources
to service_role;
grant select, insert on table private.market_source_snapshots to service_role;
grant select on table private.market_intelligence_policy_versions, private.market_intelligence_runtime_settings, private.market_expert_precedents to service_role;
grant insert on table private.market_expert_feedback to service_role;

insert into private.market_intelligence_policy_versions (version, schema_version, policy_hash, status, activated_at, metadata)
values (
  'atinara-market-constitution-v1',
  'atinara-market-expert-v1',
  encode(extensions.digest(convert_to('atinara-market-constitution-v1:12-rules', 'UTF8'), 'sha256'), 'hex'),
  'active', now(),
  jsonb_build_object('context_schema_version', 'atinara-context-discovery-v1', 'contract_schema_version', 'atinara-resolution-contract-v1')
)
on conflict (version) do nothing;

insert into private.market_intelligence_runtime_settings (setting_key, enabled, value_text)
values
  ('source_monitor_scheduler_enabled', false, '*/5 * * * *'),
  ('context_discovery_scheduler_enabled', false, '0 */6 * * *'),
  ('provider_igdb_configured', false, null),
  ('provider_twitch_configured', false, null),
  ('provider_youtube_configured', false, null)
on conflict (setting_key) do nothing;

create or replace function private.market_intelligence_hash(value_input jsonb)
returns text language sql immutable set search_path = ''
as $function$
  select encode(extensions.digest(convert_to(coalesce(value_input, '{}'::jsonb)::text, 'UTF8'), 'sha256'), 'hex');
$function$;
revoke all on function private.market_intelligence_hash(jsonb) from public, anon, authenticated, service_role;

create or replace function private.prevent_market_source_snapshot_mutation()
returns trigger language plpgsql set search_path = ''
as $function$
begin
  if current_setting('atinara.retention_purge', true) = 'on' and tg_op = 'DELETE' then
    return old;
  end if;
  raise exception 'SOURCE_SNAPSHOT_IMMUTABLE' using errcode = '55000';
end;
$function$;

drop trigger if exists market_source_snapshots_immutable on private.market_source_snapshots;
create trigger market_source_snapshots_immutable before update or delete on private.market_source_snapshots
for each row execute function private.prevent_market_source_snapshot_mutation();

create or replace function private.prevent_locked_binding_mutation()
returns trigger language plpgsql set search_path = ''
as $function$
begin
  if old.locked_at is not null and (
    new.resolution_contract is distinct from old.resolution_contract
    or new.contract_hash is distinct from old.contract_hash
    or new.plan_version is distinct from old.plan_version
    or new.policy_version is distinct from old.policy_version
    or new.contract_schema_version is distinct from old.contract_schema_version
  ) then raise exception 'RESOLUTION_PLAN_LOCKED' using errcode = '55000'; end if;
  return new;
end;
$function$;

drop trigger if exists market_source_bindings_locked on private.market_source_bindings;
create trigger market_source_bindings_locked before update on private.market_source_bindings
for each row execute function private.prevent_locked_binding_mutation();

create or replace function private.assert_market_source_publication_ready(draft_id_input uuid)
returns void language plpgsql security definer set search_path = ''
as $function$
declare draft_row private.market_drafts%rowtype; binding_row private.market_source_bindings%rowtype;
begin
  select * into draft_row from private.market_drafts where id = draft_id_input;
  if not found then raise exception 'DRAFT_NOT_FOUND' using errcode = 'P0001'; end if;
  select * into binding_row from private.market_source_bindings where draft_id = draft_id_input and status <> 'superseded' order by plan_version desc limit 1;
  if draft_row.intelligence_origin_type is null and not found then return; end if;
  if not found then raise exception 'SOURCE_BINDING_REQUIRED' using errcode = '22023'; end if;
  if binding_row.contract_hash is null or binding_row.locked_at is null then raise exception 'RESOLUTION_PLAN_NOT_LOCKED' using errcode = '22023'; end if;
  if binding_row.status not in ('validated', 'armed') then raise exception 'SOURCE_CONTRACT_NOT_LOCKED' using errcode = '22023'; end if;
  if binding_row.monitor_required and (binding_row.status <> 'armed' or binding_row.monitor_readiness <> 'armed') then raise exception 'SOURCE_MONITOR_NOT_ARMED' using errcode = '22023'; end if;
  if binding_row.monitor_required and not coalesce((select enabled from private.market_intelligence_runtime_settings where setting_key = 'source_monitor_scheduler_enabled'), false) then raise exception 'SOURCE_SCHEDULER_NOT_ENABLED' using errcode = '22023'; end if;
  if not exists (select 1 from private.market_expert_runs r where r.id = binding_row.expert_run_id and r.status = 'completed' and r.policy_version = binding_row.policy_version) then raise exception 'MARKET_EXPERT_ANALYSIS_REQUIRED' using errcode = '22023'; end if;
end;
$function$;
revoke all on function private.assert_market_source_publication_ready(uuid) from public, anon, authenticated, service_role;

create or replace function private.market_source_publication_gate_trigger()
returns trigger language plpgsql security definer set search_path = ''
as $function$
begin
  if new.workflow_status in ('scheduled', 'published') and old.workflow_status is distinct from new.workflow_status then
    perform private.assert_market_source_publication_ready(new.id);
  end if;
  return new;
end;
$function$;

drop trigger if exists market_drafts_source_publication_gate on private.market_drafts;
create trigger market_drafts_source_publication_gate before update of workflow_status on private.market_drafts
for each row execute function private.market_source_publication_gate_trigger();

create or replace function private.market_source_mark_monitoring_trigger()
returns trigger language plpgsql security definer set search_path = ''
as $function$
begin
  if new.workflow_status = 'published' and old.workflow_status is distinct from new.workflow_status then
    update private.market_source_bindings set
      market_id = new.market_id,
      status = case when monitor_required then 'monitoring' else status end,
      monitor_readiness = case when monitor_required then 'monitoring' else monitor_readiness end,
      updated_at = now()
    where draft_id = new.id and status <> 'superseded';
  end if;
  return new;
end;
$function$;

drop trigger if exists market_drafts_source_monitoring_state on private.market_drafts;
create trigger market_drafts_source_monitoring_state after update of workflow_status on private.market_drafts
for each row execute function private.market_source_mark_monitoring_trigger();

create or replace function public.get_data_observatory_dashboard(filters_input jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = ''
as $function$
declare result jsonb;
begin
  perform private.require_current_admin();
  select jsonb_build_object(
    'entities', coalesce((select jsonb_agg(to_jsonb(e) - 'created_by' order by e.updated_at desc) from private.data_observatory_entities e where e.active), '[]'::jsonb),
    'signals', coalesce((select jsonb_agg(to_jsonb(s) order by s.observed_at desc) from (select * from private.data_observatory_signals order by observed_at desc limit least(greatest(coalesce((filters_input->>'limit')::integer, 100), 1), 200)) s), '[]'::jsonb),
    'context_items', coalesce((select jsonb_agg(to_jsonb(c) order by c.observed_at desc) from (select * from private.data_observatory_context_items where active order by observed_at desc limit 50) c), '[]'::jsonb),
    'story_arcs', coalesce((select jsonb_agg(to_jsonb(a) order by a.updated_at desc) from (select * from private.data_observatory_story_arcs order by updated_at desc limit 50) a), '[]'::jsonb),
    'hypotheses', coalesce((select jsonb_agg(to_jsonb(h) order by h.updated_at desc) from (select * from private.market_opportunity_hypotheses order by updated_at desc limit 100) h), '[]'::jsonb),
    'provider_runs', coalesce((select jsonb_agg(to_jsonb(r) order by r.created_at desc) from (select * from private.data_provider_runs order by created_at desc limit 50) r), '[]'::jsonb),
    'bindings', coalesce((select jsonb_agg(to_jsonb(b) order by b.updated_at desc) from (select * from private.market_source_bindings where status <> 'superseded' order by updated_at desc limit 100) b), '[]'::jsonb),
    'policy', (select jsonb_build_object('version', version, 'schema_version', schema_version, 'status', status) from private.market_intelligence_policy_versions where status = 'active' order by activated_at desc limit 1),
    'schedulers', (select coalesce(jsonb_object_agg(setting_key, jsonb_build_object('enabled', enabled, 'schedule', value_text)), '{}'::jsonb) from private.market_intelligence_runtime_settings)
  ) into result;
  return result;
end;
$function$;
revoke all on function public.get_data_observatory_dashboard(jsonb) from public, anon, authenticated;
grant execute on function public.get_data_observatory_dashboard(jsonb) to authenticated;

create or replace function public.save_data_observatory_entity(entity_input jsonb)
returns jsonb language plpgsql security definer set search_path = ''
as $function$
declare actor_id uuid := private.require_current_admin(); saved private.data_observatory_entities%rowtype;
begin
  if coalesce(entity_input->>'provider', '') not in ('igdb', 'twitch', 'youtube') then raise exception 'OBSERVATORY_PROVIDER_INVALID' using errcode = '22023'; end if;
  if nullif(trim(entity_input->>'external_id'), '') is null or nullif(trim(entity_input->>'label'), '') is null then raise exception 'OBSERVATORY_ENTITY_INCOMPLETE' using errcode = '22023'; end if;
  insert into private.data_observatory_entities (provider, entity_type, external_id, canonical_url, label, configuration, created_by)
  values (entity_input->>'provider', left(coalesce(entity_input->>'entity_type', 'unknown'), 80), left(entity_input->>'external_id', 300), left(coalesce(entity_input->>'canonical_url', ''), 2048), left(entity_input->>'label', 300), coalesce(entity_input->'configuration', '{}'::jsonb), actor_id)
  on conflict (provider, entity_type, external_id) do update set canonical_url = excluded.canonical_url, label = excluded.label, configuration = excluded.configuration, active = true, updated_at = now()
  returning * into saved;
  insert into private.market_admin_audit(actor_id, action_code, detail) values (actor_id, 'OBSERVATORY_WATCH_ADDED', jsonb_build_object('entity_id', saved.id, 'provider', saved.provider));
  return to_jsonb(saved) - 'created_by';
end;
$function$;
revoke all on function public.save_data_observatory_entity(jsonb) from public, anon, authenticated;
grant execute on function public.save_data_observatory_entity(jsonb) to authenticated;

create or replace function public.remove_data_observatory_entity(entity_id_input uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $function$
declare actor_id uuid := private.require_current_admin();
begin
  update private.data_observatory_entities set active = false, updated_at = now() where id = entity_id_input;
  if not found then raise exception 'OBSERVATORY_ENTITY_NOT_FOUND' using errcode = 'P0001'; end if;
  insert into private.market_admin_audit(actor_id, action_code, detail) values (actor_id, 'OBSERVATORY_WATCH_REMOVED', jsonb_build_object('entity_id', entity_id_input));
  return jsonb_build_object('status', 'removed', 'entity_id', entity_id_input);
end;
$function$;
revoke all on function public.remove_data_observatory_entity(uuid) from public, anon, authenticated;
grant execute on function public.remove_data_observatory_entity(uuid) to authenticated;

create or replace function public.get_data_observatory_signal(signal_id_input uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $function$
declare signal_row private.data_observatory_signals%rowtype; run_row private.market_expert_runs%rowtype;
begin
  perform private.require_current_admin();
  select * into signal_row from private.data_observatory_signals where id = signal_id_input;
  if not found then raise exception 'OBSERVATORY_SIGNAL_NOT_FOUND' using errcode = 'P0001'; end if;
  if signal_row.expert_run_id is not null then select * into run_row from private.market_expert_runs where id = signal_row.expert_run_id; end if;
  return jsonb_build_object('signal', to_jsonb(signal_row), 'expert_analysis', case when run_row.id is null then null else to_jsonb(run_row) - 'tool_summary' end,
    'hypotheses', coalesce((select jsonb_agg(to_jsonb(h) order by h.created_at) from private.market_opportunity_hypotheses h where h.origin_type = 'observatory_signal' and h.origin_id = signal_row.id::text), '[]'::jsonb));
end;
$function$;
revoke all on function public.get_data_observatory_signal(uuid) from public, anon, authenticated;
grant execute on function public.get_data_observatory_signal(uuid) to authenticated;

create or replace function public.dismiss_data_observatory_signal(signal_id_input uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $function$
declare actor_id uuid := private.require_current_admin();
begin
  update private.data_observatory_signals set marketability_status = 'rejected', hypothesis_status = 'rejected', updated_at = now() where id = signal_id_input;
  if not found then raise exception 'OBSERVATORY_SIGNAL_NOT_FOUND' using errcode = 'P0001'; end if;
  insert into private.market_admin_audit(actor_id, action_code, detail) values (actor_id, 'OBSERVATORY_SIGNAL_DISMISSED', jsonb_build_object('signal_id', signal_id_input));
  return jsonb_build_object('status', 'rejected');
end;
$function$;
revoke all on function public.dismiss_data_observatory_signal(uuid) from public, anon, authenticated;
grant execute on function public.dismiss_data_observatory_signal(uuid) to authenticated;

create or replace function public.upsert_data_observatory_batch(provider_input text, signals_input jsonb, run_input jsonb)
returns jsonb language plpgsql security definer set search_path = ''
as $function$
declare item jsonb; saved_count integer := 0;
begin
  if provider_input not in ('igdb', 'twitch', 'youtube') or jsonb_typeof(coalesce(signals_input, '[]'::jsonb)) <> 'array' then raise exception 'OBSERVATORY_BATCH_INVALID' using errcode = '22023'; end if;
  for item in select value from jsonb_array_elements(signals_input) loop
    insert into private.data_observatory_signals (
      provider, signal_type, entity_type, entity_id, parent_entity_id, canonical_url, title, subtitle, description, atinara_category,
      observed_at, source_updated_at, valid_until, signal_origin, opportunity_type, context_type, catalyst_type,
      factual_basis, contextual_basis, inference_summary, market_thesis, why_now, unresolved_question, suggested_market_type,
      metric_name, metric_value, metric_unit, metric_precision, metric_is_rounded, previous_value, change_value,
      time_window_start, time_window_end, source_payload_excerpt, source_fingerprint, marketability_status,
      marketability_reason_codes, resolution_readiness, suggested_question, suggested_yes_criteria, suggested_no_criteria,
      suggested_edge_cases, suggested_resolution_contract, duplicate_matches, provider_policy_flags, retention_expires_at
    ) values (
      provider_input, left(coalesce(item->>'signal_type','unknown'),100), left(coalesce(item->>'entity_type','unknown'),100), left(coalesce(item->>'entity_id',''),300), nullif(left(coalesce(item->>'parent_entity_id',''),300),''), nullif(left(coalesce(item->>'canonical_url',''),2048),''), left(coalesce(item->>'title','Señal sin título'),500), nullif(left(coalesce(item->>'subtitle',''),500),''), nullif(left(coalesce(item->>'description',''),4000),''), nullif(left(coalesce(item->>'atinara_category',''),100),''),
      coalesce((item->>'observed_at')::timestamptz, now()), nullif(item->>'source_updated_at','')::timestamptz, nullif(item->>'valid_until','')::timestamptz, left(coalesce(item->>'signal_origin','provider_api'),100), nullif(left(coalesce(item->>'opportunity_type',''),100),''), nullif(left(coalesce(item->>'context_type',''),100),''), nullif(left(coalesce(item->>'catalyst_type',''),100),''),
      nullif(left(coalesce(item->>'factual_basis',''),4000),''), nullif(left(coalesce(item->>'contextual_basis',''),4000),''), nullif(left(coalesce(item->>'inference_summary',''),4000),''), nullif(left(coalesce(item->>'market_thesis',''),4000),''), nullif(left(coalesce(item->>'why_now',''),2000),''), nullif(left(coalesce(item->>'unresolved_question',''),2000),''), nullif(left(coalesce(item->>'suggested_market_type',''),100),''),
      nullif(left(coalesce(item->>'metric_name',''),200),''), nullif(item->>'metric_value','')::numeric, nullif(left(coalesce(item->>'metric_unit',''),100),''), nullif(left(coalesce(item->>'metric_precision',''),200),''), coalesce((item->>'metric_is_rounded')::boolean,false), nullif(item->>'previous_value','')::numeric, nullif(item->>'change_value','')::numeric,
      nullif(item->>'time_window_start','')::timestamptz, nullif(item->>'time_window_end','')::timestamptz, coalesce(item->'source_payload_excerpt','{}'::jsonb), left(item->>'source_fingerprint',128), coalesce(item->>'marketability_status','pending'),
      coalesce(item->'marketability_reason_codes','[]'::jsonb), nullif(item->>'resolution_readiness',''), nullif(left(coalesce(item->>'suggested_question',''),500),''), nullif(left(coalesce(item->>'suggested_yes_criteria',''),4000),''), nullif(left(coalesce(item->>'suggested_no_criteria',''),4000),''),
      nullif(left(coalesce(item->>'suggested_edge_cases',''),4000),''), coalesce(item->'suggested_resolution_contract','{}'::jsonb), coalesce(item->'duplicate_matches','[]'::jsonb), coalesce(item->'provider_policy_flags','[]'::jsonb), nullif(item->>'retention_expires_at','')::timestamptz
    ) on conflict (provider, source_fingerprint) do update set
      title = excluded.title, subtitle = excluded.subtitle, description = excluded.description, observed_at = excluded.observed_at,
      metric_value = excluded.metric_value, previous_value = private.data_observatory_signals.metric_value,
      change_value = case when excluded.metric_value is null or private.data_observatory_signals.metric_value is null then null else excluded.metric_value - private.data_observatory_signals.metric_value end,
      source_payload_excerpt = excluded.source_payload_excerpt, provider_policy_flags = excluded.provider_policy_flags,
      retention_expires_at = excluded.retention_expires_at, updated_at = now();
    saved_count := saved_count + 1;
  end loop;
  insert into private.data_provider_runs(provider, action, status, result_count, quota_state, error_code, is_cached, trigger_type, next_allowed_at, completed_at)
  values (provider_input, coalesce(run_input->>'action','discover'), coalesce(run_input->>'status','available'), saved_count, coalesce(run_input->'quota_state','{}'::jsonb), nullif(run_input->>'error_code',''), coalesce((run_input->>'is_cached')::boolean,false), coalesce(run_input->>'trigger_type','manual'), nullif(run_input->>'next_allowed_at','')::timestamptz, now());
  return jsonb_build_object('saved', saved_count);
end;
$function$;
revoke all on function public.upsert_data_observatory_batch(text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.upsert_data_observatory_batch(text, jsonb, jsonb) to service_role;

create or replace function public.record_data_provider_run(provider_input text, action_input text, status_input text, result_count_input integer, detail_input jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = ''
as $function$
declare run_id uuid;
begin
  insert into private.data_provider_runs(provider, action, status, result_count, quota_state, error_code, is_cached, trigger_type, next_allowed_at, completed_at)
  values (left(provider_input,80), left(action_input,100), status_input, greatest(coalesce(result_count_input,0),0), coalesce(detail_input->'quota_state','{}'::jsonb), nullif(left(coalesce(detail_input->>'error_code',''),100),''), coalesce((detail_input->>'is_cached')::boolean,false), coalesce(detail_input->>'trigger_type','manual'), nullif(detail_input->>'next_allowed_at','')::timestamptz, now()) returning id into run_id;
  return jsonb_build_object('id', run_id);
end;
$function$;
revoke all on function public.record_data_provider_run(text,text,text,integer,jsonb) from public, anon, authenticated;
grant execute on function public.record_data_provider_run(text,text,text,integer,jsonb) to service_role;

create or replace function public.save_data_observatory_context_batch(origin_type_input text, origin_id_input text, entity_id_input uuid, items_input jsonb, story_arc_input jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = ''
as $function$
declare item jsonb; saved_count integer := 0; arc_row private.data_observatory_story_arcs%rowtype;
begin
  if auth.role() <> 'service_role' then raise exception 'SERVICE_ROLE_REQUIRED' using errcode='42501'; end if;
  if jsonb_typeof(coalesce(items_input,'[]'::jsonb)) <> 'array' then raise exception 'CONTEXT_BATCH_INVALID' using errcode='22023'; end if;
  for item in select value from jsonb_array_elements(items_input) loop
    insert into private.data_observatory_context_items(entity_id,origin_type,origin_id,provider,source_url,source_role,source_type,official_status,title,excerpt,published_at,observed_at,source_fingerprint,retention_expires_at,policy_flags)
    values (entity_id_input,origin_type_input,origin_id_input,left(coalesce(item->>'provider','tavily'),40),left(item->>'source_url',2048),coalesce(item->>'source_role','CONTEXT_SOURCE'),left(coalesce(item->>'source_type','public_web'),80),coalesce(item->>'official_status','secondary'),left(item->>'title',500),left(coalesce(item->>'excerpt',''),2000),nullif(item->>'published_at','')::timestamptz,coalesce(nullif(item->>'observed_at','')::timestamptz,now()),left(item->>'source_fingerprint',128),nullif(item->>'retention_expires_at','')::timestamptz,coalesce(item->'policy_flags','[]'::jsonb))
    on conflict (provider,source_fingerprint) do update set excerpt=excluded.excerpt,published_at=excluded.published_at,observed_at=excluded.observed_at,retention_expires_at=excluded.retention_expires_at,active=true;
    saved_count := saved_count + 1;
  end loop;
  if entity_id_input is not null and nullif(story_arc_input->>'title','') is not null then
    update private.data_observatory_story_arcs
       set target_metric = nullif(story_arc_input->>'target_metric',''),
           target_event = nullif(story_arc_input->>'target_event',''),
           target_value = nullif(story_arc_input->>'target_value','')::numeric,
           target_at = nullif(story_arc_input->>'target_at','')::timestamptz,
           factual_summary = left(coalesce(story_arc_input->>'factual_summary','Contexto documentado'),4000),
           contextual_summary = left(coalesce(story_arc_input->>'contextual_summary',''),4000),
           evidence_refs = coalesce(story_arc_input->'evidence_refs','[]'::jsonb),
           last_evaluated_at = now(),
           next_evaluation_at = now()+interval '6 hours',
           updated_at = now()
     where entity_id = entity_id_input
       and arc_type = coalesce(story_arc_input->>'arc_type','documented_context')
       and title = left(story_arc_input->>'title',500)
       and status = 'active'
     returning * into arc_row;
    if not found then
      insert into private.data_observatory_story_arcs(entity_id,arc_type,title,target_metric,target_event,target_value,target_at,factual_summary,contextual_summary,evidence_refs,last_evaluated_at,next_evaluation_at)
      values (entity_id_input,coalesce(story_arc_input->>'arc_type','documented_context'),left(story_arc_input->>'title',500),nullif(story_arc_input->>'target_metric',''),nullif(story_arc_input->>'target_event',''),nullif(story_arc_input->>'target_value','')::numeric,nullif(story_arc_input->>'target_at','')::timestamptz,left(coalesce(story_arc_input->>'factual_summary','Contexto documentado'),4000),left(coalesce(story_arc_input->>'contextual_summary',''),4000),coalesce(story_arc_input->'evidence_refs','[]'::jsonb),now(),now()+interval '6 hours') returning * into arc_row;
    end if;
  end if;
  if entity_id_input is not null then update private.data_observatory_entities set last_checked_at=now(),next_context_scan_at=now()+interval '6 hours',updated_at=now() where id=entity_id_input; end if;
  return jsonb_build_object('saved',saved_count,'story_arc',case when arc_row.id is null then null else to_jsonb(arc_row) end);
end;
$function$;
revoke all on function public.save_data_observatory_context_batch(text,text,uuid,jsonb,jsonb) from public, anon, authenticated;
grant execute on function public.save_data_observatory_context_batch(text,text,uuid,jsonb,jsonb) to service_role;

create or replace function public.get_market_intelligence_origin(origin_type_input text, origin_id_input text)
returns jsonb language plpgsql security definer set search_path = ''
as $function$
declare result jsonb;
begin
  if auth.role() <> 'service_role' then perform private.require_current_admin(); end if;
  if origin_type_input = 'observatory_signal' then
    select to_jsonb(s) || jsonb_build_object(
      'watch_entity_id',(select e.id from private.data_observatory_entities e where e.provider=s.provider and e.external_id=s.entity_id and e.active order by e.updated_at desc limit 1),
      'recent_context',coalesce((select jsonb_agg(to_jsonb(c) order by c.observed_at desc) from (select * from private.data_observatory_context_items where origin_type='observatory_signal' and origin_id=origin_id_input and active order by observed_at desc limit 10) c),'[]'::jsonb)
    ) into result from private.data_observatory_signals s where s.id::text = origin_id_input;
  elsif origin_type_input = 'radar_candidate' then
    select private.market_radar_safe_payload(c) into result from private.external_market_candidates c where c.id::text = origin_id_input;
  elsif origin_type_input = 'context_story_arc' then
    select to_jsonb(a) into result from private.data_observatory_story_arcs a where a.id::text = origin_id_input;
  else raise exception 'INTELLIGENCE_ORIGIN_INVALID' using errcode = '22023'; end if;
  if result is null then raise exception 'INTELLIGENCE_ORIGIN_NOT_FOUND' using errcode = 'P0001'; end if;
  return result;
end;
$function$;
revoke all on function public.get_market_intelligence_origin(text,text) from public, anon, authenticated;
grant execute on function public.get_market_intelligence_origin(text,text) to authenticated;

create or replace function public.record_market_expert_run(run_input jsonb)
returns jsonb language plpgsql security definer set search_path = ''
as $function$
declare saved private.market_expert_runs%rowtype;
begin
  insert into private.market_expert_runs (
    agent_type, origin_type, origin_id, provider, origin_fingerprint, analysis_fingerprint, policy_version, schema_version,
    model_version, status, decision, integrity_status, forecastability_status, source_readiness, confidence,
    human_review_required, result_json, tool_summary, analysis_mode, trigger_type, context_scan_id, error_code, completed_at
  ) values (
    coalesce(run_input->>'agent_type','market_editor'), run_input->>'origin_type', run_input->>'origin_id', nullif(run_input->>'provider',''),
    run_input->>'origin_fingerprint', run_input->>'analysis_fingerprint', run_input->>'policy_version', run_input->>'schema_version', nullif(left(coalesce(run_input->>'model_version',''),120),''),
    run_input->>'status', nullif(run_input->>'decision',''), nullif(run_input->>'integrity_status',''), nullif(run_input->>'forecastability_status',''), nullif(run_input->>'source_readiness',''), nullif(run_input->>'confidence','')::integer,
    coalesce((run_input->>'human_review_required')::boolean,true), coalesce(run_input->'result_json','{}'::jsonb), coalesce(run_input->'tool_summary','[]'::jsonb), coalesce(run_input->>'analysis_mode','validate'), coalesce(run_input->>'trigger_type','manual'), nullif(run_input->>'context_scan_id','')::uuid, nullif(run_input->>'error_code',''), now()
  ) on conflict (origin_type, origin_id, analysis_fingerprint, policy_version, schema_version) do update set
    status = excluded.status, decision = excluded.decision, integrity_status = excluded.integrity_status,
    forecastability_status = excluded.forecastability_status, source_readiness = excluded.source_readiness,
    confidence = excluded.confidence, human_review_required = excluded.human_review_required,
    result_json = excluded.result_json, tool_summary = excluded.tool_summary, error_code = excluded.error_code, completed_at = now()
  returning * into saved;
  if saved.origin_type = 'observatory_signal' then
    update private.data_observatory_signals set expert_analysis_status = saved.status, expert_run_id = saved.id,
      expert_decision = saved.decision, integrity_status = saved.integrity_status, forecastability_status = saved.forecastability_status,
      source_readiness = saved.source_readiness, expert_confidence = saved.confidence, human_review_required = saved.human_review_required,
      expert_reason_codes = coalesce(saved.result_json->'reason_codes','[]'::jsonb), analysis_fingerprint = saved.analysis_fingerprint,
      policy_version = saved.policy_version, expert_schema_version = saved.schema_version, updated_at = now()
    where id::text = saved.origin_id;
  end if;
  return to_jsonb(saved) - 'tool_summary';
end;
$function$;
revoke all on function public.record_market_expert_run(jsonb) from public, anon, authenticated;
grant execute on function public.record_market_expert_run(jsonb) to service_role;

create or replace function public.save_market_opportunity_hypotheses(origin_type_input text, origin_id_input text, hypotheses_input jsonb)
returns jsonb language plpgsql security definer set search_path = ''
as $function$
declare item jsonb; saved integer := 0;
begin
  if jsonb_typeof(coalesce(hypotheses_input,'[]'::jsonb)) <> 'array' or jsonb_array_length(hypotheses_input) > 3 then raise exception 'HYPOTHESES_INVALID' using errcode = '22023'; end if;
  for item in select value from jsonb_array_elements(hypotheses_input) loop
    insert into private.market_opportunity_hypotheses(origin_type, origin_id, story_arc_id, opportunity_type, hypothesis_status, proposed_question, why_now, market_thesis, factual_basis, contextual_basis, unresolved_question, resolution_path, rejection_reason_codes, expert_run_id, fingerprint)
    values (origin_type_input, origin_id_input, nullif(item->>'story_arc_id','')::uuid, coalesce(item->>'opportunity_type','other_reviewed'), coalesce(item->>'hypothesis_status','generated'), nullif(item->>'proposed_question',''), nullif(item->>'why_now',''), nullif(item->>'market_thesis',''), nullif(item->>'factual_basis',''), nullif(item->>'contextual_basis',''), nullif(item->>'unresolved_question',''), coalesce(item->'resolution_path','{}'::jsonb), coalesce(item->'rejection_reason_codes','[]'::jsonb), nullif(item->>'expert_run_id','')::uuid, private.market_intelligence_hash(item))
    on conflict (origin_type, origin_id, fingerprint) do update set hypothesis_status = excluded.hypothesis_status, updated_at = now();
    saved := saved + 1;
  end loop;
  return jsonb_build_object('saved', saved);
end;
$function$;
revoke all on function public.save_market_opportunity_hypotheses(text,text,jsonb) from public, anon, authenticated;
grant execute on function public.save_market_opportunity_hypotheses(text,text,jsonb) to service_role;

create or replace function public.get_market_expert_analysis(origin_type_input text, origin_id_input text)
returns jsonb language plpgsql security definer set search_path = ''
as $function$
begin
  perform private.require_current_admin();
  return coalesce((select to_jsonb(r) - 'tool_summary' from private.market_expert_runs r where r.origin_type = origin_type_input and r.origin_id = origin_id_input order by r.created_at desc limit 1), '{}'::jsonb);
end;
$function$;
revoke all on function public.get_market_expert_analysis(text,text) from public, anon, authenticated;
grant execute on function public.get_market_expert_analysis(text,text) to authenticated;

create or replace function public.record_market_expert_feedback(run_id_input uuid, final_decision_input text, changed_fields_input jsonb, reason_input text default null, promote_input boolean default false)
returns jsonb language plpgsql security definer set search_path = ''
as $function$
declare actor_id uuid := private.require_current_admin(); run_row private.market_expert_runs%rowtype; feedback_id uuid;
begin
  select * into run_row from private.market_expert_runs where id = run_id_input;
  if not found then raise exception 'EXPERT_RUN_NOT_FOUND' using errcode = 'P0001'; end if;
  insert into private.market_expert_feedback(run_id, actor_id, admin_action, original_decision, final_decision, changed_fields, correction_reason, promoted_to_precedent)
  values (run_row.id, actor_id, 'feedback', run_row.decision, final_decision_input, coalesce(changed_fields_input,'[]'::jsonb), nullif(trim(coalesce(reason_input,'')),''), false)
  returning id into feedback_id;
  return jsonb_build_object('feedback_id', feedback_id, 'promoted', false, 'message', 'Feedback guardado sin cambiar la política. La promoción exige una acción separada.');
end;
$function$;
revoke all on function public.record_market_expert_feedback(uuid,text,jsonb,text,boolean) from public, anon, authenticated;
grant execute on function public.record_market_expert_feedback(uuid,text,jsonb,text,boolean) to authenticated;

create or replace function public.promote_market_expert_precedent(feedback_id_input uuid, precedent_input jsonb)
returns jsonb language plpgsql security definer set search_path = ''
as $function$
declare actor_id uuid := private.require_current_admin(); feedback_row private.market_expert_feedback%rowtype; precedent_id uuid;
begin
  select * into feedback_row from private.market_expert_feedback where id = feedback_id_input;
  if not found then raise exception 'EXPERT_FEEDBACK_NOT_FOUND' using errcode = 'P0001'; end if;
  if feedback_row.promoted_to_precedent then raise exception 'EXPERT_FEEDBACK_ALREADY_PROMOTED' using errcode = '22023'; end if;
  if nullif(trim(coalesce(precedent_input->>'title','')),'') is null
     or nullif(trim(coalesce(precedent_input->>'problem_type','')),'') is null
     or nullif(trim(coalesce(precedent_input->>'explanation','')),'') is null then
    raise exception 'EXPERT_PRECEDENT_INVALID' using errcode = '22023';
  end if;
  insert into private.market_expert_precedents(source_feedback_id, title, category, problem_type, facts_json, approved_decision, explanation, tags, reason_codes, policy_version, approved_by)
  values (feedback_row.id, left(precedent_input->>'title',300), nullif(precedent_input->>'category',''), left(precedent_input->>'problem_type',120), coalesce(precedent_input->'facts_json','{}'::jsonb), feedback_row.final_decision, left(precedent_input->>'explanation',4000), coalesce(precedent_input->'tags','[]'::jsonb), coalesce(precedent_input->'reason_codes','[]'::jsonb), 'atinara-market-constitution-v1', actor_id)
  returning id into precedent_id;
  update private.market_expert_feedback set promoted_to_precedent = true where id = feedback_row.id;
  return jsonb_build_object('precedent_id', precedent_id, 'active', true);
end;
$function$;
revoke all on function public.promote_market_expert_precedent(uuid,jsonb) from public, anon, authenticated;
grant execute on function public.promote_market_expert_precedent(uuid,jsonb) to authenticated;

create or replace function public.list_applicable_market_precedents(category_input text, problem_type_input text)
returns jsonb language plpgsql security definer set search_path = ''
as $function$
begin
  perform private.require_current_admin();
  return coalesce((select jsonb_agg(to_jsonb(p) - 'approved_by' order by p.created_at desc) from private.market_expert_precedents p where p.active and p.policy_version = 'atinara-market-constitution-v1' and (category_input is null or p.category = category_input) and (problem_type_input is null or p.problem_type = problem_type_input) limit 10), '[]'::jsonb);
end;
$function$;
revoke all on function public.list_applicable_market_precedents(text,text) from public, anon, authenticated;
grant execute on function public.list_applicable_market_precedents(text,text) to authenticated;

create or replace function public.bind_market_draft_intelligence(draft_id_input uuid, origin_type_input text, origin_id_input text, expert_run_id_input uuid, contract_input jsonb, sources_input jsonb default '[]'::jsonb)
returns jsonb language plpgsql security definer set search_path = ''
as $function$
declare actor_id uuid := private.require_current_admin(); run_row private.market_expert_runs%rowtype; binding_row private.market_source_bindings%rowtype; item jsonb; monitor_required_value boolean;
begin
  select * into run_row from private.market_expert_runs where id = expert_run_id_input and origin_type = origin_type_input and origin_id = origin_id_input and status = 'completed';
  if not found then raise exception 'MARKET_EXPERT_ANALYSIS_REQUIRED' using errcode = '22023'; end if;
  if jsonb_typeof(coalesce(contract_input,'{}'::jsonb)) <> 'object' or jsonb_typeof(coalesce(sources_input,'[]'::jsonb)) <> 'array' then raise exception 'RESOLUTION_PLAN_REQUIRED' using errcode = '22023'; end if;
  monitor_required_value := coalesce(contract_input->>'capture_strategy','') in ('snapshot_at_deadline','poll_during_window','event_presence');
  update private.market_source_bindings set status = 'superseded', updated_at = now() where draft_id = draft_id_input and status = 'draft';
  insert into private.market_source_bindings(draft_id, origin_type, origin_id, expert_run_id, plan_version, contract_schema_version, policy_version, resolution_contract, provider, adapter_version, monitor_required, monitor_readiness)
  values (draft_id_input, origin_type_input, origin_id_input, run_row.id, coalesce((select max(plan_version)+1 from private.market_source_bindings where draft_id=draft_id_input),1), coalesce(contract_input->>'contract_schema_version','atinara-resolution-contract-v1'), run_row.policy_version, contract_input, coalesce(contract_input->>'provider',run_row.provider), coalesce(contract_input->>'provider_adapter_version','unknown'), monitor_required_value, case when monitor_required_value then 'required' else 'not_required' end)
  returning * into binding_row;
  for item in select value from jsonb_array_elements(sources_input) loop
    insert into private.market_source_binding_sources(binding_id, source_url, role, precedence, fallback_condition, required)
    values (binding_row.id, left(item->>'url',2048), item->>'role', coalesce((item->>'precedence')::integer,1), nullif(item->>'fallback_condition',''), coalesce((item->>'required')::boolean,false));
  end loop;
  update private.market_drafts set intelligence_origin_type = origin_type_input, intelligence_origin_id = origin_id_input, expert_run_id = run_row.id, updated_at = now(), updated_by = actor_id where id = draft_id_input;
  insert into private.market_admin_audit(actor_id, action_code, draft_id, detail) values (actor_id, 'MARKET_INTELLIGENCE_BOUND', draft_id_input, jsonb_build_object('binding_id', binding_row.id, 'origin_type', origin_type_input));
  return to_jsonb(binding_row);
end;
$function$;
revoke all on function public.bind_market_draft_intelligence(uuid,text,text,uuid,jsonb,jsonb) from public, anon, authenticated;
grant execute on function public.bind_market_draft_intelligence(uuid,text,text,uuid,jsonb,jsonb) to authenticated;

create or replace function public.save_market_draft_from_intelligence(
  draft_id_input uuid,
  expected_version_input bigint,
  draft_input jsonb,
  origin_type_input text,
  origin_id_input text,
  expert_run_id_input uuid,
  contract_input jsonb,
  sources_input jsonb
)
returns jsonb language plpgsql security definer set search_path = ''
as $function$
declare save_result jsonb; saved_draft_id uuid; binding_result jsonb;
begin
  perform private.require_current_admin();
  if draft_id_input is not null then
    raise exception 'INTELLIGENCE_DRAFT_MUST_BE_NEW' using errcode = '22023';
  end if;
  save_result := public.save_market_draft(draft_id_input, expected_version_input, draft_input);
  saved_draft_id := (save_result -> 'draft' ->> 'id')::uuid;
  binding_result := public.bind_market_draft_intelligence(
    saved_draft_id,
    origin_type_input,
    origin_id_input,
    expert_run_id_input,
    contract_input,
    sources_input
  );
  return save_result || jsonb_build_object('intelligence_binding', binding_result);
end;
$function$;
revoke all on function public.save_market_draft_from_intelligence(uuid,bigint,jsonb,text,text,uuid,jsonb,jsonb) from public, anon, authenticated;
grant execute on function public.save_market_draft_from_intelligence(uuid,bigint,jsonb,text,text,uuid,jsonb,jsonb) to authenticated;

create or replace function public.verify_market_source_binding(binding_id_input uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $function$
declare actor_id uuid := private.require_current_admin(); binding_row private.market_source_bindings%rowtype; issues jsonb := '[]'::jsonb; source_count integer; primary_count integer;
begin
  select * into binding_row from private.market_source_bindings where id = binding_id_input for update;
  if not found then raise exception 'SOURCE_BINDING_NOT_FOUND' using errcode = 'P0001'; end if;
  select count(*), count(*) filter (where role = 'PRIMARY_RESOLUTION') into source_count, primary_count from private.market_source_binding_sources where binding_id = binding_row.id;
  if binding_row.contract_schema_version <> 'atinara-resolution-contract-v1' then issues := issues || '"RESOLUTION_POLICY_VERSION_UNKNOWN"'::jsonb; end if;
  if coalesce(binding_row.resolution_contract->>'capture_strategy','') not in ('current_at_resolution','snapshot_at_deadline','poll_during_window','event_presence','static_revalidation','manual_official_source') then issues := issues || '"SOURCE_METRIC_UNSUPPORTED"'::jsonb; end if;
  if binding_row.monitor_required and nullif(binding_row.resolution_contract->>'metric','') is null then issues := issues || '"SOURCE_METRIC_UNSUPPORTED"'::jsonb; end if;
  if binding_row.monitor_required and nullif(binding_row.resolution_contract->>'precision','') is null then issues := issues || '"SOURCE_PRECISION_INSUFFICIENT"'::jsonb; end if;
  if coalesce(binding_row.resolution_contract->>'capture_strategy','') = 'poll_during_window'
     and coalesce((binding_row.resolution_contract->>'sampling_interval_seconds')::integer,0) < 60 then issues := issues || '"SOURCE_MONITOR_INTERVAL_UNSAFE"'::jsonb; end if;
  if coalesce(binding_row.resolution_contract->>'capture_strategy','') = 'poll_during_window'
     and coalesce((binding_row.resolution_contract->>'sampling_interval_seconds')::integer,0) = 60
     and coalesce((binding_row.resolution_contract->>'maximum_monitor_duration_seconds')::integer,0) > 21600 then issues := issues || '"SOURCE_MONITOR_WINDOW_TOO_LONG"'::jsonb; end if;
  if binding_row.provider = 'youtube'
     and coalesce((binding_row.resolution_contract->>'maximum_monitor_duration_seconds')::integer,0) > 2592000 then issues := issues || '"SOURCE_RETENTION_INCOMPATIBLE"'::jsonb; end if;
  if binding_row.monitor_required and not coalesce((select enabled from private.market_intelligence_runtime_settings where setting_key='provider_' || binding_row.provider || '_configured'),false) then issues := issues || '"SOURCE_PROVIDER_NOT_CONFIGURED"'::jsonb; end if;
  if primary_count = 0 and coalesce(binding_row.resolution_contract->>'capture_strategy','') <> 'manual_official_source' then issues := issues || '"SOURCE_PRIMARY_REQUIRED"'::jsonb; end if;
  if source_count = 0 then issues := issues || '"RESOLUTION_PRIMARY_SOURCE_REQUIRED"'::jsonb; end if;
  if nullif(binding_row.resolution_contract->>'canonical_statement','') is null then issues := issues || '"RESOLUTION_PLAN_REQUIRED"'::jsonb; end if;
  if jsonb_array_length(issues) > 0 then
    update private.market_source_bindings set status = 'draft', validation = jsonb_build_object('valid',false,'issues',issues), updated_at = now() where id = binding_row.id returning * into binding_row;
  else
    update private.market_source_bindings set status = 'validated', validation = jsonb_build_object('valid',true,'issues','[]'::jsonb), contract_hash = private.market_intelligence_hash(resolution_contract), locked_at = now(), locked_by = actor_id, monitor_readiness = case when monitor_required then 'validated' else 'not_required' end, updated_at = now() where id = binding_row.id returning * into binding_row;
  end if;
  insert into private.market_admin_audit(actor_id, action_code, draft_id, market_id, detail) values (actor_id, 'SOURCE_BINDING_VALIDATED', binding_row.draft_id, binding_row.market_id, jsonb_build_object('binding_id',binding_row.id,'valid',jsonb_array_length(issues)=0,'issues',issues));
  return to_jsonb(binding_row);
end;
$function$;
revoke all on function public.verify_market_source_binding(uuid) from public, anon, authenticated;
grant execute on function public.verify_market_source_binding(uuid) to authenticated;

create or replace function public.arm_market_source_binding(binding_id_input uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $function$
declare actor_id uuid := private.require_current_admin(); binding_row private.market_source_bindings%rowtype;
begin
  if not coalesce((select enabled from private.market_intelligence_runtime_settings where setting_key='source_monitor_scheduler_enabled'),false) then raise exception 'SOURCE_SCHEDULER_NOT_ENABLED' using errcode='22023'; end if;
  select * into binding_row from private.market_source_bindings where id=binding_id_input for update;
  if not found then raise exception 'SOURCE_BINDING_NOT_FOUND' using errcode='P0001'; end if;
  if not coalesce((select enabled from private.market_intelligence_runtime_settings where setting_key='provider_' || binding_row.provider || '_configured'),false) then raise exception 'SOURCE_PROVIDER_NOT_CONFIGURED' using errcode='22023'; end if;
  if binding_row.status <> 'validated' or binding_row.locked_at is null or binding_row.contract_hash is null then raise exception 'SOURCE_CONTRACT_NOT_LOCKED' using errcode='22023'; end if;
  update private.market_source_bindings set status='armed', monitor_readiness='armed', updated_at=now() where id=binding_row.id returning * into binding_row;
  insert into private.market_admin_audit(actor_id, action_code, draft_id, market_id, detail) values (actor_id,'SOURCE_MONITOR_ARMED',binding_row.draft_id,binding_row.market_id,jsonb_build_object('binding_id',binding_row.id));
  return to_jsonb(binding_row);
end;
$function$;
revoke all on function public.arm_market_source_binding(uuid) from public, anon, authenticated;
grant execute on function public.arm_market_source_binding(uuid) to authenticated;

create or replace function public.pause_market_source_binding(binding_id_input uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $function$
declare actor_id uuid := private.require_current_admin(); result jsonb;
begin
  update private.market_source_bindings b set status='paused', monitor_readiness='paused', updated_at=now() where b.id=binding_id_input and b.status in ('armed','monitoring','failed') returning to_jsonb(b) into result;
  if result is null then raise exception 'SOURCE_BINDING_NOT_PAUSABLE' using errcode='22023'; end if;
  insert into private.market_admin_audit(actor_id, action_code, detail) values (actor_id,'SOURCE_MONITOR_PAUSED',jsonb_build_object('binding_id',binding_id_input));
  return result;
end;
$function$;
revoke all on function public.pause_market_source_binding(uuid) from public, anon, authenticated;
grant execute on function public.pause_market_source_binding(uuid) to authenticated;

create or replace function public.set_market_intelligence_provider_status(provider_input text, configured_input boolean)
returns jsonb language plpgsql security definer set search_path = ''
as $function$
begin
  if auth.role() <> 'service_role' then raise exception 'SERVICE_ROLE_REQUIRED' using errcode='42501'; end if;
  if provider_input not in ('igdb','twitch','youtube') then raise exception 'OBSERVATORY_PROVIDER_INVALID' using errcode='22023'; end if;
  insert into private.market_intelligence_runtime_settings(setting_key,enabled,updated_at)
  values ('provider_' || provider_input || '_configured',configured_input,now())
  on conflict (setting_key) do update set enabled=excluded.enabled,updated_at=now();
  return jsonb_build_object('provider',provider_input,'configured',configured_input);
end;
$function$;
revoke all on function public.set_market_intelligence_provider_status(text,boolean) from public, anon, authenticated;
grant execute on function public.set_market_intelligence_provider_status(text,boolean) to service_role;

create or replace function public.get_market_source_binding_for_capture(binding_id_input uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $function$
begin
  return coalesce((select jsonb_build_object('binding',to_jsonb(b),'sources',coalesce((select jsonb_agg(to_jsonb(s) order by s.precedence) from private.market_source_binding_sources s where s.binding_id=b.id),'[]'::jsonb)) from private.market_source_bindings b where b.id=binding_id_input), '{}'::jsonb);
end;
$function$;
revoke all on function public.get_market_source_binding_for_capture(uuid) from public, anon, authenticated;
grant execute on function public.get_market_source_binding_for_capture(uuid) to service_role;

create or replace function public.record_market_source_snapshot(binding_id_input uuid, snapshot_input jsonb)
returns jsonb language plpgsql security definer set search_path = ''
as $function$
declare snapshot_row private.market_source_snapshots%rowtype;
begin
  insert into private.market_source_snapshots(binding_id,provider,metric,value,unit,observed_at,provider_timestamp,quality,response_excerpt,payload_hash,retention_expires_at,error_code)
  values (binding_id_input, snapshot_input->>'provider', nullif(snapshot_input->>'metric',''), snapshot_input->'value', nullif(snapshot_input->>'unit',''), coalesce((snapshot_input->>'observed_at')::timestamptz,now()), nullif(snapshot_input->>'provider_timestamp','')::timestamptz, coalesce(snapshot_input->>'quality','complete'), coalesce(snapshot_input->'response_excerpt','{}'::jsonb), private.market_intelligence_hash(snapshot_input), nullif(snapshot_input->>'retention_expires_at','')::timestamptz, nullif(snapshot_input->>'error_code','')) returning * into snapshot_row;
  return to_jsonb(snapshot_row);
end;
$function$;
revoke all on function public.record_market_source_snapshot(uuid,jsonb) from public, anon, authenticated;
grant execute on function public.record_market_source_snapshot(uuid,jsonb) to service_role;

create or replace function public.record_market_source_monitor_result(binding_id_input uuid, result_input jsonb)
returns jsonb language plpgsql security definer set search_path = ''
as $function$
declare run_id uuid; status_value text := coalesce(result_input->>'status','failed');
begin
  insert into private.market_source_monitor_runs(binding_id,status,completed_at,error_code,next_capture_at,rate_limit_state,adapter_version)
  values (binding_id_input,status_value,now(),nullif(result_input->>'error_code',''),nullif(result_input->>'next_capture_at','')::timestamptz,coalesce(result_input->'rate_limit_state','{}'::jsonb),coalesce(result_input->>'adapter_version','unknown')) returning id into run_id;
  if status_value in ('failed','changed_schema','conflicting') then update private.market_source_bindings set status=case when status_value='conflicting' then 'source_conflict' else 'failed' end, monitor_readiness='failed', updated_at=now() where id=binding_id_input; end if;
  return jsonb_build_object('run_id',run_id,'applies_resolution',false);
end;
$function$;
revoke all on function public.record_market_source_monitor_result(uuid,jsonb) from public, anon, authenticated;
grant execute on function public.record_market_source_monitor_result(uuid,jsonb) to service_role;

create or replace function public.build_market_resolution_evidence_package(binding_id_input uuid, summary_input jsonb)
returns jsonb language plpgsql security definer set search_path = ''
as $function$
declare binding_row private.market_source_bindings%rowtype; package_row private.market_resolution_evidence_packages%rowtype;
begin
  select * into binding_row from private.market_source_bindings where id=binding_id_input for update;
  if not found or binding_row.market_id is null then raise exception 'SOURCE_BINDING_NOT_PUBLISHED' using errcode='22023'; end if;
  update private.market_resolution_evidence_packages set superseded_at=now(), status='superseded' where binding_id=binding_row.id and superseded_at is null;
  insert into private.market_resolution_evidence_packages(market_id,binding_id,plan_version,contract_hash,status,recommended_outcome,confidence,evidence_json,conflicts_json,warnings_json,manual_review_required)
  values (binding_row.market_id,binding_row.id,binding_row.plan_version,binding_row.contract_hash,coalesce(summary_input->>'status','insufficient'),nullif(summary_input->>'recommended_outcome',''),nullif(summary_input->>'confidence','')::integer,coalesce(summary_input->'evidence','{}'::jsonb),coalesce(summary_input->'conflicts','[]'::jsonb),coalesce(summary_input->'warnings','[]'::jsonb),true) returning * into package_row;
  if package_row.status='ready_to_resolve' then update private.market_source_bindings set status='ready_to_resolve',updated_at=now() where id=binding_row.id; end if;
  return to_jsonb(package_row) || jsonb_build_object('applies_resolution',false);
end;
$function$;
revoke all on function public.build_market_resolution_evidence_package(uuid,jsonb) from public, anon, authenticated;
grant execute on function public.build_market_resolution_evidence_package(uuid,jsonb) to service_role;

create or replace function public.get_market_source_evidence(market_id_input text)
returns jsonb language plpgsql security definer set search_path = ''
as $function$
declare binding_row private.market_source_bindings%rowtype;
begin
  perform private.require_current_admin();
  select * into binding_row from private.market_source_bindings where market_id=market_id_input and status<>'superseded' order by plan_version desc limit 1;
  if not found then return jsonb_build_object('available',false,'message','Este mercado no utiliza una fuente monitorizada.'); end if;
  return jsonb_build_object(
    'available',true,'binding',to_jsonb(binding_row),
    'sources',coalesce((select jsonb_agg(to_jsonb(s) order by s.precedence) from private.market_source_binding_sources s where s.binding_id=binding_row.id),'[]'::jsonb),
    'snapshots',coalesce((select jsonb_agg(to_jsonb(s) order by s.observed_at) from private.market_source_snapshots s where s.binding_id=binding_row.id),'[]'::jsonb),
    'monitor_runs',coalesce((select jsonb_agg(to_jsonb(r) order by r.started_at desc) from (select * from private.market_source_monitor_runs where binding_id=binding_row.id order by started_at desc limit 50) r),'[]'::jsonb),
    'evidence_package',coalesce((select to_jsonb(p) from private.market_resolution_evidence_packages p where p.binding_id=binding_row.id and p.superseded_at is null order by p.created_at desc limit 1),'{}'::jsonb)
  );
end;
$function$;
revoke all on function public.get_market_source_evidence(text) from public, anon, authenticated;
grant execute on function public.get_market_source_evidence(text) to authenticated;

create or replace function public.get_due_context_discovery_entities(limit_count integer default 5)
returns jsonb language plpgsql security definer set search_path = ''
as $function$
begin
  if not coalesce((select enabled from private.market_intelligence_runtime_settings where setting_key='context_discovery_scheduler_enabled'),false) then return jsonb_build_object('enabled',false,'entities','[]'::jsonb); end if;
  return jsonb_build_object('enabled',true,'entities',coalesce((select jsonb_agg((to_jsonb(e)-'created_by') || jsonb_build_object('signal_id',(select s.id from private.data_observatory_signals s where s.provider=e.provider and s.entity_id=e.external_id order by s.observed_at desc limit 1))) from (select * from private.data_observatory_entities where active and coalesce(next_context_scan_at,'epoch'::timestamptz)<=now() order by next_context_scan_at nulls first limit least(greatest(limit_count,1),8) for update skip locked) e),'[]'::jsonb));
end;
$function$;
revoke all on function public.get_due_context_discovery_entities(integer) from public, anon, authenticated;
grant execute on function public.get_due_context_discovery_entities(integer) to service_role;

create or replace function public.get_due_market_source_bindings(limit_count integer default 20)
returns jsonb language plpgsql security definer set search_path = ''
as $function$
begin
  if not coalesce((select enabled from private.market_intelligence_runtime_settings where setting_key='source_monitor_scheduler_enabled'),false) then
    return jsonb_build_object('enabled',false,'bindings','[]'::jsonb);
  end if;
  return jsonb_build_object('enabled',true,'bindings',coalesce((
    select jsonb_agg(jsonb_build_object('binding',to_jsonb(b),'sources',coalesce((select jsonb_agg(to_jsonb(s) order by s.precedence) from private.market_source_binding_sources s where s.binding_id=b.id),'[]'::jsonb)))
    from (
      select b.* from private.market_source_bindings b
      where b.status='monitoring'
        and not exists (
          select 1 from private.market_source_monitor_runs r
          where r.binding_id=b.id and r.next_capture_at > now()
        )
      order by b.updated_at
      limit least(greatest(limit_count,1),50)
      for update skip locked
    ) b
  ),'[]'::jsonb));
end;
$function$;
revoke all on function public.get_due_market_source_bindings(integer) from public, anon, authenticated;
grant execute on function public.get_due_market_source_bindings(integer) to service_role;

create or replace function public.purge_expired_observatory_provider_data(limit_count integer default 500)
returns jsonb language plpgsql security definer set search_path = ''
as $function$
declare deleted_signals integer := 0; deleted_context integer := 0; deleted_snapshots integer := 0;
begin
  with doomed as (select id from private.data_observatory_signals where retention_expires_at < now() order by retention_expires_at limit least(greatest(limit_count,1),2000))
  delete from private.data_observatory_signals s using doomed d where s.id=d.id;
  get diagnostics deleted_signals = row_count;
  with doomed as (select id from private.data_observatory_context_items where retention_expires_at < now() order by retention_expires_at limit least(greatest(limit_count,1),2000))
  delete from private.data_observatory_context_items c using doomed d where c.id=d.id;
  get diagnostics deleted_context = row_count;
  -- La única excepción a la inmutabilidad es una purga explícita posterior a retention_expires_at.
  perform set_config('atinara.retention_purge','on',true);
  with doomed as (select id from private.market_source_snapshots where retention_expires_at < now() order by retention_expires_at limit least(greatest(limit_count,1),2000))
  delete from private.market_source_snapshots s using doomed d where s.id=d.id;
  get diagnostics deleted_snapshots = row_count;
  return jsonb_build_object('signals',deleted_signals,'context_items',deleted_context,'snapshots',deleted_snapshots);
end;
$function$;
revoke all on function public.purge_expired_observatory_provider_data(integer) from public, anon, authenticated;
grant execute on function public.purge_expired_observatory_provider_data(integer) to service_role;

comment on table private.data_observatory_signals is 'Señales privadas de Datos y tendencias. No reutiliza ni mezcla la caché de external_market_candidates del Radar v17.';
comment on table private.data_observatory_context_items is 'Hechos y contexto trazables. Las fuentes de contexto nunca resuelven por accidente.';
comment on table private.market_expert_runs is 'Dictámenes JSON validados, sin cadena de pensamiento, prompts ni secretos.';
comment on table private.market_expert_precedents is 'Solo el feedback promovido explícitamente puede convertirse en precedente activo; nunca cambia la política automáticamente.';
comment on table private.market_source_bindings is 'Plan de Resolución versionado. validated acredita contrato; armed acredita que el scheduler externo fue activado y el monitor está preparado.';
comment on table private.market_source_snapshots is 'Capturas inmutables. Un error o dato ausente nunca equivale a Sí, No o cero.';
comment on table private.market_resolution_evidence_packages is 'Expediente versionado para revisión humana. ready_to_resolve no ejecuta liquidación.';
comment on function private.assert_market_source_publication_ready(uuid) is 'Puerta autoritativa aditiva: no cambia borradores manuales sin binding; exige plan bloqueado y monitor armed cuando corresponda.';
comment on function public.get_due_context_discovery_entities(integer) is 'Scheduler editorial preparado y desactivado. Solo devuelve entidades para crear contexto e hipótesis privadas; nunca borradores, publicaciones o resoluciones.';

commit;
