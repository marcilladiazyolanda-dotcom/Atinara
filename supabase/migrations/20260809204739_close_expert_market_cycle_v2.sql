-- Cierra los fallos reproducidos el 9 de agosto de 2026 sin relajar la puerta
-- de publicacion ni tocar mercados, posiciones, economia o liquidaciones.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';

select pg_advisory_xact_lock(hashtextextended('atinara:expert-market-cycle-v2', 0));

create table if not exists private.market_issue_strategy_registry (
  code text primary key check (code ~ '^[A-Z][A-Z0-9_]{2,99}$'),
  phase text not null check (phase in ('radar', 'editor', 'validator', 'corrector', 'publication')),
  severity text not null check (severity in ('info', 'warning', 'blocking')),
  disposition text not null check (disposition in (
    'auto_repair', 'auto_recover', 'technical_retry', 'terminal_block',
    'human_decision', 'internal_defect', 'derived'
  )),
  strategy_key text not null check (strategy_key ~ '^[a-z][a-z0-9_]{2,99}$'),
  affected_fields jsonb not null default '[]'::jsonb
    check (jsonb_typeof(affected_fields) = 'array'),
  invariants jsonb not null default '[]'::jsonb
    check (jsonb_typeof(invariants) = 'array'),
  evidence_required jsonb not null default '[]'::jsonb
    check (jsonb_typeof(evidence_required) = 'array'),
  expected_result jsonb not null default '{}'::jsonb
    check (jsonb_typeof(expected_result) = 'object'),
  policy_version text not null,
  schema_version text not null,
  active boolean not null default true,
  updated_at timestamptz not null default now()
);

alter table private.market_issue_strategy_registry enable row level security;
alter table private.market_issue_strategy_registry force row level security;
revoke all on table private.market_issue_strategy_registry
  from public, anon, authenticated, service_role;
grant all on table private.market_issue_strategy_registry to postgres, service_role;

with issue_values(code, phase, severity, disposition, strategy_key, affected_fields) as (
  values
    ('QUESTION_REQUIRED', 'validator', 'blocking', 'auto_repair', 'rebuild_binary_question', '["question"]'::jsonb),
    ('QUESTION_AMBIGUOUS_TERM', 'validator', 'blocking', 'auto_repair', 'rebuild_binary_question', '["question"]'::jsonb),
    ('INVALID_QUESTION', 'validator', 'blocking', 'auto_repair', 'rebuild_binary_question', '["question"]'::jsonb),
    ('SUBJECT_REQUIRED', 'validator', 'blocking', 'auto_repair', 'infer_canonical_subject', '["subject","question"]'::jsonb),
    ('AMBIGUOUS_SUBJECT', 'validator', 'blocking', 'auto_repair', 'infer_or_escalate_subject', '["subject","question","yes_criteria"]'::jsonb),
    ('CATEGORY_REQUIRED', 'validator', 'blocking', 'auto_repair', 'infer_category', '["category"]'::jsonb),
    ('OPTIONS_NOT_BINARY', 'validator', 'blocking', 'auto_repair', 'normalize_binary_options', '["yes_option","no_option"]'::jsonb),
    ('NON_BINARY_OPTIONS', 'validator', 'blocking', 'auto_repair', 'normalize_binary_options', '["yes_option","no_option"]'::jsonb),
    ('PERIOD_REQUIRED', 'validator', 'blocking', 'auto_repair', 'derive_evaluation_period', '["evaluation_period_label","evaluation_ends_at","closes_at"]'::jsonb),
    ('TEMPORAL_CONTRADICTION', 'validator', 'blocking', 'auto_repair', 'synchronize_temporal_fields', '["evaluation_ends_at","closes_at"]'::jsonb),
    ('TEMPORAL_INCOHERENCE', 'validator', 'blocking', 'auto_repair', 'derive_or_escalate_temporal_contract', '["evaluation_period_label","evaluation_ends_at","closes_at","resolution_deadline","timezone"]'::jsonb),
    ('TIMEZONE_INVALID', 'validator', 'blocking', 'auto_repair', 'normalize_iana_timezone', '["timezone"]'::jsonb),
    ('INVALID_TIMEZONE', 'validator', 'blocking', 'auto_repair', 'normalize_iana_timezone', '["timezone"]'::jsonb),
    ('RESOLUTION_DEADLINE_INVALID', 'validator', 'blocking', 'auto_repair', 'derive_resolution_deadline', '["resolution_deadline"]'::jsonb),
    ('YES_CRITERIA_REQUIRED', 'validator', 'blocking', 'auto_repair', 'rebuild_resolution_criteria', '["yes_criteria"]'::jsonb),
    ('NO_CRITERIA_REQUIRED', 'validator', 'blocking', 'auto_repair', 'rebuild_resolution_criteria', '["no_criteria"]'::jsonb),
    ('MISSING_NO_CRITERIA', 'validator', 'blocking', 'auto_repair', 'rebuild_resolution_criteria', '["no_criteria"]'::jsonb),
    ('OPTIONS_OVERLAP', 'validator', 'blocking', 'auto_repair', 'rebuild_resolution_criteria', '["yes_criteria","no_criteria"]'::jsonb),
    ('AMBIGUOUS_CRITERIA', 'validator', 'blocking', 'auto_repair', 'rebuild_or_escalate_criteria', '["question","yes_criteria","no_criteria","public_criteria","edge_cases"]'::jsonb),
    ('CONTRADICTORY_CRITERIA', 'validator', 'blocking', 'auto_repair', 'rebuild_or_escalate_criteria', '["question","yes_criteria","no_criteria","public_criteria"]'::jsonb),
    ('EDGE_CASES_REQUIRED', 'validator', 'blocking', 'auto_repair', 'derive_edge_cases', '["edge_cases"]'::jsonb),
    ('MISSING_EDGE_CASES', 'validator', 'blocking', 'auto_repair', 'derive_edge_cases', '["edge_cases"]'::jsonb),
    ('PUBLIC_CRITERIA_REQUIRED', 'validator', 'blocking', 'auto_repair', 'derive_public_criteria', '["public_criteria"]'::jsonb),
    ('MISSING_PUBLIC_CRITERIA', 'validator', 'blocking', 'auto_repair', 'derive_public_criteria', '["public_criteria"]'::jsonb),
    ('PRIMARY_SOURCE_INVALID', 'validator', 'blocking', 'auto_repair', 'research_registered_primary', '["primary_source"]'::jsonb),
    ('RESOLUTION_PRIMARY_SOURCE_REQUIRED', 'validator', 'blocking', 'auto_repair', 'research_registered_primary', '["primary_source"]'::jsonb),
    ('MISSING_RESOLUTION_SOURCE', 'validator', 'blocking', 'auto_repair', 'research_registered_primary', '["primary_source","alternative_sources"]'::jsonb),
    ('ALTERNATIVE_SOURCE_REQUIRED', 'validator', 'blocking', 'auto_repair', 'research_corroboration', '["alternative_sources"]'::jsonb),
    ('ALTERNATIVE_SOURCE_INVALID', 'validator', 'blocking', 'auto_repair', 'research_corroboration', '["alternative_sources"]'::jsonb),
    ('INVALID_METRIC', 'validator', 'blocking', 'auto_repair', 'infer_metric_contract', '["metric","question","yes_criteria"]'::jsonb),
    ('UNRESOLVABLE_CONTRACT', 'validator', 'blocking', 'auto_repair', 'rebuild_or_escalate_contract', '["question","yes_criteria","no_criteria","primary_source"]'::jsonb),
    ('RADAR_FACTUAL_VERIFICATION_REQUIRED', 'editor', 'blocking', 'auto_recover', 'refresh_factual_dossier', '["factual_dossier"]'::jsonb),
    ('RADAR_NORMALIZER_OUTDATED', 'editor', 'blocking', 'auto_recover', 'refresh_normalized_candidate', '["normalized_payload"]'::jsonb),
    ('RADAR_ELIGIBILITY_POLICY_OUTDATED', 'editor', 'blocking', 'auto_recover', 'refresh_factual_dossier', '["factual_dossier"]'::jsonb),
    ('RADAR_RESOLUTION_SOURCE_REQUIRED', 'editor', 'blocking', 'auto_recover', 'research_registered_primary', '["factual_dossier"]'::jsonb),
    ('MARKET_EXPERT_ANALYSIS_STALE', 'editor', 'warning', 'auto_recover', 'reanalyze_current_revision', '[]'::jsonb),
    ('RADAR_CANDIDATE_NOT_PREPARABLE', 'editor', 'info', 'derived', 'suppress_when_causal_root_exists', '[]'::jsonb),
    ('DETERMINISTIC_GATE_BLOCKED', 'editor', 'info', 'derived', 'suppress_when_causal_root_exists', '[]'::jsonb),
    ('INTEGRITY_FAILED', 'editor', 'info', 'derived', 'suppress_when_causal_root_exists', '[]'::jsonb),
    ('FORECASTABILITY_CLOSED', 'editor', 'info', 'derived', 'suppress_when_causal_root_exists', '[]'::jsonb),
    ('EXPERT_DECISION_BLOCKED', 'editor', 'info', 'derived', 'suppress_when_causal_root_exists', '[]'::jsonb),
    ('EVENT_ALREADY_RESOLVED', 'radar', 'blocking', 'terminal_block', 'quarantine_terminal_fact', '["factual_dossier"]'::jsonb),
    ('RADAR_CANDIDATE_RESOLVED', 'radar', 'blocking', 'terminal_block', 'quarantine_terminal_fact', '["factual_dossier"]'::jsonb),
    ('TEMPORAL_WINDOW_ALREADY_ENDED', 'radar', 'blocking', 'terminal_block', 'quarantine_terminal_fact', '["evaluation_ends_at"]'::jsonb),
    ('SOURCE_ALREADY_RESOLVED', 'radar', 'blocking', 'terminal_block', 'quarantine_terminal_fact', '["primary_source"]'::jsonb),
    ('SOURCE_NOT_RESOLVABLE', 'editor', 'blocking', 'terminal_block', 'quarantine_unresolvable_contract', '["primary_source"]'::jsonb),
    ('DUPLICATE_MARKET', 'editor', 'blocking', 'terminal_block', 'block_exact_duplicate', '["family_key","family_child_key"]'::jsonb),
    ('CONFIRMED_DUPLICATE', 'radar', 'blocking', 'terminal_block', 'block_exact_duplicate', '["family_key","family_child_key"]'::jsonb),
    ('RADAR_CONFIRMED_DUPLICATE', 'radar', 'blocking', 'terminal_block', 'block_exact_duplicate', '["family_key","family_child_key"]'::jsonb),
    ('PROVIDER_RATE_LIMITED', 'radar', 'warning', 'technical_retry', 'retry_after_backoff', '[]'::jsonb),
    ('PROVIDER_TIMEOUT', 'radar', 'warning', 'technical_retry', 'bounded_retry_backoff', '[]'::jsonb),
    ('PROVIDER_HTTP_5XX', 'radar', 'warning', 'technical_retry', 'bounded_retry_backoff', '[]'::jsonb),
    ('PROVIDER_NETWORK_ERROR', 'radar', 'warning', 'technical_retry', 'bounded_retry_backoff', '[]'::jsonb),
    ('PROVIDER_INVALID_RESPONSE', 'radar', 'warning', 'technical_retry', 'preserve_last_known_good', '[]'::jsonb),
    ('PROVIDER_INVALID_ENVELOPE', 'validator', 'warning', 'technical_retry', 'preserve_effective_review_and_retry', '[]'::jsonb),
    ('AUTOMATIC_RESPONSE_INVALID', 'validator', 'warning', 'technical_retry', 'preserve_effective_review_and_retry', '[]'::jsonb),
    ('PROVIDER_UNAVAILABLE', 'radar', 'warning', 'technical_retry', 'preserve_last_known_good', '[]'::jsonb),
    ('PROVIDER_HTTP_ERROR', 'radar', 'warning', 'technical_retry', 'bounded_retry_backoff', '[]'::jsonb),
    ('PROVIDER_AUTH_ERROR', 'radar', 'blocking', 'internal_defect', 'surface_provider_configuration_defect', '[]'::jsonb),
    ('RADAR_PERSISTENCE_FAILED', 'radar', 'warning', 'technical_retry', 'isolate_and_retry_batch', '[]'::jsonb),
    ('RADAR_PERSISTENCE_TIMEOUT', 'radar', 'warning', 'technical_retry', 'isolate_and_retry_batch', '[]'::jsonb),
    ('AUTOMATIC_REVIEW_INCONCLUSIVE', 'validator', 'warning', 'technical_retry', 'retry_semantic_review', '[]'::jsonb),
    ('INSUFFICIENT_EVIDENCE', 'validator', 'blocking', 'auto_repair', 'research_registered_sources', '["primary_source","alternative_sources"]'::jsonb),
    ('DRAFT_VERSION_MOVED', 'corrector', 'warning', 'technical_retry', 'reload_authoritative_version', '[]'::jsonb),
    ('DRAFT_REPAIR_NOT_APPLICABLE', 'corrector', 'blocking', 'internal_defect', 'surface_missing_repair_strategy', '[]'::jsonb),
    ('SAFE_REPAIR_VALIDATION_FAILED', 'corrector', 'blocking', 'internal_defect', 'surface_invalid_repair_strategy', '[]'::jsonb),
    ('CONFLICTING_AUTHORITATIVE_SOURCES', 'validator', 'blocking', 'human_decision', 'request_specific_source_decision', '["primary_source","alternative_sources"]'::jsonb),
    ('CONTRACT_INTERPRETATION_AMBIGUOUS', 'validator', 'blocking', 'human_decision', 'request_specific_contract_decision', '["question","yes_criteria","no_criteria"]'::jsonb),
    ('MATERIAL_MEANING_CHANGE_REQUIRED', 'corrector', 'blocking', 'human_decision', 'request_specific_editorial_decision', '["market_definition"]'::jsonb)
)
insert into private.market_issue_strategy_registry(
  code, phase, severity, disposition, strategy_key, affected_fields,
  invariants, evidence_required, expected_result, policy_version, schema_version
)
select
  code, phase, severity, disposition, strategy_key, affected_fields,
  '["preserve_contract_meaning","preserve_private_state","never_confirm_or_publish"]'::jsonb,
  case
    when disposition in ('auto_repair', 'auto_recover', 'terminal_block', 'human_decision')
      then '["authoritative_version","content_fingerprint","dated_source_evidence"]'::jsonb
    else '[]'::jsonb
  end,
  jsonb_build_object(
    'draft_private', true,
    'requires_revalidation', disposition in ('auto_repair', 'auto_recover'),
    'human_confirmation_required', true
  ),
  'atinara-expert-cycle-policy-v2',
  'atinara-market-issue-contract-v1'
from issue_values
on conflict (code) do update set
  phase = excluded.phase,
  severity = excluded.severity,
  disposition = excluded.disposition,
  strategy_key = excluded.strategy_key,
  affected_fields = excluded.affected_fields,
  invariants = excluded.invariants,
  evidence_required = excluded.evidence_required,
  expected_result = excluded.expected_result,
  policy_version = excluded.policy_version,
  schema_version = excluded.schema_version,
  active = true,
  updated_at = now();

create or replace function public.get_market_issue_strategy_registry_v1()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if auth.role() <> 'service_role' then
    perform private.require_current_admin();
  end if;
  return coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'code', strategy.code,
        'phase', strategy.phase,
        'severity', strategy.severity,
        'disposition', strategy.disposition,
        'strategy_key', strategy.strategy_key,
        'affected_fields', strategy.affected_fields,
        'invariants', strategy.invariants,
        'evidence_required', strategy.evidence_required,
        'expected_result', strategy.expected_result,
        'policy_version', strategy.policy_version,
        'schema_version', strategy.schema_version
      ) order by strategy.code
    )
    from private.market_issue_strategy_registry strategy
    where strategy.active
  ), '[]'::jsonb);
end;
$function$;

revoke all on function public.get_market_issue_strategy_registry_v1()
  from public, anon, authenticated, service_role;
grant execute on function public.get_market_issue_strategy_registry_v1()
  to authenticated, service_role;

create or replace function public.get_market_draft_expert_repair_context(draft_id_input uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  payload_value jsonb;
  deterministic_value jsonb;
  semantic_value jsonb := '[]'::jsonb;
  content_issues_value jsonb;
  repairable_value jsonb := '[]'::jsonb;
  terminal_value jsonb := '[]'::jsonb;
  human_value jsonb := '[]'::jsonb;
  unclassified_value jsonb := '[]'::jsonb;
  issue_contracts_value jsonb := '[]'::jsonb;
  candidate_value jsonb;
  review_value jsonb;
  review_compatible_value boolean := false;
  review_validator_value text;
  technical_value jsonb;
begin
  perform private.require_current_admin();
  payload_value := public.get_admin_market_draft(draft_id_input);
  deterministic_value := coalesce(payload_value -> 'deterministic_issues', '[]'::jsonb);
  review_value := payload_value -> 'latest_review';
  review_validator_value := review_value ->> 'validator_version';
  review_compatible_value := coalesce(
    jsonb_typeof(review_value) = 'object'
      and review_validator_value in ('atinara-market-gate-v3', 'step13.4-deterministic-v3')
      and review_value ->> 'policy_version' = 'atinara-market-review-policy-v3'
      and review_value ->> 'schema_version' = 'atinara-market-draft-schema-v3'
      and review_value ->> 'draft_version' = payload_value -> 'draft' ->> 'content_version'
      and review_value ->> 'content_fingerprint' = payload_value -> 'draft' ->> 'content_fingerprint',
    false
  );

  if review_compatible_value and review_validator_value = 'atinara-market-gate-v3' then
    semantic_value := coalesce(review_value -> 'semantic_issues', '[]'::jsonb);
  end if;
  content_issues_value := deterministic_value || semantic_value;

  select
    coalesce(jsonb_agg(issue_item order by issue_ordinality)
      filter (where strategy.disposition = 'auto_repair'), '[]'::jsonb),
    coalesce(jsonb_agg(issue_item order by issue_ordinality)
      filter (where strategy.disposition = 'terminal_block'), '[]'::jsonb),
    coalesce(jsonb_agg(issue_item order by issue_ordinality)
      filter (where strategy.disposition = 'human_decision'), '[]'::jsonb),
    coalesce(jsonb_agg(issue_item order by issue_ordinality)
      filter (where strategy.code is null), '[]'::jsonb),
    coalesce(jsonb_agg(
      jsonb_build_object(
        'code', issue_item ->> 'code',
        'field', issue_item ->> 'field',
        'severity', strategy.severity,
        'disposition', strategy.disposition,
        'strategy_key', strategy.strategy_key,
        'invariants', strategy.invariants,
        'evidence_required', strategy.evidence_required,
        'expected_result', strategy.expected_result,
        'policy_version', strategy.policy_version,
        'schema_version', strategy.schema_version
      ) order by issue_ordinality
    ) filter (where strategy.code is not null), '[]'::jsonb)
  into repairable_value, terminal_value, human_value, unclassified_value, issue_contracts_value
  from jsonb_array_elements(content_issues_value) with ordinality issues(issue_item, issue_ordinality)
  left join private.market_issue_strategy_registry strategy
    on strategy.code = issues.issue_item ->> 'code'
   and strategy.active;

  select private.market_radar_safe_payload(candidate_alias) into candidate_value
  from private.external_market_candidates candidate_alias
  join private.market_drafts draft_alias on draft_alias.radar_candidate_id = candidate_alias.id
  where draft_alias.id = draft_id_input;

  technical_value := case
    when payload_value -> 'latest_attempt' ->> 'classification' = 'technical'
    then payload_value -> 'latest_attempt'
    else null
  end;

  return payload_value || jsonb_build_object(
    'radar_candidate', candidate_value,
    'repairable_content_issues', repairable_value,
    'terminal_content_issues', terminal_value,
    'human_decision_issues', human_value,
    'unclassified_content_issues', unclassified_value,
    'issue_contracts', issue_contracts_value,
    'issue_contract_policy', 'atinara-expert-cycle-policy-v2',
    'issue_contract_schema', 'atinara-market-issue-contract-v1',
    'review_compatible', review_compatible_value,
    'review_refresh_required', not review_compatible_value,
    'stale_review', case
      when coalesce(jsonb_typeof(review_value), 'null') <> 'object' or review_compatible_value
      then null else
      jsonb_build_object(
        'id', review_value -> 'id',
        'validator_version', review_value -> 'validator_version',
        'policy_version', review_value -> 'policy_version',
        'schema_version', review_value -> 'schema_version',
        'created_at', review_value -> 'created_at'
      )
    end,
    'repair_applicable', review_compatible_value
      and technical_value is null
      and jsonb_array_length(repairable_value) > 0
      and jsonb_array_length(terminal_value) = 0
      and jsonb_array_length(human_value) = 0
      and jsonb_array_length(unclassified_value) = 0,
    'technical_incident', technical_value
  );
end;
$function$;

revoke all on function public.get_market_draft_expert_repair_context(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.get_market_draft_expert_repair_context(uuid)
  to authenticated;

alter table private.market_radar_provider_runs
  add column if not exists accepted_count integer not null default 0 check (accepted_count >= 0),
  add column if not exists discarded_count integer not null default 0 check (discarded_count >= 0),
  add column if not exists quarantined_count integer not null default 0 check (quarantined_count >= 0),
  add column if not exists failed_count integer not null default 0 check (failed_count >= 0),
  add column if not exists last_success_at timestamptz,
  add column if not exists last_success_count integer not null default 0 check (last_success_count >= 0),
  add column if not exists retry_after_at timestamptz,
  add column if not exists circuit_state text not null default 'closed'
    check (circuit_state in ('closed', 'open', 'half_open'));

alter table private.market_radar_provider_run_history
  drop constraint if exists market_radar_provider_run_history_status_check;
alter table private.market_radar_provider_run_history
  add constraint market_radar_provider_run_history_status_check
  check (status in ('available', 'partial_error', 'unavailable', 'rate_limited'));
alter table private.market_radar_provider_run_history
  add column if not exists accepted_count integer not null default 0 check (accepted_count >= 0),
  add column if not exists discarded_count integer not null default 0 check (discarded_count >= 0),
  add column if not exists quarantined_count integer not null default 0 check (quarantined_count >= 0),
  add column if not exists failed_count integer not null default 0 check (failed_count >= 0),
  add column if not exists last_success_at timestamptz,
  add column if not exists last_success_count integer not null default 0 check (last_success_count >= 0),
  add column if not exists retry_after_at timestamptz,
  add column if not exists circuit_state text not null default 'closed'
    check (circuit_state in ('closed', 'open', 'half_open'));

create or replace function public.finalize_market_radar_provider_refresh_v2(
  provider_input text,
  cache_key_input text,
  status_input text,
  result_count_input integer,
  accepted_count_input integer default 0,
  discarded_count_input integer default 0,
  quarantined_count_input integer default 0,
  failed_count_input integer default 0,
  error_code_input text default null,
  error_message_input text default null,
  retry_after_seconds_input integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  history_id_value bigint;
  previous_run private.market_radar_provider_runs%rowtype;
  safe_error_code text;
  safe_error_message text;
  retry_after_value timestamptz;
  last_success_at_value timestamptz;
  last_success_count_value integer;
  circuit_state_value text;
begin
  if auth.role() <> 'service_role' then
    raise exception 'SERVICE_ROLE_REQUIRED' using errcode = '42501';
  end if;
  if provider_input not in ('polymarket', 'kalshi', 'tavily', 'gemini')
     or nullif(trim(cache_key_input), '') is null
     or status_input not in ('available', 'partial_error', 'unavailable', 'rate_limited')
     or result_count_input is null or result_count_input < 0 or result_count_input > 240
     or accepted_count_input is null or accepted_count_input < 0 or accepted_count_input > 240
     or discarded_count_input is null or discarded_count_input < 0 or discarded_count_input > 240
     or quarantined_count_input is null or quarantined_count_input < 0 or quarantined_count_input > 240
     or failed_count_input is null or failed_count_input < 0 or failed_count_input > 240
     or retry_after_seconds_input is not null
       and (retry_after_seconds_input < 0 or retry_after_seconds_input > 86400) then
    raise exception 'INVALID_RADAR_PROVIDER_REFRESH' using errcode = '22023';
  end if;
  if status_input = 'available' and (error_code_input is not null or error_message_input is not null) then
    raise exception 'INVALID_RADAR_PROVIDER_REFRESH' using errcode = '22023';
  end if;

  select * into previous_run
  from private.market_radar_provider_runs run_alias
  where run_alias.provider = provider_input
    and run_alias.cache_key = left(cache_key_input, 180);

  safe_error_code := case when status_input = 'available'
    then null else nullif(left(trim(error_code_input), 80), '') end;
  safe_error_message := case when status_input = 'available'
    then null else nullif(left(trim(error_message_input), 300), '') end;
  retry_after_value := case
    when status_input = 'rate_limited'
      then now() + make_interval(secs => coalesce(retry_after_seconds_input, 60))
    else null
  end;
  last_success_at_value := case when status_input = 'available'
    then now() else previous_run.last_success_at end;
  last_success_count_value := case when status_input = 'available'
    then result_count_input else coalesce(previous_run.last_success_count, 0) end;
  circuit_state_value := case when status_input = 'rate_limited'
    then 'open' when status_input = 'available' then 'closed' else 'half_open' end;

  insert into private.market_radar_provider_run_history(
    provider, cache_key, status, result_count, error_code, error_message,
    accepted_count, discarded_count, quarantined_count, failed_count,
    last_success_at, last_success_count, retry_after_at, circuit_state
  ) values (
    provider_input, left(cache_key_input, 180), status_input, result_count_input,
    safe_error_code, safe_error_message, accepted_count_input, discarded_count_input,
    quarantined_count_input, failed_count_input, last_success_at_value,
    last_success_count_value, retry_after_value, circuit_state_value
  ) returning id into history_id_value;

  insert into private.market_radar_provider_runs(
    provider, cache_key, status, result_count, is_cached, error_code,
    error_message, fetched_at, expires_at, updated_at, accepted_count,
    discarded_count, quarantined_count, failed_count, last_success_at,
    last_success_count, retry_after_at, circuit_state
  ) values (
    provider_input, left(cache_key_input, 180), status_input, result_count_input,
    false, safe_error_code, safe_error_message, now(),
    now() + case when status_input = 'available' then interval '20 minutes' else interval '5 minutes' end,
    now(), accepted_count_input, discarded_count_input, quarantined_count_input,
    failed_count_input, last_success_at_value, last_success_count_value,
    retry_after_value, circuit_state_value
  )
  on conflict (provider, cache_key) do update set
    status = excluded.status,
    result_count = excluded.result_count,
    is_cached = false,
    error_code = excluded.error_code,
    error_message = excluded.error_message,
    fetched_at = excluded.fetched_at,
    expires_at = excluded.expires_at,
    updated_at = excluded.updated_at,
    accepted_count = excluded.accepted_count,
    discarded_count = excluded.discarded_count,
    quarantined_count = excluded.quarantined_count,
    failed_count = excluded.failed_count,
    last_success_at = excluded.last_success_at,
    last_success_count = excluded.last_success_count,
    retry_after_at = excluded.retry_after_at,
    circuit_state = excluded.circuit_state;

  return jsonb_build_object(
    'ok', true,
    'history_id', history_id_value,
    'provider', provider_input,
    'status', status_input,
    'operational_status', status_input,
    'quality_status', case
      when discarded_count_input > 0 or quarantined_count_input > 0
        then 'available_with_discards'
      else 'clean' end,
    'result_count', result_count_input,
    'accepted_count', accepted_count_input,
    'discarded_count', discarded_count_input,
    'quarantined_count', quarantined_count_input,
    'failed_count', failed_count_input,
    'last_success_at', last_success_at_value,
    'last_success_count', last_success_count_value,
    'retry_after_at', retry_after_value,
    'circuit_state', circuit_state_value
  );
end;
$function$;

revoke all on function public.finalize_market_radar_provider_refresh_v2(
  text,text,text,integer,integer,integer,integer,integer,text,text,integer
) from public, anon, authenticated, service_role;
grant execute on function public.finalize_market_radar_provider_refresh_v2(
  text,text,text,integer,integer,integer,integer,integer,text,text,integer
) to service_role;

create table if not exists private.market_repair_attempts (
  id uuid primary key default gen_random_uuid(),
  request_key uuid not null,
  actor_id uuid not null references auth.users(id),
  draft_id uuid not null references private.market_drafts(id),
  expected_version bigint not null check (expected_version > 0),
  expected_fingerprint text not null check (expected_fingerprint ~ '^[0-9a-f]{64}$'),
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  issue_codes jsonb not null default '[]'::jsonb check (jsonb_typeof(issue_codes) = 'array'),
  status text not null default 'in_progress' check (status in (
    'in_progress', 'succeeded', 'no_op', 'blocked', 'technical_failed', 'internal_defect'
  )),
  phase text not null default 'preflight' check (phase in (
    'preflight', 'research', 'patch_validation', 'persistence', 'revalidation', 'complete'
  )),
  classification text check (classification in ('content', 'technical', 'internal')),
  retryable boolean not null default false,
  error_code text,
  patch_fingerprint text,
  resulting_version bigint,
  resulting_fingerprint text,
  state_preserved boolean not null default true,
  response_payload jsonb check (response_payload is null or jsonb_typeof(response_payload) = 'object'),
  started_at timestamptz not null default now(),
  lease_expires_at timestamptz not null default now() + interval '3 minutes',
  completed_at timestamptz,
  unique (actor_id, draft_id, request_key)
);

create index if not exists market_repair_attempts_draft_time_idx
  on private.market_repair_attempts(draft_id, started_at desc);
alter table private.market_repair_attempts enable row level security;
alter table private.market_repair_attempts force row level security;
revoke all on table private.market_repair_attempts
  from public, anon, authenticated, service_role;
grant all on table private.market_repair_attempts to postgres, service_role;

create or replace function public.begin_market_draft_repair_attempt_v1(
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
  actor_id_value uuid := private.require_current_admin();
  draft_row private.market_drafts%rowtype;
  attempt_row private.market_repair_attempts%rowtype;
  context_value jsonb;
  request_hash_value text;
  issue_codes_value jsonb;
begin
  if draft_id_input is null or expected_version_input is null
     or expected_version_input < 1 or request_key_input is null then
    raise exception 'INVALID_REPAIR_REQUEST' using errcode = '22023';
  end if;
  select * into draft_row from private.market_drafts
  where id = draft_id_input for update;
  if not found then raise exception 'DRAFT_NOT_FOUND' using errcode = 'P0001'; end if;
  if draft_row.content_version <> expected_version_input then
    raise exception 'DRAFT_VERSION_MOVED' using errcode = '40001';
  end if;
  context_value := public.get_market_draft_expert_repair_context(draft_id_input);
  issue_codes_value := coalesce((
    select jsonb_agg(distinct issue ->> 'code' order by issue ->> 'code')
    from jsonb_array_elements(coalesce(context_value -> 'repairable_content_issues', '[]'::jsonb)) issue
  ), '[]'::jsonb);
  request_hash_value := encode(extensions.digest(convert_to(jsonb_build_object(
    'draft_id', draft_id_input,
    'expected_version', expected_version_input,
    'expected_fingerprint', draft_row.content_fingerprint,
    'issue_codes', issue_codes_value,
    'policy', 'atinara-expert-cycle-policy-v2'
  )::text, 'UTF8'), 'sha256'), 'hex');

  insert into private.market_repair_attempts(
    request_key, actor_id, draft_id, expected_version, expected_fingerprint,
    request_hash, issue_codes
  ) values (
    request_key_input, actor_id_value, draft_id_input, expected_version_input,
    draft_row.content_fingerprint, request_hash_value, issue_codes_value
  )
  on conflict (actor_id, draft_id, request_key) do nothing
  returning * into attempt_row;

  if attempt_row.id is null then
    select * into attempt_row from private.market_repair_attempts
    where actor_id = actor_id_value and draft_id = draft_id_input
      and request_key = request_key_input for update;
    if attempt_row.request_hash is distinct from request_hash_value then
      raise exception 'IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD' using errcode = '22023';
    end if;
    if attempt_row.response_payload is not null then
      return attempt_row.response_payload || jsonb_build_object(
        'attempt_id', attempt_row.id,
        'idempotency_replay', true,
        'state_preserved', attempt_row.state_preserved
      );
    end if;
    if attempt_row.lease_expires_at > now() then
      return jsonb_build_object(
        'ok', true,
        'status', 'already_in_progress',
        'attempt_id', attempt_row.id,
        'idempotency_replay', true,
        'retryable', true,
        'state_preserved', true
      );
    end if;
    update private.market_repair_attempts set
      lease_expires_at = now() + interval '3 minutes',
      started_at = now(),
      phase = 'preflight'
    where id = attempt_row.id returning * into attempt_row;
  end if;

  return jsonb_build_object(
    'ok', true,
    'status', 'started',
    'attempt_id', attempt_row.id,
    'request_key', request_key_input,
    'expected_version', attempt_row.expected_version,
    'expected_fingerprint', attempt_row.expected_fingerprint,
    'issue_codes', attempt_row.issue_codes,
    'idempotency_replay', false,
    'state_preserved', true
  );
end;
$function$;

revoke all on function public.begin_market_draft_repair_attempt_v1(uuid,bigint,uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.begin_market_draft_repair_attempt_v1(uuid,bigint,uuid)
  to authenticated;

create or replace function public.complete_market_draft_repair_attempt_v1(
  attempt_id_input uuid,
  status_input text,
  phase_input text,
  classification_input text,
  retryable_input boolean,
  error_code_input text,
  patch_fingerprint_input text,
  resulting_version_input bigint,
  resulting_fingerprint_input text,
  response_payload_input jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  attempt_row private.market_repair_attempts%rowtype;
  safe_payload jsonb;
  completed_now boolean := false;
begin
  if auth.role() <> 'service_role' then
    raise exception 'SERVICE_ROLE_REQUIRED' using errcode = '42501';
  end if;
  if status_input not in ('succeeded', 'no_op', 'blocked', 'technical_failed', 'internal_defect')
     or phase_input not in ('preflight', 'research', 'patch_validation', 'persistence', 'revalidation', 'complete')
     or classification_input not in ('content', 'technical', 'internal')
     or jsonb_typeof(coalesce(response_payload_input, 'null'::jsonb)) is distinct from 'object'
     or octet_length(response_payload_input::text) > 65536 then
    raise exception 'INVALID_REPAIR_ATTEMPT_RESULT' using errcode = '22023';
  end if;
  safe_payload := response_payload_input
    - 'stack' - 'sql' - 'query' - 'token' - 'authorization' - 'service_role';
  update private.market_repair_attempts set
    status = status_input,
    phase = phase_input,
    classification = classification_input,
    retryable = coalesce(retryable_input, false),
    error_code = nullif(left(trim(error_code_input), 100), ''),
    patch_fingerprint = case when coalesce(patch_fingerprint_input, '') ~ '^[0-9a-f]{64}$'
      then patch_fingerprint_input else null end,
    resulting_version = resulting_version_input,
    resulting_fingerprint = case when coalesce(resulting_fingerprint_input, '') ~ '^[0-9a-f]{64}$'
      then resulting_fingerprint_input else null end,
    state_preserved = coalesce((safe_payload ->> 'state_preserved')::boolean, true),
    response_payload = safe_payload,
    completed_at = now(),
    lease_expires_at = now()
  where id = attempt_id_input and response_payload is null
  returning * into attempt_row;
  completed_now := found;
  if not found then
    select * into attempt_row from private.market_repair_attempts where id = attempt_id_input;
  end if;
  if attempt_row.id is null then
    raise exception 'REPAIR_ATTEMPT_NOT_FOUND' using errcode = 'P0001';
  end if;
  if completed_now then
    insert into private.market_admin_audit(actor_id, action_code, draft_id, draft_version, detail)
    values (
      attempt_row.actor_id,
      case when attempt_row.status in ('succeeded', 'no_op')
        then 'EXPERT_REPAIR_ATTEMPT_COMPLETED'
        when attempt_row.status = 'technical_failed' then 'EXPERT_REPAIR_TECHNICAL_FAILED'
        else 'EXPERT_REPAIR_ATTEMPT_BLOCKED' end,
      attempt_row.draft_id,
      coalesce(attempt_row.resulting_version, attempt_row.expected_version),
      jsonb_build_object(
        'attempt_id', attempt_row.id,
        'request_key', attempt_row.request_key,
        'status', attempt_row.status,
        'phase', attempt_row.phase,
        'classification', attempt_row.classification,
        'retryable', attempt_row.retryable,
        'error_code', attempt_row.error_code,
        'expected_fingerprint', attempt_row.expected_fingerprint,
        'resulting_fingerprint', attempt_row.resulting_fingerprint,
        'patch_fingerprint', attempt_row.patch_fingerprint,
        'issue_codes', attempt_row.issue_codes,
        'state_preserved', attempt_row.state_preserved,
        'publishes', false,
        'confirms', false,
        'resolves', false
      )
    );
  end if;
  return safe_payload || jsonb_build_object(
    'attempt_id', attempt_row.id,
    'idempotency_replay', not completed_now,
    'state_preserved', attempt_row.state_preserved
  );
end;
$function$;

revoke all on function public.complete_market_draft_repair_attempt_v1(
  uuid,text,text,text,boolean,text,text,bigint,text,jsonb
) from public, anon, authenticated, service_role;
grant execute on function public.complete_market_draft_repair_attempt_v1(
  uuid,text,text,text,boolean,text,text,bigint,text,jsonb
) to service_role;

create or replace function public.materialize_market_draft_for_repair_v1(
  candidate_id_input uuid,
  expected_preparation_revision_input bigint,
  expert_run_id_input uuid,
  draft_input jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor_id_value uuid := private.require_current_admin();
  candidate_row private.external_market_candidates%rowtype;
  run_row private.market_expert_runs%rowtype;
  result_value jsonb;
  saved_draft_id uuid;
  run_revision bigint;
  is_replay boolean := false;
begin
  if candidate_id_input is null or expected_preparation_revision_input is null
     or expert_run_id_input is null or jsonb_typeof(coalesce(draft_input, 'null'::jsonb)) <> 'object' then
    raise exception 'RADAR_REPAIR_DRAFT_INPUT_REQUIRED' using errcode = '22023';
  end if;
  select * into candidate_row
  from private.external_market_candidates candidate_alias
  where candidate_alias.id = candidate_id_input
  for update;
  if not found then
    raise exception 'RADAR_CANDIDATE_NOT_FOUND' using errcode = 'P0001';
  end if;
  select * into run_row
  from private.market_expert_runs run_alias
  where run_alias.id = expert_run_id_input
    and run_alias.origin_type = 'radar_candidate'
    and run_alias.origin_id = candidate_id_input::text
    and run_alias.status = 'completed';
  if not found then
    raise exception 'MARKET_EXPERT_ANALYSIS_REQUIRED' using errcode = '22023';
  end if;
  begin
    run_revision := nullif(run_row.result_json ->> 'origin_preparation_revision', '')::bigint;
  exception when invalid_text_representation then
    run_revision := null;
  end;
  if run_revision is distinct from expected_preparation_revision_input then
    raise exception 'RADAR_PREPARATION_REVISION_MISMATCH' using errcode = '40001';
  end if;
  if run_row.decision not in ('create', 'create_with_edits')
     or run_row.integrity_status not in ('pass', 'needs_edit')
     or run_row.forecastability_status not in ('forecastable', 'valid_low_probability', 'valid_very_unlikely')
     or jsonb_typeof(run_row.result_json -> 'draft_gate') <> 'object'
     or coalesce((run_row.result_json #>> '{draft_gate,can_materialize_private_repair_draft}')::boolean, false) is not true then
    raise exception 'MARKET_EXPERT_REPAIR_DRAFT_BLOCKED' using errcode = '22023';
  end if;
  if candidate_row.state = 'available' then
    if candidate_row.preparation_revision is distinct from expected_preparation_revision_input then
      raise exception 'RADAR_PREPARATION_REVISION_MISMATCH' using errcode = '40001';
    end if;
  elsif candidate_row.state = 'prepared'
        and candidate_row.preparation_revision = expected_preparation_revision_input + 1
        and candidate_row.prepared_draft_id is not null
        and exists (
          select 1 from private.market_drafts draft_alias
          where draft_alias.id = candidate_row.prepared_draft_id
            and draft_alias.source_provenance ->> 'expert_run_id' = expert_run_id_input::text
        ) then
    is_replay := true;
  else
    raise exception 'RADAR_PREPARATION_REVISION_MISMATCH' using errcode = '40001';
  end if;
  result_value := public.save_market_draft_from_radar(
    candidate_id_input,
    null,
    null,
    (draft_input - '_radar_preparation_revision') || jsonb_build_object(
      '_change_origin', 'radar_expert_repair_materialization',
      '_timestamp_precision', 'milliseconds-v1'
    )
  );
  saved_draft_id := (result_value #>> '{draft,id}')::uuid;
  update private.market_drafts set
    source_provenance = coalesce(source_provenance, '{}'::jsonb) || jsonb_build_object(
      'expert_run_id', expert_run_id_input,
      'expert_policy_version', run_row.policy_version,
      'expert_schema_version', run_row.schema_version,
      'materialization_mode', 'private_repair_v1'
    )
  where id = saved_draft_id;
  if not coalesce((result_value ->> 'idempotency_replay')::boolean, false) and not is_replay then
    insert into private.market_admin_audit(actor_id, action_code, draft_id, draft_version, detail)
    values (
      actor_id_value,
      'RADAR_REPAIR_DRAFT_MATERIALIZED',
      saved_draft_id,
      (result_value #>> '{draft,content_version}')::bigint,
      jsonb_build_object(
        'candidate_id', candidate_id_input,
        'expert_run_id', expert_run_id_input,
        'preparation_revision', expected_preparation_revision_input,
        'private', true,
        'requires_repair', true,
        'publishes', false,
        'confirms', false,
        'resolves', false
      )
    );
  end if;
  return result_value || jsonb_build_object(
    'materialization_mode', 'private_repair_v1',
    'expert_run_id', expert_run_id_input,
    'draft_private', true,
    'requires_repair', true,
    'published', false,
    'confirmed', false,
    'resolved', false
  );
end;
$function$;

revoke all on function public.materialize_market_draft_for_repair_v1(uuid,bigint,uuid,jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.materialize_market_draft_for_repair_v1(uuid,bigint,uuid,jsonb)
  to authenticated;

comment on table private.market_issue_strategy_registry is
  'Contrato versionado comun entre deteccion, reparacion, validacion y UX; los wrappers derivados nunca sustituyen una causa raiz.';
comment on function public.get_market_draft_expert_repair_context(uuid) is
  'Acepta la puerta completa v3 o su rechazo determinista v3 solo para la misma politica, esquema, version y huella.';
comment on function public.finalize_market_radar_provider_refresh_v2(text,text,text,integer,integer,integer,integer,integer,text,text,integer) is
  'Separa salud operativa de descartes de contenido y conserva last-known-good, Retry-After y circuito.';
comment on table private.market_repair_attempts is
  'Intentos tecnicos del Corrector separados de revisiones efectivas; idempotentes y sin autoridad de confirmacion o publicacion.';
comment on function public.materialize_market_draft_for_repair_v1(uuid,bigint,uuid,jsonb) is
  'Materializa de forma idempotente un borrador privado factualmente abierto que requiere reparacion; nunca confirma ni publica.';

commit;
