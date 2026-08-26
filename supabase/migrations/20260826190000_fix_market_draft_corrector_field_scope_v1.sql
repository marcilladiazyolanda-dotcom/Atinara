-- Repara el alcance del Corrector sin relajar las puertas humanas:
-- 1) registra perfiles públicos de X solo para PRIMARY_RESOLUTION;
-- 2) exige identidad cuenta/sujeto en SQL para el parser dedicado;
-- 3) completa estrategias de escritura por campo sin modificar filas v2;
-- 4) detecta todos los campos editables obligatorios antes de publicar.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';

select pg_advisory_xact_lock(hashtextextended('atinara:market-draft-corrector-field-scope-v1', 0));

insert into private.market_source_registry (
  provider, source_name, canonical_domain, external_entity_id, allowed_roles,
  authority_tier, categories, access_method, health_status, retention_policy,
  parser_version, active
)
select
  'public_social_account', 'Cuenta pública oficial en X', 'x.com', 'account_path_v1',
  '["primary_resolution"]'::jsonb, 'primary', '[]'::jsonb, 'https', 'unknown',
  jsonb_build_object('snapshot', true, 'append_only', true, 'identity_scope', 'public_account_path_v1'),
  'atinara-public-account-source-v1', true
where not exists (
  select 1
  from private.market_source_registry registry
  where registry.provider = 'public_social_account'
    and registry.canonical_domain = 'x.com'
    and coalesce(registry.external_entity_id, '') = 'account_path_v1'
);

do $assert_public_account_registry$
begin
  if not exists (
    select 1
    from private.market_source_registry registry
    where registry.provider = 'public_social_account'
      and registry.canonical_domain = 'x.com'
      and coalesce(registry.external_entity_id, '') = 'account_path_v1'
      and registry.active
      and registry.authority_tier = 'primary'
      and registry.parser_version = 'atinara-public-account-source-v1'
      and jsonb_array_length(registry.allowed_roles) = 1
      and registry.allowed_roles @> '["primary_resolution"]'::jsonb
      and jsonb_array_length(registry.categories) = 0
  ) then
    raise exception 'PUBLIC_ACCOUNT_SOURCE_REGISTRY_CONFLICT';
  end if;
end;
$assert_public_account_registry$;

create or replace function private.enforce_market_draft_public_account_check_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  registry_row private.market_source_registry%rowtype;
  draft_row private.market_drafts%rowtype;
  account_handle_value text;
begin
  select * into registry_row
  from private.market_source_registry registry
  where registry.id = new.registry_source_id;

  if not found
     or registry_row.parser_version is distinct from 'atinara-public-account-source-v1' then
    return new;
  end if;

  select * into draft_row
  from private.market_drafts draft
  where draft.id = new.draft_id;
  if not found then raise exception 'DRAFT_NOT_FOUND' using errcode = 'P0001'; end if;

  if lower(regexp_replace(registry_row.canonical_domain, '^www\.', '')) is distinct from 'x.com'
     or (registry_row.allowed_roles @> '["primary_resolution"]'::jsonb) is not true
     or new.validation_version is distinct from 'atinara-primary-source-validation-v1'
     or new.final_url !~* '^https://(www\.)?x\.com/[A-Za-z0-9_]{1,15}/?$'
     or new.requested_url !~* '^https://(www\.)?x\.com/[A-Za-z0-9_]{1,15}/?$'
     or new.evidence_snapshot ->> 'identity_scope' is distinct from 'public_account_path_v1'
     or new.evidence_snapshot ->> 'relevance_basis'
       is distinct from 'fetched_content_and_canonical_url_v1' then
    raise exception 'PUBLIC_ACCOUNT_SOURCE_CHECK_INVALID' using errcode = '22023';
  end if;

  account_handle_value := lower(regexp_replace(
    new.final_url,
    '^https://(www\.)?x\.com/([A-Za-z0-9_]{1,15})/?$',
    '\2',
    'i'
  ));
  if account_handle_value = ''
     or lower(coalesce(new.evidence_snapshot ->> 'account_handle', ''))
       is distinct from account_handle_value
     or lower(coalesce(draft_row.subject, ''))
       !~ ('(^|[^a-z0-9_])@' || account_handle_value || '([^a-z0-9_]|$)')
     or not exists (
       select 1
       from jsonb_array_elements_text(
         coalesce(new.evidence_snapshot -> 'matched_tokens', '[]'::jsonb)
       ) token(value)
       where lower(token.value) = account_handle_value
     ) then
    raise exception 'PUBLIC_ACCOUNT_IDENTITY_MISMATCH' using errcode = '22023';
  end if;

  return new;
end;
$function$;

revoke all on function private.enforce_market_draft_public_account_check_v1()
  from public, anon, authenticated, service_role;
alter function private.enforce_market_draft_public_account_check_v1() owner to postgres;

drop trigger if exists ab_enforce_market_draft_public_account_check_v1
  on private.market_draft_primary_source_checks;
create trigger ab_enforce_market_draft_public_account_check_v1
before insert on private.market_draft_primary_source_checks
for each row execute function private.enforce_market_draft_public_account_check_v1();

with issue_values(code, strategy_key, affected_fields) as (
  values
    ('INVALID_MARKET_SLUG', 'normalize_market_slug', '["market_slug"]'::jsonb),
    ('DESCRIPTION_REQUIRED', 'derive_description', '["description"]'::jsonb),
    ('DELAY_TREATMENT_REQUIRED', 'derive_delay_treatment', '["delay_treatment"]'::jsonb),
    ('CANCELLATION_TREATMENT_REQUIRED', 'derive_cancellation_treatment', '["cancellation_treatment"]'::jsonb),
    ('LEAK_TREATMENT_REQUIRED', 'derive_leak_treatment', '["leak_treatment"]'::jsonb),
    ('RENAME_TREATMENT_REQUIRED', 'derive_rename_treatment', '["rename_treatment"]'::jsonb),
    ('ASSUMPTIONS_REQUIRED', 'derive_assumptions', '["assumptions"]'::jsonb)
)
insert into private.market_issue_strategy_registry (
  code, phase, severity, disposition, strategy_key, affected_fields,
  invariants, evidence_required, expected_result, policy_version, schema_version,
  active
)
select
  code, 'validator', 'blocking', 'auto_repair', strategy_key, affected_fields,
  '["preserve_contract_meaning","preserve_private_state","never_confirm_or_publish"]'::jsonb,
  '["authoritative_version","content_fingerprint"]'::jsonb,
  jsonb_build_object(
    'draft_private', true,
    'requires_revalidation', true,
    'human_confirmation_required', true
  ),
  'atinara-expert-cycle-policy-v2', 'atinara-market-issue-contract-v1', true
from issue_values
on conflict (code) do nothing;

insert into private.market_issue_registry (
  code, phase, severity, repairable, policy_version, schema_version, active
)
values
  ('INVALID_MARKET_SLUG', 'validator', 'blocking', true, 'atinara-expert-cycle-policy-v2', 'atinara-market-issue-contract-v1', true),
  ('DESCRIPTION_REQUIRED', 'validator', 'blocking', true, 'atinara-expert-cycle-policy-v2', 'atinara-market-issue-contract-v1', true),
  ('DELAY_TREATMENT_REQUIRED', 'validator', 'blocking', true, 'atinara-expert-cycle-policy-v2', 'atinara-market-issue-contract-v1', true),
  ('CANCELLATION_TREATMENT_REQUIRED', 'validator', 'blocking', true, 'atinara-expert-cycle-policy-v2', 'atinara-market-issue-contract-v1', true),
  ('LEAK_TREATMENT_REQUIRED', 'validator', 'blocking', true, 'atinara-expert-cycle-policy-v2', 'atinara-market-issue-contract-v1', true),
  ('RENAME_TREATMENT_REQUIRED', 'validator', 'blocking', true, 'atinara-expert-cycle-policy-v2', 'atinara-market-issue-contract-v1', true),
  ('ASSUMPTIONS_REQUIRED', 'validator', 'blocking', true, 'atinara-expert-cycle-policy-v2', 'atinara-market-issue-contract-v1', true)
on conflict (code) do nothing;

insert into private.market_repair_strategy_registry (
  strategy_key, handler_key, can_write, affected_fields, write_fields,
  invariants, registry_version, active
)
values
  ('normalize_market_slug', 'normalize_market_slug', true, '["market_slug"]'::jsonb, '["market_slug"]'::jsonb, '["preserve_contract_meaning","preserve_private_state","never_confirm_or_publish"]'::jsonb, 'atinara-agent-registry-v2.1.0', true),
  ('derive_description', 'derive_description', true, '["description"]'::jsonb, '["description"]'::jsonb, '["preserve_contract_meaning","preserve_private_state","never_confirm_or_publish"]'::jsonb, 'atinara-agent-registry-v2.1.0', true),
  ('derive_delay_treatment', 'derive_delay_treatment', true, '["delay_treatment"]'::jsonb, '["delay_treatment"]'::jsonb, '["preserve_contract_meaning","preserve_private_state","never_confirm_or_publish"]'::jsonb, 'atinara-agent-registry-v2.1.0', true),
  ('derive_cancellation_treatment', 'derive_cancellation_treatment', true, '["cancellation_treatment"]'::jsonb, '["cancellation_treatment"]'::jsonb, '["preserve_contract_meaning","preserve_private_state","never_confirm_or_publish"]'::jsonb, 'atinara-agent-registry-v2.1.0', true),
  ('derive_leak_treatment', 'derive_leak_treatment', true, '["leak_treatment"]'::jsonb, '["leak_treatment"]'::jsonb, '["preserve_contract_meaning","preserve_private_state","never_confirm_or_publish"]'::jsonb, 'atinara-agent-registry-v2.1.0', true),
  ('derive_rename_treatment', 'derive_rename_treatment', true, '["rename_treatment"]'::jsonb, '["rename_treatment"]'::jsonb, '["preserve_contract_meaning","preserve_private_state","never_confirm_or_publish"]'::jsonb, 'atinara-agent-registry-v2.1.0', true),
  ('derive_assumptions', 'derive_assumptions', true, '["assumptions"]'::jsonb, '["assumptions"]'::jsonb, '["preserve_contract_meaning","preserve_private_state","never_confirm_or_publish"]'::jsonb, 'atinara-agent-registry-v2.1.0', true),
  ('apply_registered_primary', 'apply_registered_primary', true, '["primary_source"]'::jsonb, '["primary_source"]'::jsonb, '["fresh_registered_source","preserve_contract_meaning","never_confirm_or_publish"]'::jsonb, 'atinara-agent-registry-v2.1.0', true),
  ('apply_validated_alternatives', 'apply_validated_alternatives', true, '["alternative_sources"]'::jsonb, '["alternative_sources"]'::jsonb, '["fresh_registered_source","preserve_contract_meaning","never_confirm_or_publish"]'::jsonb, 'atinara-agent-registry-v2.1.0', true),
  ('apply_registered_sources', 'apply_registered_sources', true, '["primary_source","alternative_sources"]'::jsonb, '["primary_source","alternative_sources"]'::jsonb, '["fresh_registered_source","preserve_contract_meaning","never_confirm_or_publish"]'::jsonb, 'atinara-agent-registry-v2.1.0', true)
on conflict (strategy_key) do nothing;

insert into private.market_issue_strategy_bindings (issue_code, strategy_key, priority, active)
values
  ('INVALID_MARKET_SLUG', 'normalize_market_slug', 50, true),
  ('DESCRIPTION_REQUIRED', 'derive_description', 50, true),
  ('DELAY_TREATMENT_REQUIRED', 'derive_delay_treatment', 50, true),
  ('CANCELLATION_TREATMENT_REQUIRED', 'derive_cancellation_treatment', 50, true),
  ('LEAK_TREATMENT_REQUIRED', 'derive_leak_treatment', 50, true),
  ('RENAME_TREATMENT_REQUIRED', 'derive_rename_treatment', 50, true),
  ('ASSUMPTIONS_REQUIRED', 'derive_assumptions', 50, true),
  ('PRIMARY_SOURCE_INVALID', 'apply_registered_primary', 50, true),
  ('RESOLUTION_PRIMARY_SOURCE_REQUIRED', 'apply_registered_primary', 50, true),
  ('ALTERNATIVE_SOURCE_REQUIRED', 'apply_validated_alternatives', 50, true),
  ('ALTERNATIVE_SOURCE_INVALID', 'apply_validated_alternatives', 50, true),
  ('MISSING_RESOLUTION_SOURCE', 'apply_registered_sources', 50, true),
  ('INSUFFICIENT_EVIDENCE', 'apply_registered_sources', 50, true)
on conflict (issue_code, strategy_key) do nothing;

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
  if trim(coalesce(draft.market_slug, '')) !~ '^[a-z0-9][a-z0-9-]{2,119}$' then
    issues := issues || jsonb_build_array(jsonb_build_object(
      'code', 'INVALID_MARKET_SLUG', 'field', 'market_slug',
      'message', 'El slug debe ser canónico, estable y usar solo minúsculas, números y guiones.'
    ));
  end if;
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
      'code', 'CATEGORY_REQUIRED', 'field', 'category', 'message', 'Selecciona una categoría.'
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
     or draft.evaluation_ends_at is null or draft.closes_at is null then
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
     or not exists (select 1 from pg_catalog.pg_timezone_names tz where tz.name = draft.timezone) then
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
  if length(trim(coalesce(draft.description, ''))) < 30 then
    issues := issues || jsonb_build_array(jsonb_build_object(
      'code', 'DESCRIPTION_REQUIRED', 'field', 'description',
      'message', 'Añade una descripción pública suficiente del mercado.'
    ));
  end if;
  if length(trim(coalesce(draft.delay_treatment, ''))) < 30 then
    issues := issues || jsonb_build_array(jsonb_build_object(
      'code', 'DELAY_TREATMENT_REQUIRED', 'field', 'delay_treatment',
      'message', 'Define cómo se tratan los retrasos sin ampliar el periodo evaluado.'
    ));
  end if;
  if length(trim(coalesce(draft.cancellation_treatment, ''))) < 30 then
    issues := issues || jsonb_build_array(jsonb_build_object(
      'code', 'CANCELLATION_TREATMENT_REQUIRED', 'field', 'cancellation_treatment',
      'message', 'Define cómo se tratan la cancelación o anulación extraordinaria.'
    ));
  end if;
  if length(trim(coalesce(draft.leak_treatment, ''))) < 30 then
    issues := issues || jsonb_build_array(jsonb_build_object(
      'code', 'LEAK_TREATMENT_REQUIRED', 'field', 'leak_treatment',
      'message', 'Define cómo se tratan filtraciones y afirmaciones de terceros.'
    ));
  end if;
  if length(trim(coalesce(draft.rename_treatment, ''))) < 30 then
    issues := issues || jsonb_build_array(jsonb_build_object(
      'code', 'RENAME_TREATMENT_REQUIRED', 'field', 'rename_treatment',
      'message', 'Define la continuidad de identidad ante cambios de nombre o identificador.'
    ));
  end if;
  if length(trim(coalesce(draft.assumptions, ''))) < 20 then
    issues := issues || jsonb_build_array(jsonb_build_object(
      'code', 'ASSUMPTIONS_REQUIRED', 'field', 'assumptions',
      'message', 'Explicita las definiciones y supuestos materiales del contrato.'
    ));
  end if;
  return issues;
end;
$function$;

revoke all on function private.market_draft_deterministic_issues(private.market_drafts)
  from public, anon, authenticated, service_role;
alter function private.market_draft_deterministic_issues(private.market_drafts) owner to postgres;

select private.assert_market_agent_registry_consistency_v2();

comment on function private.enforce_market_draft_public_account_check_v1() is
  'Defensa SQL del parser de perfiles públicos: exige perfil canónico, handle explícito en el sujeto y evidencia recuperada de la misma cuenta.';
comment on function private.market_draft_deterministic_issues(private.market_drafts) is
  'Puerta determinista completa de los campos editables del borrador; no publica, confirma ni resuelve.';

commit;
