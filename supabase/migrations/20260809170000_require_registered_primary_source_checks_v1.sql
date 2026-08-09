-- Fuente PRIMARY autoritativa para el Corrector Autónomo.
-- Una URL heredada solo es candidata: cada escritura autónoma exige una
-- comprobación service-role, fresca, categorizada y ligada a draft+versión.
-- No publica, confirma, resuelve ni modifica mercados, predicciones o economía.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';

create or replace function private.market_source_category_key_v1(value_input text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $function$
  select regexp_replace(
    translate(lower(trim(coalesce(value_input, ''))), 'áéíóúüñ', 'aeiouun'),
    '[^a-z0-9]+', '-', 'g'
  );
$function$;

create or replace function private.market_request_role_v1()
returns text
language plpgsql
stable
security invoker
set search_path = ''
as $function$
declare
  role_value text := nullif(current_setting('request.jwt.claim.role', true), '');
  claims_value text;
begin
  if role_value is not null then return role_value; end if;
  claims_value := nullif(current_setting('request.jwt.claims', true), '');
  if claims_value is null then return null; end if;
  begin
    return claims_value::jsonb ->> 'role';
  exception when others then
    return null;
  end;
end;
$function$;

create or replace function private.market_primary_source_url_host_v1(value_input text)
returns text
language plpgsql
immutable
parallel safe
set search_path = ''
as $function$
declare
  authority_value text;
begin
  if trim(coalesce(value_input, '')) !~ '^https://' then return null; end if;
  authority_value := lower(split_part(split_part(trim(value_input), '://', 2), '/', 1));
  if authority_value = ''
     or position('@' in authority_value) > 0
     or position(':' in authority_value) > 0
     or authority_value !~ '^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}\.?$' then
    return null;
  end if;
  return regexp_replace(rtrim(authority_value, '.'), '^www\.', '');
end;
$function$;

create or replace function private.market_primary_registry_row_matches_v1(
  registry_row private.market_source_registry,
  url_input text,
  category_input text
)
returns boolean
language sql
stable
parallel safe
set search_path = ''
as $function$
  select coalesce(registry_row.active, false)
    and registry_row.authority_tier = 'primary'
    and registry_row.allowed_roles @> '["primary_resolution"]'::jsonb
    and private.market_primary_source_url_host_v1(url_input) is not null
    and (
      private.market_primary_source_url_host_v1(url_input)
        = regexp_replace(lower(rtrim(registry_row.canonical_domain, '.')), '^www\.', '')
      or private.market_primary_source_url_host_v1(url_input)
        like '%.' || regexp_replace(lower(rtrim(registry_row.canonical_domain, '.')), '^www\.', '')
    )
    and (
      jsonb_array_length(registry_row.categories) = 0
      or exists (
        select 1
        from jsonb_array_elements_text(registry_row.categories) category_value
        where private.market_source_category_key_v1(category_value)
          = private.market_source_category_key_v1(category_input)
          and private.market_source_category_key_v1(category_input) <> ''
      )
    );
$function$;

create or replace function public.get_market_draft_authoritative_source_registry_v1(
  role_input text default 'primary_resolution'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  role_value text := lower(trim(coalesce(role_input, '')));
begin
  if private.market_request_role_v1() is distinct from 'service_role' then
    raise exception 'SERVICE_ROLE_REQUIRED' using errcode = '42501';
  end if;
  if role_value is distinct from 'primary_resolution' then
    raise exception 'SOURCE_REGISTRY_ROLE_NOT_ALLOWED' using errcode = '22023';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', registry.id,
      'provider', registry.provider,
      'source_name', registry.source_name,
      'canonical_domain', regexp_replace(lower(rtrim(registry.canonical_domain, '.')), '^www\.', ''),
      'allowed_roles', registry.allowed_roles,
      'authority_tier', registry.authority_tier,
      'categories', coalesce((
        select jsonb_agg(private.market_source_category_key_v1(category_value) order by category_value)
        from jsonb_array_elements_text(registry.categories) category_value
      ), '[]'::jsonb),
      'parser_version', registry.parser_version,
      'registry_contract_version', 'atinara-primary-source-registry-v1',
      'active', registry.active
    ) order by registry.canonical_domain, registry.id)
    from private.market_source_registry registry
    where registry.active
      and registry.authority_tier = 'primary'
      and registry.allowed_roles @> jsonb_build_array(role_value)
  ), '[]'::jsonb);
end;
$function$;

revoke all on function public.get_market_draft_authoritative_source_registry_v1(text)
  from public, anon, authenticated, service_role;
grant execute on function public.get_market_draft_authoritative_source_registry_v1(text)
  to service_role;

-- El catálogo es configurable únicamente a través de contratos controlados.
-- El secreto de servicio puede consultar esta vista RPC, no autorizarse a sí
-- mismo un dominio mediante DML directo.
revoke all on table private.market_source_registry from public, anon, authenticated, service_role;

create or replace function private.market_source_registry_admin_snapshot_v1(
  registry_row private.market_source_registry
)
returns jsonb
language sql
stable
parallel safe
set search_path = ''
as $function$
  select jsonb_build_object(
    'id', registry_row.id,
    'provider', registry_row.provider,
    'source_name', registry_row.source_name,
    'canonical_url', 'https://' || regexp_replace(lower(rtrim(registry_row.canonical_domain, '.')), '^www\.', ''),
    'canonical_domain', regexp_replace(lower(rtrim(registry_row.canonical_domain, '.')), '^www\.', ''),
    'external_entity_id', registry_row.external_entity_id,
    'allowed_roles', registry_row.allowed_roles,
    'authority_tier', registry_row.authority_tier,
    'categories', registry_row.categories,
    'access_method', registry_row.access_method,
    'health_status', registry_row.health_status,
    'parser_version', registry_row.parser_version,
    'active', registry_row.active,
    'created_at', registry_row.created_at,
    'updated_at', registry_row.updated_at
  );
$function$;

revoke all on function private.market_source_registry_admin_snapshot_v1(
  private.market_source_registry
) from public, anon, authenticated, service_role;

-- Contrato operativo B2B: un administrador humano puede consultar la
-- configuración completa (incluidas fuentes inactivas), pero no obtiene SELECT
-- directo sobre el esquema private.
create or replace function public.list_market_authoritative_source_registry_admin_v1()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
begin
  perform private.require_current_admin();
  return coalesce((
    select jsonb_agg(
      private.market_source_registry_admin_snapshot_v1(registry)
      order by registry.canonical_domain, registry.provider, registry.id
    )
    from private.market_source_registry registry
  ), '[]'::jsonb);
end;
$function$;

revoke all on function public.list_market_authoritative_source_registry_admin_v1()
  from public, anon, authenticated, service_role;
grant execute on function public.list_market_authoritative_source_registry_admin_v1()
  to authenticated;

-- Upsert por identidad natural. El payload tiene una allowlist cerrada y no
-- puede elegir tier, método, estado, retención ni active: esos invariantes los
-- fija el servidor. Un dominio se expresa como raíz HTTPS, nunca como URL con
-- ruta/query, IP literal o host local.
create or replace function public.upsert_market_authoritative_source_registry_admin_v1(
  source_input jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor_id_value uuid := private.require_current_admin();
  provider_value text;
  source_name_value text;
  canonical_url_value text;
  canonical_domain_value text;
  external_entity_id_value text;
  parser_version_value text;
  allowed_roles_value jsonb;
  categories_value jsonb;
  before_row private.market_source_registry%rowtype;
  saved_row private.market_source_registry%rowtype;
  row_exists boolean := false;
  changed_value boolean := false;
  before_snapshot jsonb;
  after_snapshot jsonb;
begin
  if jsonb_typeof(coalesce(source_input, 'null'::jsonb)) is distinct from 'object'
     or octet_length(source_input::text) > 8192
     or source_input - array[
       'provider', 'source_name', 'canonical_url', 'external_entity_id',
       'allowed_roles', 'categories', 'parser_version'
     ]::text[] <> '{}'::jsonb then
    raise exception 'SOURCE_REGISTRY_INPUT_FIELDS_INVALID' using errcode = '22023';
  end if;
  if jsonb_typeof(source_input -> 'provider') is distinct from 'string'
     or jsonb_typeof(source_input -> 'source_name') is distinct from 'string'
     or jsonb_typeof(source_input -> 'canonical_url') is distinct from 'string'
     or jsonb_typeof(source_input -> 'parser_version') is distinct from 'string'
     or jsonb_typeof(source_input -> 'allowed_roles') is distinct from 'array'
     or jsonb_typeof(source_input -> 'categories') is distinct from 'array'
     or (source_input ? 'external_entity_id'
       and jsonb_typeof(source_input -> 'external_entity_id') not in ('string', 'null')) then
    raise exception 'SOURCE_REGISTRY_INPUT_TYPES_INVALID' using errcode = '22023';
  end if;

  provider_value := lower(trim(source_input ->> 'provider'));
  source_name_value := trim(source_input ->> 'source_name');
  canonical_url_value := lower(trim(source_input ->> 'canonical_url'));
  canonical_domain_value := private.market_primary_source_url_host_v1(canonical_url_value);
  external_entity_id_value := nullif(trim(source_input ->> 'external_entity_id'), '');
  parser_version_value := lower(trim(source_input ->> 'parser_version'));
  if provider_value !~ '^[a-z0-9][a-z0-9_-]{1,79}$'
     or octet_length(source_name_value) not between 3 and 160
     or source_name_value ~ '[[:cntrl:]]'
     or canonical_domain_value is null
     or canonical_url_value not in (
       'https://' || canonical_domain_value,
       'https://' || canonical_domain_value || '/',
       'https://www.' || canonical_domain_value,
       'https://www.' || canonical_domain_value || '/'
     )
     or (external_entity_id_value is not null
       and external_entity_id_value !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$')
     or parser_version_value !~ '^[a-z0-9][a-z0-9._-]{2,119}$' then
    raise exception 'SOURCE_REGISTRY_IDENTITY_INVALID' using errcode = '22023';
  end if;

  if jsonb_array_length(source_input -> 'allowed_roles') < 1
     or jsonb_array_length(source_input -> 'allowed_roles') > 3
     or exists (
       select 1 from jsonb_array_elements(source_input -> 'allowed_roles') role_item
       where jsonb_typeof(role_item) is distinct from 'string'
     ) then
    raise exception 'SOURCE_REGISTRY_ROLES_INVALID' using errcode = '22023';
  end if;
  select coalesce(jsonb_agg(role_value order by role_value), '[]'::jsonb)
  into allowed_roles_value
  from (
    select distinct lower(trim(role_text)) role_value
    from jsonb_array_elements_text(source_input -> 'allowed_roles') role_text
  ) normalized_roles;
  if not (allowed_roles_value @> '["primary_resolution"]'::jsonb)
     or exists (
       select 1 from jsonb_array_elements_text(allowed_roles_value) role_value
       where role_value not in ('primary_resolution', 'radar_fact_evidence')
     ) then
    raise exception 'SOURCE_REGISTRY_ROLES_INVALID' using errcode = '22023';
  end if;

  if jsonb_array_length(source_input -> 'categories') > 6
     or exists (
       select 1 from jsonb_array_elements(source_input -> 'categories') category_item
       where jsonb_typeof(category_item) is distinct from 'string'
          or octet_length(trim(category_item #>> '{}')) not between 1 and 120
     ) then
    raise exception 'SOURCE_REGISTRY_CATEGORIES_INVALID' using errcode = '22023';
  end if;
  select coalesce(jsonb_agg(category_value order by category_value), '[]'::jsonb)
  into categories_value
  from (
    select distinct private.market_source_category_key_v1(category_text) category_value
    from jsonb_array_elements_text(source_input -> 'categories') category_text
  ) normalized_categories;
  if exists (
    select 1 from jsonb_array_elements_text(categories_value) category_value
    where category_value not in (
      'lanzamientos', 'eventos', 'industria', 'streamers',
      'reviews-premios', 'youtubers'
    )
  ) then
    raise exception 'SOURCE_REGISTRY_CATEGORIES_INVALID' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'primary-source-domain|' || canonical_domain_value,
    0
  ));
  perform pg_advisory_xact_lock(hashtextextended(
    provider_value || '|' || canonical_domain_value || '|' || coalesce(external_entity_id_value, ''),
    0
  ));
  if exists (
    select 1
    from private.market_source_registry registry
    where regexp_replace(lower(rtrim(registry.canonical_domain, '.')), '^www\.', '')
        = canonical_domain_value
      and not (registry.allowed_roles @> '["primary_resolution"]'::jsonb)
  ) then
    raise exception 'SOURCE_REGISTRY_ROLE_BOUNDARY_CONFLICT' using errcode = '22023';
  end if;
  select * into before_row
  from private.market_source_registry registry
  where registry.provider = provider_value
    and registry.canonical_domain = canonical_domain_value
    and coalesce(registry.external_entity_id, '') = coalesce(external_entity_id_value, '')
  for update;
  row_exists := found;
  if row_exists then
    if not (before_row.allowed_roles @> '["primary_resolution"]'::jsonb) then
      raise exception 'SOURCE_REGISTRY_ROLE_BOUNDARY_CONFLICT' using errcode = '22023';
    end if;
    before_snapshot := private.market_source_registry_admin_snapshot_v1(before_row);
    changed_value := before_row.source_name is distinct from source_name_value
      or before_row.allowed_roles is distinct from allowed_roles_value
      or before_row.authority_tier is distinct from 'primary'
      or before_row.categories is distinct from categories_value
      or before_row.access_method is distinct from 'https'
      or before_row.health_status is distinct from 'unknown'
      or before_row.retention_policy is distinct from '{"snapshot":true,"append_only":true}'::jsonb
      or before_row.parser_version is distinct from parser_version_value
      or before_row.active is distinct from true;
    if changed_value then
      update private.market_source_registry registry
      set source_name = source_name_value,
          allowed_roles = allowed_roles_value,
          authority_tier = 'primary',
          categories = categories_value,
          access_method = 'https',
          health_status = 'unknown',
          retention_policy = '{"snapshot":true,"append_only":true}'::jsonb,
          parser_version = parser_version_value,
          active = true,
          updated_at = clock_timestamp()
      where registry.id = before_row.id
      returning * into saved_row;
    else
      saved_row := before_row;
    end if;
  else
    insert into private.market_source_registry(
      provider, source_name, canonical_domain, external_entity_id,
      allowed_roles, authority_tier, categories, access_method, health_status,
      retention_policy, parser_version, active
    ) values (
      provider_value, source_name_value, canonical_domain_value, external_entity_id_value,
      allowed_roles_value, 'primary', categories_value, 'https', 'unknown',
      '{"snapshot":true,"append_only":true}'::jsonb, parser_version_value, true
    ) returning * into saved_row;
    changed_value := true;
    before_snapshot := null;
  end if;
  after_snapshot := private.market_source_registry_admin_snapshot_v1(saved_row);
  insert into private.market_admin_audit(actor_id, action_code, detail)
  values (
    actor_id_value,
    'MARKET_SOURCE_REGISTRY_UPSERTED',
    jsonb_build_object(
      'registry_source_id', saved_row.id,
      'changed', changed_value,
      'before', before_snapshot,
      'after', after_snapshot,
      'publishes', false,
      'confirms', false,
      'resolves', false
    )
  );
  return jsonb_build_object('changed', changed_value, 'source', after_snapshot);
end;
$function$;

revoke all on function public.upsert_market_authoritative_source_registry_admin_v1(jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.upsert_market_authoritative_source_registry_admin_v1(jsonb)
  to authenticated;

create or replace function public.deactivate_market_authoritative_source_registry_admin_v1(
  registry_source_id_input uuid,
  reason_input text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor_id_value uuid := private.require_current_admin();
  before_row private.market_source_registry%rowtype;
  saved_row private.market_source_registry%rowtype;
  before_snapshot jsonb;
  after_snapshot jsonb;
  reason_value text := trim(coalesce(reason_input, ''));
  changed_value boolean;
begin
  if octet_length(reason_value) not between 10 and 500
     or reason_value ~ '[[:cntrl:]]' then
    raise exception 'SOURCE_REGISTRY_DEACTIVATION_REASON_INVALID' using errcode = '22023';
  end if;
  select * into before_row
  from private.market_source_registry registry
  where registry.id = registry_source_id_input
  for update;
  if not found then
    raise exception 'SOURCE_REGISTRY_NOT_FOUND' using errcode = 'P0001';
  end if;
  if not (before_row.allowed_roles @> '["primary_resolution"]'::jsonb) then
    raise exception 'SOURCE_REGISTRY_ROLE_BOUNDARY_CONFLICT' using errcode = '22023';
  end if;
  before_snapshot := private.market_source_registry_admin_snapshot_v1(before_row);
  changed_value := before_row.active is distinct from false
    or before_row.health_status is distinct from 'retired';
  if changed_value then
    update private.market_source_registry registry
    set active = false,
        health_status = 'retired',
        updated_at = clock_timestamp()
    where registry.id = before_row.id
    returning * into saved_row;
  else
    saved_row := before_row;
  end if;
  after_snapshot := private.market_source_registry_admin_snapshot_v1(saved_row);
  insert into private.market_admin_audit(actor_id, action_code, detail)
  values (
    actor_id_value,
    'MARKET_SOURCE_REGISTRY_DEACTIVATED',
    jsonb_build_object(
      'registry_source_id', saved_row.id,
      'reason', reason_value,
      'changed', changed_value,
      'before', before_snapshot,
      'after', after_snapshot,
      'publishes', false,
      'confirms', false,
      'resolves', false
    )
  );
  return jsonb_build_object('changed', changed_value, 'source', after_snapshot);
end;
$function$;

revoke all on function public.deactivate_market_authoritative_source_registry_admin_v1(uuid,text)
  from public, anon, authenticated, service_role;
grant execute on function public.deactivate_market_authoritative_source_registry_admin_v1(uuid,text)
  to authenticated;

create table if not exists private.market_draft_primary_source_checks (
  id uuid primary key default gen_random_uuid(),
  draft_id uuid not null references private.market_drafts(id) on delete restrict,
  draft_version bigint not null check (draft_version > 0),
  registry_source_id uuid not null references private.market_source_registry(id) on delete restrict,
  requested_url text not null check (octet_length(requested_url) between 12 and 2048),
  final_url text not null check (octet_length(final_url) between 12 and 2048),
  draft_category text not null check (octet_length(draft_category) between 1 and 120),
  registry_role text not null default 'primary_resolution'
    check (registry_role = 'primary_resolution'),
  validation_version text not null
    check (validation_version = 'atinara-primary-source-validation-v1'),
  evidence_snapshot jsonb not null
    check (jsonb_typeof(evidence_snapshot) = 'object'
      and octet_length(evidence_snapshot::text) <= 8192),
  checked_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null default (clock_timestamp() + interval '10 minutes'),
  created_at timestamptz not null default clock_timestamp(),
  check (expires_at > checked_at)
);

create index if not exists market_draft_primary_source_checks_lookup_idx
  on private.market_draft_primary_source_checks (draft_id, draft_version, checked_at desc);

alter table private.market_draft_primary_source_checks enable row level security;
alter table private.market_draft_primary_source_checks force row level security;
revoke all on table private.market_draft_primary_source_checks from public, anon, authenticated;
revoke all on table private.market_draft_primary_source_checks from service_role;
grant all on table private.market_draft_primary_source_checks to postgres;

create or replace function private.prevent_market_draft_primary_source_check_mutation_v1()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  raise exception 'PRIMARY_SOURCE_CHECK_IMMUTABLE' using errcode = '55000';
end;
$function$;

drop trigger if exists market_draft_primary_source_checks_immutable
  on private.market_draft_primary_source_checks;
create trigger market_draft_primary_source_checks_immutable
before update or delete on private.market_draft_primary_source_checks
for each row execute function private.prevent_market_draft_primary_source_check_mutation_v1();

create or replace function public.record_market_draft_primary_source_check_v1(
  draft_id_input uuid,
  draft_version_input bigint,
  registry_source_id_input uuid,
  requested_url_input text,
  final_url_input text,
  category_input text,
  validation_version_input text,
  evidence_snapshot_input jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  draft_row private.market_drafts%rowtype;
  registry_row private.market_source_registry%rowtype;
  check_row private.market_draft_primary_source_checks%rowtype;
  chain_value jsonb;
  registry_categories_value jsonb;
  registry_domain_value text;
  edge_checked_at timestamptz;
begin
  if private.market_request_role_v1() is distinct from 'service_role' then
    raise exception 'SERVICE_ROLE_REQUIRED' using errcode = '42501';
  end if;
  if jsonb_typeof(coalesce(evidence_snapshot_input, 'null'::jsonb)) is distinct from 'object'
     or octet_length(evidence_snapshot_input::text) > 8192 then
    raise exception 'PRIMARY_SOURCE_CHECK_EVIDENCE_INVALID' using errcode = '22023';
  end if;
  select * into draft_row
  from private.market_drafts draft_alias
  where draft_alias.id = draft_id_input;
  if not found then raise exception 'DRAFT_NOT_FOUND' using errcode = 'P0001'; end if;
  if draft_row.content_version is distinct from draft_version_input then
    raise exception 'DRAFT_VERSION_MOVED' using errcode = '40001';
  end if;
  select * into registry_row
  from private.market_source_registry registry_alias
  where registry_alias.id = registry_source_id_input;
  if not found
     or coalesce(private.market_primary_registry_row_matches_v1(
       registry_row, final_url_input, category_input
     ), false) is not true then
    raise exception 'PRIMARY_SOURCE_REGISTRY_MISMATCH' using errcode = '22023';
  end if;
  registry_domain_value := regexp_replace(lower(rtrim(registry_row.canonical_domain, '.')), '^www\.', '');
  select coalesce(jsonb_agg(private.market_source_category_key_v1(category_value)
    order by private.market_source_category_key_v1(category_value)), '[]'::jsonb)
  into registry_categories_value
  from jsonb_array_elements_text(coalesce(registry_row.categories, '[]'::jsonb)) category_value;
  if jsonb_typeof(coalesce(evidence_snapshot_input -> 'registry_categories', 'null'::jsonb))
       is distinct from 'array' then
    raise exception 'PRIMARY_SOURCE_CHECK_EVIDENCE_INVALID' using errcode = '22023';
  end if;
  if private.market_source_category_key_v1(category_input) = ''
     or validation_version_input is distinct from 'atinara-primary-source-validation-v1'
     or evidence_snapshot_input ->> 'validation_version' is distinct from validation_version_input
     or evidence_snapshot_input ->> 'kind' is distinct from 'primary_resolution'
     or evidence_snapshot_input ->> 'code' is distinct from 'PRIMARY_SOURCE_VERIFIED'
     or evidence_snapshot_input -> 'accepted' is distinct from 'true'::jsonb
     or evidence_snapshot_input -> 'validated_reachable' is distinct from 'true'::jsonb
     or evidence_snapshot_input -> 'authority_verified' is distinct from 'true'::jsonb
     or evidence_snapshot_input -> 'relevance_verified' is distinct from 'true'::jsonb
     or evidence_snapshot_input ->> 'registry_role' is distinct from 'primary_resolution'
     or coalesce(evidence_snapshot_input ->> 'registry_source_id', '')
       is distinct from registry_row.id::text
     or evidence_snapshot_input ->> 'registry_parser_version'
       is distinct from registry_row.parser_version
     or evidence_snapshot_input ->> 'parser_version'
       is distinct from registry_row.parser_version
     or evidence_snapshot_input ->> 'registry_domain'
       is distinct from registry_domain_value
     or evidence_snapshot_input -> 'registry_role_verified' is distinct from 'true'::jsonb
     or evidence_snapshot_input ->> 'authority'
       is distinct from 'private_source_registry_primary_resolution_v1'
     or not ((evidence_snapshot_input -> 'registry_categories') @> registry_categories_value
       and registry_categories_value @> (evidence_snapshot_input -> 'registry_categories'))
     or evidence_snapshot_input ->> 'draft_category' is distinct from category_input
     or evidence_snapshot_input ->> 'requested_url' is distinct from requested_url_input
     or evidence_snapshot_input ->> 'final_url' is distinct from final_url_input
     or coalesce(evidence_snapshot_input ->> 'relevance_basis', '') not in (
       'fetched_content_v1', 'fetched_content_and_canonical_url_v1'
     )
     or coalesce(evidence_snapshot_input ->> 'excerpt_sha256', '') !~ '^[0-9a-f]{64}$'
     or evidence_snapshot_input ? 'excerpt'
     or evidence_snapshot_input ? 'content'
     or evidence_snapshot_input ? 'raw_content' then
    raise exception 'PRIMARY_SOURCE_CHECK_EVIDENCE_INVALID' using errcode = '22023';
  end if;
  if coalesce(evidence_snapshot_input ->> 'http_status', '') !~ '^[0-9]{3}$' then
    raise exception 'PRIMARY_SOURCE_CHECK_EVIDENCE_INVALID' using errcode = '22023';
  end if;
  if (evidence_snapshot_input ->> 'http_status')::integer not between 200 and 299 then
    raise exception 'PRIMARY_SOURCE_CHECK_EVIDENCE_INVALID' using errcode = '22023';
  end if;
  if coalesce(evidence_snapshot_input ->> 'excerpt_chars', '') !~ '^[1-9][0-9]{0,3}$'
     or (evidence_snapshot_input ->> 'excerpt_chars')::integer > 4000 then
    raise exception 'PRIMARY_SOURCE_CHECK_EVIDENCE_INVALID' using errcode = '22023';
  end if;
  if jsonb_typeof(coalesce(evidence_snapshot_input -> 'matched_tokens', 'null'::jsonb))
       is distinct from 'array' then
    raise exception 'PRIMARY_SOURCE_CHECK_EVIDENCE_INVALID' using errcode = '22023';
  end if;
  if jsonb_array_length(evidence_snapshot_input -> 'matched_tokens') = 0 then
    raise exception 'PRIMARY_SOURCE_CHECK_EVIDENCE_INVALID' using errcode = '22023';
  end if;
  begin
    edge_checked_at := (evidence_snapshot_input ->> 'checked_at')::timestamptz;
  exception when invalid_datetime_format then
    raise exception 'PRIMARY_SOURCE_CHECK_TIME_INVALID' using errcode = '22007';
  end;
  if edge_checked_at is null
     or edge_checked_at < clock_timestamp() - interval '5 minutes'
     or edge_checked_at > clock_timestamp() + interval '1 minute' then
    raise exception 'PRIMARY_SOURCE_CHECK_STALE' using errcode = '22023';
  end if;
  chain_value := coalesce(evidence_snapshot_input -> 'redirect_chain', 'null'::jsonb);
  if jsonb_typeof(chain_value) is distinct from 'array' then
    raise exception 'PRIMARY_SOURCE_REDIRECT_CHAIN_INVALID' using errcode = '22023';
  end if;
  if jsonb_array_length(chain_value) < 1
     or jsonb_array_length(chain_value) > 4
     or chain_value ->> 0 is distinct from requested_url_input
     or chain_value ->> (jsonb_array_length(chain_value) - 1) is distinct from final_url_input
     or exists (
       select 1
       from jsonb_array_elements_text(chain_value) chain_url
       where not exists (
         select 1
         from private.market_source_registry chain_registry
         where private.market_primary_registry_row_matches_v1(
           chain_registry, chain_url, category_input
         )
       )
     ) then
    raise exception 'PRIMARY_SOURCE_REDIRECT_CHAIN_INVALID' using errcode = '22023';
  end if;
  if coalesce(evidence_snapshot_input ->> 'redirect_count', '') !~ '^[0-3]$' then
    raise exception 'PRIMARY_SOURCE_REDIRECT_CHAIN_INVALID' using errcode = '22023';
  end if;
  if (evidence_snapshot_input ->> 'redirect_count')::integer
       is distinct from jsonb_array_length(chain_value) - 1 then
    raise exception 'PRIMARY_SOURCE_REDIRECT_CHAIN_INVALID' using errcode = '22023';
  end if;

  insert into private.market_draft_primary_source_checks(
    draft_id, draft_version, registry_source_id, requested_url, final_url, draft_category,
    registry_role, validation_version, evidence_snapshot
  ) values (
    draft_row.id, draft_row.content_version, registry_row.id,
    requested_url_input, final_url_input, category_input, 'primary_resolution',
    validation_version_input,
    (evidence_snapshot_input - 'checked_at') || jsonb_build_object(
      'checked_at', clock_timestamp(),
      'edge_checked_at', edge_checked_at,
      'registry_source_id', registry_row.id,
      'registry_domain', registry_domain_value,
      'registry_parser_version', registry_row.parser_version,
      'parser_version', registry_row.parser_version,
      'registry_role', 'primary_resolution',
      'registry_role_verified', true,
      'registry_categories', registry_categories_value,
      'authority', 'private_source_registry_primary_resolution_v1'
    )
  ) returning * into check_row;
  return jsonb_build_object(
    'id', check_row.id,
    'draft_id', check_row.draft_id,
    'draft_version', check_row.draft_version,
    'registry_source_id', check_row.registry_source_id,
    'registry_role', check_row.registry_role,
    'parser_version', registry_row.parser_version,
    'draft_category', check_row.draft_category,
    'checked_at', check_row.checked_at,
    'expires_at', check_row.expires_at
  );
end;
$function$;

revoke all on function public.record_market_draft_primary_source_check_v1(
  uuid,bigint,uuid,text,text,text,text,jsonb
) from public, anon, authenticated, service_role;
grant execute on function public.record_market_draft_primary_source_check_v1(
  uuid,bigint,uuid,text,text,text,text,jsonb
) to service_role;

-- La firma histórica no puede saltarse la atestación nueva.
revoke execute on function public.apply_market_draft_expert_repair(
  uuid,bigint,jsonb,jsonb,jsonb,jsonb
) from public, anon, authenticated, service_role;

create or replace function public.apply_market_draft_expert_repair_v2(
  draft_id_input uuid,
  expected_version_input bigint,
  draft_input jsonb,
  contract_input jsonb,
  sources_input jsonb,
  primary_source_check_id_input uuid,
  repair_meta_input jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor_id uuid := private.require_current_admin();
  check_row private.market_draft_primary_source_checks%rowtype;
  registry_row private.market_source_registry%rowtype;
  draft_row private.market_drafts%rowtype;
  primary_url_value text;
  chain_value jsonb;
  registry_categories_value jsonb;
  registry_domain_value text;
  result_value jsonb;
begin
  if jsonb_typeof(coalesce(draft_input, 'null'::jsonb)) is distinct from 'object'
     or jsonb_typeof(coalesce(sources_input, 'null'::jsonb)) is distinct from 'array'
     or jsonb_typeof(coalesce(repair_meta_input, 'null'::jsonb)) is distinct from 'object' then
    raise exception 'INVALID_EXPERT_REPAIR_PAYLOAD' using errcode = '22023';
  end if;
  select * into draft_row
  from private.market_drafts draft_alias
  where draft_alias.id = draft_id_input;
  if not found then raise exception 'DRAFT_NOT_FOUND' using errcode = 'P0001'; end if;
  select * into check_row
  from private.market_draft_primary_source_checks source_check
  where source_check.id = primary_source_check_id_input
    and source_check.draft_id = draft_id_input
    and source_check.draft_version = expected_version_input
    and source_check.checked_at >= clock_timestamp() - interval '10 minutes'
    and source_check.expires_at > clock_timestamp();
  if not found then
    raise exception 'PRIMARY_SOURCE_CHECK_REQUIRED' using errcode = '22023';
  end if;
  select * into registry_row
  from private.market_source_registry registry_alias
  where registry_alias.id = check_row.registry_source_id;
  if not found
     or coalesce(private.market_primary_registry_row_matches_v1(
       registry_row, check_row.final_url, check_row.draft_category
     ), false) is not true then
    raise exception 'PRIMARY_SOURCE_REGISTRY_MISMATCH' using errcode = '22023';
  end if;
  registry_domain_value := regexp_replace(lower(rtrim(registry_row.canonical_domain, '.')), '^www\.', '');
  select coalesce(jsonb_agg(private.market_source_category_key_v1(category_value)
    order by private.market_source_category_key_v1(category_value)), '[]'::jsonb)
  into registry_categories_value
  from jsonb_array_elements_text(coalesce(registry_row.categories, '[]'::jsonb)) category_value;
  if jsonb_typeof(coalesce(check_row.evidence_snapshot -> 'registry_categories', 'null'::jsonb))
       is distinct from 'array'
     or jsonb_typeof(coalesce(check_row.evidence_snapshot -> 'matched_tokens', 'null'::jsonb))
       is distinct from 'array' then
    raise exception 'PRIMARY_SOURCE_CHECK_TAMPERED' using errcode = '22023';
  end if;
  if check_row.registry_role is distinct from 'primary_resolution'
     or check_row.validation_version is distinct from 'atinara-primary-source-validation-v1'
     or check_row.evidence_snapshot ->> 'kind' is distinct from 'primary_resolution'
     or check_row.evidence_snapshot ->> 'code' is distinct from 'PRIMARY_SOURCE_VERIFIED'
     or check_row.evidence_snapshot -> 'accepted' is distinct from 'true'::jsonb
     or check_row.evidence_snapshot -> 'validated_reachable' is distinct from 'true'::jsonb
     or check_row.evidence_snapshot -> 'authority_verified' is distinct from 'true'::jsonb
     or check_row.evidence_snapshot -> 'relevance_verified' is distinct from 'true'::jsonb
     or check_row.evidence_snapshot ->> 'registry_source_id' is distinct from registry_row.id::text
     or check_row.evidence_snapshot ->> 'registry_parser_version' is distinct from registry_row.parser_version
     or check_row.evidence_snapshot ->> 'parser_version' is distinct from registry_row.parser_version
     or check_row.evidence_snapshot ->> 'registry_domain' is distinct from registry_domain_value
     or check_row.evidence_snapshot ->> 'registry_role' is distinct from 'primary_resolution'
     or check_row.evidence_snapshot -> 'registry_role_verified' is distinct from 'true'::jsonb
     or check_row.evidence_snapshot ->> 'authority'
       is distinct from 'private_source_registry_primary_resolution_v1'
     or not ((check_row.evidence_snapshot -> 'registry_categories') @> registry_categories_value
       and registry_categories_value @> (check_row.evidence_snapshot -> 'registry_categories'))
     or check_row.evidence_snapshot ->> 'validation_version' is distinct from check_row.validation_version
     or check_row.evidence_snapshot ->> 'requested_url' is distinct from check_row.requested_url
     or check_row.evidence_snapshot ->> 'final_url' is distinct from check_row.final_url
     or private.market_source_category_key_v1(check_row.evidence_snapshot ->> 'draft_category')
       is distinct from private.market_source_category_key_v1(check_row.draft_category)
     or coalesce(check_row.evidence_snapshot ->> 'excerpt_sha256', '') !~ '^[0-9a-f]{64}$'
     or coalesce(check_row.evidence_snapshot ->> 'http_status', '') !~ '^2[0-9]{2}$'
     or coalesce(check_row.evidence_snapshot ->> 'excerpt_chars', '') !~ '^[1-9][0-9]{0,3}$'
     or (check_row.evidence_snapshot ->> 'excerpt_chars')::integer > 4000
     or jsonb_array_length(check_row.evidence_snapshot -> 'matched_tokens') = 0
     or coalesce(check_row.evidence_snapshot ->> 'relevance_basis', '') not in (
       'fetched_content_v1', 'fetched_content_and_canonical_url_v1'
     )
     or check_row.evidence_snapshot ? 'excerpt'
     or check_row.evidence_snapshot ? 'content'
     or check_row.evidence_snapshot ? 'raw_content' then
    raise exception 'PRIMARY_SOURCE_CHECK_TAMPERED' using errcode = '22023';
  end if;
  chain_value := coalesce(check_row.evidence_snapshot -> 'redirect_chain', 'null'::jsonb);
  if jsonb_typeof(chain_value) is distinct from 'array' then
    raise exception 'PRIMARY_SOURCE_CHECK_TAMPERED' using errcode = '22023';
  end if;
  if jsonb_array_length(chain_value) < 1
     or jsonb_array_length(chain_value) > 4
     or chain_value ->> 0 is distinct from check_row.requested_url
     or chain_value ->> (jsonb_array_length(chain_value) - 1) is distinct from check_row.final_url
     or exists (
       select 1
       from jsonb_array_elements_text(chain_value) chain_url
       where not exists (
         select 1
         from private.market_source_registry chain_registry
         where private.market_primary_registry_row_matches_v1(
           chain_registry, chain_url, check_row.draft_category
         )
       )
     ) then
    raise exception 'PRIMARY_SOURCE_CHECK_TAMPERED' using errcode = '22023';
  end if;
  primary_url_value := trim(coalesce(draft_input -> 'primary_source' ->> 'url', ''));
  if jsonb_typeof(coalesce(draft_input -> 'primary_source' -> 'registry_categories', 'null'::jsonb))
       is distinct from 'array' then
    raise exception 'REPAIR_PRIMARY_SOURCE_CHECK_MISMATCH' using errcode = '22023';
  end if;
  if primary_url_value = ''
     or primary_url_value is distinct from check_row.final_url
     or private.market_source_category_key_v1(draft_input ->> 'category')
       is distinct from private.market_source_category_key_v1(check_row.draft_category)
     or draft_input -> 'primary_source' ->> 'registry_source_id'
       is distinct from registry_row.id::text
     or draft_input -> 'primary_source' ->> 'registry_domain'
       is distinct from registry_domain_value
     or draft_input -> 'primary_source' ->> 'registry_parser_version'
       is distinct from registry_row.parser_version
     or draft_input -> 'primary_source' ->> 'registry_role'
       is distinct from 'primary_resolution'
     or draft_input -> 'primary_source' -> 'registry_role_verified' is distinct from 'true'::jsonb
     or draft_input -> 'primary_source' ->> 'draft_category'
       is distinct from check_row.draft_category
     or not ((draft_input -> 'primary_source' -> 'registry_categories') @> registry_categories_value
       and registry_categories_value @> (draft_input -> 'primary_source' -> 'registry_categories'))
     or draft_input -> 'primary_source' ->> 'authority_basis'
       is distinct from 'private_source_registry_primary_resolution_v1'
     or draft_input -> 'primary_source' ->> 'relevance_basis'
       is distinct from check_row.evidence_snapshot ->> 'relevance_basis'
     or draft_input -> 'primary_source' ->> 'validation_version'
       is distinct from 'atinara-primary-source-validation-v1'
     or draft_input -> 'primary_source' -> 'validated_reachable' is distinct from 'true'::jsonb
     or draft_input -> 'primary_source' -> 'authority_verified' is distinct from 'true'::jsonb
     or draft_input -> 'primary_source' -> 'relevance_verified' is distinct from 'true'::jsonb
     or not exists (
       select 1
       from jsonb_array_elements(sources_input) source_item
       where source_item ->> 'role' = 'PRIMARY_RESOLUTION'
         and source_item ->> 'url' = check_row.final_url
     ) then
    raise exception 'REPAIR_PRIMARY_SOURCE_CHECK_MISMATCH' using errcode = '22023';
  end if;

  result_value := public.apply_market_draft_expert_repair(
    draft_id_input,
    expected_version_input,
    draft_input,
    contract_input,
    sources_input,
    repair_meta_input || jsonb_build_object(
      'primary_source_check_id', check_row.id,
      'primary_source_registry_id', registry_row.id,
      'primary_source_parser_version', registry_row.parser_version
    )
  );

  insert into private.market_admin_audit(actor_id, action_code, draft_id, draft_version, detail)
  values (
    actor_id,
    'MARKET_DRAFT_PRIMARY_SOURCE_CHECK_BOUND',
    draft_id_input,
    coalesce((result_value ->> 'new_version')::bigint, expected_version_input),
    jsonb_build_object(
      'source_check_id', check_row.id,
      'registry_source_id', registry_row.id,
      'registry_role', 'primary_resolution',
      'parser_version', registry_row.parser_version,
      'requested_url', check_row.requested_url,
      'final_url', check_row.final_url,
      'validation_version', check_row.validation_version,
      'checked_at', check_row.checked_at,
      'redirect_count', check_row.evidence_snapshot -> 'redirect_count',
      'relevance_basis', check_row.evidence_snapshot -> 'relevance_basis',
      'excerpt_sha256', check_row.evidence_snapshot -> 'excerpt_sha256',
      'publishes', false,
      'confirms', false,
      'resolves', false
    )
  );
  return result_value || jsonb_build_object(
    'primary_source_check_id', check_row.id,
    'primary_source_registry_id', registry_row.id
  );
end;
$function$;

revoke all on function public.apply_market_draft_expert_repair_v2(
  uuid,bigint,jsonb,jsonb,jsonb,uuid,jsonb
) from public, anon, authenticated, service_role;
grant execute on function public.apply_market_draft_expert_repair_v2(
  uuid,bigint,jsonb,jsonb,jsonb,uuid,jsonb
) to authenticated;

comment on function public.get_market_draft_authoritative_source_registry_v1(text) is
  'Catálogo privado configurable para PRIMARY del Corrector; solo service_role y rol primary_resolution.';
comment on function public.list_market_authoritative_source_registry_admin_v1() is
  'Lista el catálogo completo para un administrador autenticado sin conceder SELECT private.';
comment on function public.upsert_market_authoritative_source_registry_admin_v1(jsonb) is
  'Alta/reactivación idempotente y auditada de una autoridad PRIMARY con allowlists B2B cerradas.';
comment on function public.deactivate_market_authoritative_source_registry_admin_v1(uuid,text) is
  'Desactiva sin borrar una autoridad PRIMARY y conserva before/after y motivo en la auditoría.';
comment on table private.market_draft_primary_source_checks is
  'Atestaciones append-only, acotadas y ligadas a draft+versión. Nunca almacenan cuerpos completos.';
comment on function public.apply_market_draft_expert_repair_v2(uuid,bigint,jsonb,jsonb,jsonb,uuid,jsonb) is
  'Aplica una reparación solo con PRIMARY revalidada y registrada en la misma versión del borrador.';

commit;
