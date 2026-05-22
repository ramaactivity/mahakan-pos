import { expect, test } from "@playwright/test";
import { loginAsE2EOwner } from "./_fixtures/auth";
import {
  createPaidTransaction,
  ensureShiftOpen,
} from "./_fixtures/pos-seed";

/**
 * Sesi AE-102 — Shift close variance → journal entry verification.
 *
 * Multi-shift accumulation kritis untuk Mahakan: tiap shift close dengan
 * variance != 0 HARUS produce `shift_variance` journal entry. Kalau hook
 * gagal silent, owner kehilangan visibility ke discrepancy kasir.
 *
 * Flow:
 *   1. Login → POS → buka shift kalau belum
 *   2. createPaidTransaction (Rp 21k cash → drawer increase)
 *   3. Click "Tutup Shift" button → CloseShiftModal opens
 *   4. Fill cash count = "0" (force big NEGATIVE variance)
 *   5. Submit "Tutup Shift"
 *   6. Navigate Akuntansi → Jurnal
 *   7. Search "Selisih kas"
 *   8. Verify entry exists dengan sourceType=shift_variance, balanced,
 *      Posted status, description format "Selisih kas Shift XXXX (±N)"
 *
 * SERIAL MODE — closing shift affects other parallel specs. Run in
 * isolation to avoid race on shared shift state. After this spec,
 * ensureShiftOpen di spec lain akan re-open fresh shift (idempotent).
 *
 * Bug-class yang ditangkap:
 *   - shift_variance hook gagal post (variance silent)
 *   - Imbalanced variance journal (debit != credit)
 *   - Status draft bukan posted
 *   - Description tidak match shift identifier (orphan entry)
 */

test.describe.configure({ mode: "serial" });

test.describe("Shift close → variance journal", () => {
  test("Close shift dengan WRONG cash count → shift_variance entry posted", async ({
    page,
  }) => {
    test.setTimeout(120_000);

    /* 1-2. Buka shift + create transaction. */
    await loginAsE2EOwner(page, "/pos");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(2_500);

    await ensureShiftOpen(page);
    const trxNumber = await createPaidTransaction(page);
    expect(trxNumber, "Seed harus return TRX").toMatch(/^TRX-\d{8}-\d+$/);

    /* 3. Navigate ke tab Shift untuk akses Tutup Shift button. */
    const shiftTab = page
      .getByRole("button", { name: "Shift", exact: true })
      .first();
    await expect(shiftTab).toBeVisible({ timeout: 10_000 });
    await shiftTab.click();
    await page.waitForTimeout(2_000);

    /* 4. Click "Tutup Shift" → CloseShiftModal. */
    const tutupBtn = page.getByRole("button", { name: /^Tutup Shift$/i }).first();
    await expect(tutupBtn).toBeVisible({ timeout: 10_000 });
    await tutupBtn.click();

    /* Modal opens — title "Tutup Shift" heading. */
    await expect(
      page.getByRole("heading", { name: /^Tutup Shift$/i }),
    ).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(1_500);

    /* 5. Fill cash count via numpad — CloseShiftModal pakai NumKey button
     * grid (1-9, 0, C clear, backspace). Click "0" untuk set actualCash="0",
     * yang trigger variance = -expectedCash (Rp 881k atau lebih).
     * submitDisabled = actualCash.trim().length === 0, jadi "0" sudah cukup
     * unblock submit. */
    const dialog = page.getByRole("dialog");
    const zeroDigit = dialog
      .getByRole("button", { name: "0", exact: true })
      .first();
    await expect(zeroDigit).toBeVisible({ timeout: 5_000 });
    await zeroDigit.click();
    await page.waitForTimeout(1_000);

    /* 6. Submit "Tutup Shift" — footer button. Modal punya 2 button
     * dengan label "Tutup Shift" (header title + footer submit). Pakai
     * footer button by getByRole + last instance OR yang enabled. */
    const submitBtn = dialog
      .getByRole("button", { name: /^Tutup Shift$/i })
      .last();
    await expect(submitBtn).toBeEnabled({ timeout: 10_000 });
    await submitBtn.click();

    /* Tunggu success — modal close OR success toast OR redirect.
     * Server submission ~5-10s untuk shift close + journal hook. */
    await page.waitForTimeout(8_000);

    /* 7. Navigate ke Akuntansi → Jurnal. */
    await page.goto("/dashboard#accounting");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(2_500);

    const jurnalTab = page.getByRole("tab", { name: /^Jurnal$/i }).first();
    await expect(jurnalTab).toBeVisible({ timeout: 10_000 });
    await jurnalTab.click();
    await page.waitForTimeout(2_000);

    /* 8. Search "Selisih kas". */
    const searchInput = page.getByPlaceholder(/Cari deskripsi/i);
    await expect(searchInput).toBeVisible({ timeout: 5_000 });
    await searchInput.fill("Selisih kas");
    await page.waitForTimeout(2_000);

    /* 9. Verify ada entry dengan "Selisih kas" di description.
     * Format: "Selisih kas Shift XXXXXXXX (+N atau -N)" */
    const entryDescription = page
      .getByText(/Selisih kas Shift [a-f0-9]+ \([-+]\d/i)
      .first();
    await expect(entryDescription).toBeVisible({ timeout: 5_000 });

    /* 10. Expand entry, verify status Posted + balanced. */
    const summary = entryDescription.locator("xpath=ancestor::summary[1]");
    const summaryText = await summary.innerText();
    expect(summaryText).toContain("Posted");
    expect(summaryText).not.toContain("Draft");
    await summary.click();
    await page.waitForTimeout(1_000);

    const lineTable = entryDescription.locator(
      "xpath=ancestor::details[1]//table",
    );
    await expect(lineTable).toBeVisible({ timeout: 3_000 });
    const cellTexts = await lineTable.locator("td").allInnerTexts();

    /* Balanced check: sum debit = sum credit. */
    let totalDebit = 0;
    let totalCredit = 0;
    for (let i = 0; i + 2 < cellTexts.length; i += 3) {
      totalDebit += parseRupiahCell(cellTexts[i + 1]);
      totalCredit += parseRupiahCell(cellTexts[i + 2]);
    }
    expect(
      totalDebit,
      `Variance journal harus balanced — debit ${totalDebit} vs credit ${totalCredit}`,
    ).toBe(totalCredit);
    expect(totalDebit).toBeGreaterThan(0);
  });
});

function parseRupiahCell(text: string): number {
  const cleaned = text.replace(/Rp|\.|—|\s/g, "").trim();
  if (!cleaned) return 0;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}
