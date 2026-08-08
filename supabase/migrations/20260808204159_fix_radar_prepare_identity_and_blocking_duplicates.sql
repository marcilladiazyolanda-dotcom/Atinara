-- Corrige la autocoincidencia del Radar y hace que solo una coincidencia
-- exacta o semántica bloqueante impida preparar una candidata. No publica,
-- confirma, resuelve ni modifica mercados, predicciones, Karma o Prestigio.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';

create or replace function private.market_candidate_blocking_duplicates(
  items_input jsonb,
  self_id_input uuid default null
)
returns jsonb
language sql
immutable
set search_path = ''
as $function$
  with filtered as (
    select
      element.item,
      element.ordinality,
      coalesce(nullif(element.item ->> 'id', ''), md5(element.item::text)) as identity_key,
      element.item ->> 'relationship' as relationship_key
    from jsonb_array_elements(
      case when jsonb_typeof(items_input) = 'array' then items_input else '[]'::jsonb end
    ) with ordinality as element(item, ordinality)
    where jsonb_typeof(element.item) = 'object'
      and (self_id_input is null or element.item ->> 'id' is distinct from self_id_input::text)
      and element.item ->> 'relationship' in ('exact_duplicate', 'semantic_duplicate')
      and lower(coalesce(element.item ->> 'blocking', 'true')) not in ('false', '0', 'no')
  ), unique_matches as (
    select distinct on (identity_key, relationship_key)
      item, ordinality
    from filtered
    order by identity_key, relationship_key, ordinality
  )
  select coalesce(jsonb_agg(item order by ordinality), '[]'::jsonb)
  from unique_matches;
$function$;

create or replace function private.market_candidate_sibling_matches(
  items_input jsonb,
  self_id_input uuid default null
)
returns jsonb
language sql
immutable
set search_path = ''
as $function$
  with filtered as (
    select
      element.item,
      element.ordinality,
      coalesce(nullif(element.item ->> 'id', ''), md5(element.item::text)) as identity_key,
      coalesce(nullif(element.item ->> 'family_child_key', ''), '') as child_key
    from jsonb_array_elements(
      case when jsonb_typeof(items_input) = 'array' then items_input else '[]'::jsonb end
    ) with ordinality as element(item, ordinality)
    where jsonb_typeof(element.item) = 'object'
      and (self_id_input is null or element.item ->> 'id' is distinct from self_id_input::text)
      and element.item ->> 'relationship' = 'sibling'
      and lower(coalesce(element.item ->> 'blocking', 'false')) in ('false', '0', 'no')
  ), unique_matches as (
    select distinct on (identity_key, child_key)
      item, ordinality
    from filtered
    order by identity_key, child_key, ordinality
  )
  select coalesce(jsonb_agg(item order by ordinality), '[]'::jsonb)
  from unique_matches;
$function$;

create or replace function private.market_candidate_has_blocking_duplicate(
  items_input jsonb,
  self_id_input uuid default null
)
returns boolean
language sql
immutable
set search_path = ''
as $function$
  select jsonb_array_length(
    private.market_candidate_blocking_duplicates(items_input, self_id_input)
  ) > 0;
$function$;

revoke all on function private.market_candidate_blocking_duplicates(jsonb, uuid)
  from public, anon, authenticated;
revoke all on function private.market_candidate_sibling_matches(jsonb, uuid)
  from public, anon, authenticated;
revoke all on function private.market_candidate_has_blocking_duplicate(jsonb, uuid)
  from public, anon, authenticated;

create or replace function private.deduplicate_market_candidate_family_arrays()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  source_payload jsonb := coalesce(new.normalized_payload, '{}'::jsonb);
  blockers jsonb;
  siblings jsonb;
  hard_reasons jsonb := '[]'::jsonb;
  reason_item jsonb;
  has_blockers boolean;
  had_duplicate_marker boolean := false;
  previous_novelty integer := 0;
  relationship_value text;
begin
  blockers := private.market_candidate_blocking_duplicates(
    coalesce(new.duplicate_matches, source_payload -> 'duplicate_matches'),
    new.id
  );
  siblings := private.market_candidate_sibling_matches(source_payload -> 'family_matches', new.id);
  has_blockers := jsonb_array_length(blockers) > 0;
  had_duplicate_marker := jsonb_array_length(
    case
      when jsonb_typeof(coalesce(new.duplicate_matches, source_payload -> 'duplicate_matches')) = 'array'
        then coalesce(new.duplicate_matches, source_payload -> 'duplicate_matches')
      else '[]'::jsonb
    end
  ) > 0;

  for reason_item in
    select value
    from jsonb_array_elements(
      case
        when jsonb_typeof(source_payload -> 'hard_reject_reasons') = 'array'
          then source_payload -> 'hard_reject_reasons'
        else '[]'::jsonb
      end
    )
  loop
    if reason_item #>> '{}' = 'DUPLICATE_MARKET' then
      had_duplicate_marker := true;
    elsif not hard_reasons @> jsonb_build_array(reason_item) then
      hard_reasons := hard_reasons || jsonb_build_array(reason_item);
    end if;
  end loop;

  begin
    previous_novelty := greatest(0, coalesce((new.score_breakdown ->> 'novelty')::integer, 0));
  exception when invalid_text_representation or numeric_value_out_of_range then
    previous_novelty := 0;
  end;

  if has_blockers then
    hard_reasons := hard_reasons || jsonb_build_array('DUPLICATE_MARKET');
    relationship_value := case
      when blockers @> '[{"relationship":"exact_duplicate"}]'::jsonb then 'exact_duplicate'
      else 'semantic_duplicate'
    end;
    new.score_breakdown := jsonb_set(coalesce(new.score_breakdown, '{}'::jsonb), '{novelty}', '0'::jsonb, true);
    new.quality_score := greatest(0, coalesce(new.quality_score, 0) - previous_novelty);
    if new.state not in ('prepared', 'dismissed') then
      new.state := 'rejected';
      new.quality_status := 'rejected';
      new.verification_status := 'rejected_duplicate';
      new.verification_reason_code := 'DUPLICATE_MARKET';
      new.verification_reason := 'Existe una coincidencia exacta o semántica bloqueante con otra propuesta.';
    end if;
  else
    relationship_value := case when jsonb_array_length(siblings) > 0 then 'sibling' else 'standalone' end;
    if had_duplicate_marker and previous_novelty = 0 then
      previous_novelty := 20;
      new.score_breakdown := jsonb_set(coalesce(new.score_breakdown, '{}'::jsonb), '{novelty}', '20'::jsonb, true);
      new.quality_score := least(100, coalesce(new.quality_score, 0) + 20);
    end if;
    if new.state not in ('prepared', 'dismissed') then
      if new.verification_status = 'verified_open' then
        new.state := 'available';
        new.quality_status := 'fit';
      elsif new.verification_status = 'rejected_duplicate'
        or new.verification_reason_code = 'DUPLICATE_MARKET' then
        new.state := 'needs_review';
        new.quality_status := 'needs_review';
        new.verification_status := 'needs_review';
        new.verification_reason_code := 'VERIFICATION_REQUIRED';
        new.verification_reason := 'La autocoincidencia se retiró; falta renovar la comprobación factual antes de preparar.';
        new.verification_expires_at := now();
      end if;
    end if;
  end if;

  new.duplicate_matches := blockers;
  new.family_relationship := relationship_value;
  new.normalized_payload := source_payload || jsonb_build_object(
    'duplicate_matches', blockers,
    'family_matches', siblings,
    'hard_reject_reasons', hard_reasons,
    'family_relationship', relationship_value,
    'quality_status', new.quality_status,
    'quality_score', new.quality_score,
    'score_breakdown', new.score_breakdown,
    'verification_status', new.verification_status,
    'verification_reason_code', new.verification_reason_code,
    'verification_reason', new.verification_reason
  );
  return new;
end;
$function$;

revoke all on function private.deduplicate_market_candidate_family_arrays()
  from public, anon, authenticated;

drop trigger if exists zzz_deduplicate_market_candidate_family_arrays_before_write
  on private.external_market_candidates;
create trigger zzz_deduplicate_market_candidate_family_arrays_before_write
before insert or update of normalized_payload, duplicate_matches, family_key, family_child_key
on private.external_market_candidates
for each row execute function private.deduplicate_market_candidate_family_arrays();

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
  perform private.require_current_admin();
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
  if coalesce(candidate.normalized_payload ->> 'eligibility_policy_version', '') <> 'atinara-prediction-policy-v3' then
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
    return jsonb_build_object('ok', false, 'error', 'RESOLUTION_SOURCE_REQUIRED', 'message', 'La candidata no conserva una pregunta, criterios y fuente de resolución verificables.');
  end if;
  if private.market_candidate_has_blocking_duplicate(candidate.duplicate_matches, candidate.id) then
    return jsonb_build_object('ok', false, 'error', 'CONFIRMED_DUPLICATE', 'message', 'Existe una coincidencia exacta o semántica con otro mercado o borrador.');
  end if;
  return jsonb_build_object('ok', true, 'candidate_id', candidate.id, 'checked_at', checked_at);
end;
$function$;

revoke all on function public.reserve_market_radar_candidate_for_prepare(uuid, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.reserve_market_radar_candidate_for_prepare(uuid, text, timestamptz)
  to authenticated;

-- La actualización activa los clasificadores vigentes. El último trigger retira
-- autocoincidencias, conserva duplicados reales y restaura las hermanas válidas.
update private.external_market_candidates candidate_alias
set normalized_payload = candidate_alias.normalized_payload,
    duplicate_matches = candidate_alias.duplicate_matches;

commit;
