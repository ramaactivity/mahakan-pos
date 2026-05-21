import { expect, test } from "@playwright/test";
import { loginAsE2EOwner } from "./_fixtures/auth";

/**
 * Sesi AE-88 — Tier 2 pengelola CRUD flow.
 *
 * Mirror investor-crud pattern. Branch isolated jadi aman create
 * pengelola test. Submit footer button "Tambah" (bukan "Tambah Pengelola"
 * — beda dengan investor yang "Tambah Investor").
 */

const TS = Date.now();
const TEST_PENGELOLA_NAME = `E2E Test Pengelola ${TS}`;

test.describe("Pengelola CRUD flow", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsE2EOwner(page, "/dashboard#investors");
  });

  test("Switch ke tab Pengelola + tombol Tambah Pengelola visible", async ({
    page,
  }) => {
    const tabBtn = page.getByRole("button", { name: "Pengelola", exact: true });
    await expect(tabBtn).toBeVisible({ timeout: 15_000 });
    await tabBtn.click();
    await expect(
      page.getByRole("button", { name: "Tambah Pengelola", exact: true }),
    ).toBeVisible({ timeout: 10_000 });
  });

  test("Submit form pengelola baru → modal close + created", async ({
    page,
  }) => {
    const tabBtn = page.getByRole("button", { name: "Pengelola", exact: true });
    await tabBtn.click();
    await expect(
      page.getByRole("button", { name: "Tambah Pengelola", exact: true }),
    ).toBeVisible({ timeout: 10_000 });

    await page
      .getByRole("button", { name: "Tambah Pengelola", exact: true })
      .click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 5_000 });

    /* Fill: index 0 = Nama Lengkap, modal disetor pakai inputmode=numeric. */
    await dialog.locator("input").nth(0).fill(TEST_PENGELOLA_NAME);
    await dialog
      .locator('input[inputmode="numeric"]')
      .first()
      .fill("1500000");

    /* Submit footer button = "Tambah" (bukan "Tambah Pengelola"). */
    await dialog.getByRole("button", { name: "Tambah", exact: true }).click();

    /* Modal close → success. */
    await expect(dialog).not.toBeVisible({ timeout: 30_000 });
  });
});
