-- Cierra de forma transaccional el paso Radar -> Agente Editor (aplicada en producción).
-- No publica, confirma, resuelve ni modifica mercados, predicciones, Karma o Prestigio.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';

alter table private.external_market_candidates
  add column if not exists preparation_revision bigint not null default 1;

do $constraints$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'private.external_market_candidates'::regclass
      and conname = 'external_market_candidates_preparation_revision_check'
  ) then
    alter table private.external_market_candidates
      add constraint external_market_candidates_preparation_revision_check
      check (preparation_revision > 0);
  end if;
end;
$constraints$;

create or replace function private.market_candidate_without_stable_self(
  items_input jsonb,
  self_id_input uuid,
  provider_input text,
  external_id_input text
)
returns jsonb
language sql
immutable
set search_path = ''
as $function$
  select coalesce(jsonb_agg(item order by ordinality), '[]'::jsonb)
  from jsonb_array_elements(
    case when jsonb_typeof(items_input) = 'array' then items_input else '[]'::jsonb end
  ) with ordinality as elements(item, ordinality)
  where jsonb_typeof(item) = 'object'
    and (self_id_input is null or item ->> 'id' is distinct from self_id_input::text)
    and (
      nullif(item ->> 'provider', ''),
      nullif(item ->> 'external_id', '')
    ) is distinct from (provider_input, external_id_input);
$function$;

create or replace function private.market_candidate_authoritative_hard_reasons(
  payload_input jsonb,
  blockers_input jsonb
)
returns jsonb
language sql
immutable
set search_path = ''
as $function$
  with reasons as (
    select value, ordinality
    from jsonb_array_elements(
      case
        when jsonb_typeof(payload_input -> 'hard_reject_reasons') = 'array'
          then payload_input -> 'hard_reject_reasons'
        else '[]'::jsonb
      end
    ) with ordinality
    where value #>> '{}' <> 'DUPLICATE_MARKET'
  ), clean as (
    select coalesce(jsonb_agg(value order by ordinality), '[]'::jsonb) value
    from reasons
  )
  select clean.value || case
    when private.market_candidate_has_blocking_duplicate(blockers_input, null)
      then jsonb_build_array('DUPLICATE_MARKET')
    else '[]'::jsonb
  end
  from clean;
$function$;

revoke all on function private.market_candidate_without_stable_self(jsonb,uuid,text,text)
  from public, anon, authenticated;
revoke all on function private.market_candidate_authoritative_hard_reasons(jsonb,jsonb)
  from public, anon, authenticated;

-- Kalshi modela muchos hijos con una pregunta padre común. El identificador real
-- del hijo vive en provider_payload.yes_sub_title (p. ej. Above 95 o Cairn).
create or replace function private.apply_structured_kalshi_candidate_family()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  raw_label text;
  normalized_label text;
  threshold_parts text[];
  threshold_direction text;
  threshold_amount text;
  option_key text;
  metadata_value jsonb;
begin
  if new.provider <> 'kalshi' then return new; end if;
  raw_label := nullif(trim(coalesce(
    new.normalized_payload #>> '{provider_payload,yes_sub_title}',
    new.normalized_payload ->> 'yes_sub_title'
  )), '');
  if raw_label is null then return new; end if;

  metadata_value := case
    when nullif(new.normalized_payload ->> 'family_key', '') is not null
      then new.normalized_payload
    else private.market_family_metadata(
      coalesce(new.normalized_payload ->> 'atinara_question', new.normalized_payload ->> 'source_question'),
      new.normalized_payload ->> 'source_title',
      coalesce(new.normalized_payload ->> 'event_group_key', new.external_event_id),
      coalesce(nullif(new.normalized_payload ->> 'source_close_at', '')::timestamptz, new.expires_at)
    )
  end;
  if nullif(metadata_value ->> 'family_key', '') is null then return new; end if;

  normalized_label := private.market_family_normalize(raw_label);
  threshold_parts := regexp_match(
    lower(replace(raw_label, ',', '.')),
    '(above|over|more than|greater than|at least|below|under|less than|fewer than|at most)[^0-9]*([0-9]+(?:\.[0-9]+)?)'
  );
  if threshold_parts is not null then
    threshold_direction := case
      when threshold_parts[1] in ('below', 'under', 'less than', 'fewer than', 'at most') then 'below'
      else 'above'
    end;
    threshold_amount := threshold_parts[2];
    metadata_value := metadata_value || jsonb_build_object(
      'family_type', 'milestone_thresholds',
      'family_child_key', 'threshold:' || threshold_direction || ':' || threshold_amount,
      'family_child_label', raw_label,
      'family_semantics', jsonb_build_object(
        'cumulative', true, 'mutually_exclusive', false, 'parent_is_market', false,
        'aggregate_probability', false, 'economic_independence', true
      ),
      'family_version', 'atinara-market-family-v2'
    );
  elsif normalized_label not in ('yes', 'si', 'true', 'no')
        and coalesce(metadata_value ->> 'family_type', '') in (
          'categorical_outcomes', 'participant_options', 'platform_variants'
        ) then
    option_key := trim(both '-' from regexp_replace(normalized_label, '[^a-z0-9]+', '-', 'g'));
    if option_key <> '' then
      metadata_value := metadata_value || jsonb_build_object(
        'family_child_key', 'option:' || left(option_key, 120),
        'family_child_label', raw_label,
        'family_version', 'atinara-market-family-v2'
      );
    end if;
  else
    return new;
  end if;

  new.family_key := metadata_value ->> 'family_key';
  new.family_title := metadata_value ->> 'family_title';
  new.family_type := metadata_value ->> 'family_type';
  new.family_child_key := metadata_value ->> 'family_child_key';
  new.family_child_label := metadata_value ->> 'family_child_label';
  new.family_sort_at := nullif(metadata_value ->> 'family_sort_at', '')::timestamptz;
  new.family_semantics := coalesce(metadata_value -> 'family_semantics', '{}'::jsonb);
  new.family_source_event_key := coalesce(
    metadata_value ->> 'family_source_event_key',
    new.normalized_payload ->> 'event_group_key'
  );
  new.family_version := 'atinara-market-family-v2';
  new.normalized_payload := coalesce(new.normalized_payload, '{}'::jsonb) || jsonb_build_object(
    'family_key', new.family_key,
    'family_title', new.family_title,
    'family_type', new.family_type,
    'family_child_key', new.family_child_key,
    'family_child_label', new.family_child_label,
    'family_sort_at', new.family_sort_at,
    'family_semantics', new.family_semantics,
    'family_source_event_key', new.family_source_event_key,
    'family_version', new.family_version
  );
  return new;
end;
$function$;

revoke all on function private.apply_structured_kalshi_candidate_family()
  from public, anon, authenticated;

drop trigger if exists a_apply_structured_kalshi_candidate_family_before_write
  on private.external_market_candidates;
create trigger a_apply_structured_kalshi_candidate_family_before_write
before insert or update of normalized_payload, external_event_id
on private.external_market_candidates
for each row execute function private.apply_structured_kalshi_candidate_family();

create or replace function private.enforce_exact_candidate_family_duplicate()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  canonical_row private.external_market_candidates%rowtype;
  blocker_value jsonb;
  hard_reasons jsonb := '[]'::jsonb;
  reason_item jsonb;
  previous_novelty integer := 0;
begin
  if new.family_key is null or new.family_child_key is null then return new; end if;
  select * into canonical_row
  from private.external_market_candidates candidate_alias
  where candidate_alias.id <> new.id
    -- En el INSERT especulativo del UPSERT new.id aún es provisional. La pareja
    -- proveedor/identificador es la identidad estable que excluye la fila real.
    and (candidate_alias.provider, candidate_alias.external_id)
        is distinct from (new.provider, new.external_id)
    and candidate_alias.family_key = new.family_key
    and candidate_alias.family_child_key = new.family_child_key
    and candidate_alias.state not in ('dismissed', 'expired', 'rejected')
    and candidate_alias.expires_at > now()
    and (candidate_alias.created_at, candidate_alias.id)
      < (coalesce(new.created_at, now()), new.id)
  order by candidate_alias.created_at, candidate_alias.id
  limit 1;
  if canonical_row.id is null then return new; end if;

  blocker_value := jsonb_build_object(
    'id', canonical_row.id,
    'provider', canonical_row.provider,
    'external_id', canonical_row.external_id,
    'question', coalesce(
      canonical_row.normalized_payload ->> 'atinara_question',
      canonical_row.normalized_payload ->> 'source_question'
    ),
    'relationship', 'exact_duplicate',
    'blocking', true,
    'family_key', new.family_key,
    'family_child_key', new.family_child_key,
    'kind', 'candidate'
  );
  if not exists (
    select 1
    from jsonb_array_elements(coalesce(new.duplicate_matches, '[]'::jsonb)) match_rows(match_item)
    where match_item ->> 'id' = canonical_row.id::text
      and match_item ->> 'relationship' = 'exact_duplicate'
  ) then
    new.duplicate_matches := coalesce(new.duplicate_matches, '[]'::jsonb)
      || jsonb_build_array(blocker_value);
  end if;

  for reason_item in
    select value
    from jsonb_array_elements(coalesce(new.normalized_payload -> 'hard_reject_reasons', '[]'::jsonb))
  loop
    if reason_item #>> '{}' <> 'DUPLICATE_MARKET' then
      hard_reasons := hard_reasons || jsonb_build_array(reason_item);
    end if;
  end loop;
  hard_reasons := hard_reasons || jsonb_build_array('DUPLICATE_MARKET');
  begin
    previous_novelty := greatest(0, coalesce((new.score_breakdown ->> 'novelty')::integer, 0));
  exception when invalid_text_representation or numeric_value_out_of_range then
    previous_novelty := 0;
  end;
  new.score_breakdown := jsonb_set(coalesce(new.score_breakdown, '{}'::jsonb), '{novelty}', '0'::jsonb, true);
  new.quality_score := greatest(0, coalesce(new.quality_score, 0) - previous_novelty);
  new.family_relationship := 'exact_duplicate';
  new.normalized_payload := coalesce(new.normalized_payload, '{}'::jsonb) || jsonb_build_object(
    'duplicate_matches', new.duplicate_matches,
    'hard_reject_reasons', hard_reasons,
    'family_relationship', 'exact_duplicate'
  );
  return new;
end;
$function$;

revoke all on function private.enforce_exact_candidate_family_duplicate()
  from public, anon, authenticated;

-- Último clasificador: usa la identidad estable de la fila durante el INSERT
-- especulativo de ON CONFLICT y nunca degrada una verificación por coincidir consigo misma.
create or replace function private.deduplicate_market_candidate_family_arrays()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  source_payload jsonb := coalesce(new.normalized_payload, '{}'::jsonb) - 'id' - 'preparation_revision';
  stable_self_id uuid := new.id;
  source_matches jsonb;
  source_siblings jsonb;
  blockers jsonb;
  siblings jsonb;
  hard_reasons jsonb;
  has_blockers boolean;
  had_duplicate_marker boolean := false;
  previous_novelty integer := 0;
  relationship_value text;
begin
  select candidate_alias.id into stable_self_id
  from private.external_market_candidates candidate_alias
  where candidate_alias.provider = new.provider
    and candidate_alias.external_id = new.external_id
  order by (candidate_alias.id = new.id) desc, candidate_alias.created_at, candidate_alias.id
  limit 1;
  stable_self_id := coalesce(stable_self_id, new.id);

  source_matches := private.market_candidate_without_stable_self(
    coalesce(new.duplicate_matches, source_payload -> 'duplicate_matches'),
    stable_self_id, new.provider, new.external_id
  );
  source_siblings := private.market_candidate_without_stable_self(
    source_payload -> 'family_matches', stable_self_id, new.provider, new.external_id
  );
  blockers := private.market_candidate_blocking_duplicates(source_matches, stable_self_id);
  siblings := private.market_candidate_sibling_matches(source_siblings, stable_self_id);
  has_blockers := jsonb_array_length(blockers) > 0;
  had_duplicate_marker := jsonb_array_length(
    case when jsonb_typeof(coalesce(new.duplicate_matches, source_payload -> 'duplicate_matches')) = 'array'
      then coalesce(new.duplicate_matches, source_payload -> 'duplicate_matches') else '[]'::jsonb end
  ) > jsonb_array_length(blockers)
    or coalesce(source_payload -> 'hard_reject_reasons', '[]'::jsonb) @> '["DUPLICATE_MARKET"]'::jsonb;
  hard_reasons := private.market_candidate_authoritative_hard_reasons(source_payload, blockers);

  begin
    previous_novelty := greatest(0, coalesce((new.score_breakdown ->> 'novelty')::integer, 0));
  exception when invalid_text_representation or numeric_value_out_of_range then
    previous_novelty := 0;
  end;

  if has_blockers then
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
        new.verification_reason_code := null;
        new.verification_reason := 'La candidata queda pendiente de una nueva comprobación factual automática.';
        new.verification_expires_at := null;
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

create or replace function private.market_candidate_preparation_projection(
  candidate private.external_market_candidates
)
returns jsonb
language sql
immutable
set search_path = ''
as $function$
  select (
    to_jsonb(candidate)
      - 'preparation_revision'
      - 'created_at'
      - 'updated_at'
      - 'cache_key'
      - 'fetched_at'
      - 'expires_at'
  ) || jsonb_build_object(
    'normalized_payload', coalesce(candidate.normalized_payload, '{}'::jsonb)
      - 'id'
      - 'preparation_revision'
      - 'cache_key'
      - 'fetched_at'
      - 'cache_expires_at'
      - 'expires_at'
      - 'is_stale'
  );
$function$;

create or replace function private.set_market_candidate_preparation_revision()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if tg_op = 'INSERT' then
    new.preparation_revision := 1;
  elsif new.preparation_revision is distinct from old.preparation_revision
     or private.market_candidate_preparation_projection(new)
        is distinct from private.market_candidate_preparation_projection(old) then
    new.preparation_revision := old.preparation_revision + 1;
  else
    new.preparation_revision := old.preparation_revision;
  end if;
  return new;
end;
$function$;

revoke all on function private.market_candidate_preparation_projection(private.external_market_candidates)
  from public, anon, authenticated;
revoke all on function private.set_market_candidate_preparation_revision()
  from public, anon, authenticated;

drop trigger if exists zzzz_set_market_candidate_preparation_revision_before_write
  on private.external_market_candidates;
create trigger zzzz_set_market_candidate_preparation_revision_before_write
before insert or update on private.external_market_candidates
for each row execute function private.set_market_candidate_preparation_revision();

-- El JSON normalizado es informativo. Todas las columnas autoritativas se
-- superponen al final para que una caché antigua o un payload no pueda falsificarlas.
create or replace function private.market_radar_safe_payload(candidate private.external_market_candidates)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
  select (candidate.normalized_payload - 'id' - 'preparation_revision') || jsonb_build_object(
    'id', candidate.id,
    'provider', candidate.provider,
    'external_id', candidate.external_id,
    'external_url', candidate.external_url,
    'external_event_id', candidate.external_event_id,
    'fingerprint', candidate.fingerprint,
    'cache_key', candidate.cache_key,
    'normalizer_version', candidate.normalizer_version,
    'source_status', candidate.source_status,
    'atinara_category', candidate.atinara_category,
    'source_excerpt', candidate.source_excerpt,
    'quality_status', candidate.quality_status,
    'quality_score', candidate.quality_score,
    'score_breakdown', candidate.score_breakdown,
    'warnings', candidate.warnings,
    'duplicate_matches', candidate.duplicate_matches,
    'hard_reject_reasons', private.market_candidate_authoritative_hard_reasons(
      candidate.normalized_payload, candidate.duplicate_matches
    ),
    'fetched_at', candidate.fetched_at,
    'source_updated_at', candidate.source_updated_at,
    'expires_at', candidate.expires_at,
    'cache_expires_at', candidate.expires_at,
    'is_stale', candidate.expires_at <= now(),
    'state', candidate.state,
    'prepared_draft_id', candidate.prepared_draft_id,
    'dismissed_at', candidate.dismissed_at,
    'dismissed_by', candidate.dismissed_by,
    'created_at', candidate.created_at,
    'updated_at', candidate.updated_at,
    'verification_status', candidate.verification_status,
    'verification_reason_code', candidate.verification_reason_code,
    'verification_reason', candidate.verification_reason,
    'verified_at', candidate.verified_at,
    'verification_expires_at', candidate.verification_expires_at,
    'verification_evidence', candidate.verification_evidence,
    'event_group_key', candidate.event_group_key,
    'external_event_url', candidate.external_event_url,
    'external_market_url', candidate.external_market_url,
    'external_event_slug', candidate.external_event_slug,
    'external_market_slug', candidate.external_market_slug,
    'family_key', candidate.family_key,
    'family_title', candidate.family_title,
    'family_type', candidate.family_type,
    'family_child_key', candidate.family_child_key,
    'family_child_label', candidate.family_child_label,
    'family_sort_at', candidate.family_sort_at,
    'family_relationship', candidate.family_relationship,
    'family_semantics', candidate.family_semantics,
    'family_source_event_key', candidate.family_source_event_key,
    'family_version', candidate.family_version,
    'preparation_revision', candidate.preparation_revision
  );
$function$;

revoke all on function private.market_radar_safe_payload(private.external_market_candidates)
  from public, anon, authenticated;

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
  if coalesce(verification_input ->> 'eligibility_policy_version', '') <> 'atinara-prediction-policy-v3' then
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

-- Una ejecución vieja puede terminar después que la vigente. Para el Radar se
-- prioriza siempre el dictamen de la revisión actual, no el último por reloj.
create or replace function public.get_market_expert_analysis(
  origin_type_input text,
  origin_id_input text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
begin
  perform private.require_current_admin();
  return coalesce((
    select to_jsonb(run_alias) - 'tool_summary'
    from private.market_expert_runs run_alias
    left join private.external_market_candidates candidate_alias
      on origin_type_input = 'radar_candidate'
     and candidate_alias.id::text = origin_id_input
    where run_alias.origin_type = origin_type_input
      and run_alias.origin_id = origin_id_input
    order by
      case
        when origin_type_input = 'radar_candidate'
         and candidate_alias.id is not null
         and run_alias.result_json ->> 'origin_preparation_revision'
             = candidate_alias.preparation_revision::text
          then 0
        else 1
      end,
      run_alias.created_at desc,
      run_alias.id desc
    limit 1
  ), '{}'::jsonb);
end;
$function$;

revoke all on function public.get_market_expert_analysis(text,text)
  from public, anon, authenticated;
grant execute on function public.get_market_expert_analysis(text,text)
  to authenticated;

-- Conserva la implementación probada de guardado y antepone un bloqueo de
-- revisión. Tanto el dictamen como el formulario deben describir la fila bloqueada.
alter function public.save_market_draft_from_radar_intelligence(
  uuid, uuid, bigint, jsonb, uuid, jsonb, jsonb
) rename to save_market_draft_from_radar_intelligence_without_revision_guard;

revoke all on function public.save_market_draft_from_radar_intelligence_without_revision_guard(
  uuid, uuid, bigint, jsonb, uuid, jsonb, jsonb
) from public, anon, authenticated, service_role;

create function public.save_market_draft_from_radar_intelligence(
  candidate_id_input uuid,
  draft_id_input uuid,
  expected_version_input bigint,
  draft_input jsonb,
  expert_run_id_input uuid,
  contract_input jsonb,
  sources_input jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor_id_value uuid := private.require_current_admin();
  candidate private.external_market_candidates%rowtype;
  run_row private.market_expert_runs%rowtype;
  request_row private.market_workflow_requests%rowtype;
  run_revision_text text;
  draft_revision_text text;
  submitted_revision bigint;
  request_key_value uuid;
  request_hash_value text;
  sanitized_draft jsonb;
  safe_prepared_replay boolean := false;
begin
  select * into candidate
  from private.external_market_candidates candidate_alias
  where candidate_alias.id = candidate_id_input
  for update;
  if not found then
    raise exception 'RADAR_CANDIDATE_NOT_FOUND' using errcode = 'P0001';
  end if;
  select * into run_row
  from private.market_expert_runs run_alias
  where run_alias.id = expert_run_id_input
    and run_alias.origin_type = 'radar_candidate'
    and run_alias.origin_id = candidate_id_input::text
    and run_alias.status = 'completed';
  if not found then
    raise exception 'MARKET_EXPERT_ANALYSIS_REQUIRED' using errcode = '22023';
  end if;
  run_revision_text := run_row.result_json ->> 'origin_preparation_revision';
  draft_revision_text := draft_input ->> '_radar_preparation_revision';
  if coalesce(run_revision_text, '') !~ '^[1-9][0-9]*$'
     or coalesce(draft_revision_text, '') !~ '^[1-9][0-9]*$'
     or run_revision_text::bigint <> draft_revision_text::bigint then
    raise exception 'RADAR_PREPARATION_REVISION_MISMATCH' using errcode = '40001';
  end if;
  submitted_revision := run_revision_text::bigint;
  sanitized_draft := draft_input - '_radar_preparation_revision';

  if candidate.preparation_revision <> submitted_revision then
    -- El primer guardado cambia available -> prepared y, correctamente, consume
    -- una revisión. Solo se permite saltar ese +1 cuando toda la huella del
    -- request y del binding demuestra que es el mismo replay ya confirmado.
    if candidate.state = 'prepared'
       and candidate.preparation_revision = submitted_revision + 1
       and candidate.prepared_draft_id is not null
       and draft_id_input is null then
      begin
        request_key_value := nullif(trim(sanitized_draft ->> '_idempotency_key'), '')::uuid;
      exception when invalid_text_representation then
        request_key_value := null;
      end;
      if request_key_value is not null then
        request_hash_value := encode(extensions.digest(convert_to(
          jsonb_build_object(
            'draft_id', draft_id_input,
            'expected_version', expected_version_input,
            'draft', sanitized_draft
              - '_idempotency_key'
              - '_change_origin'
              - '_binding_managed_externally'
              - '_timestamp_precision'
          )::text,
          'UTF8'
        ), 'sha256'), 'hex');
        select * into request_row
        from private.market_workflow_requests workflow_request
        where workflow_request.actor_id = actor_id_value
          and workflow_request.operation = 'save_market_draft'
          and workflow_request.request_key = request_key_value;
        safe_prepared_replay := request_row.id is not null
          and request_row.request_hash = request_hash_value
          and request_row.response_payload is not null
          and request_row.response_payload #>> '{draft,id}' = candidate.prepared_draft_id::text
          and exists (
            select 1
            from private.market_source_bindings binding_alias
            where binding_alias.draft_id = candidate.prepared_draft_id
              and binding_alias.status <> 'superseded'
              and binding_alias.origin_type = 'radar_candidate'
              and binding_alias.origin_id = candidate.id::text
              and binding_alias.expert_run_id = run_row.id
              and binding_alias.resolution_contract
                  = jsonb_set(contract_input, '{sources}', sources_input, true)
          );
      end if;
    end if;
    if not safe_prepared_replay then
      raise exception 'RADAR_PREPARATION_REVISION_MISMATCH' using errcode = '40001';
    end if;
  end if;
  return public.save_market_draft_from_radar_intelligence_without_revision_guard(
    candidate_id_input,
    draft_id_input,
    expected_version_input,
    sanitized_draft,
    expert_run_id_input,
    contract_input,
    sources_input
  );
end;
$function$;

revoke all on function public.save_market_draft_from_radar_intelligence(
  uuid, uuid, bigint, jsonb, uuid, jsonb, jsonb
) from public, anon, authenticated;
grant execute on function public.save_market_draft_from_radar_intelligence(
  uuid, uuid, bigint, jsonb, uuid, jsonb, jsonb
) to authenticated;

comment on function public.apply_market_radar_prepare_verification(uuid,bigint,text,timestamptz,jsonb) is
  'Aplica por id una revalidación factual, comprueba la revisión esperada y reserva la candidata en una sola transacción administrativa.';
comment on column private.external_market_candidates.preparation_revision is
  'Revisión monotónica de todos los datos autoritativos que habilitan preparar un borrador.';

-- Recalcula familias y elimina autocoincidencias existentes. No convierte ninguna
-- candidata pendiente en verified_open.
update private.external_market_candidates candidate_alias
set normalized_payload = candidate_alias.normalized_payload,
    duplicate_matches = candidate_alias.duplicate_matches;

update private.external_market_candidates candidate_alias
set state = 'needs_review',
    quality_status = 'needs_review',
    verification_status = 'needs_review',
    verification_reason_code = null,
    verification_reason = 'La candidata queda pendiente de una nueva comprobación factual automática.',
    verification_expires_at = null,
    normalized_payload = (
      candidate_alias.normalized_payload - 'verification_reason_code' - 'verification_expires_at'
    ) || jsonb_build_object(
      'verification_status', 'needs_review',
      'verification_reason_code', null,
      'verification_reason', 'La candidata queda pendiente de una nueva comprobación factual automática.'
    ),
    updated_at = now()
where candidate_alias.state = 'needs_review'
  and candidate_alias.verification_status = 'needs_review'
  and candidate_alias.verification_reason_code = 'VERIFICATION_REQUIRED'
  and candidate_alias.verification_reason = 'La autocoincidencia se retiró; falta renovar la comprobación factual antes de preparar.'
  and not private.market_candidate_has_blocking_duplicate(candidate_alias.duplicate_matches, candidate_alias.id);

commit;
