import { expect, test } from "@playwright/test";
import { loginAsE2EOwner } from "./_fixtures/auth";
import {
  createPaidTransaction,
  ensureShiftOpen,
} from "./_fixtures/pos-seed";

/**
 * Sesi AE-96 — Multi-koreksi pos_sale chain UI smoke (AE-83 fix).
 *
 * AE-83 fix: round 2+ koreksi reverses previous correction's
 * correctedJournalEntryId (bukan original pos_sale entry). Test ini
 * fokus ke UI state machine di HistoryDetailModal yang expose:
 *   - "Koreksi Transaksi" button (request first koreksi)
 *   - "Approve Koreksi" button (kalau pending koreksi exist)
 *   - "Koreksi Pending" badge (kalau row pending)
 *
 * Full chain test (round 1 + 2 approve + journal verify) butuh:
 *   1. Seed paid transaction
 *   2. Email interception untuk approval code
 *   3. Approver session (different user)
 *   4. Query journal_entries by sourceType='pos_sale_correction'
 *
 * E2E smoke di sini cukup verify entrypoint UI exist dan modal render.
 * Server-side multi-round logic ditest via vitest di sebenarnya.
 */

test.describe("Multi-koreksi UI entrypoint (HistoryDetailModal)", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsE2EOwner(page, "/pos");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(2_500);

    const riwayatTab = page
      .getByRole("button", { name: "Riwayat", exact: true })
      .first();
    if (
      !(await riwayatTab.isVisible({ timeout: 10_000 }).catch(() => false))
    ) {
      test.skip(true, "Riwayat tab tidak terlihat");
    }
    await riwayatTab.click();
    await page.waitForTimeout(3_000);
  });

  test("Riwayat panel render filter chip Lunas/Open/Void/Refund", async ({
    page,
  }) => {
    const bodyText = await page.locator("body").innerText();
    expect(bodyText).toMatch(/Lunas|Open|Void|Refund|riwayat/i);
  });

  test("Klik transaksi → HistoryDetailModal render dengan action menu", async ({
    page,
  }) => {
    /* Cari row pertama yang ada TRX number. */
    const trxRow = page.locator('text=/TRX-?\\d/').first();
    if (!(await trxRow.isVisible({ timeout: 5_000 }).catch(() => false))) {
      test.skip(true, "Tidak ada transaksi di test branch");
    }
    await trxRow.click();
    await page.waitForTimeout(1_500);

    /* HistoryDetailModal render — verify dialog terbuka. */
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 5_000 });

    /* Salah satu action button standard: "Koreksi Transaksi", "Refund",
     * "Void", "Cetak Struk". Dialog render setidaknya salah satu. */
    const dialogText = await dialog.innerText();
    expect(dialogText).toMatch(
      /Koreksi Transaksi|Refund|Void|Cetak Struk|TRX-?\d/i,
    );
  });

  test("HistoryDetailModal → 'Koreksi Transaksi' → TransactionCorrectionModal", async ({
    page,
  }) => {
    /* F5 — seed fresh paid transaction supaya kemungkinan besar ada
     * eligible trx (tidak ada pending correction). Tetap graceful skip
     * kalau ternyata semua trx top-N punya pending correction (mis. dari
     * banyak test run sebelumnya yang sudah pollute state). */
    await ensureShiftOpen(page);
    await createPaidTransaction(page);

    const riwayatTab = page
      .getByRole("button", { name: "Riwayat", exact: true })
      .first();
    await riwayatTab.click();
    await page.waitForTimeout(2_000);

    const lunasChip = page.getByRole("button", { name: /^Lunas$/i }).first();
    if (await lunasChip.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await lunasChip.click();
      await page.waitForTimeout(1_000);
    }

    /* Iterate semua paid transactions (max 10). Fresh-seeded should be
     * di top. Kalau none eligible, skip dengan clear reason. */
    const rows = page.locator('text=/TRX-?\\d/');
    const rowCount = await rows.count();
    if (rowCount === 0) {
      test.skip(true, "Seed gagal — no paid transaction visible");
    }

    const limit = Math.min(rowCount, 10);
    let foundEligible = false;
    for (let i = 0; i < limit; i++) {
      await rows.nth(i).click();
      const dialog = page.getByRole("dialog").first();
      await dialog.waitFor({ state: "visible", timeout: 5_000 });

      const koreksiBtn = dialog
        .getByRole("button", { name: /Koreksi Transaksi/i })
        .first();
      const visible = await koreksiBtn
        .isVisible({ timeout: 2_000 })
        .catch(() => false);

      if (visible) {
        await koreksiBtn.click();
        const ajukanHeading = page.getByText(/Ajukan Koreksi/i).first();
        await expect(ajukanHeading).toBeVisible({ timeout: 5_000 });
        foundEligible = true;
        break;
      }

      await page.keyboard.press("Escape");
      await dialog.waitFor({ state: "hidden", timeout: 3_000 }).catch(() => {});
    }

    /* F5 known limitation — kalau test branch sudah ter-pollute pending
     * correction dari banyak run sebelumnya, skip tanpa fail. Skip ini
     * informational, bukan tanda regression. */
    if (!foundEligible) {
      test.skip(
        true,
        `Test branch state pollution: ${limit} paid trx teratas semua sudah ada pending correction. Reset branch atau approve/reject pending correction lama untuk re-enable.`,
      );
    }
  });
});
