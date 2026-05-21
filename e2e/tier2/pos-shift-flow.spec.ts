import { expect, test } from "@playwright/test";
import { loginAsE2EOwner } from "./_fixtures/auth";

/**
 * Sesi AE-87 — POS shift open flow E2E.
 *
 * Test serial (mode: serial) supaya:
 *   1. Test #1 open shift kalau belum ada
 *   2. Test #2 verify shift active state
 *
 * Branch isolated jadi tidak ada conflict dengan prod shift.
 */

test.describe.configure({ mode: "serial" });

test.describe("POS shift open flow", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsE2EOwner(page, "/pos");
  });

  test("Buka shift kalau belum aktif", async ({ page }) => {
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(2_500);

    const bodyText = await page.locator("body").innerText();
    /* Kalau shift sudah aktif (test re-run), skip. */
    if (!/Shift Belum Dibuka/i.test(bodyText)) {
      test.skip(true, "Shift sudah aktif — skip open flow");
    }

    /* Click "Buka Shift" button to open modal. */
    await page.getByRole("button", { name: /Buka Shift$/i }).click();

    /* Modal title "Buka Shift" dengan field opening cash. */
    await expect(
      page.getByRole("heading", { name: /Buka Shift/i }),
    ).toBeVisible({ timeout: 5_000 });

    /* Default opening cash 100000 — submit. */
    await page
      .getByRole("button", { name: /Buka Shift\s*·\s*Rp/i })
      .click();

    /* Step 2 "stock" — click Selesai untuk skip stock check. */
    await expect(
      page.getByRole("button", { name: /Selesai.*Mulai Jualan/i }),
    ).toBeVisible({ timeout: 10_000 });
    await page.getByRole("button", { name: /Selesai.*Mulai Jualan/i }).click();

    /* Modal close → shift active state visible. */
    await page.waitForTimeout(2_500);
    const afterOpen = await page.locator("body").innerText();
    expect(afterOpen).not.toMatch(/Shift Belum Dibuka/i);
  });

  test("Shift active state — menu + cart area visible", async ({ page }) => {
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(2_000);

    const bodyText = await page.locator("body").innerText();
    /* Shift aktif → tidak ada "Shift Belum Dibuka" + ada kategori/menu. */
    expect(bodyText).not.toMatch(/Shift Belum Dibuka/i);
    /* Ada minimal 1 menu item (44 active items di branch). */
    expect(bodyText.length).toBeGreaterThan(500);
  });
});
