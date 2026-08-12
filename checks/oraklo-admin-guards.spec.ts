import { expect, test } from "@playwright/test";

const target = (path: string) =>
  process.env.CHECKLY_BASE_URL
    ? new URL(path, process.env.CHECKLY_BASE_URL).href
    : path;

test("las superficies administrativas conservan autoridad humana y estado neutral", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  const marketsResponse = await page.goto(target("admin-markets.html"));
  expect(marketsResponse?.status()).toBeLessThan(400);
  await expect(page.getByRole("heading", { name: "Gestión de mercados" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Inicia sesión para gestionar mercados" })).toBeVisible();
  await expect(page.locator('script[src*="admin-agent-engine.js?v=20260812-agent-engine-v21"]')).toHaveCount(1);
  await expect(page.locator("body")).not.toContainText(/Gemini|OpenRouter|NVIDIA/i);
  await page.keyboard.press("Tab");
  expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBe("BODY");

  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);

  const resolutionResponse = await page.goto(target("admin-resolution.html"));
  expect(resolutionResponse?.status()).toBeLessThan(400);
  await expect(page.getByRole("heading", { name: "Resolver mercados" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Inicia sesión con la cuenta administradora." })).toBeVisible();
  await expect(page.getByText("La IA investiga y propone. Tú compruebas las fuentes y decides.")).toBeVisible();
  await expect(page.locator("body")).not.toContainText(/Gemini|OpenRouter|NVIDIA/i);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  expect(pageErrors, `Errores JavaScript detectados: ${pageErrors.join(" | ")}`).toEqual([]);
});
