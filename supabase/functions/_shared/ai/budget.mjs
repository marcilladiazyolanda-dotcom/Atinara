import { AI_ERROR_CODES, aiError, asAiGatewayError } from "./errors.mjs";

export const AI_BUDGET_MODES = Object.freeze(["baseline_existing", "metered"]);

function normalizeReservation(payload) {
  const status = typeof payload?.status === "string" ? payload.status : "";
  if (!status) throw aiError(AI_ERROR_CODES.BUDGET_RESERVATION_FAILED, { retryable: true });
  return Object.freeze({
    status,
    reserved: payload.reserved === true,
    idempotent: payload.idempotent === true,
    requestedUnits: Number(payload.requested_units ?? 0),
    usedUnits: payload.used_units == null ? null : Number(payload.used_units),
    limitUnits: payload.limit_units == null ? null : Number(payload.limit_units),
  });
}

export async function reserveProviderBudget({ persistence, invocationId, providerId, taskType, requestedUnits, budgetMode, signal }) {
  if (!AI_BUDGET_MODES.includes(budgetMode) || !Number.isSafeInteger(requestedUnits) || requestedUnits < 1) {
    throw aiError(AI_ERROR_CODES.BUDGET_RESERVATION_FAILED, { details: { providerId, taskType, phase: "budget_contract" } });
  }
  try {
    const reservation = normalizeReservation(await persistence.reserveBudget({
      invocationId,
      providerId,
      taskType,
      requestedUnits,
      budgetMode,
    }, signal));
    if (reservation.status === "exhausted" || reservation.reserved !== true) {
      throw aiError(AI_ERROR_CODES.BUDGET_EXHAUSTED, {
        httpStatus: 429,
        details: { providerId, taskType, phase: "budget" },
      });
    }
    return reservation;
  } catch (error) {
    const ai = asAiGatewayError(error, AI_ERROR_CODES.BUDGET_RESERVATION_FAILED);
    if (ai.code === AI_ERROR_CODES.BUDGET_EXHAUSTED) throw ai;
    throw aiError(AI_ERROR_CODES.BUDGET_RESERVATION_FAILED, {
      retryable: true,
      cause: ai,
      details: { providerId, taskType, phase: "budget" },
    });
  }
}

