-- Atinara Radar: alinear la revisión humana de dominio con las huellas reales
-- de candidatas y con atinara-gaming-domain-v2. No contiene DML ni backfill.

begin;
set local lock_timeout='5s';
set local statement_timeout='120s';

do $preflight$
begin
  if to_regclass('private.market_radar_domain_reviews_v1') is null
     or to_regclass('private.external_market_candidates') is null
     or to_regprocedure('public.review_market_radar_domain_v1(uuid,bigint,text,text,text,jsonb,uuid,uuid)') is null
     or to_regprocedure('public.get_market_radar_domain_reviews_v1(jsonb)') is null then
    raise exception 'RADAR_DOMAIN_REVIEW_CONTRACT_DEPENDENCY_MISSING';
  end if;
  if not exists (
       select 1 from pg_constraint constraint_row
       where constraint_row.conrelid='private.market_radar_domain_reviews_v1'::regclass
         and constraint_row.conname='market_radar_domain_reviews_v1_candidate_fingerprint_check'
         and pg_get_constraintdef(constraint_row.oid,true) like '%^[a-f0-9]{64}$%'
     )
     or not exists (
       select 1 from pg_constraint constraint_row
       where constraint_row.conrelid='private.market_radar_domain_reviews_v1'::regclass
         and constraint_row.conname='market_radar_domain_reviews_v1_policy_version_check'
         and pg_get_constraintdef(constraint_row.oid,true) like '%atinara-gaming-domain-v1%'
     ) then
    raise exception 'RADAR_DOMAIN_REVIEW_CONTRACT_BASELINE_MISMATCH';
  end if;
  if exists (
    select 1 from private.external_market_candidates candidate
    where candidate.fingerprint !~ '^([a-f0-9]{64}|r[0-9a-f]{8}|r1-[0-9a-f]{16})$'
  ) then
    raise exception 'RADAR_CANDIDATE_FINGERPRINT_FORMAT_UNSUPPORTED';
  end if;
end;
$preflight$;

alter table private.market_radar_domain_reviews_v1
  drop constraint market_radar_domain_reviews_v1_candidate_fingerprint_check;
alter table private.market_radar_domain_reviews_v1
  add constraint market_radar_domain_reviews_v1_candidate_fingerprint_check
  check (candidate_fingerprint ~ '^([a-f0-9]{64}|r[0-9a-f]{8}|r1-[0-9a-f]{16})$');

alter table private.market_radar_domain_reviews_v1
  drop constraint market_radar_domain_reviews_v1_policy_version_check;
alter table private.market_radar_domain_reviews_v1
  add constraint market_radar_domain_reviews_v1_policy_version_check
  check (policy_version in ('atinara-gaming-domain-v1','atinara-gaming-domain-v2'));

create or replace function public.get_market_radar_domain_reviews_v1(fingerprints_input jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare result jsonb;
begin
  if auth.role()<>'service_role' then
    raise exception 'SERVICE_ROLE_REQUIRED' using errcode='42501';
  end if;
  if jsonb_typeof(fingerprints_input)<>'array' or jsonb_array_length(fingerprints_input)>240
     or exists (select 1 from jsonb_array_elements(fingerprints_input) value
       where jsonb_typeof(value)<>'object'
         or (select array_agg(key order by key) from jsonb_object_keys(value) key)
            is distinct from array['domain_fingerprint','external_id','provider']::text[]
         or value ->> 'provider' not in ('polymarket','kalshi')
         or length(coalesce(value ->> 'external_id','')) not between 1 and 220
         or value ->> 'domain_fingerprint' !~ '^[a-f0-9]{64}$') then
    raise exception 'RADAR_DOMAIN_REVIEW_QUERY_INVALID' using errcode='22023';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'request_id',review.request_id,'candidate_id',review.candidate_id,
    'candidate_revision',review.candidate_revision,
    'candidate_fingerprint',review.candidate_fingerprint,
    'domain_fingerprint',review.domain_fingerprint,
    'provider',review.provider,'external_id',review.external_id,
    'policy_version',review.policy_version,'decision',review.decision,
    'rationale',review.rationale,'evidence_refs',review.evidence_refs,
    'supersedes_request_id',review.supersedes_request_id,'created_at',review.created_at
  ) order by review.candidate_fingerprint),'[]'::jsonb) into result
  from (
    select distinct on (candidate.provider,candidate.external_id,domain_review.domain_fingerprint)
      domain_review.*,candidate.provider,candidate.external_id
    from private.market_radar_domain_reviews_v1 domain_review
    join private.external_market_candidates candidate on candidate.id=domain_review.candidate_id
    where domain_review.policy_version='atinara-gaming-domain-v2' and exists (
      select 1 from jsonb_array_elements(fingerprints_input) scope
      where scope ->> 'provider'=candidate.provider
        and scope ->> 'external_id'=candidate.external_id
        and scope ->> 'domain_fingerprint'=domain_review.domain_fingerprint
    )
    order by candidate.provider,candidate.external_id,domain_review.domain_fingerprint,
      domain_review.created_at desc,
      domain_review.request_id desc
  ) review;
  return result;
end;
$function$;
revoke all on function public.get_market_radar_domain_reviews_v1(jsonb)
  from public,anon,authenticated,service_role;
grant execute on function public.get_market_radar_domain_reviews_v1(jsonb) to service_role;

create or replace function public.review_market_radar_domain_v1(
  candidate_id_input uuid,
  expected_revision_input bigint,
  expected_fingerprint_input text,
  decision_input text,
  rationale_input text,
  evidence_refs_input jsonb,
  request_id_input uuid,
  supersedes_request_id_input uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor_id_value uuid:=private.require_current_admin();
  candidate private.external_market_candidates%rowtype;
  existing private.market_radar_domain_reviews_v1%rowtype;
  previous_review private.market_radar_domain_reviews_v1%rowtype;
  inserted private.market_radar_domain_reviews_v1%rowtype;
  issue_id_value uuid;
  issue_status_value text;
  remaining_issues jsonb;
  terminal_issue jsonb;
  previous_terminal_issue_id uuid;
  previous_terminal_status text;
  request_hash_value text;
  decision_checked_at timestamptz;
  decision_expires_at timestamptz;
  decision_reason_code text;
  decision_reason text;
  domain_fingerprint_value text;
begin
  if request_id_input is null or expected_revision_input<0
     or coalesce(expected_fingerprint_input,'')!~'^([a-f0-9]{64}|r[0-9a-f]{8}|r1-[0-9a-f]{16})$'
     or decision_input not in ('in_domain','out_of_domain')
     or length(btrim(coalesce(rationale_input,''))) not between 20 and 1000
     or btrim(rationale_input)~'[<>]'
     or btrim(rationale_input)~*'(bearer[[:space:]]|api[_ -]?key|secret|password|token[[:space:]]*[:=]|https?://|[[:alnum:]._%+-]+@[[:alnum:].-]+[.][[:alpha:]]{2,})'
     or jsonb_typeof(evidence_refs_input)<>'array' or jsonb_array_length(evidence_refs_input)>8
     or (decision_input='out_of_domain' and jsonb_array_length(evidence_refs_input)=0)
     or exists (select 1 from jsonb_array_elements(evidence_refs_input) reference
       where jsonb_typeof(reference)<>'object'
         or (select array_agg(key order by key) from jsonb_object_keys(reference) key)
           is distinct from array['role','url']::text[]
         or jsonb_typeof(reference -> 'url')<>'string'
         or jsonb_typeof(reference -> 'role')<>'string'
         or length(reference ->> 'url')>2048
         or reference ->> 'url' !~ '^https://[A-Za-z0-9.-]+(?:/|$)'
         or lower(split_part(split_part(reference ->> 'url','://',2),'/',1)) in ('localhost','0.0.0.0')
         or lower(split_part(split_part(reference ->> 'url','://',2),'/',1))~
           '^(127[.]|10[.]|192[.]168[.]|172[.](1[6-9]|2[0-9]|3[01])[.])'
         or reference ->> 'role' not in ('DOMAIN_CONTEXT','PRIMARY_RESOLUTION','CORROBORATION')) then
    raise exception 'RADAR_DOMAIN_REVIEW_INVALID' using errcode='22023';
  end if;
  request_hash_value:=encode(extensions.digest(convert_to(jsonb_build_array(
    candidate_id_input,expected_revision_input,expected_fingerprint_input,decision_input,
    btrim(rationale_input),evidence_refs_input,'atinara-gaming-domain-v2',actor_id_value,
    supersedes_request_id_input
  )::text,'UTF8'),'sha256'),'hex');
  select * into existing from private.market_radar_domain_reviews_v1
  where request_id=request_id_input;
  if found then
    if existing.request_hash is distinct from request_hash_value then
      raise exception 'RADAR_DOMAIN_REVIEW_REQUEST_REUSED' using errcode='40001';
    end if;
    return jsonb_build_object('ok',true,'request_id',existing.request_id,
      'candidate_id',existing.candidate_id,'decision',existing.decision,
      'candidate_revision',existing.candidate_revision,'idempotency_replay',true);
  end if;
  select * into candidate from private.external_market_candidates
  where id=candidate_id_input for update;
  if not found then raise exception 'RADAR_CANDIDATE_NOT_FOUND' using errcode='P0001'; end if;
  if candidate.preparation_revision is distinct from expected_revision_input
     or candidate.fingerprint is distinct from expected_fingerprint_input then
    raise exception 'PREPARATION_REVISION_MISMATCH' using errcode='40001';
  end if;
  domain_fingerprint_value:=candidate.normalized_payload ->> 'domain_review_fingerprint';
  if coalesce(domain_fingerprint_value,'')!~'^[a-f0-9]{64}$' then
    raise exception 'RADAR_DOMAIN_FINGERPRINT_REQUIRED' using errcode='55000';
  end if;
  select * into previous_review
  from private.market_radar_domain_reviews_v1 review
  where review.candidate_id=candidate.id
    and review.policy_version='atinara-gaming-domain-v2'
    and ((supersedes_request_id_input is null
        and review.domain_fingerprint=domain_fingerprint_value)
      or (supersedes_request_id_input is not null
        and review.request_id=supersedes_request_id_input))
  order by review.created_at desc,review.request_id desc
  limit 1;
  if supersedes_request_id_input is null and previous_review.request_id is not null then
    raise exception 'RADAR_DOMAIN_REVIEW_ALREADY_RECORDED' using errcode='40001';
  end if;
  if supersedes_request_id_input is not null and (
       previous_review.request_id is null
       or previous_review.request_id is distinct from supersedes_request_id_input
       or previous_review.request_id is distinct from (
         select review.request_id from private.market_radar_domain_reviews_v1 review
         where review.candidate_id=candidate.id
           and review.policy_version='atinara-gaming-domain-v2'
         order by review.created_at desc,review.request_id desc limit 1
       )
       or previous_review.decision=decision_input
     ) then
    raise exception 'RADAR_DOMAIN_REVIEW_SUPERSESSION_INVALID' using errcode='40001';
  end if;
  select occurrence.issue_id,coalesce(latest.new_status,'open')
    into issue_id_value,issue_status_value
  from private.market_workflow_issue_occurrences_v1 occurrence
  join private.market_workflow_issue_subject_links_v1 link on link.issue_id=occurrence.issue_id
  left join lateral (
    select event.new_status from private.market_workflow_issue_events_v1 event
    where event.issue_id=occurrence.issue_id order by event.occurred_at desc,event.id desc limit 1
  ) latest on true
  where occurrence.issue_code='GAMING_DOMAIN_REVIEW_REQUIRED'
    and link.subject_type='radar_candidate' and link.subject_key=candidate.id::text
    and link.subject_version=candidate.preparation_revision::text
    and coalesce(latest.new_status,'open') not in ('resolved','superseded')
  order by occurrence.created_at desc limit 1;
  if issue_id_value is null and supersedes_request_id_input is null then
    raise exception 'RADAR_DOMAIN_REVIEW_REQUIRED' using errcode='55000';
  end if;
  if issue_id_value is not null then
    perform pg_advisory_xact_lock(hashtextextended(issue_id_value::text,0));
    select coalesce(latest.new_status,'open') into issue_status_value
    from private.market_workflow_issue_occurrences_v1 occurrence
    left join lateral (
      select event.new_status from private.market_workflow_issue_events_v1 event
      where event.issue_id=occurrence.issue_id order by event.occurred_at desc,event.id desc limit 1
    ) latest on true where occurrence.issue_id=issue_id_value;
    if issue_status_value in ('resolved','superseded') then
      raise exception 'RADAR_DOMAIN_REVIEW_STALE' using errcode='40001';
    end if;
  end if;
  if supersedes_request_id_input is not null then
    select occurrence.issue_id,coalesce(latest.new_status,'open')
      into previous_terminal_issue_id,previous_terminal_status
    from private.market_workflow_issue_occurrences_v1 occurrence
    join private.market_workflow_issue_subject_links_v1 link on link.issue_id=occurrence.issue_id
    left join lateral (
      select event.new_status from private.market_workflow_issue_events_v1 event
      where event.issue_id=occurrence.issue_id order by event.occurred_at desc,event.id desc limit 1
    ) latest on true
    where occurrence.issue_code='OUTSIDE_GAMING_DOMAIN'
      and link.subject_type='radar_candidate' and link.subject_key=candidate.id::text
      and coalesce(latest.new_status,'open') not in ('resolved','superseded')
    order by occurrence.created_at desc limit 1;
    if previous_terminal_issue_id is not null then
      perform pg_advisory_xact_lock(hashtextextended(previous_terminal_issue_id::text,0));
      select coalesce(latest.new_status,'open') into previous_terminal_status
      from private.market_workflow_issue_occurrences_v1 occurrence
      left join lateral (
        select event.new_status from private.market_workflow_issue_events_v1 event
        where event.issue_id=occurrence.issue_id order by event.occurred_at desc,event.id desc limit 1
      ) latest on true where occurrence.issue_id=previous_terminal_issue_id;
      if previous_terminal_status not in ('resolved','superseded') then
        insert into private.market_workflow_issue_events_v1(
          issue_id,event_type,previous_status,new_status,actor_id,owner_stage,next_action,
          resolution_method,evidence_refs
        ) values (
          previous_terminal_issue_id,'superseded',previous_terminal_status,'superseded',
          actor_id_value,'human_review','refresh_draft_eligibility',
          'human_domain_review_corrected',jsonb_build_array(jsonb_build_object(
            'previous_request_id',supersedes_request_id_input,'new_request_id',request_id_input
          ))
        );
      end if;
    end if;
  end if;
  insert into private.market_radar_domain_reviews_v1(
    request_id,candidate_id,candidate_revision,candidate_fingerprint,domain_fingerprint,policy_version,
    decision,rationale,evidence_refs,actor_id,request_hash,supersedes_request_id
  ) values (
    request_id_input,candidate.id,candidate.preparation_revision,candidate.fingerprint,
    domain_fingerprint_value,
    'atinara-gaming-domain-v2',decision_input,btrim(rationale_input),evidence_refs_input,
    actor_id_value,request_hash_value,supersedes_request_id_input
  ) returning * into inserted;
  if issue_id_value is not null then
    insert into private.market_workflow_issue_events_v1(
      issue_id,event_type,previous_status,new_status,actor_id,owner_stage,next_action,
      resolution_method,evidence_refs
    ) values (
      issue_id_value,'resolved',issue_status_value,'resolved',actor_id_value,'human_review',
      'refresh_draft_eligibility','human_domain_review',jsonb_build_array(jsonb_build_object(
        'domain_review_request_id',inserted.request_id,'decision',inserted.decision
      ))
    );
  end if;
  select coalesce(jsonb_agg(value),'[]'::jsonb) into remaining_issues
  from jsonb_array_elements(coalesce(candidate.normalized_payload -> 'workflow_issues','[]'::jsonb)) value
  where value ->> 'issue_code' not in ('GAMING_DOMAIN_REVIEW_REQUIRED','OUTSIDE_GAMING_DOMAIN');
  if decision_input='out_of_domain' then
    terminal_issue:=private.market_workflow_server_issue_v1(
      'OUTSIDE_GAMING_DOMAIN','human_review','radar','terminal','terminal',
      'archive_terminal_candidate',jsonb_build_object(
        'candidate_id',candidate.id,'domain_review_request_id',inserted.request_id
      ),false,'atinara-gaming-domain-v2'
    );
    remaining_issues:=remaining_issues||jsonb_build_array(terminal_issue);
  end if;
  decision_checked_at:=clock_timestamp();
  decision_expires_at:=decision_checked_at+case when decision_input='out_of_domain'
    then interval '100 years' else interval '5 minutes' end;
  decision_reason_code:=case when decision_input='out_of_domain'
    then 'OUTSIDE_GAMING_DOMAIN' else 'VERIFICATION_REQUIRED' end;
  decision_reason:=case when decision_input='out_of_domain'
    then 'La revisión humana concluyó que esta candidata queda fuera del ámbito aprobado.'
    else 'La revisión humana de dominio está registrada; falta renovar la elegibilidad factual.' end;
  update private.external_market_candidates set
    normalized_payload=jsonb_set(jsonb_set(jsonb_set(jsonb_set(
      coalesce(normalized_payload,'{}'::jsonb),'{workflow_issues}',remaining_issues,true),
      '{domain_status}',to_jsonb(decision_input),true),'{domain_reason_code}',
      case when decision_input='out_of_domain' then to_jsonb('OUTSIDE_GAMING_DOMAIN'::text)
        else 'null'::jsonb end,true),'{domain_policy_version}',
      to_jsonb('atinara-gaming-domain-v2'::text),true)
      ||jsonb_build_object('human_domain_review',jsonb_build_object(
        'request_id',inserted.request_id,'decision',inserted.decision,
        'rationale',inserted.rationale,'evidence_refs',inserted.evidence_refs,
        'supersedes_request_id',inserted.supersedes_request_id,
        'candidate_fingerprint',inserted.candidate_fingerprint,
        'domain_fingerprint',inserted.domain_fingerprint,
        'policy_version',inserted.policy_version))
      ||jsonb_build_object(
        'eligibility_status',case when decision_input='out_of_domain'
          then 'terminal' else 'technical_hold' end,
        'eligibility_reason_code',decision_reason_code,
        'eligibility_reason',decision_reason,
        'eligibility_evidence',inserted.evidence_refs,
        'eligibility_policy_version','atinara-prediction-policy-v5',
        'eligibility_checked_at',decision_checked_at,
        'eligibility_expires_at',decision_expires_at
      ),
    state=case when decision_input='out_of_domain' then 'rejected' else 'needs_review' end,
    verification_status=case when decision_input='out_of_domain'
      then 'rejected_ineligible' else 'needs_review' end,
    verification_reason_code=case when decision_input='out_of_domain'
      then 'OUTSIDE_GAMING_DOMAIN' else 'VERIFICATION_REQUIRED' end,
    eligibility_status=case when decision_input='out_of_domain'
      then 'terminal' else 'technical_hold' end,
    eligibility_reason_code=decision_reason_code,
    eligibility_reason=decision_reason,
    eligibility_evidence=inserted.evidence_refs,
    verification_reason=decision_reason,
    current_eligibility_check_id=null,
    eligibility_policy_version='atinara-prediction-policy-v5',
    eligibility_checked_at=decision_checked_at,
    eligibility_expires_at=decision_expires_at,
    updated_at=clock_timestamp()
  where id=candidate.id returning * into candidate;
  insert into private.market_admin_audit(actor_id,action_code,draft_id,draft_version,detail)
  values (actor_id_value,'RADAR_DOMAIN_REVIEW_RECORDED',null,null,jsonb_build_object(
    'candidate_id',candidate.id,'candidate_revision',candidate.preparation_revision,
    'request_id',inserted.request_id,'decision',inserted.decision,
    'supersedes_request_id',inserted.supersedes_request_id,'publishes',false
  ));
  return jsonb_build_object('ok',true,'request_id',inserted.request_id,
    'candidate_id',candidate.id,'decision',inserted.decision,
    'rationale',inserted.rationale,'evidence_refs',inserted.evidence_refs,
    'supersedes_request_id',inserted.supersedes_request_id,
    'candidate_revision',candidate.preparation_revision,'idempotency_replay',false,
    'next_action','refresh_draft_eligibility','publishes',false);
end;
$function$;
revoke all on function public.review_market_radar_domain_v1(uuid,bigint,text,text,text,jsonb,uuid,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.review_market_radar_domain_v1(uuid,bigint,text,text,text,jsonb,uuid,uuid)
  to authenticated;

alter function public.get_market_radar_domain_reviews_v1(jsonb) owner to postgres;
alter function public.review_market_radar_domain_v1(uuid,bigint,text,text,text,jsonb,uuid,uuid)
  owner to postgres;

comment on function public.review_market_radar_domain_v1(uuid,bigint,text,text,text,jsonb,uuid,uuid) is
  'Registra una revisión humana de dominio v2 ligada a la revisión y huella versionada exactas de una candidata Radar; nunca crea, confirma ni publica mercados.';

do $postflight$
declare
  candidate_constraint text;
  policy_constraint text;
  review_definition text;
begin
  select pg_get_constraintdef(constraint_row.oid,true) into candidate_constraint
  from pg_constraint constraint_row
  where constraint_row.conrelid='private.market_radar_domain_reviews_v1'::regclass
    and constraint_row.conname='market_radar_domain_reviews_v1_candidate_fingerprint_check';
  select pg_get_constraintdef(constraint_row.oid,true) into policy_constraint
  from pg_constraint constraint_row
  where constraint_row.conrelid='private.market_radar_domain_reviews_v1'::regclass
    and constraint_row.conname='market_radar_domain_reviews_v1_policy_version_check';
  review_definition:=pg_get_functiondef(
    'public.review_market_radar_domain_v1(uuid,bigint,text,text,text,jsonb,uuid,uuid)'::regprocedure
  );
  if candidate_constraint not like '%r[0-9a-f]{8}%'
     or candidate_constraint not like '%r1-[0-9a-f]{16}%'
     or policy_constraint not like '%atinara-gaming-domain-v2%'
     or review_definition not like '%atinara-gaming-domain-v2%'
     or not has_function_privilege('authenticated',
       'public.review_market_radar_domain_v1(uuid,bigint,text,text,text,jsonb,uuid,uuid)','execute')
     or has_function_privilege('anon',
       'public.review_market_radar_domain_v1(uuid,bigint,text,text,text,jsonb,uuid,uuid)','execute')
     or not has_function_privilege('service_role',
       'public.get_market_radar_domain_reviews_v1(jsonb)','execute')
     or has_function_privilege('authenticated',
       'public.get_market_radar_domain_reviews_v1(jsonb)','execute')
     or not exists (
       select 1 from pg_class relation
       join pg_namespace namespace on namespace.oid=relation.relnamespace
       where namespace.nspname='private'
         and relation.relname='market_radar_domain_reviews_v1'
         and relation.relrowsecurity and relation.relforcerowsecurity
     ) then
    raise exception 'RADAR_DOMAIN_REVIEW_CONTRACT_V2_POSTFLIGHT_FAILED';
  end if;
end;
$postflight$;

commit;
