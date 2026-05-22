import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";

/**
 * Sesi AE-97 — POS UI-driven seed helpers (F5 improvement).
 *
 * Idempotent helpers untuk memastikan test branch punya data yang dibutuhkan
 * sebelum test mutasi jalan. Pakai POS UI flow asli (bukan direct DB
 * insert) supaya invariant aplikasi (journal entry, stock deduct, dll)
 * konsisten.
 *
 * Helpers:
 *   - ensureShiftOpen(page) — buka shift kalau belum aktif.
 *   - createPaidTransaction(page) — add menu item, checkout cash, return
 *     ke /pos state. Idempotent: kalau menu tile / tombol bayar tidak
 *     tersedia (mis. layout berbeda), throws clear error.
 *
 * Catatan: helpers asumsikan user sudah login + di halaman /pos. Caller
 * yang panggil loginAsE2EOwner() dulu.
 */

export async function ensureShiftOpen(page: Page): Promise<void> {
  const shiftTab = page
    .getByRole("button", { name: "Shift", exact: true })
    .first();
  if (await shiftTab.isVisible({ timeout: 1_000 }).catch(() => false)) {
    await shiftTab.click();
    await page.waitForTimeout(1_500);
  }

  const bodyText = await page.locator("body").innerText();
  if (!/Shift Belum Dibuka/i.test(bodyText)) {
    /* Sudah open — selesai. */
    return;
  }

  await page.getByRole("button", { name: /^Buka Shift$/i }).click();
  await expect(
    page.getByRole("heading", { name: /Buka Shift/i }),
  ).toBeVisible({ timeout: 10_000 });

  await page.getByRole("button", { name: /Buka Shift\s*·\s*Rp/i }).click();

  await expect(
    page.getByRole("button", { name: /Selesai.*Mulai Jualan/i }),
  ).toBeVisible({ timeout: 15_000 });
  await page
    .getByRole("button", { name: /Selesai.*Mulai Jualan/i })
    .click();
  await page.waitForTimeout(2_000);
}

export async function createPaidTransaction(page: Page): Promise<string | null> {
  /* Pastikan di tab Kasir. */
  const kasirTab = page
    .getByRole("button", { name: "Kasir", exact: true })
    .first();
  await expect(kasirTab).toBeVisible({ timeout: 15_000 });
  await kasirTab.click();
  await page.waitForTimeout(2_000);

  /* Add menu item — cari tile pertama yang Affogato/Americano/Bakmi (default
   * Mahakan inventory). */
  const menuTile = page
    .getByRole("button", { name: /Affogato|Americano|Bakmi/i })
    .first();
  await expect(menuTile).toBeVisible({ timeout: 15_000 });
  await menuTile.click();
  await page.waitForTimeout(1_500);

  /* Optional variant modal (Hot/Iced). */
  const dialog = page.getByRole("dialog");
  if (await dialog.isVisible({ timeout: 500 }).catch(() => false)) {
    const hotBtn = dialog.getByRole("button", { name: /Hot/i }).first();
    if (await hotBtn.isVisible({ timeout: 500 }).catch(() => false)) {
      await hotBtn.click();
      await page.waitForTimeout(500);
    }
    const tambahBtn = dialog
      .getByRole("button", { name: /Tambah|Konfirmasi/i })
      .first();
    if (await tambahBtn.isVisible({ timeout: 500 }).catch(() => false)) {
      await tambahBtn.click();
    }
    await page.waitForTimeout(1_000);
  }

  /* Bayar flow. */
  const bayarBtn = page.getByRole("button", { name: /Bayar\s*·\s*Rp/i });
  await expect(bayarBtn).toBeVisible({ timeout: 5_000 });
  await bayarBtn.click();

  const lanjutBtn = page.getByRole("button", { name: /Lanjut Bayar/i });
  await expect(lanjutBtn).toBeVisible({ timeout: 10_000 });
  await lanjutBtn.click();

  await expect(
    page.getByRole("heading", { name: /Bayar Transaksi/i }),
  ).toBeVisible({ timeout: 10_000 });

  const pasBtn = page.getByRole("button", { name: "Pas", exact: true });
  await expect(pasBtn).toBeVisible({ timeout: 5_000 });
  await pasBtn.click();

  const konfirmBtn = page.getByRole("button", { name: /Konfirmasi Bayar/i });
  await expect(konfirmBtn).toBeEnabled({ timeout: 5_000 });
  await konfirmBtn.click();

  /* TransactionSuccessModal render TRX number di receipt — extract dulu
   * sebelum dismiss supaya caller bisa verify entry akuntansi. */
  await page.waitForTimeout(2_500);

  let trxNumber: string | null = null;
  const trxLocator = page.locator('text=/TRX-\\d{8}-\\d+/').first();
  if (await trxLocator.isVisible({ timeout: 2_000 }).catch(() => false)) {
    const text = (await trxLocator.textContent())?.trim() ?? "";
    const match = text.match(/TRX-\d{8}-\d+/);
    trxNumber = match ? match[0] : null;
  }

  /* Dismiss modal pakai Escape (paling reliable — multiple action buttons
   * di strict-mode locator bingung). */
  await page.keyboard.press("Escape");
  await page.waitForTimeout(1_000);

  return trxNumber;
}
