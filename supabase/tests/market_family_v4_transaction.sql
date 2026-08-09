-- Matriz transaccional de identidad contractual familiar v4.
-- Se ejecuta solo contra una base local/de prueba y siempre termina en ROLLBACK.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';

do $test$
declare
  suffix text := replace(gen_random_uuid()::text, '-', '');
  metadata_value jsonb;
  long_alias jsonb;
  short_alias jsonb;
  numeric_alias jsonb;
  month_value text;
  month_metadata jsonb := '[]'::jsonb;
  family_count integer;
  child_count integer;
  exclusive_day jsonb;
  inclusive_day jsonb;
  ten_utc jsonb;
  eleven_utc jsonb;
  est_boundary jsonb;
  edt_boundary jsonb;
  lowercase_est_boundary jsonb;
  utc_minus_five_boundary jsonb;
  et_boundary jsonb;
  iana_boundary jsonb;
  utc_fourteen_boundary jsonb;
  gap_boundary jsonb;
  fold_boundary jsonb;
  ambiguous_zone_boundary jsonb;
  strict_threshold jsonb;
  inclusive_threshold jsonb;
  score_threshold jsonb;
  symbolic_strict_threshold jsonb;
  symbolic_inclusive_threshold jsonb;
  comma_threshold jsonb;
  dot_threshold jsonb;
  ambiguous_threshold jsonb;
  kojimas_threshold jsonb;
  official_content jsonb;
  mixed_candidate_id uuid;
  ambiguous_candidate_id uuid;
  prepared_candidate_id uuid;
  candidate_row private.external_market_candidates%rowtype;
begin
  if to_regprocedure('private.market_family_metadata_v4(text,text,text,text,timestamptz,text,text,text)') is null then
    raise exception 'TEST_FAMILY_V4_METADATA_FUNCTION_MISSING';
  end if;

  long_alias := private.market_family_metadata_v4(
    'Will Grand Theft Auto VI be released before October 1, 2026?',
    null, null, null, null, 'UTC', null, null
  );
  short_alias := private.market_family_metadata_v4(
    'Will GTA VI be released before October 1, 2026?',
    null, null, null, null, 'UTC', null, null
  );
  numeric_alias := private.market_family_metadata_v4(
    'Will Grand Theft Auto 6 be released before October 1, 2026?',
    null, null, null, null, 'UTC', null, null
  );
  if long_alias ->> 'family_key' <> 'atinara:v4:gtavi:release_date'
     or long_alias ->> 'family_key' is distinct from short_alias ->> 'family_key'
     or long_alias ->> 'family_key' is distinct from numeric_alias ->> 'family_key'
     or long_alias ->> 'family_child_key' is distinct from short_alias ->> 'family_child_key'
     or long_alias ->> 'family_child_key' is distinct from numeric_alias ->> 'family_child_key' then
    raise exception 'TEST_FAMILY_V4_CROSS_PROVIDER_ALIAS_FAILED: % / % / %', long_alias, short_alias, numeric_alias;
  end if;

  foreach month_value in array array['Jul', 'Aug', 'Sep', 'Oct'] loop
    metadata_value := private.market_family_metadata_v4(
      'Will another GTA VI trailer come out before ' || month_value || ' 2026?',
      'Grand Theft Auto VI - New trailer release date', null, null, null, 'UTC',
      'Resolves Yes if a new, at least 30 second, Grand Theft Auto VI trailer is released before the cutoff.',
      null
    );
    month_metadata := month_metadata || jsonb_build_array(metadata_value);
  end loop;
  select count(distinct item ->> 'family_key'), count(distinct item ->> 'family_child_key')
  into family_count, child_count
  from jsonb_array_elements(month_metadata) item;
  if family_count <> 1 or child_count <> 4
     or exists (
       select 1 from jsonb_array_elements(month_metadata) item
       where item ->> 'family_version' <> 'atinara-market-family-v4'
          or item ->> 'family_type' <> 'deadline_ladder'
          or item ->> 'family_key' not like '%:official_content:trailer:duration-gte-30-seconds'
     ) then
    raise exception 'TEST_FAMILY_V4_GTA_MONTH_SIBLINGS_FAILED: %', month_metadata;
  end if;

  exclusive_day := private.market_family_metadata_v4(
    'Will Grand Theft Auto VI be released before October 1, 2026?',
    null, null, null, null, 'UTC', null, null
  );
  inclusive_day := private.market_family_metadata_v4(
    'Will GTA VI be released on or before September 30, 2026?',
    null, null, null, null, 'UTC', null, null
  );
  if exclusive_day ->> 'family_child_key' is distinct from inclusive_day ->> 'family_child_key'
     or inclusive_day #>> '{family_semantics,temporal_boundary,operator}' <> 'lte'
     or inclusive_day #>> '{family_semantics,temporal_boundary,canonical_operator}' <> 'lt'
     or inclusive_day #>> '{family_semantics,temporal_boundary,canonical_instant}' <> '2026-10-01T00:00:00.000Z' then
    raise exception 'TEST_FAMILY_V4_DISCRETE_BOUNDARY_EQUIVALENCE_FAILED: % / %', exclusive_day, inclusive_day;
  end if;

  ten_utc := private.market_family_metadata_v4(
    'Will GTA VI be released before October 1, 2026 at 10:00 UTC?',
    null, null, null, null, 'UTC', null, null
  );
  eleven_utc := private.market_family_metadata_v4(
    'Will Grand Theft Auto VI be released before October 1, 2026 at 11:00 UTC?',
    null, null, null, null, 'UTC', null, null
  );
  if ten_utc ->> 'family_key' is distinct from eleven_utc ->> 'family_key'
     or ten_utc ->> 'family_child_key' is not distinct from eleven_utc ->> 'family_child_key' then
    raise exception 'TEST_FAMILY_V4_HOURLY_BOUNDARIES_COLLAPSED: % / %', ten_utc, eleven_utc;
  end if;

  est_boundary := private.market_family_metadata_v4(
    'Will GTA VI be released before July 1, 2027 at 10:00 EST?',
    null, null, null, null, null, null, null
  );
  edt_boundary := private.market_family_metadata_v4(
    'Will GTA VI be released before July 1, 2027 at 10:00 EDT?',
    null, null, null, null, null, null, null
  );
  lowercase_est_boundary := private.market_family_metadata_v4(
    'Will GTA VI be released before July 1, 2027 at 10:00 est?',
    null, null, null, null, null, null, null
  );
  utc_minus_five_boundary := private.market_family_metadata_v4(
    'Will GTA VI be released before July 1, 2027 at 10:00 UTC-05:00?',
    null, null, null, null, null, null, null
  );
  et_boundary := private.market_family_metadata_v4(
    'Will GTA VI be released before July 1, 2027 at 10:00 ET?',
    null, null, null, null, null, null, null
  );
  iana_boundary := private.market_family_metadata_v4(
    'Will GTA VI be released before July 1, 2027 at 10:00?',
    null, null, null, null, 'America/New_York', null, null
  );
  utc_fourteen_boundary := private.market_family_metadata_v4(
    'Will GTA VI be released before July 1, 2027 at 14:00 UTC?',
    null, null, null, null, null, null, null
  );
  if est_boundary #>> '{family_semantics,temporal_boundary,instant}' <> '2027-07-01T15:00:00.000Z'
     or est_boundary #>> '{family_semantics,temporal_boundary,timezone}' <> 'UTC-05:00'
     or est_boundary #>> '{family_semantics,temporal_boundary,offset_minutes}' <> '-300'
     or edt_boundary #>> '{family_semantics,temporal_boundary,instant}' <> '2027-07-01T14:00:00.000Z'
     or edt_boundary #>> '{family_semantics,temporal_boundary,timezone}' <> 'UTC-04:00'
     or edt_boundary #>> '{family_semantics,temporal_boundary,offset_minutes}' <> '-240'
     or est_boundary ->> 'family_child_key' is not distinct from edt_boundary ->> 'family_child_key'
     or est_boundary ->> 'family_child_key' is distinct from lowercase_est_boundary ->> 'family_child_key'
     or est_boundary ->> 'family_child_key' is distinct from utc_minus_five_boundary ->> 'family_child_key'
     or et_boundary ->> 'family_child_key' is distinct from iana_boundary ->> 'family_child_key'
     or et_boundary ->> 'family_child_key' is distinct from utc_fourteen_boundary ->> 'family_child_key'
     or edt_boundary ->> 'family_child_key' is distinct from utc_fourteen_boundary ->> 'family_child_key'
     or edt_boundary ->> 'family_child_key' <> 'deadline:lt:2027-07-01T14:00:00.000Z:minute' then
    raise exception 'TEST_FAMILY_V4_TIMEZONE_OFFSET_IDENTITY_FAILED: % / % / % / % / % / % / %',
      est_boundary, edt_boundary, lowercase_est_boundary, utc_minus_five_boundary,
      et_boundary, iana_boundary, utc_fourteen_boundary;
  end if;

  gap_boundary := private.market_family_metadata_v4(
    'Will GTA VI be released before March 14, 2027 at 02:30 ET?',
    null, null, null, null, null, null, null
  );
  fold_boundary := private.market_family_metadata_v4(
    'Will GTA VI be released before November 7, 2027 at 01:30 ET?',
    null, null, null, null, null, null, null
  );
  ambiguous_zone_boundary := private.market_family_metadata_v4(
    'Will GTA VI be released before July 1, 2027 at 10:00 CST?',
    null, null, null, null, null, null, null
  );
  if gap_boundary #>> '{family_semantics,temporal_boundary,ambiguity_reason}' <> 'nonexistent_local_time'
     or jsonb_array_length(gap_boundary #> '{family_semantics,temporal_boundary,candidate_instants}') <> 0
     or fold_boundary #>> '{family_semantics,temporal_boundary,ambiguity_reason}' <> 'repeated_local_time'
     or jsonb_array_length(fold_boundary #> '{family_semantics,temporal_boundary,candidate_instants}') <> 2
     or ambiguous_zone_boundary #>> '{family_semantics,temporal_boundary,ambiguity_reason}' <> 'ambiguous_timezone'
     or coalesce((gap_boundary #>> '{family_semantics,identity_ambiguous}')::boolean, false) is not true
     or coalesce((fold_boundary #>> '{family_semantics,identity_ambiguous}')::boolean, false) is not true
     or coalesce((ambiguous_zone_boundary #>> '{family_semantics,identity_ambiguous}')::boolean, false) is not true
     or gap_boundary ->> 'family_child_key' not like 'deadline:ambiguous-timezone:%'
     or fold_boundary ->> 'family_child_key' not like 'deadline:ambiguous-timezone:%' then
    raise exception 'TEST_FAMILY_V4_DST_AMBIGUITY_FAILED: % / % / %',
      gap_boundary, fold_boundary, ambiguous_zone_boundary;
  end if;

  strict_threshold := private.market_family_metadata_v4(
    'Will Hideo Kojima next trailer reach more than 1000000 views in 48 hours?',
    null, null, null, null, 'UTC', null, null
  );
  inclusive_threshold := private.market_family_metadata_v4(
    'Will Hideo Kojima next trailer reach at least 1000000 views in 48 hours?',
    null, null, null, null, 'UTC', null, null
  );
  score_threshold := private.market_family_metadata_v4(
    'Will Hideo Kojima next trailer score above 95 points?',
    null, null, null, null, 'UTC', null, null
  );
  symbolic_strict_threshold := private.market_family_metadata_v4(
    'Will Hideo Kojima next trailer reach > 1000000 views?',
    null, null, null, null, 'UTC', null, null
  );
  symbolic_inclusive_threshold := private.market_family_metadata_v4(
    'Will Hideo Kojima next trailer reach >= 1000000 views?',
    null, null, null, null, 'UTC', null, null
  );
  if strict_threshold ->> 'family_child_key' <> 'threshold:gt:1000000:views'
     or inclusive_threshold ->> 'family_child_key' <> 'threshold:gte:1000000:views'
     or score_threshold ->> 'family_child_key' <> 'threshold:gt:95:points'
     or symbolic_strict_threshold ->> 'family_child_key' <> 'threshold:gt:1000000:views'
     or symbolic_inclusive_threshold ->> 'family_child_key' <> 'threshold:gte:1000000:views'
     or strict_threshold ->> 'family_key' not like '%:threshold'
     or strict_threshold ->> 'family_key' like '%official_content%' then
    raise exception 'TEST_FAMILY_V4_PREDICATE_THRESHOLD_FAILED: % / % / % / % / %',
      strict_threshold, inclusive_threshold, score_threshold,
      symbolic_strict_threshold, symbolic_inclusive_threshold;
  end if;

  comma_threshold := private.market_family_metadata_v4(
    'Will Hideo Kojima next trailer reach more than 1,000,000 views?',
    null, null, null, null, 'UTC', null, null
  );
  dot_threshold := private.market_family_metadata_v4(
    'Will Hideo Kojima next trailer reach more than 1.000.000 views?',
    null, null, null, null, 'UTC', null, null
  );
  ambiguous_threshold := private.market_family_metadata_v4(
    'Will Hideo Kojima next trailer reach more than 1,500 views?',
    null, null, null, null, 'UTC', null, null
  );
  if comma_threshold ->> 'family_child_key' <> 'threshold:gt:1000000:views'
     or comma_threshold ->> 'family_child_key' is distinct from dot_threshold ->> 'family_child_key'
     or ambiguous_threshold ->> 'family_child_key' <> 'threshold:ambiguous:1-500:views'
     or coalesce((ambiguous_threshold #>> '{family_semantics,identity_ambiguous}')::boolean, false) is not true then
    raise exception 'TEST_FAMILY_V4_NUMBER_CANONICALIZATION_FAILED: % / % / %', comma_threshold, dot_threshold, ambiguous_threshold;
  end if;
  if jsonb_array_length(private.market_candidate_blocking_duplicates(
       jsonb_build_array(jsonb_build_object(
         'relationship', 'identity_ambiguous', 'blocking', false,
         'family_version', 'atinara-market-family-v4'
       )), null
     )) <> 0 then
    raise exception 'TEST_FAMILY_V4_AMBIGUITY_BECAME_BLOCKER';
  end if;

  kojimas_threshold := private.market_family_metadata_v4(
    'Will the next Kojima Productions trailer exceed 5 million views in 48 hours?',
    null, null, null, null, 'UTC',
    'The qualifying official trailer must be at least 30 seconds long.', null
  );
  official_content := private.market_family_metadata_v4(
    'Will another GTA VI trailer come out before Oct 2026?',
    'Grand Theft Auto VI - New trailer release date', null, null, null, 'UTC',
    'The qualifying official trailer must be at least 30 seconds long.', null
  );
  if kojimas_threshold ->> 'family_child_key' <> 'threshold:gt:5000000:views'
     or kojimas_threshold ->> 'family_key' like '%official_content%'
     or kojimas_threshold ->> 'family_child_key' like '%30%'
     or official_content ->> 'family_key' not like '%:official_content:trailer:duration-gte-30-seconds' then
    raise exception 'TEST_FAMILY_V4_INCIDENTAL_DURATION_CHANGED_DIMENSION: % / %', kojimas_threshold, official_content;
  end if;

  insert into private.external_market_candidates (
    provider, external_id, fingerprint, normalizer_version, normalized_payload,
    quality_status, quality_score, fetched_at, expires_at, state,
    verification_status, verification_reason_code, verification_reason
  ) values (
    'kalshi', 'family-v4-mixed-' || suffix, 'family-v4-mixed-' || suffix,
    'atinara-radar-v2', jsonb_build_object(
      'source_question', 'Will Family Mixed Fixture be released before 2028?',
      'atinara_question', 'Will Family Mixed Fixture be released before 2028?',
      'source_title', 'Family Mixed Fixture',
      'hard_reject_reasons', jsonb_build_array('DUPLICATE_MARKET', 'SOURCE_STALE')
    ),
    'rejected', 0, now(), now() + interval '30 days', 'rejected',
    'rejected_duplicate', 'DUPLICATE_MARKET', 'Legacy duplicate marker.'
  ) returning id into mixed_candidate_id;
  select * into candidate_row
  from private.external_market_candidates where id = mixed_candidate_id;
  if candidate_row.state <> 'rejected'
     or candidate_row.quality_status <> 'rejected'
     or candidate_row.verification_status <> 'rejected_stale'
     or candidate_row.verification_reason_code <> 'SOURCE_STALE'
     or candidate_row.duplicate_matches <> '[]'::jsonb
     or candidate_row.normalized_payload -> 'hard_reject_reasons' <> '["SOURCE_STALE"]'::jsonb then
    raise exception 'TEST_FAMILY_V4_MIXED_REJECTION_NOT_RECLASSIFIED: %', row_to_json(candidate_row);
  end if;

  insert into private.external_market_candidates (
    provider, external_id, fingerprint, normalizer_version, normalized_payload,
    quality_status, quality_score, fetched_at, expires_at, state,
    verification_status, verification_reason_code
  ) values (
    'polymarket', 'family-v4-ambiguous-' || suffix, 'family-v4-ambiguous-' || suffix,
    'atinara-radar-v2', jsonb_build_object(
      'source_question', 'Will Family Ambiguous Fixture reach more than 1,500 views?',
      'atinara_question', 'Will Family Ambiguous Fixture reach more than 1,500 views?',
      'source_title', 'Family Ambiguous Fixture',
      'hard_reject_reasons', '[]'::jsonb
    ),
    'needs_review', 0, now(), now() + interval '30 days', 'needs_review',
    'needs_review', 'VERIFICATION_REQUIRED'
  ) returning id into ambiguous_candidate_id;
  select * into candidate_row
  from private.external_market_candidates where id = ambiguous_candidate_id;
  if candidate_row.state <> 'needs_review'
     or candidate_row.verification_status <> 'needs_review'
     or candidate_row.verification_reason_code <> 'FAMILY_IDENTITY_AMBIGUOUS'
     or candidate_row.duplicate_matches <> '[]'::jsonb
     or jsonb_array_length(coalesce(candidate_row.normalized_payload -> 'family_identity_ambiguities', '[]'::jsonb)) <> 1 then
    raise exception 'TEST_FAMILY_V4_AMBIGUOUS_CANDIDATE_NOT_FAIL_CLOSED: %', row_to_json(candidate_row);
  end if;

  insert into private.external_market_candidates (
    provider, external_id, fingerprint, normalizer_version, normalized_payload,
    quality_status, quality_score, fetched_at, expires_at, state,
    verification_status
  ) values (
    'tavily', 'family-v4-prepared-' || suffix, 'family-v4-prepared-' || suffix,
    'atinara-radar-v2', jsonb_build_object(
      'source_question', 'Will Family Prepared Fixture be announced before 2028?',
      'atinara_question', 'Will Family Prepared Fixture be announced before 2028?',
      'source_title', 'Family Prepared Fixture',
      'hard_reject_reasons', '[]'::jsonb
    ),
    'fit', 90, now(), now() + interval '30 days', 'prepared', 'verified_open'
  ) returning id into prepared_candidate_id;
  select * into candidate_row
  from private.external_market_candidates where id = prepared_candidate_id;
  if candidate_row.state <> 'prepared' or candidate_row.quality_status = 'rejected' then
    raise exception 'TEST_FAMILY_V4_PREPARED_MOVED_TO_REJECTED: %', row_to_json(candidate_row);
  end if;
end;
$test$;

rollback;
