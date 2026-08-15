-- Corrige la divergencia entre la identidad familiar de Radar en JavaScript
-- y su proyección autoritativa en Postgres. En outcome/participant/platform,
-- una etiqueta afirmativa estructurada identifica al hijo aunque también exista
-- una frontera temporal; dicha frontera sigue ordenando y acotando la familia.
-- La lectura administrativa usa esa frontera predictiva antes del cierre técnico
-- del proveedor. No realiza backfill ni modifica filas de dominio.

begin;

do $preflight$
begin
  if to_regprocedure(
    'private.market_family_metadata_v4(text,text,text,text,timestamp with time zone,text,text,text)'
  ) is null
     or to_regprocedure(
       'private.market_family_safe_timestamptz_v4(text)'
     ) is null
     or to_regprocedure(
       'private.assign_market_candidate_family_v4()'
     ) is null
     or to_regprocedure(
       'private.assign_market_draft_family_v4()'
     ) is null
     or to_regprocedure(
       'private.assign_public_market_family_v4()'
     ) is null
     or to_regprocedure(
       'public.list_market_radar_candidates_v2(text,text,text,text,text,text,integer,integer)'
     ) is null then
    raise exception 'RADAR_FAMILY_OPTION_HORIZON_DEPENDENCY_MISSING';
  end if;
end;
$preflight$;

create or replace function private.market_family_option_slug_v1(
  value_input text,
  length_input integer default 120
)
returns text
language sql
immutable
set search_path = ''
as $function$
  with cleaned as (
    select left(trim(regexp_replace(
      regexp_replace(coalesce(value_input, ''), '[[:cntrl:]]', ' ', 'g'),
      '[[:space:]]+', ' ', 'g'
    )), 500) as value
  ), folded as (
    select translate(
      regexp_replace(normalize(value, NFD), U&'[\0300-\036F]', '', 'g'),
      'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'
    ) as value
    from cleaned
  )
  select left(trim(both '-' from regexp_replace(
    value, '[^a-z0-9]+', '-', 'g'
  )), greatest(1, least(coalesce(length_input, 120), 240)))
  from folded;
$function$;

revoke all on function private.market_family_option_slug_v1(text,integer)
  from public, anon, authenticated, service_role;

comment on function private.market_family_option_slug_v1(text,integer) is
  'Replica el slug NFD de la Edge solo para opciones categoricas; no cambia la normalizacion familiar global.';

create or replace function private.market_family_metadata_v4(
  question_input text,
  title_input text default null,
  subject_input text default null,
  source_event_key_input text default null,
  cutoff_input timestamptz default null,
  timezone_input text default null,
  resolution_rules_input text default null,
  yes_label_input text default null
)
returns jsonb
language plpgsql
stable
set search_path = ''
as $function$
declare
  question_value text := private.market_family_normalize_v4(coalesce(question_input, title_input));
  title_value text := private.market_family_normalize_v4(title_input);
  dimension_value text;
  type_value text;
  entity_value text;
  entity_identity text;
  display_entity text;
  boundary_value jsonb;
  threshold_value jsonb;
  duration_value jsonb;
  content_kind text;
  content_invariant text := '';
  family_key_value text;
  child_key_value text;
  child_label_value text;
  semantics_value jsonb;
  temporal_child text;
  option_key text;
  suffix_parts text[];
begin
  if question_value = '' then return '{}'::jsonb; end if;

  threshold_value := private.market_family_threshold_v4(question_input, question_input);
  if threshold_value is not null then
    dimension_value := 'threshold'; type_value := 'milestone_thresholds';
  elsif question_value ~ '\m(trailer|teaser|avance|clip|gameplay video)\M' then
    dimension_value := 'official_content'; type_value := 'event_content_options';
  elsif question_value ~ '\m(announce|announc[a-z]*|anunci[a-z]*|reveal[a-z]*|present[a-z]*)\M' then
    dimension_value := 'announcement_date'; type_value := 'deadline_ladder';
  elsif question_value ~ '\m(releas[a-z]*|launch[a-z]*|lanz[a-z]*|saldr[a-z]*|debut|come out)\M' then
    dimension_value := 'release_date'; type_value := 'deadline_ladder';
  elsif question_value ~ '\m(cover|portada|participant|candidato|athlete|atleta|appear[a-z]*|attend[a-z]*|presence|aparec[a-z]*|asist[a-z]*)\M' then
    dimension_value := 'participant'; type_value := 'participant_options';
  elsif question_value ~ '\m(platform|plataforma|playstation|xbox|switch|steam)\M'
        and question_value ~ '\m(version|variant|variante)\M' then
    dimension_value := 'platform'; type_value := 'platform_variants';
  elsif question_value ~ '\m(score|puntuacion|threshold|umbral|views|visualizaciones|copies|copias|ventas|sales)\M' then
    dimension_value := 'threshold'; type_value := 'milestone_thresholds';
  elsif question_value ~ '\m(winner|ganador|award|premio|goty|which|cual|nominee|nominat[a-z]*|nominad[a-z]*|game of the year|juego del ano)\M' then
    dimension_value := 'outcome'; type_value := 'categorical_outcomes';
  else
    dimension_value := 'related'; type_value := 'generic_related';
  end if;

  entity_value := private.market_family_entity_label_v4(
    question_input, title_input, subject_input, dimension_value
  );
  if nullif(entity_value, '') is null then return '{}'::jsonb; end if;
  entity_identity := private.market_family_entity_identity_v4(entity_value);
  if nullif(entity_identity, '') is null then return '{}'::jsonb; end if;

  boundary_value := private.market_family_boundary_v4(
    question_input, cutoff_input, timezone_input, resolution_rules_input
  );
  if boundary_value is not null then
    temporal_child := case
      when coalesce((boundary_value ->> 'identity_ambiguous')::boolean, false) then concat(
        'deadline:ambiguous-timezone:', private.market_family_slug_v4(boundary_value ->> 'timezone', 80),
        ':', private.market_family_slug_v4(boundary_value ->> 'ambiguity_reason', 40),
        ':', boundary_value ->> 'canonical_operator',
        ':', private.market_family_slug_v4(coalesce(
          boundary_value ->> 'canonical_local_instant', boundary_value ->> 'local_instant'
        ), 80),
        ':', boundary_value ->> 'granularity'
      )
      else concat(
        'deadline:', boundary_value ->> 'canonical_operator',
        ':', boundary_value ->> 'canonical_instant',
        ':', boundary_value ->> 'granularity'
      )
    end;
  end if;

  if dimension_value = 'threshold' then
    threshold_value := coalesce(
      private.market_family_threshold_v4(
        yes_label_input,
        coalesce(title_input, '') || ' ' || coalesce(question_input, '') || ' ' || coalesce(resolution_rules_input, '')
      ),
      private.market_family_threshold_v4(question_input, question_input)
    );
  end if;

  if dimension_value = 'official_content' then
    content_kind := case
      when question_value ~ '\mteaser\M' then 'teaser'
      when question_value ~ '\m(clip|avance)\M' then 'clip'
      else 'trailer'
    end;
    duration_value := private.market_family_threshold_v4(
      coalesce(question_input, '') || ' ' || coalesce(resolution_rules_input, ''),
      coalesce(question_input, '') || ' ' || coalesce(resolution_rules_input, '')
    );
    if duration_value ->> 'unit' <> 'seconds'
       or coalesce((duration_value ->> 'value')::numeric, 0) <= 0
       or coalesce((duration_value ->> 'value')::numeric, 0) > 3600
       or (duration_value ->> 'value')::numeric <> trunc((duration_value ->> 'value')::numeric) then
      duration_value := null;
    end if;
    content_invariant := ':' || content_kind || case when duration_value is not null then
      concat(':duration-', duration_value ->> 'operator', '-', duration_value ->> 'value', '-', duration_value ->> 'unit')
      else '' end;
    if boundary_value is not null then type_value := 'deadline_ladder'; end if;
  end if;

  family_key_value := 'atinara:v4:' || entity_identity || ':' || dimension_value || content_invariant;
  if dimension_value = 'official_content' then
    child_key_value := 'content:' || content_kind || ':' || coalesce(
      temporal_child, 'option:' || private.market_family_slug_v4(question_value, 120)
    );
  elsif threshold_value is not null then
    child_key_value := case
      when coalesce((threshold_value ->> 'ambiguous')::boolean, false) then concat(
        'threshold:ambiguous:', private.market_family_slug_v4(threshold_value ->> 'raw_value', 80),
        ':', threshold_value ->> 'unit'
      )
      else concat(
        'threshold:', threshold_value ->> 'operator',
        ':', threshold_value ->> 'value', ':', threshold_value ->> 'unit'
      )
    end;
  elsif nullif(private.market_family_option_slug_v1(yes_label_input, 120), '') is not null
        and private.market_family_option_slug_v1(yes_label_input, 120) not in ('yes', 'si', 'true', 'no')
        and dimension_value in ('outcome', 'participant', 'platform') then
    -- En dimensiones categóricas la opción contractual identifica al hijo.
    -- La frontera temporal ordena y acota la familia, pero no sustituye esa
    -- identidad. Este orden replica familyStructuredChild() de la Edge.
    option_key := private.market_family_option_slug_v1(yes_label_input, 120);
    child_key_value := 'option:' || option_key;
  elsif temporal_child is not null then
    child_key_value := temporal_child;
  else
    child_key_value := 'option:' || private.market_family_slug_v4(question_value, 120);
  end if;

  child_label_value := case
    when nullif(yes_label_input, '') is not null and dimension_value in ('threshold', 'outcome', 'participant', 'platform') then left(trim(yes_label_input), 180)
    when threshold_value is not null and coalesce((threshold_value ->> 'ambiguous')::boolean, false) then concat(
      'Umbral ambiguo ', threshold_value ->> 'raw_value', ' ', threshold_value ->> 'unit'
    )
    when threshold_value is not null then concat(
      'Umbral ', threshold_value ->> 'operator', ' ', threshold_value ->> 'value', ' ', threshold_value ->> 'unit'
    )
    when boundary_value is not null then concat(
      boundary_value ->> 'operator', ' ', coalesce(
        boundary_value ->> 'instant', boundary_value ->> 'local_instant'
      ),
      ' (', coalesce(boundary_value ->> 'timezone_label', boundary_value ->> 'timezone'),
      ', ', boundary_value ->> 'granularity', ')'
    )
    else left(coalesce(question_input, title_input), 180)
  end;

  semantics_value := jsonb_build_object(
    'cumulative', type_value in ('deadline_ladder', 'milestone_thresholds'),
    'mutually_exclusive', type_value = 'categorical_outcomes',
    'parent_is_market', false,
    'aggregate_probability', false,
    'economic_independence', true,
    'entity_label', entity_value
  );
  if dimension_value = 'official_content' then
    semantics_value := semantics_value || jsonb_build_object(
      'content_kind', content_kind,
      'duration_contract', duration_value,
      'temporal_boundary', boundary_value
    );
    if coalesce((boundary_value ->> 'identity_ambiguous')::boolean, false) then
      semantics_value := semantics_value || jsonb_build_object('identity_ambiguous', true);
    end if;
  elsif threshold_value is not null then
    semantics_value := semantics_value || jsonb_build_object('threshold', threshold_value);
    if boundary_value is not null then
      semantics_value := semantics_value || jsonb_build_object('temporal_boundary', boundary_value);
    end if;
    if coalesce((threshold_value ->> 'ambiguous')::boolean, false)
       or coalesce((boundary_value ->> 'identity_ambiguous')::boolean, false) then
      semantics_value := semantics_value || jsonb_build_object('identity_ambiguous', true);
    end if;
  elsif boundary_value is not null then
    semantics_value := semantics_value || jsonb_build_object('temporal_boundary', boundary_value);
    if coalesce((boundary_value ->> 'identity_ambiguous')::boolean, false) then
      semantics_value := semantics_value || jsonb_build_object('identity_ambiguous', true);
    end if;
  end if;

  suffix_parts := regexp_match(entity_value, '^(.*) (i|ii|iii|iv|v|vi|vii|viii|ix|x|xi|xii)$');
  display_entity := case when suffix_parts is not null
    then suffix_parts[1] || ' ' || upper(suffix_parts[2]) else entity_value end;

  return jsonb_build_object(
    'family_key', family_key_value,
    'family_title', case
      when dimension_value = 'official_content' then 'Contenido oficial · '
      when type_value = 'deadline_ladder' and dimension_value = 'announcement_date' then 'Anuncio oficial · '
      when type_value = 'deadline_ladder' then 'Fecha de lanzamiento · '
      when dimension_value = 'threshold' then 'Hitos · '
      else 'Opciones · '
    end || display_entity,
    'family_type', type_value,
    'family_child_key', child_key_value,
    'family_child_label', child_label_value,
    'family_sort_at', coalesce(boundary_value ->> 'canonical_instant', to_char(cutoff_input at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
    'family_relationship', 'standalone',
    'family_semantics', semantics_value,
    'family_source_event_key', nullif(trim(source_event_key_input), ''),
    'family_version', 'atinara-market-family-v4'
  );
end;
$function$;

revoke all on function private.market_family_metadata_v4(
  text,text,text,text,timestamptz,text,text,text
) from public, anon, authenticated, service_role;

create or replace function private.assign_market_candidate_family_v4()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  metadata_value jsonb;
begin
  -- El enlace posterior de la comprobación factual vuelve a escribir el
  -- payload. Si las entradas familiares no cambiaron, conservar la identidad
  -- v4 evita ejecutar por segunda vez todos los parsers de la candidata.
  if tg_op = 'UPDATE'
     and old.family_version = 'atinara-market-family-v4'
     -- La proyección entrante de la Edge forma parte del contrato de paridad.
     -- Si difiere, no se conserva una identidad SQL antigua: se recalcula con
     -- la misma prioridad opción > frontera temporal.
     and old.family_key is not distinct from
       nullif(new.normalized_payload ->> 'family_key', '')
     and old.family_child_key is not distinct from
       nullif(new.normalized_payload ->> 'family_child_key', '')
     and old.family_version is not distinct from
       nullif(new.normalized_payload ->> 'family_version', '')
     and row(
       coalesce(old.normalized_payload ->> 'atinara_question', old.normalized_payload ->> 'source_question'),
       old.normalized_payload ->> 'source_title',
       coalesce(old.normalized_payload ->> 'atinara_subject', old.normalized_payload ->> 'subject'),
       coalesce(old.normalized_payload ->> 'event_group_key', old.external_event_id),
       coalesce(old.normalized_payload ->> 'evaluation_ends_at', old.normalized_payload ->> 'family_cutoff_at'),
       coalesce(
         old.normalized_payload ->> 'evaluation_timezone',
         old.normalized_payload ->> 'timezone',
         old.normalized_payload ->> 'source_timezone',
         old.normalized_payload #>> '{provider_payload,timezone}'
       ),
       old.normalized_payload ->> 'source_resolution_rules',
       coalesce(
         old.normalized_payload #>> '{provider_payload,yes_sub_title}',
         old.normalized_payload ->> 'yes_sub_title'
       )
     ) is not distinct from row(
       coalesce(new.normalized_payload ->> 'atinara_question', new.normalized_payload ->> 'source_question'),
       new.normalized_payload ->> 'source_title',
       coalesce(new.normalized_payload ->> 'atinara_subject', new.normalized_payload ->> 'subject'),
       coalesce(new.normalized_payload ->> 'event_group_key', new.external_event_id),
       coalesce(new.normalized_payload ->> 'evaluation_ends_at', new.normalized_payload ->> 'family_cutoff_at'),
       coalesce(
         new.normalized_payload ->> 'evaluation_timezone',
         new.normalized_payload ->> 'timezone',
         new.normalized_payload ->> 'source_timezone',
         new.normalized_payload #>> '{provider_payload,timezone}'
       ),
       new.normalized_payload ->> 'source_resolution_rules',
       coalesce(
         new.normalized_payload #>> '{provider_payload,yes_sub_title}',
         new.normalized_payload ->> 'yes_sub_title'
       )
     ) then
    new.family_key := old.family_key;
    new.family_title := old.family_title;
    new.family_type := old.family_type;
    new.family_child_key := old.family_child_key;
    new.family_child_label := old.family_child_label;
    new.family_sort_at := old.family_sort_at;
    new.family_relationship := old.family_relationship;
    new.family_semantics := old.family_semantics;
    new.family_source_event_key := old.family_source_event_key;
    new.family_version := old.family_version;
    new.normalized_payload := coalesce(new.normalized_payload, '{}'::jsonb) || jsonb_build_object(
      'family_key', new.family_key,
      'family_title', new.family_title,
      'family_type', new.family_type,
      'family_child_key', new.family_child_key,
      'family_child_label', new.family_child_label,
      'family_sort_at', new.family_sort_at,
      'family_relationship', new.family_relationship,
      'family_semantics', new.family_semantics,
      'family_source_event_key', new.family_source_event_key,
      'family_version', new.family_version
    );
    return new;
  end if;

  metadata_value := private.market_family_metadata_v4(
    coalesce(new.normalized_payload ->> 'atinara_question', new.normalized_payload ->> 'source_question'),
    new.normalized_payload ->> 'source_title',
    coalesce(new.normalized_payload ->> 'atinara_subject', new.normalized_payload ->> 'subject'),
    coalesce(new.normalized_payload ->> 'event_group_key', new.external_event_id),
    private.market_family_safe_timestamptz_v4(coalesce(
      new.normalized_payload ->> 'evaluation_ends_at',
      new.normalized_payload ->> 'family_cutoff_at'
    )),
    coalesce(
      new.normalized_payload ->> 'evaluation_timezone',
      new.normalized_payload ->> 'timezone',
      new.normalized_payload ->> 'source_timezone',
      new.normalized_payload #>> '{provider_payload,timezone}'
    ),
    new.normalized_payload ->> 'source_resolution_rules',
    coalesce(
      new.normalized_payload #>> '{provider_payload,yes_sub_title}',
      new.normalized_payload ->> 'yes_sub_title'
    )
  );

  new.family_key := metadata_value ->> 'family_key';
  new.family_title := metadata_value ->> 'family_title';
  new.family_type := metadata_value ->> 'family_type';
  new.family_child_key := metadata_value ->> 'family_child_key';
  new.family_child_label := metadata_value ->> 'family_child_label';
  new.family_sort_at := private.market_family_safe_timestamptz_v4(metadata_value ->> 'family_sort_at');
  new.family_relationship := 'standalone';
  new.family_semantics := coalesce(metadata_value -> 'family_semantics', '{}'::jsonb);
  new.family_source_event_key := metadata_value ->> 'family_source_event_key';
  new.family_version := metadata_value ->> 'family_version';
  new.normalized_payload := coalesce(new.normalized_payload, '{}'::jsonb) || jsonb_build_object(
    'family_key', new.family_key,
    'family_title', new.family_title,
    'family_type', new.family_type,
    'family_child_key', new.family_child_key,
    'family_child_label', new.family_child_label,
    'family_sort_at', new.family_sort_at,
    'family_relationship', new.family_relationship,
    'family_semantics', new.family_semantics,
    'family_source_event_key', new.family_source_event_key,
    'family_version', new.family_version
  );
  return new;
end;
$function$;

revoke all on function private.assign_market_candidate_family_v4()
  from public, anon, authenticated, service_role;

comment on function private.assign_market_candidate_family_v4() is
  'Proyecta identidad v4 y solo reutiliza la anterior cuando coincide con la proyeccion entrante de la Edge.';

create or replace function private.market_family_origin_projection_v1(
  radar_candidate_id_input uuid,
  market_id_input text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  result jsonb;
  active_slug_matches integer;
begin
  if radar_candidate_id_input is not null and market_id_input is not null then
    raise exception 'RADAR_FAMILY_ORIGIN_AMBIGUOUS' using errcode = '22023';
  end if;

  if radar_candidate_id_input is not null then
    select jsonb_build_object(
      'family_key', candidate.family_key,
      'family_title', candidate.family_title,
      'family_type', candidate.family_type,
      'family_child_key', candidate.family_child_key,
      'family_child_label', candidate.family_child_label,
      'family_sort_at', candidate.family_sort_at,
      'family_relationship', 'standalone',
      'family_semantics', coalesce(candidate.family_semantics, '{}'::jsonb),
      'family_source_event_key', candidate.family_source_event_key,
      'family_version', candidate.family_version
    )
    into result
    from private.external_market_candidates candidate
    where candidate.id = radar_candidate_id_input
      and candidate.family_version = 'atinara-market-family-v4'
      and candidate.family_key is not null
      and candidate.family_child_key is not null;
  elsif market_id_input is not null then
    -- Tras publicar, market_id es la referencia inequívoca. Durante el BEFORE
    -- INSERT del mercado aún no se ha fijado en el borrador: en ese intervalo
    -- solo son candidatas las intenciones publicables y una colisión activa
    -- del mismo slug falla cerrada en vez de elegir un borrador arbitrario.
    select jsonb_build_object(
      'family_key', draft.family_key,
      'family_title', draft.family_title,
      'family_type', draft.family_type,
      'family_child_key', draft.family_child_key,
      'family_child_label', draft.family_child_label,
      'family_sort_at', draft.family_sort_at,
      'family_relationship', 'standalone',
      'family_semantics', coalesce(draft.family_semantics, '{}'::jsonb),
      'family_source_event_key', draft.family_source_event_key,
      'family_version', draft.family_version
    )
    into result
    from private.market_drafts draft
    where draft.market_id = market_id_input
      and draft.family_version = 'atinara-market-family-v4'
      and draft.family_key is not null
      and draft.family_child_key is not null
    limit 1;

    if result is null then
      -- El recuento y la proyección proceden de la misma instantánea. Así una
      -- intención concurrente no puede aparecer entre un COUNT y la elección.
      select count(*)::integer,
             jsonb_agg(
               jsonb_build_object(
                 'family_key', draft.family_key,
                 'family_title', draft.family_title,
                 'family_type', draft.family_type,
                 'family_child_key', draft.family_child_key,
                 'family_child_label', draft.family_child_label,
                 'family_sort_at', draft.family_sort_at,
                 'family_relationship', 'standalone',
                 'family_semantics', coalesce(draft.family_semantics, '{}'::jsonb),
                 'family_source_event_key', draft.family_source_event_key,
                 'family_version', draft.family_version
               ) order by draft.updated_at desc, draft.created_at desc, draft.id desc
             ) -> 0
      into active_slug_matches, result
      from private.market_drafts draft
      where draft.market_id is null
        and draft.market_slug = market_id_input
        and draft.workflow_status in ('human_confirmed', 'scheduled')
        and draft.family_version = 'atinara-market-family-v4'
        and draft.family_key is not null
        and draft.family_child_key is not null;

      if active_slug_matches > 1 then
        raise exception 'RADAR_FAMILY_ORIGIN_AMBIGUOUS' using errcode = '22023';
      end if;
    end if;
  end if;
  return result;
end;
$function$;

revoke all on function private.market_family_origin_projection_v1(uuid,text)
  from public, anon, authenticated, service_role;

comment on function private.market_family_origin_projection_v1(uuid,text) is
  'Proyecta la identidad v4 autoritativa candidata->borrador->mercado; prioriza market_id y falla cerrada ante slugs activos ambiguos.';

create or replace function private.assign_market_draft_family_v4()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  metadata_value jsonb;
  origin_value jsonb;
begin
  origin_value := private.market_family_origin_projection_v1(
    new.radar_candidate_id, null
  );
  if origin_value is not null then
    new.family_key := origin_value ->> 'family_key';
    new.family_title := origin_value ->> 'family_title';
    new.family_type := origin_value ->> 'family_type';
    new.family_child_key := origin_value ->> 'family_child_key';
    new.family_child_label := origin_value ->> 'family_child_label';
    new.family_sort_at := private.market_family_safe_timestamptz_v4(
      origin_value ->> 'family_sort_at'
    );
    new.family_relationship := 'standalone';
    new.family_semantics := coalesce(origin_value -> 'family_semantics', '{}'::jsonb);
    new.family_source_event_key := origin_value ->> 'family_source_event_key';
    new.family_version := origin_value ->> 'family_version';
    return new;
  end if;

  metadata_value := private.market_family_metadata_v4(
    new.question, null, new.subject,
    coalesce(new.source_provenance ->> 'event_group_key', new.family_source_event_key),
    new.evaluation_ends_at, new.timezone,
    concat_ws(' ', new.yes_criteria, new.no_criteria, new.edge_cases), null
  );
  if new.workflow_status not in ('cancelled', 'annulled')
     and coalesce((metadata_value #>> '{family_semantics,identity_ambiguous}')::boolean, false) then
    raise exception 'FAMILY_IDENTITY_AMBIGUOUS' using errcode = '23514';
  end if;
  new.family_key := metadata_value ->> 'family_key';
  new.family_title := metadata_value ->> 'family_title';
  new.family_type := metadata_value ->> 'family_type';
  new.family_child_key := metadata_value ->> 'family_child_key';
  new.family_child_label := metadata_value ->> 'family_child_label';
  new.family_sort_at := private.market_family_safe_timestamptz_v4(metadata_value ->> 'family_sort_at');
  new.family_relationship := 'standalone';
  new.family_semantics := coalesce(metadata_value -> 'family_semantics', '{}'::jsonb);
  new.family_source_event_key := metadata_value ->> 'family_source_event_key';
  new.family_version := metadata_value ->> 'family_version';
  return new;
end;
$function$;

revoke all on function private.assign_market_draft_family_v4()
  from public, anon, authenticated, service_role;

comment on function private.assign_market_draft_family_v4() is
  'Conserva la identidad v4 de la candidata Radar; los borradores manuales mantienen derivacion determinista.';

create or replace function private.assign_public_market_family_v4()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  metadata_value jsonb;
  origin_value jsonb;
begin
  origin_value := private.market_family_origin_projection_v1(null, new.id);
  if origin_value is not null then
    new.family_key := origin_value ->> 'family_key';
    new.family_title := origin_value ->> 'family_title';
    new.family_type := origin_value ->> 'family_type';
    new.family_child_key := origin_value ->> 'family_child_key';
    new.family_child_label := origin_value ->> 'family_child_label';
    new.family_sort_at := private.market_family_safe_timestamptz_v4(
      origin_value ->> 'family_sort_at'
    );
    new.family_relationship := 'standalone';
    new.family_semantics := coalesce(origin_value -> 'family_semantics', '{}'::jsonb);
    new.family_source_event_key := origin_value ->> 'family_source_event_key';
    new.family_version := origin_value ->> 'family_version';
    return new;
  end if;

  metadata_value := private.market_family_metadata_v4(
    new.question, null, null, new.family_source_event_key,
    new.evaluation_ends_at, new.evaluation_timezone, null, null
  );
  if coalesce((metadata_value #>> '{family_semantics,identity_ambiguous}')::boolean, false) then
    raise exception 'FAMILY_IDENTITY_AMBIGUOUS' using errcode = '23514';
  end if;
  new.family_key := metadata_value ->> 'family_key';
  new.family_title := metadata_value ->> 'family_title';
  new.family_type := metadata_value ->> 'family_type';
  new.family_child_key := metadata_value ->> 'family_child_key';
  new.family_child_label := metadata_value ->> 'family_child_label';
  new.family_sort_at := private.market_family_safe_timestamptz_v4(metadata_value ->> 'family_sort_at');
  new.family_relationship := 'standalone';
  new.family_semantics := coalesce(metadata_value -> 'family_semantics', '{}'::jsonb);
  new.family_source_event_key := metadata_value ->> 'family_source_event_key';
  new.family_version := metadata_value ->> 'family_version';
  return new;
end;
$function$;

revoke all on function private.assign_public_market_family_v4()
  from public, anon, authenticated, service_role;

comment on function private.assign_public_market_family_v4() is
  'Materializa la identidad v4 del borrador de origen; conserva derivacion para mercados no procedentes de borrador.';

create or replace function private.market_radar_candidate_horizon_at_v1(
  candidate_input private.external_market_candidates
)
returns timestamptz
language sql
stable
set search_path = ''
as $function$
  select coalesce(
    case
      -- gt/gte describe el inicio de una ventana, no su cierre. Usar esa
      -- frontera como horizonte ocultaría una proposición aún abierta.
      when coalesce(
        candidate_input.family_semantics #>> '{temporal_boundary,canonical_operator}',
        candidate_input.normalized_payload #>> '{family_semantics,temporal_boundary,canonical_operator}',
        candidate_input.family_semantics #>> '{temporal_boundary,operator}',
        candidate_input.normalized_payload #>> '{family_semantics,temporal_boundary,operator}'
      ) in ('gt', 'gte') then null
      else candidate_input.family_sort_at
    end,
    private.market_family_safe_timestamptz_v4(
      candidate_input.normalized_payload ->> 'evaluation_ends_at'
    ),
    private.market_family_safe_timestamptz_v4(
      candidate_input.normalized_payload ->> 'family_cutoff_at'
    ),
    private.market_family_safe_timestamptz_v4(
      candidate_input.normalized_payload ->> 'atinara_closes_at'
    ),
    private.market_family_safe_timestamptz_v4(
      candidate_input.normalized_payload ->> 'source_close_at'
    )
  );
$function$;

revoke all on function private.market_radar_candidate_horizon_at_v1(
  private.external_market_candidates
) from public, anon, authenticated, service_role;

comment on function private.market_radar_candidate_horizon_at_v1(
  private.external_market_candidates
) is
  'Fin predictivo efectivo: frontera familiar superior/exacta, evaluacion o cierre; gt/gte son inicios y no cierres.';

create or replace function public.list_market_radar_candidates_v2(
  provider_filter text default null,
  category_filter text default null,
  quality_filter text default null,
  query_filter text default null,
  order_key text default 'recommended',
  horizon_filter text default '180d',
  limit_count integer default 240,
  offset_count integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  result jsonb;
  checked_at_value timestamptz := now();
begin
  perform private.require_current_admin();
  if provider_filter is not null and provider_filter <> ''
     and provider_filter not in ('polymarket', 'kalshi', 'tavily') then
    raise exception 'INVALID_RADAR_PROVIDER' using errcode = '22023';
  end if;
  if order_key not in ('recommended', 'popularity', 'closing', 'recent') then
    raise exception 'INVALID_RADAR_ORDER' using errcode = '22023';
  end if;
  if quality_filter is not null and quality_filter <> ''
     and quality_filter not in ('fit', 'review', 'rejected', 'all') then
    raise exception 'INVALID_RADAR_QUALITY' using errcode = '22023';
  end if;
  if horizon_filter not in ('30d', '90d', '180d', '365d') then
    raise exception 'INVALID_RADAR_HORIZON' using errcode = '22023';
  end if;

  select coalesce(jsonb_agg(private.market_radar_eligibility_payload(candidate_row)), '[]'::jsonb)
  into result
  from (
    select candidate.*
    from private.external_market_candidates candidate
    join private.market_radar_eligibility_checks eligibility
      on eligibility.id = candidate.current_eligibility_check_id
     and eligibility.candidate_id = candidate.id
    cross join lateral (
      select private.market_radar_candidate_horizon_at_v1(candidate) as horizon_at
    ) horizon
    where candidate.normalizer_version = 'atinara-radar-v2'
      and candidate.family_version = 'atinara-market-family-v4'
      and candidate.family_key is not null
      and candidate.family_child_key is not null
      and candidate.state = 'available'
      and candidate.verification_status = 'verified_open'
      and candidate.quality_status <> 'rejected'
      and candidate.eligibility_policy_version = 'atinara-prediction-policy-v5'
      and candidate.eligibility_status = 'eligible'
      and eligibility.policy_version = candidate.eligibility_policy_version
      and eligibility.status = candidate.eligibility_status
      and eligibility.checked_at = candidate.eligibility_checked_at
      and eligibility.expires_at = candidate.eligibility_expires_at
      and eligibility.expires_at > checked_at_value
      and not exists (
        select 1 from public.markets market_alias
        where market_alias.family_key = candidate.family_key
          and market_alias.family_child_key = candidate.family_child_key
      )
      and not exists (
        select 1 from private.market_drafts draft_alias
        where (
          draft_alias.radar_candidate_id = candidate.id
          or (
            draft_alias.family_key = candidate.family_key
            and draft_alias.family_child_key = candidate.family_child_key
          )
        )
        and draft_alias.workflow_status not in ('cancelled', 'annulled')
      )
      and (
        horizon.horizon_at is null
        or (
          horizon.horizon_at > checked_at_value
          and horizon.horizon_at <= checked_at_value + case horizon_filter
            when '30d' then interval '30 days'
            when '90d' then interval '90 days'
            when '365d' then interval '365 days'
            else interval '180 days'
          end
        )
      )
      and (provider_filter is null or provider_filter = '' or candidate.provider = provider_filter)
      and (category_filter is null or category_filter = '' or candidate.atinara_category = category_filter)
      and (quality_filter is null or quality_filter in ('', 'all', 'review', 'fit'))
      and (
        query_filter is null or query_filter = ''
        or candidate.normalized_payload ->> 'source_title' ilike '%' || query_filter || '%'
        or candidate.normalized_payload ->> 'source_question' ilike '%' || query_filter || '%'
        or candidate.normalized_payload ->> 'atinara_question' ilike '%' || query_filter || '%'
      )
    order by
      case when order_key = 'recommended' then candidate.quality_score end desc nulls last,
      case when order_key = 'popularity' then coalesce((candidate.normalized_payload ->> 'source_volume_total')::numeric, 0) end desc nulls last,
      case when order_key = 'closing' then horizon.horizon_at end asc nulls last,
      case when order_key = 'recent' then coalesce(candidate.source_updated_at, candidate.fetched_at) end desc nulls last,
      candidate.quality_score desc,
      candidate.fetched_at desc
    limit least(greatest(coalesce(limit_count, 240), 1), 500)
    offset greatest(coalesce(offset_count, 0), 0)
  ) candidate_row;
  return result;
end;
$function$;

revoke all on function public.list_market_radar_candidates_v2(
  text,text,text,text,text,text,integer,integer
) from public, anon, authenticated, service_role;
grant execute on function public.list_market_radar_candidates_v2(
  text,text,text,text,text,text,integer,integer
) to authenticated;

do $postflight$
declare
  option_family jsonb;
  deadline_family jsonb;
begin
  if private.market_family_option_slug_v1(U&'Pok\00E9mon', 120)
       is distinct from 'pokemon'
     or private.market_family_option_slug_v1(U&'Poke\0301mon', 120)
       is distinct from 'pokemon'
     or private.market_family_option_slug_v1(U&'\0130stanbul', 120)
       is distinct from 'istanbul'
     or private.market_family_option_slug_v1('---', 120)
       is distinct from ''
     or has_function_privilege(
       'authenticated',
       'private.market_family_option_slug_v1(text,integer)',
       'EXECUTE'
     )
     or has_function_privilege(
       'service_role',
       'private.market_family_option_slug_v1(text,integer)',
       'EXECUTE'
     ) then
    raise exception 'RADAR_FAMILY_OPTION_SLUG_CONTRACT_FAILED';
  end if;

  option_family := private.market_family_metadata_v4(
    '2026 Game of the Year?',
    'The Game Awards: 2026 Game of the Year',
    null,
    'kalshi:KXGAMEAWARDS-2026',
    null,
    null,
    'Resolves Yes if Half-Life 3 wins 2026 Game of the Year before the end of 2026.',
    'Half-Life 3'
  );
  if option_family ->> 'family_child_key' is distinct from 'option:half-life-3'
     or option_family ->> 'family_child_label' is distinct from 'Half-Life 3'
     or option_family ->> 'family_type' is distinct from 'categorical_outcomes'
     or option_family ->> 'family_sort_at' is distinct from '2027-01-01T00:00:00.000Z' then
    raise exception 'RADAR_FAMILY_OPTION_PARITY_FAILED';
  end if;

  deadline_family := private.market_family_metadata_v4(
    'Will GTA VI be released before October 1, 2026?',
    'Grand Theft Auto VI release',
    null,
    'fixture:gta-vi',
    null,
    'UTC',
    null,
    null
  );
  if deadline_family ->> 'family_child_key'
       is distinct from 'deadline:lt:2026-10-01T00:00:00.000Z:day' then
    raise exception 'RADAR_FAMILY_DEADLINE_COMPATIBILITY_FAILED';
  end if;

  if to_regprocedure(
    'private.market_radar_candidate_horizon_at_v1(private.external_market_candidates)'
  ) is null then
    raise exception 'RADAR_HORIZON_PROJECTION_MISSING';
  end if;
end;
$postflight$;

comment on function private.market_family_metadata_v4(
  text,text,text,text,timestamptz,text,text,text
) is
  'Identidad contractual v4 alineada con la Edge: opciones estructuradas prevalecen sobre fronteras temporales como child key.';

comment on function public.list_market_radar_candidates_v2(
  text,text,text,text,text,text,integer,integer
) is
  'Lista privada de Radar con elegibilidad vigente, identidad v4 y horizonte predictivo canonico.';

commit;
