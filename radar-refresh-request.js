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

  function createCoordinator({ createRequestId = () => globalThis.crypto.randomUUID() } = {}) {
    let active = null;
    let resumable = null;

    function run(payload, execute) {
      if (active) return active.promise;
      if (typeof execute !== "function") throw new TypeError("RADAR_REFRESH_EXECUTOR_REQUIRED");
      const key = payloadKey(payload);
      const intent = resumable?.key === key ? resumable : { key, requestId: createRequestId() };
      const requestPayload = { ...payload, refresh_request_id: intent.requestId };
      const promise = Promise.resolve()
        .then(() => execute(requestPayload))
        .then((result) => {
          resumable = result?.refresh_in_progress === true ? intent : null;
          return result;
        }, (error) => {
          // Un fallo de transporte es ambiguo: el backend puede haber staged o
          // finalizado. El siguiente intento exacto conserva request_id.
          resumable = intent;
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
        resumableRequestId: resumable?.requestId || null,
      });
    }

    return Object.freeze({ run, snapshot });
  }

  globalThis.atinaraRadarRefreshRequests = Object.freeze({ createCoordinator });
})();
