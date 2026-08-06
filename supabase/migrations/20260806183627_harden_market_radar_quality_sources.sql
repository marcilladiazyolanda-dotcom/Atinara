-- Paso 13.5.1: calidad factual, agrupación por evento y URLs canónicas del Radar.
-- Esta migración es posterior a 20260804194933_add_market_radar.sql y no la sustituye.

alter table private.external_market_candidates
  add column if not exists verification_status text not null default 'pending',
  add column if not exists verification_reason_code text,
  add column if not exists verification_reason text,
  add column if not exists verified_at timestamptz,
  add column if not exists verification_expires_at timestamptz,
  add column if not exists verification_evidence jsonb not null default '[]'::jsonb,
  add column if not exists event_group_key text,
  add column if not exists external_event_url text,
  add column if not exists external_market_url text,
  add column if not exists external_event_slug text,
  add column if not exists external_market_slug text;

do $block$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'private.external_market_candidates'::regclass
      and conname = 'external_market_candidates_verification_status_check'
  ) then
    alter table private.external_market_candidates
      add constraint external_market_candidates_verification_status_check
      check (verification_status in (
        'pending', 'verified_open', 'needs_review', 'rejected_resolved',
        'rejected_stale', 'rejected_ineligible', 'rejected_unannounced',
        'rejected_incoherent', 'rejected_invalid_source', 'rejected_duplicate'
      ));
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'private.external_market_candidates'::regclass
      and conname = 'external_market_candidates_evidence_array_check'
  ) then
    alter table private.external_market_candidates
      add constraint external_market_candidates_evidence_array_check
      check (jsonb_typeof(verification_evidence) = 'array');
  end if;
end;
$block$;

create index if not exists external_market_candidates_group_idx
  on private.external_market_candidates (event_group_key, verification_status, quality_score desc);
create index if not exists external_market_candidates_verification_expiry_idx
  on private.external_market_candidates (verification_expires_at)
  where state not in ('prepared', 'dismissed');
create index if not exists external_market_candidates_rejected_audit_idx
  on private.external_market_candidates (verification_status, verified_at desc)
  where verification_status like 'rejected_%';

-- Las candidatas v1 que nunca se prepararon dejan de estar disponibles. Se conservan
-- los estados prepared/dismissed y todos sus vínculos históricos.
update private.external_market_candidates
set state = 'expired',
    quality_status = 'rejected',
    verification_status = 'rejected_stale',
    verification_reason_code = 'SOURCE_STALE',
    verification_reason = 'Candidata invalidada al activar el normalizador factual v2.',
    verification_expires_at = now(),
    updated_at = now()
where normalizer_version <> 'atinara-radar-v2'
  and state not in ('prepared', 'dismissed');

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
      'is_stale', candidate.expires_at <= now(),
      'normalizer_version', candidate.normalizer_version,
      'verification_status', candidate.verification_status,
      'verification_reason_code', candidate.verification_reason_code,
      'verification_reason', candidate.verification_reason,
      'verified_at', candidate.verified_at,
      'verification_expires_at', candidate.verification_expires_at,
      'verification_evidence', candidate.verification_evidence,
      'event_group_key', candidate.event_group_key,
      'external_event_url', candidate.external_event_url,
      'external_market_url', candidate.external_market_url,
      'external_event_slug', candidate.external_event_slug,
      'external_market_slug', candidate.external_market_slug,
      'quality_status', candidate.quality_status,
      'quality_score', candidate.quality_score,
      'score_breakdown', candidate.score_breakdown,
      'warnings', candidate.warnings,
      'duplicate_matches', candidate.duplicate_matches
    );
$function$;

revoke all on function private.market_radar_safe_payload(private.external_market_candidates)
  from public, anon, authenticated;

create or replace function public.list_market_radar_candidates_v2(
  provider_filter text default null,
  category_filter text default null,
  quality_filter text default null,
  query_filter text default null,
  order_key text default 'recommended',
  horizon_filter text default '180d',
  limit_count integer default 240,
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
    and quality_filter not in ('fit', 'review', 'rejected', 'all') then
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
    where c.normalizer_version = 'atinara-radar-v2'
      and c.expires_at > now()
      and c.state in ('available', 'needs_review', 'prepared')
      and c.verification_status in ('verified_open', 'needs_review')
      and c.quality_status <> 'rejected'
      and (
        coalesce(
          nullif(c.normalized_payload ->> 'source_close_at', '')::timestamptz,
          nullif(c.normalized_payload ->> 'atinara_closes_at', '')::timestamptz
        ) is null
        or coalesce(
          nullif(c.normalized_payload ->> 'source_close_at', '')::timestamptz,
          nullif(c.normalized_payload ->> 'atinara_closes_at', '')::timestamptz
        ) <= now() + case horizon_filter
          when '30d' then interval '30 days'
          when '90d' then interval '90 days'
          when '365d' then interval '365 days'
          else interval '180 days'
        end
      )
      and (provider_filter is null or provider_filter = '' or c.provider = provider_filter)
      and (category_filter is null or category_filter = '' or c.atinara_category = category_filter)
      and (
        quality_filter is null or quality_filter = '' or quality_filter = 'all'
        or (quality_filter = 'fit' and c.verification_status = 'verified_open')
        or (quality_filter = 'review' and c.verification_status in ('verified_open', 'needs_review'))
      )
      and (
        query_filter is null or query_filter = ''
        or c.normalized_payload ->> 'source_title' ilike '%' || query_filter || '%'
        or c.normalized_payload ->> 'source_question' ilike '%' || query_filter || '%'
        or c.normalized_payload ->> 'atinara_question' ilike '%' || query_filter || '%'
      )
    order by
      case when order_key = 'recommended' then c.quality_score end desc nulls last,
      case when order_key = 'popularity' then coalesce((c.normalized_payload ->> 'source_volume_total')::numeric, 0) end desc nulls last,
      case when order_key = 'closing' then nullif(c.normalized_payload ->> 'source_close_at', '')::timestamptz end asc nulls last,
      case when order_key = 'recent' then coalesce(c.source_updated_at, c.fetched_at) end desc nulls last,
      c.quality_score desc,
      c.fetched_at desc
    limit least(greatest(coalesce(limit_count, 240), 1), 500)
    offset greatest(coalesce(offset_count, 0), 0)
  ) c;
  return result;
end;
$function$;

revoke all on function public.list_market_radar_candidates_v2(text, text, text, text, text, text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.list_market_radar_candidates_v2(text, text, text, text, text, text, integer, integer)
  to authenticated;

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
  select coalesce(jsonb_agg(private.market_radar_safe_payload(c)), '[]'::jsonb)
  into result
  from (
    select c.*
    from private.external_market_candidates c
    where c.normalizer_version = 'atinara-radar-v2'
      and c.verification_status like 'rejected_%'
      and (provider_filter is null or provider_filter = '' or c.provider = provider_filter)
      and (category_filter is null or category_filter = '' or c.atinara_category = category_filter)
    order by c.verified_at desc nulls last, c.updated_at desc
    limit least(greatest(coalesce(limit_count, 100), 1), 250)
    offset greatest(coalesce(offset_count, 0), 0)
  ) c;
  return result;
end;
$function$;

revoke all on function public.list_market_radar_rejections(text, text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.list_market_radar_rejections(text, text, integer, integer)
  to authenticated;

create or replace function public.upsert_market_radar_batch_v2(
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
  verification text;
  mapped_quality text;
  mapped_state text;
  safe_status text;
begin
  if provider_input not in ('polymarket', 'kalshi', 'tavily')
    or normalizer_version_input <> 'atinara-radar-v2' then
    raise exception 'INVALID_RADAR_PROVIDER_OR_VERSION' using errcode = '22023';
  end if;
  if jsonb_typeof(candidates_input) <> 'array' or jsonb_array_length(candidates_input) > 240 then
    raise exception 'INVALID_RADAR_BATCH' using errcode = '22023';
  end if;
  if octet_length(candidates_input::text) > 3145728 then
    raise exception 'RADAR_BATCH_TOO_LARGE' using errcode = '22023';
  end if;

  for item in select value from jsonb_array_elements(candidates_input)
  loop
    verification := item ->> 'verification_status';
    if item ->> 'provider' <> provider_input
      or coalesce(item ->> 'external_id', '') = ''
      or coalesce(item ->> 'fingerprint', '') = ''
      or coalesce(item ->> 'event_group_key', '') = ''
      or verification not in (
        'pending', 'verified_open', 'needs_review', 'rejected_resolved',
        'rejected_stale', 'rejected_ineligible', 'rejected_unannounced',
        'rejected_incoherent', 'rejected_invalid_source', 'rejected_duplicate'
      ) then
      raise exception 'INVALID_RADAR_CANDIDATE' using errcode = '22023';
    end if;
    if verification = 'verified_open' and (
      nullif(item ->> 'verified_at', '') is null
      or nullif(item ->> 'verification_expires_at', '') is null
      or nullif(item ->> 'external_event_url', '') is null
      or nullif(item ->> 'external_market_url', '') is null
    ) then
      raise exception 'INCOMPLETE_RADAR_VERIFICATION' using errcode = '22023';
    end if;
    mapped_quality := case
      when verification = 'verified_open' then 'fit'
      when verification = 'needs_review' or verification = 'pending' then 'needs_review'
      else 'rejected'
    end;
    mapped_state := case
      when verification = 'verified_open' then 'available'
      when verification = 'needs_review' or verification = 'pending' then 'needs_review'
      else 'rejected'
    end;

    insert into private.external_market_candidates (
      provider, external_id, external_url, external_event_id, fingerprint,
      cache_key, normalizer_version, source_status, atinara_category,
      normalized_payload, source_excerpt, quality_status, quality_score,
      score_breakdown, warnings, duplicate_matches, fetched_at,
      source_updated_at, expires_at, state, verification_status,
      verification_reason_code, verification_reason, verified_at,
      verification_expires_at, verification_evidence, event_group_key,
      external_event_url, external_market_url, external_event_slug,
      external_market_slug, updated_at
    ) values (
      provider_input,
      item ->> 'external_id', nullif(item ->> 'external_url', ''),
      nullif(item ->> 'external_event_id', ''), item ->> 'fingerprint',
      left(cache_key_input, 180), normalizer_version_input,
      nullif(item ->> 'source_status', ''), nullif(item ->> 'atinara_category', ''),
      item,
      jsonb_build_object(
        'source_title', item ->> 'source_title',
        'source_question', item ->> 'source_question',
        'source_resolution_url', item ->> 'source_resolution_url',
        'source_probability_yes', item -> 'source_probability_yes',
        'source_volume_total', item -> 'source_volume_total',
        'source_liquidity', item -> 'source_liquidity'
      ),
      mapped_quality,
      least(greatest(coalesce((item ->> 'quality_score')::numeric, 0), 0), 100),
      coalesce(item -> 'score_breakdown', '{}'::jsonb),
      coalesce(item -> 'warnings', '[]'::jsonb),
      coalesce(item -> 'duplicate_matches', '[]'::jsonb),
      coalesce(nullif(item ->> 'fetched_at', '')::timestamptz, now()),
      nullif(item ->> 'source_updated_at', '')::timestamptz,
      coalesce(nullif(item ->> 'cache_expires_at', '')::timestamptz, now() + interval '20 minutes'),
      mapped_state, verification,
      nullif(left(item ->> 'verification_reason_code', 100), ''),
      nullif(left(item ->> 'verification_reason', 1000), ''),
      nullif(item ->> 'verified_at', '')::timestamptz,
      nullif(item ->> 'verification_expires_at', '')::timestamptz,
      coalesce(item -> 'verification_evidence', '[]'::jsonb),
      left(item ->> 'event_group_key', 240),
      nullif(item ->> 'external_event_url', ''),
      nullif(item ->> 'external_market_url', ''),
      nullif(item ->> 'external_event_slug', ''),
      nullif(item ->> 'external_market_slug', ''),
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
      verification_status = excluded.verification_status,
      verification_reason_code = excluded.verification_reason_code,
      verification_reason = excluded.verification_reason,
      verified_at = excluded.verified_at,
      verification_expires_at = excluded.verification_expires_at,
      verification_evidence = excluded.verification_evidence,
      event_group_key = excluded.event_group_key,
      external_event_url = excluded.external_event_url,
      external_market_url = excluded.external_market_url,
      external_event_slug = excluded.external_event_slug,
      external_market_slug = excluded.external_market_slug,
      state = case
        when private.external_market_candidates.state in ('prepared', 'dismissed')
          then private.external_market_candidates.state
        else excluded.state
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

revoke all on function public.upsert_market_radar_batch_v2(text, text, text, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.upsert_market_radar_batch_v2(text, text, text, jsonb, jsonb)
  to service_role;

create or replace function public.reserve_market_radar_candidate_for_prepare(
  candidate_id_input uuid,
  normalizer_version_input text,
  verification_checked_at_input timestamptz
)
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
  where id = candidate_id_input
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'CANDIDATE_NOT_FOUND', 'message', 'No se encontró la candidata.');
  end if;
  if normalizer_version_input <> 'atinara-radar-v2'
    or candidate.normalizer_version <> normalizer_version_input then
    return jsonb_build_object('ok', false, 'error', 'NORMALIZER_OUTDATED', 'message', 'La candidata utiliza un normalizador anterior.');
  end if;
  if candidate.state <> 'available' or candidate.verification_status <> 'verified_open' then
    return jsonb_build_object('ok', false, 'error', 'VERIFICATION_REQUIRED', 'message', 'La candidata no tiene una verificación aprobada.');
  end if;
  if candidate.expires_at <= verification_checked_at_input
    or candidate.verification_expires_at is null
    or candidate.verification_expires_at <= verification_checked_at_input then
    return jsonb_build_object('ok', false, 'error', 'VERIFICATION_EXPIRED', 'message', 'La verificación factual ha caducado.');
  end if;
  if jsonb_array_length(candidate.duplicate_matches) > 0 then
    return jsonb_build_object('ok', false, 'error', 'CONFIRMED_DUPLICATE', 'message', 'Existe una coincidencia con un mercado o borrador.');
  end if;
  return jsonb_build_object('ok', true, 'candidate_id', candidate.id);
end;
$function$;

revoke all on function public.reserve_market_radar_candidate_for_prepare(uuid, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.reserve_market_radar_candidate_for_prepare(uuid, text, timestamptz)
  to authenticated;

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
  if not found or candidate.state <> 'available'
    or candidate.normalizer_version <> 'atinara-radar-v2'
    or candidate.verification_status <> 'verified_open'
    or candidate.expires_at <= now()
    or candidate.verification_expires_at is null
    or candidate.verification_expires_at <= now() then
    raise exception 'RADAR_CANDIDATE_NOT_PREPARABLE' using errcode = 'P0001';
  end if;
  if jsonb_array_length(candidate.duplicate_matches) > 0 then
    raise exception 'RADAR_CONFIRMED_DUPLICATE' using errcode = '23505';
  end if;

  save_result := public.save_market_draft(draft_id_input, expected_version_input, draft_input);
  saved_draft_id := (save_result -> 'draft' ->> 'id')::uuid;
  provenance := jsonb_build_object(
    'provider', candidate.provider,
    'external_id', candidate.external_id,
    'external_event_id', candidate.external_event_id,
    'external_event_url', candidate.external_event_url,
    'external_market_url', candidate.external_market_url,
    'source_title', candidate.normalized_payload ->> 'source_title',
    'source_resolution_url', candidate.normalized_payload ->> 'source_resolution_url',
    'fetched_at', candidate.fetched_at,
    'fingerprint', candidate.fingerprint,
    'normalizer_version', candidate.normalizer_version,
    'verification_status', candidate.verification_status,
    'verification_reason_code', candidate.verification_reason_code,
    'verified_at', candidate.verified_at,
    'verification_evidence', candidate.verification_evidence,
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
      'event_group_key', candidate.event_group_key,
      'verification_status', candidate.verification_status
    )
  );
  return save_result || jsonb_build_object('radar_origin', provenance);
end;
$function$;

revoke all on function public.save_market_draft_from_radar(uuid, uuid, bigint, jsonb)
  from public, anon, authenticated;
grant execute on function public.save_market_draft_from_radar(uuid, uuid, bigint, jsonb)
  to authenticated;

comment on column private.external_market_candidates.verification_status is
  'Estado factual cerrado del Radar v2. Los estados rejected_* nunca permiten preparar un borrador.';
comment on column private.external_market_candidates.external_event_url is
  'URL pública canónica y comprobada del evento padre. No se deriva del slug del mercado hijo.';
comment on column private.external_market_candidates.external_market_url is
  'URL pública comprobada de la opción externa; puede coincidir con el evento cuando el proveedor usa una sola página.';
