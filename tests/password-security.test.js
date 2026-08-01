const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { test } = require("node:test");
const vm = require("node:vm");
const { webcrypto } = require("node:crypto");
const { TextEncoder } = require("node:util");

const source = readFileSync(
  join(__dirname, "..", "password-security.js"),
  "utf8"
);

function loadPasswordSecurity(fetchImplementation = async () => ({
  ok: true,
  text: async () => ""
})) {
  const window = {
    crypto: webcrypto,
    fetch: fetchImplementation,
    setTimeout,
    clearTimeout
  };

  const context = vm.createContext({
    window,
    TextEncoder,
    Uint8Array,
    AbortController,
    setTimeout,
    clearTimeout
  });

  vm.runInContext(source, context, { filename: "password-security.js" });
  return window.orakloPasswordSecurity;
}

test("exige los cinco requisitos locales antes del registro", () => {
  const security = loadPasswordSecurity();
  const weak = security.evaluate("oraklo");
  const strong = security.evaluate("OrakloSeguro1!");

  assert.equal(weak.valid, false);
  assert.deepEqual(
    { ...weak.rules },
    {
      length: false,
      lowercase: true,
      uppercase: false,
      number: false,
      symbol: false
    }
  );

  assert.equal(strong.valid, true);
  assert.ok(Object.values(strong.rules).every(Boolean));
});

test("consulta únicamente cinco caracteres del hash y activa el relleno", async () => {
  let capturedUrl;
  let capturedOptions;
  const security = loadPasswordSecurity(async (url, options) => {
    capturedUrl = url;
    capturedOptions = options;

    return {
      ok: true,
      text: async () => [
        "1E4C9B93F3F0682250B6CF8331B7EE68FD8:0",
        "1E4C9B93F3F0682250B6CF8331B7EE68FD8:3303003"
      ].join("\r\n")
    };
  });

  const result = await security.checkExposure("password");

  assert.equal(capturedUrl, "https://api.pwnedpasswords.com/range/5BAA6");
  assert.equal(capturedOptions.headers["Add-Padding"], "true");
  assert.equal(capturedOptions.credentials, "omit");
  assert.equal(capturedOptions.referrerPolicy, "no-referrer");
  assert.equal(capturedOptions.body, undefined);
  assert.deepEqual({ ...result }, { exposed: true, occurrences: 3303003 });
});

test("acepta una contraseña que no aparece en el rango devuelto", async () => {
  const security = loadPasswordSecurity(async () => ({
    ok: true,
    text: async () => "00000000000000000000000000000000000:0\r\n"
  }));

  const result = await security.checkExposure("OrakloSeguro1!");

  assert.deepEqual({ ...result }, { exposed: false, occurrences: 0 });
});

test("falla de forma cerrada si HIBP no está disponible", async () => {
  const security = loadPasswordSecurity(async () => ({
    ok: false,
    status: 503,
    text: async () => ""
  }));

  await assert.rejects(
    () => security.checkExposure("OrakloSeguro1!"),
    (error) => error?.code === "range_request_failed"
  );
});

test("falla de forma cerrada ante una respuesta 200 mal formada", async () => {
  const security = loadPasswordSecurity(async () => ({
    ok: true,
    text: async () => "respuesta inesperada"
  }));

  await assert.rejects(
    () => security.checkExposure("OrakloSeguro1!"),
    (error) => error?.code === "range_response_invalid"
  );
});
