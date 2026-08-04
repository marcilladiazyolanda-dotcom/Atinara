-- Paso 13.5: Radar administrativo de mercados externos.
-- Todo el almacenamiento permanece en el esquema privado y solo se expone
-- mediante funciones que vuelven a comprobar el rol administrativo.

create table if not exists private.external_market_candidates (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('polymarket', 'kalshi', 'tavily')),
  external_id text not null,
  external_url text,
  external_event_id text,
  fingerprint text not null,
  cache_key text not null default 'all',
  normalizer_version text not null,
  source_status text,
  atinara_category text check (
    atinara_category is null or atinara_category in (
      'Lanzamientos', 'Eventos', 'Industria', 'Streamers',
      'Reviews/Premios', 'YouTubers'
    )
  ),
  normalized_payload jsonb not null check (jsonb_typeof(normalized_payload) = 'object'),
  source_excerpt jsonb not null default '{}'::jsonb check (jsonb_typeof(source_excerpt) = 'object'),
  quality_status text not null check (quality_status in ('fit', 'needs_review', 'rejected')),
  quality_score numeric(5,2) not null check (quality_score between 0 and 100),
  score_breakdown jsonb not null default '{}'::jsonb check (jsonb_typeof(score_breakdown) = 'object'),
  warnings jsonb not null default '[]'::jsonb check (jsonb_typeof(warnings) = 'array'),
  duplicate_matches jsonb not null default '[]'::jsonb check (jsonb_typeof(duplicate_matches) = 'array'),
  fetched_at timestamptz not null,
  source_updated_at timestamptz,
  expires_at timestamptz not null,
  state text not null default 'available' check (
    state in ('available', 'needs_review', 'prepared', 'dismissed', 'rejected', 'expired')
  ),
  prepared_draft_id uuid references private.market_drafts(id) on delete set null,
  dismissed_at timestamptz,
  dismissed_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, external_id)
);

create index if not exists external_market_candidates_category_idx
  on private.external_market_candidates (atinara_category, state, quality_score desc);
create index if not exists external_market_candidates_expiry_idx
  on private.external_market_candidates (expires_at);
create index if not exists external_market_candidates_cache_idx
  on private.external_market_candidates (provider, cache_key, fetched_at desc);
create index if not exists external_market_candidates_fingerprint_idx
  on private.external_market_candidates (fingerprint);
create index if not exists external_market_candidates_prepared_draft_idx
  on private.external_market_candidates (prepared_draft_id)
  where prepared_draft_id is not null;
create index if not exists external_market_candidates_dismissed_by_idx
  on private.external_market_candidates (dismissed_by)
  where dismissed_by is not null;

create table if not exists private.market_radar_provider_runs (
  provider text not null check (provider in ('polymarket', 'kalshi', 'tavily', 'gemini', 'igdb')),
  cache_key text not null,
  status text not null check (status in ('available', 'cached', 'partial_error', 'unavailable', 'rate_limited')),
  result_count integer not null default 0 check (result_count >= 0),
  is_cached boolean not null default false,
  error_code text,
  error_message text,
  fetched_at timestamptz not null,
  expires_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (provider, cache_key)
);

alter table private.external_market_candidates enable row level security;
alter table private.market_radar_provider_runs enable row level security;

revoke all on table private.external_market_candidates from public, anon, authenticated;
revoke all on table private.market_radar_provider_runs from public, anon, authenticated;
grant all on table private.external_market_candidates to postgres;
grant all on table private.market_radar_provider_runs to postgres;
grant select, insert, update on table private.external_market_candidates to service_role;
grant select, insert, update on table private.market_radar_provider_runs to service_role;

alter table private.market_drafts
  add column if not exists radar_candidate_id uuid
    references private.external_market_candidates(id) on delete set null,
  add column if not exists source_provenance jsonb;

create index if not exists market_drafts_radar_candidate_idx
  on private.market_drafts (radar_candidate_id)
  where radar_candidate_id is not null;

create or replace function private.market_radar_safe_payload(candidate private.external_market_candidates)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
  select candidate.normalized_payload
    || jsonb_build_object(
      'id', candidate.id,
      'state', candidate.state,
      'prepared_draft_id', candidate.prepared_draft_id,
      'dismissed_at', candidate.dismissed_at,
      'expires_at', candidate.expires_at,
      'is_stale', candidate.expires_at <= now()
    );
$function$;

revoke all on function private.market_radar_safe_payload(private.external_market_candidates)
  from public, anon, authenticated;

create or replace function public.list_market_radar_candidates(
  provider_filter text default null,
  category_filter text default null,
  quality_filter text default null,
  query_filter text default null,
  order_key text default 'recommended',
  horizon_filter text default '180d',
  limit_count integer default 60,
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
  if provider_filter is not null and provider_filter <> ''
    and provider_filter not in ('polymarket', 'kalshi', 'tavily') then
    raise exception 'INVALID_RADAR_PROVIDER' using errcode = '22023';
  end if;
  if order_key not in ('recommended', 'popularity', 'closing', 'recent') then
    raise exception 'INVALID_RADAR_ORDER' using errcode = '22023';
  end if;
  if quality_filter is not null and quality_filter <> ''
    and quality_filter not in ('fit', 'review', 'all') then
    raise exception 'INVALID_RADAR_QUALITY' using errcode = '22023';
  end if;
  if horizon_filter not in ('30d', '90d', '180d', '365d') then
    raise exception 'INVALID_RADAR_HORIZON' using errcode = '22023';
  end if;

  select coalesce(jsonb_agg(private.market_radar_safe_payload(c)), '[]'::jsonb)
  into result
  from (
    select c.*
    from private.external_market_candidates c
    where c.state in ('available', 'needs_review', 'prepared')
      and c.quality_status <> 'rejected'
      and coalesce(
        nullif(c.normalized_payload ->> 'atinara_closes_at', '')::timestamptz,
        nullif(c.normalized_payload ->> 'source_close_at', '')::timestamptz
      ) <= now() + case horizon_filter
        when '30d' then interval '30 days'
        when '90d' then interval '90 days'
        when '365d' then interval '365 days'
        else interval '180 days'
      end
      and (provider_filter is null or provider_filter = '' or c.provider = provider_filter)
      and (category_filter is null or category_filter = '' or c.atinara_category = category_filter)
      and (
        quality_filter is null or quality_filter = '' or quality_filter = 'all'
        or (quality_filter = 'fit' and c.quality_status = 'fit')
        or (quality_filter = 'review' and c.quality_status in ('fit', 'needs_review'))
      )
      and (
        query_filter is null or query_filter = ''
        or c.normalized_payload ->> 'source_title' ilike '%' || query_filter || '%'
        or c.normalized_payload ->> 'source_question' ilike '%' || query_filter || '%'
        or c.normalized_payload ->> 'atinara_question_es' ilike '%' || query_filter || '%'
      )
    order by
      case when order_key = 'recommended' then c.quality_score end desc nulls last,
      case when order_key = 'popularity' then coalesce((c.normalized_payload ->> 'source_volume_total')::numeric, 0) end desc nulls last,
      case when order_key = 'closing' then (c.normalized_payload ->> 'source_close_at')::timestamptz end asc nulls last,
      case when order_key = 'recent' then coalesce(c.source_updated_at, c.fetched_at) end desc nulls last,
      c.quality_score desc,
      c.fetched_at desc
    limit least(greatest(coalesce(limit_count, 60), 1), 100)
    offset greatest(coalesce(offset_count, 0), 0)
  ) c;
  return result;
end;
$function$;

revoke all on function public.list_market_radar_candidates(text, text, text, text, text, text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.list_market_radar_candidates(text, text, text, text, text, text, integer, integer)
  to authenticated;

create or replace function public.get_market_radar_candidate(candidate_id_input uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  candidate private.external_market_candidates%rowtype;
begin
  perform private.require_current_admin();
  select * into candidate
  from private.external_market_candidates
  where id = candidate_id_input;
  if not found then
    raise exception 'RADAR_CANDIDATE_NOT_FOUND' using errcode = 'P0001';
  end if;
  return private.market_radar_safe_payload(candidate);
end;
$function$;

revoke all on function public.get_market_radar_candidate(uuid)
  from public, anon, authenticated;
grant execute on function public.get_market_radar_candidate(uuid) to authenticated;

create or replace function public.get_market_radar_provider_status()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  result jsonb;
begin
  perform private.require_current_admin();
  select coalesce(jsonb_agg(to_jsonb(r) order by r.provider, r.cache_key), '[]'::jsonb)
  into result
  from private.market_radar_provider_runs r;
  return result;
end;
$function$;

revoke all on function public.get_market_radar_provider_status()
  from public, anon, authenticated;
grant execute on function public.get_market_radar_provider_status() to authenticated;

create or replace function public.dismiss_market_radar_candidate(
  candidate_id_input uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor_id uuid := private.require_current_admin();
  candidate private.external_market_candidates%rowtype;
begin
  update private.external_market_candidates
  set state = 'dismissed', dismissed_at = now(), dismissed_by = actor_id, updated_at = now()
  where id = candidate_id_input and state in ('available', 'needs_review')
  returning * into candidate;
  if not found then
    raise exception 'RADAR_CANDIDATE_NOT_DISMISSIBLE' using errcode = 'P0001';
  end if;
  insert into private.market_admin_audit (actor_id, action_code, detail)
  values (actor_id, 'RADAR_CANDIDATE_DISMISSED', jsonb_build_object(
    'provider', candidate.provider,
    'external_id', candidate.external_id,
    'fingerprint', candidate.fingerprint
  ));
  return jsonb_build_object('ok', true, 'candidate_id', candidate.id, 'state', candidate.state);
end;
$function$;

revoke all on function public.dismiss_market_radar_candidate(uuid)
  from public, anon, authenticated;
grant execute on function public.dismiss_market_radar_candidate(uuid) to authenticated;

create or replace function public.upsert_market_radar_batch(
  provider_input text,
  cache_key_input text,
  normalizer_version_input text,
  candidates_input jsonb,
  provider_status_input jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  item jsonb;
  count_upserted integer := 0;
  safe_status text;
begin
  if provider_input not in ('polymarket', 'kalshi', 'tavily') then
    raise exception 'INVALID_RADAR_PROVIDER' using errcode = '22023';
  end if;
  if jsonb_typeof(candidates_input) <> 'array' or jsonb_array_length(candidates_input) > 120 then
    raise exception 'INVALID_RADAR_BATCH' using errcode = '22023';
  end if;
  if octet_length(candidates_input::text) > 1048576 then
    raise exception 'RADAR_BATCH_TOO_LARGE' using errcode = '22023';
  end if;

  for item in select value from jsonb_array_elements(candidates_input)
  loop
    if item ->> 'provider' <> provider_input
      or coalesce(item ->> 'external_id', '') = ''
      or coalesce(item ->> 'fingerprint', '') = '' then
      raise exception 'INVALID_RADAR_CANDIDATE' using errcode = '22023';
    end if;
    insert into private.external_market_candidates (
      provider, external_id, external_url, external_event_id, fingerprint,
      cache_key, normalizer_version, source_status, atinara_category,
      normalized_payload, source_excerpt, quality_status, quality_score,
      score_breakdown, warnings, duplicate_matches, fetched_at,
      source_updated_at, expires_at, state, updated_at
    ) values (
      provider_input,
      item ->> 'external_id', nullif(item ->> 'external_url', ''),
      nullif(item ->> 'external_event_id', ''), item ->> 'fingerprint',
      left(cache_key_input, 180), left(normalizer_version_input, 80),
      nullif(item ->> 'source_status', ''), nullif(item ->> 'atinara_category', ''),
      item, jsonb_build_object(
        'source_title', item ->> 'source_title',
        'source_question', item ->> 'source_question',
        'source_resolution_url', item ->> 'source_resolution_url',
        'source_probability_yes', item -> 'source_probability_yes',
        'source_volume_24h', item -> 'source_volume_24h',
        'source_volume_total', item -> 'source_volume_total',
        'source_liquidity', item -> 'source_liquidity',
        'source_open_interest', item -> 'source_open_interest'
      ),
      item ->> 'quality_status', coalesce((item ->> 'quality_score')::numeric, 0),
      coalesce(item -> 'score_breakdown', '{}'::jsonb),
      coalesce(item -> 'warnings', '[]'::jsonb),
      coalesce(item -> 'duplicate_matches', '[]'::jsonb),
      coalesce((item ->> 'fetched_at')::timestamptz, now()),
      nullif(item ->> 'source_updated_at', '')::timestamptz,
      coalesce((item ->> 'cache_expires_at')::timestamptz, now() + interval '20 minutes'),
      case when item ->> 'quality_status' = 'needs_review' then 'needs_review' else 'available' end,
      now()
    )
    on conflict (provider, external_id) do update set
      external_url = excluded.external_url,
      external_event_id = excluded.external_event_id,
      fingerprint = excluded.fingerprint,
      cache_key = excluded.cache_key,
      normalizer_version = excluded.normalizer_version,
      source_status = excluded.source_status,
      atinara_category = excluded.atinara_category,
      normalized_payload = excluded.normalized_payload,
      source_excerpt = excluded.source_excerpt,
      quality_status = excluded.quality_status,
      quality_score = excluded.quality_score,
      score_breakdown = excluded.score_breakdown,
      warnings = excluded.warnings,
      duplicate_matches = excluded.duplicate_matches,
      fetched_at = excluded.fetched_at,
      source_updated_at = excluded.source_updated_at,
      expires_at = excluded.expires_at,
      state = case
        when private.external_market_candidates.state in ('prepared', 'dismissed')
          then private.external_market_candidates.state
        when excluded.quality_status = 'needs_review' then 'needs_review'
        else 'available'
      end,
      updated_at = now();
    count_upserted := count_upserted + 1;
  end loop;

  safe_status := coalesce(provider_status_input ->> 'status', 'available');
  if safe_status not in ('available', 'cached', 'partial_error', 'unavailable', 'rate_limited') then
    safe_status := 'partial_error';
  end if;
  insert into private.market_radar_provider_runs (
    provider, cache_key, status, result_count, is_cached, error_code,
    error_message, fetched_at, expires_at, updated_at
  ) values (
    provider_input, left(cache_key_input, 180), safe_status,
    count_upserted, coalesce((provider_status_input ->> 'is_cached')::boolean, false),
    nullif(left(provider_status_input ->> 'error_code', 80), ''),
    nullif(left(provider_status_input ->> 'error_message', 300), ''),
    now(), now() + interval '20 minutes', now()
  )
  on conflict (provider, cache_key) do update set
    status = excluded.status,
    result_count = excluded.result_count,
    is_cached = excluded.is_cached,
    error_code = excluded.error_code,
    error_message = excluded.error_message,
    fetched_at = excluded.fetched_at,
    expires_at = excluded.expires_at,
    updated_at = excluded.updated_at;

  return jsonb_build_object('ok', true, 'upserted', count_upserted);
end;
$function$;

revoke all on function public.upsert_market_radar_batch(text, text, text, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.upsert_market_radar_batch(text, text, text, jsonb, jsonb)
  to service_role;

create or replace function public.record_market_radar_provider_failure(
  provider_input text,
  cache_key_input text,
  status_input text,
  error_code_input text,
  error_message_input text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if provider_input not in ('polymarket', 'kalshi', 'tavily', 'gemini', 'igdb') then
    raise exception 'INVALID_RADAR_PROVIDER' using errcode = '22023';
  end if;
  insert into private.market_radar_provider_runs (
    provider, cache_key, status, result_count, is_cached, error_code,
    error_message, fetched_at, expires_at, updated_at
  ) values (
    provider_input, left(cache_key_input, 180),
    case when status_input in ('partial_error', 'unavailable', 'rate_limited')
      then status_input else 'unavailable' end,
    0, false, nullif(left(error_code_input, 80), ''),
    nullif(left(error_message_input, 300), ''), now(), now() + interval '5 minutes', now()
  )
  on conflict (provider, cache_key) do update set
    status = excluded.status, result_count = 0, is_cached = false,
    error_code = excluded.error_code, error_message = excluded.error_message,
    fetched_at = excluded.fetched_at, expires_at = excluded.expires_at,
    updated_at = excluded.updated_at;
  return jsonb_build_object('ok', true);
end;
$function$;

revoke all on function public.record_market_radar_provider_failure(text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.record_market_radar_provider_failure(text, text, text, text, text)
  to service_role;

create or replace function public.record_market_radar_provider_success(
  provider_input text,
  cache_key_input text,
  result_count_input integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if provider_input not in ('gemini', 'igdb') then
    raise exception 'INVALID_RADAR_PROCESSOR' using errcode = '22023';
  end if;
  insert into private.market_radar_provider_runs (
    provider, cache_key, status, result_count, is_cached,
    fetched_at, expires_at, updated_at
  ) values (
    provider_input, left(cache_key_input, 180), 'available',
    least(greatest(coalesce(result_count_input, 0), 0), 120), false,
    now(), now() + interval '20 minutes', now()
  )
  on conflict (provider, cache_key) do update set
    status = excluded.status, result_count = excluded.result_count,
    is_cached = false, error_code = null, error_message = null,
    fetched_at = excluded.fetched_at, expires_at = excluded.expires_at,
    updated_at = excluded.updated_at;
  return jsonb_build_object('ok', true);
end;
$function$;

revoke all on function public.record_market_radar_provider_success(text, text, integer)
  from public, anon, authenticated;
grant execute on function public.record_market_radar_provider_success(text, text, integer)
  to service_role;

create or replace function public.save_market_draft_from_radar(
  candidate_id_input uuid,
  draft_id_input uuid,
  expected_version_input bigint,
  draft_input jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor_id uuid := private.require_current_admin();
  candidate private.external_market_candidates%rowtype;
  save_result jsonb;
  saved_draft_id uuid;
  provenance jsonb;
begin
  select * into candidate
  from private.external_market_candidates
  where id = candidate_id_input
  for update;
  if not found or candidate.state not in ('available', 'needs_review') then
    raise exception 'RADAR_CANDIDATE_NOT_PREPARABLE' using errcode = 'P0001';
  end if;
  if exists (
    select 1 from jsonb_array_elements(candidate.duplicate_matches) match
    where match ->> 'status' = 'confirmed'
  ) then
    raise exception 'RADAR_CONFIRMED_DUPLICATE' using errcode = '23505';
  end if;

  save_result := public.save_market_draft(
    draft_id_input, expected_version_input, draft_input
  );
  saved_draft_id := (save_result -> 'draft' ->> 'id')::uuid;
  provenance := jsonb_build_object(
    'provider', candidate.provider,
    'external_id', candidate.external_id,
    'external_url', candidate.external_url,
    'source_title', candidate.normalized_payload ->> 'source_title',
    'fetched_at', candidate.fetched_at,
    'source_updated_at', candidate.source_updated_at,
    'metrics', candidate.source_excerpt - 'source_title' - 'source_question' - 'source_resolution_url',
    'fingerprint', candidate.fingerprint,
    'normalizer_version', candidate.normalizer_version,
    'warnings', candidate.warnings,
    'quality_score', candidate.quality_score,
    'score_breakdown', candidate.score_breakdown,
    'prepared_at', now()
  );

  update private.market_drafts
  set radar_candidate_id = candidate.id, source_provenance = provenance
  where id = saved_draft_id;
  update private.external_market_candidates
  set state = 'prepared', prepared_draft_id = saved_draft_id, updated_at = now()
  where id = candidate.id;
  insert into private.market_admin_audit (
    actor_id, action_code, draft_id, draft_version, detail
  ) values (
    actor_id, 'RADAR_DRAFT_PREPARED', saved_draft_id,
    (save_result -> 'draft' ->> 'content_version')::bigint,
    jsonb_build_object(
      'provider', candidate.provider,
      'external_id', candidate.external_id,
      'fingerprint', candidate.fingerprint
    )
  );
  return save_result || jsonb_build_object('radar_origin', provenance);
end;
$function$;

revoke all on function public.save_market_draft_from_radar(uuid, uuid, bigint, jsonb)
  from public, anon, authenticated;
grant execute on function public.save_market_draft_from_radar(uuid, uuid, bigint, jsonb)
  to authenticated;

comment on table private.external_market_candidates is
  'Candidatos privados y normalizados del Radar. No contiene cuentas, traders, wallets ni órdenes externas.';
comment on column private.market_drafts.source_provenance is
  'Procedencia privada mínima de un borrador preparado desde el Radar; nunca se expone en RPC públicas.';
