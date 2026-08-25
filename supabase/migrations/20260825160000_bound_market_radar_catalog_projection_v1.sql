-- Limita la proyeccion operativa del Radar antes de cruzar PostgREST.
-- Las RPC anteriores se conservan para compatibilidad; v5/v3 exponen solo
-- los campos que el catalogo administrativo consume. No hay backfill ni DML.

create or replace function private.market_radar_catalog_candidate_payload_v1(
  source_payload jsonb,
  rejection_payload boolean default false
)
returns jsonb
language sql
immutable
security definer
set search_path to ''
as $function$
  with scalar_payload as (
    select coalesce(jsonb_object_agg(field.key,field.value),'{}'::jsonb) as value
    from jsonb_each(coalesce(source_payload,'{}'::jsonb)) field
    where field.key=any(array[
      'id','provider','external_id','external_event_id','external_event_slug',
      'external_event_url','external_market_id','external_market_slug',
      'external_market_url','external_url','event_group_key','family_key',
      'family_title','family_type','family_child_key','family_child_label',
      'family_version','family_sort_at','source_title','source_question',
      'source_category','source_close_at','source_status','source_result',
      'source_resolution_url','atinara_category','atinara_group_title',
      'atinara_question','atinara_resolution_source_url','state',
      'normalizer_version','quality_status','verification_status',
      'verification_reason_code','verification_reason','verified_at',
      'verification_expires_at','eligibility_status','eligibility_reason_code',
      'eligibility_reason','eligibility_policy_version','eligibility_checked_at',
      'eligibility_expires_at','domain_reason_code','display_reason_code',
      'display_reason','prepared_draft_id','provider_refresh_checked_at',
      'provider_refresh_state','raw_provider_child_label','canonical_child_label',
      'canonical_child_key','identity_kind','identity_classification',
      'identity_status','identity_source','availability_status',
      'parent_child_occurrence_key','parent_child_identity_key',
      'parent_child_fingerprint','canonical_projection_version',
      'parent_reconciliation_id','parent_reconciliation_status',
      'parent_reconciliation_version','parent_reconciliation_fingerprint',
      'parent_child_id','fetched_at','source_probability',
      'source_probability_yes','quality_score','parent_rank',
      'preparation_revision','current_eligibility_check_id',
      'identity_confidence','provider_declared_child_count',
      'provider_discovered_child_count','provider_accounted_child_count',
      'provider_identified_child_count','provider_unresolved_child_count',
      'provider_removed_child_count','provider_closed_child_count',
      'provider_duplicate_child_count','provider_conflict_child_count',
      'is_stale','eligibility_state_preserved','provider_pagination_exhausted'
    ]::text[])
  ), duplicate_matches as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id',nullif(match.value ->> 'id',''),
      'question',nullif(match.value ->> 'question',''),
      'relationship',nullif(match.value ->> 'relationship',''),
      'blocking',case when match.value -> 'blocking'='false'::jsonb then false else true end
    ) order by match.ordinality),'[]'::jsonb) as value
    from jsonb_array_elements(case
      when jsonb_typeof(source_payload -> 'duplicate_matches')='array'
        then source_payload -> 'duplicate_matches' else '[]'::jsonb end)
      with ordinality as match(value,ordinality)
    where match.ordinality<=20
  ), workflow_issues as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'issue_id',nullif(issue.value ->> 'issue_id',''),
      'issue_code',nullif(issue.value ->> 'issue_code',''),
      'detected_by',nullif(issue.value ->> 'detected_by',''),
      'severity',nullif(issue.value ->> 'severity',''),
      'blocking_scope',nullif(issue.value ->> 'blocking_scope',''),
      'repairability',nullif(issue.value ->> 'repairability',''),
      'status',coalesce(nullif(issue.value ->> 'status',''),'open'),
      'owner_stage',nullif(issue.value ->> 'owner_stage',''),
      'next_action',nullif(issue.value ->> 'next_action',''),
      'retryable',issue.value -> 'retryable'='true'::jsonb
    ) order by issue.ordinality),'[]'::jsonb) as value
    from jsonb_array_elements(case
      when jsonb_typeof(source_payload -> 'workflow_issues')='array'
        then source_payload -> 'workflow_issues' else '[]'::jsonb end)
      with ordinality as issue(value,ordinality)
    where issue.ordinality<=40
  ), hard_reasons as (
    select coalesce(jsonb_agg(to_jsonb(reason.value) order by reason.ordinality),'[]'::jsonb) as value
    from jsonb_array_elements_text(case
      when jsonb_typeof(source_payload -> 'hard_reject_reasons')='array'
        then source_payload -> 'hard_reject_reasons' else '[]'::jsonb end)
      with ordinality as reason(value,ordinality)
    where reason.ordinality<=20 and nullif(reason.value,'') is not null
  ), evidence_pool as (
    select evidence.value,evidence.ordinality
    from jsonb_array_elements(case
      when jsonb_typeof(source_payload -> 'resolution_source_evidence')='array'
        then source_payload -> 'resolution_source_evidence' else '[]'::jsonb end)
      with ordinality as evidence(value,ordinality)
    union all
    select evidence.value,1000+evidence.ordinality
    from jsonb_array_elements(case
      when jsonb_typeof(source_payload -> 'eligibility_evidence')='array'
        then source_payload -> 'eligibility_evidence' else '[]'::jsonb end)
      with ordinality as evidence(value,ordinality)
    union all
    select evidence.value,2000+evidence.ordinality
    from jsonb_array_elements(case
      when jsonb_typeof(source_payload -> 'verification_evidence')='array'
        then source_payload -> 'verification_evidence' else '[]'::jsonb end)
      with ordinality as evidence(value,ordinality)
  ), resolution_proof as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'url',evidence.value ->> 'url','source_type','official',
      'retrieval_status','verified_content','evidence_basis','retrieved_content',
      'claim_status','direct','direct_claim',true
    ) order by evidence.ordinality),'[]'::jsonb) as value
    from (
      select evidence.value,evidence.ordinality
      from evidence_pool evidence
      where evidence.value ->> 'url'=coalesce(
          nullif(source_payload ->> 'atinara_resolution_source_url',''),
          nullif(source_payload ->> 'source_resolution_url','')
        )
        and evidence.value ->> 'source_type'='official'
        and evidence.value ->> 'retrieval_status'='verified_content'
        and evidence.value ->> 'evidence_basis'='retrieved_content'
        and evidence.value ->> 'claim_status'='direct'
        and evidence.value -> 'direct_claim'='true'::jsonb
      order by evidence.ordinality limit 1
    ) evidence
  ), rejection_evidence as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'url',evidence.value ->> 'url',
      'title',nullif(evidence.value ->> 'title','')
    ) order by evidence.ordinality),'[]'::jsonb) as value
    from (
      select evidence.value,evidence.ordinality
      from jsonb_array_elements(case
        when jsonb_typeof(source_payload -> 'verification_evidence')='array'
          then source_payload -> 'verification_evidence' else '[]'::jsonb end)
        with ordinality as evidence(value,ordinality)
      where nullif(evidence.value ->> 'url','') is not null
      order by evidence.ordinality limit 2
    ) evidence
  )
  select scalar_payload.value || jsonb_build_object(
    'duplicate_matches',duplicate_matches.value,
    'workflow_issues',workflow_issues.value,
    'hard_reject_reasons',hard_reasons.value,
    'resolution_source_evidence',resolution_proof.value
  ) || case when rejection_payload then jsonb_build_object(
    'verification_evidence',rejection_evidence.value
  ) else '{}'::jsonb end
  from scalar_payload,duplicate_matches,workflow_issues,hard_reasons,
    resolution_proof,rejection_evidence;
$function$;

alter function private.market_radar_catalog_candidate_payload_v1(jsonb,boolean)
  owner to postgres;
revoke all on function private.market_radar_catalog_candidate_payload_v1(jsonb,boolean)
  from public,anon,authenticated,service_role;

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
language sql
stable
security definer
set search_path to ''
as $function$
  with source as materialized (
    select public.list_market_radar_candidates_v4(
      provider_filter,category_filter,quality_filter,query_filter,order_key,
      horizon_filter,parent_limit_count,parent_offset_count
    ) as payload
  ), projected as (
    select coalesce(jsonb_agg(
      private.market_radar_catalog_candidate_payload_v1(item.value,false)
      order by item.ordinality
    ),'[]'::jsonb) as items
    from source
    cross join lateral jsonb_array_elements(coalesce(source.payload -> 'items','[]'::jsonb))
      with ordinality as item(value,ordinality)
  )
  select (source.payload - 'items') || jsonb_build_object('items',projected.items)
  from source,projected;
$function$;

alter function public.list_market_radar_candidates_v5(text,text,text,text,text,text,integer,integer)
  owner to postgres;
revoke all on function public.list_market_radar_candidates_v5(text,text,text,text,text,text,integer,integer)
  from public,anon,authenticated,service_role;
grant execute on function public.list_market_radar_candidates_v5(text,text,text,text,text,text,integer,integer)
  to authenticated;

create or replace function public.list_market_radar_rejections_v3(
  provider_filter text default null,
  category_filter text default null,
  limit_count integer default 100,
  offset_count integer default 0
)
returns setof jsonb
language sql
stable
security definer
set search_path to ''
as $function$
  select private.market_radar_catalog_candidate_payload_v1(item,true)
  from public.list_market_radar_rejections_v2(
    provider_filter,category_filter,limit_count,offset_count
  ) item;
$function$;

alter function public.list_market_radar_rejections_v3(text,text,integer,integer)
  owner to postgres;
revoke all on function public.list_market_radar_rejections_v3(text,text,integer,integer)
  from public,anon,authenticated,service_role;
grant execute on function public.list_market_radar_rejections_v3(text,text,integer,integer)
  to authenticated;

create or replace function public.list_market_radar_parent_reconciliations_v3(
  provider_filter text default null,
  category_filter text default null,
  query_filter text default null,
  horizon_filter text default '180d',
  limit_count integer default 20,
  offset_count integer default 0
)
returns jsonb
language sql
stable
security definer
set search_path to ''
as $function$
  with source as materialized (
    select public.list_market_radar_parent_reconciliations_v2(
      provider_filter,category_filter,query_filter,horizon_filter,
      limit_count,offset_count
    ) as payload
  ), projected as (
    select coalesce(jsonb_agg(item.value || jsonb_build_object(
      'catalog_candidate_count',counts.catalog_candidate_count,
      'preparable_child_count',counts.preparable_child_count,
      'eligible_child_count',counts.eligible_child_count,
      'technical_hold_child_count',counts.technical_hold_child_count,
      'terminal_child_count',counts.terminal_child_count,
      'resolved_result_child_count',counts.resolved_result_child_count,
      'inactive_child_count',counts.inactive_child_count,
      'duplicate_candidate_child_count',counts.duplicate_candidate_child_count,
      'invalid_child_count',counts.invalid_child_count
    ) order by item.ordinality),'[]'::jsonb) as items
    from source
    cross join lateral jsonb_array_elements(coalesce(source.payload -> 'items','[]'::jsonb))
      with ordinality as item(value,ordinality)
    cross join lateral (
      select
        count(*) filter(where candidate.state in ('available','needs_review')
          and candidate.quality_status in ('fit','needs_review')
          and coalesce(candidate.eligibility_status,'technical_hold')
            not in ('terminal','duplicate','inactive_option','invalid')) as catalog_candidate_count,
        count(*) filter(where candidate.state='available'
          and candidate.quality_status='fit'
          and candidate.verification_status='verified_open'
          and candidate.eligibility_status='eligible'
          and candidate.current_eligibility_check_id is not null
          and candidate.eligibility_expires_at>clock_timestamp()) as preparable_child_count,
        count(*) filter(where candidate.eligibility_status='eligible') as eligible_child_count,
        count(*) filter(where candidate.eligibility_status='technical_hold') as technical_hold_child_count,
        count(*) filter(where candidate.eligibility_status='terminal') as terminal_child_count,
        count(*) filter(where candidate.eligibility_status='terminal'
          and candidate.eligibility_reason_code='EVENT_ALREADY_RESOLVED') as resolved_result_child_count,
        count(*) filter(where candidate.eligibility_status='inactive_option') as inactive_child_count,
        count(*) filter(where candidate.eligibility_status='duplicate') as duplicate_candidate_child_count,
        count(*) filter(where candidate.eligibility_status='invalid') as invalid_child_count
      from private.external_market_candidates candidate
      where candidate.current_parent_reconciliation_id=(item.value ->> 'id')::uuid
        and candidate.normalizer_version='atinara-radar-v3'
        and candidate.family_version='atinara-market-family-v5'
    ) counts
  )
  select (source.payload - 'items') || jsonb_build_object('items',projected.items)
  from source,projected;
$function$;

alter function public.list_market_radar_parent_reconciliations_v3(text,text,text,text,integer,integer)
  owner to postgres;
revoke all on function public.list_market_radar_parent_reconciliations_v3(text,text,text,text,integer,integer)
  from public,anon,authenticated,service_role;
grant execute on function public.list_market_radar_parent_reconciliations_v3(text,text,text,text,integer,integer)
  to authenticated;

comment on function private.market_radar_catalog_candidate_payload_v1(jsonb,boolean) is
  'Proyecta en SQL el contrato minimo de catalogo antes de PostgREST; nunca devuelve payloads raw, contratos completos ni trazas.';
comment on function public.list_market_radar_candidates_v5(text,text,text,text,text,text,integer,integer) is
  'Lista paginada por padres con candidatas ligeras; conserva los filtros v4 y limita el payload antes de la Edge.';
comment on function public.list_market_radar_rejections_v3(text,text,integer,integer) is
  'Auditoria ligera de rechazos reales; conserva solo dos enlaces de evidencia por fila.';
comment on function public.list_market_radar_parent_reconciliations_v3(text,text,text,text,integer,integer) is
  'Reconciliacion de padres con recuentos separados de catalogo, terminalidad, disponibilidad y preparacion.';
