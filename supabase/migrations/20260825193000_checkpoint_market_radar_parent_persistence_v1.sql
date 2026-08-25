-- Convierte cada padre reconciliado en un checkpoint durable y evita que el
-- catalogo materialice el expediente pesado antes de aplicar su proyeccion.
-- No hay backfill ni DML manual: solo se reemplazan contratos versionados.

begin;
set local lock_timeout='5s';
set local statement_timeout='120s';
select pg_catalog.pg_advisory_xact_lock(92060825193000);

do $preflight$
declare
  function_source text;
  function_hash text;
begin
  select replace(pg_catalog.pg_get_functiondef(
    'public.record_market_radar_parent_reconciliations_v1(uuid,text,text,uuid,jsonb)'::regprocedure
  ),chr(13)||chr(10),chr(10)) into function_source;
  function_hash:=encode(extensions.digest(convert_to(function_source,'UTF8'),'sha256'),'hex');
  if function_hash<>'2b5ad04e780ad4f458db972cac82005c5ecc9afdd8508a8affee1d4a13352719'
     or function_source not like '%parent_count_value<>jsonb_array_length(reconciliations_input)%'
     or function_source like '%''complete'',checkpoint_complete_value%' then
    raise exception 'RADAR_PARENT_CHECKPOINT_PREFLIGHT_DRIFT:%',function_hash;
  end if;

  select replace(pg_catalog.pg_get_functiondef(
    'public.list_market_radar_candidates_v5(text,text,text,text,text,text,integer,integer)'::regprocedure
  ),chr(13)||chr(10),chr(10)) into function_source;
  function_hash:=encode(extensions.digest(convert_to(function_source,'UTF8'),'sha256'),'hex');
  if function_hash<>'215070db328265aa2f24f86da634c3774b00c0775785077c4abcb02a5b3198d4'
     or function_source not like '%public.list_market_radar_candidates_v4(%'
     or function_source not like '%source as materialized%' then
    raise exception 'RADAR_CATALOG_CHECKPOINT_PREFLIGHT_DRIFT:%',function_hash;
  end if;
end;
$preflight$;

do $patch_parent_writer$
declare
  function_source text;
  patched_source text;
begin
  select replace(pg_catalog.pg_get_functiondef(
    'public.record_market_radar_parent_reconciliations_v1(uuid,text,text,uuid,jsonb)'::regprocedure
  ),chr(13)||chr(10),chr(10)) into function_source;

  patched_source:=replace(
    function_source,
$old_input_guard$  end if;

  for reconciliation in select value from jsonb_array_elements(reconciliations_input)
$old_input_guard$,
$new_input_guard$  end if;
  if intent.provider_selection is null
     or jsonb_typeof(intent.provider_selection -> 'selected_parent_ids') is distinct from 'array'
     or jsonb_typeof(intent.provider_selection -> 'deferred_parent_ids') is distinct from 'array'
     or coalesce(intent.provider_selection ->> 'selected_parent_count','') !~ '^[0-9]{1,3}$'
     or coalesce(intent.provider_selection ->> 'selected_child_count','') !~ '^[0-9]{1,3}$'
     or exists (
       select 1
       from jsonb_array_elements(reconciliations_input) input_item(value)
       where jsonb_typeof(input_item.value)<>'object'
         or not exists (
           select 1
           from jsonb_array_elements_text(
             intent.provider_selection -> 'selected_parent_ids'
           ) selected(parent_id)
           where selected.parent_id=input_item.value ->> 'provider_parent_id'
         )
         or exists (
           select 1
           from jsonb_array_elements_text(
             intent.provider_selection -> 'deferred_parent_ids'
           ) deferred(parent_id)
           where deferred.parent_id=input_item.value ->> 'provider_parent_id'
         )
     ) or exists (
       select 1
       from jsonb_array_elements(reconciliations_input) input_item(value)
       group by input_item.value ->> 'provider_parent_id'
       having count(*)>1
     ) then
    raise exception 'RADAR_PARENT_CHECKPOINT_SELECTION_INVALID' using errcode='22023';
  end if;

  for reconciliation in select value from jsonb_array_elements(reconciliations_input)
$new_input_guard$
  );
  if patched_source=function_source then
    raise exception 'RADAR_PARENT_CHECKPOINT_INPUT_PATCH_MISSING';
  end if;
  function_source:=patched_source;

  patched_source:=replace(
    function_source,
$old_manifest$  select count(*),count(*) filter(where reconciliation_status<>'complete'),
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
$old_manifest$,
$new_manifest$  <<checkpoint>>
  declare
    expected_parent_count_value integer;
    expected_child_count_value integer;
    checkpoint_complete_value boolean:=false;
  begin
    expected_parent_count_value:=(intent.provider_selection ->> 'selected_parent_count')::integer;
    expected_child_count_value:=(intent.provider_selection ->> 'selected_child_count')::integer;
    if expected_parent_count_value<>jsonb_array_length(
         intent.provider_selection -> 'selected_parent_ids'
       ) or expected_parent_count_value not between 0 and 120
       or expected_child_count_value not between 0 and 480 then
      raise exception 'RADAR_PARENT_CHECKPOINT_SELECTION_INVALID' using errcode='22023';
    end if;

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

    if parent_count_value>expected_parent_count_value
       or selected_child_count_value>expected_child_count_value
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
       ) or exists (
         select 1
         from jsonb_array_elements_text(
           intent.provider_selection -> 'deferred_parent_ids'
         ) deferred(parent_id)
         join private.market_radar_parent_reconciliations_v1 parent_alias
           on parent_alias.provider_parent_id=deferred.parent_id
         where parent_alias.request_id=request_id_input
           and parent_alias.provider=provider_input
       ) then
      raise exception 'RADAR_PARENT_MANIFEST_INCOMPLETE' using errcode='23514';
    end if;

    checkpoint_complete_value:=parent_count_value=expected_parent_count_value
      and selected_child_count_value=expected_child_count_value
      and not exists (
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
      );
    if parent_count_value=expected_parent_count_value and not checkpoint_complete_value then
      raise exception 'RADAR_PARENT_MANIFEST_INCOMPLETE' using errcode='23514';
    end if;
    if not checkpoint_complete_value and intent.parent_manifest_hash is not null then
      raise exception 'RADAR_PARENT_MANIFEST_IDEMPOTENCY_CONFLICT' using errcode='40001';
    end if;
    if checkpoint_complete_value and intent.parent_manifest_hash is not null
       and intent.parent_manifest_hash is distinct from manifest_hash_value then
      raise exception 'RADAR_PARENT_MANIFEST_IDEMPOTENCY_CONFLICT' using errcode='40001';
    end if;

    update private.market_radar_refresh_intents_v1 set
      parent_manifest_hash=case when checkpoint_complete_value then manifest_hash_value else null end,
      provider_parent_count=expected_parent_count_value,
      reconciled_parent_count=parent_count_value,
      incomplete_parent_count=incomplete_count_value,
      provider_pagination_exhausted=case when checkpoint_complete_value then not exists (
        select 1 from private.market_radar_parent_reconciliations_v1 parent_alias
        where parent_alias.request_id=request_id_input and parent_alias.provider=provider_input
          and not parent_alias.provider_pagination_exhausted
      ) else false end,
      updated_at=clock_timestamp()
    where request_id=request_id_input and provider=provider_input and capability=capability_input;
    return jsonb_build_object(
      'ok',true,'complete',checkpoint_complete_value,
      'request_id',request_id_input,'provider',provider_input,
      'parent_manifest_hash',case when checkpoint_complete_value then manifest_hash_value else null end,
      'provider_parent_count',expected_parent_count_value,
      'reconciled_parent_count',parent_count_value,
      'reconciled_child_count',selected_child_count_value,
      'incomplete_parent_count',incomplete_count_value,'items',output_items
    );
  end checkpoint;
$new_manifest$
  );
  if patched_source=function_source then
    raise exception 'RADAR_PARENT_CHECKPOINT_MANIFEST_PATCH_MISSING';
  end if;
  execute patched_source;
end;
$patch_parent_writer$;

alter function public.record_market_radar_parent_reconciliations_v1(uuid,text,text,uuid,jsonb)
  owner to postgres;
revoke all on function public.record_market_radar_parent_reconciliations_v1(uuid,text,text,uuid,jsonb)
  from public,anon,authenticated,service_role;
grant execute on function public.record_market_radar_parent_reconciliations_v1(uuid,text,text,uuid,jsonb)
  to service_role;

create or replace function private.market_radar_catalog_candidate_row_payload_v1(
  candidate private.external_market_candidates,
  parent_rank_input bigint
)
returns jsonb
language sql
stable
security definer
set search_path to ''
as $function$
  with normalized as (
    select coalesce(jsonb_object_agg(field.key,field.value),'{}'::jsonb) as value
    from jsonb_each(coalesce(candidate.normalized_payload,'{}'::jsonb)) field
    where field.key=any(array[
      'external_market_id','source_title','source_question','source_category',
      'source_close_at','source_result','source_resolution_url','atinara_group_title',
      'atinara_question','atinara_resolution_source_url','domain_reason_code',
      'display_reason_code','display_reason','provider_refresh_checked_at',
      'provider_refresh_state','raw_provider_child_label','canonical_child_label',
      'canonical_child_key','identity_kind','identity_classification','identity_status',
      'identity_source','availability_status','parent_child_occurrence_key',
      'parent_child_identity_key','parent_child_fingerprint',
      'canonical_projection_version','parent_reconciliation_status',
      'parent_reconciliation_version','parent_reconciliation_fingerprint',
      'source_probability','source_probability_yes','identity_confidence',
      'provider_declared_child_count','provider_discovered_child_count',
      'provider_accounted_child_count','provider_identified_child_count',
      'provider_unresolved_child_count','provider_removed_child_count',
      'provider_closed_child_count','provider_duplicate_child_count',
      'provider_conflict_child_count','eligibility_state_preserved',
      'provider_pagination_exhausted','workflow_issues','resolution_source_evidence'
    ]::text[])
  )
  select private.market_radar_catalog_candidate_payload_v1(
    normalized.value||jsonb_build_object(
      'id',candidate.id,'provider',candidate.provider,'external_id',candidate.external_id,
      'external_event_id',candidate.external_event_id,'external_url',candidate.external_url,
      'external_event_url',candidate.external_event_url,
      'external_market_url',candidate.external_market_url,
      'external_event_slug',candidate.external_event_slug,
      'external_market_slug',candidate.external_market_slug,
      'event_group_key',candidate.event_group_key,'family_key',candidate.family_key,
      'family_title',candidate.family_title,'family_type',candidate.family_type,
      'family_child_key',candidate.family_child_key,
      'family_child_label',candidate.family_child_label,
      'family_version',candidate.family_version,'family_sort_at',candidate.family_sort_at,
      'source_status',candidate.source_status,'atinara_category',candidate.atinara_category,
      'state',candidate.state,'normalizer_version',candidate.normalizer_version,
      'quality_status',candidate.quality_status,'quality_score',candidate.quality_score,
      'duplicate_matches',candidate.duplicate_matches,
      'hard_reject_reasons',private.market_candidate_authoritative_hard_reasons(
        candidate.normalized_payload,candidate.duplicate_matches
      ),
      'fetched_at',candidate.fetched_at,'is_stale',candidate.expires_at<=pg_catalog.now(),
      'prepared_draft_id',candidate.prepared_draft_id,
      'verification_status',candidate.verification_status,
      'verification_reason_code',candidate.verification_reason_code,
      'verification_reason',candidate.verification_reason,
      'verification_evidence',candidate.verification_evidence,
      'verified_at',candidate.verified_at,
      'verification_expires_at',candidate.verification_expires_at,
      'eligibility_status',candidate.eligibility_status,
      'eligibility_reason_code',candidate.eligibility_reason_code,
      'eligibility_reason',candidate.eligibility_reason,
      'eligibility_evidence',candidate.eligibility_evidence,
      'eligibility_checked_at',candidate.eligibility_checked_at,
      'eligibility_expires_at',candidate.eligibility_expires_at,
      'eligibility_policy_version',candidate.eligibility_policy_version,
      'preparation_revision',candidate.preparation_revision,
      'current_eligibility_check_id',candidate.current_eligibility_check_id,
      'parent_rank',parent_rank_input,
      'parent_reconciliation_id',candidate.current_parent_reconciliation_id,
      'parent_child_id',candidate.current_parent_child_id
    ),false
  )
  from normalized;
$function$;

alter function private.market_radar_catalog_candidate_row_payload_v1(
  private.external_market_candidates,bigint
) owner to postgres;
revoke all on function private.market_radar_catalog_candidate_row_payload_v1(
  private.external_market_candidates,bigint
) from public,anon,authenticated,service_role;

create or replace function public.list_market_radar_candidates_v5(
  provider_filter text default null,
  category_filter text default null,
  quality_filter text default 'fit',
  query_filter text default null,
  order_key text default 'recommended',
  horizon_filter text default '180d',
  parent_limit_count integer default 60,
  parent_offset_count integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  result jsonb;
  checked_at_value timestamptz:=clock_timestamp();
begin
  perform private.require_current_admin();
  if nullif(provider_filter,'') is not null
     and provider_filter not in ('polymarket','kalshi') then
    raise exception 'INVALID_RADAR_PROVIDER' using errcode='22023';
  end if;
  if order_key not in ('recommended','popularity','closing','recent')
     or coalesce(quality_filter,'fit') not in ('fit','review','rejected','all')
     or horizon_filter not in ('30d','90d','180d','365d') then
    raise exception 'INVALID_RADAR_FILTER' using errcode='22023';
  end if;
  if parent_limit_count not between 1 and 100 or parent_offset_count<0 then
    raise exception 'INVALID_RADAR_PAGE' using errcode='22023';
  end if;

  with candidate_base as materialized (
    select candidate.id,candidate.provider,candidate.external_id,
      candidate.family_key,candidate.family_child_key,candidate.state,
      candidate.verification_status,candidate.quality_status,
      candidate.eligibility_status,candidate.quality_score,
      coalesce(nullif(candidate.event_group_key,''),
        nullif(candidate.family_source_event_key,''),
        candidate.provider||':'||coalesce(candidate.external_event_id,candidate.external_id)
      ) as parent_key,
      private.market_radar_candidate_horizon_at_v1(candidate) as horizon_at,
      case when coalesce(candidate.normalized_payload ->> 'source_volume_total','')
          ~ '^-?[0-9]+(?:\.[0-9]+)?$'
        then (candidate.normalized_payload ->> 'source_volume_total')::numeric else 0 end
        as volume_value,
      coalesce(candidate.source_updated_at,candidate.fetched_at) as recent_at,
      eligibility.id as joined_eligibility_id,
      eligibility.expires_at as joined_eligibility_expires_at
    from private.external_market_candidates candidate
    left join private.market_radar_eligibility_checks eligibility
      on eligibility.id=candidate.current_eligibility_check_id
     and eligibility.candidate_id=candidate.id
    where candidate.normalizer_version='atinara-radar-v3'
      and candidate.family_version='atinara-market-family-v5'
      and candidate.family_key is not null and candidate.family_child_key is not null
      and private.market_radar_candidate_reconciliation_ready_v1(candidate)
      and (nullif(provider_filter,'') is null or candidate.provider=provider_filter)
      and (nullif(category_filter,'') is null or candidate.atinara_category=category_filter)
      and (nullif(query_filter,'') is null
        or candidate.normalized_payload ->> 'source_title' ilike '%'||query_filter||'%'
        or candidate.normalized_payload ->> 'source_question' ilike '%'||query_filter||'%'
        or candidate.normalized_payload ->> 'atinara_question' ilike '%'||query_filter||'%')
  ), matching as materialized (
    select candidate.* from candidate_base candidate
    where (
      coalesce(quality_filter,'fit')='fit' and candidate.state='available'
        and candidate.verification_status='verified_open' and candidate.quality_status='fit'
        and candidate.eligibility_status='eligible'
        and candidate.joined_eligibility_id is not null
        and candidate.joined_eligibility_expires_at>checked_at_value
      or coalesce(quality_filter,'fit')='review'
        and candidate.state in ('available','needs_review')
        and candidate.quality_status in ('fit','needs_review')
        and coalesce(candidate.eligibility_status,'technical_hold')
          not in ('terminal','duplicate','inactive_option','invalid')
      or coalesce(quality_filter,'fit')='all'
        and candidate.state in ('available','needs_review')
        and coalesce(candidate.eligibility_status,'technical_hold')
          not in ('terminal','duplicate','inactive_option','invalid')
      or coalesce(quality_filter,'fit')='rejected'
        and (candidate.state='rejected' or candidate.quality_status='rejected')
    )
    and (coalesce(quality_filter,'fit')='rejected' or candidate.horizon_at is null
      or (candidate.horizon_at>checked_at_value
        and candidate.horizon_at<=checked_at_value+case horizon_filter
          when '30d' then interval '30 days' when '90d' then interval '90 days'
          when '365d' then interval '365 days' else interval '180 days' end))
    and (coalesce(quality_filter,'fit')='rejected' or not exists (
      select 1 from public.markets market_alias
      where market_alias.family_key=candidate.family_key
        and market_alias.family_child_key=candidate.family_child_key
    ))
    and (coalesce(quality_filter,'fit')='rejected' or not exists (
      select 1 from private.market_drafts draft_alias
      where (draft_alias.radar_candidate_id=candidate.id or (
        draft_alias.family_key=candidate.family_key
        and draft_alias.family_child_key=candidate.family_child_key))
        and draft_alias.workflow_status not in ('cancelled','annulled')
    ))
  ), parent_scores as materialized (
    select parent_key,max(quality_score) as quality_score,max(volume_value) as volume_value,
      min(horizon_at) as horizon_at,max(recent_at) as recent_at
    from matching group by parent_key
  ), ranked_parents as materialized (
    select parent_key,row_number() over(order by
      case when order_key='recommended' then quality_score end desc nulls last,
      case when order_key='popularity' then volume_value end desc nulls last,
      case when order_key='closing' then horizon_at end asc nulls last,
      case when order_key='recent' then recent_at end desc nulls last,
      quality_score desc nulls last,recent_at desc nulls last,parent_key
    ) as parent_rank
    from parent_scores
  ), selected_parents as materialized (
    select parent_key,parent_rank from ranked_parents
    where parent_rank>parent_offset_count
      and parent_rank<=parent_offset_count+parent_limit_count
  ), page_items as (
    select candidate.id as candidate_id,selected.parent_rank,candidate.quality_score,
      candidate.family_child_key,candidate.provider,candidate.external_id
    from matching candidate join selected_parents selected using(parent_key)
    order by selected.parent_rank,candidate.quality_score desc nulls last,
      candidate.family_child_key,candidate.provider,candidate.external_id
  )
  select jsonb_build_object(
    'items',coalesce((select jsonb_agg(
      private.market_radar_catalog_candidate_row_payload_v1(
        candidate_row,item.parent_rank
      ) order by item.parent_rank,item.quality_score desc nulls last,
        item.family_child_key,item.provider,item.external_id)
      from page_items item
      join private.external_market_candidates candidate_row
        on candidate_row.id=item.candidate_id),'[]'::jsonb),
    'parent_count',(select count(*) from parent_scores),
    'parent_offset',parent_offset_count,'parent_limit',parent_limit_count,
    'next_parent_offset',case
      when parent_offset_count+parent_limit_count<(select count(*) from parent_scores)
      then parent_offset_count+parent_limit_count else null end,
    'previous_parent_offset',case when parent_offset_count>0
      then greatest(0,parent_offset_count-parent_limit_count) else null end,
    'quality_filter',coalesce(quality_filter,'fit'),'checked_at',checked_at_value,
    'projection_version','atinara-radar-child-projection-v1',
    'reconciliation_version','atinara-radar-parent-reconciliation-v1'
  ) into result;
  return result;
end;
$function$;

alter function public.list_market_radar_candidates_v5(text,text,text,text,text,text,integer,integer)
  owner to postgres;
revoke all on function public.list_market_radar_candidates_v5(text,text,text,text,text,text,integer,integer)
  from public,anon,authenticated,service_role;
grant execute on function public.list_market_radar_candidates_v5(text,text,text,text,text,text,integer,integer)
  to authenticated;

comment on function private.market_radar_catalog_candidate_row_payload_v1(
  private.external_market_candidates,bigint
) is 'Proyecta una fila ya paginada sin construir primero el expediente JSON completo.';
comment on function public.record_market_radar_parent_reconciliations_v1(uuid,text,text,uuid,jsonb) is
  'Persiste checkpoints append-only por subconjunto seleccionado y sella el manifiesto solo al completar exactamente padres e hijas.';
comment on function public.list_market_radar_candidates_v5(text,text,text,text,text,text,integer,integer) is
  'Lista paginada por padres con CTE minima y proyeccion ligera previa a la agregacion JSON.';

do $postflight$
declare
  parent_source text;
  catalog_source text;
begin
  select pg_catalog.pg_get_functiondef(
    'public.record_market_radar_parent_reconciliations_v1(uuid,text,text,uuid,jsonb)'::regprocedure
  ) into parent_source;
  select pg_catalog.pg_get_functiondef(
    'public.list_market_radar_candidates_v5(text,text,text,text,text,text,integer,integer)'::regprocedure
  ) into catalog_source;
  if parent_source not like '%''complete'',checkpoint_complete_value%'
     or parent_source not like '%reconciled_child_count%'
     or parent_source not like '%RADAR_PARENT_CHECKPOINT_SELECTION_INVALID%'
     or catalog_source like '%public.list_market_radar_candidates_v4(%'
     or catalog_source not like '%market_radar_catalog_candidate_row_payload_v1%'
     or catalog_source not like '%candidate_base as materialized%' then
    raise exception 'RADAR_PARENT_CHECKPOINT_POSTFLIGHT_BODY_INVALID';
  end if;
  if exists (
    select 1 from pg_catalog.pg_proc procedure
    join pg_catalog.pg_roles role_alias on role_alias.oid=procedure.proowner
    where procedure.oid in (
      'public.record_market_radar_parent_reconciliations_v1(uuid,text,text,uuid,jsonb)'::regprocedure::oid,
      'private.market_radar_catalog_candidate_row_payload_v1(private.external_market_candidates,bigint)'::regprocedure::oid,
      'public.list_market_radar_candidates_v5(text,text,text,text,text,text,integer,integer)'::regprocedure::oid
    ) and (role_alias.rolname<>'postgres' or not procedure.prosecdef
      or not procedure.proconfig@>array['search_path=""']::text[])
  ) then
    raise exception 'RADAR_PARENT_CHECKPOINT_POSTFLIGHT_SECURITY_INVALID';
  end if;
  if has_function_privilege('anon',
       'public.record_market_radar_parent_reconciliations_v1(uuid,text,text,uuid,jsonb)','execute')
     or has_function_privilege('authenticated',
       'public.record_market_radar_parent_reconciliations_v1(uuid,text,text,uuid,jsonb)','execute')
     or not has_function_privilege('service_role',
       'public.record_market_radar_parent_reconciliations_v1(uuid,text,text,uuid,jsonb)','execute')
     or has_function_privilege('anon',
       'public.list_market_radar_candidates_v5(text,text,text,text,text,text,integer,integer)','execute')
     or not has_function_privilege('authenticated',
       'public.list_market_radar_candidates_v5(text,text,text,text,text,text,integer,integer)','execute')
     or has_function_privilege('anon',
       'private.market_radar_catalog_candidate_row_payload_v1(private.external_market_candidates,bigint)','execute')
     or has_function_privilege('authenticated',
       'private.market_radar_catalog_candidate_row_payload_v1(private.external_market_candidates,bigint)','execute')
     or has_function_privilege('service_role',
       'private.market_radar_catalog_candidate_row_payload_v1(private.external_market_candidates,bigint)','execute') then
    raise exception 'RADAR_PARENT_CHECKPOINT_POSTFLIGHT_ACL_INVALID';
  end if;
end;
$postflight$;

commit;
