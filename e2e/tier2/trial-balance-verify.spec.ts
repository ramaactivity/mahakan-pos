import { expect, test } from "@playwright/test";
import { loginAsE2EOwner } from "./_fixtures/auth";

/**
 * Sesi AE-104 — Trial Balance balanced invariant verification.
 *
 * THE MOST FUNDAMENTAL accounting invariant: total debit across ALL
 * accounts = total credit across ALL accounts. Kalau Trial Balance
 * unbalanced, EVERY financial report turun-temurun (Income Statement,
 * Balance Sheet, Cash Flow) reflect data salah.
 *
 * Bug class yang ditangkap di sini:
 *   - Auto-journal hook gagal di-tengah-flow (partial entry)
 *   - Imbalanced individual journal entries lolos ke posted status
 *   - Manual entries draft dengan imbalanced lines accidentally posted
 *   - Reverse journal salah amount (over-/under-reverse)
 *   - Sum aggregation bug di server-side
 *
 * UI sudah expose indicator "✓ Balanced" vs "✕ TIDAK BALANCE — selisih
 * Rp X" — spec ini verify indicator menunjukkan balanced AND parse
 * tfoot TOTAL row untuk cross-check angka exact.
 *
 * Read-only spec — no mutation, no shift, aman jalan kapan saja.
 */

test.describe("Trial Balance balanced invariant", () => {
  test("Trial Balance harus balanced (debit = credit)", async ({ page }) => {
    await loginAsE2EOwner(page, "/dashboard#accounting");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(2_500);

    /* Akuntansi → tab Laporan (Tabs primitive after AE-98). */
    const laporanTab = page.getByRole("tab", { name: /^Laporan$/i }).first();
    await expect(laporanTab).toBeVisible({ timeout: 10_000 });
    await laporanTab.click();
    await page.waitForTimeout(2_000);

    /* Click Trial Balance sub-tab. */
    const tbBtn = page
      .getByRole("button", { name: /Trial Balance/i })
      .first();
    await expect(tbBtn).toBeVisible({ timeout: 10_000 });
    await tbBtn.click();
    await page.waitForTimeout(5_000);

    const bodyText = await page.locator("body").innerText();

    /* No error/crash. */
    expect(bodyText).not.toMatch(
      /something went wrong|client-side exception|gagal load/i,
    );

    /* CRITICAL invariant assertion #1 — UI indicator says balanced. */
    expect(
      bodyText,
      "Trial Balance MUST show '✓ Balanced'. Imbalanced = financial reports broken.",
    ).toMatch(/✓\s*Balanced/i);
    expect(
      bodyText,
      "Trial Balance shows TIDAK BALANCE — investigate journal entries IMMEDIATELY.",
    ).not.toMatch(/TIDAK BALANCE/i);

    /* CRITICAL invariant assertion #2 — parse tfoot TOTAL row,
     * verify total debit = total credit. */
    const totalRow = page.locator("tfoot tr").first();
    await expect(totalRow).toBeVisible({ timeout: 5_000 });

    const totalCells = await totalRow.locator("td").allInnerTexts();
    /* tfoot first row: [TOTAL (colSpan 2), debitRp, creditRp] → 3 cells. */
    const totalDebit = parseRupiahCell(totalCells[1] ?? "0");
    const totalCredit = parseRupiahCell(totalCells[2] ?? "0");

    expect(
      totalDebit,
      `TOTAL row: debit ${totalDebit} vs credit ${totalCredit} — MUST match exactly`,
    ).toBe(totalCredit);
    expect(totalDebit).toBeGreaterThan(0);
  });

  test("Trial Balance render table dengan kode + nama akun", async ({
    page,
  }) => {
    await loginAsE2EOwner(page, "/dashboard#accounting");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(2_500);

    const laporanTab = page.getByRole("tab", { name: /^Laporan$/i }).first();
    await laporanTab.click();
    await page.waitForTimeout(2_000);

    const tbBtn = page
      .getByRole("button", { name: /Trial Balance/i })
      .first();
    await tbBtn.click();
    await page.waitForTimeout(5_000);

    /* Verify table data render — Mahakan COA standard accounts. */
    const bodyText = await page.locator("body").innerText();
    expect(bodyText).toMatch(
      /Kas|Penjualan|Bank|Persediaan|HPP|Beban|Modal/i,
    );

    /* Verify minimum data rows + code format "XXXX" (4-digit) di table. */
    const tbody = page.locator("tbody").first();
    const dataRowCount = await tbody.locator("tr").count();
    expect(dataRowCount).toBeGreaterThan(5); // Branch should have many accounts

    /* Verify at least 1 row has 4-digit COA code. */
    expect(bodyText).toMatch(/\b\d{4}\b/);
  });
});

function parseRupiahCell(text: string): number {
  const cleaned = text.replace(/Rp|\.|—|\s/g, "").trim();
  if (!cleaned) return 0;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}
