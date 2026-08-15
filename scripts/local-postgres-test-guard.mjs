const LOCAL_POSTGRES_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);
const LIBPQ_ROUTING_PARAMETERS = new Set(["host", "hostaddr", "service", "servicefile"]);
const SAFE_PG_ENVIRONMENT_KEYS = new Set(["PGPASSWORD", "PGCONNECT_TIMEOUT"]);

function normalizedHostname(value) {
  return String(value || "").trim().toLowerCase().replace(/^\[|\]$/g, "");
}

export function assertLocalPostgresTestConnection(databaseUrl, environment = process.env) {
  if (!/^postgres(?:ql)?:\/\//i.test(String(databaseUrl || ""))) {
    throw new Error("ATINARA_TEST_DATABASE_URL_REQUIRED");
  }
  const parsed = new URL(databaseUrl);
  if (!LOCAL_POSTGRES_HOSTS.has(normalizedHostname(parsed.hostname)) || parsed.hash) {
    throw new Error("ATINARA_TEST_LOCAL_DATABASE_REQUIRED");
  }
  for (const key of parsed.searchParams.keys()) {
    if (LIBPQ_ROUTING_PARAMETERS.has(key.toLowerCase())) {
      throw new Error("ATINARA_TEST_DATABASE_ROUTING_PARAMETER_FORBIDDEN");
    }
  }
  for (const key of Object.keys(environment || {})) {
    if (/^(?:PGHOST|PGHOSTADDR|PGSERVICE|PGSERVICEFILE)$/i.test(key)
        && String(environment[key] || "").trim()) {
      throw new Error("ATINARA_TEST_DATABASE_ROUTING_ENV_FORBIDDEN");
    }
  }
  return parsed;
}

export function localPostgresChildEnvironment(environment = process.env) {
  const safe = {};
  for (const [key, value] of Object.entries(environment || {})) {
    if (!/^PG/i.test(key) || SAFE_PG_ENVIRONMENT_KEYS.has(key.toUpperCase())) {
      safe[key] = value;
    }
  }
  safe.PGAPPNAME = "atinara-local-transaction-tests";
  return safe;
}
