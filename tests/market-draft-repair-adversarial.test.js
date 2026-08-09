const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { pathToFileURL } = require("node:url");
const { before, test } = require("node:test");

const root = join(__dirname, "..");
const repairPath = join(root, "supabase/functions/_shared/market-draft-repair.mjs");
const fixerEdge = readFileSync(join(root, "supabase/functions/market-draft-fixer/index.ts"), "utf8");
const validatorEdge = readFileSync(join(root, "supabase/functions/validate-market-draft/index.ts"), "utf8");
const reviewPolicyV3Migration = readFileSync(
  join(root, "supabase/migrations/20260809160000_harden_market_review_policy_v3.sql"),
  "utf8",
);
const reviewPolicyV3SqlTest = readFileSync(
  join(root, "supabase/tests/market_review_policy_v3_transaction.sql"),
  "utf8",
);
const primarySourceV1Migration = readFileSync(
  join(root, "supabase/migrations/20260809170000_require_registered_primary_source_checks_v1.sql"),
  "utf8",
);
const primarySourceV1SqlTest = readFileSync(
  join(root, "supabase/tests/market_primary_source_v1_transaction.sql"),
  "utf8",
);
let repair;

before(async () => {
  repair = await import(pathToFileURL(repairPath).href);
});

function verifiedSource(url = "https://official.example.com/project-aurora", excerpt = "Project Aurora official release information.") {
  return {
    url,
    excerpt,
    validated_reachable: true,
    authority_verified: true,
    relevance_verified: true,
    authority_basis: "private_source_registry_v1",
    relevance_basis: "fetched_content_v1",
  };
}

function verifiedPrimarySource(
  url,
  excerpt = "Official primary resolution source for the declared subject.",
  category = "Lanzamientos",
) {
  return {
    url,
    excerpt,
    name: "Official Test Registry Source",
    publisher: "Official Test Registry Source",
    role: "PRIMARY_RESOLUTION",
    validated_reachable: true,
    authority_verified: true,
    relevance_verified: true,
    registry_role_verified: true,
    registry_source_id: "11111111-1111-4111-8111-111111111111",
    registry_domain: new URL(url).hostname.toLowerCase().replace(/^www\./, ""),
    registry_parser_version: "test-primary-parser-v1",
    registry_role: "primary_resolution",
    registry_categories: [],
    draft_category: category,
    authority_basis: "private_source_registry_primary_resolution_v1",
    relevance_basis: "fetched_content_v1",
    validation_version: "atinara-primary-source-validation-v1",
  };
}

function primaryFor(context, excerpt) {
  const draftUrl = context?.draft?.primary_source?.url;
  const candidateUrl = context?.radar_candidate?.atinara_resolution_source_url
    || context?.radar_candidate?.source_resolution_url;
  return verifiedPrimarySource(
    candidateUrl || draftUrl,
    excerpt,
    context?.proposed_category || context?.draft?.category || context?.radar_candidate?.atinara_category,
  );
}

function verifiedRepairSources(context, alternatives = [verifiedSource()]) {
  return [primaryFor(context), ...alternatives];
}

function registrySource({
  id = "11111111-1111-4111-8111-111111111111",
  domain = "official.example.com",
  roles = ["primary_resolution"],
  categories = [],
  tier = "primary",
  active = true,
} = {}) {
  return {
    id,
    provider: "test",
    source_name: "Official Test Source",
    canonical_domain: domain,
    allowed_roles: roles,
    authority_tier: tier,
    categories,
    parser_version: "test-primary-parser-v1",
    active,
  };
}

function releaseContext(overrides = {}) {
  const question = overrides.question || "¿Se lanzará Proyecto Aurora antes del 1 de septiembre de 2026?";
  return {
    draft: {
      market_slug: "proyecto-aurora-release",
      question,
      subject: "",
      category: "Lanzamientos",
      yes_option: "Sí",
      no_option: "No",
      yes_criteria: question,
      primary_source: { url: "https://official.example.com/results" },
      alternative_sources: [verifiedSource()],
      evaluation_ends_at: "2026-08-31T23:59:59Z",
      closes_at: "2026-08-31T23:59:59Z",
      resolution_deadline: "2026-09-02T23:59:59Z",
      timezone: "UTC",
      ...overrides.draft,
    },
    radar_candidate: {
      source_question: question,
      source_title: "Project Aurora release",
      source_resolution_rules: question,
      source_resolution_url: "https://official.example.com/results",
      atinara_category: "Lanzamientos",
      ...overrides.radar_candidate,
    },
    repairable_content_issues: overrides.repairable_content_issues || [],
  };
}

test("Corrector adversarial · before es una frontera estricta en cualquier día del mes", () => {
  assert.equal(repair.AUTONOMOUS_REPAIR_VERSION, "atinara-draft-repair-v8");
  assert.equal(
    repair.inferInclusiveDeadline("Will Project Aurora release before August 31, 2026?").iso,
    "2026-08-30T23:59:59.000Z",
  );
  assert.equal(
    repair.inferInclusiveDeadline("¿Se lanzará Proyecto Aurora antes del 30 de noviembre de 2026?").iso,
    "2026-11-29T23:59:59.000Z",
  );
  assert.equal(
    repair.inferInclusiveDeadline("Will Project Aurora release on or before August 31, 2026?").iso,
    "2026-08-31T23:59:59.000Z",
  );
});

test("Corrector adversarial · una objeción temporal invalida los timestamps objetados", () => {
  const context = releaseContext({
    draft: {
      evaluation_ends_at: "2026-09-30T23:59:59Z",
      closes_at: "2026-09-30T23:59:59Z",
    },
    repairable_content_issues: [{
      code: "TEMPORAL_INCOHERENCE",
      field: "evaluation_ends_at",
      message: "La fecha guardada contradice la pregunta.",
    }],
  });
  const result = repair.buildDeterministicRepair(context, verifiedRepairSources(context));
  assert.equal(result.unresolved, null);
  assert.equal(result.patch.evaluation_ends_at, "2026-08-31T23:59:59.000Z");
  assert.equal(result.patch.closes_at, "2026-08-31T23:59:59.000Z");
  assert.doesNotMatch(result.patch.question, /30 de septiembre/);

  const objectedQuestion = releaseContext({
    question: "¿Se lanzará Proyecto Aurora antes del 1 de octubre de 2026?",
    radar_candidate: {
      source_question: "Will Project Aurora release before September 1, 2026?",
      source_resolution_rules: "Will Project Aurora release before September 1, 2026?",
    },
    repairable_content_issues: [{
      code: "TEMPORAL_INCOHERENCE",
      field: "question",
      message: "La fecha de la pregunta contradice la procedencia.",
    }],
  });
  const repairedQuestion = repair.buildDeterministicRepair(objectedQuestion, verifiedRepairSources(objectedQuestion));
  assert.equal(repairedQuestion.patch.evaluation_ends_at, "2026-08-31T23:59:59.000Z");
});

test("Corrector adversarial · TIMEZONE_INVALID ignora el campo objetado y solo deriva un token contractual inequívoco", () => {
  const context = releaseContext({
    draft: { timezone: "Mars/Olympus" },
    radar_candidate: { source_resolution_rules: "Project Aurora releases by 10:00 AM ET on August 31, 2026." },
    repairable_content_issues: [{
      code: "TIMEZONE_INVALID",
      field: "timezone",
      message: "La zona no existe.",
    }],
  });
  const result = repair.buildDeterministicRepair(context, verifiedRepairSources(context));
  assert.equal(result.unresolved, null);
  assert.equal(result.patch.timezone, "America/New_York");

  const noContractZone = releaseContext({
    draft: { timezone: "Mars/Olympus" },
    repairable_content_issues: [{
      code: "TIMEZONE_INVALID",
      field: "timezone",
      message: "La zona no existe.",
    }],
  });
  const blocked = repair.buildDeterministicRepair(noContractZone, verifiedRepairSources(noContractZone));
  assert.equal(blocked.unresolved.code, "TIMEZONE_NOT_INFERABLE");
  assert.equal(blocked.unresolved.field, "timezone");
  assert.deepEqual(blocked.patch, {});
  assert.equal(repair.validIanaTimezone("Mars/Olympus"), false);
  assert.equal(repair.validIanaTimezone("America/New_York"), true);
});

test("Corrector adversarial · PERIOD_REQUIRED repara evaluation y closes como un solo periodo", () => {
  const context = releaseContext({
    draft: { closes_at: null },
    repairable_content_issues: [{
      code: "PERIOD_REQUIRED",
      field: "evaluation_period",
      message: "Falta el cierre coherente.",
    }],
  });
  const result = repair.buildDeterministicRepair(context, verifiedRepairSources(context));
  const repaired = repair.applyRepairPatch(context.draft, result);
  assert.equal(result.unresolved, null);
  assert.equal(result.patch.closes_at, result.patch.evaluation_ends_at);
  assert.ok(repair.changedRepairFields(context.draft, repaired).includes("closes_at"));
  assert.deepEqual(repair.validateRepairDraft(repaired), []);

  const stillBroken = { ...repaired, closes_at: null };
  assert.ok(repair.validateRepairDraft(stillBroken).includes("PERIOD_REQUIRED"));
});

test("Corrector adversarial · SUBJECT_REQUIRED preserva sujetos entity-first en los diez arquetipos", () => {
  const fixtures = [
    ["official_announcement", "Proyecto Aurora será anunciado oficialmente antes del 1 de enero de 2027", "Proyecto Aurora"],
    ["product_release", "Grand Theft Auto VI será lanzado antes del 30 de noviembre de 2026", "Grand Theft Auto VI"],
    ["content_release", "Proyecto Aurora tendrá un nuevo tráiler antes del 1 de enero de 2027", "Proyecto Aurora"],
    ["metric_threshold", "Marvel Tokon: Fighting Souls tendrá un User Score de Metacritic superior a 8 antes del 1 de enero de 2027", "Marvel Tokon: Fighting Souls"],
    ["milestone_threshold", "Canal Aurora superará 1000000 suscriptores antes del 1 de enero de 2027", "Canal Aurora"],
    ["award_winner", "Obra Cobalto ganará el premio Juego del Año antes del 1 de enero de 2027", "Obra Cobalto"],
    ["event_presence", "Estudio Épsilon participará en la Feria Boreal antes del 1 de enero de 2027", "Estudio Épsilon"],
    ["deadline_ladder_child", "El evento Aurora ocurrirá antes del 1 de enero de 2027", "El evento Aurora"],
    ["platform_variant", "Proyecto Aurora tendrá una versión para PlayStation 5 antes del 1 de enero de 2027", "Proyecto Aurora"],
    ["generic_binary_event", "Proyecto Aurora seguirá activo", "Proyecto Aurora"],
  ];
  for (const [expectedArchetype, text, expectedSubject] of fixtures) {
    const question = `¿${text}?`;
    const context = releaseContext({
      question,
      draft: { subject: "", yes_criteria: question },
      radar_candidate: { source_question: question, source_title: question, source_resolution_rules: question },
    });
    assert.equal(repair.inferArchetype(context), expectedArchetype, text);
    assert.equal(repair.inferSubject(context), expectedSubject, text);
    assert.equal((question.match(new RegExp(expectedSubject.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) || []).length, 1);
    assert.doesNotMatch(repair.inferSubject(context), /\b(?:será|seguirá|tendrá|superará|ganará|participará|ocurrirá)\b/i);
  }

  const question = "¿Grand Theft Auto VI será lanzado antes del 30 de noviembre de 2026?";
  const context = releaseContext({
    question,
    draft: {
      subject: "",
      yes_criteria: question,
      evaluation_ends_at: "2026-11-29T23:59:59.000Z",
      closes_at: "2026-11-29T23:59:59.000Z",
      resolution_deadline: "2026-12-01T23:59:59.000Z",
    },
    radar_candidate: {
      source_question: question,
      source_resolution_rules: question,
    },
    repairable_content_issues: [{
      code: "SUBJECT_REQUIRED",
      field: "subject",
      message: "Falta el sujeto estructurado.",
    }],
  });
  assert.equal(repair.inferArchetype(context), "product_release");
  assert.equal(repair.inferSubject(context), "Grand Theft Auto VI");
  const result = repair.buildDeterministicRepair(context, verifiedRepairSources(context));
  assert.equal(result.unresolved, null);
  assert.equal(result.patch.subject, "Grand Theft Auto VI");
  assert.equal((result.patch.question.match(/Grand Theft Auto VI/g) || []).length, 1);
});

test("Corrector adversarial · announcement y content obtienen publisher solo de PRIMARY atestada", () => {
  const fixtures = [
    "¿Proyecto Aurora será anunciado oficialmente antes del 1 de enero de 2027?",
    "¿Proyecto Aurora tendrá un nuevo tráiler antes del 1 de enero de 2027?",
  ];
  for (const question of fixtures) {
    const context = releaseContext({
      question,
      draft: { subject: "", yes_criteria: question, primary_source: null },
      radar_candidate: { source_question: question, source_title: question, source_resolution_rules: question },
    });
    const primary = { ...primaryFor(context), name: "Official Studio", publisher: "Official Studio" };
    const result = repair.buildDeterministicRepair(context, [primary, verifiedSource()]);
    assert.equal(result.unresolved, null);
    assert.equal(result.patch.primary_source.publisher, "Official Studio");
    assert.match(result.patch.yes_criteria, /Official Studio/);
  }

  const question = "¿Proyecto Aurora será anunciado oficialmente antes del 1 de enero de 2027?";
  const context = releaseContext({
    question,
    draft: { subject: "", yes_criteria: question, primary_source: null },
    radar_candidate: { source_question: question, source_title: question, source_resolution_rules: question },
  });
  for (const primary of [
    { ...primaryFor(context), name: "", publisher: "" },
    { ...primaryFor(context), name: "Studio A or Studio B", publisher: "Studio A or Studio B" },
  ]) {
    const blocked = repair.buildDeterministicRepair(context, [primary, verifiedSource()]);
    assert.equal(blocked.unresolved.code, "ARCHETYPE_SLOT_NOT_INFERABLE");
    assert.equal(blocked.unresolved.field, "publisher");
    assert.deepEqual(blocked.patch, {});
  }
});

test("Corrector adversarial · portada FC27 separa producto PRIMARY y participante del predicado", async () => {
  const spanish = "¿Estará Ousmane Dembélé en la portada de EA Sports FC 27 antes del 1 de septiembre de 2026?";
  const english = "Will Ousmane Dembele be the EA Sports FC 27 cover athlete before September 1, 2026?";
  for (const question of [spanish, english]) {
    const context = releaseContext({
      question,
      draft: { subject: "", yes_criteria: question, category: "Lanzamientos" },
      radar_candidate: { source_question: question, source_title: question, source_resolution_rules: question },
      repairable_content_issues: [{ code: "SUBJECT_REQUIRED", field: "subject" }],
    });
    assert.equal(repair.inferSubject(context), "EA Sports FC 27");
    const result = repair.buildDeterministicRepair(context, verifiedRepairSources(context));
    assert.equal(result.unresolved, null);
    assert.equal(result.patch.subject, "EA Sports FC 27");
    assert.equal(result.patch.question, question);
    assert.match(result.patch.yes_criteria, /Ousmane Demb[eé]l[eé]/i);
    assert.match(result.patch.yes_criteria, /EA Sports FC 27/);
    assert.doesNotMatch(result.patch.yes_criteria, /ganador|resultado Sí confirmado/i);
    assert.equal(repair.primarySourceRelevance({
      url: "https://ea.com/games/ea-sports-fc/fc-27",
      excerpt: "EA Sports FC 27 official cover athlete is Jude Bellingham.",
    }, context).accepted, true);
    const validation = await repair.validateRegisteredPrimarySource(
      { url: "https://ea.com/games/ea-sports-fc/fc-27", origin: "candidate_canonical" },
      { ...context, source_validation_category: "Lanzamientos" },
      [registrySource({ domain: "ea.com", categories: ["Lanzamientos"] })],
      async () => new Response("EA Sports FC 27 official cover athlete is Jude Bellingham.", {
        status: 200,
        headers: { "content-type": "text/html" },
      }),
      { now: "2026-08-09T12:00:00Z" },
    );
    assert.equal(validation.evidence.accepted, true);
    const endToEnd = repair.buildDeterministicRepair(context, [validation.source, verifiedSource()]);
    assert.equal(endToEnd.unresolved, null);
    assert.equal(endToEnd.patch.subject, "EA Sports FC 27");
  }

  const ambiguous = releaseContext({
    question: "¿Estará Ousmane Dembélé o Harry Kane en la portada de EA Sports FC 27 antes del 1 de septiembre de 2026?",
    draft: { subject: "" },
    radar_candidate: {
      source_question: "¿Estará Ousmane Dembélé o Harry Kane en la portada de EA Sports FC 27 antes del 1 de septiembre de 2026?",
      source_title: "EA Sports FC 27 cover",
      source_resolution_rules: "¿Estará Ousmane Dembélé o Harry Kane en la portada de EA Sports FC 27 antes del 1 de septiembre de 2026?",
    },
  });
  assert.equal(repair.detectIrreducibleAmbiguity(ambiguous).code, "AMBIGUOUS_SUBJECT_IDENTITY");
  assert.equal(
    repair.buildDeterministicRepair(ambiguous, verifiedRepairSources(ambiguous)).unresolved.code,
    "AMBIGUOUS_SUBJECT_IDENTITY",
  );
});

test("Corrector adversarial · los campos objetados no se autocertifican durante la inferencia", () => {
  const fullQuestion = "¿Grand Theft Auto VI será lanzado antes del 30 de noviembre de 2026?";
  const ambiguousSubject = releaseContext({
    question: fullQuestion,
    draft: {
      subject: "GTA",
      yes_criteria: fullQuestion,
      evaluation_ends_at: "2026-11-29T23:59:59.000Z",
      closes_at: "2026-11-29T23:59:59.000Z",
      resolution_deadline: "2026-12-01T23:59:59.000Z",
    },
    radar_candidate: { source_question: fullQuestion, source_resolution_rules: fullQuestion },
    repairable_content_issues: [{ code: "AMBIGUOUS_SUBJECT", field: "subject" }],
  });
  const sanitized = repair.repairInferenceContext(ambiguousSubject);
  assert.equal(sanitized.draft.subject, null);
  assert.equal(ambiguousSubject.draft.subject, "GTA");
  assert.equal(repair.inferSubject(ambiguousSubject), "Grand Theft Auto VI");
  assert.equal(repair.primarySourceRelevance({
    url: "https://official.example.com/grand-theft-auto-vi",
    excerpt: "Grand Theft Auto VI official commercial release information.",
  }, ambiguousSubject).accepted, true);
  const repairedSubject = repair.buildDeterministicRepair(
    ambiguousSubject,
    verifiedRepairSources(ambiguousSubject),
  );
  assert.equal(repairedSubject.unresolved, null);
  assert.equal(repairedSubject.patch.subject, "Grand Theft Auto VI");

  const conflictingSubject = releaseContext({
    question: fullQuestion,
    draft: { subject: "GTA", yes_criteria: fullQuestion },
    radar_candidate: {
      source_question: "¿Red Dead Redemption III será lanzado antes del 30 de noviembre de 2026?",
      source_resolution_rules: "¿Red Dead Redemption III será lanzado antes del 30 de noviembre de 2026?",
    },
    repairable_content_issues: [{ code: "AMBIGUOUS_SUBJECT", field: "subject" }],
  });
  assert.equal(repair.inferSubject(conflictingSubject), "");
  assert.equal(
    repair.buildDeterministicRepair(conflictingSubject, verifiedRepairSources(conflictingSubject)).unresolved.code,
    "SUBJECT_NOT_INFERABLE",
  );

  const metric = releaseContext({
    question: "¿Proyecto Aurora tendrá un Metascore de crítica superior a 95?",
    draft: {
      question: "¿Proyecto Aurora tendrá un Metascore de crítica superior a 95?",
      yes_criteria: "Proyecto Aurora tendrá un User Score de Metacritic superior a 8.",
    },
    radar_candidate: {
      source_question: "Will Project Aurora have a Metacritic User Score > 8?",
      source_resolution_rules: "Use the Metacritic User Score > 8 on its 0-10 scale.",
    },
    repairable_content_issues: [{ code: "INVALID_METRIC", field: "question" }],
  });
  const metricContract = repair.inferMetricContract(metric);
  assert.equal(repair.repairInferenceContext(metric).draft.question, null);
  assert.equal(metricContract.metric, "User Score de Metacritic");
  assert.equal(metricContract.threshold, 8);
  assert.equal(metricContract.scale_max, 10);
});

test("Corrector adversarial · CONTRADICTORY_CRITERIA nunca elige una fecha o predicado por orden", () => {
  const september = "¿Proyecto Aurora será lanzado antes del 1 de septiembre de 2026?";
  const october = "¿Proyecto Aurora será lanzado antes del 1 de octubre de 2026?";
  for (const [question, rules] of [[september, october], [october, september]]) {
    const context = releaseContext({
      question,
      draft: {
        subject: "",
        yes_criteria: rules,
        evaluation_ends_at: "2026-09-30T23:59:59.000Z",
        closes_at: "2026-09-30T23:59:59.000Z",
      },
      radar_candidate: { source_question: question, source_title: question, source_resolution_rules: rules },
      repairable_content_issues: [{ code: "CONTRADICTORY_CRITERIA", field: "yes_criteria" }],
    });
    const blocked = repair.buildDeterministicRepair(context, verifiedRepairSources(context));
    assert.equal(blocked.unresolved.code, "CONTRACT_CONFLICT");
    assert.equal(blocked.unresolved.field, "evaluation_period");
    assert.deepEqual(blocked.patch, {});
    assert.equal(blocked.unresolved.alternatives.filter((item) => item.kind === "deadline").length, 2);
  }

  const unique = releaseContext({
    question: september,
    draft: {
      subject: "",
      yes_criteria: "Criterio objetado y retirado de la inferencia.",
      evaluation_ends_at: "2026-09-30T23:59:59.000Z",
      closes_at: "2026-09-30T23:59:59.000Z",
    },
    radar_candidate: { source_question: september, source_title: september, source_resolution_rules: september },
    repairable_content_issues: [{ code: "CONTRADICTORY_CRITERIA", field: "yes_criteria" }],
  });
  const repaired = repair.buildDeterministicRepair(unique, verifiedRepairSources(unique));
  assert.equal(repaired.unresolved, null);
  assert.equal(repaired.patch.evaluation_ends_at, "2026-08-31T23:59:59.000Z");
});

test("Corrector adversarial · una disyunción real de sujetos escala desde el contexto RPC", () => {
  const question = "¿Proyecto Aurora o Proyecto Boreal será lanzado antes del 1 de enero de 2027?";
  const context = releaseContext({
    question,
    draft: { subject: "", yes_criteria: question },
    radar_candidate: { source_question: question, source_title: question, source_resolution_rules: question },
    repairable_content_issues: [{ code: "AMBIGUOUS_SUBJECT", field: "subject" }],
  });
  assert.equal(context.subject_alternatives, undefined);
  const ambiguity = repair.detectIrreducibleAmbiguity(repair.repairInferenceContext(context));
  assert.equal(ambiguity.code, "AMBIGUOUS_SUBJECT_IDENTITY");
  assert.deepEqual(ambiguity.alternatives, ["Proyecto Aurora", "Proyecto Boreal"]);
  const blocked = repair.buildDeterministicRepair(context, verifiedRepairSources(context));
  assert.equal(blocked.unresolved.code, "AMBIGUOUS_SUBJECT_IDENTITY");
  assert.deepEqual(blocked.patch, {});

  const subtitle = releaseContext({
    question: "¿Grand Theft Auto VI: Project Americas será lanzado antes del 1 de enero de 2027?",
    draft: { subject: "" },
    radar_candidate: {
      source_question: "¿Grand Theft Auto VI: Project Americas será lanzado antes del 1 de enero de 2027?",
      source_title: "Grand Theft Auto VI: Project Americas",
      source_resolution_rules: "¿Grand Theft Auto VI: Project Americas será lanzado antes del 1 de enero de 2027?",
    },
  });
  assert.equal(repair.detectIrreducibleAmbiguity(subtitle), null);
  assert.equal(repair.inferSubject(subtitle), "Grand Theft Auto VI: Project Americas");

  const alias = releaseContext({
    question: "¿Grand Theft Auto VI / GTA VI será lanzado antes del 1 de enero de 2027?",
    draft: { subject: "" },
    radar_candidate: {
      source_question: "¿Grand Theft Auto VI / GTA VI será lanzado antes del 1 de enero de 2027?",
      source_title: "Grand Theft Auto VI / GTA VI",
      source_resolution_rules: "¿Grand Theft Auto VI / GTA VI será lanzado antes del 1 de enero de 2027?",
    },
  });
  assert.equal(repair.detectIrreducibleAmbiguity(alias), null);
});

test("Corrector adversarial · UNRESOLVABLE_CONTRACT nunca se reescribe como criterio tautológico", () => {
  const vague = "¿Ocurrirá Proyecto Aurora antes del 1 de enero de 2027?";
  const vagueContext = releaseContext({
    question: vague,
    draft: { subject: "", yes_criteria: "Sí si Proyecto Aurora ocurre." },
    radar_candidate: {
      source_question: vague,
      source_title: "Proyecto Aurora",
      source_resolution_rules: "Yes if Project Aurora occurs.",
    },
    repairable_content_issues: [{
      code: "UNRESOLVABLE_CONTRACT",
      field: "market_definition",
      message: "No se define qué significa que ocurra.",
    }],
  });
  const blocked = repair.buildDeterministicRepair(vagueContext, verifiedRepairSources(vagueContext));
  assert.equal(blocked.unresolved.code, "CONTRACT_PREDICATE_NOT_INFERABLE");
  assert.equal(blocked.unresolved.field, "market_definition");
  assert.deepEqual(blocked.patch, {});

  const specific = "¿Estudio Épsilon firmará un acuerdo con Editorial Boreal antes del 1 de enero de 2027?";
  const specificContext = releaseContext({
    question: specific,
    draft: {
      subject: "",
      yes_criteria: specific,
      evaluation_ends_at: "2026-12-31T23:59:59.000Z",
      closes_at: "2026-12-31T23:59:59.000Z",
      resolution_deadline: "2027-01-02T23:59:59.000Z",
    },
    radar_candidate: {
      source_question: specific,
      source_title: "Estudio Épsilon y Editorial Boreal",
      source_resolution_rules: specific,
    },
    repairable_content_issues: [{ code: "UNRESOLVABLE_CONTRACT", field: "market_definition" }],
  });
  assert.equal(repair.inferArchetype(specificContext), "deadline_ladder_child");
  assert.equal(repair.inferSubject(specificContext), "Estudio Épsilon");
  const repaired = repair.buildDeterministicRepair(specificContext, verifiedRepairSources(specificContext));
  assert.equal(repaired.unresolved, null);
  assert.equal(repaired.patch.question, specific);
  assert.doesNotMatch(repaired.patch.yes_criteria, /hecho binario descrito ocurrió/i);
});

test("Corrector adversarial · QUESTION_REQUIRED usa la procedencia y el validador local refleja la puerta SQL", () => {
  const canonical = "¿Ocurrirá el evento Aurora antes del 1 de enero de 2027?";
  const context = releaseContext({
    question: "¿Evento?",
    draft: {
      question: "¿Evento?",
      subject: "evento Aurora",
      yes_criteria: "¿Evento?",
      category: "Eventos",
      evaluation_ends_at: "2026-12-31T23:59:59.000Z",
      closes_at: "2026-12-31T23:59:59.000Z",
      resolution_deadline: "2027-01-02T23:59:59.000Z",
    },
    radar_candidate: {
      source_question: canonical,
      source_title: canonical,
      source_resolution_rules: canonical,
      atinara_category: "Eventos",
    },
    repairable_content_issues: [{ code: "QUESTION_REQUIRED", field: "question" }],
  });
  const result = repair.buildDeterministicRepair(context, verifiedRepairSources(context));
  const repaired = repair.applyRepairPatch(context.draft, result);
  assert.equal(result.unresolved, null);
  assert.equal(result.patch.question, canonical);
  assert.deepEqual(repair.validateRepairDraft(repaired), []);
  assert.ok(repair.validateRepairDraft({ ...repaired, question: "¿Evento?" }).includes("QUESTION_REQUIRED"));
  assert.ok(repair.validateRepairDraft({
    ...repaired,
    question: "¿Ocurrirá este evento pronto?",
  }).includes("QUESTION_AMBIGUOUS_TERM"));

  const ambiguousCandidate = releaseContext({
    question: "¿Ocurrirá este evento antes del 1 de enero de 2027?",
    draft: {
      question: "¿Ocurrirá este evento antes del 1 de enero de 2027?",
      subject: "Evento Aurora",
      yes_criteria: "¿Ocurrirá este evento antes del 1 de enero de 2027?",
      category: "Eventos",
      evaluation_ends_at: "2026-12-31T23:59:59.000Z",
      closes_at: "2026-12-31T23:59:59.000Z",
      resolution_deadline: "2027-01-02T23:59:59.000Z",
    },
    radar_candidate: {
      source_question: "¿Ocurrirá este evento antes del 1 de enero de 2027?",
      source_title: "Evento Aurora",
      source_resolution_rules: "¿Ocurrirá este evento antes del 1 de enero de 2027?",
      atinara_category: "Eventos",
    },
    repairable_content_issues: [{ code: "QUESTION_AMBIGUOUS_TERM", field: "question" }],
  });
  const synthesized = repair.buildDeterministicRepair(
    ambiguousCandidate,
    verifiedRepairSources(ambiguousCandidate),
  );
  const synthesizedDraft = repair.applyRepairPatch(ambiguousCandidate.draft, synthesized);
  assert.equal(synthesized.unresolved, null);
  assert.match(synthesized.patch.question, /^¿Ocurrirá Evento Aurora no más tarde de /);
  assert.doesNotMatch(synthesized.patch.question, /este evento|pronto/i);
  assert.deepEqual(repair.validateRepairDraft(synthesizedDraft), []);
});

test("Corrector adversarial · una alternativa heredada no cuenta sin pruebas de autoridad y relevancia", () => {
  const context = releaseContext({
    draft: {
      alternative_sources: [{ url: "https://example.com/completely-unrelated" }],
    },
  });
  const blocked = repair.buildDeterministicRepair(context, [primaryFor(context)]);
  assert.equal(blocked.unresolved.code, "ALTERNATIVE_SOURCE_UNAVAILABLE");
  assert.deepEqual(blocked.patch.alternative_sources, []);
  assert.ok(repair.validateRepairDraft(repair.applyRepairPatch(context.draft, blocked)).includes("ALTERNATIVE_SOURCE_REQUIRED"));

  const repaired = repair.buildDeterministicRepair(context, verifiedRepairSources(context));
  assert.equal(repaired.unresolved, null);
  assert.equal(repaired.patch.alternative_sources[0].authority_verified, true);
  assert.equal(repaired.patch.alternative_sources[0].relevance_verified, true);
  assert.match(fixerEdge, /get_market_radar_authoritative_source_domains_v1/);
  assert.match(fixerEdge, /include_domains: \[\.\.\.authoritativeDomains\]/);
  assert.match(fixerEdge, /relevance_basis: "fetched_content_v1"/);
  assert.match(fixerEdge, /return \{ sources: mergeAlternativeSources\(accepted\), warnings, evidenceChecked \}/);
});

test("Corrector adversarial · una PRIMARY heredada maliciosa no se autocertifica con una alternativa oficial", () => {
  const context = releaseContext({
    draft: {
      primary_source: {
        ...verifiedPrimarySource("https://acme-malicious.example/results"),
        name: "ACME malicious inherited source",
      },
    },
    radar_candidate: {
      source_resolution_url: "https://acme-malicious.example/results",
    },
  });
  const result = repair.buildDeterministicRepair(context, [verifiedSource()]);
  assert.equal(result.unresolved.code, "PRIMARY_RESOLUTION_SOURCE_UNVERIFIED");
  assert.equal(result.unresolved.field, "primary_source");
  assert.deepEqual(result.patch, {});
  assert.equal(repair.inferPrimarySource(context), null);
});

test("Corrector adversarial · registro, categoría y rol primary_resolution son requisitos cerrados", () => {
  const global = registrySource();
  const scoped = registrySource({
    id: "22222222-2222-4222-8222-222222222222",
    domain: "games.example.com",
    categories: ["Lanzamientos"],
  });
  const wrongRole = registrySource({
    id: "33333333-3333-4333-8333-333333333333",
    domain: "wrong-role.example.com",
    roles: ["radar_fact_evidence"],
  });
  assert.deepEqual(
    repair.normalizePrimarySourceRegistry([global, scoped, wrongRole]).map((row) => row.id).sort(),
    [global.id, scoped.id].sort(),
  );
  assert.equal(
    repair.primarySourceRegistryEntry("https://games.example.com/project-aurora", [scoped], "Lanzamientos").id,
    scoped.id,
  );
  assert.equal(repair.primarySourceRegistryEntry(
    "https://games.example.com/project-aurora", [scoped], "Reviews/Premios",
  ), null);
  assert.equal(repair.primarySourceRegistryEntry(
    "https://wrong-role.example.com/project-aurora", [wrongRole], "Lanzamientos",
  ), null);
});

test("Corrector adversarial · una PRIMARY ausente se investiga solo en registry y el snippet nunca sustituye al GET", async () => {
  const context = releaseContext({
    draft: { primary_source: null },
    radar_candidate: { source_resolution_url: null },
  });
  const registry = [registrySource()];
  const fetched = [];
  const result = await repair.discoverRegisteredPrimarySource(context, registry, {
    candidates: [],
    searcher: async ({ subject, archetype, domains }) => {
      assert.match(subject, /Proyecto Aurora/i);
      assert.equal(archetype, "product_release");
      assert.deepEqual(domains, ["official.example.com"]);
      return {
        sources: [
          {
            url: "https://official.example.com/unrelated?product=project-aurora",
            title: "Project Aurora official release page",
            content: "Un snippet no descargado afirma una fecha de lanzamiento.",
          },
          { url: "https://official.example.com/project-aurora/release", title: "Project Aurora" },
        ],
        warning: null,
      };
    },
    fetcher: async (url) => {
      fetched.push(url);
      const body = url.includes("/unrelated")
        ? "Official corporate website and latest news."
        : "Project Aurora official commercial release information.";
      return new Response(body, { status: 200, headers: { "content-type": "text/html" } });
    },
    validation_options: { now: "2026-08-09T12:00:00Z" },
  });
  assert.deepEqual(fetched, [
    "https://official.example.com/unrelated?product=project-aurora",
    "https://official.example.com/project-aurora/release",
  ]);
  assert.equal(result.evidenceChecked[0].code, "PRIMARY_SOURCE_IRRELEVANT");
  assert.equal(result.source.url, "https://official.example.com/project-aurora/release");
  assert.equal(result.checkSnapshot.candidate_origin, "registry_search");
  assert.equal(result.checkSnapshot.accepted, true);

  const unavailable = await repair.discoverRegisteredPrimarySource(context, registry, {
    candidates: [],
    fetcher: async () => { throw new Error("no debe descargar sin candidato"); },
  });
  assert.equal(unavailable.source, null);
  assert.deepEqual(unavailable.warnings, ["PRIMARY_SOURCE_DISCOVERY_NOT_CONFIGURED"]);
  assert.equal(
    repair.buildDeterministicRepair(context, []).unresolved.code,
    "PRIMARY_RESOLUTION_SOURCE_UNVERIFIED",
  );
});

test("Corrector adversarial · CATEGORY_REQUIRED usa la misma categoría derivada en registry, snapshot y patch", async () => {
  const context = releaseContext({
    draft: { category: null, primary_source: null },
    radar_candidate: { atinara_category: null, source_resolution_url: null },
    repairable_content_issues: [{
      code: "CATEGORY_REQUIRED",
      field: "category",
      message: "Falta la categoría.",
    }],
  });
  const proposedCategory = repair.inferRepairCategory(context);
  assert.equal(proposedCategory, "Lanzamientos");
  const repairContext = { ...context, proposed_category: proposedCategory };
  const discovery = await repair.discoverRegisteredPrimarySource(
    repairContext,
    [registrySource({ categories: ["Lanzamientos"] })],
    {
      candidates: [],
      searcher: async ({ domains }) => ({
        sources: [{ url: `https://${domains[0]}/project-aurora/release` }],
        warning: null,
      }),
      fetcher: async () => new Response("Project Aurora official commercial release information.", {
        status: 200,
        headers: { "content-type": "text/html" },
      }),
      validation_options: { now: "2026-08-09T12:00:00Z" },
    },
  );
  assert.equal(discovery.checkSnapshot.draft_category, proposedCategory);
  const deterministic = repair.buildDeterministicRepair(
    repairContext,
    [discovery.source, verifiedSource()],
  );
  assert.equal(deterministic.unresolved, null);
  assert.equal(deterministic.patch.category, discovery.checkSnapshot.draft_category);

  const unknowable = {
    draft: {
      question: "¿Ocurrirá el hecho X antes del 1 de septiembre de 2026?",
      yes_criteria: "Sí si ocurre el hecho X.",
      category: null,
    },
    radar_candidate: {},
    repairable_content_issues: [{ code: "CATEGORY_REQUIRED", field: "category" }],
  };
  assert.equal(repair.inferRepairCategory(unknowable), null);
  assert.equal(
    repair.buildDeterministicRepair(unknowable, []).unresolved.code,
    "CATEGORY_NOT_INFERABLE",
  );
});

test("Corrector adversarial · el presupuesto global corta muchas fuentes lentas antes de otra descarga o escritura", async () => {
  const context = releaseContext();
  let fetchCalls = 0;
  let searchCalls = 0;
  const result = await repair.discoverRegisteredPrimarySource(
    context,
    [registrySource()],
    {
      candidates: Array.from({ length: 20 }, (_, index) => ({
        url: `https://official.example.com/project-aurora/${index}`,
        origin: "candidate_evidence",
      })),
      fetcher: async () => {
        fetchCalls += 1;
        return new Promise(() => {});
      },
      searcher: async () => {
        searchCalls += 1;
        return { sources: [], warning: null };
      },
      max_declared_candidates: 8,
      validation_options: {
        deadline_at: 1_000,
        clock: () => 1_000,
        now: "2026-08-09T12:00:00Z",
      },
    },
  );
  assert.equal(result.source, null);
  assert.equal(fetchCalls, 0);
  assert.equal(searchCalls, 0);
  assert.equal(result.evidenceChecked.length, 1);
  assert.equal(result.evidenceChecked[0].code, "SOURCE_VALIDATION_BUDGET_EXHAUSTED");
  assert.deepEqual(result.warnings, ["SOURCE_VALIDATION_BUDGET_EXHAUSTED"]);
  assert.match(fixerEdge, /SOURCE_VALIDATION_BUDGET_MS = 75_000/);
  assert.match(fixerEdge, /AbortSignal\.timeout\(SOURCE_VALIDATION_BUDGET_MS\)/);
  assert.match(fixerEdge, /MIN_POST_WRITE_BUDGET_MS/);
  assert.match(fixerEdge, /repairSaved \? 200 : 503/);
  assert.match(fixerEdge, /new_version: expectedVersion/);
  assert.match(fixerEdge, /candidates\.slice\(0, 6\)/);
  assert.match(fixerEdge, /slice\(0, 4\)/);
});

test("Corrector adversarial · PRIMARY valida redirects registrados y bloquea salto no autorizado", async () => {
  const context = releaseContext();
  const registry = [registrySource()];
  const acceptedFetch = async (url) => {
    if (url === "https://official.example.com/project-aurora") {
      return new Response(null, {
        status: 302,
        headers: { location: "https://news.official.example.com/project-aurora-release" },
      });
    }
    return new Response("Project Aurora official commercial release information.", {
      status: 200,
      headers: { "content-type": "text/html" },
    });
  };
  const accepted = await repair.validateRegisteredPrimarySource(
    { url: "https://official.example.com/project-aurora", origin: "candidate_canonical" },
    { ...context, source_validation_category: "Lanzamientos" },
    registry,
    acceptedFetch,
    { now: "2026-08-09T12:00:00Z" },
  );
  assert.equal(accepted.evidence.accepted, true);
  assert.equal(accepted.evidence.redirect_count, 1);
  assert.equal(accepted.evidence.registry_source_id, registry[0].id);
  assert.equal(accepted.evidence.registry_parser_version, registry[0].parser_version);
  assert.equal(accepted.evidence.registry_role, "primary_resolution");
  assert.equal(accepted.evidence.draft_category, "Lanzamientos");
  assert.equal("excerpt" in accepted.evidence, false);
  assert.equal(accepted.source.url, "https://news.official.example.com/project-aurora-release");

  const rejected = await repair.validateRegisteredPrimarySource(
    { url: "https://official.example.com/project-aurora", origin: "candidate_canonical" },
    context,
    registry,
    async () => new Response(null, {
      status: 302,
      headers: { location: "https://acme-malicious.example/project-aurora" },
    }),
    { now: "2026-08-09T12:00:00Z" },
  );
  assert.equal(rejected.source, null);
  assert.equal(rejected.evidence.code, "PRIMARY_SOURCE_REDIRECT_NOT_AUTHORIZED");
});

test("Corrector adversarial · un dominio registrado no vuelve relevante una ruta oficial ajena", async () => {
  const context = releaseContext({
    draft: { primary_source: { url: "https://ea.com/news/2026-financial-results" } },
    radar_candidate: { source_resolution_url: "https://ea.com/news/2026-financial-results" },
  });
  const result = await repair.validateRegisteredPrimarySource(
    { url: "https://ea.com/news/2026-financial-results", origin: "candidate_canonical" },
    context,
    [registrySource({ domain: "ea.com" })],
    async () => new Response("Electronic Arts quarterly financial results for fiscal 2026.", {
      status: 200,
      headers: { "content-type": "text/html" },
    }),
    { now: "2026-08-09T12:00:00Z" },
  );
  assert.equal(result.source, null);
  assert.equal(result.evidence.code, "PRIMARY_SOURCE_IRRELEVANT");

  const fcQuestion = "Will EA Sports FC 27 release before October 2026?";
  const fcContext = {
    draft: { question: fcQuestion, subject: "EA Sports FC 27", category: "Lanzamientos", yes_criteria: fcQuestion },
    radar_candidate: { source_question: fcQuestion, source_resolution_rules: fcQuestion },
  };
  const genericFc = await repair.validateRegisteredPrimarySource(
    { url: "https://ea.com/sports", origin: "candidate_canonical" },
    fcContext,
    [registrySource({ domain: "ea.com" })],
    async () => new Response("EA Sports official website and latest sports news.", {
      status: 200,
      headers: { "content-type": "text/html" },
    }),
    { now: "2026-08-09T12:00:00Z" },
  );
  assert.equal(genericFc.source, null);
  assert.equal(genericFc.evidence.code, "PRIMARY_SOURCE_IRRELEVANT");

  const querySpoof = await repair.validateRegisteredPrimarySource(
    { url: "https://ea.com/unrelated?product=ea-fc-27", origin: "draft_inherited" },
    fcContext,
    [registrySource({ domain: "ea.com" })],
    async () => new Response("EA Sports official website and latest sports news.", {
      status: 200,
      headers: { "content-type": "text/html" },
    }),
    { now: "2026-08-09T12:00:00Z" },
  );
  assert.equal(querySpoof.source, null);
  assert.equal(querySpoof.evidence.code, "PRIMARY_SOURCE_IRRELEVANT");

  const inventedPath = await repair.validateRegisteredPrimarySource(
    { url: "https://ea.com/unrelated/ea-sports-fc-27", origin: "draft_inherited" },
    fcContext,
    [registrySource({ domain: "ea.com" })],
    async () => new Response("EA Sports official website and latest sports news.", {
      status: 200,
      headers: { "content-type": "text/html" },
    }),
    { now: "2026-08-09T12:00:00Z" },
  );
  assert.equal(inventedPath.source, null);
  assert.equal(inventedPath.evidence.code, "PRIMARY_SOURCE_IRRELEVANT");

  const canonicalFc = await repair.validateRegisteredPrimarySource(
    { url: "https://ea.com/games/ea-sports-fc/fc-27", origin: "candidate_canonical" },
    fcContext,
    [registrySource({ domain: "ea.com" })],
    async () => new Response("EA Sports FC 27 official release information.", {
      status: 200,
      headers: { "content-type": "text/html" },
    }),
    { now: "2026-08-09T12:00:00Z" },
  );
  assert.equal(canonicalFc.evidence.accepted, true);
  assert.ok(canonicalFc.evidence.matched_tokens.includes("fc27"));
});

test("Corrector adversarial · PRIMARY expande acrónimos con romano sin aceptar colisiones", () => {
  const fixtures = [
    ["Will GTA VI be released before January 1, 2027?", "Grand Theft Auto VI official release information."],
    ["Will TES VI be released before January 1, 2027?", "The Elder Scrolls VI official release information."],
  ];
  for (const [question, excerpt] of fixtures) {
    const context = releaseContext({
      question,
      draft: { subject: "", yes_criteria: question },
      radar_candidate: { source_question: question, source_title: question, source_resolution_rules: question },
    });
    const relevance = repair.primarySourceRelevance({
      url: "https://official.example.com/releases",
      excerpt,
    }, context);
    assert.equal(relevance.accepted, true);
  }
  const gta = releaseContext({
    question: "Will GTA VI be released before January 1, 2027?",
    draft: { subject: "" },
    radar_candidate: {
      source_question: "Will GTA VI be released before January 1, 2027?",
      source_title: "GTA VI",
      source_resolution_rules: "Will GTA VI be released before January 1, 2027?",
    },
  });
  assert.equal(repair.primarySourceRelevance({
    url: "https://official.example.com/releases",
    excerpt: "Grand Theft Auto VI and Global Trade Alliance VI official release information.",
  }, gta).accepted, false);
  const romanOnly = releaseContext({
    question: "Will VI be released before January 1, 2027?",
    draft: { subject: "" },
    radar_candidate: {
      source_question: "Will VI be released before January 1, 2027?",
      source_title: "VI",
      source_resolution_rules: "Will VI be released before January 1, 2027?",
    },
  });
  assert.equal(repair.primarySourceRelevance({
    url: "https://official.example.com/releases",
    excerpt: "Grand Theft Auto VI official release information.",
  }, romanOnly).accepted, false);
});

test("Corrector adversarial · content-release extrae sujeto EN y conserva duración locale", () => {
  const subjectFixtures = [
    ["Will another GTA VI trailer come out before Oct 2026?", "GTA VI"],
    ["Will Project Aurora have a new trailer before January 1, 2027?", "Project Aurora"],
  ];
  for (const [question, expectedSubject] of subjectFixtures) {
    const context = releaseContext({
      question,
      draft: { subject: "", yes_criteria: question },
      radar_candidate: { source_question: question, source_title: question, source_resolution_rules: question },
    });
    assert.equal(repair.inferArchetype(context), "content_release");
    assert.equal(repair.inferSubject(context), expectedSubject);
    const result = repair.buildDeterministicRepair(context, verifiedRepairSources(context));
    assert.equal(result.unresolved, null);
    assert.equal(result.patch.subject, expectedSubject);
    assert.doesNotMatch(result.patch.question, /tráiler de .*trailer/i);
  }

  const durationFixtures = [
    "Will Project Aurora have a new trailer of at least 1,000 seconds before January 1, 2027?",
    "¿Proyecto Aurora tendrá un nuevo tráiler de al menos 1.000 segundos antes del 1 de enero de 2027?",
  ];
  for (const question of durationFixtures) {
    const context = releaseContext({
      question,
      draft: { subject: "", yes_criteria: question },
      radar_candidate: { source_question: question, source_title: question, source_resolution_rules: question },
    });
    const result = repair.buildDeterministicRepair(context, verifiedRepairSources(context));
    assert.equal(result.unresolved, null);
    assert.match(result.patch.question, /al menos 1000 segundos/);
    assert.match(result.patch.yes_criteria, /al menos 1000 segundos/);
  }

  const tooLong = "Will Project Aurora have a new trailer of at least 10,000 seconds before January 1, 2027?";
  const blockedContext = releaseContext({
    question: tooLong,
    draft: { subject: "", yes_criteria: tooLong },
    radar_candidate: { source_question: tooLong, source_title: tooLong, source_resolution_rules: tooLong },
  });
  const blocked = repair.buildDeterministicRepair(blockedContext, verifiedRepairSources(blockedContext));
  assert.equal(blocked.unresolved.code, "ARCHETYPE_SLOT_NOT_INFERABLE");
  assert.equal(blocked.unresolved.field, "duration");
  assert.deepEqual(blocked.patch, {});
});

test("Corrector adversarial · milestone conserva agrupación locale y falla en separadores ambiguos", () => {
  const fixtures = [
    ["¿Canal Aurora superará 1.000.000 suscriptores antes del 1 de enero de 2027?", 1_000_000, "suscriptores"],
    ["¿Canal Aurora superará 1,000,000 suscriptores antes del 1 de enero de 2027?", 1_000_000, "suscriptores"],
    ["Will Canal Aurora exceed 1,000,000 subscribers before January 1, 2027?", 1_000_000, "subscribers"],
    ["¿Canal Aurora superará 1,5 millones antes del 1 de enero de 2027?", 1.5, "millones"],
  ];
  for (const [question, threshold, unit] of fixtures) {
    const context = releaseContext({
      question,
      draft: { subject: "", yes_criteria: question, category: "Industria" },
      radar_candidate: { source_question: question, source_title: question, source_resolution_rules: question, atinara_category: "Industria" },
    });
    const result = repair.buildDeterministicRepair(context, verifiedRepairSources(context));
    assert.equal(result.archetype, "milestone_threshold");
    assert.equal(result.unresolved, null);
    assert.match(result.patch.question, new RegExp(`más de ${String(threshold).replace(".", "\\.")} ${unit}`));
    assert.match(result.patch.yes_criteria, new RegExp(`> ${String(threshold).replace(".", "\\.")} ${unit}`));
    const repaired = repair.applyRepairPatch(context.draft, result);
    const plan = repair.buildResolutionPlan(context, repaired, [{ role: "PRIMARY_RESOLUTION", url: result.patch.primary_source.url }], result.archetype);
    assert.equal(plan.operator, ">");
    assert.equal(plan.threshold, threshold);
    assert.equal(plan.unit, unit);
  }

  const ambiguousQuestion = "¿Canal Aurora superará 1,000 antes del 1 de enero de 2027?";
  const ambiguous = releaseContext({
    question: ambiguousQuestion,
    draft: { subject: "", yes_criteria: ambiguousQuestion, category: "Industria" },
    radar_candidate: {
      source_question: ambiguousQuestion,
      source_title: ambiguousQuestion,
      source_resolution_rules: ambiguousQuestion,
      atinara_category: "Industria",
    },
  });
  const blocked = repair.buildDeterministicRepair(ambiguous, verifiedRepairSources(ambiguous));
  assert.equal(blocked.unresolved.code, "METRIC_NOT_INFERABLE");
  assert.deepEqual(blocked.patch, {});
});

test("Corrector adversarial · cada campo material de la atestación PRIMARY es obligatorio", () => {
  const context = releaseContext();
  const primary = primaryFor(context);
  assert.equal(repair.isVerifiedPrimarySource(primary, context.draft.category), true);
  for (const [field, value] of [
    ["registry_source_id", null],
    ["registry_domain", "malicious.example"],
    ["registry_parser_version", ""],
    ["registry_role", "radar_fact_evidence"],
    ["registry_role_verified", false],
    ["registry_categories", ["eventos"]],
    ["draft_category", "Eventos"],
    ["authority_basis", "inherited_flags"],
    ["relevance_basis", "canonical_url_v1"],
    ["validation_version", "legacy"],
    ["validated_reachable", false],
    ["authority_verified", false],
    ["relevance_verified", false],
    ["registry_role_verified", false],
  ]) {
    const tampered = { ...primary, [field]: value };
    assert.equal(repair.isVerifiedPrimarySource(tampered, context.draft.category), false, field);
    const result = repair.buildDeterministicRepair(context, [tampered, verifiedSource()]);
    assert.equal(result.unresolved.code, "PRIMARY_RESOLUTION_SOURCE_UNVERIFIED", field);
  }
});

test("Corrector adversarial · SQL 170 cierra DML raw y expone configuración B2B admin auditada", () => {
  assert.match(primarySourceV1Migration, /security definer[\s\S]*SERVICE_ROLE_REQUIRED/);
  assert.match(primarySourceV1Migration, /revoke all on table private\.market_source_registry from public, anon, authenticated, service_role/);
  assert.match(primarySourceV1Migration, /revoke all on table private\.market_draft_primary_source_checks from service_role/);
  assert.match(primarySourceV1Migration, /revoke execute on function public\.apply_market_draft_expert_repair\([\s\S]*service_role/);
  assert.doesNotMatch(primarySourceV1Migration, /'canonical_url_v1'/);
  assert.match(primarySourceV1Migration, /registry_role_verified/);
  assert.match(primarySourceV1Migration, /registry_categories_value/);
  assert.match(primarySourceV1Migration, /list_market_authoritative_source_registry_admin_v1/);
  assert.match(primarySourceV1Migration, /upsert_market_authoritative_source_registry_admin_v1/);
  assert.match(primarySourceV1Migration, /deactivate_market_authoritative_source_registry_admin_v1/);
  assert.match(primarySourceV1Migration, /SOURCE_REGISTRY_ROLE_BOUNDARY_CONFLICT/);
  assert.match(primarySourceV1Migration, /MARKET_SOURCE_REGISTRY_UPSERTED/);
  assert.match(primarySourceV1Migration, /MARKET_SOURCE_REGISTRY_DEACTIVATED/);
  assert.match(primarySourceV1SqlTest, /set local role service_role/);
  assert.match(primarySourceV1SqlTest, /TEST_SERVICE_RAW_CHECK_INSERT_SUCCEEDED/);
  assert.match(primarySourceV1SqlTest, /TEST_TAMPERED_PRIMARY_EVIDENCE_ACCEPTED/);
  assert.match(primarySourceV1SqlTest, /TEST_EXPIRED_PRIMARY_CHECK_ACCEPTED/);
  assert.match(primarySourceV1SqlTest, /TEST_VALID_PRIMARY_APPLY_FAILED/);
  assert.match(primarySourceV1SqlTest, /TEST_NON_ADMIN_REGISTRY_UPSERT_SUCCEEDED/);
  assert.match(primarySourceV1SqlTest, /TEST_REGISTRY_ADMIN_TAMPER_ACCEPTED/);
  assert.match(primarySourceV1SqlTest, /TEST_REGISTRY_ADMIN_UPSERT_NOT_IDEMPOTENT/);
  assert.match(primarySourceV1SqlTest, /TEST_PROVIDER_FACT_ELEVATED_TO_PRIMARY/);
  assert.match(primarySourceV1SqlTest, /TEST_REGISTRY_ADMIN_DEACTIVATION_NOT_IDEMPOTENT/);
  assert.match(primarySourceV1SqlTest, /TEST_PRIMARY_REPAIR_TOUCHED_PUBLICATION_OR_ECONOMY/);
  assert.match(primarySourceV1SqlTest, /rollback;\s*$/);
});

test("Corrector adversarial · safePublicUrl bloquea literales locales IPv4 e IPv6", () => {
  for (const url of [
    "https://127.0.0.1/",
    "https://10.0.0.1/",
    "https://169.254.169.254/latest/meta-data/",
    "https://[::1]/",
    "https://[fc00::1]/",
    "https://[fd00::1]/",
    "https://[fe80::1]/",
    "https://[fec0::1]/",
    "https://[ff02::1]/",
    "https://[::7f00:1]/",
    "https://[::ffff:127.0.0.1]/",
    "https://intranet/",
    "https://router.lan/",
    "https://router.home.arpa/",
    "https://service.internal/",
  ]) assert.equal(repair.safePublicUrl(url), null, url);
  assert.equal(repair.safePublicUrl("https://[2001:4860:4860::8888]/"), "https://[2001:4860:4860::8888]/");
  assert.equal(repair.safePublicUrl("https://example.com/results"), "https://example.com/results");
});

test("Corrector adversarial · Marvel deriva el ancla desde una frase oficial normal", () => {
  const question = "¿Marvel Tokon: Fighting Souls tendrá una puntuación en Metacritic superior a 95 siete días después de su lanzamiento?";
  const context = {
    draft: {
      market_slug: "marvel-tokon-fighting-souls-metacritic-score",
      question,
      subject: "",
      category: "Reviews/Premios",
      yes_option: "Sí",
      no_option: "No",
      yes_criteria: "La puntuación de Metacritic será superior a 95 siete días después del lanzamiento.",
      primary_source: { url: "https://www.metacritic.com/game/marvel-tokon-fighting-souls/" },
      alternative_sources: [],
      resolution_deadline: "2026-08-20T14:00:00Z",
    },
    radar_candidate: {
      source_question: "Will Marvel Tokon: Fighting Souls have a Metacritic score above 95 seven days after release?",
      source_resolution_rules: "Resolves at 10:00 AM ET seven days after the general contractual release.",
      source_resolution_deadline: "2026-08-20T14:00:00Z",
    },
  };
  const official = verifiedSource(
    "https://blog.playstation.com/2026/02/12/marvel-tokon-fighting-souls-arrives-on-ps5-pc-august-6/",
    "Marvel Tōkon: Fighting Souls launches on August 6, 2026.",
  );
  const result = repair.buildDeterministicRepair(context, [
    primaryFor(context, "Marvel Tokon: Fighting Souls official Metacritic game page."),
    official,
  ]);
  assert.equal(result.unresolved, null);
  assert.equal(result.patch.evaluation_ends_at, "2026-08-13T14:00:00.000Z");
  assert.equal(result.patch.closes_at, "2026-08-13T14:00:00.000Z");
  assert.equal(result.temporal_contract.anchor_date, "2026-08-06");
  assert.equal(result.temporal_contract.source_url, official.url);
});

test("Corrector adversarial · User Score > 8 conserva métrica, escala, fuente, operador y agregación", () => {
  const question = "Will Marvel Tokon: Fighting Souls have a Metacritic User Score > 8 seven days after release?";
  const context = {
    draft: {
      market_slug: "marvel-tokon-fighting-souls-user-score",
      question,
      subject: "",
      category: "Reviews/Premios",
      yes_option: "Sí",
      no_option: "No",
      yes_criteria: question,
      primary_source: { url: "https://www.metacritic.com/game/marvel-tokon-fighting-souls/" },
      resolution_deadline: "2026-08-20T16:00:00Z",
    },
    radar_candidate: {
      source_question: question,
      source_resolution_rules: "Resolves at 10:00 AM ET seven days after release.",
    },
  };
  const official = verifiedSource(
    "https://blog.playstation.com/2026/02/12/marvel-tokon-fighting-souls-arrives-on-ps5-pc-august-6/",
    "Marvel Tōkon: Fighting Souls launches on August 6, 2026.",
  );
  const metric = repair.inferMetricContract(context);
  assert.deepEqual(
    {
      metric: metric.metric,
      kind: metric.metric_kind,
      source: metric.source_name,
      domain: metric.source_domain,
      operator: metric.operator,
      threshold: metric.threshold,
      scale: [metric.scale_min, metric.scale_max],
      precision: metric.precision,
      aggregation: metric.aggregation,
    },
    {
      metric: "User Score de Metacritic",
      kind: "user",
      source: "Metacritic",
      domain: "metacritic.com",
      operator: ">",
      threshold: 8,
      scale: [0, 10],
      precision: 1,
      aggregation: "maximum",
    },
  );

  const result = repair.buildDeterministicRepair(context, [
    primaryFor(context, "Marvel Tokon: Fighting Souls official Metacritic User Score page."),
    official,
  ]);
  assert.equal(result.archetype, "metric_threshold");
  assert.equal(result.unresolved, null);
  assert.equal(result.patch.subject, "Marvel Tokon: Fighting Souls");
  assert.match(result.patch.question, /User Score de Metacritic/);
  assert.match(result.patch.yes_criteria, /\(> 8\).*escala contractual de 0 a 10/);
  assert.doesNotMatch(result.patch.question, /Metascore de crítica/);
  assert.match(result.patch.edge_cases, /Metascore de crítica queda excluido/);

  const repaired = repair.applyRepairPatch(context.draft, result);
  const plan = repair.buildResolutionPlan(
    { ...context, repair_temporal_contract: result.temporal_contract },
    repaired,
    [{ role: "PRIMARY_RESOLUTION", url: context.draft.primary_source.url }],
    result.archetype,
  );
  assert.equal(plan.metric, "User Score de Metacritic");
  assert.equal(plan.operator, ">");
  assert.equal(plan.threshold, 8);
  assert.equal(plan.scale_max, 10);
  assert.equal(plan.precision, 1);
  assert.equal(plan.aggregation, "maximum");
  assert.match(plan.platform_policy, /mismo juego y edición contractuales/);
  assert.match(plan.metric_missing_data_treatment, /al menos una ficha elegible/);
  assert.match(plan.manual_review_instructions, /excluir Metascore de crítica/);

  const contradictory = structuredClone(context);
  contradictory.radar_candidate.source_resolution_rules =
    "Use the Metacritic critic Metascore > 95 at 10:00 AM ET seven days after release.";
  const blocked = repair.buildDeterministicRepair(contradictory, [
    primaryFor(contradictory, "Marvel Tokon: Fighting Souls official Metacritic User Score page."),
    official,
  ]);
  assert.equal(blocked.archetype, "metric_threshold");
  assert.equal(blocked.unresolved.code, "METRIC_NOT_INFERABLE");
  assert.equal(blocked.unresolved.field, "metric_contract");
  assert.deepEqual(blocked.patch, {});
});

test("Corrector adversarial · números métricos locale nunca se truncan ni exceden la precisión contractual", () => {
  const contextFor = (question) => ({
    draft: {
      market_slug: "project-aurora-metric",
      question: "¿Métrica inválida?",
      subject: "",
      category: "Reviews/Premios",
      yes_option: "Sí",
      no_option: "No",
      yes_criteria: "",
      primary_source: { url: "https://www.metacritic.com/game/project-aurora/" },
      evaluation_ends_at: "2026-12-31T23:59:59.000Z",
      closes_at: "2026-12-31T23:59:59.000Z",
      resolution_deadline: "2027-01-02T23:59:59.000Z",
    },
    radar_candidate: {
      source_question: question,
      source_resolution_rules: question,
      source_resolution_url: "https://www.metacritic.com/game/project-aurora/",
    },
    repairable_content_issues: [{ code: "INVALID_METRIC", field: "question" }],
  });

  for (const [question, expected] of [
    ["Will Project Aurora have a Metacritic score above 95 before January 1, 2027?", { operator: ">", threshold: 95, kind: "critic" }],
    ["Will Project Aurora have a Metacritic score >= 95 before January 1, 2027?", { operator: ">=", threshold: 95, kind: "critic" }],
    ["Will Project Aurora have a Metacritic User Score > 8 before January 1, 2027?", { operator: ">", threshold: 8, kind: "user" }],
    ["Will Project Aurora have a Metacritic User Score > 8.5 before January 1, 2027?", { operator: ">", threshold: 8.5, kind: "user" }],
    ["¿Tendrá Proyecto Aurora un User Score de Metacritic superior a 8,5 antes del 1 de enero de 2027?", { operator: ">", threshold: 8.5, kind: "user" }],
  ]) {
    const metric = repair.inferMetricContract(contextFor(question));
    assert.ok(metric, question);
    assert.equal(metric.operator, expected.operator, question);
    assert.equal(metric.threshold, expected.threshold, question);
    assert.equal(metric.metric_kind, expected.kind, question);
    assert.equal(metric.aggregation, "maximum", question);
  }

  for (const question of [
    "Will Project Aurora have a Metacritic score above 1,000 before January 1, 2027?",
    "¿Tendrá Proyecto Aurora una puntuación en Metacritic superior a 1.000 antes del 1 de enero de 2027?",
    "Will Project Aurora have a Metacritic User Score > 8.00 before January 1, 2027?",
    "Will Project Aurora have a Metacritic score above 95.0 before January 1, 2027?",
  ]) {
    const context = contextFor(question);
    assert.equal(repair.inferMetricContract(context), null, question);
    const result = repair.buildDeterministicRepair(context, [
      primaryFor(context, "Project Aurora official Metacritic score page."),
    ]);
    assert.equal(result.unresolved.code, "METRIC_NOT_INFERABLE", question);
    assert.deepEqual(result.patch, {}, question);
  }
});

test("Corrector adversarial · la dimensión métrica se infiere del contrato o escala con código específico", () => {
  const base = (question, rules = question) => ({
    draft: {
      market_slug: "marvel-tokon-metric-dimension",
      question,
      subject: "",
      category: "Reviews/Premios",
      yes_option: "Sí",
      no_option: "No",
      yes_criteria: rules,
      primary_source: { url: "https://www.metacritic.com/game/marvel-tokon-fighting-souls/" },
      evaluation_ends_at: "2026-12-31T23:59:59.000Z",
      closes_at: "2026-12-31T23:59:59.000Z",
      resolution_deadline: "2027-01-02T23:59:59.000Z",
    },
    radar_candidate: {
      source_question: question,
      source_resolution_rules: rules,
      source_resolution_url: "https://www.metacritic.com/game/marvel-tokon-fighting-souls/",
    },
    repairable_content_issues: [{ code: "INVALID_METRIC", field: "yes_criteria" }],
  });

  const existentialQuestion = "Will Marvel Tokon: Fighting Souls have a Metacritic score above 95 before January 1, 2027?";
  const existential = base(existentialQuestion);
  const repaired = repair.buildDeterministicRepair(existential, [
    primaryFor(existential, "Marvel Tokon: Fighting Souls official Metacritic score page."),
    verifiedSource(
      "https://blog.playstation.com/marvel-tokon-fighting-souls/",
      "Marvel Tokon: Fighting Souls official release information.",
    ),
  ]);
  assert.equal(repaired.unresolved, null);
  assert.equal(repair.inferMetricContract(existential).aggregation, "maximum");
  assert.match(repaired.patch.yes_criteria, /mayor Metascore/);
  assert.match(repaired.patch.edge_cases, /mismo juego y edición contractuales/);
  assert.match(repaired.patch.no_criteria, /al menos una ficha elegible/);

  const scoped = repair.inferMetricContract(base(
    "Will Marvel Tokon: Fighting Souls have the Metacritic score for PlayStation 5 above 95 before January 1, 2027?",
  ));
  assert.equal(scoped.aggregation, "single_platform");
  assert.equal(scoped.platform, "PlayStation 5");

  const average = repair.inferMetricContract(base(
    "Will Marvel Tokon: Fighting Souls have the Metacritic score above 95 before January 1, 2027?",
    "Use the arithmetic average of Metacritic scores across every eligible platform.",
  ));
  assert.equal(average.aggregation, "arithmetic_mean");

  const ambiguous = base(
    "Will Marvel Tokon: Fighting Souls have the Metacritic score above 95 before January 1, 2027?",
  );
  assert.equal(repair.inferMetricContract(ambiguous), null);
  const blocked = repair.buildDeterministicRepair(ambiguous, [
    primaryFor(ambiguous, "Marvel Tokon: Fighting Souls official Metacritic score page."),
  ]);
  assert.equal(blocked.unresolved.code, "METRIC_DIMENSION_NOT_INFERABLE");
  assert.equal(blocked.unresolved.field, "metric_dimension");
  assert.deepEqual(blocked.patch, {});
});

test("Corrector adversarial · la matriz de capacidades B2B nunca promete una reparación incondicional", () => {
  const allowed = new Set([
    "deterministic_repair_or_specific_escalation",
    "research_then_repair_or_specific_escalation",
    "repair_or_specific_escalation",
  ]);
  for (const [code, capability] of Object.entries(repair.REPAIR_ISSUE_CAPABILITIES)) {
    assert.ok(allowed.has(capability.disposition), `${code}: ${capability.disposition}`);
    assert.notEqual(capability.disposition, "deterministic_repair", code);
    assert.notEqual(capability.disposition, "research_then_repair", code);
  }
  for (const code of [
    "MISSING_RESOLUTION_SOURCE",
    "PRIMARY_SOURCE_INVALID",
    "ALTERNATIVE_SOURCE_REQUIRED",
    "ALTERNATIVE_SOURCE_INVALID",
    "INSUFFICIENT_EVIDENCE",
  ]) {
    assert.equal(
      repair.REPAIR_ISSUE_CAPABILITIES[code].disposition,
      "research_then_repair_or_specific_escalation",
    );
  }
  for (const code of ["AMBIGUOUS_SUBJECT", "CONTRADICTORY_CRITERIA", "UNRESOLVABLE_CONTRACT"]) {
    assert.equal(repair.REPAIR_ISSUE_CAPABILITIES[code].disposition, "repair_or_specific_escalation");
  }

  const withoutPeriod = {
    draft: {
      market_slug: "project-aurora-no-period",
      question: "Will Project Aurora be released?",
      subject: "",
      category: "Lanzamientos",
      yes_criteria: "Project Aurora is commercially released.",
      primary_source: { url: "https://official.example.com/project-aurora" },
    },
    radar_candidate: {
      source_question: "Will Project Aurora be released?",
      source_resolution_rules: "Project Aurora is commercially released.",
    },
    repairable_content_issues: [{ code: "PERIOD_REQUIRED", field: "evaluation_ends_at" }],
  };
  const outcome = repair.buildDeterministicRepair(withoutPeriod, verifiedRepairSources(withoutPeriod));
  assert.equal(
    repair.repairIssuePlan(withoutPeriod).dispositions.PERIOD_REQUIRED,
    "deterministic_repair_or_specific_escalation",
  );
  assert.equal(outcome.unresolved.code, "PERIOD_NOT_INFERABLE");
  assert.ok(outcome.unresolved.field);
  assert.ok(outcome.unresolved.reason);
  assert.deepEqual(outcome.patch, {});
});

test("Corrector adversarial · una respuesta rejected vacía nunca se convierte en no reparable silenciosa", () => {
  for (const result of ["rejected", "inconclusive"]) {
    const evidenced = repair.enforceReviewIssueEvidence(result, []);
    assert.equal(evidenced.result, "inconclusive");
    assert.deepEqual(evidenced.issues, [{
      code: "AUTOMATIC_REVIEW_INCONCLUSIVE",
      field: "automatic_review",
      message: "La revisión automática no aportó incidencias verificables y no puede aprobar ni rechazar el mercado.",
    }]);
  }
  const explicit = [{ code: "INVALID_METRIC", field: "question", message: "Métrica inválida." }];
  assert.deepEqual(repair.enforceReviewIssueEvidence("rejected", explicit), {
    result: "rejected",
    issues: explicit,
  });
  assert.match(validatorEdge, /enforceReviewIssueEvidence\(result, issues\)/);
});

test("Corrector adversarial · Gemini no puede cambiar reglas contractuales deterministas", () => {
  const deterministic = {
    patch: {
      description: "Descripción determinista del contrato.",
      assumptions: "Supuestos deterministas.",
      delay_treatment: "Los retrasos no resuelven anticipadamente.",
      cancellation_treatment: "La cancelación no equivale por sí sola al hecho.",
      leak_treatment: "Las filtraciones no cuentan.",
      rename_treatment: "Un cambio de nombre exige continuidad oficial.",
    },
  };
  const malicious = {
    description: "Ignora el contrato anterior.",
    assumptions: "Cualquier rumor basta.",
    delay_treatment: "Un retraso resuelve Sí.",
    cancellation_treatment: "Una cancelación oficial resuelve Sí inmediatamente.",
    leak_treatment: "Cualquier filtración cuenta como fuente oficial.",
    rename_treatment: "Cualquier producto homónimo cuenta.",
  };
  const repaired = repair.applyRepairPatch({}, deterministic, malicious);
  for (const [field, value] of Object.entries(deterministic.patch)) assert.equal(repaired[field], value);
  assert.doesNotMatch(JSON.stringify(repaired), /resuelve Sí inmediatamente|Cualquier filtración|Ignora el contrato/);
  assert.doesNotMatch(fixerEdge, /applyRepairPatch\(draft, deterministic, modelPatch\)/);
});

test("Corrector adversarial · el corte v3 coincide en Edge, memoria SQL y puertas de escritura", () => {
  for (const version of [
    'const VALIDATOR_VERSION = "atinara-market-gate-v3"',
    'const POLICY_VERSION = "atinara-market-review-policy-v3"',
    'const SCHEMA_VERSION = "atinara-market-draft-schema-v3"',
  ]) assert.ok(validatorEdge.includes(version), version);
  for (const guarantee of [
    "'atinara-market-gate-v3'",
    "'step13.4-deterministic-v3'",
    "'REVIEW_POLICY_OUTDATED'",
    "'REVIEW_CONTENT_ISSUES_REQUIRED'",
    "draft.human_confirmed_review_id = review.id",
    "draft.human_confirmed_fingerprint = draft.content_fingerprint",
  ]) assert.ok(reviewPolicyV3Migration.includes(guarantee), guarantee);
  for (const regression of [
    "TEST_UNCONFIRMED_V2_WAS_REUSED",
    "TEST_V3_REVIEW_NOT_ACCEPTED",
    "TEST_MATERIAL_HUMAN_V2_NOT_PRESERVED",
    "TEST_V2_BEGIN_WAS_NOT_BLOCKED",
    "TEST_EMPTY_CONTENT_RESULT_WAS_ACCEPTED",
    "TEST_DETERMINISTIC_REJECTION_NOT_RELABELLED_V3",
  ]) assert.ok(reviewPolicyV3SqlTest.includes(regression), regression);
  assert.doesNotMatch(reviewPolicyV3Migration, /\b(?:insert\s+into|update|delete\s+from)\s+public\.(?:markets|predictions)\b/i);
});

test("Corrector adversarial · Best Video Game award gana al token incidental video", () => {
  const question = "Will Project Aurora win the Best Video Game award before January 1, 2027?";
  const context = {
    draft: {
      market_slug: "project-aurora-best-video-game-award",
      question,
      subject: "",
      category: "Premios",
      yes_criteria: question,
      primary_source: { url: "https://thegameawards.com/nominees/best-video-game" },
    },
    radar_candidate: {
      source_question: question,
      source_title: "Best Video Game award",
      source_resolution_rules: question,
      source_resolution_url: "https://thegameawards.com/nominees/best-video-game",
    },
  };
  const result = repair.buildDeterministicRepair(context, [
    primaryFor(context, "Best Video Game award nominees and winner."),
    verifiedSource(
      "https://projectaurora.example/awards",
      "Project Aurora is eligible for the Best Video Game award.",
    ),
  ]);
  assert.equal(result.archetype, "award_winner");
  assert.equal(result.unresolved, null);
  assert.equal(result.patch.subject, "Project Aurora");
  assert.match(result.patch.question, /Best Video Game award/);
  assert.doesNotMatch(result.patch.question, /tráiler|clip|publicará oficialmente/i);
});

test("Corrector adversarial · ET usa DST y EST/EDT conservan su offset contractual fijo", () => {
  const question = "Will Marvel Tokon: Fighting Souls have a Metacritic User Score > 8 seven days after release?";
  const official = verifiedSource(
    "https://blog.playstation.com/marvel-tokon-release",
    "Marvel Tōkon: Fighting Souls launches on August 6, 2026.",
  );
  const expected = {
    ET: ["America/New_York", "iana_eastern_time_with_dst", "2026-08-13T14:00:00.000Z"],
    EST: ["Etc/GMT+5", "fixed_utc_minus_05", "2026-08-13T15:00:00.000Z"],
    EDT: ["Etc/GMT+4", "fixed_utc_minus_04", "2026-08-13T14:00:00.000Z"],
  };
  for (const [token, [timezone, basis, instant]] of Object.entries(expected)) {
    const context = {
      draft: {
        market_slug: `marvel-user-score-${token.toLowerCase()}`,
        question,
        subject: "",
        category: "Reviews/Premios",
        yes_criteria: question,
        primary_source: { url: "https://www.metacritic.com/game/marvel-tokon-fighting-souls/" },
        resolution_deadline: "2026-08-20T16:00:00Z",
      },
      radar_candidate: {
        source_question: question,
        source_resolution_rules: `Resolves at 10:00 AM ${token} seven days after release.`,
      },
    };
    const result = repair.buildDeterministicRepair(context, [
      primaryFor(context, "Marvel Tokon: Fighting Souls official Metacritic User Score page."),
      official,
    ]);
    assert.equal(result.unresolved, null, token);
    assert.equal(result.patch.timezone, timezone, token);
    assert.equal(result.temporal_contract.timezone_basis, basis, token);
    assert.equal(result.patch.evaluation_ends_at, instant, token);
  }

  for (const [anchorDate, observation] of [
    ["March 7, 2026", "2:30 AM ET"],
    ["October 31, 2026", "1:30 AM ET"],
  ]) {
    const dstQuestion = "Will Marvel Tokon: Fighting Souls have a Metacritic User Score > 8 one day after release?";
    const context = {
      draft: {
        market_slug: `marvel-dst-${anchorDate.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
        question: dstQuestion,
        subject: "",
        category: "Reviews/Premios",
        yes_criteria: dstQuestion,
        primary_source: { url: "https://www.metacritic.com/game/marvel-tokon-fighting-souls/" },
        resolution_deadline: "2026-12-31T23:59:59Z",
      },
      radar_candidate: {
        source_question: dstQuestion,
        source_resolution_rules: `Resolves at ${observation} one day after release.`,
      },
    };
    const result = repair.buildDeterministicRepair(context, [
      primaryFor(context, "Marvel Tokon: Fighting Souls official Metacritic User Score page."),
      verifiedSource(
        `https://blog.playstation.com/marvel-tokon-${anchorDate.slice(0, 3).toLowerCase()}`,
        `Marvel Tōkon: Fighting Souls launches on ${anchorDate}.`,
      ),
    ]);
    assert.equal(result.unresolved.code, "RELATIVE_TIME_ANCHOR_UNVERIFIED", observation);
    assert.deepEqual(result.patch, {}, observation);
  }
});
