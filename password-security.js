const ORAKLO_PASSWORD_MIN_LENGTH = 12;
const ORAKLO_PASSWORD_SYMBOLS = "!@#$%^&*()_+-=[]{};'\\:\"|<>?,./`~";
const ORAKLO_PWNED_PASSWORDS_RANGE_URL = "https://api.pwnedpasswords.com/range/";
const ORAKLO_PASSWORD_CHECK_TIMEOUT_MS = 8000;

class OrakloPasswordSecurityError extends Error {
  constructor(message, code = "password_security_unavailable") {
    super(message);
    this.name = "OrakloPasswordSecurityError";
    this.code = code;
  }
}

function evaluateOrakloPassword(password = "") {
  const value = String(password);
  const rules = {
    length: value.length >= ORAKLO_PASSWORD_MIN_LENGTH,
    lowercase: /[a-z]/.test(value),
    uppercase: /[A-Z]/.test(value),
    number: /[0-9]/.test(value),
    symbol: Array.from(value).some((character) => ORAKLO_PASSWORD_SYMBOLS.includes(character))
  };

  return {
    rules,
    valid: Object.values(rules).every(Boolean)
  };
}

async function hashOrakloPassword(password, cryptoProvider = window.crypto) {
  if (!cryptoProvider?.subtle || typeof TextEncoder === "undefined") {
    throw new OrakloPasswordSecurityError(
      "El navegador no permite comprobar la contraseña de forma segura.",
      "crypto_unavailable"
    );
  }

  const encodedPassword = new TextEncoder().encode(password);
  const digest = await cryptoProvider.subtle.digest("SHA-1", encodedPassword);

  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
}

function parseOrakloPasswordRange(rangeResponse, expectedSuffix) {
  const normalizedSuffix = String(expectedSuffix).trim().toUpperCase();
  let occurrences = 0;
  let validEntries = 0;

  for (const line of String(rangeResponse).split(/\r?\n/)) {
    const [candidateSuffix, rawCount] = line.trim().split(":");
    if (!/^[0-9A-F]{35}$/i.test(candidateSuffix || "") || !/^\d+$/.test(rawCount || "")) {
      continue;
    }

    validEntries += 1;
    const parsedCount = Number.parseInt(rawCount, 10);
    if (
      candidateSuffix.toUpperCase() === normalizedSuffix
      && Number.isFinite(parsedCount)
      && parsedCount > occurrences
    ) {
      occurrences = parsedCount;
    }
  }

  return {
    occurrences,
    validEntries
  };
}

async function checkOrakloPasswordExposure(password, options = {}) {
  const fetchImplementation = options.fetchImplementation || window.fetch?.bind(window);
  const cryptoProvider = options.cryptoProvider || window.crypto;
  const timeoutMs = Number(options.timeoutMs) || ORAKLO_PASSWORD_CHECK_TIMEOUT_MS;

  if (typeof fetchImplementation !== "function") {
    throw new OrakloPasswordSecurityError(
      "No se puede conectar con la comprobación de contraseñas.",
      "fetch_unavailable"
    );
  }

  const hash = await hashOrakloPassword(String(password), cryptoProvider);
  const prefix = hash.slice(0, 5);
  const suffix = hash.slice(5);
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  const timeoutId = controller
    ? window.setTimeout(() => controller.abort(), timeoutMs)
    : null;

  try {
    const response = await fetchImplementation(
      `${ORAKLO_PWNED_PASSWORDS_RANGE_URL}${prefix}`,
      {
        method: "GET",
        headers: {
          "Add-Padding": "true"
        },
        cache: "no-store",
        credentials: "omit",
        referrerPolicy: "no-referrer",
        signal: controller?.signal
      }
    );

    if (!response?.ok) {
      throw new OrakloPasswordSecurityError(
        "El servicio de comprobación no está disponible.",
        "range_request_failed"
      );
    }

    const rangeResponse = await response.text();
    const parsedRange = parseOrakloPasswordRange(rangeResponse, suffix);

    if (parsedRange.validEntries === 0) {
      throw new OrakloPasswordSecurityError(
        "La respuesta del servicio de comprobación no es válida.",
        "range_response_invalid"
      );
    }

    return {
      exposed: parsedRange.occurrences > 0,
      occurrences: parsedRange.occurrences
    };
  } catch (error) {
    if (error instanceof OrakloPasswordSecurityError) {
      throw error;
    }

    const code = error?.name === "AbortError"
      ? "range_request_timeout"
      : "range_request_failed";

    throw new OrakloPasswordSecurityError(
      "No se ha podido comprobar la contraseña.",
      code
    );
  } finally {
    if (timeoutId !== null) {
      window.clearTimeout(timeoutId);
    }
  }
}

window.orakloPasswordSecurity = Object.freeze({
  minLength: ORAKLO_PASSWORD_MIN_LENGTH,
  evaluate: evaluateOrakloPassword,
  checkExposure: checkOrakloPasswordExposure
});
