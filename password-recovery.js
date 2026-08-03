(function initializePasswordRecovery(global) {
  "use strict";

  function getRecoveryRedirectUrl(locationValue = global.location) {
    const current = new URL(locationValue?.href || "https://example.invalid/Atinara/");
    return new URL("reset-password.html", current).href;
  }

  function hasRecoveryMarker(locationValue = global.location) {
    const href = String(locationValue?.href || "");
    return /(?:[?#&](?:type=recovery|code=|token_hash=))/i.test(href);
  }

  function getFriendlyRecoveryError(error) {
    const value = `${error?.code || ""} ${error?.message || ""}`.toLowerCase();
    if (value.includes("expired") || value.includes("otp_expired")) {
      return "El enlace de recuperación ha caducado. Solicita uno nuevo desde Atinara.";
    }
    if (value.includes("used") || value.includes("already")) {
      return "Este enlace ya se ha utilizado. Solicita uno nuevo desde Atinara.";
    }
    if (value.includes("invalid") || value.includes("token")) {
      return "El enlace de recuperación no es válido. Solicita uno nuevo desde Atinara.";
    }
    if (value.includes("rate") || value.includes("too many")) {
      return "Se han realizado demasiados intentos. Espera unos minutos y vuelve a probar.";
    }
    return "No se ha podido completar la recuperación. Solicita un enlace nuevo e inténtalo de nuevo.";
  }

  function setStatus(message, tone = "info") {
    const status = document.querySelector("#recovery-status");
    if (!status) return;
    status.textContent = message;
    status.className = `recovery-status is-${tone}`;
    status.hidden = !message;
  }

  function setFormAvailable(available) {
    const form = document.querySelector("#new-password-form");
    if (!form) return;
    form.hidden = !available;
    form.querySelectorAll("input, button").forEach((control) => {
      control.disabled = !available;
    });
    if (available) document.querySelector("#new-password")?.focus();
  }

  function renderRequirements(password) {
    const security = global.orakloPasswordSecurity;
    if (!security) return null;
    const evaluation = security.evaluate(password);
    document.querySelectorAll("[data-recovery-password-rule]").forEach((item) => {
      const met = Boolean(evaluation.rules[item.dataset.recoveryPasswordRule]);
      item.dataset.met = String(met);
      const icon = item.querySelector("span");
      if (icon) icon.textContent = met ? "✓" : "○";
    });
    return evaluation;
  }

  async function handleSubmit(event) {
    event.preventDefault();
    const client = global.orakloSupabase;
    const security = global.orakloPasswordSecurity;
    const form = event.currentTarget;
    const passwordInput = document.querySelector("#new-password");
    const confirmationInput = document.querySelector("#new-password-confirmation");
    const password = passwordInput?.value || "";
    const confirmation = confirmationInput?.value || "";

    if (!client || !security) {
      setStatus("La recuperación segura no está disponible. Recarga la página o solicita un enlace nuevo.", "error");
      return;
    }

    const evaluation = renderRequirements(password);
    if (!evaluation?.valid) {
      passwordInput?.setAttribute("aria-invalid", "true");
      passwordInput?.focus();
      setStatus("La contraseña debe cumplir los cinco requisitos indicados.", "error");
      return;
    }

    if (password !== confirmation) {
      confirmationInput?.setAttribute("aria-invalid", "true");
      confirmationInput?.focus();
      setStatus("Las dos contraseñas no coinciden.", "error");
      return;
    }

    form.setAttribute("aria-busy", "true");
    form.querySelectorAll("input, button").forEach((control) => {
      control.disabled = true;
    });
    setStatus("Comprobando la nueva contraseña…", "info");

    try {
      const exposure = await security.checkExposure(password);
      if (exposure.exposed) {
        passwordInput?.setAttribute("aria-invalid", "true");
        throw Object.assign(new Error("PASSWORD_EXPOSED"), { code: "PASSWORD_EXPOSED" });
      }
      const { error } = await client.auth.updateUser({ password });
      if (error) throw error;
      setStatus("Contraseña actualizada. Tu sesión de recuperación se cerrará de forma segura.", "success");
      await client.auth.signOut({ scope: "global" });
      global.setTimeout(() => {
        global.location.replace(new URL("index.html?password=updated", global.location.href).href);
      }, 900);
    } catch (error) {
      if (error?.code === "PASSWORD_EXPOSED") {
        setStatus("Esta contraseña aparece en filtraciones conocidas. Elige otra distinta y no la reutilices.", "error");
      } else if (String(error?.message || "").includes("Failed to fetch")) {
        setStatus("No hemos podido comprobar la contraseña de forma segura. Inténtalo de nuevo en unos minutos.", "error");
      } else {
        setStatus(getFriendlyRecoveryError(error), "error");
      }
      form.querySelectorAll("input, button").forEach((control) => {
        control.disabled = false;
      });
      passwordInput?.focus();
    } finally {
      form.setAttribute("aria-busy", "false");
    }
  }

  async function initializePage() {
    const form = document.querySelector("#new-password-form");
    if (!form) return;
    const client = global.orakloSupabase;
    setFormAvailable(false);
    setStatus("Comprobando el enlace de recuperación…", "info");

    if (!client) {
      setStatus("La recuperación no está disponible ahora mismo. Solicita un enlace nuevo más tarde.", "error");
      return;
    }

    let recoveryReady = false;
    const enableRecovery = () => {
      if (recoveryReady) return;
      recoveryReady = true;
      setFormAvailable(true);
      setStatus("Enlace válido. Elige una contraseña nueva.", "success");
    };

    client.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY" && session) enableRecovery();
    });

    try {
      const { data, error } = await client.auth.getSession();
      if (error) throw error;
      if (data.session && hasRecoveryMarker()) {
        enableRecovery();
      } else {
        global.setTimeout(() => {
          if (!recoveryReady) {
            setStatus("El enlace ha caducado, ya se utilizó o no es válido. Solicita uno nuevo desde Atinara.", "error");
          }
        }, 800);
      }
    } catch (error) {
      setStatus(getFriendlyRecoveryError(error), "error");
    }

    form.addEventListener("submit", handleSubmit);
    document.querySelector("#new-password")?.addEventListener("input", (event) => {
      event.target.removeAttribute("aria-invalid");
      renderRequirements(event.target.value);
    });
    document.querySelector("#new-password-confirmation")?.addEventListener("input", (event) => {
      event.target.removeAttribute("aria-invalid");
    });
  }

  const api = { getRecoveryRedirectUrl, hasRecoveryMarker, getFriendlyRecoveryError };
  global.atinaraPasswordRecovery = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof document !== "undefined") {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", initializePage, { once: true });
    } else {
      initializePage();
    }
  }
})(typeof window !== "undefined" ? window : globalThis);
