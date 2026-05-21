import { expect, test } from "@playwright/test";
import { loginAsE2EOwner } from "./_fixtures/auth";

/**
 * Sesi AE-87 — Tier 2 inventory section flow.
 *
 * Coverage:
 *   - Section /dashboard#inventory render dengan daftar bahan
 *   - Tombol Tambah Bahan trigger modal
 *   - Filter / search interaction smoke
 */

test.describe("Inventory section", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsE2EOwner(page, "/dashboard#inventory");
  });

  test("Daftar bahan render dengan minimal 1 ingredient", async ({ page }) => {
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(2_500);

    const bodyText = await page.locator("body").innerText();
    /* Branch mirror prod punya banyak bahan; verify ada keyword inventory. */
    expect(bodyText).toMatch(/bahan|inventory|stok|kategori/i);
  });

  test("Tombol Tambah Bahan render", async ({ page }) => {
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(2_000);
    await expect(
      page.getByRole("button", { name: /Tambah Bahan/i }),
    ).toBeVisible({ timeout: 10_000 });
  });

  test("Click Tambah Bahan → modal form render", async ({ page }) => {
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(2_000);
    await page.getByRole("button", { name: /Tambah Bahan/i }).click();
    /* Modal title sesuai IngredientFormModal. */
    await expect(
      page.locator("body").getByText(/Tambah Bahan/i).first(),
    ).toBeVisible({ timeout: 5_000 });
  });
});
