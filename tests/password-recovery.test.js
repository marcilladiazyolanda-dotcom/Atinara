const assert = require("node:assert/strict");
const { test } = require("node:test");

const recovery = require("../password-recovery.js");

test("la recuperación conserva la subcarpeta canónica de Atinara", () => {
  const location = { href: "https://example.test/Atinara/index.html" };
  assert.equal(
    recovery.getRecoveryRedirectUrl(location),
    "https://example.test/Atinara/reset-password.html"
  );
});

test("detecta marcadores de recuperación en hash o query", () => {
  assert.equal(recovery.hasRecoveryMarker({ href: "https://example.test/Atinara/reset-password.html#type=recovery" }), true);
  assert.equal(recovery.hasRecoveryMarker({ href: "https://example.test/Atinara/reset-password.html?code=abc" }), true);
  assert.equal(recovery.hasRecoveryMarker({ href: "https://example.test/Atinara/reset-password.html" }), false);
});

test("los errores de enlace no exponen mensajes técnicos", () => {
  assert.match(recovery.getFriendlyRecoveryError({ code: "otp_expired" }), /caducado/i);
  assert.match(recovery.getFriendlyRecoveryError({ message: "invalid token" }), /no es válido/i);
  assert.doesNotMatch(recovery.getFriendlyRecoveryError({ message: "relation auth.users failed" }), /auth\.users|relation/i);
});
