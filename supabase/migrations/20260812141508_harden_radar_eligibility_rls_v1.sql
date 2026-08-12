-- Harden the append-only Radar eligibility ledgers without changing their
-- writer path. The verified v1/v2 public RPCs are SECURITY DEFINER functions
-- owned by postgres; direct API grants were already absent in v7.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';

alter table private.market_radar_eligibility_checks enable row level security;
alter table private.market_radar_eligibility_checks force row level security;
alter table private.market_radar_eligibility_attempts enable row level security;
alter table private.market_radar_eligibility_attempts force row level security;

revoke all privileges on table private.market_radar_eligibility_checks
  from public, anon, authenticated, service_role;
revoke all privileges on sequence private.market_radar_eligibility_checks_id_seq
  from public, anon, authenticated, service_role;
revoke all privileges on table private.market_radar_eligibility_attempts
  from public, anon, authenticated, service_role;
revoke all privileges on sequence private.market_radar_eligibility_attempts_id_seq
  from public, anon, authenticated, service_role;

do $assertions$
declare
  table_name text;
begin
  foreach table_name in array array[
    'market_radar_eligibility_checks',
    'market_radar_eligibility_attempts'
  ] loop
    if not exists (
      select 1
      from pg_class relation
      join pg_namespace namespace on namespace.oid = relation.relnamespace
      where namespace.nspname = 'private'
        and relation.relname = table_name
        and relation.relrowsecurity
        and relation.relforcerowsecurity
    ) then
      raise exception 'RADAR_ELIGIBILITY_RLS_NOT_FORCED:%', table_name;
    end if;
  end loop;

  if has_table_privilege('anon', 'private.market_radar_eligibility_checks', 'SELECT')
     or has_table_privilege('authenticated', 'private.market_radar_eligibility_checks', 'SELECT')
     or has_table_privilege('service_role', 'private.market_radar_eligibility_checks', 'SELECT')
     or has_table_privilege('anon', 'private.market_radar_eligibility_attempts', 'SELECT')
     or has_table_privilege('authenticated', 'private.market_radar_eligibility_attempts', 'SELECT')
     or has_table_privilege('service_role', 'private.market_radar_eligibility_attempts', 'SELECT') then
    raise exception 'RADAR_ELIGIBILITY_DIRECT_GRANT_REGRESSION';
  end if;
end;
$assertions$;

comment on table private.market_radar_eligibility_checks is
  'Ledger append-only de decisiones de elegibilidad Radar. RLS forzada y acceso exclusivo mediante RPC estrechas v1/v2.';
comment on table private.market_radar_eligibility_attempts is
  'Ledger append-only de fallos técnicos de elegibilidad Radar. RLS forzada y acceso exclusivo mediante RPC estrechas v1/v2.';

commit;
