import assert from "node:assert/strict";
import test from "node:test";

import {
  parseTaskProviderEnvelope,
  validateTaskOutput,
} from "../supabase/functions/_shared/ai/task-output-validation.mjs";
import { AI_ERROR_CODES } from "../supabase/functions/_shared/ai/errors.mjs";

const input = Object.freeze({
  market: { question: "¿Se anunció el juego?", closes_at: "2026-08-01T00:00:00Z" },
  researchText: "La fuente oficial publicó el anuncio antes del cierre.",
  sources: [{ title: "Fuente oficial", url: "https://example.com/anuncio", cited_text: "Anuncio publicado." }],
  searchQueries: ["anuncio oficial"],
});

const valid = Object.freeze({
  proposed_result: "Sí",
  confidence: "Alta",
  summary: "La evidencia documenta el anuncio antes del cierre.",
  reasons: ["La publicación oficial es anterior al cierre."],
  cutoff_analysis: "La fecha documentada respeta el corte.",
  caveats: [],
  recommended_note: "Revisar manualmente la fuente antes de aprobar.",
  source_dates: [{ title: "Fuente oficial", published_at: "2026-07-31", relevance: "Acredita el anuncio." }],
});

test("resolución acepta solo el contrato completo y referencias del input saneado", () => {
  assert.deepEqual(validateTaskOutput("market_resolution_analysis", structuredClone(valid), input), valid);
  for (const output of [
    { ...valid, confidence: "Muy alta" },
    { ...valid, authorization: "resolve" },
    { ...valid, source_dates: [{ title: "Fuente inventada", published_at: "2026-07-31", relevance: "No está en el input." }] },
  ]) {
    assert.throws(
      () => validateTaskOutput("market_resolution_analysis", output, input),
      (error) => [AI_ERROR_CODES.OUTPUT_CONTRACT_INVALID, AI_ERROR_CODES.OUTPUT_DOMAIN_INVALID].includes(error.code),
    );
  }
});

test("el parser de compatibilidad no convierte una salida parcial en válida", () => {
  const partial = { proposed_result: "Sí", confidence: "Alta", summary: "Parcial" };
  const envelope = {
    candidates: [{ content: { parts: [{ text: `Resultado:\n${JSON.stringify(partial)}\nFin.` }] } }],
  };
  const parsed = parseTaskProviderEnvelope("market_resolution_analysis", envelope, "generateContent");
  assert.deepEqual(parsed, partial);
  assert.throws(
    () => validateTaskOutput("market_resolution_analysis", parsed, input),
    (error) => error.code === AI_ERROR_CODES.OUTPUT_CONTRACT_INVALID,
  );
});
