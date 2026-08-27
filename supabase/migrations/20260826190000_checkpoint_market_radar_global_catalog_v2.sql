begin;

create table private.market_radar_provider_discovery_checkpoints_v2 (
  request_id uuid not null,
  provider text not null check (provider = 'kalshi'),
  capability text not null check (capability = 'candidate_feed'),
  sequence integer not null check (sequence between 1 and 1000),
  checkpoint_version text not null
    check (checkpoint_version = 'atinara-provider-discovery-checkpoint-v2'),
  previous_checkpoint_hash text check (
    previous_checkpoint_hash is null or previous_checkpoint_hash ~ '^[a-f0-9]{64}$'
  ),
  provider_catalog_hash text not null check (provider_catalog_hash ~ '^[a-f0-9]{64}$'),
  entity_terms_hash text not null check (entity_terms_hash ~ '^[a-f0-9]{64}$'),
  entity_term_count integer not null check (entity_term_count between 0 and 1000),
  total_provider_series_count integer not null
    check (total_provider_series_count between 1 and 100000),
  total_series_count integer not null check (total_series_count between 1 and 2000),
  completed_series_count integer not null check (completed_series_count between 0 and 2000),
  failed_series_count integer not null check (failed_series_count between 0 and 2000),
  pending_series_count integer not null check (pending_series_count between 0 and 2000),
  retryable_failed_series_count integer not null
    check (retryable_failed_series_count between 0 and 2000),
  exhausted_failed_series_count integer not null
    check (exhausted_failed_series_count between 0 and 2000),
  total_parent_count integer not null check (total_parent_count between 0 and 2000),
  checkpoint jsonb not null check (
    jsonb_typeof(checkpoint) = 'object'
    and octet_length(checkpoint::text) <= 4194304
  ),
  checkpoint_hash text not null check (checkpoint_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default clock_timestamp(),
  primary key (request_id, provider, capability, sequence),
  unique (request_id, provider, capability, checkpoint_hash),
  foreign key (request_id, provider, capability)
    references private.market_radar_refresh_intents_v1(request_id, provider, capability)
    on delete restrict,
  check (
    completed_series_count + failed_series_count + pending_series_count = total_series_count
    and retryable_failed_series_count + exhausted_failed_series_count = failed_series_count
    and ((sequence = 1 and previous_checkpoint_hash is null)
      or (sequence > 1 and previous_checkpoint_hash is not null))
  )
);

alter table private.market_radar_provider_discovery_checkpoints_v2 enable row level security;
alter table private.market_radar_provider_discovery_checkpoints_v2 force row level security;
revoke all on table private.market_radar_provider_discovery_checkpoints_v2
  from public, anon, authenticated, service_role;

create trigger market_radar_provider_discovery_checkpoint_append_only_v2
before update or delete on private.market_radar_provider_discovery_checkpoints_v2
for each row execute function private.reject_market_radar_provider_discovery_checkpoint_mutation_v1();

create or replace function public.checkpoint_market_radar_provider_discovery_v2(
  request_id_input uuid,
  provider_input text,
  capability_input text,
  lease_token_input uuid,
  checkpoint_input jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  intent private.market_radar_refresh_intents_v1%rowtype;
  latest private.market_radar_provider_discovery_checkpoints_v2%rowtype;
  stored private.market_radar_provider_discovery_checkpoints_v2%rowtype;
  sequence_value integer;
  total_provider_series_count_value integer;
  entity_term_count_value integer;
  total_series_count_value integer;
  completed_series_count_value integer;
  failed_series_count_value integer;
  pending_series_count_value integer;
  retryable_failed_series_count_value integer;
  exhausted_failed_series_count_value integer;
  total_parent_count_value integer;
  actual_completed_series_count integer;
  actual_failed_series_count integer;
  actual_retryable_failed_series_count integer;
  actual_exhausted_failed_series_count integer;
  actual_parent_count integer;
  unique_parent_count integer;
  changed_result_count integer := 0;
  changed_checked_at timestamptz;
  checkpoint_hash_value text;
  previous_checkpoint_hash_value text;
  previous_phase_value text;
  replayed_value boolean := false;
begin
  if auth.role() <> 'service_role' then
    raise exception 'SERVICE_ROLE_REQUIRED' using errcode = '42501';
  end if;
  intent := private.assert_market_radar_refresh_lease_v1(
    request_id_input, provider_input, capability_input, lease_token_input
  );

  if provider_input <> 'kalshi'
     or capability_input <> 'candidate_feed'
     or intent.phase not in ('claimed','fetching')
     or jsonb_typeof(checkpoint_input) <> 'object'
     or checkpoint_input ->> 'schema_version'
          is distinct from 'atinara-provider-discovery-checkpoint-v2'
     or jsonb_typeof(checkpoint_input -> 'catalog') <> 'object'
     or jsonb_typeof(checkpoint_input -> 'series') <> 'array'
     or jsonb_typeof(checkpoint_input -> 'series_results') <> 'array'
     or jsonb_typeof(checkpoint_input -> 'checked_at') is distinct from 'string'
     or nullif(btrim(checkpoint_input ->> 'checked_at'),'') is null
     or coalesce(checkpoint_input ->> 'sequence','') !~ '^\d{1,4}$'
     or coalesce(checkpoint_input ->> 'total_series_count','') !~ '^\d{1,4}$'
     or coalesce(checkpoint_input ->> 'completed_series_count','') !~ '^\d{1,4}$'
     or coalesce(checkpoint_input ->> 'failed_series_count','') !~ '^\d{1,4}$'
     or coalesce(checkpoint_input ->> 'pending_series_count','') !~ '^\d{1,4}$'
     or coalesce(checkpoint_input ->> 'retryable_failed_series_count','') !~ '^\d{1,4}$'
     or coalesce(checkpoint_input ->> 'exhausted_failed_series_count','') !~ '^\d{1,4}$'
     or coalesce(checkpoint_input ->> 'total_parent_count','') !~ '^\d{1,4}$'
     or octet_length(checkpoint_input::text) > 4194304 then
    raise exception 'RADAR_PROVIDER_DISCOVERY_CHECKPOINT_V2_INVALID' using errcode = '22023';
  end if;

  sequence_value := (checkpoint_input ->> 'sequence')::integer;
  total_series_count_value := (checkpoint_input ->> 'total_series_count')::integer;
  completed_series_count_value := (checkpoint_input ->> 'completed_series_count')::integer;
  failed_series_count_value := (checkpoint_input ->> 'failed_series_count')::integer;
  pending_series_count_value := (checkpoint_input ->> 'pending_series_count')::integer;
  retryable_failed_series_count_value :=
    (checkpoint_input ->> 'retryable_failed_series_count')::integer;
  exhausted_failed_series_count_value :=
    (checkpoint_input ->> 'exhausted_failed_series_count')::integer;
  total_parent_count_value := (checkpoint_input ->> 'total_parent_count')::integer;
  previous_checkpoint_hash_value := nullif(
    btrim(checkpoint_input ->> 'previous_checkpoint_hash'), ''
  );

  if checkpoint_input #>> '{catalog,catalog_version}'
       is distinct from 'atinara-kalshi-series-catalog-evidence-v2'
     or checkpoint_input #>> '{catalog,source_endpoint}'
       is distinct from '/trade-api/v2/series'
     or checkpoint_input #>> '{catalog,query_contract}'
       is distinct from 'include_product_metadata=true&include_volume=true'
     or checkpoint_input #>> '{catalog,selection_policy_version}'
       is distinct from 'atinara-kalshi-radar-series-catalog-v2'
     or checkpoint_input #>> '{catalog,entity_policy_version}'
       is distinct from 'atinara-kalshi-catalog-entities-v1'
     or coalesce(checkpoint_input #>> '{catalog,entity_terms_hash}','')
       !~ '^[a-f0-9]{64}$'
     or coalesce(checkpoint_input #>> '{catalog,entity_term_count}','')
       !~ '^\d{1,4}$'
     or checkpoint_input #>> '{catalog,projection_version}'
       is distinct from 'atinara-kalshi-series-catalog-projection-v1'
     or checkpoint_input #>> '{catalog,provider_pagination_exhausted}' is distinct from 'true'
     or checkpoint_input #> '{catalog,provider_cursor}' is distinct from 'null'::jsonb
     or coalesce(checkpoint_input #>> '{catalog,provider_catalog_hash}','')
       !~ '^[a-f0-9]{64}$'
     or coalesce(checkpoint_input #>> '{catalog,total_provider_series_count}','')
       !~ '^\d{1,6}$'
     or coalesce(checkpoint_input #>> '{catalog,selected_series_count}','')
       !~ '^\d{1,4}$'
     or jsonb_typeof(checkpoint_input #> '{catalog,checked_at}') is distinct from 'string'
     or checkpoint_input #>> '{catalog,checked_at}'
       is distinct from checkpoint_input ->> 'checked_at' then
    raise exception 'RADAR_PROVIDER_DISCOVERY_CATALOG_EVIDENCE_INVALID' using errcode = '22023';
  end if;

  total_provider_series_count_value :=
    (checkpoint_input #>> '{catalog,total_provider_series_count}')::integer;
  entity_term_count_value := (checkpoint_input #>> '{catalog,entity_term_count}')::integer;
  if sequence_value not between 1 and 1000
     or total_series_count_value not between 1 and 2000
     or total_provider_series_count_value not between total_series_count_value and 100000
     or entity_term_count_value not between 0 and 1000
     or (checkpoint_input #>> '{catalog,selected_series_count}')::integer
       <> total_series_count_value
     or completed_series_count_value not between 0 and total_series_count_value
     or failed_series_count_value not between 0 and total_series_count_value
     or pending_series_count_value not between 0 and total_series_count_value
     or completed_series_count_value + failed_series_count_value
       + pending_series_count_value <> total_series_count_value
     or retryable_failed_series_count_value not between 0 and failed_series_count_value
     or exhausted_failed_series_count_value not between 0 and failed_series_count_value
     or retryable_failed_series_count_value + exhausted_failed_series_count_value
       <> failed_series_count_value
     or total_parent_count_value not between 0 and 2000
     or jsonb_array_length(checkpoint_input -> 'series') <> total_series_count_value
     or jsonb_array_length(checkpoint_input -> 'series_results')
       <> completed_series_count_value + failed_series_count_value
     or (checkpoint_input ->> 'checked_at')::timestamptz is null
     or (checkpoint_input #>> '{catalog,checked_at}')::timestamptz is null
     or (sequence_value = 1 and previous_checkpoint_hash_value is not null)
     or (sequence_value > 1
       and coalesce(previous_checkpoint_hash_value,'') !~ '^[a-f0-9]{64}$')
     or (sequence_value = 1
       and checkpoint_input -> 'last_batch_checked_at' is distinct from 'null'::jsonb)
     or (sequence_value > 1 and (
       jsonb_typeof(checkpoint_input -> 'last_batch_checked_at') is distinct from 'string'
       or (checkpoint_input ->> 'last_batch_checked_at')::timestamptz is null
     )) then
    raise exception 'RADAR_PROVIDER_DISCOVERY_CHECKPOINT_V2_INVALID' using errcode = '22023';
  end if;

  if exists (
       select 1
       from jsonb_array_elements(checkpoint_input -> 'series') item
       where jsonb_typeof(item) <> 'object'
          or nullif(btrim(item ->> 'ticker'),'') is null
          or char_length(item ->> 'ticker') > 120
          or jsonb_typeof(item -> 'catalog_signals') is distinct from 'array'
          or jsonb_array_length(item -> 'catalog_signals') = 0
          or jsonb_typeof(item -> 'catalog_entity_matches') is distinct from 'array'
          or jsonb_typeof(item -> 'radar_themes') is distinct from 'array'
          or item ->> 'inferred_atinara_category' is null
          or item ->> 'inferred_atinara_category' not in (
            'Lanzamientos','Eventos','Industria','Streamers','Reviews/Premios','YouTubers'
          )
     )
     or total_series_count_value <> (
       select count(distinct item ->> 'ticker')
       from jsonb_array_elements(checkpoint_input -> 'series') item
     )
     or exists (
       select 1
       from jsonb_array_elements(checkpoint_input -> 'series_results') item
       where jsonb_typeof(item) <> 'object'
          or nullif(btrim(item ->> 'series_ticker'),'') is null
          or char_length(item ->> 'series_ticker') > 120
          or item ->> 'status' not in ('fulfilled','rejected')
          or coalesce(item ->> 'attempt_count','') !~ '^\d{1,4}$'
          or (item ->> 'attempt_count')::integer not between 1 and 4
          or jsonb_typeof(item -> 'checked_at') is distinct from 'string'
          or (item ->> 'checked_at')::timestamptz is null
          or jsonb_typeof(item -> 'events') is distinct from 'array'
          or not exists (
            select 1
            from jsonb_array_elements(checkpoint_input -> 'series') series_item
            where series_item ->> 'ticker' = item ->> 'series_ticker'
          )
          or (item ->> 'status' = 'fulfilled' and (
            item ->> 'error_code' is not null
            or item ->> 'retry_after_at' is not null
          ))
          or (item ->> 'status' = 'rejected' and (
            coalesce(item ->> 'error_code','') !~ '^[A-Z][A-Z0-9_]{2,100}$'
            or jsonb_array_length(item -> 'events') <> 0
            or (item ->> 'retry_after_at' is not null
              and (item ->> 'retry_after_at')::timestamptz is null)
          ))
     )
     or completed_series_count_value + failed_series_count_value <> (
       select count(distinct item ->> 'series_ticker')
       from jsonb_array_elements(checkpoint_input -> 'series_results') item
     ) then
    raise exception 'RADAR_PROVIDER_DISCOVERY_SERIES_RESULT_INVALID' using errcode = '22023';
  end if;

  select
    count(*) filter (where item ->> 'status' = 'fulfilled'),
    count(*) filter (where item ->> 'status' = 'rejected'),
    count(*) filter (where item ->> 'status' = 'rejected'
      and (item ->> 'attempt_count')::integer < 4),
    count(*) filter (where item ->> 'status' = 'rejected'
      and (item ->> 'attempt_count')::integer = 4)
  into actual_completed_series_count, actual_failed_series_count,
    actual_retryable_failed_series_count, actual_exhausted_failed_series_count
  from jsonb_array_elements(checkpoint_input -> 'series_results') item;

  select count(*), count(distinct event_item ->> 'event_ticker')
  into actual_parent_count, unique_parent_count
  from jsonb_array_elements(checkpoint_input -> 'series_results') result_item
  cross join lateral jsonb_array_elements(result_item -> 'events') event_item;

  if actual_completed_series_count <> completed_series_count_value
     or actual_failed_series_count <> failed_series_count_value
     or actual_retryable_failed_series_count <> retryable_failed_series_count_value
     or actual_exhausted_failed_series_count <> exhausted_failed_series_count_value
     or total_series_count_value - actual_completed_series_count
       - actual_failed_series_count <> pending_series_count_value
     or actual_parent_count <> total_parent_count_value
     or unique_parent_count <> total_parent_count_value
     or exists (
       select 1
       from jsonb_array_elements(checkpoint_input -> 'series_results') result_item
       cross join lateral jsonb_array_elements(result_item -> 'events') event_item
       where jsonb_typeof(event_item) <> 'object'
          or nullif(btrim(event_item ->> 'event_ticker'),'') is null
          or char_length(event_item ->> 'event_ticker') > 160
          or event_item ->> 'series_ticker' is distinct from result_item ->> 'series_ticker'
     ) then
    raise exception 'RADAR_PROVIDER_DISCOVERY_PARENT_MEMBERSHIP_INVALID' using errcode = '22023';
  end if;

  checkpoint_hash_value := encode(
    extensions.digest(convert_to(checkpoint_input::text,'UTF8'),'sha256'),'hex'
  );
  select * into latest
  from private.market_radar_provider_discovery_checkpoints_v2
  where request_id = request_id_input
    and provider = provider_input
    and capability = capability_input
  order by sequence desc
  limit 1
  for update;

  if found and sequence_value = latest.sequence then
    if latest.checkpoint is distinct from checkpoint_input
       or latest.checkpoint_hash is distinct from checkpoint_hash_value then
      raise exception 'RADAR_PROVIDER_DISCOVERY_CHECKPOINT_V2_CONFLICT' using errcode = '40001';
    end if;
    stored := latest;
    replayed_value := true;
  else
    if (latest.sequence is null and sequence_value <> 1)
       or (latest.sequence is not null and (
         sequence_value <> latest.sequence + 1
         or previous_checkpoint_hash_value is distinct from latest.checkpoint_hash
         or checkpoint_input -> 'catalog' is distinct from latest.checkpoint -> 'catalog'
         or checkpoint_input -> 'series' is distinct from latest.checkpoint -> 'series'
         or checkpoint_input ->> 'checked_at'
           is distinct from latest.checkpoint ->> 'checked_at'
       )) then
      raise exception 'RADAR_PROVIDER_DISCOVERY_CHECKPOINT_CHAIN_INVALID' using errcode = '40001';
    end if;

    if latest.sequence is null then
      if jsonb_array_length(checkpoint_input -> 'series_results') <> 0
         or completed_series_count_value <> 0
         or failed_series_count_value <> 0
         or pending_series_count_value <> total_series_count_value
         or retryable_failed_series_count_value <> 0
         or exhausted_failed_series_count_value <> 0
         or total_parent_count_value <> 0 then
        raise exception 'RADAR_PROVIDER_DISCOVERY_CHECKPOINT_INITIAL_INVALID' using errcode = '22023';
      end if;
    else
      if exists (
           select 1
           from jsonb_array_elements(latest.checkpoint -> 'series_results') previous_result
           where not exists (
             select 1
             from jsonb_array_elements(checkpoint_input -> 'series_results') next_result
             where next_result ->> 'series_ticker'
               = previous_result ->> 'series_ticker'
           )
         )
         or exists (
           select 1
           from jsonb_array_elements(latest.checkpoint -> 'series_results') previous_result
           join jsonb_array_elements(checkpoint_input -> 'series_results') next_result
             on next_result ->> 'series_ticker' = previous_result ->> 'series_ticker'
           where previous_result ->> 'status' = 'fulfilled'
             and next_result is distinct from previous_result
         )
         or exists (
           select 1
           from jsonb_array_elements(latest.checkpoint -> 'series_results') previous_result
           join jsonb_array_elements(checkpoint_input -> 'series_results') next_result
             on next_result ->> 'series_ticker' = previous_result ->> 'series_ticker'
           where previous_result ->> 'status' = 'rejected'
             and next_result is distinct from previous_result
             and (
               (next_result ->> 'attempt_count')::integer
                 <> (previous_result ->> 'attempt_count')::integer + 1
               or (next_result ->> 'checked_at')::timestamptz
                 < (previous_result ->> 'checked_at')::timestamptz
             )
         )
         or exists (
           select 1
           from jsonb_array_elements(checkpoint_input -> 'series_results') next_result
           where not exists (
             select 1
             from jsonb_array_elements(latest.checkpoint -> 'series_results') previous_result
             where previous_result ->> 'series_ticker'
               = next_result ->> 'series_ticker'
           )
           and (next_result ->> 'attempt_count')::integer <> 1
         ) then
        raise exception 'RADAR_PROVIDER_DISCOVERY_CHECKPOINT_TRANSITION_INVALID'
          using errcode = '40001';
      end if;

      select count(*), max((next_result ->> 'checked_at')::timestamptz)
      into changed_result_count, changed_checked_at
      from jsonb_array_elements(checkpoint_input -> 'series_results') next_result
      left join jsonb_array_elements(latest.checkpoint -> 'series_results') previous_result
        on previous_result ->> 'series_ticker' = next_result ->> 'series_ticker'
      where previous_result is null or next_result is distinct from previous_result;

      if changed_result_count not between 1 and 48
         or changed_checked_at is distinct from
           (checkpoint_input ->> 'last_batch_checked_at')::timestamptz
         or completed_series_count_value < latest.completed_series_count
         or pending_series_count_value > latest.pending_series_count
         or total_parent_count_value < latest.total_parent_count then
        raise exception 'RADAR_PROVIDER_DISCOVERY_CHECKPOINT_BATCH_INVALID' using errcode = '22023';
      end if;
    end if;

    insert into private.market_radar_provider_discovery_checkpoints_v2(
      request_id, provider, capability, sequence, checkpoint_version,
      previous_checkpoint_hash, provider_catalog_hash, entity_terms_hash,
      entity_term_count, total_provider_series_count,
      total_series_count, completed_series_count, failed_series_count,
      pending_series_count, retryable_failed_series_count,
      exhausted_failed_series_count, total_parent_count, checkpoint, checkpoint_hash
    ) values (
      request_id_input, provider_input, capability_input, sequence_value,
      'atinara-provider-discovery-checkpoint-v2', previous_checkpoint_hash_value,
      checkpoint_input #>> '{catalog,provider_catalog_hash}',
      checkpoint_input #>> '{catalog,entity_terms_hash}', entity_term_count_value,
      total_provider_series_count_value, total_series_count_value,
      completed_series_count_value, failed_series_count_value,
      pending_series_count_value, retryable_failed_series_count_value,
      exhausted_failed_series_count_value, total_parent_count_value,
      checkpoint_input, checkpoint_hash_value
    ) on conflict (request_id, provider, capability, sequence) do nothing;

    select * into stored
    from private.market_radar_provider_discovery_checkpoints_v2
    where request_id = request_id_input
      and provider = provider_input
      and capability = capability_input
      and sequence = sequence_value;
    if stored.checkpoint is distinct from checkpoint_input
       or stored.checkpoint_hash is distinct from checkpoint_hash_value then
      raise exception 'RADAR_PROVIDER_DISCOVERY_CHECKPOINT_V2_CONFLICT' using errcode = '40001';
    end if;
  end if;

  previous_phase_value := intent.phase;
  update private.market_radar_refresh_intents_v1 set
    phase = 'fetching',
    issue = null,
    response_summary = jsonb_build_object(
      'outcome','in_progress',
      'code','RADAR_PROVIDER_DISCOVERY_CHECKPOINTED',
      'request_id',request_id_input,
      'provider',provider_input,
      'capability',capability_input,
      'checkpoint_version','atinara-provider-discovery-checkpoint-v2',
      'checkpoint_sequence',stored.sequence,
      'checkpoint_hash',stored.checkpoint_hash,
      'previous_checkpoint_hash',stored.previous_checkpoint_hash,
      'provider_catalog_hash',stored.provider_catalog_hash,
      'entity_terms_hash',stored.entity_terms_hash,
      'entity_term_count',stored.entity_term_count,
      'total_provider_series_count',stored.total_provider_series_count,
      'total_series_count',stored.total_series_count,
      'completed_series_count',stored.completed_series_count,
      'failed_series_count',stored.failed_series_count,
      'pending_series_count',stored.pending_series_count,
      'retryable_failed_series_count',stored.retryable_failed_series_count,
      'exhausted_failed_series_count',stored.exhausted_failed_series_count,
      'total_parent_count',stored.total_parent_count,
      'replayed',replayed_value,
      'retryable',true,
      'next_action','resume_provider_discovery'
    ),
    lease_expires_at = clock_timestamp(),
    updated_at = clock_timestamp()
  where request_id = request_id_input
    and provider = provider_input
    and capability = capability_input;

  perform private.record_market_radar_refresh_event_v1(
    request_id_input, provider_input, capability_input,
    'RADAR_PROVIDER_DISCOVERY_CHECKPOINTED', previous_phase_value, 'fetching',
    intent.accepted_count, intent.quarantined_count, intent.failed_count,
    null, null
  );
  return jsonb_build_object(
    'ok',true,
    'outcome','in_progress',
    'request_id',request_id_input,
    'provider',provider_input,
    'capability',capability_input,
    'phase','fetching',
    'checkpoint_version','atinara-provider-discovery-checkpoint-v2',
    'sequence',stored.sequence,
    'checkpoint_hash',stored.checkpoint_hash,
    'previous_checkpoint_hash',stored.previous_checkpoint_hash,
    'provider_catalog_hash',stored.provider_catalog_hash,
    'entity_terms_hash',stored.entity_terms_hash,
    'entity_term_count',stored.entity_term_count,
    'total_provider_series_count',stored.total_provider_series_count,
    'total_series_count',stored.total_series_count,
    'completed_series_count',stored.completed_series_count,
    'failed_series_count',stored.failed_series_count,
    'pending_series_count',stored.pending_series_count,
    'retryable_failed_series_count',stored.retryable_failed_series_count,
    'exhausted_failed_series_count',stored.exhausted_failed_series_count,
    'total_parent_count',stored.total_parent_count,
    'replayed',replayed_value,
    'retryable',true,
    'next_action','resume_provider_discovery'
  );
exception
  when invalid_text_representation or datetime_field_overflow or numeric_value_out_of_range then
    raise exception 'RADAR_PROVIDER_DISCOVERY_CHECKPOINT_V2_INVALID' using errcode = '22023';
end;
$function$;

alter function public.checkpoint_market_radar_provider_discovery_v2(uuid,text,text,uuid,jsonb)
  owner to postgres;
revoke all on function public.checkpoint_market_radar_provider_discovery_v2(uuid,text,text,uuid,jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.checkpoint_market_radar_provider_discovery_v2(uuid,text,text,uuid,jsonb)
  to service_role;

create or replace function public.get_market_radar_provider_discovery_checkpoint_v2(
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
  stored private.market_radar_provider_discovery_checkpoints_v2%rowtype;
begin
  if auth.role() <> 'service_role' then
    raise exception 'SERVICE_ROLE_REQUIRED' using errcode = '42501';
  end if;
  perform private.assert_market_radar_refresh_lease_v1(
    request_id_input, provider_input, capability_input, lease_token_input
  );
  select * into stored
  from private.market_radar_provider_discovery_checkpoints_v2
  where request_id = request_id_input
    and provider = provider_input
    and capability = capability_input
  order by sequence desc
  limit 1;
  if not found then return null; end if;
  return jsonb_build_object(
    'checkpoint',stored.checkpoint,
    'checkpoint_version',stored.checkpoint_version,
    'sequence',stored.sequence,
    'checkpoint_hash',stored.checkpoint_hash,
    'previous_checkpoint_hash',stored.previous_checkpoint_hash,
    'provider_catalog_hash',stored.provider_catalog_hash,
    'entity_terms_hash',stored.entity_terms_hash,
    'entity_term_count',stored.entity_term_count,
    'total_provider_series_count',stored.total_provider_series_count,
    'total_series_count',stored.total_series_count,
    'completed_series_count',stored.completed_series_count,
    'failed_series_count',stored.failed_series_count,
    'pending_series_count',stored.pending_series_count,
    'retryable_failed_series_count',stored.retryable_failed_series_count,
    'exhausted_failed_series_count',stored.exhausted_failed_series_count,
    'total_parent_count',stored.total_parent_count,
    'created_at',stored.created_at
  );
end;
$function$;

alter function public.get_market_radar_provider_discovery_checkpoint_v2(uuid,text,text,uuid)
  owner to postgres;
revoke all on function public.get_market_radar_provider_discovery_checkpoint_v2(uuid,text,text,uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.get_market_radar_provider_discovery_checkpoint_v2(uuid,text,text,uuid)
  to service_role;

create or replace function public.defer_market_radar_provider_discovery_v2(
  request_id_input uuid,
  provider_input text,
  capability_input text,
  lease_token_input uuid,
  issue_code_input text,
  retry_after_at_input timestamptz default null
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
  issue_fingerprint_value text;
  retry_after_value timestamptz;
  previous_phase_value text;
  now_value timestamptz := clock_timestamp();
begin
  if auth.role() <> 'service_role' then
    raise exception 'SERVICE_ROLE_REQUIRED' using errcode = '42501';
  end if;
  intent := private.assert_market_radar_refresh_lease_v1(
    request_id_input, provider_input, capability_input, lease_token_input
  );
  if provider_input <> 'kalshi'
     or capability_input <> 'candidate_feed'
     or intent.phase not in ('claimed','fetching')
     or issue_code_input not in (
       'PROVIDER_RATE_LIMITED','PROVIDER_TIMEOUT',
       'PROVIDER_UNAVAILABLE','PROVIDER_INVALID_RESPONSE'
     ) then
    raise exception 'RADAR_PROVIDER_DISCOVERY_DEFERRAL_INVALID' using errcode = '22023';
  end if;

  retry_after_value := case
    when retry_after_at_input is null or retry_after_at_input <= now_value
      then now_value + interval '5 seconds'
    else least(retry_after_at_input, now_value + interval '15 minutes')
  end;
  previous_phase_value := intent.phase;
  select * into circuit
  from private.market_radar_provider_circuits_v1
  where provider = provider_input and capability = capability_input;
  issue_fingerprint_value := encode(extensions.digest(convert_to(concat_ws('|',
    request_id_input::text, provider_input, capability_input, issue_code_input,
    'provider_discovery', 'provider', 'resume_provider_discovery'
  ),'UTF8'),'sha256'),'hex');
  issue_value := jsonb_build_object(
    'issue_id',gen_random_uuid(),
    'issue_code',issue_code_input,
    'detected_by','radar',
    'owner_stage','provider',
    'severity','warning',
    'repairability','auto_recoverable',
    'blocking_scope','none',
    'affected_fields',jsonb_build_array('provider_catalog','series_events'),
    'evidence_refs',jsonb_build_array(jsonb_build_object(
      'request_id',request_id_input,
      'provider',provider_input,
      'capability',capability_input
    )),
    'current_value',jsonb_build_object(
      'provider',provider_input,
      'capability',capability_input,
      'failure_stage','provider_discovery',
      'last_success_at',circuit.last_success_at,
      'last_success_count',coalesce(circuit.last_success_count,0),
      'retry_after_at',retry_after_value
    ),
    'proposed_value',null,
    'confidence',100,
    'policy_version','atinara-radar-provider-discovery-resilience-v2',
    'schema_version','atinara-market-issue-v1',
    'fingerprint',issue_fingerprint_value,
    'status','open',
    'retryable',true,
    'next_action','resume_provider_discovery',
    'created_at',now_value,
    'updated_at',now_value,
    'resolved_at',null,
    'resolution_method',null
  );
  perform private.assert_market_workflow_issue_v1(issue_value);

  update private.market_radar_refresh_intents_v1 set
    phase = 'fetching',
    issue = issue_value,
    response_summary = jsonb_build_object(
      'outcome','in_progress',
      'code','RADAR_PROVIDER_DISCOVERY_DEFERRED',
      'cause_code',issue_code_input,
      'request_id',request_id_input,
      'provider',provider_input,
      'capability',capability_input,
      'phase','fetching',
      'retry_after_at',retry_after_value,
      'issue',issue_value,
      'retryable',true,
      'next_action','resume_provider_discovery'
    ),
    lease_expires_at = retry_after_value,
    updated_at = now_value
  where request_id = request_id_input
    and provider = provider_input
    and capability = capability_input
  returning * into intent;

  perform private.record_market_radar_refresh_event_v1(
    request_id_input, provider_input, capability_input,
    'RADAR_PROVIDER_DISCOVERY_DEFERRED', previous_phase_value, 'fetching',
    intent.accepted_count, intent.quarantined_count, intent.failed_count,
    issue_code_input, issue_value
  );
  return jsonb_build_object(
    'ok',true,
    'outcome','in_progress',
    'code','RADAR_PROVIDER_DISCOVERY_DEFERRED',
    'cause_code',issue_code_input,
    'request_id',request_id_input,
    'provider',provider_input,
    'capability',capability_input,
    'phase','fetching',
    'retry_after_at',retry_after_value,
    'issue',issue_value,
    'retryable',true,
    'next_action','resume_provider_discovery'
  );
end;
$function$;

alter function public.defer_market_radar_provider_discovery_v2(uuid,text,text,uuid,text,timestamptz)
  owner to postgres;
revoke all on function public.defer_market_radar_provider_discovery_v2(uuid,text,text,uuid,text,timestamptz)
  from public, anon, authenticated, service_role;
grant execute on function public.defer_market_radar_provider_discovery_v2(uuid,text,text,uuid,text,timestamptz)
  to service_role;

comment on table private.market_radar_provider_discovery_checkpoints_v2 is
  'Snapshots append-only del catálogo global Kalshi y de sus series seleccionadas. Cada secuencia conserva hash, pertenencia padre-serie y progreso reanudable de una única UUID.';
comment on function public.checkpoint_market_radar_provider_discovery_v2(uuid,text,text,uuid,jsonb) is
  'Sella hasta 48 transiciones de series por secuencia, valida la cadena completa y libera el lease sin presentar un catálogo parcial como fresco.';
comment on function public.get_market_radar_provider_discovery_checkpoint_v2(uuid,text,text,uuid) is
  'Lee bajo lease service-only el último snapshot V2 de discovery para reanudar la misma intención.';
comment on function public.defer_market_radar_provider_discovery_v2(uuid,text,text,uuid,text,timestamptz) is
  'Conserva una caída transitoria de catálogo o series como incidencia no bloqueante y reanudable, con cooldown explícito sobre la misma UUID.';

do $postflight$
declare
  relation_oid oid := to_regclass('private.market_radar_provider_discovery_checkpoints_v2');
begin
  if relation_oid is null then
    raise exception 'RADAR_PROVIDER_DISCOVERY_CHECKPOINT_V2_TABLE_MISSING';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_class
    where oid = relation_oid and relrowsecurity and relforcerowsecurity
  ) then
    raise exception 'RADAR_PROVIDER_DISCOVERY_CHECKPOINT_V2_RLS_MISSING';
  end if;
  if not has_function_privilege(
    'service_role',
    'public.checkpoint_market_radar_provider_discovery_v2(uuid,text,text,uuid,jsonb)',
    'EXECUTE'
  ) or not has_function_privilege(
    'service_role',
    'public.get_market_radar_provider_discovery_checkpoint_v2(uuid,text,text,uuid)',
    'EXECUTE'
  ) or not has_function_privilege(
    'service_role',
    'public.defer_market_radar_provider_discovery_v2(uuid,text,text,uuid,text,timestamptz)',
    'EXECUTE'
  ) then
    raise exception 'RADAR_PROVIDER_DISCOVERY_CHECKPOINT_V2_PRIVILEGE_MISSING';
  end if;
  if has_function_privilege(
    'authenticated',
    'public.checkpoint_market_radar_provider_discovery_v2(uuid,text,text,uuid,jsonb)',
    'EXECUTE'
  ) or has_function_privilege(
    'authenticated',
    'public.get_market_radar_provider_discovery_checkpoint_v2(uuid,text,text,uuid)',
    'EXECUTE'
  ) or has_function_privilege(
    'authenticated',
    'public.defer_market_radar_provider_discovery_v2(uuid,text,text,uuid,text,timestamptz)',
    'EXECUTE'
  ) then
    raise exception 'RADAR_PROVIDER_DISCOVERY_CHECKPOINT_V2_EXPOSED';
  end if;
end;
$postflight$;

commit;
