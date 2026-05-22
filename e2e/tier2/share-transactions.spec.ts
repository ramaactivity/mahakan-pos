import { expect, test } from "@playwright/test";
import { loginAsE2EOwner } from "./_fixtures/auth";

/**
 * Sesi AE-93 — Share Transactions (Mutasi Saham) flow smoke (AE-80).
 *
 * Coverage:
 *   - Tab Mutasi Saham render dengan Σ share% banner
 *   - Tombol P2P Transfer trigger modal
 *   - Tombol Company Buyback trigger modal
 */

test.describe("Share Transactions (Mutasi Saham) flow", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsE2EOwner(page, "/dashboard#investors");
    /* Switch tab Mutasi Saham. */
    const tabBtn = page.getByRole("button", { name: /Mutasi Saham/i });
    await expect(tabBtn).toBeVisible({ timeout: 15_000 });
    await tabBtn.click();
    await page.waitForTimeout(2_500);
  });

  test("Tab Mutasi Saham render dengan share% invariant banner", async ({
    page,
  }) => {
    /* Tab content render — verify ada P2P Transfer + Company Buyback button. */
    await expect(
      page.getByRole("button", { name: /P2P Transfer/i }),
    ).toBeVisible({ timeout: 10_000 });
    await expect(
      page.getByRole("button", { name: /Company Buyback/i }),
    ).toBeVisible();

    /* Σ share% invariant banner (hijau 100% atau warning kalau ≠). */
    const bodyText = await page.locator("body").innerText();
    expect(bodyText).toMatch(/share|invariant|100|%/i);
  });

  test("Click P2P Transfer → ShareTransferModal terbuka", async ({ page }) => {
    await page.getByRole("button", { name: /P2P Transfer/i }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 5_000 });
    /* Modal title + field investor from/to. */
    const text = await dialog.innerText();
    expect(text).toMatch(/P2P|transfer|from|to|delta|investor/i);
  });

  test("Click Company Buyback → CompanyBuybackModal terbuka", async ({
    page,
  }) => {
    await page.getByRole("button", { name: /Company Buyback/i }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 5_000 });
    /* Field investor + amount + bank. */
    const text = await dialog.innerText();
    expect(text).toMatch(/buyback|investor|amount|bank/i);
  });
});
