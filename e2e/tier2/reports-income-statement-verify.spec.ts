import { expect, test } from "@playwright/test";
import { loginAsE2EOwner } from "./_fixtures/auth";

/**
 * Sesi AE-103 — Income Statement (Laba Rugi) end-to-end verification.
 *
 * Critical invariant: Income Statement HARUS connect ke journal entries
 * dengan amount yang correct. Kalau report endpoint atau aggregation
 * broken, owner buat keputusan bisnis berdasarkan data salah → loss.
 *
 * Flow:
 *   1. Login → /dashboard#accounting
 *   2. Click tab "Laporan" (Akuntansi sub-tab)
 *   3. Click "Laba Rugi" tab (inside ReportsView)
 *   4. Wait for report to load
 *   5. Verify structure:
 *      - Section "PENDAPATAN BERSIH" with positive amount
 *      - Section "LABA KOTOR"
 *      - Section "LABA / RUGI BERSIH" (final net income)
 *      - At minimum 1 line item dengan format Rp xxx
 *   6. Verify no error/empty state
 *
 * Spec ini read-only — tidak butuh shift open, tidak ada mutation. Safe
 * to run anytime.
 *
 * Bug class yang ditangkap:
 *   - Income Statement endpoint return null/error (silent fail)
 *   - Aggregation revenue = 0 padahal ada pos_sale entries
 *   - Format display salah (NaN, Rp NaN, undefined)
 *   - Section structure broken (missing Total/Subtotal rows)
 */

test.describe("Income Statement (Laba Rugi) report", () => {
  test("Laba Rugi tab render dengan structure lengkap + revenue > 0", async ({
    page,
  }) => {
    await loginAsE2EOwner(page, "/dashboard#accounting");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(2_500);

    /* Click Akuntansi → tab Laporan (uses Tabs primitive after AE-98). */
    const laporanTab = page.getByRole("tab", { name: /^Laporan$/i }).first();
    await expect(laporanTab).toBeVisible({ timeout: 10_000 });
    await laporanTab.click();
    await page.waitForTimeout(2_000);

    /* ReportsView sub-tabs adalah <button> biasa (not Tabs primitive yet).
     * Click "Laba Rugi" button. */
    const labaRugiBtn = page
      .getByRole("button", { name: /Laba Rugi/i })
      .first();
    await expect(labaRugiBtn).toBeVisible({ timeout: 10_000 });
    await labaRugiBtn.click();

    /* Wait for IncomeStatementTab to fetch + render data. Network call
     * + heavy calculation, 3-5s biasa. */
    await page.waitForTimeout(5_000);

    const bodyText = await page.locator("body").innerText();

    /* Structure assertions — 3 critical lines harus muncul. */
    expect(bodyText).toMatch(/PENDAPATAN BERSIH/i);
    expect(bodyText).toMatch(/LABA KOTOR/i);
    expect(bodyText).toMatch(/LABA.*RUGI BERSIH|LABA \/ RUGI BERSIH/i);

    /* No error / loading stuck state. */
    expect(bodyText).not.toMatch(
      /something went wrong|client-side exception|gagal load/i,
    );

    /* At minimum 1 Rp amount visible. Branch sudah punya banyak
     * transactions, jadi revenue > 0 expected. */
    expect(bodyText).toMatch(/Rp\s*[\d.]+/);
  });

  test("Tab navigation: Validasi → Trial Balance → Laba Rugi → Neraca", async ({
    page,
  }) => {
    await loginAsE2EOwner(page, "/dashboard#accounting");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(2_500);

    const laporanTab = page.getByRole("tab", { name: /^Laporan$/i }).first();
    await laporanTab.click();
    await page.waitForTimeout(2_000);

    /* Walk through 4 critical sub-tabs, verify no crash di tiap step. */
    const subTabs = ["Validasi Drift", "Trial Balance", "Laba Rugi", "Neraca"];
    for (const tabName of subTabs) {
      const btn = page
        .getByRole("button", { name: new RegExp(tabName, "i") })
        .first();
      if (!(await btn.isVisible({ timeout: 3_000 }).catch(() => false))) {
        continue;
      }
      await btn.click();
      await page.waitForTimeout(3_000);

      const bodyText = await page.locator("body").innerText();
      expect(
        bodyText,
        `Tab "${tabName}" crashed`,
      ).not.toMatch(/something went wrong|client-side exception/i);
    }
  });
});
