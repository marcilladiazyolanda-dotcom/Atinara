begin;

do $test$
begin
  if exists (
    select 1
    from private.external_market_candidates candidate
    where candidate.eligibility_status = 'technical_hold'
      and (
        candidate.quality_status <> 'needs_review'
        or candidate.verification_status <> 'needs_review'
        or candidate.state not in ('needs_review', 'prepared', 'dismissed')
      )
  ) then
    raise exception 'RADAR_TECHNICAL_HOLD_PROJECTED_AS_REJECTION';
  end if;
  if position(
       $$elsif new.eligibility_status = 'technical_hold'$$
       in pg_get_functiondef('private.enforce_market_radar_eligibility_v1()'::regprocedure)
     ) = 0 then
    raise exception 'RADAR_TECHNICAL_HOLD_TRIGGER_BRANCH_MISSING';
  end if;
end;
$test$;

select jsonb_build_object(
  'ok', true,
  'suite', 'radar_technical_hold_projection_v11_transaction',
  'technical_holds', (select count(*) from private.external_market_candidates where eligibility_status = 'technical_hold')
) as result;

rollback;
