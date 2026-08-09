-- Sincroniza todas las puertas de preparación con la política factual v4.
-- Invalida de forma fail-closed aprobaciones open emitidas por políticas anteriores.
-- No publica, confirma, resuelve ni modifica economía, Karma o Prestigio.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';

create or replace function public.reserve_market_radar_candidate_for_prepare(
  candidate_id_input uuid,
  normalizer_version_input text,
  verification_checked_at_input timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  candidate private.external_market_candidates%rowtype;
  checked_at timestamptz := greatest(now(), coalesce(verification_checked_at_input, now()));
begin
  if auth.role() <> 'service_role' then
    perform private.require_current_admin();
  end if;
  select * into candidate
  from private.external_market_candidates candidate_alias
  where candidate_alias.id = candidate_id_input
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'CANDIDATE_NOT_FOUND', 'message', 'No se encontró la candidata.');
  end if;
  if normalizer_version_input <> 'atinara-radar-v2'
    or candidate.normalizer_version <> normalizer_version_input then
    return jsonb_build_object('ok', false, 'error', 'NORMALIZER_OUTDATED', 'message', 'La candidata utiliza un normalizador anterior.');
  end if;
  if coalesce(candidate.normalized_payload ->> 'eligibility_policy_version', '') <> 'atinara-prediction-policy-v4' then
    return jsonb_build_object('ok', false, 'error', 'ELIGIBILITY_POLICY_OUTDATED', 'message', 'La candidata debe revisarse con el criterio predictivo vigente.');
  end if;
  if candidate.state <> 'available' or candidate.verification_status <> 'verified_open' then
    return jsonb_build_object('ok', false, 'error', 'VERIFICATION_REQUIRED', 'message', 'La candidata no tiene una verificación aprobada.');
  end if;
  if candidate.expires_at <= checked_at
    or candidate.verification_expires_at is null
    or candidate.verification_expires_at <= checked_at then
    return jsonb_build_object('ok', false, 'error', 'VERIFICATION_EXPIRED', 'message', 'La verificación factual ha caducado.');
  end if;
  if coalesce(candidate.normalized_payload ->> 'atinara_question', '') = ''
    or coalesce(candidate.normalized_payload ->> 'atinara_resolution_criteria', '') = ''
    or coalesce(candidate.normalized_payload ->> 'atinara_resolution_source_url', '') !~ '^https://' then
    return jsonb_build_object('ok', false, 'error', 'RESOLUTION_SOURCE_REQUIRED', 'message', 'La candidata no conserva pregunta, criterios y fuente verificables.');
  end if;
  if private.market_candidate_has_blocking_duplicate(candidate.duplicate_matches, candidate.id) then
    return jsonb_build_object('ok', false, 'error', 'CONFIRMED_DUPLICATE', 'message', 'Existe una coincidencia exacta o semántica bloqueante.');
  end if;
  return jsonb_build_object(
    'ok', true,
    'candidate_id', candidate.id,
    'preparation_revision', candidate.preparation_revision,
    'checked_at', checked_at,
    'candidate', private.market_radar_safe_payload(candidate)
  );
end;
$function$;

revoke all on function public.reserve_market_radar_candidate_for_prepare(uuid,text,timestamptz)
  from public, anon, authenticated;
grant execute on function public.reserve_market_radar_candidate_for_prepare(uuid,text,timestamptz)
  to authenticated;

create or replace function public.apply_market_radar_prepare_verification(
  candidate_id_input uuid,
  expected_preparation_revision_input bigint,
  normalizer_version_input text,
  verification_checked_at_input timestamptz,
  verification_input jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  candidate private.external_market_candidates%rowtype;
  checked_at timestamptz := greatest(now(), coalesce(verification_checked_at_input, now()));
  verification_expiry timestamptz;
  cache_expiry timestamptz;
  verification_status_value text;
  mapped_state text;
  mapped_quality text;
  readiness_error text;
  reservation jsonb;
begin
  -- La Edge Function autentica al administrador antes de llegar aquí. Esta RPC
  -- acepta evidencia factual enriquecida y por eso nunca es invocable desde REST
  -- con un JWT de navegador.
  if auth.role() <> 'service_role' then
    raise exception 'SERVICE_ROLE_REQUIRED' using errcode = '42501';
  end if;
  select * into candidate
  from private.external_market_candidates candidate_alias
  where candidate_alias.id = candidate_id_input
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'CANDIDATE_NOT_FOUND', 'message', 'No se encontró la candidata.');
  end if;
  if expected_preparation_revision_input is null
     or candidate.preparation_revision <> expected_preparation_revision_input then
    return jsonb_build_object(
      'ok', false, 'error', 'PREPARATION_REVISION_MISMATCH',
      'message', 'La candidata cambió durante la preparación. Vuelve a analizarla.',
      'preparation_revision', candidate.preparation_revision,
      'candidate', private.market_radar_safe_payload(candidate)
    );
  end if;
  if normalizer_version_input <> 'atinara-radar-v2'
     or candidate.normalizer_version <> normalizer_version_input then
    return jsonb_build_object('ok', false, 'error', 'NORMALIZER_OUTDATED', 'message', 'La candidata utiliza un normalizador anterior.');
  end if;
  if jsonb_typeof(verification_input) <> 'object' then
    return jsonb_build_object('ok', false, 'error', 'INVALID_VERIFICATION_PAYLOAD', 'message', 'La comprobación factual no es válida.');
  end if;
  if candidate.state in ('prepared', 'dismissed') then
    return jsonb_build_object('ok', false, 'error', 'CANDIDATE_NOT_PREPARABLE', 'message', 'La candidata ya no está disponible para preparar.');
  end if;
  verification_status_value := coalesce(verification_input ->> 'verification_status', '');
  if verification_status_value not in (
    'pending', 'verified_open', 'needs_review', 'rejected_resolved',
    'rejected_stale', 'rejected_ineligible', 'rejected_unannounced',
    'rejected_incoherent', 'rejected_invalid_source', 'rejected_duplicate'
  ) then
    return jsonb_build_object('ok', false, 'error', 'INVALID_VERIFICATION_STATUS', 'message', 'El resultado factual no es válido.');
  end if;
  if coalesce(verification_input ->> 'eligibility_policy_version', '') <> 'atinara-prediction-policy-v4' then
    return jsonb_build_object('ok', false, 'error', 'ELIGIBILITY_POLICY_OUTDATED', 'message', 'La comprobación usa una política anterior.');
  end if;
  if verification_status_value = 'verified_open' and (
     coalesce(verification_input ->> 'atinara_question', '') = ''
     or coalesce(verification_input ->> 'atinara_resolution_criteria', '') = ''
     or coalesce(verification_input ->> 'atinara_resolution_source_url', '') !~ '^https://') then
    return jsonb_build_object('ok', false, 'error', 'RESOLUTION_SOURCE_REQUIRED', 'message', 'Faltan pregunta, criterios o fuente de resolución.');
  end if;
  if jsonb_typeof(coalesce(verification_input -> 'verification_evidence', '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(verification_input -> 'warnings', '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(verification_input -> 'duplicate_matches', '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(verification_input -> 'score_breakdown', '{}'::jsonb)) <> 'object' then
    return jsonb_build_object('ok', false, 'error', 'INVALID_VERIFICATION_PAYLOAD', 'message', 'La comprobación factual tiene una estructura inválida.');
  end if;
  begin
    verification_expiry := nullif(verification_input ->> 'verification_expires_at', '')::timestamptz;
    cache_expiry := coalesce(
      nullif(verification_input ->> 'cache_expires_at', '')::timestamptz,
      nullif(verification_input ->> 'expires_at', '')::timestamptz
    );
  exception when invalid_datetime_format then
    return jsonb_build_object('ok', false, 'error', 'INVALID_VERIFICATION_DATE', 'message', 'La vigencia factual no es válida.');
  end;
  if verification_status_value = 'verified_open' and (
     verification_expiry is null or verification_expiry <= checked_at
     or cache_expiry is null or cache_expiry <= checked_at) then
    return jsonb_build_object('ok', false, 'error', 'VERIFICATION_EXPIRED', 'message', 'La verificación factual ha caducado.');
  end if;
  cache_expiry := coalesce(cache_expiry, checked_at + interval '10 minutes');
  mapped_state := case
    when verification_status_value = 'verified_open' then 'available'
    when verification_status_value in ('pending', 'needs_review') then 'needs_review'
    else 'rejected'
  end;
  mapped_quality := case
    when verification_status_value = 'verified_open' then 'fit'
    when verification_status_value in ('pending', 'needs_review') then 'needs_review'
    else 'rejected'
  end;

  update private.external_market_candidates candidate_alias set
      fingerprint = coalesce(nullif(verification_input ->> 'fingerprint', ''), candidate_alias.fingerprint),
      normalizer_version = normalizer_version_input,
      source_status = nullif(verification_input ->> 'source_status', ''),
      atinara_category = nullif(verification_input ->> 'atinara_category', ''),
      normalized_payload = verification_input - 'id' - 'preparation_revision',
      quality_status = mapped_quality,
      quality_score = least(greatest(coalesce((verification_input ->> 'quality_score')::numeric, candidate_alias.quality_score), 0), 100),
      score_breakdown = coalesce(verification_input -> 'score_breakdown', candidate_alias.score_breakdown),
      warnings = coalesce(verification_input -> 'warnings', '[]'::jsonb),
      duplicate_matches = coalesce(verification_input -> 'duplicate_matches', '[]'::jsonb),
      fetched_at = checked_at,
      source_updated_at = nullif(verification_input ->> 'source_updated_at', '')::timestamptz,
      expires_at = cache_expiry,
      state = mapped_state,
      verification_status = verification_status_value,
      verification_reason_code = nullif(left(verification_input ->> 'verification_reason_code', 100), ''),
      verification_reason = nullif(left(verification_input ->> 'verification_reason', 1000), ''),
      verified_at = coalesce(nullif(verification_input ->> 'verified_at', '')::timestamptz, checked_at),
      verification_expires_at = verification_expiry,
      verification_evidence = coalesce(verification_input -> 'verification_evidence', '[]'::jsonb),
      event_group_key = coalesce(nullif(left(verification_input ->> 'event_group_key', 240), ''), candidate_alias.event_group_key),
      external_event_url = coalesce(nullif(verification_input ->> 'external_event_url', ''), candidate_alias.external_event_url),
      external_market_url = coalesce(nullif(verification_input ->> 'external_market_url', ''), candidate_alias.external_market_url),
      external_event_slug = coalesce(nullif(verification_input ->> 'external_event_slug', ''), candidate_alias.external_event_slug),
      external_market_slug = coalesce(nullif(verification_input ->> 'external_market_slug', ''), candidate_alias.external_market_slug),
      preparation_revision = candidate_alias.preparation_revision + 1,
      updated_at = now()
    where candidate_alias.id = candidate.id;

  select * into candidate
  from private.external_market_candidates candidate_alias
  where candidate_alias.id = candidate_id_input
  for update;

  -- Los resultados negativos también son evidencia autoritativa: se conservan
  -- fail-closed y se devuelven junto con la revisión nueva para invalidar runs viejos.
  if candidate.verification_status <> 'verified_open' then
    readiness_error := case candidate.verification_status
      when 'rejected_resolved' then 'RADAR_CANDIDATE_RESOLVED'
      when 'rejected_unannounced' then 'RADAR_CANDIDATE_UNANNOUNCED'
      when 'rejected_ineligible' then 'RADAR_CANDIDATE_INELIGIBLE'
      when 'rejected_incoherent' then 'RADAR_CANDIDATE_INELIGIBLE'
      when 'rejected_invalid_source' then 'RADAR_CANONICAL_URL_INVALID'
      when 'rejected_duplicate' then 'RADAR_CONFIRMED_DUPLICATE'
      when 'rejected_stale' then 'VERIFICATION_EXPIRED'
      else 'RADAR_REVALIDATION_REQUIRED'
    end;
    return jsonb_build_object(
      'ok', false,
      'error', readiness_error,
      'message', coalesce(candidate.verification_reason, 'La comprobación factual no ha concluido.'),
      'candidate_id', candidate.id,
      'preparation_revision', candidate.preparation_revision,
      'candidate', private.market_radar_safe_payload(candidate),
      'persisted', true,
      'atomic', true
    );
  end if;

  reservation := public.reserve_market_radar_candidate_for_prepare(
    candidate.id, normalizer_version_input, checked_at
  );
  if not coalesce((reservation ->> 'ok')::boolean, false) then
    return reservation || jsonb_build_object(
      'ok', false,
      'candidate_id', candidate.id,
      'preparation_revision', candidate.preparation_revision,
      'candidate', private.market_radar_safe_payload(candidate),
      'persisted', true,
      'atomic', true
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'candidate_id', candidate.id,
    'preparation_revision', candidate.preparation_revision,
    'candidate', private.market_radar_safe_payload(candidate),
    'reservation', reservation,
    'atomic', true
  );
exception when invalid_text_representation or numeric_value_out_of_range or invalid_datetime_format then
  return jsonb_build_object('ok', false, 'error', 'INVALID_VERIFICATION_PAYLOAD', 'message', 'La comprobación factual contiene valores inválidos.');
end;
$function$;

revoke all on function public.apply_market_radar_prepare_verification(uuid,bigint,text,timestamptz,jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.apply_market_radar_prepare_verification(uuid,bigint,text,timestamptz,jsonb)
  to service_role;

-- Una aprobación open no puede sobrevivir a un cambio de política factual.
-- Los estados terminales y las filas preparadas/dismissed conservan su auditoría.
update private.external_market_candidates candidate
set
  state = 'expired',
  quality_status = 'needs_review',
  verification_status = 'needs_review',
  verification_reason_code = 'ELIGIBILITY_POLICY_OUTDATED',
  verification_reason = 'La política factual cambió; ejecuta un ciclo nuevo del Radar antes de reutilizar esta candidata.',
  verification_expires_at = null,
  expires_at = least(candidate.expires_at, now()),
  normalized_payload = candidate.normalized_payload || jsonb_build_object(
    'quality_status', 'needs_review',
    'verification_status', 'needs_review',
    'verification_reason_code', 'ELIGIBILITY_POLICY_OUTDATED',
    'verification_reason', 'La política factual cambió; ejecuta un ciclo nuevo del Radar antes de reutilizar esta candidata.',
    'verification_expires_at', null,
    'cache_expires_at', now()
  ),
  preparation_revision = candidate.preparation_revision + 1,
  updated_at = now()
where candidate.normalizer_version = 'atinara-radar-v2'
  and candidate.state not in ('prepared', 'dismissed')
  and candidate.verification_status = 'verified_open'
  and coalesce(candidate.normalized_payload ->> 'eligibility_policy_version', '')
      <> 'atinara-prediction-policy-v4';

comment on function public.reserve_market_radar_candidate_for_prepare(uuid,text,timestamptz) is
  'Reserva autoritativa de preparación; exige política factual v4 vigente.';
comment on function public.apply_market_radar_prepare_verification(uuid,bigint,text,timestamptz,jsonb) is
  'Aplica la revalidación factual v4 de preparación de forma atómica y fail-closed.';

commit;
