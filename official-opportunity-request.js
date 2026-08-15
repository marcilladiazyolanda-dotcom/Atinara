(() => {
  "use strict";

  function payloadKey(payload) {
    return JSON.stringify([
      String(payload?.query || "").trim(),
      String(payload?.category || "").trim(),
      Number(payload?.horizon_days) || 0,
      String(payload?.timezone || "").trim(),
      Number(payload?.max_results) || 0,
    ]);
  }

  function createCoordinator({ createRequestId = () => globalThis.crypto.randomUUID() } = {}) {
    let active = null;
    let retryableIntent = null;

    function run(payload, execute) {
      if (active) return active.promise;
      if (typeof execute !== "function") throw new TypeError("OFFICIAL_DISCOVERY_EXECUTOR_REQUIRED");

      const key = payloadKey(payload);
      const intent = retryableIntent?.key === key
        ? retryableIntent
        : { key, requestId: createRequestId() };
      const requestPayload = { ...payload, request_id: intent.requestId };

      const promise = Promise.resolve()
        .then(() => execute(requestPayload))
        .then((result) => {
          retryableIntent = result?.outcome === "in_progress" ? intent : null;
          return result;
        }, (error) => {
          // Un fallo de transporte es ambiguo: el servidor puede haber terminado.
          // El siguiente intento del mismo formulario debe reutilizar request_id.
          retryableIntent = intent;
          throw error;
        })
        .finally(() => {
          if (active?.requestId === intent.requestId) active = null;
        });

      active = { ...intent, promise };
      return promise;
    }

    function snapshot() {
      return Object.freeze({
        active: Boolean(active),
        activeRequestId: active?.requestId || null,
        retryRequestId: retryableIntent?.requestId || null,
      });
    }

    return Object.freeze({ run, snapshot });
  }

  globalThis.atinaraOfficialOpportunityRequests = Object.freeze({ createCoordinator });
})();
