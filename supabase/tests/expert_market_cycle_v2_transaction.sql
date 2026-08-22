-- Ejecutar después de V6; las primitivas históricas solo permanecen internas.
-- Todo el ejercicio se revierte: no publica, confirma, modifica mercados ni economía.
begin;

set local lock_timeout = '5s';
set local statement_timeout = '90s';

do $test$
declare
  admin_id_value uuid;
  draft_row record;
  context_value jsonb;
  attempt_key uuid := gen_random_uuid();
  first_attempt jsonb;
  replay_attempt jsonb;
  completed_attempt jsonb;
  moved_version_replay jsonb;
  provider_result jsonb;
  provider_row record;
  repaired_family_metadata jsonb;
begin
  if to_regclass('private.market_issue_strategy_registry') is null
     or to_regclass('private.market_repair_attempts') is null then
    raise exception 'EXPERT_MARKET_CYCLE_V2_SCHEMA_REQUIRED';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_class relation
    join pg_catalog.pg_namespace namespace_row on namespace_row.oid = relation.relnamespace
    where namespace_row.nspname = 'private'
      and relation.relname in ('market_issue_strategy_registry', 'market_repair_attempts')
      and relation.relrowsecurity
      and relation.relforcerowsecurity
    group by namespace_row.nspname
    having count(*) = 2
  ) then
    raise exception 'EXPERT_MARKET_CYCLE_V2_RLS_NOT_FORCED';
  end if;

  if has_function_privilege('anon', 'public.begin_market_draft_repair_attempt_v1(uuid,bigint,uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.begin_market_draft_repair_attempt_v1(uuid,bigint,uuid)', 'execute')
     or has_function_privilege('anon', 'public.begin_market_draft_repair_workflow_v1(uuid,bigint,uuid)', 'execute')
     or not has_function_privilege('authenticated', 'public.begin_market_draft_repair_workflow_v1(uuid,bigint,uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.get_market_draft_primary_source_attestation_v1(uuid,bigint)', 'execute')
     or not has_function_privilege('service_role', 'public.get_market_draft_primary_source_attestation_v1(uuid,bigint)', 'execute')
     or has_function_privilege('authenticated', 'public.get_market_draft_bound_context_attestation_v1(uuid,bigint)', 'execute')
     or not has_function_privilege('service_role', 'public.get_market_draft_bound_context_attestation_v1(uuid,bigint)', 'execute')
     or has_function_privilege('anon', 'public.materialize_market_draft_for_repair_v1(uuid,bigint,uuid,jsonb)', 'execute')
     or not has_function_privilege('authenticated', 'public.materialize_market_draft_for_repair_v1(uuid,bigint,uuid,jsonb)', 'execute') then
    raise exception 'EXPERT_MARKET_CYCLE_V2_PRIVILEGE_MISMATCH';
  end if;

  if (select count(*) from private.market_issue_strategy_registry where active) < 60
     or not exists (
       select 1 from private.market_issue_strategy_registry
       where code = 'RESOLUTION_DEADLINE_INVALID'
         and disposition = 'auto_repair'
         and strategy_key = 'derive_resolution_deadline'
     )
     or not exists (
       select 1 from private.market_issue_strategy_registry
       where code = 'EVENT_ALREADY_RESOLVED' and disposition = 'terminal_block'
     )
     or not exists (
       select 1 from private.market_issue_strategy_registry
       where code = 'CONFLICTING_AUTHORITATIVE_SOURCES' and disposition = 'human_decision'
     ) then
    raise exception 'EXPERT_MARKET_CYCLE_V2_TAXONOMY_INCOMPLETE';
  end if;

  -- Un proveedor sano con cinco descartes sigue operacionalmente disponible.
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  provider_result := public.finalize_market_radar_provider_refresh_v2(
    'polymarket', 'expert-cycle-v2-transaction', 'available',
    10, 5, 5, 5, 0, null, null, null
  );
  select status, accepted_count, discarded_count, quarantined_count, error_code
  into provider_row
  from private.market_radar_provider_runs
  where provider = 'polymarket' and cache_key = 'expert-cycle-v2-transaction';
  if provider_row.status <> 'available'
     or provider_row.accepted_count <> 5
     or provider_row.discarded_count <> 5
     or provider_row.quarantined_count <> 5
     or provider_row.error_code is not null
     or provider_result ->> 'operational_status' is distinct from 'available' then
    raise exception 'HEALTHY_PROVIDER_FALSE_INCIDENT';
  end if;

  -- El instante sigue almacenado en UTC, pero el texto contractual declara
  -- una sola zona IANA. Así el clasificador no confunde dos representaciones
  -- del mismo instante con dos contratos temporales alternativos.
  repaired_family_metadata := private.market_family_metadata_v4(
    '¿Superará una métrica objetiva el umbral de 95 en el instante aprobado?',
    null,
    'Producto de prueba',
    'fixture:metric-threshold',
    '2026-08-13T14:00:00Z'::timestamptz,
    'Europe/Madrid',
    'Se observa exactamente el 13 de agosto de 2026 a las 16:00 (Europe/Madrid).',
    null
  );
  if coalesce((repaired_family_metadata #>> '{family_semantics,identity_ambiguous}')::boolean, false)
     or repaired_family_metadata #>> '{family_semantics,temporal_boundary,canonical_instant}'
       is distinct from '2026-08-13T14:00:00.000Z' then
    raise exception 'REPAIR_TEXT_CREATED_FALSE_TEMPORAL_AMBIGUITY';
  end if;

  select id into admin_id_value
  from auth.users
  where coalesce((raw_app_meta_data ->> 'oraklo_admin')::boolean, false)
  order by created_at
  limit 1;
  if admin_id_value is null then
    raise exception 'ADMIN_FIXTURE_REQUIRED';
  end if;
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('role', 'authenticated', 'sub', admin_id_value)::text,
    true
  );

  -- En producción usa la fixture Marvel ya reparada; en una base limpia toma
  -- cualquier borrador privado. La precondición no depende de conservar el
  -- fallo original: el intento idempotente debe funcionar en cada ronda.
  select draft_alias.id, draft_alias.content_version, draft_alias.content_fingerprint
  into draft_row
  from private.market_drafts draft_alias
  where draft_alias.published_at is null
  order by (draft_alias.question ilike '%Marvel Tokon%') desc,
    (draft_alias.review_status in ('rejected', 'inconclusive')) desc,
    draft_alias.updated_at desc
  limit 1;

  if draft_row.id is not null then
    context_value := public.get_market_draft_expert_repair_context(draft_row.id);
    if jsonb_typeof(context_value) is distinct from 'object'
       or context_value #>> '{draft,id}' is distinct from draft_row.id::text then
      raise exception 'REPAIR_CONTEXT_NOT_AUTHORITATIVE';
    end if;

    first_attempt := public.begin_market_draft_repair_workflow_v1(
      draft_row.id, draft_row.content_version, attempt_key
    );
    replay_attempt := public.begin_market_draft_repair_workflow_v1(
      draft_row.id, draft_row.content_version, attempt_key
    );
    if first_attempt ->> 'status' <> 'started'
       or replay_attempt ->> 'status' <> 'already_in_progress'
       or coalesce((replay_attempt ->> 'idempotency_replay')::boolean, false) is not true
       or first_attempt ->> 'attempt_id' <> replay_attempt ->> 'attempt_id' then
      raise exception 'REPAIR_ATTEMPT_NOT_IDEMPOTENT';
    end if;

    begin
      perform public.begin_market_draft_repair_workflow_v1(
        draft_row.id, draft_row.content_version + 1, gen_random_uuid()
      );
      raise exception 'STALE_REPAIR_VERSION_ACCEPTED';
    exception when serialization_failure then
      null;
    end;

    if exists (
      select 1 from private.market_drafts current_draft
      where current_draft.id = draft_row.id
        and (
          current_draft.content_version is distinct from draft_row.content_version
          or current_draft.content_fingerprint is distinct from draft_row.content_fingerprint
        )
    ) then
      raise exception 'REPAIR_PREFLIGHT_MUTATED_DRAFT';
    end if;

    -- El resultado completado se reproduce por la misma clave aunque esa
    -- ejecucion haya avanzado el borrador. La mutacion de version es solo una
    -- simulacion transaccional y queda anulada por el rollback exterior.
    perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
    completed_attempt := public.complete_market_draft_repair_attempt_v1(
      (first_attempt ->> 'attempt_id')::uuid,
      'no_op',
      'complete',
      'content',
      false,
      null,
      null,
      draft_row.content_version,
      draft_row.content_fingerprint,
      jsonb_build_object(
        'ok', true,
        'status', 'no_op',
        'state_preserved', true,
        'publishes', false,
        'confirms', false,
        'resolves', false
      )
    );
    update private.market_drafts
    set content_version = content_version + 1
    where id = draft_row.id;
    perform set_config(
      'request.jwt.claims',
      jsonb_build_object('role', 'authenticated', 'sub', admin_id_value)::text,
      true
    );
    moved_version_replay := public.begin_market_draft_repair_workflow_v1(
      draft_row.id, draft_row.content_version, attempt_key
    );
    if completed_attempt ->> 'status' is distinct from 'no_op'
       or moved_version_replay ->> 'status' is distinct from 'no_op'
       or moved_version_replay ->> 'attempt_id' is distinct from first_attempt ->> 'attempt_id'
       or coalesce((moved_version_replay ->> 'idempotency_replay')::boolean, false) is not true then
      raise exception 'COMPLETED_REPAIR_REPLAY_FAILED_AFTER_VERSION_MOVE';
    end if;
  end if;
end;
$test$;

rollback;
