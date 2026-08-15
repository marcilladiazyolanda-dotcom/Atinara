-- Atinara Official Opportunity Discovery V1.
-- Amplía únicamente las señales privadas del Observatorio. No crea borradores,
-- no invoca modelos y no publica, confirma, resuelve ni liquida mercados.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';

alter table private.data_observatory_signals
  drop constraint if exists data_observatory_signals_provider_check;
alter table private.data_observatory_signals
  add constraint data_observatory_signals_provider_check
  check (provider in ('igdb', 'twitch', 'youtube', 'official_web')) not valid;
alter table private.data_observatory_signals
  validate constraint data_observatory_signals_provider_check;

create or replace function public.save_official_opportunity_discovery_v1(
  signals_input jsonb,
  run_input jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  item jsonb;
  source_item jsonb;
  registry_id_value uuid;
  registry_row private.market_source_registry%rowtype;
  category_value text;
  contract_value jsonb;
  primary_count integer;
  saved_count integer := 0;
  provider_run_id uuid;
begin
  if private.market_request_role_v1() is distinct from 'service_role' then
    raise exception 'SERVICE_ROLE_REQUIRED' using errcode = '42501';
  end if;
  if jsonb_typeof(coalesce(signals_input, 'null'::jsonb)) is distinct from 'array'
     or jsonb_array_length(signals_input) > 8
     or jsonb_typeof(coalesce(run_input, 'null'::jsonb)) is distinct from 'object'
     or octet_length(run_input::text) > 8192
     or run_input - array['action', 'status', 'quota_state', 'trigger_type']::text[] <> '{}'::jsonb
     or run_input ->> 'action' is distinct from 'discover_official_opportunities'
     or run_input ->> 'status' not in ('available', 'partial')
     or run_input ->> 'trigger_type' is distinct from 'manual'
     or jsonb_typeof(run_input -> 'quota_state') is distinct from 'object'
     or (run_input -> 'quota_state') - array[
       'query_fingerprint', 'search_results', 'inspected_documents',
       'structured_candidates', 'provider_rate'
     ]::text[] <> '{}'::jsonb
     or coalesce(run_input #>> '{quota_state,query_fingerprint}', '') !~ '^[0-9a-f]{64}$' then
    raise exception 'OFFICIAL_DISCOVERY_BATCH_INVALID' using errcode = '22023';
  end if;

  for item in select value from jsonb_array_elements(signals_input) loop
    if jsonb_typeof(item) is distinct from 'object'
       or octet_length(item::text) > 65536
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
       or item ->> 'provider' is distinct from 'official_web'
       or item ->> 'signal_origin' is distinct from 'registered_official_source'
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
       or private.market_primary_source_url_host_v1(item ->> 'canonical_url') is null
       or nullif(item ->> 'time_window_end', '')::timestamptz <= now()
       or nullif(item ->> 'time_window_start', '')::timestamptz >= nullif(item ->> 'time_window_end', '')::timestamptz
       or jsonb_typeof(item -> 'source_payload_excerpt') is distinct from 'object'
       or jsonb_typeof(item -> 'marketability_reason_codes') is distinct from 'array'
       or jsonb_array_length(item -> 'marketability_reason_codes') > 30
       or jsonb_typeof(item -> 'duplicate_matches') is distinct from 'array'
       or jsonb_array_length(item -> 'duplicate_matches') > 20
       or jsonb_typeof(item -> 'provider_policy_flags') is distinct from 'array'
       or jsonb_array_length(item -> 'provider_policy_flags') > 20
       or jsonb_typeof(item -> 'suggested_resolution_contract') is distinct from 'object' then
      raise exception 'OFFICIAL_DISCOVERY_SIGNAL_INVALID' using errcode = '22023';
    end if;

    category_value := item ->> 'atinara_category';
    if category_value not in ('Lanzamientos', 'Eventos', 'Industria', 'Streamers', 'Reviews/Premios', 'YouTubers')
       or (item -> 'source_payload_excerpt') - array[
         'version', 'registry_source_id', 'registry_domain', 'parser_version',
         'content_sha256', 'kind', 'raw_value'
       ]::text[] <> '{}'::jsonb
       or item #>> '{source_payload_excerpt,version}' is distinct from 'atinara-official-opportunity-discovery-v1'
       or coalesce(item #>> '{source_payload_excerpt,content_sha256}', '') !~ '^[0-9a-f]{64}$'
       or item #>> '{source_payload_excerpt,kind}' not in ('event', 'release') then
      raise exception 'OFFICIAL_DISCOVERY_SOURCE_SNAPSHOT_INVALID' using errcode = '22023';
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
    if contract_value - array[
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
       or contract_value ->> 'version' is distinct from 'atinara-official-opportunity-discovery-v1'
       or contract_value ->> 'contract_schema_version' is distinct from 'atinara-resolution-contract-v1'
       or contract_value ->> 'policy_version' is distinct from 'atinara-market-constitution-v1'
       or contract_value ->> 'provider' is distinct from 'official_web'
       or contract_value ->> 'provider_adapter_version' is distinct from 'atinara-official-opportunity-discovery-v1'
       or contract_value ->> 'capture_strategy' is distinct from 'manual_official_source'
       or contract_value ->> 'aggregation' is distinct from 'exact_state'
       or contract_value ->> 'entity_id' is distinct from item ->> 'entity_id'
       or contract_value ->> 'canonical_url' is distinct from item ->> 'canonical_url'
       or contract_value ->> 'official_event_url' is distinct from item ->> 'canonical_url'
       or contract_value ->> 'evaluation_at' is distinct from item ->> 'time_window_end'
       or contract_value ->> 'window_end' is distinct from item ->> 'time_window_end'
       or jsonb_typeof(contract_value -> 'sources') is distinct from 'array'
       or jsonb_array_length(contract_value -> 'sources') not between 1 and 8 then
      raise exception 'OFFICIAL_DISCOVERY_CONTRACT_INVALID' using errcode = '22023';
    end if;

    primary_count := 0;
    for source_item in select value from jsonb_array_elements(contract_value -> 'sources') loop
      if jsonb_typeof(source_item) is distinct from 'object'
         or source_item - array[
           'provider', 'url', 'role', 'precedence', 'required',
           'registry_source_id', 'parser_version'
         ]::text[] <> '{}'::jsonb
         or source_item ->> 'role' not in ('PRIMARY_RESOLUTION', 'CORROBORATION')
         or coalesce((source_item ->> 'precedence')::integer, 0) < 1
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
           or source_item ->> 'required' is distinct from 'true' then
          raise exception 'OFFICIAL_DISCOVERY_CONTRACT_PRIMARY_INVALID' using errcode = '22023';
        end if;
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
      canonical_url = excluded.canonical_url,
      title = excluded.title,
      subtitle = excluded.subtitle,
      description = excluded.description,
      observed_at = excluded.observed_at,
      valid_until = excluded.valid_until,
      factual_basis = excluded.factual_basis,
      contextual_basis = excluded.contextual_basis,
      inference_summary = excluded.inference_summary,
      market_thesis = excluded.market_thesis,
      why_now = excluded.why_now,
      time_window_start = excluded.time_window_start,
      time_window_end = excluded.time_window_end,
      source_payload_excerpt = excluded.source_payload_excerpt,
      marketability_status = case
        when private.data_observatory_signals.marketability_status = 'rejected' then 'rejected'
        else excluded.marketability_status
      end,
      marketability_reason_codes = excluded.marketability_reason_codes,
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
      updated_at = now();
    saved_count := saved_count + 1;
  end loop;

  insert into private.data_provider_runs (
    provider, action, status, result_count, quota_state, is_cached,
    trigger_type, completed_at
  ) values (
    'official_web', 'discover_official_opportunities', run_input ->> 'status',
    saved_count, run_input -> 'quota_state', false, 'manual', now()
  ) returning id into provider_run_id;

  return jsonb_build_object('saved', saved_count, 'provider_run_id', provider_run_id);
end;
$function$;

revoke all on function public.save_official_opportunity_discovery_v1(jsonb, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.save_official_opportunity_discovery_v1(jsonb, jsonb)
  to service_role;

comment on function public.save_official_opportunity_discovery_v1(jsonb, jsonb) is
  'Persiste solo señales privadas Official Opportunity V1 y una ejecución técnica; no crea borradores ni invoca modelos.';

commit;
