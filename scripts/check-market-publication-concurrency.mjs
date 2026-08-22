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
  throw new Error("MARKET_PUBLICATION_CONCURRENCY_SOURCE_DATABASE_INVALID");
}

const disposableDatabaseName = `atinara_publication_concurrency_${randomUUID().replaceAll("-", "")}`;
const adminUrl = new URL(sourceUrl);
adminUrl.pathname = "/postgres";
const disposableUrl = new URL(sourceUrl);
disposableUrl.pathname = `/${disposableDatabaseName}`;
const databaseUrl = disposableUrl.toString();
const requestId = randomUUID();
const slug = `publication-concurrency-${randomUUID().replaceAll("-", "").slice(0, 16)}`;
let disposableCreated = false;

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
      else reject(new Error(`MARKET_PUBLICATION_CONCURRENCY_PSQL_FAILED:${code}:${stderr.slice(0, 800)}`));
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

async function waitForPsqlValue(sql, expected, attempts = 40) {
  for (let index = 0; index < attempts; index += 1) {
    if ((await runPsql(sql)).trim() === expected) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`MARKET_PUBLICATION_CONCURRENCY_STATE_TIMEOUT:${expected}`);
}

function adminClaims(adminId) {
  return `select set_config('request.jwt.claims', ${sqlString(JSON.stringify({
    sub: adminId,
    role: "authenticated",
  }))}, false); set role authenticated;`;
}

try {
  await runPsqlAt(adminUrl.toString(), `create database "${disposableDatabaseName}" template "${sourceDatabaseName}";`);
  disposableCreated = true;
  const setup = await runPsql(`do $setup$
  declare
    admin_id uuid;
    registry_id uuid;
    payload jsonb;
    saved jsonb;
    draft_row private.market_drafts%rowtype;
    review_begin jsonb;
    source_check_id uuid;
    confirmation jsonb;
  begin
    select id into admin_id from auth.users
    where coalesce((raw_app_meta_data ->> 'oraklo_admin')::boolean,false)
    order by created_at limit 1;
    if admin_id is null then raise exception 'ADMIN_FIXTURE_REQUIRED'; end if;
    select id into registry_id from private.market_source_registry
    where canonical_domain='thegameawards.com' and active and authority_tier='primary'
    order by id limit 1;
    if registry_id is null then raise exception 'SOURCE_REGISTRY_FIXTURE_REQUIRED'; end if;
    payload:=jsonb_build_object(
      'market_slug',${sqlString(slug)},
      'question',U&'\\00BFGanar\\00E1 Aurora el premio de prueba de concurrencia?',
      'subject','Aurora','category','Reviews/Premios','yes_option',U&'S\\00ED','no_option','No',
      'evaluation_period_label','Hasta el 30 de diciembre de 2099 a las 23:59:59 UTC, inclusive',
      'evaluation_ends_at','2099-12-30T23:59:59.000Z','timezone','UTC',
      'resolution_deadline','2100-01-02T23:59:59.000Z',
      'yes_criteria',U&'S\\00ED si Aurora gana oficialmente el premio de prueba.',
      'no_criteria','No si Aurora no gana oficialmente el premio de prueba.',
      'edge_cases','Los retrasos se trataran segun la fuente oficial.',
      'public_criteria','Se resolvera con el resultado oficial.',
      'description','Fixture privada de concurrencia de publicacion.',
      'primary_source',jsonb_build_object(
        'url','https://thegameawards.com/','role','PRIMARY_RESOLUTION',
        'registry_source_id',registry_id,'registry_role','primary_resolution',
        'validation_version','atinara-primary-source-validation-v1',
        'registry_role_verified',true,'validated_reachable',true,
        'authority_verified',true,'relevance_verified',true
      ),'alternative_sources',jsonb_build_array(jsonb_build_object(
        'url','https://www.youtube.com/@thegameawards','role','CORROBORATION'
      )),
      '_idempotency_key',gen_random_uuid(),'_change_origin','publication_concurrency_fixture',
      '_timestamp_precision','milliseconds-v1'
    );
    perform set_config('request.jwt.claims',jsonb_build_object(
      'role','authenticated','sub',admin_id)::text,true);
    execute 'set local role authenticated';
    saved:=public.save_market_draft(null,null,payload);
    execute 'reset role';
    select * into draft_row from private.market_drafts
    where id=(saved #>> '{draft,id}')::uuid;
    perform set_config('request.jwt.claims',jsonb_build_object(
      'role','authenticated','sub',admin_id)::text,true);
    execute 'set local role authenticated';
    review_begin:=public.begin_market_draft_review_v2(
      draft_row.id,draft_row.content_version,gen_random_uuid(),
      'atinara-market-gate-v3','atinara-market-review-policy-v3',
      'atinara-market-draft-schema-v3',true
    );
    execute 'reset role';
    insert into private.market_draft_primary_source_checks(
      draft_id,draft_version,registry_source_id,requested_url,final_url,draft_category,
      registry_role,validation_version,evidence_snapshot,checked_at,expires_at
    ) values (
      draft_row.id,draft_row.content_version,registry_id,
      draft_row.primary_source ->> 'url',draft_row.primary_source ->> 'url',draft_row.category,
      'primary_resolution','atinara-primary-source-validation-v1',jsonb_build_object(
        'excerpt_sha256',repeat('9',64),'matched_tokens',jsonb_build_array('aurora','premio'),
        'accepted',true,'validated_reachable',true,'authority_verified',true,'relevance_verified',true
      ),clock_timestamp(),clock_timestamp()+interval '10 minutes'
    ) returning id into source_check_id;
    perform set_config('request.jwt.claims','{"role":"service_role"}',true);
    execute 'set local role service_role';
    perform public.record_market_draft_review_with_issues_v1(
      (review_begin ->> 'attempt_id')::uuid,'approved','[]'::jsonb,'[]'::jsonb,
      admin_id,null,jsonb_build_object('primary_source_check_id',source_check_id),'[]'::jsonb
    );
    execute 'reset role';
    select * into draft_row from private.market_drafts where id=draft_row.id;
    perform set_config('request.jwt.claims',jsonb_build_object(
      'role','authenticated','sub',admin_id)::text,true);
    execute 'set local role authenticated';
    confirmation:=public.confirm_market_draft_review_v2(draft_row.id,draft_row.content_version);
    execute 'reset role';
    if confirmation ->> 'ok'<>'true' then
      raise exception 'PUBLICATION_CONCURRENCY_CONFIRMATION_INVALID:%',confirmation;
    end if;
  end;
  $setup$;
  select (select id from auth.users where coalesce((raw_app_meta_data ->> 'oraklo_admin')::boolean,false)
    order by created_at limit 1)::text||'|'||draft.id::text||'|'||draft.content_version::text
  from private.market_drafts draft where draft.market_slug=${sqlString(slug)};`);
  const [adminId, draftId, versionText] = setup.trim().split("|");
  const version = Number(versionText);
  if (!/^[0-9a-f-]{36}$/i.test(adminId) || !/^[0-9a-f-]{36}$/i.test(draftId)
    || !Number.isSafeInteger(version) || version < 1) {
    throw new Error(`MARKET_PUBLICATION_CONCURRENCY_SETUP_INVALID:${setup.trim()}`);
  }
  const technicalIssueId = (await runPsql(`select private.record_market_workflow_issue_v1(
    'market_draft',${sqlString(draftId)},${sqlString(String(version))},
    (select content_fingerprint from private.market_drafts where id=${sqlString(draftId)}::uuid),
    private.publication_issue_v1(
      ${sqlString(draftId)}::uuid,${version},'PUBLICATION_TECHNICAL_FAILURE'
    ),null,null
  )::text;`)).trim();
  if (!/^[0-9a-f-]{36}$/i.test(technicalIssueId)) {
    throw new Error(`MARKET_PUBLICATION_TECHNICAL_ISSUE_SETUP_INVALID:${technicalIssueId}`);
  }
  const lockApplicationName = `atinara_source_lock_${randomUUID().replaceAll("-", "")}`;
  const draftLockCompletion = runPsql(
    `begin; set application_name=${sqlString(lockApplicationName)};
      select id from private.market_drafts where id=${sqlString(draftId)}::uuid for update;
      select pg_sleep(3); rollback;`,
  );
  await waitForPsqlValue(`select count(*) from pg_stat_activity
    where application_name=${sqlString(lockApplicationName)} and wait_event='PgSleep';`,"1");
  const sourceCheckSerialized = await runPsql(`set lock_timeout='500ms';
    insert into private.market_draft_primary_source_checks(
      draft_id,draft_version,registry_source_id,requested_url,final_url,draft_category,
      registry_role,validation_version,evidence_snapshot,checked_at,expires_at
    ) select source_check.draft_id,source_check.draft_version,source_check.registry_source_id,
      source_check.requested_url,source_check.final_url,source_check.draft_category,
      source_check.registry_role,source_check.validation_version,source_check.evidence_snapshot,
      clock_timestamp(),clock_timestamp()+interval '10 minutes'
    from private.market_draft_primary_source_checks source_check
    where source_check.draft_id=${sqlString(draftId)}::uuid
    order by source_check.checked_at desc,source_check.id desc limit 1;`
  ).then(() => false).catch((error) => {
    if (!/lock timeout|canceling statement due to lock timeout/i.test(String(error?.message))) throw error;
    return true;
  });
  await draftLockCompletion;
  if (sourceCheckSerialized !== true) {
    throw new Error("MARKET_PUBLICATION_SOURCE_CHECK_NOT_SERIALIZED");
  }
  const publishSql = `${adminClaims(adminId)} select public.publish_market_draft_v2(
    ${sqlString(draftId)}::uuid,${version},null,${sqlString(requestId)}::uuid
  )::text;`;
  const first = runPsqlUntil(
    `begin; ${publishSql} select 'ATINARA_PUBLICATION_LOCKED'; select pg_sleep(1.5); commit;`,
    "ATINARA_PUBLICATION_LOCKED",
  );
  await first.ready;
  const second = runPsql(`begin; ${publishSql} commit;`);
  const [firstOutput, secondOutput] = await Promise.all([first.completion,second]);
  if (!/"idempotency_replay"\s*:\s*false/.test(firstOutput)
      || !/"idempotency_replay"\s*:\s*true/.test(secondOutput)
      || sourceCheckSerialized !== true) {
    throw new Error(`MARKET_PUBLICATION_CONCURRENT_REPLAY_INVALID:${firstOutput}:${secondOutput}`);
  }
  const counts = (await runPsql(`select
    (select count(*) from private.market_publication_attempts_v1 where id=${sqlString(requestId)}::uuid)::text||'|'||
    (select count(*) from public.markets market where market.id=${sqlString(slug)})::text||'|'||
    (select count(*) from private.market_drafts draft where draft.id=${sqlString(draftId)}::uuid
      and draft.workflow_status='published')::text||'|'||
    (select count(*) from private.market_workflow_issue_occurrences_v1 occurrence
      left join lateral (select event.new_status from private.market_workflow_issue_events_v1 event
        where event.issue_id=occurrence.issue_id order by event.occurred_at desc,event.id desc limit 1) latest on true
      where occurrence.issue_id=${sqlString(technicalIssueId)}::uuid
        and latest.new_status='resolved')::text;`)).trim();
  if (counts !== "1|1|1|1") throw new Error(`MARKET_PUBLICATION_CONCURRENT_EFFECT_DUPLICATED:${counts}`);
  process.stdout.write("MARKET_PUBLICATION_CONCURRENCY_OK attempts=1 markets=1 published_drafts=1 replayed=1 source_checks_serialized=1 technical_retry_resolved=1 disposable_database=1\n");
} finally {
  if (disposableCreated) {
    await runPsqlAt(adminUrl.toString(), `select pg_terminate_backend(pid) from pg_stat_activity
      where datname=${sqlString(disposableDatabaseName)} and pid<>pg_backend_pid();`);
    await runPsqlAt(adminUrl.toString(), `drop database "${disposableDatabaseName}";`);
  }
}
