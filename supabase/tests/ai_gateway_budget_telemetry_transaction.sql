-- Atomic budget and append-only AI telemetry regression. All writes roll back.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $catalog$
declare
  relation_name text;
  role_name text;
  privilege_name text;
begin
  foreach relation_name in array array[
    'ai_task_runtime_settings', 'ai_provider_budget_limits', 'ai_provider_budget_days',
    'ai_provider_budget_reservations', 'ai_invocation_attempts', 'ai_retention_audit'
  ] loop
    if not exists (
      select 1 from pg_class relation join pg_namespace namespace on namespace.oid = relation.relnamespace
      where namespace.nspname = 'private' and relation.relname = relation_name
        and relation.relrowsecurity and relation.relforcerowsecurity
    ) then
      raise exception 'TEST_AI_GATEWAY_RLS_NOT_FORCED:%', relation_name;
    end if;
    foreach role_name in array array['anon', 'authenticated', 'service_role'] loop
      foreach privilege_name in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE'] loop
        if has_table_privilege(role_name, format('private.%I', relation_name), privilege_name) then
          raise exception 'TEST_AI_GATEWAY_DIRECT_ACL_PRESENT:%:%:%', relation_name, role_name, privilege_name;
        end if;
      end loop;
    end loop;
  end loop;
end;
$catalog$;

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;

do $service_paths$
declare
  invocation_prefix text := 'sql-v21-' || txid_current()::text;
  first_baseline jsonb;
  replay_baseline jsonb;
  exhausted jsonb;
  attempt jsonb;
begin
  if public.get_ai_task_runtime_mode_v1('market_draft_validation') ->> 'transport_mode' <> 'legacy_direct' then
    raise exception 'TEST_AI_GATEWAY_LEGACY_DEFAULT_MISSING';
  end if;

  first_baseline := public.reserve_ai_provider_budget_v1(
    invocation_prefix || '-baseline', 'gemini', 'market_draft_validation', 1, 'baseline_existing'
  );
  replay_baseline := public.reserve_ai_provider_budget_v1(
    invocation_prefix || '-baseline', 'gemini', 'market_draft_validation', 1, 'baseline_existing'
  );
  if first_baseline ->> 'status' <> 'reserved'
     or replay_baseline ->> 'status' <> 'reserved'
     or (replay_baseline ->> 'idempotent')::boolean is not true then
    raise exception 'TEST_AI_GATEWAY_BASELINE_IDEMPOTENCY_FAILED';
  end if;

  exhausted := public.reserve_ai_provider_budget_v1(
    invocation_prefix || '-openrouter', 'openrouter', 'market_draft_validation', 1, 'metered'
  );
  if exhausted ->> 'status' <> 'exhausted' or (exhausted ->> 'reserved')::boolean then
    raise exception 'TEST_AI_GATEWAY_ZERO_BUDGET_DID_NOT_FAIL_CLOSED';
  end if;

  attempt := public.record_ai_invocation_attempt_v1(
    invocation_prefix || '-telemetry', null, 'market_draft_validation',
    'atinara-ai-market-draft-validation-v1', 'atinara-market-review-policy-v3',
    'legacy_direct', 'gemini.legacy.validator', 'gemini', 'gemini-3.1-flash-lite',
    'private_market_minimized', repeat('a', 64), repeat('b', 64),
    '[{"state":"created","offsetMs":0,"sequence":1}]'::jsonb,
    'accepted', null, 0, 128, 25, null, null, null, false, false
  );
  if (attempt ->> 'idempotent')::boolean then
    raise exception 'TEST_AI_GATEWAY_FIRST_TELEMETRY_NOT_INSERTED';
  end if;
  attempt := public.record_ai_invocation_attempt_v1(
    invocation_prefix || '-telemetry', null, 'market_draft_validation',
    'atinara-ai-market-draft-validation-v1', 'atinara-market-review-policy-v3',
    'legacy_direct', 'gemini.legacy.validator', 'gemini', 'gemini-3.1-flash-lite',
    'private_market_minimized', repeat('a', 64), repeat('b', 64),
    '[{"state":"created","offsetMs":0,"sequence":1}]'::jsonb,
    'accepted', null, 0, 128, 25, null, null, null, false, false
  );
  if (attempt ->> 'idempotent')::boolean is not true then
    raise exception 'TEST_AI_GATEWAY_TELEMETRY_REPLAY_NOT_IDEMPOTENT';
  end if;
end;
$service_paths$;

reset role;

do $append_only$
begin
  begin
    update private.ai_invocation_attempts set duration_ms = duration_ms + 1;
    raise exception 'TEST_AI_GATEWAY_UPDATE_WAS_ALLOWED';
  exception when sqlstate '55000' then
    null;
  end;
end;
$append_only$;

rollback;
