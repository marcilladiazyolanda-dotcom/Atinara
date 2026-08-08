-- Paso 13.5.2 · Memoria durable del flujo de borradores y revisiones.
-- Objetivos:
-- 1) Un guardado sin cambios no incrementa versión ni invalida revisiones.
-- 2) La precisión de segundos no se pierde al pasar por datetime-local.
-- 3) Una aprobación previa del mismo contenido puede reutilizarse de forma segura.
-- 4) Un fallo temporal/JSON inválido no borra una aprobación válida del mismo fingerprint.
-- 5) Cada transición queda recordada en una tabla privada de estados.

create table if not exists private.market_draft_state_memory (
  id bigint generated always as identity primary key,
  draft_id uuid not null references private.market_drafts(id) on delete cascade,
  content_version bigint not null,
  content_fingerprint text,
  workflow_status text not null,
  review_status text not null,
  reviewed_version bigint,
  reviewed_fingerprint text,
  human_confirmed_at timestamptz,
  snapshot jsonb not null,
  memory_reason text not null default 'state_transition',
  memory_key text not null unique,
  created_at timestamptz not null default now()
);

create index if not exists market_draft_state_memory_draft_created_idx
  on private.market_draft_state_memory(draft_id, created_at desc);
create index if not exists market_draft_state_memory_fingerprint_idx
  on private.market_draft_state_memory(draft_id, content_fingerprint, review_status, created_at desc);
create index if not exists market_review_reports_memory_lookup_idx
  on private.market_review_reports(draft_id, content_fingerprint, result, created_at desc);

alter table private.market_draft_state_memory enable row level security;
alter table private.market_draft_state_memory force row level security;
revoke all on table private.market_draft_state_memory from public, anon, authenticated;

create or replace function private.capture_market_draft_state_memory()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  row_value private.market_drafts%rowtype;
  payload jsonb;
  reason_value text;
  key_value text;
begin
  row_value := new;
  payload := to_jsonb(row_value)
    - 'created_by'
    - 'updated_by'
    - 'human_confirmed_by'
    - 'published_by';

  reason_value := case
    when tg_op = 'INSERT' then 'draft_inserted'
    when old.content_fingerprint is distinct from new.content_fingerprint then 'content_changed'
    when old.review_status is distinct from new.review_status then 'review_state_changed'
    when old.workflow_status is distinct from new.workflow_status then 'workflow_state_changed'
    when old.human_confirmed_at is distinct from new.human_confirmed_at then 'human_confirmation_changed'
    else 'state_transition'
  end;

  key_value := md5(concat_ws(
    '|',
    new.id::text,
    new.content_version::text,
    coalesce(new.content_fingerprint, ''),
    new.workflow_status,
    new.review_status,
    coalesce(new.reviewed_version::text, ''),
    coalesce(new.reviewed_fingerprint, ''),
    coalesce(new.human_confirmed_at::text, ''),
    coalesce(new.updated_at::text, '')
  ));

  insert into private.market_draft_state_memory(
    draft_id,
    content_version,
    content_fingerprint,
    workflow_status,
    review_status,
    reviewed_version,
    reviewed_fingerprint,
    human_confirmed_at,
    snapshot,
    memory_reason,
    memory_key
  ) values (
    new.id,
    new.content_version,
    new.content_fingerprint,
    new.workflow_status,
    new.review_status,
    new.reviewed_version,
    new.reviewed_fingerprint,
    new.human_confirmed_at,
    payload,
    reason_value,
    key_value
  ) on conflict (memory_key) do nothing;

  return new;
end;
$$;

revoke all on function private.capture_market_draft_state_memory() from public, anon, authenticated;

drop trigger if exists remember_market_draft_state on private.market_drafts;
create trigger remember_market_draft_state
after insert or update on private.market_drafts
for each row execute function private.capture_market_draft_state_memory();

insert into private.market_draft_state_memory(
  draft_id,
  content_version,
  content_fingerprint,
  workflow_status,
  review_status,
  reviewed_version,
  reviewed_fingerprint,
  human_confirmed_at,
  snapshot,
  memory_reason,
  memory_key
)
select
  d.id,
  d.content_version,
  d.content_fingerprint,
  d.workflow_status,
  d.review_status,
  d.reviewed_version,
  d.reviewed_fingerprint,
  d.human_confirmed_at,
  to_jsonb(d) - 'created_by' - 'updated_by' - 'human_confirmed_by' - 'published_by',
  'migration_backfill',
  md5(concat_ws(
    '|', d.id::text, d.content_version::text, coalesce(d.content_fingerprint, ''),
    d.workflow_status, d.review_status, coalesce(d.reviewed_version::text, ''),
    coalesce(d.reviewed_fingerprint, ''), coalesce(d.human_confirmed_at::text, ''),
    coalesce(d.updated_at::text, '')
  ))
from private.market_drafts d
on conflict (memory_key) do nothing;

create or replace function private.market_datetime_preserve_precision(
  existing_value timestamptz,
  incoming_value timestamptz
)
returns timestamptz
language sql
stable
set search_path = ''
as $$
  select case
    when existing_value is not null
      and incoming_value is not null
      and date_trunc('minute', existing_value) = date_trunc('minute', incoming_value)
      and extract(second from incoming_value) = 0
      and extract(second from existing_value) <> 0
    then existing_value
    else incoming_value
  end;
$$;

revoke all on function private.market_datetime_preserve_precision(timestamptz,timestamptz)
  from public, anon, authenticated;

create or replace function public.save_market_draft(
  draft_id_input uuid,
  expected_version_input bigint,
  draft_input jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := private.require_current_admin();
  draft_row private.market_drafts%rowtype;
  candidate_row private.market_drafts%rowtype;
  previous_fingerprint text;
  next_fingerprint text;
  issues jsonb;
  next_evaluation_end timestamptz;
  next_resolution_deadline timestamptz;
  next_slug text := lower(trim(coalesce(draft_input ->> 'market_slug', '')));
  approved_memory_id bigint;
  approved_memory_validator text;
  review_reused boolean := false;
begin
  if jsonb_typeof(draft_input) <> 'object' then
    raise exception 'INVALID_DRAFT_PAYLOAD' using errcode = '22023';
  end if;
  if octet_length(draft_input::text) > 65536 then
    raise exception 'DRAFT_PAYLOAD_TOO_LARGE' using errcode = '22023';
  end if;
  if next_slug !~ '^[a-z0-9][a-z0-9-]{2,119}$' then
    raise exception 'INVALID_MARKET_SLUG' using errcode = '22023';
  end if;

  begin
    next_evaluation_end := nullif(trim(draft_input ->> 'evaluation_ends_at'), '')::timestamptz;
    next_resolution_deadline := nullif(trim(draft_input ->> 'resolution_deadline'), '')::timestamptz;
  exception when invalid_datetime_format then
    raise exception 'INVALID_DRAFT_DATE' using errcode = '22007';
  end;

  if draft_id_input is null then
    insert into private.market_drafts (
      market_slug, question, subject, category, yes_option, no_option,
      evaluation_period_label, evaluation_ends_at, closes_at, timezone,
      resolution_deadline, yes_criteria, no_criteria, edge_cases,
      primary_source, alternative_sources, delay_treatment,
      cancellation_treatment, leak_treatment, rename_treatment, assumptions,
      public_criteria, description, created_by, updated_by
    ) values (
      next_slug, nullif(trim(draft_input ->> 'question'), ''),
      nullif(trim(draft_input ->> 'subject'), ''), nullif(trim(draft_input ->> 'category'), ''),
      coalesce(nullif(trim(draft_input ->> 'yes_option'), ''), 'Sí'),
      coalesce(nullif(trim(draft_input ->> 'no_option'), ''), 'No'),
      nullif(trim(draft_input ->> 'evaluation_period_label'), ''),
      next_evaluation_end, next_evaluation_end, nullif(trim(draft_input ->> 'timezone'), ''),
      next_resolution_deadline, nullif(trim(draft_input ->> 'yes_criteria'), ''),
      nullif(trim(draft_input ->> 'no_criteria'), ''), nullif(trim(draft_input ->> 'edge_cases'), ''),
      coalesce(draft_input -> 'primary_source', '{}'::jsonb),
      coalesce(draft_input -> 'alternative_sources', '[]'::jsonb),
      nullif(trim(draft_input ->> 'delay_treatment'), ''),
      nullif(trim(draft_input ->> 'cancellation_treatment'), ''),
      nullif(trim(draft_input ->> 'leak_treatment'), ''),
      nullif(trim(draft_input ->> 'rename_treatment'), ''),
      nullif(trim(draft_input ->> 'assumptions'), ''),
      nullif(trim(draft_input ->> 'public_criteria'), ''),
      nullif(trim(draft_input ->> 'description'), ''), actor_id, actor_id
    ) returning * into draft_row;

    next_fingerprint := private.market_draft_fingerprint(draft_row);
    issues := private.market_draft_deterministic_issues(draft_row);

    update private.market_drafts set
      content_fingerprint = next_fingerprint,
      workflow_status = case when jsonb_array_length(issues) = 0 then 'draft_ready' else 'draft_incomplete' end,
      review_status = 'not_requested'
    where id = draft_row.id
    returning * into draft_row;

    insert into private.market_admin_audit(actor_id, action_code, draft_id, draft_version, detail)
    values (actor_id, 'DRAFT_CREATED', draft_row.id, draft_row.content_version,
      jsonb_build_object('deterministic_issue_count', jsonb_array_length(issues), 'changed', true));

    return jsonb_build_object(
      'draft', to_jsonb(draft_row) - 'created_by' - 'updated_by' - 'human_confirmed_by',
      'deterministic_issues', issues,
      'changed', true,
      'review_preserved', false,
      'review_reused_from_memory', false
    );
  end if;

  select * into draft_row from private.market_drafts where id = draft_id_input for update;
  if not found then raise exception 'DRAFT_NOT_FOUND' using errcode = 'P0001'; end if;
  if expected_version_input is null or expected_version_input <> draft_row.content_version then
    raise exception 'DRAFT_VERSION_MOVED' using errcode = '40001';
  end if;
  if draft_row.workflow_status in ('published', 'early_closed', 'cancelled', 'pending_resolution', 'resolved', 'annulled') then
    raise exception 'PUBLISHED_MARKET_FIELDS_LOCKED' using errcode = '22023';
  end if;

  next_evaluation_end := private.market_datetime_preserve_precision(draft_row.evaluation_ends_at, next_evaluation_end);
  next_resolution_deadline := private.market_datetime_preserve_precision(draft_row.resolution_deadline, next_resolution_deadline);

  previous_fingerprint := private.market_draft_fingerprint(draft_row);
  candidate_row := draft_row;
  candidate_row.market_slug := next_slug;
  candidate_row.question := nullif(trim(draft_input ->> 'question'), '');
  candidate_row.subject := nullif(trim(draft_input ->> 'subject'), '');
  candidate_row.category := nullif(trim(draft_input ->> 'category'), '');
  candidate_row.yes_option := coalesce(nullif(trim(draft_input ->> 'yes_option'), ''), 'Sí');
  candidate_row.no_option := coalesce(nullif(trim(draft_input ->> 'no_option'), ''), 'No');
  candidate_row.evaluation_period_label := nullif(trim(draft_input ->> 'evaluation_period_label'), '');
  candidate_row.evaluation_ends_at := next_evaluation_end;
  candidate_row.closes_at := next_evaluation_end;
  candidate_row.timezone := nullif(trim(draft_input ->> 'timezone'), '');
  candidate_row.resolution_deadline := next_resolution_deadline;
  candidate_row.yes_criteria := nullif(trim(draft_input ->> 'yes_criteria'), '');
  candidate_row.no_criteria := nullif(trim(draft_input ->> 'no_criteria'), '');
  candidate_row.edge_cases := nullif(trim(draft_input ->> 'edge_cases'), '');
  candidate_row.primary_source := coalesce(draft_input -> 'primary_source', '{}'::jsonb);
  candidate_row.alternative_sources := coalesce(draft_input -> 'alternative_sources', '[]'::jsonb);
  candidate_row.delay_treatment := nullif(trim(draft_input ->> 'delay_treatment'), '');
  candidate_row.cancellation_treatment := nullif(trim(draft_input ->> 'cancellation_treatment'), '');
  candidate_row.leak_treatment := nullif(trim(draft_input ->> 'leak_treatment'), '');
  candidate_row.rename_treatment := nullif(trim(draft_input ->> 'rename_treatment'), '');
  candidate_row.assumptions := nullif(trim(draft_input ->> 'assumptions'), '');
  candidate_row.public_criteria := nullif(trim(draft_input ->> 'public_criteria'), '');
  candidate_row.description := nullif(trim(draft_input ->> 'description'), '');
  next_fingerprint := private.market_draft_fingerprint(candidate_row);

  if previous_fingerprint is not distinct from next_fingerprint then
    issues := private.market_draft_deterministic_issues(draft_row);
    insert into private.market_admin_audit(actor_id, action_code, draft_id, draft_version, detail)
    values (actor_id, 'DRAFT_SAVE_NOOP_REVIEW_PRESERVED', draft_row.id, draft_row.content_version,
      jsonb_build_object('deterministic_issue_count', jsonb_array_length(issues), 'changed', false,
        'review_status', draft_row.review_status, 'workflow_status', draft_row.workflow_status));
    return jsonb_build_object(
      'draft', to_jsonb(draft_row) - 'created_by' - 'updated_by' - 'human_confirmed_by',
      'deterministic_issues', issues,
      'changed', false,
      'review_preserved', true,
      'review_reused_from_memory', false,
      'message', 'No había cambios materiales. Se conserva la versión y la revisión vigente.'
    );
  end if;

  update private.market_drafts set
    market_slug = candidate_row.market_slug, question = candidate_row.question,
    subject = candidate_row.subject, category = candidate_row.category,
    yes_option = candidate_row.yes_option, no_option = candidate_row.no_option,
    evaluation_period_label = candidate_row.evaluation_period_label,
    evaluation_ends_at = candidate_row.evaluation_ends_at, closes_at = candidate_row.closes_at,
    timezone = candidate_row.timezone, resolution_deadline = candidate_row.resolution_deadline,
    yes_criteria = candidate_row.yes_criteria, no_criteria = candidate_row.no_criteria,
    edge_cases = candidate_row.edge_cases, primary_source = candidate_row.primary_source,
    alternative_sources = candidate_row.alternative_sources,
    delay_treatment = candidate_row.delay_treatment,
    cancellation_treatment = candidate_row.cancellation_treatment,
    leak_treatment = candidate_row.leak_treatment, rename_treatment = candidate_row.rename_treatment,
    assumptions = candidate_row.assumptions, public_criteria = candidate_row.public_criteria,
    description = candidate_row.description,
    content_version = content_version + 1, content_fingerprint = next_fingerprint,
    updated_by = actor_id, updated_at = now()
  where id = draft_id_input returning * into draft_row;

  issues := private.market_draft_deterministic_issues(draft_row);
  if jsonb_array_length(issues) = 0 then
    select r.id, r.validator_version into approved_memory_id, approved_memory_validator
    from private.market_review_reports r
    where r.draft_id = draft_row.id and r.content_fingerprint = next_fingerprint and r.result = 'approved'
    order by r.created_at desc limit 1;
  end if;
  review_reused := approved_memory_id is not null;

  update private.market_drafts set
    workflow_status = case when jsonb_array_length(issues) > 0 then 'draft_incomplete'
      when review_reused then 'review_approved' else 'draft_ready' end,
    review_status = case when review_reused then 'approved' else 'not_requested' end,
    reviewed_version = case when review_reused then content_version else null end,
    reviewed_fingerprint = case when review_reused then content_fingerprint else null end,
    human_confirmed_at = null, human_confirmed_by = null
  where id = draft_row.id returning * into draft_row;

  insert into private.market_admin_audit(actor_id, action_code, draft_id, draft_version, detail)
  values (actor_id,
    case when review_reused then 'DRAFT_SAVED_APPROVAL_REUSED_FROM_MEMORY'
      else 'DRAFT_SAVED_REVIEW_INVALIDATED' end,
    draft_row.id, draft_row.content_version,
    jsonb_build_object('deterministic_issue_count', jsonb_array_length(issues), 'changed', true,
      'previous_fingerprint', previous_fingerprint, 'next_fingerprint', next_fingerprint,
      'memory_report_id', approved_memory_id, 'memory_validator', approved_memory_validator));

  return jsonb_build_object(
    'draft', to_jsonb(draft_row) - 'created_by' - 'updated_by' - 'human_confirmed_by',
    'deterministic_issues', issues,
    'changed', true,
    'review_preserved', false,
    'review_reused_from_memory', review_reused,
    'memory_report_id', approved_memory_id,
    'message', case when review_reused
      then 'El contenido coincide con una versión aprobada previamente. La aprobación se ha recuperado y solo falta la confirmación humana.'
      else 'Los cambios materiales invalidaron la revisión anterior.' end
  );
end;
$$;

revoke all on function public.save_market_draft(uuid,bigint,jsonb) from public, anon;
grant execute on function public.save_market_draft(uuid,bigint,jsonb) to authenticated;

create or replace function public.begin_market_draft_review(draft_id_input uuid, expected_version_input bigint)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor_id uuid := private.require_current_admin();
  draft_row private.market_drafts%rowtype;
  issues jsonb;
  memory_report private.market_review_reports%rowtype;
begin
  select * into draft_row from private.market_drafts where id = draft_id_input for update;
  if not found then raise exception 'DRAFT_NOT_FOUND' using errcode = 'P0001'; end if;
  if expected_version_input is null or draft_row.content_version <> expected_version_input then
    raise exception 'DRAFT_VERSION_MOVED' using errcode = '40001'; end if;
  if draft_row.workflow_status in ('published', 'scheduled', 'cancelled', 'resolved', 'annulled') then
    raise exception 'DRAFT_REVIEW_NOT_ALLOWED' using errcode = '22023'; end if;

  issues := private.market_draft_deterministic_issues(draft_row);
  if jsonb_array_length(issues) > 0 then
    insert into private.market_review_reports(draft_id, draft_version, content_fingerprint, validator_version,
      result, deterministic_issues, reviewed_by)
    values (draft_row.id, draft_row.content_version, draft_row.content_fingerprint,
      'step13.4-deterministic-v2', 'rejected', issues, actor_id);
    update private.market_drafts set workflow_status='review_rejected', review_status='rejected',
      reviewed_version=null, reviewed_fingerprint=null, human_confirmed_at=null, human_confirmed_by=null,
      updated_at=now(), updated_by=actor_id where id=draft_row.id;
    insert into private.market_admin_audit(actor_id, action_code, draft_id, draft_version, detail)
    values (actor_id,'REVIEW_REJECTED_DETERMINISTIC',draft_row.id,draft_row.content_version,
      jsonb_build_object('blocking_reasons',issues));
    return jsonb_build_object('status','rejected','blocking_reasons',issues);
  end if;

  select * into memory_report from private.market_review_reports r
  where r.draft_id=draft_row.id and r.content_fingerprint=draft_row.content_fingerprint and r.result='approved'
  order by r.created_at desc limit 1;
  if memory_report.id is not null then
    update private.market_drafts set
      workflow_status=case when human_confirmed_at is not null then 'human_confirmed' else 'review_approved' end,
      review_status='approved', reviewed_version=content_version,
      reviewed_fingerprint=content_fingerprint, updated_at=now(), updated_by=actor_id
    where id=draft_row.id returning * into draft_row;
    insert into private.market_admin_audit(actor_id,action_code,draft_id,draft_version,detail)
    values(actor_id,'REVIEW_RESTORED_FROM_MEMORY',draft_row.id,draft_row.content_version,
      jsonb_build_object('memory_report_id',memory_report.id,'memory_validator',memory_report.validator_version,
        'content_fingerprint',draft_row.content_fingerprint));
    return jsonb_build_object('status','approved_cached','workflow_status',draft_row.workflow_status,
      'draft_version',draft_row.content_version,'content_fingerprint',draft_row.content_fingerprint,
      'memory_report_id',memory_report.id,'memory_validator',memory_report.validator_version,
      'message','Atinara ha recuperado una aprobación previa del mismo contenido. No se ha consumido una nueva revisión.');
  end if;

  update private.market_drafts set workflow_status='review_in_progress', review_status='in_progress',
    updated_at=now(), updated_by=actor_id where id=draft_row.id returning * into draft_row;
  insert into private.market_admin_audit(actor_id,action_code,draft_id,draft_version)
  values(actor_id,'REVIEW_STARTED',draft_row.id,draft_row.content_version);
  return jsonb_build_object('status','in_progress','draft',to_jsonb(draft_row)-'created_by'-'updated_by'-'human_confirmed_by');
end;$$;

revoke all on function public.begin_market_draft_review(uuid,bigint) from public, anon;
grant execute on function public.begin_market_draft_review(uuid,bigint) to authenticated;

create or replace function public.record_market_draft_review(
  draft_id_input uuid, draft_version_input bigint, content_fingerprint_input text,
  validator_version_input text, result_input text, semantic_issues_input jsonb,
  editorial_notes_input jsonb, reviewed_by_input uuid
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  draft_row private.market_drafts%rowtype;
  normalized_result text := lower(trim(coalesce(result_input,'')));
  next_workflow text;
  approved_memory private.market_review_reports%rowtype;
  reuse_memory boolean := false;
  report_id_value bigint;
begin
  if normalized_result not in ('approved','rejected','inconclusive','service_unavailable','quota_exhausted','invalid_response') then
    raise exception 'INVALID_REVIEW_RESULT' using errcode='22023'; end if;
  if jsonb_typeof(coalesce(semantic_issues_input,'[]'::jsonb))<>'array'
     or jsonb_typeof(coalesce(editorial_notes_input,'[]'::jsonb))<>'array' then
    raise exception 'INVALID_REVIEW_REPORT' using errcode='22023'; end if;
  select * into draft_row from private.market_drafts where id=draft_id_input for update;
  if not found then raise exception 'DRAFT_NOT_FOUND' using errcode='P0001'; end if;
  if draft_row.workflow_status<>'review_in_progress' or draft_version_input is null
     or draft_row.content_version<>draft_version_input or content_fingerprint_input is null
     or draft_row.content_fingerprint is distinct from content_fingerprint_input then
    raise exception 'REVIEW_VERSION_MOVED' using errcode='40001'; end if;
  if normalized_result='approved' and jsonb_array_length(coalesce(semantic_issues_input,'[]'::jsonb))>0 then
    raise exception 'APPROVED_REVIEW_HAS_BLOCKERS' using errcode='22023'; end if;

  insert into private.market_review_reports(draft_id,draft_version,content_fingerprint,validator_version,
    result,semantic_issues,editorial_notes,reviewed_by)
  values(draft_row.id,draft_row.content_version,draft_row.content_fingerprint,
    left(trim(validator_version_input),100),normalized_result,
    coalesce(semantic_issues_input,'[]'::jsonb),coalesce(editorial_notes_input,'[]'::jsonb),reviewed_by_input)
  returning id into report_id_value;

  if normalized_result<>'approved' then
    select * into approved_memory from private.market_review_reports r
    where r.draft_id=draft_row.id and r.content_fingerprint=draft_row.content_fingerprint
      and r.result='approved' and r.id<>report_id_value order by r.created_at desc limit 1;
    reuse_memory := approved_memory.id is not null;
  end if;

  next_workflow := case when normalized_result='approved' or reuse_memory then 'review_approved'
    when normalized_result='rejected' then 'review_rejected'
    when normalized_result='inconclusive' then 'review_inconclusive' else 'review_unavailable' end;

  update private.market_drafts set workflow_status=next_workflow,
    review_status=case when reuse_memory then 'approved' else normalized_result end,
    reviewed_version=case when normalized_result='approved' or reuse_memory then content_version else null end,
    reviewed_fingerprint=case when normalized_result='approved' or reuse_memory then content_fingerprint else null end,
    human_confirmed_at=case when normalized_result='approved' or reuse_memory then
      case when reviewed_fingerprint is not distinct from content_fingerprint then human_confirmed_at else null end else null end,
    human_confirmed_by=case when normalized_result='approved' or reuse_memory then
      case when reviewed_fingerprint is not distinct from content_fingerprint then human_confirmed_by else null end else null end,
    updated_at=now(),updated_by=coalesce(reviewed_by_input,updated_by)
  where id=draft_row.id returning * into draft_row;

  insert into private.market_admin_audit(actor_id,action_code,draft_id,draft_version,detail)
  values(reviewed_by_input,case when reuse_memory then 'REVIEW_FAILURE_IGNORED_LAST_KNOWN_GOOD'
    else 'REVIEW_'||upper(normalized_result) end,draft_row.id,draft_row.content_version,
    jsonb_build_object('blocking_reasons',coalesce(semantic_issues_input,'[]'::jsonb),
      'attempted_result',normalized_result,'effective_result',case when reuse_memory then 'approved' else normalized_result end,
      'memory_report_id',approved_memory.id,'report_id',report_id_value));

  return jsonb_build_object('status',case when reuse_memory then 'approved_cached' else normalized_result end,
    'attempted_status',normalized_result,'workflow_status',draft_row.workflow_status,
    'draft_version',draft_row.content_version,'memory_reused',reuse_memory,
    'memory_report_id',approved_memory.id,'report_id',report_id_value,
    'message',case when reuse_memory then 'La nueva revisión no fue válida, pero Atinara conservó una aprobación previa del mismo contenido.' else null end);
end;$$;

revoke all on function public.record_market_draft_review(uuid,bigint,text,text,text,jsonb,jsonb,uuid) from public, anon, authenticated;
grant execute on function public.record_market_draft_review(uuid,bigint,text,text,text,jsonb,jsonb,uuid) to service_role;

create or replace function public.restore_market_draft_review_memory(
  draft_id_input uuid, expected_version_input bigint, allow_precision_recovery_input boolean default true
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  actor_id uuid := private.require_current_admin();
  draft_row private.market_drafts%rowtype;
  candidate_row private.market_drafts%rowtype;
  issues jsonb;
  memory_report private.market_review_reports%rowtype;
  candidate_fingerprint text;
  recovered_precision boolean := false;
  next_version bigint;
begin
  select * into draft_row from private.market_drafts where id=draft_id_input for update;
  if not found then raise exception 'DRAFT_NOT_FOUND' using errcode='P0001'; end if;
  if expected_version_input is null or draft_row.content_version<>expected_version_input then
    raise exception 'DRAFT_VERSION_MOVED' using errcode='40001'; end if;
  if draft_row.workflow_status in ('published','early_closed','cancelled','pending_resolution','resolved','annulled') then
    raise exception 'PUBLISHED_MARKET_FIELDS_LOCKED' using errcode='22023'; end if;
  issues:=private.market_draft_deterministic_issues(draft_row);
  if jsonb_array_length(issues)>0 then return jsonb_build_object('restored',false,'reason','DETERMINISTIC_ISSUES_PRESENT','deterministic_issues',issues); end if;

  select * into memory_report from private.market_review_reports r
  where r.draft_id=draft_row.id and r.content_fingerprint=draft_row.content_fingerprint and r.result='approved'
  order by r.created_at desc limit 1;
  candidate_row:=draft_row; candidate_fingerprint:=draft_row.content_fingerprint;
  if memory_report.id is null and allow_precision_recovery_input then
    if draft_row.evaluation_ends_at is not null and extract(second from draft_row.evaluation_ends_at)=0 then
      candidate_row.evaluation_ends_at:=draft_row.evaluation_ends_at+interval '59 seconds';
      candidate_row.closes_at:=candidate_row.evaluation_ends_at;
      candidate_fingerprint:=private.market_draft_fingerprint(candidate_row);
      select * into memory_report from private.market_review_reports r
      where r.draft_id=draft_row.id and r.content_fingerprint=candidate_fingerprint and r.result='approved'
      order by r.created_at desc limit 1;
      recovered_precision:=memory_report.id is not null;
    end if;
  end if;
  if memory_report.id is null then return jsonb_build_object('restored',false,'reason','NO_APPROVED_MEMORY_FOR_CURRENT_CONTENT'); end if;

  next_version:=draft_row.content_version+case when recovered_precision then 1 else 0 end;
  update private.market_drafts set evaluation_ends_at=candidate_row.evaluation_ends_at,
    closes_at=candidate_row.closes_at,content_version=next_version,content_fingerprint=candidate_fingerprint,
    workflow_status='review_approved',review_status='approved',reviewed_version=next_version,
    reviewed_fingerprint=candidate_fingerprint,human_confirmed_at=null,human_confirmed_by=null,
    updated_at=now(),updated_by=actor_id where id=draft_row.id returning * into draft_row;

  if recovered_precision then
    update private.market_source_bindings b set
      resolution_contract=jsonb_set(jsonb_set(jsonb_set(coalesce(b.resolution_contract,'{}'::jsonb),
        '{window_end}',to_jsonb(draft_row.evaluation_ends_at),true),
        '{evaluation_at}',to_jsonb(draft_row.evaluation_ends_at),true),
        '{timezone}',to_jsonb(draft_row.timezone),true),updated_at=now()
    where b.draft_id=draft_row.id and b.status<>'superseded';
  end if;

  insert into private.market_admin_audit(actor_id,action_code,draft_id,draft_version,detail)
  values(actor_id,case when recovered_precision then 'REVIEW_MEMORY_RESTORED_AFTER_DATETIME_PRECISION_LOSS'
    else 'REVIEW_MEMORY_RESTORED' end,draft_row.id,draft_row.content_version,
    jsonb_build_object('memory_report_id',memory_report.id,'memory_validator',memory_report.validator_version,
      'recovered_precision',recovered_precision,'content_fingerprint',candidate_fingerprint));
  return jsonb_build_object('restored',true,'review_status','approved','workflow_status','review_approved',
    'draft_version',draft_row.content_version,'content_fingerprint',candidate_fingerprint,
    'memory_report_id',memory_report.id,'memory_validator',memory_report.validator_version,
    'recovered_precision',recovered_precision,
    'message',case when recovered_precision then 'Atinara recuperó la aprobación y restauró los segundos perdidos por el formulario.'
      else 'Atinara recuperó una aprobación previa del mismo contenido.' end);
end;$$;

revoke all on function public.restore_market_draft_review_memory(uuid,bigint,boolean) from public, anon;
grant execute on function public.restore_market_draft_review_memory(uuid,bigint,boolean) to authenticated;

create or replace function public.get_admin_market_draft(draft_id_input uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare draft_row private.market_drafts%rowtype;
begin
  perform private.require_current_admin();
  select * into draft_row from private.market_drafts where id=draft_id_input;
  if not found then raise exception 'DRAFT_NOT_FOUND' using errcode='P0001'; end if;
  return jsonb_build_object(
    'draft',to_jsonb(draft_row)-'created_by'-'updated_by'-'human_confirmed_by',
    'deterministic_issues',private.market_draft_deterministic_issues(draft_row),
    'latest_review',(select to_jsonb(r)-'reviewed_by' from private.market_review_reports r
      where r.draft_id=draft_id_input and (draft_row.review_status<>'approved'
        or (r.result='approved' and r.content_fingerprint=draft_row.content_fingerprint))
      order by case when draft_row.review_status='approved' and r.result='approved' then 0 else 1 end,
        r.created_at desc limit 1),
    'review_memory',jsonb_build_object(
      'approved_for_current_fingerprint',exists(select 1 from private.market_review_reports r
        where r.draft_id=draft_id_input and r.content_fingerprint=draft_row.content_fingerprint and r.result='approved'),
      'last_approved_report_id',(select r.id from private.market_review_reports r
        where r.draft_id=draft_id_input and r.result='approved' order by r.created_at desc limit 1),
      'state_memory_count',(select count(*) from private.market_draft_state_memory m where m.draft_id=draft_id_input)),
    'audit',coalesce((select jsonb_agg(to_jsonb(a)-'actor_id' order by a.created_at desc)
      from (select * from private.market_admin_audit where draft_id=draft_id_input order by created_at desc limit 30) a),'[]'::jsonb));
end;$$;

revoke all on function public.get_admin_market_draft(uuid) from public, anon;
grant execute on function public.get_admin_market_draft(uuid) to authenticated;