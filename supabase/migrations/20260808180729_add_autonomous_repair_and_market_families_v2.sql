-- Corrector Autónomo y familias de mercados.
-- Esta migración no publica, confirma, resuelve ni modifica economía, Karma o Prestigio.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';

alter table private.external_market_candidates
  add column if not exists family_key text,
  add column if not exists family_title text,
  add column if not exists family_type text,
  add column if not exists family_child_key text,
  add column if not exists family_child_label text,
  add column if not exists family_sort_at timestamptz,
  add column if not exists family_relationship text,
  add column if not exists family_semantics jsonb not null default '{}'::jsonb,
  add column if not exists family_source_event_key text,
  add column if not exists family_version text;

alter table private.market_drafts
  add column if not exists family_key text,
  add column if not exists family_title text,
  add column if not exists family_type text,
  add column if not exists family_child_key text,
  add column if not exists family_child_label text,
  add column if not exists family_sort_at timestamptz,
  add column if not exists family_relationship text,
  add column if not exists family_semantics jsonb not null default '{}'::jsonb,
  add column if not exists family_source_event_key text,
  add column if not exists family_version text;

alter table public.markets
  add column if not exists family_key text,
  add column if not exists family_title text,
  add column if not exists family_type text,
  add column if not exists family_child_key text,
  add column if not exists family_child_label text,
  add column if not exists family_sort_at timestamptz,
  add column if not exists family_relationship text,
  add column if not exists family_semantics jsonb not null default '{}'::jsonb,
  add column if not exists family_source_event_key text,
  add column if not exists family_version text;

alter table private.external_market_candidates
  add constraint external_market_candidates_family_type_check check (
    family_type is null or family_type in (
      'deadline_ladder', 'categorical_outcomes', 'milestone_thresholds',
      'platform_variants', 'participant_options', 'event_content_options', 'generic_related'
    )
  ),
  add constraint external_market_candidates_family_relationship_check check (
    family_relationship is null or family_relationship in (
      'standalone', 'sibling', 'exact_duplicate', 'semantic_duplicate', 'parent_reference'
    )
  ),
  add constraint external_market_candidates_family_semantics_check check (jsonb_typeof(family_semantics) = 'object');

alter table private.market_drafts
  add constraint market_drafts_family_type_check check (
    family_type is null or family_type in (
      'deadline_ladder', 'categorical_outcomes', 'milestone_thresholds',
      'platform_variants', 'participant_options', 'event_content_options', 'generic_related'
    )
  ),
  add constraint market_drafts_family_relationship_check check (
    family_relationship is null or family_relationship in (
      'standalone', 'sibling', 'exact_duplicate', 'semantic_duplicate', 'parent_reference'
    )
  ),
  add constraint market_drafts_family_semantics_check check (jsonb_typeof(family_semantics) = 'object');

alter table public.markets
  add constraint markets_family_type_check check (
    family_type is null or family_type in (
      'deadline_ladder', 'categorical_outcomes', 'milestone_thresholds',
      'platform_variants', 'participant_options', 'event_content_options', 'generic_related'
    )
  ),
  add constraint markets_family_relationship_check check (
    family_relationship is null or family_relationship in (
      'standalone', 'sibling', 'exact_duplicate', 'semantic_duplicate', 'parent_reference'
    )
  ),
  add constraint markets_family_semantics_check check (jsonb_typeof(family_semantics) = 'object');

create index if not exists external_market_candidates_family_idx
  on private.external_market_candidates(family_key, family_sort_at, family_child_key)
  where family_key is not null;
create index if not exists market_drafts_family_idx
  on private.market_drafts(family_key, family_sort_at, family_child_key)
  where family_key is not null;
create index if not exists markets_family_idx
  on public.markets(family_key, family_sort_at, family_child_key)
  where family_key is not null;

create or replace function private.market_family_normalize(value_input text)
returns text
language sql
immutable
set search_path = ''
as $function$
  select trim(regexp_replace(
    translate(lower(coalesce(value_input, '')), 'áéíóúüñ', 'aeiouun'),
    '[^a-z0-9]+', ' ', 'g'
  ));
$function$;

create or replace function private.market_family_deadline_key(value_input text)
returns text
language plpgsql
immutable
set search_path = ''
as $function$
declare
  value_normalized text := private.market_family_normalize(value_input);
  parts text[];
  month_value integer;
  day_value integer;
  year_value integer;
  boundary_date date;
begin
  parts := regexp_match(value_normalized, '(?:before|antes de|antes del) ([0-9]{1,2}) (?:de )?([a-z]+) (?:de )?(20[0-9]{2})');
  if parts is not null then
    day_value := parts[1]::integer;
    year_value := parts[3]::integer;
    month_value := case parts[2]
      when 'january' then 1 when 'enero' then 1
      when 'february' then 2 when 'febrero' then 2
      when 'march' then 3 when 'marzo' then 3
      when 'april' then 4 when 'abril' then 4
      when 'may' then 5 when 'mayo' then 5
      when 'june' then 6 when 'junio' then 6
      when 'july' then 7 when 'julio' then 7
      when 'august' then 8 when 'agosto' then 8
      when 'september' then 9 when 'septiembre' then 9 when 'setiembre' then 9
      when 'october' then 10 when 'octubre' then 10
      when 'november' then 11 when 'noviembre' then 11
      when 'december' then 12 when 'diciembre' then 12
      else null
    end;
    if month_value is not null then
      boundary_date := make_date(year_value, month_value, day_value);
      return to_char(case when day_value = 1 then boundary_date - 1 else boundary_date end, 'YYYY-MM-DD');
    end if;
  end if;

  parts := regexp_match(value_normalized, '\m([0-9]{1,2}) (?:de )?([a-z]+) (?:de )?(20[0-9]{2})\M');
  if parts is not null then
    day_value := parts[1]::integer;
    year_value := parts[3]::integer;
    month_value := case parts[2]
      when 'january' then 1 when 'enero' then 1
      when 'february' then 2 when 'febrero' then 2
      when 'march' then 3 when 'marzo' then 3
      when 'april' then 4 when 'abril' then 4
      when 'may' then 5 when 'mayo' then 5
      when 'june' then 6 when 'junio' then 6
      when 'july' then 7 when 'julio' then 7
      when 'august' then 8 when 'agosto' then 8
      when 'september' then 9 when 'septiembre' then 9 when 'setiembre' then 9
      when 'october' then 10 when 'octubre' then 10
      when 'november' then 11 when 'noviembre' then 11
      when 'december' then 12 when 'diciembre' then 12
      else null
    end;
    if month_value is not null then return to_char(make_date(year_value, month_value, day_value), 'YYYY-MM-DD'); end if;
  end if;

  parts := regexp_match(value_normalized, '(?:before )?([a-z]+) ([0-9]{1,2}) (20[0-9]{2})');
  if parts is not null then
    month_value := case parts[1]
      when 'january' then 1 when 'enero' then 1
      when 'february' then 2 when 'febrero' then 2
      when 'march' then 3 when 'marzo' then 3
      when 'april' then 4 when 'abril' then 4
      when 'may' then 5 when 'mayo' then 5
      when 'june' then 6 when 'junio' then 6
      when 'july' then 7 when 'julio' then 7
      when 'august' then 8 when 'agosto' then 8
      when 'september' then 9 when 'septiembre' then 9 when 'setiembre' then 9
      when 'october' then 10 when 'octubre' then 10
      when 'november' then 11 when 'noviembre' then 11
      when 'december' then 12 when 'diciembre' then 12
      else null
    end;
    day_value := parts[2]::integer;
    year_value := parts[3]::integer;
    if month_value is not null then
      boundary_date := make_date(year_value, month_value, day_value);
      return to_char(case when value_normalized ~ '\mbefore\M' and day_value = 1 then boundary_date - 1 else boundary_date end, 'YYYY-MM-DD');
    end if;
  end if;

  parts := regexp_match(value_normalized, '(?:before|antes de) ([a-z]+) (?:de )?(20[0-9]{2})');
  if parts is not null then
    month_value := case parts[1]
      when 'january' then 1 when 'enero' then 1
      when 'february' then 2 when 'febrero' then 2
      when 'march' then 3 when 'marzo' then 3
      when 'april' then 4 when 'abril' then 4
      when 'may' then 5 when 'mayo' then 5
      when 'june' then 6 when 'junio' then 6
      when 'july' then 7 when 'julio' then 7
      when 'august' then 8 when 'agosto' then 8
      when 'september' then 9 when 'septiembre' then 9 when 'setiembre' then 9
      when 'october' then 10 when 'octubre' then 10
      when 'november' then 11 when 'noviembre' then 11
      when 'december' then 12 when 'diciembre' then 12
      else null
    end;
    if month_value is not null then
      return to_char(make_date(parts[2]::integer, month_value, 1) - 1, 'YYYY-MM-DD');
    end if;
  end if;

  parts := regexp_match(value_normalized, '(?:before|antes de) (20[0-9]{2})\M');
  if parts is not null then return (parts[1]::integer - 1)::text || '-12-31'; end if;
  parts := regexp_match(value_normalized, '\m(20[0-9]{2})[ -]([0-9]{2})[ -]([0-9]{2})\M');
  if parts is not null then return parts[1] || '-' || parts[2] || '-' || parts[3]; end if;
  return null;
exception when datetime_field_overflow then
  return null;
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
  title_normalized text := private.market_family_normalize(title_input);
  entity_value text;
  dimension_value text;
  type_value text;
  deadline_value text;
  child_value text;
  child_label_value text;
  family_key_value text;
  content_parts text[];
  semantics_value jsonb;
begin
  if question_normalized = '' then return '{}'::jsonb; end if;

  if question_normalized ~ '\m(trailer|teaser|avance|clip|gameplay video)\M' then
    dimension_value := 'official_content'; type_value := 'event_content_options';
  elsif question_normalized ~ '\m(announce|announced|announcement|anunci|reveal|present)\w*' then
    dimension_value := 'announcement_date'; type_value := 'deadline_ladder';
  elsif question_normalized ~ '\m(release|released|launch|lanz|saldr|debut)\w*' then
    dimension_value := 'release_date'; type_value := 'deadline_ladder';
  elsif question_normalized ~ '\m(cover|portada|participant|candidato|athlete|atleta)\M' then
    dimension_value := 'participant'; type_value := 'participant_options';
  elsif question_normalized ~ '\m(platform|plataforma|playstation|xbox|switch|steam)\M'
        and question_normalized ~ '\m(version|variant|variante)\M' then
    dimension_value := 'platform'; type_value := 'platform_variants';
  elsif question_normalized ~ '\m(at least|al menos|more than|mas de|score|puntuacion|threshold|umbral)\M' then
    dimension_value := 'threshold'; type_value := 'milestone_thresholds';
  elsif question_normalized ~ '\m(winner|ganador|award|premio|goty|which|cual)\M' then
    dimension_value := 'outcome'; type_value := 'categorical_outcomes';
  else
    dimension_value := 'related'; type_value := 'generic_related';
  end if;

  entity_value := regexp_replace(question_normalized, '^(will|whether|se) ', '');
  entity_value := regexp_replace(entity_value, '^(a|an|the|la|el|un|una) ', '');
  entity_value := regexp_replace(entity_value, '^(anunciara|anunciado|announced|lanzara|publicara) (la |el |un |una )?', '');

  if dimension_value = 'official_content' then
    content_parts := regexp_match(entity_value, '(trailer|teaser|avance|clip)( nuevo)? (of|de) (.+?)( before| antes| by|$)');
    if content_parts is not null and coalesce(content_parts[4], '') <> '' then
      entity_value := content_parts[4];
    else
      entity_value := regexp_replace(entity_value, '\m(new|nuevo|nueva|another|trailer|teaser|avance|clip)\M', ' ', 'g');
    end if;
  end if;

  entity_value := regexp_replace(
    entity_value,
    ' (will|be|is|sera|se|before|antes|by|para|released|release|launch|lanzara|lanzado|announce|announced|anunciara|publicara|come out).*$',
    ''
  );
  entity_value := trim(regexp_replace(entity_value, '\s+', ' ', 'g'));
  if length(entity_value) < 3 and title_normalized <> '' then entity_value := split_part(title_normalized, ':', 1); end if;
  if length(entity_value) < 3 then return '{}'::jsonb; end if;

  deadline_value := private.market_family_deadline_key(question_normalized);
  family_key_value := 'atinara:v1:' || trim(both '-' from regexp_replace(left(entity_value, 100), '[^a-z0-9]+', '-', 'g')) || ':' || dimension_value;
  if dimension_value = 'official_content' then
    child_value := 'content:' || case
      when question_normalized ~ '\mteaser\M' then 'teaser'
      when question_normalized ~ '\m(clip|avance)\M' then 'clip'
      else 'trailer'
    end || ':' || coalesce(deadline_value, md5(question_normalized));
  elsif deadline_value is not null then
    child_value := 'deadline:' || deadline_value;
  else
    child_value := 'option:' || md5(question_normalized);
  end if;
  child_label_value := case when deadline_value is not null then 'Hasta ' || deadline_value else left(coalesce(question_input, title_input), 180) end;
  semantics_value := case when type_value = 'deadline_ladder' then
    jsonb_build_object(
      'cumulative', true, 'mutually_exclusive', false, 'parent_is_market', false,
      'aggregate_probability', false, 'economic_independence', true
    )
  else jsonb_build_object(
    'cumulative', false, 'mutually_exclusive', type_value = 'categorical_outcomes',
    'parent_is_market', false, 'aggregate_probability', false, 'economic_independence', true
  ) end;

  return jsonb_build_object(
    'family_key', family_key_value,
    'family_title', case
      when dimension_value = 'release_date' then 'Fecha de lanzamiento · '
      when dimension_value = 'announcement_date' then 'Anuncio oficial · '
      when dimension_value = 'official_content' then 'Contenido oficial · '
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

create or replace function private.assign_market_draft_family()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  candidate_row private.external_market_candidates%rowtype;
  metadata_value jsonb;
begin
  if new.radar_candidate_id is not null then
    select * into candidate_row from private.external_market_candidates candidate_alias where candidate_alias.id = new.radar_candidate_id;
  end if;
  if candidate_row.id is not null and candidate_row.family_key is not null then
    new.family_key := candidate_row.family_key;
    new.family_title := candidate_row.family_title;
    new.family_type := candidate_row.family_type;
    new.family_child_key := candidate_row.family_child_key;
    new.family_child_label := candidate_row.family_child_label;
    new.family_sort_at := candidate_row.family_sort_at;
    new.family_relationship := case when candidate_row.family_relationship in ('sibling', 'standalone') then candidate_row.family_relationship else 'standalone' end;
    new.family_semantics := candidate_row.family_semantics;
    new.family_source_event_key := candidate_row.family_source_event_key;
    new.family_version := candidate_row.family_version;
  else
    metadata_value := private.market_family_metadata(new.question, new.subject, null, new.evaluation_ends_at);
    new.family_key := metadata_value ->> 'family_key';
    new.family_title := metadata_value ->> 'family_title';
    new.family_type := metadata_value ->> 'family_type';
    new.family_child_key := metadata_value ->> 'family_child_key';
    new.family_child_label := metadata_value ->> 'family_child_label';
    new.family_sort_at := nullif(metadata_value ->> 'family_sort_at', '')::timestamptz;
    new.family_relationship := coalesce(metadata_value ->> 'family_relationship', 'standalone');
    new.family_semantics := coalesce(metadata_value -> 'family_semantics', '{}'::jsonb);
    new.family_source_event_key := metadata_value ->> 'family_source_event_key';
    new.family_version := metadata_value ->> 'family_version';
  end if;
  return new;
end;
$function$;

create or replace function private.assign_public_market_family()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  draft_row private.market_drafts%rowtype;
  metadata_value jsonb;
begin
  select * into draft_row
  from private.market_drafts draft_alias
  where draft_alias.market_slug = new.id or draft_alias.market_id = new.id
  order by (draft_alias.market_id = new.id) desc, draft_alias.updated_at desc
  limit 1;
  if draft_row.id is not null and draft_row.family_key is not null then
    new.family_key := draft_row.family_key;
    new.family_title := draft_row.family_title;
    new.family_type := draft_row.family_type;
    new.family_child_key := draft_row.family_child_key;
    new.family_child_label := draft_row.family_child_label;
    new.family_sort_at := draft_row.family_sort_at;
    new.family_relationship := case when draft_row.family_relationship = 'sibling' then 'sibling' else 'standalone' end;
    new.family_semantics := draft_row.family_semantics;
    new.family_source_event_key := draft_row.family_source_event_key;
    new.family_version := draft_row.family_version;
  else
    metadata_value := private.market_family_metadata(new.question, null, null, new.evaluation_ends_at);
    new.family_key := metadata_value ->> 'family_key';
    new.family_title := metadata_value ->> 'family_title';
    new.family_type := metadata_value ->> 'family_type';
    new.family_child_key := metadata_value ->> 'family_child_key';
    new.family_child_label := metadata_value ->> 'family_child_label';
    new.family_sort_at := nullif(metadata_value ->> 'family_sort_at', '')::timestamptz;
    new.family_relationship := coalesce(metadata_value ->> 'family_relationship', 'standalone');
    new.family_semantics := coalesce(metadata_value -> 'family_semantics', '{}'::jsonb);
    new.family_source_event_key := metadata_value ->> 'family_source_event_key';
    new.family_version := metadata_value ->> 'family_version';
  end if;
  return new;
end;
$function$;

create or replace function private.assign_and_classify_market_candidate_family()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  metadata_value jsonb;
  match_item jsonb;
  match_metadata jsonb;
  blockers jsonb := '[]'::jsonb;
  siblings jsonb := '[]'::jsonb;
  hard_reasons jsonb := '[]'::jsonb;
begin
  metadata_value := case
    when nullif(new.normalized_payload ->> 'family_key', '') is not null then new.normalized_payload
    else private.market_family_metadata(
      coalesce(new.normalized_payload ->> 'atinara_question', new.normalized_payload ->> 'source_question'),
      new.normalized_payload ->> 'source_title',
      coalesce(new.normalized_payload ->> 'event_group_key', new.external_event_id),
      coalesce(
        nullif(new.normalized_payload ->> 'source_close_at', '')::timestamptz,
        new.expires_at
      )
    )
  end;
  new.family_key := metadata_value ->> 'family_key';
  new.family_title := metadata_value ->> 'family_title';
  new.family_type := metadata_value ->> 'family_type';
  new.family_child_key := metadata_value ->> 'family_child_key';
  new.family_child_label := metadata_value ->> 'family_child_label';
  new.family_sort_at := nullif(metadata_value ->> 'family_sort_at', '')::timestamptz;
  new.family_semantics := coalesce(metadata_value -> 'family_semantics', '{}'::jsonb);
  new.family_source_event_key := coalesce(metadata_value ->> 'family_source_event_key', new.normalized_payload ->> 'event_group_key');
  new.family_version := coalesce(metadata_value ->> 'family_version', 'atinara-market-family-v1');

  for match_item in select value from jsonb_array_elements(coalesce(new.duplicate_matches, '[]'::jsonb)) loop
    match_metadata := private.market_family_metadata(match_item ->> 'question', match_item ->> 'title', null, null);
    if coalesce(match_item ->> 'relationship', '') in ('exact_duplicate', 'semantic_duplicate')
       or private.market_family_normalize(match_item ->> 'question') = private.market_family_normalize(coalesce(new.normalized_payload ->> 'atinara_question', new.normalized_payload ->> 'source_question'))
       or (
         match_metadata ->> 'family_key' = new.family_key
         and match_metadata ->> 'family_child_key' = new.family_child_key
       ) then
      blockers := blockers || jsonb_build_array(match_item || jsonb_build_object(
        'relationship', case when match_item ->> 'relationship' = 'semantic_duplicate' then 'semantic_duplicate' else 'exact_duplicate' end,
        'blocking', true,
        'family_key', new.family_key,
        'family_child_key', new.family_child_key
      ));
    elsif match_metadata ->> 'family_key' = new.family_key then
      siblings := siblings || jsonb_build_array(match_item || jsonb_build_object(
        'relationship', 'sibling', 'blocking', false, 'family_key', new.family_key,
        'family_child_key', match_metadata ->> 'family_child_key'
      ));
    end if;
  end loop;

  blockers := blockers || coalesce((
    select jsonb_agg(item_value)
    from (
      select jsonb_build_object(
        'id', market_alias.id, 'question', market_alias.question, 'relationship', 'exact_duplicate',
        'blocking', true, 'family_key', new.family_key, 'family_child_key', new.family_child_key,
        'kind', 'market'
      ) item_value
      from public.markets market_alias
      where market_alias.family_key = new.family_key and market_alias.family_child_key = new.family_child_key
      union all
      select jsonb_build_object(
        'id', draft_alias.id, 'question', draft_alias.question, 'relationship', 'exact_duplicate',
        'blocking', true, 'family_key', new.family_key, 'family_child_key', new.family_child_key,
        'kind', 'draft'
      )
      from private.market_drafts draft_alias
      where draft_alias.family_key = new.family_key and draft_alias.family_child_key = new.family_child_key
        and draft_alias.workflow_status not in ('cancelled', 'annulled')
    ) exact_items
  ), '[]'::jsonb);

  siblings := siblings || coalesce((
    select jsonb_agg(item_value)
    from (
      select jsonb_build_object(
        'id', market_alias.id, 'question', market_alias.question, 'relationship', 'sibling',
        'blocking', false, 'family_key', new.family_key, 'family_child_key', market_alias.family_child_key,
        'kind', 'market'
      ) item_value
      from public.markets market_alias
      where market_alias.family_key = new.family_key and market_alias.family_child_key <> new.family_child_key
      union all
      select jsonb_build_object(
        'id', draft_alias.id, 'question', draft_alias.question, 'relationship', 'sibling',
        'blocking', false, 'family_key', new.family_key, 'family_child_key', draft_alias.family_child_key,
        'kind', 'draft'
      )
      from private.market_drafts draft_alias
      where draft_alias.family_key = new.family_key and draft_alias.family_child_key <> new.family_child_key
        and draft_alias.workflow_status not in ('cancelled', 'annulled')
      union all
      select jsonb_build_object(
        'id', candidate_alias.id, 'question', coalesce(candidate_alias.normalized_payload ->> 'atinara_question', candidate_alias.normalized_payload ->> 'source_question'),
        'relationship', 'sibling', 'blocking', false, 'family_key', new.family_key,
        'family_child_key', candidate_alias.family_child_key, 'kind', 'candidate'
      )
      from private.external_market_candidates candidate_alias
      where candidate_alias.id <> new.id and candidate_alias.family_key = new.family_key
        and candidate_alias.family_child_key <> new.family_child_key
    ) sibling_items
  ), '[]'::jsonb);

  new.duplicate_matches := blockers;
  for match_item in select value from jsonb_array_elements(coalesce(new.normalized_payload -> 'hard_reject_reasons', '[]'::jsonb)) loop
    if trim(both '"' from match_item::text) <> 'DUPLICATE_MARKET' then hard_reasons := hard_reasons || jsonb_build_array(match_item); end if;
  end loop;
  if jsonb_array_length(blockers) > 0 then hard_reasons := hard_reasons || '"DUPLICATE_MARKET"'::jsonb; end if;
  new.normalized_payload := new.normalized_payload || jsonb_build_object(
    'duplicate_matches', blockers,
    'family_matches', siblings,
    'hard_reject_reasons', hard_reasons,
    'family_key', new.family_key,
    'family_title', new.family_title,
    'family_type', new.family_type,
    'family_child_key', new.family_child_key,
    'family_child_label', new.family_child_label,
    'family_sort_at', new.family_sort_at,
    'family_relationship', case
      when jsonb_array_length(blockers) > 0 then blockers -> 0 ->> 'relationship'
      when jsonb_array_length(siblings) > 0 then 'sibling'
      else 'standalone'
    end,
    'family_semantics', new.family_semantics,
    'family_source_event_key', new.family_source_event_key,
    'family_version', new.family_version
  );
  new.family_relationship := new.normalized_payload ->> 'family_relationship';

  if jsonb_array_length(blockers) = 0
     and coalesce((new.score_breakdown ->> 'novelty')::integer, 0) = 0 then
    new.score_breakdown := jsonb_set(new.score_breakdown, '{novelty}', '20'::jsonb, true);
    new.quality_score := least(100, new.quality_score + 20);
  end if;
  return new;
end;
$function$;

revoke all on function private.market_family_normalize(text) from public, anon, authenticated;
revoke all on function private.market_family_deadline_key(text) from public, anon, authenticated;
revoke all on function private.market_family_metadata(text,text,text,timestamptz) from public, anon, authenticated;
revoke all on function private.assign_market_draft_family() from public, anon, authenticated;
revoke all on function private.assign_public_market_family() from public, anon, authenticated;
revoke all on function private.assign_and_classify_market_candidate_family() from public, anon, authenticated;

drop trigger if exists assign_market_draft_family_before_write on private.market_drafts;
create trigger assign_market_draft_family_before_write
before insert or update of question, subject, evaluation_ends_at, radar_candidate_id, family_key, family_child_key
on private.market_drafts
for each row execute function private.assign_market_draft_family();

drop trigger if exists assign_public_market_family_before_write on public.markets;
create trigger assign_public_market_family_before_write
before insert or update of question, evaluation_ends_at, family_key, family_child_key
on public.markets
for each row execute function private.assign_public_market_family();

drop trigger if exists classify_market_candidate_family_before_write on private.external_market_candidates;
create trigger classify_market_candidate_family_before_write
before insert or update of normalized_payload, duplicate_matches, external_event_id
on private.external_market_candidates
for each row execute function private.assign_and_classify_market_candidate_family();

update private.market_drafts draft_alias
set family_key = draft_alias.family_key;

update public.markets market_alias
set family_key = market_alias.family_key;

update private.external_market_candidates candidate_alias
set normalized_payload = candidate_alias.normalized_payload;

update private.external_market_candidates candidate_alias
set normalized_payload = candidate_alias.normalized_payload;

update private.market_drafts draft_alias
set radar_candidate_id = draft_alias.radar_candidate_id;

update private.market_drafts draft_alias
set family_relationship = case when exists (
  select 1 from private.market_drafts sibling_alias
  where sibling_alias.id <> draft_alias.id
    and sibling_alias.family_key = draft_alias.family_key
    and sibling_alias.family_child_key <> draft_alias.family_child_key
    and sibling_alias.workflow_status not in ('cancelled', 'annulled')
) then 'sibling' else 'standalone' end
where draft_alias.family_key is not null;

update public.markets market_alias
set family_relationship = case when exists (
  select 1 from public.markets sibling_alias
  where sibling_alias.id <> market_alias.id
    and sibling_alias.family_key = market_alias.family_key
    and sibling_alias.family_child_key <> market_alias.family_child_key
) then 'sibling' else 'standalone' end
where market_alias.family_key is not null;

create unique index if not exists market_drafts_family_child_uidx
  on private.market_drafts(family_key, family_child_key)
  where family_key is not null and family_child_key is not null
    and workflow_status not in ('cancelled', 'annulled');

create unique index if not exists markets_family_child_uidx
  on public.markets(family_key, family_child_key)
  where family_key is not null and family_child_key is not null;

create or replace function private.market_radar_safe_payload(candidate private.external_market_candidates)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
  select candidate.normalized_payload || jsonb_build_object(
    'id', candidate.id,
    'state', candidate.state,
    'prepared_draft_id', candidate.prepared_draft_id,
    'dismissed_at', candidate.dismissed_at,
    'expires_at', candidate.expires_at,
    'is_stale', candidate.expires_at <= now(),
    'duplicate_matches', candidate.duplicate_matches,
    'family_key', candidate.family_key,
    'family_title', candidate.family_title,
    'family_type', candidate.family_type,
    'family_child_key', candidate.family_child_key,
    'family_child_label', candidate.family_child_label,
    'family_sort_at', candidate.family_sort_at,
    'family_relationship', candidate.family_relationship,
    'family_semantics', candidate.family_semantics,
    'family_source_event_key', candidate.family_source_event_key,
    'family_version', candidate.family_version
  );
$function$;

revoke all on function private.market_radar_safe_payload(private.external_market_candidates)
  from public, anon, authenticated;

create or replace function public.get_admin_market_family_definitions()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  result_value jsonb;
begin
  perform private.require_current_admin();
  select coalesce(jsonb_agg(definition_value), '[]'::jsonb) into result_value
  from (
    select jsonb_build_object(
      'id', market_alias.id, 'kind', 'market', 'question', market_alias.question,
      'family_key', market_alias.family_key, 'family_title', market_alias.family_title,
      'family_type', market_alias.family_type, 'family_child_key', market_alias.family_child_key,
      'family_child_label', market_alias.family_child_label, 'family_sort_at', market_alias.family_sort_at,
      'family_relationship', market_alias.family_relationship, 'family_semantics', market_alias.family_semantics,
      'family_version', market_alias.family_version
    ) definition_value
    from public.markets market_alias
    union all
    select jsonb_build_object(
      'id', draft_alias.id, 'kind', 'draft', 'question', draft_alias.question,
      'family_key', draft_alias.family_key, 'family_title', draft_alias.family_title,
      'family_type', draft_alias.family_type, 'family_child_key', draft_alias.family_child_key,
      'family_child_label', draft_alias.family_child_label, 'family_sort_at', draft_alias.family_sort_at,
      'family_relationship', draft_alias.family_relationship, 'family_semantics', draft_alias.family_semantics,
      'family_version', draft_alias.family_version
    )
    from private.market_drafts draft_alias
    where draft_alias.market_id is null and draft_alias.workflow_status not in ('cancelled', 'annulled')
  ) definitions;
  return result_value;
end;
$function$;

revoke all on function public.get_admin_market_family_definitions() from public, anon;
grant execute on function public.get_admin_market_family_definitions() to authenticated;

create or replace function public.get_public_market_family_catalog()
returns table (
  market_id text,
  family_key text,
  family_title text,
  family_type text,
  family_child_key text,
  family_child_label text,
  family_sort_at timestamptz,
  family_relationship text,
  family_semantics jsonb,
  family_source_event_key text,
  family_version text
)
language sql
stable
security definer
set search_path = ''
as $function$
  select
    market_alias.id,
    market_alias.family_key,
    market_alias.family_title,
    market_alias.family_type,
    market_alias.family_child_key,
    market_alias.family_child_label,
    market_alias.family_sort_at,
    market_alias.family_relationship,
    market_alias.family_semantics,
    market_alias.family_source_event_key,
    market_alias.family_version
  from public.markets market_alias
  where market_alias.family_key is not null
  order by market_alias.family_key, market_alias.family_sort_at nulls last, market_alias.family_child_key, market_alias.id;
$function$;

revoke all on function public.get_public_market_family_catalog() from public, anon, authenticated;
grant execute on function public.get_public_market_family_catalog() to anon, authenticated;

create or replace function public.get_market_draft_expert_repair_context(draft_id_input uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  payload_value jsonb;
  deterministic_value jsonb;
  semantic_value jsonb;
  content_issues_value jsonb;
  candidate_value jsonb;
begin
  perform private.require_current_admin();
  payload_value := public.get_admin_market_draft(draft_id_input);
  deterministic_value := coalesce(payload_value -> 'deterministic_issues', '[]'::jsonb);
  semantic_value := coalesce(payload_value -> 'latest_review' -> 'semantic_issues', '[]'::jsonb);
  content_issues_value := deterministic_value || semantic_value;
  select private.market_radar_safe_payload(candidate_alias) into candidate_value
  from private.external_market_candidates candidate_alias
  join private.market_drafts draft_alias on draft_alias.radar_candidate_id = candidate_alias.id
  where draft_alias.id = draft_id_input;
  return payload_value || jsonb_build_object(
    'radar_candidate', candidate_value,
    'repairable_content_issues', content_issues_value,
    'repair_applicable', jsonb_array_length(content_issues_value) > 0,
    'technical_incident', case
      when payload_value -> 'latest_attempt' ->> 'classification' = 'technical'
      then payload_value -> 'latest_attempt'
      else null
    end
  );
end;
$function$;

revoke all on function public.get_market_draft_expert_repair_context(uuid) from public, anon;
grant execute on function public.get_market_draft_expert_repair_context(uuid) to authenticated;

create or replace function private.ensure_market_draft_resolution_binding(
  draft_id_input uuid,
  actor_id_input uuid,
  contract_input jsonb,
  sources_input jsonb,
  change_origin_input text default 'autonomous_repair'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  draft_row private.market_drafts%rowtype;
  candidate_row private.external_market_candidates%rowtype;
  active_binding private.market_source_bindings%rowtype;
  binding_row private.market_source_bindings%rowtype;
  source_item jsonb;
  primary_count integer;
  invalid_count integer;
begin
  select * into draft_row from private.market_drafts draft_alias where draft_alias.id = draft_id_input for update;
  if not found then raise exception 'DRAFT_NOT_FOUND' using errcode = 'P0001'; end if;
  select * into active_binding
  from private.market_source_bindings binding_alias
  where binding_alias.draft_id = draft_id_input and binding_alias.status <> 'superseded'
  order by binding_alias.plan_version desc, binding_alias.created_at desc
  limit 1 for update;
  if active_binding.id is not null then
    return private.sync_market_draft_binding(
      draft_id_input, actor_id_input, contract_input, sources_input, change_origin_input
    );
  end if;
  if jsonb_typeof(contract_input) <> 'object' or jsonb_typeof(sources_input) <> 'array' then
    raise exception 'RESOLUTION_PLAN_REQUIRED' using errcode = '22023';
  end if;
  select
    count(*) filter (where source_value ->> 'role' = 'PRIMARY_RESOLUTION'),
    count(*) filter (where coalesce(source_value ->> 'url', '') !~ '^https://'
      or coalesce(source_value ->> 'precedence', '') !~ '^[1-9][0-9]*$')
  into primary_count, invalid_count
  from jsonb_array_elements(sources_input) source_rows(source_value);
  if primary_count <> 1 then raise exception 'RESOLUTION_PRIMARY_SOURCE_REQUIRED' using errcode = '22023'; end if;
  if invalid_count > 0 then raise exception 'RESOLUTION_SOURCE_ASSIGNMENT_INVALID' using errcode = '22023'; end if;

  if draft_row.radar_candidate_id is not null then
    select * into candidate_row from private.external_market_candidates candidate_alias where candidate_alias.id = draft_row.radar_candidate_id;
  end if;
  insert into private.market_source_bindings(
    draft_id, market_id, origin_type, origin_id, expert_run_id, plan_version,
    contract_schema_version, policy_version, resolution_contract,
    status, validation, provider, adapter_version, monitor_required, monitor_readiness
  ) values (
    draft_row.id,
    draft_row.market_id,
    'radar_candidate',
    coalesce(candidate_row.id::text, 'autonomous-repair:' || draft_row.id::text),
    null,
    1,
    coalesce(nullif(contract_input ->> 'contract_schema_version', ''), 'atinara-resolution-contract-v1'),
    coalesce(nullif(contract_input ->> 'policy_version', ''), 'atinara-market-constitution-v1'),
    jsonb_set(contract_input, '{sources}', sources_input, true),
    'draft',
    '{}'::jsonb,
    coalesce(nullif(contract_input ->> 'provider', ''), candidate_row.provider, 'official_web'),
    coalesce(nullif(contract_input ->> 'provider_adapter_version', ''), 'atinara-draft-repair-v3'),
    false,
    'not_required'
  ) returning * into binding_row;

  for source_item in select value from jsonb_array_elements(sources_input) loop
    insert into private.market_source_binding_sources(
      binding_id, source_url, role, precedence, fallback_condition, required
    ) values (
      binding_row.id,
      left(trim(source_item ->> 'url'), 2048),
      source_item ->> 'role',
      (source_item ->> 'precedence')::integer,
      nullif(source_item ->> 'fallback_condition', ''),
      coalesce((source_item ->> 'required')::boolean, false)
    );
  end loop;

  insert into private.market_admin_audit(actor_id, action_code, draft_id, draft_version, detail)
  values (
    actor_id_input,
    'SOURCE_BINDING_CREATED_BY_AUTONOMOUS_REPAIR',
    draft_row.id,
    draft_row.content_version,
    jsonb_build_object(
      'binding_id', binding_row.id, 'plan_version', binding_row.plan_version,
      'change_origin', left(coalesce(change_origin_input, 'autonomous_repair'), 100),
      'publishes', false, 'confirms', false, 'resolves', false
    )
  );
  return jsonb_build_object(
    'required', true, 'changed', true, 'compatible', true,
    'binding_id', binding_row.id, 'plan_version', binding_row.plan_version
  );
end;
$function$;

revoke all on function private.ensure_market_draft_resolution_binding(uuid,uuid,jsonb,jsonb,text)
  from public, anon, authenticated;

create or replace function public.apply_market_draft_expert_repair(
  draft_id_input uuid,
  expected_version_input bigint,
  draft_input jsonb,
  contract_input jsonb,
  sources_input jsonb,
  repair_meta_input jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor_id uuid := private.require_current_admin();
  before_row private.market_drafts%rowtype;
  context_value jsonb;
  save_result jsonb;
  saved_draft_id uuid;
  saved_version bigint;
  binding_result jsonb;
  contract_question text;
  contract_timezone text;
  contract_evaluation timestamptz;
  draft_evaluation timestamptz;
  primary_source_url text;
  contract_primary_url text;
  repair_request_key uuid;
begin
  if jsonb_typeof(draft_input) <> 'object'
     or jsonb_typeof(contract_input) <> 'object'
     or jsonb_typeof(sources_input) <> 'array'
     or jsonb_typeof(repair_meta_input) <> 'object' then
    raise exception 'INVALID_EXPERT_REPAIR_PAYLOAD' using errcode = '22023';
  end if;
  if octet_length(draft_input::text) > 65536
     or octet_length(contract_input::text) > 65536
     or octet_length(sources_input::text) > 32768
     or octet_length(repair_meta_input::text) > 16384 then
    raise exception 'EXPERT_REPAIR_PAYLOAD_TOO_LARGE' using errcode = '22023';
  end if;

  select * into before_row
  from private.market_drafts draft_alias
  where draft_alias.id = draft_id_input
  for update;
  if not found then raise exception 'DRAFT_NOT_FOUND' using errcode = 'P0001'; end if;
  if expected_version_input is null or before_row.content_version <> expected_version_input then
    raise exception 'DRAFT_VERSION_MOVED' using errcode = '40001';
  end if;
  if before_row.workflow_status in (
    'published', 'early_closed', 'cancelled', 'pending_resolution',
    'resolved', 'annulled', 'scheduled', 'human_confirmed'
  ) then
    raise exception 'DRAFT_NOT_REPAIRABLE_IN_CURRENT_STATE' using errcode = '22023';
  end if;

  context_value := public.get_market_draft_expert_repair_context(draft_id_input);
  if not coalesce((context_value ->> 'repair_applicable')::boolean, false) then
    raise exception 'DRAFT_REPAIR_NOT_APPLICABLE' using errcode = '22023';
  end if;

  contract_question := trim(coalesce(contract_input ->> 'canonical_statement', ''));
  if contract_question = '' or contract_question <> trim(coalesce(draft_input ->> 'question', '')) then
    raise exception 'REPAIR_CONTRACT_QUESTION_MISMATCH' using errcode = '22023';
  end if;
  contract_timezone := trim(coalesce(contract_input ->> 'timezone', ''));
  if contract_timezone = '' or contract_timezone <> trim(coalesce(draft_input ->> 'timezone', '')) then
    raise exception 'REPAIR_CONTRACT_TIMEZONE_MISMATCH' using errcode = '22023';
  end if;
  begin
    contract_evaluation := coalesce(
      nullif(trim(contract_input ->> 'evaluation_at'), '')::timestamptz,
      nullif(trim(contract_input ->> 'window_end'), '')::timestamptz
    );
    draft_evaluation := nullif(trim(draft_input ->> 'evaluation_ends_at'), '')::timestamptz;
    repair_request_key := nullif(trim(repair_meta_input ->> 'idempotency_key'), '')::uuid;
  exception
    when invalid_datetime_format then raise exception 'INVALID_DRAFT_DATE' using errcode = '22007';
    when invalid_text_representation then raise exception 'INVALID_IDEMPOTENCY_KEY' using errcode = '22023';
  end;
  if contract_evaluation is null or draft_evaluation is null
     or private.market_timestamp_canonical(contract_evaluation)
        is distinct from private.market_timestamp_canonical(draft_evaluation) then
    raise exception 'REPAIR_CONTRACT_DATE_MISMATCH' using errcode = '22023';
  end if;

  primary_source_url := trim(coalesce(draft_input -> 'primary_source' ->> 'url', ''));
  select trim(coalesce(source_item ->> 'url', '')) into contract_primary_url
  from jsonb_array_elements(sources_input) source_rows(source_item)
  where source_item ->> 'role' = 'PRIMARY_RESOLUTION'
  order by coalesce((source_item ->> 'precedence')::integer, 1)
  limit 1;
  if primary_source_url = '' or contract_primary_url is null
     or primary_source_url <> contract_primary_url then
    raise exception 'REPAIR_PRIMARY_SOURCE_MISMATCH' using errcode = '22023';
  end if;

  save_result := public.save_market_draft(
    draft_id_input,
    expected_version_input,
    draft_input || jsonb_build_object(
      '_idempotency_key', coalesce(repair_request_key, gen_random_uuid()),
      '_change_origin', 'autonomous_expert_repair',
      '_binding_managed_externally', true
    )
  );
  saved_draft_id := (save_result -> 'draft' ->> 'id')::uuid;
  saved_version := (save_result -> 'draft' ->> 'content_version')::bigint;

  binding_result := private.ensure_market_draft_resolution_binding(
    saved_draft_id,
    actor_id,
    contract_input,
    sources_input,
    'autonomous_expert_repair'
  );

  insert into private.market_admin_audit(actor_id, action_code, draft_id, draft_version, detail)
  values (
    actor_id,
    case when coalesce((save_result ->> 'changed')::boolean, false)
      then 'MARKET_DRAFT_AUTONOMOUS_REPAIR_APPLIED'
      else 'MARKET_DRAFT_AUTONOMOUS_REPAIR_NOOP'
    end,
    saved_draft_id,
    saved_version,
    jsonb_build_object(
      'changed_fields', coalesce(repair_meta_input -> 'changed_fields', '[]'::jsonb),
      'repair_policy', coalesce(repair_meta_input ->> 'repair_policy', 'atinara-draft-repair-v3'),
      'repair_mode', coalesce(repair_meta_input ->> 'repair_mode', 'autonomous_archetype_with_deterministic_guardrails'),
      'repair_round', coalesce((repair_meta_input ->> 'repair_round')::integer, 1),
      'archetype', repair_meta_input ->> 'archetype',
      'degraded', coalesce((repair_meta_input ->> 'degraded')::boolean, false),
      'content_changed', coalesce((save_result ->> 'changed')::boolean, false),
      'binding_sync', binding_result,
      'review_requested_after_repair', true,
      'publishes', false,
      'confirms', false,
      'resolves', false
    )
  );

  return save_result || jsonb_build_object(
    'repair_applied', coalesce((save_result ->> 'changed')::boolean, false),
    'intelligence_binding', binding_result,
    'previous_version', expected_version_input,
    'new_version', saved_version,
    'technical_incident_separate', context_value -> 'technical_incident',
    'publishes', false,
    'confirms', false,
    'resolves', false
  );
end;
$function$;

revoke all on function public.apply_market_draft_expert_repair(uuid,bigint,jsonb,jsonb,jsonb,jsonb)
  from public, anon;
grant execute on function public.apply_market_draft_expert_repair(uuid,bigint,jsonb,jsonb,jsonb,jsonb)
  to authenticated;

comment on function public.get_public_market_family_catalog() is
  'Metadatos públicos de navegación. No crea mercados padre, no agrega probabilidades y cada hijo conserva economía independiente.';
comment on column public.markets.family_semantics is
  'Semántica de navegación; deadline_ladder es acumulativa, no exclusiva y sin probabilidad agregada.';

commit;
