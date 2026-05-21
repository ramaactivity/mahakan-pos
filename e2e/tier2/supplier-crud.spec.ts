import { expect, test } from "@playwright/test";
import { loginAsE2EOwner } from "./_fixtures/auth";

/**
 * Sesi AE-90 — Supplier CRUD flow E2E.
 *
 * Flow: tab Suppliers → click Tambah Supplier → modal → fill nama →
 * submit → modal close + supplier ke-create di branch DB.
 */

const TS = Date.now();
const TEST_SUPPLIER = `E2E Supplier ${TS}`;

test.describe("Supplier CRUD flow", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsE2EOwner(page, "/dashboard#suppliers");
    await page.waitForLoadState("networkidle");
  });

  test("Section render + tombol Tambah Supplier visible", async ({ page }) => {
    await expect(
      page.getByRole("button", { name: /Tambah Supplier/i }),
    ).toBeVisible({ timeout: 15_000 });
  });

  test("Submit form supplier baru → modal close", async ({ page }) => {
    await page.getByRole("button", { name: /Tambah Supplier/i }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 5_000 });

    /* Fill Nama Supplier — first input dalam dialog. */
    await dialog.locator("input").first().fill(TEST_SUPPLIER);

    /* Submit footer button "Tambah". */
    await dialog.getByRole("button", { name: "Tambah", exact: true }).click();

    await expect(dialog).not.toBeVisible({ timeout: 30_000 });

    /* Verify muncul di list. */
    await page.waitForTimeout(1_500);
    const bodyText = await page.locator("body").innerText();
    expect(bodyText).toContain(TEST_SUPPLIER);
  });
});
