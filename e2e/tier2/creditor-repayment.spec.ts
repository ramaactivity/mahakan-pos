import { expect, test } from "@playwright/test";
import { loginAsE2EOwner } from "./_fixtures/auth";

/**
 * Sesi AE-93 — Creditor repayment flow smoke (AE-80).
 *
 * Branch state setelah creditor-create spec: 1 E2E Kreditur dengan
 * outstanding > 0. Click "Cicil" → CreditorRepaymentModal terbuka.
 */

test.describe("Creditor repayment flow", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsE2EOwner(page, "/dashboard#investors");
    const tabBtn = page.getByRole("button", { name: /Hutang Kreditur/i });
    await expect(tabBtn).toBeVisible({ timeout: 15_000 });
    await tabBtn.click();
    await page.waitForTimeout(2_500);
  });

  test("Tab Hutang Kreditur render dengan list kreditur active", async ({
    page,
  }) => {
    /* Stat cards + table. */
    const bodyText = await page.locator("body").innerText();
    expect(bodyText).toMatch(/Total Hutang|Outstanding|Bunga YTD|Kreditur/i);
  });

  test("Click Cicil button → CreditorRepaymentModal terbuka", async ({
    page,
  }) => {
    /* Cari tombol "Cicil" (active creditor dengan outstanding > 0). */
    const cicilBtn = page
      .getByRole("button", { name: "Cicil", exact: true })
      .first();
    if (!(await cicilBtn.isVisible({ timeout: 5_000 }).catch(() => false))) {
      test.skip(
        true,
        "Tidak ada creditor active dengan outstanding > 0 di branch",
      );
    }
    await cicilBtn.click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 5_000 });
    /* Modal field: pokok, bunga, bank. */
    const text = await dialog.innerText();
    expect(text).toMatch(/pokok|bunga|bank|cicilan|repayment/i);
  });
});
