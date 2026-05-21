import { expect, test } from "@playwright/test";
import { loginAsE2EOwner } from "./_fixtures/auth";

/**
 * Sesi AE-86 — Tier 2 happy path untuk convert investor → kreditur flow
 * (shipped sesi AE-80 follow-up).
 *
 * Yang di-test:
 *   1. Login owner → buka tab Hutang Kreditur
 *   2. Verify tombol "Convert dari Investor" muncul
 *   3. Click tombol → modal terbuka
 *   4. Verify Combobox investor + form field bunga/period render
 *
 * Tidak full submit karena butuh real investor dengan dividendBalance=0
 * (validated server-side). Yang penting verify UI flow + modal open OK.
 */

test.describe("Convert Investor → Kreditur (sesi AE-80)", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsE2EOwner(page, "/dashboard#investors");
  });

  test("Buka tab Hutang Kreditur + tombol Convert visible", async ({ page }) => {
    const tabBtn = page.getByRole("button", { name: /Hutang Kreditur/i });
    await expect(tabBtn).toBeVisible({ timeout: 15_000 });
    await tabBtn.click();
    await page.waitForTimeout(1_500);

    /* Verify tab content render. */
    await expect(
      page.getByText(/Total Hutang Outstanding/i),
    ).toBeVisible({ timeout: 5_000 });
    /* Verify tombol Convert dari Investor. */
    await expect(
      page.getByRole("button", { name: /Convert dari Investor/i }),
    ).toBeVisible();
  });

  test("Click Convert dari Investor → modal terbuka dengan investor picker", async ({
    page,
  }) => {
    const tabBtn = page.getByRole("button", { name: /Hutang Kreditur/i });
    await tabBtn.click();
    await page.waitForTimeout(1_500);

    await page
      .getByRole("button", { name: /Convert dari Investor/i })
      .click();

    /* Modal title sesuai ConvertInvestorToCreditorModal.tsx */
    await expect(
      page.getByText(/Convert Investor.*Kreditur/i),
    ).toBeVisible({ timeout: 5_000 });

    /* Verify ada Combobox investor picker (label "Pilih Investor"). */
    await expect(page.getByText(/Pilih Investor/i)).toBeVisible();

    /* Verify field bunga + period render. */
    await expect(page.getByText(/Bunga.*%/i)).toBeVisible();
  });

  test("Tab Hutang Kreditur juga punya tombol Import CSV", async ({ page }) => {
    const tabBtn = page.getByRole("button", { name: /Hutang Kreditur/i });
    await tabBtn.click();
    await page.waitForTimeout(1_500);
    await expect(
      page.getByRole("button", { name: /Import CSV/i }),
    ).toBeVisible();
  });
});
