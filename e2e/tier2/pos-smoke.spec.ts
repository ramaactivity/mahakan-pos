import { expect, test } from "@playwright/test";
import { loginAsE2EOwner } from "./_fixtures/auth";

/**
 * Sesi AE-86 — Tier 2 smoke POS critical flow.
 *
 * Login owner → /pos → verify shell render dengan kategori menu + cart
 * area. Verify ada tombol untuk open shift kalau belum ada shift aktif.
 *
 * Note: full transaction flow (add item, checkout, close shift) lebih
 * panjang + butuh shift state setup. Smoke test ini fokus verify shell
 * mount + tidak crash, foundation untuk expand.
 */

test.describe("POS smoke", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsE2EOwner(page, "/pos");
  });

  test("POS shell render + ada navigation atau open-shift prompt", async ({
    page,
  }) => {
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(2_000);

    /* POS load — either shift aktif (menu + cart visible) ATAU shift
     * belum dibuka (button "Buka Shift" / similar). Both valid. */
    const bodyText = await page.locator("body").innerText();
    const hasShiftIndicator =
      /shift|kasir|menu|cart|keranjang|kategori/i.test(bodyText);
    expect(hasShiftIndicator).toBe(true);
  });

  test("No React error boundary di /pos", async ({ page }) => {
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(2_000);
    const bodyText = await page.locator("body").innerText();
    const errorBoundaryPatterns = [
      /something went wrong/i,
      /application error.*client-side exception/i,
      /a client-side exception has occurred/i,
    ];
    for (const pattern of errorBoundaryPatterns) {
      expect(bodyText).not.toMatch(pattern);
    }
  });

  test("POS navigation links accessible (Riwayat tab atau sidebar)", async ({
    page,
  }) => {
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(2_000);
    /* PosLeftNav punya menu items. Verify ada minimal 1 element clickable. */
    const navElements = await page.locator("button, a").count();
    expect(navElements).toBeGreaterThan(2);
  });
});
