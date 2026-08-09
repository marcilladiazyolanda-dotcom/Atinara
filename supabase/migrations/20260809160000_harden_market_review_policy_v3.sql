-- Corrector v3 · corte real de cachés y aprobaciones automáticas antiguas.
--
-- No publica, confirma ni modifica mercados, predicciones o economía. Las
-- confirmaciones humanas v2 ya materiales sobreviven únicamente mientras el
-- mismo review, versión y fingerprint continúen enlazados de forma exacta.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';

select pg_advisory_xact_lock(hashtextextended('atinara:market-review-policy-v3', 0));

insert into private.market_review_policy_compatibility(
  validator_version, policy_version, schema_version, reusable,
  compatibility_note, invalidated_at
) values
  (
    'atinara-market-gate-v3',
    'atinara-market-review-policy-v3',
    'atinara-market-draft-schema-v3',
    true,
    'Validador canónico v3: respuesta negativa con incidencias obligatorias y contrato métrico/temporal endurecido.',
    null
  ),
  (
    'step13.4-deterministic-v3',
    'atinara-market-review-policy-v3',
    'atinara-market-draft-schema-v3',
    true,
    'Puerta determinista v3 sobre el mismo payload canónico.',
    null
  )
on conflict (validator_version) do update set
  policy_version = excluded.policy_version,
  schema_version = excluded.schema_version,
  reusable = excluded.reusable,
  compatibility_note = excluded.compatibility_note,
  invalidated_at = null;

update private.market_review_policy_compatibility
set
  reusable = false,
  invalidated_at = coalesce(invalidated_at, now()),
  compatibility_note = case validator_version
    when 'atinara-market-gate-v2'
      then 'Invalidado para reutilización automática por el corte v3; solo se preserva una confirmación humana material ya enlazada.'
    when 'step13.4-deterministic-v2'
      then 'Invalidado por el corte determinista v3; nunca se reutiliza automáticamente.'
    else compatibility_note
  end
where validator_version in ('atinara-market-gate-v2', 'step13.4-deterministic-v2');

create or replace function private.record_market_draft_version(
  draft_input private.market_drafts,
  change_origin_input text,
  actor_id_input uuid,
  restored_from_version_id_input bigint default null,
  recovery_evidence_input jsonb default '{}'::jsonb
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $function$
declare
  version_id_value bigint;
begin
  insert into private.market_draft_versions(
    draft_id, content_version, source_payload, canonical_payload,
    content_fingerprint, fingerprint_version, policy_version, schema_version,
    change_origin, actor_id, restored_from_version_id, recovery_evidence
  ) values (
    draft_input.id,
    draft_input.content_version,
    private.market_draft_source_payload(draft_input),
    private.market_draft_canonical_payload(draft_input),
    private.market_draft_fingerprint(draft_input),
    'sha256-canonical-v2',
    'atinara-market-review-policy-v3',
    'atinara-market-draft-schema-v3',
    left(coalesce(nullif(trim(change_origin_input), ''), 'material_save'), 100),
    actor_id_input,
    restored_from_version_id_input,
    coalesce(recovery_evidence_input, '{}'::jsonb)
  )
  on conflict (draft_id, content_version) do nothing
  returning id into version_id_value;

  if version_id_value is null then
    select id into version_id_value
    from private.market_draft_versions
    where draft_id = draft_input.id and content_version = draft_input.content_version;
  end if;
  if version_id_value is null or exists (
    select 1
    from private.market_draft_versions existing_version
    where existing_version.id = version_id_value
      and (
        existing_version.content_fingerprint is distinct from private.market_draft_fingerprint(draft_input)
        or existing_version.canonical_payload is distinct from private.market_draft_canonical_payload(draft_input)
      )
  ) then
    raise exception 'MARKET_DRAFT_VERSION_CONFLICT' using errcode = '40001';
  end if;
  return version_id_value;
end;
$function$;

revoke all on function private.record_market_draft_version(private.market_drafts,text,uuid,bigint,jsonb)
  from public, anon, authenticated;

create or replace function private.market_current_effective_review_id(draft private.market_drafts)
returns bigint
language sql
stable
set search_path = ''
as $function$
  select review.id
  from private.market_effective_reviews review
  where review.id = draft.effective_review_id
    and review.draft_id = draft.id
    and review.draft_version = draft.content_version
    and review.content_fingerprint = private.market_draft_fingerprint(draft)
    and review.active
    and review.revoked_at is null
    and (
      (
        review.policy_version = 'atinara-market-review-policy-v3'
        and review.schema_version = 'atinara-market-draft-schema-v3'
        and exists (
          select 1
          from private.market_review_policy_compatibility compatibility
          where compatibility.validator_version = review.validator_version
            and compatibility.policy_version = review.policy_version
            and compatibility.schema_version = review.schema_version
            and compatibility.reusable
            and compatibility.invalidated_at is null
        )
      )
      or (
        review.validator_version in ('atinara-market-gate-v2', 'step13.4-deterministic-v2')
        and review.policy_version = 'atinara-market-review-policy-v2'
        and review.schema_version = 'atinara-market-draft-schema-v2'
        and draft.human_confirmed_at is not null
        and draft.human_confirmed_review_id = review.id
        and draft.human_confirmed_fingerprint = draft.content_fingerprint
        and review.id = draft.effective_review_id
        and review.content_fingerprint = draft.content_fingerprint
      )
    )
  limit 1;
$function$;

create or replace function private.market_reusable_effective_review_id(
  draft_id_input uuid,
  content_fingerprint_input text
)
returns bigint
language sql
stable
set search_path = ''
as $function$
  select review.id
  from private.market_effective_reviews review
  join private.market_drafts draft on draft.id = review.draft_id
  where review.draft_id = draft_id_input
    and review.content_fingerprint = content_fingerprint_input
    and review.revoked_at is null
    and (
      (
        review.policy_version = 'atinara-market-review-policy-v3'
        and review.schema_version = 'atinara-market-draft-schema-v3'
        and exists (
          select 1
          from private.market_review_policy_compatibility compatibility
          where compatibility.validator_version = review.validator_version
            and compatibility.policy_version = review.policy_version
            and compatibility.schema_version = review.schema_version
            and compatibility.reusable
            and compatibility.invalidated_at is null
        )
      )
      or (
        review.active
        and review.validator_version in ('atinara-market-gate-v2', 'step13.4-deterministic-v2')
        and review.policy_version = 'atinara-market-review-policy-v2'
        and review.schema_version = 'atinara-market-draft-schema-v2'
        and review.id = draft.effective_review_id
        and review.id = draft.human_confirmed_review_id
        and review.draft_version = draft.content_version
        and draft.human_confirmed_at is not null
        and draft.human_confirmed_fingerprint = draft.content_fingerprint
        and review.content_fingerprint = draft.content_fingerprint
        and content_fingerprint_input = draft.content_fingerprint
      )
    )
  order by
    case when review.policy_version = 'atinara-market-review-policy-v3' then 0 else 1 end,
    review.created_at desc,
    review.id desc
  limit 1;
$function$;

revoke all on function private.market_current_effective_review_id(private.market_drafts)
  from public, anon, authenticated;
revoke all on function private.market_reusable_effective_review_id(uuid,text)
  from public, anon, authenticated;

-- Se conserva la implementación v2 como detalle inaccesible y se instala una
-- puerta v3 delante de ella. Así no se duplica la transición de estados ni la
-- auditoría, pero ninguna llamada puede crear o reusar un intento v2.
alter function public.begin_market_draft_review_v2(uuid,bigint,uuid,text,text,text,boolean)
  rename to begin_market_draft_review_v2_policy_v2_legacy;

revoke all on function public.begin_market_draft_review_v2_policy_v2_legacy(uuid,bigint,uuid,text,text,text,boolean)
  from public, anon, authenticated, service_role;

create function public.begin_market_draft_review_v2(
  draft_id_input uuid,
  expected_version_input bigint,
  request_key_input uuid,
  validator_version_input text,
  policy_version_input text,
  schema_version_input text,
  force_review_input boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor_id_value uuid;
  draft_row private.market_drafts%rowtype;
  prior_attempt private.market_review_attempts%rowtype;
  response_value jsonb;
  attempt_id_value uuid;
  report_id_value bigint;
begin
  actor_id_value := private.require_current_admin();
  if validator_version_input is distinct from 'atinara-market-gate-v3'
     or policy_version_input is distinct from 'atinara-market-review-policy-v3'
     or schema_version_input is distinct from 'atinara-market-draft-schema-v3' then
    raise exception 'REVIEW_POLICY_OUTDATED' using errcode = '22023';
  end if;

  select * into prior_attempt
  from private.market_review_attempts
  where draft_id = draft_id_input and request_key = request_key_input;
  if prior_attempt.id is not null and (
    prior_attempt.validator_version not in ('atinara-market-gate-v3', 'step13.4-deterministic-v3')
    or prior_attempt.policy_version <> 'atinara-market-review-policy-v3'
    or prior_attempt.schema_version <> 'atinara-market-draft-schema-v3'
  ) then
    raise exception 'REVIEW_POLICY_OUTDATED' using errcode = '22023';
  end if;

  select * into draft_row
  from private.market_drafts
  where id = draft_id_input
  for update;
  if not found then raise exception 'DRAFT_NOT_FOUND' using errcode = 'P0001'; end if;
  if expected_version_input is null or draft_row.content_version <> expected_version_input then
    raise exception 'DRAFT_VERSION_MOVED' using errcode = '40001';
  end if;
  if draft_row.workflow_status in (
    'published', 'scheduled', 'cancelled', 'resolved', 'annulled',
    'early_closed', 'pending_resolution'
  ) then
    raise exception 'DRAFT_REVIEW_NOT_ALLOWED' using errcode = '22023';
  end if;

  -- Un review automático incompatible no puede ocupar el índice activo e
  -- impedir la futura aprobación v3. La excepción humana exacta no se toca.
  update private.market_effective_reviews review
  set
    active = false,
    superseded_at = coalesce(review.superseded_at, now())
  where review.draft_id = draft_row.id
    and review.active
    and review.revoked_at is null
    and not (
      review.id = draft_row.effective_review_id
      and
      review.policy_version = 'atinara-market-review-policy-v3'
      and review.schema_version = 'atinara-market-draft-schema-v3'
      and review.content_fingerprint = draft_row.content_fingerprint
      and review.draft_version = draft_row.content_version
      and exists (
        select 1
        from private.market_review_policy_compatibility compatibility
        where compatibility.validator_version = review.validator_version
          and compatibility.policy_version = review.policy_version
          and compatibility.schema_version = review.schema_version
          and compatibility.reusable
          and compatibility.invalidated_at is null
      )
    )
    and not (
      review.id = draft_row.effective_review_id
      and review.id = draft_row.human_confirmed_review_id
      and draft_row.human_confirmed_at is not null
      and draft_row.human_confirmed_fingerprint = draft_row.content_fingerprint
      and review.content_fingerprint = draft_row.content_fingerprint
      and review.draft_version = draft_row.content_version
      and review.validator_version in ('atinara-market-gate-v2', 'step13.4-deterministic-v2')
      and review.policy_version = 'atinara-market-review-policy-v2'
      and review.schema_version = 'atinara-market-draft-schema-v2'
    );

  if draft_row.effective_review_id is not null
     and private.market_current_effective_review_id(draft_row) is null then
    update private.market_drafts
    set
      effective_review_id = null,
      reviewed_version = null,
      reviewed_fingerprint = null,
      review_status = 'not_requested',
      workflow_status = case
        when workflow_status in ('review_approved', 'human_confirmed') then 'draft_ready'
        else workflow_status
      end,
      human_confirmed_at = null,
      human_confirmed_by = null,
      human_confirmed_fingerprint = null,
      human_confirmed_review_id = null,
      updated_at = now(),
      updated_by = actor_id_value
    where id = draft_row.id
    returning * into draft_row;
  end if;

  response_value := public.begin_market_draft_review_v2_policy_v2_legacy(
    draft_id_input,
    expected_version_input,
    request_key_input,
    validator_version_input,
    policy_version_input,
    schema_version_input,
    force_review_input
  );

  attempt_id_value := nullif(response_value ->> 'attempt_id', '')::uuid;
  if prior_attempt.id is null and attempt_id_value is not null
     and response_value ->> 'status' = 'rejected' then
    update private.market_review_attempts
    set
      validator_version = 'step13.4-deterministic-v3',
      policy_version = 'atinara-market-review-policy-v3',
      schema_version = 'atinara-market-draft-schema-v3'
    where id = attempt_id_value
      and validator_version = 'step13.4-deterministic-v2'
    returning report_id into report_id_value;

    if report_id_value is not null then
      update private.market_review_reports
      set
        validator_version = 'step13.4-deterministic-v3',
        policy_version = 'atinara-market-review-policy-v3',
        schema_version = 'atinara-market-draft-schema-v3'
      where id = report_id_value
        and validator_version = 'step13.4-deterministic-v2';
    end if;
  end if;

  return response_value;
end;
$function$;

revoke all on function public.begin_market_draft_review_v2(uuid,bigint,uuid,text,text,text,boolean)
  from public, anon, service_role;
grant execute on function public.begin_market_draft_review_v2(uuid,bigint,uuid,text,text,text,boolean)
  to authenticated;

alter function public.record_market_draft_review_v2(uuid,text,jsonb,jsonb,uuid,text,jsonb)
  rename to record_market_draft_review_v2_policy_v2_legacy;

revoke all on function public.record_market_draft_review_v2_policy_v2_legacy(uuid,text,jsonb,jsonb,uuid,text,jsonb)
  from public, anon, authenticated, service_role;

create function public.record_market_draft_review_v2(
  attempt_id_input uuid,
  result_input text,
  semantic_issues_input jsonb,
  editorial_notes_input jsonb,
  reviewed_by_input uuid,
  technical_code_input text default null,
  safe_provider_metadata_input jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  attempt_row private.market_review_attempts%rowtype;
  normalized_result text := lower(trim(coalesce(result_input, '')));
begin
  select * into attempt_row
  from private.market_review_attempts
  where id = attempt_id_input;
  if not found then raise exception 'REVIEW_ATTEMPT_NOT_FOUND' using errcode = 'P0001'; end if;
  if attempt_row.validator_version <> 'atinara-market-gate-v3'
     or attempt_row.policy_version <> 'atinara-market-review-policy-v3'
     or attempt_row.schema_version <> 'atinara-market-draft-schema-v3' then
    raise exception 'REVIEW_POLICY_OUTDATED' using errcode = '22023';
  end if;

  if normalized_result in ('rejected', 'inconclusive')
     and jsonb_typeof(coalesce(semantic_issues_input, '[]'::jsonb)) = 'array'
     and jsonb_array_length(coalesce(semantic_issues_input, '[]'::jsonb)) = 0 then
    raise exception 'REVIEW_CONTENT_ISSUES_REQUIRED' using errcode = '22023';
  end if;

  return public.record_market_draft_review_v2_policy_v2_legacy(
    attempt_id_input,
    result_input,
    semantic_issues_input,
    editorial_notes_input,
    reviewed_by_input,
    technical_code_input,
    safe_provider_metadata_input
  );
end;
$function$;

revoke all on function public.record_market_draft_review_v2(uuid,text,jsonb,jsonb,uuid,text,jsonb)
  from public, anon, authenticated;
grant execute on function public.record_market_draft_review_v2(uuid,text,jsonb,jsonb,uuid,text,jsonb)
  to service_role;

comment on function private.market_current_effective_review_id(private.market_drafts) is
  'Puerta v3. Solo admite aprobaciones v3 reutilizables o la confirmación humana v2 material ya enlazada con versión y huella exactas.';
comment on function private.market_reusable_effective_review_id(uuid,text) is
  'Memoria v3. Los reviews v2 automáticos no se reutilizan; una confirmación humana v2 solo se devuelve mientras siga siendo el enlace actual exacto.';
comment on function public.record_market_draft_review_v2(uuid,text,jsonb,jsonb,uuid,text,jsonb) is
  'Registro v3 fail-closed: un rechazo o resultado inconcluso sin incidencias semánticas es una respuesta inválida.';

commit;
