begin;

create table if not exists private.market_radar_candidate_quarantines (
  id bigint generated always as identity primary key,
  provider text not null check (provider in ('polymarket', 'kalshi', 'tavily')),
  cache_key text not null check (char_length(cache_key) between 1 and 180),
  external_id text not null check (char_length(external_id) between 1 and 220),
  fingerprint text check (fingerprint is null or fingerprint ~ '^[0-9a-f]{64}$'),
  stage text not null check (stage = 'authoritative_persistence'),
  error_code text not null check (char_length(error_code) between 1 and 100),
  database_code text check (database_code is null or database_code ~ '^[0-9A-Z]{5}$'),
  operation text not null check (char_length(operation) between 1 and 100),
  recorded_at timestamptz not null default now()
);

create index if not exists market_radar_candidate_quarantines_provider_time_idx
  on private.market_radar_candidate_quarantines(provider, recorded_at desc);
create index if not exists market_radar_candidate_quarantines_cache_time_idx
  on private.market_radar_candidate_quarantines(cache_key, recorded_at desc);

alter table private.market_radar_candidate_quarantines enable row level security;
alter table private.market_radar_candidate_quarantines force row level security;
revoke all on table private.market_radar_candidate_quarantines
  from public, anon, authenticated, service_role;
grant all on table private.market_radar_candidate_quarantines to postgres, service_role;

create or replace function public.upsert_market_radar_batch_with_fact_checks_v2(
  provider_input text,
  cache_key_input text,
  normalizer_version_input text,
  candidates_input jsonb,
  fact_checks_input jsonb,
  fact_policy_version_input text,
  provider_status_input jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  item jsonb;
  check_item jsonb;
  item_ordinality bigint;
  item_result jsonb;
  accepted_count_value integer := 0;
  quarantined_count_value integer := 0;
  quarantined_value jsonb := '[]'::jsonb;
  returned_state text;
  returned_message text;
  safe_error_code text;
  safe_external_id text;
  safe_fingerprint text;
begin
  if auth.role() <> 'service_role' then
    raise exception 'SERVICE_ROLE_REQUIRED' using errcode = '42501';
  end if;
  if provider_input not in ('polymarket', 'kalshi', 'tavily')
     or normalizer_version_input <> 'atinara-radar-v2'
     or fact_policy_version_input <> 'atinara-terminal-fact-gate-v2'
     or jsonb_typeof(candidates_input) <> 'array'
     or jsonb_typeof(fact_checks_input) <> 'array'
     or jsonb_array_length(candidates_input) <> jsonb_array_length(fact_checks_input)
     or jsonb_array_length(candidates_input) > 240
     or octet_length(candidates_input::text) > 3145728 then
    raise exception 'INVALID_AUTHORITATIVE_RADAR_BATCH' using errcode = '22023';
  end if;

  for item, item_ordinality in
    select value, ordinality
    from jsonb_array_elements(candidates_input) with ordinality
  loop
    check_item := fact_checks_input -> (item_ordinality::integer - 1);
    begin
      item_result := public.upsert_market_radar_batch_with_fact_checks_v1(
        provider_input,
        left(cache_key_input, 180),
        normalizer_version_input,
        jsonb_build_array(item),
        jsonb_build_array(check_item),
        fact_policy_version_input,
        provider_status_input
      );
      if not coalesce((item_result ->> 'ok')::boolean, false)
         or coalesce((item_result ->> 'fact_checks_linked')::integer, 0) <> 1 then
        raise exception 'RADAR_ROW_PERSISTENCE_INCOMPLETE' using errcode = 'P0001';
      end if;
      accepted_count_value := accepted_count_value + 1;
    exception when others then
      get stacked diagnostics
        returned_state = returned_sqlstate,
        returned_message = message_text;
      if returned_state = '57014'
         or not (
           returned_message in (
             'INVALID_RADAR_CANDIDATE',
             'INCOMPLETE_RADAR_VERIFICATION',
             'RADAR_BATCH_TOO_LARGE',
             'INVALID_RADAR_FACT_CHECK_V2',
             'INVALID_RADAR_FACT_SNAPSHOT_V2',
             'INVALID_RADAR_FACT_CHECK_DATE',
             'RADAR_FACT_EVIDENCE_REQUIRED',
             'RADAR_FACT_STATUS_CONFLICT',
             'RADAR_PROVIDER_FACT_REQUIRED'
           )
           or returned_state in (
             '22001', '22003', '22007', '22008', '22P02',
             '23502', '23503', '23514'
           )
         ) then
        raise;
      end if;

      safe_error_code := case
        when returned_message in (
          'INVALID_RADAR_CANDIDATE',
          'INCOMPLETE_RADAR_VERIFICATION',
          'RADAR_BATCH_TOO_LARGE',
          'INVALID_RADAR_FACT_CHECK_V2',
          'INVALID_RADAR_FACT_SNAPSHOT_V2',
          'INVALID_RADAR_FACT_CHECK_DATE',
          'RADAR_FACT_EVIDENCE_REQUIRED',
          'RADAR_FACT_STATUS_CONFLICT',
          'RADAR_PROVIDER_FACT_REQUIRED'
        ) then returned_message
        else 'RADAR_CANDIDATE_DATA_INVALID'
      end;
      safe_external_id := coalesce(nullif(left(item ->> 'external_id', 220), ''), '[sin-identificador]');
      safe_fingerprint := case
        when coalesce(item ->> 'fingerprint', '') ~ '^[0-9a-fA-F]{64}$'
          then lower(item ->> 'fingerprint')
        else null
      end;

      insert into private.market_radar_candidate_quarantines(
        provider, cache_key, external_id, fingerprint, stage,
        error_code, database_code, operation
      ) values (
        provider_input, left(cache_key_input, 180), safe_external_id,
        safe_fingerprint, 'authoritative_persistence', safe_error_code,
        returned_state, 'upsert_market_radar_batch_with_fact_checks_v2'
      );
      quarantined_count_value := quarantined_count_value + 1;
      quarantined_value := quarantined_value || jsonb_build_array(jsonb_build_object(
        'provider', provider_input,
        'external_id', safe_external_id,
        'fingerprint', safe_fingerprint,
        'stage', 'authoritative_persistence',
        'code', safe_error_code,
        'database_code', returned_state,
        'operation', 'upsert_market_radar_batch_with_fact_checks_v2'
      ));
    end;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'upserted', accepted_count_value,
    'accepted_count', accepted_count_value,
    'fact_checks_linked', accepted_count_value,
    'quarantined_count', quarantined_count_value,
    'quarantined', quarantined_value,
    'row_isolation', 'database_subtransaction_v1',
    'atomic_per_candidate', true
  );
end;
$function$;

revoke all on function public.upsert_market_radar_batch_with_fact_checks_v2(
  text,text,text,jsonb,jsonb,text,jsonb
) from public, anon, authenticated, service_role;
grant execute on function public.upsert_market_radar_batch_with_fact_checks_v2(
  text,text,text,jsonb,jsonb,text,jsonb
) to service_role;

create or replace function public.list_market_radar_candidate_quarantines_v1(
  provider_filter text default null,
  cache_key_filter text default null,
  limit_count integer default 100
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  result jsonb;
begin
  perform private.require_current_admin();
  if nullif(provider_filter, '') is not null
     and provider_filter not in ('polymarket', 'kalshi', 'tavily') then
    raise exception 'INVALID_RADAR_PROVIDER' using errcode = '22023';
  end if;
  select coalesce(jsonb_agg(to_jsonb(item_alias) order by item_alias.recorded_at desc), '[]'::jsonb)
  into result
  from (
    select id, provider, cache_key, external_id, fingerprint, stage,
      error_code, database_code, operation, recorded_at
    from private.market_radar_candidate_quarantines quarantine_alias
    where (nullif(provider_filter, '') is null or quarantine_alias.provider = provider_filter)
      and (nullif(cache_key_filter, '') is null or quarantine_alias.cache_key = cache_key_filter)
    order by recorded_at desc
    limit least(greatest(coalesce(limit_count, 100), 1), 250)
  ) item_alias;
  return result;
end;
$function$;

revoke all on function public.list_market_radar_candidate_quarantines_v1(text,text,integer)
  from public, anon, authenticated, service_role;
grant execute on function public.list_market_radar_candidate_quarantines_v1(text,text,integer)
  to authenticated;

comment on table private.market_radar_candidate_quarantines is
  'Registro append-only de filas de proveedor aisladas por datos invalidos; no degrada por si solo el estado operativo del proveedor.';
comment on function public.upsert_market_radar_batch_with_fact_checks_v2(text,text,text,jsonb,jsonb,text,jsonb) is
  'Persiste un lote en una sola RPC y aisla cada fila de datos invalida mediante subtransacciones SQL; un registro venenoso no pierde filas sanas.';
comment on function public.list_market_radar_candidate_quarantines_v1(text,text,integer) is
  'Expone solo a la administradora las causas seguras de cuarentena para auditoria.';

commit;
