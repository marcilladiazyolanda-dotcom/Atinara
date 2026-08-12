begin;

do $test$
declare
  definition_value text;
begin
  definition_value := pg_get_functiondef(
    'private.market_radar_candidate_resolution_source_ready_v1(private.external_market_candidates)'::regprocedure
  );
  if position('atinara-resolution-authority-v3' in definition_value) = 0
     or position('candidate_external_id' in definition_value) = 0
     or position('endpoint_identity_verified' in definition_value) = 0 then
    raise exception 'RADAR_SOURCE_AUTHORITY_V3_NOT_ACTIVE';
  end if;
  if has_function_privilege(
    'authenticated',
    'private.market_radar_candidate_resolution_source_ready_v1(private.external_market_candidates)',
    'execute'
  ) then
    raise exception 'RADAR_SOURCE_AUTHORITY_INTERNAL_FUNCTION_EXPOSED';
  end if;
  if exists (
    select 1
    from private.external_market_candidates candidate
    where candidate.eligibility_status = 'eligible'
      and not private.market_radar_candidate_resolution_source_ready_v1(candidate)
  ) then
    raise exception 'RADAR_STALE_AUTHORITY_LEASE_REMAINS';
  end if;
end;
$test$;

select jsonb_build_object(
  'ok', true,
  'suite', 'radar_source_authority_v9_transaction',
  'eligible_authority_v3', (
    select count(*)
    from private.external_market_candidates candidate
    where candidate.eligibility_status = 'eligible'
      and exists (
        select 1
        from jsonb_array_elements(coalesce(candidate.eligibility_evidence, '[]'::jsonb)) item
        where item ->> 'parser_version' = 'atinara-resolution-authority-v3'
      )
  )
) as result;

rollback;
