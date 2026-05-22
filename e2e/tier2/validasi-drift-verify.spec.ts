import { expect, test } from "@playwright/test";
import { loginAsE2EOwner } from "./_fixtures/auth";

/**
 * Sesi AE-108 — Validasi Drift meta-validation spec.
 *
 * Validasi Drift adalah aplikasi's BUILT-IN integrity checker yang
 * bandingkan saldo Buku Besar vs source data (Finance/Inventory/
 * Purchase). Status per item:
 *   - OK = match sempurna
 *   - Warning = drift kecil (≤ 1%, biasanya rounding)
 *   - Critical = drift signifikan, perlu investigasi
 *
 * Meta-test: pakai fitur ini sendiri sebagai integrity gate. Kalau
 * ada baris dengan Critical status, ada bug di hook auto-journal
 * atau missing manual entry.
 *
 * Coverage:
 *   1. Validasi Drift tab loads, table renders
 *   2. Count status distribution (OK/Warning/Critical)
 *   3. Attach diagnostic JSON to report
 *   4. Strict assert no Critical (atau test.fail kalau known issue)
 *
 * Bug class yang ditangkap:
 *   - Auto-journal hook missing untuk source data updates
 *   - Manual journal forgot dari mutasi Finance/Inventory/Purchase
 *   - Opname/setoran belum reflek ke ledger
 *   - Stock-deduct off vs purchase
 *
 * Read-only — no mutation, no shift, aman kapan saja.
 */

test.describe("Validasi Drift meta-validation", () => {
  test("No Critical drift in branch (atau report findings)", async ({
    page,
  }, testInfo) => {
    /* AE-108 known findings — test branch punya 3 Critical drifts yang
     * RELATED ke AE-105/107 findings:
     *
     * 1. Kas Tunai: BB Rp 9.173k vs Finance Cash-on-Hand Rp 4.713k,
     *    drift +Rp 4.460k. Likely related ke AE-107 Cash Flow phantom.
     * 2. Persediaan Kitchen: BB -263k vs ingredients × cost -1.056k.
     * 3. Persediaan Bar: BB -527k vs ingredients × cost -1.284k.
     *
     * Persediaan drifts kemungkinan dari recipe/cost calc divergence
     * yang affect inventory valuation. Negative inventory itself is
     * test branch pollution (e2e sales > purchases).
     *
     * test.fail() marks expected failure — when integrity restored,
     * spec pass inverts to fail = signal investigation complete.
     */
    test.fail(
      true,
      "Known issue AE-108: 3 Critical drifts (Kas Tunai +Rp 4.46M, Persediaan Kitchen +Rp 792k, Persediaan Bar +Rp 756k). Related ke AE-107 Cash Flow finding. Investigate via UI drilldown ke General Ledger per row.",
    );

    await loginAsE2EOwner(page, "/dashboard#accounting");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(2_500);

    const laporanTab = page.getByRole("tab", { name: /^Laporan$/i }).first();
    await expect(laporanTab).toBeVisible({ timeout: 10_000 });
    await laporanTab.click();
    await page.waitForTimeout(2_000);

    /* Validasi Drift = default first tab, but make explicit. */
    const validasiBtn = page
      .getByRole("button", { name: /Validasi Drift/i })
      .first();
    if (await validasiBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await validasiBtn.click();
      await page.waitForTimeout(3_000);
    }

    /* Wait for table to load (fetchValidationReport may take 3-5s). */
    await page.waitForTimeout(3_000);

    /* No error/crash. */
    const bodyText = await page.locator("body").innerText();
    expect(bodyText).not.toMatch(
      /something went wrong|client-side exception|gagal load/i,
    );

    /* Count status badges di table. Each row punya status badge:
     * OK / Warning / Critical. */
    const okCount = await page
      .locator("tbody tr")
      .filter({ hasText: /\bOK\b/ })
      .count();
    const warningCount = await page
      .locator("tbody tr")
      .filter({ hasText: /Warning/i })
      .count();
    const criticalCount = await page
      .locator("tbody tr")
      .filter({ hasText: /Critical/i })
      .count();

    await testInfo.attach("validasi-drift-summary.json", {
      body: JSON.stringify(
        {
          ok: okCount,
          warning: warningCount,
          critical: criticalCount,
          total: okCount + warningCount + criticalCount,
          allClean: warningCount === 0 && criticalCount === 0,
        },
        null,
        2,
      ),
      contentType: "application/json",
    });

    /* At minimum, table should have rows (branch has data). */
    const totalRows = okCount + warningCount + criticalCount;
    expect(
      totalRows,
      "Validasi Drift table empty — endpoint broken atau permission issue",
    ).toBeGreaterThan(0);

    /* Strict invariant: zero Critical drifts. Warnings (1% drift)
     * allowed karena bisa rounding. Critical = REAL problem.
     *
     * Test mungkin fail di branch yang punya artifact (mis. AE-105/107
     * Balance Sheet / Cash Flow drift), jadi documented dengan diagnostic
     * attachment. Investigate via UI click row → drilldown ke GL.
     */
    expect(
      criticalCount,
      `Validasi Drift detected ${criticalCount} Critical row(s). ` +
        "Click row in UI untuk drilldown ke General Ledger + investigate root cause.",
    ).toBe(0);
  });

  test("Validasi Drift table structure render", async ({ page }) => {
    await loginAsE2EOwner(page, "/dashboard#accounting");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(2_500);

    const laporanTab = page.getByRole("tab", { name: /^Laporan$/i }).first();
    await laporanTab.click();
    await page.waitForTimeout(2_000);

    const validasiBtn = page
      .getByRole("button", { name: /Validasi Drift/i })
      .first();
    if (await validasiBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await validasiBtn.click();
    }
    await page.waitForTimeout(5_000);

    const bodyText = await page.locator("body").innerText();

    /* Table structure: 5 columns. */
    expect(bodyText).toMatch(/Item/i);
    expect(bodyText).toMatch(/Buku Besar/i);
    expect(bodyText).toMatch(/Sumber Data/i);
    expect(bodyText).toMatch(/Selisih/i);
    expect(bodyText).toMatch(/Status/i);

    /* Description hint visible. */
    expect(bodyText).toMatch(/bandingkan saldo per Buku Besar/i);
  });
});
