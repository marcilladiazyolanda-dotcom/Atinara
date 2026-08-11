-- Cierra dos huecos del ciclo experto sin tocar mercados ni economia:
-- 1) el Validador puede comprobar una atestacion primaria fresca y ligada a la
--    version exacta, sin confiar en afirmaciones del modelo ni exponer pruebas;
-- 2) una clave idempotente completada se reproduce aunque el borrador haya
--    avanzado de version como resultado de aquella misma ejecucion.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';

create or replace function public.get_market_draft_primary_source_attestation_v1(
  draft_id_input uuid,
  expected_version_input bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  draft_row private.market_drafts%rowtype;
  check_row private.market_draft_primary_source_checks%rowtype;
  registry_row private.market_source_registry%rowtype;
  primary_url_value text;
begin
  if private.market_request_role_v1() is distinct from 'service_role' then
    raise exception 'SERVICE_ROLE_REQUIRED' using errcode = '42501';
  end if;
  if draft_id_input is null or expected_version_input is null
     or expected_version_input < 1 then
    raise exception 'INVALID_PRIMARY_SOURCE_ATTESTATION_REQUEST' using errcode = '22023';
  end if;

  select * into draft_row
  from private.market_drafts draft_alias
  where draft_alias.id = draft_id_input;
  if not found then raise exception 'DRAFT_NOT_FOUND' using errcode = 'P0001'; end if;
  if draft_row.content_version is distinct from expected_version_input then
    raise exception 'DRAFT_VERSION_MOVED' using errcode = '40001';
  end if;
  if draft_row.content_fingerprint is distinct from private.market_draft_fingerprint(draft_row)
     or draft_row.fingerprint_version is distinct from 'sha256-canonical-v2' then
    raise exception 'DRAFT_FINGERPRINT_STALE' using errcode = '40001';
  end if;

  primary_url_value := nullif(trim(draft_row.primary_source ->> 'url'), '');
  if primary_url_value is null then
    return jsonb_build_object('verified', false, 'reason', 'PRIMARY_SOURCE_MISSING');
  end if;

  select * into check_row
  from private.market_draft_primary_source_checks source_check
  where source_check.draft_id = draft_row.id
    and source_check.draft_version = draft_row.content_version
    and source_check.final_url = primary_url_value
    and source_check.draft_category = draft_row.category
    and source_check.registry_role = 'primary_resolution'
    and source_check.validation_version = 'atinara-primary-source-validation-v1'
    and source_check.checked_at >= clock_timestamp() - interval '10 minutes'
    and source_check.expires_at > clock_timestamp()
  order by source_check.checked_at desc
  limit 1;
  if not found then
    return jsonb_build_object('verified', false, 'reason', 'CURRENT_PRIMARY_SOURCE_CHECK_MISSING');
  end if;

  select * into registry_row
  from private.market_source_registry registry_alias
  where registry_alias.id = check_row.registry_source_id;
  if not found
     or coalesce(private.market_primary_registry_row_matches_v1(
       registry_row, check_row.final_url, check_row.draft_category
     ), false) is not true
     or draft_row.primary_source ->> 'registry_source_id' is distinct from registry_row.id::text
     or draft_row.primary_source ->> 'registry_role' is distinct from 'primary_resolution'
     or draft_row.primary_source ->> 'validation_version'
       is distinct from 'atinara-primary-source-validation-v1'
     or draft_row.primary_source -> 'registry_role_verified' is distinct from 'true'::jsonb
     or draft_row.primary_source -> 'validated_reachable' is distinct from 'true'::jsonb
     or draft_row.primary_source -> 'authority_verified' is distinct from 'true'::jsonb
     or draft_row.primary_source -> 'relevance_verified' is distinct from 'true'::jsonb
     or check_row.evidence_snapshot -> 'accepted' is distinct from 'true'::jsonb
     or check_row.evidence_snapshot -> 'validated_reachable' is distinct from 'true'::jsonb
     or check_row.evidence_snapshot -> 'authority_verified' is distinct from 'true'::jsonb
     or check_row.evidence_snapshot -> 'relevance_verified' is distinct from 'true'::jsonb
     or jsonb_typeof(coalesce(check_row.evidence_snapshot -> 'matched_tokens', 'null'::jsonb))
       is distinct from 'array'
     or jsonb_array_length(check_row.evidence_snapshot -> 'matched_tokens') = 0 then
    return jsonb_build_object('verified', false, 'reason', 'PRIMARY_SOURCE_ATTESTATION_MISMATCH');
  end if;

  return jsonb_build_object(
    'verified', true,
    'check_id', check_row.id,
    'draft_id', draft_row.id,
    'draft_version', draft_row.content_version,
    'content_fingerprint', draft_row.content_fingerprint,
    'registry_source_id', check_row.registry_source_id,
    'validation_version', check_row.validation_version,
    'requested_url', check_row.requested_url,
    'final_url', check_row.final_url,
    'draft_category', check_row.draft_category,
    'checked_at', check_row.checked_at,
    'expires_at', check_row.expires_at,
    'http_status', check_row.evidence_snapshot -> 'http_status',
    'excerpt_sha256', check_row.evidence_snapshot ->> 'excerpt_sha256'
  );
end;
$function$;

revoke all on function public.get_market_draft_primary_source_attestation_v1(uuid,bigint)
  from public, anon, authenticated, service_role;
grant execute on function public.get_market_draft_primary_source_attestation_v1(uuid,bigint)
  to service_role;

create or replace function public.get_market_draft_bound_context_attestation_v1(
  draft_id_input uuid,
  expected_version_input bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  draft_row private.market_drafts%rowtype;
  current_binding private.market_source_bindings%rowtype;
  previous_binding private.market_source_bindings%rowtype;
  previous_version private.market_draft_versions%rowtype;
  current_anchor jsonb;
  previous_anchor jsonb;
  previous_source jsonb;
  source_url_value text;
begin
  if private.market_request_role_v1() is distinct from 'service_role' then
    raise exception 'SERVICE_ROLE_REQUIRED' using errcode = '42501';
  end if;
  if draft_id_input is null or expected_version_input is null
     or expected_version_input < 2 then
    return jsonb_build_object('verified', false, 'reason', 'BOUND_CONTEXT_HISTORY_NOT_APPLICABLE');
  end if;

  select * into draft_row
  from private.market_drafts draft_alias
  where draft_alias.id = draft_id_input;
  if not found then raise exception 'DRAFT_NOT_FOUND' using errcode = 'P0001'; end if;
  if draft_row.content_version is distinct from expected_version_input then
    raise exception 'DRAFT_VERSION_MOVED' using errcode = '40001';
  end if;
  if draft_row.content_fingerprint is distinct from private.market_draft_fingerprint(draft_row)
     or draft_row.fingerprint_version is distinct from 'sha256-canonical-v2' then
    raise exception 'DRAFT_FINGERPRINT_STALE' using errcode = '40001';
  end if;

  select * into current_binding
  from private.market_source_bindings binding_alias
  where binding_alias.draft_id = draft_row.id
    and binding_alias.plan_version = draft_row.content_version
    and binding_alias.status = 'draft'
    and binding_alias.market_id is null
    and binding_alias.locked_at is null
  order by binding_alias.created_at desc
  limit 1;
  if not found
     or current_binding.adapter_version not in (
       'atinara-draft-repair-v9', 'atinara-draft-repair-v10',
       'atinara-draft-repair-v11', 'atinara-draft-repair-v12'
     )
     or current_binding.resolution_contract ->> 'temporal_basis'
       is distinct from 'verified_relative_anchor' then
    return jsonb_build_object('verified', false, 'reason', 'CURRENT_BOUND_CONTEXT_NOT_REUSABLE');
  end if;
  current_anchor := coalesce(current_binding.resolution_contract -> 'relative_anchor', 'null'::jsonb);
  source_url_value := nullif(trim(current_anchor ->> 'source_url'), '');
  if jsonb_typeof(current_anchor) is distinct from 'object'
     or current_anchor ->> 'evidence_basis'
       is distinct from 'versioned_bound_required_context_source'
     or private.market_primary_source_url_host_v1(source_url_value) is null then
    return jsonb_build_object('verified', false, 'reason', 'CURRENT_BOUND_CONTEXT_ANCHOR_INVALID');
  end if;

  select * into previous_binding
  from private.market_source_bindings binding_alias
  where binding_alias.id = current_binding.supersedes_binding_id
    and binding_alias.draft_id = draft_row.id
    and binding_alias.plan_version = draft_row.content_version - 1
    and binding_alias.status = 'superseded'
    and binding_alias.market_id is null
    and binding_alias.adapter_version in (
      'atinara-draft-repair-v9', 'atinara-draft-repair-v10',
      'atinara-draft-repair-v11', 'atinara-draft-repair-v12'
    )
    and binding_alias.resolution_contract ->> 'temporal_basis' = 'verified_relative_anchor';
  if not found then
    return jsonb_build_object('verified', false, 'reason', 'PREVIOUS_BOUND_CONTEXT_MISSING');
  end if;
  previous_anchor := coalesce(previous_binding.resolution_contract -> 'relative_anchor', 'null'::jsonb);
  if jsonb_typeof(previous_anchor) is distinct from 'object'
     or previous_anchor ->> 'source_url' is distinct from source_url_value
     or previous_anchor ->> 'anchor_type' is distinct from current_anchor ->> 'anchor_type'
     or previous_anchor ->> 'anchor_date' is distinct from current_anchor ->> 'anchor_date'
     or previous_anchor ->> 'offset_days' is distinct from current_anchor ->> 'offset_days'
     or previous_anchor ->> 'observation_time' is distinct from current_anchor ->> 'observation_time'
     or previous_anchor ->> 'timezone' is distinct from current_anchor ->> 'timezone' then
    return jsonb_build_object('verified', false, 'reason', 'BOUND_CONTEXT_HISTORY_CHANGED');
  end if;
  if not exists (
    select 1
    from private.market_source_binding_sources source
    where source.binding_id = previous_binding.id
      and source.source_url = source_url_value
      and source.role = 'CONTEXT_SOURCE'
      and source.required is true
  ) then
    return jsonb_build_object('verified', false, 'reason', 'BOUND_CONTEXT_SOURCE_NOT_REQUIRED');
  end if;

  select * into previous_version
  from private.market_draft_versions version_alias
  where version_alias.draft_id = draft_row.id
    and version_alias.content_version = draft_row.content_version - 1;
  if not found then
    return jsonb_build_object('verified', false, 'reason', 'BOUND_CONTEXT_VERSION_MISSING');
  end if;
  select source.value into previous_source
  from jsonb_array_elements(coalesce(
    previous_version.canonical_payload -> 'alternative_sources', '[]'::jsonb
  )) source(value)
  where source.value ->> 'url' = source_url_value
    and source.value ->> 'role' = 'CONTEXT_SOURCE'
    and source.value -> 'required' = 'true'::jsonb
    and source.value -> 'authority_verified' = 'true'::jsonb
    and source.value -> 'relevance_verified' = 'true'::jsonb
    and source.value -> 'validated_reachable' = 'true'::jsonb
  limit 1;
  if previous_source is null then
    return jsonb_build_object('verified', false, 'reason', 'BOUND_CONTEXT_VERSION_ATTESTATION_MISSING');
  end if;

  return jsonb_build_object(
    'verified', true,
    'draft_id', draft_row.id,
    'current_version', draft_row.content_version,
    'previous_version', previous_version.content_version,
    'current_fingerprint', draft_row.content_fingerprint,
    'previous_fingerprint', previous_version.content_fingerprint,
    'source_url', source_url_value,
    'relative_anchor', current_anchor,
    'source', jsonb_build_object(
      'url', source_url_value,
      'name', coalesce(previous_source ->> 'name', ''),
      'publisher', coalesce(previous_source ->> 'publisher', ''),
      'role', 'CONTEXT_SOURCE',
      'required', true,
      'claim_slots', jsonb_build_array('TEMPORAL_ANCHOR'),
      'authority_basis', 'append_only_bound_context_history_v1',
      'relevance_basis', 'append_only_bound_context_history_v1',
      'authority_verified', true,
      'relevance_verified', true,
      'validated_reachable', true
    )
  );
end;
$function$;

revoke all on function public.get_market_draft_bound_context_attestation_v1(uuid,bigint)
  from public, anon, authenticated, service_role;
grant execute on function public.get_market_draft_bound_context_attestation_v1(uuid,bigint)
  to service_role;

create or replace function public.begin_market_draft_repair_attempt_v1(
  draft_id_input uuid,
  expected_version_input bigint,
  request_key_input uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor_id_value uuid := private.require_current_admin();
  draft_row private.market_drafts%rowtype;
  attempt_row private.market_repair_attempts%rowtype;
  context_value jsonb;
  request_hash_value text;
  issue_codes_value jsonb;
begin
  if draft_id_input is null or expected_version_input is null
     or expected_version_input < 1 or request_key_input is null then
    raise exception 'INVALID_REPAIR_REQUEST' using errcode = '22023';
  end if;

  -- La identidad de la peticion se resuelve antes de consultar la version
  -- actual. Una respuesta ya sellada es autoritativa aunque aquella ejecucion
  -- haya creado una version posterior del mismo borrador.
  select * into attempt_row
  from private.market_repair_attempts attempt_alias
  where attempt_alias.actor_id = actor_id_value
    and attempt_alias.draft_id = draft_id_input
    and attempt_alias.request_key = request_key_input
  for update;
  if found then
    if attempt_row.expected_version is distinct from expected_version_input then
      raise exception 'IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD' using errcode = '22023';
    end if;
    if attempt_row.response_payload is not null then
      return attempt_row.response_payload || jsonb_build_object(
        'attempt_id', attempt_row.id,
        'idempotency_replay', true,
        'state_preserved', attempt_row.state_preserved
      );
    end if;
    if attempt_row.lease_expires_at > now() then
      return jsonb_build_object(
        'ok', true,
        'status', 'already_in_progress',
        'attempt_id', attempt_row.id,
        'idempotency_replay', true,
        'retryable', true,
        'state_preserved', true
      );
    end if;

    select * into draft_row
    from private.market_drafts draft_alias
    where draft_alias.id = draft_id_input
    for update;
    if not found then raise exception 'DRAFT_NOT_FOUND' using errcode = 'P0001'; end if;
    if draft_row.content_version is distinct from expected_version_input then
      raise exception 'DRAFT_VERSION_MOVED' using errcode = '40001';
    end if;
    update private.market_repair_attempts set
      lease_expires_at = now() + interval '3 minutes',
      started_at = now(),
      phase = 'preflight'
    where id = attempt_row.id
    returning * into attempt_row;
  else
    select * into draft_row
    from private.market_drafts draft_alias
    where draft_alias.id = draft_id_input
    for update;
    if not found then raise exception 'DRAFT_NOT_FOUND' using errcode = 'P0001'; end if;
    if draft_row.content_version is distinct from expected_version_input then
      -- Cierra la carrera entre la primera lectura de la clave y el commit de
      -- otra ejecucion que pudo avanzar la version mientras esperabamos el lock.
      select * into attempt_row
      from private.market_repair_attempts attempt_alias
      where attempt_alias.actor_id = actor_id_value
        and attempt_alias.draft_id = draft_id_input
        and attempt_alias.request_key = request_key_input
      for update;
      if found and attempt_row.expected_version = expected_version_input
         and attempt_row.response_payload is not null then
        return attempt_row.response_payload || jsonb_build_object(
          'attempt_id', attempt_row.id,
          'idempotency_replay', true,
          'state_preserved', attempt_row.state_preserved
        );
      end if;
      raise exception 'DRAFT_VERSION_MOVED' using errcode = '40001';
    end if;

    context_value := public.get_market_draft_expert_repair_context(draft_id_input);
    issue_codes_value := coalesce((
      select jsonb_agg(distinct issue ->> 'code' order by issue ->> 'code')
      from jsonb_array_elements(coalesce(context_value -> 'repairable_content_issues', '[]'::jsonb)) issue
    ), '[]'::jsonb);
    request_hash_value := encode(extensions.digest(convert_to(jsonb_build_object(
      'draft_id', draft_id_input,
      'expected_version', expected_version_input,
      'expected_fingerprint', draft_row.content_fingerprint,
      'issue_codes', issue_codes_value,
      'policy', 'atinara-expert-cycle-policy-v2'
    )::text, 'UTF8'), 'sha256'), 'hex');

    insert into private.market_repair_attempts(
      request_key, actor_id, draft_id, expected_version, expected_fingerprint,
      request_hash, issue_codes
    ) values (
      request_key_input, actor_id_value, draft_id_input, expected_version_input,
      draft_row.content_fingerprint, request_hash_value, issue_codes_value
    )
    on conflict (actor_id, draft_id, request_key) do nothing
    returning * into attempt_row;

    if attempt_row.id is null then
      select * into attempt_row
      from private.market_repair_attempts attempt_alias
      where attempt_alias.actor_id = actor_id_value
        and attempt_alias.draft_id = draft_id_input
        and attempt_alias.request_key = request_key_input
      for update;
      if attempt_row.expected_version is distinct from expected_version_input
         or attempt_row.request_hash is distinct from request_hash_value then
        raise exception 'IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD' using errcode = '22023';
      end if;
      if attempt_row.response_payload is not null then
        return attempt_row.response_payload || jsonb_build_object(
          'attempt_id', attempt_row.id,
          'idempotency_replay', true,
          'state_preserved', attempt_row.state_preserved
        );
      end if;
      if attempt_row.lease_expires_at > now() then
        return jsonb_build_object(
          'ok', true,
          'status', 'already_in_progress',
          'attempt_id', attempt_row.id,
          'idempotency_replay', true,
          'retryable', true,
          'state_preserved', true
        );
      end if;
      update private.market_repair_attempts set
        lease_expires_at = now() + interval '3 minutes',
        started_at = now(),
        phase = 'preflight'
      where id = attempt_row.id
      returning * into attempt_row;
    end if;
  end if;

  return jsonb_build_object(
    'ok', true,
    'status', 'started',
    'attempt_id', attempt_row.id,
    'request_key', request_key_input,
    'expected_version', attempt_row.expected_version,
    'expected_fingerprint', attempt_row.expected_fingerprint,
    'issue_codes', attempt_row.issue_codes,
    'idempotency_replay', false,
    'state_preserved', true
  );
end;
$function$;

revoke all on function public.begin_market_draft_repair_attempt_v1(uuid,bigint,uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.begin_market_draft_repair_attempt_v1(uuid,bigint,uuid)
  to authenticated;

comment on function public.get_market_draft_primary_source_attestation_v1(uuid,bigint) is
  'Devuelve al Validador service-role una prueba primaria fresca, registrada y ligada a la version exacta; no expone extractos.';
comment on function public.get_market_draft_bound_context_attestation_v1(uuid,bigint) is
  'Recupera una fuente-ancla solo desde la version y el binding append-only inmediatamente anteriores cuando el binding actual demuestra la misma ancla.';
comment on function public.begin_market_draft_repair_attempt_v1(uuid,bigint,uuid) is
  'Inicia o reproduce idempotentemente un intento del Corrector; una respuesta completada precede a la comprobacion de version actual.';

commit;
