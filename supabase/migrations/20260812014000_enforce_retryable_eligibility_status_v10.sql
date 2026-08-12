-- Atinara · coherencia entre fallos reintentables y estado de elegibilidad v10.
-- Un timeout o escaneo oficial incompleto nunca puede convertirse en terminal.

with targets as (
  select candidate.*
  from private.external_market_candidates candidate
  where candidate.eligibility_status = 'terminal'
    and candidate.eligibility_reason_code in (
      'RESOLUTION_SOURCE_AUTHORITY_PENDING',
      'OFFICIAL_TERMINAL_SCAN_UNAVAILABLE',
      'OFFICIAL_SELECTION_RECHECK_REQUIRED',
      'VERIFICATION_REQUIRED',
      'VERIFICATION_EXPIRED'
    )
), inserted as (
  insert into private.market_radar_eligibility_checks(
    attempt_id, candidate_id, provider, external_id, event_group_key,
    policy_version, status, reason_code, reason, evidence,
    checked_at, expires_at, decision_hash
  )
  select gen_random_uuid(), target.id, target.provider, target.external_id, target.event_group_key,
    'atinara-prediction-policy-v5', 'technical_hold', target.eligibility_reason_code,
    case target.eligibility_reason_code
      when 'OFFICIAL_TERMINAL_SCAN_UNAVAILABLE' then
        'La comprobación oficial de resultados conocidos no terminó. Atinara conserva el último expediente válido y volverá a intentarlo.'
      when 'OFFICIAL_SELECTION_RECHECK_REQUIRED' then
        'Una fuente oficial requiere completar el alcance de la selección antes de decidir. Atinara volverá a comprobarla.'
      when 'VERIFICATION_EXPIRED' then
        'La comprobación automática ha caducado y debe repetirse.'
      when 'VERIFICATION_REQUIRED' then
        'La candidata necesita completar una comprobación automática antes de preparar un borrador.'
      else
        'Atinara no encontró todavía una fuente resolutiva oficial y exacta para esta opción. La volverá a comprobar automáticamente.'
    end,
    jsonb_build_array(jsonb_build_object(
      'evidence_type', 'retryable_status_consistency_repair',
      'previous_check_id', target.current_eligibility_check_id,
      'previous_status', target.eligibility_status,
      'reason_code', target.eligibility_reason_code
    )), now(), now() + interval '5 minutes',
    encode(extensions.digest(
      target.id::text || '|' || target.preparation_revision::text || '|retryable-status-v10|' || now()::text,
      'sha256'
    ), 'hex')
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
  quality_status = 'needs_review',
  verification_status = 'needs_review',
  verification_reason_code = inserted.reason_code,
  verification_reason = inserted.reason,
  verification_evidence = inserted.evidence,
  state = case when candidate.prepared_draft_id is not null then 'prepared' else 'needs_review' end,
  updated_at = now()
from inserted
where candidate.id = inserted.candidate_id;

alter table private.external_market_candidates
  add constraint market_radar_retryable_status_consistency_v10
  check (
    eligibility_reason_code not in (
      'RESOLUTION_SOURCE_AUTHORITY_PENDING',
      'OFFICIAL_TERMINAL_SCAN_UNAVAILABLE',
      'OFFICIAL_SELECTION_RECHECK_REQUIRED',
      'VERIFICATION_REQUIRED',
      'VERIFICATION_EXPIRED'
    )
    or eligibility_status = 'technical_hold'
  );

-- El historial append-only conserva los 27 registros defectuosos como prueba
-- forense, pero toda inserción futura queda protegida por este constraint.
alter table private.market_radar_eligibility_checks
  add constraint market_radar_check_retryable_status_consistency_v10
  check (
    reason_code not in (
      'RESOLUTION_SOURCE_AUTHORITY_PENDING',
      'OFFICIAL_TERMINAL_SCAN_UNAVAILABLE',
      'OFFICIAL_SELECTION_RECHECK_REQUIRED',
      'VERIFICATION_REQUIRED',
      'VERIFICATION_EXPIRED'
    )
    or status = 'technical_hold'
  ) not valid;

comment on constraint market_radar_check_retryable_status_consistency_v10
  on private.market_radar_eligibility_checks is
  'Protege nuevas decisiones: un motivo reintentable solo puede persistirse como technical_hold. NOT VALID preserva el historial append-only anterior a v10.';
