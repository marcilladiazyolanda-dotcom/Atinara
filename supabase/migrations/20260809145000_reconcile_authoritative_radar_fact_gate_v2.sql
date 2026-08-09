-- Atinara B2B: reconciliación auditada de la puerta factual v2 y puente
-- puntual para borradores Radar preparados antes de la migración 140.
--
-- Esta migración NO vuelve a ejecutar 140 ni rellena hechos en bloque. Antes de
-- reconciliar su historial exige el manifiesto exacto de las 27 funciones que
-- quedaron materializadas y todas las defensas estructurales críticas. Después
-- habilita una única RPC service-only: la Edge autentica al administrador, crea
-- primero un revalidate v2 fresco y la RPC atesta un prepare fact append-only
-- para el borrador legacy exacto sin cambiar contenido, versión ni candidata.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';

-- Producción recibió íntegramente 140 en una transacción anterior, pero aquella
-- ejecución no quedó registrada. Una instalación limpia ya tendrá la fila. En
-- ambos casos se verifica primero el mismo estado material; cualquier diferencia
-- aborta y nunca se inventa historial para una instalación parcial.
do $authoritative_gate_v1_preflight$
declare
  function_count integer;
  function_manifest text;
  history_name text;
begin
  if to_regclass('private.market_radar_fact_checks') is null
     or to_regclass('private.external_market_candidates') is null
     or to_regclass('private.market_drafts') is null
     or to_regclass('private.market_source_registry') is null then
    raise exception 'AUTHORITATIVE_RADAR_FACT_GATE_V1_REQUIRED'
      using errcode = '55000', detail = 'missing_required_relation';
  end if;

  with expected(schema_name,function_name) as (
    values
      ('public','get_market_radar_authoritative_source_domains_v1'),
      ('private','reject_market_radar_fact_check_mutation'),
      ('private','market_radar_sources_authorized_v1'),
      ('private','market_radar_selection_complete_sources_v1'),
      ('private','market_radar_sources_nonterminal_v1'),
      ('private','market_radar_provider_fact_authorized_v1'),
      ('private','market_radar_sources_support_reason_v1'),
      ('private','insert_market_radar_fact_check_v2'),
      ('private','enforce_authoritative_radar_fact_gate_v2'),
      ('private','market_radar_discovery_fact_current_v2'),
      ('private','market_radar_safe_payload'),
      ('public','list_market_radar_candidates_v2'),
      ('public','get_market_radar_candidate'),
      ('public','get_market_radar_candidate_for_revalidation_v1'),
      ('public','get_market_intelligence_origin'),
      ('public','upsert_market_radar_batch_with_fact_checks_v1'),
      ('private','market_radar_fact_gate_error_v2'),
      ('public','reserve_market_radar_candidate_for_prepare'),
      ('public','apply_market_radar_prepare_verification'),
      ('public','apply_market_radar_prepare_fact_verification_v1'),
      ('public','apply_market_radar_revalidation_fact_v1'),
      ('public','save_market_draft_from_radar'),
      ('public','save_market_draft_from_radar_intelligence'),
      ('private','assert_market_radar_draft_fact_current_v1'),
      ('private','ensure_market_source_publication_ready'),
      ('private','assert_market_source_publication_ready'),
      ('private','market_draft_radar_fact_publication_gate_v1')
  ), definitions as (
    select procedure_row.oid::regprocedure::text signature,
      encode(extensions.digest(
        convert_to(pg_get_functiondef(procedure_row.oid), 'UTF8'), 'sha256'
      ), 'hex') definition_sha256
    from pg_proc procedure_row
    join pg_namespace namespace_row on namespace_row.oid = procedure_row.pronamespace
    join expected on expected.schema_name = namespace_row.nspname
      and expected.function_name = procedure_row.proname
  )
  select count(*), encode(extensions.digest(convert_to(
      string_agg(signature || ':' || definition_sha256, E'\n' order by signature),
      'UTF8'
    ), 'sha256'), 'hex')
  into function_count, function_manifest
  from definitions;

  if function_count <> 27
     or function_manifest is distinct from
       '91f532bc85abba7538c0d53ff0e6d3c534c4b5e40a7f11b0bd538c15a25024e6' then
    raise exception 'AUTHORITATIVE_RADAR_FACT_GATE_V1_MANIFEST_MISMATCH'
      using errcode = '55000', detail = coalesce(function_manifest, 'missing');
  end if;

  if not exists (
       select 1 from information_schema.columns
       where table_schema = 'private' and table_name = 'external_market_candidates'
         and column_name in (
           'current_fact_check_id','fact_status','fact_policy_version',
           'fact_context_fingerprint','fact_checked_at','fact_check_expires_at',
           'fact_check_purpose'
         )
       group by table_schema, table_name having count(*) = 7
     )
     or not exists (
       select 1 from information_schema.columns
       where table_schema = 'private' and table_name = 'market_radar_fact_checks'
         and column_name in (
           'candidate_id','preparation_revision','purpose','attempt_id',
           'context_snapshot','context_sha256','source_snapshot','source_sha256',
           'expires_at'
         )
       group by table_schema, table_name having count(*) = 9
     )
     or not exists (
       select 1 from information_schema.columns
       where table_schema = 'private' and table_name = 'market_source_registry'
         and column_name in (
           'provider','source_name','canonical_domain','external_entity_id',
           'allowed_roles','authority_tier','categories','access_method',
           'health_status','retention_policy','parser_version','active',
           'created_at','updated_at'
         )
       group by table_schema, table_name having count(*) = 14
     ) then
    raise exception 'AUTHORITATIVE_RADAR_FACT_GATE_V1_REQUIRED'
      using errcode = '55000', detail = 'missing_required_column';
  end if;

  if not exists (
       select 1 from pg_constraint
       where conrelid = 'private.market_radar_fact_checks'::regclass
         and conname = 'market_radar_fact_checks_v2_shape_check'
     )
     or not exists (
       select 1 from pg_constraint
       where conrelid = 'private.external_market_candidates'::regclass
         and conname = 'external_market_candidates_fact_status_check'
     )
     or not exists (
       select 1 from pg_constraint
       where conrelid = 'private.external_market_candidates'::regclass
         and conname = 'external_market_candidates_fact_purpose_check'
     )
     or to_regclass('private.market_radar_fact_checks_attempt_uidx') is null
     or to_regclass('private.market_radar_fact_checks_candidate_revision_idx') is null
     or to_regclass('private.external_market_candidates_current_fact_idx') is null then
    raise exception 'AUTHORITATIVE_RADAR_FACT_GATE_V1_REQUIRED'
      using errcode = '55000', detail = 'missing_constraint_or_index';
  end if;

  if not exists (
       select 1 from pg_trigger
       where tgrelid = 'private.market_radar_fact_checks'::regclass
         and tgname = 'reject_market_radar_fact_check_mutation'
         and tgenabled <> 'D' and not tgisinternal
     )
     or not exists (
       select 1 from pg_trigger
       where tgrelid = 'private.external_market_candidates'::regclass
         and tgname = 'zzzz_authoritative_radar_fact_gate_v2_before_write'
         and tgenabled <> 'D' and not tgisinternal
     )
     or not exists (
       select 1 from pg_trigger
       where tgrelid = 'private.market_drafts'::regclass
         and tgname = 'aaaa_market_draft_radar_fact_publication_gate_v1'
         and tgenabled <> 'D' and not tgisinternal
     ) then
    raise exception 'AUTHORITATIVE_RADAR_FACT_GATE_V1_REQUIRED'
      using errcode = '55000', detail = 'missing_authoritative_trigger';
  end if;

  if has_table_privilege('service_role','private.external_market_candidates','SELECT')
     or has_table_privilege('service_role','private.external_market_candidates','INSERT')
     or has_table_privilege('service_role','private.external_market_candidates','UPDATE')
     or has_table_privilege('service_role','private.external_market_candidates','DELETE')
     or has_table_privilege('service_role','private.market_radar_fact_checks','SELECT')
     or has_table_privilege('service_role','private.market_radar_fact_checks','INSERT')
     or has_table_privilege('service_role','private.market_radar_fact_checks','UPDATE')
     or has_table_privilege('service_role','private.market_radar_fact_checks','DELETE')
     or has_table_privilege('service_role','private.market_drafts','SELECT')
     or has_table_privilege('service_role','private.market_drafts','INSERT')
     or has_table_privilege('service_role','private.market_drafts','UPDATE')
     or has_table_privilege('service_role','private.market_drafts','DELETE')
     or has_sequence_privilege('service_role','private.market_radar_fact_checks_id_seq','USAGE') then
    raise exception 'AUTHORITATIVE_RADAR_FACT_GATE_V1_ACL_MISMATCH'
      using errcode = '55000';
  end if;

  if (select count(*) from private.market_source_registry
      where provider = 'radar' and active
        and authority_tier = 'primary'
        and allowed_roles @> '["radar_fact_evidence"]'::jsonb) < 10
     or (select count(*) from private.market_source_registry
      where provider = 'radar_provider' and active
        and authority_tier = 'primary'
        and allowed_roles @> '["provider_fact"]'::jsonb) < 2 then
    raise exception 'AUTHORITATIVE_RADAR_FACT_GATE_V1_REGISTRY_MISMATCH'
      using errcode = '55000';
  end if;

  select migration.name into history_name
  from supabase_migrations.schema_migrations migration
  where migration.version = '20260809140000';
  if found and history_name is distinct from 'authoritative_radar_fact_gate_v1' then
    raise exception 'AUTHORITATIVE_RADAR_FACT_GATE_V1_HISTORY_CONFLICT'
      using errcode = '55000', detail = coalesce(history_name, 'unnamed');
  end if;

  if not found then
    insert into supabase_migrations.schema_migrations(
      version, statements, name, created_by, idempotency_key
    ) values (
      '20260809140000',
      array[concat(
        '-- audited material reconciliation; source_sha256=',
        '3e5a1b4567a202d359380fc1f31d3988b2a2b934f1a77eefd58f46901b5949db',
        '; source_bytes=112158; pg_function_manifest_sha256=',
        '91f532bc85abba7538c0d53ff0e6d3c534c4b5e40a7f11b0bd538c15a25024e6'
      )],
      'authoritative_radar_fact_gate_v1',
      'atinara_reconcile_authoritative_radar_fact_gate_v2',
      'atinara:20260809140000:3e5a1b4567a202d359380fc1f31d3988b2a2b934f1a77eefd58f46901b5949db'
    );
  end if;
end;
$authoritative_gate_v1_preflight$;

create table if not exists private.market_radar_legacy_fact_attestations (
  id bigint generated always as identity primary key,
  attempt_id uuid not null default gen_random_uuid() unique,
  draft_id uuid not null unique
    references private.market_drafts(id) on delete restrict,
  candidate_id uuid not null
    references private.external_market_candidates(id) on delete restrict,
  draft_version bigint not null check (draft_version > 0),
  draft_fingerprint text not null check (draft_fingerprint ~ '^[0-9a-f]{64}$'),
  candidate_revision bigint not null check (candidate_revision > 0),
  origin_prepare_fact_check_id bigint not null unique
    references private.market_radar_fact_checks(id) on delete restrict,
  current_revalidation_fact_check_id bigint not null
    references private.market_radar_fact_checks(id) on delete restrict,
  context_sha256 text not null check (context_sha256 ~ '^[0-9a-f]{64}$'),
  source_sha256 text not null check (source_sha256 ~ '^[0-9a-f]{64}$'),
  attestation_sha256 text not null unique check (attestation_sha256 ~ '^[0-9a-f]{64}$'),
  attested_by uuid not null,
  attested_at timestamptz not null default clock_timestamp(),
  constraint market_radar_legacy_fact_attestation_distinct_facts_check check (
    origin_prepare_fact_check_id <> current_revalidation_fact_check_id
  )
);

create index if not exists market_radar_legacy_fact_attest_candidate_idx
  on private.market_radar_legacy_fact_attestations(candidate_id, attested_at desc);

alter table private.market_radar_legacy_fact_attestations enable row level security;
alter table private.market_radar_legacy_fact_attestations force row level security;
revoke all privileges on table private.market_radar_legacy_fact_attestations
  from public, anon, authenticated, service_role;
revoke all privileges on sequence private.market_radar_legacy_fact_attestations_id_seq
  from public, anon, authenticated, service_role;
grant all privileges on table private.market_radar_legacy_fact_attestations to postgres;
grant all privileges on sequence private.market_radar_legacy_fact_attestations_id_seq to postgres;

create or replace function private.reject_market_radar_legacy_fact_attestation_mutation_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  raise exception 'RADAR_LEGACY_FACT_ATTESTATION_APPEND_ONLY' using errcode = '55000';
end;
$function$;

revoke all on function private.reject_market_radar_legacy_fact_attestation_mutation_v1()
  from public, anon, authenticated, service_role;

drop trigger if exists reject_market_radar_legacy_fact_attestation_mutation
  on private.market_radar_legacy_fact_attestations;
create trigger reject_market_radar_legacy_fact_attestation_mutation
before update or delete on private.market_radar_legacy_fact_attestations
for each row execute function private.reject_market_radar_legacy_fact_attestation_mutation_v1();

create or replace function private.market_radar_legacy_fact_attestation_valid_v1(
  draft_input private.market_drafts,
  provenance_input jsonb,
  checked_at_input timestamptz default clock_timestamp()
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  attestation private.market_radar_legacy_fact_attestations%rowtype;
  candidate private.external_market_candidates%rowtype;
  origin_fact private.market_radar_fact_checks%rowtype;
  current_fact private.market_radar_fact_checks%rowtype;
  attestation_id_value bigint;
  checked_at_value timestamptz := greatest(clock_timestamp(), coalesce(checked_at_input, clock_timestamp()));
begin
  if jsonb_typeof(provenance_input) <> 'object'
     or coalesce(provenance_input ->> 'radar_legacy_attestation_id', '') !~ '^[1-9][0-9]*$'
     or provenance_input ->> 'radar_legacy_attestation_version'
       is distinct from 'atinara-radar-legacy-attestation-v1' then
    return false;
  end if;
  attestation_id_value := (provenance_input ->> 'radar_legacy_attestation_id')::bigint;
  select * into attestation
  from private.market_radar_legacy_fact_attestations row_alias
  where row_alias.id = attestation_id_value;
  if not found
     or attestation.draft_id is distinct from draft_input.id
     or attestation.candidate_id is distinct from draft_input.radar_candidate_id
     or attestation.draft_version is distinct from draft_input.content_version
     or attestation.draft_fingerprint is distinct from private.market_draft_fingerprint(draft_input)
     or attestation.origin_prepare_fact_check_id::text is distinct from
       provenance_input ->> 'radar_fact_check_id'
     or attestation.current_revalidation_fact_check_id::text is distinct from
       provenance_input ->> 'radar_legacy_revalidation_fact_check_id'
     or attestation.context_sha256 is distinct from provenance_input ->> 'radar_fact_context_sha256'
     or attestation.source_sha256 is distinct from provenance_input ->> 'radar_fact_source_sha256'
     or attestation.attested_at > checked_at_value + interval '1 minute' then
    return false;
  end if;

  select * into candidate
  from private.external_market_candidates candidate_alias
  where candidate_alias.id = attestation.candidate_id;
  select * into origin_fact
  from private.market_radar_fact_checks fact_alias
  where fact_alias.id = attestation.origin_prepare_fact_check_id;
  select * into current_fact
  from private.market_radar_fact_checks fact_alias
  where fact_alias.id = attestation.current_revalidation_fact_check_id;

  if candidate.id is null or origin_fact.id is null or current_fact.id is null
     or candidate.state is distinct from 'prepared'
     or candidate.prepared_draft_id is distinct from draft_input.id
     or candidate.preparation_revision is distinct from attestation.candidate_revision
     or candidate.current_fact_check_id is distinct from current_fact.id
     or candidate.fact_check_purpose is distinct from 'revalidate'
     or candidate.fact_status is distinct from 'unresolved'
     or candidate.verification_status is distinct from 'verified_open'
     or candidate.fact_policy_version is distinct from 'atinara-terminal-fact-gate-v2'
     or origin_fact.candidate_id is distinct from candidate.id
     or current_fact.candidate_id is distinct from candidate.id
     or origin_fact.provider is distinct from candidate.provider
     or current_fact.provider is distinct from candidate.provider
     or origin_fact.external_id is distinct from candidate.external_id
     or current_fact.external_id is distinct from candidate.external_id
     or origin_fact.event_group_key is distinct from current_fact.event_group_key
     or origin_fact.preparation_revision is distinct from current_fact.preparation_revision
     or origin_fact.preparation_revision is distinct from candidate.preparation_revision
     or origin_fact.purpose is distinct from 'prepare'
     or current_fact.purpose is distinct from 'revalidate'
     or origin_fact.fact_policy_version is distinct from 'atinara-terminal-fact-gate-v2'
     or current_fact.fact_policy_version is distinct from 'atinara-terminal-fact-gate-v2'
     or origin_fact.fact_status is distinct from 'unresolved'
     or current_fact.fact_status is distinct from 'unresolved'
     or origin_fact.verification_status is distinct from 'verified_open'
     or current_fact.verification_status is distinct from 'verified_open'
     or origin_fact.context_snapshot is distinct from current_fact.context_snapshot
     or origin_fact.context_sha256 is distinct from current_fact.context_sha256
     or origin_fact.source_snapshot is distinct from current_fact.source_snapshot
     or origin_fact.source_sha256 is distinct from current_fact.source_sha256
     or origin_fact.checked_at is distinct from current_fact.checked_at
     or origin_fact.expires_at is distinct from current_fact.expires_at
     or origin_fact.context_sha256 is distinct from attestation.context_sha256
     or origin_fact.source_sha256 is distinct from attestation.source_sha256
     or not private.market_radar_sources_authorized_v1(current_fact.source_snapshot)
     or private.market_radar_fact_gate_error_v2(
       candidate.id, current_fact.preparation_revision, 'revalidate',
       checked_at_value, current_fact.id
     ) is not null then
    return false;
  end if;
  return true;
exception
  when invalid_text_representation or numeric_value_out_of_range then return false;
end;
$function$;

revoke all on function private.market_radar_legacy_fact_attestation_valid_v1(
  private.market_drafts,jsonb,timestamptz
) from public, anon, authenticated, service_role;

-- Sustituye únicamente el trigger de enlace: conserva la ruta normal cuyo
-- prepare fact es current y añade la ruta legacy autorizada por una atestación
-- append-only exacta. El resto de la procedencia factual continúa inmutable.
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
    'atomic_fact_gate', old.source_provenance -> 'atomic_fact_gate',
    'radar_legacy_attestation_id', old.source_provenance -> 'radar_legacy_attestation_id',
    'radar_legacy_attestation_version', old.source_provenance -> 'radar_legacy_attestation_version',
    'radar_legacy_revalidation_fact_check_id', old.source_provenance -> 'radar_legacy_revalidation_fact_check_id'
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
    'atomic_fact_gate', new.source_provenance -> 'atomic_fact_gate',
    'radar_legacy_attestation_id', new.source_provenance -> 'radar_legacy_attestation_id',
    'radar_legacy_attestation_version', new.source_provenance -> 'radar_legacy_attestation_version',
    'radar_legacy_revalidation_fact_check_id', new.source_provenance -> 'radar_legacy_revalidation_fact_check_id'
  );
  initial_fact_link_allowed boolean := false;
begin
  if old_radar_linked
     and (
       new.radar_candidate_id is distinct from old.radar_candidate_id
       or new_fact_link is distinct from old_fact_link
     ) then
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
          'prepare', clock_timestamp(),
          (new.source_provenance ->> 'radar_fact_check_id')::bigint
        ) is null;
        if not initial_fact_link_allowed then
          initial_fact_link_allowed := private.market_radar_legacy_fact_attestation_valid_v1(
            new, new.source_provenance, clock_timestamp()
          );
        end if;
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
    perform private.assert_market_radar_draft_fact_current_v1(new, clock_timestamp());
  end if;
  return new;
end;
$function$;

revoke all on function private.market_draft_radar_fact_publication_gate_v1()
  from public, anon, authenticated, service_role;

create or replace function public.attest_legacy_market_radar_draft_fact_v1(
  draft_id_input uuid,
  candidate_id_input uuid,
  expected_draft_version_input bigint,
  expected_draft_fingerprint_input text,
  expected_candidate_revision_input bigint,
  expected_revalidation_fact_check_id_input bigint,
  actor_id_input uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  draft_row private.market_drafts%rowtype;
  candidate private.external_market_candidates%rowtype;
  current_fact private.market_radar_fact_checks%rowtype;
  origin_fact private.market_radar_fact_checks%rowtype;
  existing_attestation private.market_radar_legacy_fact_attestations%rowtype;
  attestation private.market_radar_legacy_fact_attestations%rowtype;
  current_provenance jsonb;
  prepare_payload jsonb;
  origin_fact_id bigint;
  attestation_hash text;
  gate_error text;
  checked_at_value timestamptz := clock_timestamp();
begin
  if auth.role() <> 'service_role' then
    raise exception 'SERVICE_ROLE_REQUIRED' using errcode = '42501';
  end if;
  if actor_id_input is null or not exists (
    select 1 from auth.users user_row
    where user_row.id = actor_id_input
      and coalesce((user_row.raw_app_meta_data ->> 'oraklo_admin')::boolean, false)
  ) then
    return jsonb_build_object('ok', false, 'error', 'ADMIN_REQUIRED');
  end if;
  if draft_id_input is null or candidate_id_input is null
     or expected_draft_version_input is null or expected_draft_version_input < 1
     or coalesce(expected_draft_fingerprint_input, '') !~ '^[0-9a-f]{64}$'
     or expected_candidate_revision_input is null or expected_candidate_revision_input < 1
     or expected_revalidation_fact_check_id_input is null
     or expected_revalidation_fact_check_id_input < 1 then
    return jsonb_build_object('ok', false, 'error', 'RADAR_LEGACY_ATTESTATION_INPUT_INVALID');
  end if;

  -- Mismo orden de locks que publicación: primero borrador y después candidata.
  select * into draft_row
  from private.market_drafts draft_alias
  where draft_alias.id = draft_id_input
  for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'DRAFT_NOT_FOUND'); end if;
  if draft_row.content_version is distinct from expected_draft_version_input then
    return jsonb_build_object('ok', false, 'error', 'DRAFT_VERSION_MOVED');
  end if;
  if draft_row.content_fingerprint is distinct from expected_draft_fingerprint_input
     or draft_row.content_fingerprint is distinct from private.market_draft_fingerprint(draft_row) then
    return jsonb_build_object('ok', false, 'error', 'DRAFT_FINGERPRINT_MOVED');
  end if;
  if draft_row.radar_candidate_id is distinct from candidate_id_input then
    return jsonb_build_object('ok', false, 'error', 'RADAR_DRAFT_CANDIDATE_MISMATCH');
  end if;

  select * into candidate
  from private.external_market_candidates candidate_alias
  where candidate_alias.id = candidate_id_input
  for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'CANDIDATE_NOT_FOUND'); end if;
  if candidate.preparation_revision is distinct from expected_candidate_revision_input then
    return jsonb_build_object('ok', false, 'error', 'PREPARATION_REVISION_MISMATCH');
  end if;
  if candidate.current_fact_check_id is distinct from expected_revalidation_fact_check_id_input then
    return jsonb_build_object('ok', false, 'error', 'FACT_CHECK_REQUIRED');
  end if;

  current_provenance := coalesce(draft_row.source_provenance, '{}'::jsonb);
  if current_provenance ? 'radar_fact_check_id' then
    begin
      perform private.assert_market_radar_draft_fact_current_v1(draft_row, checked_at_value);
    exception when others then
      return jsonb_build_object('ok', false, 'error', case
        when position('RADAR_EVENT_ALREADY_RESOLVED' in sqlerrm) > 0 then 'RADAR_EVENT_ALREADY_RESOLVED'
        else 'RADAR_FACTUAL_REFRESH_REQUIRED' end);
    end;
    select * into existing_attestation
    from private.market_radar_legacy_fact_attestations row_alias
    where row_alias.draft_id = draft_row.id;
    return jsonb_build_object(
      'ok', true, 'attested', false, 'already_authoritative', true,
      'draft_id', draft_row.id, 'candidate_id', candidate.id,
      'preparation_revision', candidate.preparation_revision,
      'fact_check_id', candidate.current_fact_check_id,
      'legacy_attestation_id', existing_attestation.id
    );
  end if;

  if draft_row.workflow_status not in (
       'draft_incomplete','draft_ready','review_pending','review_in_progress',
       'review_rejected','review_inconclusive','review_unavailable','review_approved'
     )
     or draft_row.market_id is not null
     or draft_row.published_at is not null
     or draft_row.scheduled_for is not null
     or draft_row.human_confirmed_at is not null
     or draft_row.human_confirmed_by is not null
     or candidate.state is distinct from 'prepared'
     or candidate.prepared_draft_id is distinct from draft_row.id
     or candidate.normalizer_version is distinct from 'atinara-radar-v2'
     or jsonb_typeof(current_provenance) <> 'object'
     or coalesce(current_provenance ->> 'provider', '') is distinct from candidate.provider
     or coalesce(current_provenance ->> 'external_id', '') is distinct from candidate.external_id
     or (
       current_provenance ? 'radar_candidate_id'
       and current_provenance ->> 'radar_candidate_id' is distinct from candidate.id::text
     )
     or current_provenance ?| array[
       'radar_preparation_revision','radar_fact_policy_version','radar_fact_status',
       'radar_fact_purpose','radar_fact_context_sha256','radar_fact_source_sha256',
       'radar_fact_checked_at','atomic_fact_gate',
       'radar_legacy_attestation_id','radar_legacy_attestation_version',
       'radar_legacy_revalidation_fact_check_id','radar_legacy_attested_at'
     ] then
    return jsonb_build_object('ok', false, 'error', 'RADAR_LEGACY_DRAFT_NOT_ELIGIBLE');
  end if;

  if candidate.fact_status = 'fully_resolved'
     or candidate.verification_status = 'rejected_resolved' then
    return jsonb_build_object('ok', false, 'error', 'RADAR_EVENT_ALREADY_RESOLVED');
  end if;

  select * into current_fact
  from private.market_radar_fact_checks fact_alias
  where fact_alias.id = expected_revalidation_fact_check_id_input;
  if not found
     or current_fact.candidate_id is distinct from candidate.id
     or current_fact.preparation_revision is distinct from candidate.preparation_revision
     or current_fact.purpose is distinct from 'revalidate'
     or current_fact.fact_policy_version is distinct from 'atinara-terminal-fact-gate-v2'
     or current_fact.fact_status is distinct from 'unresolved'
     or current_fact.verification_status is distinct from 'verified_open'
     or current_fact.checked_at < checked_at_value - interval '5 minutes'
     or current_fact.checked_at > checked_at_value + interval '1 minute'
     or current_fact.expires_at <= checked_at_value
     or current_fact.context_sha256 is distinct from candidate.fact_context_fingerprint
     or current_fact.source_snapshot is distinct from candidate.verification_evidence
     or not private.market_radar_sources_authorized_v1(current_fact.source_snapshot) then
    return jsonb_build_object('ok', false, 'error', 'RADAR_FACTUAL_REFRESH_REQUIRED');
  end if;
  gate_error := private.market_radar_fact_gate_error_v2(
    candidate.id, current_fact.preparation_revision, 'revalidate',
    checked_at_value, current_fact.id
  );
  if gate_error is not null then
    return jsonb_build_object('ok', false, 'error', 'RADAR_FACTUAL_REFRESH_REQUIRED');
  end if;

  prepare_payload := jsonb_build_object(
    'attempt_id', gen_random_uuid(),
    'purpose', 'prepare',
    'provider', current_fact.provider,
    'external_id', current_fact.external_id,
    'event_group_key', current_fact.event_group_key,
    'fact_context_fingerprint', current_fact.context_sha256,
    'fact_policy_version', current_fact.fact_policy_version,
    'fact_status', current_fact.fact_status,
    'verification_status', current_fact.verification_status,
    'reason_code', current_fact.reason_code,
    'reason', coalesce(current_fact.reason, 'Atestación legacy ligada a una revalidación factual fresca.'),
    'confidence', current_fact.confidence,
    'evidence', current_fact.source_snapshot,
    'checked_at', current_fact.checked_at,
    'expires_at', current_fact.expires_at,
    'context_snapshot', current_fact.context_snapshot,
    'context_sha256', current_fact.context_sha256,
    'source_snapshot', current_fact.source_snapshot,
    'source_sha256', current_fact.source_sha256,
    'decision_hash', repeat('0', 64)
  );

  begin
    origin_fact_id := private.insert_market_radar_fact_check_v2(
      candidate.id, candidate.preparation_revision, 'prepare', prepare_payload
    );
    select * into origin_fact
    from private.market_radar_fact_checks fact_alias
    where fact_alias.id = origin_fact_id;

    attestation_hash := encode(extensions.digest(convert_to(jsonb_build_object(
      'attestation_version', 'atinara-radar-legacy-attestation-v1',
      'draft_id', draft_row.id,
      'draft_version', draft_row.content_version,
      'draft_fingerprint', draft_row.content_fingerprint,
      'candidate_id', candidate.id,
      'candidate_revision', candidate.preparation_revision,
      'origin_prepare_fact_check_id', origin_fact.id,
      'current_revalidation_fact_check_id', current_fact.id,
      'context_sha256', origin_fact.context_sha256,
      'source_sha256', origin_fact.source_sha256,
      'attested_by', actor_id_input
    )::text, 'UTF8'), 'sha256'), 'hex');

    insert into private.market_radar_legacy_fact_attestations(
      draft_id, candidate_id, draft_version, draft_fingerprint,
      candidate_revision, origin_prepare_fact_check_id,
      current_revalidation_fact_check_id, context_sha256, source_sha256,
      attestation_sha256, attested_by
    ) values (
      draft_row.id, candidate.id, draft_row.content_version,
      draft_row.content_fingerprint, candidate.preparation_revision,
      origin_fact.id, current_fact.id, origin_fact.context_sha256,
      origin_fact.source_sha256, attestation_hash, actor_id_input
    ) returning * into attestation;

    update private.market_drafts draft_alias set
      source_provenance = current_provenance || jsonb_build_object(
        'radar_candidate_id', candidate.id,
        'radar_preparation_revision', origin_fact.preparation_revision,
        'radar_fact_check_id', origin_fact.id,
        'radar_fact_policy_version', origin_fact.fact_policy_version,
        'radar_fact_status', origin_fact.fact_status,
        'radar_fact_context_sha256', origin_fact.context_sha256,
        'radar_fact_source_sha256', origin_fact.source_sha256,
        'radar_fact_checked_at', origin_fact.checked_at,
        'radar_fact_purpose', origin_fact.purpose,
        'atomic_fact_gate', true,
        'radar_legacy_attestation_id', attestation.id,
        'radar_legacy_attestation_version', 'atinara-radar-legacy-attestation-v1',
        'radar_legacy_revalidation_fact_check_id', current_fact.id,
        'radar_legacy_attested_at', attestation.attested_at
      ),
      updated_at = draft_alias.updated_at
    where draft_alias.id = draft_row.id
    returning * into draft_row;

    if draft_row.content_version is distinct from expected_draft_version_input
       or draft_row.content_fingerprint is distinct from expected_draft_fingerprint_input
       or candidate.preparation_revision is distinct from expected_candidate_revision_input
       or candidate.current_fact_check_id is distinct from expected_revalidation_fact_check_id_input then
      raise exception 'RADAR_LEGACY_ATTESTATION_MUTATED_AUTHORITATIVE_STATE'
        using errcode = '55000';
    end if;
    perform private.assert_market_radar_draft_fact_current_v1(draft_row, checked_at_value);

    insert into private.market_admin_audit(
      actor_id, action_code, draft_id, draft_version, detail
    ) values (
      actor_id_input, 'RADAR_LEGACY_FACT_ATTESTED', draft_row.id,
      draft_row.content_version, jsonb_build_object(
        'candidate_id', candidate.id,
        'candidate_revision', candidate.preparation_revision,
        'origin_prepare_fact_check_id', origin_fact.id,
        'current_revalidation_fact_check_id', current_fact.id,
        'attestation_id', attestation.id,
        'attestation_sha256', attestation.attestation_sha256,
        'draft_fingerprint', draft_row.content_fingerprint,
        'context_sha256', origin_fact.context_sha256,
        'source_sha256', origin_fact.source_sha256,
        'fact_policy_version', origin_fact.fact_policy_version,
        'legacy_bridge_version', 'atinara-radar-legacy-attestation-v1'
      )
    );
  exception when others then
    return jsonb_build_object(
      'ok', false,
      'error', case
        when position('RADAR_EVENT_ALREADY_RESOLVED' in sqlerrm) > 0
          then 'RADAR_EVENT_ALREADY_RESOLVED'
        when position('RADAR_FACTUAL_REFRESH_REQUIRED' in sqlerrm) > 0
          then 'RADAR_FACTUAL_REFRESH_REQUIRED'
        when position('RADAR_DRAFT_FACT_LINK_IMMUTABLE' in sqlerrm) > 0
          then 'RADAR_LEGACY_ATTESTATION_REJECTED'
        else 'RADAR_LEGACY_ATTESTATION_FAILED'
      end
    );
  end;

  return jsonb_build_object(
    'ok', true, 'attested', true, 'already_authoritative', false,
    'draft_id', draft_row.id, 'draft_version', draft_row.content_version,
    'draft_fingerprint', draft_row.content_fingerprint,
    'candidate_id', candidate.id,
    'preparation_revision', candidate.preparation_revision,
    'fact_check_id', candidate.current_fact_check_id,
    'origin_prepare_fact_check_id', origin_fact.id,
    'legacy_attestation_id', attestation.id,
    'legacy_attestation_sha256', attestation.attestation_sha256
  );
end;
$function$;

revoke all on function public.attest_legacy_market_radar_draft_fact_v1(
  uuid,uuid,bigint,text,bigint,bigint,uuid
) from public, anon, authenticated, service_role;
grant execute on function public.attest_legacy_market_radar_draft_fact_v1(
  uuid,uuid,bigint,text,bigint,bigint,uuid
) to service_role;

comment on table private.market_radar_legacy_fact_attestations is
  'Atestaciones append-only, una por borrador Radar legacy no publicado; nunca constituyen un backfill masivo.';
comment on function public.attest_legacy_market_radar_draft_fact_v1(
  uuid,uuid,bigint,text,bigint,bigint,uuid
) is
  'Liga un prepare fact v2 clonado de un revalidate fresco al borrador legacy exacto, sin cambiar contenido, versión ni candidata.';

commit;
