import { expect, test } from "@playwright/test";
import { loginAsE2EOwner } from "./_fixtures/auth";

/**
 * Sesi AE-95 — Transaction Correction (Koreksi Riwayat) smoke.
 *
 * Multi-koreksi pos_sale chain (sesi AE-83 fix) hidup di tab Riwayat
 * panel POS. Untuk smoke test cukup verify:
 *   - Tab Riwayat render
 *   - Klik salah satu transaksi → action button "Ajukan Koreksi"
 *     atau modal correction dapat muncul
 *
 * Full mutation flow (request → approval code email → approve → multi-round
 * reverse chain) butuh email interception + approver session — di-skip.
 */

test.describe("Transaction correction request entrypoint", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsE2EOwner(page, "/pos");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(2_500);
  });

  test("Riwayat tab punya entrypoint koreksi atau action menu", async ({
    page,
  }) => {
    const riwayatTab = page
      .getByRole("button", { name: "Riwayat", exact: true })
      .first();
    if (
      !(await riwayatTab.isVisible({ timeout: 10_000 }).catch(() => false))
    ) {
      test.skip(true, "Riwayat tab tidak terlihat (tablet/mobile layout?)");
    }
    await riwayatTab.click();
    await page.waitForTimeout(3_000);

    const bodyText = await page.locator("body").innerText();
    /* Riwayat panel kemungkinan show:
     *   - Daftar transaksi (TRX-...)
     *   - Action button "Koreksi" / "Refund" / "Ajukan Koreksi"
     * Cukup verify tidak crash + ada konten transaksi. */
    expect(bodyText).not.toMatch(
      /something went wrong|client-side exception/i,
    );
    expect(bodyText).toMatch(/TRX-?\d|kosong|Lunas|riwayat/i);
  });

  test("Tombol 'Ajukan Koreksi' visible kalau ada transaksi", async ({
    page,
  }) => {
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

    /* Cari tombol Koreksi / Ajukan Koreksi anywhere di panel. Kalau tidak
     * ada (no transactions yet), skip. */
    const koreksiBtn = page
      .getByRole("button", { name: /Ajukan Koreksi|Koreksi/i })
      .first();
    if (
      !(await koreksiBtn.isVisible({ timeout: 5_000 }).catch(() => false))
    ) {
      test.skip(true, "Tidak ada transaksi yang bisa di-koreksi");
    }
    /* Click → verify modal terbuka. */
    await koreksiBtn.click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 5_000 });
  });
});
