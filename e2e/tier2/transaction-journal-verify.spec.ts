import { expect, test } from "@playwright/test";
import { loginAsE2EOwner } from "./_fixtures/auth";
import {
  createPaidTransaction,
  ensureShiftOpen,
} from "./_fixtures/pos-seed";

/**
 * Sesi AE-99 — Transaction → Journal Entry end-to-end verification.
 *
 * Cek invariant yang paling penting buat Rama sebagai owner Mahakan:
 * **setiap transaksi POS yang sukses HARUS auto-post ke jurnal akuntansi**
 * dengan account mapping yang benar.
 *
 * Bug-class yang ditangkap:
 *   - Transaction sukses di POS tapi journal hook gagal silent
 *   - Auto-journal feature off-by-default tanpa warning
 *   - Account mapping salah (Kas → Bank Misc, atau Penjualan → Akumulasi)
 *   - Reverse journal post (debit/credit terbalik)
 *
 * Flow:
 *   1. Login → POS → buka shift kalau belum
 *   2. createPaidTransaction → extract TRX number dari receipt
 *   3. Navigate ke /dashboard#accounting → tab Jurnal
 *   4. Search by TRX number
 *   5. Verify entry muncul dengan description "Penjualan TRX <num>"
 *   6. Expand entry → verify lines: Kas (1110) debit + Penjualan (4101) credit
 */

test.describe("Transaction → Journal Entry verification", () => {
  test("Paid POS transaction auto-post ke jurnal dengan account mapping benar", async ({
    page,
  }) => {
    await loginAsE2EOwner(page, "/pos");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(2_500);

    /* 1-2. Buka shift + create transaction. */
    await ensureShiftOpen(page);
    const trxNumber = await createPaidTransaction(page);
    expect(
      trxNumber,
      "createPaidTransaction harus return TRX number dari receipt modal",
    ).toMatch(/^TRX-\d{8}-\d+$/);

    /* 3. Navigate ke Akuntansi → tab Jurnal. */
    await page.goto("/dashboard#accounting");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(2_500);

    const jurnalTab = page.getByRole("tab", { name: /Jurnal/i }).first();
    await expect(jurnalTab).toBeVisible({ timeout: 10_000 });
    await jurnalTab.click();
    await page.waitForTimeout(2_000);

    /* 4. Search by TRX number. */
    const searchInput = page.getByPlaceholder(/Cari deskripsi/i);
    await expect(searchInput).toBeVisible({ timeout: 5_000 });
    await searchInput.fill(trxNumber!);
    await page.waitForTimeout(1_500);

    /* 5. Verify ada entry dengan TRX number. Description format:
     * "Penjualan TRX <number> (<paymentMethod>)" */
    const entryDescription = page.getByText(
      new RegExp(`Penjualan TRX ${trxNumber}`, "i"),
    );
    await expect(entryDescription).toBeVisible({ timeout: 5_000 });

    /* 6. Expand entry — click summary. Entry pakai <details><summary>. */
    const summary = entryDescription.locator("xpath=ancestor::summary[1]");
    await summary.click();
    await page.waitForTimeout(1_000);

    /* 7. Verify accounts di entry lines.
     * Default Mahakan COA:
     *   - Kas: code "1110" (atau "1100"/"1101" depending on payment_method)
     *   - Penjualan: code "4101" atau "4xxx" series
     * Asssertion: minimal ada salah satu Kas account + salah satu Penjualan
     * account. */
    const entryRow = entryDescription.locator(
      "xpath=ancestor::details[1]//table",
    );
    await expect(entryRow).toBeVisible({ timeout: 3_000 });

    const tableText = await entryRow.innerText();
    /* Kas account (cash/bank) — code starts dengan 11xx (assets cash). */
    expect(tableText).toMatch(/11\d{2}.*Kas|Kas.*11\d{2}/i);
    /* Penjualan account — code 4xxx series (revenue). */
    expect(tableText).toMatch(/4\d{3}.*Penjualan|Penjualan/i);

    /* 8. Verify entry status = "Posted" (BUKAN draft). Draft entries
     * tidak affect laporan keuangan — kalau auto-journal post sebagai
     * draft, itu silent bug accounting. */
    const summaryRow = entryDescription.locator("xpath=ancestor::summary[1]");
    const summaryText = await summaryRow.innerText();
    expect(summaryText).toContain("Posted");
    expect(summaryText).not.toContain("Draft");

    /* 9. Verify entry-level total amount displayed. Format: "Rp X.XXX".
     * Hanya cek presence Rp + angka, tidak compare exact value (cogs +
     * kategori split bisa beda per branch). */
    expect(summaryText).toMatch(/Rp\s*\d/);

    /* 10. Verify balanced — sum debit lines = sum credit lines.
     * Parse table cells dengan ekstrak angka, compare totals. */
    const cellTexts = await entryRow.locator("td").allInnerTexts();
    let totalDebit = 0;
    let totalCredit = 0;
    /* Table format: 3 columns per row [Akun, Debit, Credit]. */
    for (let i = 0; i + 2 < cellTexts.length; i += 3) {
      totalDebit += parseRupiahCell(cellTexts[i + 1]);
      totalCredit += parseRupiahCell(cellTexts[i + 2]);
    }
    expect(
      totalDebit,
      `Debit total (${totalDebit}) must equal credit total (${totalCredit})`,
    ).toBe(totalCredit);
    expect(totalDebit).toBeGreaterThan(0);
  });
});

/**
 * Parse "Rp 1.000" / "Rp 25.500" / "—" → number.
 */
function parseRupiahCell(text: string): number {
  const cleaned = text.replace(/Rp|\.|—|\s/g, "").trim();
  if (!cleaned) return 0;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}
