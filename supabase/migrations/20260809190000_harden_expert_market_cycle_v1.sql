-- Endurece el ciclo Radar -> Editor -> Corrector sin relajar ninguna puerta de
-- publicacion. Los intentos fallidos quedan auditados, pero nunca sustituyen
-- el hecho autoritativo vigente ni se reutilizan revisiones incompatibles.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';

select pg_advisory_xact_lock(hashtextextended('atinara:expert-market-cycle-v1', 0));

create table if not exists private.market_radar_provider_run_history (
  id bigint generated always as identity primary key,
  provider text not null check (provider in ('polymarket', 'kalshi', 'tavily', 'gemini', 'igdb')),
  cache_key text not null,
  status text not null check (status in ('available', 'partial_error', 'unavailable')),
  result_count integer not null check (result_count between 0 and 240),
  error_code text,
  error_message text,
  recorded_at timestamptz not null default now(),
  constraint market_radar_provider_run_history_error_check check (
    (status = 'available' and error_code is null and error_message is null)
    or status <> 'available'
  )
);

create index if not exists market_radar_provider_run_history_provider_time_idx
  on private.market_radar_provider_run_history(provider, recorded_at desc);

alter table private.market_radar_provider_run_history enable row level security;
alter table private.market_radar_provider_run_history force row level security;

revoke all on table private.market_radar_provider_run_history
  from public, anon, authenticated, service_role;

create or replace function private.reject_market_radar_provider_history_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  raise exception 'RADAR_PROVIDER_HISTORY_APPEND_ONLY' using errcode = '55000';
end;
$function$;

revoke all on function private.reject_market_radar_provider_history_mutation()
  from public, anon, authenticated, service_role;

drop trigger if exists reject_market_radar_provider_history_mutation
  on private.market_radar_provider_run_history;
create trigger reject_market_radar_provider_history_mutation
before update or delete on private.market_radar_provider_run_history
for each row execute function private.reject_market_radar_provider_history_mutation();

create or replace function public.finalize_market_radar_provider_refresh_v1(
  provider_input text,
  cache_key_input text,
  status_input text,
  result_count_input integer,
  error_code_input text default null,
  error_message_input text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  history_id_value bigint;
  safe_error_code text;
  safe_error_message text;
begin
  if auth.role() <> 'service_role' then
    raise exception 'SERVICE_ROLE_REQUIRED' using errcode = '42501';
  end if;
  if provider_input not in ('polymarket', 'kalshi', 'tavily', 'gemini')
     or nullif(trim(cache_key_input), '') is null
     or status_input not in ('available', 'partial_error', 'unavailable')
     or result_count_input is null
     or result_count_input < 0
     or result_count_input > 240 then
    raise exception 'INVALID_RADAR_PROVIDER_REFRESH' using errcode = '22023';
  end if;
  if status_input = 'available' and (error_code_input is not null or error_message_input is not null) then
    raise exception 'INVALID_RADAR_PROVIDER_REFRESH' using errcode = '22023';
  end if;

  safe_error_code := case when status_input = 'available'
    then null else nullif(left(trim(error_code_input), 80), '') end;
  safe_error_message := case when status_input = 'available'
    then null else nullif(left(trim(error_message_input), 300), '') end;

  insert into private.market_radar_provider_run_history(
    provider, cache_key, status, result_count, error_code, error_message
  ) values (
    provider_input, left(cache_key_input, 180), status_input,
    result_count_input, safe_error_code, safe_error_message
  ) returning id into history_id_value;

  insert into private.market_radar_provider_runs (
    provider, cache_key, status, result_count, is_cached, error_code,
    error_message, fetched_at, expires_at, updated_at
  ) values (
    provider_input,
    left(cache_key_input, 180),
    status_input,
    result_count_input,
    false,
    safe_error_code,
    safe_error_message,
    now(),
    now() + case when status_input = 'available' then interval '20 minutes' else interval '5 minutes' end,
    now()
  )
  on conflict (provider, cache_key) do update set
    status = excluded.status,
    result_count = excluded.result_count,
    is_cached = false,
    error_code = excluded.error_code,
    error_message = excluded.error_message,
    fetched_at = excluded.fetched_at,
    expires_at = excluded.expires_at,
    updated_at = excluded.updated_at;

  return jsonb_build_object(
    'ok', true,
    'history_id', history_id_value,
    'provider', provider_input,
    'status', status_input,
    'result_count', result_count_input
  );
end;
$function$;

revoke all on function public.finalize_market_radar_provider_refresh_v1(text,text,text,integer,text,text)
  from public, anon, authenticated, service_role;
grant execute on function public.finalize_market_radar_provider_refresh_v1(text,text,text,integer,text,text)
  to service_role;

create or replace function public.get_market_intelligence_origin(
  origin_type_input text,
  origin_id_input text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  result jsonb;
  candidate private.external_market_candidates%rowtype;
  fact_row private.market_radar_fact_checks%rowtype;
  advancement_error text;
  can_prepare boolean := false;
begin
  if auth.role() <> 'service_role' then
    perform private.require_current_admin();
  end if;

  if origin_type_input = 'observatory_signal' then
    select to_jsonb(signal) || jsonb_build_object(
      'watch_entity_id', (
        select entity.id
        from private.data_observatory_entities entity
        where entity.provider = signal.provider
          and entity.external_id = signal.entity_id
          and entity.active
        order by entity.updated_at desc
        limit 1
      ),
      'recent_context', coalesce((
        select jsonb_agg(to_jsonb(context_row) order by context_row.observed_at desc)
        from (
          select *
          from private.data_observatory_context_items
          where origin_type = 'observatory_signal'
            and origin_id = origin_id_input
            and active
          order by observed_at desc
          limit 10
        ) context_row
      ), '[]'::jsonb)
    ) into result
    from private.data_observatory_signals signal
    where signal.id::text = origin_id_input;
  elsif origin_type_input = 'radar_candidate' then
    select * into candidate
    from private.external_market_candidates candidate_alias
    where candidate_alias.id::text = origin_id_input;

    if candidate.id is not null then
      select * into fact_row
      from private.market_radar_fact_checks fact_alias
      where fact_alias.id = candidate.current_fact_check_id;

      if candidate.state in ('available', 'prepared')
         and candidate.verification_status = 'verified_open'
         and candidate.fact_status = 'unresolved'
         and fact_row.id is not null then
        if private.market_radar_discovery_fact_current_v2(candidate, now()) then
          can_prepare := true;
        elsif fact_row.purpose = 'revalidate' then
          advancement_error := private.market_radar_fact_gate_error_v2(
            candidate.id, fact_row.preparation_revision, 'revalidate', now(), fact_row.id
          );
          can_prepare := advancement_error is null;
        end if;
      end if;

      if not can_prepare and advancement_error is null then
        advancement_error := case
          when fact_row.id is null then 'RADAR_FACTUAL_VERIFICATION_REQUIRED'
          when candidate.verification_status = 'rejected_resolved' then 'RADAR_CANDIDATE_RESOLVED'
          when candidate.verification_status = 'rejected_duplicate' then 'RADAR_CONFIRMED_DUPLICATE'
          when candidate.verification_status = 'rejected_invalid_source' then 'RADAR_CANONICAL_URL_INVALID'
          when candidate.verification_status = 'rejected_stale' then 'VERIFICATION_EXPIRED'
          when candidate.state not in ('available', 'prepared') then 'RADAR_CANDIDATE_NOT_PREPARABLE'
          else 'RADAR_REVALIDATION_REQUIRED'
        end;
      end if;

      result := private.market_radar_safe_payload(candidate) || jsonb_build_object(
        'advancement_gate', jsonb_build_object(
          'can_analyze', true,
          'can_prepare', can_prepare,
          'blocked_code', case when can_prepare then null else advancement_error end,
          'retryable', not can_prepare and advancement_error in (
            'RADAR_FACTUAL_VERIFICATION_REQUIRED',
            'RADAR_REVALIDATION_REQUIRED',
            'VERIFICATION_EXPIRED'
          ),
          'authoritative_fact_check_id', fact_row.id,
          'authoritative_fact_purpose', fact_row.purpose
        )
      );
    end if;
  elsif origin_type_input = 'context_story_arc' then
    select to_jsonb(arc) into result
    from private.data_observatory_story_arcs arc
    where arc.id::text = origin_id_input;
  else
    raise exception 'INTELLIGENCE_ORIGIN_INVALID' using errcode = '22023';
  end if;

  if result is null then
    raise exception 'INTELLIGENCE_ORIGIN_NOT_FOUND' using errcode = 'P0001';
  end if;
  return result;
end;
$function$;

revoke all on function public.get_market_intelligence_origin(text,text)
  from public, anon, authenticated, service_role;
grant execute on function public.get_market_intelligence_origin(text,text)
  to authenticated, service_role;

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
  if auth.role() <> 'service_role' then
    perform private.require_current_admin();
  end if;
  return (
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
  );
end;
$function$;

revoke all on function public.get_market_expert_analysis(text,text)
  from public, anon, authenticated, service_role;
grant execute on function public.get_market_expert_analysis(text,text)
  to authenticated, service_role;

create or replace function public.get_market_draft_expert_repair_context(draft_id_input uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  payload_value jsonb;
  deterministic_value jsonb;
  semantic_value jsonb := '[]'::jsonb;
  content_issues_value jsonb;
  candidate_value jsonb;
  review_value jsonb;
  review_compatible_value boolean := false;
  technical_value jsonb;
begin
  perform private.require_current_admin();
  payload_value := public.get_admin_market_draft(draft_id_input);
  deterministic_value := coalesce(payload_value -> 'deterministic_issues', '[]'::jsonb);
  review_value := payload_value -> 'latest_review';
  review_compatible_value := coalesce(
    jsonb_typeof(review_value) = 'object'
      and review_value ->> 'validator_version' = 'atinara-market-gate-v3'
      and review_value ->> 'policy_version' = 'atinara-market-review-policy-v3'
      and review_value ->> 'schema_version' = 'atinara-market-draft-schema-v3'
      and review_value ->> 'draft_version' = payload_value -> 'draft' ->> 'content_version'
      and review_value ->> 'content_fingerprint' = payload_value -> 'draft' ->> 'content_fingerprint',
    false
  );

  if review_compatible_value then
    semantic_value := coalesce(review_value -> 'semantic_issues', '[]'::jsonb);
  end if;
  content_issues_value := deterministic_value || semantic_value;

  select private.market_radar_safe_payload(candidate_alias) into candidate_value
  from private.external_market_candidates candidate_alias
  join private.market_drafts draft_alias on draft_alias.radar_candidate_id = candidate_alias.id
  where draft_alias.id = draft_id_input;

  technical_value := case
    when payload_value -> 'latest_attempt' ->> 'classification' = 'technical'
    then payload_value -> 'latest_attempt'
    else null
  end;

  return payload_value || jsonb_build_object(
    'radar_candidate', candidate_value,
    'repairable_content_issues', content_issues_value,
    'review_compatible', review_compatible_value,
    'review_refresh_required', not review_compatible_value,
    'stale_review', case
      when coalesce(jsonb_typeof(review_value), 'null') <> 'object' or review_compatible_value
      then null else
      jsonb_build_object(
        'id', review_value -> 'id',
        'validator_version', review_value -> 'validator_version',
        'policy_version', review_value -> 'policy_version',
        'schema_version', review_value -> 'schema_version',
        'created_at', review_value -> 'created_at'
      )
    end,
    'repair_applicable', review_compatible_value
      and technical_value is null
      and jsonb_array_length(content_issues_value) > 0,
    'technical_incident', technical_value
  );
end;
$function$;

revoke all on function public.get_market_draft_expert_repair_context(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.get_market_draft_expert_repair_context(uuid)
  to authenticated;

create or replace function public.record_market_radar_prepare_attempt_v1(
  candidate_id_input uuid,
  expected_preparation_revision_input bigint,
  normalizer_version_input text,
  verification_checked_at_input timestamptz,
  verification_input jsonb,
  fact_check_input jsonb,
  attempt_id_input uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  candidate private.external_market_candidates%rowtype;
  existing_fact private.market_radar_fact_checks%rowtype;
  fact_id_value bigint;
  attempted_revision bigint;
begin
  if auth.role() <> 'service_role' then
    raise exception 'SERVICE_ROLE_REQUIRED' using errcode = '42501';
  end if;
  if attempt_id_input is null
     or jsonb_typeof(verification_input) <> 'object'
     or jsonb_typeof(fact_check_input) <> 'object'
     or fact_check_input ->> 'attempt_id' is distinct from attempt_id_input::text
     or fact_check_input ->> 'purpose' is distinct from 'prepare'
     or coalesce(verification_input ->> 'eligibility_policy_version', '')
       <> 'atinara-prediction-policy-v4'
     or coalesce(verification_input ->> 'fact_policy_version', '')
       <> 'atinara-terminal-fact-gate-v2' then
    raise exception 'INVALID_PREPARE_ATTEMPT' using errcode = '22023';
  end if;

  select * into candidate
  from private.external_market_candidates candidate_alias
  where candidate_alias.id = candidate_id_input
  for update;
  if not found then
    raise exception 'RADAR_CANDIDATE_NOT_FOUND' using errcode = 'P0001';
  end if;

  select * into existing_fact
  from private.market_radar_fact_checks fact_alias
  where fact_alias.attempt_id = attempt_id_input;
  if found then
    if existing_fact.candidate_id <> candidate.id or existing_fact.purpose <> 'prepare' then
      raise exception 'RADAR_FACT_ATTEMPT_CONFLICT' using errcode = '40001';
    end if;
    return jsonb_build_object(
      'ok', false,
      'error', 'RADAR_REVALIDATION_REQUIRED',
      'persisted', true,
      'idempotency_replay', true,
      'attempt_fact_check_id', existing_fact.id,
      'authoritative_fact_check_id', candidate.current_fact_check_id,
      'preparation_revision', candidate.preparation_revision,
      'candidate', private.market_radar_safe_payload(candidate)
    );
  end if;

  if expected_preparation_revision_input is null
     or candidate.preparation_revision <> expected_preparation_revision_input then
    raise exception 'PREPARATION_REVISION_MISMATCH' using errcode = '40001';
  end if;
  if normalizer_version_input <> 'atinara-radar-v2'
     or candidate.normalizer_version <> normalizer_version_input then
    raise exception 'NORMALIZER_OUTDATED' using errcode = '22023';
  end if;
  if candidate.state in ('prepared', 'dismissed', 'rejected') then
    raise exception 'CANDIDATE_NOT_PREPARABLE' using errcode = '55000';
  end if;
  if verification_checked_at_input is null
     or abs(extract(epoch from (
       verification_checked_at_input - (fact_check_input ->> 'checked_at')::timestamptz
     ))) > 120 then
    raise exception 'INVALID_PREPARE_ATTEMPT_DATE' using errcode = '22007';
  end if;

  attempted_revision := candidate.preparation_revision + 1;
  fact_id_value := private.insert_market_radar_fact_check_v2(
    candidate.id, attempted_revision, 'prepare', fact_check_input
  );

  return jsonb_build_object(
    'ok', false,
    'error', case coalesce(verification_input ->> 'verification_status', '')
      when 'rejected_resolved' then 'RADAR_CANDIDATE_RESOLVED'
      when 'rejected_unannounced' then 'RADAR_CANDIDATE_UNANNOUNCED'
      when 'rejected_invalid_source' then 'RADAR_CANONICAL_URL_INVALID'
      when 'rejected_duplicate' then 'RADAR_CONFIRMED_DUPLICATE'
      when 'rejected_stale' then 'VERIFICATION_EXPIRED'
      else 'RADAR_REVALIDATION_REQUIRED'
    end,
    'persisted', true,
    'atomic', true,
    'authoritative_pointer_unchanged', true,
    'attempt_fact_check_id', fact_id_value,
    'authoritative_fact_check_id', candidate.current_fact_check_id,
    'preparation_revision', candidate.preparation_revision,
    'candidate', private.market_radar_safe_payload(candidate)
  );
end;
$function$;

revoke all on function public.record_market_radar_prepare_attempt_v1(uuid,bigint,text,timestamptz,jsonb,jsonb,uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.record_market_radar_prepare_attempt_v1(uuid,bigint,text,timestamptz,jsonb,jsonb,uuid)
  to service_role;

create or replace function private.market_draft_deterministic_issues(draft private.market_drafts)
returns jsonb
language plpgsql
stable
set search_path = ''
as $function$
declare
  issues jsonb := '[]'::jsonb;
  primary_url text := trim(coalesce(draft.primary_source ->> 'url', ''));
  alternative jsonb;
begin
  if length(trim(coalesce(draft.question, ''))) < 20 then
    issues := issues || jsonb_build_array(jsonb_build_object(
      'code', 'QUESTION_REQUIRED', 'field', 'question',
      'message', 'Escribe una pregunta completa y medible de al menos 20 caracteres.'
    ));
  end if;

  if coalesce(draft.question, '') ~* '\m(exito|éxito|importante|grande|pronto|el próximo|el proximo|el último|el ultimo|este evento)\M' then
    issues := issues || jsonb_build_array(jsonb_build_object(
      'code', 'QUESTION_AMBIGUOUS_TERM', 'field', 'question',
      'message', 'La pregunta contiene un término relativo o subjetivo que necesita una métrica, fecha o edición concreta.'
    ));
  end if;

  if length(trim(coalesce(draft.subject, ''))) < 3 then
    issues := issues || jsonb_build_array(jsonb_build_object(
      'code', 'SUBJECT_REQUIRED', 'field', 'subject',
      'message', 'Identifica de forma inequívoca el sujeto, evento o producto.'
    ));
  end if;

  if length(trim(coalesce(draft.category, ''))) < 2 then
    issues := issues || jsonb_build_array(jsonb_build_object(
      'code', 'CATEGORY_REQUIRED', 'field', 'category',
      'message', 'Selecciona una categoría.'
    ));
  end if;

  if lower(trim(coalesce(draft.yes_option, ''))) = lower(trim(coalesce(draft.no_option, '')))
     or lower(trim(coalesce(draft.yes_option, ''))) not in ('sí', 'si')
     or lower(trim(coalesce(draft.no_option, ''))) <> 'no' then
    issues := issues || jsonb_build_array(jsonb_build_object(
      'code', 'OPTIONS_NOT_BINARY', 'field', 'options',
      'message', 'Las opciones deben ser Sí y No, mutuamente excluyentes.'
    ));
  end if;

  if length(trim(coalesce(draft.evaluation_period_label, ''))) < 8
     or draft.evaluation_ends_at is null
     or draft.closes_at is null then
    issues := issues || jsonb_build_array(jsonb_build_object(
      'code', 'PERIOD_REQUIRED', 'field', 'evaluation_period',
      'message', 'Define el periodo evaluado y su final exacto.'
    ));
  elsif draft.evaluation_ends_at <> draft.closes_at then
    issues := issues || jsonb_build_array(jsonb_build_object(
      'code', 'TEMPORAL_CONTRADICTION', 'field', 'evaluation_ends_at',
      'message', 'El cierre de participación debe derivarse del final del periodo y no contradecirlo.'
    ));
  end if;

  if length(trim(coalesce(draft.timezone, ''))) < 3
     or not exists (
       select 1 from pg_catalog.pg_timezone_names tz where tz.name = draft.timezone
     ) then
    issues := issues || jsonb_build_array(jsonb_build_object(
      'code', 'TIMEZONE_INVALID', 'field', 'timezone',
      'message', 'Selecciona una zona horaria IANA válida, por ejemplo Europe/Madrid.'
    ));
  end if;

  if draft.resolution_deadline is null
     or (draft.evaluation_ends_at is not null and draft.resolution_deadline <= draft.evaluation_ends_at) then
    issues := issues || jsonb_build_array(jsonb_build_object(
      'code', 'RESOLUTION_DEADLINE_INVALID', 'field', 'resolution_deadline',
      'message', 'La fecha límite de resolución debe ser posterior al final del periodo evaluado.'
    ));
  end if;

  if length(trim(coalesce(draft.yes_criteria, ''))) < 20 then
    issues := issues || jsonb_build_array(jsonb_build_object(
      'code', 'YES_CRITERIA_REQUIRED', 'field', 'yes_criteria',
      'message', 'Describe la prueba exacta que resuelve Sí.'
    ));
  end if;
  if length(trim(coalesce(draft.no_criteria, ''))) < 20 then
    issues := issues || jsonb_build_array(jsonb_build_object(
      'code', 'NO_CRITERIA_REQUIRED', 'field', 'no_criteria',
      'message', 'Describe la prueba exacta que resuelve No.'
    ));
  end if;
  if lower(trim(coalesce(draft.yes_criteria, ''))) = lower(trim(coalesce(draft.no_criteria, '')))
     and length(trim(coalesce(draft.yes_criteria, ''))) > 0 then
    issues := issues || jsonb_build_array(jsonb_build_object(
      'code', 'OPTIONS_OVERLAP', 'field', 'no_criteria',
      'message', 'Los criterios de Sí y No se solapan y permitirían dos resoluciones razonables.'
    ));
  end if;

  if length(trim(coalesce(draft.edge_cases, ''))) < 20 then
    issues := issues || jsonb_build_array(jsonb_build_object(
      'code', 'EDGE_CASES_REQUIRED', 'field', 'edge_cases',
      'message', 'Define los casos límite aplicables.'
    ));
  end if;

  if primary_url !~* '^https://'
     or primary_url ~* '^https://(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.)' then
    issues := issues || jsonb_build_array(jsonb_build_object(
      'code', 'PRIMARY_SOURCE_INVALID', 'field', 'primary_source',
      'message', 'Añade una fuente principal pública y verificable con URL HTTPS.'
    ));
  end if;

  if jsonb_array_length(coalesce(draft.alternative_sources, '[]'::jsonb)) < 1 then
    issues := issues || jsonb_build_array(jsonb_build_object(
      'code', 'ALTERNATIVE_SOURCE_REQUIRED', 'field', 'alternative_sources',
      'message', 'Añade al menos una fuente alternativa pública.'
    ));
  else
    for alternative in select value from jsonb_array_elements(draft.alternative_sources)
    loop
      if trim(coalesce(alternative ->> 'url', '')) !~* '^https://'
         or trim(coalesce(alternative ->> 'url', '')) ~* '^https://(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.)' then
        issues := issues || jsonb_build_array(jsonb_build_object(
          'code', 'ALTERNATIVE_SOURCE_INVALID', 'field', 'alternative_sources',
          'message', 'Todas las fuentes alternativas deben usar una URL HTTPS pública.'
        ));
        exit;
      end if;
    end loop;
  end if;

  if length(trim(coalesce(draft.public_criteria, ''))) < 30 then
    issues := issues || jsonb_build_array(jsonb_build_object(
      'code', 'PUBLIC_CRITERIA_REQUIRED', 'field', 'public_criteria',
      'message', 'Explica públicamente cómo se resolverá el mercado.'
    ));
  end if;

  return issues;
end;
$function$;

revoke all on function private.market_draft_deterministic_issues(private.market_drafts)
  from public, anon, authenticated, service_role;

comment on table private.market_radar_provider_run_history is
  'Historial append-only de resultados de proveedor; complementa el snapshot operativo por provider/cache_key.';
comment on function public.get_market_intelligence_origin(text,text) is
  'Carga siempre un origen Radar legible para diagnóstico; advancement_gate separa lectura de preparación.';
comment on function public.record_market_radar_prepare_attempt_v1(uuid,bigint,text,timestamptz,jsonb,jsonb,uuid) is
  'Audita un intento factual fallido sin mover el puntero autoritativo ni la revisión de preparación.';
comment on function public.get_market_draft_expert_repair_context(uuid) is
  'Solo entrega incidencias semánticas de la revisión v3 exacta del fingerprint y versión vigentes.';

commit;
