-- Corrige la colisión entre la variable PL/pgSQL "child" y los alias SQL
-- usados al validar la cobertura legacy. Completa además la columna de
-- confianza que las funciones V3 ya escriben y el contrato Edge ya consume.
-- La migración original ya está aplicada: esta sustitución es aditiva, no
-- contiene backfill ni DML de dominio.

begin;
set local lock_timeout='5s';
set local statement_timeout='120s';
select pg_catalog.pg_advisory_xact_lock(92060824140500);

do $preflight$
declare
  function_source text;
  rebind_source text;
begin
  if to_regprocedure(
    'public.record_market_radar_parent_reconciliations_v1(uuid,text,text,uuid,jsonb)'
  ) is null or to_regprocedure(
    'private.rebind_market_radar_protected_candidates_v1(uuid,text)'
  ) is null then
    raise exception 'RADAR_PARENT_CHILD_ALIAS_FUNCTION_MISSING';
  end if;
  select pg_catalog.pg_get_functiondef(
    'public.record_market_radar_parent_reconciliations_v1(uuid,text,text,uuid,jsonb)'::regprocedure
  ) into function_source;
  if function_source not like '%child jsonb;%'
     or function_source not like '%jsonb_array_elements(reconciliation -> ''children'') child%' then
    raise exception 'RADAR_PARENT_CHILD_ALIAS_PREFLIGHT_DRIFT';
  end if;
  select pg_catalog.pg_get_functiondef(
    'private.rebind_market_radar_protected_candidates_v1(uuid,text)'::regprocedure
  ) into rebind_source;
  if rebind_source not like
       '%jsonb_typeof(candidate.normalized_payload -> ''token_ids'')<>''array''%'
     or rebind_source not like
       '%jsonb_array_length(candidate.normalized_payload -> ''token_ids'')=0%'
     or rebind_source not like
       '%candidate.normalized_payload ->> ''availability_status''%' then
    raise exception 'RADAR_PROTECTED_REBIND_PREFLIGHT_DRIFT';
  end if;
  if exists (
    select 1 from information_schema.columns
    where table_schema='private' and table_name='external_market_candidates'
      and column_name='verification_confidence'
  ) then
    raise exception 'RADAR_VERIFICATION_CONFIDENCE_PREFLIGHT_DRIFT';
  end if;
end;
$preflight$;

alter table private.external_market_candidates
  add column verification_confidence numeric(5,2),
  add constraint external_market_candidates_verification_confidence_check
    check (verification_confidence is null or verification_confidence between 0 and 100);

create or replace function public.record_market_radar_parent_reconciliations_v1(
  request_id_input uuid,
  provider_input text,
  capability_input text,
  lease_token_input uuid,
  reconciliations_input jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  intent private.market_radar_refresh_intents_v1%rowtype;
  reconciliation jsonb;
  child_value jsonb;
  parent_row private.market_radar_parent_reconciliations_v1%rowtype;
  issue_id_value uuid;
  current_count integer;
  identified_count integer;
  unresolved_count integer;
  removed_count integer;
  closed_count integer;
  duplicate_count integer;
  conflict_count integer;
  new_count integer;
  status_value text;
  declared_count integer;
  legacy_expected_value integer;
  legacy_accounted_value integer;
  legacy_accounted_count integer;
  legacy_persisted_expected_value integer;
  legacy_persisted_accounted_value integer;
  legacy_count integer;
  legacy_candidate_count integer;
  legacy_ledger_count integer;
  prior_parent_id_value uuid;
  known_legacy_count integer;
  manifest_hash_value text;
  parent_count_value integer;
  incomplete_count_value integer;
  selected_child_count_value integer;
  persisted_child_count integer;
  identity_confidence_value numeric;
  checked_at_value timestamptz;
  next_retry_at_value timestamptz;
  child_checked_at_value timestamptz;
  expected_provider_identity_key text;
  output_items jsonb:='[]'::jsonb;
  prior_issue record;
begin
  if auth.role()<>'service_role' then
    raise exception 'SERVICE_ROLE_REQUIRED' using errcode='42501';
  end if;
  intent:=private.assert_market_radar_refresh_lease_v1(
    request_id_input,provider_input,capability_input,lease_token_input
  );
  if capability_input<>'candidate_feed' or provider_input not in ('polymarket','kalshi')
     or jsonb_typeof(reconciliations_input)<>'array'
     or jsonb_array_length(reconciliations_input) not between 0 and 120
     or octet_length(reconciliations_input::text)>5242880 then
    raise exception 'RADAR_PARENT_RECONCILIATION_INVALID' using errcode='22023';
  end if;

  for reconciliation in select value from jsonb_array_elements(reconciliations_input)
  loop
    if jsonb_typeof(reconciliation)<>'object'
       or reconciliation ->> 'provider' is distinct from provider_input
       or nullif(reconciliation ->> 'provider_parent_id','') is null
       or char_length(reconciliation ->> 'provider_parent_id')>220
       or reconciliation ->> 'reconciliation_version' is distinct from 'atinara-radar-parent-reconciliation-v1'
       or reconciliation ->> 'normalizer_version' is distinct from 'atinara-radar-v3'
       or reconciliation ->> 'family_version' is distinct from 'atinara-market-family-v5'
       or coalesce(reconciliation ->> 'reconciliation_fingerprint','') !~ '^[a-f0-9]{64}$'
       or reconciliation ->> 'reconciliation_status' not in (
         'complete','incomplete_provider_metadata','inconsistent_provider_count',
         'refresh_required','provider_unavailable','historical_mapping_required',
         'terminal_provider_corruption'
       )
       or jsonb_typeof(coalesce(reconciliation -> 'children','[]'::jsonb))<>'array'
       -- El total actual sigue limitado a 480; el ledger combinado puede
       -- conservar hasta 1.920 tombstones históricos sin truncarlos.
       or jsonb_array_length(coalesce(reconciliation -> 'children','[]'::jsonb))>1920
       or jsonb_typeof(coalesce(reconciliation -> 'source_refs','[]'::jsonb))<>'array'
       or jsonb_array_length(coalesce(reconciliation -> 'source_refs','[]'::jsonb))>24
       or jsonb_array_length(coalesce(reconciliation -> 'source_refs','[]'::jsonb))=0
       or (reconciliation ->> 'reconciliation_status' in (
         'incomplete_provider_metadata','inconsistent_provider_count','refresh_required',
         'provider_unavailable','historical_mapping_required'
       ) and nullif(reconciliation ->> 'next_retry_at','') is null)
       or (reconciliation ->> 'reconciliation_status' in (
         'complete','terminal_provider_corruption'
       ) and nullif(reconciliation ->> 'next_retry_at','') is not null)
       or (reconciliation ->> 'reconciliation_status'='complete' and not exists (
         select 1 from jsonb_array_elements(reconciliation -> 'source_refs') source_ref
         where source_ref ->> 'url' ~ '^https://'
           and coalesce(source_ref ->> 'identity_sha256',source_ref ->> 'content_sha256')
             ~ '^[a-f0-9]{64}$'
           and source_ref ->> 'result' in (
             'parent_children_enumerated','current_child_page_enumerated',
             'historical_child_page_enumerated'
           )
       )) then
      raise exception 'RADAR_PARENT_RECONCILIATION_INVALID' using errcode='22023';
    end if;
    begin
      checked_at_value:=(reconciliation ->> 'checked_at')::timestamptz;
      next_retry_at_value:=nullif(reconciliation ->> 'next_retry_at','')::timestamptz;
    exception when invalid_text_representation or datetime_field_overflow then
      raise exception 'RADAR_PARENT_RECONCILIATION_TIME_INVALID' using errcode='22007';
    end;
    if checked_at_value is null
       or checked_at_value<intent.created_at-interval '5 minutes'
       or checked_at_value>clock_timestamp()+interval '5 minutes'
       or (next_retry_at_value is not null and next_retry_at_value<=checked_at_value) then
      raise exception 'RADAR_PARENT_RECONCILIATION_TIME_INVALID' using errcode='22007';
    end if;
    begin
      declared_count:=nullif(reconciliation ->> 'provider_declared_child_count','')::integer;
    exception when invalid_text_representation or numeric_value_out_of_range then
      raise exception 'RADAR_PARENT_RECONCILIATION_COUNT_INVALID' using errcode='22003';
    end;
    if declared_count is not null and declared_count not between 0 and 480 then
      raise exception 'RADAR_PARENT_RECONCILIATION_COUNT_INVALID' using errcode='22003';
    end if;
    if exists (
      select 1
      from jsonb_array_elements(reconciliation -> 'children') item
      group by item ->> 'child_occurrence_key'
      having count(*)>1
    ) then
      raise exception 'RADAR_PARENT_CHILD_OCCURRENCE_DUPLICATE' using errcode='23505';
    end if;
    if exists (
      select 1 from jsonb_array_elements(reconciliation -> 'children') item
      where (item ->> 'identity_classification'='provider_duplicate_child' and not exists (
        select 1 from jsonb_array_elements(reconciliation -> 'children') anchor
        where anchor ->> 'child_occurrence_key'<>item ->> 'child_occurrence_key'
          and anchor ->> 'provider_child_identity_key'
            =item ->> 'duplicate_of_child_identity_key'
          and anchor ->> 'identity_classification'<>'provider_duplicate_child'
      )) or (item ->> 'identity_classification'<>'provider_duplicate_child'
        and nullif(item ->> 'duplicate_of_child_identity_key','') is not null)
    ) then
      raise exception 'RADAR_PARENT_CHILD_DUPLICATE_REFERENCE_INVALID' using errcode='23514';
    end if;
    if exists (
      select 1 from jsonb_array_elements(reconciliation -> 'children') item
      where nullif(item ->> 'provider_child_identity_key','') is not null
      group by item ->> 'provider_child_identity_key'
      having count(*)>1
        and count(*) filter(where item ->> 'identity_classification'='provider_data_conflict')=0
        and count(*) filter(where item ->> 'identity_classification'='provider_duplicate_child')
          <>count(*)-1
    ) then
      raise exception 'RADAR_PARENT_CHILD_DUPLICATE_CLASSIFICATION_INVALID' using errcode='23514';
    end if;
    if exists (
      select 1
      from jsonb_array_elements(reconciliation -> 'children') with ordinality left_child(item,ordinality)
      join jsonb_array_elements(reconciliation -> 'children') with ordinality right_child(item,ordinality)
        on left_child.ordinality<right_child.ordinality
      where (
        (nullif(left_child.item ->> 'external_market_id','') is not null
          and left_child.item ->> 'external_market_id'=right_child.item ->> 'external_market_id')
        or (nullif(left_child.item ->> 'condition_id','') is not null
          and left_child.item ->> 'condition_id'=right_child.item ->> 'condition_id')
        or exists (
          select 1 from jsonb_array_elements_text(case
            when jsonb_typeof(left_child.item -> 'token_ids')='array'
              then left_child.item -> 'token_ids' else '[]'::jsonb end) left_token(value)
          join jsonb_array_elements_text(case
            when jsonb_typeof(right_child.item -> 'token_ids')='array'
              then right_child.item -> 'token_ids' else '[]'::jsonb end) right_token(value)
            using(value)
        )
      ) and left_child.item ->> 'identity_classification' not in (
        'provider_duplicate_child','provider_data_conflict'
      ) and right_child.item ->> 'identity_classification' not in (
        'provider_duplicate_child','provider_data_conflict'
      )
    ) then
      raise exception 'RADAR_PARENT_CHILD_STABLE_IDENTITY_REPEATED' using errcode='23514';
    end if;
    begin
      legacy_expected_value:=nullif(
        reconciliation ->> 'legacy_expected_child_count',''
      )::integer;
      legacy_accounted_value:=nullif(
        reconciliation ->> 'legacy_accounted_child_count',''
      )::integer;
    exception when invalid_text_representation or numeric_value_out_of_range then
      raise exception 'RADAR_PARENT_RECONCILIATION_COUNT_INVALID' using errcode='22003';
    end;
    if (legacy_expected_value is not null and legacy_expected_value not between 0 and 1920)
       or (legacy_accounted_value is not null and legacy_accounted_value not between 0 and 1920)
       or (legacy_expected_value is null and legacy_accounted_value is not null)
       or (legacy_expected_value is not null and (
         legacy_accounted_value is null or legacy_accounted_value>legacy_expected_value
       )) then
      raise exception 'RADAR_PARENT_RECONCILIATION_COUNT_INVALID' using errcode='22003';
    end if;

    select
      count(*) filter(where coalesce((value ->> 'present_in_current_snapshot')::boolean,false)),
      count(*) filter(where coalesce((value ->> 'present_in_current_snapshot')::boolean,false)
        and value ->> 'identity_status'='resolved'),
      count(*) filter(where coalesce((value ->> 'present_in_current_snapshot')::boolean,false)
        and value ->> 'identity_status' in ('unresolved_placeholder','conflict')),
      count(*) filter(where value ->> 'identity_classification'='provider_removed_child'),
      count(*) filter(where coalesce((value ->> 'present_in_current_snapshot')::boolean,false)
        and value ->> 'availability_status'='closed'),
      count(*) filter(where coalesce((value ->> 'present_in_current_snapshot')::boolean,false)
        and value ->> 'identity_classification'='provider_duplicate_child'),
      count(*) filter(where coalesce((value ->> 'present_in_current_snapshot')::boolean,false)
        and value ->> 'identity_classification'='provider_data_conflict'),
      count(*) filter(where coalesce((value ->> 'present_in_current_snapshot')::boolean,false)
        and value ->> 'transition'='new'),
      count(*) filter(where coalesce((value ->> 'present_in_legacy_snapshot')::boolean,false)),
      count(*) filter(where coalesce((value ->> 'present_in_legacy_snapshot')::boolean,false)
        and (
          coalesce((value ->> 'present_in_current_snapshot')::boolean,false)
          or (value ->> 'identity_classification'='provider_removed_child'
            and exists(select 1 from jsonb_array_elements(case
              when jsonb_typeof(value -> 'identity_evidence')='array'
                then value -> 'identity_evidence' else '[]'::jsonb end) evidence
              where evidence ->> 'result'='provider_removed_child'))
          or (value ->> 'identity_classification'='provider_closed_child'
            and exists(select 1 from jsonb_array_elements(case
              when jsonb_typeof(value -> 'identity_evidence')='array'
                then value -> 'identity_evidence' else '[]'::jsonb end) evidence
              where evidence ->> 'result'='provider_closed_child'))
        ))
    into current_count,identified_count,unresolved_count,removed_count,closed_count,
      duplicate_count,conflict_count,new_count,legacy_count,legacy_accounted_count
    from jsonb_array_elements(reconciliation -> 'children');

    select count(*)::integer into legacy_candidate_count
    from private.external_market_candidates legacy_candidate
    where legacy_candidate.provider=provider_input
      and legacy_candidate.external_event_id=reconciliation ->> 'provider_parent_id'
      and legacy_candidate.normalizer_version<>'atinara-radar-v3';
    select prior_parent.id into prior_parent_id_value
    from private.market_radar_parent_reconciliations_v1 prior_parent
    join private.market_radar_refresh_intents_v1 prior_intent
      on prior_intent.request_id=prior_parent.request_id
     and prior_intent.provider=prior_parent.provider
     and prior_intent.capability=prior_parent.capability
    where prior_parent.provider=provider_input
      and prior_parent.provider_parent_id=reconciliation ->> 'provider_parent_id'
      and prior_parent.request_id<>request_id_input
      and prior_intent.status in ('completed','partial')
    order by prior_parent.checked_at desc,prior_parent.inserted_at desc
    limit 1;
    select count(*)::integer into legacy_ledger_count
    from private.market_radar_parent_children_v1 legacy_child
    where legacy_child.parent_reconciliation_id=prior_parent_id_value;
    known_legacy_count:=greatest(
      coalesce(legacy_candidate_count,0),coalesce(legacy_ledger_count,0)
    );
    if exists (
      select 1 from private.external_market_candidates baseline
      where baseline.provider=provider_input
        and baseline.external_event_id=reconciliation ->> 'provider_parent_id'
        and baseline.normalizer_version<>'atinara-radar-v3'
        and not exists (
          select 1 from jsonb_array_elements(reconciliation -> 'children') child
          where coalesce((child ->> 'present_in_legacy_snapshot')::boolean,false)
            and private.market_radar_child_matches_legacy_v1(jsonb_build_object(
              'external_market_id',coalesce(
                nullif(baseline.normalized_payload ->> 'external_market_id',''),baseline.external_id
              ),
              'condition_id',nullif(baseline.normalized_payload #>> '{provider_payload,condition_id}',''),
              'token_ids',case
                when jsonb_typeof(baseline.normalized_payload #> '{provider_payload,token_ids}')='array'
                  then baseline.normalized_payload #> '{provider_payload,token_ids}'
                else '[]'::jsonb end,
              'child_slug',nullif(baseline.normalized_payload ->> 'external_market_slug','')
            ),child,provider_input)
        )
    ) or exists (
      select 1 from private.market_radar_parent_children_v1 baseline
      where baseline.parent_reconciliation_id=prior_parent_id_value and not exists (
        select 1 from jsonb_array_elements(reconciliation -> 'children') child
        where coalesce((child ->> 'present_in_legacy_snapshot')::boolean,false)
          and private.market_radar_child_matches_legacy_v1(
            to_jsonb(baseline),child,provider_input
          )
      )
    ) then
      raise exception 'RADAR_PARENT_LEGACY_IDENTITY_COVERAGE_MISMATCH' using errcode='22023';
    end if;
    if exists (
      select 1 from jsonb_array_elements(reconciliation -> 'children') child
      where coalesce((child ->> 'present_in_legacy_snapshot')::boolean,false)
        and (
          (prior_parent_id_value is not null and (
            select count(*) from private.market_radar_parent_children_v1 baseline
            where baseline.parent_reconciliation_id=prior_parent_id_value
              and private.market_radar_child_matches_legacy_v1(
                to_jsonb(baseline),child,provider_input
              )
          )<>1)
          or (prior_parent_id_value is null and (
            select count(*) from private.external_market_candidates baseline
            where baseline.provider=provider_input
              and baseline.external_event_id=reconciliation ->> 'provider_parent_id'
              and baseline.normalizer_version<>'atinara-radar-v3'
              and private.market_radar_child_matches_legacy_v1(jsonb_build_object(
                'external_market_id',coalesce(
                  nullif(baseline.normalized_payload ->> 'external_market_id',''),baseline.external_id
                ),
                'condition_id',nullif(baseline.normalized_payload #>> '{provider_payload,condition_id}',''),
                'token_ids',case
                  when jsonb_typeof(baseline.normalized_payload #> '{provider_payload,token_ids}')='array'
                    then baseline.normalized_payload #> '{provider_payload,token_ids}'
                  else '[]'::jsonb end,
                'child_slug',nullif(baseline.normalized_payload ->> 'external_market_slug','')
              ),child,provider_input)
          )<>1)
        )
    ) then
      raise exception 'RADAR_PARENT_LEGACY_IDENTITY_BIJECTION_MISMATCH' using errcode='22023';
    end if;

    if current_count is distinct from (reconciliation ->> 'provider_discovered_child_count')::integer
       or current_count is distinct from (reconciliation ->> 'provider_accounted_child_count')::integer
       or identified_count is distinct from (reconciliation ->> 'provider_identified_child_count')::integer
       or unresolved_count is distinct from (reconciliation ->> 'provider_unresolved_child_count')::integer
       or removed_count is distinct from (reconciliation ->> 'provider_removed_child_count')::integer
       or closed_count is distinct from (reconciliation ->> 'provider_closed_child_count')::integer
       or duplicate_count is distinct from (reconciliation ->> 'provider_duplicate_child_count')::integer
       or conflict_count is distinct from (reconciliation ->> 'provider_conflict_child_count')::integer
       or new_count is distinct from (reconciliation ->> 'new_child_count')::integer
       or (legacy_expected_value is null and legacy_count<>0)
       -- Todas las filas legacy deben seguir presentes en el ledger. Estar
       -- observada no significa estar reconciliada: legacy_accounted puede ser
       -- menor mientras el estado sea historical_mapping_required.
       or (legacy_expected_value is not null and legacy_count is distinct from legacy_expected_value)
       or (legacy_expected_value is null and legacy_accounted_value is not null)
       or (legacy_expected_value is not null
         and legacy_accounted_value is distinct from legacy_accounted_count)
       or (known_legacy_count>0 and (
         legacy_expected_value is distinct from known_legacy_count
         or legacy_count is distinct from known_legacy_count
       )) then
      raise exception 'RADAR_PARENT_RECONCILIATION_COUNT_MISMATCH' using errcode='22023';
    end if;
    status_value:=reconciliation ->> 'reconciliation_status';
    if status_value='complete' and (
      coalesce((reconciliation ->> 'provider_pagination_exhausted')::boolean,false) is not true
      or declared_count is null or declared_count<>current_count
      or unresolved_count<>0 or conflict_count<>0
      or (legacy_expected_value is not null
        and legacy_accounted_count<>legacy_expected_value)
    ) then
      raise exception 'RADAR_PARENT_RECONCILIATION_FALSE_COMPLETE' using errcode='23514';
    end if;

    for child_value in select value from jsonb_array_elements(reconciliation -> 'children')
    loop
      begin
        identity_confidence_value:=nullif(child_value ->> 'identity_confidence','')::numeric;
        child_checked_at_value:=(child_value ->> 'checked_at')::timestamptz;
      exception when invalid_text_representation or numeric_value_out_of_range
          or datetime_field_overflow then
        raise exception 'RADAR_PARENT_CHILD_CONFIDENCE_INVALID' using errcode='22003';
      end;
      expected_provider_identity_key:=null;
      if nullif(child_value ->> 'external_market_id','') is not null then
        expected_provider_identity_key:=provider_input||':market:'||(child_value ->> 'external_market_id');
      elsif nullif(child_value ->> 'condition_id','') is not null then
        expected_provider_identity_key:=provider_input||':condition:'||(child_value ->> 'condition_id');
      elsif jsonb_array_length(coalesce(child_value -> 'token_ids','[]'::jsonb))>0 then
        expected_provider_identity_key:=provider_input||':token:'||(child_value -> 'token_ids' ->> 0);
      elsif nullif(child_value ->> 'child_slug','') is not null then
        expected_provider_identity_key:=provider_input||':slug:'||(child_value ->> 'child_slug');
      end if;
      if jsonb_typeof(child_value)<>'object'
         or nullif(child_value ->> 'child_occurrence_key','') is null
         or char_length(child_value ->> 'child_occurrence_key')>500
         or char_length(coalesce(child_value ->> 'provider_child_identity_key',''))>500
         or child_value ->> 'identity_kind' not in ('option','contract')
         or (nullif(child_value ->> 'provider_child_identity_key','') is null
           and child_value ->> 'identity_status'<>'conflict')
         or child_value ->> 'identity_classification' not in (
           'identified_real_option','provider_placeholder_pending_resolution',
           'aggregate_other_option','tie_option','no_winner_option','provider_removed_child',
           'provider_closed_child','provider_duplicate_child','provider_data_conflict'
         )
         or child_value ->> 'identity_status' not in (
           'resolved','unresolved_placeholder','conflict','duplicate','removed'
         )
         or child_value ->> 'transition' not in ('same','new','renamed','removed','moved_parent')
         or child_value ->> 'availability_status' not in (
           'open','closed','inactive','removed','unknown','unopened','paused'
         )
         or child_value ->> 'projection_version' is distinct from 'atinara-radar-child-projection-v1'
         or identity_confidence_value is null or identity_confidence_value not between 0 and 100
         or child_checked_at_value is distinct from checked_at_value
         or (child_value ->> 'identity_status' in ('resolved','duplicate','removed') and (
           nullif(child_value ->> 'identity_source','') is null or identity_confidence_value<>100
         ))
         or (child_value ->> 'identity_status'='unresolved_placeholder'
           and identity_confidence_value<>0)
         or coalesce(child_value ->> 'child_fingerprint','') !~ '^[a-f0-9]{64}$'
         or jsonb_typeof(child_value -> 'provider_contract') is distinct from 'object'
         or pg_column_size(child_value -> 'provider_contract')>32768
         or char_length(coalesce(child_value ->> 'provider_contract_canonical_json','')) not between 2 and 32768
         or child_value #>> '{provider_contract,contract_version}'
           is distinct from 'atinara-radar-provider-child-contract-v1'
         or child_value #>> '{provider_contract,provider}' is distinct from provider_input
         or child_value #>> '{provider_contract,provider_parent_id}'
           is distinct from reconciliation ->> 'provider_parent_id'
         or child_value #>> '{provider_contract,external_market_id}'
           is distinct from nullif(child_value ->> 'external_market_id','')
         or child_value #>> '{provider_contract,condition_id}'
           is distinct from nullif(child_value ->> 'condition_id','')
         or coalesce(child_value #> '{provider_contract,token_ids}','[]'::jsonb)
           is distinct from coalesce(child_value -> 'token_ids','[]'::jsonb)
         or child_value #>> '{provider_contract,child_slug}'
           is distinct from nullif(child_value ->> 'child_slug','')
         or child_value #>> '{provider_contract,event_slug}'
           is distinct from nullif(child_value ->> 'event_slug','')
         or child_value #>> '{provider_contract,raw_provider_child_label}'
           is distinct from nullif(child_value ->> 'raw_provider_child_label','')
         or (nullif(child_value ->> 'event_id','') is not null
           and child_value ->> 'event_id'<>reconciliation ->> 'provider_parent_id')
         or nullif(child_value ->> 'provider_child_identity_key','')
           is distinct from expected_provider_identity_key
         or coalesce(child_value ->> 'provider_contract_hash','') !~ '^[a-f0-9]{64}$'
         or (child_value ->> 'provider_contract_canonical_json')::jsonb is distinct from
           jsonb_build_object(
             'contract_version',child_value #>> '{provider_contract,contract_version}',
             'provider',child_value #>> '{provider_contract,provider}',
             'source_question',child_value #> '{provider_contract,source_question}',
             'source_description',child_value #> '{provider_contract,source_description}',
             'source_resolution_rules',child_value #> '{provider_contract,source_resolution_rules}',
             'source_resolution_url',child_value #> '{provider_contract,source_resolution_url}',
             'source_close_at',child_value #> '{provider_contract,source_close_at}',
             'source_resolution_deadline',child_value #> '{provider_contract,source_resolution_deadline}'
           )
         or encode(extensions.digest(convert_to(child_value ->> 'provider_contract_canonical_json','UTF8'),'sha256'),'hex')
           is distinct from child_value ->> 'provider_contract_hash'
         or jsonb_typeof(coalesce(child_value -> 'identity_evidence','[]'::jsonb))<>'array'
         or jsonb_array_length(coalesce(child_value -> 'identity_evidence','[]'::jsonb))>24
         or not exists (
           select 1 from jsonb_array_elements(child_value -> 'identity_evidence') evidence
           where evidence ->> 'url' ~ '^https://'
             and nullif(evidence ->> 'result','') is not null
         )
         or not (
           (child_value ->> 'identity_classification' in (
             'identified_real_option','aggregate_other_option','tie_option',
             'no_winner_option','provider_closed_child'
           ) and child_value ->> 'identity_status'='resolved')
           or (child_value ->> 'identity_classification'='provider_placeholder_pending_resolution'
             and child_value ->> 'identity_status'='unresolved_placeholder')
           or (child_value ->> 'identity_classification'='provider_data_conflict'
             and child_value ->> 'identity_status'='conflict')
           or (child_value ->> 'identity_classification'='provider_duplicate_child'
             and child_value ->> 'identity_status'='duplicate')
           or (child_value ->> 'identity_classification'='provider_removed_child'
             and child_value ->> 'identity_status'='removed')
         )
         or (child_value ->> 'identity_status'='resolved' and child_value ->> 'identity_kind'='option' and (
           nullif(child_value ->> 'canonical_child_label','') is null
           or coalesce(child_value ->> 'canonical_child_slug','') !~ '^[a-z0-9][a-z0-9-]{0,239}$'
           or child_value ->> 'canonical_child_key'
             is distinct from 'option:'||(child_value ->> 'canonical_child_slug')
           or child_value ->> 'canonical_child_label' ~* '^\s*deadline:'
           or child_value ->> 'canonical_child_label' ~* '\d{4}-\d{2}-\d{2}T\d{2}:\d{2}'
           or child_value ->> 'canonical_child_label' ~* '^\s*(lt|lte|gt|gte)\s+\d'
           or child_value ->> 'canonical_child_label' ~* '^\s*(ET|year)\s*$'
           or child_value ->> 'canonical_child_label' ~* '^\s*(before|after|by|on\s+or\s+before|on\s+or\s+after|during|in|antes\s+de|despu[eé]s\s+de|hasta|durante|en)\s+\d{4}(\s|$)'
           or child_value ->> 'canonical_child_label' ~* '^\s*\d{4}(\s*\((ET|year)\))?\s*$'
         ))
         or (child_value ->> 'identity_status'='resolved' and child_value ->> 'identity_kind'='contract' and (
           nullif(child_value ->> 'canonical_child_label','') is not null
           or nullif(child_value ->> 'canonical_child_slug','') is not null
           or nullif(child_value ->> 'canonical_child_key','') is not null
         ))
         or (child_value ->> 'identity_status'='unresolved_placeholder' and (
           nullif(child_value ->> 'canonical_child_label','') is not null
           or nullif(child_value ->> 'canonical_child_slug','') is not null
           or nullif(child_value ->> 'canonical_child_key','') is not null
         ))
         or (child_value ->> 'identity_classification'='provider_duplicate_child' and
           nullif(child_value ->> 'duplicate_of_child_identity_key','') is null)
         or (child_value ->> 'identity_classification'='provider_closed_child'
           and child_value ->> 'availability_status' not in ('closed','inactive'))
         or (child_value ->> 'identity_classification'='provider_removed_child' and (
           not (coalesce((child_value ->> 'present_in_current_snapshot')::boolean,false)
             or coalesce((child_value ->> 'present_in_legacy_snapshot')::boolean,false))
           or child_value ->> 'availability_status'<>'removed'
           or not exists (
             select 1 from jsonb_array_elements(child_value -> 'identity_evidence') evidence
             where evidence ->> 'url' ~ '^https://'
               and evidence ->> 'result'='provider_removed_child'
           )
         ))
         or (child_value ->> 'identity_status'='resolved' and not exists (
           select 1 from jsonb_array_elements(child_value -> 'identity_evidence') evidence
           where evidence ->> 'url' ~ '^https://'
             and evidence ->> 'identifier' is not null
             and coalesce(evidence ->> 'identity_sha256',evidence ->> 'content_sha256')
               ~ '^[a-f0-9]{64}$'
             and evidence ->> 'result' in (
               'identity_resolved','child_identity_observed_in_parent','provider_closed_child'
             )
         )) then
        raise exception 'RADAR_PARENT_CHILD_RECONCILIATION_INVALID' using errcode='22023';
      end if;
    end loop;
    issue_id_value:=null;
    for prior_issue in
      select occurrence.issue_id,occurrence.issue_code,occurrence.issue_fingerprint,
        coalesce(latest.new_status,'open') as effective_status
      from private.market_workflow_issue_occurrences_v1 occurrence
      join private.market_workflow_issue_subject_links_v1 link
        on link.issue_id=occurrence.issue_id
      left join lateral (
        select event.new_status from private.market_workflow_issue_events_v1 event
        where event.issue_id=occurrence.issue_id
        order by event.occurred_at desc,event.id desc limit 1
      ) latest on true
      where link.subject_type='provider_refresh'
        and link.subject_key=left(provider_input||':'||(reconciliation ->> 'provider_parent_id'),240)
        and link.subject_version='atinara-radar-parent-reconciliation-v1'
        and occurrence.issue_code in (
          'PROVIDER_CHILD_IDENTITY_RESOLUTION_REQUIRED',
          'RADAR_PARENT_RECONCILIATION_INCOMPLETE','PROVIDER_PARENT_COUNT_INCONSISTENT'
        )
        and coalesce(latest.new_status,'open') not in ('resolved','superseded')
    loop
      if status_value='complete' then
        insert into private.market_workflow_issue_events_v1(
          issue_id,event_type,previous_status,new_status,owner_stage,next_action,
          resolution_method,evidence_refs,occurred_at
        ) values (
          prior_issue.issue_id,'resolved',prior_issue.effective_status,'resolved','radar',
          'retry_provider_refresh','provider_parent_reconciled',
          jsonb_build_array(jsonb_build_object(
            'reconciliation_fingerprint',reconciliation ->> 'reconciliation_fingerprint'
          )),clock_timestamp()
        );
      elsif coalesce(reconciliation #>> '{issue,fingerprint}','')<>prior_issue.issue_fingerprint then
        insert into private.market_workflow_issue_events_v1(
          issue_id,event_type,previous_status,new_status,owner_stage,next_action,
          resolution_method,evidence_refs,occurred_at
        ) values (
          prior_issue.issue_id,'superseded',prior_issue.effective_status,'superseded','radar',
          'retry_provider_refresh','superseded_by_parent_reconciliation',
          jsonb_build_array(jsonb_build_object(
            'reconciliation_fingerprint',reconciliation ->> 'reconciliation_fingerprint'
          )),clock_timestamp()
        );
      end if;
    end loop;
    if status_value<>'complete' then
      if jsonb_typeof(reconciliation -> 'issue')<>'object' then
        raise exception 'RADAR_PARENT_RECONCILIATION_ISSUE_REQUIRED' using errcode='23514';
      end if;
      issue_id_value:=private.record_market_workflow_issue_v1(
        'provider_refresh',
        left(provider_input||':'||(reconciliation ->> 'provider_parent_id'),240),
        'atinara-radar-parent-reconciliation-v1',
        reconciliation ->> 'reconciliation_fingerprint',
        reconciliation -> 'issue',null,null
      );
    end if;

    legacy_persisted_expected_value:=coalesce(
      nullif(known_legacy_count,0),legacy_expected_value
    );
    if legacy_expected_value is null then
      legacy_persisted_accounted_value:=null;
    else
      legacy_persisted_accounted_value:=legacy_accounted_count;
    end if;

    insert into private.market_radar_parent_reconciliations_v1(
      request_id,provider,capability,provider_parent_id,raw_provider_parent_label,
      canonical_parent_label,raw_provider_category,atinara_category,category,
      external_parent_url,horizon_at,provider_declared_child_count,
      provider_discovered_child_count,provider_accounted_child_count,
      provider_identified_child_count,provider_unresolved_child_count,
      provider_removed_child_count,provider_closed_child_count,
      provider_duplicate_child_count,provider_conflict_child_count,
      legacy_expected_child_count,legacy_accounted_child_count,new_child_count,
      provider_pagination_exhausted,reconciliation_status,reconciliation_version,
      normalizer_version,family_version,reconciliation_fingerprint,checked_at,
      next_retry_at,source_refs,payload_hash,issue_id
    ) values (
      request_id_input,provider_input,capability_input,
      left(reconciliation ->> 'provider_parent_id',220),
      nullif(left(reconciliation ->> 'raw_provider_parent_label',500),''),
      nullif(left(reconciliation ->> 'canonical_parent_label',500),''),
      nullif(left(reconciliation ->> 'raw_provider_category',120),''),
      nullif(left(reconciliation ->> 'atinara_category',120),''),
      nullif(left(reconciliation ->> 'category',120),''),
      nullif(left(reconciliation ->> 'external_parent_url',2000),''),
      nullif(reconciliation ->> 'horizon_at','')::timestamptz,declared_count,
      current_count,current_count,identified_count,unresolved_count,removed_count,
      closed_count,duplicate_count,conflict_count,
      legacy_persisted_expected_value,legacy_persisted_accounted_value,new_count,
      coalesce((reconciliation ->> 'provider_pagination_exhausted')::boolean,false),
      status_value,'atinara-radar-parent-reconciliation-v1','atinara-radar-v3',
      'atinara-market-family-v5',reconciliation ->> 'reconciliation_fingerprint',
      (reconciliation ->> 'checked_at')::timestamptz,
      nullif(reconciliation ->> 'next_retry_at','')::timestamptz,
      coalesce(reconciliation -> 'source_refs','[]'::jsonb),
      private.market_radar_reconciliation_payload_hash_v1(reconciliation,'parent'),
      issue_id_value
    ) on conflict(request_id,provider,provider_parent_id) do nothing;

    select * into parent_row
    from private.market_radar_parent_reconciliations_v1 parent_alias
    where parent_alias.request_id=request_id_input
      and parent_alias.provider=provider_input
      and parent_alias.provider_parent_id=reconciliation ->> 'provider_parent_id';
    if not found or parent_row.reconciliation_fingerprint
      is distinct from reconciliation ->> 'reconciliation_fingerprint'
      or parent_row.payload_hash is distinct from
        private.market_radar_reconciliation_payload_hash_v1(reconciliation,'parent') then
      raise exception 'RADAR_PARENT_RECONCILIATION_IDEMPOTENCY_CONFLICT' using errcode='40001';
    end if;

    for child_value in select value from jsonb_array_elements(reconciliation -> 'children')
    loop
      insert into private.market_radar_parent_children_v1(
        parent_reconciliation_id,child_occurrence_key,provider_child_identity_key,identity_kind,
        external_market_id,condition_id,token_ids,child_slug,event_id,event_slug,
        raw_provider_child_label,canonical_child_label,canonical_child_slug,
        canonical_child_key,identity_classification,identity_status,
        availability_status,identity_source,identity_confidence,identity_evidence,
        present_in_current_snapshot,present_in_legacy_snapshot,transition,
        duplicate_of_child_identity_key,provider_contract,provider_contract_canonical_json,
        provider_contract_hash,
        projection_version,child_fingerprint,payload_hash,checked_at
      ) values (
        parent_row.id,left(child_value ->> 'child_occurrence_key',500),
        nullif(left(child_value ->> 'provider_child_identity_key',500),''),child_value ->> 'identity_kind',
        nullif(left(child_value ->> 'external_market_id',220),''),
        nullif(left(child_value ->> 'condition_id',220),''),
        coalesce(child_value -> 'token_ids','[]'::jsonb),
        nullif(left(child_value ->> 'child_slug',400),''),
        nullif(left(child_value ->> 'event_id',220),''),
        nullif(left(child_value ->> 'event_slug',400),''),
        nullif(left(child_value ->> 'raw_provider_child_label',500),''),
        nullif(left(child_value ->> 'canonical_child_label',500),''),
        nullif(left(child_value ->> 'canonical_child_slug',240),''),
        nullif(left(child_value ->> 'canonical_child_key',247),''),
        child_value ->> 'identity_classification',child_value ->> 'identity_status',
        left(child_value ->> 'availability_status',80),
        nullif(left(child_value ->> 'identity_source',120),''),
        least(greatest(coalesce((child_value ->> 'identity_confidence')::numeric,0),0),100),
        coalesce(child_value -> 'identity_evidence','[]'::jsonb),
        coalesce((child_value ->> 'present_in_current_snapshot')::boolean,false),
        coalesce((child_value ->> 'present_in_legacy_snapshot')::boolean,false),
        child_value ->> 'transition',
        nullif(left(child_value ->> 'duplicate_of_child_identity_key',500),''),
        child_value -> 'provider_contract',child_value ->> 'provider_contract_canonical_json',
        child_value ->> 'provider_contract_hash',
        'atinara-radar-child-projection-v1',child_value ->> 'child_fingerprint',
        private.market_radar_reconciliation_payload_hash_v1(child_value,'child'),
        (child_value ->> 'checked_at')::timestamptz
      ) on conflict(parent_reconciliation_id,child_occurrence_key) do nothing;
      if not exists (
        select 1 from private.market_radar_parent_children_v1 child_alias
        where child_alias.parent_reconciliation_id=parent_row.id
          and child_alias.child_occurrence_key=child_value ->> 'child_occurrence_key'
          and child_alias.child_fingerprint=child_value ->> 'child_fingerprint'
          and child_alias.payload_hash=
            private.market_radar_reconciliation_payload_hash_v1(child_value,'child')
      ) then
        raise exception 'RADAR_PARENT_CHILD_IDEMPOTENCY_CONFLICT' using errcode='40001';
      end if;
    end loop;
    select count(*) into persisted_child_count
    from private.market_radar_parent_children_v1 child_alias
    where child_alias.parent_reconciliation_id=parent_row.id;
    if persisted_child_count<>jsonb_array_length(reconciliation -> 'children') then
      raise exception 'RADAR_PARENT_CHILD_PERSISTENCE_INCOMPLETE' using errcode='23514';
    end if;
    output_items:=output_items||jsonb_build_array(jsonb_build_object(
      'id',parent_row.id,'provider_parent_id',parent_row.provider_parent_id,
      'reconciliation_status',parent_row.reconciliation_status,
      'reconciliation_fingerprint',parent_row.reconciliation_fingerprint,
      'issue_id',parent_row.issue_id
    ));
  end loop;

  select count(*),count(*) filter(where reconciliation_status<>'complete'),
    encode(extensions.digest(convert_to(coalesce(string_agg(
      provider_parent_id||':'||reconciliation_fingerprint,'|' order by provider_parent_id
    ),''),'UTF8'),'sha256'),'hex')
  into parent_count_value,incomplete_count_value,manifest_hash_value
  from private.market_radar_parent_reconciliations_v1
  where request_id=request_id_input and provider=provider_input;
  select coalesce(sum(provider_discovered_child_count),0)::integer
  into selected_child_count_value
  from private.market_radar_parent_reconciliations_v1
  where request_id=request_id_input and provider=provider_input;
  if parent_count_value<>jsonb_array_length(reconciliations_input)
     or manifest_hash_value is null
     or intent.provider_selection is null
     or (intent.provider_selection ->> 'selected_parent_count')::integer<>parent_count_value
     or (intent.provider_selection ->> 'selected_child_count')::integer<>selected_child_count_value
     or exists (
       select 1
       from private.market_radar_parent_reconciliations_v1 parent_alias
       where parent_alias.request_id=request_id_input
         and parent_alias.provider=provider_input
         and not exists (
           select 1
           from jsonb_array_elements_text(
             intent.provider_selection -> 'selected_parent_ids'
           ) selected(parent_id)
           where selected.parent_id=parent_alias.provider_parent_id
         )
     )
     or exists (
       select 1
       from jsonb_array_elements_text(
         intent.provider_selection -> 'selected_parent_ids'
       ) selected(parent_id)
       where not exists (
         select 1
         from private.market_radar_parent_reconciliations_v1 parent_alias
         where parent_alias.request_id=request_id_input
           and parent_alias.provider=provider_input
           and parent_alias.provider_parent_id=selected.parent_id
       )
     )
     or exists (
       select 1
       from jsonb_array_elements_text(intent.provider_selection -> 'deferred_parent_ids') deferred(parent_id)
       join private.market_radar_parent_reconciliations_v1 parent_alias
         on parent_alias.provider_parent_id=deferred.parent_id
       where parent_alias.request_id=request_id_input
         and parent_alias.provider=provider_input
     ) then
    raise exception 'RADAR_PARENT_MANIFEST_INCOMPLETE' using errcode='23514';
  end if;
  if intent.parent_manifest_hash is not null
     and intent.parent_manifest_hash is distinct from manifest_hash_value then
    raise exception 'RADAR_PARENT_MANIFEST_IDEMPOTENCY_CONFLICT' using errcode='40001';
  end if;
  update private.market_radar_refresh_intents_v1 set
    parent_manifest_hash=manifest_hash_value,
    provider_parent_count=parent_count_value,
    reconciled_parent_count=parent_count_value,
    incomplete_parent_count=incomplete_count_value,
    provider_pagination_exhausted=not exists (
      select 1 from private.market_radar_parent_reconciliations_v1 parent_alias
      where parent_alias.request_id=request_id_input and parent_alias.provider=provider_input
        and not parent_alias.provider_pagination_exhausted
    ),
    updated_at=clock_timestamp()
  where request_id=request_id_input and provider=provider_input and capability=capability_input;
  return jsonb_build_object(
    'ok',true,'request_id',request_id_input,'provider',provider_input,
    'parent_manifest_hash',manifest_hash_value,'provider_parent_count',parent_count_value,
    'reconciled_parent_count',parent_count_value,
    'incomplete_parent_count',incomplete_count_value,'items',output_items
  );
exception when invalid_text_representation or datetime_field_overflow then
  raise exception 'RADAR_PARENT_RECONCILIATION_VALUE_INVALID' using errcode='22007';
end;
$function$;

alter function public.record_market_radar_parent_reconciliations_v1(uuid,text,text,uuid,jsonb)
  owner to postgres;
revoke all on function public.record_market_radar_parent_reconciliations_v1(uuid,text,text,uuid,jsonb)
  from public,anon,authenticated,service_role;
grant execute on function public.record_market_radar_parent_reconciliations_v1(uuid,text,text,uuid,jsonb)
  to service_role;

create or replace function private.rebind_market_radar_protected_candidates_v1(
  request_id_input uuid,
  provider_input text
)
returns integer
language plpgsql
security definer
set search_path to ''
as $function$
declare
  rebound_count integer:=0;
  issue_link record;
begin
  with possible as (
    select candidate.id as candidate_id,parent_alias.id as parent_id,
      parent_alias.reconciliation_fingerprint,
      parent_alias.payload_hash as parent_integrity_hash,child_alias.id as child_id,
      child_alias.child_occurrence_key,child_alias.provider_child_identity_key,
      child_alias.child_fingerprint,child_alias.payload_hash as child_integrity_hash,
      child_alias.canonical_child_key,
      child_alias.canonical_child_label,child_alias.identity_status,
      child_alias.identity_classification,child_alias.availability_status,
      child_alias.raw_provider_child_label,child_alias.provider_contract,
      child_alias.provider_contract_hash,
      candidate.normalized_payload -> 'provider_child_contract' as prior_provider_contract,
      candidate.normalized_payload ->> 'provider_child_contract_hash' as prior_provider_contract_hash,
      candidate.family_type in (
        'categorical_outcomes','participant_options','platform_variants'
      ) and row(
        child_alias.canonical_child_key,child_alias.canonical_child_label
      ) is distinct from row(
        candidate.family_child_key,candidate.family_child_label
      ) as identity_changed,
      candidate.normalized_payload ->> 'provider_child_contract_hash'
        is distinct from child_alias.provider_contract_hash as contract_changed,
      coalesce(
        nullif(candidate.normalized_payload ->> 'availability_status',''),
        child_alias.availability_status
      )
        is distinct from child_alias.availability_status as availability_changed,
      nullif(candidate.normalized_payload ->> 'source_result','')
        is distinct from nullif(child_alias.provider_contract ->> 'source_result','')
        as result_changed,
      nullif(child_alias.provider_contract ->> 'source_result','') is not null
        and nullif(candidate.normalized_payload ->> 'source_result','')
          is distinct from nullif(child_alias.provider_contract ->> 'source_result','')
        as terminal_result,
      row(
        candidate.normalized_payload ->> 'parent_reconciliation_fingerprint',
        candidate.normalized_payload ->> 'parent_reconciliation_integrity_hash',
        candidate.normalized_payload ->> 'parent_child_fingerprint',
        candidate.normalized_payload ->> 'parent_child_integrity_hash',
        coalesce(
          nullif(candidate.normalized_payload ->> 'availability_status',''),
          child_alias.availability_status
        ),
        nullif(candidate.normalized_payload ->> 'canonical_child_key',''),
        nullif(candidate.normalized_payload ->> 'canonical_child_label','')
      ) is distinct from row(
        parent_alias.reconciliation_fingerprint,parent_alias.payload_hash,
        child_alias.child_fingerprint,child_alias.payload_hash,
        child_alias.availability_status,child_alias.canonical_child_key,
        child_alias.canonical_child_label
      ) as material_changed,
      count(*) over(partition by candidate.id) as match_count
    from private.external_market_candidates candidate
    join private.market_radar_parent_reconciliations_v1 parent_alias
      on parent_alias.request_id=request_id_input
     and parent_alias.provider=provider_input
     and parent_alias.provider_parent_id=candidate.external_event_id
     and parent_alias.reconciliation_status='complete'
    join private.market_radar_parent_children_v1 child_alias
      on child_alias.parent_reconciliation_id=parent_alias.id
     and child_alias.present_in_current_snapshot
     and child_alias.identity_status='resolved'
     and child_alias.identity_classification in (
       'identified_real_option','aggregate_other_option','tie_option',
       'no_winner_option','provider_closed_child'
     )
    where candidate.provider=provider_input
      and candidate.normalizer_version='atinara-radar-v3'
      and (
        candidate.state in ('prepared','rejected') and candidate.prepared_draft_id is not null
        or exists (
          select 1 from private.market_drafts protected_draft
          where protected_draft.workflow_status not in ('cancelled','annulled') and (
            protected_draft.radar_candidate_id=candidate.id or (
              protected_draft.intelligence_origin_type='radar_candidate'
              and protected_draft.intelligence_origin_id=candidate.id::text
            )
          )
        )
      )
      and case
        when nullif(candidate.normalized_payload ->> 'parent_child_identity_key','') is not null
          then child_alias.provider_child_identity_key
            =candidate.normalized_payload ->> 'parent_child_identity_key'
        when nullif(candidate.normalized_payload ->> 'external_market_id','') is not null
          then child_alias.external_market_id
            =candidate.normalized_payload ->> 'external_market_id'
        when nullif(candidate.normalized_payload ->> 'condition_id','') is not null
          then child_alias.condition_id=candidate.normalized_payload ->> 'condition_id'
        when jsonb_typeof(candidate.normalized_payload -> 'token_ids')='array'
          and jsonb_array_length(candidate.normalized_payload -> 'token_ids')>0
          then child_alias.token_ids=candidate.normalized_payload -> 'token_ids'
        when nullif(candidate.normalized_payload ->> 'external_market_slug','') is not null
          then child_alias.child_slug=candidate.normalized_payload ->> 'external_market_slug'
        else false end
      and (nullif(candidate.normalized_payload ->> 'external_market_id','') is null
        or child_alias.external_market_id=candidate.normalized_payload ->> 'external_market_id')
      and (nullif(candidate.normalized_payload ->> 'condition_id','') is null
        or child_alias.condition_id=candidate.normalized_payload ->> 'condition_id')
      and case
        when jsonb_typeof(candidate.normalized_payload -> 'token_ids')='array'
          and jsonb_array_length(candidate.normalized_payload -> 'token_ids')>0
          then child_alias.token_ids=candidate.normalized_payload -> 'token_ids'
        else true end
      and (
        (candidate.family_type in (
          'categorical_outcomes','participant_options','platform_variants'
        )
          and child_alias.identity_kind='option')
        or (candidate.family_type not in (
          'categorical_outcomes','participant_options','platform_variants'
        )
          and child_alias.identity_kind='contract')
      )
  ), unique_matches as (
    select * from possible where match_count=1
  ), actionable_matches as (
    select matched.*,case when matched.material_changed then
      private.market_workflow_server_issue_v1(
        case when matched.terminal_result then 'RADAR_EVENT_ALREADY_RESOLVED'
          when matched.identity_changed then 'CHILD_IDENTITY_MISMATCH'
          when matched.contract_changed then 'PROVIDER_CHILD_CONTRACT_CHANGED'
          when matched.availability_changed then 'PROVIDER_OPTION_INACTIVE'
          else 'RADAR_ELIGIBILITY_REQUIRED' end,
        'radar',case when matched.terminal_result then 'radar'
          when matched.identity_changed or matched.contract_changed then 'corrector'
          when matched.availability_changed then 'provider' else 'radar' end,
        case when matched.terminal_result then 'terminal'
          when matched.identity_changed or matched.contract_changed then 'human_editable'
          else 'auto_recoverable' end,
        case when matched.terminal_result then 'terminal' else 'approval' end,
        case when matched.terminal_result then 'archive_terminal_candidate'
          when matched.identity_changed then 'repair_child_identity'
          when matched.contract_changed then 'repair_temporal_or_source_contract'
          when matched.availability_changed then 'retry_provider_refresh'
          else 'refresh_draft_eligibility' end,jsonb_build_object(
          'candidate_id',matched.candidate_id,
          'current_child',jsonb_build_object(
            'family_child_key',(select candidate.family_child_key
              from private.external_market_candidates candidate where candidate.id=matched.candidate_id),
            'family_child_label',(select candidate.family_child_label
              from private.external_market_candidates candidate where candidate.id=matched.candidate_id)
          ),
          'provider_child',jsonb_build_object(
            'canonical_child_key',matched.canonical_child_key,
            'canonical_child_label',matched.canonical_child_label,
            'child_fingerprint',matched.child_fingerprint,
            'prior_provider_contract_hash',matched.prior_provider_contract_hash,
            'provider_contract_hash',matched.provider_contract_hash,
            'prior_provider_contract',matched.prior_provider_contract,
            'provider_contract',matched.provider_contract
          )
        ),not matched.terminal_result,'atinara-radar-parent-reconciliation-v1'
      ) else null end as issue_value
    from unique_matches matched
  )
  update private.external_market_candidates candidate set
    current_parent_reconciliation_id=matched.parent_id,
    current_parent_child_id=matched.child_id,
    current_eligibility_check_id=case when matched.material_changed then null
      else candidate.current_eligibility_check_id end,
    eligibility_status=case when matched.terminal_result then 'terminal'
      when matched.material_changed then 'technical_hold'
      else candidate.eligibility_status end,
    eligibility_reason_code=case when matched.material_changed then
      case when matched.terminal_result then 'RADAR_EVENT_ALREADY_RESOLVED'
        when matched.identity_changed then 'CHILD_IDENTITY_MISMATCH'
        when matched.contract_changed then 'PROVIDER_CHILD_CONTRACT_CHANGED'
        when matched.availability_changed then 'PROVIDER_OPTION_INACTIVE'
        else 'RADAR_ELIGIBILITY_REQUIRED' end else candidate.eligibility_reason_code end,
    eligibility_reason=case when matched.material_changed then
      case when matched.terminal_result
        then 'El proveedor ya declara un resultado para esta hija.'
        when matched.identity_changed
        then 'La identidad vigente del proveedor cambió y el borrador debe repararse.'
        when matched.contract_changed
        then 'El contrato vigente de la hija cambió y debe repararse o revalidarse.'
        when matched.availability_changed
        then 'La disponibilidad vigente de la hija cambió y debe revalidarse.'
        else 'El snapshot material del proveedor cambió y debe revalidarse.' end
      else candidate.eligibility_reason end,
    state=case when matched.terminal_result then 'rejected' else candidate.state end,
    verification_status=case when matched.terminal_result then 'rejected_resolved'
      else candidate.verification_status end,
    verification_reason_code=case when matched.terminal_result then 'EVENT_ALREADY_RESOLVED'
      else candidate.verification_reason_code end,
    verification_reason=case when matched.terminal_result
      then 'El proveedor ya declara un resultado para esta hija.' else candidate.verification_reason end,
    normalized_payload=candidate.normalized_payload||jsonb_build_object(
      'parent_reconciliation_version','atinara-radar-parent-reconciliation-v1',
      'parent_reconciliation_fingerprint',matched.reconciliation_fingerprint,
      'parent_reconciliation_integrity_hash',matched.parent_integrity_hash,
      'parent_child_occurrence_key',matched.child_occurrence_key,
      'parent_child_identity_key',matched.provider_child_identity_key,
      'parent_child_fingerprint',matched.child_fingerprint,
      'parent_child_integrity_hash',matched.child_integrity_hash,
      'canonical_projection_version','atinara-radar-child-projection-v1',
      'canonical_child_key',matched.canonical_child_key,
      'canonical_child_label',matched.canonical_child_label,
      'identity_status',matched.identity_status,
      'identity_classification',matched.identity_classification,
      'availability_status',matched.availability_status,
      'raw_provider_child_label',matched.raw_provider_child_label
      ,'provider_child_contract',matched.provider_contract
      ,'provider_child_contract_hash',matched.provider_contract_hash
    )||case when matched.material_changed then jsonb_build_object(
      'eligibility_status',case when matched.terminal_result then 'terminal'
        else 'technical_hold' end,
      'eligibility_reason_code',case when matched.terminal_result then 'RADAR_EVENT_ALREADY_RESOLVED'
        when matched.identity_changed then 'CHILD_IDENTITY_MISMATCH'
        when matched.contract_changed then 'PROVIDER_CHILD_CONTRACT_CHANGED'
        when matched.availability_changed then 'PROVIDER_OPTION_INACTIVE'
        else 'RADAR_ELIGIBILITY_REQUIRED' end,
      'eligibility_reason',case when matched.terminal_result
        then 'El proveedor ya declara un resultado para esta hija.'
        when matched.identity_changed
        then 'La identidad vigente del proveedor cambió y el borrador debe repararse.'
        when matched.contract_changed
        then 'El contrato vigente de la hija cambió y debe repararse o revalidarse.'
        when matched.availability_changed
        then 'La disponibilidad vigente de la hija cambió y debe revalidarse.'
        else 'El snapshot material del proveedor cambió y debe revalidarse.' end,
      'current_eligibility_check_id',null,
      'state',case when matched.terminal_result then 'rejected' else candidate.state end,
      'verification_status',case when matched.terminal_result then 'rejected_resolved'
        else candidate.verification_status end,
      'verification_reason_code',case when matched.terminal_result then 'EVENT_ALREADY_RESOLVED'
        else candidate.verification_reason_code end,
      'verification_reason',case when matched.terminal_result
        then 'El proveedor ya declara un resultado para esta hija.' else candidate.verification_reason end
    ) else '{}'::jsonb end
    ||case when matched.issue_value is not null then jsonb_build_object(
      'workflow_issues',private.market_workflow_issue_array_replace_v1(
        candidate.normalized_payload -> 'workflow_issues',matched.issue_value
      )
    ) else '{}'::jsonb end,
    updated_at=clock_timestamp()
  from actionable_matches matched
  where candidate.id=matched.candidate_id
    and row(candidate.current_parent_reconciliation_id,candidate.current_parent_child_id)
      is distinct from row(matched.parent_id,matched.child_id);
  get diagnostics rebound_count=row_count;
  for issue_link in
    select candidate.id as candidate_id,draft.id as draft_id,draft.content_version,
      draft.content_fingerprint,issue.value as issue
    from private.external_market_candidates candidate
    join private.market_radar_parent_reconciliations_v1 parent_alias
      on parent_alias.id=candidate.current_parent_reconciliation_id
     and parent_alias.request_id=request_id_input
     and parent_alias.provider=provider_input
    join private.market_drafts draft on draft.workflow_status not in ('cancelled','annulled')
      and (draft.radar_candidate_id=candidate.id or (
        draft.intelligence_origin_type='radar_candidate'
        and draft.intelligence_origin_id=candidate.id::text
      ))
    cross join lateral jsonb_array_elements(case
      when jsonb_typeof(candidate.normalized_payload -> 'workflow_issues')='array'
        then candidate.normalized_payload -> 'workflow_issues' else '[]'::jsonb end
    ) issue(value)
    where issue.value ->> 'issue_code' in (
      'CHILD_IDENTITY_MISMATCH','PROVIDER_CHILD_CONTRACT_CHANGED',
      'PROVIDER_OPTION_INACTIVE','RADAR_EVENT_ALREADY_RESOLVED',
      'RADAR_ELIGIBILITY_REQUIRED'
    )
  loop
    perform private.record_market_workflow_issue_v1(
      'market_draft',issue_link.draft_id::text,issue_link.content_version::text,
      case when issue_link.content_fingerprint~'^[a-f0-9]{64}$'
        then issue_link.content_fingerprint else null end,
      issue_link.issue,null,null
    );
    perform private.project_market_draft_workflow_state_v2(
      issue_link.draft_id,issue_link.content_version
    );
  end loop;
  return rebound_count;
end;
$function$;
alter function private.rebind_market_radar_protected_candidates_v1(uuid,text) owner to postgres;
revoke all on function private.rebind_market_radar_protected_candidates_v1(uuid,text)
  from public,anon,authenticated,service_role;

do $postflight$
declare
  function_source text;
  rebind_source text;
begin
  select pg_catalog.pg_get_functiondef(
    'public.record_market_radar_parent_reconciliations_v1(uuid,text,text,uuid,jsonb)'::regprocedure
  ) into function_source;
  if function_source like '%child jsonb;%'
     or function_source like '%for child in select value from jsonb_array_elements(%'
     or function_source not like '%child_value jsonb;%'
     or function_source not like '%for child_value in select value from jsonb_array_elements(%' then
    raise exception 'RADAR_PARENT_CHILD_ALIAS_POSTFLIGHT_INVALID';
  end if;
  select pg_catalog.pg_get_functiondef(
    'private.rebind_market_radar_protected_candidates_v1(uuid,text)'::regprocedure
  ) into rebind_source;
  if rebind_source like
       '%jsonb_typeof(candidate.normalized_payload -> ''token_ids'')<>''array''%'
     or rebind_source not like '%else true end%'
     or rebind_source not like
       '%coalesce(%availability_status%' then
    raise exception 'RADAR_PROTECTED_REBIND_POSTFLIGHT_INVALID';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema='private' and table_name='external_market_candidates'
      and column_name='verification_confidence' and data_type='numeric'
      and numeric_precision=5 and numeric_scale=2 and is_nullable='YES'
  ) or not exists (
    select 1 from pg_catalog.pg_constraint constraint_alias
    where constraint_alias.conrelid='private.external_market_candidates'::regclass
      and constraint_alias.conname='external_market_candidates_verification_confidence_check'
      and pg_catalog.pg_get_constraintdef(constraint_alias.oid)
        like '%verification_confidence%100%'
  ) then
    raise exception 'RADAR_VERIFICATION_CONFIDENCE_POSTFLIGHT_INVALID';
  end if;
  if not exists (
    select 1
    from pg_catalog.pg_proc procedure
    join pg_catalog.pg_roles role_alias on role_alias.oid=procedure.proowner
    where procedure.oid in (
      'public.record_market_radar_parent_reconciliations_v1(uuid,text,text,uuid,jsonb)'::regprocedure::oid,
      'private.rebind_market_radar_protected_candidates_v1(uuid,text)'::regprocedure::oid
    )
      and role_alias.rolname='postgres'
      and procedure.prosecdef
      and procedure.proconfig@>array['search_path=""']::text[]
    group by role_alias.rolname
    having count(*)=2
  ) then
    raise exception 'RADAR_PARENT_CHILD_ALIAS_SECURITY_INVALID';
  end if;
  if has_function_privilege(
       'anon',
       'public.record_market_radar_parent_reconciliations_v1(uuid,text,text,uuid,jsonb)',
       'execute'
     )
     or has_function_privilege(
       'authenticated',
       'public.record_market_radar_parent_reconciliations_v1(uuid,text,text,uuid,jsonb)',
       'execute'
     )
     or not has_function_privilege(
       'service_role',
       'public.record_market_radar_parent_reconciliations_v1(uuid,text,text,uuid,jsonb)',
       'execute'
     )
     or has_function_privilege(
       'anon','private.rebind_market_radar_protected_candidates_v1(uuid,text)','execute'
     )
     or has_function_privilege(
       'authenticated','private.rebind_market_radar_protected_candidates_v1(uuid,text)','execute'
     )
     or has_function_privilege(
       'service_role','private.rebind_market_radar_protected_candidates_v1(uuid,text)','execute'
     ) then
    raise exception 'RADAR_PARENT_CHILD_ALIAS_ACL_INVALID';
  end if;
end;
$postflight$;

commit;
