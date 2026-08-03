const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { test } = require("node:test");

const root = join(__dirname, "..");

test("la recuperación responde de forma genérica tanto si el correo existe como si no", () => {
  const auth = readFileSync(join(root, "auth.js"), "utf8");
  assert.match(auth, /resetPasswordForEmail/);
  assert.match(auth, /Si existe una cuenta con ese email/);
  assert.doesNotMatch(auth, /Correo no registrado|No existe una cuenta con ese correo/i);
});

test("la aplicación no expone secretos ni archivos de entorno", () => {
  const sources = [
    "supabaseClient.js",
    "site-ui.js",
    "admin-markets.js",
    "password-recovery.js"
  ].map((file) => readFileSync(join(root, file), "utf8")).join("\n");
  assert.doesNotMatch(sources, /sb_secret_|SUPABASE_SERVICE_ROLE_KEY\s*=|GEMINI_API_KEY\s*=|MAILJET_SECRET\s*=/i);
});

test("las posiciones privadas se consultan solo tras una sesión autenticada", () => {
  const predictions = readFileSync(join(root, "my-predictions.js"), "utf8");
  assert.match(predictions, /if \(!authState\.isAuthenticated\)/);
  assert.match(predictions, /\.from\("predictions"\)/);
  assert.match(
    predictions,
    /if \(!authState\.isAuthenticated\) \{[\s\S]+renderPredictionsGuest\(\);[\s\S]+return;[\s\S]+const predictions = await fetchPredictions\(\)/
  );
});

test("las superficies nuevas escapan contenido dinámico y no muestran errores SQL", () => {
  const admin = readFileSync(join(root, "admin-markets.js"), "utf8");
  const resolution = readFileSync(join(root, "admin-resolution.js"), "utf8");
  assert.match(admin, /function escapeHtml/);
  assert.match(admin, /escapeHtml\(issue\.message\)/);
  assert.doesNotMatch(resolution, /statusMessage = error\.message/);
  assert.doesNotMatch(admin, /error\.message/);
});
