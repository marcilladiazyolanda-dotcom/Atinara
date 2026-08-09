-- Atinara Engine: puerta factual terminal auditable e identidad contractual v3.
-- No publica, resuelve ni modifica mercados, predicciones, Karma o Prestigio.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';

create table if not exists private.market_radar_fact_checks (
  id bigint generated always as identity primary key,
  provider text not null check (provider in ('polymarket', 'kalshi', 'tavily')),
  external_id text not null,
  event_group_key text,
  fact_context_fingerprint text not null,
  fact_policy_version text not null,
  fact_status text not null check (fact_status in (
    'unresolved', 'partially_resolved', 'fully_resolved', 'conflicting', 'unknown'
  )),
  verification_status text not null,
  reason_code text,
  reason text,
  confidence numeric(5,2) not null check (confidence between 0 and 100),
  evidence jsonb not null default '[]'::jsonb check (jsonb_typeof(evidence) = 'array'),
  checked_at timestamptz not null,
  decision_hash text not null,
  created_at timestamptz not null default now(),
  unique (
    provider, external_id, fact_context_fingerprint,
    fact_policy_version, decision_hash
  )
);

create index if not exists market_radar_fact_checks_candidate_checked_idx
  on private.market_radar_fact_checks (provider, external_id, checked_at desc);
create index if not exists market_radar_fact_checks_event_checked_idx
  on private.market_radar_fact_checks (event_group_key, checked_at desc)
  where event_group_key is not null;

alter table private.market_radar_fact_checks enable row level security;
revoke all on table private.market_radar_fact_checks from public, anon, authenticated;
grant all on table private.market_radar_fact_checks to postgres;
grant select, insert on table private.market_radar_fact_checks to service_role;
grant usage, select on sequence private.market_radar_fact_checks_id_seq to service_role;

create or replace function public.record_market_radar_fact_checks(checks_input jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  inserted_count integer := 0;
begin
  if auth.role() <> 'service_role' then
    raise exception 'SERVICE_ROLE_REQUIRED' using errcode = '42501';
  end if;
  if jsonb_typeof(checks_input) <> 'array'
     or jsonb_array_length(checks_input) > 240
     or octet_length(checks_input::text) > 1048576 then
    raise exception 'INVALID_RADAR_FACT_CHECK_BATCH' using errcode = '22023';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(checks_input) item
    where jsonb_typeof(item) <> 'object'
      or coalesce(item ->> 'provider', '') not in ('polymarket', 'kalshi', 'tavily')
      or coalesce(item ->> 'external_id', '') = ''
      or coalesce(item ->> 'fact_context_fingerprint', '') = ''
      or coalesce(item ->> 'fact_policy_version', '') = ''
      or coalesce(item ->> 'decision_hash', '') = ''
      or coalesce(item ->> 'fact_status', '') not in (
        'unresolved', 'partially_resolved', 'fully_resolved', 'conflicting', 'unknown'
      )
      or jsonb_typeof(coalesce(item -> 'evidence', '[]'::jsonb)) <> 'array'
  ) then
    raise exception 'INVALID_RADAR_FACT_CHECK' using errcode = '22023';
  end if;

  insert into private.market_radar_fact_checks (
    provider, external_id, event_group_key, fact_context_fingerprint,
    fact_policy_version, fact_status, verification_status, reason_code,
    reason, confidence, evidence, checked_at, decision_hash
  )
  select
    left(item ->> 'provider', 40),
    left(item ->> 'external_id', 220),
    nullif(left(item ->> 'event_group_key', 240), ''),
    left(item ->> 'fact_context_fingerprint', 120),
    left(item ->> 'fact_policy_version', 100),
    left(item ->> 'fact_status', 40),
    left(coalesce(item ->> 'verification_status', 'needs_review'), 80),
    nullif(left(item ->> 'reason_code', 100), ''),
    nullif(left(item ->> 'reason', 1000), ''),
    least(greatest(coalesce((item ->> 'confidence')::numeric, 0), 0), 100),
    coalesce(item -> 'evidence', '[]'::jsonb),
    coalesce(nullif(item ->> 'checked_at', '')::timestamptz, now()),
    left(item ->> 'decision_hash', 120)
  from jsonb_array_elements(checks_input) item
  on conflict (
    provider, external_id, fact_context_fingerprint,
    fact_policy_version, decision_hash
  ) do nothing;

  get diagnostics inserted_count = row_count;
  return jsonb_build_object('ok', true, 'inserted', inserted_count);
exception
  when invalid_text_representation or invalid_datetime_format or numeric_value_out_of_range then
    raise exception 'INVALID_RADAR_FACT_CHECK' using errcode = '22023';
end;
$function$;

revoke all on function public.record_market_radar_fact_checks(jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.record_market_radar_fact_checks(jsonb)
  to service_role;

create or replace function private.market_family_month_v3(value_input text)
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

create or replace function private.market_family_deadline_key_v3(value_input text)
returns text
language plpgsql
immutable
set search_path = ''
as $function$
declare
  value_normalized text := private.market_family_normalize(value_input);
  parts text[];
  month_value integer;
  day_value integer;
  year_value integer;
  boundary_date date;
begin
  parts := regexp_match(value_normalized, '(?:before|antes de|antes del) ([0-9]{1,2}) (?:de )?([a-z]+) (?:de )?(20[0-9]{2})');
  if parts is not null then
    day_value := parts[1]::integer;
    month_value := private.market_family_month_v3(parts[2]);
    year_value := parts[3]::integer;
    if month_value is not null then
      boundary_date := make_date(year_value, month_value, day_value);
      return to_char(case when day_value = 1 then boundary_date - 1 else boundary_date end, 'YYYY-MM-DD');
    end if;
  end if;

  parts := regexp_match(value_normalized, '\m([0-9]{1,2}) (?:de )?([a-z]+) (?:de )?(20[0-9]{2})\M');
  if parts is not null then
    month_value := private.market_family_month_v3(parts[2]);
    if month_value is not null then
      return to_char(make_date(parts[3]::integer, month_value, parts[1]::integer), 'YYYY-MM-DD');
    end if;
  end if;

  parts := regexp_match(value_normalized, '(?:before )?([a-z]+) ([0-9]{1,2}) (20[0-9]{2})');
  if parts is not null then
    month_value := private.market_family_month_v3(parts[1]);
    day_value := parts[2]::integer;
    year_value := parts[3]::integer;
    if month_value is not null then
      boundary_date := make_date(year_value, month_value, day_value);
      return to_char(case when value_normalized ~ '\mbefore\M' and day_value = 1 then boundary_date - 1 else boundary_date end, 'YYYY-MM-DD');
    end if;
  end if;

  parts := regexp_match(value_normalized, '(?:before|antes de) ([a-z]+) (?:de )?(20[0-9]{2})');
  if parts is not null then
    month_value := private.market_family_month_v3(parts[1]);
    if month_value is not null then
      return to_char(make_date(parts[2]::integer, month_value, 1) - 1, 'YYYY-MM-DD');
    end if;
  end if;

  parts := regexp_match(value_normalized, '(?:before|antes de) (20[0-9]{2})\M');
  if parts is not null then return (parts[1]::integer - 1)::text || '-12-31'; end if;
  parts := regexp_match(value_normalized, '\m(20[0-9]{2})[ -]([0-9]{2})[ -]([0-9]{2})\M');
  if parts is not null then return parts[1] || '-' || parts[2] || '-' || parts[3]; end if;
  return null;
exception when datetime_field_overflow then
  return null;
end;
$function$;

create or replace function private.market_candidate_family_metadata_v3(
  question_input text,
  title_input text,
  source_event_key_input text,
  sort_at_input timestamptz,
  resolution_rules_input text,
  yes_label_input text
)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $function$
declare
  question_normalized text := private.market_family_normalize(coalesce(question_input, title_input));
  rules_normalized text := private.market_family_normalize(resolution_rules_input);
  label_normalized text := private.market_family_normalize(yes_label_input);
  metadata_value jsonb;
  entity_value text;
  deadline_value text;
  duration_parts text[];
  duration_value integer;
  content_kind text;
  family_key_value text;
  threshold_parts text[];
  threshold_direction text;
  option_key text;
begin
  if question_normalized = '' then return '{}'::jsonb; end if;
  if question_normalized ~ '\m(trailer|teaser|avance|clip|gameplay video)\M' then
    entity_value := private.market_family_entity(question_input, null, 'official_content');
    deadline_value := private.market_family_deadline_key_v3(question_normalized);
    duration_parts := regexp_match(
      question_normalized || ' ' || rules_normalized,
      '(?:at least|al menos|minimo|minimo de) ([0-9]{1,4}) (?:second|seconds|segundo|segundos)'
    );
    if duration_parts is not null then duration_value := duration_parts[1]::integer; end if;
    if duration_value is not null and (duration_value < 1 or duration_value > 3600) then duration_value := null; end if;
    content_kind := case
      when question_normalized ~ '\mteaser\M' then 'teaser'
      when question_normalized ~ '\m(clip|avance)\M' then 'clip'
      else 'trailer'
    end;
    if entity_value is null then return '{}'::jsonb; end if;
    family_key_value := 'atinara:v1:'
      || trim(both '-' from regexp_replace(left(entity_value, 100), '[^a-z0-9]+', '-', 'g'))
      || ':official_content:' || content_kind
      || case when duration_value is not null then ':min-' || duration_value || 's' else '' end;
    return jsonb_build_object(
      'family_key', family_key_value,
      'family_title', 'Contenido oficial · ' || initcap(entity_value),
      'family_type', case when deadline_value is not null then 'deadline_ladder' else 'event_content_options' end,
      'family_child_key', 'content:' || content_kind || ':' || coalesce(deadline_value, md5(question_normalized)),
      'family_child_label', case when deadline_value is not null then 'Hasta ' || deadline_value else left(question_input, 180) end,
      'family_sort_at', coalesce(
        case when deadline_value is not null then (deadline_value || ' 23:59:59+00')::timestamptz else null end,
        sort_at_input
      ),
      'family_relationship', 'standalone',
      'family_semantics', jsonb_build_object(
        'cumulative', deadline_value is not null,
        'mutually_exclusive', false,
        'parent_is_market', false,
        'aggregate_probability', false,
        'economic_independence', true,
        'content_kind', content_kind,
        'minimum_duration_seconds', to_jsonb(duration_value)
      ),
      'family_source_event_key', nullif(trim(source_event_key_input), ''),
      'family_version', 'atinara-market-family-v3'
    );
  end if;

  metadata_value := private.market_family_metadata(
    question_input, title_input, source_event_key_input, sort_at_input
  );
  if nullif(metadata_value ->> 'family_key', '') is null then return metadata_value; end if;

  if metadata_value ->> 'family_type' = 'milestone_thresholds' then
    threshold_parts := regexp_match(
      lower(replace(coalesce(yes_label_input, ''), ',', '.')),
      '(above|over|more than|greater than|at least|below|under|less than|fewer than|at most)[^0-9]*([0-9]+(?:\.[0-9]+)?)'
    );
    if threshold_parts is not null then
      threshold_direction := case when threshold_parts[1] in (
        'below', 'under', 'less than', 'fewer than', 'at most'
      ) then 'below' else 'above' end;
      metadata_value := metadata_value || jsonb_build_object(
        'family_child_key', 'threshold:' || threshold_direction || ':' || threshold_parts[2],
        'family_child_label', yes_label_input
      );
    end if;
  elsif metadata_value ->> 'family_type' in (
    'categorical_outcomes', 'participant_options', 'platform_variants'
  ) and label_normalized not in ('', 'yes', 'si', 'true', 'no') then
    option_key := trim(both '-' from regexp_replace(label_normalized, '[^a-z0-9]+', '-', 'g'));
    if option_key <> '' then
      metadata_value := metadata_value || jsonb_build_object(
        'family_child_key', 'option:' || left(option_key, 120),
        'family_child_label', yes_label_input
      );
    end if;
  end if;
  return metadata_value || jsonb_build_object('family_version', 'atinara-market-family-v3');
end;
$function$;

revoke all on function private.market_family_month_v3(text) from public, anon, authenticated;
revoke all on function private.market_family_deadline_key_v3(text) from public, anon, authenticated;
revoke all on function private.market_candidate_family_metadata_v3(text,text,text,timestamptz,text,text)
  from public, anon, authenticated;

create or replace function private.apply_structured_kalshi_candidate_family()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  metadata_value jsonb;
begin
  metadata_value := private.market_candidate_family_metadata_v3(
    coalesce(new.normalized_payload ->> 'atinara_question', new.normalized_payload ->> 'source_question'),
    new.normalized_payload ->> 'source_title',
    coalesce(new.normalized_payload ->> 'event_group_key', new.external_event_id),
    coalesce(nullif(new.normalized_payload ->> 'source_close_at', '')::timestamptz, new.expires_at),
    new.normalized_payload ->> 'source_resolution_rules',
    coalesce(
      new.normalized_payload #>> '{provider_payload,yes_sub_title}',
      new.normalized_payload ->> 'yes_sub_title'
    )
  );
  if nullif(metadata_value ->> 'family_key', '') is null then return new; end if;

  new.family_key := metadata_value ->> 'family_key';
  new.family_title := metadata_value ->> 'family_title';
  new.family_type := metadata_value ->> 'family_type';
  new.family_child_key := metadata_value ->> 'family_child_key';
  new.family_child_label := metadata_value ->> 'family_child_label';
  new.family_sort_at := nullif(metadata_value ->> 'family_sort_at', '')::timestamptz;
  new.family_semantics := coalesce(metadata_value -> 'family_semantics', '{}'::jsonb);
  new.family_source_event_key := coalesce(
    metadata_value ->> 'family_source_event_key',
    new.normalized_payload ->> 'event_group_key'
  );
  new.family_version := 'atinara-market-family-v3';
  new.normalized_payload := coalesce(new.normalized_payload, '{}'::jsonb) || jsonb_build_object(
    'family_key', new.family_key,
    'family_title', new.family_title,
    'family_type', new.family_type,
    'family_child_key', new.family_child_key,
    'family_child_label', new.family_child_label,
    'family_sort_at', new.family_sort_at,
    'family_semantics', new.family_semantics,
    'family_source_event_key', new.family_source_event_key,
    'family_version', new.family_version
  );
  return new;
end;
$function$;

revoke all on function private.apply_structured_kalshi_candidate_family()
  from public, anon, authenticated;

-- Los preparados/publicados no son rechazos vigentes, aunque una redetección
-- posterior conserve un verification_status histórico rejected_*.
create or replace function public.list_market_radar_rejections(
  provider_filter text default null,
  category_filter text default null,
  limit_count integer default 100,
  offset_count integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  result jsonb;
begin
  perform private.require_current_admin();
  select coalesce(jsonb_agg(private.market_radar_safe_payload(candidate_row)), '[]'::jsonb)
  into result
  from (
    select candidate.*
    from private.external_market_candidates candidate
    where candidate.normalizer_version = 'atinara-radar-v2'
      and candidate.state = 'rejected'
      and candidate.verification_status like 'rejected_%'
      and (provider_filter is null or provider_filter = '' or candidate.provider = provider_filter)
      and (category_filter is null or category_filter = '' or candidate.atinara_category = category_filter)
    order by candidate.verified_at desc nulls last, candidate.updated_at desc
    limit least(greatest(coalesce(limit_count, 100), 1), 250)
    offset greatest(coalesce(offset_count, 0), 0)
  ) candidate_row;
  return result;
end;
$function$;

revoke all on function public.list_market_radar_rejections(text,text,integer,integer)
  from public, anon, authenticated;
grant execute on function public.list_market_radar_rejections(text,text,integer,integer)
  to authenticated;

-- Reabre únicamente falsos duplicados de contenido que una regla numérica
-- incidental convirtió en umbrales. La siguiente ejecución del Radar repetirá
-- la puerta factual antes de poder mostrarlos como propuestas.
update private.external_market_candidates candidate
set
  duplicate_matches = '[]'::jsonb,
  state = 'needs_review',
  quality_status = 'needs_review',
  verification_status = 'needs_review',
  verification_reason_code = null,
  verification_reason = 'La identidad contractual fue reparada; falta repetir la comprobación factual automática.',
  verification_expires_at = null,
  normalized_payload = (
    candidate.normalized_payload
      - 'duplicate_matches'
      - 'family_matches'
      - 'family_key'
      - 'family_title'
      - 'family_type'
      - 'family_child_key'
      - 'family_child_label'
      - 'family_sort_at'
      - 'family_semantics'
      - 'family_version'
  ) || jsonb_build_object(
    'hard_reject_reasons', coalesce((
      select jsonb_agg(reason_value)
      from jsonb_array_elements(coalesce(candidate.normalized_payload -> 'hard_reject_reasons', '[]'::jsonb)) reason_value
      where reason_value #>> '{}' <> 'DUPLICATE_MARKET'
    ), '[]'::jsonb),
    'duplicate_matches', '[]'::jsonb,
    'family_matches', '[]'::jsonb,
    'quality_status', 'needs_review',
    'verification_status', 'needs_review',
    'verification_reason_code', null,
    'verification_reason', 'La identidad contractual fue reparada; falta repetir la comprobación factual automática.',
    'verification_expires_at', null
  )
where candidate.state = 'rejected'
  and candidate.family_type = 'milestone_thresholds'
  and private.market_family_normalize(coalesce(
    candidate.normalized_payload ->> 'atinara_question',
    candidate.normalized_payload ->> 'source_question'
  )) ~ '\m(trailer|teaser|avance|clip|gameplay video)\M';

comment on table private.market_radar_fact_checks is
  'Comprobaciones factuales append-only previas a propuesta/preparación, ligadas a contexto y política.';
comment on function private.market_candidate_family_metadata_v3(text,text,text,timestamptz,text,text) is
  'Identidad contractual v3: separa predicado, invariantes y eje hijo; números incidentales no cambian la dimensión.';

commit;
