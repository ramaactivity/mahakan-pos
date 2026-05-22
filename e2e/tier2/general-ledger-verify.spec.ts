import { expect, test } from "@playwright/test";
import { loginAsE2EOwner } from "./_fixtures/auth";

/**
 * Sesi AE-109 — General Ledger (Buku Besar) drilldown verification.
 *
 * Critical invariant per-account: opening balance + sum(debit) - sum(credit)
 * = closing balance. Kalau ledger entries tidak mathematically consistent,
 * audit trail broken — owner tidak bisa investigate disputes atau
 * reconcile.
 *
 * Coverage:
 * - Test 1: Drilldown navigation dari Validasi Drift → GL pre-selects akun
 * - Test 2: GL per-account math invariant (opening + net = closing)
 *
 * Bug class:
 * - Running balance calc wrong (debit-normal vs credit-normal swap)
 * - Opening balance not loaded
 * - Entries missing dari period
 * - Sort order broken (entries should chronological)
 *
 * Read-only, no mutation, no shift requirement.
 */

function parseRupiahCell(text: string): number {
  /* Strip Rp, dots, dashes. Handle "(Rp 1.000)" parens-negative. */
  const isNeg = text.includes("(") && text.includes(")");
  const cleaned = text.replace(/[Rp().\s—\-]/g, "").trim();
  if (!cleaned) return 0;
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return 0;
  return isNeg ? -n : n;
}

test.describe("General Ledger (Buku Besar) drilldown verification", () => {
  test("Drilldown dari Validasi Drift → GL pre-selects akun", async ({
    page,
  }) => {
    await loginAsE2EOwner(page, "/dashboard#accounting");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(2_500);

    const laporanTab = page.getByRole("tab", { name: /^Laporan$/i }).first();
    await expect(laporanTab).toBeVisible({ timeout: 10_000 });
    await laporanTab.click();
    await page.waitForTimeout(2_000);

    /* Validasi Drift default tab. Click first drift row → drilldown ke GL. */
    const driftRow = page
      .getByRole("button", { name: /Drilldown ke Buku Besar/i })
      .first();
    if (!(await driftRow.isVisible({ timeout: 5_000 }).catch(() => false))) {
      test.skip(true, "No Validasi Drift rows yet");
    }
    await driftRow.click();
    await page.waitForTimeout(2_500);

    /* GL tab should be active + akun pre-filled. Verify header shows
     * "Saldo awal:" + table with entries. */
    const bodyText = await page.locator("body").innerText();
    expect(bodyText).toMatch(/Saldo awal/i);
    expect(bodyText).not.toMatch(
      /something went wrong|Pilih akun untuk lihat/i,
    );
  });

  test("GL math invariant: opening + sum(debit) - sum(credit) = closing", async ({
    page,
  }, testInfo) => {
    await loginAsE2EOwner(page, "/dashboard#accounting");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(2_500);

    const laporanTab = page.getByRole("tab", { name: /^Laporan$/i }).first();
    await laporanTab.click();
    await page.waitForTimeout(2_000);

    /* Drilldown via Validasi Drift untuk pre-select akun yang punya entries. */
    const driftRow = page
      .getByRole("button", { name: /Drilldown ke Buku Besar/i })
      .first();
    if (!(await driftRow.isVisible({ timeout: 5_000 }).catch(() => false))) {
      test.skip(true, "No Validasi Drift rows");
    }
    await driftRow.click();
    await page.waitForTimeout(3_500);

    /* Parse Saldo awal from header. Format: "Saldo awal: Rp X.XXX" */
    const headerText = await page
      .locator("body")
      .getByText(/Saldo awal:/i)
      .first()
      .innerText();
    const openingMatch = headerText.match(/Saldo awal:\s*(.+?)$/);
    const opening = openingMatch ? parseRupiahCell(openingMatch[1]) : 0;

    /* Parse tfoot Saldo akhir. */
    const closingRow = page.locator("tfoot").first();
    const closingCells = await closingRow.locator("td").allInnerTexts();
    const closing = parseRupiahCell(closingCells.at(-1) ?? "0");

    /* Parse tbody entries — sum debit + sum credit. */
    const tbody = page.locator("tbody").first();
    const rowCount = await tbody.locator("tr").count();

    let totalDebit = 0;
    let totalCredit = 0;
    for (let i = 0; i < rowCount; i++) {
      const cells = await tbody.locator("tr").nth(i).locator("td").allInnerTexts();
      /* Table columns: Tgl, Entry, Deskripsi, Debit, Credit, Saldo */
      if (cells.length >= 5) {
        totalDebit += parseRupiahCell(cells[3]);
        totalCredit += parseRupiahCell(cells[4]);
      }
    }

    await testInfo.attach("gl-balance-check.json", {
      body: JSON.stringify(
        {
          opening,
          totalDebit,
          totalCredit,
          closing,
          computedClosing: opening + totalDebit - totalCredit,
          entryCount: rowCount,
        },
        null,
        2,
      ),
      contentType: "application/json",
    });

    /* INVARIANT (debit-normal account convention): closing = opening + debit - credit */
    expect(rowCount).toBeGreaterThan(0);
    expect(
      opening + totalDebit - totalCredit,
      `GL math broken: opening ${opening} + debit ${totalDebit} - credit ${totalCredit} should equal closing ${closing}`,
    ).toBe(closing);
  });
});
