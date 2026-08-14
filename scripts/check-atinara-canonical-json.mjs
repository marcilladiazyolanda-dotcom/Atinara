import {
  ATINARA_CANONICAL_JSON_VERSION,
  canonicalJson,
  sha256Hex,
} from "../supabase/functions/_shared/ai/contracts.mjs";

const repositoryRoot = new URL("../", import.meta.url);
const fixtureUrl = new URL("tests/fixtures/atinara-canonical-json-v1.json", repositoryRoot);
const documentationUrls = [
  new URL("docs/ATINARA_AI_GATEWAY.md", repositoryRoot),
  new URL("docs/ATINARA_AGENT_ENGINE_V2_RUNBOOK.md", repositoryRoot),
  new URL("ORAKLO_PROJECT_CONTEXT.md", repositoryRoot),
  new URL("SECURITY.md", repositoryRoot),
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

let canonicalErrorCases = 0;

function assertCanonicalError(thunk, expectedCode, expectedHttpStatus, id) {
  let received;
  try {
    thunk();
  } catch (error) {
    received = error;
  }
  assert(received?.code === expectedCode, `CANONICAL_JSON_ERROR_CODE_MISMATCH:${id}`);
  assert(received?.httpStatus === expectedHttpStatus, `CANONICAL_JSON_ERROR_STATUS_MISMATCH:${id}`);
  canonicalErrorCases += 1;
}

function nestedCanonicalValue(depth) {
  let value = "leaf";
  for (let index = 0; index < depth; index += 1) value = { value };
  return value;
}

async function readText(url) {
  if (typeof globalThis.Deno?.readTextFile === "function") {
    return globalThis.Deno.readTextFile(url);
  }
  const { readFile } = await import("node:fs/promises");
  return readFile(url, "utf8");
}

async function independentSha256(value) {
  if (typeof globalThis.Deno !== "undefined") {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  }
  const { createHash } = await import("node:crypto");
  return createHash("sha256").update(value, "utf8").digest("hex");
}

const fixture = JSON.parse(await readText(fixtureUrl));
const documentation = await Promise.all(documentationUrls.map((url) => readText(url)));
const declaredVersion = documentation[0].match(/ATINARA_CANONICAL_JSON_VERSION\s*=\s*"([^"]+)"/)?.[1];

assert(
  ATINARA_CANONICAL_JSON_VERSION === fixture.version
    && fixture.version === declaredVersion,
  "CANONICAL_JSON_VERSION_MISMATCH",
);
for (const text of documentation) {
  assert(text.includes(ATINARA_CANONICAL_JSON_VERSION), "CANONICAL_JSON_VERSION_UNDOCUMENTED");
}

assert(
  fixture.domainCompatibilityCases.length === fixture.expectedDomainCompatibilityCaseCount,
  "CANONICAL_JSON_DOMAIN_CASE_COUNT_MISMATCH",
);
assert(fixture.expectedDomainCompatibilityCaseCount >= 13, "CANONICAL_JSON_DOMAIN_CORPUS_TOO_SMALL");

const allCases = [...fixture.domainCompatibilityCases, ...fixture.goldenCases];
for (const testCase of allCases) {
  const actualCanonicalJson = canonicalJson(testCase.input);
  assert(actualCanonicalJson === testCase.expectedCanonicalJson, `CANONICAL_JSON_MISMATCH:${testCase.id}`);
  assert(
    await sha256Hex(actualCanonicalJson) === testCase.expectedSha256,
    `CANONICAL_JSON_SHA256_MISMATCH:${testCase.id}`,
  );
  assert(
    await independentSha256(testCase.expectedCanonicalJson) === testCase.expectedSha256,
    `CANONICAL_JSON_LITERAL_SHA256_MISMATCH:${testCase.id}`,
  );
}

const byId = new Map(fixture.goldenCases.map((testCase) => [testCase.id, testCase]));
const integerUnicode = byId.get("integer-unicode-key-order");
assert(integerUnicode.expectedSha256 === "14141cffbafc63c88d3468cf5e5fcfc139597f0ac4b2f7b28a8951c0e35ede8e", "CANONICAL_JSON_INTEGER_SHA256_MISMATCH");
assert(
  integerUnicode.expectedCanonicalJson
    === "{\"0\":\"zero\",\"1\":\"one\",\"10\":\"ten\",\"2\":\"two\",\"4294967294\":\"max-index\",\"4294967295\":\"not-index\",\"__proto__\":\"data\",\"a\":\"prefix\",\"aa\":\"longer\",\"á\":\"decomposed\",\"constructor\":\"ctor\",\"prototype\":\"proto\",\"á\":\"composed\",\"😀\":\"emoji\"}",
  "CANONICAL_JSON_INTEGER_ORDER_MISMATCH",
);
assert(
  byId.get("insertion-order-one").expectedCanonicalJson
    === byId.get("insertion-order-two").expectedCanonicalJson,
  "CANONICAL_JSON_INSERTION_ORDER_DEPENDENT",
);
assert(
  byId.get("composed-unicode").expectedCanonicalJson
    !== byId.get("decomposed-unicode").expectedCanonicalJson,
  "CANONICAL_JSON_UNICODE_WAS_NORMALIZED",
);

assert(
  await sha256Hex("\ud800") === "83d544ccc223c057d2bf80d3f2a32982c32c3c0db8e2674820da5064783fb097",
  "SHA256_HEX_GENERIC_STRING_CONTRACT_CHANGED",
);

assert(canonicalJson(nestedCanonicalValue(19)).length > 0, "CANONICAL_JSON_DEPTH_19_REJECTED");
assert(canonicalJson(nestedCanonicalValue(20)).length > 0, "CANONICAL_JSON_DEPTH_20_REJECTED");
assertCanonicalError(
  () => canonicalJson(nestedCanonicalValue(21)),
  "AI_INPUT_TOO_LARGE",
  413,
  "depth-21",
);

const invalidValues = [
  [undefined, "undefined"],
  [() => {}, "function"],
  [Symbol("value"), "symbol"],
  [1n, "bigint"],
  [Number.NaN, "nan"],
  [Number.POSITIVE_INFINITY, "infinity"],
  [new Date(0), "date"],
  [new Map(), "map"],
  [new Set(), "set"],
];
for (const [value, id] of invalidValues) {
  assertCanonicalError(() => canonicalJson(value), "AI_INVALID_REQUEST", 400, id);
}

const sparse = new Array(2);
sparse[1] = "present";
assertCanonicalError(() => canonicalJson(sparse), "AI_INVALID_REQUEST", 400, "sparse-array");
const extraArrayKey = ["value"];
extraArrayKey.extra = true;
assertCanonicalError(() => canonicalJson(extraArrayKey), "AI_INVALID_REQUEST", 400, "array-extra-key");
const arraySymbol = ["value"];
arraySymbol[Symbol("extra")] = true;
assertCanonicalError(() => canonicalJson(arraySymbol), "AI_INVALID_REQUEST", 400, "array-symbol");

let accessorCalls = 0;
const accessorObject = {};
Object.defineProperty(accessorObject, "value", {
  enumerable: true,
  get() { accessorCalls += 1; return "forbidden"; },
});
assertCanonicalError(() => canonicalJson(accessorObject), "AI_INVALID_REQUEST", 400, "object-accessor");
assert(accessorCalls === 0, "CANONICAL_JSON_ACCESSOR_EXECUTED");
const nonEnumerableObject = {};
Object.defineProperty(nonEnumerableObject, "value", { value: true, enumerable: false });
assertCanonicalError(() => canonicalJson(nonEnumerableObject), "AI_INVALID_REQUEST", 400, "object-non-enumerable");
const objectSymbol = { value: true };
objectSymbol[Symbol("extra")] = true;
assertCanonicalError(() => canonicalJson(objectSymbol), "AI_INVALID_REQUEST", 400, "object-symbol");

const cycle = {};
cycle.self = cycle;
assertCanonicalError(() => canonicalJson(cycle), "AI_INVALID_REQUEST", 400, "object-cycle");
const arrayCycle = [];
arrayCycle.push(arrayCycle);
assertCanonicalError(() => canonicalJson(arrayCycle), "AI_INVALID_REQUEST", 400, "array-cycle");
for (const [value, id] of [["\ud800", "high-surrogate"], ["\udfff", "low-surrogate"]]) {
  assertCanonicalError(() => canonicalJson(value), "AI_INVALID_REQUEST", 400, id);
  const invalidKey = {};
  Object.defineProperty(invalidKey, value, { value: true, enumerable: true });
  assertCanonicalError(() => canonicalJson(invalidKey), "AI_INVALID_REQUEST", 400, `${id}-key`);
}

console.log(JSON.stringify({
  version: ATINARA_CANONICAL_JSON_VERSION,
  runtime: typeof globalThis.Deno === "undefined" ? "node" : "deno",
  domainCompatibilityCases: fixture.domainCompatibilityCases.length,
  goldenCases: fixture.goldenCases.length,
  invalidCases: canonicalErrorCases,
  integerUnicodeSha256: integerUnicode.expectedSha256,
}));
