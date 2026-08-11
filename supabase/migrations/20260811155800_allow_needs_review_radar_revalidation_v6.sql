-- Atinara Radar v6: alinea la revalidacion factual de candidatas needs_review.
-- No publica, prepara ni modifica mercados, borradores o economia.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';

create or replace function public.apply_market_radar_revalidation_fact_v1(
  candidate_id_input uuid,
  expected_preparation_revision_input bigint,
  normalizer_version_input text,
  verification_checked_at_input timestamptz,
  verification_input jsonb,
  fact_check_input jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  candidate private.external_market_candidates%rowtype;
  fact_row private.market_radar_fact_checks%rowtype;
  checked_at_value timestamptz := greatest(clock_timestamp(), coalesce(verification_checked_at_input, clock_timestamp()));
  verification_expiry timestamptz;
  cache_expiry timestamptz;
  verification_status_value text;
  final_verification_status text;
  mapped_state text;
  mapped_quality text;
  expected_revision bigint;
  fact_id_value bigint;
  readiness_error text;
begin
  if auth.role() <> 'service_role' then
    raise exception 'SERVICE_ROLE_REQUIRED' using errcode = '42501';
  end if;
  select * into candidate
  from private.external_market_candidates candidate_alias
  where candidate_alias.id = candidate_id_input
  for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'CANDIDATE_NOT_FOUND'); end if;
  if expected_preparation_revision_input is null
     or candidate.preparation_revision <> expected_preparation_revision_input then
    return jsonb_build_object(
      'ok', false, 'error', 'PREPARATION_REVISION_MISMATCH',
      'preparation_revision', candidate.preparation_revision,
      'candidate', private.market_radar_safe_payload(candidate)
    );
  end if;
  if normalizer_version_input <> 'atinara-radar-v2'
     or candidate.normalizer_version <> normalizer_version_input then
    return jsonb_build_object('ok', false, 'error', 'NORMALIZER_OUTDATED');
  end if;
  if candidate.state not in ('available', 'needs_review', 'prepared') then
    return jsonb_build_object('ok', false, 'error', 'CANDIDATE_NOT_REVALIDATABLE');
  end if;
  if jsonb_typeof(verification_input) <> 'object'
     or jsonb_typeof(fact_check_input) <> 'object'
     or coalesce(verification_input ->> 'eligibility_policy_version', '')
       <> 'atinara-prediction-policy-v4'
     or coalesce(verification_input ->> 'fact_policy_version', '')
       <> 'atinara-terminal-fact-gate-v2' then
    return jsonb_build_object('ok', false, 'error', 'INVALID_VERIFICATION_PAYLOAD');
  end if;
  verification_status_value := coalesce(verification_input ->> 'verification_status', '');
  if verification_status_value not in (
    'pending', 'verified_open', 'needs_review', 'rejected_resolved',
    'rejected_stale', 'rejected_ineligible', 'rejected_unannounced',
    'rejected_incoherent', 'rejected_invalid_source', 'rejected_duplicate'
  ) then return jsonb_build_object('ok', false, 'error', 'INVALID_VERIFICATION_STATUS'); end if;
  if jsonb_typeof(coalesce(verification_input -> 'verification_evidence', '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(verification_input -> 'warnings', '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(verification_input -> 'duplicate_matches', '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(verification_input -> 'score_breakdown', '{}'::jsonb)) <> 'object' then
    return jsonb_build_object('ok', false, 'error', 'INVALID_VERIFICATION_PAYLOAD');
  end if;
  begin
    verification_expiry := nullif(verification_input ->> 'verification_expires_at', '')::timestamptz;
    cache_expiry := coalesce(
      nullif(verification_input ->> 'cache_expires_at', '')::timestamptz,
      nullif(verification_input ->> 'expires_at', '')::timestamptz
    );
  exception when invalid_datetime_format then
    return jsonb_build_object('ok', false, 'error', 'INVALID_VERIFICATION_DATE');
  end;
  if verification_status_value = 'verified_open' and (
     verification_expiry is null or verification_expiry <= checked_at_value
     or cache_expiry is null or cache_expiry <= checked_at_value
     or coalesce(verification_input ->> 'atinara_question', '') = ''
     or coalesce(verification_input ->> 'atinara_resolution_criteria', '') = ''
     or coalesce(verification_input ->> 'atinara_resolution_source_url', '') !~ '^https://'
  ) then return jsonb_build_object('ok', false, 'error', 'VERIFICATION_REQUIRED'); end if;

  cache_expiry := coalesce(cache_expiry, checked_at_value + interval '10 minutes');
  expected_revision := candidate.preparation_revision + 1;
  begin
    fact_id_value := private.insert_market_radar_fact_check_v2(
      candidate.id, expected_revision, 'revalidate', fact_check_input
    );
  exception when others then
    return jsonb_build_object('ok', false, 'error', sqlerrm, 'persisted', false);
  end;
  select * into fact_row
  from private.market_radar_fact_checks fact_alias
  where fact_alias.id = fact_id_value;

  final_verification_status := verification_status_value;
  if fact_row.fact_status = 'fully_resolved' then
    final_verification_status := 'rejected_resolved';
  elsif fact_row.fact_status in ('partially_resolved', 'conflicting', 'unknown') then
    final_verification_status := 'needs_review';
  end if;
  mapped_state := case
    when candidate.state = 'prepared' then 'prepared'
    when final_verification_status = 'verified_open' then 'available'
    when final_verification_status in ('pending', 'needs_review') then 'needs_review'
    else 'rejected'
  end;
  mapped_quality := case
    when final_verification_status = 'verified_open' then 'fit'
    when final_verification_status in ('pending', 'needs_review') then 'needs_review'
    else 'rejected'
  end;

  update private.external_market_candidates candidate_alias set
    fingerprint = coalesce(nullif(verification_input ->> 'fingerprint', ''), candidate_alias.fingerprint),
    normalizer_version = normalizer_version_input,
    source_status = nullif(verification_input ->> 'source_status', ''),
    atinara_category = nullif(verification_input ->> 'atinara_category', ''),
    normalized_payload = (verification_input - 'id' - 'preparation_revision') || jsonb_build_object(
      'current_fact_check_id', fact_id_value,
      'fact_status', fact_row.fact_status,
      'fact_policy_version', fact_row.fact_policy_version,
      'fact_context_fingerprint', fact_row.context_sha256,
      'fact_checked_at', fact_row.checked_at,
      'fact_check_expires_at', fact_row.expires_at,
      'fact_check_purpose', fact_row.purpose,
      'verification_status', final_verification_status,
      'state', mapped_state
    ),
    quality_status = mapped_quality,
    quality_score = least(greatest(
      coalesce((verification_input ->> 'quality_score')::numeric, candidate_alias.quality_score), 0
    ), 100),
    score_breakdown = coalesce(verification_input -> 'score_breakdown', candidate_alias.score_breakdown),
    warnings = coalesce(verification_input -> 'warnings', '[]'::jsonb),
    duplicate_matches = coalesce(verification_input -> 'duplicate_matches', '[]'::jsonb),
    fetched_at = checked_at_value,
    source_updated_at = nullif(verification_input ->> 'source_updated_at', '')::timestamptz,
    expires_at = cache_expiry,
    state = mapped_state,
    verification_status = final_verification_status,
    verification_reason_code = case
      when fact_row.fact_status = 'fully_resolved' then 'EVENT_ALREADY_RESOLVED'
      when fact_row.fact_status in ('partially_resolved', 'conflicting', 'unknown') then 'VERIFICATION_REQUIRED'
      else nullif(left(verification_input ->> 'verification_reason_code', 100), '')
    end,
    verification_reason = nullif(left(verification_input ->> 'verification_reason', 1000), ''),
    verified_at = coalesce(nullif(verification_input ->> 'verified_at', '')::timestamptz, checked_at_value),
    verification_expires_at = case
      when final_verification_status = 'verified_open' then verification_expiry else null
    end,
    verification_evidence = fact_row.source_snapshot,
    event_group_key = coalesce(
      nullif(left(verification_input ->> 'event_group_key', 240), ''), candidate_alias.event_group_key
    ),
    external_event_url = coalesce(
      nullif(verification_input ->> 'external_event_url', ''), candidate_alias.external_event_url
    ),
    external_market_url = coalesce(
      nullif(verification_input ->> 'external_market_url', ''), candidate_alias.external_market_url
    ),
    external_event_slug = coalesce(
      nullif(verification_input ->> 'external_event_slug', ''), candidate_alias.external_event_slug
    ),
    external_market_slug = coalesce(
      nullif(verification_input ->> 'external_market_slug', ''), candidate_alias.external_market_slug
    ),
    current_fact_check_id = fact_id_value,
    fact_status = fact_row.fact_status,
    fact_policy_version = fact_row.fact_policy_version,
    fact_context_fingerprint = fact_row.context_sha256,
    fact_checked_at = fact_row.checked_at,
    fact_check_expires_at = fact_row.expires_at,
    fact_check_purpose = fact_row.purpose,
    updated_at = now()
  where candidate_alias.id = candidate.id;

  select * into candidate
  from private.external_market_candidates candidate_alias
  where candidate_alias.id = candidate.id
  for update;
  if candidate.preparation_revision <> expected_revision
     or candidate.current_fact_check_id <> fact_id_value
     or candidate.fact_check_purpose <> 'revalidate' then
    raise exception 'RADAR_FACT_LINK_REVISION_MISMATCH' using errcode = '40001';
  end if;

  if candidate.verification_status <> 'verified_open'
     or candidate.fact_status <> 'unresolved' then
    readiness_error := case candidate.verification_status
      when 'rejected_resolved' then 'RADAR_CANDIDATE_RESOLVED'
      when 'rejected_unannounced' then 'RADAR_CANDIDATE_UNANNOUNCED'
      when 'rejected_invalid_source' then 'RADAR_CANONICAL_URL_INVALID'
      when 'rejected_duplicate' then 'RADAR_CONFIRMED_DUPLICATE'
      when 'rejected_stale' then 'VERIFICATION_EXPIRED'
      else 'RADAR_REVALIDATION_REQUIRED'
    end;
    return jsonb_build_object(
      'ok', false, 'error', readiness_error,
      'candidate_id', candidate.id,
      'preparation_revision', candidate.preparation_revision,
      'fact_check_id', fact_id_value,
      'candidate', private.market_radar_safe_payload(candidate),
      'persisted', true, 'atomic', true, 'revalidated', true
    );
  end if;
  return jsonb_build_object(
    'ok', true,
    'candidate_id', candidate.id,
    'preparation_revision', candidate.preparation_revision,
    'fact_check_id', fact_id_value,
    'candidate', private.market_radar_safe_payload(candidate),
    'persisted', true, 'atomic', true, 'revalidated', true
  );
exception
  when invalid_text_representation or numeric_value_out_of_range or invalid_datetime_format then
    return jsonb_build_object('ok', false, 'error', 'INVALID_VERIFICATION_PAYLOAD');
end;
$function$;

revoke all on function public.apply_market_radar_revalidation_fact_v1(
  uuid,bigint,text,timestamptz,jsonb,jsonb
) from public, anon, authenticated, service_role;
grant execute on function public.apply_market_radar_revalidation_fact_v1(
  uuid,bigint,text,timestamptz,jsonb,jsonb
) to service_role;


comment on function public.apply_market_radar_revalidation_fact_v1(
  uuid,bigint,text,timestamptz,jsonb,jsonb
) is
  'Revalida de forma atomica candidatas available, needs_review o prepared; conserva version, snapshot factual y bloqueos terminales.';

commit;
