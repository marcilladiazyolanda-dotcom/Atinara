-- Atinara · autoridad resolutiva exacta por candidata v9.
-- Un endpoint genérico declarado por el proveedor no basta: la evidencia debe
-- acreditar identidad en el propio endpoint y quedar ligada al external_id.

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
            and evidence_item ->> 'parser_version' = 'atinara-resolution-authority-v3'
            and evidence_item ->> 'claim_status' = 'resolution_authority'
            and not coalesce((evidence_item ->> 'direct_claim')::boolean, true)
            and coalesce((evidence_item ->> 'claim_verifiable')::boolean, false)
            and evidence_item ->> 'authority_role' = 'PRIMARY_RESOLUTION'
            and coalesce((evidence_item ->> 'resolution_contract_specific')::boolean, false)
            and evidence_item ->> 'contract_policy_version' = 'atinara-resolution-authority-v3'
            and evidence_item ->> 'provider' = candidate_input.provider
            and evidence_item ->> 'adapter_version' = candidate_input.normalizer_version
            and evidence_item ->> 'candidate_external_id' = candidate_input.external_id
            and coalesce(evidence_item ->> 'contract_identity', '') <> ''
            and coalesce((evidence_item ->> 'endpoint_identity_verified')::boolean, false)
            and evidence_item ->> 'endpoint_identity_basis' in ('subject_header', 'family_header_child_content')
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

-- Retira cualquier lease emitido con la autoridad v2. No se inventa una fuente
-- alternativa: la siguiente comprobación v3 deberá recuperar un endpoint exacto.
with targets as (
  select candidate.*
  from private.external_market_candidates candidate
  where candidate.eligibility_status = 'eligible'
    and not private.market_radar_candidate_resolution_source_ready_v1(candidate)
), inserted as (
  insert into private.market_radar_eligibility_checks(
    attempt_id, candidate_id, provider, external_id, event_group_key,
    policy_version, status, reason_code, reason, evidence,
    checked_at, expires_at, decision_hash
  )
  select gen_random_uuid(), target.id, target.provider, target.external_id, target.event_group_key,
    'atinara-prediction-policy-v5', 'technical_hold', 'RESOLUTION_SOURCE_AUTHORITY_PENDING',
    'La autoridad resolutiva anterior no estaba ligada a un endpoint exacto de esta opción. Atinara debe volver a comprobarla.',
    jsonb_build_array(jsonb_build_object(
      'evidence_type', 'source_authority_schema_upgrade',
      'from_schema', 'atinara-resolution-authority-v2',
      'to_schema', 'atinara-resolution-authority-v3',
      'candidate_external_id', target.external_id
    )), now(), now() + interval '5 minutes',
    encode(extensions.digest(
      target.id::text || '|' || target.preparation_revision::text || '|RESOLUTION_SOURCE_AUTHORITY_PENDING|v3|' || now()::text,
      'sha256'
    ), 'hex')
  from targets target
  returning *
)
update private.external_market_candidates candidate set
  normalized_payload = (
    candidate.normalized_payload
      - 'atinara_resolution_source_url'
      - 'resolution_source_evidence'
      - 'verification_evidence'
  ) || jsonb_build_object(
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
  verification_status = 'needs_verification',
  verification_reason_code = 'RESOLUTION_SOURCE_AUTHORITY_PENDING',
  verification_reason = inserted.reason,
  state = case when candidate.prepared_draft_id is not null then 'prepared' else 'needs_review' end,
  updated_at = now()
from inserted
where candidate.id = inserted.candidate_id;

comment on function private.market_radar_candidate_resolution_source_ready_v1(private.external_market_candidates) is
  'Exige contenido oficial directo o autoridad v3 ligada a external_id, identidad contractual y endpoint exacto; rechaza páginas genéricas o evidencia cruzada entre opciones.';
