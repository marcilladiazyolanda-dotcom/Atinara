-- Puerta factual autoritativa v2 para Radar.
-- Mantiene cada comprobacion como evidencia append-only y cierra todos los
-- accesos Radar -> preparar/guardar si no existe un snapshot fresco y vinculado.
-- No publica, confirma, resuelve ni modifica mercados, predicciones o economia.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';

-- El catalogo de autoridades es configuracion privada reutilizable por clientes
-- B2B. El bootstrap no pisa decisiones posteriores del operador.
insert into private.market_source_registry (
  provider, source_name, canonical_domain, allowed_roles, authority_tier,
  categories, access_method, health_status, retention_policy, parser_version,
  active
)
select 'radar', source_name, canonical_domain,
  '["radar_fact_evidence","primary_resolution"]'::jsonb,
  'primary', '[]'::jsonb, 'https', 'unknown',
  jsonb_build_object('snapshot', true, 'append_only', true),
  'atinara-radar-source-registry-v1', true
from (values
  ('PlayStation', 'playstation.com'),
  ('Xbox', 'xbox.com'),
  ('Nintendo', 'nintendo.com'),
  ('Electronic Arts', 'ea.com'),
  ('Capcom', 'capcom.com'),
  ('Rockstar Games', 'rockstargames.com'),
  ('The Game Awards', 'thegameawards.com'),
  ('Metacritic', 'metacritic.com'),
  ('Steam', 'store.steampowered.com'),
  ('Valve', 'valvesoftware.com')
) as bootstrap(source_name, canonical_domain)
where not exists (
  select 1 from private.market_source_registry registry
  where registry.provider = 'radar'
    and registry.canonical_domain = bootstrap.canonical_domain
    and coalesce(registry.external_entity_id, '') = ''
);

insert into private.market_source_registry (
  provider, source_name, canonical_domain, allowed_roles, authority_tier,
  categories, access_method, health_status, retention_policy, parser_version,
  active
)
select 'radar_provider', source_name, canonical_domain,
  '["provider_fact"]'::jsonb,
  'primary', '[]'::jsonb, 'https', 'unknown',
  jsonb_build_object('snapshot', true, 'append_only', true),
  'atinara-radar-source-registry-v1', true
from (values
  ('Polymarket', 'polymarket.com'),
  ('Kalshi', 'kalshi.com')
) as bootstrap(source_name, canonical_domain)
where not exists (
  select 1 from private.market_source_registry registry
  where registry.provider = 'radar_provider'
    and registry.canonical_domain = bootstrap.canonical_domain
    and coalesce(registry.external_entity_id, '') = ''
);

create or replace function public.get_market_radar_authoritative_source_domains_v1()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if auth.role() <> 'service_role' then
    raise exception 'SERVICE_ROLE_REQUIRED' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', registry.id,
      'canonical_domain', lower(registry.canonical_domain),
      'authority_tier', registry.authority_tier,
      'parser_version', registry.parser_version
    ) order by registry.canonical_domain)
    from private.market_source_registry registry
    where registry.active
      and registry.authority_tier = 'primary'
      and registry.allowed_roles @> '["radar_fact_evidence"]'::jsonb
  ), '[]'::jsonb);
end;
$function$;

revoke all on function public.get_market_radar_authoritative_source_domains_v1()
  from public, anon, authenticated, service_role;
grant execute on function public.get_market_radar_authoritative_source_domains_v1()
  to service_role;

alter table private.market_radar_fact_checks
  add column if not exists candidate_id uuid
    references private.external_market_candidates(id) on delete restrict,
  add column if not exists preparation_revision bigint,
  add column if not exists purpose text,
  add column if not exists attempt_id uuid not null default gen_random_uuid(),
  add column if not exists context_snapshot jsonb not null default '{}'::jsonb,
  add column if not exists context_sha256 text,
  add column if not exists source_snapshot jsonb not null default '[]'::jsonb,
  add column if not exists source_sha256 text,
  add column if not exists expires_at timestamptz;

create unique index if not exists market_radar_fact_checks_attempt_uidx
  on private.market_radar_fact_checks (attempt_id);
create index if not exists market_radar_fact_checks_candidate_revision_idx
  on private.market_radar_fact_checks (candidate_id, preparation_revision, checked_at desc)
  where candidate_id is not null;

do $constraints$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'private.market_radar_fact_checks'::regclass
      and conname = 'market_radar_fact_checks_v2_shape_check'
  ) then
    alter table private.market_radar_fact_checks
      add constraint market_radar_fact_checks_v2_shape_check check (
        (purpose is null or purpose in ('discovery', 'prepare', 'revalidate'))
        and jsonb_typeof(context_snapshot) = 'object'
        and jsonb_typeof(source_snapshot) = 'array'
        and (context_sha256 is null or context_sha256 ~ '^[0-9a-f]{64}$')
        and (source_sha256 is null or source_sha256 ~ '^[0-9a-f]{64}$')
        and (preparation_revision is null or preparation_revision > 0)
      );
  end if;
end;
$constraints$;

alter table private.external_market_candidates
  add column if not exists current_fact_check_id bigint
    references private.market_radar_fact_checks(id) on delete restrict,
  add column if not exists fact_status text,
  add column if not exists fact_policy_version text,
  add column if not exists fact_context_fingerprint text,
  add column if not exists fact_checked_at timestamptz,
  add column if not exists fact_check_expires_at timestamptz,
  add column if not exists fact_check_purpose text;

do $constraints$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'private.external_market_candidates'::regclass
      and conname = 'external_market_candidates_fact_status_check'
  ) then
    alter table private.external_market_candidates
      add constraint external_market_candidates_fact_status_check check (
        fact_status is null or fact_status in (
          'unresolved', 'partially_resolved', 'fully_resolved', 'conflicting', 'unknown'
        )
      );
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'private.external_market_candidates'::regclass
      and conname = 'external_market_candidates_fact_purpose_check'
  ) then
    alter table private.external_market_candidates
      add constraint external_market_candidates_fact_purpose_check check (
        fact_check_purpose is null or fact_check_purpose in ('discovery', 'prepare', 'revalidate')
      );
  end if;
end;
$constraints$;

create index if not exists external_market_candidates_current_fact_idx
  on private.external_market_candidates (current_fact_check_id)
  where current_fact_check_id is not null;

-- La Edge no es propietaria de las tablas factuales: todo acceso operativo se
-- realiza mediante RPCs SECURITY DEFININER que validan rol, revision, hashes y
-- estado en una unica transaccion. En particular, service_role no puede
-- fabricar una fila factual ni enlazarla mediante un UPDATE REST directo.
revoke all privileges on table private.external_market_candidates
  from public, anon, authenticated, service_role;
revoke all privileges on table private.market_radar_fact_checks
  from public, anon, authenticated, service_role;
revoke all privileges on sequence private.market_radar_fact_checks_id_seq
  from public, anon, authenticated, service_role;
-- Los borradores se mutan exclusivamente mediante RPCs SECURITY DEFINER. Si
-- service_role conservara UPDATE podria borrar el enlace Radar y convertir el
-- borrador en uno "manual" antes de programarlo o materializarlo.
revoke all privileges on table private.market_drafts
  from public, anon, authenticated, service_role;

create or replace function private.reject_market_radar_fact_check_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  raise exception 'RADAR_FACT_CHECK_APPEND_ONLY' using errcode = '55000';
end;
$function$;

revoke all on function private.reject_market_radar_fact_check_mutation()
  from public, anon, authenticated;

drop trigger if exists reject_market_radar_fact_check_mutation
  on private.market_radar_fact_checks;
create trigger reject_market_radar_fact_check_mutation
before update or delete on private.market_radar_fact_checks
for each row execute function private.reject_market_radar_fact_check_mutation();

create or replace function private.market_radar_sources_authorized_v1(snapshot_input jsonb)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select jsonb_typeof(snapshot_input) = 'array'
    and jsonb_array_length(snapshot_input) > 0
    and not exists (
      select 1
      from jsonb_array_elements(snapshot_input) source_item
      cross join lateral (
        select lower(split_part(split_part(regexp_replace(
          coalesce(source_item ->> 'url', ''), '^https://', '', 'i'
        ), '/', 1), ':', 1)) as hostname
      ) parsed
      where coalesce(source_item ->> 'url', '') !~ '^https://'
        or parsed.hostname = ''
        or coalesce(source_item ->> 'source_type', '') <> 'official'
        or coalesce(source_item ->> 'retrieval_status', '') <> 'verified_content'
        or coalesce(source_item ->> 'evidence_basis', '') <> 'retrieved_content'
        or coalesce(source_item ->> 'parser_version', '') <> 'atinara-official-content-v1'
        or coalesce(source_item ->> 'claim_status', '') <> 'direct'
        or coalesce(source_item ->> 'direct_claim', '') <> 'true'
        or coalesce(source_item ->> 'claim_verifiable', '') <> 'true'
        or coalesce(source_item ->> 'content_sha256', '') !~ '^[0-9a-f]{64}$'
        or coalesce(source_item ->> 'retrieved_at', '') !~
          '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,6})?Z$'
        or btrim(coalesce(source_item ->> 'supports', '')) = ''
        or lower(concat(
          coalesce(source_item ->> 'title', ''), ' ',
          coalesce(source_item ->> 'supports', '')
        )) ~ '(^|[^a-z0-9])(rumou?rs?|rumoured|reportedly|allegedly|leaks?|leaked|speculation|speculative|predictions?|forecast|might|may|could|would|possibly|potentially|likely|unlikely|votes?|voting|poll|fan favou?rite|concept|mockup|rumores?|filtraci[oó]n|predicciones?|pron[oó]stico|podr[ií]a|podr[ií]an|quiz[aá]s?|tal vez|votaci[oó]n|encuesta|favorito de (los )?fans)([^a-z0-9]|$)'
        or not exists (
          select 1
          from private.market_source_registry registry
          where registry.active
            and registry.authority_tier = 'primary'
            and registry.allowed_roles @> '["radar_fact_evidence"]'::jsonb
            and (
              parsed.hostname = lower(registry.canonical_domain)
              or parsed.hostname like '%.' || lower(registry.canonical_domain)
            )
        )
    );
$function$;

revoke all on function private.market_radar_sources_authorized_v1(jsonb)
  from public, anon, authenticated;

create or replace function private.market_radar_selection_complete_sources_v1(snapshot_input jsonb)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select private.market_radar_sources_authorized_v1(snapshot_input)
    and exists (
      select 1
      from jsonb_array_elements(snapshot_input) source_item
      where coalesce(source_item ->> 'selection_complete', '') = 'true'
        and coalesce(source_item ->> 'direct_claim', '') = 'true'
        and coalesce(source_item ->> 'evidence_basis', '') = 'retrieved_content'
        and jsonb_typeof(source_item -> 'supported_reason_codes') = 'array'
        and source_item -> 'supported_reason_codes' ? 'EVENT_ALREADY_RESOLVED'
        and jsonb_typeof(source_item -> 'supported_fact_statuses') = 'array'
        and source_item -> 'supported_fact_statuses' ? 'fully_resolved'
    );
$function$;

revoke all on function private.market_radar_selection_complete_sources_v1(jsonb)
  from public, anon, authenticated;

create or replace function private.market_radar_sources_nonterminal_v1(
  snapshot_input jsonb,
  checked_at_input timestamptz
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  source_item jsonb;
  unresolved_until_value timestamptz;
  retrieved_at_value timestamptz;
  excerpt_value text;
  item_has_valid_proof boolean;
  has_valid_proof boolean := false;
  combined_text text;
begin
  if checked_at_input is null
     or not private.market_radar_sources_authorized_v1(snapshot_input) then
    return false;
  end if;
  for source_item in select value from jsonb_array_elements(snapshot_input)
  loop
    item_has_valid_proof := false;
    excerpt_value := btrim(coalesce(source_item ->> 'unresolved_proof_excerpt', ''));
    if coalesce(source_item ->> 'unresolved_proof', '') = 'true'
       and coalesce(source_item ->> 'unresolved_proof_basis', '') = 'official_future_date_v1'
       and jsonb_typeof(source_item -> 'supported_fact_statuses') = 'array'
       and source_item -> 'supported_fact_statuses' ? 'unresolved'
       and jsonb_typeof(source_item -> 'supported_contract_kinds') = 'array'
       and jsonb_array_length(source_item -> 'supported_contract_kinds') between 1 and 3
       and not exists (
         select 1
         from jsonb_array_elements_text(source_item -> 'supported_contract_kinds') contract_kind
         where contract_kind not in ('announcement', 'release', 'milestone', 'review')
       )
       and excerpt_value <> ''
       and length(excerpt_value) <= 700
       and coalesce(source_item ->> 'unresolved_proof_excerpt_sha256', '') ~ '^[0-9a-f]{64}$'
       and coalesce(source_item ->> 'unresolved_proof_excerpt_sha256', '') =
         encode(extensions.digest(convert_to(excerpt_value, 'UTF8'), 'sha256'), 'hex')
       and position(lower(excerpt_value) in lower(coalesce(source_item ->> 'supports', ''))) > 0 then
      begin
        unresolved_until_value := nullif(source_item ->> 'unresolved_until', '')::timestamptz;
        retrieved_at_value := nullif(source_item ->> 'retrieved_at', '')::timestamptz;
        item_has_valid_proof := unresolved_until_value > checked_at_input + interval '1 minute'
          and unresolved_until_value <= checked_at_input + interval '10 years'
          and retrieved_at_value <= checked_at_input + interval '1 minute'
          and retrieved_at_value >= checked_at_input - interval '10 minutes';
      exception when invalid_datetime_format or datetime_field_overflow then
        item_has_valid_proof := false;
      end;
    end if;
    has_valid_proof := has_valid_proof or item_has_valid_proof;
    combined_text := lower(concat(
      coalesce(source_item ->> 'title', ''), ' ',
      coalesce(source_item ->> 'supports', '')
    ));
    if combined_text ~ '(^|[^a-z0-9])(now available|available now|out now|is available|are available|released today|has released|have released|was released|has launched|have launched|was launched|arrived in stores|is on sale|are on sale|has announced|have announced|was announced|winner|award goes to|ya disponible|disponible ahora|est[aá] disponible|sali[oó] a la venta|fue lanzado|se lanz[oó]|ha anunciado|fue anunciado|ganador|el premio es para)([^a-z0-9]|$)'
       or (
         not item_has_valid_proof
         and combined_text ~ '(^|[^a-z0-9])(launches worldwide|releases worldwide|available worldwide from|launches on|releases on|lanzar[aá]|estar[aá] disponible|saldr[aá] a la venta)([^a-z0-9]|$)'
       ) then
      return false;
    end if;
  end loop;
  return has_valid_proof;
end;
$function$;

revoke all on function private.market_radar_sources_nonterminal_v1(jsonb,timestamp with time zone)
  from public, anon, authenticated;

create or replace function private.market_radar_provider_fact_authorized_v1(snapshot_input jsonb)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select jsonb_typeof(snapshot_input) = 'array'
    and jsonb_array_length(snapshot_input) > 0
    and not exists (
      select 1
      from jsonb_array_elements(snapshot_input) source_item
      cross join lateral (
        select lower(split_part(split_part(regexp_replace(
          coalesce(source_item ->> 'url', ''), '^https://', '', 'i'
        ), '/', 1), ':', 1)) as hostname
      ) parsed
      where coalesce(source_item ->> 'url', '') !~ '^https://'
        or parsed.hostname = ''
        or (
          coalesce(source_item ->> 'source_type', '') = 'provider'
          and (
            coalesce(source_item ->> 'retrieval_status', '') <> 'verified_provider_api'
            or coalesce(source_item ->> 'evidence_basis', '') <> 'provider_api'
            or coalesce(source_item ->> 'claim_status', '') <> 'direct'
            or coalesce(source_item ->> 'direct_claim', '') <> 'true'
            or coalesce(source_item ->> 'claim_verifiable', '') <> 'true'
            or btrim(coalesce(source_item ->> 'supports', '')) = ''
          )
        )
        or (
          coalesce(source_item ->> 'source_type', '') <> 'provider'
          and not private.market_radar_sources_authorized_v1(jsonb_build_array(source_item))
        )
        or not exists (
          select 1
          from private.market_source_registry registry
          where registry.active
            and registry.authority_tier = 'primary'
            and (
              (coalesce(source_item ->> 'source_type', '') = 'provider'
                and registry.allowed_roles @> '["provider_fact"]'::jsonb)
              or (coalesce(source_item ->> 'source_type', '') <> 'provider'
                and registry.allowed_roles @> '["radar_fact_evidence"]'::jsonb)
            )
            and (
              parsed.hostname = lower(registry.canonical_domain)
              or parsed.hostname like '%.' || lower(registry.canonical_domain)
            )
        )
    )
    and exists (
      select 1
      from jsonb_array_elements(snapshot_input) source_item
      cross join lateral (
        select lower(split_part(split_part(regexp_replace(
          coalesce(source_item ->> 'url', ''), '^https://', '', 'i'
        ), '/', 1), ':', 1)) as hostname
      ) parsed
      where coalesce(source_item ->> 'source_type', '') = 'provider'
        and coalesce(source_item ->> 'url', '') ~ '^https://'
        and exists (
          select 1
          from private.market_source_registry registry
          where registry.active
            and registry.authority_tier = 'primary'
            and registry.allowed_roles @> '["provider_fact"]'::jsonb
            and (
              parsed.hostname = lower(registry.canonical_domain)
              or parsed.hostname like '%.' || lower(registry.canonical_domain)
            )
        )
    );
$function$;

revoke all on function private.market_radar_provider_fact_authorized_v1(jsonb)
  from public, anon, authenticated;

create or replace function private.market_radar_sources_support_reason_v1(
  snapshot_input jsonb,
  reason_code_input text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select nullif(reason_code_input, '') is not null
    and (
      private.market_radar_sources_authorized_v1(snapshot_input)
      or private.market_radar_provider_fact_authorized_v1(snapshot_input)
    )
    and exists (
      select 1
      from jsonb_array_elements(snapshot_input) source_item
      where jsonb_typeof(source_item -> 'supported_reason_codes') = 'array'
        and source_item -> 'supported_reason_codes' ? reason_code_input
    );
$function$;

revoke all on function private.market_radar_sources_support_reason_v1(jsonb,text)
  from public, anon, authenticated;

create or replace function private.insert_market_radar_fact_check_v2(
  candidate_id_input uuid,
  preparation_revision_input bigint,
  purpose_input text,
  fact_check_input jsonb
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $function$
declare
  candidate private.external_market_candidates%rowtype;
  fact_id_value bigint;
  checked_at_value timestamptz;
  expires_at_value timestamptz;
  fact_status_value text;
  verification_status_value text;
  context_value jsonb;
  source_value jsonb;
  context_hash text;
  source_hash text;
  decision_hash_value text;
begin
  select * into candidate
  from private.external_market_candidates candidate_alias
  where candidate_alias.id = candidate_id_input;
  if not found then
    raise exception 'RADAR_CANDIDATE_NOT_FOUND' using errcode = 'P0001';
  end if;
  if purpose_input not in ('discovery', 'prepare', 'revalidate')
     or preparation_revision_input is null or preparation_revision_input < 1
     or jsonb_typeof(fact_check_input) <> 'object'
     or coalesce(fact_check_input ->> 'provider', '') <> candidate.provider
     or coalesce(fact_check_input ->> 'external_id', '') <> candidate.external_id
     or coalesce(fact_check_input ->> 'purpose', '') <> purpose_input
     or coalesce(fact_check_input ->> 'attempt_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     or coalesce(fact_check_input ->> 'fact_policy_version', '') <> 'atinara-terminal-fact-gate-v2'
     or coalesce(fact_check_input ->> 'context_sha256', '') !~ '^[0-9a-f]{64}$'
     or coalesce(fact_check_input ->> 'fact_context_fingerprint', '')
       <> coalesce(fact_check_input ->> 'context_sha256', '')
     or coalesce(fact_check_input ->> 'source_sha256', '') !~ '^[0-9a-f]{64}$'
     or coalesce(fact_check_input ->> 'decision_hash', '') !~ '^[0-9a-f]{64}$' then
    raise exception 'INVALID_RADAR_FACT_CHECK_V2' using errcode = '22023';
  end if;
  fact_status_value := coalesce(fact_check_input ->> 'fact_status', '');
  verification_status_value := coalesce(fact_check_input ->> 'verification_status', '');
  if fact_status_value not in (
       'unresolved', 'partially_resolved', 'fully_resolved', 'conflicting', 'unknown'
     ) or verification_status_value not in (
       'pending', 'verified_open', 'needs_review', 'rejected_resolved',
       'rejected_stale', 'rejected_ineligible', 'rejected_unannounced',
       'rejected_incoherent', 'rejected_invalid_source', 'rejected_duplicate'
     ) then
    raise exception 'INVALID_RADAR_FACT_CHECK_V2' using errcode = '22023';
  end if;
  context_value := coalesce(fact_check_input -> 'context_snapshot', '{}'::jsonb);
  source_value := coalesce(fact_check_input -> 'source_snapshot', '[]'::jsonb);
  if jsonb_typeof(context_value) <> 'object'
     or jsonb_typeof(source_value) <> 'array'
     or coalesce(context_value ->> 'fact_context_schema_version', '')
       <> 'atinara-radar-fact-context-v2'
     or coalesce(context_value ->> 'provider', '') <> candidate.provider
     or coalesce(context_value ->> 'external_id', '') <> candidate.external_id
     or nullif(context_value ->> 'external_event_id', '')
       is distinct from nullif(candidate.external_event_id, '')
     or nullif(context_value ->> 'external_market_id', '')
       is distinct from nullif(candidate.normalized_payload ->> 'external_market_id', '')
     or nullif(context_value ->> 'event_group_key', '')
       is distinct from nullif(candidate.event_group_key, '')
     or context_value ->> 'canonical_event_children_complete' <> 'true'
     or jsonb_typeof(context_value -> 'canonical_event_children') <> 'array'
     or coalesce(context_value ->> 'canonical_event_children_total', '') !~ '^[1-9][0-9]{0,2}$'
     or (context_value ->> 'canonical_event_children_total')::integer > 240
     or jsonb_array_length(context_value -> 'canonical_event_children')
       <> (context_value ->> 'canonical_event_children_total')::integer
     or coalesce(fact_check_input -> 'evidence', '[]'::jsonb) <> source_value then
    raise exception 'INVALID_RADAR_FACT_SNAPSHOT_V2' using errcode = '22023';
  end if;
  begin
    checked_at_value := nullif(fact_check_input ->> 'checked_at', '')::timestamptz;
    expires_at_value := nullif(fact_check_input ->> 'expires_at', '')::timestamptz;
  exception when invalid_datetime_format then
    raise exception 'INVALID_RADAR_FACT_CHECK_DATE' using errcode = '22007';
  end;
  if checked_at_value is null or checked_at_value > now() + interval '1 minute'
     or expires_at_value is null or expires_at_value <= checked_at_value
     or expires_at_value > checked_at_value + interval '30 minutes' then
    raise exception 'INVALID_RADAR_FACT_CHECK_DATE' using errcode = '22007';
  end if;
  if verification_status_value = 'verified_open' and fact_status_value <> 'unresolved' then
    raise exception 'RADAR_FACT_EVIDENCE_REQUIRED' using errcode = '22023';
  end if;
  if verification_status_value = 'verified_open'
     and not private.market_radar_sources_nonterminal_v1(source_value, checked_at_value) then
    raise exception 'RADAR_FACT_EVIDENCE_REQUIRED' using errcode = '22023';
  end if;
  if fact_status_value = 'fully_resolved'
     and not (
       private.market_radar_selection_complete_sources_v1(source_value)
       or (
         private.market_radar_provider_fact_authorized_v1(source_value)
         and nullif(context_value ->> 'source_result', '') is not null
       )
     ) then
    raise exception 'RADAR_FACT_EVIDENCE_REQUIRED' using errcode = '22023';
  end if;
  if verification_status_value in (
       'rejected_stale', 'rejected_ineligible', 'rejected_unannounced',
       'rejected_incoherent'
     )
     and not private.market_radar_sources_support_reason_v1(
       source_value, fact_check_input ->> 'reason_code'
     ) then
    raise exception 'RADAR_FACT_EVIDENCE_REQUIRED' using errcode = '22023';
  end if;
  if fact_status_value = 'fully_resolved'
     and verification_status_value <> 'rejected_resolved' then
    raise exception 'RADAR_FACT_STATUS_CONFLICT' using errcode = '22023';
  end if;
  if coalesce(fact_check_input ->> 'reason_code', '') = 'PROVIDER_NOT_OPEN'
     and (
       fact_status_value <> 'unresolved'
       or verification_status_value not like 'rejected_%'
       or not private.market_radar_provider_fact_authorized_v1(source_value)
     ) then
    raise exception 'RADAR_PROVIDER_FACT_REQUIRED' using errcode = '22023';
  end if;
  if fact_status_value in ('partially_resolved', 'conflicting')
     and verification_status_value <> 'needs_review' then
    raise exception 'RADAR_FACT_STATUS_CONFLICT' using errcode = '22023';
  end if;

  context_hash := encode(extensions.digest(convert_to(context_value::text, 'UTF8'), 'sha256'), 'hex');
  source_hash := encode(extensions.digest(convert_to(source_value::text, 'UTF8'), 'sha256'), 'hex');
  decision_hash_value := encode(extensions.digest(convert_to(jsonb_build_object(
    'attempt_id', fact_check_input ->> 'attempt_id',
    'candidate_id', candidate.id,
    'preparation_revision', preparation_revision_input,
    'purpose', purpose_input,
    'checked_at', checked_at_value,
    'fact_policy_version', 'atinara-terminal-fact-gate-v2',
    'fact_status', fact_status_value,
    'verification_status', verification_status_value,
    'reason_code', fact_check_input ->> 'reason_code',
    'context_sha256', context_hash,
    'source_sha256', source_hash
  )::text, 'UTF8'), 'sha256'), 'hex');

  insert into private.market_radar_fact_checks (
    provider, external_id, event_group_key, fact_context_fingerprint,
    fact_policy_version, fact_status, verification_status, reason_code,
    reason, confidence, evidence, checked_at, decision_hash, candidate_id,
    preparation_revision, purpose, attempt_id, context_snapshot,
    context_sha256, source_snapshot, source_sha256, expires_at
  ) values (
    candidate.provider, candidate.external_id,
    nullif(left(fact_check_input ->> 'event_group_key', 240), ''),
    context_hash, 'atinara-terminal-fact-gate-v2', fact_status_value,
    verification_status_value,
    nullif(left(fact_check_input ->> 'reason_code', 100), ''),
    nullif(left(fact_check_input ->> 'reason', 1000), ''),
    least(greatest(coalesce((fact_check_input ->> 'confidence')::numeric, 0), 0), 100),
    source_value, checked_at_value, decision_hash_value, candidate.id,
    preparation_revision_input, purpose_input,
    (fact_check_input ->> 'attempt_id')::uuid,
    context_value, context_hash, source_value, source_hash, expires_at_value
  ) returning id into fact_id_value;
  return fact_id_value;
exception
  when unique_violation then
    raise exception 'RADAR_FACT_ATTEMPT_REPLAY' using errcode = '23505';
  when invalid_text_representation or numeric_value_out_of_range then
    raise exception 'INVALID_RADAR_FACT_CHECK_V2' using errcode = '22023';
end;
$function$;

revoke all on function private.insert_market_radar_fact_check_v2(uuid,bigint,text,jsonb)
  from public, anon, authenticated;

create or replace function private.enforce_authoritative_radar_fact_gate_v2()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if new.fact_status = 'fully_resolved' then
    new.verification_status := 'rejected_resolved';
    new.verification_reason_code := 'EVENT_ALREADY_RESOLVED';
    new.quality_status := 'rejected';
    if new.state not in ('prepared', 'dismissed') then new.state := 'rejected'; end if;
  elsif new.fact_status in ('partially_resolved', 'conflicting', 'unknown') then
    new.verification_status := 'needs_review';
    new.verification_reason_code := 'VERIFICATION_REQUIRED';
    new.quality_status := 'needs_review';
    new.verification_expires_at := null;
    if new.state not in ('prepared', 'dismissed') then new.state := 'needs_review'; end if;
  elsif new.verification_status = 'verified_open' and (
       new.fact_status is distinct from 'unresolved'
       or new.fact_policy_version is distinct from 'atinara-terminal-fact-gate-v2'
       or new.current_fact_check_id is null
       or new.fact_context_fingerprint !~ '^[0-9a-f]{64}$'
       or new.fact_checked_at is null
       or new.fact_check_expires_at is null
       or new.fact_check_expires_at <= now()
     ) then
    new.verification_status := 'needs_review';
    new.verification_reason_code := 'VERIFICATION_REQUIRED';
    new.verification_reason := 'Falta una comprobacion factual autoritativa vigente.';
    new.quality_status := 'needs_review';
    new.verification_expires_at := null;
    if new.state not in ('prepared', 'dismissed') then new.state := 'needs_review'; end if;
  end if;
  new.normalized_payload := coalesce(new.normalized_payload, '{}'::jsonb) || jsonb_build_object(
    'fact_status', new.fact_status,
    'fact_policy_version', new.fact_policy_version,
    'fact_context_fingerprint', new.fact_context_fingerprint,
    'fact_checked_at', new.fact_checked_at,
    'fact_check_expires_at', new.fact_check_expires_at,
    'fact_check_purpose', new.fact_check_purpose,
    'current_fact_check_id', new.current_fact_check_id,
    'verification_status', new.verification_status,
    'verification_reason_code', new.verification_reason_code,
    'verification_reason', new.verification_reason,
    'quality_status', new.quality_status,
    'state', new.state
  );
  return new;
end;
$function$;

revoke all on function private.enforce_authoritative_radar_fact_gate_v2()
  from public, anon, authenticated;

drop trigger if exists zzzz_authoritative_radar_fact_gate_v2_before_write
  on private.external_market_candidates;
create trigger zzzz_authoritative_radar_fact_gate_v2_before_write
before insert or update on private.external_market_candidates
for each row execute function private.enforce_authoritative_radar_fact_gate_v2();

-- Invalida toda aprobacion emitida por la semantica v1 o sin vinculo criptografico.
update private.external_market_candidates candidate set
  verification_status = 'needs_review',
  verification_reason_code = 'VERIFICATION_REQUIRED',
  verification_reason = 'La candidata debe pasar por la puerta factual autoritativa v2.',
  verification_expires_at = null,
  quality_status = case when candidate.state in ('prepared', 'dismissed') then candidate.quality_status else 'needs_review' end,
  state = case when candidate.state in ('prepared', 'dismissed') then candidate.state else 'needs_review' end,
  current_fact_check_id = null,
  fact_status = 'unknown',
  fact_policy_version = null,
  fact_context_fingerprint = null,
  fact_checked_at = null,
  fact_check_expires_at = null,
  fact_check_purpose = null,
  updated_at = now()
where candidate.verification_status = 'verified_open'
   or candidate.fact_policy_version is distinct from 'atinara-terminal-fact-gate-v2'
   or candidate.current_fact_check_id is null;

-- Un unico predicado autoritativo gobierna cualquier lectura de propuestas.
-- No basta con que la fila conserve el texto verified_open: el snapshot debe
-- ser discovery v2, append-only, vigente y estar ligado a la revision actual.
create or replace function private.market_radar_discovery_fact_current_v2(
  candidate private.external_market_candidates,
  checked_at_input timestamptz default now()
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select checked_at_input is not null
    and candidate.expires_at > checked_at_input
    and candidate.current_fact_check_id is not null
    and candidate.fact_check_purpose = 'discovery'
    and candidate.fact_policy_version = 'atinara-terminal-fact-gate-v2'
    and candidate.fact_context_fingerprint ~ '^[0-9a-f]{64}$'
    and exists (
      select 1
      from private.market_radar_fact_checks fact
      where fact.id = candidate.current_fact_check_id
        and fact.candidate_id = candidate.id
        and fact.provider = candidate.provider
        and fact.external_id = candidate.external_id
        and fact.event_group_key is not distinct from candidate.event_group_key
        and fact.preparation_revision = candidate.preparation_revision
        and fact.purpose = 'discovery'
        and fact.fact_policy_version = 'atinara-terminal-fact-gate-v2'
        and fact.fact_status = candidate.fact_status
        and fact.verification_status = candidate.verification_status
        and fact.context_sha256 = candidate.fact_context_fingerprint
        and fact.fact_context_fingerprint = candidate.fact_context_fingerprint
        and fact.context_sha256 ~ '^[0-9a-f]{64}$'
        and fact.source_sha256 ~ '^[0-9a-f]{64}$'
        and fact.checked_at is not distinct from candidate.fact_checked_at
        and fact.expires_at is not distinct from candidate.fact_check_expires_at
        and fact.checked_at <= checked_at_input + interval '1 minute'
        and fact.expires_at > checked_at_input
        and fact.source_snapshot = candidate.verification_evidence
        and (
          candidate.verification_status <> 'verified_open'
          or (
            candidate.state = 'available'
            and candidate.fact_status = 'unresolved'
            and candidate.verification_expires_at > checked_at_input
            and private.market_radar_sources_authorized_v1(fact.source_snapshot)
          )
        )
    );
$function$;

revoke all on function private.market_radar_discovery_fact_current_v2(
  private.external_market_candidates,timestamptz
) from public, anon, authenticated, service_role;

-- El payload normalizado nunca puede sobreescribir las columnas de la puerta.
create or replace function private.market_radar_safe_payload(candidate private.external_market_candidates)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
  select (candidate.normalized_payload
      - 'id' - 'preparation_revision' - 'current_fact_check_id'
      - 'fact_status' - 'fact_policy_version' - 'fact_context_fingerprint'
      - 'fact_checked_at' - 'fact_check_expires_at' - 'fact_check_purpose')
    || jsonb_build_object(
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
      'updated_at', candidate.updated_at
    ) || jsonb_build_object(
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
      'preparation_revision', candidate.preparation_revision,
      'current_fact_check_id', candidate.current_fact_check_id,
      'fact_status', candidate.fact_status,
      'fact_policy_version', candidate.fact_policy_version,
      'fact_context_fingerprint', candidate.fact_context_fingerprint,
      'fact_checked_at', candidate.fact_checked_at,
      'fact_check_expires_at', candidate.fact_check_expires_at,
      'fact_check_purpose', candidate.fact_check_purpose,
      'fact_snapshot_current', private.market_radar_discovery_fact_current_v2(candidate, now())
    );
$function$;

revoke all on function private.market_radar_safe_payload(private.external_market_candidates)
  from public, anon, authenticated;

-- El endpoint de propuestas solo devuelve filas cuyo puntero factual discovery
-- supera el predicado anterior en el mismo instante de la consulta.
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

  select coalesce(jsonb_agg(private.market_radar_safe_payload(candidate_row)), '[]'::jsonb)
  into result
  from (
    select candidate.*
    from private.external_market_candidates candidate
    where candidate.normalizer_version = 'atinara-radar-v2'
      and candidate.state in ('available', 'needs_review')
      and candidate.verification_status in ('verified_open', 'needs_review')
      and candidate.quality_status <> 'rejected'
      and private.market_radar_discovery_fact_current_v2(candidate, checked_at_value)
      and (
        coalesce(
          nullif(candidate.normalized_payload ->> 'source_close_at', '')::timestamptz,
          nullif(candidate.normalized_payload ->> 'atinara_closes_at', '')::timestamptz
        ) is null
        or coalesce(
          nullif(candidate.normalized_payload ->> 'source_close_at', '')::timestamptz,
          nullif(candidate.normalized_payload ->> 'atinara_closes_at', '')::timestamptz
        ) <= checked_at_value + case horizon_filter
          when '30d' then interval '30 days'
          when '90d' then interval '90 days'
          when '365d' then interval '365 days'
          else interval '180 days'
        end
      )
      and (provider_filter is null or provider_filter = '' or candidate.provider = provider_filter)
      and (category_filter is null or category_filter = '' or candidate.atinara_category = category_filter)
      and (
        quality_filter is null or quality_filter = '' or quality_filter = 'all'
        or (quality_filter = 'fit' and candidate.verification_status = 'verified_open')
        or (quality_filter = 'review' and candidate.verification_status in ('verified_open', 'needs_review'))
      )
      and (
        query_filter is null or query_filter = ''
        or candidate.normalized_payload ->> 'source_title' ilike '%' || query_filter || '%'
        or candidate.normalized_payload ->> 'source_question' ilike '%' || query_filter || '%'
        or candidate.normalized_payload ->> 'atinara_question' ilike '%' || query_filter || '%'
      )
    order by
      case when order_key = 'recommended' then candidate.quality_score end desc nulls last,
      case when order_key = 'popularity' then coalesce((candidate.normalized_payload ->> 'source_volume_total')::numeric, 0) end desc nulls last,
      case when order_key = 'closing' then nullif(candidate.normalized_payload ->> 'source_close_at', '')::timestamptz end asc nulls last,
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

-- La firma v1 podia omitir la puerta factual y deja de ser una API valida.
revoke all on function public.list_market_radar_candidates(
  text,text,text,text,text,text,integer,integer
) from public, anon, authenticated, service_role;

create or replace function public.get_market_radar_candidate(candidate_id_input uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  candidate private.external_market_candidates%rowtype;
begin
  perform private.require_current_admin();
  select * into candidate
  from private.external_market_candidates candidate_alias
  where candidate_alias.id = candidate_id_input;
  if not found then
    raise exception 'RADAR_CANDIDATE_NOT_FOUND' using errcode = 'P0001';
  end if;
  if not private.market_radar_discovery_fact_current_v2(candidate, now()) then
    raise exception 'RADAR_FACTUAL_REFRESH_REQUIRED' using errcode = '55000';
  end if;
  return private.market_radar_safe_payload(candidate);
end;
$function$;

revoke all on function public.get_market_radar_candidate(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.get_market_radar_candidate(uuid)
  to authenticated;

-- Lectura exclusiva de la Edge para volver a comprobar una fila bloqueada. Si
-- el snapshot discovery no es vigente, el payload nunca conserva verified_open.
create or replace function public.get_market_radar_candidate_for_revalidation_v1(
  candidate_id_input uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  candidate private.external_market_candidates%rowtype;
  payload_value jsonb;
begin
  if auth.role() <> 'service_role' then
    raise exception 'SERVICE_ROLE_REQUIRED' using errcode = '42501';
  end if;
  select * into candidate
  from private.external_market_candidates candidate_alias
  where candidate_alias.id = candidate_id_input;
  if not found then
    raise exception 'RADAR_CANDIDATE_NOT_FOUND' using errcode = 'P0001';
  end if;
  payload_value := private.market_radar_safe_payload(candidate);
  if candidate.verification_status = 'verified_open'
     and not private.market_radar_discovery_fact_current_v2(candidate, now()) then
    payload_value := payload_value || jsonb_build_object(
      'verification_status', 'needs_review',
      'verification_reason_code', 'VERIFICATION_REQUIRED',
      'verification_reason', 'La caché no es una comprobación factual vigente; la Edge debe revalidarla.',
      'fact_snapshot_current', false,
      'requires_factual_refresh', true
    );
  end if;
  return payload_value;
end;
$function$;

revoke all on function public.get_market_radar_candidate_for_revalidation_v1(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.get_market_radar_candidate_for_revalidation_v1(uuid)
  to service_role;

-- El Agente Editor compartía una lectura lateral del candidato. Conserva los
-- demás orígenes, pero un radar_candidate obedece exactamente la misma puerta.
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
  gate_error text;
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
    if found and not private.market_radar_discovery_fact_current_v2(candidate, now()) then
      select * into fact_row
      from private.market_radar_fact_checks fact_alias
      where fact_alias.id = candidate.current_fact_check_id;
      if not found
         or candidate.state not in ('available', 'prepared')
         or fact_row.purpose <> 'revalidate' then
        raise exception 'RADAR_FACTUAL_REFRESH_REQUIRED' using errcode = '55000';
      end if;
      gate_error := private.market_radar_fact_gate_error_v2(
        candidate.id, fact_row.preparation_revision, 'revalidate',
        now(), fact_row.id
      );
      if gate_error is not null then
        raise exception 'RADAR_FACTUAL_REFRESH_REQUIRED'
          using errcode = '55000', detail = gate_error;
      end if;
    end if;
    if found then result := private.market_radar_safe_payload(candidate); end if;
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

create or replace function public.upsert_market_radar_batch_with_fact_checks_v1(
  provider_input text,
  cache_key_input text,
  normalizer_version_input text,
  candidates_input jsonb,
  fact_checks_input jsonb,
  fact_policy_version_input text,
  provider_status_input jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  item jsonb;
  check_item jsonb;
  candidate private.external_market_candidates%rowtype;
  fact_row private.market_radar_fact_checks%rowtype;
  fact_id_value bigint;
  desired_verification text;
  desired_state text;
  desired_quality text;
  expected_revision bigint;
  upsert_result jsonb;
  linked_count integer := 0;
begin
  if auth.role() <> 'service_role' then
    raise exception 'SERVICE_ROLE_REQUIRED' using errcode = '42501';
  end if;
  if fact_policy_version_input <> 'atinara-terminal-fact-gate-v2'
     or jsonb_typeof(candidates_input) <> 'array'
     or jsonb_typeof(fact_checks_input) <> 'array'
     or jsonb_array_length(candidates_input) <> jsonb_array_length(fact_checks_input)
     or jsonb_array_length(candidates_input) > 240 then
    raise exception 'INVALID_AUTHORITATIVE_RADAR_BATCH' using errcode = '22023';
  end if;

  upsert_result := public.upsert_market_radar_batch_v2(
    provider_input, cache_key_input, normalizer_version_input,
    candidates_input, provider_status_input
  );

  for item in select value from jsonb_array_elements(candidates_input)
  loop
    select value into check_item
    from jsonb_array_elements(fact_checks_input)
    where value ->> 'provider' = provider_input
      and value ->> 'external_id' = item ->> 'external_id';
    if check_item is null then
      raise exception 'RADAR_FACT_CHECK_REQUIRED' using errcode = '22023';
    end if;
    select * into candidate
    from private.external_market_candidates candidate_alias
    where candidate_alias.provider = provider_input
      and candidate_alias.external_id = item ->> 'external_id'
    for update;
    if not found then
      raise exception 'RADAR_CANDIDATE_NOT_FOUND' using errcode = 'P0001';
    end if;
    expected_revision := candidate.preparation_revision + 1;
    fact_id_value := private.insert_market_radar_fact_check_v2(
      candidate.id, expected_revision, 'discovery', check_item
    );
    select * into fact_row
    from private.market_radar_fact_checks fact_alias
    where fact_alias.id = fact_id_value;

    desired_verification := item ->> 'verification_status';
    if fact_row.fact_status = 'fully_resolved' then
      desired_verification := 'rejected_resolved';
    elsif fact_row.fact_status in ('partially_resolved', 'conflicting', 'unknown') then
      desired_verification := 'needs_review';
    end if;
    desired_state := case
      when desired_verification = 'verified_open' then 'available'
      when desired_verification in ('pending', 'needs_review') then 'needs_review'
      else 'rejected'
    end;
    desired_quality := case
      when desired_verification = 'verified_open' then 'fit'
      when desired_verification in ('pending', 'needs_review') then 'needs_review'
      else 'rejected'
    end;

    update private.external_market_candidates candidate_alias set
      normalized_payload = (item - 'id' - 'preparation_revision') || jsonb_build_object(
        'current_fact_check_id', fact_id_value,
        'fact_status', fact_row.fact_status,
        'fact_policy_version', fact_row.fact_policy_version,
        'fact_context_fingerprint', fact_row.context_sha256,
        'fact_checked_at', fact_row.checked_at,
        'fact_check_expires_at', fact_row.expires_at,
        'fact_check_purpose', fact_row.purpose,
        'verification_status', desired_verification
      ),
      current_fact_check_id = fact_id_value,
      fact_status = fact_row.fact_status,
      fact_policy_version = fact_row.fact_policy_version,
      fact_context_fingerprint = fact_row.context_sha256,
      fact_checked_at = fact_row.checked_at,
      fact_check_expires_at = fact_row.expires_at,
      fact_check_purpose = fact_row.purpose,
      verification_status = desired_verification,
      verification_reason_code = case
        when fact_row.fact_status = 'fully_resolved' then 'EVENT_ALREADY_RESOLVED'
        when fact_row.fact_status in ('partially_resolved', 'conflicting', 'unknown') then 'VERIFICATION_REQUIRED'
        else nullif(left(item ->> 'verification_reason_code', 100), '')
      end,
      verification_reason = nullif(left(item ->> 'verification_reason', 1000), ''),
      verified_at = nullif(item ->> 'verified_at', '')::timestamptz,
      verification_expires_at = case when desired_verification = 'verified_open'
        then nullif(item ->> 'verification_expires_at', '')::timestamptz else null end,
      verification_evidence = fact_row.source_snapshot,
      quality_status = desired_quality,
      state = case when candidate_alias.state in ('prepared', 'dismissed')
        then candidate_alias.state else desired_state end,
      updated_at = now()
    where candidate_alias.id = candidate.id;

    select * into candidate
    from private.external_market_candidates candidate_alias
    where candidate_alias.id = candidate.id;
    if candidate.preparation_revision <> expected_revision
       or candidate.current_fact_check_id <> fact_id_value then
      raise exception 'RADAR_FACT_LINK_REVISION_MISMATCH' using errcode = '40001';
    end if;
    linked_count := linked_count + 1;
  end loop;
  return upsert_result || jsonb_build_object(
    'fact_checks_linked', linked_count,
    'fact_policy_version', 'atinara-terminal-fact-gate-v2',
    'atomic', true
  );
exception
  when invalid_datetime_format then
    raise exception 'INVALID_AUTHORITATIVE_RADAR_BATCH' using errcode = '22023';
end;
$function$;

revoke all on function public.upsert_market_radar_batch_with_fact_checks_v1(text,text,text,jsonb,jsonb,text,jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.upsert_market_radar_batch_with_fact_checks_v1(text,text,text,jsonb,jsonb,text,jsonb)
  to service_role;

-- Las APIs anteriores quedan disponibles solo para invocacion interna del owner.
revoke all on function public.upsert_market_radar_batch_v2(text,text,text,jsonb,jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.record_market_radar_fact_checks(jsonb)
  from public, anon, authenticated, service_role;

create or replace function private.market_radar_fact_gate_error_v2(
  candidate_id_input uuid,
  expected_preparation_revision_input bigint,
  required_purpose_input text,
  checked_at_input timestamptz,
  expected_fact_check_id_input bigint default null
)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  candidate private.external_market_candidates%rowtype;
  fact_row private.market_radar_fact_checks%rowtype;
  checked_at_value timestamptz := greatest(now(), coalesce(checked_at_input, now()));
begin
  select * into candidate
  from private.external_market_candidates candidate_alias
  where candidate_alias.id = candidate_id_input;
  if not found then return 'CANDIDATE_NOT_FOUND'; end if;
  if required_purpose_input not in ('discovery', 'prepare', 'revalidate') then
    return 'FACT_CHECK_REQUIRED';
  end if;
  if candidate.current_fact_check_id is null
     or (expected_fact_check_id_input is not null
       and candidate.current_fact_check_id <> expected_fact_check_id_input) then
    return 'FACT_CHECK_REQUIRED';
  end if;
  select * into fact_row
  from private.market_radar_fact_checks fact_alias
  where fact_alias.id = candidate.current_fact_check_id;
  if not found
     or fact_row.candidate_id <> candidate.id
     or fact_row.provider <> candidate.provider
     or fact_row.external_id <> candidate.external_id
     or fact_row.purpose <> required_purpose_input
     or fact_row.fact_policy_version <> 'atinara-terminal-fact-gate-v2'
     or fact_row.fact_status <> 'unresolved'
     or fact_row.verification_status <> 'verified_open'
     or fact_row.context_sha256 !~ '^[0-9a-f]{64}$'
     or fact_row.source_sha256 !~ '^[0-9a-f]{64}$'
     or fact_row.fact_context_fingerprint <> fact_row.context_sha256
     or fact_row.context_sha256 <> candidate.fact_context_fingerprint
     or fact_row.checked_at <> candidate.fact_checked_at
     or fact_row.expires_at <> candidate.fact_check_expires_at
     or candidate.fact_policy_version <> fact_row.fact_policy_version
     or candidate.fact_status <> fact_row.fact_status
     or candidate.fact_check_purpose <> fact_row.purpose
     or candidate.verification_status <> fact_row.verification_status
     or fact_row.checked_at > checked_at_value + interval '1 minute'
     or fact_row.expires_at <= checked_at_value
     or not private.market_radar_sources_authorized_v1(fact_row.source_snapshot) then
    return 'FACT_CHECK_REQUIRED';
  end if;
  if expected_preparation_revision_input is null then
    return 'PREPARATION_REVISION_MISMATCH';
  end if;
  if candidate.state = 'prepared' then
    if candidate.preparation_revision not in (
      expected_preparation_revision_input,
      expected_preparation_revision_input + 1
    ) or fact_row.preparation_revision <> expected_preparation_revision_input then
      return 'PREPARATION_REVISION_MISMATCH';
    end if;
  elsif candidate.preparation_revision <> expected_preparation_revision_input
     or fact_row.preparation_revision <> expected_preparation_revision_input then
    return 'PREPARATION_REVISION_MISMATCH';
  end if;
  return null;
end;
$function$;

revoke all on function private.market_radar_fact_gate_error_v2(uuid,bigint,text,timestamptz,bigint)
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
  checked_at_value timestamptz := greatest(now(), coalesce(verification_checked_at_input, now()));
  gate_error text;
begin
  if auth.role() <> 'service_role' then perform private.require_current_admin(); end if;
  select * into candidate
  from private.external_market_candidates candidate_alias
  where candidate_alias.id = candidate_id_input
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'CANDIDATE_NOT_FOUND');
  end if;
  if normalizer_version_input <> 'atinara-radar-v2'
     or candidate.normalizer_version <> normalizer_version_input then
    return jsonb_build_object('ok', false, 'error', 'NORMALIZER_OUTDATED');
  end if;
  if coalesce(candidate.normalized_payload ->> 'eligibility_policy_version', '')
       <> 'atinara-prediction-policy-v4' then
    return jsonb_build_object('ok', false, 'error', 'ELIGIBILITY_POLICY_OUTDATED');
  end if;
  gate_error := private.market_radar_fact_gate_error_v2(
    candidate.id, candidate.preparation_revision, 'prepare', checked_at_value,
    candidate.current_fact_check_id
  );
  if gate_error is not null then
    return jsonb_build_object('ok', false, 'error', gate_error,
      'candidate', private.market_radar_safe_payload(candidate));
  end if;
  if candidate.state <> 'available' or candidate.verification_status <> 'verified_open' then
    return jsonb_build_object('ok', false, 'error', 'VERIFICATION_REQUIRED');
  end if;
  if candidate.expires_at <= checked_at_value
     or candidate.verification_expires_at is null
     or candidate.verification_expires_at <= checked_at_value then
    return jsonb_build_object('ok', false, 'error', 'VERIFICATION_EXPIRED');
  end if;
  if coalesce(candidate.normalized_payload ->> 'atinara_question', '') = ''
     or coalesce(candidate.normalized_payload ->> 'atinara_resolution_criteria', '') = ''
     or coalesce(candidate.normalized_payload ->> 'atinara_resolution_source_url', '') !~ '^https://' then
    return jsonb_build_object('ok', false, 'error', 'RESOLUTION_SOURCE_REQUIRED');
  end if;
  if private.market_candidate_has_blocking_duplicate(candidate.duplicate_matches, candidate.id) then
    return jsonb_build_object('ok', false, 'error', 'CONFIRMED_DUPLICATE');
  end if;
  return jsonb_build_object(
    'ok', true,
    'candidate_id', candidate.id,
    'preparation_revision', candidate.preparation_revision,
    'fact_check_id', candidate.current_fact_check_id,
    'checked_at', checked_at_value,
    'candidate', private.market_radar_safe_payload(candidate)
  );
end;
$function$;

revoke all on function public.reserve_market_radar_candidate_for_prepare(uuid,text,timestamptz)
  from public, anon, authenticated, service_role;
grant execute on function public.reserve_market_radar_candidate_for_prepare(uuid,text,timestamptz)
  to authenticated, service_role;

-- La firma antigua no puede aceptar un dictamen sin snapshot.
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
begin
  if auth.role() <> 'service_role' then
    raise exception 'SERVICE_ROLE_REQUIRED' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'ok', false,
    'error', 'FACT_CHECK_REQUIRED',
    'message', 'Usa la verificacion factual autoritativa con snapshot v2.'
  );
end;
$function$;

revoke all on function public.apply_market_radar_prepare_verification(uuid,bigint,text,timestamptz,jsonb)
  from public, anon, authenticated, service_role;

create or replace function public.apply_market_radar_prepare_fact_verification_v1(
  candidate_id_input uuid,
  expected_preparation_revision_input bigint,
  normalizer_version_input text,
  verification_checked_at_input timestamptz,
  verification_input jsonb,
  fact_check_input jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  candidate private.external_market_candidates%rowtype;
  fact_row private.market_radar_fact_checks%rowtype;
  checked_at_value timestamptz := greatest(now(), coalesce(verification_checked_at_input, now()));
  verification_expiry timestamptz;
  cache_expiry timestamptz;
  verification_status_value text;
  final_verification_status text;
  mapped_state text;
  mapped_quality text;
  expected_revision bigint;
  fact_id_value bigint;
  readiness_error text;
  reservation jsonb;
begin
  if auth.role() <> 'service_role' then
    raise exception 'SERVICE_ROLE_REQUIRED' using errcode = '42501';
  end if;
  select * into candidate
  from private.external_market_candidates candidate_alias
  where candidate_alias.id = candidate_id_input
  for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'CANDIDATE_NOT_FOUND'); end if;
  if expected_preparation_revision_input is null
     or candidate.preparation_revision <> expected_preparation_revision_input then
    return jsonb_build_object('ok', false, 'error', 'PREPARATION_REVISION_MISMATCH',
      'preparation_revision', candidate.preparation_revision,
      'candidate', private.market_radar_safe_payload(candidate));
  end if;
  if normalizer_version_input <> 'atinara-radar-v2'
     or candidate.normalizer_version <> normalizer_version_input then
    return jsonb_build_object('ok', false, 'error', 'NORMALIZER_OUTDATED');
  end if;
  if candidate.state in ('prepared', 'dismissed') then
    return jsonb_build_object('ok', false, 'error', 'CANDIDATE_NOT_PREPARABLE');
  end if;
  if jsonb_typeof(verification_input) <> 'object'
     or jsonb_typeof(fact_check_input) <> 'object'
     or coalesce(verification_input ->> 'eligibility_policy_version', '')
       <> 'atinara-prediction-policy-v4'
     or coalesce(verification_input ->> 'fact_policy_version', '')
       <> 'atinara-terminal-fact-gate-v2' then
    return jsonb_build_object('ok', false, 'error', 'INVALID_VERIFICATION_PAYLOAD');
  end if;
  verification_status_value := coalesce(verification_input ->> 'verification_status', '');
  if verification_status_value not in (
    'pending', 'verified_open', 'needs_review', 'rejected_resolved',
    'rejected_stale', 'rejected_ineligible', 'rejected_unannounced',
    'rejected_incoherent', 'rejected_invalid_source', 'rejected_duplicate'
  ) then return jsonb_build_object('ok', false, 'error', 'INVALID_VERIFICATION_STATUS'); end if;
  if jsonb_typeof(coalesce(verification_input -> 'verification_evidence', '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(verification_input -> 'warnings', '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(verification_input -> 'duplicate_matches', '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(verification_input -> 'score_breakdown', '{}'::jsonb)) <> 'object' then
    return jsonb_build_object('ok', false, 'error', 'INVALID_VERIFICATION_PAYLOAD');
  end if;
  begin
    verification_expiry := nullif(verification_input ->> 'verification_expires_at', '')::timestamptz;
    cache_expiry := coalesce(
      nullif(verification_input ->> 'cache_expires_at', '')::timestamptz,
      nullif(verification_input ->> 'expires_at', '')::timestamptz
    );
  exception when invalid_datetime_format then
    return jsonb_build_object('ok', false, 'error', 'INVALID_VERIFICATION_DATE');
  end;
  if verification_status_value = 'verified_open' and (
     verification_expiry is null or verification_expiry <= checked_at_value
     or cache_expiry is null or cache_expiry <= checked_at_value
     or coalesce(verification_input ->> 'atinara_question', '') = ''
     or coalesce(verification_input ->> 'atinara_resolution_criteria', '') = ''
     or coalesce(verification_input ->> 'atinara_resolution_source_url', '') !~ '^https://'
  ) then return jsonb_build_object('ok', false, 'error', 'VERIFICATION_REQUIRED'); end if;
  cache_expiry := coalesce(cache_expiry, checked_at_value + interval '10 minutes');
  expected_revision := candidate.preparation_revision + 1;
  begin
    fact_id_value := private.insert_market_radar_fact_check_v2(
      candidate.id, expected_revision, 'prepare', fact_check_input
    );
  exception when others then
    return jsonb_build_object('ok', false, 'error', sqlerrm, 'persisted', false);
  end;
  select * into fact_row from private.market_radar_fact_checks where id = fact_id_value;

  final_verification_status := verification_status_value;
  if fact_row.fact_status = 'fully_resolved' then
    final_verification_status := 'rejected_resolved';
  elsif fact_row.fact_status in ('partially_resolved', 'conflicting', 'unknown') then
    final_verification_status := 'needs_review';
  end if;
  mapped_state := case
    when final_verification_status = 'verified_open' then 'available'
    when final_verification_status in ('pending', 'needs_review') then 'needs_review'
    else 'rejected'
  end;
  mapped_quality := case
    when final_verification_status = 'verified_open' then 'fit'
    when final_verification_status in ('pending', 'needs_review') then 'needs_review'
    else 'rejected'
  end;

  update private.external_market_candidates candidate_alias set
    fingerprint = coalesce(nullif(verification_input ->> 'fingerprint', ''), candidate_alias.fingerprint),
    normalizer_version = normalizer_version_input,
    source_status = nullif(verification_input ->> 'source_status', ''),
    atinara_category = nullif(verification_input ->> 'atinara_category', ''),
    normalized_payload = (verification_input - 'id' - 'preparation_revision') || jsonb_build_object(
      'current_fact_check_id', fact_id_value,
      'fact_status', fact_row.fact_status,
      'fact_policy_version', fact_row.fact_policy_version,
      'fact_context_fingerprint', fact_row.context_sha256,
      'fact_checked_at', fact_row.checked_at,
      'fact_check_expires_at', fact_row.expires_at,
      'fact_check_purpose', fact_row.purpose,
      'verification_status', final_verification_status
    ),
    quality_status = mapped_quality,
    quality_score = least(greatest(coalesce((verification_input ->> 'quality_score')::numeric, candidate_alias.quality_score), 0), 100),
    score_breakdown = coalesce(verification_input -> 'score_breakdown', candidate_alias.score_breakdown),
    warnings = coalesce(verification_input -> 'warnings', '[]'::jsonb),
    duplicate_matches = coalesce(verification_input -> 'duplicate_matches', '[]'::jsonb),
    fetched_at = checked_at_value,
    source_updated_at = nullif(verification_input ->> 'source_updated_at', '')::timestamptz,
    expires_at = cache_expiry,
    state = mapped_state,
    verification_status = final_verification_status,
    verification_reason_code = case
      when fact_row.fact_status = 'fully_resolved' then 'EVENT_ALREADY_RESOLVED'
      when fact_row.fact_status in ('partially_resolved', 'conflicting', 'unknown') then 'VERIFICATION_REQUIRED'
      else nullif(left(verification_input ->> 'verification_reason_code', 100), '')
    end,
    verification_reason = nullif(left(verification_input ->> 'verification_reason', 1000), ''),
    verified_at = coalesce(nullif(verification_input ->> 'verified_at', '')::timestamptz, checked_at_value),
    verification_expires_at = case when final_verification_status = 'verified_open' then verification_expiry else null end,
    verification_evidence = fact_row.source_snapshot,
    event_group_key = coalesce(nullif(left(verification_input ->> 'event_group_key', 240), ''), candidate_alias.event_group_key),
    external_event_url = coalesce(nullif(verification_input ->> 'external_event_url', ''), candidate_alias.external_event_url),
    external_market_url = coalesce(nullif(verification_input ->> 'external_market_url', ''), candidate_alias.external_market_url),
    external_event_slug = coalesce(nullif(verification_input ->> 'external_event_slug', ''), candidate_alias.external_event_slug),
    external_market_slug = coalesce(nullif(verification_input ->> 'external_market_slug', ''), candidate_alias.external_market_slug),
    current_fact_check_id = fact_id_value,
    fact_status = fact_row.fact_status,
    fact_policy_version = fact_row.fact_policy_version,
    fact_context_fingerprint = fact_row.context_sha256,
    fact_checked_at = fact_row.checked_at,
    fact_check_expires_at = fact_row.expires_at,
    fact_check_purpose = fact_row.purpose,
    updated_at = now()
  where candidate_alias.id = candidate.id;

  select * into candidate
  from private.external_market_candidates candidate_alias
  where candidate_alias.id = candidate.id
  for update;
  if candidate.preparation_revision <> expected_revision
     or candidate.current_fact_check_id <> fact_id_value then
    raise exception 'RADAR_FACT_LINK_REVISION_MISMATCH' using errcode = '40001';
  end if;

  if candidate.verification_status <> 'verified_open'
     or candidate.fact_status <> 'unresolved' then
    readiness_error := case candidate.verification_status
      when 'rejected_resolved' then 'RADAR_CANDIDATE_RESOLVED'
      when 'rejected_unannounced' then 'RADAR_CANDIDATE_UNANNOUNCED'
      when 'rejected_invalid_source' then 'RADAR_CANONICAL_URL_INVALID'
      when 'rejected_duplicate' then 'RADAR_CONFIRMED_DUPLICATE'
      when 'rejected_stale' then 'VERIFICATION_EXPIRED'
      else 'RADAR_REVALIDATION_REQUIRED'
    end;
    return jsonb_build_object(
      'ok', false, 'error', readiness_error,
      'candidate_id', candidate.id,
      'preparation_revision', candidate.preparation_revision,
      'fact_check_id', fact_id_value,
      'candidate', private.market_radar_safe_payload(candidate),
      'persisted', true, 'atomic', true
    );
  end if;

  reservation := public.reserve_market_radar_candidate_for_prepare(
    candidate.id, normalizer_version_input, checked_at_value
  );
  if not coalesce((reservation ->> 'ok')::boolean, false) then
    return reservation || jsonb_build_object(
      'ok', false, 'candidate_id', candidate.id,
      'preparation_revision', candidate.preparation_revision,
      'fact_check_id', fact_id_value,
      'candidate', private.market_radar_safe_payload(candidate),
      'persisted', true, 'atomic', true
    );
  end if;
  return jsonb_build_object(
    'ok', true, 'candidate_id', candidate.id,
    'preparation_revision', candidate.preparation_revision,
    'fact_check_id', fact_id_value,
    'candidate', private.market_radar_safe_payload(candidate),
    'reservation', reservation, 'persisted', true, 'atomic', true
  );
exception
  when invalid_text_representation or numeric_value_out_of_range or invalid_datetime_format then
    return jsonb_build_object('ok', false, 'error', 'INVALID_VERIFICATION_PAYLOAD');
end;
$function$;

revoke all on function public.apply_market_radar_prepare_fact_verification_v1(uuid,bigint,text,timestamptz,jsonb,jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.apply_market_radar_prepare_fact_verification_v1(uuid,bigint,text,timestamptz,jsonb,jsonb)
  to service_role;

-- Revalidacion factual post-preparacion. Persiste un snapshot purpose=revalidate
-- y actualiza el vinculo actual sin reservar de nuevo ni tocar el borrador.
create or replace function public.apply_market_radar_revalidation_fact_v1(
  candidate_id_input uuid,
  expected_preparation_revision_input bigint,
  normalizer_version_input text,
  verification_checked_at_input timestamptz,
  verification_input jsonb,
  fact_check_input jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  candidate private.external_market_candidates%rowtype;
  fact_row private.market_radar_fact_checks%rowtype;
  checked_at_value timestamptz := greatest(clock_timestamp(), coalesce(verification_checked_at_input, clock_timestamp()));
  verification_expiry timestamptz;
  cache_expiry timestamptz;
  verification_status_value text;
  final_verification_status text;
  mapped_state text;
  mapped_quality text;
  expected_revision bigint;
  fact_id_value bigint;
  readiness_error text;
begin
  if auth.role() <> 'service_role' then
    raise exception 'SERVICE_ROLE_REQUIRED' using errcode = '42501';
  end if;
  select * into candidate
  from private.external_market_candidates candidate_alias
  where candidate_alias.id = candidate_id_input
  for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'CANDIDATE_NOT_FOUND'); end if;
  if expected_preparation_revision_input is null
     or candidate.preparation_revision <> expected_preparation_revision_input then
    return jsonb_build_object(
      'ok', false, 'error', 'PREPARATION_REVISION_MISMATCH',
      'preparation_revision', candidate.preparation_revision,
      'candidate', private.market_radar_safe_payload(candidate)
    );
  end if;
  if normalizer_version_input <> 'atinara-radar-v2'
     or candidate.normalizer_version <> normalizer_version_input then
    return jsonb_build_object('ok', false, 'error', 'NORMALIZER_OUTDATED');
  end if;
  if candidate.state not in ('available', 'prepared') then
    return jsonb_build_object('ok', false, 'error', 'CANDIDATE_NOT_REVALIDATABLE');
  end if;
  if jsonb_typeof(verification_input) <> 'object'
     or jsonb_typeof(fact_check_input) <> 'object'
     or coalesce(verification_input ->> 'eligibility_policy_version', '')
       <> 'atinara-prediction-policy-v4'
     or coalesce(verification_input ->> 'fact_policy_version', '')
       <> 'atinara-terminal-fact-gate-v2' then
    return jsonb_build_object('ok', false, 'error', 'INVALID_VERIFICATION_PAYLOAD');
  end if;
  verification_status_value := coalesce(verification_input ->> 'verification_status', '');
  if verification_status_value not in (
    'pending', 'verified_open', 'needs_review', 'rejected_resolved',
    'rejected_stale', 'rejected_ineligible', 'rejected_unannounced',
    'rejected_incoherent', 'rejected_invalid_source', 'rejected_duplicate'
  ) then return jsonb_build_object('ok', false, 'error', 'INVALID_VERIFICATION_STATUS'); end if;
  if jsonb_typeof(coalesce(verification_input -> 'verification_evidence', '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(verification_input -> 'warnings', '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(verification_input -> 'duplicate_matches', '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(verification_input -> 'score_breakdown', '{}'::jsonb)) <> 'object' then
    return jsonb_build_object('ok', false, 'error', 'INVALID_VERIFICATION_PAYLOAD');
  end if;
  begin
    verification_expiry := nullif(verification_input ->> 'verification_expires_at', '')::timestamptz;
    cache_expiry := coalesce(
      nullif(verification_input ->> 'cache_expires_at', '')::timestamptz,
      nullif(verification_input ->> 'expires_at', '')::timestamptz
    );
  exception when invalid_datetime_format then
    return jsonb_build_object('ok', false, 'error', 'INVALID_VERIFICATION_DATE');
  end;
  if verification_status_value = 'verified_open' and (
     verification_expiry is null or verification_expiry <= checked_at_value
     or cache_expiry is null or cache_expiry <= checked_at_value
     or coalesce(verification_input ->> 'atinara_question', '') = ''
     or coalesce(verification_input ->> 'atinara_resolution_criteria', '') = ''
     or coalesce(verification_input ->> 'atinara_resolution_source_url', '') !~ '^https://'
  ) then return jsonb_build_object('ok', false, 'error', 'VERIFICATION_REQUIRED'); end if;

  cache_expiry := coalesce(cache_expiry, checked_at_value + interval '10 minutes');
  expected_revision := candidate.preparation_revision + 1;
  begin
    fact_id_value := private.insert_market_radar_fact_check_v2(
      candidate.id, expected_revision, 'revalidate', fact_check_input
    );
  exception when others then
    return jsonb_build_object('ok', false, 'error', sqlerrm, 'persisted', false);
  end;
  select * into fact_row
  from private.market_radar_fact_checks fact_alias
  where fact_alias.id = fact_id_value;

  final_verification_status := verification_status_value;
  if fact_row.fact_status = 'fully_resolved' then
    final_verification_status := 'rejected_resolved';
  elsif fact_row.fact_status in ('partially_resolved', 'conflicting', 'unknown') then
    final_verification_status := 'needs_review';
  end if;
  mapped_state := case
    when candidate.state = 'prepared' then 'prepared'
    when final_verification_status = 'verified_open' then 'available'
    when final_verification_status in ('pending', 'needs_review') then 'needs_review'
    else 'rejected'
  end;
  mapped_quality := case
    when final_verification_status = 'verified_open' then 'fit'
    when final_verification_status in ('pending', 'needs_review') then 'needs_review'
    else 'rejected'
  end;

  update private.external_market_candidates candidate_alias set
    fingerprint = coalesce(nullif(verification_input ->> 'fingerprint', ''), candidate_alias.fingerprint),
    normalizer_version = normalizer_version_input,
    source_status = nullif(verification_input ->> 'source_status', ''),
    atinara_category = nullif(verification_input ->> 'atinara_category', ''),
    normalized_payload = (verification_input - 'id' - 'preparation_revision') || jsonb_build_object(
      'current_fact_check_id', fact_id_value,
      'fact_status', fact_row.fact_status,
      'fact_policy_version', fact_row.fact_policy_version,
      'fact_context_fingerprint', fact_row.context_sha256,
      'fact_checked_at', fact_row.checked_at,
      'fact_check_expires_at', fact_row.expires_at,
      'fact_check_purpose', fact_row.purpose,
      'verification_status', final_verification_status,
      'state', mapped_state
    ),
    quality_status = mapped_quality,
    quality_score = least(greatest(
      coalesce((verification_input ->> 'quality_score')::numeric, candidate_alias.quality_score), 0
    ), 100),
    score_breakdown = coalesce(verification_input -> 'score_breakdown', candidate_alias.score_breakdown),
    warnings = coalesce(verification_input -> 'warnings', '[]'::jsonb),
    duplicate_matches = coalesce(verification_input -> 'duplicate_matches', '[]'::jsonb),
    fetched_at = checked_at_value,
    source_updated_at = nullif(verification_input ->> 'source_updated_at', '')::timestamptz,
    expires_at = cache_expiry,
    state = mapped_state,
    verification_status = final_verification_status,
    verification_reason_code = case
      when fact_row.fact_status = 'fully_resolved' then 'EVENT_ALREADY_RESOLVED'
      when fact_row.fact_status in ('partially_resolved', 'conflicting', 'unknown') then 'VERIFICATION_REQUIRED'
      else nullif(left(verification_input ->> 'verification_reason_code', 100), '')
    end,
    verification_reason = nullif(left(verification_input ->> 'verification_reason', 1000), ''),
    verified_at = coalesce(nullif(verification_input ->> 'verified_at', '')::timestamptz, checked_at_value),
    verification_expires_at = case
      when final_verification_status = 'verified_open' then verification_expiry else null
    end,
    verification_evidence = fact_row.source_snapshot,
    event_group_key = coalesce(
      nullif(left(verification_input ->> 'event_group_key', 240), ''), candidate_alias.event_group_key
    ),
    external_event_url = coalesce(
      nullif(verification_input ->> 'external_event_url', ''), candidate_alias.external_event_url
    ),
    external_market_url = coalesce(
      nullif(verification_input ->> 'external_market_url', ''), candidate_alias.external_market_url
    ),
    external_event_slug = coalesce(
      nullif(verification_input ->> 'external_event_slug', ''), candidate_alias.external_event_slug
    ),
    external_market_slug = coalesce(
      nullif(verification_input ->> 'external_market_slug', ''), candidate_alias.external_market_slug
    ),
    current_fact_check_id = fact_id_value,
    fact_status = fact_row.fact_status,
    fact_policy_version = fact_row.fact_policy_version,
    fact_context_fingerprint = fact_row.context_sha256,
    fact_checked_at = fact_row.checked_at,
    fact_check_expires_at = fact_row.expires_at,
    fact_check_purpose = fact_row.purpose,
    updated_at = now()
  where candidate_alias.id = candidate.id;

  select * into candidate
  from private.external_market_candidates candidate_alias
  where candidate_alias.id = candidate.id
  for update;
  if candidate.preparation_revision <> expected_revision
     or candidate.current_fact_check_id <> fact_id_value
     or candidate.fact_check_purpose <> 'revalidate' then
    raise exception 'RADAR_FACT_LINK_REVISION_MISMATCH' using errcode = '40001';
  end if;

  if candidate.verification_status <> 'verified_open'
     or candidate.fact_status <> 'unresolved' then
    readiness_error := case candidate.verification_status
      when 'rejected_resolved' then 'RADAR_CANDIDATE_RESOLVED'
      when 'rejected_unannounced' then 'RADAR_CANDIDATE_UNANNOUNCED'
      when 'rejected_invalid_source' then 'RADAR_CANONICAL_URL_INVALID'
      when 'rejected_duplicate' then 'RADAR_CONFIRMED_DUPLICATE'
      when 'rejected_stale' then 'VERIFICATION_EXPIRED'
      else 'RADAR_REVALIDATION_REQUIRED'
    end;
    return jsonb_build_object(
      'ok', false, 'error', readiness_error,
      'candidate_id', candidate.id,
      'preparation_revision', candidate.preparation_revision,
      'fact_check_id', fact_id_value,
      'candidate', private.market_radar_safe_payload(candidate),
      'persisted', true, 'atomic', true, 'revalidated', true
    );
  end if;
  return jsonb_build_object(
    'ok', true,
    'candidate_id', candidate.id,
    'preparation_revision', candidate.preparation_revision,
    'fact_check_id', fact_id_value,
    'candidate', private.market_radar_safe_payload(candidate),
    'persisted', true, 'atomic', true, 'revalidated', true
  );
exception
  when invalid_text_representation or numeric_value_out_of_range or invalid_datetime_format then
    return jsonb_build_object('ok', false, 'error', 'INVALID_VERIFICATION_PAYLOAD');
end;
$function$;

revoke all on function public.apply_market_radar_revalidation_fact_v1(
  uuid,bigint,text,timestamptz,jsonb,jsonb
) from public, anon, authenticated, service_role;
grant execute on function public.apply_market_radar_revalidation_fact_v1(
  uuid,bigint,text,timestamptz,jsonb,jsonb
) to service_role;

alter function public.save_market_draft_from_radar(uuid,uuid,bigint,jsonb)
  rename to save_market_draft_from_radar_without_authoritative_fact_gate_v1;

revoke all on function public.save_market_draft_from_radar_without_authoritative_fact_gate_v1(uuid,uuid,bigint,jsonb)
  from public, anon, authenticated, service_role;

create function public.save_market_draft_from_radar(
  candidate_id_input uuid,
  draft_id_input uuid,
  expected_version_input bigint,
  draft_input jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor_id_value uuid := private.require_current_admin();
  candidate private.external_market_candidates%rowtype;
  fact_row private.market_radar_fact_checks%rowtype;
  submitted_revision bigint;
  submitted_fact_id bigint;
  gate_error text;
  sanitized_draft jsonb;
  save_result jsonb;
  saved_draft_id uuid;
begin
  if jsonb_typeof(draft_input) <> 'object'
     or coalesce(draft_input ->> '_radar_preparation_revision', '') !~ '^[1-9][0-9]*$'
     or coalesce(draft_input ->> '_radar_fact_check_id', '') !~ '^[1-9][0-9]*$' then
    raise exception 'RADAR_FACT_CHECK_REQUIRED' using errcode = '22023';
  end if;
  submitted_revision := (draft_input ->> '_radar_preparation_revision')::bigint;
  submitted_fact_id := (draft_input ->> '_radar_fact_check_id')::bigint;
  select * into candidate
  from private.external_market_candidates candidate_alias
  where candidate_alias.id = candidate_id_input
  for update;
  if not found then raise exception 'RADAR_CANDIDATE_NOT_FOUND' using errcode = 'P0001'; end if;
  gate_error := private.market_radar_fact_gate_error_v2(
    candidate.id, submitted_revision, 'prepare', now(), submitted_fact_id
  );
  if gate_error is not null then
    raise exception '%', gate_error using errcode = '40001';
  end if;
  if candidate.state not in ('available', 'prepared')
     or candidate.verification_status <> 'verified_open'
     or candidate.fact_status <> 'unresolved' then
    raise exception 'RADAR_CANDIDATE_NOT_PREPARABLE' using errcode = 'P0001';
  end if;
  sanitized_draft := draft_input
    - '_radar_preparation_revision'
    - '_radar_fact_check_id';
  save_result := public.save_market_draft_from_radar_without_authoritative_fact_gate_v1(
    candidate_id_input, draft_id_input, expected_version_input, sanitized_draft
  );
  saved_draft_id := nullif(save_result #>> '{draft,id}', '')::uuid;
  select * into fact_row from private.market_radar_fact_checks where id = submitted_fact_id;
  if saved_draft_id is not null then
    update private.market_drafts draft_alias set
      source_provenance = coalesce(draft_alias.source_provenance, '{}'::jsonb) || jsonb_build_object(
        'radar_candidate_id', candidate.id,
        'radar_preparation_revision', fact_row.preparation_revision,
        'radar_fact_check_id', fact_row.id,
        'radar_fact_policy_version', fact_row.fact_policy_version,
        'radar_fact_status', fact_row.fact_status,
        'radar_fact_context_sha256', fact_row.context_sha256,
        'radar_fact_source_sha256', fact_row.source_sha256,
        'radar_fact_checked_at', fact_row.checked_at,
        'radar_fact_purpose', fact_row.purpose
      )
    where draft_alias.id = saved_draft_id;
  end if;
  return save_result || jsonb_build_object(
    'radar_fact_check_id', submitted_fact_id,
    'radar_fact_policy_version', 'atinara-terminal-fact-gate-v2',
    'atomic_fact_gate', true
  );
end;
$function$;

revoke all on function public.save_market_draft_from_radar(uuid,uuid,bigint,jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.save_market_draft_from_radar(uuid,uuid,bigint,jsonb)
  to authenticated;

alter function public.save_market_draft_from_radar_intelligence(
  uuid,uuid,bigint,jsonb,uuid,jsonb,jsonb
) rename to save_market_draft_from_radar_intelligence_without_authoritative_fact_gate_v1;

revoke all on function public.save_market_draft_from_radar_intelligence_without_authoritative_fact_gate_v1(
  uuid,uuid,bigint,jsonb,uuid,jsonb,jsonb
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
  fact_row private.market_radar_fact_checks%rowtype;
  submitted_revision bigint;
  submitted_fact_id bigint;
  gate_error text;
  save_result jsonb;
  saved_draft_id uuid;
begin
  if jsonb_typeof(draft_input) <> 'object'
     or coalesce(draft_input ->> '_radar_preparation_revision', '') !~ '^[1-9][0-9]*$' then
    raise exception 'RADAR_PREPARATION_REVISION_MISMATCH' using errcode = '40001';
  end if;
  submitted_revision := (draft_input ->> '_radar_preparation_revision')::bigint;
  select * into candidate
  from private.external_market_candidates candidate_alias
  where candidate_alias.id = candidate_id_input
  for update;
  if not found then raise exception 'RADAR_CANDIDATE_NOT_FOUND' using errcode = 'P0001'; end if;
  begin
    submitted_fact_id := coalesce(
      nullif(draft_input ->> '_radar_fact_check_id', '')::bigint,
      candidate.current_fact_check_id
    );
  exception when invalid_text_representation or numeric_value_out_of_range then
    raise exception 'RADAR_FACT_CHECK_REQUIRED' using errcode = '22023';
  end;
  gate_error := private.market_radar_fact_gate_error_v2(
    candidate.id, submitted_revision, 'prepare', now(), submitted_fact_id
  );
  if gate_error is not null then
    raise exception '%', gate_error using errcode = '40001';
  end if;
  save_result := public.save_market_draft_from_radar_intelligence_without_authoritative_fact_gate_v1(
    candidate_id_input, draft_id_input, expected_version_input,
    draft_input - '_radar_fact_check_id', expert_run_id_input,
    contract_input, sources_input
  );
  saved_draft_id := nullif(save_result #>> '{draft,id}', '')::uuid;
  select * into fact_row from private.market_radar_fact_checks where id = submitted_fact_id;
  if saved_draft_id is not null then
    update private.market_drafts draft_alias set
      source_provenance = coalesce(draft_alias.source_provenance, '{}'::jsonb) || jsonb_build_object(
        'radar_candidate_id', candidate.id,
        'radar_preparation_revision', fact_row.preparation_revision,
        'radar_fact_check_id', fact_row.id,
        'radar_fact_policy_version', fact_row.fact_policy_version,
        'radar_fact_status', fact_row.fact_status,
        'radar_fact_context_sha256', fact_row.context_sha256,
        'radar_fact_source_sha256', fact_row.source_sha256,
        'radar_fact_checked_at', fact_row.checked_at,
        'radar_fact_purpose', fact_row.purpose,
        'market_expert_run_id', expert_run_id_input
      )
    where draft_alias.id = saved_draft_id;
  end if;
  return save_result || jsonb_build_object(
    'radar_fact_check_id', submitted_fact_id,
    'radar_fact_policy_version', 'atinara-terminal-fact-gate-v2',
    'atomic_fact_gate', true
  );
end;
$function$;

revoke all on function public.save_market_draft_from_radar_intelligence(
  uuid,uuid,bigint,jsonb,uuid,jsonb,jsonb
) from public, anon, authenticated, service_role;
grant execute on function public.save_market_draft_from_radar_intelligence(
  uuid,uuid,bigint,jsonb,uuid,jsonb,jsonb
) to authenticated;

-- Una preparacion no congela la verdad factual. Antes de confirmar, programar
-- o materializar un borrador Radar se contrasta tanto la procedencia prepare
-- original como el snapshot factual que la candidata tiene enlazado ahora.
create or replace function private.assert_market_radar_draft_fact_current_v1(
  draft_input private.market_drafts,
  checked_at_input timestamptz default clock_timestamp()
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  candidate private.external_market_candidates%rowtype;
  origin_fact private.market_radar_fact_checks%rowtype;
  current_fact private.market_radar_fact_checks%rowtype;
  provenance jsonb := coalesce(draft_input.source_provenance, '{}'::jsonb);
  origin_fact_id bigint;
  gate_error text;
  checked_at_value timestamptz := greatest(clock_timestamp(), coalesce(checked_at_input, clock_timestamp()));
begin
  if draft_input.radar_candidate_id is null
     and not (provenance ? 'radar_fact_check_id')
     and not (provenance ? 'radar_candidate_id') then
    return;
  end if;

  if draft_input.radar_candidate_id is null
     or coalesce(provenance ->> 'radar_candidate_id', '') !~
       '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     or coalesce(provenance ->> 'radar_fact_check_id', '') !~ '^[1-9][0-9]*$'
     or coalesce(provenance ->> 'radar_preparation_revision', '') !~ '^[1-9][0-9]*$'
     or provenance ->> 'radar_fact_policy_version' is distinct from 'atinara-terminal-fact-gate-v2'
     or provenance ->> 'radar_fact_status' is distinct from 'unresolved'
     or provenance ->> 'radar_fact_purpose' is distinct from 'prepare'
     or coalesce(provenance ->> 'radar_fact_context_sha256', '') !~ '^[0-9a-f]{64}$'
     or coalesce(provenance ->> 'radar_fact_source_sha256', '') !~ '^[0-9a-f]{64}$' then
    raise exception 'RADAR_DRAFT_FACT_PROVENANCE_REQUIRED' using errcode = '55000';
  end if;
  if (provenance ->> 'radar_candidate_id')::uuid
     is distinct from draft_input.radar_candidate_id then
    raise exception 'RADAR_DRAFT_FACT_PROVENANCE_REQUIRED' using errcode = '55000';
  end if;

  origin_fact_id := (provenance ->> 'radar_fact_check_id')::bigint;
  select * into origin_fact
  from private.market_radar_fact_checks fact_alias
  where fact_alias.id = origin_fact_id;
  if not found
     or origin_fact.candidate_id is distinct from draft_input.radar_candidate_id
     or origin_fact.preparation_revision::text is distinct from
       provenance ->> 'radar_preparation_revision'
     or origin_fact.purpose is distinct from 'prepare'
     or origin_fact.fact_policy_version is distinct from 'atinara-terminal-fact-gate-v2'
     or origin_fact.fact_status is distinct from 'unresolved'
     or origin_fact.verification_status is distinct from 'verified_open'
     or origin_fact.context_sha256 is distinct from provenance ->> 'radar_fact_context_sha256'
     or origin_fact.source_sha256 is distinct from provenance ->> 'radar_fact_source_sha256'
     or origin_fact.fact_context_fingerprint is distinct from origin_fact.context_sha256
     or not private.market_radar_sources_authorized_v1(origin_fact.source_snapshot) then
    raise exception 'RADAR_DRAFT_FACT_PROVENANCE_REQUIRED' using errcode = '55000';
  end if;

  select * into candidate
  from private.external_market_candidates candidate_alias
  where candidate_alias.id = draft_input.radar_candidate_id
  for share;
  if not found then
    raise exception 'RADAR_FACTUAL_REFRESH_REQUIRED' using errcode = '55000';
  end if;
  if candidate.fact_status = 'fully_resolved'
     or candidate.verification_status = 'rejected_resolved' then
    raise exception 'RADAR_EVENT_ALREADY_RESOLVED' using errcode = '55000';
  end if;
  if candidate.state is distinct from 'prepared'
     or candidate.current_fact_check_id is null
     or candidate.fact_check_purpose is distinct from 'revalidate'
     or candidate.fact_status is distinct from 'unresolved'
     or candidate.verification_status is distinct from 'verified_open'
     or candidate.fact_policy_version is distinct from 'atinara-terminal-fact-gate-v2'
     or candidate.expires_at is null
     or candidate.expires_at <= checked_at_value
     or candidate.verification_expires_at is null
     or candidate.verification_expires_at <= checked_at_value
     or candidate.fact_check_expires_at is null
     or candidate.fact_check_expires_at <= checked_at_value then
    raise exception 'RADAR_FACTUAL_REFRESH_REQUIRED' using errcode = '55000';
  end if;

  select * into current_fact
  from private.market_radar_fact_checks fact_alias
  where fact_alias.id = candidate.current_fact_check_id;
  if not found
     or current_fact.candidate_id is distinct from candidate.id
     or current_fact.provider is distinct from candidate.provider
     or current_fact.external_id is distinct from candidate.external_id
     or current_fact.event_group_key is distinct from candidate.event_group_key
     or current_fact.purpose is distinct from candidate.fact_check_purpose
     or current_fact.fact_policy_version is distinct from candidate.fact_policy_version
     or current_fact.fact_status is distinct from candidate.fact_status
     or current_fact.verification_status is distinct from candidate.verification_status
     or current_fact.context_sha256 is distinct from candidate.fact_context_fingerprint
     or current_fact.fact_context_fingerprint is distinct from current_fact.context_sha256
     or current_fact.source_snapshot is distinct from candidate.verification_evidence
     or current_fact.checked_at is distinct from candidate.fact_checked_at
     or current_fact.expires_at is distinct from candidate.fact_check_expires_at
     or current_fact.checked_at < origin_fact.checked_at
     or not private.market_radar_sources_authorized_v1(current_fact.source_snapshot) then
    raise exception 'RADAR_FACTUAL_REFRESH_REQUIRED' using errcode = '55000';
  end if;

  gate_error := private.market_radar_fact_gate_error_v2(
    candidate.id,
    current_fact.preparation_revision,
    current_fact.purpose,
    checked_at_value,
    current_fact.id
  );
  if gate_error is not null then
    if candidate.fact_status = 'fully_resolved'
       or current_fact.fact_status = 'fully_resolved' then
      raise exception 'RADAR_EVENT_ALREADY_RESOLVED' using errcode = '55000';
    end if;
    raise exception 'RADAR_FACTUAL_REFRESH_REQUIRED'
      using errcode = '55000', detail = gate_error;
  end if;
end;
$function$;

revoke all on function private.assert_market_radar_draft_fact_current_v1(
  private.market_drafts,timestamptz
) from public, anon, authenticated, service_role;

-- La ruta sin Plan de Resolucion devolvia antes de alcanzar el assert comun.
-- Se revalida primero para cubrir tambien confirmaciones y programaciones
-- idempotentes de borradores Radar sin binding obligatorio.
create or replace function private.ensure_market_source_publication_ready(
  draft_id_input uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  draft_row private.market_drafts%rowtype;
  binding_state jsonb;
  binding_id_value uuid;
  binding_row private.market_source_bindings%rowtype;
  verification_result jsonb;
begin
  select * into draft_row
  from private.market_drafts
  where id = draft_id_input;
  if not found then raise exception 'DRAFT_NOT_FOUND' using errcode = 'P0001'; end if;
  perform private.assert_market_radar_draft_fact_current_v1(
    draft_row, clock_timestamp()
  );

  binding_state := private.market_binding_compatibility(draft_id_input);

  if not coalesce((binding_state ->> 'compatible')::boolean, false) then
    raise exception 'CURRENT_BINDING_COMPATIBILITY_REQUIRED'
      using errcode = '22023',
            detail = coalesce(binding_state -> 'reasons', '[]'::jsonb)::text;
  end if;

  if not coalesce((binding_state ->> 'required')::boolean, false) then
    return binding_state || jsonb_build_object(
      'publication_ready', true,
      'auto_validated', false,
      'message', 'Este borrador no requiere un Plan de Resolucion vinculado.'
    );
  end if;

  binding_id_value := nullif(binding_state ->> 'binding_id', '')::uuid;
  if binding_id_value is null then
    raise exception 'SOURCE_BINDING_REQUIRED' using errcode = '22023';
  end if;

  select * into binding_row
  from private.market_source_bindings
  where id = binding_id_value
  for update;
  if not found then
    raise exception 'SOURCE_BINDING_NOT_FOUND' using errcode = 'P0001';
  end if;

  if binding_row.status = 'draft'
     or binding_row.contract_hash is null
     or binding_row.locked_at is null then
    verification_result := public.verify_market_source_binding(binding_id_value);
    select * into binding_row
    from private.market_source_bindings
    where id = binding_id_value;
  end if;

  if binding_row.status not in ('validated', 'armed')
     or binding_row.contract_hash is null
     or binding_row.locked_at is null then
    raise exception 'RESOLUTION_PLAN_NOT_LOCKED'
      using errcode = '22023',
            detail = coalesce(binding_row.validation, '{}'::jsonb)::text;
  end if;

  if binding_row.monitor_required then
    if binding_row.status <> 'armed' or binding_row.monitor_readiness <> 'armed' then
      raise exception 'SOURCE_MONITOR_NOT_ARMED' using errcode = '22023';
    end if;
    if not coalesce((
      select enabled
      from private.market_intelligence_runtime_settings
      where setting_key = 'source_monitor_scheduler_enabled'
    ), false) then
      raise exception 'SOURCE_SCHEDULER_NOT_ENABLED' using errcode = '22023';
    end if;
  end if;

  perform private.assert_market_source_publication_ready(draft_id_input);

  return private.market_binding_compatibility(draft_id_input) || jsonb_build_object(
    'publication_ready', true,
    'auto_validated', verification_result is not null,
    'binding_status', binding_row.status,
    'locked_at', binding_row.locked_at,
    'contract_hash', binding_row.contract_hash
  );
end;
$function$;

revoke all on function private.ensure_market_source_publication_ready(uuid)
  from public, anon, authenticated, service_role;

-- Reemplaza el helper ya invocado por confirm, schedule, publish y materialize.
-- CREATE OR REPLACE conserva su OID, por lo que tambien cubre al scheduler que
-- llama directamente a private.materialize_market_draft.
create or replace function private.assert_market_source_publication_ready(
  draft_id_input uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  draft_row private.market_drafts%rowtype;
  binding_row private.market_source_bindings%rowtype;
  provenance_state jsonb;
begin
  select * into draft_row
  from private.market_drafts
  where id = draft_id_input;
  if not found then raise exception 'DRAFT_NOT_FOUND' using errcode = 'P0001'; end if;

  perform private.assert_market_radar_draft_fact_current_v1(
    draft_row, clock_timestamp()
  );

  select * into binding_row
  from private.market_source_bindings
  where draft_id = draft_id_input
    and status <> 'superseded'
  order by plan_version desc, created_at desc
  limit 1;

  if draft_row.intelligence_origin_type is null and not found then return; end if;
  if not found then raise exception 'SOURCE_BINDING_REQUIRED' using errcode = '22023'; end if;

  if binding_row.contract_hash is null
     or binding_row.locked_at is null
     or binding_row.locked_by is null then
    raise exception 'RESOLUTION_PLAN_NOT_LOCKED' using errcode = '22023';
  end if;
  if binding_row.status not in ('validated', 'armed') then
    raise exception 'SOURCE_CONTRACT_NOT_LOCKED' using errcode = '22023';
  end if;
  if not coalesce((binding_row.validation ->> 'valid')::boolean, false) then
    raise exception 'SOURCE_BINDING_VALIDATION_REQUIRED'
      using errcode = '22023', detail = coalesce(binding_row.validation, '{}'::jsonb)::text;
  end if;
  if binding_row.contract_hash
     is distinct from private.market_intelligence_hash(binding_row.resolution_contract) then
    raise exception 'SOURCE_BINDING_CONTRACT_CHANGED' using errcode = '55000';
  end if;

  if binding_row.monitor_required
     and (binding_row.status <> 'armed' or binding_row.monitor_readiness <> 'armed') then
    raise exception 'SOURCE_MONITOR_NOT_ARMED' using errcode = '22023';
  end if;
  if binding_row.monitor_required and not coalesce((
    select enabled
    from private.market_intelligence_runtime_settings
    where setting_key = 'source_monitor_scheduler_enabled'
  ), false) then
    raise exception 'SOURCE_SCHEDULER_NOT_ENABLED' using errcode = '22023';
  end if;

  provenance_state := private.market_source_binding_provenance(binding_row.id);
  if not coalesce((provenance_state ->> 'valid')::boolean, false) then
    if provenance_state ->> 'mode' = 'completed_expert_run'
       and provenance_state -> 'issues' @> '["MARKET_EXPERT_ANALYSIS_REQUIRED"]'::jsonb then
      raise exception 'MARKET_EXPERT_ANALYSIS_REQUIRED'
        using errcode = '22023', detail = (provenance_state -> 'issues')::text;
    end if;
    raise exception 'SOURCE_BINDING_PROVENANCE_REQUIRED'
      using errcode = '22023', detail = (provenance_state -> 'issues')::text;
  end if;
end;
$function$;

revoke all on function private.assert_market_source_publication_ready(uuid)
  from public, anon, authenticated, service_role;

-- Defensa adicional para cualquier escritura futura que intente saltarse las
-- RPCs de administracion. El ultimo control sigue estando dentro de materialize.
create or replace function private.market_draft_radar_fact_publication_gate_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  old_radar_linked boolean :=
    old.radar_candidate_id is not null
    or coalesce(old.source_provenance, '{}'::jsonb) ? 'radar_candidate_id'
    or coalesce(old.source_provenance, '{}'::jsonb) ? 'radar_fact_check_id';
  old_fact_link jsonb := jsonb_build_object(
    'radar_candidate_id', old.source_provenance -> 'radar_candidate_id',
    'radar_preparation_revision', old.source_provenance -> 'radar_preparation_revision',
    'radar_fact_check_id', old.source_provenance -> 'radar_fact_check_id',
    'radar_fact_policy_version', old.source_provenance -> 'radar_fact_policy_version',
    'radar_fact_status', old.source_provenance -> 'radar_fact_status',
    'radar_fact_purpose', old.source_provenance -> 'radar_fact_purpose',
    'radar_fact_context_sha256', old.source_provenance -> 'radar_fact_context_sha256',
    'radar_fact_source_sha256', old.source_provenance -> 'radar_fact_source_sha256',
    'atomic_fact_gate', old.source_provenance -> 'atomic_fact_gate'
  );
  new_fact_link jsonb := jsonb_build_object(
    'radar_candidate_id', new.source_provenance -> 'radar_candidate_id',
    'radar_preparation_revision', new.source_provenance -> 'radar_preparation_revision',
    'radar_fact_check_id', new.source_provenance -> 'radar_fact_check_id',
    'radar_fact_policy_version', new.source_provenance -> 'radar_fact_policy_version',
    'radar_fact_status', new.source_provenance -> 'radar_fact_status',
    'radar_fact_purpose', new.source_provenance -> 'radar_fact_purpose',
    'radar_fact_context_sha256', new.source_provenance -> 'radar_fact_context_sha256',
    'radar_fact_source_sha256', new.source_provenance -> 'radar_fact_source_sha256',
    'atomic_fact_gate', new.source_provenance -> 'atomic_fact_gate'
  );
  initial_fact_link_allowed boolean := false;
begin
  if old_radar_linked
     and (
       new.radar_candidate_id is distinct from old.radar_candidate_id
       or new_fact_link is distinct from old_fact_link
     ) then
    -- save_market_draft_from_radar enlaza primero candidata+borrador y, dentro
    -- de la misma RPC/tx, completa la procedencia con el prepare fact que ya
    -- superó la puerta autoritativa. Solo se admite esa transición única.
    if new.radar_candidate_id is not distinct from old.radar_candidate_id
       and old.radar_candidate_id is not null
       and not (coalesce(old.source_provenance, '{}'::jsonb) ? 'radar_fact_check_id')
       and coalesce(new.source_provenance ->> 'radar_candidate_id', '') = new.radar_candidate_id::text
       and coalesce(new.source_provenance ->> 'radar_preparation_revision', '') ~ '^[1-9][0-9]*$'
       and coalesce(new.source_provenance ->> 'radar_fact_check_id', '') ~ '^[1-9][0-9]*$'
       and new.source_provenance ->> 'radar_fact_policy_version' = 'atinara-terminal-fact-gate-v2'
       and new.source_provenance ->> 'radar_fact_status' = 'unresolved'
       and new.source_provenance ->> 'radar_fact_purpose' = 'prepare' then
      begin
        initial_fact_link_allowed := private.market_radar_fact_gate_error_v2(
          new.radar_candidate_id,
          (new.source_provenance ->> 'radar_preparation_revision')::bigint,
          'prepare',
          clock_timestamp(),
          (new.source_provenance ->> 'radar_fact_check_id')::bigint
        ) is null;
      exception
        when invalid_text_representation or numeric_value_out_of_range then
          initial_fact_link_allowed := false;
      end;
    end if;
    if not initial_fact_link_allowed then
      raise exception 'RADAR_DRAFT_FACT_LINK_IMMUTABLE' using errcode = '55000';
    end if;
  end if;
  if new.workflow_status in ('human_confirmed', 'scheduled', 'published') then
    perform private.assert_market_radar_draft_fact_current_v1(
      new, clock_timestamp()
    );
  end if;
  return new;
end;
$function$;

revoke all on function private.market_draft_radar_fact_publication_gate_v1()
  from public, anon, authenticated, service_role;

drop trigger if exists aaaa_market_draft_radar_fact_publication_gate_v1
  on private.market_drafts;
create trigger aaaa_market_draft_radar_fact_publication_gate_v1
before update of workflow_status, radar_candidate_id, source_provenance
on private.market_drafts
for each row execute function private.market_draft_radar_fact_publication_gate_v1();

comment on table private.market_radar_fact_checks is
  'Snapshots factuales append-only; v2 vincula candidata, revision, proposito y hashes SHA-256.';
comment on function public.upsert_market_radar_batch_with_fact_checks_v1(text,text,text,jsonb,jsonb,text,jsonb) is
  'UPSERT de Radar y snapshots factuales vinculados en una sola transaccion.';
comment on function public.apply_market_radar_prepare_fact_verification_v1(uuid,bigint,text,timestamptz,jsonb,jsonb) is
  'Revalidacion prepare atomica: persiste tambien decisiones negativas antes de responder.';

commit;
