import { expect, test } from "@playwright/test";
import { loginAsE2EOwner } from "./_fixtures/auth";

/**
 * Sesi AE-95 — Aggregator Online CSV import wizard smoke.
 *
 * AggregatorOnlineSection punya tombol "Import CSV" yang membuka
 * AggregatorImportWizardModal (4-step: Channel → Upload → Map → Confirm).
 *
 * Test verify:
 *   - Tombol Import CSV visible
 *   - Klik → wizard modal Step 1 render dengan channel picker
 *   - Tab summary + channel tabs render
 */

test.describe("Aggregator CSV import wizard", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsE2EOwner(page, "/dashboard#aggregator_online");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(2_500);
  });

  test("Tombol 'Import CSV' visible + click → wizard modal render", async ({
    page,
  }) => {
    const btn = page.getByRole("button", { name: /Import CSV/i }).first();
    await expect(btn).toBeVisible({ timeout: 15_000 });
    await btn.click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 5_000 });

    /* Step 1 = pilih channel (GoFood / GrabFood / ShopeeFood / dst). */
    const dialogText = await dialog.innerText();
    expect(dialogText).toMatch(
      /GoFood|GrabFood|ShopeeFood|channel|pilih|aggregator/i,
    );
  });

  test("Tab navigation summary + channel tabs render", async ({ page }) => {
    const bodyText = await page.locator("body").innerText();
    /* Summary tab + per-channel tabs ada di section. */
    expect(bodyText).toMatch(
      /Summary|GoFood|GrabFood|ShopeeFood|aggregator|settlement/i,
    );
    expect(bodyText).not.toMatch(
      /something went wrong|client-side exception/i,
    );
  });
});
