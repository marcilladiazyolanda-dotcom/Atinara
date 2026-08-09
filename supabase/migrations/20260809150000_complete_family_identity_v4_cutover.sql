-- Identidad contractual de familias v4 y corte autoritativo.
-- No publica, confirma, resuelve ni modifica mercados, predicciones, Karma,
-- Prestigio, saldos, probabilidades ni ninguna otra columna económica.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '180s';

select pg_advisory_xact_lock(hashtextextended('atinara:market-family-v4-cutover', 0));

-- Un orden único evita interbloqueos con escrituras del Radar/Editor durante el
-- corte. Todo queda dentro de la misma transacción y cualquier colisión aborta.
lock table public.markets in share row exclusive mode;
lock table private.market_drafts in share row exclusive mode;
lock table private.external_market_candidates in share row exclusive mode;

create or replace function private.market_family_normalize_v4(value_input text)
returns text
language sql
immutable
set search_path = ''
as $function$
  select trim(regexp_replace(
    translate(lower(coalesce(value_input, '')), 'áéíóúüñ', 'aeiouun'),
    '[^a-z0-9]+', ' ', 'g'
  ));
$function$;

create or replace function private.market_family_fold_v4(value_input text)
returns text
language sql
immutable
set search_path = ''
as $function$
  select translate(lower(coalesce(value_input, '')), 'áéíóúüñ', 'aeiouun');
$function$;

create or replace function private.market_family_slug_v4(value_input text, length_input integer default 120)
returns text
language sql
immutable
set search_path = ''
as $function$
  select left(trim(both '-' from regexp_replace(
    private.market_family_normalize_v4(value_input), '[^a-z0-9]+', '-', 'g'
  )), greatest(1, least(coalesce(length_input, 120), 240)));
$function$;

create or replace function private.market_family_month_v4(value_input text)
returns integer
language sql
immutable
set search_path = ''
as $function$
  select case lower(trim(coalesce(value_input, '')))
    when 'jan' then 1 when 'january' then 1 when 'ene' then 1 when 'enero' then 1
    when 'feb' then 2 when 'february' then 2 when 'febrero' then 2
    when 'mar' then 3 when 'march' then 3 when 'marzo' then 3
    when 'apr' then 4 when 'april' then 4 when 'abr' then 4 when 'abril' then 4
    when 'may' then 5 when 'mayo' then 5
    when 'jun' then 6 when 'june' then 6 when 'junio' then 6
    when 'jul' then 7 when 'july' then 7 when 'julio' then 7
    when 'aug' then 8 when 'august' then 8 when 'ago' then 8 when 'agosto' then 8
    when 'sep' then 9 when 'sept' then 9 when 'september' then 9
      when 'septiembre' then 9 when 'setiembre' then 9
    when 'oct' then 10 when 'october' then 10 when 'octubre' then 10
    when 'nov' then 11 when 'november' then 11 when 'noviembre' then 11
    when 'dec' then 12 when 'december' then 12 when 'dic' then 12 when 'diciembre' then 12
    else null
  end;
$function$;

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
  matched_name text;
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

  select name into matched_name
  from pg_catalog.pg_timezone_names
  where lower(name) = lower(raw_value)
  order by name
  limit 1;
  if matched_name is not null then
    return jsonb_build_object(
      'id', matched_name,
      'mode', case when matched_name = 'UTC' then 'fixed_offset' else 'iana' end,
      'offset_minutes', case when matched_name = 'UTC' then 0 else null end,
      'label', raw_value,
      'ambiguous', false
    );
  end if;
  return jsonb_build_object(
    'id', 'AMBIGUOUS:' || upper(private.market_family_slug_v4(raw_value, 40)),
    'mode', 'ambiguous', 'offset_minutes', null,
    'label', raw_value, 'ambiguous', true
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

  for token_parts in
    select regexp_matches(context_remaining, '\m([A-Za-z_]+/[A-Za-z_]+(?:/[A-Za-z_]+)?)\M', 'g')
  loop
    contract_value := private.market_family_timezone_token_v4(token_parts[1]);
    if contract_value ->> 'mode' = 'iana'
       and contract_value ->> 'id' <> all(contract_ids) then
      contract_ids := array_append(contract_ids, contract_value ->> 'id');
      contract_labels := array_append(contract_labels, contract_value ->> 'label');
    end if;
  end loop;
  context_remaining := regexp_replace(
    context_remaining, '\m[A-Za-z_]+/[A-Za-z_]+(?:/[A-Za-z_]+)?\M', ' ', 'g'
  );

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

create or replace function private.market_family_timezone_v4(
  timezone_input text,
  context_input text default null
)
returns text
language sql
stable
set search_path = ''
as $function$
  select private.market_family_timezone_contract_v4(timezone_input, context_input) ->> 'id';
$function$;


create or replace function private.market_candidate_blocking_duplicates(
  items_input jsonb,
  self_id_input uuid default null
)
returns jsonb
language sql
immutable
set search_path = ''
as $function$
  with filtered as (
    select item, ordinality,
      coalesce(nullif(item ->> 'id', ''), md5(item::text)) identity_key
    from jsonb_array_elements(
      case when jsonb_typeof(items_input) = 'array' then items_input else '[]'::jsonb end
    ) with ordinality elements(item, ordinality)
    where jsonb_typeof(item) = 'object'
      and (self_id_input is null or item ->> 'id' is distinct from self_id_input::text)
      and item ->> 'relationship' = 'exact_duplicate'
      and item ->> 'family_version' = 'atinara-market-family-v4'
      and lower(coalesce(item ->> 'blocking', 'true')) not in ('false', '0', 'no')
  ), unique_matches as (
    select distinct on (identity_key) item, ordinality
    from filtered
    order by identity_key, ordinality
  )
  select coalesce(jsonb_agg(item order by ordinality), '[]'::jsonb) from unique_matches;
$function$;

create or replace function private.market_candidate_sibling_matches(
  items_input jsonb,
  self_id_input uuid default null
)
returns jsonb
language sql
immutable
set search_path = ''
as $function$
  with filtered as (
    select item, ordinality,
      coalesce(nullif(item ->> 'id', ''), md5(item::text)) identity_key,
      coalesce(item ->> 'family_child_key', '') child_key
    from jsonb_array_elements(
      case when jsonb_typeof(items_input) = 'array' then items_input else '[]'::jsonb end
    ) with ordinality elements(item, ordinality)
    where jsonb_typeof(item) = 'object'
      and (self_id_input is null or item ->> 'id' is distinct from self_id_input::text)
      and item ->> 'relationship' = 'sibling'
      and item ->> 'family_version' = 'atinara-market-family-v4'
      and lower(coalesce(item ->> 'blocking', 'false')) in ('false', '0', 'no')
  ), unique_matches as (
    select distinct on (identity_key, child_key) item, ordinality
    from filtered
    order by identity_key, child_key, ordinality
  )
  select coalesce(jsonb_agg(item order by ordinality), '[]'::jsonb) from unique_matches;
$function$;

create or replace function private.market_candidate_has_blocking_duplicate(
  items_input jsonb,
  self_id_input uuid default null
)
returns boolean
language sql
immutable
set search_path = ''
as $function$
  select jsonb_array_length(private.market_candidate_blocking_duplicates(items_input, self_id_input)) > 0;
$function$;

create or replace function private.classify_market_candidate_relations_v4()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  source_payload jsonb := coalesce(new.normalized_payload, '{}'::jsonb) - 'id' - 'preparation_revision';
  relations_value jsonb := private.market_candidate_relations_v4(new);
  blockers_value jsonb;
  siblings_value jsonb;
  ambiguities_value jsonb;
  hard_reasons_value jsonb := '[]'::jsonb;
  reason_item jsonb;
  has_blockers boolean;
  has_ambiguity boolean;
  had_duplicate_marker boolean;
  has_other_hard_reason boolean;
  factual_rejection boolean;
  relationship_value text;
  primary_hard_reason text;
  mapped_factual_status text;
  mapped_reason_code text;
begin
  blockers_value := private.market_candidate_blocking_duplicates(relations_value -> 'blockers', new.id);
  siblings_value := private.market_candidate_sibling_matches(relations_value -> 'siblings', new.id);
  ambiguities_value := case when jsonb_typeof(relations_value -> 'ambiguities') = 'array'
    then relations_value -> 'ambiguities' else '[]'::jsonb end;
  has_blockers := jsonb_array_length(blockers_value) > 0;
  has_ambiguity := jsonb_array_length(ambiguities_value) > 0;
  had_duplicate_marker := new.verification_status = 'rejected_duplicate'
    or new.verification_reason_code = 'DUPLICATE_MARKET'
    or coalesce(source_payload -> 'hard_reject_reasons', '[]'::jsonb) @> '["DUPLICATE_MARKET"]'::jsonb;

  for reason_item in
    select value from jsonb_array_elements(case
      when jsonb_typeof(source_payload -> 'hard_reject_reasons') = 'array'
        then source_payload -> 'hard_reject_reasons' else '[]'::jsonb end)
  loop
    if reason_item #>> '{}' <> 'DUPLICATE_MARKET' then
      hard_reasons_value := hard_reasons_value || jsonb_build_array(reason_item);
    end if;
  end loop;
  has_other_hard_reason := jsonb_array_length(hard_reasons_value) > 0;
  primary_hard_reason := hard_reasons_value ->> 0;
  mapped_factual_status := case
    when hard_reasons_value @> '["EVENT_ALREADY_RESOLVED"]'::jsonb then 'rejected_resolved'
    when hard_reasons_value @> '["SOURCE_STALE"]'::jsonb then 'rejected_stale'
    when hard_reasons_value @> '["SUBJECT_NOT_ANNOUNCED"]'::jsonb then 'rejected_unannounced'
    when hard_reasons_value @> '["TEMPORAL_INCOHERENCE"]'::jsonb then 'rejected_incoherent'
    when hard_reasons_value @> '["INVALID_OR_UNVERIFIED_SOURCE"]'::jsonb
      or hard_reasons_value @> '["PROVIDER_EVENT_NOT_FOUND"]'::jsonb
      or hard_reasons_value @> '["PROVIDER_CHILD_NOT_FOUND"]'::jsonb then 'rejected_invalid_source'
    when has_other_hard_reason then 'rejected_ineligible'
    else null
  end;
  mapped_reason_code := case mapped_factual_status
    when 'rejected_resolved' then 'EVENT_ALREADY_RESOLVED'
    when 'rejected_stale' then 'SOURCE_STALE'
    when 'rejected_unannounced' then 'SUBJECT_NOT_ANNOUNCED'
    when 'rejected_incoherent' then 'TEMPORAL_INCOHERENCE'
    when 'rejected_invalid_source' then 'INVALID_OR_UNVERIFIED_SOURCE'
    else primary_hard_reason
  end;
  if has_blockers then hard_reasons_value := hard_reasons_value || jsonb_build_array('DUPLICATE_MARKET'); end if;
  factual_rejection := (
    coalesce(new.verification_status, '') like 'rejected_%'
    and new.verification_status <> 'rejected_duplicate'
  ) or (new.state = 'rejected' and has_other_hard_reason);

  relationship_value := case
    when has_blockers then 'exact_duplicate'
    when jsonb_array_length(siblings_value) > 0 then 'sibling'
    else 'standalone'
  end;

  if new.state not in ('prepared', 'dismissed') then
    if had_duplicate_marker and has_other_hard_reason then
      new.state := 'rejected';
      new.quality_status := 'rejected';
      new.verification_status := mapped_factual_status;
      new.verification_reason_code := mapped_reason_code;
      new.verification_reason := case mapped_factual_status
        when 'rejected_resolved' then 'El hecho ya es público o el evento ya está resuelto.'
        when 'rejected_stale' then 'La evidencia disponible está caducada o ya no representa el estado actual.'
        when 'rejected_unannounced' then 'La predicción depende de un producto no anunciado para el resultado propuesto.'
        when 'rejected_incoherent' then 'Las fechas o el periodo del mercado son incompatibles con la evidencia verificada.'
        when 'rejected_invalid_source' then 'No se pudo validar una fuente pública suficiente para preparar el mercado.'
        else 'La candidata incumple un requisito factual o contractual distinto de la identidad familiar.'
      end;
      new.verification_expires_at := null;
    elsif has_ambiguity and not factual_rejection then
      new.state := 'needs_review';
      new.quality_status := 'needs_review';
      new.verification_status := 'needs_review';
      new.verification_reason_code := 'FAMILY_IDENTITY_AMBIGUOUS';
      new.verification_reason := 'La abreviatura coincide con más de una entidad; requiere confirmar la identidad canónica.';
      new.verification_expires_at := null;
    elsif has_blockers and not factual_rejection then
      new.state := 'rejected';
      new.quality_status := 'rejected';
      new.verification_status := 'rejected_duplicate';
      new.verification_reason_code := 'DUPLICATE_MARKET';
      new.verification_reason := 'Existe una definición contractual v4 exacta en Atinara.';
    elsif not has_blockers and new.state = 'rejected'
          and had_duplicate_marker and not has_other_hard_reason
          and not factual_rejection then
      new.state := 'needs_review';
      new.quality_status := 'needs_review';
      new.verification_status := 'needs_review';
      new.verification_reason_code := null;
      new.verification_reason := 'La identidad contractual v4 descartó el falso duplicado; falta repetir la comprobación factual.';
      new.verification_expires_at := null;
    elsif not has_blockers and not has_ambiguity and new.verification_status = 'verified_open' then
      new.state := 'available';
      new.quality_status := 'fit';
    end if;
  end if;

  new.duplicate_matches := blockers_value;
  new.family_relationship := relationship_value;
  new.normalized_payload := source_payload || jsonb_build_object(
    'duplicate_matches', blockers_value,
    'family_matches', siblings_value,
    'family_identity_ambiguities', ambiguities_value,
    'hard_reject_reasons', hard_reasons_value,
    'family_key', new.family_key,
    'family_title', new.family_title,
    'family_type', new.family_type,
    'family_child_key', new.family_child_key,
    'family_child_label', new.family_child_label,
    'family_sort_at', new.family_sort_at,
    'family_relationship', new.family_relationship,
    'family_semantics', new.family_semantics,
    'family_source_event_key', new.family_source_event_key,
    'family_version', new.family_version,
    'quality_status', new.quality_status,
    'verification_status', new.verification_status,
    'verification_reason_code', new.verification_reason_code,
    'verification_reason', new.verification_reason,
    'verification_expires_at', new.verification_expires_at
  );
  return new;
end;
$function$;

create or replace function private.market_family_metadata_v4(
  question_input text,
  title_input text default null,
  subject_input text default null,
  source_event_key_input text default null,
  cutoff_input timestamptz default null,
  timezone_input text default null,
  resolution_rules_input text default null,
  yes_label_input text default null
)
returns jsonb
language plpgsql
stable
set search_path = ''
as $function$
declare
  question_value text := private.market_family_normalize_v4(coalesce(question_input, title_input));
  title_value text := private.market_family_normalize_v4(title_input);
  dimension_value text;
  type_value text;
  entity_value text;
  entity_identity text;
  display_entity text;
  boundary_value jsonb;
  threshold_value jsonb;
  duration_value jsonb;
  content_kind text;
  content_invariant text := '';
  family_key_value text;
  child_key_value text;
  child_label_value text;
  semantics_value jsonb;
  temporal_child text;
  option_key text;
  suffix_parts text[];
begin
  if question_value = '' then return '{}'::jsonb; end if;

  threshold_value := private.market_family_threshold_v4(question_input, question_input);
  if threshold_value is not null then
    dimension_value := 'threshold'; type_value := 'milestone_thresholds';
  elsif question_value ~ '\m(trailer|teaser|avance|clip|gameplay video)\M' then
    dimension_value := 'official_content'; type_value := 'event_content_options';
  elsif question_value ~ '\m(announce|announc[a-z]*|anunci[a-z]*|reveal[a-z]*|present[a-z]*)\M' then
    dimension_value := 'announcement_date'; type_value := 'deadline_ladder';
  elsif question_value ~ '\m(releas[a-z]*|launch[a-z]*|lanz[a-z]*|saldr[a-z]*|debut|come out)\M' then
    dimension_value := 'release_date'; type_value := 'deadline_ladder';
  elsif question_value ~ '\m(cover|portada|participant|candidato|athlete|atleta|appear[a-z]*|attend[a-z]*|presence|aparec[a-z]*|asist[a-z]*)\M' then
    dimension_value := 'participant'; type_value := 'participant_options';
  elsif question_value ~ '\m(platform|plataforma|playstation|xbox|switch|steam)\M'
        and question_value ~ '\m(version|variant|variante)\M' then
    dimension_value := 'platform'; type_value := 'platform_variants';
  elsif question_value ~ '\m(score|puntuacion|threshold|umbral|views|visualizaciones|copies|copias|ventas|sales)\M' then
    dimension_value := 'threshold'; type_value := 'milestone_thresholds';
  elsif question_value ~ '\m(winner|ganador|award|premio|goty|which|cual|nominee|nominat[a-z]*|nominad[a-z]*|game of the year|juego del ano)\M' then
    dimension_value := 'outcome'; type_value := 'categorical_outcomes';
  else
    dimension_value := 'related'; type_value := 'generic_related';
  end if;

  entity_value := private.market_family_entity_label_v4(
    question_input, title_input, subject_input, dimension_value
  );
  if nullif(entity_value, '') is null then return '{}'::jsonb; end if;
  entity_identity := private.market_family_entity_identity_v4(entity_value);
  if nullif(entity_identity, '') is null then return '{}'::jsonb; end if;

  boundary_value := private.market_family_boundary_v4(
    question_input, cutoff_input, timezone_input, resolution_rules_input
  );
  if boundary_value is not null then
    temporal_child := case
      when coalesce((boundary_value ->> 'identity_ambiguous')::boolean, false) then concat(
        'deadline:ambiguous-timezone:', private.market_family_slug_v4(boundary_value ->> 'timezone', 80),
        ':', private.market_family_slug_v4(boundary_value ->> 'ambiguity_reason', 40),
        ':', boundary_value ->> 'canonical_operator',
        ':', private.market_family_slug_v4(coalesce(
          boundary_value ->> 'canonical_local_instant', boundary_value ->> 'local_instant'
        ), 80),
        ':', boundary_value ->> 'granularity'
      )
      else concat(
        'deadline:', boundary_value ->> 'canonical_operator',
        ':', boundary_value ->> 'canonical_instant',
        ':', boundary_value ->> 'granularity'
      )
    end;
  end if;

  if dimension_value = 'threshold' then
    threshold_value := coalesce(
      private.market_family_threshold_v4(
        yes_label_input,
        coalesce(title_input, '') || ' ' || coalesce(question_input, '') || ' ' || coalesce(resolution_rules_input, '')
      ),
      private.market_family_threshold_v4(question_input, question_input)
    );
  end if;

  if dimension_value = 'official_content' then
    content_kind := case
      when question_value ~ '\mteaser\M' then 'teaser'
      when question_value ~ '\m(clip|avance)\M' then 'clip'
      else 'trailer'
    end;
    duration_value := private.market_family_threshold_v4(
      coalesce(question_input, '') || ' ' || coalesce(resolution_rules_input, ''),
      coalesce(question_input, '') || ' ' || coalesce(resolution_rules_input, '')
    );
    if duration_value ->> 'unit' <> 'seconds'
       or coalesce((duration_value ->> 'value')::numeric, 0) <= 0
       or coalesce((duration_value ->> 'value')::numeric, 0) > 3600
       or (duration_value ->> 'value')::numeric <> trunc((duration_value ->> 'value')::numeric) then
      duration_value := null;
    end if;
    content_invariant := ':' || content_kind || case when duration_value is not null then
      concat(':duration-', duration_value ->> 'operator', '-', duration_value ->> 'value', '-', duration_value ->> 'unit')
      else '' end;
    if boundary_value is not null then type_value := 'deadline_ladder'; end if;
  end if;

  family_key_value := 'atinara:v4:' || entity_identity || ':' || dimension_value || content_invariant;
  if dimension_value = 'official_content' then
    child_key_value := 'content:' || content_kind || ':' || coalesce(
      temporal_child, 'option:' || private.market_family_slug_v4(question_value, 120)
    );
  elsif threshold_value is not null then
    child_key_value := case
      when coalesce((threshold_value ->> 'ambiguous')::boolean, false) then concat(
        'threshold:ambiguous:', private.market_family_slug_v4(threshold_value ->> 'raw_value', 80),
        ':', threshold_value ->> 'unit'
      )
      else concat(
        'threshold:', threshold_value ->> 'operator',
        ':', threshold_value ->> 'value', ':', threshold_value ->> 'unit'
      )
    end;
  elsif temporal_child is not null then
    child_key_value := temporal_child;
  elsif nullif(private.market_family_normalize_v4(yes_label_input), '') is not null
        and private.market_family_normalize_v4(yes_label_input) not in ('yes', 'si', 'true', 'no')
        and dimension_value in ('outcome', 'participant', 'platform') then
    option_key := private.market_family_slug_v4(yes_label_input, 120);
    child_key_value := 'option:' || option_key;
  else
    child_key_value := 'option:' || private.market_family_slug_v4(question_value, 120);
  end if;

  child_label_value := case
    when nullif(yes_label_input, '') is not null and dimension_value in ('threshold', 'outcome', 'participant', 'platform') then left(trim(yes_label_input), 180)
    when threshold_value is not null and coalesce((threshold_value ->> 'ambiguous')::boolean, false) then concat(
      'Umbral ambiguo ', threshold_value ->> 'raw_value', ' ', threshold_value ->> 'unit'
    )
    when threshold_value is not null then concat(
      'Umbral ', threshold_value ->> 'operator', ' ', threshold_value ->> 'value', ' ', threshold_value ->> 'unit'
    )
    when boundary_value is not null then concat(
      boundary_value ->> 'operator', ' ', coalesce(
        boundary_value ->> 'instant', boundary_value ->> 'local_instant'
      ),
      ' (', coalesce(boundary_value ->> 'timezone_label', boundary_value ->> 'timezone'),
      ', ', boundary_value ->> 'granularity', ')'
    )
    else left(coalesce(question_input, title_input), 180)
  end;

  semantics_value := jsonb_build_object(
    'cumulative', type_value in ('deadline_ladder', 'milestone_thresholds'),
    'mutually_exclusive', type_value = 'categorical_outcomes',
    'parent_is_market', false,
    'aggregate_probability', false,
    'economic_independence', true,
    'entity_label', entity_value
  );
  if dimension_value = 'official_content' then
    semantics_value := semantics_value || jsonb_build_object(
      'content_kind', content_kind,
      'duration_contract', duration_value,
      'temporal_boundary', boundary_value
    );
    if coalesce((boundary_value ->> 'identity_ambiguous')::boolean, false) then
      semantics_value := semantics_value || jsonb_build_object('identity_ambiguous', true);
    end if;
  elsif threshold_value is not null then
    semantics_value := semantics_value || jsonb_build_object('threshold', threshold_value);
    if boundary_value is not null then
      semantics_value := semantics_value || jsonb_build_object('temporal_boundary', boundary_value);
    end if;
    if coalesce((threshold_value ->> 'ambiguous')::boolean, false)
       or coalesce((boundary_value ->> 'identity_ambiguous')::boolean, false) then
      semantics_value := semantics_value || jsonb_build_object('identity_ambiguous', true);
    end if;
  elsif boundary_value is not null then
    semantics_value := semantics_value || jsonb_build_object('temporal_boundary', boundary_value);
    if coalesce((boundary_value ->> 'identity_ambiguous')::boolean, false) then
      semantics_value := semantics_value || jsonb_build_object('identity_ambiguous', true);
    end if;
  end if;

  suffix_parts := regexp_match(entity_value, '^(.*) (i|ii|iii|iv|v|vi|vii|viii|ix|x|xi|xii)$');
  display_entity := case when suffix_parts is not null
    then suffix_parts[1] || ' ' || upper(suffix_parts[2]) else entity_value end;

  return jsonb_build_object(
    'family_key', family_key_value,
    'family_title', case
      when dimension_value = 'official_content' then 'Contenido oficial · '
      when type_value = 'deadline_ladder' and dimension_value = 'announcement_date' then 'Anuncio oficial · '
      when type_value = 'deadline_ladder' then 'Fecha de lanzamiento · '
      when dimension_value = 'threshold' then 'Hitos · '
      else 'Opciones · '
    end || display_entity,
    'family_type', type_value,
    'family_child_key', child_key_value,
    'family_child_label', child_label_value,
    'family_sort_at', coalesce(boundary_value ->> 'canonical_instant', to_char(cutoff_input at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
    'family_relationship', 'standalone',
    'family_semantics', semantics_value,
    'family_source_event_key', nullif(trim(source_event_key_input), ''),
    'family_version', 'atinara-market-family-v4'
  );
end;
$function$;

create or replace function private.market_family_metric_unit_v4(value_input text)
returns text
language sql
immutable
set search_path = ''
as $function$
  select case
    when private.market_family_normalize_v4(value_input) ~ '\m(metacritic|score|scores|puntuacion|puntuaciones|points|puntos)\M' then 'points'
    when private.market_family_normalize_v4(value_input) ~ '\m(view|views|viewer|viewers|visualizacion|visualizaciones)\M' then 'views'
    when private.market_family_normalize_v4(value_input) ~ '\m(copy|copies|copia|copias|sales|ventas|units|unidades|games|juegos)\M' then 'copies'
    when private.market_family_normalize_v4(value_input) ~ '\m(subscriber|subscribers|suscriptor|suscriptores)\M' then 'subscribers'
    else 'count'
  end;
$function$;

create or replace function private.market_family_canonical_number_v4(
  value_input text,
  scale_input text default null
)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $function$
declare
  raw_value text := trim(coalesce(value_input, ''));
  normalized_value text;
  separator_count integer;
  decimal_parts text[];
  number_value numeric;
  number_text text;
begin
  if raw_value = '' or raw_value !~ '^[0-9]+(?:[.,][0-9]+)*$' then return null; end if;
  separator_count := length(raw_value) - length(regexp_replace(raw_value, '[.,]', '', 'g'));

  if separator_count = 0 then
    normalized_value := raw_value;
  elsif separator_count = 1 then
    decimal_parts := regexp_match(raw_value, '^([0-9]+)([.,])([0-9]+)$');
    if length(decimal_parts[3]) = 3 then
      return jsonb_build_object(
        'value', null, 'ambiguous', true, 'raw_value', raw_value
      );
    end if;
    normalized_value := decimal_parts[1] || '.' || decimal_parts[3];
  elsif raw_value ~ '^[0-9]{1,3}(,[0-9]{3})+$' then
    normalized_value := replace(raw_value, ',', '');
  elsif raw_value ~ '^[0-9]{1,3}(\.[0-9]{3})+$' then
    normalized_value := replace(raw_value, '.', '');
  elsif raw_value ~ '^[0-9]{1,3}(,[0-9]{3})+\.[0-9]+$'
        and raw_value !~ '\.[0-9]{3}$' then
    normalized_value := replace(split_part(raw_value, '.', 1), ',', '')
      || '.' || split_part(raw_value, '.', 2);
  elsif raw_value ~ '^[0-9]{1,3}(\.[0-9]{3})+,[0-9]+$'
        and raw_value !~ ',[0-9]{3}$' then
    normalized_value := replace(split_part(raw_value, ',', 1), '.', '')
      || '.' || split_part(raw_value, ',', 2);
  else
    return jsonb_build_object(
      'value', null, 'ambiguous', true, 'raw_value', raw_value
    );
  end if;

  number_value := normalized_value::numeric * case
    when scale_input in ('thousand', 'mil') then 1000
    when scale_input in ('million', 'millions', 'millon', 'millones') then 1000000
    when scale_input in ('billion', 'billions', 'billon', 'billones') then 1000000000
    else 1
  end;
  number_text := number_value::text;
  if position('.' in number_text) > 0 then
    number_text := regexp_replace(regexp_replace(number_text, '0+$', ''), '\.$', '');
  end if;
  return jsonb_build_object(
    'value', number_text, 'ambiguous', false, 'raw_value', raw_value
  );
exception
  when invalid_text_representation or numeric_value_out_of_range then return null;
end;
$function$;

create or replace function private.market_family_threshold_v4(
  value_input text,
  context_input text default null
)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $function$
declare
  source_value text := trim(regexp_replace(
    private.market_family_fold_v4(value_input), '[^a-z0-9%.,<>=]+', ' ', 'g'
  ));
  context_value text := coalesce(context_input, value_input);
  parts text[];
  scale_parts text[];
  unit_parts text[];
  operator_value text;
  canonical_number jsonb;
  percent_value text;
  remainder_value text;
  scale_value text;
  unit_value text;
begin
  parts := regexp_match(source_value, '<=[[:space:]]*(?:[a-z]+[[:space:]]+){0,12}([0-9]+(?:[.,][0-9]+)*)[[:space:]]*(%)?(.*)$');
  if parts is not null then operator_value := 'lte'; end if;
  if parts is null then
    parts := regexp_match(source_value, '>=[[:space:]]*(?:[a-z]+[[:space:]]+){0,12}([0-9]+(?:[.,][0-9]+)*)[[:space:]]*(%)?(.*)$');
    if parts is not null then operator_value := 'gte'; end if;
  end if;
  if parts is null then
    parts := regexp_match(source_value, '>(?!=)[[:space:]]*(?:[a-z]+[[:space:]]+){0,12}([0-9]+(?:[.,][0-9]+)*)[[:space:]]*(%)?(.*)$');
    if parts is not null then operator_value := 'gt'; end if;
  end if;
  if parts is null then
    parts := regexp_match(source_value, '<(?!=)[[:space:]]*(?:[a-z]+[[:space:]]+){0,12}([0-9]+(?:[.,][0-9]+)*)[[:space:]]*(%)?(.*)$');
    if parts is not null then operator_value := 'lt'; end if;
  end if;
  if parts is null then
    parts := regexp_match(source_value, '\m(?:at most|no more than|como maximo|a lo sumo)[[:space:]]+(?:[a-z]+[[:space:]]+){0,12}([0-9]+(?:[.,][0-9]+)*)[[:space:]]*(%)?(.*)$');
    if parts is not null then operator_value := 'lte'; end if;
  end if;
  if parts is null then
    parts := regexp_match(source_value, '\m(?:at least|no less than|minimum(?: of)?|al menos|minimo(?: de)?|como minimo)[[:space:]]+(?:[a-z]+[[:space:]]+){0,12}([0-9]+(?:[.,][0-9]+)*)[[:space:]]*(%)?(.*)$');
    if parts is not null then operator_value := 'gte'; end if;
  end if;
  if parts is null then
    parts := regexp_match(source_value, '\m(?:above|over|more than|greater than|exceed[a-z]*|superior a|super[a-z]*|mas de)[[:space:]]+(?:[a-z]+[[:space:]]+){0,12}([0-9]+(?:[.,][0-9]+)*)[[:space:]]*(%)?(.*)$');
    if parts is not null then operator_value := 'gt'; end if;
  end if;
  if parts is null then
    parts := regexp_match(source_value, '\m(?:below|under|less than|fewer than|inferior a|menos de)[[:space:]]+(?:[a-z]+[[:space:]]+){0,12}([0-9]+(?:[.,][0-9]+)*)[[:space:]]*(%)?(.*)$');
    if parts is not null then operator_value := 'lt'; end if;
  end if;
  if parts is null then
    parts := regexp_match(source_value, '\m(?:exactly|equal to|exactamente|igual a)[[:space:]]+(?:[a-z]+[[:space:]]+){0,12}([0-9]+(?:[.,][0-9]+)*)[[:space:]]*(%)?(.*)$');
    if parts is not null then operator_value := 'eq'; end if;
  end if;
  if parts is null then
    parts := regexp_match(source_value, '\m(?:reach[a-z]*|alcanz[a-z]*)[[:space:]]+(?:[a-z]+[[:space:]]+){0,12}([0-9]+(?:[.,][0-9]+)*)[[:space:]]*(%)?(.*)$');
    if parts is not null then operator_value := 'gte'; end if;
  end if;
  if parts is null then return null; end if;

  percent_value := nullif(parts[2], '');
  remainder_value := coalesce(parts[3], '');
  scale_parts := regexp_match(remainder_value, '^[[:space:]]*(thousand|million|millions|billion|billions|mil|millon|millones|billon|billones)\M');
  if scale_parts is not null then
    scale_value := scale_parts[1];
    remainder_value := regexp_replace(remainder_value, '^[[:space:]]*(thousand|million|millions|billion|billions|mil|millon|millones|billon|billones)\M', '');
  end if;
  remainder_value := regexp_replace(remainder_value, '^[[:space:]]*(of|de)\M', '');
  unit_parts := regexp_match(remainder_value, '^[[:space:]]*(percent|percentage|porcentaje|point|points|pt|pts|punto|puntos|second|seconds|sec|secs|segundo|segundos|minute|minutes|minuto|minutos|hour|hours|hora|horas|view|views|viewer|viewers|visualizacion|visualizaciones|copy|copies|copia|copias|game|games|juego|juegos|unit|units|unidades|dollar|dollars|dolar|dolares|usd|subscriber|subscribers|suscriptor|suscriptores)\M');
  canonical_number := private.market_family_canonical_number_v4(parts[1], scale_value);
  if canonical_number is null then return null; end if;

  unit_value := case
    when percent_value is not null then 'percent'
    when unit_parts is null then private.market_family_metric_unit_v4(context_value)
    when unit_parts[1] in ('percent', 'percentage', 'porcentaje') then 'percent'
    when unit_parts[1] in ('point', 'points', 'pt', 'pts', 'punto', 'puntos') then 'points'
    when unit_parts[1] in ('second', 'seconds', 'sec', 'secs', 'segundo', 'segundos') then 'seconds'
    when unit_parts[1] in ('minute', 'minutes', 'minuto', 'minutos') then 'minutes'
    when unit_parts[1] in ('hour', 'hours', 'hora', 'horas') then 'hours'
    when unit_parts[1] in ('view', 'views', 'viewer', 'viewers', 'visualizacion', 'visualizaciones') then 'views'
    when unit_parts[1] in ('copy', 'copies', 'copia', 'copias', 'game', 'games', 'juego', 'juegos', 'unit', 'units', 'unidades') then 'copies'
    when unit_parts[1] in ('dollar', 'dollars', 'dolar', 'dolares', 'usd') then 'usd'
    when unit_parts[1] in ('subscriber', 'subscribers', 'suscriptor', 'suscriptores') then 'subscribers'
    else private.market_family_metric_unit_v4(context_value)
  end;

  return jsonb_build_object(
    'operator', operator_value,
    'value', canonical_number -> 'value',
    'unit', unit_value,
    'ambiguous', coalesce((canonical_number ->> 'ambiguous')::boolean, false),
    'raw_value', canonical_number ->> 'raw_value'
  );
end;
$function$;

create or replace function private.market_family_entity_identity_v4(value_input text)
returns text
language plpgsql
immutable
set search_path = ''
as $function$
declare
  canonical_value text := private.market_family_normalize_v4(value_input);
  tokens text[] := regexp_split_to_array(private.market_family_normalize_v4(value_input), '[[:space:]]+');
  token_count integer := coalesce(array_length(tokens, 1), 0);
  raw_suffix text;
  suffix_value text;
  acronym_value text := '';
  index_value integer;
begin
  if token_count < 2 then return private.market_family_slug_v4(canonical_value, 100); end if;
  raw_suffix := tokens[token_count];
  if raw_suffix !~ '^(i|ii|iii|iv|v|vi|vii|viii|ix|x|xi|xii|[1-9]|1[0-2])$' then
    return private.market_family_slug_v4(canonical_value, 100);
  end if;
  suffix_value := case raw_suffix
    when '1' then 'i' when '2' then 'ii' when '3' then 'iii' when '4' then 'iv'
    when '5' then 'v' when '6' then 'vi' when '7' then 'vii' when '8' then 'viii'
    when '9' then 'ix' when '10' then 'x' when '11' then 'xi' when '12' then 'xii'
    else raw_suffix
  end;
  if token_count = 2 then
    if tokens[1] ~ '^[a-z]{2,8}$' then acronym_value := tokens[1]; end if;
  else
    for index_value in 1..token_count - 1 loop
      acronym_value := acronym_value || left(tokens[index_value], 1);
    end loop;
  end if;
  if length(acronym_value) >= 2 then return left(acronym_value || suffix_value, 100); end if;
  return private.market_family_slug_v4(canonical_value, 100);
end;
$function$;

create or replace function private.market_family_alias_equivalent_v4(left_input text, right_input text)
returns boolean
language plpgsql
immutable
set search_path = ''
as $function$
declare
  left_value text := private.market_family_normalize_v4(left_input);
  right_value text := private.market_family_normalize_v4(right_input);
  left_tokens text[] := regexp_split_to_array(private.market_family_normalize_v4(left_input), '[[:space:]]+');
  right_tokens text[] := regexp_split_to_array(private.market_family_normalize_v4(right_input), '[[:space:]]+');
  left_count integer := coalesce(array_length(left_tokens, 1), 0);
  right_count integer := coalesce(array_length(right_tokens, 1), 0);
begin
  if left_value = '' or right_value = '' then return false; end if;
  if left_value = right_value or replace(left_value, ' ', '') = replace(right_value, ' ', '') then return true; end if;
  if private.market_family_entity_identity_v4(left_value) <> private.market_family_entity_identity_v4(right_value) then return false; end if;
  if left_tokens[left_count] ~ '^(1|2|3|4|5|6|7|8|9|10|11|12)$' then
    left_tokens[left_count] := case left_tokens[left_count]
      when '1' then 'i' when '2' then 'ii' when '3' then 'iii' when '4' then 'iv'
      when '5' then 'v' when '6' then 'vi' when '7' then 'vii' when '8' then 'viii'
      when '9' then 'ix' when '10' then 'x' when '11' then 'xi' when '12' then 'xii'
    end;
  end if;
  if right_tokens[right_count] ~ '^(1|2|3|4|5|6|7|8|9|10|11|12)$' then
    right_tokens[right_count] := case right_tokens[right_count]
      when '1' then 'i' when '2' then 'ii' when '3' then 'iii' when '4' then 'iv'
      when '5' then 'v' when '6' then 'vi' when '7' then 'vii' when '8' then 'viii'
      when '9' then 'ix' when '10' then 'x' when '11' then 'xi' when '12' then 'xii'
    end;
  end if;
  if array_to_string(left_tokens, ' ') = array_to_string(right_tokens, ' ') then return true; end if;
  -- Una abreviatura + sufijo puede expandirse a sus iniciales; dos nombres
  -- largos diferentes con las mismas iniciales son una colisión, no un alias.
  return (left_count = 2 and right_count > 2) or (right_count = 2 and left_count > 2);
end;
$function$;

create or replace function private.market_family_title_entity_v4(value_input text)
returns text
language sql
immutable
set search_path = ''
as $function$
  select trim(regexp_replace(regexp_replace(
    private.market_family_normalize_v4(regexp_replace(
      private.market_family_fold_v4(value_input), '[[:space:]]+[-–—|][[:space:]]+.*$', ''
    )),
    '\m(new|next|another|nuevo|nueva|proximo|proxima)?[[:space:]]*(trailer|teaser|avance|clip)([[:space:]]+(release date|fecha de lanzamiento))?\M.*$', '', 'g'
  ), '\m(release date|fecha de lanzamiento|cover athlete|atleta de portada|metacritic score|puntuacion de metacritic)\M.*$', '', 'g'));
$function$;

create or replace function private.market_family_question_entity_v4(value_input text, dimension_input text)
returns text
language plpgsql
immutable
set search_path = ''
as $function$
declare
  value_result text := private.market_family_normalize_v4(value_input);
  content_parts text[];
begin
  value_result := regexp_replace(value_result, '^(will|whether|can|could|is|are|sera|seran|se) ', '');
  value_result := regexp_replace(value_result, '^(a|an|la|el|un|una|another|next|otro|otra|proximo|proxima) ', '');
  value_result := regexp_replace(value_result, '^(announce[a-z]*|anunci[a-z]*|reveal[a-z]*|present[a-z]*|release[a-z]*|launch[a-z]*|lanz[a-z]*|public[a-z]*|reach[a-z]*|alcanz[a-z]*|exceed[a-z]*|super[a-z]*) (officially |oficialmente )?(a |an |the |la |el |los |las |un |una )?', '');
  value_result := regexp_replace(value_result, '^(officially|oficialmente) ', '');
  if dimension_input = 'official_content' then
    content_parts := regexp_match(value_result, '(new |nuevo |nueva |another )?(trailer|teaser|avance|clip)( official| oficial)? (of|de) (.+?)( before| antes de| antes del| by|$)');
    if content_parts is not null and nullif(content_parts[5], '') is not null then
      value_result := content_parts[5];
    else
      value_result := regexp_replace(value_result, '\m(new|nuevo|nueva|another|next|official|oficial|proximo|proxima|trailer|teaser|avance|clip)\M', ' ', 'g');
      value_result := regexp_replace(value_result, '^[[:space:]]*(of|de)[[:space:]]+', '');
    end if;
  end if;
  value_result := regexp_replace(value_result, '[[:space:]]+(will|be|is|sera|seran|se|before|antes|by|hasta|para|release[a-z]*|launch[a-z]*|lanz[a-z]*|announce[a-z]*|anunci[a-z]*|public[a-z]*|come out|nominat[a-z]*|nominad[a-z]*|win[a-z]*|gan[a-z]*|reach[a-z]*|alcanz[a-z]*|score[a-z]*|puntuar[a-z]*|exceed[a-z]*|super[a-z]*|appear[a-z]*|aparec[a-z]*|attend[a-z]*|asist[a-z]*).*$', '');
  if dimension_input = 'threshold' then
    value_result := regexp_replace(
      value_result,
      '[[:space:]]+(the|los|las|un|una)?[[:space:]]*(at least|at most|more than|less than|above|below|over|under|al menos|como maximo|mas de|menos de)?[[:space:]]*[0-9]+([[:space:].,][0-9]+)*([[:space:]]*(percent[a-z]*|porcentaje|point[a-z]*|punto[a-z]*|view[a-z]*|visualizacion[a-z]*|cop[a-z]*|venta[a-z]*|subscriber[a-z]*|suscriptor[a-z]*))?.*$',
      ''
    );
  end if;
  value_result := regexp_replace(value_result, '\m(release date|fecha de lanzamiento|official content|contenido oficial|metacritic score|puntuacion de metacritic)\M', ' ', 'g');
  value_result := regexp_replace(value_result, '\m(next|another|nuevo|nueva|proximo|proxima)\M', ' ', 'g');
  value_result := regexp_replace(value_result, '^[[:space:]]*(trailer|teaser|avance|clip)[[:space:]]+(of|de)[[:space:]]+', '');
  value_result := regexp_replace(value_result, '[[:space:]]+(trailer|teaser|avance|clip)[[:space:]]*$', '');
  return trim(regexp_replace(value_result, '[[:space:]]+', ' ', 'g'));
end;
$function$;

create or replace function private.market_family_entity_label_v4(
  question_input text,
  title_input text,
  subject_input text,
  dimension_input text
)
returns text
language plpgsql
immutable
set search_path = ''
as $function$
declare
  question_value text := private.market_family_question_entity_v4(question_input, dimension_input);
  title_value text := private.market_family_title_entity_v4(title_input);
  subject_value text := private.market_family_normalize_v4(subject_input);
  stable_title text := case
    when private.market_family_normalize_v4(title_input) ~ '^(will|whether|can|could|is|are|sera|seran|se)\M' then ''
    else private.market_family_title_entity_v4(title_input)
  end;
  result_value text;
  alias_value text;
begin
  result_value := coalesce(nullif(subject_value, ''),
    case when dimension_input in ('threshold', 'outcome') then nullif(stable_title, '') end,
    nullif(question_value, ''), nullif(title_value, ''));
  if result_value is null then return null; end if;
  foreach alias_value in array array[question_value, title_value, subject_value] loop
    if nullif(alias_value, '') is not null
       and private.market_family_alias_equivalent_v4(result_value, alias_value)
       and length(alias_value) > length(result_value) then result_value := alias_value; end if;
  end loop;
  return left(private.market_family_normalize_v4(result_value), 120);
end;
$function$;

create or replace function private.market_family_temporal_operator_v4(value_input text)
returns text
language sql
immutable
set search_path = ''
as $function$
  select case
    when private.market_family_normalize_v4(value_input) ~ '\m(on or before|no later than|at or before|by|hasta el|hasta|a mas tardar|o antes)\M' then 'lte'
    when private.market_family_normalize_v4(value_input) ~ '\m(before|prior to|earlier than|antes de|antes del|previo a)\M' then 'lt'
    when private.market_family_normalize_v4(value_input) ~ '\m(on or after|no earlier than|at or after|desde|a partir de|o despues)\M' then 'gte'
    when private.market_family_normalize_v4(value_input) ~ '\m(after|later than|despues de|posterior a)\M' then 'gt'
    when private.market_family_normalize_v4(value_input) ~ '\m(exactly on|on exactly|exactamente el|el dia)\M' then 'eq'
    else 'lte'
  end;
$function$;

create or replace function private.market_family_boundary_v4(
  question_input text,
  cutoff_input timestamptz default null,
  timezone_input text default null,
  context_input text default null
)
returns jsonb
language plpgsql
stable
set search_path = ''
as $function$
declare
  source_value text := private.market_family_normalize_v4(question_input);
  folded_value text := private.market_family_fold_v4(question_input);
  operator_value text := private.market_family_temporal_operator_v4(question_input);
  timezone_contract jsonb := private.market_family_timezone_contract_v4(
    timezone_input, coalesce(question_input, '') || ' ' || coalesce(context_input, '')
  );
  timezone_value text := timezone_contract ->> 'id';
  timezone_mode text := timezone_contract ->> 'mode';
  offset_minutes_value integer := (timezone_contract ->> 'offset_minutes')::integer;
  parts text[];
  clock_parts text[];
  year_value integer;
  month_value integer;
  day_value integer;
  hour_value integer := 0;
  minute_value integer := 0;
  second_value integer := 0;
  date_granularity text;
  granularity_value text;
  meridiem_value text;
  instant_value timestamptz := cutoff_input;
  canonical_operator_value text;
  canonical_instant_value timestamptz;
  local_timestamp_value timestamp;
  canonical_local_timestamp timestamp;
  candidate_count integer := 0;
  candidate_values timestamptz[] := array[]::timestamptz[];
  candidate_instants_value jsonb := '[]'::jsonb;
  ambiguity_reason text;
begin
  parts := regexp_match(folded_value, '\m(20[0-9]{2})-([0-9]{2})-([0-9]{2})\M');
  if parts is not null then
    year_value := parts[1]::integer; month_value := parts[2]::integer; day_value := parts[3]::integer;
    date_granularity := 'day';
  end if;
  if date_granularity is null then
    parts := regexp_match(source_value, '\m([0-9]{1,2}) (?:de )?([a-z]+) (?:de )?(20[0-9]{2})\M');
    if parts is not null and private.market_family_month_v4(parts[2]) is not null then
      day_value := parts[1]::integer; month_value := private.market_family_month_v4(parts[2]); year_value := parts[3]::integer;
      date_granularity := 'day';
    end if;
  end if;
  if date_granularity is null then
    parts := regexp_match(source_value, '\m([a-z]+) ([0-9]{1,2})(?: de)? (20[0-9]{2})\M');
    if parts is not null and private.market_family_month_v4(parts[1]) is not null then
      month_value := private.market_family_month_v4(parts[1]); day_value := parts[2]::integer; year_value := parts[3]::integer;
      date_granularity := 'day';
    end if;
  end if;
  if date_granularity is null then
    parts := regexp_match(source_value, '\m([a-z]+) (?:de )?(20[0-9]{2})\M');
    if parts is not null and private.market_family_month_v4(parts[1]) is not null then
      month_value := private.market_family_month_v4(parts[1]); year_value := parts[2]::integer;
      date_granularity := 'month';
    end if;
  end if;
  if date_granularity is null then
    parts := regexp_match(source_value, '\m(20[0-9]{2})\M');
    if parts is not null then year_value := parts[1]::integer; date_granularity := 'year'; end if;
  end if;

  clock_parts := regexp_match(folded_value, '\m([0-9]{1,2}):([0-9]{2})(?::([0-9]{2}))?[[:space:]]*(am|pm)?\M');
  if clock_parts is not null then
    hour_value := clock_parts[1]::integer;
    minute_value := clock_parts[2]::integer;
    second_value := coalesce(nullif(clock_parts[3], ''), '0')::integer;
    meridiem_value := lower(coalesce(clock_parts[4], ''));
    granularity_value := case when second_value <> 0 then 'second' else 'minute' end;
  else
    clock_parts := regexp_match(folded_value, '\m([0-9]{1,2})[[:space:]]*(am|pm)\M');
    if clock_parts is not null then
      hour_value := clock_parts[1]::integer;
      meridiem_value := lower(clock_parts[2]);
      granularity_value := 'minute';
    end if;
  end if;
  if meridiem_value = 'pm' and hour_value < 12 then hour_value := hour_value + 12; end if;
  if meridiem_value = 'am' and hour_value = 12 then hour_value := 0; end if;

  if date_granularity is null and instant_value is null then return null; end if;
  date_granularity := coalesce(date_granularity, 'second');
  granularity_value := coalesce(granularity_value, date_granularity);
  if coalesce((timezone_contract ->> 'ambiguous')::boolean, false)
     or timezone_mode = 'ambiguous' then
    ambiguity_reason := 'ambiguous_timezone';
  end if;

  if instant_value is null then
    if date_granularity = 'year' then
      month_value := case when operator_value in ('lte', 'gt') then 12 else 1 end;
      day_value := case when operator_value in ('lte', 'gt') then 31 else 1 end;
    elsif date_granularity = 'month' then
      day_value := case when operator_value in ('lte', 'gt')
        then extract(day from (make_date(year_value, month_value, 1) + interval '1 month - 1 day'))::integer
        else 1 end;
    end if;
    if clock_parts is null and operator_value in ('lte', 'gt') then
      hour_value := 23; minute_value := 59; second_value := 59;
    end if;
    local_timestamp_value := make_timestamp(
      year_value, month_value, day_value, hour_value, minute_value, second_value
    );
    if ambiguity_reason is null then
      if timezone_mode = 'fixed_offset' then
        instant_value := (
          local_timestamp_value - make_interval(mins => offset_minutes_value)
        ) at time zone 'UTC';
      elsif timezone_mode = 'iana' then
        select count(*), coalesce(array_agg(candidate_value order by candidate_value), array[]::timestamptz[])
        into candidate_count, candidate_values
        from (
          select (
            local_timestamp_value - make_interval(mins => offsets.offset_minutes_probe)
          ) at time zone 'UTC' candidate_value
          from generate_series(-840, 840, 15) offsets(offset_minutes_probe)
        ) candidates
        where candidate_value at time zone timezone_value = local_timestamp_value;
        if candidate_count = 1 then
          instant_value := candidate_values[1];
        else
          ambiguity_reason := case when candidate_count = 0
            then 'nonexistent_local_time' else 'repeated_local_time' end;
          select coalesce(jsonb_agg(
            to_char(candidate_value at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
            order by candidate_value
          ), '[]'::jsonb)
          into candidate_instants_value
          from unnest(candidate_values) candidate_value;
        end if;
      else
        ambiguity_reason := 'ambiguous_timezone';
      end if;
    end if;
  end if;

  canonical_operator_value := operator_value;
  canonical_instant_value := instant_value;
  if clock_parts is null and date_granularity in ('day', 'month', 'year')
     and operator_value in ('lte', 'gt') then
    canonical_operator_value := case when operator_value = 'lte' then 'lt' else 'gte' end;
    if instant_value is not null then
      canonical_instant_value := instant_value + interval '1 second';
    end if;
  end if;

  if ambiguity_reason is not null then
    canonical_local_timestamp := local_timestamp_value;
    if clock_parts is null and date_granularity in ('day', 'month', 'year')
       and operator_value in ('lte', 'gt') then
      canonical_local_timestamp := local_timestamp_value + interval '1 second';
    end if;
    return jsonb_build_object(
      'operator', operator_value,
      'instant', null,
      'canonical_operator', canonical_operator_value,
      'canonical_instant', null,
      'local_instant', coalesce(
        to_char(local_timestamp_value, 'YYYY-MM-DD"T"HH24:MI:SS'),
        to_char(cutoff_input at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
      ),
      'canonical_local_instant', coalesce(
        to_char(canonical_local_timestamp, 'YYYY-MM-DD"T"HH24:MI:SS'),
        to_char(cutoff_input at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
      ),
      'timezone', timezone_value,
      'timezone_label', timezone_contract ->> 'label',
      'timezone_mode', timezone_mode,
      'offset_minutes', null,
      'timezone_ambiguous', true,
      'ambiguity_reason', ambiguity_reason,
      'candidate_instants', candidate_instants_value,
      'identity_ambiguous', true,
      'granularity', granularity_value
    );
  end if;

  return jsonb_build_object(
    'operator', operator_value,
    'instant', to_char(instant_value at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'canonical_operator', canonical_operator_value,
    'canonical_instant', to_char(canonical_instant_value at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'timezone', timezone_value,
    'timezone_label', timezone_contract ->> 'label',
    'timezone_mode', timezone_mode,
    'offset_minutes', offset_minutes_value,
    'timezone_ambiguous', false,
    'granularity', granularity_value
  );
exception
  when datetime_field_overflow or invalid_datetime_format then return null;
end;
$function$;

create or replace function private.market_family_safe_timestamptz_v4(value_input text)
returns timestamptz
language plpgsql
stable
set search_path = ''
as $function$
begin
  return nullif(trim(value_input), '')::timestamptz;
exception when invalid_datetime_format or datetime_field_overflow then
  return null;
end;
$function$;

-- El corte elimina toda la cadena v2/v3. Ningún match histórico suministrado
-- por un payload puede volver a convertirse en un bloqueo v4.
drop trigger if exists a_apply_structured_kalshi_candidate_family_before_write
  on private.external_market_candidates;
drop trigger if exists classify_market_candidate_family_before_write
  on private.external_market_candidates;
drop trigger if exists zz_enforce_exact_candidate_family_duplicate_before_write
  on private.external_market_candidates;
drop trigger if exists zzz_deduplicate_market_candidate_family_arrays_before_write
  on private.external_market_candidates;
drop trigger if exists a_assign_market_candidate_family_v4_before_write
  on private.external_market_candidates;
drop trigger if exists zzz_classify_market_candidate_relations_v4_before_write
  on private.external_market_candidates;
drop trigger if exists zzzz_set_market_candidate_preparation_revision_before_write
  on private.external_market_candidates;
drop trigger if exists assign_market_draft_family_before_write on private.market_drafts;
drop trigger if exists assign_public_market_family_before_write on public.markets;

create or replace function private.assign_market_candidate_family_v4()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  metadata_value jsonb;
begin
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

create or replace function private.assign_market_draft_family_v4()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  metadata_value jsonb;
begin
  metadata_value := private.market_family_metadata_v4(
    new.question, null, new.subject,
    coalesce(new.source_provenance ->> 'event_group_key', new.family_source_event_key),
    new.evaluation_ends_at, new.timezone,
    concat_ws(' ', new.yes_criteria, new.no_criteria, new.edge_cases), null
  );
  if new.workflow_status not in ('cancelled', 'annulled')
     and coalesce((metadata_value #>> '{family_semantics,identity_ambiguous}')::boolean, false) then
    raise exception 'FAMILY_IDENTITY_AMBIGUOUS'
      using errcode = '23514';
  end if;
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
  return new;
end;
$function$;

create or replace function private.assign_public_market_family_v4()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  metadata_value jsonb;
begin
  metadata_value := private.market_family_metadata_v4(
    new.question, null, null, new.family_source_event_key,
    new.evaluation_ends_at, new.evaluation_timezone, null, null
  );
  if coalesce((metadata_value #>> '{family_semantics,identity_ambiguous}')::boolean, false) then
    raise exception 'FAMILY_IDENTITY_AMBIGUOUS'
      using errcode = '23514';
  end if;
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
  return new;
end;
$function$;

create or replace function private.market_candidate_relations_v4(
  candidate_input private.external_market_candidates
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  blockers_value jsonb := '[]'::jsonb;
  siblings_value jsonb := '[]'::jsonb;
  ambiguities_value jsonb := '[]'::jsonb;
  entity_value text := candidate_input.family_semantics ->> 'entity_label';
begin
  if candidate_input.family_version <> 'atinara-market-family-v4'
     or candidate_input.family_key is null or candidate_input.family_child_key is null then
    return jsonb_build_object('blockers', blockers_value, 'siblings', siblings_value, 'ambiguities', ambiguities_value);
  end if;
  if coalesce((candidate_input.family_semantics ->> 'identity_ambiguous')::boolean, false) then
    ambiguities_value := jsonb_build_array(jsonb_build_object(
      'id', candidate_input.id,
      'question', coalesce(
        candidate_input.normalized_payload ->> 'atinara_question',
        candidate_input.normalized_payload ->> 'source_question'
      ),
      'relationship', 'identity_ambiguous',
      'blocking', false,
      'family_key', candidate_input.family_key,
      'family_child_key', candidate_input.family_child_key,
      'family_version', 'atinara-market-family-v4',
      'kind', 'contract'
    ));
    return jsonb_build_object('blockers', blockers_value, 'siblings', siblings_value, 'ambiguities', ambiguities_value);
  end if;

  select coalesce(jsonb_agg(item_value order by kind_value, id_value), '[]'::jsonb)
  into ambiguities_value
  from (
    select 'market' kind_value, market_alias.id::text id_value, jsonb_build_object(
      'id', market_alias.id, 'question', market_alias.question,
      'relationship', 'identity_ambiguous', 'blocking', false,
      'family_key', candidate_input.family_key, 'family_child_key', market_alias.family_child_key,
      'family_version', 'atinara-market-family-v4', 'kind', 'market'
    ) item_value
    from public.markets market_alias
    where market_alias.family_version = 'atinara-market-family-v4'
      and market_alias.family_key = candidate_input.family_key
      and (
        coalesce((market_alias.family_semantics ->> 'identity_ambiguous')::boolean, false)
        or not private.market_family_alias_equivalent_v4(entity_value, market_alias.family_semantics ->> 'entity_label')
      )
    union all
    select 'draft', draft_alias.id::text, jsonb_build_object(
      'id', draft_alias.id, 'question', draft_alias.question,
      'relationship', 'identity_ambiguous', 'blocking', false,
      'family_key', candidate_input.family_key, 'family_child_key', draft_alias.family_child_key,
      'family_version', 'atinara-market-family-v4', 'kind', 'draft'
    )
    from private.market_drafts draft_alias
    where draft_alias.family_version = 'atinara-market-family-v4'
      and draft_alias.family_key = candidate_input.family_key
      and draft_alias.market_id is null
      and draft_alias.workflow_status not in ('cancelled', 'annulled')
      and draft_alias.radar_candidate_id is distinct from candidate_input.id
      and (
        coalesce((draft_alias.family_semantics ->> 'identity_ambiguous')::boolean, false)
        or not private.market_family_alias_equivalent_v4(entity_value, draft_alias.family_semantics ->> 'entity_label')
      )
    union all
    select 'candidate', candidate_alias.id::text, jsonb_build_object(
      'id', candidate_alias.id, 'provider', candidate_alias.provider, 'external_id', candidate_alias.external_id,
      'question', coalesce(candidate_alias.normalized_payload ->> 'atinara_question', candidate_alias.normalized_payload ->> 'source_question'),
      'relationship', 'identity_ambiguous', 'blocking', false,
      'family_key', candidate_input.family_key, 'family_child_key', candidate_alias.family_child_key,
      'family_version', 'atinara-market-family-v4', 'kind', 'candidate'
    )
    from private.external_market_candidates candidate_alias
    where candidate_alias.family_version = 'atinara-market-family-v4'
      and candidate_alias.family_key = candidate_input.family_key
      and candidate_alias.id <> candidate_input.id
      and (candidate_alias.provider, candidate_alias.external_id)
          is distinct from (candidate_input.provider, candidate_input.external_id)
      and candidate_alias.state not in ('dismissed', 'expired')
      and candidate_alias.expires_at > now()
      and (coalesce(candidate_alias.verification_status, 'needs_review') not like 'rejected_%'
        or candidate_alias.verification_status = 'rejected_duplicate')
      and (
        coalesce((candidate_alias.family_semantics ->> 'identity_ambiguous')::boolean, false)
        or not private.market_family_alias_equivalent_v4(entity_value, candidate_alias.family_semantics ->> 'entity_label')
      )
  ) ambiguity_rows;

  if jsonb_array_length(ambiguities_value) > 0 then
    return jsonb_build_object('blockers', blockers_value, 'siblings', siblings_value, 'ambiguities', ambiguities_value);
  end if;

  select coalesce(jsonb_agg(item_value order by kind_value, id_value), '[]'::jsonb)
  into blockers_value
  from (
    select 'market' kind_value, market_alias.id::text id_value, jsonb_build_object(
      'id', market_alias.id, 'question', market_alias.question,
      'relationship', 'exact_duplicate', 'blocking', true,
      'family_key', candidate_input.family_key, 'family_child_key', candidate_input.family_child_key,
      'family_version', 'atinara-market-family-v4', 'kind', 'market'
    ) item_value
    from public.markets market_alias
    where market_alias.family_version = 'atinara-market-family-v4'
      and market_alias.family_key = candidate_input.family_key
      and market_alias.family_child_key = candidate_input.family_child_key
      and not exists (
        select 1 from private.market_drafts own_draft
        where own_draft.id = candidate_input.prepared_draft_id
          and (own_draft.market_id = market_alias.id or own_draft.market_slug = market_alias.id)
      )
    union all
    select 'draft', draft_alias.id::text, jsonb_build_object(
      'id', draft_alias.id, 'question', draft_alias.question,
      'relationship', 'exact_duplicate', 'blocking', true,
      'family_key', candidate_input.family_key, 'family_child_key', candidate_input.family_child_key,
      'family_version', 'atinara-market-family-v4', 'kind', 'draft'
    )
    from private.market_drafts draft_alias
    where draft_alias.family_version = 'atinara-market-family-v4'
      and draft_alias.family_key = candidate_input.family_key
      and draft_alias.family_child_key = candidate_input.family_child_key
      and draft_alias.market_id is null
      and draft_alias.workflow_status not in ('cancelled', 'annulled')
      and draft_alias.radar_candidate_id is distinct from candidate_input.id
    union all
    select 'candidate', candidate_alias.id::text, jsonb_build_object(
      'id', candidate_alias.id, 'provider', candidate_alias.provider, 'external_id', candidate_alias.external_id,
      'question', coalesce(candidate_alias.normalized_payload ->> 'atinara_question', candidate_alias.normalized_payload ->> 'source_question'),
      'relationship', 'exact_duplicate', 'blocking', true,
      'family_key', candidate_input.family_key, 'family_child_key', candidate_input.family_child_key,
      'family_version', 'atinara-market-family-v4', 'kind', 'candidate'
    )
    from private.external_market_candidates candidate_alias
    where candidate_alias.family_version = 'atinara-market-family-v4'
      and candidate_alias.family_key = candidate_input.family_key
      and candidate_alias.family_child_key = candidate_input.family_child_key
      and candidate_alias.id <> candidate_input.id
      and (candidate_alias.provider, candidate_alias.external_id)
          is distinct from (candidate_input.provider, candidate_input.external_id)
      and candidate_alias.state not in ('dismissed', 'expired')
      and candidate_alias.expires_at > now()
      and (coalesce(candidate_alias.verification_status, 'needs_review') not like 'rejected_%'
        or candidate_alias.verification_status = 'rejected_duplicate')
      and (candidate_alias.created_at, candidate_alias.id)
          < (coalesce(candidate_input.created_at, now()), candidate_input.id)
  ) blocker_rows;

  select coalesce(jsonb_agg(item_value order by kind_value, id_value), '[]'::jsonb)
  into siblings_value
  from (
    select 'market' kind_value, market_alias.id::text id_value, jsonb_build_object(
      'id', market_alias.id, 'question', market_alias.question,
      'relationship', 'sibling', 'blocking', false,
      'family_key', candidate_input.family_key, 'family_child_key', market_alias.family_child_key,
      'family_version', 'atinara-market-family-v4', 'kind', 'market'
    ) item_value
    from public.markets market_alias
    where market_alias.family_version = 'atinara-market-family-v4'
      and market_alias.family_key = candidate_input.family_key
      and market_alias.family_child_key <> candidate_input.family_child_key
    union all
    select 'draft', draft_alias.id::text, jsonb_build_object(
      'id', draft_alias.id, 'question', draft_alias.question,
      'relationship', 'sibling', 'blocking', false,
      'family_key', candidate_input.family_key, 'family_child_key', draft_alias.family_child_key,
      'family_version', 'atinara-market-family-v4', 'kind', 'draft'
    )
    from private.market_drafts draft_alias
    where draft_alias.family_version = 'atinara-market-family-v4'
      and draft_alias.family_key = candidate_input.family_key
      and draft_alias.family_child_key <> candidate_input.family_child_key
      and draft_alias.market_id is null
      and draft_alias.workflow_status not in ('cancelled', 'annulled')
      and draft_alias.radar_candidate_id is distinct from candidate_input.id
    union all
    select 'candidate', candidate_alias.id::text, jsonb_build_object(
      'id', candidate_alias.id, 'provider', candidate_alias.provider, 'external_id', candidate_alias.external_id,
      'question', coalesce(candidate_alias.normalized_payload ->> 'atinara_question', candidate_alias.normalized_payload ->> 'source_question'),
      'relationship', 'sibling', 'blocking', false,
      'family_key', candidate_input.family_key, 'family_child_key', candidate_alias.family_child_key,
      'family_version', 'atinara-market-family-v4', 'kind', 'candidate'
    )
    from private.external_market_candidates candidate_alias
    where candidate_alias.family_version = 'atinara-market-family-v4'
      and candidate_alias.family_key = candidate_input.family_key
      and candidate_alias.family_child_key <> candidate_input.family_child_key
      and candidate_alias.id <> candidate_input.id
      and (candidate_alias.provider, candidate_alias.external_id)
          is distinct from (candidate_input.provider, candidate_input.external_id)
      and candidate_alias.state not in ('dismissed', 'expired')
      and (coalesce(candidate_alias.verification_status, 'needs_review') not like 'rejected_%'
        or candidate_alias.verification_status = 'rejected_duplicate')
  ) sibling_rows;

  return jsonb_build_object('blockers', blockers_value, 'siblings', siblings_value, 'ambiguities', ambiguities_value);
end;
$function$;
-- Proyecciones autoritativas. Las tablas temporales permiten validar todo el
-- corte antes de modificar una sola identidad persistida.
create temporary table market_family_v4_public_map on commit drop as
select market_alias.id,
  private.market_family_metadata_v4(
    market_alias.question, null, null, market_alias.family_source_event_key,
    market_alias.evaluation_ends_at, market_alias.evaluation_timezone, null, null
  ) metadata
from public.markets market_alias;

create temporary table market_family_v4_draft_map on commit drop as
select draft_alias.id, draft_alias.market_id, draft_alias.workflow_status,
  private.market_family_metadata_v4(
    draft_alias.question, null, draft_alias.subject,
    coalesce(draft_alias.source_provenance ->> 'event_group_key', draft_alias.family_source_event_key),
    draft_alias.evaluation_ends_at, draft_alias.timezone,
    concat_ws(' ', draft_alias.yes_criteria, draft_alias.no_criteria, draft_alias.edge_cases), null
  ) metadata
from private.market_drafts draft_alias;

create temporary table market_family_v4_candidate_map on commit drop as
select candidate_alias.id, candidate_alias.state original_state,
  private.market_family_metadata_v4(
    coalesce(candidate_alias.normalized_payload ->> 'atinara_question', candidate_alias.normalized_payload ->> 'source_question'),
    candidate_alias.normalized_payload ->> 'source_title',
    coalesce(candidate_alias.normalized_payload ->> 'atinara_subject', candidate_alias.normalized_payload ->> 'subject'),
    coalesce(candidate_alias.normalized_payload ->> 'event_group_key', candidate_alias.external_event_id),
    private.market_family_safe_timestamptz_v4(coalesce(
      candidate_alias.normalized_payload ->> 'evaluation_ends_at',
      candidate_alias.normalized_payload ->> 'family_cutoff_at'
    )),
    coalesce(
      candidate_alias.normalized_payload ->> 'evaluation_timezone',
      candidate_alias.normalized_payload ->> 'timezone',
      candidate_alias.normalized_payload ->> 'source_timezone',
      candidate_alias.normalized_payload #>> '{provider_payload,timezone}'
    ),
    candidate_alias.normalized_payload ->> 'source_resolution_rules',
    coalesce(
      candidate_alias.normalized_payload #>> '{provider_payload,yes_sub_title}',
      candidate_alias.normalized_payload ->> 'yes_sub_title'
    )
  ) metadata
from private.external_market_candidates candidate_alias;

do $preflight$
declare
  collision_value text;
begin
  select 'public:' || id::text into collision_value
  from market_family_v4_public_map
  where nullif(metadata ->> 'family_key', '') is null
  limit 1;
  if collision_value is not null then
    raise exception 'market_family_v4_missing_identity:%', collision_value;
  end if;

  select 'public:' || id::text into collision_value
  from market_family_v4_public_map
  where coalesce((metadata #>> '{family_semantics,identity_ambiguous}')::boolean, false)
  limit 1;
  if collision_value is not null then
    raise exception 'market_family_v4_ambiguous_published_identity:%', collision_value;
  end if;

  select 'draft:' || id::text into collision_value
  from market_family_v4_draft_map
  where workflow_status not in ('cancelled', 'annulled')
    and market_id is null
    and coalesce((metadata #>> '{family_semantics,identity_ambiguous}')::boolean, false)
  limit 1;
  if collision_value is not null then
    raise exception 'market_family_v4_ambiguous_draft_identity:%', collision_value;
  end if;

  select 'draft:' || id::text into collision_value
  from market_family_v4_draft_map
  where nullif(metadata ->> 'family_key', '') is null
  limit 1;
  if collision_value is not null then
    raise exception 'market_family_v4_missing_identity:%', collision_value;
  end if;

  select 'candidate:' || id::text into collision_value
  from market_family_v4_candidate_map
  where nullif(metadata ->> 'family_key', '') is null
  limit 1;
  if collision_value is not null then
    raise exception 'market_family_v4_missing_identity:%', collision_value;
  end if;

  select concat(metadata ->> 'family_key', '|', metadata ->> 'family_child_key')
  into collision_value
  from market_family_v4_public_map
  group by metadata ->> 'family_key', metadata ->> 'family_child_key'
  having count(*) > 1
  limit 1;
  if collision_value is not null then
    raise exception 'market_family_v4_public_collision:%', collision_value;
  end if;

  select concat(mapped.metadata ->> 'family_key', '|', mapped.metadata ->> 'family_child_key')
  into collision_value
  from market_family_v4_draft_map mapped
  where mapped.workflow_status not in ('cancelled', 'annulled')
    and mapped.market_id is null
  group by mapped.metadata ->> 'family_key', mapped.metadata ->> 'family_child_key'
  having count(*) > 1
  limit 1;
  if collision_value is not null then
    raise exception 'market_family_v4_draft_collision:%', collision_value;
  end if;

  select concat(public_map.metadata ->> 'family_key', '|', public_map.metadata ->> 'family_child_key')
  into collision_value
  from market_family_v4_public_map public_map
  join market_family_v4_draft_map draft_map
    on draft_map.metadata ->> 'family_key' = public_map.metadata ->> 'family_key'
   and draft_map.metadata ->> 'family_child_key' = public_map.metadata ->> 'family_child_key'
  where draft_map.market_id is null
    and draft_map.workflow_status not in ('cancelled', 'annulled')
  limit 1;
  if collision_value is not null then
    raise exception 'market_family_v4_cross_definition_collision:%', collision_value;
  end if;

  with all_entities as (
    select 'market' kind, id::text id, metadata ->> 'family_key' family_key,
      metadata #>> '{family_semantics,entity_label}' entity_label
    from market_family_v4_public_map
    union all
    select 'draft', id::text, metadata ->> 'family_key', metadata #>> '{family_semantics,entity_label}'
    from market_family_v4_draft_map
    where workflow_status not in ('cancelled', 'annulled') and market_id is null
    union all
    select 'candidate', id::text, metadata ->> 'family_key', metadata #>> '{family_semantics,entity_label}'
    from market_family_v4_candidate_map
  )
  select left_entity.family_key || ':' || left_entity.entity_label || '<>' || right_entity.entity_label
  into collision_value
  from all_entities left_entity
  join all_entities right_entity
    on right_entity.family_key = left_entity.family_key
   and (right_entity.kind, right_entity.id) > (left_entity.kind, left_entity.id)
  where not private.market_family_alias_equivalent_v4(left_entity.entity_label, right_entity.entity_label)
    and left_entity.kind <> 'candidate'
    and right_entity.kind <> 'candidate'
  limit 1;
  if collision_value is not null then
    raise exception 'market_family_v4_ambiguous_alias_collision:%', collision_value;
  end if;
end;
$preflight$;

update public.markets market_alias
set
  family_key = mapped.metadata ->> 'family_key',
  family_title = mapped.metadata ->> 'family_title',
  family_type = mapped.metadata ->> 'family_type',
  family_child_key = mapped.metadata ->> 'family_child_key',
  family_child_label = mapped.metadata ->> 'family_child_label',
  family_sort_at = private.market_family_safe_timestamptz_v4(mapped.metadata ->> 'family_sort_at'),
  family_relationship = 'standalone',
  family_semantics = mapped.metadata -> 'family_semantics',
  family_source_event_key = mapped.metadata ->> 'family_source_event_key',
  family_version = 'atinara-market-family-v4'
from market_family_v4_public_map mapped
where mapped.id = market_alias.id
  and row(
    market_alias.family_key, market_alias.family_title, market_alias.family_type,
    market_alias.family_child_key, market_alias.family_child_label, market_alias.family_sort_at,
    market_alias.family_relationship, market_alias.family_semantics,
    market_alias.family_source_event_key, market_alias.family_version
  ) is distinct from row(
    mapped.metadata ->> 'family_key', mapped.metadata ->> 'family_title', mapped.metadata ->> 'family_type',
    mapped.metadata ->> 'family_child_key', mapped.metadata ->> 'family_child_label',
    private.market_family_safe_timestamptz_v4(mapped.metadata ->> 'family_sort_at'),
    'standalone', mapped.metadata -> 'family_semantics',
    mapped.metadata ->> 'family_source_event_key', 'atinara-market-family-v4'
  );

update private.market_drafts draft_alias
set
  family_key = mapped.metadata ->> 'family_key',
  family_title = mapped.metadata ->> 'family_title',
  family_type = mapped.metadata ->> 'family_type',
  family_child_key = mapped.metadata ->> 'family_child_key',
  family_child_label = mapped.metadata ->> 'family_child_label',
  family_sort_at = private.market_family_safe_timestamptz_v4(mapped.metadata ->> 'family_sort_at'),
  family_relationship = 'standalone',
  family_semantics = mapped.metadata -> 'family_semantics',
  family_source_event_key = mapped.metadata ->> 'family_source_event_key',
  family_version = 'atinara-market-family-v4'
from market_family_v4_draft_map mapped
where mapped.id = draft_alias.id
  and row(
    draft_alias.family_key, draft_alias.family_title, draft_alias.family_type,
    draft_alias.family_child_key, draft_alias.family_child_label, draft_alias.family_sort_at,
    draft_alias.family_relationship, draft_alias.family_semantics,
    draft_alias.family_source_event_key, draft_alias.family_version
  ) is distinct from row(
    mapped.metadata ->> 'family_key', mapped.metadata ->> 'family_title', mapped.metadata ->> 'family_type',
    mapped.metadata ->> 'family_child_key', mapped.metadata ->> 'family_child_label',
    private.market_family_safe_timestamptz_v4(mapped.metadata ->> 'family_sort_at'),
    'standalone', mapped.metadata -> 'family_semantics',
    mapped.metadata ->> 'family_source_event_key', 'atinara-market-family-v4'
  );

-- Primera fase candidata: solo instala identidad. Las relaciones se recalculan
-- después, cuando todas las filas ya hablan v4, evitando depender del orden del lote.
update private.external_market_candidates candidate_alias
set
  family_key = mapped.metadata ->> 'family_key',
  family_title = mapped.metadata ->> 'family_title',
  family_type = mapped.metadata ->> 'family_type',
  family_child_key = mapped.metadata ->> 'family_child_key',
  family_child_label = mapped.metadata ->> 'family_child_label',
  family_sort_at = private.market_family_safe_timestamptz_v4(mapped.metadata ->> 'family_sort_at'),
  family_relationship = 'standalone',
  family_semantics = mapped.metadata -> 'family_semantics',
  family_source_event_key = mapped.metadata ->> 'family_source_event_key',
  family_version = 'atinara-market-family-v4'
from market_family_v4_candidate_map mapped
where mapped.id = candidate_alias.id
  and row(
    candidate_alias.family_key, candidate_alias.family_title, candidate_alias.family_type,
    candidate_alias.family_child_key, candidate_alias.family_child_label, candidate_alias.family_sort_at,
    candidate_alias.family_relationship, candidate_alias.family_semantics,
    candidate_alias.family_source_event_key, candidate_alias.family_version
  ) is distinct from row(
    mapped.metadata ->> 'family_key', mapped.metadata ->> 'family_title', mapped.metadata ->> 'family_type',
    mapped.metadata ->> 'family_child_key', mapped.metadata ->> 'family_child_label',
    private.market_family_safe_timestamptz_v4(mapped.metadata ->> 'family_sort_at'),
    'standalone', mapped.metadata -> 'family_semantics',
    mapped.metadata ->> 'family_source_event_key', 'atinara-market-family-v4'
  );

create trigger a_assign_market_candidate_family_v4_before_write
before insert or update of normalized_payload, external_event_id
on private.external_market_candidates
for each row execute function private.assign_market_candidate_family_v4();

create trigger zzz_classify_market_candidate_relations_v4_before_write
before insert or update of normalized_payload, duplicate_matches, family_key, family_child_key
on private.external_market_candidates
for each row execute function private.classify_market_candidate_relations_v4();

create temporary table market_family_v4_relation_map on commit drop as
select candidate_alias.id,
  private.market_candidate_relations_v4(candidate_alias) relations
from private.external_market_candidates candidate_alias;

create temporary table market_family_v4_candidate_changes on commit drop as
select candidate_alias.id
from private.external_market_candidates candidate_alias
join market_family_v4_relation_map relation_map on relation_map.id = candidate_alias.id
where candidate_alias.normalized_payload ->> 'family_version' is distinct from 'atinara-market-family-v4'
   or candidate_alias.duplicate_matches is distinct from relation_map.relations -> 'blockers'
   or candidate_alias.normalized_payload -> 'family_matches' is distinct from relation_map.relations -> 'siblings'
   or candidate_alias.normalized_payload -> 'family_identity_ambiguities' is distinct from relation_map.relations -> 'ambiguities'
   or candidate_alias.normalized_payload ->> 'family_key' is distinct from candidate_alias.family_key
   or candidate_alias.normalized_payload ->> 'family_child_key' is distinct from candidate_alias.family_child_key
   or candidate_alias.family_relationship is distinct from case
        when jsonb_array_length(relation_map.relations -> 'blockers') > 0 then 'exact_duplicate'
        when jsonb_array_length(relation_map.relations -> 'siblings') > 0 then 'sibling'
        else 'standalone'
      end
   or (
     candidate_alias.state = 'rejected'
     and (candidate_alias.verification_status = 'rejected_duplicate'
       or candidate_alias.verification_reason_code = 'DUPLICATE_MARKET')
     and jsonb_array_length(relation_map.relations -> 'blockers') = 0
   );

update private.external_market_candidates candidate_alias
set
  normalized_payload = candidate_alias.normalized_payload,
  preparation_revision = candidate_alias.preparation_revision + 1
from market_family_v4_candidate_changes changed
where changed.id = candidate_alias.id;

create trigger zzzz_set_market_candidate_preparation_revision_before_write
before insert or update on private.external_market_candidates
for each row execute function private.set_market_candidate_preparation_revision();

create trigger assign_market_draft_family_before_write
before insert or update of question, subject, evaluation_ends_at, timezone,
  yes_criteria, no_criteria, edge_cases, source_provenance
on private.market_drafts
for each row execute function private.assign_market_draft_family_v4();

create trigger assign_public_market_family_before_write
before insert or update of question, evaluation_ends_at, evaluation_timezone
on public.markets
for each row execute function private.assign_public_market_family_v4();

do $postflight$
begin
  if exists (
    select 1 from public.markets where family_version is distinct from 'atinara-market-family-v4'
  ) or exists (
    select 1 from private.market_drafts where family_version is distinct from 'atinara-market-family-v4'
  ) or exists (
    select 1 from private.external_market_candidates where family_version is distinct from 'atinara-market-family-v4'
  ) then
    raise exception 'market_family_v4_incomplete_backfill';
  end if;

  if exists (
    select 1
    from private.external_market_candidates candidate_alias,
      lateral jsonb_array_elements(candidate_alias.duplicate_matches) match_item
    where match_item ->> 'relationship' <> 'exact_duplicate'
       or match_item ->> 'family_version' <> 'atinara-market-family-v4'
       or lower(coalesce(match_item ->> 'blocking', 'true')) in ('false', '0', 'no')
       or match_item ->> 'family_child_key' is distinct from candidate_alias.family_child_key
  ) then
    raise exception 'market_family_v4_non_exact_blocker';
  end if;

  if exists (
    select 1
    from private.external_market_candidates candidate_alias
    where candidate_alias.state = 'rejected'
      and candidate_alias.verification_status = 'rejected_duplicate'
      and jsonb_array_length(candidate_alias.duplicate_matches) = 0
  ) then
    raise exception 'market_family_v4_false_duplicate_still_rejected';
  end if;

  if exists (
    select 1
    from market_family_v4_candidate_map snapshot
    join private.external_market_candidates candidate_alias on candidate_alias.id = snapshot.id
    where snapshot.original_state in ('prepared', 'dismissed')
      and candidate_alias.state is distinct from snapshot.original_state
  ) then
    raise exception 'market_family_v4_changed_terminal_candidate_state';
  end if;
end;
$postflight$;

revoke all on function private.market_family_normalize_v4(text) from public, anon, authenticated;
revoke all on function private.market_family_fold_v4(text) from public, anon, authenticated;
revoke all on function private.market_family_slug_v4(text,integer) from public, anon, authenticated;
revoke all on function private.market_family_month_v4(text) from public, anon, authenticated;
revoke all on function private.market_family_timezone_token_v4(text) from public, anon, authenticated;
revoke all on function private.market_family_timezone_contract_v4(text,text) from public, anon, authenticated;
revoke all on function private.market_family_timezone_v4(text,text) from public, anon, authenticated;
revoke all on function private.market_family_temporal_operator_v4(text) from public, anon, authenticated;
revoke all on function private.market_family_boundary_v4(text,timestamptz,text,text) from public, anon, authenticated;
revoke all on function private.market_family_metric_unit_v4(text) from public, anon, authenticated;
revoke all on function private.market_family_canonical_number_v4(text,text) from public, anon, authenticated;
revoke all on function private.market_family_threshold_v4(text,text) from public, anon, authenticated;
revoke all on function private.market_family_entity_identity_v4(text) from public, anon, authenticated;
revoke all on function private.market_family_alias_equivalent_v4(text,text) from public, anon, authenticated;
revoke all on function private.market_family_title_entity_v4(text) from public, anon, authenticated;
revoke all on function private.market_family_question_entity_v4(text,text) from public, anon, authenticated;
revoke all on function private.market_family_entity_label_v4(text,text,text,text) from public, anon, authenticated;
revoke all on function private.market_family_metadata_v4(text,text,text,text,timestamptz,text,text,text) from public, anon, authenticated;
revoke all on function private.market_family_safe_timestamptz_v4(text) from public, anon, authenticated;
revoke all on function private.assign_market_candidate_family_v4() from public, anon, authenticated;
revoke all on function private.assign_market_draft_family_v4() from public, anon, authenticated;
revoke all on function private.assign_public_market_family_v4() from public, anon, authenticated;
revoke all on function private.market_candidate_relations_v4(private.external_market_candidates) from public, anon, authenticated;
revoke all on function private.classify_market_candidate_relations_v4() from public, anon, authenticated;
revoke all on function private.market_candidate_blocking_duplicates(jsonb,uuid) from public, anon, authenticated;
revoke all on function private.market_candidate_sibling_matches(jsonb,uuid) from public, anon, authenticated;
revoke all on function private.market_candidate_has_blocking_duplicate(jsonb,uuid) from public, anon, authenticated;

comment on function private.market_family_metadata_v4(text,text,text,text,timestamptz,text,text,text) is
  'Contrato familiar v4 compartido con el Radar: entidad/alias, frontera temporal, umbral e invariantes separados.';

commit;
