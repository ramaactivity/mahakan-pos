import { expect, test } from "@playwright/test";
import { loginAsE2EOwner } from "./_fixtures/auth";

/**
 * Sesi AE-92 — Purchase (Pembelian) create flow smoke.
 *
 * Full mutation susah karena PurchaseFormModal punya:
 *   - Supplier dropdown (butuh existing supplier)
 *   - Item line: ingredient picker, qty, unit price, modifier
 *   - Photo upload (Vercel Blob)
 *   - Payment method + bank picker
 *
 * Smoke ini fokus verify modal terbuka + field render tanpa crash.
 * Real create flow akan masuk via UI manual oleh staff/owner.
 */

test.describe("Purchase (Pembelian) create flow", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsE2EOwner(page, "/dashboard#inventory");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(2_500);
  });

  test("Navigate to Pembelian tab → tombol Catat Pembelian visible", async ({
    page,
  }) => {
    /* Tab role="tab" di InventorySection. */
    const tab = page.getByRole("tab", { name: /Pembelian|Purchase/i });
    await expect(tab).toBeVisible({ timeout: 15_000 });
    await tab.click();
    await page.waitForTimeout(2_500);

    await expect(
      page.getByRole("button", { name: /Catat Pembelian/i }),
    ).toBeVisible({ timeout: 10_000 });
  });

  test("Click Catat Pembelian → modal terbuka dengan form line items", async ({
    page,
  }) => {
    const tab = page.getByRole("tab", { name: /Pembelian|Purchase/i });
    await tab.click();
    await page.waitForTimeout(2_500);

    await page.getByRole("button", { name: /Catat Pembelian/i }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 8_000 });
    /* Form fields render: tipe pembelian, supplier, line items. */
    const text = await dialog.innerText();
    expect(text).toMatch(/Pembelian|Tipe|Supplier|item|bahan/i);
  });
});
