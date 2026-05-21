import { expect, test } from "@playwright/test";
import { loginAsE2EOwner } from "./_fixtures/auth";

/**
 * Sesi AE-86 — Tier 2 smoke untuk Stock Opname mobile route.
 *
 * Coverage:
 *   - /m landing renders module cards (after auth)
 *   - /m/opname renders count form atau session start screen
 *   - No React crashes
 *
 * Note: replace-semantic finalize (AE-81) di-test via unit tests
 * (stock-opname-replace-semantic.test.ts). E2E smoke ini cuma verify
 * mobile UI render + tidak ada navigation regression.
 */

test.describe("Stock Opname mobile route", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsE2EOwner(page, "/m");
  });

  test("/m landing render dengan module cards (Opname, PO, Jadwal)", async ({
    page,
  }) => {
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(1_500);
    const bodyText = await page.locator("body").innerText();
    expect(bodyText).toMatch(/opname/i);
    /* Verify at least 1 module card link visible. */
    const opnameLink = page.getByRole("link", { name: /opname/i });
    await expect(opnameLink).toBeVisible({ timeout: 5_000 });
  });

  test("Navigate ke /m/opname tanpa crash", async ({ page }) => {
    await page.goto("/m/opname");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(2_000);
    /* Opname mobile page render — biasanya ada count form atau
     * "mulai sesi" CTA kalau belum ada session aktif. */
    const bodyText = await page.locator("body").innerText();
    expect(bodyText.length).toBeGreaterThan(0);
    /* No error boundary fallback. */
    expect(bodyText).not.toMatch(/something went wrong|client-side exception/i);
  });
});
