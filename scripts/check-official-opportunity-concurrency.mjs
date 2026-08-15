import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import {
  assertLocalPostgresTestConnection,
  localPostgresChildEnvironment,
} from "./local-postgres-test-guard.mjs";

const databaseUrl = process.env.ATINARA_TEST_DATABASE_URL || "";
if (!/^postgres(?:ql)?:\/\//i.test(databaseUrl)) {
  throw new Error("ATINARA_TEST_DATABASE_URL_REQUIRED");
}
assertLocalPostgresTestConnection(databaseUrl);
const postgresEnvironment = localPostgresChildEnvironment();

const psql = process.env.PSQL_BIN || (process.platform === "win32" ? "psql.exe" : "psql");
const requestId = randomUUID();
const leaseRequestId = randomUUID();
const requestedBy = randomUUID();
const requestFingerprint = "c".repeat(64);

function sqlString(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function runPsql(sql, { onOutput } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(psql, [
      databaseUrl,
      "--no-psqlrc",
      "--set=ON_ERROR_STOP=1",
      "--quiet",
      "--tuples-only",
      "--no-align",
      `--command=${sql}`,
    ], { env: postgresEnvironment, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      onOutput?.(stdout);
    });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`OFFICIAL_DISCOVERY_CONCURRENCY_PSQL_FAILED:${code}:${stderr.slice(0, 500)}`));
    });
  });
}

function runPsqlUntil(sql, marker) {
  let resolveReady;
  let rejectReady;
  let readySettled = false;
  const ready = new Promise((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  const completion = runPsql(sql, {
    onOutput(output) {
      if (!readySettled && output.includes(marker)) {
        readySettled = true;
        resolveReady();
      }
    },
  });
  completion.catch((error) => {
    if (!readySettled) {
      readySettled = true;
      rejectReady(error);
    }
  });
  return { ready, completion };
}

const claimSql = `
  select set_config('request.jwt.claims', '{"role":"service_role"}', false);
  set role service_role;
  select public.begin_official_opportunity_discovery_v2(
    ${sqlString(requestId)}::uuid,
    ${sqlString(requestFingerprint)},
    ${sqlString(requestedBy)}::uuid
  )::text;
`;
const firstSql = `begin; ${claimSql} select 'ATINARA_CLAIM_LOCKED'; select pg_sleep(1.5); commit;`;
const secondSql = `begin; ${claimSql} rollback;`;
const finishSql = `
  select set_config('request.jwt.claims', '{"role":"service_role"}', false);
  set role service_role;
  select public.finish_official_opportunity_discovery_v2(
    ${sqlString(requestId)}::uuid,
    ${sqlString(requestFingerprint)},
    ${sqlString(requestedBy)}::uuid,
    '[]'::jsonb,
    jsonb_build_object(
      'outcome', 'zero_results', 'error_code', null,
      'query_fingerprint', repeat('e', 64), 'search_results', 0,
      'inspected_documents', 0, 'structured_candidates', 0,
      'rejected_candidates', 0, 'source_error_count', 0,
      'source_error_codes', '{}'::jsonb,
      'provider_rate', '{"limit":null,"remaining":null,"reset":null}'::jsonb
    )
  )::text;
`;

let firstOutput = "";
let secondOutput = "";
try {
  const first = runPsqlUntil(firstSql, "ATINARA_CLAIM_LOCKED");
  await first.ready;
  const second = runPsql(secondSql);
  [firstOutput, secondOutput] = await Promise.all([first.completion, second]);
  if (!/"state"\s*:\s*"started"/.test(firstOutput)
      || !/"state"\s*:\s*"in_progress"/.test(secondOutput)) {
    throw new Error("OFFICIAL_DISCOVERY_CONCURRENCY_CLAIM_RESULT_INVALID");
  }
  const count = await runPsql(`
    select count(*) from private.data_provider_runs
    where provider = 'official_web'
      and action = 'discover_official_opportunities'
      and request_id = ${sqlString(requestId)}::uuid;
  `);
  if (Number(count.trim()) !== 1) throw new Error("OFFICIAL_DISCOVERY_CONCURRENCY_DUPLICATE_RUN");

  const firstFinish = runPsqlUntil(
    `begin; ${finishSql} select 'ATINARA_FINISH_LOCKED'; select pg_sleep(1.5); commit;`,
    "ATINARA_FINISH_LOCKED",
  );
  await firstFinish.ready;
  const secondFinish = runPsql(`begin; ${finishSql} rollback;`);
  const [firstFinishOutput, secondFinishOutput] = await Promise.all([firstFinish.completion, secondFinish]);
  if (!/"outcome"\s*:\s*"zero_results"/.test(firstFinishOutput)
      || !/"replayed"\s*:\s*false/.test(firstFinishOutput)
      || !/"outcome"\s*:\s*"zero_results"/.test(secondFinishOutput)
      || !/"replayed"\s*:\s*true/.test(secondFinishOutput)) {
    throw new Error("OFFICIAL_DISCOVERY_CONCURRENCY_FINISH_RESULT_INVALID");
  }
  const terminal = await runPsql(`
    select status || ':' || count(*)::text from private.data_provider_runs
    where provider = 'official_web'
      and action = 'discover_official_opportunities'
      and request_id = ${sqlString(requestId)}::uuid
    group by status;
  `);
  if (terminal.trim() !== "zero_results:1") throw new Error("OFFICIAL_DISCOVERY_CONCURRENCY_TERMINAL_ROW_INVALID");

  await runPsql(`
    select set_config('request.jwt.claims', '{"role":"service_role"}', false);
    set role service_role;
    select public.begin_official_opportunity_discovery_v2(
      ${sqlString(leaseRequestId)}::uuid,
      ${sqlString(requestFingerprint)},
      ${sqlString(requestedBy)}::uuid
    )::text;
  `);
  await runPsql(`
    update private.data_provider_runs
       set lease_expires_at = clock_timestamp() + interval '700 milliseconds'
     where provider = 'official_web'
       and action = 'discover_official_opportunities'
       and request_id = ${sqlString(leaseRequestId)}::uuid;
  `);
  const leaseLocker = runPsqlUntil(`
    begin;
    select id from private.data_provider_runs
     where provider = 'official_web'
       and action = 'discover_official_opportunities'
       and request_id = ${sqlString(leaseRequestId)}::uuid
     for update;
    select 'ATINARA_LEASE_LOCKED';
    select pg_sleep(1.5);
    rollback;
  `, "ATINARA_LEASE_LOCKED");
  await leaseLocker.ready;
  const lateFinish = runPsql(`
    select set_config('request.jwt.claims', '{"role":"service_role"}', false);
    set role service_role;
    select public.finish_official_opportunity_discovery_v2(
      ${sqlString(leaseRequestId)}::uuid,
      ${sqlString(requestFingerprint)},
      ${sqlString(requestedBy)}::uuid,
      '[]'::jsonb,
      jsonb_build_object(
        'outcome', 'zero_results', 'error_code', null,
        'query_fingerprint', repeat('e', 64), 'search_results', 0,
        'inspected_documents', 0, 'structured_candidates', 0,
        'rejected_candidates', 0, 'source_error_count', 0,
        'source_error_codes', '{}'::jsonb,
        'provider_rate', '{"limit":null,"remaining":null,"reset":null}'::jsonb
      )
    )::text;
  `);
  const [, lateFinishOutput] = await Promise.all([leaseLocker.completion, lateFinish]);
  if (!/"outcome"\s*:\s*"technical_failure"/.test(lateFinishOutput)
      || !/"error_code"\s*:\s*"OFFICIAL_DISCOVERY_REQUEST_INTERRUPTED"/.test(lateFinishOutput)
      || !/"replayed"\s*:\s*false/.test(lateFinishOutput)) {
    throw new Error("OFFICIAL_DISCOVERY_CONCURRENCY_WALL_CLOCK_LEASE_INVALID");
  }
  process.stdout.write("OFFICIAL_DISCOVERY_CONCURRENCY_OK started=1 in_progress=1 rows=1 finished=1 replayed=1 late_finish=interrupted\n");
} finally {
  await runPsql(`
    delete from private.data_provider_runs
    where provider = 'official_web'
      and action = 'discover_official_opportunities'
      and request_id in (${sqlString(requestId)}::uuid, ${sqlString(leaseRequestId)}::uuid);
  `).catch(() => undefined);
}
