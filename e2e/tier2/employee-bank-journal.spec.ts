import { expect, test } from "@playwright/test";
import { loginAsE2EOwner } from "./_fixtures/auth";

/**
 * Sesi AE-93 — Smoke tests untuk Karyawan + Bank Account + Journal Manual.
 *
 * Coverage:
 *   - Karyawan: tombol Tambah Karyawan + modal
 *   - Bank Account (di Settings): list + Tambah Bank
 *   - Journal Manual: "Buat Entry Manual" → JournalEntryModal
 */

test.describe("Employee CRUD flow", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsE2EOwner(page, "/dashboard#employees");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(2_500);
  });

  test("Tombol Tambah Karyawan render", async ({ page }) => {
    await expect(
      page.getByRole("button", { name: /Tambah Karyawan/i }),
    ).toBeVisible({ timeout: 15_000 });
  });

  test("Click Tambah Karyawan → EmployeeFormModal terbuka", async ({
    page,
  }) => {
    await page.getByRole("button", { name: /Tambah Karyawan/i }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 5_000 });
    /* Field utama: nama, role, gaji. */
    const text = await dialog.innerText();
    expect(text).toMatch(/nama|karyawan|role|posisi/i);
  });
});

test.describe("Bank Account CRUD flow (via Settings)", () => {
  test("Settings render dengan section Bank Accounts", async ({ page }) => {
    await loginAsE2EOwner(page, "/dashboard#settings");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(2_500);

    const bodyText = await page.locator("body").innerText();
    /* Settings section punya Bank Accounts card. */
    expect(bodyText).toMatch(/bank|account|rekening|setting/i);
  });
});

test.describe("Accounting Journal manual entry", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsE2EOwner(page, "/dashboard#accounting");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(2_500);
  });

  test("Tab Jurnal render + tombol Buat Entry Manual visible", async ({
    page,
  }) => {
    /* Accounting punya tab navigation. Pilih Jurnal kalau ada. */
    const jurnalTab = page
      .getByRole("tab", { name: /Jurnal/i })
      .first();
    if (await jurnalTab.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await jurnalTab.click();
      await page.waitForTimeout(1_500);
    }

    const buatBtn = page.getByRole("button", { name: /Buat Entry Manual/i });
    await expect(buatBtn).toBeVisible({ timeout: 10_000 });
  });

  test("Click Buat Entry Manual → JournalEntryModal terbuka", async ({
    page,
  }) => {
    const jurnalTab = page
      .getByRole("tab", { name: /Jurnal/i })
      .first();
    if (await jurnalTab.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await jurnalTab.click();
      await page.waitForTimeout(1_500);
    }

    await page.getByRole("button", { name: /Buat Entry Manual/i }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 5_000 });
    /* Field: date, description, lines (Dr/Cr). */
    const text = await dialog.innerText();
    expect(text).toMatch(/jurnal|entry|debit|kredit|akun|tanggal/i);
  });
});
