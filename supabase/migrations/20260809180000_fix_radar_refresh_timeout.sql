-- Corrige el timeout del Radar sin tocar mercados, predicciones ni economía.
-- El parser v4 confundía fragmentos ordinarios con barra (por ejemplo,
-- "and/or" y "X/S") con zonas IANA y recorría pg_timezone_names por fila.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

select pg_advisory_xact_lock(hashtextextended('atinara:radar-refresh-timeout-v1', 0));

do $preflight$
begin
  if to_regprocedure('private.market_family_timezone_token_v4(text)') is null
     or to_regprocedure('private.market_family_timezone_contract_v4(text,text)') is null
     or to_regprocedure('private.assign_market_candidate_family_v4()') is null
     or to_regclass('private.external_market_candidates') is null
     or to_regclass('private.market_radar_provider_runs') is null then
    raise exception 'RADAR_REFRESH_TIMEOUT_PREFLIGHT_FAILED';
  end if;
end;
$preflight$;

create or replace function private.market_family_timezone_token_v4(value_input text)
returns jsonb
language plpgsql
stable
set search_path = ''
as $function$
declare
  raw_value text := nullif(trim(value_input), '');
  compact_value text := regexp_replace(coalesce(raw_value, ''), '[[:space:]]+', '', 'g');
  upper_value text := upper(compact_value);
  offset_parts text[];
  offset_hours integer;
  offset_remainder integer;
  offset_minutes integer;
  offset_sign text;
  offset_id text;
  contract_value jsonb;
begin
  if raw_value is null then return null; end if;
  offset_parts := regexp_match(
    compact_value,
    '^(?:UTC|GMT)?([+-])([0-9]{1,2})(?::?([0-9]{2}))?$',
    'i'
  );
  if offset_parts is not null then
    offset_hours := offset_parts[2]::integer;
    offset_remainder := coalesce(nullif(offset_parts[3], ''), '0')::integer;
    if offset_hours > 14 or offset_remainder > 59
       or (offset_hours = 14 and offset_remainder <> 0) then
      return jsonb_build_object(
        'id', 'AMBIGUOUS:' || upper_value, 'mode', 'ambiguous',
        'offset_minutes', null, 'label', raw_value, 'ambiguous', true
      );
    end if;
    offset_minutes := (case when offset_parts[1] = '-' then -1 else 1 end)
      * ((offset_hours * 60) + offset_remainder);
    offset_sign := case when offset_minutes < 0 then '-' else '+' end;
    offset_id := case when offset_minutes = 0 then 'UTC' else concat(
      'UTC', offset_sign, lpad((abs(offset_minutes) / 60)::text, 2, '0'),
      ':', lpad((abs(offset_minutes) % 60)::text, 2, '0')
    ) end;
    return jsonb_build_object(
      'id', offset_id, 'mode', 'fixed_offset',
      'offset_minutes', offset_minutes, 'label', upper(raw_value), 'ambiguous', false
    );
  end if;

  contract_value := case upper_value
    when 'UTC' then jsonb_build_object('id', 'UTC', 'mode', 'fixed_offset', 'offset_minutes', 0, 'label', 'UTC', 'ambiguous', false)
    when 'GMT' then jsonb_build_object('id', 'UTC', 'mode', 'fixed_offset', 'offset_minutes', 0, 'label', 'GMT', 'ambiguous', false)
    when 'ET' then jsonb_build_object('id', 'America/New_York', 'mode', 'iana', 'offset_minutes', null, 'label', 'ET', 'ambiguous', false)
    when 'PT' then jsonb_build_object('id', 'America/Los_Angeles', 'mode', 'iana', 'offset_minutes', null, 'label', 'PT', 'ambiguous', false)
    when 'MT' then jsonb_build_object('id', 'America/Denver', 'mode', 'iana', 'offset_minutes', null, 'label', 'MT', 'ambiguous', false)
    when 'CT' then jsonb_build_object('id', 'America/Chicago', 'mode', 'iana', 'offset_minutes', null, 'label', 'CT', 'ambiguous', false)
    when 'EST' then jsonb_build_object('id', 'UTC-05:00', 'mode', 'fixed_offset', 'offset_minutes', -300, 'label', 'EST', 'ambiguous', false)
    when 'EDT' then jsonb_build_object('id', 'UTC-04:00', 'mode', 'fixed_offset', 'offset_minutes', -240, 'label', 'EDT', 'ambiguous', false)
    when 'PST' then jsonb_build_object('id', 'UTC-08:00', 'mode', 'fixed_offset', 'offset_minutes', -480, 'label', 'PST', 'ambiguous', false)
    when 'PDT' then jsonb_build_object('id', 'UTC-07:00', 'mode', 'fixed_offset', 'offset_minutes', -420, 'label', 'PDT', 'ambiguous', false)
    when 'MST' then jsonb_build_object('id', 'UTC-07:00', 'mode', 'fixed_offset', 'offset_minutes', -420, 'label', 'MST', 'ambiguous', false)
    when 'MDT' then jsonb_build_object('id', 'UTC-06:00', 'mode', 'fixed_offset', 'offset_minutes', -360, 'label', 'MDT', 'ambiguous', false)
    when 'AKST' then jsonb_build_object('id', 'UTC-09:00', 'mode', 'fixed_offset', 'offset_minutes', -540, 'label', 'AKST', 'ambiguous', false)
    when 'AKDT' then jsonb_build_object('id', 'UTC-08:00', 'mode', 'fixed_offset', 'offset_minutes', -480, 'label', 'AKDT', 'ambiguous', false)
    when 'HST' then jsonb_build_object('id', 'UTC-10:00', 'mode', 'fixed_offset', 'offset_minutes', -600, 'label', 'HST', 'ambiguous', false)
    when 'CET' then jsonb_build_object('id', 'UTC+01:00', 'mode', 'fixed_offset', 'offset_minutes', 60, 'label', 'CET', 'ambiguous', false)
    when 'CEST' then jsonb_build_object('id', 'UTC+02:00', 'mode', 'fixed_offset', 'offset_minutes', 120, 'label', 'CEST', 'ambiguous', false)
    when 'EET' then jsonb_build_object('id', 'UTC+02:00', 'mode', 'fixed_offset', 'offset_minutes', 120, 'label', 'EET', 'ambiguous', false)
    when 'EEST' then jsonb_build_object('id', 'UTC+03:00', 'mode', 'fixed_offset', 'offset_minutes', 180, 'label', 'EEST', 'ambiguous', false)
    when 'WET' then jsonb_build_object('id', 'UTC', 'mode', 'fixed_offset', 'offset_minutes', 0, 'label', 'WET', 'ambiguous', false)
    when 'WEST' then jsonb_build_object('id', 'UTC+01:00', 'mode', 'fixed_offset', 'offset_minutes', 60, 'label', 'WEST', 'ambiguous', false)
    when 'CST' then jsonb_build_object('id', 'AMBIGUOUS:CST', 'mode', 'ambiguous', 'offset_minutes', null, 'label', 'CST', 'ambiguous', true)
    when 'CDT' then jsonb_build_object('id', 'AMBIGUOUS:CDT', 'mode', 'ambiguous', 'offset_minutes', null, 'label', 'CDT', 'ambiguous', true)
    when 'IST' then jsonb_build_object('id', 'AMBIGUOUS:IST', 'mode', 'ambiguous', 'offset_minutes', null, 'label', 'IST', 'ambiguous', true)
    when 'BST' then jsonb_build_object('id', 'AMBIGUOUS:BST', 'mode', 'ambiguous', 'offset_minutes', null, 'label', 'BST', 'ambiguous', true)
    when 'AST' then jsonb_build_object('id', 'AMBIGUOUS:AST', 'mode', 'ambiguous', 'offset_minutes', null, 'label', 'AST', 'ambiguous', true)
    else null
  end;
  if contract_value is not null then return contract_value; end if;

  -- timezone(text, timestamp) valida directamente el identificador sin
  -- materializar y recorrer pg_timezone_names para cada candidata.
  begin
    perform pg_catalog.timezone(raw_value, timestamp '2000-01-01 00:00:00');
  exception
    when invalid_parameter_value then
      return jsonb_build_object(
        'id', 'AMBIGUOUS:' || upper(private.market_family_slug_v4(raw_value, 40)),
        'mode', 'ambiguous', 'offset_minutes', null,
        'label', raw_value, 'ambiguous', true
      );
  end;
  return jsonb_build_object(
    'id', raw_value,
    'mode', case when upper_value = 'UTC' then 'fixed_offset' else 'iana' end,
    'offset_minutes', case when upper_value = 'UTC' then 0 else null end,
    'label', raw_value,
    'ambiguous', false
  );
end;
$function$;

create or replace function private.market_family_timezone_contract_v4(
  timezone_input text,
  context_input text default null
)
returns jsonb
language plpgsql
stable
set search_path = ''
as $function$
declare
  context_remaining text := coalesce(context_input, '');
  token_parts text[];
  contract_value jsonb;
  contract_ids text[] := array[]::text[];
  contract_labels text[] := array[]::text[];
  sorted_labels text[];
  iana_pattern constant text := '\m((?:Africa|America|Antarctica|Arctic|Asia|Atlantic|Australia|Brazil|Canada|Chile|Etc|Europe|Indian|Mexico|Pacific|US)/[A-Za-z0-9._+-]+(?:/[A-Za-z0-9._+-]+)?)\M';
begin
  for token_parts in
    select regexp_matches(
      context_remaining,
      '\m((?:UTC|GMT)[[:space:]]*[+-][[:space:]]*[0-9]{1,2}(?::?[0-9]{2})?)\M',
      'gi'
    )
  loop
    contract_value := private.market_family_timezone_token_v4(token_parts[1]);
    if contract_value ->> 'id' <> all(contract_ids) then
      contract_ids := array_append(contract_ids, contract_value ->> 'id');
      contract_labels := array_append(contract_labels, contract_value ->> 'label');
    end if;
  end loop;
  context_remaining := regexp_replace(
    context_remaining,
    '\m(?:UTC|GMT)[[:space:]]*[+-][[:space:]]*[0-9]{1,2}(?::?[0-9]{2})?\M',
    ' ', 'gi'
  );

  -- Solo prefijos canónicos IANA: las barras de texto común nunca llegan al
  -- validador de zonas horarias.
  for token_parts in
    select regexp_matches(context_remaining, iana_pattern, 'gi')
  loop
    contract_value := private.market_family_timezone_token_v4(token_parts[1]);
    if contract_value ->> 'mode' = 'iana'
       and contract_value ->> 'id' <> all(contract_ids) then
      contract_ids := array_append(contract_ids, contract_value ->> 'id');
      contract_labels := array_append(contract_labels, contract_value ->> 'label');
    end if;
  end loop;
  context_remaining := regexp_replace(context_remaining, iana_pattern, ' ', 'gi');

  for token_parts in
    select regexp_matches(
      context_remaining,
      '\m(UTC|GMT|ET|EST|EDT|PT|PST|PDT|MT|MST|MDT|CT|CST|CDT|AKST|AKDT|HST|CET|CEST|EET|EEST|WET|WEST|IST|BST|AST)\M',
      'gi'
    )
  loop
    contract_value := private.market_family_timezone_token_v4(token_parts[1]);
    if contract_value ->> 'id' <> all(contract_ids) then
      contract_ids := array_append(contract_ids, contract_value ->> 'id');
      contract_labels := array_append(contract_labels, contract_value ->> 'label');
    end if;
  end loop;

  if coalesce(array_length(contract_ids, 1), 0) = 1 then
    return private.market_family_timezone_token_v4(contract_labels[1]);
  elsif coalesce(array_length(contract_ids, 1), 0) > 1 then
    select array_agg(label_value order by label_value) into sorted_labels
    from unnest(contract_labels) label_value;
    return jsonb_build_object(
      'id', 'AMBIGUOUS:' || array_to_string(sorted_labels, '|'),
      'mode', 'ambiguous', 'offset_minutes', null,
      'label', array_to_string(sorted_labels, ' / '), 'ambiguous', true
    );
  end if;

  contract_value := private.market_family_timezone_token_v4(timezone_input);
  return coalesce(contract_value, private.market_family_timezone_token_v4('UTC'));
end;
$function$;

create or replace function private.assign_market_candidate_family_v4()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  metadata_value jsonb;
begin
  -- El enlace posterior de la comprobación factual vuelve a escribir el
  -- payload. Si las entradas familiares no cambiaron, conservar la identidad
  -- v4 evita ejecutar por segunda vez todos los parsers de la candidata.
  if tg_op = 'UPDATE'
     and old.family_version = 'atinara-market-family-v4'
     and row(
       coalesce(old.normalized_payload ->> 'atinara_question', old.normalized_payload ->> 'source_question'),
       old.normalized_payload ->> 'source_title',
       coalesce(old.normalized_payload ->> 'atinara_subject', old.normalized_payload ->> 'subject'),
       coalesce(old.normalized_payload ->> 'event_group_key', old.external_event_id),
       coalesce(old.normalized_payload ->> 'evaluation_ends_at', old.normalized_payload ->> 'family_cutoff_at'),
       coalesce(
         old.normalized_payload ->> 'evaluation_timezone',
         old.normalized_payload ->> 'timezone',
         old.normalized_payload ->> 'source_timezone',
         old.normalized_payload #>> '{provider_payload,timezone}'
       ),
       old.normalized_payload ->> 'source_resolution_rules',
       coalesce(
         old.normalized_payload #>> '{provider_payload,yes_sub_title}',
         old.normalized_payload ->> 'yes_sub_title'
       )
     ) is not distinct from row(
       coalesce(new.normalized_payload ->> 'atinara_question', new.normalized_payload ->> 'source_question'),
       new.normalized_payload ->> 'source_title',
       coalesce(new.normalized_payload ->> 'atinara_subject', new.normalized_payload ->> 'subject'),
       coalesce(new.normalized_payload ->> 'event_group_key', new.external_event_id),
       coalesce(new.normalized_payload ->> 'evaluation_ends_at', new.normalized_payload ->> 'family_cutoff_at'),
       coalesce(
         new.normalized_payload ->> 'evaluation_timezone',
         new.normalized_payload ->> 'timezone',
         new.normalized_payload ->> 'source_timezone',
         new.normalized_payload #>> '{provider_payload,timezone}'
       ),
       new.normalized_payload ->> 'source_resolution_rules',
       coalesce(
         new.normalized_payload #>> '{provider_payload,yes_sub_title}',
         new.normalized_payload ->> 'yes_sub_title'
       )
     ) then
    new.family_key := old.family_key;
    new.family_title := old.family_title;
    new.family_type := old.family_type;
    new.family_child_key := old.family_child_key;
    new.family_child_label := old.family_child_label;
    new.family_sort_at := old.family_sort_at;
    new.family_relationship := old.family_relationship;
    new.family_semantics := old.family_semantics;
    new.family_source_event_key := old.family_source_event_key;
    new.family_version := old.family_version;
    new.normalized_payload := coalesce(new.normalized_payload, '{}'::jsonb) || jsonb_build_object(
      'family_key', new.family_key,
      'family_title', new.family_title,
      'family_type', new.family_type,
      'family_child_key', new.family_child_key,
      'family_child_label', new.family_child_label,
      'family_sort_at', new.family_sort_at,
      'family_relationship', new.family_relationship,
      'family_semantics', new.family_semantics,
      'family_source_event_key', new.family_source_event_key,
      'family_version', new.family_version
    );
    return new;
  end if;

  metadata_value := private.market_family_metadata_v4(
    coalesce(new.normalized_payload ->> 'atinara_question', new.normalized_payload ->> 'source_question'),
    new.normalized_payload ->> 'source_title',
    coalesce(new.normalized_payload ->> 'atinara_subject', new.normalized_payload ->> 'subject'),
    coalesce(new.normalized_payload ->> 'event_group_key', new.external_event_id),
    private.market_family_safe_timestamptz_v4(coalesce(
      new.normalized_payload ->> 'evaluation_ends_at',
      new.normalized_payload ->> 'family_cutoff_at'
    )),
    coalesce(
      new.normalized_payload ->> 'evaluation_timezone',
      new.normalized_payload ->> 'timezone',
      new.normalized_payload ->> 'source_timezone',
      new.normalized_payload #>> '{provider_payload,timezone}'
    ),
    new.normalized_payload ->> 'source_resolution_rules',
    coalesce(
      new.normalized_payload #>> '{provider_payload,yes_sub_title}',
      new.normalized_payload ->> 'yes_sub_title'
    )
  );

  new.family_key := metadata_value ->> 'family_key';
  new.family_title := metadata_value ->> 'family_title';
  new.family_type := metadata_value ->> 'family_type';
  new.family_child_key := metadata_value ->> 'family_child_key';
  new.family_child_label := metadata_value ->> 'family_child_label';
  new.family_sort_at := private.market_family_safe_timestamptz_v4(metadata_value ->> 'family_sort_at');
  new.family_relationship := 'standalone';
  new.family_semantics := coalesce(metadata_value -> 'family_semantics', '{}'::jsonb);
  new.family_source_event_key := metadata_value ->> 'family_source_event_key';
  new.family_version := metadata_value ->> 'family_version';
  new.normalized_payload := coalesce(new.normalized_payload, '{}'::jsonb) || jsonb_build_object(
    'family_key', new.family_key,
    'family_title', new.family_title,
    'family_type', new.family_type,
    'family_child_key', new.family_child_key,
    'family_child_label', new.family_child_label,
    'family_sort_at', new.family_sort_at,
    'family_relationship', new.family_relationship,
    'family_semantics', new.family_semantics,
    'family_source_event_key', new.family_source_event_key,
    'family_version', new.family_version
  );
  return new;
end;
$function$;

-- Si solo cambia la identidad externa, el clasificador también debe observar
-- la nueva familia que haya calculado el trigger anterior.
drop trigger if exists zzz_classify_market_candidate_relations_v4_before_write
  on private.external_market_candidates;
create trigger zzz_classify_market_candidate_relations_v4_before_write
before insert or update of normalized_payload, duplicate_matches, family_key, family_child_key, external_event_id
on private.external_market_candidates
for each row execute function private.classify_market_candidate_relations_v4();

create or replace function public.finalize_market_radar_provider_refresh_v1(
  provider_input text,
  cache_key_input text,
  status_input text,
  result_count_input integer,
  error_code_input text default null,
  error_message_input text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if provider_input not in ('polymarket', 'kalshi', 'tavily')
     or nullif(trim(cache_key_input), '') is null
     or status_input not in ('available', 'partial_error', 'unavailable')
     or result_count_input is null
     or result_count_input < 0
     or result_count_input > 240 then
    raise exception 'INVALID_RADAR_PROVIDER_REFRESH' using errcode = '22023';
  end if;
  if status_input = 'available' and (error_code_input is not null or error_message_input is not null) then
    raise exception 'INVALID_RADAR_PROVIDER_REFRESH' using errcode = '22023';
  end if;

  insert into private.market_radar_provider_runs (
    provider, cache_key, status, result_count, is_cached, error_code,
    error_message, fetched_at, expires_at, updated_at
  ) values (
    provider_input,
    left(cache_key_input, 180),
    status_input,
    result_count_input,
    false,
    case when status_input = 'available' then null else nullif(left(error_code_input, 80), '') end,
    case when status_input = 'available' then null else nullif(left(error_message_input, 300), '') end,
    now(),
    now() + case when status_input = 'available' then interval '20 minutes' else interval '5 minutes' end,
    now()
  )
  on conflict (provider, cache_key) do update set
    status = excluded.status,
    result_count = excluded.result_count,
    is_cached = false,
    error_code = excluded.error_code,
    error_message = excluded.error_message,
    fetched_at = excluded.fetched_at,
    expires_at = excluded.expires_at,
    updated_at = excluded.updated_at;

  return jsonb_build_object(
    'ok', true,
    'provider', provider_input,
    'status', status_input,
    'result_count', result_count_input
  );
end;
$function$;

revoke all on function public.finalize_market_radar_provider_refresh_v1(text,text,text,integer,text,text)
  from public, anon, authenticated, service_role;
grant execute on function public.finalize_market_radar_provider_refresh_v1(text,text,text,integer,text,text)
  to service_role;

comment on function public.finalize_market_radar_provider_refresh_v1(text,text,text,integer,text,text) is
  'Finaliza el estado agregado de una escritura del Radar dividida en lotes; solo service_role.';

commit;
