begin;

alter table private.market_radar_refresh_intents_v1
  drop constraint if exists market_radar_refresh_intents_v1_provider_selection_check,
  add constraint market_radar_refresh_intents_v1_provider_selection_check
    check (provider_selection is null or (
      jsonb_typeof(provider_selection) = 'object'
      and octet_length(provider_selection::text) <= 1048576
    ));

create table private.market_radar_provider_discovery_checkpoints_v1 (
  request_id uuid not null,
  provider text not null check (provider = 'kalshi'),
  capability text not null check (capability = 'candidate_feed'),
  checkpoint_version text not null
    check (checkpoint_version = 'atinara-provider-discovery-checkpoint-v1'),
  total_series_count integer not null check (total_series_count between 0 and 2000),
  completed_series_count integer not null check (completed_series_count between 0 and 2000),
  failed_series_count integer not null check (failed_series_count between 0 and 2000),
  total_parent_count integer not null check (total_parent_count between 0 and 2000),
  checkpoint jsonb not null check (
    jsonb_typeof(checkpoint) = 'object'
    and octet_length(checkpoint::text) <= 2097152
  ),
  checkpoint_hash text not null check (checkpoint_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default clock_timestamp(),
  primary key (request_id, provider, capability),
  foreign key (request_id, provider, capability)
    references private.market_radar_refresh_intents_v1(request_id, provider, capability)
    on delete restrict
);

alter table private.market_radar_provider_discovery_checkpoints_v1 enable row level security;
alter table private.market_radar_provider_discovery_checkpoints_v1 force row level security;
revoke all on table private.market_radar_provider_discovery_checkpoints_v1
  from public, anon, authenticated, service_role;

create or replace function private.reject_market_radar_provider_discovery_checkpoint_mutation_v1()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  raise exception 'RADAR_PROVIDER_DISCOVERY_CHECKPOINT_APPEND_ONLY' using errcode = '55000';
end;
$function$;

revoke all on function private.reject_market_radar_provider_discovery_checkpoint_mutation_v1()
  from public, anon, authenticated, service_role;

create trigger market_radar_provider_discovery_checkpoint_append_only_v1
before update or delete on private.market_radar_provider_discovery_checkpoints_v1
for each row execute function private.reject_market_radar_provider_discovery_checkpoint_mutation_v1();

create or replace function public.checkpoint_market_radar_provider_discovery_v1(
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
  stored private.market_radar_provider_discovery_checkpoints_v1%rowtype;
  total_series_count_value integer;
  completed_series_count_value integer;
  failed_series_count_value integer;
  total_parent_count_value integer;
  checkpoint_hash_value text;
  previous_phase_value text;
  checked_at_value timestamptz;
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
          is distinct from 'atinara-provider-discovery-checkpoint-v1'
     or jsonb_typeof(checkpoint_input -> 'series') <> 'array'
     or jsonb_typeof(checkpoint_input -> 'events') <> 'array'
     or jsonb_typeof(checkpoint_input -> 'failed_series_ids') <> 'array'
     or jsonb_typeof(checkpoint_input -> 'checked_at') is distinct from 'string'
     or nullif(btrim(checkpoint_input ->> 'checked_at'),'') is null
     or coalesce(checkpoint_input ->> 'total_series_count','') !~ '^\d{1,4}$'
     or coalesce(checkpoint_input ->> 'completed_series_count','') !~ '^\d{1,4}$'
     or coalesce(checkpoint_input ->> 'failed_series_count','') !~ '^\d{1,4}$'
     or coalesce(checkpoint_input ->> 'total_parent_count','') !~ '^\d{1,4}$'
     or octet_length(checkpoint_input::text) > 2097152 then
    raise exception 'RADAR_PROVIDER_DISCOVERY_CHECKPOINT_INVALID' using errcode = '22023';
  end if;

  total_series_count_value := (checkpoint_input ->> 'total_series_count')::integer;
  completed_series_count_value := (checkpoint_input ->> 'completed_series_count')::integer;
  failed_series_count_value := (checkpoint_input ->> 'failed_series_count')::integer;
  total_parent_count_value := (checkpoint_input ->> 'total_parent_count')::integer;

  if total_series_count_value not between 0 and 2000
     or completed_series_count_value not between 0 and total_series_count_value
     or failed_series_count_value not between 0 and total_series_count_value
     or completed_series_count_value + failed_series_count_value <> total_series_count_value
     or total_parent_count_value not between 0 and 2000
     or jsonb_array_length(checkpoint_input -> 'series') <> total_series_count_value
     or jsonb_array_length(checkpoint_input -> 'events') <> total_parent_count_value
     or jsonb_array_length(checkpoint_input -> 'failed_series_ids') <> failed_series_count_value
     or exists (
       select 1
       from jsonb_array_elements(checkpoint_input -> 'series') item
       where jsonb_typeof(item) <> 'object'
          or nullif(btrim(item ->> 'ticker'),'') is null
          or char_length(item ->> 'ticker') > 120
     )
     or total_series_count_value <> (
       select count(distinct item ->> 'ticker')
       from jsonb_array_elements(checkpoint_input -> 'series') item
     )
     or exists (
       select 1
       from jsonb_array_elements(checkpoint_input -> 'events') item
       where jsonb_typeof(item) <> 'object'
          or nullif(btrim(item ->> 'event_ticker'),'') is null
          or char_length(item ->> 'event_ticker') > 160
          or nullif(btrim(item ->> 'series_ticker'),'') is null
          or char_length(item ->> 'series_ticker') > 120
          or not exists (
            select 1
            from jsonb_array_elements(checkpoint_input -> 'series') series_item
            where series_item ->> 'ticker' = item ->> 'series_ticker'
          )
     )
     or total_parent_count_value <> (
       select count(distinct item ->> 'event_ticker')
       from jsonb_array_elements(checkpoint_input -> 'events') item
     )
     or exists (
       select 1
       from jsonb_array_elements_text(checkpoint_input -> 'failed_series_ids') as failed(failed_id)
       where nullif(btrim(failed_id),'') is null
          or char_length(failed_id) > 120
          or not exists (
            select 1
            from jsonb_array_elements(checkpoint_input -> 'series') series_item
            where series_item ->> 'ticker' = failed_id
          )
     )
     or failed_series_count_value <> (
       select count(distinct failed_id)
       from jsonb_array_elements_text(checkpoint_input -> 'failed_series_ids') as failed(failed_id)
     ) then
    raise exception 'RADAR_PROVIDER_DISCOVERY_CHECKPOINT_INVALID' using errcode = '22023';
  end if;

  checked_at_value := (checkpoint_input ->> 'checked_at')::timestamptz;
  checkpoint_hash_value := encode(
    extensions.digest(convert_to(checkpoint_input::text,'UTF8'),'sha256'),'hex'
  );

  insert into private.market_radar_provider_discovery_checkpoints_v1(
    request_id, provider, capability, checkpoint_version,
    total_series_count, completed_series_count, failed_series_count,
    total_parent_count, checkpoint, checkpoint_hash
  ) values (
    request_id_input, provider_input, capability_input,
    'atinara-provider-discovery-checkpoint-v1', total_series_count_value,
    completed_series_count_value, failed_series_count_value,
    total_parent_count_value, checkpoint_input, checkpoint_hash_value
  ) on conflict (request_id, provider, capability) do nothing;

  select * into stored
  from private.market_radar_provider_discovery_checkpoints_v1
  where request_id = request_id_input
    and provider = provider_input
    and capability = capability_input;
  if stored.checkpoint is distinct from checkpoint_input
     or stored.checkpoint_hash is distinct from checkpoint_hash_value then
    raise exception 'RADAR_PROVIDER_DISCOVERY_CHECKPOINT_CONFLICT' using errcode = '40001';
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
      'checkpoint_hash',checkpoint_hash_value,
      'total_series_count',total_series_count_value,
      'completed_series_count',completed_series_count_value,
      'failed_series_count',failed_series_count_value,
      'total_parent_count',total_parent_count_value,
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
    'checkpoint_hash',checkpoint_hash_value,
    'total_series_count',total_series_count_value,
    'completed_series_count',completed_series_count_value,
    'failed_series_count',failed_series_count_value,
    'total_parent_count',total_parent_count_value,
    'retryable',true,
    'next_action','resume_provider_discovery'
  );
exception
  when invalid_text_representation or datetime_field_overflow or numeric_value_out_of_range then
    raise exception 'RADAR_PROVIDER_DISCOVERY_CHECKPOINT_INVALID' using errcode = '22023';
end;
$function$;

alter function public.checkpoint_market_radar_provider_discovery_v1(uuid,text,text,uuid,jsonb)
  owner to postgres;
revoke all on function public.checkpoint_market_radar_provider_discovery_v1(uuid,text,text,uuid,jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.checkpoint_market_radar_provider_discovery_v1(uuid,text,text,uuid,jsonb)
  to service_role;

create or replace function public.get_market_radar_provider_discovery_checkpoint_v1(
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
  stored private.market_radar_provider_discovery_checkpoints_v1%rowtype;
begin
  if auth.role() <> 'service_role' then
    raise exception 'SERVICE_ROLE_REQUIRED' using errcode = '42501';
  end if;
  perform private.assert_market_radar_refresh_lease_v1(
    request_id_input, provider_input, capability_input, lease_token_input
  );
  select * into stored
  from private.market_radar_provider_discovery_checkpoints_v1
  where request_id = request_id_input
    and provider = provider_input
    and capability = capability_input;
  if not found then return null; end if;
  return jsonb_build_object(
    'checkpoint',stored.checkpoint,
    'checkpoint_hash',stored.checkpoint_hash,
    'total_series_count',stored.total_series_count,
    'completed_series_count',stored.completed_series_count,
    'failed_series_count',stored.failed_series_count,
    'total_parent_count',stored.total_parent_count,
    'created_at',stored.created_at
  );
end;
$function$;

alter function public.get_market_radar_provider_discovery_checkpoint_v1(uuid,text,text,uuid)
  owner to postgres;
revoke all on function public.get_market_radar_provider_discovery_checkpoint_v1(uuid,text,text,uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.get_market_radar_provider_discovery_checkpoint_v1(uuid,text,text,uuid)
  to service_role;

create or replace function public.record_market_radar_provider_selection_v2(
  request_id_input uuid,
  provider_input text,
  capability_input text,
  lease_token_input uuid,
  selection_input jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
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
  if auth.role() <> 'service_role' then
    raise exception 'SERVICE_ROLE_REQUIRED' using errcode = '42501';
  end if;
  intent := private.assert_market_radar_refresh_lease_v1(
    request_id_input, provider_input, capability_input, lease_token_input
  );
  if capability_input <> 'candidate_feed'
     or jsonb_typeof(selection_input) <> 'object'
     or selection_input ->> 'policy_version'
          is distinct from 'atinara-radar-parent-selection-v1'
     or coalesce((selection_input ->> 'no_parent_truncated')::boolean,false) is not true
     or octet_length(selection_input::text) > 1048576
     or jsonb_typeof(coalesce(selection_input -> 'selected_parent_ids','[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(selection_input -> 'deferred_parent_ids','[]'::jsonb)) <> 'array'
     or jsonb_array_length(coalesce(selection_input -> 'selected_parent_ids','[]'::jsonb)) > 120
     or jsonb_array_length(coalesce(selection_input -> 'deferred_parent_ids','[]'::jsonb)) > 2000
     or coalesce(selection_input ->> 'total_parent_count','') !~ '^\d{1,4}$'
     or coalesce(selection_input ->> 'selected_parent_count','') !~ '^\d{1,3}$'
     or coalesce(selection_input ->> 'deferred_parent_count','') !~ '^\d{1,4}$'
     or coalesce(selection_input ->> 'selected_child_count','') !~ '^\d{1,3}$' then
    raise exception 'RADAR_PROVIDER_SELECTION_INVALID' using errcode = '22023';
  end if;
  total_parent_count_value := (selection_input ->> 'total_parent_count')::integer;
  selected_parent_count_value := (selection_input ->> 'selected_parent_count')::integer;
  deferred_parent_count_value := (selection_input ->> 'deferred_parent_count')::integer;
  selected_child_count_value := (selection_input ->> 'selected_child_count')::integer;
  selected_ids_count := jsonb_array_length(coalesce(selection_input -> 'selected_parent_ids','[]'::jsonb));
  deferred_ids_count := jsonb_array_length(coalesce(selection_input -> 'deferred_parent_ids','[]'::jsonb));
  if total_parent_count_value not between 0 and 2000
     or selected_parent_count_value not between 0 and 120
     or deferred_parent_count_value not between 0 and 2000
     or selected_child_count_value not between 0 and 480
     or selected_parent_count_value + deferred_parent_count_value <> total_parent_count_value
     or selected_ids_count <> selected_parent_count_value
     or deferred_ids_count <> deferred_parent_count_value
     or exists (
        select 1
        from jsonb_array_elements(
          coalesce(selection_input -> 'selected_parent_ids','[]'::jsonb) ||
          coalesce(selection_input -> 'deferred_parent_ids','[]'::jsonb)
       ) item
       where jsonb_typeof(item) <> 'string'
          or nullif(btrim(item #>> '{}'),'') is null
          or char_length(item #>> '{}') > 220
     )
     or selected_ids_count + deferred_ids_count <> (
        select count(distinct item #>> '{}')
        from jsonb_array_elements(
          coalesce(selection_input -> 'selected_parent_ids','[]'::jsonb) ||
          coalesce(selection_input -> 'deferred_parent_ids','[]'::jsonb)
       ) item
     ) then
    raise exception 'RADAR_PROVIDER_SELECTION_INVALID' using errcode = '22023';
  end if;
  if intent.provider_selection is not null
     and intent.provider_selection is distinct from selection_input then
    raise exception 'RADAR_PROVIDER_SELECTION_IDEMPOTENCY_CONFLICT' using errcode = '40001';
  end if;
  update private.market_radar_refresh_intents_v1 set
    provider_selection = coalesce(provider_selection, selection_input),
    updated_at = clock_timestamp()
  where request_id = request_id_input
    and provider = provider_input
    and capability = capability_input
  returning * into intent;
  return jsonb_build_object('ok',true,'provider_selection',intent.provider_selection);
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception 'RADAR_PROVIDER_SELECTION_INVALID' using errcode = '22023';
end;
$function$;

alter function public.record_market_radar_provider_selection_v2(uuid,text,text,uuid,jsonb)
  owner to postgres;
revoke all on function public.record_market_radar_provider_selection_v2(uuid,text,text,uuid,jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.record_market_radar_provider_selection_v2(uuid,text,text,uuid,jsonb)
  to service_role;

comment on table private.market_radar_provider_discovery_checkpoints_v1 is
  'Checkpoint durable e inmutable del índice Kalshi. Permite reanudar la misma UUID antes de enumerar hijas sin repetir el catálogo completo.';
comment on function public.checkpoint_market_radar_provider_discovery_v1(uuid,text,text,uuid,jsonb) is
  'Sella un índice completo de series y padres, libera el lease y conserva la intención en fetching para continuar la misma UUID.';
comment on function public.get_market_radar_provider_discovery_checkpoint_v1(uuid,text,text,uuid) is
  'Lee bajo lease service-only el checkpoint de discovery asociado a la intención vigente.';
comment on function public.record_market_radar_provider_selection_v2(uuid,text,text,uuid,jsonb) is
  'Registra hasta 2000 padres indexados, manteniendo como máximo 120 familias materializadas y 480 hijas.';

do $postflight$
declare
  relation_oid oid := to_regclass('private.market_radar_provider_discovery_checkpoints_v1');
begin
  if relation_oid is null then
    raise exception 'RADAR_PROVIDER_DISCOVERY_CHECKPOINT_TABLE_MISSING';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_class
    where oid = relation_oid and relrowsecurity and relforcerowsecurity
  ) then
    raise exception 'RADAR_PROVIDER_DISCOVERY_CHECKPOINT_RLS_MISSING';
  end if;
  if not has_function_privilege(
    'service_role',
    'public.checkpoint_market_radar_provider_discovery_v1(uuid,text,text,uuid,jsonb)',
    'EXECUTE'
  ) or not has_function_privilege(
    'service_role',
    'public.get_market_radar_provider_discovery_checkpoint_v1(uuid,text,text,uuid)',
    'EXECUTE'
  ) or not has_function_privilege(
    'service_role',
    'public.record_market_radar_provider_selection_v2(uuid,text,text,uuid,jsonb)',
    'EXECUTE'
  ) then
    raise exception 'RADAR_PROVIDER_DISCOVERY_CHECKPOINT_PRIVILEGE_MISSING';
  end if;
  if has_function_privilege(
    'authenticated',
    'public.checkpoint_market_radar_provider_discovery_v1(uuid,text,text,uuid,jsonb)',
    'EXECUTE'
  ) or has_function_privilege(
    'authenticated',
    'public.get_market_radar_provider_discovery_checkpoint_v1(uuid,text,text,uuid)',
    'EXECUTE'
  ) or has_function_privilege(
    'authenticated',
    'public.record_market_radar_provider_selection_v2(uuid,text,text,uuid,jsonb)',
    'EXECUTE'
  ) then
    raise exception 'RADAR_PROVIDER_DISCOVERY_CHECKPOINT_EXPOSED';
  end if;
end;
$postflight$;

commit;
