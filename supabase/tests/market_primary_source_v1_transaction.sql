-- Regresión transaccional de PRIMARY registrada para el Corrector v1.
-- Requiere 20260809170000 y siempre termina en ROLLBACK.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';

do $test$
declare
  admin_id uuid;
  registry_id_value uuid := gen_random_uuid();
  wrong_registry_id uuid := gen_random_uuid();
  managed_registry_id uuid;
  draft_id_value uuid;
  draft_version_value bigint;
  check_id_value uuid;
  expired_check_id uuid;
  market_count_before bigint;
  prediction_count_before bigint;
  fixture_suffix text := replace(gen_random_uuid()::text, '-', '');
  registry_domain text;
  managed_registry_domain text;
  source_url text;
  managed_updated_at timestamptz;
  payload jsonb;
  managed_payload jsonb;
  repaired_payload jsonb;
  contract_value jsonb;
  sources_value jsonb;
  evidence_value jsonb;
  tampered_value jsonb;
  saved jsonb;
  registry_result jsonb;
  admin_registry_result jsonb;
  first_upsert jsonb;
  second_upsert jsonb;
  deactivated jsonb;
  recorded jsonb;
  applied jsonb;
  expected_failure boolean;
begin
  select user_row.id into admin_id
  from auth.users user_row
  where coalesce((user_row.raw_app_meta_data ->> 'oraklo_admin')::boolean, false)
  order by user_row.created_at
  limit 1;
  if admin_id is null then raise exception 'TEST_ADMIN_REQUIRED'; end if;
  select count(*) into market_count_before from public.markets;
  select count(*) into prediction_count_before from public.predictions;

  registry_domain := 'primary-' || fixture_suffix || '.example.com';
  source_url := 'https://' || registry_domain || '/project-primary-' || fixture_suffix || '/release';

  insert into private.market_source_registry(
    id, provider, source_name, canonical_domain, external_entity_id,
    allowed_roles, authority_tier, categories, access_method, health_status,
    retention_policy, parser_version, active
  ) values (
    registry_id_value, 'primary-test-' || fixture_suffix, 'Primary transaction fixture',
    registry_domain, fixture_suffix, '["primary_resolution"]'::jsonb,
    'primary', '["Lanzamientos"]'::jsonb, 'https', 'healthy',
    '{"snapshot":true,"append_only":true}'::jsonb,
    'primary-transaction-parser-v1', true
  );
  insert into private.market_source_registry(
    id, provider, source_name, canonical_domain, external_entity_id,
    allowed_roles, authority_tier, categories, access_method, health_status,
    retention_policy, parser_version, active
  ) values (
    wrong_registry_id, 'primary-wrong-role-' || fixture_suffix, 'Wrong role fixture',
    'wrong-' || fixture_suffix || '.example.com', fixture_suffix,
    '["radar_fact_evidence"]'::jsonb, 'primary', '[]'::jsonb,
    'https', 'healthy', '{}'::jsonb, 'wrong-role-parser-v1', true
  );

  if has_table_privilege('service_role', 'private.market_source_registry', 'SELECT')
     or has_table_privilege('service_role', 'private.market_source_registry', 'INSERT')
     or has_table_privilege('service_role', 'private.market_source_registry', 'UPDATE')
     or has_table_privilege('service_role', 'private.market_source_registry', 'DELETE')
     or has_table_privilege('authenticated', 'private.market_source_registry', 'SELECT')
     or has_table_privilege('authenticated', 'private.market_source_registry', 'INSERT')
     or has_table_privilege('authenticated', 'private.market_source_registry', 'UPDATE')
     or has_table_privilege('authenticated', 'private.market_source_registry', 'DELETE')
     or has_table_privilege('service_role', 'private.market_draft_primary_source_checks', 'SELECT')
     or has_table_privilege('service_role', 'private.market_draft_primary_source_checks', 'INSERT')
     or has_table_privilege('service_role', 'private.market_draft_primary_source_checks', 'UPDATE')
     or has_table_privilege('service_role', 'private.market_draft_primary_source_checks', 'DELETE') then
    raise exception 'TEST_SERVICE_ROLE_HAS_RAW_PRIMARY_DML';
  end if;
  if has_function_privilege(
       'service_role',
       'public.apply_market_draft_expert_repair(uuid,bigint,jsonb,jsonb,jsonb,jsonb)',
       'EXECUTE'
     ) or has_function_privilege(
       'authenticated',
       'public.apply_market_draft_expert_repair(uuid,bigint,jsonb,jsonb,jsonb,jsonb)',
       'EXECUTE'
     ) then
    raise exception 'TEST_LEGACY_APPLY_STILL_EXECUTABLE';
  end if;
  if not has_function_privilege(
       'service_role',
       'public.get_market_draft_authoritative_source_registry_v1(text)',
       'EXECUTE'
     ) or has_function_privilege(
       'authenticated',
       'public.get_market_draft_authoritative_source_registry_v1(text)',
       'EXECUTE'
     ) or not has_function_privilege(
       'service_role',
       'public.record_market_draft_primary_source_check_v1(uuid,bigint,uuid,text,text,text,text,jsonb)',
       'EXECUTE'
     ) or has_function_privilege(
       'authenticated',
       'public.record_market_draft_primary_source_check_v1(uuid,bigint,uuid,text,text,text,text,jsonb)',
       'EXECUTE'
     ) then
    raise exception 'TEST_PRIMARY_RPC_PRIVILEGES_INVALID';
  end if;
  if not has_function_privilege(
       'authenticated',
       'public.list_market_authoritative_source_registry_admin_v1()',
       'EXECUTE'
     ) or not has_function_privilege(
       'authenticated',
       'public.upsert_market_authoritative_source_registry_admin_v1(jsonb)',
       'EXECUTE'
     ) or not has_function_privilege(
       'authenticated',
       'public.deactivate_market_authoritative_source_registry_admin_v1(uuid,text)',
       'EXECUTE'
     ) or has_function_privilege(
       'service_role',
       'public.list_market_authoritative_source_registry_admin_v1()',
       'EXECUTE'
     ) or has_function_privilege(
       'service_role',
       'public.upsert_market_authoritative_source_registry_admin_v1(jsonb)',
       'EXECUTE'
     ) or has_function_privilege(
       'service_role',
       'public.deactivate_market_authoritative_source_registry_admin_v1(uuid,text)',
       'EXECUTE'
     ) or has_function_privilege(
       'anon',
       'public.list_market_authoritative_source_registry_admin_v1()',
       'EXECUTE'
     ) then
    raise exception 'TEST_REGISTRY_ADMIN_RPC_PRIVILEGES_INVALID';
  end if;

  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text,
    true
  );
  expected_failure := false;
  begin
    perform public.list_market_authoritative_source_registry_admin_v1();
  exception when sqlstate '42501' then
    if sqlerrm <> 'ADMIN_REQUIRED' then raise; end if;
    expected_failure := true;
  end;
  if not expected_failure then raise exception 'TEST_NON_ADMIN_REGISTRY_LIST_SUCCEEDED'; end if;
  expected_failure := false;
  begin
    perform public.upsert_market_authoritative_source_registry_admin_v1('{}'::jsonb);
  exception when sqlstate '42501' then
    if sqlerrm <> 'ADMIN_REQUIRED' then raise; end if;
    expected_failure := true;
  end;
  if not expected_failure then raise exception 'TEST_NON_ADMIN_REGISTRY_UPSERT_SUCCEEDED'; end if;
  expected_failure := false;
  begin
    perform public.deactivate_market_authoritative_source_registry_admin_v1(
      gen_random_uuid(), 'Intento no autorizado de desactivación.'
    );
  exception when sqlstate '42501' then
    if sqlerrm <> 'ADMIN_REQUIRED' then raise; end if;
    expected_failure := true;
  end;
  if not expected_failure then raise exception 'TEST_NON_ADMIN_REGISTRY_DEACTIVATE_SUCCEEDED'; end if;

  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', admin_id, 'role', 'authenticated')::text,
    true
  );

  managed_registry_domain := 'managed-' || fixture_suffix || '.example.com';
  managed_payload := jsonb_build_object(
    'provider', 'b2b-test-' || fixture_suffix,
    'source_name', 'B2B managed official publisher',
    'canonical_url', 'https://' || managed_registry_domain || '/',
    'external_entity_id', fixture_suffix,
    'allowed_roles', '["radar_fact_evidence","primary_resolution"]'::jsonb,
    'categories', '["Lanzamientos","Reviews/Premios"]'::jsonb,
    'parser_version', 'b2b-managed-parser-v1'
  );
  first_upsert := public.upsert_market_authoritative_source_registry_admin_v1(managed_payload);
  managed_registry_id := (first_upsert -> 'source' ->> 'id')::uuid;
  if managed_registry_id is null
     or coalesce((first_upsert ->> 'changed')::boolean, false) is not true
     or first_upsert -> 'source' ->> 'canonical_domain' is distinct from managed_registry_domain
     or not (first_upsert -> 'source' -> 'allowed_roles' @> '["primary_resolution"]'::jsonb)
     or not (first_upsert -> 'source' -> 'categories' @> '["lanzamientos","reviews-premios"]'::jsonb) then
    raise exception 'TEST_REGISTRY_ADMIN_UPSERT_INVALID: %', first_upsert;
  end if;
  select registry.updated_at into managed_updated_at
  from private.market_source_registry registry
  where registry.id = managed_registry_id;
  second_upsert := public.upsert_market_authoritative_source_registry_admin_v1(managed_payload);
  if (second_upsert -> 'source' ->> 'id')::uuid is distinct from managed_registry_id
     or coalesce((second_upsert ->> 'changed')::boolean, true) is not false
     or (select count(*) from private.market_source_registry registry
         where registry.provider = managed_payload ->> 'provider'
           and registry.canonical_domain = managed_registry_domain
           and coalesce(registry.external_entity_id, '') = fixture_suffix) <> 1
     or (select registry.updated_at from private.market_source_registry registry
         where registry.id = managed_registry_id) is distinct from managed_updated_at then
    raise exception 'TEST_REGISTRY_ADMIN_UPSERT_NOT_IDEMPOTENT: %', second_upsert;
  end if;
  if not exists (
    select 1 from private.market_admin_audit audit
    where audit.action_code = 'MARKET_SOURCE_REGISTRY_UPSERTED'
      and (audit.detail ->> 'registry_source_id')::uuid = managed_registry_id
      and audit.detail ? 'before'
      and audit.detail ? 'after'
      and coalesce((audit.detail ->> 'publishes')::boolean, true) = false
      and coalesce((audit.detail ->> 'confirms')::boolean, true) = false
      and coalesce((audit.detail ->> 'resolves')::boolean, true) = false
  ) then
    raise exception 'TEST_REGISTRY_ADMIN_UPSERT_AUDIT_MISSING';
  end if;

  foreach tampered_value in array array[
    managed_payload || jsonb_build_object('active', true),
    jsonb_set(managed_payload, '{canonical_url}', '"http://publisher.example.com"'::jsonb),
    jsonb_set(managed_payload, '{canonical_url}', '"https://localhost"'::jsonb),
    jsonb_set(managed_payload, '{allowed_roles}', '["provider_fact"]'::jsonb),
    jsonb_set(managed_payload, '{allowed_roles}', '["primary_resolution","owner"]'::jsonb),
    jsonb_set(managed_payload, '{categories}', '["Finanzas"]'::jsonb),
    jsonb_set(managed_payload, '{parser_version}', '"../../parser"'::jsonb)
  ] loop
    expected_failure := false;
    begin
      perform public.upsert_market_authoritative_source_registry_admin_v1(tampered_value);
    exception when sqlstate '22023' then
      expected_failure := true;
    end;
    if not expected_failure then
      raise exception 'TEST_REGISTRY_ADMIN_TAMPER_ACCEPTED: %', tampered_value;
    end if;
  end loop;

  -- Una identidad reservada a provider_fact (Kalshi/Polymarket) no puede ser
  -- elevada a PRIMARY ni siquiera por el RPC administrativo.
  expected_failure := false;
  begin
    perform public.upsert_market_authoritative_source_registry_admin_v1(
      jsonb_build_object(
        'provider', 'radar_provider',
        'source_name', 'Kalshi',
        'canonical_url', 'https://kalshi.com',
        'allowed_roles', '["primary_resolution"]'::jsonb,
        'categories', '[]'::jsonb,
        'parser_version', 'b2b-managed-parser-v1'
      )
    );
  exception when sqlstate '22023' then
    if sqlerrm <> 'SOURCE_REGISTRY_ROLE_BOUNDARY_CONFLICT' then raise; end if;
    expected_failure := true;
  end;
  if not expected_failure then raise exception 'TEST_PROVIDER_FACT_ELEVATED_TO_PRIMARY'; end if;
  expected_failure := false;
  begin
    perform public.deactivate_market_authoritative_source_registry_admin_v1(
      wrong_registry_id, 'Una fila no PRIMARY no puede gestionarse desde este contrato.'
    );
  exception when sqlstate '22023' then
    if sqlerrm <> 'SOURCE_REGISTRY_ROLE_BOUNDARY_CONFLICT' then raise; end if;
    expected_failure := true;
  end;
  if not expected_failure then raise exception 'TEST_NON_PRIMARY_DEACTIVATED_BY_PRIMARY_API'; end if;

  admin_registry_result := public.list_market_authoritative_source_registry_admin_v1();
  if not exists (
    select 1 from jsonb_array_elements(admin_registry_result) registry_item
    where (registry_item ->> 'id')::uuid = managed_registry_id
      and coalesce((registry_item ->> 'active')::boolean, false)
  ) then
    raise exception 'TEST_REGISTRY_ADMIN_LIST_MISSING_MANAGED_SOURCE';
  end if;
  deactivated := public.deactivate_market_authoritative_source_registry_admin_v1(
    managed_registry_id,
    'La fuente se desactiva en esta prueba transaccional auditada.'
  );
  if coalesce((deactivated ->> 'changed')::boolean, false) is not true
     or coalesce((deactivated -> 'source' ->> 'active')::boolean, true) is not false
     or deactivated -> 'source' ->> 'health_status' is distinct from 'retired' then
    raise exception 'TEST_REGISTRY_ADMIN_DEACTIVATION_INVALID: %', deactivated;
  end if;
  deactivated := public.deactivate_market_authoritative_source_registry_admin_v1(
    managed_registry_id,
    'La fuente ya estaba desactivada; esta repetición debe ser idempotente.'
  );
  if coalesce((deactivated ->> 'changed')::boolean, true) is not false then
    raise exception 'TEST_REGISTRY_ADMIN_DEACTIVATION_NOT_IDEMPOTENT: %', deactivated;
  end if;
  if not exists (
    select 1 from private.market_admin_audit audit
    where audit.action_code = 'MARKET_SOURCE_REGISTRY_DEACTIVATED'
      and (audit.detail ->> 'registry_source_id')::uuid = managed_registry_id
      and coalesce((audit.detail -> 'before' ->> 'active')::boolean, false) = true
      and coalesce((audit.detail -> 'after' ->> 'active')::boolean, true) = false
      and octet_length(audit.detail ->> 'reason') >= 10
  ) then
    raise exception 'TEST_REGISTRY_ADMIN_DEACTIVATION_AUDIT_MISSING';
  end if;

  expected_failure := false;
  begin
    perform public.get_market_draft_authoritative_source_registry_v1('primary_resolution');
  exception when sqlstate '42501' then
    if sqlerrm <> 'SERVICE_ROLE_REQUIRED' then raise; end if;
    expected_failure := true;
  end;
  if not expected_failure then raise exception 'TEST_REGISTRY_RPC_NOT_SERVICE_GUARDED'; end if;

  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', admin_id, 'role', 'service_role')::text,
    true
  );
  expected_failure := false;
  begin
    perform public.get_market_draft_authoritative_source_registry_v1('radar_fact_evidence');
  exception when sqlstate '22023' then
    if sqlerrm <> 'SOURCE_REGISTRY_ROLE_NOT_ALLOWED' then raise; end if;
    expected_failure := true;
  end;
  if not expected_failure then raise exception 'TEST_REGISTRY_ROLE_ENUMERATION_ALLOWED'; end if;

  registry_result := public.get_market_draft_authoritative_source_registry_v1('primary_resolution');
  if not exists (
       select 1 from jsonb_array_elements(registry_result) row_value
       where (row_value ->> 'id')::uuid = registry_id_value
         and row_value ->> 'canonical_domain' = registry_domain
         and row_value ->> 'parser_version' = 'primary-transaction-parser-v1'
         and row_value -> 'allowed_roles' @> '["primary_resolution"]'::jsonb
         and row_value -> 'categories' @> '["lanzamientos"]'::jsonb
     ) or exists (
       select 1 from jsonb_array_elements(registry_result) row_value
       where (row_value ->> 'id')::uuid = wrong_registry_id
     ) or exists (
       select 1 from jsonb_array_elements(registry_result) row_value
       where (row_value ->> 'id')::uuid = managed_registry_id
     ) or exists (
       select 1 from jsonb_array_elements(registry_result) row_value
       where row_value ->> 'provider' = 'radar_provider'
         and row_value ->> 'canonical_domain' in ('kalshi.com', 'polymarket.com')
     ) then
    raise exception 'TEST_REGISTRY_RPC_FILTER_OR_ATTESTATION_INVALID: %', registry_result;
  end if;

  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', admin_id, 'role', 'authenticated')::text,
    true
  );
  payload := jsonb_build_object(
    'market_slug', 'primary-source-transaction-' || fixture_suffix,
    'question', '¿Se lanzará Proyecto Primary ' || fixture_suffix || ' antes del 1 de enero de 2099?',
    'subject', '',
    'category', 'Lanzamientos',
    'yes_option', 'Sí',
    'no_option', 'No',
    'evaluation_period_label', 'Hasta el 31 de diciembre de 2098 a las 23:59:59 UTC, inclusive',
    'evaluation_ends_at', '2098-12-31T23:59:59.000Z',
    'closes_at', '2098-12-31T23:59:59.000Z',
    'timezone', 'UTC',
    'resolution_deadline', '2099-01-02T23:59:59.000Z',
    'yes_criteria', 'Se resuelve a Sí si Proyecto Primary ' || fixture_suffix || ' se lanza comercialmente antes del cierre contractual.',
    'no_criteria', 'Se resuelve a No si al cierre contractual no existe el lanzamiento comercial definido en el criterio de Sí.',
    'edge_cases', 'Rumores, fichas sin disponibilidad, preventas y publicaciones de terceros no cuentan.',
    'primary_source', jsonb_build_object('url', source_url, 'role', 'PRIMARY_RESOLUTION'),
    'alternative_sources', jsonb_build_array(jsonb_build_object(
      'url', 'https://corroboration.example.org/primary-' || fixture_suffix,
      'role', 'CORROBORATION'
    )),
    'delay_treatment', 'Los retrasos no alteran el cierre contractual.',
    'cancellation_treatment', 'Una cancelación no equivale al lanzamiento comercial.',
    'leak_treatment', 'Las filtraciones no cuentan.',
    'rename_treatment', 'Un cambio de nombre requiere continuidad oficial.',
    'assumptions', 'Las fechas se comparan en UTC.',
    'public_criteria', 'Atinara comprobará el lanzamiento oficial en la fuente primaria declarada.',
    'description', 'Fixture aislado de la puerta PRIMARY registrada.',
    '_idempotency_key', gen_random_uuid(),
    '_change_origin', 'primary_source_registry_transaction_test',
    '_timestamp_precision', 'milliseconds-v1'
  );
  saved := public.save_market_draft(null, null, payload);
  draft_id_value := (saved -> 'draft' ->> 'id')::uuid;
  draft_version_value := (saved -> 'draft' ->> 'content_version')::bigint;
  if draft_id_value is null or draft_version_value is null then
    raise exception 'TEST_PRIMARY_DRAFT_CREATE_FAILED: %', saved;
  end if;
  if not coalesce((public.get_market_draft_expert_repair_context(draft_id_value) ->> 'repair_applicable')::boolean, false) then
    raise exception 'TEST_PRIMARY_DRAFT_NOT_REPAIRABLE';
  end if;

  evidence_value := jsonb_build_object(
    'kind', 'primary_resolution',
    'requested_url', source_url,
    'final_url', source_url,
    'candidate_origin', 'registry_search',
    'accepted', true,
    'code', 'PRIMARY_SOURCE_VERIFIED',
    'checked_at', clock_timestamp(),
    'redirect_count', 0,
    'redirect_chain', jsonb_build_array(source_url),
    'registry_source_id', registry_id_value,
    'registry_domain', registry_domain,
    'registry_parser_version', 'primary-transaction-parser-v1',
    'parser_version', 'primary-transaction-parser-v1',
    'registry_categories', '["lanzamientos"]'::jsonb,
    'draft_category', 'Lanzamientos',
    'registry_role', 'primary_resolution',
    'registry_role_verified', true,
    'authority', 'private_source_registry_primary_resolution_v1',
    'relevance_basis', 'fetched_content_and_canonical_url_v1',
    'matched_tokens', '["project","primary"]'::jsonb,
    'http_status', 200,
    'excerpt_sha256', repeat('a', 64),
    'excerpt_chars', 128,
    'validated_reachable', true,
    'authority_verified', true,
    'relevance_verified', true,
    'validation_version', 'atinara-primary-source-validation-v1'
  );

  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', admin_id, 'role', 'service_role')::text,
    true
  );
  foreach tampered_value in array array[
    evidence_value || jsonb_build_object('registry_source_id', gen_random_uuid()),
    evidence_value || jsonb_build_object('registry_domain', 'malicious.example'),
    evidence_value || jsonb_build_object('registry_parser_version', 'tampered'),
    evidence_value || jsonb_build_object('parser_version', 'tampered'),
    evidence_value || jsonb_build_object('registry_role', 'radar_fact_evidence'),
    evidence_value || jsonb_build_object('registry_role_verified', false),
    evidence_value || jsonb_build_object('registry_categories', '["eventos"]'::jsonb),
    evidence_value || jsonb_build_object('draft_category', 'Eventos'),
    evidence_value || jsonb_build_object('authority', 'inherited_flags'),
    evidence_value || jsonb_build_object('requested_url', 'https://malicious.example/source'),
    evidence_value || jsonb_build_object('final_url', 'https://malicious.example/source'),
    evidence_value || jsonb_build_object('validation_version', 'legacy'),
    evidence_value || jsonb_build_object('relevance_basis', 'canonical_url_v1'),
    evidence_value || jsonb_build_object('excerpt_sha256', repeat('0', 63)),
    evidence_value || jsonb_build_object('http_status', 500),
    evidence_value || jsonb_build_object('accepted', false),
    evidence_value || jsonb_build_object('validated_reachable', false),
    evidence_value || jsonb_build_object('authority_verified', false),
    evidence_value || jsonb_build_object('relevance_verified', false)
  ] loop
    expected_failure := false;
    begin
      perform public.record_market_draft_primary_source_check_v1(
        draft_id_value, draft_version_value, registry_id_value,
        source_url, source_url, 'Lanzamientos',
        'atinara-primary-source-validation-v1', tampered_value
      );
    exception when sqlstate '22023' then
      expected_failure := true;
    end;
    if not expected_failure then
      raise exception 'TEST_TAMPERED_PRIMARY_EVIDENCE_ACCEPTED: %', tampered_value;
    end if;
  end loop;

  recorded := public.record_market_draft_primary_source_check_v1(
    draft_id_value, draft_version_value, registry_id_value,
    source_url, source_url, 'Lanzamientos',
    'atinara-primary-source-validation-v1', evidence_value
  );
  check_id_value := (recorded ->> 'id')::uuid;
  if check_id_value is null or (recorded ->> 'registry_source_id')::uuid is distinct from registry_id_value then
    raise exception 'TEST_PRIMARY_CHECK_NOT_RECORDED: %', recorded;
  end if;

  insert into private.market_draft_primary_source_checks(
    draft_id, draft_version, registry_source_id, requested_url, final_url,
    draft_category, registry_role, validation_version, evidence_snapshot,
    checked_at, expires_at
  ) values (
    draft_id_value, draft_version_value, registry_id_value, source_url, source_url,
    'Lanzamientos', 'primary_resolution', 'atinara-primary-source-validation-v1',
    evidence_value, clock_timestamp() - interval '20 minutes',
    clock_timestamp() - interval '10 minutes'
  ) returning id into expired_check_id;

  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', admin_id, 'role', 'authenticated')::text,
    true
  );
  repaired_payload := payload || jsonb_build_object(
    'subject', 'Proyecto Primary ' || fixture_suffix,
    'primary_source', jsonb_build_object(
      'url', source_url,
      'role', 'PRIMARY_RESOLUTION',
      'validated_reachable', true,
      'authority_verified', true,
      'relevance_verified', true,
      'registry_role_verified', true,
      'registry_source_id', registry_id_value,
      'registry_domain', registry_domain,
      'registry_parser_version', 'primary-transaction-parser-v1',
      'registry_role', 'primary_resolution',
      'registry_categories', '["lanzamientos"]'::jsonb,
      'draft_category', 'Lanzamientos',
      'authority_basis', 'private_source_registry_primary_resolution_v1',
      'relevance_basis', 'fetched_content_and_canonical_url_v1',
      'validation_version', 'atinara-primary-source-validation-v1'
    ),
    '_idempotency_key', gen_random_uuid()
  );
  contract_value := jsonb_build_object(
    'canonical_statement', repaired_payload ->> 'question',
    'timezone', 'UTC',
    'evaluation_at', repaired_payload ->> 'evaluation_ends_at',
    'provider', 'official_web',
    'provider_adapter_version', 'atinara-draft-repair-v7',
    'contract_schema_version', 'atinara-resolution-contract-v1',
    'policy_version', 'atinara-market-constitution-v1'
  );
  sources_value := jsonb_build_array(
    jsonb_build_object(
      'url', source_url, 'role', 'PRIMARY_RESOLUTION',
      'precedence', 1, 'required', true, 'fallback_condition', null
    ),
    jsonb_build_object(
      'url', 'https://corroboration.example.org/primary-' || fixture_suffix,
      'role', 'CORROBORATION', 'precedence', 2, 'required', false,
      'fallback_condition', 'Corroboración pública secundaria.'
    )
  );

  expected_failure := false;
  begin
    perform public.apply_market_draft_expert_repair_v2(
      draft_id_value, draft_version_value, repaired_payload, contract_value,
      sources_value, gen_random_uuid(), jsonb_build_object('idempotency_key', gen_random_uuid())
    );
  exception when sqlstate '22023' then
    if sqlerrm <> 'PRIMARY_SOURCE_CHECK_REQUIRED' then raise; end if;
    expected_failure := true;
  end;
  if not expected_failure then raise exception 'TEST_APPLY_WITHOUT_CHECK_ACCEPTED'; end if;

  expected_failure := false;
  begin
    perform public.apply_market_draft_expert_repair_v2(
      draft_id_value, draft_version_value, repaired_payload, contract_value,
      sources_value, expired_check_id,
      jsonb_build_object('idempotency_key', gen_random_uuid())
    );
  exception when sqlstate '22023' then
    if sqlerrm <> 'PRIMARY_SOURCE_CHECK_REQUIRED' then raise; end if;
    expected_failure := true;
  end;
  if not expected_failure then raise exception 'TEST_EXPIRED_PRIMARY_CHECK_ACCEPTED'; end if;

  expected_failure := false;
  begin
    perform public.apply_market_draft_expert_repair_v2(
      draft_id_value, draft_version_value,
      jsonb_set(repaired_payload, '{primary_source,registry_domain}', '"malicious.example"'::jsonb),
      contract_value, sources_value, check_id_value,
      jsonb_build_object('idempotency_key', gen_random_uuid())
    );
  exception when sqlstate '22023' then
    if sqlerrm <> 'REPAIR_PRIMARY_SOURCE_CHECK_MISMATCH' then raise; end if;
    expected_failure := true;
  end;
  if not expected_failure then raise exception 'TEST_APPLY_TAMPERED_PRIMARY_ACCEPTED'; end if;

  applied := public.apply_market_draft_expert_repair_v2(
    draft_id_value, draft_version_value, repaired_payload, contract_value,
    sources_value, check_id_value,
    jsonb_build_object(
      'idempotency_key', gen_random_uuid(),
      'repair_policy', 'atinara-draft-repair-v7',
      'changed_fields', '["subject","primary_source"]'::jsonb,
      'repair_round', 1,
      'archetype', 'product_release'
    )
  );
  if not coalesce((applied ->> 'repair_applied')::boolean, false)
     or (applied ->> 'primary_source_check_id')::uuid is distinct from check_id_value
     or (applied ->> 'primary_source_registry_id')::uuid is distinct from registry_id_value
     or (applied ->> 'new_version')::bigint <= draft_version_value then
    raise exception 'TEST_VALID_PRIMARY_APPLY_FAILED: %', applied;
  end if;
  if not exists (
    select 1 from private.market_admin_audit audit
    where audit.draft_id = draft_id_value
      and audit.action_code = 'MARKET_DRAFT_PRIMARY_SOURCE_CHECK_BOUND'
      and (audit.detail ->> 'source_check_id')::uuid = check_id_value
      and (audit.detail ->> 'registry_source_id')::uuid = registry_id_value
      and coalesce((audit.detail ->> 'publishes')::boolean, true) = false
      and coalesce((audit.detail ->> 'confirms')::boolean, true) = false
      and coalesce((audit.detail ->> 'resolves')::boolean, true) = false
  ) then
    raise exception 'TEST_PRIMARY_AUDIT_BINDING_MISSING';
  end if;
  if (select count(*) from public.markets) is distinct from market_count_before
     or (select count(*) from public.predictions) is distinct from prediction_count_before
     or exists (
       select 1 from private.market_drafts draft_alias
       where draft_alias.id = draft_id_value
         and draft_alias.workflow_status in (
           'published', 'human_confirmed', 'scheduled', 'pending_resolution',
           'resolved', 'annulled', 'early_closed'
         )
     ) then
    raise exception 'TEST_PRIMARY_REPAIR_TOUCHED_PUBLICATION_OR_ECONOMY';
  end if;
end;
$test$;

-- Prueba real de ACL: el rol de servicio no puede fabricar catálogo/checks ni
-- invocar la firma histórica, aunque sí conozca los nombres de las tablas.
set local role service_role;
do $acl$
declare
  blocked boolean;
begin
  blocked := false;
  begin
    execute 'update private.market_source_registry set active = active where false';
  exception when insufficient_privilege then blocked := true;
  end;
  if not blocked then raise exception 'TEST_SERVICE_RAW_REGISTRY_UPDATE_SUCCEEDED'; end if;

  blocked := false;
  begin
    perform public.list_market_authoritative_source_registry_admin_v1();
  exception when insufficient_privilege then blocked := true;
  end;
  if not blocked then raise exception 'TEST_SERVICE_REGISTRY_ADMIN_RPC_SUCCEEDED'; end if;

  blocked := false;
  begin
    execute 'insert into private.market_draft_primary_source_checks(draft_id,draft_version,registry_source_id,requested_url,final_url,draft_category,validation_version,evidence_snapshot) values (gen_random_uuid(),1,gen_random_uuid(),''https://example.com/a'',''https://example.com/a'',''Eventos'',''atinara-primary-source-validation-v1'',''{}''::jsonb)';
  exception when insufficient_privilege then blocked := true;
  end;
  if not blocked then raise exception 'TEST_SERVICE_RAW_CHECK_INSERT_SUCCEEDED'; end if;

  blocked := false;
  begin
    perform public.apply_market_draft_expert_repair(
      gen_random_uuid(), 1, '{}'::jsonb, '{}'::jsonb, '[]'::jsonb, '{}'::jsonb
    );
  exception when insufficient_privilege then blocked := true;
  end;
  if not blocked then raise exception 'TEST_SERVICE_LEGACY_APPLY_SUCCEEDED'; end if;
end;
$acl$;
reset role;

rollback;
