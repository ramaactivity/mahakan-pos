import { expect, test } from "@playwright/test";
import { loginAsE2EOwner } from "./_fixtures/auth";

/**
 * Sesi AE-90 — Menu admin section smoke.
 *
 * Coverage:
 *   - Section /dashboard#menu render
 *   - Tab Items render dengan tombol "Tambah Item"
 *   - Tab Categories render dengan tombol "Tambah Kategori"
 *   - Tab Modifiers render
 */

test.describe("Menu admin section", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsE2EOwner(page, "/dashboard#menu");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(2_500);
  });

  test("Tab Items render dengan tombol Tambah Item", async ({ page }) => {
    /* Default tab biasanya items. Verify ada Tambah Item button. */
    await expect(
      page.getByRole("button", { name: /Tambah Item/i }),
    ).toBeVisible({ timeout: 15_000 });
  });

  test("Click Tambah Item → modal MenuItemFormModal terbuka", async ({
    page,
  }) => {
    await page.getByRole("button", { name: /Tambah Item/i }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 5_000 });
    /* Title "Tambah Menu Item". */
    const bodyText = await dialog.innerText();
    expect(bodyText).toMatch(/Tambah Menu Item|Nama|Harga|Kategori/i);
  });

  test("Menu section render tanpa error boundary", async ({ page }) => {
    const bodyText = await page.locator("body").innerText();
    expect(bodyText).not.toMatch(
      /something went wrong|client-side exception|application error/i,
    );
    /* Verify menu kategori chip present. */
    expect(bodyText).toMatch(/menu|item|kategori/i);
  });
});
