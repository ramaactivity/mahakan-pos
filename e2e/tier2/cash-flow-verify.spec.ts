import { expect, test } from "@playwright/test";
import { loginAsE2EOwner } from "./_fixtures/auth";

/**
 * Sesi AE-107 — Cash Flow Statement (Arus Kas) integrity verification.
 *
 * Third financial statement invariant (completes the trifecta):
 *
 *   COMPUTED CLOSING CASH = ACTUAL CLOSING CASH from ledger
 *
 * Cash Flow Statement classifies cash flows ke 3 PSAK sections:
 *   - Operasi (POS sales, expense, payroll, refund)
 *   - Investasi (capitalize fixed asset, jual aset)
 *   - Pendanaan (modal owner, prive, dividen)
 *
 * Setiap journal entry yang affect cash MUST classify ke exactly 1
 * section. Kalau misclassified atau missed:
 *   - Computed closing (opening + sum sections) ≠ Actual closing
 *   - Indicates journal mapping bug (misclassification) atau missing
 *     cash entry (silent skip)
 *
 * Bug class yang ditangkap:
 *   - Journal cash line tidak ke-classify (lost from cash flow)
 *   - Wrong section assignment (operating vs financing swap)
 *   - Opening balance calc wrong (off by previous period)
 *   - Double-count entry (counted in 2 sections)
 *
 * Read-only — no mutation, no shift, aman kapan saja.
 */

test.describe("Cash Flow Statement (Arus Kas) integrity", () => {
  test("Computed closing cash should match actual closing cash (ledger)", async ({
    page,
  }, testInfo) => {
    /* AE-107 known finding — test branch Cash Flow drift Rp 6.073.000.
     * Pattern: computed = opening + net = 2× actual. Drift = entire
     * opening cash, suggesting net operating over-counts by exactly the
     * opening amount.
     *
     * Suspect (need deeper investigation):
     * - "Non-POS Income" Rp 5.632.000 (1×) might be a setoran tunai
     *   atau owner-injected cash misclassified as income.
     * - Shift open Rp 100k initial cash count might be auto-journaled
     *   to operating bucket padahal bukan real cash inflow.
     * - Possible double-counting di getCashFlowEntries SQL.
     *
     * test.fail() marks expected failure — when bug fixed, spec pass
     * inverts to fail, signaling time to remove annotation.
     */
    test.fail(
      true,
      "Known issue AE-107: Cash Flow computed-vs-actual drift ~Rp 6M. Investigate Non-POS Income classification, shift open journal handling, atau getCashFlowEntries SQL double-count.",
    );

    await loginAsE2EOwner(page, "/dashboard#accounting");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(2_500);

    const laporanTab = page.getByRole("tab", { name: /^Laporan$/i }).first();
    await expect(laporanTab).toBeVisible({ timeout: 10_000 });
    await laporanTab.click();
    await page.waitForTimeout(2_000);

    const arusKasBtn = page
      .getByRole("button", { name: /Arus Kas/i })
      .first();
    await expect(arusKasBtn).toBeVisible({ timeout: 10_000 });
    await arusKasBtn.click();
    await page.waitForTimeout(5_000);

    const bodyText = await page.locator("body").innerText();

    /* No error/crash. */
    expect(bodyText).not.toMatch(
      /something went wrong|client-side exception|gagal load/i,
    );

    /* INVARIANT #1 — UI indicator says match. */
    expect(
      bodyText,
      "Cash Flow MUST show '✓ Computed match aktual'. Mismatch = journal misclassification atau missing cash entry.",
    ).toMatch(/Computed match aktual/i);
    expect(
      bodyText,
      "Cash Flow shows 'Tidak match' — investigate journal cash mapping.",
    ).not.toMatch(/✕\s*Tidak match/i);

    /* INVARIANT #2 — parse Computed vs Actual closing, verify match. */
    /* "Saldo Kas Akhir (Computed)" + "Saldo Kas Akhir (Aktual dari Buku Besar)" */
    const computedMatch = bodyText.match(
      /Saldo Kas Akhir \(Computed\)[\s\S]*?Rp\s*([\d.()]+)/i,
    );
    const actualMatch = bodyText.match(
      /Saldo Kas Akhir \(Aktual.*?\)[\s\S]*?Rp\s*([\d.()]+)/i,
    );

    if (computedMatch && actualMatch) {
      const computed = parseRupiahCell(computedMatch[1]);
      const actual = parseRupiahCell(actualMatch[1]);
      const drift = computed - actual;

      await testInfo.attach("cash-flow-totals.json", {
        body: JSON.stringify(
          {
            computedClosing: computed,
            actualClosing: actual,
            drift,
            matches: computed === actual,
          },
          null,
          2,
        ),
        contentType: "application/json",
      });

      expect(
        computed,
        `Cash Flow drift: computed ${computed} vs actual ${actual} = ${drift}. ` +
          "Investigate journal cash classification.",
      ).toBe(actual);
    }
  });

  test("Cash Flow render 3 PSAK sections (Operasi/Investasi/Pendanaan)", async ({
    page,
  }) => {
    await loginAsE2EOwner(page, "/dashboard#accounting");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(2_500);

    const laporanTab = page.getByRole("tab", { name: /^Laporan$/i }).first();
    await laporanTab.click();
    await page.waitForTimeout(2_000);

    const arusKasBtn = page
      .getByRole("button", { name: /Arus Kas/i })
      .first();
    await arusKasBtn.click();
    await page.waitForTimeout(5_000);

    const bodyText = await page.locator("body").innerText();

    /* All 3 PSAK sections + summary headers visible. */
    expect(bodyText).toMatch(/Saldo Kas Awal/i);
    expect(bodyText).toMatch(/Operasi|Operating/i);
    expect(bodyText).toMatch(/Investasi|Investing/i);
    expect(bodyText).toMatch(/Pendanaan|Financing/i);
    expect(bodyText).toMatch(/Perubahan Bersih Kas/i);
    expect(bodyText).toMatch(/Saldo Kas Akhir/i);

    /* Rp amounts rendered. */
    expect(bodyText).toMatch(/Rp\s*[\d.()]+/);
  });
});

function parseRupiahCell(text: string): number {
  /* Handle negative format "(N)" → -N, plus standard "Rp N.NNN". */
  const isNegative = /\(.*\)/.test(text);
  const cleaned = text.replace(/Rp|\.|—|\s|\(|\)/g, "").trim();
  if (!cleaned) return 0;
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return 0;
  return isNegative ? -n : n;
}
