-- V6: incidencias, temporalidad, familias, paginación y autoridad humana.
-- Solo base local/de prueba. Todo el ejercicio termina en ROLLBACK.
begin;
set local lock_timeout='5s';
set local statement_timeout='120s';

do $test$
declare
  admin_id uuid;
  suffix text:=replace(gen_random_uuid()::text,'-','');
  issue jsonb;
  issue_id_value uuid;
  changed_issue jsonb;
  changed_issue_id uuid;
  issue_list jsonb;
  candidate_ids uuid[]:='{}'::uuid[];
  candidate_id uuid;
  check_id bigint;
  checked_at_value timestamptz;
  eligibility_expires_at_value timestamptz;
  page_one jsonb;
  page_two jsonb;
  draft_result jsonb;
  draft_replay jsonb;
  recovery_result jsonb;
  confirmation_result jsonb;
  publication_result jsonb;
  publication_replay jsonb;
  publication_request_id uuid:=gen_random_uuid();
  draft_id uuid;
  expert_run_id uuid:=gen_random_uuid();
  placeholder_run_id uuid:=gen_random_uuid();
  identity_run_id uuid:=gen_random_uuid();
  expected_failure boolean:=false;
  registry_hash_before text:=private.market_agent_registry_hash_v2();
  registry_hash_after text;
  question_value text;
  external_id_value text;
  parent_index integer;
  child_index integer;
  candidate_snapshot private.external_market_candidates%rowtype;
  draft_input_value jsonb;
  placeholder_issue jsonb;
  identity_issue jsonb;
  identity_draft_result jsonb;
  mismatch_field text;
  seed_draft private.market_drafts%rowtype;
  clean_draft private.market_drafts%rowtype;
  scheduled_happy_draft private.market_drafts%rowtype;
  clean_payload jsonb;
  scheduled_edit_payload jsonb;
  clean_result jsonb;
  review_begin jsonb;
  review_recorded jsonb;
  review_attempt_id uuid;
  technical_issue jsonb;
  technical_issue_id uuid;
  stale_attempt_id uuid;
  stale_version bigint;
  loop_index integer;
  first_missing_attempt integer;
  issue_projection jsonb;
  publication_issue jsonb;
  temporal_contract_id bigint;
  classification_case jsonb;
  repair_attempt_id uuid:=gen_random_uuid();
  publication_issue_id uuid;
  repair_completion jsonb;
  ephemeral_issue_id uuid:=gen_random_uuid();
  effective_review_id_value bigint;
  sibling_label_value text;
  resume_attempt_id uuid:=gen_random_uuid();
  resume_request_key uuid:=gen_random_uuid();
  resume_review_attempt_id uuid;
  previous_version_fingerprint text;
  recovery_attempt_id uuid:=gen_random_uuid();
  recurrence_issue jsonb;
  recurrence_issue_id uuid;
  recurrence_reopened_id uuid;
  domain_review_request_id uuid:=gen_random_uuid();
  domain_review_out_request_id uuid:=gen_random_uuid();
  domain_review_correction_request_id uuid:=gen_random_uuid();
  domain_review_result jsonb;
  domain_review_list jsonb;
  other_provider text;
  other_external_id text;
  terminal_issue_id uuid;
  source_registry_id uuid;
  baseline_source_check_id uuid;
  current_source_check_id uuid;
  evidence_revalidation_request_id uuid:=gen_random_uuid();
  scheduled_revalidation_request_id uuid;
  scheduled_baseline_source_check_id uuid;
  scheduled_current_source_check_id uuid;
  evidence_revalidation_result jsonb;
  procedure_oid regprocedure;
  authenticated_only regprocedure[]:=array[
    'public.get_admin_market_draft_v2(uuid)'::regprocedure,
    'public.list_market_radar_candidates_v3(text,text,text,text,text,text,integer,integer)'::regprocedure,
    'public.publish_market_draft_v2(uuid,bigint,timestamptz,uuid)'::regprocedure,
    'public.retry_scheduled_market_publication_v1(uuid)'::regprocedure,
    'public.cancel_scheduled_market_publication_v1(uuid)'::regprocedure,
    'public.archive_terminal_market_draft_v1(uuid,bigint)'::regprocedure,
    'public.review_market_radar_domain_v1(uuid,bigint,text,text,text,jsonb,uuid,uuid)'::regprocedure,
    'public.save_market_draft_from_expert_with_issues_v1(uuid,uuid,jsonb)'::regprocedure,
    'public.confirm_market_draft_review_v2(uuid,bigint)'::regprocedure,
    'public.apply_market_draft_expert_repair_with_checkpoint_v1(uuid,bigint,jsonb,jsonb,jsonb,uuid,jsonb,uuid,smallint,uuid,uuid,jsonb)'::regprocedure,
    'public.checkpoint_market_draft_repair_noop_v1(uuid,uuid,bigint,smallint,uuid,uuid,jsonb)'::regprocedure,
    'public.begin_market_draft_repair_workflow_v1(uuid,bigint,uuid)'::regprocedure
  ];
  service_only regprocedure[]:=array[
    'public.attach_market_workflow_issues_v1(text,text,text,text,jsonb)'::regprocedure,
    'public.attach_market_review_workflow_issues_v1(uuid,bigint,uuid,jsonb)'::regprocedure,
    'public.transition_market_workflow_issue_v1(uuid,text,text,text,text,text,jsonb)'::regprocedure,
    'public.record_market_draft_review_with_issues_v1(uuid,text,jsonb,jsonb,uuid,text,jsonb,jsonb)'::regprocedure,
    'public.publish_due_market_drafts_v2(integer)'::regprocedure,
    'public.complete_market_draft_repair_workflow_v1(uuid,text,text,text,boolean,text,text,bigint,text,jsonb,uuid,text,text,text,text,text)'::regprocedure,
    'public.reconcile_market_draft_repair_workflow_v1(uuid)'::regprocedure,
    'public.prepare_market_draft_repair_revalidation_v1(uuid,smallint)'::regprocedure,
    'public.revalidate_market_draft_publication_evidence_v1(uuid,bigint,text,jsonb,uuid,uuid,uuid)'::regprocedure,
    'public.get_market_draft_publication_evidence_revalidation_replay_v1(uuid,bigint,text,jsonb,uuid,uuid)'::regprocedure,
    'public.recover_market_draft_radar_eligibility_v1(uuid,bigint,text,uuid,uuid,uuid)'::regprocedure
    ,'public.get_market_draft_eligibility_recovery_replay_v1(uuid,uuid,bigint,text,uuid)'::regprocedure,
    'public.get_market_radar_domain_reviews_v1(jsonb)'::regprocedure
  ];
  authenticated_and_service regprocedure[]:=array[
    'public.get_market_workflow_issues_v1(text,text,text)'::regprocedure
  ];
  internal_only regprocedure[]:=array[
    'public.confirm_market_draft_review(uuid,bigint)'::regprocedure,
    'public.publish_market_draft(uuid,bigint,timestamptz)'::regprocedure,
    'public.publish_due_market_drafts(integer)'::regprocedure,
    'public.record_market_draft_review_v2(uuid,text,jsonb,jsonb,uuid,text,jsonb)'::regprocedure,
    'public.apply_market_draft_expert_repair_v2(uuid,bigint,jsonb,jsonb,jsonb,uuid,jsonb)'::regprocedure,
    'public.begin_market_draft_repair_attempt_v1(uuid,bigint,uuid)'::regprocedure,
    'public.complete_market_draft_repair_attempt_v1(uuid,text,text,text,boolean,text,text,bigint,text,jsonb)'::regprocedure,
    'public.project_market_draft_repair_outcome_v1(uuid,bigint,text,text,text,uuid)'::regprocedure
  ];
  private_functions regprocedure[]:=array[
    'private.reject_market_workflow_append_only_v1()'::regprocedure,
    'private.record_market_workflow_issue_v1(text,text,text,text,jsonb,text,text)'::regprocedure,
    'private.link_market_workflow_issue_subject_v1(uuid,text,text,text,text)'::regprocedure,
    'private.capture_market_radar_provider_workflow_v1()'::regprocedure,
    'private.capture_market_radar_workflow_v1()'::regprocedure,
    'private.preserve_market_radar_terminal_workflow_v1()'::regprocedure,
    'private.capture_market_expert_workflow_v1()'::regprocedure,
    'private.project_market_draft_workflow_v1()'::regprocedure,
    'private.capture_market_draft_workflow_v1()'::regprocedure,
    'private.serialize_market_draft_primary_source_check_v1()'::regprocedure,
    'private.market_draft_primary_source_check_is_current_v1(uuid,uuid,bigint)'::regprocedure,
    'private.market_draft_publication_source_ready_v1(uuid,bigint,boolean)'::regprocedure,
    'private.market_family_option_from_question_v1(text)'::regprocedure,
    'private.assign_market_candidate_family_v4()'::regprocedure,
    'private.advance_market_draft_workflow_issues_v1(uuid,bigint,text[],text[],text,text,text,text,uuid)'::regprocedure,
    'private.market_workflow_server_issue_v1(text,text,text,text,text,text,jsonb,boolean,text)'::regprocedure,
    'private.market_workflow_canonical_json_v1(jsonb)'::regprocedure,
    'private.market_draft_blocking_workflow_issue_v1(uuid,bigint,text[])'::regprocedure,
    'private.capture_official_opportunity_workflow_v1()'::regprocedure,
    'private.publication_issue_v1(uuid,bigint,text)'::regprocedure,
    'private.assert_market_candidate_draft_identity_v1(uuid,jsonb)'::regprocedure,
    'private.assert_repair_checkpoint_issue_scope_v1(uuid,bigint,jsonb)'::regprocedure,
    'private.market_draft_has_blocking_workflow_issue_v1(uuid,bigint,text[])'::regprocedure,
    'private.market_draft_workflow_authority_gate_v1()'::regprocedure
  ];
begin
  if to_regclass('private.market_workflow_issue_occurrences_v1') is null
     or to_regclass('private.market_workflow_issue_events_v1') is null
     or to_regclass('private.market_radar_temporal_contracts_v1') is null
     or to_regclass('private.market_radar_domain_reviews_v1') is null
     or to_regclass('private.market_publication_attempts_v1') is null
     or to_regclass('private.market_repair_workflow_checkpoints_v1') is null then
    raise exception 'TEST_MARKET_WORKFLOW_SCHEMA_MISSING';
  end if;
  if not exists (select 1 from pg_catalog.pg_trigger trigger_row
    where trigger_row.tgrelid='private.market_draft_primary_source_checks'::regclass
      and trigger_row.tgname='aa_serialize_market_draft_primary_source_check_v1'
      and not trigger_row.tgisinternal) then
    raise exception 'TEST_PRIMARY_SOURCE_CHECK_SERIALIZATION_TRIGGER_MISSING';
  end if;
  if exists (
    select 1 from pg_catalog.pg_class relation
    join pg_catalog.pg_namespace namespace on namespace.oid=relation.relnamespace
    where namespace.nspname='private'
      and relation.relname in ('market_workflow_issue_occurrences_v1',
        'market_workflow_issue_events_v1','market_radar_temporal_contracts_v1',
        'market_radar_domain_reviews_v1',
        'market_publication_attempts_v1','market_repair_workflow_checkpoints_v1')
      and (not relation.relrowsecurity or not relation.relforcerowsecurity
        or pg_catalog.pg_get_userbyid(relation.relowner)<>'postgres')
  ) then raise exception 'TEST_MARKET_WORKFLOW_RLS_INVALID'; end if;
  if has_table_privilege('service_role','private.market_workflow_issue_occurrences_v1','select')
     or has_table_privilege('authenticated','private.market_radar_domain_reviews_v1','select')
     or has_table_privilege('authenticated','private.market_publication_attempts_v1','select')
     or has_function_privilege('anon','public.get_market_workflow_issues_v1(text,text,text)','execute')
     or has_function_privilege('service_role','public.list_market_radar_candidates_v3(text,text,text,text,text,text,integer,integer)','execute') then
    raise exception 'TEST_MARKET_WORKFLOW_ACL_INVALID';
  end if;
  foreach procedure_oid in array authenticated_only loop
    if has_function_privilege('anon',procedure_oid,'execute')
       or not has_function_privilege('authenticated',procedure_oid,'execute')
       or has_function_privilege('service_role',procedure_oid,'execute') then
      raise exception 'TEST_MARKET_WORKFLOW_AUTHENTICATED_ACL_INVALID:%',procedure_oid;
    end if;
  end loop;
  foreach procedure_oid in array service_only loop
    if has_function_privilege('anon',procedure_oid,'execute')
       or has_function_privilege('authenticated',procedure_oid,'execute')
       or not has_function_privilege('service_role',procedure_oid,'execute') then
      raise exception 'TEST_MARKET_WORKFLOW_SERVICE_ACL_INVALID:%',procedure_oid;
    end if;
  end loop;
  foreach procedure_oid in array authenticated_and_service loop
    if has_function_privilege('anon',procedure_oid,'execute')
       or not has_function_privilege('authenticated',procedure_oid,'execute')
       or not has_function_privilege('service_role',procedure_oid,'execute') then
      raise exception 'TEST_MARKET_WORKFLOW_SHARED_ACL_INVALID:%',procedure_oid;
    end if;
  end loop;
  foreach procedure_oid in array private_functions loop
    if has_function_privilege('anon',procedure_oid,'execute')
       or has_function_privilege('authenticated',procedure_oid,'execute')
       or has_function_privilege('service_role',procedure_oid,'execute') then
      raise exception 'TEST_MARKET_WORKFLOW_PRIVATE_ACL_INVALID:%',procedure_oid;
    end if;
  end loop;
  if exists (
    select 1 from pg_proc procedure join pg_roles owner on owner.oid=procedure.proowner
    where procedure.oid=any((authenticated_only||service_only
      ||authenticated_and_service||private_functions||internal_only)::oid[])
      and (owner.rolname<>'postgres' or not procedure.prosecdef
        or not (procedure.proconfig@>array['search_path=""']::text[]))
  ) then raise exception 'TEST_MARKET_WORKFLOW_FUNCTION_SECURITY_INVALID'; end if;
  foreach procedure_oid in array internal_only loop
    if has_function_privilege('anon',procedure_oid,'execute')
       or has_function_privilege('authenticated',procedure_oid,'execute')
       or has_function_privilege('service_role',procedure_oid,'execute') then
      raise exception 'TEST_MARKET_WORKFLOW_INTERNAL_ACL_INVALID:%',procedure_oid;
    end if;
  end loop;

  select id into admin_id from auth.users
  where coalesce((raw_app_meta_data ->> 'oraklo_admin')::boolean,false)
  order by created_at limit 1;
  if admin_id is null then raise exception 'ADMIN_FIXTURE_REQUIRED'; end if;

  issue:=private.market_workflow_server_issue_v1(
    'TEMPORAL_AUTHORITATIVE_DATE_REQUIRED','radar','editor','human_editable','approval',
    'resolve_temporal_contract',jsonb_build_object('source_close_at','2027-12-31T00:00:00Z'),
    true,'atinara-temporal-semantics-v1'
  );
  issue_id_value:=private.record_market_workflow_issue_v1(
    'radar_candidate','fixture-'||suffix,'1',repeat('a',64),issue,null,null
  );
  if issue_id_value is null or private.record_market_workflow_issue_v1(
    'radar_candidate','fixture-'||suffix,'1',repeat('a',64),issue,null,null
  ) is distinct from issue_id_value then
    raise exception 'TEST_MARKET_WORKFLOW_EXACT_REPLAY_FAILED';
  end if;
  expected_failure:=false;
  begin
    perform private.record_market_workflow_issue_v1(
      'radar_candidate','fixture-'||suffix,'1',repeat('9',64),issue,null,null
    );
  exception when sqlstate '40001' then
    if sqlerrm<>'MARKET_WORKFLOW_SUBJECT_FINGERPRINT_CONFLICT' then raise; end if;
    expected_failure:=true;
  end;
  if not expected_failure then
    raise exception 'TEST_MARKET_WORKFLOW_SUBJECT_FINGERPRINT_REUSE_ACCEPTED';
  end if;
  changed_issue:=jsonb_set(issue,'{issue_id}',to_jsonb(gen_random_uuid()),true);
  changed_issue:=jsonb_set(changed_issue,'{fingerprint}',to_jsonb(repeat('b',64)),true);
  changed_issue_id:=private.record_market_workflow_issue_v1(
    'radar_candidate','fixture-'||suffix,'1',repeat('a',64),changed_issue,null,null
  );
  if changed_issue_id=issue_id_value or not exists (
    select 1 from private.market_workflow_issue_events_v1
    where issue_id=issue_id_value and new_status='superseded'
  ) then raise exception 'TEST_MARKET_WORKFLOW_SUPERSESSION_FAILED'; end if;

  recurrence_issue:=private.market_workflow_server_issue_v1(
    'PUBLICATION_TECHNICAL_FAILURE','publication_gate','internal_platform',
    'auto_recoverable','publication','retry_market_publication',
    jsonb_build_object('draft_id','recurrence-'||suffix),true,'atinara-publication-gate-v1'
  );
  recurrence_issue_id:=private.record_market_workflow_issue_v1(
    'market_draft','recurrence-'||suffix,'1',repeat('7',64),recurrence_issue,null,null
  );
  perform set_config('request.jwt.claims','{"role":"service_role"}',true);
  execute 'set local role service_role';
  perform public.transition_market_workflow_issue_v1(
    recurrence_issue_id,'open','resolved','internal_platform','retry_market_publication',
    'technical_retry_reconciled','[]'::jsonb
  );
  execute 'reset role';
  recurrence_issue:=private.market_workflow_server_issue_v1(
    'PUBLICATION_TECHNICAL_FAILURE','publication_gate','internal_platform',
    'auto_recoverable','publication','retry_market_publication',
    jsonb_build_object('draft_id','recurrence-'||suffix),true,'atinara-publication-gate-v1'
  );
  recurrence_reopened_id:=private.record_market_workflow_issue_v1(
    'market_draft','recurrence-'||suffix,'1',repeat('7',64),recurrence_issue,null,null
  );
  if recurrence_reopened_id=recurrence_issue_id
     or not exists (select 1 from private.market_workflow_issue_events_v1 event
       where event.issue_id=recurrence_reopened_id and event.new_status='open') then
    raise exception 'TEST_MARKET_WORKFLOW_RECURRING_ISSUE_NOT_REOPENED';
  end if;
  classification_case:=private.market_workflow_server_issue_v1(
    'PUBLICATION_TECHNICAL_FAILURE','publication_gate','internal_platform',
    'auto_recoverable','publication','retry_market_publication',jsonb_build_object(
      'draft_id','00000000-0000-4000-8000-000000000001','expected_version',2
    ),true,'atinara-publication-gate-v1'
  );
  if classification_case ->> 'fingerprint'<>
     'be7bc38e9c4986db1ea7551c8a5d92c293ef51383c72859c945a5c7f88abc71d' then
    raise exception 'TEST_MARKET_WORKFLOW_SQL_DENO_FINGERPRINT_DRIFT:%',classification_case;
  end if;

  perform set_config('request.jwt.claims',jsonb_build_object(
    'role','authenticated','sub',admin_id)::text,true);
  execute 'set local role authenticated';
  expected_failure:=false;
  begin
    perform public.transition_market_workflow_issue_v1(
      changed_issue_id,'open','waiting','editor','resolve_temporal_contract',null,'[]'::jsonb
    );
  exception when sqlstate '42501' then
    expected_failure:=true;
  end;
  execute 'reset role';
  if not expected_failure then raise exception 'TEST_MARKET_WORKFLOW_ADMIN_TRANSITION_ACCEPTED'; end if;
  perform set_config('request.jwt.claims','{"role":"service_role"}',true);
  execute 'set local role service_role';
  perform public.transition_market_workflow_issue_v1(
    changed_issue_id,'open','waiting','corrector','repair_temporal_or_source_contract',null,'[]'::jsonb
  );
  execute 'reset role';
  perform set_config('request.jwt.claims',jsonb_build_object(
    'role','authenticated','sub',admin_id)::text,true);
  execute 'set local role authenticated';
  issue_list:=public.get_market_workflow_issues_v1('radar_candidate','fixture-'||suffix,'1');
  execute 'reset role';
  if jsonb_array_length(issue_list)<>2
     or not exists (select 1 from jsonb_array_elements(issue_list) value
       where value ->> 'issue_id'=changed_issue_id::text and value ->> 'status'='waiting') then
    raise exception 'TEST_MARKET_WORKFLOW_PROJECTION_INVALID:%',issue_list;
  end if;
  expected_failure:=false;
  begin update private.market_workflow_issue_occurrences_v1 set status='resolved'
    where issue_id=changed_issue_id;
  exception when sqlstate '55000' then expected_failure:=true; end;
  if not expected_failure then raise exception 'TEST_MARKET_WORKFLOW_APPEND_ONLY_BYPASSED'; end if;

  -- Dos padres con dos hijas cada uno: la página de un padre nunca corta hijas.
  for parent_index in 1..2 loop
    for child_index in 1..2 loop
      question_value:=case when parent_index=1 and child_index=2
        then 'Will Fixture Game 1-1 II win Best Multiplayer at The Game Awards?'
        else format('Will Fixture Game %s-%s win Best Multiplayer at The Game Awards?',parent_index,child_index)
      end;
      external_id_value:=format('workflow-%s-%s-%s',suffix,parent_index,child_index);
      insert into private.external_market_candidates(
        provider,external_id,fingerprint,cache_key,normalizer_version,normalized_payload,
        atinara_category,event_group_key,
        quality_status,quality_score,fetched_at,expires_at,state,verification_status,
        verification_evidence,eligibility_evidence
      ) values (
        case when child_index=1 then 'kalshi' else 'polymarket' end,
        external_id_value,repeat(substr(parent_index::text,1,1),64),'workflow-v1',
        'atinara-radar-v2',jsonb_build_object(
          'source_title','The Game Awards: Best Multiplayer',
          'source_question',question_value,'atinara_question',question_value,
          'domain_review_fingerprint',repeat('9',64),
          'event_group_key',format('workflow-parent-%s-%s',suffix,parent_index),
          'atinara_category','Reviews/Premios','source_volume_total',100-parent_index,
          'family_key','atinara:v4:the-game-awards-best-multiplayer:outcome',
          'family_child_key',format('option:fixture-game-%s-%s',parent_index,child_index),
          'family_version','atinara-market-family-v4',
          'atinara_resolution_source_url','https://thegameawards.com/'
        ),'Reviews/Premios',format('workflow-parent-%s-%s',suffix,parent_index),
        'fit',90-parent_index,clock_timestamp(),clock_timestamp()+interval '2 days',
        'available','verified_open','[]'::jsonb,jsonb_build_array(jsonb_build_object(
          'title','The Game Awards · fixture oficial','url','https://thegameawards.com/',
          'source_type','official','retrieval_status','verified_content',
          'evidence_basis','retrieved_content','parser_version','atinara-official-content-v1',
          'content_sha256',repeat('d',64),'claim_status','direct','direct_claim',true,
          'claim_verifiable',true
        ))
      ) returning id into candidate_id;
      insert into private.market_radar_eligibility_checks(
        attempt_id,candidate_id,provider,external_id,event_group_key,policy_version,status,
        reason_code,reason,evidence,checked_at,expires_at,decision_hash
      ) values (
        gen_random_uuid(),candidate_id,case when child_index=1 then 'kalshi' else 'polymarket' end,
        external_id_value,format('workflow-parent-%s-%s',suffix,parent_index),
        'atinara-prediction-policy-v5','eligible',null,null,'[]'::jsonb,
        clock_timestamp(),clock_timestamp()+interval '1 day',repeat('c',64)
      ) returning id,checked_at,expires_at
        into check_id,checked_at_value,eligibility_expires_at_value;
      update private.external_market_candidates set
        current_eligibility_check_id=check_id,eligibility_status='eligible',
        eligibility_policy_version='atinara-prediction-policy-v5',
        eligibility_checked_at=checked_at_value,
        eligibility_expires_at=eligibility_expires_at_value
      where id=candidate_id;
      candidate_ids:=array_append(candidate_ids,candidate_id);
    end loop;
  end loop;
  perform set_config('request.jwt.claims',jsonb_build_object(
    'role','authenticated','sub',admin_id)::text,true);
  execute 'set local role authenticated';
  page_one:=public.list_market_radar_candidates_v3(null,'Reviews/Premios','fit',
    'Fixture Game','recommended','365d',1,0);
  page_two:=public.list_market_radar_candidates_v3(null,'Reviews/Premios','fit',
    'Fixture Game','recommended','365d',1,1);
  execute 'reset role';
  if (page_one ->> 'parent_count')::integer<>0
     or jsonb_array_length(page_one -> 'items')<>0
     or jsonb_array_length(page_two -> 'items')<>0 then
    raise exception 'TEST_RADAR_LEGACY_PARENT_PROJECTION_VISIBLE:%:%',page_one,page_two;
  end if;
  if exists (
    select 1 from private.external_market_candidates candidate
    where candidate.id=any(candidate_ids)
      and candidate.family_child_key not like 'option:%'
  ) then raise exception 'TEST_RADAR_QUESTION_OPTION_IDENTITY_INVALID'; end if;

  -- La revisión humana de dominio queda ligada a candidato+huella, es
  -- idempotente, no acepta payloads sensibles y nunca crea un borrador.
  select * into candidate_snapshot from private.external_market_candidates where id=candidate_ids[3];
  issue:=private.market_workflow_server_issue_v1(
    'GAMING_DOMAIN_REVIEW_REQUIRED','radar','human_review','human_editable','approval',
    'review_gaming_domain_manually',jsonb_build_object('candidate_id',candidate_snapshot.id),
    true,'atinara-gaming-domain-v1'
  );
  issue_id_value:=private.record_market_workflow_issue_v1(
    'radar_candidate',candidate_snapshot.id::text,candidate_snapshot.preparation_revision::text,
    candidate_snapshot.fingerprint,issue,null,null
  );
  perform set_config('request.jwt.claims',jsonb_build_object(
    'role','authenticated','sub',gen_random_uuid())::text,true);
  execute 'set local role authenticated';
  expected_failure:=false;
  begin
    perform public.review_market_radar_domain_v1(
      candidate_snapshot.id,candidate_snapshot.preparation_revision,candidate_snapshot.fingerprint,
      'in_domain','La categoría registrada y el sujeto prueban la relación temática.',
      jsonb_build_array(jsonb_build_object('url','https://thegameawards.com/','role','DOMAIN_CONTEXT')),
      domain_review_request_id
    );
  exception when sqlstate '42501' then expected_failure:=true; end;
  execute 'reset role';
  if not expected_failure then raise exception 'TEST_RADAR_DOMAIN_NON_ADMIN_ACCEPTED'; end if;
  perform set_config('request.jwt.claims',jsonb_build_object(
    'role','authenticated','sub',admin_id)::text,true);
  execute 'set local role authenticated';
  expected_failure:=false;
  begin
    perform public.review_market_radar_domain_v1(
      candidate_snapshot.id,candidate_snapshot.preparation_revision,candidate_snapshot.fingerprint,
      'in_domain','Bearer token=secret no debe persistirse nunca.',
      jsonb_build_array(jsonb_build_object('url','https://thegameawards.com/','role','DOMAIN_CONTEXT')),
      gen_random_uuid()
    );
  exception when sqlstate '22023' then expected_failure:=true; end;
  if not expected_failure then raise exception 'TEST_RADAR_DOMAIN_SECRET_ACCEPTED'; end if;
  domain_review_result:=public.review_market_radar_domain_v1(
    candidate_snapshot.id,candidate_snapshot.preparation_revision,candidate_snapshot.fingerprint,
    'in_domain','La taxonomía oficial y el sujeto verifican una relación temática inequívoca.',
    jsonb_build_array(jsonb_build_object('url','https://thegameawards.com/','role','DOMAIN_CONTEXT')),
    domain_review_request_id
  );
  if domain_review_result ->> 'idempotency_replay'<>'false' then
    raise exception 'TEST_RADAR_DOMAIN_REVIEW_NOT_INSERTED:%',domain_review_result;
  end if;
  domain_review_result:=public.review_market_radar_domain_v1(
    candidate_snapshot.id,candidate_snapshot.preparation_revision,candidate_snapshot.fingerprint,
    'in_domain','La taxonomía oficial y el sujeto verifican una relación temática inequívoca.',
    jsonb_build_array(jsonb_build_object('url','https://thegameawards.com/','role','DOMAIN_CONTEXT')),
    domain_review_request_id
  );
  execute 'reset role';
  if domain_review_result ->> 'idempotency_replay'<>'true'
     or (select count(*) from private.market_radar_domain_reviews_v1 review
       where review.request_id=domain_review_request_id)<>1
     or (select eligibility_status from private.external_market_candidates
       where id=candidate_snapshot.id)<>'technical_hold'
     or not exists (select 1 from private.market_workflow_issue_events_v1 event
       where event.issue_id=issue_id_value and event.new_status='resolved') then
    raise exception 'TEST_RADAR_DOMAIN_REVIEW_REPLAY_INVALID:%',domain_review_result;
  end if;
  select provider,external_id into other_provider,other_external_id
  from private.external_market_candidates where id=candidate_ids[4];
  perform set_config('request.jwt.claims','{"role":"service_role"}',true);
  execute 'set local role service_role';
  domain_review_list:=public.get_market_radar_domain_reviews_v1(jsonb_build_array(
    jsonb_build_object('provider',candidate_snapshot.provider,
      'external_id',candidate_snapshot.external_id,'domain_fingerprint',repeat('9',64)),
      jsonb_build_object('provider',other_provider,
        'external_id',other_external_id,
        'domain_fingerprint',repeat('9',64))
  ));
  execute 'reset role';
  if jsonb_array_length(domain_review_list)<>1
     or domain_review_list -> 0 ->> 'candidate_id'<>candidate_snapshot.id::text
     or domain_review_list -> 0 ->> 'rationale'
       <> 'La taxonomía oficial y el sujeto verifican una relación temática inequívoca.'
     or jsonb_array_length(domain_review_list -> 0 -> 'evidence_refs')<>1 then
    raise exception 'TEST_RADAR_DOMAIN_SCOPE_COLLISION:%',domain_review_list;
  end if;

  select * into candidate_snapshot from private.external_market_candidates where id=candidate_ids[4];
  issue:=private.market_workflow_server_issue_v1(
    'GAMING_DOMAIN_REVIEW_REQUIRED','radar','human_review','human_editable','approval',
    'review_gaming_domain_manually',jsonb_build_object('candidate_id',candidate_snapshot.id),
    true,'atinara-gaming-domain-v1'
  );
  perform private.record_market_workflow_issue_v1(
    'radar_candidate',candidate_snapshot.id::text,candidate_snapshot.preparation_revision::text,
    candidate_snapshot.fingerprint,issue,null,null
  );
  perform set_config('request.jwt.claims',jsonb_build_object(
    'role','authenticated','sub',admin_id)::text,true);
  execute 'set local role authenticated';
  expected_failure:=false;
  begin
    perform public.review_market_radar_domain_v1(
      candidate_snapshot.id,candidate_snapshot.preparation_revision,candidate_snapshot.fingerprint,
      'out_of_domain','La revisión humana concluye que la candidata pertenece a otro ámbito.',
      '[]'::jsonb,gen_random_uuid()
    );
  exception when sqlstate '22023' then expected_failure:=true; end;
  if not expected_failure then raise exception 'TEST_RADAR_DOMAIN_TERMINAL_WITHOUT_EVIDENCE_ACCEPTED'; end if;
  perform public.review_market_radar_domain_v1(
    candidate_snapshot.id,candidate_snapshot.preparation_revision,candidate_snapshot.fingerprint,
    'out_of_domain','La evidencia revisada demuestra que el sujeto pertenece a otro ámbito.',
    jsonb_build_array(jsonb_build_object('url','https://thegameawards.com/','role','DOMAIN_CONTEXT')),
    domain_review_out_request_id
  );
  execute 'reset role';
  if (select eligibility_status from private.external_market_candidates where id=candidate_snapshot.id)<>'terminal'
     or (select verification_status from private.external_market_candidates
       where id=candidate_snapshot.id)<>'rejected_ineligible'
     or (select eligibility_reason_code from private.external_market_candidates
       where id=candidate_snapshot.id)<>'OUTSIDE_GAMING_DOMAIN'
     or not exists (
       select 1 from private.market_workflow_issue_occurrences_v1 occurrence
       join private.market_workflow_issue_subject_links_v1 link on link.issue_id=occurrence.issue_id
       where occurrence.issue_code='OUTSIDE_GAMING_DOMAIN'
         and link.subject_type='radar_candidate' and link.subject_key=candidate_snapshot.id::text
     ) then raise exception 'TEST_RADAR_DOMAIN_OUT_DECISION_NOT_TERMINAL'; end if;
  select occurrence.issue_id into strict terminal_issue_id
  from private.market_workflow_issue_occurrences_v1 occurrence
  join private.market_workflow_issue_subject_links_v1 link on link.issue_id=occurrence.issue_id
  left join lateral (
    select event.new_status from private.market_workflow_issue_events_v1 event
    where event.issue_id=occurrence.issue_id
    order by event.occurred_at desc,event.id desc limit 1
  ) latest on true
  where occurrence.issue_code='OUTSIDE_GAMING_DOMAIN'
    and link.subject_type='radar_candidate' and link.subject_key=candidate_snapshot.id::text
    and coalesce(latest.new_status,'open') not in ('resolved','superseded');
  for loop_index in 1..2 loop
    update private.external_market_candidates set
      preparation_revision=preparation_revision+1,
      fingerprint=case when loop_index=2 then repeat('a',64) else fingerprint end,
      normalized_payload=jsonb_set(normalized_payload,'{workflow_issues}','[]'::jsonb,true)
    where id=candidate_snapshot.id;
    if (select eligibility_status from private.external_market_candidates
        where id=candidate_snapshot.id)<>'terminal'
       or not exists (
         select 1 from jsonb_array_elements((select normalized_payload -> 'workflow_issues'
           from private.external_market_candidates where id=candidate_snapshot.id)) current_issue
         where current_issue ->> 'issue_id'=terminal_issue_id::text
       )
       or not exists (
         select 1 from private.market_workflow_issue_occurrences_v1 occurrence
         left join lateral (
           select event.new_status from private.market_workflow_issue_events_v1 event
           where event.issue_id=occurrence.issue_id
           order by event.occurred_at desc,event.id desc limit 1
         ) latest on true
         where occurrence.issue_id=terminal_issue_id
           and coalesce(latest.new_status,'open') not in ('resolved','superseded')
       )
       or not exists (
         select 1 from private.market_workflow_issue_subject_links_v1 link
         where link.issue_id=terminal_issue_id and link.subject_type='radar_candidate'
           and link.subject_key=candidate_snapshot.id::text
           and link.subject_version=(candidate_snapshot.preparation_revision+loop_index)::text
       )
       or (select normalized_payload #>> '{human_domain_review,rationale}'
         from private.external_market_candidates where id=candidate_snapshot.id)
         <> 'La evidencia revisada demuestra que el sujeto pertenece a otro ámbito.'
       then raise exception 'TEST_RADAR_TERMINAL_WORKFLOW_REVIVED:%',loop_index; end if;
  end loop;
  select * into candidate_snapshot from private.external_market_candidates
  where id=candidate_snapshot.id;
  perform set_config('request.jwt.claims',jsonb_build_object(
    'role','authenticated','sub',admin_id)::text,true);
  execute 'set local role authenticated';
  domain_review_result:=public.review_market_radar_domain_v1(
    candidate_snapshot.id,candidate_snapshot.preparation_revision,candidate_snapshot.fingerprint,
    'in_domain','La revisión corregida y su evidencia registral confirman la relación gaming.',
    jsonb_build_array(jsonb_build_object('url','https://thegameawards.com/','role','DOMAIN_CONTEXT')),
    domain_review_correction_request_id,domain_review_out_request_id
  );
  execute 'reset role';
  if domain_review_result ->> 'supersedes_request_id'<>domain_review_out_request_id::text
     or (select count(*) from private.market_radar_domain_reviews_v1 review
       where review.candidate_id=candidate_snapshot.id)<>2
     or (select eligibility_status from private.external_market_candidates
       where id=candidate_snapshot.id)<>'technical_hold'
     or exists (
       select 1 from private.market_workflow_issue_occurrences_v1 occurrence
       left join lateral (
         select event.new_status from private.market_workflow_issue_events_v1 event
         where event.issue_id=occurrence.issue_id
         order by event.occurred_at desc,event.id desc limit 1
       ) latest on true
       where occurrence.issue_id=terminal_issue_id
         and coalesce(latest.new_status,'open') not in ('resolved','superseded')
     )
     or (select normalized_payload #>> '{human_domain_review,rationale}'
       from private.external_market_candidates where id=candidate_snapshot.id)
       <> 'La revisión corregida y su evidencia registral confirman la relación gaming.' then
    raise exception 'TEST_RADAR_DOMAIN_REVIEW_CORRECTION_INVALID:%',jsonb_build_object(
      'result',domain_review_result,
      'review_count',(select count(*) from private.market_radar_domain_reviews_v1 review
        where review.candidate_id=candidate_snapshot.id),
      'eligibility_status',(select eligibility_status from private.external_market_candidates
        where id=candidate_snapshot.id),
      'terminal_active',(select coalesce(latest.new_status,'open')
        from private.market_workflow_issue_occurrences_v1 occurrence
        left join lateral (select event.new_status from private.market_workflow_issue_events_v1 event
          where event.issue_id=occurrence.issue_id order by event.occurred_at desc,event.id desc limit 1) latest on true
        where occurrence.issue_id=terminal_issue_id),
      'active_terminal_issues',(select coalesce(jsonb_agg(jsonb_build_object(
          'id',occurrence.issue_id,'code',occurrence.issue_code,
          'status',coalesce(latest.new_status,'open'))),'[]'::jsonb)
        from private.market_workflow_issue_occurrences_v1 occurrence
        join private.market_workflow_issue_subject_links_v1 link on link.issue_id=occurrence.issue_id
        left join lateral (select event.new_status from private.market_workflow_issue_events_v1 event
          where event.issue_id=occurrence.issue_id order by event.occurred_at desc,event.id desc limit 1) latest on true
        where link.subject_type='radar_candidate' and link.subject_key=candidate_snapshot.id::text
          and (occurrence.repairability='terminal' or occurrence.blocking_scope='terminal')
          and coalesce(latest.new_status,'open') not in ('resolved','superseded')),
      'stored_rationale',(select normalized_payload #>> '{human_domain_review,rationale}'
        from private.external_market_candidates where id=candidate_snapshot.id)
    );
  end if;

  perform private.record_market_workflow_issue_v1(
    'radar_candidate',candidate_ids[1]::text,'1',repeat('1',64),changed_issue,null,null
  );
  select * into candidate_snapshot from private.external_market_candidates
  where id=candidate_ids[1];
  if candidate_snapshot.family_child_key not like 'option:%'
     or nullif(candidate_snapshot.family_child_label,'') is null then
    raise exception 'TEST_MARKET_WORKFLOW_CANDIDATE_IDENTITY_MISSING';
  end if;
  draft_input_value:=jsonb_build_object(
    'market_slug',private.market_family_option_slug_v1(candidate_snapshot.family_child_label)
      ||'-'||left(suffix,12),
    'question','¿Ganará '||candidate_snapshot.family_child_label
      ||' el premio Best Multiplayer en The Game Awards?',
    'subject',candidate_snapshot.family_child_label,
    'category','Reviews/Premios','yes_option','Sí','no_option','No',
    'evaluation_period_label','Hasta el 31 de diciembre de 2098 a las 23:59:59 UTC, inclusive',
    'evaluation_ends_at','2098-12-31T23:59:59.000Z',
    'timezone','UTC','resolution_deadline','2099-01-02T23:59:59.000Z',
    'yes_criteria','Sí si '||candidate_snapshot.family_child_label
      ||' gana oficialmente el premio.',
    'no_criteria','No si '||candidate_snapshot.family_child_label
      ||' no gana oficialmente el premio.',
    'edge_cases','Los retrasos se tratarán según la fuente oficial.',
    'primary_source',jsonb_build_object(
      'url','https://thegameawards.com/','role','PRIMARY_RESOLUTION'
    ),'alternative_sources',jsonb_build_array(jsonb_build_object(
      'url','https://www.youtube.com/@thegameawards','role','CORROBORATION'
    )),
    'public_criteria','Se resolverá según el resultado oficial de '
      ||candidate_snapshot.family_child_label||'.',
    '_idempotency_key',gen_random_uuid(),'_timestamp_precision','milliseconds-v1'
  );
  insert into private.market_expert_runs(
    id,origin_type,origin_id,origin_fingerprint,analysis_fingerprint,policy_version,
    schema_version,status,result_json,tool_summary
  ) values (
    expert_run_id,'radar_candidate',candidate_ids[1]::text,repeat('1',64),repeat('2',64),
    'atinara-market-constitution-v1','atinara-market-expert-v1','completed',
    jsonb_build_object(
      'workflow_issues',jsonb_build_array(changed_issue),
      'decision','create_with_edits',
      'origin_analysis_fingerprint',repeat('1',64),
      'origin_source_fingerprint',candidate_snapshot.fingerprint,
      'origin_preparation_revision',candidate_snapshot.preparation_revision,
      'draft_gate',jsonb_build_object(
        'status','proposal_ready_with_issues','can_save_private_draft',true
      ),
      'reason_codes',jsonb_build_array(changed_issue ->> 'issue_code')
    ),'[]'::jsonb
  );
  placeholder_issue:=private.market_workflow_server_issue_v1(
    'PROVIDER_PLACEHOLDER','radar','radar','auto_recoverable','none',
    'recheck_provider_identity',jsonb_build_object('candidate_id',candidate_ids[1]),
    true,'atinara-gaming-domain-v1'
  );
  insert into private.market_expert_runs(
    id,origin_type,origin_id,origin_fingerprint,analysis_fingerprint,policy_version,
    schema_version,status,result_json,tool_summary
  ) values (
    placeholder_run_id,'radar_candidate',candidate_ids[1]::text,repeat('1',64),repeat('3',64),
    'atinara-market-constitution-v1','atinara-market-expert-v1','completed',
    jsonb_build_object(
      'workflow_issues',jsonb_build_array(placeholder_issue),
      'decision','abstain','origin_analysis_fingerprint',repeat('1',64),
      'origin_source_fingerprint',candidate_snapshot.fingerprint,
      'origin_preparation_revision',candidate_snapshot.preparation_revision,
      'draft_gate',jsonb_build_object(
        'status','candidate_blocked_recoverable','can_save_private_draft',false
      ),'reason_codes',jsonb_build_array('PROVIDER_PLACEHOLDER')
    ),'[]'::jsonb
  );
  perform set_config('request.jwt.claims',jsonb_build_object(
    'role','authenticated','sub',admin_id)::text,true);
  execute 'set local role authenticated';
  execute 'reset role';
  expected_failure:=false;
  begin
    perform public.save_market_draft_from_expert_with_issues_pre_parent_v1(
      candidate_ids[1],placeholder_run_id,
      jsonb_set(draft_input_value,'{_idempotency_key}',to_jsonb(gen_random_uuid()),true)
    );
  exception when sqlstate '55000' then
    if sqlerrm<>'PRIVATE_ISSUE_DRAFT_NOT_ALLOWED' then raise; end if;
    expected_failure:=true;
  end;
  if not expected_failure then raise exception 'TEST_MARKET_WORKFLOW_PLACEHOLDER_DRAFT_ACCEPTED'; end if;
  foreach mismatch_field in array array[
    'question','subject','yes_criteria','no_criteria','public_criteria','market_slug'
  ] loop
    expected_failure:=false;
    begin
      perform public.save_market_draft_from_expert_with_issues_pre_parent_v1(
        candidate_ids[1],expert_run_id,
        jsonb_set(
          jsonb_set(draft_input_value,'{_idempotency_key}',to_jsonb(gen_random_uuid()),true),
          array[mismatch_field],to_jsonb('Otra opción sin relación'::text),true
        )
      );
    exception when sqlstate '55000' then
      if sqlerrm<>'CHILD_IDENTITY_MISMATCH' then raise; end if;
      expected_failure:=true;
    end;
    if not expected_failure then
      raise exception 'TEST_MARKET_WORKFLOW_CHILD_FIELD_MISMATCH_ACCEPTED:%',mismatch_field;
    end if;
  end loop;
  execute 'reset role';
  select family_child_label into sibling_label_value
  from private.external_market_candidates where id=candidate_ids[2];
  perform set_config('request.jwt.claims',jsonb_build_object(
    'role','authenticated','sub',admin_id)::text,true);
  execute 'set local role authenticated';
  execute 'reset role';
  expected_failure:=false;
  begin
    perform public.save_market_draft_from_expert_with_issues_pre_parent_v1(
      candidate_ids[1],expert_run_id,
      jsonb_set(
        jsonb_set(draft_input_value,'{_idempotency_key}',to_jsonb(gen_random_uuid()),true),
        '{yes_criteria}',to_jsonb('Sí si '||sibling_label_value||' gana oficialmente.'),true
      )
    );
  exception when sqlstate '55000' then
    if sqlerrm<>'CHILD_IDENTITY_MISMATCH' then raise; end if;
    expected_failure:=true;
  end;
  if not expected_failure then
    raise exception 'TEST_MARKET_WORKFLOW_PREFIX_SIBLING_ACCEPTED:%',sibling_label_value;
  end if;
  execute 'reset role';
  perform private.assert_market_candidate_draft_identity_v1(candidate_ids[2],jsonb_build_object(
    'subject',sibling_label_value,
    'question','¿Ganará '||sibling_label_value||' el premio Best Multiplayer?',
    'yes_criteria','Sí si '||sibling_label_value||' gana oficialmente.',
    'no_criteria','No si '||sibling_label_value||' no gana oficialmente.',
    'public_criteria','Se resolverá según el resultado oficial de '||sibling_label_value||'.',
    'market_slug',private.market_family_option_slug_v1(sibling_label_value)||'-fixture'
  ));
  expected_failure:=false;
  begin
    perform private.assert_market_candidate_draft_identity_v1(candidate_ids[2],jsonb_build_object(
      'subject',sibling_label_value,
      'question','¿Ganará '||sibling_label_value||' el premio Best Multiplayer?',
      'yes_criteria','Sí si '||sibling_label_value||' gana; no cuenta '
        ||candidate_snapshot.family_child_label||' como opción separada.',
      'no_criteria','No si '||sibling_label_value||' no gana oficialmente.',
      'public_criteria','Se resolverá según el resultado oficial de '||sibling_label_value||'.',
      'market_slug',private.market_family_option_slug_v1(sibling_label_value)||'-fixture'
    ));
  exception when sqlstate '55000' then
    if sqlerrm<>'CHILD_IDENTITY_MISMATCH' then raise; end if;
    expected_failure:=true;
  end;
  if not expected_failure then raise exception 'TEST_MARKET_WORKFLOW_SEPARATE_SIBLING_ACCEPTED'; end if;
  perform private.assert_market_candidate_draft_identity_v1(
    candidate_ids[1],jsonb_set(draft_input_value,'{question}',to_jsonb(
      '¿Aparecerá '||candidate_snapshot.family_child_label||' como participante oficial?'
    ),true)
  );
  select * into candidate_snapshot from private.external_market_candidates where id=candidate_ids[2];
  identity_issue:=private.market_workflow_server_issue_v1(
    'CHILD_IDENTITY_MISMATCH','editor','corrector','human_editable','approval',
    'repair_child_identity',jsonb_build_object('candidate_id',candidate_snapshot.id),
    true,'atinara-market-constitution-v1'
  );
  insert into private.market_expert_runs(
    id,origin_type,origin_id,origin_fingerprint,analysis_fingerprint,policy_version,
    schema_version,status,result_json,tool_summary
  ) values (
    identity_run_id,'radar_candidate',candidate_snapshot.id::text,repeat('7',64),repeat('8',64),
    'atinara-market-constitution-v1','atinara-market-expert-v1','completed',
    jsonb_build_object(
      'workflow_issues',jsonb_build_array(identity_issue),'decision','create_with_edits',
      'origin_analysis_fingerprint',repeat('7',64),
      'origin_source_fingerprint',candidate_snapshot.fingerprint,
      'origin_preparation_revision',candidate_snapshot.preparation_revision,
      'draft_gate',jsonb_build_object('status','proposal_ready_with_issues',
        'can_save_private_draft',true),
      'reason_codes',jsonb_build_array('CHILD_IDENTITY_MISMATCH')
    ),'[]'::jsonb
  );
  perform set_config('request.jwt.claims',jsonb_build_object(
    'role','authenticated','sub',admin_id)::text,true);
  execute 'set local role authenticated';
  execute 'reset role';
  identity_draft_result:=public.save_market_draft_from_expert_with_issues_pre_parent_v1(
    candidate_snapshot.id,identity_run_id,
    jsonb_set(draft_input_value,'{_idempotency_key}',to_jsonb(gen_random_uuid()),true)
  );
  execute 'reset role';
  if identity_draft_result #>> '{draft,family_child_key}' is distinct from candidate_snapshot.family_child_key
     or identity_draft_result #>> '{draft,artifact_status}' not in (
       'draft_with_repairable_issues','draft_human_edit_required'
     ) then raise exception 'TEST_MARKET_WORKFLOW_PRIVATE_IDENTITY_DRAFT_NOT_CREATED:%',identity_draft_result; end if;
  expected_failure:=false;
  begin
    perform private.assert_market_candidate_draft_identity_v1(
      candidate_snapshot.id,
      (select to_jsonb(draft) from private.market_drafts draft
       where draft.id=(identity_draft_result #>> '{draft,id}')::uuid)
    );
  exception when sqlstate '55000' then
    if sqlerrm<>'CHILD_IDENTITY_MISMATCH' then raise; end if;
    expected_failure:=true;
  end;
  if not expected_failure then raise exception 'TEST_MARKET_WORKFLOW_PRIVATE_IDENTITY_DRAFT_UNBLOCKED'; end if;
  select * into candidate_snapshot from private.external_market_candidates where id=candidate_ids[1];
  perform set_config('request.jwt.claims',jsonb_build_object(
    'role','authenticated','sub',admin_id)::text,true);
  execute 'set local role authenticated';
  execute 'reset role';
  draft_result:=public.save_market_draft_from_expert_with_issues_pre_parent_v1(
    candidate_ids[1],expert_run_id,draft_input_value
  );
  draft_replay:=public.save_market_draft_from_expert_with_issues_pre_parent_v1(
    candidate_ids[1],expert_run_id,
    jsonb_set(draft_input_value,'{_idempotency_key}',to_jsonb(gen_random_uuid()),true)
  );
  execute 'reset role';
  if draft_replay #>> '{draft,id}' is distinct from draft_result #>> '{draft,id}'
     or draft_replay ->> 'idempotency_replay'<>'true'
     or draft_replay ->> 'creates_private_draft'<>'false'
     or (select count(*) from private.market_drafts draft
       where draft.intelligence_origin_type='radar_candidate'
         and draft.intelligence_origin_id=candidate_ids[1]::text)<>1 then
    raise exception 'TEST_MARKET_WORKFLOW_ISSUE_DRAFT_REPLAY_INVALID:%',draft_replay;
  end if;
  perform set_config('request.jwt.claims',jsonb_build_object(
    'role','authenticated','sub',admin_id)::text,true);
  execute 'set local role authenticated';
  execute 'reset role';
  expected_failure:=false;
  begin
    perform public.save_market_draft_from_expert_with_issues_pre_parent_v1(
      candidate_ids[1],expert_run_id,jsonb_set(jsonb_set(
        draft_input_value,'{_idempotency_key}',to_jsonb(gen_random_uuid()),true
      ),'{description}',to_jsonb('Una edición distinta no puede perderse como replay.'::text),true)
    );
  exception when sqlstate '40001' then
    if sqlerrm<>'MARKET_EXPERT_DRAFT_ALREADY_EXISTS' then raise; end if;
    expected_failure:=true;
  end;
  if not expected_failure then raise exception 'TEST_MARKET_WORKFLOW_ISSUE_DRAFT_PAYLOAD_CONFLICT_ACCEPTED'; end if;
  execute 'reset role';
  draft_id:=(draft_result #>> '{draft,id}')::uuid;
  if (select radar_candidate_id from private.market_drafts where id=draft_id) is not null
     or (select intelligence_origin_type from private.market_drafts where id=draft_id)<>'radar_candidate'
     or (select artifact_status from private.market_drafts where id=draft_id)
       not in ('draft_with_repairable_issues','draft_human_edit_required')
     or draft_result #>> '{draft,artifact_status}' is distinct from
       (select artifact_status from private.market_drafts where id=draft_id)
     or draft_result #>> '{draft,workflow_owner_stage}' is distinct from
       (select workflow_owner_stage from private.market_drafts where id=draft_id)
     or draft_result #>> '{draft,workflow_next_action}' is distinct from
       (select workflow_next_action from private.market_drafts where id=draft_id)
     or (select count(*) from private.market_workflow_issue_occurrences_v1
       where issue_id=changed_issue_id)<>1
     or (select count(*) from private.market_workflow_issue_subject_links_v1
       where issue_id=changed_issue_id and subject_type in ('radar_candidate','expert_run','market_draft'))<3 then
    raise exception 'TEST_MARKET_WORKFLOW_ISSUE_HANDOFF_INVALID';
  end if;
  if not private.market_draft_has_blocking_workflow_issue_v1(
    draft_id,(draft_result #>> '{draft,content_version}')::bigint,array['approval']) then
    raise exception 'TEST_MARKET_WORKFLOW_APPROVAL_GATE_MISSING';
  end if;
  perform set_config('request.jwt.claims',jsonb_build_object(
    'role','authenticated','sub',admin_id)::text,true);
  execute 'set local role authenticated';
  issue_projection:=public.get_market_workflow_issues_v1(
    'market_draft',draft_id::text,draft_result #>> '{draft,content_version}'
  );
  review_begin:=public.begin_market_draft_review_v2(
    draft_id,(draft_result #>> '{draft,content_version}')::bigint,gen_random_uuid(),
    'atinara-market-gate-v3','atinara-market-review-policy-v3',
    'atinara-market-draft-schema-v3',true
  );
  execute 'reset role';
  for publication_issue in select value from jsonb_array_elements(issue_projection)
  loop perform private.assert_market_workflow_issue_v1(publication_issue); end loop;
  review_attempt_id:=(review_begin ->> 'attempt_id')::uuid;
  if exists (
    select 1 from private.market_review_attempts attempt
    where attempt.id=review_attempt_id and (
      attempt.validator_version is distinct from 'atinara-market-gate-v3'
      or attempt.policy_version is distinct from 'atinara-market-review-policy-v3'
      or attempt.schema_version is distinct from 'atinara-market-draft-schema-v3'
    )
  ) then raise exception 'TEST_MARKET_WORKFLOW_REVIEW_POLICY_DRIFT:%',review_begin; end if;
  perform set_config('request.jwt.claims','{"role":"service_role"}',true);
  execute 'set local role service_role';
  expected_failure:=false;
  begin
    perform public.record_market_draft_review_with_issues_v1(
      review_attempt_id,'approved','[]'::jsonb,'[]'::jsonb,admin_id,
      null,'{}'::jsonb,issue_projection
    );
  exception when sqlstate '22023' then
    if sqlerrm<>'MARKET_WORKFLOW_APPROVED_WITH_BLOCKERS' then raise; end if;
    expected_failure:=true;
  end;
  if not expected_failure then raise exception 'TEST_MARKET_WORKFLOW_APPROVED_WITH_BLOCKER'; end if;
  review_recorded:=public.record_market_draft_review_with_issues_v1(
    review_attempt_id,'rejected',jsonb_build_array(jsonb_build_object(
      'code','TEMPORAL_INCOHERENCE','field','evaluation_ends_at',
      'message','La fecha oficial sigue pendiente.'
    )),'[]'::jsonb,admin_id,null,'{}'::jsonb,issue_projection
  );
  execute 'reset role';
  if review_recorded ->> 'status'<>'rejected'
     or review_recorded ->> 'workflow_issue_count' is distinct from
       jsonb_array_length(issue_projection)::text
     or not exists (
       select 1 from private.market_workflow_issue_subject_links_v1 link
       where link.subject_type='review_attempt' and link.subject_key=review_attempt_id::text
         and link.issue_id::text in (
           select value ->> 'issue_id'
           from jsonb_array_elements(review_recorded -> 'workflow_issues') value
         )
     ) then
    raise exception 'TEST_MARKET_WORKFLOW_INHERITED_ROUNDTRIP_INVALID:%',review_recorded;
  end if;
  perform set_config('request.jwt.claims',jsonb_build_object(
    'role','authenticated','sub',admin_id)::text,true);
  execute 'set local role authenticated';
  review_begin:=public.begin_market_draft_review_v2(
    draft_id,(draft_result #>> '{draft,content_version}')::bigint,gen_random_uuid(),
    'atinara-market-gate-v3','atinara-market-review-policy-v3',
    'atinara-market-draft-schema-v3',true
  );
  execute 'reset role';
  review_attempt_id:=(review_begin ->> 'attempt_id')::uuid;
  perform set_config('request.jwt.claims','{"role":"service_role"}',true);
  execute 'set local role service_role';
  review_recorded:=public.record_market_draft_review_with_issues_v1(
    review_attempt_id,'rejected',jsonb_build_array(jsonb_build_object(
      'code','TEMPORAL_INCOHERENCE','field','evaluation_ends_at',
      'message','La fecha oficial sigue pendiente.'
    )),'[]'::jsonb,admin_id,null,'{}'::jsonb,
    jsonb_build_array(jsonb_set(issue_projection -> 0,'{issue_id}',
      to_jsonb(ephemeral_issue_id),true))
  );
  execute 'reset role';
  if review_recorded #>> '{workflow_issues,0,issue_id}'
       is distinct from changed_issue_id::text
     or review_recorded #>> '{workflow_issues,0,issue_id}'=ephemeral_issue_id::text
     or not exists (
       select 1 from private.market_workflow_issue_subject_links_v1 link
       where link.issue_id=changed_issue_id and link.subject_type='review_attempt'
         and link.subject_key=review_attempt_id::text
     ) then raise exception 'TEST_MARKET_WORKFLOW_REISSUED_ID_NOT_CANONICAL:%',review_recorded; end if;
  expected_failure:=false;
  begin
    update private.market_drafts set workflow_status='review_approved' where id=draft_id;
  exception when sqlstate '55000' then
    if sqlerrm not in ('RADAR_ELIGIBILITY_REQUIRED','MARKET_WORKFLOW_APPROVAL_BLOCKED') then raise; end if;
    expected_failure:=true;
  end;
  if not expected_failure then raise exception 'TEST_MARKET_WORKFLOW_AUTHORITY_BYPASSED'; end if;
  perform set_config('request.jwt.claims',jsonb_build_object(
    'role','authenticated','sub',admin_id)::text,true);
  execute 'set local role authenticated';
  confirmation_result:=public.confirm_market_draft_review_v2(
    draft_id,(draft_result #>> '{draft,content_version}')::bigint
  );
  publication_result:=public.publish_market_draft_v2(
    draft_id,(draft_result #>> '{draft,content_version}')::bigint,null,publication_request_id
  );
  publication_replay:=public.publish_market_draft_v2(
    draft_id,(draft_result #>> '{draft,content_version}')::bigint,null,publication_request_id
  );
  execute 'reset role';
  if confirmation_result ->> 'ok'<>'false'
     or confirmation_result ->> 'state_preserved'<>'true'
     or publication_result ->> 'ok'<>'false'
     or publication_result ->> 'status'<>'publication_blocked_recoverable'
     or publication_replay ->> 'idempotency_replay'<>'true'
     or (select count(*) from private.market_publication_attempts_v1
       where id=publication_request_id)<>1
     or exists (select 1 from public.markets where id=(draft_result #>> '{draft,market_slug}')) then
    raise exception 'TEST_MARKET_WORKFLOW_PUBLICATION_RECOVERY_INVALID';
  end if;
  perform set_config('request.jwt.claims','{"role":"service_role"}',true);
  execute 'set local role service_role';
  recovery_result:=public.recover_market_draft_radar_eligibility_v1(
    draft_id,(draft_result #>> '{draft,content_version}')::bigint,
    draft_result #>> '{draft,content_fingerprint}',candidate_ids[1],admin_id,recovery_attempt_id
  );
  issue_projection:=public.get_market_draft_eligibility_recovery_replay_v1(
    recovery_attempt_id,draft_id,(draft_result #>> '{draft,content_version}')::bigint,
    draft_result #>> '{draft,content_fingerprint}',candidate_ids[1]
  );
  execute 'reset role';
  if recovery_result ->> 'ok'<>'true'
     or issue_projection ->> 'replayed'<>'true'
     or (select radar_candidate_id from private.market_drafts where id=draft_id)<>candidate_ids[1]
     or not exists (select 1 from private.market_draft_eligibility_bindings binding
       where binding.draft_id=(draft_result #>> '{draft,id}')::uuid) then
    raise exception 'TEST_MARKET_WORKFLOW_ELIGIBILITY_RECOVERY_INVALID:%',recovery_result;
  end if;
  if not private.market_draft_has_blocking_workflow_issue_v1(
    draft_id,(draft_result #>> '{draft,content_version}')::bigint,array['approval']) then
    raise exception 'TEST_MARKET_WORKFLOW_TEMPORAL_BLOCK_LOST';
  end if;
  perform set_config('request.jwt.claims','{"role":"service_role"}',true);
  expected_failure:=false;
  begin
    perform public.project_market_draft_repair_outcome_v1(
      draft_id,(draft_result #>> '{draft,content_version}')::bigint-1,
      'repair_applied','validator','request_market_validation',gen_random_uuid()
    );
  exception when sqlstate '40001' then
    if sqlerrm<>'DRAFT_VERSION_MOVED' then raise; end if;
    expected_failure:=true;
  end;
  execute 'reset role';
  if not expected_failure then raise exception 'TEST_MARKET_WORKFLOW_STALE_PROJECTION_ACCEPTED'; end if;
  update private.external_market_candidates set fingerprint=repeat('8',64)
  where id=candidate_ids[1];
  perform set_config('request.jwt.claims','{"role":"service_role"}',true);
  execute 'set local role service_role';
  expected_failure:=false;
  begin
    perform public.recover_market_draft_radar_eligibility_v1(
      draft_id,(draft_result #>> '{draft,content_version}')::bigint,
      draft_result #>> '{draft,content_fingerprint}',candidate_ids[1],admin_id,gen_random_uuid()
    );
  exception when sqlstate '40001' then
    if sqlerrm<>'MARKET_EXPERT_ANALYSIS_STALE' then raise; end if;
    expected_failure:=true;
  end;
  execute 'reset role';
  if not expected_failure then raise exception 'TEST_MARKET_WORKFLOW_MOVED_CANDIDATE_RECOVERED'; end if;

  -- Un fallo técnico del Validator no se convierte en contenido ni abre el
  -- Corrector. Un retry aprobado supersede esa incidencia sin tocar otra versión.
  select id into strict source_registry_id from private.market_source_registry
  where canonical_domain='thegameawards.com' and active and authority_tier='primary'
  order by id limit 1;
  clean_payload:=draft_input_value||jsonb_build_object(
    'market_slug','workflow-clean-'||left(suffix,20),
    'primary_source',jsonb_build_object(
      'url','https://thegameawards.com/','role','PRIMARY_RESOLUTION',
      'registry_source_id',source_registry_id,'registry_role','primary_resolution',
      'validation_version','atinara-primary-source-validation-v1',
      'registry_role_verified',true,'validated_reachable',true,
      'authority_verified',true,'relevance_verified',true
    ),
    '_idempotency_key',gen_random_uuid(),'_change_origin','workflow_v1_test',
    '_timestamp_precision','milliseconds-v1'
  );
  perform set_config('request.jwt.claims',jsonb_build_object(
    'role','authenticated','sub',admin_id)::text,true);
  execute 'set local role authenticated';
  clean_result:=public.save_market_draft(null,null,clean_payload);
  execute 'reset role';
  select * into clean_draft from private.market_drafts
  where id=(clean_result #>> '{draft,id}')::uuid;
  technical_issue:=private.market_workflow_server_issue_v1(
    'PROVIDER_TIMEOUT','internal_platform','validator','auto_recoverable','none',
    'retry_market_validation',jsonb_build_object('draft_id',clean_draft.id),
    true,'atinara-market-review-policy-v3'
  );
  perform set_config('request.jwt.claims',jsonb_build_object(
    'role','authenticated','sub',admin_id)::text,true);
  execute 'set local role authenticated';
  review_begin:=public.begin_market_draft_review_v2(
    clean_draft.id,clean_draft.content_version,gen_random_uuid(),
    'atinara-market-gate-v3','atinara-market-review-policy-v3',
    'atinara-market-draft-schema-v3',true
  );
  execute 'reset role';
  review_attempt_id:=(review_begin ->> 'attempt_id')::uuid;
  insert into private.market_draft_primary_source_checks(
    draft_id,draft_version,registry_source_id,requested_url,final_url,draft_category,
    registry_role,validation_version,evidence_snapshot,checked_at,expires_at
  ) values (
    clean_draft.id,clean_draft.content_version,source_registry_id,
    clean_draft.primary_source ->> 'url',clean_draft.primary_source ->> 'url',clean_draft.category,
    'primary_resolution','atinara-primary-source-validation-v1',jsonb_build_object(
      'excerpt_sha256',repeat('b',64),'matched_tokens',jsonb_build_array('fixture','award'),
      'accepted',true,'validated_reachable',true,'authority_verified',true,'relevance_verified',true
    ),clock_timestamp(),clock_timestamp()+interval '10 minutes'
  ) returning id into baseline_source_check_id;
  insert into private.market_draft_primary_source_checks(
    draft_id,draft_version,registry_source_id,requested_url,final_url,draft_category,
    registry_role,validation_version,evidence_snapshot,checked_at,expires_at
  ) values (
    clean_draft.id,clean_draft.content_version,source_registry_id,
    clean_draft.primary_source ->> 'url',clean_draft.primary_source ->> 'url',clean_draft.category,
    'primary_resolution','atinara-primary-source-validation-v1',jsonb_build_object(
      'excerpt_sha256',repeat('e',64),'matched_tokens',jsonb_build_array('expired'),
      'accepted',true,'validated_reachable',true,'authority_verified',true,'relevance_verified',true
    ),clock_timestamp()-interval '20 minutes',clock_timestamp()-interval '10 minutes'
  ) returning id into current_source_check_id;
  if private.market_draft_primary_source_check_is_current_v1(
    current_source_check_id,clean_draft.id,clean_draft.content_version
  ) then raise exception 'TEST_PRIMARY_SOURCE_EXPIRED_CHECK_ACCEPTED'; end if;
  perform set_config('request.jwt.claims','{"role":"service_role"}',true);
  execute 'set local role service_role';
  review_recorded:=public.record_market_draft_review_with_issues_v1(
    review_attempt_id,'provider_timeout','[]'::jsonb,'[]'::jsonb,admin_id,
    'PROVIDER_TIMEOUT','{}'::jsonb,jsonb_build_array(technical_issue)
  );
  execute 'reset role';
  technical_issue_id:=(technical_issue ->> 'issue_id')::uuid;
  if review_recorded ->> 'classification'<>'technical'
     or not exists (
       select 1 from private.market_workflow_issue_events_v1 event
       where event.issue_id=technical_issue_id and event.new_status='open'
     ) then raise exception 'TEST_MARKET_WORKFLOW_TECHNICAL_REVIEW_INVALID:%',review_recorded; end if;
  perform set_config('request.jwt.claims',jsonb_build_object(
    'role','authenticated','sub',admin_id)::text,true);
  execute 'set local role authenticated';
  review_begin:=public.begin_market_draft_review_v2(
    clean_draft.id,clean_draft.content_version,gen_random_uuid(),
    'atinara-market-gate-v3','atinara-market-review-policy-v3',
    'atinara-market-draft-schema-v3',true
  );
  execute 'reset role';
  review_attempt_id:=(review_begin ->> 'attempt_id')::uuid;
  perform set_config('request.jwt.claims','{"role":"service_role"}',true);
  execute 'set local role service_role';
  review_recorded:=public.record_market_draft_review_with_issues_v1(
    review_attempt_id,'approved','[]'::jsonb,'[]'::jsonb,admin_id,
    null,jsonb_build_object('primary_source_check_id',baseline_source_check_id),'[]'::jsonb
  );
  execute 'reset role';
  if review_recorded ->> 'status'<>'approved'
     or (select source_check_id from private.market_effective_reviews
       where id=(select effective_review_id from private.market_drafts where id=clean_draft.id))
       is distinct from baseline_source_check_id
     or not exists (
       select 1 from private.market_workflow_issue_events_v1 event
       where event.issue_id=technical_issue_id and event.new_status='superseded'
     ) or exists (
       select 1 from private.market_workflow_issue_occurrences_v1 occurrence
       join private.market_workflow_issue_subject_links_v1 link on link.issue_id=occurrence.issue_id
       left join lateral (
         select event.new_status from private.market_workflow_issue_events_v1 event
         where event.issue_id=occurrence.issue_id order by event.occurred_at desc,event.id desc limit 1
       ) latest on true
       where link.subject_type='market_draft' and link.subject_key=clean_draft.id::text
         and link.subject_version=clean_draft.content_version::text
         and occurrence.detected_by='internal_platform'
         and occurrence.blocking_scope='none'
         and coalesce(latest.new_status,'open') not in ('resolved','superseded')
     ) then raise exception 'TEST_MARKET_WORKFLOW_TECHNICAL_RETRY_NOT_CLOSED:%',jsonb_build_object(
       'result',review_recorded,'draft_effective_review_id',(select effective_review_id
         from private.market_drafts where id=clean_draft.id),'baseline',baseline_source_check_id,
       'stored',(select source_check_id from private.market_effective_reviews
         where id=(select effective_review_id from private.market_drafts where id=clean_draft.id))
     ); end if;

  select * into clean_draft from private.market_drafts where id=clean_draft.id;
  technical_issue:=private.market_workflow_server_issue_v1(
    'PROVIDER_TIMEOUT','internal_platform','validator','auto_recoverable','none',
    'retry_market_validation',jsonb_build_object('draft_id',clean_draft.id),
    true,'atinara-market-review-policy-v3'
  );
  perform set_config('request.jwt.claims',jsonb_build_object(
    'role','authenticated','sub',admin_id)::text,true);
  execute 'set local role authenticated';
  review_begin:=public.begin_market_draft_review_v2(
    clean_draft.id,clean_draft.content_version,gen_random_uuid(),
    'atinara-market-gate-v3','atinara-market-review-policy-v3',
    'atinara-market-draft-schema-v3',true
  );
  execute 'reset role';
  perform set_config('request.jwt.claims','{"role":"service_role"}',true);
  execute 'set local role service_role';
  review_recorded:=public.record_market_draft_review_with_issues_v1(
    (review_begin ->> 'attempt_id')::uuid,'provider_timeout','[]'::jsonb,'[]'::jsonb,
    admin_id,'PROVIDER_TIMEOUT','{}'::jsonb,jsonb_build_array(technical_issue)
  );
  execute 'reset role';
  if review_recorded ->> 'effective_review_preserved'<>'true'
     or review_recorded ->> 'artifact_status'<>'review_approved'
     or review_recorded ->> 'owner_stage'<>'human_review'
     or review_recorded ->> 'next_action'<>'confirm_market_draft'
     or not exists (select 1 from private.market_drafts draft
       where draft.id=clean_draft.id and draft.workflow_status='review_approved'
         and draft.artifact_status='review_approved'
         and draft.workflow_owner_stage='human_review'
         and draft.workflow_next_action='confirm_market_draft') then
    raise exception 'TEST_MARKET_WORKFLOW_APPROVAL_LKG_PROJECTION_INVALID:%',review_recorded;
  end if;

  select * into clean_draft from private.market_drafts where id=clean_draft.id;
  publication_issue:=private.market_workflow_server_issue_v1(
    'HUMAN_CONFIRMATION_DECISION_REQUIRED','human_review','human_review','human_editable',
    'human_confirmation','review_human_confirmation_issue',
    jsonb_build_object('draft_id',clean_draft.id),false,'atinara-human-confirmation-gate-v1'
  );
  technical_issue_id:=private.record_market_workflow_issue_v1(
    'market_draft',clean_draft.id::text,clean_draft.content_version::text,
    clean_draft.content_fingerprint,publication_issue,null,null
  );
  perform set_config('request.jwt.claims',jsonb_build_object(
    'role','authenticated','sub',admin_id)::text,true);
  execute 'set local role authenticated';
  confirmation_result:=public.confirm_market_draft_review_v2(
    clean_draft.id,clean_draft.content_version
  );
  execute 'reset role';
  if confirmation_result ->> 'ok'<>'false'
     or confirmation_result #>> '{issue,issue_id}'<>technical_issue_id::text
     or (select workflow_status from private.market_drafts where id=clean_draft.id)<>'review_approved'
     or not exists (select 1 from private.market_workflow_issue_occurrences_v1 occurrence
       left join lateral (select event.new_status from private.market_workflow_issue_events_v1 event
         where event.issue_id=occurrence.issue_id order by event.occurred_at desc,event.id desc limit 1) latest on true
       where occurrence.issue_id=technical_issue_id
         and coalesce(latest.new_status,'open') not in ('resolved','superseded')) then
    raise exception 'TEST_CONFIRMATION_ISSUE_BYPASSED:%',confirmation_result;
  end if;
  perform set_config('request.jwt.claims','{"role":"service_role"}',true);
  execute 'set local role service_role';
  perform public.transition_market_workflow_issue_v1(
    technical_issue_id,'open','resolved','human_review','confirm_market_draft',
    'human_decision_completed','[]'::jsonb
  );
  execute 'reset role';

  select private.market_current_effective_review_id(draft) into effective_review_id_value
  from private.market_drafts draft where draft.id=clean_draft.id;
  update private.market_drafts set workflow_status='human_confirmed',
    human_confirmed_at=clock_timestamp(),human_confirmed_by=admin_id,
    human_confirmed_fingerprint=content_fingerprint,
    human_confirmed_review_id=effective_review_id_value
  where id=clean_draft.id;
  insert into private.market_admin_audit(actor_id,action_code,draft_id,draft_version,detail)
  values (admin_id,'HUMAN_CONFIRMATION_RECORDED',clean_draft.id,clean_draft.content_version,
    jsonb_build_object('effective_review_id',effective_review_id_value,
      'content_fingerprint',clean_draft.content_fingerprint,
      'binding_id',null,'binding_plan_version',null));
  select * into clean_draft from private.market_drafts where id=clean_draft.id;
  technical_issue:=private.market_workflow_server_issue_v1(
    'PROVIDER_TIMEOUT','internal_platform','validator','auto_recoverable','none',
    'retry_market_validation',jsonb_build_object('draft_id',clean_draft.id),
    true,'atinara-market-review-policy-v3'
  );
  perform set_config('request.jwt.claims',jsonb_build_object(
    'role','authenticated','sub',admin_id)::text,true);
  execute 'set local role authenticated';
  review_begin:=public.begin_market_draft_review_v2(
    clean_draft.id,clean_draft.content_version,gen_random_uuid(),
    'atinara-market-gate-v3','atinara-market-review-policy-v3',
    'atinara-market-draft-schema-v3',true
  );
  execute 'reset role';
  perform set_config('request.jwt.claims','{"role":"service_role"}',true);
  execute 'set local role service_role';
  review_recorded:=public.record_market_draft_review_with_issues_v1(
    (review_begin ->> 'attempt_id')::uuid,'provider_timeout','[]'::jsonb,'[]'::jsonb,
    admin_id,'PROVIDER_TIMEOUT','{}'::jsonb,jsonb_build_array(technical_issue)
  );
  execute 'reset role';
  if review_recorded ->> 'human_confirmation_preserved'<>'true'
     or review_recorded ->> 'artifact_status'<>'human_confirmed'
     or review_recorded ->> 'owner_stage'<>'publication_gate'
     or review_recorded ->> 'next_action'<>'revalidate_and_publish'
     or not exists (select 1 from private.market_drafts draft
       where draft.id=clean_draft.id and draft.workflow_status='human_confirmed'
         and draft.artifact_status='human_confirmed'
         and draft.workflow_owner_stage='publication_gate'
         and draft.workflow_next_action='revalidate_and_publish') then
    raise exception 'TEST_MARKET_WORKFLOW_CONFIRMATION_LKG_PROJECTION_INVALID:%',review_recorded;
  end if;
  select * into clean_draft from private.market_drafts where id=clean_draft.id;
  publication_issue:=private.market_workflow_server_issue_v1(
    'SOURCE_STALE','publication_gate','corrector','waiting_authoritative_source','publication',
    'revalidate_temporal_evidence',jsonb_build_object('draft_id',clean_draft.id),
    true,'atinara-publication-gate-v1'
  );
  publication_issue_id:=private.record_market_workflow_issue_v1(
    'market_draft',clean_draft.id::text,clean_draft.content_version::text,
    clean_draft.content_fingerprint,publication_issue,null,null
  );
  if (select source_check_id from private.market_effective_reviews
      where id=clean_draft.effective_review_id) is distinct from baseline_source_check_id then
    raise exception 'TEST_EFFECTIVE_REVIEW_SOURCE_BASELINE_NOT_CAPTURED';
  end if;
  insert into private.market_draft_primary_source_checks(
    draft_id,draft_version,registry_source_id,requested_url,final_url,draft_category,
    registry_role,validation_version,evidence_snapshot,checked_at,expires_at
  ) values (
    clean_draft.id,clean_draft.content_version,source_registry_id,
    clean_draft.primary_source ->> 'url',clean_draft.primary_source ->> 'url',clean_draft.category,
    'primary_resolution','atinara-primary-source-validation-v1',jsonb_build_object(
      'excerpt_sha256',repeat('b',64),'matched_tokens',jsonb_build_array('fixture','award'),
      'accepted',true,'validated_reachable',true,'authority_verified',true,'relevance_verified',true
    ),clock_timestamp(),clock_timestamp()+interval '10 minutes'
  ) returning id into current_source_check_id;
  perform set_config('request.jwt.claims','{"role":"service_role"}',true);
  execute 'set local role service_role';
  review_recorded:=public.record_market_draft_review_with_issues_v1(
    review_attempt_id,'approved','[]'::jsonb,'[]'::jsonb,admin_id,null,
    jsonb_build_object('primary_source_check_id',current_source_check_id),'[]'::jsonb
  );
  execute 'reset role';
  if review_recorded ->> 'idempotency_replay'<>'true'
     or (select source_check_id from private.market_effective_reviews
       where id=clean_draft.effective_review_id) is distinct from baseline_source_check_id then
    raise exception 'TEST_EFFECTIVE_REVIEW_SOURCE_BASELINE_REPLAY_MUTATED:%',jsonb_build_object(
      'result',review_recorded,'draft_effective_review_id',clean_draft.effective_review_id,
      'stored_source_check_id',(select source_check_id from private.market_effective_reviews
        where id=clean_draft.effective_review_id),'baseline_source_check_id',baseline_source_check_id
      ,'effective_reviews',(select jsonb_agg(jsonb_build_object('id',effective.id,
        'source_check_id',effective.source_check_id,'active',effective.active,
        'reused_from',effective.reused_from_effective_review_id) order by effective.id)
        from private.market_effective_reviews effective where effective.draft_id=clean_draft.id)
    );
  end if;
  perform set_config('request.jwt.claims','{"role":"service_role"}',true);
  execute 'set local role service_role';
  evidence_revalidation_result:=public.revalidate_market_draft_publication_evidence_v1(
    clean_draft.id,clean_draft.content_version,clean_draft.content_fingerprint,
    jsonb_build_array(publication_issue_id),current_source_check_id,
    evidence_revalidation_request_id,admin_id
  );
  execute 'reset role';
  if evidence_revalidation_result ->> 'status'<>'human_confirmed'
     or evidence_revalidation_result ->> 'authority_preserved'<>'true'
     or (select workflow_status from private.market_drafts where id=clean_draft.id)<>'human_confirmed'
     or not exists (select 1 from private.market_effective_reviews effective
       where effective.id=clean_draft.effective_review_id and effective.active)
     or not exists (select 1 from private.market_workflow_issue_events_v1 event
       where event.issue_id=publication_issue_id and event.new_status='resolved')
     or not exists (select 1 from private.market_admin_audit audit
       where audit.action_code='PUBLICATION_EVIDENCE_REVALIDATED'
         and audit.actor_id=admin_id and audit.draft_id=clean_draft.id
         and audit.detail ->> 'request_id'=evidence_revalidation_request_id::text) then
    raise exception 'TEST_PUBLICATION_EVIDENCE_AUTHORITY_NOT_PRESERVED:%',evidence_revalidation_result;
  end if;
  perform set_config('request.jwt.claims','{"role":"service_role"}',true);
  execute 'set local role service_role';
  evidence_revalidation_result:=public.revalidate_market_draft_publication_evidence_v1(
    clean_draft.id,clean_draft.content_version,clean_draft.content_fingerprint,
    jsonb_build_array(publication_issue_id),null,evidence_revalidation_request_id,admin_id
  );
  if evidence_revalidation_result ->> 'idempotency_replay'<>'true' then
    raise exception 'TEST_PUBLICATION_EVIDENCE_REPLAY_INVALID:%',evidence_revalidation_result;
  end if;
  expected_failure:=false;
  begin
    perform public.revalidate_market_draft_publication_evidence_v1(
      clean_draft.id,clean_draft.content_version,clean_draft.content_fingerprint,
      jsonb_build_array(gen_random_uuid()),null,evidence_revalidation_request_id,admin_id
    );
  exception when sqlstate '40001' then
    if sqlerrm<>'PUBLICATION_EVIDENCE_REQUEST_REUSED' then raise; end if;
    expected_failure:=true;
  end;
  execute 'reset role';
  if not expected_failure then raise exception 'TEST_PUBLICATION_EVIDENCE_REQUEST_REUSE_ACCEPTED'; end if;
  perform set_config('request.jwt.claims',jsonb_build_object(
    'role','authenticated','sub',admin_id)::text,true);
  execute 'set local role authenticated';
  publication_result:=public.publish_market_draft_v2(
    clean_draft.id,clean_draft.content_version,clock_timestamp()+interval '1 hour',gen_random_uuid()
  );
  execute 'reset role';
  if publication_result ->> 'status'<>'scheduled' then
    raise exception 'TEST_PUBLICATION_FRESH_SOURCE_NOT_SCHEDULED:%',publication_result;
  end if;
  select * into clean_draft from private.market_drafts where id=clean_draft.id;
  expected_failure:=false;
  scheduled_edit_payload:=private.market_draft_source_payload(clean_draft)||jsonb_build_object(
    'description',coalesce(clean_draft.description,'')||' Edición no autorizada durante programación.',
    '_idempotency_key',gen_random_uuid(),'_change_origin','scheduled_edit_probe',
    '_timestamp_precision','milliseconds-v1'
  );
  perform set_config('request.jwt.claims',jsonb_build_object(
    'role','authenticated','sub',admin_id)::text,true);
  execute 'set local role authenticated';
  begin
    perform public.save_market_draft(clean_draft.id,clean_draft.content_version,
      scheduled_edit_payload
    );
  exception when sqlstate '55000' then
    if sqlerrm<>'SCHEDULED_DRAFT_CANCEL_REQUIRED' then raise; end if;
    expected_failure:=true;
  end;
  execute 'reset role';
  if not expected_failure then raise exception 'TEST_SCHEDULED_DRAFT_EDIT_ACCEPTED'; end if;
  update private.market_drafts set scheduled_for=clock_timestamp()-interval '1 minute'
  where id=clean_draft.id;
  perform set_config('request.jwt.claims','{"role":"service_role"}',true);
  execute 'set local role service_role';
  publication_result:=public.publish_due_market_drafts_v2(1);
  execute 'reset role';
  publication_issue_id:=(publication_result #>> '{failed,0,issue_id}')::uuid;
  scheduled_revalidation_request_id:=(publication_result #>> '{failed,0,attempt_id}')::uuid;
  if publication_result ->> 'published_count'<>'0'
     or publication_result ->> 'failed_count'<>'1'
     or publication_result #>> '{failed,0,error}'<>'SOURCE_STALE'
     or publication_result #>> '{failed,0,source_revalidation,draft_id}'<>clean_draft.id::text
     or publication_result #>> '{failed,0,source_revalidation,request_id}'
       <>scheduled_revalidation_request_id::text
     or exists (select 1 from public.markets market where market.id=clean_draft.market_slug)
     or not exists (select 1 from private.market_workflow_issue_occurrences_v1 occurrence
       left join lateral (select event.new_status from private.market_workflow_issue_events_v1 event
         where event.issue_id=occurrence.issue_id order by event.occurred_at desc,event.id desc limit 1) latest on true
       where occurrence.issue_id=publication_issue_id
         and coalesce(latest.new_status,'open') not in ('resolved','superseded')) then
    raise exception 'TEST_SCHEDULED_SOURCE_STALE_PUBLISHED:%',publication_result;
  end if;
  perform set_config('request.jwt.claims','{"role":"service_role"}',true);
  execute 'set local role service_role';
  evidence_revalidation_result:=public.revalidate_market_draft_publication_evidence_v1(
    clean_draft.id,clean_draft.content_version,clean_draft.content_fingerprint,
    jsonb_build_array(publication_issue_id),current_source_check_id,
    scheduled_revalidation_request_id,null
  );
  execute 'reset role';
  if evidence_revalidation_result ->> 'status'<>'scheduled'
     or evidence_revalidation_result ->> 'authority_preserved'<>'true'
     or private.market_draft_publication_source_ready_v1(
       clean_draft.id,clean_draft.content_version,true
     ) is not true
     or (select publication_schedule_status from private.market_drafts
       where id=clean_draft.id)<>'scheduled_waiting'
     or not exists (select 1 from private.market_workflow_issue_events_v1 event
       where event.issue_id=publication_issue_id and event.new_status='resolved') then
    raise exception 'TEST_SCHEDULED_SOURCE_REVALIDATION_INVALID:%',evidence_revalidation_result;
  end if;
  publication_issue:=private.market_workflow_server_issue_v1(
    'SOURCE_STALE','publication_gate','corrector','waiting_authoritative_source','publication',
    'revalidate_temporal_evidence',jsonb_build_object(
      'draft_id',clean_draft.id,'fixture','post_revalidation_race'
    ),true,'atinara-publication-gate-v1'
  );
  publication_issue_id:=private.record_market_workflow_issue_v1(
    'market_draft',clean_draft.id::text,clean_draft.content_version::text,
    clean_draft.content_fingerprint,publication_issue,null,null
  );
  perform set_config('request.jwt.claims','{"role":"service_role"}',true);
  execute 'set local role service_role';
  publication_result:=public.publish_due_market_drafts_v2(1);
  execute 'reset role';
  if publication_result ->> 'published_count'<>'0'
     or publication_result ->> 'failed_count'<>'1'
     or publication_result #>> '{failed,0,error}'<>'SOURCE_STALE'
     or exists (select 1 from public.markets market where market.id=clean_draft.market_slug) then
    raise exception 'TEST_SCHEDULED_ACTIVE_SOURCE_ISSUE_PUBLISHED:%',publication_result;
  end if;
  perform set_config('request.jwt.claims',jsonb_build_object(
    'role','authenticated','sub',admin_id)::text,true);
  execute 'set local role authenticated';
  publication_result:=public.cancel_scheduled_market_publication_v1(clean_draft.id);
  execute 'reset role';
  if publication_result ->> 'confirmation_preserved'<>'true'
     or (select workflow_status from private.market_drafts where id=clean_draft.id)<>'human_confirmed' then
    raise exception 'TEST_SCHEDULED_SOURCE_STALE_CANCEL_INVALID:%',publication_result;
  end if;
  select * into clean_draft from private.market_drafts where id=clean_draft.id;
  perform set_config('request.jwt.claims',jsonb_build_object(
    'role','authenticated','sub',admin_id)::text,true);
  execute 'set local role authenticated';
  publication_result:=public.publish_market_draft_v2(
    clean_draft.id,clean_draft.content_version,null,gen_random_uuid()
  );
  execute 'reset role';
  if publication_result ->> 'ok'<>'false'
     or publication_result ->> 'error'<>'SOURCE_STALE'
     or publication_result #>> '{issue,issue_id}'<>publication_issue_id::text
     or exists (select 1 from public.markets market where market.id=clean_draft.market_slug) then
    raise exception 'TEST_MANUAL_SOURCE_STALE_PUBLISHED:%',publication_result;
  end if;

  -- Compatibilidad legacy sin backfill: una confirmación previa sin baseline no
  -- entra en bucle de Corrector. La check actual se conserva como evidencia,
  -- se invalida la autoridad no demostrable y el expediente vuelve al
  -- Validator; una nueva aprobación + confirmación lo deja operativo otra vez.
  update private.market_effective_reviews set source_check_id=null,
    source_evidence_fingerprint=null where id=clean_draft.effective_review_id;
  evidence_revalidation_request_id:=gen_random_uuid();
  perform set_config('request.jwt.claims','{"role":"service_role"}',true);
  execute 'set local role service_role';
  evidence_revalidation_result:=public.revalidate_market_draft_publication_evidence_v1(
    clean_draft.id,clean_draft.content_version,clean_draft.content_fingerprint,
    jsonb_build_array(publication_issue_id),current_source_check_id,
    evidence_revalidation_request_id,admin_id
  );
  execute 'reset role';
  if evidence_revalidation_result ->> 'status'<>'validation_required'
     or evidence_revalidation_result ->> 'authority_preserved'<>'false'
     or (select workflow_status from private.market_drafts where id=clean_draft.id)<>'draft_ready'
     or (select workflow_owner_stage from private.market_drafts where id=clean_draft.id)<>'validator'
     or (select workflow_next_action from private.market_drafts where id=clean_draft.id)
       <>'request_market_validation'
     or (select human_confirmed_at from private.market_drafts where id=clean_draft.id) is not null
     or not exists (select 1 from private.market_workflow_issue_occurrences_v1 occurrence
       left join lateral (select event.new_status,event.owner_stage,event.next_action
         from private.market_workflow_issue_events_v1 event where event.issue_id=occurrence.issue_id
         order by event.occurred_at desc,event.id desc limit 1) latest on true
       where occurrence.issue_code='PUBLICATION_EVIDENCE_BASELINE_MISSING'
         and occurrence.subject_key=clean_draft.id::text
         and coalesce(latest.new_status,'open')='waiting'
         and coalesce(latest.owner_stage,occurrence.owner_stage)='validator'
         and coalesce(latest.next_action,occurrence.next_action)='request_market_validation') then
    raise exception 'TEST_LEGACY_PUBLICATION_BASELINE_ROUTE_INVALID:%',evidence_revalidation_result;
  end if;
  select * into clean_draft from private.market_drafts where id=clean_draft.id;
  perform set_config('request.jwt.claims',jsonb_build_object(
    'role','authenticated','sub',admin_id)::text,true);
  execute 'set local role authenticated';
  review_begin:=public.begin_market_draft_review_v2(
    clean_draft.id,clean_draft.content_version,gen_random_uuid(),
    'atinara-market-gate-v3','atinara-market-review-policy-v3',
    'atinara-market-draft-schema-v3',true
  );
  execute 'reset role';
  perform set_config('request.jwt.claims','{"role":"service_role"}',true);
  execute 'set local role service_role';
  review_recorded:=public.record_market_draft_review_with_issues_v1(
    (review_begin ->> 'attempt_id')::uuid,'approved','[]'::jsonb,'[]'::jsonb,admin_id,
    null,jsonb_build_object('primary_source_check_id',current_source_check_id),'[]'::jsonb
  );
  execute 'reset role';
  select * into clean_draft from private.market_drafts where id=clean_draft.id;
  perform set_config('request.jwt.claims',jsonb_build_object(
    'role','authenticated','sub',admin_id)::text,true);
  execute 'set local role authenticated';
  confirmation_result:=public.confirm_market_draft_review_v2(
    clean_draft.id,clean_draft.content_version
  );
  execute 'reset role';
  if review_recorded ->> 'status'<>'approved' or confirmation_result ->> 'ok'<>'true'
     or (select workflow_status from private.market_drafts where id=clean_draft.id)<>'human_confirmed' then
    raise exception 'TEST_LEGACY_PUBLICATION_BASELINE_RECOVERY_INVALID:%:%',
      review_recorded,confirmation_result;
  end if;
  select * into clean_draft from private.market_drafts where id=clean_draft.id;
  publication_issue:=private.market_workflow_server_issue_v1(
    'CONFIRMATION_TECHNICAL_FAILURE','human_review','internal_platform',
    'auto_recoverable','none','retry_human_confirmation',
    jsonb_build_object('draft_id',clean_draft.id),true,'atinara-human-confirmation-gate-v1'
  );
  technical_issue_id:=private.record_market_workflow_issue_v1(
    'market_draft',clean_draft.id::text,clean_draft.content_version::text,
    clean_draft.content_fingerprint,publication_issue,null,null
  );
  perform set_config('request.jwt.claims',jsonb_build_object(
    'role','authenticated','sub',admin_id)::text,true);
  execute 'set local role authenticated';
  confirmation_result:=public.confirm_market_draft_review_v2(
    clean_draft.id,clean_draft.content_version
  );
  execute 'reset role';
  if confirmation_result ->> 'ok'<>'true'
     or not exists (
       select 1 from private.market_workflow_issue_events_v1 event
       where event.issue_id=technical_issue_id and event.new_status='superseded'
      ) then raise exception 'TEST_MARKET_WORKFLOW_CONFIRMATION_TECHNICAL_RETRY_INVALID:%',
       confirmation_result; end if;
  select * into clean_draft from private.market_drafts where id=clean_draft.id;
  publication_issue:=private.market_workflow_server_issue_v1(
    'SOURCE_STALE','publication_gate','corrector','waiting_authoritative_source','publication',
    'revalidate_temporal_evidence',jsonb_build_object(
      'draft_id',clean_draft.id,'fixture','changed_evidence_after_legacy_revalidation'
    ),true,'atinara-publication-gate-v1'
  );
  publication_issue_id:=private.record_market_workflow_issue_v1(
    'market_draft',clean_draft.id::text,clean_draft.content_version::text,
    clean_draft.content_fingerprint,publication_issue,null,null
  );
  insert into private.market_draft_primary_source_checks(
    draft_id,draft_version,registry_source_id,requested_url,final_url,draft_category,
    registry_role,validation_version,evidence_snapshot,checked_at,expires_at
  ) values (
    clean_draft.id,clean_draft.content_version,source_registry_id,
    clean_draft.primary_source ->> 'url',clean_draft.primary_source ->> 'url',clean_draft.category,
    'primary_resolution','atinara-primary-source-validation-v1',jsonb_build_object(
      'excerpt_sha256',repeat('c',64),'matched_tokens',jsonb_build_array('fixture','changed'),
      'accepted',true,'validated_reachable',true,'authority_verified',true,'relevance_verified',true
    ),clock_timestamp(),clock_timestamp()+interval '10 minutes'
  ) returning id into current_source_check_id;
  if private.market_draft_publication_source_ready_v1(
    clean_draft.id,clean_draft.content_version,false
  ) is true then raise exception 'TEST_NEWER_UNAUDITED_SOURCE_CHECK_ACCEPTED'; end if;
  expected_failure:=false;
  perform set_config('request.jwt.claims','{"role":"service_role"}',true);
  execute 'set local role service_role';
  begin
    perform public.revalidate_market_draft_publication_evidence_v1(
      clean_draft.id,clean_draft.content_version,clean_draft.content_fingerprint,
      jsonb_build_array(publication_issue_id),baseline_source_check_id,
      gen_random_uuid(),admin_id
    );
  exception when sqlstate '40001' then
    if sqlerrm<>'PRIMARY_SOURCE_CHECK_NOT_LATEST' then raise; end if;
    expected_failure:=true;
  end;
  execute 'reset role';
  if not expected_failure then raise exception 'TEST_NON_LATEST_SOURCE_CHECK_REVALIDATED'; end if;
  evidence_revalidation_request_id:=gen_random_uuid();
  perform set_config('request.jwt.claims','{"role":"service_role"}',true);
  execute 'set local role service_role';
  evidence_revalidation_result:=public.revalidate_market_draft_publication_evidence_v1(
    clean_draft.id,clean_draft.content_version,clean_draft.content_fingerprint,
    jsonb_build_array(publication_issue_id),current_source_check_id,
    evidence_revalidation_request_id,admin_id
  );
  execute 'reset role';
  if evidence_revalidation_result ->> 'status'<>'repair_required'
     or evidence_revalidation_result ->> 'content_changed'<>'true'
     or (select workflow_status from private.market_drafts where id=clean_draft.id)<>'draft_ready'
     or (select effective_review_id from private.market_drafts where id=clean_draft.id) is not null
     or (select human_confirmed_at from private.market_drafts where id=clean_draft.id) is not null
     or not exists (select 1 from private.market_workflow_issue_occurrences_v1 occurrence
       left join lateral (select event.new_status from private.market_workflow_issue_events_v1 event
         where event.issue_id=occurrence.issue_id order by event.occurred_at desc,event.id desc limit 1) latest on true
       where occurrence.issue_id=publication_issue_id
         and coalesce(latest.new_status,'open') not in ('resolved','superseded')) then
    raise exception 'TEST_PUBLICATION_EVIDENCE_CHANGE_NOT_REOPENED:%',evidence_revalidation_result;
  end if;
  perform set_config('request.jwt.claims','{"role":"service_role"}',true);
  execute 'set local role service_role';
  evidence_revalidation_result:=public.revalidate_market_draft_publication_evidence_v1(
    clean_draft.id,clean_draft.content_version,clean_draft.content_fingerprint,
    jsonb_build_array(publication_issue_id),null,evidence_revalidation_request_id,admin_id
  );
  execute 'reset role';
  if evidence_revalidation_result ->> 'idempotency_replay'<>'true'
     or evidence_revalidation_result ->> 'status'<>'repair_required'
     or (select count(*) from private.market_admin_audit audit
       where audit.action_code='PUBLICATION_EVIDENCE_CHANGE_DETECTED'
         and audit.detail ->> 'request_id'=evidence_revalidation_request_id::text)<>1 then
    raise exception 'TEST_PUBLICATION_EVIDENCE_CHANGE_REPLAY_INVALID:%',evidence_revalidation_result;
  end if;
  select * into clean_draft from private.market_drafts where id=clean_draft.id;

  -- Una respuesta para la versión anterior se conserva como stale y no vuelve
  -- a proyectarse sobre el borrador vigente.
  clean_payload:=private.market_draft_source_payload(clean_draft)||jsonb_build_object(
    'description',coalesce(clean_draft.description,'')||' Actualización material.',
    '_idempotency_key',gen_random_uuid(),'_change_origin','workflow_v1_stale_test',
    '_timestamp_precision','milliseconds-v1'
  );
  perform set_config('request.jwt.claims',jsonb_build_object(
    'role','authenticated','sub',admin_id)::text,true);
  execute 'set local role authenticated';
  review_begin:=public.begin_market_draft_review_v2(
    clean_draft.id,clean_draft.content_version,gen_random_uuid(),
    'atinara-market-gate-v3','atinara-market-review-policy-v3',
    'atinara-market-draft-schema-v3',true
  );
  stale_attempt_id:=(review_begin ->> 'attempt_id')::uuid;
  clean_result:=public.save_market_draft(
    clean_draft.id,clean_draft.content_version,clean_payload
  );
  execute 'reset role';
  stale_version:=(clean_result #>> '{draft,content_version}')::bigint;
  perform set_config('request.jwt.claims','{"role":"service_role"}',true);
  execute 'set local role service_role';
  review_recorded:=public.record_market_draft_review_with_issues_v1(
    stale_attempt_id,'approved','[]'::jsonb,'[]'::jsonb,admin_id,
    null,'{}'::jsonb,'[]'::jsonb
  );
  execute 'reset role';
  if review_recorded ->> 'status'<>'stale'
     or review_recorded ->> 'state_preserved'<>'true'
     or (select content_version from private.market_drafts where id=clean_draft.id)
       is distinct from stale_version then
    raise exception 'TEST_MARKET_WORKFLOW_STALE_REVIEW_PROJECTED:%',review_recorded;
  end if;

  perform set_config('request.jwt.claims',jsonb_build_object(
    'role','authenticated','sub',admin_id)::text,true);
  execute 'set local role authenticated';
  confirmation_result:=public.confirm_market_draft_review_v2(
    clean_draft.id,clean_draft.content_version
  );
  publication_result:=public.publish_market_draft_v2(
    clean_draft.id,clean_draft.content_version,null,gen_random_uuid()
  );
  execute 'reset role';
  if confirmation_result ->> 'status'<>'confirmation_stale'
     or confirmation_result ->> 'next_action'<>'reload_current_draft'
     or publication_result ->> 'error'<>'DRAFT_VERSION_MOVED'
     or publication_result ->> 'next_action'<>'reload_current_draft'
     or not exists (
       select 1 from private.market_publication_attempts_v1 attempt
       where attempt.draft_id=clean_draft.id
         and attempt.expected_version=clean_draft.content_version
         and attempt.status='blocked_recoverable'
         and attempt.issue_id is null and attempt.error_code='DRAFT_VERSION_MOVED'
         and attempt.response_payload ->> 'current_version'=stale_version::text
     ) then raise exception 'TEST_MARKET_WORKFLOW_STALE_AUTHORITY_INVALID:%:%',
       confirmation_result,publication_result; end if;

  -- La tentativa 21 sigue siendo auditable; el límite anterior no podía
  -- convertir un bloqueo en un fallo permanente del ledger.
  select coalesce(max(attempt.attempt_number),0)+1 into first_missing_attempt
  from private.market_publication_attempts_v1 attempt
  where attempt.draft_id=clean_draft.id;
  if first_missing_attempt<=20 then
    for loop_index in first_missing_attempt..20 loop
      insert into private.market_publication_attempts_v1(
        id,draft_id,actor_id,trigger_type,expected_version,request_hash,
        attempt_number,status,retryable,error_code,response_payload
      ) values (
        gen_random_uuid(),clean_draft.id,admin_id,'manual',stale_version,repeat('7',64),
        loop_index,'blocked_recoverable',true,'CURRENT_APPROVAL_AND_CONFIRMATION_REQUIRED',
        jsonb_build_object('ok',false,'fixture',loop_index)
      );
    end loop;
  end if;
  perform set_config('request.jwt.claims',jsonb_build_object(
    'role','authenticated','sub',admin_id)::text,true);
  execute 'set local role authenticated';
  publication_result:=public.publish_market_draft_v2(
    clean_draft.id,stale_version,null,gen_random_uuid()
  );
  execute 'reset role';
  if publication_result ->> 'ok'<>'false'
     or not exists (
       select 1 from private.market_publication_attempts_v1 attempt
       where attempt.draft_id=clean_draft.id and attempt.attempt_number=21
         and attempt.issue_id::text=publication_result #>> '{issue,issue_id}'
         and exists (select 1 from private.market_workflow_issue_occurrences_v1 occurrence
           where occurrence.issue_id=attempt.issue_id)
         and exists (select 1 from private.market_workflow_issue_subject_links_v1 link
           where link.issue_id=attempt.issue_id and link.subject_type='publication_attempt'
             and link.subject_key=attempt.id::text)
     ) then raise exception 'TEST_MARKET_WORKFLOW_ATTEMPT_21_INVALID:%',publication_result; end if;

  select attempt.issue_id into publication_issue_id
  from private.market_publication_attempts_v1 attempt
  where attempt.draft_id=clean_draft.id and attempt.attempt_number=21;
  select * into clean_draft from private.market_drafts where id=clean_draft.id;
  insert into private.market_repair_attempts(
    id,request_key,actor_id,draft_id,expected_version,expected_fingerprint,
    request_hash,issue_codes
  ) values (
    repair_attempt_id,gen_random_uuid(),admin_id,clean_draft.id,clean_draft.content_version,
    clean_draft.content_fingerprint,repeat('4',64),jsonb_build_array(
      (select issue_code from private.market_workflow_issue_occurrences_v1
       where issue_id=publication_issue_id)
    )
  );
  perform set_config('request.jwt.claims','{"role":"service_role"}',true);
  execute 'set local role service_role';
  expected_failure:=false;
  begin
    perform public.complete_market_draft_repair_workflow_v1(
      repair_attempt_id,'succeeded','complete','content',false,null,null,
      clean_draft.content_version+1,clean_draft.content_fingerprint,
      jsonb_build_object('ok',true,'state_preserved',true,
        'workflow_issue_ids',jsonb_build_array(publication_issue_id)),
      clean_draft.id,'repair_applied','validator','request_market_validation',
      'resolved','authorized_repair_applied'
    );
  exception when sqlstate '40001' then
    if sqlerrm<>'DRAFT_VERSION_MOVED' then raise; end if;
    expected_failure:=true;
  end;
  execute 'reset role';
  if not expected_failure
     or exists (select 1 from private.market_repair_attempts attempt
       where attempt.id=repair_attempt_id and attempt.response_payload is not null)
     or exists (select 1 from private.market_workflow_issue_events_v1 event
       where event.issue_id=publication_issue_id and event.new_status='resolved') then
    raise exception 'TEST_MARKET_WORKFLOW_ATOMIC_COMPLETION_PARTIAL';
  end if;
  perform set_config('request.jwt.claims','{"role":"service_role"}',true);
  execute 'set local role service_role';
  repair_completion:=public.complete_market_draft_repair_workflow_v1(
    repair_attempt_id,'succeeded','complete','content',false,null,null,
    clean_draft.content_version,clean_draft.content_fingerprint,
    jsonb_build_object('ok',true,'state_preserved',true,
      'workflow_issue_ids',jsonb_build_array(publication_issue_id)),
    clean_draft.id,'repair_applied','validator','request_market_validation',
    'resolved','authorized_repair_applied'
  );
  execute 'reset role';
  if repair_completion ->> 'idempotency_replay'<>'false'
     or not exists (
       select 1 from private.market_workflow_issue_subject_links_v1 link
       where link.issue_id=publication_issue_id and link.subject_type='repair_attempt'
         and link.subject_key=repair_attempt_id::text
     ) or not exists (
       select 1 from private.market_workflow_issue_events_v1 event
       where event.issue_id=publication_issue_id and event.new_status='resolved'
     ) or (select artifact_status from private.market_drafts where id=clean_draft.id)
       is distinct from 'repair_applied' then
    raise exception 'TEST_MARKET_WORKFLOW_ATOMIC_COMPLETION_INVALID:%',repair_completion;
  end if;
  perform set_config('request.jwt.claims','{"role":"service_role"}',true);
  execute 'set local role service_role';
  repair_completion:=public.complete_market_draft_repair_workflow_v1(
    repair_attempt_id,'succeeded','complete','content',false,null,null,
    clean_draft.content_version,clean_draft.content_fingerprint,
    jsonb_build_object('ok',true,'state_preserved',true,
      'workflow_issue_ids',jsonb_build_array(publication_issue_id)),
    clean_draft.id,'repair_applied','validator','request_market_validation',
    'resolved','authorized_repair_applied'
  );
  execute 'reset role';
  if repair_completion ->> 'idempotency_replay'<>'true'
     or (select count(*) from private.market_workflow_issue_subject_links_v1 link
       where link.issue_id=publication_issue_id and link.subject_type='repair_attempt'
         and link.subject_key=repair_attempt_id::text)<>1 then
    raise exception 'TEST_MARKET_WORKFLOW_ATOMIC_COMPLETION_REPLAY_INVALID:%',repair_completion;
  end if;

  select * into clean_draft from private.market_drafts where id=clean_draft.id;
  perform set_config('request.jwt.claims',jsonb_build_object(
    'role','authenticated','sub',admin_id)::text,true);
  execute 'set local role authenticated';
  review_begin:=public.begin_market_draft_review_v2(
    clean_draft.id,clean_draft.content_version,gen_random_uuid(),
    'atinara-market-gate-v3','atinara-market-review-policy-v3',
    'atinara-market-draft-schema-v3',true
  );
  execute 'reset role';
  resume_review_attempt_id:=(review_begin ->> 'attempt_id')::uuid;
  insert into private.market_draft_primary_source_checks(
    draft_id,draft_version,registry_source_id,requested_url,final_url,draft_category,
    registry_role,validation_version,evidence_snapshot,checked_at,expires_at
  ) values (
    clean_draft.id,clean_draft.content_version,source_registry_id,
    clean_draft.primary_source ->> 'url',clean_draft.primary_source ->> 'url',clean_draft.category,
    'primary_resolution','atinara-primary-source-validation-v1',jsonb_build_object(
      'excerpt_sha256',repeat('d',64),'matched_tokens',jsonb_build_array('fixture','repaired'),
      'accepted',true,'validated_reachable',true,'authority_verified',true,'relevance_verified',true
    ),clock_timestamp(),clock_timestamp()+interval '10 minutes'
  ) returning id into current_source_check_id;
  perform set_config('request.jwt.claims','{"role":"service_role"}',true);
  execute 'set local role service_role';
  perform public.record_market_draft_review_with_issues_v1(
    resume_review_attempt_id,'approved','[]'::jsonb,'[]'::jsonb,admin_id,
    null,jsonb_build_object('primary_source_check_id',current_source_check_id),'[]'::jsonb
  );
  execute 'reset role';
  select version.content_fingerprint into previous_version_fingerprint
  from private.market_draft_versions version
  where version.draft_id=clean_draft.id and version.content_version=clean_draft.content_version-1;
  insert into private.market_repair_attempts(
    id,request_key,actor_id,draft_id,expected_version,expected_fingerprint,
    request_hash,issue_codes,lease_expires_at
  ) values (
    resume_attempt_id,resume_request_key,admin_id,clean_draft.id,
    clean_draft.content_version-1,previous_version_fingerprint,repeat('3',64),'[]'::jsonb,
    clock_timestamp()-interval '1 minute'
  );
  insert into private.market_repair_workflow_checkpoints_v1(
    attempt_id,repair_round,draft_id,expected_version,expected_fingerprint,
    resulting_version,resulting_fingerprint,repair_request_id,review_attempt_id,changed_fields
  ) values (
    resume_attempt_id,1,clean_draft.id,clean_draft.content_version-1,
    previous_version_fingerprint,clean_draft.content_version,clean_draft.content_fingerprint,
    gen_random_uuid(),resume_review_attempt_id,'[]'::jsonb
  );
  perform set_config('request.jwt.claims',jsonb_build_object(
    'role','authenticated','sub',admin_id)::text,true);
  execute 'set local role authenticated';
  review_begin:=public.begin_market_draft_repair_workflow_v1(
    clean_draft.id,clean_draft.content_version-1,resume_request_key
  );
  execute 'reset role';
  if review_begin ->> 'status'<>'completion_required'
     or review_begin ->> 'attempt_id' is distinct from resume_attempt_id::text then
    raise exception 'TEST_MARKET_WORKFLOW_CHECKPOINT_RESUME_NOT_DISCOVERED:%',review_begin;
  end if;
  perform set_config('request.jwt.claims','{"role":"service_role"}',true);
  execute 'set local role service_role';
  repair_completion:=public.reconcile_market_draft_repair_workflow_v1(resume_attempt_id);
  execute 'reset role';
  if repair_completion ->> 'reconciled_from_checkpoint'<>'true'
     or repair_completion ->> 'idempotency_replay'<>'false'
     or not exists (select 1 from private.market_repair_attempts attempt
       where attempt.id=resume_attempt_id and attempt.response_payload is not null
         and attempt.resulting_version=clean_draft.content_version) then
    raise exception 'TEST_MARKET_WORKFLOW_CHECKPOINT_RESUME_INVALID:%',repair_completion;
  end if;

  insert into private.market_radar_temporal_contracts_v1(
    candidate_id,contract_version,decision_hash,temporal_contract
  ) values (
    candidate_ids[2],'atinara-temporal-contract-v1',repeat('6',64),
    jsonb_build_object('version','atinara-temporal-contract-v1','decision_hash',repeat('6',64))
  ) returning id into temporal_contract_id;
  foreach mismatch_field in array array['events','links','temporal','publication','checkpoint']
  loop
    expected_failure:=false;
    begin
      if mismatch_field='events' then
        update private.market_workflow_issue_events_v1 set next_action='mutated'
        where issue_id=changed_issue_id;
      elsif mismatch_field='links' then
        update private.market_workflow_issue_subject_links_v1 set subject_version='mutated'
        where issue_id=changed_issue_id;
      elsif mismatch_field='temporal' then
        update private.market_radar_temporal_contracts_v1 set decision_hash=repeat('5',64)
        where id=temporal_contract_id;
      elsif mismatch_field='publication' then
        update private.market_publication_attempts_v1 attempt set retryable=false
        where attempt.draft_id=clean_draft.id;
      else
        update private.market_repair_workflow_checkpoints_v1 set repair_round=2
        where attempt_id=resume_attempt_id;
      end if;
    exception when sqlstate '55000' then
      if sqlerrm<>'MARKET_WORKFLOW_LEDGER_APPEND_ONLY' then raise; end if;
      expected_failure:=true;
    end;
    if not expected_failure then
      raise exception 'TEST_MARKET_WORKFLOW_APPEND_ONLY_SURFACE_BYPASSED:%',mismatch_field;
    end if;
  end loop;
  for classification_case in select value from jsonb_array_elements(jsonb_build_array(
    jsonb_build_object('code','CURRENT_APPROVAL_AND_CONFIRMATION_REQUIRED',
      'owner','human_review','action','confirm_market_draft','repairability','human_editable','scope','publication','retryable',true),
    jsonb_build_object('code','CURRENT_BINDING_COMPATIBILITY_REQUIRED',
      'owner','corrector','action','revalidate_temporal_evidence','repairability','human_editable','scope','publication','retryable',true),
    jsonb_build_object('code','SOURCE_BINDING_REQUIRED',
      'owner','corrector','action','revalidate_temporal_evidence','repairability','waiting_authoritative_source','scope','publication','retryable',true),
    jsonb_build_object('code','SCHEDULE_AFTER_MARKET_CLOSE',
      'owner','human_review','action','choose_valid_publication_time','repairability','human_editable','scope','publication','retryable',true),
    jsonb_build_object('code','MARKET_PERIOD_ALREADY_ENDED',
      'owner','publication_gate','action','archive_expired_draft','repairability','terminal','scope','terminal','retryable',false),
    jsonb_build_object('code','MARKET_ALREADY_PUBLISHED',
      'owner','internal_platform','action','reconcile_published_market','repairability','auto_recoverable','scope','publication','retryable',false),
    jsonb_build_object('code','PUBLICATION_TECHNICAL_FAILURE',
      'owner','internal_platform','action','retry_market_publication','repairability','auto_recoverable','scope','publication','retryable',true)
  )) loop
    publication_issue:=private.publication_issue_v1(
      clean_draft.id,stale_version,classification_case ->> 'code'
    );
    if publication_issue ->> 'owner_stage' is distinct from classification_case ->> 'owner'
       or publication_issue ->> 'next_action' is distinct from classification_case ->> 'action'
       or publication_issue ->> 'repairability' is distinct from classification_case ->> 'repairability'
       or publication_issue ->> 'blocking_scope' is distinct from classification_case ->> 'scope'
       or (publication_issue ->> 'retryable')::boolean
         is distinct from (classification_case ->> 'retryable')::boolean then
      raise exception 'TEST_MARKET_WORKFLOW_PUBLICATION_CLASSIFICATION_INVALID:%:%',
        classification_case,publication_issue;
    end if;
  end loop;

  -- Una programación vencida nunca publica con la check del Validator por
  -- inercia: el primer pase crea SOURCE_STALE, la revalidación service-only
  -- compara el baseline sin IA y solo la evidencia equivalente habilita un
  -- segundo pase que materializa exactamente una vez.
  scheduled_edit_payload:=private.market_draft_source_payload(clean_draft)||jsonb_build_object(
    'market_slug','workflow-scheduled-happy-'||left(suffix,16),
    'evaluation_ends_at','2098-12-30T23:59:59.000Z',
    'resolution_deadline','2099-01-02T23:59:59.000Z',
    '_idempotency_key',gen_random_uuid(),'_change_origin','scheduled_happy_fixture',
    '_timestamp_precision','milliseconds-v1'
  );
  perform set_config('request.jwt.claims',jsonb_build_object(
    'role','authenticated','sub',admin_id)::text,true);
  execute 'set local role authenticated';
  clean_result:=public.save_market_draft(null,null,scheduled_edit_payload);
  execute 'reset role';
  select * into scheduled_happy_draft from private.market_drafts
  where id=(clean_result #>> '{draft,id}')::uuid;
  perform set_config('request.jwt.claims',jsonb_build_object(
    'role','authenticated','sub',admin_id)::text,true);
  execute 'set local role authenticated';
  review_begin:=public.begin_market_draft_review_v2(
    scheduled_happy_draft.id,scheduled_happy_draft.content_version,gen_random_uuid(),
    'atinara-market-gate-v3','atinara-market-review-policy-v3',
    'atinara-market-draft-schema-v3',true
  );
  execute 'reset role';
  insert into private.market_draft_primary_source_checks(
    draft_id,draft_version,registry_source_id,requested_url,final_url,draft_category,
    registry_role,validation_version,evidence_snapshot,checked_at,expires_at
  ) values (
    scheduled_happy_draft.id,scheduled_happy_draft.content_version,source_registry_id,
    scheduled_happy_draft.primary_source ->> 'url',
    scheduled_happy_draft.primary_source ->> 'url',scheduled_happy_draft.category,
    'primary_resolution','atinara-primary-source-validation-v1',jsonb_build_object(
      'excerpt_sha256',repeat('8',64),'matched_tokens',jsonb_build_array('fixture','award'),
      'accepted',true,'validated_reachable',true,'authority_verified',true,'relevance_verified',true
    ),clock_timestamp(),clock_timestamp()+interval '10 minutes'
  ) returning id into scheduled_baseline_source_check_id;
  perform set_config('request.jwt.claims','{"role":"service_role"}',true);
  execute 'set local role service_role';
  perform public.record_market_draft_review_with_issues_v1(
    (review_begin ->> 'attempt_id')::uuid,'approved','[]'::jsonb,'[]'::jsonb,admin_id,
    null,jsonb_build_object('primary_source_check_id',scheduled_baseline_source_check_id),
    '[]'::jsonb
  );
  execute 'reset role';
  select * into scheduled_happy_draft from private.market_drafts
  where id=scheduled_happy_draft.id;
  perform set_config('request.jwt.claims',jsonb_build_object(
    'role','authenticated','sub',admin_id)::text,true);
  execute 'set local role authenticated';
  confirmation_result:=public.confirm_market_draft_review_v2(
    scheduled_happy_draft.id,scheduled_happy_draft.content_version
  );
  execute 'reset role';
  select * into scheduled_happy_draft from private.market_drafts
  where id=scheduled_happy_draft.id;
  effective_review_id_value:=scheduled_happy_draft.effective_review_id;
  perform set_config('request.jwt.claims',jsonb_build_object(
    'role','authenticated','sub',admin_id)::text,true);
  execute 'set local role authenticated';
  review_begin:=public.begin_market_draft_review_v2(
    scheduled_happy_draft.id,scheduled_happy_draft.content_version,gen_random_uuid(),
    'atinara-market-gate-v3','atinara-market-review-policy-v3',
    'atinara-market-draft-schema-v3',true
  );
  execute 'reset role';
  perform set_config('request.jwt.claims','{"role":"service_role"}',true);
  execute 'set local role service_role';
  review_recorded:=public.record_market_draft_review_with_issues_v1(
    (review_begin ->> 'attempt_id')::uuid,'approved','[]'::jsonb,'[]'::jsonb,admin_id,
    null,jsonb_build_object('primary_source_check_id',scheduled_baseline_source_check_id),
    '[]'::jsonb
  );
  execute 'reset role';
  select * into scheduled_happy_draft from private.market_drafts
  where id=scheduled_happy_draft.id;
  if review_recorded ->> 'workflow_status'<>'human_confirmed'
     or scheduled_happy_draft.effective_review_id=effective_review_id_value
     or scheduled_happy_draft.human_confirmed_review_id
       is distinct from scheduled_happy_draft.effective_review_id
     or not exists (select 1 from private.market_admin_audit audit
       where audit.action_code='HUMAN_CONFIRMATION_CARRIED_FORWARD'
         and audit.draft_id=scheduled_happy_draft.id
         and audit.detail ->> 'effective_review_id'=scheduled_happy_draft.effective_review_id::text)
     or private.market_draft_publication_source_ready_v1(
       scheduled_happy_draft.id,scheduled_happy_draft.content_version,false
     ) is not true then
    raise exception 'TEST_HUMAN_CONFIRMATION_CARRY_FORWARD_INVALID:%',review_recorded;
  end if;
  perform set_config('request.jwt.claims',jsonb_build_object(
    'role','authenticated','sub',admin_id)::text,true);
  execute 'set local role authenticated';
  publication_result:=public.publish_market_draft_v2(
    scheduled_happy_draft.id,scheduled_happy_draft.content_version,
    clock_timestamp()+interval '1 hour',gen_random_uuid()
  );
  execute 'reset role';
  if confirmation_result ->> 'ok'<>'true' or publication_result ->> 'status'<>'scheduled' then
    raise exception 'TEST_SCHEDULED_HAPPY_SETUP_INVALID:%:%',confirmation_result,publication_result;
  end if;
  update private.market_drafts set scheduled_for=clock_timestamp()-interval '1 minute'
  where id=scheduled_happy_draft.id;
  perform set_config('request.jwt.claims','{"role":"service_role"}',true);
  execute 'set local role service_role';
  publication_result:=public.publish_due_market_drafts_v2(1);
  execute 'reset role';
  publication_issue_id:=(publication_result #>> '{failed,0,issue_id}')::uuid;
  scheduled_revalidation_request_id:=(publication_result #>> '{failed,0,attempt_id}')::uuid;
  if publication_result ->> 'published_count'<>'0'
     or publication_result #>> '{failed,0,error}'<>'SOURCE_STALE' then
    raise exception 'TEST_SCHEDULED_HAPPY_REVALIDATION_NOT_REQUIRED:%',publication_result;
  end if;
  insert into private.market_draft_primary_source_checks(
    draft_id,draft_version,registry_source_id,requested_url,final_url,draft_category,
    registry_role,validation_version,evidence_snapshot,checked_at,expires_at
  ) values (
    scheduled_happy_draft.id,scheduled_happy_draft.content_version,source_registry_id,
    scheduled_happy_draft.primary_source ->> 'url',
    scheduled_happy_draft.primary_source ->> 'url',scheduled_happy_draft.category,
    'primary_resolution','atinara-primary-source-validation-v1',jsonb_build_object(
      'excerpt_sha256',repeat('8',64),'matched_tokens',jsonb_build_array('fixture','award'),
      'accepted',true,'validated_reachable',true,'authority_verified',true,'relevance_verified',true
    ),clock_timestamp(),clock_timestamp()+interval '10 minutes'
  ) returning id into scheduled_current_source_check_id;
  perform set_config('request.jwt.claims','{"role":"service_role"}',true);
  execute 'set local role service_role';
  evidence_revalidation_result:=public.revalidate_market_draft_publication_evidence_v1(
    scheduled_happy_draft.id,scheduled_happy_draft.content_version,
    scheduled_happy_draft.content_fingerprint,jsonb_build_array(publication_issue_id),
    scheduled_current_source_check_id,scheduled_revalidation_request_id,null
  );
  execute 'reset role';
  publication_issue:=private.publication_issue_v1(
    scheduled_happy_draft.id,scheduled_happy_draft.content_version,
    'PUBLICATION_TECHNICAL_FAILURE'
  );
  technical_issue_id:=private.record_market_workflow_issue_v1(
    'market_draft',scheduled_happy_draft.id::text,
    scheduled_happy_draft.content_version::text,
    scheduled_happy_draft.content_fingerprint,publication_issue,null,null
  );
  perform set_config('request.jwt.claims','{"role":"service_role"}',true);
  execute 'set local role service_role';
  publication_result:=public.publish_due_market_drafts_v2(1);
  execute 'reset role';
  if evidence_revalidation_result ->> 'status'<>'scheduled'
     or publication_result ->> 'published_count'<>'1'
     or publication_result ->> 'failed_count'<>'0'
     or (select count(*) from public.markets market
       where market.id=scheduled_happy_draft.market_slug)<>1
     or (select workflow_status from private.market_drafts
       where id=scheduled_happy_draft.id)<>'published'
     or not exists (select 1 from private.market_workflow_issue_events_v1 event
       where event.issue_id=technical_issue_id and event.new_status='resolved'
         and event.resolution_method='scheduled_publication_retry_succeeded')
     or not exists (select 1 from private.market_admin_audit audit
       where audit.action_code='PUBLICATION_EVIDENCE_REVALIDATED'
         and audit.actor_id is null and audit.draft_id=scheduled_happy_draft.id
         and audit.detail ->> 'execution_mode'='scheduled') then
    raise exception 'TEST_SCHEDULED_HAPPY_PUBLICATION_INVALID:%:%',
      evidence_revalidation_result,publication_result;
  end if;

  registry_hash_after:=private.market_agent_registry_hash_v2();
  if registry_hash_after is distinct from registry_hash_before then
    raise exception 'TEST_AGENT_REGISTRY_V21_CHANGED';
  end if;
end;
$test$;

rollback;
