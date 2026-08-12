begin;

do $test$
begin
  if exists (
    select 1
    from private.external_market_candidates candidate
    where candidate.eligibility_reason_code in (
      'RESOLUTION_SOURCE_AUTHORITY_PENDING',
      'OFFICIAL_TERMINAL_SCAN_UNAVAILABLE',
      'OFFICIAL_SELECTION_RECHECK_REQUIRED',
      'VERIFICATION_REQUIRED',
      'VERIFICATION_EXPIRED'
    )
      and candidate.eligibility_status <> 'technical_hold'
  ) then
    raise exception 'RADAR_RETRYABLE_REASON_IS_NOT_TECHNICAL_HOLD';
  end if;
  if not exists (
    select 1
    from pg_constraint
    where conname = 'market_radar_retryable_status_consistency_v10'
      and convalidated
  ) then
    raise exception 'RADAR_CANDIDATE_RETRYABLE_CONSTRAINT_MISSING';
  end if;
  if not exists (
    select 1
    from pg_constraint
    where conname = 'market_radar_check_retryable_status_consistency_v10'
      and not convalidated
  ) then
    raise exception 'RADAR_APPEND_ONLY_RETRYABLE_CONSTRAINT_MISSING';
  end if;
end;
$test$;

select jsonb_build_object(
  'ok', true,
  'suite', 'radar_retryable_status_v10_transaction',
  'technical_holds', (
    select count(*) from private.external_market_candidates
    where eligibility_status = 'technical_hold'
  )
) as result;

rollback;
