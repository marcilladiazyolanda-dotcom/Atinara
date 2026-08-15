-- Atinara Official Opportunity Discovery Idempotency V2.
-- Cierra en Postgres las carreras de doble envío antes de cualquier llamada
-- externa. No invoca modelos, no crea borradores y no modifica mercados.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';

alter table private.data_provider_runs
  add column if not exists request_id uuid,
  add column if not exists request_fingerprint text,
  add column if not exists requested_by uuid,
  add column if not exists lease_expires_at timestamptz,
  add column if not exists result_summary jsonb;

alter table private.data_provider_runs
  drop constraint if exists data_provider_runs_status_check;
alter table private.data_provider_runs
  add constraint data_provider_runs_status_check check (status in (
    'available', 'not_configured', 'cached', 'partial', 'failed',
    'rate_limited', 'quota_exhausted', 'in_progress', 'success',
    'zero_results', 'technical_failure'
  )) not valid;
alter table private.data_provider_runs
  validate constraint data_provider_runs_status_check;

alter table private.data_provider_runs
  add constraint data_provider_runs_request_identity_v2_check check (
    (request_id is null and request_fingerprint is null and requested_by is null)
    or (
      request_id is not null
      and request_fingerprint ~ '^[0-9a-f]{64}$'
      and requested_by is not null
    )
  ) not valid;
alter table private.data_provider_runs
  validate constraint data_provider_runs_request_identity_v2_check;

alter table private.data_provider_runs
  add constraint data_provider_runs_result_summary_v2_check check (
    result_summary is null or jsonb_typeof(result_summary) = 'object'
  ) not valid;
alter table private.data_provider_runs
  validate constraint data_provider_runs_result_summary_v2_check;

create unique index data_provider_runs_official_request_v2_uidx
  on private.data_provider_runs (provider, action, request_id)
  where provider = 'official_web'
    and action = 'discover_official_opportunities'
    and request_id is not null;

create or replace function private.official_discovery_interrupted_summary_v2(
  request_fingerprint_input text
)
returns jsonb
language sql
immutable
parallel safe
set search_path = ''
as $function$
  select jsonb_build_object(
    'version', 'atinara-official-opportunity-idempotency-v2',
    'outcome', 'technical_failure',
    'saved', 0,
    'search_results', 0,
    'inspected_documents', 0,
    'structured_candidates', 0,
    'rejected_candidates', 0,
    'source_error_count', 1,
    'source_error_codes', jsonb_build_object('OFFICIAL_DISCOVERY_REQUEST_INTERRUPTED', 1),
    'duplicate_signals', 0,
    'request_fingerprint', request_fingerprint_input,
    'query_fingerprint', null,
    'provider_rate', '{"limit":null,"remaining":null,"reset":null}'::jsonb,
    'error_code', 'OFFICIAL_DISCOVERY_REQUEST_INTERRUPTED'
  );
$function$;

create or replace function public.begin_official_opportunity_discovery_v2(
  request_id_input uuid,
  request_fingerprint_input text,
  requested_by_input uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  run_row private.data_provider_runs%rowtype;
begin
  if private.market_request_role_v1() is distinct from 'service_role' then
    raise exception 'SERVICE_ROLE_REQUIRED' using errcode = '42501';
  end if;
  if request_id_input is null
     or requested_by_input is null
     or coalesce(request_fingerprint_input, '') !~ '^[0-9a-f]{64}$' then
    raise exception 'OFFICIAL_DISCOVERY_REQUEST_INVALID' using errcode = '22023';
  end if;

  update private.data_provider_runs runs
     set status = 'technical_failure',
         error_code = 'OFFICIAL_DISCOVERY_REQUEST_INTERRUPTED',
         quota_state = private.official_discovery_interrupted_summary_v2(runs.request_fingerprint),
         result_summary = private.official_discovery_interrupted_summary_v2(runs.request_fingerprint),
         completed_at = clock_timestamp(),
         lease_expires_at = null
   where runs.provider = 'official_web'
     and runs.action = 'discover_official_opportunities'
     and runs.request_id is not null
     and runs.status = 'in_progress'
     and runs.lease_expires_at is not null
    and runs.lease_expires_at <= clock_timestamp();

  insert into private.data_provider_runs (
    provider, action, status, result_count, quota_state, is_cached,
    trigger_type, request_id, request_fingerprint, requested_by,
    lease_expires_at, started_at
  ) values (
    'official_web', 'discover_official_opportunities', 'in_progress', 0,
    jsonb_build_object(
      'version', 'atinara-official-opportunity-idempotency-v2',
      'outcome', 'in_progress',
      'request_fingerprint', request_fingerprint_input
    ),
    false, 'manual', request_id_input, request_fingerprint_input,
    requested_by_input, clock_timestamp() + interval '3 minutes', clock_timestamp()
  )
  on conflict (provider, action, request_id)
    where provider = 'official_web'
      and action = 'discover_official_opportunities'
      and request_id is not null
    do nothing
  returning * into run_row;

  if found then
    return jsonb_build_object(
      'state', 'started',
      'outcome', 'in_progress',
      'provider_run_id', run_row.id,
      'replayed', false
    );
  end if;

  select * into run_row
  from private.data_provider_runs runs
  where runs.provider = 'official_web'
    and runs.action = 'discover_official_opportunities'
    and runs.request_id = request_id_input
  for update;

  if not found then
    raise exception 'OFFICIAL_DISCOVERY_REQUEST_NOT_FOUND' using errcode = 'P0002';
  end if;
  if run_row.request_fingerprint is distinct from request_fingerprint_input
     or run_row.requested_by is distinct from requested_by_input then
    raise exception 'OFFICIAL_DISCOVERY_REQUEST_REUSED' using errcode = '22023';
  end if;

  if run_row.status = 'in_progress' then
    return jsonb_build_object(
      'state', 'in_progress',
      'outcome', 'in_progress',
      'provider_run_id', run_row.id,
      'replayed', true
    );
  end if;

  return jsonb_build_object(
    'state', 'terminal',
    'outcome', run_row.status,
    'provider_run_id', run_row.id,
    'result_summary', coalesce(run_row.result_summary, '{}'::jsonb),
    'replayed', true
  );
end;
$function$;

create or replace function private.assert_official_opportunity_signal_v2(item jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  source_item jsonb;
  registry_id_value uuid;
  registry_row private.market_source_registry%rowtype;
  category_value text;
  contract_value jsonb;
  primary_count integer;
  observed_at_value timestamptz;
  valid_until_value timestamptz;
  window_start_value timestamptz;
  window_end_value timestamptz;
  retention_expires_at_value timestamptz;
  contract_window_start_value timestamptz;
  contract_window_end_value timestamptz;
  evaluation_at_value timestamptz;
  resolution_deadline_value timestamptz;
  source_count integer;
  distinct_source_count integer;
  has_exact_duplicate boolean;
  has_ambiguous_identity boolean;
begin
  if jsonb_typeof(item) is distinct from 'object'
     or octet_length(item::text) > 65536
     or not (item ?& array[
       'provider', 'signal_type', 'entity_type', 'entity_id', 'canonical_url',
       'title', 'subtitle', 'description', 'atinara_category', 'observed_at',
       'valid_until', 'signal_origin', 'opportunity_type', 'context_type',
       'catalyst_type', 'factual_basis', 'contextual_basis', 'inference_summary',
       'market_thesis', 'why_now', 'unresolved_question', 'suggested_market_type',
       'time_window_start', 'time_window_end', 'source_payload_excerpt',
       'source_fingerprint', 'marketability_status', 'marketability_reason_codes',
       'resolution_readiness', 'suggested_question', 'suggested_yes_criteria',
       'suggested_no_criteria', 'suggested_edge_cases',
       'suggested_resolution_contract', 'duplicate_matches',
       'provider_policy_flags', 'retention_expires_at'
     ]::text[])
     or item - array[
       'provider', 'signal_type', 'entity_type', 'entity_id', 'canonical_url',
       'title', 'subtitle', 'description', 'atinara_category', 'observed_at',
       'valid_until', 'signal_origin', 'opportunity_type', 'context_type',
       'catalyst_type', 'factual_basis', 'contextual_basis', 'inference_summary',
       'market_thesis', 'why_now', 'unresolved_question', 'suggested_market_type',
       'time_window_start', 'time_window_end', 'source_payload_excerpt',
       'source_fingerprint', 'marketability_status', 'marketability_reason_codes',
       'resolution_readiness', 'suggested_question', 'suggested_yes_criteria',
       'suggested_no_criteria', 'suggested_edge_cases',
       'suggested_resolution_contract', 'duplicate_matches',
       'provider_policy_flags', 'retention_expires_at'
     ]::text[] <> '{}'::jsonb
     or exists (
       select 1
       from unnest(array[
         'provider', 'signal_type', 'entity_type', 'entity_id', 'canonical_url',
         'title', 'subtitle', 'description', 'atinara_category', 'signal_origin',
         'opportunity_type', 'context_type', 'catalyst_type', 'factual_basis',
         'contextual_basis', 'inference_summary', 'market_thesis', 'why_now',
         'unresolved_question', 'suggested_market_type', 'source_fingerprint',
         'marketability_status', 'resolution_readiness', 'suggested_question',
         'suggested_yes_criteria', 'suggested_no_criteria', 'suggested_edge_cases'
       ]::text[]) required_text(key)
       where jsonb_typeof(item -> required_text.key) is distinct from 'string'
     )
     or item ->> 'provider' is distinct from 'official_web'
     or item ->> 'signal_type' not in ('official_future_event', 'official_future_release')
     or item ->> 'entity_type' not in ('official_event', 'official_product')
     or item ->> 'signal_origin' is distinct from 'registered_official_source'
     or item ->> 'opportunity_type' not in ('official_event_deadline', 'official_release_deadline')
     or item ->> 'context_type' is distinct from 'official_structured_event'
     or item ->> 'catalyst_type' not in ('official_event_date', 'official_release_date')
     or item ->> 'suggested_market_type' is distinct from 'binary_official_deadline'
     or item ->> 'marketability_status' not in ('useful', 'needs_review', 'duplicate')
     or item ->> 'resolution_readiness' is distinct from 'manual_secondary_source'
     or coalesce(item ->> 'entity_id', '') !~ '^[0-9a-f]{64}$'
     or coalesce(item ->> 'source_fingerprint', '') !~ '^[0-9a-f]{64}$'
     or item ->> 'entity_id' is distinct from item ->> 'source_fingerprint'
     or octet_length(coalesce(item ->> 'title', '')) not between 3 and 500
     or octet_length(coalesce(item ->> 'suggested_question', '')) not between 20 and 500
     or octet_length(coalesce(item ->> 'suggested_yes_criteria', '')) not between 40 and 4000
     or octet_length(coalesce(item ->> 'suggested_no_criteria', '')) not between 40 and 4000
     or octet_length(coalesce(item ->> 'suggested_edge_cases', '')) not between 40 and 4000
     or item ->> 'unresolved_question' is distinct from item ->> 'suggested_question'
     or private.market_primary_source_url_host_v1(item ->> 'canonical_url') is null
     or jsonb_typeof(item -> 'observed_at') is distinct from 'string'
     or jsonb_typeof(item -> 'valid_until') is distinct from 'string'
     or jsonb_typeof(item -> 'time_window_start') is distinct from 'string'
     or jsonb_typeof(item -> 'time_window_end') is distinct from 'string'
     or jsonb_typeof(item -> 'retention_expires_at') is distinct from 'string'
     or jsonb_typeof(item -> 'source_payload_excerpt') is distinct from 'object'
     or jsonb_typeof(item -> 'marketability_reason_codes') is distinct from 'array'
     or jsonb_typeof(item -> 'duplicate_matches') is distinct from 'array'
     or jsonb_typeof(item -> 'provider_policy_flags') is distinct from 'array'
     or jsonb_typeof(item -> 'suggested_resolution_contract') is distinct from 'object' then
    raise exception 'OFFICIAL_DISCOVERY_SIGNAL_INVALID' using errcode = '22023';
  end if;

  if jsonb_array_length(item -> 'marketability_reason_codes') > 30
     or jsonb_array_length(item -> 'duplicate_matches') > 20
     or jsonb_array_length(item -> 'provider_policy_flags') > 20
     or exists (
       select 1
       from jsonb_array_elements(item -> 'marketability_reason_codes') reason
       where jsonb_typeof(reason) is distinct from 'string'
          or octet_length(reason #>> '{}') not between 2 and 100
     )
     or exists (
       select 1
       from jsonb_array_elements(item -> 'provider_policy_flags') flag
       where jsonb_typeof(flag) is distinct from 'string'
          or octet_length(flag #>> '{}') not between 2 and 100
     )
     or exists (
       select 1
       from jsonb_array_elements(item -> 'duplicate_matches') duplicate_match
       where case
         when jsonb_typeof(duplicate_match) is distinct from 'object' then true
         else
           not (duplicate_match ?& array[
             'id', 'question', 'similarity', 'family_key', 'family_child_key',
             'family_title', 'family_version', 'relationship', 'blocking'
           ]::text[])
           or duplicate_match - array[
             'id', 'question', 'similarity', 'family_key', 'family_child_key',
             'family_title', 'family_version', 'relationship', 'blocking'
           ]::text[] <> '{}'::jsonb
           or jsonb_typeof(duplicate_match -> 'id') not in ('string', 'null')
           or jsonb_typeof(duplicate_match -> 'question') is distinct from 'string'
           or jsonb_typeof(duplicate_match -> 'similarity') is distinct from 'number'
           or jsonb_typeof(duplicate_match -> 'family_key') is distinct from 'string'
           or jsonb_typeof(duplicate_match -> 'family_child_key') not in ('string', 'null')
           or jsonb_typeof(duplicate_match -> 'family_title') is distinct from 'string'
           or jsonb_typeof(duplicate_match -> 'family_version') is distinct from 'string'
           or jsonb_typeof(duplicate_match -> 'relationship') is distinct from 'string'
           or jsonb_typeof(duplicate_match -> 'blocking') is distinct from 'boolean'
           or (jsonb_typeof(duplicate_match -> 'id') = 'string'
             and octet_length(duplicate_match ->> 'id') not between 1 and 220)
           or octet_length(duplicate_match ->> 'question') not between 1 and 500
           or octet_length(duplicate_match ->> 'family_key') not between 1 and 240
           or (jsonb_typeof(duplicate_match -> 'family_child_key') = 'string'
             and octet_length(duplicate_match ->> 'family_child_key') not between 1 and 240)
           or octet_length(duplicate_match ->> 'family_title') not between 1 and 500
           or octet_length(duplicate_match ->> 'family_version') not between 1 and 100
            or duplicate_match ->> 'relationship' not in ('exact_duplicate', 'sibling', 'identity_ambiguous')
            or (duplicate_match ->> 'relationship' = 'exact_duplicate'
              and duplicate_match -> 'blocking' is distinct from 'true'::jsonb)
            or (duplicate_match ->> 'relationship' in ('sibling', 'identity_ambiguous')
              and duplicate_match -> 'blocking' is distinct from 'false'::jsonb)
            or (duplicate_match ->> 'similarity')::numeric not between 0 and 1
       end
     ) then
    raise exception 'OFFICIAL_DISCOVERY_SIGNAL_INVALID' using errcode = '22023';
  end if;

  begin
    observed_at_value := (item ->> 'observed_at')::timestamptz;
    valid_until_value := (item ->> 'valid_until')::timestamptz;
    window_start_value := (item ->> 'time_window_start')::timestamptz;
    window_end_value := (item ->> 'time_window_end')::timestamptz;
    retention_expires_at_value := (item ->> 'retention_expires_at')::timestamptz;
  exception when others then
    raise exception 'OFFICIAL_DISCOVERY_SIGNAL_INVALID' using errcode = '22023';
  end;
  if observed_at_value is null
     or valid_until_value is null
     or window_start_value is null
     or window_end_value is null
     or retention_expires_at_value is null
     or window_end_value <= clock_timestamp()
     or window_start_value >= window_end_value
     or valid_until_value < window_end_value
     or retention_expires_at_value <= window_end_value then
    raise exception 'OFFICIAL_DISCOVERY_SIGNAL_INVALID' using errcode = '22023';
  end if;

  category_value := item ->> 'atinara_category';
  if category_value not in ('Lanzamientos', 'Eventos', 'Industria', 'Streamers', 'Reviews/Premios', 'YouTubers')
     or (item -> 'source_payload_excerpt') - array[
       'version', 'registry_source_id', 'registry_domain', 'parser_version',
       'content_sha256', 'kind', 'raw_value'
     ]::text[] <> '{}'::jsonb
     or not ((item -> 'source_payload_excerpt') ?& array[
       'version', 'registry_source_id', 'registry_domain', 'parser_version',
       'content_sha256', 'kind', 'raw_value'
     ]::text[])
     or exists (
       select 1
       from unnest(array[
         'version', 'registry_source_id', 'registry_domain', 'parser_version',
         'content_sha256', 'kind', 'raw_value'
       ]::text[]) required_snapshot_text(key)
       where jsonb_typeof((item -> 'source_payload_excerpt') -> required_snapshot_text.key)
         is distinct from 'string'
     )
     or item #>> '{source_payload_excerpt,version}' is distinct from 'atinara-official-opportunity-discovery-v1'
     or coalesce(item #>> '{source_payload_excerpt,content_sha256}', '') !~ '^[0-9a-f]{64}$'
     or item #>> '{source_payload_excerpt,kind}' not in ('event', 'release')
     then
    raise exception 'OFFICIAL_DISCOVERY_SOURCE_SNAPSHOT_INVALID' using errcode = '22023';
  end if;

  if not (
    (
      item #>> '{source_payload_excerpt,kind}' = 'event'
      and item ->> 'signal_type' = 'official_future_event'
      and item ->> 'entity_type' = 'official_event'
      and item ->> 'opportunity_type' = 'official_event_deadline'
      and item ->> 'catalyst_type' = 'official_event_date'
    ) or (
      item #>> '{source_payload_excerpt,kind}' = 'release'
      and item ->> 'signal_type' = 'official_future_release'
      and item ->> 'entity_type' = 'official_product'
      and item ->> 'opportunity_type' = 'official_release_deadline'
      and item ->> 'catalyst_type' = 'official_release_date'
    )
  ) then
    raise exception 'OFFICIAL_DISCOVERY_SIGNAL_INVALID' using errcode = '22023';
  end if;

  begin
    registry_id_value := (item #>> '{source_payload_excerpt,registry_source_id}')::uuid;
  exception when invalid_text_representation then
    raise exception 'OFFICIAL_DISCOVERY_SOURCE_REGISTRY_INVALID' using errcode = '22023';
  end;
  select * into registry_row
  from private.market_source_registry registry
  where registry.id = registry_id_value;
  if not found
     or not private.market_primary_registry_row_matches_v1(registry_row, item ->> 'canonical_url', category_value)
     or item #>> '{source_payload_excerpt,parser_version}' is distinct from registry_row.parser_version
     or item #>> '{source_payload_excerpt,registry_domain}' is distinct from
       regexp_replace(lower(rtrim(registry_row.canonical_domain, '.')), '^www\.', '') then
    raise exception 'OFFICIAL_DISCOVERY_SOURCE_REGISTRY_INVALID' using errcode = '22023';
  end if;

  contract_value := item -> 'suggested_resolution_contract';
  if not (contract_value ?& array[
       'version', 'contract_schema_version', 'policy_version', 'canonical_statement',
       'opportunity_type', 'event_name', 'official_event_url', 'provider',
       'provider_adapter_version', 'entity_type', 'entity_id', 'canonical_url',
       'metric', 'operator', 'threshold', 'unit', 'precision', 'window_start',
       'window_end', 'evaluation_at', 'resolution_deadline', 'timezone',
       'finality_delay_seconds', 'capture_strategy', 'sampling_interval_seconds',
       'required_samples', 'aggregation', 'maximum_monitor_duration_seconds',
       'missing_data_treatment', 'cancellation_treatment',
       'postponement_treatment', 'source_conflict_treatment', 'sources'
     ]::text[])
     or contract_value - array[
       'version', 'contract_schema_version', 'policy_version', 'canonical_statement',
       'opportunity_type', 'event_name', 'official_event_url', 'provider',
       'provider_adapter_version', 'entity_type', 'entity_id', 'canonical_url',
       'metric', 'operator', 'threshold', 'unit', 'precision', 'window_start',
       'window_end', 'evaluation_at', 'resolution_deadline', 'timezone',
       'finality_delay_seconds', 'capture_strategy', 'sampling_interval_seconds',
       'required_samples', 'aggregation', 'maximum_monitor_duration_seconds',
       'missing_data_treatment', 'cancellation_treatment',
       'postponement_treatment', 'source_conflict_treatment', 'sources'
     ]::text[] <> '{}'::jsonb
     or exists (
       select 1
       from unnest(array[
         'version', 'contract_schema_version', 'policy_version',
         'canonical_statement', 'opportunity_type', 'event_name',
         'official_event_url', 'provider', 'provider_adapter_version',
         'entity_type', 'entity_id', 'canonical_url', 'operator', 'precision',
         'timezone', 'capture_strategy', 'aggregation', 'missing_data_treatment',
         'cancellation_treatment', 'postponement_treatment',
         'source_conflict_treatment'
       ]::text[]) required_contract_text(key)
       where jsonb_typeof(contract_value -> required_contract_text.key) is distinct from 'string'
     )
     or contract_value ->> 'version' is distinct from 'atinara-official-opportunity-discovery-v1'
     or contract_value ->> 'contract_schema_version' is distinct from 'atinara-resolution-contract-v1'
     or contract_value ->> 'policy_version' is distinct from 'atinara-market-constitution-v1'
     or contract_value ->> 'provider' is distinct from 'official_web'
     or contract_value ->> 'provider_adapter_version' is distinct from 'atinara-official-opportunity-discovery-v1'
     or contract_value ->> 'canonical_statement' is distinct from item ->> 'suggested_question'
     or contract_value ->> 'opportunity_type' is distinct from item ->> 'opportunity_type'
     or contract_value ->> 'event_name' is distinct from item ->> 'title'
     or contract_value ->> 'entity_type' is distinct from item ->> 'entity_type'
     or contract_value -> 'metric' is distinct from 'null'::jsonb
     or contract_value ->> 'operator' is distinct from 'exact_state'
     or contract_value -> 'threshold' is distinct from 'null'::jsonb
     or contract_value -> 'unit' is distinct from 'null'::jsonb
     or contract_value ->> 'precision' not in ('day', 'instant')
     or jsonb_typeof(contract_value -> 'window_start') is distinct from 'string'
     or jsonb_typeof(contract_value -> 'window_end') is distinct from 'string'
     or jsonb_typeof(contract_value -> 'evaluation_at') is distinct from 'string'
     or jsonb_typeof(contract_value -> 'resolution_deadline') is distinct from 'string'
     or octet_length(coalesce(contract_value ->> 'timezone', '')) not between 3 and 100
     or contract_value -> 'finality_delay_seconds' is distinct from '300'::jsonb
     or contract_value ->> 'capture_strategy' is distinct from 'manual_official_source'
     or contract_value -> 'sampling_interval_seconds' is distinct from '0'::jsonb
     or contract_value -> 'required_samples' is distinct from '1'::jsonb
     or contract_value ->> 'aggregation' is distinct from 'exact_state'
     or contract_value -> 'maximum_monitor_duration_seconds' is distinct from '0'::jsonb
     or contract_value ->> 'missing_data_treatment' is distinct from 'manual_review_no_assumption'
     or contract_value ->> 'cancellation_treatment' is distinct from 'resolve_no_if_definitive_before_cutoff'
     or contract_value ->> 'postponement_treatment' is distinct from 'preserve_approved_period'
     or contract_value ->> 'source_conflict_treatment' is distinct from 'pause_and_human_review'
     or contract_value ->> 'entity_id' is distinct from item ->> 'entity_id'
     or contract_value ->> 'canonical_url' is distinct from item ->> 'canonical_url'
     or contract_value ->> 'official_event_url' is distinct from item ->> 'canonical_url'
     or contract_value ->> 'window_start' is distinct from item ->> 'time_window_start'
     or contract_value ->> 'evaluation_at' is distinct from item ->> 'time_window_end'
     or contract_value ->> 'window_end' is distinct from item ->> 'time_window_end'
     or jsonb_typeof(contract_value -> 'sources') is distinct from 'array' then
    raise exception 'OFFICIAL_DISCOVERY_CONTRACT_INVALID' using errcode = '22023';
  end if;

  if jsonb_array_length(contract_value -> 'sources') not between 1 and 8 then
    raise exception 'OFFICIAL_DISCOVERY_CONTRACT_INVALID' using errcode = '22023';
  end if;

  begin
    contract_window_start_value := (contract_value ->> 'window_start')::timestamptz;
    contract_window_end_value := (contract_value ->> 'window_end')::timestamptz;
    evaluation_at_value := (contract_value ->> 'evaluation_at')::timestamptz;
    resolution_deadline_value := (contract_value ->> 'resolution_deadline')::timestamptz;
  exception when others then
    raise exception 'OFFICIAL_DISCOVERY_CONTRACT_INVALID' using errcode = '22023';
  end;
  if contract_window_start_value is distinct from window_start_value
     or contract_window_end_value is distinct from window_end_value
     or evaluation_at_value is distinct from window_end_value
     or resolution_deadline_value <= evaluation_at_value then
    raise exception 'OFFICIAL_DISCOVERY_CONTRACT_INVALID' using errcode = '22023';
  end if;

  primary_count := 0;
  for source_item in select value from jsonb_array_elements(contract_value -> 'sources') loop
    if jsonb_typeof(source_item) is distinct from 'object'
       or not (source_item ?& array[
         'provider', 'url', 'role', 'precedence', 'required',
         'registry_source_id', 'parser_version'
       ]::text[])
       or source_item - array[
         'provider', 'url', 'role', 'precedence', 'required',
         'registry_source_id', 'parser_version'
       ]::text[] <> '{}'::jsonb
       or exists (
         select 1
         from unnest(array[
           'provider', 'url', 'role', 'registry_source_id', 'parser_version'
         ]::text[]) required_source_text(key)
         where jsonb_typeof(source_item -> required_source_text.key) is distinct from 'string'
       )
       or source_item ->> 'role' not in ('PRIMARY_RESOLUTION', 'CORROBORATION')
       or jsonb_typeof(source_item -> 'precedence') is distinct from 'number'
       or coalesce(source_item ->> 'precedence', '') !~ '^[1-8]$'
       or jsonb_typeof(source_item -> 'required') is distinct from 'boolean' then
      raise exception 'OFFICIAL_DISCOVERY_CONTRACT_SOURCE_INVALID' using errcode = '22023';
    end if;
    begin
      registry_id_value := (source_item ->> 'registry_source_id')::uuid;
    exception when invalid_text_representation then
      raise exception 'OFFICIAL_DISCOVERY_CONTRACT_SOURCE_INVALID' using errcode = '22023';
    end;
    select * into registry_row
    from private.market_source_registry registry
    where registry.id = registry_id_value;
    if not found
       or not private.market_primary_registry_row_matches_v1(registry_row, source_item ->> 'url', category_value)
       or source_item ->> 'provider' is distinct from registry_row.provider
       or source_item ->> 'parser_version' is distinct from registry_row.parser_version then
      raise exception 'OFFICIAL_DISCOVERY_CONTRACT_SOURCE_INVALID' using errcode = '22023';
    end if;
    if source_item ->> 'role' = 'PRIMARY_RESOLUTION' then
      primary_count := primary_count + 1;
      if source_item ->> 'url' is distinct from item ->> 'canonical_url'
         or registry_id_value is distinct from (item #>> '{source_payload_excerpt,registry_source_id}')::uuid
         or source_item ->> 'precedence' is distinct from '1'
         or source_item ->> 'required' is distinct from 'true' then
        raise exception 'OFFICIAL_DISCOVERY_CONTRACT_PRIMARY_INVALID' using errcode = '22023';
      end if;
    elsif source_item ->> 'precedence' = '1'
       or source_item ->> 'required' is distinct from 'false' then
      raise exception 'OFFICIAL_DISCOVERY_CONTRACT_SOURCE_INVALID' using errcode = '22023';
    end if;
  end loop;
  if primary_count <> 1
     or (select count(*) from (
       select source ->> 'precedence'
       from jsonb_array_elements(contract_value -> 'sources') source
       group by source ->> 'precedence'
       having count(*) > 1
     ) duplicate_precedence) > 0 then
    raise exception 'OFFICIAL_DISCOVERY_CONTRACT_PRIMARY_INVALID' using errcode = '22023';
  end if;

  select count(*), count(distinct source ->> 'registry_source_id')
    into source_count, distinct_source_count
  from jsonb_array_elements(contract_value -> 'sources') source;
  if distinct_source_count <> source_count then
    raise exception 'OFFICIAL_DISCOVERY_CONTRACT_SOURCE_INVALID' using errcode = '22023';
  end if;

  select
    coalesce(bool_or(duplicate_match ->> 'relationship' = 'exact_duplicate'), false),
    coalesce(bool_or(duplicate_match ->> 'relationship' = 'identity_ambiguous'), false)
    into has_exact_duplicate, has_ambiguous_identity
  from jsonb_array_elements(item -> 'duplicate_matches') duplicate_match;
  if (source_count < 2) is distinct from
       ((item -> 'marketability_reason_codes') ? 'ALTERNATIVE_OFFICIAL_SOURCE_REQUIRED')
     or has_exact_duplicate is distinct from
       ((item -> 'marketability_reason_codes') ? 'DUPLICATE_MARKET')
     or has_ambiguous_identity is distinct from
       ((item -> 'marketability_reason_codes') ? 'FAMILY_IDENTITY_AMBIGUOUS')
     or (item ->> 'marketability_status' = 'duplicate') is distinct from has_exact_duplicate
     or (item ->> 'marketability_status' = 'needs_review') is distinct from
       (not has_exact_duplicate and jsonb_array_length(item -> 'marketability_reason_codes') > 0)
     or (item ->> 'marketability_status' = 'useful') is distinct from
       (not has_exact_duplicate and jsonb_array_length(item -> 'marketability_reason_codes') = 0) then
    raise exception 'OFFICIAL_DISCOVERY_SIGNAL_INVALID' using errcode = '22023';
  end if;
end;
$function$;

create or replace function public.finish_official_opportunity_discovery_v2(
  request_id_input uuid,
  request_fingerprint_input text,
  requested_by_input uuid,
  signals_input jsonb,
  run_input jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  run_row private.data_provider_runs%rowtype;
  item jsonb;
  contract_value jsonb;
  category_value text;
  inserted_rows integer;
  saved_count integer := 0;
  duplicate_count integer := 0;
  source_error_sum integer;
  final_outcome text;
  result_value jsonb;
begin
  if private.market_request_role_v1() is distinct from 'service_role' then
    raise exception 'SERVICE_ROLE_REQUIRED' using errcode = '42501';
  end if;
  if request_id_input is null
     or requested_by_input is null
     or coalesce(request_fingerprint_input, '') !~ '^[0-9a-f]{64}$' then
    raise exception 'OFFICIAL_DISCOVERY_REQUEST_INVALID' using errcode = '22023';
  end if;

  select * into run_row
  from private.data_provider_runs runs
  where runs.provider = 'official_web'
    and runs.action = 'discover_official_opportunities'
    and runs.request_id = request_id_input
  for update;
  if not found then
    raise exception 'OFFICIAL_DISCOVERY_REQUEST_NOT_FOUND' using errcode = 'P0002';
  end if;
  if run_row.request_fingerprint is distinct from request_fingerprint_input
     or run_row.requested_by is distinct from requested_by_input then
    raise exception 'OFFICIAL_DISCOVERY_REQUEST_REUSED' using errcode = '22023';
  end if;
  if run_row.status <> 'in_progress' then
    return jsonb_build_object(
      'state', 'terminal',
      'outcome', run_row.status,
      'provider_run_id', run_row.id,
      'result_summary', coalesce(run_row.result_summary, '{}'::jsonb),
      'replayed', true
    );
  end if;

  if run_row.lease_expires_at is null or run_row.lease_expires_at <= clock_timestamp() then
    result_value := private.official_discovery_interrupted_summary_v2(run_row.request_fingerprint);
    update private.data_provider_runs runs
       set status = 'technical_failure',
           error_code = 'OFFICIAL_DISCOVERY_REQUEST_INTERRUPTED',
           quota_state = result_value,
           result_summary = result_value,
           completed_at = clock_timestamp(),
           lease_expires_at = null
     where runs.id = run_row.id;
    return jsonb_build_object(
      'state', 'terminal',
      'outcome', 'technical_failure',
      'provider_run_id', run_row.id,
      'result_summary', result_value,
      'replayed', false
    );
  end if;

  if jsonb_typeof(coalesce(signals_input, 'null'::jsonb)) is distinct from 'array'
     or jsonb_typeof(coalesce(run_input, 'null'::jsonb)) is distinct from 'object' then
    raise exception 'OFFICIAL_DISCOVERY_RESULT_INVALID' using errcode = '22023';
  end if;

  if jsonb_array_length(signals_input) > 8
     or octet_length(run_input::text) > 8192
     or not (run_input ?& array[
       'outcome', 'error_code', 'query_fingerprint', 'search_results',
       'inspected_documents', 'structured_candidates', 'rejected_candidates',
       'source_error_count', 'source_error_codes', 'provider_rate'
     ]::text[])
     or run_input - array[
       'outcome', 'error_code', 'query_fingerprint', 'search_results',
       'inspected_documents', 'structured_candidates', 'rejected_candidates',
       'source_error_count', 'source_error_codes', 'provider_rate'
     ]::text[] <> '{}'::jsonb
     or coalesce(run_input ->> 'outcome', '') not in ('success', 'partial', 'zero_results', 'technical_failure')
     or jsonb_typeof(run_input -> 'error_code') not in ('string', 'null')
     or jsonb_typeof(run_input -> 'query_fingerprint') not in ('string', 'null')
     or (jsonb_typeof(run_input -> 'query_fingerprint') = 'string'
       and coalesce(run_input ->> 'query_fingerprint', '') !~ '^[0-9a-f]{64}$')
     or jsonb_typeof(run_input -> 'search_results') is distinct from 'number'
     or jsonb_typeof(run_input -> 'inspected_documents') is distinct from 'number'
     or jsonb_typeof(run_input -> 'structured_candidates') is distinct from 'number'
     or jsonb_typeof(run_input -> 'rejected_candidates') is distinct from 'number'
     or jsonb_typeof(run_input -> 'source_error_count') is distinct from 'number'
     or coalesce(run_input ->> 'search_results', '') !~ '^[0-8]$'
     or coalesce(run_input ->> 'inspected_documents', '') !~ '^[0-8]$'
     or coalesce(run_input ->> 'structured_candidates', '') !~ '^(0|[1-9][0-9]{0,3})$'
     or coalesce(run_input ->> 'rejected_candidates', '') !~ '^(0|[1-9][0-9]{0,3})$'
     or coalesce(run_input ->> 'source_error_count', '') !~ '^[0-8]$'
     or jsonb_typeof(run_input -> 'source_error_codes') is distinct from 'object'
     or jsonb_typeof(run_input -> 'provider_rate') is distinct from 'object' then
    raise exception 'OFFICIAL_DISCOVERY_RESULT_INVALID' using errcode = '22023';
  end if;

  if (run_input -> 'provider_rate') - array['limit', 'remaining', 'reset']::text[] <> '{}'::jsonb
     or not ((run_input -> 'provider_rate') ?& array['limit', 'remaining', 'reset']::text[])
     or exists (
       select 1 from jsonb_each(run_input -> 'provider_rate') rate
       where jsonb_typeof(rate.value) not in ('string', 'null')
          or (jsonb_typeof(rate.value) = 'string'
            and coalesce(rate.value #>> '{}', '') !~ '^[0-9]{1,20}$')
     )
     or exists (
       select 1 from jsonb_each(run_input -> 'source_error_codes') source_error
       where source_error.key !~ '^(OFFICIAL|PROVIDER|TAVILY)_[A-Z0-9_]{2,92}$'
          or jsonb_typeof(source_error.value) <> 'number'
          or source_error.value::text !~ '^[1-8]$'
     ) then
    raise exception 'OFFICIAL_DISCOVERY_RESULT_INVALID' using errcode = '22023';
  end if;

  select coalesce(sum(value::text::integer), 0) into source_error_sum
  from jsonb_each(run_input -> 'source_error_codes');
  if source_error_sum <> (run_input ->> 'source_error_count')::integer
     or (run_input ->> 'inspected_documents')::integer > (run_input ->> 'search_results')::integer
     or ((run_input ->> 'outcome') <> 'technical_failure'
       and (run_input ->> 'inspected_documents')::integer + source_error_sum
         <> (run_input ->> 'search_results')::integer)
     or jsonb_array_length(signals_input) > (run_input ->> 'structured_candidates')::integer
     or ((run_input ->> 'outcome') <> 'technical_failure'
       and coalesce(run_input ->> 'query_fingerprint', '') !~ '^[0-9a-f]{64}$')
     or ((run_input ->> 'outcome') = 'technical_failure') is distinct from (nullif(run_input ->> 'error_code', '') is not null)
     or (nullif(run_input ->> 'error_code', '') is not null
       and run_input ->> 'error_code' !~ '^(OFFICIAL|PROVIDER|TAVILY)_[A-Z0-9_]{2,92}$')
     or ((run_input ->> 'outcome') = 'technical_failure' and jsonb_array_length(signals_input) <> 0)
     or ((run_input ->> 'outcome') = 'partial') is distinct from (source_error_sum > 0 and (run_input ->> 'outcome') <> 'technical_failure')
     or ((run_input ->> 'outcome') = 'success' and jsonb_array_length(signals_input) = 0)
     or ((run_input ->> 'outcome') = 'zero_results' and jsonb_array_length(signals_input) <> 0) then
    raise exception 'OFFICIAL_DISCOVERY_RESULT_INCONSISTENT' using errcode = '22023';
  end if;

  if run_input ->> 'outcome' <> 'technical_failure' then
    for item in select value from jsonb_array_elements(signals_input) loop
      perform private.assert_official_opportunity_signal_v2(item);
      category_value := item ->> 'atinara_category';
      contract_value := item -> 'suggested_resolution_contract';
      if jsonb_array_length(contract_value -> 'sources') > (run_input ->> 'inspected_documents')::integer
         or jsonb_array_length(contract_value -> 'sources') > (run_input ->> 'structured_candidates')::integer then
        raise exception 'OFFICIAL_DISCOVERY_RESULT_INCONSISTENT' using errcode = '22023';
      end if;
      insert into private.data_observatory_signals (
        provider, signal_type, entity_type, entity_id, canonical_url, title,
        subtitle, description, atinara_category, observed_at, valid_until,
        signal_origin, opportunity_type, context_type, catalyst_type,
        factual_basis, contextual_basis, inference_summary, market_thesis,
        why_now, unresolved_question, suggested_market_type, time_window_start,
        time_window_end, source_payload_excerpt, source_fingerprint,
        marketability_status, marketability_reason_codes, resolution_readiness,
        suggested_question, suggested_yes_criteria, suggested_no_criteria,
        suggested_edge_cases, suggested_resolution_contract, duplicate_matches,
        provider_policy_flags, retention_expires_at
      ) values (
        'official_web', left(item ->> 'signal_type', 100), left(item ->> 'entity_type', 100),
        item ->> 'entity_id', item ->> 'canonical_url', left(item ->> 'title', 500),
        nullif(left(coalesce(item ->> 'subtitle', ''), 500), ''),
        nullif(left(coalesce(item ->> 'description', ''), 4000), ''), category_value,
        (item ->> 'observed_at')::timestamptz, (item ->> 'valid_until')::timestamptz,
        'registered_official_source', left(item ->> 'opportunity_type', 100),
        left(item ->> 'context_type', 100), left(item ->> 'catalyst_type', 100),
        left(item ->> 'factual_basis', 4000), left(item ->> 'contextual_basis', 4000),
        left(item ->> 'inference_summary', 4000), left(item ->> 'market_thesis', 4000),
        left(item ->> 'why_now', 2000), left(item ->> 'unresolved_question', 2000),
        left(item ->> 'suggested_market_type', 100), (item ->> 'time_window_start')::timestamptz,
        (item ->> 'time_window_end')::timestamptz, item -> 'source_payload_excerpt',
        item ->> 'source_fingerprint', item ->> 'marketability_status',
        item -> 'marketability_reason_codes', 'manual_secondary_source',
        left(item ->> 'suggested_question', 500), left(item ->> 'suggested_yes_criteria', 4000),
        left(item ->> 'suggested_no_criteria', 4000), left(item ->> 'suggested_edge_cases', 4000),
        contract_value, item -> 'duplicate_matches', item -> 'provider_policy_flags',
        (item ->> 'retention_expires_at')::timestamptz
      ) on conflict (provider, source_fingerprint) do update set
        signal_type = excluded.signal_type,
        entity_type = excluded.entity_type,
        canonical_url = excluded.canonical_url,
        title = excluded.title,
        subtitle = excluded.subtitle,
        description = excluded.description,
        atinara_category = excluded.atinara_category,
        observed_at = excluded.observed_at,
        valid_until = excluded.valid_until,
        signal_origin = excluded.signal_origin,
        opportunity_type = excluded.opportunity_type,
        context_type = excluded.context_type,
        catalyst_type = excluded.catalyst_type,
        factual_basis = excluded.factual_basis,
        contextual_basis = excluded.contextual_basis,
        inference_summary = excluded.inference_summary,
        market_thesis = excluded.market_thesis,
        why_now = excluded.why_now,
        unresolved_question = excluded.unresolved_question,
        suggested_market_type = excluded.suggested_market_type,
        time_window_start = excluded.time_window_start,
        time_window_end = excluded.time_window_end,
        source_payload_excerpt = excluded.source_payload_excerpt,
        marketability_status = case
          when private.data_observatory_signals.marketability_status = 'rejected' then 'rejected'
          else excluded.marketability_status
        end,
        marketability_reason_codes = excluded.marketability_reason_codes,
        resolution_readiness = excluded.resolution_readiness,
        suggested_question = excluded.suggested_question,
        suggested_yes_criteria = excluded.suggested_yes_criteria,
        suggested_no_criteria = excluded.suggested_no_criteria,
        suggested_edge_cases = excluded.suggested_edge_cases,
        suggested_resolution_contract = excluded.suggested_resolution_contract,
        duplicate_matches = excluded.duplicate_matches,
        provider_policy_flags = excluded.provider_policy_flags,
        retention_expires_at = excluded.retention_expires_at,
        expert_analysis_status = case
          when private.data_observatory_signals.analysis_fingerprint is not null
           and (
             private.data_observatory_signals.suggested_resolution_contract
               is distinct from excluded.suggested_resolution_contract
             or private.data_observatory_signals.source_payload_excerpt
               is distinct from excluded.source_payload_excerpt
             or private.data_observatory_signals.duplicate_matches
               is distinct from excluded.duplicate_matches
             or private.data_observatory_signals.marketability_reason_codes
               is distinct from excluded.marketability_reason_codes
           ) then 'stale'
          else private.data_observatory_signals.expert_analysis_status
        end,
        updated_at = clock_timestamp()
      where (
        private.data_observatory_signals.signal_type,
        private.data_observatory_signals.entity_type,
        private.data_observatory_signals.canonical_url,
        private.data_observatory_signals.title,
        private.data_observatory_signals.subtitle,
        private.data_observatory_signals.description,
        private.data_observatory_signals.atinara_category,
        private.data_observatory_signals.observed_at,
        private.data_observatory_signals.valid_until,
        private.data_observatory_signals.signal_origin,
        private.data_observatory_signals.opportunity_type,
        private.data_observatory_signals.context_type,
        private.data_observatory_signals.catalyst_type,
        private.data_observatory_signals.factual_basis,
        private.data_observatory_signals.contextual_basis,
        private.data_observatory_signals.inference_summary,
        private.data_observatory_signals.market_thesis,
        private.data_observatory_signals.why_now,
        private.data_observatory_signals.unresolved_question,
        private.data_observatory_signals.suggested_market_type,
        private.data_observatory_signals.time_window_start,
        private.data_observatory_signals.time_window_end,
        private.data_observatory_signals.source_payload_excerpt,
        private.data_observatory_signals.marketability_reason_codes,
        private.data_observatory_signals.resolution_readiness,
        private.data_observatory_signals.suggested_question,
        private.data_observatory_signals.suggested_yes_criteria,
        private.data_observatory_signals.suggested_no_criteria,
        private.data_observatory_signals.suggested_edge_cases,
        private.data_observatory_signals.suggested_resolution_contract,
        private.data_observatory_signals.duplicate_matches,
        private.data_observatory_signals.provider_policy_flags,
        private.data_observatory_signals.retention_expires_at
      ) is distinct from (
        excluded.signal_type,
        excluded.entity_type,
        excluded.canonical_url,
        excluded.title,
        excluded.subtitle,
        excluded.description,
        excluded.atinara_category,
        excluded.observed_at,
        excluded.valid_until,
        excluded.signal_origin,
        excluded.opportunity_type,
        excluded.context_type,
        excluded.catalyst_type,
        excluded.factual_basis,
        excluded.contextual_basis,
        excluded.inference_summary,
        excluded.market_thesis,
        excluded.why_now,
        excluded.unresolved_question,
        excluded.suggested_market_type,
        excluded.time_window_start,
        excluded.time_window_end,
        excluded.source_payload_excerpt,
        excluded.marketability_reason_codes,
        excluded.resolution_readiness,
        excluded.suggested_question,
        excluded.suggested_yes_criteria,
        excluded.suggested_no_criteria,
        excluded.suggested_edge_cases,
        excluded.suggested_resolution_contract,
        excluded.duplicate_matches,
        excluded.provider_policy_flags,
        excluded.retention_expires_at
      )
      or (
        private.data_observatory_signals.marketability_status <> 'rejected'
        and private.data_observatory_signals.marketability_status
          is distinct from excluded.marketability_status
      );
      get diagnostics inserted_rows = row_count;
      saved_count := saved_count + inserted_rows;
    end loop;
  end if;

  duplicate_count := jsonb_array_length(signals_input) - saved_count;
  if run_input ->> 'outcome' = 'technical_failure' then
    final_outcome := 'technical_failure';
  elsif source_error_sum > 0 then
    final_outcome := 'partial';
  elsif saved_count > 0 then
    final_outcome := 'success';
  else
    final_outcome := 'zero_results';
  end if;

  result_value := jsonb_build_object(
    'version', 'atinara-official-opportunity-idempotency-v2',
    'outcome', final_outcome,
    'saved', saved_count,
    'search_results', (run_input ->> 'search_results')::integer,
    'inspected_documents', (run_input ->> 'inspected_documents')::integer,
    'structured_candidates', (run_input ->> 'structured_candidates')::integer,
    'rejected_candidates', (run_input ->> 'rejected_candidates')::integer,
    'source_error_count', source_error_sum,
    'source_error_codes', run_input -> 'source_error_codes',
    'duplicate_signals', duplicate_count,
    'request_fingerprint', request_fingerprint_input,
    'query_fingerprint', run_input -> 'query_fingerprint',
    'provider_rate', run_input -> 'provider_rate',
    'error_code', nullif(run_input ->> 'error_code', '')
  );

  update private.data_provider_runs runs
     set status = final_outcome,
         result_count = saved_count,
         quota_state = result_value,
         error_code = nullif(run_input ->> 'error_code', ''),
         result_summary = result_value,
         completed_at = clock_timestamp(),
         lease_expires_at = null
   where runs.id = run_row.id;

  return jsonb_build_object(
    'state', 'terminal',
    'outcome', final_outcome,
    'provider_run_id', run_row.id,
    'result_summary', result_value,
    'replayed', false
  );
end;
$function$;

revoke all on function public.begin_official_opportunity_discovery_v2(uuid, text, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.begin_official_opportunity_discovery_v2(uuid, text, uuid)
  to service_role;

revoke all on function public.finish_official_opportunity_discovery_v2(uuid, text, uuid, jsonb, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.finish_official_opportunity_discovery_v2(uuid, text, uuid, jsonb, jsonb)
  to service_role;

revoke all on function private.assert_official_opportunity_signal_v2(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function private.official_discovery_interrupted_summary_v2(text)
  from public, anon, authenticated, service_role;

comment on function public.begin_official_opportunity_discovery_v2(uuid, text, uuid) is
  'Reclama de forma atómica una intención manual Official Opportunity antes de cualquier red externa.';
comment on function public.finish_official_opportunity_discovery_v2(uuid, text, uuid, jsonb, jsonb) is
  'Finaliza exactamente una intención Official Opportunity, inserta o refresca señales materialmente distintas y conserva un resumen técnico saneado.';

commit;
