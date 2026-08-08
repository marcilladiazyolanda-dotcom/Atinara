begin;

create or replace function private.market_family_threshold_key(value_input text)
returns text
language plpgsql
immutable
set search_path = ''
as $function$
declare
  value_normalized text := private.market_family_normalize(value_input);
  parts text[];
begin
  parts := regexp_match(
    value_normalized,
    '(?:at least|al menos|more than|mas de|over|above|below|under|fewer than|less than|threshold|umbral) (?:los? )?([0-9]+)(?: ([a-z%]+))?'
  );
  if parts is null then
    parts := regexp_match(
      value_normalized,
      '(?:reach[a-z]*|alcanz[a-z]*|exceed[a-z]*|super[a-z]*) [^0-9]*([0-9]+)(?: ([a-z%]+))?'
    );
  end if;
  if parts is null then return null; end if;
  return parts[1] || case when coalesce(parts[2], '') <> '' then ':' || parts[2] else '' end;
end;
$function$;

create or replace function private.market_family_entity(
  question_input text,
  title_input text,
  dimension_input text
)
returns text
language plpgsql
immutable
set search_path = ''
as $function$
declare
  question_normalized text := private.market_family_normalize(question_input);
  title_normalized text := private.market_family_normalize(title_input);
  entity_value text;
  content_parts text[];
begin
  if title_normalized <> ''
     and title_normalized is distinct from question_normalized
     and title_normalized !~ '^(will|whether|can|could|is|are|se|sera|seran) ' then
    entity_value := regexp_replace(
      title_normalized,
      '\m(release date|fecha de lanzamiento|official content|contenido oficial)\M',
      ' ',
      'g'
    );
    entity_value := trim(regexp_replace(entity_value, '\s+', ' ', 'g'));
    if length(entity_value) >= 3 then return left(entity_value, 120); end if;
  end if;

  entity_value := regexp_replace(
    question_normalized,
    '^(will|whether|can|could|is|are|se|sera|seran) ',
    ''
  );
  entity_value := regexp_replace(entity_value, '^(a|an|the|la|el|los|las|un|una) ', '');
  entity_value := regexp_replace(
    entity_value,
    '^(announce[a-z]*|anunci[a-z]*|reveal[a-z]*|present[a-z]*|release[a-z]*|launch[a-z]*|lanz[a-z]*|public[a-z]*|reach[a-z]*|alcanz[a-z]*|exceed[a-z]*|super[a-z]*) (officially |oficialmente )?(a |an |the |la |el |los |las |un |una )?',
    ''
  );
  entity_value := regexp_replace(entity_value, '^(officially|oficialmente) ', '');

  if dimension_input = 'official_content' then
    content_parts := regexp_match(
      entity_value,
      '(?:new |nuevo |nueva |another )?(trailer|teaser|avance|clip)(?: official| oficial)? (?:of|de) (.+?)(?: (?:before|antes de|antes del|by)\M|$)'
    );
    if content_parts is not null and coalesce(content_parts[2], '') <> '' then
      entity_value := content_parts[2];
    else
      entity_value := regexp_replace(
        entity_value,
        '\m(new|nuevo|nueva|another|official|oficial|trailer|teaser|avance|clip)\M',
        ' ',
        'g'
      );
      entity_value := regexp_replace(entity_value, '^\s*(of|de)\s+', '');
    end if;
  end if;

  entity_value := regexp_replace(
    entity_value,
    ' (will|be|is|sera|seran|se|before|antes|by|para|release[a-z]*|launch[a-z]*|lanz[a-z]*|announce[a-z]*|anunci[a-z]*|public[a-z]*|come out|nominat[a-z]*|nominad[a-z]*|win[a-z]*|gan[a-z]*|reach[a-z]*|alcanz[a-z]*|exceed[a-z]*|super[a-z]*|appear[a-z]*|aparec[a-z]*|attend[a-z]*|asist[a-z]*).*$',''
  );
  entity_value := regexp_replace(entity_value, ' (los?|las?) [0-9].*$', '');
  entity_value := regexp_replace(
    entity_value,
    '\m(release date|fecha de lanzamiento|official content|contenido oficial)\M',
    ' ',
    'g'
  );
  entity_value := trim(regexp_replace(entity_value, '\s+', ' ', 'g'));

  if length(entity_value) < 3 and title_normalized <> '' then
    entity_value := trim(regexp_replace(
      split_part(title_normalized, ':', 1),
      '\m(release date|fecha de lanzamiento|official content|contenido oficial)\M',
      ' ',
      'g'
    ));
  end if;
  return nullif(left(entity_value, 120), '');
end;
$function$;

create or replace function private.market_family_metadata(
  question_input text,
  title_input text default null,
  source_event_key_input text default null,
  sort_at_input timestamptz default null
)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $function$
declare
  question_normalized text := private.market_family_normalize(coalesce(question_input, title_input));
  entity_value text;
  dimension_value text;
  type_value text;
  deadline_value text;
  threshold_value text;
  child_value text;
  child_label_value text;
  family_key_value text;
  semantics_value jsonb;
  platform_value text;
begin
  if question_normalized = '' then return '{}'::jsonb; end if;

  if question_normalized ~ '\m(trailer|teaser|avance|clip|gameplay video)\M' then
    dimension_value := 'official_content'; type_value := 'event_content_options';
  elsif question_normalized ~ '\m(announce|announced|announcement|anunci|reveal|present)[a-z]*' then
    dimension_value := 'announcement_date'; type_value := 'deadline_ladder';
  elsif question_normalized ~ '\m(release|released|launch|lanz|saldr|debut)[a-z]*' then
    dimension_value := 'release_date'; type_value := 'deadline_ladder';
  elsif question_normalized ~ '\m(cover|portada|participant|candidato|athlete|atleta|appear|attend|presence|aparec|asist)[a-z]*' then
    dimension_value := 'participant'; type_value := 'participant_options';
  elsif question_normalized ~ '\m(platform|plataforma|playstation|xbox|switch|steam)\M'
        and question_normalized ~ '\m(version|variant|variante)\M' then
    dimension_value := 'platform'; type_value := 'platform_variants';
  elsif question_normalized ~ '\m(at least|al menos|more than|mas de|over|above|below|under|fewer than|less than|score|puntuacion|threshold|umbral|reach|alcanz|exceed|super)[a-z]*' then
    dimension_value := 'threshold'; type_value := 'milestone_thresholds';
  elsif question_normalized ~ '\m(winner|ganador|award|premio|goty|which|cual|nominee|nominat|nominad|game of the year|juego del ano)[a-z]*' then
    dimension_value := 'outcome'; type_value := 'categorical_outcomes';
  else
    dimension_value := 'related'; type_value := 'generic_related';
  end if;

  entity_value := private.market_family_entity(question_input, title_input, dimension_value);
  if entity_value is null or length(entity_value) < 3 then return '{}'::jsonb; end if;

  deadline_value := private.market_family_deadline_key(question_normalized);
  threshold_value := case when dimension_value = 'threshold'
    then private.market_family_threshold_key(question_normalized)
    else null
  end;
  platform_value := (regexp_match(question_normalized, '\m(playstation|xbox|switch|steam)\M'))[1];
  family_key_value := 'atinara:v1:'
    || trim(both '-' from regexp_replace(left(entity_value, 100), '[^a-z0-9]+', '-', 'g'))
    || ':' || dimension_value;

  if dimension_value = 'official_content' then
    child_value := 'content:' || case
      when question_normalized ~ '\mteaser\M' then 'teaser'
      when question_normalized ~ '\m(clip|avance)\M' then 'clip'
      else 'trailer'
    end || ':' || coalesce(deadline_value, md5(question_normalized));
  elsif threshold_value is not null then
    child_value := 'threshold:' || threshold_value;
  elsif dimension_value = 'platform' and platform_value is not null then
    child_value := 'platform:' || platform_value;
  elsif deadline_value is not null then
    child_value := 'deadline:' || deadline_value;
  else
    child_value := 'option:' || md5(question_normalized);
  end if;

  child_label_value := case
    when threshold_value is not null then 'Umbral ' || replace(threshold_value, ':', ' ')
    when deadline_value is not null then 'Hasta ' || deadline_value
    else left(coalesce(question_input, title_input), 180)
  end;
  semantics_value := case
    when type_value in ('deadline_ladder', 'milestone_thresholds') then
      jsonb_build_object(
        'cumulative', true, 'mutually_exclusive', false, 'parent_is_market', false,
        'aggregate_probability', false, 'economic_independence', true
      )
    else jsonb_build_object(
      'cumulative', false, 'mutually_exclusive', type_value = 'categorical_outcomes',
      'parent_is_market', false, 'aggregate_probability', false, 'economic_independence', true
    )
  end;

  return jsonb_build_object(
    'family_key', family_key_value,
    'family_title', case
      when dimension_value = 'release_date' then 'Fecha de lanzamiento · '
      when dimension_value = 'announcement_date' then 'Anuncio oficial · '
      when dimension_value = 'official_content' then 'Contenido oficial · '
      when dimension_value = 'threshold' then 'Hitos · '
      else 'Opciones · '
    end || initcap(entity_value),
    'family_type', type_value,
    'family_child_key', child_value,
    'family_child_label', child_label_value,
    'family_sort_at', coalesce(
      case when deadline_value is not null then (deadline_value || ' 23:59:59+00')::timestamptz else null end,
      sort_at_input
    ),
    'family_relationship', 'standalone',
    'family_semantics', semantics_value,
    'family_source_event_key', nullif(trim(source_event_key_input), ''),
    'family_version', 'atinara-market-family-v1'
  );
end;
$function$;

revoke all on function private.market_family_threshold_key(text) from public, anon, authenticated;
revoke all on function private.market_family_entity(text,text,text) from public, anon, authenticated;
revoke all on function private.market_family_metadata(text,text,text,timestamptz) from public, anon, authenticated;

comment on function private.market_family_metadata(text,text,text,timestamptz) is
  'Derivación genérica de entidad, dimensión e hijo; independiente de proveedor y sin reglas por nombre propio.';

commit;
