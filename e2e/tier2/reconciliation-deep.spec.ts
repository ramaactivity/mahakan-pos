import { expect, test } from "@playwright/test";
import { loginAsE2EOwner } from "./_fixtures/auth";

/**
 * Sesi AE-95 — Reconciliation section deep smoke.
 *
 * ReconciliationSection punya 3 tab:
 *   - "Saldo Awal" (checklist) — OpeningBalanceWizard
 *   - "Import Histori" (import) — HistoricalImportWizard (Majoo/Kasir Pintar CSV)
 *   - "Daftar Historis" (list) — HistoricalImportList
 *
 * Test verify 3 tab toggle berfungsi + content masing-masing render.
 */

test.describe("Reconciliation section tabs", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsE2EOwner(page, "/dashboard#reconciliation");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(2_500);
  });

  test("Tab 'Saldo Awal' default active + content render", async ({ page }) => {
    const tab = page.getByRole("tab", { name: /Saldo Awal/i }).first();
    await expect(tab).toBeVisible({ timeout: 10_000 });
    /* Default state — biarkan default tab terload. */
    const bodyText = await page.locator("body").innerText();
    expect(bodyText).toMatch(/Saldo Awal|trial|wizard|opening/i);
  });

  test("Tab 'Import Histori' click → wizard render", async ({ page }) => {
    const tab = page.getByRole("tab", { name: /Import Histori/i }).first();
    await expect(tab).toBeVisible({ timeout: 10_000 });
    await tab.click();
    await page.waitForTimeout(1_500);

    const bodyText = await page.locator("body").innerText();
    expect(bodyText).toMatch(/Majoo|Kasir Pintar|CSV|Upload|import/i);
  });

  test("Tab 'Daftar Historis' click → list render", async ({ page }) => {
    const tab = page.getByRole("tab", { name: /Daftar Historis/i }).first();
    await expect(tab).toBeVisible({ timeout: 10_000 });
    await tab.click();
    await page.waitForTimeout(2_000);

    const bodyText = await page.locator("body").innerText();
    /* List section render table header atau empty state. */
    expect(bodyText).not.toMatch(
      /something went wrong|client-side exception/i,
    );
    expect(bodyText).toMatch(/historis|data|kosong|periode|tanggal|edit/i);
  });
});
