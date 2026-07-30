import { expect, test } from "@playwright/test";

test("Oraklo mantiene operativo el recorrido público esencial", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => {
    pageErrors.push(error.message);
  });

  await test.step("La portada carga datos y abre una ficha real", async () => {
    const response = await page.goto("./");
    expect(response?.status()).toBeLessThan(400);
    await expect(page).toHaveTitle(/Oraklo/i);

    const marketLink = page.locator('a[href^="market-detail.html?id="]').first();
    await expect(marketLink).toBeVisible();
    await marketLink.click();

    await expect(page).toHaveURL(/market-detail\.html\?id=/);
    await expect(page.locator("#market-detail-root h1")).toBeVisible();
  });

  await test.step("La comunidad pública responde sin mostrar un error de carga", async () => {
    const response = await page.goto("community.html");
    expect(response?.status()).toBeLessThan(400);
    await expect(page.getByRole("heading", { name: "Comunidad Oraklo" })).toBeVisible();
    await expect(page.locator("#community-root")).not.toContainText("No se ha podido cargar el feed");
  });

  await test.step("Los paneles administrativos continúan protegidos para invitadas", async () => {
    await page.goto("admin-community.html");
    await expect(page.getByRole("heading", { name: "Inicia sesión como administradora" })).toBeVisible();

    await page.goto("admin-resolution.html");
    await expect(page.getByText("Inicia sesión con la cuenta administradora.")).toBeVisible();
  });

  expect(pageErrors, `Errores JavaScript detectados: ${pageErrors.join(" | ")}`).toEqual([]);
});
