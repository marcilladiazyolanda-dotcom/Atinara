-- Atinara · proyección operativa de esperas técnicas v11.
-- technical_hold es recuperable: no se muestra ni persiste como rechazo.

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
    elsif new.eligibility_status = 'technical_hold' then
      new.verification_status := 'needs_review';
      new.quality_status := 'needs_review';
      if new.state not in ('prepared', 'dismissed') then new.state := 'needs_review'; end if;
      new.verification_reason_code := new.eligibility_reason_code;
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

-- Reproyecta el snapshot sin crear decisiones ni checks nuevos: la decisión
-- autoritativa no cambia, solo se corrige su representación operativa.
update private.external_market_candidates candidate
set normalized_payload = candidate.normalized_payload,
    updated_at = candidate.updated_at
where candidate.eligibility_status = 'technical_hold';

alter table private.external_market_candidates
  add constraint market_radar_technical_hold_projection_v11
  check (
    eligibility_status <> 'technical_hold'
    or (
      quality_status = 'needs_review'
      and verification_status = 'needs_review'
      and state in ('needs_review', 'prepared', 'dismissed')
    )
  );

comment on constraint market_radar_technical_hold_projection_v11
  on private.external_market_candidates is
  'Una espera técnica se proyecta como revisión recuperable; nunca como rechazo editorial ni resultado resuelto.';
