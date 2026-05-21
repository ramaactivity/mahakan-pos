import { expect, test } from "@playwright/test";
import { loginAsE2EOwner } from "./_fixtures/auth";

/**
 * Sesi AE-88 — Full POS transaction flow E2E.
 *
 * Flow:
 *   1. Login owner → /pos
 *   2. Open shift kalau belum aktif (kas awal default 100k)
 *   3. Click menu tile pertama → add to cart
 *   4. Click "Bayar · Rp X" → payment modal
 *   5. Verify cash sufficient default (user types cash exact)
 *   6. Click "Konfirmasi Bayar" → server creates transaction
 *   7. Verify TransactionSuccessModal muncul (struk ready)
 *
 * Test mode serial supaya tidak ada race antara test buka-shift vs
 * test transaksi.
 */

test.describe.configure({ mode: "serial" });

test.describe("Full POS transaction flow", () => {
  test("Setup: pastikan shift aktif", async ({ page }) => {
    await loginAsE2EOwner(page, "/pos");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(2_500);

    /* PosLeftNav default tab kemungkinan "shifts" untuk owner pertama
     * landing. Navigate ke "Shift" tab eksplisit. */
    const shiftTab = page
      .getByRole("button", { name: "Shift", exact: true })
      .first();
    if (await shiftTab.isVisible({ timeout: 1_000 }).catch(() => false)) {
      await shiftTab.click();
      await page.waitForTimeout(1_500);
    }

    const bodyText = await page.locator("body").innerText();
    if (/Shift Belum Dibuka/i.test(bodyText)) {
      await page.getByRole("button", { name: /^Buka Shift$/i }).click();
      await expect(
        page.getByRole("heading", { name: /Buka Shift/i }),
      ).toBeVisible({ timeout: 10_000 });

      await page
        .getByRole("button", { name: /Buka Shift\s*·\s*Rp/i })
        .click();

      await expect(
        page.getByRole("button", { name: /Selesai.*Mulai Jualan/i }),
      ).toBeVisible({ timeout: 15_000 });
      await page.getByRole("button", { name: /Selesai.*Mulai Jualan/i }).click();
      await page.waitForTimeout(2_500);
    }

    /* Verify shift active state. */
    const afterText = await page.locator("body").innerText();
    expect(afterText).not.toMatch(/Shift Belum Dibuka/i);
  });

  test("Add menu item → checkout cash → struk success modal", async ({
    page,
  }) => {
    await loginAsE2EOwner(page, "/pos");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(2_500);

    /* Navigate ke tab "Kasir" untuk akses menu tiles + cart. */
    const kasirTab = page
      .getByRole("button", { name: "Kasir", exact: true })
      .first();
    await expect(kasirTab).toBeVisible({ timeout: 15_000 });
    await kasirTab.click();
    await page.waitForTimeout(2_000);

    const bodyText = await page.locator("body").innerText();
    test.skip(
      /Shift Belum Dibuka/i.test(bodyText),
      "Shift belum dibuka — setup test gagal",
    );

    /* Find menu tile. 44 items di branch. */
    const menuTile = page
      .getByRole("button", { name: /Affogato|Americano|Bakmi/i })
      .first();
    await expect(menuTile).toBeVisible({ timeout: 15_000 });
    await menuTile.click();

    /* Item yang priceType='variant' (mis. Americano) butuh modal pilih
     * Hot/Iced. Affogato priceType='fixed' langsung add. Either way,
     * cart akan ke-update. */
    await page.waitForTimeout(1_500);

    /* Kalau ada variant modal, pilih opsi pertama. */
    const variantConfirm = page
      .getByRole("button", { name: /Hot|Iced|Konfirmasi|Tambah/i })
      .first();
    if (
      await variantConfirm.isVisible({ timeout: 1_000 }).catch(() => false)
    ) {
      /* Klik kalau modal variant muncul. */
      const dialog = page.getByRole("dialog");
      if (await dialog.isVisible({ timeout: 500 }).catch(() => false)) {
        /* Pilih opsi Hot atau Iced kalau ada. */
        const hotBtn = dialog.getByRole("button", { name: /Hot/i }).first();
        if (await hotBtn.isVisible({ timeout: 500 }).catch(() => false)) {
          await hotBtn.click();
          await page.waitForTimeout(500);
        }
        /* Konfirmasi tambah ke cart. */
        const tambahBtn = dialog
          .getByRole("button", { name: /Tambah|Konfirmasi/i })
          .first();
        if (await tambahBtn.isVisible({ timeout: 500 }).catch(() => false)) {
          await tambahBtn.click();
        }
      }
    }

    await page.waitForTimeout(1_500);

    /* Click "Bayar · Rp X" footer button. */
    const bayarBtn = page.getByRole("button", { name: /Bayar\s*·\s*Rp/i });
    await expect(bayarBtn).toBeVisible({ timeout: 5_000 });
    await bayarBtn.click();

    /* Intermediate: OrderMetaModal "Konfirmasi Order" — pager + nama
     * customer optional. Wait + click "Lanjut Bayar". */
    const lanjutBtn = page.getByRole("button", { name: /Lanjut Bayar/i });
    await expect(lanjutBtn).toBeVisible({ timeout: 10_000 });
    await lanjutBtn.click();

    /* Payment modal: title "Bayar Transaksi". */
    await expect(
      page.getByRole("heading", { name: /Bayar Transaksi/i }),
    ).toBeVisible({ timeout: 10_000 });

    /* Click "Pas" button untuk auto-fill cash = total (kembalian 0). */
    const pasBtn = page.getByRole("button", { name: "Pas", exact: true });
    await expect(pasBtn).toBeVisible({ timeout: 5_000 });
    await pasBtn.click();

    /* Sekarang button bottom berubah jadi "Konfirmasi Bayar Rp X" enabled. */
    const konfirmBtn = page.getByRole("button", {
      name: /Konfirmasi Bayar/i,
    });
    await expect(konfirmBtn).toBeEnabled({ timeout: 5_000 });
    await konfirmBtn.click();

    /* TransactionSuccessModal — verify ada element yang indicate sukses. */
    await page.waitForTimeout(3_500);
    const afterBody = await page.locator("body").innerText();
    /* Sukses indicator: "Berhasil", transactionNumber, "Cetak Struk", dll. */
    expect(afterBody).toMatch(
      /berhasil|sukses|lunas|struk|trx|transaction|cetak/i,
    );
  });
});
