-- Regresión transaccional del timeout de actualización del Radar.
-- Se ejecuta solo contra una base local/de prueba y siempre termina en ROLLBACK.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '8s';

do $test$
declare
  contract_value jsonb;
  metadata_value jsonb;
  iteration integer;
begin
  if to_regprocedure('private.market_family_timezone_contract_v4(text,text)') is null
     or to_regprocedure('public.finalize_market_radar_provider_refresh_v1(text,text,text,integer,text,text)') is null then
    raise exception 'TEST_RADAR_REFRESH_TIMEOUT_FUNCTION_MISSING';
  end if;

  contract_value := private.market_family_timezone_contract_v4(
    null,
    'Resolves Yes if Xbox Series X/S and/or PlayStation receive the announced feature.'
  );
  if contract_value ->> 'id' <> 'UTC'
     or coalesce((contract_value ->> 'ambiguous')::boolean, false) then
    raise exception 'TEST_RADAR_ORDINARY_SLASH_MISCLASSIFIED: %', contract_value;
  end if;

  contract_value := private.market_family_timezone_contract_v4(
    null,
    'Deadline: America/New_York.'
  );
  if contract_value ->> 'id' <> 'America/New_York'
     or contract_value ->> 'mode' <> 'iana' then
    raise exception 'TEST_RADAR_IANA_ZONE_NOT_PRESERVED: %', contract_value;
  end if;

  contract_value := private.market_family_timezone_contract_v4('Europe/Madrid', null);
  if contract_value ->> 'id' <> 'Europe/Madrid'
     or contract_value ->> 'mode' <> 'iana' then
    raise exception 'TEST_RADAR_EXPLICIT_IANA_ZONE_NOT_PRESERVED: %', contract_value;
  end if;

  contract_value := private.market_family_timezone_contract_v4(null, 'Deadline at 10:00 ET.');
  if contract_value ->> 'id' <> 'America/New_York'
     or contract_value ->> 'mode' <> 'iana' then
    raise exception 'TEST_RADAR_TIMEZONE_ABBREVIATION_CHANGED: %', contract_value;
  end if;

  -- Con el parser anterior, estas barras ordinarias provocaban un recorrido de
  -- pg_timezone_names por candidata y este bloque superaba los ocho segundos.
  for iteration in 1..160 loop
    metadata_value := private.market_family_metadata_v4(
      'Will Xbox Series X/S receive feature ' || iteration::text || '?',
      'Xbox Series X/S feature ' || iteration::text,
      null,
      'radar-timeout-regression-' || iteration::text,
      null,
      null,
      'Resolves Yes if Xbox Series X/S and/or Windows receives the official feature.',
      null
    );
    if metadata_value ->> 'family_version' is distinct from 'atinara-market-family-v4' then
      raise exception 'TEST_RADAR_FAMILY_METADATA_REGRESSION: %', metadata_value;
    end if;
  end loop;

  if has_function_privilege('anon', 'public.finalize_market_radar_provider_refresh_v1(text,text,text,integer,text,text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.finalize_market_radar_provider_refresh_v1(text,text,text,integer,text,text)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.finalize_market_radar_provider_refresh_v1(text,text,text,integer,text,text)', 'EXECUTE') then
    raise exception 'TEST_RADAR_REFRESH_FINALIZER_PRIVILEGES_FAILED';
  end if;
end;
$test$;

rollback;
