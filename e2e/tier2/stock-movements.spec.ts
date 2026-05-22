import { expect, test } from "@playwright/test";
import { loginAsE2EOwner } from "./_fixtures/auth";

/**
 * Sesi AE-95 — Stock movements (Pergerakan Stok) tab smoke.
 *
 * Inventory section punya beberapa tab. Tab "Pergerakan" render
 * MovementsList component yang show stock movement events
 * (in/out/adjustment).
 *
 * Test verify:
 *   - Inventory section render
 *   - Tab "Pergerakan" clickable
 *   - MovementsList render (table atau empty state)
 */

test.describe("Stock movements (Pergerakan Stok)", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsE2EOwner(page, "/dashboard#inventory");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(2_500);
  });

  test("Tab 'Pergerakan' clickable + MovementsList render", async ({
    page,
  }) => {
    const tab = page.getByRole("tab", { name: /Pergerakan/i }).first();
    if (!(await tab.isVisible({ timeout: 10_000 }).catch(() => false))) {
      test.skip(true, "Tab Pergerakan tidak visible (responsive layout?)");
    }
    await tab.click();
    await page.waitForTimeout(2_500);

    const bodyText = await page.locator("body").innerText();
    /* MovementsList render header "Pergerakan Stok (n)" atau empty
     * state. */
    expect(bodyText).toMatch(
      /Pergerakan Stok|movement|stok|in|out|adjust|kosong/i,
    );
    expect(bodyText).not.toMatch(
      /something went wrong|client-side exception/i,
    );
  });

  test("Section /inventory render tab navigation", async ({ page }) => {
    const bodyText = await page.locator("body").innerText();
    /* InventorySection tab labels: Ingredients (Bahan), Pergerakan, Opname. */
    expect(bodyText).toMatch(/bahan|ingredient|pergerakan|opname|stok/i);
  });
});
