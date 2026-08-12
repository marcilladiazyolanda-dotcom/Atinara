import { defineConfig } from "checkly";

const productionUrl = "https://marcilladiazyolanda-dotcom.github.io/Atinara/";
const checkBaseUrl = process.env.CHECKLY_BASE_URL?.trim() || productionUrl;

export default defineConfig({
  projectName: "Atinara · Producción",
  logicalId: "oraklo-production-monitoring",
  repoUrl: "https://github.com/marcilladiazyolanda-dotcom/Atinara",
  checks: {
    frequency: 60,
    locations: ["eu-central-1"],
    runtimeId: "2025.04",
    checkMatch: "checks/**/*.check.ts",
    playwrightConfig: {
      timeout: 45000,
      expect: {
        timeout: 20000
      },
      use: {
        baseURL: checkBaseUrl,
        locale: "es-ES",
        timezoneId: "Europe/Madrid",
        viewport: {
          width: 1366,
          height: 768
        }
      }
    },
    browserChecks: {
      testMatch: "checks/**/*.spec.ts"
    }
  },
  cli: {
    runLocation: "eu-central-1",
    reporters: ["list"],
    retries: 0
  }
});
