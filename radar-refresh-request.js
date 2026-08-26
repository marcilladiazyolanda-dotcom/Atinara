(() => {
  "use strict";

  function payloadKey(payload) {
    return JSON.stringify([
      String(payload?.provider || "all").trim(),
      String(payload?.category || "").trim(),
      String(payload?.query || "").trim(),
      String(payload?.horizon || "180d").trim(),
      String(payload?.quality || "review").trim(),
      String(payload?.order || "recommended").trim(),
    ]);
  }

  function identityPayload(payload) {
    return {
      provider: String(payload?.provider || "all").trim(),
      category: String(payload?.category || "").trim(),
      query: String(payload?.query || "").trim(),
      horizon: String(payload?.horizon || "180d").trim(),
      quality: String(payload?.quality || "review").trim(),
      order: String(payload?.order || "recommended").trim(),
    };
  }

  function createCoordinator({
    createRequestId = () => globalThis.crypto.randomUUID(),
    storage,
    storageKey = "atinara:radar-refresh-intent:v1",
  } = {}) {
    let active = null;
    let intentStorage = storage;
    if (intentStorage === undefined) {
      try { intentStorage = globalThis.sessionStorage; } catch { intentStorage = null; }
    }

    function validRequestId(value) {
      return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
        .test(String(value || "").trim());
    }

    function restoreResumable() {
      try {
        const stored = JSON.parse(intentStorage?.getItem?.(storageKey) || "null");
        const payload = identityPayload(stored?.payload);
        const requestId = String(stored?.request_id || "").trim();
        if (stored?.schema_version !== "atinara-radar-refresh-intent-v1"
          || !validRequestId(requestId)
          || stored?.key !== payloadKey(payload)) return null;
        return { key: stored.key, requestId, payload };
      } catch {
        return null;
      }
    }

    let resumable = restoreResumable();

    function persistResumable() {
      try {
        if (!resumable) {
          intentStorage?.removeItem?.(storageKey);
          return;
        }
        intentStorage?.setItem?.(storageKey, JSON.stringify({
          schema_version: "atinara-radar-refresh-intent-v1",
          key: resumable.key,
          request_id: resumable.requestId,
          payload: resumable.payload,
        }));
      } catch {
        // La memoria de sesión es auxiliar; Postgres conserva la autoridad.
      }
    }

    function reconcile(payload, result) {
      const key = payloadKey(payload);
      if (result?.refresh_in_progress === true) {
        const requestId = [
          result?.refresh_request_id,
          active?.key === key ? active.requestId : null,
          resumable?.key === key ? resumable.requestId : null,
        ].find(validRequestId);
        if (requestId) {
          resumable = { key, requestId: String(requestId).trim(), payload: identityPayload(payload) };
          persistResumable();
        }
      } else if (resumable?.key === key) {
        // Una lectura administrativa confirma que la intención ya es terminal.
        // Limpiar el estado local evita ofrecer un «Continuar» falso sin crear
        // otra UUID ni repetir una escritura.
        resumable = null;
        persistResumable();
      }
      return snapshot();
    }

    function run(payload, execute) {
      if (typeof execute !== "function") throw new TypeError("RADAR_REFRESH_EXECUTOR_REQUIRED");
      const key = payloadKey(payload);
      if (active) {
        if (active.key !== key) throw new Error("RADAR_REFRESH_ACTIVE_INTENT_CONFLICT");
        return active.promise;
      }
      if (resumable && resumable.key !== key) {
        throw new Error("RADAR_REFRESH_FILTERS_CHANGED");
      }
      const intent = resumable?.key === key
        ? resumable
        : { key, requestId: createRequestId(), payload: identityPayload(payload) };
      resumable = intent;
      persistResumable();
      const requestPayload = { ...payload, refresh_request_id: intent.requestId };
      const promise = Promise.resolve()
        .then(() => execute(requestPayload))
        .then((result) => {
          reconcile(requestPayload, result);
          return result;
        }, (error) => {
          const status = Number(error?.status);
          const deterministicClientError = Number.isFinite(status)
            && status > 0 && status < 500 && status !== 429;
          // Red, 5xx o 429 son ambiguos: el backend puede haber persistido o
          // finalizado. Un 4xx determinista no debe dejar «Continuar» atascado.
          resumable = deterministicClientError ? null : intent;
          persistResumable();
          throw error;
        })
        .finally(() => {
          if (active?.requestId === intent.requestId) active = null;
        });
      active = { ...intent, promise };
      return promise;
    }

    function resume(payload, requestId) {
      const normalizedRequestId = String(requestId || "").trim();
      if (!validRequestId(normalizedRequestId)) throw new TypeError("RADAR_REFRESH_REQUEST_ID_INVALID");
      const intent = {
        key: payloadKey(payload),
        requestId: normalizedRequestId,
        payload: identityPayload(payload),
      };
      if (active && (active.key !== intent.key || active.requestId !== intent.requestId)) {
        throw new Error("RADAR_REFRESH_ACTIVE_INTENT_CONFLICT");
      }
      resumable = intent;
      persistResumable();
      return snapshot();
    }

    function snapshot() {
      return Object.freeze({
        active: Boolean(active),
        activeRequestId: active?.requestId || null,
        resumableRequestId: resumable?.requestId || null,
        resumablePayload: resumable?.payload
          ? Object.freeze({ ...resumable.payload }) : null,
      });
    }

    return Object.freeze({ run, resume, reconcile, snapshot });
  }

  globalThis.atinaraRadarRefreshRequests = Object.freeze({ createCoordinator });
})();
