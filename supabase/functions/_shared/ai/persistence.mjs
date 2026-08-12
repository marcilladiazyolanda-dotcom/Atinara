import { AI_ERROR_CODES, aiError } from "./errors.mjs";

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function cleanBaseUrl(value) {
  const candidate = typeof value === "string" ? value.trim().replace(/\/+$/, "") : "";
  if (!candidate) return "";
  try {
    const url = new URL(candidate);
    return url.protocol === "https:" ? url.toString().replace(/\/+$/, "") : "";
  } catch {
    return "";
  }
}

function serviceHeaders(secretKey) {
  const headers = { apikey: secretKey, "Content-Type": "application/json" };
  if (!secretKey.startsWith("sb_secret_")) headers.Authorization = `Bearer ${secretKey}`;
  return headers;
}

async function rpc({ supabaseUrl, secretKey, fetchImpl }, name, args, signal) {
  const baseUrl = cleanBaseUrl(supabaseUrl);
  if (!baseUrl || !secretKey || typeof fetchImpl !== "function") throw new Error("AI_PERSISTENCE_NOT_CONFIGURED");
  const response = await fetchImpl(`${baseUrl}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: serviceHeaders(secretKey),
    body: JSON.stringify(args),
    signal,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(`AI_PERSISTENCE_RPC_${response.status}`);
    error.status = response.status;
    throw error;
  }
  return payload;
}

export function createAiPersistence(options = {}) {
  const dependencies = Object.freeze({
    supabaseUrl: options.supabaseUrl ?? "",
    secretKey: options.secretKey ?? "",
    fetchImpl: options.fetchImpl ?? globalThis.fetch,
  });

  return Object.freeze({
    async readTaskRuntime(taskType, signal) {
      try {
        const payload = await rpc(dependencies, "get_ai_task_runtime_mode_v1", { task_type_input: taskType }, signal);
        return isRecord(payload) ? payload : null;
      } catch {
        // Durante la transición, una migración ausente o una lectura fallida debe
        // conservar el transporte directo existente. No se oculta en rutas nuevas.
        return null;
      }
    },

    async reserveBudget(request, signal) {
      try {
        const payload = await rpc(dependencies, "reserve_ai_provider_budget_v1", {
          invocation_id_input: request.invocationId,
          provider_id_input: request.providerId,
          task_type_input: request.taskType,
          requested_units_input: request.requestedUnits,
          budget_mode_input: request.budgetMode,
        }, signal);
        if (!isRecord(payload) || typeof payload.status !== "string") throw new Error("INVALID_BUDGET_RESPONSE");
        return payload;
      } catch (cause) {
        throw aiError(AI_ERROR_CODES.BUDGET_RESERVATION_FAILED, {
          retryable: true,
          cause: cause instanceof Error ? cause : undefined,
          details: { providerId: request.providerId, taskType: request.taskType, phase: "budget_rpc" },
        });
      }
    },

    async recordInvocation(attempt, signal) {
      return rpc(dependencies, "record_ai_invocation_attempt_v1", {
        invocation_id_input: attempt.invocationId,
        agent_run_id_input: attempt.agentRunId,
        task_type_input: attempt.taskType,
        contract_version_input: attempt.contractVersion,
        policy_version_input: attempt.policyVersion,
        transport_mode_input: attempt.transportMode,
        route_id_input: attempt.routeId,
        provider_id_input: attempt.providerId,
        model_id_input: attempt.modelId,
        data_class_input: attempt.dataClass,
        input_fingerprint_input: attempt.inputFingerprint,
        output_fingerprint_input: attempt.outputFingerprint,
        lifecycle_input: attempt.lifecycle,
        outcome_input: attempt.outcome,
        error_code_input: attempt.errorCode,
        retry_count_input: attempt.retryCount,
        response_bytes_input: attempt.responseBytes,
        duration_ms_input: attempt.durationMs,
        input_tokens_input: attempt.inputTokens,
        output_tokens_input: attempt.outputTokens,
        provider_request_id_input: attempt.providerRequestId,
        schema_fallback_input: attempt.schemaFallback,
        metrics_eligible_input: attempt.metricsEligible,
      }, signal);
    },

    async recordAgentExecution(execution, signal) {
      if (!isRecord(execution)) throw new Error("AGENT_EXECUTION_INVALID");
      const run = await rpc(dependencies, "record_market_agent_run_v2", {
        payload_input: {
          invocation_id: execution.run_id,
          agent_type: execution.agent_type,
          outcome: execution.status,
          registry_version: execution.registry_version,
          registry_hash: execution.registry_hash,
          snapshot_fingerprint: execution.snapshot_fingerprint || null,
          step_count: execution.step_count,
          replan_count: execution.replan_count,
          stop_reason: execution.stop_reason || null,
          started_at: execution.started_at,
          completed_at: execution.completed_at,
        },
      }, signal);
      if (!isRecord(run) || typeof run.run_id !== "string") throw new Error("AGENT_RUN_PERSISTENCE_INVALID");
      for (const step of Array.isArray(execution.tools) ? execution.tools : []) {
        if (!isRecord(step)) throw new Error("AGENT_STEP_INVALID");
        await rpc(dependencies, "record_market_agent_step_v2", {
          payload_input: {
            run_id: run.run_id,
            registry_version: execution.registry_version,
            registry_hash: execution.registry_hash,
            sequence: step.sequence,
            round_no: step.round,
            tool_name: step.tool,
            strategy_key: step.strategy_key || null,
            is_writer: step.can_write === true,
            status: step.status,
            progress_fingerprint: step.progress_fingerprint || null,
            summary: isRecord(step.summary) ? step.summary : {},
            duration_ms: step.duration_ms,
          },
        }, signal);
      }
      return Object.freeze({ runId: run.run_id, idempotent: run.idempotent === true });
    },
  });
}
