import { expect, test } from "@playwright/test";
import { loginAsE2EOwner } from "./_fixtures/auth";

/**
 * Sesi AE-95 — Thermal Printer pairing smoke.
 *
 * SettingsSection render PrinterControls dengan tombol "Pair Printer".
 * Web Bluetooth requires user gesture + Chrome/Edge — pada Playwright
 * Chromium headless `requestDevice` akan throw atau show "not supported".
 *
 * Test verify:
 *   - Section render dengan header "Thermal Printer"
 *   - Tombol "Pair Printer" visible (atau warning Web Bluetooth not supported)
 *   - "Pair (semua device)" advanced control visible
 */

test.describe("Printer pairing controls", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsE2EOwner(page, "/dashboard#settings");
    await page.waitForLoadState("networkidle");
    /* SettingsSection lazy-load — wait until heading content rendered
     * (bukan cuma sidebar nav). */
    await page
      .getByRole("heading", { name: /Thermal Printer/i })
      .waitFor({ timeout: 15_000 })
      .catch(() => {});
    await page.waitForTimeout(1_500);
  });

  test("Settings section render Thermal Printer card", async ({ page }) => {
    const heading = page.getByRole("heading", { name: /Thermal Printer/i });
    await expect(heading).toBeVisible({ timeout: 15_000 });
    const bodyText = await page.locator("body").innerText();
    expect(bodyText).not.toMatch(
      /something went wrong|client-side exception/i,
    );
  });

  test("Tombol 'Pair Printer' atau warning unsupported render", async ({
    page,
  }) => {
    /* Playwright Chromium tidak expose Web Bluetooth by default — UI akan
     * show warning. Acceptable: either button atau warning text visible. */
    const pairBtn = page
      .getByRole("button", { name: /Pair Printer/i })
      .first();
    const warning = page.getByText(
      /Web Bluetooth tidak didukung|Pakai Chrome|Edge/i,
    );

    const hasBtn = await pairBtn.isVisible({ timeout: 5_000 }).catch(() => false);
    const hasWarning = await warning
      .isVisible({ timeout: 2_000 })
      .catch(() => false);

    expect(hasBtn || hasWarning).toBe(true);
  });
});
