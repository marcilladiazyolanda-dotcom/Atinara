-- Radar parent reconciliation v1. Todas las escrituras de prueba hacen rollback.

begin;

set local lock_timeout='5s';
set local statement_timeout='30s';
-- Producción usa la política estricta: cualquier colisión entre variables
-- PL/pgSQL y alias SQL debe fallar durante esta prueba transaccional.
set local plpgsql.variable_conflict='error';

do $test$
declare
  admin_id uuid:='11111111-1111-4111-8111-111111111111'::uuid;
  request_id_value uuid:=gen_random_uuid();
  process_request_id uuid:=gen_random_uuid();
  cutover_request_id uuid:=gen_random_uuid();
  incomplete_request_id uuid:=gen_random_uuid();
  legacy_partial_request_id uuid:=gen_random_uuid();
  rollback_request_id uuid:=gen_random_uuid();
  pagination_partial_request_id uuid:=gen_random_uuid();
  lkg_baseline_request_id uuid:=gen_random_uuid();
  lkg_active_request_id uuid:=gen_random_uuid();
  lease_owner_value uuid:=gen_random_uuid();
  lease_token_value uuid;
  started jsonb;
  response jsonb;
  replay jsonb;
  finalized jsonb;
  list_payload jsonb;
  process_started jsonb;
  process_lease uuid;
  cutover_lease uuid;
  incomplete_lease uuid;
  legacy_partial_lease uuid;
  rollback_lease uuid;
  pagination_partial_lease uuid;
  lkg_baseline_lease uuid;
  lkg_active_lease uuid;
  incomplete_parent jsonb;
  incomplete_issue jsonb;
  process_parent jsonb;
  legacy_partial_parent jsonb;
  pagination_partial_parent jsonb;
  pagination_partial_result jsonb;
  lkg_parent jsonb;
  lkg_entries jsonb;
  lkg_candidate jsonb;
  lkg_check jsonb;
  lkg_result jsonb;
  candidate_value jsonb;
  valid_candidate jsonb;
  invalid_candidate jsonb;
  eligibility_value jsonb;
  valid_eligibility jsonb;
  invalid_eligibility jsonb;
  process_result jsonb;
  save_result jsonb;
  save_replay jsonb;
  draft_payload jsonb;
  save_operation_id uuid:=gen_random_uuid();
  saved_draft_id uuid;
  reconciliations jsonb:='[]'::jsonb;
  children jsonb;
  child_value jsonb;
  provider_contract_value jsonb;
  provider_contract_canonical text;
  parent_value jsonb;
  parent_size integer;
  child_index integer;
  checked_at_value timestamptz:=date_trunc('second',clock_timestamp());
  before_economic jsonb;
  after_economic jsonb;
  expected_failure boolean;
  count_value integer;
begin
  if to_regclass('private.market_radar_parent_reconciliations_v1') is null
     or to_regclass('private.market_radar_parent_children_v1') is null
     or to_regprocedure('public.record_market_radar_parent_reconciliations_v1(uuid,text,text,uuid,jsonb)') is null
     or to_regprocedure('public.process_market_radar_refresh_batch_v2(uuid,text,text,uuid)') is null
     or to_regprocedure('public.process_market_radar_refresh_batch_v3(uuid,text,text,uuid)') is null
     or to_regprocedure('public.record_market_radar_provider_selection_v1(uuid,text,text,uuid,jsonb)') is null
     or to_regprocedure('public.get_market_radar_children_for_reconciliation_v3(text,text[],text[],text[],text[],text[],text[],uuid)') is null
     or to_regprocedure('private.market_radar_legacy_child_logical_key_v1(jsonb,text)') is null
     or to_regprocedure('private.market_radar_legacy_candidate_logical_key_v1(text,jsonb,text)') is null
     or to_regprocedure('public.list_market_radar_parent_reconciliations_v2(text,text,text,text,integer,integer)') is null
     or to_regprocedure('public.list_market_radar_candidates_v2(text,text,text,text,text,text,integer,integer)') is null
     or to_regprocedure('public.finalize_market_radar_refresh_v4(uuid,text,text,uuid,text,text,text,integer)') is null
     or to_regprocedure('public.finalize_market_radar_refresh_v5(uuid,text,text,uuid,text,text,text,integer)') is null
     or to_regprocedure('public.complete_market_radar_candidate_refresh_v1(uuid,text,text,uuid,text,text,text,integer)') is null
     or to_regprocedure('public.complete_market_radar_candidate_refresh_v2(uuid,text,text,uuid,text,text,text,integer)') is null
     or to_regprocedure('public.apply_market_radar_prepare_eligibility_v4(uuid,bigint,text,timestamptz,jsonb,jsonb,jsonb,boolean)') is null
     or to_regprocedure('public.get_market_radar_candidate_for_draft_revalidation_v3(uuid,uuid,bigint,text)') is null
     or to_regprocedure('public.begin_market_draft_review_v3(uuid,bigint,uuid,text,text,text,boolean)') is null
     or to_regprocedure('public.confirm_market_draft_review_v3(uuid,bigint)') is null
     or to_regprocedure('public.save_market_draft_from_expert_with_issues_v2(uuid,uuid,jsonb)') is null
     or to_regprocedure('public.save_market_draft_from_radar(uuid,uuid,bigint,jsonb)') is null
     or to_regprocedure('public.save_market_draft_from_radar_intelligence(uuid,uuid,bigint,jsonb,uuid,jsonb,jsonb)') is null
     or to_regprocedure('public.bind_market_radar_draft_eligibility_v2(uuid,uuid,bigint,text,bigint,bigint,uuid,uuid)') is null
     or to_regprocedure('public.get_market_radar_eligibility_attempt_checkpoint_v1(uuid,uuid)') is null
     or to_regprocedure('public.recover_market_draft_radar_eligibility_v1(uuid,bigint,text,uuid,uuid,uuid)') is null
     or to_regprocedure('public.publish_market_draft_v2(uuid,bigint,timestamptz,uuid)') is null
     or to_regprocedure('public.publish_due_market_drafts_v2(integer)') is null then
    raise exception 'TEST_RADAR_PARENT_RECONCILIATION_SCHEMA_MISSING';
  end if;
  if exists(
    select 1 from pg_catalog.pg_proc procedure
    join pg_catalog.pg_roles role_alias on role_alias.oid=procedure.proowner
    where procedure.oid in (
      'public.record_market_radar_parent_reconciliations_v1(uuid,text,text,uuid,jsonb)'::regprocedure::oid,
      'public.get_market_radar_parent_children_for_reconciliation_v1(text,text[])'::regprocedure::oid,
      'public.get_market_radar_children_for_reconciliation_v3(text,text[],text[],text[],text[],text[],text[],uuid)'::regprocedure::oid,
      'public.record_market_radar_provider_selection_v1(uuid,text,text,uuid,jsonb)'::regprocedure::oid,
      'public.process_market_radar_refresh_batch_v2(uuid,text,text,uuid)'::regprocedure::oid,
      'public.process_market_radar_refresh_batch_v3(uuid,text,text,uuid)'::regprocedure::oid,
      'public.finalize_market_radar_refresh_v4(uuid,text,text,uuid,text,text,text,integer)'::regprocedure::oid,
      'public.finalize_market_radar_refresh_v5(uuid,text,text,uuid,text,text,text,integer)'::regprocedure::oid,
      'public.complete_market_radar_candidate_refresh_v1(uuid,text,text,uuid,text,text,text,integer)'::regprocedure::oid,
      'public.complete_market_radar_candidate_refresh_v2(uuid,text,text,uuid,text,text,text,integer)'::regprocedure::oid,
      'public.apply_market_radar_prepare_eligibility_v4(uuid,bigint,text,timestamptz,jsonb,jsonb,jsonb,boolean)'::regprocedure::oid,
      'public.get_market_radar_candidate_for_draft_revalidation_v3(uuid,uuid,bigint,text)'::regprocedure::oid,
      'public.begin_market_draft_review_v3(uuid,bigint,uuid,text,text,text,boolean)'::regprocedure::oid,
      'public.confirm_market_draft_review_v3(uuid,bigint)'::regprocedure::oid,
      'public.save_market_draft_from_expert_with_issues_v2(uuid,uuid,jsonb)'::regprocedure::oid,
      'public.save_market_draft_from_radar(uuid,uuid,bigint,jsonb)'::regprocedure::oid,
      'public.save_market_draft_from_radar_intelligence(uuid,uuid,bigint,jsonb,uuid,jsonb,jsonb)'::regprocedure::oid,
      'public.bind_market_radar_draft_eligibility_v2(uuid,uuid,bigint,text,bigint,bigint,uuid,uuid)'::regprocedure::oid,
      'public.get_market_radar_eligibility_attempt_checkpoint_v1(uuid,uuid)'::regprocedure::oid,
      'public.recover_market_draft_radar_eligibility_v1(uuid,bigint,text,uuid,uuid,uuid)'::regprocedure::oid,
      'public.publish_market_draft_v2(uuid,bigint,timestamptz,uuid)'::regprocedure::oid,
      'public.publish_due_market_drafts_v2(integer)'::regprocedure::oid,
      'public.list_market_radar_candidates_v4(text,text,text,text,text,text,integer,integer)'::regprocedure::oid,
      'public.list_market_radar_candidates_v2(text,text,text,text,text,text,integer,integer)'::regprocedure::oid,
      'public.list_market_radar_rejections_v2(text,text,integer,integer)'::regprocedure::oid
      ,'public.list_market_radar_parent_reconciliations_v2(text,text,text,text,integer,integer)'::regprocedure::oid
    ) and (role_alias.rolname<>'postgres' or not procedure.prosecdef
      or not (procedure.proconfig@>array['search_path=""']::text[]))
  ) then raise exception 'TEST_RADAR_PARENT_RECONCILIATION_FUNCTION_SECURITY_INVALID'; end if;
  if has_table_privilege('anon','private.market_radar_parent_reconciliations_v1','select')
     or has_table_privilege('authenticated','private.market_radar_parent_reconciliations_v1','select')
     or has_table_privilege('service_role','private.market_radar_parent_reconciliations_v1','select')
     or has_table_privilege('anon','private.market_radar_parent_children_v1','select')
     or has_table_privilege('authenticated','private.market_radar_parent_children_v1','select')
     or has_table_privilege('service_role','private.market_radar_parent_children_v1','select')
     or has_function_privilege('authenticated',
       'public.record_market_radar_parent_reconciliations_v1(uuid,text,text,uuid,jsonb)','execute')
     or not has_function_privilege('service_role',
       'public.record_market_radar_parent_reconciliations_v1(uuid,text,text,uuid,jsonb)','execute')
     or has_function_privilege('anon',
       'public.list_market_radar_parent_reconciliations_v1(text,text,text,integer,integer)','execute')
     or not has_function_privilege('authenticated',
       'public.list_market_radar_parent_reconciliations_v1(text,text,text,integer,integer)','execute')
     or not has_function_privilege('authenticated',
       'public.list_market_radar_parent_reconciliations_v2(text,text,text,text,integer,integer)','execute')
     or not has_function_privilege('authenticated',
       'public.list_market_radar_candidates_v2(text,text,text,text,text,text,integer,integer)','execute')
     or has_function_privilege('service_role',
       'public.apply_market_radar_prepare_eligibility_v2(uuid,bigint,text,timestamptz,jsonb,jsonb,boolean)','execute')
     or has_function_privilege('service_role',
       'public.process_market_radar_refresh_batch_v2(uuid,text,text,uuid)','execute')
     or has_function_privilege('anon',
       'public.process_market_radar_refresh_batch_v3(uuid,text,text,uuid)','execute')
     or has_function_privilege('authenticated',
       'public.process_market_radar_refresh_batch_v3(uuid,text,text,uuid)','execute')
     or not has_function_privilege('service_role',
       'public.process_market_radar_refresh_batch_v3(uuid,text,text,uuid)','execute')
     or has_function_privilege('anon',
       'public.complete_market_radar_candidate_refresh_v2(uuid,text,text,uuid,text,text,text,integer)','execute')
     or has_function_privilege('authenticated',
       'public.complete_market_radar_candidate_refresh_v2(uuid,text,text,uuid,text,text,text,integer)','execute')
     or not has_function_privilege('service_role',
       'public.complete_market_radar_candidate_refresh_v2(uuid,text,text,uuid,text,text,text,integer)','execute')
     or has_function_privilege('service_role',
       'public.finalize_market_radar_refresh_v3(uuid,text,text,uuid,text,text,text,integer)','execute')
     or has_function_privilege('service_role',
       'public.finalize_market_radar_refresh_v4(uuid,text,text,uuid,text,text,text,integer)','execute')
     or not has_function_privilege('service_role',
       'public.finalize_market_radar_refresh_v5(uuid,text,text,uuid,text,text,text,integer)','execute')
     or has_function_privilege('service_role',
       'public.apply_market_radar_prepare_eligibility_v3(uuid,bigint,text,timestamptz,jsonb,jsonb,jsonb,boolean)','execute')
     or not has_function_privilege('service_role',
       'public.apply_market_radar_prepare_eligibility_v4(uuid,bigint,text,timestamptz,jsonb,jsonb,jsonb,boolean)','execute')
     or has_function_privilege('service_role',
       'public.get_market_radar_candidate_for_draft_revalidation_v2(uuid,uuid,bigint,text)','execute')
     or not has_function_privilege('service_role',
       'public.get_market_radar_candidate_for_draft_revalidation_v3(uuid,uuid,bigint,text)','execute')
     or has_function_privilege('authenticated',
       'public.begin_market_draft_review_v2(uuid,bigint,uuid,text,text,text,boolean)','execute')
     or not has_function_privilege('authenticated',
       'public.begin_market_draft_review_v3(uuid,bigint,uuid,text,text,text,boolean)','execute')
     or has_function_privilege('authenticated',
       'public.confirm_market_draft_review_v2(uuid,bigint)','execute')
     or not has_function_privilege('authenticated',
       'public.confirm_market_draft_review_v3(uuid,bigint)','execute')
     or not has_function_privilege('authenticated',
       'public.save_market_draft_from_expert_with_issues_v2(uuid,uuid,jsonb)','execute')
     or not has_function_privilege('authenticated',
       'public.save_market_draft_from_radar(uuid,uuid,bigint,jsonb)','execute')
     or not has_function_privilege('authenticated',
       'public.save_market_draft_from_radar_intelligence(uuid,uuid,bigint,jsonb,uuid,jsonb,jsonb)','execute')
     or not has_function_privilege('authenticated',
       'public.publish_market_draft_v2(uuid,bigint,timestamptz,uuid)','execute')
     or not has_function_privilege('service_role',
       'public.bind_market_radar_draft_eligibility_v2(uuid,uuid,bigint,text,bigint,bigint,uuid,uuid)','execute')
     or not has_function_privilege('service_role',
       'public.get_market_radar_eligibility_attempt_checkpoint_v1(uuid,uuid)','execute')
     or not has_function_privilege('service_role',
       'public.recover_market_draft_radar_eligibility_v1(uuid,bigint,text,uuid,uuid,uuid)','execute')
     or not has_function_privilege('service_role',
       'public.publish_due_market_drafts_v2(integer)','execute') then
    raise exception 'TEST_RADAR_PARENT_RECONCILIATION_ACL_INVALID';
  end if;
  if has_function_privilege('anon',
       'private.market_radar_legacy_child_logical_key_v1(jsonb,text)','execute')
     or has_function_privilege('authenticated',
       'private.market_radar_legacy_child_logical_key_v1(jsonb,text)','execute')
     or has_function_privilege('service_role',
       'private.market_radar_legacy_child_logical_key_v1(jsonb,text)','execute')
     or has_function_privilege('anon',
       'private.market_radar_legacy_candidate_logical_key_v1(text,jsonb,text)','execute')
     or has_function_privilege('authenticated',
       'private.market_radar_legacy_candidate_logical_key_v1(text,jsonb,text)','execute')
     or has_function_privilege('service_role',
       'private.market_radar_legacy_candidate_logical_key_v1(text,jsonb,text)','execute') then
    raise exception 'TEST_RADAR_LEGACY_LOGICAL_KEY_ACL_INVALID';
  end if;
  if not exists(
    select 1 from pg_catalog.pg_class relation
    join pg_catalog.pg_namespace namespace on namespace.oid=relation.relnamespace
    where namespace.nspname='private'
      and relation.relname in (
        'market_radar_parent_reconciliations_v1','market_radar_parent_children_v1'
      ) and relation.relrowsecurity and relation.relforcerowsecurity
    group by namespace.nspname having count(*)=2
  ) then raise exception 'TEST_RADAR_PARENT_RECONCILIATION_RLS_INVALID'; end if;
  if to_regclass('private.market_drafts_active_radar_origin_v1_uidx') is null
     or not exists (
       select 1 from pg_catalog.pg_constraint constraint_row
       where constraint_row.conrelid='private.market_radar_refresh_intents_v1'::regclass
         and pg_catalog.pg_get_constraintdef(constraint_row.oid) like '%131072%'
     ) then
    raise exception 'TEST_RADAR_PARENT_RECONCILIATION_LIMIT_OR_ORIGIN_INDEX_MISSING';
  end if;
  if not private.market_candidate_has_blocking_duplicate(jsonb_build_array(
       jsonb_build_object('id',gen_random_uuid(),'relationship','exact_duplicate',
         'blocking',true,'family_version','atinara-market-family-v5')
     ),null)
     or jsonb_array_length(private.market_candidate_sibling_matches(jsonb_build_array(
       jsonb_build_object('id',gen_random_uuid(),'relationship','sibling','blocking',false,
         'family_version','atinara-market-family-v5','family_child_key','option:sibling')
     ),null))<>1 then
    raise exception 'TEST_RADAR_PARENT_RECONCILIATION_V5_DUPLICATE_HELPERS_INVALID';
  end if;
  if private.market_radar_legacy_candidate_logical_key_v1(
       '2295650','{}'::jsonb,'polymarket'
     ) is distinct from private.market_radar_legacy_candidate_logical_key_v1(
       'polymarket:2295650',jsonb_build_object(
         'external_market_id','2295650','provider_payload',jsonb_build_object(
           'condition_id','condition-2295650'
         )
       ),'polymarket'
     )
     or private.market_radar_legacy_child_logical_key_v1(jsonb_build_object(
       'external_market_id','2295650','child_occurrence_key','legacy:old'
     ),'polymarket')<>'polymarket:market:2295650'
     or private.market_radar_legacy_child_logical_key_v1(jsonb_build_object(
       'external_market_id','2295651','child_occurrence_key','legacy:other'
     ),'polymarket')='polymarket:market:2295650' then
    raise exception 'TEST_RADAR_LEGACY_LOGICAL_KEY_INVALID';
  end if;
  if private.market_family_option_slug_v2('Marathon',120)<>'marathon'
     or private.market_family_option_slug_v2('A 星 B',120)
       =private.market_family_option_slug_v2('A B 星',120)
     or private.market_family_option_slug_v2('José',120)
       =private.market_family_option_slug_v2('Jose',120)
     or private.market_family_option_slug_v2('Tom Clancy’s',120)
       <>private.market_family_option_slug_v2('Tom Clancy''s',120)
     or private.market_family_option_slug_v2('E–Day',120)
       <>private.market_family_option_slug_v2('E-Day',120) then
    raise exception 'TEST_RADAR_PARENT_RECONCILIATION_V5_SLUG_INVALID';
  end if;
  if not private.market_family_text_contains_label_v2(
       '¿Ganará Gears of War: E-Day el premio?','Gears of War: E-Day'
     )
     or not private.market_family_text_contains_label_v2(
       'Sí si Tom Clancy’s The Division 3 gana.','Tom Clancy''s The Division 3'
     )
     or not private.market_family_text_contains_label_v2(
       '¿Ganará 東京ゲーム el premio?','東京ゲーム'
     )
     or private.market_family_text_contains_label_v2(
       '¿Ganará Game s End el premio?','Game''s End'
     ) then
    raise exception 'TEST_RADAR_PARENT_RECONCILIATION_V5_TEXT_IDENTITY_INVALID';
  end if;
  if private.market_workflow_issue_deterministic_v1(jsonb_build_object(
       'issue_code','RADAR_ELIGIBILITY_REQUIRED','fingerprint',repeat('a',64)
     )) ->> 'issue_id'<>'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
     or private.market_workflow_issue_array_replace_v1(
       jsonb_build_array(jsonb_build_object(
         'issue_id','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','issue_code','RADAR_ELIGIBILITY_REQUIRED',
         'fingerprint',repeat('a',64),'created_at','2026-08-23T00:00:00Z'
       )),jsonb_build_object(
         'issue_id',gen_random_uuid(),'issue_code','RADAR_ELIGIBILITY_REQUIRED',
         'fingerprint',repeat('a',64),'created_at',clock_timestamp()
       )
     ) #>> '{0,created_at}'<>'2026-08-23T00:00:00Z' then
    raise exception 'TEST_RADAR_DETERMINISTIC_ISSUE_IDENTITY_INVALID';
  end if;

  select jsonb_build_object(
    'markets',(select coalesce(md5(string_agg(md5(to_jsonb(value)::text),'' order by to_jsonb(value)::text)),md5('')) from public.markets value),
    'predictions',(select coalesce(md5(string_agg(md5(to_jsonb(value)::text),'' order by to_jsonb(value)::text)),md5('')) from public.predictions value),
    'profiles',(select coalesce(md5(string_agg(md5(to_jsonb(value)::text),'' order by to_jsonb(value)::text)),md5('')) from public.profiles value),
    'maker',(select coalesce(md5(string_agg(md5(to_jsonb(value)::text),'' order by to_jsonb(value)::text)),md5('')) from public.market_maker_state value),
    'prices',(select coalesce(md5(string_agg(md5(to_jsonb(value)::text),'' order by to_jsonb(value)::text)),md5('')) from public.market_price_history value)
  ) into before_economic;

  perform set_config('request.jwt.claims',jsonb_build_object(
    'sub',admin_id,'role','authenticated'
  )::text,true);
  perform public.claim_market_radar_provider_probe_v1('polymarket','candidate_feed',request_id_value);
  started:=public.begin_market_radar_refresh_v2(
    request_id_value,'polymarket','candidate_feed',repeat('a',64),
    'atinara-radar-v3:test-parent-reconciliation','atinara-radar-v3',
    'atinara-prediction-policy-v5',lease_owner_value
  );
  if not coalesce((started ->> 'started')::boolean,false) then
    raise exception 'TEST_RADAR_PARENT_RECONCILIATION_INTENT_NOT_STARTED:%',started;
  end if;
  lease_token_value:=(started ->> 'lease_token')::uuid;

  foreach parent_size in array array[1,3,21,48,101]
  loop
    children:='[]'::jsonb;
    for child_index in 1..parent_size loop
      provider_contract_value:=jsonb_build_object(
        'contract_version','atinara-radar-provider-child-contract-v1',
        'provider','polymarket','provider_parent_id','parent-'||parent_size,
        'external_market_id',parent_size||'-'||child_index,
        'condition_id','condition-'||parent_size||'-'||child_index,
        'token_ids','[]'::jsonb,'child_slug','option-'||child_index,
        'event_slug','parent-'||parent_size,
        'external_event_url','https://polymarket.com/event/parent-'||parent_size,
        'external_market_url','https://polymarket.com/event/parent-'||parent_size,
        'source_title','Parent '||parent_size,
        'source_question','Will Option '||child_index||' win Parent '||parent_size||'?',
        'source_description',null,'source_resolution_rules','Official result.',
        'source_resolution_url','https://thegameawards.com/official-parent-'||parent_size,
        'source_close_at','2027-01-01T00:00:00.000Z',
        'source_resolution_deadline','2027-01-02T00:00:00.000Z',
        'source_status','open','source_result',null,
        'raw_provider_child_label','Option '||child_index
      );
      provider_contract_canonical:=private.market_workflow_canonical_json_v1(
        jsonb_build_object(
          'contract_version',provider_contract_value -> 'contract_version',
          'provider',provider_contract_value -> 'provider',
          'source_question',provider_contract_value -> 'source_question',
          'source_description',provider_contract_value -> 'source_description',
          'source_resolution_rules',provider_contract_value -> 'source_resolution_rules',
          'source_resolution_url',provider_contract_value -> 'source_resolution_url',
          'source_close_at',provider_contract_value -> 'source_close_at',
          'source_resolution_deadline',provider_contract_value -> 'source_resolution_deadline'
        )
      );
      child_value:=jsonb_build_object(
        'child_occurrence_key','polymarket:'||parent_size||':'||child_index,
        'provider_child_identity_key','polymarket:market:'||parent_size||'-'||child_index,
        'external_market_id',parent_size||'-'||child_index,
        'condition_id','condition-'||parent_size||'-'||child_index,
        'identity_kind','option',
        'token_ids','[]'::jsonb,'child_slug','option-'||child_index,
        'event_id','parent-'||parent_size,'event_slug','parent-'||parent_size,
        'raw_provider_child_label','Option '||child_index,
        'canonical_child_label','Option '||child_index,
        'canonical_child_slug','option-'||child_index,
        'canonical_child_key','option:option-'||child_index,
        'identity_classification','identified_real_option','identity_status','resolved',
        'availability_status','open','identity_source','provider_contract_question',
        'identity_confidence',100,'identity_evidence',jsonb_build_array(jsonb_build_object(
          'url','https://gamma-api.polymarket.com/events/parent-'||parent_size,
          'endpoint','/events/parent-'||parent_size,'identifier_type','external_market_id',
          'identifier',parent_size||'-'||child_index,'result','child_identity_observed_in_parent',
          'content_sha256',repeat('1',64),'identity_sha256',repeat('2',64),
          'checked_at',checked_at_value
        )),
        'present_in_current_snapshot',true,'present_in_legacy_snapshot',false,
        'transition','new','duplicate_of_child_identity_key',null,
        'provider_contract',provider_contract_value,
        'provider_contract_canonical_json',provider_contract_canonical,
        'provider_contract_hash',encode(extensions.digest(
          convert_to(provider_contract_canonical,'UTF8'),'sha256'
        ),'hex'),
        'projection_version','atinara-radar-child-projection-v1',
        'child_fingerprint',encode(extensions.digest(convert_to(
          'parent-'||parent_size||':child-'||child_index,'UTF8'
        ),'sha256'),'hex'),'checked_at',checked_at_value
      );
      children:=children||jsonb_build_array(child_value);
    end loop;
    parent_value:=jsonb_build_object(
      'provider','polymarket','provider_parent_id','parent-'||parent_size,
      'raw_provider_parent_label','Parent '||parent_size,
      'canonical_parent_label','Padre '||parent_size,
      'raw_provider_category','Events','atinara_category','Eventos','category','Eventos',
      'external_parent_url','https://polymarket.com/event/parent-'||parent_size,
      'provider_declared_child_count',parent_size,
      'provider_discovered_child_count',parent_size,
      'provider_accounted_child_count',parent_size,
      'provider_identified_child_count',parent_size,
      'provider_unresolved_child_count',0,'provider_removed_child_count',0,
      'provider_closed_child_count',0,'provider_duplicate_child_count',0,
      'provider_conflict_child_count',0,'legacy_expected_child_count',null,
      'legacy_accounted_child_count',null,'new_child_count',parent_size,
      'provider_pagination_exhausted',true,'reconciliation_status','complete',
      'reconciliation_version','atinara-radar-parent-reconciliation-v1',
      'normalizer_version','atinara-radar-v3','family_version','atinara-market-family-v5',
      'reconciliation_fingerprint',encode(extensions.digest(convert_to(
        'parent-'||parent_size||':complete','UTF8'
      ),'sha256'),'hex'),'checked_at',checked_at_value,
      'next_retry_at',null,'source_refs',jsonb_build_array(jsonb_build_object(
        'url','https://gamma-api.polymarket.com/events/parent-'||parent_size,
        'endpoint','/events/parent-'||parent_size,'identifier_type','event_id',
        'identifier','parent-'||parent_size,'result','parent_children_enumerated',
        'content_sha256',repeat('3',64),'identity_sha256',repeat('4',64),
        'checked_at',checked_at_value
      )),'issue',null,'children',children
    );
    reconciliations:=reconciliations||jsonb_build_array(parent_value);
  end loop;

  perform set_config('request.jwt.claims','{"role":"service_role"}',true);
  expected_failure:=false;
  begin
    perform public.record_market_radar_provider_selection_v1(
      request_id_value,'polymarket','candidate_feed',lease_token_value,
      jsonb_build_object(
        'policy_version','atinara-radar-parent-selection-v1','total_parent_count',2,
        'selected_parent_count',1,'deferred_parent_count',1,'selected_child_count',1,
        'no_parent_truncated',true,'selected_parent_ids',jsonb_build_array('parent-1'),
        'deferred_parent_ids',jsonb_build_array('parent-1')
      )
    );
  exception when sqlstate '22023' then expected_failure:=true;
  end;
  if not expected_failure then
    raise exception 'TEST_RADAR_PROVIDER_SELECTION_OVERLAP_ACCEPTED';
  end if;
  perform public.record_market_radar_provider_selection_v1(
    request_id_value,'polymarket','candidate_feed',lease_token_value,
    jsonb_build_object(
      'policy_version','atinara-radar-parent-selection-v1','total_parent_count',5,
      'selected_parent_count',5,'deferred_parent_count',0,'selected_child_count',174,
      'no_parent_truncated',true,
      'selected_parent_ids',jsonb_build_array('parent-1','parent-3','parent-21','parent-48','parent-101'),
      'deferred_parent_ids','[]'::jsonb
    )
  );
  -- Cada padre es un checkpoint transaccional independiente. Los tamaños
  -- 1/3/21/48/101 cubren familias pequeñas, medianas y de 100+ hijas.
  for child_index in 0..4 loop
    response:=public.record_market_radar_parent_reconciliations_v1(
      request_id_value,'polymarket','candidate_feed',lease_token_value,
      jsonb_build_array(reconciliations -> child_index)
    );
    select count(*) into count_value
    from private.market_radar_parent_reconciliations_v1
    where request_id=request_id_value and provider='polymarket';
    if response ->> 'provider_parent_count'<>'5'
       or (response ->> 'reconciled_parent_count')::integer<>count_value
       or (child_index<4 and (
         response ->> 'complete'<>'false'
         or response ->> 'parent_manifest_hash' is not null
         or (select parent_manifest_hash from private.market_radar_refresh_intents_v1
           where request_id=request_id_value and provider='polymarket') is not null
         or (select provider_pagination_exhausted from private.market_radar_refresh_intents_v1
           where request_id=request_id_value and provider='polymarket') is not false
       )) or (child_index=4 and (
         response ->> 'complete'<>'true'
         or coalesce(response ->> 'parent_manifest_hash','')!~'^[a-f0-9]{64}$'
       )) then
      raise exception 'TEST_RADAR_PARENT_CHECKPOINT_INVALID:%:%',child_index,response;
    end if;

    -- Un checkpoint ajeno a la selección falla sin borrar el ya confirmado.
    if child_index=0 then
      expected_failure:=false;
      begin
        perform public.record_market_radar_parent_reconciliations_v1(
          request_id_value,'polymarket','candidate_feed',lease_token_value,
          jsonb_build_array(jsonb_set(
            reconciliations -> 1,'{provider_parent_id}',to_jsonb('parent-not-selected'::text)
          ))
        );
      exception when sqlstate '22023' then expected_failure:=true;
      end;
      select count(*) into count_value
      from private.market_radar_parent_reconciliations_v1
      where request_id=request_id_value and provider='polymarket';
      if not expected_failure or count_value<>1 then
        raise exception 'TEST_RADAR_PARENT_CHECKPOINT_ROLLBACK_INVALID:%',count_value;
      end if;
    end if;
  end loop;
  replay:=public.record_market_radar_parent_reconciliations_v1(
    request_id_value,'polymarket','candidate_feed',lease_token_value,reconciliations
  );
  if response ->> 'parent_manifest_hash' is distinct from replay ->> 'parent_manifest_hash'
     or replay ->> 'complete'<>'true'
     or (response ->> 'provider_parent_count')::integer<>5 then
    raise exception 'TEST_RADAR_PARENT_RECONCILIATION_REPLAY_INVALID:%:%',response,replay;
  end if;
  select count(*) into count_value
  from private.market_radar_parent_reconciliations_v1
  where request_id=request_id_value and provider='polymarket';
  if count_value<>5 then raise exception 'TEST_RADAR_PARENT_RECONCILIATION_PARENT_COUNT:%',count_value; end if;
  select count(*) into count_value
  from private.market_radar_parent_children_v1 child
  join private.market_radar_parent_reconciliations_v1 parent_alias
    on parent_alias.id=child.parent_reconciliation_id
  where parent_alias.request_id=request_id_value and parent_alias.provider='polymarket';
  if count_value<>174 then raise exception 'TEST_RADAR_PARENT_RECONCILIATION_CHILD_COUNT:%',count_value; end if;

  expected_failure:=false;
  begin
    perform public.record_market_radar_parent_reconciliations_v1(
      request_id_value,'polymarket','candidate_feed',lease_token_value,
      jsonb_set(reconciliations,'{0,reconciliation_fingerprint}',to_jsonb(repeat('f',64)))
    );
  exception when serialization_failure then expected_failure:=true;
  end;
  if not expected_failure then
    raise exception 'TEST_RADAR_PARENT_RECONCILIATION_CONFLICT_ACCEPTED';
  end if;

  perform public.declare_market_radar_refresh_manifest_v1(
    request_id_value,'polymarket','candidate_feed',lease_token_value,0
  );
  perform public.seal_market_radar_refresh_v1(
    request_id_value,'polymarket','candidate_feed',lease_token_value,0
  );
  finalized:=public.complete_market_radar_candidate_refresh_v1(
    request_id_value,'polymarket','candidate_feed',lease_token_value,
    'available',null,null,null
  );
  if finalized ->> 'outcome'<>'completed'
     or finalized #>> '{provider_selection,selected_parent_count}' is distinct from '5' then
    raise exception 'TEST_RADAR_PARENT_RECONCILIATION_FINALIZE_INVALID:%',finalized;
  end if;
  replay:=public.complete_market_radar_candidate_refresh_v1(
    request_id_value,'polymarket','candidate_feed',lease_token_value,
    'available',null,null,null
  );
  if replay ->> 'replayed'<>'true'
     or replay ->> 'atomic_candidate_commit'<>'true'
     or replay #>> '{provider_selection,selected_parent_count}' is distinct from '5' then
    raise exception 'TEST_RADAR_PARENT_RECONCILIATION_FINALIZE_REPLAY_INVALID:%',replay;
  end if;
  if not exists (
    select 1 from public.get_market_radar_children_for_reconciliation_v3(
      'polymarket',array['parent-3']::text[],array[]::text[],
      array['condition-1-1']::text[],array[]::text[],array[]::text[],
      array[]::text[],null
    ) item
    where item ->> 'provider_parent_id'='parent-1'
      and item ->> 'external_market_id'='1-1'
  ) then
    raise exception 'TEST_RADAR_HISTORY_V3_CONDITION_ALIAS_MISSING';
  end if;

  perform set_config('request.jwt.claims',jsonb_build_object(
    'sub',admin_id,'role','authenticated'
  )::text,true);
  list_payload:=public.list_market_radar_parent_reconciliations_v2(
    'polymarket','Eventos',null,'365d',2,0
  );
  if (list_payload ->> 'total')::integer<>5
     or jsonb_array_length(list_payload -> 'items')<>2
     or list_payload ->> 'next_offset'<>'2'
     or list_payload ->> 'snapshot_available'<>'true' then
    raise exception 'TEST_RADAR_PARENT_RECONCILIATION_LIST_INVALID:%',list_payload;
  end if;

  expected_failure:=false;
  begin
    update private.market_radar_parent_reconciliations_v1 set category='Industria'
    where request_id=request_id_value;
  exception when sqlstate '55000' then expected_failure:=true;
  end;
  if not expected_failure then
    raise exception 'TEST_RADAR_PARENT_RECONCILIATION_APPEND_ONLY_BYPASSED';
  end if;

  perform public.claim_market_radar_provider_probe_v1(
    'polymarket','candidate_feed',process_request_id
  );
  perform set_config('request.jwt.claims',jsonb_build_object(
    'sub',admin_id,'role','authenticated'
  )::text,true);
  process_started:=public.begin_market_radar_refresh_v2(
    process_request_id,'polymarket','candidate_feed',repeat('b',64),
    'atinara-radar-v3:test-parent-process','atinara-radar-v3',
    'atinara-prediction-policy-v5',gen_random_uuid()
  );
  process_lease:=(process_started ->> 'lease_token')::uuid;
  process_parent:=reconciliations -> 0;
  -- Este segundo refresh del mismo padre debe acreditar exhaustivamente el
  -- ledger V3 ya finalizado; no puede reutilizar el fixture de primera captura
  -- como si la hija nunca hubiese existido.
  child_value:=(process_parent #> '{children,0}')||jsonb_build_object(
    'present_in_legacy_snapshot',true,'transition','same',
    'child_fingerprint',encode(extensions.digest(convert_to(
      'parent-1:child-1:followup','UTF8'
    ),'sha256'),'hex')
  );
  process_parent:=process_parent||jsonb_build_object(
    'legacy_expected_child_count',1,'legacy_accounted_child_count',1,
    'new_child_count',0,
    'reconciliation_fingerprint',encode(extensions.digest(convert_to(
      'parent-1:complete:followup','UTF8'
    ),'sha256'),'hex'),
    'children',jsonb_build_array(child_value)
  );
  perform set_config('request.jwt.claims','{"role":"service_role"}',true);
  perform public.record_market_radar_provider_selection_v1(
    process_request_id,'polymarket','candidate_feed',process_lease,
    jsonb_build_object(
      'policy_version','atinara-radar-parent-selection-v1','total_parent_count',1,
      'selected_parent_count',1,'deferred_parent_count',0,'selected_child_count',1,
      'no_parent_truncated',true,'selected_parent_ids',jsonb_build_array('parent-1'),
      'deferred_parent_ids','[]'::jsonb
    )
  );
  expected_failure:=false;
  begin
    perform public.record_market_radar_parent_reconciliations_v1(
      process_request_id,'polymarket','candidate_feed',process_lease,
      jsonb_build_array(jsonb_set(process_parent,'{children}',jsonb_build_array(
        (process_parent #> '{children,0}')||jsonb_build_object(
          'identity_source',null,'identity_confidence',0
        )
      )))
    );
  exception when sqlstate '22023' then expected_failure:=true;
  end;
  if not expected_failure then
    raise exception 'TEST_RADAR_RESOLVED_IDENTITY_WITHOUT_SOURCE_ACCEPTED';
  end if;
  expected_failure:=false;
  begin
    perform public.record_market_radar_parent_reconciliations_v1(
      process_request_id,'polymarket','candidate_feed',process_lease,
      jsonb_build_array(process_parent
        -'legacy_expected_child_count'-'legacy_accounted_child_count')
    );
  exception when sqlstate '22023' then expected_failure:=true;
  end;
  if not expected_failure then
    raise exception 'TEST_RADAR_KNOWN_LEGACY_BASELINE_OMISSION_ACCEPTED';
  end if;
  perform public.record_market_radar_parent_reconciliations_v1(
    process_request_id,'polymarket','candidate_feed',process_lease,
    jsonb_build_array(process_parent)
  );
  candidate_value:=jsonb_build_object(
    'provider','polymarket','external_id','1-1','external_event_id','parent-1',
    'external_market_id','1-1','external_event_slug','parent-1','external_market_slug','option-1',
    'external_url','https://polymarket.com/event/parent-1',
    'external_event_url','https://polymarket.com/event/parent-1',
    'external_market_url','https://polymarket.com/event/parent-1',
    'event_group_key','polymarket:parent-1','fingerprint','r55555555',
    'cache_key','atinara-radar-v3:test-parent-process','normalizer_version','atinara-radar-v3',
    'family_version','atinara-market-family-v5','family_key','atinara:v5:parent-1:outcome',
    'family_title','Opciones · Padre 1','family_type','categorical_outcomes',
    'family_child_key','option:option-1','family_child_label','Option 1',
    'canonical_projection_version','atinara-radar-child-projection-v1',
    'canonical_child_key','option:option-1','canonical_child_label','Option 1',
    'raw_provider_child_label','Option 1','identity_kind','option',
    'identity_status','resolved','identity_classification','identified_real_option',
    'identity_source','provider_contract_question','identity_confidence',100
  )||jsonb_build_object(
    'parent_reconciliation_status','complete',
    'parent_reconciliation_version','atinara-radar-parent-reconciliation-v1',
    'parent_reconciliation_fingerprint',process_parent ->> 'reconciliation_fingerprint',
    'parent_child_occurrence_key',process_parent #>> '{children,0,child_occurrence_key}',
    'parent_child_identity_key',process_parent #>> '{children,0,provider_child_identity_key}',
    'parent_child_fingerprint',process_parent #>> '{children,0,child_fingerprint}',
    'provider_child_contract',process_parent #> '{children,0,provider_contract}',
    'provider_child_contract_hash',process_parent #>> '{children,0,provider_contract_hash}',
    'provider_declared_child_count',1,'provider_discovered_child_count',1,
    'provider_accounted_child_count',1,'provider_identified_child_count',1,
    'provider_unresolved_child_count',0,'provider_conflict_child_count',0,
    'provider_pagination_exhausted',true,
    'eligibility_policy_version','atinara-prediction-policy-v5','eligibility_status','eligible',
    'eligibility_reason','Contrato futuro y verificable.',
    'eligibility_checked_at',clock_timestamp(),'eligibility_expires_at',clock_timestamp()+interval '6 hours',
    'eligibility_evidence',jsonb_build_array(jsonb_build_object(
      'url','https://thegameawards.com/official-parent-1','source_type','official',
      'retrieval_status','verified_content','evidence_basis','retrieved_content',
      'parser_version','atinara-official-content-v1',
      'content_sha256',repeat('6',64),'claim_status','direct','direct_claim',true,
      'claim_verifiable',true
    )),
    'source_status','open','source_title','Parent 1','source_question','Will Option 1 win?',
    'source_close_at',clock_timestamp()+interval '30 days',
    'source_resolution_rules','Resuelve la fuente oficial.',
    'source_resolution_url','https://thegameawards.com/official-parent-1',
    'atinara_question','¿Ganará Option 1?','atinara_category','Eventos',
    'atinara_resolution_criteria','Sí si la fuente oficial confirma Option 1.',
    'atinara_resolution_source_url','https://thegameawards.com/official-parent-1',
    'resolution_source_evidence',jsonb_build_array(jsonb_build_object(
      'url','https://thegameawards.com/official-parent-1','source_type','official',
      'retrieval_status','verified_content','evidence_basis','retrieved_content',
      'parser_version','atinara-official-content-v1',
      'content_sha256',repeat('6',64),'claim_status','direct','direct_claim',true,
      'claim_verifiable',true
    )),
    'warnings','[]'::jsonb,'duplicate_matches','[]'::jsonb,
    'verification_status','verified_open','verification_reason','Elegibilidad determinista vigente.',
    'verified_at',clock_timestamp(),'verification_expires_at',clock_timestamp()+interval '6 hours',
    'verification_evidence','[]'::jsonb,'verification_confidence',100,
    'quality_status','fit','quality_score',90,'score_breakdown','{}'::jsonb,
    'state','available','fetched_at',clock_timestamp(),
    'cache_expires_at',clock_timestamp()+interval '20 minutes','provider_payload','{}'::jsonb
  );
  eligibility_value:=jsonb_build_object(
    'provider','polymarket','external_id','1-1','event_group_key','polymarket:parent-1',
    'policy_version','atinara-prediction-policy-v5','status','eligible','reason_code',null,
    'reason','Contrato futuro y verificable.','evidence',candidate_value -> 'eligibility_evidence',
    'checked_at',candidate_value ->> 'eligibility_checked_at',
    'expires_at',candidate_value ->> 'eligibility_expires_at','decision_hash',repeat('7',64)
  );
  perform public.declare_market_radar_refresh_manifest_v1(
    process_request_id,'polymarket','candidate_feed',process_lease,1
  );
  perform public.stage_market_radar_refresh_batch_v1(
    process_request_id,'polymarket','candidate_feed',process_lease,0,
    jsonb_build_array(jsonb_build_object(
      'candidate',candidate_value,'eligibility_check',eligibility_value
    ))
  );
  perform public.seal_market_radar_refresh_v1(
    process_request_id,'polymarket','candidate_feed',process_lease,1
  );
  expected_failure:=false;
  begin
    perform public.process_market_radar_refresh_batch_v2(
      process_request_id,'polymarket','candidate_feed',process_lease
    );
  exception when sqlstate '55000' then expected_failure:=true;
  end;
  if not expected_failure then
    raise exception 'TEST_RADAR_PARENT_RECONCILIATION_NON_ATOMIC_PROCESS_ACCEPTED';
  end if;
  process_result:=public.complete_market_radar_candidate_refresh_v1(
    process_request_id,'polymarket','candidate_feed',process_lease,
    'available',null,null,null
  );
  if (process_result ->> 'atomic_accepted_count')::integer<>1
     or process_result ->> 'atomic_candidate_commit'<>'true' then
    raise exception 'TEST_RADAR_PARENT_RECONCILIATION_PROCESS_INVALID:%',process_result;
  end if;
  if not exists (
    select 1 from private.external_market_candidates candidate
    where candidate.provider='polymarket' and candidate.external_id='1-1'
      and private.market_radar_candidate_reconciliation_ready_v1(candidate)
      and candidate.current_parent_reconciliation_id is not null
      and candidate.current_parent_child_id is not null
      and candidate.normalizer_version='atinara-radar-v3'
      and candidate.family_version='atinara-market-family-v5'
      and candidate.family_key='atinara:v5:parent-1:outcome'
      and candidate.family_child_key='option:option-1'
      and candidate.family_child_label='Option 1'
  ) then raise exception 'TEST_RADAR_PARENT_RECONCILIATION_BINDING_NOT_READY'; end if;

  select id into request_id_value
  from private.external_market_candidates
  where provider='polymarket' and external_id='1-1';
  select preparation_revision::integer into count_value
  from private.external_market_candidates where id=request_id_value;
  parent_size:=count_value;
  eligibility_value:=jsonb_build_object(
    'attempt_id',gen_random_uuid(),'provider','polymarket','external_id','1-1',
    'event_group_key','polymarket:parent-1','policy_version','atinara-prediction-policy-v5',
    'status','eligible','reason_code',null,'reason','Contrato futuro y verificable.',
    'evidence',candidate_value -> 'eligibility_evidence',
    'checked_at',checked_at_value,'expires_at',checked_at_value+interval '6 hours',
    'decision_hash',repeat('9',64)
  );
  response:=public.apply_market_radar_prepare_eligibility_v4(
    request_id_value,count_value,'atinara-radar-v3',checked_at_value,
    candidate_value||jsonb_build_object(
      'eligibility_policy_version','atinara-prediction-policy-v5',
      'eligibility_status','eligible'
    ),eligibility_value,jsonb_build_object(
      'contract_version','atinara-radar-preparation-identity-v1',
      'provider','polymarket','external_id','1-1','external_event_id','parent-1',
      'external_market_id','1-1','normalizer_version','atinara-radar-v3',
      'family_version','atinara-market-family-v5',
      'family_key','atinara:v5:parent-1:outcome','family_type','categorical_outcomes',
      'family_child_key','option:option-1','family_child_label','Option 1',
      'canonical_projection_version','atinara-radar-child-projection-v1',
      'canonical_child_key','option:option-1','canonical_child_label','Option 1',
      'parent_reconciliation_version','atinara-radar-parent-reconciliation-v1',
      'parent_reconciliation_fingerprint',process_parent ->> 'reconciliation_fingerprint',
      'parent_reconciliation_integrity_hash',
        (select payload_hash from private.market_radar_parent_reconciliations_v1
          where request_id=process_request_id and provider_parent_id='parent-1'),
      'parent_child_occurrence_key',process_parent #>> '{children,0,child_occurrence_key}',
      'parent_child_identity_key',process_parent #>> '{children,0,provider_child_identity_key}',
      'parent_child_fingerprint',process_parent #>> '{children,0,child_fingerprint}',
      'parent_child_integrity_hash',
        (select child.payload_hash from private.market_radar_parent_children_v1 child
          join private.market_radar_parent_reconciliations_v1 parent on parent.id=child.parent_reconciliation_id
          where parent.request_id=process_request_id and child.external_market_id='1-1'),
      'provider_child_contract_hash',process_parent #>> '{children,0,provider_contract_hash}',
      'identity_status','resolved','identity_classification','identified_real_option'
    ),false
  );
  if response ->> 'identity_snapshot_contract'
       is distinct from 'atinara-radar-preparation-identity-v1' then
    raise exception 'TEST_RADAR_PREPARATION_IDENTITY_SNAPSHOT_NOT_BOUND:%',response;
  end if;
  replay:=public.apply_market_radar_prepare_eligibility_v4(
    request_id_value,parent_size,'atinara-radar-v3',checked_at_value,
    candidate_value||jsonb_build_object(
      'eligibility_policy_version','atinara-prediction-policy-v5',
      'eligibility_status','eligible'
    ),eligibility_value,jsonb_build_object(
      'contract_version','atinara-radar-preparation-identity-v1',
      'provider','polymarket','external_id','1-1','external_event_id','parent-1',
      'external_market_id','1-1','normalizer_version','atinara-radar-v3',
      'family_version','atinara-market-family-v5',
      'family_key','atinara:v5:parent-1:outcome','family_type','categorical_outcomes',
      'family_child_key','option:option-1','family_child_label','Option 1',
      'canonical_projection_version','atinara-radar-child-projection-v1',
      'canonical_child_key','option:option-1','canonical_child_label','Option 1',
      'parent_reconciliation_version','atinara-radar-parent-reconciliation-v1',
      'parent_reconciliation_fingerprint',process_parent ->> 'reconciliation_fingerprint',
      'parent_reconciliation_integrity_hash',
        (select payload_hash from private.market_radar_parent_reconciliations_v1
          where request_id=process_request_id and provider_parent_id='parent-1'),
      'parent_child_occurrence_key',process_parent #>> '{children,0,child_occurrence_key}',
      'parent_child_identity_key',process_parent #>> '{children,0,provider_child_identity_key}',
      'parent_child_fingerprint',process_parent #>> '{children,0,child_fingerprint}',
      'parent_child_integrity_hash',
        (select child.payload_hash from private.market_radar_parent_children_v1 child
          join private.market_radar_parent_reconciliations_v1 parent on parent.id=child.parent_reconciliation_id
          where parent.request_id=process_request_id and child.external_market_id='1-1'),
      'provider_child_contract_hash',process_parent #>> '{children,0,provider_contract_hash}',
      'identity_status','resolved','identity_classification','identified_real_option'
    ),false
  );
  if replay ->> 'identity_replay'<>'true'
     or replay ->> 'idempotent'<>'true' then
    raise exception 'TEST_RADAR_PREPARATION_IDENTITY_REPLAY_INVALID:%',replay;
  end if;
  select preparation_revision::integer into count_value
  from private.external_market_candidates where id=request_id_value;
  expected_failure:=false;
  begin
    perform public.apply_market_radar_prepare_eligibility_v4(
      request_id_value,count_value,'atinara-radar-v3',clock_timestamp(),
      candidate_value||jsonb_build_object(
        'eligibility_policy_version','atinara-prediction-policy-v5',
        'eligibility_status','eligible'
      ),eligibility_value,jsonb_build_object(
        'contract_version','atinara-radar-preparation-identity-v1',
        'provider','polymarket','external_id','1-1','external_event_id','parent-1',
        'external_market_id','1-1','normalizer_version','atinara-radar-v3',
        'family_version','atinara-market-family-v5',
        'family_key','atinara:v5:parent-1:outcome','family_type','categorical_outcomes',
        'family_child_key','option:option-2','family_child_label','Option 2',
        'canonical_projection_version','atinara-radar-child-projection-v1',
        'canonical_child_key','option:option-2','canonical_child_label','Option 2',
        'parent_reconciliation_version','atinara-radar-parent-reconciliation-v1',
        'parent_reconciliation_fingerprint',process_parent ->> 'reconciliation_fingerprint',
        'parent_reconciliation_integrity_hash',
          (select payload_hash from private.market_radar_parent_reconciliations_v1
            where request_id=process_request_id and provider_parent_id='parent-1'),
        'parent_child_occurrence_key',process_parent #>> '{children,0,child_occurrence_key}',
        'parent_child_identity_key',process_parent #>> '{children,0,provider_child_identity_key}',
        'parent_child_fingerprint',process_parent #>> '{children,0,child_fingerprint}',
        'parent_child_integrity_hash',
          (select child.payload_hash from private.market_radar_parent_children_v1 child
            join private.market_radar_parent_reconciliations_v1 parent on parent.id=child.parent_reconciliation_id
            where parent.request_id=process_request_id and child.external_market_id='1-1'),
        'provider_child_contract_hash',process_parent #>> '{children,0,provider_contract_hash}',
        'identity_status','resolved','identity_classification','identified_real_option'
      ),false
    );
  exception when serialization_failure then expected_failure:=true;
  end;
  if not expected_failure then
    raise exception 'TEST_RADAR_PREPARATION_STALE_IDENTITY_ACCEPTED';
  end if;
  perform private.assert_market_candidate_draft_identity_v1(
    request_id_value,jsonb_build_object(
      'subject','Option 1','question','Will Option 1 win?',
      'yes_criteria','Yes if Option 1 wins.','no_criteria','No if Option 1 does not win.',
      'public_criteria','Official result for Option 1.','market_slug','option-1-winner'
    )
  );
  expected_failure:=false;
  begin
    perform private.assert_market_candidate_draft_identity_v1(
      request_id_value,jsonb_build_object(
        'subject','Option 2','question','Will Option 2 win?',
        'yes_criteria','Yes if Option 2 wins.','no_criteria','No if Option 2 does not win.',
        'public_criteria','Official result for Option 2.','market_slug','option-2-winner'
      )
    );
  exception when sqlstate '55000' then expected_failure:=true;
  end;
  if not expected_failure then
    raise exception 'TEST_RADAR_PARENT_RECONCILIATION_V5_DRAFT_IDENTITY_BYPASSED';
  end if;

  draft_payload:=jsonb_build_object(
    '_idempotency_key',save_operation_id,
    '_radar_preparation_revision',count_value::text,
    'market_slug','option-1-parent-1-winner','question','Will Option 1 win Parent 1?',
    'subject','Option 1','category','Eventos','yes_option','Sí','no_option','No',
    'evaluation_period_label','Hasta el cierre oficial',
    'evaluation_ends_at',(clock_timestamp()+interval '30 days')::text,
    'timezone','UTC','resolution_deadline',(clock_timestamp()+interval '31 days')::text,
    'yes_criteria','Yes if Option 1 wins the official event.',
    'no_criteria','No if Option 1 does not win the official event.',
    'edge_cases','Option 1 follows the official result.',
    'public_criteria','Official result for Option 1.',
    'primary_source',jsonb_build_object('url','https://thegameawards.com/official-parent-1'),
    'alternative_sources',jsonb_build_array(jsonb_build_object(
      'url','https://polymarket.com/event/parent-1'
    )),
    'delay_treatment','Wait for the official result for Option 1.',
    'cancellation_treatment','Annul if the official event is cancelled.',
    'leak_treatment','Use only the official result.',
    'rename_treatment','Follow the stable Option 1 identity.',
    'assumptions','Option 1 remains the same provider child.',
    'description','Private V3 Radar draft transaction fixture.'
  );
  perform set_config('request.jwt.claims',jsonb_build_object(
    'sub',admin_id,'role','authenticated'
  )::text,true);
  save_result:=public.save_market_draft_from_radar(
    request_id_value,null,null,draft_payload
  );
  saved_draft_id:=nullif(save_result #>> '{draft,id}','')::uuid;
  if saved_draft_id is null
     or coalesce((save_result ->> 'idempotency_replay')::boolean,true)
     or save_result #>> '{draft_eligibility_binding,candidate_id}'
       is distinct from request_id_value::text
     or save_result #>> '{draft_eligibility_binding,eligibility_check_id}'
       is distinct from (select current_eligibility_check_id::text
         from private.external_market_candidates where id=request_id_value)
     or (select radar_candidate_id from private.market_drafts where id=saved_draft_id)
       is distinct from request_id_value
     or (select family_version from private.market_drafts where id=saved_draft_id)
       is distinct from 'atinara-market-family-v5'
     or (select family_child_key from private.market_drafts where id=saved_draft_id)
       is distinct from 'option:option-1'
     or (select count(*) from private.market_draft_eligibility_bindings
       where draft_id=saved_draft_id)<>1 then
    raise exception 'TEST_RADAR_V3_SAVE_OR_BINDING_INVALID:%',save_result;
  end if;
  save_replay:=public.save_market_draft_from_radar(
    request_id_value,null,null,draft_payload
  );
  if coalesce((save_replay ->> 'idempotency_replay')::boolean,false) is not true
     or nullif(save_replay #>> '{draft,id}','')::uuid is distinct from saved_draft_id
     or (select count(*) from private.market_drafts
       where radar_candidate_id=request_id_value)<>1
     or (select count(*) from private.market_draft_eligibility_bindings
       where draft_id=saved_draft_id)<>1 then
    raise exception 'TEST_RADAR_V3_SAVE_REPLAY_INVALID:%',save_replay;
  end if;

  perform set_config('request.jwt.claims',jsonb_build_object(
    'sub',admin_id,'role','authenticated'
  )::text,true);
  process_started:=public.begin_market_radar_refresh_v2(
    cutover_request_id,'polymarket','candidate_feed',repeat('c',64),
    'atinara-radar-v3:test-parent-cutover','atinara-radar-v3',
    'atinara-prediction-policy-v5',gen_random_uuid()
  );
  cutover_lease:=(process_started ->> 'lease_token')::uuid;
  perform set_config('request.jwt.claims','{"role":"service_role"}',true);
  perform public.record_market_radar_provider_selection_v1(
    cutover_request_id,'polymarket','candidate_feed',cutover_lease,
    jsonb_build_object(
      'policy_version','atinara-radar-parent-selection-v1','total_parent_count',1,
      'selected_parent_count',1,'deferred_parent_count',0,'selected_child_count',1,
      'no_parent_truncated',true,'selected_parent_ids',jsonb_build_array('parent-1'),
      'deferred_parent_ids','[]'::jsonb
    )
  );
  perform public.record_market_radar_parent_reconciliations_v1(
    cutover_request_id,'polymarket','candidate_feed',cutover_lease,
    jsonb_build_array(process_parent)
  );
  perform public.declare_market_radar_refresh_manifest_v1(
    cutover_request_id,'polymarket','candidate_feed',cutover_lease,0
  );
  perform public.seal_market_radar_refresh_v1(
    cutover_request_id,'polymarket','candidate_feed',cutover_lease,0
  );
  perform public.complete_market_radar_candidate_refresh_v1(
    cutover_request_id,'polymarket','candidate_feed',cutover_lease,
    'available',null,null,null
  );
  if not exists (
    select 1 from private.external_market_candidates candidate
    where candidate.provider='polymarket' and candidate.external_id='1-1'
      and private.market_radar_candidate_reconciliation_ready_v1(candidate)
      and candidate.state='prepared' and candidate.prepared_draft_id=saved_draft_id
      and exists (
        select 1 from private.market_radar_parent_reconciliations_v1 parent
        where parent.id=candidate.current_parent_reconciliation_id
          and parent.request_id=cutover_request_id
      )
  ) then raise exception 'TEST_RADAR_PROTECTED_DRAFT_NOT_REBOUND'; end if;
  perform set_config('request.jwt.claims',jsonb_build_object(
    'sub',admin_id,'role','authenticated'
  )::text,true);
  select id into request_id_value from private.external_market_candidates
  where provider='polymarket' and external_id='1-1';
  response:=public.get_market_radar_candidate(request_id_value);
  if response #>> '{advancement_gate,can_analyze}'<>'true'
     or response #>> '{advancement_gate,can_prepare}'<>'true' then
    raise exception 'TEST_RADAR_PROTECTED_DRAFT_GETTER_STALE:%',response;
  end if;
  response:=public.get_market_intelligence_origin('radar_candidate',request_id_value::text);
  if response #>> '{advancement_gate,can_analyze}'<>'true'
     or response #>> '{advancement_gate,can_prepare}'<>'true' then
    raise exception 'TEST_RADAR_PROTECTED_DRAFT_EXPERT_STALE:%',response;
  end if;

  perform public.claim_market_radar_provider_probe_v1(
    'polymarket','candidate_feed',incomplete_request_id
  );
  process_started:=public.begin_market_radar_refresh_v2(
    incomplete_request_id,'polymarket','candidate_feed',repeat('d',64),
    'atinara-radar-v3:test-parent-incomplete','atinara-radar-v3',
    'atinara-prediction-policy-v5',gen_random_uuid()
  );
  incomplete_lease:=(process_started ->> 'lease_token')::uuid;
  children:='[]'::jsonb;
  for child_index in 0..47 loop
    child_value:=reconciliations #> array['3','children',child_index::text];
    if child_index>=21 then
      provider_contract_value:=(child_value -> 'provider_contract')||jsonb_build_object(
        'raw_provider_child_label',case when child_index=47 then 'another game'
          else 'Game '||chr(65+child_index-21) end,
        'source_status','inactive'
      );
      provider_contract_canonical:=child_value ->> 'provider_contract_canonical_json';
      child_value:=child_value||jsonb_build_object(
        'raw_provider_child_label',case when child_index=47 then 'another game'
          else 'Game '||chr(65+child_index-21) end,
        'canonical_child_label',null,'canonical_child_slug',null,'canonical_child_key',null,
        'identity_classification','provider_placeholder_pending_resolution',
        'identity_status','unresolved_placeholder','availability_status','inactive',
        'identity_source',null,'identity_confidence',0,
        'provider_contract',provider_contract_value,
        'provider_contract_canonical_json',provider_contract_canonical,
        'provider_contract_hash',encode(extensions.digest(
          convert_to(provider_contract_canonical,'UTF8'),'sha256'
        ),'hex')
      );
    end if;
    child_value:=child_value||jsonb_build_object(
      'present_in_legacy_snapshot',true,'transition','same',
      'child_fingerprint',encode(extensions.digest(convert_to(
        'parent-48:followup:'||child_index||':'||(child_value ->> 'identity_status'),
        'UTF8'
      ),'sha256'),'hex')
    );
    children:=children||jsonb_build_array(child_value);
  end loop;
  incomplete_issue:=private.market_workflow_server_issue_v1(
    'PROVIDER_CHILD_IDENTITY_RESOLUTION_REQUIRED','radar','radar',
    'auto_recoverable','approval','retry_provider_refresh',
    jsonb_build_object('provider_parent_id','parent-48','declared',48,'identified',21,'unresolved',27),
    true,'atinara-radar-parent-reconciliation-v1'
  );
  incomplete_parent:=(reconciliations -> 3)||jsonb_build_object(
    'provider_identified_child_count',21,'provider_unresolved_child_count',27,
    'legacy_expected_child_count',48,'legacy_accounted_child_count',48,
    'new_child_count',0,
    'reconciliation_status','incomplete_provider_metadata',
    'reconciliation_fingerprint',repeat('8',64),
    'next_retry_at',clock_timestamp()+interval '1 hour',
    'issue',incomplete_issue,'children',children
  );
  perform set_config('request.jwt.claims','{"role":"service_role"}',true);
  perform public.record_market_radar_provider_selection_v1(
    incomplete_request_id,'polymarket','candidate_feed',incomplete_lease,
    jsonb_build_object(
      'policy_version','atinara-radar-parent-selection-v1','total_parent_count',1,
      'selected_parent_count',1,'deferred_parent_count',0,'selected_child_count',48,
      'no_parent_truncated',true,'selected_parent_ids',jsonb_build_array('parent-48'),
      'deferred_parent_ids','[]'::jsonb
    )
  );
  response:=public.record_market_radar_parent_reconciliations_v1(
    incomplete_request_id,'polymarket','candidate_feed',incomplete_lease,
    jsonb_build_array(incomplete_parent)
  );
  if response ->> 'incomplete_parent_count'<>'1'
     or (select provider_accounted_child_count from private.market_radar_parent_reconciliations_v1
       where request_id=incomplete_request_id)<>48
     or (select provider_unresolved_child_count from private.market_radar_parent_reconciliations_v1
       where request_id=incomplete_request_id)<>27 then
    raise exception 'TEST_RADAR_PARENT_RECONCILIATION_48_21_27_INVALID:%',response;
  end if;
  perform public.declare_market_radar_refresh_manifest_v1(
    incomplete_request_id,'polymarket','candidate_feed',incomplete_lease,0
  );
  perform public.seal_market_radar_refresh_v1(
    incomplete_request_id,'polymarket','candidate_feed',incomplete_lease,0
  );
  perform public.complete_market_radar_candidate_refresh_v1(
    incomplete_request_id,'polymarket','candidate_feed',incomplete_lease,
    'available',null,null,null
  );

  -- Una fila legacy observada pero aún no explicada permanece en el ledger,
  -- pero no cuenta como reconciliada ni permite falsear un parent complete.
  perform set_config('request.jwt.claims',jsonb_build_object(
    'sub',admin_id,'role','authenticated'
  )::text,true);
  perform public.claim_market_radar_provider_probe_v1(
    'polymarket','candidate_feed',legacy_partial_request_id
  );
  process_started:=public.begin_market_radar_refresh_v2(
    legacy_partial_request_id,'polymarket','candidate_feed',repeat('e',64),
    'atinara-radar-v3:test-legacy-partial','atinara-radar-v3',
    'atinara-prediction-policy-v5',gen_random_uuid()
  );
  legacy_partial_lease:=(process_started ->> 'lease_token')::uuid;
  child_value:=(process_parent #> '{children,0}')||jsonb_build_object(
    'present_in_current_snapshot',false,'present_in_legacy_snapshot',true,
    'identity_classification','provider_data_conflict','identity_status','conflict',
    'availability_status','unknown','identity_confidence',0,'transition','same'
  );
  legacy_partial_parent:=process_parent||jsonb_build_object(
    'provider_declared_child_count',0,'provider_discovered_child_count',0,
    'provider_accounted_child_count',0,'provider_identified_child_count',0,
    'provider_unresolved_child_count',0,'provider_removed_child_count',0,
    'provider_closed_child_count',0,'provider_duplicate_child_count',0,
    'provider_conflict_child_count',0,'legacy_expected_child_count',1,
    'legacy_accounted_child_count',0,'new_child_count',0,
    'reconciliation_status','historical_mapping_required',
    'reconciliation_fingerprint',repeat('e',64),
    'next_retry_at',clock_timestamp()+interval '1 hour',
    'issue',private.market_workflow_server_issue_v1(
      'RADAR_PARENT_RECONCILIATION_INCOMPLETE','radar','radar',
      'auto_recoverable','approval','retry_provider_refresh',
      jsonb_build_object('provider_parent_id','parent-1','legacy_expected',1,'legacy_accounted',0),
      true,'atinara-radar-parent-reconciliation-v1'
    ),'children',jsonb_build_array(child_value)
  );
  perform set_config('request.jwt.claims','{"role":"service_role"}',true);
  perform public.record_market_radar_provider_selection_v1(
    legacy_partial_request_id,'polymarket','candidate_feed',legacy_partial_lease,
    jsonb_build_object(
      'policy_version','atinara-radar-parent-selection-v1','total_parent_count',1,
      'selected_parent_count',1,'deferred_parent_count',0,'selected_child_count',0,
      'no_parent_truncated',true,'selected_parent_ids',jsonb_build_array('parent-1'),
      'deferred_parent_ids','[]'::jsonb
    )
  );
  expected_failure:=false;
  begin
    perform public.record_market_radar_parent_reconciliations_v1(
      legacy_partial_request_id,'polymarket','candidate_feed',legacy_partial_lease,
      jsonb_build_array(jsonb_set(legacy_partial_parent,'{children}',
        jsonb_build_array(child_value,child_value)))
    );
  exception when unique_violation then expected_failure:=true;
  end;
  if not expected_failure then
    raise exception 'TEST_RADAR_PARENT_CHILD_OCCURRENCE_DUPLICATE_ACCEPTED';
  end if;
  expected_failure:=false;
  begin
    perform public.record_market_radar_parent_reconciliations_v1(
      legacy_partial_request_id,'polymarket','candidate_feed',legacy_partial_lease,
      jsonb_build_array(jsonb_set(legacy_partial_parent,'{children}',jsonb_build_array(
        child_value||jsonb_build_object(
          'provider_child_identity_key','polymarket:market:fabricated',
          'external_market_id','fabricated','condition_id','fabricated',
          'child_slug','fabricated','token_ids','[]'::jsonb
        )
      )))
    );
  exception when sqlstate '22023' then expected_failure:=true;
  end;
  if not expected_failure then
    raise exception 'TEST_RADAR_LEGACY_SAME_COUNT_IDENTITY_SUBSTITUTION_ACCEPTED';
  end if;
  expected_failure:=false;
  begin
    perform public.record_market_radar_parent_reconciliations_v1(
      legacy_partial_request_id,'polymarket','candidate_feed',legacy_partial_lease,
      jsonb_build_array(jsonb_set(legacy_partial_parent,
        '{legacy_accounted_child_count}','1'::jsonb))
    );
  exception when sqlstate '22023' then expected_failure:=true;
  end;
  if not expected_failure then
    raise exception 'TEST_RADAR_LEGACY_UNRESOLVED_FALSE_ACCOUNTED_ACCEPTED';
  end if;
  response:=public.record_market_radar_parent_reconciliations_v1(
    legacy_partial_request_id,'polymarket','candidate_feed',legacy_partial_lease,
    jsonb_build_array(legacy_partial_parent)
  );
  if (select legacy_expected_child_count from private.market_radar_parent_reconciliations_v1
        where request_id=legacy_partial_request_id)<>1
     or (select legacy_accounted_child_count from private.market_radar_parent_reconciliations_v1
        where request_id=legacy_partial_request_id)<>0 then
    raise exception 'TEST_RADAR_LEGACY_PARTIAL_ACCOUNTING_INVALID:%',response;
  end if;
  perform public.declare_market_radar_refresh_manifest_v1(
    legacy_partial_request_id,'polymarket','candidate_feed',legacy_partial_lease,0
  );
  perform public.seal_market_radar_refresh_v1(
    legacy_partial_request_id,'polymarket','candidate_feed',legacy_partial_lease,0
  );
  perform public.complete_market_radar_candidate_refresh_v1(
    legacy_partial_request_id,'polymarket','candidate_feed',legacy_partial_lease,
    'available',null,null,null
  );

  -- Una familia LKG real con dos hermanas se completa primero. El refresh
  -- siguiente divide las mismas hijas en dos batches: tras confirmar solo el
  -- primero deben quedar cero hijas bound, nunca una familia antigua parcial.
  children:='[]'::jsonb;
  for child_index in 1..2 loop
    provider_contract_value:=jsonb_build_object(
      'contract_version','atinara-radar-provider-child-contract-v1',
      'provider','polymarket','provider_parent_id','parent-lkg',
      'external_market_id','lkg-'||child_index,
      'condition_id','condition-lkg-'||child_index,
      'token_ids','[]'::jsonb,'child_slug','lkg-option-'||child_index,
      'event_slug','parent-lkg','external_event_url','https://polymarket.com/event/parent-lkg',
      'external_market_url','https://polymarket.com/event/parent-lkg',
      'source_title','Parent LKG','source_question','Will LKG Option '||child_index||' win?',
      'source_description',null,'source_resolution_rules','Official result.',
      'source_resolution_url','https://thegameawards.com/official-parent-lkg',
      'source_close_at','2027-01-01T00:00:00.000Z',
      'source_resolution_deadline','2027-01-02T00:00:00.000Z',
      'source_status','open','source_result',null,
      'raw_provider_child_label','LKG Option '||child_index
    );
    provider_contract_canonical:=private.market_workflow_canonical_json_v1(
      jsonb_build_object(
        'contract_version',provider_contract_value -> 'contract_version',
        'provider',provider_contract_value -> 'provider',
        'source_question',provider_contract_value -> 'source_question',
        'source_description',provider_contract_value -> 'source_description',
        'source_resolution_rules',provider_contract_value -> 'source_resolution_rules',
        'source_resolution_url',provider_contract_value -> 'source_resolution_url',
        'source_close_at',provider_contract_value -> 'source_close_at',
        'source_resolution_deadline',provider_contract_value -> 'source_resolution_deadline'
      )
    );
    child_value:=jsonb_build_object(
      'child_occurrence_key','polymarket:lkg:'||child_index,
      'provider_child_identity_key','polymarket:market:lkg-'||child_index,
      'external_market_id','lkg-'||child_index,
      'condition_id','condition-lkg-'||child_index,
      'identity_kind','option','token_ids','[]'::jsonb,
      'child_slug','lkg-option-'||child_index,'event_id','parent-lkg','event_slug','parent-lkg',
      'raw_provider_child_label','LKG Option '||child_index,
      'canonical_child_label','LKG Option '||child_index,
      'canonical_child_slug','lkg-option-'||child_index,
      'canonical_child_key','option:lkg-option-'||child_index,
      'identity_classification','identified_real_option','identity_status','resolved',
      'availability_status','open','identity_source','provider_contract_question',
      'identity_confidence',100,'identity_evidence',jsonb_build_array(jsonb_build_object(
        'url','https://gamma-api.polymarket.com/events/parent-lkg',
        'endpoint','/events/parent-lkg','identifier_type','external_market_id',
        'identifier','lkg-'||child_index,'result','child_identity_observed_in_parent',
        'content_sha256',repeat('1',64),'identity_sha256',repeat('2',64),
        'checked_at',checked_at_value
      )),'present_in_current_snapshot',true,'present_in_legacy_snapshot',false,
      'transition','new','duplicate_of_child_identity_key',null,
      'provider_contract',provider_contract_value,
      'provider_contract_canonical_json',provider_contract_canonical,
      'provider_contract_hash',encode(extensions.digest(
        convert_to(provider_contract_canonical,'UTF8'),'sha256'
      ),'hex'),'projection_version','atinara-radar-child-projection-v1',
      'child_fingerprint',encode(extensions.digest(convert_to(
        'parent-lkg:child-'||child_index,'UTF8'
      ),'sha256'),'hex'),'checked_at',checked_at_value
    );
    children:=children||jsonb_build_array(child_value);
  end loop;
  lkg_parent:=jsonb_build_object(
    'provider','polymarket','provider_parent_id','parent-lkg',
    'raw_provider_parent_label','Parent LKG','canonical_parent_label','Padre LKG',
    'raw_provider_category','Events','atinara_category','Eventos','category','Eventos',
    'external_parent_url','https://polymarket.com/event/parent-lkg',
    'provider_declared_child_count',2,'provider_discovered_child_count',2,
    'provider_accounted_child_count',2,'provider_identified_child_count',2,
    'provider_unresolved_child_count',0,'provider_removed_child_count',0,
    'provider_closed_child_count',0,'provider_duplicate_child_count',0,
    'provider_conflict_child_count',0,'legacy_expected_child_count',null,
    'legacy_accounted_child_count',null,'new_child_count',2,
    'provider_pagination_exhausted',true,'reconciliation_status','complete',
    'reconciliation_version','atinara-radar-parent-reconciliation-v1',
    'normalizer_version','atinara-radar-v3','family_version','atinara-market-family-v5',
    'reconciliation_fingerprint',encode(extensions.digest(convert_to(
      'parent-lkg:baseline','UTF8'
    ),'sha256'),'hex'),'checked_at',checked_at_value,'next_retry_at',null,
    'source_refs',jsonb_build_array(jsonb_build_object(
      'url','https://gamma-api.polymarket.com/events/parent-lkg',
      'endpoint','/events/parent-lkg','identifier_type','event_id','identifier','parent-lkg',
      'result','parent_children_enumerated','content_sha256',repeat('3',64),
      'identity_sha256',repeat('4',64),'checked_at',checked_at_value
    )),'issue',null,'children',children
  );
  perform set_config('request.jwt.claims',jsonb_build_object(
    'sub',admin_id,'role','authenticated'
  )::text,true);
  perform public.claim_market_radar_provider_probe_v1(
    'polymarket','candidate_feed',lkg_baseline_request_id
  );
  process_started:=public.begin_market_radar_refresh_v2(
    lkg_baseline_request_id,'polymarket','candidate_feed',repeat('1',64),
    'atinara-radar-v3:test-lkg-baseline','atinara-radar-v3',
    'atinara-prediction-policy-v5',gen_random_uuid()
  );
  lkg_baseline_lease:=(process_started ->> 'lease_token')::uuid;
  perform set_config('request.jwt.claims','{"role":"service_role"}',true);
  perform public.record_market_radar_provider_selection_v1(
    lkg_baseline_request_id,'polymarket','candidate_feed',lkg_baseline_lease,
    jsonb_build_object(
      'policy_version','atinara-radar-parent-selection-v1','total_parent_count',1,
      'selected_parent_count',1,'deferred_parent_count',0,'selected_child_count',2,
      'no_parent_truncated',true,'selected_parent_ids',jsonb_build_array('parent-lkg'),
      'deferred_parent_ids','[]'::jsonb
    )
  );
  perform public.record_market_radar_parent_reconciliations_v1(
    lkg_baseline_request_id,'polymarket','candidate_feed',lkg_baseline_lease,
    jsonb_build_array(lkg_parent)
  );
  lkg_entries:='[]'::jsonb;
  for child_index in 1..2 loop
    child_value:=lkg_parent #> array['children',(child_index-1)::text];
    lkg_candidate:=candidate_value||jsonb_build_object(
      'external_id','lkg-'||child_index,'external_event_id','parent-lkg',
      'external_market_id','lkg-'||child_index,'external_event_slug','parent-lkg',
      'external_market_slug','lkg-option-'||child_index,
      'event_group_key','polymarket:parent-lkg',
      'fingerprint',encode(extensions.digest(convert_to(
        'lkg-candidate-'||child_index,'UTF8'
      ),'sha256'),'hex'),'cache_key','atinara-radar-v3:test-lkg-baseline',
      'family_key','atinara:v5:parent-lkg:outcome','family_title','Opciones · Padre LKG',
      'family_child_key','option:lkg-option-'||child_index,
      'family_child_label','LKG Option '||child_index,
      'canonical_child_key','option:lkg-option-'||child_index,
      'canonical_child_label','LKG Option '||child_index,
      'raw_provider_child_label','LKG Option '||child_index,
      'parent_reconciliation_fingerprint',lkg_parent ->> 'reconciliation_fingerprint',
      'parent_child_occurrence_key',child_value ->> 'child_occurrence_key',
      'parent_child_identity_key',child_value ->> 'provider_child_identity_key',
      'parent_child_fingerprint',child_value ->> 'child_fingerprint',
      'provider_child_contract',child_value -> 'provider_contract',
      'provider_child_contract_hash',child_value ->> 'provider_contract_hash',
      'provider_declared_child_count',2,'provider_discovered_child_count',2,
      'provider_accounted_child_count',2,'provider_identified_child_count',2,
      'source_title','Parent LKG','source_question','Will LKG Option '||child_index||' win?',
      'source_resolution_url','https://thegameawards.com/official-parent-lkg',
      'atinara_question','¿Ganará LKG Option '||child_index||'?',
      'atinara_resolution_source_url','https://thegameawards.com/official-parent-lkg'
    );
    lkg_check:=eligibility_value||jsonb_build_object(
      'attempt_id',gen_random_uuid(),'external_id','lkg-'||child_index,
      'event_group_key','polymarket:parent-lkg',
      'checked_at',lkg_candidate ->> 'eligibility_checked_at',
      'expires_at',lkg_candidate ->> 'eligibility_expires_at',
      'decision_hash',encode(extensions.digest(convert_to(
        'lkg-baseline-check-'||child_index,'UTF8'
      ),'sha256'),'hex')
    );
    lkg_entries:=lkg_entries||jsonb_build_array(jsonb_build_object(
      'candidate',lkg_candidate,'eligibility_check',lkg_check
    ));
  end loop;
  perform public.declare_market_radar_refresh_manifest_v1(
    lkg_baseline_request_id,'polymarket','candidate_feed',lkg_baseline_lease,2
  );
  perform public.stage_market_radar_refresh_batch_v1(
    lkg_baseline_request_id,'polymarket','candidate_feed',lkg_baseline_lease,0,
    jsonb_build_array(lkg_entries -> 0)
  );
  perform public.stage_market_radar_refresh_batch_v1(
    lkg_baseline_request_id,'polymarket','candidate_feed',lkg_baseline_lease,1,
    jsonb_build_array(lkg_entries -> 1)
  );
  perform public.seal_market_radar_refresh_v1(
    lkg_baseline_request_id,'polymarket','candidate_feed',lkg_baseline_lease,2
  );
  lkg_result:=public.complete_market_radar_candidate_refresh_v1(
    lkg_baseline_request_id,'polymarket','candidate_feed',lkg_baseline_lease,
    'available',null,null,null
  );
  if lkg_result ->> 'outcome'<>'completed'
     or (select count(*) from private.external_market_candidates candidate
       where candidate.provider='polymarket' and candidate.external_id like 'lkg-%'
         and private.market_radar_candidate_reconciliation_bound_v1(candidate))<>2 then
    raise exception 'TEST_RADAR_LKG_BASELINE_NOT_BOUND:%',lkg_result;
  end if;

  -- Segunda reconciliación material del mismo padre; antes de cualquier batch
  -- las dos hermanas LKG deben retirarse juntas de la proyección current.
  children:='[]'::jsonb;
  for child_index in 0..1 loop
    child_value:=(lkg_parent #> array['children',child_index::text])
      ||jsonb_build_object(
        'present_in_legacy_snapshot',true,'transition','same',
        'child_fingerprint',encode(extensions.digest(convert_to(
          'parent-lkg:active-child-'||child_index,'UTF8'
        ),'sha256'),'hex')
      );
    children:=children||jsonb_build_array(child_value);
  end loop;
  lkg_parent:=lkg_parent||jsonb_build_object(
    'legacy_expected_child_count',2,'legacy_accounted_child_count',2,'new_child_count',0,
    'reconciliation_fingerprint',encode(extensions.digest(convert_to(
      'parent-lkg:active','UTF8'
    ),'sha256'),'hex'),'children',children
  );
  perform set_config('request.jwt.claims',jsonb_build_object(
    'sub',admin_id,'role','authenticated'
  )::text,true);
  perform public.claim_market_radar_provider_probe_v1(
    'polymarket','candidate_feed',lkg_active_request_id
  );
  process_started:=public.begin_market_radar_refresh_v2(
    lkg_active_request_id,'polymarket','candidate_feed',repeat('2',64),
    'atinara-radar-v3:test-lkg-active','atinara-radar-v3',
    'atinara-prediction-policy-v5',gen_random_uuid()
  );
  lkg_active_lease:=(process_started ->> 'lease_token')::uuid;
  perform set_config('request.jwt.claims','{"role":"service_role"}',true);
  perform public.record_market_radar_provider_selection_v1(
    lkg_active_request_id,'polymarket','candidate_feed',lkg_active_lease,
    jsonb_build_object(
      'policy_version','atinara-radar-parent-selection-v1','total_parent_count',1,
      'selected_parent_count',1,'deferred_parent_count',0,'selected_child_count',2,
      'no_parent_truncated',true,'selected_parent_ids',jsonb_build_array('parent-lkg'),
      'deferred_parent_ids','[]'::jsonb
    )
  );
  perform public.record_market_radar_parent_reconciliations_v1(
    lkg_active_request_id,'polymarket','candidate_feed',lkg_active_lease,
    jsonb_build_array(lkg_parent)
  );
  if (select count(*) from private.external_market_candidates candidate
      where candidate.provider='polymarket' and candidate.external_id like 'lkg-%'
        and private.market_radar_candidate_reconciliation_bound_v1(candidate))<>0 then
    raise exception 'TEST_RADAR_ACTIVE_PARENT_EXPOSED_LKG_BEFORE_BATCH';
  end if;
  lkg_entries:='[]'::jsonb;
  for child_index in 1..2 loop
    child_value:=lkg_parent #> array['children',(child_index-1)::text];
    lkg_candidate:=candidate_value||jsonb_build_object(
      'external_id','lkg-'||child_index,'external_event_id','parent-lkg',
      'external_market_id','lkg-'||child_index,'external_event_slug','parent-lkg',
      'external_market_slug','lkg-option-'||child_index,
      'event_group_key','polymarket:parent-lkg',
      'fingerprint',encode(extensions.digest(convert_to(
        'lkg-active-candidate-'||child_index,'UTF8'
      ),'sha256'),'hex'),'cache_key','atinara-radar-v3:test-lkg-active',
      'family_key','atinara:v5:parent-lkg:outcome','family_title','Opciones · Padre LKG',
      'family_child_key','option:lkg-option-'||child_index,
      'family_child_label','LKG Option '||child_index,
      'canonical_child_key','option:lkg-option-'||child_index,
      'canonical_child_label','LKG Option '||child_index,
      'raw_provider_child_label','LKG Option '||child_index,
      'parent_reconciliation_fingerprint',lkg_parent ->> 'reconciliation_fingerprint',
      'parent_child_occurrence_key',child_value ->> 'child_occurrence_key',
      'parent_child_identity_key',child_value ->> 'provider_child_identity_key',
      'parent_child_fingerprint',child_value ->> 'child_fingerprint',
      'provider_child_contract',child_value -> 'provider_contract',
      'provider_child_contract_hash',child_value ->> 'provider_contract_hash',
      'provider_declared_child_count',2,'provider_discovered_child_count',2,
      'provider_accounted_child_count',2,'provider_identified_child_count',2,
      'source_title','Parent LKG','source_question','Will LKG Option '||child_index||' win?',
      'source_resolution_url','https://thegameawards.com/official-parent-lkg',
      'atinara_question','¿Ganará LKG Option '||child_index||'?',
      'atinara_resolution_source_url','https://thegameawards.com/official-parent-lkg'
    );
    lkg_check:=eligibility_value||jsonb_build_object(
      'attempt_id',gen_random_uuid(),'external_id','lkg-'||child_index,
      'event_group_key','polymarket:parent-lkg',
      'checked_at',lkg_candidate ->> 'eligibility_checked_at',
      'expires_at',lkg_candidate ->> 'eligibility_expires_at',
      'decision_hash',encode(extensions.digest(convert_to(
        'lkg-active-check-'||child_index,'UTF8'
      ),'sha256'),'hex')
    );
    lkg_entries:=lkg_entries||jsonb_build_array(jsonb_build_object(
      'candidate',lkg_candidate,'eligibility_check',lkg_check
    ));
  end loop;
  perform public.declare_market_radar_refresh_manifest_v1(
    lkg_active_request_id,'polymarket','candidate_feed',lkg_active_lease,2
  );
  perform public.stage_market_radar_refresh_batch_v1(
    lkg_active_request_id,'polymarket','candidate_feed',lkg_active_lease,0,
    jsonb_build_array(lkg_entries -> 0)
  );
  perform public.stage_market_radar_refresh_batch_v1(
    lkg_active_request_id,'polymarket','candidate_feed',lkg_active_lease,1,
    jsonb_build_array(lkg_entries -> 1)
  );
  perform public.seal_market_radar_refresh_v1(
    lkg_active_request_id,'polymarket','candidate_feed',lkg_active_lease,2
  );
  process_result:=public.process_market_radar_refresh_batch_v3(
    lkg_active_request_id,'polymarket','candidate_feed',lkg_active_lease
  );
  if process_result ->> 'remaining_batches'<>'1'
     or (select count(*) from private.external_market_candidates candidate
       where candidate.provider='polymarket' and candidate.external_id like 'lkg-%'
         and private.market_radar_candidate_reconciliation_bound_v1(candidate))<>0 then
    raise exception 'TEST_RADAR_PARTIAL_BATCH_EXPOSED_LKG:%',process_result;
  end if;
  perform public.process_market_radar_refresh_batch_v3(
    lkg_active_request_id,'polymarket','candidate_feed',lkg_active_lease
  );
  lkg_result:=public.complete_market_radar_candidate_refresh_v2(
    lkg_active_request_id,'polymarket','candidate_feed',lkg_active_lease,
    'available',null,null,null
  );
  if lkg_result ->> 'outcome'<>'completed'
     or (select count(*) from private.external_market_candidates candidate
       join private.market_radar_parent_reconciliations_v1 parent_alias
         on parent_alias.id=candidate.current_parent_reconciliation_id
       where candidate.provider='polymarket' and candidate.external_id like 'lkg-%'
         and parent_alias.request_id=lkg_active_request_id
         and private.market_radar_candidate_reconciliation_bound_v1(candidate))<>2 then
    raise exception 'TEST_RADAR_LKG_FAMILY_NOT_ATOMIC_AFTER_TERMINAL:%',lkg_result;
  end if;

  -- El wrapper promueve todos los batches o ninguno. El segundo item conserva
  -- una huella hija incorrecta para forzar fallo después del primer batch.
  perform set_config('request.jwt.claims',jsonb_build_object(
    'sub',admin_id,'role','authenticated'
  )::text,true);
  perform public.claim_market_radar_provider_probe_v1(
    'polymarket','candidate_feed',rollback_request_id
  );
  process_started:=public.begin_market_radar_refresh_v2(
    rollback_request_id,'polymarket','candidate_feed',repeat('f',64),
    'atinara-radar-v3:test-atomic-rollback','atinara-radar-v3',
    'atinara-prediction-policy-v5',gen_random_uuid()
  );
  rollback_lease:=(process_started ->> 'lease_token')::uuid;
  perform set_config('request.jwt.claims','{"role":"service_role"}',true);
  perform public.record_market_radar_provider_selection_v1(
    rollback_request_id,'polymarket','candidate_feed',rollback_lease,
    jsonb_build_object(
      'policy_version','atinara-radar-parent-selection-v1','total_parent_count',1,
      'selected_parent_count',1,'deferred_parent_count',0,'selected_child_count',3,
      'no_parent_truncated',true,'selected_parent_ids',jsonb_build_array('parent-3'),
      'deferred_parent_ids','[]'::jsonb
    )
  );
  children:='[]'::jsonb;
  for child_index in 0..2 loop
    child_value:=(reconciliations #> array['1','children',child_index::text])
      ||jsonb_build_object(
        'present_in_legacy_snapshot',true,'transition','same',
        'child_fingerprint',encode(extensions.digest(convert_to(
          'parent-3:followup:'||child_index,'UTF8'
        ),'sha256'),'hex')
      );
    children:=children||jsonb_build_array(child_value);
  end loop;
  parent_value:=(reconciliations -> 1)||jsonb_build_object(
    'legacy_expected_child_count',3,'legacy_accounted_child_count',3,
    'new_child_count',0,
    'reconciliation_fingerprint',encode(extensions.digest(convert_to(
      'parent-3:complete:followup','UTF8'
    ),'sha256'),'hex'),
    'children',children
  );
  perform public.record_market_radar_parent_reconciliations_v1(
    rollback_request_id,'polymarket','candidate_feed',rollback_lease,
    jsonb_build_array(parent_value)
  );
  valid_candidate:=candidate_value||jsonb_build_object(
    'external_id','3-1','external_event_id','parent-3','external_market_id','3-1',
    'external_event_slug','parent-3','external_market_slug','option-1',
    'event_group_key','polymarket:parent-3','fingerprint','raaaaaaaa',
    'cache_key','atinara-radar-v3:test-atomic-rollback',
    'family_key','atinara:v5:parent-3:outcome','family_title','Opciones · Padre 3',
    'family_child_key','option:option-1','family_child_label','Option 1',
    'canonical_child_key','option:option-1','canonical_child_label','Option 1',
    'parent_reconciliation_fingerprint',parent_value ->> 'reconciliation_fingerprint',
    'parent_child_occurrence_key',parent_value #>> '{children,0,child_occurrence_key}',
    'parent_child_identity_key',parent_value #>> '{children,0,provider_child_identity_key}',
    'parent_child_fingerprint',parent_value #>> '{children,0,child_fingerprint}',
    'provider_child_contract',parent_value #> '{children,0,provider_contract}',
    'provider_child_contract_hash',parent_value #>> '{children,0,provider_contract_hash}',
    'provider_declared_child_count',3,'provider_discovered_child_count',3,
    'provider_accounted_child_count',3,'provider_identified_child_count',3
  );
  invalid_candidate:=valid_candidate||jsonb_build_object(
    'external_id','3-2','external_market_id','3-2','external_market_slug','option-2',
    'fingerprint','rbbbbbbbb','family_child_key','option:option-2',
    'family_child_label','Option 2','canonical_child_key','option:option-2',
    'canonical_child_label','Option 2',
    'parent_child_occurrence_key',parent_value #>> '{children,1,child_occurrence_key}',
    'parent_child_identity_key',parent_value #>> '{children,1,provider_child_identity_key}',
    'parent_child_fingerprint',repeat('0',64),
    'provider_child_contract',parent_value #> '{children,1,provider_contract}',
    'provider_child_contract_hash',parent_value #>> '{children,1,provider_contract_hash}'
  );
  valid_eligibility:=eligibility_value||jsonb_build_object(
    'external_id','3-1','event_group_key','polymarket:parent-3',
    'decision_hash',repeat('c',64)
  );
  invalid_eligibility:=eligibility_value||jsonb_build_object(
    'external_id','3-2','event_group_key','polymarket:parent-3',
    'decision_hash',repeat('d',64)
  );
  perform public.declare_market_radar_refresh_manifest_v1(
    rollback_request_id,'polymarket','candidate_feed',rollback_lease,2
  );
  perform public.stage_market_radar_refresh_batch_v1(
    rollback_request_id,'polymarket','candidate_feed',rollback_lease,0,
    jsonb_build_array(jsonb_build_object(
      'candidate',valid_candidate,'eligibility_check',valid_eligibility
    ))
  );
  perform public.stage_market_radar_refresh_batch_v1(
    rollback_request_id,'polymarket','candidate_feed',rollback_lease,1,
    jsonb_build_array(jsonb_build_object(
      'candidate',invalid_candidate,'eligibility_check',invalid_eligibility
    ))
  );
  perform public.seal_market_radar_refresh_v1(
    rollback_request_id,'polymarket','candidate_feed',rollback_lease,2
  );
  expected_failure:=false;
  begin
    perform public.complete_market_radar_candidate_refresh_v1(
      rollback_request_id,'polymarket','candidate_feed',rollback_lease,
      'available',null,null,null
    );
  exception when others then
    expected_failure:=sqlerrm like 'RADAR_CANDIDATE_RECONCILIATION_BINDING_INVALID%';
  end;
  if not expected_failure then
    raise exception 'TEST_RADAR_ATOMIC_MULTI_BATCH_FAILURE_NOT_OBSERVED';
  end if;
  if exists(select 1 from private.external_market_candidates
       where provider='polymarket' and external_id in ('3-1','3-2'))
     or exists(select 1 from private.market_radar_eligibility_checks
       where provider='polymarket' and external_id in ('3-1','3-2'))
     or exists(select 1 from private.market_radar_refresh_batches_v1
       where request_id=rollback_request_id and status<>'pending')
     or not exists(select 1 from private.market_radar_refresh_intents_v1
       where request_id=rollback_request_id and status='in_progress' and phase='persisting') then
    raise exception 'TEST_RADAR_ATOMIC_MULTI_BATCH_PARTIAL_WRITE';
  end if;

  -- Una página histórica temporalmente no disponible deja su padre incompleto,
  -- pero no puede bloquear la promoción atómica de una hermana completa del
  -- mismo proveedor. El resultado del proveedor debe ser parcial y reanudable,
  -- y el replay no puede duplicar la candidata ya promovida.
  perform public.finalize_market_radar_refresh_v5(
    rollback_request_id,'polymarket','candidate_feed',rollback_lease,
    'unavailable','RADAR_TEST_ABORT','persistence',null
  );
  perform set_config('request.jwt.claims',jsonb_build_object(
    'sub',admin_id,'role','authenticated'
  )::text,true);
  perform public.claim_market_radar_provider_probe_v1(
    'polymarket','candidate_feed',pagination_partial_request_id
  );
  process_started:=public.begin_market_radar_refresh_v2(
    pagination_partial_request_id,'polymarket','candidate_feed',repeat('1',64),
    'atinara-radar-v3:test-parent-pagination-partial','atinara-radar-v3',
    'atinara-prediction-policy-v5',gen_random_uuid()
  );
  pagination_partial_lease:=(process_started ->> 'lease_token')::uuid;
  incomplete_issue:=private.market_workflow_server_issue_v1(
    'RADAR_PARENT_RECONCILIATION_INCOMPLETE','radar','provider',
    'auto_recoverable','approval','retry_provider_refresh',
    jsonb_build_object('provider_parent_id','parent-1','pagination_exhausted',false),
    true,'atinara-radar-parent-reconciliation-v1'
  );
  pagination_partial_parent:=process_parent||jsonb_build_object(
    'provider_pagination_exhausted',false,
    'reconciliation_status','provider_unavailable',
    'reconciliation_fingerprint',repeat('2',64),
    'next_retry_at',clock_timestamp()+interval '5 minutes',
    'issue',incomplete_issue
  );
  perform set_config('request.jwt.claims','{"role":"service_role"}',true);
  perform public.record_market_radar_provider_selection_v1(
    pagination_partial_request_id,'polymarket','candidate_feed',pagination_partial_lease,
    jsonb_build_object(
      'policy_version','atinara-radar-parent-selection-v1','total_parent_count',2,
      'selected_parent_count',2,'deferred_parent_count',0,'selected_child_count',4,
      'no_parent_truncated',true,
      'selected_parent_ids',jsonb_build_array('parent-1','parent-3'),
      'deferred_parent_ids','[]'::jsonb
    )
  );
  response:=public.record_market_radar_parent_reconciliations_v1(
    pagination_partial_request_id,'polymarket','candidate_feed',pagination_partial_lease,
    jsonb_build_array(pagination_partial_parent,parent_value)
  );
  if response ->> 'incomplete_parent_count'<>'1'
     or (select provider_pagination_exhausted
       from private.market_radar_refresh_intents_v1
       where request_id=pagination_partial_request_id) is not false then
    raise exception 'TEST_RADAR_PARTIAL_PARENT_MANIFEST_INVALID:%',response;
  end if;
  valid_candidate:=valid_candidate||jsonb_build_object(
    'cache_key','atinara-radar-v3:test-parent-pagination-partial'
  );
  perform public.declare_market_radar_refresh_manifest_v1(
    pagination_partial_request_id,'polymarket','candidate_feed',pagination_partial_lease,1
  );
  perform public.stage_market_radar_refresh_batch_v1(
    pagination_partial_request_id,'polymarket','candidate_feed',pagination_partial_lease,0,
    jsonb_build_array(jsonb_build_object(
      'candidate',valid_candidate,'eligibility_check',valid_eligibility
    ))
  );
  perform public.seal_market_radar_refresh_v1(
    pagination_partial_request_id,'polymarket','candidate_feed',pagination_partial_lease,1
  );
  process_result:=public.process_market_radar_refresh_batch_v3(
    pagination_partial_request_id,'polymarket','candidate_feed',pagination_partial_lease
  );
  if process_result ->> 'processed'<>'true'
     or process_result ->> 'accepted_count'<>'1'
     or process_result ->> 'remaining_batches'<>'0'
     or process_result ->> 'batch_commit_version'<>'atinara-radar-batch-commit-v1'
     or not exists (
       select 1 from private.external_market_candidates candidate
       where candidate.provider='polymarket' and candidate.external_id='3-1'
         and candidate.current_parent_reconciliation_id is not null
         and not private.market_radar_candidate_reconciliation_ready_v1(candidate)
     ) then
    raise exception 'TEST_RADAR_BATCH_COMMIT_VISIBILITY_INVALID:%',process_result;
  end if;
  pagination_partial_result:=public.complete_market_radar_candidate_refresh_v2(
    pagination_partial_request_id,'polymarket','candidate_feed',pagination_partial_lease,
    'available',null,null,null
  );
  if pagination_partial_result ->> 'status'<>'partial_error'
     or pagination_partial_result ->> 'outcome'<>'partial'
     or pagination_partial_result #>> '{issue,issue_code}'
       <>'RADAR_PARENT_RECONCILIATION_INCOMPLETE'
     or pagination_partial_result ->> 'atomic_candidate_commit'<>'true'
     or pagination_partial_result ->> 'provider_visibility_committed'<>'true'
     or not exists (
       select 1 from private.external_market_candidates candidate
       join private.market_radar_parent_reconciliations_v1 parent_alias
         on parent_alias.id=candidate.current_parent_reconciliation_id
       where candidate.provider='polymarket' and candidate.external_id='3-1'
         and parent_alias.request_id=pagination_partial_request_id
         and parent_alias.reconciliation_status='complete'
         and private.market_radar_candidate_reconciliation_ready_v1(candidate)
     ) then
    raise exception 'TEST_RADAR_PARTIAL_PARENT_DID_NOT_ISOLATE:%',pagination_partial_result;
  end if;
  replay:=public.complete_market_radar_candidate_refresh_v2(
    pagination_partial_request_id,'polymarket','candidate_feed',pagination_partial_lease,
    'available',null,null,null
  );
  if replay ->> 'status'<>'partial_error'
     or replay ->> 'outcome'<>'partial'
     or replay ->> 'replayed'<>'true'
     or (select count(*) from private.external_market_candidates
       where provider='polymarket' and external_id='3-1')<>1 then
    raise exception 'TEST_RADAR_PARTIAL_PARENT_REPLAY_INVALID:%',replay;
  end if;

  select jsonb_build_object(
    'markets',(select coalesce(md5(string_agg(md5(to_jsonb(value)::text),'' order by to_jsonb(value)::text)),md5('')) from public.markets value),
    'predictions',(select coalesce(md5(string_agg(md5(to_jsonb(value)::text),'' order by to_jsonb(value)::text)),md5('')) from public.predictions value),
    'profiles',(select coalesce(md5(string_agg(md5(to_jsonb(value)::text),'' order by to_jsonb(value)::text)),md5('')) from public.profiles value),
    'maker',(select coalesce(md5(string_agg(md5(to_jsonb(value)::text),'' order by to_jsonb(value)::text)),md5('')) from public.market_maker_state value),
    'prices',(select coalesce(md5(string_agg(md5(to_jsonb(value)::text),'' order by to_jsonb(value)::text)),md5('')) from public.market_price_history value)
  ) into after_economic;
  if before_economic is distinct from after_economic then
    raise exception 'TEST_RADAR_PARENT_RECONCILIATION_ECONOMIC_MUTATION';
  end if;
end;
$test$;

rollback;
