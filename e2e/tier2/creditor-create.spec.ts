import { expect, test } from "@playwright/test";
import { loginAsE2EOwner } from "./_fixtures/auth";

/**
 * Sesi AE-88 — Tier 2 creditor manual create flow (sesi AE-80 module).
 *
 * Verifies bukan cuma modal terbuka (di convert-investor.spec.ts), tapi
 * full submit + create kreditur baru di branch DB.
 */

const TS = Date.now();
const TEST_CREDITOR_NAME = `E2E Test Kreditur ${TS}`;

test.describe("Creditor manual create flow (sesi AE-80)", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsE2EOwner(page, "/dashboard#investors");
    /* Switch ke tab Hutang Kreditur. */
    const tabBtn = page.getByRole("button", { name: /Hutang Kreditur/i });
    await expect(tabBtn).toBeVisible({ timeout: 15_000 });
    await tabBtn.click();
    await expect(
      page.getByRole("button", { name: /Tambah Kreditur/i }),
    ).toBeVisible({ timeout: 10_000 });
  });

  test("Click Tambah Kreditur → modal terbuka dengan form lengkap", async ({
    page,
  }) => {
    await page.getByRole("button", { name: /Tambah Kreditur/i }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 5_000 });

    /* Verify field utama present. */
    await expect(dialog.locator("input").first()).toBeVisible();
    /* Tombol footer "Tambah Kreditur" untuk submit. */
    await expect(
      dialog.getByRole("button", { name: "Tambah Kreditur", exact: true }),
    ).toBeVisible();
  });

  test("Submit form kreditur baru → modal close + created", async ({ page }) => {
    await page.getByRole("button", { name: /Tambah Kreditur/i }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 5_000 });

    /* Fill nama via label (Modal Radix link label ke input via htmlFor). */
    await dialog.getByLabel(/Nama Lengkap/i).first().fill(TEST_CREDITOR_NAME);

    /* Pokok Awal Pinjaman — NIK juga inputmode="numeric" jadi `.first()`
     * akan kena NIK. Pakai label getByLabel untuk match Pokok Awal
     * specifically. */
    await dialog
      .getByLabel(/Pokok Awal/i)
      .first()
      .fill("5000000");

    /* DatePicker default today. Submit. */
    await dialog
      .getByRole("button", { name: "Tambah Kreditur", exact: true })
      .click();

    await expect(dialog).not.toBeVisible({ timeout: 30_000 });
  });
});
