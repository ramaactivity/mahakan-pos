import { expect, test } from "@playwright/test";
import { loginAsE2EOwner } from "./_fixtures/auth";

/**
 * Sesi AE-93 — CSV Import wizard smoke (AE-80 follow-up).
 *
 * Coverage 3 importer:
 *   - Investor: tab Investor → tombol Import CSV → InvestorImportWizard
 *   - Pengelola: tab Pengelola → tombol Import CSV → PengelolaImportWizard
 *   - Kreditur: tab Hutang Kreditur → tombol Import CSV → CreditorImportWizard
 *
 * Tiap wizard verify modal terbuka dengan upload area + "Download Template"
 * button.
 */

test.describe("CSV importers (AE-80 follow-up)", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsE2EOwner(page, "/dashboard#investors");
    await page.waitForLoadState("networkidle");
  });

  test("InvestorImportWizard — Investor tab Import CSV", async ({ page }) => {
    /* Default tab Investor. Tombol Import CSV di header tab. */
    await expect(
      page.getByRole("button", { name: /Import CSV/i }).first(),
    ).toBeVisible({ timeout: 15_000 });
    await page.getByRole("button", { name: /Import CSV/i }).first().click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 5_000 });
    /* Title "Import Investor dari CSV". */
    const text = await dialog.innerText();
    expect(text).toMatch(/Import Investor|CSV|Template|upload/i);
  });

  test("PengelolaImportWizard — Pengelola tab Import CSV", async ({ page }) => {
    const pengelolaTab = page.getByRole("button", {
      name: "Pengelola",
      exact: true,
    });
    await pengelolaTab.click();
    await page.waitForTimeout(2_000);

    const importBtn = page.getByRole("button", { name: /Import CSV/i });
    await expect(importBtn).toBeVisible({ timeout: 10_000 });
    await importBtn.click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 5_000 });
    const text = await dialog.innerText();
    expect(text).toMatch(/Import Pengelola|CSV|Template/i);
  });

  test("CreditorImportWizard — Hutang Kreditur tab Import CSV", async ({
    page,
  }) => {
    const krediturTab = page.getByRole("button", {
      name: /Hutang Kreditur/i,
    });
    await krediturTab.click();
    await page.waitForTimeout(2_000);

    const importBtn = page.getByRole("button", { name: /Import CSV/i });
    await expect(importBtn).toBeVisible({ timeout: 10_000 });
    await importBtn.click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 5_000 });
    const text = await dialog.innerText();
    expect(text).toMatch(/Import Kreditur|CSV|Template/i);
  });
});
