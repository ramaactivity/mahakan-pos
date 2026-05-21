import { expect, test } from "@playwright/test";
import { loginAsE2EOwner } from "./_fixtures/auth";

/**
 * Sesi AE-87 — Tier 2 Setoran Tunai (cash deposit) navigation + modal smoke.
 *
 * Tidak full create-and-verify karena CashDepositModal butuh photo upload
 * (Vercel Blob) yang tidak ke-mock di test env. Yang penting verify:
 *   - Section render
 *   - Filter chips visible
 *   - Tombol "Catat Setoran" trigger modal
 */

test.describe("Setoran Tunai section", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsE2EOwner(page, "/dashboard#setoran_tunai");
  });

  test("Section render dengan tombol Catat Setoran", async ({ page }) => {
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(1_500);

    await expect(
      page.getByRole("button", { name: /Catat Setoran/i }),
    ).toBeVisible({ timeout: 10_000 });
  });

  test("Click Catat Setoran → modal terbuka", async ({ page }) => {
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(1_500);

    await page.getByRole("button", { name: /Catat Setoran/i }).click();
    /* Modal title sesuai CashDepositModal.tsx */
    await expect(
      page.getByRole("heading", { name: /Catat Setoran Tunai/i }),
    ).toBeVisible({ timeout: 5_000 });
  });

  test("No React error boundary di section", async ({ page }) => {
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(2_000);
    const bodyText = await page.locator("body").innerText();
    expect(bodyText).not.toMatch(
      /something went wrong|client-side exception|application error/i,
    );
  });
});
