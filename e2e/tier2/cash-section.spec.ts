import { expect, test } from "@playwright/test";
import { loginAsE2EOwner } from "./_fixtures/auth";

/**
 * Sesi AE-92 — Cash section (Pemasukan + Pengeluaran) smoke tests.
 */

test.describe("Cash section flows", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsE2EOwner(page, "/dashboard#cash");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(2_500);
  });

  test("Tambah Pemasukan button render + click → IncomeFormModal", async ({
    page,
  }) => {
    /* Tab Pemasukan kalau ada, atau button langsung visible. */
    const pemasukanTab = page
      .getByRole("tab", { name: /Pemasukan/i })
      .first();
    if (await pemasukanTab.isVisible({ timeout: 1_500 }).catch(() => false)) {
      await pemasukanTab.click();
      await page.waitForTimeout(1_500);
    }

    const addBtn = page.getByRole("button", { name: /Tambah Pemasukan/i });
    await expect(addBtn).toBeVisible({ timeout: 10_000 });
    await addBtn.click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 5_000 });
  });

  test("Tambah Pengeluaran button + click → ExpenseFormModal", async ({
    page,
  }) => {
    /* Switch to Pengeluaran tab kalau ada. */
    const pengeluaranTab = page
      .getByRole("tab", { name: /Pengeluaran/i })
      .first();
    if (await pengeluaranTab.isVisible({ timeout: 1_500 }).catch(() => false)) {
      await pengeluaranTab.click();
      await page.waitForTimeout(1_500);
    }

    const addBtn = page.getByRole("button", { name: /Tambah Pengeluaran/i });
    await expect(addBtn).toBeVisible({ timeout: 10_000 });
    await addBtn.click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 5_000 });
  });
});
