const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const vm = require("node:vm");

const monitoring = require("../monitoring.js");

test("configura el DSN público europeo solo para el host de producción", () => {
  const source = readFileSync(join(__dirname, "..", "observability-config.js"), "utf8");
  const context = { window: {} };

  vm.runInNewContext(source, context);

  const config = context.window.ORAKLO_OBSERVABILITY_CONFIG;
  const dsn = new URL(config.sentryDsn);

  assert.equal(monitoring.isValidSentryDsn(config.sentryDsn), true);
  assert.equal(dsn.hostname, "o4511825127276544.ingest.de.sentry.io");
  assert.equal(dsn.pathname, "/4511825596579920");
  assert.equal(config.environment, "production");
  assert.equal(monitoring.isValidSentryIntegrity(config.sentrySdkIntegrity), true);
  assert.deepEqual(
    Array.from(config.allowedHosts),
    ["marcilladiazyolanda-dotcom.github.io"]
  );
});

test("redacta correos, UUID, JWT y campos sensibles", () => {
  const source = {
    email: "persona@example.com",
    nested: {
      message: "Usuario persona@example.com con id 7bca1dc5-31e5-4ca4-9f7c-4decaadab9b7",
      authorization: "Bearer dato-privado"
    },
    tokenText: "token=secreto",
    jwt: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.firma"
  };

  const sanitized = monitoring.scrubMonitoringValue(source);

  assert.equal(sanitized.email, "[dato oculto]");
  assert.match(sanitized.nested.message, /\[correo oculto\]/);
  assert.match(sanitized.nested.message, /\[id oculto\]/);
  assert.equal(sanitized.nested.authorization, "[dato oculto]");
  assert.equal(sanitized.tokenText, "token=[dato oculto]");
  assert.equal(sanitized.jwt, "[token oculto]");
});

test("elimina PII, peticiones, extras y breadcrumbs de un evento", () => {
  const sanitized = monitoring.sanitizeSentryEvent({
    message: "Fallo para persona@example.com",
    user: { id: "123", email: "persona@example.com" },
    request: { url: "https://example.com/profile.html?id=123" },
    breadcrumbs: [{ message: "texto privado" }],
    extra: { comment: "texto privado" },
    contexts: {
      browser: { name: "Chrome" },
      trace: { trace_id: "123" }
    },
    transaction: "https://marcilladiazyolanda-dotcom.github.io/oraklo-prototype-2.0/profile.html?id=privado"
  });

  assert.equal(sanitized.message, "Fallo para [correo oculto]");
  assert.equal(sanitized.user, undefined);
  assert.equal(sanitized.request, undefined);
  assert.equal(sanitized.breadcrumbs, undefined);
  assert.equal(sanitized.extra, undefined);
  assert.deepEqual(sanitized.contexts.browser, { name: "Chrome" });
  assert.equal(sanitized.contexts.trace, undefined);
  assert.equal(
    sanitized.transaction,
    "https://marcilladiazyolanda-dotcom.github.io/oraklo-prototype-2.0/profile.html"
  );
});

test("no carga Sentry sin DSN válido o fuera del host de producción", () => {
  const fakeDocument = {
    head: { appendChild() { throw new Error("No debería insertar scripts"); } },
    querySelector() { return null; },
    createElement() { return {}; }
  };

  assert.equal(
    monitoring.loadOrakloSentry({
      location: { hostname: "localhost" },
      ORAKLO_OBSERVABILITY_CONFIG: {
        sentryDsn: "https://public@example.ingest.sentry.io/1",
        sentrySdkIntegrity: `sha384-${"A".repeat(64)}`,
        allowedHosts: ["marcilladiazyolanda-dotcom.github.io"]
      }
    }, fakeDocument),
    false
  );

  assert.equal(
    monitoring.loadOrakloSentry({
      location: { hostname: "marcilladiazyolanda-dotcom.github.io" },
      ORAKLO_OBSERVABILITY_CONFIG: {
        sentryDsn: "",
        sentrySdkIntegrity: `sha384-${"A".repeat(64)}`,
        allowedHosts: ["marcilladiazyolanda-dotcom.github.io"]
      }
    }, fakeDocument),
    false
  );

  assert.equal(
    monitoring.loadOrakloSentry({
      location: { hostname: "marcilladiazyolanda-dotcom.github.io" },
      ORAKLO_OBSERVABILITY_CONFIG: {
        sentryDsn: "https://public@example.ingest.sentry.io/1",
        sentrySdkIntegrity: "",
        allowedHosts: ["marcilladiazyolanda-dotcom.github.io"]
      }
    }, fakeDocument),
    false
  );
});

test("carga el SDK fijado con integridad, CORS anónimo y sin referente", () => {
  let appendedScript = null;
  const sdkIntegrity = `sha384-${"A".repeat(64)}`;
  const fakeDocument = {
    head: {
      appendChild(script) {
        appendedScript = script;
      }
    },
    querySelector() {
      return null;
    },
    createElement() {
      return {
        dataset: {},
        remove() {}
      };
    }
  };
  const loaded = monitoring.loadOrakloSentry({
    location: { hostname: "marcilladiazyolanda-dotcom.github.io" },
    ORAKLO_OBSERVABILITY_CONFIG: {
      sentryDsn: "https://public@example.ingest.sentry.io/1",
      allowedHosts: ["marcilladiazyolanda-dotcom.github.io"],
      sentrySdkUrl: "https://browser.sentry-cdn.com/10.69.0/bundle.min.js",
      sentrySdkIntegrity: sdkIntegrity
    }
  }, fakeDocument);

  assert.equal(loaded, true);
  assert.equal(
    appendedScript.src,
    "https://browser.sentry-cdn.com/10.69.0/bundle.min.js"
  );
  assert.equal(appendedScript.integrity, sdkIntegrity);
  assert.equal(appendedScript.crossOrigin, "anonymous");
  assert.equal(appendedScript.referrerPolicy, "no-referrer");
  assert.equal(appendedScript.dataset.orakloSentrySdk, "true");
});

test("inicializa Sentry con privacidad estricta en producción", () => {
  let receivedOptions = null;
  const initialized = monitoring.initializeOrakloSentry({
    location: { hostname: "marcilladiazyolanda-dotcom.github.io" },
    ORAKLO_OBSERVABILITY_CONFIG: {
      sentryDsn: "https://public@example.ingest.sentry.io/1",
      environment: "production",
      release: "oraklo@test",
      allowedHosts: ["marcilladiazyolanda-dotcom.github.io"]
    },
    Sentry: {
      init(options) {
        receivedOptions = options;
      }
    }
  });

  assert.equal(initialized, true);
  assert.equal(receivedOptions.sendDefaultPii, false);
  assert.equal(receivedOptions.tracesSampleRate, 0);
  assert.equal(receivedOptions.maxBreadcrumbs, 0);
  assert.equal(receivedOptions.beforeBreadcrumb({ message: "privado" }), null);
  assert.equal(receivedOptions.release, "oraklo@test");
});
