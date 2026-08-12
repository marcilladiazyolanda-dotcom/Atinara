import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(import.meta.dirname, "..");
const testRoot = join(root, "supabase", "tests");
const required = [
  "radar_eligibility_v7_transaction.sql",
  "agent_engine_confirmation_v8_transaction.sql",
  "radar_eligibility_rls_v12_transaction.sql",
  "ai_gateway_budget_telemetry_transaction.sql",
  "agent_engine_v2_transaction.sql",
];
const execute = process.argv.includes("--execute");
const v2Only = process.argv.includes("--v2-only");
const executable = v2Only ? required.slice(-3) : required;

for (const name of required) {
  const file = join(testRoot, name);
  if (!existsSync(file)) throw new Error(`SQL_TRANSACTION_TEST_MISSING:${name}`);
  const sql = readFileSync(file, "utf8");
  if (!/^\s*(?:--[^\n]*\n\s*)*begin\s*;/i.test(sql) || !/rollback\s*;\s*$/i.test(sql)) {
    throw new Error(`SQL_TRANSACTION_BOUNDARY_INVALID:${name}`);
  }
  if (/\bcommit\s*;/i.test(sql)) throw new Error(`SQL_TRANSACTION_COMMIT_FORBIDDEN:${name}`);
}

if (!execute) {
  process.stdout.write(`SQL_TRANSACTION_STATIC_OK ${required.length}\n`);
  process.stdout.write("SQL_TRANSACTION_EXECUTION_SKIPPED use --execute with ATINARA_TEST_DATABASE_URL\n");
  process.exit(0);
}

const databaseUrl = process.env.ATINARA_TEST_DATABASE_URL || "";
if (!/^postgres(?:ql)?:\/\//i.test(databaseUrl)) throw new Error("ATINARA_TEST_DATABASE_URL_REQUIRED");
const psql = process.env.PSQL_BIN || (process.platform === "win32" ? "psql.exe" : "psql");
for (const name of executable) {
  const result = spawnSync(psql, [databaseUrl, "--no-psqlrc", "--set=ON_ERROR_STOP=1", `--file=${join(testRoot, name)}`], {
    cwd: root,
    env: process.env,
    encoding: "utf8",
    stdio: "pipe",
  });
  if (result.status !== 0) {
    process.stderr.write(result.stdout || "");
    process.stderr.write(result.stderr || "");
    throw new Error(`SQL_TRANSACTION_EXECUTION_FAILED:${name}`);
  }
  process.stdout.write(`SQL_TRANSACTION_OK ${name}\n`);
}
