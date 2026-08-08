-- Paso 13.5.2 · Memoria autoritativa, idempotencia y separación de revisiones.
--
-- Esta migración conserva íntegramente los informes y la auditoría existentes.
-- Los estados técnicos dejan de ser el estado efectivo del contenido y cada
-- versión material pasa a tener un snapshot inmutable con huella SHA-256.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';

alter table private.market_drafts
  add column if not exists legacy_content_fingerprint text,
  add column if not exists fingerprint_version text not null default 'legacy-md5-v1',
  add column if not exists effective_review_id bigint,
  add column if not exists last_review_attempt_id uuid,
  add column if not exists human_confirmed_fingerprint text,
  add column if not exists human_confirmed_review_id bigint;

alter table private.market_review_reports
  add column if not exists policy_version text,
  add column if not exists schema_version text,
  add column if not exists canonical_fingerprint text,
  add column if not exists review_classification text,
  add column if not exists technical_code text,
  add column if not exists safe_provider_metadata jsonb not null default '{}'::jsonb;

create table if not exists private.market_draft_versions (
  id bigint generated always as identity primary key,
  draft_id uuid not null references private.market_drafts(id),
  content_version bigint not null check (content_version > 0),
  source_payload jsonb not null,
  canonical_payload jsonb not null,
  content_fingerprint text not null,
  fingerprint_version text not null,
  policy_version text not null,
  schema_version text not null,
  change_origin text not null,
  actor_id uuid,
  restored_from_version_id bigint references private.market_draft_versions(id),
  recovery_evidence jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (draft_id, content_version),
  constraint market_draft_versions_payloads_check check (
    jsonb_typeof(source_payload) = 'object'
    and jsonb_typeof(canonical_payload) = 'object'
    and jsonb_typeof(recovery_evidence) = 'object'
  )
);

create table if not exists private.market_review_attempts (
  id uuid primary key default gen_random_uuid(),
  request_key uuid not null,
  draft_id uuid not null references private.market_drafts(id),
  draft_version bigint not null,
  version_id bigint references private.market_draft_versions(id),
  content_fingerprint text not null,
  validator_version text not null,
  policy_version text not null,
  schema_version text not null,
  status text not null check (status in (
    'in_progress', 'approved', 'rejected', 'inconclusive',
    'invalid_response', 'provider_rate_limited', 'provider_timeout',
    'provider_unavailable', 'provider_auth_error', 'internal_error', 'stale'
  )),
  classification text not null check (classification in ('pending', 'content', 'technical')),
  technical_code text,
  safe_provider_metadata jsonb not null default '{}'::jsonb,
  report_id bigint unique references private.market_review_reports(id),
  reviewed_by uuid,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (draft_id, request_key),
  constraint market_review_attempt_metadata_check check (jsonb_typeof(safe_provider_metadata) = 'object')
);

create unique index if not exists market_review_attempt_one_running_idx
  on private.market_review_attempts(draft_id, draft_version)
  where completed_at is null;

create index if not exists market_review_attempts_draft_started_idx
  on private.market_review_attempts(draft_id, started_at desc);

create table if not exists private.market_effective_reviews (
  id bigint generated always as identity primary key,
  draft_id uuid not null references private.market_drafts(id),
  draft_version bigint not null,
  version_id bigint references private.market_draft_versions(id),
  attempt_id uuid references private.market_review_attempts(id),
  report_id bigint references private.market_review_reports(id),
  content_fingerprint text not null,
  validator_version text not null,
  policy_version text not null,
  schema_version text not null,
  compatibility_basis text not null,
  reused_from_effective_review_id bigint references private.market_effective_reviews(id),
  active boolean not null default true,
  revoked_at timestamptz,
  revoked_by uuid,
  revocation_reason text,
  superseded_at timestamptz,
  created_at timestamptz not null default now(),
  constraint market_effective_review_source_check check (attempt_id is not null or report_id is not null)
);

create unique index if not exists market_effective_review_one_active_idx
  on private.market_effective_reviews(draft_id)
  where active and revoked_at is null;

create index if not exists market_effective_review_reuse_idx
  on private.market_effective_reviews(
    draft_id, content_fingerprint, policy_version, schema_version, created_at desc
  ) where revoked_at is null;

create table if not exists private.market_review_policy_compatibility (
  validator_version text primary key,
  policy_version text not null,
  schema_version text not null,
  reusable boolean not null default false,
  compatibility_note text not null,
  invalidated_at timestamptz,
  created_at timestamptz not null default now()
);

insert into private.market_review_policy_compatibility(
  validator_version, policy_version, schema_version, reusable, compatibility_note
) values
  (
    'atinara-market-gate-v2',
    'atinara-market-review-policy-v2',
    'atinara-market-draft-schema-v2',
    true,
    'Compatibilidad exacta del validador canónico vigente.'
  ),
  (
    'step13.4-deterministic-v2',
    'atinara-market-review-policy-v2',
    'atinara-market-draft-schema-v2',
    true,
    'Puerta determinista ejecutada sobre el mismo payload canónico.'
  ),
  (
    'atinara-market-gate-repair-v1',
    'legacy-unversioned',
    'legacy-market-draft-v1',
    false,
    'Solo puede promoverse mediante una recuperación puntual con evidencia legacy y binding.'
  ),
  (
    'atinara-market-gate-legacy-bridge-v1',
    'legacy-unversioned',
    'legacy-market-draft-v1',
    false,
    'Puente fail-closed durante despliegue; nunca produce una aprobación efectiva reutilizable.'
  )
on conflict (validator_version) do update set
  policy_version = excluded.policy_version,
  schema_version = excluded.schema_version,
  reusable = excluded.reusable,
  compatibility_note = excluded.compatibility_note;

create table if not exists private.market_workflow_requests (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null,
  operation text not null,
  request_key uuid not null,
  request_hash text not null,
  draft_id uuid references private.market_drafts(id),
  response_payload jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (actor_id, operation, request_key),
  constraint market_workflow_request_response_check check (
    response_payload is null or jsonb_typeof(response_payload) = 'object'
  )
);

alter table private.market_draft_versions enable row level security;
alter table private.market_draft_versions force row level security;
alter table private.market_review_attempts enable row level security;
alter table private.market_review_attempts force row level security;
alter table private.market_effective_reviews enable row level security;
alter table private.market_effective_reviews force row level security;
alter table private.market_review_policy_compatibility enable row level security;
alter table private.market_review_policy_compatibility force row level security;
alter table private.market_workflow_requests enable row level security;
alter table private.market_workflow_requests force row level security;

revoke all on table private.market_draft_versions from public, anon, authenticated;
revoke all on table private.market_review_attempts from public, anon, authenticated;
revoke all on table private.market_effective_reviews from public, anon, authenticated;
revoke all on table private.market_review_policy_compatibility from public, anon, authenticated;
revoke all on table private.market_workflow_requests from public, anon, authenticated;
grant all on table private.market_draft_versions to postgres, service_role;
grant all on table private.market_review_attempts to postgres, service_role;
grant all on table private.market_effective_reviews to postgres, service_role;
grant all on table private.market_review_policy_compatibility to postgres, service_role;
grant all on table private.market_workflow_requests to postgres, service_role;
grant usage, select on all sequences in schema private to postgres, service_role;

create or replace function private.market_normalize_text(value_input text)
returns text
language sql
immutable
set search_path = ''
as $function$
  select nullif(
    regexp_replace(
      trim(replace(replace(coalesce(value_input, ''), E'\r\n', E'\n'), E'\r', E'\n')),
      '[[:space:]]+',
      ' ',
      'g'
    ),
    ''
  );
$function$;

create or replace function private.market_normalize_json(value_input jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $function$
declare
  result jsonb;
begin
  case jsonb_typeof(value_input)
    when 'object' then
      select coalesce(
        jsonb_object_agg(entry.key, private.market_normalize_json(entry.value) order by entry.key),
        '{}'::jsonb
      ) into result
      from jsonb_each(value_input) entry;
      return result;
    when 'array' then
      select coalesce(
        jsonb_agg(private.market_normalize_json(item.value) order by item.ordinality),
        '[]'::jsonb
      ) into result
      from jsonb_array_elements(value_input) with ordinality item(value, ordinality);
      return result;
    when 'string' then
      return to_jsonb(private.market_normalize_text(value_input #>> '{}'));
    else
      return value_input;
  end case;
end;
$function$;

create or replace function private.market_normalize_alternative_sources(value_input jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $function$
  select coalesce(
    jsonb_agg(normalized.item order by normalized.source_key, normalized.item::text),
    '[]'::jsonb
  )
  from (
    select distinct on (candidate.source_key)
      candidate.source_key,
      candidate.item
    from (
      select
        coalesce(
          nullif(private.market_normalize_json(source.value) ->> 'url', ''),
          private.market_normalize_json(source.value)::text
        ) as source_key,
        private.market_normalize_json(source.value) as item
      from jsonb_array_elements(
        case when jsonb_typeof(value_input) = 'array' then value_input else '[]'::jsonb end
      ) source(value)
      where jsonb_typeof(source.value) = 'object'
    ) candidate
    order by candidate.source_key, candidate.item::text
  ) normalized;
$function$;

create or replace function private.market_timestamp_canonical(value_input timestamptz)
returns text
language sql
immutable
set search_path = ''
as $function$
  select case when value_input is null then null else
    to_char(
      date_trunc('milliseconds', value_input) at time zone 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    )
  end;
$function$;

create or replace function private.market_draft_source_payload(draft private.market_drafts)
returns jsonb
language sql
stable
set search_path = ''
as $function$
  select jsonb_build_object(
    'market_slug', draft.market_slug,
    'question', draft.question,
    'subject', draft.subject,
    'category', draft.category,
    'yes_option', draft.yes_option,
    'no_option', draft.no_option,
    'evaluation_period_label', draft.evaluation_period_label,
    'evaluation_ends_at', draft.evaluation_ends_at,
    'closes_at', draft.closes_at,
    'timezone', draft.timezone,
    'resolution_deadline', draft.resolution_deadline,
    'yes_criteria', draft.yes_criteria,
    'no_criteria', draft.no_criteria,
    'edge_cases', draft.edge_cases,
    'primary_source', draft.primary_source,
    'alternative_sources', draft.alternative_sources,
    'delay_treatment', draft.delay_treatment,
    'cancellation_treatment', draft.cancellation_treatment,
    'leak_treatment', draft.leak_treatment,
    'rename_treatment', draft.rename_treatment,
    'assumptions', draft.assumptions,
    'public_criteria', draft.public_criteria,
    'description', draft.description
  );
$function$;

create or replace function private.market_draft_canonical_payload(draft private.market_drafts)
returns jsonb
language sql
stable
set search_path = ''
as $function$
  select jsonb_build_object(
    'market_slug', lower(coalesce(private.market_normalize_text(draft.market_slug), '')),
    'question', private.market_normalize_text(draft.question),
    'subject', private.market_normalize_text(draft.subject),
    'category', private.market_normalize_text(draft.category),
    'yes_option', private.market_normalize_text(draft.yes_option),
    'no_option', private.market_normalize_text(draft.no_option),
    'evaluation_period_label', private.market_normalize_text(draft.evaluation_period_label),
    'evaluation_ends_at', private.market_timestamp_canonical(draft.evaluation_ends_at),
    'closes_at', private.market_timestamp_canonical(draft.closes_at),
    'timezone', private.market_normalize_text(draft.timezone),
    'resolution_deadline', private.market_timestamp_canonical(draft.resolution_deadline),
    'yes_criteria', private.market_normalize_text(draft.yes_criteria),
    'no_criteria', private.market_normalize_text(draft.no_criteria),
    'edge_cases', private.market_normalize_text(draft.edge_cases),
    'primary_source', private.market_normalize_json(coalesce(draft.primary_source, '{}'::jsonb)),
    'alternative_sources', private.market_normalize_alternative_sources(draft.alternative_sources),
    'delay_treatment', private.market_normalize_text(draft.delay_treatment),
    'cancellation_treatment', private.market_normalize_text(draft.cancellation_treatment),
    'leak_treatment', private.market_normalize_text(draft.leak_treatment),
    'rename_treatment', private.market_normalize_text(draft.rename_treatment),
    'assumptions', private.market_normalize_text(draft.assumptions),
    'public_criteria', private.market_normalize_text(draft.public_criteria),
    'description', private.market_normalize_text(draft.description)
  );
$function$;

create or replace function private.market_draft_legacy_fingerprint(draft private.market_drafts)
returns text
language sql
immutable
set search_path = ''
as $function$
  select md5(concat_ws(
    E'\n',
    coalesce(draft.market_slug, ''), coalesce(draft.question, ''),
    coalesce(draft.subject, ''), coalesce(draft.category, ''),
    coalesce(draft.yes_option, ''), coalesce(draft.no_option, ''),
    coalesce(draft.evaluation_period_label, ''),
    coalesce(extract(epoch from draft.evaluation_ends_at)::text, ''),
    coalesce(draft.timezone, ''),
    coalesce(extract(epoch from draft.resolution_deadline)::text, ''),
    coalesce(draft.yes_criteria, ''), coalesce(draft.no_criteria, ''),
    coalesce(draft.edge_cases, ''), coalesce(draft.primary_source::text, ''),
    coalesce(draft.alternative_sources::text, ''), coalesce(draft.delay_treatment, ''),
    coalesce(draft.cancellation_treatment, ''), coalesce(draft.leak_treatment, ''),
    coalesce(draft.rename_treatment, ''), coalesce(draft.assumptions, ''),
    coalesce(draft.public_criteria, '')
  ));
$function$;

create or replace function private.market_draft_fingerprint(draft private.market_drafts)
returns text
language sql
stable
set search_path = ''
as $function$
  select encode(
    extensions.digest(
      convert_to(private.market_draft_canonical_payload(draft)::text, 'UTF8'),
      'sha256'
    ),
    'hex'
  );
$function$;

create or replace function private.prevent_market_draft_version_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  raise exception 'MARKET_DRAFT_VERSION_IMMUTABLE' using errcode = '55000';
end;
$function$;

drop trigger if exists prevent_market_draft_version_update on private.market_draft_versions;
create trigger prevent_market_draft_version_update
before update or delete on private.market_draft_versions
for each row execute function private.prevent_market_draft_version_mutation();

create or replace function private.record_market_draft_version(
  draft_input private.market_drafts,
  change_origin_input text,
  actor_id_input uuid,
  restored_from_version_id_input bigint default null,
  recovery_evidence_input jsonb default '{}'::jsonb
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $function$
declare
  version_id_value bigint;
begin
  insert into private.market_draft_versions(
    draft_id, content_version, source_payload, canonical_payload,
    content_fingerprint, fingerprint_version, policy_version, schema_version,
    change_origin, actor_id, restored_from_version_id, recovery_evidence
  ) values (
    draft_input.id,
    draft_input.content_version,
    private.market_draft_source_payload(draft_input),
    private.market_draft_canonical_payload(draft_input),
    private.market_draft_fingerprint(draft_input),
    'sha256-canonical-v2',
    'atinara-market-review-policy-v2',
    'atinara-market-draft-schema-v2',
    left(coalesce(nullif(trim(change_origin_input), ''), 'material_save'), 100),
    actor_id_input,
    restored_from_version_id_input,
    coalesce(recovery_evidence_input, '{}'::jsonb)
  )
  on conflict (draft_id, content_version) do nothing
  returning id into version_id_value;

  if version_id_value is null then
    select id into version_id_value
    from private.market_draft_versions
    where draft_id = draft_input.id and content_version = draft_input.content_version;
  end if;
  if version_id_value is null or exists (
    select 1
    from private.market_draft_versions existing_version
    where existing_version.id = version_id_value
      and (
        existing_version.content_fingerprint is distinct from private.market_draft_fingerprint(draft_input)
        or existing_version.canonical_payload is distinct from private.market_draft_canonical_payload(draft_input)
      )
  ) then
    raise exception 'MARKET_DRAFT_VERSION_CONFLICT' using errcode = '40001';
  end if;
  return version_id_value;
end;
$function$;

revoke all on function private.market_normalize_text(text) from public, anon, authenticated;
revoke all on function private.market_normalize_json(jsonb) from public, anon, authenticated;
revoke all on function private.market_normalize_alternative_sources(jsonb) from public, anon, authenticated;
revoke all on function private.market_timestamp_canonical(timestamptz) from public, anon, authenticated;
revoke all on function private.market_draft_source_payload(private.market_drafts) from public, anon, authenticated;
revoke all on function private.market_draft_canonical_payload(private.market_drafts) from public, anon, authenticated;
revoke all on function private.market_draft_legacy_fingerprint(private.market_drafts) from public, anon, authenticated;
revoke all on function private.market_draft_fingerprint(private.market_drafts) from public, anon, authenticated;
revoke all on function private.prevent_market_draft_version_mutation() from public, anon, authenticated;
revoke all on function private.record_market_draft_version(private.market_drafts,text,uuid,bigint,jsonb) from public, anon, authenticated;

update private.market_drafts draft
set
  legacy_content_fingerprint = coalesce(draft.legacy_content_fingerprint, draft.content_fingerprint),
  content_fingerprint = private.market_draft_fingerprint(draft),
  fingerprint_version = 'sha256-canonical-v2'
where draft.fingerprint_version is distinct from 'sha256-canonical-v2'
   or draft.content_fingerprint is distinct from private.market_draft_fingerprint(draft);

insert into private.market_draft_versions(
  draft_id, content_version, source_payload, canonical_payload,
  content_fingerprint, fingerprint_version, policy_version, schema_version,
  change_origin, actor_id, recovery_evidence
)
select
  draft.id,
  draft.content_version,
  private.market_draft_source_payload(draft),
  private.market_draft_canonical_payload(draft),
  private.market_draft_fingerprint(draft),
  'sha256-canonical-v2',
  'atinara-market-review-policy-v2',
  'atinara-market-draft-schema-v2',
  'migration_current_state_backfill',
  draft.updated_by,
  jsonb_build_object(
    'legacy_content_fingerprint', draft.legacy_content_fingerprint,
    'note', 'Snapshot de la versión que estaba vigente al instalar la memoria autoritativa.'
  )
from private.market_drafts draft
on conflict (draft_id, content_version) do nothing;

update private.market_review_reports report
set
  policy_version = coalesce(report.policy_version, 'legacy-unversioned'),
  schema_version = coalesce(report.schema_version, 'legacy-market-draft-v1'),
  review_classification = coalesce(
    report.review_classification,
    case when report.result in ('service_unavailable', 'quota_exhausted', 'invalid_response')
      then 'technical' else 'content' end
  ),
  technical_code = coalesce(
    report.technical_code,
    case report.result
      when 'invalid_response' then 'AUTOMATIC_RESPONSE_INVALID'
      when 'quota_exhausted' then 'PROVIDER_RATE_LIMITED'
      when 'service_unavailable' then 'PROVIDER_UNAVAILABLE'
      else null
    end
  );

insert into private.market_review_attempts(
  request_key, draft_id, draft_version, version_id, content_fingerprint,
  validator_version, policy_version, schema_version, status, classification,
  technical_code, safe_provider_metadata, report_id, reviewed_by,
  started_at, completed_at
)
select
  gen_random_uuid(),
  report.draft_id,
  report.draft_version,
  version.id,
  coalesce(report.canonical_fingerprint, report.content_fingerprint),
  report.validator_version,
  coalesce(report.policy_version, 'legacy-unversioned'),
  coalesce(report.schema_version, 'legacy-market-draft-v1'),
  case report.result
    when 'quota_exhausted' then 'provider_rate_limited'
    when 'service_unavailable' then 'provider_unavailable'
    else report.result
  end,
  coalesce(report.review_classification, 'content'),
  report.technical_code,
  coalesce(report.safe_provider_metadata, '{}'::jsonb),
  report.id,
  report.reviewed_by,
  report.created_at,
  report.created_at
from private.market_review_reports report
left join private.market_draft_versions version
  on version.draft_id = report.draft_id
 and version.content_version = report.draft_version
where not exists (
  select 1 from private.market_review_attempts attempt where attempt.report_id = report.id
);

update private.market_drafts draft
set last_review_attempt_id = (
  select attempt.id
  from private.market_review_attempts attempt
  where attempt.draft_id = draft.id
  order by attempt.started_at desc, attempt.id desc
  limit 1
)
where draft.last_review_attempt_id is null
  and exists (
    select 1 from private.market_review_attempts attempt where attempt.draft_id = draft.id
  );

comment on table private.market_draft_versions is
  'Snapshots inmutables de cada versión material. Los no-op no crean filas.';
comment on table private.market_review_attempts is
  'Cada ejecución de revisión, incluidos fallos técnicos, separada del veredicto efectivo.';
comment on table private.market_effective_reviews is
  'Aprobaciones efectivas aplicables por huella, política y esquema; nunca se sustituyen por fallos técnicos.';

create or replace function private.market_current_effective_review_id(draft private.market_drafts)
returns bigint
language sql
stable
set search_path = ''
as $function$
  select review.id
  from private.market_effective_reviews review
  where review.id = draft.effective_review_id
    and review.draft_id = draft.id
    and review.draft_version = draft.content_version
    and review.content_fingerprint = private.market_draft_fingerprint(draft)
    and review.policy_version = 'atinara-market-review-policy-v2'
    and review.schema_version = 'atinara-market-draft-schema-v2'
    and (
      review.compatibility_basis = 'one_off_precision_recovery_verified_by_legacy_fingerprint_binding_and_field_diff'
      or exists (
        select 1
        from private.market_review_policy_compatibility compatibility
        where compatibility.validator_version = review.validator_version
          and compatibility.policy_version = review.policy_version
          and compatibility.schema_version = review.schema_version
          and compatibility.reusable
          and compatibility.invalidated_at is null
      )
    )
    and review.active
    and review.revoked_at is null
  limit 1;
$function$;

create or replace function private.market_reusable_effective_review_id(
  draft_id_input uuid,
  content_fingerprint_input text
)
returns bigint
language sql
stable
set search_path = ''
as $function$
  select review.id
  from private.market_effective_reviews review
  where review.draft_id = draft_id_input
    and review.content_fingerprint = content_fingerprint_input
    and review.policy_version = 'atinara-market-review-policy-v2'
    and review.schema_version = 'atinara-market-draft-schema-v2'
    and (
      review.compatibility_basis = 'one_off_precision_recovery_verified_by_legacy_fingerprint_binding_and_field_diff'
      or exists (
        select 1
        from private.market_review_policy_compatibility compatibility
        where compatibility.validator_version = review.validator_version
          and compatibility.policy_version = review.policy_version
          and compatibility.schema_version = review.schema_version
          and compatibility.reusable
          and compatibility.invalidated_at is null
      )
    )
    and review.revoked_at is null
  order by review.created_at desc, review.id desc
  limit 1;
$function$;

create or replace function private.market_binding_compatibility(draft_id_input uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  draft_row private.market_drafts%rowtype;
  binding_row private.market_source_bindings%rowtype;
  primary_url text;
  reasons jsonb := '[]'::jsonb;
  missing_source_count integer := 0;
begin
  select * into draft_row from private.market_drafts where id = draft_id_input;
  if not found then
    return jsonb_build_object('compatible', false, 'reasons', jsonb_build_array('DRAFT_NOT_FOUND'));
  end if;

  select * into binding_row
  from private.market_source_bindings
  where draft_id = draft_id_input and status <> 'superseded'
  order by plan_version desc, created_at desc
  limit 1;

  if binding_row.id is null then
    return jsonb_build_object(
      'compatible', true,
      'required', false,
      'reasons', '[]'::jsonb,
      'message', 'Este borrador manual no requiere Plan de Resolución vinculado.'
    );
  end if;

  primary_url := trim(coalesce(draft_row.primary_source ->> 'url', ''));
  if private.market_normalize_text(binding_row.resolution_contract ->> 'canonical_statement')
     is distinct from private.market_normalize_text(draft_row.question) then
    reasons := reasons || '"BINDING_QUESTION_MISMATCH"'::jsonb;
  end if;
  if private.market_timestamp_canonical(
       nullif(coalesce(
         binding_row.resolution_contract ->> 'evaluation_at',
         binding_row.resolution_contract ->> 'window_end'
       ), '')::timestamptz
     ) is distinct from private.market_timestamp_canonical(draft_row.evaluation_ends_at) then
    reasons := reasons || '"BINDING_EVALUATION_MISMATCH"'::jsonb;
  end if;
  if private.market_normalize_text(binding_row.resolution_contract ->> 'timezone')
     is distinct from private.market_normalize_text(draft_row.timezone) then
    reasons := reasons || '"BINDING_TIMEZONE_MISMATCH"'::jsonb;
  end if;
  if not exists (
    select 1
    from private.market_source_binding_sources source
    where source.binding_id = binding_row.id
      and source.role = 'PRIMARY_RESOLUTION'
      and source.source_url = primary_url
  ) then
    reasons := reasons || '"BINDING_PRIMARY_SOURCE_MISMATCH"'::jsonb;
  end if;

  select count(*) into missing_source_count
  from jsonb_array_elements(private.market_normalize_alternative_sources(draft_row.alternative_sources)) source
  where nullif(source ->> 'url', '') is not null
    and not exists (
      select 1 from private.market_source_binding_sources binding_source
      where binding_source.binding_id = binding_row.id
        and binding_source.source_url = source ->> 'url'
    );
  if missing_source_count > 0 then
    reasons := reasons || '"BINDING_ALTERNATIVE_SOURCE_MISMATCH"'::jsonb;
  end if;

  return jsonb_build_object(
    'compatible', jsonb_array_length(reasons) = 0,
    'required', true,
    'binding_id', binding_row.id,
    'plan_version', binding_row.plan_version,
    'binding_status', binding_row.status,
    'contract_schema_version', binding_row.contract_schema_version,
    'policy_version', binding_row.policy_version,
    'reasons', reasons
  );
exception when invalid_datetime_format then
  return jsonb_build_object(
    'compatible', false,
    'required', true,
    'binding_id', binding_row.id,
    'plan_version', binding_row.plan_version,
    'reasons', jsonb_build_array('BINDING_DATE_INVALID')
  );
end;
$function$;

create or replace function private.sync_market_draft_binding(
  draft_id_input uuid,
  actor_id_input uuid,
  contract_override_input jsonb default null,
  sources_override_input jsonb default null,
  change_origin_input text default 'material_save'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  draft_row private.market_drafts%rowtype;
  active_binding private.market_source_bindings%rowtype;
  new_binding private.market_source_bindings%rowtype;
  current_sources jsonb := '[]'::jsonb;
  desired_sources jsonb := '[]'::jsonb;
  desired_contract jsonb;
  source_item jsonb;
  previous_item jsonb;
  alternative_item jsonb;
  primary_url text;
  source_url text;
  source_role text;
  source_precedence integer;
  next_precedence integer := 2;
  used_precedences integer[] := array[1];
  current_hash text;
  desired_hash text;
begin
  select * into draft_row from private.market_drafts where id = draft_id_input for update;
  if not found then raise exception 'DRAFT_NOT_FOUND' using errcode = 'P0001'; end if;

  select * into active_binding
  from private.market_source_bindings
  where draft_id = draft_id_input and status <> 'superseded'
  order by plan_version desc, created_at desc
  limit 1
  for update;

  if active_binding.id is null then
    return jsonb_build_object('required', false, 'changed', false, 'compatible', true);
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'url', source.source_url,
    'role', source.role,
    'precedence', source.precedence,
    'fallback_condition', source.fallback_condition,
    'required', source.required
  ) order by source.precedence, source.id), '[]'::jsonb)
  into current_sources
  from private.market_source_binding_sources source
  where source.binding_id = active_binding.id;

  if sources_override_input is not null then
    if jsonb_typeof(sources_override_input) <> 'array' then
      raise exception 'RESOLUTION_SOURCE_ASSIGNMENT_INVALID' using errcode = '22023';
    end if;
    desired_sources := sources_override_input;
  else
    primary_url := trim(coalesce(draft_row.primary_source ->> 'url', ''));
    if primary_url = '' then
      return jsonb_build_object(
        'required', true,
        'changed', false,
        'compatible', false,
        'binding_id', active_binding.id,
        'plan_version', active_binding.plan_version,
        'reasons', jsonb_build_array('BINDING_PRIMARY_SOURCE_MISSING')
      );
    end if;
    select value into previous_item
    from jsonb_array_elements(current_sources)
    where value ->> 'url' = primary_url
    order by coalesce((value ->> 'precedence')::integer, 1)
    limit 1;

    desired_sources := jsonb_build_array(jsonb_build_object(
      'url', primary_url,
      'role', 'PRIMARY_RESOLUTION',
      'precedence', 1,
      'fallback_condition', previous_item ->> 'fallback_condition',
      'required', true
    ));

    for alternative_item in
      select value
      from jsonb_array_elements(private.market_normalize_alternative_sources(draft_row.alternative_sources))
      order by value ->> 'url'
    loop
      source_url := trim(coalesce(alternative_item ->> 'url', ''));
      if source_url = '' or source_url = primary_url then continue; end if;
      previous_item := null;
      select value into previous_item
      from jsonb_array_elements(current_sources)
      where value ->> 'url' = source_url
      order by coalesce((value ->> 'precedence')::integer, 9999)
      limit 1;
      source_role := case
        when coalesce(previous_item ->> 'role', '') in (
          'DISCOVERY_SIGNAL', 'PROBABILITY_SIGNAL', 'CONTEXT_SOURCE',
          'FALLBACK_RESOLUTION', 'CORROBORATION', 'PROHIBITED_FOR_RESOLUTION'
        ) then previous_item ->> 'role'
        else 'CORROBORATION'
      end;
      source_precedence := coalesce((previous_item ->> 'precedence')::integer, next_precedence);
      while source_precedence = any(used_precedences) loop
        source_precedence := source_precedence + 1;
      end loop;
      used_precedences := array_append(used_precedences, source_precedence);
      next_precedence := greatest(next_precedence, source_precedence + 1);
      desired_sources := desired_sources || jsonb_build_array(jsonb_build_object(
        'url', source_url,
        'role', source_role,
        'precedence', source_precedence,
        'fallback_condition', previous_item ->> 'fallback_condition',
        'required', coalesce((previous_item ->> 'required')::boolean, false)
      ));
    end loop;
  end if;

  if (select count(*) from jsonb_array_elements(desired_sources) source
      where source ->> 'role' = 'PRIMARY_RESOLUTION') <> 1 then
    raise exception 'RESOLUTION_PRIMARY_SOURCE_REQUIRED' using errcode = '22023';
  end if;

  desired_contract := coalesce(contract_override_input, active_binding.resolution_contract, '{}'::jsonb);
  desired_contract := jsonb_set(desired_contract, '{canonical_statement}', coalesce(to_jsonb(draft_row.question), 'null'::jsonb), true);
  desired_contract := jsonb_set(desired_contract, '{evaluation_at}', coalesce(to_jsonb(draft_row.evaluation_ends_at), 'null'::jsonb), true);
  desired_contract := jsonb_set(desired_contract, '{window_end}', coalesce(to_jsonb(draft_row.evaluation_ends_at), 'null'::jsonb), true);
  desired_contract := jsonb_set(desired_contract, '{timezone}', coalesce(to_jsonb(draft_row.timezone), 'null'::jsonb), true);
  desired_contract := jsonb_set(desired_contract, '{resolution_deadline}', coalesce(to_jsonb(draft_row.resolution_deadline), 'null'::jsonb), true);
  desired_contract := jsonb_set(desired_contract, '{yes_criteria}', coalesce(to_jsonb(draft_row.yes_criteria), 'null'::jsonb), true);
  desired_contract := jsonb_set(desired_contract, '{no_criteria}', coalesce(to_jsonb(draft_row.no_criteria), 'null'::jsonb), true);
  desired_contract := jsonb_set(desired_contract, '{edge_cases}', coalesce(to_jsonb(draft_row.edge_cases), 'null'::jsonb), true);
  desired_contract := jsonb_set(desired_contract, '{sources}', desired_sources, true);

  current_hash := private.market_intelligence_hash(jsonb_build_object(
    'contract', private.market_normalize_json(active_binding.resolution_contract),
    'sources', current_sources
  ));
  desired_hash := private.market_intelligence_hash(jsonb_build_object(
    'contract', private.market_normalize_json(desired_contract),
    'sources', desired_sources
  ));

  if current_hash = desired_hash then
    return jsonb_build_object(
      'required', true,
      'changed', false,
      'compatible', true,
      'binding_id', active_binding.id,
      'plan_version', active_binding.plan_version
    );
  end if;

  update private.market_source_bindings
  set status = 'superseded', updated_at = now()
  where id = active_binding.id;

  insert into private.market_source_bindings(
    draft_id, market_id, origin_type, origin_id, expert_run_id, plan_version,
    contract_schema_version, policy_version, resolution_contract,
    status, validation, provider, adapter_version, monitor_required,
    monitor_readiness, supersedes_binding_id
  ) values (
    draft_row.id,
    draft_row.market_id,
    active_binding.origin_type,
    active_binding.origin_id,
    active_binding.expert_run_id,
    active_binding.plan_version + 1,
    coalesce(nullif(desired_contract ->> 'contract_schema_version', ''), active_binding.contract_schema_version),
    coalesce(nullif(desired_contract ->> 'policy_version', ''), active_binding.policy_version),
    desired_contract,
    'draft',
    '{}'::jsonb,
    coalesce(nullif(desired_contract ->> 'provider', ''), active_binding.provider),
    coalesce(nullif(desired_contract ->> 'provider_adapter_version', ''), active_binding.adapter_version),
    active_binding.monitor_required,
    case when active_binding.monitor_required then 'required' else 'not_required' end,
    active_binding.id
  ) returning * into new_binding;

  for source_item in select value from jsonb_array_elements(desired_sources) loop
    insert into private.market_source_binding_sources(
      binding_id, source_url, role, precedence, fallback_condition, required
    ) values (
      new_binding.id,
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
    'SOURCE_BINDING_VERSIONED_WITH_DRAFT',
    draft_row.id,
    draft_row.content_version,
    jsonb_build_object(
      'previous_binding_id', active_binding.id,
      'binding_id', new_binding.id,
      'previous_plan_version', active_binding.plan_version,
      'plan_version', new_binding.plan_version,
      'change_origin', left(coalesce(change_origin_input, 'material_save'), 100)
    )
  );

  return jsonb_build_object(
    'required', true,
    'changed', true,
    'compatible', true,
    'binding_id', new_binding.id,
    'plan_version', new_binding.plan_version,
    'previous_binding_id', active_binding.id
  );
end;
$function$;

revoke all on function private.market_current_effective_review_id(private.market_drafts) from public, anon, authenticated;
revoke all on function private.market_reusable_effective_review_id(uuid,text) from public, anon, authenticated;
revoke all on function private.market_binding_compatibility(uuid) from public, anon, authenticated;
revoke all on function private.sync_market_draft_binding(uuid,uuid,jsonb,jsonb,text) from public, anon, authenticated;

create or replace function public.save_market_draft(
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
  actor_id uuid := private.require_current_admin();
  draft_row private.market_drafts%rowtype;
  candidate_row private.market_drafts%rowtype;
  previous_fingerprint text;
  next_fingerprint text;
  next_legacy_fingerprint text;
  issues jsonb;
  next_evaluation_end timestamptz;
  next_resolution_deadline timestamptz;
  next_timezone text := nullif(trim(coalesce(draft_input ->> 'timezone', '')), '');
  next_slug text := lower(trim(coalesce(draft_input ->> 'market_slug', '')));
  next_primary_source jsonb := coalesce(draft_input -> 'primary_source', '{}'::jsonb);
  next_alternative_sources jsonb := coalesce(draft_input -> 'alternative_sources', '[]'::jsonb);
  change_origin text := left(coalesce(nullif(trim(draft_input ->> '_change_origin'), ''), 'manual_save'), 100);
  binding_managed_externally boolean := coalesce((draft_input ->> '_binding_managed_externally')::boolean, false);
  exact_timestamp_input boolean := draft_input ->> '_timestamp_precision' = 'milliseconds-v1';
  binding_result jsonb := null;
  reusable_review_id bigint;
  effective_review_id_value bigint;
  version_id_value bigint;
  restored_from_version_id_value bigint;
  request_key_value uuid;
  request_hash_value text;
  request_row private.market_workflow_requests%rowtype;
  response_value jsonb;
begin
  if jsonb_typeof(draft_input) <> 'object' then
    raise exception 'INVALID_DRAFT_PAYLOAD' using errcode = '22023';
  end if;
  if octet_length(draft_input::text) > 65536 then
    raise exception 'DRAFT_PAYLOAD_TOO_LARGE' using errcode = '22023';
  end if;
  if next_slug !~ '^[a-z0-9][a-z0-9-]{2,119}$' then
    raise exception 'INVALID_MARKET_SLUG' using errcode = '22023';
  end if;
  if jsonb_typeof(next_primary_source) <> 'object'
     or jsonb_typeof(next_alternative_sources) <> 'array' then
    raise exception 'INVALID_DRAFT_SOURCES' using errcode = '22023';
  end if;
  if next_timezone is not null and not exists (
    select 1 from pg_catalog.pg_timezone_names where name = next_timezone
  ) then
    raise exception 'INVALID_DRAFT_TIMEZONE' using errcode = '22023';
  end if;

  begin
    next_evaluation_end := nullif(trim(draft_input ->> 'evaluation_ends_at'), '')::timestamptz;
    next_resolution_deadline := nullif(trim(draft_input ->> 'resolution_deadline'), '')::timestamptz;
    request_key_value := nullif(trim(draft_input ->> '_idempotency_key'), '')::uuid;
  exception
    when invalid_datetime_format then
      raise exception 'INVALID_DRAFT_DATE' using errcode = '22007';
    when invalid_text_representation then
      raise exception 'INVALID_IDEMPOTENCY_KEY' using errcode = '22023';
  end;
  begin
    restored_from_version_id_value := nullif(trim(draft_input ->> '_restored_from_version_id'), '')::bigint;
  exception when invalid_text_representation then
    raise exception 'INVALID_RESTORED_VERSION' using errcode = '22023';
  end;
  request_key_value := coalesce(request_key_value, gen_random_uuid());
  request_hash_value := encode(extensions.digest(convert_to(
    jsonb_build_object(
      'draft_id', draft_id_input,
      'expected_version', expected_version_input,
      'draft', draft_input - '_idempotency_key' - '_change_origin'
        - '_binding_managed_externally' - '_timestamp_precision'
    )::text,
    'UTF8'
  ), 'sha256'), 'hex');

  insert into private.market_workflow_requests(
    actor_id, operation, request_key, request_hash
  ) values (
    actor_id, 'save_market_draft', request_key_value, request_hash_value
  )
  on conflict (actor_id, operation, request_key) do nothing
  returning * into request_row;

  if request_row.id is null then
    select * into request_row
    from private.market_workflow_requests existing_request
    where existing_request.actor_id = actor_id
      and existing_request.operation = 'save_market_draft'
      and existing_request.request_key = request_key_value;
    if request_row.request_hash is distinct from request_hash_value then
      raise exception 'IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD' using errcode = '22023';
    end if;
    if request_row.response_payload is not null then
      return request_row.response_payload || jsonb_build_object('idempotency_replay', true);
    end if;
    raise exception 'IDEMPOTENT_REQUEST_IN_PROGRESS' using errcode = '40001';
  end if;

  if draft_id_input is null then
    if restored_from_version_id_value is not null then
      raise exception 'INVALID_RESTORED_VERSION' using errcode = '22023';
    end if;
    insert into private.market_drafts (
      market_slug, question, subject, category, yes_option, no_option,
      evaluation_period_label, evaluation_ends_at, closes_at, timezone,
      resolution_deadline, yes_criteria, no_criteria, edge_cases,
      primary_source, alternative_sources, delay_treatment,
      cancellation_treatment, leak_treatment, rename_treatment, assumptions,
      public_criteria, description, created_by, updated_by
    ) values (
      next_slug,
      nullif(trim(draft_input ->> 'question'), ''),
      nullif(trim(draft_input ->> 'subject'), ''),
      nullif(trim(draft_input ->> 'category'), ''),
      coalesce(nullif(trim(draft_input ->> 'yes_option'), ''), 'Sí'),
      coalesce(nullif(trim(draft_input ->> 'no_option'), ''), 'No'),
      nullif(trim(draft_input ->> 'evaluation_period_label'), ''),
      next_evaluation_end,
      next_evaluation_end,
      next_timezone,
      next_resolution_deadline,
      nullif(trim(draft_input ->> 'yes_criteria'), ''),
      nullif(trim(draft_input ->> 'no_criteria'), ''),
      nullif(trim(draft_input ->> 'edge_cases'), ''),
      next_primary_source,
      next_alternative_sources,
      nullif(trim(draft_input ->> 'delay_treatment'), ''),
      nullif(trim(draft_input ->> 'cancellation_treatment'), ''),
      nullif(trim(draft_input ->> 'leak_treatment'), ''),
      nullif(trim(draft_input ->> 'rename_treatment'), ''),
      nullif(trim(draft_input ->> 'assumptions'), ''),
      nullif(trim(draft_input ->> 'public_criteria'), ''),
      nullif(trim(draft_input ->> 'description'), ''),
      actor_id,
      actor_id
    ) returning * into draft_row;

    next_fingerprint := private.market_draft_fingerprint(draft_row);
    next_legacy_fingerprint := private.market_draft_legacy_fingerprint(draft_row);
    issues := private.market_draft_deterministic_issues(draft_row);

    update private.market_drafts set
      content_fingerprint = next_fingerprint,
      legacy_content_fingerprint = next_legacy_fingerprint,
      fingerprint_version = 'sha256-canonical-v2',
      workflow_status = case when jsonb_array_length(issues) = 0 then 'draft_ready' else 'draft_incomplete' end,
      review_status = 'not_requested'
    where id = draft_row.id
    returning * into draft_row;

    version_id_value := private.record_market_draft_version(
      draft_row, change_origin, actor_id, null, '{}'::jsonb
    );

    insert into private.market_admin_audit(actor_id, action_code, draft_id, draft_version, detail)
    values (
      actor_id,
      'DRAFT_CREATED',
      draft_row.id,
      draft_row.content_version,
      jsonb_build_object(
        'deterministic_issue_count', jsonb_array_length(issues),
        'changed', true,
        'version_id', version_id_value,
        'fingerprint_version', 'sha256-canonical-v2',
        'idempotency_key_recorded', true
      )
    );

    response_value := jsonb_build_object(
      'draft', to_jsonb(draft_row) - 'created_by' - 'updated_by' - 'human_confirmed_by' - 'published_by',
      'deterministic_issues', issues,
      'changed', true,
      'review_preserved', false,
      'review_reused_from_memory', false,
      'version_unchanged', false,
      'version_id', version_id_value,
      'idempotency_replay', false
    );
    update private.market_workflow_requests set
      draft_id = draft_row.id,
      response_payload = response_value,
      completed_at = now()
    where id = request_row.id;
    return response_value;
  end if;

  select * into draft_row
  from private.market_drafts
  where id = draft_id_input
  for update;
  if not found then raise exception 'DRAFT_NOT_FOUND' using errcode = 'P0001'; end if;
  if expected_version_input is null or expected_version_input <> draft_row.content_version then
    raise exception 'DRAFT_VERSION_MOVED' using errcode = '40001';
  end if;
  if draft_row.workflow_status in (
    'published', 'early_closed', 'cancelled', 'pending_resolution', 'resolved', 'annulled'
  ) then
    raise exception 'PUBLISHED_MARKET_FIELDS_LOCKED' using errcode = '22023';
  end if;
  if restored_from_version_id_value is not null and (
    change_origin <> 'version_restore'
    or not exists (
      select 1
      from private.market_draft_versions source_version
      where source_version.id = restored_from_version_id_value
        and source_version.draft_id = draft_row.id
    )
  ) then
    raise exception 'INVALID_RESTORED_VERSION' using errcode = '22023';
  end if;

  -- Clientes anteriores a Paso 13.5.2 solo enviaban minutos. Se conserva su
  -- protección de compatibilidad, pero un cliente que declara precisión exacta
  -- puede cambiar intencionadamente :59.000 por :00.000.
  if not exact_timestamp_input then
    next_evaluation_end := private.market_datetime_preserve_precision(
      draft_row.evaluation_ends_at, next_evaluation_end
    );
    next_resolution_deadline := private.market_datetime_preserve_precision(
      draft_row.resolution_deadline, next_resolution_deadline
    );
  end if;

  previous_fingerprint := private.market_draft_fingerprint(draft_row);
  candidate_row := draft_row;
  candidate_row.market_slug := next_slug;
  candidate_row.question := nullif(trim(draft_input ->> 'question'), '');
  candidate_row.subject := nullif(trim(draft_input ->> 'subject'), '');
  candidate_row.category := nullif(trim(draft_input ->> 'category'), '');
  candidate_row.yes_option := coalesce(nullif(trim(draft_input ->> 'yes_option'), ''), 'Sí');
  candidate_row.no_option := coalesce(nullif(trim(draft_input ->> 'no_option'), ''), 'No');
  candidate_row.evaluation_period_label := nullif(trim(draft_input ->> 'evaluation_period_label'), '');
  candidate_row.evaluation_ends_at := next_evaluation_end;
  candidate_row.closes_at := next_evaluation_end;
  candidate_row.timezone := next_timezone;
  candidate_row.resolution_deadline := next_resolution_deadline;
  candidate_row.yes_criteria := nullif(trim(draft_input ->> 'yes_criteria'), '');
  candidate_row.no_criteria := nullif(trim(draft_input ->> 'no_criteria'), '');
  candidate_row.edge_cases := nullif(trim(draft_input ->> 'edge_cases'), '');
  candidate_row.primary_source := next_primary_source;
  candidate_row.alternative_sources := next_alternative_sources;
  candidate_row.delay_treatment := nullif(trim(draft_input ->> 'delay_treatment'), '');
  candidate_row.cancellation_treatment := nullif(trim(draft_input ->> 'cancellation_treatment'), '');
  candidate_row.leak_treatment := nullif(trim(draft_input ->> 'leak_treatment'), '');
  candidate_row.rename_treatment := nullif(trim(draft_input ->> 'rename_treatment'), '');
  candidate_row.assumptions := nullif(trim(draft_input ->> 'assumptions'), '');
  candidate_row.public_criteria := nullif(trim(draft_input ->> 'public_criteria'), '');
  candidate_row.description := nullif(trim(draft_input ->> 'description'), '');
  next_fingerprint := private.market_draft_fingerprint(candidate_row);
  next_legacy_fingerprint := private.market_draft_legacy_fingerprint(candidate_row);

  if previous_fingerprint = next_fingerprint then
    issues := private.market_draft_deterministic_issues(draft_row);
    insert into private.market_admin_audit(actor_id, action_code, draft_id, draft_version, detail)
    values (
      actor_id,
      'DRAFT_SAVE_NOOP_REVIEW_PRESERVED',
      draft_row.id,
      draft_row.content_version,
      jsonb_build_object(
        'deterministic_issue_count', jsonb_array_length(issues),
        'changed', false,
        'review_status', draft_row.review_status,
        'workflow_status', draft_row.workflow_status,
        'effective_review_id', draft_row.effective_review_id,
        'human_confirmation_preserved', draft_row.human_confirmed_at is not null,
        'fingerprint_version', draft_row.fingerprint_version
      )
    );
    response_value := jsonb_build_object(
      'draft', to_jsonb(draft_row) - 'created_by' - 'updated_by' - 'human_confirmed_by' - 'published_by',
      'deterministic_issues', issues,
      'changed', false,
      'review_preserved', true,
      'review_reused_from_memory', false,
      'version_unchanged', true,
      'idempotency_replay', false,
      'message', 'No había cambios materiales. Se conserva la versión y la revisión vigente.'
    );
    update private.market_workflow_requests set
      draft_id = draft_row.id,
      response_payload = response_value,
      completed_at = now()
    where id = request_row.id;
    return response_value;
  end if;

  update private.market_effective_reviews set
    active = false,
    superseded_at = coalesce(superseded_at, now())
  where id = draft_row.effective_review_id and active;

  update private.market_drafts set
    market_slug = candidate_row.market_slug,
    question = candidate_row.question,
    subject = candidate_row.subject,
    category = candidate_row.category,
    yes_option = candidate_row.yes_option,
    no_option = candidate_row.no_option,
    evaluation_period_label = candidate_row.evaluation_period_label,
    evaluation_ends_at = candidate_row.evaluation_ends_at,
    closes_at = candidate_row.closes_at,
    timezone = candidate_row.timezone,
    resolution_deadline = candidate_row.resolution_deadline,
    yes_criteria = candidate_row.yes_criteria,
    no_criteria = candidate_row.no_criteria,
    edge_cases = candidate_row.edge_cases,
    primary_source = candidate_row.primary_source,
    alternative_sources = candidate_row.alternative_sources,
    delay_treatment = candidate_row.delay_treatment,
    cancellation_treatment = candidate_row.cancellation_treatment,
    leak_treatment = candidate_row.leak_treatment,
    rename_treatment = candidate_row.rename_treatment,
    assumptions = candidate_row.assumptions,
    public_criteria = candidate_row.public_criteria,
    description = candidate_row.description,
    content_version = content_version + 1,
    content_fingerprint = next_fingerprint,
    legacy_content_fingerprint = next_legacy_fingerprint,
    fingerprint_version = 'sha256-canonical-v2',
    effective_review_id = null,
    reviewed_version = null,
    reviewed_fingerprint = null,
    review_status = 'not_requested',
    workflow_status = 'draft_ready',
    human_confirmed_at = null,
    human_confirmed_by = null,
    human_confirmed_fingerprint = null,
    human_confirmed_review_id = null,
    last_review_attempt_id = null,
    updated_by = actor_id,
    updated_at = now()
  where id = draft_row.id
  returning * into draft_row;

  issues := private.market_draft_deterministic_issues(draft_row);
  if jsonb_array_length(issues) = 0 then
    reusable_review_id := private.market_reusable_effective_review_id(
      draft_row.id, draft_row.content_fingerprint
    );
  end if;

  if reusable_review_id is not null then
    insert into private.market_effective_reviews(
      draft_id, draft_version, version_id, attempt_id, report_id,
      content_fingerprint, validator_version, policy_version, schema_version,
      compatibility_basis, reused_from_effective_review_id, active
    )
    select
      draft_row.id,
      draft_row.content_version,
      null,
      source_review.attempt_id,
      source_review.report_id,
      draft_row.content_fingerprint,
      source_review.validator_version,
      source_review.policy_version,
      source_review.schema_version,
      'exact_canonical_fingerprint_and_policy_reuse',
      source_review.id,
      true
    from private.market_effective_reviews source_review
    where source_review.id = reusable_review_id
    returning id into effective_review_id_value;
  end if;

  update private.market_drafts set
    workflow_status = case
      when jsonb_array_length(issues) > 0 then 'draft_incomplete'
      when effective_review_id_value is not null then 'review_approved'
      else 'draft_ready'
    end,
    review_status = case when effective_review_id_value is not null then 'approved' else 'not_requested' end,
    effective_review_id = effective_review_id_value,
    reviewed_version = case when effective_review_id_value is not null then content_version else null end,
    reviewed_fingerprint = case when effective_review_id_value is not null then content_fingerprint else null end
  where id = draft_row.id
  returning * into draft_row;

  version_id_value := private.record_market_draft_version(
    draft_row, change_origin, actor_id, restored_from_version_id_value, '{}'::jsonb
  );
  if effective_review_id_value is not null then
    update private.market_effective_reviews
    set version_id = version_id_value
    where id = effective_review_id_value;
  end if;

  if not binding_managed_externally then
    binding_result := private.sync_market_draft_binding(
      draft_row.id, actor_id, null, null, change_origin
    );
  end if;

  insert into private.market_admin_audit(actor_id, action_code, draft_id, draft_version, detail)
  values (
    actor_id,
    case when effective_review_id_value is not null
      then 'DRAFT_SAVED_APPROVAL_REUSED_FROM_MEMORY'
      else 'DRAFT_SAVED_REVIEW_INVALIDATED'
    end,
    draft_row.id,
    draft_row.content_version,
    jsonb_build_object(
      'deterministic_issue_count', jsonb_array_length(issues),
      'changed', true,
      'previous_fingerprint', previous_fingerprint,
      'next_fingerprint', next_fingerprint,
      'fingerprint_version', 'sha256-canonical-v2',
      'version_id', version_id_value,
      'effective_review_id', effective_review_id_value,
      'reused_from_effective_review_id', reusable_review_id,
      'binding_sync', binding_result,
      'change_origin', change_origin
    )
  );

  response_value := jsonb_build_object(
    'draft', to_jsonb(draft_row) - 'created_by' - 'updated_by' - 'human_confirmed_by' - 'published_by',
    'deterministic_issues', issues,
    'changed', true,
    'review_preserved', false,
    'review_reused_from_memory', effective_review_id_value is not null,
    'version_unchanged', false,
    'version_id', version_id_value,
    'binding_sync', binding_result,
    'idempotency_replay', false,
    'message', case when effective_review_id_value is not null
      then 'El contenido coincide con una versión aprobada compatible. Se recuperó la revisión y hace falta una nueva confirmación humana.'
      else 'Los cambios materiales crearon una versión nueva e invalidaron la revisión anterior.'
    end
  );
  update private.market_workflow_requests set
    draft_id = draft_row.id,
    response_payload = response_value,
    completed_at = now()
  where id = request_row.id;
  return response_value;
end;
$function$;

revoke all on function public.save_market_draft(uuid,bigint,jsonb) from public, anon;
grant execute on function public.save_market_draft(uuid,bigint,jsonb) to authenticated;

create or replace function public.begin_market_draft_review_v2(
  draft_id_input uuid,
  expected_version_input bigint,
  request_key_input uuid,
  validator_version_input text,
  policy_version_input text,
  schema_version_input text,
  force_review_input boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor_id uuid := private.require_current_admin();
  draft_row private.market_drafts%rowtype;
  attempt_row private.market_review_attempts%rowtype;
  issues jsonb;
  report_id_value bigint;
  version_id_value bigint;
  current_effective_id bigint;
begin
  if request_key_input is null
     or trim(coalesce(validator_version_input, '')) = ''
     or trim(coalesce(policy_version_input, '')) = ''
     or trim(coalesce(schema_version_input, '')) = '' then
    raise exception 'INVALID_REVIEW_REQUEST' using errcode = '22023';
  end if;

  select * into draft_row
  from private.market_drafts
  where id = draft_id_input
  for update;
  if not found then raise exception 'DRAFT_NOT_FOUND' using errcode = 'P0001'; end if;
  if expected_version_input is null or draft_row.content_version <> expected_version_input then
    raise exception 'DRAFT_VERSION_MOVED' using errcode = '40001';
  end if;
  if draft_row.workflow_status in (
    'published', 'scheduled', 'cancelled', 'resolved', 'annulled',
    'early_closed', 'pending_resolution'
  ) then
    raise exception 'DRAFT_REVIEW_NOT_ALLOWED' using errcode = '22023';
  end if;
  if draft_row.content_fingerprint is distinct from private.market_draft_fingerprint(draft_row)
     or draft_row.fingerprint_version <> 'sha256-canonical-v2' then
    raise exception 'DRAFT_FINGERPRINT_STALE' using errcode = '40001';
  end if;

  select * into attempt_row
  from private.market_review_attempts
  where draft_id = draft_row.id and request_key = request_key_input;
  if attempt_row.id is not null then
    return jsonb_build_object(
      'status', attempt_row.status,
      'classification', attempt_row.classification,
      'technical_code', attempt_row.technical_code,
      'attempt_id', attempt_row.id,
      'report_id', attempt_row.report_id,
      'idempotency_replay', true,
      'completed', attempt_row.completed_at is not null,
      'draft_version', attempt_row.draft_version,
      'content_fingerprint', attempt_row.content_fingerprint,
      'blocking_reasons', coalesce((
        select report.semantic_issues
        from private.market_review_reports report
        where report.id = attempt_row.report_id
      ), '[]'::jsonb),
      'editorial_notes', coalesce((
        select report.editorial_notes
        from private.market_review_reports report
        where report.id = attempt_row.report_id
      ), '[]'::jsonb),
      'effective_review_id', private.market_current_effective_review_id(draft_row),
      'effective_review_preserved', private.market_current_effective_review_id(draft_row) is not null
    );
  end if;

  update private.market_review_attempts set
    status = 'provider_timeout',
    classification = 'technical',
    technical_code = 'PROVIDER_TIMEOUT_STALE_ATTEMPT',
    safe_provider_metadata = safe_provider_metadata || jsonb_build_object('expired_by_server', true),
    completed_at = now()
  where draft_id = draft_row.id
    and draft_version = draft_row.content_version
    and completed_at is null
    and started_at < now() - interval '2 minutes';

  select * into attempt_row
  from private.market_review_attempts
  where draft_id = draft_row.id
    and draft_version = draft_row.content_version
    and completed_at is null
  order by started_at desc
  limit 1;
  if attempt_row.id is not null then
    return jsonb_build_object(
      'status', 'already_in_progress',
      'attempt_id', attempt_row.id,
      'idempotency_replay', true,
      'completed', false,
      'draft_version', draft_row.content_version,
      'content_fingerprint', draft_row.content_fingerprint,
      'message', 'Ya existe una revisión en curso para esta versión.'
    );
  end if;

  current_effective_id := private.market_current_effective_review_id(draft_row);
  if current_effective_id is not null and not coalesce(force_review_input, false) then
    return jsonb_build_object(
      'status', 'approved_cached',
      'effective_review_id', current_effective_id,
      'draft_version', draft_row.content_version,
      'content_fingerprint', draft_row.content_fingerprint,
      'message', 'La versión actual ya tiene una aprobación efectiva compatible.'
    );
  end if;

  version_id_value := (
    select version.id
    from private.market_draft_versions version
    where version.draft_id = draft_row.id
      and version.content_version = draft_row.content_version
  );
  issues := private.market_draft_deterministic_issues(draft_row);

  if jsonb_array_length(issues) > 0 then
    insert into private.market_review_reports(
      draft_id, draft_version, content_fingerprint, validator_version,
      result, deterministic_issues, semantic_issues, editorial_notes,
      reviewed_by, policy_version, schema_version, canonical_fingerprint,
      review_classification, safe_provider_metadata
    ) values (
      draft_row.id,
      draft_row.content_version,
      draft_row.content_fingerprint,
      'step13.4-deterministic-v2',
      'rejected',
      issues,
      '[]'::jsonb,
      '[]'::jsonb,
      actor_id,
      'atinara-market-review-policy-v2',
      'atinara-market-draft-schema-v2',
      draft_row.content_fingerprint,
      'content',
      '{}'::jsonb
    ) returning id into report_id_value;

    insert into private.market_review_attempts(
      request_key, draft_id, draft_version, version_id, content_fingerprint,
      validator_version, policy_version, schema_version, status, classification,
      report_id, reviewed_by, completed_at
    ) values (
      request_key_input,
      draft_row.id,
      draft_row.content_version,
      version_id_value,
      draft_row.content_fingerprint,
      'step13.4-deterministic-v2',
      'atinara-market-review-policy-v2',
      'atinara-market-draft-schema-v2',
      'rejected',
      'content',
      report_id_value,
      actor_id,
      now()
    ) returning * into attempt_row;

    update private.market_effective_reviews set
      active = false,
      revoked_at = now(),
      revoked_by = actor_id,
      revocation_reason = 'deterministic_content_rejection'
    where id = current_effective_id and revoked_at is null;

    update private.market_drafts set
      workflow_status = 'review_rejected',
      review_status = 'rejected',
      effective_review_id = null,
      last_review_attempt_id = attempt_row.id,
      reviewed_version = null,
      reviewed_fingerprint = null,
      human_confirmed_at = null,
      human_confirmed_by = null,
      human_confirmed_fingerprint = null,
      human_confirmed_review_id = null,
      updated_at = now(),
      updated_by = actor_id
    where id = draft_row.id;

    insert into private.market_admin_audit(actor_id, action_code, draft_id, draft_version, detail)
    values (
      actor_id,
      'REVIEW_REJECTED_DETERMINISTIC',
      draft_row.id,
      draft_row.content_version,
      jsonb_build_object(
        'blocking_reasons', issues,
        'attempt_id', attempt_row.id,
        'report_id', report_id_value
      )
    );

    return jsonb_build_object(
      'status', 'rejected',
      'classification', 'content',
      'attempt_id', attempt_row.id,
      'report_id', report_id_value,
      'blocking_reasons', issues
    );
  end if;

  insert into private.market_review_attempts(
    request_key, draft_id, draft_version, version_id, content_fingerprint,
    validator_version, policy_version, schema_version, status, classification,
    reviewed_by
  ) values (
    request_key_input,
    draft_row.id,
    draft_row.content_version,
    version_id_value,
    draft_row.content_fingerprint,
    left(trim(validator_version_input), 100),
    left(trim(policy_version_input), 100),
    left(trim(schema_version_input), 100),
    'in_progress',
    'pending',
    actor_id
  ) returning * into attempt_row;

  update private.market_drafts set
    workflow_status = case
      when current_effective_id is not null and human_confirmed_at is not null then 'human_confirmed'
      when current_effective_id is not null then 'review_approved'
      else 'review_in_progress'
    end,
    review_status = case when current_effective_id is not null then 'approved' else 'in_progress' end,
    last_review_attempt_id = attempt_row.id,
    updated_at = now(),
    updated_by = actor_id
  where id = draft_row.id
  returning * into draft_row;

  insert into private.market_admin_audit(actor_id, action_code, draft_id, draft_version, detail)
  values (
    actor_id,
    'REVIEW_ATTEMPT_STARTED',
    draft_row.id,
    draft_row.content_version,
    jsonb_build_object(
      'attempt_id', attempt_row.id,
      'validator_version', attempt_row.validator_version,
      'policy_version', attempt_row.policy_version,
      'schema_version', attempt_row.schema_version,
      'effective_review_preserved', current_effective_id
    )
  );

  return jsonb_build_object(
    'status', 'in_progress',
    'attempt_id', attempt_row.id,
    'draft', to_jsonb(draft_row) - 'created_by' - 'updated_by' - 'human_confirmed_by' - 'published_by',
    'effective_review_id', current_effective_id,
    'effective_review_preserved', current_effective_id is not null
  );
end;
$function$;

revoke all on function public.begin_market_draft_review_v2(uuid,bigint,uuid,text,text,text,boolean) from public, anon;
grant execute on function public.begin_market_draft_review_v2(uuid,bigint,uuid,text,text,text,boolean) to authenticated;

create or replace function public.record_market_draft_review_v2(
  attempt_id_input uuid,
  result_input text,
  semantic_issues_input jsonb,
  editorial_notes_input jsonb,
  reviewed_by_input uuid,
  technical_code_input text default null,
  safe_provider_metadata_input jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  attempt_row private.market_review_attempts%rowtype;
  draft_row private.market_drafts%rowtype;
  normalized_result text := lower(trim(coalesce(result_input, '')));
  classification_value text;
  report_result text;
  report_id_value bigint;
  current_effective_id bigint;
  effective_review_id_value bigint;
  confirmation_preserved boolean := false;
  action_code_value text;
begin
  if auth.role() <> 'service_role' then
    raise exception 'SERVICE_ROLE_REQUIRED' using errcode = '42501';
  end if;
  if reviewed_by_input is null or not exists (
    select 1
    from auth.users user_row
    where user_row.id = reviewed_by_input
      and coalesce((user_row.raw_app_meta_data ->> 'oraklo_admin')::boolean, false)
  ) then
    raise exception 'ADMIN_REQUIRED' using errcode = '42501';
  end if;
  if normalized_result not in (
    'approved', 'rejected', 'inconclusive', 'invalid_response',
    'provider_rate_limited', 'provider_timeout', 'provider_unavailable',
    'provider_auth_error', 'internal_error'
  ) then
    raise exception 'INVALID_REVIEW_RESULT' using errcode = '22023';
  end if;
  if jsonb_typeof(coalesce(semantic_issues_input, '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(editorial_notes_input, '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(safe_provider_metadata_input, '{}'::jsonb)) <> 'object'
     or octet_length(coalesce(safe_provider_metadata_input, '{}'::jsonb)::text) > 8192 then
    raise exception 'INVALID_REVIEW_REPORT' using errcode = '22023';
  end if;

  classification_value := case when normalized_result in ('approved', 'rejected', 'inconclusive')
    then 'content' else 'technical' end;
  if normalized_result = 'approved'
     and jsonb_array_length(coalesce(semantic_issues_input, '[]'::jsonb)) > 0 then
    raise exception 'APPROVED_REVIEW_HAS_BLOCKERS' using errcode = '22023';
  end if;

  select * into attempt_row
  from private.market_review_attempts
  where id = attempt_id_input
  for update;
  if not found then raise exception 'REVIEW_ATTEMPT_NOT_FOUND' using errcode = 'P0001'; end if;
  if attempt_row.completed_at is not null then
    return jsonb_build_object(
      'status', attempt_row.status,
      'attempt_id', attempt_row.id,
      'report_id', attempt_row.report_id,
      'idempotency_replay', true
    );
  end if;

  select * into draft_row
  from private.market_drafts
  where id = attempt_row.draft_id
  for update;
  if not found then raise exception 'DRAFT_NOT_FOUND' using errcode = 'P0001'; end if;
  if draft_row.content_version <> attempt_row.draft_version
     or draft_row.content_fingerprint is distinct from attempt_row.content_fingerprint
     or draft_row.content_fingerprint is distinct from private.market_draft_fingerprint(draft_row) then
    update private.market_review_attempts set
      status = 'stale',
      classification = 'technical',
      technical_code = 'REVIEW_VERSION_MOVED',
      safe_provider_metadata = coalesce(safe_provider_metadata_input, '{}'::jsonb),
      completed_at = now()
    where id = attempt_row.id;
    insert into private.market_admin_audit(actor_id, action_code, draft_id, draft_version, detail)
    values (
      reviewed_by_input,
      'REVIEW_ATTEMPT_STALE_IGNORED',
      draft_row.id,
      draft_row.content_version,
      jsonb_build_object(
        'attempt_id', attempt_row.id,
        'attempted_version', attempt_row.draft_version,
        'current_version', draft_row.content_version
      )
    );
    return jsonb_build_object(
      'status', 'stale',
      'attempt_id', attempt_row.id,
      'effective_review_id', private.market_current_effective_review_id(draft_row),
      'message', 'La respuesta correspondía a una versión anterior y no modificó el estado actual.'
    );
  end if;

  if classification_value = 'content' and not exists (
    select 1
    from private.market_review_policy_compatibility compatibility
    where compatibility.validator_version = attempt_row.validator_version
      and compatibility.policy_version = attempt_row.policy_version
      and compatibility.schema_version = attempt_row.schema_version
      and compatibility.reusable
      and compatibility.invalidated_at is null
  ) then
    raise exception 'REVIEW_POLICY_NOT_COMPATIBLE' using errcode = '22023';
  end if;

  report_result := case normalized_result
    when 'provider_rate_limited' then 'quota_exhausted'
    when 'provider_timeout' then 'service_unavailable'
    when 'provider_unavailable' then 'service_unavailable'
    when 'provider_auth_error' then 'service_unavailable'
    when 'internal_error' then 'service_unavailable'
    else normalized_result
  end;

  insert into private.market_review_reports(
    draft_id, draft_version, content_fingerprint, validator_version,
    result, semantic_issues, editorial_notes, reviewed_by,
    policy_version, schema_version, canonical_fingerprint,
    review_classification, technical_code, safe_provider_metadata
  ) values (
    draft_row.id,
    draft_row.content_version,
    draft_row.content_fingerprint,
    attempt_row.validator_version,
    report_result,
    coalesce(semantic_issues_input, '[]'::jsonb),
    coalesce(editorial_notes_input, '[]'::jsonb),
    reviewed_by_input,
    attempt_row.policy_version,
    attempt_row.schema_version,
    draft_row.content_fingerprint,
    classification_value,
    nullif(left(trim(coalesce(technical_code_input, '')), 100), ''),
    coalesce(safe_provider_metadata_input, '{}'::jsonb)
  ) returning id into report_id_value;

  update private.market_review_attempts set
    status = normalized_result,
    classification = classification_value,
    technical_code = nullif(left(trim(coalesce(technical_code_input, '')), 100), ''),
    safe_provider_metadata = coalesce(safe_provider_metadata_input, '{}'::jsonb),
    report_id = report_id_value,
    reviewed_by = reviewed_by_input,
    completed_at = now()
  where id = attempt_row.id
  returning * into attempt_row;

  current_effective_id := private.market_current_effective_review_id(draft_row);
  confirmation_preserved := current_effective_id is not null
    and draft_row.human_confirmed_at is not null
    and draft_row.human_confirmed_fingerprint = draft_row.content_fingerprint
    and draft_row.human_confirmed_review_id = current_effective_id;

  if classification_value = 'technical' then
    update private.market_drafts set
      workflow_status = case
        when confirmation_preserved then 'human_confirmed'
        when current_effective_id is not null then 'review_approved'
        else 'draft_ready'
      end,
      review_status = case when current_effective_id is not null then 'approved' else 'not_requested' end,
      effective_review_id = current_effective_id,
      reviewed_version = case when current_effective_id is not null then content_version else null end,
      reviewed_fingerprint = case when current_effective_id is not null then content_fingerprint else null end,
      last_review_attempt_id = attempt_row.id,
      updated_at = now(),
      updated_by = coalesce(reviewed_by_input, updated_by)
    where id = draft_row.id
    returning * into draft_row;
    action_code_value := 'REVIEW_TECHNICAL_FAILURE_EFFECTIVE_PRESERVED';
  elsif normalized_result = 'approved' then
    update private.market_effective_reviews set
      active = false,
      superseded_at = coalesce(superseded_at, now())
    where id = current_effective_id and active;

    insert into private.market_effective_reviews(
      draft_id, draft_version, version_id, attempt_id, report_id,
      content_fingerprint, validator_version, policy_version, schema_version,
      compatibility_basis, active
    ) values (
      draft_row.id,
      draft_row.content_version,
      attempt_row.version_id,
      attempt_row.id,
      report_id_value,
      draft_row.content_fingerprint,
      attempt_row.validator_version,
      attempt_row.policy_version,
      attempt_row.schema_version,
      'exact_validator_policy_schema_and_canonical_fingerprint',
      true
    ) returning id into effective_review_id_value;

    update private.market_drafts set
      workflow_status = case when confirmation_preserved then 'human_confirmed' else 'review_approved' end,
      review_status = 'approved',
      effective_review_id = effective_review_id_value,
      reviewed_version = content_version,
      reviewed_fingerprint = content_fingerprint,
      last_review_attempt_id = attempt_row.id,
      human_confirmed_at = case when confirmation_preserved then human_confirmed_at else null end,
      human_confirmed_by = case when confirmation_preserved then human_confirmed_by else null end,
      human_confirmed_fingerprint = case when confirmation_preserved then content_fingerprint else null end,
      human_confirmed_review_id = case when confirmation_preserved then effective_review_id_value else null end,
      updated_at = now(),
      updated_by = coalesce(reviewed_by_input, updated_by)
    where id = draft_row.id
    returning * into draft_row;
    action_code_value := 'REVIEW_APPROVED_EFFECTIVE';
  elsif normalized_result = 'rejected' then
    update private.market_effective_reviews set
      active = false,
      revoked_at = now(),
      revoked_by = reviewed_by_input,
      revocation_reason = 'content_rejected_by_compatible_validator'
    where id = current_effective_id and revoked_at is null;

    update private.market_drafts set
      workflow_status = 'review_rejected',
      review_status = 'rejected',
      effective_review_id = null,
      reviewed_version = null,
      reviewed_fingerprint = null,
      last_review_attempt_id = attempt_row.id,
      human_confirmed_at = null,
      human_confirmed_by = null,
      human_confirmed_fingerprint = null,
      human_confirmed_review_id = null,
      updated_at = now(),
      updated_by = coalesce(reviewed_by_input, updated_by)
    where id = draft_row.id
    returning * into draft_row;
    action_code_value := 'REVIEW_REJECTED_CONTENT';
  else
    update private.market_drafts set
      workflow_status = case when current_effective_id is not null then
        case when human_confirmed_at is not null then 'human_confirmed' else 'review_approved' end
        else 'review_inconclusive' end,
      review_status = case when current_effective_id is not null then 'approved' else 'inconclusive' end,
      effective_review_id = current_effective_id,
      reviewed_version = case when current_effective_id is not null then content_version else null end,
      reviewed_fingerprint = case when current_effective_id is not null then content_fingerprint else null end,
      last_review_attempt_id = attempt_row.id,
      updated_at = now(),
      updated_by = coalesce(reviewed_by_input, updated_by)
    where id = draft_row.id
    returning * into draft_row;
    action_code_value := 'REVIEW_INCONCLUSIVE_EFFECTIVE_PRESERVED';
  end if;

  insert into private.market_admin_audit(actor_id, action_code, draft_id, draft_version, detail)
  values (
    reviewed_by_input,
    action_code_value,
    draft_row.id,
    draft_row.content_version,
    jsonb_build_object(
      'attempt_id', attempt_row.id,
      'attempted_status', normalized_result,
      'classification', classification_value,
      'technical_code', attempt_row.technical_code,
      'report_id', report_id_value,
      'effective_review_id', coalesce(effective_review_id_value, current_effective_id),
      'effective_review_preserved', classification_value = 'technical' and current_effective_id is not null,
      'safe_provider_metadata', attempt_row.safe_provider_metadata
    )
  );

  return jsonb_build_object(
    'status', normalized_result,
    'attempted_status', normalized_result,
    'classification', classification_value,
    'workflow_status', draft_row.workflow_status,
    'review_status', draft_row.review_status,
    'draft_version', draft_row.content_version,
    'attempt_id', attempt_row.id,
    'report_id', report_id_value,
    'effective_review_id', coalesce(effective_review_id_value, current_effective_id),
    'effective_review_preserved', classification_value = 'technical' and current_effective_id is not null,
    'human_confirmation_preserved', confirmation_preserved,
    'message', case
      when classification_value = 'technical' and current_effective_id is not null
        then 'La incidencia técnica quedó registrada y la aprobación efectiva continúa vigente.'
      when classification_value = 'technical'
        then 'La incidencia técnica quedó registrada. El borrador sigue listo para reintentar la revisión.'
      when normalized_result = 'approved'
        then 'La revisión automática está aprobada. Falta la confirmación humana.'
      else 'La revisión de contenido terminó y el mercado continúa privado.'
    end
  );
end;
$function$;

revoke all on function public.record_market_draft_review_v2(uuid,text,jsonb,jsonb,uuid,text,jsonb)
  from public, anon, authenticated;
grant execute on function public.record_market_draft_review_v2(uuid,text,jsonb,jsonb,uuid,text,jsonb)
  to service_role;

create or replace function public.begin_market_draft_review(
  draft_id_input uuid,
  expected_version_input bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
begin
  return public.begin_market_draft_review_v2(
    draft_id_input,
    expected_version_input,
    gen_random_uuid(),
    'atinara-market-gate-legacy-bridge-v1',
    'legacy-unversioned',
    'legacy-market-draft-v1',
    true
  );
end;
$function$;

revoke all on function public.begin_market_draft_review(uuid,bigint) from public, anon;
grant execute on function public.begin_market_draft_review(uuid,bigint) to authenticated;

create or replace function public.record_market_draft_review(
  draft_id_input uuid,
  draft_version_input bigint,
  content_fingerprint_input text,
  validator_version_input text,
  result_input text,
  semantic_issues_input jsonb,
  editorial_notes_input jsonb,
  reviewed_by_input uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  attempt_id_value uuid;
  normalized_result text := lower(trim(coalesce(result_input, '')));
  mapped_result text;
  technical_code_value text;
begin
  if auth.role() <> 'service_role' then
    raise exception 'SERVICE_ROLE_REQUIRED' using errcode = '42501';
  end if;
  select attempt.id into attempt_id_value
  from private.market_review_attempts attempt
  where attempt.draft_id = draft_id_input
    and attempt.draft_version = draft_version_input
    and attempt.content_fingerprint = content_fingerprint_input
    and attempt.completed_at is null
  order by attempt.started_at desc
  limit 1;
  if attempt_id_value is null then
    raise exception 'REVIEW_ATTEMPT_REQUIRED' using errcode = '22023';
  end if;

  mapped_result := case normalized_result
    when 'quota_exhausted' then 'provider_rate_limited'
    when 'service_unavailable' then 'provider_unavailable'
    else normalized_result
  end;
  technical_code_value := case normalized_result
    when 'quota_exhausted' then 'PROVIDER_RATE_LIMITED'
    when 'service_unavailable' then 'PROVIDER_UNAVAILABLE'
    when 'invalid_response' then 'AUTOMATIC_RESPONSE_INVALID'
    else null
  end;
  return public.record_market_draft_review_v2(
    attempt_id_value,
    mapped_result,
    semantic_issues_input,
    editorial_notes_input,
    reviewed_by_input,
    technical_code_value,
    jsonb_build_object('legacy_rpc_bridge', true, 'reported_validator', left(validator_version_input, 100))
  );
end;
$function$;

revoke all on function public.record_market_draft_review(uuid,bigint,text,text,text,jsonb,jsonb,uuid)
  from public, anon, authenticated;
grant execute on function public.record_market_draft_review(uuid,bigint,text,text,text,jsonb,jsonb,uuid)
  to service_role;

create or replace function public.confirm_market_draft_review(
  draft_id_input uuid,
  expected_version_input bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor_id uuid := private.require_current_admin();
  draft_row private.market_drafts%rowtype;
  effective_review_id_value bigint;
  binding_state jsonb;
begin
  select * into draft_row
  from private.market_drafts
  where id = draft_id_input
  for update;
  if not found then raise exception 'DRAFT_NOT_FOUND' using errcode = 'P0001'; end if;
  if expected_version_input is null or draft_row.content_version <> expected_version_input then
    raise exception 'DRAFT_VERSION_MOVED' using errcode = '40001';
  end if;
  effective_review_id_value := private.market_current_effective_review_id(draft_row);
  if effective_review_id_value is null
     or draft_row.review_status <> 'approved'
     or draft_row.reviewed_version <> draft_row.content_version
     or draft_row.reviewed_fingerprint is distinct from draft_row.content_fingerprint then
    raise exception 'CURRENT_APPROVAL_REQUIRED' using errcode = '22023';
  end if;
  binding_state := private.market_binding_compatibility(draft_row.id);
  if not coalesce((binding_state ->> 'compatible')::boolean, false) then
    raise exception 'CURRENT_BINDING_COMPATIBILITY_REQUIRED' using errcode = '22023';
  end if;

  if draft_row.human_confirmed_at is not null
     and draft_row.human_confirmed_fingerprint = draft_row.content_fingerprint
     and draft_row.human_confirmed_review_id = effective_review_id_value then
    return jsonb_build_object(
      'status', 'human_confirmed',
      'confirmed_at', draft_row.human_confirmed_at,
      'effective_review_id', effective_review_id_value,
      'content_fingerprint', draft_row.content_fingerprint,
      'changed', false,
      'idempotency_replay', true
    );
  end if;

  update private.market_drafts set
    workflow_status = 'human_confirmed',
    human_confirmed_at = now(),
    human_confirmed_by = actor_id,
    human_confirmed_fingerprint = content_fingerprint,
    human_confirmed_review_id = effective_review_id_value,
    updated_at = now(),
    updated_by = actor_id
  where id = draft_row.id
  returning * into draft_row;

  insert into private.market_admin_audit(actor_id, action_code, draft_id, draft_version, detail)
  values (
    actor_id,
    'HUMAN_CONFIRMATION_RECORDED',
    draft_row.id,
    draft_row.content_version,
    jsonb_build_object(
      'effective_review_id', effective_review_id_value,
      'content_fingerprint', draft_row.content_fingerprint,
      'binding_id', binding_state ->> 'binding_id',
      'binding_plan_version', binding_state ->> 'plan_version'
    )
  );

  return jsonb_build_object(
    'status', draft_row.workflow_status,
    'confirmed_at', draft_row.human_confirmed_at,
    'effective_review_id', effective_review_id_value,
    'content_fingerprint', draft_row.content_fingerprint,
    'changed', true,
    'idempotency_replay', false
  );
end;
$function$;

revoke all on function public.confirm_market_draft_review(uuid,bigint) from public, anon;
grant execute on function public.confirm_market_draft_review(uuid,bigint) to authenticated;

create or replace function private.materialize_market_draft(
  draft_id_input uuid,
  actor_id_input uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  draft_row private.market_drafts%rowtype;
  effective_review_id_value bigint;
  binding_state jsonb;
begin
  if actor_id_input is null or not exists (
    select 1 from auth.users user_row
    where user_row.id = actor_id_input
      and coalesce((user_row.raw_app_meta_data ->> 'oraklo_admin')::boolean, false)
  ) then
    raise exception 'ADMIN_REQUIRED' using errcode = '42501';
  end if;

  select * into draft_row
  from private.market_drafts
  where id = draft_id_input
  for update;
  if not found then raise exception 'DRAFT_NOT_FOUND' using errcode = 'P0001'; end if;
  effective_review_id_value := private.market_current_effective_review_id(draft_row);
  if effective_review_id_value is null
     or draft_row.review_status <> 'approved'
     or draft_row.reviewed_version <> draft_row.content_version
     or draft_row.reviewed_fingerprint is distinct from draft_row.content_fingerprint
     or draft_row.human_confirmed_at is null
     or draft_row.human_confirmed_fingerprint is distinct from draft_row.content_fingerprint
     or draft_row.human_confirmed_review_id is distinct from effective_review_id_value then
    raise exception 'CURRENT_APPROVAL_AND_CONFIRMATION_REQUIRED' using errcode = '22023';
  end if;
  binding_state := private.market_binding_compatibility(draft_row.id);
  if not coalesce((binding_state ->> 'compatible')::boolean, false) then
    raise exception 'CURRENT_BINDING_COMPATIBILITY_REQUIRED' using errcode = '22023';
  end if;
  if draft_row.evaluation_ends_at is null or draft_row.evaluation_ends_at <= now() then
    raise exception 'MARKET_PERIOD_ALREADY_ENDED' using errcode = '22023';
  end if;
  if draft_row.market_id is not null then
    raise exception 'MARKET_ALREADY_PUBLISHED' using errcode = '22023';
  end if;

  insert into public.markets(
    id, question, category, status, yes_percent, no_percent, difficulty,
    close_label, closes_at, description, resolution_source, yes_criteria,
    no_criteria, edge_case, highlighted, popularity,
    evaluation_ends_at, evaluation_timezone, resolution_deadline,
    market_definition_version
  ) values (
    draft_row.market_slug,
    draft_row.question,
    draft_row.category,
    'Abierto',
    50,
    50,
    'Normal',
    'Cierra ' || to_char(
      draft_row.evaluation_ends_at at time zone draft_row.timezone,
      'DD Mon YYYY · HH24:MI:SS'
    ),
    draft_row.evaluation_ends_at,
    coalesce(draft_row.description, draft_row.public_criteria),
    coalesce(draft_row.primary_source ->> 'url', ''),
    draft_row.yes_criteria,
    draft_row.no_criteria,
    draft_row.edge_cases,
    false,
    0,
    draft_row.evaluation_ends_at,
    draft_row.timezone,
    draft_row.resolution_deadline,
    draft_row.content_version
  );

  update private.market_drafts set
    market_id = market_slug,
    workflow_status = 'published',
    published_at = now(),
    published_by = actor_id_input,
    scheduled_for = null,
    updated_at = now(),
    updated_by = actor_id_input
  where id = draft_row.id
  returning * into draft_row;

  insert into private.market_admin_audit(actor_id, action_code, draft_id, market_id, draft_version, detail)
  values (
    actor_id_input,
    'MARKET_PUBLISHED',
    draft_row.id,
    draft_row.market_id,
    draft_row.content_version,
    jsonb_build_object(
      'effective_review_id', effective_review_id_value,
      'content_fingerprint', draft_row.content_fingerprint,
      'binding_id', binding_state ->> 'binding_id'
    )
  );

  return jsonb_build_object(
    'status', 'published',
    'market_id', draft_row.market_id,
    'published_at', draft_row.published_at
  );
end;
$function$;

revoke all on function private.materialize_market_draft(uuid,uuid) from public, anon, authenticated;

create or replace function public.publish_market_draft(
  draft_id_input uuid,
  expected_version_input bigint,
  scheduled_for_input timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor_id uuid := private.require_current_admin();
  draft_row private.market_drafts%rowtype;
  effective_review_id_value bigint;
  binding_state jsonb;
begin
  select * into draft_row
  from private.market_drafts
  where id = draft_id_input
  for update;
  if not found then raise exception 'DRAFT_NOT_FOUND' using errcode = 'P0001'; end if;
  if expected_version_input is null or draft_row.content_version <> expected_version_input then
    raise exception 'DRAFT_VERSION_MOVED' using errcode = '40001';
  end if;
  effective_review_id_value := private.market_current_effective_review_id(draft_row);
  if effective_review_id_value is null
     or draft_row.review_status <> 'approved'
     or draft_row.reviewed_version <> draft_row.content_version
     or draft_row.reviewed_fingerprint is distinct from draft_row.content_fingerprint
     or draft_row.human_confirmed_at is null
     or draft_row.human_confirmed_fingerprint is distinct from draft_row.content_fingerprint
     or draft_row.human_confirmed_review_id is distinct from effective_review_id_value then
    raise exception 'CURRENT_APPROVAL_AND_CONFIRMATION_REQUIRED' using errcode = '22023';
  end if;
  binding_state := private.market_binding_compatibility(draft_row.id);
  if not coalesce((binding_state ->> 'compatible')::boolean, false) then
    raise exception 'CURRENT_BINDING_COMPATIBILITY_REQUIRED' using errcode = '22023';
  end if;

  if scheduled_for_input is not null and scheduled_for_input > now() then
    if scheduled_for_input >= draft_row.evaluation_ends_at then
      raise exception 'SCHEDULE_AFTER_MARKET_CLOSE' using errcode = '22023';
    end if;
    update private.market_drafts set
      workflow_status = 'scheduled',
      scheduled_for = scheduled_for_input,
      updated_at = now(),
      updated_by = actor_id
    where id = draft_row.id
    returning * into draft_row;
    insert into private.market_admin_audit(actor_id, action_code, draft_id, draft_version, detail)
    values (
      actor_id,
      'MARKET_SCHEDULED',
      draft_row.id,
      draft_row.content_version,
      jsonb_build_object(
        'scheduled_for', scheduled_for_input,
        'effective_review_id', effective_review_id_value,
        'content_fingerprint', draft_row.content_fingerprint
      )
    );
    return jsonb_build_object('status', 'scheduled', 'scheduled_for', scheduled_for_input);
  end if;

  return private.materialize_market_draft(draft_id_input, actor_id);
end;
$function$;

revoke all on function public.publish_market_draft(uuid,bigint,timestamptz) from public, anon;
grant execute on function public.publish_market_draft(uuid,bigint,timestamptz) to authenticated;

create or replace function public.restore_market_draft_version(
  draft_id_input uuid,
  expected_version_input bigint,
  version_id_input bigint,
  idempotency_key_input uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor_id uuid := private.require_current_admin();
  version_row private.market_draft_versions%rowtype;
  current_row private.market_drafts%rowtype;
  result jsonb;
begin
  select * into current_row from private.market_drafts where id = draft_id_input for update;
  if not found then raise exception 'DRAFT_NOT_FOUND' using errcode = 'P0001'; end if;
  if current_row.content_version <> expected_version_input then
    raise exception 'DRAFT_VERSION_MOVED' using errcode = '40001';
  end if;
  select * into version_row
  from private.market_draft_versions
  where id = version_id_input and draft_id = draft_id_input;
  if not found then raise exception 'DRAFT_VERSION_NOT_FOUND' using errcode = 'P0001'; end if;

  result := public.save_market_draft(
    draft_id_input,
    expected_version_input,
    version_row.source_payload || jsonb_build_object(
      '_idempotency_key', coalesce(idempotency_key_input, gen_random_uuid()),
      '_change_origin', 'version_restore',
      '_timestamp_precision', 'milliseconds-v1',
      '_restored_from_version_id', version_row.id
    )
  );

  insert into private.market_admin_audit(actor_id, action_code, draft_id, draft_version, detail)
  values (
    actor_id,
    'DRAFT_VERSION_RESTORED_AS_NEW_VERSION',
    draft_id_input,
    (result -> 'draft' ->> 'content_version')::bigint,
    jsonb_build_object(
      'restored_from_version_id', version_row.id,
      'restored_from_content_version', version_row.content_version,
      'changed', coalesce((result ->> 'changed')::boolean, false),
      'review_reused', coalesce((result ->> 'review_reused_from_memory')::boolean, false)
    )
  );
  return result || jsonb_build_object(
    'restored_from_version_id', version_row.id,
    'restored_from_content_version', version_row.content_version
  );
end;
$function$;

revoke all on function public.restore_market_draft_version(uuid,bigint,bigint,uuid) from public, anon;
grant execute on function public.restore_market_draft_version(uuid,bigint,bigint,uuid) to authenticated;

create or replace function public.restore_market_draft_review_memory(
  draft_id_input uuid,
  expected_version_input bigint,
  allow_precision_recovery_input boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor_id uuid := private.require_current_admin();
  draft_row private.market_drafts%rowtype;
  candidate_row private.market_drafts%rowtype;
  binding_row private.market_source_bindings%rowtype;
  report_row private.market_review_reports%rowtype;
  reconstructed_version_id bigint;
  current_version_id bigint;
  effective_review_id_value bigint;
  candidate_fingerprint text;
  candidate_legacy_fingerprint text;
  binding_evaluation timestamptz;
  current_payload jsonb;
  candidate_payload jsonb;
  difference_keys jsonb;
  binding_state jsonb;
begin
  select * into draft_row
  from private.market_drafts
  where id = draft_id_input
  for update;
  if not found then raise exception 'DRAFT_NOT_FOUND' using errcode = 'P0001'; end if;
  if draft_row.content_version <> expected_version_input then
    raise exception 'DRAFT_VERSION_MOVED' using errcode = '40001';
  end if;
  if private.market_current_effective_review_id(draft_row) is not null then
    return jsonb_build_object(
      'restored', true,
      'changed', false,
      'review_status', 'approved',
      'workflow_status', draft_row.workflow_status,
      'draft_version', draft_row.content_version,
      'content_fingerprint', draft_row.content_fingerprint,
      'effective_review_id', draft_row.effective_review_id,
      'message', 'La versión ya tiene una aprobación efectiva compatible.'
    );
  end if;
  if not coalesce(allow_precision_recovery_input, false) then
    return jsonb_build_object('restored', false, 'reason', 'NO_CURRENT_EFFECTIVE_REVIEW');
  end if;

  select * into binding_row
  from private.market_source_bindings
  where draft_id = draft_row.id and status <> 'superseded'
  order by plan_version desc, created_at desc
  limit 1;
  if binding_row.id is null then
    return jsonb_build_object('restored', false, 'reason', 'RECOVERY_BINDING_REQUIRED');
  end if;

  begin
    binding_evaluation := nullif(coalesce(
      binding_row.resolution_contract ->> 'evaluation_at',
      binding_row.resolution_contract ->> 'window_end'
    ), '')::timestamptz;
  exception when invalid_datetime_format then
    return jsonb_build_object('restored', false, 'reason', 'RECOVERY_BINDING_DATE_INVALID');
  end;
  if binding_evaluation is null
     or date_trunc('minute', binding_evaluation) <> date_trunc('minute', draft_row.evaluation_ends_at)
     or binding_evaluation = draft_row.evaluation_ends_at then
    return jsonb_build_object('restored', false, 'reason', 'NO_PROVABLE_PRECISION_DIFFERENCE');
  end if;

  candidate_row := draft_row;
  candidate_row.evaluation_ends_at := binding_evaluation;
  candidate_row.closes_at := binding_evaluation;
  if nullif(trim(binding_row.resolution_contract ->> 'timezone'), '') is not null then
    candidate_row.timezone := trim(binding_row.resolution_contract ->> 'timezone');
  end if;
  candidate_legacy_fingerprint := private.market_draft_legacy_fingerprint(candidate_row);
  candidate_fingerprint := private.market_draft_fingerprint(candidate_row);

  select * into report_row
  from private.market_review_reports report
  where report.draft_id = draft_row.id
    and report.result = 'approved'
    and report.content_fingerprint = candidate_legacy_fingerprint
  order by report.created_at desc, report.id desc
  limit 1;
  if report_row.id is null then
    return jsonb_build_object('restored', false, 'reason', 'NO_LEGACY_APPROVAL_FOR_BINDING_CONTENT');
  end if;

  current_payload := private.market_draft_canonical_payload(draft_row);
  candidate_payload := private.market_draft_canonical_payload(candidate_row);
  select coalesce(jsonb_agg(keys.key order by keys.key), '[]'::jsonb)
  into difference_keys
  from (
    select key from jsonb_each(current_payload)
    union
    select key from jsonb_each(candidate_payload)
  ) keys
  where current_payload -> keys.key is distinct from candidate_payload -> keys.key;

  if not difference_keys <@ jsonb_build_array('evaluation_ends_at', 'closes_at')
     or jsonb_array_length(difference_keys) = 0 then
    return jsonb_build_object(
      'restored', false,
      'reason', 'MATERIAL_DIFFERENCE_FROM_APPROVED_CONTENT',
      'difference_keys', difference_keys
    );
  end if;

  insert into private.market_draft_versions(
    draft_id, content_version, source_payload, canonical_payload,
    content_fingerprint, fingerprint_version, policy_version, schema_version,
    change_origin, actor_id, recovery_evidence
  ) values (
    draft_row.id,
    report_row.draft_version,
    private.market_draft_source_payload(candidate_row),
    candidate_payload,
    candidate_fingerprint,
    'sha256-canonical-v2',
    'atinara-market-review-policy-v2',
    'atinara-market-draft-schema-v2',
    'reconstructed_legacy_approved_version',
    actor_id,
    jsonb_build_object(
      'legacy_report_id', report_row.id,
      'legacy_validator_version', report_row.validator_version,
      'legacy_fingerprint', candidate_legacy_fingerprint,
      'binding_id', binding_row.id,
      'binding_plan_version', binding_row.plan_version,
      'difference_keys', difference_keys
    )
  )
  on conflict (draft_id, content_version) do nothing
  returning id into reconstructed_version_id;
  if reconstructed_version_id is null then
    select id into reconstructed_version_id
    from private.market_draft_versions
    where draft_id = draft_row.id and content_version = report_row.draft_version
      and content_fingerprint = candidate_fingerprint;
  end if;
  if reconstructed_version_id is null then
    raise exception 'RECOVERED_VERSION_CONFLICT' using errcode = '22023';
  end if;

  update private.market_effective_reviews set
    active = false,
    superseded_at = coalesce(superseded_at, now())
  where draft_id = draft_row.id and active;

  update private.market_drafts set
    evaluation_ends_at = candidate_row.evaluation_ends_at,
    closes_at = candidate_row.closes_at,
    timezone = candidate_row.timezone,
    content_version = content_version + 1,
    content_fingerprint = candidate_fingerprint,
    legacy_content_fingerprint = candidate_legacy_fingerprint,
    fingerprint_version = 'sha256-canonical-v2',
    workflow_status = 'review_approved',
    review_status = 'approved',
    reviewed_version = content_version + 1,
    reviewed_fingerprint = candidate_fingerprint,
    effective_review_id = null,
    human_confirmed_at = null,
    human_confirmed_by = null,
    human_confirmed_fingerprint = null,
    human_confirmed_review_id = null,
    updated_at = now(),
    updated_by = actor_id
  where id = draft_row.id
  returning * into draft_row;

  current_version_id := private.record_market_draft_version(
    draft_row,
    'restore_approved_precision_loss_as_new_version',
    actor_id,
    reconstructed_version_id,
    jsonb_build_object(
      'legacy_report_id', report_row.id,
      'legacy_fingerprint', candidate_legacy_fingerprint,
      'binding_id', binding_row.id,
      'difference_keys', difference_keys
    )
  );

  insert into private.market_effective_reviews(
    draft_id, draft_version, version_id, report_id, content_fingerprint,
    validator_version, policy_version, schema_version, compatibility_basis, active
  ) values (
    draft_row.id,
    draft_row.content_version,
    current_version_id,
    report_row.id,
    draft_row.content_fingerprint,
    report_row.validator_version,
    'atinara-market-review-policy-v2',
    'atinara-market-draft-schema-v2',
    'one_off_precision_recovery_verified_by_legacy_fingerprint_binding_and_field_diff',
    true
  ) returning id into effective_review_id_value;

  update private.market_drafts set
    effective_review_id = effective_review_id_value,
    reviewed_version = content_version,
    reviewed_fingerprint = content_fingerprint
  where id = draft_row.id
  returning * into draft_row;

  update private.market_review_reports set
    canonical_fingerprint = candidate_fingerprint,
    safe_provider_metadata = safe_provider_metadata || jsonb_build_object(
      'canonical_recovery_associated_at', now(),
      'canonical_recovery_basis', 'legacy_fingerprint_binding_and_precision_only_diff'
    )
  where id = report_row.id;

  binding_state := private.market_binding_compatibility(draft_row.id);
  if not coalesce((binding_state ->> 'compatible')::boolean, false) then
    raise exception 'RECOVERED_BINDING_NOT_COMPATIBLE' using errcode = '22023';
  end if;

  insert into private.market_admin_audit(actor_id, action_code, draft_id, draft_version, detail)
  values (
    actor_id,
    'REVIEW_MEMORY_RESTORED_AFTER_PROVEN_DATETIME_PRECISION_LOSS',
    draft_row.id,
    draft_row.content_version,
    jsonb_build_object(
      'legacy_report_id', report_row.id,
      'legacy_validator_version', report_row.validator_version,
      'legacy_fingerprint', candidate_legacy_fingerprint,
      'canonical_fingerprint', candidate_fingerprint,
      'reconstructed_version_id', reconstructed_version_id,
      'current_version_id', current_version_id,
      'effective_review_id', effective_review_id_value,
      'binding_id', binding_row.id,
      'binding_plan_version', binding_row.plan_version,
      'difference_keys', difference_keys,
      'human_confirmation_cleared', true,
      'gemini_called', false
    )
  );

  return jsonb_build_object(
    'restored', true,
    'changed', true,
    'review_status', 'approved',
    'workflow_status', 'review_approved',
    'draft_version', draft_row.content_version,
    'content_fingerprint', draft_row.content_fingerprint,
    'legacy_fingerprint', candidate_legacy_fingerprint,
    'effective_review_id', effective_review_id_value,
    'legacy_report_id', report_row.id,
    'reconstructed_version_id', reconstructed_version_id,
    'current_version_id', current_version_id,
    'recovered_precision', true,
    'binding_compatibility', binding_state,
    'gemini_called', false,
    'message', 'Atinara restauró de forma auditada el segundo perdido y asoció la aprobación compatible. Falta la confirmación humana.'
  );
end;
$function$;

revoke all on function public.restore_market_draft_review_memory(uuid,bigint,boolean) from public, anon;
grant execute on function public.restore_market_draft_review_memory(uuid,bigint,boolean) to authenticated;

create or replace function public.get_admin_market_draft(draft_id_input uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  draft_row private.market_drafts%rowtype;
  binding_row private.market_source_bindings%rowtype;
begin
  perform private.require_current_admin();
  select * into draft_row from private.market_drafts where id = draft_id_input;
  if not found then raise exception 'DRAFT_NOT_FOUND' using errcode = 'P0001'; end if;

  select * into binding_row
  from private.market_source_bindings
  where draft_id = draft_id_input and status <> 'superseded'
  order by plan_version desc, created_at desc
  limit 1;

  return jsonb_build_object(
    'draft', to_jsonb(draft_row) - 'created_by' - 'updated_by' - 'human_confirmed_by' - 'published_by',
    'deterministic_issues', private.market_draft_deterministic_issues(draft_row),
    'effective_review', (
      select jsonb_build_object(
        'id', effective.id,
        'status', 'approved',
        'draft_version', effective.draft_version,
        'content_fingerprint', effective.content_fingerprint,
        'validator_version', effective.validator_version,
        'policy_version', effective.policy_version,
        'schema_version', effective.schema_version,
        'compatibility_basis', effective.compatibility_basis,
        'created_at', effective.created_at,
        'report_id', effective.report_id,
        'semantic_issues', coalesce(report.semantic_issues, '[]'::jsonb),
        'editorial_notes', coalesce(report.editorial_notes, '[]'::jsonb)
      )
      from private.market_effective_reviews effective
      left join private.market_review_reports report on report.id = effective.report_id
      where effective.id = private.market_current_effective_review_id(draft_row)
    ),
    'latest_attempt', (
      select jsonb_build_object(
        'id', attempt.id,
        'status', attempt.status,
        'classification', attempt.classification,
        'technical_code', attempt.technical_code,
        'draft_version', attempt.draft_version,
        'content_fingerprint', attempt.content_fingerprint,
        'validator_version', attempt.validator_version,
        'policy_version', attempt.policy_version,
        'schema_version', attempt.schema_version,
        'safe_provider_metadata', attempt.safe_provider_metadata,
        'started_at', attempt.started_at,
        'completed_at', attempt.completed_at,
        'report_id', attempt.report_id,
        'semantic_issues', coalesce(report.semantic_issues, '[]'::jsonb),
        'editorial_notes', coalesce(report.editorial_notes, '[]'::jsonb)
      )
      from private.market_review_attempts attempt
      left join private.market_review_reports report on report.id = attempt.report_id
      where attempt.id = draft_row.last_review_attempt_id
    ),
    'latest_review', (
      select to_jsonb(report) - 'reviewed_by'
      from private.market_review_reports report
      left join private.market_review_attempts attempt on attempt.report_id = report.id
      where report.draft_id = draft_id_input
        and coalesce(attempt.classification, report.review_classification, 'content') = 'content'
      order by report.created_at desc, report.id desc
      limit 1
    ),
    'review_history', coalesce((
      select jsonb_agg(history.item order by history.started_at desc)
      from (
        select
          attempt.started_at,
          jsonb_build_object(
            'id', attempt.id,
            'status', attempt.status,
            'classification', attempt.classification,
            'technical_code', attempt.technical_code,
            'draft_version', attempt.draft_version,
            'content_fingerprint', attempt.content_fingerprint,
            'validator_version', attempt.validator_version,
            'policy_version', attempt.policy_version,
            'schema_version', attempt.schema_version,
            'safe_provider_metadata', attempt.safe_provider_metadata,
            'started_at', attempt.started_at,
            'completed_at', attempt.completed_at,
            'report_id', attempt.report_id
          ) as item
        from private.market_review_attempts attempt
        where attempt.draft_id = draft_id_input
        order by attempt.started_at desc
        limit 30
      ) history
    ), '[]'::jsonb),
    'version_history', coalesce((
      select jsonb_agg(history.item order by history.content_version desc)
      from (
        select
          version.content_version,
          jsonb_build_object(
            'id', version.id,
            'content_version', version.content_version,
            'content_fingerprint', version.content_fingerprint,
            'fingerprint_version', version.fingerprint_version,
            'policy_version', version.policy_version,
            'schema_version', version.schema_version,
            'change_origin', version.change_origin,
            'restored_from_version_id', version.restored_from_version_id,
            'recovery_evidence', version.recovery_evidence,
            'created_at', version.created_at
          ) as item
        from private.market_draft_versions version
        where version.draft_id = draft_id_input
        order by version.content_version desc
        limit 30
      ) history
    ), '[]'::jsonb),
    'binding', case when binding_row.id is null then null else to_jsonb(binding_row) - 'locked_by' end,
    'binding_sources', case when binding_row.id is null then '[]'::jsonb else coalesce((
      select jsonb_agg(jsonb_build_object(
        'url', source.source_url,
        'role', source.role,
        'precedence', source.precedence,
        'fallback_condition', source.fallback_condition,
        'required', source.required
      ) order by source.precedence, source.id)
      from private.market_source_binding_sources source
      where source.binding_id = binding_row.id
    ), '[]'::jsonb) end,
    'binding_compatibility', private.market_binding_compatibility(draft_id_input),
    'review_memory', jsonb_build_object(
      'authoritative', true,
      'fingerprint_version', draft_row.fingerprint_version,
      'effective_review_id', private.market_current_effective_review_id(draft_row),
      'last_attempt_id', draft_row.last_review_attempt_id,
      'material_version_count', (
        select count(*) from private.market_draft_versions version where version.draft_id = draft_id_input
      ),
      'state_memory_count', (
        select count(*) from private.market_draft_state_memory memory where memory.draft_id = draft_id_input
      )
    ),
    'audit', coalesce((
      select jsonb_agg(to_jsonb(audit_row) - 'actor_id' order by audit_row.created_at desc)
      from (
        select * from private.market_admin_audit
        where draft_id = draft_id_input
        order by created_at desc
        limit 50
      ) audit_row
    ), '[]'::jsonb)
  );
end;
$function$;

revoke all on function public.get_admin_market_draft(uuid) from public, anon;
grant execute on function public.get_admin_market_draft(uuid) to authenticated;

create or replace function public.get_market_draft_expert_repair_context(draft_id_input uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  payload jsonb;
  deterministic jsonb;
  content_issues jsonb;
begin
  perform private.require_current_admin();
  payload := public.get_admin_market_draft(draft_id_input);
  deterministic := coalesce(payload -> 'deterministic_issues', '[]'::jsonb);
  content_issues := deterministic || coalesce(payload -> 'latest_review' -> 'semantic_issues', '[]'::jsonb);
  return payload || jsonb_build_object(
    'repairable_content_issues', content_issues,
    'repair_applicable', jsonb_array_length(content_issues) > 0
      and coalesce(payload -> 'latest_attempt' ->> 'classification', 'content') <> 'technical',
    'technical_incident', case
      when payload -> 'latest_attempt' ->> 'classification' = 'technical'
      then payload -> 'latest_attempt'
      else null
    end
  );
end;
$function$;

revoke all on function public.get_market_draft_expert_repair_context(uuid) from public, anon;
grant execute on function public.get_market_draft_expert_repair_context(uuid) to authenticated;

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
  from private.market_drafts
  where id = draft_id_input
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
  if context_value -> 'latest_attempt' ->> 'classification' = 'technical' then
    raise exception 'TECHNICAL_REVIEW_FAILURE_NOT_REPAIRABLE' using errcode = '22023';
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
  select trim(coalesce(item ->> 'url', '')) into contract_primary_url
  from jsonb_array_elements(sources_input) item
  where item ->> 'role' = 'PRIMARY_RESOLUTION'
  order by coalesce((item ->> 'precedence')::integer, 1)
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
      '_change_origin', 'expert_repair',
      '_binding_managed_externally', true
    )
  );
  saved_draft_id := (save_result -> 'draft' ->> 'id')::uuid;
  saved_version := (save_result -> 'draft' ->> 'content_version')::bigint;

  binding_result := private.sync_market_draft_binding(
    saved_draft_id,
    actor_id,
    contract_input,
    sources_input,
    'expert_repair'
  );

  insert into private.market_admin_audit(actor_id, action_code, draft_id, draft_version, detail)
  values (
    actor_id,
    case when coalesce((save_result ->> 'changed')::boolean, false)
      then 'MARKET_DRAFT_EXPERT_REPAIR_APPLIED'
      else 'MARKET_DRAFT_EXPERT_REPAIR_NOOP'
    end,
    saved_draft_id,
    saved_version,
    jsonb_build_object(
      'changed_fields', coalesce(repair_meta_input -> 'changed_fields', '[]'::jsonb),
      'repair_policy', coalesce(repair_meta_input ->> 'repair_policy', 'atinara-draft-repair-v2'),
      'repair_mode', coalesce(repair_meta_input ->> 'repair_mode', 'expert_with_deterministic_guardrails'),
      'degraded', coalesce((repair_meta_input ->> 'degraded')::boolean, false),
      'content_changed', coalesce((save_result ->> 'changed')::boolean, false),
      'binding_sync', binding_result,
      'review_requested_after_repair', true
    )
  );

  return save_result || jsonb_build_object(
    'repair_applied', coalesce((save_result ->> 'changed')::boolean, false),
    'intelligence_binding', binding_result,
    'previous_version', expected_version_input,
    'new_version', saved_version,
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

create or replace function public.bind_market_draft_intelligence(
  draft_id_input uuid,
  origin_type_input text,
  origin_id_input text,
  expert_run_id_input uuid,
  contract_input jsonb,
  sources_input jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor_id uuid := private.require_current_admin();
  run_row private.market_expert_runs%rowtype;
  draft_row private.market_drafts%rowtype;
  active_binding private.market_source_bindings%rowtype;
  binding_row private.market_source_bindings%rowtype;
  item jsonb;
  sync_result jsonb;
  monitor_required_value boolean;
  primary_count integer;
  invalid_source_count integer;
  duplicate_precedence_count integer;
begin
  if jsonb_typeof(coalesce(contract_input, '{}'::jsonb)) <> 'object'
     or jsonb_typeof(coalesce(sources_input, '[]'::jsonb)) <> 'array' then
    raise exception 'RESOLUTION_PLAN_REQUIRED' using errcode = '22023';
  end if;
  select * into run_row
  from private.market_expert_runs
  where id = expert_run_id_input
    and origin_type = origin_type_input
    and origin_id = origin_id_input
    and status = 'completed';
  if not found then raise exception 'MARKET_EXPERT_ANALYSIS_REQUIRED' using errcode = '22023'; end if;
  select * into draft_row from private.market_drafts where id = draft_id_input for update;
  if not found then raise exception 'DRAFT_NOT_FOUND' using errcode = 'P0001'; end if;

  select
    count(*) filter (where item ->> 'role' = 'PRIMARY_RESOLUTION'),
    count(*) filter (where
      coalesce(item ->> 'url', '') !~ '^https://'
      or coalesce(item ->> 'role', '') not in (
        'DISCOVERY_SIGNAL', 'PROBABILITY_SIGNAL', 'CONTEXT_SOURCE',
        'PRIMARY_RESOLUTION', 'FALLBACK_RESOLUTION', 'CORROBORATION',
        'PROHIBITED_FOR_RESOLUTION'
      )
      or coalesce(item ->> 'precedence', '') !~ '^[1-9][0-9]*$'
    ),
    count(*) - count(distinct item ->> 'precedence')
  into primary_count, invalid_source_count, duplicate_precedence_count
  from jsonb_array_elements(sources_input) source_rows(item);
  if primary_count <> 1 then
    raise exception 'RESOLUTION_PRIMARY_SOURCE_REQUIRED' using errcode = '22023';
  end if;
  if invalid_source_count > 0 or duplicate_precedence_count > 0 then
    raise exception 'RESOLUTION_SOURCE_ASSIGNMENT_INVALID' using errcode = '22023';
  end if;
  if private.market_normalize_text(contract_input ->> 'canonical_statement')
     is distinct from private.market_normalize_text(draft_row.question) then
    raise exception 'RESOLUTION_PLAN_DRAFT_MISMATCH' using errcode = '22023';
  end if;

  select * into active_binding
  from private.market_source_bindings
  where draft_id = draft_id_input and status <> 'superseded'
  order by plan_version desc, created_at desc
  limit 1;
  if active_binding.id is not null then
    if active_binding.origin_type is distinct from origin_type_input
       or active_binding.origin_id is distinct from origin_id_input
       or active_binding.expert_run_id is distinct from expert_run_id_input then
      raise exception 'MARKET_INTELLIGENCE_ORIGIN_MISMATCH' using errcode = '22023';
    end if;
    sync_result := private.sync_market_draft_binding(
      draft_id_input,
      actor_id,
      contract_input,
      sources_input,
      'intelligence_binding_retry_or_update'
    );
    update private.market_drafts set
      intelligence_origin_type = origin_type_input,
      intelligence_origin_id = origin_id_input,
      expert_run_id = run_row.id
    where id = draft_id_input;
    return sync_result || jsonb_build_object(
      'origin_type', origin_type_input,
      'origin_id', origin_id_input,
      'expert_run_id', run_row.id,
      'idempotent', true
    );
  end if;

  monitor_required_value := coalesce(contract_input ->> 'capture_strategy', '') in (
    'snapshot_at_deadline', 'poll_during_window', 'event_presence'
  );
  insert into private.market_source_bindings(
    draft_id, origin_type, origin_id, expert_run_id, plan_version,
    contract_schema_version, policy_version, resolution_contract,
    provider, adapter_version, monitor_required, monitor_readiness
  ) values (
    draft_id_input,
    origin_type_input,
    origin_id_input,
    run_row.id,
    1,
    coalesce(contract_input ->> 'contract_schema_version', 'atinara-resolution-contract-v1'),
    run_row.policy_version,
    jsonb_set(contract_input, '{sources}', sources_input, true),
    coalesce(contract_input ->> 'provider', run_row.provider),
    coalesce(contract_input ->> 'provider_adapter_version', 'unknown'),
    monitor_required_value,
    case when monitor_required_value then 'required' else 'not_required' end
  ) returning * into binding_row;

  for item in select value from jsonb_array_elements(sources_input) loop
    insert into private.market_source_binding_sources(
      binding_id, source_url, role, precedence, fallback_condition, required
    ) values (
      binding_row.id,
      left(item ->> 'url', 2048),
      item ->> 'role',
      (item ->> 'precedence')::integer,
      nullif(item ->> 'fallback_condition', ''),
      coalesce((item ->> 'required')::boolean, false)
    );
  end loop;

  update private.market_drafts set
    intelligence_origin_type = origin_type_input,
    intelligence_origin_id = origin_id_input,
    expert_run_id = run_row.id,
    updated_at = now(),
    updated_by = actor_id
  where id = draft_id_input;
  insert into private.market_admin_audit(actor_id, action_code, draft_id, draft_version, detail)
  values (
    actor_id,
    'MARKET_INTELLIGENCE_BOUND',
    draft_id_input,
    draft_row.content_version,
    jsonb_build_object(
      'binding_id', binding_row.id,
      'origin_type', origin_type_input,
      'plan_version', binding_row.plan_version,
      'idempotent', true
    )
  );
  return to_jsonb(binding_row) || jsonb_build_object('changed', true, 'idempotent', true);
end;
$function$;

revoke all on function public.bind_market_draft_intelligence(uuid,text,text,uuid,jsonb,jsonb)
  from public, anon, authenticated;
grant execute on function public.bind_market_draft_intelligence(uuid,text,text,uuid,jsonb,jsonb)
  to authenticated;

create or replace function public.save_market_draft_from_radar(
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
  actor_id uuid := private.require_current_admin();
  candidate private.external_market_candidates%rowtype;
  save_result jsonb;
  saved_draft_id uuid;
  provenance jsonb;
  replay boolean := false;
begin
  if draft_id_input is null and nullif(trim(draft_input ->> '_idempotency_key'), '') is null then
    raise exception 'IDEMPOTENCY_KEY_REQUIRED' using errcode = '22023';
  end if;
  select * into candidate
  from private.external_market_candidates
  where id = candidate_id_input
  for update;
  if not found
     or candidate.state not in ('available', 'prepared')
     or candidate.normalizer_version <> 'atinara-radar-v2'
     or (
       candidate.state = 'available'
       and (
         candidate.verification_status <> 'verified_open'
         or candidate.expires_at <= now()
         or candidate.verification_expires_at is null
         or candidate.verification_expires_at <= now()
       )
     ) then
    raise exception 'RADAR_CANDIDATE_NOT_PREPARABLE' using errcode = 'P0001';
  end if;
  if candidate.state = 'available' and jsonb_array_length(candidate.duplicate_matches) > 0 then
    raise exception 'RADAR_CONFIRMED_DUPLICATE' using errcode = '23505';
  end if;

  save_result := public.save_market_draft(draft_id_input, expected_version_input, draft_input);
  saved_draft_id := (save_result -> 'draft' ->> 'id')::uuid;
  replay := coalesce((save_result ->> 'idempotency_replay')::boolean, false);
  if candidate.state = 'prepared' and candidate.prepared_draft_id is distinct from saved_draft_id then
    raise exception 'RADAR_CANDIDATE_ALREADY_PREPARED' using errcode = '23505';
  end if;

  provenance := jsonb_build_object(
    'provider', candidate.provider,
    'external_id', candidate.external_id,
    'external_event_id', candidate.external_event_id,
    'external_event_url', candidate.external_event_url,
    'external_market_url', candidate.external_market_url,
    'source_title', candidate.normalized_payload ->> 'source_title',
    'source_resolution_url', candidate.normalized_payload ->> 'source_resolution_url',
    'fetched_at', candidate.fetched_at,
    'fingerprint', candidate.fingerprint,
    'normalizer_version', candidate.normalizer_version,
    'verification_status', candidate.verification_status,
    'verification_reason_code', candidate.verification_reason_code,
    'verified_at', candidate.verified_at,
    'verification_evidence', candidate.verification_evidence,
    'warnings', candidate.warnings,
    'quality_score', candidate.quality_score,
    'score_breakdown', candidate.score_breakdown,
    'prepared_at', coalesce(candidate.updated_at, now())
  );

  if candidate.state = 'available' then
    update private.market_drafts set
      radar_candidate_id = candidate.id,
      source_provenance = provenance
    where id = saved_draft_id;
    update private.external_market_candidates set
      state = 'prepared',
      prepared_draft_id = saved_draft_id,
      updated_at = now()
    where id = candidate.id;
    insert into private.market_admin_audit(actor_id, action_code, draft_id, draft_version, detail)
    values (
      actor_id,
      'RADAR_DRAFT_PREPARED',
      saved_draft_id,
      (save_result -> 'draft' ->> 'content_version')::bigint,
      jsonb_build_object(
        'provider', candidate.provider,
        'external_id', candidate.external_id,
        'event_group_key', candidate.event_group_key,
        'verification_status', candidate.verification_status,
        'idempotency_replay', replay
      )
    );
  end if;

  return save_result || jsonb_build_object(
    'radar_origin', provenance,
    'radar_candidate_replay', candidate.state = 'prepared',
    'atomic', true
  );
end;
$function$;

revoke all on function public.save_market_draft_from_radar(uuid,uuid,bigint,jsonb)
  from public, anon, authenticated;
grant execute on function public.save_market_draft_from_radar(uuid,uuid,bigint,jsonb)
  to authenticated;

create or replace function public.save_market_draft_from_intelligence(
  draft_id_input uuid,
  expected_version_input bigint,
  draft_input jsonb,
  origin_type_input text,
  origin_id_input text,
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
  save_result jsonb;
  saved_draft_id uuid;
  binding_result jsonb;
begin
  perform private.require_current_admin();
  if draft_id_input is not null then
    raise exception 'INTELLIGENCE_DRAFT_MUST_BE_NEW' using errcode = '22023';
  end if;
  if nullif(trim(draft_input ->> '_idempotency_key'), '') is null then
    raise exception 'IDEMPOTENCY_KEY_REQUIRED' using errcode = '22023';
  end if;
  save_result := public.save_market_draft(draft_id_input, expected_version_input, draft_input);
  saved_draft_id := (save_result -> 'draft' ->> 'id')::uuid;
  binding_result := public.bind_market_draft_intelligence(
    saved_draft_id,
    origin_type_input,
    origin_id_input,
    expert_run_id_input,
    contract_input,
    sources_input
  );
  return save_result || jsonb_build_object(
    'intelligence_binding', binding_result,
    'atomic', true,
    'published', false,
    'resolved', false
  );
end;
$function$;

revoke all on function public.save_market_draft_from_intelligence(uuid,bigint,jsonb,text,text,uuid,jsonb,jsonb)
  from public, anon, authenticated;
grant execute on function public.save_market_draft_from_intelligence(uuid,bigint,jsonb,text,text,uuid,jsonb,jsonb)
  to authenticated;

do $constraints$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'market_drafts_effective_review_fk'
  ) then
    alter table private.market_drafts
      add constraint market_drafts_effective_review_fk
      foreign key (effective_review_id) references private.market_effective_reviews(id)
      on delete set null;
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'market_drafts_last_review_attempt_fk'
  ) then
    alter table private.market_drafts
      add constraint market_drafts_last_review_attempt_fk
      foreign key (last_review_attempt_id) references private.market_review_attempts(id)
      on delete set null;
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'market_drafts_human_confirmed_review_fk'
  ) then
    alter table private.market_drafts
      add constraint market_drafts_human_confirmed_review_fk
      foreign key (human_confirmed_review_id) references private.market_effective_reviews(id)
      on delete set null;
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'market_review_reports_classification_check'
  ) then
    alter table private.market_review_reports
      add constraint market_review_reports_classification_check
      check (review_classification is null or review_classification in ('content', 'technical'));
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'market_review_reports_safe_metadata_check'
  ) then
    alter table private.market_review_reports
      add constraint market_review_reports_safe_metadata_check
      check (jsonb_typeof(safe_provider_metadata) = 'object');
  end if;
end;
$constraints$;

comment on column private.market_drafts.content_fingerprint is
  'Huella SHA-256 del payload canónico editable; desde Paso 13.5.2 usa sha256-canonical-v2.';
comment on column private.market_drafts.effective_review_id is
  'Aprobación efectiva actual. Es independiente de last_review_attempt_id.';
comment on column private.market_drafts.last_review_attempt_id is
  'Último intento técnico o de contenido, tenga o no un veredicto efectivo.';
comment on function public.save_market_draft(uuid,bigint,jsonb) is
  'Guardado canónico e idempotente. Un no-op conserva versión, revisión y confirmación; los cambios crean snapshot inmutable.';
comment on function public.record_market_draft_review_v2(uuid,text,jsonb,jsonb,uuid,text,jsonb) is
  'Registra intentos y conserva la última aprobación efectiva ante invalid_response, cuota, timeout o error de proveedor.';
comment on function public.restore_market_draft_review_memory(uuid,bigint,boolean) is
  'Recuperación auditada y fail-closed de precisión temporal; nunca confirma ni publica.';

commit;
