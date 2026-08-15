-- Regresión transaccional de identidad categórica y horizonte predictivo.
-- Solo puede ejecutarse contra una base local/de prueba y siempre hace ROLLBACK.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';

do $test$
declare
  suffix text := replace(gen_random_uuid()::text, '-', '');
  half_life_family jsonb;
  saros_family jsonb;
  pokemon_composed_family jsonb;
  pokemon_decomposed_family jsonb;
  generic_yes_family jsonb;
  exclusive_day_family jsonb;
  inclusive_day_family jsonb;
  strict_threshold_family jsonb;
  symbolic_threshold_family jsonb;
  et_family jsonb;
  utc_family jsonb;
  candidate_id uuid;
  second_candidate_id uuid;
  lower_bound_candidate_id uuid;
  cross_provider_candidate_id uuid;
  draft_id uuid;
  legacy_draft_id uuid;
  first_eligibility_id bigint;
  second_eligibility_id bigint;
  cross_eligibility_id bigint;
  admin_id uuid;
  list_result jsonb;
  short_horizon_result jsonb;
  origin_projection jsonb;
  expected_failure boolean;
  first_external_id text := 'family-option-horizon-a-' || suffix;
  second_external_id text := 'family-option-horizon-b-' || suffix;
  query_value text := 'Fixture Awards ' || suffix;
  candidate_row private.external_market_candidates%rowtype;
  second_candidate_row private.external_market_candidates%rowtype;
  lower_bound_candidate_row private.external_market_candidates%rowtype;
  cross_provider_candidate_row private.external_market_candidates%rowtype;
  draft_row private.market_drafts%rowtype;
begin
  if to_regprocedure(
       'private.market_radar_candidate_horizon_at_v1(private.external_market_candidates)'
     ) is null then
    raise exception 'TEST_RADAR_PREDICTIVE_HORIZON_FUNCTION_MISSING';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_proc procedure
    where procedure.oid =
      'public.list_market_radar_candidates_v2(text,text,text,text,text,text,integer,integer)'::regprocedure
      and procedure.prosecdef
      and pg_catalog.pg_get_userbyid(procedure.proowner) = 'postgres'
      and procedure.proconfig @> array['search_path=""']::text[]
  )
     or not has_function_privilege(
       'authenticated',
       'public.list_market_radar_candidates_v2(text,text,text,text,text,text,integer,integer)',
       'EXECUTE'
     )
     or has_function_privilege(
       'anon',
       'public.list_market_radar_candidates_v2(text,text,text,text,text,text,integer,integer)',
       'EXECUTE'
     )
     or has_function_privilege(
       'service_role',
       'public.list_market_radar_candidates_v2(text,text,text,text,text,text,integer,integer)',
       'EXECUTE'
     ) then
    raise exception 'TEST_RADAR_LIST_SECURITY_CONTRACT_INVALID';
  end if;
  if exists (
    select 1
    from unnest(array['anon', 'authenticated', 'service_role']) role_name,
         unnest(array[
           'private.market_family_option_slug_v1(text,integer)',
           'private.market_family_metadata_v4(text,text,text,text,timestamp with time zone,text,text,text)',
           'private.market_family_origin_projection_v1(uuid,text)',
           'private.market_radar_candidate_horizon_at_v1(private.external_market_candidates)',
           'private.assign_market_candidate_family_v4()',
           'private.assign_market_draft_family_v4()',
           'private.assign_public_market_family_v4()'
         ]) procedure_name
    where has_function_privilege(role_name, procedure_name, 'EXECUTE')
  ) then
    raise exception 'TEST_RADAR_PRIVATE_FUNCTION_EXECUTE_EXPOSED';
  end if;

  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text,
    true
  );
  expected_failure := false;
  execute 'set local role authenticated';
  begin
    perform public.list_market_radar_candidates_v2(
      null, null, 'all', null, 'recommended', '365d', 1, 0
    );
  exception when insufficient_privilege then
    if position('ADMIN_REQUIRED' in sqlerrm) > 0 then expected_failure := true;
    else raise; end if;
  end;
  execute 'reset role';
  if not expected_failure then raise exception 'TEST_RADAR_NON_ADMIN_LIST_ACCEPTED'; end if;

  foreach query_value in array array['anon', 'service_role'] loop
    expected_failure := false;
    execute format('set local role %I', query_value);
    begin
      perform public.list_market_radar_candidates_v2(
        null, null, 'all', null, 'recommended', '365d', 1, 0
      );
    exception when insufficient_privilege then expected_failure := true;
    end;
    execute 'reset role';
    if not expected_failure then
      raise exception 'TEST_RADAR_ROLE_LIST_ACCEPTED: %', query_value;
    end if;
  end loop;
  query_value := 'Fixture Awards ' || suffix;

  half_life_family := private.market_family_metadata_v4(
    '2026 Game of the Year?',
    'The Game Awards: 2026 Game of the Year',
    null,
    'kalshi:KXGAMEAWARDS-2026',
    null,
    null,
    'Resolves Yes if Half-Life 3 wins 2026 Game of the Year before the end of 2026.',
    'Half-Life 3'
  );
  saros_family := private.market_family_metadata_v4(
    '2026 Game of the Year?',
    'The Game Awards: 2026 Game of the Year',
    null,
    'kalshi:KXGAMEAWARDS-2026',
    null,
    null,
    'Resolves Yes if Saros wins 2026 Game of the Year before the end of 2026.',
    'Saros'
  );

  pokemon_composed_family := private.market_family_metadata_v4(
    '2026 Game of the Year?', query_value, null,
    'kalshi:KXGAMEAWARDS-FIXTURE-' || suffix, null, null,
    'Resolves Yes if the named option wins before the end of 2026.', U&'Pok\00E9mon'
  );
  pokemon_decomposed_family := private.market_family_metadata_v4(
    '2026 Game of the Year?', query_value, null,
    'kalshi:KXGAMEAWARDS-FIXTURE-' || suffix, null, null,
    'Resolves Yes if the named option wins before the end of 2026.', U&'Poke\0301mon'
  );
  generic_yes_family := private.market_family_metadata_v4(
    '2026 Game of the Year?', query_value, null,
    'kalshi:KXGAMEAWARDS-FIXTURE-' || suffix, null, null,
    'Resolves Yes if the event occurs before the end of 2026.', 'Yes!'
  );

  if half_life_family ->> 'family_key'
       is distinct from saros_family ->> 'family_key'
     or half_life_family ->> 'family_child_key' is distinct from 'option:half-life-3'
     or saros_family ->> 'family_child_key' is distinct from 'option:saros'
     or half_life_family ->> 'family_sort_at' is distinct from '2027-01-01T00:00:00.000Z'
     or saros_family ->> 'family_sort_at' is distinct from '2027-01-01T00:00:00.000Z'
     or pokemon_composed_family ->> 'family_child_key' is distinct from 'option:pokemon'
     or pokemon_decomposed_family ->> 'family_child_key' is distinct from 'option:pokemon'
     or generic_yes_family ->> 'family_child_key'
          is distinct from 'deadline:lt:2027-01-01T00:00:00.000Z:year' then
    raise exception 'TEST_RADAR_CATEGORICAL_OPTION_PARITY_FAILED: % / %',
      half_life_family, saros_family;
  end if;

  -- Matriz mínima hermética de las ramas v4 que esta migración reemplaza.
  exclusive_day_family := private.market_family_metadata_v4(
    'Will GTA VI be released before October 1, 2026?',
    null, null, null, null, 'UTC', null, null
  );
  inclusive_day_family := private.market_family_metadata_v4(
    'Will GTA VI be released on or before September 30, 2026?',
    null, null, null, null, 'UTC', null, null
  );
  strict_threshold_family := private.market_family_metadata_v4(
    'Will the next trailer reach more than 1000000 views?',
    null, null, null, null, 'UTC', null, null
  );
  symbolic_threshold_family := private.market_family_metadata_v4(
    'Will the next trailer reach > 1000000 views?',
    null, null, null, null, 'UTC', null, null
  );
  et_family := private.market_family_metadata_v4(
    'Will GTA VI be released before July 1, 2027 at 10:00 ET?',
    null, null, null, null, null, null, null
  );
  utc_family := private.market_family_metadata_v4(
    'Will GTA VI be released before July 1, 2027 at 14:00 UTC?',
    null, null, null, null, null, null, null
  );
  if exclusive_day_family ->> 'family_child_key'
       is distinct from inclusive_day_family ->> 'family_child_key'
     or inclusive_day_family #>> '{family_semantics,temporal_boundary,canonical_operator}'
       is distinct from 'lt'
     or strict_threshold_family ->> 'family_child_key'
       is distinct from 'threshold:gt:1000000:views'
     or symbolic_threshold_family ->> 'family_child_key'
       is distinct from 'threshold:gt:1000000:views'
     or et_family ->> 'family_child_key'
       is distinct from utc_family ->> 'family_child_key'
     or et_family ->> 'family_child_key'
       is distinct from 'deadline:lt:2027-07-01T14:00:00.000Z:minute' then
    raise exception 'TEST_RADAR_REPLACED_FAMILY_MATRIX_FAILED: % / % / % / % / % / %',
      exclusive_day_family, inclusive_day_family,
      strict_threshold_family, symbolic_threshold_family, et_family, utc_family;
  end if;

  insert into private.external_market_candidates (
    provider, external_id, external_event_id, fingerprint, normalizer_version,
    normalized_payload, quality_status, quality_score, fetched_at, expires_at,
    state, verification_status
  ) values (
    'kalshi',
    first_external_id,
    'KXGAMEAWARDS-FIXTURE-' || suffix,
    first_external_id,
    'atinara-radar-v2',
    jsonb_build_object(
      'source_question', '2026 Fixture Game of the Year?',
      'atinara_question', '2026 Fixture Game of the Year?',
      'source_title', query_value || ': 2026 Game of the Year',
      'source_resolution_rules',
        'Resolves Yes if Aurora wins 2026 Fixture Game of the Year before the end of 2026.',
      'source_close_at', to_jsonb(now() + interval '400 days'),
      'event_group_key', 'kalshi:KXGAMEAWARDS-FIXTURE-' || suffix,
      'provider_payload', jsonb_build_object(
        'yes_sub_title', 'Aurora',
        'no_sub_title', 'Aurora'
      ),
      'hard_reject_reasons', '[]'::jsonb
    ),
    'needs_review',
    0,
    now(),
    now() + interval '30 days',
    'needs_review',
    'needs_review'
  )
  returning id into candidate_id;

  select * into candidate_row
  from private.external_market_candidates
  where id = candidate_id;

  if candidate_row.family_child_key is distinct from 'option:aurora'
     or candidate_row.family_child_label is distinct from 'Aurora'
     or candidate_row.family_sort_at is distinct from '2027-01-01T00:00:00.000Z'::timestamptz
     or candidate_row.normalized_payload ->> 'family_child_key' is distinct from 'option:aurora'
     or private.market_radar_candidate_horizon_at_v1(candidate_row)
          is distinct from '2027-01-01T00:00:00.000Z'::timestamptz
     or private.market_radar_candidate_horizon_at_v1(candidate_row)
          = (candidate_row.normalized_payload ->> 'source_close_at')::timestamptz then
    raise exception 'TEST_RADAR_TRIGGER_OR_HORIZON_PROJECTION_FAILED: %',
      row_to_json(candidate_row);
  end if;

  -- Simula una identidad histórica incorrecta y la siguiente proyección
  -- canónica enviada por la Edge. El trigger debe reparar sin backfill.
  -- La desactivación es local a esta transacción de prueba y permite fijar
  -- exactamente el snapshot pre-migración; cualquier error termina en ROLLBACK.
  execute 'alter table private.external_market_candidates disable trigger a_assign_market_candidate_family_v4_before_write';
  update private.external_market_candidates
  set family_child_key = 'deadline:lt:2027-01-01T00:00:00.000Z:year',
      normalized_payload = normalized_payload || jsonb_build_object(
        'family_child_key', 'deadline:lt:2027-01-01T00:00:00.000Z:year'
      )
  where id = candidate_id;
  execute 'alter table private.external_market_candidates enable trigger a_assign_market_candidate_family_v4_before_write';

  select * into candidate_row
  from private.external_market_candidates
  where id = candidate_id;
  if candidate_row.family_child_key
       is distinct from 'deadline:lt:2027-01-01T00:00:00.000Z:year'
     or candidate_row.normalized_payload ->> 'family_child_key'
       is distinct from 'deadline:lt:2027-01-01T00:00:00.000Z:year' then
    raise exception 'TEST_RADAR_LEGACY_IDENTITY_FIXTURE_NOT_MATERIALIZED: %',
      row_to_json(candidate_row);
  end if;

  update private.external_market_candidates
  set normalized_payload = normalized_payload || jsonb_build_object(
    'family_key', candidate_row.family_key,
    'family_child_key', 'option:aurora',
    'family_version', 'atinara-market-family-v4'
  )
  where id = candidate_id;

  select * into candidate_row
  from private.external_market_candidates
  where id = candidate_id;
  if candidate_row.family_child_key is distinct from 'option:aurora'
     or candidate_row.normalized_payload ->> 'family_child_key' is distinct from 'option:aurora'
     or candidate_row.family_sort_at is distinct from '2027-01-01T00:00:00.000Z'::timestamptz then
    raise exception 'TEST_RADAR_LEGACY_IDENTITY_REFRESH_NOT_REPAIRED: %',
      row_to_json(candidate_row);
  end if;

  insert into private.external_market_candidates (
    provider, external_id, external_event_id, fingerprint, normalizer_version,
    normalized_payload, quality_status, quality_score, fetched_at, expires_at,
    state, verification_status
  ) values (
    'kalshi',
    second_external_id,
    'KXGAMEAWARDS-FIXTURE-' || suffix,
    second_external_id,
    'atinara-radar-v2',
    jsonb_build_object(
      'source_question', '2026 Fixture Game of the Year?',
      'atinara_question', '2026 Fixture Game of the Year?',
      'source_title', query_value || ': 2026 Game of the Year',
      'source_resolution_rules',
        'Resolves Yes if Borealis wins 2026 Fixture Game of the Year before the end of 2026.',
      'source_close_at', to_jsonb(now() + interval '450 days'),
      'event_group_key', 'kalshi:KXGAMEAWARDS-FIXTURE-' || suffix,
      'provider_payload', jsonb_build_object(
        'yes_sub_title', 'Borealis',
        'no_sub_title', 'Borealis'
      ),
      'hard_reject_reasons', '[]'::jsonb
    ),
    'needs_review',
    0,
    now(),
    now() + interval '30 days',
    'needs_review',
    'needs_review'
  )
  returning id into second_candidate_id;

  select * into second_candidate_row
  from private.external_market_candidates
  where id = second_candidate_id;
  if second_candidate_row.family_child_key is distinct from 'option:borealis'
     or second_candidate_row.family_key is distinct from candidate_row.family_key then
    raise exception 'TEST_RADAR_SECOND_OPTION_PROJECTION_FAILED: %',
      row_to_json(second_candidate_row);
  end if;

  insert into private.external_market_candidates (
    provider, external_id, external_event_id, fingerprint, normalizer_version,
    normalized_payload, quality_status, quality_score, fetched_at, expires_at,
    state, verification_status
  ) values (
    'kalshi', 'family-lower-bound-' || suffix,
    'KXLOWERBOUND-FIXTURE-' || suffix, 'family-lower-bound-' || suffix,
    'atinara-radar-v2', jsonb_build_object(
      'source_question',
        'Will Lower Boundary Fixture be released after October 1, 2026?',
      'atinara_question',
        'Will Lower Boundary Fixture be released after October 1, 2026?',
      'source_title', 'Lower Boundary Fixture ' || suffix,
      'source_close_at', to_jsonb(now() + interval '400 days'),
      'event_group_key', 'kalshi:KXLOWERBOUND-FIXTURE-' || suffix,
      'hard_reject_reasons', '[]'::jsonb
    ),
    'needs_review', 0, now(), now() + interval '30 days',
    'needs_review', 'needs_review'
  ) returning id into lower_bound_candidate_id;
  select * into lower_bound_candidate_row
  from private.external_market_candidates
  where id = lower_bound_candidate_id;
  if lower_bound_candidate_row.family_semantics
       #>> '{temporal_boundary,canonical_operator}' is distinct from 'gte'
     or private.market_radar_candidate_horizon_at_v1(lower_bound_candidate_row)
       is distinct from (
         lower_bound_candidate_row.normalized_payload ->> 'source_close_at'
       )::timestamptz
     or private.market_radar_candidate_horizon_at_v1(lower_bound_candidate_row)
       = lower_bound_candidate_row.family_sort_at then
    raise exception 'TEST_RADAR_LOWER_BOUND_USED_AS_HORIZON: %',
      row_to_json(lower_bound_candidate_row);
  end if;

  -- Ventanas relativas mantienen la prueba estable en el tiempo: la frontera
  -- predictiva entra en 365d, mientras el cierre técnico queda fuera.
  execute 'alter table private.external_market_candidates disable trigger a_assign_market_candidate_family_v4_before_write';
  update private.external_market_candidates
  set family_sort_at = now() + interval '200 days'
  where id = candidate_id;
  update private.external_market_candidates
  set family_sort_at = now() + interval '220 days'
  where id = second_candidate_id;
  execute 'alter table private.external_market_candidates enable trigger a_assign_market_candidate_family_v4_before_write';
  select * into candidate_row
  from private.external_market_candidates where id = candidate_id;
  select * into second_candidate_row
  from private.external_market_candidates where id = second_candidate_id;
  if candidate_row.family_sort_at is distinct from now() + interval '200 days'
     or second_candidate_row.family_sort_at is distinct from now() + interval '220 days'
     or (candidate_row.normalized_payload ->> 'source_close_at')::timestamptz
          <= now() + interval '365 days'
     or (second_candidate_row.normalized_payload ->> 'source_close_at')::timestamptz
          <= now() + interval '365 days' then
    raise exception 'TEST_RADAR_RELATIVE_HORIZON_FIXTURE_INVALID: % / %',
      row_to_json(candidate_row), row_to_json(second_candidate_row);
  end if;

  insert into private.market_radar_eligibility_checks (
    attempt_id, candidate_id, provider, external_id, event_group_key,
    policy_version, status, reason_code, reason, evidence,
    checked_at, expires_at, decision_hash
  ) values (
    gen_random_uuid(), candidate_id, 'kalshi', first_external_id, null,
    'atinara-prediction-policy-v5', 'eligible', null,
    'Fixture elegible para probar horizonte predictivo.', '[]'::jsonb,
    now(), now() + interval '6 hours', repeat('a', 64)
  ) returning id into first_eligibility_id;
  insert into private.market_radar_eligibility_checks (
    attempt_id, candidate_id, provider, external_id, event_group_key,
    policy_version, status, reason_code, reason, evidence,
    checked_at, expires_at, decision_hash
  ) values (
    gen_random_uuid(), second_candidate_id, 'kalshi', second_external_id, null,
    'atinara-prediction-policy-v5', 'eligible', null,
    'Fixture elegible para probar orden de cierre.', '[]'::jsonb,
    now(), now() + interval '6 hours', repeat('b', 64)
  ) returning id into second_eligibility_id;

  update private.external_market_candidates
  set current_eligibility_check_id = first_eligibility_id,
      eligibility_policy_version = 'atinara-prediction-policy-v5',
      eligibility_status = 'eligible',
      eligibility_checked_at = now(),
      eligibility_expires_at = now() + interval '6 hours',
      state = 'available',
      verification_status = 'verified_open',
      quality_status = 'fit'
  where id = candidate_id;
  update private.external_market_candidates
  set current_eligibility_check_id = second_eligibility_id,
      eligibility_policy_version = 'atinara-prediction-policy-v5',
      eligibility_status = 'eligible',
      eligibility_checked_at = now(),
      eligibility_expires_at = now() + interval '6 hours',
      state = 'available',
      verification_status = 'verified_open',
      quality_status = 'fit'
  where id = second_candidate_id;

  -- La RPC productiva exige una administradora autenticada real.
  select user_row.id into admin_id
  from auth.users user_row
  where coalesce((user_row.raw_app_meta_data ->> 'oraklo_admin')::boolean, false)
  order by user_row.created_at
  limit 1;
  if admin_id is null then raise exception 'TEST_ADMIN_REQUIRED'; end if;
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', admin_id, 'role', 'authenticated')::text,
    true
  );
  execute 'set local role authenticated';

  list_result := public.list_market_radar_candidates_v2(
    'kalshi', null, 'all', query_value, 'closing', '365d', 20, 0
  );
  if jsonb_array_length(list_result) <> 2
     or list_result -> 0 ->> 'external_id' is distinct from first_external_id
     or list_result -> 1 ->> 'external_id' is distinct from second_external_id then
    raise exception 'TEST_RADAR_LIST_HORIZON_OR_ORDER_FAILED: %', list_result;
  end if;

  short_horizon_result := public.list_market_radar_candidates_v2(
    'kalshi', null, 'all', query_value, 'closing', '180d', 20, 0
  );
  if jsonb_array_length(short_horizon_result) <> 0 then
    raise exception 'TEST_RADAR_LIST_SHORT_HORIZON_LEAKED: %', short_horizon_result;
  end if;
  execute 'reset role';

  execute 'alter table private.external_market_candidates disable trigger a_assign_market_candidate_family_v4_before_write';
  update private.external_market_candidates
  set family_sort_at = now() - interval '1 minute'
  where id = candidate_id;
  execute 'alter table private.external_market_candidates enable trigger a_assign_market_candidate_family_v4_before_write';
  select * into candidate_row
  from private.external_market_candidates where id = candidate_id;
  if candidate_row.family_sort_at is distinct from now() - interval '1 minute' then
    raise exception 'TEST_RADAR_PAST_BOUNDARY_FIXTURE_INVALID: %',
      row_to_json(candidate_row);
  end if;
  execute 'set local role authenticated';
  list_result := public.list_market_radar_candidates_v2(
    'kalshi', null, 'all', query_value, 'closing', '365d', 20, 0
  );
  execute 'reset role';
  if jsonb_array_length(list_result) <> 1
     or list_result -> 0 ->> 'external_id' is distinct from second_external_id then
    raise exception 'TEST_RADAR_PAST_BOUNDARY_LISTED: %', list_result;
  end if;

  -- La identidad categórica debe sobrevivir candidata -> borrador -> mercado.
  -- La prueba no publica: consulta la misma proyección privada que usa el
  -- trigger de public.markets y verifica el gate cross-provider en la lista.
  insert into private.market_drafts (
    market_slug, question, subject, category,
    evaluation_ends_at, closes_at, timezone, resolution_deadline,
    yes_criteria, no_criteria, edge_cases,
    primary_source, alternative_sources, workflow_status,
    created_by, updated_by, radar_candidate_id, source_provenance
  ) values (
    'radar-option-' || suffix,
    '¿Ganará Borealis el premio Fixture Game of the Year 2026?',
    'Borealis', 'gaming',
    now() + interval '200 days', now() + interval '200 days',
    'UTC', now() + interval '202 days',
    'Sí si Borealis gana el premio.', 'No si no lo gana.',
    'Se aplica el resultado oficial.',
    jsonb_build_object('url', 'https://example.com/fixture-primary'),
    '[]'::jsonb, 'cancelled',
    admin_id, admin_id, second_candidate_id,
    jsonb_build_object(
      'radar_candidate_id', second_candidate_id,
      'event_group_key', 'kalshi:KXGAMEAWARDS-FIXTURE-' || suffix
    )
  ) returning id into legacy_draft_id;

  insert into private.market_drafts (
    market_slug, question, subject, category,
    evaluation_ends_at, closes_at, timezone, resolution_deadline,
    yes_criteria, no_criteria, edge_cases,
    primary_source, alternative_sources, workflow_status,
    created_by, updated_by, radar_candidate_id, source_provenance
  ) values (
    'radar-option-' || suffix,
    '¿Ganará Aurora el premio Fixture Game of the Year 2026?',
    'Aurora', 'gaming',
    now() + interval '200 days', now() + interval '200 days',
    'UTC', now() + interval '202 days',
    'Sí si Aurora gana el premio.', 'No si no lo gana.',
    'Se aplica el resultado oficial.',
    jsonb_build_object('url', 'https://example.com/fixture-primary'),
    '[]'::jsonb, 'human_confirmed',
    admin_id, admin_id, candidate_id,
    jsonb_build_object(
      'radar_candidate_id', candidate_id,
      'event_group_key', 'kalshi:KXGAMEAWARDS-FIXTURE-' || suffix
    )
  ) returning id into draft_id;
  select * into draft_row from private.market_drafts where id = draft_id;
  origin_projection := private.market_family_origin_projection_v1(
    null, draft_row.market_slug
  );
  if draft_row.family_key is distinct from candidate_row.family_key
     or draft_row.family_child_key is distinct from 'option:aurora'
     or origin_projection ->> 'family_child_key' is distinct from 'option:aurora'
     or origin_projection ->> 'family_key' is distinct from candidate_row.family_key then
    raise exception 'TEST_RADAR_DRAFT_MARKET_IDENTITY_NOT_PRESERVED: % / %',
      row_to_json(draft_row), origin_projection;
  end if;

  -- Un borrador cancelado que reutiliza el slug nunca suplanta al vigente.
  -- Dos intenciones todavía publicables con el mismo slug son ambiguas y la
  -- proyección debe detener la materialización en lugar de escoger por fecha.
  update private.market_drafts
  set workflow_status = 'human_confirmed', updated_at = now() + interval '1 minute'
  where id = legacy_draft_id;
  expected_failure := false;
  begin
    perform private.market_family_origin_projection_v1(null, draft_row.market_slug);
  exception when invalid_parameter_value then
    if sqlerrm = 'RADAR_FAMILY_ORIGIN_AMBIGUOUS' then expected_failure := true;
    else raise; end if;
  end;
  if not expected_failure then
    raise exception 'TEST_RADAR_ACTIVE_DRAFT_SLUG_AMBIGUITY_ACCEPTED';
  end if;
  update private.market_drafts
  set workflow_status = 'cancelled'
  where id = legacy_draft_id;

  insert into private.external_market_candidates (
    provider, external_id, external_event_id, fingerprint, normalizer_version,
    normalized_payload, quality_status, quality_score, fetched_at, expires_at,
    state, verification_status
  ) values (
    'polymarket', 'family-option-cross-' || suffix,
    'KXGAMEAWARDS-FIXTURE-' || suffix, 'family-option-cross-' || suffix,
    'atinara-radar-v2', jsonb_build_object(
      'source_question', '2026 Fixture Game of the Year?',
      'atinara_question', '2026 Fixture Game of the Year?',
      'source_title', query_value || ': 2026 Game of the Year',
      'source_resolution_rules',
        'Resolves Yes if Aurora wins 2026 Fixture Game of the Year before the end of 2026.',
      'source_close_at', to_jsonb(now() + interval '430 days'),
      'event_group_key', 'kalshi:KXGAMEAWARDS-FIXTURE-' || suffix,
      'provider_payload', jsonb_build_object(
        'yes_sub_title', 'Aurora', 'no_sub_title', 'Aurora'
      ),
      'hard_reject_reasons', '[]'::jsonb
    ),
    'fit', 85, now(), now() + interval '30 days',
    'available', 'verified_open'
  ) returning id into cross_provider_candidate_id;
  execute 'alter table private.external_market_candidates disable trigger a_assign_market_candidate_family_v4_before_write';
  update private.external_market_candidates
  set family_sort_at = now() + interval '210 days'
  where id = cross_provider_candidate_id;
  execute 'alter table private.external_market_candidates enable trigger a_assign_market_candidate_family_v4_before_write';
  select * into cross_provider_candidate_row
  from private.external_market_candidates where id = cross_provider_candidate_id;
  if cross_provider_candidate_row.family_key is distinct from candidate_row.family_key
     or cross_provider_candidate_row.family_child_key is distinct from 'option:aurora' then
    raise exception 'TEST_RADAR_CROSS_PROVIDER_IDENTITY_FAILED: %',
      row_to_json(cross_provider_candidate_row);
  end if;

  insert into private.market_radar_eligibility_checks (
    attempt_id, candidate_id, provider, external_id, event_group_key,
    policy_version, status, reason_code, reason, evidence,
    checked_at, expires_at, decision_hash
  ) values (
    gen_random_uuid(), cross_provider_candidate_id, 'polymarket',
    'family-option-cross-' || suffix, null,
    'atinara-prediction-policy-v5', 'eligible', null,
    'Fixture cross-provider elegible.', '[]'::jsonb,
    now(), now() + interval '6 hours', repeat('c', 64)
  ) returning id into cross_eligibility_id;
  update private.external_market_candidates
  set current_eligibility_check_id = cross_eligibility_id,
      eligibility_policy_version = 'atinara-prediction-policy-v5',
      eligibility_status = 'eligible',
      eligibility_checked_at = now(),
      eligibility_expires_at = now() + interval '6 hours',
      state = 'available', verification_status = 'verified_open',
      quality_status = 'fit'
  where id = cross_provider_candidate_id;

  update private.external_market_candidates
  set state = 'expired', expires_at = now() - interval '1 day'
  where id = candidate_id;
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', admin_id, 'role', 'authenticated')::text,
    true
  );
  execute 'set local role authenticated';
  list_result := public.list_market_radar_candidates_v2(
    null, null, 'all', query_value, 'closing', '365d', 20, 0
  );
  execute 'reset role';
  if jsonb_array_length(list_result) <> 1
     or list_result -> 0 ->> 'external_id' is distinct from second_external_id then
    raise exception 'TEST_RADAR_CROSS_PROVIDER_DRAFT_GATE_FAILED: %', list_result;
  end if;
end;
$test$;

rollback;
