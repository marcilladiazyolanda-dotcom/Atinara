-- Atinara · cierre del ciclo de agentes, confirmación humana y autoridad de fuentes v8.
-- Esta migración es aditiva y no modifica mercados, predicciones, Karma, Prestigio,
-- estados LMSR, precios ni liquidaciones.

create table if not exists private.market_draft_eligibility_bindings (
  id bigint generated always as identity primary key,
  attempt_id uuid not null unique,
  draft_id uuid not null references private.market_drafts(id) on delete restrict,
  draft_version bigint not null check (draft_version >= 1),
  draft_fingerprint text not null check (draft_fingerprint ~ '^[0-9a-f]{64}$'),
  candidate_id uuid not null references private.external_market_candidates(id) on delete restrict,
  preparation_revision bigint not null check (preparation_revision >= 1),
  eligibility_check_id bigint not null references private.market_radar_eligibility_checks(id) on delete restrict,
  eligibility_decision_hash text not null check (eligibility_decision_hash ~ '^[0-9a-f]{64}$'),
  policy_version text not null check (policy_version = 'atinara-prediction-policy-v5'),
  bound_by uuid not null references auth.users(id) on delete restrict,
  bound_at timestamptz not null default now(),
  constraint market_draft_eligibility_bindings_exact_unique unique (
    draft_id, draft_version, draft_fingerprint, candidate_id,
    preparation_revision, eligibility_check_id, eligibility_decision_hash
  )
);

create index if not exists market_draft_eligibility_bindings_draft_idx
  on private.market_draft_eligibility_bindings(draft_id, draft_version desc, id desc);
create index if not exists market_draft_eligibility_bindings_candidate_idx
  on private.market_draft_eligibility_bindings(candidate_id, preparation_revision desc, id desc);
create index if not exists market_draft_eligibility_bindings_check_idx
  on private.market_draft_eligibility_bindings(eligibility_check_id);
create index if not exists market_draft_eligibility_bindings_actor_idx
  on private.market_draft_eligibility_bindings(bound_by);

alter table private.market_draft_eligibility_bindings enable row level security;
alter table private.market_draft_eligibility_bindings force row level security;
revoke all privileges on table private.market_draft_eligibility_bindings
  from public, anon, authenticated, service_role;
revoke all privileges on sequence private.market_draft_eligibility_bindings_id_seq
  from public, anon, authenticated, service_role;

drop trigger if exists reject_market_draft_eligibility_binding_mutation
  on private.market_draft_eligibility_bindings;
create trigger reject_market_draft_eligibility_binding_mutation
before update or delete on private.market_draft_eligibility_bindings
for each row execute function private.reject_market_radar_eligibility_check_mutation();

-- La comparación de familias necesita conocer la procedencia del borrador para
-- no considerar a una candidata duplicada de su propio borrador preparado.
create or replace function public.get_admin_market_family_definitions()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  result_value jsonb;
begin
  perform private.require_current_admin();
  select coalesce(jsonb_agg(definition_value), '[]'::jsonb) into result_value
  from (
    select jsonb_build_object(
      'id', market_alias.id, 'kind', 'market', 'question', market_alias.question,
      'radar_candidate_id', null,
      'family_key', market_alias.family_key, 'family_title', market_alias.family_title,
      'family_type', market_alias.family_type, 'family_child_key', market_alias.family_child_key,
      'family_child_label', market_alias.family_child_label, 'family_sort_at', market_alias.family_sort_at,
      'family_relationship', market_alias.family_relationship, 'family_semantics', market_alias.family_semantics,
      'family_version', market_alias.family_version
    ) definition_value
    from public.markets market_alias
    union all
    select jsonb_build_object(
      'id', draft_alias.id, 'kind', 'draft', 'question', draft_alias.question,
      'radar_candidate_id', draft_alias.radar_candidate_id,
      'family_key', draft_alias.family_key, 'family_title', draft_alias.family_title,
      'family_type', draft_alias.family_type, 'family_child_key', draft_alias.family_child_key,
      'family_child_label', draft_alias.family_child_label, 'family_sort_at', draft_alias.family_sort_at,
      'family_relationship', draft_alias.family_relationship, 'family_semantics', draft_alias.family_semantics,
      'family_version', draft_alias.family_version
    )
    from private.market_drafts draft_alias
    where draft_alias.market_id is null
      and draft_alias.workflow_status not in ('cancelled', 'annulled')
  ) definitions;
  return result_value;
end;
$function$;

revoke all on function public.get_admin_market_family_definitions()
  from public, anon, authenticated, service_role;
grant execute on function public.get_admin_market_family_definitions()
  to authenticated;

-- El servicio solo puede revalidar una candidata dentro de la versión y huella
-- exactas del borrador privado que declara el cliente administrativo.
create or replace function public.get_market_radar_candidate_for_draft_revalidation_v2(
  candidate_id_input uuid,
  draft_id_input uuid,
  expected_version_input bigint,
  expected_fingerprint_input text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  draft_row private.market_drafts%rowtype;
  candidate private.external_market_candidates%rowtype;
begin
  if auth.role() <> 'service_role' then
    raise exception 'SERVICE_ROLE_REQUIRED' using errcode = '42501';
  end if;
  if expected_version_input is null or expected_version_input < 1
     or coalesce(expected_fingerprint_input, '') !~ '^[0-9a-f]{64}$' then
    raise exception 'INVALID_DRAFT_ELIGIBILITY_SCOPE' using errcode = '22023';
  end if;
  select * into draft_row
  from private.market_drafts draft_alias
  where draft_alias.id = draft_id_input
  for share;
  if not found then raise exception 'DRAFT_NOT_FOUND' using errcode = 'P0001'; end if;
  if draft_row.content_version is distinct from expected_version_input
     or lower(coalesce(draft_row.content_fingerprint, '')) is distinct from lower(expected_fingerprint_input) then
    raise exception 'DRAFT_VERSION_MOVED' using errcode = '40001';
  end if;
  if draft_row.radar_candidate_id is distinct from candidate_id_input
     or draft_row.market_id is not null
     or draft_row.workflow_status in ('cancelled', 'annulled', 'published') then
    raise exception 'RADAR_DRAFT_SCOPE_MISMATCH' using errcode = '55000';
  end if;
  select * into candidate
  from private.external_market_candidates candidate_alias
  where candidate_alias.id = candidate_id_input
  for share;
  if not found then raise exception 'RADAR_CANDIDATE_NOT_FOUND' using errcode = 'P0001'; end if;
  if candidate.prepared_draft_id is distinct from draft_row.id then
    raise exception 'RADAR_DRAFT_SCOPE_MISMATCH' using errcode = '55000';
  end if;
  return private.market_radar_eligibility_payload(candidate);
end;
$function$;

revoke all on function public.get_market_radar_candidate_for_draft_revalidation_v2(uuid,uuid,bigint,text)
  from public, anon, authenticated, service_role;
grant execute on function public.get_market_radar_candidate_for_draft_revalidation_v2(uuid,uuid,bigint,text)
  to service_role;

create or replace function public.bind_market_radar_draft_eligibility_v2(
  candidate_id_input uuid,
  draft_id_input uuid,
  expected_version_input bigint,
  expected_fingerprint_input text,
  expected_preparation_revision_input bigint,
  eligibility_check_id_input bigint,
  actor_id_input uuid,
  attempt_id_input uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  draft_row private.market_drafts%rowtype;
  candidate private.external_market_candidates%rowtype;
  eligibility private.market_radar_eligibility_checks%rowtype;
  binding_row private.market_draft_eligibility_bindings%rowtype;
  inserted_now boolean := false;
begin
  if auth.role() <> 'service_role' then
    raise exception 'SERVICE_ROLE_REQUIRED' using errcode = '42501';
  end if;
  if actor_id_input is null or not exists (
    select 1 from auth.users user_row
    where user_row.id = actor_id_input
      and coalesce((user_row.raw_app_meta_data ->> 'oraklo_admin')::boolean, false)
  ) then
    raise exception 'ADMIN_REQUIRED' using errcode = '42501';
  end if;
  if attempt_id_input is null
     or expected_preparation_revision_input is null or expected_preparation_revision_input < 1
     or eligibility_check_id_input is null
     or coalesce(expected_fingerprint_input, '') !~ '^[0-9a-f]{64}$' then
    raise exception 'INVALID_DRAFT_ELIGIBILITY_BINDING' using errcode = '22023';
  end if;
  -- Serializa únicamente reintentos de la misma clave. Evita que dos dobles
  -- clics simultáneos compitan por attempt_id sin bloquear otras candidatas.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(attempt_id_input::text, 0)
  );

  select * into draft_row
  from private.market_drafts draft_alias
  where draft_alias.id = draft_id_input
  for share;
  if not found then raise exception 'DRAFT_NOT_FOUND' using errcode = 'P0001'; end if;
  if draft_row.content_version is distinct from expected_version_input
     or lower(coalesce(draft_row.content_fingerprint, '')) is distinct from lower(expected_fingerprint_input)
     or draft_row.radar_candidate_id is distinct from candidate_id_input
     or draft_row.market_id is not null then
    raise exception 'DRAFT_VERSION_MOVED' using errcode = '40001';
  end if;

  candidate := private.assert_market_radar_candidate_eligible_v1(
    candidate_id_input, expected_preparation_revision_input
  );
  if candidate.prepared_draft_id is distinct from draft_row.id
     or candidate.current_eligibility_check_id is distinct from eligibility_check_id_input then
    raise exception 'RADAR_DRAFT_SCOPE_MISMATCH' using errcode = '55000';
  end if;
  select * into eligibility
  from private.market_radar_eligibility_checks check_alias
  where check_alias.id = eligibility_check_id_input
  for share;
  if not found
     or eligibility.candidate_id is distinct from candidate.id
     or eligibility.status is distinct from 'eligible'
     or eligibility.policy_version is distinct from 'atinara-prediction-policy-v5'
     or eligibility.expires_at <= clock_timestamp()
     or eligibility.decision_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'RADAR_ELIGIBILITY_REQUIRED' using errcode = '55000';
  end if;

  select * into binding_row
  from private.market_draft_eligibility_bindings binding_alias
  where binding_alias.attempt_id = attempt_id_input;
  if found then
    if binding_row.draft_id is distinct from draft_row.id
       or binding_row.draft_version is distinct from draft_row.content_version
       or binding_row.draft_fingerprint is distinct from lower(draft_row.content_fingerprint)
       or binding_row.candidate_id is distinct from candidate.id
       or binding_row.preparation_revision is distinct from candidate.preparation_revision
       or binding_row.eligibility_check_id is distinct from eligibility.id
       or binding_row.eligibility_decision_hash is distinct from eligibility.decision_hash then
      raise exception 'IDEMPOTENCY_KEY_REUSED' using errcode = '23505';
    end if;
  else
    insert into private.market_draft_eligibility_bindings(
      attempt_id, draft_id, draft_version, draft_fingerprint, candidate_id,
      preparation_revision, eligibility_check_id, eligibility_decision_hash,
      policy_version, bound_by
    ) values (
      attempt_id_input, draft_row.id, draft_row.content_version,
      lower(draft_row.content_fingerprint), candidate.id, candidate.preparation_revision,
      eligibility.id, eligibility.decision_hash, eligibility.policy_version, actor_id_input
    )
    on conflict on constraint market_draft_eligibility_bindings_exact_unique do nothing
    returning * into binding_row;
    inserted_now := found;
    if not found then
      select * into binding_row
      from private.market_draft_eligibility_bindings binding_alias
      where binding_alias.draft_id = draft_row.id
        and binding_alias.draft_version = draft_row.content_version
        and binding_alias.draft_fingerprint = lower(draft_row.content_fingerprint)
        and binding_alias.candidate_id = candidate.id
        and binding_alias.preparation_revision = candidate.preparation_revision
        and binding_alias.eligibility_check_id = eligibility.id
        and binding_alias.eligibility_decision_hash = eligibility.decision_hash
      order by binding_alias.id desc
      limit 1;
    end if;
  end if;

  if inserted_now then
    insert into private.market_admin_audit(actor_id, action_code, draft_id, draft_version, detail)
    values (
      actor_id_input, 'RADAR_DRAFT_ELIGIBILITY_BOUND', draft_row.id, draft_row.content_version,
      jsonb_build_object(
        'candidate_id', candidate.id,
        'preparation_revision', candidate.preparation_revision,
        'eligibility_check_id', eligibility.id,
        'eligibility_decision_hash', eligibility.decision_hash,
        'binding_id', binding_row.id
      )
    );
  end if;
  return jsonb_build_object(
    'binding_id', binding_row.id,
    'draft_id', binding_row.draft_id,
    'draft_version', binding_row.draft_version,
    'draft_fingerprint', binding_row.draft_fingerprint,
    'candidate_id', binding_row.candidate_id,
    'preparation_revision', binding_row.preparation_revision,
    'eligibility_check_id', binding_row.eligibility_check_id,
    'bound_at', binding_row.bound_at,
    'changed', inserted_now,
    'idempotency_replay', not inserted_now
  );
end;
$function$;

revoke all on function public.bind_market_radar_draft_eligibility_v2(uuid,uuid,bigint,text,bigint,bigint,uuid,uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.bind_market_radar_draft_eligibility_v2(uuid,uuid,bigint,text,bigint,bigint,uuid,uuid)
  to service_role;

-- Una autoridad futura de resolución es válida si el proveedor la declaró en
-- su contrato, el endpoint oficial respondió y el dominio conserva rol PRIMARY.
-- No se convierte jamás en evidencia terminal: direct_claim debe ser false.
create or replace function private.market_radar_candidate_resolution_source_ready_v1(
  candidate_input private.external_market_candidates
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select coalesce(candidate_input.normalized_payload ->> 'atinara_resolution_source_url', '') <> ''
    and exists (
      select 1
      from jsonb_array_elements(coalesce(candidate_input.eligibility_evidence, '[]'::jsonb)) evidence_item
      where evidence_item ->> 'url' = candidate_input.normalized_payload ->> 'atinara_resolution_source_url'
        and evidence_item ->> 'source_type' = 'official'
        and coalesce(evidence_item ->> 'content_sha256', '') ~ '^[0-9a-f]{64}$'
        and (
          (
            evidence_item ->> 'retrieval_status' = 'verified_content'
            and evidence_item ->> 'evidence_basis' = 'retrieved_content'
            and evidence_item ->> 'parser_version' = 'atinara-official-content-v1'
            and evidence_item ->> 'claim_status' = 'direct'
            and coalesce((evidence_item ->> 'direct_claim')::boolean, false)
            and coalesce((evidence_item ->> 'claim_verifiable')::boolean, false)
          )
          or
          (
            evidence_item ->> 'retrieval_status' = 'verified_authority_endpoint'
            and evidence_item ->> 'evidence_basis' = 'provider_resolution_contract'
            and evidence_item ->> 'parser_version' = 'atinara-resolution-authority-v2'
            and evidence_item ->> 'claim_status' = 'resolution_authority'
            and not coalesce((evidence_item ->> 'direct_claim')::boolean, true)
            and coalesce((evidence_item ->> 'claim_verifiable')::boolean, false)
            and evidence_item ->> 'authority_role' = 'PRIMARY_RESOLUTION'
            and coalesce((evidence_item ->> 'resolution_contract_specific')::boolean, false)
            and evidence_item ->> 'contract_policy_version' = 'atinara-resolution-authority-v2'
            and evidence_item ->> 'provider' = candidate_input.provider
            and evidence_item ->> 'adapter_version' = candidate_input.normalizer_version
            and evidence_item ->> 'contract_url' = candidate_input.normalized_payload #>> '{source_resolution_provenance,source_url}'
            and evidence_item ->> 'provider_contract_field' = candidate_input.normalized_payload #>> '{source_resolution_provenance,upstream_field}'
            and candidate_input.normalized_payload #>> '{source_resolution_provenance,provider}' = candidate_input.provider
            and candidate_input.normalized_payload #>> '{source_resolution_provenance,adapter_version}' = candidate_input.normalizer_version
            and coalesce((candidate_input.normalized_payload #>> '{source_resolution_provenance,declared_by_provider}')::boolean, false)
          )
        )
    )
    and exists (
      select 1
      from private.market_source_registry registry
      where private.market_primary_registry_row_matches_v1(
        registry,
        candidate_input.normalized_payload ->> 'atinara_resolution_source_url',
        candidate_input.normalized_payload ->> 'atinara_category'
      )
    );
$function$;

revoke all on function private.market_radar_candidate_resolution_source_ready_v1(private.external_market_candidates)
  from public, anon, authenticated, service_role;

-- Los estados terminales siguen bloqueando la elegibilidad, pero no destruyen
-- la identidad de ciclo de una candidata que ya materializó un borrador privado.
create or replace function private.enforce_market_radar_eligibility_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  payload jsonb := coalesce(new.normalized_payload, '{}'::jsonb);
  payload_status text := nullif(payload ->> 'eligibility_status', '');
  payload_checked_at timestamptz;
  payload_expires_at timestamptz;
begin
  if payload_status is not null then
    begin
      payload_checked_at := nullif(payload ->> 'eligibility_checked_at', '')::timestamptz;
      payload_expires_at := nullif(payload ->> 'eligibility_expires_at', '')::timestamptz;
    exception when invalid_text_representation or datetime_field_overflow then
      raise exception 'INVALID_RADAR_ELIGIBILITY_DATE' using errcode = '22007';
    end;
    if payload ->> 'eligibility_policy_version' is distinct from 'atinara-prediction-policy-v5'
       or payload_status not in ('eligible', 'terminal', 'inactive_option', 'technical_hold', 'invalid', 'duplicate')
       or payload_checked_at is null or payload_expires_at is null
       or payload_expires_at <= payload_checked_at
       or jsonb_typeof(coalesce(payload -> 'eligibility_evidence', '[]'::jsonb)) <> 'array'
       or jsonb_array_length(coalesce(payload -> 'eligibility_evidence', '[]'::jsonb)) > 12 then
      raise exception 'INVALID_RADAR_ELIGIBILITY' using errcode = '22023';
    end if;
    new.eligibility_status := payload_status;
    new.eligibility_reason_code := nullif(left(payload ->> 'eligibility_reason_code', 100), '');
    new.eligibility_reason := nullif(left(payload ->> 'eligibility_reason', 1000), '');
    new.eligibility_checked_at := payload_checked_at;
    new.eligibility_expires_at := payload_expires_at;
    new.eligibility_policy_version := 'atinara-prediction-policy-v5';
    new.eligibility_evidence := coalesce(payload -> 'eligibility_evidence', '[]'::jsonb);
  end if;
  if new.eligibility_policy_version = 'atinara-prediction-policy-v5' then
    if new.eligibility_status = 'eligible' then
      new.verification_status := 'verified_open';
      new.quality_status := 'fit';
      if new.state not in ('prepared', 'dismissed') then new.state := 'available'; end if;
      new.verification_reason_code := null;
    elsif new.eligibility_status = 'terminal' then
      new.verification_status := 'rejected_resolved';
      new.quality_status := 'rejected';
      if new.state not in ('prepared', 'dismissed') then new.state := 'rejected'; end if;
      new.verification_reason_code := coalesce(new.eligibility_reason_code, 'EVENT_ALREADY_RESOLVED');
    elsif new.eligibility_status = 'duplicate' then
      new.verification_status := 'rejected_duplicate';
      new.quality_status := 'rejected';
      if new.state not in ('prepared', 'dismissed') then new.state := 'rejected'; end if;
      new.verification_reason_code := 'DUPLICATE_MARKET';
    elsif new.eligibility_status = 'invalid' then
      new.verification_status := 'rejected_invalid_source';
      new.quality_status := 'rejected';
      if new.state not in ('prepared', 'dismissed') then new.state := 'rejected'; end if;
    else
      new.verification_status := 'rejected_ineligible';
      new.quality_status := 'rejected';
      if new.state not in ('prepared', 'dismissed') then new.state := 'rejected'; end if;
    end if;
    new.verification_reason := new.eligibility_reason;
    new.verified_at := new.eligibility_checked_at;
    new.verification_expires_at := new.eligibility_expires_at;
    new.verification_evidence := new.eligibility_evidence;
    new.fact_status := null;
    new.fact_policy_version := null;
    new.fact_context_fingerprint := null;
    new.fact_checked_at := null;
    new.fact_check_expires_at := null;
    new.fact_check_purpose := null;
    new.current_fact_check_id := null;
  end if;
  return new;
end;
$function$;

revoke all on function private.enforce_market_radar_eligibility_v1()
  from public, anon, authenticated, service_role;

-- Reparación general de expedientes cuyo único “duplicado” era su propio
-- borrador. No declara elegibilidad: los deja en espera técnica para revalidar.
with targets as (
  select candidate.*
  from private.external_market_candidates candidate
  join private.market_drafts draft_row
    on draft_row.id = candidate.prepared_draft_id
   and draft_row.radar_candidate_id = candidate.id
  where candidate.state = 'rejected'
    and candidate.verification_status = 'rejected_duplicate'
    and not exists (
      select 1
      from jsonb_array_elements(coalesce(candidate.duplicate_matches, '[]'::jsonb)) match_item
      where coalesce(match_item ->> 'blocking', 'true') <> 'false'
        and match_item ->> 'relationship' in ('exact_duplicate', 'semantic_duplicate')
        and coalesce(match_item ->> 'id', '') <> candidate.prepared_draft_id::text
    )
), inserted as (
  insert into private.market_radar_eligibility_checks(
    attempt_id, candidate_id, provider, external_id, event_group_key,
    policy_version, status, reason_code, reason, evidence,
    checked_at, expires_at, decision_hash
  )
  select gen_random_uuid(), target.id, target.provider, target.external_id, target.event_group_key,
    'atinara-prediction-policy-v5', 'technical_hold', 'SELF_LINEAGE_REVALIDATION_REQUIRED',
    'El borrador propio fue excluido de duplicados. La candidata debe revalidarse antes de publicar.',
    jsonb_build_array(jsonb_build_object(
      'evidence_type', 'self_lineage_repair',
      'prepared_draft_id', target.prepared_draft_id,
      'self_draft_excluded', true
    )), now(), now() + interval '5 minutes',
    encode(extensions.digest(target.id::text || '|' || target.preparation_revision::text || '|SELF_LINEAGE_REVALIDATION_REQUIRED|' || now()::text, 'sha256'), 'hex')
  from targets target
  returning *
)
update private.external_market_candidates candidate set
  normalized_payload = candidate.normalized_payload || jsonb_build_object(
    'eligibility_status', inserted.status,
    'eligibility_reason_code', inserted.reason_code,
    'eligibility_reason', inserted.reason,
    'eligibility_evidence', inserted.evidence,
    'eligibility_checked_at', inserted.checked_at,
    'eligibility_expires_at', inserted.expires_at,
    'eligibility_policy_version', inserted.policy_version
  ),
  current_eligibility_check_id = inserted.id,
  eligibility_status = inserted.status,
  eligibility_reason_code = inserted.reason_code,
  eligibility_reason = inserted.reason,
  eligibility_evidence = inserted.evidence,
  eligibility_checked_at = inserted.checked_at,
  eligibility_expires_at = inserted.expires_at,
  eligibility_policy_version = inserted.policy_version,
  duplicate_matches = '[]'::jsonb,
  state = 'prepared',
  updated_at = now()
from inserted
where candidate.id = inserted.candidate_id;

-- La publicación exige una atestación exacta y vigente ligada a borrador,
-- versión, huella, revisión de preparación y check actual. Se elimina el TOCTOU
-- que permitía validar R/A y publicar después de un refresh R+1/B.
create or replace function private.assert_market_radar_draft_eligibility_v1(
  draft_input private.market_drafts,
  checked_at_input timestamptz default clock_timestamp()
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  candidate private.external_market_candidates%rowtype;
  eligibility private.market_radar_eligibility_checks%rowtype;
  binding_row private.market_draft_eligibility_bindings%rowtype;
begin
  if draft_input.radar_candidate_id is null
     and not (coalesce(draft_input.source_provenance, '{}'::jsonb) ? 'radar_candidate_id') then
    return;
  end if;
  if draft_input.radar_candidate_id is null
     or checked_at_input is null
     or checked_at_input > clock_timestamp() + interval '1 minute'
     or coalesce(draft_input.content_fingerprint, '') !~ '^[0-9a-f]{64}$' then
    raise exception 'RADAR_DRAFT_ELIGIBILITY_PROVENANCE_REQUIRED' using errcode = '55000';
  end if;
  select * into candidate
  from private.external_market_candidates candidate_alias
  where candidate_alias.id = draft_input.radar_candidate_id
  for share;
  if not found then raise exception 'RADAR_ELIGIBILITY_REQUIRED' using errcode = '55000'; end if;
  candidate := private.assert_market_radar_candidate_eligible_v1(
    candidate.id, candidate.preparation_revision
  );
  select * into eligibility
  from private.market_radar_eligibility_checks check_alias
  where check_alias.id = candidate.current_eligibility_check_id;
  select * into binding_row
  from private.market_draft_eligibility_bindings binding_alias
  where binding_alias.draft_id = draft_input.id
    and binding_alias.draft_version = draft_input.content_version
    and binding_alias.draft_fingerprint = lower(draft_input.content_fingerprint)
    and binding_alias.candidate_id = candidate.id
    and binding_alias.preparation_revision = candidate.preparation_revision
    and binding_alias.eligibility_check_id = candidate.current_eligibility_check_id
    and binding_alias.eligibility_decision_hash = eligibility.decision_hash
    and binding_alias.policy_version = eligibility.policy_version
  order by binding_alias.id desc
  limit 1;
  if not found then
    raise exception 'RADAR_DRAFT_ELIGIBILITY_BINDING_REQUIRED' using errcode = '55000';
  end if;
end;
$function$;

revoke all on function private.assert_market_radar_draft_eligibility_v1(private.market_drafts,timestamptz)
  from public, anon, authenticated, service_role;

create or replace function private.assert_market_source_binding_ready_v1(draft_id_input uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  draft_row private.market_drafts%rowtype;
  binding_row private.market_source_bindings%rowtype;
  provenance_state jsonb;
begin
  select * into draft_row from private.market_drafts where id = draft_id_input;
  if not found then raise exception 'DRAFT_NOT_FOUND' using errcode = 'P0001'; end if;
  select * into binding_row
  from private.market_source_bindings
  where draft_id = draft_id_input and status <> 'superseded'
  order by plan_version desc, created_at desc
  limit 1;
  if draft_row.intelligence_origin_type is null and not found then return; end if;
  if not found then raise exception 'SOURCE_BINDING_REQUIRED' using errcode = '22023'; end if;
  if binding_row.contract_hash is null or binding_row.locked_at is null or binding_row.locked_by is null then
    raise exception 'RESOLUTION_PLAN_NOT_LOCKED' using errcode = '22023';
  end if;
  if binding_row.status not in ('validated', 'armed') then
    raise exception 'SOURCE_CONTRACT_NOT_LOCKED' using errcode = '22023';
  end if;
  if not coalesce((binding_row.validation ->> 'valid')::boolean, false) then
    raise exception 'SOURCE_BINDING_VALIDATION_REQUIRED'
      using errcode = '22023', detail = coalesce(binding_row.validation, '{}'::jsonb)::text;
  end if;
  if binding_row.contract_hash is distinct from private.market_intelligence_hash(binding_row.resolution_contract) then
    raise exception 'SOURCE_BINDING_CONTRACT_CHANGED' using errcode = '55000';
  end if;
  if binding_row.monitor_required
     and (binding_row.status <> 'armed' or binding_row.monitor_readiness <> 'armed') then
    raise exception 'SOURCE_MONITOR_NOT_ARMED' using errcode = '22023';
  end if;
  if binding_row.monitor_required and not coalesce((
    select enabled from private.market_intelligence_runtime_settings
    where setting_key = 'source_monitor_scheduler_enabled'
  ), false) then
    raise exception 'SOURCE_SCHEDULER_NOT_ENABLED' using errcode = '22023';
  end if;
  provenance_state := private.market_source_binding_provenance(binding_row.id);
  if not coalesce((provenance_state ->> 'valid')::boolean, false) then
    if provenance_state ->> 'mode' = 'completed_expert_run'
       and provenance_state -> 'issues' @> '["MARKET_EXPERT_ANALYSIS_REQUIRED"]'::jsonb then
      raise exception 'MARKET_EXPERT_ANALYSIS_REQUIRED'
        using errcode = '22023', detail = (provenance_state -> 'issues')::text;
    end if;
    raise exception 'SOURCE_BINDING_PROVENANCE_REQUIRED'
      using errcode = '22023', detail = (provenance_state -> 'issues')::text;
  end if;
end;
$function$;

revoke all on function private.assert_market_source_binding_ready_v1(uuid)
  from public, anon, authenticated, service_role;

create or replace function private.ensure_market_source_confirmation_ready_v1(draft_id_input uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  draft_row private.market_drafts%rowtype;
  binding_state jsonb;
  binding_id_value uuid;
  binding_row private.market_source_bindings%rowtype;
  verification_result jsonb;
begin
  select * into draft_row from private.market_drafts where id = draft_id_input;
  if not found then raise exception 'DRAFT_NOT_FOUND' using errcode = 'P0001'; end if;
  binding_state := private.market_binding_compatibility(draft_id_input);
  if not coalesce((binding_state ->> 'compatible')::boolean, false) then
    raise exception 'CURRENT_BINDING_COMPATIBILITY_REQUIRED'
      using errcode = '22023', detail = coalesce(binding_state -> 'reasons', '[]'::jsonb)::text;
  end if;
  if not coalesce((binding_state ->> 'required')::boolean, false) then
    return binding_state || jsonb_build_object(
      'confirmation_ready', true, 'auto_validated', false,
      'message', 'Este borrador no requiere un Plan de Resolución vinculado.'
    );
  end if;
  binding_id_value := nullif(binding_state ->> 'binding_id', '')::uuid;
  if binding_id_value is null then raise exception 'SOURCE_BINDING_REQUIRED' using errcode = '22023'; end if;
  select * into binding_row
  from private.market_source_bindings
  where id = binding_id_value
  for update;
  if not found then raise exception 'SOURCE_BINDING_NOT_FOUND' using errcode = 'P0001'; end if;
  if binding_row.status = 'draft' or binding_row.contract_hash is null or binding_row.locked_at is null then
    verification_result := public.verify_market_source_binding(binding_id_value);
    select * into binding_row from private.market_source_bindings where id = binding_id_value;
  end if;
  perform private.assert_market_source_binding_ready_v1(draft_id_input);
  return private.market_binding_compatibility(draft_id_input) || jsonb_build_object(
    'confirmation_ready', true,
    'auto_validated', verification_result is not null,
    'binding_status', binding_row.status,
    'locked_at', binding_row.locked_at,
    'contract_hash', binding_row.contract_hash
  );
end;
$function$;

revoke all on function private.ensure_market_source_confirmation_ready_v1(uuid)
  from public, anon, authenticated, service_role;

create or replace function private.assert_market_source_publication_ready(draft_id_input uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  draft_row private.market_drafts%rowtype;
begin
  select * into draft_row from private.market_drafts where id = draft_id_input;
  if not found then raise exception 'DRAFT_NOT_FOUND' using errcode = 'P0001'; end if;
  perform private.assert_market_radar_draft_eligibility_v1(draft_row, clock_timestamp());
  perform private.assert_market_source_binding_ready_v1(draft_id_input);
end;
$function$;

revoke all on function private.assert_market_source_publication_ready(uuid)
  from public, anon, authenticated, service_role;

create or replace function private.ensure_market_source_publication_ready(draft_id_input uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  binding_state jsonb;
begin
  binding_state := private.ensure_market_source_confirmation_ready_v1(draft_id_input);
  perform private.assert_market_source_publication_ready(draft_id_input);
  return binding_state || jsonb_build_object('publication_ready', true);
end;
$function$;

revoke all on function private.ensure_market_source_publication_ready(uuid)
  from public, anon, authenticated, service_role;

-- Confirmar significa que la administradora revisó la versión privada exacta.
-- La elegibilidad externa se renueva y se liga inmediatamente antes de publicar.
create or replace function public.confirm_market_draft_review(
  draft_id_input uuid,
  expected_version_input bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor_id uuid := private.require_current_admin();
  draft_row private.market_drafts%rowtype;
  effective_review_id_value bigint;
  binding_state jsonb;
begin
  select * into draft_row
  from private.market_drafts
  where id = draft_id_input
  for update;
  if not found then raise exception 'DRAFT_NOT_FOUND' using errcode = 'P0001'; end if;
  if expected_version_input is null or draft_row.content_version <> expected_version_input then
    raise exception 'DRAFT_VERSION_MOVED' using errcode = '40001';
  end if;
  effective_review_id_value := private.market_current_effective_review_id(draft_row);
  if effective_review_id_value is null
     or draft_row.review_status <> 'approved'
     or draft_row.reviewed_version <> draft_row.content_version
     or draft_row.reviewed_fingerprint is distinct from draft_row.content_fingerprint then
    raise exception 'CURRENT_APPROVAL_REQUIRED' using errcode = '22023';
  end if;
  binding_state := private.ensure_market_source_confirmation_ready_v1(draft_row.id);
  if draft_row.human_confirmed_at is not null
     and draft_row.human_confirmed_fingerprint = draft_row.content_fingerprint
     and draft_row.human_confirmed_review_id = effective_review_id_value then
    return jsonb_build_object(
      'status', 'human_confirmed', 'confirmed_at', draft_row.human_confirmed_at,
      'effective_review_id', effective_review_id_value,
      'content_fingerprint', draft_row.content_fingerprint,
      'binding', binding_state, 'changed', false, 'idempotency_replay', true
    );
  end if;
  update private.market_drafts set
    workflow_status = 'human_confirmed',
    human_confirmed_at = now(), human_confirmed_by = actor_id,
    human_confirmed_fingerprint = content_fingerprint,
    human_confirmed_review_id = effective_review_id_value,
    updated_at = now(), updated_by = actor_id
  where id = draft_row.id
  returning * into draft_row;
  insert into private.market_admin_audit(actor_id, action_code, draft_id, draft_version, detail)
  values (
    actor_id, 'HUMAN_CONFIRMATION_RECORDED', draft_row.id, draft_row.content_version,
    jsonb_build_object(
      'effective_review_id', effective_review_id_value,
      'content_fingerprint', draft_row.content_fingerprint,
      'binding_id', binding_state ->> 'binding_id',
      'binding_plan_version', binding_state ->> 'plan_version',
      'binding_auto_validated', coalesce((binding_state ->> 'auto_validated')::boolean, false),
      'publication_eligibility_deferred', draft_row.radar_candidate_id is not null
    )
  );
  return jsonb_build_object(
    'status', draft_row.workflow_status, 'confirmed_at', draft_row.human_confirmed_at,
    'effective_review_id', effective_review_id_value,
    'content_fingerprint', draft_row.content_fingerprint,
    'binding', binding_state, 'changed', true, 'idempotency_replay', false
  );
end;
$function$;

revoke all on function public.confirm_market_draft_review(uuid,bigint)
  from public, anon, authenticated, service_role;
grant execute on function public.confirm_market_draft_review(uuid,bigint)
  to authenticated;

create or replace function private.market_draft_radar_eligibility_gate_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  old_link jsonb := jsonb_build_object(
    'candidate', old.source_provenance -> 'radar_candidate_id',
    'revision', old.source_provenance -> 'radar_preparation_revision',
    'check', old.source_provenance -> 'radar_eligibility_check_id',
    'policy', old.source_provenance -> 'radar_eligibility_policy_version',
    'status', old.source_provenance -> 'radar_eligibility_status',
    'hash', old.source_provenance -> 'radar_eligibility_decision_hash'
  );
  new_link jsonb := jsonb_build_object(
    'candidate', new.source_provenance -> 'radar_candidate_id',
    'revision', new.source_provenance -> 'radar_preparation_revision',
    'check', new.source_provenance -> 'radar_eligibility_check_id',
    'policy', new.source_provenance -> 'radar_eligibility_policy_version',
    'status', new.source_provenance -> 'radar_eligibility_status',
    'hash', new.source_provenance -> 'radar_eligibility_decision_hash'
  );
  old_radar_linked boolean := old.radar_candidate_id is not null
    or coalesce(old.source_provenance, '{}'::jsonb) ? 'radar_candidate_id';
  initial_link boolean := false;
  safe_rebind boolean := false;
  provenance_revision bigint;
begin
  if old_radar_linked and new.radar_candidate_id is distinct from old.radar_candidate_id then
    raise exception 'RADAR_DRAFT_ELIGIBILITY_LINK_IMMUTABLE' using errcode = '55000';
  end if;
  if old_radar_linked and new_link is distinct from old_link then
    initial_link := not (coalesce(old.source_provenance, '{}'::jsonb) ? 'radar_eligibility_check_id')
      and coalesce(new.source_provenance ->> 'radar_candidate_id', '') = new.radar_candidate_id::text
      and coalesce(new.source_provenance ->> 'radar_eligibility_check_id', '') ~ '^[1-9][0-9]*$'
      and new.source_provenance ->> 'radar_eligibility_policy_version' = 'atinara-prediction-policy-v5'
      and new.source_provenance ->> 'radar_eligibility_status' = 'eligible'
      and coalesce(new.source_provenance ->> 'radar_eligibility_decision_hash', '') ~ '^[0-9a-f]{64}$';
    safe_rebind := not initial_link
      and new.radar_candidate_id is not distinct from old.radar_candidate_id
      and new.content_version > old.content_version
      and new.review_status <> 'approved'
      and new.human_confirmed_at is null and new.scheduled_for is null
      and new.workflow_status in (
        'draft_incomplete', 'draft_ready', 'review_pending', 'review_in_progress',
        'review_rejected', 'review_inconclusive', 'review_unavailable'
      );
    if safe_rebind then
      if coalesce(new.source_provenance ->> 'radar_preparation_revision', '') !~ '^[1-9][0-9]*$' then
        raise exception 'RADAR_DRAFT_ELIGIBILITY_PROVENANCE_REQUIRED' using errcode = '55000';
      end if;
      provenance_revision := (new.source_provenance ->> 'radar_preparation_revision')::bigint;
      perform private.assert_market_radar_candidate_eligible_v1(new.radar_candidate_id, provenance_revision);
    elsif not initial_link then
      raise exception 'RADAR_DRAFT_ELIGIBILITY_LINK_IMMUTABLE' using errcode = '55000';
    end if;
  end if;
  if new.workflow_status in ('scheduled', 'published') then
    perform private.assert_market_radar_draft_eligibility_v1(new, clock_timestamp());
  end if;
  return new;
end;
$function$;

revoke all on function private.market_draft_radar_eligibility_gate_v1()
  from public, anon, authenticated, service_role;

comment on table private.market_draft_eligibility_bindings is
  'Atestaciones append-only que ligan una revalidación Radar a la versión y huella exactas del borrador antes de publicar.';
comment on function public.bind_market_radar_draft_eligibility_v2(uuid,uuid,bigint,text,bigint,bigint,uuid,uuid) is
  'RPC exclusiva de service_role; verifica administradora, versión, huella, revisión y check actual antes de crear una ligadura idempotente.';
comment on function public.confirm_market_draft_review(uuid,bigint) is
  'Confirmación humana privada de una revisión efectiva exacta. No publica y difiere la revalidación externa estricta hasta la puerta de publicación.';
