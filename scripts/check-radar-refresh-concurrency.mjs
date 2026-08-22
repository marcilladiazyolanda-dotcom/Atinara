import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import {
  assertLocalPostgresTestConnection,
  localPostgresChildEnvironment,
} from "./local-postgres-test-guard.mjs";

const sourceDatabaseUrl = process.env.ATINARA_TEST_DATABASE_URL || "";
assertLocalPostgresTestConnection(sourceDatabaseUrl);
const postgresEnvironment = localPostgresChildEnvironment();
const psql = process.env.PSQL_BIN || (process.platform === "win32" ? "psql.exe" : "psql");
const sourceUrl = new URL(sourceDatabaseUrl);
const sourceDatabaseName = decodeURIComponent(sourceUrl.pathname.replace(/^\//, ""));
if (!/^[a-zA-Z0-9_]+$/.test(sourceDatabaseName) || sourceDatabaseName === "postgres") {
  throw new Error("RADAR_REFRESH_CONCURRENCY_SOURCE_DATABASE_INVALID");
}
const disposableDatabaseName = `atinara_radar_concurrency_${randomUUID().replaceAll("-", "")}`;
const adminUrl = new URL(sourceUrl);
adminUrl.pathname = "/postgres";
const disposableUrl = new URL(sourceUrl);
disposableUrl.pathname = `/${disposableDatabaseName}`;
let databaseUrl = disposableUrl.toString();
let disposableCreated = false;
const requestId = randomUUID();
const competingRequestId = randomUUID();
const firstProbeRequestId = randomUUID();
const secondProbeRequestId = randomUUID();
const firstOwner = randomUUID();
const secondOwner = randomUUID();
const cacheKey = `radar-concurrency:${randomUUID()}`;
const adminId = "11111111-1111-4111-8111-111111111111";

function sqlString(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function runPsqlAt(connectionUrl, sql, { onOutput } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(psql, [
      connectionUrl,
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
      else reject(new Error(`RADAR_REFRESH_CONCURRENCY_PSQL_FAILED:${code}:${stderr.slice(0, 600)}`));
    });
  });
}

function runPsql(sql, options = {}) {
  return runPsqlAt(databaseUrl, sql, options);
}

function runPsqlUntil(sql, marker) {
  let resolveReady;
  let rejectReady;
  let settled = false;
  const ready = new Promise((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  const completion = runPsql(sql, {
    onOutput(output) {
      if (!settled && output.includes(marker)) {
        settled = true;
        resolveReady();
      }
    },
  });
  completion.catch((error) => {
    if (!settled) {
      settled = true;
      rejectReady(error);
    }
  });
  return { ready, completion };
}

function adminClaims() {
  return `select set_config('request.jwt.claims', ${sqlString(JSON.stringify({ sub: adminId, role: "authenticated" }))}, false); set role authenticated;`;
}

function serviceClaims() {
  return `reset role; select set_config('request.jwt.claims', '{"role":"service_role"}', false); set role service_role;`;
}

function beginSql(request, owner, provider = "kalshi") {
  return `${adminClaims()} select public.begin_market_radar_refresh_v2(
    ${sqlString(request)}::uuid,${sqlString(provider)},'candidate_feed',repeat('a',64),
    ${sqlString(cacheKey)},'atinara-radar-v2','atinara-prediction-policy-v5',
    ${sqlString(owner)}::uuid
  )::text;`;
}

function claimProbeSql(request, provider = "kalshi") {
  return `${adminClaims()} select public.claim_market_radar_provider_probe_v1(
    ${sqlString(provider)},'candidate_feed',${sqlString(request)}::uuid
  )::text;`;
}

let firstOutput = "";
let secondOutput = "";
try {
  await runPsqlAt(adminUrl.toString(), `create database "${disposableDatabaseName}" template "${sourceDatabaseName}";`);
  disposableCreated = true;
  const initialProbe = await runPsql(claimProbeSql(requestId));
  if (!/"allowed"\s*:\s*true/.test(initialProbe)
      || !/"state"\s*:\s*"closed"/.test(initialProbe)) {
    throw new Error("RADAR_REFRESH_INITIAL_CIRCUIT_INVALID");
  }
  const first = runPsqlUntil(
    `begin; ${beginSql(requestId, firstOwner)} select 'ATINARA_RADAR_CLAIM_LOCKED'; select pg_sleep(1.5); commit;`,
    "ATINARA_RADAR_CLAIM_LOCKED",
  );
  await first.ready;
  const second = runPsql(`begin; ${beginSql(requestId, secondOwner)} rollback;`);
  [firstOutput, secondOutput] = await Promise.all([first.completion, second]);
  if (!/"started"\s*:\s*true/.test(firstOutput)
      || !/"in_progress"\s*:\s*true/.test(secondOutput)) {
    throw new Error("RADAR_REFRESH_CONCURRENT_BEGIN_INVALID");
  }
  const rowCount = Number((await runPsql(`select count(*) from private.market_radar_refresh_intents_v1
    where request_id=${sqlString(requestId)}::uuid and provider='kalshi' and capability='candidate_feed';`)).trim());
  if (rowCount !== 1) throw new Error("RADAR_REFRESH_CONCURRENT_BEGIN_DUPLICATED");
  const activeIntent = await runPsql(`${adminClaims()} select public.get_active_market_radar_refresh_v1(
    repeat('a',64),${sqlString(cacheKey)}
  )::text;`);
  if (!new RegExp(`"active"\\s*:\\s*true`).test(activeIntent)
      || !activeIntent.includes(requestId)) {
    throw new Error("RADAR_REFRESH_RELOAD_DISCOVERY_INVALID");
  }

  const competing = await runPsql(`begin; ${beginSql(competingRequestId, secondOwner)} rollback;`);
  if (!/"in_progress"\s*:\s*true/.test(competing)) {
    throw new Error("RADAR_REFRESH_CONCURRENT_PROVIDER_CLAIM_INVALID");
  }
  if (!competing.includes(requestId)) throw new Error("RADAR_REFRESH_CANONICAL_REQUEST_ID_MISSING");
  const polymarketProbe = await runPsql(claimProbeSql(requestId,"polymarket"));
  if (!/"allowed"\s*:\s*true/.test(polymarketProbe)) {
    throw new Error("RADAR_REFRESH_SECOND_PROVIDER_PROBE_INVALID");
  }
  const canonicalSecondProvider = await runPsql(`begin; ${beginSql(requestId,secondOwner,"polymarket")} commit;`);
  if (!/"started"\s*:\s*true/.test(canonicalSecondProvider)) {
    throw new Error("RADAR_REFRESH_SECOND_PROVIDER_CANONICAL_CLAIM_INVALID");
  }
  const splitCount = Number((await runPsql(`select count(*) from private.market_radar_refresh_intents_v1
    where request_id=${sqlString(competingRequestId)}::uuid;`)).trim());
  const canonicalProviderCount = Number((await runPsql(`select count(*) from private.market_radar_refresh_intents_v1
    where request_id=${sqlString(requestId)}::uuid and capability='candidate_feed';`)).trim());
  if (splitCount !== 0 || canonicalProviderCount !== 2) {
    throw new Error("RADAR_REFRESH_MULTI_PROVIDER_INTENT_SPLIT");
  }

  const leaseToken = (await runPsql(`select lease_token from private.market_radar_refresh_intents_v1
    where request_id=${sqlString(requestId)}::uuid and provider='kalshi' and capability='candidate_feed';`)).trim();
  if (!/^[0-9a-f-]{36}$/i.test(leaseToken)) throw new Error("RADAR_REFRESH_LEASE_TOKEN_MISSING");
  await runPsql(`${serviceClaims()} select public.declare_market_radar_refresh_manifest_v1(
    ${sqlString(requestId)}::uuid,'kalshi','candidate_feed',${sqlString(leaseToken)}::uuid,0
  )::text;`);
  await runPsql(`${serviceClaims()} select public.seal_market_radar_refresh_v1(
    ${sqlString(requestId)}::uuid,'kalshi','candidate_feed',${sqlString(leaseToken)}::uuid,0
  )::text;`);

  const finalizeSql = `${serviceClaims()} select public.finalize_market_radar_refresh_v3(
    ${sqlString(requestId)}::uuid,'kalshi','candidate_feed',${sqlString(leaseToken)}::uuid,
    'available',null,null,null
  )::text;`;
  const firstFinalize = runPsqlUntil(
    `begin; ${finalizeSql} select 'ATINARA_RADAR_FINALIZE_LOCKED'; select pg_sleep(1.5); commit;`,
    "ATINARA_RADAR_FINALIZE_LOCKED",
  );
  await firstFinalize.ready;
  const secondFinalize = runPsql(`begin; ${finalizeSql} rollback;`);
  const [firstFinalOutput, secondFinalOutput] = await Promise.all([
    firstFinalize.completion,
    secondFinalize,
  ]);
  if (!/"replayed"\s*:\s*false/.test(firstFinalOutput)
      || !/"replayed"\s*:\s*true/.test(secondFinalOutput)) {
    throw new Error("RADAR_REFRESH_CONCURRENT_FINALIZE_INVALID");
  }
  const historyCount = Number((await runPsql(`select count(*)
    from private.market_radar_provider_run_history
    where refresh_request_id=${sqlString(requestId)}::uuid and provider='kalshi'
      and capability='candidate_feed';`)).trim());
  if (historyCount !== 1) throw new Error("RADAR_REFRESH_CONCURRENT_HISTORY_DUPLICATED");

  await runPsql(`update private.market_radar_provider_circuits_v1 set
    state='open',consecutive_failures=1,next_probe_at=clock_timestamp()-interval '1 second',
    probe_request_id=null,probe_lease_token=null,probe_lease_expires_at=null,
    updated_at=clock_timestamp()
    where provider='kalshi' and capability='candidate_feed';`);
  const firstProbe = runPsqlUntil(
    `begin; ${claimProbeSql(firstProbeRequestId)} select 'ATINARA_RADAR_PROBE_LOCKED'; select pg_sleep(1.5); commit;`,
    "ATINARA_RADAR_PROBE_LOCKED",
  );
  await firstProbe.ready;
  const secondProbe = runPsql(`begin; ${claimProbeSql(secondProbeRequestId)} rollback;`);
  const [firstProbeOutput, secondProbeOutput] = await Promise.all([
    firstProbe.completion,
    secondProbe,
  ]);
  if (!/"allowed"\s*:\s*true/.test(firstProbeOutput)
      || !/"state"\s*:\s*"half_open"/.test(firstProbeOutput)
      || !/"allowed"\s*:\s*false/.test(secondProbeOutput)
      || !/"state"\s*:\s*"half_open"/.test(secondProbeOutput)) {
    throw new Error("RADAR_REFRESH_CONCURRENT_HALF_OPEN_PROBE_INVALID");
  }
  process.stdout.write("RADAR_REFRESH_CONCURRENCY_OK started=1 in_progress=1 intents=1 reload_resume=1 multi_provider_canonical=1 finalizations=1 replayed=1 half_open_winner=1 half_open_blocked=1 disposable_database=1\n");
} finally {
  if (disposableCreated) {
    await runPsqlAt(adminUrl.toString(), `select pg_terminate_backend(pid) from pg_stat_activity
      where datname=${sqlString(disposableDatabaseName)} and pid<>pg_backend_pid();`);
    await runPsqlAt(adminUrl.toString(), `drop database "${disposableDatabaseName}";`);
  }
}
